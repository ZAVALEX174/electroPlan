/* К7а — НАПРАВЛЕНИЕ ОКРУГЛЕНИЯ В moneyShown/money (app.js).
   Форматтеры денег приложения — единственная точка, где рублёвое число округляется для ПОКАЗА, и по
   правилу К7 (решение владельца 20.10 п.5) — ВВЕРХ до целого рубля. Все остальные тесты денег
   подменяют moneyShown заглушкой, поэтому саму связку «moneyShown зовёт roundShown с направлением
   up» никто не держит: мутация roundShown(n,cur,"up")→"down" в app.js осталась бы незамеченной.
   Здесь исполняем НАСТОЯЩИЙ текст moneyShown/money из app.js (стенд helpers/appStand) на реальном
   EPEstimate и ловим направление на дробном рубле, где вверх≠вниз. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");
const EPEstimate = require("../js/estimate.js");

/* Вырезаем НАСТОЯЩИЕ moneyShown (многострочный const) и money (однострочный const) из app.js и
   исполняем в vm. moneyShown берёт из лексики app.js только displayCurrency(), EPEstimate.roundShown
   и Intl; money — ещё displayRate(). Всё это кладём в контекст — логику app.js не переписываем. */
function makeMoney(currency, rate) {
  const ctx = { displayCurrency: () => currency, displayRate: () => rate, EPEstimate, Intl };
  vm.createContext(ctx);
  const code = stand.constBlock("moneyShown") + "\n" + stand.constSource("money") + "\n;({ moneyShown, money });";
  return vm.runInContext(code, ctx);
}

test("К7а: moneyShown в рублях округляет ВВЕРХ до целого рубля (100,4 → 101 ₽, не 100)", () => {
  const { moneyShown } = makeMoney("RUB", 1);
  const s = moneyShown(100.4);
  assert.match(s, /101/, `рубль ВВЕРХ (мутация up→down дала бы 100): ${s}`);
  assert.ok(!/\b100\b/.test(s), `не округлено вниз до 100: ${s}`);
  /* Копеек в рублях нет вовсе (формат без «,00»). */
  assert.ok(!/[.,]\d/.test(s), `рубли печатаются без копеек: ${s}`);
});

test("К7а: money() умножает на курс и округляет ВВЕРХ (50,2 € @2 → 101 ₽)", () => {
  /* money(n) = moneyShown(n × displayRate()): 50,2 × 2 = 100,4 → вверх 101. Ловит и потерю курса,
     и смену направления. */
  const { money } = makeMoney("RUB", 2);
  const s = money(50.2);
  assert.match(s, /101/, `money в рублях ВВЕРХ по курсу: ${s}`);
  assert.ok(!/\b100\b/.test(s), `не вниз и не без курса: ${s}`);
});

test("К7а: евро не задето направлением — round2 до копейки (6,01 € @92,5 = 555,93)", () => {
  const { money } = makeMoney("EUR", 92.5);
  const s = money(6.01);
  assert.match(s, /555,93/, `евро: round2 (две копейки), направление роли не играет: ${s}`);
});
