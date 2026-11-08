/* ПОВЕДЕНЧЕСКИЙ тест В27: в свойствах комнаты значение отделки, которое есть ТОЛЬКО у снятых с
   производства накладок, показывается ВЫБРАННЫМ с пометкой «снят/снята с производства» и подсказкой
   выбрать другое, а НЕ «Не задан». Подбор при этом не меняется (критерий по снятому значению — null).

   Исполняем НАСТОЯЩИЙ renderProperties из app.js в vm на НАСТОЯЩЕМ каталоге VIMAR, обогащённом data.js
   вместе со снятыми позициями (catalog-vimar.js → …-attrs.js → …-discontinued.js → data.js — тот же путь
   и порядок, что index.html). EPCatalog/EPRoom/EPRoomVariants/EPRoomVariantsUi настоящие: пометку строит
   продакшн-facingFieldOptionsHtml, правило «снято?» — продакшн-EPRoom.discontinuedFacing.

   ЯКОРИ (замерено продакшн-функциями на текущем каталоге):
     frameColor «Reflex лед» — есть у снятых накладок, нет у выпускаемых (32 таких цвета);
     серия «Arke Fit» — только у снятых; «Неведомый цвет» — мусор (ни там, ни там).

   МУТАЦИОННАЯ ТАБЛИЦА (прогнана руками, числа — в отчёте):
     facingFieldOptionsHtml без ветки else-if(off)                          → §color-mark, §coll-mark;
     discontinuedFacing: мусор→снятое (убрать проверку offValues)           → §garbage;
     discontinuedFacing начинает сужать подбор (roomCatalogFilter≠null)     → §filter-unchanged.
   Запуск: node --test tests/roomDiscontinuedFacingWiring.test.js */
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
const EPLightingGroups = require("../js/lightingGroups.js");

/* Обогащённый каталог СО СНЯТЫМИ — как в браузере. */
const JS_DIR = path.join(__dirname, "..", "js");
const win = {};
const ctx0 = vm.createContext({ window: win, structuredClone });
for (const f of ["catalog-vimar.js", "catalog-vimar-attrs.js", "catalog-vimar-discontinued.js", "data.js"]) {
  vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), "utf8"), ctx0, { filename: f });
}
let PRODUCTS;
test("подготовка: обогащённый каталог со снятыми позициями получен (как в браузере)", async () => {
  PRODUCTS = await win.DataService.getProducts();
  assert.ok(PRODUCTS.length > 2000, "каталог загружен");
  assert.ok(PRODUCTS.some(p => p.kind === "frame" && p.active === false), "снятые накладки присутствуют");
});
const byKindOf = k => PRODUCTS.filter(x => x.kind === k && x.active);
const byKindOffOf = k => PRODUCTS.filter(x => x.kind === k && x.active === false);

test("предпосылки якорей: «Reflex лед»/«Arke Fit» только у снятых, «Неведомый цвет» — мусор", () => {
  const activeColors = EPCatalog.productFacingValues(byKindOf("frame"), "frameColor");
  const offColors = EPCatalog.productFacingValues(byKindOffOf("frame"), "frameColor");
  assert.ok(!activeColors.includes("Reflex лед") && offColors.includes("Reflex лед"), "«Reflex лед» снят");
  const activeColl = EPCatalog.productCollections(byKindOf("frame"));
  const offColl = EPCatalog.productCollections(byKindOffOf("frame"));
  assert.ok(!activeColl.includes("Arke Fit") && offColl.includes("Arke Fit"), "серия «Arke Fit» снята");
  assert.ok(!activeColors.includes("Неведомый цвет") && !offColors.includes("Неведомый цвет"), "«Неведомый цвет» — мусор");
});

/* --- Рендер панели свойств комнаты на настоящем renderProperties --- */
const PANEL_CUT = ["frameCollectionList", "frameFacingList", "frameStandardList", "frameFacingView",
  "frameFacingLabels", "frameFacingSelectionLabels", "frameFacingEmptyText", "roomCatalogFilter", "renderProperties"];
