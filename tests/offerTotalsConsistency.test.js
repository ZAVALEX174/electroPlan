/* Б — БЛОК ИТОГОВ СХОДИТСЯ ДО КОПЕЙКИ (решение владельца 12.10). «Итого без НДС» = сумма УЖЕ
   напечатанных (округлённых в валюте показа) строк «Оборудование», «Скидка», «Монтажные материалы»,
   «Работы»; НДС и «Итого» считаются уже от неё. Правило живёт в ОДНОЙ функции EPEstimate.totalsShown,
   и панель «Стоимость проекта», КП и Excel берут числа ТОЛЬКО оттуда.

   Проверяем:
     1. Жёсткие примеры владельца (евро 1 323,83 и рубли 261 343,14) и крафт-случай, где прежнее
        правило (округление суммы) расходилось с суммой округлённых.
     2. Сплошной перебор (>200 000 сочетаний компонентов, скидки, режима НДС, ставки, курса): во ВСЕХ
        напечатанные строки выше НДС складываются в «Итого без НДС», а «без НДС» + «НДС» = «Итого».
     3. На НАСТОЯЩИХ потребителях (панель renderSummary из app.js, КП EPOfferPdf.buildHtml, книга
        EPSpecExcel.build) одни и те же числа — в евро и в рублях.

   Зелёный ≠ проверенное правило (§7.1): мутации (kp.json: «Итого без НДС» снова округление суммы;
   работы выпадают из суммы; потребитель берёт итог мимо правила) — в отчёте. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");
const EPEstimate = require("../js/estimate.js");
const EPOfferPdf = require("../js/offerPdf.js");
const EPSpecExcel = require("../js/specExcel.js");
const EPSupplierSpec = require("../js/supplierSpec.js");

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const f2 = n => Number(n).toFixed(2);
/* Форматтер стенда ОБЯЗАН повторять app.js:85 — округлять через EPEstimate.round2 до показа, иначе
   сравнение «строка/итог = totalsShown» шло бы мимо настоящего правила (§7.1: тест не тот код). */
const showMoney = n => f2(EPEstimate.round2(n));

/* Независимая эмуляция показа Excel — НЕ через EPEstimate.round2, иначе сравнение «ячейка Excel =
   totalsShown» было бы тавтологией (§7.1: зелёный тест, который проверяет сам себя). Табличный
   процессор сводит число к 15 значащим десятичным цифрам (снимая двоичный дребезг), затем школьно
   округляет до копейки «от нуля». Записано здесь отдельной арифметикой на строках/BigInt. */
function excelShow(x) {
  const n = Number(x) || 0;
  const a = Math.abs(n), sign = n < 0 ? -1 : 1;
  const s = a.toPrecision(15);
  if (s.includes("e")) return f2(Math.round(a * 100) / 100 * sign);
  let [int, frac = ""] = s.split(".");
  frac = (frac + "000").slice(0, 3);
  let k = BigInt(int) * 100n + BigInt(frac.slice(0, 2));
  if (frac[2] >= "5") k += 1n;
  return f2(Number(k) / 100 * sign);
}
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* est в форме EPEstimate.build (только поля, читаемые totalsShown и шаблоном итогов). */
function estOf(o) {
  const equipment = o.equipment, discount = o.discount || 0, materials = o.materials || 0, work = o.work || 0;
  const subtotal = equipment - discount + materials + work;
  return {
    groups: o.groups || [{ name: "P", count: 1, unit: "компл.", sum: equipment,
      items: [{ kind: "mechanism", name: "P", code: "X", count: 1, price: equipment }] }],
    equipment, discount, discountMixed: false, discountPercent: 0, materials, work, subtotal, missing: [],
    vatMode: o.vatMode || "none", vatPercent: o.vatPercent || 0,
    vat: o.vatMode === "surcharge" ? subtotal * (o.vatPercent || 0) / 100
       : o.vatMode === "included" ? subtotal * (o.vatPercent || 0) / (100 + (o.vatPercent || 0)) : 0,
    vatIncluded: o.vatMode === "included",
    vatLabel: o.vatMode === "included" ? "в т.ч. НДС" : o.vatMode === "surcharge" ? "НДС" : "",
    total: o.vatMode === "surcharge" ? subtotal * (1 + (o.vatPercent || 0) / 100) : subtotal
  };
}

/* ---- 1. Жёсткие примеры ---- */

