/* Копирование постов (Б9, часть 1) — ЧИСТЫЙ модуль js/postCopy.js.
   Поведенческие проверки с жёсткими ожиданиями (числа/строки) + денежная проверка на НАСТОЯЩЕМ
   расчёте и каталоге VIMAR: копии с новыми номерами проходных образуют СВОЮ пару, а не оживляют
   инвертор у оригинала. Мутации — tools/qa/mutations/postcopy.json. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EPPostCopy = require("../js/postCopy.js");
const EPLightingGroups = require("../js/lightingGroups.js");
const crossKey = EPLightingGroups.crossGroupKey;

/* Генератор id и «следующий номер поста» как у приложения (EPPosts.nextPostNumber — настоящий). */
const EPPosts = require("../js/posts.js");
function makeGenId(start) { let n = start || 0; return () => "copy-" + (++n); }

/* Пост-образец: 3 механизма, первая клавиша в проходной с номером cross, личная скидка, свой тип
   стены, своя подсветка, ограничение цвета начинки — всё это обязано доехать до копии (решение 4). */
function samplePost(over) {
  return Object.assign({
    id: "src", number: 7, x: 10, y: 20, roomId: "R",
    name: "Выключатель у двери", frameId: 555,
    mechanismIds: [101, 101, 101],
    keyGroups: ["Спальня", "", ""],
    keyCrossNumbers: ["5", "", ""],
    keyMechanisms: ["switch", "", ""],
    socketBoxProductId: 777,
    restrictInnardsColor: "white",
    wallType: "hollow",
    backlight: { enabled: true, color: "blue", voltage: "230" },
    discount: 12
  }, over || {});
}

/* ───────────────────────── (а) СНИМОК ───────────────────────── */

test("snapshot: копия независима — ни один массив/объект не общий с исходником", () => {
  const src = samplePost();
  const buf = EPPostCopy.snapshot([src]);
  const snap = buf.items[0].post;
  assert.notEqual(snap.mechanismIds, src.mechanismIds, "mechanismIds не должен быть той же ссылкой");
  assert.notEqual(snap.keyGroups, src.keyGroups);
  assert.notEqual(snap.keyCrossNumbers, src.keyCrossNumbers);
  assert.notEqual(snap.backlight, src.backlight, "backlight (объект) не должен быть той же ссылкой");
  /* Мутация исходника ПОСЛЕ снимка не должна менять снимок. */
  src.mechanismIds.push(999);
  src.backlight.color = "red";
  src.name = "ПЕРЕИМЕНОВАН";
  assert.deepEqual(buf.items[0].post.mechanismIds, [101, 101, 101]);
  assert.equal(buf.items[0].post.backlight.color, "blue");
  assert.equal(buf.items[0].post.name, "Выключатель у двери");
});

test("snapshot: dx/dy — смещение ЦЕНТРА значка от центра группы (взаимное расположение)", () => {
  /* Два поста: углы (0,0) и (100,0) → центры значков (12,12) и (112,12) → центр группы (62,12).
     Смещения: −50 и +50 по x, 0 по y. */
  const buf = EPPostCopy.snapshot([samplePost({ x: 0, y: 0 }), samplePost({ x: 100, y: 0 })]);
  assert.equal(buf.center.x, 62);
  assert.equal(buf.center.y, 12);
  assert.deepEqual([buf.items[0].dx, buf.items[0].dy], [-50, 0]);
  assert.deepEqual([buf.items[1].dx, buf.items[1].dy], [50, 0]);
});

/* ───────────────────────── (б) СБОРКА КОПИЙ ───────────────────────── */

function buildOpts(over) {
  return Object.assign({
    existingPosts: [], genId: makeGenId(0), nextPostNumber: EPPosts.nextPostNumber, crossKey
  }, over || {});
}

