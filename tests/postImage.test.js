/* Автотесты единого изображения собранного поста (js/postImage.js).
   Собранный пост рисуется СХЕМОЙ, а не фотографиями (решение владельца): накладка —
   прямоугольник цвета из каталога, модули — ячейки со значком-типом, номером и импостом.
   Модуль чистый (как offerPdf.js/installSheet.js): на вход spec + esc, на выход строка HTML
   с инлайн-стилями — браузер поднимать не нужно. Логика цвета (frameColor) и значка
   (pickIcon) вынесены в экспорт и проверяются отдельно от отрисовки. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildHtml, frameColor, pickIcon } = require("../js/postImage.js");

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const deps = { esc };

/* ── Цвет накладки по названию ─────────────────────────────────────────────── */

test("frameColor: белая накладка — светлая (тёмные подписи, светлая заливка)", () => {
  const c = frameColor("Накладка на 3 модуля, белая");
  assert.equal(c.dark, false, "белая — светлая накладка");
  assert.match(c.fill, /^#f/i, "заливка почти-белая");
  assert.match(c.ink, /^#2/i, "подписи тёмные — читаемы на светлом");
});

test("frameColor: карбон/чёрная — тёмная (светлые подписи и контур)", () => {
  const carbon = frameColor("Накладка на 2 модуля, карбон матовый");
  assert.equal(carbon.dark, true, "карбон — тёмная накладка");
  assert.equal(carbon.ink, "#eef2f6", "подписи светлые — читаемы на тёмном");
  assert.match(carbon.border, /255,255,255/, "контур светлый на тёмной накладке");
  assert.equal(frameColor("Рамка чёрная").dark, true, "чёрная — тоже тёмная (ё→е)");
});

test("frameColor: серебристая — серая; неизвестный цвет — нейтральный серый", () => {
  assert.equal(frameColor("Накладка серебристая").label, "серебристый");
  assert.equal(frameColor("Накладка серебристая").dark, false);
  const unknown = frameColor("Накладка без указания цвета");
  assert.equal(unknown.label, "—", "неизвестный цвет распознан как нейтральный");
  assert.equal(unknown.fill, "#c6cacf", "нейтральная серая заливка");
});

test("frameColor: явный color приоритетнее названия", () => {
  const c = frameColor("Накладка на 3 модуля", "карбон матовый");
  assert.equal(c.dark, true, "цвет взят из явного поля color");
});

/* ── Выбор значка по функциональной группе ─────────────────────────────────── */

test("pickIcon: тип определяется функциональной группой (categoryId), не фото", () => {
  assert.equal(pickIcon({ categoryId: 500 }), "switch", "500 — выключатели");
  assert.equal(pickIcon({ categoryId: 300 }), "socket", "300 — розетки");
  assert.equal(pickIcon({ categoryId: 600 }), "dimmer", "600 — диммеры");
  assert.equal(pickIcon({ categoryId: 800 }), "smart", "800 — умный дом");
  assert.equal(pickIcon({ categoryId: 900 }), "key", "900 — клавиши/аксессуары");
});

test("pickIcon: 400 уточняется USB/TV/LAN, 700 — датчик/термостат", () => {
  assert.equal(pickIcon({ categoryId: 400, icon: "USB", name: "Розетка USB" }), "usb");
  assert.equal(pickIcon({ categoryId: 400, icon: "TV", name: "Розетка TV" }), "tv");
  assert.equal(pickIcon({ categoryId: 400, icon: "LAN", name: "Розетка RJ45" }), "lan");
  assert.equal(pickIcon({ categoryId: 400, name: "Аудиорозетка" }), "lan", "прочая слаботочка — сетевой значок");
  assert.equal(pickIcon({ categoryId: 700, name: "Датчик движения" }), "sensor");
  assert.equal(pickIcon({ categoryId: 700, name: "Термостат комнатный" }), "thermostat");
});

test("pickIcon: без categoryId падаем на символ функциональной группы", () => {
  assert.equal(pickIcon({ icon: "⌁" }), "switch");
  assert.equal(pickIcon({ icon: "◉" }), "socket");
  assert.equal(pickIcon({}), "generic", "совсем без признаков — нейтральный значок");
});

/* ── Отрисовка схемы ───────────────────────────────────────────────────────── */

const italian3M = {
  size: "lg", frame: { name: "Накладка на 3 модуля, белая", code: "09673.01" },
  rows: [{ posts: [{ capacity: 3, cells: [
    { span: 1, categoryId: 500, icon: "⌁", name: "Выключатель", num: "1" },
    { span: 2, categoryId: 300, icon: "◉", name: "Розетка 2М", num: "2–3" }
  ] }] }]
};

test("накладка залита цветом из каталога, без единого <img>", () => {
  const html = buildHtml(italian3M, deps);
  assert.ok(!/<img/.test(html), "внутри собранного поста нет фотографий");
  assert.match(html, /data-ep="plate"[^>]*background:#f4f5f2/, "пластина залита цветом накладки (белый)");
  assert.match(html, /09673\.01/, "артикул накладки в подписи (lg)");
});

test("ячейки пропорциональны числу модулей: 2М вдвое шире 1М", () => {
  const html = buildHtml(italian3M, deps);
  assert.match(html, /flex:1 1 0[^"]*"[^>]*>\s*<svg/, "1М-ячейка — flex:1");
  assert.match(html, /flex:2 1 0/, "2М-ячейка — flex:2 (вдвое шире)");
  assert.match(html, /<svg[^>]*viewBox="0 0 24 24"/, "значок нарисован инлайн-SVG");
});

test("итальянская сплошная (один пост): импоста между постами нет", () => {
  const html = buildHtml(italian3M, deps);
  assert.ok(!/data-ep="impost"/.test(html), "у однопостовой накладки импоста нет");
});

test("немецкая 2+2 (два поста): импост-разделитель между постами есть", () => {
  const spec = {
    size: "md", frame: { name: "Накладка на 4 модуля (2+2), белая", code: "09664.01" },
    rows: [{ posts: [
      { capacity: 2, cells: [{ span: 1, categoryId: 500, num: "1" }, { span: 1, empty: true, num: "2" }] },
      { capacity: 2, cells: [{ span: 2, categoryId: 300, num: "1–2" }] }
    ] }]
  };
  const html = buildHtml(spec, deps);
  assert.match(html, /data-ep="impost"/, "виден импост между двумя постами");
  assert.ok(!/<img/.test(html), "фото нет и в документе (md)");
});

test("двухрядная «4+4»: импост и между рядами", () => {
  const spec = {
    size: "md", frame: { name: "Накладка 4+4, белая", code: "14668.01" },
    rows: [
      { posts: [{ capacity: 4, cells: [{ span: 4, categoryId: 500, num: "1–4" }] }] },
      { posts: [{ capacity: 4, cells: [{ span: 4, empty: true, num: "1" }] }] }
    ]
  };
  const html = buildHtml(spec, deps);
  assert.match(html, /data-ep="impost"/, "импост между рядами двухрядной накладки");
});

test("тёмная накладка: подписи и значки светлые (читаемость)", () => {
  const spec = {
    size: "lg", frame: { name: "Накладка на 2 модуля, карбон матовый", code: "09662.14" },
    rows: [{ posts: [{ capacity: 2, cells: [{ span: 1, categoryId: 500, icon: "⌁", name: "Выключатель", num: "1" }, { span: 1, empty: true, num: "2" }] }] }]
  };
  const html = buildHtml(spec, deps);
  assert.match(html, /data-ep="plate"[^>]*background:#2c2f33/, "тёмная заливка накладки");
  assert.match(html, /color:#eef2f6/, "номер модуля светлый — читается на тёмной");
  assert.match(html, /<svg[^>]*stroke="#eef2f6"/, "значок светлый — читается на тёмной");
});

test("миниатюра (sm): только заливка, ячейки и импост — без значков и номеров", () => {
  const spec = {
    size: "sm", frame: { name: "Накладка на 4 модуля (2+2), белая", code: "09664.01" },
    rows: [{ posts: [
      { capacity: 2, cells: [{ span: 1, categoryId: 500, num: "1" }, { span: 1, empty: true, num: "2" }] },
      { capacity: 2, cells: [{ span: 2, categoryId: 300, num: "1–2" }] }
    ] }]
  };
  const html = buildHtml(spec, deps);
  assert.ok(!/<svg/.test(html), "на миниатюре значков нет (не превращаем в кашу)");
  assert.ok(!/font-size:0px/.test(html), "номеров на миниатюре тоже нет");
  assert.match(html, /data-ep="plate"/, "но пластина есть");
  assert.match(html, /data-ep="cell"/, "и ячейки есть");
  assert.match(html, /data-ep="impost"/, "и импост есть");
});

test("экранирование имён накладки и механизма — без живых тегов", () => {
  const spec = {
    size: "lg", frame: { name: "Рамка <b>X</b>", code: "09673.01" },
    rows: [{ posts: [{ capacity: 1, cells: [{ span: 1, categoryId: 500, name: 'Кнопка "A"', num: "1" }] }] }]
  };
  const html = buildHtml(spec, deps);
  assert.ok(!/<b>X<\/b>/.test(html), "имя накладки экранировано");
  assert.match(html, /title="Кнопка &quot;A&quot;"/, "имя механизма экранировано в title");
});

test("пустой spec не роняет отрисовку", () => {
  assert.match(buildHtml({}, deps), /assembled-post/);
  assert.match(buildHtml(null, deps), /assembled-post/);
});
