/*
 * Воспроизводимый детектор монтажных окон накладок VIMAR → js/catalog-vimar-openings.js.
 *
 * ЗАЧЕМ. Сборка поста рисуется поверх ДЕТАЛЬНОГО фото накладки (js/postImage.js). Чтобы
 * клавиши легли ровно в физические окна, нужна их РЕАЛЬНАЯ геометрия, а не догадка об аспекте
 * (прежняя таблица defaultFrameOpenings давала окна «на глаз» и клавиши уезжали за пластину).
 *
 * КАК. Окно накладки — это СКВОЗНАЯ дыра, залитая на фото чистым белым (min(R,G,B) ≥ 250) и НЕ
 * связанная с внешним фоном кадра. Алгоритм (портирован с проверенного PIL-прототипа):
 *   1) отмечаем «чисто белые» пиксели;
 *   2) заливкой ОТ КРАЁВ кадра отсекаем внешний белый фон;
 *   3) оставшиеся связные компоненты белого — это окна; берём их bbox в % от размера фото;
 *   4) чистим мусор: блики по верхней/нижней кромке (короткие пятна у канта) отбрасываем.
 *
 * ГРУППИРОВКА ПО ФОРМЕ. Геометрия окон у ЦВЕТОВЫХ вариантов одной накладки совпадает
 * (09673.01/09673.04 — та же форма, разный цвет). Поэтому качаем и считаем ОДНУ фотографию на
 * группу и применяем ко всем цветам — сотни лишних загрузок не делаем. Ключ группы — «артикул
 * БЕЗ ПОСЛЕДНЕГО сегмента» (последний сегмент — цвет): 09673.01 → 09673. ВАЖНО: у части накладок
 * код ТРЁХсегментный (22673.1.01 «на 1 кнопку», 22673.2.01 «на 2», 22673.3.01 «на 3») — там
 * второй сегмент это ВАРИАНТ (число отверстий), а не цвет, и форма у них РАЗНАЯ. «Код до первой
 * точки» слил бы их в один ключ 22673 и раздал бы всем геометрию первого варианта — поэтому
 * ключ отрезает только ПОСЛЕДНИЙ сегмент (см. openingKey).
 *
 * ВОСПРОИЗВОДИМОСТЬ. Тот же каталог + те же фото → тот же файл: детектор детерминирован, ключи
 * отсортированы, скачанное кэшируется в каталоге .tmp-openings (маска .tmp-* уже в .gitignore). Правки
 * VIMAR-изображений согласованы с заказчиком (можно скачивать и хранить).
 *
 * Флаги: --out выходной файл, --cache каталог кэша, --bases «09673,09664» (только эти базы),
 *        --limit N (первые N баз — для быстрой проверки), --catalog путь к js/catalog-vimar.js.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { Jimp } from "jimp";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");

/* Конфиг из CLI. Держим значения в let со значениями по умолчанию, а parseArgs зовём ЛЕНИВО из
   main() (parseCliArgs), а не на верхнем уровне: так модуль можно import-нуть в автотесте, не
   натыкаясь на parseArgs (в тесте argv — путь к тест-файлу, strict-parseArgs упал бы на нём). */
let OUT = path.join(projectRoot, "js/catalog-vimar-openings.js");
let CACHE = path.join(projectRoot, ".tmp-openings");
let CATALOG = path.join(projectRoot, "js/catalog-vimar.js");
let ONLY = null;
let LIMIT = 0;

function parseCliArgs() {
  const { values: args } = parseArgs({
    options: {
      out: { type: "string" },
      cache: { type: "string" },
      bases: { type: "string" },
      limit: { type: "string" },
      catalog: { type: "string" },
    },
  });
  if (args.out) OUT = path.resolve(args.out);
  if (args.cache) CACHE = path.resolve(args.cache);
  if (args.catalog) CATALOG = path.resolve(args.catalog);
  if (args.bases) ONLY = new Set(args.bases.split(",").map((s) => s.trim()).filter(Boolean));
  if (args.limit) LIMIT = Number(args.limit);
}

const isPlaceholder = (u) => /no_photo/i.test(String(u || ""));