function renderPanel(room, view) {
  EPRoomVariantsUi.setActiveIndex(room.id, 0);
  const state = { selected: { kind: "room", id: room.id }, rooms: [room], posts: [], products: PRODUCTS, pxPerMeter: 0 };
  const dom = stand.makeDom({ selects: ["roomStandardSelect", "roomCollectionSelect", "roomSchemeSelect", "room_frameMaterialSelect", "room_frameShapeSelect", "room_frameColorSelect", "room_mechColorSelect"] });
  const props = stand.makeElement();
  const spy = () => { const f = () => { f.calls++; }; f.calls = 0; return f; };
  const ctx = {
    state, props, $: dom.$, esc: String,
    byKind: byKindOf, byKindOff: byKindOffOf, flushRoomDraft: spy(), updateSelectionCount: () => {}, renderTemplates: () => {},
    findSelectedEntity: (k, id) => state.rooms.find(r => r.id === id),
    applySelectionClasses: spy(), getObjectsInRoom: () => [], roomAutoAreaText: () => "",
    polygonAreaPx: () => 0, lightingScheme: () => "classic",
    EPLightingGroups, EPRoom, EPCatalog, EPRoomWalls: require("../js/roomWalls.js"), EPRoomVariants, EPRoomVariantsUi,
    EPPrefs: { get: (k, fb) => (k === "frameFacingView" ? (view || "list") : fb), set: () => {} },
    setTool: spy(), persistProject: spy(), renderSummary: spy(), renderAll: spy(), mountedRoomId: null
  };
  stand.run(PANEL_CUT, ctx)();
  return props.innerHTML;
}
function options(html, id) {
  const m = html.match(new RegExp('<select id="' + id + '">([\\s\\S]*?)</select>'));
  assert.ok(m, "селектор #" + id + " есть");
  return [...m[1].matchAll(/<option value="([^"]*)"([^>]*)>([\s\S]*?)<\/option>/g)]
    .map(o => ({ value: o[1], selected: /selected/.test(o[2]), text: o[3] }));
}
/* small-подсказка СРАЗУ ПОСЛЕ указанного селектора (<label>…<select id>…</select></label><small …>…</small>). */
function hintAfter(html, id) {
  const m = html.match(new RegExp('<select id="' + id + '">[\\s\\S]*?</select></label>\\s*<small class="([^"]*)">([\\s\\S]*?)</small>'));
  assert.ok(m, "подсказка после #" + id + " есть");
  return { cls: m[1], text: m[2] };
}

test("§color-mark: снятый цвет «Reflex лед» — опция ВЫБРАНА с пометкой «снят с производства», подсказка зовёт сменить цвет", () => {
  const html = renderPanel({ id: "r1", name: "Гостиная", polygon: null, frameColor: "Reflex лед" });
  const opts = options(html, "room_frameColorSelect");
  const off = opts.find(o => o.value === "Reflex лед");
  assert.ok(off, "снятый цвет присутствует отдельной опцией");
  assert.match(off.text, /Reflex лед\s*— снят с производства/, "опция несёт пометку «снят с производства»");
  assert.ok(off.selected, "именно снятый цвет остаётся ВЫБРАННЫМ, а не «Не задан»");
  const emptyOpt = opts.find(o => o.value === "");
  assert.ok(emptyOpt && !emptyOpt.selected, "пункт «Не задан» НЕ выбран");
  assert.equal(opts.filter(o => o.selected).length, 1, "выбрана ровно одна опция");
  const hint = hintAfter(html, "room_frameColorSelect");
  assert.match(hint.cls, /discontinued/, "подсказка помечена классом discontinued");
  assert.match(hint.text, /больше не выпускают.*выберите другой цвет/, "подсказка зовёт выбрать другой цвет");
});

