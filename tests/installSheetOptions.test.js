/* К11-3а. Модель галочек листа монтажника (js/installSheetOptions.js). Проверяем ЧИСТУЮ
   модель: состав наборов строго по утверждённой таблице (docs/К11-разведка.md «Галочки окна
   листа — УТВЕРЖДЕНО»), нормализацию, свои слоты, миграцию трёх случаев и независимость от КП.

   МУТАЦИИ (сломать код — тест краснеет):
     (2) в migrate убрать today.exploded = !assembled (оставить exploded по умолчанию схемы)
         → красит «миграция exploded/нет поля» и «миграция assembled» (вид поста не выставлен);
     (2b) в migrate убрать today.assembled = false (оставить assembled по умолчанию схемы)
         → красит обе «миграции» (у старого проекта появился бы новый блок «Общая сборка»);
     (3) в preset("client") включить articles (on.articles = true)
         → красит «Клиенту — ровно номер и картинка» (лишний артикул).
   Запуск: node --test tests/installSheetOptions.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const EPInstallSheetOptions = require("../js/installSheetOptions.js");
const EPOfferOptions = require("../js/offerOptions.js");

/* Утверждённая таблица наборов — единственный источник ожиданий (1 = галочка стоит). */
const TABLE = {
  //            plan number illustration assembled exploded fill modules box articles notes prices lighting supplier
  builder: { plan:1, number:1, illustration:1, assembled:1, exploded:1, fill:1, modules:1, box:1, articles:1, notes:1, prices:0, lighting:1, supplier:1 },
  client:  { plan:1, number:1, illustration:1, assembled:0, exploded:0, fill:0, modules:0, box:0, articles:0, notes:0, prices:0, lighting:0, supplier:0 }
};
const asBool = row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, !!v]));

test("К11-3а: набор «Строителю» точно по таблице", () => {
  assert.deepEqual(EPInstallSheetOptions.preset("builder"), asBool(TABLE.builder));
});

test("К11-3а: набор «Клиенту» — ровно номер и картинка (мутация 3)", () => {
  assert.deepEqual(EPInstallSheetOptions.preset("client"), asBool(TABLE.client));
  const c = EPInstallSheetOptions.preset("client");
  assert.equal(c.articles, false, "у клиента артикулов нет");
  assert.equal(c.fill, false); assert.equal(c.prices, false);
  assert.equal(c.lighting, false); assert.equal(c.supplier, false);
});

test("К11-3а: все ключи таблицы совпадают с ключами схемы (ни одного лишнего/пропущенного)", () => {
  const schemaKeys = EPInstallSheetOptions.fields.map(([k]) => k).sort();
  assert.deepEqual(schemaKeys, Object.keys(TABLE.builder).sort());
  /* у каждого поля есть подпись — окно не покажет «undefined» */
  for (const [k, label] of EPInstallSheetOptions.fields) {
    assert.equal(typeof label, "string"); assert.ok(label.length);
    assert.equal(EPInstallSheetOptions.labels[k], label);
  }
});

test("К11-3а: умолчания схемы = набор «Строителю»", () => {
  assert.deepEqual(EPInstallSheetOptions.normalize(), EPInstallSheetOptions.preset("builder"));
  assert.deepEqual(EPInstallSheetOptions.normalize(null), EPInstallSheetOptions.preset("builder"));
});

test("К11-3а: normalize хранит явные false, отбрасывает чужие поля и неверные типы, не мутирует вход", () => {
  const input = { prices: true, articles: "false", lighting: false, alien: 1 };
  const before = JSON.stringify(input);
  const o = EPInstallSheetOptions.normalize(input);
  assert.equal(o.prices, true, "явный true сохранён");
  assert.equal(o.lighting, false, "явный false сохранён");
  assert.equal(o.articles, true, "строка «false» — не булево → умолчание (true)");
  assert.equal(o.alien, undefined, "чужой ключ отброшен");
  assert.equal(o.plan, true, "пропущенное поле — умолчание");
  assert.equal(JSON.stringify(input), before, "вход не изменён");
});

test("К11-3а: sameOptions сравнивает по видимости, порядок ключей не важен", () => {
  const a = EPInstallSheetOptions.preset("builder");
  const b = {}; EPInstallSheetOptions.fields.slice().reverse().forEach(([k]) => { b[k] = a[k]; });
  assert.ok(EPInstallSheetOptions.sameOptions(a, b), "тот же состав в другом порядке — совпадает");
  assert.ok(!EPInstallSheetOptions.sameOptions(a, EPInstallSheetOptions.preset("client")));
  assert.ok(EPInstallSheetOptions.sameOptions(null, EPInstallSheetOptions.preset("builder")), "пусто = умолчания");
});

