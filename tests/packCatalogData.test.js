/* Кол-во в упаковке (К6) на НАСТОЯЩИХ данных каталога. Два независимых стража:

   1. ПОДМЕШИВАНИЕ в рантайм (js/data.js): каждый товар, у которого в признаках (attrs.packs) есть
      упаковка, обязан нести packQty с тем же числом. Ловит мутацию «data.js без подмешивания packQty»
      (убрать .map(p→{packQty}) — упаковка не доедет до выгрузки, округление всегда пустое).
      Работает всегда: читает закоммиченные catalog-vimar.js + catalog-vimar-attrs.js.

   2. attrs.packs == столбец «Кол-во в упаковке» исходной номенклатуры, ВКЛЮЧАЯ текстовые клетки.
      Читает столбец D листа «VIMAR » НЕЗАВИСИМО от tools/lib/nomenclature2026.mjs (своим разбором:
      число ИЛИ строка-целое), поэтому ловит мутацию «снова только typeof number» в конвертере — 135
      позиций с текстовой упаковкой (Plana/Arke/Eikon/Linea/Neve Up) выпали бы из packs. Файл
      номенклатуры лежит ВНЕ репозитория; нет файла → тест пропускается с пояснением, а не падает.

   Запуск: node --test tests/packCatalogData.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const JS = path.join(__dirname, "..", "js");
function loadWindow(files) {
  const win = {};
  const ctx = { window: win };
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(JS, f), "utf8"), ctx);
  return win;
}

/* Разбор упаковки — ТА ЖЕ семантика, что в конвертере, но записанная здесь независимо: число, либо
   строка-целое > 0 после trim. Независимость и ловит мутацию конвертера «только typeof number». */
function parsePack(v) {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return { val: v, text: false };
  if (typeof v === "string" && /^\d+$/.test(v.trim()) && Number(v.trim()) > 0) return { val: Number(v.trim()), text: true };
  return null;
}

test("data.js подмешивает packQty каждому товару, у которого упаковка есть в attrs.packs", () => {
  const win = loadWindow(["catalog-vimar.js", "catalog-vimar-attrs.js", "catalog-vimar-openings.js",
    "catalog-vimar-faces.js", "catalog-vimar-discontinued.js", "data.js"]);
  const packs = win.EP_VIMAR_ATTRS.packs;
  const byCode = new Map(win.EP_DATA.products.map(p => [String(p.code), p]));
  const packCodes = Object.keys(packs);
  assert.ok(packCodes.length > 2000, `раздел packs непустой (${packCodes.length}) — иначе округлять нечем`);
  let checked = 0;
  for (const code of packCodes) {
    const p = byCode.get(code);
    if (!p) continue;   // позиция каталога без рантайм-товара (редко) — не предмет этого стража
    assert.equal(p.packQty, packs[code],
      `товар ${code}: packQty подмешан из attrs.packs (мутация «data.js без .map(packQty)» убьёт это)`);
    checked++;
  }
  assert.ok(checked > 2000, `проверено товаров с упаковкой: ${checked}`);
});

test("attrs.packs совпадает со столбцом «Кол-во в упаковке» номенклатуры, включая текстовые клетки", () => {
  const NOM = path.join(__dirname, "..", "..", "Номенклатура 2026-10-10.xls");
  if (!fs.existsSync(NOM)) {
    /* Файл исходной номенклатуры лежит вне репозитория (D:\LuxarGROUP\myProgects\electro\). На чужой
       машине его нет — пропускаем, а не роняем сборку. */
    console.log("  [skip] нет файла номенклатуры: " + NOM);
    return;
  }
  let XLSX;
  try { XLSX = require("xlsx"); } catch { console.log("  [skip] нет devDependency xlsx"); return; }

  const wb = XLSX.readFile(NOM);
  const ws = wb.Sheets["VIMAR "];
  assert.ok(ws, "лист «VIMAR » есть в книге");
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  /* Шапка на 3-й строке (индекс 2): A «Артикул», D «Кол-во в упаковке»; данные с индекса 3. */
  assert.equal(grid[2][0], "Артикул", "колонка A — Артикул");
  assert.equal(grid[2][3], "Кол-во в упаковке", "колонка D — Кол-во в упаковке");
  const raw = new Map();
  for (let i = 3; i < grid.length; i++) {
    const row = grid[i];
    if (!row) continue;
    const code = row[0] == null ? "" : String(row[0]).trim();
    if (!code) continue;
    const pk = parsePack(row[3]);
    if (pk) raw.set(code, pk);
  }

  const catCodes = new Set(win_products().map(c => String(c)));
  const packs = loadWindow(["catalog-vimar-attrs.js"]).EP_VIMAR_ATTRS.packs;

  let checked = 0, textChecked = 0;
  for (const code of catCodes) {
    const pk = raw.get(code);
    if (!pk) continue;   // каталожный код без упаковки в файле — не предмет проверки
    assert.ok(code in packs, `каталожный артикул ${code} с упаковкой в номенклатуре обязан быть в packs`);
    assert.equal(packs[code], pk.val, `упаковка ${code}: packs=${packs[code]} == файл=${pk.val}`);
    checked++;
    if (pk.text) textChecked++;
  }
  assert.ok(checked > 2000, `сверено каталожных артикулов с упаковкой: ${checked}`);
  /* Именно текстовые клетки ловят мутацию «только typeof number»: их должно быть заметное число и
     все — в packs. Без разбора текста textChecked упал бы в 0 и это утверждение покраснело бы. */
  assert.ok(textChecked > 100, `текстовых упаковок сверено (ловит «только typeof number»): ${textChecked}`);
});

/* Коды каталога — из catalog-vimar.js (членство в каталоге, а не «не-.FX»: часть артикулов с
   упаковкой исключена из каталога по иным причинам, их в packs быть и не должно). */
function win_products() {
  return (loadWindow(["catalog-vimar.js"]).EP_VIMAR_CATALOG.products || []).map(p => p.code);
}
