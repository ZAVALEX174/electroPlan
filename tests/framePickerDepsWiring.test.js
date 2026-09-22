/* ПОВЕДЕНЧЕСКИЙ тест САМОЙ СВЯЗКИ мастера отделки с общим отбором каталога. framePicker.test.js
   проверяет ЧИСТЫЙ EPFramePicker на тестовых deps — но НЕ проверяет, что НАСТОЯЩИЙ объект
   зависимостей `framePickerDeps` в js/app.js действительно ведёт счёт через EPCatalog.productsForRoom
   (тот же отбор, что фильтрует конструктор), значения — через productCollections/productFacingValues,
   а фото — через productImage. Без этого теста «упрощение» строки
     match:(frames,criteria)=>EPCatalog.productsForRoom(frames,criteria)   →   match:(frames)=>frames
   молча даёт счётчики по всему каталогу: два вида (список и картинки) расходятся на одних данных.

   Поэтому исполняем ИСХОДНЫЙ ТЕКСТ const framePickerDeps из app.js (общий стенд, constBlock) в vm,
   подставив ту же лексику, что у него в app.js (EPCatalog и алиас productImage=EPCatalog.productImage),
   и проверяем поведение каждого поля deps — и порознь, и в сборе через EPFramePicker.stepOptions.

   МУТАЦИОННАЯ ТАБЛИЦА (в отчёте):
     match:(frames,criteria)=>frames  (отбор снят)                       → красит §match-* и §integration;
     valuesOf всегда productFacingValues (серия читается как скаляр)     → красит §valuesOf-серия;
     imageOf:item=>item.previewImageUrl (мимо productImage/заглушки)     → красит §imageOf-заглушка.
   Запуск: node --test tests/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");

const EPCatalog = require("../js/catalog.js");
const EPFramePicker = require("../js/framePicker.js");

/* НАСТОЯЩИЙ framePickerDeps из app.js: вырезаем ИСХОДНЫЙ ТЕКСТ и исполняем — копии не держим (§7.1).
   В lexике app.js match/valuesOf зовут EPCatalog напрямую, а imageOf — алиас productImage
   (деструктурирован из EPCatalog в app.js), поэтому productImage кладём в контекст отдельным именем. */
const DEPS = vm.runInNewContext(
  stand.constBlock("framePickerDeps") + "\n;framePickerDeps;",
  { EPCatalog, productImage: EPCatalog.productImage }
);

/* Синтетический каталог: у Металла две накладки, всего три; фото есть у одной, у одной — заглушка
   no_photo (которую productImage обязан отбросить), у одной — нет вовсе. Числа подобраны так, что
   «через отбор» и «без отбора» дают РАЗНЫЕ счётчики (2 против 3). */
const FRAMES = [
  { id: 1, kind: "frame", series: ["Arke"],  frameMaterial: "Металл",       frameShape: "Классическая", frameColor: "Белый",  previewImageUrl: "white.jpg" },
  { id: 2, kind: "frame", series: ["Arke"],  frameMaterial: "Металл",       frameShape: "Скруглённая",  frameColor: "Чёрный" },
  { id: 3, kind: "frame", series: ["Plana"], frameMaterial: "Технополимер", frameShape: "Классическая", frameColor: "Белый",  previewImageUrl: "vimar.ru/no_photo.png" }
];

test("§match-отбор: deps.match — это EPCatalog.productsForRoom (сужает пул), а не «вернуть всё»", () => {
  const got = DEPS.match(FRAMES, { frameMaterial: "Металл" });
  assert.deepEqual(got.map(f => f.id), [1, 2], "оставлены только накладки материала «Металл»");
  assert.equal(got.length, 2, "2 из 3 — отбор реально применён (мутация «вернуть frames» дала бы 3)");
  assert.deepEqual(got, EPCatalog.productsForRoom(FRAMES, { frameMaterial: "Металл" }),
    "результат совпадает с productsForRoom — тем же отбором, что у конструктора");
});

test("§valuesOf-серия: серию читаем productCollections (массив), а не как скаляр productFacingValues", () => {
  assert.deepEqual(DEPS.valuesOf(FRAMES, "collection"), ["Arke", "Plana"],
    "коллекции из productSeries — если бы valuesOf звал productFacingValues, item.collection нет → []");
  assert.deepEqual(DEPS.valuesOf(FRAMES, "frameMaterial"), ["Металл", "Технополимер"],
    "материал — productFacingValues по скалярному полю");
});

test("§valuesOf-стандарт: стандарт читаем productStandards (BOTH→оба), а не как скаляр productFacingValues", () => {
  /* Если бы ветка standard отсутствовала и valuesOf упал в productFacingValues, вернулись бы СЫРЫЕ
     коды ["BOTH","DE","IT"] — универсальный «BOTH» попал бы в выбор как отдельный вариант. Реальный
     deps обязан звать productStandards: BOTH раскрывается в IT+DE, а сам вариантом не приходит. */
  const STD = [{ standard: "IT" }, { standard: "DE" }, { standard: "BOTH" }];
  assert.deepEqual(DEPS.valuesOf(STD, "standard"), ["DE", "IT"],
    "варианты — только IT/DE через productStandards; сырой productFacingValues дал бы и BOTH");
});

test("§imageOf-заглушка: фото через productImage — заглушка no_photo отбрасывается", () => {
  assert.equal(DEPS.imageOf(FRAMES[0]), "white.jpg", "настоящее фото берётся");
  assert.equal(DEPS.imageOf(FRAMES[1]), "", "фото нет → пусто");
  assert.equal(DEPS.imageOf(FRAMES[2]), "",
    "no_photo — заглушка выгрузки: productImage её отбрасывает; сырой item.previewImageUrl вернул бы её");
});

test("§integration: stepOptions на РЕАЛЬНОМ framePickerDeps считает варианты ЧЕРЕЗ отбор", () => {
  /* В сборе: выбрана серия Arke → на шаге материала виден только «Металл» (2 накладки). Если бы
     match не сужал, показались бы оба материала и счётчик Металла был бы 3 — два вида разошлись бы. */
  const opts = EPFramePicker.stepOptions(FRAMES, { collection: "Arke" }, "frameMaterial", DEPS);
  assert.deepEqual(opts.map(o => o.value), ["Металл"], "у Arke только Металл; Технополимер (Plana) отсеян отбором");
  assert.equal(opts[0].count, 2, "счётчик = 2 (через productsForRoom), а не 3 (весь каталог)");
});
