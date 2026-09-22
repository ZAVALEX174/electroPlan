/* ПОВЕДЕНЧЕСКИЙ тест монтажного СТАНДАРТА комнаты (встреча 24.08 §4.1: «первое, что должны мы
   выбрать»). Проверяем связку app.js на НАСТОЯЩЕМ каталоге VIMAR (тот же путь и порядок, что
   index.html: catalog-vimar.js → catalog-vimar-attrs.js → data.js), EPCatalog/EPRoom настоящие:

     1) стандарт — такой же критерий комнаты, как коллекция/отделка: roomCatalogFilter несёт его,
        collectionFramePool сужает им пул ТЕМ ЖЕ productsForRoom (§7.1), «универсальные» (BOTH)
        остаются под любой выбор;
     2) ОБА ВИДА читают и пишут ОДНУ настройку room.standard: вид-список рисует селектор «Стандарт
        монтажа» (человеку — «итальянский»/«немецкий»), читает выбранное и пишет по change; мастер
        сеет тот же room.standard на открытии и пишет его на «Применить»;
     3) старый проект без room.standard / мёртвое значение → фильтра нет (выдача как раньше).

   МУТАЦИОННАЯ ТАБЛИЦА (в отчёте):
     roomCatalogFilter без ключа standard              → красит §filter, §pool-de, §pool-it;
     productsForRoom без предиката c.standard          → красит §pool-de, §pool-it (стандарт перестал сужать);
     roomFrameFacing(room,"standard",vals)→…без vals   → красит §dead (мёртвый стандарт стал бы фильтром);
     список-вид без селектора roomStandardSelect       → красит §list-render, §list-write;
     openFramePicker без сева sel.standard             → красит §picker-read;
     applyFramePicker (STEPS без "standard")           → красит §picker-write.
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
const EPFramePicker = require("../js/framePicker.js");
const EPLightingGroups = require("../js/lightingGroups.js");

/* Обогащённый каталог — как в браузере: стандарт (поле standard) подмешивает data.js из
   catalog-vimar-attrs.js, сырой catalog-vimar.js его не несёт. */
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
const activeFrames = () => PRODUCTS.filter(p => p.kind === "frame" && p.active);
const byKindOf = k => PRODUCTS.filter(x => x.kind === k && x.active);

/* --- §filter / §pool: стандарт в критерии комнаты и сужение пула тем же productsForRoom --- */
const FILTER_CUT = ["frameCollectionList", "frameFacingList", "frameStandardList", "builderFilterRoom", "roomCatalogFilter", "builderRoomFilter"];
const POOL_CUT = FILTER_CUT.concat(["collectionFramePool"]);
function stateFor(room) {
  return { products: PRODUCTS, rooms: [Object.assign({ id: "r1", name: "Комната" }, room)], posts: [{ id: "p1", roomId: "r1" }], builder: { editingPlacedId: "p1" } };
}
function filterFor(room) {
  return stand.run(FILTER_CUT, { state: stateFor(room), byKind: byKindOf, EPCatalog, EPRoom })();
}
function poolFor(room) {
  const pool = stand.run(POOL_CUT, { state: stateFor(room), byKind: byKindOf, EPCatalog, EPRoom });
  return pool(activeFrames());
}

test("§filter: критерий комнаты несёт монтажный стандарт (как коллекцию/отделку)", () => {
  assert.equal(filterFor({ standard: "DE" }).standard, "DE");
  assert.equal(filterFor({ standard: "IT" }).standard, "IT");
});

test("§pool-de: немецкий сужает пул до 560 (DE + универсальные), а не оставляет весь каталог", () => {
  assert.equal(poolFor({ standard: "DE" }).length, 560);
});

test("§pool-it: итальянский сужает пул до 1350 (IT + универсальные)", () => {
  assert.equal(poolFor({ standard: "IT" }).length, 1350);
});

test("§dead: мёртвый (не из каталога) стандарт валидируется в точке вызова → null → фильтра нет", () => {
  const f = filterFor({ standard: "FR" });   /* французского стандарта у накладок нет */
  assert.equal(f.standard, null, "мёртвый стандарт → null");
  assert.equal(poolFor({ standard: "FR" }).length, 1631, "пул не сужен — как без стандарта");
});

test("§old: старый проект без room.standard → стандарт не сужает, пул = весь каталог (1631)", () => {
  assert.equal(filterFor({}).standard, null, "нет поля → null");
  assert.equal(poolFor({}).length, 1631, "выдача как раньше — стандарт ничего не срезает");
});

