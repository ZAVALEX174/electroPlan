/* В26 ч.3б — СУММЫ НЕСКОЛЬКИХ ИЗДЕЛИЙ СКЛАДЫВАЮТСЯ ПО ИЗДЕЛИЯМ (решение владельца 13.10:
   «складывается всё на всех уровнях»). Правило одно — EPEstimate.shownSum / lightingSumShown
   (ядро pricedUnit): каждое изделие округляется в валюту показа ДО сложения, затем Σ. Здесь
   проверяем ЧИСЛАМИ на различимом курсе 92,5 (money ≠ moneyShown) четыре места показа сумм:

     1. само правило shownSum/lightingSumShown (7 × 25,79 € = 16 699,06; 2 × 0,85 € = 157,26);
     2. строка механизмов групп света поста (app.lightingRowSummary) — ловит money(c.sum);
     3. блок «Группы света» (app.lightingHtml → EPLightingPlan) — ловит total от сырого и money→moneyShown;
     4. столбец КП «Стоимость артикулов» (EPOfferPdf) — Σ строк = «Стоимость блока», ловит money(unit×count).

   Мутационная проверка (сломай правило — покраснело ли) — v26.json M18–M22. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");
const EPEstimate = require("../js/estimate.js");
const EPLightingPlan = require("../js/lightingPlan.js");
const EPOfferPdf = require("../js/offerPdf.js");

const RATE = 92.5;
const round2 = EPEstimate.round2;
const ceilRub = n => EPEstimate.roundShown(n, "RUB", "up");
/* ru-RU рублёвое число, как форматирует app.moneyShown в рублях (К7): ЦЕЛЫЙ рубль, без копеек —
   «16 702 ₽». Для сверки точных текстов строки/блока на показе в рублях. */
const fmtRub = n => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(ceilRub(n));

/* Санити (евро-математика ядра, курс 1 vs 92,5): правило «по изделиям» ≠ «одно округление суммой».
   В рублях (К7) та же развилка: по изделиям ceil(Σ ceil(25,79×92,5))=16 702; сырой суммой
   ceil(25,79×7×92,5)=ceil(16 699,025)=16 700 — мутация M20 дала бы 16 700. */
assert.equal(round2(round2(25.79 * RATE) * 7), 16699.06, "7 × round2(25,79×92,5) = 16 699,06 (по изделиям, евро)");
assert.equal(ceilRub(ceilRub(25.79 * RATE) * 7), 16702, "7 × ceil(25,79×92,5) = 16 702 ₽ (по изделиям)");
assert.equal(ceilRub(25.79 * 7 * RATE), 16700, "ceil(7×25,79×92,5) = 16 700 ₽ (одно округление суммой)");

/* ─────────── 1. Ядро правила ─────────── */

test("В26 ч.3б: shownSum складывает НАПЕЧАТАННЫЕ цены (7×25,79 €=16 699,06; 2×0,85 €=157,26)", () => {
  assert.equal(EPEstimate.shownSum([{ price: 25.79, count: 7 }], RATE), 16699.06);
  assert.equal(EPEstimate.shownSum([{ price: 0.85, count: 2 }], RATE), 157.26);
  /* смесь изделий — Σ напечатанных по каждому */
  assert.equal(EPEstimate.shownSum([{ price: 25.79, count: 7 }, { price: 0.85, count: 2 }], RATE), 16856.32);
  /* при курсе 1 (каталог кратен центу) = прежняя сумма сырых евро */
  assert.equal(EPEstimate.shownSum([{ price: 25.79, count: 7 }], 1), round2(25.79 * 7));
  assert.equal(EPEstimate.shownSum([], RATE), 0);
});

