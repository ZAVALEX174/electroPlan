/* Добор до целых упаковок в ДОКУМЕНТАХ (К6б ч.2): раздел «Добор до целых упаковок» в КП (offerPdf) и
   блок в листе «Спецификация» Excel (specExcel). Часть 1 уже сделала строки добора группами сметы
   (g.topUp); здесь проверяем, что документы печатают их ОТДЕЛЬНЫМ разделом, а не обычными строками.
   Запуск: node --test tests/packTopUpDocs.test.js

   Проверки (из задачи): КП с галкой — обычная спецификация без добора, раздел с заголовком, числа =
   specShown, итог = totalsShown; набор «Для клиента» (sections.specification:false) — раздел есть;
   prices:false — без цен; articles:false — без артикулов; галка снята — раздела нет; Excel — блок есть,
   ячейка «Оборудование» = totals.equipment (€ и ₽, курс 92,5). Все числа — из specShown/totalsShown. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const EPEstimate = require("../js/estimate.js");
const EPPackTopUp = require("../js/packTopUp.js");
const EPOfferPdf = require("../js/offerPdf.js");
const EPSpecExcel = require("../js/specExcel.js");
const EPSupplierSpec = require("../js/supplierSpec.js");

/* --- Фикстура как в packTopUp.test.js: 1 одиночный выключатель + 2 одинаковых 2-клавишных поста. --- */
const MECH = { id: 10, code: "20001.0", name: "Выключатель 1 клавиша", price: 25.79, unit: "шт." };
const FRAME = { id: 20, code: "20657", name: "Рамка 2 поста", price: 10.4, unit: "шт." };
const BOX = { code: "V71301", name: "Коробка 3 модуля", price: 1.5 };
const SUP = { code: "20811", name: "Суппорт 2 модуля", price: 0.85 };
const catalog = { 10: MECH, 20: FRAME };
const product = id => catalog[Number(id)] || undefined;
const comp = { box: BOX, boxCount: 1, support: SUP, supportCount: 1, supportAssumed: false,
  frameAvailability: { frame: FRAME, missing: false, unset: false, displayName: FRAME.name } };
const postComposition = () => comp;
const postCost = po => (po.mechanismIds || []).reduce((s, id) => s + (product(id) ? product(id).price : 0), 0)
  + FRAME.price + BOX.price * comp.boxCount + SUP.price * comp.supportCount;
const post = () => ({ frameId: 20, mechanismIds: [10, 10], name: "Пост" });
/* Упаковки: выключатель по 10, коробка по 100, суппорт по 50, рамка по 1 (=1 → добора нет). */
const packs = EPPackTopUp.buildPackMap([
  { code: "20001.0", packQty: 10 }, { code: "V71301", packQty: 100 },
  { code: "20811", packQty: 50 }, { code: "20657", packQty: 1 }]);

function buildEst(flag, settings) {
  return EPEstimate.build({ devices: [{ productId: 10 }], posts: [post(), post()],
    product, frameProduct: product, postCost, postComposition,
    settings: settings || { discountPercent: 0, materialsPercent: 0, workPercent: 0 },
    packMultiple: flag, packs: flag ? packs : null });
}

const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = n => Number(n).toFixed(2) + " €";
const RATE = 92.5;
const ceilRub = n => EPEstimate.roundShown(n, "RUB", "up");
const moneyRub = n => ceilRub(n * RATE) + " ₽";
const moneyShownRub = n => ceilRub(n) + " ₽";

const depsEUR = opts => ({ esc, money, moneyShown: money, displayRate: () => 1, displayCurrency: () => "EUR",
  settings: {}, options: opts || {}, postLayout: [], planBlockHtml: "", lightingHtml: "", supplierSpecHtml: "" });
