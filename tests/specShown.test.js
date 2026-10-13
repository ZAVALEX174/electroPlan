/* В26 — «как в обычном счёте» (решение владельца 13.10). Печатные числа спецификации считаются ПО
   ИЗДЕЛИЯМ состава: цена изделия показа = round2(цена € × курс); цена строки = Σ(цена изделия × число
   в одной единице); сумма строки = round2(цена строки × количество); «Оборудование» = round2(Σ сумм).
   Инвариант владельца: «Количество × Цена» каждой строки даёт ровно её «Сумму», а «Суммы» всех строк в
   сложении — ровно «Оборудование», до копейки, при любом курсе и количестве.

   Правило живёт в ОДНОЙ функции EPEstimate.specShown; totalsShown берёт оттуда «Оборудование».
   Зелёный ≠ проверено (§7.1): мутации (tools/qa/mutations/v26.json) — в отчёте. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const EPEstimate = require("../js/estimate.js");

const K = v => Math.round(EPEstimate.round2(v) * 100);   // в целые копейки

/* ---- 1. Три примера владельца (из проверенных фактов разведки) ---- */

test("specShown: пост из 4 изделий при курсе 92,5 — цена 39 372,64 (по изделиям, не 39 372,63 целиком)", () => {
  /* накладка 188,75 + механизм 229,85 + суппорт 6,20 + коробка 0,85. По изделиям каждое округляется
     отдельно: 17 459,38 + 21 261,13 + 573,50 + 78,63 = 39 372,64. Округление ЦЕЛОЙ цены поста
     (425,65 × 92,5 = 39 372,625) дало бы 39 372,63 — мутация «округляется целиком» краснеет здесь. */
  const items = [{ code: "a", count: 1, price: 188.75 }, { code: "b", count: 1, price: 229.85 },
    { code: "c", count: 1, price: 6.20 }, { code: "d", count: 1, price: 0.85 }];
  const s1 = EPEstimate.specShown({ groups: [{ count: 1, items }] }, 92.5);
  assert.equal(s1.rows[0].price, 39372.64, "цена строки по изделиям");
  assert.equal(s1.rows[0].sum, 39372.64, "сумма при 1 шт");
  assert.equal(s1.equipment, 39372.64, "оборудование");
  assert.equal(EPEstimate.specShown({ groups: [{ count: 10, items }] }, 92.5).rows[0].sum, 393726.40, "×10");
  assert.equal(EPEstimate.specShown({ groups: [{ count: 50, items }] }, 92.5).rows[0].sum, 1968632.00, "×50");
});

test("specShown: изделие 68,07 € × 15 при курсе 95,5 — цена 6 500,69, сумма 97 510,35, оборудование 97 510,35", () => {
  const s = EPEstimate.specShown({ groups: [{ count: 15, items: [{ code: "x", count: 1, price: 68.07 }] }] }, 95.5);
  assert.equal(s.rows[0].price, 6500.69, "цена строки");
  assert.equal(s.rows[0].sum, 97510.35, "сумма = цена × 15");
  assert.equal(s.equipment, 97510.35, "оборудование = сумма единственной строки");
});

test("specShown: изделие 10,17 € при курсе 92,5 — цена 940,73 и при 1, и при 22 шт; сумма на 22 = 20 696,06", () => {
  const items = [{ code: "y", count: 1, price: 10.17 }];
  assert.equal(EPEstimate.specShown({ groups: [{ count: 1, items }] }, 92.5).rows[0].price, 940.73, "цена @1");
  const s22 = EPEstimate.specShown({ groups: [{ count: 22, items }] }, 92.5);
  assert.equal(s22.rows[0].price, 940.73, "цена @22 — та же (цена за единицу не зависит от количества)");
  assert.equal(s22.rows[0].sum, 20696.06, "сумма @22");
});

/* ---- 2. «Оборудование» totalsShown берёт из specShown (мутация est.equipment×курс краснеет) ---- */

test("totalsShown: «Оборудование» = Σ сумм строк по изделиям (68,07 × 15 @95,5 → 97 510,35, не 97 510,27)", () => {
  /* est.equipment (сырое евро) = 15 × 68,07 = 1021,05; round2(1021,05 × 95,5) = 97 510,27 — ПРЕЖНЕЕ
     «Оборудование» мимо строк. По изделиям — 97 510,35. totalsShown обязан дать второе. */
  const est = { groups: [{ count: 15, items: [{ code: "x", count: 1, price: 68.07 }] }],
    equipment: 1021.05, discount: 0, materials: 0, work: 0, vatMode: "none" };
  const t = EPEstimate.totalsShown(est, 95.5);
  assert.equal(t.equipment, 97510.35, "оборудование из specShown");
  assert.notEqual(t.equipment, EPEstimate.round2(est.equipment * 95.5), "НЕ round2(est.equipment × курс)");
});

/* ---- 3. Устойчивость к мусору: 0 и пустота, а не NaN ---- */

