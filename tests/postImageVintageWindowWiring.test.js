/* РЕГРЕСС ВИНТАЖНОГО ПОСТА (владелец, 16.09 → задача НАКЛАДКА-ФОТО).

   ИСТОРИЯ. 16.09 детектор монтажных окон снимал для базы 22674 ОДНО крошечное отверстие 4,5×10,9 %
   вместо четырёх (склеивал варианты по «коду до первой точки» и резал узкие овалы порогом площади).
   Одно окно совпадало с одним постом, postWindows верил измерению и раскладывал 4 модуля в полоску
   шириной 4,5 % — клавиши схлопывались. Временной страховкой служил windowsHoldModules: недостоверно
   узкое окно уводило пост на схему-фолбэк (механизмы видны в сетке, но фон-фото не показан).

   ЧТО СЕЙЧАС. Детектор починен (ключ = артикул без последнего сегмента; порог держит равные овалы):
   у 22674.4 честно ЧЕТЫРЕ окна, как у эталонной 22684 «Flat 4 на 4». Число окон (4) не совпадает с
   числом постов (1 — итальянская накладка это один пост), поэтому postWindows раскладывает пост
   штатным фолбэком splitOpening, а windowsHoldModules пропускает окна (measured=false) — пост уходит
   в РЕЖИМ ФОТО с фоновым снимком накладки. Первый тест это фиксирует (упал бы при откате данных к
   одному окну). Второй тест сохраняет покрытие САМОЙ защиты windowsHoldModules на синтетике —
   единственное недостоверно узкое окно она обязана отклонять и после починки данных.

   ЧЕСТНОСТЬ ТЕСТА. Каталог — НАСТОЯЩИЙ, обогащённый тем же data.js и в том же порядке файлов, что
   index.html (окна/лица/атрибуты подмешаны DataService.getProducts). Spec собирает НАСТОЯЩИЙ
   assembledPostSpec из app.js (через общий стенд appStand), картинку строит НАСТОЯЩИЙ
   EPPostImage.buildHtml. Запуск: node --test tests/ */
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
const EPEstimate = require("../js/estimate.js");

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
    product, frameProduct: product, EPPosts, EPEstimate,
    /* Предмет теста — режим фото/схемы накладки, не подмена цельного изделия: групп света у поста
       нет, lightRows пусты, effectiveMechanismIds оставляет исходные тумблеры Vintage. */
    lightingRowsFor: () => [], projectLighting: () => null,
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

test("винтажный пост 22674: четыре измеренных окна → режим фото (не схема)", async () => {
  const products = await loadRuntimeProducts();
  const frame = frameByCode(products, "22674.4.88");
  const post = { frameId: frame.id, mechanismIds: mechIds(products, ["22061.88", "22008.88", "22008.88", "22004.88"]) };

  const spec = buildSpec(products, post);
  /* Данные починены: у 22674.4 честно четыре окна (как у эталонной 22684), а не одно узкое. */
  assert.equal(spec.frame.windows.length, 4, "детектор обязан вернуть 4 окна для «4 модуля на 4 выключателя»");
  assert.equal(EPPostImage.photoReady(spec.frame), true, "фото и измеренные окна у 22674 есть");
  /* 4 окна ≠ 1 пост → postWindows идёт фолбэком splitOpening, windowsHoldModules пропускает. */
  assert.equal(EPPostImage.windowsHoldModules(spec.frame.opening, spec.rows, spec.frame.windows), true,
    "четыре окна не блокируют режим фото (перекос одного узкого окна больше не возникает)");

  const html = EPPostImage.buildHtml(spec, { esc: String });
  /* Контракт задачи: пост рисуется ФОТО накладки с механизмами поверх, а не схемой-пластиной. */
  assert.doesNotMatch(html, /data-ep="plate"/, "винтажный пост с корректными окнами должен рисоваться фото, а не схемой");
  assert.ok(html.includes(spec.frame.imageUrl), "фон-фото накладки Vintage должно рисоваться");
  assert.equal((html.match(/data-ep="cell"/g) || []).length, 4, "в сборке должны быть все 4 модуля");
});

test("windowsHoldModules: единственное недостоверно узкое окно по-прежнему отклоняется", () => {
  /* Синтетика сохраняет покрытие САМОЙ защиты: одно окно = один пост (measured=true), а окно зажимает
     4 модуля в полоску 4,5×10,9 % (та самая геометрия старого дефекта 22674) → защита обязана вернуть
     false. Иначе — окно, вмещающее модули, обязано вернуть true. */
  const rows = [{ posts: [{ cells: [{ span: 1 }, { span: 1 }, { span: 1 }, { span: 1 }] }] }];
  const narrow = { left: 25.5, top: 44.2, width: 4.5, height: 10.9, aspect: 1.55 };
  assert.equal(EPPostImage.windowsHoldModules(narrow, rows, [narrow]), false,
    "узкое окно 4,5 % на 4 модуля физически их не держит");
  const wide = { left: 20, top: 40, width: 50, height: 12, aspect: 1.55 };
  assert.equal(EPPostImage.windowsHoldModules(wide, rows, [wide]), true,
    "широкое окно 50 % на 4 модуля держит их — режим фото допустим");
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