test("Б пример владельца (евро): печатные строки складываются в «Итого без НДС» 1 323,83", () => {
  /* База = сами печатные значения владельца (евро), курс 1: «Итого без НДС» обязан быть их суммой. */
  const t = EPEstimate.totalsShown(estOf({ equipment: 1264.29, discount: 222.77, materials: 73.48, work: 208.83, vatMode: "none" }), 1);
  assert.deepEqual([t.equipment, t.discount, t.materials, t.work], [1264.29, 222.77, 73.48, 208.83], "печатные строки как у владельца");
  assert.equal(t.subtotal, 1323.83, "1 264,29 − 222,77 + 73,48 + 208,83 = 1 323,83");
});

test("Б пример владельца (рубли): печатные строки складываются в «Итого без НДС» 261 343,14", () => {
  const t = EPEstimate.totalsShown(estOf({ equipment: 215640.94, discount: 2377.42, materials: 21384.11, work: 26695.51, vatMode: "none" }), 1);
  assert.equal(t.subtotal, 261343.14, "215 640,94 + 21 384,11 + 26 695,51 − 2 377,42 = 261 343,14");
});

test("Б: сумма округлённых ≠ округление суммы — totalsShown берёт ПЕРВОЕ (ловит мутацию MB1/MB2)", () => {
  /* equipment=materials=work=10,006: каждая строка округляется до 10,01, сумма печатных = 30,03.
     Округление субтотала (round2(30,018)=30,02) дало бы прежний дефект. Работы в сумме ≠ 0, поэтому
     их выпадение (MB2) тоже видно: без работ было бы 20,02. */
  const t = EPEstimate.totalsShown(estOf({ equipment: 10.006, materials: 10.006, work: 10.006, vatMode: "none" }), 1);
  assert.deepEqual([t.equipment, t.materials, t.work], [10.01, 10.01, 10.01], "каждая строка округлена к 10,01");
  assert.equal(t.subtotal, 30.03, "сумма трёх напечатанных по 10,01 = 30,03, не 30,02 (округл. суммы) и не 20,02 (без работ)");
  assert.equal(t.total, 30.03, "без НДС итог равен сумме строк");
});

/* ---- 2. Сплошной перебор ---- */

test("Б: перебор >200 000 — печатные строки = «без НДС», «без НДС» + «НДС» = «Итого»", () => {
  const rates = [1, 92.5, 95.37 * 1.03];
  const percents = [0, 5, 7, 10, 20, 22];
  const modes = ["surcharge", "included", "none"];
  let checked = 0, mismatches = 0;
  for (let i = 0; i < 4000; i++) {
    /* Базовые суммы с сотыми долями копейки (3-й знак варьируется) — именно там прежнее правило
       расходилось. Детерминированно от i, чтобы прогон был воспроизводим. */
    const equipment = i * 0.137 + 0.005;
    const materials = (i % 97) * 0.073 + 0.0025;
    const work = (i % 53) * 0.021 + 0.0075;
    const discount = (i % 13) * 0.11 + 0.0049;
    for (const rate of rates) for (const p of percents) for (const mode of modes) {
      const t = EPEstimate.totalsShown(estOf({ equipment, discount, materials, work, vatMode: mode, vatPercent: p }), rate);
      checked++;
      const rowsSum = round2(t.equipment - t.discount + t.materials + t.work);
      /* Для «начислить сверху» сумма строк = «Итого без НДС»; для «выделить»/«не учитывать» — «Итого». */
      const target = mode === "surcharge" ? t.subtotal : t.total;
      if (rowsSum !== target) mismatches++;
      if (round2(t.subtotal + t.amount) !== t.total) mismatches++;
    }
  }
  assert.equal(mismatches, 0, `перебор ${checked} сочетаний: расхождений 0`);
  assert.ok(checked > 200000, `проверено ${checked} сочетаний (> 200 000)`);
});

/* ---- 3. Одни и те же числа у панели, КП и Excel ---- */

