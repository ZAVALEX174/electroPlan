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
   ЖЕ отбор, что начинка в окне поста), цвет — EPMechColor.colorOf (столбец elementColor, иначе выведенный
   nameColor — то же ЕДИНОЕ правило, что в рантайме). НЕ productsForRoom: серия комнаты это подсерия
   («Eikon Evo»), а цветные механизмы под базой «Eikon» — точное членство дало бы пусто. */
const DEPS = {
  match: (m, c) => c && c.collection ? EPCatalog.compatibleMechanisms({ series: [c.collection] }, m) : m.slice(),
  colorOf: EPMechColor.colorOf
};
const FDEPS = { colorOf: EPMechColor.colorOf, keyOf: EPCatalog.facingColorKey };

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

/* ---- colorOf: ЕДИНОЕ правило «цвет механизма для окна поста» = elementColor || nameColor --------
   Мутация «colorOf вернуть только nameColor» красит «столбец главнее»; «только elementColor» красит
   «без столбца берём выведенный». */

test("colorOf: столбец (elementColor) ГЛАВНЕЕ выведенного (nameColor)", () => {
  assert.equal(EPMechColor.colorOf({ elementColor: "Белый", nameColor: "Чёрный" }), "Белый");
});

test("colorOf: столбца нет → выведенный из названия (nameColor)", () => {
  assert.equal(EPMechColor.colorOf({ nameColor: "Серебристый" }), "Серебристый");
});

test("colorOf: ни столбца, ни выведенного → \"\" (бесцветный, в окне поста виден всегда)", () => {
  assert.equal(EPMechColor.colorOf({}), "");
  assert.equal(EPMechColor.colorOf(null), "");
});

/* ---- НАСТОЯЩИЙ каталог VIMAR: точные числа цветов по сериям (разведка 31.10) ------------------ */

/* ТОЛЬКО active — как byKind в приложении (дефект 31.10 замерен на active). Подмешиваем ОБА раздела
   как js/data.js: elementColor из colors (столбец) и nameColor из nameColors (выведенный) — окно поста
   читает их через colorOf. */
function loadRealMechanisms() {
  const win = {};
  ["catalog-vimar.js", "catalog-vimar-attrs.js"].forEach(f =>
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8"), { window: win }));
  const colors = (win.EP_VIMAR_ATTRS && win.EP_VIMAR_ATTRS.colors) || {};
  const nameColors = (win.EP_VIMAR_ATTRS && win.EP_VIMAR_ATTRS.nameColors) || {};
  return win.EP_VIMAR_CATALOG.products
    .filter(p => p.kind === "mechanism" && p.active !== false)
    .map(p => {
      const o = { ...p };
      if (colors[p.code]) o.elementColor = colors[p.code];
      if (nameColors[p.code]) o.nameColor = nameColors[p.code];
      return o;
    });
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
      .filter(m => { const c = EPMechColor.colorOf(m); return c && EPCatalog.facingColorKey(c) === EPCatalog.facingColorKey(color); }).length;
  /* Eikon Evo (К12 ч.3, доводка 31.10, раунд 2): числа выросли против столбца — цвет берётся и ИЗ
     НАЗВАНИЯ через colorOf, когда столбец «Цвет элемента» пуст (серый 20003 → Чёрный и т. д.). Чёрный 53,
     а не 57 как в раунде 1: голым механизмам за клавишей (20001.0/20005.0/20008.0/20013.0) цвет из
     названия БОЛЬШЕ не выводится (решение владельца 31.10 п.3) — они бесцветны и видны всегда. Белый/
     Серебристый по 69. Бронза 0: декор подсерии Vintage в базу Eikon не подмешивается (регресс-гард цел). */
  assert.equal(countOf("Eikon Evo", "Белый"), 69);
  assert.equal(countOf("Eikon Evo", "Чёрный"), 53);
  assert.equal(countOf("Eikon Evo", "Серебристый"), 69);
  assert.equal(countOf("Eikon Evo", "Металлик"), 1);
  assert.equal(countOf("Eikon Evo", "Бронза"), 0, "декор Vintage НЕ попал в Evo");
  /* Eikon Flat: база + свой декор (как окно поста к накладке Flat) */
  const flat = EPMechColor.colorsFor(mechs, { collection: "Eikon Flat" }, DEPS);
  assert.ok(flat.includes("Белый") && flat.includes("Бронза"), "Flat = база + свой декор");
  /* Arke: Белый/Чёрный/Металлик по 65 (было 30/31/31 — вывод цвета из названия добавил «серые»/«белые») */
  assert.equal(countOf("Arke", "Белый"), 65);
  assert.equal(countOf("Arke", "Чёрный"), 65);
  assert.equal(countOf("Arke", "Металлик"), 65);
  /* Plana: Белый 64, Серебристый 53 (было 32/32) */
  assert.equal(countOf("Plana", "Белый"), 64);
  assert.equal(countOf("Plana", "Серебристый"), 53);
  /* Neve Up: Белый 52, Чёрный 54 (было 26/25; «карбон матовый» в названии → Чёрный по столбцу серии) */
  assert.deepEqual(EPMechColor.colorsFor(mechs, { collection: "Neve Up" }, DEPS), ["Белый", "Чёрный"]);
  assert.equal(countOf("Neve Up", "Белый"), 52);
  assert.equal(countOf("Neve Up", "Чёрный"), 54);
  /* Linea — цвета механизмов нет → шаг скрыт */
  assert.deepEqual(EPMechColor.colorsFor(mechs, { collection: "Linea" }, DEPS), []);
  assert.equal(EPMechColor.visible(mechs, { collection: "Linea" }, DEPS), false);
});

