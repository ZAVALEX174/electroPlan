/* Добор до целых упаковок (К6б) — смета, панель итогов, карта упаковок. Проверяем чистую логику
   EPPackTopUp, её встройку в EPEstimate.build/totalsShown/specShown и перерисовку панели галкой.
   Запуск: node --test tests/packTopUp.test.js

   Тесты из разведки §Тесты: (а) галка снята → числа байт в байт прежние; (б) добор = packRound(Σ,pack)−Σ
   по постам и изделиям; (в) итог = оборудование − скидка + материалы + работы в € и ₽; (г) общая скидка
   на добор есть, личная поста — нет, материалы/работы от базы БЕЗ добора; (д) сверка Σ по артикулам сметы
   со сводом EPSupplierSpec.collect; (е) цена поста при включённой галке не меняется; (ж) галка
   перерисовывает панель. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const EPEstimate = require("../js/estimate.js");
const EPPackTopUp = require("../js/packTopUp.js");
const EPPackRound = require("../js/packRound.js");
const EPSupplierSpec = require("../js/supplierSpec.js");
const EPPackMultiple = require("../js/packMultipleUi.js");

/* --- Фикстура проекта: один одиночный выключатель + два одинаковых 2-клавишных поста. Артикулы и цены
   с десятичными — чтобы ловить ошибки округления (К7). --- */
const MECH = { id: 10, code: "20001.0", name: "Выключатель 1 клавиша", price: 25.79, unit: "шт." };
const FRAME = { id: 20, code: "20657", name: "Рамка 2 поста", price: 10.4, unit: "шт." };
const BOX = { code: "V71301", name: "Коробка 3 модуля", price: 1.5 };
const SUP = { code: "20811", name: "Суппорт 2 модуля", price: 0.85 };

const catalog = { 10: MECH, 20: FRAME };
const product = id => catalog[Number(id)] || undefined;
const frameProduct = id => catalog[Number(id)] || undefined;
/* Состав поста: 1 коробка, 1 суппорт, точная рамка (frameAvailability — как в приложении). */
const comp = {
  box: BOX, boxCount: 1, support: SUP, supportCount: 1, supportAssumed: false,
  frameAvailability: { frame: FRAME, missing: false, unset: false, displayName: FRAME.name }
};
const postComposition = () => comp;
/* postCost — цена собственного состава поста (2 механизма + рамка + коробка + суппорт). Для теста
   числовое значение неважно само по себе, важно, что оно одинаково для обоих постов. */
const postCost = po => (po.mechanismIds || []).reduce((s, id) => s + (product(id) ? product(id).price : 0), 0)
  + FRAME.price + BOX.price * comp.boxCount + SUP.price * comp.supportCount;

const post = () => ({ frameId: 20, mechanismIds: [10, 10], name: "Пост" });

function buildWith(extra) {
  return EPEstimate.build(Object.assign({
    devices: [{ productId: 10 }],
    posts: [post(), post()],
    product, frameProduct, postCost, postComposition,
    settings: { discountPercent: 0, materialsPercent: 0, workPercent: 0 }
  }, extra || {}));
}

/* Карта упаковок: механизм по 10, коробка по 100, суппорт по 50, рамка по 1 (=1 → добора нет). */
const packs = EPPackTopUp.buildPackMap([
  { code: "20001.0", packQty: 10 },
  { code: "V71301", packQty: 100 },
  { code: "20811", packQty: 50 },
  { code: "20657", packQty: 1 }
]);

/* Σ по артикулам проекта из готовой сметы (без добора): по всем группам g.count × item.count. */
function sumsByCode(est) {
  const m = new Map();
  (est.groups || []).forEach(g => {
    if (g.topUp) return;
    (g.items || []).forEach(it => {
      if (!it.code || !(Number(it.price) > 0) || !(it.count > 0)) return;
      const k = EPPackTopUp.codeKey(it.code);
      m.set(k, (m.get(k) || 0) + g.count * it.count);
    });
  });
  return m;
}

