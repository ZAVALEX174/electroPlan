/* ПОВЕДЕНЧЕСКИЙ регресс E13: перенос КОЛЛЕКЦИИ комнаты при пересчёте контуров на стороне
   ПРИЛОЖЕНИЯ (js/app.js carryUserRoomFields), а не только в чистом модуле.

   ЗАЧЕМ. Пересчёт помещений (scheduleRoomsFromLines) выбрасывает все авто-комнаты и строит новые
   с новым id; carryUserRoomFields возвращает на них введённые человеком поля — имя/площадь/схему
   и коллекцию накладок (E13). Чистый модуль js/roomCarry.js это уже считает и покрыт
   (tests/roomCarry.test.js), но ЕДИНСТВЕННЫЙ, кто реально ПИШЕТ room.collection после пересчёта, —
   тонкая обёртка carryUserRoomFields в app.js, а её не звал ни один тест: удаление строки
   `if(t.collection!=null)room.collection=t.collection;` проходило мутацию ЗЕЛЁНОЙ. Без строки
   коллекция комнаты молча исчезала бы при каждой правке линий разметки.

   ЧТО ПРОВЕРЯЕМ ПОВЕДЕНЧЕСКИ (исполняем НАСТОЯЩИЙ текст carryUserRoomFields из app.js в vm;
   EPRoomCarry и EPGeom — настоящие js/roomCarry.js / js/geometry.js, сопоставление и запись идут
   продакшн-кодом):
   1) старая авто-комната с collection и новая пересчитанная на том же месте → после вызова
      коллекция ОКАЗАЛАСЬ на новой комнате (ловит удаление строки переноса);
   2) старая авто-комната БЕЗ collection (перенос t.collection==null) → поле на новой комнате НЕ
      создаётся (ловит обратную мутацию «писать collection безусловно»).

   МУТАЦИОННАЯ ТАБЛИЦА (в отчёте):
     удалить `if(t.collection!=null)room.collection=t.collection;` → краснеет §1;
     заменить условие на безусловное `room.collection=t.collection;` → краснеет §2.
   Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

const EPRoomCarry = require("../js/roomCarry.js");
const EPGeom = require("../js/geometry.js");

/* Прямоугольная комната по двум углам — как в roomCarry.test.js. extra кладёт пользовательские
   поля (collection/name/autoPolygon). autoPolygon:true обязателен: carry берёт источниками только
   уничтожаемые авто-комнаты. */
function rect(id, x0, y0, x1, y1, extra) {
  return Object.assign({
    id,
    polygon: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]
  }, extra || {});
}

/* carryUserRoomFields зовёт EPRoomCarry.carry(old,new,EPGeom) и пишет поля в newRooms — больше из
   лексики app.js ему ничего не нужно. Возврата нет: результат — мутация переданных newRooms. */
function runCarry(oldRooms, newRooms) {
  const carry = stand.run("carryUserRoomFields", { EPRoomCarry, EPGeom });
  carry(oldRooms, newRooms);
  return newRooms;
}

test("E13: коллекция старой авто-комнаты переносится на пересчитанную новую комнату того же места", () => {
  // авто-имя, чтобы имя не переносилось и в фокусе осталась именно коллекция
  const oldR = rect("old1", 0, 0, 100, 100, { name: "Комната 1", collection: "Arke", autoPolygon: true });
  const newR = rect("new1", 0, 0, 100, 100, { name: "Комната 1", autoPolygon: true });
  const [room] = runCarry([oldR], [newR]);
  assert.equal(room.id, "new1", "предпосылка: newRooms не подменился — пишем в ту же новую комнату");
  assert.equal(room.collection, "Arke",
    "коллекция обязана переехать на новую комнату — без строки переноса она исчезла бы при пересчёте контуров");
});

test("E13: у старой авто-комнаты коллекции нет — поле на новой комнате НЕ создаётся", () => {
  // ручное имя даёт что переносить (иначе carry вернул бы пусто), но collection нет вовсе
  const oldR = rect("old1", 0, 0, 100, 100, { name: "Кухня", autoPolygon: true });
  const newR = rect("new1", 0, 0, 100, 100, { name: "Комната 1", autoPolygon: true });
  const [room] = runCarry([oldR], [newR]);
  assert.equal(room.name, "Кухня", "предпосылка: перенос состоялся — имя переехало");
  assert.ok(!("collection" in room),
    "без коллекции у источника поле создаваться не должно — безусловная запись материализовала бы пустую коллекцию");
});
