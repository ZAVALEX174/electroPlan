/* Автотесты доменного каталога (EPCatalog, js/catalog.js). Модуль чистый — товары
   приходят объектами, браузер не нужен. Здесь проверяем ёмкость рамок: конструктор
   расширен до 8 модулей (основные размеры заказчика 6-7-8, ответы 31.07 §2.6), а
   многорядные накладки (14=7+7, 21=7+7+7) в подбор НЕ попадают — их двумерную нумерацию
   конструктор пока не поддерживает (отложено владельцем). */
const test = require("node:test");
const assert = require("node:assert/strict");
const { mechanismSpan, frameSlotCount, frameOpening, frameOpenings, moduleFace, productImage, isPlaceholderImage, moduleWord, placeWord } = require("../js/catalog.js");

/* --- склонение счётных подписей (moduleWord/placeWord) --- */
test("placeWord склоняет «место» по-русски — карточка библиотеки писала «1 места»", () => {
  assert.equal(placeWord(1), "1 место");
  assert.equal(placeWord(2), "2 места");
  assert.equal(placeWord(4), "4 места");
  assert.equal(placeWord(5), "5 мест");
  assert.equal(placeWord(0), "0 мест");
});
test("склонение смотрит на последние ДВЕ цифры: 11–14 всегда «мест»", () => {
  /* Прежняя формула («1 → одна форма, 2–4 → вторая») врала на втором десятке. */
  assert.equal(placeWord(11), "11 мест");
  assert.equal(placeWord(12), "12 мест");
  assert.equal(placeWord(14), "14 мест");
  assert.equal(placeWord(21), "21 место");
  assert.equal(placeWord(22), "22 места");
  assert.equal(moduleWord(11), "11 модулей");
  assert.equal(moduleWord(21), "21 модуль");
});
test("moduleWord на рабочем диапазоне 1..8 остался прежним", () => {
  assert.deepEqual([1,2,3,4,5,6,7,8].map(moduleWord),
    ["1 модуль","2 модуля","3 модуля","4 модуля","5 модулей","6 модулей","7 модулей","8 модулей"]);
});

/* --- ёмкость механизма в модулях (mechanismSpan) --- */
test("mechanismSpan: явное поле moduleSpan авторитетно (1..8)", () => {
  assert.equal(mechanismSpan({ moduleSpan: 3, name: "что угодно" }), 3);
  assert.equal(mechanismSpan({ modules: 2 }), 2);
});
test("mechanismSpan: словесные формы названия — «модуль/module»", () => {
  assert.equal(mechanismSpan({ name: "Фальшблок на 2 модуля, серый" }), 2);
  assert.equal(mechanismSpan({ name: "Заглушка 1 модуль" }), 1);
  assert.equal(mechanismSpan({ name: "Диммер 2 modules" }), 2);
  assert.equal(mechanismSpan({ name: "Switch, 1 module" }), 1);
});
test("mechanismSpan: краткая форма «2М»/«2M» без слова «модуль» (цветовые варианты)", () => {
  assert.equal(mechanismSpan({ name: "Фальшблок на 2М, белый" }), 2);
  assert.equal(mechanismSpan({ name: "Фальшблок на 2M, белый" }), 2, "латинская M");
  assert.equal(mechanismSpan({ name: "Термостат 2М" }), 2);
  assert.equal(mechanismSpan({ name: "1M neutro" }), 1);
});
test("mechanismSpan: три цветовых варианта фальшблока дают ОДНУ ёмкость", () => {
  // Реальный дефект: 20042.B «на 2М» получал 1, а 20042/20042.N «на 2 модуля» — 2.
  assert.equal(mechanismSpan({ name: "Фальшблок на 2 модуля, серый" }), 2);
  assert.equal(mechanismSpan({ name: "Фальшблок на 2М, белый" }), 2);
  assert.equal(mechanismSpan({ name: "Фальшблок на 2 модуля, серебро" }), 2);
});
test("mechanismSpan: краткую М/M не путаем с единицами и размерами", () => {
  assert.equal(mechanismSpan({ name: "Реле 16A 250V" }), 1, "ток/напряжение — не модули");
  assert.equal(mechanismSpan({ name: "Светодиод 0,3W" }), 1, "мощность");
  assert.equal(mechanismSpan({ name: "Розетка 2P+T" }), 1, "полюса");
  assert.equal(mechanismSpan({ name: "Кабель cat5e" }), 1);
  assert.equal(mechanismSpan({ name: "Суппорт 60 мм" }), 1, "размер в мм");
  assert.equal(mechanismSpan({ name: "Провод 6 м" }), 1, "метры");
  assert.equal(mechanismSpan({ name: "Трансформатор 2МВт" }), 1, "мегаватты");
  assert.equal(mechanismSpan({ name: "Датчик 2mA" }), 1, "миллиамперы");
  assert.equal(mechanismSpan({ name: "Модуль 2MHz" }), 1, "мегагерцы");
});
test("mechanismSpan: нет распознаваемой ёмкости → 1, пустой item → 0", () => {
  assert.equal(mechanismSpan({ name: "Выключатель одноклавишный" }), 1);
  assert.equal(mechanismSpan({}), 1);
  assert.equal(mechanismSpan(null), 0);
});

