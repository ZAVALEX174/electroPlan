/* Чистый модуль истории EPHistory (Б4, ч.А): стек с лимитом и сбросом «Вернуть», amend/dropHead,
   ключ сравнения плана без производных полей, hotkeyAction по всем случаям. Модуль чистый — тест
   без окружения (ни DOM, ни state). Запуск: node --test tests/history.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const EPHistory = require("../js/history.js");

/* Снимок с заданным набором постов — остальное пустое. Удобно отличать состояния по числу постов. */
function snap(posts, extra) {
  return Object.assign({ devices: [], posts: posts || [], rooms: [], walls: [], autoWalls: [],
    roomLines: [], roomFieldMemory: [], pxPerMeter: null, scaleSegment: null, planRotation: 0, worldAngle: 0 }, extra || {});
}
const postsN = n => Array.from({ length: n }, (_, i) => ({ id: "p" + i, x: i, y: 0 }));

test("push фиксирует шаг только при изменении плана; одинаковый план — не шаг", () => {
  const h = EPHistory.create(50);
  h.reset(snap(postsN(0)));
  assert.equal(h.canUndo(), false, "база — отменять нечего");
  assert.equal(h.push(snap(postsN(1))), true, "появился пост — шаг");
  assert.equal(h.canUndo(), true);
  assert.equal(h.push(snap(postsN(1))), false, "тот же план — не шаг");
  assert.equal(h.push(snap(postsN(2))), true, "ещё пост — шаг");
});

test("лимит 50: после 60 изменений отменить можно ровно 50 раз", () => {
  const h = EPHistory.create(50);
  h.reset(snap(postsN(0)));
  for (let i = 1; i <= 60; i++) h.push(snap(postsN(i)));
  let undos = 0;
  while (h.canUndo()) { h.undo(); undos++; }
  assert.equal(undos, 50, "глубина отмены ограничена лимитом 50");
});

test("новое действие после отмены сбрасывает «Вернуть»", () => {
  const h = EPHistory.create(50);
  h.reset(snap(postsN(0)));
  h.push(snap(postsN(1)));
  h.push(snap(postsN(2)));
  h.undo();                                   // вернулись к 1 посту
  assert.equal(h.canRedo(), true, "после отмены есть что вернуть");
  h.push(snap(postsN(5)));                     // новое действие
  assert.equal(h.canRedo(), false, "новое действие стёрло «Вернуть»");
  const back = h.undo();
  assert.equal(back.posts.length, 1, "отмена нового действия возвращает к 1 посту");
});

test("undo/redo возвращают прежние снимки по шагу", () => {
  const h = EPHistory.create(50);
  h.reset(snap(postsN(0)));
  h.push(snap(postsN(1)));
  h.push(snap(postsN(2)));
  assert.equal(h.undo().posts.length, 1);
  assert.equal(h.undo().posts.length, 0);
  assert.equal(h.undo(), null, "дальше базы не отменить");
  assert.equal(h.redo().posts.length, 1);
  assert.equal(h.redo().posts.length, 2);
  assert.equal(h.redo(), null, "дальше головы не вернуть");
});

test("amend заменяет голову, не создавая шага и не трогая «Вернуть»", () => {
  const h = EPHistory.create(50);
  h.reset(snap(postsN(0)));
  h.push(snap(postsN(1)));
  const sizeBefore = h.size();
  h.amend(snap(postsN(1), { rooms: [{ id: "r1", name: "Кухня" }] }));   // автопересборка комнат из линий
  assert.equal(h.size(), sizeBefore, "amend не добавил запись");
  const back = h.undo();
  assert.equal(back.posts.length, 0, "отмена ведёт к базе, а не к промежуточному amend");
  const fwd = h.redo();
  assert.equal(fwd.rooms.length, 1, "вернулось дополненное состояние (с комнатой)");
});

test("dropHead снимает последний шаг (В19 «поставил и тут же убрал»)", () => {
  const h = EPHistory.create(50);
  h.reset(snap(postsN(0)));
  h.push(snap(postsN(1)));                      // поставил пост — шаг записан
  assert.equal(h.dropHead(), true);
  assert.equal(h.canUndo(), false, "шага «поставил» в истории не осталось");
  assert.equal(h.size(), 1, "осталась только база");
});

test("planKey не считает шагом пересчёт производных полей (roomId/seedX/componentId)", () => {
  const a = snap([{ id: "p1", x: 10, y: 20 }], { rooms: [{ id: "r1", name: "A", polygon: [] }] });
  const b = snap([{ id: "p1", x: 10, y: 20, roomId: "r1" }],
    { rooms: [{ id: "r1", name: "A", polygon: [], seedX: 5, seedY: 6, componentId: 2 }] });
  assert.equal(EPHistory.planKey(a), EPHistory.planKey(b),
    "добавление только производных полей — тот же план");
  const h = EPHistory.create(50);
  h.reset(a);
  assert.equal(h.push(b), false, "renderAll дописал roomId/seed — ложного шага нет");
});

