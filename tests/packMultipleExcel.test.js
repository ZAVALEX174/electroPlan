/* Лист «По артикулам» выгрузки Excel с галкой «рассчитать кратно упаковке» (К6а, решение владельца
   22.10). Проверяем ЧИСЛАМИ на настоящем EPSpecExcel.build (как tests/specExcel.test.js):

     1. колонка «В упаковке» — ПОСЛЕДНИМ столбцом (H), прежние колонки (Артикул C, Кол-во D, Цена F,
        Сумма G) не сдвинуты; размер упаковки показан всегда, у артикула без данных — пустая клетка;
     2. с галкой количество каждого артикула округлено ВВЕРХ до целых упаковок, а «Сумма» = этого же
        (округлённого) количества × цена — «Кол-во × Цена = Сумма» держится после округления;
     3. без галки — фактическое количество и фактическая сумма (поведение до К6а неизменно);
     4. подвал «Общее количество» = сумме столбца «Кол-во» (с учётом округления по галке);
     5. нет данных об упаковке → без округления, ячейка пустая.

   Это ДЕНЬГИ (количество заказа × цена), поэтому к ключевым числам — мутация (таблица в отчёте).
   Запуск: node --test tests/packMultipleExcel.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const EPSpecExcel = require("../js/specExcel.js");

/* --- разбор ZIP метода STORE и одного листа (тот же формат писателя, что в specExcel.test.js) --- */
function unzipStore(bytes) {
  const buf = Buffer.from(bytes);
  const files = {};
  for (let i = 0; i + 4 <= buf.length;) {
    if (buf.readUInt32LE(i) !== 0x04034b50) break;
    const size = buf.readUInt32LE(i + 18);
    const nlen = buf.readUInt16LE(i + 26), elen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nlen).toString("utf8");
    const start = i + 30 + nlen + elen;
    files[name] = buf.slice(start, start + size);
    i = start + size;
  }
  return files;
}
function parseSheet(xml) {
  const cells = {};
  const re = /<c r="([A-Z]+\d+)"(?:\s+t="([^"]*)")?(?:\s+s="\d+")?>([\s\S]*?)<\/c>/g;
  let m;
  while ((m = re.exec(xml))) {
    const [, ref, t, inner] = m;
    if (t === "inlineStr") cells[ref] = { type: "s", text: (inner.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [, ""])[1] };
    else { const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1]; cells[ref] = { type: "n", num: v == null ? null : Number(v) }; }
  }
  return cells;
}
const rowNo = ref => Number(ref.match(/\d+$/)[0]);
const col = ref => ref.match(/^[A-Z]+/)[0];
const headerRow = cells => Object.entries(cells).filter(([r]) => rowNo(r) === 1)
  .sort((a, b) => col(a[0]) < col(b[0]) ? -1 : 1).map(([, c]) => c.text);
const supplierSheet = bytes => parseSheet(unzipStore(bytes)["xl/worksheets/sheet2.xml"].toString("utf8"));

/* Смета даёт цены артикулов (цена/сумма берутся из est.groups[].items[], В26): A=10 €, B=5 €, C=2 €. */
const est = () => ({ groups: [
  { name: "Пост", count: 1, sum: 170,
    items: [
      { kind: "mechanism", name: "Деталь A", code: "A1", count: 1, price: 10 },
      { kind: "mechanism", name: "Деталь B", code: "B1", count: 1, price: 5 },
      { kind: "mechanism", name: "Деталь C", code: "C1", count: 1, price: 2 }
    ] }
] });

/* Свод по артикулам: A нужно 7 (упаковка 10), B ровно 10 (упаковка 10), C — 3 без данных об упаковке. */
const supplier = () => ({
  rows: [
    { code: "A1", name: "Деталь A", count: 7, unit: "шт." },
    { code: "B1", name: "Деталь B", count: 10, unit: "шт." },
    { code: "C1", name: "Деталь C", count: 3, unit: "шт." }
  ],
  totalNames: 3, totalUnits: 20, missing: 0
});
const PACK = { A1: 10, B1: 10 };   // у C1 упаковки нет