/* --- ёмкость рамки: явная slotCount 1..8 авторитетна --- */
test("frameSlotCount: рамки 6/7/8 модулей теперь распознаются", () => {
  assert.equal(frameSlotCount({ slotCount: 6 }), 6);
  assert.equal(frameSlotCount({ slotCount: 7 }), 7);
  assert.equal(frameSlotCount({ slotCount: 8 }), 8);
});
test("frameSlotCount: прежние размеры 1..5 не сломаны", () => {
  for (const n of [1, 2, 3, 4, 5]) assert.equal(frameSlotCount({ slotCount: n }), n);
});
test("frameSlotCount: многорядные 14 (7+7) и 21 (7+7+7) → null (не предлагаются)", () => {
  assert.equal(frameSlotCount({ slotCount: 14, name: "Накладка для 14 модулей (7+7)" }), null);
  assert.equal(frameSlotCount({ slotCount: 21, name: "Накладка для 21 модуля (7+7+7)" }), null);
});
test("frameSlotCount: явная ёмкость >8 не угадывается по названию (14 модулей ≠ 4)", () => {
  // Раньше при slotCount вне диапазона логика падала на regex и «14 модулей» давало 4 —
  // многорядная накладка утекала под размер 4. Явная ёмкость должна возвращать null.
  assert.equal(frameSlotCount({ slotCount: 14, name: "Рамка на 14 модулей" }), null);
});
test("frameSlotCount: без явного slotCount берём число из названия (1..8)", () => {
  assert.equal(frameSlotCount({ name: "Накладка на 7 модулей, белая" }), 7);
  assert.equal(frameSlotCount({ name: "Накладка на 8 модулей (2+2+2+2)" }), 8);
});

/* --- превью: у 6/7/8 есть свои пропорции окна (не падение на дефолт 3 мод.) --- */
test("frameOpening: для 8 модулей своя геометрия окна, а не запасная под 3", () => {
  const wide = frameOpening({}, 8);
  const narrow = frameOpening({}, 3);
  assert.notEqual(wide.aspect, narrow.aspect);
  assert.ok(wide.aspect > narrow.aspect, "окно 8М шире окна 3М");
  assert.ok(wide.left + wide.width <= 100, "окно не выходит за пределы рамки");
});

