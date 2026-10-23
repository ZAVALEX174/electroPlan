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

/* Значение «Оборудование», какое Excel покажет ПОСЛЕ ПЕРЕСЧЁТА (а не кэш <v>): если ячейка —
   формула SUM, складываем РЕАЛЬНЫЕ числа ячеек из перечисленных диапазонов (по одному столбцу
   каждый); если ячейка статическая — берём её число. Так тест ловит «формула не покрывает все суммы». */
const parseRef = r => { const m = /^([A-Z]+)(\d+)$/.exec(r); return { col: m[1], row: Number(m[2]) }; };
function sumColRange(cells, a, b) {
  const pa = parseRef(a), pb = parseRef(b);
  let s = 0;
  for (let row = pa.row; row <= pb.row; row++) {
    const c = cells[pa.col + row];
    if (c && c.type !== "s" && c.num != null) s += c.num;
  }
  return s;
}
function equipDisplayed(cells) {
  const ref = Object.entries(cells).find(([, c]) => c.type === "s" && c.text === "Оборудование");
  if (!ref) return null;
  const rowNo = Number(ref[0].match(/\d+$/)[0]);
  const cell = cells["B" + rowNo];   // значение итога — в столбце B той же строки (подпись в A)
  if (!cell) return null;
  if (cell.type === "f") {
    const inner = /^SUM\((.*)\)$/.exec(cell.formula)[1];
    return inner.split(",").reduce((s, rng) => { const [a, b] = rng.split(":"); return s + sumColRange(cells, a, b); }, 0);
  }
  return cell.num;
}

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
    /* НЕ тавтология: вычисляем формулу по РЕАЛЬНЫМ числам ячеек диапазонов (эмуляция пересчёта книги)
       и сверяем с totals.equipment. Старый тест складывал spec.rows — то же число, что писал код, —
       и дефект «добор вместо обычных строк» не ловил. */
    const recalculated = equipDisplayed(cells);
    assert.ok(Math.abs(recalculated - totals.equipment) < 0.005,
      `пересчёт формулы по ячейкам (${recalculated}) = totals.equipment (${totals.equipment})`);
  });
}

/* ---- Деньги: «Оборудование» после пересчёта = totals.equipment при ЛЮБОМ наборе скрытых столбцов
   (решение владельца 23.10 + денежный дефект sum:false). equipDisplayed читает РЕАЛЬНЫЕ ячейки:
   для формулы складывает значения её диапазонов, для статического числа берёт его. ---- */
for (const [label, optsSpec] of [
  ["Цена+Сумма показаны", {}],
  ["Сумма скрыта", { specification: { sum: false } }],
  ["Цена скрыта", { specification: { price: false } }],
  ["Цена и Сумма скрыты", { specification: { price: false, sum: false } }]
]) {
  for (const [curLabel, currency, rate] of [["€", "EUR", 1], ["₽", "RUB", 92.5]]) {
    test(`Excel ${curLabel} (${label}): «Оборудование» после пересчёта = totals.equipment`, () => {
      const est = buildEst(true);
      const cells = specSheet(est, { options: optsSpec, currency, rate });
      const totals = EPEstimate.totalsShown(est, rate, currency);
      const shown = equipDisplayed(cells);
      assert.ok(shown != null, "строка «Оборудование» на листе есть");
      assert.ok(Math.abs(shown - totals.equipment) < 0.005,
        `«Оборудование» ${shown} = totals.equipment ${totals.equipment}`);
    });
  }
}

/* ---- Скрытие «Цена»/«Сумма» в доборе по настройке спецификации (решение владельца 23.10) ---- */
test("КП: снята «Сумма» в спецификации — в доборе тоже нет «Сумма», «Цена» осталась", () => {
  const html = EPOfferPdf.buildHtml(buildEst(true), depsEUR({ specification: { sum: false } }));
  const topUpPart = html.slice(html.indexOf("Добор до целых упаковок"));
  assert.ok(!/<th[^>]*>Сумма<\/th>/.test(topUpPart), "столбца «Сумма» в доборе нет");
  assert.ok(/<th[^>]*>Цена<\/th>/.test(topUpPart), "столбец «Цена» в доборе остался");
});

test("КП: снята «Цена» в спецификации — в доборе нет «Цена», «Сумма» осталась", () => {
  const html = EPOfferPdf.buildHtml(buildEst(true), depsEUR({ specification: { price: false } }));
  const topUpPart = html.slice(html.indexOf("Добор до целых упаковок"));
  assert.ok(!/<th[^>]*>Цена<\/th>/.test(topUpPart), "столбца «Цена» в доборе нет");
  assert.ok(/<th[^>]*>Сумма<\/th>/.test(topUpPart), "столбец «Сумма» в доборе остался");
});

