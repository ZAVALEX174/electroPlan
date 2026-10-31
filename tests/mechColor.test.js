/* Чистый модуль «цвет механизмов» (EPMechColor, js/mechColor.js, К12 ч.3). Запуск: node --test tests/
   Проверяем ГЛАВНОЕ: какие цвета у серии, видимость шага, автозаполнение, и фильтр начинки, где
   БЕСЦВЕТНЫЕ видны всегда (решение владельца 31.10). deps — НАСТОЯЩИЙ EPCatalog.productsForRoom (тот же
   фильтр серии, что у накладок, §7.1), а не заглушка.

   МУТАЦИОННАЯ ТАБЛИЦА (в отчёте):
     filter без «!c ||» (бесцветные выбрасываются)          → красит «бесцветные видны всегда»;
     filter равенством строк вместо keyOf                   → красит «цвет сводится ключом (род/число)»;
     visible с >=1 вместо >1 (единственный цвет показан)    → красит «серия с одним цветом → шаг скрыт»;
     autoValue возвращает цвет при >1                       → красит «многозначный цвет не подставляется». */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EPMechColor = require("../js/mechColor.js");
const EPCatalog = require("../js/catalog.js");

/* deps как в app.js/postBuilder: совместимость с серией — compatibleMechanisms (семейное правило, ТОТ
   ЖЕ отбор, что начинка в окне поста), цвет — elementColor. НЕ productsForRoom: серия комнаты это
   подсерия («Eikon Evo»), а цветные механизмы под базой «Eikon» — точное членство дало бы пусто. */
const DEPS = {
  match: (m, c) => c && c.collection ? EPCatalog.compatibleMechanisms({ series: [c.collection] }, m) : m.slice(),
  colorOf: item => (item && item.elementColor) || ""
};
const FDEPS = { colorOf: item => (item && item.elementColor) || "", keyOf: EPCatalog.facingColorKey };

/* Синтетическая начинка повторяет каталог: цветные механизмы Eikon лежат под БАЗОЙ «Eikon»; декоративный
   цвет живёт в подсерии «Eikon Vintage»; Plana с одним цветом; Linea без цвета вовсе. Серия комнаты —
   подсерия (Evo/Exe/Vintage), совместимость с базой даёт семейное правило EPSeriesMatch. */
const MECHS = [
  { id: 1, kind: "mechanism", series: ["Eikon"], elementColor: "Белый" },
  { id: 2, kind: "mechanism", series: ["Eikon"], elementColor: "Чёрный" },
  { id: 3, kind: "mechanism", series: ["Eikon"], elementColor: "Серебристый" },
  { id: 4, kind: "mechanism", series: ["Eikon"] },                                  /* база без цвета */
  { id: 5, kind: "mechanism", series: ["Eikon Vintage"], elementColor: "Бронза" },  /* декор подсерии */
  { id: 6, kind: "mechanism", series: ["Plana"], elementColor: "Белый" },           /* одна серия — один цвет */
  { id: 7, kind: "mechanism", series: ["Linea"] },
  { id: 8, kind: "mechanism", series: ["Linea"] }
];

/* ---- colorsFor -------------------------------------------------------------------------------- */

test("colorsFor: подсерия Eikon Evo берёт цвета БАЗЫ Eikon, БЕЗ декора другой подсерии (Бронза Vintage)", () => {
  /* Ключевой дефект 31.10: Evo/Exe не показывали шаг. Семейное правило: Evo совместима с базой «Eikon»,
     но НЕ с «Eikon Vintage» (подсерия с подсерией несовместимы) → Бронзы нет. Мутация «точное членство»
     (productsForRoom.collection) вернула бы [] — тест покраснеет. */
  assert.deepEqual(EPMechColor.colorsFor(MECHS, { collection: "Eikon Evo" }, DEPS), ["Белый", "Серебристый", "Чёрный"]);
  assert.deepEqual(EPMechColor.colorsFor(MECHS, { collection: "Eikon Exe" }, DEPS), ["Белый", "Серебристый", "Чёрный"]);
});

