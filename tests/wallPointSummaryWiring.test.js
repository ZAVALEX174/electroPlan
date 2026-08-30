/* Структурный регресс-тест: пути, меняющие привязку объекта к комнате, обязаны звать renderSummary.

   ЗАЧЕМ ТЕСТ ПО ТЕКСТУ. app.js — монолит-оркестратор (DOM, state), в node не грузится, живьём не
   исполняется. Дефект (§7.1, состязательный проход): recalculateRoomAssignments синхронизирует
   метку «вне помещений» на плане НЕМЕДЛЕННО, а строку-предупреждение «Вне помещений: N» пишет
   ТОЛЬКО renderSummary (#lightingSummary пишется исключительно в нём). Путь добавления стены-
   перегородки (addWallPoint) звал recalculateRoomAssignments, но забывал renderSummary: новая
   стена выводила объект из комнаты — на плане кольцо загоралось, а счётчик молчал. Экран
   противоречил сам себе. Соседний путь линий разметки (addRoomLinePoint) renderSummary зовёт —
   стены и линии одинаково двигают привязку, контракт обязан быть один.

   Регэкспы с \s* — устойчивость к форматированию, а не сравнение строк целиком.

   МУТАЦИОННАЯ ПРОВЕРКА (в отчёте): убрать renderSummary из addWallPoint → падает
   «addWallPoint после пересчёта привязки зовёт renderSummary». Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");

/* Вырезаем тело функции: от объявления до следующего `\nfunction ` верхнего уровня. */
function functionBody(name) {
  const start = SRC.indexOf("function " + name);
  assert.ok(start >= 0, "функция " + name + " должна существовать в app.js");
  const rest = SRC.slice(start + 1);
  const nextIdx = rest.indexOf("\nfunction ");
  return nextIdx >= 0 ? rest.slice(0, nextIdx) : rest;
}

/* Регэкспы требуют ПУСТЫХ скобок вызова (renderSummary()), а не просто «renderSummary(»: обе функции
   всегда зовутся без аргументов, а в комментарии внутри тела упоминается «renderSummary» — без такого
   ужесточения \s*\( матчил бы комментарий (renderSummary … (#lightingSummary…) и тест перестал бы
   ловить удаление реального вызова. */
test("addWallPoint добавляет стену и пересчитывает привязку — иначе тест сторожит не ту функцию", () => {
  const body = functionBody("addWallPoint");
  assert.ok(/state\s*\.\s*walls\s*\.\s*push\s*\(/.test(body), "addWallPoint обязан добавлять стену в state.walls");
  assert.ok(/recalculateRoomAssignments\s*\(\s*\)/.test(body), "addWallPoint обязан пересчитывать привязку к комнатам");
});

test("addWallPoint после пересчёта привязки зовёт renderSummary (метка на плане и счётчик не расходятся)", () => {
  const body = functionBody("addWallPoint");
  const recalc = body.search(/recalculateRoomAssignments\s*\(\s*\)/);
  const summary = body.search(/renderSummary\s*\(\s*\)/);
  assert.ok(summary >= 0,
    "addWallPoint обязан звать renderSummary() — иначе кольцо «вне помещений» на плане загорится, а строка-счётчик промолчит");
  assert.ok(summary > recalc,
    "renderSummary обязан идти ПОСЛЕ recalculateRoomAssignments — строка считается по свежей привязке");
});
