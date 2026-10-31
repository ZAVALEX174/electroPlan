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

/* ---- visibleSteps (К12 ч.1): шаг с одним значением в текущем отборе скрыт -------------------- */

test("каталог с ОДНОЙ формой → шаг «Форма» скрыт (а шаги с выбором видны)", () => {
  /* Повторяет настоящий каталог VIMAR: у всех накладок форма одна. «Форма» выпадает, остальные
     шаги (стандарт/серия/материал/цвет), где есть из чего выбирать, остаются. Мутация «≤1 → всё
     равно показать» (заменить >1 на >=1) покрасит этот тест. */
  const ONE_SHAPE = [
    { id: 1, kind: "frame", series: ["Arke"],  frameMaterial: "Металл",       frameShape: "Классическая", frameColor: "Белый"  },
    { id: 2, kind: "frame", series: ["Arke"],  frameMaterial: "Технополимер", frameShape: "Классическая", frameColor: "Чёрный" },
    { id: 3, kind: "frame", series: ["Plana"], frameMaterial: "Металл",       frameShape: "Классическая", frameColor: "Серый"  }
  ];
  const props = EPFramePicker.visibleSteps(ONE_SHAPE, {}, DEPS).map(s => s.prop);
  assert.ok(!props.includes("frameShape"), "«Форма» скрыта: во всём каталоге одно значение");
  assert.deepEqual(props, ["collection", "frameMaterial", "frameColor"],
    "видны серия/материал/цвет; «Стандарт» без значений тоже скрыт, «Форма» — одно значение");
});

test("подставной каталог с ДВУМЯ формами → шаг «Форма» виден (появится бренд — вернётся сам)", () => {
  /* FRAMES держит Классическую и Скруглённую → у «Формы» два значения, шаг показывается. Это и есть
     «если другие бренды будут, можно оставить» без правок кода. */
  const props = EPFramePicker.visibleSteps(FRAMES, {}, DEPS).map(s => s.prop);
  assert.ok(props.includes("frameShape"), "две формы в каталоге → шаг «Форма» виден");
});

test("выбор, сужающий признак до одного значения → его шаг скрыт", () => {
  /* В FRAMES две формы, но только в серии Arke; Plana держит одну «Классическую». Выбрав Plana,
     человек не может сменить форму — шаг «Форма» скрыт. Проверяет, что видимость считается в ТЕКУЩЕМ
     отборе (развилка 1б), а не по всему каталогу. */
  const all = EPFramePicker.visibleSteps(FRAMES, {}, DEPS).map(s => s.prop);
  assert.ok(all.includes("frameShape"), "без выбора форм две → видна");
  const narrowed = EPFramePicker.visibleSteps(FRAMES, { collection: "Plana" }, DEPS).map(s => s.prop);
  assert.ok(!narrowed.includes("frameShape"), "у Plana одна форма → шаг «Форма» скрыт");
});

test("сужение считается ВЫШЕлежащими шагами, выбор ниже на видимость не влияет", () => {
  /* У Arke две формы. Выбор цвета (шаг НИЖЕ формы) не должен прятать форму: форма определяется тем,
     что выбрано ДО неё, иначе, вернувшись на шаг формы, человек не увидел бы альтернативу. */
  const props = EPFramePicker.visibleSteps(FRAMES, { collection: "Arke", frameColor: "Белый" }, DEPS).map(s => s.prop);
  assert.ok(props.includes("frameShape"), "цвет ниже формы — её не прячет");
});

test("сохранённое значение, НЕсовместимое с текущим отбором, оставляет шаг видимым (обратная совместимость)", () => {
  /* Старый проект: серия Plana (одна форма «Классическая») + сохранённая «Скруглённая». В отборе
     такой формы нет — шаг нельзя прятать молча, иначе «висящая» форма режет отбор в ноль, а поправить
     нечем (§7.1). Шаг остаётся, чтобы человек сменил значение. */
  const props = EPFramePicker.visibleSteps(FRAMES, { collection: "Plana", frameShape: "Скруглённая" }, DEPS).map(s => s.prop);
  assert.ok(props.includes("frameShape"), "несовместимое сохранённое значение → шаг виден для правки");
});

