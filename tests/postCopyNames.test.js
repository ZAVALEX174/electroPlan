/* Копирование постов (Б9, часть 2а) — ДЕНЕЖНАЯ проверка правила «имя группы света у копии» на
   НАСТОЯЩЕМ pastePosts (вырезан из app.js), НАСТОЯЩЕМ отборе комнаты (getRoomForPoint по координатам),
   НАСТОЯЩЕМ каталоге VIMAR и НАСТОЯЩЕМ расчёте групп света/смете (lightingGroups → lightingByRoom →
   estimate — та же цепочка, что в приложении).

   Что доказываем (решение владельца 10.10, вариант Б): копия, попавшая туда же, где уже стоит пост с
   тем же именем группы (та же комната / оба вне комнат / комнат нет), НЕ связывается с ним — имя у копии
   снимается, и выключатель 20001.0 не превращается в переключатель 20005.0. В другой комнате имя цело.
   Без правки смета пачки «Свет» росла на 162.94 € вместо 151.88 €, а исходный пост дорожал 151.88→157.41.
   Запуск: node --test tests/postCopyNames.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");

const EPPostCopy = require("../js/postCopy.js");
const EPPosts = require("../js/posts.js");
const EPLightingGroups = require("../js/lightingGroups.js");
const EPLightingPlan = require("../js/lightingPlan.js");
const EPLightingByRoom = require("../js/lightingByRoom.js");
const EPEstimate = require("../js/estimate.js");
const EPPostFit = require("../js/postfit.js");
const EPSelection = require("../js/selection.js");
const EPCatalog = require("../js/catalog.js");
const EPRoom = require("../js/room.js");

/* Реальный каталог VIMAR — те же файлы и порядок, что в index.html. */
function loadRuntimeProducts() {
  const jsDir = path.join(__dirname, "..", "js");
  const win = {};
  const context = vm.createContext({ window: win, structuredClone });
  for (const file of ["catalog-vimar.js", "catalog-vimar-attrs.js", "data.js"]) {
    vm.runInContext(fs.readFileSync(path.join(jsDir, file), "utf8"), context, { filename: file });
  }
  return win.EP_DATA.products;
}
const PRODUCTS = loadRuntimeProducts();
const product = id => PRODUCTS.find(p => Number(p.id) === Number(id));
const byCode = code => PRODUCTS.find(p => String(p.code) === code);
const byKind = kind => PRODUCTS.filter(p => p.kind === kind && p.active);
const { mechanismSpan, productSeries, frameSlotCount } = EPCatalog;

/* controlPlaceKind живёт в app.js top-level const — берём НАСТОЯЩИЙ текст, не копию. */
const controlPlaceKind = vm.runInNewContext(stand.constSource("controlPlaceKind") + "\n;controlPlaceKind;", {});

/* ─── НАСТОЯЩИЙ расчёт денег (та же цепочка, что renderSummary) ─── */
const settings = { wallType: "solid", lightingScheme: "classic", backlight: { enabled: false } };
const findBox = o => EPPostFit.findBox({ boxes: byKind("socket_box"), frame: o.frame, standard: o.standard, modules: o.modules, frameModules: frameSlotCount(o.frame), wantedWall: o.wallType || "solid" });
const fallbackBox = o => EPPostFit.fallbackBox({ boxes: byKind("socket_box"), frame: o.frame, standard: o.standard, modules: o.modules, frameModules: frameSlotCount(o.frame), wantedWall: o.wallType || "solid" });
const findSupport = o => EPPostFit.findSupport({ supports: byKind("support"), frame: o.frame, standard: o.standard, modules: o.modules, frameModules: frameSlotCount(o.frame), seriesOf: productSeries, box: o.box });
const resolveSupport = o => EPPostFit.resolveSupport({ supports: byKind("support"), frame: o.frame, standard: o.standard, modules: o.modules, frameModules: frameSlotCount(o.frame), seriesOf: productSeries, box: o.box });
const findBacklight = o => EPPostFit.findBacklight(Object.assign({ accessories: byKind("accessory") }, o || {}));
const postDeps = () => ({ product, frameProduct: product, socketBox: () => EPPostFit.socketBox(byKind("socket_box")), mechanismSpan, findBox, fallbackBox, findSupport, resolveSupport, supportRequired: EPPostFit.supportRequired, wallType: settings.wallType, findBacklight, backlight: settings.backlight });
const postCost = p => EPPosts.postCost(p, postDeps());
const postComposition = p => EPPosts.postComposition(p, postDeps());
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
    schemeForPartition: k => k == null ? "classic" : EPRoom.roomLightingScheme(roomById.get(k), "classic", EPLightingGroups.SCHEMES),
    labelForPartition: k => k == null ? "Без помещения" : ((roomById.get(k) || {}).name || ""),
    orderForPartition: k => k == null ? Infinity : (roomOrder.has(k) ? roomOrder.get(k) : Infinity),
    plan: EPLightingGroups.plan, planDeps });
  return { plan, places, rows: EPLightingPlan.rowsByPost(plan, places, EPLightingGroups.GAP_TEXTS) };
}
const rowsFor = (post, light) => light.rows.get(EPLightingPlan.postKey(post)) || [];
function postTotalCost(post, light) {
  const rows = rowsFor(post, light);
  const eff = EPEstimate.effectiveMechanismIds(post.mechanismIds, rows);
  return EPEstimate.postPrice(postCost(Object.assign({}, post, { mechanismIds: eff })), rows);
}
function equipmentOf(posts, rooms) {
  const light = lightingFor(posts, rooms);
  return EPEstimate.build({ devices: [], posts, product, frameProduct: product, postCost, postComposition,
    lightingOf: po => rowsFor(po, light), settings: { ...settings, discountPercent: 0, workPercent: 0, materialsPercent: 0, vatPercent: 0 } }).equipment;
}
const eur = n => Number(n.toFixed(2));

