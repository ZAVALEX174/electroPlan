/*
 * Воспроизводимый генератор атрибутов поста для рантайма → js/catalog-vimar-attrs.js.
 *
 * Зачем отдельный файл. Для автосостава поста приложению нужны два признака, которых
 * НЕТ в js/catalog-vimar.js: монтажный СТАНДАРТ накладки (IT/DE/FR/…) и ТИП СТЕНЫ
 * коробки (solid/hollow). Править сгенерированный catalog-vimar.js руками нельзя
 * (он пересобирается конвертером), а fetch() JSON с диска не работает при открытии
 * index.html через file:// (PLAN 2.2). Поэтому признаки выносятся в отдельный
 * JS-глобал (как сам каталог) и подмешиваются к товарам при загрузке (js/data.js).
 *
 * Источники (все уже в репозитории, результат детерминирован):
 *   - стандарт накладки/суппорта — колонки `standard`/`postCount`/`frameModules`/
 *                          `moduleCount`/`pitchMm` прайса tools/data/price-parsed.csv
 *                          (по коду, затем по базе);
 *   - тип стены коробки  — tools/data/box-wall-type.json (сведён из официального
 *                          каталога VIMAR, см. tools/data/compat-external.json);
 *   - форма и совместимые стандарты коробки — tools/data/compat-external.json
 *                          (официальный каталог: round60→круглая, rect→прямоугольная;
 *                          круглая коробка одна на пост — годится IT_ROUND/DE/FR,
 *                          прямоугольная — итальянская сборка IT).
 * Состав кодов берём из текущего js/catalog-vimar.js, чтобы карта была компактной
 * и относилась ровно к позициям каталога. После пересборки каталога генератор
 * нужно перезапустить: `node tools/build-catalog-attrs.mjs`.
 *
 * Автосостав поста читает эти признаки так:
 *   frames[code]/standards[code] — стандарт накладки (IT/DE/FR/…);
 *   supports[code] — стандарт, число модулей и межосевой шаг суппорта (для findSupport);
 *   boxes[code]    — тип стены, форма, число модулей и совместимые стандарты коробки
 *                    (для findBox — чтобы фолбэк никогда не противоречил стандарту).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");

const CATALOG = path.join(projectRoot, "js/catalog-vimar.js");
const PRICE_CSV = path.join(here, "data/price-parsed.csv");
const WALL_JSON = path.join(here, "data/box-wall-type.json");
const COMPAT_JSON = path.join(here, "data/compat-external.json");
const OUT = path.join(projectRoot, "js/catalog-vimar-attrs.js");

/* Минимальный парсер CSV с учётом кавычек (значения не содержат переводов строк). */
function parseCsv(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(",");
  const split = line => {
    const out = []; let cur = "", q = false;
    for (const c of line) {
      if (c === '"') q = !q;
      else if (c === "," && !q) { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };
  return lines.slice(1).map(split).map(cells => {
    const o = {};
    header.forEach((h, i) => (o[h] = cells[i]));
    return o;
  });
}

/* Загрузка window.EP_VIMAR_CATALOG из сгенерированного файла без исполнения в браузере. */
async function loadCatalog(file) {
  const code = await fs.readFile(file, "utf8");
  const sandbox = {};
  new Function("window", code.replace(/^\/\*[\s\S]*?\*\//, ""))(sandbox);
  return sandbox.EP_VIMAR_CATALOG || { products: [] };
}

const intOrNull = v => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
/* Ведущее целое из строк вида «6 (3+3)», «6/7», «12/14» (compat-external.modules). */
const leadingInt = v => {
  const m = String(v ?? "").match(/\d+/);
  return m ? Number(m[0]) : null;
};

/* Форма коробки → приложение: круглая (round60/round65) годится под один пост
   (IT_ROUND/DE/FR), прямоугольная (rect) — под итальянскую сборку (IT). Это НЕ
   эвристика по названию, а официальная классификация из compat-external.json. */
function boxShapeAndStandards(csvShape, compatShape) {
  const raw = csvShape === "round" || csvShape === "rect" ? csvShape
    : /^round/.test(String(compatShape || "")) ? "round"
    : compatShape === "rect" ? "rect" : "unknown";
  if (raw === "round") return { shape: "round", standards: ["IT_ROUND", "DE", "FR"] };
  if (raw === "rect") return { shape: "rect", standards: ["IT"] };
  return { shape: "unknown", standards: [] };
}

async function main() {
  const catalog = await loadCatalog(CATALOG);
  const products = catalog.products || [];
  const rows = parseCsv(await fs.readFile(PRICE_CSV, "utf8"));
  const wall = JSON.parse((await fs.readFile(WALL_JSON, "utf8")).replace(/^﻿/, "")).boxes || {};
  const compat = JSON.parse((await fs.readFile(COMPAT_JSON, "utf8")).replace(/^﻿/, ""));
  const compatBox = new Map((compat.boxes || []).map(b => [b.code, b]));

  const byCode = new Map(rows.map(r => [r.code, r]));
  const byBase = new Map();
  for (const r of rows) if (!byBase.has(r.base)) byBase.set(r.base, r);
  const priceRow = code => byCode.get(code) || byBase.get(code) || null;

  const standards = {};   // code накладки → { standard, postCount, modules }
  const wallTypes = {};   // code коробки → solid|hollow  (оставлено для совместимости)
  const supports = {};    // code суппорта → { standard, modules, pitchMm }
  const boxes = {};        // code коробки → { wallType, shape, modules, standards }

  for (const p of products) {
    const r = priceRow(p.code);
    if (p.kind === "frame") {
      const standard = (r && r.standard) || "unknown";
      standards[p.code] = {
        standard,
        postCount: r ? intOrNull(r.postCount) : null,
        modules: r ? (intOrNull(r.frameModules) || intOrNull(r.moduleCount)) : null
      };
    }
    if (p.kind === "support") {
      supports[p.code] = {
        standard: (r && r.standard) || "unknown",
        modules: r ? (intOrNull(r.moduleCount) || intOrNull(r.frameModules)) : null,
        pitchMm: r ? intOrNull(r.pitchMm) : null
      };
    }
    if (p.kind === "socket_box") {
      const cb = compatBox.get(p.code);
      const { shape, standards: boxStd } = boxShapeAndStandards(r && r.boxShape, cb && cb.shape);
      const modules = (r ? intOrNull(r.moduleCount) : null) || (cb ? leadingInt(cb.modules) : null);
      const wallType = wall[p.code] || "unknown";
      boxes[p.code] = { wallType, shape, modules, standards: boxStd };
      if (wall[p.code]) wallTypes[p.code] = wall[p.code];
    }
  }

  const tally = {};
  for (const c in standards) tally[standards[c].standard] = (tally[standards[c].standard] || 0) + 1;
  const supTally = {};
  for (const c in supports) supTally[supports[c].standard] = (supTally[supports[c].standard] || 0) + 1;

  const banner =
    `/* Generated by tools/build-catalog-attrs.mjs — НЕ ПРАВИТЬ РУКАМИ.\n` +
    `   Признаки автосостава поста для рантайма: стандарт накладки/суппорта (из\n` +
    `   price-parsed.csv), тип стены + форма + совместимые стандарты коробки (из\n` +
    `   box-wall-type.json и compat-external.json). Подмешиваются к товарам в js/data.js. */\n`;
  const body = {
    generatedAt: new Date().toISOString().slice(0, 10),
    source: {
      standards: "tools/data/price-parsed.csv",
      supports: "tools/data/price-parsed.csv",
      wallTypes: "tools/data/box-wall-type.json",
      boxes: "tools/data/box-wall-type.json + tools/data/compat-external.json"
    },
    standards,
    supports,
    wallTypes,
    boxes
  };
  await fs.writeFile(OUT, banner + `window.EP_VIMAR_ATTRS = ${JSON.stringify(body, null, 2)};\n`, "utf8");

  console.log("Готово:", path.relative(projectRoot, OUT));
  console.log(`  накладок со стандартом: ${Object.keys(standards).length} — ${JSON.stringify(tally)}`);
  console.log(`  суппортов:              ${Object.keys(supports).length} — ${JSON.stringify(supTally)}`);
  console.log(`  коробок:                ${Object.keys(boxes).length} (с типом стены ${Object.keys(wallTypes).length})`);
}

main().catch(err => {
  console.error("Ошибка генерации атрибутов:", err);
  process.exitCode = 1;
});
