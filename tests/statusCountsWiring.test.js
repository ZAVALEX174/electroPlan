/* Поведенческий тест строки счётчиков под планом (остаток Б1, §4.8; Редизайн, ч.3): исполняем
   НАСТОЯЩИЙ текст statusCountsText+updateStatus из app.js в vm-стенде (helpers/appStand). Одиночные
   элементы больше не ставятся, но в старых проектах остаются в смете — правило: «Элементов: N»
   показывается ТОЛЬКО когда элементы есть; на чистом проекте счётчик молчит. Мутационная опора —
   два края (0 и >0).

   Редизайн ч.3 развёл строку статуса на узлы: счётчик переехал из #status в отдельный #statusCounts
   (в #status теперь подсказка инструмента/подсказка по умолчанию). Тест читает #statusCounts — сменят
   узел в app.js, и проверяемый счётчик окажется пуст. */
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

/* Запускает настоящую updateStatus (тянет за собой const-стрелку statusCountsText и const
   DEFAULT_STATUS_HINT, которые она берёт из лексики app.js) на state с заданными счётчиками и
   возвращает записанный в #statusCounts текст. */
function countsFor(devices, posts, rooms) {
  const dom = stand.makeDom();
  const state = {
    devices: Array.from({ length: devices }),
    posts: Array.from({ length: posts }),
    rooms: Array.from({ length: rooms })
  };
  stand.runNamed(["statusCountsText", "DEFAULT_STATUS_HINT", "updateStatus"], { state, $: dom.$ })();
  return dom.$("statusCounts").textContent;
}

test("нет элементов: строка без «Элементов», только посты и комнаты", () => {
  assert.equal(countsFor(0, 3, 2), "Постов: 3 · Комнат: 2");
});

test("есть элементы (старый проект): «Элементов: N» показывается, чтобы их было видно", () => {
  assert.equal(countsFor(2, 3, 2), "Элементов: 2 · Постов: 3 · Комнат: 2");
});

/* Край разведения каналов: счётчик уходит в #statusCounts, а #status при пустом тексте показывает
   подсказку по умолчанию, а НЕ счётчик (иначе редизайн откатился бы к общему узлу). */
test("#status при пустом тексте получает подсказку по умолчанию, а не счётчик", () => {
  const dom = stand.makeDom();
  const state = { devices: [], posts: [1, 2], rooms: [1] };
  stand.runNamed(["statusCountsText", "DEFAULT_STATUS_HINT", "updateStatus"], { state, $: dom.$ })();
  assert.doesNotMatch(dom.$("status").textContent, /Постов:/, "в #status счётчика быть не должно");
  assert.match(dom.$("status").textContent, /пиктограммами/, "в #status — подсказка по умолчанию");
});
