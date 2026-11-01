/* ЦВЕТ ИЗ НАЗВАНИЯ/АРТИКУЛА ДЛЯ ЗАМЕНЫ ЦЕЛЬНОГО ИЗДЕЛИЯ (К14 ч.1, слова заказчика 15.10, 0:20:47):
   «если мы берём 19-100 осевой механизм, вот он выключатель… 19-104… переключатель… у него точно
   такая же картинка». Белый осевой ВЫКЛЮЧАТЕЛЬ Arke 19100.B на группе с двух мест обязан сам
   встать белым ПЕРЕКЛЮЧАТЕЛЕМ 19104.B — выбирать человеку нечего.

   Корень прежнего пробела: у «Управления светом» столбец цвета (elementColor) пуст у части осевых
   механизмов, и 19100.B несёт «Белый» только в НАЗВАНИИ. Чтение одного столбца давало source цвет
   null, а трём кандидатам 19104/19104.B/19104.M — null у всех → неоднозначность, строка выпадала.
   Правка: replacementDeps.colorKeyOf читает цвет тем же EPMechColor.colorOf (столбец‖название‖
   артикул), что окно поста, и сводит к гамме facingColorKey — тогда «Белый» 19100.B находит «Белый»
   19104.B, а чёрный/серебристый остаются при своём.

   Проверяем на НАСТОЯЩЕМ рантайм-каталоге VIMAR (catalog-vimar.js + attrs + data.js) теми же
   зависимостями, что соберёт app.js lightingFor после правки. Мутационная проверка внизу: вернуть
   чтение к одному elementColor — и белый 19100.B снова станет неоднозначным (тест краснеет). */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EPLightingPlan = require("../js/lightingPlan.js");
const EPCatalog = require("../js/catalog.js");
const EPMechColor = require("../js/mechColor.js");

/* Рантайм-каталог: три файла в том же порядке, что index.html. */
const JS_DIR = path.join(__dirname, "..", "js");
const win = {};
const context = vm.createContext({ window: win, structuredClone });
for (const f of ["catalog-vimar.js", "catalog-vimar-attrs.js", "data.js"]) {
  vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), "utf8"), context, { filename: f });
}
const PRODUCTS = win.EP_DATA.products;
const byCode = code => PRODUCTS.find(p => p.code === code);
const mechs = PRODUCTS.filter(p => p.kind === "mechanism" && p.active);

/* Зависимости строгого подбора замены — ровно как app.js:1788 после правки (цвет через
   EPMechColor.colorKey, остальное без изменений). */
const deps = {
  seriesOf: EPCatalog.productSeries, spanOf: EPCatalog.mechanismSpan,
  colorKeyOf: item => EPMechColor.colorKey(item, { keyOf: EPCatalog.facingColorKey }),
  fgOf: item => (item && item.functionalGroup) || null,
  fsgOf: item => (item && item.functionalSubgroup) || null
};
const replace = (code, role) =>
  EPLightingPlan.resolveReplacement({ role, source: byCode(code) }, mechs, deps);

test("разведка: цвет 19100.B лежит в названии, не в столбце", () => {
  const s = byCode("19100.B");
  assert.ok(s, "19100.B есть в рантайм-каталоге");
  assert.equal(s.elementColor || null, null, "в столбце цвета у 19100.B нет");
  assert.equal(EPMechColor.colorOf(s), "Белый", "colorOf выводит «Белый» из названия");
});

test("белый осевой выключатель 19100.B → переключатель 19104.B сам, без выбора (цель заказчика 15.10)", () => {
  const r = replace("19100.B", "changeover");
  assert.equal(r.product && r.product.code, "19104.B", "в смету встаёт именно белый переключатель 19104.B");
  assert.equal(r.ambiguous, false, "человеку выбирать нечего");
});

test("цвет держится: чёрный 20003.N → 20007.N, базовый 20003 → 20007 (Eikon)", () => {
  assert.equal(replace("20003.B", "changeover").product.code, "20007.B", "белый Eikon → белый переключатель");
  assert.equal(replace("20003.N", "changeover").product.code, "20007.N", "чёрный Eikon → чёрный переключатель");
  assert.equal(replace("20003", "changeover").product.code, "20007", "базовый Eikon → базовый переключатель");
});

