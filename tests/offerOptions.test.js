const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const EPOfferOptions = require("../js/offerOptions.js");
const EPOfferPdf = require("../js/offerPdf.js");
const EPEstimate = require("../js/estimate.js");
const EPSupplierSpec = require("../js/supplierSpec.js");
const EPLightingPlan = require("../js/lightingPlan.js");
const EPPosts = require("../js/posts.js");
const EPPostImage = require("../js/postImage.js");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const deps = { esc, money: n => n + " €", displayCurrency: () => "EUR" };
const est = { groups: [{ name: "Пост 7", composition: "Розетка, белая", count: 2, unit: "компл.", sum: 20,
  items: [{ kind: "mechanism", name: "Розетка, белая", code: "M.01", count: 1 }] }],
  equipment: 20, discount: 0, materials: 5, work: 10, subtotal: 35, vat: 0, total: 35, missing: [] };
const layout = [{ number: 7, fill: [{ word: "Розетка", count: 1 }], modules: 1, frameCode: "F.01",
  box: { name: "Коробка для ГКЛ", code: "B.01", count: 2 }, assembledImageHtml: "<b>СБОРКА</b>" }];
const render = options => EPOfferPdf.buildHtml(est, { ...deps, options, postLayout: layout,
  planBlockHtml: "<section>ПЛАН</section>", lightingHtml: "<section>СВЕТ</section>", supplierSpecHtml: "<section>СВОД</section>" });
function table(html, cls) { return html.match(new RegExp(`<table class="${cls}">([\\s\\S]*?)</table>`))?.[1] || ""; }
const headers = t => [...t.matchAll(/<th(?:\s[^>]*)?>(.*?)<\/th>/g)].map(m => m[1]);

test("D10: нормализация сохраняет явные false, отбрасывает чужие поля и неверные типы", () => {
  const input = { articles: false, prices: "false", sections: { plan: false, supplier: 0 }, layout: { box: true }, alien: 1 };
  const before = JSON.stringify(input);
  const o = EPOfferOptions.normalize(input);
  assert.equal(o.articles, false); assert.equal(o.prices, true);
  assert.equal(o.sections.plan, false); assert.equal(o.sections.supplier, true);
  assert.equal(o.layout.box, true); assert.equal(o.layout.fill, true);
  assert.equal(o.alien, undefined); assert.equal(JSON.stringify(input), before);
  assert.deepEqual(EPOfferOptions.normalize(null), EPOfferOptions.preset("full"));
  o.sections.plan = true;
  assert.equal(input.sections.plan, false, "не сохраняем ссылки на вложенный объект проекта");
});

test("D10: без настроек прежние столбцы; монтажные коробки — ровно номер и фактическая коробка", () => {
  assert.deepEqual(headers(table(render(), "layout")), ["№ поста", "Наполнение", "Модульность", "Иллюстрация"]);
  const html = render(EPOfferOptions.preset("boxes"));
  assert.deepEqual(headers(table(html, "layout")), ["№ поста", "Монтажная коробка"]);
  assert.match(html, /Коробка для ГКЛ × 2/); assert.match(html, /ПЛАН/);
  assert.doesNotMatch(html, /F\.01|B\.01|M\.01|СБОРКА|СВЕТ|СВОД|€|class="totals"|class="specification"/);
});

for (const [key, label] of EPOfferOptions.fields.layout) {
  test(`D10: столбец раскладки «${label}» включается и выключается вместе с ячейкой`, () => {
    const selection = Object.fromEntries(EPOfferOptions.fields.layout.map(([k]) => [k, k === key]));
    const t = table(render({ layout: selection }), "layout");
    assert.deepEqual(headers(t), [label]);
    assert.equal([...t.matchAll(/<td(?:\s[^>]*)?>/g)].length, 1);
    selection[key] = false;
    assert.equal(table(render({ layout: selection }), "layout"), "", "пустая раскладка не печатается");
  });
}

test("D10: наименование в спецификации остаётся; отдельные цены и суммы можно выключить", () => {
  const selection = Object.fromEntries(EPOfferOptions.fields.specification.map(([k]) => [k, false]));
  assert.deepEqual(headers(table(render({ specification: selection }), "specification")), ["Наименование"]);
  selection.quantity = true; selection.article = true;
  const t = table(render({ specification: selection }), "specification");
  assert.deepEqual(headers(t), ["Наименование", "Артикулы состава", "Кол."]);
  assert.match(t, /M\.01/); assert.doesNotMatch(t, /€/);
});

test("D10: выключение разделов убирает секции, но не меняет входную смету", () => {
  const before = JSON.stringify(est);
  const html = render({ sections: { plan: false, layout: false, specification: false, lighting: false, supplier: false } });
  assert.doesNotMatch(html, /ПЛАН|Раскладка постов|Спецификация и комплектация|СВЕТ|СВОД/);
  assert.match(html, /35 €/); assert.equal(JSON.stringify(est), before);
});