const depsRUB = opts => ({ esc, money: moneyRub, moneyShown: moneyShownRub, displayRate: () => RATE,
  displayCurrency: () => "RUB", settings: {}, effectiveRate: () => RATE, options: opts || {},
  postLayout: [], planBlockHtml: "", lightingHtml: "", supplierSpecHtml: "" });

/* Первая таблица класса specification = ОБЫЧНАЯ спецификация (раздел добора — вторая такая таблица). */
const firstSpecTable = html => {
  const i = html.indexOf('<table class="specification">');
  return i < 0 ? "" : html.slice(i, html.indexOf("</table>", i));
};

/* ---- КП: раздел добора ---- */
test("КП (галка): обычная спецификация БЕЗ добора, отдельный раздел с заголовком, числа из specShown", () => {
  const est = buildEst(true);
  const estNo = { ...est, groups: est.groups.filter(g => !g.topUp) };
  const html = EPOfferPdf.buildHtml(est, depsEUR());
  const htmlNo = EPOfferPdf.buildHtml(estNo, depsEUR());

  /* ⚠️ Мутация «не отфильтровать g.topUp из обычной таблицы»: первая таблица спецификации перестанет
     совпадать с версией БЕЗ добора. Добор не меняет печатные числа обычных строк (он в конце groups),
     поэтому первые таблицы обязаны быть идентичны. */
  assert.equal(firstSpecTable(html), firstSpecTable(htmlNo), "обычная спецификация идентична версии без добора");

  const idx = html.indexOf("Добор до целых упаковок");
  assert.ok(idx > -1, "раздел с заголовком есть");
  assert.ok(idx > html.indexOf("Спецификация и комплектация"), "добор ПОСЛЕ спецификации");
  assert.ok(idx < html.indexOf("Оборудование"), "добор ДО блока итогов");

  const spec = EPEstimate.specShown(est, 1, "EUR");
  const topUpPart = html.slice(idx);
  assert.match(topUpPart, /Добавлено/, "столбец «Добавлено»");
  assert.match(topUpPart, /20001\.0/, "артикул добора");
  assert.match(topUpPart, /5 шт\./, "выключатель: добавлено 5");
  /* Числа раздела — печатные из specShown по тому же индексу группы. */
  const gi = est.groups.findIndex(g => g.topUp && g.items[0].code === "20001.0");
  assert.ok(topUpPart.includes(money(spec.rows[gi].sum)), "сумма строки добора = specShown");
  assert.ok(topUpPart.includes(money(spec.rows[gi].price)), "цена строки добора = specShown");
});

test("КП (галка): итог включает добор — печатает totalsShown, не Σ одних обычных строк", () => {
  const est = buildEst(true);
  const estNo = { ...est, groups: est.groups.filter(g => !g.topUp) };
  const html = EPOfferPdf.buildHtml(est, depsEUR());
  const totals = EPEstimate.totalsShown(est, 1, "EUR");
  const totalsNo = EPEstimate.totalsShown(estNo, 1, "EUR");
  assert.ok(totals.equipment > totalsNo.equipment, "предпосылка: добор увеличивает оборудование");
  assert.ok(html.includes(money(totals.equipment)), "«Оборудование» = totalsShown с добором");
  assert.ok(html.includes(money(totals.total)), "«Итого» = totalsShown с добором");
  assert.ok(!html.includes(money(totalsNo.equipment)), "НЕ печатает оборудование без добора");
});

test("КП (рубли, курс 92,5): раздел добора берёт spec.rows (рубли), а не g.sum (евро)", () => {
  const est = buildEst(true);
  const html = EPOfferPdf.buildHtml(est, depsRUB());
  const specR = EPEstimate.specShown(est, RATE, "RUB");
  const gi = est.groups.findIndex(g => g.topUp && g.items[0].code === "20001.0");
  const topUpPart = html.slice(html.indexOf("Добор до целых упаковок"));
  assert.ok(topUpPart.includes(moneyShownRub(specR.rows[gi].sum)), "рублёвая сумма из spec.rows");
  /* Евровая g.sum = 5×25,79 = 128,95 — мутация «печатать g.sum» показала бы её. */
  assert.ok(est.groups[gi].sum === 128.95, "предпосылка: евровая сумма 128,95");
  assert.ok(!topUpPart.includes("128.95"), "евровой суммы в рублёвом КП нет");
  assert.ok(specR.rows[gi].sum !== est.groups[gi].sum, "рублёвая сумма ≠ евровой — мутация ловится");
});

