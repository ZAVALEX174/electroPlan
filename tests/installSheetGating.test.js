/* К11-3в, раунд правки 28.10 — ГАЛОЧКИ ЛИСТА ДОХОДЯТ ДО ПЕЧАТИ ПО СОХРАНЁННОМУ ПОЛЮ ПРОЕКТА.
   Прежние тесты держали ЧИСТЫЕ функции (installSheetOptions.js, accessor, окно), но сама ЦЕПОЧКА
   печати — installSheetForProject / installSheetForBuilder → openInstallSheet → EPInstallSheet.buildHtml —
   не была накрыта поведенчески, и на HEAD выживали мутации (проверено tools/qa/mutate.cjs): лист
   печатался по migrate, а не по выбору окна, либо галочки не доходили до buildPostSheet/lightingHtml.

   Исполняем НАСТОЯЩИЙ текст оркестраторов в vm (стенд helpers/appStand.js): openInstallSheet и
   installSheetForProject/installSheetForBuilder — настоящие, печать идёт в настоящий EPInstallSheet.buildHtml,
   а периферию (buildPostSheet/lightingHtml) подменяем заглушками, которые ЗАПИСЫВАЮТ полученные галочки —
   так видно и что в HTML (нет €/«Стоимость блока»/артикулов при наборе «Клиенту»), и что галочки
   реально переданы вниз.

   МУТАЦИОННАЯ ТАБЛИЦА (сломай код — покраснеет тест):
     A-project · docs.js `const options=installSheetOptions()` → `EPInstallSheetOptions.migrate(EP_DATA.settings)`
        → migrate даёт prices/articles ON → в HTML появляются €/«Стоимость блока»/код → краснеет;
     A-builder · postBuilder.js buildPostSheet(post,light,options) без options → заглушка получит undefined → краснеет;
     A-builder · postBuilder.js lightingHtml(light,"…",options) без options → заглушка получит undefined → краснеет;
     A-builder · postBuilder.js убрать `options,` из openInstallSheet({…}) → openInstallSheet возьмёт migrate →
        в HTML появляются €/код → краснеет;
     E · docs.js lightNote печатает `${row.roleLabel} ${row.code}` без гейта → при articles:false код остаётся
        в примечании → sheet.note и HTML содержат код → краснеет.
   Запуск: node --test tests/installSheetGating.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const stand = require("./helpers/appStand.js");
const EPPosts = require("../js/posts.js");
const EPBuilderSlots = require("../js/builderSlots.js");
const EPEstimate = require("../js/estimate.js");
const EPInstallSheet = require("../js/installSheet.js");
const EPOfferOptions = require("../js/offerOptions.js");
const EPInstallSheetOptions = require("../js/installSheetOptions.js");

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const CLIENT = EPInstallSheetOptions.preset("client");   // prices:false, articles:false, …

/* ═══════════ A. Галочки доходят до печати через настоящую цепочку ═══════════

   Заглушка одного поста: несёт КОД в столбце «Артикул» и ненулевую «Стоимость блока» — ровно то,
   что набор «Клиенту» обязан погасить (articles:false, prices:false). */
function stubSheet() {
  return { number: 1, room: "", standardLabel: "", frameName: "Накладка", frameCode: "14931",
    color: "", height: "", purpose: "",
    modules: [{ label: "1", name: "Выключатель", code: "19021", note: "" }],
    moduleGroups: null, fittings: [], assembledImageHtml: "", assembledLargeHtml: "",
    explodedViewHtml: "", german: null, priceText: "42,50 €" };
}
/* Заглушка lightingHtml по контракту app.js: суммы (€) печатает ТОЛЬКО когда options.prices !== false. */
const lightingStub = rec => (light, title, options) => {
  rec.lh = options;
  return options && options.prices ? "<div>Группы света Σ 9,00 €</div>" : "";
};

/* Настоящие openInstallSheet + installSheetForProject (docs.js) на общем vm-контексте. installSheetOptions
   стаблен на «Клиенту»; EP_DATA.settings несёт assemblyView (без поля installSheetOptions), поэтому
   migrate дал бы ПОЛНЫЙ лист (prices/articles ON) — именно это и всплывёт в HTML под мутацией. */
