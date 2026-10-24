/* ПОВЕДЕНЧЕСКИЙ тест К8г(1): подсказка пустого поиска накладки в окне поста
   (js/postBuilder.js resolveMissingFrame) и её ПРОВОДКА из renderBuilder.

   ЗАЧЕМ. Помещение/вариант закреплены за отделкой (стандарт/серия/материал/форма/цвет). Если человек
   вбивает в поиск точный артикул накладки, НЕ проходящей отбор ВЫБРАННОГО варианта, список пуст —
   resolveMissingFrame объясняет причину и НЕ предлагает «Переключить на N модулей»: несовместимую
   накладку в этот пост не поставить, отбор меняют в свойствах комнаты (решение владельца 24.10 после
   двух проверок). Совместимость судим ТЕМ ЖЕ EPPostVariant.placementFits, что размещение и окно (§7.1).
   Это покрывает и чужую серию/стандарт, и СОВПАВШУЮ модульность при несовместимости (прежде такой
   артикул возвращал null и молчал). Совместимый артикул чужой модульности — по-прежнему «Переключить».

   ЧАСТЬ А — САМА ФУНКЦИЯ на НАСТОЯЩЕМ каталоге VIMAR; ЧАСТЬ Б — проводка (renderBuilder передаёт
   resolveMissing ПОЛНЫЙ фильтр варианта, а не только коллекцию).

   МУТАЦИОННАЯ ТАБЛИЦА (в отчёте):
     убрать ветку `if(!placementFits(item,filter))` целиком               → краснеет А (чужой артикул) и Б;
     placementFits(item,filter) → placementFits(item,{}) (фильтр не учтён) → краснеет А (чужой артикул даёт null/ветку модулей);
     в точке вызова передать builderRoomFilter().collection вместо всего   → краснеет Б (стандарт/материал не отсеяли бы);
     оставить actionLabel «Переключить» у несовместимой накладки           → краснеет А (у ветки несовместимости действия быть не должно).
   Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

const EPCatalog = require("../js/catalog.js");
const EPRoom = require("../js/room.js");
const EPRoomVariants = require("../js/roomVariants.js");
const EPRoomVariantsUi = require("../js/roomVariantsUi.js");
const EPPostVariant = require("../js/postVariant.js");
const EPPosts = require("../js/posts.js");
const EPBuilderSlots = require("../js/builderSlots.js");
const EPSeriesMatch = require("../js/seriesMatch.js");

const PRODUCTS = stand.loadVimarCatalog().products;
const product = id => PRODUCTS.find(p => Number(p.id) === Number(id));
const byCode = code => PRODUCTS.find(p => p.code === code);
const seriesOf = p => (p && p.series) || [];

/* Разведка: 14642.01 — накладка ТОЛЬКО коллекции Plana (чужая для варианта Arke); 19642.01 — коллекции
   Arke (своя для Arke). Обе на 2 модуля. */
const PLANA_ONLY = byCode("14642.01");
const ARKE_OWN = byCode("19642.01");
assert.ok(PLANA_ONLY && ARKE_OWN, "предпосылка: 14642.01 и 19642.01 есть в каталоге");
assert.ok(seriesOf(PLANA_ONLY).includes("Plana") && !seriesOf(PLANA_ONLY).includes("Arke"),
  "предпосылка: 14642.01 — только Plana, для варианта Arke чужая");
assert.ok(seriesOf(ARKE_OWN).includes("Arke"), "предпосылка: 19642.01 — коллекции Arke, своя");
assert.equal(EPCatalog.frameSlotCount(PLANA_ONLY), 2, "предпосылка: 14642.01 — 2 модуля");
assert.equal(EPCatalog.frameSlotCount(ARKE_OWN), 2, "предпосылка: 19642.01 — 2 модуля");
assert.equal(EPPostVariant.placementFits(PLANA_ONLY, { collection: "Arke" }), false,
  "предпосылка: Plana-накладка НЕ проходит отбор варианта {серия Arke}");
assert.equal(EPPostVariant.placementFits(ARKE_OWN, { collection: "Arke" }), true,
  "предпосылка: Arke-накладка проходит отбор варианта {серия Arke}");

