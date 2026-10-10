/* Копирование постов (Б9) — ПОВЕДЕНЧЕСКАЯ проводка pastePosts на НАСТОЯЩЕМ frameForRoomPlacement,
   НАСТОЯЩЕМ отборе комнаты (getRoomForPoint по координатам) и НАСТОЯЩЕМ каталоге VIMAR.

   Зачем отдельный файл. В postCopyPaste.test.js frameForRoomPlacement и getRoomForPoint — КОНСТАНТНЫЕ
   стабы, поэтому денежный дефект «копия в комнату той же отделки получает ДРУГУЮ накладку» там не ловился
   (находка состязательной проверки 10.10). Здесь всё по-настоящему: подмена накладки под комнату идёт
   через реальный frameForRoomPlacement, а комната копии вычисляется из её координат реальным getRoomForPoint.
   Жёсткие ожидания — артикул накладки копии и цена накладки (евро прайса). Полную стоимость поста
   (742.88 €, 177.04 € …) считает реальный расчёт — проверена скриптами состязательной проверки adv-b9/*.

   Решение владельца 10.10 (дословно): «Если накладка поста уже подходит комнате — не трогать её. Менять
   только когда не подходит… никогда не ставить накладку, в которую состав не собирается: такой пост
   считать невставленным и сказать об этом».
   Запуск: node --test tests/postCopyPlacement.test.js */
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
const EPSelection = require("../js/selection.js");
const EPCatalog = require("../js/catalog.js");
const EPRoom = require("../js/room.js");

/* Реальный каталог VIMAR — те же файлы и порядок, что в index.html (catalog-vimar → attrs → data). */
function loadRuntimeProducts() {
  const jsDir = path.join(__dirname, "..", "js");
  const win = {};
  const context = vm.createContext({ window: win, structuredClone });
  for (const file of ["catalog-vimar.js", "catalog-vimar-attrs.js", "data.js"]) {
    vm.runInContext(fs.readFileSync(path.join(jsDir, file), "utf8"), context, { filename: file });
  }
  return win.EP_DATA.products;   /* синхронный источник обогащённых товаров (getProducts() отдаёт Promise) */
}
const PRODUCTS = loadRuntimeProducts();
const product = id => PRODUCTS.find(p => Number(p.id) === Number(id));
const byCode = code => PRODUCTS.find(p => String(p.code) === code);
const byKind = kind => PRODUCTS.filter(p => p.kind === kind && p.active);

/* Отделка комнаты, в точности повторяющая отделку накладки (как у «отеля»: соседний номер той же серии). */
function roomFinishOf(frame) {
  return { collection: EPCatalog.productSeries(frame)[0], frameMaterial: frame.frameMaterial,
    frameShape: frame.frameShape, frameColor: frame.frameColor };
}
/* 1-модульная клавиша серии накладки (контрольная начинка; для сценария «подходит» состав не важен —
   пост всё равно оставляет свою накладку, но валидный пост собрать нужно). */
function key1(frame) {
  const ser = EPCatalog.productSeries(frame)[0];
  return byKind("mechanism").find(m => EPCatalog.productSeries(m).includes(ser) && EPCatalog.mechanismSpan(m) === 1);
}

const CUT = ["frameCollectionList", "frameFacingList", "frameStandardList", "frameFacingLabels",
  "frameFacingSelectionLabels", "templateMechSeries", "frameSwapEmptyText", "roomCatalogFilter",
  "frameFitsTemplateMechs", "preferOwnFrame", "frameForRoomPlacement", "copyPosts", "pastePosts"];

/* Стенд: НАСТОЯЩИЕ copyPosts/pastePosts/frameForRoomPlacement в vm на реальном каталоге. Комнаты —
   вертикальные полосы по x центра значка (как «номера отеля» рядом). clientToWorld по умолчанию
   задаёт СДВИГ экран→мир (+DX), чтобы было видно снятие перевода координат (мутация A3). */
