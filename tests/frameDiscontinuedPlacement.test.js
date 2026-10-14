/* В23 — НАКЛАДКА, СНЯТАЯ С ПРОИЗВОДСТВА, при копировании (Ctrl+V) и «Разместить». Поведенческая
   проводка НАСТОЯЩИХ frameForRoomPlacement / copyPosts / pastePosts в vm на реальном каталоге VIMAR
   (тот же стенд, что postCopyPlacement.test.js). «Снята» моделируем искусственно — product.active=false
   (единственный источник признака в рантайме; в прайсе сейчас все 2146 активны, дефект «спит»).

   Утверждённая владельцем фраза (13.10): «Накладка, снятая с производства, остаётся в посте при
   копировании и при „Разместить“, если её отделка подходит комнате, и помечена „снята с производства“».
   Решения владельца (13.10): (1) снятая, отделка которой НЕ подходит, меняется на подходящую активную,
   как обычная; (2) значение отделки комнаты, оставшееся только у снятых, комната СОХРАНЯЕТ; снятая
   накладка новым постам НЕ предлагается.

   Деньги проверяем по АРТИКУЛУ и ЦЕНЕ накладки копии (евро прайса) — та же мера, что в
   postCopyPlacement.test.js: разница цены накладки (50.49 → 38.49 = 15.96 €) и есть разница поста
   (82.18 → 66.22 €), полную стоимость поста считает реальный расчёт (проверен в adv-b9/*).
   Запуск: node --test tests/frameDiscontinuedPlacement.test.js */
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
const EPNotices = require("../js/notices.js");

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

/* Выполнить fn, пока накладка code искусственно снята (active=false); вернуть active как было. PRODUCTS
   общий на весь файл — без восстановления снятие утекло бы в соседние тесты. */
function withDiscontinued(code, fn) {
  const p = byCode(code);
  assert.ok(p, "контрольная накладка " + code + " есть в каталоге");
  const prev = p.active;
  p.active = false;
  try { return fn(p); } finally { p.active = prev; }
}

function roomFinishOf(frame) {
  return { collection: EPCatalog.productSeries(frame)[0], frameMaterial: frame.frameMaterial,
    frameShape: frame.frameShape, frameColor: frame.frameColor };
}
/* 1-модульная клавиша серии накладки (контрольная начинка). */
function key1(frame) {
  const ser = EPCatalog.productSeries(frame)[0];
  return byKind("mechanism").find(m => EPCatalog.productSeries(m).includes(ser) && EPCatalog.mechanismSpan(m) === 1);
}

const CUT = ["frameCollectionList", "frameFacingList", "frameStandardList", "frameFacingLabels",
  "frameFacingSelectionLabels", "templateMechSeries", "frameSwapEmptyText", "roomCatalogFilter",
  "frameFitsTemplateMechs", "preferOwnFrame", "frameForRoomPlacement", "copyPosts", "pastePosts"];
/* Для прямого вызова frameForRoomPlacement («Разместить»): те же функции, но возвращаем её саму. */
const PLACE_CUT = CUT.slice(0, CUT.indexOf("copyPosts"));

