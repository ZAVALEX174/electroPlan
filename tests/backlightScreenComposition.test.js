/* ПОВЕДЕНЧЕСКИЙ регресс: подсветка клавиш (LED) видна во ВСЕХ экранных местах, где показана цена
   поста с ней (ПОДСВЕТКА-B, часть B2a-2). «Стоимость поста» на экране уже включает LED (postCost),
   а строки состава, которые видит человек, про неё молчали — тот же дефект «три механизма, а денег
   на четыре»: цена «за четыре», а на экране три позиции.

   ТРИ ПОТРЕБИТЕЛЯ, ОДНА ФОРМУЛИРОВКА. Панель «Состав поста» конструктора (renderBuilderComposition),
   карточка размещённого поста (renderProperties) и подсказка на плане (showHover) строят строку LED
   через ЕДИНУЮ backlightRowSummary — второй копии правила «N × …, пробел словами» нет. app.js —
   монолит-оркестратор (DOM, state), в node не грузится: вырезаем ИСХОДНЫЙ ТЕКСТ функций и исполняем
   в vm на общем стенде (appStand). Настоящий здесь — backlightRowSummary (единственный источник);
   comp.backlight подаём готовым (его считает EPPosts.postComposition, покрытый своими тестами).

   МУТАЦИЯ → КРАСНЫЙ ТЕСТ:
     - backlightRowSummary теряет счёт «2 ×» / слова пробела / возвращает null при наличии LED;
     - renderBuilderComposition не подставляет ${backRow} → строки нет в составе;
     - showHover не подставляет ${backRow} → строки нет в подсказке;
     - renderProperties не встраивает backlightRowSummary → карточка молчит;
     - выключенная подсветка перестаёт давать null (экран менялся бы без причины).
   Запуск: node --test tests/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

const LED = { code: "L1", name: "LED-подсветка", price: 19.75 };
const backOf = (items, gaps) => ({ enabled: true, items, gaps: gaps || [], count: items.length, hasGap: (gaps || []).length > 0 });

/* ---- 1. backlightRowSummary — единый источник формулировки ---------------------------------- */

function summary(back) {
  return stand.runNamed(["backlightRowSummary"], { money: v => "€" + v })(back);
}

test("backlightRowSummary: одинаковые LED сводятся количеством, цена за штуку", () => {
  const s = summary(backOf([{ accessory: LED }, { accessory: LED }], []));
  assert.equal(s.text, "2 × LED-подсветка · €19.75", "два одинаковых LED — одной строкой «2 × …», а не двумя");
  assert.equal(s.count, 2, "в цену идут оба аксессуара");
  assert.equal(s.gaps, 0, "пробелов нет");
});

test("backlightRowSummary: один LED — без множителя", () => {
  const s = summary(backOf([{ accessory: LED }], []));
  assert.equal(s.text, "LED-подсветка · €19.75", "единственный LED печатается без «1 ×»");
});

test("backlightRowSummary: пробел назван СЛОВАМИ и в цену не входит", () => {
  const s = summary(backOf([{ accessory: LED }], [{ mechId: 5 }]));
  assert.match(s.text, /подсветка не подобрана/, "механизм принимает LED, а совместимого нет — говорим словами, как в смете");
  assert.equal(s.gaps, 1, "ровно один пробел");
  assert.equal(s.count, 1, "в цену входит только подобранный LED, пробел — 0");
});

test("backlightRowSummary: несколько пробелов — счётчиком", () => {
  const s = summary(backOf([], [{ mechId: 1 }, { mechId: 2 }]));
  assert.equal(s.text, "2 × подсветка не подобрана", "два непободранных механизма — «2 × …»");
  assert.equal(s.count, 0, "подобранных LED нет — цена не растёт");
});

test("backlightRowSummary: выключенная/пустая подсветка → null (экран как раньше)", () => {
  assert.equal(summary(backOf([], [])), null, "ни LED, ни пробелов — строки нет");
  assert.equal(summary(null), null, "нет поля backlight (старый состав вне приложения) — тоже null, не падаем");
  assert.equal(summary(undefined), null, "undefined — null");
});

/* ---- 2. renderBuilderComposition — строка в панели «Состав поста» --------------------------- */

function makeComp(backlight) {
  return {
    standard: "IT", approximate: false,
    supportNotRequired: false, support: { name: "Планка", price: 1 }, supportCount: 1, supportAssumed: false,
    boxCount: 1, box: { name: "Коробка", price: 2 }, boxFallback: null,
    frame: { boxModularity: 3 }, modulesTotal: 3,
    backlight
  };
}

