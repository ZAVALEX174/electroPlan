/* ОРИЕНТАЦИЯ НАКЛАДКИ СОХРАНЯЕТСЯ ПРИ АВТО-ПОДБОРЕ/ПОДМЕНЕ (Б8, часть 2). Проверяем ПОВЕДЕНЧЕСКИ,
   на НАСТОЯЩЕМ каталоге VIMAR и НАСТОЯЩИХ функциях (vm-вырезки через tests/helpers/appStand.js),
   что у поста с отметкой «Расположить вертикально» результат во ВСЕХ местах, где программа сама
   выбирает/подменяет накладку, приводится к ВЕРТИКАЛЬНОМУ двойнику нужной отделки, а у поста без
   отметки — к горизонтальному (как было). Правило — одна функция EPFrameOrientation.oriented.

   Три места встраивания (каждое — своя мутация в отчёте):
     1) applyAutoDefaultFrame (postBuilder.js) — нетронутый пост (frameAuto), смена числа модулей/комнаты;
     2) changePostSlotCount (postBuilder.js) — пост С ОТМЕТКОЙ при РУЧНОЙ накладке (frameAuto=false);
     3) frameForRoomPlacement (postVariant.js) — размещение шаблона и вставка копии в комнату.
   Запуск: node --test tests/ */
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
const EPPostVariant = require("../js/postVariant.js");
const EPPosts = require("../js/posts.js");
const EPFrameOrientation = require("../js/frameOrientation.js");

/* Обогащённый каталог — те же три файла и порядок, что index.html (у LINEA цвет/серию дописывает
   DataService из номенклатуры: в сыром catalog-vimar.js frameColor нет). */
function loadEnrichedProducts() {
  const win = {};
  const context = vm.createContext({ window: win, structuredClone });
  for (const file of ["catalog-vimar.js", "catalog-vimar-attrs.js", "data.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", file), "utf8"), context, { filename: file });
  }
  return win.EP_DATA.products;
}
const PRODUCTS = loadEnrichedProducts();
const product = id => PRODUCTS.find(p => Number(p.id) === Number(id));
const byCode = code => PRODUCTS.find(p => String(p.code) === String(code));
const byKind = kind => PRODUCTS.filter(p => p.kind === kind && p.active);
const frames = byKind("frame");

/* Предпосылки каталога (перезалив прайса уронит осмысленно, числа не хардкодим «вслепую»). */
const H4 = byCode("30643.01"), H6 = byCode("30644.01"), V4 = byCode("30645.01"), V6 = byCode("30646.01");
assert.ok(H4 && H6 && V4 && V6, "предпосылка: LINEA 30643/30644/30645/30646 .01 (конопляная) есть в каталоге");
assert.equal(EPCatalog.frameSlotCount(H4), 4); assert.equal(EPCatalog.frameSlotCount(H6), 6);
assert.equal(EPCatalog.frameSlotCount(V4), 4); assert.equal(EPCatalog.frameSlotCount(V6), 6);
assert.equal(EPFrameOrientation.verticalOf(H6, frames).code, "30646.01", "предпосылка: вертикальный двойник 30644.01 — 30646.01");
assert.equal(EPFrameOrientation.verticalOf(H4, frames).code, "30645.01", "предпосылка: вертикальный двойник 30643.01 — 30645.01");

const LINEA_HEMP = () => ({ id: "rLinea", name: "Гостиная", collection: "Linea", frameColor: "Конопляная" });
const LINEA_MECH = 202971;   // 30000, 1 модуль, серия Linea — заполняет накладку (без начинки подмена не «full»)
const FILL4 = [LINEA_MECH, LINEA_MECH, LINEA_MECH, LINEA_MECH];   // 4 модуля на накладку 4М

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   1. БУ́ДЕР: смена числа модулей.
   applyAutoDefaultFrame — для нетронутого поста (frameAuto). Прогоняем НАСТОЯЩИЙ changePostSlotCount.
   ───────────────────────────────────────────────────────────────────────────────────────────── */
