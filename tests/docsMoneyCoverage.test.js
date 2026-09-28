/* З9 — ЗАКРЫТИЕ ДЫР ПОКРЫТИЯ В ДОКУМЕНТАХ (деньги). Оркестраторы КП и листа монтажника вынесены в
   js/docs.js (EPDocs.attach), но их связки — цена поста и личная скидка в раскладке КП, имена комнат
   в плане документа, блок «Группы света» листа монтажника на весь проект — не держал НИ ОДИН тест:
   на main все четыре мутации проходили молча (проверено tools/qa/mutate.cjs). docs.js в node не
   грузится (монолитная лексика attach), поэтому вырезаем ИСХОДНЫЙ ТЕКСТ нужных функций и исполняем
   его в vm на общем стенде (helpers/appStand.js) — как offerInvariant/backlightPostLayout/planLabelsSpecWiring.

   Каждый тест обязан КРАСНЕТЬ на своей мутации (§7.1 HANDOFF, зелёный ≠ проверенное правило):
     M3 — план в документе без имён комнат (planLabelsSpec, контурная ветка);
     M4 — цена поста в раскладке КП обнулена (buildPostLayout: price:0);
     M6 — лист монтажника на весь проект без блока «Группы света» (installSheetForProject);
     M7 — раскладка КП без личной скидки поста (buildPostLayout: discount:null).
   Плюс свои: MX1 цена берётся от другого поста, MX2 личная скидка удваивается, MX3 имя комнаты БЕЗ
   контура затёрто.

   СВЕРКА ЦЕНЫ — С НЕЗАВИСИМЫМ ИСТОЧНИКОМ, а не с тем же выражением: цену поста из раскладки
   (buildPostLayout → postTotalCost → EPEstimate.postPrice) сверяем и с ИТОГОМ сметы (EPEstimate.build,
   другая функция), и с суммой каталожных цен изделий (frame + механизмы, прямое чтение прайса). */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const EPEstimate = require("../js/estimate.js");
const EPPosts = require("../js/posts.js");
const EPOfferPdf = require("../js/offerPdf.js");
const EPPlanLabels = require("../js/planLabels.js");
const EPInstallSheet = require("../js/installSheet.js");
const EPOfferOptions = require("../js/offerOptions.js");
const EPLightingGroups = require("../js/lightingGroups.js");
const EPLightingByRoom = require("../js/lightingByRoom.js");
const { polygonCentroid, roomLabelPoint, roomNamePoint } = require("../js/geometry.js");

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = n => Number(n).toFixed(2) + " €";
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.005, `${msg}: получено ${a}, ожидалось ${b}`);

/* Настоящий каталог VIMAR — теми же данными, что грузит браузер (сборщика нет). */
const realProducts = stand.loadVimarCatalog().products || [];
const realById = new Map(realProducts.map(p => [p.id, p]));
const idByCode = code => (realProducts.find(p => p.code === code) || {}).id;

/* Коробку/суппорт/подсветку НЕ подбираем: на предмет теста (цена, скидка, имена, блок света) они не
   влияют, а цена поста при этом равна frame + механизмы — её можно проверить прямым чтением прайса,
   независимо от EPEstimate. Тип стены задан, чтобы postComposition не спотыкался. */
const realDeps = {
  product: id => realById.get(id), frameProduct: id => realById.get(id),
  mechanismSpan: it => (it && it.moduleSpan) || 1,
  findBox: () => null, fallbackBox: () => null,
  supportRequired: () => true, resolveSupport: () => ({ support: null, assumed: false }),
  findBacklight: () => null, backlight: { enabled: false }, wallType: "solid"
};
const postCost = p => EPPosts.postCost(p, realDeps);
const postComposition = p => EPPosts.postComposition(p, realDeps);

/* Цена поста прямым чтением прайса (frame + механизмы) — источник, НЕ проходящий ни через
   postTotalCost, ни через EPEstimate: сумма каталожных цен и только. */
const catalogPrice = post => (Number((realById.get(post.frameId) || {}).price) || 0)
  + (post.mechanismIds || []).reduce((s, id) => s + (Number((realById.get(id) || {}).price) || 0), 0);
/* Цена поста ИТОГОМ сметы — независимая функция EPEstimate.build (не postTotalCost). Один пост →
   одна строка, count 1, sum = цене поста. */
const estimatePrice = post => EPEstimate.build({
  devices: [], posts: [post], product: id => realById.get(id), frameProduct: id => realById.get(id),
  postCost, postComposition, lightingOf: () => [], settings: {}
}).groups[0].sum;

/* Настоящие postTotalCost (app.js) + postPricedItems + buildPostLayout (docs.js) в одном vm-контексте:
   цена/скидка строк раскладки считаются НАСТОЯЩИМ кодом, comp/postCost — настоящими EPPosts на
   реальном каталоге. Групп света нет (lightingRowsFor → []), поэтому раскладка без подмен. */
