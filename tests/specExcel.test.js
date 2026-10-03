/* A6 — выгрузка спецификации в Excel (.xlsx). EPSpecExcel.build строит книгу из той же сметы и того
   же свода, что печатает КП (offerPdf/supplierSpec). Проверяем ЧИСЛАМИ, а не поиском подстрок:

     1. писатель xlsx даёт валидный ZIP (STORE) — распаковываем своим разбором, сверяем CRC с
        НЕЗАВИСИМЫМ источником (zlib.crc32), проверяем состав частей и два листа;
     2. числа листа «Спецификация» == числам КП на ТОМ ЖЕ est (позиции, количества, цена, сумма,
        скидка, НДС, итог) — для трёх режимов НДС и с личной скидкой;
     3. лист «По артикулам» == строкам EPSupplierSpec.collect (артикул, имя, количество, порядок);
     4. КП без цен → Excel без цен (ни денежных столбцов, ни итогов).

   Зелёный ≠ проверенное правило (§7.1): мутационная проверка — в отчёте (сломай правило → красный). */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const EPSpecExcel = require("../js/specExcel.js");
const EPOfferPdf = require("../js/offerPdf.js");
const EPSupplierSpec = require("../js/supplierSpec.js");

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = n => Number(n).toFixed(2) + " €";
const near = (a, b, msg) => assert.ok(Math.abs(Number(a) - Number(b)) < 0.005, `${msg}: получено ${a}, ожидалось ${b}`);

/* --- Свой разбор ZIP метода STORE (без inflate): так писатель проверяется независимо от Node-ового
   упаковщика, а CRC каждой части сверяется с zlib.crc32 (другой реализацией). --- */
function unzipStore(bytes) {
  const buf = Buffer.from(bytes);
  const files = {};
  for (let i = 0; i + 4 <= buf.length;) {
    if (buf.readUInt32LE(i) !== 0x04034b50) break;   // дальше центральный каталог
    const method = buf.readUInt16LE(i + 8), crc = buf.readUInt32LE(i + 14), size = buf.readUInt32LE(i + 18);
    const nlen = buf.readUInt16LE(i + 26), elen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nlen).toString("utf8");
    const start = i + 30 + nlen + elen;
    files[name] = { data: buf.slice(start, start + size), crc, method };
    i = start + size;
  }
  return files;
}

/* Разбор одного листа в карту ref→{type,num,text,formula}. Формат нашего писателя: число — <v> без
   t; строка — t="inlineStr" с <is><t>...; формула — <f>...</f><v>кэш</v>. */
function parseSheet(xml) {
  const cells = {};
  const re = /<c r="([A-Z]+\d+)"(?:\s+t="([^"]*)")?(?:\s+s="\d+")?>([\s\S]*?)<\/c>/g;
  let m;
  while ((m = re.exec(xml))) {
    const [, ref, t, inner] = m;
    const f = (inner.match(/<f>([\s\S]*?)<\/f>/) || [])[1];
    if (t === "inlineStr") {
      cells[ref] = { type: "s", text: (inner.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [, ""])[1] };
    } else {
      const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      cells[ref] = { type: f ? "f" : "n", num: v == null ? null : Number(v), formula: f };
    }
  }
  return cells;
}
const col = ref => ref.match(/^[A-Z]+/)[0];
const rowNo = ref => Number(ref.match(/\d+$/)[0]);
const numbersOf = cells => Object.values(cells).filter(c => c.type !== "s" && c.num != null).map(c => c.num);
const headerRow = cells => Object.entries(cells).filter(([r]) => rowNo(r) === 1)
  .sort((a, b) => col(a[0]) < col(b[0]) ? -1 : 1).map(([, c]) => c.text);
const hasNum = (cells, v) => numbersOf(cells).some(n => Math.abs(n - v) < 0.005);

const sheets = bytes => {
  const f = unzipStore(bytes);
  return { files: f,
    spec: parseSheet(f["xl/worksheets/sheet1.xml"].data.toString("utf8")),
    supplier: parseSheet(f["xl/worksheets/sheet2.xml"].data.toString("utf8")) };
};

