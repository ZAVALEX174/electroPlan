/* Наборы столбцов печатных форм (ответы заказчика EPG 16.09, §6 «Столбцы печатных форм»):
   готовые наборы «Для строителя / Для клиента / Для дизайнера» и до трёх СВОИХ наборов пользователя.

   Проверяем до НАБЛЮДАЕМОГО — по готовой печатной форме КП (EPOfferPdf.buildHtml), а не по флагам:
   у каждого набора заказчика в форме есть нужные столбцы и НЕТ лишних. Единственный документ-
   потребитель offerOptions — КП (offerPdf); лист монтажника (installSheet) эти поля не читает,
   поэтому здесь его нет.

   МУТАЦИИ (сломать код — тест краснеет):
     (а) «Для строителя» подменить на полный список (return normalize())  → красит «строитель — 6
         столбцов раскладки, без спецификации/итогов/€»;
     (б) saveCustomOfferPreset без EPPrefs.set(...)                         → красит «свой набор пишется
         в EPPrefs»;
     (в) applyOfferPreset/applyCustomOfferPreset не пишут EP_DATA           → красит «выбор набора
         доезжает до печатной формы» (столбцы остаются от прежнего набора).
   Запуск: node --test tests/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const EPOfferOptions = require("../js/offerOptions.js");
const EPOfferPdf = require("../js/offerPdf.js");
const EPPrefs = require("../js/prefs.js");

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = n => Number(n).toFixed(2) + " €";
/* Смета с одним постом: sum 42.50 — маркер, по которому видно и стоимость блока в раскладке,
   и итоги. Коды M.01/F.01/B.01 ловят утечку артикулов там, где их быть не должно. */
const est = () => ({ groups: [{ name: "Пост 1", composition: "Розетка, белая", count: 1, unit: "компл.", sum: 42.5,
  items: [{ kind: "mechanism", name: "Розетка, белая", code: "M.01", count: 1 }] }],
  equipment: 42.5, discount: 0, materials: 5, work: 10, subtotal: 57.5, vat: 0, total: 57.5, missing: [] });
/* itemPrices — разбивка «стоимости блока» (42.5) по изделиям, сумма ровно 42.5: так столбец
   «Стоимость артикулов» согласован со «стоимостью блока». Настоящую разбивку с заменой цельных
   изделий стережёт мутация (б) в integratedSwitchDocuments — здесь достаточно фикстуры. */
const layout = () => [{ number: 1, fill: [{ word: "Розетка", count: 1 }], modules: 2, frameCode: "F.01",
  box: { name: "Коробка", code: "B.01", count: 1 }, assembledImageHtml: "<b>СБ</b>", frameName: "Накладка", price: 42.5,
  itemPrices: [{ kind: "mechanism", name: "Розетка, белая", code: "M.01", count: 1, price: 30 },
    { kind: "box", name: "Коробка", code: "B.01", count: 1, price: 5 },
    { kind: "frame", name: "Накладка", code: "F.01", count: 1, price: 7.5 }] }];
const render = options => EPOfferPdf.buildHtml(est(), { esc, money, displayCurrency: () => "EUR", options,
  postLayout: layout(), planBlockHtml: "<section>ПЛАН</section>", lightingHtml: "<section>СВЕТ</section>", supplierSpecHtml: "<section>СВОД</section>" });
const table = (html, cls) => html.match(new RegExp(`<table class="${cls}">([\\s\\S]*?)</table>`))?.[1] || "";
const headers = t => [...t.matchAll(/<th(?:\s[^>]*)?>(.*?)<\/th>/g)].map(m => m[1]);

/* ---- Наборы заказчика в готовой печатной форме ---- */

test("«Для строителя»: раскладка ровно из 6 столбцов, без цен и прочих разделов (мутация а)", () => {
  const html = render(EPOfferOptions.preset("builder"));
  assert.deepEqual(headers(table(html, "layout")),
    ["№ поста", "Наполнение", "Модульность", "Монтажная коробка", "Артикул накладки", "Иллюстрация"],
    "столбцы ровно по словам заказчика");
  assert.match(html, /F\.01/, "артикул накладки печатается — строителю он нужен");
  /* Подмена строителя на полный список зажжётся здесь: у него нет цен и денежных разделов. */
  assert.equal(table(html, "specification"), "", "спецификации у строителя нет");
  assert.doesNotMatch(html, /€|class="totals"|Стоимость блока/, "у строителя нет цен и столбца стоимости");
  assert.doesNotMatch(html, /ПЛАН|СВЕТ|СВОД/, "прочие разделы у строителя выключены");
});

