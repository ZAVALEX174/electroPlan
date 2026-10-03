/* ПОВЕДЕНЧЕСКИЙ регресс В16 на стороне ПРИЛОЖЕНИЯ (carryUserRoomFields в js/roomDetect.js): авто-комнаты,
   построенные из тех же линий ПОВЕРХ вручную поправленной, убираются ДО переноса полей и выдачи памяти.

   ЗАЧЕМ. Решение владельца (Б): «на этом месте остаётся ваша поправленная комната СО СВОИМ названием,
   схемой и ценой; второй комнаты поверх неё не появляется». Два свойства, которые чистый модуль
   (EPRoomCarry.coveredByManual) сам не гарантирует — их держит ПОРЯДОК вызовов в carryUserRoomFields:
     1) дубль, легший на поправленную, НЕ остаётся в state.rooms (иначе пост привязался бы к пустой
        поправленной, а имя/цена осели бы на дубле — денежный дефект);
     2) этот дубль исключается ДО reconcile, поэтому НЕ успевает забрать из памяти запись исчезнувшей
        комнаты — запись остаётся в памяти до настоящего возвращения комнаты (иначе потеря данных).

   Исполняем НАСТОЯЩИЙ текст carryUserRoomFields в vm; EPRoomCarry/EPGeom — настоящие модули.

   МУТАЦИОННАЯ ТАБЛИЦА (в отчёте):
     reconcile(oldAutoRooms,targets,…) → …,newRooms,… (дубль виден reconcile) → краснеет §память;
     manual=[] (признак накрытия отключён) → краснеют §дубль-убран и §память.
   Запуск: node --test tests/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const EPRoomCarry = require("../js/roomCarry.js");
const EPGeom = require("../js/geometry.js");

const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

test("В16: дубль на поправленной убран из state.rooms, память исчезнувшей комнаты сохранена", () => {
  // поправленная руками (autoPolygon:false) на всю область; свежий авто-дубль из линий — на её левой половине
  const M = { id: "m", polygon: rect(200, 200, 820, 400), autoPolygon: false, name: "Помещение 1" };
  const dup = { id: "dup", polygon: rect(200, 200, 500, 400), autoPolygon: true, name: "Помещение 2" };
  // память: «Кухня» жила на месте дубля и ждёт возвращения (её контур совпадает с дублем)
  const memory = [{ polygon: rect(200, 200, 500, 400), fields: { name: "Кухня", lightingScheme: "relay" } }];
  const state = { rooms: [M, dup], roomFieldMemory: memory };
  const carry = stand.run("carryUserRoomFields", { EPRoomCarry, EPGeom, state });
  carry([], [dup]);   // oldAuto пуст (M — ручная), newRooms — только свежий дубль

  assert.deepEqual(state.rooms.map(r => r.id), ["m"], "дубль убран — на холсте одна поправленная (пост привяжется к ней)");
  assert.equal(state.rooms[0].name, "Помещение 1", "поправленная осталась СО СВОИМ именем — дубль её не переименовал");
  assert.equal("lightingScheme" in state.rooms[0], false, "и со своей (пустой) схемой — поля с дубля не налипли");
  assert.equal(state.roomFieldMemory.length, 1, "память не опустела: дубль исключён ДО reconcile, «Кухня» не выдана");
  assert.equal(state.roomFieldMemory[0].fields.name, "Кухня", "в памяти по-прежнему «Кухня» — данные не потеряны");
});
