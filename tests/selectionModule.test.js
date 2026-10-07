/* Чистый модуль группового выделения постов (Б5, ч.1): EPSelection. Проверяем ФОРМУ выделения
   (0/1/N), переключение члена, попадание постов в экранную рамку при разных углах/масштабе/pan,
   границу по центру, отсев мёртвых id и текст «Выделено: N». postsInRect гоняем через НАСТОЯЩИЙ
   EPViewport.worldToScreen — то же правило «мир→экран», что в рантайме (копии формулы в тесте нет). */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../js/selection.js");
const EPViewport = require("../js/viewport.js");

/* --- normalize: форма выделения 0 / 1 / N -------------------------------------------------------- */
test("normalize: 0 постов → null, 1 → {kind:'post'}, ≥2 → {kind:'posts'}", () => {
  assert.equal(S.normalize([]), null);
  assert.equal(S.normalize(null), null);
  assert.deepEqual(S.normalize(["a"]), { kind: "post", id: "a" });
  assert.deepEqual(S.normalize(["a", "b"]), { kind: "posts", ids: ["a", "b"] });
  assert.deepEqual(S.normalize(["a", "b", "c"]), { kind: "posts", ids: ["a", "b", "c"] });
});

test("normalize: дубликаты снимаются, порядок добавления сохраняется", () => {
  assert.deepEqual(S.normalize(["a", "b", "a"]), { kind: "posts", ids: ["a", "b"] });
  assert.deepEqual(S.normalize(["b", "a", "b"]), { kind: "posts", ids: ["b", "a"] });
  /* остался один уникальный — это уже не группа */
  assert.deepEqual(S.normalize(["a", "a", "a"]), { kind: "post", id: "a" });
});

test("normalize: мёртвые id (поста больше нет) отсекаются по validIds", () => {
  assert.deepEqual(S.normalize(["a", "zz", "b"], ["a", "b"]), { kind: "posts", ids: ["a", "b"] });
  /* после отсева остался один живой → один пост */
  assert.deepEqual(S.normalize(["a", "zz"], ["a"]), { kind: "post", id: "a" });
  /* все мёртвые → null */
  assert.equal(S.normalize(["x", "y"], ["a", "b"]), null);
  /* validIds как Set тоже принимается */
  assert.deepEqual(S.normalize(["a", "b", "c"], new Set(["a", "c"])), { kind: "posts", ids: ["a", "c"] });
});

test("normalize: числовые id сравниваются с validIds по строке (dataset отдаёт строки)", () => {
  assert.deepEqual(S.normalize([1, 2], ["1", "2"]), { kind: "posts", ids: [1, 2] });
});

/* --- toggle: переключение члена набора ----------------------------------------------------------- */
test("toggle: добавляет отсутствующий, убирает присутствующий, схлопывает форму", () => {
  assert.deepEqual(S.toggle({ kind: "post", id: "a" }, "b"), { kind: "posts", ids: ["a", "b"] });
  assert.deepEqual(S.toggle({ kind: "posts", ids: ["a", "b"] }, "b"), { kind: "post", id: "a" });
  assert.deepEqual(S.toggle({ kind: "posts", ids: ["a", "b", "c"] }, "a"), { kind: "posts", ids: ["b", "c"] });
  /* повторный клик по единственному → снять всё */
  assert.equal(S.toggle({ kind: "post", id: "a" }, "a"), null);
});

test("toggle: база — только посты; выделенная комната Ctrl+кликом по посту заменяется этим постом", () => {
  assert.deepEqual(S.toggle({ kind: "room", id: "r1" }, "p1"), { kind: "post", id: "p1" });
  assert.deepEqual(S.toggle(null, "p1"), { kind: "post", id: "p1" });
});

/* --- isSelected: единый предикат для подсветки --------------------------------------------------- */
test("isSelected: член группы постов подсвечен; прочие виды — прямое сравнение", () => {
  const g = { kind: "posts", ids: ["a", "b"] };
  assert.equal(S.isSelected(g, "post", "a"), true);
  assert.equal(S.isSelected(g, "post", "b"), true);
  assert.equal(S.isSelected(g, "post", "c"), false);
  assert.equal(S.isSelected({ kind: "post", id: "a" }, "post", "a"), true);
  assert.equal(S.isSelected({ kind: "room", id: "r1" }, "room", "r1"), true);
  assert.equal(S.isSelected({ kind: "room", id: "r1" }, "post", "r1"), false);
  assert.equal(S.isSelected(null, "post", "a"), false);
  /* группа — это посты, устройство с тем же id не подсвечивается */
  assert.equal(S.isSelected(g, "device", "a"), false);
});

test("isSelected: id сравнивается строкой (dataset vs state)", () => {
  assert.equal(S.isSelected({ kind: "posts", ids: [1, 2] }, "post", "1"), true);
  assert.equal(S.isSelected({ kind: "post", id: 5 }, "post", "5"), true);
});

/* --- countText: «Выделено: N» только при N≥2 ----------------------------------------------------- */
test("countText: пусто при 0 и 1, «Выделено: N» при ≥2", () => {
  assert.equal(S.countText(null), "");
  assert.equal(S.countText({ kind: "post", id: "a" }), "");
  assert.equal(S.countText({ kind: "room", id: "r" }), "");
  assert.equal(S.countText({ kind: "posts", ids: ["a", "b"] }), "Выделено: 2");
  assert.equal(S.countText({ kind: "posts", ids: ["a", "b", "c"] }), "Выделено: 3");
});

