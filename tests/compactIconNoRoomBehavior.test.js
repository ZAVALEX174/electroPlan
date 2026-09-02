/* ПОВЕДЕНЧЕСКИЙ регресс метки «вне помещений» у ВТОРОГО потребителя — compactIcon из js/app.js.

   ЗАЧЕМ ЭТОТ ТЕСТ, ЕСЛИ ЕСТЬ roomNoRoomLabelBehavior.test.js. Тот исполняет syncNoRoomClass —
   точечную синхронизацию класса при переносе/пересчёте. Но видимый на экране класс после смены
   ЧИСЛА комнат приходит не оттуда: любое изменение числа комнат идёт через renderAll →
   renderDevices()/renderPosts(), а они сносят все .plan-icon и создают заново через compactIcon.
   Всё, что проставил syncNoRoomClass, выбрасывается вместе с узлом. То есть критерий метки у
   compactIcon — это ГЛАВНЫЙ путь после «комнат стало 0 / стало 1», и он ничем не исполнялся.

   ЧЕМ МАЛО СУЩЕСТВУЮЩЕГО. roomNoRoomLabelWiring.test.js проверяет у compactIcon лишь наличие
   подстроки classList.add("no-room") — класс, но не КРИТЕРИЙ. noRoomStyleWiring извлекает имя
   класса, но не аргументы. Второй состязательный проход показал две мутации в compactIcon,
   оставлявшие все тесты зелёными:
     - state.rooms.length → 1 (критерий перестаёт учитывать число комнат: «вне помещений» лезет
       и на пустом плане без единой комнаты);
     - инверсия if(!EPRoomAssign.isOutsideRooms(...)) («!» горит на объектах В комнате, сироты — без метки).

   ИДЕЯ (как в roomNoRoomLabelBehavior.test.js). app.js — монолит-оркестратор (DOM, state), в node
   не грузится. Вырезаем ИСХОДНЫЙ ТЕКСТ compactIcon и исполняем в vm-контексте с DOM-шимом и
   настоящим EPRoomAssign. Критерий берётся из реального модуля — значит мутации критерия в
   compactIcon покраснеют здесь. document.createElement отдаёт узел с настоящим classList поверх
   Set (add/contains); класс no-room кладётся ТОЛЬКО через classList.add, поэтому contains("no-room")
   честно отражает срабатывание критерия. Прочие зависимости (product/makeDraggable/hover) —
   безобидные шимы: к метке они не касаются, нужны лишь чтобы функция дошла до конца. */
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

const EPRoomAssign = require("../js/roomAssign.js");

/* Живой compactIcon на общем стенде: document-шим (createElement отдаёт узел с настоящим classList
   поверх Set), state и настоящий EPRoomAssign (критерий — из реального модуля). Класс no-room
   кладётся ТОЛЬКО через classList.add, поэтому contains("no-room") честно отражает срабатывание
   критерия. product/makeDraggable/hover — безвредные шимы: метки не касаются, нужны лишь чтобы
   функция доработала до return. */
function buildCompactIcon(state) {
  return stand.run("compactIcon", {
    document: stand.makeDocument(),
    state: state,
    EPRoomAssign: EPRoomAssign,
    product: () => null,          // kind==="device": product(...)?.icon || "?" → "?"
    makeDraggable: () => {},
    showHover: () => {}, positionHover: () => {}, hideHover: () => {}
  });
}

const hasLabel = el => el.classList.contains("no-room");

/* --- Живой сценарий из задачи: комната есть, розетка снаружи, пост внутри --------------------- */
test("комната есть: сирота-устройство получает метку, пост в комнате — нет", () => {
  const state = { rooms: [{ id: "R1" }], selected: null };
  const compactIcon = buildCompactIcon(state);

  const outside = compactIcon({ id: "dev-1", x: 10, y: 10, roomId: null, productId: "p" }, "device");
  assert.ok(hasLabel(outside),
    "сирота при наличии комнат обязан получить no-room при создании иконки — иначе критерий инвертирован");

  const inside = compactIcon({ id: "post-1", x: 20, y: 20, roomId: "R1", number: 1 }, "post");
  assert.ok(!hasLabel(inside),
    "пост внутри комнаты не должен получать no-room — иначе критерий инвертирован");
});

/* --- Удалили ЕДИНСТВЕННУЮ комнату: обе иконки без метки (ловит state.rooms.length → 1) -------- */
test("комнат в проекте нет: ни устройство, ни пост не получают метку", () => {
  const state = { rooms: [], selected: null };
  const compactIcon = buildCompactIcon(state);

  const dev = compactIcon({ id: "dev-1", x: 10, y: 10, roomId: null, productId: "p" }, "device");
  assert.ok(!hasLabel(dev),
    "без комнат метка «вне помещений» — шум; критерий обязан учитывать state.rooms.length");

  const post = compactIcon({ id: "post-1", x: 20, y: 20, roomId: null, number: 1 }, "post");
  assert.ok(!hasLabel(post),
    "без комнат пост тоже не помечается — критерий обязан учитывать state.rooms.length");
});

/* --- Поставили комнату обратно: метка у сироты возвращается (симметрия к сценарию выше) ------- */
test("комнату вернули: сирота снова помечается при создании иконки", () => {
  const state = { rooms: [{ id: "R1" }], selected: null };
  const compactIcon = buildCompactIcon(state);
  const dev = compactIcon({ id: "dev-1", x: 10, y: 10, roomId: null, productId: "p" }, "device");
  assert.ok(hasLabel(dev),
    "после возврата комнаты сирота обязан снова получить no-room — метка привязана к числу комнат и roomId");
});