test("colorsFor: подсерия Vintage = база + свой декор (как окно поста к её накладке)", () => {
  assert.deepEqual(EPMechColor.colorsFor(MECHS, { collection: "Eikon Vintage" }, DEPS), ["Белый", "Бронза", "Серебристый", "Чёрный"]);
});

test("colorsFor: серия без цвета (Linea) → пусто", () => {
  assert.deepEqual(EPMechColor.colorsFor(MECHS, { collection: "Linea" }, DEPS), []);
});

test("colorsFor: серия с одним цветом (Plana) → один", () => {
  assert.deepEqual(EPMechColor.colorsFor(MECHS, { collection: "Plana" }, DEPS), ["Белый"]);
});

test("colorsFor: серия не задана → все цвета каталога (без дублей)", () => {
  assert.deepEqual(EPMechColor.colorsFor(MECHS, {}, DEPS), ["Белый", "Бронза", "Серебристый", "Чёрный"]);
});

/* ---- visible (правило то же, что framePicker.stepVisible) ------------------------------------- */

test("visible: ≥2 цветов → шаг виден (Eikon Evo — починка дефекта 31.10)", () => {
  assert.equal(EPMechColor.visible(MECHS, { collection: "Eikon Evo" }, DEPS), true);
});

test("visible: серия без цвета → скрыт (Linea/Tondo/Tactil)", () => {
  assert.equal(EPMechColor.visible(MECHS, { collection: "Linea" }, DEPS), false);
});

test("visible: серия с ОДНИМ цветом → скрыт (выбирать нечего, подставится автозаполнением)", () => {
  assert.equal(EPMechColor.visible(MECHS, { collection: "Plana" }, DEPS), false);
});

test("visible: сохранён мёртвый цвет (нет в наборе) → шаг виден для правки (край совместимости)", () => {
  assert.equal(EPMechColor.visible(MECHS, { collection: "Plana", mechColor: "Чёрный" }, DEPS), true);
});

/* ---- autoValue (ч.2 распространяется на цвет механизмов) -------------------------------------- */

test("autoValue: единственный цвет серии подставляется сам", () => {
  assert.equal(EPMechColor.autoValue(MECHS, { collection: "Plana" }, DEPS), "Белый");
});

test("autoValue: многозначный → null; серия без цвета → null", () => {
  assert.equal(EPMechColor.autoValue(MECHS, { collection: "Eikon Evo" }, DEPS), null);
  assert.equal(EPMechColor.autoValue(MECHS, { collection: "Linea" }, DEPS), null);
});

/* ---- filter: бесцветные видны всегда, цветные — только совпадающие ---------------------------- */

test("filter: выбран «Белый» → белые + БЕСЦВЕТНЫЕ, без чёрных/серебристых/бронзы", () => {
  const ids = EPMechColor.filter(MECHS, "Белый", FDEPS).map(m => m.id).sort((a, b) => a - b);
  /* 1,6 — белые; 4,7,8 — без цвета (видны всегда); 2 (чёрный), 3 (серебристый), 5 (бронза) — отсеяны */
  assert.deepEqual(ids, [1, 4, 6, 7, 8]);
});

test("filter: бесцветный механизм остаётся при ЛЮБОМ выбранном цвете (мутация «убрать !c» красит)", () => {
  assert.ok(EPMechColor.filter(MECHS, "Чёрный", FDEPS).some(m => m.id === 4), "бесцветный Eikon виден и при чёрном");
});

test("filter: совпадение по КЛЮЧУ (род/число/регистр), а не равенством строк", () => {
  /* Цвет приходит из словаря накладок («Белая»/нижний регистр) — facingColorKey сводит к «Белый». */
  const ids = EPMechColor.filter(MECHS, "белый", FDEPS).map(m => m.id);
  assert.ok(ids.includes(1) && ids.includes(6), "«белый» матчит «Белый» через ключ");
  assert.ok(!ids.includes(2), "чёрный не попал");
});

test("filter: цвет не задан (пусто) → копия всего списка (ограничения нет)", () => {
  assert.equal(EPMechColor.filter(MECHS, "", FDEPS).length, MECHS.length);
  assert.equal(EPMechColor.filter(MECHS, null, FDEPS).length, MECHS.length);
});

/* ---- checkboxLabel --------------------------------------------------------------------------- */

