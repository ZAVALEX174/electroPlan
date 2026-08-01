/* Автотесты единого изображения собранного поста (js/postImage.js).
   ОРИЕНТИР — каталожные сборки VIMAR. МОДУЛЬ = НАСТОЯЩЕЕ ФОТО механизма, обрезанное по лицу
   (решение владельца: вариант A — фото, вариант C — нарисованная клавиша ОСТАЁТСЯ ФОЛБЭКОМ, когда
   фото нет). Отличие от двух отвергнутых заходов: лицо вырезается CSS-спрайтом по ИЗМЕРЕННОМУ
   прямоугольнику (faceSprite), а не вставляется фото целиком в угаданное окно — коллажа нет.
   Подложка сборки — фото накладки; посты ложатся в измеренные окна (postWindows/splitOpening).
   Нет фото накладки — СХЕМА-ФОЛБЭК (пластина цвета из названия). Модуль чистый (как
   offerPdf.js/installSheet.js): на вход spec + esc, на выход строка HTML с инлайн-стилями. Логика
   цвета (frameColor), значка фолбэка (pickIcon), деления окна (splitOpening), спрайта лица
   (faceSprite) и выбора «фото или клавиша» (useFacePhoto) вынесены в экспорт и проверяются отдельно. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildHtml, frameColor, pickIcon, splitOpening, postWindows, faceSprite, useFacePhoto, photoReady } = require("../js/postImage.js");

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const deps = { esc };

/* ── Цвет накладки по названию (схема-фолбэк) ───────────────────────────────── */

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

/* ── Деление немецкого окна на посты (splitOpening) ─────────────────────────── */

const OPENING = { left: 20, top: 24, width: 60, height: 52, aspect: 1.4 };
/* Измеренное окно под OPENING: с ним включается режим фото (без измеренных окон — схема-фолбэк,
   даже если фото накладки есть: в каталоге VIMAR это бывает макро-снимок угла без окна в кадре). */
const OPENING_WIN = [{ left: 20, top: 24, width: 60, height: 52 }];
const inside = (r, o) => r.left >= o.left - 0.01 && r.top >= o.top - 0.01
  && r.left + r.width <= o.left + o.width + 0.01
  && r.top + r.height <= o.top + o.height + 0.01;
const overlapX = (a, b) => a.left < b.left + b.width - 0.01 && b.left < a.left + a.width - 0.01;

test("splitOpening: 2+2 → два прямоугольника внутри окна, без пересечения, с зазором", () => {
  const rows = [{ posts: [{ capacity: 2 }, { capacity: 2 }] }];
  const rects = splitOpening(OPENING, rows);
  assert.equal(rects.length, 2, "два поста — два прямоугольника");
  rects.forEach(r => assert.ok(inside(r, OPENING), "прямоугольник не выходит за окно"));
  assert.ok(!overlapX(rects[0], rects[1]), "посты по горизонтали не пересекаются");
  assert.ok(rects[1].left > rects[0].left + rects[0].width, "между постами есть зазор под импост");
  assert.ok(Math.abs(rects[0].width - rects[1].width) < 0.02, "равные ёмкости — равная ширина");
});

test("splitOpening: 2+2+2 → три равных прямоугольника, укладываются в окно", () => {
  const rows = [{ posts: [{ capacity: 2 }, { capacity: 2 }, { capacity: 2 }] }];
  const rects = splitOpening(OPENING, rows);
  assert.equal(rects.length, 3, "три поста — три прямоугольника");
  rects.forEach(r => assert.ok(inside(r, OPENING), "прямоугольник в границах окна"));
  assert.ok(!overlapX(rects[0], rects[1]) && !overlapX(rects[1], rects[2]), "соседние не пересекаются");
  const last = rects[2];
  assert.ok(last.left + last.width <= OPENING.left + OPENING.width + 0.01, "правый край не за окном");
});

test("splitOpening: ширина поста пропорциональна ёмкости (2 vs 4)", () => {
  const rects = splitOpening(OPENING, [{ posts: [{ capacity: 2 }, { capacity: 4 }] }]);
  assert.ok(rects[1].width > rects[0].width * 1.8, "пост на 4 модуля почти вдвое шире поста на 2");
});

