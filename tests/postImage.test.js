/* Автотесты единого изображения собранного поста (js/postImage.js).
   Модуль чистый (как offerPdf.js/installSheet.js): на вход spec + esc, на выход строка
   HTML с инлайн-стилями — браузер поднимать не нужно. Проверяем экранирование и то, что
   импосты/ряды присутствуют (посты рисуются отдельными сегментами). */
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildHtml } = require("../js/postImage.js");

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const deps = { esc };

test("экранирует имя рамки и механизма, не оставляя живых тегов", () => {
  const spec = {
    size: "lg",
    frame: { name: "Рамка <b>X</b>", code: "09664.01" },
    rows: [{ posts: [{ capacity: 2, cells: [{ span: 1, icon: "⌁", name: 'Кнопка "A"' }, { span: 1, empty: true }] }] }]
  };
  const html = buildHtml(spec, deps);
  assert.match(html, /class="assembled-post"/);
  assert.ok(!/<b>X<\/b>/.test(html), "имя рамки в подписи экранировано");
  assert.match(html, /09664\.01/, "артикул рамки в подписи");
});

test("двухрядная накладка «4+4»: два ряда, в каждом по посту-сегменту", () => {
  const spec = {
    size: "md",
    rows: [
      { posts: [{ capacity: 4, cells: [{ span: 4, icon: "◉", name: "Розетка 4М" }] }] },
      { posts: [{ capacity: 4, cells: [{ span: 4, empty: true }] }] }
    ]
  };
  const html = buildHtml(spec, deps);
  /* каждый ряд — свой flex-контейнер; между рядами — вертикальный зазор (импост) */
  assert.ok((html.match(/display:flex;gap:/g) || []).length >= 2, "нарисованы оба ряда");
});

test("пустой spec не роняет отрисовку", () => {
  assert.match(buildHtml({}, deps), /assembled-post/);
  assert.match(buildHtml(null, deps), /assembled-post/);
});
