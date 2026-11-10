/* Б8, ПОСЛЕДНИЙ раунд (D1–D3, T). Поведенческие тесты на НАСТОЯЩЕМ каталоге VIMAR и НАСТОЯЩИХ функциях
   (vm-вырезки через tests/helpers/appStand.js):
     D1 frameForRoomPlacement (postVariant.js) — СТАРЫЙ пост/шаблон с вертикальной накладкой РУКАМИ, без
        поля verticalLayout, при размещении остаётся вертикальным (вопрос «вертикален ли пост» решает
        одна функция EPFrameOrientation.isVerticalPost: флаг ИЛИ сама накладка вертикальная);
     D2 changePostSlotCount (postBuilder.js) — ручная вертикальная LINEA-накладка в комнате ЧУЖОЙ серии
        при 4→6 держит СВОЮ серию/отделку (sameFacingAtCount по всему каталогу), а не 6М комнаты;
     D3 changeBuilderRoom (postBuilder.js) — пост на 6М переносят в комнату без 6М-накладок → поле не
        остаётся пустым: обычный дефолт комнаты (ближайший к 3);
     T(а) накладка БЕЗ пары — сохранённая у поста отметка переживает повторное открытие окна.
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

/* Обогащённый каталог — те же три файла и порядок, что index.html (LINEA цвет/серию дописывает DataService). */
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

/* Предпосылки каталога (перезалив прайса уронит осмысленно). */
const H4 = byCode("30643.01"), V4 = byCode("30645.01");
const WV4 = byCode("30645.00"), WV6 = byCode("30646.00");   // белые вертикальные LINEA 4М/6М
assert.ok(H4 && V4 && WV4 && WV6, "предпосылка: LINEA 30643.01/30645.01/30645.00/30646.00 есть");
assert.equal(EPCatalog.frameSlotCount(WV4), 4);
assert.equal(EPCatalog.frameSlotCount(WV6), 6);
assert.ok(EPFrameOrientation.isVertical(WV4) && EPFrameOrientation.isVertical(WV6), "предпосылка: 30645/30646 — вертикальные");

const LINEA_HEMP = () => ({ id: "rLinea", name: "Гостиная", collection: "Linea", frameColor: "Конопляная" });
const LINEA_MECH = 202971;   // 30000, 1 модуль, серия Linea — заполняет накладку
const FILL4 = [LINEA_MECH, LINEA_MECH, LINEA_MECH, LINEA_MECH];

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   D1. frameForRoomPlacement: СТАРЫЙ пост с вертикальной накладкой РУКАМИ, поля verticalLayout НЕТ.
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

