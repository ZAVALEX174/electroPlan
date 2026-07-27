/*
 * Воспроизводимый конвертер прайса VIMAR (.xls) → js/catalog-vimar.js.
 *
 * Заменяет разовый скрипт outputs/db_price_import_20260723/build_db_price.mjs,
 * который был завязан на внутренний пакет @oai/artifact-tool (песочница Codex) и
 * не запускался вне неё. Здесь — только SheetJS (dev-зависимость тулинга) и
 * штатный Node: пересобрать каталог может любой в команде — `npm run build:catalog`.
 *
 * Модель работы. Состав каталога — это КУРАТОРСКОЕ решение (какие из 7000+ позиций
 * прайса реально расставляются на плане). Оно зафиксировано в
 * tools/data/catalog-curation.json (стабильные атрибуты: kind, categoryId, icon,
 * серия, module span). Конвертер НЕ переугадывает состав эвристикой каждый раз, а
 * берёт курацию и обновляет из прайса изменчивые данные — цену, наименование,
 * упаковку, ссылки на картинки. Поэтому при новом прайсе (пункт PLAN.md 1.7)
 * достаточно подложить свежий .xls и пересобрать: цены обновятся, а пропавшие/
 * подорожавшие позиции попадут в отчёт.
 *
 * Расширение состава (новые позиции, разбор check_kind) — Фаза 2: правится
 * catalog-curation.json (при желании — с подсказками из classify() в lib/).
 *
 * Флаги (пути по умолчанию — от корня репозитория electro/, все переопределяемы):
 *   --xls     прайс VIMAR (.xls)
 *   --images  индекс картинок vimar.ru (приоритетный источник)
 *   --images-official  индекс из международного каталога (закрывает пропуски)
 *   --spans   выверенные module spans (для сверки ширины механизмов)
 *   --curation  файл кураторского отбора
 *   --out     выходной файл (по умолчанию js/catalog-vimar.js)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createRequire } from "node:module";
import { normalized } from "./lib/classify.mjs";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");      // electroplan-project/
const repoRoot = path.resolve(projectRoot, "..");   // electro/

const { values: args } = parseArgs({
  options: {
    xls: { type: "string" },
    images: { type: "string" },
    "images-official": { type: "string" },
    spans: { type: "string" },
    curation: { type: "string" },
    out: { type: "string" },
  },
});

const resolveArg = (val, fallback) => (val ? path.resolve(val) : fallback);
const SOURCE_XLS = resolveArg(args.xls, path.join(repoRoot, "Прайс VIMAR Евро 01.07.26 (2) (2).xls"));
const IMAGES_RU = resolveArg(args.images, path.join(repoRoot, "outputs/db_price_import_20260723/vimar-ru-image-index.json"));
const IMAGES_OFFICIAL = resolveArg(args["images-official"], path.join(repoRoot, "outputs/db_price_import_20260723/vimar-image-index.json"));
const SPANS = resolveArg(args.spans, path.join(repoRoot, "outputs/catalog_dropdown_import_20260723/vimar-module-spans.json"));
const CURATION = resolveArg(args.curation, path.join(here, "data/catalog-curation.json"));
const OUT = resolveArg(args.out, path.join(projectRoot, "js/catalog-vimar.js"));

const SOURCE_DATE_ISO = "2026-07-01";
const CURRENCY = "EUR";
const UNIT = "шт.";

async function readJson(file, fallback) {
  try {
    const text = await fs.readFile(file, "utf8");
    return JSON.parse(text.replace(/^﻿/, ""));
  } catch (err) {
    if (fallback !== undefined) {
      console.warn(`! Не прочитан ${path.relative(repoRoot, file)}: ${err.message}. Продолжаю без него.`);
      return fallback;
    }
    throw err;
  }
}

function readSourceRows(file) {
  const wb = XLSX.readFile(file);
  // Имя листа в исходнике — "VIMAR " с хвостовым пробелом, поэтому сравниваем по trim().
  const sheetName = wb.SheetNames.find((n) => n.trim() === "VIMAR");
  if (!sheetName) throw new Error(`В книге ${file} нет листа VIMAR (есть: ${wb.SheetNames.join(", ")})`);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1, raw: true, defval: null, blankrows: true,
  });
  // Первые три строки: пустая, заголовок прайса, шапка колонок. Данные с 4-й.
  const byCode = new Map();
  rows.slice(3).forEach((cells, i) => {
    const code = normalized(cells?.[0]);
    if (!code) return;
    // При дублях кода берём первое вхождение (как и прежний пайплайн).
    if (byCode.has(code)) return;
    byCode.set(code, {
      sourceRow: i + 4,
      code,
      name: normalized(cells?.[1]),
      rawPrice: cells?.[2],
      packQty: cells?.[3] ?? null,
      note: normalized(cells?.[4]),
    });
  });
  return byCode;
}

async function loadPreviousPrices(file) {
  // Для отчёта об изменении цен: читаем прошлый каталог, если он есть.
  try {
    const code = await fs.readFile(file, "utf8");
    const sandbox = {};
    new Function("window", code.replace(/^\/\*[\s\S]*?\*\//, ""))(sandbox);
    const prev = sandbox.EP_VIMAR_CATALOG?.products || [];
    return new Map(prev.map((p) => [p.code, p.price]));
  } catch {
    return new Map();
  }
}

async function main() {
  const sourceByCode = readSourceRows(SOURCE_XLS);
  const curationFile = await readJson(CURATION);
  const curation = curationFile.products || [];

  const imageByCode = new Map();
  for (const it of await readJson(IMAGES_OFFICIAL, [])) imageByCode.set(String(it.code).toUpperCase(), it);
  for (const it of await readJson(IMAGES_RU, [])) imageByCode.set(String(it.code).toUpperCase(), it);

  const spans = (await readJson(SPANS, { products: {} })).products || {};
  const prevPrices = await loadPreviousPrices(OUT);

  const products = [];
  const missing = [];        // код есть в курации, но не найден в прайсе
  const priceChanges = [];   // изменения цены относительно прошлого каталога
  const spanMismatch = [];   // module span в курации разошёлся с текущим spans-файлом

  for (const base of curation) {
    const src = sourceByCode.get(base.code);
    if (!src) { missing.push(base.code); continue; }

    const priceValid = typeof src.rawPrice === "number" && Number.isFinite(src.rawPrice) && src.rawPrice > 0;
    const price = priceValid ? Math.round(src.rawPrice * 100) / 100 : 0;
    const image = imageByCode.get(base.code.toUpperCase()) || null;

    // module span сверяем со свежим spans-файлом (курация — источник истины).
    const span = spans[base.code] || null;
    if (span && base.moduleSpan != null && span.moduleSpan !== base.moduleSpan) {
      spanMismatch.push(`${base.code}: курация=${base.moduleSpan}, spans=${span.moduleSpan}`);
    }

    const prev = prevPrices.get(base.code);
    if (prev != null && prev !== price) priceChanges.push({ code: base.code, from: prev, to: price });

    // Берём кураторский снимок как основу и обновляем ТОЛЬКО изменчивые поля из
    // прайса и индекса картинок. Всё остальное (kind, categoryId, icon, series,
    // геометрия slotCount/mountRect, moduleSpan) сохраняется как есть.
    const product = structuredClone(base);
    product.id = 100000 + src.sourceRow;
    product.name = src.name;
    product.price = price;
    product.currency = CURRENCY;
    product.unit = UNIT;
    product.active = priceValid;
    if (image) {
      product.previewImageUrl = image.preview_image_url || "";
      product.imageUrl = image.image_url || "";
      product.productPageUrl = image.product_page_url || "";
    }
    product.properties = { ...(base.properties || {}) };
    product.properties.sourceRow = src.sourceRow;
    product.properties.sourceDate = SOURCE_DATE_ISO;
    product.properties.packQty = src.packQty ?? null;
    if (image) product.properties.imageSource = image.image_source || null;

    products.push(product);
  }

  products.sort((a, b) => a.code.localeCompare(b.code, "en"));

  const kindCount = (k) => products.filter((p) => p.kind === k).length;
  const meta = {
    source: path.basename(SOURCE_XLS),
    sourceDate: SOURCE_DATE_ISO,
    currency: CURRENCY,
    generatedAt: new Date().toISOString().slice(0, 10),
    mechanisms: kindCount("mechanism"),
    verifiedModuleSpans: products.filter((p) => p.moduleSpan != null).length,
    frames: kindCount("frame"),
    socketBoxes: kindCount("socket_box"),
  };

  const banner =
    `/* Generated from the VIMAR price list dated ${SOURCE_DATE_ISO}.\n` +
    `   Пересобирается: npm run build:catalog (tools/build-catalog.mjs).\n` +
    `   Состав — из tools/data/catalog-curation.json. РУЧНЫЕ ПРАВКИ ЗДЕСЬ ТЕРЯЮТСЯ. */\n`;
  await fs.writeFile(OUT, banner + `window.EP_VIMAR_CATALOG = ${JSON.stringify({ meta, products }, null, 2)};\n`, "utf8");

  console.log("Готово:", path.relative(repoRoot, OUT));
  console.log(`  курация:            ${curation.length} позиций`);
  console.log(`  собрано в каталог:  ${products.length}`);
  console.log(`  по типам:           mechanism=${meta.mechanisms}, frame=${meta.frames}, socket_box=${meta.socketBoxes}`);
  console.log(`  с картинкой:        ${products.filter((p) => p.imageUrl).length}`);
  if (missing.length) {
    console.log(`  ! НЕТ В ПРАЙСЕ:     ${missing.length} — ${missing.slice(0, 15).join(", ")}${missing.length > 15 ? " …" : ""}`);
  }
  if (priceChanges.length) {
    console.log(`  изменились цены:    ${priceChanges.length}`);
    for (const ch of priceChanges.slice(0, 10)) console.log(`      ${ch.code}: ${ch.from} → ${ch.to} ${CURRENCY}`);
    if (priceChanges.length > 10) console.log(`      … ещё ${priceChanges.length - 10}`);
  }
  if (spanMismatch.length) {
    console.log(`  ! module span разошёлся: ${spanMismatch.length} — ${spanMismatch.slice(0, 8).join("; ")}`);
  }
}

main().catch((err) => {
  console.error("Ошибка сборки каталога:", err);
  process.exitCode = 1;
});
