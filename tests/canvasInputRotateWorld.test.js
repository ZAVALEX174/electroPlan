/* Б3, ч.2а: ПОВЕДЕНЧЕСКОЕ покрытие «экран→мир с углом мира». Исполняем НАСТОЯЩИЕ view()+clientToWorld()
   из app.js и canvasEventPoint() из canvasInput.js (общий стенд §7.1), чтобы проверить не чистую
   математику (её держит viewport.test.js), а СВЯЗКУ: что инструментальный ввод реально идёт через
   единое правило и попадает туда, куда кликнули, при повёрнутом холсте.

   Инвариант «объект приклеен к миру»: берём мировую точку P, считаем её ЭКРАННУЮ позицию тем же
   EPViewport.worldToScreen (та же матрица, что в CSS-трансформации #canvas), кладём её в clientX/clientY
   со смещением на origin окна холста — и требуем, чтобы clientToWorld вернул ровно P. Угол 0/90/3.5. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const EPViewport = require("../js/viewport.js");

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

/* Стенд с настоящими view()+clientToWorld() из app.js. Окно холста (.canvas-scroll) смещено на экране
   на (left,top) — как реальный rect; его getBoundingClientRect НЕ вращается (в этом вся соль правила). */
function makeClientToWorld(state, origin) {
  const canvasScroll = { getBoundingClientRect: () => ({ left: origin.left, top: origin.top }) };
  return stand.run(["view", "clientToWorld"], { state, canvasScroll, EPViewport });
}

test("clientToWorld: клик по экранной позиции мировой точки возвращает её же (угол 0/90/3.5)", () => {
  const origin = { left: 64, top: 48 };
  for (const angle of [0, 90, 3.5, 270]) {
    const state = { panX: 130, panY: -70, scale: 1.4, worldAngle: angle };
    const clientToWorld = makeClientToWorld(state, origin);
    for (const P of [{ x: 0, y: 0 }, { x: 512, y: 300 }, { x: -220, y: 840 }]) {
      /* экранная позиция P относительно окна холста = та же матрица вида, что у CSS #canvas */
      const scr = EPViewport.worldToScreen(P, { panX: state.panX, panY: state.panY, scale: state.scale, angle });
      const back = clientToWorld(origin.left + scr.x, origin.top + scr.y);
      near(back.x, P.x);
      near(back.y, P.y);
    }
  }
});

test("canvasEventPoint (canvasInput.js) делегирует единому clientToWorld — координаты с углом мира", () => {
  const origin = { left: 64, top: 48 };
  const state = { panX: 130, panY: -70, scale: 1.4, worldAngle: 90 };
  const canvasScroll = { getBoundingClientRect: () => ({ left: origin.left, top: origin.top }) };
  /* настоящий clientToWorld как в app.js + настоящий canvasEventPoint как в canvasInput.js, в одном vm */
  const fns = stand.run(["view", "clientToWorld", "canvasEventPoint"],
    { state, canvasScroll, EPViewport });
  const P = { x: 333, y: -120 };
  const scr = EPViewport.worldToScreen(P, { panX: state.panX, panY: state.panY, scale: state.scale, angle: 90 });
  const got = fns({ clientX: origin.left + scr.x, clientY: origin.top + scr.y });
  near(got.x, P.x);
  near(got.y, P.y);
});
