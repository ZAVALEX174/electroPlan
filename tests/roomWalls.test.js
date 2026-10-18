/* Чистые функции модуля стен комнаты (EPRoomWalls, К4в). Правило несоответствия «стена поста vs
   отметки комнаты», текст предупреждения, подпись кнопки, группировка жеста и перевод постов на стену.
   Ожидания текстов ЖЁСТКИЕ — полные строки (§7.1: зелёный тест обязан держать текст, утверждённый
   владельцем 17.10). Запуск: node --test tests/roomWalls.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const RW = require("../js/roomWalls.js");

/* ───────────────────────── Нормализация отметок ───────────────────────── */

test("normalizeKinds: валидные виды, без повторов, мусор отброшен, порядок появления", () => {
  assert.deepEqual(RW.normalizeKinds(["solid", "hollow"]), ["solid", "hollow"]);
  assert.deepEqual(RW.normalizeKinds(["hollow", "solid"]), ["hollow", "solid"], "порядок появления сохраняется");
  assert.deepEqual(RW.normalizeKinds(["solid", "solid"]), ["solid"], "повтор убран");
  assert.deepEqual(RW.normalizeKinds(["solid", "дерево", 7, null, "hollow"]), ["solid", "hollow"], "мусор отброшен");
  assert.deepEqual(RW.normalizeKinds(null), [], "нет поля → пусто");
  assert.deepEqual(RW.normalizeKinds("solid"), [], "не массив → пусто");
});

test("roomWallKinds: читает room.wallKinds через ту же нормализацию", () => {
  assert.deepEqual(RW.roomWallKinds({ wallKinds: ["solid", "мусор"] }), ["solid"]);
  assert.deepEqual(RW.roomWallKinds({}), [], "комната без отметок → пусто");
  assert.deepEqual(RW.roomWallKinds(null), []);
});

/* ───────────────────────── Несоответствие и целевая стена ───────────────────────── */

test("mismatch: комната без отметок → предупреждения НЕТ (решение владельца 2)", () => {
  assert.equal(RW.mismatch("hollow", {}), false, "нет отметок → нет несоответствия");
  assert.equal(RW.mismatch("hollow", { wallKinds: [] }), false, "пустой массив = не задано");
});

test("mismatch: стена поста есть среди отметок → совпадение; нет → несоответствие", () => {
  assert.equal(RW.mismatch("hollow", { wallKinds: ["solid"] }), true, "ГКЛ-пост в бетон-комнату — несоответствие");
  assert.equal(RW.mismatch("solid", { wallKinds: ["hollow"] }), true, "бетон-пост в ГКЛ-комнату — несоответствие");
  assert.equal(RW.mismatch("hollow", { wallKinds: ["hollow"] }), false, "совпало");
  assert.equal(RW.mismatch("solid", { wallKinds: ["solid", "hollow"] }), false, "обе отметки → любой пост подходит");
  assert.equal(RW.mismatch("hollow", { wallKinds: ["solid", "hollow"] }), false, "обе отметки → любой пост подходит");
});

test("targetWall: отметка комнаты, которой у поста нет; совпало/нет отметок → null", () => {
  assert.equal(RW.targetWall("hollow", { wallKinds: ["solid"] }), "solid");
  assert.equal(RW.targetWall("solid", { wallKinds: ["hollow"] }), "hollow");
  assert.equal(RW.targetWall("hollow", { wallKinds: ["hollow"] }), null, "совпало — цели нет");
  assert.equal(RW.targetWall("hollow", { wallKinds: ["solid", "hollow"] }), null, "обе отметки — цели нет");
  assert.equal(RW.targetWall("hollow", {}), null, "нет отметок — цели нет");
});

/* ───────────────────────── Группы жеста: текст, подпись, kind ───────────────────────── */

const SOLID_ROOM = { id: "r1", name: "Кухня", wallKinds: ["solid"] };
const HOLLOW_ROOM = { id: "r2", name: "Ванная", wallKinds: ["hollow"] };

test("gestureMismatches: один ГКЛ-пост в бетон-комнату → текст/подпись/kind (владелец 17.10)", () => {
  const g = RW.gestureMismatches([{ post: { id: "p3", number: 3 }, postWall: "hollow", room: SOLID_ROOM }]);
  assert.equal(g.length, 1);
  assert.equal(g[0].kind, "wallMismatch:p3", "kind — по составу постов (id), а не по стене");
  assert.equal(g[0].targetWall, "solid");
  assert.equal(g[0].text, "Стены не совпадают: пост № 3 — ГКЛ, в комнате «Кухня» только бетон");
  assert.equal(g[0].label, "Перевести пост на бетон");
  assert.deepEqual(g[0].posts.map(p => p.id), ["p3"]);
});

test("gestureMismatches: один бетон-пост в ГКЛ-комнату → слова и цель зеркальны", () => {
  const g = RW.gestureMismatches([{ post: { id: "p7", number: 7 }, postWall: "solid", room: HOLLOW_ROOM }]);
  assert.equal(g[0].kind, "wallMismatch:p7");
  assert.equal(g[0].targetWall, "hollow");
  assert.equal(g[0].text, "Стены не совпадают: пост № 7 — бетон, в комнате «Ванная» только ГКЛ");
  assert.equal(g[0].label, "Перевести пост на ГКЛ");
});