/* --- ЧАСТЬ А: сама resolveMissingFrame ------------------------------------------------------- */
/* Контекст vm: findByExactCode/frameFacingLabels/frameFacingSelectionLabels/resolveMissingFrame
   настоящие; byKind даёт активные накладки, EPPostVariant/EPCatalog настоящие (placementFits резолвит
   EPCatalog сам). $/changePostSlotCount/toast — безопасные стабы (нужны только внутри onAction). */
function makeFn() {
  const ctx = {
    byKind: kind => PRODUCTS.filter(x => x.kind === kind && x.active),
    productSeries: seriesOf,
    frameSlotCount: EPCatalog.frameSlotCount,
    moduleWord: EPCatalog.moduleWord,
    EPPostVariant, EPCatalog, EPSeriesMatch,
    $: () => ({ value: "", dataset: {} }),
    changePostSlotCount: () => {},
    toast: () => {}
  };
  return stand.run(["findByExactCode", "frameFacingLabels", "frameFacingSelectionLabels", "resolveMissingFrame"], ctx);
}
const frameSelect = { dataset: {} };   // используется только в onAction (не исполняется)
const ARKE_FILTER = { collection: "Arke" };

test("К8г-А: чужой артикул, СВОЙ размер (Plana 2М в варианте Arke, count 2) — объясняет, БЕЗ «Переключить»", () => {
  // Раньше при совпавшей модульности (2===2) функция возвращала null и молчала — теперь объясняет.
  const res = makeFn()(PLANA_ONLY.code, 2, frameSelect, ARKE_FILTER);
  assert.ok(res, "несовместимый артикул обязан дать подсказку, а не null");
  assert.equal(res.lead, "Артикул есть в каталоге, но не подходит этой комнате.");
  assert.equal(res.code, "14642.01");
  assert.match(res.reason, /не подходит отбору этой комнаты: .*серия «Arke»/, "условия через frameFacingSelectionLabels");
  assert.ok(!("actionLabel" in res), "несовместимой накладке «Переключить» НЕ предлагаем");
});

test("К8г-А: чужой артикул, ЧУЖОЙ размер (Plana 2М, count 3) — та же ветка несовместимости, без действия", () => {
  const res = makeFn()(PLANA_ONLY.code, 3, frameSelect, ARKE_FILTER);
  assert.ok(res);
  assert.equal(res.lead, "Артикул есть в каталоге, но не подходит этой комнате.",
    "несовместимость судится ПЕРВОЙ — не ветка модулей, хотя и размер не совпал");
  assert.ok(!("actionLabel" in res), "кнопки «Переключить» на несовместимую накладку быть не должно");
});

test("К8г-А: СВОЙ артикул своего размера (Arke 2М, count 2) — null (список его и так показал бы)", () => {
  assert.equal(makeFn()(ARKE_OWN.code, 2, frameSelect, ARKE_FILTER), null,
    "совместимая накладка своего размера скрытой не считается");
});

test("К8г-А: СВОЙ артикул чужого размера (Arke 2М, count 3) — ветка модулей с «Переключить»", () => {
  const res = makeFn()(ARKE_OWN.code, 3, frameSelect, ARKE_FILTER);
  assert.ok(res, "под чужой размер подсказка есть");
  assert.equal(res.lead, "Артикул есть в каталоге, но скрыт фильтром по числу модулей.",
    "совместимая накладка → разбор дошёл до числа модулей");
  assert.equal(res.note, EPCatalog.moduleWord(2), "названа реальная модульность (2)");
  assert.equal(res.actionLabel, `Переключить на ${EPCatalog.moduleWord(2)}`, "совместимой накладке «Переключить» даётся");
});

test("К8г-А: отбор ПУСТ (старый проект без отделки) — разбор идёт по числу модулей", () => {
  // placementFits(item,{}) === true (ничем не сужено) → ветка несовместимости НЕ срабатывает.
  const res = makeFn()(PLANA_ONLY.code, 3, frameSelect, {});
  assert.ok(res);
  assert.equal(res.lead, "Артикул есть в каталоге, но скрыт фильтром по числу модулей.",
    "отбора нет → любая накладка совместима, разбор доходит до числа модулей");
  assert.equal(res.actionLabel, `Переключить на ${EPCatalog.moduleWord(2)}`, "ветка модулей даёт «Переключить»");
});