test("К11-3а: свои слоты — ровно CUSTOM_SLOTS, безымянные/битые отбрасываются", () => {
  const N = EPInstallSheetOptions.CUSTOM_SLOTS;
  assert.equal(N, 3);
  const raw = [{ name: "Мой", options: { prices: true } }, { name: "  ", options: {} }, "мусор", { name: "Лишний" }];
  const list = EPInstallSheetOptions.normalizeCustomPresets(raw);
  assert.equal(list.length, N);
  assert.equal(list[0].name, "Мой");
  assert.deepEqual(list[0].options, EPInstallSheetOptions.normalize({ prices: true }));
  assert.equal(list[1], null, "пробельное имя → пусто");
  assert.equal(list[2], null, "не объект → пусто");
});

test("К11-3а: saveCustomPreset возвращает новый список, вход не мутирует, границы соблюдает", () => {
  const start = EPInstallSheetOptions.normalizeCustomPresets([]);
  const saved = EPInstallSheetOptions.saveCustomPreset(start, 1, "  Монтаж  ", { prices: false, box: false });
  assert.equal(saved[1].name, "Монтаж", "имя обрезано");
  assert.equal(saved[1].options.box, false);
  assert.equal(start[1], null, "исходный список не изменён");
  assert.deepEqual(EPInstallSheetOptions.saveCustomPreset(start, 1, "   ", {}), start, "пустое имя — без записи");
  assert.deepEqual(EPInstallSheetOptions.saveCustomPreset(start, 9, "X", {}), start, "слот вне диапазона — без записи");
});

/* ---- Миграция старых проектов = сегодняшний лист (три случая) ---- */
const todayFull = { plan:true, number:true, illustration:true, fill:true, modules:true,
  box:true, articles:true, notes:true, prices:true, lighting:true, supplier:true };

test("К11-3а: миграция «exploded» → весь лист, взрыв-схема, без общей сборки, с ценами (мутация 2)", () => {
  assert.deepEqual(EPInstallSheetOptions.migrate({ assemblyView: "exploded" }),
    { ...todayFull, assembled: false, exploded: true });
});

test("К11-3а: миграция «assembled» → весь лист, ТОЛЬКО иллюстрация (без общей сборки и взрыв-схемы), с ценами (мутации 2, 2b)", () => {
  /* Сегодня режим «assembled» печатает маленькую картинку без схемы. Новый блок «Общая сборка»
     (крупная картинка) миграция НЕ включает — иначе у старого проекта появился бы блок, которого
     он не печатал (решение владельца 27.10). illustration остаётся (она печаталась всегда). */
  assert.deepEqual(EPInstallSheetOptions.migrate({ assemblyView: "assembled" }),
    { ...todayFull, assembled: false, exploded: false });
  assert.equal(EPInstallSheetOptions.migrate({ assemblyView: "assembled" }).illustration, true,
    "маленькая иллюстрация в режиме общей сборки печаталась всегда — остаётся включённой");
});

test("К11-3а: миграция без поля assemblyView = как «exploded» (старый проект открывается как раньше)", () => {
  const expected = { ...todayFull, assembled: false, exploded: true };
  assert.deepEqual(EPInstallSheetOptions.migrate({}), expected);
  assert.deepEqual(EPInstallSheetOptions.migrate(undefined), expected);
  assert.deepEqual(EPInstallSheetOptions.migrate({ assemblyView: "чушь" }), expected, "иное значение — как exploded");
  /* миграция всегда печатает цены — у старого проекта сумма в «Группах света» не должна пропасть молча */
  assert.equal(EPInstallSheetOptions.migrate({}).prices, true);
});

test("К11-3а: галочки листа и КП независимы — разные схемы, модуль не трогает EPOfferOptions", () => {
  assert.notEqual(EPInstallSheetOptions, EPOfferOptions, "это разные модули");
  /* схема листа — плоская (ключи-флаги), у КП — вложенные группы sections/layout/specification */
  const sheet = EPInstallSheetOptions.normalize();
  assert.equal(sheet.sections, undefined); assert.equal(sheet.layout, undefined);
  const kpBefore = JSON.stringify(EPOfferOptions.preset("builder"));
  /* полный прогон модели листа не должен ничего менять в наборе КП (нет общего состояния) */
  EPInstallSheetOptions.preset("builder"); EPInstallSheetOptions.preset("client");
  EPInstallSheetOptions.migrate({ assemblyView: "assembled" });
  EPInstallSheetOptions.saveCustomPreset([], 0, "X", { prices: true });
  assert.equal(JSON.stringify(EPOfferOptions.preset("builder")), kpBefore, "набор КП не изменился");
  /* ключ «articles» у листа — плоский флаг; у КП «articles» живёт в другом месте схемы */
  assert.equal(typeof sheet.articles, "boolean");
});
