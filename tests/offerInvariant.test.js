/* Инварианты коммерческого предложения (D10). Поведение КП уже сверено вручную (деньги
   совпадают побайтово на восьми наборах флагов, итог 15 040,98 ₽ сверен от прайса), но эти
   правила держались РЕАЛИЗАЦИЕЙ, а не тестами. Здесь закрываем их числами и структурой:

     1. Страж пустого КП спрашивает «будет ли что напечатать», а не «включён ли раздел».
     2. Деньги и состав документа ОДНИ при любом наборе флагов — меняется только показанное.
     3. Обещания коммита: заголовок/примечание свода честны про артикулы, умолчания спецификации
        закреплены, шапка «Состав» без артикулов не обещает артикулов.
     4. Печать раскладки производна ОТ СХЕМЫ — новое поле не даёт номер поста под чужой шапкой,
        а у каждой группы схемы есть подпись легенды.

   Модули чистые (buildHtml/collect), поэтому браузер не нужен; страж КП проверяем на НАСТОЯЩЕМ
   исходнике app.js через общий стенд (helpers/appStand.js). */
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const EPOfferOptions = require("../js/offerOptions.js");
const EPOfferPdf = require("../js/offerPdf.js");
const EPSupplierSpec = require("../js/supplierSpec.js");

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = n => Number(n).toFixed(2) + " €";

/* Смета с РАЗНЫМИ суммами и count>1: цена (sum/count) и сумма (sum) — различимые числа,
   поэтому подмена одной из них флагом артикулов сразу видна в мультимножестве денег. */
const est = () => ({ groups: [
    { name: "Пост 1", composition: "Выключатель, Розетка", count: 3, unit: "компл.", sum: 1071.87,
      items: [{ kind: "mechanism", name: "Выключатель", code: "20001.0", count: 3 }] },
    { name: "Пост 2", composition: "Розетка", count: 2, unit: "компл.", sum: 640.50,
      items: [{ kind: "mechanism", name: "Розетка", code: "20208", count: 2 }] }
  ], equipment: 1712.37, discount: 0, materials: 400, work: 300, subtotal: 2412.37, vat: 0, total: 15040.98, missing: [] });
const layout = () => [{ number: 1, fill: [{ word: "Выключатель", count: 2 }], modules: 3, frameCode: "09663",
  box: { name: "Коробка 3М", code: "V71303", count: 1 }, assembledImageHtml: "<b>СБ</b>", frameName: "Накладка" }];
const render = options => EPOfferPdf.buildHtml(est(), { esc, money, displayCurrency: () => "EUR", options,
  postLayout: layout(), planBlockHtml: "<section>ПЛАН</section>", lightingHtml: "<section>СВЕТ</section>",
  supplierSpecHtml: "<section>СВОД</section>" });
const table = (html, cls) => html.match(new RegExp(`<table class="${cls}">([\\s\\S]*?)</table>`))?.[1] || "";
const headers = t => [...t.matchAll(/<th(?:\s[^>]*)?>(.*?)<\/th>/g)].map(m => m[1]);
const moneys = html => (html.match(/\d+\.\d{2} €/g) || []).sort();

/* Немецко-французская + итальянская сборка — с коробками, суппортами и накладками: восемь
   наименований в своде. Даёт материал для инварианта «состав не зависит от showArticles». */
