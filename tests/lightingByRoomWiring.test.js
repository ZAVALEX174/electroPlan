/* Структурный регресс-тест ПРОВОДКИ расчёта групп света ПО КОМНАТАМ в js/app.js.

   ЗАЧЕМ ТЕСТ ПО ТЕКСТУ, А НЕ ПО ПОВЕДЕНИЮ. app.js — монолит-оркестратор (DOM, state), он не
   грузится ни одним тестом и в node не исполняется. Чистую логику (раскрой по комнатам, слияние,
   подпись кэша) проверяет tests/lightingByRoom.test.js на настоящем модуле — НО он проверяет
   МОДУЛЬ, а не то, что app.js действительно ходит в этот модуль. Тестовый хелпер planByRoomsFor
   там — вторая копия проводки из app.js: ошибка в оригинале (lightingFor перестал звать
   planByRooms, projectLighting перестал подписывать кэш через cacheSignature — вернулись к
   «одной схеме на проект») осталась бы зелёной, потому что копия считает правильно.
   Этот тест закрепляет ОРИГИНАЛ по исходному тексту. Он НЕ подмена поведенческому — он ловит
   ровно разрыв провода, который поведенческий увидеть не может. Регэкспы с \s* — устойчивость к
   форматированию, а не сравнение строк целиком.

   Мутационная проверка (в отчёте): удаление вызова EPLightingByRoom.planByRooms из lightingFor
   роняет первый структурный assert; удаление EPLightingByRoom.cacheSignature из projectLighting —
   второй. Тела берём через общий хелпер stripComments (комментарии вырезаны), поэтому и мутация
   «закомментировать вызов, не удаляя строку» краснеет — а не только физическое удаление. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { stripComments } = require("./helpers/stripComments.js");

const SRC = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");

/* Тело функции от её объявления до объявления следующей — чтобы вызовы искать в нужной функции,
   а не где-то ещё в файле. Границей служит начало любой следующей `function имя(`. */
function bodyOf(name) {
  const start = SRC.indexOf("function " + name + "(");
  assert.ok(start >= 0, "в app.js должна быть функция " + name);
  const rest = SRC.slice(start + 1);
  const next = rest.search(/\nfunction\s+\w+\s*\(/);
  return next >= 0 ? rest.slice(0, next) : rest;
}

test("lightingFor() считает через EPLightingByRoom.planByRooms — не старым «одной схемой на проект»", () => {
  const body = stripComments(bodyOf("lightingFor"));
  assert.ok(
    /EPLightingByRoom\s*\.\s*planByRooms\s*\(/.test(body),
    "lightingFor обязан вызывать EPLightingByRoom.planByRooms (раскрой по комнатам)"
  );
  /* Раскрой немыслим без карт «пост→комната» и «комната→схема»: их отсутствие означало бы возврат
     к единому расчёту. Проверяем, что обе функции-зависимости уходят в вызов. */
  assert.ok(/partitionKeyOf\s*:/.test(body), "в вызов передаётся partitionKeyOf (место → комната)");
  assert.ok(/schemeForPartition\s*:/.test(body), "в вызов передаётся schemeForPartition (комната → схема)");
});

test("projectLighting() подписывает кэш через EPLightingByRoom.cacheSignature — с комнатами", () => {
  const body = stripComments(bodyOf("projectLighting"));
  assert.ok(
    /EPLightingByRoom\s*\.\s*cacheSignature\s*\(/.test(body),
    "projectLighting обязан собирать подпись кэша через EPLightingByRoom.cacheSignature"
  );
  /* Подпись без комнат не сбрасывала бы кэш при смене схемы комнаты или переезде поста —
     ровно тот дефект, ради которого cacheSignature появился. Комнаты обязаны попасть в подпись. */
  assert.ok(/rooms\s*:/.test(body), "в подпись кэша передаются комнаты проекта (rooms)");
});