/* --- измеренные монтажные окна накладки (frameOpenings) --- */
test("frameOpenings: немецкая накладка отдаёт ВСЕ окна (mountRects) слева направо", () => {
  const item = { mountRects: [
    { left: 13.5, top: 23.6, width: 28.5, height: 50.9 },
    { left: 58, top: 23.6, width: 28.5, height: 51.8 }
  ] };
  const rects = frameOpenings(item, 4);
  assert.equal(rects.length, 2, "два окна немецкой 2+2");
  assert.equal(rects[0].left, 13.5);
  assert.equal(rects[1].left, 58);
});
test("frameOpenings: итальянская — одно окно (mountRect) → массив из одного", () => {
  const rects = frameOpenings({ mountRect: { left: 22, top: 23.6, width: 56, height: 51.4 } }, 3);
  assert.equal(rects.length, 1, "одно окно → массив из одного");
  assert.equal(rects[0].width, 56);
});
test("frameOpenings: нет измерений → null (postImage падает на фолбэк, а не рисует по догадке)", () => {
  assert.equal(frameOpenings({}, 3), null);
  assert.equal(frameOpenings({ name: "Накладка на 3 модуля" }, 3), null);
});
test("frameOpenings: битые окна отбрасываются (нет валидных → null)", () => {
  assert.equal(frameOpenings({ mountRects: [{ left: 10, top: 20, width: 0, height: 50 }] }, 3), null);
  assert.equal(frameOpenings({ mountRect: { left: 10, top: 20 } }, 3), null, "нет width/height → null");
});
test("frameOpenings: JSON-строкой (как из атрибутов) тоже разбирается", () => {
  const rects = frameOpenings({ mountRect: JSON.stringify({ left: 22, top: 23.6, width: 56, height: 51.4 }) }, 3);
  assert.equal(rects.length, 1);
  assert.equal(rects[0].top, 23.6);
});

/* --- лицевой прямоугольник механизма (moduleFace) — реальные числа детектора --- */
test("moduleFace: faceRect объектом → прямоугольник (реальный 09001.2.CM, 2М)", () => {
  const item = { faceRect: { left: 6.5, top: 8, width: 87, height: 84 } };
  assert.deepEqual(moduleFace(item), { left: 6.5, top: 8, width: 87, height: 84 });
});
test("moduleFace: faceRect массивом [l,t,w,h] (форма файла) тоже разбирается", () => {
  // 09001.0.250 (1М): лицо у́же и выше — так его снял детектор
  assert.deepEqual(moduleFace({ faceRect: [10.2, 8.2, 79.5, 83.5] }), { left: 10.2, top: 8.2, width: 79.5, height: 83.5 });
});
test("moduleFace: нет лица → null (postImage рисует клавишу-фолбэк, а не тянет фото)", () => {
  assert.equal(moduleFace({}), null);
  assert.equal(moduleFace({ name: "Розетка" }), null);
  assert.equal(moduleFace(null), null);
});
test("moduleFace: битый прямоугольник → null (нулевая ширина, выход за кадр)", () => {
  assert.equal(moduleFace({ faceRect: { left: 5, top: 5, width: 0, height: 80 } }), null);
  assert.equal(moduleFace({ faceRect: { left: 60, top: 5, width: 60, height: 80 } }), null, "left+width>100 → null");
  assert.equal(moduleFace({ faceRect: [10, 10] }), null, "неполный массив → null");
});
test("moduleFace: JSON-строкой (как из хранилища) разбирается", () => {
  assert.deepEqual(moduleFace({ faceRect: JSON.stringify({ left: 6.5, top: 8, width: 87, height: 84 }) }),
    { left: 6.5, top: 8, width: 87, height: 84 });
});

/* --- заглушка no_photo: успешно грузится, но фото по сути нет → отдаём пусто (фолбэк) --- */
test("productImage: заглушку no_photo не отдаём, берём настоящее фото приоритетнее", () => {
  assert.equal(isPlaceholderImage("https://vimar.ru/…/no_photo.png"), true);
  assert.equal(isPlaceholderImage("https://vimar.ru/…/abc.jpg"), false);
  // превью — заглушка, деталь — настоящая: берём настоящую, а не пустую
  const item = { previewImageUrl: "https://x/no_photo.png", imageUrl: "https://x/real.jpg" };
  assert.equal(productImage(item), "https://x/real.jpg", "заглушка-превью пропущена в пользу настоящей");
  // обе заглушки → пусто (рисуется иконка)
  assert.equal(productImage({ previewImageUrl: "https://x/no_photo.png", imageUrl: "https://y/no_photo.png" }), "");
  // нет картинок вовсе → пусто
  assert.equal(productImage({}), "");
});
