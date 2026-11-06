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
const EPPackTopUp = require("../js/packTopUp.js");

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
/* Один артикул (20021) в РАЗНЫХ комнатах: в смете сливаются в одну группу count 2 (цена per-unit ≠ sum) —
   ловит мутацию «цена изделия из .sum вместо .price». */
const DEV_SAME1 = { productId: idByCode("20021"), roomId: "r1" };
const DEV_SAME2 = { productId: idByCode("20021"), roomId: "r2" };
/* Изделие с ЛИЧНОЙ скидкой → пометка «скидка 15%» (общая 0). */
const DEV_DISC = { productId: idByCode("19021"), roomId: "r2", discount: 15 };
/* Без комнаты и в УДАЛЁННОЙ комнате → оба в «Без помещения» (один артикул 19021 без скидки → count 2). */
const DEV_NOROOM = { productId: idByCode("19021"), roomId: null };
const DEV_DEAD = { productId: idByCode("19021"), roomId: "ghost-room" };
const DEVICES = [DEV_IN_CATALOG, DEV_PRICELESS, DEV_SAME1, DEV_SAME2, DEV_DISC, DEV_NOROOM, DEV_DEAD];

function buildEst() {
  return EPEstimate.build({ devices: DEVICES, posts: POSTS,
    product: id => realById.get(id), frameProduct: id => realById.get(id),
    postCost, postComposition, lightingOf: () => [], settings: SETTINGS });
}

/* Экспликация НАСТОЯЩИМ roomSheetForProject поверх НАСТОЯЩИХ buildPostLayout/postTotalCost/postPricedItems
   (в одном vm-контексте), buildEstimate — тот же EPEstimate.build, что у КП. Возвращает записанный HTML. */
