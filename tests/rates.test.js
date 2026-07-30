/* Автотесты эффективного курса пересчёта (PLAN 7.1).
   Проверяем только чистую формулу EPRates.effectiveRate — сеть/кэш/LocalStorage
   не задействованы, браузер поднимать не нужно.
   Правило заказчика (ЦентрСвет): цена = курс ЦБ × (1 + надбавка/100),
   к ручному курсу надбавка не применяется. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { effectiveRate } = require("../js/rates.js");

/* сравнение денег: копейки, а не биты */
const near = (actual, expected, msg) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${msg}: получено ${actual}, ожидалось ${expected}`);

test("надбавка 0: эффективный курс равен курсу ЦБ", () => {
  near(effectiveRate({ eurRate: 92.5, rateSurchargePercent: 0, rateSource: "ЦБ РФ" }), 92.5, "pct=0");
});

test("надбавка 3: курс ЦБ × 1.03 (92.5 → 95.2750)", () => {
  near(effectiveRate({ eurRate: 92.5, rateSurchargePercent: 3, rateSource: "ЦБ РФ" }), 95.275, "pct=3");
});

test("ручной курс: надбавка не применяется", () => {
  near(effectiveRate({ eurRate: 100, rateSurchargePercent: 3, rateSource: "вручную" }), 100, "manual");
});

test("нет курса: возвращаем 0 — пересчитывать нечем", () => {
  assert.equal(effectiveRate({ eurRate: null, rateSurchargePercent: 3 }), 0, "eurRate=null");
  assert.equal(effectiveRate({}), 0, "пустые настройки");
  assert.equal(effectiveRate(), 0, "без аргумента");
});

test("надбавка не задана: как без надбавки", () => {
  near(effectiveRate({ eurRate: 92.5, rateSource: "ЦБ РФ" }), 92.5, "pct отсутствует");
});
