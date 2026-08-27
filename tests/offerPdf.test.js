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

/* Контракт вставки плана: КП печатает готовую секцию «план с бирками» (EPPlanLabels) и ставит
   её ПЕРЕД «Раскладкой постов» — так устроен эталонный документ заказчика (титул → план →
   таблица постов), по нему клиент сверяет номер на бирке с номером в таблице. Без этих тестов
   вставку можно было бы случайно удалить или переставить, и ни один тест бы не покраснел. */
test("план с бирками попадает в КП и стоит перед раскладкой постов", () => {
  const marker = '<section data-test="plan-block">план</section>';
  /* Раздел «Раскладка постов» рисуется только при непустом postLayout — иначе сверять
     порядок было бы не с чем, и тест ничего бы не доказывал. */
  const withPosts = Object.assign({}, deps, {
    planBlockHtml: marker,
    postLayout: [{ number: 1, modules: 2, fill: [{ word: "Выключатель", count: 2 }], assembledImageHtml: "", frameName: "Рамка" }]
  });
  const html = buildHtml(est, withPosts);
  assert.ok(html.includes(marker), "секция плана напечатана");
  const posPlan = html.indexOf(marker);
  const posLayout = html.indexOf("Раскладка постов");
  assert.ok(posLayout > -1, "раздел «Раскладка постов» на месте");
  assert.ok(posPlan < posLayout, "план идёт ДО раскладки постов, как в эталоне заказчика");
});

test("без плана КП собирается как раньше — пустого места не остаётся", () => {
  const withOut = buildHtml(est, Object.assign({}, deps, { planBlockHtml: "" }));
  const undef = buildHtml(est, deps);
  assert.ok(!/data-test="plan-block"/.test(withOut), "секции плана нет");
  assert.equal(withOut, undef, "пустая строка и отсутствие поля дают одинаковый документ");
});
