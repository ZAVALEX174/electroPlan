/* Поведенческий тест сборки spec блока «план с бирками» (app.js → planLabelsSpec).
   Функция-связка: читает state/DOM и решает, ЧТО отдать чистому EPPlanLabels. Структурные
   *Wiring-тесты ловят удаление строки, но не смену смысла, поэтому исполняем НАСТОЯЩИЙ текст
   planLabelsSpec из app.js в vm-стенде (helpers/appStand). Проверяем ровно новый контракт:
   подложка опциональна и не идёт в документ при «скрыта», помещения (контурные и без контура)
   передаются, пустой проект даёт null. */
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const { polygonCentroid } = require("../js/geometry.js");

/* Контекст vm: ровно те имена, что planLabelsSpec берёт из лексики app.js. planImageForDoc
   подменяем маркером «IMG» — саму перекодировку подложки проверяет не этот тест. */
function makeCtx(over) {
  over = over || {};
  const img = Object.assign({ src: "data:x", naturalWidth: 800, naturalHeight: 600 }, over.img || {});
  const state = Object.assign({ planLoaded: true, planVisibility: "show", posts: [], rooms: [] }, over.state || {});
  return {
    state,
    $: id => (id === "planImage" ? img : null),
    canvas: { clientWidth: 1000, clientHeight: 700 },
    POST_ICON_HALF: 15,
    polygonCentroid,
    planImageForDoc: () => "IMG"
  };
}
const spec = ctx => stand.run(["planLabelsSpec"], ctx)();

const SQUARE = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

test("скрытая подложка (planVisibility=hide) в документ не передаётся", () => {
  const s = spec(makeCtx({ state: { planVisibility: "hide", posts: [{ number: 1, x: 10, y: 20 }] } }));
  assert.notEqual(s, null, "блок остаётся: пост есть");
  assert.equal(s.imageUrl, undefined, "подложка скрыта — imageUrl не передан");
  assert.equal(s.natW, undefined, "размеры подложки тоже не передаются");
});

test("бледная подложка (dim) идёт как обычная", () => {
  const s = spec(makeCtx({ state: { planVisibility: "dim", posts: [{ number: 1, x: 10, y: 20 }] } }));
  assert.equal(s.imageUrl, "IMG", "dim — это рабочий вид, документ подложку получает");
  assert.equal(s.natW, 800);
});

test("блок строится без подложки: план не загружен, но есть помещение", () => {
  const s = spec(makeCtx({ state: { planLoaded: false, rooms: [{ name: "Кухня", polygon: SQUARE }] } }));
  assert.notEqual(s, null, "нет подложки — блок всё равно собран");
  assert.equal(s.imageUrl, undefined, "подложки нет — imageUrl не передан");
  assert.equal(s.rooms.length, 1, "помещение отдано");
});

test("контурное помещение отдаётся с полигоном и якорем-центроидом", () => {
  const s = spec(makeCtx({ state: { rooms: [{ name: "Кухня", polygon: SQUARE }] } }));
  const r = s.rooms[0];
  assert.deepEqual(r.polygon, SQUARE, "контур передан как есть");
  const c = polygonCentroid(SQUARE);
  assert.equal(r.x, c.x, "якорь подписи по X — центроид контура");
  assert.equal(r.y, c.y, "якорь подписи по Y — центроид контура");
});

test("комната без контура не теряется: подпись по seedX/seedY", () => {
  const s = spec(makeCtx({ state: { posts: [{ number: 1, x: 5, y: 5 }], rooms: [{ name: "Т", x: 100, y: 50, seedX: 120, seedY: 60 }] } }));
  const r = s.rooms[0];
  assert.equal(r.polygon, undefined, "контура у неё нет");
  assert.equal(r.x, 120, "якорь подписи по X из seedX");
  assert.equal(r.y, 60, "якорь подписи по Y из seedY");
});

test("комната без контура и без seed: фолбэк x+55 / y+18", () => {
  const s = spec(makeCtx({ state: { rooms: [{ name: "Т", x: 100, y: 50 }] } }));
  assert.equal(s.rooms[0].x, 155, "фолбэк якоря по X");
  assert.equal(s.rooms[0].y, 68, "фолбэк якоря по Y");
});

test("пустой проект (ни постов, ни помещений) — spec === null", () => {
  assert.equal(spec(makeCtx({ state: { posts: [], rooms: [] } })), null);
});
