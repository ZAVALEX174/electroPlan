/* К2 — СНЯТЫЕ С ПРОИЗВОДСТВА позиции в собранном каталоге (решение владельца: артикулы прежнего
   каталога, убранные номенклатурой К2, остаются доступны рантайму с active=false, прежним id и
   ценой — модель блока В23). Снятые лежат отдельным файлом js/catalog-vimar-discontinued.js, а
   js/data.js домешивает их к EP_DATA.products — проверяем именно РАНТАЙМ-список (как видит приложение).
   Источник истины о «прежних данных» — зафиксированный снимок tools/data/discontinued-732ae3a.json.

   Мутация (состязательный проход): в js/data.js убрать concat снятых (вернуть просто enriched) —
   снятые исчезнут из EP_DATA.products, и тесты «присутствует с active=false / id / цена» покраснеют.
   То же, если собрать пустой js/catalog-vimar-discontinued.js (build-discontinued с нулём снятых).
   Запуск: node --test tests/discontinuedCatalog.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadRuntime() {
  const jsDir = path.join(__dirname, "..", "js");
  const win = {};
  const context = vm.createContext({ window: win, structuredClone });
  // Тот же порядок, что в index.html: снятые — ДО data.js, иначе data.js их не домешает.
  for (const file of ["catalog-vimar.js", "catalog-vimar-attrs.js", "catalog-vimar-discontinued.js", "data.js"]) {
    vm.runInContext(fs.readFileSync(path.join(jsDir, file), "utf8"), context, { filename: file });
  }
  return { products: win.EP_DATA.products, catalog: win.EP_VIMAR_CATALOG, disc: win.EP_VIMAR_DISCONTINUED };
}
const { products: PRODUCTS, catalog: CATALOG, disc: DISC } = loadRuntime();
const byCode = (code) => PRODUCTS.find((p) => String(p.code) === code);

const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "tools", "data", "discontinued-732ae3a.json"), "utf8"));
const activeCodes = new Set(CATALOG.products.filter((p) => p.active).map((p) => p.code));
// «Снятый» = код снимка 732ae3a, которого нет среди активных позиций текущей номенклатуры.
const expectedDiscontinued = snapshot.products.filter((p) => !activeCodes.has(p.code));

test("снятые из снимка доступны рантайму с active=false, прежним id и ценой", () => {
  assert.ok(expectedDiscontinued.length > 0, "снимок содержит артикулы, убранные номенклатурой");
  let checked = 0;
  for (const prev of expectedDiscontinued) {
    const p = byCode(prev.code);
    assert.ok(p, `снятый артикул ${prev.code} доступен в каталоге рантайма`);
    assert.equal(p.active, false, `${prev.code}: active=false`);
    assert.equal(p.id, prev.id, `${prev.code}: прежний id ${prev.id}`);
    assert.equal(p.price, prev.price, `${prev.code}: прежняя цена ${prev.price} €`);
    assert.equal(p.kind, prev.kind, `${prev.code}: прежний kind ${prev.kind}`);
    checked++;
  }
  assert.equal(checked, expectedDiscontinued.length);
});

test("число: активные неизменны (= отгружаемый каталог), всего = активные + снятые", () => {
  const active = PRODUCTS.filter((p) => p.active).length;
  const inactive = PRODUCTS.filter((p) => !p.active).length;
  // Отгружаемый каталог (EP_VIMAR_CATALOG) не раздут снятыми — их число там нулевое.
  assert.equal(CATALOG.products.length, active, "catalog-vimar.js несёт только активные");
  assert.equal(inactive, expectedDiscontinued.length, "снятых ровно столько, сколько в снимке отсутствует среди активных");
  assert.equal(active + inactive, PRODUCTS.length, "рантайм-список = активные + снятые");
  assert.equal(DISC.products.length, inactive, "отдельный файл снятых согласован");
});

test("контрольные снятые артикулы (код, id, цена, kind)", () => {
  const cases = [
    { code: "19101", id: 200731, price: 13.73, kind: "mechanism" },
    { code: "19653.66", id: 201025, price: 12.29, kind: "frame" },
    { code: "21612", id: 201583, price: 10.17, kind: "support" },
    { code: "00936.120.A", id: 200020, price: 9.6, kind: "accessory" },
  ];
  for (const c of cases) {
    const p = byCode(c.code);
    assert.ok(p, `${c.code} в каталоге рантайма`);
    assert.equal(p.active, false);
    assert.equal(p.id, c.id, `${c.code} id`);
    assert.equal(p.price, c.price, `${c.code} цена`);
    assert.equal(p.kind, c.kind, `${c.code} kind`);
  }
});

test("признаки снятой накладки сохранены inline (19653.66 несёт прежнюю отделку)", () => {
  const p = byCode("19653.66");
  const prev = snapshot.products.find((x) => x.code === "19653.66");
  assert.ok(prev, "в снимке есть 19653.66");
  // frameColor/standard вмешаны в снимок из attrs прежнего рантайма. Снятая накладка обязана их
  // нести, иначе сохранённый пост перестанет считать её «подходящей» своему цвету/серии.
  assert.equal(p.frameColor, prev.frameColor, "прежний цвет отделки на месте");
  assert.equal(p.standard, prev.standard, "прежний монтажный стандарт на месте");
  assert.equal(p.frameColor, "Reflexт Лед");
});