function explicationHtml(currency, rate, opts) {
  const o = opts || {};
  const state = o.state || { posts: POSTS, rooms: ROOMS, devices: DEVICES };
  const buildEstimate = o.buildEstimate || (() => buildEst());
  const m = mkMoney(currency);
  let written = "";
  const toasted = [];
  const ctx = {
    Object, Array, Number, String, RegExp, JSON, Map, Set, Infinity,
    window: { open: () => ({ document: { write: s => { written += s; }, close() {} } }) },
    state,
    toast: msg => toasted.push(msg),
    product: id => realById.get(id), frameProduct: id => realById.get(id),
    postComposition, postCost, lightingRowsFor: () => [], projectLighting: () => null,
    assembledPostHtml: () => "",
    displayRate: () => rate, displayCurrency: () => currency, moneyShown: m, esc,
    buildEstimate,
    roomDisplayArea: r => r.area || "",
    docHeader: () => ({ project: "П", developer: "Р", date: "05.11.2026" }),
    companyLogo: () => "",
    EPEstimate, EPPosts, EPOfferOptions, EPDocTotals, EPRoomSheet,
    /* Набор столбцов КП (offerOptions) берётся документом из EP_DATA.settings — даём тесту подменить
       его, чтобы проверить экспликацию при сохранённом «Строителю» / снятой «Сумме». */
    EP_DATA: { settings: o.offerOptions ? Object.assign({}, SETTINGS, { offerOptions: o.offerOptions }) : SETTINGS }
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

/* Строка таблицы <tr>…</tr>, содержащая заданный текст (чтобы проверять цену именно в строке изделия). */
function rowContaining(html, text) {
  const i = html.indexOf(text);
  assert.ok(i >= 0, `текст найден: ${text}`);
  const start = html.lastIndexOf("<tr>", i);
  const end = html.indexOf("</tr>", i);
  return html.slice(start, end);
}
/* Цена строки спецификации (per-unit, валюта показа) для изделия по его члену-группе. */
function unitPriceOf(dev, rate, currency) {
  const est = buildEst();
  const spec = EPEstimate.specShown(est, rate, currency);
  let price = null;
  est.groups.forEach((g, i) => (g.members || []).forEach(mref => { if (mref === dev) price = spec.rows[i].price; }));
  return price;
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

test("экспликация: пометка личной скидки поста «скидка 10%» ровно у поста с личной скидкой (M2)", () => {
  const { written } = explicationHtml("EUR", 1);
  assert.match(written, /скидка 10%/, "пометка личной скидки поста");
  const kitchen = roomSection(written, "Кухня (немецкий)");
  assert.equal((kitchen.match(/class="pl-disc"/g) || []).length, 1, "в Кухне пометка ровно у поста p1 (его личная скидка)");
  /* p2 в Гостиной — по общей скидке (личной нет) → пометки у него быть не должно; у Гостиной пометка
     только у изделия DEV_DISC (15%), а не у поста. */
  const guestPostRow = (() => { const s = roomSection(written, "Гостиная"); return s.slice(0, s.indexOf("—")); })();
  assert.ok(!/скидка 10%/.test(guestPostRow), "у поста без личной скидки пометки нет");
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

test("экспликация: один артикул в двух комнатах — у каждого строка с per-unit ценой, не .sum (EUR+RUB)", () => {
  /* 20021 в Кухне и Гостиной сливаются в группу count 2: цена строки (per-unit) ≠ сумме группы (2×).
     Мутация «цена изделия из .sum» покажет удвоенную — строка изделия покраснеет (и в EUR, и в RUB). */
  const dev = realById.get(DEV_SAME1.productId);
  for (const { currency, rate } of [{ currency: "EUR", rate: 1 }, { currency: "RUB", rate: 92.5 }]) {
    const unit = unitPriceOf(DEV_SAME1, rate, currency);
    assert.ok(unit > 0, `есть per-unit цена (${currency})`);
    const { written } = explicationHtml(currency, rate);
    for (const roomName of ["Кухня (немецкий)", "Гостиная"]) {
      const sec = roomSection(written, roomName);
      const row = rowContaining(sec, esc(dev.name));
      assert.ok(row.includes(mkMoney(currency)(unit)), `цена изделия = per-unit в «${roomName}» (${currency})`);
      assert.ok(!row.includes(mkMoney(currency)(unit * 2)), `не удвоенная (.sum) в «${roomName}» (${currency})`);
    }
  }
});

test("экспликация: у изделия с личной скидкой пометка «скидка 15%» (M2 для изделия)", () => {
  const { written } = explicationHtml("EUR", 1);
  const guest = roomSection(written, "Гостиная");
  assert.match(guest, /скидка 15%/, "пометка личной скидки изделия в его комнате");
});

test("экспликация: изделие без комнаты и в удалённой комнате → «Без помещения» (ветка orphan)", () => {
  const { written } = explicationHtml("EUR", 1);
  assert.match(written, /Без помещения/, "группа «Без помещения» есть");
  const orphan = roomSection(written, "Без помещения");
  const dev = realById.get(DEV_NOROOM.productId);
  assert.ok(orphan.includes(esc(dev.name)), "изделия-сироты (без комнаты / удалённая) — в «Без помещения»");
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

/* ─────────── Добор до целых упаковок в экспликации (решение владельца 05.11 «разделом, как в КП») ───────────
   Сценарий: пост 2×14021 + изделие 14021, упаковка 10 → потребность 3, добор 7 шт. Раздел — та же функция
   EPDocTotals.topUpSectionHtml, что в КП; сумма по комнатам + добор == «Оборудование».
   Мутации (краснеют?): раздел добора не печатается; добор не входит в сумму; строка добора с другой ценой. */
const TU_ROOMS = [{ id: "r1", name: "Кухня" }, { id: "r2", name: "Гостиная" }];
const TU_POSTS = [{ id: "tp1", number: 1, name: "Пост", frameId: idByCode("14931"),
  mechanismIds: [idByCode("14021"), idByCode("14021")], roomId: "r1" }];
const TU_DEVICES = [{ productId: idByCode("14021"), roomId: "r2" }];
const TU_PACKS = { [EPPackTopUp.codeKey("14021")]: 10 };
function buildEstTopUp(packMultiple) {
  return EPEstimate.build({ devices: TU_DEVICES, posts: TU_POSTS,
    product: id => realById.get(id), frameProduct: id => realById.get(id),
    postCost, postComposition, lightingOf: () => [], settings: SETTINGS,
    packMultiple, packs: TU_PACKS });
}
function tuExplication(currency, rate, packMultiple, offerOptions) {
  return explicationHtml(currency, rate, {
    state: { posts: TU_POSTS, rooms: TU_ROOMS, devices: TU_DEVICES },
    buildEstimate: () => buildEstTopUp(packMultiple),
    offerOptions
  }).written;
}

test("экспликация: добор есть → раздел печатается; добора нет → раздела нет (как в КП)", () => {
  const withTU = tuExplication("EUR", 1, true);
  const noTU = tuExplication("EUR", 1, false);
  assert.match(withTU, /Добор до целых упаковок/, "раздел добора печатается, когда добор есть");
  assert.match(withTU, /7 шт\./, "добор 7 шт. (упаковка 10, потребность 3)");
  assert.doesNotMatch(noTU, /Добор до целых упаковок/, "без добора раздела нет (как в КП)");
});

for (const { currency, rate } of [{ currency: "EUR", rate: 1 }, { currency: "RUB", rate: 92.5 }]) {
  test(`экспликация: раздел добора — ТОТ ЖЕ, что в КП; Σ(комнаты)+добор == «Оборудование» (${currency})`, () => {
    const est = buildEstTopUp(true);
    const m = mkMoney(currency);
    const section = EPDocTotals.topUpSectionHtml(est, { esc, moneyShown: m, rate, currency,
      options: EPOfferOptions.normalize({}), itemText: (name) => name });
    const written = tuExplication(currency, rate, true);
    const kp = EPOfferPdf.buildHtml(est, { money: m, moneyShown: m, esc,
      displayCurrency: () => currency, displayRate: () => rate, settings: SETTINGS,
      options: EPOfferOptions.normalize({}), header: { project: "П" }, postLayout: [] });
    assert.ok(section && section.includes("Добор"), "раздел добора непуст");
    assert.ok(kp.includes(section), "КП печатает этот раздел добора");
    assert.ok(written.includes(section), "экспликация печатает ТОТ ЖЕ раздел добора");

    /* Инвариант «считать как в КП»: сумма «Итого по комнате» всех комнат + сумма добора == «Оборудование». */
    const totals = EPEstimate.totalsShown(est, rate, currency);
    const spec = EPEstimate.specShown(est, rate, currency);
    let topUpSum = 0, topUpUnit = 0;
    est.groups.forEach((g, i) => { if (g.topUp) { topUpSum += spec.rows[i].sum; topUpUnit = spec.rows[i].price; } });
    /* Строка добора в экспликации печатает ПРАВИЛЬНЫЕ цену и сумму (независимые числа из specShown) —
       мутация «строка добора с другой ценой» покраснеет здесь. */
    const tuRow = rowContaining(written, "7 шт.");
    assert.ok(tuRow.includes(m(topUpUnit)), `цена штуки добора = ${m(topUpUnit)}`);
    assert.ok(tuRow.includes(m(topUpSum)), `сумма добора = ${m(topUpSum)}`);
    const roomTotals = [...written.matchAll(/room-total[^>]*><td colspan="6">Итого по комнате<\/td><td class="right price">([^<]+)</g)]
      .map(mm => Number(mm[1].replace(/[^\d.,]/g, "").replace(",", ".")));
    const roomSum = roomTotals.reduce((s, x) => s + x, 0);
    assert.ok(roomTotals.length >= 2, "итоги по комнатам извлечены");
    assert.ok(topUpSum > 0, "добор входит в оборудование (сумма добора > 0)");
    assert.ok(Math.abs(roomSum + topUpSum - totals.equipment) < (currency === "RUB" ? 1.5 : 0.005),
      `Σ(комнаты ${roomSum}) + добор (${topUpSum}) == Оборудование (${totals.equipment})`);
  });
}

/* ─────────── Добор в экспликации ВСЕГДА с «Ценой» и «Суммой» (решение владельца 06.11) ───────────
   Комнаты и блок итогов экспликации печатаются всегда с ценами, а сумма добора входит в «Оборудование».
   Значит у добора цена/сумма должны быть ВИДНЫ независимо от набора КП — иначе 7×2,42 € = 16,94 € есть
   в «Оборудовании», но нигде не показаны. Независимый литерал: 14021 стоит 2,42 €, добор 7 шт → 16,94 €.
   Красный на текущем коде (добор берёт столбцы по настройкам КП: «Строителю»/снятая «Сумма» → без денег). */
test("экспликация: добор печатает «Цену»/«Сумму» даже при наборе «Строителю» (prices:false)", () => {
  const written = tuExplication("EUR", 1, true, EPOfferOptions.preset("builder"));
  const tuRow = rowContaining(written, "7 шт.");
  assert.ok(tuRow.includes("2,42 €"), "цена штуки добора видна (14021 = 2,42 €)");
  assert.ok(tuRow.includes("16,94 €"), "сумма добора видна (7 × 2,42 € = 16,94 €)");
});

test("экспликация: добор печатает «Сумму» даже при снятой «Сумме» в составе КП (specification.sum:false)", () => {
  const written = tuExplication("EUR", 1, true,
    EPOfferOptions.normalize({ specification: { sum: false } }));
  const tuRow = rowContaining(written, "7 шт.");
  assert.ok(tuRow.includes("16,94 €"), "сумма добора видна (7 × 2,42 € = 16,94 €)");
  assert.ok(tuRow.includes("2,42 €"), "цена штуки добора видна");
});
