/* Кнопочные накладки Flat и двойная клавиша 22751 (К12 ч.4) — чистая логика js/buttonFrame.js.
   Предмет: распознавание кнопочной накладки ПО БАЗЕ артикула (не по названию/серии), число кнопок
   у 22751 и ширина в прорезях spanIn. Мутация правила «накладка» ловится прямо здесь (см. последний
   тест): уберёшь учёт накладки в spanIn — двойная клавиша перестанет занимать 2 прорези.
   Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const BF = require("../js/buttonFrame.js");

/* Накладки каталога (slotCount — число прорезей): 4/3/2/1-прорезные Flat и Tondo-двойник по имени. */
const F4 = { kind: "frame", code: "22684.4.11", name: "Накладка плоская, 4 модуля на 4 кнопки, Flat", slotCount: 4 };
const F3 = { kind: "frame", code: "22683.3.11", name: "Накладка плоская, 3 модуля на 3 кнопки, Flat", slotCount: 3 };
const F2 = { kind: "frame", code: "22683.2.11", name: "Накладка плоская, 3 модуля на 2 кнопки, Flat", slotCount: 2 };
const F1 = { kind: "frame", code: "22682.1.11", name: "Накладка плоская, 2 модуля на 1 кнопку, Flat", slotCount: 1 };
const TONDO = { kind: "frame", code: "22684.RN.4.11", name: "Накладка на 4 модуля с 4 круглыми отверстиями", slotCount: 4 };
const ORD = { kind: "frame", code: "22681.1.11", name: "Накладка на 1 модуль, Flat", slotCount: 1 };

/* Клавиши 22751 трёх подсемейств (символ / без символов / ON-OFF) — все двойные; обычный механизм. */
const KEY = { kind: "mechanism", code: "22751.11", name: "Две плоские клавиши, символ, Flat", moduleSpan: 1 };
const KEY0 = { kind: "mechanism", code: "22751.0.11", name: "Две плоские клавиши без символов, Flat", moduleSpan: 1 };
const KEY1 = { kind: "mechanism", code: "22751.1.11", name: "Две плоские клавиши ON/OFF, Flat", moduleSpan: 1 };
const KEYBARE = { kind: "mechanism", code: "22751.01", name: "Две плоские клавиши, Flat", moduleSpan: 1 };
const REG1 = { kind: "mechanism", code: "20001.11", name: "Выключатель 1 модуль", moduleSpan: 1 };
const REG2 = { kind: "mechanism", code: "20003.11", name: "Выключатель 2 модуля", moduleSpan: 2 };

test("isButtonFrame: по базе артикула, а не по названию — 6 баз Flat да, Tondo и обычная нет", () => {
  [F4, F3, F2, F1].forEach(f => assert.equal(BF.isButtonFrame(f), true, f.code));
  assert.equal(BF.isButtonFrame(TONDO), false, "22684.RN.4 — Tondo, не кнопочная (база 22684.4 её не ловит)");
  assert.equal(BF.isButtonFrame(ORD), false, "22681.1 — обычная накладка");
  assert.equal(BF.isButtonFrame(null), false);
  assert.equal(BF.isButtonFrame({ kind: "mechanism", code: "22684.4.11" }), false, "механизм с тем же кодом — не накладка");
});

test("buttonsOf: 22751.* всех подсемейств — две кнопки; остальное — одна", () => {
  [KEY, KEY0, KEY1, KEYBARE].forEach(k => assert.equal(BF.buttonsOf(k), 2, k.code));
  assert.equal(BF.buttonsOf(REG1), 1);
  assert.equal(BF.buttonsOf(REG2), 1);
  assert.equal(BF.buttonsOf(null), 1);
});

test("spanIn: двойная клавиша в кнопочной накладке с ≥2 прорезями занимает 2 прорези", () => {
  assert.equal(BF.spanIn(KEY, F4, 1), 2, "22684.4 (4 прорези)");
  assert.equal(BF.spanIn(KEY, F3, 1), 2, "22683.3 (3 прорези)");
  assert.equal(BF.spanIn(KEY, F2, 1), 2, "22683.2 (2 прорези)");
});

test("spanIn: накладка «на 1 кнопку» (1 прорезь) НЕ трогается — клавиша как раньше, 1 модуль", () => {
  assert.equal(BF.spanIn(KEY, F1, 1), 1, "22682.1 — вопрос заказчику, поведение прежнее");
});

test("spanIn: вне кнопочной накладки клавиша 22751 — обычная ширина (1 модуль)", () => {
  assert.equal(BF.spanIn(KEY, ORD, 1), 1, "22681.1 — обычная накладка");
  assert.equal(BF.spanIn(KEY, TONDO, 1), 1, "Tondo — не кнопочная");
  assert.equal(BF.spanIn(KEY, null, 1), 1, "накладки нет");
});

test("spanIn: обычные механизмы в кнопочной накладке сохраняют baseSpan (1М и 2М)", () => {
  assert.equal(BF.spanIn(REG1, F4, 1), 1, "1-модульный остаётся 1");
  assert.equal(BF.spanIn(REG2, F4, 2), 2, "2-модульный остаётся 2 (baseSpan, не buttonsOf)");
});

test("spanIn: пропавший артикул (baseSpan 0) проходит насквозь — оценку в 1 делают потребители", () => {
  assert.equal(BF.spanIn(null, F4, 0), 0, "у пропавшего товара base 0 — не перебиваем");
});

/* МУТАЦИЯ правила «накладка»: если spanIn перестанет учитывать накладку и вернёт baseSpan, двойная
   клавиша в 22684.4 даст 1 вместо 2 — и этот тест покраснеет. Держит сам смысл модуля. */
test("мутация: без учёта накладки двойная клавиша дала бы 1 — тест стоит на 2", () => {
  const withFrame = BF.spanIn(KEY, F4, 1);
  const asIfNoFrame = 1;   // что вернул бы «голый» baseSpan
  assert.notEqual(withFrame, asIfNoFrame, "правило накладки обязано менять ширину двойной клавиши");
  assert.equal(withFrame, 2);
});
