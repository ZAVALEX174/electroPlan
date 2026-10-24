/* К8б: в заголовке блока «Отделка накладки» (правая панель) и в заголовке окна «Подбор накладки»
   написано, ДЛЯ КАКОЙ КОМНАТЫ идёт выбор, — чтобы человек не принял выбор в боковой панели за
   настройку всего проекта (слова владельца, встреча 15.10). Подпись даёт ОДНА чистая функция
   EPRoomVariantsUi.roomLabel; здесь — и сама функция (имя / пустое → «Комната» / экранирование),
   и ДВЕ связки на НАСТОЯЩЕМ app.js: renderProperties строит заголовок панели через roomLabel,
   openFramePicker пишет им заголовок окна.

   МУТАЦИОННАЯ ТАБЛИЦА (проверено — см. отчёт):
     roomLabel: `|| "Комната"` → `|| ""` (нет фолбэка пустого имени)      → красит §unit-пустое;
     roomLabel: `return esc(name)` → `return name` (нет экранирования)    → красит §unit-экранирование;
     facingTitle: убрать имя (вернуть roomLabel без префикса/имени)       → красит §unit-facingTitle;
     renderProperties: заголовок панели не через facingTitle(r)           → красит §панель;
     flushRoomDraft: не обновлять .room-facing-title после коммита        → красит §панель-переименование;
     openFramePicker: не пишет framePickerTitle (старый текст)            → красит §окно.
   Запуск: node --test tests/roomFacingTitleWiring.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

const EPRoom = require("../js/room.js");
const EPCatalog = require("../js/catalog.js");
const EPLightingGroups = require("../js/lightingGroups.js");
const EPRoomVariants = require("../js/roomVariants.js");
const EPRoomVariantsUi = require("../js/roomVariantsUi.js");

const PRODUCTS = stand.loadVimarCatalog().products;
const spy = () => { const f = () => { f.calls++; }; f.calls = 0; return f; };

/* --- Чистая функция подписи ----------------------------------------------------------------- */

test("§unit-имя: roomLabel отдаёт текущее имя комнаты", () => {
  assert.equal(EPRoomVariantsUi.roomLabel({ name: "Кухня" }), "Кухня");
  assert.equal(EPRoomVariantsUi.roomLabel({ name: "  Спальня  " }), "Спальня", "имя тримится, как при сохранении");
});

test("§unit-пустое: пустое/отсутствующее имя → «Комната» (как saveRoom/EPRoomDraft)", () => {
  assert.equal(EPRoomVariantsUi.roomLabel({ name: "" }), "Комната");
  assert.equal(EPRoomVariantsUi.roomLabel({ name: "   " }), "Комната", "пробелы = пусто");
  assert.equal(EPRoomVariantsUi.roomLabel({}), "Комната", "нет поля name");
  assert.equal(EPRoomVariantsUi.roomLabel(null), "Комната", "нет комнаты");
});

test("§unit-экранирование: спецсимволы имени уходят в HTML только через esc", () => {
  assert.equal(EPRoomVariantsUi.roomLabel({ name: '<b>&"' }), "&lt;b&gt;&amp;&quot;",
    "имя комнаты — пользовательский ввод, в разметку заголовка только экранированным");
});

test("§unit-facingTitle: полный заголовок блока — «Отделка накладки — <комната>» через roomLabel", () => {
  assert.equal(EPRoomVariantsUi.facingTitle({ name: "Кухня" }), "Отделка накладки — Кухня");
  assert.equal(EPRoomVariantsUi.facingTitle({ name: "" }), "Отделка накладки — Комната", "пустое имя — тот же фолбэк");
  assert.equal(EPRoomVariantsUi.facingTitle({ name: "<b>" }), "Отделка накладки — &lt;b&gt;", "имя экранировано");
});

/* --- Связка 1: заголовок блока отделки в панели свойств (настоящий renderProperties) --------- */

function renderRoom(room) {
  EPRoomVariantsUi.setActiveIndex(room.id, 0);
  const state = { selected: { kind: "room", id: room.id }, rooms: [room], posts: [], products: PRODUCTS, pxPerMeter: 0 };
  const dom = stand.makeDom({ selects: ["roomStandardSelect", "roomCollectionSelect", "roomSchemeSelect", "room_frameMaterialSelect", "room_frameShapeSelect", "room_frameColorSelect"] });
  const props = stand.makeElement();
  const ctx = {
    state, props, $: dom.$, esc: String,
    byKind: kind => state.products.filter(x => x.kind === kind && x.active),
    flushRoomDraft: spy(), updateSelectionCount: () => {}, renderTemplates: () => {},
    findSelectedEntity: (k, id) => state.rooms.find(r => r.id === id),
    applySelectionClasses: spy(), getObjectsInRoom: () => [], roomAutoAreaText: () => "",
    polygonAreaPx: () => 0, lightingScheme: () => "classic",
    EPLightingGroups, EPRoom, EPCatalog, EPRoomWalls: require("../js/roomWalls.js"),
    EPRoomVariants, EPRoomVariantsUi,
    EPPrefs: { get: (k, fb) => fb, set: () => {} },
    setTool: spy(), persistProject: spy(), renderSummary: spy(), renderAll: spy(), mountedRoomId: null
  };
  stand.run(["frameCollectionList", "frameFacingList", "frameStandardList", "frameFacingView", "renderProperties"], ctx)();
  return props;
}

test("§панель: заголовок блока отделки назван комнатой — «Отделка накладки — Кухня»", () => {
  const props = renderRoom({ id: "p1", name: "Кухня", polygon: null, collection: "Arke" });
  assert.match(props.innerHTML, /room-facing-title">Отделка накладки — Кухня</,
    "заголовок панели показывает имя выделенной комнаты");
});