test("splitOpening: многорядная — деление по вертикали, ряды не пересекаются", () => {
  const rows = [{ posts: [{ capacity: 4 }] }, { posts: [{ capacity: 4 }] }];
  const rects = splitOpening(OPENING, rows);
  assert.equal(rects.length, 2, "два ряда по посту — два прямоугольника");
  assert.ok(rects[1].top > rects[0].top + rects[0].height, "между рядами вертикальный зазор");
  rects.forEach(r => assert.ok(inside(r, OPENING), "каждый ряд в границах окна"));
});

/* ── Сопоставление ИЗМЕРЕННЫХ окон постам (postWindows) ─────────────────────── */

/* Реальные окна с фото (детектор detect-openings.mjs): 09664.01 (DE 2+2) и 09666.04 (DE 2+2+2). */
const WIN_2 = [{ left: 13.5, top: 23.6, width: 28.5, height: 50.9 }, { left: 58, top: 23.6, width: 28.5, height: 51.8 }];
const WIN_3 = [{ left: 9.3, top: 23, width: 19.6, height: 52 }, { left: 40.4, top: 23, width: 19.2, height: 51.5 }, { left: 71, top: 23, width: 19.6, height: 52 }];

test("postWindows: измеренные окна берутся, когда их число совпало с числом постов", () => {
  const rows = [{ posts: [{ capacity: 2 }, { capacity: 2 }] }];
  const res = postWindows(OPENING, rows, WIN_2);
  assert.equal(res.measured, true, "легли по измеренным окнам, а не по splitOpening");
  assert.deepEqual(res.rects, WIN_2, "пост i → измеренное окно i (слева направо)");
});

test("postWindows: 2+2+2 — три поста ложатся в три измеренных окна", () => {
  const rows = [{ posts: [{ capacity: 2 }, { capacity: 2 }, { capacity: 2 }] }];
  const res = postWindows(OPENING, rows, WIN_3);
  assert.equal(res.measured, true);
  assert.equal(res.rects.length, 3);
  assert.equal(res.rects[2].left, 71, "правое окно — третьему посту");
});

test("postWindows: несовпадение числа окон и постов → фолбэк splitOpening (не рискуем)", () => {
  const rows = [{ posts: [{ capacity: 2 }, { capacity: 2 }, { capacity: 2 }] }];
  const res = postWindows(OPENING, rows, WIN_2);   // 3 поста, но измерено 2 окна
  assert.equal(res.measured, false, "при несовпадении не гадаем, какой пост в какое окно");
  assert.equal(res.rects.length, 3, "splitOpening разложил под 3 поста");
});

test("postWindows: нет измеренных окон → фолбэк splitOpening", () => {
  const rows = [{ posts: [{ capacity: 2 }, { capacity: 2 }] }];
  assert.equal(postWindows(OPENING, rows, null).measured, false);
  assert.equal(postWindows(OPENING, rows, undefined).measured, false);
});

test("postWindows: битые окна отбрасываются, число не сходится → фолбэк", () => {
  const rows = [{ posts: [{ capacity: 2 }, { capacity: 2 }] }];
  const broken = [{ left: 13.5, top: 23.6, width: 28.5, height: 50.9 }, { left: 58, top: 23.6, width: 0, height: 51.8 }];
  assert.equal(postWindows(OPENING, rows, broken).measured, false, "одно окно битое → сходимости нет → splitOpening");
});

test("postWindows: одиночное измеренное окно (итальянская) для единственного поста", () => {
  const rows = [{ posts: [{ capacity: 3 }] }];
  const single = [{ left: 22, top: 23.6, width: 56, height: 51.4 }];   // 09673.01
  const res = postWindows(OPENING, rows, single);
  assert.equal(res.measured, true);
  assert.deepEqual(res.rects, single, "весь пост — в единственном измеренном окне");
});

test("buildHtml режим фото: клавиши раскладываются по ИЗМЕРЕННЫМ окнам накладки", () => {
  const spec = {
    size: "md",
    frame: {
      name: "Накладка на 4 модуля (2+2), белая", code: "09664.01", standard: "DE",
      imageUrl: "https://cdn/frame22.png", opening: { left: 18, top: 22, width: 64, height: 54, aspect: 1.82 },
      windows: WIN_2
    },
    rows: [{ posts: [
      { capacity: 2, cells: [{ span: 1, categoryId: 500, num: "1" }, { span: 1, empty: true, num: "2" }] },
      { capacity: 2, cells: [{ span: 2, categoryId: 300, num: "1–2" }] }
    ] }]
  };
  const html = buildHtml(spec, deps);
  assert.match(html, /left:13\.5%;top:23\.6%;width:28\.5%/, "первый пост — в левом измеренном окне");
  assert.match(html, /left:58%;top:23\.6%;width:28\.5%/, "второй пост — в правом измеренном окне");
  assert.ok(!/data-ep="impost"/.test(html), "импост уже на фото — свой не рисуем");
});

