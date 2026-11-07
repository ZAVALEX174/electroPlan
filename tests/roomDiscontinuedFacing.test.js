/* Автотесты правила «значение отделки комнаты СНЯТО С ПРОИЗВОДСТВА» (EPRoom.discontinuedFacing, В27).
   Запуск: node --test tests/roomDiscontinuedFacing.test.js

   ЗАЧЕМ. roomFrameFacing/roomCollection валидируют признак отделки по ВЫПУСКАЕМЫМ накладкам: мёртвое
   значение → null («не задан»), и подбор от этого не меняется (решение владельца 07.11, вариант 1).
   Но «мёртвое» бывает двух родов: (а) значение снятой с производства накладки — человеку его надо
   показать В СВОЙСТВАХ КОМНАТЫ с пометкой «снят с производства», а не «Не задан»; (б) настоящий мусор
   (нет ни у выпускаемых, ни у снятых) — остаётся «Не задан». discontinuedFacing отличает (а) от (б):
   значение снято ⇔ его НЕТ среди выпускаемых, но ЕСТЬ среди снятых. Правило одно на все признаки.

   МУТАЦИОННАЯ ТАБЛИЦА (прогнана руками, числа — в отчёте):
     убрать проверку active (`activeValues.indexOf…` → всегда проверять только off)   → §active-wins;
     off-член считать мусором (`offValues.indexOf(value)!==-1` → `=== -1`)             → §off-member;
     мусор считать снятым (`return value` без проверки off)                            → §garbage;
     отбросить пустую/не-строку (`typeof value!=="string"||!value` → `!value`)         → §not-string. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../js/room.js");

/* Списки в форме, которую даёт каталог: активные написания и снятые. "Reflex лед" — реальный
   пример снятого цвета (замер по каталогу VIMAR: 32 цвета только у снятых накладок). */
const ACTIVE = ["Белый", "Чёрный матовый", "Никель матовый"];
const OFF = ["Reflex лед", "Вишня", "Хром"];

test("§off-member: значение из СНЯТЫХ (нет среди выпускаемых) → возвращается как снятое", () => {
  assert.equal(R.discontinuedFacing("Reflex лед", ACTIVE, OFF), "Reflex лед");
  assert.equal(R.discontinuedFacing("Вишня", ACTIVE, OFF), "Вишня");
});

test("§active-wins: выпускаемое значение → null (обычное, не снятое)", () => {
  assert.equal(R.discontinuedFacing("Белый", ACTIVE, OFF), null);
  assert.equal(R.discontinuedFacing("Никель матовый", ACTIVE, OFF), null);
});

test("§garbage: значение, которого нет ни у выпускаемых, ни у снятых (мусор) → null", () => {
  assert.equal(R.discontinuedFacing("Неведомый цвет", ACTIVE, OFF), null);
  // иной регистр снятого — тоже мусор: сравнение регистрозависимо (как roomCollection/roomFrameFacing)
  assert.equal(R.discontinuedFacing("reflex лед", ACTIVE, OFF), null);
  assert.equal(R.discontinuedFacing("Вишня ", ACTIVE, OFF), null);
});

test("§not-string: пусто / не-строка / null → null", () => {
  assert.equal(R.discontinuedFacing("", ACTIVE, OFF), null);
  assert.equal(R.discontinuedFacing(null, ACTIVE, OFF), null);
  assert.equal(R.discontinuedFacing(undefined, ACTIVE, OFF), null);
  assert.equal(R.discontinuedFacing(42, ACTIVE, OFF), null);
  assert.equal(R.discontinuedFacing({}, ACTIVE, OFF), null);
});

test("без списка снятых (каталог не загружен) → null: утверждать «снято» не можем", () => {
  assert.equal(R.discontinuedFacing("Reflex лед", ACTIVE), null);
  assert.equal(R.discontinuedFacing("Reflex лед", ACTIVE, undefined), null);
});

test("значение одновременно и в активных, и в снятых → null (живое значение главнее)", () => {
  // если написание встречается и у выпускаемой накладки — это обычное значение, не снятое
  assert.equal(R.discontinuedFacing("Белый", ["Белый"], ["Белый"]), null);
});

test("пустой список снятых → null (нечему быть снятым)", () => {
  assert.equal(R.discontinuedFacing("Reflex лед", ACTIVE, []), null);
});
