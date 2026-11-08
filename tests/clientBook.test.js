/* Чистая часть «книги клиентов» (А7, итоги встречи 24.08 §1.2: «запоминать настройки по клиенту —
   у Иванова постоянная скидка 10%»). Здесь — ТОЛЬКО правила без DOM/state: нормализация ФИО в ключ,
   приведение хранимого списка, поиск, подсказка и запоминание с лимитом. Связку change/input,
   подстановку реквизитов и скидки проверяет clientBookWiring.test.js.
   Запуск: node --test tests/clientBook.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const CB = require("../js/clientBook.js");

/* Запись клиента в удобной форме для тестов. */
function client(fio, over) {
  return Object.assign({ values: { fio }, show: {}, discountPercent: 0 }, over);
}

test("normFio: trim, схлопывает пробелы, регистронезависимо; ё/е НЕ трогает", () => {
  assert.equal(CB.normFio("  Иванов   Иван  "), "иванов иван");
  assert.equal(CB.normFio("ИВАНОВ"), "иванов");
  assert.equal(CB.normFio("Иванов"), CB.normFio("иванов "));
  /* ё и е остаются РАЗНЫМИ ключами — это разное написание, по решению владельца не склеиваем */
  assert.notEqual(CB.normFio("Пётр"), CB.normFio("Петр"));
  assert.equal(CB.normFio(null), "");
  assert.equal(CB.normFio(undefined), "");
});

test("normalizeList: массив записей, мусор отброшен (не-объекты, без ФИО)", () => {
  const list = CB.normalizeList([
    client("Иванов"),
    null,
    42,
    { values: { fio: "   " } },   // пустое ФИО — мусор
    { nope: true },               // нет values — мусор
    client("Петров")
  ]);
  assert.deepEqual(list.map(c => c.values.fio), ["Иванов", "Петров"]);
  assert.deepEqual(CB.normalizeList("не массив"), []);
  assert.deepEqual(CB.normalizeList(undefined), []);
});

test("find: по нормализованному ФИО, регистронезависимо; пустое/неизвестное → null", () => {
  const list = [client("Иванов Иван", { values: { fio: "Иванов Иван" }, discountPercent: 10 }), client("Петров")];
  assert.equal(CB.find(list, "  ИВАНОВ   ИВАН "), list[0], "регистр и пробелы не мешают");
  assert.equal(CB.find(list, "Сидоров"), null, "неизвестный клиент");
  assert.equal(CB.find(list, "   "), null, "пустое ФИО не ищем");
  assert.equal(CB.find(list, null), null);
});

test("suggest: {fio, phone} в порядке списка (новые первыми), с фильтром по подстроке", () => {
  const list = [
    client("Петров", { values: { fio: "Петров", phone: "+7-222" } }),
    client("Иванов", { values: { fio: "Иванов", phone: "+7-111" } })
  ];
  assert.deepEqual(CB.suggest(list), [
    { fio: "Петров", phone: "+7-222" },
    { fio: "Иванов", phone: "+7-111" }
  ]);
  assert.deepEqual(CB.suggest(list, "иван"), [{ fio: "Иванов", phone: "+7-111" }]);
  assert.deepEqual(CB.suggest(list, "  ПЕТ "), [{ fio: "Петров", phone: "+7-222" }]);
});

test("remember: новый клиент кладётся В НАЧАЛО (новые первыми)", () => {
  let list = [];
  list = CB.remember(list, client("Иванов", { discountPercent: 10 }), 500);
  list = CB.remember(list, client("Петров", { discountPercent: 5 }), 500);
  assert.deepEqual(list.map(c => c.values.fio), ["Петров", "Иванов"]);
});

test("remember: тот же ФИО перезаписывается (последние значения побеждают), запись одна", () => {
  let list = CB.remember([], client("Иванов", { values: { fio: "Иванов", phone: "старый" }, discountPercent: 10 }), 500);
  list = CB.remember(list, client("иванов", { values: { fio: "иванов", phone: "новый" }, discountPercent: 15 }), 500);
  assert.equal(list.length, 1, "одинаковое ФИО (регистр) — один клиент");
  assert.equal(list[0].values.phone, "новый");
  assert.equal(list[0].discountPercent, 15);
});

test("remember: скидка 0 запоминается (значит «скидку сняли»), а не выпадает", () => {
  const list = CB.remember([], client("Иванов", { discountPercent: 0 }), 500);
  assert.equal(list.length, 1);
  assert.strictEqual(list[0].discountPercent, 0);
});

test("remember: пустое ФИО НЕ запоминается — список как был", () => {
  const before = [client("Иванов")];
  const after = CB.remember(before, client("   "), 500);
  assert.deepEqual(after.map(c => c.values.fio), ["Иванов"], "пустой клиент не добавлен");
});

test("remember: лимит длины — самые старые выпадают", () => {
  let list = [];
  list = CB.remember(list, client("A"), 2);
  list = CB.remember(list, client("B"), 2);
  list = CB.remember(list, client("C"), 2);   // A (самый старый) выпадает
  assert.deepEqual(list.map(c => c.values.fio), ["C", "B"]);
});

test("remember копирует значения, не держит ссылку на переданный объект", () => {
  const src = client("Иванов", { values: { fio: "Иванов", phone: "+7" } });
  const list = CB.remember([], src, 500);
  src.values.phone = "подменили";
  assert.equal(list[0].values.phone, "+7", "запись не зависит от последующей правки источника");
});
