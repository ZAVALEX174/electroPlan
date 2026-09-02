/* HANDOFF 3.1: toast размещения обязан судить тем же EPRoomAssign.isOutsideRooms,
   что видимая метка и счётчик. Исполняем настоящий addPending из app.js через общий
   стенд, а не повторяем его условие в тесте. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const EPRoomAssign = require("../js/roomAssign.js");

function place({ rooms, assignedRoomId = null, roomRule = EPRoomAssign }) {
  const state = {
    pending: { type: "device", productId: "socket" },
    devices: [], posts: [], templates: [], rooms
  };
  const messages = [];
  const addPending = stand.run("addPending", {
    state,
    markCanvasUsed: () => {},
    uid: () => "dev-1",
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
  assert.equal(result.state.devices.length, 1, "сам объект по-прежнему размещается");
  assert.deepEqual(result.messages, [], "без комнат состояние roomId=null нормально и toast не нужен");
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