test("Excel: снята «Сумма» — добор без «Сумма», «Цена» есть, «Оборудование» готовым числом (не формула)", () => {
  const cells = specSheet(buildEst(true), { options: { specification: { sum: false } }, currency: "EUR", rate: 1 });
  assert.ok(hasText(cells, "Добор до целых упаковок"), "блок добора есть");
  assert.ok(hasText(cells, "Цена"), "столбец «Цена» есть");
  assert.ok(!hasText(cells, "Сумма"), "столбца «Сумма» нет");
  assert.ok(!equipFormula(cells), "нет SUM-формулы: «Оборудование» готовым числом (иначе SUM одного добора)");
});

test("Excel: снята «Цена» — добор без «Цена», «Сумма» есть, «Оборудование» — SUM двух диапазонов", () => {
  const cells = specSheet(buildEst(true), { options: { specification: { price: false } }, currency: "EUR", rate: 1 });
  assert.ok(!hasText(cells, "Цена"), "столбца «Цена» нет");
  assert.ok(hasText(cells, "Сумма"), "столбец «Сумма» есть");
  const eq = equipFormula(cells);
  assert.ok(eq && /SUM\([^,]+,[^,]+\)/.test(eq.formula), "SUM двух диапазонов (обычные + добор)");
});

/* ---- Нумерация добора — СВОЯ, с 1 (а не продолжение спецификации) ---- */
test("КП: нумерация добора начинается с 1", () => {
  const html = EPOfferPdf.buildHtml(buildEst(true), depsEUR());
  const i = html.indexOf("Добор до целых упаковок");
  const t = html.indexOf('<table class="specification">', i);
  const tbl = html.slice(t, html.indexOf("</table>", t));
  const body = tbl.slice(tbl.indexOf("<tbody>"));
  const firstTr = /<tr>([\s\S]*?)<\/tr>/.exec(body)[1];
  const firstTd = /<td[^>]*>([\s\S]*?)<\/td>/.exec(firstTr)[1];
  assert.equal(firstTd, "1", "первая строка добора — № 1 (не глобальный индекс группы)");
});

test("Excel: нумерация добора начинается с 1", () => {
  const cells = specSheet(buildEst(true), { options: {}, currency: "EUR", rate: 1 });
  const titleRef = Object.entries(cells).find(([, c]) => c.type === "s" && c.text === "Добор до целых упаковок")[0];
  const titleRow = Number(titleRef.match(/\d+$/)[0]);
  /* title → строка заголовков (titleRow+1) → первая строка данных (titleRow+2); № — столбец A. */
  assert.equal(cells["A" + (titleRow + 2)].num, 1, "первая строка блока добора — № 1");
});

/* ---- Имя добора в Excel чистится через itemText при скрытых артикулах (код из имени убран) ---- */
test("Excel articles:false: имя добора очищено itemText — код из имени убран", () => {
  const est = buildEst(true);
  const gi = est.groups.findIndex(g => g.topUp && g.items[0].code === "20001.0");
  /* Вшиваем код в имя: без itemText он остался бы в ячейке при скрытых артикулах (мутация «raw g.name»). */
  const nameWithCode = "Выключатель 20001.0 одноклавишный";
  est.groups[gi] = { ...est.groups[gi], name: nameWithCode,
    items: est.groups[gi].items.map(it => ({ ...it, name: nameWithCode })) };
  const cells = specSheet(est, { options: { articles: false }, currency: "EUR", rate: 1 });
  assert.ok(!hasText(cells, "Артикул"), "столбца «Артикул» нет");
  const nameCells = Object.values(cells).filter(c => c.type === "s" && /Выключатель/.test(c.text) && /одноклавишный/.test(c.text));
  assert.ok(nameCells.length > 0, "имя добора на листе есть");
  assert.ok(nameCells.every(c => !c.text.includes("20001.0")), "код из имени добора убран (itemText)");
});

/* ---- Раздел добора делает КП непустым (topUpSection в contentFragments страж пустого КП) ---- */
test("КП: раздел добора один делает документ непустым (hasContent)", () => {
  const deps = depsEUR({ prices: false,
    sections: { plan: false, layout: false, specification: false, lighting: false, supplier: false } });
  assert.ok(EPOfferPdf.hasContent(buildEst(true), deps),
    "КП из одного раздела добора считается содержательным (иначе topUpSection выпал из contentFragments)");
});

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
