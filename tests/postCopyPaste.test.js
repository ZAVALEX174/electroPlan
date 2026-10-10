/* Проводка копирования/вставки постов (Б9, часть 2а) — НАСТОЯЩИЕ copyPosts/pastePosts из js/app.js на
   общем стенде (tests/helpers/appStand.js). Чистый модуль EPPostCopy проверен в postCopy.test.js; здесь
   — связки, которые чистые тесты не ловят: вставка кладёт N новых постов одним шагом истории, выделяет
   их, зовёт frameForRoomPlacement для подмены накладки под комнату и пропускает заблокированные с
   сообщением, новые номера проходных доезжают через НАСТОЯЩУЮ проводку, повторная вставка в ту же точку
   не плодит дубль координат. Решение о перехвате клавиш (чистый copyHotkey) — в postCopy.test.js.
   Жёсткие ожидания (числа/строки): §7.1 — зелёный тест обязан что-то держать.
   Мутации — tools/qa/mutations/postcopy.json. Запуск: node --test tests/postCopyPaste.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

const EPPostCopy = require("../js/postCopy.js");
const EPPosts = require("../js/posts.js");
const EPLightingGroups = require("../js/lightingGroups.js");
const EPSelection = require("../js/selection.js");

/* Пост-образец: минимум полей, которых хватает проводке и расчёту номеров проходных. */
function mkPost(over) {
  return Object.assign({
    id: "src", number: 1, x: 0, y: 0, roomId: "R",
    name: "Пост", frameId: 10,
    mechanismIds: [100, 100, 100],
    keyGroups: ["", "", ""], keyCrossNumbers: ["", "", ""], keyMechanisms: ["", "", ""]
  }, over || {});
}

/* Стенд: вырезаем НАСТОЯЩИЕ copyPosts/pastePosts из app.js и исполняем в vm-контексте из провязанных
   зависимостей. frameForRoomPlacement/getRoomForPoint/renderAll/… — управляемые стабы: проверяем, что
   проводка их правильно зовёт и использует (сами эти функции покрыты своими тестами). Возвращает
   { ctx, copyPosts, pastePosts, counts, toasts }. */
function makeStand(over) {
  over = over || {};
  let n = 0;
  const counts = { renderAll: 0, renderSummary: 0, renderProperties: 0 };
  const toasts = [];
  const ctx = {
    _copyBuffer: over._copyBuffer !== undefined ? over._copyBuffer : null,
    state: over.state || { posts: [], selected: null, rooms: [], devices: [] },
    EPPostCopy, EPPosts, EPLightingGroups, EPSelection,
    uid: p => p + (++n),
    clientToWorld: over.clientToWorld || ((x, y) => ({ x, y })),
    canvasPointer: over.canvasPointer || (() => ({ overCanvas: false, clientX: 0, clientY: 0 })),
    frameForRoomPlacement: over.frameForRoomPlacement || (() => ({ frameId: null })),
    getRoomForPoint: over.getRoomForPoint || (() => ({ id: "R1", name: "Номер 101" })),
    renderAll: () => { counts.renderAll++; },
    renderSummary: () => { counts.renderSummary++; },
    renderProperties: () => { counts.renderProperties++; },
    toast: m => toasts.push(m)
  };
  const pastePosts = stand.run(["copyPosts", "pastePosts"], ctx);   /* обе в одной vm-программе */
  return { ctx, pastePosts, copyPosts: ctx.copyPosts, counts, toasts };
}

/* ───────────────────────── Ctrl+C ───────────────────────── */

test("copyPosts: кладёт выделенные посты в буфер (и один, и группу)", () => {
  const posts = [mkPost({ id: "a", number: 1 }), mkPost({ id: "b", number: 2 }), mkPost({ id: "c", number: 3 })];
  const grp = makeStand({ state: { posts, selected: { kind: "posts", ids: ["a", "c"] }, rooms: [], devices: [] } });
  grp.copyPosts();
  assert.equal(grp.ctx._copyBuffer.items.length, 2, "в буфере два выделенных поста");

  const one = makeStand({ state: { posts, selected: { kind: "post", id: "b" }, rooms: [], devices: [] } });
  one.copyPosts();
  assert.equal(one.ctx._copyBuffer.items.length, 1, "один выделенный пост тоже копируется");

  const none = makeStand({ state: { posts, selected: null, rooms: [], devices: [] } });
  none.copyPosts();
  assert.equal(none.ctx._copyBuffer, null, "нет выделения — буфер не трогаем");
});

/* ───────────────────────── Ctrl+V: базовая вставка ───────────────────────── */