test("buildCopies: все НЕслужебные поля копируются, служебные — новые; roomId снят", () => {
  const src = samplePost({ unknownFutureField: { deep: [1, 2] } });   // «поле завтра» не должно теряться
  const buf = EPPostCopy.snapshot([src]);
  const [c] = EPPostCopy.buildCopies(buf, buildOpts({ existingPosts: [{ number: 3 }], point: { x: 300, y: 300 } }));
  /* Служебные заданы вставкой. */
  assert.equal(c.id, "copy-1");
  assert.equal(c.number, 4, "следующий номер = max(3)+1");
  assert.equal("roomId" in c, false, "roomId приложение пересчитает из координат — build его не ставит");
  /* Содержательные поля — как у исходника. */
  assert.equal(c.name, "Выключатель у двери");
  assert.equal(c.frameId, 555);
  assert.deepEqual(c.mechanismIds, [101, 101, 101]);
  assert.deepEqual(c.keyGroups, ["Спальня", "", ""]);
  assert.deepEqual(c.keyMechanisms, ["switch", "", ""]);
  assert.equal(c.socketBoxProductId, 777);
  assert.equal(c.restrictInnardsColor, "white");
  assert.equal(c.wallType, "hollow");
  assert.deepEqual(c.backlight, { enabled: true, color: "blue", voltage: "230" });
  assert.equal(c.discount, 12);
  assert.deepEqual(c.unknownFutureField, { deep: [1, 2] }, "незнакомое поле обязано доехать до копии");
  /* И независимость от исходника. */
  assert.notEqual(c.backlight, src.backlight);
  assert.notEqual(c.mechanismIds, src.mechanismIds);
});

test("buildCopies: номера постов последовательны, без дублей в пакете и выше существующих", () => {
  const buf = EPPostCopy.snapshot([samplePost(), samplePost(), samplePost()]);
  const copies = EPPostCopy.buildCopies(buf, buildOpts({ existingPosts: [{ number: 10 }, { number: 4 }], point: { x: 0, y: 0 } }));
  assert.deepEqual(copies.map(c => c.number), [11, 12, 13]);
  assert.equal(new Set(copies.map(c => c.number)).size, 3);
  assert.equal(new Set(copies.map(c => c.id)).size, 3, "id у всех разные");
});

test("buildCopies по точке: центр группы встаёт в точку, взаимное расположение сохранено", () => {
  const buf = EPPostCopy.snapshot([samplePost({ x: 0, y: 0 }), samplePost({ x: 100, y: 0 })]);
  const copies = EPPostCopy.buildCopies(buf, buildOpts({ point: { x: 500, y: 300 } }));
  /* Центр группы (62,12) ложится в (500,300): dx=−50 → центр значка 450 → x=450−12=438; dx=+50 → 538. */
  assert.deepEqual([copies[0].x, copies[0].y], [438, 288]);
  assert.deepEqual([copies[1].x, copies[1].y], [538, 288]);
  /* Взаимное расстояние между копиями = расстояние между исходниками (100 по x). */
  assert.equal(copies[1].x - copies[0].x, 100);
  assert.equal(copies[1].y - copies[0].y, 0);
});

test("buildCopies по точке, один пост: центр значка копии ровно в точке", () => {
  const buf = EPPostCopy.snapshot([samplePost({ x: 0, y: 0 })]);
  const [c] = EPPostCopy.buildCopies(buf, buildOpts({ point: { x: 200, y: 150 } }));
  assert.deepEqual([c.x + EPPostCopy.POST_ICON_HALF, c.y + EPPostCopy.POST_ICON_HALF], [200, 150]);
});

test("buildCopies без точки: сдвиг от исходных; повторная вставка не ложится поверх", () => {
  const src = samplePost({ x: 40, y: 60 });
  const buf = EPPostCopy.snapshot([src]);
  const first = EPPostCopy.buildCopies(buf, buildOpts({ existingPosts: [src] }));
  assert.deepEqual([first[0].x, first[0].y], [64, 84], "сдвиг на один шаг (24) от исходника");
  /* Вторая вставка, когда первая копия уже в проекте: должна встать ДАЛЬШЕ, не поверх. */
  const existing2 = [src, Object.assign({}, first[0])];
  const second = EPPostCopy.buildCopies(buf, buildOpts({ existingPosts: existing2 }));
  assert.notDeepEqual([second[0].x, second[0].y], [first[0].x, first[0].y]);
  assert.deepEqual([second[0].x, second[0].y], [88, 108], "сдвиг нарос до двух шагов");
});

/* ───────────────────────── (в) НОВЫЕ НОМЕРА ПРОХОДНЫХ ───────────────────────── */

