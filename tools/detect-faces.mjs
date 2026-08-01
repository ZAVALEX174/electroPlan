/*
 * Воспроизводимый детектор ЛИЦЕВОГО ПРЯМОУГОЛЬНИКА механизмов VIMAR → js/catalog-vimar-faces.js.
 *
 * ЗАЧЕМ. В собранном посте модуль теперь показывается НАСТОЯЩЕЙ фотографией механизма
 * (js/postImage.js, режим фото модуля), а нарисованная клавиша осталась фолбэком. Розетку, USB,
 * RJ45, термостат нарисованной клавишей не передать (все выглядят как выключатель со значком) —
 * поэтому владелец выбрал фото. Чтобы в ячейку модуля легло РОВНО лицо механизма (без монтажных
 * лапок и полей кадра), нужна геометрия лица на фото. Две прошлые попытки вставляли фотографию
 * ЦЕЛИКОМ в неверно посчитанное окно — получался коллаж; здесь лицо вырезается ДЕТЕРМИНИРОВАННО.
 *
 * ПОЧЕМУ ЭТО СЧИТАЕТСЯ ТОЧНО. Механизмы VIMAR сняты фронтально и единообразно, а лицо модуля VIMAR
 * имеет физическое отношение ширина/высота = span × 22,5/45 (модуль 22,5×45 мм): 1М → 0.5, 2М → 1.0,
 * 3М → 1.5. Значит по ШИРИНЕ содержимого фото и числу модулей (EPCatalog.mechanismSpan) высота лица
 * вычисляется однозначно, а монтажные лапки, торчащие сверху и снизу, отсекаются центрированием.
 *
 * КАК.
 *   1) берём ДЕТАЛЬНОЕ фото механизма (productImage(item,{detail:true}); заглушки no_photo отсеяны);
 *   2) содержимое (пиксели темнее фона, min(R,G,B) < CONTENT_MAX) РЕЖЕМ на связные компоненты — у
 *      части позиций рядом с модулем в кадре лежит комплектный аксессуар (косичка-переходник HDMI,
 *      отдельный коннектор RJ45), который раньше растягивал «лицо» на весь коллаж;
 *   3) из компонентов выбираем МОДУЛЬ — тот, чья пропорция ширина/высота попадает в ожидаемую по
 *      span (span × 22,5/45); аксессуар с другой пропорцией остаётся за кадром (js/lib/faces.mjs);
 *   4) высота лица = ширина компонента / (span × 22,5/45); берём центральный по вертикали
 *      прямоугольник этой высоты — монтажные лапки сверху/снизу уходят сами;
 *   5) поджимаем прямоугольник внутрь на TRIM с каждой стороны — по краю механизма видна светлая
 *      кромка его собственной монтажной рамки (особенно на тёмной накладке), её срезаем;
 *   6) результат — прямоугольник в % от размера фото [left, top, width, height];
 *   7) если модуль не выделяется, а в кадре несколько «однокнопочных» предметов при span > 1
 *      (пара клавиш EnOcean) — фото НЕ используем, позиция уходит на нарисованную клавишу-фолбэк.
 *
 * ПОЧЕМУ ПО КАЖДОМУ АРТИКУЛУ, А НЕ ПО БАЗЕ. У накладок база (код до точки) надёжно группирует
 * цветовые варианты — там качаем одно фото на базу. У МЕХАНИЗМОВ так нельзя: суффикс после точки
 * часто кодирует ИСПОЛНЕНИЕ, а не цвет (09001.0.250 — 1 модуль, 09001.2.CM — 2 модуля: одна база
 * 09001, но РАЗНЫЙ span и разное фото), да и у каждого цвета своя фотография (в каталоге 295
 * механизмов с фото → 295 разных URL, ни одного общего). Надёжного правила выделить базу нет,
 * поэтому считаем ПО КАЖДОМУ артикулу отдельно (корректность важнее экономии загрузок). Из-за
 * этого качаем сотни фото — идём ПОСЛЕДОВАТЕЛЬНО с паузой PAUSE_MS, чтобы не долбить vimar.ru;
 * скачанное кэшируется, повторный прогон мгновенен и детерминирован.
 *
 * ВОСПРОИЗВОДИМОСТЬ. Тот же каталог + те же фото → тот же файл: ключи отсортированы, кэш в каталоге
 * .tmp-faces (маска .tmp-* уже в .gitignore).
 *
 * Флаги: --out выходной файл, --cache каталог кэша, --codes «09001.2.CM,09005.2.CM» (только эти),
 *        --limit N (первые N — для быстрой проверки), --catalog путь к js/catalog-vimar.js.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { Jimp } from "jimp";
import { buildContentMask, labelComponents, chooseFace } from "./lib/faces.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");

const { values: args } = parseArgs({
  options: {
    out: { type: "string" },
    cache: { type: "string" },
    codes: { type: "string" },
    limit: { type: "string" },
    catalog: { type: "string" },
  },
});
const OUT = args.out ? path.resolve(args.out) : path.join(projectRoot, "js/catalog-vimar-faces.js");
const CACHE = args.cache ? path.resolve(args.cache) : path.join(projectRoot, ".tmp-faces");
const CATALOG = args.catalog ? path.resolve(args.catalog) : path.join(projectRoot, "js/catalog-vimar.js");
const ONLY = args.codes ? new Set(args.codes.split(",").map((s) => s.trim()).filter(Boolean)) : null;
const LIMIT = args.limit ? Number(args.limit) : 0;

/* Пауза между НОВЫМИ загрузками (кэш-промахами): качаем по одному артикулу, сотни фото — чтобы не
   нагружать vimar.ru залпом. Кэшированные не ждут (прогон по готовому кэшу быстрый). */
