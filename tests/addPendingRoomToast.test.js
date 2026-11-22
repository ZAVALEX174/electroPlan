/* HANDOFF 3.1: toast размещения обязан судить тем же EPRoomAssign.isOutsideRooms,
   что видимая метка и счётчик. Исполняем настоящий addPending из app.js через общий
   стенд, а не повторяем его условие в тесте. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const EPRoomAssign = require("../js/roomAssign.js");

function place({ rooms, assignedRoomId = null, roomRule = EPRoomAssign, pending = { type: "post", templateId: "t1" } }) {
  const state = {
    pending, devices: [], posts: [], templates: [{ id: "t1", mechanismIds: ["socket"] }], rooms
  };
  const messages = [];
  const addPending = stand.run("addPending", {
    state,
    /* В19: addPending читает/пишет эти переменные модуля (связь клика по иконке с двойным кликом);
       в изолированной вырезке их нет — кладём в контекст, как top-level let app.js. */
    _placeOnPostIcon: null, _lastIconPlacement: null,
    markCanvasUsed: () => {},
    uid: () => "post-1",
    EPPosts: require("../js/posts.js"),
    getRoomForPoint: () => null,
    frameForRoomPlacement: () => ({}),
    updateObjectRoom: created => { created.roomId = assignedRoomId; },
    setTool: () => {}, renderAll: () => {}, renderSummary: () => {},
    toast: message => messages.push(message),
    EPRoomAssign: roomRule
  });
  addPending(40, 50);
  return { state, messages };
}

test("комнат нет: размещение объекта не шумит предупреждением", () => {
  const result = place({ rooms: [] });
  assert.equal(result.state.posts.length, 1);
  assert.deepEqual(Array.from(result.state.posts[0].mechanismIds), ["socket"]);
  assert.equal(result.state.devices.length, 0);
  assert.deepEqual(result.messages, [], "без комнат состояние roomId=null нормально и toast не нужен");
});

test("старая команда размещения изделия не добавляет объектов на план", () => {
  const { state } = place({ rooms: [], pending: { type: "device", productId: "socket" } });
  assert.equal(state.devices.length, 0);
  assert.equal(state.posts.length, 0);
});

test("комната есть, объект снаружи: предупреждение остаётся", () => {
  const result = place({ rooms: [{ id: "R1", name: "Кухня" }] });
  assert.deepEqual(result.messages, ["Объект размещён вне комнаты"]);
});

test("объект попал в комнату: остаётся положительный toast с её именем", () => {
  const result = place({ rooms: [{ id: "R1", name: "Кухня" }], assignedRoomId: "R1" });
  assert.deepEqual(result.messages, ["Объект добавлен в комнату «Кухня»"]);
});

test("addPending делегирует решение EPRoomAssign с roomId и числом комнат", () => {
  const calls = [];
  const result = place({
    rooms: [{ id: "R1", name: "Кухня" }, { id: "R2", name: "Спальня" }],
    roomRule: {
      isOutsideRooms(roomId, roomCount) {
        calls.push([roomId, roomCount]);
        return false;
      }
    }
  });
  assert.deepEqual(calls, [[null, 2]]);
  assert.deepEqual(result.messages, [], "оркестратор принимает решение общего критерия, не своей копии");
});