test("В26 ч.3б: lightingPlanSumShown — Σ по ВСЕМ местам плана, по изделиям; пустой план/место без товара → 0", () => {
  const plan = { places: Array.from({ length: 7 }, () => ({ product: { price: 25.79 } })) };
  assert.equal(EPEstimate.lightingPlanSumShown(plan, RATE), 16699.06);
  assert.equal(EPEstimate.lightingPlanSumShown(plan, 1), round2(25.79 * 7));
  assert.equal(EPEstimate.lightingPlanSumShown(null, RATE), 0);
  assert.equal(EPEstimate.lightingPlanSumShown({ places: [] }, RATE), 0);
  assert.equal(EPEstimate.lightingPlanSumShown({ places: [{}, { product: null }] }, RATE), 0);
});

test("В26 ч.3б: lightingSumShown — только billable отдельные строки, сумма по изделиям", () => {
  const rows = [
    ...Array.from({ length: 7 }, (_, i) => ({ code: "c" + i, price: 25.79 })),
    { missing: true, price: 1000 },               // пробел — не в сумму (billableLighting)
    { kind: "integrated", price: 500 }            // цельное изделие — не отдельной строкой
  ];
  assert.equal(EPEstimate.lightingSumShown(rows, RATE), 16699.06);
});

/* ─────────── стенд app.js: настоящие money/moneyShown + проверяемая функция в одном vm ─────────── */
function runApp(names, extraCtx) {
  const list = Array.isArray(names) ? names : [names];
  const ctx = Object.assign({ EPEstimate, EPLightingPlan,
    displayRate: () => RATE, displayCurrency: () => "RUB", esc: String }, extraCtx);
  const code = stand.constBlock("moneyShown") + "\n" + stand.constBlock("money") + "\n"
    + list.map(stand.functionSource).join("\n") + "\n;(" + list[list.length - 1] + ");";
  vm.createContext(ctx);
  return vm.runInContext(code, ctx);
}

/* ─────────── 2. Строка механизмов групп света поста ─────────── */

test("В26 ч.3б: строка света поста печатает Σ напечатанных цен (ловит M19: money(c.sum))", () => {
  const lightingRowSummary = runApp("lightingRowSummary");
  const rows = Array.from({ length: 7 }, (_, i) => ({ code: "c" + i, price: 25.79 }));
  const out = lightingRowSummary(rows);
  assert.ok(out && out.text.includes(fmtRub(16702)), `строка печатает ${fmtRub(16702)}, получено: ${out && out.text}`);
  assert.ok(!out.text.includes(fmtRub(16700)), "НЕ округление суммы сырых рублей (16 700)");
});

/* ─────────── 3. Блок «Группы света» ─────────── */

test("В26 ч.3б: блок «Группы света» печатает Σ по изделиям (ловит M20: total от сырого / M21: money→moneyShown)", () => {
  const lightingHtml = runApp(["ambiguityHtml", "lightingHtml"], { lightingSum: () => 180.53 });
  const light = { plan: { groups: [{ label: "Свет", placeCount: 7, rolesRequired: { switch: 7 }, roles: { switch: 7 } }],
    gaps: [], relays: [], totals: { switch: 7 }, places: Array.from({ length: 7 }, () => ({ product: { price: 25.79 } })) },
    ambiguous: [] };
  const html = lightingHtml(light, "Группы света");
  assert.ok(html.includes(fmtRub(16702)), `блок печатает ${fmtRub(16702)}`);
  assert.ok(!html.includes(fmtRub(16700)), "НЕ округление суммы сырых рублей");
});

/* ─────────── 4. КП: столбец «Стоимость артикулов» = «Стоимость блока» ─────────── */