/* Смета с count>1 и личной скидкой: цена (sum/count) и сумма (sum) различимы, поэтому подмена одного
   числа сразу видна. vat задаём литералом — тест проверяет перенос чисел est в книгу, а не сам НДС. */
const estBase = () => ({
  groups: [
    { name: "Пост 1", composition: "Выключатель, Розетка", count: 3, unit: "компл.", sum: 1071.87,
      items: [{ kind: "mechanism", name: "Выключатель", code: "20001.0", count: 3, price: 100 }],
      discountPersonal: true, discountPercent: 25 },
    { name: "Пост 2", composition: "Розетка", count: 2, unit: "компл.", sum: 640.50,
      items: [{ kind: "mechanism", name: "Розетка", code: "20208", count: 2, price: 50 }],
      discountPersonal: false, discountPercent: 10 }
  ],
  equipment: 1712.37, discount: 171.237, discountMixed: true, discountPercent: 10,
  materials: 400, work: 300, subtotal: 2241.133, missing: [],
  vat: 0, vatLabel: "НДС", vatPercent: 20, vatIncluded: false, total: 2241.133
});
const withVat = (mode) => {
  const e = estBase();
  if (mode === "none") { e.vat = 0; e.total = e.subtotal; }
  if (mode === "surcharge") { e.vat = e.subtotal * 0.2; e.vatIncluded = false; e.total = e.subtotal + e.vat; }
  if (mode === "included") { e.vat = e.subtotal * 0.2 / 1.2; e.vatIncluded = true; e.total = e.subtotal; }
  return e;
};

const supplierSpec = () => ({ posts: [
  { mechanisms: [{ code: "20001.0", name: "Выключатель" }], frame: { code: "09663", name: "Накладка 3М" },
    support: { code: "09613", name: "Суппорт 3М" }, supportCount: 1, box: { code: "V71303", name: "Коробка 3М" }, boxCount: 1 },
  { mechanisms: [{ code: "20208", name: "Розетка" }], frame: null,
    support: null, supportCount: 0, box: { code: "V71701", name: "Коробка круглая" }, boxCount: 2 }
] });

/* КП на тех же данных — источник истины для сверки чисел. */
const kpHtml = (est, options) => EPOfferPdf.buildHtml(est, { esc, money, displayCurrency: () => "EUR",
  options, postLayout: [], planBlockHtml: "", lightingHtml: "", supplierSpecHtml: "" });

/* ---- 1. Валидный ZIP ---- */
test("A6: build даёт валидный ZIP (STORE) с CRC и нужными частями", () => {
  const bytes = EPSpecExcel.build(estBase(), EPSupplierSpec.collect(supplierSpec()), { options: {}, currency: "RUB", rate: 90 });
  assert.ok(bytes instanceof Uint8Array && bytes.length > 0, "на выходе непустой Uint8Array");
  const f = unzipStore(bytes);
  for (const name of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]) {
    assert.ok(f[name], "есть часть " + name);
    assert.equal(f[name].method, 0, name + " хранится без сжатия (STORE)");
    assert.equal(zlib.crc32(f[name].data) >>> 0, f[name].crc, "CRC32 совпадает с независимым zlib: " + name);
  }
  const wb = f["xl/workbook.xml"].data.toString("utf8");
  assert.match(wb, /name="Спецификация"/, "лист «Спецификация» объявлен");
  assert.match(wb, /name="По артикулам"/, "лист «По артикулам» объявлен");
  assert.match(f["[Content_Types].xml"].data.toString("utf8"), /sheet1\.xml/, "Content_Types ссылается на лист 1");
});