test("КП «Для клиента» (sections.specification:false): раздел добора ЕСТЬ, спецификации нет", () => {
  const est = buildEst(true);
  const html = EPOfferPdf.buildHtml(est, depsEUR({ sections: { specification: false } }));
  assert.ok(!html.includes("Спецификация и комплектация"), "обычной спецификации нет");
  assert.match(html, /Добор до целых упаковок/, "раздел добора печатается независимо от sections");
  assert.match(html, /5 шт\./, "строки добора на месте");
});

test("КП prices:false: раздел добора без «Цена»/«Сумма», но с артикулом и «Добавлено»", () => {
  const est = buildEst(true);
  const html = EPOfferPdf.buildHtml(est, depsEUR({ prices: false }));
  const topUpPart = html.slice(html.indexOf("Добор до целых упаковок"));
  assert.match(topUpPart, /20001\.0/, "артикул остаётся");
  assert.match(topUpPart, /5 шт\./, "«добавлено» остаётся");
  assert.ok(!/<th[^>]*>Цена<\/th>/.test(topUpPart), "столбца «Цена» нет");
  assert.ok(!/<th[^>]*>Сумма<\/th>/.test(topUpPart), "столбца «Сумма» нет");
});

test("КП articles:false: раздел добора без столбца «Артикул» и без кода в тексте", () => {
  const est = buildEst(true);
  const html = EPOfferPdf.buildHtml(est, depsEUR({ articles: false }));
  const topUpPart = html.slice(html.indexOf("Добор до целых упаковок"));
  assert.ok(!/<th[^>]*>Артикул<\/th>/.test(topUpPart), "столбца «Артикул» нет");
  assert.ok(!topUpPart.includes("20001.0"), "артикула в тексте раздела нет");
  assert.match(topUpPart, /Выключатель 1 клавиша/, "имя позиции осталось");
});

test("КП галка СНЯТА: раздела добора нет вовсе", () => {
  const html = EPOfferPdf.buildHtml(buildEst(false), depsEUR());
  assert.ok(!html.includes("Добор до целых упаковок"), "без галки раздела нет");
});

/* ---- Excel: блок добора и ячейка «Оборудование» ---- */
function unzipStore(bytes) {
  const buf = Buffer.from(bytes);
  const files = {};
  for (let i = 0; i + 4 <= buf.length;) {
    if (buf.readUInt32LE(i) !== 0x04034b50) break;
    const crc = buf.readUInt32LE(i + 14), size = buf.readUInt32LE(i + 18);
    const nlen = buf.readUInt16LE(i + 26), elen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nlen).toString("utf8");
    const start = i + 30 + nlen + elen;
    files[name] = { data: buf.slice(start, start + size), crc };
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
    const f = (inner.match(/<f>([\s\S]*?)<\/f>/) || [])[1];
    if (t === "inlineStr") cells[ref] = { type: "s", text: (inner.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [, ""])[1] };
    else { const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1]; cells[ref] = { type: f ? "f" : "n", num: v == null ? null : Number(v), formula: f }; }
  }
  return cells;
}
const specSheet = (est, deps) => parseSheet(unzipStore(EPSpecExcel.build(est,
  EPSupplierSpec.collect({ posts: [] }), deps))["xl/worksheets/sheet1.xml"].data.toString("utf8"));
