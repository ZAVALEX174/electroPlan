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
const EPEstimate = require("../js/estimate.js");

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
/* Строки несут изделия с ценой, складывающейся в цену строки (В26: цена/сумма считаются по изделиям):
   Пост 1 — изделие 357,29 € → цена строки 357,29 €, сумма 357,29 × 3 = 1071,87 €;
   Пост 2 — изделие 320,25 € → цена строки 320,25 €, сумма 320,25 × 2 = 640,50 €;
   Оборудование = 1071,87 + 640,50 = 1712,37 €. */
const estBase = () => ({
  groups: [
    { name: "Пост 1", composition: "Выключатель, Розетка", count: 3, unit: "компл.", sum: 1071.87,
      items: [{ kind: "mechanism", name: "Выключатель", code: "20001.0", count: 1, price: 357.29 }],
      discountPersonal: true, discountPercent: 25 },
    { name: "Пост 2", composition: "Розетка", count: 2, unit: "компл.", sum: 640.50,
      items: [{ kind: "mechanism", name: "Розетка", code: "20208", count: 1, price: 320.25 }],
      discountPersonal: false, discountPercent: 10 }
  ],
  equipment: 1712.37, discount: 171.237, discountMixed: true, discountPercent: 10,
  /* В26: скидка/материалы/работы печатаются как процент от напечатанного «Оборудования» (totalsShown),
     поэтому проценты — ВХОД, а est.discount/materials/work (евро) остаются лишь признаком показа строки
     (КП и книга гейтят строку «Скидка» по est.discount, строки НДС — по est.vat). */
  materialsPercent: 20, workPercent: 15,
  materials: 400, work: 300, subtotal: 2241.133, missing: [],
  vat: 0, vatLabel: "НДС", vatPercent: 20, vatIncluded: false, total: 2241.133
});
const withVat = (mode) => {
  const e = estBase();
  e.vatMode = mode;   // В7: vatShown берёт режим из est.vatMode (у настоящего build он есть)
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
const kpHtml = (est, options) => EPOfferPdf.buildHtml(est, { esc, money, moneyShown: money, displayRate: () => 1,
  displayCurrency: () => "EUR", options, postLayout: [], planBlockHtml: "", lightingHtml: "", supplierSpecHtml: "" });

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
    /* Итоговые числа — из ОДНОГО правила totalsShown (В26: от напечатанного «Оборудования», не est.X×курс);
       книга и КП обязаны печатать ровно их. */
    const t = EPEstimate.totalsShown(est, 1);
    assert.ok(hasNum(spec, -t.discount), "скидка в книге со знаком минус (из totalsShown)");
    assert.ok(hasNum(spec, t.materials), "материалы в книге (из totalsShown)");
    assert.ok(hasNum(spec, t.work), "работы в книге (из totalsShown)");
    assert.ok(hasNum(spec, t.total), "итог в книге (из totalsShown)");
    assert.ok(html.includes(money(t.total)), "итог КП совпал");
    if (est.vat) {
      assert.ok(hasNum(spec, t.amount), "НДС в книге (из totalsShown)");
      assert.ok(html.includes(money(t.amount)), "НДС КП совпал");
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
/* К7 (решение владельца 20.10): рубли — ЦЕЛЫЙ рубль, цены/суммы/НДС ВВЕРХ. money() в рублях =
   ceilRub(база × курс); moneyShown форматирует УЖЕ-рублёвое (целое) число без копеек. Те же стабы
   получает offerPdf — КП печатает ровно эти строки, что сверяем с книгой. */
const ceilRub = n => EPEstimate.roundShown(n, "RUB", "up");
const moneyRub = n => ceilRub(n * RATE) + " ₽";   // money() в рублях — целый рубль вверх
const moneyShownRub = n => ceilRub(n) + " ₽";     // уже в рублях — целое (round'ить не на что)
const kpRub = (est, options) => EPOfferPdf.buildHtml(est, { esc, money: moneyRub, moneyShown: moneyShownRub,
  displayRate: () => RATE, displayCurrency: () => "RUB",
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

  /* Построчно: цена и сумма — ПО ИЗДЕЛИЯМ в целых рублях (specShown с "RUB"), ровно те же числа в
     книге И в КП (оба — потребители одной specShown). sum = ceilRub(ceilRub(евро×курс)×кол). */
  const sp = EPEstimate.specShown(est, RATE, "RUB");
  est.groups.forEach((g, i) => {
    assert.ok(hasNum(spec, sp.rows[i].sum), `сумма ${sp.rows[i].sum} ₽ в книге`);
    assert.ok(hasNum(spec, sp.rows[i].price), `цена ${sp.rows[i].price} ₽ в книге`);
    assert.ok(html.includes(moneyShownRub(sp.rows[i].sum)), `сумма ${moneyShownRub(sp.rows[i].sum)} в КП`);
    assert.ok(html.includes(moneyShownRub(sp.rows[i].price)), `цена ${moneyShownRub(sp.rows[i].price)} в КП`);
  });
  /* Итоги: формула «Оборудование» = Σ целых сумм строк (specShown); скидка (−), материалы, работы,
     без НДС, НДС, итог. */
  const equip = Object.values(spec).find(c => c.type === "f");
  near(equip.num, sp.equipment, "SUM-итог = Σ сумм строк (целые рубли)");
  /* Итоги — из totalsShown (В26 + К7: скидка вниз, материалы/работы/НДС вверх до рубля, не est.X×курс);
     книга хранит эти числа, КП печатает их через moneyShown. */
  const t = EPEstimate.totalsShown(est, RATE, "RUB");
  assert.ok(hasNum(spec, -t.discount), "скидка (totalsShown) со знаком минус");
  assert.ok(hasNum(spec, t.materials), "материалы (totalsShown)");
  assert.ok(hasNum(spec, t.work), "работы (totalsShown)");
  assert.ok(hasNum(spec, t.subtotal), "итого без НДС (totalsShown)");
  assert.ok(hasNum(spec, t.amount), "НДС (totalsShown)");
  assert.ok(hasNum(spec, t.total), "итог (totalsShown)");
  /* Те же числа печатает КП в рублях (moneyShown из totalsShown). */
  [t.discount, t.materials, t.work, t.subtotal, t.amount, t.total].forEach(v =>
    assert.ok(html.includes(moneyShownRub(v)), `${moneyShownRub(v)} в КП`));
});

test("A6: деньги в рублях — лист «По артикулам» цена/сумма == money() по курсу", () => {
  const est = withVat("surcharge");
  const collected = EPSupplierSpec.collect(supplierRub());
  const { supplier } = sheets(EPSpecExcel.build(est, collected, { options: {}, currency: "RUB", rate: RATE }));
  const html = kpRub(est, {});
  /* Цены артикулов берутся из est.items; свод: 20001.0 ×2, 20208 ×1. */
  const priceByCode = { "20001.0": 357.29, "20208": 320.25 };
  /* В26 + К7: «Цена» = ceilRub(евро × курс) — целый рубль вверх, «Сумма» = количество × эта
     НАПЕЧАТАННАЯ цена (shownSum, тоже целые рубли), а не сырое unit×count×курс — чтобы «Кол-во × Цена»
     сходилось в «Сумму». Проверяем ПОКЛЕТОЧНО: цена в F{r}, сумма в G{r}. */
  const K = v => Math.round(EPEstimate.round2(v) * 100);
  const dataRows = [...new Set(Object.keys(supplier).map(rowNo))].filter(r => r >= 2).sort((a, b) => a - b);
  const codeOf = r => (supplier["C" + r] || {}).text;
  collected.rows.forEach((row, i) => {
    const unit = priceByCode[row.code];
    if (unit == null) return;                 // строки без цены в est пропускаем (у них клетки пустые)
    const r = dataRows[i];
    assert.equal(codeOf(r), row.code, `строка ${i + 1} — тот же артикул`);
    const priceShown = ceilRub(unit * RATE);
    const sumShown = EPEstimate.shownSum([{ price: unit, count: row.count }], RATE, "RUB");
    const priceCell = (supplier["F" + r] || {}).num, sumCell = (supplier["G" + r] || {}).num;
    assert.equal(K(priceCell), K(priceShown), `цена ${row.code} = ceilRub(евро×курс)`);
    assert.equal(K(sumCell), K(sumShown), `сумма ${row.code} = количество × напечатанная цена (целые рубли)`);
    /* Сверка с КП: money() на тех же базовых ценах даёт ту же напечатанную цену единицы. */
    assert.ok(html.includes(moneyRub(unit)), `цена ${moneyRub(unit)} в КП`);
  });
  /* money() в рублях печатает ЦЕЛЫЙ рубль без копеек (К7, решение владельца 20.10 п.5). */
  assert.ok(/^\d+ ₽$/.test(moneyRub(357.29)), "money() в рублях — целое число рублей, без копеек");
  assert.ok(/^\d+ ₽$/.test(moneyRub(320.25 * 2)), "сумма в рублях — целое, без копеек");
});

test("A6 (В26+К7): лист «По артикулам» — «Сумма» = количество × НАПЕЧАТАННАЯ цена, а не сырое unit×count×курс", () => {
  /* 25,79 € × курс 92,5 = 2385,575 → вверх 2386 ₽; сумма 7 шт = ceil(2386 × 7) = 16 702 ₽. Сырое
     ceil(25,79 × 7 × 92,5) = ceil(16 699,025) = 16 700 ₽ — на 2 рубля меньше. Проверяем ПОКЛЕТОЧНО,
     что в ячейке «Сумма» именно 16 702 (количество × напечатанная цена), и сырого 16 700 нет (ловит М22). */
  const est = { groups: [{ name: "P", count: 7, unit: "компл.", sum: 180.53,
    items: [{ kind: "mechanism", code: "A", name: "Выключатель", count: 1, price: 25.79 }] }],
    equipment: 180.53, discount: 0, materials: 0, work: 0, subtotal: 180.53, missing: [],
    vat: 0, vatLabel: "НДС", vatPercent: 0, vatIncluded: false, total: 180.53 };
  const supplier = { rows: [{ code: "A", name: "Выключатель", count: 7, unit: "шт." }], totalNames: 1, totalUnits: 7 };
  const { supplier: sheet } = sheets(EPSpecExcel.build(est, supplier, { options: {}, currency: "RUB", rate: 92.5 }));
  const priceCell = (sheet["F2"] || {}).num, sumCell = (sheet["G2"] || {}).num;
  assert.equal(priceCell, 2386, "цена = ceilRub(25,79×92,5) = 2386");
  assert.equal(sumCell, 16702, "сумма = ceil(2386 × 7) = 16 702");
  assert.notEqual(sumCell, 16700, "сырого 16 700 (ceil(unit×count×курс)) в ячейке нет");
});

test("A6 (В26+К7): цена/сумма строки хранятся УЖЕ округлёнными до рубля (13), а не сырым произведением 12,345", () => {
  /* Цена изделия 1,2345 € × курс 10 = 12,345 → в рублях ВВЕРХ до рубля = 13 (К7). В ячейку Excel идёт
     УЖЕ напечатанное число из specShown (как и в КП), а не сырое 12,345: иначе Σ столбца «Сумма» не
     сошлась бы с «Оборудованием» при пересчёте книги и в ячейке были бы копейки. */
  const R = 10;
  const est = { groups: [{ name: "P", count: 1, unit: "компл.", sum: 1.2345,
    items: [{ kind: "mechanism", name: "M", code: "X", count: 1, price: 1.2345 }] }],
    equipment: 1.2345, discount: 0, materials: 0, work: 0, subtotal: 1.2345, missing: [],
    vat: 0, vatLabel: "НДС", vatPercent: 0, vatIncluded: false, total: 1.2345 };
  const { spec } = sheets(EPSpecExcel.build(est, { rows: [] }, { options: {}, currency: "RUB", rate: R }));
  assert.equal(EPEstimate.roundShown(1.2345 * R, "RUB", "up"), 13, "предпосылка: ceilRub(12,345) = 13");
  const dataCells = Object.entries(spec).filter(([r, c]) => rowNo(r) === 2 && c.type !== "s" && c.num != null).map(([, c]) => c.num);
  assert.ok(dataCells.some(n => Math.abs(n - 13) < 1e-9), "ячейка цены/суммы хранит целый рубль 13");
  assert.ok(!dataCells.some(n => Math.abs(n - 12.345) < 1e-9), "сырого 12,345 в ячейке нет — число пред-округлено (В26+К7)");
});

test("A6 МУТАЦИЯ-ловушка (рубли): три числа НДС из vatShown (целый рубль), не est.X×курс", () => {
  /* subtotal 0,01 € × курс 92,5: в рублях (К7) оборудование = ceil(0,925)=1 ₽, НДС 5% сверху =
     ceil(1×0,05)=1 ₽, итог = 1+1 = 2 ₽. А est.total×курс = 0,0105×92,5 = 0,97125 (≈0,97). Мутация
     «Excel считает мимо totalsShown» (vat.total → est.total×rate) дала бы 0,97 вместо 2 и ловится. */
  const est = { groups: [{ name: "X", count: 1, unit: "шт", sum: 0.01, items: [{ code: "X", name: "X", count: 1, price: 0.01 }] }],
    equipment: 0.01, discount: 0, materials: 0, work: 0, subtotal: 0.01, missing: [],
    vatMode: "surcharge", vat: 0.0005, vatLabel: "НДС", vatPercent: 5, vatIncluded: false, total: 0.0105 };
  const { spec } = sheets(EPSpecExcel.build(est, { rows: [] }, { options: {}, currency: "RUB", rate: 92.5 }));
  const v = EPEstimate.vatShown(est.subtotal, est.vatMode, est.vatPercent, 92.5, "RUB");
  assert.equal(v.total, 2);
  assert.ok(hasNum(spec, 2), "в книге итог из vatShown (2 ₽)");
  assert.ok(!hasNum(spec, 0.97125), "в книге НЕТ est.total×курс (0,97) — Excel не считает мимо правила");
});

/* ---- Имя файла: номер КП, безопасные символы, расширение ---- */
test("A6: fileName подставляет номер КП и чистит запрещённые символы", () => {
  assert.equal(EPSpecExcel.fileName("EPG-2026-0001", "Проект"), "Спецификация EPG-2026-0001.xlsx");
  assert.equal(EPSpecExcel.fileName("", "Кухня/Ванная"), "Спецификация Кухня_Ванная.xlsx");
  assert.equal(EPSpecExcel.fileName("", ""), "Спецификация.xlsx");
});