test("§color-mark: активный цвет пометки «снят» НЕ несёт (контраст)", () => {
  const activeColor = EPCatalog.productFacingValues(byKindOf("frame"), "frameColor")[0];
  const html = renderPanel({ id: "r1", name: "Гостиная", polygon: null, frameColor: activeColor });
  const opts = options(html, "room_frameColorSelect");
  const cur = opts.find(o => o.value === activeColor && o.selected);
  assert.ok(cur, "активный цвет выбран");
  assert.doesNotMatch(cur.text, /снят с производства/, "у активного цвета пометки нет");
  const hint = hintAfter(html, "room_frameColorSelect");
  assert.doesNotMatch(hint.cls, /discontinued/, "подсказка не помечена discontinued");
});

test("§coll-mark: снятая серия «Arke Fit» — опция ВЫБРАНА с пометкой «снята с производства», подсказка зовёт сменить серию", () => {
  const html = renderPanel({ id: "r1", name: "Гостиная", polygon: null, collection: "Arke Fit" });
  const opts = options(html, "roomCollectionSelect");
  const off = opts.find(o => o.value === "Arke Fit");
  assert.ok(off, "снятая серия присутствует опцией");
  assert.match(off.text, /Arke Fit\s*— снята с производства/, "род слова: серия «снята»");
  assert.ok(off.selected, "снятая серия выбрана, а не «Не задана»");
  const hint = hintAfter(html, "roomCollectionSelect");
  assert.match(hint.cls, /discontinued/, "подсказка помечена discontinued");
  assert.match(hint.text, /выберите другую серию/, "подсказка зовёт выбрать другую серию");
});

test("§garbage: мусорное значение (нет ни у выпускаемых, ни у снятых) → «Не задан», пометки нет", () => {
  const html = renderPanel({ id: "r1", name: "Гостиная", polygon: null, frameColor: "Неведомый цвет" });
  const opts = options(html, "room_frameColorSelect");
  const emptyOpt = opts.find(o => o.value === "");
  assert.ok(emptyOpt && emptyOpt.selected, "выбран пункт «Не задан»");
  assert.ok(!opts.some(o => o.value === "Неведомый цвет"), "мусорного значения в списке нет");
  assert.doesNotMatch(html, /Неведомый цвет/, "мусор нигде не показан");
  const hint = hintAfter(html, "room_frameColorSelect");
  assert.doesNotMatch(hint.cls, /discontinued/, "подсказки «снят с производства» для мусора нет");
});

test("§norm-not-dead: цвет «Латунь Зачищенная Щеткой» (есть выпускаемая «Латунь зачищенная щеткой») НЕ помечается снятым", () => {
  /* Край раунда 2: у снятых накладок написание отличается регистром от выпускаемого того же цвета.
     facingColorKey их склеивает → это живой цвет, в свойствах показываем как до В27 (без пометки). */
  const activeColors = EPCatalog.productFacingValues(byKindOf("frame"), "frameColor");
  const offColors = EPCatalog.productFacingValues(byKindOffOf("frame"), "frameColor");
  assert.ok(activeColors.includes("Латунь зачищенная щеткой"), "предпосылка: выпускаемая «Латунь зачищенная щеткой» есть");
  assert.ok(offColors.includes("Латунь Зачищенная Щеткой"), "предпосылка: снятое написание «Латунь Зачищенная Щеткой» есть");
  const html = renderPanel({ id: "r1", name: "Гостиная", polygon: null, frameColor: "Латунь Зачищенная Щеткой" });
  const opts = options(html, "room_frameColorSelect");
  assert.ok(!opts.some(o => /снят с производства/.test(o.text)), "пометки «снят с производства» нет");
  const emptyOpt = opts.find(o => o.value === "");
  assert.ok(emptyOpt && emptyOpt.selected, "показывается как до В27 — «Не задан» выбран");
  const hint = hintAfter(html, "room_frameColorSelect");
  assert.doesNotMatch(hint.cls, /discontinued/, "подсказка не помечена discontinued");
});

test("§pictures: в виде «С картинками» снятый цвет виден в сводке с пометкой (а не «не задано»)", () => {
  const html = renderPanel({ id: "r1", name: "Гостиная", polygon: null, frameColor: "Reflex лед" }, "pictures");
  assert.ok(!/<select id="room_frameColorSelect">/.test(html), "в виде «С картинками» селекторов нет");
  assert.match(html, /Цвет накладки: Reflex лед\s*— снят с производства/, "сводка показывает снятый цвет с пометкой");
});