test("newCrossNumbers: один исходный номер → один новый; пустые остаются пустыми", () => {
  const copies = [{ keyCrossNumbers: ["3", "3", ""] }, { keyCrossNumbers: ["3", ""] }];
  const map = EPPostCopy.newCrossNumbers(copies, [], crossKey);
  assert.equal(map.get(crossKey("3")), "1");
  assert.equal(map.size, 1, "«3» — один различный номер, один новый");
});

test("newCrossNumbers: разные исходные номера → РАЗНЫЕ новые", () => {
  const copies = [{ keyCrossNumbers: ["7"] }, { keyCrossNumbers: ["8"] }];
  const map = EPPostCopy.newCrossNumbers(copies, [], crossKey);
  assert.equal(map.get(crossKey("7")), "1");
  assert.equal(map.get(crossKey("8")), "2");
  assert.notEqual(map.get(crossKey("7")), map.get(crossKey("8")));
});

test("newCrossNumbers: « 5 » и «5» — ОДИН номер (правило расчёта), «05» — другой", () => {
  const copies = [{ keyCrossNumbers: ["5", " 5 ", "05"] }];
  const map = EPPostCopy.newCrossNumbers(copies, [], crossKey);
  assert.equal(map.get(crossKey("5")), map.get(crossKey(" 5 ")), "«5» и « 5 » склеиваются");
  assert.notEqual(map.get(crossKey("5")), map.get(crossKey("05")), "«05» — отдельный номер");
  assert.equal(map.size, 2);
});

test("newCrossNumbers: новый номер отличается от номера оригинала (своя пара, не инвертор)", () => {
  /* Оригинал с номером «5» лежит в проекте; копия с «5» обязана получить ДРУГОЙ номер. */
  const map = EPPostCopy.newCrossNumbers([{ keyCrossNumbers: ["5"] }], [{ keyCrossNumbers: ["5"] }], crossKey);
  assert.notEqual(crossKey(map.get(crossKey("5"))), crossKey("5"));
  assert.equal(map.get(crossKey("5")), "1");
});

test("newCrossNumbers: новый номер свободен и среди ДРУГИХ существующих в проекте", () => {
  /* В проекте заняты «1» и «5»; копия с «5» не должна получить ни «1», ни «5». */
  const existing = [{ keyCrossNumbers: ["1"] }, { keyCrossNumbers: ["5"] }];
  const map = EPPostCopy.newCrossNumbers([{ keyCrossNumbers: ["5"] }], existing, crossKey);
  const got = map.get(crossKey("5"));
  assert.equal(got, "2");
  assert.notEqual(crossKey(got), crossKey("1"));
  assert.notEqual(crossKey(got), crossKey("5"));
});

test("buildCopies: клавиши с одним исходным номером получают один новый; длина сохранена", () => {
  const src = samplePost({ keyCrossNumbers: ["5", "5", ""] });   // две клавиши в одной проходной
  const buf = EPPostCopy.snapshot([src]);
  const [c] = EPPostCopy.buildCopies(buf, buildOpts({ existingPosts: [src], point: { x: 0, y: 0 } }));
  assert.equal(c.keyCrossNumbers.length, 3, "длина keyCrossNumbers = длине mechanismIds");
  assert.equal(c.keyCrossNumbers[0], c.keyCrossNumbers[1], "оба «5» → один новый номер");
  assert.notEqual(crossKey(c.keyCrossNumbers[0]), crossKey("5"), "новый номер ≠ исходный");
  assert.equal(c.keyCrossNumbers[2], "", "пустая клавиша осталась пустой");
});

/* ───────────────────────── ДЕНЬГИ НА НАСТОЯЩЕМ РАСЧЁТЕ ───────────────────────── */

/* Мини-стенд реального расчёта (как scratchpad world.js): настоящий каталог VIMAR + модули
   lightingPlan/lightingGroups/lightingByRoom/estimate/posts. Пара проходных считается по комнате,
   куда попали посты. */
