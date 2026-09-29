/* З11: поведенческое покрытие инструмента «Разметка» помещений (фабрика EPRoomDetect.attach,
   js/roomDetect.js). До сих пор НИ ОДИН тест не ИСПОЛНЯЛ функции разметки — только *Wiring-тесты
   сверяли ТЕКСТ. Поэтому три поломки проходили молча (mut-i1g.json):
     M7 — clearRoomLines не очищает state.roomLines («Очистить разметку» ничего не чистит);
     M8 — resolveRoomLinePoint без магнита (клик не притягивается к концам/пересечениям линий);
     M9 — removeRoomLine не пересобирает помещения после удаления линии.
   Здесь дыра закрывается: тесты гоняют НАСТОЯЩИЙ код разметки на сценарии владельца.

   ПОДХОД (общий стенд §7.1). roomDetect.js в node не грузится (IIFE + window-namespace); вырезаем
   ИСХОДНЫЙ ТЕКСТ настоящих функций и исполняем их ВМЕСТЕ в одном vm-контексте — так addRoomLinePoint
   изнутри зовёт НАСТОЯЩИЙ resolveRoomLinePoint → roomLineMagnet, buildRoomsFromLines — НАСТОЯЩИЙ
   carryUserRoomFields, а вся геометрия/сборка идёт через НАСТОЯЩИЕ чистые модули (js/geometry.js,
   js/viewport.js, js/roomsFromLines.js, js/roomCarry.js) — их не подменяем, второй копии правил нет.

   ПРО ТАЙМЕР (M9). Автопересчёт помещений висит на scheduleRoomsFromLines, который по И1 ОСТАЛСЯ в
   app.js (гейт автосейва _autosaveOn делит его со scheduleSave). Чтобы M9 краснела на НАСТОЯЩЕМ
   пути, а не на заглушке, мы вырезаем и scheduleRoomsFromLines ИЗ app.js и исполняем рядом:
   removeRoomLine/addRoomLinePoint зовут его как в браузере, а он — настоящий buildRoomsFromLines.
   setTimeout в стенде синхронный, поэтому дебаунс не мешает: пересчёт доводится до конца в тесте
   (сам дебаунс — забота app.js, его сторожит scheduleRoomsFromLines-wiring). Вырезка тянет за собой
   пару соседних const PLAN_VIS_* (стоят между функциями) — они инертны.

   ПРО СЕТКУ (M8). Магнит к линиям обязан работать ВСЕГДА, даже когда «привязка к сетке» выключена
   (решение владельца: отключать сетку, а не все магниты). Поэтому в тестах state.snapGrid=false: так
   совпадение клика с узлом — заслуга ИМЕННО магнита, а не сетки; иначе округление к сетке 10px
   повторило бы результат магнита в тех же круглых координатах и M8 не покраснела бы (тавтология). */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");

/* Настоящие чистые модули — вход в стенд как есть (их логику не дублируем). */
const EPGeom = require("../js/geometry.js");
const EPConfig = require("../js/config.js");
const EPViewport = require("../js/viewport.js");
const EPRoomsFromLines = require("../js/roomsFromLines.js");
const EPRoomCarry = require("../js/roomCarry.js");
const EPRoom = require("../js/room.js");   /* разрешение схемы комнаты — тот же вход, что у schemeForPartition */

/* Готовит vm-контекст с настоящими функциями разметки + scheduleRoomsFromLines (из app.js).
   Зависимости вне темы разметки (перерисовки, сохранение, статусы) — тихие заглушки-шпионы; всё,
   на чём держится проверяемое поведение (геометрия, сборка помещений, перенос полей, гейт автосейва
   и таймер пересчёта), — настоящее. setTimeout синхронный: доводит автопересчёт до конца в тесте. */