test("gestureMismatches: несколько постов одной цели → одно сообщение, список номеров, «посты»", () => {
  const g = RW.gestureMismatches([
    { post: { id: "p3", number: 3 }, postWall: "hollow", room: SOLID_ROOM },
    { post: { id: "p5", number: 5 }, postWall: "hollow", room: SOLID_ROOM }
  ]);
  assert.equal(g.length, 1, "одна группа — одно предупреждение (решение владельца 5)");
  assert.equal(g[0].text, "Стены не совпадают: посты № 3 и № 5 — ГКЛ, в комнате «Кухня» только бетон");
  assert.equal(g[0].label, "Перевести посты на бетон");
  assert.equal(g[0].kind, "wallMismatch:p3,p5", "kind по составу постов группы");
  assert.deepEqual(g[0].posts.map(p => p.id), ["p3", "p5"]);
  assert.deepEqual(g[0].postIds, ["p3", "p5"], "postIds — для повторной проверки в момент клика/отмены");
});

test("gestureMismatches: совпавшие и комнаты без отметок в группы НЕ попадают", () => {
  const g = RW.gestureMismatches([
    { post: { id: "ok", number: 1 }, postWall: "solid", room: SOLID_ROOM },     // совпало
    { post: { id: "nomark", number: 2 }, postWall: "hollow", room: { id: "r9", name: "Склад" } }, // без отметок
    { post: { id: "bad", number: 3 }, postWall: "hollow", room: SOLID_ROOM }    // несоответствие
  ]);
  assert.equal(g.length, 1, "только реальное несоответствие");
  assert.deepEqual(g[0].posts.map(p => p.id), ["bad"]);
});

test("gestureMismatches: посты в РАЗНЫХ комнатах → по сообщению на комнату (у каждого своя кнопка/цель/имя)", () => {
  const g = RW.gestureMismatches([
    { post: { id: "p3", number: 3 }, postWall: "hollow", room: SOLID_ROOM },   // Кухня → бетон
    { post: { id: "p4", number: 4 }, postWall: "solid", room: HOLLOW_ROOM }    // Ванная → ГКЛ
  ]);
  assert.equal(g.length, 2, "разные комнаты — разные сообщения (владелец 7), kind по постам → не затирают друг друга");
  const byTarget = Object.fromEntries(g.map(x => [x.targetWall, x]));
  assert.equal(byTarget.solid.label, "Перевести пост на бетон");
  assert.equal(byTarget.solid.text, "Стены не совпадают: пост № 3 — ГКЛ, в комнате «Кухня» только бетон");
  assert.equal(byTarget.hollow.label, "Перевести пост на ГКЛ");
  assert.equal(byTarget.hollow.text, "Стены не совпадают: пост № 4 — бетон, в комнате «Ванная» только ГКЛ");
  assert.notEqual(g[0].kind, g[1].kind, "kind разный — сообщения сосуществуют");
});

test("gestureMismatches: посты одной цели в РАЗНЫХ комнатах → ОТДЕЛЬНЫЕ сообщения, каждое со своим именем комнаты (владелец 7)", () => {
  const SOLID_ROOM2 = { id: "r3", name: "Прихожая", wallKinds: ["solid"] };
  const g = RW.gestureMismatches([
    { post: { id: "p3", number: 3 }, postWall: "hollow", room: SOLID_ROOM },    // Кухня, цель бетон
    { post: { id: "p8", number: 8 }, postWall: "hollow", room: SOLID_ROOM2 }    // Прихожая, цель бетон
  ]);
  assert.equal(g.length, 2, "одна цель, но разные комнаты → два сообщения (имя комнаты в тексте верное у каждого)");
  const names = g.map(x => x.text).sort();
  assert.deepEqual(names, [
    "Стены не совпадают: пост № 3 — ГКЛ, в комнате «Кухня» только бетон",
    "Стены не совпадают: пост № 8 — ГКЛ, в комнате «Прихожая» только бетон"
  ]);
});

/* ───────────────────────── Перевод постов кнопкой ───────────────────────── */

test("applyWall: пишет wallType только переданным постам, возвращает число изменённых", () => {
  const a = { id: "a", wallType: "hollow" }, b = { id: "b", wallType: "solid" }, c = { id: "c" };
  const n = RW.applyWall([a, c], "solid");
  assert.equal(a.wallType, "solid", "переведён");
  assert.equal(c.wallType, "solid", "у поста без поля проставлен");
  assert.equal(b.wallType, "solid", "НЕ в списке — не трогаем (его значение исходное)");
  assert.equal(n, 2, "изменены a и c; c не был solid, a был hollow");
  assert.equal(RW.applyWall([a], "solid"), 0, "уже solid → 0 изменений (идемпотентно)");
});

/* ───────────────────────── Разметка отметок для панели свойств ───────────────────────── */

test("wallKindsFieldHtml: два чекбокса с нужными id, отмечены по room.wallKinds", () => {
  const html = RW.wallKindsFieldHtml({ wallKinds: ["solid"] });
  assert.match(html, /id="roomWallSolid"[^>]* checked/, "бетон отмечен");
  assert.match(html, /id="roomWallHollow"(?![^>]*checked)/, "ГКЛ не отмечен");
  assert.match(html, /Бетон, кирпич, сплошные стены/);
  assert.match(html, /ГКЛ и полые стены/);
  const both = RW.wallKindsFieldHtml({ wallKinds: ["solid", "hollow"] });
  assert.match(both, /id="roomWallSolid"[^>]* checked/);
  assert.match(both, /id="roomWallHollow"[^>]* checked/);
  const none = RW.wallKindsFieldHtml({});
  assert.doesNotMatch(none, /checked/, "комната без отметок — ни один чекбокс не отмечен");
});
