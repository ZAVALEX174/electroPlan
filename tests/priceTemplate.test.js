"use strict";
/* Тесты шаблона прайса и проверки файла (К9, часть 1 — js/priceTemplate.js).
   - Синтетические строки: каждая ошибка/предупреждение, номер строки Excel, группировка.
   - Сверка допустимых значений с РЕАЛЬНЫМ правилом конвертера (tools/lib/nomenclature*.mjs):
     список живёт в модуле, а эта проверка ловит расхождение (§7.1). Конвертер — ESM, подключаем
     динамическим import в before().
   - Прогон на НАСТОЯЩЕМ файле заказчика: если файл доступен — читаем xlsx и проверяем ожидания;
     нет файла — тест помечается пропущенным (а не падает), т.к. файл лежит вне репозитория. */
const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const XLSX = require("xlsx");
const T = require("../js/priceTemplate.js");

// Полная шапка файла заказчика (21 столбец, его порядок) — чтобы в синтетике не всплывали
// лишние «нет столбца». Две пустые строки сверху: шапка окажется в 3-й строке Excel, как в файле.
const HEADER = [
  "Артикул", "Наименование", "Прайс розница РФ, Евро", "Кол-во в упаковке", "Примечание",
  "Количество модулей", "Коллекция", "Тип управления", "Функциональная группа", "Тип стены",
  "Монтажный стандарт", "Количество уровней в рамке", "Цвет механизма", "Кодировка цвета накладки",
  "Цвет накладки", "Материал накладки", "Форма накладки", "Спрашивать подсветку 1 - да, пусто - нет",
  "Цвет подсветки", "Позиция подсветки 1 - верх, 2 - центр, 3 - низ", "Изображение",
];
const CI = {}; HEADER.forEach((h, i) => { CI[h] = i; });
// Строка-массив из именованных значений.
function row(obj) {
  const r = new Array(HEADER.length).fill(null);
  for (const [k, v] of Object.entries(obj)) {
    if (!(k in CI)) throw new Error("нет столбца в HEADER: " + k);
    r[CI[k]] = v;
  }
  return r;
}
// Сетка: 2 пустые строки, шапка (строка 3), затем данные (с 4-й строки Excel).
function grid(dataRows) {
  return [[], [], HEADER.slice(), ...dataRows];
}
// Полный валидный механизм (ничего не нарушает).
const mech = (over) => row(Object.assign({
  "Артикул": "20001.0", "Наименование": "Выключатель", "Прайс розница РФ, Евро": 12.5,
  "Кол-во в упаковке": 10, "Коллекция": "Eikon", "Функциональная группа": "Управление светом",
  "Тип управления": "В", "Количество модулей": 1,
}, over || {}));
// Полная валидная декоративная накладка.
const frame = (over) => row(Object.assign({
  "Артикул": "20657.01", "Наименование": "Рамка 2М", "Прайс розница РФ, Евро": 5,
  "Кол-во в упаковке": 5, "Коллекция": "Eikon", "Функциональная группа": "Рамка",
  "Количество модулей": 2, "Монтажный стандарт": "Итальянский",
  "Цвет накладки": "Белый", "Материал накладки": "Технополимер", "Форма накладки": "Классика",
}, over || {}));

const err = (res, key) => res.errors.find((e) => e.key === key);
const warn = (res, key) => res.warnings.find((w) => w.key === key);

let N2026, NBASE, REAL_PATH, realRows = null, realRes = null;
before(async () => {
  N2026 = await import(pathToFileURL(require.resolve("../tools/lib/nomenclature2026.mjs")).href);
  NBASE = await import(pathToFileURL(require.resolve("../tools/lib/nomenclature.mjs")).href);
  REAL_PATH = N2026.DEFAULT_NOMENCLATURE_2026;
  if (fs.existsSync(REAL_PATH)) {
    const wb = XLSX.readFile(REAL_PATH);
    const name = wb.SheetNames.find((n) => n.trim() === "VIMAR") || wb.SheetNames[wb.SheetNames.length - 1];
    realRows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: true });
    realRes = T.check(realRows);
  }
});

/* ---------- Синтетика: ошибки ---------- */

test("валидный файл без нарушений — ok=true, ошибок нет", () => {
  const res = T.check(grid([mech(), frame()]));
  assert.equal(res.ok, true);
  assert.equal(res.errors.length, 0);
});