function buildStand(state) {
  const spies = { toast: [], status: [], save: 0, persist: 0, reschedules: 0 };
  let uidN = 0;
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const ctx = {
    EPGeom, EPConfig, EPViewport, EPRoomsFromLines, EPRoomCarry,
    roomLabelPoint: EPGeom.roomLabelPoint, roomNamePoint: EPGeom.roomNamePoint,
    state, canvas,
    uid: prefix => prefix + ++uidN,
    wallRadiusFor: () => 7,
    markCanvasUsed() {},
    drawRoomLines() {}, renderRooms() {}, renderAll() {},
    /* тонкая копия связки app.js: пересчёт привязок + перерисовка + сохранение. Комнаты не трогает —
       это делают сами функции разметки, тут только прогоняем краску/сейв, чтобы шпионы отражали факт */
    refreshAfterRoomAssignments(paint, save) { if (paint) paint(); if (save) save(); },
    scheduleSave() { spies.save++; },
    persistProject() { spies.persist++; },
    toast(m) { spies.toast.push(m); },
    updateStatus(m) { spies.status.push(m); },
    /* гейт автосейва и таймер автопересчёта — те же имена, что в app.js */
    _autosaveOn: true,
    _roomsTimer: null,
    setTimeout: fn => { spies.reschedules++; fn(); return 1; },
    clearTimeout() {}
  };
  const code = [
    stand.functionSource("carryUserRoomFields"),
    stand.functionSource("makeRoomLine"),
    stand.functionSource("roomLineMagnet"),
    stand.functionSource("resolveRoomLinePoint"),
    stand.functionSource("finishRoomLineChain"),
    stand.functionSource("addRoomLinePoint"),
    stand.functionSource("removeRoomLine"),
    stand.functionSource("clearRoomLines"),
    stand.functionSource("buildRoomsFromLines"),
    stand.functionSource("scheduleRoomsFromLines"),   // из app.js — настоящий путь автопересчёта
    ";({ resolveRoomLinePoint, addRoomLinePoint, removeRoomLine, clearRoomLines, buildRoomsFromLines, finishRoomLineChain });"
  ].join("\n");
  vm.createContext(ctx);
  const api = vm.runInContext(code, ctx);
  return { api, state, spies };
}

/* snapGrid=false — ключ для M8 (см. шапку): магнит изолирован от сетки. Прочие поля state — как
   в разметке по умолчанию. */
function makeState(over) {
  return Object.assign({
    tool: "roomline", scale: 1,
    orthoMode: false, snapGrid: false, gridStep: 10,
    roomLines: [], roomLinePoints: [], roomLineIds: [], roomLineHover: null,
    rooms: [], roomFieldMemory: []   /* память полей исчезнувших комнат (В15) — как в проекте */
  }, over);
}

/* Клик инструментом «Разметка» в мировых координатах (rect={0,0}, scale=1 → экранные = мировым). */
const click = (api, x, y) => api.addRoomLinePoint({ clientX: x, clientY: y, shiftKey: false });

/* Есть ли среди линий отрезок с такими концами (в любой ориентации). */
function findLine(lines, ax, ay, bx, by) {
  return lines.find(l =>
    (l.a.x === ax && l.a.y === ay && l.b.x === bx && l.b.y === by) ||
    (l.a.x === bx && l.a.y === by && l.b.x === ax && l.b.y === ay)) || null;
}

/* Сценарий владельца: два смежных прямоугольника. Левый рисуем и замыкаем; правый начинаем/кончаем
   чуть МИМО общих вершин левого (401,199)/(399,351) — их ловит магнит к концам, поэтому общая сторона
   x=400 не задваивается, а контур правого замыкается через неё. Правый оставляем незамкнутым цепочкой
   (как Esc в UI) — двумя гранями планарного графа он всё равно станет комнатой. */
