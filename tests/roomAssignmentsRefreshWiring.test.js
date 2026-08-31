/* Структурный регресс-тест ЕДИНСТВЕННОСТИ контракта «привязка объектов к комнатам изменилась».

   ЗАЧЕМ ТЕСТ ПО ТЕКСТУ. app.js — монолит-оркестратор (DOM, state), в node не грузится и живьём
   не исполняется, поэтому связку «правка геометрии → обновление интерфейса» ничем не покрыть
   поведенчески. Дефект (§7.1, состязательный проход): контракт из пяти-шести вызовов
   (recalculateRoomAssignments → paint → renderProperties → renderSummary → save) был размазан по
   пятнадцати потребителям, и в ПЯТИ из них выпал renderProperties: пользователь провёл стену-
   перегородку, объект вышел из комнаты — на плане кольцо «вне помещений» загорелось, а карточка
   выбранного поста в панели свойств показывала прежнюю комнату и прежнюю цену. Экран противоречил
   сам себе. Лечение по §7.1 — свести контракт в ОДНУ функцию refreshAfterRoomAssignments, тогда у
   правки физически не будет краёв. Этот тест стережёт инвариант: контракт полон и живёт в одном
   месте.

   ПОЧЕМУ ВЫРЕЗАЕМ КОММЕНТАРИИ ПЕРЕД СОПОСТАВЛЕНИЕМ. В проекте есть известная дыра: регэксп вида
   /renderProperties\s*\(/ матчит вызов, ЗАКОММЕНТИРОВАННЫЙ рядом, и мутация «закомментировать
   вызов» оставляет прогон зелёным. Поэтому все проверки идут по исходнику с вырезанными блочными
   и строчными комментариями (общий хелпер tests/helpers/stripComments.js) — закомментированный
   вызов для теста не существует.

   МУТАЦИОННАЯ ПРОВЕРКА (числа — в отчёте):
     · убрать renderProperties из refreshAfterRoomAssignments → падает «держит полный контракт»;
     · вернуть addWallPoint (или любой путь) к прямому списку с recalculateRoomAssignments() →
       падает «контракт живёт в одном месте» (прямых вызовов станет больше двух);
     · закомментировать (не удалить) вызов внутри refreshAfterRoomAssignments → тоже падает
       «держит полный контракт», потому что комментарии вырезаны — это и есть закрытие дыры.
   Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { stripComments } = require("./helpers/stripComments.js");

const SRC = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");

/* Тело функции: от объявления до следующего `\nfunction ` верхнего уровня — как в соседних
   *Wiring-тестах. refreshAfterRoomAssignments и renderAll — верхнеуровневые соседи, этого хватает. */
function functionBody(name) {
  const start = SRC.indexOf("function " + name);
  assert.ok(start >= 0, "функция " + name + " должна существовать в app.js");
  const rest = SRC.slice(start + 1);
  const nextIdx = rest.indexOf("\nfunction ");
  return nextIdx >= 0 ? rest.slice(0, nextIdx) : rest;
}

test("refreshAfterRoomAssignments держит ПОЛНЫЙ контракт в правильном порядке", () => {
  const body = stripComments(functionBody("refreshAfterRoomAssignments"));

  const recalc = body.search(/recalculateRoomAssignments\s*\(\s*\)/);
  const paint = body.search(/\bpaint\s*\(\s*\)/);
  const props = body.search(/renderProperties\s*\(\s*\)/);
  const summary = body.search(/renderSummary\s*\(\s*\)/);
  const save = body.search(/\bsave\s*\(\s*\)/);

  assert.ok(recalc >= 0, "контракт обязан начинаться с recalculateRoomAssignments()");
  assert.ok(paint >= 0, "контракт обязан звать paint() — рисование (renderAll / drawWalls+renderRooms / ...)");
  assert.ok(props >= 0,
    "контракт обязан звать renderProperties() — иначе карточка выбранного поста застрянет на прежней комнате и цене (это и есть исходный дефект)");
  assert.ok(summary >= 0, "контракт обязан звать renderSummary() — счётчик «вне помещений» и смета");
  assert.ok(save >= 0, "контракт обязан условно звать save() — способ сохранения приходит параметром");

  /* Порядок значим: сперва пересчитать привязку, затем нарисовать, затем показать карточку и сводку. */
  assert.ok(recalc < paint, "recalculateRoomAssignments обязан идти ДО paint");
  assert.ok(paint < props, "paint обязан идти ДО renderProperties");
  assert.ok(props < summary, "renderProperties обязан идти ДО renderSummary");
});

