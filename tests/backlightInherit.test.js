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

/* Монтажные поля новых накладок (principle + boxModularity): findBrothers/inheritFields. */
const fr = (code, principle, box) => ({ code, kind: "frame", principle, boxModularity: box });
const nw = (code) => ({ code, kind: "frame", principle: null, boxModularity: null });

test("inheritFields: брат того же артикула до последнего сегмента", () => {
  const pool = [fr("22672.1.01", "1M_CENTRAL", 2), fr("22672.1.03", "1M_CENTRAL", 2), fr("22672.2.01", null, null)];
  const r = M.inheritFields(nw("22672.1.87"), pool, ["principle", "boxModularity"]);
  assert.equal(r.rule, "base"); assert.deepEqual(r.values, { principle: "1M_CENTRAL", boxModularity: 2 });
});

test("inheritFields: братья без данных или расходящиеся — не угадываем", () => {
  assert.equal(M.inheritFields(nw("22672.2.87"), [fr("22672.2.01", null, null)], ["principle", "boxModularity"]).rule, "nodata");
  const d = M.inheritFields(nw("22682.RN.1.01"), [fr("22682.1.01", "1M_CENTRAL", 2), fr("22682.2.01", null, null)], ["principle", "boxModularity"]);
  assert.equal(d.rule, "diverge"); assert.equal(d.values, undefined);
});

test("inheritFields: корень и Plana Up ↔ Plana; чужую серию с U не сопоставляем", () => {
  assert.equal(M.inheritFields(nw("19641.12.01"), [fr("19641.01", "1M_CENTRAL", 2)], ["principle"]).rule, "root");
  const p = M.inheritFields(nw("14641U.01"), [fr("14641.01", "1M_CENTRAL", 2)], ["principle", "boxModularity"]);
  assert.equal(p.rule, "plana"); assert.equal(p.values.boxModularity, 2);
  assert.equal(M.inheritFields(nw("1464U.01"), [fr("1464.01", "X", 1)], ["principle"]), null);
});

test("факт на каталоге: суппорт-определяющие поля новых накладок", () => {
  const w = {}; new Function("window", fs.readFileSync(path.join(ROOT, "js", "catalog-vimar-attrs.js"), "utf8"))(w);
  const m = Object.values(w)[0].standards;
  assert.deepEqual([m["22672.1.87"].principle, m["22672.1.87"].boxModularity], ["1M_CENTRAL", 2]);
  assert.equal(m["14641U.01"].principle, "1M_CENTRAL");
  assert.equal(m["14652U.01"].principle, "2M_CENTRAL");
  assert.equal(m["19641.B26"].boxModularity, 2);
  assert.equal(m["22683.2.87"].principle, "2M_CENTRAL");
});
