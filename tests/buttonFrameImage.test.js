/* РИСУНОК кнопочной накладки Flat (К12 ч.4, переделка по словам заказчика 15.10). Двойная плоская
   клавиша 22751 в накладке «на 4 кнопки» (22684.4) занимает ОДНУ прорезь (как 1-модульный механизм),
   но рисуется не всем лицом (две кнопки), а ОДНОЙ кнопкой — ВЕРХНЕЙ половиной лица, обрезанной и
   заполняющей прорезь (слова заказчика «обрезать картинку, оставить одну клавишу»). Проверяем ПРАВИЛО
   раскладки (чистый EPButtonFrame: порядок прорезей, доли лица, слоты ячейки) и ЕГО ПРОВОДКУ через
   настоящий assembledPostSpec из app.js + EPPostImage.postWindows (одна сборка картинки для окна поста,
   холста, КП и листа монтажника). Каталог — НАСТОЯЩИЙ, обогащённый data.js (окна/лица), как в
   index.html. Запуск: node --test tests/ */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");

const EPCatalog = require("../js/catalog.js");
const EPPosts = require("../js/posts.js");
const EPEstimate = require("../js/estimate.js");
const EPPostImage = require("../js/postImage.js");
const EPButtonFrame = require("../js/buttonFrame.js");

/* Обогащённый рантайм-каталог (окна mountRects + лица faceRect подмешивает data.js). */
const JS_DIR = path.join(__dirname, "..", "js");
const FILES = ["catalog-vimar.js", "catalog-vimar-attrs.js", "catalog-vimar-openings.js", "catalog-vimar-faces.js", "data.js"];
async function loadRuntimeProducts() {
  const win = {};
  const context = vm.createContext({ window: win, structuredClone });
  for (const file of FILES) vm.runInContext(fs.readFileSync(path.join(JS_DIR, file), "utf8"), context, { filename: file });
  return win.DataService.getProducts();
}

/* Настоящий assembledPostSpec из app.js: тот же шов spanForFrame и тот же EPButtonFrame, что в
   браузере. lightRows пусты — замены цельных изделий нет, предмет только раскладка по прорезям. */
function makeSpecBuilder(products) {
  const product = id => products.find(p => Number(p.id) === Number(id));
  const spanForFrame = frame => item => EPButtonFrame.spanIn(item, frame, EPCatalog.mechanismSpan(item));
  const ctx = {
    product, frameProduct: product, EPPosts, EPEstimate, EPButtonFrame, spanForFrame,
    lightingRowsFor: () => [], projectLighting: () => null,
    mechanismSpan: EPCatalog.mechanismSpan,
    productImage: EPCatalog.productImage, moduleFace: EPCatalog.moduleFace,
    frameSlotCount: EPCatalog.frameSlotCount, frameOpening: EPCatalog.frameOpening, frameOpenings: EPCatalog.frameOpenings,
    EPOfferOptions: { itemText: name => name },
    Map, Array, Number, String
  };
  const run = stand.run("assembledPostSpec", ctx);
  return (post, opts) => run(post, opts || { size: "lg", articles: true });
}

const flatCells = rows => rows.flatMap(r => r.posts.flatMap(p => p.cells));

/* ───────── ЧИСТОЕ ПРАВИЛО EPButtonFrame ───────── */

test("appliesTo: 22684.4 (4 прорези) — да; 22682.1 (1 прорезь) и обычная Eikon — нет", async () => {
  const P = await loadRuntimeProducts();
  const byCode = c => P.find(p => p.code === c);
  assert.equal(EPButtonFrame.appliesTo(byCode("22684.4.11")), true, "кнопочная ≥2 прорезей");
  assert.equal(EPButtonFrame.appliesTo(byCode("22682.1.11")), false, "«на 1 кнопку» не трогаем");
  assert.equal(EPButtonFrame.appliesTo(byCode("09661.01")), false, "обычная накладка Eikon — не кнопочная");
});

test("faceParts: двойная клавиша режется по ГОРИЗОНТАЛИ (кнопки одна над другой) — верх/низ", () => {
  const face = { left: 12.3, top: 7.8, width: 75.4, height: 84.5 };
  const parts = EPButtonFrame.faceParts(face, 2, true);
  assert.equal(parts.length, 2);
  assert.ok(parts[0].top < parts[1].top, "верхняя кнопка выше нижней");
  assert.equal(parts[0].left, parts[1].left, "обе кнопки по ширине совпадают с лицом");
  assert.equal(parts[0].width, parts[1].width);
  assert.equal(parts[0].height, parts[1].height, "равные полосы");
  assert.ok(Math.abs(parts[0].height - face.height / 2) < 0.1, "каждая полоса — половина высоты лица");
  assert.ok(Math.abs(parts[1].top - (face.top + face.height / 2)) < 0.1, "нижняя полоса начинается с середины");
});