/* --- СКРЫТОЕ ПОЛЕ «ФОРМА» со снятым значением (В27, требование #2) ------------------------------
   Правило видимости (visibleFacingProps→EPFramePicker.visibleSteps, К12 ч.1) прячет признак, у
   которого в текущем отборе одно выпускаемое значение. У каталога VIMAR «Форма» такова: активная
   форма одна — «Классическая» (замер: productFacingValues(active,"frameShape")===["Классическая"]),
   «Скруглённая» есть ТОЛЬКО у снятых. Значит без снятого значения селектора «Форма» в панели НЕТ.
   В27: если у комнаты сохранена СНЯТАЯ форма «Скруглённая» — поле показываем ВОПРЕКИ правилу
   видимости, с пометкой и подсказкой (иначе фраза владельца «вы видите это значение» не сбылась бы).
   Мутация: убрать из visibleFacingProps строку `if (offFrames) …set.add(p)` → §shape-reveal краснеет. */
test("предпосылка: активная «Форма» одна («Классическая»), «Скруглённая» — только у снятых", () => {
  assert.deepEqual(EPCatalog.productFacingValues(byKindOf("frame"), "frameShape"), ["Классическая"],
    "выпускаемая форма одна — поэтому поле «Форма» по умолчанию скрыто правилом видимости");
  assert.ok(EPCatalog.productFacingValues(byKindOffOf("frame"), "frameShape").includes("Скруглённая"),
    "«Скруглённая» есть у снятых накладок");
});

test("§shape-hidden: у комнаты без снятой формы селектора «Форма» в панели нет (правило видимости)", () => {
  const html = renderPanel({ id: "r1", name: "Гостиная", polygon: null });
  assert.ok(!/<select id="room_frameShapeSelect">/.test(html),
    "«Форма» с единственным выпускаемым значением скрыта — без снятого значения поля нет");
});

test("§shape-reveal: комната со снятой формой «Скруглённая» — поле «Форма» ПОКАЗАНО, значение выбрано с пометкой, подсказка", () => {
  const html = renderPanel({ id: "r1", name: "Гостиная", polygon: null, frameShape: "Скруглённая" });
  assert.ok(/<select id="room_frameShapeSelect">/.test(html),
    "скрытое правилом видимости поле «Форма» раскрыто, потому что у комнаты снятое значение");
  const opts = options(html, "room_frameShapeSelect");
  const off = opts.find(o => o.value === "Скруглённая");
  assert.ok(off, "снятая форма присутствует отдельной опцией");
  assert.match(off.text, /Скруглённая\s*— снята с производства/, "род слова: форма «снята»");
  assert.ok(off.selected, "именно снятая форма ВЫБРАНА, а не «Не задана»");
  const hint = hintAfter(html, "room_frameShapeSelect");
  assert.match(hint.cls, /discontinued/, "подсказка помечена discontinued");
  assert.match(hint.text, /выберите другую форму/, "подсказка зовёт выбрать другую форму");
});

/* --- Подбор НЕ изменился: критерий по снятому значению остаётся null (главное «нельзя сломать») --- */
test("§filter-unchanged: roomCatalogFilter комнаты со снятым цветом/серией даёт null по этим признакам (как до правки)", () => {
  const rf = stand.run(["frameCollectionList", "frameFacingList", "frameStandardList", "roomCatalogFilter"],
    { state: { products: PRODUCTS }, byKind: byKindOf, EPCatalog, EPRoom });
  const f = rf({ id: "r1", name: "Гостиная", frameColor: "Reflex лед", collection: "Arke Fit" });
  assert.equal(f.frameColor, null, "снятый цвет НЕ сужает подбор — критерий null, отбор накладок как при «не задан»");
  assert.equal(f.collection, null, "снятая серия НЕ сужает подбор — критерий null");
});