/* ── Гейт «фото накладки или схема-фолбэк» (photoReady) ─────────────────────── */

/* Режим фото включается ТОЛЬКО когда есть И фотография, И измеренные окна. Причина: у части баз
   накладок фото в каталоге VIMAR — макро-снимок угла изделия, где окна в кадре нет (детектор вернул
   пусто); раскладывать по нему клавиши нечего — честная схема лучше догадки. */
test("photoReady: фото + измеренные окна → true; фото без окон → false", () => {
  assert.equal(photoReady({ imageUrl: "https://cdn/f.png", windows: OPENING_WIN }), true, "есть фото и окна");
  assert.equal(photoReady({ imageUrl: "https://cdn/f.png" }), false, "фото есть, окон нет → схема-фолбэк");
  assert.equal(photoReady({ imageUrl: "https://cdn/f.png", windows: [] }), false, "пустой список окон → фолбэк");
  assert.equal(photoReady({ imageUrl: "https://cdn/f.png", windows: [{ left: 5, top: 5, width: 0, height: 40 }] }), false, "все окна битые → фолбэк");
  assert.equal(photoReady({ windows: OPENING_WIN }), false, "окна есть, фото нет → фолбэк");
});

test("buildHtml: есть фото, но окон нет → СХЕМА-ФОЛБЭК (не раскладываем по макро-снимку угла)", () => {
  const spec = {
    size: "lg",
    frame: { name: "Накладка CLASSIC на 1 модуль, графит матовый", code: "19641.01", standard: "IT", imageUrl: "https://cdn/macro-corner.png", opening: OPENING },
    rows: [{ posts: [{ capacity: 1, cells: [{ span: 1, categoryId: 500, name: "Выключатель", num: "1" }] }] }]
  };
  const html = buildHtml(spec, deps);
  assert.ok(!/<img/.test(html), "фото-подложку не берём — окон нет, это схема-фолбэк");
  assert.match(html, /data-ep="plate"/, "рисуется пластина схемы-фолбэка");
});

/* ── Режим ФОТО ────────────────────────────────────────────────────────────── */

const italianPhoto = {
  size: "lg",
  frame: {
    name: "Накладка на 3 модуля, белая", code: "09673.01", standard: "IT",
    imageUrl: "https://cdn/frame3.png", opening: { left: 20, top: 24, width: 60, height: 52, aspect: 1.4 },
    /* измеренное окно есть (иначе фото не включается), но без aspect — проверяем фолбэк аспекта */
    windows: [{ left: 20, top: 24, width: 60, height: 52 }]
  },
  rows: [{ posts: [{ capacity: 3, cells: [
    { span: 1, categoryId: 500, name: "Выключатель", num: "1" },
    { span: 2, categoryId: 300, name: "Розетка 2М", num: "2–3" }
  ] }] }]
};

test("итальянская с фото: одно окно, единственный <img> — фото накладки, клавиши поверх", () => {
  const html = buildHtml(italianPhoto, deps);
  assert.match(html, /<img src="https:\/\/cdn\/frame3\.png"/, "фото накладки — подложка");
  assert.match(html, /<img[^>]*position:absolute;inset:0;width:100%;height:100%/, "фото абсолютным слоем во всю резиновую сцену");
  const imgs = html.match(/<img/g) || [];
  assert.equal(imgs.length, 1, "единственный <img> — фотография накладки; фото механизмов внутрь не идут");
  assert.ok(!/data-ep="impost"/.test(html), "в режиме фото свою полосу-импост не рисуем (она уже на фото)");
  assert.match(html, /<svg[^>]*viewBox="0 0 24 24"/, "на клавише нарисован символ функции");
});

