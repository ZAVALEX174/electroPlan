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

/* ── matchLevel: точное совпадение серии главнее семейного (решение владельца 18.10) ── */
test("matchLevel: exact при точном совпадении серии (в т.ч. подсерия↔та же подсерия)", () => {
  assert.equal(SM.matchLevel(["Eikon"], ["Eikon"]), "exact");
  assert.equal(SM.matchLevel(["Eikon Flat"], ["Eikon Flat"]), "exact");
  assert.equal(SM.matchLevel(["EIKON EXE"], ["eikon exe"]), "exact");   // регистр не важен
  assert.equal(SM.matchLevel(["Plana"], ["Plana"]), "exact");
});

test("matchLevel: family при совпадении ТОЛЬКО через базу семейства, точного нет", () => {
  assert.equal(SM.matchLevel(["Eikon"], ["Eikon Flat"]), "family");
  assert.equal(SM.matchLevel(["Eikon Tondo"], ["Eikon"]), "family");
  assert.equal(SM.matchLevel(["Eikon"], ["Eikon Сверхновая"]), "family");
});

test("matchLevel: none у несовместимых серий", () => {
  assert.equal(SM.matchLevel(["Eikon Evo"], ["Eikon Exe"]), "none");
  assert.equal(SM.matchLevel(["Arke"], ["Plana"]), "none");
  assert.equal(SM.matchLevel(["Arke"], ["Arke Fit"]), "none");   // семья только у Eikon
});

test("matchLevel: exact выигрывает у family, даже если есть обе пары (денежный край 20005.0 vs 22104)", () => {
  // запрос «Eikon» против кандидата с сериями «Eikon» (точно) и «Eikon Flat» (семейно) — общий уровень exact
  assert.equal(SM.matchLevel(["Eikon"], ["Eikon", "Eikon Flat"]), "exact");
  // мультиколлекция, где есть точное пересечение И семейное — тоже exact
  assert.equal(SM.matchLevel(["Eikon", "Arke"], ["Arke"]), "exact");
});

test("matchLevel: пустая сторона совместима, но НЕ точно (family) — точный кандидат рядом главнее", () => {
  assert.equal(SM.matchLevel([], ["Eikon Exe"]), "family");
  assert.equal(SM.matchLevel(["Plana"], []), "family");
});