/* ---- 2. Числа «Спецификации» == числам КП, три режима НДС, личная скидка ---- */
for (const mode of ["none", "surcharge", "included"]) {
  test(`A6: числа «Спецификации» == числам КП (НДС: ${mode})`, () => {
    const est = withVat(mode);
    const { spec } = sheets(EPSpecExcel.build(est, EPSupplierSpec.collect(supplierSpec()), { options: {}, currency: "EUR", rate: 1 }));
    const html = kpHtml(est, {});

    /* Построчные цена и сумма: берём из est (sum, sum/count) и сверяем, что ОНИ ЖЕ есть в книге и в КП. */
    est.groups.forEach(g => {
      const price = g.count ? g.sum / g.count : 0;
      assert.ok(hasNum(spec, g.sum), `сумма ${g.sum} есть в книге`);
      assert.ok(hasNum(spec, price), `цена ${price} есть в книге`);
      assert.ok(html.includes(money(g.sum)), `сумма ${money(g.sum)} есть в КП`);
    });
    /* Итоги. «Оборудование» — формула SUM со значением est.equipment; остальные — значения. */
    const equip = Object.values(spec).find(c => c.type === "f");
    assert.ok(equip, "итог «Оборудование» — формула SUM");
    near(equip.num, est.equipment, "значение формулы = est.equipment");
    assert.ok(hasNum(spec, -est.discount), "скидка в книге со знаком минус");
    assert.ok(hasNum(spec, est.materials), "материалы в книге");
    assert.ok(hasNum(spec, est.work), "работы в книге");
    assert.ok(hasNum(spec, est.total), "итог в книге");
    assert.ok(html.includes(money(est.total)), "итог КП совпал");
    if (est.vat) {
      assert.ok(hasNum(spec, est.vat), "НДС в книге");
      assert.ok(html.includes(money(est.vat)), "НДС КП совпал");
    }
  });
}

/* ---- 3. «По артикулам» == свод EPSupplierSpec.collect ---- */
test("A6: «По артикулам» повторяет строки EPSupplierSpec.collect (артикул, имя, кол-во, порядок)", () => {
  const collected = EPSupplierSpec.collect(supplierSpec());
  const { supplier } = sheets(EPSpecExcel.build(estBase(), collected, { options: { prices: false }, currency: "EUR", rate: 1 }));
  /* Строки данных начинаются со 2-й (1-я — шапка), итоги — после пустой строки. */
  const dataRows = [...new Set(Object.keys(supplier).map(rowNo))].filter(r => r >= 2).sort((a, b) => a - b);
  const codeOf = r => (supplier["C" + r] || {}).text;      // колонка «Артикул» при showArticles
  const nameOf = r => (supplier["B" + r] || {}).text;
  const cntOf = r => (supplier["D" + r] || {}).num;
  /* Сопоставляем по порядку: i-я строка данных книги = i-я строка collect.rows. */
  collected.rows.forEach((row, i) => {
    const r = dataRows[i];
    assert.equal(nameOf(r), row.name, `имя строки ${i + 1}`);
    assert.equal(codeOf(r), row.code || "артикул не определён", `артикул строки ${i + 1}`);
    assert.equal(cntOf(r), row.count, `кол-во строки ${i + 1}`);
  });
  /* «Всего наименований» из свода печатается в книге. */
  assert.ok(Object.values(supplier).some(c => c.type === "s" && c.text === "Всего наименований:"), "строка итога по наименованиям есть");
});

/* ---- 4. КП без цен → Excel без цен ---- */
test("A6: при отключённых ценах в книге нет ни денежных столбцов, ни итогов", () => {
  const { spec, supplier } = sheets(EPSpecExcel.build(estBase(), EPSupplierSpec.collect(supplierSpec()),
    { options: { prices: false }, currency: "EUR", rate: 1 }));
  assert.ok(!headerRow(spec).includes("Цена") && !headerRow(spec).includes("Сумма"), "в «Спецификации» нет столбцов цены/суммы");
  assert.ok(!Object.values(spec).some(c => c.type === "f"), "нет формулы итога");
  assert.ok(!Object.values(spec).some(c => c.type === "s" && c.text === "Оборудование"), "нет блока итогов");
  assert.ok(!headerRow(supplier).includes("Цена") && !headerRow(supplier).includes("Сумма"), "в «По артикулам» нет столбцов цены/суммы");
  /* А с ценами — столбцы появляются (контроль, что проверка не тавтологична). */
  const withPrices = sheets(EPSpecExcel.build(estBase(), EPSupplierSpec.collect(supplierSpec()),
    { options: {}, currency: "EUR", rate: 1 }));
  assert.ok(headerRow(withPrices.spec).includes("Сумма"), "с ценами столбец «Сумма» есть");
});

