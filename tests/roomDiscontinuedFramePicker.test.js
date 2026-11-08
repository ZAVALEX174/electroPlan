/* ПОВЕДЕНЧЕСКИЙ тест В27 раунд 2, КРАЙ 2: окно «Подобрать накладку» (мастер) НЕ стирает снятое
   сохранённое значение признака, если человек не менял этот шаг, и показывает его в крошке шага с
   пометкой «снят(а) с производства». Подбор не меняется (снятое в фильтр мастера не подмешивается).

   Исполняем НАСТОЯЩИЕ openFramePicker / pickFrameStep / applyFramePicker из app.js в vm на реальном
   каталоге VIMAR со снятыми позициями (как index.html). framePicker*-состояние — свойства ctx (глобалы
   vm), поэтому цепочка run'ов по ОДНОМУ ctx делит состояние: openFramePicker наполняет sel/disc,
   applyFramePicker их читает. Крошку проверяем отдельным run'ом настоящего renderFramePicker со стабами
   тяжёлого DOM-рендера плиток (тело окна здесь не важно).

   МУТАЦИОННАЯ ТАБЛИЦА (прогнана руками, числа — в отчёте):
     writeSelection игнорирует disc (K2: «Применить» стирает снятое)        → §preserve-color/§preserve-coll;
     крошка без facingValueMark (K3: пометка в крошке убрана)               → §crumb-mark;
     pickFrameStep не чистит framePickerDisc нижележащих                    → §erase-on-change (ложно сохранит).
   Запуск: node --test tests/roomDiscontinuedFramePicker.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");

const EPCatalog = require("../js/catalog.js");
const EPRoom = require("../js/room.js");
const EPRoomVariants = require("../js/roomVariants.js");
const EPRoomVariantsUi = require("../js/roomVariantsUi.js");
const EPFramePicker = require("../js/framePicker.js");
const EPMechColor = require("../js/mechColor.js");

/* Обогащённый каталог СО СНЯТЫМИ — как в браузере. */
const JS_DIR = path.join(__dirname, "..", "js");
const win = {};
const ctx0 = vm.createContext({ window: win, structuredClone });
for (const f of ["catalog-vimar.js", "catalog-vimar-attrs.js", "catalog-vimar-discontinued.js", "data.js"]) {
  vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), "utf8"), ctx0, { filename: f });
}
let PRODUCTS;
test("подготовка: каталог со снятыми получен; «Хром»/«Arke Fit» только у снятых", async () => {
  PRODUCTS = await win.DataService.getProducts();
  assert.ok(PRODUCTS.length > 2000, "каталог загружен");
  const ac = EPCatalog.productFacingValues(PRODUCTS.filter(p => p.kind === "frame" && p.active), "frameColor");
  const oc = EPCatalog.productFacingValues(PRODUCTS.filter(p => p.kind === "frame" && p.active === false), "frameColor");
  assert.ok(!ac.includes("Хром") && oc.includes("Хром"), "«Хром» — только у снятых");
  const acoll = EPCatalog.productCollections(PRODUCTS.filter(p => p.kind === "frame" && p.active));
  const ocoll = EPCatalog.productCollections(PRODUCTS.filter(p => p.kind === "frame" && p.active === false));
  assert.ok(!acoll.includes("Arke Fit") && ocoll.includes("Arke Fit"), "серия «Arke Fit» — только у снятых");
});
const byKindOf = k => PRODUCTS.filter(x => x.kind === k && x.active);
const byKindOffOf = k => PRODUCTS.filter(x => x.kind === k && x.active === false);

/* $-шим окна: узлы с innerHTML, classList, querySelector(All) — без DOM-парсинга. */
function pickerDom() {
  const nodes = {};
  const mk = () => ({ innerHTML: "", value: "", classList: { add() {}, remove() {} }, querySelector: () => null, querySelectorAll: () => [] });
  return { nodes, $: id => nodes[id] || (nodes[id] = mk()) };
}
/* deps мастера — ровно как в app.js (framePickerDeps/mechColorDeps/MECH_COLOR_STEP). */
const framePickerDeps = {
  match: (frames, criteria) => EPCatalog.productsForRoom(frames, criteria),
  valuesOf: (pool, prop) => prop === "standard" ? EPCatalog.productStandards(pool) : prop === "collection" ? EPCatalog.productCollections(pool) : EPCatalog.productFacingValues(pool, prop),
  imageOf: () => ""
};
const mechColorDeps = { match: (m, c) => c && c.collection ? EPCatalog.compatibleMechanisms({ series: [c.collection] }, m) : (m || []).slice(), colorOf: item => EPMechColor.colorOf(item) };
const MECH_COLOR_STEP = { prop: "mechColor", title: "Цвет механизмов" };

/* Общий ctx цепочки «открыть → (сменить шаг) → применить» на одной комнате. */
function makeCtx(room) {
  const dom = pickerDom();
  return {
    byKind: byKindOf, byKindOff: byKindOffOf,
    EPCatalog, EPRoom, EPRoomVariants, EPRoomVariantsUi, EPFramePicker, EPMechColor,
    EPRoomWalls: require("../js/roomWalls.js"),
    framePickerDeps, mechColorDeps, MECH_COLOR_STEP,
    renderFramePicker: () => {}, setTimeout: () => 0,
    $: dom.$, _dom: dom,
    state: { rooms: [room] },
    persistProject: () => {}, renderProperties: () => {},
    framePickerRoomId: null, framePickerSel: null, framePickerStep: 0, framePickerDisc: {}
  };
}
const OPEN = ["frameCollectionList", "frameFacingList", "frameStandardList", "openFramePicker"];
const PICK = ["framePickerSteps", "framePickerVisible", "pickFrameStep"];
const APPLY = ["closeFramePicker", "applyFramePicker"];

