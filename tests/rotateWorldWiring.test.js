/* Б3, ч.2а: связки режима «весь план» в app.js, исполненные НАСТОЯЩИМИ (общий стенд §7.1):
   1) updatePlanUi — гейт органов поворота: в «весь план» живут и без подложки, в «только чертёж» —
      лишь с подложкой; переключатель режима активен всегда;
   2) renderScaleRuler — подпись масштаба получает КОНТР-поворот (transform=rotate(−угол …)) при
      повёрнутом плане, иначе встала бы боком.
   Оба даare мутационные опоры: сломай гейт/контр-поворот — соответствующий assert краснеет. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

/* --- 1. Гейт органов поворота (updatePlanUi) --------------------------------------------------- */
test("updatePlanUi: в режиме «весь план» ↺/↻/поле живут БЕЗ подложки", () => {
  const dom = stand.makeDom();
  const state = { planLoaded: false, rotateTarget: "world" };
  stand.run("updatePlanUi", { $: dom.$, state })();
  assert.equal(dom.els.planRotateLeftBtn.disabled, false, "↺ активна без плана в режиме «весь план»");
  assert.equal(dom.els.planRotateRightBtn.disabled, false, "↻ активна без плана в режиме «весь план»");
  assert.equal(dom.els.planRotateInput.disabled, false, "поле угла активно без плана в режиме «весь план»");
});

test("updatePlanUi: в режиме «только чертёж» без подложки органы поворота ЗАБЛОКИРОВАНЫ (как часть 1)", () => {
  const dom = stand.makeDom();
  const state = { planLoaded: false, rotateTarget: "image" };
  stand.run("updatePlanUi", { $: dom.$, state })();
  assert.equal(dom.els.planRotateLeftBtn.disabled, true, "↺ заблокирована без подложки в «только чертёж»");
  assert.equal(dom.els.planRotateInput.disabled, true, "поле заблокировано без подложки в «только чертёж»");
});

/* --- 2. Контр-поворот подписи масштаба (renderScaleRuler) -------------------------------------- */

/* минимальный SVG-узел: appendChild копит детей, innerHTML="" чистит, setAttribute складывает attrs */
function svgNode(tag) {
  const n = { tag, attrs: {}, children: [], _html: "", textContent: "",
    get innerHTML() { return n._html; }, set innerHTML(v) { n._html = v; if (v === "") n.children = []; },
    setAttribute(k, v) { n.attrs[k] = String(v); }, getAttribute(k) { return k in n.attrs ? n.attrs[k] : null; },
    appendChild(c) { n.children.push(c); return c; } };
  return n;
}
function buildRuler(state) {
  const svg = svgNode("svg");
  const document = { createElementNS: (_ns, t) => svgNode(t) };
  const fn = stand.run("renderScaleRuler", {
    $: id => (id === "scaleSvg" ? svg : null), document, SVG_NS: "svg-ns", state
  });
  return { fn, svg };
}

test("renderScaleRuler при угле мира 90° даёт подписи контр-поворот rotate(−90 …), чтобы она была прямой", () => {
  const state = { tool: "select", scalePoints: [], worldAngle: 90,
    scaleSegment: { a: { x: 100, y: 100 }, b: { x: 300, y: 100 }, meters: 2 } };
  const { fn, svg } = buildRuler(state);
  fn();
  const label = svg.children.find(c => c.tag === "text");
  assert.ok(label, "подпись масштаба отрисована");
  /* МУТАЦИЯ: убери строку контр-поворота — transform пропадёт, этот assert покраснеет */
  assert.match(label.getAttribute("transform") || "", /^rotate\(-90 /, "контр-поворот вокруг якоря подписи");
});

test("renderScaleRuler без поворота (угол 0) transform у подписи НЕ ставит (совместимость)", () => {
  const state = { tool: "select", scalePoints: [], worldAngle: 0,
    scaleSegment: { a: { x: 100, y: 100 }, b: { x: 300, y: 100 }, meters: 2 } };
  const { fn, svg } = buildRuler(state);
  fn();
  const label = svg.children.find(c => c.tag === "text");
  assert.equal(label.getAttribute("transform"), null, "без угла подпись масштаба без transform");
});
