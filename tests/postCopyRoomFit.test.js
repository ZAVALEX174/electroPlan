/* Копирование постов (В22, решение владельца 07.11) — пачка держится в КОМНАТЕ, куда её вставили, и
   не выталкивается за стену в «Без помещения». Чистое правило размещения — в js/postCopy.js.buildCopies
   через НЕОБЯЗАТЕЛЬНУЮ зависимость roomOf(центр значка)→id комнаты|null; проводка «нет места → ничего не
   вставлено, сказать человеку» — в js/postCopyUi.js.pastePosts.

   Сценарий дефекта 11.10: пара проходных в маленькой комнате, Ctrl+V над занятым местом — прежний
   диагональный сдвиг (+x+y на m шагов) выводил копию за стену. Здесь воспроизводим его в чистой функции:
   база перекрыта значком, диагональ уходит из комнаты, а свободное место есть СБОКУ — поиск кольцами
   обязан его найти, не покинув комнату.
   Жёсткие ожидания (координаты/комната), а не «вернула, что подложили» (§7.1). Запуск:
   node --test tests/postCopyRoomFit.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

const EPPostCopy = require("../js/postCopy.js");
const EPPosts = require("../js/posts.js");
const EPLightingGroups = require("../js/lightingGroups.js");
const EPSelection = require("../js/selection.js");
const EPNotices = require("../js/notices.js");
const crossKey = EPLightingGroups.crossGroupKey;

function makeGenId(start) { let n = start || 0; return () => "copy-" + (++n); }
/* Один механизм — достаточно для правила размещения (состав/проходные здесь не предмет). */
function samplePost(over) {
  return Object.assign({
    id: "src", number: 1, x: 0, y: 0, roomId: "A", name: "Пост", frameId: 10,
    mechanismIds: [101], keyGroups: [""], keyCrossNumbers: [""], keyMechanisms: [""]
  }, over || {});
}
function opts(over) {
  return Object.assign({ existingPosts: [], genId: makeGenId(0), nextPostNumber: EPPosts.nextPostNumber, crossKey }, over || {});
}
/* roomOf по прямоугольнику комнаты: центр значка внутри [x0,x1)×[y0,y1) → id, иначе null. */
function rectRoom(id, x0, y0, x1, y1) {
  return c => (c.x >= x0 && c.x < x1 && c.y >= y0 && c.y < y1) ? id : null;
}
const HALF = EPPostCopy.POST_ICON_HALF;   /* центр значка = (x+HALF, y+HALF) */
const centerOf = p => ({ x: p.x + HALF, y: p.y + HALF });

/* ─────────── СЦЕНАРИЙ 11.10: диагональ уводит за стену — кольца держат в комнате ─────────── */

test("★ база перекрыта, диагональ — за стеной: копия встаёт СБОКУ, в своей комнате, без перекрытия", () => {
  /* Комната A [0,120)×[0,120) (мелкая, 5×5 шагов). Точка вставки (96,96) → центр базы (96,96) в A, но
     ровно на уже стоящем посту (угол 84,84). Диагональ (+24,+24) → центр (120,120) — ВНЕ комнаты (120
     не <120): прежний код оставил бы «Без помещения». Свободное место есть по (−24,−24): центр (72,72). */
  const buf = EPPostCopy.snapshot([samplePost({ x: 0, y: 0 })]);
  const roomOf = rectRoom("A", 0, 0, 120, 120);
  const existing = [{ x: 84, y: 84 }];           /* стоящий значок ровно под центром базы */
  const copies = EPPostCopy.buildCopies(buf, opts({ existingPosts: existing, point: { x: 96, y: 96 }, roomOf }));
  assert.equal(copies.length, 1, "копия вставлена (место в комнате нашлось)");
  const c = copies[0];
  assert.equal(roomOf(centerOf(c)), "A", "центр значка копии — ВНУТРИ своей комнаты A, не за стеной");
  assert.ok(Math.abs(c.x - 84) >= 24 || Math.abs(c.y - 84) >= 24, "значок копии не перекрывает стоящий пост");
  assert.deepEqual([c.x, c.y], [60, 60],
    "кольцо (−1,−1): угол (60,60), центр (72,72); диагональ (1,1) дала бы (108,108)/центр (120,120) — за стеной");
});

/* ─────────── МЕСТА НЕТ СОВСЕМ → сигнал noFit, пачка не вставляется ─────────── */