const PAUSE_MS = 120;

const isPlaceholder = (u) => /no_photo/i.test(String(u || ""));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Каталог и доменные хелперы — обычные скрипты на window; подсовываем global.window и грузим через
   require (в браузер этот тул не идёт, как остальной tooling). Из EPCatalog берём mechanismSpan и
   productImage — те же правила, что в рантайме, чтобы span и выбор фото совпадали с приложением. */
function loadCatalog() {
  globalThis.window = globalThis.window || {};
  const require = createRequire(import.meta.url);
  require(CATALOG);
  require(path.join(projectRoot, "js/catalog.js"));
  const products = (globalThis.window.EP_VIMAR_CATALOG && globalThis.window.EP_VIMAR_CATALOG.products) || [];
  const EPCatalog = globalThis.window.EPCatalog;
  const mechanisms = products
    .filter((p) => p.kind === "mechanism")
    .map((p) => ({
      code: p.code,
      name: p.name,
      span: EPCatalog.mechanismSpan(p),
      url: EPCatalog.productImage(p, { detail: true }),
    }))
    .filter((m) => m.url && !isPlaceholder(m.url))
    .sort((a, b) => String(a.code).localeCompare(String(b.code), "en"));
  return mechanisms;
}

/* Скачивание в буфер: таймаут, один переход по редиректу, повтор при сбое (портировано из
   detect-openings.mjs без изменений — та же проверенная логика сети). */
function fetchOnce(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { timeout: 25000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        fetchOnce(new URL(res.headers.location, url).href).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("timeout", () => req.destroy(new Error("таймаут")));
    req.on("error", reject);
  });
}
async function fetchRetry(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fetchOnce(url); } catch (e) { last = e; await sleep(400 * (i + 1)); }
  }
  throw last;
}

/* Кэш скачанного фото по артикулу (расширение из URL). Есть в кэше — сети не касаемся. Возвращает
   {file, fetched}: fetched=true если пришлось качать (тогда зовущий выдержит паузу). Кодируем код
   в имя файла (в артикулах есть точки — безопасно, но пробелов/слэшей нет). */
async function cachedImage(code, url) {
  await fsp.mkdir(CACHE, { recursive: true });
  const ext = (path.extname(new URL(url).pathname) || ".jpg").split("?")[0];
  const file = path.join(CACHE, code.replace(/[^\w.-]/g, "_") + ext);
  if (fs.existsSync(file)) return { file, fetched: false };
  await fsp.writeFile(file, await fetchRetry(url));
  return { file, fetched: true };
}