test("В26 ч.3б: Σ столбца «Стоимость артикулов» = «Стоимость блока» (ловит M22: money(unit×count))", () => {
  /* Распознаваемые заглушки: moneyShown — число как есть, money — ×курс (как offerTotalsConsistency).
     itemPrices приходят в ЕВРО (postPricedItems), p.price — цена поста УЖЕ в валюте показа (postTotalCost). */
  const moneyShown = n => "R" + round2(n).toFixed(2);
  const money = n => "R" + round2(Number(n) * RATE).toFixed(2);
  const items = [{ code: "A", name: "Коробка", count: 2, price: 0.85 }, { code: "B", name: "Выключатель", count: 7, price: 25.79 }];
  /* Рубли (К7): цена изделия вверх до рубля (0,85×92,5=78,625→79; 25,79×92,5=2385,575→2386), сумма
     строки = цена×кол (целая): 79×2=158, 2386×7=16 702; «Стоимость блока» = Σ = 16 860. */
  const blockPrice = ceilRub(items.reduce((s, it) => s + ceilRub(it.price * RATE) * it.count, 0));   // 16 860
  const html = EPOfferPdf.buildHtml(
    { groups: [], equipment: 0, missing: [], discount: 0, materials: 0, work: 0, vat: 0 },
    { esc: String, money, moneyShown, EPEstimate, displayRate: () => RATE, displayCurrency: () => "RUB",
      settings: {}, effectiveRate: () => RATE,
      options: { prices: true, articles: true,
        sections: { plan: false, layout: true, specification: false, lighting: false, supplier: false },
        layout: { number: true, fill: false, modules: false, box: false, article: false,
          illustration: false, price: true, itemPrices: true } },
      postLayout: [{ number: 1, price: blockPrice, itemPrices: items }],
      planBlockHtml: "", lightingHtml: "", supplierSpecHtml: "" });
  /* Суммы строк разбивки — правые части «= R…». */
  const sums = [...html.matchAll(/= R([\d.]+)/g)].map(m => Number(m[1]));
  assert.deepEqual(sums, [158, 16702], `строки разбивки: ${JSON.stringify(sums)}`);
  assert.equal(round2(sums.reduce((a, b) => a + b, 0)), blockPrice, "Σ строк = «Стоимость блока»");
  /* «Стоимость блока» печатается moneyShown (одно применение курса) той же цифрой. */
  assert.ok(html.includes("R" + blockPrice.toFixed(2)), `«Стоимость блока» = R${blockPrice.toFixed(2)}`);
});

/* ─────────── A16: «Стоимость артикулов», изделие в количестве 1 шт. ───────────
   У ветки count === 1 нет множителя и итога «= …» — печатается просто «Наименование — цена штуки».
   Цена штуки приходит в ЕВРО (p.itemPrices из build), поэтому её печатает money() (× курс, валюта
   показа) ОДИН раз. Мутация M27 (money→moneyShown) напечатала бы сырое евро как рубли: 0,85 вместо
   78,63. Столбец «Стоимость блока» (price) выключаем — тогда цена показа встречается в HTML только
   в разбивке артикулов, и сравнение не ловит её из соседней ячейки. */
test("В26 A16: «Стоимость артикулов» — изделие 1 шт. печатает цену в валюте показа ОДИН раз (ловит M27)", () => {
  const moneyShown = n => "R" + round2(n).toFixed(2);
  const money = n => "R" + round2(Number(n) * RATE).toFixed(2);
  const items = [{ code: "A", name: "Монтажная коробка", count: 1, price: 0.85 }];   // 0,85 € × 92,5 = 78,63
  const html = EPOfferPdf.buildHtml(
    { groups: [], equipment: 0, missing: [], discount: 0, materials: 0, work: 0, vat: 0 },
    { esc: String, money, moneyShown, EPEstimate, displayRate: () => RATE, displayCurrency: () => "RUB",
      settings: {}, effectiveRate: () => RATE,
      options: { prices: true, articles: true,
        sections: { plan: false, layout: true, specification: false, lighting: false, supplier: false },
        layout: { number: true, fill: false, modules: false, box: false, article: false,
          illustration: false, price: false, itemPrices: true } },
      postLayout: [{ number: 1, itemPrices: items }],
      planBlockHtml: "", lightingHtml: "", supplierSpecHtml: "" });
  assert.ok(html.includes("R78.63"), `изделие 1 шт. печатает цену показа money(0,85 €) = R78.63; html: ${html}`);
  assert.ok(!html.includes("R0.85"), "НЕ сырое евро moneyShown(unit) = R0.85 (мутация money→moneyShown)");
});
