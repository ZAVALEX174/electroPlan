/* Строка проекта в шапке (P1-1): ЧИСТАЯ функция EPTopbar.projectLabel собирает «<проект> · КП № <номер>».
   Это ЕДИНСТВЕННОЕ место правила текста (§7.1) — все пути обновления (ввод, загрузка, открытие файла,
   автономер при печати) зовут его через syncProjectName. Проверяем четыре случая: обе части, только имя,
   только номер, обе пустые, плюс что разделитель « · » появляется ТОЛЬКО между двумя непустыми частями.

   МУТАЦИОННАЯ ПРОВЕРКА (сделана руками, факт — в отчёте): projectLabel всегда возвращать parts.join(" · ")
   БЕЗ фильтрации пустых (pуsh без if) → «только номер» и «только имя» краснеют (вылезает « · » у пустой
   части); убрать префикс "КП № " → «только номер» и «оба» краснеют.
   Запуск: node --test tests/topbarProjectLabel.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { projectLabel } = require("../js/topbar.js");

test("оба заполнены → «имя · КП № номер»", () => {
  assert.equal(projectLabel("Квартира, ул. Ленина 12", "EPG-2026-0147"),
    "Квартира, ул. Ленина 12 · КП № EPG-2026-0147");
});

test("только имя проекта → без « · » и без «КП №»", () => {
  assert.equal(projectLabel("Коттедж", ""), "Коттедж");
  assert.equal(projectLabel("Коттедж", null), "Коттедж");
  assert.equal(projectLabel("Коттедж", "   "), "Коттедж");   // пробелы = пусто
});

test("только номер → «КП № номер», без ведущего разделителя", () => {
  assert.equal(projectLabel("", "0147"), "КП № 0147");
  assert.equal(projectLabel(null, "0147"), "КП № 0147");
});

test("обе части пусты → пустая строка (блок скрывается)", () => {
  assert.equal(projectLabel("", ""), "");
  assert.equal(projectLabel(null, undefined), "");
  assert.equal(projectLabel("  ", "  "), "");
});
