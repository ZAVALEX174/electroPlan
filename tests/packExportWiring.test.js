/* Проводка выгрузки Excel (К6): оркестратор exportSpecExcel (js/docs.js) обязан передать в
   EPSpecExcel.build ДВЕ вещи листа «По артикулам»:
     · packByCode — карту артикул→упаковка, собранную ИЗ КАТАЛОГА (EP_DATA.products[].packQty);
     · packMultiple — состояние галки проекта (EP_DATA.settings.packMultiple), НЕ константу.

   Исполняем НАСТОЯЩИЙ текст exportSpecExcel из docs.js через общий стенд (appStand), подменив
   EPSpecExcel.build перехватчиком deps. Ловит мутации:
     · docs.js `packMultiple:true` (всегда округлять) → краснеет «снятая галка → packMultiple=false»;
     · docs.js `packByCode:{}` (пустая карта) → краснеет «packByCode собран из packQty товаров»;
   (мутацию «data.js без подмешивания packQty» ловит tests/packCatalogData.test.js — здесь packQty
    задаём фикстурой, проверяя именно сбор карты в docs.js, а не источник packQty).
   Запуск: node --test tests/packExportWiring.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

/* Контекст exportSpecExcel: смета непустая, свод не важен, EPSpecExcel.build — перехватчик deps.
   products несут packQty (у одного — нет, чтобы проверить, что он в карту НЕ попал). */
function runExport(packMultiple) {
  let captured = null;
  const ctx = {
    projectLighting: () => ({}),
    buildEstimate: () => ({ groups: [{ items: [{ code: "A1", price: 1, count: 1 }] }] }),
    supplierSpecData: () => ({}),
    EPSupplierSpec: { collect: () => ({ rows: [{ code: "A1", name: "A", count: 1 }] }) },
    EPEstimate: { isEmptyProject: () => false },
    EPOfferOptions: { normalize: o => o || {} },
    EP_DATA: {
      settings: { offerOptions: {}, packMultiple },
      products: [
        { code: "A1", packQty: 10 },
        { code: "B1", packQty: 50 },
        { code: "C1" }            // без упаковки — в карту не попадёт
      ]
    },
    displayCurrency: () => "EUR",
    displayRate: () => 1,
    docHeader: () => ({ number: "1", project: "П" }),
    EPSpecExcel: {
      build: (est, supplier, deps) => { captured = deps; return new Uint8Array(0); },
      fileName: () => "spec.xlsx"
    },
    toast: () => {},
    /* «грязный» хвост скачивания — безобидные шимы: функцию интересует только вызов build */
    URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} },
    Blob: function () {},
    document: { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } },
    setTimeout: () => {}
  };
  stand.run("exportSpecExcel", ctx)();
  return captured;
}

test("docs.js: packByCode собран из packQty товаров каталога (не пустой)", () => {
  const deps = runExport(false);
  assert.ok(deps, "EPSpecExcel.build был вызван");
  assert.equal(deps.packByCode.A1, 10, "A1 → 10 из packQty товара");
  assert.equal(deps.packByCode.B1, 50, "B1 → 50");
  assert.ok(!("C1" in deps.packByCode), "товар без packQty в карту не попал (мутация packByCode:{} убьёт весь объект)");
  assert.equal(Object.keys(deps.packByCode).length, 2, "в карте ровно две упаковки");
});

test("docs.js: packMultiple берётся из настройки проекта, а не зашит константой", () => {
  assert.equal(runExport(false).packMultiple, false, "снятая галка → packMultiple=false (мутация `:true` краснит здесь)");
  assert.equal(runExport(true).packMultiple, true, "включённая галка → packMultiple=true");
  assert.equal(runExport(undefined).packMultiple, false, "нет поля (старый проект) → false");
});