/* КЛЮЧ ГРУППИРОВКИ ОКОН по накладке — «артикул БЕЗ последнего сегмента». Последний сегмент кода
   VIMAR — цвет/финиш (09673.01 vs 09673.04, 22673.1.01 vs 22673.1.03), а форма окон у цветов одна,
   поэтому цвет отбрасываем. Отрезаем ТОЛЬКО последний сегмент (а не «код до первой точки»): у
   трёхсегментных накладок второй сегмент — это ВАРИАНТ по числу отверстий (22673.1/.2/.3), у него
   геометрия РАЗНАЯ, и он обязан остаться в ключе. Односегментный код остаётся собой.
   ⚠️ ТО ЖЕ ПРАВИЛО продублировано в js/data.js (attachOpenings): тул-производитель и рантайм-
   потребитель — разные процессы, общий модуль им не импортировать (во фронте нет сборщика,
   PLAN 2.2). Правило одно на два места: при правке меняй ОБА, расхождение ловит тест-сторож
   tests/openingsKeyConsistency.test.js. */
const openingKey = (code) => {
  const seg = String(code || "").split(".");
  return seg.length <= 1 ? seg[0] : seg.slice(0, -1).join(".");
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Ожидаемое число окон по НАЗВАНИЮ: немецкая «(2+2+2)» → 3, итальянская без «+…» → одно окно.
   Служит только для отчёта — расхождение измеренного и ожидаемого числа помечаем на просмотр
   глазами, но НЕ подменяем измеренное (детектор авторитетен). */
function expectedWindows(name) {
  const m = String(name || "").match(/(\d+(?:\+\d+)+)/);
  return m ? m[1].split("+").length : 1;
}

/* Каталог — обычный скрипт, присваивающий window.EP_VIMAR_CATALOG. Подсовываем ему global.window
   и подключаем через require (в браузер этот тул не идёт — как остальной tooling). */
function loadFrames() {
  globalThis.window = globalThis.window || {};
  const require = createRequire(import.meta.url);
  require(CATALOG);
  const products = (globalThis.window.EP_VIMAR_CATALOG && globalThis.window.EP_VIMAR_CATALOG.products) || [];
  return products.filter((p) => p.kind === "frame");
}

/* Один КЛЮЧ (openingKey) → представитель с детальным фото (первый цвет группы с настоящей
   картинкой). Трёхсегментные варианты (22673.1/.2/.3) попадают в РАЗНЫЕ группы и качают КАЖДЫЙ
   своё фото — иначе всем достаётся геометрия первого варианта. */
function groupBases(frames) {
  const bases = new Map();
  for (const p of frames) {
    const base = openingKey(p.code);
    const url = p.imageUrl && !isPlaceholder(p.imageUrl) ? p.imageUrl : "";
    if (!bases.has(base)) bases.set(base, null);
    if (url && !bases.get(base)) bases.set(base, { base, code: p.code, name: p.name, url });
  }
  return [...bases.values()].filter(Boolean).sort((a, b) => a.base.localeCompare(b.base, "en"));
}

/* Скачивание в буфер: таймаут, один переход по редиректу, повтор при сбое. */
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

/* Кэш скачанного фото по базе (расширение из URL). Есть в кэше — сети не касаемся (повтор
   прогона детерминирован и быстр). */
async function cachedImage(base, url) {
  await fsp.mkdir(CACHE, { recursive: true });
  const ext = (path.extname(new URL(url).pathname) || ".jpg").split("?")[0];
  const file = path.join(CACHE, base + ext);
  if (!fs.existsSync(file)) await fsp.writeFile(file, await fetchRetry(url));
  return file;
}

/* Отсев НЕ-окон среди связных пятен сквозного белого — ДВА условия сразу (И):
   • ОТНОСИТЕЛЬНОЕ (главное): пятно не мельче REL_FLOOR·(самого крупного пятна кадра). Окна одной
     накладки примерно равны по площади (у 22674 четыре овала n=106/96/96/93 — разброс ≤12 %),
     а точечный JPEG-шум на порядок мельче (n=1 при max=106 → 0,9 %). 0,25 лежит в огромном зазоре
     между ними, поэтому равные окна НЕ делятся произвольно (прежний единый порог оставлял «первый
     овал, три выкинул»);
   • АБСОЛЮТНОЕ (страховка): пятно не мельче ABS_FLOOR·(площади фото). Нужно на вырожденном кадре
     (макро-снимок цельной пластины без сквозного окна: 21653 Eikon Evo даёт только блики-slivers,
     самый крупный n=43), где относительный порог опустился бы до пары пикселей и пропустил бы блик
     за окно. На нормальных кадрах абсолютный пол ниже относительного и в отбор не вмешивается.
   ЧИСЛО. По каталогу самый мелкий РЕАЛЬНЫЙ овал — n=93 (22674, площадь 25800 → 0,36 % площади),
   самый крупный ШУМ вырожденного кадра — n=43 (21653, площадь 34200 → 0,13 %). 0.002 лежит между
   ними: 0.002·25800=52 < 93 (реальное окно проходит), 0.002·34200=68 > 43 (блик отсекается).
   Прежний единый порог 0.004·площадь (=103 px на фото 200×129) резал узкие овалы винтажных
   накладок наравне с шумом — четыре одинаковых окна разваливались на одно. */
const ABS_FLOOR = 0.002;    // доля площади фото — нижний предел размера окна на вырожденном кадре
const REL_FLOOR = 0.25;     // доля самого крупного пятна — равные окна не делятся произвольно

/* Все связные компоненты сквозного белого (bbox в % фото). Порог отсева — см. ABS_FLOOR/REL_FLOOR. */
function detectRaw(bmp) {
  const { width: w, height: h, data } = bmp;
  const pure = new Uint8Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    pure[p] = Math.min(data[i], data[i + 1], data[i + 2]) >= 250 ? 1 : 0;
  }
  // заливка от краёв кадра — внешний фон, окна с ним не связаны
  const seen = new Uint8Array(w * h);
  const stack = [];
  const push = (y, x) => { const p = y * w + x; if (pure[p] && !seen[p]) { seen[p] = 1; stack.push(p); } };
  for (let x = 0; x < w; x++) { push(0, x); push(h - 1, x); }
  for (let y = 0; y < h; y++) { push(y, 0); push(y, w - 1); }
  while (stack.length) {
    const p = stack.pop(), y = (p / w) | 0, x = p % w;
    if (y + 1 < h) push(y + 1, x);
    if (y - 1 >= 0) push(y - 1, x);
    if (x + 1 < w) push(y, x + 1);
    if (x - 1 >= 0) push(y, x - 1);
  }
  const lab = new Int32Array(w * h);
  const comps = [];              // {n, rect} — сначала СОБИРАЕМ все пятна, порог применяем после
  let cur = 0;
  for (let y0 = 0; y0 < h; y0++) {
    for (let x0 = 0; x0 < w; x0++) {
      const p0 = y0 * w + x0;
      if (pure[p0] && !seen[p0] && lab[p0] === 0) {
        cur++;
        const st = [p0]; lab[p0] = cur;
        let xs0 = x0, xs1 = x0, ys0 = y0, ys1 = y0, n = 0;
        while (st.length) {
          const p = st.pop(), y = (p / w) | 0, x = p % w;
          n++;
          if (x < xs0) xs0 = x; if (x > xs1) xs1 = x;
          if (y < ys0) ys0 = y; if (y > ys1) ys1 = y;
          const q = (yy, xx) => { const k = yy * w + xx; if (pure[k] && !seen[k] && lab[k] === 0) { lab[k] = cur; st.push(k); } };
          if (y + 1 < h) q(y + 1, x);
          if (y - 1 >= 0) q(y - 1, x);
          if (x + 1 < w) q(y, x + 1);
          if (x - 1 >= 0) q(y, x - 1);
        }
        comps.push({ n, rect: [
          round1(xs0 / w * 100), round1(ys0 / h * 100),
          round1((xs1 + 1 - xs0) / w * 100), round1((ys1 + 1 - ys0) / h * 100),
        ] });
      }
    }
  }
  return keepComponents(comps, w, h);
}