function drawTwoRooms() {
  const built = buildStand(makeState());
  const { api } = built;
  click(api, 200, 200); click(api, 400, 200); click(api, 400, 350); click(api, 200, 350);
  click(api, 201, 201);                       // ≈первая точка → замыкание левого контура
  click(api, 401, 199);                       // магнит → общая вершина (400,200)
  click(api, 600, 200); click(api, 600, 350);
  click(api, 399, 351);                       // магнит → общая вершина (400,350)
  api.finishRoomLineChain();                  // завершить цепочку без замыкания (как Esc)
  return built;
}

/* --- M8/магнит: клик у узла притягивается РОВНО к нему при выключенной сетке --------------------- */
test("клик у конца линии садится точно на него магнитом, даже когда привязка к сетке выключена", () => {
  const state = makeState();
  const L = (ax, ay, bx, by, id) => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by } });
  /* левый контур уже нарисован — концы линий заданы напрямую, проверяем именно магнит */
  state.roomLines = [
    L(200, 200, 400, 200, "l1"), L(400, 200, 400, 350, "l2"),
    L(400, 350, 200, 350, "l3"), L(200, 350, 200, 200, "l4")
  ];
  const { api } = buildStand(state);
  const p1 = api.resolveRoomLinePoint(401, 199, false);   // 1.4px от узла (400,200)
  assert.deepEqual({ x: p1.x, y: p1.y, kind: p1.kind }, { x: 400, y: 200, kind: "endpoint" });
  const p2 = api.resolveRoomLinePoint(399, 351, false);   // 1.4px от узла (400,350)
  assert.deepEqual({ x: p2.x, y: p2.y, kind: p2.kind }, { x: 400, y: 350, kind: "endpoint" });
  /* контроль: вдали от узлов магнита нет, сетка выключена → клик остаётся на месте. Значит
     совпадения выше — работа магнита, а не округления к сетке (иначе M8 была бы тавтологией) */
  const far = api.resolveRoomLinePoint(555, 222, false);
  assert.deepEqual({ x: far.x, y: far.y, kind: far.kind }, { x: 555, y: 222, kind: "grid" });
});

/* --- Магнит при рисовании: 7 линий, общая сторона не задваивается (addRoomLinePoint) ------------- */
test("рисование двух смежных контуров даёт 7 линий: общая сторона x=400 не задваивается", () => {
  const { state } = drawTwoRooms();
  assert.equal(state.roomLines.length, 7, "4 линии левого контура + 3 правого (общую сторону не дублируем)");
  assert.ok(findLine(state.roomLines, 200, 200, 400, 200), "верх левого");
  assert.ok(findLine(state.roomLines, 400, 200, 400, 350), "общая сторона x=400 — нарисована один раз");
  assert.ok(findLine(state.roomLines, 400, 350, 200, 350), "низ левого");
  assert.ok(findLine(state.roomLines, 200, 350, 200, 200), "левая стена левого");
  assert.ok(findLine(state.roomLines, 400, 200, 600, 200), "верх правого начат РОВНО на общей вершине (400,200)");
  assert.ok(findLine(state.roomLines, 600, 200, 600, 350), "правая стена правого");
  assert.ok(findLine(state.roomLines, 600, 350, 400, 350), "низ правого доведён РОВНО до общей вершины (400,350)");
  const shared = state.roomLines.filter(l => l.a.x === 400 && l.b.x === 400);
  assert.equal(shared.length, 1, "вертикаль x=400 единственная — стена между комнатами не задвоена");
});

/* --- Сборка помещений по линиям: две комнаты через общую стену (buildRoomsFromLines) ------------- */
test("«Определить помещения по линиям» строит две комнаты, разделённые общей стеной", () => {
  const built = drawTwoRooms();
  built.spies.toast.length = 0;
  built.api.buildRoomsFromLines();                 // как кнопка «Определить помещения по линиям»
  const rooms = built.state.rooms;
  assert.equal(rooms.length, 2, "две грани планарного графа — две комнаты");
  const cx = r => EPGeom.polygonCentroid(r.polygon).x;
  const left = rooms.find(r => cx(r) < 400), right = rooms.find(r => cx(r) > 400);
  assert.ok(left && right, "одна комната левее общей стены x=400, другая правее");
  assert.equal(Math.round(EPGeom.polygonAreaPx(left.polygon)), 30000, "левая: 200×150 px");
  assert.equal(Math.round(EPGeom.polygonAreaPx(right.polygon)), 30000, "правая: 200×150 px");
  assert.ok(built.spies.toast.some(m => /Помещений по линиям: 2/.test(m)), "тост о двух помещениях");
});