function projectRun() {
  let written = "";
  const rec = {};
  const ctx = {
    Object, Array, Number, String, RegExp, JSON, Map, Infinity,
    window: { open: () => ({ document: { write: s => { written += s; }, close() {} } }) },
    state: { posts: [{ id: "p1", number: 1, roomId: null }], rooms: [] },
    toast: () => {},
    projectLighting: () => null,
    installSheetOptions: () => CLIENT,
    buildPostSheet: (p, light, options) => { rec.bps = options; return stubSheet(); },
    lightingHtml: lightingStub(rec),
    planBlockHtml: () => "", supplierSpecHtml: (o, l, options) => { rec.ssh = options; return ""; },
    docHeader: () => ({ project: "П", developer: "Р", date: "Д" }),
    companyLogo: () => "", esc,
    EPInstallSheet, EPInstallSheetOptions, EP_DATA: { settings: { assemblyView: "exploded" } }
  };
  stand.run(["openInstallSheet", "installSheetForProject"], ctx)();
  return { written, rec };
}

test("A-project: лист на весь проект печатается по выбору окна (migrate его не перебивает)", () => {
  const { written, rec } = projectRun();
  /* Галочки «Клиенту» реально доехали до состава и до блока света. */
  assert.deepEqual(rec.bps, CLIENT, "галочки окна переданы в buildPostSheet");
  assert.deepEqual(rec.lh, CLIENT, "галочки окна переданы в lightingHtml (гейт сумм)");
  /* В HTML нет денег и артикулов: под мутацией `installSheetOptions()`→`migrate(...)` они появились бы. */
  assert.doesNotMatch(written, /€/, "в листе «Клиенту» нет цен (мутация installSheetOptions→migrate краснит здесь)");
  assert.doesNotMatch(written, /Стоимость блока/, "нет строки «Стоимость блока»");
  assert.doesNotMatch(written, /19021/, "артикул погашен (набор «Клиенту» — без артикулов)");
});

/* Настоящие openInstallSheet + installSheetForBuilder (postBuilder.js) — лист ОДНОГО поста из окна
   конструктора. Периферию конструктора (накладка/слоты/стена/расчёт) стаблим; предмет — что галочки
   окна доходят до buildPostSheet, lightingHtml и openInstallSheet. */
function builderRun() {
  let written = "";
  const rec = {};
  const nodes = { postFrameSelect: { value: "14931" } };
  const ctx = {
    Object, Array, Number, String, RegExp, JSON, Map, Infinity,
    window: { open: () => ({ document: { write: s => { written += s; }, close() {} } }) },
    $: id => nodes[id] || (nodes[id] = { value: "" }),
    toast: () => {},
    EPPosts: { frameAvailability: () => ({ blocksDocuments: false, frame: { id: 1 }, statusText: "" }) },
    frameProduct: () => ({ id: 1 }),
    state: { posts: [], builder: { editingPlacedId: null, slots: [], thermoSensor: "on" } },
    EPBuilderSlots: { toPost: () => ({ mechanismIds: [1], keyGroups: [], keyCrossNumbers: [], keyMechanisms: [] }) },
    builderWallType: () => "solid",
    lightingFor: () => null,
    projectPostsWithBuilder: () => [],
    installSheetOptions: () => CLIENT,
    buildPostSheet: (p, light, options) => { rec.bps = options; return stubSheet(); },
    lightingHtml: lightingStub(rec),
    docHeader: () => ({ project: "П", developer: "Р", date: "Д" }),
    companyLogo: () => "", esc,
    EPInstallSheet, EPInstallSheetOptions, EP_DATA: { settings: { assemblyView: "exploded" } }
  };
  stand.run(["openInstallSheet", "installSheetForBuilder"], ctx)();
  return { written, rec };
}

test("A-builder: лист одного поста из окна печатается по тем же галочкам (buildPostSheet/lightingHtml/openInstallSheet)", () => {
  const { written, rec } = builderRun();
  assert.deepEqual(rec.bps, CLIENT, "галочки переданы в buildPostSheet (мутация «без options» краснит здесь)");
  assert.deepEqual(rec.lh, CLIENT, "галочки переданы в lightingHtml (мутация «без options» краснит здесь)");
  /* openInstallSheet получил options в data → buildHtml гасит цены/артикулы; без них взял бы migrate. */
  assert.doesNotMatch(written, /€/, "в листе поста «Клиенту» нет цен (мутация «убрать options у openInstallSheet» краснит здесь)");
  assert.doesNotMatch(written, /Стоимость блока/, "нет строки «Стоимость блока»");
  assert.doesNotMatch(written, /19021/, "артикул погашен");
});

