/*
 * Одноразовый генератор снимка каталога коммита 732ae3a → tools/data/discontinued-732ae3a.json.
 *
 * Зачем. Номенклатура К2 убрала ~496 артикулов (накладки Arke/Arke Fit/Plana, осевые Arke 19101*,
 * подсветка 120V, суппорты Arke Fit, 21612 и др.). Решение владельца: в НОВЫЕ посты их не
 * предлагать, но в СОХРАНЁННЫХ проектах оставить на месте — с прежней ценой и пометкой «снята с
 * производства» (блок В23, product.active=false). Чтобы сборка могла вернуть такие позиции с их
 * ПРЕЖНИМИ данными, нужен зафиксированный снимок прежнего каталога — этот файл его и готовит.
 *
 * Снимаем РАНТАЙМ-товары (window.EP_DATA.products коммита 732ae3a), а не сырой catalog-vimar.js:
 * у рантайм-товара признаки автосостава (standard, отделка, principle, роли, цвет элемента,
 * faceRect/mountRect) уже вмешаны data.js из тогдашних attrs/openings/faces. Так снятая позиция
 * несёт ВСЁ, что нужно сохранённому посту считаться как раньше, и её НЕ надо снова прогонять через
 * attrs (их в текущем каталоге для этих кодов нет). Это и держит текущие attrs/каталог «чистыми»
 * по новой номенклатуре — на их счётчики опираются тесты.
 *
 * Почему снимок, а не `git show` при каждой сборке: сборка должна быть воспроизводима из файлов
 * репозитория и не зависеть от состояния git. Снимок снимается ОДИН раз (этим скриптом) и дальше
 * лежит как обычные данные tools/data. Пересоздавать нужно только при смене опорного коммита
 * (сейчас 732ae3a — последний каталог ДО перехода на номенклатуру К2).
 *
 * Запуск:  node tools/make-discontinued-snapshot.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const COMMIT = "732ae3a";
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "data/discontinued-732ae3a.json");

// Файлы каталога/данных присваивают window.EP_* и строят window.EP_DATA. Прогоняем их текст в
// изолированном объекте window ровно в том порядке, в каком их грузит index.html, и забираем
// готовый список EP_DATA.products — уже со вмешанными признаками (тот же путь, что в рантайме).
const FILES = [
  "js/catalog-vimar.js",
  "js/catalog-vimar-attrs.js",
  "js/catalog-vimar-openings.js",
  "js/catalog-vimar-faces.js",
  "js/data.js",
];
const win = { localStorage: { getItem: () => null, setItem: () => {} }, structuredClone };
for (const file of FILES) {
  const src = execFileSync("git", ["show", `${COMMIT}:${file}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  new Function("window", "structuredClone", "localStorage", src)(win, win.structuredClone, win.localStorage);
}
const products = win.EP_DATA && win.EP_DATA.products;
if (!Array.isArray(products) || !products.length) throw new Error(`В ${COMMIT} не собрался EP_DATA.products`);

const sortByCode = (a, b) => String(a.code).localeCompare(String(b.code), "en");
const snapshot = {
  commit: COMMIT,
  note: "Снимок РАНТАЙМ-каталога (EP_DATA.products) ДО номенклатуры К2. Сборка берёт отсюда артикулы, которых нет в новой номенклатуре, и кладёт как active=false (снятые с производства). Генератор: tools/make-discontinued-snapshot.mjs.",
  // Весь каталог 732ae3a (а не только убранное): какие из них «снятые», решает сборка, сверяя с
  // актуальной номенклатурой. Повторно появившийся артикул снова станет активным сам.
  products: [...products].sort(sortByCode),
};

fs.writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
console.log("Готово:", path.relative(path.resolve(here, ".."), OUT));
console.log(`  товаров в снимке (рантайм 732ae3a): ${snapshot.products.length}`);