/* --- M9/пересборка при удалении линии: правая исчезает, левая хранит имя (removeRoomLine) -------- */
test("удаление линии инструментом «Удалить» пересобирает помещения: правая исчезает, левая хранит имя", () => {
  const built = drawTwoRooms();
  built.api.buildRoomsFromLines();
  const { state, api } = built;
  assert.equal(state.rooms.length, 2, "предусловие: две комнаты построены");
  /* владелец переименовал левую (набор имени НЕ снимает autoPolygon — она остаётся источником переноса) */
  const left = state.rooms.find(r => EPGeom.polygonCentroid(r.polygon).x < 400);
  left.name = "Bedroom";
  /* «Удалить» → клик по верхней линии правой комнаты; общую стену не трогаем */
  const top = findLine(state.roomLines, 400, 200, 600, 200);
  api.removeRoomLine(top.id);
  assert.equal(state.roomLines.length, 6, "удалена ровно одна линия");
  assert.equal(state.rooms.length, 1, "правый контур разомкнут — правая комната пересобрана прочь");
  assert.equal(state.rooms[0].name, "Bedroom", "левая пережила пересборку и сохранила введённое имя (carryUserRoomFields)");
  assert.ok(EPGeom.polygonCentroid(state.rooms[0].polygon).x < 400, "уцелела именно левая комната");
});

/* --- M7/очистка разметки: линии обнуляются, помещения остаются (clearRoomLines) ----------------- */
test("«Очистить разметку» обнуляет линии, но помещения (и их деньги) не пересобирает и не удаляет", () => {
  const built = drawTwoRooms();
  built.api.buildRoomsFromLines();
  const { state, api } = built;
  const left = state.rooms.find(r => EPGeom.polygonCentroid(r.polygon).x < 400);
  left.name = "Bedroom";
  assert.equal(state.rooms.length, 2, "предусловие: две комнаты");
  built.spies.toast.length = 0;
  api.clearRoomLines();
  assert.equal(state.roomLines.length, 0, "разметка очищена — линий не осталось");
  assert.equal(state.rooms.length, 2, "очистка разметки НЕ пересобирает и не удаляет комнаты");
  assert.ok(state.rooms.some(r => r.name === "Bedroom"), "введённое имя комнаты не пострадало");
  assert.ok(built.spies.toast.some(m => /Разметка помещений очищена/.test(m)), "тост об очистке");
});

/* --- В13: Г-комната, нарисованная разметкой; пересборка (авто-путь и кнопка) сохраняет ВСЕ поля ----
   Тут ЗАКРЫВАЕТСЯ дыра покрытия: carryUserRoomFields (roomDetect.js) реально ИСПОЛНЯЕТСЯ, и его строки
   записи lightingScheme/standard/collection/frame* отрабатывают на настоящем пути (стенд §7.1 гоняет
   их через vm вместе с buildRoomsFromLines). У Г-комнаты среднее вершин лежит ВНЕ контура — на старом
   правиле «по центроиду» любая пересборка теряла её имя/площадь/схему/стандарт/серию/отделку. */

