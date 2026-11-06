/* Экспликация по комнатам «считает КАК В КП» (Б7, решение владельца 05.11). СКВОЗНОЙ тест через
   НАСТОЯЩИЕ buildPostLayout/смету на РЕАЛЬНОМ каталоге VIMAR (а не через заглушку buildPostLayout, как
   прежний roomSheet.test.js — из-за заглушки мутации «нет id в buildPostLayout» и «height:""» выживали).

   Проверяем, что экспликация и КП дают ОДИН блок итогов теми же цифрами (EUR и RUB), что у поста со
   скидкой печатается та же пометка, что отдельные изделия садятся в свои комнаты, а при позиции без
   цены печатается та же оговорка «сумма неполна». Каждый тест обязан КРАСНЕТЬ на своей мутации (§7.1):
     M1 — итог без скидки (EPDocTotals: строка «Скидка» не печатается);
     M2 — пометка скидки пропала (EPEstimate.discountMark → "");
     M3 — изделие не попало в комнату (roomSheetForProject: devices не раскладываются);
     M4 — pricelessNote не печатается (EPDocTotals: оговорка пустая);
     M5 — нет id в buildPostLayout (layoutById не находит пост → строки постов рушатся/пустеют). */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const EPEstimate = require("../js/estimate.js");
const EPPosts = require("../js/posts.js");
const EPOfferPdf = require("../js/offerPdf.js");
const EPDocTotals = require("../js/docTotals.js");
const EPRoomSheet = require("../js/roomSheet.js");
const EPOfferOptions = require("../js/offerOptions.js");

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/* moneyShown как в приложении по валюте показа: числа приходят из totalsShown УЖЕ округлёнными. */
const mkMoney = cur => n => (cur === "RUB" ? String(Math.round(Number(n))) + " ₽" : Number(n).toFixed(2).replace(".", ",") + " €");

/* Настоящий каталог VIMAR — теми же данными, что грузит браузер. */
const realProducts = stand.loadVimarCatalog().products || [];
const realById = new Map(realProducts.map(p => [p.id, p]));
const idByCode = code => (realProducts.find(p => p.code === code) || {}).id;

/* Коробку/суппорт/подсветку не подбираем: на предмет теста (итоги, скидка, изделия) не влияют. */
const realDeps = {
  product: id => realById.get(id), frameProduct: id => realById.get(id),
  mechanismSpan: it => (it && it.moduleSpan) || 1,
  findBox: () => null, fallbackBox: () => null,
  supportRequired: () => true, resolveSupport: () => ({ support: null, assumed: false }),
  findBacklight: () => null, backlight: { enabled: false }, wallType: "solid"
};
const postCost = p => EPPosts.postCost(p, realDeps);
const postComposition = p => EPPosts.postComposition(p, realDeps);

/* Проект: Кухня (пост со своей скидкой 10% при общей 0), Гостиная (обычный пост + изделие в каталоге +
   изделие БЕЗ артикула → позиция без цены). */
const SETTINGS = { discountPercent: 0, materialsPercent: 7, workPercent: 18, vatPercent: 20, vatMode: "surcharge" };
const ROOMS = [{ id: "r1", name: "Кухня (немецкий)" }, { id: "r2", name: "Гостиная" }];
const POSTS = [
  { id: "p1", number: 1, name: "Пост со скидкой", frameId: idByCode("14931"),
    mechanismIds: [idByCode("19021"), idByCode("20021")], roomId: "r1", discount: 10 },
  { id: "p2", number: 2, name: "Обычный пост", frameId: idByCode("14931"),
    mechanismIds: [idByCode("14021")], roomId: "r2" }
];
const DEV_IN_CATALOG = { productId: idByCode("14021"), roomId: "r2" };
const DEV_PRICELESS = { productId: "ARTX-404", roomId: "r2" };   // нет в каталоге → est.missing
const DEVICES = [DEV_IN_CATALOG, DEV_PRICELESS];