test("(б) добор = packRound(Σ,pack) − Σ по постам и одиночным изделиям", () => {
  const est = buildWith({ packMultiple: true, packs });
  const sums = sumsByCode(est);
  /* Σ: выключатель 1 (изделие) + 2 поста × 2 = 5; коробка 2 поста × 1 = 2; суппорт 2; рамка 2. */
  assert.equal(sums.get("20001.0"), 5, "Σ выключателя 5 (изделие + два поста)");
  assert.equal(sums.get("V71301"), 2, "Σ коробок 2");
  assert.equal(sums.get("20811"), 2, "Σ суппортов 2");
  assert.equal(sums.get("20657"), 2, "Σ рамок 2");

  const topUp = est.groups.filter(g => g.topUp);
  const byCode = new Map(topUp.map(g => [g.items[0].code, g]));
  /* Добавлено = packRound(Σ,pack) − Σ: выключатель 10−5=5; коробка 100−2=98; суппорт 50−2=48. */
  assert.equal(byCode.get("20001.0").count, 5, "выключатель: 10 − 5 = 5");
  assert.equal(byCode.get("V71301").count, 98, "коробка: 100 − 2 = 98");
  assert.equal(byCode.get("20811").count, 48, "суппорт: 50 − 2 = 48");
  assert.ok(!byCode.has("20657"), "рамка pack=1 → добора нет строки");
  /* Цена штуки добора — каталожная цена артикула (евро). */
  assert.equal(byCode.get("20001.0").items[0].price, 25.79);
  assert.equal(byCode.get("20001.0").sum, 5 * 25.79);
});

test("(а) галка снята → est, specShown и totalsShown байт в байт как без упаковок", () => {
  const off = buildWith({ packMultiple: false, packs });
  const none = buildWith({});
  assert.deepEqual(off, none, "build со снятой галкой идентичен build без packs");
  for (const [rate, cur] of [[1, "EUR"], [92.5, "RUB"]]) {
    assert.deepEqual(EPEstimate.specShown(off, rate, cur), EPEstimate.specShown(none, rate, cur));
    assert.deepEqual(EPEstimate.totalsShown(off, rate, cur), EPEstimate.totalsShown(none, rate, cur));
  }
  /* И добор НЕ появляется среди групп. */
  assert.equal(off.groups.filter(g => g.topUp).length, 0);
});

test("(г) общая скидка на добор есть; материалы и работы — от базы БЕЗ добора", () => {
  const S = { discountPercent: 10, materialsPercent: 15, workPercent: 20 };
  const on = buildWith({ packMultiple: true, packs, settings: S });
  const off = buildWith({ settings: S });

  /* Добор получает ОБЩУЮ скидку (не личную): в группе discountPersonal=false, процент = общий. */
  on.groups.filter(g => g.topUp).forEach(g => {
    assert.equal(g.discountPersonal, false, "добор не личный");
    assert.equal(g.discountPercent, 10, "добор под общим процентом");
  });

  for (const [rate, cur] of [[1, "EUR"], [92.5, "RUB"]]) {
    const tOn = EPEstimate.totalsShown(on, rate, cur);
    const tOff = EPEstimate.totalsShown(off, rate, cur);
    /* Оборудование с добором больше; скидка (общая) тоже выросла — добор в её базе. */
    assert.ok(tOn.equipment > tOff.equipment, "оборудование выросло на добор");
    assert.ok(tOn.discount > tOff.discount, "общая скидка выросла — добор в базе скидки");
    /* ⚠️ ГЛАВНЫЙ ИНВАРИАНТ решения владельца: материалы/работы от базы БЕЗ добора → не изменились. */
    assert.equal(tOn.materials, tOff.materials, "материалы от базы без добора (" + cur + ")");
    assert.equal(tOn.work, tOff.work, "работы от базы без добора (" + cur + ")");
  }
});

test("(г2) личная скидка поста на добор НЕ распространяется", () => {
  /* Один из постов с личной скидкой 50 %: добор всё равно под общей (10 %). */
  const S = { discountPercent: 10, materialsPercent: 0, workPercent: 0 };
  const est = EPEstimate.build({
    devices: [], posts: [post(), Object.assign(post(), { discount: 50 })],
    product, frameProduct, postCost, postComposition, settings: S,
    packMultiple: true, packs
  });
  est.groups.filter(g => g.topUp).forEach(g => {
    assert.equal(g.discountPersonal, false);
    assert.equal(g.discountPercent, 10, "добор под ОБЩЕЙ 10 %, а не личной 50 %");
  });
});