test("«Для клиента»: номер, наполнение, иллюстрация, стоимость блока — без артикула и модульности", () => {
  const html = render(EPOfferOptions.preset("client"));
  const t = table(html, "layout");
  assert.deepEqual(headers(t), ["№ поста", "Наполнение", "Иллюстрация", "Стоимость блока"], "столбцы ровно по словам заказчика");
  assert.match(html, /42\.50 €/, "стоимость блока напечатана в валюте показа");
  assert.ok(!headers(t).includes("Модульность"), "у клиента нет модульности");
  assert.ok(!headers(t).includes("Артикул накладки"), "у клиента нет артикула накладки");
  assert.ok(!headers(t).includes("Монтажная коробка"), "у клиента нет монтажной коробки");
  assert.equal(table(html, "specification"), "", "спецификации у клиента нет");
  assert.doesNotMatch(html, /M\.01|F\.01|B\.01/, "артикулы состава/накладки/коробки клиенту не печатаются");
});

test("«Для дизайнера»: весь список — ВСЕ столбцы раскладки (обе цены), все разделы и итоги (мутация а)", () => {
  const html = render(EPOfferOptions.preset("designer"));
  /* «Весь список» заказчика: восемь столбцов раскладки, включая монтажную коробку, артикул и ОБЕ
     цены — стоимость блока и стоимость артикулов. */
  assert.deepEqual(headers(table(html, "layout")),
    ["№ поста", "Наполнение", "Модульность", "Монтажная коробка", "Артикул накладки", "Иллюстрация", "Стоимость блока", "Стоимость артикулов"],
    "у дизайнера все столбцы раскладки, оба денежных");
  assert.match(html, /Раскладка постов/); assert.match(html, /Спецификация и комплектация/);
  assert.match(html, /ПЛАН/); assert.match(html, /СВЕТ/); assert.match(html, /СВОД/);
  assert.match(html, /class="totals"/); assert.match(html, /42\.50 €/, "стоимость блока напечатана");
  /* Столбец «Стоимость артикулов» печатает цену КАЖДОГО изделия поста. */
  assert.match(html, /Розетка, белая — 30\.00 €/, "цена изделия из наполнения поста");
  assert.match(html, /Накладка — 7\.50 €/, "цена накладки поста");
  /* Мутация (а): верни «Для дизайнера» к умолчаниям (normalize()/full) — новый столбец ВЫКЛЮЧЕН,
     дизайнер недосчитается ровно его. Набор обязан включать его САМ, не полагаясь на умолчания. */
  assert.equal(EPOfferOptions.preset("designer").layout.itemPrices, true, "новый столбец включён в наборе дизайнера");
  assert.ok(!EPOfferOptions.preset("full").layout.itemPrices, "в «Полном КП» (умолчаниях) он выключен — designer их перекрывает");
});

test("столбец «Стоимость артикулов»: включён — цены изделий видны, выключен — их нет; галочка доезжает до печати (мутация в)", () => {
  const ctx = { EP_DATA: { settings: { offerOptions: EPOfferOptions.preset("client") } },
    EPOfferOptions, syncOfferOptions: () => {}, scheduleSave: () => {} };
  /* Клиентский набор — с ценами (prices:true), поэтому денежный столбец разрешён; включаем его галочкой. */
  stand.run("applyOfferOption", ctx)({ dataset: { offerGroup: "layout", offerKey: "itemPrices" }, checked: true });
  let t = table(render(ctx.EP_DATA.settings.offerOptions), "layout");
  assert.ok(headers(t).includes("Стоимость артикулов"), "включённая галочка добавила столбец в печать");
  assert.match(t, /Розетка, белая — 30\.00 €/, "и он печатает цены изделий поста");
  stand.run("applyOfferOption", ctx)({ dataset: { offerGroup: "layout", offerKey: "itemPrices" }, checked: false });
  t = table(render(ctx.EP_DATA.settings.offerOptions), "layout");
  assert.ok(!headers(t).includes("Стоимость артикулов"), "снятая галочка убрала столбец из печати");
  assert.doesNotMatch(t, /Розетка, белая — 30\.00 €/, "цен изделий в печати больше нет");
});

