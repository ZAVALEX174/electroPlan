"use strict";
/* Тесты окна «Прайс по шаблону» (К9 ч.3) — ЧИСТАЯ часть js/priceCheckUi.js:
   buildReport (результат check() → модель отчёта) и reportHtml (модель → разметка).
   DOM-связку (attach) здесь не трогаем — она проверяется в браузере (tools/qa).
   Мутационная проверка в отчёте исполнителя: ломаем итог/группировку/esc — тест обязан покраснеть. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const UI = require("../js/priceCheckUi.js");

// esc проекта (точная копия app.js) — чтобы проверять именно экранирование, а не заглушку.
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

test("buildReport: без ошибок — файл можно отдавать", () => {
  const rep = UI.buildReport({ ok: true, errors: [], warnings: [] }, esc);
  assert.equal(rep.ok, true);
  assert.equal(rep.errorCount, 0);
  assert.equal(rep.summary, "Ошибок нет — файл можно отдавать.");
});

test("buildReport: итог считается по ОШИБКАМ, предупреждения не влияют", () => {
  const rep = UI.buildReport({ errors: [], warnings: [{ count: 3, message: "нет столбца «Подгруппы»" }] }, esc);
  // Есть предупреждение, но ошибок нет → файл пригоден.
  assert.equal(rep.ok, true);
  assert.equal(rep.warningCount, 1);
  assert.equal(rep.summary, "Ошибок нет — файл можно отдавать.");
});

test("buildReport: при ошибках — их число в итоге", () => {
  const rep = UI.buildReport({
    errors: [{ count: 1, message: "нет цены — 1 (строки 57)." }, { count: 1605, message: "цвет накладки пуст" }],
    warnings: [],
  }, esc);
  assert.equal(rep.ok, false);
  assert.equal(rep.errorCount, 2);
  assert.equal(rep.summary, "Найдено ошибок: 2. Их нужно исправить в файле.");
});

test("buildReport: группы не перепутаны — errors из errors, warnings из warnings", () => {
  const rep = UI.buildReport({
    errors: [{ count: 1, message: "ОШИБКА-МАРКЕР" }],
    warnings: [{ count: 2, message: "ПРЕДУПРЕЖДЕНИЕ-МАРКЕР" }],
  }, esc);
  assert.equal(rep.errors.length, 1);
  assert.equal(rep.warnings.length, 1);
  assert.equal(rep.errors[0].text, "ОШИБКА-МАРКЕР");
  assert.equal(rep.warnings[0].text, "ПРЕДУПРЕЖДЕНИЕ-МАРКЕР");
});

test("buildReport: сообщение ОШИБКИ из файла экранируется (ввод заказчика в HTML только через esc)", () => {
  // Тип управления в файле может содержать HTML-опасные символы — они обязаны прийти экранированными.
  const rep = UI.buildReport({
    errors: [{ count: 1, message: "тип управления «<script>&\"'» не распознан" }],
    warnings: [],
  }, esc);
  const t = rep.errors[0].text;
  assert.ok(t.includes("&lt;script&gt;"), "ожидали экранированный <script>, получили: " + t);
  assert.ok(t.includes("&amp;"), "амперсанд должен быть экранирован");
  assert.ok(!t.includes("<script>"), "сырой <script> в тексте остаться не должен");
});

test("buildReport: сообщение ПРЕДУПРЕЖДЕНИЯ из файла экранируется (тот же край — значение из файла)", () => {
  // Сообщения предупреждений тоже несут значение из файла заказчика (напр. «тип управления «...» не
  // распознан»), поэтому экранирование у них так же обязательно, как у ошибок.
  const rep = UI.buildReport({
    errors: [],
    warnings: [{ count: 1, message: "тип управления «<img src=x onerror=1>» не распознан" }],
  }, esc);
  const t = rep.warnings[0].text;
  assert.ok(t.includes("&lt;img src=x onerror=1&gt;"), "ожидали экранированный <img>, получили: " + t);
  assert.ok(!t.includes("<img"), "сырой <img> в тексте предупреждения остаться не должен");
});

test("reportHtml: XSS-пэйлоад в ПРЕДУПРЕЖДЕНИИ не попадает в разметку сырым", () => {
  const rep = UI.buildReport({
    errors: [],
    warnings: [{ count: 2, message: "тип управления «<img src=x onerror=1>» не распознан" }],
  }, esc);
  const html = UI.reportHtml(rep);
  assert.ok(html.includes("&lt;img src=x onerror=1&gt;"), "экранированный <img> в разметке");
  assert.ok(!html.includes("<img src=x"), "сырого <img> в HTML быть не должно");
});

test("reportHtml: итог ok → класс ok и фраза; есть секции ошибок и предупреждений", () => {
  const rep = UI.buildReport({
    errors: [{ count: 57, message: "нет цены" }],
    warnings: [{ count: 0, message: "нет столбца «Подгруппы»" }],
  }, esc);
  const html = UI.reportHtml(rep);
  assert.ok(html.includes("pc-summary bad"), "итог с ошибками — красный класс bad");
  assert.ok(html.includes("Найдено ошибок: 1"), "итог несёт число ошибок");
  assert.ok(html.includes("Ошибки (1)"), "заголовок секции ошибок");
  assert.ok(html.includes("Предупреждения (1)"), "заголовок секции предупреждений");
  assert.ok(html.includes("<span class=\"pc-count\">57</span>"), "бейдж с числом строк при count>0");
  // У находки «нет столбца» count=0 — бейдж не рисуем.
  assert.ok(!html.includes("<span class=\"pc-count\">0</span>"), "бейджа с нулём быть не должно");
});

test("reportHtml: ok без ошибок — зелёный итог, секции ошибок нет", () => {
  const html = UI.reportHtml(UI.buildReport({ errors: [], warnings: [] }, esc));
  assert.ok(html.includes("pc-summary ok"), "итог без ошибок — зелёный класс ok");
  assert.ok(html.includes("Ошибок нет — файл можно отдавать."));
  assert.ok(!html.includes("Ошибки ("), "секции ошибок быть не должно");
});

test("reportHtml: экранированный текст доходит до разметки сырым (без двойного экранирования)", () => {
  const rep = UI.buildReport({ errors: [{ count: 1, message: "a<b" }], warnings: [] }, esc);
  const html = UI.reportHtml(rep);
  assert.ok(html.includes("a&lt;b"), "экранированный текст в разметке");
});