test("D10: без артикулов состав берётся структурно — запятые в названиях не теряются", () => {
  const html = render({ articles: false, specification: { article: true }, layout: { article: true } });
  assert.match(html, /Розетка, белая/); assert.doesNotMatch(html, /M\.01|F\.01|Артикулы состава|Артикул накладки/);
  const old = { ...est, groups: [{ ...est.groups[0], items: undefined, composition: "SECRET.9" }] };
  const oldHtml = EPOfferPdf.buildHtml(old, { ...deps, options: { articles: false } });
  assert.doesNotMatch(oldHtml, /SECRET/); assert.match(oldHtml, /Состав без артикулов недоступен/);
});

test("D10: выключенные цены и столбцы не прячут пробел каталога и снятую накладку", () => {
  const html = EPOfferPdf.buildHtml({ ...est, missing: [999] }, { ...deps, options: EPOfferOptions.preset("boxes"),
    postLayout: [{ ...layout[0], frameStatusText: "Накладка снята с производства" }] });
  assert.match(html, /Накладка снята с производства/);
  assert.match(html, /Позиций без товара в каталоге: 1/); assert.doesNotMatch(html, /€|в «Итого»/);
  const withMoney = EPOfferPdf.buildHtml({ ...est, missing: [999] }, { ...deps, options: { sections: { specification: false } } });
  assert.ok(withMoney.includes(esc(EPEstimate.pricelessNote({ missing: [999] }))));
});

test("D10: скрытие кода не съедает часть другого числа, спецсимволы и HTML экранируются", () => {
  assert.equal(EPOfferOptions.itemText("Механизм не найден (арт. 991)", false), "Механизм не найден");
  assert.equal(EPOfferOptions.itemText("[1.2+] Изделие 11.2+", false, "1.2+"), "Изделие 11.2+");
  const html = EPOfferPdf.buildHtml(est, { ...deps, options: { layout: { box: true } },
    postLayout: [{ ...layout[0], box: { name: '<img src=x onerror="oops">', count: 1 } }] });
  assert.doesNotMatch(html, /<img src=x/); assert.match(html, /&lt;img/);
});

/* Исполняем настоящий путь экспорта app.js. Каталог в этом тесте синтетический:
   явные маркеры кодов ловят утечки из иллюстрации, пропавших позиций и приложения,
   а разные box/boxFallback ловят подмену фактической коробки ценовым запасным вариантом. */
function exportStand(options) {
  const frame = { id: 10, code: "FRAME_SECRET", name: "Накладка FRAME_SECRET", standard: "IT", slotCount: 3, kind: "frame" };
  const mech = { id: 20, code: "MECH_SECRET", name: "Розетка, белая", moduleCount: 1, categoryId: 300, price: 4, kind: "mechanism" };
  const box = { code: "BOX_SECRET", name: "Коробка для полой стены", price: 2, kind: "socket_box" };
  const support = { code: "SUP_SECRET", name: "Суппорт", price: 1, kind: "support" };
  const light = { plan: { groups: [{ label: "Свет", placeCount: 1, rolesRequired: { switch: 1 }, roles: { switch: 1 } }], gaps: [], relays: [], totals: { switch: 1 } },
    ambiguous: [{ role: "switch", series: ["Тест"], candidates: [{ code: "CANDIDATE_SECRET", name: "Кандидат CANDIDATE_SECRET" }] }] };
  const state = { devices: [{ productId: 20 }, { productId: 998877 }],
    posts: [{ number: 7, frameId: 10, name: "Пост 7", mechanismIds: [20, 998866] }], rooms: [] };
  const comp = { frame, frameAvailability: EPPosts.frameAvailability(10, frame), box: null, boxFallback: box,
    boxCount: 2, support, supportCount: 2, supportAssumed: true, modulesTotal: 2 };
  let html = "", saved = null;
  const dom = stand.makeDom();
  const ctx = { ...deps, $: dom.$, state, EP_DATA: { settings: { offerOptions: options } },
    EPOfferOptions, EPOfferPdf, EPEstimate, EPSupplierSpec, EPLightingPlan, EPPosts, EPPostImage,
    product: id => Number(id) === 20 ? mech : null, frameProduct: () => frame,
    postComposition: () => comp, postCost: () => 10, lightingRowsFor: () => [],
    projectLighting: () => light, lightingSum: () => 12345,
    mechanismSpan: p => p?.moduleCount || 0, frameSlotCount: () => 3,
    productImage: () => "", moduleFace: () => null, frameOpenings: () => [], frameOpening: () => null,
    docHeader: () => ({}), planBlockHtml: () => "<section>ПЛАН</section>",
    toast: () => {}, EPRates: {}, window: { open: () => ({ document: { write: h => { html = h; }, close() {} } }) },
    ProjectStore: { save: v => { saved = v; } }
  };
  const run = stand.run(["assembledPostSpec", "buildPostLayout", "buildEstimate", "supplierSpecData", "supplierSpecHtml",
    "ambiguityHtml", "lightingHtml", "generateCommercialOffer"], ctx);
  return { run: () => { run(); return html; }, ctx, dom, saved: () => saved };
}