/* ---- Свои наборы: чистая логика (ровно 3 слота, имя, перезапись) ---- */

test("свои наборы: ровно 3 слота; безымянный/пробельный и лишний слот отбрасываются", () => {
  assert.equal(EPOfferOptions.CUSTOM_SLOTS, 3);
  const list = EPOfferOptions.normalizeCustomPresets([
    { name: "Мой А", options: EPOfferOptions.preset("client") },
    { name: "   ", options: EPOfferOptions.preset("builder") },
    null,
    { name: "Лишний", options: EPOfferOptions.preset("boxes") }
  ]);
  assert.equal(list.length, 3, "ровно CUSTOM_SLOTS слотов");
  assert.equal(list[0].name, "Мой А");
  assert.ok(EPOfferOptions.sameOptions(list[0].options, EPOfferOptions.preset("client")), "состав нормализован и сохранён");
  assert.equal(list[1], null, "пробельное имя — слот пуст");
  assert.equal(list[2], null);
  assert.equal(EPOfferOptions.normalizeCustomPresets("мусор").length, 3, "чужой тип → 3 пустых слота");
});

test("свои наборы: сохранение, перезапись; пустое имя и слот вне диапазона не меняют список; вход не мутируется", () => {
  const empty = [];
  const emptyJson = JSON.stringify(empty);
  const saved = EPOfferOptions.saveCustomPreset(empty, 1, "Кухня", EPOfferOptions.preset("builder"));
  assert.equal(JSON.stringify(empty), emptyJson, "вход не мутируется (снимок/EPPrefs по ссылке не меняем)");
  assert.equal(saved[1].name, "Кухня");
  assert.ok(EPOfferOptions.sameOptions(saved[1].options, EPOfferOptions.preset("builder")));
  const over = EPOfferOptions.saveCustomPreset(saved, 1, "Кухня 2", EPOfferOptions.preset("client"));
  assert.equal(over[1].name, "Кухня 2", "перезапись слота под новым именем");
  assert.ok(EPOfferOptions.sameOptions(over[1].options, EPOfferOptions.preset("client")));
  assert.equal(EPOfferOptions.saveCustomPreset(over, 1, "  ", EPOfferOptions.preset("boxes"))[1].name, "Кухня 2", "пустое имя не перезаписывает");
  assert.equal(EPOfferOptions.saveCustomPreset(over, 5, "Вне", EPOfferOptions.preset("boxes")).length, 3, "слот вне диапазона не растит список");
});

test("свои наборы переживают перезагрузку через EPPrefs (localStorage)", () => {
  const store = {};
  global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  try {
    const saved = EPOfferOptions.saveCustomPreset(EPPrefs.get("offerPresets", []), 0, "Клиентский", EPOfferOptions.preset("client"));
    EPPrefs.set("offerPresets", saved);
    /* Новый EPPrefs.get читает localStorage заново — это и есть «после перезагрузки»: своего
       кэша в памяти у prefs.js нет. */
    const list = EPOfferOptions.normalizeCustomPresets(EPPrefs.get("offerPresets", []));
    assert.equal(list[0].name, "Клиентский", "имя набора уцелело");
    assert.ok(EPOfferOptions.sameOptions(list[0].options, EPOfferOptions.preset("client")), "состав уцелел");
  } finally {
    delete global.localStorage;
  }
});

/* ---- Связки app.js: сохранение в EPPrefs, выбор доезжает до печатной формы ---- */