test("§disc-built: openFramePicker собирает карту снятых из варианта, в sel снятого нет", () => {
  const room = { id: "r1", name: "К", standard: "IT", collection: "Arke", frameColor: "Хром" };
  const ctx = makeCtx(room);
  stand.run(OPEN, ctx)(room);
  assert.equal(ctx.framePickerDisc.frameColor, "Хром", "снятый цвет попал в карту disc");
  assert.ok(!ctx.framePickerSel.frameColor, "в рабочий выбор (фильтр мастера) снятый цвет НЕ подмешан");
  assert.equal(ctx.framePickerSel.collection, "Arke", "живая серия — в выборе");
});

test("§preserve-color: «Применить» без касаний сохраняет снятый цвет «Хром» (не стирает)", () => {
  const room = { id: "r1", name: "К", standard: "IT", collection: "Arke", frameColor: "Хром" };
  const ctx = makeCtx(room);
  stand.run(OPEN, ctx)(room);
  stand.run(APPLY, ctx)();
  assert.equal(room.frameColor, "Хром", "снятый цвет сохранён — «Применить» без изменений его не стёр");
  assert.equal(room.collection, "Arke", "живая серия на месте");
});

test("§preserve-coll: «Применить» без касаний сохраняет снятую серию «Arke Fit»", () => {
  const room = { id: "r1", name: "К", standard: "IT", collection: "Arke Fit" };
  const ctx = makeCtx(room);
  stand.run(OPEN, ctx)(room);
  assert.equal(ctx.framePickerDisc.collection, "Arke Fit", "снятая серия — в карте disc");
  stand.run(APPLY, ctx)();
  assert.equal(room.collection, "Arke Fit", "снятая серия сохранена");
});

test("§erase-on-change: сменили шаг «Серия» живым выбором → снятый цвет стёрт как обычно", () => {
  const room = { id: "r1", name: "К", standard: "IT", collection: "Arke", frameColor: "Хром" };
  const ctx = makeCtx(room);
  stand.run(OPEN, ctx)(room);
  assert.equal(ctx.framePickerDisc.frameColor, "Хром", "до смены — снятый цвет в disc");
  ctx.framePickerStep = 1;                         /* встаём на шаг «Серия» */
  stand.runNamed(PICK, ctx)("Eikon Evo");          /* framePickerSteps — const-стрелка, поэтому runNamed */
  assert.ok(!ctx.framePickerDisc.frameColor, "смена серии инвалидировала снятый цвет нижележащего шага");
  stand.run(APPLY, ctx)();
  assert.ok(!("frameColor" in room), "после смены серии снятый цвет стёрт — обычный каскад");
  assert.equal(room.collection, "Eikon Evo", "записана новая серия");
});

/* --- КРОШКА ШАГА показывает снятое значение с пометкой (настоящий renderFramePicker, стабы тела) --- */
const CRUMB_STEPS = [
  { prop: "standard", title: "Стандарт" }, { prop: "collection", title: "Серия" },
  { prop: "frameMaterial", title: "Материал" }, { prop: "frameShape", title: "Форма" },
  { prop: "frameColor", title: "Цвет" }
];
function renderCrumbs(sel, disc, stepIdx) {
  const dom = pickerDom();
  const ctx = {
    framePickerSteps: () => CRUMB_STEPS,
    framePickerVisible: () => [CRUMB_STEPS[1], CRUMB_STEPS[4]],   /* видимы «Серия» и «Цвет» */
    framePickerStepOptions: () => [],                            /* пусто → ветка «нет накладок», без плиток */
    frameStepValueLabel: (prop, v) => v,
    framePickThumb: () => "", bindProductPictureFallbacks: () => {},
    frameFacingSelectionLabels: () => ["x"], frameFacingEmptyText: s => "нет: " + s,
    esc: String, EPRoomVariantsUi,
    framePickerSel: sel, framePickerDisc: disc, framePickerStep: stepIdx,
    $: dom.$
  };
  stand.run("renderFramePicker", ctx)();
  return dom.nodes.framePickerCrumbs.innerHTML;
}

test("§crumb-mark: крошка шага «Цвет» со снятым значением показывает «Хром — снят с производства»", () => {
  const html = renderCrumbs({ collection: "Arke" }, { frameColor: "Хром" }, 4);
  assert.match(html, /Хром\s*— снят с производства/, "снятый цвет в крошке помечен");
  assert.match(html, /Серия[\s\S]*?Arke/, "живая серия в крошке — без пометки");
  assert.doesNotMatch(html.replace(/Хром\s*— снят с производства/, ""), /— снят(а)? с производства/, "у живой серии пометки нет");
});

test("§crumb-coll-mark: крошка шага «Серия» со снятым значением — «Arke Fit — снята с производства»", () => {
  const html = renderCrumbs({}, { collection: "Arke Fit" }, 1);
  assert.match(html, /Arke Fit\s*— снята с производства/, "снятая серия в крошке помечена (род слова «снята»)");
});
