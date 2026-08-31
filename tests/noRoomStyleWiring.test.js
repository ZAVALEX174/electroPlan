/* Структурный регресс: пять CSS-правил метки «вне помещений» существуют и объявляют непустой блок.

   ЗАЧЕМ. Метка на плане и строка-предупреждение держатся на классах, которые ПИШЕТ JS
   (`no-room` — classList.add/toggle в app.js; `lighting-orphan-note` — в orphanObjectsWarningHtml),
   и на CSS-правилах, которые эти классы РИСУЮТ. DOM-шимы соседних тестов проверяют лишь, что класс
   лёг в classList, а не что под него есть стиль. Состязательный проход показал: удаление всех пяти
   правил из styles.css оставляет прогон зелёным — переименование класса, опечатка в селекторе или
   потеря правила при слиянии молча убирают метку с экрана.

   ГЛАВНОЕ, РАДИ ЧЕГО ТЕСТ. Имена классов берутся НЕ из воздуха, а извлекаются из ТЕКСТА app.js —
   ровно из тех мест, где JS их пишет. Поэтому связь двусторонняя: переименуют класс в JS, не
   тронув CSS (или наоборот) — ожидаемый селектор разойдётся с фактическим, и тест покраснеет.

   ЧТО ЛОВИТ:
     - удаление/переименование любого из пяти селекторов в CSS → селектор не найден → красный;
     - переименование класса `no-room`/`lighting-orphan-note` в app.js без правки CSS → красный;
     - селектор на месте, но блок опустошён до `{}` → нет ни одного объявления → красный.

   ЧЕГО НЕ ЛОВИТ (честно). Тест НЕ проверяет, что стиль ВИЗУАЛЬНО работает: не смотрит на значения
   свойств, каскад, специфичность или что кольцо реально видно. Он утверждает ровно две вещи про
   каждый селектор — что он существует и что его блок объявляет хотя бы одно свойство. Запуск:
   node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dir = path.join(__dirname, "..");
const APP = fs.readFileSync(path.join(dir, "js", "app.js"), "utf8");
const CSS = fs.readFileSync(path.join(dir, "css", "styles.css"), "utf8");

/* --- Имена классов ИЗ JS ------------------------------------------------------------------- */
/* Класс метки — тот, что app.js переключает ПО критерию isOutsideRooms (syncNoRoomClass) и
   ставит при создании иконки (compactIcon). Извлекаем из обоих мест и требуем совпадения: так
   переименование в любом из них ловится, а к CSS уходит именно тот класс, что реально пишется. */
const toggleMatch = APP.match(/classList\s*\.\s*toggle\(\s*["']([\w-]+)["']\s*,\s*EPRoomAssign\s*\.\s*isOutsideRooms/);
const addMatch = APP.match(/isOutsideRooms\([^)]*\)\)\s*el\.classList\s*\.\s*add\(\s*["']([\w-]+)["']/);
assert.ok(toggleMatch, "в app.js должен быть classList.toggle(<класс>, EPRoomAssign.isOutsideRooms(...)) — иначе тест сторожит не тот класс");
assert.ok(addMatch, "в app.js должен быть el.classList.add(<класс>) под isOutsideRooms (compactIcon)");
assert.equal(addMatch[1], toggleMatch[1],
  "класс метки в compactIcon и syncNoRoomClass обязан быть один — иначе метка на экране расходится сама с собой");
const NO_ROOM = toggleMatch[1];

/* Класс строки-предупреждения — тот, что orphanObjectsWarningHtml печатает в разметку. */
const noteMatch = APP.match(/<div class="([\w-]+)">\s*⚠\s*Вне помещений/);
assert.ok(noteMatch, "orphanObjectsWarningHtml должна печатать <div class=\"...\">⚠ Вне помещений — иначе тест сторожит не тот класс");
const NOTE = noteMatch[1];

/* --- Разбор CSS в правила ------------------------------------------------------------------ */
/* Снимаем комментарии, затем набираем плоские правила `селекторы { блок }`. Все пять целевых
   правил — верхнего уровня, вложенности у них нет, плоского разбора достаточно. */
const cssNoComments = CSS.replace(/\/\*[\s\S]*?\*\//g, " ");
const rules = [];
let m;
const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
while ((m = ruleRe.exec(cssNoComments))) {
  const selectors = m[1].split(",").map(s => s.trim()).filter(Boolean);
  rules.push({ selectors: selectors, block: m[2] });
}

/* Канонизация селектора: без пробелов, `::` → `:` (псевдоэлемент можно писать и так, и так),
   нижний регистр. Порядок символов не трогаем — реорядок классов внутри правила в списке мутаций
   не значится, а CSS проекта заморожен, так что сверяем как есть. */
const canon = s => s.replace(/\s+/g, "").replace(/::/g, ":").toLowerCase();

/* Блок непустой = объявляет хотя бы одно свойство `имя: значение`. Пустой `{}` или `{ }` не пройдёт. */
const hasDeclaration = block => /[a-z-]+\s*:\s*[^;{}]+/i.test(block);

/* Ищем правило, у которого ИМЕННО этот селектор (точное совпадение по канону, не по подстроке —
   иначе `.plan-icon.no-room` считался бы «найденным» из-за правила `.plan-icon.no-room:after`). */
function ruleWithSelector(selector) {
  const want = canon(selector);
  for (const r of rules) {
    if (r.selectors.some(sel => canon(sel) === want)) return r;
  }
  return null;
}

function assertSelectorLive(selector) {
  const rule = ruleWithSelector(selector);
  assert.ok(rule, "в css/styles.css должно быть правило `" + selector + "` — удалён, переименован или разошёлся с классом в app.js");
  assert.ok(hasDeclaration(rule.block),
    "правило `" + selector + "` не должно иметь пустой блок — селектор без объявлений метку не рисует");
}

/* --- Четыре правила метки no-room --------------------------------------------------------- */
const noRoomSelectors = [
  ".plan-icon." + NO_ROOM,
  ".plan-icon." + NO_ROOM + ":after",
  ".plan-icon." + NO_ROOM + ":hover",
  ".plan-icon." + NO_ROOM + ".dragging"
];
for (const selector of noRoomSelectors) {
  test("CSS-правило метки существует и объявляет непустой блок: " + selector, () => {
    assertSelectorLive(selector);
  });
}

/* --- Правило строки-предупреждения -------------------------------------------------------- */
test("CSS-правило строки-предупреждения существует и объявляет непустой блок: ." + NOTE, () => {
  assertSelectorLive("." + NOTE);
});
