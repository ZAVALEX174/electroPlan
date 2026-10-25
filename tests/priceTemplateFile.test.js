"use strict";
/* Тесты генератора Excel-шаблона прайса (К9, часть 2 — js/priceTemplateFile.js).
   Проверяем ФАКТАМИ, а не поиском подстрок: книгу читаем обратно библиотекой xlsx (та же, что
   читает прайс заказчика) и прогоняем через EPPriceTemplate.check — то есть шаблон обязан пройти
   собственную проверку программы.

   Что доказываем:
     1. лист «Прайс»: имена заголовков == COLUMNS в их порядке (источник столбцов один, §7.1);
     2. книга открывается xlsx без ошибок, листы — «Прайс» и «Пояснения»;
     3. check() на прочитанном шаблоне даёт 0 ошибок (строки-примеры валидны);
     4. check() на шаблоне БЕЗ строк-примеров (только заголовок) не даёт ложных ошибок;
     5. лист «Пояснения»: по строке на столбец, поля из COLUMNS;
     6. строки-примеры — по одной каждого вида (накладка, механизм, суппорт).

   Зелёный ≠ проверенное правило (§7.1): мутационная проверка — в отчёте координатору. */
const test = require("node:test");
const assert = require("node:assert/strict");
const XLSX = require("xlsx");
const T = require("../js/priceTemplate.js");
const F = require("../js/priceTemplateFile.js");

/* Единожды строим книгу и читаем её обратно — как это сделает заказчик, открыв файл. */
const { bytes, fileName } = F.build();
const wb = XLSX.read(Buffer.from(bytes), { type: "buffer" });
const grid = (name) => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: true });

test("build даёт Uint8Array и имя .xlsx", () => {
  assert.ok(bytes instanceof Uint8Array && bytes.length > 0, "на выходе непустой Uint8Array");
  assert.match(fileName, /\.xlsx$/, "имя файла с расширением .xlsx");
});

test("книга открывается xlsx, листы — «Прайс» и «Пояснения»", () => {
  assert.deepEqual(wb.SheetNames, ["Прайс", "Пояснения"]);
});

test("лист «Прайс»: заголовки == COLUMNS в их порядке (источник столбцов один)", () => {
  const header = grid("Прайс")[0];
  assert.deepEqual(header, T.COLUMNS.map((c) => c.name));
});

test("check() на собственном шаблоне (читан обратно xlsx) — 0 ошибок", () => {
  const res = T.check(grid("Прайс"));
  assert.equal(res.errors.length, 0, "ошибок нет: " + res.errors.map((e) => e.key).join(", "));
  assert.equal(res.ok, true);
  // ровно три строки данных — по одной каждого вида
  assert.equal(res.stats.dataRows, 3);
  assert.equal(res.stats.frames, 1, "одна накладка");
  assert.equal(res.stats.mechanisms, 1, "один механизм");
  assert.equal(res.stats.supports, 1, "один суппорт");
});

test("check() на шаблоне БЕЗ строк-примеров (только заголовок) — 0 ложных ошибок", () => {
  const header = grid("Прайс")[0];
  const res = T.check([header]);
  assert.equal(res.errors.length, 0, "ложных ошибок нет: " + res.errors.map((e) => e.key).join(", "));
  assert.equal(res.ok, true);
  assert.equal(res.stats.dataRows, 0);
});

test("лист «Пояснения»: по строке на столбец, поля из COLUMNS", () => {
  const rows = grid("Пояснения");
  assert.deepEqual(rows[0], ["Столбец", "Обязательно/желательно", "Для каких товаров", "Что это", "Допустимые значения", "Пример"]);
  assert.equal(rows.length - 1, T.COLUMNS.length, "строк пояснений = числу столбцов");
  T.COLUMNS.forEach((c, i) => {
    const r = rows[i + 1];
    assert.equal(r[0], c.name, "столбец " + c.name);
    assert.equal(r[1], c.required ? "Обязательно" : "Желательно", "обязательность " + c.name);
    assert.equal(r[2], c.appliesTo, "для каких товаров " + c.name);
    assert.equal(r[3], c.explain, "что это " + c.name);
    assert.equal(r[4], c.allowed, "допустимые значения " + c.name);
    assert.equal(String(r[5] == null ? "" : r[5]), String(c.example), "пример " + c.name);
  });
});
