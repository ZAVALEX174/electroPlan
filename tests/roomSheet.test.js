/* Автотесты экспликации по комнатам (Б7).
   Запуск без зависимостей и без сборщика:  node --test tests/

   Слои под тестом:
   1. Чистый модуль js/roomSheet.js (EPRoomSheet.buildHtml) — через require, как installSheet.test.js:
      группы комнат, итог ПО КОМНАТЕ, блок итогов ГОТОВОЙ строкой (data.totalsHtml), «Без помещения»,
      пустые комнаты, пометка скидки, шапка, esc.
   2. Обвязка js/docs.js — настоящий postsByRooms (порядок комнат = порядку на плане).

   Экспликация «как в КП» целиком (roomSheetForProject на РЕАЛЬНОЙ смете/каталоге, блок итогов, изделия
   в комнатах, пометка скидки, оговорка) проверяется сквозным tests/roomSheetTotals.test.js.

   Каждый тест обязан КРАСНЕТЬ на своей мутации (§7.1 HANDOFF, зелёный ≠ проверенное правило):
     - итог по комнате не считается → сумма не сойдётся;
     - блок итогов (data.totalsHtml) не выводится → цифр КП в документе нет;
     - «Без помещения» не в конце / комнаты не в порядке → порядок заголовков разойдётся;
     - пустая комната пропущена → нет пометки «постов нет». */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const EPRoomSheet = require("../js/roomSheet.js");
const EPOfferOptions = require("../js/offerOptions.js");
const EPEstimate = require("../js/estimate.js");
const EPDocTotals = require("../js/docTotals.js");

/* esc как в приложении — чтобы проверить экранирование пользовательского ввода. */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/* moneyShown-стаб: читаемый и различимый формат (с запятой, как ru-RU), чтобы проверять сами ЧИСЛА итогов. */
const moneyShown = n => Number(n).toFixed(2).replace(".", ",") + " €";
const deps = { esc, moneyShown };

const post = (number, price, over) => Object.assign({
  number, price,
  fillText: "Розетка — 2",
  frameName: "Накладка Plana 2М",
  modules: 2,
  height: "30 см от пола",
  purpose: "Розетки рабочей зоны"
}, over || {});

/* Порядок заголовков комнат в документе — массивом, чтобы сравнивать порядок целиком. */
const headingsOf = html => [...html.matchAll(/<h2 class="room-heading">([^<]+)<\/h2>/g)].map(m => m[1]);

/* ─────────── 1. Чистый модуль EPRoomSheet.buildHtml ─────────── */

test("документ: заголовок, шапка реквизитов, таблица постов комнаты", () => {
  const html = EPRoomSheet.buildHtml({
    header: { project: "ЖК «Северный»", developer: "Иванов", date: "04.11.2026" },
    groups: [{ name: "Кухня", areaText: "12,5 м²", posts: [post(3, 42.5)] }]
  }, deps);
  assert.match(html, /Экспликация по комнатам/, "заголовок документа");
  assert.match(html, /Проект:<\/b> ЖК «Северный»/, "реквизит «Проект» в шапке");
  assert.match(html, /Разработчик:<\/b> Иванов/, "реквизит «Разработчик»");
  assert.match(html, /Кухня — 12,5 м²/, "заголовок комнаты с площадью");
  assert.match(html, /Розетка — 2/, "наполнение словами");
  assert.match(html, /Накладка Plana 2М/, "накладка");
  assert.match(html, /30 см от пола/, "высота установки");
  assert.match(html, /Розетки рабочей зоны/, "назначение");
  assert.match(html, /42,50 €/, "цена поста отформатирована moneyShown");
});

test("итог по комнате = сумма её строк; блок общих итогов приходит готовой строкой (totalsHtml)", () => {
  /* Мутация «итог комнаты = цена первого поста» краснит первую проверку: 10+20=30. Блок ОБЩИХ итогов
     модуль НЕ считает — вставляет data.totalsHtml как есть (его собирает EPDocTotals из сметы, §7.1). */
  const html = EPRoomSheet.buildHtml({
    totalsHtml: '<div class="totals"><div><span>Итого с НДС</span><b>99,00 €</b></div></div>',
    groups: [
      { name: "Кухня", posts: [post(1, 10), post(2, 20)] },
      { name: "Без помещения", posts: [post(3, 5)] }
    ]
  }, deps);
  const kitchenTotal = html.slice(html.indexOf("Итого по комнате"));
  assert.match(kitchenTotal, /30,00 €/, "итог по комнате = сумма цен её строк");
  assert.match(html, /Итого с НДС<\/span><b>99,00 €<\/b>/, "блок итогов выведен из data.totalsHtml");
  assert.ok(!html.includes("Итого по проекту"), "своего общего итога модуль больше не печатает");
});