test("★ в комнате нет свободного места ни при каком смещении → пустой массив + noFit с id комнаты", () => {
  /* Комната A ровно в один значок [0,24)×[0,24): центр внутри только около (12,12). Стоящий пост занял
     её целиком. Любой сдвиг на шаг выводит центр за стену → разместить пачку целиком негде. */
  const buf = EPPostCopy.snapshot([samplePost({ x: 0, y: 0 })]);
  const roomOf = rectRoom("A", 0, 0, 24, 24);
  const existing = [{ x: 0, y: 0 }];
  const res = EPPostCopy.buildCopies(buf, opts({ existingPosts: existing, point: { x: 12, y: 12 }, roomOf }));
  assert.equal(res.length, 0, "ничего не собрано — места нет");
  assert.ok(res.noFit, "сигнал «места нет» — свойством результата, не исключением");
  assert.equal(res.noFit.roomId, "A", "назван id комнаты базы (для сообщения человеку)");
});

/* ─────────── ОБРАТНАЯ СОВМЕСТИМОСТЬ: без roomOf — поведение байт-в-байт прежнее ─────────── */

test("★ roomOf не передан → координаты РОВНО как раньше (прежний диагональный сдвиг)", () => {
  /* Тот же вход, что buildCopies-тест «перекрытие»: существующий (100,100), точка (115,108). Без roomOf
     код обязан дать прежний результат (127,120) — старые проекты/вызовы/тесты не меняются. */
  const buf = EPPostCopy.snapshot([samplePost({ x: 0, y: 0 })]);
  const [c] = EPPostCopy.buildCopies(buf, opts({ existingPosts: [{ x: 100, y: 100 }], point: { x: 115, y: 108 } }));
  assert.deepEqual([c.x, c.y], [127, 120], "без roomOf — прежний диагональный сдвиг (127,120)");
});

test("★ roomOf передан, база свободна → координаты как раньше (первая вставка не меняется)", () => {
  /* Комната накрывает всё, стоящих постов нет: смещение (0,0) годно сразу → центр одиночной копии ровно
     в точке (200,200), угол (188,188) — ровно как без правила (решение владельца: база не меняется). */
  const buf = EPPostCopy.snapshot([samplePost({ x: 0, y: 0 })]);
  const roomOf = rectRoom("A", -1000, -1000, 5000, 5000);
  const [c] = EPPostCopy.buildCopies(buf, opts({ existingPosts: [], point: { x: 200, y: 200 }, roomOf }));
  assert.deepEqual([c.x, c.y], [188, 188], "база свободна → центр ровно в точке, как и без roomOf");
  assert.equal(c.noFit, undefined, "массив копий без noFit — всё разместилось");
});

/* ─────────── КРАЙ 1: без точки, оригинал у стены — комната базы по ОРИГИНАЛУ, не по base0 ───────────
   Ctrl+V без мыши над холстом (point=null, mStart=1): стартовое размещение base0=shifted(1) сдвинуто на
   шаг по диагонали. Если оригинал у правой/нижней стены, центр base0 попадает в СОСЕДНЮЮ комнату (или за
   стену) — раньше «комнату базы» брали по base0 и копию держали не там / выбрасывали в «Без помещения».
   Комната базы обязана считаться по ОРИГИНАЛУ (base, m=0). */

test("★ КРАЙ1: без точки, оригинал у стены — копия в комнате ОРИГИНАЛА (с соседней B и без неё)", () => {
  /* A=[0,120)×[0,120), B=[120,240)×[0,120). Оригинал (90,40), центр (102,52) в A, у правой стены.
     base0=shifted(1)=(114,64), центр (126,76) — в B (или вне комнат, если B нет). Комнату базы берём по
     оригиналу (A) → копию держим в A; поиск кольцами находит боковое место (90,64), центр (102,76) в A. */
  const buf = EPPostCopy.snapshot([samplePost({ x: 90, y: 40 })]);
  const existing = [{ x: 90, y: 40 }];
  const roomAB = c => (c.y < 0 || c.y >= 120) ? null : (c.x >= 0 && c.x < 120 ? "A" : (c.x < 240 ? "B" : null));
  const [cAB] = EPPostCopy.buildCopies(buf, opts({ existingPosts: existing, roomOf: roomAB }));   /* без точки */
  assert.equal(roomAB(centerOf(cAB)), "A", "с соседней комнатой B копия всё равно в комнате оригинала A");
  assert.ok(Math.abs(cAB.x - 90) >= 24 || Math.abs(cAB.y - 40) >= 24, "копия не перекрывает оригинал");
  assert.deepEqual([cAB.x, cAB.y], [90, 64], "боковое кольцо (−1,0): угол (90,64), центр (102,76) в A; по base0 было бы (114,64) в B");
  /* Без B: справа — вне комнат. По base0 комната базы = null → все null → диагональ → «Без помещения».
     По оригиналу — A → копия удержана в A. */
  const roomAonly = c => (c.x >= 0 && c.x < 120 && c.y >= 0 && c.y < 120) ? "A" : null;
  const [cA] = EPPostCopy.buildCopies(buf, opts({ existingPosts: existing, roomOf: roomAonly }));
  assert.equal(roomAonly(centerOf(cA)), "A", "без B копия удержана в комнате оригинала A, не «Без помещения»");
  assert.deepEqual([cA.x, cA.y], [90, 64]);
});