function layoutOf(posts) {
  const ctx = {
    state: { posts },
    postComposition, postCost, frameProduct: id => realById.get(id), product: id => realById.get(id),
    lightingRowsFor: () => [], projectLighting: () => null,
    EPEstimate, EPPosts, EP_DATA: { settings: {} },
    assembledPostHtml: () => ""
  };
  /* light=null: раскладка без подмен цельных изделий; postTotalCost не зовёт projectLighting. */
  return stand.run(["postTotalCost", "postPricedItems", "buildPostLayout"], ctx)(undefined, null);
}

/* ─────────── 1. M4: цена поста в раскладке КП равна цене поста по смете (деньги) ─────────── */

const POST_A = { id: "a", number: 1, name: "Пост A", frameId: idByCode("14931"),
  mechanismIds: [idByCode("19021"), idByCode("19101")] };
const POST_B = { id: "b", number: 2, name: "Пост B", frameId: idByCode("14931"),
  mechanismIds: [idByCode("14021")] };

test("раскладка КП: цена поста == цене по смете И сумме каталожных цен, и она НЕнулевая (M4)", () => {
  const layout = layoutOf([POST_A, POST_B]);
  const rowA = layout.find(r => r.number === 1);
  const rowB = layout.find(r => r.number === 2);
  assert.ok(rowA && rowB, "оба поста в раскладке");

  /* Реальный каталог → ненулевая цена: обнуление (M4) сразу расходится с обоими источниками. */
  assert.ok(rowA.price > 0, "цена поста A ненулевая (реальный каталог)");
  near(rowA.price, catalogPrice(POST_A), "цена A = сумма каталожных цен (frame + механизмы)");
  near(rowA.price, estimatePrice(POST_A), "цена A = цене поста по смете (EPEstimate.build)");
  near(rowB.price, catalogPrice(POST_B), "цена B = сумма каталожных цен");
  near(rowB.price, estimatePrice(POST_B), "цена B = цене поста по смете");
});

test("раскладка КП: цена КАЖДОГО поста считается по СВОЕМУ посту, не от соседа (MX1)", () => {
  /* Опора мутации «цена берётся от другого поста»: у постов РАЗНЫЙ состав → разная цена. Если бы
     цена бралась от state.posts[0], строка B получила бы цену A. */
  const layout = layoutOf([POST_A, POST_B]);
  const rowA = layout.find(r => r.number === 1);
  const rowB = layout.find(r => r.number === 2);
  assert.ok(Math.abs(rowA.price - rowB.price) > 0.005, "цены постов различаются (иначе тест бессмыслен)");
  near(rowB.price, catalogPrice(POST_B), "у B — цена B, а не соседа A");
});

test("раскладка КП: Σ разбивки «Стоимость артикулов» равна «Стоимости блока» (инвариант)", () => {
  /* itemPrices (postPricedItems) и price (postTotalCost) — разные поля раскладки; их согласие
     держит §7.1: два денежных столбца не должны разойтись. */
  const rowA = layoutOf([POST_A]).find(r => r.number === 1);
  const itemsSum = (rowA.itemPrices || []).reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.count) || 0), 0);
  near(itemsSum, rowA.price, "Σ(цена×кол-во) изделий == цене блока");
});

/* ─────────── 2. M7: личная скидка поста в раскладке КП (деньги) ─────────── */

const POST_DISC = { id: "d", number: 1, name: "Пост со скидкой", frameId: idByCode("14931"),
  mechanismIds: [idByCode("19021")], discount: 20 };
const POST_NODISC = { id: "n", number: 2, name: "Пост без скидки", frameId: idByCode("14931"),
  mechanismIds: [idByCode("19021")] };

test("раскладка КП: личная скидка поста уходит в раскладку, у поста без личной — нет (M7)", () => {
  const layout = layoutOf([POST_DISC, POST_NODISC]);
  const rowD = layout.find(r => r.number === 1);
  const rowN = layout.find(r => r.number === 2);
  assert.equal(rowD.discount, 20, "личная скидка поста уехала в строку раскладки");
  assert.ok(rowN.discount == null, "у поста без личной скидки поля нет — он идёт по общей");
});

test("КП по смыслу: пометка «скидка 20%» печатается ровно у поста с личной скидкой (M7/MX2)", () => {
  /* Настоящая раскладка кормит настоящий EPOfferPdf.buildHtml: пометку рисует layoutDisc через ту же
     EPEstimate.discountOf, что и строки сметы. Общая скидка 10% → у поста со своей 20% пометка есть,
     у поста без своей (по общей 10%) — нет. */
  const est = EPEstimate.build({ devices: [], posts: [POST_DISC, POST_NODISC],
    product: id => realById.get(id), frameProduct: id => realById.get(id),
    postCost, postComposition, lightingOf: () => [], settings: { discountPercent: 10 } });
  const layout = layoutOf([POST_DISC, POST_NODISC]);
  const html = EPOfferPdf.buildHtml(est, { money, esc, displayCurrency: () => "EUR",
    settings: { discountPercent: 10 },
    options: { prices: true, sections: { plan: false, layout: true, specification: false, lighting: false, supplier: false },
      layout: { number: true, fill: true, modules: true, box: false, article: false, illustration: false, price: false, itemPrices: false } },
    postLayout: layout });
  assert.match(html, /скидка 20%/, "у поста с личной скидкой пометка «скидка 20%»");
  /* Считаем сам элемент пометки, а не класс: `.pl-disc{}` из <style> в счёт не идёт. */
  assert.equal((html.match(/<div class="pl-disc">/g) || []).length, 1, "пометка ровно у ОДНОГО поста — с личной скидкой");
});