test("пометка личной скидки печатается под номером поста (pl-disc); без неё — нет", () => {
  const html = EPRoomSheet.buildHtml({
    groups: [{ name: "Кухня", posts: [post(1, 10, { discountMark: "скидка 10%" }), post(2, 20)] }]
  }, deps);
  assert.match(html, /<div class="pl-disc">скидка 10%<\/div>/, "пометка под номером поста со скидкой");
  assert.equal((html.match(/class="pl-disc"/g) || []).length, 1, "ровно у одного поста — у второго пометки нет");
});

test("строка изделия: № «—», наполнение — имя изделия, прочие поля прочерками", () => {
  const html = EPRoomSheet.buildHtml({
    groups: [{ name: "Гостиная", posts: [
      { number: "—", fillText: "Розетка SCHUKO", frameName: "", modules: "", height: "", purpose: "", price: 7.5 }
    ] }]
  }, deps);
  const row = html.slice(html.indexOf('<td class="num">'), html.indexOf("Итого по комнате"));
  assert.match(row, /<td class="num">—<\/td>/, "№ изделия — прочерк");
  assert.match(row, /Розетка SCHUKO/, "имя изделия в «Наполнении»");
  assert.ok((row.match(/<td>—<\/td>/g) || []).length >= 3, "накладка/высота/назначение — прочерки");
  assert.match(row, /7,50 €/, "цена изделия");
});

test("порядок комнат — как в data.groups; «Без помещения» приходит последней от оркестратора", () => {
  const html = EPRoomSheet.buildHtml({
    groups: [
      { name: "Кухня", posts: [post(1, 1)] },
      { name: "Спальня", posts: [post(2, 2)] },
      { name: "Без помещения", posts: [post(3, 3)] }
    ]
  }, deps);
  assert.deepEqual(headingsOf(html), ["Кухня", "Спальня", "Без помещения"],
    "модуль печатает группы в полученном порядке — порядок задаёт postsByRooms");
});

test("пустая комната: заголовок с площадью и пометка «постов нет», без строки итога", () => {
  const html = EPRoomSheet.buildHtml({
    groups: [{ name: "Кладовая", areaText: "2,0 м²", posts: [] }, { name: "Кухня", posts: [post(1, 7)] }]
  }, deps);
  assert.match(html, /Кладовая — 2,0 м²/, "пустая комната показана с площадью");
  assert.match(html, /постов нет/, "пометка «постов нет»");
  /* «Итого по комнате» ровно одна — у Кухни; у пустой Кладовой итога быть не должно. */
  assert.equal((html.match(/Итого по комнате/g) || []).length, 1, "у пустой комнаты итог не печатается");
});

test("пустые поля поста печатаются прочерком; ввод экранируется", () => {
  const html = EPRoomSheet.buildHtml({
    groups: [{ name: "Кухня <script>", posts: [post(1, 1, { height: "", purpose: "", fillText: "" })] }]
  }, deps);
  assert.ok(!html.includes("Кухня <script>"), "имя комнаты экранировано");
  const row = html.slice(html.indexOf("<td class=\"num\">"), html.indexOf("Итого по комнате"));
  assert.ok((row.match(/<td>—<\/td>/g) || []).length >= 3, "пустые наполнение/высота/назначение — прочерки");
});