test("★ вставка N постов → N новых, ОДИН renderAll (один шаг истории), выделены НОВЫЕ", () => {
  const src = [mkPost({ id: "a", number: 3, x: 0, y: 0 }), mkPost({ id: "b", number: 5, x: 100, y: 0 })];
  const buf = EPPostCopy.snapshot(src);
  const s = makeStand({
    _copyBuffer: buf,
    state: { posts: src.slice(), selected: null, rooms: [], devices: [] },
    canvasPointer: () => ({ overCanvas: true, clientX: 400, clientY: 400 })
  });
  s.pastePosts();
  assert.equal(s.ctx.state.posts.length, 4, "два исходных + две копии");
  assert.equal(s.counts.renderAll, 1, "ровно ОДИН renderAll — ровно один шаг истории (Ctrl+Z убирает всё)");
  assert.equal(s.counts.renderSummary, 1, "смета обновлена");
  assert.equal(s.counts.renderProperties, 1, "карточка обновлена");
  assert.equal(s.ctx.state.selected.kind, "posts", "после вставки выделена ГРУППА");
  assert.equal(s.ctx.state.selected.ids.length, 2, "выделены ровно две НОВЫЕ копии");
  const newIds = new Set(s.ctx.state.posts.slice(2).map(p => p.id));
  assert.ok(s.ctx.state.selected.ids.every(id => newIds.has(id)), "выделены именно новые посты, не исходные");
  assert.match(s.toasts.join(" "), /Вставлено постов: 2/, "человеку сказано, сколько вставлено");
});

test("★ точка «под мышью» vs без точки: курсор над планом → по точке; увели курсор → сдвиг от исходных", () => {
  const src = [mkPost({ id: "a", number: 1, x: 40, y: 60 })];
  const buf = EPPostCopy.snapshot(src);
  /* Курсор над планом в (200,150): центр значка одиночной копии ложится ровно в точку → x=188,y=138. */
  const over = makeStand({
    _copyBuffer: buf, state: { posts: src.slice(), selected: null, rooms: [], devices: [] },
    canvasPointer: () => ({ overCanvas: true, clientX: 200, clientY: 150 })
  });
  over.pastePosts();
  const c1 = over.ctx.state.posts[1];
  assert.deepEqual([c1.x + 12, c1.y + 12], [200, 150], "центр значка копии ровно в точке курсора");
  /* Курсор НЕ над планом → без точки: копия сдвигом на один шаг (24) от исходника. */
  const off = makeStand({
    _copyBuffer: buf, state: { posts: src.slice(), selected: null, rooms: [], devices: [] },
    canvasPointer: () => ({ overCanvas: false, clientX: 999, clientY: 999 })
  });
  off.pastePosts();
  const c2 = off.ctx.state.posts[1];
  assert.deepEqual([c2.x, c2.y], [64, 84], "курсор не над планом → копия сдвинута от исходника на шаг");
});

/* ───────────────────────── Ctrl+V: подмена накладки под комнату ───────────────────────── */

test("★ копия в комнате с другой отделкой получила накладку комнаты (вызван frameForRoomPlacement)", () => {
  const src = [mkPost({ id: "a", number: 1, frameId: 10 })];
  const buf = EPPostCopy.snapshot(src);
  const seen = [];
  const s = makeStand({
    _copyBuffer: buf, state: { posts: src.slice(), selected: null, rooms: [], devices: [] },
    canvasPointer: () => ({ overCanvas: true, clientX: 300, clientY: 300 }),
    frameForRoomPlacement: (copy, room) => { seen.push({ frameId: copy.frameId, room }); return { frameId: 777 }; }
  });
  s.pastePosts();
  assert.equal(seen.length, 1, "frameForRoomPlacement вызван для копии");
  assert.equal(s.ctx.state.posts[1].frameId, 777, "накладка копии подменена на накладку комнаты (не осталась 10)");
});

test("★ часть постов без накладки комнаты: ОСТАЛЬНЫЕ вставлены, про невставленный — номер ИСХОДНОГО и причина", () => {
  /* Копируем в порядке [№3, №5]; у поста №5 накладка 99 — её комната блокирует, №3 (накладка 10) проходит. */
  const src = [mkPost({ id: "a", number: 3, frameId: 10 }), mkPost({ id: "b", number: 5, frameId: 99 })];
  const buf = EPPostCopy.snapshot(src);
  const s = makeStand({
    _copyBuffer: buf, state: { posts: src.slice(), selected: null, rooms: [], devices: [] },
    canvasPointer: () => ({ overCanvas: true, clientX: 300, clientY: 300 }),
    frameForRoomPlacement: copy => copy.frameId === 99
      ? { blocked: true, message: "Для комнаты «Номер 101» нет подходящей накладки." }
      : { frameId: null }
  });
  s.pastePosts();
  assert.equal(s.ctx.state.posts.length, 3, "вставлен только незаблокированный (2 исходных + 1 копия)");
  assert.equal(s.ctx.state.selected.kind, "post", "одна копия → одиночное выделение");
  const msg = s.toasts.join(" ");
  assert.match(msg, /Вставлено постов: 1/, "сказано, сколько вставлено");
  assert.match(msg, /№ 5/, "назван номер ИСХОДНОГО невставленного поста (5), а не новый номер копии");
  assert.match(msg, /нет подходящей накладки/, "причина словами — текст из frameForRoomPlacement");
});