test("★ D1: старый пост с вертикальной 30645.00 БЕЗ поля verticalLayout размещают в LINEA «конопляную» → 30645.01 (не 30643.01)", () => {
  /* Пост собран вертикальной накладкой РУКАМИ до Б8: несёт frameId=30645.00, но поля-флага verticalLayout
     нет (сохранён раньше, чем флаг появился). Размещение под конопляную комнату обязано дать ВЕРТИКАЛЬНУЮ
     30645.01, а не горизонтальную 30643.01. На коде ДО правки isVerticalPost брал только флаг → 30643.01. */
  const tpl = { id: "t", name: "Старый вертикальный", frameId: WV4.id, frameColor: "Белая", mechanismIds: FILL4 };
  assert.ok(!("verticalLayout" in tpl), "предпосылка теста: поля verticalLayout у старого поста нет");
  const swap = placeFrame(tpl, LINEA_HEMP());
  assert.equal(swap.frameId, V4.id,
    "вертикальность взята из самой накладки (isVerticalPost) → 30645.01; мутация «вернуть template.verticalLayout===true» дала бы 30643.01");
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   D2. changePostSlotCount: ручная вертикальная LINEA-накладка в комнате ЧУЖОЙ серии (Arke), 4→6.
   ───────────────────────────────────────────────────────────────────────────────────────────── */
const SLOT_CUT = ["frameCollectionList", "frameFacingList", "frameStandardList", "builderFilterRoom", "roomCatalogFilter",
  "ordinaryFrame", "nearestToThreeFrame", "pickDefaultFrame", "preferOwnFrame", "ownFrameCriteria",
  "defaultFrameForRoom", "applyAutoDefaultFrame", "isAutoPostName", "syncAutoPostName", "changePostSlotCount"];
function slotCtx(state, dom) {
  return {
    state, $: dom.$, byKind, frameSlotCount: EPCatalog.frameSlotCount, frameProduct: product, productSeries: EPCatalog.productSeries,
    EPCatalog, EPRoom, EPRoomVariants, EPRoomVariantsUi, EPPostVariant, EPFrameOrientation,
    esc: s => String(s == null ? "" : s), defaultPostName: EPCatalog.defaultPostName, renderBuilder: () => {}
  };
}

test("★ D2: ручная вертикальная LINEA 30645.00 в комнате Arke, 4→6 → 30646.00 (та же серия/отделка, НЕ 6М Arke)", () => {
  const arkeRoom = { id: "rA", name: "Прихожая", standard: "DE", collection: "Arke", frameColor: "Графит матовый" };
  const dom = stand.makeDom({ selects: ["postFrameSelect", "postSlotCount"] });
  dom.$("postName").value = "Пост на 4 модуля";
  dom.$("postSlotCount").innerHTML = `<option value="6">6</option>`; dom.$("postSlotCount").value = "6";
  dom.$("postFrameSelect").innerHTML = `<option value="${WV4.id}">f</option>`; dom.$("postFrameSelect").value = String(WV4.id);
  const state = { products: PRODUCTS, posts: [], rooms: [arkeRoom],
    builder: { roomId: arkeRoom.id, variantIndex: 0, editingPlacedId: null, frameAuto: false, verticalFrame: true } };
  const chosen = (() => { stand.run(SLOT_CUT, slotCtx(state, dom))(); return dom.$("postFrameSelect").dataset.preferredFrameId; })();
  assert.equal(chosen, String(WV6.id),
    "4→6 у ручной LINEA-вертикали дало 30646.00 той же серии/отделки; мутация «defaultFrameForRoom по пулу комнаты» дала бы 6М Arke (19644.*)");
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   D3. changeBuilderRoom: пост на 6М в комнату без 6М-накладок (Eikon Tactil) → поле не пустое.
   ───────────────────────────────────────────────────────────────────────────────────────────── */
const CBR_CUT = ["frameCollectionList", "frameFacingList", "frameStandardList", "builderFilterRoom", "roomCatalogFilter",
  "builderRoomFilter", "collectionFramePool", "ordinaryFrame", "nearestToThreeFrame", "pickDefaultFrame",
  "preferOwnFrame", "ownFrameCriteria", "defaultFrameForRoom", "applyAutoDefaultFrame", "renderPostSlotCountSelect",
  "isAutoPostName", "syncAutoPostName", "changeBuilderRoom"];
function builderCtx(state, dom) {
  return {
    state, $: dom.$, byKind, frameSlotCount: EPCatalog.frameSlotCount, frameProduct: product,
    productSeries: EPCatalog.productSeries, frameSlotOptions: EPCatalog.frameSlotOptions,
    EPCatalog, EPRoom, EPRoomVariants, EPRoomVariantsUi, EPPostVariant, EPFrameOrientation,
    esc: s => String(s == null ? "" : s), defaultPostName: EPCatalog.defaultPostName,
    renderBuilder: () => {}, builderCapacity: () => Number(dom.$("postSlotCount").value) || 4
  };
}

test("★ D3: пост на 6М (30646.00) с отметкой переносят в Eikon Tactil (нет 6М) → поле получает дефолт комнаты, не пусто", () => {
  const EIKON = byCode("21663.33");   // Eikon Tactil «Венге», 3М — ближайшая к 3 в этой комнате
  assert.ok(EIKON, "предпосылка: 21663.33 (Eikon Tactil, Венге, 3М) есть");
  const eikonRoom = { id: "rE", name: "Кабинет", collection: "Eikon Tactil", frameColor: "Венге" };
  const noSix = frames.filter(f => (f.series || []).includes("Eikon Tactil") && f.frameColor === "Венге" && EPCatalog.frameSlotCount(f) === 6);
  assert.equal(noSix.length, 0, "предпосылка: у Eikon Tactil «Венге» 6М-накладки нет");
  const startRoom = { id: "rW", name: "Белая", collection: "Linea", frameColor: "Белая" };
  const dom = stand.makeDom({ selects: ["postFrameSelect", "postSlotCount", "builderRoomSelect"] });
  dom.$("postFrameSelect").innerHTML = `<option value="${WV6.id}">f</option>`; dom.$("postFrameSelect").value = String(WV6.id);
  dom.$("postSlotCount").innerHTML = `<option value="6">6</option>`; dom.$("postSlotCount").value = "6";
  dom.$("postName").value = "Пост на 6 модулей";
  const state = { products: PRODUCTS, posts: [], rooms: [startRoom, eikonRoom],
    builder: { roomId: "rW", variantIndex: 0, editingPlacedId: null, frameAuto: true, verticalFrame: true } };
  stand.run(CBR_CUT, builderCtx(state, dom))("rE");
  assert.equal(dom.$("postFrameSelect").dataset.preferredFrameId, String(EIKON.id),
    "6М-подбор дал null → фолбэк на дефолт комнаты (21663.33); мутация «без фолбэка applyAutoDefaultFrame(null,null)» оставила бы поле пустым");
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   T(а). Накладка БЕЗ пары (не-LINEA): сохранённая у поста отметка переживает повторное открытие окна.
   ───────────────────────────────────────────────────────────────────────────────────────────── */
test("★ T(а): отметка на накладке БЕЗ пары (Arke 09662.01), сохранённая у поста, стоит после повторного открытия окна", () => {
  const arke = byCode("09662.01");
  assert.ok(arke, "предпосылка: 09662.01 (Arke) есть");
  assert.equal(EPFrameOrientation.hasPair(arke, frames), false, "предпосылка: у Arke 09662.01 вертикального двойника нет");
  /* «Сохранили пост с отметкой» — savePostBuilder кладёт verticalLayout:!!verticalFrame. */
  const savedPost = { frameId: arke.id, verticalLayout: true };
  const dom = stand.makeDom();
  /* «Открыли окно заново» — openPostBuilder читает флаг у поста, renderBuilder зовёт renderFrameOrientation,
     которая решает состояние отметки (checkboxChecked). Прогоняем обе НАСТОЯЩИЕ строки. */
  const state = { products: PRODUCTS, posts: [], rooms: [],
    builder: { roomId: null, verticalFrame: !!savedPost.verticalLayout } };
  const ctx = { state, $: dom.$, byKind, EPFrameOrientation };
  stand.run(["renderFrameOrientation"], ctx)(product(savedPost.frameId), frames);
  assert.equal(dom.$("verticalFrameCheck").checked, true,
    "сохранённая отметка на накладке без пары видна при повторном открытии; мутация checkboxChecked «всегда isVertical» погасила бы её");
  assert.equal(state.builder.verticalFrame, true, "флаг черновика сохранён (уйдёт обратно в пост при следующем сохранении)");
});
