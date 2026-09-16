/* РЕГРЕСС ДЕФЕКТА ОТРИСОВКИ ВИНТАЖНОГО ПОСТА (владелец, 16.09).

   СИМПТОМ. В конструкторе пост серии Vintage (накладка 22674.4.88 + тумблеры 22061.88/22008.88/
   22004.88) показывался ПУСТОЙ рамкой: видны отверстия накладки, но механизмы не нарисованы.

   ПРИЧИНА (не симптом). Детектор монтажных окон (tools/detect-openings.mjs → catalog-vimar-
   openings.js) снял для базы 22674 ОДНО крошечное отверстие 4,5×10,9 % вместо четырёх (ср. 22684
   «Flat 4 на 4», где окон честно четыре). photoReady=true (фото+окно есть), число окон (1) совпало
   с числом постов (1), поэтому postWindows поверил измерению и разложил все 4 модуля в полоску
   шириной 4,5 % фото — клавиши схлопнулись в невидимую линию поверх фото. У Neve Up (09673.01)
   окно снято верно (56×51,4 %), поэтому клавиши видны.

   КОНТРАКТ ПОЧИНКИ. buildHtml пускает режим фото ТОЛЬКО когда измеренное окно ФИЗИЧЕСКИ вмещает
   модули (windowsHoldModules): недостоверное окно уводит накладку на честную схему-фолбэк, где
   клавиши/механизмы рисуются в нормальной сетке (moduleKey → фото механизма). Neve Up и прочие
   корректно снятые накладки остаются в режиме фото.

   ЧЕСТНОСТЬ ТЕСТА. Каталог — НАСТОЯЩИЙ, обогащённый тем же data.js и в том же порядке файлов, что
   index.html (окна/лица/атрибуты подмешаны DataService.getProducts). Spec собирает НАСТОЯЩИЙ
   assembledPostSpec из app.js (через общий стенд appStand), картинку строит НАСТОЯЩИЙ
   EPPostImage.buildHtml. До починки — падает (винтажный пост в режиме фото со сплющенным окном).
   Запуск: node --test tests/ */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");

const EPCatalog = require("../js/catalog.js");
const EPPosts = require("../js/posts.js");
const EPPostImage = require("../js/postImage.js");

/* Обогащённый рантайм-каталог: те же файлы и порядок, что в index.html (сырой каталог → атрибуты →
   окна → лица → data.js). Именно data.js подмешивает mountRect/mountRects и faceRect, на которых
   держится дефект. */
const JS_DIR = path.join(__dirname, "..", "js");
const FILES = ["catalog-vimar.js", "catalog-vimar-attrs.js", "catalog-vimar-openings.js", "catalog-vimar-faces.js", "data.js"];

async function loadRuntimeProducts() {
  const win = {};
  const context = vm.createContext({ window: win, structuredClone });
  for (const file of FILES) {
    vm.runInContext(fs.readFileSync(path.join(JS_DIR, file), "utf8"), context, { filename: file });
  }
  return win.DataService.getProducts();
}

/* Собрать spec поста через НАСТОЯЩИЙ assembledPostSpec из app.js. Зависимости — реальная доменная
   логика (EPCatalog/EPPosts) и обогащённый каталог; UI-соседи посту не нужны (articles=true не
   зовёт EPOfferOptions). */
function buildSpec(products, post) {
  const product = id => products.find(p => Number(p.id) === Number(id));
  const ctx = {
    product, frameProduct: product, EPPosts,
    mechanismSpan: EPCatalog.mechanismSpan,
    productImage: EPCatalog.productImage,
    moduleFace: EPCatalog.moduleFace,
    frameSlotCount: EPCatalog.frameSlotCount,
    frameOpening: EPCatalog.frameOpening,
    frameOpenings: EPCatalog.frameOpenings,
    EPOfferOptions: { itemText: (name) => name },
    Map, Array, Number, String
  };
  const run = stand.run("assembledPostSpec", ctx);
  return run(post, { size: "lg", articles: true });
}

function frameByCode(products, code) {
  const f = products.find(p => p.kind === "frame" && p.code === code);
  assert.ok(f, `накладка ${code} должна быть в каталоге`);
  return f;
}
function mechIds(products, codes) {
  return codes.map(c => {
    const m = products.find(p => p.kind === "mechanism" && p.code === c);
    assert.ok(m, `механизм ${c} должен быть в каталоге`);
    return m.id;
  });
}

test("винтажный пост 22674: недостоверное окно уводит на схему — механизмы видны", async () => {
  const products = await loadRuntimeProducts();
  const frame = frameByCode(products, "22674.4.88");
  const post = { frameId: frame.id, mechanismIds: mechIds(products, ["22061.88", "22008.88", "22008.88", "22004.88"]) };

  const spec = buildSpec(products, post);
  /* Разведка: до починки накладка проходила photoReady, но окно физически не держит модули. */
  assert.equal(EPPostImage.photoReady(spec.frame), true, "фото и измеренное окно у 22674 есть");
  assert.equal(EPPostImage.windowsHoldModules(spec.frame.opening, spec.rows, spec.frame.windows), false,
    "окно 22674 (4,5 % на 4 модуля) физически не вмещает механизмы");

  const html = EPPostImage.buildHtml(spec, { esc: String });
  /* Контракт: пост уходит на схему-фолбэк (пластина), а не в режим фото с фоновым снимком накладки —
     иначе механизмы сплющиваются в невидимую полоску. */
  assert.match(html, /data-ep="plate"/, "винтажный пост должен рисоваться схемой, а не фото со сплющенным окном");
  assert.ok(!html.includes(spec.frame.imageUrl), "фон-фото накладки в схеме не используется");
  /* Все четыре механизма присутствуют как ячейки (в схеме — фото механизма через useFacePhoto). */
  assert.equal((html.match(/data-ep="cell"/g) || []).length, 4, "в сборке должны быть все 4 модуля");
});

test("Neve Up 09673: корректно снятое окно оставляет режим фото — регресс не задевает исправные накладки", async () => {
  const products = await loadRuntimeProducts();
  const frame = frameByCode(products, "09673.01");
  const post = { frameId: frame.id, mechanismIds: mechIds(products, ["09021.N", "09021.N", "09021.N"]) };

  const spec = buildSpec(products, post);
  assert.equal(EPPostImage.windowsHoldModules(spec.frame.opening, spec.rows, spec.frame.windows), true,
    "окно 09673 (56×51,4 %) держит 3 модуля");

  const html = EPPostImage.buildHtml(spec, { esc: String });
  assert.doesNotMatch(html, /data-ep="plate"/, "исправная накладка остаётся в режиме фото");
  assert.ok(html.includes(spec.frame.imageUrl), "фон-фото накладки Neve Up должно рисоваться");
});
