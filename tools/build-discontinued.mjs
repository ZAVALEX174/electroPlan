/*
 * Воспроизводимый сборщик снятых с производства позиций → js/catalog-vimar-discontinued.js.
 *
 * Номенклатура К2 убрала часть артикулов прежнего каталога. Решение владельца (В23): в новые посты
 * их не предлагать, но в сохранённых проектах оставить на месте с прежней ценой и пометкой «снята
 * с производства». Этот сборщик берёт из снимка прежнего каталога (tools/data/discontinued-732ae3a.json)
 * артикулы, которых НЕТ в текущей номенклатуре, и кладёт их отдельным глобалом window.EP_VIMAR_DISCONTINUED
 * с active=false, прежним id (сверен с catalog-ids.json) и уже вмешанными признаками автосостава.
 *
 * Почему отдельным файлом, а не внутри catalog-vimar.js: тот файл и catalog-vimar-attrs.js описывают
 * ОТГРУЖАЕМЫЙ каталог строго по текущей номенклатуре — на их состав и счётчики опираются тесты.
 * Снятые — это хвост для уже сохранённых проектов; js/data.js домешивает его к EP_DATA.products при
 * загрузке, поэтому в рантайме подбор един (byKind фильтрует active → снятые не идут в новые посты).
 *
 * Флаги: --nom файл номенклатуры (.xls), --snapshot снимок, --ids стабильные id, --out выходной файл.
 * Запуск по умолчанию: npm run build:discontinued
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { Jimp } from "jimp";
import { readNomenclature2026, DEFAULT_NOMENCLATURE_2026 } from "./lib/nomenclature2026.mjs";
import { collectDiscontinued } from "./lib/discontinued.mjs";
import { localImagePaths, isDeadImageUrl } from "./lib/catalog-images.mjs";
import { buildContentMask, labelComponents, chooseFace } from "./lib/faces.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");

/* Снятые механизмы, чьё лицо (faceRect) в снимке 732ae3a снято со СТАРОГО фото и расходится с
   нынешним ЛОКАЛЬНЫМ фото настолько, что режет не лицо модуля, а середину кадра. Для них лицо
   пересчитываем ТЕМ ЖЕ детектором, что активные механизмы (tools/lib/faces.mjs по локальному фото),
   а не правим цифрой руками. Список узкий и ЯВНЫЙ намеренно: снимок заморожен на 732ae3a (до
   переезда картинок в программу), а детектор по текущим фото дал бы и у остальных снятых сдвиг лица
   на доли процента — их менять без решения владельца нельзя (§7.1: обратная совместимость уже
   сохранённых проектов). Сейчас в списке только 19345.M (USB, Metal): его прежняя разметка width
   42.2% вырезала середину, детектор по локальному фото даёт лицо во всю ширину модуля. */
const REFACE_FROM_LOCAL = new Set(["19345.M"]);

const { values: args } = parseArgs({
  options: { nom: { type: "string" }, snapshot: { type: "string" }, ids: { type: "string" }, out: { type: "string" } },
});
const NOM = args.nom ? path.resolve(args.nom) : DEFAULT_NOMENCLATURE_2026;
const SNAPSHOT = args.snapshot ? path.resolve(args.snapshot) : path.join(here, "data/discontinued-732ae3a.json");
const IDS = args.ids ? path.resolve(args.ids) : path.join(here, "data/catalog-ids.json");
const OUT = args.out ? path.resolve(args.out) : path.join(projectRoot, "js/catalog-vimar-discontinued.js");

async function readJson(file) {
  return JSON.parse((await fs.readFile(file, "utf8")).replace(/^﻿/, ""));
}

/* EPCatalog (js/catalog.js) — чтобы span и выбор фото совпадали с рантаймом и с detect-faces (та же
   пара mechanismSpan/productImage). catalog.js — обычный window-скрипт, как остальной tooling. */
function loadEPCatalog() {
  globalThis.window = globalThis.window || {};
  createRequire(import.meta.url)(path.join(projectRoot, "js/catalog.js"));
  return globalThis.window.EPCatalog;
}

/* Лицо механизма по его ЛОКАЛЬНОМУ фото — тот же путь, что в tools/detect-faces.mjs для активных:
   маска содержимого → связные компоненты → выбор компонента-модуля и прямоугольник лица (faces.mjs).
   Возвращает faceRect-ОБЪЕКТ {left,top,width,height} (в снятых faceRect хранится объектом), или null,
   если детектор не выделил модуль (составная позиция / пустой кадр) — тогда зовущий остановит сборку. */
