/* Поведенческий тест строки счётчиков над планом (остаток Б1, §4.8): исполняем НАСТОЯЩИЙ текст
   statusCountsText+updateStatus из app.js в vm-стенде (helpers/appStand). Одиночные элементы больше
   не ставятся, но в старых проектах остаются в смете — правило: «Элементов: N» показывается ТОЛЬКО
   когда элементы есть; на чистом проекте счётчик молчит. Мутационная опора — два края (0 и >0). */
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

/* Запускает настоящую updateStatus (тянет за собой const-стрелку statusCountsText) на state с
   заданными счётчиками и возвращает записанный в #status текст. */
function statusFor(devices, posts, rooms) {
  const dom = stand.makeDom();
  const state = {
    devices: Array.from({ length: devices }),
    posts: Array.from({ length: posts }),
    rooms: Array.from({ length: rooms })
  };
  stand.runNamed(["statusCountsText", "updateStatus"], { state, $: dom.$ })();
  return dom.$("status").textContent;
}

test("нет элементов: строка без «Элементов», только посты и комнаты", () => {
  assert.equal(statusFor(0, 3, 2), "Постов: 3 · Комнат: 2");
});

test("есть элементы (старый проект): «Элементов: N» показывается, чтобы их было видно", () => {
  assert.equal(statusFor(2, 3, 2), "Элементов: 2 · Постов: 3 · Комнат: 2");
});