const buildSheet = packMultiple => supplierSheet(EPSpecExcel.build(est(), supplier(),
  { options: {}, currency: "EUR", rate: 1, packByCode: PACK, packMultiple }));

/* Колонки с ценами и артикулами: A=№ B=Товар C=Артикул D=Кол-во E=Ед. F=Цена G=Сумма H=В упаковке. */
test("К6а: «В упаковке» — последний столбец, прежние колонки не сдвинуты", () => {
  const h = headerRow(buildSheet(false));
  assert.deepEqual(h, ["№", "Товар", "Артикул", "Кол-во", "Ед.", "Цена", "Сумма", "В упаковке"],
    "«В упаковке» добавлен в конец — Артикул C, Кол-во D, Цена F, Сумма G на прежних местах");
});

test("К6а: размер упаковки показан всегда, у артикула без данных клетка пустая", () => {
  const off = buildSheet(false);
  assert.equal(off["H2"].num, 10, "A1: упаковка 10 (строка 2)");
  assert.equal(off["H3"].num, 10, "B1: упаковка 10 (строка 3)");
  assert.equal(off["H4"].type, "s", "C1: упаковки нет → клетка строковая (пустая), а не 0");
  assert.equal(off["H4"].text, "", "C1: пустой текст, не число");
});

test("К6а: без галки — фактическое количество и сумма (поведение до К6а неизменно)", () => {
  const off = buildSheet(false);
  assert.equal(off["D2"].num, 7, "A1: 7 штук как есть");
  assert.equal(off["G2"].num, 70, "A1: сумма 7 × 10 € = 70");
  assert.equal(off["D4"].num, 3, "C1: 3 штуки (упаковки нет — не округляем)");
  assert.equal(off["G4"].num, 6, "C1: сумма 3 × 2 € = 6");
});

test("К6а: с галкой — количество вверх до целых упаковок, Сумма от округлённого количества", () => {
  const on = buildSheet(true);
  /* A1: нужно 7, упаковка 10 → 10; сумма 10 × 10 € = 100 (мутация «sum от сырого count» дала бы 70). */
  assert.equal(on["D2"].num, 10, "A1: 7 → 10 (целая упаковка)");
  assert.equal(on["G2"].num, 100, "A1: сумма от ОКРУГЛЁННОГО количества (10 × 10 € = 100)");
  /* B1: ровно упаковка — не добираем, сумма прежняя. */
  assert.equal(on["D3"].num, 10, "B1: 10 → 10");
  assert.equal(on["G3"].num, 50, "B1: сумма 10 × 5 € = 50");
  /* C1: упаковки нет — количество и сумма как есть даже при галке (нет данных → без округления). */
  assert.equal(on["D4"].num, 3, "C1: без упаковки не округляется и при галке");
  assert.equal(on["G4"].num, 6, "C1: сумма 3 × 2 € = 6");
  /* Цена единицы от галки НЕ зависит. */
  assert.equal(on["F2"].num, 10, "цена единицы A1 = 10 € независимо от галки");
});

test("К6а: подвал «Общее количество» = сумме столбца «Кол-во»", () => {
  const totalOf = cells => {
    const refs = Object.keys(cells);
    const r = refs.map(rowNo);
    const labelRow = refs.find(x => cells[x].type === "s" && cells[x].text === "Общее количество, шт.:");
    return cells["B" + rowNo(labelRow)].num;
  };
  assert.equal(totalOf(buildSheet(false)), 20, "без галки: 7 + 10 + 3 = 20 (фактические)");
  assert.equal(totalOf(buildSheet(true)), 23, "с галкой: 10 + 10 + 3 = 23 (по видимой колонке, мутация «от сырого» дала бы 20)");
});
