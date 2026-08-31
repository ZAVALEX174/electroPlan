/* Структурный регресс-тест ПРИВЯЗКИ метки «вне помещений» к ЗАПИСИ roomId в js/app.js.

   ЗАЧЕМ ТЕСТ ПО ТЕКСТУ, А НЕ ПО ПОВЕДЕНИЮ. app.js — монолит-оркестратор (DOM, state), он не
   грузится ни одним тестом и в node не исполняется, поэтому связка «пометить объект без комнаты»
   ничем не покрыта. Дефект, который тест стережёт (§7.1): раньше класс no-room ставился ТОЛЬКО в
   compactIcon (при создании иконки в рендере), а roomId меняется и по путям, которые renderAll не
   зовут (перенос объекта — updateObjectRoom; правка контура/разметка линий — recalculateRoom-
   Assignments). Из-за этого метка расходилась с фактом: пост уехал из комнаты — «!» не появился;
   вернулся — «!» остался. Лечение: метку обновлять ТАМ ЖЕ, где физически пишется roomId, — в
   обеих функциях, и обе обязаны ходить через один хелпер syncNoRoomClass (у правки не должно быть
   краёв). Регэкспы с \s* — устойчивость к форматированию, а не сравнение строк целиком.

   МУТАЦИОННАЯ ПРОВЕРКА (в отчёте): убрать вызов syncNoRoomClass из updateObjectRoom → падает
   «updateObjectRoom обновляет метку…»; убрать из recalculateRoomAssignments → падает
   «recalculateRoomAssignments обновляет метку…»; убрать проверку state.rooms.length из самого
   syncNoRoomClass → падает «syncNoRoomClass ставит метку только когда комнаты есть»; снять класс
   no-room в compactIcon → падает «compactIcon по-прежнему клеймит метку при создании иконки».
   Тела берём через общий хелпер stripComments (комментарии вырезаны) — поэтому и мутация
   «закомментировать вызов syncNoRoomClass, не удаляя строку» тоже краснеет. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { stripComments } = require("./helpers/stripComments.js");

const SRC = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");

/* Вырезаем тело функции: от её объявления до следующего `\nfunction ` верхнего уровня. */
function functionBody(name) {
  const start = SRC.indexOf("function " + name);
  assert.ok(start >= 0, "функция " + name + " должна существовать в app.js");
  const rest = SRC.slice(start + 1);
  const nextIdx = rest.indexOf("\nfunction ");
  return nextIdx >= 0 ? rest.slice(0, nextIdx) : rest;
}

test("updateObjectRoom обновляет метку через syncNoRoomClass там же, где пишет roomId", () => {
  const body = stripComments(functionBody("updateObjectRoom"));
  assert.ok(
    /entity\s*\.\s*roomId\s*=/.test(body),
    "updateObjectRoom обязан писать entity.roomId — иначе тест сторожит не ту функцию"
  );
  assert.ok(
    /syncNoRoomClass\s*\(/.test(body),
    "updateObjectRoom обязан вызвать syncNoRoomClass — метка привязывается к записи roomId, а не к рендеру"
  );
});

test("recalculateRoomAssignments обновляет метку через syncNoRoomClass там же, где пишет roomId", () => {
  const body = stripComments(functionBody("recalculateRoomAssignments"));
  assert.ok(
    /\.\s*roomId\s*=/.test(body),
    "recalculateRoomAssignments обязан писать roomId — иначе тест сторожит не ту функцию"
  );
  assert.ok(
    /syncNoRoomClass\s*\(/.test(body),
    "recalculateRoomAssignments обязан вызвать syncNoRoomClass — метка привязывается к записи roomId, а не к рендеру"
  );
});

test("syncNoRoomClass ставит метку только когда комнаты есть (тот же критерий, что в compactIcon)", () => {
  const body = stripComments(functionBody("syncNoRoomClass"));
  assert.ok(
    /classList\s*\.\s*toggle\s*\(\s*["']no-room["']/.test(body),
    "syncNoRoomClass обязан переключать класс no-room точечно (toggle), без пересоздания сцены"
  );
  assert.ok(
    /state\s*\.\s*rooms\s*\.\s*length/.test(body),
    "критерий обязан включать state.rooms.length — без комнат «вне помещений» у всего подряд было бы шумом"
  );
});

test("compactIcon по-прежнему клеймит метку при создании иконки", () => {
  const body = stripComments(functionBody("compactIcon"));
  assert.ok(
    /classList\s*\.\s*add\s*\(\s*["']no-room["']\s*\)/.test(body),
    "простановка no-room при создании иконки должна сохраниться — точечный путь её не отменяет"
  );
});