/* ─── СТЕНД настоящего pastePosts (вырезка из app.js) на реальном каталоге ─── */
const CUT = ["frameCollectionList", "frameFacingList", "frameStandardList", "frameFacingLabels",
  "frameFacingSelectionLabels", "templateMechSeries", "frameSwapEmptyText", "roomCatalogFilter",
  "frameFitsTemplateMechs", "preferOwnFrame", "frameForRoomPlacement", "copyPosts", "pastePosts"];
function makeStand({ posts, rooms, pointer }) {
  const state = { posts, rooms: rooms || [], devices: [], selected: null };
  const roomAt = x => state.rooms.find(r => x >= r.x0 && x < r.x1) || null;
  const recalc = () => state.posts.forEach(p => { const r = roomAt(p.x + 12); p.roomId = r ? r.id : null; });
  let n = 0; const toasts = [];
  let ptr = pointer || { overCanvas: false, clientX: 0, clientY: 0 };
  const ctx = {
    _copyBuffer: null, state,
    EPPostCopy, EPPosts, EPLightingGroups, EPSelection, EPCatalog, EPRoom,
    byKind, frameProduct: product, product,
    compatibleMechanisms: EPCatalog.compatibleMechanisms, productSeries: EPCatalog.productSeries,
    frameSlotCount: EPCatalog.frameSlotCount, moduleWord: EPCatalog.moduleWord, mechanismSpan: EPCatalog.mechanismSpan,
    uid: p => p + "g" + (++n),
    clientToWorld: (x, y) => ({ x, y }),
    canvasPointer: () => ptr,
    getRoomForPoint: x => (state.rooms.length ? roomAt(x) : null),
    renderAll: recalc, renderSummary: () => {}, renderProperties: () => {},
    toast: m => toasts.push(m)
  };
  stand.run(CUT, ctx);
  recalc();
  return {
    state, toasts, ctx,
    copy: ids => { state.selected = EPSelection.normalize(ids, state.posts.map(p => p.id)); ctx.copyPosts(); },
    paste: pt => { ptr = pt ? { overCanvas: true, clientX: pt.x, clientY: pt.y } : { overCanvas: false, clientX: 0, clientY: 0 }; ctx.pastePosts(); }
  };
}

/* Пост «Свет»: накладка 21653.01 + 3×20021.B. Один в проекте = выключатель 20001.0 → 151.88 €;
   два с одним именем в одном месте = переключатели 20005.0 → 157.41 € каждый (это и есть дефект,
   которого у копии быть не должно, когда она села на то же место, что исходный). */
const FRAME = byCode("21653.01");
const KEY = byCode("20021.B");
function svetPost(id, number, x, groups) {
  return { id, number, x, y: 100, roomId: null, name: "Пост", frameId: FRAME.id,
    mechanismIds: [KEY.id, KEY.id, KEY.id], keyGroups: groups.slice(),
    keyCrossNumbers: ["", "", ""], keyMechanisms: ["", "", ""] };
}

test("каталог: контрольные артикулы на месте", () => {
  assert.ok(FRAME, "накладка 21653.01");
  assert.ok(KEY, "клавиша 20021.B");
  assert.equal(eur(postTotalCost(svetPost("s", 1, 100, ["Свет", "", ""]), lightingFor([svetPost("s", 1, 100, ["Свет", "", ""])], []))), 151.88, "одиночный «Свет» = 151.88 €");
});