/* Отбор пятен-окон из всех связных компонентов сквозного белого (comps = [{n, rect}]). Порог =
   max(абсолютный пол ABS_FLOOR·площадь, доля REL_FLOOR от самого крупного пятна): относительное
   правило держит равные окна вместе (не делит их произвольно), абсолютное страхует вырожденный
   кадр без окон. Вынесено из detectRaw отдельной ЧИСТОЙ функцией — покрыта автотестом на фикстуре
   из реального кадра 22674 (четыре овала n=106/96/96/93 + шум n=1). */
function keepComponents(comps, w, h) {
  const maxN = comps.reduce((m, c) => Math.max(m, c.n), 0);
  const floor = Math.max(ABS_FLOOR * h * w, REL_FLOOR * maxN);
  return comps.filter((c) => c.n >= floor).map((c) => c.rect);
}
const round1 = (n) => Math.round(n * 10) / 10;
const round3 = (n) => Math.round(n * 1000) / 1000;

/* Допуск на ВЫБРОС окна внутри ряда: окна одного физического ряда накладки лежат на одной высоте
   и сами примерно одной высоты (top и height почти равны). Окно, чей top ИЛИ height отклоняется от
   МЕДИАНЫ ряда больше, чем ROW_OUTLIER_TOL·(медианная высота ряда), — это блик (например, засветка
   по канту, выбивающаяся вверх и по высоте), а не окно. Начато с 15% медианной высоты — крутится по
   картинкам. */