/* ---- 5. Деньги в РУБЛЯХ по курсу ≠ 1: Excel == КП ----
   Доработка (координатор): проверки 1–4 шли в евро (rate=1), и мутация «est.total × rate → est.total»
   (итог без курса) не ловилась. Здесь курс = ЦБ РФ + 3% (правило проекта), и КАЖДАЯ денежная ячейка
   обоих листов сверяется с тем, что КП печатает в рублях на том же est — через ту же money(), что
   получает offerPdf. Excel хранит base × rate полной точностью; КП печатает money(base) = round(base ×
   rate); формат ячейки — рублёвый. Оба берут ОДИН И ТОТ ЖЕ произведённый float base × rate, поэтому
   разойтись не могут. */
const RATE = 95.37 * 1.03;                         // курс ЦБ РФ 95,37 + надбавка 3%
const round2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
const moneyRub = n => round2(n * RATE).toFixed(2) + " ₽";   // money(), какой получает offerPdf в рублях
const kpRub = (est, options) => EPOfferPdf.buildHtml(est, { esc, money: moneyRub, displayCurrency: () => "RUB",
  settings: {}, effectiveRate: () => RATE, options, postLayout: [], planBlockHtml: "", lightingHtml: "", supplierSpecHtml: "" });

/* Свод с count=2 у одного артикула — чтобы «сумма» (цена×кол-во) отличалась от «цены» и подмена
   одной из них была видна. Оба артикула есть в est.items (цены 100 и 50), поэтому книга покажет цену. */
const supplierRub = () => ({ posts: [
  { mechanisms: [{ code: "20001.0", name: "Выключатель" }], frame: null, support: null, supportCount: 0, box: null, boxCount: 0 },
  { mechanisms: [{ code: "20001.0", name: "Выключатель" }, { code: "20208", name: "Розетка" }], frame: null, support: null, supportCount: 0, box: null, boxCount: 0 }
] });

test("A6: деньги в рублях — лист «Спецификация» == КП по курсу (все строки и итоги)", () => {
  const est = withVat("surcharge");   // есть все строки итогов: скидка, материалы, работы, без НДС, НДС, итог
  const { files, spec } = sheets(EPSpecExcel.build(est, EPSupplierSpec.collect(supplierRub()), { options: {}, currency: "RUB", rate: RATE }));
  const html = kpRub(est, {});

  /* Формат ячейки — рублёвый (₽), а не евро: ловит мутацию символа валюты. */
  const styles = files["xl/styles.xml"].data.toString("utf8");
  assert.match(styles, /formatCode="[^"]*₽[^"]*"/, "денежный формат содержит ₽");
  assert.ok(!/formatCode="[^"]*€[^"]*"/.test(styles), "в рублёвой книге нет формата с €");

  /* Построчно: цена (sum/count) и сумма (sum), обе × курс — в книге И в КП. */
  est.groups.forEach(g => {
    const price = g.count ? g.sum / g.count : 0;
    assert.ok(hasNum(spec, g.sum * RATE), `сумма ${g.sum}×курс в книге`);
    assert.ok(hasNum(spec, price * RATE), `цена ${price}×курс в книге`);
    assert.ok(html.includes(moneyRub(g.sum)), `сумма ${moneyRub(g.sum)} в КП`);
    assert.ok(html.includes(moneyRub(price)), `цена ${moneyRub(price)} в КП`);
  });
  /* Итоги: формула «Оборудование» = equipment×курс; скидка (−), материалы, работы, без НДС, НДС, итог. */
  const equip = Object.values(spec).find(c => c.type === "f");
  near(equip.num, est.equipment * RATE, "SUM-итог = equipment×курс");
  assert.ok(hasNum(spec, -est.discount * RATE), "скидка ×курс со знаком минус");
  assert.ok(hasNum(spec, est.materials * RATE), "материалы ×курс");
  assert.ok(hasNum(spec, est.work * RATE), "работы ×курс");
  assert.ok(hasNum(spec, est.subtotal * RATE), "итого без НДС ×курс");
  assert.ok(hasNum(spec, est.vat * RATE), "НДС ×курс");
  assert.ok(hasNum(spec, est.total * RATE), "итог ×курс");
  /* Те же числа печатает КП в рублях (money()). */
  [est.discount, est.materials, est.work, est.subtotal, est.vat, est.total].forEach(v =>
    assert.ok(html.includes(moneyRub(v)), `${moneyRub(v)} в КП`));
});