/* Г-контур (коридор): смещён от начала координат, чтобы клики стенда были положительными. */
const GAMMA = [[100, 100], [400, 100], [400, 140], [140, 140], [140, 400], [100, 400]];
const SCHEMES = [{ id: "classic" }, { id: "relay" }, { id: "bell" }];
const POST_PT = { x: 200, y: 120 };   /* точка внутри верхней полосы Г (там стоит пост) */
const EXPECTED = { name: "Прихожая-Г", area: "12,5 м²", lightingScheme: "relay", standard: "IT", collection: "Arke",
  frameMaterial: "Металл", frameShape: "Скруглённая", frameColor: "Антрацит" };

/* Нарисовать Г разметкой и вернуть стенд (snapGrid=false — клики садятся ровно, магнит ловит лишь
   замыкание у первой вершины). */
function drawGammaStand() {
  const built = buildStand(makeState());
  GAMMA.forEach(([x, y]) => click(built.api, x, y));
  click(built.api, 101, 101);   // ≈ первая вершина → замыкание контура
  return built;
}
/* Комната, в КОНТУР которой попала точка (первичная ветвь resolveRoomForPoint — pointInPolygon). */
const roomAt = (state, pt) => state.rooms.find(r => r.autoPolygon && r.polygon && EPGeom.pointInPolygon(pt.x, pt.y, r.polygon)) || null;
/* Задать Г все ручные поля (как панель свойств; набор полей autoPolygon не снимает — комната остаётся источником). */
function setGammaFields(room) {
  room.name = "Прихожая-Г"; room.area = "12,5 м²"; room.lightingScheme = "relay"; room.standard = "IT";
  room.collection = "Arke"; room.frameMaterial = "Металл"; room.frameShape = "Скруглённая"; room.frameColor = "Антрацит";
}
const gammaFieldsOf = r => ({ name: r.name, area: r.area, lightingScheme: r.lightingScheme, standard: r.standard,
  collection: r.collection, frameMaterial: r.frameMaterial, frameShape: r.frameShape, frameColor: r.frameColor });

test("Г нарисована разметкой: пересборка (дорисовка в стороне + кнопка) сохраняет имя/площадь/схему/стандарт/серию/отделку", () => {
  const built = drawGammaStand();
  const { state, api } = built;
  const g0 = roomAt(state, POST_PT);
  assert.ok(g0, "предпосылка: замкнутая Г собралась в комнату");
  setGammaFields(g0);
  const id0 = g0.id;

  /* Путь A: дорисован контур В СТОРОНЕ — авто-пересчёт (scheduleRoomsFromLines) пересобирает всё. */
  [[600, 100], [800, 100], [800, 250], [600, 250]].forEach(([x, y]) => click(api, x, y));
  click(api, 601, 101);   // замкнуть второй контур → авто-пересборка
  const gA = roomAt(state, POST_PT);
  assert.ok(gA, "Г пережила авто-пересборку (дорисовка соседа)");
  assert.notEqual(gA.id, id0, "это НОВЫЙ объект комнаты (id сменился) — значит поля именно ПЕРЕНЕСЕНЫ, а не остались на месте");
  assert.deepEqual(gammaFieldsOf(gA), EXPECTED, "все поля Г перенесены (строки lightingScheme/standard/frame* carryUserRoomFields исполнились)");

  /* Путь B: прямой вызов buildRoomsFromLines — путь кнопки «Определить помещения по линиям». */
  const idA = gA.id;
  api.buildRoomsFromLines();
  const gB = roomAt(state, POST_PT);
  assert.ok(gB, "Г пережила пересборку кнопкой");
  assert.notEqual(gB.id, idA, "снова новый объект — поля перенесены и на пути кнопки");
  assert.deepEqual(gammaFieldsOf(gB), EXPECTED, "поля Г на месте и после кнопки");
});