function makeStand({ posts, rooms, pointer }) {
  const state = { posts, rooms: rooms || [], devices: [], selected: null };
  const roomAt = (x) => state.rooms.find(r => x >= r.x0 && x < r.x1) || null;
  const recalc = () => state.posts.forEach(p => { const r = roomAt(p.x + 12); p.roomId = r ? r.id : null; });
  let n = 0; const toasts = [];
  const notices = { calls: [], show(kind, text, pruneWhen) { this.calls.push({ kind, text, pruneWhen }); }, dismiss() {}, prune() {} };
  let ptr = pointer || { overCanvas: false, clientX: 0, clientY: 0 };
  const ctx = {
    _copyBuffer: null, state, EPNotices, notices,
    EPPostCopy, EPPosts, EPLightingGroups, EPSelection, EPCatalog, EPRoom,
    byKind, frameProduct: product, product,
    compatibleMechanisms: EPCatalog.compatibleMechanisms, productSeries: EPCatalog.productSeries,
    frameSlotCount: EPCatalog.frameSlotCount, moduleWord: EPCatalog.moduleWord, mechanismSpan: EPCatalog.mechanismSpan,
    uid: p => p + "g" + (++n),
    clientToWorld: (x, y) => ({ x, y }),
    canvasPointer: () => ptr,
    getRoomForPoint: (x) => (state.rooms.length ? roomAt(x) : null),
    renderAll: recalc, renderSummary: () => {}, renderProperties: () => {},
    toast: m => toasts.push(m)
  };
  const place = stand.run(PLACE_CUT, ctx);   /* возвращает frameForRoomPlacement (чистая, без вставки) */
  stand.run(CUT, ctx);                        /* доопределяет copyPosts/pastePosts в том же контексте */
  recalc();
  return {
    state, toasts, notices, place,
    copy: ids => { state.selected = EPSelection.normalize(ids, state.posts.map(p => p.id)); ctx.copyPosts(); },
    paste: pt => { ptr = pt ? { overCanvas: true, clientX: pt.x, clientY: pt.y } : { overCanvas: false, clientX: 0, clientY: 0 }; ctx.pastePosts(); }
  };
}

function mkPost(frame, mechIds, x) {
  return { id: "src", number: 1, x, y: 100, roomId: null, name: "Пост", frameId: frame.id,
    mechanismIds: mechIds, keyGroups: mechIds.map(() => ""), keyCrossNumbers: mechIds.map(() => ""), keyMechanisms: mechIds.map(() => "") };
}
/* Пост-шаблон со снятой накладкой в комнате той же/другой отделки; возвращает исходный пост и клавиши. */
function postOf(frame) {
  const slots = EPCatalog.frameSlotCount(frame);
  const K = key1(frame);
  assert.ok(K, "нашлась 1М клавиша серии накладки " + frame.code);
  return mkPost(frame, Array(slots).fill(K.id), 100);
}

/* ─────────── (а) снята, комната ТОЙ ЖЕ отделки → остаётся она сама, цена не падает ─────────── */

test("(а) Ctrl+V: снятая 14652.24 в комнату той же отделки остаётся 14652.24 (50.49 €, не 14642.24 38.49 €)", () => {
  withDiscontinued("14652.24", F => {
    const fin = roomFinishOf(F);
    const rooms = [Object.assign({ id: "A", name: "Номер 101", x0: 0, x1: 500 }, fin),
      Object.assign({ id: "B", name: "Номер 102", x0: 500, x1: 1000 }, fin)];
    const w = makeStand({ posts: [postOf(F)], rooms });
    w.copy(["src"]); w.paste({ x: 700, y: 112 });
    assert.equal(w.state.posts.length, 2, "копия вставлена");
    const nf = product(w.state.posts[1].frameId);
    assert.equal(nf.code, "14652.24", "накладка копии — та же снятая 14652.24, не подменена");
    assert.equal(nf.price, 50.49, "цена накладки 50.49 € (пост 82.18 €), не упала до 38.49 € (пост 66.22 €)");
  });
});

test("(а/Разместить) frameForRoomPlacement: снятая 14652.24 в комнату той же отделки НЕ меняется", () => {
  withDiscontinued("14652.24", F => {
    const w = makeStand({ posts: [], rooms: [] });
    const room = Object.assign({ id: "R" }, roomFinishOf(F));
    assert.equal(w.place(postOf(F), room).frameId, null, "накладку не трогаем — уже подходит комнате");
  });
});

/* ─────────── (б) снята, полная отделка комнаты → пост ВСТАВЛЯЕТСЯ с той же накладкой ─────────── */