function makeStand({ posts, rooms, pointer, clientDX = 0 }) {
  const state = { posts, rooms: rooms || [], devices: [], selected: null };
  const roomAt = (x) => state.rooms.find(r => x >= r.x0 && x < r.x1) || null;
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
    clientToWorld: (x, y) => ({ x: x - clientDX, y }),
    canvasPointer: () => ptr,
    getRoomForPoint: (x) => (state.rooms.length ? roomAt(x) : null),
    renderAll: recalc, renderSummary: () => {}, renderProperties: () => {},
    toast: m => toasts.push(m)
  };
  stand.run(CUT, ctx);
  recalc();
  return {
    state, toasts,
    copy: ids => { state.selected = EPSelection.normalize(ids, state.posts.map(p => p.id)); ctx.copyPosts(); },
    paste: pt => { ptr = pt ? { overCanvas: true, clientX: pt.x, clientY: pt.y } : { overCanvas: false, clientX: 0, clientY: 0 }; ctx.pastePosts(); }
  };
}

function mkPost(frame, mechIds, x) {
  return { id: "src", number: 1, x, y: 100, roomId: null, name: "Пост", frameId: frame.id,
    mechanismIds: mechIds, keyGroups: mechIds.map(() => ""), keyCrossNumbers: mechIds.map(() => ""), keyMechanisms: mechIds.map(() => "") };
}

/* ─────────── ПУНКТ 1(а): накладка УЖЕ подходит комнате → остаётся ОНА САМА ─────────── */

test("★ копия в соседний номер ТОЙ ЖЕ отделки сохраняет свою накладку (деньги не плывут)", () => {
  /* Накладка Eikon Exe 8М (2+2+2+2), немецкий стандарт, 516.20 €. Соседний номер — та же отделка.
     Раньше копия получала другую накладку (8М сплошная IT, 322.56 €) — пост дешевел на 181 €. */
  const F = byCode("22669.75");
  assert.ok(F, "контрольная накладка 22669.75 есть в каталоге");
  const slots = EPCatalog.frameSlotCount(F);
  const K = key1(F);
  const fin = roomFinishOf(F);
  const rooms = [Object.assign({ id: "A", name: "Номер 101", x0: 0, x1: 500 }, fin),
    Object.assign({ id: "B", name: "Номер 102", x0: 500, x1: 1000 }, fin)];
  const w = makeStand({ posts: [mkPost(F, Array(slots).fill(K.id), 100)], rooms });
  w.copy(["src"]);
  w.paste({ x: 700, y: 112 });
  assert.equal(w.state.posts.length, 2, "копия вставлена");
  const copy = w.state.posts[1];
  assert.equal(product(copy.frameId).code, "22669.75", "накладка копии — ТА ЖЕ (22669.75), не подменена на другую");
  assert.equal(product(copy.frameId).price, 516.2, "цена накладки копии 516.20 € — не упала до 322.56 € (другой артикул)");
  assert.equal(copy.roomId, "B", "копия привязана к соседнему номеру по своим координатам");
});

test("★ копия в ТУ ЖЕ комнату сохраняет свою накладку (подмены на «первую той же модульности» нет)", () => {
  const F = byCode("14652.24");   /* Plana 2М центрально, золото блестящее, IT, 50.49 € */
  const K = key1(F), slots = EPCatalog.frameSlotCount(F), fin = roomFinishOf(F);
  const rooms = [Object.assign({ id: "A", name: "Номер 101", x0: 0, x1: 1000 }, fin)];
  const w = makeStand({ posts: [mkPost(F, Array(slots).fill(K.id), 100)], rooms });
  w.copy(["src"]);
  w.paste({ x: 300, y: 112 });
  const copy = w.state.posts[1];
  assert.equal(product(copy.frameId).code, "14652.24", "в своей же комнате накладка копии не меняется");
  assert.equal(product(copy.frameId).price, 50.49, "цена накладки 50.49 € сохранена");
});

/* ─────────── ПУНКТ 1(б): не подходит → подмена, как и раньше ─────────── */

