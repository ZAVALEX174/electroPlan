/* К4в — ПОВЕДЕНЧЕСКИ: оркестратор EPRoomWalls.attach(ctx).warnWallMismatch (предупреждение о несовпадении
   стены поста и отметок комнаты, кнопка-перевод с ПОВТОРНОЙ проверкой в момент клика) и ВИЗИРОВКА трёх
   жестов + поведенческое покрытие условия «перетаскивание предупреждает только при смене комнаты».
   Запуск: node --test tests/roomWallsGesture.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");
const EPRoomWalls = require("../js/roomWalls.js");
const EPNotices = require("../js/notices.js");
const EPPosts = require("../js/posts.js");
const EPDrag = require("../js/drag.js");
const EPConfig = require("../js/config.js");

/* Поднять оркестратор с фейковым EPNotices (копит show) и счётчиками перерисовки/сохранения. */
function makeWarn(posts, rooms) {
  const shows = [];
  const counts = { renderAll: 0, renderSummary: 0, renderProperties: 0, persist: 0 };
  const notices = { show: (kind, text, pruneWhen, action) => shows.push({ kind, text, pruneWhen, action }) };
  const state = { posts: posts.slice(), rooms };
  const { warnWallMismatch } = EPRoomWalls.attach({
    state, notices, EPPosts,
    renderAll: () => counts.renderAll++, renderSummary: () => counts.renderSummary++,
    renderProperties: () => counts.renderProperties++, persistProject: () => counts.persist++
  });
  return { warnWallMismatch, shows, counts, state };
}

test("warnWallMismatch: ГКЛ-пост в бетон-комнату → сообщение; кнопка переводит пост, зовёт renderProperties", () => {
  const post = { id: "p3", number: 3, roomId: "r1", wallType: "hollow" };
  const w = makeWarn([post], [{ id: "r1", name: "Кухня", wallKinds: ["solid"] }]);
  w.warnWallMismatch([post]);
  assert.equal(w.shows.length, 1);
  assert.equal(w.shows[0].kind, "wallMismatch:p3");
  assert.equal(w.shows[0].text, "Стены не совпадают: пост № 3 — ГКЛ, в комнате «Кухня» только бетон");
  assert.equal(w.shows[0].action.label, "Перевести пост на бетон");
  w.shows[0].action.onClick();
  assert.equal(post.wallType, "solid", "кнопка перевела пост на стену комнаты (коробка/суппорт — по К4а)");
  assert.ok(w.counts.renderAll >= 1 && w.counts.renderSummary >= 1 && w.counts.persist >= 1, "экран и сохранение обновлены");
  assert.ok(w.counts.renderProperties >= 1, "renderProperties обязателен — иначе карточка поста покажет старую стену/цену (K4V-17)");
});

test("warnWallMismatch: комната без отметок → сообщения НЕТ (решение владельца 2)", () => {
  const post = { id: "p1", number: 1, roomId: "r1", wallType: "hollow" };
  const w = makeWarn([post], [{ id: "r1", name: "Склад" }]);
  w.warnWallMismatch([post]);
  assert.equal(w.shows.length, 0);
});

test("warnWallMismatch: стена поста совпала с отметкой комнаты → сообщения НЕТ", () => {
  const post = { id: "p1", number: 1, roomId: "r1", wallType: "solid" };
  const w = makeWarn([post], [{ id: "r1", name: "Кухня", wallKinds: ["solid"] }]);
  w.warnWallMismatch([post]);
  assert.equal(w.shows.length, 0);
});

test("warnWallMismatch: несколько постов одной комнаты → ОДНО сообщение, кнопка переводит все эти посты", () => {
  const p3 = { id: "p3", number: 3, roomId: "r1", wallType: "hollow" };
  const p5 = { id: "p5", number: 5, roomId: "r1", wallType: "hollow" };
  const w = makeWarn([p3, p5], [{ id: "r1", name: "Кухня", wallKinds: ["solid"] }]);
  w.warnWallMismatch([p3, p5]);
  assert.equal(w.shows.length, 1);
  assert.equal(w.shows[0].action.label, "Перевести посты на бетон");
  w.shows[0].action.onClick();
  assert.equal(p3.wallType, "solid");
  assert.equal(p5.wallType, "solid");
});

