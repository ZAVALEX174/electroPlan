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
/* buildEstimate/renderSummary (app.js) ссылаются на EPPackTopUp (добор упаковок, К6б) — настоящий модуль. */
const EPPackTopUp = require("../js/packTopUp.js");
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

/* est в форме EPEstimate.build. В26 (решение владельца 13.10): «Оборудование» и суммы строк — ПО
   ИЗДЕЛИЯМ (specShown), а «Скидка»/«Материалы»/«Работы» — процент от напечатанного «Оборудования»
   (totalsShown), а не готовые евро × курс. Поэтому на вход идут ПРОЦЕНТЫ (discountPercent /
   materialsPercent / workPercent), а не суммы: estOf собирает одну строку, у которой цена изделия =
   equipment (при rate=1 её напечатанная сумма = equipment). est.discount/materials/work/vat остаются
   лишь признаком показа строки (КП/Excel гейтят «Скидку» по est.discount, строки НДС — по est.vat); в
   арифметику печати они не входят. est.subtotal НЕ задаём: его читает только мутация MB1, и его
   отсутствие делает ловушку MB1 строго красной. */
function estOf(o) {
  const equipment = o.equipment;
  const groups = o.groups || [{ name: "P", count: 1, unit: "компл.",
    discountPersonal: !!o.discountPersonal, discountPercent: o.discountPercent || 0,
    items: [{ kind: "mechanism", name: "P", code: "X", count: 1, price: equipment }] }];
  return {
    groups, equipment, missing: [],
    discountPercent: o.discountPercent || 0, discountMixed: false,
    materialsPercent: o.materialsPercent || 0, workPercent: o.workPercent || 0,
    discount: o.discountPercent ? 1 : 0, materials: 1, work: 1,
    vatMode: o.vatMode || "none", vatPercent: o.vatPercent || 0,
    vat: (o.vatMode === "surcharge" || o.vatMode === "included") ? 1 : 0,
    vatIncluded: o.vatMode === "included",
    vatLabel: o.vatMode === "included" ? "в т.ч. НДС" : o.vatMode === "surcharge" ? "НДС" : ""
  };
}

/* ---- 1. Жёсткие примеры ---- */

test("Б/В26 (евро): печатные строки (процент от «Оборудования») складываются в «Итого без НДС» 1 445,08", () => {
  /* Оборудование 1264,29 €, общая скидка 10 %, материалы 20 % и работы 7 % от «Оборудование − Скидка»,
     курс 1. На калькуляторе независимо: скидка 126,43; нетто 1137,86; материалы 227,57; работы 79,65;
     «Итого без НДС» = 1264,29 − 126,43 + 227,57 + 79,65 = 1445,08. */
  const t = EPEstimate.totalsShown(estOf({ equipment: 1264.29, discountPercent: 10, materialsPercent: 20, workPercent: 7, vatMode: "none" }), 1);
  assert.deepEqual([t.equipment, t.discount, t.materials, t.work], [1264.29, 126.43, 227.57, 79.65], "каждая строка = процент от напечатанного «Оборудования»");
  assert.equal(t.subtotal, round2(t.equipment - t.discount + t.materials + t.work), "сумма четырёх печатных строк = «Итого без НДС»");
  assert.equal(t.subtotal, 1445.08, "1 264,29 − 126,43 + 227,57 + 79,65 = 1 445,08");
});

test("Б/В26 (рубли): печатные строки складываются в «Итого без НДС» 260 451,12", () => {
  const t = EPEstimate.totalsShown(estOf({ equipment: 215640.94, discountPercent: 1, materialsPercent: 10, workPercent: 12, vatMode: "none" }), 1);
  assert.equal(t.subtotal, round2(t.equipment - t.discount + t.materials + t.work), "сумма печатных строк = «Итого без НДС»");
  assert.equal(t.subtotal, 260451.12, "215 640,94 − 2 156,41 + 21 348,45 + 25 618,14 = 260 451,12");
});