test("D10: настоящий экспорт не пропускает коды через приложение, неоднозначность и собранную картинку", () => {
  const s = exportStand({ articles: false, prices: false, layout: { article: true, box: true }, specification: { article: true } });
  const before = JSON.stringify(s.ctx.state);
  const html = s.run();
  assert.doesNotMatch(html, /FRAME_SECRET|MECH_SECRET|BOX_SECRET|SUP_SECRET|CANDIDATE_SECRET|998877|998866|12345|€/);
  assert.match(html, /Розетка, белая/); assert.match(html, /Коробка для полой стены × 2/);
  assert.match(html, /Подбор механизма неоднозначен/); assert.match(html, /Кандидат/);
  assert.match(html, /Механизм не найден/); assert.match(html, /Товар не найден/);
  assert.match(html, /предположительно/); assert.match(html, /Позиций без артикула/);
  assert.match(html, /colspan="4"/); assert.equal(JSON.stringify(s.ctx.state), before);
  s.ctx.EP_DATA.settings.offerOptions = EPOfferOptions.preset("full");
  const full = s.run();
  for (const code of ["FRAME_SECRET", "MECH_SECRET", "BOX_SECRET", "SUP_SECRET", "CANDIDATE_SECRET", "998877", "998866"])
    assert.ok(full.includes(code), "контроль с артикулами: " + code);
  assert.match(full, /12345 €/); assert.match(full, /colspan="5"/);
});

test("D10: выбор коробок в настоящем экспорте убирает все другие разделы и суммы", () => {
  const html = exportStand(EPOfferOptions.preset("boxes")).run();
  assert.deepEqual(headers(table(html, "layout")), ["№ поста", "Монтажная коробка"]);
  assert.match(html, /Коробка для полой стены × 2/);
  assert.doesNotMatch(html, /Суппорт|Розетка|Сводная спецификация|Подбор механизма неоднозначен|12345|€/);
});

test("D10: UI → снимок проекта → восстановление сохраняет false и сбрасывает настройки старого проекта", async () => {
  const s = exportStand();
  const { ctx, dom } = s;
  let saves = 0;
  ctx.scheduleSave = () => { saves++; };
  stand.run(["syncOfferOptions", "applyOfferPreset"], ctx)("boxes");
  assert.equal(dom.$("offer-prices").checked, false);
  assert.equal(dom.$("offer-layout-box").checked, true);
  assert.equal(dom.$("offer-specification-price").disabled, true);
  stand.run(["syncOfferOptions", "applyOfferOption"], ctx)({ dataset: { offerGroup: "layout", offerKey: "illustration" }, checked: true });
  assert.equal(saves, 2);
  const snap = stand.run("projectSnapshot", ctx)();
  const expected = JSON.parse(JSON.stringify(ctx.EP_DATA.settings.offerOptions));
  assert.deepEqual(snap.offerOptions, expected);
  // Настройки из снимка не ссылаются на живой объект.
  ctx.EP_DATA.settings.offerOptions.layout.illustration = false;
  assert.equal(snap.offerOptions.layout.illustration, true);
  Object.assign(ctx, { ProjectStore: { load: () => snap }, dropOrphanKeyGroups: () => {}, fillDocHeaderInputs: () => {},
    EPConfig: { gridSteps: [10], gridDefault: 10 }, markCanvasUsed: () => {},
    renderLightingSchemeSelect: () => {}, renderProjectWallTypeSelect: () => {} });
  // Восстановление настоящей async-функции тем же общим стендом.
  const restore = stand.run(["syncOfferOptions", "restoreProject"], ctx);
  await restore();
  assert.deepEqual(ctx.EP_DATA.settings.offerOptions, expected);
  delete snap.offerOptions;
  await restore();
  assert.deepEqual(ctx.EP_DATA.settings.offerOptions, EPOfferOptions.normalize());
});

test("D10: init создаёт поля до восстановления — после перезагрузки нет обращения к null", async () => {
  const dom = stand.makeDom();
  const ctx = { $: dom.$, esc, EPOfferOptions, EP_DATA: { settings: {} }, state: {},
    DataService: { getProducts: async () => [], getSavedPosts: async () => [] },
    restoreProject: async () => {
      assert.match(dom.$("offerOptionsFields").innerHTML, /id="offer-layout-box"/,
        "restoreProject вызывает syncOfferOptions: к этому моменту поля должны быть созданы");
      return null;
    }
  };
  for (const name of ["loadCachedRate", "fillDocHeaderInputs", "renderTemplates", "renderAll", "renderSummary",
    "updateScaleUi", "updateRateUi", "applyPlanVisibility", "renderLightingSchemeSelect", "renderProjectWallTypeSelect",
    "renderPostSlotCountSelect", "applyGridStyle", "syncMarkupControls", "updateZoomUi", "applyView"])
    ctx[name] = () => {};
  await stand.run(["syncOfferOptions", "renderOfferOptions", "init"], ctx)();
});