test("(в) итог = оборудование − скидка + материалы + работы, в € и ₽ (курс 92,5)", () => {
  const S = { discountPercent: 7, materialsPercent: 12, workPercent: 18 };
  const on = buildWith({ packMultiple: true, packs, settings: S });
  for (const [rate, cur] of [[1, "EUR"], [92.5, "RUB"]]) {
    const spec = EPEstimate.specShown(on, rate, cur);
    const t = EPEstimate.totalsShown(on, rate, cur);
    /* Оборудование = сумма ВСЕХ напечатанных строк, включая добор. */
    const rowsSum = spec.rows.reduce((s, r) => s + r.sum, 0);
    const r2 = n => Math.round(n * 100) / 100;
    assert.equal(r2(t.equipment), r2(rowsSum), "Оборудование = Σ строк (" + cur + ")");
    /* subtotal (без НДС) = оборудование − скидка + материалы + работы. */
    assert.equal(r2(t.subtotal), r2(t.equipment - t.discount + t.materials + t.work), "итог без НДС (" + cur + ")");
    if (cur === "RUB") {
      spec.rows.forEach(r => assert.equal(r.sum, Math.round(r.sum), "рублёвые строки целые (К7)"));
      assert.equal(t.equipment, Math.round(t.equipment), "Оборудование в рублях целое");
    }
  }
});

test("(д) Σ по артикулам сметы совпадает со сводом EPSupplierSpec.collect", () => {
  const est = buildWith({ packMultiple: true, packs });
  const sums = sumsByCode(est);
  /* Тот же проект как вход свода: 2 поста (2 механизма, рамка, коробка, суппорт) + одиночный выключатель. */
  const c = EPSupplierSpec.collect({
    posts: [
      { mechanisms: [MECH, MECH], frame: FRAME, box: BOX, support: SUP, boxCount: 1, supportCount: 1 },
      { mechanisms: [MECH, MECH], frame: FRAME, box: BOX, support: SUP, boxCount: 1, supportCount: 1 }
    ],
    extras: [{ kind: "device", code: MECH.code, name: MECH.name, count: 1 }]
  });
  const bySup = new Map(c.rows.filter(r => r.code).map(r => [EPPackTopUp.codeKey(r.code), r.count]));
  for (const [k, v] of sums) assert.equal(bySup.get(k), v, "свод и смета сходятся по " + k);
  assert.equal(bySup.size, sums.size, "наборов артикулов поровну");
});

test("(е) цена поста не меняется от галки — через реальный путь (строка сметы = postPriceShown)", () => {
  const deps = { product, frameProduct, postCost, postComposition, lightingOf: () => [] };
  const perPost = EPEstimate.postPriceShown(post(), Object.assign({}, deps, { settings: {} }), 1, "EUR");
  /* Проект с галкой ВКЛ: цена СТРОКИ этого поста в смете (specShown — тот же путь, что печатает КП и
     раскладку) обязана равняться самостоятельной цене поста, т.е. добор в неё не вошёл. */
  const estOn = buildWith({ packMultiple: true, packs });
  const spec = EPEstimate.specShown(estOn, 1, "EUR");
  const postIdx = estOn.groups.findIndex(g => !g.topUp && g.unit === "компл.");
  assert.equal(spec.rows[postIdx].price, perPost, "цена строки поста = postPriceShown — добор в цену поста не попал");
  /* И сам postPriceShown не зависит от settings.packMultiple: build на одном посте packs не получает. */
  const withFlag = EPEstimate.postPriceShown(post(), Object.assign({}, deps, { settings: { packMultiple: true } }), 1, "EUR");
  assert.equal(withFlag, perPost);
  assert.equal(perPost, 2 * 25.79 + 10.4 + 1.5 + 0.85);
});

test("(ж) переключение галки перерисовывает панель итогов", () => {
  let rendered = 0, saved = 0;
  const box = { checked: false, onchange: null };
  const ctx = {
    $: id => (id === "packMultipleCheck" ? box : null),
    EP_DATA: { settings: {} },
    scheduleSave: () => { saved++; },
    renderSummary: () => { rendered++; }
  };
  EPPackMultiple.attach(ctx);
  box.checked = true;
  box.onchange();
  assert.equal(ctx.EP_DATA.settings.packMultiple, true, "галка записала настройку");
  assert.equal(saved, 1, "проект сохранён");
  assert.equal(rendered, 1, "панель перерисована");
});

