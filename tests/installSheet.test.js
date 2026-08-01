/* Автотесты листа монтажника (PLAN 11).
   Запуск без зависимостей и без сборщика:  node --test tests/
   Модуль js/installSheet.js — чистый: на вход готовые данные и esc, на выход строка HTML,
   поэтому браузер поднимать не нужно. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildHtml } = require("../js/installSheet.js");

/* esc как в приложении — чтобы проверить экранирование пользовательского ввода. */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const deps = { esc };

const italianPost = {
  number: 3, room: "Кухня", standardLabel: "итальянский · одна коробка на сборку",
  frameName: "Накладка Neve Up 3М", frameCode: "09663", color: "Карбон матовый",
  modules: [
    { label: "1", name: "Выключатель 1П 16AX", code: "20001", note: "" },
    { label: "2–3", name: "Розетка 2P+T 16A", code: "20208", note: "занимает 2 модуля" }
  ],
  fittings: [
    { role: "Суппорт", name: "Суппорт Neve Up 3М", code: "09613", count: 1 },
    { role: "Монтажная коробка", name: "Коробка 3М", code: "V71303", count: 1 },
    { role: "Накладка", name: "Накладка Neve Up 3М", code: "09663", count: 1 }
  ],
  german: null
};

test("одиночный пост: заголовок с номером, таблица модулей и обвязка", () => {
  const html = buildHtml({ posts: [italianPost] }, deps);
  assert.match(html, /Пост № 3/, "номер поста в шапке");
  assert.match(html, /2–3/, "точная позиция многомодульного механизма");
  assert.match(html, /20208/, "артикул механизма");
  assert.match(html, /Обвязка поста/, "блок обвязки под таблицей модулей");
  /* порядок обвязки: суппорт → коробка → накладка. Имя накладки встречается и в шапке
     поста, поэтому проверяем порядок ВНУТРИ блока обвязки, а не по всему документу. */
  const fit = html.slice(html.indexOf("Обвязка поста"));
  assert.ok(fit.indexOf("Суппорт Neve Up 3М") < fit.indexOf("Коробка 3М"), "суппорт раньше коробки");
  assert.ok(fit.indexOf("Коробка 3М") < fit.indexOf("Накладка Neve Up 3М"), "коробка раньше накладки");
});

test("немецкий стандарт: примечание о разбиении на посты и импостах", () => {
  const dePost = Object.assign({}, italianPost, { number: 5, german: { postCount: 2 } });
  const html = buildHtml({ posts: [dePost] }, deps);
  assert.match(html, /импост/i, "монтажнику показано, что коробок несколько");
  assert.match(html, /2</, "число постов из german.postCount");
});

test("пустые поля шапки не печатаются, а введённые — экранируются", () => {
  const html = buildHtml({
    header: { project: 'Дом <b>А</b>', developer: "", date: "01.08.2026" },
    posts: [italianPost]
  }, deps);
  assert.match(html, /Дом &lt;b&gt;А&lt;\/b&gt;/, "тег из ввода экранирован");
  assert.ok(!/Разработчик/.test(html), "пустое поле «Разработчик» не выведено");
  assert.match(html, /01\.08\.2026/, "дата выведена");
});

test("весь проект: посты группируются по помещениям, нераспределённые — «Без помещения»", () => {
  const p1 = Object.assign({}, italianPost, { number: 1, room: "Кухня" });
  const p2 = Object.assign({}, italianPost, { number: 2, room: "" });
  const html = buildHtml({ posts: [p1, p2] }, deps);
  assert.match(html, /Кухня/, "заголовок помещения");
  assert.match(html, /Без помещения/, "fallback-группа для постов без помещения");
});

test("пост без механизмов не роняет вёрстку", () => {
  const html = buildHtml({ posts: [Object.assign({}, italianPost, { modules: [], fittings: [] })] }, deps);
  assert.match(html, /Пост без механизмов/, "явная строка вместо пустой таблицы");
});