function runChangeSlot({ frameAuto, verticalFrame, count, currentFrameId, name = "Пост на 4 модуля" }) {
  const dom = stand.makeDom({ selects: ["postFrameSelect", "postSlotCount"] });
  dom.$("postName").value = name;
  dom.$("postSlotCount").innerHTML = `<option value="${count}">${count}</option>`;
  dom.$("postSlotCount").value = String(count);
  if (currentFrameId != null) {
    dom.$("postFrameSelect").innerHTML = `<option value="${currentFrameId}">f</option>`;
    dom.$("postFrameSelect").value = String(currentFrameId);
  }
  const room = LINEA_HEMP();
  const state = { products: PRODUCTS, posts: [], rooms: [room],
    builder: { roomId: room.id, variantIndex: 0, editingPlacedId: null, frameAuto, verticalFrame } };
  const ctx = {
    state, $: dom.$, byKind,
    frameSlotCount: EPCatalog.frameSlotCount, frameProduct: product, productSeries: EPCatalog.productSeries,
    EPCatalog, EPRoom, EPRoomVariants, EPRoomVariantsUi, EPPostVariant, EPFrameOrientation,
    esc: s => String(s == null ? "" : s), defaultPostName: EPCatalog.defaultPostName, renderBuilder: () => {}
  };
  stand.run(["frameCollectionList", "frameFacingList", "frameStandardList", "builderFilterRoom", "roomCatalogFilter",
    "ordinaryFrame", "nearestToThreeFrame", "pickDefaultFrame", "preferOwnFrame", "ownFrameCriteria",
    "defaultFrameForRoom", "applyAutoDefaultFrame", "isAutoPostName", "syncAutoPostName", "changePostSlotCount"], ctx)();
  return dom.$("postFrameSelect").dataset.preferredFrameId;
}

test("★ место 1 (applyAutoDefaultFrame): нетронутый пост С ОТМЕТКОЙ, 4→6 → вертикальная 30646.01", () => {
  const chosen = runChangeSlot({ frameAuto: true, verticalFrame: true, count: 6, currentFrameId: V4.id });
  assert.equal(chosen, String(V6.id),
    "под 6 модулей взят ВЕРТИКАЛЬНЫЙ двойник 30646.01 (мутация «убрать oriented в applyAutoDefaultFrame» дала бы горизонтальную 30644.01)");
});

test("★ место 1: нетронутый пост БЕЗ отметки, 4→6 → горизонтальная 30644.01 (как было)", () => {
  const chosen = runChangeSlot({ frameAuto: true, verticalFrame: false, count: 6, currentFrameId: H4.id });
  assert.equal(chosen, String(H6.id), "без отметки — горизонтальная (первая в каталоге); ориентация не навязана");
});

test("★ место 2 (changePostSlotCount, РУЧНАЯ накладка frameAuto=false): пост С ОТМЕТКОЙ, 4→6 → 30646.01", () => {
  /* Так выглядит РЕАЛЬНЫЙ UI: накладку выбрали РУКАМИ в поле (это сняло frameAuto — отметка frameAuto НЕ
     трогает, решение владельца 09.11), а отметка «Расположить вертикально» стоит. applyAutoDefaultFrame
     тут no-op — ориентацию держит отдельная ветка changePostSlotCount. */
  const chosen = runChangeSlot({ frameAuto: false, verticalFrame: true, count: 6, currentFrameId: V4.id });
  assert.equal(chosen, String(V6.id),
    "ручная вертикальная 30645.01 при 4→6 стала 30646.01 (мутация «убрать ветку hasPair в changePostSlotCount» оставила бы приклеенной 4М)");
});

test("★ место 2: 6→4 у поста с отметкой → 30645.01 (симметрично)", () => {
  const chosen = runChangeSlot({ frameAuto: false, verticalFrame: true, count: 4, currentFrameId: V6.id, name: "Пост на 6 модулей" });
  assert.equal(chosen, String(V4.id), "6→4 у вертикального поста даёт вертикальную 4М (30645.01)");
});