/* ---- autoFill (К12 ч.2): единственный оставшийся вариант шага подставляется сам ----------------
   deps — те же НАСТОЯЩИЕ функции EPCatalog, что фильтруют конструктор: autoFill считает «единственное»
   через тот же отбор, своего счётчика у него нет (§7.1).

   МУТАЦИОННАЯ ТАБЛИЦА (в отчёте):
     убрать skip (standard тоже заполнять) → красит «стандарт не подставляется никогда»;
     заполнять НЕпустые поля (убрать проверку sel[prop]) → красит «ручной выбор не перезаписан».
   (Отдельно: см. отчёт о while-проходе — на монотонном каталоге он не добавляет заполнений, тест на
    его удаление покрасить нельзя; держим его для части 3 с иной семантикой цвета механизмов.) */

test("autoFill: Eikon Flat → единственный материал «Металл» встаёт сам, цвет (10 шт.) НЕ ставится", () => {
  /* Повторяет настоящий Eikon Flat: один материал, несколько цветов. После выбора серии материал
     вынужден → подставляем; цвет многозначен → ждём человека. Стандарт BOTH — его productStandards
     раскрывает в IT/DE (два) и он всё равно в skip. */
  const FLAT = [
    { id: 1, kind: "frame", series: ["Flat"], standard: "BOTH", frameMaterial: "Металл", frameShape: "Классическая", frameColor: "Белый" },
    { id: 2, kind: "frame", series: ["Flat"], standard: "BOTH", frameMaterial: "Металл", frameShape: "Классическая", frameColor: "Чёрный" }
  ];
  const sel = EPFramePicker.autoFill(FLAT, { collection: "Flat" }, DEPS, { skip: ["standard"] });
  assert.equal(sel.frameMaterial, "Металл", "единственный материал подставился сам");
  assert.equal(sel.collection, "Flat", "ручной выбор серии сохранён");
  assert.ok(!sel.frameColor, "цветов несколько → цвет не подставляется");
  assert.ok(!sel.standard, "стандарт в skip — не подставляется");
});

test("autoFill: стандарт НЕ подставляется никогда, даже если в отборе он один (покрасит удаление skip)", () => {
  /* Серия только итальянская (standard IT, не BOTH) → productStandards = [IT], один стандарт. Без skip
     autoFill подставил бы standard="IT"; со skip — поле остаётся пустым (деньги выбирает человек). */
  const IT_ONLY = [
    { id: 1, kind: "frame", series: ["Arke"], standard: "IT", frameMaterial: "Металл", frameShape: "Классическая", frameColor: "Белый" },
    { id: 2, kind: "frame", series: ["Arke"], standard: "IT", frameMaterial: "Дерево", frameShape: "Классическая", frameColor: "Чёрный" }
  ];
  assert.deepEqual(EPCatalog.productStandards(IT_ONLY), ["IT"], "в отборе один стандарт — условие для подстановки без skip");
  const sel = EPFramePicker.autoFill(IT_ONLY, { collection: "Arke" }, DEPS, { skip: ["standard"] });
  assert.ok(!sel.standard, "стандарт не подставлен, хотя он единственный");
});

test("autoFill: «Никель матовый» (6 серий, 2 материала) без серии → ничего не заполняется", () => {
  /* Моделирует реальный случай заказчика: цвет в нескольких сериях с разными материалами. Ни серия,
     ни материал не вынуждены → autoFill их не трогает (решение владельца 31.10: честно заполнять
     только однозначное). */
  const NICKEL = [
    { id: 1, kind: "frame", series: ["Flat"],  standard: "BOTH", frameMaterial: "Металл",       frameShape: "Классическая", frameColor: "Никель матовый" },
    { id: 2, kind: "frame", series: ["Plana"], standard: "BOTH", frameMaterial: "Технополимер", frameShape: "Классическая", frameColor: "Никель матовый" }
  ];
  const sel = EPFramePicker.autoFill(NICKEL, { frameColor: "Никель матовый" }, DEPS, { skip: ["standard"] });
  assert.ok(!sel.collection, "цвет в двух сериях → серия не подставляется");
  assert.ok(!sel.frameMaterial, "два материала → материал не подставляется");
  assert.equal(sel.frameColor, "Никель матовый", "ручной цвет сохранён");
});