test("немецкая 2+2 с фото: два непересекающихся под-окна, клавиши разложены по постам", () => {
  const spec = {
    size: "md",
    frame: {
      name: "Накладка на 4 модуля (2+2), белая", code: "09664.01", standard: "DE",
      imageUrl: "https://cdn/frame22.png", opening: { left: 18, top: 22, width: 64, height: 54, aspect: 1.66 },
      windows: [{ left: 14, top: 23, width: 29, height: 51 }, { left: 57, top: 23, width: 29, height: 51 }]
    },
    rows: [{ posts: [
      { capacity: 2, cells: [{ span: 1, categoryId: 500, num: "1" }, { span: 1, empty: true, num: "2" }] },
      { capacity: 2, cells: [{ span: 2, categoryId: 300, num: "1–2" }] }
    ] }]
  };
  const html = buildHtml(spec, deps);
  const wins = [...html.matchAll(/position:absolute;left:([\d.]+)%;top:([\d.]+)%;width:([\d.]+)%/g)];
  assert.equal(wins.length, 2, "два поста — два под-окна");
  const l0 = Number(wins[0][1]), w0 = Number(wins[0][3]), l1 = Number(wins[1][1]);
  assert.ok(l1 > l0 + w0, "второе под-окно правее первого с зазором (не пересекаются)");
  assert.ok(!/data-ep="impost"/.test(html), "своей полосы-импоста в режиме фото нет");
  const imgs = html.match(/<img/g) || [];
  assert.equal(imgs.length, 1, "единственный <img> — фотография накладки");
});

test("немецкая 2+2+2 с фото: три под-окна", () => {
  const spec = {
    size: "md",
    frame: {
      name: "Накладка (2+2+2), белая", code: "09666.01", standard: "DE",
      imageUrl: "https://cdn/frame222.png", opening: { left: 12, top: 22, width: 76, height: 55, aspect: 2.4 },
      windows: [{ left: 12, top: 23, width: 20, height: 51 }, { left: 40, top: 23, width: 20, height: 51 }, { left: 68, top: 23, width: 20, height: 51 }]
    },
    rows: [{ posts: [
      { capacity: 2, cells: [{ span: 2, categoryId: 500, num: "1–2" }] },
      { capacity: 2, cells: [{ span: 2, categoryId: 300, num: "1–2" }] },
      { capacity: 2, cells: [{ span: 1, empty: true, num: "1" }, { span: 1, empty: true, num: "2" }] }
    ] }]
  };
  const html = buildHtml(spec, deps);
  const wins = [...html.matchAll(/position:absolute;left:[\d.]+%;top:[\d.]+%;width:[\d.]+%/g)];
  assert.equal(wins.length, 3, "три поста — три под-окна");
});

test("режим фото: клавиша рисует символ функции инлайн-SVG, без onerror-JS", () => {
  const spec = {
    size: "lg",
    frame: { name: "Накладка на 2 модуля, белая", code: "09672.01", standard: "IT", imageUrl: "https://cdn/f2.png", opening: OPENING, windows: OPENING_WIN },
    rows: [{ posts: [{ capacity: 2, cells: [{ span: 2, categoryId: 500, name: "Выключатель", num: "1–2" }] }] }]
  };
  const html = buildHtml(spec, deps);
  assert.match(html, /<svg[^>]*viewBox="0 0 24 24"/, "символ функции нарисован инлайн-SVG на клавише");
  assert.ok(!/onerror/.test(html), "без onerror-JS — печать его не исполнит");
});

test("режим фото: свободный модуль — клавиша-заглушка без символа функции", () => {
  const spec = {
    size: "lg",
    frame: { name: "Накладка на 3 модуля, белая", code: "09673.01", standard: "IT", imageUrl: "https://cdn/f3.png", opening: OPENING, windows: OPENING_WIN },
    rows: [{ posts: [{ capacity: 3, cells: [
      { span: 1, categoryId: 500, num: "1" },
      { span: 1, empty: true, num: "2" },
      { span: 1, empty: true, num: "3" }
    ] }] }]
  };
  const html = buildHtml(spec, deps);
  const imgs = html.match(/<img/g) || [];
  assert.equal(imgs.length, 1, "только фото накладки; на клавишах фото механизмов нет");
  const svgs = html.match(/<svg/g) || [];
  assert.equal(svgs.length, 1, "символ только на заполненной клавише; заглушки-модули — без символа");
});

