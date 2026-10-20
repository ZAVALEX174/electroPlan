/* ЧИСТАЯ функция модуля «Данные проекта и КП» (js/projectSetup.js): решение «открывать ли окно само
   на загрузке». Владелец 20.10: окно открывается само ТОЛЬКО когда проекта ещё нет (новый проект или
   первый запуск); восстановленный и открытый из файла проект окно сам не показывает.

   МУТАЦИОННАЯ ТАБЛИЦА (сломай код — покраснеет тест):
     shouldOpenOnLoad: return !hasProject → return hasProject → краснеет «чистый старт — открыть»;
     shouldOpenOnLoad: return !hasProject → return true → краснеет «есть проект — не открывать».
   Запуск: node --test tests/projectSetup.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const EPProjectSetup = require("../js/projectSetup.js");

test("чистый старт (проекта нет) — окно открыть само", () => {
  assert.equal(EPProjectSetup.shouldOpenOnLoad(false), true);
});

test("есть восстановленный проект — окно само НЕ открывать", () => {
  assert.equal(EPProjectSetup.shouldOpenOnLoad(true), false);
});

/* app.js зовёт shouldOpenOnLoad(!!restored): null/undefined (проекта нет) → открыть, объект → нет.
   Проверяем на тех же значениях, что приходят из init(), чтобы тест держал реальный контракт. */
test("контракт с init: !!restored", () => {
  assert.equal(EPProjectSetup.shouldOpenOnLoad(!!null), true);         // чистый старт
  assert.equal(EPProjectSetup.shouldOpenOnLoad(!!undefined), true);    // первый запуск
  assert.equal(EPProjectSetup.shouldOpenOnLoad(!!{ savedAt: "x" }), false);  // восстановлен
});
