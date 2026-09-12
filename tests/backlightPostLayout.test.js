/* ПОВЕДЕНЧЕСКИЙ регресс: подсветка клавиш видна в таблице «Раскладка постов» печатного КП
   (ПОДСВЕТКА-B, часть B2a-3). Владелец собрал пост из трёх клавиш с включённой подсветкой,
   и в смете/своде/на экране LED были, а колонка «Наполнение» раскладки показывала только
   «Клавиша — 3» — подсветка мимо документа, который клиент читает первым.

   ДВА СЛОЯ, ОДНА ФОРМУЛИРОВКА.
     1. Сборка строки поста buildPostLayout (js/app.js) добавляет подсветку в fill: подобранные
        LED — одной позицией «Подсветка клавиш — N» (колонка сводит наполнение по СЛОВАМ, а не по
        артикулам, как и «Клавиша — 3»), пробел — словами «подсветка не подобрана» с флагом noCount
        (в количество к заказу не идёт). Числа берёт из уже посчитанного comp.backlight — второй
        копии подбора нет. app.js — монолит-оркестратор (state + DOM), в node не грузится: вырезаем
        ИСХОДНЫЙ ТЕКСТ buildPostLayout и исполняем в vm на общем стенде (appStand); comp подаём
        готовым (его считает EPPosts.postComposition, покрытый своими тестами), fillSummary —
        настоящий EPPosts.
     2. Рендер колонки fill (js/offerPdf.js) печатает обычную позицию как «слово — количество», а
        строку с noCount — одними словами, без «— 0».

   МУТАЦИЯ → КРАСНЫЙ ТЕСТ:
     - buildPostLayout не добавляет LED в fill → нет «Подсветка клавиш» в наполнении;
     - потеря счётчика (константа вместо back.items.length) → количество расходится с числом LED;
     - buildPostLayout не добавляет пробел → нет «подсветка не подобрана»;
     - включённая подсветка без LED и без пробелов не должна давать строк (таблица как раньше);
     - рендер fill игнорирует noCount → пробел печатается с «— 0» (мнимое количество к заказу).
   Запуск: node --test tests/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const EPPosts = require("../js/posts.js");
const { buildHtml } = require("../js/offerPdf.js");

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* Клавиша с предзаданным словом наполнения — fillSummary свернёт одинаковые в «Клавиша — N». */
const KEY = { fillWord: "Клавиша" };
const LED = { code: "00936.250.W", name: "Светодиод для подсветок 110-250V 0,5W белый", price: 9.6 };

/* Стенд buildPostLayout: настоящие buildPostLayout и EPPosts.fillSummary, а comp — готовый
   (его источник EPPosts.postComposition покрыт своими тестами). box/frame/assembledPostHtml
   стабим по минимуму — функция их лишь перекладывает, к находкам о подсветке они не относятся. */
function layoutOf(back) {
  const comp = {
    modulesTotal: 3, backlight: back,
    box: { name: "Коробка", code: "B1" }, boxCount: 1,
    frameAvailability: { code: "F1", available: true, displayName: "Рамка" }
  };
  const ctx = {
    state: { posts: [{ number: 1, mechanismIds: ["m1", "m2", "m3"] }] },
    postComposition: () => comp,
    EPPosts, product: () => KEY,
    assembledPostHtml: () => ""
  };
  return stand.run(["buildPostLayout"], ctx)({ articles: false });
}

const fillOf = back => layoutOf(back)[0].fill;
const backOf = (items, gaps) => ({ enabled: true, items: items || [], gaps: gaps || [] });

/* ---- 1. buildPostLayout: подсветка встаёт в наполнение ---------------------------------- */

test("подобранные LED сводятся в одну позицию «Подсветка клавиш — N»", () => {
  const fill = fillOf(backOf([{ accessory: LED }, { accessory: LED }, { accessory: LED }], []));
  assert.deepEqual(fill[0], { word: "Клавиша", count: 3 }, "механизмы наполнения как раньше");
  const back = fill.find(f => f.word === "Подсветка клавиш");
  assert.ok(back, "подсветка добавлена отдельной позицией");
  assert.equal(back.count, 3, "количество равно числу подобранных LED");
  assert.ok(!back.noCount, "у подобранной подсветки есть количество к заказу");
});

test("пробел подбора — словами «подсветка не подобрана», без количества к заказу", () => {
  const fill = fillOf(backOf([], [{ mechId: "m1" }]));
  const gap = fill.find(f => f.word === "подсветка не подобрана");
  assert.ok(gap, "пробел назван словами");
  assert.equal(gap.noCount, true, "пробел не идёт в количество к заказу");
});

test("несколько пробелов — «N × подсветка не подобрана», как в смете и своде", () => {
  const fill = fillOf(backOf([], [{ mechId: "m1" }, { mechId: "m2" }]));
  assert.ok(fill.some(f => f.word === "2 × подсветка не подобрана" && f.noCount), "счёт пробелов в словах");
});

test("подсветка выключена/не подобрана → строк подсветки нет, наполнение как раньше", () => {
  const off = fillOf(backOf([], []));
  assert.deepEqual(off, [{ word: "Клавиша", count: 3 }], "включённая пустая подсветка ничего не добавляет");
  const noField = fillOf(null);
  assert.deepEqual(noField, [{ word: "Клавиша", count: 3 }], "comp без поля backlight — как отсутствие подсветки");
});

/* ---- 2. offerPdf: рендер колонки «Наполнение» ------------------------------------------- */

const est = {
  groups: [{ name: "Клавиша", composition: "20001", count: 3, unit: "шт", sum: 30 }],
  equipment: 30, discount: 0, materials: 0, work: 0, subtotal: 30, vat: 0, total: 30
};
const deps = { money: n => String(n) + " €", esc, displayCurrency: () => "EUR", settings: {} };
const htmlWithFill = fill => buildHtml(est, Object.assign({}, deps, {
  postLayout: [{ number: 1, modules: 3, fill, assembledImageHtml: "", frameName: "Рамка" }]
}));

test("подобранная подсветка печатается «Подсветка клавиш — 3»", () => {
  const html = htmlWithFill([{ word: "Клавиша", count: 3 }, { word: "Подсветка клавиш", count: 3 }]);
  assert.match(html, /Подсветка клавиш — 3/, "слово с количеством, как «Клавиша — 3»");
});

test("пробел печатается словами, без мнимого «— 0»", () => {
  const html = htmlWithFill([{ word: "подсветка не подобрана", noCount: true }]);
  assert.match(html, /подсветка не подобрана/, "пробел назван словами");
  assert.ok(!/подсветка не подобрана — 0/.test(html), "пробел без количества к заказу");
});
