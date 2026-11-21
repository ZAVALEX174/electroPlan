"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../js/builderSlots.js");
const P = require("../js/posts.js");
const Copy = require("../js/postCopy.js");

test("Flat: старый пост сохраняет верхнюю половину без нового поля", () => {
  const slots = S.fromPost({ mechanismIds: [1, 1] });
  assert.equal(slots[0].flatHalf, undefined);
  assert.equal(S.toPost(slots).flatHalves, undefined);
  assert.equal(S.toPost(S.setFlatHalf(slots, 0, "invalid")).flatHalves, undefined);
});

test("Flat: половины одинаковых клавиш переживают упаковку, правки групп и сохранение", () => {
  const catalog = { 1: { id: 1, moduleSpan: 1 }, 2: { id: 2, moduleSpan: 2 } };
  const slots = S.fromPost({ mechanismIds: [1, 2, 1], keyGroups: ["ON", "", "OFF"], flatHalves: ["", "", "bottom"] });
  const dist = P.distributePosts(S.tokens(slots), { standard: "DE", slotCount: 4, layoutRows: [[2, 2]] },
    S.tokenDeps(slots, { product: id => catalog[id], mechanismSpan: item => item.moduleSpan }));
  assert.equal(dist.full, true);
  let next = S.pick(slots, dist.posts.flatMap(p => p.mechanismIds));
  const index = next.findIndex(s => s.group === "OFF");
  next = S.setGroup(next, index, "Кухня");
  next = S.setCross(next, index, "7");
  next = S.setMech(next, index, "switch");
  const restored = S.fromPost(JSON.parse(JSON.stringify(S.toPost(next))));
  assert.equal(restored[index].flatHalf, "bottom");
  assert.equal(restored.find(s => s.group === "ON").flatHalf, undefined);
  assert.equal(S.clearGroups(restored)[index].flatHalf, "bottom", "шаблон сохраняет изображение после очистки групп");
});

test("Flat: смена половины учитывается в несохранённых правках, возврат наверх удаляет выбор", () => {
  const slots = S.fromPost({ mechanismIds: [1, 1] });
  const bottom = S.setFlatHalf(slots, 1, "bottom");
  assert.notEqual(S.signature(slots), S.signature(bottom));
  assert.deepEqual(S.toPost(bottom).flatHalves, ["", "bottom"]);
  assert.equal(S.toPost(S.setFlatHalf(bottom, 1, "top")).flatHalves, undefined);
  assert.equal(S.toPost(slots).flatHalves, undefined, "исходный пост независим от черновика");
});

test("Flat: замена изделия сбрасывает половину, пропавший товар сохраняет выбор", () => {
  const slots = S.fromPost({ mechanismIds: [1], flatHalves: ["bottom"] }, () => null);
  assert.equal(slots[0].flatHalf, "bottom");
  assert.equal(S.replaceAt(slots, 0, 2, () => true)[0].flatHalf, undefined);
  assert.equal(S.replaceAt(slots, 0, 1, () => true)[0].flatHalf, "bottom");
  assert.equal(S.fromPost({ mechanismIds: [2], flatHalves: ["bottom"] }, () => false)[0].flatHalf, undefined);
});

test("Flat: размещения из шаблона и копия поста получают независимые массивы половин", () => {
  const template = { id: "t", mechanismIds: [1, 1], flatHalves: ["bottom", ""] };
  const first = P.placementFields(template), second = P.placementFields(template);
  assert.deepEqual(first.flatHalves, ["bottom", ""]);
  first.flatHalves[0] = "";
  assert.equal(template.flatHalves[0], "bottom");
  assert.equal(second.flatHalves[0], "bottom");
  const source = { ...second, id: "p", number: 1, x: 0, y: 0 };
  const buffer = Copy.snapshot([source]);
  const [copy] = Copy.buildCopies(buffer, {
    existingPosts: [], genId: () => "copy", nextPostNumber: P.nextPostNumber, crossKey: v => String(v || "")
  });
  assert.deepEqual(copy.flatHalves, ["bottom", ""]);
  copy.flatHalves[0] = "";
  assert.equal(source.flatHalves[0], "bottom");
  assert.equal(buffer.items[0].post.flatHalves[0], "bottom");
});