test("(б) Ctrl+V: снятая 14653.01 в комнату полной отделки ВСТАВЛЯЕТСЯ с 14653.01 (5.86 €), а не «не нашлось накладки»", () => {
  withDiscontinued("14653.01", F => {
    const fin = roomFinishOf(F);
    const rooms = [Object.assign({ id: "A", name: "Номер 101", x0: 0, x1: 500 }, fin),
      Object.assign({ id: "B", name: "Номер 102", x0: 500, x1: 1000 }, fin)];
    const w = makeStand({ posts: [postOf(F)], rooms });
    w.copy(["src"]); w.paste({ x: 700, y: 112 });
    assert.equal(w.state.posts.length, 2, "копия вставлена (не «Ничего не вставлено… не нашлось накладки на 3 модуля»)");
    const nf = product(w.state.posts[1].frameId);
    assert.equal(nf.code, "14653.01", "накладка копии — та же снятая 14653.01");
    assert.equal(nf.price, 5.86, "цена 5.86 € (пост 44.25 €)");
  });
});

test("(б/Разместить) frameForRoomPlacement: снятая 14653.01 в комнату полной отделки НЕ блокируется", () => {
  withDiscontinued("14653.01", F => {
    const w = makeStand({ posts: [], rooms: [] });
    const room = Object.assign({ id: "R" }, roomFinishOf(F));
    assert.equal(w.place(postOf(F), room).frameId, null, "накладку не трогаем — уже подходит; пост размещается");
  });
});

/* ─────────── (в) снята, комната «только серия» → остаётся она сама (не соседний цвет) ─────────── */

test("(в) Ctrl+V: снятая 14653.01 в комнату «только серия Plana» остаётся 14653.01, не 14653.02 (Слоновая кость)", () => {
  withDiscontinued("14653.01", F => {
    const rooms = [{ id: "A", name: "Номер 101", x0: 0, x1: 500, collection: "Plana" },
      { id: "B", name: "Номер 102", x0: 500, x1: 1000, collection: "Plana" }];
    const w = makeStand({ posts: [postOf(F)], rooms });
    w.copy(["src"]); w.paste({ x: 700, y: 112 });
    assert.equal(w.state.posts.length, 2, "копия вставлена");
    assert.equal(product(w.state.posts[1].frameId).code, "14653.01", "серия совпала — накладка остаётся, цвет не сменился на Слоновую кость");
  });
});

/* ─────────── (г) снята, отделка НЕ подходит → меняется на подходящую активную (как обычная) ─────────── */

test("(г) Ctrl+V: снятая 14652.24 (золото) в комнату Plana «Белая» меняется на активную белую 14642.01 — как активная", () => {
  const expectWhite = w => {
    const nf = product(w.state.posts[1].frameId);
    assert.equal(nf.code, "14642.01", "подменена на активную белую Plana 2М 14642.01");
    assert.equal(nf.price, 6.39, "цена активной накладки 6.39 €");
  };
  const rooms = () => [{ id: "A", name: "Номер 101", x0: 0, x1: 500, collection: "Plana", frameColor: "Белая" },
    { id: "B", name: "Номер 102", x0: 500, x1: 1000, collection: "Plana", frameColor: "Белая" }];
  /* Снятая 14652.24 (золото) должна меняться ТОЧНО так же, как активная 14652.24. */
  const F = byCode("14652.24");
  const wActive = makeStand({ posts: [postOf(F)], rooms: rooms() });
  wActive.copy(["src"]); wActive.paste({ x: 700, y: 112 });
  expectWhite(wActive);
  withDiscontinued("14652.24", Fd => {
    const wDisc = makeStand({ posts: [postOf(Fd)], rooms: rooms() });
    wDisc.copy(["src"]); wDisc.paste({ x: 700, y: 112 });
    expectWhite(wDisc);
  });
});

test("(г/Разместить) frameForRoomPlacement: снятая 14652.24 в комнату Plana «Белая» → активная 14642.01", () => {
  withDiscontinued("14652.24", F => {
    const w = makeStand({ posts: [], rooms: [] });
    const res = w.place(postOf(F), { id: "R", collection: "Plana", frameColor: "Белая" });
    assert.ok(res.frameId != null, "накладка подменена (отделка не подходит)");
    assert.equal(product(res.frameId).code, "14642.01", "на активную белую Plana 2М");
  });
});

/* ─────────── (е) снята и ЕДИНСТВЕННАЯ своего цвета; комната «серия + этот цвет» → пост остаётся ─────────── */