/* ═══════════ E. Артикул в примечании места гаснет вместе с галочкой «Артикулы» ═══════════

   Настоящий buildPostSheet на отгружаемом каталоге; lightingRowsFor стаблен одной НЕцельной строкой
   группы света (kind≠"integrated") с ролью и кодом — ровно та ветка lightNote, что печатала
   `· роль код`. Код (20183) не принадлежит ни посту (19021), ни накладке (14931) — его единственный
   источник в примечании, поэтому его исчезновение из note изолирует именно правку lightNote. */
const box = (() => {
  const b = {};
  ["../js/catalog-vimar.js", "../js/catalog-vimar-attrs.js"].forEach(f =>
    new Function("window", "\"use strict\";" + fs.readFileSync(path.join(__dirname, f), "utf8"))(b));
  return b;
})();
const standards = (box.EP_VIMAR_ATTRS && box.EP_VIMAR_ATTRS.standards) || {};
const realProducts = (box.EP_VIMAR_CATALOG.products || []).map(p => p.kind === "frame" && standards[p.code]
  ? Object.assign({}, p, { standard: standards[p.code].standard, postCount: standards[p.code].postCount }) : p);
const realById = new Map(realProducts.map(p => [p.id, p]));
const idByCode = code => (realProducts.find(p => p.code === code) || {}).id;

const realDeps = {
  product: id => realById.get(id), frameProduct: id => realById.get(id),
  mechanismSpan: it => (it && it.moduleSpan) || 1,
  findBox: () => null, fallbackBox: () => null,
  supportRequired: () => true, resolveSupport: () => ({ support: null, assumed: false }),
  findBacklight: () => null, backlight: { enabled: false }, wallType: "solid"
};
const LIGHT_ROW = { keyIndex: 0, kind: "switch", missing: false, groupLabel: "Кухня",
  placeNo: 1, placeCount: 2, roleLabel: "переключатель", code: "20183" };

function buildSheet(options) {
  const ctx = {
    postComposition: p => EPPosts.postComposition(p, realDeps),
    product: id => realById.get(id), frameProduct: id => realById.get(id),
    mechanismSpan: it => (it && it.moduleSpan) || 1,
    lightingRowsFor: () => [Object.assign({}, LIGHT_ROW)],
    EPLightingGroups: { isSupplyGap: () => false },
    EPPosts, EPBuilderSlots, EPEstimate, EPOfferOptions,
    keySlotKind: () => false, EPInstallSheet, state: { rooms: [] },
    postTotalCost: () => 42.5, moneyShown: n => Number(n).toFixed(2) + " €",
    assembledPostSpec: () => ({ size: "md", frame: null, rows: [] }),
    EPPostImage: { buildHtml: () => "", photoReady: () => false, pickIcon: () => "generic", iconSvg: () => "" },
    EPExplodedView: { buildHtml: () => "" }, productImage: () => "", esc,
    STANDARD_LABEL: { unknown: "неизвестный", BOTH: "универсальный", italian: "итальянский" }
  };
  const build = stand.run(["buildExplodedSpec", "buildPostSheet"], ctx);
  return build({ id: "p1", number: 1, frameId: idByCode("14931"), mechanismIds: [idByCode("19021")] }, null, options);
}
const render = (sheet, options) => EPInstallSheet.buildHtml({ posts: [sheet], options }, { esc });

test("E: при включённых «Артикулах» примечание места печатает роль с кодом (байт-в-байт как было)", () => {
  const sheet = buildSheet(EPInstallSheetOptions.normalize({ articles: true }));
  assert.equal(sheet.modules[0].note, "группа «Кухня» · место 1 из 2 · переключатель 20183",
    "с артикулами примечание несёт роль И код — прежний формат");
  assert.match(render(sheet, EPInstallSheetOptions.normalize({ articles: true })), /20183/,
    "и код виден в листе");
});

test("E: при выключенных «Артикулах» код из примечания исчезает, роль остаётся", () => {
  const sheet = buildSheet(EPInstallSheetOptions.normalize({ articles: false }));
  assert.equal(sheet.modules[0].note, "группа «Кухня» · место 1 из 2 · переключатель",
    "без артикулов код из примечания убран, роль оставлена (мутация «печатать код всегда» краснит здесь)");
  const html = render(sheet, EPInstallSheetOptions.normalize({ articles: false }));
  assert.doesNotMatch(html, /20183/, "код пропал ВЕЗДЕ в листе, включая примечание (контракт installSheet.js:313)");
  assert.match(html, /переключатель/, "роль места в примечании сохранена");
});