function makeWorld() {
  const JS = path.join(__dirname, "..", "js");
  const stand = require("./helpers/appStand.js");
  const win = {};
  const ctx = vm.createContext({ window: win, structuredClone });
  for (const f of ["catalog-vimar.js", "catalog-vimar-attrs.js", "data.js"]) {
    vm.runInContext(fs.readFileSync(path.join(JS, f), "utf8"), ctx, { filename: f });
  }
  const PRODUCTS = win.EP_DATA.products;
  const J = f => require(path.join(JS, f));
  const EPLightingPlan = J("lightingPlan.js"), LG = J("lightingGroups.js"), EPLightingByRoom = J("lightingByRoom.js"),
    EPEstimate = J("estimate.js"), EPCatalog = J("catalog.js"), Posts = J("posts.js"), EPPostFit = J("postfit.js"), Room = J("room.js");
  const controlPlaceKind = vm.runInNewContext(stand.constSource("controlPlaceKind") + "\n;controlPlaceKind;", {});
  const product = id => PRODUCTS.find(x => Number(x.id) === Number(id));
  const byKind = k => PRODUCTS.filter(x => x.kind === k && x.active);
  const byCode = c => PRODUCTS.find(p => p.code === c);
  const { mechanismSpan, productSeries, frameSlotCount } = EPCatalog;
  const settings = { wallType: "solid", lightingScheme: "classic", backlight: { enabled: false } };
  const findBox = ({ frame, standard, modules, wallType } = {}) => EPPostFit.findBox({ boxes: byKind("socket_box"), frame, standard, modules, frameModules: frameSlotCount(frame), wantedWall: wallType || "solid" });
  const fallbackBox = ({ frame, standard, modules, wallType } = {}) => EPPostFit.fallbackBox({ boxes: byKind("socket_box"), frame, standard, modules, frameModules: frameSlotCount(frame), wantedWall: wallType || "solid" });
  const resolveSupport = ({ frame, standard, modules, box } = {}) => EPPostFit.resolveSupport({ supports: byKind("support"), frame, standard, modules, frameModules: frameSlotCount(frame), seriesOf: productSeries, box });
  const findBacklight = o => EPPostFit.findBacklight(Object.assign({ accessories: byKind("accessory") }, o || {}));
  const postDeps = () => ({ product, frameProduct: product, socketBox: () => EPPostFit.socketBox(byKind("socket_box")), mechanismSpan, findBox, fallbackBox, resolveSupport, supportRequired: EPPostFit.supportRequired, wallType: settings.wallType, findBacklight, backlight: settings.backlight });
  const postCost = p => Posts.postCost(p, postDeps());
  const postComposition = p => Posts.postComposition(p, postDeps());
  function lightingFor(posts, rooms) {
    const places = EPLightingPlan.collect(posts, { product, seriesOf: productSeries, controlKind: controlPlaceKind });
    const mechs = byKind("mechanism");
    const replacementDeps = { seriesOf: productSeries, spanOf: mechanismSpan, colorKeyOf: i => i && i.elementColor ? EPCatalog.facingColorKey(i.elementColor) : null, fgOf: i => (i && i.functionalGroup) || null, fsgOf: i => (i && i.functionalSubgroup) || null };
    const planDeps = { seriesOf: productSeries, findMechanism: ({ role, series, kind, source }) => {
      if (kind === "integrated") return EPLightingPlan.resolveReplacement({ role, source }, mechs, replacementDeps).product;
      return EPLightingPlan.resolveMechanism({ role, series }, mechs).product; } };
    const roomById = new Map(rooms.map(r => [r.id, r]));
    const roomOfPost = new Map(posts.map(p => [p.id, p.roomId != null ? p.roomId : null]));
    const roomOrder = new Map(rooms.map((r, i) => [r.id, i]));
    const plan = EPLightingByRoom.planByRooms({ places, projectScheme: "classic", projectSchemeLabel: "",
      partitionKeyOf: pl => { const r = roomOfPost.get(pl.postId); return r == null ? null : r; },
      schemeForPartition: k => k == null ? "classic" : Room.roomLightingScheme(roomById.get(k), "classic", LG.SCHEMES),
      labelForPartition: k => k == null ? "Без помещения" : ((roomById.get(k) || {}).name || ""),
      orderForPartition: k => k == null ? Infinity : (roomOrder.has(k) ? roomOrder.get(k) : Infinity),
      plan: LG.plan, planDeps });
    return { plan, places, rows: EPLightingPlan.rowsByPost(plan, places, LG.GAP_TEXTS) };
  }
  const lightingRowsFor = (post, light) => light.rows.get(EPLightingPlan.postKey(post)) || [];
  function postTotalCost(post, light) {
    const rows = lightingRowsFor(post, light);
    const eff = EPEstimate.effectiveMechanismIds(post.mechanismIds, rows);
    return EPEstimate.postPrice(postCost(Object.assign({}, post, { mechanismIds: eff })), rows);
  }
  function estimate(posts, rooms) {
    const light = lightingFor(posts, rooms);
    return { light, est: EPEstimate.build({ devices: [], posts, product, frameProduct: product, postCost, postComposition, lightingOf: po => lightingRowsFor(po, light), settings: { ...settings, discountPercent: 0, workPercent: 0, materialsPercent: 0, vatPercent: 0 } }) };
  }
  return { byCode, estimate, postTotalCost, lightingRowsFor, Posts };
}

