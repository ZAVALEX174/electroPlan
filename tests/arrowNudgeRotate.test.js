/* Б3, ч.2а: стрелки двигают выделенный объект в ЭКРАННЫХ направлениях при любом угле мира. При
   повёрнутом холсте «вправо на экране» — это уже не +X в мире: экранное направление переводится в
   мировую дельту обратной матрицей R(−worldAngle) (как screenToWorld). Исполняем НАСТОЯЩИЙ
   глобальный document.onkeydown из app.js (общий стенд §7.1) и смотрим, с какой мировой дельтой он
   зовёт moveSelectedBy.

   МУТАЦИЯ M4: убрать обратный поворот
     const wx=nudge[0]*c+nudge[1]*s,wy=-nudge[0]*s+nudge[1]*c;  →  const wx=nudge[0],wy=nudge[1];
   Тогда при угле 90 ArrowRight ушёл бы в мировое +X вместо −Y, и объект на экране поехал бы не туда —
   проверка мировой дельты покраснеет. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");
const EPHistory = require("../js/history.js");

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

/* Текст присваивания document.onkeydown=e=>{…} (стрелка, не function-декларация): от маркера до
   парной `}`, пропуская строковые литералы (как constBlock в стенде). */
function onkeydownSource() {
  const src = stand.sourceOf("app.js");
  const start = src.indexOf("document.onkeydown=");
  assert.ok(start >= 0, "в js/app.js должно быть присваивание document.onkeydown");
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

/* Клавиатурное событие стрелки: не ввод (DIV), без модификаторов конструктора. */
function keyEvent(key) {
  return { key, code: "", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
    repeat: false, target: { tagName: "DIV", isContentEditable: false },
    _pd: 0, preventDefault() { this._pd++; }, stopPropagation() {} };
}

function buildKeydown(state) {
  const moves = [];
  /* $ отдаёт один и тот же узел на id — у всех модалок classList.contains → false (ничего не открыто),
     этого хватает всем веткам до нужной нам (стрелки). */
  const node = { classList: { contains: () => false }, value: "" };
  const ctx = {
    document: {}, state, EPHistory,
    $: () => node,
    undoPlan() {}, redoPlan() {},   /* Б4: keydown решает хоткей через EPHistory и зовёт эти функции */
    moveSelectedBy: (x, y) => { moves.push([x, y]); return true; },
    uploadPopover: { hidden: true },
    trapBuilderFocus() {}, closeFramePicker() {}, finishPdfPageSelection() {}, finishWallScope() {},
    setUploadPopover() {}, requestClosePostBuilder() {}, setTool() {}, removeEntity() {},
    openPostBuilder() {}, removeLastRoomLinePoint() {}, cyclePlanVisibility() {}, onSpaceKeydown() {}
  };
  const code = onkeydownSource() + "\n;document.onkeydown;";
  vm.createContext(ctx);
  return { onkeydown: vm.runInContext(code, ctx), moves };
}

function baseState(over) {
  return Object.assign(
    { selected: { kind: "post", id: "p1" }, tool: "select", gridStep: 10, worldAngle: 0, roomLinePoints: [] },
    over
  );
}

test("стрелка вправо без поворота двигает объект на +шаг по X (совместимость, угол 0)", () => {
  const { onkeydown, moves } = buildKeydown(baseState({ worldAngle: 0 }));
  onkeydown(keyEvent("ArrowRight"));
  assert.deepEqual(moves, [[10, 0]], "угол 0 — прежние (dx,dy) без изменений");
});

test("стрелка вправо при угле мира 90° двигает объект в мире на (0, −шаг) — экранное «вправо»", () => {
  const { onkeydown, moves } = buildKeydown(baseState({ worldAngle: 90 }));
  onkeydown(keyEvent("ArrowRight"));
  assert.equal(moves.length, 1, "moveSelectedBy вызван один раз");
  near(moves[0][0], 0);    // wx = 10*cos90 + 0*sin90 ≈ 0
  near(moves[0][1], -10);  // wy = -10*sin90 + 0*cos90 = -10
});

test("стрелка вверх при угле мира 270° двигает объект в мире на (+шаг, 0)", () => {
  const { onkeydown, moves } = buildKeydown(baseState({ worldAngle: 270 }));
  onkeydown(keyEvent("ArrowUp"));   // экранное направление (0,-10)
  assert.equal(moves.length, 1);
  // a=270°: c≈0, s=-1. nx=0, ny=-10 → wx=0*c+(-10)*(-1)=10, wy=-0*(-1)+(-10)*c=0
  near(moves[0][0], 10);
  near(moves[0][1], 0);
});