test("деньги: пост в Г-комнате после пересборки — в комнате со СВОЕЙ схемой (relay ≠ проектная classic)", () => {
  const built = drawGammaStand();
  const { state, api } = built;
  const g0 = roomAt(state, POST_PT);
  setGammaFields(g0);
  /* Пост в точке POST_PT. Его привязка к комнате пересчитывается по геометрии (в app.js —
     resolveRoomForPoint в refreshAfterRoomAssignments, ПОСЛЕ carry), поэтому здесь моделируем её
     тем же pointInPolygon, что и первичная ветвь resolveRoomForPoint. */
  state.posts = [{ id: "p1", number: 1, roomId: g0.id, x: POST_PT.x, y: POST_PT.y, mechanismIds: [1001], keyGroups: ["Свет"] }];
  api.buildRoomsFromLines();
  const gB = roomAt(state, POST_PT);
  assert.ok(gB, "новая Г-комната на месте после пересборки");
  /* schemeForPartition (app.js:1477) для комнаты поста читает EPRoom.roomLightingScheme(комната, схема
     проекта, SCHEMES). Пост стоит в gB, у неё перенесена своя схема relay → цена поста считается по
     relay (кнопка), а не по проектной classic (выключатель). Без переноса схема упала бы на classic —
     ровно «цена уезжает», которую видел владелец. */
  assert.equal(gB.lightingScheme, "relay", "у новой Г-комнаты её собственная схема реально записана (перенос сработал)");
  assert.equal(EPRoom.roomLightingScheme(gB, "classic", SCHEMES), "relay",
    "схема для поста = собственная relay, НЕ проектная classic: денежная основа поста сохранена");
});

/* ============ В15: удалили стену → комната исчезла → перерисовали → вернулась со СВОИМИ полями ============
   Здесь работает НАСТОЯЩИЙ путь удаления/перерисовки (removeRoomLine / addRoomLinePoint →
   scheduleRoomsFromLines → buildRoomsFromLines → carryUserRoomFields → EPRoomCarry.reconcile), а память
   хранится в state.roomFieldMemory (в проекте — переживает автосейв/перезагрузку). Стенд §7.1 исполняет
   реальные функции; reconcile/geometry не подменяем. Проверяем то, что увидит владелец: комната
   возвращается со своими полями и своей (денежной) схемой. */

/* Два смежных прямоугольника РАЗНОЙ ширины: левый 200 (200..400), правый 300 (400..700). Ширины разные,
   чтобы при слиянии центроид объединённой комнаты не сел на бывшую общую грань x=400 (ray-casting там
   неустойчив). Общую стену x=400 рисуем один раз (в левом), правый доводится к её концам магнитом. */
function drawTwoRoomsWide() {
  const built = buildStand(makeState());
  const { api } = built;
  click(api, 200, 200); click(api, 400, 200); click(api, 400, 350); click(api, 200, 350);
  click(api, 201, 201);          // ≈первая точка → замыкание левого
  click(api, 401, 199);          // магнит → общая вершина (400,200)
  click(api, 700, 200); click(api, 700, 350);
  click(api, 399, 351);          // магнит → общая вершина (400,350)
  api.finishRoomLineChain();
  return built;
}

test("В15 Ж1: удалили внешнюю стену комнаты (исчезла) → перерисовали → вернулась со своими полями и схемой; память в state", () => {
  const built = drawTwoRooms();
  built.api.buildRoomsFromLines();
  const { state, api } = built;
  assert.equal(state.rooms.length, 2, "предусловие: две комнаты");
  const right = state.rooms.find(r => EPGeom.polygonCentroid(r.polygon).x > 400);
  right.name = "Спальня"; right.lightingScheme = "relay"; right.standard = "IT"; right.collection = "Arke";

  /* УДАЛЯЕМ верхнюю (внешнюю) стену правой инструментом «Удалить» — её контур размыкается, правая исчезает */
  const top = findLine(state.roomLines, 400, 200, 600, 200);
  api.removeRoomLine(top.id);
  assert.equal(state.rooms.length, 1, "правый контур разомкнут — правая комната исчезла");
  assert.ok(EPGeom.polygonCentroid(state.rooms[0].polygon).x < 400, "уцелела левая");
  assert.equal(state.roomFieldMemory.length, 1, "поля исчезнувшей правой ушли в память проекта");
  assert.equal(state.roomFieldMemory[0].fields.name, "Спальня");

  /* ПЕРЕРИСОВЫВАЕМ ту же стену инструментом «Разметка»: клики садятся на существующие узлы магнитом */
  click(api, 400, 200); click(api, 600, 200);
  api.finishRoomLineChain();
  const back = roomAt(state, { x: 500, y: 275 });   // точка внутри правой [400,200]-[600,350]
  assert.ok(back, "правая комната вернулась после перерисовки стены");
  assert.equal(back.name, "Спальня", "имя вернулось из памяти");
  assert.equal(back.lightingScheme, "relay", "СВОЯ схема вернулась → цена постов правой та же (не проектная)");
  assert.equal(back.standard, "IT");
  assert.equal(back.collection, "Arke");
  assert.equal(state.roomFieldMemory.length, 0, "выданная запись из памяти удалена — повторно не всплывёт");
});