test("(е) Ctrl+V: снятая 19653.66 (Arke, «Reflexт Лед») в комнату «Arke + этот цвет» остаётся 19653.66 (12.29 €), не уходит в 14943 (20.71 €)", () => {
  withDiscontinued("19653.66", F => {
    const color = F.frameColor;   /* «Reflexт Лед» — единственная накладка этого цвета в каталоге */
    const rooms = [{ id: "A", name: "Номер 101", x0: 0, x1: 500, collection: "Arke", frameColor: color },
      { id: "B", name: "Номер 102", x0: 500, x1: 1000, collection: "Arke", frameColor: color }];
    const w = makeStand({ posts: [postOf(F)], rooms });
    w.copy(["src"]); w.paste({ x: 700, y: 112 });
    assert.equal(w.state.posts.length, 2, "копия вставлена");
    const nf = product(w.state.posts[1].frameId);
    assert.equal(nf.code, "19653.66", "накладка копии — та же снятая 19653.66, цвет комнаты не обнулился");
    assert.equal(nf.price, 12.29, "цена 12.29 €, пост не уходит молча в серую влагостойкую 14943 (20.71 €)");
  });
});

test("(е/Разместить) frameForRoomPlacement: снятая 19653.66 в комнату «Arke + её цвет» НЕ меняется", () => {
  withDiscontinued("19653.66", F => {
    const w = makeStand({ posts: [], rooms: [] });
    const res = w.place(postOf(F), { id: "R", collection: "Arke", frameColor: F.frameColor });
    assert.equal(res.frameId, null, "накладку не трогаем — пост своей серии и цвета остаётся");
  });
});

/* ─────────── Контроль: активная подходящая накладка по-прежнему остаётся (денежные дефекты блока) ─────────── */

test("контроль: АКТИВНАЯ 22669.75 в соседний номер той же отделки остаётся (516.20 €, регресс блока копирования не вернулся)", () => {
  const F = byCode("22669.75");
  const fin = roomFinishOf(F);
  const rooms = [Object.assign({ id: "A", name: "Номер 101", x0: 0, x1: 500 }, fin),
    Object.assign({ id: "B", name: "Номер 102", x0: 500, x1: 1000 }, fin)];
  const w = makeStand({ posts: [postOf(F)], rooms });
  w.copy(["src"]); w.paste({ x: 700, y: 112 });
  assert.equal(product(w.state.posts[1].frameId).code, "22669.75", "активная подходящая накладка не подменена");
  assert.equal(product(w.state.posts[1].frameId).price, 516.2, "цена 516.20 € сохранена");
});

/* ─────────── (пометка) копия со снятой накладкой помечается «снята с производства» ───────────
   Новых надписей не добавляем: пометку даёт ЕДИНЫЙ EPPosts.frameAvailability (одна формулировка на
   подсказку плана, окно поста, спецификацию и КП). Раз копия сохраняет снятый frameId, пометка
   появляется у неё автоматически — тест закрепляет, что это именно снятая (discontinued), а не
   пропавшая (missing), и что текст тот же. */

test("(пометка) у вставленной копии со снятой накладкой frameAvailability = «снята с производства» (единый источник, без новых надписей)", () => {
  withDiscontinued("14652.24", F => {
    const fin = roomFinishOf(F);
    const rooms = [Object.assign({ id: "A", name: "Номер 101", x0: 0, x1: 500 }, fin),
      Object.assign({ id: "B", name: "Номер 102", x0: 500, x1: 1000 }, fin)];
    const w = makeStand({ posts: [postOf(F)], rooms });
    w.copy(["src"]); w.paste({ x: 700, y: 112 });
    const copy = w.state.posts[1];
    const av = EPPosts.frameAvailability(copy.frameId, product(copy.frameId));
    assert.equal(av.state, "discontinued", "состояние накладки копии — снята с производства (не missing)");
    assert.equal(av.discontinued, true);
    assert.equal(av.statusText, "снята с производства");
    assert.match(av.displayName, /\(снята с производства\)$/, "имя во всех документах несёт пометку");
    assert.equal(av.blocksDocuments, false, "снятая накладка документ НЕ блокирует — считается по своей цене");
  });
});