test("faceParts: многомодульное лицо режется по ВЕРТИКАЛИ (слева направо)", () => {
  const face = { left: 10, top: 20, width: 80, height: 40 };
  const parts = EPButtonFrame.faceParts(face, 2, false);
  assert.ok(parts[0].left < parts[1].left, "левая доля левее правой");
  assert.equal(parts[0].top, parts[1].top);
  assert.ok(Math.abs(parts[0].width - 40) < 0.1, "каждая доля — половина ширины");
});

test("orderWindows: один ряд → по left; два ряда → верхний ряд целиком раньше нижнего", () => {
  const oneRow = [{ left: 67.5, top: 42 }, { left: 22.5, top: 42 }, { left: 52.5, top: 42 }, { left: 37.5, top: 42 }];
  assert.deepEqual(EPButtonFrame.orderWindows(oneRow).map(w => w.left), [22.5, 37.5, 52.5, 67.5]);
  /* Подставная двухрядная накладка (реальных нет): верхний ряд (top≈20) слева направо, затем нижний. */
  const twoRows = [
    { left: 60, top: 60, height: 15 }, { left: 20, top: 20, height: 15 },
    { left: 60, top: 20, height: 15 }, { left: 20, top: 60, height: 15 }
  ];
  assert.deepEqual(
    EPButtonFrame.orderWindows(twoRows).map(w => [w.left, w.top]),
    [[20, 20], [60, 20], [20, 60], [60, 60]],
    "сверху вниз, внутри ряда слева направо"
  );
});

test("cellSlots: клавиша 22751 в 22684.4 — ОДИН слот (fill), доля лица = верхняя половина; обычный 1М — 1 слот без fill", async () => {
  const P = await loadRuntimeProducts();
  const byCode = c => P.find(p => p.code === c);
  const F4 = byCode("22684.4.11"), KEY = byCode("22751.11");
  const kFace = EPCatalog.moduleFace(KEY);
  const kSlots = EPButtonFrame.cellSlots(KEY, F4, EPCatalog.mechanismSpan(KEY), kFace);
  assert.equal(kSlots.length, 1, "одна клавиша — одна прорезь (переделка 15.10)");
  assert.equal(kSlots[0].fill, true, "кнопка заполняет прорезь");
  assert.ok(kSlots[0].face.top - kFace.top < 0.1, "верхняя кнопка — от верха лица");
  assert.ok(Math.abs(kSlots[0].face.height - kFace.height / 2) < 0.1, "в прорези половина высоты лица (одна из двух кнопок)");

  const m1 = P.find(p => p.kind === "mechanism" && EPCatalog.mechanismSpan(p) === 1 && p.code !== "22751.11" && EPCatalog.moduleFace(p));
  const mFace = EPCatalog.moduleFace(m1);
  const mSlots = EPButtonFrame.cellSlots(m1, F4, 1, mFace);
  assert.equal(mSlots.length, 1, "обычный 1М — одна прорезь");
  assert.equal(mSlots[0].fill, false, "одиночная прорезь — истинная величина, как раньше");
  assert.deepEqual(mSlots[0].face, mFace, "лицо не режется");
});

/* ───────── ПРОВОДКА: assembledPostSpec + postWindows ───────── */

test("окно поста 22684.4 + одна 22751: ячейка-клавиша занимает ОКНО 0 одной прорезью, доля лица верхняя половина", async () => {
  const P = await loadRuntimeProducts();
  const byCode = c => P.find(p => p.code === c);
  const build = makeSpecBuilder(P);
  const F4 = byCode("22684.4.11"), KEY = byCode("22751.11");
  const kFace = EPCatalog.moduleFace(KEY);

  const spec = build({ frameId: F4.id, mechanismIds: [KEY.id] });
  const cells = flatCells(spec.rows);
  const key = cells[0];
  assert.ok(Array.isArray(key.slots) && key.slots.length === 1, "клавиша несёт один слот-прорезь");
  assert.equal(key.num, "1", "подпись модуля клавиши — «1»");
  assert.equal(key.slots[0].fill, true, "кнопка заполняет прорезь");
  assert.ok(Math.abs(key.slots[0].face.height - kFace.height / 2) < 0.1, "в прорези верхняя половина лица");
  /* Прорези 2, 3 и 4 — свободные, по одному слоту. */
  assert.equal(cells.length, 4, "клавиша + 3 свободных модуля (1 прорезь клавиши + 3 пустых = 4 окна)");
  assert.ok(cells.slice(1).every(c => c.empty && c.slots.length === 1), "свободные — по одной прорези");

  const pw = EPPostImage.postWindows(spec.frame.opening, spec.rows, spec.frame.windows);
  assert.equal(pw.perModule, true, "помодульный режим: каждый слот — своё окно");
  assert.equal(pw.rects.length, 4, "четыре окна 22684.4");
  /* окна упорядочены слева направо → клавиша встаёт в самое ЛЕВОЕ (0). */
  assert.deepEqual(pw.rects.map(r => r.left), [22.5, 37.5, 52.5, 67.5], "окна слева направо");
});