test("specShown: цена 0, пустой состав, отсутствие groups — нули, без NaN", () => {
  assert.deepEqual(EPEstimate.specShown({ groups: [] }, 92.5), { rows: [], equipment: 0 });
  assert.deepEqual(EPEstimate.specShown(null, 92.5), { rows: [], equipment: 0 });
  const zero = EPEstimate.specShown({ groups: [{ count: 3, items: [{ code: "z", count: 1, price: 0 }] }] }, 95.5);
  assert.equal(zero.rows[0].price, 0); assert.equal(zero.rows[0].sum, 0); assert.equal(zero.equipment, 0);
  const noItems = EPEstimate.specShown({ groups: [{ count: 5 }] }, 95.5);   // строка без состава
  assert.equal(noItems.rows[0].price, 0, "строке без состава правило даёт 0, а не NaN");
  assert.ok(!Number.isNaN(noItems.equipment));
  const noPrice = EPEstimate.specShown({ groups: [{ count: 2, items: [{ code: "m", count: 1 }] }] }, 92.5);
  assert.equal(noPrice.rows[0].sum, 0, "изделие без цены (позиция без товара) стоит 0");
});

/* ---- 4. Инвариант «Кол × Цена = Сумма» и «Σ сумм = Оборудование» — целочисленный перебор ----
   На НАСТОЯЩИХ ценах каталога VIMAR, в составах из нескольких изделий, количества 1..200, курсы из
   жизни. Сравниваем в ЦЕЛЫХ КОПЕЙКАХ — точное равенство, не «около». */
test("specShown: Кол × Цена = Сумма и Σ сумм = Оборудование — перебор на ценах каталога (копейки)", () => {
  const products = stand.loadVimarCatalog().products;
  const priced = products.filter(p => Number(p.price) > 0).map(p => Number(p.price));
  assert.ok(priced.length > 1000, "каталог загрузился");
  const rates = [1, 92.5, 95.5, 96.25, 100.5, 95.313522];
  let seed = 20261013; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = a => a[Math.floor(rnd() * a.length)];
  let checks = 0, kolCena = 0, equipMism = 0;
  for (let iter = 0; iter < 2000; iter++) {
    const nGroups = 1 + Math.floor(rnd() * 4);
    const groups = [];
    for (let g = 0; g < nGroups; g++) {
      const nItems = 1 + Math.floor(rnd() * 5);
      const items = [];
      for (let k = 0; k < nItems; k++) items.push({ code: "c" + k, count: 1 + Math.floor(rnd() * 3), price: pick(priced) });
      groups.push({ count: 1 + Math.floor(rnd() * 200), items });
    }
    for (const rate of rates) {
      const s = EPEstimate.specShown({ groups }, rate);
      let sumCents = 0;
      s.rows.forEach((row, i) => {
        checks++;
        if (K(row.price) * groups[i].count !== K(row.sum)) kolCena++;   // Кол × Цена = Сумма, точно
        sumCents += K(row.sum);
      });
      if (sumCents !== K(s.equipment)) equipMism++;                      // Σ сумм = Оборудование, точно
    }
  }
  assert.equal(kolCena, 0, `Кол × Цена = Сумма во всех ${checks} строках`);
  assert.equal(equipMism, 0, "Σ сумм = Оборудование во всех проектах");
  assert.ok(checks > 10000, `проверено ${checks} строк`);
});

/* ---- 5. Евро не меняется против HEAD: отображаемые суммы строк и «Оборудование» те же ----
   В евро (курс 1) цены каталога уже с точностью до копейки, поэтому round2 по изделиям и сложение
   дают ровно сырую цену строки build. НАСТОЯЩИЙ EPEstimate.build на каталоге VIMAR: каждая строка
   сметы в евро показывается как раньше, итог «Оборудование» = est.equipment. */
test("specShown: евро (курс 1) — суммы строк и «Оборудование» равны сырым значениям build (== HEAD)", () => {
  const products = stand.loadVimarCatalog().products;
  const product = id => products.find(p => Number(p.id) === Number(id));
  const pool = products.filter(p => (p.kind === "mechanism" || p.kind === "frame") && p.active && Number(p.price) > 0);
  let seed = 4242; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let projects = 0, rowMism = 0, equipMism = 0;
  for (let iter = 0; iter < 400; iter++) {
    const devices = [];
    const n = 1 + Math.floor(rnd() * 8);
    for (let i = 0; i < n; i++) devices.push({ productId: pool[Math.floor(rnd() * pool.length)].id });
    const est = EPEstimate.build({ devices, posts: [], product, frameProduct: product, postCost: () => 0, settings: {} });
    projects++;
    const s = EPEstimate.specShown(est, 1);
    s.rows.forEach((row, i) => { if (K(row.sum) !== K(est.groups[i].sum)) rowMism++; });
    if (K(s.equipment) !== K(est.equipment)) equipMism++;
  }
  assert.equal(rowMism, 0, "сумма каждой строки в евро не изменилась");
  assert.equal(equipMism, 0, "«Оборудование» в евро не изменилось");
  assert.ok(projects > 300, `проверено ${projects} проектов`);
});