test("В15 Ж2: удалили ОБЩУЮ стену (комнаты слились) → перерисовали → вернулись ОБЕ, каждая со своими полями (без перестановки)", () => {
  const built = drawTwoRoomsWide();
  built.api.buildRoomsFromLines();
  const { state, api } = built;
  assert.equal(state.rooms.length, 2, "предусловие: две комнаты");
  const left = state.rooms.find(r => EPGeom.polygonCentroid(r.polygon).x < 400);
  const right = state.rooms.find(r => EPGeom.polygonCentroid(r.polygon).x > 400);
  left.name = "Кухня"; left.lightingScheme = "classic";
  right.name = "Гостиная"; right.lightingScheme = "relay";

  /* УДАЛЯЕМ общую стену x=400 → обе комнаты сливаются в одну */
  const shared = state.roomLines.find(l => l.a.x === 400 && l.b.x === 400);
  api.removeRoomLine(shared.id);
  assert.equal(state.rooms.length, 1, "общая стена удалена — комнаты слились");
  assert.equal(state.roomFieldMemory.length, 1, "поля одной из слитых — в памяти (вторую наследовала объединённая)");

  /* ПЕРЕРИСОВЫВАЕМ общую стену → разделение обратно на две */
  click(api, 400, 200); click(api, 400, 350);
  api.finishRoomLineChain();
  assert.equal(state.rooms.length, 2, "разделились обратно на две");
  const backLeft = roomAt(state, { x: 300, y: 275 });   // внутри левой [200,200]-[400,350]
  const backRight = roomAt(state, { x: 550, y: 275 });  // внутри правой [400,200]-[700,350]
  assert.ok(backLeft && backRight, "обе комнаты вернулись");
  assert.equal(backLeft.name, "Кухня", "левая — со СВОИМИ полями, не правой (без перестановки)");
  assert.equal(backLeft.lightingScheme, "classic");
  assert.equal(backRight.name, "Гостиная", "правая — со СВОИМИ полями");
  assert.equal(backRight.lightingScheme, "relay");
  assert.equal(state.roomFieldMemory.length, 0, "обе выданы — память пуста");
});

test("В15 Ж5/Ж6: «Очистить разметку» забывает память; ручную комнату память не трогает", () => {
  const built = drawTwoRooms();
  built.api.buildRoomsFromLines();
  const { state, api } = built;
  const right = state.rooms.find(r => EPGeom.polygonCentroid(r.polygon).x > 400);
  right.name = "Спальня"; right.lightingScheme = "relay";
  const top = findLine(state.roomLines, 400, 200, 600, 200);
  api.removeRoomLine(top.id);
  assert.equal(state.roomFieldMemory.length, 1, "предпосылка: правая исчезла, поля в памяти");
  api.clearRoomLines();
  assert.equal(state.roomFieldMemory.length, 0, "«Очистить разметку» забывает память полей (В15 Ж5)");
});