test("Б: сумма округлённых ≠ округление суммы — totalsShown берёт ПЕРВОЕ (ловит мутацию MB1/MB2)", () => {
  /* Оборудование 10,006 → печатается 10,01 (specShown округляет изделие по В26); материалы и работы по
     100 % от нетто 10,01 → по 10,01. Сумма печатных = 30,03. MB1 (shownBase = round2(est.subtotal×курс))
     даёт 0 — est.subtotal не задан; MB2 (работы выпадают) даёт 20,02. Оба ≠ 30,03 и краснеют. */
  const t = EPEstimate.totalsShown(estOf({ equipment: 10.006, materialsPercent: 100, workPercent: 100, vatMode: "none" }), 1);
  assert.deepEqual([t.equipment, t.materials, t.work], [10.01, 10.01, 10.01], "каждая строка округлена к 10,01");
  assert.equal(t.subtotal, 30.03, "сумма трёх напечатанных по 10,01 = 30,03, не 0 (MB1) и не 20,02 (MB2)");
  assert.equal(t.total, 30.03, "без НДС итог равен сумме строк");
});

test("В26: личная скидка округляется ПОСТРОЧНО, не один раз суммой (ловит мутацию M10)", () => {
  /* Две личные строки по 10,10 € × 5 % = 0,505 — каждая округляется до 0,51, «Скидка» = 1,02.
     Округление ОДНИМ числом (0,505 + 0,505 = 1,01 → 1,01) разошлось бы с калькулятором по строкам. */
  const g1 = { name: "A", count: 1, unit: "компл.", discountPersonal: true, discountPercent: 5,
    items: [{ kind: "mechanism", name: "A", code: "X", count: 1, price: 10.10 }] };
  const g2 = { name: "B", count: 1, unit: "компл.", discountPersonal: true, discountPercent: 5,
    items: [{ kind: "mechanism", name: "B", code: "Y", count: 1, price: 10.10 }] };
  const t = EPEstimate.totalsShown(estOf({ equipment: 20.20, groups: [g1, g2], discountPercent: 0, vatMode: "none" }), 1);
  assert.equal(t.discount, 1.02, "0,51 + 0,51 построчно = 1,02, не 1,01 (округление суммы)");
});

test("В26: общая скидка — от «Оборудования» БЕЗ строк с личной скидкой (ловит мутацию M11)", () => {
  /* Личная строка 100,00 € (50 %) и обычная 100,00 € при общей 10 %. Личная из базы общей исключена:
     общая 10 % от 100,00 = 10,00; личная 50,00; «Скидка» = 60,00. Не исключить личную — общая считалась
     бы от 200,00 → 20,00, и «Скидка» вышла бы 70,00. */
  const pers = { name: "P", count: 1, unit: "компл.", discountPersonal: true, discountPercent: 50,
    items: [{ kind: "mechanism", name: "P", code: "X", count: 1, price: 100 }] };
  const gen = { name: "G", count: 1, unit: "компл.", discountPersonal: false, discountPercent: 10,
    items: [{ kind: "mechanism", name: "G", code: "Y", count: 1, price: 100 }] };
  const t = EPEstimate.totalsShown(estOf({ equipment: 200, groups: [pers, gen], discountPercent: 10, vatMode: "none" }), 1);
  assert.equal(t.discount, 60, "10 % от 100 (без личной) + 50 % от 100 = 60, не 70");
});

test("В26: строка с ЛИЧНОЙ скидкой 0 % НЕ попадает под общую (ловит мутацию M25)", () => {
  /* Две строки по 100,00 €, общая скидка 10 %, у ОДНОЙ строки личная 0 % («без скидки на эту позицию»).
     Личная 0 % — это тоже personal: строку из базы общей скидки надо исключить, но личной скидки с неё
     ноль. Поэтому «Скидка» = 10 % только от второй строки = 10,00. Мутация M25 (гейт `… && clampPercent>0`)
     перестаёт считать 0 %-строку личной — она уходит в базу общей, и «Скидка» вышла бы 20,00. */
  const zero = { name: "Z", count: 1, unit: "компл.", discountPersonal: true, discountPercent: 0,
    items: [{ kind: "mechanism", name: "Z", code: "X", count: 1, price: 100 }] };
  const gen = { name: "G", count: 1, unit: "компл.", discountPersonal: false, discountPercent: 10,
    items: [{ kind: "mechanism", name: "G", code: "Y", count: 1, price: 100 }] };
  const t = EPEstimate.totalsShown(estOf({ equipment: 200, groups: [zero, gen], discountPercent: 10, vatMode: "none" }), 1);
  assert.equal(t.discount, 10, "общая 10 % только от строки без личной (10,00), личная 0 % исключена — не 20,00");

  /* Зеркальный случай: личная 100 % у одной строки (мутацию не трогает — у неё процент > 0, — но держит
     смысл «личная исключена из общей базы»): 100 % от 100,00 = 100,00 плюс общая 10 % от второй = 10,00. */
  const full = { name: "F", count: 1, unit: "компл.", discountPersonal: true, discountPercent: 100,
    items: [{ kind: "mechanism", name: "F", code: "Z", count: 1, price: 100 }] };
  const t2 = EPEstimate.totalsShown(estOf({ equipment: 200, groups: [full, gen], discountPercent: 10, vatMode: "none" }), 1);
  assert.equal(t2.discount, 110, "личная 100 % (100,00) + общая 10 % от остальной 100,00 (10,00) = 110,00");
});