function compositionCtx(dom, comp) {
  return {
    state: { builder: { editingPlacedId: null } },
    document: { querySelectorAll: () => [] },
    $: dom.$,
    builderWallType: () => "solid",
    WALL_STEP_LABEL: { solid: "Бетон", hollow: "ГКЛ" },
    STANDARD_LABEL: { IT: "Итальянский" }, STANDARD_GENITIVE: { IT: "итальянского" },
    postComposition: () => comp,
    productSeries: () => ["Neve"],
    frameSlotCount: () => 3,
    money: v => "€" + v, esc: s => String(s == null ? "" : s),
    lightingRowsFor: () => [], lightingRowSummary: () => null,
    postTotalCost: () => 100
  };
}

function renderComposition(comp) {
  const dom = stand.makeDom({ selects: ["postFrameSelect"] });
  const render = stand.runNamed(["backlightRowSummary", "renderBuilderComposition"], compositionCtx(dom, comp));
  // draft передаём явно — тогда post берётся из него, а не собирается из DOM-слотов
  render({ id: "F", name: "накладка" }, "", null, { frameId: 1, mechanismIds: [1], wallType: "solid" });
  return dom.$("builderComposition").innerHTML;
}

test("renderBuilderComposition: подсветка есть → строка «Подсветка клавиш» в составе", () => {
  const html = renderComposition(makeComp(backOf([{ accessory: LED }, { accessory: LED }], [])));
  assert.match(html, /Подсветка клавиш/, "панель состава называет подсветку — состав объясняет цену");
  assert.match(html, /2 × LED-подсветка · €19\.75/, "с тем же счётом и ценой, что и другие экраны");
});

test("renderBuilderComposition: пробел подсветки помечен is-missing", () => {
  const html = renderComposition(makeComp(backOf([], [{ mechId: 1 }])));
  assert.match(html, /composition-row is-missing"><span>Подсветка клавиш/, "пробел подсветки — красная строка, как суппорт/коробка");
});

test("renderBuilderComposition: подсветка выключена → строки нет (состав как раньше)", () => {
  const html = renderComposition(makeComp(backOf([], [])));
  assert.doesNotMatch(html, /Подсветка клавиш/, "нет подсветки — панель байт в байт прежняя");
});

/* ---- 3. showHover — строка в подсказке на плане --------------------------------------------- */

function hoverHtml(backlight) {
  const dom = stand.makeDom();
  const hover = stand.makeElement();
  const comp = {
    frameAvailability: { displayName: "Neve Up" },
    box: { price: 2 }, boxFallback: null, boxCount: 1,
    backlight
  };
  const ctx = {
    hover,
    product: () => ({ name: "x", code: "x" }),
    postComposition: () => comp,
    money: v => "€" + v, esc: s => String(s == null ? "" : s),
    postTotalCost: () => 69.48,
    assembledPostHtml: () => "<thumb>",
    postNumberLabel: () => "Пост № 1",
    positionHover: () => {}
  };
  stand.runNamed(["backlightRowSummary", "showHover"], ctx)("post", { id: "p1" }, {});
  return hover.innerHTML;
}

test("showHover: подсветка есть → строка «Подсветка» в подсказке рядом со «Стоимостью поста»", () => {
  const html = hoverHtml(backOf([{ accessory: LED }], []));
  assert.match(html, /<dt>Подсветка<\/dt><dd>LED-подсветка · €19\.75<\/dd>/, "подсказка называет подсветку — иначе цена «за четыре» без объяснения");
  assert.ok(html.indexOf("Подсветка</dt>") < html.indexOf("Стоимость поста"), "подсветка стоит ДО итоговой стоимости — состав объясняет цену");
});

test("showHover: подсветка выключена → строки нет (подсказка как раньше)", () => {
  const html = hoverHtml(backOf([], []));
  assert.doesNotMatch(html, /Подсветка</, "нет подсветки — подсказка байт в байт прежняя");
});

/* ---- 4. renderProperties — карточка размещённого поста -------------------------------------- */

test("renderProperties: ветка поста встраивает backlightRowSummary(comp.backlight) отдельной строкой", () => {
  const src = stand.functionSource("renderProperties");
  const postBranch = src.slice(src.indexOf('kind==="post"'), src.indexOf('kind==="wall"'));
  assert.match(postBranch, /backlightRowSummary\(comp\.backlight\)/,
    "карточка обязана считать подсветку из состава поста единой функцией");
  assert.match(postBranch, /Подсветка клавиш<input value="\$\{esc\(backSummary\.text\)\}"/,
    "и показать её отдельной строкой — через esc, как остальной ввод карточки");
});