/* ─────────────────────── осевое правило и послабление подгруппы (К14 ч.1, владелец 01.11) ─────────────────────── */

test("осевое правило: 14100.2/14108.2/14113.2 → changeover = 14104.2, НЕ «тройной» 14007", () => {
  /* 14104.2 осевой, 14007 «Переключатель тройной 1P 20AX» не осевой — оба белые span-2 Plana. Осевой
     источник берёт только осевого кандидата, 14007 (63,30 €) в замену не уходит. */
  ["14100.2", "14108.2", "14113.2"].forEach(code => {
    const r = replace(code, "changeover");
    assert.equal(r.product && r.product.code, "14104.2", code + " → осевой переключатель 14104.2");
    assert.equal(r.ambiguous, false, code + ": 14007 не даёт неоднозначности");
  });
});

test("послабление fsg для осевых: белый выключатель 19100.B → инвертор 19113.B (разные подгруппы)", () => {
  /* 19100.B без functionalSubgroup, его осевой инвертор 19113.B — «Осевые механизмы». Оба осевые →
     подгруппа не требуется; датчик 19181.B не осевой и отсечён ещё осевым правилом. */
  const r = replace("19100.B", "inverter");
  assert.equal(r.product && r.product.code, "19113.B", "осевой инвертор найден несмотря на разную подгруппу");
});

test("ИК-датчик 19181.B не попадает в кандидаты замены ни к одному осевому изделию (чужая конструкция)", () => {
  ["switch", "changeover", "inverter", "button"].forEach(role => {
    ["19100.B", "19104.B", "19113.B", "19108.B"].forEach(code => {
      const r = replace(code, role);
      assert.ok(!r.candidates.some(x => x.code === "19181.B"), `19181.B не кандидат к ${code}/${role}`);
    });
  });
});

/* МУТАЦИЯ 1 — цвет. Вернуть чтение к одному столбцу (elementColor-only) — и белый выключатель 19100.B,
   у которого столбец пуст, снова неоднозначен: правило «цвет из названия» действительно держит. */
test("мутация цвета: elementColor-only возвращает неоднозначность для 19100.B", () => {
  const mutated = Object.assign({}, deps, {
    colorKeyOf: item => (item && item.elementColor ? EPCatalog.facingColorKey(item.elementColor) : null)
  });
  const r = EPLightingPlan.resolveReplacement({ role: "changeover", source: byCode("19100.B") }, mechs, mutated);
  assert.equal(r.product, null, "на столбце-only замена снова неоднозначна");
  assert.equal(r.ambiguous, true);
});

/* МУТАЦИЯ 2 — осевое правило. Объявив ВСЁ осевым (axialOf→true), снимаем разделение осевой/не-осевой:
   тогда к 14104.2 примешивается «тройной» 14007 и замена становится неоднозначной. */
test("мутация осевого правила: без него 14100.2 → changeover неоднозначен (14007 примешивается)", () => {
  const mutated = Object.assign({}, deps, { axialOf: () => true });
  const r = EPLightingPlan.resolveReplacement({ role: "changeover", source: byCode("14100.2") }, mechs, mutated);
  assert.equal(r.product, null, "без осевого разделения 14007 и 14104.2 неотличимы");
  assert.ok(r.candidates.some(x => x.code === "14007"), "14007 просочился в кандидаты");
});

/* МУТАЦИЯ 3 — послабление fsg. Объявив всё НЕ осевым (axialOf→false), включаем строгое требование
   подгруппы для всех: тогда 19100.B (без подгруппы) теряет инвертор 19113.B («Осевые механизмы»). */
test("мутация послабления fsg: при строгой подгруппе 19100.B → inverter теряется", () => {
  const mutated = Object.assign({}, deps, { axialOf: () => false });
  const r = EPLightingPlan.resolveReplacement({ role: "inverter", source: byCode("19100.B") }, mechs, mutated);
  assert.equal(r.product, null, "строгая подгруппа отсекает 19113.B — послабление действительно держит пару");
});
