"use strict";
/* Порядок разделов окна выбора поста на НАСТОЯЩИХ группах нового каталога (К2).
   Берём «Функциональные группы» из собранного js/catalog-vimar-attrs.js (как в рантайме их
   отдаёт data.js), прогоняем EPCatalogSections.build и проверяем итоговый порядок подписей
   разделов — тот, что задал владелец: свет → клавиши/тумблер → розетки → разъёмы+заглушки →
   зарядные → климат → подсветка (одним блоком) → отели → механизмы → хвост по алфавиту.
   Имена разделов печатаются как в файле заказчика; ключи сравнения — без «ё». */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const sections = require("../js/catalogSections.js");

/* Группы механизмов/аксессуаров из собранного файла атрибутов — ровно те, что видит рантайм. */
function realGroups() {
  const win = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../js/catalog-vimar-attrs.js"), "utf8"), { window: win });
  const groups = (win.EP_VIMAR_ATTRS && win.EP_VIMAR_ATTRS.groups) || {};
  return [...new Set(Object.values(groups).map(g => g && g.group).filter(Boolean))];
}
function buildLabels(extraGroups = []) {
  const all = realGroups().concat(extraGroups);
  const items = all.map((g, i) => ({ code: "C" + i, name: "n" + i, functionalGroup: g, span: 1 }));
  return sections.build(items).sections.map(s => s.label);
}

test("порядок разделов нового каталога — как задал владелец", () => {
  const labels = buildLabels();
  const at = (lbl) => labels.indexOf(lbl);

  // 1. Свет первым, затем клавиши/тумблер.
  assert.equal(labels[0], "Управление светом");
  assert.ok(at("Управление светом") < at("Клавиша"));
  assert.ok(at("Клавиша") < at("Клавиши BLUETOOTH"));
  assert.ok(at("Клавиши BLUETOOTH") < at("Клавиши"));
  assert.ok(at("Клавиши") < at("Тумблер"));
  // 2–4. Розетки → разъёмы+заглушки → зарядные.
  assert.ok(at("Тумблер") < at("Силовые розетки"));
  assert.ok(at("Силовые розетки") < at("Информационные разъёмы и заглушки"));
  assert.ok(at("Информационные разъёмы и заглушки") < at("Зарядные устройства"));
  // 5. Климат-блок.
  assert.ok(at("Зарядные устройства") < at("Терморегуляторы"));
  assert.ok(at("Терморегуляторы") < at("Термодатчик"));
  assert.ok(at("Термодатчик") < at("Управление климатом"));
  assert.ok(at("Управление климатом") < at("Шторные кнопки"));
  // 7–8. Отели → механизмы.
  assert.ok(at("Отели") < at("Механизм"));
  assert.ok(at("Механизм") < at("Механизмы"));
  // 9. Хвост по алфавиту — после «Механизмы».
  assert.ok(at("Механизмы") < at("Лючок в пол"));
  assert.ok(at("Механизмы") < at("Реле"));
});

test("«ё/е»: «Информационные разъёмы и заглушки» (через ё) встаёт на своё место, не в хвост", () => {
  const labels = buildLabels();
  const idx = labels.indexOf("Информационные разъёмы и заглушки");
  assert.ok(idx >= 0, "раздел присутствует");
  // Ключ раздела в файле — через «ё», в DEFAULT_ORDER — через «е»; без складки «ё»→«е» он не
  // совпал бы с порядком и уехал бы в хвост (после механизмов). Проверяем, что он ПЕРЕД зарядными.
  assert.ok(idx < labels.indexOf("Зарядные устройства"));
  assert.ok(idx < labels.indexOf("Механизмы"));
});

test("«подсветка клавиш*»: все варианты идут одним блоком между климатом и отелями", () => {
  // Добавляем вариант, которого нет в текущем каталоге (имитация нового написания от заказчика),
  // — он тоже обязан попасть в блок подсветки, а не в хвост.
  const labels = buildLabels(["Подсветка клавиш сверхновая версия"]);
  const idxs = labels.map((l, i) => [l, i]).filter(([l]) => /^Подсветка клавиш/.test(l)).map(([, i]) => i);
  assert.ok(idxs.length >= 8, `вариантов подсветки ${idxs.length} (≥8)`);
  // Непрерывность блока: индексы идут подряд.
  assert.equal(Math.max(...idxs) - Math.min(...idxs) + 1, idxs.length, "подсветка идёт подряд, без разрывов");
  // Блок — после «Шторные кнопки» и перед «Отели».
  assert.ok(labels.indexOf("Шторные кнопки") < Math.min(...idxs));
  assert.ok(Math.max(...idxs) < labels.indexOf("Отели"));
  // Новый (отсутствующий в каталоге) вариант не уехал в хвост.
  assert.ok(labels.indexOf("Подсветка клавиш сверхновая версия") < labels.indexOf("Отели"));
});
