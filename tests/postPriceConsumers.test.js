/* В26 ч.3а — ПЯТЬ ПОТРЕБИТЕЛЕЙ ПЕЧАТАЮТ ЦЕНУ ПОСТА ОДИН РАЗ (money применяется НЕ дважды).
   postTotalCost теперь возвращает цену поста УЖЕ В ВАЛЮТЕ ПОКАЗА (EPEstimate.postPriceShown ×
   displayRate), поэтому все места показа форматируют её moneyShown (без повторного ×курс). Если
   потребитель снова прогонит её через money() — курс умножится ВТОРОЙ раз и цена в рублях вырастет
   примерно в 95 раз (неверная цена клиенту). Ни один прежний тезис этого не ловил: пути показа
   проверялись при курсе 1 либо с одинаковыми заглушками money/moneyShown.

   Здесь для КАЖДОГО из пяти потребителей — проверка при курсе 92,5 с РАЗЛИЧИМЫМИ money и moneyShown:
   у app.js/postBuilder — НАСТОЯЩИЕ money/moneyShown, вырезанные из исходника через стенд (money
   умножает на курс, moneyShown — нет); у раскладки КП (чистый модуль) — распознаваемые заглушки,
   как в offerTotalsConsistency. Ожидаемый текст считаем НЕЗАВИСИМО (Σ round2(цена изделия × 92,5) по
   составу поста), не через проверяемую функцию. Мутации v26.json M13–M17 (moneyShown→money) обязаны
   КРАСНЕТЬ (§7.1). Инвариант «цена поста = «Цена» строки сметы» держит postPriceShownInvariant.test.js. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");
const EPEstimate = require("../js/estimate.js");
const EPPosts = require("../js/posts.js");
const EPOfferPdf = require("../js/offerPdf.js");

const RATE = 92.5;
const round2 = EPEstimate.round2;
/* К7 (решение владельца 20.10): показ в рублях — ЦЕЛЫЙ рубль вверх (цена изделия вверх, сумма =
   Σ целых). Ожидание считаем тем же правилом ядра, но НЕЗАВИСИМО от проверяемых функций. */
const ceilRub = n => EPEstimate.roundShown(n, "RUB", "up");
/* Только цифры и десятичная запятая — убирает узкие/неразрывные пробелы Intl и символ валюты, чтобы
   сравнивать смысл числа, а не форматирование. В рублях копеек нет — moneyShown печатает целое. */
const digitsOf = s => String(s).replace(/[^\d,]/g, "");
/* Ожидаемая цифровая строка рублёвого числа: целый рубль без копеек ("6501"). */
const expectDigits = n => String(ceilRub(n));

/* Настоящий каталог VIMAR (как грузит браузер). */
const realProducts = stand.loadVimarCatalog().products || [];
const realById = new Map(realProducts.map(p => [p.id, p]));
const idByCode = code => (realProducts.find(p => p.code === code) || {}).id;

/* Коробку/суппорт/подсветку НЕ подбираем — цена поста = накладка + механизмы, её легко посчитать
   прямым чтением прайса (независимо от EPEstimate), как в docsMoneyCoverage. */
const realDeps = {
  product: id => realById.get(id), frameProduct: id => realById.get(id),
  mechanismSpan: it => (it && it.moduleSpan) || 1,
  findBox: () => null, fallbackBox: () => null,
  supportRequired: () => true, resolveSupport: () => ({ support: null, assumed: false }),
  findBacklight: () => null, backlight: { enabled: false }, wallType: "solid"
};
const postCost = p => EPPosts.postCost(p, realDeps);
const postComposition = p => EPPosts.postComposition(p, realDeps);

/* Пост примера: накладка + два механизма. Цена в валюте показа — ПО ИЗДЕЛИЯМ, как считает приложение:
   каждое изделие ceilRub(цена евро × курс) — целый рубль вверх (К7), затем сумма (коробка/суппорт
   отсутствуют → 0). Считаем НЕЗАВИСИМО прямым чтением прайса — это ожидание для пяти потребителей. */
const POST = { id: "x", number: 7, name: "Пост примера", frameId: idByCode("14931"),
  mechanismIds: [idByCode("19021"), idByCode("19101")] };
const priceEuros = [realById.get(POST.frameId), ...POST.mechanismIds.map(id => realById.get(id))]
  .map(p => Number(p && p.price) || 0);