/* ─────────── ВНЕ КОМНАТ: раскладка БАЙТ-В-БАЙТ прежняя (решение основного агента, утв. владельцем) ───────────
   Когда ВСЕ копии пачки имеют базу вне комнат (проект без комнат / вставка вне комнат), roomOf возвращает
   null для всех — и видимую раскладку менять нельзя: должен работать прежний диагональный цикл, тот же, что
   в ветке без roomOf (одно место, не копия). Отличить от кольцевого поиска: диагональная клетка занята, а
   боковая в том же кольце свободна — кольца ушли бы вбок, диагональ обязана уйти на следующий шаг. */

test("★ все базы вне комнат (roomOf→null) → прежний ДИАГОНАЛЬНЫЙ сдвиг, не вбок (как без roomOf)", () => {
  /* Точка (100,100): база — угол (88,88), центр (100,100). Заняты значки (88,88) [база] и (112,112)
     [диагональ m=1]. Диагональ: m=0 занято → m=1 занято → m=2 свободно → угол (136,136). Кольца же на
     кольце 1 после (1,1)[занято] взяли бы боковую (−1,−1)=(64,64). Вне комнат берём ДИАГОНАЛЬ. */
  const buf = EPPostCopy.snapshot([samplePost({ x: 0, y: 0 })]);
  const existing = [{ x: 88, y: 88 }, { x: 112, y: 112 }];
  const roomOfNull = () => null;   /* комнат нет: база каждой копии вне комнат */
  const [withRoomOf] = EPPostCopy.buildCopies(buf, opts({ existingPosts: existing, point: { x: 100, y: 100 }, roomOf: roomOfNull }));
  const [withoutRoomOf] = EPPostCopy.buildCopies(buf, opts({ existingPosts: existing, point: { x: 100, y: 100 } }));
  assert.deepEqual([withRoomOf.x, withRoomOf.y], [136, 136], "вне комнат — прежний диагональный сдвиг (m=2), а не боковое кольцо (64,64)");
  assert.deepEqual([withRoomOf.x, withRoomOf.y], [withoutRoomOf.x, withoutRoomOf.y], "с roomOf-все-null и без roomOf координаты СОВПАДАЮТ (одна ветка)");
});

/* ─────────── ПРОВОДКА pastePosts: сигнал «места нет» → ничего не вставлено, показано "unplaced" ─────────── */

/* Стенд как в postCopyPaste.test.js: вырезаем НАСТОЯЩИЕ copyPosts/pastePosts (js/postCopyUi.js) в vm. */
function mkPost(over) {
  return Object.assign({
    id: "src", number: 1, x: 0, y: 0, roomId: "R", name: "Пост", frameId: 10,
    mechanismIds: [101], keyGroups: [""], keyCrossNumbers: [""], keyMechanisms: [""]
  }, over || {});
}