test("контракт живёт в ОДНОМ месте — прямых вызовов recalculateRoomAssignments ровно два", () => {
  const code = stripComments(SRC);

  const total = (code.match(/recalculateRoomAssignments\s*\(\s*\)/g) || []).length;
  const defs = (code.match(/function\s+recalculateRoomAssignments\s*\(\s*\)/g) || []).length;
  const callSites = total - defs;

  /* Ровно два легитимных вызова: внутри renderAll (полная перерисовка сцены) и внутри
     refreshAfterRoomAssignments (единая точка контракта). Любой потребитель, зовущий
     recalculateRoomAssignments напрямую, — это возврат к размазанному контракту: счётчик
     станет три и выше. Именно так дефект и появился — контракт скопировали неполно. */
  assert.equal(defs, 1, "recalculateRoomAssignments должна быть объявлена ровно один раз");
  assert.equal(callSites, 2,
    "recalculateRoomAssignments() допустим только в renderAll и refreshAfterRoomAssignments; больше — значит контракт снова размазали по потребителям");
});

test("два легитимных вызова recalculateRoomAssignments — это именно renderAll и refreshAfterRoomAssignments", () => {
  const renderAll = stripComments(functionBody("renderAll"));
  const refresh = stripComments(functionBody("refreshAfterRoomAssignments"));

  assert.ok(/recalculateRoomAssignments\s*\(\s*\)/.test(renderAll),
    "renderAll обязан пересчитывать привязку — это полная перерисовка сцены");
  assert.ok(/recalculateRoomAssignments\s*\(\s*\)/.test(refresh),
    "refreshAfterRoomAssignments обязан пересчитывать привязку — это ядро контракта");
});

test("путь стены-перегородки (addWallPoint) идёт через общий контракт, а не мимо него", () => {
  const body = stripComments(functionBody("addWallPoint"));

  assert.ok(/refreshAfterRoomAssignments\s*\(/.test(body),
    "addWallPoint обязан обновлять интерфейс через refreshAfterRoomAssignments");
  assert.ok(!/recalculateRoomAssignments\s*\(\s*\)/.test(body),
    "в addWallPoint не должно быть прямого recalculateRoomAssignments() — это возврат к неполному списку, где выпадал renderProperties");
});

/* --- ПЕРЕПИСЬ ВЫЗОВОВ КОНТРАКТА: класс потребителей застолблён целиком ------------------------

   ЗАЧЕМ ЕЩЁ ОДИН ИНВАРИАНТ. Тесты выше стерегут (а) полноту тела refreshAfterRoomAssignments и
   (б) «прямых recalculateRoomAssignments ровно два». Оба переживают удаление САМОГО вызова
   refreshAfterRoomAssignments(...) у любого потребителя: тело контракта и число прямых recalc не
   меняются. Двойная проверка нашла дыру — удаление строки refreshAfterRoomAssignments(renderRooms)
   в ветке kind==="room" внутри finishDrag оставляло весь прогон зелёным. Последствие: подпись-
   комнату перетащили так, что пост попал в другую компоненту связности, — roomId не пересчитан,
   панель/счётчик/подпись от старого положения, а scheduleSave() на следующей строке уносит в
   сохранение устаревшую привязку.

   ПОЧЕМУ ПЕРЕПИСЬ, А НЕ 15 ОТДЕЛЬНЫХ ПРОВЕРОК «здесь есть вызов». Пятнадцать проверок «в функции X
   есть refreshAfterRoomAssignments» — это то же размножение правила, за которое чинили app.js:
   добавили потребителя — забыли добавить проверку, дыра вернулась. Столбим КЛАСС целиком одним
   числом: сколько в app.js мест, зовущих контракт. Число — факт кода (сегодня 15), не догадка.
   Удаление вызова у ЛЮБОГО из пятнадцати потребителей роняет счётчик до 14 → красный, вне
   зависимости от того, в какой именно функции вызов вырезали. Рост числа (новый потребитель)
   тоже красит — и это правильно: автор нового пути обязан осознанно подтвердить перепись,
   иначе легко завести потребителя, который меняет геометрию мимо контракта.

   Комментарии вырезаны общим stripComments — «закомментировать вызов, не удаляя строку» тоже
   роняет счётчик (для теста такого вызова не существует). */
const CONTRACT_CALL_SITES = 15; // перепись refreshAfterRoomAssignments(...) в js/app.js на сегодня

test("все потребители зовут контракт: перепись вызовов refreshAfterRoomAssignments не изменилась", () => {
  const code = stripComments(SRC);

  const total = (code.match(/refreshAfterRoomAssignments\s*\(/g) || []).length;
  const defs = (code.match(/function\s+refreshAfterRoomAssignments\s*\(/g) || []).length;
  const callSites = total - defs;

  assert.equal(defs, 1, "refreshAfterRoomAssignments должна быть объявлена ровно один раз");
  assert.equal(callSites, CONTRACT_CALL_SITES,
    "число вызовов контракта refreshAfterRoomAssignments изменилось: стало " + callSites +
    ", ожидалось " + CONTRACT_CALL_SITES + ". Меньше — у какого-то потребителя вырезали вызов, " +
    "и он меняет геометрию мимо контракта (roomId не пересчитан, save уносит устаревшую привязку). " +
    "Больше — появился новый потребитель: подтвердите перепись здесь, убедившись, что он ходит " +
    "через refreshAfterRoomAssignments, а не через прямой recalculateRoomAssignments().");
});