test("шапка без заполненных полей не печатается; автопечать подключена", () => {
  const html = EPRoomSheet.buildHtml({ groups: [{ name: "Кухня", posts: [post(1, 1)] }] }, deps);
  assert.ok(!html.includes('class="doc-head"'), "пустая шапка не даёт пустого блока");
  assert.match(html, /window\.print\(\)/, "есть автопечать");
  assert.match(html, /@page{size:A4/, "печатные поля заданы");
});

/* ─────────── 2. postsByRooms (docs.js) — одно правило порядка на два документа ─────────── */

test("postsByRooms: порядок комнат = state.rooms, внутри — по номеру, «без комнаты» в конце", () => {
  const byRooms = stand.run(["postsByRooms"], {}) ;
  const rooms = [{ id: "r1", name: "Кухня" }, { id: "r2", name: "Спальня" }];
  const posts = [
    { id: "p3", number: 3, roomId: null },          /* без комнаты */
    { id: "p2", number: 2, roomId: "r2" },
    { id: "p1", number: 1, roomId: "r1" },
    { id: "p4", number: 4, roomId: "r2" },
    { id: "p5", number: 5, roomId: "где-то" }       /* комната удалена — как без комнаты */
  ];
  const groups = byRooms(posts, rooms);
  /* Массивы из vm-песочницы — другого realm, deepStrictEqual их не равняет с локальными
     (прототипы разные); сравниваем сериализацией. */
  const ids = g => JSON.stringify(g.map(x => (x.room ? x.room.id : null)));
  assert.equal(ids(groups), '["r1","r2",null]', "комнаты в порядке плана, посты без комнаты — последней группой");
  assert.equal(JSON.stringify(groups[1].posts.map(p => p.number)), "[2,4]", "внутри комнаты — по номеру поста");
  assert.equal(JSON.stringify(groups[2].posts.map(p => p.number)), "[3,5]", "сироты тоже по номеру");
});

test("postsByRooms: пустые комнаты сохраняются (экспликация покажет «постов нет»)", () => {
  const byRooms = stand.run(["postsByRooms"], {});
  const groups = byRooms([], [{ id: "r1", name: "Кухня" }]);
  assert.equal(groups.length, 1, "комната без постов не потерялась");
  assert.equal(groups[0].posts.length, 0, "и она пустая");
  assert.equal(byRooms([], []).length, 0, "совсем пустой проект → ни одной группы");
});

/* ─────────── 3. roomSheetForProject (docs.js) — обвязка оркестратора через НАСТОЯЩИЙ roomSheetForProject ───────────
   Предмет: группировка по комнатам (порядок, площадь, пустая комната, «Без помещения» последней) и
   склейка наполнения со строкой-пробелом (noCount). buildPostLayout СТАБИМ, чтобы подать фикстурный fill
   с noCount (его реальные деньги покрывает сквозной roomSheetTotals.test.js на настоящем каталоге);
   buildEstimate — минимальный (предмет не итоги). Печать — НАСТОЯЩИЕ EPRoomSheet/EPDocTotals.
   Должны КРАСНЕТЬ мутации docs.js: fillText без ветки noCount; areaText:""; postsByRooms(...).reverse();
   .filter(g=>g.room) (посты без комнаты пропадают); «Без помещения» первой. */
function roomSheetRun() {
  let written = "";
  const toasted = [];
  const ctx = {
    Object, Array, Number, String, RegExp, JSON, Map, Set, Infinity,
    window: { open: () => ({ document: { write: s => { written += s; }, close() {} } }) },
    state: {
      rooms: [{ id: "r1", name: "Кухня", area: "12,5 м²" }, { id: "r2", name: "Кладовая", area: "2,0 м²" }],
      posts: [
        { id: "p2", number: 2, roomId: null },   /* сирота → «Без помещения» */
        { id: "p1", number: 1, roomId: "r1" }    /* нарочно не в порядке комнат */
      ],
      devices: []
    },
    toast: m => toasted.push(m),
    projectLighting: () => null,
    displayRate: () => 1, displayCurrency: () => "EUR",
    product: id => ({ id }),
    buildEstimate: () => ({ groups: [], missing: [] }),
    EPOfferOptions, EPEstimate, EPDocTotals, EP_DATA: { settings: {} },
    /* строки раскладки — как их отдаёт настоящий buildPostLayout (id/roomId/height/purpose/fill есть) */
    buildPostLayout: () => [
      { id: "p2", number: 2, roomId: null, height: "", purpose: "Розетки у двери",
        fill: [{ word: "Розетка", count: 1 }], frameName: "Накладка Plana 1М", modules: 1, price: 5 },
      { id: "p1", number: 1, roomId: "r1", height: "30 см", purpose: "",
        fill: [{ word: "Выключатель", count: 1 }, { word: "подсветка не подобрана", noCount: true }],
        frameName: "Накладка Plana 2М", modules: 2, price: 42.5 }
    ],
    roomDisplayArea: r => r.area || "",
    docHeader: () => ({ project: "П", developer: "Р", date: "05.11.2026" }),
    companyLogo: () => "",
    esc, moneyShown,
    EPRoomSheet   /* печать — НАСТОЯЩИЙ модуль: тест видит итоговый HTML целиком */
  };
  stand.run(["postsByRooms", "roomSheetForProject"], ctx)();
  return { written, toasted };
}

test("roomSheetForProject: комнаты в порядке плана, площадь в заголовке, пустая — с пометкой, «Без помещения» последней", () => {
  const { written, toasted } = roomSheetRun();
  assert.deepEqual(toasted, [], "без тостов — документ открыт");
  assert.ok(written.length > 0, "документ записан в окно печати");
  assert.deepEqual(headingsOf(written), ["Кухня — 12,5 м²", "Кладовая — 2,0 м²", "Без помещения"],
    "порядок комнат = state.rooms, площадь в заголовке, «Без помещения» последней (reverse/filter/area/unshift краснят)");
  assert.match(written, /постов нет/, "пустая Кладовая показана с пометкой");
  /* Якорь </td>: без ветки noCount пробел печатался бы как «подсветка не подобрана — undefined»,
     и проверка по подстроке прошла бы молча — поэтому сверяем точное содержимое ячейки. */
  assert.match(written, /<td>Выключатель — 1, подсветка не подобрана<\/td>/,
    "наполнение: количество есть, пробел подсветки — словами без числа (ветка noCount)");
  assert.match(written, /Проект:<\/b> П/, "шапка из docHeader");
});

