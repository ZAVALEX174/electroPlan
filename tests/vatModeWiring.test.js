/* ПОВЕДЕНЧЕСКИЕ связки НДС в app.js: панель «Стоимость проекта» (renderSummary) и ввод условий
   (applyTerms). Три режима (итоги встречи 24.08 §1.2) считает НАСТОЯЩИЙ EPEstimate.build — app.js
   берёт из est подпись (est.vatLabel), сумму (est.vat) и итог (est.total) и разводит их по узлам.
   Второй копии формулы НДС в app.js нет (§7.1): если её вернут, подпись захардкодят, строку «в т.ч.»
   поставят в столбец слагаемых или applyTerms перестанет писать/гасить — тесты покраснеют.

   КАК. app.js — монолит-оркестратор (DOM, state), в node не грузится. Вырезаем ИСХОДНЫЙ ТЕКСТ
   функции из app.js и исполняем на DOM-шиме. buildEstimate подменён на настоящий EPEstimate.build
   для заданного режима — значит числа и подписи в узлах реальны. Соседи заглушены. Плюс структурная
   проверка index.html: строка «в т.ч. НДС» обязана стоять ПОД «Итого». Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const stand = require("./helpers/appStand.js");
const EPEstimate = require("../js/estimate.js");

const INDEX = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

/* Каталог-заглушка: одна розетка 100 € (работы/материалы 0) — база до НДС ровно 100. */
const CATALOG = { 1: { id: 1, name: "Розетка", code: "R", price: 100, unit: "шт." } };
const estFor = mode => EPEstimate.build({
  devices: [{ productId: 1 }], posts: [], product: id => CATALOG[id], frameProduct: id => CATALOG[id],
  postCost: () => 0, settings: { workPercent: 0, materialsPercent: 0, discountPercent: 0, vatPercent: 20, vatMode: mode }
});

function render(mode) {
  const dom = stand.makeDom();
  const state = { rooms: [], devices: [{ id: "d1", roomId: null }], posts: [] };
  const run = stand.run("renderSummary", {
    state,
    EPEstimate,
    $: dom.$,
    money: v => "€" + Number(v).toFixed(2),
    esc: String,
    projectLighting: () => ({}),
    buildEstimate: () => estFor(mode),
    lightingHtml: () => "[L]",
    updateStatus: () => {},
    orphanObjectsWarningText: () => ""
  });
  run();
  return dom.els;
}

test("панель «начислить сверху»: слагаемое «НДС» до «Итого», итог больше базы на 20%", () => {
  const els = render("surcharge");
  assert.equal(els.vatRow.hidden, false, "строка-слагаемое НДС видна");
  assert.equal(els.vatIncludedRow.hidden, true, "строки «в т.ч.» при начислении сверху нет");
  assert.equal(els.vatRowLabel.textContent, "НДС", "подпись — «НДС»");
  assert.match(els.vatTotal.textContent, /€20\.00 \(20%\)/, "сумма НДС = 20");
  assert.equal(els.grandTotal.textContent, "€120.00", "итог = база + НДС");
});

test("панель «выделить в стоимости»: «в т.ч. НДС» под «Итого», сумма выделена, итог прежний", () => {
  const els = render("included");
  assert.equal(els.vatRow.hidden, true, "в столбце слагаемых строки НДС нет — сумма бы не сошлась");
  assert.equal(els.vatIncludedRow.hidden, false, "строка «в т.ч. НДС» под итогом видна");
  assert.equal(els.vatIncludedLabel.textContent, "в т.ч. НДС", "подпись словами заказчика");
  /* 100 × 20/120 = 16,67 € — выделено из итога, а не добавлено */
  assert.match(els.vatIncludedTotal.textContent, /€16\.67 \(20%\)/, "НДС выделен обратным счётом");
  assert.equal(els.grandTotal.textContent, "€100.00", "итог прежний — цены уже с НДС");
});

test("панель «не учитывать»: обе строки НДС скрыты, итог равен базе", () => {
  const els = render("none");
  assert.equal(els.vatRow.hidden, true, "строки-слагаемого нет");
  assert.equal(els.vatIncludedRow.hidden, true, "строки «в т.ч.» нет");
  assert.equal(els.grandTotal.textContent, "€100.00", "итог без НДС");
});

/* Строка «в т.ч. НДС» обязана стоять ПОД «Итого» (как в КП): в столбце слагаемых она ломала бы
   видимую сумму. Слагаемое-«НДС» (начисление сверху) наоборот стоит ДО «Итого». */
test("index.html: «в т.ч. НДС» под «Итого», слагаемое «НДС» — до него", () => {
  const vatOnTop = INDEX.indexOf('id="vatRow"');
  const grand = INDEX.indexOf('class="grand-total"');
  const incl = INDEX.indexOf('id="vatIncludedRow"');
  assert.ok(vatOnTop > -1 && vatOnTop < grand, "слагаемое #vatRow — ДО «Итого»");
  assert.ok(incl > grand, "#vatIncludedRow — ПОСЛЕ «Итого» (иначе столбец слагаемых не сойдётся)");
});

/* applyTerms — орган ввода режима. Проверяем, что выбор режима оседает в settings.vatMode и что
   поле «НДС, %» гаснет ровно на «Не учитывать» (без противоречия «режим без НДС, но ставка активна»). */
function applyTermsStand() {
  const dom = stand.makeDom();
  const settings = {};
  const run = stand.run("applyTerms", {
    EP_DATA: { settings }, $: dom.$, applyProjectSettings: () => {}
  });
  ["workInput", "materialsInput", "discountInput", "vatInput"].forEach(id => { dom.$(id).value = "0"; });
  return { dom, settings, run };
}

test("applyTerms: выбранный режим НДС оседает в settings.vatMode", () => {
  const s = applyTermsStand();
  s.dom.$("vatMode").value = "included";
  s.run();
  assert.equal(s.settings.vatMode, "included", "выбор режима записан в проект");
});

test("applyTerms: «Не учитывать» гасит «НДС, %», прочие режимы — включают", () => {
  const a = applyTermsStand();
  a.dom.$("vatMode").value = "none"; a.run();
  assert.equal(a.dom.els.vatInput.disabled, true, "на «не учитывать» ставка недоступна");
  const b = applyTermsStand();
  b.dom.$("vatMode").value = "surcharge"; b.run();
  assert.equal(b.dom.els.vatInput.disabled, false, "на «начислить сверху» ставка доступна");
});

/* Переключение режима обязано пересчитывать проект: без onchange смена режима в селекторе ничего
   не делает, пока не тронешь другое поле. Держим саму привязку (стрип комментариев — на исходнике). */
test("app.js: смена #vatMode привязана к applyTerms (onchange)", () => {
  assert.match(stand.SRC, /\$\("vatMode"\)\.onchange\s*=\s*applyTerms/,
    "у селектора режима НДС должен быть обработчик onchange=applyTerms");
});
