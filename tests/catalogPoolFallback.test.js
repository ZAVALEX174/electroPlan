/* Д2 — ПУЛ С ЗАПАСОМ ИЗ СНЯТЫХ. Автоподбор детали поста берёт активные, а снятые — только если
   среди активных подходящей нет (сохранённый проект не теряет суппорт/подсветку; новый пост снятое
   не получает там, где есть активная). Правило — одно, EPCatalogPool.pick; проверяем и его в
   изоляции, и на НАСТОЯЩЕМ каталоге рантайма вместе с подбором из postfit (как в app.js).

   Мутации (состязательный проход):
     • в EPCatalogPool.pick вернуть всегда select(active) (убрать второй проход) — упадут тесты
       «снятый суппорт/подсветка возвращаются по запасу»;
     • в pick всегда select(act.concat(ext)) (игнорировать isFound) — упадёт тест «активная главнее:
       запас не трогаем, пока активная подходит».
   Запуск: node --test tests/catalogPoolFallback.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const POOL = require("../js/catalogPool.js");
const PF = require("../js/postfit.js");
const BP = require("../js/backlightPick.js");

/* ── pick в изоляции ─────────────────────────────────────────────────────── */
test("pick: активная найдена → запас из снятых НЕ запрашивается", () => {
  const seen = [];
  const r = POOL.pick(p => { seen.push(p); return p[0]; }, ["A"], ["off"], x => !!x);
  assert.equal(r, "A");
  assert.equal(seen.length, 1, "второй проход не нужен");
  assert.deepEqual(seen[0], ["A"], "подбор шёл только по активным");
});

test("pick: активной нет → второй проход по активным + снятым", () => {
  const seen = [];
  const r = POOL.pick(p => { seen.push(p.slice()); return p.find(x => x === "off") || null; }, [], ["off"], x => !!x);
  assert.equal(r, "off");
  assert.equal(seen.length, 2, "два прохода");
  assert.deepEqual(seen[1], ["off"], "во втором проходе появился запас");
});

test("pick: запас пуст → отдаём результат первого прохода без второго", () => {
  const seen = [];
  const r = POOL.pick(p => { seen.push(p); return null; }, ["A"], [], x => !!x);
  assert.equal(r, null);
  assert.equal(seen.length, 1);
});

test("pick: isFound=true при законно пустом ответе гасит второй проход (деталь не требуется)", () => {
  const seen = [];
  const r = POOL.pick(p => { seen.push(p); return null; }, ["A"], ["off"], () => true);
  assert.equal(r, null);
  assert.equal(seen.length, 1, "запас не подключаем, раз первый ответ признан итоговым");
});

/* ── интеграция на настоящем каталоге, как в app.js ──────────────────────── */
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
const act = kind => PRODUCTS.filter(p => p.kind === kind && p.active);
const off = kind => PRODUCTS.filter(p => p.kind === kind && p.active === false);

// суппорт, как его зовёт app.js (двухпроходно; isFound учитывает «планка не требуется»)
const supportFor = (frame, box) => POOL.pick(
  supports => PF.resolveSupport({ supports, frame, standard: frame.standard, modules: frame.slotCount, frameModules: frame.slotCount, seriesOf: ser, box }),
  act("support"), off("support"), r => !!(r && r.support) || !PF.supportRequired(frame)
).support;

test("сохранённый пост Arke Fit 19953.01: суппорт берётся из снятых (19913), раз активного нет", () => {
  const frame = byCode("19953.01");
  assert.ok(frame && frame.active === false, "19953.01 — снятая накладка Arke Fit");
  for (const bc of ["71001", "71701"]) {
    const activeOnly = PF.resolveSupport({ supports: act("support"), frame, standard: frame.standard, modules: frame.slotCount, frameModules: frame.slotCount, seriesOf: ser, box: byCode(bc) }).support;
    assert.equal(activeOnly, null, `box ${bc}: среди активных суппорта Arke Fit нет`);
    const s = supportFor(frame, byCode(bc));
    assert.ok(s, `box ${bc}: суппорт подобран из запаса`);
    assert.equal(s.code, "19913", `box ${bc}: это снятый 19913`);
    assert.equal(s.active, false, "19913 помечен снятым");
  }
});

test("подсветка 120 В: активной нет → берётся снятая 00936.120.* (EPBacklightPick, как в app.js)", () => {
  // Обычная клавиша (класс ordinary). Подбор идёт через EPBacklightPick.pick двухпроходным пулом —
  // ровно так, как findBacklight в app.js, которым и пользуется приложение (не старый EPPostFit).
  const mech = PRODUCTS.find(p => p.kind === "mechanism" && BP.classify(p) === "ordinary" && p.active);
  assert.ok(mech, "есть активная обычная клавиша");
  const opts = { mechanism: mech, color: "Белая", voltage: "120V" };
  const activeOnly = BP.pick(Object.assign({ accessories: act("accessory") }, opts));
  assert.equal(activeOnly, null, "активной подсветки 120 В нет");
  const bl = POOL.pick(accessories => BP.pick(Object.assign({ accessories }, opts)), act("accessory"), off("accessory"), a => !!a);
  assert.ok(bl, "подсветка 120 В подобрана из запаса");
  assert.equal(bl.active, false, "это снятый вариант");
  assert.match(bl.code, /^00936\.120/);
});

test("активная деталь главнее: где активный суппорт есть, снятый не подставляется", () => {
  // активная накладка Arke с активным суппортом — результат двухпроходного == результату по активным
  const frame = PRODUCTS.find(p => p.kind === "frame" && p.active && ser(p).includes("Arke"));
  assert.ok(frame, "есть активная накладка Arke");
  const box = byCode("71001");
  const activeOnly = PF.resolveSupport({ supports: act("support"), frame, standard: frame.standard, modules: frame.slotCount, frameModules: frame.slotCount, seriesOf: ser, box }).support;
  const withPool = supportFor(frame, box);
  assert.ok(activeOnly, "у активной накладки активный суппорт есть");
  assert.equal(withPool && withPool.code, activeOnly.code, "двухпроходный подбор не отличается от подбора по активным");
  assert.notEqual(withPool.active, false, "подставлен активный суппорт, не снятый");
});