function buildEst() {
  return EPEstimate.build({ devices: DEVICES, posts: POSTS,
    product: id => realById.get(id), frameProduct: id => realById.get(id),
    postCost, postComposition, lightingOf: () => [], settings: SETTINGS });
}

/* Экспликация НАСТОЯЩИМ roomSheetForProject поверх НАСТОЯЩИХ buildPostLayout/postTotalCost/postPricedItems
   (в одном vm-контексте), buildEstimate — тот же EPEstimate.build, что у КП. Возвращает записанный HTML. */
function explicationHtml(currency, rate) {
  const m = mkMoney(currency);
  let written = "";
  const toasted = [];
  const ctx = {
    Object, Array, Number, String, RegExp, JSON, Map, Set, Infinity,
    window: { open: () => ({ document: { write: s => { written += s; }, close() {} } }) },
    state: { posts: POSTS, rooms: ROOMS, devices: DEVICES },
    toast: msg => toasted.push(msg),
    product: id => realById.get(id), frameProduct: id => realById.get(id),
    postComposition, postCost, lightingRowsFor: () => [], projectLighting: () => null,
    assembledPostHtml: () => "",
    displayRate: () => rate, displayCurrency: () => currency, moneyShown: m, esc,
    buildEstimate: () => buildEst(),
    roomDisplayArea: r => r.area || "",
    docHeader: () => ({ project: "П", developer: "Р", date: "05.11.2026" }),
    companyLogo: () => "",
    EPEstimate, EPPosts, EPOfferOptions, EPDocTotals, EPRoomSheet,
    EP_DATA: { settings: SETTINGS }
  };
  const run = stand.run(["postTotalCost", "postPricedItems", "buildPostLayout", "postsByRooms", "roomSheetForProject"], ctx);
  run();
  return { written, toasted };
}

/* КП НАСТОЯЩИМ EPOfferPdf на той же смете — чтобы сверять блок итогов с экспликацией. */
function kpHtml(currency, rate) {
  const m = mkMoney(currency);
  return EPOfferPdf.buildHtml(buildEst(), {
    money: m, moneyShown: m, esc, displayCurrency: () => currency, displayRate: () => rate,
    settings: SETTINGS, options: EPOfferOptions.normalize({}),
    header: { project: "П", developer: "Р", date: "05.11.2026" }, postLayout: []
  });
}

/* Секция конкретной комнаты в экспликации — от её <h2> до следующего <h2> (или блока итогов). */
function roomSection(html, name) {
  const start = html.indexOf(`>${name}`);
  assert.ok(start >= 0, `секция комнаты «${name}» найдена`);
  const rest = html.slice(start);
  const next = rest.indexOf('class="room-heading"', 10);
  const totals = rest.indexOf('class="totals"');
  const end = next >= 0 ? next : (totals >= 0 ? totals : rest.length);
  return rest.slice(0, end);
}