test("нет обязательного столбца → ошибка; нет желательного → предупреждение", () => {
  const h = HEADER.filter((x) => x !== "Цвет накладки");   // убираем обязательный столбец
  const g = [[], [], h, (() => { const r = new Array(h.length).fill(null); return r; })()];
  const res = T.check(g);
  assert.ok(res.errors.find((e) => e.key === "col:Цвет накладки"), "ожидали ошибку про столбец");
  assert.equal(res.ok, false);
  // желательные столбцы прежнего файла отсутствуют всегда → предупреждения
  assert.ok(warn(res, "col:Подгруппы"));
});

test("пустая цена → ошибка «нет цены» с номером строки Excel", () => {
  const res = T.check(grid([mech({ "Прайс розница РФ, Евро": null })]));
  const e = err(res, "priceEmpty");
  assert.ok(e);
  assert.deepEqual(e.rows, [4]);           // данные с 4-й строки Excel
});

test("цена не число → ошибка priceBad", () => {
  const res = T.check(grid([mech({ "Прайс розница РФ, Евро": "по запросу" })]));
  assert.ok(err(res, "priceBad"));
});

test("цена с запятой/пробелами как текст — допустима", () => {
  const res = T.check(grid([mech({ "Прайс розница РФ, Евро": "1 234,50" })]));
  assert.equal(res.ok, true);
});

test("пустое наименование → ошибка", () => {
  const res = T.check(grid([mech({ "Наименование": "" })]));
  assert.ok(err(res, "nameEmpty"));
});

test("дубль артикула → ошибка, вторая строка в rows", () => {
  const res = T.check(grid([mech(), mech()]));
  const e = err(res, "dup");
  assert.ok(e);
  assert.deepEqual(e.rows, [5]);           // повтор — 5-я строка Excel
});

test("накладка без отделки → три ошибки (материал/форма/цвет)", () => {
  const res = T.check(grid([frame({ "Материал накладки": "", "Форма накладки": "", "Цвет накладки": "" })]));
  assert.ok(err(res, "frameMat"));
  assert.ok(err(res, "frameShape"));
  assert.ok(err(res, "frameColor"));
  assert.equal(res.ok, false);
});

test("накладка без стандарта/модулей → ошибки frameStd/frameMod", () => {
  const res = T.check(grid([frame({ "Монтажный стандарт": "", "Количество модулей": "" })]));
  assert.ok(err(res, "frameStd"));
  assert.ok(err(res, "frameMod"));
});

test("механизм без отделки/модулей — не ошибка (отделка обязательна только накладкам)", () => {
  const res = T.check(grid([mech({ "Количество модулей": "" })]));
  assert.equal(res.ok, true);
});

test("группировка: две накладки без материала → один пункт, count=2, обе строки", () => {
  const res = T.check(grid([
    frame({ "Артикул": "A1", "Материал накладки": "" }),
    frame({ "Артикул": "A2", "Материал накладки": "" }),
  ]));
  const e = err(res, "frameMat");
  assert.equal(e.count, 2);
  assert.deepEqual(e.rows, [4, 5]);
});

test("длинный список строк сворачивается в «… и ещё N»", () => {
  const rows = [];
  for (let i = 0; i < 12; i++) rows.push(frame({ "Артикул": "A" + i, "Материал накладки": "" }));
  const res = T.check(grid(rows));
  const e = err(res, "frameMat");
  assert.equal(e.count, 12);
  assert.match(e.message, /и ещё 4/);      // 8 показано, 4 скрыто
});

/* ---------- Синтетика: предупреждения ---------- */

test("нераспознанный тип управления «Ж» → предупреждение, не ошибка", () => {
  const res = T.check(grid([mech({ "Тип управления": "Ж" })]));
  assert.ok(warn(res, "ctrl:ж"));
  assert.equal(res.ok, true);
  assert.match(warn(res, "ctrl:ж").message, /«Ж»/);
});

test("пустая функциональная группа → предупреждение (считается механизмом)", () => {
  const res = T.check(grid([mech({ "Функциональная группа": "" })]));
  assert.ok(warn(res, "groupEmpty"));
  assert.equal(res.ok, true);
});

test("строка без артикула, но с данными → предупреждение noCode", () => {
  const r = new Array(HEADER.length).fill(null);
  r[CI["Наименование"]] = "Что-то без кода";
  const res = T.check(grid([r]));
  assert.ok(warn(res, "noCode"));
  assert.equal(res.stats.noCodeRows, 1);
});

