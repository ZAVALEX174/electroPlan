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
const EPLightingGroups = require("../js/lightingGroups.js");
const EPLightingByRoom = require("../js/lightingByRoom.js");

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
    EPLightingGroups,
    EPLightingByRoom,
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

/* Группы света поста (часть 1b): planLabelsSpec обязан отдать по каждой клавише её группу — ключ
   и печатное имя, — а модуль по ним строит подпись у бирки и линию между постами группы. */

test("группы света поста уходят в spec ключом и печатным именем", () => {
  const s = spec(makeCtx({ state: { posts: [{ number: 1, x: 10, y: 20, keyGroups: ["Кухня", "", "Кухня-бра"] }] } }));
  const g = s.posts[0].groups;
  /* g создан внутри vm-реалма стенда — deepStrictEqual спотыкался бы о чужой Array.prototype;
     примитивы сравниваем поэлементно (они сравнимы между реалмами). */
  assert.equal(g.length, 2, "пустая клавиша группы не даёт, две назначенные — две группы");
  assert.equal(g[0].label, EPLightingGroups.normalizeGroup("Кухня"), "печатное имя первой группы");
  assert.equal(g[1].label, EPLightingGroups.normalizeGroup("Кухня-бра"), "печатное имя второй группы");
  assert.equal(g[0].key, EPLightingGroups.groupKeyOf("Кухня"), "ключ приведён тем же groupKeyOf, что и расчёт");
});

test("«Кухня» и «кухня » — ОДИН ключ: посты сольются в одну связь, а не разъедутся", () => {
  /* Мутационная опора: если ключ считать сырой строкой вместо groupKeyOf, ключи разойдутся и
     линия между постами исчезнет. Сравниваем ровно ключи, потому что по ним группирует модуль. */
  const s = spec(makeCtx({ state: { posts: [
    { number: 1, x: 0, y: 0, keyGroups: ["Кухня"] },
    { number: 2, x: 50, y: 50, keyGroups: ["кухня "] }
  ] } }));
  assert.equal(s.posts[0].groups[0].key, s.posts[1].groups[0].key, "разное написание — один ключ группы");
});

test("пост без назначенных групп не несёт поле groups", () => {
  const s = spec(makeCtx({ state: { posts: [
    { number: 1, x: 0, y: 0, keyGroups: ["", ""] },
    { number: 2, x: 5, y: 5 }
  ] } }));
  assert.equal(s.posts[0].groups, undefined, "все клавиши без группы — поля нет");
  assert.equal(s.posts[1].groups, undefined, "keyGroups вовсе нет — поля нет");
});

test("две клавиши одной группы в одном посте — одна связь, а не две", () => {
  const s = spec(makeCtx({ state: { posts: [{ number: 1, x: 0, y: 0, keyGroups: ["Зал", "зал"] }] } }));
  assert.equal(s.posts[0].groups.length, 1, "дубль ключа в посте схлопнут: пост в группе один");
});

/* Покомнатность связей (часть 1d): planLabelsSpec обязан положить в каждый пост КЛЮЧ КОМНАТЫ,
   посчитанный ТЕМ ЖЕ EPLightingByRoom.partitionNorm от post.roomId, что и расчёт денег. Модуль
   раскладки по этому ключу разводит одноимённые группы разных комнат. */

test("ключ комнаты кладётся в пост из post.roomId через partitionNorm", () => {
  const s = spec(makeCtx({ state: { posts: [{ number: 1, x: 10, y: 20, roomId: 5 }] } }));
  assert.equal(s.posts[0].room, EPLightingByRoom.partitionNorm(5), "ключ комнаты — partitionNorm(roomId)");
});

test("пост без комнаты (roomId===null) → корзина «без помещения»", () => {
  const s = spec(makeCtx({ state: { posts: [{ number: 1, x: 10, y: 20, roomId: null }] } }));
  assert.equal(s.posts[0].room, EPLightingByRoom.partitionNorm(null), "roomId=null → ключ «без помещения»");
});

test("число 1 и строка \"1\" как id комнаты — ОДНА комната", () => {
  /* Мутационная опора: если бы ключ считался сырым roomId, число и строка разошлись бы. */
  const s = spec(makeCtx({ state: { posts: [
    { number: 1, x: 0, y: 0, roomId: 1 },
    { number: 2, x: 5, y: 5, roomId: "1" }
  ] } }));
  assert.equal(s.posts[0].room, s.posts[1].room, "id 1 и \"1\" дают один ключ комнаты");
});

test("одноимённые группы в РАЗНЫХ комнатах получают разные ключи комнаты в spec", () => {
  /* Отдельный тест с реальными комнатами (старый «Кухня»/«кухня » — на постах без комнат). */
  const s = spec(makeCtx({ state: { posts: [
    { number: 1, x: 0, y: 0, roomId: 1, keyGroups: ["Кухня"] },
    { number: 2, x: 5, y: 5, roomId: 2, keyGroups: ["Кухня"] }
  ] } }));
  assert.equal(s.posts[0].groups[0].key, s.posts[1].groups[0].key, "имя группы одно — ключ группы совпал");
  assert.notEqual(s.posts[0].room, s.posts[1].room, "но комнаты разные — ключи комнат различаются");
});
