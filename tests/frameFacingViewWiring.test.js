/* ПОВЕДЕНЧЕСКИЙ тест второго ВИДА отделки («С картинками»): переключатель в свойствах комнаты и
   запись мастера. Главное, что проверяем (§7.1, требование блока): мастер — второй ВИД, а не второе
   правило. Он читает/пишет ТЕ ЖЕ поля комнаты (collection/frameMaterial/frameShape/frameColor), что
   и вид-список, а выбранный ВИД лежит в EPPrefs (привычка человека), не в проекте.

   Исполняем НАСТОЯЩИЙ текст renderProperties/applyFramePicker из app.js в vm (общий стенд), как
   остальные *Wiring-тесты, — копии логики не держим.

   МУТАЦИОННАЯ ТАБЛИЦА (в отчёте):
     frameFacingView всегда "list" (игнорит EPPrefs)              → красит «вид С картинками: кнопка мастера вместо селекторов»;
     applyFramePicker: room[s.prop]=v всегда (убрать `if(v)`)     → красит «Применить пишет заданные признаки» (пустой не снят);
     applyFramePicker: убрать `else delete room[s.prop]`         → красит «Применить СНИМАЕТ пустой признак» (старый цвет остался);
     applyFramePicker без persistProject()                       → красит «Применить сохраняет проект».
   Запуск: node --test tests/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");

const EPRoom = require("../js/room.js");
const EPCatalog = require("../js/catalog.js");
const EPFramePicker = require("../js/framePicker.js");
const EPLightingGroups = require("../js/lightingGroups.js");

/* Обогащённый каталог — как в браузере: catalog-vimar.js → catalog-vimar-attrs.js → data.js (тот же
   порядок, что index.html). Отделка (frameMaterial/frameShape/frameColor) подмешивается data.js;
   сырой catalog-vimar.js её не несёт, поэтому loadVimarCatalog тут не годится. */
const JS_DIR = path.join(__dirname, "..", "js");
const win = {};
const ctx0 = vm.createContext({ window: win, structuredClone });
for (const f of ["catalog-vimar.js", "catalog-vimar-attrs.js", "data.js"]) {
  vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), "utf8"), ctx0, { filename: f });
}
let PRODUCTS;
test("подготовка: обогащённый каталог получен через DataService (как в браузере)", async () => {
  PRODUCTS = await win.DataService.getProducts();
  assert.ok(PRODUCTS.length > 2000, "каталог загружен");
});
const spy = () => { const f = () => { f.calls++; }; f.calls = 0; return f; };

/* --- Вид «С картинками» в свойствах комнаты: кнопка мастера вместо селекторов --- */
function renderRoomView(view, room) {
  const state = { selected: { kind: "room", id: room.id }, rooms: [room], posts: [], products: PRODUCTS, pxPerMeter: 0 };
  const dom = stand.makeDom({ selects: ["roomCollectionSelect", "roomSchemeSelect"] });
  const props = stand.makeElement();
  const ctx = {
    state, props, $: dom.$, esc: String,
    byKind: kind => state.products.filter(x => x.kind === kind && x.active),
    flushRoomDraft: spy(),
    findSelectedEntity: (k, id) => state.rooms.find(r => r.id === id),
    applySelectionClasses: spy(),
    getObjectsInRoom: () => [],
    roomAutoAreaText: () => "",
    polygonAreaPx: () => 0,
    lightingScheme: () => "classic",
    EPLightingGroups, EPRoom, EPCatalog,
    /* EPPrefs отдаёт запрошенный вид — привычка человека; тест доказывает, что renderProperties им
       управляется (а не проектом). */
    EPPrefs: { get: (k, fb) => (k === "frameFacingView" ? view : fb), set: () => {} },
    setTool: spy(),
    persistProject: spy(), renderSummary: spy(), renderAll: spy(),
    mountedRoomId: null
  };
  stand.run(["frameCollectionList", "frameFacingList", "frameFacingView", "renderProperties"], ctx)();
  return props.innerHTML;
}

