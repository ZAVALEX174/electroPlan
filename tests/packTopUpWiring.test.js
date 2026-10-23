/* Проводка добора упаковок (К6б) через НАСТОЯЩИЕ buildEstimate + renderSummary (app.js) на DOM-шиме.
   Структурные *Wiring-тесты сверяют текст, но смысл проводки держит только поведение: включаем галку
   (EP_DATA.settings.packMultiple=true) и каталог с packQty, исполняем реальный путь и читаем #specList
   и строку «Скидка». Ловит мутации проводки: buildEstimate с packMultiple:false / пустой картой packs;
   renderSummary без +EPPackTopUp.panelHtml; renderSummary, не пропускающий g.topUp (дубль строкой с
   полем скидки). Запуск: node --test tests/packTopUpWiring.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const EPEstimate = require("../js/estimate.js");
const EPPackTopUp = require("../js/packTopUp.js");

/* Фикстура: 1 одиночный выключатель + 2 одинаковых 2-клавишных поста (как в packTopUp.test.js). */
const MECH = { id: 10, code: "20001.0", name: "Выключатель", price: 25.79, unit: "шт." };
const FRAME = { id: 20, code: "20657", name: "Рамка", price: 10.4, unit: "шт." };
const BOX = { code: "V71301", name: "Коробка", price: 1.5 };
const SUP = { code: "20811", name: "Суппорт", price: 0.85 };
const cat = { 10: MECH, 20: FRAME };
const comp = { box: BOX, boxCount: 1, support: SUP, supportCount: 1, supportAssumed: false,
  frameAvailability: { frame: FRAME, missing: false, unset: false, displayName: FRAME.name } };

function renderPanel(packMultiple) {
  const dom = stand.makeDom();
  const state = { rooms: [], devices: [{ id: "d1", productId: 10, roomId: null, discount: 0 }],
    posts: [{ id: "p1", frameId: 20, mechanismIds: [10, 10], name: "Пост 1", discount: 0 },
            { id: "p2", frameId: 20, mechanismIds: [10, 10], name: "Пост 2", discount: 0 }] };
  const ctx = {
    state, EPEstimate, EPPackTopUp, $: dom.$,
    product: id => cat[Number(id)], frameProduct: id => cat[Number(id)],
    postCost: po => (po.mechanismIds || []).reduce((s, id) => s + cat[Number(id)].price, 0) + FRAME.price + BOX.price + SUP.price,
    postComposition: () => comp, lightingRowsFor: () => [],
    projectLighting: () => ({}),
    /* Каталог программы с упаковками — из него buildEstimate строит карту. Общая скидка 10 %, у постов
       личная 0 % → без добора строка «Скидка» скрыта, с добором должна появиться. */
    EP_DATA: { products: [{ code: "20001.0", packQty: 10 }, { code: "V71301", packQty: 100 },
      { code: "20811", packQty: 50 }, { code: "20657", packQty: 1 }],
      settings: { packMultiple, discountPercent: 10, materialsPercent: 0, workPercent: 0 } },
    money: v => "€" + Number(v).toFixed(2), moneyShown: v => "€" + Number(v).toFixed(2),
    esc: String, displayRate: () => 1, displayCurrency: () => "EUR",
    lightingHtml: () => "[L]", updateStatus: () => {}, orphanObjectsWarningText: () => ""
  };
  stand.run(["buildEstimate", "renderSummary"], ctx)();
  return dom.els;
}

test("галка ВКЛ: раздел добора в #specList, строки без поля скидки, строка «Скидка» видна", () => {
  const els = renderPanel(true);
  const html = els.specList.innerHTML;
  assert.match(html, /Добор до целых упаковок/, "заголовок раздела есть (панель зовёт EPPackTopUp.panelHtml)");
  assert.match(html, /20001\.0 · Выключатель/, "строка добора несёт артикул и имя");
  /* Обычных групп две (одиночный выключатель + группа из двух постов) → ровно два поля «скидка, %».
     Строки добора поля скидки не несут (мутация «не пропускать g.topUp» дала бы 5). */
  assert.equal((html.match(/data-disc-row/g) || []).length, 2, "поле скидки только у обычных строк");
  /* Денежный дефект: добор под общей скидкой включает строку «Скидка», хотя у постов личная 0 %. */
  assert.equal(els.discountRow.hidden, false, "строка «Скидка» видна (флаг est.discount знает про добор)");
});

test("app.js передаёт renderSummary в EPPackMultiple.attach (иначе галка не перерисует панель)", () => {
  /* Структурный guard к поведенческому (ж) из packTopUp.test.js: тот проверяет, что модуль зовёт
     renderSummary, если его дали; этот — что app.js его РЕАЛЬНО отдаёт. Мутация «убрать renderSummary
     из ctx attach» поведенческим не ловится (модуль тестируется напрямую), поэтому сторожим текст. */
  assert.match(stand.SRC, /EPPackMultiple\.attach\(\{[^}]*renderSummary[^}]*\}\)/,
    "ctx EPPackMultiple.attach в app.js несёт renderSummary");
});

test("галка СНЯТА: раздела добора нет, строка «Скидка» скрыта (личные 0 %)", () => {
  const els = renderPanel(false);
  const html = els.specList.innerHTML;
  assert.doesNotMatch(html, /Добор до целых упаковок/, "без галки добора нет");
  assert.equal((html.match(/data-disc-row/g) || []).length, 2, "те же две обычные строки");
  assert.equal(els.discountRow.hidden, true, "без добора общая скидка не действует → строка скрыта");
});
