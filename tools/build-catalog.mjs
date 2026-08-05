/*
 * Воспроизводимый конвертер каталога ElectroPlan → js/catalog-vimar.js.
 *
 * СОСТАВ И АТРИБУТЫ каталога берутся из файла номенклатуры заказчика
 * («Номенклатура новая.xls»): серия, размер в модулях, монтажный стандарт, тип стены,
 * функциональная группа, число уровней рамки, цвет. Это заменило прежнюю курацию по
 * прайсу (tools/data/catalog-curation.json) и эвристику классификации по названию:
 * теперь всё в явном виде. Чтение и классификация — в tools/lib/nomenclature.mjs.
 *
 * ЦЕНА берётся из актуального прайса VIMAR по артикулу. Прайсовые цены свежее, чем в
 * номенклатуре (в номенклатуре они устаревшие — почти все расходятся), поэтому источник
 * цены — прайс. Если артикула в прайсе нет (новинки вроде 02973, 03925) — берём цену из
 * номенклатуры и помечаем properties.priceSource="nomenclature".
 *
 * ID товаров стабильны: сопоставляются по артикулу через tools/data/catalog-ids.json
 * (сид снят из прежнего каталога — старые сохранённые проекты сохраняют ссылки). Новым
 * артикулам выдаётся id из диапазона 200000+ и дописывается в тот же файл. Так повторный
 * запуск даёт тот же результат (см. README).
 *
 * Флаги (пути по умолчанию — от корня electro/, переопределяемы):
 *   --nom     файл номенклатуры (.xls)
 *   --xls     прайс VIMAR (.xls) — источник цен
 *   --images / --images-official   индексы картинок vimar.ru / международного каталога
 *   --ids     файл стабильных id (tools/data/catalog-ids.json)
 *   --out     выходной файл (js/catalog-vimar.js)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createRequire } from "node:module";
import { readNomenclature, applyKindOverrides, resolveCatalogPrice, DEFAULT_NOMENCLATURE } from "./lib/nomenclature.mjs";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");        // electroplan-project/
const repoRoot = path.resolve(projectRoot, "..");     // electro/

const { values: args } = parseArgs({
  options: {
    nom: { type: "string" },
    xls: { type: "string" },
    images: { type: "string" },
    "images-official": { type: "string" },
    ids: { type: "string" },
    out: { type: "string" },
    overrides: { type: "string" },
    "image-overrides": { type: "string" },
  },
});
const resolveArg = (val, fallback) => (val ? path.resolve(val) : fallback);
const NOM = resolveArg(args.nom, DEFAULT_NOMENCLATURE);
const PRICE = resolveArg(args.xls, path.join(repoRoot, "Прайс VIMAR Евро 01.07.26 (2) (2).xls"));
const IMAGES_RU = resolveArg(args.images, path.join(repoRoot, "outputs/db_price_import_20260723/vimar-ru-image-index.json"));
const IMAGES_OFFICIAL = resolveArg(args["images-official"], path.join(repoRoot, "outputs/db_price_import_20260723/vimar-image-index.json"));
const IDS = resolveArg(args.ids, path.join(here, "data/catalog-ids.json"));
const OVERRIDES = resolveArg(args.overrides, path.join(here, "data/kind-overrides.json"));
const IMAGE_OVERRIDES = resolveArg(args["image-overrides"], path.join(here, "data/image-overrides.json"));
const OUT = resolveArg(args.out, path.join(projectRoot, "js/catalog-vimar.js"));

const PRICE_DATE_ISO = "2026-07-01";
const CURRENCY = "EUR";
const UNIT = "шт.";
const NEW_ID_BASE = 200000;   // новые артикулы — вне диапазона сид-id (≤107360), без коллизий

const norm = (v) => String(v ?? "").trim();

async function readJson(file, fallback) {
  try {
    return JSON.parse((await fs.readFile(file, "utf8")).replace(/^﻿/, ""));
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw err;
  }
}

/* Цены из прайса. Читаем ячейки напрямую и берём только числовые (t==="n"): в колонке
   цены есть ячейки-ошибки (#REF!/#DIV0), их нельзя принять за цену. Шапка прайса — в
   строке 3 (индекс 2), данные с 4-й (индекс 3); колонки: A артикул, C цена, D упаковка. */
