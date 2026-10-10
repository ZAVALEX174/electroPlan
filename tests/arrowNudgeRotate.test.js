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
const EPPostCopy = require("../js/postCopy.js");
const EPSelection = require("../js/selection.js");

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

function buildKeydown(state, openModal) {
  const moves = [];
  const hist = { undo: 0, redo: 0 };
  /* $ отдаёт узел по id; classList.contains("open") истинно только для openModal (по умолчанию — ничего
     не открыто). Так проверяется и стрелочная ветка, и список модалок, при которых Ctrl+Z молчит. */
  const nodeFor = id => ({ classList: { contains: () => id === openModal }, value: "", contains: () => false });
  const ctx = {
    document: {}, state, EPHistory,
    /* Б9: onkeydown на КАЖДОЕ нажатие спрашивает EPPostCopy.copyHotkey (перехват Ctrl+C/V). Для стрелок
       он вернёт null, но ветка всё равно читает эти имена — кладём их в контекст. window.getSelection —
       проверка выделенного текста страницы; copyBufferFilled — ответ модуля «буфер не пуст?» (Б9/И2,
       onkeydown больше не читает _copyBuffer напрямую), здесь буфера нет → false. */
    EPPostCopy, EPSelection, copyBufferFilled: () => false, window: { getSelection: () => "" },
    $: id => nodeFor(id),
    undoPlan() { hist.undo++; }, redoPlan() { hist.redo++; },   /* Б4: keydown решает хоткей через EPHistory и зовёт эти функции */
    moveSelectedBy: (x, y) => { moves.push([x, y]); return true; },
    uploadPopover: { hidden: true },
    trapBuilderFocus() {}, closeFramePicker() {}, finishPdfPageSelection() {}, finishWallScope() {},
    setUploadPopover() {}, requestClosePostBuilder() {}, setTool() {}, removeEntity() {},
    openPostBuilder() {}, removeLastRoomLinePoint() {}, cyclePlanVisibility() {}, onSpaceKeydown() {},
    /* стрелочный сдвиг вынесен из onkeydown в отдельную функцию moveSelectedByKey (Б4 п.6) — режем её
       рядом; _historyAmend она переключает (удержание = один шаг), здесь это лишь приёмник флага. */
    _historyAmend: false
  };
  const code = stand.functionSource("moveSelectedByKey") + "\n" + onkeydownSource() + "\n;document.onkeydown;";
  vm.createContext(ctx);
  return { onkeydown: vm.runInContext(code, ctx), moves, hist };
}

const ctrlZ = () => ({ key: "z", code: "KeyZ", shiftKey: false, ctrlKey: true, metaKey: false, altKey: false,
  repeat: false, target: { tagName: "DIV", isContentEditable: false }, _pd: 0, preventDefault() { this._pd++; }, stopPropagation() {} });

test("U21: при открытом wallScopeModal Ctrl+Z НЕ отменяет (модалка в списке блокирующих хоткей)", () => {
  const blocked = buildKeydown(baseState({}), "wallScopeModal");
  blocked.onkeydown(ctrlZ());
  assert.equal(blocked.hist.undo, 0, "под вопросом охвата правки стены Ctrl+Z не трогает историю плана");
  const open = buildKeydown(baseState({}), null);   // ни одна модалка не открыта — хоткей работает
  open.onkeydown(ctrlZ());
  assert.equal(open.hist.undo, 1, "без модалок Ctrl+Z отменяет (контроль чувствительности теста)");
});

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
