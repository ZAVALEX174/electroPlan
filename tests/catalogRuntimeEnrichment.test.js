/* Сквозная проверка реального пути каталога в браузере.
   ВАЖНО: catalog-vimar.js — намеренно сырой слой без производных layoutRows. Геометрия
   лежит в catalog-vimar-attrs.js и только data.js подмешивает её в EP_DATA.products,
   которые приложение получает через DataService.getProducts(). Этот тест не повторяет
   подмешивание руками: он исполняет те же три файла и в том же порядке, что index.html. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const EPPosts = require("../js/posts.js");

const ROOT = path.join(__dirname, "..");
const JS_DIR = path.join(ROOT, "js");
const FILES = ["catalog-vimar.js", "catalog-vimar-attrs.js", "data.js"];

test("runtime-каталог: data.js подмешивает реальные layoutRows всем многорядным накладкам", async () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const scriptPositions = FILES.map(file => html.indexOf(`js/${file}`));
  assert.ok(scriptPositions.every(pos => pos >= 0), "все звенья загрузки каталога должны быть в index.html");
  assert.ok(scriptPositions[0] < scriptPositions[1] && scriptPositions[1] < scriptPositions[2],
    "сырой каталог, атрибуты и data.js должны загружаться именно в таком порядке");

  const win = {};
  const context = vm.createContext({ window: win, structuredClone });
  for (const file of FILES) {
    vm.runInContext(fs.readFileSync(path.join(JS_DIR, file), "utf8"), context, { filename: file });
  }

  const rawFrames = win.EP_VIMAR_CATALOG.products.filter(p => p.kind === "frame" && p.active);
  const runtimeFrames = (await win.DataService.getProducts()).filter(p => p.kind === "frame" && p.active);
  const plusPattern = /\d\s*\+\s*\d/;
  const rawWithPlus = rawFrames.filter(p => plusPattern.test(String(p.name)));
  const runtimeWithPlus = runtimeFrames.filter(p => plusPattern.test(String(p.name)));

  assert.equal(rawWithPlus.length, 291, "контрольная выборка сырого каталога");
  assert.equal(rawWithPlus.filter(p => Array.isArray(p.layoutRows)).length, 0,
    "сырой catalog-vimar.js по архитектуре не должен дублировать производные атрибуты");
  assert.equal(runtimeWithPlus.length, rawWithPlus.length);
  assert.equal(runtimeWithPlus.filter(p => Array.isArray(p.layoutRows)).length, runtimeWithPlus.length,
    "после data.js ни одна накладка с явной раскладкой не должна остаться плоской");

  const multi = runtimeFrames.filter(p => p.slotCount === 14 || p.slotCount === 21);
  assert.equal(multi.length, 18);
  assert.equal(multi.filter(p => p.slotCount === 14).length, 9);
  assert.equal(multi.filter(p => p.slotCount === 21).length, 9);

  for (const frame of multi) {
    const expectedRows = Array.from({ length: frame.slotCount / 7 }, () => [7]);
    assert.deepEqual(Array.from(frame.layoutRows, row => Array.from(row)), expectedRows,
      `${frame.code}: runtime-товар должен нести физические ряды по 7 модулей`);
    const layout = EPPosts.frameLayout(frame);
    assert.deepEqual(layout.rows, expectedRows, `${frame.code}: frameLayout должен получить обогащённый товар`);
    assert.equal(layout.postCount, frame.slotCount / 7);
    assert.equal(layout.multiRow, true);
    assert.equal(Math.max(...layout.posts.map(post => post.capacity)), 7,
      `${frame.code}: механизм не должен пересечь горизонтальный импост`);
  }
});
