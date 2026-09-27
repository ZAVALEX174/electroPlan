/* В10: миграция открываемого проекта. relabelContourRooms пересчитывает якорь подписи КОНТУРНЫХ
   комнат через roomLabelPoint (точку внутри контура), чтобы у старых проектов табличка Г/П-образной
   комнаты, сохранённая по среднему вершин ВНЕ контура, оказалась внутри после открытия. Выпуклые
   комнаты (прямоугольники) не двигаются, комнаты без контура (инструмент «T») не трогаются.

   Исполняем НАСТОЯЩИЙ текст relabelContourRooms из app.js в vm-стенде с реальным roomLabelPoint
   (§7.1: второй копии правила не заводим). */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const { roomLabelPoint, roomNamePoint, polygonCentroid, pointInPolygon } = require("../js/geometry.js");

const relabel = rooms => { stand.run("relabelContourRooms", { roomLabelPoint, roomNamePoint })(rooms); return rooms; };

const RECT = [{ x: 10, y: 20 }, { x: 210, y: 20 }, { x: 210, y: 120 }, { x: 10, y: 120 }];
const GAMMA = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 300 }, { x: 0, y: 300 }];
const KITCHEN = [{ x: 40, y: 40 }, { x: 300, y: 40 }, { x: 300, y: 300 }, { x: 40, y: 300 }];
const visibleCenter = r => ({ x: r.x + 55, y: r.y + 18 }); // угол таблички = (x,y); центр = room.x+55/room.y+18 (app.js)

test("прямоугольная комната: якорь = центроид−(45,16), как раньше (не двигается)", () => {
  const c = polygonCentroid(RECT);
  const [r] = relabel([{ id: "a", polygon: RECT, x: 999, y: 999, seedX: 999, seedY: 999 }]);
  assert.equal(r.x, c.x - 45, "X якоря — прежняя формула центроида");
  assert.equal(r.y, c.y - 16, "Y якоря — прежняя формула центроида");
  assert.equal(r.seedX, c.x, "seedX = центроид");
});

test("Г-образная комната из старого проекта: подпись переезжает ВНУТРЬ контура", () => {
  /* старый битый якорь: по среднему вершин — он лежал в кухне */
  const cOld = polygonCentroid(GAMMA);
  const [r] = relabel([{ id: "g", polygon: GAMMA, x: cOld.x - 45, y: cOld.y - 16, seedX: cOld.x, seedY: cOld.y }]);
  const v = visibleCenter(r);
  assert.equal(pointInPolygon(v.x, v.y, GAMMA), true, "видимый центр таблички теперь в коридоре");
  assert.equal(pointInPolygon(v.x, v.y, KITCHEN), false, "и больше не в соседней кухне");
  const p = roomLabelPoint(GAMMA);
  assert.equal(r.x, p.x - 45, "якорь пересчитан через roomLabelPoint");
});

test("узкая Г-комната (16 px): seed (привязка постов) — точка ВНУТРИ контура, а не якорь таблички (В10 И5)", () => {
  /* Якорь экранной таблички у 16-px коридора уходит за стену (см. geometry.test), поэтому seed
     обязан браться из roomNamePoint (полюс, внутри), иначе привязка постов и поиск комнаты по seed
     промахнутся мимо контура. Мутация «seed = якорь» краснит здесь. */
  const NARROW = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 16 }, { x: 16, y: 16 }, { x: 16, y: 300 }, { x: 0, y: 300 }];
  const [r] = relabel([{ id: "n", polygon: NARROW, x: 0, y: 0, seedX: 0, seedY: 0 }]);
  assert.equal(pointInPolygon(r.seedX, r.seedY, NARROW), true, "seed внутри узкого контура");
  const anchor = roomLabelPoint(NARROW);
  assert.equal(pointInPolygon(anchor.x, anchor.y, NARROW), false, "а якорь таблички в 16-px коридоре вышел за стену — seed'ом быть не может");
});

test("комната без контура (инструмент «T») не трогается — её подпись тащат руками", () => {
  const [r] = relabel([{ id: "t", name: "Т", x: 100, y: 50, seedX: 120, seedY: 60 }]);
  assert.equal(r.x, 100, "X без контура сохранён");
  assert.equal(r.y, 50, "Y без контура сохранён");
  assert.equal(r.seedX, 120, "seedX без контура сохранён");
});

test("вырожденный «контур» (<3 вершин) считается комнатой без контура — не трогается", () => {
  const [r] = relabel([{ id: "d", polygon: [{ x: 1, y: 1 }, { x: 2, y: 2 }], x: 7, y: 8 }]);
  assert.equal(r.x, 7, "меньше 3 вершин — как комната без контура, X цел");
});

/* Подключение: restoreProject обязан прогнать миграцию по загруженным комнатам, иначе старый проект
   откроется со старым (внешним) якорем. Мутация «убрать вызов» краснит именно здесь. */
test("restoreProject зовёт relabelContourRooms на загруженных комнатах", () => {
  const src = stand.functionSource("restoreProject");
  assert.match(src, /relabelContourRooms\(state\.rooms\)/,
    "restoreProject обязан пересчитать подпись контурных комнат открываемого проекта");
});