const EXPECT_ONE = ceilRub(priceEuros.reduce((s, e) => s + ceilRub(e * RATE), 0));   // цена ОДНОГО поста, ₽
const EXPECT_ONE_D = expectDigits(EXPECT_ONE);
const EXPECT_TWO_D = expectDigits(EXPECT_ONE * 2);                                   // сумма ДВУХ постов

/* Санити: пример осмысленный (ненулевая цена) и курс различает money/moneyShown (×92,5 ≠ ×1). */
assert.ok(EXPECT_ONE > 0, "цена примера ненулевая (реальный каталог)");
assert.notEqual(EXPECT_ONE_D, expectDigits(EXPECT_ONE * RATE), "курс 92,5 различает money и moneyShown");

/* НАСТОЯЩИЕ money/moneyShown из app.js + НАСТОЯЩИЙ postTotalCost + функция-потребитель — в одном
   vm-контексте (общая лексика). money/moneyShown берём ИСХОДНЫМ текстом (constBlock), не копией:
   копия молча разошлась бы с продакшеном, и подмена moneyShown→money не покраснела бы (§7.1).
   ctx — зависимости приложения (каталог, курс), остальное — безвредные заглушки (на цену не влияют). */
function runAppConsumer(fnNames, extraCtx) {
  const ctx = Object.assign({
    EPEstimate, EPPosts,
    product: id => realById.get(id), frameProduct: id => realById.get(id),
    postCost, postComposition,
    projectLighting: () => null, lightingRowsFor: () => [],
    EP_DATA: { settings: { wallType: "solid" } },
    displayRate: () => RATE, displayCurrency: () => "RUB",
    esc: String
  }, extraCtx);
  const returned = fnNames[fnNames.length - 1];
  const code = stand.constBlock("moneyShown") + "\n" + stand.constBlock("money") + "\n"
    + fnNames.map(stand.functionSource).join("\n") + "\n;(" + returned + ");";
  vm.createContext(ctx);
  return vm.runInContext(code, ctx);
}

/* ─────────── M15: подсказка на плане (showHover) ─────────── */

test("подсказка на плане: «Стоимость поста» напечатана ОДИН раз (ловит M15: money вместо moneyShown)", () => {
  const dom = stand.makeDom();
  const ctx = {
    hover: dom.$("hover"),
    backlightRowSummary: () => null,
    assembledPostHtml: () => "", postNumberLabel: () => "Пост № 7",
    positionHover: () => {}
  };
  const showHover = runAppConsumer(["postTotalCost", "showHover"], ctx);
  showHover("post", POST, { clientX: 0, clientY: 0 });
  const cell = (dom.$("hover").innerHTML.match(/Стоимость поста<\/dt><dd>([^<]*)<\/dd>/) || [])[1];
  assert.equal(digitsOf(cell), EXPECT_ONE_D, `подсказка печатает ${EXPECT_ONE_D} ₽, а не ×курс повторно`);
});

/* ─────────── M16: свойства одиночного поста (renderProperties, ветка post) ─────────── */

test("свойства поста: «Стоимость» напечатана ОДИН раз (ловит M16)", () => {
  const dom = stand.makeDom();
  const props = dom.$("props");
  const ctx = {
    state: { selected: { kind: "post", id: POST.id }, posts: [POST], rooms: [] },
    props, $: dom.$,
    flushRoomDraft: () => {}, renderTemplates: () => {}, updateSelectionCount: () => {},
    applySelectionClasses: () => {}, findSelectedEntity: () => POST,
    lightingRowSummary: () => null, backlightRowSummary: () => null,
    postNumberLabel: () => "Пост № 7", postGroupsPropHtml: () => "",
    WALL_STEP_LABEL: { solid: "бетон", hollow: "ГКЛ" },
    EPPosts: { postWallType: () => "solid" }
  };
  const renderProperties = runAppConsumer(["postTotalCost", "renderProperties"], ctx);
  renderProperties();
  const val = (props.innerHTML.match(/<label>Стоимость<input value="([^"]*)"/) || [])[1];
  assert.equal(digitsOf(val), EXPECT_ONE_D, `свойства поста печатают ${EXPECT_ONE_D} ₽`);
});

/* ─────────── M17: суммарная стоимость выделенных постов (renderProperties, ветка posts) ─────────── */