test("★ копия в комнату своей серии ДРУГОГО цвета → накладка меняется на цвет комнаты (подмена работает)", () => {
  /* Neve Up белая 3М → комната Neve Up «Слоновая кость»: накладка обязана смениться на артикул того же
     ряда цвета комнаты (прежнее поведение подмены, его ломать нельзя). */
  const F = byCode("09673.01"), mech = byCode("09001");
  assert.ok(F && mech, "контрольные артикулы Neve Up найдены");
  const rooms = [{ id: "A", name: "Белая", x0: 0, x1: 500, collection: "Neve Up", frameColor: "Белая" },
    { id: "B", name: "Слоновая", x0: 500, x1: 1000, collection: "Neve Up", frameColor: "Слоновая кость" }];
  const w = makeStand({ posts: [mkPost(F, [mech.id, mech.id, mech.id], 100)], rooms });
  w.copy(["src"]);
  w.paste({ x: 700, y: 112 });
  const copy = w.state.posts[1], nf = product(copy.frameId);
  assert.notEqual(copy.frameId, F.id, "накладка подменена (комната другого цвета)");
  assert.equal(nf.frameColor, "Слоновая кость", "накладка копии — цвета комнаты");
  assert.ok(EPCatalog.productSeries(nf).includes("Neve Up"), "и своей серии Neve Up");
  assert.equal(EPCatalog.frameSlotCount(nf), 3, "той же модульности (3М)");
});

/* ─────────── ПУНКТ 1: единственный кандидат не собирается / комната чужой серии → копия НЕ вставлена ──
   Этот же сценарий ЗАКРЫВАЕТ три пережившие мутации проводки pastePosts (состязательная проверка 10.10):
   комната копии должна считаться по ЦЕНТРУ её значка, из её СОБСТВЕННЫХ координат, через clientToWorld.
   Точку вставки ставим на ГРАНИЦУ номеров: центр значка копии попадает в «блокирующий» номер (102),
   а угол значка / координаты буфера / непереведённые экранные координаты — мимо него (в номер 101 той же
   серии → накладка осталась бы → копия вставилась бы). Поэтому «копия НЕ вставлена» краснит сразу три
   мутации: getRoomForPoint по углу (copy.x), по координатам буфера, и без clientToWorld. */

test("★ копия в номер чужой серии (несобираемо) НЕ вставлена; комната считается по центру её значка через clientToWorld", () => {
  const F = byCode("09673.01"), mech = byCode("09001");
  const clientDX = 1000;
  /* Номер 101 [0,500) — Neve Up (своя серия, накладка осталась бы). Номер 102 [500,1000) — Arke: клавиши
     Neve Up в накладку Arke по правилу конструктора не встают → подмена невозможна → blocked. */
  const rooms = [{ id: "A", name: "Номер 101", x0: 0, x1: 500, collection: "Neve Up", frameColor: "Белая" },
    { id: "B", name: "Номер 102", x0: 500, x1: 1000, collection: "Arke", frameColor: "Белая" }];
  /* Исходный пост в номере 101 (центр 112). Вставка: экранный x=1500 → мир 500 (clientDX=1000). Центр
     значка одиночной копии ложится ровно в 500 → номер 102; угол значка = 488 → номер 101. */
  const w = makeStand({ posts: [mkPost(F, [mech.id, mech.id, mech.id], 100)], rooms, clientDX });
  w.copy(["src"]);
  w.paste({ x: 1500, y: 112 });
  assert.equal(w.state.posts.length, 1, "копия НЕ вставлена: в номере 102 (Arke) состав не собирается — пост считается невставленным");
  const msg = w.toasts.join(" | ");
  assert.match(msg, /Ничего не вставлено|не вставлен/, "человеку сказано, что копия не вставлена (прежний текст причины)");
  /* Контроль: сдвинь вставку целиком в номер 101 (своя серия) — там копия вставляется и сохраняет накладку. */
  const w2 = makeStand({ posts: [mkPost(F, [mech.id, mech.id, mech.id], 100)], rooms, clientDX });
  w2.copy(["src"]);
  w2.paste({ x: 1300, y: 112 });   /* мир 300 → номер 101 */
  assert.equal(w2.state.posts.length, 2, "в своём номере (101) копия вставляется");
  assert.equal(product(w2.state.posts[1].frameId).code, "09673.01", "и сохраняет свою накладку");
});
