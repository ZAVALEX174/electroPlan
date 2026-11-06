/* Лицо снятого механизма 19345.M («Розетка информационная USB, Metal»). Утверждённый владельцем
   результат 07.11: в собранном посте модуль 19345.M виден ЦЕЛИКОМ, как на его фото (сверху окошко
   маркировки, ниже значок и разъём USB), а не обрезанная полоска из середины. Прежняя разметка
   faceRect была снята со СТАРОГО фото (vimar.ru, модуль в середине кадра) и на нынешнем локальном
   фото (модуль во всю ширину кадра) вырезала середину — width 42.2%. Детектор лиц (tools/lib/faces.mjs)
   по локальному фото даёт лицо во всю ширину модуля. Проверяем СОБРАННЫЙ файл (как его видит рантайм).

   Мутация (состязательный проход): вернуть в js/catalog-vimar-discontinued.js прежний faceRect
   19345.M (width 42.2) — тест покраснеет. Пересобрать: npm run build:discontinued.
   Запуск: node --test tests/discontinuedFace.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = vm.createContext({ window: {} });
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "..", "js", "catalog-vimar-discontinued.js"), "utf8"),
  context,
  { filename: "catalog-vimar-discontinued.js" }
);
const PRODUCTS = context.window.EP_VIMAR_DISCONTINUED.products;
const p19345m = PRODUCTS.find((x) => String(x.code) === "19345.M");

test("19345.M: лицо покрывает почти всю ширину модуля (а не середину кадра)", () => {
  assert.ok(p19345m, "19345.M присутствует среди снятых");
  assert.ok(p19345m.faceRect, "у 19345.M есть faceRect");
  assert.ok(
    p19345m.faceRect.width >= 75,
    `faceRect.width=${p19345m.faceRect.width}% должен быть ≥ 75% (модуль занимает почти всю ширину фото), а не полоска из середины`
  );
});
