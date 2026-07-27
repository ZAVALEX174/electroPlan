/*
 * Discovery для Фазы 2: находит позиции прайса VIMAR, которых ещё НЕТ в каталоге
 * (tools/data/catalog-curation.json), и раскладывает их по вероятному типу и по
 * префиксу артикула (прокси серии — по названию серия почти не читается).
 *
 * Цель — дать заказчику/нам основу для решения «что добавлять»: сколько ещё
 * механизмов/рамок/подрозетников в прайсе, по каким сериям (префиксам), у скольких
 * есть фото. Ничего не меняет в каталоге — только отчёт в docs/.
 *
 * Запуск: node tools/discover-candidates.mjs   (пути как у build-catalog.mjs)
 *
 * ВНИМАНИЕ: тип определяется эвристикой по названию и потому приблизителен —
 * это материал для ревью человеком, а не готовый список на импорт.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createRequire } from "node:module";
import { lower, normalized } from "./lib/classify.mjs";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const repoRoot = path.resolve(projectRoot, "..");

const { values: args } = parseArgs({
  options: {
    xls: { type: "string" },
    images: { type: "string" },
    "images-official": { type: "string" },
    curation: { type: "string" },
    out: { type: "string" },
  },
});
const resolveArg = (v, f) => (v ? path.resolve(v) : f);
const SOURCE_XLS = resolveArg(args.xls, path.join(repoRoot, "Прайс VIMAR Евро 01.07.26 (2) (2).xls"));
const IMAGES_RU = resolveArg(args.images, path.join(repoRoot, "outputs/db_price_import_20260723/vimar-ru-image-index.json"));
const IMAGES_OFFICIAL = resolveArg(args["images-official"], path.join(repoRoot, "outputs/db_price_import_20260723/vimar-image-index.json"));
const CURATION = resolveArg(args.curation, path.join(here, "data/catalog-curation.json"));
const OUT = resolveArg(args.out, path.join(projectRoot, "docs/кандидаты-фаза2.md"));

async function readJson(file, fallback) {
  try { return JSON.parse((await fs.readFile(file, "utf8")).replace(/^﻿/, "")); }
  catch (e) { if (fallback !== undefined) return fallback; throw e; }
}

function readSourceRows(file) {
  const wb = XLSX.readFile(file);
  const name = wb.SheetNames.find((n) => n.trim() === "VIMAR");
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: true });
  return rows.slice(3).map((c, i) => ({
    sourceRow: i + 4, code: normalized(c?.[0]), name: normalized(c?.[1]), rawPrice: c?.[2], packQty: c?.[3] ?? null,
  })).filter((r) => r.code);
}

// Префикс артикула = ведущие буквы + первые две цифры (прокси серии).
const prefixOf = (code) => (String(code).match(/^([A-Za-z]*\d{2})/)?.[1] || String(code).slice(0, 2));

// Эвристика типа для discovery. Отличается от classify() в lib/: там цель —
// консервативно (высокая уверенность) типизировать для DB-импорта, здесь —
// пошире выявить КАНДИДАТОВ на расстановку, чтобы человек отсеял лишнее.
const ACCESSORY = ["накладк", "клавиш", "крышк", "суппорт", "адаптер", "корпус", "креплен", "винт", "кабел", "провод", "ремеш", "проставк", "протяжк", "заглушк", "маркиров", "шильд", "этикетк"];
const DEVICE = ["розетк", "выключател", "переключател", "кнопк", "диммер", "светорегулятор", "термостат", "датчик", "регулятор", "зарядное", "разъем", "разъём", "звонок", "индикатор", "таймер", "реле", "извещател"];

function bucketOf(name) {
  const t = lower(name);
  const isAccessory = ACCESSORY.some((w) => t.startsWith(w));
  if (t.includes("подрозетник") || (t.includes("коробк") && /скрыт|монтаж|встраиваем|полых стен|кирпич/.test(t) && !isAccessory)) return "socket_box";
  if (/накладк|рамк/.test(t) && /(?:\b[1-9]\s*(?:мод|пост|мест)|\b[1-9]f\b)/.test(t) && !/для (розет|выключ|переключ|кноп|термостат|разъ|короб|суппорт)/.test(t)) return "frame";
  if (DEVICE.some((w) => t.startsWith(w)) && !isAccessory) return "mechanism";
  if (DEVICE.some((w) => t.includes(w)) && !isAccessory) return "mechanism_maybe";
  return "other";
}

const BUCKET_TITLES = {
  mechanism: "Механизмы (высокая уверенность)",
  mechanism_maybe: "Механизмы (под вопросом — проверить)",
  frame: "Рамки / накладки",
  socket_box: "Подрозетники / монтажные коробки",
};

async function main() {
  const rows = readSourceRows(SOURCE_XLS);
  const curation = new Set(((await readJson(CURATION)).products || []).map((p) => String(p.code)));
  const imageCodes = new Set();
  for (const it of await readJson(IMAGES_OFFICIAL, [])) imageCodes.add(String(it.code).toUpperCase());
  for (const it of await readJson(IMAGES_RU, [])) imageCodes.add(String(it.code).toUpperCase());

  const buckets = { mechanism: [], mechanism_maybe: [], frame: [], socket_box: [], other: [] };
  let inCatalog = 0, noPrice = 0;
  for (const r of rows) {
    if (curation.has(r.code)) { inCatalog++; continue; }
    const priceValid = typeof r.rawPrice === "number" && Number.isFinite(r.rawPrice) && r.rawPrice > 0;
    if (!priceValid) { noPrice++; continue; }
    buckets[bucketOf(r.name)].push({ ...r, hasImage: imageCodes.has(r.code.toUpperCase()) });
  }

  // Отчёт
  const L = [];
  L.push("# Кандидаты в каталог — Фаза 2 (discovery)");
  L.push("");
  L.push(`> Автоотчёт \`tools/discover-candidates.mjs\` от ${new Date().toISOString().slice(0, 10)}. `
    + `Прайс: \`${path.basename(SOURCE_XLS)}\`.`);
  L.push("> **Тип определён эвристикой по названию — это материал для ревью, не готовый импорт.** "
    + "Серию по названию не видно, поэтому кандидаты сгруппированы по **префиксу артикула** (прокси серии): "
    + "подпишите префикс → серия по официальному каталогу VIMAR (см. вопрос 6.1 заказчику).");
  L.push("");
  L.push("## Итог");
  L.push("");
  L.push("| Категория | Позиций | С фото |");
  L.push("|---|---:|---:|");
  L.push(`| Уже в каталоге | ${inCatalog} | — |`);
  for (const k of ["mechanism", "mechanism_maybe", "frame", "socket_box", "other"]) {
    const withImg = buckets[k].filter((x) => x.hasImage).length;
    const title = BUCKET_TITLES[k] || "Прочее / аксессуары (на план не ставятся)";
    L.push(`| ${title} | ${buckets[k].length} | ${withImg} |`);
  }
  L.push(`| Без цены (пропущены) | ${noPrice} | — |`);
  L.push("");

  for (const k of ["mechanism", "mechanism_maybe", "frame", "socket_box"]) {
    const list = buckets[k];
    if (!list.length) continue;
    L.push(`## ${BUCKET_TITLES[k]} — ${list.length}`);
    L.push("");
    // группировка по префиксу
    const byPrefix = new Map();
    for (const x of list) {
      const pf = prefixOf(x.code);
      if (!byPrefix.has(pf)) byPrefix.set(pf, []);
      byPrefix.get(pf).push(x);
    }
    const prefixes = [...byPrefix.entries()].sort((a, b) => b[1].length - a[1].length);
    L.push("| Префикс (серия?) | Позиций | С фото | Примеры |");
    L.push("|---|---:|---:|---|");
    for (const [pf, xs] of prefixes) {
      const withImg = xs.filter((x) => x.hasImage).length;
      const examples = xs.slice(0, 2).map((x) => `${x.code} — ${x.name.slice(0, 40)}`).join("; ");
      L.push(`| \`${pf}\` __→ ______ | ${xs.length} | ${withImg} | ${examples.replace(/\|/g, "/")} |`);
    }
    L.push("");
  }

  L.push("## Как пользоваться");
  L.push("");
  L.push("1. В колонке «Префикс (серия?)» впишите название серии VIMAR напротив префикса.");
  L.push("2. Отметьте, какие префиксы/типы включаем в каталог (по ответам на [вопросы заказчику](вопросы-заказчику-каталог.md), раздел 1–2).");
  L.push("3. Отобранные коды добавляются в `tools/data/catalog-curation.json`, затем `npm run build:catalog`.");
  L.push("4. «Механизмы под вопросом» и «Прочее» — просмотреть выборочно: эвристика могла ошибиться в обе стороны.");
  L.push("");

  await fs.writeFile(OUT, L.join("\n"), "utf8");

  console.log("Отчёт:", path.relative(repoRoot, OUT));
  console.log(`  всего в прайсе:        ${rows.length}`);
  console.log(`  уже в каталоге:        ${inCatalog}`);
  for (const k of ["mechanism", "mechanism_maybe", "frame", "socket_box", "other"]) {
    const t = BUCKET_TITLES[k] || "прочее/аксессуары";
    console.log(`  ${t.padEnd(38)} ${String(buckets[k].length).padStart(4)}  (с фото ${buckets[k].filter((x) => x.hasImage).length})`);
  }
  console.log(`  без цены:              ${noPrice}`);
}

main().catch((e) => { console.error("Ошибка discovery:", e); process.exitCode = 1; });
