/* Автотесты разделов выбора товара в полноэкранном конструкторе (E17).
   Запуск без зависимостей и без сборщика:  node --test tests/
   Модуль js/catalogSections.js — чистый (ни DOM, ни state, ни каталога), поэтому браузер
   поднимать не нужно. Проверяем ровно то, что просил заказчик: разделы из его собственной
   колонки «Функциональная группа», порядок разделов и оба фильтра (поиск и свободное место). */
const test = require("node:test");
const assert = require("node:assert/strict");
const { build, DEFAULT_ORDER, NO_GROUP_LABEL } = require("../js/catalogSections.js");

const item = (id, code, name, group, span, extra) => Object.assign(
  { id, code, name, functionalGroup: group, span: span || 1 }, extra || {});
const spanOf = it => it.span;
const run = (items, opts) => build(items, Object.assign({ spanOf }, opts || {}));

const KEY = item(1, "20021", "Клавиша на 1 модуль серая", "управление светом");
const KEY2 = item(2, "20022", "Клавиша на 2 модуля серая", "управление светом", 2);
const SOCKET = item(3, "20210", "Розетка 2P+T 16A", "Розетки");
const USB = item(4, "20295", "Разъём USB", "Зарядные устройства");

test("разделы берутся из «Функциональной группы», а не выдумываются", () => {
  const res = run([KEY, SOCKET, USB]);
  assert.deepEqual(res.sections.map(s => s.label), ["Управление светом", "Розетки", "Зарядные устройства"]);
  assert.equal(res.shown, 3);
});

test("подпись раздела печатается с заглавной, а ключ схлопывает регистр", () => {
  /* В номенклатуре одна и та же группа записана и «отели», и «Отели» — это ОДИН раздел
     заказчика, и разъехаться на два по одной позиции он не имеет права. */
  const res = run([item(1, "A", "a", "отели"), item(2, "B", "b", "Отели")]);
  assert.equal(res.sections.length, 1);
  assert.equal(res.sections[0].label, "Отели");
  assert.equal(res.sections[0].key, "отели");
  assert.equal(res.sections[0].items.length, 2);
});

test("порядок разделов — как думает заказчик, свет первым; незнакомый раздел уходит в хвост", () => {
  const res = run([USB, item(9, "X", "Икс", "Придуманный раздел"), SOCKET, KEY]);
  const labels = res.sections.map(s => s.label);
  assert.equal(labels[0], "Управление светом");
  assert.equal(labels[1], "Розетки");
  assert.equal(labels[2], "Зарядные устройства");
  assert.equal(labels[3], "Придуманный раздел");
  /* порядок задан списком модуля, а не алфавитом — иначе «Зарядные» встали бы перед «Розетками» */
  assert.ok(DEFAULT_ORDER.indexOf("управление светом") === 0);
});

test("механизм без группы попадает в отдельный раздел, а не приписывается к соседнему", () => {
  const res = run([KEY, item(5, "Z", "Что-то", "")]);
  const last = res.sections[res.sections.length - 1];
  assert.equal(last.label, NO_GROUP_LABEL);
  assert.equal(last.items.length, 1);
});

test("ФИЛЬТР СВОБОДНОГО МЕСТА: двухмодульный не предлагается, когда свободен один модуль", () => {
  /* Тот же предел, что раньше стоял на <select> слота (mechanismOptions maxSpan). Регресс здесь
     означает, что в накладку с одним свободным модулем можно выбрать 2М-механизм. */
  const res = run([KEY, KEY2], { maxSpan: 1 });
  const light = res.sections[0];
  assert.deepEqual(light.items.map(x => x.code), ["20021"]);
  assert.equal(light.hiddenBySpan, 1);
  assert.equal(res.hiddenBySpan, 1);
});

test("раздел, из которого всё вырезал фильтр по месту, ОСТАЁТСЯ с объяснением", () => {
  /* Исчезнувший на глазах раздел читается как сбой каталога; пустой раздел с числом скрытых —
     как «сюда сейчас ничего не влезет». */
  const res = run([KEY2], { maxSpan: 1 });
  assert.equal(res.sections.length, 1);
  assert.equal(res.sections[0].items.length, 0);
  assert.equal(res.sections[0].hiddenBySpan, 1);
});

test("поиск идёт по артикулу и названию и УБИРАЕТ раздел целиком", () => {
  const byCode = run([KEY, SOCKET], { query: "20210" });
  assert.deepEqual(byCode.sections.map(s => s.label), ["Розетки"]);
  const byName = run([KEY, SOCKET], { query: "клавиша" });
  assert.deepEqual(byName.sections.map(s => s.label), ["Управление светом"]);
  const nothing = run([KEY, SOCKET], { query: "нетакого" });
  assert.equal(nothing.sections.length, 0);
  assert.equal(nothing.hiddenByQuery, 2);
});

test("поиск не зависит от регистра и лишних пробелов", () => {
  const res = run([KEY], { query: "  КЛАВИША  " });
  assert.equal(res.sections.length, 1);
});

test("раздел-исключение (голые механизмы) всегда последний, что бы ни стояло в порядке", () => {
  /* Голый механизм подставляет расчёт групп света; рядом с готовыми изделиями он провоцирует
     двойную оплату, поэтому уезжает в конец списка отдельным разделом. */
  const bare = item(6, "20001.0", "Механизм-выключатель", "Механизмы", 1, { bare: true });
  const res = run([bare, SOCKET, KEY], { asideOf: it => it.bare ? "Голые механизмы" : null });
  const labels = res.sections.map(s => s.label);
  assert.equal(labels[labels.length - 1], "Голые механизмы");
  assert.equal(res.sections[res.sections.length - 1].aside, true);
});

test("товары внутри раздела идут по артикулу численно: 20010 после 20002, а не между 2 и 3", () => {
  const res = run([
    item(1, "20010", "Десятый", "Розетки"),
    item(2, "20002", "Второй", "Розетки"),
    item(3, "20003", "Третий", "Розетки")
  ]);
  assert.deepEqual(res.sections[0].items.map(x => x.code), ["20002", "20003", "20010"]);
});

test("пустой вход и мусор не роняют раскладку", () => {
  assert.deepEqual(build([], {}).sections, []);
  assert.deepEqual(build(null, null).sections, []);
});