const ROW_OUTLIER_TOL = 0.15;

/* Разброс top, в пределах которого окна считаем ОДНИМ физическим рядом (доля от медианной высоты
   всех окон). Внутри ряда top гуляет на единицы процентов, а между рядами (двухрядная накладка 7+7,
   19660) разрыв заведомо больше высоты окна — 0.5 надёжно разделяет ряды, не сливая и не дробя. */
const ROW_BAND = 0.5;

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/* Пересечение окон по ГОРИЗОНТАЛИ (перекрытие проекций на ось X). */
const overlapX = (a, b) => a[0] < b[0] + b[2] - 1e-6 && b[0] < a[0] + a[2] - 1e-6;

/* Группировка окон в физические ряды по близкому top (см. ROW_BAND). Ряды — сверху вниз, чтобы
   собрать окна в порядке обхода постов «ряд за рядом». Многорядную (7+7) это разложит на два ряда,
   и медиану дальше считаем В ПРЕДЕЛАХ РЯДА, а не по всему кадру. */
function groupRows(rects) {
  if (!rects.length) return [];
  const band = ROW_BAND * median(rects.map((r) => r[3]));
  const sorted = [...rects].sort((a, b) => a[1] - b[1]);   // по top, сверху вниз
  const rows = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const row = rows[rows.length - 1];
    if (Math.abs(sorted[i][1] - median(row.map((r) => r[1]))) <= band) row.push(sorted[i]);
    else rows.push([sorted[i]]);
  }
  return rows;
}

/* Чистка одного ряда от бликов: (1) выкидываем окна, чей top или height далеко от медианы ряда
   (блик выбивается вверх и по высоте); (2) из горизонтально пересекающихся окон оставляем то, что
   БЛИЖЕ к медиане ряда (реальное окно, а не наложившийся на него блик). Ряд из одного окна не
   трогаем. Результат — слева направо. */
