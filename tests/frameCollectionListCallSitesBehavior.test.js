/* ПОВЕДЕНЧЕСКИЙ контракт ТОЧЕК ВЫЗОВА frameCollectionList (js/app.js), а не только её тела.
   Запуск: node --test tests/

   ⚠️ ЗАЧЕМ ОТДЕЛЬНО ОТ frameCollectionListSourceContract. Тот контракт держит ИСТОЧНИК внутри
   frameCollectionList (список берётся из byKind("frame")). Но обещание app.js шире: ОБЕ точки,
   которым нужен список коллекций, — селектор «Коллекция комнаты» в renderProperties (js/app.js:1436)
   и валидация room.collection в builderRoomFilter (js/app.js:1951) — обязаны звать именно
   frameCollectionList(), а не собирать список мимо неё. Подмена вызова на
   `EPCatalog.productCollections(state.products.filter(x=>x.kind==="frame"))` берёт ВСЕ накладки, в
   т.ч. неактивные (byKind фильтрует по active), и на реальном прайсе неразличима: снятых накладок
   с уникальной серией там нет. Ловим на СИНТЕТИЧЕСКОМ каталоге, где серия «GhostFrame» живёт ТОЛЬКО
   у неактивной накладки: продакшн (byKind) её отбрасывает, мутант (все kind==="frame") — протаскивает.

   МУТАЦИОННАЯ ТАБЛИЦА (в отчёте):
     js/app.js:1436 frameCollectionList() → EPCatalog.productCollections(state.products.filter(x=>x.kind==="frame"))
       → §1 краснеет: в селектор комнаты попадает <option value="GhostFrame"> — коллекция без единой
         живой накладки (продакшн её не показывает);
     js/app.js:1951 roomCollection(room,frameCollectionList()) → roomCollection(room,EPCatalog.productCollections(state.products.filter(x=>x.kind==="frame")))
       → §2 краснеет: мёртво-живая «GhostFrame» признаётся валидной коллекцией комнаты
         (collection="GhostFrame" вместо null). */
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const EPCatalog = require("../js/catalog.js");
const EPRoom = require("../js/room.js");

/* Синтетический каталог: «Arke» — у ЖИВОЙ накладки (список коллекций непуст и осмыслен),
   «GhostFrame» — ТОЛЬКО у неактивной накладки (byKind("frame") её не вернёт),
   «GhostMech» — ТОЛЬКО у механизма (проверка, что список вообще не берёт механизмы). */
const PRODUCTS = [
  { id: "f-arke", kind: "frame", active: true, name: "Рамка Arke", series: ["Arke"] },
  { id: "f-ghost", kind: "frame", active: false, name: "Рамка снята", series: ["GhostFrame"] },
  { id: "m-ghost", kind: "mechanism", active: true, name: "Механизм", series: ["GhostMech"] }
];

/* byKind как в app.js: только активные товары нужного вида. */
const byKind = kind => PRODUCTS.filter(x => x.kind === kind && x.active);

/* Разведка предпосылки: продакшн-список коллекций накладок = ровно ["Arke"]; ни «GhostFrame»
   (неактивна), ни «GhostMech» (механизм) в него не входят — иначе тест доказывал бы не то. */
assert.deepEqual(EPCatalog.productCollections(byKind("frame")), ["Arke"],
  "предпосылка: живая накладка только в «Arke»; «GhostFrame»/«GhostMech» — вне списка коллекций накладок");

test("§1 селектор «Коллекция комнаты» (renderProperties) не показывает серию без живой накладки", () => {
  /* Исполняем НАСТОЯЩИЙ renderProperties+frameCollectionList из app.js для выделенной комнаты.
     Читаем итоговый props.innerHTML: опции коллекции строятся из frameCollectionList(). */
  const room = { id: "r1", name: "Гостиная", polygon: null };
  const props = { className: "", innerHTML: "" };
  const dom = stand.makeDom();
  const ctx = {
    state: { selected: { kind: "room", id: "r1" }, rooms: [room], products: PRODUCTS, pxPerMeter: 100 },
    props,
    byKind,
    EPCatalog,
    EPRoom,
    EPLightingGroups: { SCHEMES: [{ id: "classic", label: "Классическая", supported: true }] },
    lightingScheme: () => "classic",
    findSelectedEntity: () => room,
    getObjectsInRoom: () => [],
    roomAutoAreaText: () => "18 м²",
    flushRoomDraft: () => {},
    esc: String,
    $: dom.$
  };
  stand.run(["frameCollectionList", "renderProperties"], ctx)();

  assert.match(props.innerHTML, /<option value="Arke"/,
    "живая коллекция «Arke» в селекторе есть (рендер прошёл, список непуст)");
  assert.doesNotMatch(props.innerHTML, /GhostFrame/,
    "серии без единой живой накладки в селекторе комнаты быть не должно — иначе список собран мимо byKind(\"frame\")");
});

test("§2 builderRoomFilter не признаёт валидной коллекцию комнаты без живой накладки", () => {
  /* Комната закреплена за «GhostFrame» (серия жива только у снятой накладки). Продакшн: список =
     ["Arke"], roomCollection бракует «GhostFrame» как мёртвую → null. Мутант со списком по всем
     kind==="frame" протащит «GhostFrame» в валидные и вернёт её как фильтр. */
  const state = {
    products: PRODUCTS,
    rooms: [{ id: "r1", name: "Гостиная", collection: "GhostFrame" }],
    posts: [{ id: "p1", roomId: "r1" }],
    builder: { editingPlacedId: "p1" }
  };
  const filter = stand.run(["frameCollectionList", "builderRoomFilter"], { state, byKind, EPCatalog, EPRoom })();

  assert.equal(filter.collection, null,
    "«GhostFrame» жива только у неактивной накладки → не валидна как коллекция комнаты → критерий пуст (весь каталог)");
});