/* КП: вытащить напечатанное значение строки итогов по подписи. */
function kpTotals(est, rate, currency) {
  const moneyShown = n => showMoney(n), money = n => showMoney(Number(n) * rate);
  const html = EPOfferPdf.buildHtml(est, { esc, money, moneyShown, displayRate: () => rate,
    displayCurrency: () => currency, settings: {}, effectiveRate: () => rate,
    options: { prices: true, sections: { plan: false, layout: false, specification: false, lighting: false, supplier: false } },
    postLayout: [], planBlockHtml: "", lightingHtml: "", supplierSpecHtml: "" });
  const grab = re => { const m = html.match(re); return m ? m[1] : null; };
  return {
    equipment: grab(/<span>Оборудование<\/span><b>([^<]*)<\/b>/),
    materials: grab(/<span>Монтажные материалы<\/span><b>([^<]*)<\/b>/),
    work: grab(/<span>Работы<\/span><b>([^<]*)<\/b>/),
    subtotal: grab(/<span>Итого без НДС<\/span><b>([^<]*)<\/b>/),
    grand: grab(/class="grand"><span>Итого[^<]*<\/span><b>([^<]*)<\/b>/)
  };
}

/* Панель: прогнать настоящий renderSummary из app.js и прочитать узлы. */
function panelTotals(est, rate) {
  const dom = stand.makeDom();
  const run = stand.run("renderSummary", {
    state: { rooms: [], devices: [{ id: "d1", roomId: null }], posts: [] },
    EPEstimate, $: dom.$,
    money: v => showMoney(Number(v) * rate), moneyShown: v => showMoney(v), displayRate: () => rate,
    esc: String, projectLighting: () => ({}), buildEstimate: () => est,
    lightingHtml: () => "[L]", updateStatus: () => {}, orphanObjectsWarningText: () => ""
  });
  run();
  return {
    equipment: dom.els.equipmentTotal.textContent, materials: dom.els.materialsTotal.textContent,
    work: dom.els.workTotal.textContent, grand: dom.els.grandTotal.textContent
  };
}

/* Excel: распаковать STORE-ZIP и прочитать числовые ячейки блока итогов по подписям. */
function xlsxTotals(est, rate, currency) {
  const bytes = EPSpecExcel.build(est, EPSupplierSpec.collect({ posts: [], extras: [] }),
    { options: { prices: true }, currency, rate });
  const buf = Buffer.from(bytes);
  let sheet1 = null;
  for (let i = 0; i + 4 <= buf.length;) {
    if (buf.readUInt32LE(i) !== 0x04034b50) break;
    const size = buf.readUInt32LE(i + 18), nlen = buf.readUInt16LE(i + 26), elen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nlen).toString("utf8");
    const start = i + 30 + nlen + elen;
    if (name === "xl/worksheets/sheet1.xml") sheet1 = buf.slice(start, start + size).toString("utf8");
    i = start + size;
  }
  /* Строка итога: <row>…<c><is><t>Подпись</t></is></c><c …><v>число</v></c></row>. Берём число
     ячейки B той строки, где в ячейке A стоит подпись. */
  const rowFor = label => {
    const re = new RegExp(`<is><t[^>]*>${label}<\\/t></is></c><c[^>]*>(?:<f>[^<]*</f>)?<v>([^<]*)</v>`);
    const m = sheet1.match(re);
    return m ? Number(m[1]) : null;
  };
  return {
    equipment: rowFor("Оборудование"), materials: rowFor("Монтажные материалы"), work: rowFor("Работы"),
    subtotal: rowFor("Итого без НДС"), grandWithVat: rowFor("Итого с НДС"), grandNoVat: rowFor("Итого")
  };
}