test("вид «С картинками»: на месте селекторов — кнопка «Подобрать накладку», выбор виден сводкой", () => {
  const html = renderRoomView("pictures", { id: "r1", name: "Гостиная", polygon: null, collection: "Eikon Evo", frameMaterial: "Металл" });
  assert.match(html, /id="roomFramePickerBtn"/, "кнопка мастера есть");
  assert.match(html, /Подобрать накладку/);
  assert.doesNotMatch(html, /id="roomCollectionSelect"/, "селекторов коллекции/отделки в этом виде нет");
  assert.doesNotMatch(html, /id="room_frameMaterialSelect"/);
  /* «Что выбрано в одном виде, видно в другом»: сводка называет действующие серию и материал. */
  assert.match(html, /Eikon Evo/, "сводка показывает серию комнаты");
  assert.match(html, /Металл/, "сводка показывает материал комнаты");
});

test("вид «Списком»: селекторы на месте, кнопки мастера нет — тот же переключатель, другой вид", () => {
  const html = renderRoomView("list", { id: "r1", name: "Гостиная", polygon: null, collection: "Eikon Evo", frameMaterial: "Металл" });
  assert.match(html, /id="roomCollectionSelect"/, "селектор коллекции на месте");
  assert.match(html, /id="room_frameMaterialSelect"/);
  assert.doesNotMatch(html, /id="roomFramePickerBtn"/, "кнопки мастера в виде-списке нет");
});

test("переключатель есть в ОБОИХ видах, активна кнопка текущего вида", () => {
  const pics = renderRoomView("pictures", { id: "r1", name: "К", polygon: null });
  assert.match(pics, /id="roomFacingViewPictures"[^>]*class="room-facing-view-btn active"/, "в виде-картинках активна «С картинками»");
  assert.match(pics, /id="roomFacingViewList" class="room-facing-view-btn"/, "«Списком» не активна");
  const list = renderRoomView("list", { id: "r1", name: "К", polygon: null });
  assert.match(list, /id="roomFacingViewList" class="room-facing-view-btn active"/);
});

/* --- «Применить» пишет ТЕ ЖЕ поля комнаты, что и вид-список --- */
test("applyFramePicker пишет заданные признаки и СНИМАЕТ незаданные — те же поля комнаты", () => {
  const room = { id: "r1", name: "Гостиная", collection: "Старая серия", frameColor: "Чёрный" };
  const dom = stand.makeDom();
  const persistProject = spy(), renderProperties = spy();
  const ctx = {
    framePickerRoomId: "r1",
    framePickerSel: { collection: "Arke", frameMaterial: "Металл" },
    framePickerStep: 2,
    EPFramePicker,
    state: { rooms: [{ id: "r0", name: "Другая" }, room] },
    persistProject, renderProperties,
    $: dom.$
  };
  stand.run(["closeFramePicker", "applyFramePicker"], ctx)();
  assert.equal(room.collection, "Arke", "серия записана в комнату");
  assert.equal(room.frameMaterial, "Металл", "материал записан");
  assert.ok(!("frameColor" in room), "незаданный цвет СНЯТ (delete), а не оставлен старым");
  assert.ok(!("frameShape" in room), "незаданная форма не появилась");
  assert.equal(persistProject.calls, 1, "проект сохранён");
  assert.equal(renderProperties.calls, 1, "карточка перерисована — сводка/селекторы обновятся");
});

test("applyFramePicker бьёт по ВЫДЕЛЕННОЙ комнате мастера, не по первой", () => {
  const decoy = { id: "r0", name: "Другая", collection: "Decoy" };
  const target = { id: "r1", name: "Цель" };
  const dom = stand.makeDom();
  const ctx = {
    framePickerRoomId: "r1", framePickerSel: { collection: "Plana" }, framePickerStep: 0,
    EPFramePicker, state: { rooms: [decoy, target] },
    persistProject: spy(), renderProperties: spy(), $: dom.$
  };
  stand.run(["closeFramePicker", "applyFramePicker"], ctx)();
  assert.equal(target.collection, "Plana", "запись ушла в комнату мастера");
  assert.equal(decoy.collection, "Decoy", "первая комната не тронута");
});
