/* ПОВЕДЕНЧЕСКАЯ проводка термодатчика (К5а) — через НАСТОЯЩИЕ renderBuilder / supplierSpecData /
   buildPostLayout на общем стенде (tests/helpers/appStand.js). Юнит-тесты thermoSensor.test.js
   держат правило, но НЕ ловят разрыв проводки: фильтр карточек, добавление датчика в свод и строку
   раскладки КП проверяются только здесь, исполнением исходного текста app.js/postBuilder.js/docs.js.

   МУТАЦИЯ → КРАСНЫЙ (поставлены координатором через tools/qa/mutate.cjs):
     1. postBuilder.renderBuilder: убрать `.filter(!isSensorMechanism)` → 02965.1 всплывает в карточках;
     2. docs.supplierSpecData: убрать `.concat(sensorItems)` → датчика нет в своде поставщику;
     3. docs.buildPostLayout: `if(sens…)` → `if(false)` → нет строки «Термодатчик — N» в раскладке КП.
   Запуск: node --test tests/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");
const EPCatalog = require("../js/catalog.js");
const EPPosts = require("../js/posts.js");
const EPEstimate = require("../js/estimate.js");
const EPBuilderSlots = require("../js/builderSlots.js");
const EPThermoSensor = require("../js/thermoSensor.js");
const EPSupplierSpec = require("../js/supplierSpec.js");

const SENSOR = "02965.1";

/* Каталог — РЕАЛЬНЫЙ и обогащённый ровно как в браузере (catalog → attrs → data.js): признак
   thermoSensorCode и группа «Термодатчик» (нужна фильтру) приезжают тем же путём, что в проде. */
async function enrichedProducts() {
  const win = {};
  const ctx = vm.createContext({ window: win, structuredClone });
  for (const f of ["catalog-vimar.js", "catalog-vimar-attrs.js", "data.js"])
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8"), ctx, { filename: f });
  return win.DataService.getProducts();
}

/* --- 1. renderBuilder: карточки выбора механизмов окна поста НЕ содержат 02965.1, но содержат 02974 --- */
function makeBuilderCtx(products, dom) {
  const product = id => products.find(p => Number(p.id) === Number(id));
  const byKind = kind => products.filter(x => x.kind === kind && x.active);
  return {
    state: null, products, product, byKind, frameProduct: id => product(id), $: dom.$,
    frameSlotCount: EPCatalog.frameSlotCount, compatibleMechanisms: EPCatalog.compatibleMechanisms,
    mechanismSpan: EPCatalog.mechanismSpan, moduleWord: EPCatalog.moduleWord,
    productSeries: i => EPCatalog.productSeries(i), productOptionLabel: i => `[${i.code}] ${i.name}`,
    esc: s => String(s == null ? "" : s), enhancePicker: () => {}, resolveMissingFrame: () => null,
    mechanismModulesTotal: ids => ids.reduce((s, id) => s + EPCatalog.mechanismSpan(product(id)), 0),
    assembledPostHtml: () => "<post-preview>", lightingFor: () => ({}), projectPostsWithBuilder: () => [],
    builderPostDraft: () => ({ mechanismIds: [] }), renderBuilderSlots: () => {}, lightingRowsFor: () => [],
    retargetBuilderSlot: () => {}, builderErrorHtml: () => "", renderBuilderCatalog: () => {},
    renderBuilderComposition: () => {}, renderBuilder: () => {}, builderCtx: {},
    collectionFramePool: frames => frames, frameFacingHintText: () => "", EPCatalog,
    builderInnardsFilter: () => ({}), builderFilterRoom: () => null, frameFacingList: () => [],
    EPRoom: { roomFrameFacing: () => null }, EPBuilderSlots, EPPosts, EPThermoSensor
  };
}

test("renderBuilder: 02965.1 НЕ в каталоге карточек окна поста, 02974 — есть (фильтр выбора работает)", async () => {
  const products = await enrichedProducts();
  const m02974 = products.find(p => p.code === "02974");
  const sensor = products.find(p => p.code === SENSOR);
  const allMech = products.filter(p => p.kind === "mechanism" && p.active);
  // Накладка, у которой по серии совместимы И терморегулятор, И датчик (иначе фильтр нечего резать).
  const frame = products.find(p => p.kind === "frame" && p.active && (() => {
    const c = EPCatalog.compatibleMechanisms(p, allMech);
    return c.includes(m02974) && c.includes(sensor) && EPCatalog.frameSlotCount(p) >= 2;
  })());
  assert.ok(frame, "разведка: есть накладка, совместимая и с 02974, и с 02965.1");

  const dom = stand.makeDom({ selects: ["postFrameSelect"] });
  const ctx = makeBuilderCtx(products, dom);
  ctx.state = { products, builder: { slots: EPBuilderSlots.fromPost({ mechanismIds: [] }, () => false), target: { mode: "add" }, editingPlacedId: null } };
  dom.$("postFrameSelect").dataset.preferredFrameId = String(frame.id);
  dom.$("postSlotCount").value = String(EPCatalog.frameSlotCount(frame));
  const render = stand.run(["frameOptions", "builderCapacity", "renderBuilder"], ctx);
  render();

  const cards = ctx.builderCtx.mechs || [];
  const has = code => cards.some(m => String(m.code) === code);
  assert.ok(has("02974"), "терморегулятор 02974 предлагается карточкой");
  assert.ok(!has(SENSOR), "выносной датчик 02965.1 из карточек выбора УБРАН (его добавляет расчёт)");
});