test("(г3) материалы и работы с галкой === без галки — перебор 300 проектов (с личными скидками) в € и ₽", () => {
  /* Решение владельца: % материалов/работ с добора НЕ берутся → при включении галки эти два числа
     обязаны совпасть с галкой снятой ДО РУБЛЯ/копейки, при любых ценах, количествах, общих И ЛИЧНЫХ
     скидках и курсе. Детерминированный ГПСЧ (seeded) — воспроизводимость прогона. */
  let seed = 123456789;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  let mismatches = 0, example = null;
  for (let n = 0; n < 300; n++) {
    const price = Math.round((1 + rnd() * 400) * 100) / 100;   // цена механизма, евро
    const mechA = { id: 10, code: "20001.0", name: "Выключатель", price, unit: "шт." };
    const catA = { 10: mechA, 20: FRAME };
    const prodA = id => catA[Number(id)];
    const nPosts = 1 + Math.floor(rnd() * 5);
    const nDev = Math.floor(rnd() * 4);
    /* Личная скидка части постов — undefined (по общей), 0/5/12,5/30/100 %. mk(false)/mk(true)
       делят ОДНИ посты, поэтому личные скидки в обоих идентичны — инвариант материалов/работ должен
       держаться и при смеси личных и общей. */
    const posts = Array.from({ length: nPosts }, () =>
      Object.assign(post(), { discount: pick([undefined, undefined, 0, 5, 12.5, 30, 100]) }));
    const devices = Array.from({ length: nDev }, () => ({ productId: 10 }));
    const S = { discountPercent: Math.round(rnd() * 37), materialsPercent: pick([0, 8, 12, 15, 22]),
      workPercent: pick([0, 10, 18, 20, 35]) };
    const pk = EPPackTopUp.buildPackMap([{ code: "20001.0", packQty: pick([2, 3, 7, 10, 50]) },
      { code: "V71301", packQty: pick([1, 10, 100]) }, { code: "20811", packQty: pick([1, 25, 50]) }]);
    const mk = flag => EPEstimate.build({ devices, posts, product: prodA, frameProduct: prodA,
      postCost: po => (po.mechanismIds || []).reduce((s, id) => s + prodA(id).price, 0) + FRAME.price + BOX.price + SUP.price,
      postComposition, settings: S, packMultiple: flag, packs: flag ? pk : null });
    for (const [rate, cur] of [[1, "EUR"], [92.5, "RUB"]]) {
      const off = EPEstimate.totalsShown(mk(false), rate, cur);
      const on = EPEstimate.totalsShown(mk(true), rate, cur);
      if (on.materials !== off.materials || on.work !== off.work) {
        mismatches++;
        if (!example) example = { n, cur, price, S, mOff: off.materials, mOn: on.materials, wOff: off.work, wOn: on.work };
      }
    }
  }
  assert.equal(mismatches, 0, "материалы/работы совпали во всех случаях; первый сбой: " + JSON.stringify(example));
});

test("(п.3) panelHtml показывает артикул, добавленное, цену и сумму; без поля скидки", () => {
  const est = buildWith({ packMultiple: true, packs });
  const spec = EPEstimate.specShown(est, 1, "EUR");
  const esc = s => String(s);
  const html = EPPackTopUp.panelHtml(est, spec, { esc, moneyShown: n => n + " €" });
  assert.match(html, /Добор до целых упаковок/);
  assert.match(html, /20001\.0 · Выключатель/, "артикул рядом с именем");
  assert.match(html, /5 шт\./, "сколько добавлено");
  assert.match(html, /\/шт\./, "цена за штуку");
  assert.doesNotMatch(html, /data-disc-row/, "у добора нет поля скидки");
  /* Нет строк добора → пусто. */
  assert.equal(EPPackTopUp.panelHtml(buildWith({}), EPEstimate.specShown(buildWith({}), 1, "EUR"), { esc, moneyShown: String }), "");
  /* ⚠️ Рубли (К7): панель обязана брать spec.rows[i].sum/price (валюта показа), а НЕ g.sum (евро).
     Мутация g.sum вместо spec.rows[i].sum показала бы евро 128,95 вместо рублёвых 11930. */
  const specR = EPEstimate.specShown(est, 92.5, "RUB");
  const htmlR = EPPackTopUp.panelHtml(est, specR, { esc, moneyShown: n => n + " ₽" });
  const gi = est.groups.findIndex(g => g.topUp && g.items[0].code === "20001.0");
  assert.match(htmlR, new RegExp("\\b" + specR.rows[gi].sum + " ₽"), "рублёвая сумма из spec.rows (" + specR.rows[gi].sum + ")");
  assert.doesNotMatch(htmlR, /128\.95 ₽/, "не евровая g.sum");
  assert.ok(specR.rows[gi].sum !== est.groups[gi].sum, "рублёвая сумма отличается от евровой g.sum — мутация ловится");
});