/* --- postsInRect: попадание ЦЕНТРА поста в экранную рамку ---------------------------------------- */
const toScreen = view => pt => EPViewport.worldToScreen(pt, view);

test("postsInRect: угол 0, масштаб 1 — внутри тот, чей центр (x+12,y+12) в прямоугольнике", () => {
  const posts = [{ id: "in", x: 100, y: 100 }, { id: "out", x: 300, y: 300 }];
  const r = { left: 100, top: 100, right: 200, bottom: 200 };
  assert.deepEqual(S.postsInRect(posts, r, toScreen({ panX: 0, panY: 0, scale: 1, angle: 0 })), ["in"]);
});

test("postsInRect: граница по ЦЕНТРУ включительно — центр ровно на кромке считается внутри", () => {
  /* центр поста = (112,112); ставим правую/нижнюю кромку ровно в 112 */
  const posts = [{ id: "edge", x: 100, y: 100 }];
  const r = { left: 0, top: 0, right: 112, bottom: 112 };
  assert.deepEqual(S.postsInRect(posts, r, toScreen({ panX: 0, panY: 0, scale: 1, angle: 0 })), ["edge"]);
  /* сдвинем кромку на пиксель внутрь центра — пост выпадает */
  assert.deepEqual(S.postsInRect(posts, { left: 0, top: 0, right: 111, bottom: 111 },
    toScreen({ panX: 0, panY: 0, scale: 1, angle: 0 })), []);
});

test("postsInRect: масштаб 2 + pan — центр считается в экранных координатах", () => {
  const view = { panX: 50, panY: 20, scale: 2, angle: 0 };
  /* центр (112,112) → экран (50+224, 20+224) = (274,244) */
  const posts = [{ id: "p", x: 100, y: 100 }];
  assert.deepEqual(EPViewport.worldToScreen({ x: 112, y: 112 }, view), { x: 274, y: 244 });
  assert.deepEqual(S.postsInRect(posts, { left: 270, top: 240, right: 280, bottom: 250 }, toScreen(view)), ["p"]);
  assert.deepEqual(S.postsInRect(posts, { left: 0, top: 0, right: 100, bottom: 100 }, toScreen(view)), []);
});

test("postsInRect: угол 90 — рамка берёт посты, видимые внутри неё на ПОВЁРНУТОМ экране", () => {
  /* при 90°, scale 1, pan 0: screen.x = -y, screen.y = x (sx=x,sy=y, c=0,s=1).
     Центр поста (x+12,y+12) → экран (-(y+12), x+12). */
  const view = { panX: 0, panY: 0, scale: 1, angle: 90 };
  const posts = [{ id: "a", x: 0, y: 0 }, { id: "b", x: 100, y: 0 }, { id: "c", x: 0, y: 100 }];
  /* проверим точную проекцию центра поста a: (-(12), 12) = (-12,12) */
  assert.deepEqual(EPViewport.worldToScreen({ x: 12, y: 12 }, view), { x: -12, y: 12 });
  /* рамка, накрывающая экранные центры a(-12,12) и b(-12,112), но не c(-112,12) */
  const sel = S.postsInRect(posts, { left: -30, top: 0, right: 0, bottom: 200 }, toScreen(view));
  assert.deepEqual(sel.sort(), ["a", "b"]);
});

test("postsInRect: угол 270 и 37° — отбор согласован с worldToScreen (центр внутри ⇔ выбран)", () => {
  for (const angle of [270, 37]) {
    const view = { panX: 15, panY: -8, scale: 1.5, angle };
    const posts = Array.from({ length: 6 }, (_, i) => ({ id: "p" + i, x: i * 40, y: (i % 2) * 70 }));
    const r = { left: 0, top: -50, right: 90, bottom: 90 };
    const got = S.postsInRect(posts, r, toScreen(view));
    /* независимая проверка: пройдёмся сами и сверим список */
    const expect = posts.filter(p => {
      const s = EPViewport.worldToScreen({ x: p.x + 12, y: p.y + 12 }, view);
      return s.x >= r.left && s.x <= r.right && s.y >= r.top && s.y <= r.bottom;
    }).map(p => p.id);
    assert.deepEqual(got, expect, "угол " + angle);
  }
});

test("postsInRect: пустой список постов → пустой выбор", () => {
  assert.deepEqual(S.postsInRect([], { left: 0, top: 0, right: 100, bottom: 100 }, toScreen({ panX: 0, panY: 0, scale: 1, angle: 0 })), []);
});

/* --- rectFromPoints / pointInRect --------------------------------------------------------------- */
test("rectFromPoints: нормализует прямоугольник независимо от направления протяжки", () => {
  const a = S.rectFromPoints({ x: 10, y: 20 }, { x: 100, y: 200 });
  const b = S.rectFromPoints({ x: 100, y: 200 }, { x: 10, y: 20 });
  assert.deepEqual(a, { left: 10, top: 20, right: 100, bottom: 200 });
  assert.deepEqual(a, b);
});
