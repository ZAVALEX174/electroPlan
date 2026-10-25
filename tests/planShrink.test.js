/* Уменьшение большого растрового плана (js/planShrink.js) — чистое правило, проверяем в Node без
   браузера. Три требования владельца (25.10) и мутационные опоры к каждому:
     1) длинная сторона > 4000 → ровно 4000, пропорции сохранены;
     2) ≤ 4000 И влезает в предел → НЕ трогать (keep, байт-в-байт);
     3) ≤ 4000, но data-URL велик → пережать (redraw + ступени качества).
   У каждого assert отмечена мутация, которая его красит. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../js/planShrink.js");

const MAX = S.MAX_LONG_SIDE;
const LIMIT = S.PLAN_DATAURL_MAX_CHARS;

test("MAX_LONG_SIDE = 4000, предел и ступени качества заданы", () => {
  assert.equal(MAX, 4000, "длинная сторона уменьшается до 4000 (решение владельца)");
  assert.ok(LIMIT > 0, "предел data-URL задан числом");
  const steps = S.qualitySteps();
  /* МУТАЦИЯ «убери ступени качества»: верни [] из qualitySteps — этот блок покраснеет. */
  assert.ok(Array.isArray(steps) && steps.length >= 2, "ступеней качества минимум две");
  for (let i = 1; i < steps.length; i++) assert.ok(steps[i] < steps[i - 1], "ступени строго убывают");
  assert.ok(steps.every((q) => q > 0 && q < 1), "каждое качество в (0,1)");
});

test("targetDimensions: длинная сторона > 4000 → ровно 4000, пропорции сохранены", () => {
  /* Пейзаж 6000×4000 (фото плана с телефона) → 4000×2667. МУТАЦИЯ «убери уменьшение»
     (вернуть исходные w/h или scaled:false) красит и width, и scaled. */
  const land = S.targetDimensions(6000, 4000);
  assert.equal(land.width, 4000, "длинная сторона ровно 4000");
  assert.equal(land.scaled, true, "помечено как уменьшенное");
  assert.equal(land.height, Math.round(4000 * 4000 / 6000), "короткая — пропорционально (2667)");
  assert.ok(Math.abs(land.width / land.height - 6000 / 4000) < 0.001, "отношение сторон сохранено");

  // Портрет 3500×5000 → короткая пропорционально, длинная (высота) = 4000.
  const port = S.targetDimensions(3500, 5000);
  assert.equal(port.height, 4000, "в портрете длинная сторона — высота, она = 4000");
  assert.equal(port.width, Math.round(3500 * 4000 / 5000), "ширина пропорциональна (2800)");
  assert.equal(port.scaled, true);
});

test("targetDimensions: ровно 4000 и меньше НЕ уменьшаются (граница «≤», не «<»)", () => {
  /* МУТАЦИЯ «поменяй > на ≥» (в модуле условие longSide <= max; её инверсия — заменить на <):
     план ровно 4000 начал бы без нужды уменьшаться. Эти два assert это ловят. */
  const exact = S.targetDimensions(4000, 2500);
  assert.equal(exact.scaled, false, "ровно 4000 по длинной стороне — не трогаем");
  assert.equal(exact.width, 4000, "размеры исходные");
  assert.equal(exact.height, 2500);

  const small = S.targetDimensions(1200, 800);
  assert.equal(small.scaled, false, "меньше 4000 — не трогаем");
  assert.equal(small.width, 1200);
  assert.equal(small.height, 800);
});

test("targetDimensions: мусор на входе не ломает (0/NaN → scaled:false)", () => {
  assert.equal(S.targetDimensions(0, 0).scaled, false);
  assert.equal(S.targetDimensions(NaN, 100).scaled, false);
});

test("withinLimit: по длине строки относительно предела", () => {
  assert.equal(S.withinLimit(LIMIT), true, "ровно предел — влезает");
  assert.equal(S.withinLimit(LIMIT + 1), false, "на символ больше — не влезает");
  assert.equal(S.withinLimit(10, 100), true, "предел можно переопределить");
});

test("decide: keep когда ≤4000 И влезает — отдаём исходник байт-в-байт", () => {
  const d = S.decide(2000, 1500, 1000);
  assert.equal(d.action, "keep", "маленький и лёгкий — не трогаем");
  assert.equal(d.width, 2000);
  assert.equal(d.height, 1500);
});

test("decide: redraw когда длинная сторона > 4000 (даже если по весу влезало бы)", () => {
  /* МУТАЦИЯ «убери уменьшение»: если targetDimensions не ужмёт, decide вернёт keep — красит. */
  const d = S.decide(6000, 4000, 100);
  assert.equal(d.action, "redraw", "> 4000 всегда перерисовываем");
  assert.equal(d.width, 4000, "в целевой размер 4000");
  assert.equal(d.scaled, true);
});

test("decide: redraw когда ≤4000, но data-URL не влезает (пережать)", () => {
  /* МУТАЦИЯ «убери проверку предела в decide» (вернуть keep игнорируя длину): красит. */
  const d = S.decide(3000, 2000, LIMIT + 5000);
  assert.equal(d.action, "redraw", "тяжёлый растр перерисовываем даже без уменьшения размера");
  assert.equal(d.width, 3000, "размер не меняем — он в норме");
  assert.equal(d.height, 2000);
  assert.equal(d.scaled, false, "уменьшения по размеру нет, только пережатие");
});

test("decide: опции maxLong/limit переопределяются", () => {
  assert.equal(S.decide(500, 500, 10, { maxLong: 400 }).action, "redraw", "свой maxLong");
  assert.equal(S.decide(100, 100, 50, { limit: 10 }).action, "redraw", "свой предел");
  assert.equal(S.decide(100, 100, 5, { limit: 10 }).action, "keep");
});
