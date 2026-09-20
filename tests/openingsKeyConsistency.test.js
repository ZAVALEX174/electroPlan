/* СТОРОЖ КОНСИСТЕНТНОСТИ КЛЮЧА МОНТАЖНЫХ ОКОН.

   ПРОБЛЕМА (задача НАКЛАДКА-ФОТО). Геометрия окон в js/catalog-vimar-openings.js хранится под
   ключом «артикул без последнего сегмента» (последний сегмент — цвет). Правило ключа задано ДВАЖДЫ:
   у производителя файла (tools/detect-openings.mjs → openingKey) и у потребителя в рантайме
   (js/data.js → attachOpenings). Файл и рантайм — разные процессы, общий модуль им не импортировать
   (во фронте нет сборщика, PLAN 2.2), поэтому две копии правила МОГУТ РАЗОЙТИСЬ молча: прежняя
   ошибка ровно такая — детектор и data.js оба резали код по первой точке (split(".")[0]) и склеивали
   трёхсегментные варианты 22673.1/.2/.3 в один ключ 22673.

   ЧТО СТЕРЕЖЁМ. Берём РЕАЛЬНОЕ правило прямо из тула (openingKey — единственный первоисточник) и
   проверяем им ОБЕ стороны на настоящем каталоге:
   • Part A — каждый ключ собранного файла достижим: есть накладка каталога, у которой openingKey
     даёт ровно этот ключ (тул не насыпал «мёртвых» ключей);
   • Part B — рантайм-потребитель (data.js) посчитал ТОТ ЖЕ ключ: у каждой накладки, чей openingKey
     есть в файле, обогащение реально проставило mountRect/mountRects, и эта геометрия совпадает с
     геометрией файла под этим ключом. Если бы data.js резал код иначе — 22673.3.03 получил бы чужой
     ключ (или никакого), геометрия разошлась бы и тест покраснел.

   Запуск: node --test tests/ */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const JS_DIR = path.join(ROOT, "js");
// Те же файлы и порядок, что в index.html: сырой каталог → атрибуты → окна → лица → data.js.
const FILES = ["catalog-vimar.js", "catalog-vimar-attrs.js", "catalog-vimar-openings.js", "catalog-vimar-faces.js", "data.js"];

// Загружаем настоящее правило ключа из тула-производителя (единственный первоисточник, без третьей
// копии): им же проверяем и файл, и рантайм.
async function loadOpeningKey() {
  const mod = await import("../tools/detect-openings.mjs");
  return mod.openingKey;
}

function loadRuntime() {
  const win = {};
  const context = vm.createContext({ window: win, structuredClone });
  for (const file of FILES) {
    vm.runInContext(fs.readFileSync(path.join(JS_DIR, file), "utf8"), context, { filename: file });
  }
  return win;
}

test("openingKey: цвет отрезаем, вариант по числу отверстий сохраняем", async () => {
  const openingKey = await loadOpeningKey();
  assert.equal(openingKey("09673.01"), "09673", "двухсегментный: последний сегмент — цвет");
  assert.equal(openingKey("09673.04"), "09673", "другой цвет той же накладки — тот же ключ");
  assert.equal(openingKey("22673.1.01"), "22673.1", "трёхсегментный: вариант «на 1 кнопку» остаётся в ключе");
  assert.equal(openingKey("22673.3.03"), "22673.3", "вариант «на 3 кнопки» — отдельный ключ, не сливается с 22673");
  assert.equal(openingKey("22674.4.88"), "22674.4", "цвет .88 отрезан, вариант .4 сохранён");
  assert.equal(openingKey("14642"), "14642", "односегментный код остаётся собой");
  assert.equal(openingKey(""), "", "пустой код не роняет функцию");
  // Ключевое отличие от старого split(".")[0]: он склеил бы разные варианты.
  assert.notEqual(openingKey("22673.1.01"), openingKey("22673.3.01"),
    "разные варианты по числу отверстий обязаны давать РАЗНЫЕ ключи");
});

test("сторож: ключи файла ↔ рантайм-обогащение согласованы (обе копии правила не разошлись)", async () => {
  const openingKey = await loadOpeningKey();
  const win = loadRuntime();
  const openings = win.EP_VIMAR_OPENINGS;
  assert.ok(openings && Object.keys(openings).length > 0, "файл окон должен подгрузиться и быть непустым");

  const frames = (await win.DataService.getProducts()).filter(p => p.kind === "frame");
  assert.ok(frames.length > 0, "в каталоге должны быть накладки");

  // Part A: каждый ключ файла достижим правилом хотя бы одной накладкой каталога.
  for (const key of Object.keys(openings)) {
    assert.ok(frames.some(f => openingKey(f.code) === key),
      `ключ ${key} из catalog-vimar-openings.js не даёт ни одна накладка каталога — правило ключа разошлось с генератором`);
  }

  // Part B: рантайм посчитал ТОТ ЖЕ ключ — накладка с ключом из файла получила его геометрию.
  let matched = 0;
  for (const f of frames) {
    const key = openingKey(f.code);
    const rec = openings[key];
    if (!rec) continue;
    matched++;
    const rects = rec.rects;
    if (rects.length === 1) {
      assert.ok(f.mountRect && !f.mountRects,
        `накладка ${f.code} (ключ ${key}, одно окно) должна получить mountRect, а не mountRects`);
      assert.deepEqual(
        [f.mountRect.left, f.mountRect.top, f.mountRect.width, f.mountRect.height, f.mountRect.aspect],
        [rects[0][0], rects[0][1], rects[0][2], rects[0][3], rec.aspect],
        `накладка ${f.code}: mountRect не совпал с геометрией файла под ключом ${key} — потребитель посчитал другой ключ`);
    } else {
      assert.ok(Array.isArray(f.mountRects) && !f.mountRect,
        `накладка ${f.code} (ключ ${key}, ${rects.length} окон) должна получить mountRects, а не mountRect`);
      assert.equal(f.mountRects.length, rects.length,
        `накладка ${f.code}: число окон в mountRects должно совпасть с файлом (ключ ${key})`);
      f.mountRects.forEach((r, i) => assert.deepEqual(
        [r.left, r.top, r.width, r.height, r.aspect],
        [rects[i][0], rects[i][1], rects[i][2], rects[i][3], rec.aspect],
        `накладка ${f.code}: окно ${i} в mountRects не совпало с файлом (ключ ${key})`));
    }
  }
  assert.ok(matched >= 40, `сторож должен реально сверить десятки накладок, а сверил ${matched}`);
});