test("режим фото: тёмная накладка → светлый символ на клавише; светлая → тёмный", () => {
  const base = name => ({
    size: "lg",
    frame: { name, code: "00000.01", standard: "IT", imageUrl: "https://cdn/f.png", opening: OPENING, windows: OPENING_WIN },
    rows: [{ posts: [{ capacity: 1, cells: [{ span: 1, categoryId: 500, num: "1" }] }] }]
  });
  const dark = buildHtml(base("Накладка на 1 модуль, карбон матовый"), deps);
  assert.match(dark, /<svg[^>]*stroke="#eef2f6"/, "тёмная накладка — светлый символ на клавише");
  const light = buildHtml(base("Накладка на 1 модуль, белая"), deps);
  assert.match(light, /<svg[^>]*stroke="#2f4257"/, "светлая накладка — тёмный символ на клавише");
});

/* ── ФОТО МОДУЛЯ: спрайт-обрезка лица (faceSprite) ──────────────────────────── */

/* Реальное лицо 09001.2.CM (2М), снятое детектором: [left,top,width,height] в % фото. */
const FACE_2M = { left: 6.5, top: 8, width: 87, height: 84 };

test("faceSprite: проценты обрезки считаются от лица (реальный 2М 09001.2.CM)", () => {
  const sp = faceSprite(FACE_2M);
  // фото шире ячейки во столько, во сколько лицо у́же фото: 100/0.87
  assert.ok(Math.abs(sp.width - 10000 / 87) < 1e-6, "width% = 10000/face.width");
  assert.ok(Math.abs(sp.height - 10000 / 84) < 1e-6, "height% = 10000/face.height");
  assert.ok(Math.abs(sp.left - (-6.5 * 100 / 87)) < 1e-6, "сдвиг влево = −face.left/face.width");
  assert.ok(Math.abs(sp.top - (-8 * 100 / 84)) < 1e-6, "сдвиг вверх = −face.top/face.height");
});

test("faceSprite: узкое лицо 1М даёт бо́льшую ширину спрайта, чем широкое 2М", () => {
  const oneM = faceSprite({ left: 10.2, top: 8.2, width: 79.5, height: 83.5 }); // 09001.0.250
  const twoM = faceSprite(FACE_2M);
  assert.ok(oneM.width > twoM.width, "чем у́же лицо, тем сильнее увеличиваем фото под ячейку");
});

test("faceSprite: битое/пустое лицо → null (падаем на клавишу-фолбэк)", () => {
  assert.equal(faceSprite(null), null);
  assert.equal(faceSprite({ left: 5, top: 5, width: 0, height: 80 }), null, "нулевая ширина → null");
  assert.equal(faceSprite({ left: 5, top: 5, width: 80 }), null, "нет высоты → null");
});

test("useFacePhoto: фото показываем только при наличии и фото, и лица; пустой модуль — никогда", () => {
  assert.equal(useFacePhoto({ imageUrl: "https://cdn/x.jpg", face: FACE_2M }), true, "есть фото и лицо → фото");
  assert.equal(useFacePhoto({ imageUrl: "", face: FACE_2M }), false, "нет фото → клавиша-фолбэк");
  assert.equal(useFacePhoto({ imageUrl: "https://cdn/x.jpg", face: null }), false, "нет лица → клавиша-фолбэк");
  assert.equal(useFacePhoto({ empty: true, imageUrl: "https://cdn/x.jpg", face: FACE_2M }), false, "свободный модуль — всегда заглушка");
});

test("buildHtml: ячейка с фото и лицом рисуется фотографией-спрайтом, без символа поверх", () => {
  // Накладка БЕЗ фото (схема-фолбэк) — чтобы единственный <img> был именно фото механизма
  const spec = {
    size: "lg",
    frame: { name: "Накладка на 2 модуля, белая", code: "09001", standard: "IT" },
    rows: [{ posts: [{ capacity: 2, cells: [
      { span: 2, categoryId: 300, name: "Розетка 2М", num: "1–2", imageUrl: "https://cdn/socket.jpg", face: FACE_2M }
    ] }] }]
  };
  const html = buildHtml(spec, deps);
  assert.match(html, /<img src="https:\/\/cdn\/socket\.jpg"/, "фото механизма — подложка ячейки");
  assert.match(html, /width:114\.943%/, "спрайт растянут по ширине лица (10000/87)");
  assert.match(html, /left:-7\.471%/, "фото сдвинуто влево на долю левого поля лица");
  assert.match(html, /overflow:hidden/, "поля и лапки уезжают за overflow");
  assert.ok(!/<svg/.test(html), "символ функции поверх фото НЕ рисуем — на фото и так видно");
});

