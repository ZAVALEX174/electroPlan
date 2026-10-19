/* Принцип центрального монтажа из «Примечания» нового файла (tools/lib/mountNote.mjs). */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.join(__dirname, "..");
let M;
test.before(async () => { M = await import(pathToFileURL(path.join(ROOT, "tools", "lib", "mountNote.mjs")).href); });

const sup = new Map([
  ["19601", { principle: "1M_CENTRAL", boxModularity: 2 }],
  ["09606", { principle: "2M_CENTRAL", boxModularity: 3 }],
  ["09607", { principle: null, boxModularity: null }],
  ["09613", { principle: null, boxModularity: null }],
]);
const pb = (n) => { const r = M.mountFromNote(n, sup); return r && [r.principle, r.boxModularity]; };

test("текстовые формулировки заказчика → коды принципа", () => {
  assert.deepEqual(pb("1 модуль центрально в коробку и суппорт на 2 модуля"), ["1M_CENTRAL", 2]);
  assert.deepEqual(pb("1модуль центрально в коробку на 2 модуля"), ["1M_CENTRAL", 2]);
  assert.deepEqual(pb("1 модуль в коробку 2 модуля центрально"), ["1M_CENTRAL", 2]);
  assert.deepEqual(pb("1 модуль центрально в коробку и суппорт на 3модуля"), ["1M_CENTRAL_3", 3]);
  assert.deepEqual(pb("2 модуля через один в коробку и суппорт на 3модуля"), ["2M_CENTRAL", 3]);
});

test("«В суппорт N» берёт принцип суппорта; без данных у суппорта — не угадываем", () => {
  assert.deepEqual(pb("Всуппорт 19601"), ["1M_CENTRAL", 2]);
  assert.deepEqual(pb("В суппорт 09606 и 09607"), ["2M_CENTRAL", 3]);
  assert.equal(M.mountFromNote("В суппорт 09613", sup).rule, "nosupportdata");
});

test("примечание не про монтаж — null; про монтаж, но формулировки нет — unparsed", () => {
  assert.equal(M.mountFromNote("Новинка 07.2026", sup), null);
  assert.equal(M.mountFromNote("Запрашивать остатки", sup), null);
  assert.equal(M.mountFromNote("3 модуля по диагонали", sup).rule, "unparsed");
});

test("факт на каталоге: 22682.RN.1.01 получила принцип из примечания", () => {
  const w = {}; new Function("window", fs.readFileSync(path.join(ROOT, "js", "catalog-vimar-attrs.js"), "utf8"))(w);
  const s = Object.values(w)[0].standards["22682.RN.1.01"];
  assert.deepEqual([s.principle, s.boxModularity], ["1M_CENTRAL", 2]);
});
