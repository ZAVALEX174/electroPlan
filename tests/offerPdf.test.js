/* Автотесты коммерческого предложения (js/offerPdf.js).
   Модуль чистый (как installSheet.js): на вход готовая смета est + форматтеры, на выход строка
   полного HTML-документа — браузер поднимать не нужно. Здесь проверяем только автопечать окна:
   она ждёт загрузки иллюстраций постов (тянутся с vimar.ru) и печатает ровно один раз. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildHtml } = require("../js/offerPdf.js");
const EPEstimate = require("../js/estimate.js");

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* Минимальная смета в форме EPEstimate.build (нужны только поля, читаемые генератором). */
/* Строки несут items (В26: «Оборудование» и суммы строк считаются по изделиям состава): одно изделие
   ценой 20 € × количество 2 = сумма строки 40 €, оборудование 40 €. */
const est = {
  groups: [{ name: "Выключатель", composition: "20001", count: 2, unit: "шт", sum: 40,
    items: [{ kind: "mechanism", code: "20001", name: "Выключатель", count: 1, price: 20 }] }],
  /* В26: материалы/работы печатаются как процент от напечатанного «Оборудования» (totalsShown),
     поэтому задаём проценты (12,5 % и 25 % от 40 € дают прежние 5 € и 10 €), а materials/work (евро)
     остаются признаком показа строки. Итог 40 − 0 + 5 + 10 = 55 €. */
  equipment: 40, discount: 0, materialsPercent: 12.5, workPercent: 25, materials: 5, work: 10,
  subtotal: 55, vat: 0, total: 55
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

/* Позиция без цены (её артикула нет в прайсе) входит в сумму нулём. Экран оговаривает это строкой
   под «Итого» (#pricelessStatus), и печатный КП обязан сказать то же ТЕМИ ЖЕ словами — иначе
   клиенту уйдёт молча неполная сумма. Формулировка одна на оба документа: EPEstimate.pricelessNote.
   Эти тесты краснеют, если оговорка пропадёт из КП, если её текст разойдётся с экранным
   источником, или если она появится там, где позиций без цены нет. */
const estMissing = Object.assign({}, est, { missing: [111, 222] });

test("КП оговаривает позиции без цены ТЕМИ ЖЕ словами, что экран (EPEstimate.pricelessNote)", () => {
  const note = EPEstimate.pricelessNote(estMissing);
  assert.ok(note, "предпосылка: при непустом est.missing формулировка не пуста");
  const html = buildHtml(estMissing, deps);
  /* Печать содержит РОВНО строку из единого источника — не свою копию: разойдётся с экраном
     только если её захардкодят заново, и тогда этот assert покраснеет. */
  assert.ok(html.includes(esc(note)),
    "печатный итог содержит ту же оговорку, что #pricelessStatus на экране");
  assert.match(html, /Позиций без цены: 2/, "число берётся из est.missing (две позиции)");
  /* Оговорка стоит ПОД «Итого» — рядом с суммой, которую она уточняет, а не в конце документа. */
  assert.ok(html.indexOf("Позиций без цены") > html.indexOf("Итого"),
    "оговорка идёт после итога — читается как примечание к сумме");
});

test("нет позиций без цены → оговорки в КП нет (полную сумму не помечаем неполной)", () => {
  const html = buildHtml(est, deps);   // базовый est без поля missing
  assert.ok(!/Позиций без цены/.test(html), "при полной смете оговорки о неполноте нет");
});

/* ТРИ режима НДС в печатном КП (итоги встречи 24.08 §1.2). Смету считает НАСТОЯЩИЙ EPEstimate.build —
   КП берёт из неё числа и подписи, второй копии формулы НДС в offerPdf нет (§7.1). База = 100 €
   (работы/материалы 0), ставка 20%. */
const vatCatalog = { 1: { id: 1, name: "Розетка", code: "R", price: 100, unit: "шт." } };
const vatEst = mode => EPEstimate.build({
  devices: [{ productId: 1 }], posts: [], product: id => vatCatalog[id], frameProduct: id => vatCatalog[id],
  postCost: () => 0, settings: { workPercent: 0, materialsPercent: 0, discountPercent: 0, vatPercent: 20, vatMode: mode }
});
/* Деньги округляем до копеек — чтобы СВЕРЯТЬ СУММУ строки НДС, а не только её подпись: без этого
   мутация «строка печатает est.subtotal вместо est.vat» (100 € вместо 16,67 €) осталась бы зелёной. */
/* displayRate=1 (евро) + moneyShown форматирует УЖЕ-показанное число: КП берёт три числа НДС из
   EPEstimate.vatShown (валюта показа, округлены до копейки) и печатает их без повторного курса (В7). */
const vatDeps = Object.assign({}, deps, { money: n => Number(n).toFixed(2) + " €",
  displayRate: () => 1, moneyShown: n => Number(n).toFixed(2) + " €" });

test("КП «начислить сверху»: база, НДС-слагаемое и итог с НДС — с точными суммами", () => {
  const html = buildHtml(vatEst("surcharge"), vatDeps);
  assert.match(html, /<span>Итого без НДС<\/span><b>100\.00 €<\/b>/, "база до НДС = 100");
  assert.match(html, /<span>НДС 20%<\/span><b>20\.00 €<\/b>/, "НДС отдельной строкой = 20");
  assert.match(html, /<span>Итого с НДС<\/span><b>120\.00 €<\/b>/, "итог = 100 + 20");
  assert.ok(!/в т\.ч\. НДС/.test(html), "сверху — не «в т.ч.»");
});

test("КП «выделить в стоимости»: итог прежний, под ним «в т.ч. НДС 20%» с ВЫДЕЛЕННОЙ суммой", () => {
  const html = buildHtml(vatEst("included"), vatDeps);
  /* сумма строки = est.vat = 100×20/120 = 16,67 €, НЕ est.subtotal (100): ловит подмену поля */
  assert.match(html, /<span>в т\.ч\. НДС 20%<\/span><b>16\.67 €<\/b>/, "выделенный НДС = 16,67, словами заказчика");
  assert.match(html, /<span>Итого<\/span><b>100\.00 €<\/b>/, "итог не меняется — цены уже с НДС");
  assert.ok(!/Итого без НДС/.test(html), "итог не разбивается");
  assert.ok(!/Итого с НДС/.test(html), "итог прежний, без пометки «с НДС»");
  const posGrand = html.indexOf("<span>Итого</span>");
  const posIncl = html.indexOf("в т.ч. НДС");
  assert.ok(posGrand > -1 && posIncl > posGrand, "«в т.ч. НДС» стоит ПОД итогом");
});

test("КП МУТАЦИЯ-ловушка (рубли): итог берётся из totalsShown (целый рубль), не money(est.total)", () => {
  /* К7 (решение владельца 20.10): в рублях каждое число — ЦЕЛЫЙ рубль (цены/суммы/НДС вверх). Вход
     subtotal 0,01 € при курсе 92,5: оборудование = ceil(0,01×92,5)=ceil(0,925)=1 ₽; НДС 5% сверху =
     ceil(1×5/100)=ceil(0,05)=1 ₽; итог = 1+1 = 2 ₽. А money(est.total)=est.total×курс = 0,0105×92,5 =
     0,97 — мутация «КП считает мимо totalsShown» напечатала бы 0,97, здесь видно. moneyShown (стаб
     toFixed(2)) только отображает уже-округлённые ядром числа. */
  const est2 = { groups: [{ name: "X", composition: "X", count: 1, unit: "шт", sum: 0.01,
      items: [{ kind: "mechanism", code: "X", name: "X", count: 1, price: 0.01 }] }],
    equipment: 0.01, discount: 0, materials: 0, work: 0, subtotal: 0.01, missing: [],
    vatMode: "surcharge", vat: 0.0005, vatLabel: "НДС", vatPercent: 5, vatIncluded: false, total: 0.0105 };
  const html = buildHtml(est2, Object.assign({}, deps, { displayCurrency: () => "RUB",
    displayRate: () => 92.5, money: n => (Number(n) * 92.5).toFixed(2), moneyShown: n => Number(n).toFixed(2) }));
  assert.match(html, /<span>Итого без НДС<\/span><b>1\.00<\/b>/, "без НДС = целый рубль вверх (1)");
  assert.match(html, /<span>НДС 5%<\/span><b>1\.00<\/b>/, "НДС вверх до рубля (1)");
  assert.match(html, /<span>Итого с НДС<\/span><b>2\.00<\/b>/, "итог = 1+1 = 2, не 0,97");
  assert.ok(!/<b>0\.97<\/b>/.test(html), "итог НЕ money(est.total)=0,97 — КП не считает мимо правила");
});

test("КП «не учитывать»: строки НДС нет вовсе, итог без НДС", () => {
  const html = buildHtml(vatEst("none"), vatDeps);
  assert.ok(!/НДС/.test(html), "ни одной строки со словом НДС");
  assert.match(html, /<span>Итого<\/span><b>100\.00 €<\/b>/, "итог равен базе, без пометок");
});