function pruneRow(row) {
  if (row.length <= 1) return row;
  const medTop = median(row.map((r) => r[1]));
  const medH = median(row.map((r) => r[3]));
  const tol = ROW_OUTLIER_TOL * medH;
  let kept = row.filter((r) => Math.abs(r[1] - medTop) <= tol && Math.abs(r[3] - medH) <= tol);
  if (!kept.length) kept = row;                             // защита: не выкидываем ряд целиком
  const dist = (r) => Math.abs(r[1] - medTop) + Math.abs(r[3] - medH);   // близость к медиане ряда
  const out = [];
  for (const r of [...kept].sort((a, b) => dist(a) - dist(b) || a[0] - b[0])) {
    if (!out.some((o) => overlapX(o, r))) out.push(r);      // пересёкся с более «медианным» — блик, отбрасываем
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/* Чистка от мусора (детектор ловит блики по канту). Окна одного ряда ~одной высоты и лежат в
   средней части кадра, поэтому: (1) отбрасываем компоненты, прилипшие к верхней/нижней кромке
   (короткие пятна у самого края); (2) из оставшихся режем те, что ниже 60% максимальной высоты
   (блики короче реальных окон); (3) разбиваем на физические ряды и в каждом ряду отбрасываем блики
   по медиане top/height и пересечениям. Результат — «ряд за рядом сверху вниз, слева направо»
   (совпадает с порядком раскладки постов). */
function cleanWindows(raw) {
  let cand = raw.filter(([, t, , hgt]) => t >= 3 && t + hgt <= 97);
  if (!cand.length) return [];
  const maxH = Math.max(...cand.map((r) => r[3]));
  cand = cand.filter(([, , , hgt]) => hgt >= 0.6 * maxH);
  return groupRows(cand).flatMap(pruneRow);
}

async function main() {
  parseCliArgs();
  const frames = loadFrames();
  let bases = groupBases(frames);
  if (ONLY) bases = bases.filter((b) => ONLY.has(b.base));
  if (LIMIT > 0) bases = bases.slice(0, LIMIT);

  const result = {};
  const rows = [];               // строки отчёта: {base, code, size, expected, found}
  const mismatch = [];           // базы, где число окон ≠ ожидаемому
  const failed = [];             // базы, где фото не скачалось/не разобралось

  for (const b of bases) {
    try {
      const file = await cachedImage(b.base, b.url);
      const img = await Jimp.read(file);
      const { width: w, height: h } = img.bitmap;
      const rects = cleanWindows(detectRaw(img.bitmap));
      if (!rects.length) { failed.push({ base: b.base, why: "окон не найдено" }); continue; }
      result[b.base] = { aspect: round3(w / h), rects };
      const expected = expectedWindows(b.name);
      rows.push({ base: b.base, code: b.code, size: `${w}x${h}`, expected, found: rects.length });
      if (rects.length !== expected) mismatch.push({ base: b.base, name: b.name, expected, found: rects.length });
    } catch (e) {
      failed.push({ base: b.base, why: String(e && e.message || e) });
    }
  }

  // стабильный порядок ключей — воспроизводимость файла между прогонами
  const sorted = {};
  for (const k of Object.keys(result).sort((a, b) => a.localeCompare(b, "en"))) sorted[k] = result[k];

  const banner =
    `/* Generated by tools/detect-openings.mjs — НЕ ПРАВИТЬ РУКАМИ.\n` +
    `   Монтажные окна накладок VIMAR, СНЯТЫЕ С ДЕТАЛЬНОГО ФОТО (детектор сквозных белых окон).\n` +
    `   Ключ — артикул БЕЗ последнего сегмента (последний сегмент = цвет): 09673.01/09673.04 → 09673,\n` +
    `   а трёхсегментные варианты по числу отверстий остаются раздельными (22673.1/22673.2/22673.3).\n` +
    `   rects — окна слева направо в % от фото [left,top,width,height]; aspect — ширина/высота фото.\n` +
    `   Подмешиваются к накладкам в js/data.js (mountRect/mountRects). Пересобрать: npm run build:openings. */\n`;
  await fsp.writeFile(OUT, banner + `window.EP_VIMAR_OPENINGS = ${JSON.stringify(sorted, null, 2)};\n`, "utf8");

  // ── Отчёт ────────────────────────────────────────────────────────────────
  console.log("Готово:", path.relative(projectRoot, OUT));
  console.log(`  баз обработано: ${rows.length}, окон найдено всего: ${rows.reduce((a, r) => a + r.found, 0)}`);
  console.log("  база     | фото     | ожид. | найдено | пример");
  for (const r of rows.sort((a, b) => a.base.localeCompare(b.base, "en"))) {
    const rc = sorted[r.base].rects;
    console.log(`  ${r.base.padEnd(8)} | ${r.size.padEnd(8)} | ${String(r.expected).padStart(5)} | ${String(r.found).padStart(7)} | ${JSON.stringify(rc)}`);
  }
  if (mismatch.length) {
    console.log(`\n  РАСХОЖДЕНИЕ числа окон с ожидаемым (посмотреть глазами) — ${mismatch.length}:`);
    console.log(`    (ожидание считается по НАЗВАНИЮ и бывает наивным: «14 модулей» — это два ряда 7+7,`);
    console.log(`     а «4 кнопки Flat» — четыре отдельных проёма; расхождение не значит ошибку детектора)`);
    for (const m of mismatch) console.log(`    ${m.base} «${m.name}»: ожидалось ${m.expected}, найдено ${m.found}`);
  } else {
    console.log("\n  расхождений числа окон с ожидаемым нет");
  }
  if (failed.length) {
    console.log(`\n  НЕ УДАЛОСЬ (${failed.length}):`);
    for (const f of failed) console.log(`    ${f.base}: ${f.why}`);
  }
}

/* Запуск main() — ТОЛЬКО когда файл вызван напрямую (`node tools/detect-openings.mjs`), а не когда
   его import-нул автотест ради чистых функций (openingKey/keepComponents/…): иначе тест дёргал бы
   сеть и парсил свой argv через parseArgs. */
const isDirectRun = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirectRun) {
  main().catch((err) => {
    console.error("Ошибка детектора окон:", err);
    process.exitCode = 1;
  });
}

/* Экспорт чистых функций для автотестов (в браузер этот тул не идёт). Правило ключа openingKey и
   отбор пятен keepComponents — под тест-сторожа новой задачи; остальные — под будущие регрессы. */
export { openingKey, expectedWindows, detectRaw, keepComponents, cleanWindows, groupRows, pruneRow };
