/* Чистый модуль шагового выбора отделки (EPFramePicker, js/framePicker.js). Проверяем ГЛАВНОЕ
   требование блока: мастер — второй ВИД, а не второе правило (§7.1). Счётчик «сколько накладок за
   вариантом» и список значений признака он НЕ считает сам, а берёт через переданный отбор каталога.
   Поэтому deps в тесте — НАСТОЯЩИЕ функции EPCatalog (тот же productsForRoom, что фильтрует
   конструктор), а не заглушки: если stepOptions начнёт считать мимо productsForRoom, тест покраснеет.

   МУТАЦИОННАЯ ТАБЛИЦА (в отчёте):
     stepOptions без `delete base[prop]` (текущий признак сужает пул)  → красит «база БЕЗ текущего шага»;
     count = pool.length вместо match(pool,{[prop]:value}).length      → красит «счётчик = productsForRoom»;
     imageOf берёт ПЕРВЫЙ товар, а не первый С фото                    → красит «фото — у первого С фото, иначе пусто».
   Запуск: node --test tests/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const EPFramePicker = require("../js/framePicker.js");
const EPCatalog = require("../js/catalog.js");

/* Синтетический каталог: две серии, у части накладок фото есть, у части нет — чтобы проверить
   и счётчики, и фолбэк «без фото». Отбор и перечисление значений — настоящими функциями каталога. */
const FRAMES = [
  { id: 1, kind: "frame", series: ["Arke"],  frameMaterial: "Металл",       frameShape: "Классическая", frameColor: "Белый",  previewImageUrl: "arke-white.jpg" },
  { id: 2, kind: "frame", series: ["Arke"],  frameMaterial: "Металл",       frameShape: "Скруглённая",  frameColor: "Чёрный" },
  { id: 3, kind: "frame", series: ["Plana"], frameMaterial: "Технополимер", frameShape: "Классическая", frameColor: "Белый",  previewImageUrl: "plana-white.jpg" }
];

const DEPS = {
  match: (frames, criteria) => EPCatalog.productsForRoom(frames, criteria),
  valuesOf: (pool, prop) => prop === "standard" ? EPCatalog.productStandards(pool) : prop === "collection" ? EPCatalog.productCollections(pool) : EPCatalog.productFacingValues(pool, prop),
  imageOf: item => EPCatalog.productImage(item)
};

test("STEPS: стандарт ПЕРВЫМ, далее серия→материал→форма→цвет, prop = имя поля комнаты", () => {
  /* Стандарт стоит первым намеренно (встреча 24.08 §4.1: конфигуратор сразу отсекает неподходящие
     рамки). Мутация «стандарт уехал не на первое место» обязана краснеть здесь. */
  assert.deepEqual(EPFramePicker.STEPS.map(s => s.prop),
    ["standard", "collection", "frameMaterial", "frameShape", "frameColor"]);
  assert.equal(EPFramePicker.STEPS[0].prop, "standard", "монтажный стандарт — первый шаг");
});

test("шаг стандарта: варианты — итальянский/немецкий, счётчик универсальной накладки идёт В ОБА", () => {
  /* Каталог: одна IT-накладка, одна DE, одна универсальная (BOTH). productStandards раскрывает BOTH
     в оба варианта, а productsForRoom считает «за вариантом» = свои + универсальные. Мутация «стандарт
     не сужает пул» (снять предикат c.standard) обрушила бы оба счётчика до 3. */
  const STD = [
    { id: 1, kind: "frame", series: ["Arke"], standard: "IT",   frameColor: "Белый" },
    { id: 2, kind: "frame", series: ["Arke"], standard: "DE",   frameColor: "Чёрный" },
    { id: 3, kind: "frame", series: ["Arke"], standard: "BOTH", frameColor: "Серый" }
  ];
  const opts = EPFramePicker.stepOptions(STD, {}, "standard", DEPS);
  assert.deepEqual(opts.map(o => o.value), ["DE", "IT"], "варианты — только IT/DE; BOTH сам вариантом не приходит");
  assert.equal(opts.find(o => o.value === "IT").count, 2, "за «итальянским» — IT-накладка + универсальная");
  assert.equal(opts.find(o => o.value === "DE").count, 2, "за «немецким» — DE-накладка + универсальная");
});