test("warnWallMismatch: кнопка переводит ТОЛЬКО посты жеста, чужие посты проекта не трогает (решение 5)", () => {
  const p3 = { id: "p3", number: 3, roomId: "r1", wallType: "hollow" };
  // other ТОЖЕ не совпадает стеной (ГКЛ в бетон-комнате), но он НЕ в жесте — кнопка его трогать не должна
  const other = { id: "pX", number: 9, roomId: "r2", wallType: "hollow" };
  const rooms = [{ id: "r1", name: "Кухня", wallKinds: ["solid"] }, { id: "r2", name: "Прихожая", wallKinds: ["solid"] }];
  const w = makeWarn([p3, other], rooms);
  w.warnWallMismatch([p3]);
  w.shows[0].action.onClick();
  assert.equal(p3.wallType, "solid", "пост жеста переведён");
  assert.equal(other.wallType, "hollow", "чужой несовпадающий пост НЕ тронут — кнопка берёт только posts жеста (мутация liveMismatched(state.posts) краснит здесь)");
});

/* ───── ПОВТОРНАЯ ПРОВЕРКА В МОМЕНТ КЛИКА (устаревшая кнопка не ставит чужую стену) ───── */

test("устаревшая кнопка: пост УЖЕ переехал в подходящую комнату → клик НЕ трогает стену (повторная проверка)", () => {
  const post = { id: "p3", number: 3, roomId: "r1", wallType: "hollow" };
  const rooms = [{ id: "r1", name: "Кухня", wallKinds: ["solid"] }, { id: "r2", name: "Ванная", wallKinds: ["hollow"] }];
  const w = makeWarn([post], rooms);
  w.warnWallMismatch([post]);                 // предупреждение: ГКЛ-пост в бетон-Кухне
  post.roomId = "r2";                         // пост перетащили в ГКЛ-Ванную — теперь совпадает
  w.shows[0].action.onClick();                // жмём устаревшую кнопку «Перевести на бетон»
  assert.equal(post.wallType, "hollow", "клик пересчитал по ТЕКУЩЕЙ комнате: совпадает → стену НЕ меняем (мутация «кнопка без повторной проверки» краснит здесь)");
  assert.equal(w.counts.renderAll, 0, "нечего менять — лишней перерисовки/шага истории нет");
});

test("устаревшая кнопка: пост переехал в ДРУГУЮ бетон-комнату → клик переводит на стену ЕГО текущей комнаты", () => {
  const post = { id: "p3", number: 3, roomId: "r1", wallType: "hollow" };
  const rooms = [{ id: "r1", name: "Кухня", wallKinds: ["solid"] }, { id: "r3", name: "Прихожая", wallKinds: ["solid"] }];
  const w = makeWarn([post], rooms);
  w.warnWallMismatch([post]);
  post.roomId = "r3";                         // другая бетон-комната — всё ещё несоответствие
  w.shows[0].action.onClick();
  assert.equal(post.wallType, "solid", "переведён на бетон (цель текущей комнаты)");
});

test("pruneWhen сверяет пост ПО id в текущем state.posts (Ctrl+Z кладёт JSON-клоны) — не снимает живое сообщение", () => {
  const post = { id: "p3", number: 3, roomId: "r1", wallType: "hollow" };
  const w = makeWarn([post], [{ id: "r1", name: "Кухня", wallKinds: ["solid"] }]);
  w.warnWallMismatch([post]);
  const prune = w.shows[0].pruneWhen;
  assert.equal(prune(), false, "пост на месте и не совпадает — сообщение живёт");
  // имитируем applyPlanSnapshot: тот же проект, но ОБЪЕКТЫ — свежие клоны (другие ссылки, те же id/данные)
  w.state.posts = JSON.parse(JSON.stringify(w.state.posts));
  assert.equal(prune(), false, "после клона (Ctrl+Z) сообщение по-прежнему живёт — сверка по id, а не по ссылке (мутация «по ссылке» краснит здесь)");
  // а если пост реально ушёл с плана — снимается
  w.state.posts = [];
  assert.equal(prune(), true, "поста на плане нет → сообщение пора снять");
});