test("saveCustomOfferPreset пишет набор в EPPrefs под введённым именем (мутация б)", () => {
  const store = {};
  const dom = stand.makeDom();
  const ctx = { EPOfferOptions,
    EPPrefs: { get: (k, fb) => (k in store ? store[k] : fb), set: (k, v) => { store[k] = v; } },
    EP_DATA: { settings: { offerOptions: EPOfferOptions.preset("client") } },
    prompt: () => "Мой клиентский", $: dom.$, esc,
    document: { querySelectorAll: () => [] } };
  stand.run(["customOfferPresets", "highlightActiveOfferPreset", "renderCustomOfferPresets", "saveCustomOfferPreset"], ctx)(0);
  const list = EPOfferOptions.normalizeCustomPresets(store.offerPresets);
  assert.equal(list[0].name, "Мой клиентский", "набор записан в EPPrefs.offerPresets");
  assert.ok(EPOfferOptions.sameOptions(list[0].options, EPOfferOptions.preset("client")), "с текущим составом");
  assert.match(dom.$("offerCustomPresets").innerHTML, /Мой клиентский/, "кнопка набора перерисована");
});

test("пустое название — набор не сохраняется (prompt отменён)", () => {
  const store = {};
  const dom = stand.makeDom();
  const ctx = { EPOfferOptions,
    EPPrefs: { get: (k, fb) => (k in store ? store[k] : fb), set: (k, v) => { store[k] = v; } },
    EP_DATA: { settings: { offerOptions: EPOfferOptions.preset("client") } },
    prompt: () => null, $: dom.$, document: { querySelectorAll: () => [] } };
  stand.run(["customOfferPresets", "highlightActiveOfferPreset", "renderCustomOfferPresets", "saveCustomOfferPreset"], ctx)(0);
  assert.equal("offerPresets" in store, false, "без имени в EPPrefs ничего не записано");
});

test("выбор набора заказчика доезжает до печатной формы (мутация в)", () => {
  const ctx = { EP_DATA: { settings: { offerOptions: EPOfferOptions.preset("designer") } },
    EPOfferOptions, syncOfferOptions: () => {}, scheduleSave: () => {} };
  stand.run("applyOfferPreset", ctx)("client");
  const t = table(render(ctx.EP_DATA.settings.offerOptions), "layout");
  assert.deepEqual(headers(t), ["№ поста", "Наполнение", "Иллюстрация", "Стоимость блока"], "печать взяла новый набор из EP_DATA");
  assert.doesNotMatch(t, /Модульность|Артикул накладки/, "столбцы прежнего набора не залипли");
});

test("выбор СВОЕГО набора доезжает до печатной формы", () => {
  const store = { offerPresets: EPOfferOptions.saveCustomPreset([], 2, "Мой строитель", EPOfferOptions.preset("builder")) };
  const ctx = { EPOfferOptions, EPPrefs: { get: (k, fb) => (k in store ? store[k] : fb), set: () => {} },
    EP_DATA: { settings: { offerOptions: EPOfferOptions.preset("client") } },
    syncOfferOptions: () => {}, scheduleSave: () => {} };
  stand.run(["customOfferPresets", "applyCustomOfferPreset"], ctx)(2);
  assert.deepEqual(headers(table(render(ctx.EP_DATA.settings.offerOptions), "layout")),
    ["№ поста", "Наполнение", "Модульность", "Монтажная коробка", "Артикул накладки", "Иллюстрация"],
    "печать взяла свой набор «Мой строитель»");
});

/* ---- Активный набор виден человеку ---- */

test("активный набор подсвечен: класс active у кнопки, совпадающей с текущим составом", () => {
  const builderBtn = stand.makeElement({ dataset: { offerPreset: "builder" } });
  const clientBtn = stand.makeElement({ dataset: { offerPreset: "client" } });
  const designerBtn = stand.makeElement({ dataset: { offerPreset: "designer" } });
  const presetBtns = [builderBtn, clientBtn, designerBtn];
  const document = { querySelectorAll: sel => (sel === "[data-offer-preset]" ? presetBtns : []) };
  const ctx = { document, EPOfferOptions, EPPrefs: { get: (k, fb) => fb },
    EP_DATA: { settings: { offerOptions: EPOfferOptions.preset("client") } } };
  stand.run(["customOfferPresets", "highlightActiveOfferPreset"], ctx)();
  assert.equal(clientBtn.classList.contains("active"), true, "текущий набор «Для клиента» подсвечен");
  assert.equal(builderBtn.classList.contains("active"), false);
  assert.equal(designerBtn.classList.contains("active"), false);
});