function readPrices(file) {
  const wb = XLSX.readFile(file);
  const sheetName = wb.SheetNames.find((n) => n.trim() === "VIMAR");
  if (!sheetName) throw new Error(`В прайсе ${file} нет листа VIMAR (есть: ${wb.SheetNames.join(", ")})`);
  const ws = wb.Sheets[sheetName];
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const byCode = new Map();
  for (let r = 3; r <= range.e.r; r++) {
    const codeCell = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    const code = codeCell ? norm(codeCell.v) : "";
    if (!code || byCode.has(code)) continue;   // при дублях берём первое вхождение
    const priceCell = ws[XLSX.utils.encode_cell({ r, c: 2 })];
    const packCell = ws[XLSX.utils.encode_cell({ r, c: 3 })];
    const price = priceCell && priceCell.t === "n" && Number.isFinite(priceCell.v) && priceCell.v > 0 ? priceCell.v : null;
    const pack = packCell && packCell.t === "n" ? packCell.v : null;
    byCode.set(code, { price, pack });
  }
  return byCode;
}

async function main() {
  const { records, stats } = readNomenclature(NOM);
  // Явные переклассификации kind (утверждены владельцем) применяем ПОСЛЕ чтения
  // номенклатуры, тем же оверрайдом, что и build-catalog-attrs.mjs → каталог и attrs
  // согласованы. Пустой/отсутствующий файл — просто ноль правок (сборка не падает).
  const overridesDoc = await readJson(OVERRIDES, { overrides: {} });
  const { applied: overridesApplied } = applyKindOverrides(records, overridesDoc.overrides || {});
  const priceByCode = readPrices(PRICE);

  const imageByCode = new Map();
  for (const it of await readJson(IMAGES_OFFICIAL, [])) imageByCode.set(String(it.code).toUpperCase(), it);
  for (const it of await readJson(IMAGES_RU, [])) imageByCode.set(String(it.code).toUpperCase(), it);
  // Точечные override фото (tools/data/image-overrides.json) — ПОСЛЕ обоих индексов, чтобы
  // реальный URL победил заглушку no_photo.png из RU (у монтажных коробок фото есть только на
  // vimar.com; на vimar.ru индекс отдаёт no_photo, в official-индексе их нет). Одно фото
  // кладём и в preview, и в image → productImage отдаёт его и в превью, и в детальном режиме.
  // Пустой/отсутствующий файл — ноль правок, сборка не падает (как kind-overrides).
  const imageOverridesDoc = await readJson(IMAGE_OVERRIDES, { overrides: {} });
  let imageOverridesApplied = 0;
  for (const [code, ov] of Object.entries(imageOverridesDoc.overrides || {})) {
    const url = ov && ov.imageUrl;
    if (!url) continue;
    imageByCode.set(String(code).toUpperCase(), { code, preview_image_url: url, image_url: url, image_source: "vimar.com override" });
    imageOverridesApplied++;
  }

  const idsFile = await readJson(IDS, { ids: {} });
  const idMap = { ...(idsFile.ids || {}) };

  const products = [];
  const merge = { fromPrice: 0, fromNomenclature: 0, missingInPrice: [], priceDiffs: 0, withImage: 0, newIds: 0 };

  for (const rec of records) {
    const pr = priceByCode.get(rec.code);
    const { price, source: priceSource } = resolveCatalogPrice(rec.nomPrice, pr);
    if (priceSource === "price") {
      merge.fromPrice++;
      if (rec.nomPrice != null && Math.round(rec.nomPrice * 100) !== Math.round(pr.price * 100)) merge.priceDiffs++;
    } else {
      merge.fromNomenclature++;
      merge.missingInPrice.push(rec.code);
    }

    // стабильный id по артикулу; новому — из диапазона 200000+ (детерминировано по строке)
    let id = idMap[rec.code];
    if (id == null) {
      id = NEW_ID_BASE + rec.sourceRow;
      idMap[rec.code] = id;
      merge.newIds++;
    }

    const image = imageByCode.get(rec.code.toUpperCase()) || null;
    if (image) merge.withImage++;

    /* В файл кладём ТОЛЬКО поля, которые читает рантайм (js/data.js подмешивает признаки
       автосостава из catalog-vimar-attrs.js отдельно, а классификация/цены посчитаны здесь
       конвертером). Служебные поля прежнего блока properties (sourceRow, priceSource/Date,
       packQty, functionalGroup, standard, wallType, moduleSize, frameLevels, boxModularity,
       principle, note, subgroup, accessGroup, imageSource) и productPageUrl рантайму не
       нужны — не выводим их, чтобы каталог не раздувался (см. README/отчёт). Все эти данные
       остаются в источнике (номенклатура) и восстанавливаются пересборкой. */
    const product = {
      id,
      categoryId: rec.categoryId,
      code: rec.code,
      name: rec.name,
      kind: rec.kind,
      icon: rec.icon,
      price,
      currency: CURRENCY,
      unit: UNIT,
      active: price > 0,
      series: rec.series,
      compatibility: rec.series.join(", "),
    };
    if (image) {
      product.previewImageUrl = image.preview_image_url || "";
      product.imageUrl = image.image_url || "";
    }
    // moduleSpan механизма — только валидное (1..8), иначе рантайм выведет из названия/1
    if (rec.kind === "mechanism" && Number.isInteger(rec.moduleSize) && rec.moduleSize >= 1 && rec.moduleSize <= 8) {
      product.moduleSpan = rec.moduleSize;
    }
    // slotCount рамки — ёмкость в модулях (frameSlotCount учитывает 1..8, крупнее игнорит)
    if (rec.kind === "frame" && rec.slotCount != null) product.slotCount = rec.slotCount;
    // Цвет — единственное поле прежнего properties, которое читает рантайм (app.js берёт
    // frame.color для листа монтажника/КП). В номенклатуре «Цвет элемента» заполнен только
    // у механизмов (у рамок/суппортов/коробок пусто), но выносим на верхний уровень для всех
    // — сохраняем атрибут и оставляем рабочим frame.color (падение с прежнего frame.properties.color).
    if (rec.color) product.color = rec.color;

    products.push(product);
  }

  products.sort((a, b) => a.code.localeCompare(b.code, "en"));

  const kindCount = (k) => products.filter((p) => p.kind === k).length;
  const meta = {
    source: path.basename(NOM),
    priceSource: path.basename(PRICE),
    priceDate: PRICE_DATE_ISO,
    currency: CURRENCY,
    generatedAt: new Date().toISOString().slice(0, 10),
    total: products.length,
    mechanisms: kindCount("mechanism"),
    frames: kindCount("frame"),
    socketBoxes: kindCount("socket_box"),
    supports: kindCount("support"),
    accessories: kindCount("accessory"),
    pricedFromPrice: merge.fromPrice,
    pricedFromNomenclature: merge.fromNomenclature,
  };

  // Стабильные id: дописываем новые артикулы обратно в тот же файл (сортировка по коду
  // — детерминированный порядок). После первого прогона карта полна → повторный
  // запуск идентичен.
  const sortedIds = Object.fromEntries(Object.keys(idMap).sort((a, b) => a.localeCompare(b, "en")).map((k) => [k, idMap[k]]));
  await fs.writeFile(IDS, JSON.stringify({ ...idsFile, ids: sortedIds }, null, 2) + "\n", "utf8");

  const banner =
    `/* Generated from «${path.basename(NOM)}» (состав/атрибуты) + «${path.basename(PRICE)}» (цены, ${PRICE_DATE_ISO}).\n` +
    `   Пересобирается: npm run build:catalog (tools/build-catalog.mjs). РУЧНЫЕ ПРАВКИ ЗДЕСЬ ТЕРЯЮТСЯ.\n` +
    `   JSON без форматирования (одна строка) — файл грузится синхронно при каждом открытии,\n` +
    `   минификация втрое уменьшает вес; читать/править исходники, не этот файл.\n` +
    `   Признаки автосостава поста (стандарт/коробка/суппорт) — в js/catalog-vimar-attrs.js (npm run build:attrs). */\n`;
  // Без отступов: детерминированный порядок ключей сохраняется (объекты строятся в фиксированном
  // порядке, products отсортированы по коду) → повторный прогон даёт идентичный файл.
  await fs.writeFile(OUT, banner + `window.EP_VIMAR_CATALOG = ${JSON.stringify({ meta, products })};\n`, "utf8");

  console.log("Готово:", path.relative(repoRoot, OUT));
  console.log(`  номенклатура:       ${stats.withCode} строк, в каталог ${products.length} (исключено по серии: ${stats.excluded}, дублей: ${stats.dupCodes.length})`);
  console.log(`  по типам:           mechanism=${meta.mechanisms}, frame=${meta.frames}, socket_box=${meta.socketBoxes}, support=${meta.supports}, accessory=${meta.accessories}`);
  console.log(`  kind-оверрайдов:    ${overridesApplied} (tools/data/kind-overrides.json)`);
  console.log(`  фото-оверрайдов:    ${imageOverridesApplied} (tools/data/image-overrides.json)`);
  console.log(`  цена из прайса:     ${merge.fromPrice} (расхождений ном/прайс: ${merge.priceDiffs})`);
  console.log(`  цена из номенкл.:   ${merge.fromNomenclature} (нет в прайсе)`);
  console.log(`  новых id (200000+): ${merge.newIds}, стабильных по сиду: ${products.length - merge.newIds}`);
  console.log(`  с картинкой:        ${merge.withImage}`);
  if (merge.missingInPrice.length) {
    console.log(`  нет в прайсе (первые 20): ${merge.missingInPrice.slice(0, 20).join(", ")}${merge.missingInPrice.length > 20 ? " …" : ""}`);
  }
}

main().catch((err) => {
  console.error("Ошибка сборки каталога:", err);
  process.exitCode = 1;
});