test("суммарная стоимость выделенных: Σ цен постов напечатана ОДИН раз (ловит M17)", () => {
  const dom = stand.makeDom();
  const props = dom.$("props");
  const POST2 = Object.assign({}, POST, { id: "x2" });
  const ctx = {
    state: { selected: { kind: "posts", ids: [POST.id, POST2.id] }, posts: [POST, POST2], rooms: [] },
    props, $: dom.$,
    flushRoomDraft: () => {}, renderTemplates: () => {}, updateSelectionCount: () => {},
    applySelectionClasses: () => {},
    EPSelection: { normalize: (ids) => ({ kind: "posts", ids }) }
  };
  const renderProperties = runAppConsumer(["postTotalCost", "renderProperties"], ctx);
  renderProperties();
  const val = (props.innerHTML.match(/Суммарная стоимость<input value="([^"]*)"/) || [])[1];
  assert.equal(digitsOf(val), EXPECT_TWO_D, `суммарная стоимость двух постов — ${EXPECT_TWO_D} ₽`);
});

/* ─────────── M14: окно поста (postBuilder.renderBuilderComposition) ─────────── */

test("окно поста: «Стоимость поста» напечатана ОДИН раз (ловит M14)", () => {
  const dom = stand.makeDom();
  const host = dom.$("builderComposition");
  const frame = realById.get(POST.frameId);
  const ctx = {
    state: { builder: { editingPlacedId: null } },
    document: { querySelectorAll: () => [] }, $: dom.$,
    builderWallType: () => "solid", renderPostBacklight: () => {},
    productSeries: () => [], frameSlotCount: () => 2,
    lightingRowSummary: () => null, backlightRowSummary: () => null,
    lightingHtml: () => "",
    WALL_STEP_LABEL: { solid: "бетон", hollow: "ГКЛ" },
    STANDARD_GENITIVE: {}, STANDARD_LABEL: {}
  };
  const renderBuilderComposition = runAppConsumer(["postTotalCost", "renderBuilderComposition"], ctx);
  /* draft = наш пост, light = null (раскладка без подмен); selectedFrame — настоящая накладка. */
  renderBuilderComposition(frame, "", null, POST);
  const val = (host.innerHTML.match(/Стоимость поста<\/span><b>([^<]*)<\/b>/) || [])[1];
  assert.equal(digitsOf(val), EXPECT_ONE_D, `окно поста печатает ${EXPECT_ONE_D} ₽`);
});

/* ─────────── M13: раскладка КП «Стоимость блока» (EPOfferPdf, чистый модуль) ─────────── */

test("раскладка КП «Стоимость блока»: цена поста печатается ОДИН раз (ловит M13)", () => {
  /* Распознаваемые заглушки (как в offerTotalsConsistency): moneyShown — число как есть, money — ×курс.
     p.price приходит УЖЕ в валюте показа (postTotalCost), поэтому верный рендер зовёт moneyShown. */
  const moneyShown = n => "R" + round2(n).toFixed(2);
  const money = n => "R" + round2(Number(n) * RATE).toFixed(2);
  const esc = s => String(s ?? "");
  const html = EPOfferPdf.buildHtml(
    { groups: [], equipment: 0, missing: [], discount: 0, materials: 0, work: 0, vat: 0 },
    { esc, money, moneyShown, EPEstimate, displayRate: () => RATE, displayCurrency: () => "RUB",
      settings: {}, effectiveRate: () => RATE,
      options: { prices: true, articles: false,
        sections: { plan: false, layout: true, specification: false, lighting: false, supplier: false },
        layout: { number: true, fill: false, modules: false, box: false, article: false,
          illustration: false, price: true, itemPrices: false } },
      postLayout: [{ number: 7, price: EXPECT_ONE }],
      planBlockHtml: "", lightingHtml: "", supplierSpecHtml: "" });
  /* Единственная правая ячейка строки раскладки — «Стоимость блока». */
  const cells = [...html.matchAll(/<td class="right">([^<]*)<\/td>/g)].map(m => m[1]);
  assert.ok(cells.length >= 1, "в раскладке есть колонка «Стоимость блока»");
  assert.equal(cells[0], moneyShown(EXPECT_ONE), `раскладка печатает moneyShown(цена), а не money(цена)`);
});