test("место 2: ручная накладка БЕЗ пары (не-LINEA) смену числа модулей не трогает (прежнее поведение)", () => {
  /* Arke 09662.01 (2М, без вертикального двойника). frameAuto=false, отметка-флаг хранится, но пары нет
     → ветка не срабатывает, накладку не пере-подбираем (гарантия «ручной выбор не трогаем»). */
  const arke = byCode("09662.01");
  assert.ok(arke, "предпосылка: 09662.01 (Arke) есть");
  assert.equal(EPFrameOrientation.hasPair(arke, frames), false, "предпосылка: у Arke 09662.01 вертикального двойника нет");
  const dom = stand.makeDom({ selects: ["postFrameSelect", "postSlotCount"] });
  dom.$("postName").value = "Кухня — свет";   /* ручное имя не трогаем */
  dom.$("postSlotCount").innerHTML = `<option value="3">3</option>`; dom.$("postSlotCount").value = "3";
  dom.$("postFrameSelect").innerHTML = `<option value="${arke.id}">f</option>`; dom.$("postFrameSelect").value = String(arke.id);
  const room = { id: "r1", name: "Кухня", standard: "DE", collection: "Arke" };
  const state = { products: PRODUCTS, posts: [], rooms: [room],
    builder: { roomId: room.id, variantIndex: 0, editingPlacedId: null, frameAuto: false, verticalFrame: true } };
  const ctx = {
    state, $: dom.$, byKind, frameSlotCount: EPCatalog.frameSlotCount, frameProduct: product, productSeries: EPCatalog.productSeries,
    EPCatalog, EPRoom, EPRoomVariants, EPRoomVariantsUi, EPPostVariant, EPFrameOrientation,
    esc: s => String(s == null ? "" : s), defaultPostName: EPCatalog.defaultPostName, renderBuilder: () => {}
  };
  stand.run(["frameCollectionList", "frameFacingList", "frameStandardList", "builderFilterRoom", "roomCatalogFilter",
    "ordinaryFrame", "nearestToThreeFrame", "pickDefaultFrame", "preferOwnFrame", "ownFrameCriteria",
    "defaultFrameForRoom", "applyAutoDefaultFrame", "isAutoPostName", "syncAutoPostName", "changePostSlotCount"], ctx)();
  assert.ok(!("preferredFrameId" in dom.$("postFrameSelect").dataset),
    "накладку без пары смена числа модулей не пере-подбирает (ручной выбор сохранён)");
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   2. РАЗМЕЩЕНИЕ / КОПИРОВАНИЕ: frameForRoomPlacement (postVariant.js) подменяет накладку под комнату.
   У поста/копии с отметкой подмена даёт ВЕРТИКАЛЬНУЮ накладку нужного цвета.
   ───────────────────────────────────────────────────────────────────────────────────────────── */
const PLACE_CUT = ["frameCollectionList", "frameFacingList", "frameStandardList", "frameFacingLabels", "frameFacingSelectionLabels",
  "templateMechSeries", "frameSwapEmptyText", "roomCatalogFilter", "frameFitsTemplateMechs", "placementFits", "preferOwnFrame", "frameForRoomPlacement"];

function placeFrame(template, room) {
  const ctx = {
    EPCatalog, EPRoom, EPPosts, EPRoomVariants, EPFrameOrientation,
    byKind, frameProduct: product, product, compatibleMechanisms: EPCatalog.compatibleMechanisms,
    productSeries: EPCatalog.productSeries, frameSlotCount: EPCatalog.frameSlotCount,
    moduleWord: EPCatalog.moduleWord, mechanismSpan: EPCatalog.mechanismSpan,
    esc: s => String(s == null ? "" : s)
  };
  return stand.run(PLACE_CUT, ctx)(template, room);
}

test("★ место 3 (frameForRoomPlacement): вертикальный шаблон 30645.00 (флаг) в комнату LINEA «конопляная» → 30645.01", () => {
  const tpl = { id: "t", name: "Вертикальный", frameId: byCode("30645.00").id, frameColor: "Белая", mechanismIds: FILL4, verticalLayout: true };
  const swap = placeFrame(tpl, LINEA_HEMP());
  assert.equal(swap.frameId, V4.id,
    "подмена под конопляную комнату дала ВЕРТИКАЛЬНУЮ 30645.01 (мутация «убрать oriented в frameForRoomPlacement» дала бы горизонтальную 30643.01)");
});

test("★ место 3: горизонтальный шаблон 30643.00 (без флага) в ту же комнату → 30643.01 (как было)", () => {
  const tpl = { id: "t", name: "Обычный", frameId: byCode("30643.00").id, frameColor: "Белая", mechanismIds: FILL4 };
  const swap = placeFrame(tpl, LINEA_HEMP());
  assert.equal(swap.frameId, H4.id, "без флага — горизонтальная конопляная 30643.01");
});

test("★ место 3: КОПИЯ поста с флагом в комнату другого цвета → вертикальная нужного цвета", () => {
  /* Копия — глубокая, несёт frameId вертикальной 30645.01 (конопляная) И флаг verticalLayout. Кладём в
     БЕЛУЮ LINEA-комнату: подмена под белую должна дать ВЕРТИКАЛЬНУЮ белую 30645.00. */
  const copy = { id: "c", name: "Копия", frameId: V4.id, frameColor: "Конопляная", mechanismIds: FILL4, verticalLayout: true };
  const whiteRoom = { id: "rW", name: "Спальня", collection: "Linea", frameColor: "Белая" };
  const swap = placeFrame(copy, whiteRoom);
  assert.equal(swap.frameId, byCode("30645.00").id, "копия с флагом в белой комнате получила вертикальную белую 30645.00");
});

test("место 3: накладка подходит варианту комнаты → подмены нет, вертикальность сохранена", () => {
  /* Вертикальная 30645.01 (конопляная) в конопляную комнату — уже подходит, подмены нет; остаётся
     вертикальной (frameId:null = «не трогаем»). */
  const tpl = { id: "t", name: "В", frameId: V4.id, frameColor: "Конопляная", mechanismIds: FILL4, verticalLayout: true };
  const swap = placeFrame(tpl, LINEA_HEMP());
  assert.equal(swap.frameId, null, "накладка годна комнате → не трогаем (осталась вертикальной 30645.01)");
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   4. ИНТЕГРАЦИЯ ОТМЕТКА→СМЕНА КОМНАТЫ (решение владельца 09.11): отметка — НЕ ручной выбор накладки,
   поэтому не снимает frameAuto; у нового поста с отметкой смена комнаты даёт вертикальный двойник
   ЦВЕТА НОВОЙ комнаты (через applyAutoDefaultFrame, место 1). Прогоняем НАСТОЯЩИЕ toggleFrameOrientation
   (ч.1) + changeBuilderRoom цепочкой на общих state/dom.
   ───────────────────────────────────────────────────────────────────────────────────────────── */
const ROOM_W = () => ({ id: "rW", name: "Белая", collection: "Linea", frameColor: "Белая" });
const ROOM_H = () => ({ id: "rH", name: "Конопляная", collection: "Linea", frameColor: "Конопляная" });
const CBR_CUT = ["frameCollectionList", "frameFacingList", "frameStandardList", "builderFilterRoom", "roomCatalogFilter",
  "builderRoomFilter", "collectionFramePool", "ordinaryFrame", "nearestToThreeFrame", "pickDefaultFrame",
  "preferOwnFrame", "ownFrameCriteria", "defaultFrameForRoom", "applyAutoDefaultFrame", "renderPostSlotCountSelect",
  "isAutoPostName", "syncAutoPostName", "changeBuilderRoom"];

function makeBuilderCtx(state, dom) {
  return {
    state, $: dom.$, byKind, frameSlotCount: EPCatalog.frameSlotCount, frameProduct: product,
    productSeries: EPCatalog.productSeries, frameSlotOptions: EPCatalog.frameSlotOptions,
    EPCatalog, EPRoom, EPRoomVariants, EPRoomVariantsUi, EPPostVariant, EPFrameOrientation,
    esc: s => String(s == null ? "" : s), defaultPostName: EPCatalog.defaultPostName,
    renderBuilder: () => {}, builderCapacity: () => Number(dom.$("postSlotCount").value) || 4
  };
}
/* Новый пост в белой LINEA-комнате; frame — её дефолт (горизонтальная белая 30643.00). frameAuto=true. */
function freshLineaBuilder({ frameAuto = true, startFrameCode = "30643.00" }) {
  const dom = stand.makeDom({ selects: ["postFrameSelect", "postSlotCount", "builderRoomSelect"] });
  const start = byCode(startFrameCode);
  dom.$("postFrameSelect").innerHTML = `<option value="${start.id}">f</option>`;
  dom.$("postFrameSelect").value = String(start.id);
  dom.$("postSlotCount").innerHTML = `<option value="4">4</option>`; dom.$("postSlotCount").value = "4";
  dom.$("postName").value = "Пост на 4 модуля";
  const state = { products: PRODUCTS, posts: [], rooms: [ROOM_W(), ROOM_H()],
    builder: { roomId: "rW", variantIndex: 0, editingPlacedId: null, frameAuto, verticalFrame: false } };
  return { dom, state };
}

test("★ владелец 09.11: новый пост С ОТМЕТКОЙ, смена комнаты белая→конопляная → вертикальная ТОГО цвета 30645.01", () => {
  const { dom, state } = freshLineaBuilder({});
  const ctx = makeBuilderCtx(state, dom);
  stand.run("toggleFrameOrientation", ctx)(true);         // поставили отметку
  stand.run(CBR_CUT, ctx)("rH");                           // сменили комнату на конопляную
  assert.equal(dom.$("postFrameSelect").dataset.preferredFrameId, String(V4.id),
    "смена комнаты у отмеченного поста дала вертикальную КОНОПЛЯНУЮ 30645.01 (мутация «вернуть frameAuto=false в toggleFrameOrientation» оставила бы белую 30645.00)");
});

test("★ владелец 09.11: новый пост БЕЗ отметки, смена комнаты → прежний дефолт п.2 (ближайшая к 3, НЕ вертикальная)", () => {
  /* Пост без отметки — поведение п.2 НЕ меняем: смена комнаты даёт дефолт новой комнаты, ближайший к 3
     (у LINEA конопляной это 3М 30653.01), а НЕ сохраняет модульность. Ориентация не навязана. Отличие от
     отмеченного поста (ниже) — тот держит модульность, иначе вертикальный двойник (есть лишь на 4/6М) был
     бы потерян. */
  const NEAREST3 = byCode("30653.01");
  assert.equal(EPFrameOrientation.hasPair(NEAREST3, frames), false, "предпосылка: у 30653.01 (3М) вертикального двойника нет");
  const { dom, state } = freshLineaBuilder({});
  const ctx = makeBuilderCtx(state, dom);
  stand.run(CBR_CUT, ctx)("rH");
  assert.equal(dom.$("postFrameSelect").dataset.preferredFrameId, String(NEAREST3.id),
    "без отметки — ближайшая к 3 обычная накладка новой комнаты (п.2), не вертикальная");
});

test("★ отметка НЕ снимает frameAuto (не ручной выбор): после отметки и снятия frameAuto как до клика", () => {
  const { dom, state } = freshLineaBuilder({});
  const ctx = makeBuilderCtx(state, dom);
  const toggle = stand.run("toggleFrameOrientation", ctx);
  toggle(true);
  assert.equal(state.builder.frameAuto, true, "отметка меняет только ориентацию той же накладки — frameAuto не трогаем");
  toggle(false);
  assert.equal(state.builder.frameAuto, true, "снятие отметки тоже не трогает frameAuto");
});

test("ручной выбор накладки в поле (frameAuto=false) + смена комнаты → накладку НЕ меняем (как было)", () => {
  /* frameAuto уже снят ручным onchange поля (не отметкой). Смена комнаты не пере-подбирает — место 1 no-op. */
  const { dom, state } = freshLineaBuilder({ frameAuto: false });
  const ctx = makeBuilderCtx(state, dom);
  stand.run(CBR_CUT, ctx)("rH");
  assert.ok(!("preferredFrameId" in dom.$("postFrameSelect").dataset),
    "ручную накладку смена комнаты не трогает (ручной выбор в поле главнее — отличается от отметки)");
});

test("★ место 3: НЕ-LINEA с флагом — подмена даёт ту же накладку, что и без флага (oriented возвращает её же)", () => {
  /* Arke: вертикальных двойников нет. Пост с флагом размещаем в комнату Arke другого цвета — подмена идёт
     как обычно (19641.01 Графит → 19641.04 Титан), ориентация ничего не меняет. Сравниваем с тем же
     постом без флага. */
  const base = { id: "t", name: "Arke", frameId: byCode("19641.01").id, mechanismIds: [200703] };   // 19001.0, 1М Arke
  const room = { id: "rA", name: "Холл", standard: "IT", collection: "Arke", frameColor: "Титан Матовый" };
  const withFlag = placeFrame(Object.assign({}, base, { verticalLayout: true }), room);
  const noFlag = placeFrame(Object.assign({}, base), room);
  assert.equal(withFlag.frameId, byCode("19641.04").id, "предпосылка: подмена Arke под «Титан» дала 19641.04");
  assert.equal(withFlag.frameId, noFlag.frameId, "у не-LINEA флаг на подмену не влияет (двойника нет → та же накладка)");
});