/* Пара постов в комнате, первая клавиша в проходной «1»; остальные — одиночные. 21653.01 + 3×20021.B. */
function pairPost(W, id, number, roomId) {
  const K = W.byCode("20021.B"), F = W.byCode("21653.01");
  return { id, number, x: 0, y: 0, roomId, name: "Пост", frameId: F.id,
    mechanismIds: [K.id, K.id, K.id], keyGroups: ["", "", ""], keyCrossNumbers: ["1", "", ""], keyMechanisms: ["", "", ""], templateId: "t" };
}

test("деньги: копии обоих постов пары в ту же комнату образуют СВОЮ пару, оригинал не тронут", () => {
  const W = makeWorld();
  const rooms = [{ id: "A", name: "Номер 101" }];
  const p1 = pairPost(W, "p1", 1, "A"), p2 = pairPost(W, "p2", 2, "A");
  /* До копирования: пара по 157.41, оборудование 314.82. */
  const before = W.estimate([p1, p2], rooms);
  assert.equal(W.postTotalCost(p1, before.light).toFixed(2), "157.41");
  assert.equal(W.postTotalCost(p2, before.light).toFixed(2), "157.41");

  const buf = EPPostCopy.snapshot([p1, p2]);
  const copies = EPPostCopy.buildCopies(buf, {
    existingPosts: [p1, p2], point: { x: 400, y: 400 }, genId: makeGenId(0), nextPostNumber: EPPosts.nextPostNumber, crossKey
  });
  copies.forEach(c => { c.roomId = "A"; });   // приложение привяжет к комнате по координатам — здесь A

  const after = W.estimate([p1, p2, ...copies], rooms);
  /* Оригинальная пара не изменилась. */
  assert.equal(W.postTotalCost(p1, after.light).toFixed(2), "157.41");
  assert.equal(W.postTotalCost(p2, after.light).toFixed(2), "157.41");
  /* Копии образуют свою пару (переключатель 20005.0 → 157.41), а НЕ инвертор 20013.0 → 173.95. */
  assert.equal(W.postTotalCost(copies[0], after.light).toFixed(2), "157.41");
  assert.equal(W.postTotalCost(copies[1], after.light).toFixed(2), "157.41");
  assert.equal(W.lightingRowsFor(copies[0], after.light)[0].code, "20005.0", "своя пара → переключатель, не инвертор");
  /* Итог удвоился: 2×157.41 → 4×157.41. */
  assert.equal(after.est.equipment.toFixed(2), "629.64");
  assert.equal(before.est.equipment.toFixed(2), "314.82");
});

test("деньги: копия ОДНОГО поста из пары — у копии «пары нет», исходная пара цела", () => {
  const W = makeWorld();
  const rooms = [{ id: "A", name: "Номер 101" }];
  const p1 = pairPost(W, "p1", 1, "A"), p2 = pairPost(W, "p2", 2, "A");
  const buf = EPPostCopy.snapshot([p1]);
  const [c] = EPPostCopy.buildCopies(buf, {
    existingPosts: [p1, p2], point: null, genId: makeGenId(0), nextPostNumber: EPPosts.nextPostNumber, crossKey
  });
  c.roomId = "A";
  const after = W.estimate([p1, p2, c], rooms);
  /* Исходная пара цела. */
  assert.equal(W.postTotalCost(p1, after.light).toFixed(2), "157.41");
  assert.equal(W.postTotalCost(p2, after.light).toFixed(2), "157.41");
  /* У копии новый номер встречается один раз → «пары нет»: первая клавиша — честный пробел. */
  const rows = W.lightingRowsFor(c, after.light);
  assert.equal(rows[0].missingReason, "cross-single-place");
  assert.equal(W.postTotalCost(c, after.light).toFixed(2), "131.62");
});
