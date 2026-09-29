/* Структурный регресс-тест ПРОВОДКИ памяти полей исчезнувших комнат (В15).

   ЗАЧЕМ ПО ТЕКСТУ. Само правило памяти (что помнить, когда забыть, предел) покрыто поведенчески в
   tests/roomCarry.test.js (EPRoomCarry.reconcile) и в tests/roomMarkupBehavior.test.js (реальный путь
   удаления/перерисовки). Но ХРАНЕНИЕ памяти в проекте и её сбросы живут в тяжёлых функциях-оркестраторах
   app.js (projectSnapshot/restoreProject/clearBtn), которые в node живьём не исполнить. Их стережём по
   исходнику с вырезанными комментариями (общий стенд §7.1): без снимка в проект память не пережила бы
   перезагрузку между удалением стены и перерисовкой (Ж5), а без сбросов «прилипла» бы к чужой планировке.

   Комментарии вырезаны стендом — матчим только код (известная дыра: регэксп ловит закомментированный
   рядом вызов, и мутация «закомментировать» осталась бы зелёной). */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

const APP = stand.SRC;                              // js/app.js без комментариев
const DETECT = stand.sourceOf("roomDetect.js");    // js/roomDetect.js без комментариев

test("app.js: память заведена в state и попадает в снимок проекта (переживает автосейв/перезагрузку)", () => {
  assert.match(APP, /roomFieldMemory:\[\]/, "state инициализирует память пустым массивом");
  assert.match(APP, /roomFieldMemory:state\.roomFieldMemory/, "projectSnapshot кладёт память в снимок проекта");
});

test("app.js: restoreProject восстанавливает память, старый проект без поля открывается пустым", () => {
  assert.match(APP, /state\.roomFieldMemory=Array\.isArray\(p\.roomFieldMemory\)\?p\.roomFieldMemory:\[\]/,
    "restoreProject читает память из проекта, фолбэк [] для старых проектов");
});

test("app.js: «Очистить всё» забывает память полей", () => {
  assert.match(APP, /state\.roomFieldMemory=\[\]/, "clearBtn сбрасывает память (новая планировка с нуля)");
});

test("roomDetect.js: carryUserRoomFields идёт через reconcile и сохраняет обновлённую память в state", () => {
  assert.match(DETECT, /EPRoomCarry\.reconcile\(oldAutoRooms,newRooms,state\.roomFieldMemory,EPGeom\)/,
    "перенос+память считает EPRoomCarry.reconcile (одно правило в модуле), прежняя память приходит из state");
  assert.match(DETECT, /state\.roomFieldMemory=res\.memory/, "обновлённая память записывается обратно в state");
});

test("roomDetect.js: «Очистить разметку» забывает память полей", () => {
  assert.match(DETECT, /state\.roomLines=\[\];state\.roomFieldMemory=\[\]/,
    "clearRoomLines обнуляет и линии, и память полей (Ж5)");
});
