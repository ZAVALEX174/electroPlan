/* Б3, ч.2а: ПОВЕДЕНЧЕСКОЕ покрытие applyView() — связка «CSS-трансформация #canvas ↔ EPViewport».
   Чистую математику экран↔мир держит viewport.test.js; здесь проверяем, что СТРОКА трансформации,
   которую applyView реально пишет в canvas.style.transform, задаёт ту же аффинную матрицу, что и
   EPViewport.worldToScreen. Если она разойдётся (например, знак угла в rotate() перевернётся), клики
   через clientToWorld считались бы по одной матрице, а картинка рисовалась бы по другой — и объект
   вставал бы не под курсор. Исполняем НАСТОЯЩИЙ applyView из app.js (общий стенд §7.1).

   МУТАЦИЯ M2: rotate(${a}deg) → rotate(${-a}deg). Тогда матрица из transform повернёт в другую сторону,
   чем worldToScreen при том же state.worldAngle, и сверка экранной точки покраснеет (углы 90 и 37). */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const EPViewport = require("../js/viewport.js");

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

/* Шим #canvas: style с присваиванием transform и честным setProperty (applyView пишет и --world-rot). */
function makeCanvas() {
  const style = { setProperty(k, v) { style[k] = v; } };
  return { style };
}

/* Исполнить настоящий applyView и вернуть записанную строку transform. */
function runApplyView(state) {
  const canvas = makeCanvas();
  stand.run("applyView", { state, canvas })();
  return canvas.style.transform;
}

/* Разобрать `translate(px,px) rotate(deg) scale(s)` в экранную точку мировой точки pt — СВОЕЙ
   матрицей (не worldToScreen), чтобы сверка была независимой. Порядок как в CSS с origin в углу:
   масштаб → поворот → сдвиг: screen = pan + R(a)·(scale·pt). */
function screenFromTransform(transform, pt) {
  const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*rotate\(([-\d.]+)deg\)\s*scale\(([-\d.]+)\)/.exec(transform);
  assert.ok(m, "transform разобран: " + transform);
  const panX = +m[1], panY = +m[2], a = +m[3] * Math.PI / 180, scale = +m[4];
  const c = Math.cos(a), s = Math.sin(a), sx = pt.x * scale, sy = pt.y * scale;
  return { x: panX + sx * c - sy * s, y: panY + sx * s + sy * c };
}

test("applyView: матрица transform совпадает с EPViewport.worldToScreen (угол 0/90/37/270)", () => {
  for (const angle of [0, 90, 37, 270]) {
    const state = { panX: 130, panY: -70, scale: 1.4, worldAngle: angle };
    const transform = runApplyView(state);
    for (const P of [{ x: 0, y: 0 }, { x: 512, y: 300 }, { x: -220, y: 840 }]) {
      const viaTransform = screenFromTransform(transform, P);
      const viaViewport = EPViewport.worldToScreen(P, { panX: state.panX, panY: state.panY, scale: state.scale, angle });
      near(viaTransform.x, viaViewport.x);
      near(viaTransform.y, viaViewport.y);
    }
  }
});

test("applyView: угол поворота в rotate() равен state.worldAngle (а не его знаку/контр-углу)", () => {
  for (const angle of [90, 37]) {
    const transform = runApplyView({ panX: 0, panY: 0, scale: 1, worldAngle: angle });
    const m = /rotate\(([-\d.]+)deg\)/.exec(transform);
    assert.ok(m, "в transform есть rotate()");
    assert.equal(+m[1], angle, "rotate() крутит на +worldAngle; знак перевёрнут — экран разойдётся с картинкой");
  }
});