test("реальный каталог: голый механизм за клавишей БЕСЦВЕТЕН (цвет из названия не выведен) → виден всегда", () => {
  const mechs = loadRealMechanisms();
  const byCode = c => mechs.find(m => m.code === c);
  /* 20001.0/20005.0/20008.0/20013.0 — голые Eikon «Механизм-… серый» за клавишей любого цвета (решение
     владельца 31.10 п.3: цвет из названия им НЕ выводим). colorOf = "" → фильтр окна поста их не трогает. */
  ["20001.0", "20005.0", "20008.0", "20013.0"].forEach(c =>
    assert.equal(EPMechColor.colorOf(byCode(c)), "", c + " должен быть бесцветным"));
  const filtered = EPMechColor.filter(EPCatalog.compatibleMechanisms({ series: ["Eikon Evo"] }, mechs), "Белый", FDEPS);
  ["20001.0", "20005.0", "20008.0", "20013.0"].forEach(c =>
    assert.ok(filtered.some(m => m.code === c), c + " виден в окне поста Eikon Evo + Белый"));
  /* А цветной НЕголый серый 20003 при «Белом» отсеивается, белый 20003.B — остаётся. */
  assert.ok(!filtered.some(m => m.code === "20003"), "серый 20003 отсеян при Белом");
  assert.ok(filtered.some(m => m.code === "20003.B"), "белый 20003.B остаётся");
});

/* ---- АВТОЗАМЕНА СМЕТЫ: цвет из названия НЕ должен в неё попасть (решение владельца 31.10) --------
   resolveReplacement сравнивает цвет через colorKeyOf. Он ОБЯЗАН читать только столбец (item.elementColor),
   как в HEAD, иначе выведенный nameColor добавляет ложных кандидатов и строка выпадает из сметы (деньги).
   МУТАЦИЯ: colorKeyOf читает nameColor||elementColor — все три пары становятся неоднозначными/пустыми
   (ниже), тест краснеет. */
function loadReplacementCatalog() {
  const ctx = vm.createContext({ window: {}, structuredClone });
  ["catalog-vimar.js", "catalog-vimar-attrs.js", "catalog-vimar-discontinued.js", "data.js"].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8"), ctx, { filename: f }));
  return ctx.window.EP_DATA.products;
}
function replacementDeps(colorField) {
  return {
    seriesOf: EPCatalog.productSeries, spanOf: EPCatalog.mechanismSpan,
    colorKeyOf: i => i && colorField(i) ? EPCatalog.facingColorKey(colorField(i)) : null,
    fgOf: i => (i && i.functionalGroup) || null, fsgOf: i => (i && i.functionalSubgroup) || null
  };
}

test("автозамена: цвет по СТОЛБЦУ даёт точную замену (как HEAD); nameColor в colorKeyOf её ломает", () => {
  const EPLightingPlan = require("../js/lightingPlan.js");
  const prods = loadReplacementCatalog();
  const mechs = prods.filter(p => p.kind === "mechanism" && p.active);
  const byCode = c => prods.find(p => p.code === c);
  const rep = (code, role, deps) => EPLightingPlan.resolveReplacement({ role, source: byCode(code) }, mechs, deps);
  /* Столбец (как в рантайме и HEAD) — однозначные замены. */
  const col = replacementDeps(i => i.elementColor);
  assert.equal(rep("14100.2", "changeover", col).product.code, "14104.2");
  assert.equal(rep("14066", "switch", col).product.code, "14100");
  assert.equal(rep("14003", "changeover", col).product.code, "14007", "снятый 14003 → 14007");
  /* МУТАЦИЯ: добавили nameColor в ключ цвета — замены ломаются (неоднозначно/пусто). Это и есть доказательство,
     что в смету выведенный цвет попадать НЕ должен. */
  const mut = replacementDeps(i => i.nameColor || i.elementColor);
  assert.equal(rep("14100.2", "changeover", mut).product, null, "мутация: 14100.2 стала неоднозначной");
  assert.equal(rep("14066", "switch", mut).product, null, "мутация: 14066 без замены");
  assert.equal(rep("14003", "changeover", mut).product, null, "мутация: 14003 стала неоднозначной");
});
