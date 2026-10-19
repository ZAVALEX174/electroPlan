/* Д1 — подбор голого механизма за клавишей, когда в серии несколько механизмов одной роли,
   различающихся ПОСАДКОЙ ПОД КЛАВИШУ: осевой/обычный (Plana) и по числу модулей (Linea).
   Проверяем на НАСТОЯЩЕМ каталоге рантайма (как его собирает js/data.js, включая снятые —
   тот же порядок файлов, что в index.html), а не на заглушке: дефект был именно в том, что
   новая номенклатура добавила осевые 14100.0/14104.0 и 2М-механизмы Linea, и подбор стал
   неоднозначным (14001.0 → null AMB[14001.0,14100.0]).

   Мутации (состязательный проход):
     • убрать в resolveMechanism фильтр осевого (byAxial) — Plana 14021 switch снова станет
       неоднозначным (null), тест «14021 → 14001.0» покраснеет;
     • убрать фильтр модулей (bySpan) — Linea 1М/2М станут неоднозначны, тесты Linea покраснеют;
     • убрать place.keyVariant из ключа кэша в lightingGroups.lookup (вернуть null) — тест
       «кэш не склеивает 1М и 2М в одной группе» покраснеет (оба поста получат один механизм).
   Запуск: node --test tests/mechanismAxialModule.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const LP = require("../js/lightingPlan.js");
const LG = require("../js/lightingGroups.js");

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
const seriesOf = item => (item && item.series) || [];
const MECHS = PRODUCTS.filter(p => p.kind === "mechanism" && p.active);

/* Подбор ровно так, как его зовёт приложение: клавиша уходит в query.key (app.js lightingFor). */
const resolve = (keyCode, role) => {
  const key = byCode(keyCode);
  assert.ok(key, `клавиша ${keyCode} есть в каталоге`);
  return LP.resolveMechanism({ role, series: seriesOf(key), key }, MECHS);
};
const got = (keyCode, role) => { const r = resolve(keyCode, role); return r.product ? r.product.code : (r.ambiguous ? "AMB" : "null"); };

test("Plana: обычная клавиша 14021 получает ОБЫЧНЫЙ механизм (не осевой)", () => {
  assert.equal(got("14021", "switch"), "14001.0");       // был null AMB[14001.0,14100.0]
  assert.equal(got("14021", "changeover"), "14005.0");   // был null AMB[14005.0,14104.0]
  assert.equal(got("14021", "inverter"), "14013.0");
  assert.equal(got("14021", "button"), "14008.0");
});

test("Plana: ОСЕВАЯ клавиша 14131/14132 получает ОСЕВОЙ механизм", () => {
  assert.equal(got("14131", "switch"), "14100.0");
  assert.equal(got("14131", "changeover"), "14104.0");
  // 2М-осевой клавише осевого 2М-механизма в каталоге нет — остаётся единственный осевой 14100.0
  assert.equal(got("14132", "switch"), "14100.0");
});

test("Linea: механизм выбирается по числу модулей клавиши (1М против 2М)", () => {
  assert.equal(got("31000.B", "switch"), "30000");        // 1М
  assert.equal(got("31000.2B", "switch"), "30000.2");     // 2М
  assert.equal(got("31000.2B", "changeover"), "30004.2"); // 2М
  assert.equal(got("31000A.B", "switch"), "30000");       // осевая 1М, осевого механизма нет → по модулям
  assert.equal(got("31000A.2B", "button"), "30008.2");    // осевая 2М
});

test("Eikon Flat/Tondo и базовый Eikon — НЕ изменились (осевые 22104/22108, Eikon 20001.0/20005.0)", () => {
  const flat = PRODUCTS.find(p => p.partRole === "key" && seriesOf(p).includes("Eikon Flat"));
  assert.ok(flat, "клавиша Eikon Flat есть");
  assert.equal(got(flat.code, "switch"), "22104");
  assert.equal(got(flat.code, "button"), "22108");
  const eikon = PRODUCTS.find(p => p.partRole === "key" && JSON.stringify(seriesOf(p)) === JSON.stringify(["Eikon"]));
  assert.ok(eikon, "клавиша базового Eikon есть");
  assert.equal(got(eikon.code, "switch"), "20001.0");
  assert.equal(got(eikon.code, "changeover"), "20005.0");
});

test("нет осиротевших неоднозначностей: ни одна клавиша не теряет механизм на двусмысленности посадки", () => {
  const keys = PRODUCTS.filter(p => p.partRole === "key");
  const amb = [];
  for (const k of keys) for (const role of ["switch", "changeover", "inverter", "button"]) {
    const r = LP.resolveMechanism({ role, series: seriesOf(k), key: k }, MECHS);
    if (r.ambiguous) amb.push(`${k.code} ${role} [${r.candidates.map(c => c.code)}]`);
  }
  assert.deepEqual(amb, [], "ambiguous не должно остаться после различения по посадке");
});

/* Кэш подбора в lightingGroups НЕ должен склеивать клавиши разной посадки одной серии+роли:
   в одном расчёте 1М-клавиша и 2М-клавиша Linea (две одноместные группы, роль switch) обязаны
   получить РАЗНЫЕ механизмы. Без place.keyVariant в ключе кэша обе получили бы один (порядок входа). */
test("кэш не склеивает 1М и 2М Linea в одном расчёте (keyVariant в ключе)", () => {
  const k1 = byCode("31000.B"), k2 = byCode("31000.2B");
  const posts = [
    { id: "P1", number: "1", mechanismIds: [k1.id], keyGroups: ["A"] },
    { id: "P2", number: "2", mechanismIds: [k2.id], keyGroups: ["B"] }
  ];
  const product = id => PRODUCTS.find(p => p.id === id);
  const places = LP.collect(posts, {
    product, seriesOf,
    controlKind: item => (item && item.partRole === "key") ? "key" : null
  });
  const plan = LG.plan({ scheme: "classic", places }, {
    seriesOf,
    findMechanism: ({ role, series, kind, source }) =>
      LP.resolveMechanism({ role, series, key: source }, MECHS).product
  });
  const byPost = new Map(plan.places.map(p => [p.postId, p.code]));
  assert.equal(byPost.get("P1"), "30000", "1М-клавиша → 1М-механизм");
  assert.equal(byPost.get("P2"), "30000.2", "2М-клавиша → 2М-механизм");
});