/* ─────────── 3. M3: имена комнат в подписях плана документа ─────────── */

const SQUARE = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
/* Ровно те имена, что planLabelsSpec берёт из лексики app.js (как в planLabelsSpecWiring). */
function planCtx(rooms) {
  return {
    state: { planLoaded: false, planVisibility: "show", posts: [], rooms },
    $: id => (id === "planImage" ? { src: "", naturalWidth: 0, naturalHeight: 0 } : null),
    canvas: { clientWidth: 1000, clientHeight: 700 },
    polygonCentroid, roomLabelPoint, roomNamePoint,
    EPLightingGroups, EPLightingByRoom,
    EPPlanLabels, esc,
    planImageForDoc: () => "IMG"
  };
}
const ROOMS = [{ name: "Кухня", polygon: SQUARE }, { name: "Прихожая", x: 100, y: 50 }];

test("planLabelsSpec: имя есть и у контурной комнаты, и у комнаты без контура (M3/MX3)", () => {
  const spec = stand.run(["postsForGroupLinks", "planLabelsSpec"], planCtx(ROOMS))();
  const kitchen = spec.rooms.find(r => r.polygon);
  const hall = spec.rooms.find(r => !r.polygon);
  assert.equal(kitchen.name, "Кухня", "имя контурной комнаты — в spec");
  assert.equal(hall.name, "Прихожая", "имя комнаты без контура — в spec");
});

test("план документа по смыслу: имена обеих комнат попадают в HTML блока плана (M3/MX3)", () => {
  const html = stand.run(["postsForGroupLinks", "planLabelsSpec", "planBlockHtml"], planCtx(ROOMS))();
  assert.match(html, /Кухня/, "имя контурной комнаты напечатано в документе");
  assert.match(html, /Прихожая/, "имя комнаты без контура напечатано в документе");
});

/* ─────────── 4. M6: блок «Группы света» в листе монтажника на весь проект ─────────── */

/* Настоящие installSheetForProject + openInstallSheet (docs.js) → настоящий EPInstallSheet.buildHtml.
   buildPostSheet стабим (свои тесты у него есть; предмет здесь — блок света на весь лист); lightingHtml
   стаб повторяет контракт EPLightingPlan.buildHtml (есть группы → блок с заголовком, нет → ""). */
function projectSheetHtml(lightingPlan) {
  let written = "";
  const ctx = {
    Object, Array, Number, String, RegExp, JSON, Map, Infinity,
    window: { open: () => ({ document: { write: s => { written += s; }, close() {} } }) },
    state: { posts: [{ id: "p1", number: 1, roomId: null }], rooms: [] },
    toast: () => {},
    projectLighting: () => ({ plan: lightingPlan }),
    lightingHtml: (light, title) => (light && light.plan && (light.plan.groups || []).length)
      ? `<div class="mark-lighting">${esc(title)}: ${light.plan.groups.length}</div>` : "",
    buildPostSheet: p => ({ number: p.number, room: "", standardLabel: "", frameName: "", frameCode: "",
      color: "", height: "", purpose: "", modules: [], moduleGroups: null, fittings: [],
      assembledImageHtml: "", explodedViewHtml: "", german: null }),
    planBlockHtml: () => "", supplierSpecHtml: () => "",
    docHeader: () => ({ project: "П", developer: "Р", date: "Д" }),
    companyLogo: () => "", esc,
    EPInstallSheet, EPOfferOptions, EP_DATA: { settings: {} }
  };
  stand.run(["openInstallSheet", "installSheetForProject"], ctx)();
  return written;
}

test("лист монтажника на проект: блок «Группы света» есть, когда в проекте есть группы (M6)", () => {
  const html = projectSheetHtml({ groups: [{ label: "Кухня" }], gaps: [], relays: [] });
  assert.match(html, /mark-lighting/, "блок «Группы света» присутствует в документе");
  assert.match(html, /Группы света/, "и с правильным заголовком (installSheetForProject зовёт lightingHtml)");
});

test("лист монтажника на проект: блока света НЕТ, когда групп нет (контракт EPLightingPlan)", () => {
  /* Документирует «нет групп → нет блока»; M6 этот случай не различает (обе ветки дают ""),
     ловит M6 тест выше — с группами. */
  const html = projectSheetHtml({ groups: [], gaps: [], relays: [] });
  assert.doesNotMatch(html, /mark-lighting/, "пустой проект групп света не печатает лишний блок");
});