test("окно поста 22684.4 + четыре 22751: каждая клавиша в своё окно 0–3, пост полон", async () => {
  const P = await loadRuntimeProducts();
  const byCode = c => P.find(p => p.code === c);
  const build = makeSpecBuilder(P);
  const F4 = byCode("22684.4.11"), KEY = byCode("22751.11");

  const spec = build({ frameId: F4.id, mechanismIds: [KEY.id, KEY.id, KEY.id, KEY.id] });
  const cells = flatCells(spec.rows);
  assert.equal(cells.length, 4, "четыре клавиши, свободных модулей нет");
  /* .join: spec.rows приходит из vm-песочницы app.js (другой realm Array), поэтому сверяем по значению. */
  assert.equal(cells.map(c => c.num).join(","), "1,2,3,4");
  assert.ok(cells.every(c => c.slots.length === 1 && c.slots.every(s => s.fill)));
  const pw = EPPostImage.postWindows(spec.frame.opening, spec.rows, spec.frame.windows);
  assert.equal(pw.perModule, true);
  assert.equal(pw.rects.length, 4, "4 клавиши легли в 4 окна");
});

test("смешанный состав 22751 + обычный 1М: по порядку слева направо (окно 0 клавиша, окно 1 механизм)", async () => {
  const P = await loadRuntimeProducts();
  const byCode = c => P.find(p => p.code === c);
  const build = makeSpecBuilder(P);
  const F4 = byCode("22684.4.11"), KEY = byCode("22751.11");
  const m1 = P.find(p => p.kind === "mechanism" && EPCatalog.mechanismSpan(p) === 1 && p.code !== "22751.11" && EPCatalog.moduleFace(p));

  const spec = build({ frameId: F4.id, mechanismIds: [KEY.id, m1.id] });
  const cells = flatCells(spec.rows);
  assert.equal(cells[0].slots.length, 1, "клавиша — 1 прорезь (окно 0)");
  assert.equal(cells[0].slots[0].fill, true, "клавиша — обрезанная кнопка, заполняет прорезь");
  assert.equal(cells[1].slots.length, 1, "механизм — 1 прорезь (окно 1)");
  assert.equal(cells[1].slots[0].fill, false, "обычный механизм — истинная величина");
  assert.equal(cells[2].empty, true, "свободная прорезь (окно 2)");
  assert.equal(cells[3].empty, true, "свободная прорезь (окно 3)");
  const totalSlots = cells.reduce((a, c) => a + c.slots.length, 0);
  assert.equal(totalSlots, 4, "4 прорези 22684.4 заняты по порядку");
  const pw = EPPostImage.postWindows(spec.frame.opening, spec.rows, spec.frame.windows);
  assert.equal(pw.perModule, true);
});

test("обычная накладка Eikon — БЕЗ изменений: у ячеек нет slots, картинка прежняя", async () => {
  const P = await loadRuntimeProducts();
  const byCode = c => P.find(p => p.code === c);
  const build = makeSpecBuilder(P);
  const NF = byCode("09661.01");                 // обычная Eikon, не кнопочная
  const m1 = P.find(p => p.kind === "mechanism" && EPCatalog.mechanismSpan(p) === 1 && EPCatalog.moduleFace(p));

  const spec = build({ frameId: NF.id, mechanismIds: [m1.id] });
  const cells = flatCells(spec.rows);
  assert.ok(cells.every(c => c.slots === undefined), "обычная накладка slots не получает — прежний путь postImage");
});

/* ───────── МУТАЦИЯ: отключить обрезку лица клавиши → в прорези покажется всё лицо (обе кнопки) ───────── */

test("мутация: без спец-случая 22751 в прорезь легло бы ВСЁ лицо (обе кнопки) — обрезка реально меняет рисунок", async () => {
  const P = await loadRuntimeProducts();
  const byCode = c => P.find(p => p.code === c);
  const F4 = byCode("22684.4.11"), KEY = byCode("22751.11");
  const kFace = EPCatalog.moduleFace(KEY);

  /* Настоящее правило: одна прорезь, но доля лица — верхняя ПОЛОВИНА (одна кнопка), заполняет прорезь. */
  const real = EPButtonFrame.cellSlots(KEY, F4, EPCatalog.mechanismSpan(KEY), kFace)[0];
  assert.equal(real.fill, true);
  assert.ok(Math.abs(real.face.height - kFace.height / 2) < 0.1, "в прорези половина высоты лица");

  /* Сломанный вариант: если убрать спец-случай, клавиша пошла бы общим путём 1-модульного механизма —
     один слот с ПОЛНЫМ лицом (обе кнопки) и fill=false. Высота лица отличается вдвое, fill другой —
     photoStage нарисовал бы изделие целиком вместо одной обрезанной кнопки. */
  assert.ok(Math.abs(real.face.height - kFace.height) > 0.1, "настоящая доля лица НЕ равна полному лицу");
  assert.notEqual(real.fill, false, "настоящая прорезь заполняется долей, а не рисует лицо истинной величины");
});