test("planKey видит настоящее изменение (координата поста)", () => {
  const a = snap([{ id: "p1", x: 10, y: 20 }]);
  const b = snap([{ id: "p1", x: 40, y: 20 }]);
  assert.notEqual(EPHistory.planKey(a), EPHistory.planKey(b), "перенос поста — другой план");
});

test("planKey игнорирует настройки/вид (отменяется только план)", () => {
  const a = snap(postsN(1));
  const b = snap(postsN(1));
  a.terms = { discountPercent: 0 }; a.view = { panX: 0, panY: 0, scale: 1 };
  b.terms = { discountPercent: 50 }; b.view = { panX: 999, panY: 999, scale: 3 };
  assert.equal(EPHistory.planKey(a), EPHistory.planKey(b),
    "смена скидки/вида не меняет ключ плана");
});

test("planKey видит масштаб и оба угла", () => {
  const base = snap(postsN(1));
  assert.notEqual(EPHistory.planKey(base), EPHistory.planKey(snap(postsN(1), { worldAngle: 90 })), "угол мира — часть плана");
  assert.notEqual(EPHistory.planKey(base), EPHistory.planKey(snap(postsN(1), { planRotation: 90 })), "угол подложки — часть плана");
  assert.notEqual(EPHistory.planKey(base), EPHistory.planKey(snap(postsN(1), { pxPerMeter: 50 })), "масштаб — часть плана");
});

/* --- hotkeyAction по всем случаям ------------------------------------------------------------- */
const ev = o => Object.assign({ code: "KeyZ", ctrlKey: false, metaKey: false, shiftKey: false, repeat: false, target: { tagName: "BODY" } }, o);

test("hotkeyAction: Ctrl+Z — отменить, Ctrl+Y и Ctrl+Shift+Z — вернуть", () => {
  assert.equal(EPHistory.hotkeyAction(ev({ ctrlKey: true, code: "KeyZ" }), {}), "undo");
  assert.equal(EPHistory.hotkeyAction(ev({ ctrlKey: true, code: "KeyY" }), {}), "redo");
  assert.equal(EPHistory.hotkeyAction(ev({ ctrlKey: true, shiftKey: true, code: "KeyZ" }), {}), "redo");
  assert.equal(EPHistory.hotkeyAction(ev({ metaKey: true, code: "KeyZ" }), {}), "undo", "⌘ тоже считается");
});

test("hotkeyAction: без модификатора и чужие клавиши — null", () => {
  assert.equal(EPHistory.hotkeyAction(ev({ code: "KeyZ" }), {}), null, "без Ctrl/⌘");
  assert.equal(EPHistory.hotkeyAction(ev({ ctrlKey: true, code: "KeyA" }), {}), null, "другая клавиша");
});

test("hotkeyAction: при открытой модалке — null", () => {
  assert.equal(EPHistory.hotkeyAction(ev({ ctrlKey: true, code: "KeyZ" }), { modalOpen: true }), null);
});

test("hotkeyAction: в текстовом поле — null (браузерная отмена); на галочке/списке/ползунке — работает", () => {
  const text = { tagName: "INPUT", type: "text" };
  const number = { tagName: "INPUT", type: "number" };
  const search = { tagName: "INPUT", type: "search" };
  const bare = { tagName: "INPUT" };                   // input без type
  const area = { tagName: "TEXTAREA" };
  const ce = { tagName: "DIV", isContentEditable: true };
  for (const t of [text, number, search, bare, area, ce])
    assert.equal(EPHistory.hotkeyAction(ev({ ctrlKey: true, code: "KeyZ", target: t }), {}), null, "текст: " + (t.type || t.tagName));
  const checkbox = { tagName: "INPUT", type: "checkbox" };
  const range = { tagName: "INPUT", type: "range" };
  const select = { tagName: "SELECT" };
  for (const t of [checkbox, range, select])
    assert.equal(EPHistory.hotkeyAction(ev({ ctrlKey: true, code: "KeyZ", target: t }), {}), "undo", "не текст: " + (t.type || t.tagName));
});

test("hotkeyAction: удержание (repeat) разрешено — откат подряд", () => {
  assert.equal(EPHistory.hotkeyAction(ev({ ctrlKey: true, code: "KeyZ", repeat: true }), {}), "undo");
});