test("kind уникален по жесту: два «Разместить» подряд → ДВА живых сообщения (не затирают друг друга)", () => {
  // настоящий EPNotices на маленьком DOM-шиме
  const makeNode = () => { const n = { className: "", children: [], parentNode: null, attrs: {}, onclick: null, _t: "",
    setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) { this.children.splice(i, 1); c.parentNode = null; } return c; },
    get textContent() { return this._t; }, set textContent(v) { this._t = String(v); } }; return n; };
  const host = makeNode();
  const notices = EPNotices.attach({ host, doc: { createElement: makeNode } });
  const p1 = { id: "p1", number: 1, roomId: "r1", wallType: "hollow" };
  const p2 = { id: "p2", number: 2, roomId: "r1", wallType: "hollow" };
  const state = { posts: [p1, p2], rooms: [{ id: "r1", name: "Кухня", wallKinds: ["solid"] }] };
  const { warnWallMismatch } = EPRoomWalls.attach({ state, notices, EPPosts,
    renderAll() {}, renderSummary() {}, renderProperties() {}, persistProject() {} });
  warnWallMismatch([p1]);        // первый «Разместить»
  warnWallMismatch([p2]);        // второй «Разместить» — другой пост
  assert.equal(host.children.length, 2, "два жеста о РАЗНЫХ постах → два сообщения (мутация «kind общий» затёрла бы первое → 1)");
});

/* ───── ВИЗИРОВКА: три жеста зовут warnWallMismatch, стрелки и Undo — нет (решение владельца 3) ───── */

