/* Автотесты единого изображения собранного поста (js/postImage.js).
   Модуль чистый (как offerPdf.js/installSheet.js): на вход spec + esc, на выход строка
   HTML с инлайн-стилями — браузер поднимать не нужно. Проверяем: фото накладки как основа,
   наложение модулей по окну, импост между постами, схему-фолбэк без фото, экранирование. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildHtml } = require("../js/postImage.js");

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const deps = { esc };

const framePhoto = { name: "Накладка 3М", code: "09673.13", imageUrl: "https://vimar.ru/x.jpg", opening: { left: 21.5, top: 23, width: 57, height: 53.5, aspect: 1.39 } };

test("режим фото: фотография накладки — подложка, окно позиционируется её геометрией", () => {
  const spec = {
    size: "lg", frame: framePhoto,
    rows: [{ posts: [{ capacity: 3, cells: [
      { span: 1, imageUrl: "https://m/a.jpg", icon: "⌁", name: "Выключатель" },
      { span: 2, imageUrl: "", icon: "◉", name: 'Розетка "2М"' }   // без фото → иконка-силуэт
    ] }] }]
  };
  const html = buildHtml(spec, deps);
  assert.match(html, /<img src="https:\/\/vimar\.ru\/x\.jpg"[^>]*object-fit:contain/, "фото накладки как основа (contain)");
  assert.match(html, /left:21\.5%;top:23%;width:57%;height:53\.5%/, "окно накладки по frameOpening (%)");
  assert.match(html, /<img src="https:\/\/m\/a\.jpg"[^>]*object-fit:cover/, "фото механизма поверх окна (cover)");
  assert.match(html, /09673\.13/, "артикул накладки в подписи (lg)");
});

test("экранирование имён накладки и механизма — без живых тегов", () => {
  const spec = {
    size: "lg", frame: Object.assign({}, framePhoto, { name: "Рамка <b>X</b>" }),
    rows: [{ posts: [{ capacity: 1, cells: [{ span: 1, icon: "⌁", name: 'Кнопка "A"' }] }] }]
  };
  const html = buildHtml(spec, deps);
  assert.ok(!/<b>X<\/b>/.test(html), "имя накладки экранировано");
  assert.ok(!/name="Кнопка "A""/.test(html), "имя механизма экранировано в title");
});

test("немецкая 2+2: одно фото накладки и импост-разделитель между двумя постами", () => {
  const spec = {
    size: "md", frame: Object.assign({}, framePhoto, { code: "09664.01" }),
    rows: [{ posts: [
      { capacity: 2, cells: [{ span: 1, icon: "a", name: "" }, { span: 1, icon: "b", name: "" }] },
      { capacity: 2, cells: [{ span: 2, icon: "c", name: "" }] }
    ] }]
  };
  const html = buildHtml(spec, deps);
  assert.equal((html.match(/object-fit:contain/g) || []).length, 1, "накладка одна (одно фото-подложка), а не две рамки");
  assert.match(html, /background:#334a63/, "виден импост-разделитель между постами");
});

test("один пост (итальянская сплошная): импоста между постами нет", () => {
  const spec = { size: "md", frame: framePhoto, rows: [{ posts: [{ capacity: 3, cells: [{ span: 3, icon: "x", name: "" }] }] }] };
  const html = buildHtml(spec, deps);
  assert.ok(!/background:#334a63/.test(html), "у однопостовой сплошной накладки импоста нет");
});

test("двухрядная «4+4»: два ряда с импостом между ними", () => {
  const spec = {
    size: "md", frame: Object.assign({}, framePhoto, { code: "14668.01" }),
    rows: [
      { posts: [{ capacity: 4, cells: [{ span: 4, icon: "x", name: "" }] }] },
      { posts: [{ capacity: 4, cells: [{ span: 4, empty: true }] }] }
    ]
  };
  const html = buildHtml(spec, deps);
  assert.match(html, /background:#334a63/, "импост между рядами двухрядной накладки");
  assert.ok((html.match(/display:flex;flex:1 1 0/g) || []).length >= 2, "нарисованы оба ряда");
});

test("нет фото накладки — запасная схема-контур, разбиение на посты сохранено", () => {
  const spec = {
    size: "lg", frame: { name: "Без фото", code: "X", imageUrl: "", opening: { aspect: 1.66 } },
    rows: [{ posts: [
      { capacity: 2, cells: [{ span: 2, icon: "a", name: "" }] },
      { capacity: 2, cells: [{ span: 2, empty: true }] }
    ] }]
  };
  const html = buildHtml(spec, deps);
  assert.ok(!/object-fit:contain/.test(html), "фото-подложки нет");
  assert.match(html, /border:4px solid #244d72/, "нарисован контур накладки (схема-фолбэк)");
  assert.match(html, /background:#334a63/, "импост между постами есть и в схеме");
});

test("пустой spec не роняет отрисовку", () => {
  assert.match(buildHtml({}, deps), /assembled-post/);
  assert.match(buildHtml(null, deps), /assembled-post/);
});