async function main() {
  let mechs = loadCatalog();
  if (ONLY) mechs = mechs.filter((m) => ONLY.has(m.code));
  if (LIMIT > 0) mechs = mechs.slice(0, LIMIT);

  const result = {};
  const rows = [];         // строки отчёта по посчитанным лицам
  const suspicious = [];   // лицо посчитано, но модуль не попал в пропорцию — глянуть глазами
  const compound = [];     // составные позиции (пара клавиш и т.п.) — ушли в фолбэк
  const failed = [];       // не скачалось / содержимого не нашли

  for (const m of mechs) {
    try {
      const { file, fetched } = await cachedImage(m.code, m.url);
      const img = await Jimp.read(file);
      const { width: w, height: h } = img.bitmap;
      const mask = buildContentMask(img.bitmap);
      const comps = labelComponents(mask, w, h);
      const dec = chooseFace(comps, m.span, w, h);
      if (dec.decision === "empty") {
        failed.push({ code: m.code, why: "содержимого на фото не найдено" });
      } else if (dec.decision === "fallback") {
        // составная позиция — фото не годится, позиция уходит на нарисованную клавишу-фолбэк
        compound.push({ code: m.code, name: m.name, span: m.span, parts: dec.componentCount });
      } else {
        result[m.code] = { face: dec.face };
        rows.push({ code: m.code, span: m.span, size: `${w}x${h}`, ratio: dec.ratio, parts: dec.componentCount, face: dec.face });
        if (!dec.fit) suspicious.push({ code: m.code, name: m.name, span: m.span, ratio: dec.ratio, parts: dec.componentCount });
      }
      if (fetched) await sleep(PAUSE_MS);
    } catch (e) {
      failed.push({ code: m.code, why: String((e && e.message) || e) });
    }
  }

  // стабильный порядок ключей — воспроизводимость файла между прогонами
  const sorted = {};
  for (const k of Object.keys(result).sort((a, b) => a.localeCompare(b, "en"))) sorted[k] = result[k];

  const banner =
    `/* Generated by tools/detect-faces.mjs — НЕ ПРАВИТЬ РУКАМИ.\n` +
    `   Лицевой прямоугольник механизмов VIMAR, СНЯТЫЙ С ДЕТАЛЬНОГО ФОТО (bbox содержимого + пропорция\n` +
    `   модуля span×22,5/45, центрирование по вертикали, поджатие на TRIM).\n` +
    `   Ключ — ПОЛНЫЙ артикул (у механизмов база ненадёжна: суффикс кодирует и цвет, и число модулей).\n` +
    `   face — [left,top,width,height] в % фото. Подмешивается в js/data.js (faceRect), читается\n` +
    `   EPCatalog.moduleFace, рисуется в js/postImage.js. Пересобрать: npm run build:faces. */\n`;
  await fsp.writeFile(OUT, banner + `window.EP_VIMAR_FACES = ${JSON.stringify(sorted, null, 2)};\n`, "utf8");

  // ── Отчёт ────────────────────────────────────────────────────────────────
  console.log("Готово:", path.relative(projectRoot, OUT));
  console.log(`  механизмов с фото: ${mechs.length}, лицо посчитано: ${rows.length}, в фолбэк ушло: ${mechs.length - rows.length} (составных: ${compound.length}, без содержимого: ${failed.length})`);
  if (compound.length) {
    console.log(`\n  СОСТАВНЫЕ ПОЗИЦИИ (модуль не выделяется, несколько предметов в кадре) — ${compound.length}, ушли в фолбэк (фото не пишем):`);
    for (const c of compound) {
      console.log(`    ${String(c.code).padEnd(14)} span=${c.span} компонентов=${c.parts}  «${c.name}»`);
    }
  }
  if (suspicious.length) {
    console.log(`\n  ПОДОЗРИТЕЛЬНЫЕ КАДРЫ (модуль не попал в ожидаемую пропорцию) — ${suspicious.length}, глянуть глазами:`);
    for (const s of suspicious) {
      console.log(`    ${String(s.code).padEnd(14)} span=${s.span} ratio=${s.ratio} компонентов=${s.parts}  «${s.name}»`);
    }
  } else {
    console.log("\n  подозрительных кадров нет");
  }
  if (failed.length) {
    console.log(`\n  НЕ УДАЛОСЬ (${failed.length}):`);
    for (const f of failed) console.log(`    ${f.code}: ${f.why}`);
  }
}

main().catch((err) => {
  console.error("Ошибка детектора лиц механизмов:", err);
  process.exitCode = 1;
});
