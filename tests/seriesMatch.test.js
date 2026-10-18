"use strict";
/* Единое правило совместимости коллекций (js/seriesMatch.js, шаг 3 К2).
   Чистая функция — грузим напрямую require, фикстур не нужно. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const SM = require("../js/seriesMatch.js");

test("пустая коллекция у любой стороны = подходит всем", () => {
  assert.equal(SM.seriesCompatible([], ["Eikon Exe"]), true);
  assert.equal(SM.seriesCompatible(["Eikon Exe"], []), true);
  assert.equal(SM.seriesCompatible([], []), true);
  assert.equal(SM.seriesCompatible(null, ["Plana"]), true);
  assert.equal(SM.seriesCompatible("", "Arke"), true);
});

test("«Eikon» без подсерии ↔ любая «Eikon …» (по префиксу)", () => {
  assert.equal(SM.seriesCompatible(["Eikon"], ["Eikon Exe"]), true);
  assert.equal(SM.seriesCompatible(["Eikon Evo"], ["Eikon"]), true);
  assert.equal(SM.seriesCompatible(["Eikon"], ["Eikon Flat"]), true);
  assert.equal(SM.seriesCompatible(["Eikon"], ["Eikon Tondo"]), true);
  assert.equal(SM.seriesCompatible(["Eikon"], ["Eikon Vintage"]), true);
  assert.equal(SM.seriesCompatible(["EIKON"], ["eikon tactil"]), true);  // регистр не важен
  // новая, ещё не встречавшаяся подсерия — тоже подходит (по префиксу, без списка)
  assert.equal(SM.seriesCompatible(["Eikon"], ["Eikon Сверхновая"]), true);
});

test("подсерия ↔ другая подсерия — НЕ совпадают (только точное)", () => {
  assert.equal(SM.seriesCompatible(["Eikon Evo"], ["Eikon Exe"]), false);
  assert.equal(SM.seriesCompatible(["Eikon Flat"], ["Eikon Vintage"]), false);
  assert.equal(SM.seriesCompatible(["Eikon Exe"], ["Eikon Exe"]), true);   // та же подсерия
});

test("чужие семьи не смешиваются; «Arke» НЕ раскрывается в «Arke Fit»", () => {
  assert.equal(SM.seriesCompatible(["Plana"], ["Eikon Exe"]), false);
  assert.equal(SM.seriesCompatible(["Arke"], ["Plana"]), false);
  // префикс-правило — только для Eikon: «Arke» не должна подходить к «Arke Fit» (другой монтаж)
  assert.equal(SM.seriesCompatible(["Arke"], ["Arke Fit"]), false);
});

test("мультиколлекционный товар совместим, если пересекается хотя бы одна коллекция", () => {
  assert.equal(SM.seriesCompatible(["Arke", "Plana"], ["Plana"]), true);
  assert.equal(SM.seriesCompatible(["Arke", "Eikon"], ["Eikon Exe"]), true);   // через Eikon-базу
  assert.equal(SM.seriesCompatible(["Arke", "Plana"], ["Neve Up"]), false);
});
