/* ПОВЕДЕНЧЕСКИЙ регресс: renderSummary заводит строку «Вне помещений» в #lightingSummary.

   ЗАЧЕМ ЭТОТ ТЕСТ, ЕСЛИ ЕСТЬ orphanWarning.test.js. Тот исполняет orphanObjectsWarningHtml в
   отрыве и проверяет её ВЫХОД (текст, счётчик, денежную оговорку). Но он не стережёт ПРОВОДКУ:
   что renderSummary действительно приклеивает этот выход к #lightingSummary. Состязательный
   проход это подтвердил — удаление `+orphanObjectsWarningHtml()` из строки
   `$("lightingSummary").innerHTML=lightingHtml(...)+orphanObjectsWarningHtml()` оставляло весь
   прогон зелёным: единственный потребитель предупреждения (addWallPoint → контракт → renderSummary)
   проверяет вызов renderSummary, но не то, ЧТО попадает в узел. Провод «строка → #lightingSummary»
   не был застолблён ничем.

   КАК. app.js — монолит-оркестратор (DOM, state), в node не грузится. Вырезаем ИСХОДНЫЙ ТЕКСТ
   двух функций — renderSummary и настоящей orphanObjectsWarningHtml — и исполняем renderSummary в
   vm-контексте на DOM-шиме. Всё, что renderSummary дёргает по пути (projectLighting, buildEstimate,
   money, lightingHtml, updateStatus), — ЗАГЛУШКИ: их корректность стережётся своими тестами
   (estimate/lightingByRoom/...), здесь они не предмет. А вот orphanObjectsWarningHtml берётся
   НАСТОЯЩАЯ, вместе с настоящим EPRoomAssign, — значит счётчик в проверяемой строке реальный.

   ЧТО ЛОВИТ. Убрать `+orphanObjectsWarningHtml()` из renderSummary → в #lightingSummary ляжет
   только заглушка lightingHtml, строки «Вне помещений» не будет → красный. Перенаправить запись
   в другой узел (сменить id) → шим отдаст пустой #lightingSummary → красный.

   ЧЕГО НЕ ЛОВИТ (честно). Не проверяет смету, раскрой групп света и вёрстку lightingHtml — они
   заглушены. Проверяет ровно одно звено: renderSummary пишет в #lightingSummary конкатенацию
   групп света и предупреждения о сиротах. Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EPRoomAssign = require("../js/roomAssign.js");

const SRC = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");

/* Исходник функции: от объявления до следующего `\nfunction ` верхнего уровня — как в соседних
   *Behavior/*Wiring-тестах. renderSummary и orphanObjectsWarningHtml — верхнеуровневые соседи. */
function functionSource(name) {
  const start = SRC.indexOf("function " + name);
  assert.ok(start >= 0, "функция " + name + " должна существовать в app.js");
  const rest = SRC.slice(start);
  const nextIdx = rest.indexOf("\nfunction ", 1);
  return nextIdx >= 0 ? rest.slice(0, nextIdx) : rest;
}

/* DOM-шим: $ отдаёт по id элемент-заглушку, у которого renderSummary трогает textContent/hidden/
   innerHTML. Все обращения складываем в один реестр, чтобы после прогона прочитать #lightingSummary
   именно тем id, каким его записал renderSummary — сменят id в app.js, и здесь узел окажется пуст. */
function makeDom() {
  const els = {};
  const $ = id => (els[id] || (els[id] = { textContent: "", innerHTML: "", hidden: false }));
  return { els: els, $: $ };
}

/* Заглушки-соседи renderSummary. money/lightingHtml дают узнаваемые маркеры, чтобы отличить
   «легли только группы света» от «легли группы + предупреждение». buildEstimate отдаёт нули с
   пустыми группами — форма важнее чисел, числа стережёт estimate.test.js. */
function buildRenderSummary(dom, state) {
  const ctx = {
    state: state,
    EPRoomAssign: EPRoomAssign,
    $: dom.$,
    money: v => "money(" + v + ")",
    esc: s => String(s),
    projectLighting: () => ({}),
    buildEstimate: () => ({
      equipment: 0, materials: 0, work: 0, total: 0,
      discount: 0, discountPercent: 0, vat: 0, vatPercent: 0, groups: []
    }),
    lightingHtml: () => "[LIGHTING_HTML]",
    updateStatus: () => {}
  };
  vm.createContext(ctx);
  const code = functionSource("orphanObjectsWarningHtml")
    + "\n" + functionSource("renderSummary")
    + "\n;renderSummary;";
  return vm.runInContext(code, ctx);
}

const stateOf = (rooms, devices, posts) => ({ rooms: rooms, devices: devices, posts: posts });
const dev = roomId => ({ id: "d" + Math.random(), roomId: roomId });
const post = roomId => ({ id: "p" + Math.random(), roomId: roomId });

test("renderSummary кладёт строку «Вне помещений: N» в #lightingSummary рядом с группами света", () => {
  const dom = makeDom();
  // комната есть, три объекта вне неё — orphanObjectsWarningHtml обязана вернуть непустую строку
  const state = stateOf([{ id: "R1" }], [dev(null), dev(null)], [post(null)]);
  const render = buildRenderSummary(dom, state);
  render();

  const html = dom.els.lightingSummary.innerHTML;
  assert.match(html, /\[LIGHTING_HTML\]/, "группы света должны попасть в #lightingSummary");
  assert.match(html, /Вне помещений:\s*3/,
    "строка-предупреждение с реальным счётчиком обязана быть приклеена к #lightingSummary — иначе провод renderSummary→orphanObjectsWarningHtml оборван");
});

test("сирот нет → в #lightingSummary только группы света, без строки предупреждения", () => {
  const dom = makeDom();
  const state = stateOf([{ id: "R1" }], [dev("R1")], [post("R1")]);
  const render = buildRenderSummary(dom, state);
  render();

  const html = dom.els.lightingSummary.innerHTML;
  assert.equal(html, "[LIGHTING_HTML]",
    "без сирот orphanObjectsWarningHtml возвращает пусто — в узле остаются одни группы света");
});
