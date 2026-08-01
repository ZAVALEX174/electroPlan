/* Автотесты коммерческого предложения (js/offerPdf.js).
   Модуль чистый (как installSheet.js): на вход готовая смета est + форматтеры, на выход строка
   полного HTML-документа — браузер поднимать не нужно. Здесь проверяем только автопечать окна:
   она ждёт загрузки иллюстраций постов (тянутся с vimar.ru) и печатает ровно один раз. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildHtml } = require("../js/offerPdf.js");

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* Минимальная смета в форме EPEstimate.build (нужны только поля, читаемые генератором). */
const est = {
  groups: [{ name: "Выключатель", composition: "20001", count: 2, unit: "шт", sum: 40 }],
  equipment: 40, discount: 0, materials: 5, work: 10, subtotal: 55, vat: 0, total: 55
};
/* displayCurrency → EUR: подвал с курсом не печатается, курсовые зависимости не нужны. */
const deps = { money: n => String(n) + " €", esc, displayCurrency: () => "EUR", settings: {} };

test("КП собирается в полный HTML-документ со спецификацией", () => {
  const html = buildHtml(est, deps);
  assert.match(html, /Коммерческое предложение/, "заголовок документа");
  assert.match(html, /Выключатель/, "позиция из сметы");
  assert.match(html, /55 €/, "итог отформатирован money()");
});

test("автопечать ждёт загрузки картинок и печатает ровно один раз", () => {
  const html = buildHtml(est, deps);
  /* печать по готовности картинок, а не по прежнему setTimeout(...,500): иллюстрации раскладки
     постов тянутся с vimar.ru и могли не успеть → сборка уезжала в PDF недогруженной */
  assert.match(html, /document\.images/, "печать привязана к загрузке изображений");
  assert.match(html, /addEventListener\("load"/, "ждём событие load незагруженных картинок");
  assert.match(html, /addEventListener\("error"/, "битая картинка (error) тоже снимает ожидание");
  assert.match(html, /if\(done\)return;done=true/, "флаг done — печать ровно один раз");
  assert.match(html, /setTimeout\(pr,4000\)/, "предохранитель: печать не позже 4000 мс");
  assert.ok(!/setTimeout\(\(\)=>window\.print\(\),500\)/.test(html), "прежней печати по таймеру больше нет");
});