for (const [currency, rate] of [["EUR", 1], ["RUB", 95.37 * 1.03]]) {
  test(`Б: панель, КП и Excel дают ОДНИ И ТЕ ЖЕ числа (${currency}, surcharge 20%)`, () => {
    /* Суммы с долями копейки, чтобы округление строк имело значение; скидка ненулевая. */
    const est = estOf({ equipment: 1264.285, discount: 222.774, materials: 73.475, work: 208.825, vatMode: "surcharge", vatPercent: 20 });
    const t = EPEstimate.totalsShown(est, rate);

    const kp = kpTotals(est, rate, currency);
    assert.equal(kp.equipment, f2(t.equipment), "КП: оборудование = totalsShown");
    assert.equal(kp.materials, f2(t.materials), "КП: материалы = totalsShown");
    assert.equal(kp.work, f2(t.work), "КП: работы = totalsShown");
    assert.equal(kp.subtotal, f2(t.subtotal), "КП: «Итого без НДС» = totalsShown");
    assert.equal(kp.grand, f2(t.total), "КП: итог = totalsShown");

    const panel = panelTotals(est, rate);
    assert.equal(panel.equipment, f2(t.equipment), "панель: оборудование = КП");
    assert.equal(panel.materials, f2(t.materials), "панель: материалы = КП");
    assert.equal(panel.work, f2(t.work), "панель: работы = КП");
    assert.equal(panel.grand, f2(t.total), "панель: итог = КП");

    const xl = xlsxTotals(est, rate, currency);
    /* Оборудование в Excel — формула SUM с кэшем est.equipment×rate (сырое произведение); на экране
       процессор округлит его НЕЗАВИСИМОЙ эмуляцией excelShow (не round2), и результат обязан совпасть
       с totalsShown. Так тест держит именно «показ Excel = деньги КП», а не тавтологию round2=round2. */
    assert.equal(excelShow(xl.equipment), f2(t.equipment), "Excel: оборудование (показ SUM) = totalsShown");
    assert.equal(f2(xl.materials), f2(t.materials), "Excel: материалы = totalsShown");
    assert.equal(f2(xl.work), f2(t.work), "Excel: работы = totalsShown");
    assert.equal(f2(xl.subtotal), f2(t.subtotal), "Excel: «Итого без НДС» = totalsShown");
    assert.equal(f2(xl.grandWithVat), f2(t.total), "Excel: итог с НДС = totalsShown");
  });
}

/* ---- 4. Строка «Сумма» = «Оборудование» на НАСТОЯЩЕМ пути app.js ---- */

/* НАСТОЯЩИЕ money/moneyShown из app.js (вырезаем исходный const-блок, а не копируем в тест): строка
   «Сумма» спецификации идёт через money(), «Оборудование» — через moneyShown(), и оба обязаны
   применить round2 ровно так, как в приложении. Мутация round2 в app.js:85 (kp.json M13) краснит
   ИМЕННО здесь — на копии стенда она бы не отразилась (§7.1). */
function appMoney(rate, currency) {
  const ctx = { EPEstimate, displayCurrency: () => currency, displayRate: () => rate };
  vm.createContext(ctx);
  return vm.runInContext(
    stand.constBlock("moneyShown") + "\n" + stand.constBlock("money") + "\n;({ money, moneyShown });", ctx);
}

/* Проект из ОДНОЙ позиции: equipment = сумма этой строки, поэтому «Сумма» и «Оборудование» обязаны
   совпасть до копейки. 79,21 € × 92,5 = 7 326,9249… — форматтер без round2 напечатал бы 7 326,92,
   round2 даёт 7 326,93 (ловит M13); 6,01 € × 92,5 = 555,925 → 555,93 (двоичного дребезга тут нет —
   проверяем саму сходимость строки и итога). */
const digitsOf = s => String(s).replace(/[^\d,]/g, "");
for (const [price, exp] of [[6.01, "555,93"], [79.21, "7326,93"]]) {
  test(`Строка «Сумма» = «Оборудование» на настоящем пути app.js (${price} € × 92,5 → ${exp})`, () => {
    const { money, moneyShown } = appMoney(92.5, "RUB");
    const est = EPEstimate.build({
      devices: [{ productId: 1 }], posts: [],
      product: id => (id === 1 ? { id: 1, code: "T", name: "Тестовый товар", price, unit: "шт." } : undefined),
      settings: {}
    });
    const html = EPOfferPdf.buildHtml(est, { esc, money, moneyShown, displayRate: () => 92.5,
      displayCurrency: () => "RUB", settings: {}, effectiveRate: () => 92.5,
      options: { prices: true, sections: { plan: false, layout: false, specification: true, lighting: false, supplier: false } },
      postLayout: [], planBlockHtml: "", lightingHtml: "", supplierSpecHtml: "" });
    const rightCells = [...html.matchAll(/<td class="right">([^<]*)<\/td>/g)].map(m => m[1]);
    const specSum = rightCells[rightCells.length - 1];   // последняя «right»-ячейка строки — «Сумма»
    const equipment = (html.match(/<span>Оборудование<\/span><b>([^<]*)<\/b>/) || [])[1];
    assert.equal(digitsOf(specSum), exp, `строка «Сумма» = ${exp}`);
    assert.equal(digitsOf(equipment), exp, `«Оборудование» = ${exp}`);
    assert.equal(specSum, equipment, "строка «Сумма» и «Оборудование» совпадают до копейки");
  });
}