test("(а) комнат НЕТ: копия «Свет» на то же место → исходный 151.88, копия 151.88, +151.88 (не 162.94)", () => {
  const w = makeStand({ posts: [svetPost("src", 1, 100, ["Свет", "", ""])], rooms: [] });
  const before = equipmentOf(w.state.posts, w.state.rooms);
  w.copy(["src"]);
  w.paste({ x: 300, y: 112 });
  assert.equal(w.state.posts.length, 2, "копия вставлена");
  const light = lightingFor(w.state.posts, w.state.rooms);
  const src = w.state.posts[0], copy = w.state.posts[1];
  assert.deepEqual(copy.keyGroups, ["", "", ""], "имя у копии снято");
  assert.equal(eur(postTotalCost(src, light)), 151.88, "исходный остался 151.88 € (не 157.41)");
  assert.equal(eur(postTotalCost(copy, light)), 151.88, "копия 151.88 €");
  assert.equal(eur(equipmentOf(w.state.posts, w.state.rooms) - before), 151.88, "смета выросла на 151.88 € (а не 162.94)");
});

test("(б) та же комната: копия «Свет» рядом с исходным → то же, +151.88", () => {
  const rooms = [{ id: "A", name: "101", x0: 0, x1: 1000 }];
  const w = makeStand({ posts: [svetPost("src", 1, 100, ["Свет", "", ""])], rooms });
  const before = equipmentOf(w.state.posts, w.state.rooms);
  w.copy(["src"]);
  w.paste({ x: 400, y: 112 });
  const light = lightingFor(w.state.posts, w.state.rooms);
  const src = w.state.posts[0], copy = w.state.posts[1];
  assert.equal(copy.roomId, "A", "копия в той же комнате");
  assert.deepEqual(copy.keyGroups, ["", "", ""], "имя снято — то же место");
  assert.equal(eur(postTotalCost(src, light)), 151.88, "исходный цел");
  assert.equal(eur(equipmentOf(w.state.posts, w.state.rooms) - before), 151.88);
});

test("(в) другая комната: имя у копии СОХРАНЕНО, +151.88, исходный цел", () => {
  const rooms = [{ id: "A", name: "101", x0: 0, x1: 500 }, { id: "B", name: "102", x0: 500, x1: 1000 }];
  const w = makeStand({ posts: [svetPost("src", 1, 100, ["Свет", "", ""])], rooms });
  const before = equipmentOf(w.state.posts, w.state.rooms);
  w.copy(["src"]);
  w.paste({ x: 700, y: 112 });
  const light = lightingFor(w.state.posts, w.state.rooms);
  const src = w.state.posts[0], copy = w.state.posts[1];
  assert.equal(copy.roomId, "B", "копия в соседней комнате");
  assert.deepEqual(copy.keyGroups, ["Свет", "", ""], "имя сохранено (другое место)");
  assert.equal(eur(postTotalCost(src, light)), 151.88, "исходный цел");
  assert.equal(eur(postTotalCost(copy, light)), 151.88, "копия 151.88 (одна в своей комнате)");
  assert.equal(eur(equipmentOf(w.state.posts, w.state.rooms) - before), 151.88);
});

test("(г) пара «Свет» (157.41+157.41) в ДРУГУЮ комнату → копии остаются парой 157.41+157.41, имена целы", () => {
  const rooms = [{ id: "A", name: "101", x0: 0, x1: 500 }, { id: "B", name: "102", x0: 500, x1: 1000 }];
  const w = makeStand({ posts: [svetPost("p1", 1, 100, ["Свет", "", ""]), svetPost("p2", 2, 200, ["Свет", "", ""])], rooms });
  const lightBefore = lightingFor(w.state.posts, w.state.rooms);
  assert.equal(eur(postTotalCost(w.state.posts[0], lightBefore)), 157.41, "исходная пара — переключатели 157.41");
  w.copy(["p1", "p2"]);
  w.paste({ x: 700, y: 112 });
  const light = lightingFor(w.state.posts, w.state.rooms);
  const copies = w.state.posts.slice(2);
  assert.equal(copies.length, 2, "обе копии вставлены");
  copies.forEach(c => { assert.equal(c.roomId, "B"); assert.deepEqual(c.keyGroups, ["Свет", "", ""], "имя цело"); });
  copies.forEach(c => assert.equal(eur(postTotalCost(c, light)), 157.41, "копия — переключатель 157.41 (пара между собой)"));
});