test("checkboxLabel: подпись с цветом", () => {
  assert.equal(EPMechColor.checkboxLabel("Белый"), "Только механизмы цвета «Белый»");
});

/* ---- НАСТОЯЩИЙ каталог VIMAR: точные числа цветов по сериям (разведка 31.10) ------------------ */

/* ТОЛЬКО active — как byKind в приложении (дефект 31.10 замерен на active). */
function loadRealMechanisms() {
  const win = {};
  ["catalog-vimar.js", "catalog-vimar-attrs.js"].forEach(f =>
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8"), { window: win }));
  const colors = (win.EP_VIMAR_ATTRS && win.EP_VIMAR_ATTRS.colors) || {};
  return win.EP_VIMAR_CATALOG.products
    .filter(p => p.kind === "mechanism" && p.active !== false)
    .map(p => colors[p.code] ? { ...p, elementColor: colors[p.code] } : { ...p });
}

test("реальный каталог (active): Eikon Evo/Exe берут цвета базовой линии — шаг НЕ пустой (дефект 31.10)", () => {
  const mechs = loadRealMechanisms();
  /* Серия комнаты — ПОДСЕРИЯ (Evo/Exe), накладок «Eikon» (база) в списке серий нет. Механизмы цветные
     под базой → совместимость семейным правилом. Мутация «точное членство» (productsForRoom.collection)
     вернула бы [] для Evo/Exe — тест покраснеет. */
  ["Eikon Evo", "Eikon Exe"].forEach(series => {
    assert.deepEqual(EPMechColor.colorsFor(mechs, { collection: series }, DEPS),
      ["Белый", "Металлик", "Серебристый", "Чёрный"], series + ": база Eikon, без декора подсерий");
    assert.equal(EPMechColor.visible(mechs, { collection: series }, DEPS), true, series + ": шаг виден");
  });
});

test("реальный каталог (active): числа цветов по сериям; декор НЕ подмешан в Evo, но есть у Flat", () => {
  const mechs = loadRealMechanisms();
  const countOf = (series, color) =>
    EPCatalog.compatibleMechanisms({ series: [series] }, mechs)
      .filter(m => m.elementColor && EPCatalog.facingColorKey(m.elementColor) === EPCatalog.facingColorKey(color)).length;
  /* Eikon Evo: Белый/Чёрный/Серебристый по 37, Металлик 1 */
  assert.equal(countOf("Eikon Evo", "Белый"), 37);
  assert.equal(countOf("Eikon Evo", "Чёрный"), 37);
  assert.equal(countOf("Eikon Evo", "Серебристый"), 37);
  assert.equal(countOf("Eikon Evo", "Металлик"), 1);
  assert.equal(countOf("Eikon Evo", "Бронза"), 0, "декор Vintage НЕ попал в Evo");
  /* Eikon Flat: база + свой декор (как окно поста к накладке Flat) */
  const flat = EPMechColor.colorsFor(mechs, { collection: "Eikon Flat" }, DEPS);
  assert.ok(flat.includes("Белый") && flat.includes("Бронза"), "Flat = база + свой декор");
  /* Arke: Белый 30, Чёрный 31, Металлик 31 */
  assert.equal(countOf("Arke", "Белый"), 30);
  assert.equal(countOf("Arke", "Чёрный"), 31);
  assert.equal(countOf("Arke", "Металлик"), 31);
  /* Plana: Белый/Серебристый по 32 */
  assert.equal(countOf("Plana", "Белый"), 32);
  assert.equal(countOf("Plana", "Серебристый"), 32);
  /* Neve Up: Белый 26, Чёрный 25 */
  assert.deepEqual(EPMechColor.colorsFor(mechs, { collection: "Neve Up" }, DEPS), ["Белый", "Чёрный"]);
  assert.equal(countOf("Neve Up", "Белый"), 26);
  assert.equal(countOf("Neve Up", "Чёрный"), 25);
  /* Linea — цвета механизмов нет → шаг скрыт */
  assert.deepEqual(EPMechColor.colorsFor(mechs, { collection: "Linea" }, DEPS), []);
  assert.equal(EPMechColor.visible(mechs, { collection: "Linea" }, DEPS), false);
});
