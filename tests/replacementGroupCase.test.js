/* Д5 — замена цельного изделия по роли не должна ломаться на РЕГИСТРЕ имени функциональной группы.
   Снятые с производства изделия несут группу строчными («управление светом»), активные — с заглавной
   («Управление светом»). resolveReplacement сравнивал строго (===), и снятый осевой выключатель Arke
   19101 переставал заменяться на инвертор 19113 / кнопку 19108 (сохранённый проект терял замену).
   Нормализацию берём единым правилом EPCatalogSections.keyOf (регистр, пробелы, ё→е). Проверяем на
   НАСТОЯЩЕМ каталоге рантайма (как в index.html, со снятыми).

   Мутация (состязательный проход): в resolveReplacement вернуть строгое сравнение (убрать groupKey у
   fg/fsg) — замена снятого 19101 снова станет null, тест покраснеет.
   Запуск: node --test tests/replacementGroupCase.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const LP = require("../js/lightingPlan.js");
const CAT = require("../js/catalog.js");

function loadRuntime() {
  const jsDir = path.join(__dirname, "..", "js");
  const win = {};
  const context = vm.createContext({ window: win, structuredClone });
  for (const file of ["catalog-vimar.js", "catalog-vimar-attrs.js", "catalog-vimar-discontinued.js", "data.js"]) {
    vm.runInContext(fs.readFileSync(path.join(jsDir, file), "utf8"), context, { filename: file });
  }
  return win.EP_DATA.products;
}
const PRODUCTS = loadRuntime();
const byCode = code => PRODUCTS.find(p => String(p.code) === code);
const ser = p => (Array.isArray(p.series) ? p.series : []);
const integ = i => i && !i.partRole && ["switch", "changeover", "inverter", "button"].includes(i.controlRole);
/* ровно те же зависимости и тот же пул, что в приложении: кандидаты — АКТИВНЫЕ (byKind). */
const CANDS = PRODUCTS.filter(p => p.kind === "mechanism" && p.active && integ(p));
const DEPS = {
  seriesOf: ser, spanOf: CAT.mechanismSpan,
  colorKeyOf: i => (i && i.elementColor ? CAT.facingColorKey(i.elementColor) : null),
  fgOf: i => (i && i.functionalGroup) || null, fsgOf: i => (i && i.functionalSubgroup) || null
};
const rep = (code, role) => {
  const s = byCode(code);
  assert.ok(s, `изделие ${code} есть в каталоге`);
  const r = LP.resolveReplacement({ role, source: s }, CANDS, DEPS);
  return r.product ? r.product.code : (r.ambiguous ? "AMB" : "null");
};

test("снятый осевой выключатель Arke 19101 (группа строчными) заменяется на активные 19113/19108", () => {
  const s = byCode("19101");
  assert.ok(s && s.active === false, "19101 — снятая позиция");
  assert.equal(s.functionalGroup, "управление светом", "у снятой группа записана строчными");
  assert.equal(rep("19101", "inverter"), "19113");
  assert.equal(rep("19101", "button"), "19108");
  assert.equal(rep("19101", "switch"), "19101"); // роль уже совпадает — само изделие
});

test("активные изделия регистром группы не задеты (их группа и так с заглавной)", () => {
  // 19113 (активный инвертор) как источник на роль button → активная кнопка 19108 той же серии/цвета/группы
  assert.equal(rep("19113", "button"), "19108");
  assert.equal(rep("19108", "inverter"), "19113");
});
