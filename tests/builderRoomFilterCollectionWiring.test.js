/* ПОВЕДЕНЧЕСКИЙ регресс E13: критерий сужения каталога берёт коллекцию у комнаты ПОСТА, который
   сейчас редактируется, а НЕ у первой комнаты проекта (js/app.js builderRoomFilter).

   ЗАЧЕМ. builderRoomFilter — ядро E13: editingPlacedId → пост → roomId → комната →
   EPRoom.roomCollection. Во всех прежних тестах E13 комната была ровно одна, поэтому подмена тела
   на `state.rooms[0]` проходила мутацию ЗЕЛЁНОЙ — «берём коллекцию именно нужной комнаты» ничем
   не удерживалось. Ставим в проект ДВЕ комнаты с РАЗНЫМИ коллекциями и редактируем пост во ВТОРОЙ:
   критерий обязан вернуть коллекцию ВТОРОЙ комнаты, а не первой.

   Исполняем НАСТОЯЩИЙ текст builderRoomFilter/frameCollectionList из app.js в vm на НАСТОЯЩЕМ
   каталоге VIMAR; EPRoom/EPCatalog настоящие — правило и валидация коллекции по каталогу идут
   продакшн-кодом.

   МУТАЦИОННАЯ ТАБЛИЦА (в отчёте):
     room = state.rooms[0] вместо поиска по roomId поста → краснеет §1 (вернёт «Arke» вместо «Eikon Tactil»);
     roomCollection(room,frameCollectionList()) → roomCollection(room) (убрать второй аргумент) →
       на ЖИВЫХ коллекциях зелёный (обе валидны), но краснит §3: мёртвая коллекция «Идея» без
       списка каталога проходит как валидная (любая непустая строка) → collection="Идея" вместо null.
   Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

const EPCatalog = require("../js/catalog.js");
const EPRoom = require("../js/room.js");

const PRODUCTS = stand.loadVimarCatalog().products;

/* Разведка: обе коллекции реально есть в каталоге, иначе roomCollection забракует их как «мёртвые»
   и вернёт null — тогда тест доказывал бы не то. Числа заказчика: коллекций 9, среди них обе. */
const COLLECTIONS = EPCatalog.productCollections(PRODUCTS.filter(p => p.kind === "frame" && p.active));
assert.ok(COLLECTIONS.includes("Arke") && COLLECTIONS.includes("Eikon Tactil"),
  "предпосылка: и «Arke», и «Eikon Tactil» присутствуют в каталоге как валидные коллекции");

/* Контекст vm: builderRoomFilter/frameCollectionList настоящие, каталог и доменная логика тоже. */
function makeCtx(state) {
  return {
    state,
    byKind: kind => state.products.filter(x => x.kind === kind && x.active),
    EPRoom, EPCatalog
  };
}
const CUT = ["frameCollectionList", "builderRoomFilter"];

/* Проект из ДВУХ комнат разных коллекций; редактируется пост, стоящий в комнате editRoomId. */
function filterFor(editRoomId) {
  const state = {
    products: PRODUCTS,
    rooms: [
      { id: "r1", name: "Гостиная", collection: "Arke" },
      { id: "r2", name: "Спальня", collection: "Eikon Tactil" }
    ],
    posts: [
      { id: "p1", roomId: "r1" },
      { id: "p2", roomId: "r2" }
    ],
    builder: { editingPlacedId: editRoomId === "r1" ? "p1" : "p2" }
  };
  const filter = stand.run(CUT, makeCtx(state));
  return filter();
}

test("E13: критерий берёт коллекцию комнаты РЕДАКТИРУЕМОГО поста (второй), а не первой комнаты проекта", () => {
  // пост p2 стоит во ВТОРОЙ комнате (Eikon Tactil), первая комната — Arke: подмена на rooms[0] даст «Arke»
  assert.equal(filterFor("r2").collection, "Eikon Tactil",
    "коллекция обязана прийти от комнаты поста (Eikon Tactil), а не от state.rooms[0] (Arke)");
});

test("E13: тот же критерий для поста ПЕРВОЙ комнаты даёт её коллекцию — фильтр следует за постом", () => {
  // контроль: результат меняется вместе с редактируемым постом — критерий действительно ходит по roomId
  assert.equal(filterFor("r1").collection, "Arke",
    "для поста первой комнаты критерий — «Arke»; вместе с §1 доказывает, что берётся комната поста, а не фиксированный индекс");
});

/* §3: валидация коллекции по каталогу ЖИВЁТ В ТОЧКЕ ВЫЗОВА, а не только в модуле room.js.
   Старый проект: у комнаты collection="Идея" — серия, которой в текущем прайсе НЕТ (переименовали/
   перезалили). Продакшн зовёт roomCollection(room, frameCollectionList()) → «Идея» не в каталоге →
   null → фильтра нет, весь каталог. Мутант roomCollection(room) (без второго аргумента) пропускает
   любую непустую строку как валидную → collection="Идея": renderBuilder/resolveMissingFrame/
   emptyContext начнут писать «помещение закреплено за коллекцией «Идея»» про фильтр, которого нет.
   На §1–§2 (живые коллекции) мутант зелёный — держим именно мёртвым именем. */
function filterForDeadCollection() {
  const state = {
    products: PRODUCTS,
    rooms: [{ id: "r1", name: "Кабинет", collection: "Идея" }],
    posts: [{ id: "p1", roomId: "r1" }],
    builder: { editingPlacedId: "p1" }
  };
  return stand.run(CUT, makeCtx(state))();
}

test("E13: мёртвая коллекция комнаты (нет в каталоге) валидируется в точке вызова → collection === null", () => {
  assert.ok(!COLLECTIONS.includes("Идея"),
    "предпосылка: «Идея» отсутствует в каталоге — это и есть мёртвая коллекция старого проекта");
  assert.equal(filterForDeadCollection().collection, null,
    "frameCollectionList() обязан прийти вторым аргументом roomCollection: мёртвое имя → null (весь каталог), а не мнимый фильтр «Идея»");
});
