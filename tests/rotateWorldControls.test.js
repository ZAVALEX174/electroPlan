/* Б3, ч.2а: в режиме «весь план» органы поворота (поле «Угол», кнопки ↺/↻) должны вести угол МИРА
   через setWorldAngle, а не угол ПОДЛОЖКИ (planRotation). Исполняем НАСТОЯЩИЕ applyRotationInput() и
   rotatePlanBy() из app.js (общий стенд §7.1), подменяя setWorldAngle шпионом: проверяем, что в режиме
   «world» зовётся именно он и с правильным аргументом.

   МУТАЦИЯ M8: applyRotationInput без ветки «весь план»
     if(state.rotateTarget==="world"){setWorldAngle(a);return}  →  (удалено)
   МУТАЦИЯ M9: rotatePlanBy без ветки «весь план»
     if(state.rotateTarget==="world"){setWorldAngle(EPPlanRotate.step(state.worldAngle,delta));return}  →  (удалено)
   Тогда в режиме «world» setWorldAngle не вызовется (угол мира не изменится, а тронется подложка) —
   проверка вызова покраснеет. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const EPPlanRotate = require("../js/planRotate.js");

/* --- M8: поле «Угол» в режиме «весь план» --------------------------------------------------------- */
function buildApplyInput(state, fieldValue) {
  const calls = [];
  const node = { value: fieldValue };
  const fn = stand.run("applyRotationInput", {
    state, EPPlanRotate, $: () => node,
    setWorldAngle: a => calls.push(a),
    toast() {}, syncRotationUi() {}, applyPlanRotation() {}, persistProject() {}
  });
  return { fn, calls };
}

test("поле «Угол» в режиме «весь план» ведёт угол МИРА через setWorldAngle (запятая → число)", () => {
  const { fn, calls } = buildApplyInput({ rotateTarget: "world", worldAngle: 0, planRotation: 0, planLoaded: false }, "37,5");
  fn();
  assert.deepEqual(calls, [37.5], "в режиме «весь план» поле зовёт setWorldAngle с распознанным углом");
});

test("поле «Угол» в режиме «только чертёж» setWorldAngle НЕ зовёт (идёт в подложку)", () => {
  const { fn, calls } = buildApplyInput({ rotateTarget: "image", worldAngle: 0, planRotation: 0, planLoaded: true }, "37,5");
  fn();
  assert.deepEqual(calls, [], "в режиме «только чертёж» угол мира не трогаем");
});

/* --- M9: кнопки ↺/↻ в режиме «весь план» ---------------------------------------------------------- */
function buildRotateBy(state) {
  const calls = [];
  const fn = stand.run("rotatePlanBy", {
    state, EPPlanRotate,
    setWorldAngle: a => calls.push(a),
    toast() {}, applyPlanRotation() {}, persistProject() {}
  });
  return { fn, calls };
}

test("↻ 90° в режиме «весь план» двигает угол МИРА через setWorldAngle(step)", () => {
  const { fn, calls } = buildRotateBy({ rotateTarget: "world", worldAngle: 90, planRotation: 0, planLoaded: false });
  fn(90);
  assert.deepEqual(calls, [180], "90° + шаг 90° = 180° через setWorldAngle");
});

test("↺ 90° в режиме «весь план» от 0° нормализуется к 270° через setWorldAngle", () => {
  const { fn, calls } = buildRotateBy({ rotateTarget: "world", worldAngle: 0, planRotation: 0, planLoaded: false });
  fn(-90);
  assert.deepEqual(calls, [270], "0° − 90° нормализуется к 270°");
});

test("↻ в режиме «только чертёж» setWorldAngle НЕ зовёт", () => {
  const { fn, calls } = buildRotateBy({ rotateTarget: "image", worldAngle: 0, planRotation: 0, planLoaded: true });
  fn(90);
  assert.deepEqual(calls, [], "в «только чертёж» угол мира не трогаем");
});
