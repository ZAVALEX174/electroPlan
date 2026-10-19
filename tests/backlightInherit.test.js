/* Подсветка новых клавиш (tools/lib/backlightInherit.mjs, решение владельца 19.10):
   (а) брат по базовому артикулу, (б) подсвечиваемые Tondo как Flat 22751.11, расходящиеся братья
   не угадываются, старые артикулы не меняются. Плюс факт на собранном каталоге. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.join(__dirname, "..");
let M;
test.before(async () => { M = await import(pathToFileURL(path.join(ROOT, "tools", "lib", "backlightInherit.mjs")).href); });

const key = (code, extra) => Object.assign({ code, partRole: "key", name: "клавиша", series: ["Eikon Flat"],
  askBacklight: false, backlightPosition: null, backlightColor: null }, extra);
const old = (code, ask, pos) => ({ code, askBacklight: ask, backlightPosition: pos, backlightColor: null });

test("(а) новая клавиша берёт признаки брата по базовому артикулу", () => {
  const r = M.inheritBacklight(key("22751.89"), [old("22751.11", true, 2), old("22751.01", true, 2)]);
  assert.equal(r.rule, "brother"); assert.equal(r.askBacklight, true); assert.equal(r.backlightPosition, 2);
});

test("(а) брат без подсветки — подсветка не появляется; расходящиеся братья не угадываются", () => {
  assert.equal(M.inheritBacklight(key("22751.1.89"), [old("22751.1.11", false, null)]), null);
  const d = M.inheritBacklight(key("22751.89"), [old("22751.11", true, 2), old("22751.01", false, null)]);
  assert.equal(d.rule, "diverge");
  assert.equal(d.askBacklight, undefined);
});

test("(б) подсвечиваемая Tondo без брата — как эталон 22751.11; обычная Tondo — нет", () => {
  const ref = [old("22751.11", true, 2)];
  const t = key("22761.RN.01", { series: ["Eikon Tondo"], name: "2 клавиши круглые подсвечиваемые" });
  const r = M.inheritBacklight(t, ref);
  assert.equal(r.rule, "tondo"); assert.equal(r.backlightPosition, 2);
  assert.equal(M.inheritBacklight(key("22761.X", { series: ["Eikon Tondo"], name: "2 клавиши круглые" }), ref), null);
  assert.equal(M.inheritBacklight(key("12345.X", { name: "подсвечиваемые" }), ref), null);
});

test("не клавиша и клавиша со своими признаками не затрагиваются", () => {
  assert.equal(M.inheritBacklight(key("22751.89", { partRole: null }), [old("22751.11", true, 2)]), null);
  assert.equal(M.inheritBacklight(key("22751.89", { askBacklight: true, backlightPosition: 3 }), [old("22751.11", true, 2)]), null);
});

test("в собранном каталоге новые клавиши 22751.89 и 22761.RN.* принимают подсветку, позиция 2", () => {
  const w = {}; new Function("window", fs.readFileSync(path.join(ROOT, "js", "catalog-vimar.js"), "utf8"))(w);
  const L = Object.values(w.EP_VIMAR_CATALOG).find(Array.isArray);
  for (const code of ["22751.89", "22761.RN.01", "22761.RN.91"]) {
    const p = L.find((x) => x.code === code);
    assert.ok(p, code); assert.equal(p.askBacklight, true, code); assert.equal(p.backlightPosition, 2, code);
  }
});