test("(д) та же пара в ТУ ЖЕ комнату → исходные 157.41+157.41 не изменились, у копий имён нет", () => {
  const rooms = [{ id: "A", name: "101", x0: 0, x1: 1000 }];
  const w = makeStand({ posts: [svetPost("p1", 1, 100, ["Свет", "", ""]), svetPost("p2", 2, 200, ["Свет", "", ""])], rooms });
  w.copy(["p1", "p2"]);
  w.paste({ x: 500, y: 112 });
  const light = lightingFor(w.state.posts, w.state.rooms);
  const src = w.state.posts.slice(0, 2), copies = w.state.posts.slice(2);
  src.forEach(p => assert.equal(eur(postTotalCost(p, light)), 157.41, "исходные переключатели не изменились"));
  copies.forEach(c => assert.deepEqual(c.keyGroups, ["", "", ""], "у копий имён нет"));
});

test("(е) пара «Свет» из комнаты → копии ВНЕ комнат остаются парой (копии пачки не «уже стоящие»)", () => {
  /* Исходные p1,p2 с именем «Свет» в комнате A. Копии садятся ВНЕ комнат (другое место, чем A) → имя
     должно сохраниться, и копии образуют СВОЮ пару (157.41 каждая). Если бы правило считало копии одной
     пачки «уже стоящими» (живая ссылка на state.posts вместо снимка до вставки), копии слиплись бы между
     собой на месте «вне комнат» и имя у них бы снялось — пара распалась бы на два выключателя. */
  const rooms = [{ id: "A", name: "101", x0: 0, x1: 500 }];
  const w = makeStand({ posts: [svetPost("p1", 1, 100, ["Свет", "", ""]), svetPost("p2", 2, 300, ["Свет", "", ""])], rooms });
  w.copy(["p1", "p2"]);
  w.paste({ x: 800, y: 112 });   /* точка вне комнаты A ([0,500)) → копии вне комнат */
  const copies = w.state.posts.slice(2);
  assert.equal(copies.length, 2, "обе копии вставлены");
  copies.forEach(c => assert.equal(c.roomId, null, "копии вне комнат (место, отличное от A)"));
  const light = lightingFor(w.state.posts, w.state.rooms);
  copies.forEach(c => assert.deepEqual(c.keyGroups, ["Свет", "", ""], "имя цело — другое место, чем исходные"));
  copies.forEach(c => assert.equal(eur(postTotalCost(c, light)), 157.41, "копии — пара между собой 157.41"));
});

/* ЗАБЛОКИРОВАННАЯ копия в перечень снятых имён НЕ попадает: правило применяется только к реально
   вставленным. Две копии «Свет»: одна садится в свою серию (вставлена, в своей комнате её имя снято
   верно), вторая — в комнату чужой серии (Arke) → несобираемо → заблокирована. В перечне должна быть
   ТОЛЬКО вставленная. */
test("заблокированная копия НЕ попадает в перечень снятых имён (правило только для вставленных)", () => {
  const F = byCode("09673.01"), mech = byCode("09001");   /* Neve Up 3М */
  assert.ok(F && mech, "контрольные артикулы Neve Up на месте");
  const rooms = [{ id: "A", name: "101", x0: 0, x1: 500, collection: "Neve Up", frameColor: "Белая" },
    { id: "B", name: "102", x0: 500, x1: 1000, collection: "Arke", frameColor: "Белая" }];
  const mk = (id, x) => ({ id, number: id === "p1" ? 1 : id === "p2" ? 2 : 3, x, y: 100, roomId: null, name: id,
    frameId: F.id, mechanismIds: [mech.id, mech.id, mech.id], keyGroups: ["Свет", "", ""],
    keyCrossNumbers: ["", "", ""], keyMechanisms: ["", "", ""] });
  /* Источники p1,p2 в комнате A (своя серия), x=100 и 400 → центр группы 262, разлёт ±150. Уже стоящий
     пост standB в комнате B с тем же именем — чтобы у заблокированной копии БЫЛО с чем слиться (если бы
     правило её ошибочно взяло). */
  const w = makeStand({ posts: [mk("p1", 100), mk("p2", 400), mk("standB", 800)], rooms });
  w.copy(["p1", "p2"]);
  /* Точка 562: копии лягут в 400 (комната A, вставится) и 700 (комната B Arke — несобираемо, блок). */
  w.paste({ x: 562, y: 112 });
  const placedCopies = w.state.posts.filter(p => p.id.indexOf("g") >= 0);
  assert.equal(placedCopies.length, 1, "вставлена ровно одна копия (вторая заблокирована в чужой серии)");
  const cleared = w.ctx._lastPasteClearedNames || [];
  assert.equal(cleared.length, 1, "в перечне только ВСТАВЛЕННАЯ копия — заблокированная туда не попала");
  assert.equal(placedCopies[0].roomId, "A", "вставленная копия — в своей комнате A");
  assert.deepEqual(placedCopies[0].keyGroups, ["", "", ""], "у вставленной копии имя снято (в A уже стоят p1/p2 «Свет»)");
});