test("buildHtml: тот же модуль без лица → нарисованная клавиша-фолбэк (символ, без фото механизма)", () => {
  const spec = {
    size: "lg",
    frame: { name: "Накладка на 2 модуля, белая", code: "09001", standard: "IT" },
    rows: [{ posts: [{ capacity: 2, cells: [
      { span: 2, categoryId: 300, name: "Розетка 2М", num: "1–2", imageUrl: "https://cdn/socket.jpg", face: null }
    ] }] }]
  };
  const html = buildHtml(spec, deps);
  assert.ok(!/<img/.test(html), "нет лица → фото не тянем (накладка тоже без фото)");
  assert.match(html, /<svg[^>]*viewBox="0 0 24 24"/, "фолбэк — нарисованная клавиша с символом функции");
});

/* ── Резиновая сцена и резерв высоты до загрузки фото (чинит схлопывание и вылезание) ── */

test("режим фото: max-width:100%, высота через процентный padding из измеренного аспекта", () => {
  const spec = {
    size: "md",
    frame: {
      name: "Накладка на 4 модуля (2+2), белая", code: "09664.01", standard: "DE",
      imageUrl: "https://cdn/frame22.png",
      opening: { left: 18, top: 22, width: 64, height: 54, aspect: 1.82 },
      /* измеренные окна несут aspect самого фото (frameOpenings) */
      windows: [
        { left: 13.5, top: 23.6, width: 28.5, height: 50.9, aspect: 1.818 },
        { left: 58, top: 23.6, width: 28.5, height: 51.8, aspect: 1.818 }
      ]
    },
    rows: [{ posts: [
      { capacity: 2, cells: [{ span: 1, categoryId: 500, num: "1" }, { span: 1, empty: true, num: "2" }] },
      { capacity: 2, cells: [{ span: 2, categoryId: 300, num: "1–2" }] }
    ] }]
  };
  const html = buildHtml(spec, deps);
  /* W = 78 + 4·26 = 182; padding-top = (100 / 1.818) = 55.006% — высота держится от ширины */
  assert.match(html, /width:182px;max-width:100%/, "желаемая ширина W, но не больше контейнера");
  assert.match(html, /padding-top:55\.006%/, "высота задана процентным padding от измеренного аспекта");
  assert.match(html, /<img[^>]*position:absolute;inset:0;width:100%;height:100%/, "фото растянуто на весь резиновый слой");
  assert.ok(!/height:\d+px/.test(html), "жёсткой высоты в px у сцены больше нет — она резиновая");
  assert.ok(!/min-height/.test(html), "резерв min-height больше не нужен — место держит padding");
  /* окна в % не изменились приёмом — они и так в процентах */
  assert.match(html, /left:13\.5%;top:23\.6%;width:28\.5%/, "первое окно осталось в тех же процентах");
  assert.match(html, /left:58%;top:23\.6%;width:28\.5%/, "второе окно осталось в тех же процентах");
});

test("режим фото без измеренного аспекта: padding по угаданному opening.aspect, сцена резиновая", () => {
  const html = buildHtml(italianPhoto, deps);   // windows нет → фолбэк на opening.aspect (1.4)
  assert.match(html, /padding-top:71\.429%/, "высота по угаданному аспекту окна, тоже через padding");
  assert.match(html, /max-width:100%/, "сцена всё равно резиновая");
  assert.ok(!/min-height/.test(html), "резерв больше не нужен — место держит padding");
});

test("миниатюра (sm) в режиме фото: значков и номеров нет", () => {
  const spec = {
    size: "sm",
    frame: { name: "Накладка на 2 модуля, белая", code: "09672.01", standard: "IT", imageUrl: "https://cdn/f2.png", opening: OPENING, windows: OPENING_WIN },
    rows: [{ posts: [{ capacity: 2, cells: [{ span: 2, categoryId: 500, name: "Выключатель", num: "1–2" }] }] }]
  };
  const html = buildHtml(spec, deps);
  assert.ok(!/<svg/.test(html), "на миниатюре значков нет (не превращаем в кашу)");
});

/* ── Цвет клавиши — по САМОМУ модулю, а не по накладке ──────────────────────── */

/* Клавиша — отдельный товар со своим цветом (VIMAR: белая накладка может нести серебристые
   клавиши, антрацитовая — белые). Контраст символа считаем ОТ ЦВЕТА КЛАВИШИ. */