test("выбор стандарта СУЖАЕТ следующий шаг (серии): под немецкий видны только серии с DE/универсальными", () => {
  /* Серия «Plana» держит только IT-накладку, «Arke» — универсальную. Выбрав «DE», на шаге серии
     человек видит лишь «Arke» (в ней есть годная под немецкий универсальная), а «Plana» отсеяна —
     ровно то сужение, которого требует §4.1. */
  const STD = [
    { id: 1, kind: "frame", series: ["Plana"], standard: "IT",   frameColor: "Белый" },
    { id: 2, kind: "frame", series: ["Arke"],  standard: "BOTH", frameColor: "Серый" }
  ];
  const collsAll = EPFramePicker.stepOptions(STD, {}, "collection", DEPS).map(o => o.value);
  assert.deepEqual(collsAll, ["Arke", "Plana"], "без стандарта видны обе серии");
  const collsDE = EPFramePicker.stepOptions(STD, { standard: "DE" }, "collection", DEPS).map(o => o.value);
  assert.deepEqual(collsDE, ["Arke"], "под немецкий остаётся только серия с универсальной накладкой");
});

test("шаг серии: значения из каталога, счётчик = productsForRoom, фото первого с фото", () => {
  const opts = EPFramePicker.stepOptions(FRAMES, {}, "collection", DEPS);
  assert.deepEqual(opts.map(o => o.value), ["Arke", "Plana"], "серии по алфавиту из productCollections");
  assert.equal(opts.find(o => o.value === "Arke").count, 2, "за Arke две накладки");
  assert.equal(opts.find(o => o.value === "Plana").count, 1);
  assert.equal(opts.find(o => o.value === "Arke").imageUrl, "arke-white.jpg", "фото — у первого товара серии, у которого оно есть");
});

test("счётчик — это ДЛИНА productsForRoom того же критерия (а не размер пула)", () => {
  const opts = EPFramePicker.stepOptions(FRAMES, { collection: "Arke" }, "frameMaterial", DEPS);
  const material = opts.find(o => o.value === "Металл");
  assert.equal(material.count, EPCatalog.productsForRoom(FRAMES, { collection: "Arke", frameMaterial: "Металл" }).length);
  assert.equal(material.count, 2);
  assert.equal(opts.length, 1, "у Arke только один материал (Металл) — Технополимер это Plana");
});

test("база БЕЗ текущего шага: вернувшись на шаг формы, видно ОБЕ формы, а не только выбранную", () => {
  /* Форма уже выбрана «Классическая». При перевыборе счётчики считаются от пула БЕЗ формы (только
     серия), поэтому альтернатива «Скруглённая» тоже видна. Если бы текущий признак сужал пул,
     осталась бы одна «Классическая» — тупик перевыбора. */
  const opts = EPFramePicker.stepOptions(FRAMES, { collection: "Arke", frameShape: "Классическая" }, "frameShape", DEPS);
  assert.deepEqual(opts.map(o => o.value).sort(), ["Классическая", "Скруглённая"]);
  opts.forEach(o => assert.equal(o.count, 1, "каждая форма Arke — по одной накладке"));
});

test("фото — у первого товара С фото, иначе пустая строка (~40% накладок без фото)", () => {
  const opts = EPFramePicker.stepOptions(FRAMES, { collection: "Arke" }, "frameColor", DEPS);
  assert.equal(opts.find(o => o.value === "Белый").imageUrl, "arke-white.jpg", "у белого Arke фото есть");
  assert.equal(opts.find(o => o.value === "Чёрный").imageUrl, "", "у чёрного Arke фото нет → пустая строка, не мусор");
});

test("фото ищем СРЕДИ всех товаров варианта, а не берём первый: фото у идущего ПОЗЖЕ", () => {
  /* У варианта две накладки: первая без фото, вторая с фото. Правильно взять фото ВТОРОЙ; наивное
     «первый товар варианта» вернуло бы пусто и оставило вариант без картинки зря. */
  const ordered = [
    { id: 10, kind: "frame", series: ["Arke"], frameMaterial: "Металл", frameShape: "Классическая", frameColor: "Серый" },
    { id: 11, kind: "frame", series: ["Arke"], frameMaterial: "Металл", frameShape: "Классическая", frameColor: "Серый", previewImageUrl: "grey.jpg" }
  ];
  const opts = EPFramePicker.stepOptions(ordered, {}, "frameColor", DEPS);
  assert.equal(opts.find(o => o.value === "Серый").imageUrl, "grey.jpg");
});

test("пустое сочетание → пустой список опций (вызывающий объясняет словами, E14)", () => {
  const opts = EPFramePicker.stepOptions(FRAMES, { collection: "Plana", frameMaterial: "Металл" }, "frameShape", DEPS);
  assert.deepEqual(opts, [], "у Plana металла нет → пул пуст → шаг без вариантов");
});