test("три жеста (Разместить/перетаскивание/Ctrl+V) зовут warnWallMismatch, стрелки и Undo — нет", () => {
  assert.match(stand.functionSource("addPending"), /warnWallMismatch\(/, "«Разместить» (addPending)");
  assert.match(stand.functionSource("pastePosts"), /warnWallMismatch\(/, "Ctrl+V (pastePosts)");
  const finishDrag = stand.functionSource("finishDrag");
  assert.match(finishDrag, /warnWallMismatch\(/, "перетаскивание (finishDrag)");
  assert.ok((finishDrag.match(/warnWallMismatch\(/g) || []).length >= 2, "и одиночный перенос, и группа");
  assert.doesNotMatch(stand.functionSource("moveSelectedBy"), /warnWallMismatch/, "стрелки (moveSelectedBy) — нет");
  assert.doesNotMatch(stand.functionSource("applyPlanSnapshot"), /warnWallMismatch/, "Undo/Redo (applyPlanSnapshot) — нет");
});

/* ───── ПОВЕДЕНЧЕСКИ: перетаскивание предупреждает ТОЛЬКО при смене комнаты (canvasInput.finishDrag) ─────
   Стенд как в canvasDragBehavior.test.js: исполняем настоящие trackDrag+makeDraggable, доставляем pointer-
   события через шим-узел. updateObjectRoom/refreshAfterRoomAssignments проставляют roomId по плану roomPlan
   (имитируют реальный пересчёт привязки). warnWallMismatch — шпион: копит, кого предупредили. */
function pointer(over) { return Object.assign({ isPrimary: true, button: 0, clientX: 0, clientY: 0, pointerId: 1, preventDefault() {}, stopPropagation() {} }, over); }
function makeNode() {
  const listeners = {};
  return { dataset: {}, style: {}, classList: stand.makeClassList(),
    addEventListener(t, fn) { (listeners[t] || (listeners[t] = [])).push(fn); },
    removeEventListener(t, fn) { if (listeners[t]) listeners[t] = listeners[t].filter(f => f !== fn); },
    setPointerCapture() {}, releasePointerCapture() {},
    fire(t, ev) { (listeners[t] || []).slice().forEach(fn => fn(ev)); } };
}
function buildDrag(state, roomPlan) {
  const warned = [];
  const node2 = makeNode();   // узел второго члена группы (canvas.querySelector вернёт его)
  const ctx = {
    HAS_POINTER: true, document: { addEventListener() {}, removeEventListener() {} },
    EPDrag, EPConfig, state, spaceDown: false,
    canvas: { querySelector: () => node2 },
    setPanReady() {}, setRoomDropHighlight() {}, clearRoomDropHighlight() {}, applyDropHighlight() {},
    ensureSelectTool() { return false; }, applySelectionClasses() {}, renderProperties() {},
    hideHover() {}, buildSpaceComponents() { return null; }, getRoomForPoint() { return null; },
    renderGroupLinks() {}, renderRooms() {}, renderSummary() {},
    updateObjectRoom(o) { if (roomPlan && o.id in roomPlan) o.roomId = roomPlan[o.id]; return null; },
    updateStatus() {}, scheduleSave() {},
    beginGesture() {}, endGesture() {},
    refreshAfterRoomAssignments() { (state.posts || []).forEach(p => { if (roomPlan && p.id in roomPlan) p.roomId = roomPlan[p.id]; }); },
    removeEntity() {},
    warnWallMismatch(posts) { warned.push(posts.map(p => p.id)); }
  };
  const code = [stand.functionSource("trackDrag"), stand.functionSource("makeDraggable"), ";({ makeDraggable });"].join("\n");
  vm.createContext(ctx);
  return { api: vm.runInContext(code, ctx), warned, node2 };
}
function drag(el, from, to) {
  el.fire("pointerdown", pointer({ clientX: from.x, clientY: from.y }));
  el.fire("pointermove", pointer({ clientX: to.x, clientY: to.y }));   // >4px → перенос
  el.fire("pointerup", pointer({ clientX: to.x, clientY: to.y }));
}

test("перетаскивание ПОСТА внутри той же комнаты → warnWallMismatch НЕ зовётся (комната не сменилась)", () => {
  const obj = { id: "p1", x: 100, y: 100, roomId: "r1" };
  const { api, warned } = buildDrag({ pending: null, tool: "select", selected: null, scale: 1, rooms: [], posts: [obj] }, { p1: "r1" });
  const el = makeNode();
  api.makeDraggable(el, obj, "post");
  drag(el, { x: 500, y: 500 }, { x: 560, y: 542 });
  assert.equal(warned.length, 0, "та же комната — предупреждения нет (мутация «условие → true» краснит здесь)");
});

test("перетаскивание ПОСТА в ДРУГУЮ комнату → warnWallMismatch зовётся с этим постом", () => {
  const obj = { id: "p1", x: 100, y: 100, roomId: "r1" };
  const { api, warned } = buildDrag({ pending: null, tool: "select", selected: null, scale: 1, rooms: [], posts: [obj] }, { p1: "r2" });
  const el = makeNode();
  api.makeDraggable(el, obj, "post");
  drag(el, { x: 500, y: 500 }, { x: 560, y: 542 });
  assert.equal(JSON.stringify(warned), JSON.stringify([["p1"]]), "комната сменилась — предупреждаем ровно об этом посте");
});

test("перетаскивание ГРУППЫ → предупреждаем только членов, чья комната сменилась (beforeRoomId)", () => {
  const a = { id: "pa", x: 100, y: 100, roomId: "r1" };   // останется в r1
  const b = { id: "pb", x: 140, y: 100, roomId: "r1" };   // переедет в r2
  const state = { pending: null, tool: "select", scale: 1, rooms: [], posts: [a, b], selected: { kind: "posts", ids: ["pa", "pb"] } };
  const { api, warned, node2 } = buildDrag(state, { pa: "r1", pb: "r2" });
  const el = makeNode();   // узел ведущего (pa)
  api.makeDraggable(el, a, "post");
  node2.dataset.id = "pb";
  drag(el, { x: 500, y: 500 }, { x: 560, y: 542 });
  assert.equal(JSON.stringify(warned), JSON.stringify([["pb"]]), "предупреждаем только pb (его комната сменилась), pa — нет (мутация group-условия → true краснит здесь)");
});