test("★ pastePosts: места в комнате нет → state.posts не меняется, renderAll не звали, показано «Ничего не вставлено… в помещении «Кухня»»", () => {
  const src = mkPost({ x: 0, y: 0 });
  const counts = { renderAll: 0, renderSummary: 0, renderProperties: 0 };
  const toasts = [];
  const notices = { calls: [], show(kind, text, pruneWhen) { this.calls.push({ kind, text, pruneWhen }); }, dismiss() {}, prune() {} };
  /* Комната R ровно в один значок [0,24)×[0,24), «Кухня»; стоящий пост занял её целиком — копии места нет. */
  const getRoomForPoint = (x, y) => (x >= 0 && x < 24 && y >= 0 && y < 24) ? { id: "R", name: "Кухня" } : null;
  const ctx = {
    _copyBuffer: EPPostCopy.snapshot([src]),
    state: { posts: [src], selected: null, rooms: [{ id: "R", name: "Кухня" }], devices: [] },
    EPPostCopy, EPPosts, EPLightingGroups, EPSelection, EPNotices, notices,
    uid: p => p + "1",
    clientToWorld: (x, y) => ({ x, y }),
    canvasPointer: () => ({ overCanvas: true, clientX: 12, clientY: 12 }),   /* центр базы ровно в (12,12) → комната R */
    frameForRoomPlacement: () => ({ frameId: null }),
    getRoomForPoint,
    renderAll: () => { counts.renderAll++; },
    renderSummary: () => { counts.renderSummary++; },
    renderProperties: () => { counts.renderProperties++; },
    toast: m => toasts.push(m)
  };
  const pastePosts = stand.run(["copyPosts", "pastePosts"], ctx);
  pastePosts();
  assert.equal(ctx.state.posts.length, 1, "проект не изменился — ни одной копии не вставлено");
  assert.equal(counts.renderAll, 0, "renderAll НЕ звали — шага истории нет (нечего отменять)");
  assert.equal(ctx.state.selected, null, "выделение не трогали");
  const msg = notices.calls.filter(c => c.kind === "unplaced").map(c => c.text).join(" | ");
  assert.match(msg, /Ничего не вставлено/, "человеку сказано, что ничего не вставлено (вид «unplaced»)");
  assert.match(msg, /в помещении «Кухня»/, "названо помещение, где нет места");
  assert.match(msg, /нет свободного места/, "сказано, что места нет");
  assert.equal(toasts.length, 0, "гаснущего toast нет");
});

/* ─────────── КРАЙ 2: карта пространства строится ОДИН раз на вставку (grid-комната, нет 28-с зависания) ───────────
   getRoomForPoint без готовой карты строит buildSpaceComponents на КАЖДЫЙ вызов; поиск размещения зовёт
   roomOf до ~тысяч раз → на проекте с «T»-комнатой вставка зависала на ~28 с. pastePosts обязан строить
   карту один раз и передавать её в getRoomForPoint(x,y,map). Меряем СЧЁТЧИКОМ, не временем. */

test("★ КРАЙ2: при grid-комнате buildSpaceComponents вызван ≤1 раза на вставку (карта переиспользуется)", () => {
  const src = mkPost({ x: 0, y: 0 });
  let bsc = 0;
  const buildSpaceComponents = () => { bsc++; return { grid: true }; };
  /* Мимикрия настоящего getRoomForPoint (app.js:1028): без готовой карты он строит её КАЖДЫЙ раз. */
  const getRoomForPoint = (x, y, map) => { if (!map) buildSpaceComponents();
    return (x >= 0 && x < 24 && y >= 0 && y < 24) ? { id: "G", name: "Зал" } : null; };
  const notices = { calls: [], show(k, t) { this.calls.push({ kind: k, text: t }); }, dismiss() {}, prune() {} };
  const counts = { renderAll: 0 };
  const ctx = {
    _copyBuffer: EPPostCopy.snapshot([src]),
    /* grid-комната G ровно в один значок [0,24): без polygon → карта нужна; стоящий пост занял её → места нет. */
    state: { posts: [src], selected: null, rooms: [{ id: "G", name: "Зал" }], devices: [] },
    EPPostCopy, EPPosts, EPLightingGroups, EPSelection, EPNotices, notices,
    uid: p => p + "1",
    buildSpaceComponents,
    clientToWorld: (x, y) => ({ x, y }),
    canvasPointer: () => ({ overCanvas: true, clientX: 12, clientY: 12 }),
    frameForRoomPlacement: () => ({ frameId: null }),
    getRoomForPoint,
    renderAll: () => { counts.renderAll++; }, renderSummary: () => {}, renderProperties: () => {},
    toast: () => {}
  };
  const pastePosts = stand.run(["copyPosts", "pastePosts"], ctx);
  pastePosts();
  assert.ok(bsc <= 1, `buildSpaceComponents вызван ${bsc} раз — карта строится один раз, а не на каждый из ~тысяч roomOf`);
  assert.equal(ctx.state.posts.length, 1, "места нет (grid-комната занята) → ничего не вставлено");
});