test("(п.4-guard) личная скидка: материалы/работы от базы с ПРАВИЛЬНОЙ общей скидкой (ловит потерю personalBase)", () => {
  /* Перебор (г3) сравнивает on==off и НЕ ловит потерю «- personalBase» в discountForEquipment: мутация
     искажает обе ветви одинаково. Здесь фиксируем ТОЧНЫЕ числа (галка снята — дефект виден и без неё).
     Проект: 1 одиночный выключатель (25,79) + 1 пост с личной скидкой 30 % (64,33), общая 10 %,
     материалы 20 %, работы 25 %, евро.
       personalBase=64,33; личная скидка=round2(64,33×0,30)=19,30;
       общая база=round2(90,12−64,33)=25,79; общая=round2(2,579)=2,58; Скидка=21,88;
       база %=round2(90,12−21,88)=68,24; материалы=round2(13,648)=13,65; работы=round2(17,06)=17,06.
     Без «- personalBase» общая скидка берётся со всего 90,12 (задваивая пост, у которого уже личная) →
     материалы 12,36, работы 15,45 — тест краснеет. */
  const est = EPEstimate.build({ devices: [{ productId: 10 }],
    posts: [Object.assign(post(), { discount: 30 })], product, frameProduct, postCost, postComposition,
    settings: { discountPercent: 10, materialsPercent: 20, workPercent: 25 } });
  const t = EPEstimate.totalsShown(est, 1, "EUR");
  assert.equal(t.discount, 21.88, "Скидка = личная 19,30 + общая 2,58 (общая — только с небонусной базы)");
  assert.equal(t.materials, 13.65, "материалы 20 % от 68,24");
  assert.equal(t.work, 17.06, "работы 25 % от 68,24");
});

test("(п.1) с галкой флаги Скидка/НДС учитывают добор при личных 0%/100%; Σ видимых = итог", () => {
  /* ДЕНЕЖНЫЙ ДЕФЕКТ: est.discount/est.vat — флаги показа строк «Скидка»/«НДС» (панель/КП/Excel гейтят
     по ним). Без починки они считались ДО добавления добора: общая скидка 10 % при личных у постов 0 %
     давала est.discount=0 (строка скрыта), а totalsShown добор со скидкой включал → итог не сходился со
     столбцом видимых строк. Теперь флаги знают про добор. */
  const mkDisc = flag => EPEstimate.build({ devices: [],
    posts: [Object.assign(post(), { discount: 0 }), Object.assign(post(), { discount: 0 })],
    product, frameProduct, postCost, postComposition,
    settings: { discountPercent: 10, materialsPercent: 0, workPercent: 0 }, packMultiple: flag, packs: flag ? packs : null });
  assert.ok(!mkDisc(false).discount, "без галки общая скидка не действует (все посты личная 0 %) — строка скрыта");
  const estOn = mkDisc(true);
  assert.ok(estOn.discount > 0, "с галкой флаг скидки включён — добор под общей скидкой");
  const t = EPEstimate.totalsShown(estOn, 1, "EUR");
  const r2 = n => Math.round(n * 100) / 100;
  assert.equal(r2(t.equipment - t.discount + t.materials + t.work), r2(t.total), "Σ видимых строк = итог");

  /* НДС, оба режима: единственный пост с личной 100 % обнуляет базу постов — без галки НДС-флаг снят,
     с галкой он включён (ненулевой остаётся только добор под общей скидкой). */
  for (const vatMode of ["surcharge", "included"]) {
    const mkVat = flag => EPEstimate.build({ devices: [], posts: [Object.assign(post(), { discount: 100 })],
      product, frameProduct, postCost, postComposition,
      settings: { discountPercent: 10, materialsPercent: 0, workPercent: 0, vatMode, vatPercent: 20 },
      packMultiple: flag, packs: flag ? packs : null });
    assert.ok(!mkVat(false).vat, "без галки НДС-флаг снят (" + vatMode + ")");
    const vOn = mkVat(true);
    assert.ok(vOn.vat > 0, "с галкой НДС-флаг включён (" + vatMode + ")");
    if (vatMode === "included") assert.ok(vOn.vatIncluded, "режим «выделить» сохранён");
  }
});

test("buildPackMap нормализует артикулы и отбрасывает мусор", () => {
  const m = EPPackTopUp.buildPackMap([
    { code: " 20001.0 ", packQty: 10 },   // пробелы — оформление
    { code: "x1", packQty: 0 },           // 0 — упаковка неизвестна
    { code: "x2" },                        // нет packQty
    { code: "x3", packQty: "5" }           // строка-число
  ]);
  assert.equal(m["20001.0"], 10);
  assert.ok(!("X1" in m) && !("x1" in m), "pack 0 отброшен");
  assert.ok(!("X2" in m) && !("x2" in m), "без packQty отброшен");
  assert.equal(m["X3"], 5, "строка-число принята и ключ нормализован");
});