test("К8г-А: несуществующего артикула нет — null", () => {
  assert.equal(makeFn()("нет-такого-артикула", 2, frameSelect, ARKE_FILTER), null);
});

/* --- ЧАСТЬ Б: проводка resolveMissing из renderBuilder --------------------------------------- */
function builderCtx(state, dom, captured) {
  const byKind = kind => state.products.filter(x => x.kind === kind && x.active);
  return {
    state, product, byKind, frameProduct: id => product(id), $: dom.$,
    frameSlotCount: EPCatalog.frameSlotCount,
    mechanismSpan: EPCatalog.mechanismSpan,
    moduleWord: EPCatalog.moduleWord,
    esc: s => String(s == null ? "" : s),
    EPCatalog, EPRoom, EPRoomVariants, EPRoomVariantsUi, EPPostVariant, EPPosts, EPBuilderSlots, EPSeriesMatch,
    productSeries: seriesOf,
    productOptionLabel: i => `[${i.code}] ${i.name}`,
    enhancePicker: (sel, options) => { captured.options = options; },
    changePostSlotCount: () => {}, toast: () => {},
    mechanismModulesTotal: () => 0,
    assembledPostHtml: () => "",
    lightingFor: () => ({}), projectPostsWithBuilder: () => [], builderPostDraft: () => ({ mechanismIds: [] }),
    renderBuilderSlots: () => {}, lightingRowsFor: () => [], retargetBuilderSlot: () => {},
    builderErrorHtml: () => "", renderBuilderCatalog: () => {}, renderBuilderComposition: () => {},
    builderCtx: {}
  };
}
const BUILDER_CUT = ["findByExactCode", "frameFacingLabels", "frameFacingSelectionLabels", "frameCollectionList", "frameFacingList", "frameStandardList",
  "builderFilterRoom", "roomCatalogFilter", "builderRoomFilter", "builderInnardsFilter",
  "collectionFramePool", "frameFacingHintText", "frameOptions", "builderCapacity", "resolveMissingFrame", "renderBuilder"];

function resolveMissingFrom({ collection, count }) {
  const post = { id: "p1", roomId: "r1", mechanismIds: [] };
  const state = {
    products: PRODUCTS,
    posts: [post],
    rooms: [{ id: "r1", name: "Комната", collection }],
    builder: { slots: [], target: { mode: "add" }, editingPlacedId: "p1" }
  };
  const dom = stand.makeDom({ selects: ["postFrameSelect"] });
  dom.$("postFrameSelect").dataset.preferredFrameId = "";   // пустая накладка → ранний выход после enhancePicker
  dom.$("postSlotCount").value = String(count);
  const captured = {};
  const ctx = builderCtx(state, dom, captured);
  stand.run(BUILDER_CUT, ctx)();
  assert.equal(typeof captured.options, "object", "enhancePicker должен быть вызван renderBuilder");
  assert.equal(typeof captured.options.resolveMissing, "function", "resolveMissing обязан быть функцией");
  return captured.options.resolveMissing;
}

test("К8г-Б: renderBuilder передаёт resolveMissing ПОЛНЫЙ отбор варианта — чужой артикул даёт ветку несовместимости", () => {
  // вариант Arke, count=2 (свой размер 14642.01): если бы передавали пустой фильтр, сработала бы ветка
  // модулей (2===2 → null). Результат ветки несовместимости доказывает передачу реального отбора.
  const resolveMissing = resolveMissingFrom({ collection: "Arke", count: 2 });
  const res = resolveMissing(PLANA_ONLY.code);
  assert.ok(res, "resolveMissing по чужому артикулу обязан дать подсказку");
  assert.equal(res.lead, "Артикул есть в каталоге, но не подходит этой комнате.",
    "renderBuilder передал отбор варианта (серия Arke), а не пустой фильтр");
  assert.ok(!("actionLabel" in res), "несовместимой накладке действия не даём");
});