/* --- 2. supplierSpecData: датчик в своде поставщику, раздел «Механизмы и клавиши», количество по проекту --- */
const realDeps = sensorPlan => {
  const findBoxNull = () => null;
  return {
    product: null, frameProduct: null, mechanismSpan: it => (it && it.moduleSpan) || 1,
    findBox: findBoxNull, fallbackBox: findBoxNull, supportRequired: () => true,
    resolveSupport: () => ({ support: null, assumed: false }), backlight: { enabled: false }, wallType: "solid",
    sensorPlan
  };
};

test("supplierSpecData: пост с 02974 даёт 02965.1 в своде — kind mechanism («Механизмы и клавиши»), 2 поста → 2 шт.", async () => {
  const products = await enrichedProducts();
  const byId = new Map(products.map(p => [p.id, p]));
  const product = id => byId.get(id) || null;
  const byCode = c => products.find(p => p.code === c);
  const findSensor = code => products.find(p => p.code === code && p.active !== false) || null;
  const therm = byCode("02974");
  const allMech = products.filter(p => p.kind === "mechanism" && p.active);
  const frame = products.find(p => p.kind === "frame" && p.active &&
    EPCatalog.compatibleMechanisms(p, allMech).includes(therm) && EPCatalog.frameSlotCount(p) >= 2);
  const deps = Object.assign(realDeps(ids => EPThermoSensor.plan(ids, { product, findSensor })),
    { product, frameProduct: product });
  const post = () => ({ id: Math.random(), number: 1, name: "Термопост", frameId: frame.id, mechanismIds: [therm.id] });

  const build = stand.run("supplierSpecData", {
    state: { posts: [post(), post()], devices: [] }, product,
    postComposition: p => EPPosts.postComposition(p, deps),
    lightingRowsFor: () => [], EPLightingGroups: { isSupplyGap: () => false }, EPEstimate, EPSupplierSpec
  });
  const data = EPSupplierSpec.collect(build({ plan: { relayTotal: 0 } }));
  const row = data.rows.find(r => r.code === SENSOR);
  assert.ok(row, "02965.1 присутствует в сводной спецификации поставщику");
  assert.equal(row.kind, "mechanism", "датчик в разделе «Механизмы и клавиши» (kind mechanism)");
  assert.equal(row.count, 2, "два поста с терморегулятором → 2 датчика в заказе");
});

/* --- 3. buildPostLayout: строка «Термодатчик — N» в наполнении раскладки постов КП ------------- */
const KEY = { fillWord: "Термостат" };
function layoutFill(sensors) {
  const comp = {
    modulesTotal: 2, sensors,
    box: { name: "Коробка", code: "B1" }, boxCount: 1,
    frameAvailability: { code: "F1", available: true, displayName: "Рамка" }
  };
  const ctx = {
    state: { posts: [{ number: 1, mechanismIds: ["m1"] }] },
    postComposition: () => comp, frameProduct: () => null, EP_DATA: { settings: {} },
    EPPosts, EPEstimate, product: () => KEY, postCost: () => 0, displayRate: () => 1, displayCurrency: () => "EUR",
    lightingRowsFor: () => [], projectLighting: () => null, assembledPostHtml: () => ""
  };
  return stand.run(["postTotalCost", "postPricedItems", "buildPostLayout"], ctx)({ articles: false })[0].fill;
}
const sensorsPlan = (items, gaps) => ({ items: items || [], gaps: gaps || [], count: (items || []).length, hasGap: (gaps || []).length > 0 });
const sItem = () => ({ sensor: { code: SENSOR, name: "Термодатчик", price: 97.02 } });

test("buildPostLayout (КП): подобранные датчики → позиция «Термодатчик — N» в наполнении", () => {
  const fill = layoutFill(sensorsPlan([sItem(), sItem()], []));
  const row = fill.find(f => f.word === "Термодатчик");
  assert.ok(row, "датчик добавлен отдельной позицией наполнения");
  assert.equal(row.count, 2, "количество = числу подобранных датчиков");
});

test("buildPostLayout (КП): пробел датчика — словами, без количества к заказу (noCount)", () => {
  const fill = layoutFill(sensorsPlan([], [{ mechId: "m1" }]));
  const gap = fill.find(f => /термодатчик не подобран/.test(f.word));
  assert.ok(gap, "пробел датчика назван словами");
  assert.equal(gap.noCount, true, "пробел в количество к заказу не идёт");
});

test("buildPostLayout (КП): нет датчиков → строки «Термодатчик» нет (раскладка как раньше)", () => {
  const fill = layoutFill(sensorsPlan([], []));
  assert.ok(!fill.some(f => /Термодатчик/.test(f.word)), "без датчиков наполнение байт в байт прежнее");
});