const hasText = (cells, t) => Object.values(cells).some(c => c.type === "s" && c.text === t);
const hasNum = (cells, v) => Object.values(cells).some(c => c.type !== "s" && c.num != null && Math.abs(c.num - v) < 0.005);
const equipFormula = cells => Object.values(cells).find(c => c.type === "f");

for (const [label, currency, rate] of [["евро", "EUR", 1], ["рубли 92,5", "RUB", 92.5]]) {
  test(`Excel (${label}): блок «Добор» есть, ячейка «Оборудование» = totals.equipment (включая добор)`, () => {
    const est = buildEst(true);
    const cells = specSheet(est, { options: {}, currency, rate });
    assert.ok(hasText(cells, "Добор до целых упаковок"), "заголовок блока добора есть");

    /* Обычная таблица — ТОЛЬКО обычные строки (добор не просочился): данные идут строками 2..1+N, затем
       пустая строка и блок добора. Мутация «не отфильтровать g.topUp» добавила бы строки и сместила блок. */
    const titleRef = Object.entries(cells).find(([, c]) => c.type === "s" && c.text === "Добор до целых упаковок")[0];
    const titleRowNo = Number(titleRef.match(/\d+$/)[0]);
    const normalLen = est.groups.filter(g => !g.topUp).length;
    const mainDataRows = [...new Set(Object.keys(cells).map(r => Number(r.match(/\d+$/)[0])))].filter(r => r >= 2 && r < titleRowNo - 1);
    assert.equal(mainDataRows.length, normalLen, "в обычной таблице только обычные строки");

    const spec = EPEstimate.specShown(est, rate, currency);
    const gi = est.groups.findIndex(g => g.topUp && g.items[0].code === "20001.0");
    assert.ok(hasNum(cells, spec.rows[gi].sum), `сумма добора ${spec.rows[gi].sum} в ячейке (из specShown)`);

    const totals = EPEstimate.totalsShown(est, rate, currency);
    const eq = equipFormula(cells);
    assert.ok(eq, "«Оборудование» — формула SUM");
    assert.ok(Math.abs(eq.num - totals.equipment) < 0.005, `значение ячейки = totals.equipment (${totals.equipment}), получено ${eq.num}`);
    /* ⚠️ Мутация «SUM только по обычным строкам»: формула обязана складывать ДВА диапазона (обычные +
       добор), иначе при пересчёте книги «Оборудование» не включит добор. */
    assert.match(eq.formula, /SUM\([^,]+,[^,]+\)/, "SUM двух диапазонов (обычные строки + добор)");
    /* Проверяем, что сумма ячеек двух диапазонов реально равна totals.equipment (а не только кэш). */
    const sumCells = Object.values(cells).filter(c => c.type === "n" && c.num != null);
    const total = spec.rows.reduce((s, r) => s + r.sum, 0);
    assert.ok(Math.abs(total - totals.equipment) < 0.005, "Σ всех печатных сумм = totals.equipment (инвариант)");
    assert.ok(sumCells.length > 0);
  });
}

test("Excel галка СНЯТА: блока добора нет, «Оборудование» — одиночный SUM (как до К6б)", () => {
  const cells = specSheet(buildEst(false), { options: {}, currency: "EUR", rate: 1 });
  assert.ok(!hasText(cells, "Добор до целых упаковок"), "без галки блока нет");
  const eq = equipFormula(cells);
  assert.ok(eq && !/,/.test(eq.formula), "SUM одного диапазона — поведение не изменилось");
});

test("Excel prices:false: блок добора есть, без столбцов «Цена»/«Сумма»", () => {
  const cells = specSheet(buildEst(true), { options: { prices: false }, currency: "EUR", rate: 1 });
  assert.ok(hasText(cells, "Добор до целых упаковок"), "блок добора печатается и без цен");
  assert.ok(!hasText(cells, "Цена"), "столбца «Цена» нет");
  assert.ok(!equipFormula(cells), "итогов (формулы «Оборудование») нет при prices:false");
});