const keyOnFrame = (frameName, cellName) => buildHtml({
  size: "lg",
  frame: { name: frameName, code: "0", standard: "IT", imageUrl: "https://cdn/f.png", opening: OPENING, windows: OPENING_WIN },
  rows: [{ posts: [{ capacity: 1, cells: [{ span: 1, categoryId: 500, name: cellName, num: "1" }] }] }]
}, deps);

test("клавиша белого механизма на карбоновой накладке — светлая, символ тёмный", () => {
  const html = keyOnFrame("Накладка на 1 модуль, карбон матовый", "Выключатель 1П 16AX 1 модуль, белый");
  assert.match(html, /<svg[^>]*stroke="#2f4257"/, "символ тёмный — читается на светлой клавише");
  assert.match(html, /background:linear-gradient\(180deg,#f/i, "заливка клавиши светлая (белый механизм)");
});

test("клавиша карбонового механизма на белой накладке — тёмная, символ светлый", () => {
  const html = keyOnFrame("Накладка на 1 модуль, белая", "Переключатель 1П 16AX 2 модуля, карбон матовый");
  assert.match(html, /<svg[^>]*stroke="#eef2f6"/, "символ светлый — читается на тёмной клавише");
  assert.match(html, /background:linear-gradient\(180deg,#[0-4]/i, "заливка клавиши тёмная (карбон)");
});

test("две соседние клавиши разного цвета имеют разные заливки", () => {
  const html = buildHtml({
    size: "lg",
    frame: { name: "Накладка на 2 модуля, белая", code: "0", standard: "IT", imageUrl: "https://cdn/f.png", opening: OPENING, windows: OPENING_WIN },
    rows: [{ posts: [{ capacity: 2, cells: [
      { span: 1, categoryId: 500, name: "Выключатель, белый", num: "1" },
      { span: 1, categoryId: 500, name: "Выключатель, карбон матовый", num: "2" }
    ] }] }]
  }, deps);
  const grads = [...html.matchAll(/linear-gradient\(180deg,[^)]*\)/g)].map(m => m[0]);
  assert.ok(grads.length >= 2, "у двух клавиш две заливки");
  assert.notEqual(grads[0], grads[1], "клавиши разного цвета залиты по-разному");
});

test("явный cell.color приоритетнее названия механизма", () => {
  const html = buildHtml({
    size: "lg",
    frame: { name: "Накладка на 1 модуль, белая", code: "0", standard: "IT", imageUrl: "https://cdn/f.png", opening: OPENING, windows: OPENING_WIN },
    rows: [{ posts: [{ capacity: 1, cells: [{ span: 1, color: "карбон матовый", categoryId: 500, name: "Выключатель, белый", num: "1" }] }] }]
  }, deps);
  assert.match(html, /<svg[^>]*stroke="#eef2f6"/, "цвет клавиши взят из явного color (карбон), не из имени (белый)");
});

test("механизм без узнаваемого цвета в названии → берёт цвет накладки", () => {
  const html = keyOnFrame("Накладка на 1 модуль, карбон матовый", "Выключатель 1П 16AX 1 модуль");
  assert.match(html, /<svg[^>]*stroke="#eef2f6"/, "нет цвета в имени — клавиша наследует тёмную накладку, символ светлый");
});

/* ── Схема-фолбэк (нет фото накладки) ──────────────────────────────────────── */

const italian3M = {
  size: "lg", frame: { name: "Накладка на 3 модуля, белая", code: "09673.01" },
  rows: [{ posts: [{ capacity: 3, cells: [
    { span: 1, categoryId: 500, icon: "⌁", name: "Выключатель", num: "1" },
    { span: 2, categoryId: 300, icon: "◉", name: "Розетка 2М", num: "2–3" }
  ] }] }]
};

test("фолбэк: без imageUrl накладка залита цветом из каталога, без единого <img>", () => {
  const html = buildHtml(italian3M, deps);
  assert.ok(!/<img/.test(html), "в схеме-фолбэке фотографий нет");
  assert.match(html, /data-ep="plate"[^>]*background:#f4f5f2/, "пластина залита цветом накладки (белый)");
  assert.match(html, /09673\.01/, "артикул накладки в подписи (lg)");
});

test("фолбэк: пластина резиновая — max-width:100% и высота через процентный padding", () => {
  const html = buildHtml(italian3M, deps);
  assert.match(html, /width:\d+px;max-width:100%/, "внешний блок схемы: ширина W, но не больше контейнера");
  assert.match(html, /padding-top:[\d.]+%/, "высота пластины задана процентным padding от ширины");
  assert.match(html, /data-ep="plate"[^>]*position:absolute;inset:0/, "пластина лежит абсолютным слоем");
});

test("фолбэк: клавиши пропорциональны числу модулей: 2М вдвое шире 1М", () => {
  const html = buildHtml(italian3M, deps);
  assert.match(html, /flex:1 1 0/, "1М-клавиша — flex:1");
  assert.match(html, /flex:2 1 0/, "2М-клавиша — flex:2 (вдвое шире)");
  assert.match(html, /<svg[^>]*viewBox="0 0 24 24"/, "символ функции нарисован инлайн-SVG");
});

test("фолбэк: итальянская сплошная (один пост) — импоста между постами нет", () => {
  const html = buildHtml(italian3M, deps);
  assert.ok(!/data-ep="impost"/.test(html), "у однопостовой накладки импоста нет");
});

test("фолбэк: немецкая 2+2 (два поста) — свой импост-разделитель есть", () => {
  const spec = {
    size: "md", frame: { name: "Накладка на 4 модуля (2+2), белая", code: "09664.01" },
    rows: [{ posts: [
      { capacity: 2, cells: [{ span: 1, categoryId: 500, num: "1" }, { span: 1, empty: true, num: "2" }] },
      { capacity: 2, cells: [{ span: 2, categoryId: 300, num: "1–2" }] }
    ] }]
  };
  const html = buildHtml(spec, deps);
  assert.match(html, /data-ep="impost"/, "в фолбэке свою полосу-импост между постами рисуем");
  assert.ok(!/<img/.test(html), "фото нет и в документе (md)");
});

test("фолбэк: двухрядная «4+4» — импост и между рядами", () => {
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

test("фолбэк: тёмная накладка — подписи и значки светлые (читаемость)", () => {
  const spec = {
    size: "lg", frame: { name: "Накладка на 2 модуля, карбон матовый", code: "09662.14" },
    rows: [{ posts: [{ capacity: 2, cells: [{ span: 1, categoryId: 500, icon: "⌁", name: "Выключатель", num: "1" }, { span: 1, empty: true, num: "2" }] }] }]
  };
  const html = buildHtml(spec, deps);
  assert.match(html, /data-ep="plate"[^>]*background:#2c2f33/, "тёмная заливка накладки");
  assert.match(html, /color:#eef2f6/, "номер модуля светлый — читается на тёмной");
  assert.match(html, /<svg[^>]*stroke="#eef2f6"/, "значок светлый — читается на тёмной");
});

test("фолбэк: миниатюра (sm) — только заливка, ячейки и импост, без значков и номеров", () => {
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

/* ── Экранирование и устойчивость ──────────────────────────────────────────── */

test("экранирование имён накладки и механизма — без живых тегов", () => {
  const spec = {
    size: "lg", frame: { name: "Рамка <b>X</b>", code: "09673.01" },
    rows: [{ posts: [{ capacity: 1, cells: [{ span: 1, categoryId: 500, name: 'Кнопка "A"', num: "1" }] }] }]
  };
  const html = buildHtml(spec, deps);
  assert.ok(!/<b>X<\/b>/.test(html), "имя накладки экранировано");
  assert.match(html, /title="Кнопка &quot;A&quot;"/, "имя механизма экранировано в title");
});

test("экранирование в режиме фото: url и имя механизма экранированы", () => {
  const spec = {
    size: "lg",
    frame: { name: "Рамка <b>X</b>", code: "09673.01", standard: "IT", imageUrl: 'https://cdn/f.png"><b>', opening: OPENING, windows: OPENING_WIN },
    rows: [{ posts: [{ capacity: 1, cells: [{ span: 1, imageUrl: 'x"><b>', categoryId: 500, name: 'Кнопка "A"', num: "1" }] }] }]
  };
  const html = buildHtml(spec, deps);
  assert.ok(!/<b>/.test(html), "живых тегов в разметке нет — всё экранировано");
});

test("пустой spec не роняет отрисовку", () => {
  assert.match(buildHtml({}, deps), /assembled-post/);
  assert.match(buildHtml(null, deps), /assembled-post/);
});