/* --- §list: вид «Списком» рисует, ЧИТАЕТ и ПИШЕТ ту же настройку room.standard --- */
const spy = () => { const f = () => { f.calls++; }; f.calls = 0; return f; };
function renderList(room) {
  const state = { selected: { kind: "room", id: room.id }, rooms: [room], posts: [], products: PRODUCTS, pxPerMeter: 0 };
  const dom = stand.makeDom({ selects: ["roomStandardSelect", "roomCollectionSelect", "roomSchemeSelect"] });
  const props = stand.makeElement();
  const ctx = {
    state, props, $: dom.$, esc: String,
    byKind: byKindOf, flushRoomDraft: spy(), renderTemplates: () => {},
    findSelectedEntity: (k, id) => state.rooms.find(r => r.id === id),
    applySelectionClasses: spy(), getObjectsInRoom: () => [], roomAutoAreaText: () => "",
    polygonAreaPx: () => 0, lightingScheme: () => "classic",
    EPLightingGroups, EPRoom, EPCatalog,
    EPPrefs: { get: (k, fb) => (k === "frameFacingView" ? "list" : fb), set: () => {} },
    setTool: spy(), persistProject: spy(), renderSummary: spy(), renderAll: spy(), mountedRoomId: null
  };
  stand.run(["frameCollectionList", "frameFacingList", "frameStandardList", "frameFacingView", "renderProperties"], ctx)();
  return { html: props.innerHTML, dom };
}

test("§list-render: селектор «Стандарт монтажа» с ЧЕЛОВЕЧЕСКИМИ вариантами, а не кодами IT/DE", () => {
  const { html } = renderList({ id: "r1", name: "Гостиная", polygon: null });
  assert.match(html, /id="roomStandardSelect"/, "селектор стандарта есть в виде-списке");
  assert.match(html, />итальянский</, "человеку — «итальянский», не «IT»");
  assert.match(html, />немецкий</, "человеку — «немецкий», не «DE»");
  assert.doesNotMatch(html, /<option value="IT"[^>]*>IT</, "код IT не показывается как подпись");
});

test("§list-read: у комнаты standard=DE выбран «немецкий» (вид-список ЧИТАЕТ room.standard)", () => {
  const { html } = renderList({ id: "r1", name: "Гостиная", polygon: null, standard: "DE" });
  assert.match(html, /<option value="DE" selected>немецкий<\/option>/, "selected стоит на действующем стандарте комнаты");
});

test("§list-write: change по селектору пишет room.standard и снимает его на «Не задан»", () => {
  const room = { id: "r1", name: "Гостиная", polygon: null };
  const { dom } = renderList(room);
  dom.$("roomStandardSelect").onchange({ target: { value: "IT" } });
  assert.equal(room.standard, "IT", "выбор записан в ТУ ЖЕ настройку room.standard");
  dom.$("roomStandardSelect").onchange({ target: { value: "" } });
  assert.ok(!("standard" in room), "«Не задан» СНИМАЕТ поле (delete), комната возвращается к «любой стандарт»");
});

/* --- §picker: мастер («С картинками») сеет и пишет ТУ ЖЕ настройку room.standard --- */
test("§picker-read: openFramePicker сеет sel.standard из room.standard (мастер ЧИТАЕТ ту же настройку)", () => {
  const stub = () => ({ classList: { add() {}, remove() {} }, querySelector: () => null });
  const ctx = {
    framePickerRoomId: null, framePickerSel: null, framePickerStep: 0,
    byKind: byKindOf, EPCatalog, EPRoom, EPFramePicker,
    renderFramePicker: () => {}, $: stub, setTimeout: () => 0
  };
  stand.run(["frameCollectionList", "frameFacingList", "frameStandardList", "openFramePicker"], ctx)(
    { id: "r1", name: "К", standard: "DE", collection: "Eikon Evo" });
  assert.equal(ctx.framePickerSel.standard, "DE", "мастер открылся с уже выбранным стандартом комнаты");
  // стандарт и серия заданы → первый НЕзаполненный шаг — материал (индекс 2), а не нулевой стандарт
  assert.equal(ctx.framePickerStep, 2, "заданный стандарт не заставляет мастер вставать заново на шаг стандарта");
});

test("§picker-write: applyFramePicker пишет room.standard и снимает его пустым — ТА ЖЕ настройка, что у списка", () => {
  const room = { id: "r1", name: "Гостиная", standard: "IT" };
  const ctx = {
    framePickerRoomId: "r1", framePickerSel: { standard: "DE", collection: "Arke" }, framePickerStep: 0,
    EPFramePicker, state: { rooms: [room] }, persistProject: spy(), renderProperties: spy(), $: stand.makeDom().$
  };
  stand.run(["closeFramePicker", "applyFramePicker"], ctx)();
  assert.equal(room.standard, "DE", "мастер записал стандарт в room.standard — то же поле, что читает список");
  // а пустой выбор стандарта СНИМАЕТ поле
  const room2 = { id: "r2", name: "Кухня", standard: "IT" };
  const ctx2 = {
    framePickerRoomId: "r2", framePickerSel: { collection: "Arke" }, framePickerStep: 0,
    EPFramePicker, state: { rooms: [room2] }, persistProject: spy(), renderProperties: spy(), $: stand.makeDom().$
  };
  stand.run(["closeFramePicker", "applyFramePicker"], ctx2)();
  assert.ok(!("standard" in room2), "стандарт не выбран в мастере → поле снято (как «Не задан» в списке)");
});