const spec = () => ({ posts: [
  { mechanisms: [{ code: "20001.0", name: "Выключатель" }], frame: { code: "09663", name: "Накладка 3М" },
    support: { code: "09613", name: "Суппорт 3М" }, supportCount: 1, box: { code: "V71303", name: "Коробка 3М" }, boxCount: 1 },
  { mechanisms: [{ code: "20208", name: "Розетка" }], frame: { code: "09664", name: "Накладка 2+2" },
    support: { code: "09602", name: "Суппорт 2М" }, supportCount: 2, box: { code: "V71701", name: "Коробка круглая" }, boxCount: 2 }
] });
const dataRows = html => (html.match(/width:34px;color:#687f94/g) || []).length;   // № есть у каждой строки тела, не у подзаголовков
const totalNames = html => Number((html.match(/Всего наименований:<\/b>\s*(\d+)/) || [])[1]);

/* ---- Пункт 1: страж пустого КП ---- */

test("D10: hasContent проверяет «раздел что-то напечатает», а не «раздел включён»", () => {
  const base = { esc, money, displayCurrency: () => "EUR", postLayout: layout(),
    planBlockHtml: "<section>ПЛАН</section>", lightingHtml: "<section>СВЕТ</section>", supplierSpecHtml: "<section>СВОД</section>" };
  const allCols = k => ({ number: k, fill: k, modules: k, box: k, article: k, illustration: k });
  const off = { plan: false, layout: false, specification: false, lighting: false, supplier: false };

  /* Раскладка ВКЛЮЧЕНА, но все её столбцы сняты и цены выключены — печатать нечего. */
  const emptyLayout = { prices: false, sections: { ...off, layout: true }, layout: allCols(false) };
  assert.equal(EPOfferPdf.hasContent(est(), { ...base, options: emptyLayout }), false, "раскладка без столбцов не печатается");

  /* План ВКЛЮЧЁН, но чертёж в проект не загружен — planBlockHtml пуст. */
  const emptyPlan = { prices: false, sections: { ...off, plan: true } };
  assert.equal(EPOfferPdf.hasContent(est(), { ...base, options: emptyPlan, planBlockHtml: "" }), false, "план без чертежа не печатается");

  /* Достаточно ОДНОГО непустого блока — тогда документ имеет содержимое. */
  assert.equal(EPOfferPdf.hasContent(est(), { ...base, options: { prices: false, sections: { ...off, layout: true }, layout: allCols(true) } }), true, "хотя бы один столбец раскладки — уже содержимое");
  assert.equal(EPOfferPdf.hasContent(est(), { ...base, options: { prices: false, sections: { ...off, specification: true } } }), true, "спецификация печатает таблицу");
  assert.equal(EPOfferPdf.hasContent(est(), { ...base, options: { prices: true, sections: off } }), true, "цены и итоги — содержимое");
});

/* Настоящий орган управления: снятые столбцы раскладки при выключенных ценах не должны
   открывать окно печати. Исполняем НАСТОЯЩИЙ generateCommercialOffer из app.js. */
function guardStand(offerOptions, over) {
  const dom = stand.makeDom();
  let opened = 0; const toasts = [];
  const ctx = { esc, money, displayCurrency: () => "EUR", EPRates: { effectiveRate: () => 90 },
    EPOfferOptions, EPOfferPdf, EP_DATA: { settings: { offerOptions } }, state: { posts: [] },
    projectLighting: () => ({ plan: { groups: [], gaps: [], relays: [], totals: {} } }),
    buildEstimate: () => est(),
    buildPostLayout: () => layout(),
    docHeader: () => ({}),
    planBlockHtml: () => (over && "planBlockHtml" in over) ? over.planBlockHtml : "<section>ПЛАН</section>",
    lightingHtml: () => "<section>СВЕТ</section>", supplierSpecHtml: () => "<section>СВОД</section>",
    toast: m => toasts.push(m), $: dom.$,
    window: { open: () => { opened++; return { document: { write() {}, close() {} } }; } } };
  stand.run("generateCommercialOffer", ctx)();
  return { opened, toasts };
}

test("D10: generateCommercialOffer не открывает окно печати для пустого документа", () => {
  const off = { plan: false, layout: false, specification: false, lighting: false, supplier: false };
  const emptyLayout = guardStand({ prices: false, sections: { ...off, layout: true },
    layout: { number: false, fill: false, modules: false, box: false, article: false, illustration: false } });
  assert.equal(emptyLayout.opened, 0, "окно печати не открылось");
  assert.match(emptyLayout.toasts.join("|"), /нечего печатать/, "пользователю сказано, что печатать нечего");

  const emptyPlan = guardStand({ prices: false, sections: { ...off, plan: true } }, { planBlockHtml: "" });
  assert.equal(emptyPlan.opened, 0, "план без чертежа тоже не открывает окно");

  const withSpec = guardStand({ prices: false, sections: { ...off, specification: true } });
  assert.equal(withSpec.opened, 1, "документ с содержимым открывается как прежде");
});

/* ---- Пункт 2: инвариант «одни числа и один состав при любых флагах» ---- */

test("D10-инвариант: суммы и цены КП не зависят от флага артикулов", () => {
  const withArt = render({ articles: true, prices: true });
  const noArt = render({ articles: false, prices: true });
  assert.deepEqual(moneys(noArt), moneys(withArt), "мультимножество денег одно и то же");
  assert.ok(withArt.includes("15040.98 €") && noArt.includes("15040.98 €"), "итог не плывёт");
  assert.ok(withArt.includes("1071.87 €") && noArt.includes("1071.87 €"), "сумма строки не пересчитывается");
});

test("D10-инвариант: состав свода не зависит от showArticles — тело и итог всегда совпадают", () => {
  for (const showArticles of [true, false]) {
    const html = EPSupplierSpec.buildHtml(spec(), { esc, showArticles });
    assert.equal(dataRows(html), totalNames(html), `showArticles=${showArticles}: строк в теле столько же, сколько в «Всего наименований»`);
    assert.match(html, /Коробка 3М/, `showArticles=${showArticles}: монтажные коробки на месте`);
    assert.match(html, /Коробка круглая/, `showArticles=${showArticles}: вторая коробка на месте`);
  }
});

/* ---- Пункт 3: обещания коммита ---- */

test("D10: заголовок и примечание свода честны про артикулы", () => {
  const withArt = EPSupplierSpec.buildHtml(spec(), { esc, showArticles: true });
  const noArt = EPSupplierSpec.buildHtml(spec(), { esc, showArticles: false });
  assert.match(withArt, /Сводная спецификация по артикулам/);
  assert.match(withArt, /сведены по артикулам/);
  assert.doesNotMatch(noArt, /по артикулам/, "без артикулов ни заголовок, ни примечание не обещают артикулы");
  assert.match(noArt, /Сводная спецификация</, "заголовок без «по артикулам»");
  assert.match(noArt, /Артикулы скрыты/, "примечание объясняет отсутствие артикулов");
});

test("D10: умолчания столбцов спецификации закреплены — ед./цена/сумма по умолчанию включены", () => {
  assert.deepEqual(EPOfferOptions.normalize().specification,
    { number: true, composition: true, article: false, quantity: true, unit: true, price: true, sum: true });
  assert.deepEqual(EPOfferOptions.normalize().specification, EPOfferOptions.preset("full").specification);
});

test("D10: без артикулов шапка состава — просто «Состав», а не «Состав / артикул»", () => {
  const noArt = headers(table(render({ articles: false, specification: { composition: true, price: false, sum: false } }), "specification"));
  assert.ok(noArt.includes("Состав"), "колонка состава есть");
  assert.ok(!noArt.includes("Состав / артикул"), "без артикулов шапка не обещает артикулы");
  const withArt = headers(table(render({ articles: true, specification: { composition: true } }), "specification"));
  assert.ok(withArt.includes("Состав / артикул"), "с артикулами шапка объединяет состав и артикул");
});

/* ---- Пункт 4: печать производна от схемы ---- */

test("D10: новое поле схемы раскладки не даёт номер поста под чужой шапкой", () => {
  const key = "__probe__", label = "Проба-XZ";
  EPOfferOptions.fields.layout.push([key, label, true]);
  try {
    const html = render({ layout: { number: false, fill: false, modules: false, box: false, article: false, illustration: false, [key]: true } });
    /* Поле без рендерера в колонки не попадает: ни шапки, ни номера поста под ней. */
    assert.ok(!html.includes(label), "колонка без рендерера не печатается — нет шапки под чужие данные");
    assert.equal(table(html, "layout"), "", "единственный включённый столбец без рендерера → раскладки нет вовсе");
  } finally {
    EPOfferOptions.fields.layout.pop();
  }
});

test("D10: у каждой группы схемы есть подпись легенды — не «undefined»", () => {
  for (const group of Object.keys(EPOfferOptions.fields))
    assert.ok(EPOfferOptions.groupLabels[group], "нет подписи группы: " + group);
});

/* ---- Пункт 5: утечка артикула и пустая подпись ---- */

test("D10: артикул-вариант в имени вычищается без артикулов, имя-артикул не исчезает", () => {
  /* Собственный код товара — «19208.C», в имени стоит его цветовой вариант «19208.C.01»:
     это тот же артикул, а не другое число, и без артикулов он обязан уйти целиком. */
  assert.equal(EPOfferOptions.itemText("Розетка серая 19208.C.01", false, "19208.C"), "Розетка серая");
  /* Имя, целиком равное артикулу, — единственная подпись товара: пустой строкой её не заменяем. */
  assert.equal(EPOfferOptions.itemText("19208.C", false, "19208.C"), "19208.C");
  /* Прежняя защита цела: код-приставка чужого числа не режется. */
  assert.equal(EPOfferOptions.itemText("Модель 200011", false, "20001"), "Модель 200011");
});
