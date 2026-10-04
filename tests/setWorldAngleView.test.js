/* Б3, ч.2а: смена угла мира НЕ уводит содержимое за край окна. setWorldAngle меняет угол ВОКРУГ
   центра окна (EPViewport.rotateAt), подбирая pan так, чтобы мировая точка под центром окна осталась
   под центром окна — ровно как zoomAt держит точку при зуме. «Очистить холст» сбрасывает угол в 0 ТЕМ
   ЖЕ правилом (а не прямой записью worldAngle=0, которая оставляла pan под старым углом и уводила
   пустой лист за край окна — при 270° целиком ниже окна, клики переставали попадать).

   Исполняем НАСТОЯЩИЕ view()/viewportCenter()/setWorldAngle() и обработчик $("clearBtn").onclick из
   app.js (общий стенд §7.1). Инвариант проверяем численно: мировая точка под центром окна одна и та
   же ДО и ПОСЛЕ.

   МУТАЦИЯ M7: setWorldAngle без подбора pan
     state.worldAngle=na;state.panX=nv.panX;state.panY=nv.panY;  →  state.worldAngle=na;
   МУТАЦИЯ M6: «Очистить холст» без сброса угла
     …renderSummary();setWorldAngle(0)}  →  …renderSummary();state.worldAngle=0;applyView()}
   Обе ломают инвариант «точка под центром окна не сдвинулась» — соответствующий assert краснеет. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");
const EPViewport = require("../js/viewport.js");
const EPPlanRotate = require("../js/planRotate.js");

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

/* Окно холста фиксированного размера; его getBoundingClientRect НЕ вращается (в этом вся соль). */
const WIN = { width: 1100, height: 700 };
const makeCanvasScroll = () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: WIN.width, height: WIN.height }) });
const center = { x: WIN.width / 2, y: WIN.height / 2 };

/* мировая точка под центром окна при данном виде */
function worldAtCenter(state) {
  return EPViewport.screenToWorld(center, { panX: state.panX, panY: state.panY, scale: state.scale, angle: state.worldAngle || 0 });
}

/* --- M7: setWorldAngle держит точку под центром окна ------------------------------------------- */
function buildSetWorldAngle(state) {
  const canvasScroll = makeCanvasScroll();
  const fn = stand.run(["view", "viewportCenter", "setWorldAngle"], {
    state, canvasScroll, EPViewport, EPPlanRotate,
    applyView() {}, syncRotationUi() {}, renderGroupLinks() {}, renderScaleRuler() {}, persistProject() {}
  });
  return fn;
}

test("setWorldAngle(90) из 37° подбирает pan — мировая точка под центром окна не сдвинулась", () => {
  const state = { panX: 230, panY: -140, scale: 1.3, worldAngle: 37 };
  const before = worldAtCenter(state);
  buildSetWorldAngle(state)(90);
  assert.equal(state.worldAngle, 90, "угол стал 90");
  const after = worldAtCenter(state);
  near(after.x, before.x);
  near(after.y, before.y);
});

/* --- M6: «Очистить холст» сбрасывает угол в 0 тем же правилом (лист остаётся на экране) --------- */
function clearBtnSource() {
  const src = stand.sourceOf("app.js");
  const start = src.indexOf('$("clearBtn").onclick=');
  assert.ok(start >= 0, 'в js/app.js должно быть присваивание $("clearBtn").onclick');
  let depth = 0, quote = null, i = src.indexOf("{", start);
  for (; i < src.length; i++) {
    const ch = src[i];
    if (quote) { if (ch === quote && src[i - 1] !== "\\") quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) { i++; break; }
  }
  if (src[i] === ";") i++;
  return src.slice(start, i);
}

function buildClear(state) {
  const canvasScroll = makeCanvasScroll();
  const el = {};
  const ctx = {
    state, canvasScroll, EPViewport, EPPlanRotate,
    $: () => el,   // $("clearBtn") — куда вешается onclick
    finishRoomLineChain() {}, clearAnnotations() {},
    renderAll() {}, renderProperties() {}, renderSummary() {},
    applyView() {}, syncRotationUi() {}, renderGroupLinks() {}, renderScaleRuler() {}, persistProject() {}
  };
  const code = stand.functionSource("view") + "\n" + stand.functionSource("viewportCenter") + "\n"
    + stand.functionSource("setWorldAngle") + "\n" + clearBtnSource() + '\n;$("clearBtn").onclick;';
  vm.createContext(ctx);
  return vm.runInContext(code, ctx);
}

test("«Очистить холст» при угле 270° сбрасывает угол в 0 и держит точку под центром окна (лист на экране)", () => {
  const state = {
    panX: 180, panY: 540, scale: 1.1, worldAngle: 270,
    devices: [{}], posts: [{}], rooms: [{}], walls: [{}], autoWalls: [{}],
    wallPoints: [{}], roomLines: [{}], roomFieldMemory: [{}], selected: { kind: "post", id: "p" }
  };
  const before = worldAtCenter(state);
  buildClear(state)();
  assert.equal(state.worldAngle, 0, "после очистки угол мира 0");
  assert.equal(state.posts.length, 0, "очистка снесла нарисованное");   /* [] из vm-реалма — сверяем длиной, не deepEqual */
  const after = worldAtCenter(state);
  near(after.x, before.x);   // прямая запись worldAngle=0 без пересчёта pan сдвинула бы эту точку
  near(after.y, before.y);
});