/* ---- 2. Сплошной перебор ---- */

test("Б: перебор >200 000 — печатные строки = «без НДС», «без НДС» + «НДС» = «Итого»", () => {
  const rates = [1, 92.5, 95.37 * 1.03];
  const percents = [0, 5, 7, 10, 20, 22];
  const modes = ["surcharge", "included", "none"];
  let checked = 0, mismatches = 0;
  for (let i = 0; i < 4000; i++) {
    /* Оборудование с сотыми долями копейки (specShown округлит его до копейки), а скидка/материалы/
       работы задаются ПРОЦЕНТАМИ (В26) — их произведения дают собственный дребезг 3-го знака, именно
       там прежнее правило расходилось. Детерминированно от i, чтобы прогон был воспроизводим. */
    const equipment = i * 0.137 + 0.005;
    const materialsPercent = (i % 7) * 3.5;     // 0; 3,5; …; 21
    const workPercent = (i % 5) * 4;            // 0; 4; …; 16
    const discountPercent = (i % 11) * 2.5;     // 0; 2,5; …; 25
    for (const rate of rates) for (const p of percents) for (const mode of modes) {
      const t = EPEstimate.totalsShown(estOf({ equipment, discountPercent, materialsPercent, workPercent, vatMode: mode, vatPercent: p }), rate);
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
function panelTotals(est, rate, currency) {
  const dom = stand.makeDom();
  const run = stand.run("renderSummary", {
    state: { rooms: [], devices: [{ id: "d1", roomId: null }], posts: [] },
    EPEstimate, EPPackTopUp, $: dom.$,
    money: v => showMoney(Number(v) * rate), moneyShown: v => showMoney(v),
    displayRate: () => rate, displayCurrency: () => currency,
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
    /* Оборудование с долями копейки, проценты ненулевые (В26: строки — процент от «Оборудования»). */
    const est = estOf({ equipment: 1264.285, discountPercent: 10, materialsPercent: 20, workPercent: 7, vatMode: "surcharge", vatPercent: 20 });
    const t = EPEstimate.totalsShown(est, rate, currency);

    const kp = kpTotals(est, rate, currency);
    assert.equal(kp.equipment, f2(t.equipment), "КП: оборудование = totalsShown");
    assert.equal(kp.materials, f2(t.materials), "КП: материалы = totalsShown");
    assert.equal(kp.work, f2(t.work), "КП: работы = totalsShown");
    assert.equal(kp.subtotal, f2(t.subtotal), "КП: «Итого без НДС» = totalsShown");
    assert.equal(kp.grand, f2(t.total), "КП: итог = totalsShown");

    const panel = panelTotals(est, rate, currency);
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
  const ctx = { EPEstimate, EPPackTopUp, displayCurrency: () => currency, displayRate: () => rate };
  vm.createContext(ctx);
  return vm.runInContext(
    stand.constBlock("moneyShown") + "\n" + stand.constBlock("money") + "\n;({ money, moneyShown });", ctx);
}

/* Проект из ОДНОЙ позиции: equipment = сумма этой строки, поэтому «Сумма» и «Оборудование» обязаны
   совпасть. В рублях (К7) — ЦЕЛЫЙ рубль ВВЕРХ: 6,01 € × 92,5 = 555,925 → 556; 79,21 € × 92,5 =
   7 326,9249… → 7 327. Проверяем саму сходимость строки спецификации и итога на НАСТОЯЩЕМ пути app.js. */
const digitsOf = s => String(s).replace(/[^\d,]/g, "");
for (const [price, exp] of [[6.01, "556"], [79.21, "7327"]]) {
  test(`Строка «Сумма» = «Оборудование» на настоящем пути app.js (${price} € × 92,5 → ${exp} ₽)`, () => {
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

/* Контракт app.js moneyShown (app.js:85): форматирует УЖЕ-показанное число, СНЯВ двоичный дребезг
   через EPEstimate.roundShown. В ЕВРО (путь копеек не менялся в К7) это round2: moneyShown обязан
   округлять ЛЮБОЙ вход — им форматируются и цены через money() (сырое евро × курс, см. окно поста/
   подсказку). Проверяем на дробном произведении напрямую: ловит мутацию M13 (moneyShown печатает
   сырой double мимо округления). Валюта — EUR: именно евро-копейка держит этот дребезг (в рублях
   число целое, и дребезг незаметен — отдельная граница ceilRub проверена в estimate.test.js). */
test("app.js moneyShown: округляет вход до копейки перед показом (ловит M13)", () => {
  const { moneyShown } = appMoney(1, "EUR");
  /* 79,21 € × 92,5 = 7 326,9249… в double: round2 → 7 326,93; Intl без round2 напечатал бы 7 326,92. */
  assert.equal(digitsOf(moneyShown(79.21 * 92.5)), "7326,93", "moneyShown снимает двоичный дребезг (round2)");
});

/* ---- 5. Панель «Стоимость проекта»: сумма строки спецификации печатается из specShown ----
   Строка списка спецификации в панели печатает сумму строки через moneyShown(spec.rows[i].sum) — то же
   «по изделиям», что «Оборудование» и «Сумма» строк КП/Excel. Прежний путь money(g.sum) брал СЫРОЕ евро
   строки build и умножал на курс ещё раз — на дробном курсе это расходилось со «Σ по изделиям» на пол-
   копейки. Прогоняем НАСТОЯЩИЙ renderSummary из app.js (стенд appStand) с НАСТОЯЩИМИ money/moneyShown,
   вырезанными из app.js, на входе с половинкой копейки: 15 × 68,07 € при курсе 95,5. В рублях (К7)
   цена изделия ВВЕРХ до рубля: ceil(68,07×95,5)=6 501, сумма = ceil(6 501×15)=97 515 ₽. Старый
   money(g.sum) дал бы ceil(1021,05×95,5)=97 511 — на 4 рубля меньше. Ловит мутацию M26 (money(g.sum)). */
test("В26 A14: панель — сумма строки спецификации и «Оборудование» = Σ по изделиям (ловит M26)", () => {
  const rate = 95.5;
  const { money, moneyShown } = appMoney(rate, "RUB");
  const est = EPEstimate.build({
    devices: Array.from({ length: 15 }, () => ({ productId: 1 })), posts: [],
    product: id => (id === 1 ? { id: 1, code: "X", name: "Светильник", price: 68.07, unit: "шт." } : undefined),
    settings: {}
  });
  const dom = stand.makeDom();
  const run = stand.run("renderSummary", {
    state: { rooms: [], devices: [], posts: [] },
    EPEstimate, EPPackTopUp, $: dom.$, money, moneyShown, displayRate: () => rate, displayCurrency: () => "RUB",
    esc: String, projectLighting: () => ({}), buildEstimate: () => est,
    lightingHtml: () => "[L]", updateStatus: () => {}, orphanObjectsWarningText: () => ""
  });
  run();
  const rowSum = (dom.els.specList.innerHTML.match(/<b>([^<]*)<\/b>/) || [])[1];
  assert.equal(rowSum, moneyShown(97515), "строка спецификации = Σ по изделиям (97 515 ₽)");
  assert.equal(dom.els.equipmentTotal.textContent, moneyShown(97515), "«Оборудование» = та же сумма");
  /* Старый путь money(g.sum) напечатал бы ceilRub(сырое евро строки × курс) — на 4 рубля меньше. */
  assert.notEqual(rowSum, money(est.groups[0].sum), "НЕ money(g.sum) (97 511 ₽)");
});
