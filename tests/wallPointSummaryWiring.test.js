/* Структурный регресс-тест: пути, меняющие привязку объекта к комнате, обязаны звать renderSummary.

   ЗАЧЕМ ТЕСТ ПО ТЕКСТУ. app.js — монолит-оркестратор (DOM, state), в node не грузится, живьём не
   исполняется. Дефект (§7.1, состязательный проход): recalculateRoomAssignments синхронизирует
   метку «вне помещений» на плане НЕМЕДЛЕННО, а строку-предупреждение «Вне помещений: N» пишет
   ТОЛЬКО renderSummary (#lightingSummary пишется исключительно в нём). Путь добавления стены-
   перегородки (addWallPoint) звал recalculateRoomAssignments, но забывал renderSummary: новая
   стена выводила объект из комнаты — на плане кольцо загоралось, а счётчик молчал. Экран
   противоречил сам себе. Соседний путь линий разметки (addRoomLinePoint) renderSummary зовёт —
   стены и линии одинаково двигают привязку, контракт обязан быть один.

   ПОСЛЕ РЕФАКТОРИНГА §7.1 контракт сведён в одну функцию refreshAfterRoomAssignments
   (recalculateRoomAssignments → paint → renderProperties → renderSummary → save): addWallPoint
   больше не перечисляет вызовы сам, а делегирует ей. Поэтому здесь проверяем ДВА звена цепи:
   addWallPoint идёт через общий контракт, и сам контракт зовёт renderSummary после пересчёта.
   Полнота контракта целиком (в т.ч. renderProperties) стережётся roomAssignmentsRefreshWiring.

   Регэкспы с \s* — устойчивость к форматированию, а не сравнение строк целиком.

   МУТАЦИОННАЯ ПРОВЕРКА (в отчёте): убрать renderSummary из refreshAfterRoomAssignments → падает
   «общий контракт зовёт renderSummary»; вернуть addWallPoint к прямому списку без делегирования →
   падает «addWallPoint идёт через общий контракт». Комментарии вырезаны общим хелпером
   stripComments, поэтому и мутация «закомментировать вызов, не удаляя строку» тоже краснеет.
   Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { stripComments } = require("./helpers/stripComments.js");

const SRC = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");

/* Вырезаем тело функции: от объявления до следующего `\nfunction ` верхнего уровня. */
function functionBody(name) {
  const start = SRC.indexOf("function " + name);
  assert.ok(start >= 0, "функция " + name + " должна существовать в app.js");
  const rest = SRC.slice(start + 1);
  const nextIdx = rest.indexOf("\nfunction ");
  return nextIdx >= 0 ? rest.slice(0, nextIdx) : rest;
}

/* Тела берём через stripComments (общий хелпер): комментарии вырезаны, поэтому упоминание
   «renderSummary» в комментарии внутри тела больше не мешает — и, главное, мутация
   «закомментировать вызов, не удаляя строку» теперь краснеет. Пустые скобки вызова
   (renderSummary()) оставлены как дополнительная точность: обе функции всегда зовутся без
   аргументов. */
test("addWallPoint добавляет стену и делегирует общему контракту — иначе тест сторожит не ту функцию", () => {
  const body = stripComments(functionBody("addWallPoint"));
  assert.ok(/state\s*\.\s*walls\s*\.\s*push\s*\(/.test(body), "addWallPoint обязан добавлять стену в state.walls");
  assert.ok(/refreshAfterRoomAssignments\s*\(/.test(body),
    "addWallPoint обязан обновлять интерфейс через общий контракт refreshAfterRoomAssignments, а не перечислять вызовы сам");
});

test("общий контракт зовёт renderSummary после пересчёта привязки (метка на плане и счётчик не расходятся)", () => {
  const body = stripComments(functionBody("refreshAfterRoomAssignments"));
  const recalc = body.search(/recalculateRoomAssignments\s*\(\s*\)/);
  const summary = body.search(/renderSummary\s*\(\s*\)/);
  assert.ok(summary >= 0,
    "контракт обязан звать renderSummary() — иначе кольцо «вне помещений» на плане загорится, а строка-счётчик промолчит");
  assert.ok(summary > recalc,
    "renderSummary обязан идти ПОСЛЕ recalculateRoomAssignments — строка считается по свежей привязке");
});
