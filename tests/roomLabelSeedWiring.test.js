/* В10: все пути СОЗДАНИЯ подписи контурной комнаты обязаны разводить две точки —
   якорь ЭКРАННОЙ таблички (room.x/y = roomLabelPoint − (45,16)) и seed привязки постов
   (room.seedX/Y = roomNamePoint, точка ВНУТРИ контура). Прежде оба брались из среднего вершин
   (polygonCentroid), у Г/П-комнаты уезжавшего наружу; смысл В10 — что seed берётся именно из
   inside-точки (roomNamePoint), а не из центроида и НЕ из якоря таблички.

   Проверяем по ИСХОДНОМУ тексту каждой функции app.js (второй копии правила не заводим, поведение
   самой inside-точки покрыто geometry.test / relabelContourRooms.test). Мутации «путь → polygonCentroid»
   и «seed = якорь» краснят здесь: в тексте пропадёт roomNamePoint или seed перестанет брать nm.* */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

/* poly — имя переменной контура в теле функции; obj — на что вешаются поля (room|r). */
const PATHS = [
  { fn: "refreshRoomAfterEdit", poly: "room.polygon", obj: "room" },
  { fn: "relabelContourRooms", poly: "r.polygon", obj: "r" },
  { fn: "detectRooms", poly: "poly", obj: null },        // объектный литерал, seedX:nm.x
  { fn: "detectRoomsML", poly: "poly", obj: null },
  { fn: "buildRoomsFromLines", poly: "poly", obj: null }
];

for (const p of PATHS) {
  test(`${p.fn}: якорь таблички — roomLabelPoint(контур), seed — roomNamePoint(контур) (не центроид)`, () => {
    const src = stand.functionSource(p.fn);
    const esc = p.poly.replace(/[.]/g, "\\.");
    assert.match(src, new RegExp("roomLabelPoint\\(" + esc + "\\)"),
      "якорь таблички считается через roomLabelPoint, а не polygonCentroid");
    assert.match(src, new RegExp("nm\\s*=\\s*roomNamePoint\\(" + esc + "\\)"),
      "seed считается через roomNamePoint (точка ВНУТРИ контура), а не polygonCentroid");
    if (p.obj) {
      // room.seedX=nm.x;room.seedY=nm.y  и  room.x=c.x-45;room.y=c.y-16
      assert.match(src, new RegExp(p.obj + "\\.seedX\\s*=\\s*nm\\.x"), "seedX = roomNamePoint.x (inside), не якорь");
      assert.match(src, new RegExp(p.obj + "\\.seedY\\s*=\\s*nm\\.y"), "seedY = roomNamePoint.y");
      assert.match(src, new RegExp(p.obj + "\\.x\\s*=\\s*c\\.x-45"), "x = якорь(roomLabelPoint).x − 45");
    } else {
      // объектный литерал: seedX:nm.x,seedY:nm.y,x:c.x-45,y:c.y-16
      assert.match(src, /seedX:\s*nm\.x/, "seedX = roomNamePoint.x (inside), не якорь");
      assert.match(src, /seedY:\s*nm\.y/, "seedY = roomNamePoint.y");
      assert.match(src, /x:\s*c\.x-45/, "x = якорь(roomLabelPoint).x − 45");
    }
  });
}
