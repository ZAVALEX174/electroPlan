/* Автонумерация КП (итоги встречи 24.08 §1.3: «Нумерация КП — EPG-2026-0001», А4 в
   docs/ОСТАТОК-РАБОТ.md, подтверждено владельцем).

   ДВА УРОВНЯ. Ниже — чистая функция формата/счётчика (EPOfferNumber): первый номер, инкремент,
   новый год с 0001, ручной выше счётчика продолжается после максимума. Связку (настоящий
   generateCommercialOffer из app.js: пустой → выдаётся и сохраняется, повторно тот же, ручной не
   трогается) держит offerNumberWiring.test.js на общем стенде.

   МУТАЦИОННАЯ ТАБЛИЦА (факт из изолированной копии — в отчёте проверяющему):
     (а) seq=(next[year]||0)+1 → next[year]||0 (не +1): «первый номер = EPG-2026-0001» ждёт 0001,
         получает 0000 → FAIL; «инкремент второго проекта» ждёт 0002, получает предыдущий → FAIL.
     (б) yearOf: датой пренебречь, всегда new Date().getFullYear() → «год берётся из даты КП» ждёт
         2026 на дате 2026-05, получает текущий → FAIL.
     (в) padStart(4,"0") → без padStart: «первый номер» ждёт EPG-2026-0001, получает EPG-2026-1 → FAIL.
     (г) поднятие пола снято (if parsed.seq>… не срабатывает): «ручной выше счётчика: следующий
         продолжает после максимума» ждёт 0051, получает 0004 → FAIL.
   Запуск: node --test tests/offerNumber.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const N = require("../js/offerNumber.js");

test("assign: первый номер проекта — EPG-2026-0001 (пустой счётчик, дата 2026)", () => {
  const r = N.assign({}, { current: "", date: "2026-05-01" });
  assert.equal(r.number, "EPG-2026-0001");
  assert.equal(r.assigned, true);
  assert.deepEqual(r.counters, { 2026: 1 });
});

test("assign: инкремент — следующий проект получает EPG-2026-0002", () => {
  const r = N.assign({ 2026: 1 }, { current: "", date: "2026-12-31" });
  assert.equal(r.number, "EPG-2026-0002");
  assert.deepEqual(r.counters, { 2026: 2 });
});

test("assign: новый год начинает нумерацию заново — EPG-2027-0001", () => {
  const r = N.assign({ 2026: 42 }, { current: "", date: "2027-01-01" });
  assert.equal(r.number, "EPG-2027-0001");
  assert.equal(r.counters[2026], 42, "прошлый год не тронут");
  assert.equal(r.counters[2027], 1);
});

test("assign: год берётся из даты КП, а не из системного времени", () => {
  const r = N.assign({}, { current: "", date: "2026-08-24", now: new Date("2099-01-01") });
  assert.equal(r.number, "EPG-2026-0001");
});

test("assign: без даты КП год — текущий (now-фоллбэк)", () => {
  const r = N.assign({}, { current: "", date: "", now: new Date("2030-03-03") });
  assert.equal(r.number, "EPG-2030-0001");
});

test("assign: ручной номер не трогается и счётчик им не двигается (чужой формат)", () => {
  const r = N.assign({ 2026: 3 }, { current: "СЧЁТ-7", date: "2026-01-01" });
  assert.equal(r.number, "СЧЁТ-7");
  assert.equal(r.assigned, false);
  assert.deepEqual(r.counters, { 2026: 3 }, "счётчик не сдвинут");
});

test("assign: ручной EPG выше счётчика поднимает пол — следующий автономер продолжает после него", () => {
  /* Вписан EPG-2026-0050 при счётчике 3: сам номер не трогаем (assigned=false), но пол года
     поднят до 50, чтобы следующая автовыдача дала 0051, а не наступила на вписанный. */
  const seen = N.assign({ 2026: 3 }, { current: "EPG-2026-0050", date: "2026-01-01" });
  assert.equal(seen.number, "EPG-2026-0050");
  assert.equal(seen.assigned, false);
  assert.equal(seen.counters[2026], 50);
  const next = N.assign(seen.counters, { current: "", date: "2026-06-01" });
  assert.equal(next.number, "EPG-2026-0051");
});

test("assign: входной объект счётчиков не мутируется (чистая функция)", () => {
  const src = { 2026: 5 };
  N.assign(src, { current: "", date: "2026-01-01" });
  assert.deepEqual(src, { 2026: 5 }, "исходные счётчики нетронуты");
});

test("format: 4 цифры с ведущими нулями; parse — обратная операция", () => {
  assert.equal(N.format(2026, 7), "EPG-2026-0007");
  assert.equal(N.format(2026, 1234), "EPG-2026-1234");
  assert.deepEqual(N.parse("EPG-2026-0050"), { year: 2026, seq: 50 });
  assert.equal(N.parse("СЧЁТ-7"), null);
  assert.equal(N.parse(""), null);
});
