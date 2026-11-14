/* Б8-г: защитные признаки пары на реальных LINEA, испорченных по одному полю.
   В живом прайсе коллизий нет; эти копии проверяют, что будущий прайс их не спарит. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const orientation = require("../js/frameOrientation.js");
const frames = stand.loadVimarCatalog().products.filter(p => p.kind === "frame");
const frame = code => {
  const item = frames.find(p => p.code === code);
  assert.ok(item, `каталог содержит ${code}`);
  return item;
};
const copy = (item, fields) => ({ ...item, ...fields });

test("Б8-г pairOf: ложный кандидат с другим суффиксом отвергнут", () => {
  const h = frame("30643.01"), v = frame("30645.01"), decoy = copy(v, { code: "30645.00" });
  assert.equal(orientation.pairOf(h, [h, v, decoy]), v);
});
test("Б8-г pairOf: ложный кандидат с другой модульностью отвергнут", () => {
  const h = frame("30643.01"), v = frame("30645.01"), decoy = copy(v, { slotCount: 6 });
  assert.equal(orientation.pairOf(h, [h, v, decoy]), v);
});
test("Б8-г pairOf: ложный кандидат с другой серией отвергнут", () => {
  const h = frame("30643.01"), v = frame("30645.01"), decoy = copy(v, { series: ["Arke"] });
  assert.equal(orientation.pairOf(h, [h, v, decoy]), v);
});
test("Б8-г pairOf: две одинаково подходящие вертикальные рамки — неоднозначность, пары нет", () => {
  const h = frame("30643.01"), v = frame("30645.01");
  assert.equal(orientation.pairOf(h, [h, v, copy(v, { id: -745 })]), null);
});

test("Б8-г sameFacingAtCount: чужая серия не заменяет вертикальную LINEA 4М", () => {
  const v4 = frame("30645.01"), v6 = frame("30646.01"), decoy = copy(v6, { series: ["Arke"] });
  assert.equal(orientation.sameFacingAtCount(v4, 6, [v4, v6, decoy]), v6);
});
test("Б8-г sameFacingAtCount: неверная ёмкость не заменяет вертикальную LINEA 4М", () => {
  const v4 = frame("30645.01"), v6 = frame("30646.01"), decoy = copy(v6, { slotCount: 5 });
  assert.equal(orientation.sameFacingAtCount(v4, 6, [v4, v6, decoy]), v6);
});
test("Б8-г sameFacingAtCount: две подходящие 6М рамки — не выбирать первую", () => {
  const v4 = frame("30645.01"), v6 = frame("30646.01");
  assert.equal(orientation.sameFacingAtCount(v4, 6, [v4, v6, copy(v6, { id: -746 })]), null);
});