test("A6: деньги в рублях — лист «По артикулам» цена/сумма == money() по курсу", () => {
  const est = withVat("surcharge");
  const collected = EPSupplierSpec.collect(supplierRub());
  const { supplier } = sheets(EPSpecExcel.build(est, collected, { options: {}, currency: "RUB", rate: RATE }));
  /* Цены артикулов берутся из est.items; свод: 20001.0 ×2, 20208 ×1. */
  const priceByCode = { "20001.0": 100, "20208": 50 };
  collected.rows.forEach(row => {
    const unit = priceByCode[row.code];
    if (unit == null) return;                 // строки без цены в est пропускаем (у них клетки пустые)
    assert.ok(hasNum(supplier, unit * RATE), `цена ${row.code} = ${moneyRub(unit)} по курсу`);
    assert.ok(hasNum(supplier, unit * row.count * RATE), `сумма ${row.code} = цена×${row.count} по курсу`);
  });
  /* money() КП на тех же базовых ценах даёт те же рублёвые значения. */
  assert.equal(moneyRub(100), round2(100 * RATE).toFixed(2) + " ₽");
  assert.equal(moneyRub(50 * 2), round2(100 * RATE).toFixed(2) + " ₽");
});

test("A6: граница округления копейки — Excel и КП показывают одно и то же", () => {
  /* Подбираем base и курс так, чтобы base × курс попадало на ...,xx5 (третий знак — 5): 1,2345 × 10 =
     12,345. Excel хранит ИМЕННО этот float, КП печатает money(1,2345) = round(12,345). Оба округляют
     один и тот же операнд, поэтому показанные 2 знака совпадают — какое бы правило округления Excel ни
     применил. */
  const R = 10;
  const est = { groups: [{ name: "P", count: 2, unit: "компл.", sum: 2.469,
    items: [{ kind: "mechanism", name: "M", code: "X", count: 2, price: 1.2345 }] }],
    equipment: 2.469, discount: 0, materials: 0, work: 0, subtotal: 2.469, missing: [],
    vat: 0, vatLabel: "НДС", vatPercent: 0, vatIncluded: false, total: 2.469 };
  const { spec } = sheets(EPSpecExcel.build(est, { rows: [] }, { options: {}, currency: "RUB", rate: R }));
  const priceCell = Object.entries(spec).find(([r, c]) => rowNo(r) === 2 && c.type !== "s" && Math.abs(c.num - 1.2345 * R) < 1e-9);
  assert.ok(priceCell, "цена позиции хранится как base×курс (12.345) без предварительного округления");
  const stored = priceCell[1].num;
  const mRub = n => round2(n * R).toFixed(2);
  assert.equal(round2(stored).toFixed(2), mRub(1.2345), "2-значное округление ячейки = money() КП на том же float");
});

/* ---- Имя файла: номер КП, безопасные символы, расширение ---- */
test("A6: fileName подставляет номер КП и чистит запрещённые символы", () => {
  assert.equal(EPSpecExcel.fileName("EPG-2026-0001", "Проект"), "Спецификация EPG-2026-0001.xlsx");
  assert.equal(EPSpecExcel.fileName("", "Кухня/Ванная"), "Спецификация Кухня_Ванная.xlsx");
  assert.equal(EPSpecExcel.fileName("", ""), "Спецификация.xlsx");
});