test("§панель-пустое: без имени — «Отделка накладки — Комната»", () => {
  const props = renderRoom({ id: "p2", name: "", polygon: null });
  assert.match(props.innerHTML, /room-facing-title">Отделка накладки — Комната</);
});

/* Переименование через НАСТОЯЩИЙ обработчик поля «Название комнаты»: renderProperties привязывает
   onblur=commitRoomFields→flushRoomDraft, тот коммитит имя и ТОЧЕЧНО обновляет заголовок блока отделки
   (как updateRoomLabelText — подпись на холсте), без перерисовки панели. props-шим отдаёт узел
   .room-facing-title по querySelector (innerHTML панели — строка, шим её не парсит). */
function renameRoomLive(room, newName) {
  EPRoomVariantsUi.setActiveIndex(room.id, 0);
  const state = { selected: { kind: "room", id: room.id }, rooms: [room], posts: [], products: PRODUCTS, pxPerMeter: 0 };
  const dom = stand.makeDom({ selects: ["roomStandardSelect", "roomCollectionSelect", "roomSchemeSelect", "room_frameMaterialSelect", "room_frameShapeSelect", "room_frameColorSelect"] });
  const titleNode = stand.makeElement();
  titleNode.innerHTML = EPRoomVariantsUi.facingTitle(room);   /* исходный заголовок, как после рендера */
  const props = Object.assign(stand.makeElement(), { querySelector: sel => sel === ".room-facing-title" ? titleNode : null });
  const ctx = {
    state, props, $: dom.$, esc: String,
    byKind: kind => state.products.filter(x => x.kind === kind && x.active),
    updateRoomLabelText: spy(), persistProject: spy(),   /* flushRoomDraft НАСТОЯЩИЙ — spy'ем лишь его соседей */
    EPRoomDraft: require("../js/roomDraft.js"),
    updateSelectionCount: () => {}, renderTemplates: () => {},
    findSelectedEntity: (k, id) => state.rooms.find(r => r.id === id),
    applySelectionClasses: spy(), getObjectsInRoom: () => [], roomAutoAreaText: () => "",
    polygonAreaPx: () => 0, lightingScheme: () => "classic",
    EPLightingGroups, EPRoom, EPCatalog, EPRoomWalls: require("../js/roomWalls.js"),
    EPRoomVariants, EPRoomVariantsUi,
    EPPrefs: { get: (k, fb) => fb, set: () => {} },
    setTool: spy(), renderSummary: spy(), renderAll: spy(), mountedRoomId: null
  };
  /* flushRoomDraft перед renderProperties: хойстинг function-деклараций позволяет renderProperties её
     звать, а stand.run исполняет ПОСЛЕДНЮЮ в списке — нам нужен renderProperties (он привязывает onblur). */
  stand.run(["frameCollectionList", "frameFacingList", "frameStandardList", "frameFacingView", "flushRoomDraft", "renderProperties"], ctx)();
  dom.els.roomName.value = newName;
  dom.els.roomName.onblur();   /* тот же обработчик, что blur и Enter (commitRoomFields) */
  return { titleNode, room, persist: ctx.persistProject };
}

test("§панель-переименование: ввели новое имя и ушли из поля — заголовок блока отделки сразу с новым именем", () => {
  const { titleNode, room, persist } = renameRoomLive({ id: "r1", name: "Помещение 2", polygon: null, collection: "Arke" }, "Спальня");
  assert.equal(room.name, "Спальня", "имя закоммичено в комнату");
  assert.equal(titleNode.innerHTML, "Отделка накладки — Спальня", "заголовок панели обновлён на новое имя без перерисовки");
  assert.equal(persist.calls, 1, "проект сохранён (как было)");
});

test("§панель-переименование-пустое: очистили имя — заголовок «Отделка накладки — Комната»", () => {
  const { titleNode } = renameRoomLive({ id: "r2", name: "Кухня", polygon: null }, "   ");
  assert.equal(titleNode.innerHTML, "Отделка накладки — Комната");
});

/* --- Связка 2: заголовок окна «Подбор накладки» (настоящий openFramePicker) ------------------- */

function openPicker(room) {
  const dom = stand.makeDom();
  const ctx = {
    $: dom.$,
    EPRoomVariants: { list: () => [{}] },
    EPRoomVariantsUi,
    EPRoom: { roomFrameFacing: () => null, roomCollection: () => null },
    frameStandardList: () => [], frameCollectionList: () => [], frameFacingList: () => [],
    EPFramePicker: { STEPS: [{ prop: "standard" }, { prop: "collection" }, { prop: "frameMaterial" }, { prop: "frameShape" }, { prop: "frameColor" }] },
    renderFramePicker: spy(), setTimeout: () => {},
    framePickerRoomId: null, framePickerSel: null, framePickerStep: 0
  };
  stand.run("openFramePicker", ctx)(room);
  return dom.els.framePickerTitle;
}

test("§окно: заголовок окна подбора назван комнатой — «Подбор накладки — Кухня»", () => {
  const title = openPicker({ id: "f1", name: "Кухня" });
  assert.equal(title.innerHTML, "Подбор накладки — Кухня");
});

test("§окно-пустое: без имени — «Подбор накладки — Комната»", () => {
  const title = openPicker({ id: "f2", name: "" });
  assert.equal(title.innerHTML, "Подбор накладки — Комната");
});

test("§окно-экранирование: спецсимволы имени экранированы в заголовке окна", () => {
  const title = openPicker({ id: "f3", name: "<b>" });
  assert.equal(title.innerHTML, "Подбор накладки — &lt;b&gt;");
});