test("★ ВСЕ посты заблокированы → ничего не вставлено, шага истории НЕТ, сказано почему", () => {
  const src = [mkPost({ id: "a", number: 3, frameId: 99 }), mkPost({ id: "b", number: 7, frameId: 99 })];
  const buf = EPPostCopy.snapshot(src);
  const s = makeStand({
    _copyBuffer: buf, state: { posts: src.slice(), selected: null, rooms: [], devices: [] },
    canvasPointer: () => ({ overCanvas: true, clientX: 300, clientY: 300 }),
    frameForRoomPlacement: () => ({ blocked: true, message: "накладки нет" })
  });
  s.pastePosts();
  assert.equal(s.ctx.state.posts.length, 2, "проект не изменился — ни одной копии");
  assert.equal(s.counts.renderAll, 0, "renderAll НЕ звали — шага истории нет (нечего отменять)");
  assert.equal(s.ctx.state.selected, null, "выделение не трогали");
  const msg = s.toasts.join(" ");
  assert.match(msg, /Ничего не вставлено/, "человеку сказано, что ничего не вставлено");
  assert.match(msg, /№ 3[\s\S]*№ 7|№ 7[\s\S]*№ 3/, "названы оба невставленных поста");
});

/* ───────────────────────── Ctrl+V: номера проходных через НАСТОЯЩУЮ проводку ───────────────────────── */

test("★ номера проходных у копий НОВЫЕ (через настоящую проводку, не только модуль)", () => {
  /* Исходный пост в проекте с проходной «7»; его копия обязана получить ДРУГОЙ номер (своя пара, не
     оживление инвертора оригинала) — и это должно пройти ЧЕРЕЗ pastePosts с настоящим crossGroupKey. */
  const src = [mkPost({ id: "a", number: 1, keyCrossNumbers: ["7", "", ""] })];
  const buf = EPPostCopy.snapshot(src);
  const s = makeStand({
    _copyBuffer: buf, state: { posts: src.slice(), selected: null, rooms: [], devices: [] },
    canvasPointer: () => ({ overCanvas: true, clientX: 300, clientY: 300 })
  });
  s.pastePosts();
  const copy = s.ctx.state.posts[1];
  assert.notEqual(EPLightingGroups.crossGroupKey(copy.keyCrossNumbers[0]), EPLightingGroups.crossGroupKey("7"),
    "новый номер проходной отличается от исходного — своя пара, не инвертор оригинала");
  assert.equal(copy.keyCrossNumbers[0], "1", "первый свободный короткий номер (7 занят оригиналом)");
});

/* ───────────────────────── Ctrl+V: защита «точно поверх» в ветке с точкой ───────────────────────── */

test("★ два Ctrl+V в ту же точку НЕ дают постов с одинаковыми координатами (скрытый дубль/деньги)", () => {
  const src = [mkPost({ id: "a", number: 1, x: 0, y: 0 })];
  const buf = EPPostCopy.snapshot(src);
  const s = makeStand({
    _copyBuffer: buf, state: { posts: src.slice(), selected: null, rooms: [], devices: [] },
    canvasPointer: () => ({ overCanvas: true, clientX: 300, clientY: 300 })   /* мышь неподвижна */
  });
  s.pastePosts();
  s.pastePosts();   /* второй Ctrl+V при той же точке */
  assert.equal(s.ctx.state.posts.length, 3, "обе вставки дали по копии (1 исходный + 2 копии)");
  const keys = s.ctx.state.posts.map(p => p.x + "," + p.y);
  assert.equal(new Set(keys).size, keys.length, "НЕТ двух постов с одинаковыми координатами — вторая пачка сдвинута, не поверх первой");
});

/* Та же защита «значок поверх значка» обязана работать и БЕЗ точки (курсор не над планом, сдвиг от
   исходных). Защита — ОДНА на обе ветки (решение владельца 10.10); отдельный тест ветки без точки, чтобы
   у правила не было края: шаг сдвига 1 ставит копию ровно на уже стоящий пост — она обязана съехать. */
test("★ вставка БЕЗ точки не ложится поверх уже стоящего поста (защита работает и в ветке сдвига)", () => {
  const posts = [mkPost({ id: "a", number: 1, x: 0, y: 0 }), mkPost({ id: "b", number: 2, x: 24, y: 24 })];
  const s = makeStand({
    _copyBuffer: EPPostCopy.snapshot([posts[0]]),
    state: { posts: posts.slice(), selected: null, rooms: [], devices: [] },
    canvasPointer: () => ({ overCanvas: false, clientX: 0, clientY: 0 })   /* курсор не над планом → сдвиг */
  });
  s.pastePosts();
  const copy = s.ctx.state.posts[2];
  assert.ok(!(copy.x === 24 && copy.y === 24), "копия НЕ легла на стоящий пост b (24,24) — сдвинулась дальше");
  const keys = s.ctx.state.posts.map(p => p.x + "," + p.y);
  assert.equal(new Set(keys).size, keys.length, "нет двух постов с одинаковыми координатами");
});