async function faceFromLocalPhoto(product, EPCatalog) {
  const url = EPCatalog.productImage(product, { detail: true });
  if (!url || /^https?:\/\//i.test(url)) return null; // нужен локальный файл, а не ссылка на сайт
  const img = await Jimp.read(path.join(projectRoot, url));
  const { width: w, height: h } = img.bitmap;
  const comps = labelComponents(buildContentMask(img.bitmap), w, h);
  const dec = chooseFace(comps, EPCatalog.mechanismSpan(product), w, h);
  if (dec.decision !== "face") return null;
  const [left, top, width, height] = dec.face;
  return { left, top, width, height };
}

async function main() {
  const { records } = readNomenclature2026(NOM);
  const activeCodes = new Set(records.map((r) => r.code));
  const snapshot = await readJson(SNAPSHOT);
  const idMap = (await readJson(IDS)).ids || {};

  const { products, idWarnings } = collectDiscontinued(snapshot.products || [], activeCodes, idMap);
  // Картинки — ОДНО правило с основным каталогом (tools/lib/catalog-images.mjs): свой файл
  // (img/catalog/, tools/download-catalog-images.mjs) первым ВСЕГДА — .jpg, а если его нет, то
  // .webp (решение владельца 04.11); ссылка на сайт VIMAR — только запасная. Своего файла нет —
  // мёртвую ссылку из снимка (vimar.ru лёг 03.11 / заглушку no_photo) убираем, чтобы рантайм
  // показал свою заглушку «нет фото», а не пустой квадрат. Живой vimar.com не трогаем.
  const IMG_DIR = path.join(projectRoot, "img", "catalog");
  for (const p of products) {
    const local = localImagePaths(IMG_DIR, p.code);
    if (local.full) {
      p.imageUrl = local.full;
      p.previewImageUrl = local.preview;
    } else {
      if (isDeadImageUrl(p.imageUrl)) delete p.imageUrl;
      if (isDeadImageUrl(p.previewImageUrl)) delete p.previewImageUrl;
    }
  }
  // Пересчёт лица по локальному фото для узкого списка (REFACE_FROM_LOCAL) — detect-faces активных их
  // не трогает (их уже нет в catalog-vimar.js), а снимок несёт прежнюю разметку со старого фото.
  const EPCatalog = loadEPCatalog();
  for (const p of products) {
    if (!REFACE_FROM_LOCAL.has(p.code)) continue;
    const rect = await faceFromLocalPhoto(p, EPCatalog);
    if (!rect) throw new Error(`Лицо ${p.code}: детектор не выделил модуль по локальному фото (нет файла / составная позиция)`);
    p.faceRect = rect;
  }
  if (idWarnings.length) {
    // Прежний id из снимка и из catalog-ids.json обязаны совпадать — иначе сохранённый проект
    // получит чужую цену/состав. Расхождение останавливает сборку (§7.1), а не молча берёт один id.
    const detail = idWarnings.slice(0, 20).map((w) => `${w.code}: снимок ${w.snapshotId} ≠ ids ${w.idsFileId}`).join("; ");
    throw new Error(`Снятые позиции: id снимка ${snapshot.commit} расходится с catalog-ids.json (${idWarnings.length}): ${detail}`);
  }

  const kindCount = (k) => products.filter((p) => p.kind === k).length;
  const meta = {
    source: snapshot.commit ? `снимок ${snapshot.commit}` : path.basename(SNAPSHOT),
    generatedAt: new Date().toISOString().slice(0, 10),
    total: products.length,
    mechanisms: kindCount("mechanism"),
    frames: kindCount("frame"),
    socketBoxes: kindCount("socket_box"),
    supports: kindCount("support"),
    accessories: kindCount("accessory"),
  };

  const banner =
    `/* Generated by tools/build-discontinued.mjs — СНЯТЫЕ С ПРОИЗВОДСТВА позиции (В23/К2). НЕ ПРАВИТЬ РУКАМИ.\n` +
    `   Артикулы прежнего каталога (снимок ${snapshot.commit}), которых нет в текущей номенклатуре: active=false,\n` +
    `   прежние id/цена и вмешанные признаки. js/data.js домешивает их к EP_DATA.products — новым постам не\n` +
    `   предлагаются (byKind фильтрует active), в сохранённых проектах считаются по своей цене.\n` +
    `   Пересобирается: npm run build:discontinued. Снимок — tools/make-discontinued-snapshot.mjs. */\n`;
  await fs.writeFile(OUT, banner + `window.EP_VIMAR_DISCONTINUED = ${JSON.stringify({ meta, products })};\n`, "utf8");

  console.log("Готово:", path.relative(projectRoot, OUT));
  console.log(`  снято с производства: ${products.length} (из снимка ${snapshot.commit})`);
  console.log(`  по типам:             mechanism=${meta.mechanisms}, frame=${meta.frames}, socket_box=${meta.socketBoxes}, support=${meta.supports}, accessory=${meta.accessories}`);
}

main().catch((err) => {
  console.error("Ошибка сборки снятых позиций:", err);
  process.exitCode = 1;
});