for (const { currency, rate } of [{ currency: "EUR", rate: 1 }, { currency: "RUB", rate: 92.5 }]) {
  test(`экспликация: блок итогов — ТОТ ЖЕ, что в КП, теми же цифрами (${currency})`, () => {
    const est = buildEst();
    const m = mkMoney(currency);
    const totals = EPEstimate.totalsShown(est, rate, currency);
    const footer = EPDocTotals.footerHtml(est, { moneyShown: m, esc, rate, currency, prices: true });
    const { written, toasted } = explicationHtml(currency, rate);
    const kp = kpHtml(currency, rate);

    assert.deepEqual(toasted, [], "экспликация открылась без тостов");
    /* Один и тот же блок итогов встроен И в КП, И в экспликацию — цифры и вёрстка совпадают по
       построению (мутация M1/M4 рушит обе проверки). */
    assert.ok(footer && footer.includes("Оборудование"), "блок итогов непуст");
    assert.ok(kp.includes(footer), "КП печатает этот блок итогов");
    assert.ok(written.includes(footer), "экспликация печатает ТОТ ЖЕ блок итогов");
    /* Явные цифры — чтобы при падении было видно, какое число разошлось. */
    assert.match(written, new RegExp("Оборудование</span><b>" + m(totals.equipment).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(written, new RegExp("−" + m(totals.discount).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "строка «Скидка» с её суммой (M1)");
    assert.match(written, new RegExp("Итого с НДС</span><b>" + m(totals.total).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
}

test("экспликация: у поста со скидкой пометка «скидка 10%», ровно у одного поста (M2)", () => {
  const { written } = explicationHtml("EUR", 1);
  assert.match(written, /скидка 10%/, "пометка личной скидки поста");
  assert.equal((written.match(/class="pl-disc"/g) || []).length, 1, "пометка ровно у поста с личной скидкой");
});

test("экспликация: отдельное изделие появляется в СВОЕЙ комнате строкой (M3)", () => {
  const { written } = explicationHtml("EUR", 1);
  const dev = realById.get(DEV_IN_CATALOG.productId);
  assert.ok(dev && dev.name, "изделие есть в каталоге");
  const guest = roomSection(written, "Гостиная");
  assert.ok(guest.includes(esc(dev.name)), "изделие в каталоге — строкой в «Гостиной»");
  assert.ok(guest.includes("Товар не найден (арт. ARTX-404)"), "изделие без артикула — тоже строкой в «Гостиной»");
  /* В «Кухне» изделий нет — туда они просочиться не должны. */
  const kitchen = roomSection(written, "Кухня (немецкий)");
  assert.ok(!kitchen.includes(esc(dev.name)), "изделие Гостиной не попало в Кухню");
});

test("экспликация: при позиции без цены печатается та же оговорка «сумма неполна», что в КП (M4)", () => {
  const { written } = explicationHtml("EUR", 1);
  assert.match(written, /Сумма неполна/, "оговорка о неполноте итога");
  assert.match(written, /Позиций без цены/, "с числом позиций без цены");
});

test("экспликация: цена изделия — та же, что в спецификации КП (specShown)", () => {
  const est = buildEst();
  const spec = EPEstimate.specShown(est, 1, "EUR");
  /* Находим строку спецификации изделия в каталоге по его члену-группе. */
  let unit = null;
  est.groups.forEach((g, i) => (g.members || []).forEach(mref => { if (mref === DEV_IN_CATALOG) unit = spec.rows[i].price; }));
  assert.ok(unit != null && unit > 0, "у изделия есть цена в спецификации");
  const { written } = explicationHtml("EUR", 1);
  const guest = roomSection(written, "Гостиная");
  assert.ok(guest.includes(mkMoney("EUR")(unit)), "цена изделия в экспликации = цене строки спецификации КП");
});

test("экспликация: совсем пустой проект → тост, окно не открывается", () => {
  let opened = false;
  const toasted = [];
  const ctx = {
    Object, Array, Number, String, RegExp, JSON, Map, Set, Infinity,
    window: { open: () => { opened = true; return { document: { write() {}, close() {} } }; } },
    state: { posts: [], rooms: [], devices: [] },
    toast: m => toasted.push(m),
    product: id => realById.get(id), frameProduct: id => realById.get(id),
    postComposition, postCost, lightingRowsFor: () => [], projectLighting: () => null,
    assembledPostHtml: () => "", displayRate: () => 1, displayCurrency: () => "EUR",
    moneyShown: mkMoney("EUR"), esc, buildEstimate: () => buildEst(), roomDisplayArea: () => "",
    docHeader: () => ({}), companyLogo: () => "",
    EPEstimate, EPPosts, EPOfferOptions, EPDocTotals, EPRoomSheet, EP_DATA: { settings: SETTINGS }
  };
  stand.run(["postTotalCost", "postPricedItems", "buildPostLayout", "postsByRooms", "roomSheetForProject"], ctx)();
  assert.equal(opened, false, "окно печати не открыто");
  assert.equal(toasted.length, 1, "показан тост о пустом проекте");
});
