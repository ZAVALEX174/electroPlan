/* Редактируемый подвал «Условия сделки» в КП (итоги встречи 24.08 §1.3: подвал КП — редактируемый
   текст «Соглашения сторон»). Текст — бланк КОМПАНИИ (EPPrefs.companyTerms), приходит в offerPdf
   строкой deps.terms; сама разметка подвала — ОДНО правило в EPOfferPdf.termsFooterHtml (§7.1).
   Модуль чистый — браузер не поднимаем.

   ГРАНИЦА: только подвал условий в КП. В лист монтажника этот текст НЕ идёт — здесь не проверяется
   (см. documentLogo.test.js по логотипу).

   МУТАЦИОННАЯ ТАБЛИЦА (в отчёте проверяющему):
     (а) при ПУСТОМ тексте в документ лезет непустой блок (снят страж if(!raw)) → красит 2:
         «termsFooterHtml: пусто/пробелы/не строка → ''» и «пустой/пробельный/отсутствующий текст
         условий не меняет КП против нынешнего»;
     (б) снято экранирование (esc убран)    → красит 2: «termsFooterHtml: html … экранируется» (unit) и
         «html в тексте условий экранируется в документе и не исполняется» (в документе живой <script>);
     (в) блок гейтится options.prices (терм в ветке цен) → красит 1: «условия печатаются и когда цены
         выключены».
   Запуск: node --test tests/offerTerms.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const EPOfferPdf = require("../js/offerPdf.js");
const { buildHtml, termsFooterHtml, MAX_TERMS_CHARS } = EPOfferPdf;

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* Минимальная смета в форме EPEstimate.build (как в offerPdf.test.js). */
const est = {
  groups: [{ name: "Выключатель", composition: "20001", count: 2, unit: "шт", sum: 40 }],
  equipment: 40, discount: 0, materials: 5, work: 10, subtotal: 55, vat: 0, total: 55
};
/* Дату фиксируем — два прогона buildHtml сравниваются побайтно без гонки с new Date(). */
const deps = { money: n => String(n) + " €", esc, displayCurrency: () => "EUR", settings: {},
  header: { project: "Дом", date: "01.01.2026" } };

const TERMS = "Условия оплаты: 50% предоплата.\nПоставка — до 180 дней.\nЦены действительны 1 календарный день.";

/* ---- EPDocLogo-подобное чистое правило: разметка подвала условий ---- */
test("termsFooterHtml: пусто/пробелы/не строка → '' (никакого пустого блока)", () => {
  assert.equal(termsFooterHtml("", esc), "", "пусто → пустая строка");
  assert.equal(termsFooterHtml("   \n  ", esc), "", "только пробелы/переносы → пустая строка");
  assert.equal(termsFooterHtml(undefined, esc), "", "не строка → пустая строка");
  assert.equal(termsFooterHtml(null, esc), "", "null → пустая строка");
});

test("termsFooterHtml: переносы строк человека сохраняются как <br>", () => {
  const out = termsFooterHtml("строка один\nстрока два", esc);
  assert.match(out, /строка один<br>строка два/, "\\n превратился в <br>");
  /* \r\n и одиночный \r приводятся к тому же <br> — источник абзацев не важен. */
  assert.match(termsFooterHtml("a\r\nb\rc", esc), /a<br>b<br>c/, "\\r\\n и \\r тоже дают <br>");
});

test("termsFooterHtml: html в тексте экранируется, а не исполняется", () => {
  const out = termsFooterHtml("<b>жир</b> & <script>alert(1)</script>", esc);
  assert.ok(!/<b>/.test(out), "живого тега <b> в разметке нет");
  assert.ok(!/<script>/.test(out), "живого <script> в разметке нет");
  assert.match(out, /&lt;b&gt;жир&lt;\/b&gt;/, "теги экранированы");
  assert.match(out, /&amp;/, "амперсанд экранирован");
  /* Экранирование раньше вставки <br>: настоящие переносы остаются <br>, а не &lt;br&gt;. */
  assert.match(termsFooterHtml("<b>\nниз", esc), /&lt;b&gt;<br>низ/, "esc до \\n→<br>, а не после");
});

/* ---- КП (offerPdf) ---- */
test("вписанный текст условий печатается в подвале КП", () => {
  const html = buildHtml(est, Object.assign({}, deps, { terms: TERMS }));
  assert.match(html, /class="terms"/, "блок условий присутствует");
  assert.match(html, /Условия оплаты: 50% предоплата\./, "первая строка текста в документе");
  assert.match(html, /Поставка — до 180 дней\.<br>Цены действительны/, "переносы строк сохранены");
});

test("html в тексте условий экранируется в документе и не исполняется", () => {
  const html = buildHtml(est, Object.assign({}, deps, { terms: "<script>alert(1)</script> & <b>жир</b>" }));
  assert.ok(!/<script>alert\(1\)<\/script>/.test(html), "живого <script> из текста условий в КП нет");
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "тег script пришёл экранированным");
  assert.match(html, /&lt;b&gt;жир&lt;\/b&gt;/, "разметка в тексте условий — это текст, а не HTML");
});

test("пустой/пробельный/отсутствующий текст условий не меняет КП против нынешнего", () => {
  const base = buildHtml(est, deps);                       // ключа terms нет вовсе — нынешний документ
  assert.ok(!/class="terms"/.test(base), "без текста блока условий в документе нет");
  for (const v of ["", "   \n\t ", undefined, null]) {
    assert.equal(buildHtml(est, Object.assign({}, deps, { terms: v })), base,
      `terms=${JSON.stringify(v)} даёт документ байт-в-байт как без условий`);
  }
});

test("текст условий стоит НИЖЕ денежных подвалов, но ВЫШЕ свода поставщика (не уезжает с отрывным листом)", () => {
  const marker = '<section data-test="supplier">свод</section>';
  const html = buildHtml(est, Object.assign({}, deps, { terms: TERMS, supplierSpecHtml: marker }));
  const posTotals = html.indexOf("Итого");
  const posTerms = html.indexOf('class="terms"');
  const posSupplier = html.indexOf(marker);
  assert.ok(posTerms > posTotals, "условия ниже денежных итогов");
  assert.ok(posSupplier > -1 && posTerms < posSupplier, "условия выше свода поставщика (остаются на страницах КП)");
});

test("условия печатаются и когда цены выключены (текст не зависит от options.prices)", () => {
  const noPrices = Object.assign({}, deps, { terms: TERMS, options: { prices: false } });
  const html = buildHtml(est, noPrices);
  assert.ok(!/Итого/.test(html), "предпосылка: в этом документе денежных итогов нет");
  assert.match(html, /class="terms"/, "блок условий всё равно есть");
  assert.match(html, /Поставка — до 180 дней/, "текст условий напечатан без цен");
});

/* ---- Предел длины ---- */
test("MAX_TERMS_CHARS — положительное число (единый предел длины для ввода и печати)", () => {
  assert.equal(typeof MAX_TERMS_CHARS, "number", "предел экспортирован числом");
  assert.ok(MAX_TERMS_CHARS >= 1000 && MAX_TERMS_CHARS <= 10000, "предел в разумных рамках нескольких абзацев");
});