test("autoFill: Arke + «Сталь матовая» — материал неоднозначен (металл/дерево) → материал пуст", () => {
  const ARKE_STEEL = [
    { id: 1, kind: "frame", series: ["Arke"], standard: "BOTH", frameMaterial: "Металл", frameShape: "Классическая", frameColor: "Сталь матовая" },
    { id: 2, kind: "frame", series: ["Arke"], standard: "BOTH", frameMaterial: "Дерево", frameShape: "Классическая", frameColor: "Сталь матовая" }
  ];
  const sel = EPFramePicker.autoFill(ARKE_STEEL, { collection: "Arke", frameColor: "Сталь матовая" }, DEPS, { skip: ["standard"] });
  assert.ok(!sel.frameMaterial, "под Arke+Сталь матовую материал неоднозначен → не подставляется");
});

test("autoFill: цвет из ОДНОЙ серии без серии → серия и материал заполнились, ручной цвет цел, стандарт пуст", () => {
  /* Каскад из слов заказчика: «если бы я выбрал цвет, он должен и серию, и материал заполнить». Цвет
     «Медь» есть только в Vintage, где один материал. autoFill подставляет серию И материал за один
     вызов — это и проверяет проход по всем шагам (убрать перебор шагов → тест покраснеет). */
  const UNIQUE = [
    { id: 1, kind: "frame", series: ["Vintage"], standard: "BOTH", frameMaterial: "Латунь", frameShape: "Классическая", frameColor: "Медь" },
    { id: 2, kind: "frame", series: ["Vintage"], standard: "BOTH", frameMaterial: "Латунь", frameShape: "Классическая", frameColor: "Бронза" },
    { id: 3, kind: "frame", series: ["Arke"],    standard: "BOTH", frameMaterial: "Металл", frameShape: "Классическая", frameColor: "Белый" }
  ];
  const sel = EPFramePicker.autoFill(UNIQUE, { frameColor: "Медь" }, DEPS, { skip: ["standard"] });
  assert.equal(sel.collection, "Vintage", "«Медь» только в Vintage → серия подставилась");
  assert.equal(sel.frameMaterial, "Латунь", "в этом отборе один материал → подставился");
  assert.equal(sel.frameColor, "Медь", "ручной цвет не перезаписан");
  assert.ok(!sel.standard, "стандарт не подставляется");
});

test("autoFill: заданное поле не перезаписывается, даже если его «единственное» было бы другим", () => {
  /* Серия Arke с одним материалом «Металл», но поле материала человек задал «Дерево» руками (пусть
     и несовместимо). autoFill не трогает непустое поле — перезапись покрасит удаление проверки sel[prop]. */
  const FRAMES2 = [
    { id: 1, kind: "frame", series: ["Arke"], standard: "BOTH", frameMaterial: "Металл", frameShape: "Классическая", frameColor: "Белый" }
  ];
  const sel = EPFramePicker.autoFill(FRAMES2, { collection: "Arke", frameMaterial: "Дерево" }, DEPS, { skip: ["standard"] });
  assert.equal(sel.frameMaterial, "Дерево", "заданный рукой материал не перезаписан автозаполнением");
});

test("autoFill: вход не мутируется, возвращается НОВЫЙ объект", () => {
  const input = { collection: "Flat" };
  const FLAT = [{ id: 1, kind: "frame", series: ["Flat"], standard: "BOTH", frameMaterial: "Металл", frameShape: "Классическая", frameColor: "Белый" }];
  const out = EPFramePicker.autoFill(FLAT, input, DEPS, { skip: ["standard"] });
  assert.notEqual(out, input, "возвращается новый объект");
  assert.deepEqual(input, { collection: "Flat" }, "исходный selection не тронут");
});