test("артикул .FX пропускается (не ошибка, считается в fxRows)", () => {
  const res = T.check(grid([mech({ "Артикул": "14000.FX.0" })]));
  assert.equal(res.ok, true);
  assert.equal(res.stats.fxRows, 1);
  assert.equal(res.stats.dataRows, 0);
});

test("нет строки шапки «Артикул» → одна понятная ошибка", () => {
  const res = T.check([["мусор", "ещё"], [1, 2]]);
  assert.equal(res.ok, false);
  assert.ok(res.errors.find((e) => e.key === "noHeader"));
});

/* ---------- Сверка допустимых значений с конвертером (§7.1) ---------- */

test("CONTROL_LETTERS совпадают с ключами CONTROL_ROLES конвертера", () => {
  const converterKeys = new Set([...NBASE.CONTROL_ROLES.keys()]);
  const moduleKeys = new Set(T.CONTROL_LETTERS.map((x) => x.toLowerCase()));
  assert.deepEqual([...moduleKeys].sort(), [...converterKeys].sort());
  // каждая буква модуля действительно распознаётся конвертером
  for (const l of T.CONTROL_LETTERS) assert.ok(NBASE.controlRoleOf(l), "не распознан: " + l);
});

test("списки групп совпадают с GROUP_KIND_2026 конвертера", () => {
  const byKind = { frame: [], support: [], socket_box: [], accessory: [] };
  for (const [k, v] of N2026.GROUP_KIND_2026.entries()) if (byKind[v]) byKind[v].push(k);
  const fold = (a) => a.map((x) => x.toLowerCase()).sort();
  assert.deepEqual(fold(T.FRAME_GROUPS), byKind.frame.sort());
  assert.deepEqual(fold(T.SUPPORT_GROUPS), byKind.support.sort());
  assert.deepEqual(fold(T.BOX_GROUPS), byKind.socket_box.sort());
  assert.deepEqual(fold(T.ACCESSORY_GROUPS), byKind.accessory.sort());
  // и обратно — распознавание вида совпадает
  for (const g of T.FRAME_GROUPS) assert.equal(N2026.kindOf2026(g), "frame");
  for (const g of T.SUPPORT_GROUPS) assert.equal(N2026.kindOf2026(g), "support");
  for (const g of T.BOX_GROUPS) assert.equal(N2026.kindOf2026(g), "socket_box");
  for (const g of T.ACCESSORY_GROUPS) assert.equal(N2026.kindOf2026(g), "accessory");
});

test("распознавание монтажного стандарта совпадает со standardOf", () => {
  for (const s of T.STANDARD_EXAMPLES) {
    assert.equal(T.standardRecognized(s), NBASE.standardOf(s) !== "UNKNOWN", s);
    assert.ok(T.standardRecognized(s));
  }
  assert.equal(T.standardRecognized("Умный дом"), NBASE.standardOf("Умный дом") !== "UNKNOWN");
  assert.equal(T.standardRecognized("Умный дом"), false);
});

test("распознавание типа стены совпадает с wallTypeOf2026", () => {
  for (const w of T.WALL_EXAMPLES) {
    assert.equal(T.wallRecognized(w), N2026.wallTypeOf2026(w) !== "unknown", w);
    assert.ok(T.wallRecognized(w));
  }
  assert.equal(T.wallRecognized("Дерево"), false);
});

/* ---------- Прогон на настоящем файле заказчика ---------- */

test("реальный файл: ok=false, ошибки только по отделке накладок, цена/артикул/группа чисты", (t) => {
  if (!realRes) { t.skip("файл заказчика недоступен: " + REAL_PATH); return; }
  assert.equal(realRes.ok, false);
  // ошибки — только пустые материал/форма/цвет накладки
  const errKeys = realRes.errors.map((e) => e.key).sort();
  assert.deepEqual(errKeys, ["frameColor", "frameMat", "frameShape"]);
  for (const k of ["frameColor", "frameMat", "frameShape"]) assert.ok(err(realRes, k).count > 1000);
  // ложных ошибок по цене/артикулу/группе быть не должно
  for (const k of ["priceEmpty", "priceBad", "dup", "nameEmpty"]) assert.equal(err(realRes, k), undefined, k);
  // все цены — числа > 0, дублей нет
  assert.ok(realRes.stats.dataRows > 2000);
});
