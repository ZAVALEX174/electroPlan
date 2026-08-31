/* Структурный регресс-тест ЕДИНСТВЕННОСТИ правила «в какой комнате точка» в js/app.js.

   ЗАЧЕМ ТЕСТ ПО ТЕКСТУ, А НЕ ПО ПОВЕДЕНИЮ. app.js — монолит-оркестратор (DOM, state), он не
   грузится ни одним тестом и в node не исполняется, поэтому связка привязки объекта к комнате
   ничем не покрыта. Это НЕ замена поведенческому тесту: он не проверяет, что точка попадает в
   правильную комнату, — он лишь стережёт архитектурный инвариант §7.1, что правило существует
   в ОДНОМ экземпляре (resolveRoomForPoint), а потребители — getRoomForPoint для подсветки при
   перетаскивании и recalculateRoomAssignments для фактической записи — ходят через него.
   Дефект, который он ловит: если у потребителя заведётся своя копия правила (собственный поиск
   через pointInPolygon), подсветка под курсором и записанная привязка разойдутся, и никакой
   исполняемый тест этого не увидит. Регэкспы с \s* — устойчивость к форматированию, а не
   сравнение строк целиком.

   Мутационная проверка (в отчёте): вернуть в recalculateRoomAssignments поиск через
   pointInPolygon, перенести построение контекста внутрь цикла — каждая мутация обязана
   ронять соответствующий assert. Тела берём через общий хелпер stripComments (комментарии
   вырезаны), поэтому и мутация «закомментировать делегирование в resolveRoomForPoint, не удаляя
   строку» краснеет. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { stripComments } = require("./helpers/stripComments.js");

const SRC = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");

/* Вырезаем тело функции: от её объявления до следующего `\nfunction ` верхнего уровня.
   Все три интересующие функции — соседи верхнего уровня, так что этого достаточно. */
function functionBody(name) {
  const start = SRC.indexOf("function " + name);
  assert.ok(start >= 0, "функция " + name + " должна существовать в app.js");
  const rest = SRC.slice(start + 1);
  const nextIdx = rest.indexOf("\nfunction ");
  return nextIdx >= 0 ? rest.slice(0, nextIdx) : rest;
}

test("getRoomForPoint делегирует в resolveRoomForPoint и не держит своей копии правила", () => {
  const body = stripComments(functionBody("getRoomForPoint"));
  assert.ok(
    /resolveRoomForPoint\s*\(/.test(body),
    "getRoomForPoint обязан идти через resolveRoomForPoint"
  );
  assert.ok(
    !/pointInPolygon\s*\(/.test(body),
    "в getRoomForPoint не должно быть собственного pointInPolygon — это вторая копия правила"
  );
});

test("recalculateRoomAssignments делегирует в resolveRoomForPoint и не держит своей копии правила", () => {
  const body = stripComments(functionBody("recalculateRoomAssignments"));
  assert.ok(
    /resolveRoomForPoint\s*\(/.test(body),
    "recalculateRoomAssignments обязан идти через resolveRoomForPoint"
  );
  assert.ok(
    !/pointInPolygon\s*\(/.test(body),
    "в recalculateRoomAssignments не должно быть собственного pointInPolygon — именно эта копия разведёт подсветку с фактической привязкой"
  );
});

test("recalculateRoomAssignments строит контекст ВНЕ цикла по объектам", () => {
  const body = stripComments(functionBody("recalculateRoomAssignments"));

  const ctxBuild = body.search(/roomResolveContext\s*\(/);
  assert.ok(ctxBuild >= 0, "recalculateRoomAssignments обязан строить контекст через roomResolveContext");

  const loop = body.search(/\.\s*forEach\s*\(/);
  assert.ok(loop >= 0, "recalculateRoomAssignments обязан обходить объекты циклом forEach");

  /* Контекст строится ДО входа в цикл — карта пространства собирается один раз на весь пересчёт. */
  assert.ok(
    ctxBuild < loop,
    "roomResolveContext обязан вызываться ДО forEach — иначе карта пересобирается на каждый объект"
  );

  /* И внутри цикла контекст не пересобирается. */
  const loopBody = body.slice(loop);
  assert.ok(
    !/roomResolveContext\s*\(/.test(loopBody),
    "внутри цикла по объектам не должно быть повторного roomResolveContext — это убьёт производительность пересчёта"
  );
});
