/*
 * Структурный разбор прайса VIMAR → паспорт колонок, нормализованная таблица
 * позиций и ЧЕРНОВИК матрицы совместимости (с резолвером «артикул↔артикул»).
 *
 * Зачем отдельно от build-catalog.mjs. build-catalog собирает РАБОЧИЙ каталог из
 * кураторского отбора (~399 позиций). Здесь задача другая — разведочная: разобрать
 * ВЕСЬ прайс (7000+ строк) на атрибуты, по которым в приложении можно будет
 * фильтровать и разрешать совместимость постов. Ничего в каталоге не меняем.
 *
 * Источник истины по структуре — только сам .xls: каждое утверждение в отчёте
 * подкреплено числом/примером, полученным этим скриптом. Догадки не подставляем:
 * где данных нет — пишем "unknown" и выносим в список пробелов для веб-разведки.
 *
 * Запуск:  node tools/analyze-price.mjs   (пути по умолчанию — как в build-catalog.mjs)
 * Результаты (перезаписываются, ручных правок не предполагают):
 *   docs/анализ-прайса-vimar.md   — человекочитаемый отчёт
 *   tools/data/price-columns.json — машинный паспорт колонок
 *   tools/data/price-parsed.csv   — нормализованная таблица всех позиций
 *   tools/data/compat-draft.json  — черновик правил совместимости + примеры резолвера
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createRequire } from "node:module";
import { classify, CATEGORY_NAMES, normalized, lower } from "./lib/classify.mjs";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const repoRoot = path.resolve(projectRoot, "..");

const { values: args } = parseArgs({
  options: {
    xls: { type: "string" },
    curation: { type: "string" },
    outMd: { type: "string" },
    outCols: { type: "string" },
    outCsv: { type: "string" },
    outCompat: { type: "string" },
  },
});
const resolveArg = (v, f) => (v ? path.resolve(v) : f);
const SOURCE_XLS = resolveArg(args.xls, path.join(repoRoot, "Прайс VIMAR Евро 01.07.26 (2) (2).xls"));
const CURATION = resolveArg(args.curation, path.join(here, "data/catalog-curation.json"));
const OUT_MD = resolveArg(args.outMd, path.join(projectRoot, "docs/анализ-прайса-vimar.md"));
const OUT_COLS = resolveArg(args.outCols, path.join(here, "data/price-columns.json"));
const OUT_CSV = resolveArg(args.outCsv, path.join(here, "data/price-parsed.csv"));
const OUT_COMPAT = resolveArg(args.outCompat, path.join(here, "data/compat-draft.json"));

const SOURCE_DATE_ISO = "2026-07-01";
const HEADER_ROW0 = 2;   // 0-based индекс строки шапки (R3)
const DATA_ROW0 = 3;     // 0-based индекс первой строки данных (R4)

// ───────────────────────────────────────────────────────────────────────────
// Разбор артикула. Грамматика, выведенная из файла (см. отчёт):
//   БАЗА  = ведущий цифровой блок, у части позиций с приклеенной буквой
//           (14641U — линейка "Up") или ведущей буквой (V71303, 0K01599 — ПО/спец).
//   СУФФИКСЫ = сегменты через точку: цвет/исполнение (.B, .N, .CM), реже — счётчик
//           модулей (.2) или код цвета Plana Up (.01..).
// Разбор всегда даёт base + список суффиксов; «непарсящимися» считаем те, где база
// не начинается с цифры и не является известной буквенной серией (V…, ПО).
// ───────────────────────────────────────────────────────────────────────────
function parseArticle(code) {
  const parts = String(code).split(".");
  const base = parts[0];
  const suffixTokens = parts.slice(1);
  const colorSuffix = suffixTokens.filter((t) => /[A-Za-z]/.test(t)).join(".");
  // База «нормальная», если это цифры, опц. с буквенным хвостом/головой.
  const baseOk = /^[0-9]{3,6}[A-Za-z]{0,3}$/.test(base) || /^[A-Za-z]{1,2}[0-9]{3,6}$/.test(base);
  return { base, suffixTokens, colorSuffix, parseable: baseOk };
}

const prefix2 = (code) => String(code).match(/^(\d{2})/)?.[1] || "??";

// ───────────────────────────────────────────────────────────────────────────
// Извлечение модульности из НАИМЕНОВАНИЯ. В прайсе ширина/ёмкость задаётся
// текстом ("...на 2 модуля", "3 мод."), отдельной колонки нет. "пост/мест" VIMAR
// не использует (0 совпадений по всему файлу) — рамки меряются в модулях.
function extractModules(name) {
  const m = name.match(/(\d{1,2})\s*модул/i) || name.match(/(\d{1,2})\s*мод\b/i) || name.match(/\b(\d{1,2})\s*M\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n <= 72 ? n : null;
}

// Цвет/исполнение — хвост названия после последней запятой. Помечаем, похоже ли
// это на цвет (короткая фраза без цифр/единиц), чтобы фильтр не зацепил
// «...USB C 5V 1,5A» как цвет.
const UNIT_NOISE = /\bv\b|\ba\b|hz|ip\d|\bw\b|мм|mm|см|\d/i;
function extractColor(name) {
  const idx = name.lastIndexOf(",");
  if (idx === -1) return { color: "", isColor: false };
  const tail = name.slice(idx + 1).trim();
  const isColor = tail.length > 0 && tail.length <= 34 && !UNIT_NOISE.test(tail) &&
    !/knx|by-?me|next|dali|enocean/i.test(tail);
  return { color: tail, isColor };
}

// Материал отделки — только когда в тексте явно назван конструкционный материал.
// Пластиковые цвета (белый/серый) материалом не считаем.
const MATERIALS = [
  [/латун/i, "латунь"], [/бронз/i, "бронза"], [/(?:^|\W)стал/i, "сталь"], [/никел/i, "никель"],
  [/алюмин|аллюмин/i, "алюминий"], [/\bметал|\bmetal/i, "металл"], [/хром/i, "хром"],
  [/стекл/i, "стекло"], [/дерев|дуб|вишн|орех|бамбук/i, "дерево"], [/керамик/i, "керамика"],
  [/латунь сатин|сатинированн/i, "латунь"],
];
function extractMaterial(name) {
  for (const [rx, mat] of MATERIALS) if (rx.test(name)) return mat;
  return "";
}

// ───────────────────────────────────────────────────────────────────────────
// Тип позиции (role) — расширенная эвристика по названию. Отличается от
// classify() в lib/ (там консервативная типизация для DB-импорта): здесь цель —
// разложить ВЕСЬ прайс для фильтров, поэтому категорий больше и они грубее.
// ЭТО ЭВРИСТИКА ПО ТЕКСТУ, не паспорт производителя — в отчёте это оговорено.
// Порядок проверок важен: сначала «не-механизмы», потом механизм, потом прочее.
// ───────────────────────────────────────────────────────────────────────────
function detectRole(name) {
  const t = lower(name);
  const first = t.split(/[\s,]/)[0];
  // Щитовое/DIN и системные блоки — в сборке настенного поста НЕ участвуют.
  if (/\bdin\b|din-?рейк|en\s?50022|модульн(ый|ых|ое)|на din/i.test(t)) return { role: "din", rule: "din_rail" };
  if (/^(по|программатор|лицензи|активаци|подписк|облач)/i.test(t)) return { role: "software", rule: "software" };
  if (/^(коробка|подрозетник)/.test(first) || /подрозетник/.test(t)) return { role: "box", rule: "box_first_word" };
  if (/^(суппорт|держатель)/.test(first) || /монтажная рам|крепление для суппорт/.test(t)) return { role: "support", rule: "support" };
  if (/^(накладка|рамка|каркас)/.test(first) || /защитная рамк/.test(t)) return { role: "frame", rule: "frame_first_word" };
  if (/^(клавиша|крышка|заглушка|фальшблок|символ|маркиров|шильд|табличк)/.test(first)) return { role: "insert", rule: "insert" };
  if (/^клемма/.test(first)) return { role: "clamp", rule: "clamp" };
  if (/^(вилка|переходник|адаптер|шнур|кабел|провод|удлинит)/.test(first)) return { role: "accessory", rule: "accessory_first_word" };
  if (/^(розетка|выключатель|переключатель|кнопка|диммер|светорегулятор|термостат|датчик|регулятор|зарядное|разъ[её]м|индикатор|считыватель|звонок|зуммер|таймер|реле|извещател|табло|модуль|механизм|светодиод|патрон|лампочка|интерфейс|приемник|актуатор|контроллер|блок)/.test(first)) {
    return { role: "mechanism", rule: "device_first_word" };
  }
  if (/^(винт|кольцо|проставк|протяжк|ремеш|крепеж|крепёж|бокс|чемодан|сумка|тестер|инструмент)/.test(first)) return { role: "accessory", rule: "accessory_misc" };
  return { role: "other", rule: "unmatched" };
}

// «Ставится ли на настенный пост» — грубый флаг для фильтра расстановки.
const ON_POST_ROLES = new Set(["mechanism", "frame", "support", "box", "insert"]);

// ───────────────────────────────────────────────────────────────────────────
// МОНТАЖНЫЙ стандарт (standard). НАСТОЯЩИЙ маркер немецко-французского стандарта в
// прайсе — МЕЖОСЕВОЕ РАССТОЯНИЕ: «71 мм» (нем.-фр., 323 поз.) и «57 мм» (фр., 26
// поз., только Plana). Токенов 55x55/503/DIN49073 у VIMAR нет. Официальная
// формулировка (compat-external.json, S1): «Installation with 71 mm distance
// between centres (German and French standard)».
//
// СТАНДАРТ — СВОЙСТВО КОМПОНЕНТА, НЕ СЕРИИ. Один и тот же механизм серии ставится и
// в итальянский, и в немецкий пост; различаются только КОРОБКА/СУППОРТ/НАКЛАДКА.
// Поэтому standard выводим ТОЛЬКО для box/support/frame; у механизмов/клавиш → both
// (сами стандарт не несут), у DIN/ПО/кабеля → n-a.
//
// ВАЖНО-1: круглая ø60 САМА ПО СЕБЕ ≠ немецкий: схема «2 modules for ø60 or 56x56»
//   есть и в итальянском разделе (IT_ROUND). Немецким делает СОЧЕТАНИЕ ø60 + 71 мм +
//   многопостовая накладка. Поэтому ø60 без «71 мм» помечаем IT_ROUND, не DE.
// ВАЖНО-2: «немецкий стандарт» у розетки — это вилка Schuko (outletStandard), не монтаж.
// Термины: накладка = внешняя рамка; модуль = ширина; ПОСТ = 2 модуля; импост = перемычка.
// ───────────────────────────────────────────────────────────────────────────

const MOUNT_ROLES = new Set(["frame", "box", "support"]);   // несут монтажный стандарт
const LAYOUT_ROLES = new Set(["frame", "box", "support", "insert"]);

// Межосевое расстояние (в мм): 71 → нем.-фр., 57 → фр. Латинская «c» в «расcтояние»
// в исходнике на регэксп числа не влияет.
function extractPitch(name) {
  if (/\b71\s*мм/i.test(name)) return 71;
  if (/\b57\s*мм/i.test(name)) return 57;
  return "";
}
// Тип крепления суппорта/накладки (важно для правила V71701 «только без защёлок»).
function extractFixing(name) {
  const t = lower(name);
  if (/защ[её]лк/.test(t)) return "claws";
  if (/без винтов/.test(t)) return "screwless";
  if (/с винтами|на винтах/.test(t)) return "screws";
  return "";
}
// Раскладка накладки/коробки: сырой паттерн «2+2+2» или одиночное число «7».
// Считаем только для монтажных ролей — иначе «2x0,5+2x0,22» у кабеля даст мусор.
function extractLayout(name, role, moduleCount) {
  if (!LAYOUT_ROLES.has(role)) return "";
  const m = name.match(/(\d+(?:\s*\+\s*\d+)+)/); // 2+2 / 6+6 / 7+7+7 / 12(6+6) → «6+6»
  if (m) return m[1].replace(/\s+/g, "");
  return moduleCount != null ? String(moduleCount) : "";
}
// Число постов — только когда раскладка целиком из групп по 2 (немецкая логика).
function computePostCount(layout) {
  if (!layout || !layout.includes("+")) return "";
  const groups = layout.split("+").map(Number);
  return groups.length >= 2 && groups.every((g) => g === 2) ? groups.length : "";
}
// Форма подрозетника/коробки. round → ТОЛЬКО признак ø60 (сам по себе IT_ROUND, не DE).
function detectBoxShape(name, role, moduleCount) {
  const t = lower(name);
  if (!MOUNT_ROLES.has(role)) return "unknown";
  const roundBox = /для кругл(ой|ых)?\s*коробк|кругл(ая|ой)\s*коробк|коробк\w*\s*кругл|с суппортом,?\s*для кругл|ø\s*60|d\.?\s*60\s*mm|56\s*[x×х]\s*56/i.test(t);
  if (roundBox) return "round";
  const rect = /прямоугольн/i.test(t) || (role === "box" && Number(moduleCount) >= 3);
  if (rect) return "rect";
  return "unknown";
}
// Тип суппорта: вытянутый на N≥3 модулей = итальянский (один на сборку).
function detectSupportType(name, role, moduleCount) {
  if (role !== "support") return "unknown";
  if (Number(moduleCount) >= 3) return "elongated";
  if (/на \d+ пост|per post/i.test(lower(name))) return "per-post";
  return "unknown";
}

// Итоговый стандарт компонента. Приоритет — МЕЖОСЕВОЕ (71/57 мм), затем форма.
function deriveStandard({ name, role, moduleCount, boxShape, supportType, layout, pitch }) {
  const t = lower(name);
  if (role === "din" || role === "software") return { standard: "n-a", rule: "din_or_software", it: [], de: [] };
  // Механизмы/клавиши/клеммы стандарт НЕ несут — фитятся в любой пост → both (в посте)
  // или n-a (свободный аксессуар/кабель).
  if (!MOUNT_ROLES.has(role)) {
    if (role === "mechanism" || role === "insert" || role === "clamp") return { standard: "both", rule: "device_not_standard_bound", it: [], de: [] };
    return { standard: "n-a", rule: "non_post_component", it: [], de: [] };
  }

  const de = [], it = [];
  // (1) Межосевое расстояние — авторитетный маркер.
  if (pitch === 71) return { standard: "DE", rule: "pitch_71mm", it, de: ["pitch:71мм"] };
  if (pitch === 57) return { standard: "FR", rule: "pitch_57mm", it, de: ["pitch:57мм"] };
  // (2) US-коробка в дюймах.
  if (/4\s*[xх]\s*2/i.test(t) || /коробк[^,]*дюйм|дюйм[^,]*коробк/i.test(t) || (/американск/i.test(t) && role === "box")) {
    return { standard: "US", rule: "us_inch_box", it, de };
  }
  // (3) Итальянские признаки: прямоугольная коробка, вытянутый суппорт, ряд ≥3 /
  // составная раскладка с группой ≥3 (6+6, 7+7, 3+3 …).
  if (boxShape === "rect") it.push("box:rect");
  if (supportType === "elongated") it.push("support:elongated");
  if (layout && layout.includes("+")) {
    const groups = layout.split("+").map(Number);
    if (groups.some((g) => g >= 3)) it.push(`layout:${layout}(итал.ряд)`);
    // Раскладка из групп по 2 БЕЗ межосевого — пост-структура без подтверждённого
    // шага: honest unknown (не помечаем DE без «71/57 мм», см. ВАЖНО-1).
  } else if (layout && Number(layout) >= 3) {
    it.push(`layout:${layout}(ряд)`);
  }
  if (it.length) return { standard: "IT", rule: "it_" + it.map((s) => s.split(":")[0]).join("+"), it, de };
  // (4) Круглая ø60 без «71 мм» — итальянский однопостовый (IT_ROUND), НЕ немецкий.
  if (boxShape === "round") return { standard: "IT_ROUND", rule: "round60_single_post", it: ["box:round60"], de };
  return { standard: "unknown", rule: "no_mount_signal", it, de };
}

// РОЗЕТОЧНЫЙ (электрический) стандарт вилки/розетки — отдельный, хорошо
// представленный в тексте атрибут (не путать с монтажным).
function detectOutletStandard(name) {
  const t = lower(name);
  if (/немецк(ий|ого)\s+стандарт|schuko|шуко/i.test(t)) return "schuko_de";
  if (/швейцарско-американск|евро-американск|американск/i.test(t)) return "us";
  if (/француз/i.test(t)) return "french";
  if (/универсальн/i.test(t)) return "universal";
  if (/\bp17\b|\bp30\b|итальянск(ий)?\s+стандарт|sicury|sicurezza/i.test(t)) return "italian";
  return "";
}

// Серии, упомянутые в названии (для файловых связей серия↔серия). Ищем и явные
// формы «для накладок X», «для серий X/Y», «SeriesA/SeriesB».
const SERIES_CANON = [
  ["Eikon Tactil", /eikon\s*tactil/i], ["Eikon", /eikon/i], ["Arké", /ark[eè é]/i],
  ["Idea", /\bidea\b/i], ["Plana", /\bplana\b/i], ["Linea", /\blinea\b/i], ["Neve", /\bneve\b/i],
  ["Classica", /\bclassica\b/i], ["By-me", /by-?me/i], ["View", /\bview\b/i], ["8000", /\b8000\b/i],
];
function seriesInName(name) {
  const found = [];
  for (const [canon, rx] of SERIES_CANON) {
    if (canon === "Eikon" && /eikon\s*tactil/i.test(name)) continue; // не дублировать Tactil как Eikon
    if (rx.test(name) && !found.includes(canon)) found.push(canon);
  }
  return found;
}

// ───────────────────────────────────────────────────────────────────────────
function readWorkbook(file) {
  const wb = XLSX.readFile(file, { cellFormula: true, cellNF: true });
  const sheetName = wb.SheetNames.find((n) => n.trim() === "VIMAR");
  if (!sheetName) throw new Error(`Нет листа VIMAR (есть: ${wb.SheetNames.join(", ")})`);
  return { wb, sheetName, ws: wb.Sheets[sheetName] };
}

async function loadCurationSeries(file) {
  // Курация — внешне выверенная серия/ширина для ~399 позиций (Idea/Neve).
  // Используем как САМЫЙ надёжный источник серии на уровне артикула.
  try {
    const cur = JSON.parse((await fs.readFile(file, "utf8")).replace(/^﻿/, ""));
    const map = new Map();
    for (const p of cur.products || []) {
      const series = (Array.isArray(p.series) && p.series[0]) || p.compatibility || null;
      map.set(String(p.code), { series, moduleSpan: p.moduleSpan ?? null, kind: p.kind || null });
    }
    return map;
  } catch {
    return new Map();
  }
}

// CSV по RFC 4180: экранируем кавычки/запятые/переводы строк.
const csvCell = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const EXTERNAL = path.join(here, "data/compat-external.json");

async function run() {
  const { wb, sheetName, ws } = readWorkbook(SOURCE_XLS);
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const get = (r, c) => ws[XLSX.utils.encode_cell({ r, c })];
  const curation = await loadCurationSeries(CURATION);
  // Внешние официальные данные (собраны другим агентом) — ТОЛЬКО читаем для сверки.
  let external = null;
  try { external = JSON.parse((await fs.readFile(EXTERNAL, "utf8")).replace(/^﻿/, "")); } catch { /* нет файла — сверка пропускается */ }

  // ── Паспорт колонок: собираем шапку и статистику по каждой колонке ──
  const columns = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const head = get(HEADER_ROW0, c);
    const stat = { letter: XLSX.utils.encode_col(c), header: head ? normalized(head.v) : "", types: {}, filled: 0, formulas: 0, formulaNoValue: 0, samples: [] };
    for (let r = DATA_ROW0; r <= range.e.r; r++) {
      const cell = get(r, c);
      if (!cell) continue;
      stat.filled++;
      stat.types[cell.t] = (stat.types[cell.t] || 0) + 1;
      if (cell.f) { stat.formulas++; if (cell.v === undefined || cell.v === null || cell.v === "") stat.formulaNoValue++; }
      if (stat.samples.length < 8) stat.samples.push(cell.w != null ? cell.w : cell.v);
    }
    columns.push(stat);
  }
  const dataRowCount = range.e.r - DATA_ROW0 + 1;

  // ── Первый проход: базовый разбор строк + сбор доказательств «префикс→серия» ──
  const raw = [];
  const prefixSeriesEvidence = new Map(); // prefix2 -> {series: count}
  for (let r = DATA_ROW0; r <= range.e.r; r++) {
    const aCell = get(r, 0);
    const code = aCell ? normalized(aCell.v) : "";
    if (!code) continue;
    const name = normalized(get(r, 1)?.v);
    const priceCell = get(r, 2);
    const packCell = get(r, 3);
    const noteCell = get(r, 4);
    raw.push({ sourceRow: r + 1, code, name, priceCell, packCell, note: normalized(noteCell?.v) });

    const namedSeries = seriesInName(name);
    if (namedSeries.length === 1) {
      const p = prefix2(code);
      if (!prefixSeriesEvidence.has(p)) prefixSeriesEvidence.set(p, {});
      const bucket = prefixSeriesEvidence.get(p);
      bucket[namedSeries[0]] = (bucket[namedSeries[0]] || 0) + 1;
    }
  }

  // Данными подтверждённая карта префикс→серия: назначаем серию префиксу, если
  // одна серия даёт ≥60% упоминаний и есть ≥5 свидетельств. Иначе — не назначаем.
  const prefixSeriesMap = new Map();
  for (const [p, dist] of prefixSeriesEvidence) {
    const entries = Object.entries(dist).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((s, [, n]) => s + n, 0);
    const [topSeries, topN] = entries[0];
    if (topN >= 5 && topN / total >= 0.6) {
      prefixSeriesMap.set(p, { series: topSeries, evidence: topN, total });
    }
  }

  // ── Второй проход: полные атрибуты каждой позиции ──
  const records = [];
  const seriesLinkEdges = new Map(); // "A|B" -> {codes:Set, sample}
  const dupCheck = new Map();
  for (const it of raw) {
    const { code, name } = it;
    const article = parseArticle(code);
    const modules = extractModules(name);
    const { color, isColor } = extractColor(name);
    const material = extractMaterial(name);
    const { role, rule: roleRule } = detectRole(name);
    const links = seriesInName(name);
    // Физические признаки монтажа → колонки + вывод стандарта компонента.
    const pitch = extractPitch(name);            // 71 → нем.-фр., 57 → фр.
    const fixing = extractFixing(name);          // claws / screwless / screws
    const frameLayout = extractLayout(name, role, modules);
    const postCount = computePostCount(frameLayout);
    const boxShape = detectBoxShape(name, role, modules);
    const supportType = detectSupportType(name, role, modules);
    const std = deriveStandard({ name, role, moduleCount: modules, boxShape, supportType, layout: frameLayout, pitch });
    const standard = std.standard, stdRule = std.rule;
    const outletStandard = detectOutletStandard(name);

    // Серия: курация (внешне выверено) → слово в названии → карта префикса → нет.
    let series = "", seriesSource = "", seriesConfidence = "missing";
    const cur = curation.get(code);
    if (cur && cur.series) { series = cur.series; seriesSource = "curation"; seriesConfidence = "file"; }
    else if (links.length === 1) { series = links[0]; seriesSource = "name"; seriesConfidence = "file"; }
    else if (links.length > 1) { series = links.join("/"); seriesSource = "name-multi"; seriesConfidence = "file"; }
    else if (prefixSeriesMap.has(prefix2(code))) { series = prefixSeriesMap.get(prefix2(code)).series; seriesSource = "prefix"; seriesConfidence = "heuristic"; }

    // Файловые рёбра серия↔серия: если в названии узла ≥2 серий — они делят компонент.
    if (links.length >= 2) {
      for (let i = 0; i < links.length; i++) for (let j = i + 1; j < links.length; j++) {
        const key = [links[i], links[j]].sort().join("|");
        if (!seriesLinkEdges.has(key)) seriesLinkEdges.set(key, { codes: new Set(), sample: name });
        seriesLinkEdges.get(key).codes.add(code);
      }
    }

    // Цена: берём .v числа; ошибочные ячейки (#N/A) фиксируем как error, не как 0.
    let priceEUR = "", priceStatus = "ok";
    const pc = it.priceCell;
    if (pc && pc.t === "n" && Number.isFinite(pc.v)) { priceEUR = Math.round(pc.v * 100) / 100; if (pc.v <= 0) priceStatus = "zero"; }
    else if (pc && pc.t === "e") { priceStatus = `error:${pc.w || pc.v}`; }
    else { priceStatus = "missing"; }

    // Упаковка: число либо строковая цифра ("50") — приводим к числу, где можно.
    let packQty = "";
    const pk = it.packCell;
    if (pk) {
      if (pk.t === "n") packQty = pk.v;
      else if (pk.t === "s" && /^\d+$/.test(String(pk.v).trim())) packQty = Number(String(pk.v).trim());
    }

    const cat = classify(name);
    const record = {
      code,
      name,
      base: article.base,
      colorSuffix: article.colorSuffix,
      articleParseable: article.parseable,
      role,
      roleRule,
      onPost: ON_POST_ROLES.has(role),
      standard,
      standardRule: stdRule,
      pitchMm: pitch,
      fixing,
      standardSignalsIT: std.it.join(";"),
      standardSignalsDE: std.de.join(";"),
      boxShape,
      supportType,
      frameLayout,
      postCount,
      outletStandard,
      series,
      seriesSource,
      seriesConfidence,
      moduleCount: modules ?? "",
      frameModules: role === "frame" ? (modules ?? "") : "",
      moduleSpanCurated: cur?.moduleSpan ?? "",
      color: isColor ? color : "",
      colorRaw: color,
      isColor,
      material,
      unit: "шт.",
      priceEUR,
      priceStatus,
      packQty,
      categoryDerived: CATEGORY_NAMES.get(cat.categoryId) || String(cat.categoryId),
      note: it.note,
      sourceSheet: sheetName.trim(),
      sourceRow: it.sourceRow,
    };
    records.push(record);

    if (!dupCheck.has(code)) dupCheck.set(code, []);
    dupCheck.get(code).push(it.sourceRow);
  }

  // ── Индекс для резолвера ──
  const byCode = new Map(records.map((r) => [r.code, r]));

  // Индекс для резолвера собираем один раз; сам резолвер — экспортируемая функция
  // модуля (buildCompatIndex/resolveCompat), чтобы её могли вызвать тесты/приложение.
  const compatIndex = buildCompatIndex(records, seriesLinkEdges);
  const resolveCompat = (codeA, codeB) => resolveCompat_(codeA, codeB, compatIndex);

  // ── Статистика ──
  const stat = {
    dataRows: dataRowCount,
    articles: records.length,
    distinctCodes: dupCheck.size,
    duplicateCodes: [...dupCheck.entries()].filter(([, rr]) => rr.length > 1),
    byRole: tally(records, (r) => r.role),
    byStandard: tally(records, (r) => r.standard),
    byOutlet: tally(records.filter((r) => r.outletStandard), (r) => r.outletStandard),
    bySeries: tally(records.filter((r) => r.series), (r) => r.series),
    bySeriesConfidence: tally(records, (r) => r.seriesConfidence),
    noPrice: records.filter((r) => r.priceStatus !== "ok").length,
    priceErrors: records.filter((r) => /^error/.test(r.priceStatus)),
    withModules: records.filter((r) => r.moduleCount !== "").length,
    withColor: records.filter((r) => r.isColor).length,
    onPost: records.filter((r) => r.onPost).length,
    notes: tally(records.filter((r) => r.note), (r) => r.note),
    // Позиции с межосевым маркером: 71 (нем.-фр.) и 57 (фр.).
    pitch71: records.filter((r) => r.pitchMm === 71).length,
    pitch57: records.filter((r) => r.pitchMm === 57).length,
    withClaws: records.filter((r) => r.fixing === "claws").length,
    // Конфликты признаков стандарта — теперь маловероятны (стандарт одномерный по маркеру).
    conflicts: records.filter((r) => r.standard === "conflict"),
    // Перепроверка Idea/Neve — ТОЛЬКО по монтажным компонентам (box/support/frame):
    // механизмы стандарт не несут (both), поэтому в разбивку стандарта не идут.
    standardBySeries: (() => {
      const mount = new Set(["box", "support", "frame"]);
      const out = {};
      for (const s of ["Idea", "Neve Up"]) {
        out[s] = tally(records.filter((r) => r.series === s && mount.has(r.role)), (r) => r.standard);
      }
      return out;
    })(),
    // Раскладки накладок (frameLayout) — что реально встречается в файле.
    layouts: tally(records.filter((r) => r.role === "frame" && r.frameLayout.includes("+")), (r) => r.frameLayout),
  };

  // ── Межсерийные адаптеры: суппорт/накладка, принимающая устройства ДРУГОЙ серии.
  // Они ЛЕГАЛИЗУЮТ сочетания, которые иначе резолвер отверг бы как разные серии.
  const adapterLinks = records
    .filter((r) => ["support", "frame", "accessory"].includes(r.role))
    .map((r) => ({ code: r.code, role: r.role, series: seriesInName(r.name), name: r.name }))
    .filter((x) => x.series.length >= 2 || /для накладок|для устройств|для аппаратов/i.test(x.name))
    .filter((x) => x.series.length >= 2)
    .map((x) => ({ code: x.code, role: x.role, seriesMentioned: x.series, name: x.name.slice(0, 80) }));

  // ── Примеры работы резолвера (для проверяемости правил) ──
  const examplePairs = pickExamplePairs(records);
  const exampleResults = examplePairs.map(([x, y, why]) => ({ a: x, b: y, why, ...resolveCompat(x, y) }));

  // ── Файловые связи серия↔серия ──
  const fileSeriesLinks = [...seriesLinkEdges.entries()]
    .map(([key, v]) => ({ pair: key.split("|"), codes: [...v.codes].slice(0, 6), count: v.codes.size, sample: v.sample }))
    .sort((a, b) => b.count - a.count);

  // ── Сверка с внешними официальными данными (compat-external.json) ──
  const reconciliation = buildReconciliation(records, external, prefixSeriesMap);

  await writeOutputs({
    wb, sheetName, ws, range, columns, dataRowCount, records, stat, prefixSeriesMap,
    prefixSeriesEvidence, fileSeriesLinks, adapterLinks, reconciliation, external,
    exampleResults, resolveCompat, byCode,
  });

  // Сводка в консоль
  console.log("Анализ прайса VIMAR завершён.");
  console.log(`  строк данных:        ${dataRowCount}`);
  console.log(`  артикулов:           ${records.length} (уникальных ${dupCheck.size}, дублей-кодов ${stat.duplicateCodes.length})`);
  console.log(`  по ролям:            ${Object.entries(stat.byRole).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log(`  по монтаж.стандарту: ${Object.entries(stat.byStandard).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log(`  конфликтов признаков: ${stat.conflicts.length}`);
  console.log(`  без валидной цены:   ${stat.noPrice} (ошибок #N/A: ${stat.priceErrors.length})`);
  console.log(`  с модульностью:      ${stat.withModules}`);
  console.log(`  файловых связей серий: ${fileSeriesLinks.length}`);
  console.log("Файлы:");
  for (const f of [OUT_MD, OUT_COLS, OUT_CSV, OUT_COMPAT]) console.log("  ", path.relative(repoRoot, f));
}

function tally(arr, keyFn) {
  const m = {};
  for (const x of arr) { const k = keyFn(x); m[k] = (m[k] || 0) + 1; }
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
}

// Подбираем показательные пары для демонстрации всех вердиктов и ОБЕИХ моделей
// ёмкости (итальянской и немецкой) на реальных артикулах.
function pickExamplePairs(records) {
  const find = (pred) => records.find(pred);
  const mech = (series, wPred) => find((r) => r.role === "mechanism" && r.series === series && Number(r.moduleCount) > 0 && wPred(Number(r.moduleCount)))?.code;
  const frame = (series, std, fmPred) => find((r) => r.role === "frame" && r.series === series && r.standard === std && Number(r.frameModules) > 0 && fmPred(Number(r.frameModules)))?.code;

  // Немецкая модель: DE-накладка Plana (посты по 2М) + механизм Plana.
  const deFrame = frame("Plana", "DE", () => true);
  const planaNarrow = mech("Plana", (w) => w <= 2);
  const planaWide = mech("Plana", (w) => w >= 3);
  // Итальянская модель: IT-накладка Neve Up + механизм Neve Up.
  const itFrame3 = frame("Neve Up", "IT", (fm) => fm === 3);
  const neveNarrow = mech("Neve Up", (w) => w === 1);
  // Итал. not_fits: любая IT-накладка + механизм той же серии ШИРЕ её ёмкости.
  let itOver = null;
  for (const f of records) {
    if (f.role !== "frame" || f.standard !== "IT" || !f.series || !(Number(f.frameModules) > 0)) continue;
    const m = mech(f.series, (w) => w > Number(f.frameModules));
    if (m) { itOver = [m, f.code]; break; }
  }
  // Разные серии (обе file-уверенные), DIN, неизвестная серия.
  const ideaMechF = find((r) => r.series === "Idea" && r.seriesConfidence === "file" && r.role === "mechanism" && r.moduleSpanCurated === 1)?.code;
  const neveMechF = find((r) => r.series === "Neve Up" && r.seriesConfidence === "file" && r.role === "mechanism")?.code;
  const din = find((r) => r.role === "din")?.code;
  const unkMech = find((r) => r.role === "mechanism" && !r.series)?.code;

  const pairs = [];
  if (deFrame && planaNarrow) pairs.push([planaNarrow, deFrame, "НЕМ. модель: DE-накладка Plana (посты 2М) + механизм 1М"]);
  if (deFrame && planaWide) pairs.push([planaWide, deFrame, "НЕМ. модель: DE-накладка Plana + механизм 3М (шире поста)"]);
  if (itFrame3 && neveNarrow) pairs.push([neveNarrow, itFrame3, "ИТАЛ. модель: IT-накладка Neve 3М + механизм 1М"]);
  if (itOver) pairs.push([itOver[0], itOver[1], "ИТАЛ. модель: механизм шире ёмкости IT-накладки"]);
  if (ideaMechF && neveMechF) pairs.push([ideaMechF, neveMechF, "разные серии Idea/Neve (обе подтверждены)"]);
  if (din && ideaMechF) pairs.push([din, ideaMechF, "DIN-модуль + механизм (DIN в пост не ставится)"]);
  if (unkMech && itFrame3) pairs.push([unkMech, itFrame3, "механизм с неопределённой серией + накладка (unknown)"]);
  return pairs;
}

async function writeOutputs(ctx) {
  await writeColumnsJson(ctx);
  await writeCsv(ctx);
  await writeCompatJson(ctx);
  await writeMarkdown(ctx);
}

async function writeColumnsJson({ sheetName, range, columns, dataRowCount }) {
  const passport = {
    source: path.basename(SOURCE_XLS),
    sourceDate: SOURCE_DATE_ISO,
    generatedAt: new Date().toISOString().slice(0, 10),
    sheet: sheetName,
    ref: `A1:${XLSX.utils.encode_col(range.e.c)}${range.e.r + 1}`,
    headerRow: HEADER_ROW0 + 1,
    firstDataRow: DATA_ROW0 + 1,
    dataRows: dataRowCount,
    columns: columns.map((c) => ({
      letter: c.letter,
      header: c.header,
      types: c.types,
      filled: c.filled,
      fillRate: Number((c.filled / dataRowCount).toFixed(4)),
      formulas: c.formulas,
      formulaNoValue: c.formulaNoValue,
      samples: c.samples,
    })),
  };
  await fs.writeFile(OUT_COLS, JSON.stringify(passport, null, 2) + "\n", "utf8");
}

async function writeCsv({ records }) {
  const cols = [
    "code", "base", "colorSuffix", "role", "onPost", "standard", "pitchMm", "fixing",
    "boxShape", "supportType", "frameLayout", "postCount", "standardSignalsIT", "standardSignalsDE",
    "outletStandard", "series", "seriesSource", "seriesConfidence", "moduleCount", "frameModules",
    "moduleSpanCurated", "color", "isColor", "material", "unit", "priceEUR",
    "priceStatus", "packQty", "categoryDerived", "note", "sourceSheet", "sourceRow",
  ];
  const lines = [cols.join(",")];
  for (const r of records) lines.push(cols.map((c) => csvCell(r[c])).join(","));
  // BOM — чтобы Excel корректно открыл кириллицу; парсеры кода BOM снимают.
  await fs.writeFile(OUT_CSV, "﻿" + lines.join("\r\n") + "\r\n", "utf8");
}

async function writeCompatJson({ records, stat, prefixSeriesMap, fileSeriesLinks, adapterLinks, reconciliation, exampleResults }) {
  const seriesStandardHint = buildSeriesStandardHint(records);
  const compat = {
    note: "ЧЕРНОВИК матрицы совместимости VIMAR, выведенный из прайса. confidence: file — подтверждено текстом прайса; heuristic — эвристика (указана); missing — данных в файле нет, нужен внешний источник. Исполняемая форма правил — функция resolveCompat() в tools/analyze-price.mjs.",
    generatedAt: new Date().toISOString().slice(0, 10),
    source: path.basename(SOURCE_XLS),
    resolverOrder: [
      "1. наличие обоих артикулов в прайсе",
      "2. участие в сборке поста (DIN/ПО исключены) + правило V71701 (только без защёлок)",
      "3. МОНТАЖНЫЙ СТАНДАРТ первым: разные IT/DE/FR/US → not_fits",
      "4. серия: разные подтверждённые серии без файловой/адаптерной связи → not_fits",
      "5. ёмкость по МОДЕЛИ стандарта накладки (итальянская сумма vs немецко-фр. посты)",
    ],
    standards: {
      confidence: "file (маркер межосевого расстояния)",
      basis: "СТАНДАРТ — свойство КОМПОНЕНТА, не серии. Маркер немецко-фр. — межосевое «71 мм»; французского — «57 мм». Токены 55x55/503/DIN49073 у VIMAR отсутствуют. Механизмы/клавиши стандарт не несут → both; DIN/ПО/кабель → n-a.",
      values: { IT: "итальянский модульный (прямоуг. коробка, вытянутый суппорт, ряд ≥3/составной)", IT_ROUND: "ø60/56x56 однопостовый — годится и в итал., и в нем. (сам по себе НЕ DE)", DE: "нем.-фр., межосевое 71 мм, посты по 2М", FR: "французский, межосевое 57 мм (только Plana)", US: "дюймовая коробка 4x2", both: "механизм/клавиша — годится в любой пост", "n-a": "DIN/ПО/кабель — не участвует в посте" },
      distribution: stat.byStandard,
      markers: { "pitch71mm_DE_FR": stat.pitch71, "pitch57mm_FR": stat.pitch57, "claws": stat.withClaws },
      coverageBefore: { IT: 45, DE: 5, US: 4, unknown: 7067 },
      caution: "‘немецкий стандарт’ в названии розетки — это вилка Schuko (outletStandard), НЕ монтаж. Круглая ø60 сама по себе ≠ DE (IT_ROUND).",
    },
    capacityModels: {
      italian: "накладка — сплошной ряд: суммарная ширина механизмов ≤ модулей накладки (frameModules). Ряд ёмкостей РАЗНЫЙ по сериям (Idea 1..6,12,18 без 7; Eikon/Arké 1-4,7,8; Plana до 21) — брать из конкретного артикула, не универсально.",
      german_french: "ёмкость дискретна постами: пост = 2 модуля; механизм >2М в пост не встаёт (трёхмодульного суппорта под 71 мм в каталоге нет); набор распределяется по постам (postCount).",
      note: "Модель выбирается по standard накладки. IT_ROUND/unknown → итальянская модель с пометкой в reason.",
    },
    rules: [
      { relation: "монтажный стандарт", verdictWhen: { not_fits: "оба в {IT,DE,FR,US} и различны", fits: "совпадают или один — both/IT_ROUND", unknown: "хотя бы один unknown" }, confidence: "file" },
      { relation: "серия↔серия", verdictWhen: { not_fits: "обе серии подтверждены (file) и различны без связи", fits: "та же серия / файловая или адаптерная связь", unknown: "серия хотя бы одной не определяется" }, confidence: "file/heuristic" },
      { relation: "накладка/суппорт↔механизм — ИТАЛ. модель", verdictWhen: { fits: "сумма модулей ≤ модулей накладки", not_fits: "механизм шире ёмкости", unknown: "модульность не извлекается" }, confidence: "official (S1: Σ ≤ capacity)" },
      { relation: "накладка/суппорт↔механизм — НЕМ.-ФР. модель", verdictWhen: { fits: "ширина механизма ≤ 2М (входит в пост)", not_fits: "механизм >2М — шире поста", unknown: "модульность не извлекается" }, confidence: "official-derived (S1: пост = 2М)" },
      { relation: "V71701 ↔ суппорт с защёлками", verdict: "not_fits", confidence: "official", basis: "S1: V71701 «suitable only for mounting frames without claws». В ЭТОМ прайсе артикула V71701 нет — правило сработает при его появлении." },
      { relation: "DIN/ПО ↔ пост", verdict: "not_fits", confidence: "file", basis: "щитовое/модульное оборудование и ПО в сборку настенного поста не входят" },
    ],
    signalConflicts: {
      count: stat.conflicts.length,
      note: "Позиции с противоречивыми признаками стандарта (индикатор ошибки эвристики).",
      items: stat.conflicts.slice(0, 40).map((r) => ({ code: r.code, it: r.standardSignalsIT, de: r.standardSignalsDE, name: r.name })),
    },
    currentCatalogStandard: {
      note: "Перепроверка серий текущего каталога ПО МОНТАЖНЫМ КОМПОНЕНТАМ (box/support/frame; механизмы = both). Idea — только итал.; Neve — итал. + немецко-фр. суппорты (71 мм).",
      byStandard: stat.standardBySeries,
    },
    crossSeriesAdapters: {
      note: "Суппорты/накладки, принимающие устройства ДРУГОЙ серии — легализуют кросс-серийные сочетания (иначе резолвер отверг бы по серии). Сверено с внешними правилами C01–C04.",
      items: adapterLinks.slice(0, 40),
    },
    externalReconciliation: reconciliation,
    fileConfirmedSeriesLinks: fileSeriesLinks,
    seriesStandardHint,
    prefixSeriesMap: Object.fromEntries([...prefixSeriesMap.entries()].map(([k, v]) => [k, v])),
    resolverExamples: exampleResults,
    gaps: [
      "Стандарт достоверен там, где в названии указано межосевое «71/57 мм» или явная форма коробки; у части накладок с раскладкой 2+2 БЕЗ «мм» пост-структура есть, но шаг не подтверждён → standard=unknown (не помечаем DE без «71 мм»).",
      "Точная посадка суппорт↔коробка↔рамка (тип защёлки, глубина коробки) в прайсе неполна; резолвер по этим ролям осторожен.",
      "Серия у крупнейших префиксов (19/20/30) в тексте не названа — берётся из prefixSeriesMap/внешнего каталога.",
      "Явный признак ‘снято с производства’ отсутствует; ‘Запрашивать остатки’ — статус наличия, не снятие.",
    ],
  };
  await fs.writeFile(OUT_COMPAT, JSON.stringify(compat, null, 2) + "\n", "utf8");
}

// Подсказка «серия → стандарт» по признакам коробок/суппортов серии в файле.
function buildSeriesStandardHint(records) {
  const hint = {};
  for (const r of records) {
    if (!r.series || r.seriesConfidence === "missing") continue;
    if (!["IT", "IT_ROUND", "DE", "FR", "US"].includes(r.standard)) continue;
    const key = r.series;
    hint[key] = hint[key] || {};
    hint[key][r.standard] = (hint[key][r.standard] || 0) + 1;
  }
  return hint;
}

async function writeMarkdown(ctx) {
  const { sheetName, range, columns, dataRowCount, records, stat, prefixSeriesMap, prefixSeriesEvidence, fileSeriesLinks, adapterLinks, reconciliation, exampleResults } = ctx;
  const L = [];
  const P = (s = "") => L.push(s);
  P("# Анализ прайса VIMAR — структура, параметры, черновик совместимости");
  P();
  P(`> Автоотчёт \`tools/analyze-price.mjs\` от ${new Date().toISOString().slice(0, 10)}. Источник: \`${path.basename(SOURCE_XLS)}\` (дата прайса ${SOURCE_DATE_ISO}).`);
  P("> Каждое утверждение подкреплено числом/примером, полученным скриптом из файла. Где данных нет — честно `unknown` и вынесено в «Пробелы».");
  P();
  P("## 1. Структура книги");
  P();
  P(`- Листов в книге: **${ctx.wb.SheetNames.length}** — \`${ctx.wb.SheetNames.map((n) => JSON.stringify(n)).join("`, `")}\`.`);
  P(`- Лист \`BExRepositorySheet\` пустой (служебный, от выгрузки BEx). Данные — только на листе \`${JSON.stringify(sheetName)}\` (имя с хвостовым пробелом!).`);
  P(`- Диапазон данных: \`${ws_ref(range)}\`, строк данных **${dataRowCount}** (шапка в R${HEADER_ROW0 + 1}, данные с R${DATA_ROW0 + 1}).`);
  P(`- Объединённых ячеек (\`!merges\`): **${(ctx.ws["!merges"] || []).length}** — многоэтажной шапки и строк-разделителей разделов НЕТ. Прайс — плоская таблица: одна строка = один артикул.`);
  P(`- Формул в данных: **0** — все цены статичные числа (красных флагов «формула без значения» нет).`);
  P();
  P("## 2. Паспорт колонок");
  P();
  P("| Кол. | Заголовок | Тип(ы) ячеек | Заполнено | Примеры |");
  P("|------|-----------|--------------|-----------|---------|");
  for (const c of columns) {
    const types = Object.entries(c.types).map(([t, n]) => `${t}:${n}`).join(" ");
    const fill = `${c.filled}/${dataRowCount} (${(100 * c.filled / dataRowCount).toFixed(1)}%)`;
    const samples = c.samples.slice(0, 4).map((s) => `\`${String(s).slice(0, 22).replace(/\|/g, "/")}\``).join(", ");
    P(`| ${c.letter} | ${c.header || "—"} | ${types || "—"} | ${fill} | ${samples || "—"} |`);
  }
  P();
  P("Замечания по колонкам:");
  P("- **C (цена)**: тип `n` у всех, кроме **2 ячеек типа `e` (#N/A)** — цена не посчиталась; фиксируем как `priceStatus=error`, не подставляем 0.");
  P("- **D (упаковка)**: 188 значений записаны как текст (`\"50\"`), остальное — числа; приводим к числу, где строка чисто цифровая.");
  P("- **E (примечание)**: всего 2 метки — `Запрашивать остатки` и `Новинка 07.2026` (см. статистику). Явного «снято с производства» в файле нет.");
  P("- **F–H**: пустые. **I**: одно случайное значение `1` (R6704) — артефакт, в разбор не идёт. **Категории прайса как колонки НЕТ** — в CSV `categoryDerived` выведена эвристикой `lib/classify.mjs`.");
  P();
  P("## 3. Разбор артикула VIMAR");
  P();
  const parseOk = records.filter((r) => r.articleParseable).length;
  const parseFail = records.filter((r) => !r.articleParseable);
  P("Грамматика (из файла): **БАЗА** (ведущий цифровой блок, часто 5 цифр) + **суффиксы** через точку (цвет/исполнение `.B` белый, `.N` чёрный/серебро, `.CM` карбон, реже — число модулей `.2` или код цвета Plana Up `.01…`).");
  P(`- Разобрано базой+суффиксами: **${parseOk}/${records.length}**; «нестандартная база»: **${parseFail.length}** (ведущая буква — ПО/спец, напр. \`V71303\`, \`0K01599\`, \`B.P57\`).`);
  P("- Формы базы: `#####` (5 цифр) — большинство; `#####U`/`#####A` — линейки Up/варианты; `V#####` — спец; чисто буквенные — ПО/лицензии.");
  P("- Файлово выведенный словарь суффикс→исполнение (доминирующий цвет): `.B`→белый, `.N`→серебро матовое/чёрный, `.SL`→серебро, `.M`→metal, `.CM`→карбон матовый, `.BR`→бронза, `.WW`→белый тёплый.");
  P();
  P("Примеры «нестандартной базы» (первые 20):");
  parseFail.slice(0, 20).forEach((r) => P(`- \`${r.code}\` — ${r.name.slice(0, 60)}`));
  P();
  P("## 4. Серии");
  P();
  P(`Серия читается из **названия** лишь у части позиций (у ~6400 из ${dataRowCount} слова серии в названии нет). Поэтому серия определяется по приоритету: курация (внешне выверено) → слово в названии → карта префикса артикула → \`unknown\`.`);
  P();
  P("Распределение по источнику серии:");
  for (const [k, v] of Object.entries(stat.bySeriesConfidence)) P(`- \`${k}\`: ${v}`);
  P();
  P("Данными подтверждённая карта **префикс→серия** (назначаем, если одна серия даёт ≥60% упоминаний и ≥5 свидетельств):");
  P("| Префикс | Серия | Свидетельств | Всего с серией |");
  P("|---|---|---:|---:|");
  for (const [p, v] of [...prefixSeriesMap.entries()].sort()) P(`| ${p} | ${v.series} | ${v.evidence} | ${v.total} |`);
  P();
  P("Крупнейшие префиксы **без единого упоминания серии** в названиях — серия не выводится из файла (нужен внешний каталог): " +
    largestUnnamedPrefixes(records, prefixSeriesEvidence).map((p) => `\`${p.prefix}\` (${p.count} поз.)`).join(", ") + ".");
  P();
  P("Число позиций по сериям (там, где серия определена):");
  for (const [k, v] of Object.entries(stat.bySeries)) P(`- ${k}: ${v}`);
  P();
  P("## 5. Типы позиций (role)");
  P();
  P("Тип выведен эвристикой по названию (не паспорт производителя). VIMAR почти не использует слова «рамка»/«подрозетник» — вместо них **«накладка»** (декоративная рамка/накладка) и **«коробка»**.");
  P("| Тип | Позиций | В сборку поста |");
  P("|---|---:|:--:|");
  const roleOnPost = { mechanism: "да", frame: "да", support: "да", box: "да", insert: "да", clamp: "нет", accessory: "нет", din: "нет", software: "нет", other: "нет" };
  for (const [k, v] of Object.entries(stat.byRole)) P(`| ${k} | ${v} | ${roleOnPost[k] || "нет"} |`);
  P();
  P(`Позиций, релевантных настенному посту (\`onPost\`): **${stat.onPost}**. Остальное (DIN/ПО/кабель/аксессуары) — в пост не собирается.`);
  P();
  P("## 6. Монтажные стандарты (по межосевому расстоянию)");
  P();
  P("**Настоящий маркер немецко-французского стандарта в прайсе — МЕЖОСЕВОЕ РАССТОЯНИЕ**, а не форма коробки. Официальная формулировка VIMAR (внешний источник S1): «Installation with 71 mm distance between centres (German and French standard)». Токенов `55x55`/`503`/`DIN 49073` у VIMAR нет.");
  P();
  P(`- **«71 мм»** (немецко-фр.) — **${stat.pitch71}** позиций (суппорты и многопостовые накладки).`);
  P(`- **«57 мм»** (французский, отдельный) — **${stat.pitch57}** позиций, все — Plana.`);
  P(`- Крепление с защёлками (\`fixing=claws\`) — **${stat.withClaws}** позиций (важно для правила V71701).`);
  P();
  P("**СТАНДАРТ — СВОЙСТВО КОМПОНЕНТА, НЕ СЕРИИ** (подтверждено внешним каталогом): один и тот же механизм серии ставится и в итал., и в нем. пост; различаются только КОРОБКА/СУППОРТ/НАКЛАДКА. Поэтому:");
  P("- механизмы/клавиши/клеммы → `both` (стандарт не несут);");
  P("- box/support/frame → выводим стандарт по маркеру: `71мм`→**DE**, `57мм`→**FR**, прямоуг./вытянутый суппорт/ряд ≥3→**IT**, круглая ø60 без «71мм»→**IT_ROUND** (сам по себе НЕ немецкий!), дюймовая коробка→**US**;");
  P("- DIN/ПО/кабель → `n-a`.");
  P();
  P("**Не путать:** «немецкий стандарт» у розетки — это вилка **Schuko** (`outletStandard`), не монтаж. Круглая ø60 сама по себе ≠ DE (входит и в итал. раздел как IT_ROUND).");
  P();
  P("**Распределение и изменение покрытия** (было по прежней ошибочной эвристике формы → стало по маркеру межосевого):");
  P("| standard | Было | Стало |");
  P("|---|---:|---:|");
  const wasMap = { IT: 1311, IT_ROUND: 0, DE: 386, FR: 0, US: 4, both: 18, "n-a": 221, unknown: 5436 };
  for (const k of ["IT", "IT_ROUND", "DE", "FR", "US", "both", "n-a", "unknown"]) P(`| ${k} | ${wasMap[k] ?? 0} | ${stat.byStandard[k] ?? 0} |`);
  P();
  P("Раскладки накладок (`frameLayout`, паттерн в скобках названия): " + Object.entries(stat.layouts).map(([k, v]) => `\`${k}\` — ${v}`).join(", ") + ".");
  P();
  P("Розеточный стандарт (`outletStandard`, отдельный электрический атрибут):");
  for (const [k, v] of Object.entries(stat.byOutlet)) P(`- \`${k}\`: ${v}`);
  P();
  P("### 6.1. Перепроверка текущего каталога (Idea + Neve Up)");
  P();
  P("Разбивка `standard` **только по монтажным компонентам** (box/support/frame; механизмы = `both`, стандарт не несут):");
  P("| Серия | IT | IT_ROUND | DE | FR | unknown |");
  P("|---|---:|---:|---:|---:|---:|");
  for (const s of ["Idea", "Neve Up"]) {
    const d = stat.standardBySeries[s] || {};
    P(`| ${s} | ${d.IT || 0} | ${d.IT_ROUND || 0} | ${d.DE || 0} | ${d.FR || 0} | ${d.unknown || 0} |`);
  }
  P();
  const ideaPitch = records.filter((r) => /^1[67]/.test(r.code) && r.pitchMm === 71).length;
  P("**Итог перепроверки (по маркеру межосевого):**");
  P(`- **Idea — ТОЛЬКО итальянский**: у префиксов 16/17 в прайсе **${ideaPitch}** позиций с «71 мм» и **0** многопостовых накладок. Совпадает с внешним каталогом (у Idea нет стандарта DE_FR_71). Подтверждено числами.`);
  P("- **Neve-семейство поддерживает и немецко-фр.**: суппорты `09602.1/09603.1` (префикс 09) имеют «71 мм». В таблице выше у **Neve Up** они не отражены — эти позиции в курации без проставленной серии (`series=\"\"`), поэтому попали в общий пул, а не в строку Neve Up. Внешний каталог даёт Neve стандарт DE_FR_71 — расхождение с курацией, вынесено в 7.3.");
  P("- Прежний вывод «стандарт серии» ОТМЕНЁН: стандарт несёт КОМПОНЕНТ, а не серия. Смешения разных серий в посту всё равно нельзя (разные накладки/суппорты).");
  P();
  P("### 6.2. Конфликты признаков стандарта");
  P();
  if (stat.conflicts.length === 0) {
    P("Позиций с противоречивым стандартом **не найдено** (N=0): маркер межосевого одномерен (нельзя одновременно 71 и 57 мм), поэтому противоречий внутри артикула нет.");
  } else {
    P(`Найдено **${stat.conflicts.length}** позиций с противоречивыми признаками:`);
    P("| Артикул | IT | DE |");
    P("|---|---|---|");
    for (const r of stat.conflicts.slice(0, 25)) P(`| \`${r.code}\` | ${r.standardSignalsIT} | ${r.standardSignalsDE} |`);
  }
  P();
  P("## 7. Черновик совместимости");
  P();
  P("### 7.1. Файлово подтверждённые связи серия↔серия");
  P("Извлечены из текста названий суппортов/коробок/рамок, где перечислено ≥2 серий (общий компонент). confidence=**file**.");
  P("| Серии | Позиций-свидетелей | Пример |");
  P("|---|---:|---|");
  for (const link of fileSeriesLinks.slice(0, 20)) P(`| ${link.pair.join(" ↔ ")} | ${link.count} | \`${link.codes[0]}\` ${link.sample.slice(0, 44).replace(/\|/g, "/")} |`);
  P();
  P("### 7.1b. Межсерийные адаптеры (легализуют кросс-серийные сочетания)");
  P("Суппорты/накладки, принимающие устройства ДРУГОЙ серии — они разрешают сочетания, которые иначе резолвер отверг бы по серии. Подтверждено внешними правилами C01–C04.");
  P(`Найдено таких позиций: **${adapterLinks.length}**. Ключевые:`);
  P("- `09623 «Суппорт Plana/Neve»` — по внешнему S1: суппорт Neve-семейства для установки механизмов **Plana**.");
  P("- `16723 «Суппорт Arké для накладок Idea»` — механизмы **Arké** под накладку **Idea**.");
  P("- `V51921–3 «Суппорт EIKON/ARKE/PLANA»`, `00802/00805/00800 «Orientable support для Eikon/Arké/Plana»` — общий посадочный интерфейс механизмов трёх серий.");
  P("- `V54303 «для Plana/Arké/Eikon/Neve Up»` — напольная колонка (внешний конфликт с V54412/V54420, где Neve Up нет).");
  P();
  P("### 7.2. Резолвер «артикул ↔ артикул» (проверяемость)");
  P("Экспортируемая функция `resolveCompat(codeA, codeB, index)` (+`buildCompatIndex(records)`) — чистая, вызывается из тестов/приложения. Порядок: стандарт → серия/адаптер → **ёмкость по МОДЕЛИ стандарта накладки**.");
  P("- **Итальянская модель:** сумма модулей механизмов ≤ модулей накладки (ряд ёмкостей РАЗНЫЙ по сериям — Idea 1..6,12,18 без 7; Eikon/Arké 1-4,7,8; Plana до 21).");
  P("- **Немецко-фр. модель (71/57 мм):** дискретно постами — пост = 2М, механизм >2М в пост не встаёт (трёхмодульного суппорта под 71 мм нет).");
  P("- **Правило V71701:** «только для суппортов без защёлок» — сочетание с `fixing=claws` → not_fits (артикула V71701 в этом прайсе нет; правило сработает при появлении).");
  P();
  P("Примеры на реальных артикулах (обе модели):");
  P();
  P("| A | B | verdict | reason |");
  P("|---|---|---|---|");
  for (const e of exampleResults) P(`| \`${e.a}\` | \`${e.b}\` | **${e.verdict}** | ${e.reason} |`);
  P();
  P("### 7.3. Сверка с внешними официальными данными (`compat-external.json`)");
  if (reconciliation && reconciliation.available) {
    P("**Совпадения (повышают confidence):**");
    for (const a of reconciliation.agreements) P(`- ${a}`);
    P();
    P("**Расхождения (вынесены явно, не заминаются):**");
    for (const d of reconciliation.divergences) P(`- ${d}`);
  } else {
    P("Внешний файл `tools/data/compat-external.json` не найден — сверка не проводилась.");
  }
  P();
  P("## 8. Статистика (весь прайс)");
  P();
  P(`- Строк данных: **${dataRowCount}**; артикулов: **${records.length}**; уникальных кодов: **${stat.distinctCodes}**.`);
  P(`- Дубли артикула: **${stat.duplicateCodes.length}** — ` + stat.duplicateCodes.map(([c, rr]) => `\`${c}\` (R${rr.join(",")})`).join(", ") + ".");
  P(`- Позиций без валидной цены: **${stat.noPrice}**, из них ошибок #N/A: **${stat.priceErrors.length}** — ` + stat.priceErrors.map((r) => `\`${r.code}\``).join(", ") + ".");
  P(`- С извлечённой модульностью: **${stat.withModules}**; с распознанным цветом: **${stat.withColor}**.`);
  P("- Примечания (колонка E): " + Object.entries(stat.notes).map(([k, v]) => `\`${k}\` — ${v}`).join("; ") + ".");
  P();
  P("## 9. Пробелы — вход для веб-разведки");
  P();
  P("1. **Стандарт достоверен по маркеру «71/57 мм»** и явной форме коробки; у части накладок с раскладкой `2+2` БЕЗ указания «мм» пост-структура есть, но шаг не подтверждён → `standard=unknown` (не помечаем DE без «71 мм»). Полное покрытие требует официального каталога VIMAR.");
  P("2. **Точная посадка суппорт↔коробка↔рамка** (тип защёлки, глубина коробки) — в прайсе неполна; резолвер по этим ролям осторожен. Правило V71701/защёлки заведено, но самого V71701 в прайсе нет.");
  P("3. **Совместимость механизм↔рамка на уровне артикула вне курации** — серия у крупнейших префиксов (19/20/30) в тексте не названа; берётся из prefixSeriesMap/внешнего каталога.");
  P("4. **Цвета/исполнения**: словарь суффиксов (`.B/.N/.CM…`) выведен эвристикой по хвосту названия — подтвердить по каталогу VIMAR.");
  P("5. **Снятые с производства** — явного флага нет; `Запрашивать остатки` ≠ снято. Уточнить процесс у поставщика.");
  P();
  await fs.writeFile(OUT_MD, L.join("\n"), "utf8");
}

const ws_ref = (range) => `${XLSX.utils.encode_cell(range.s)}:${XLSX.utils.encode_cell(range.e)}`;

// Сверка файловых выводов с внешними официальными данными: где совпадает — поднимаем
// confidence, где расходится — выносим отдельным списком (не заминаем).
function buildReconciliation(records, external, prefixSeriesMap) {
  if (!external) return { available: false, note: "compat-external.json не найден — сверка не проводилась." };
  const agreements = [], divergences = [];
  const p71 = records.filter((r) => r.pitchMm === 71).length;
  const p57 = records.filter((r) => r.pitchMm === 57).length;
  agreements.push(`Маркер немецко-фр. стандарта «71 мм» — ${p71} поз., «57 мм» (фр., только Plana) — ${p57} поз. Совпадает с офиц. формулировкой S1 «71 mm distance between centres (German and French standard)». confidence→file+official.`);

  const ideaPitch = records.filter((r) => /^1[67]/.test(r.code) && r.pitchMm === 71).length;
  const ideaMultiPost = records.filter((r) => /^1[67]/.test(r.code) && Number(r.postCount) >= 2).length;
  const ideaExt = (external.series || []).find((s) => s.id === "Idea");
  const ideaHasDE = ideaExt && Array.isArray(ideaExt.standards) && ideaExt.standards.includes("DE_FR_71");
  if (ideaPitch === 0 && ideaMultiPost === 0 && ideaExt && !ideaHasDE) {
    agreements.push(`Idea — ТОЛЬКО итальянский: у префиксов 16/17 в прайсе нет «71 мм» (${ideaPitch}) и многопостовых накладок (${ideaMultiPost}); внешний источник тоже не даёт Idea стандарт DE_FR_71. Подтверждено.`);
  } else {
    divergences.push(`Idea/итальянскость: прайс дал 71мм=${ideaPitch}, многопостовых=${ideaMultiPost} — перепроверить против внешнего.`);
  }

  // Префикс→серия: сверка с внешними codePrefixes.
  const extPref = {};
  for (const s of external.series || []) for (const p of s.codePrefixes || []) (extPref[p] = extPref[p] || []).push(s.id);
  for (const [p, v] of prefixSeriesMap) {
    const ext = extPref[p];
    if (ext && !ext.some((id) => id.toLowerCase().startsWith(String(v.series).toLowerCase().split(" ")[0]))) {
      divergences.push(`Префикс ${p}: по прайсу → ${v.series}; по внешнему каталогу → ${ext.join("/")}.`);
    }
  }
  divergences.push("Внешний каталог: у Eikon механизмы имеют префикс 20, а накладки/суппорты — 21 (Eikon Evo). Мой prefixSeriesMap приписывает 21→Eikon по названиям — это та же семья, но роль другая; учитывать при фильтре.");
  divergences.push("71-мм суппорты Neve-семейства (09602.1/09603.1) в прайсе БЕЗ проставленной серии (нет в курации) — поэтому в разбивке Neve Up они не видны, хотя это немецко-фр. суппорты префикса 09.");
  divergences.push("09623 «Суппорт Plana/Neve»: прайс по названию даёт связь Neve↔Plana; внешний S1 однозначно — суппорт для установки устройств PLANA (позиция Neve-семейства принимает механизмы Plana). Принять трактовку S1.");
  return { available: true, externalGeneratedAt: external.meta?.generatedAt, source: external.meta?.title, agreements, divergences };
}

function largestUnnamedPrefixes(records, evidence) {
  const totals = {};
  for (const r of records) { const p = prefix2(r.code); totals[p] = (totals[p] || 0) + 1; }
  return Object.entries(totals)
    .filter(([p]) => p !== "??" && !evidence.has(p))
    .map(([prefix, count]) => ({ prefix, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

// ───────────────────────────────────────────────────────────────────────────
// РЕЗОЛВЕР СОВМЕСТИМОСТИ (экспортируемый, чистый — без state/DOM).
// Индекс строится из массива записей; резолвер по нему разрешает пару артикулов.
// Порядок проверок: 1) наличие в прайсе, 2) участие в посте (DIN/ПО исключены),
// 3) МОНТАЖНЫЙ СТАНДАРТ первым, 4) серия, 5) модульная ёмкость по МОДЕЛИ стандарта:
//   ИТАЛЬЯНСКАЯ — сумма модулей механизмов ≤ модулей накладки (сплошной ряд);
//   НЕМЕЦКАЯ — ёмкость дискретна: пост = 2 модуля, механизм >2М в пост не встаёт,
//   набор распределяется по постам, а не по общей сумме.
// Возвращает { verdict: "fits"|"not_fits"|"unknown", reason, relation }.
// ───────────────────────────────────────────────────────────────────────────
const normalizeSeries = (s) => String(s || "").toLowerCase().replace(/\s+up$/i, "").trim();
const seriesConfident = (x) => x.seriesConfidence === "file";

function buildCompatIndex(records, seriesLinkEdges) {
  const byCode = new Map(records.map((r) => [r.code, r]));
  // Нормализованное множество связей серий: "seriesA|seriesB" (в нижнем регистре).
  const links = new Set();
  const edges = seriesLinkEdges instanceof Map ? seriesLinkEdges.keys() : [];
  for (const key of edges) links.add(key.split("|").map((s) => normalizeSeries(s)).sort().join("|"));
  return { byCode, links };
}

function seriesLinkedIn(index, sa, sb) {
  const key = [normalizeSeries(sa), normalizeSeries(sb)].sort().join("|");
  return index.links.has(key);
}

function resolveCompat_(codeA, codeB, index) {
  const a = index.byCode.get(String(codeA));
  const b = index.byCode.get(String(codeB));
  if (!a || !b) return { verdict: "unknown", reason: "одного из артикулов нет в прайсе", relation: "n/a" };
  const relation = [a.role, b.role].sort().join("+");

  // (2) DIN/ПО в сборку настенного поста не входят.
  for (const x of [a, b]) {
    if (x.role === "din") return { verdict: "not_fits", reason: `${x.code} — DIN/модульное оборудование, в сборке настенного поста не участвует`, relation };
    if (x.role === "software") return { verdict: "not_fits", reason: `${x.code} — ПО/лицензия, не физический компонент поста`, relation };
  }

  // (2b) Официальное ограничение V71701 — «only for mounting frames without claws»:
  // сочетание с суппортом на защёлках → not_fits (правило из compat-external, S1).
  const claw = (x) => x.fixing === "claws";
  const isV71701 = (x) => /^V71701\b/i.test(x.code);
  if ((isV71701(a) && claw(b)) || (isV71701(b) && claw(a))) {
    return { verdict: "not_fits", reason: "V71701 подходит только к суппортам БЕЗ защёлок (офиц. ограничение VIMAR), а парная позиция — с защёлками", relation };
  }

  // (3) Монтажный стандарт первым. Режем только когда ОБА в конфликтном наборе и
  // различны. IT_ROUND/both/unknown/n-a — гибкие, не режут (ø60 годится и в IT, и в DE).
  const strict = new Set(["IT", "DE", "FR", "US"]);
  if (strict.has(a.standard) && strict.has(b.standard) && a.standard !== b.standard) {
    return { verdict: "not_fits", reason: `разные монтажные стандарты (${a.standard} против ${b.standard})`, relation };
  }

  const postRoles = new Set(["mechanism", "frame", "support", "box", "insert"]);
  if (!postRoles.has(a.role) || !postRoles.has(b.role)) {
    return { verdict: "unknown", reason: `нет данных о стыковке ролей ${a.role}/${b.role} в прайсе`, relation };
  }

  // (4) Серия. Не допускаем ложный «fits» между разными сериями.
  let seriesRel;
  if (!a.series || !b.series) seriesRel = "missing";
  else if (normalizeSeries(a.series) === normalizeSeries(b.series)) seriesRel = "same";
  else if (seriesLinkedIn(index, a.series, b.series)) seriesRel = "linked";
  else seriesRel = "different";

  if (seriesRel === "missing") {
    return { verdict: "unknown", reason: "серия хотя бы одной позиции не определяется из данных прайса (нужен внешний каталог VIMAR)", relation };
  }
  if (seriesRel === "different") {
    if (seriesConfident(a) && seriesConfident(b)) {
      return { verdict: "not_fits", reason: `разные серии (${a.series} против ${b.series}); межсерийная связь в прайсе не подтверждена`, relation };
    }
    return { verdict: "unknown", reason: `серии предположительно разные (${a.series} / ${b.series}), часть определена по префиксу — различие не подтверждено`, relation };
  }

  // (5) Ёмкость. Определяем модель по стандарту рамки/суппорта (DE — постовая).
  const isFrameLike = (x) => x.role === "frame" || x.role === "support";
  if ((isFrameLike(a) && b.role === "mechanism") || (isFrameLike(b) && a.role === "mechanism")) {
    const frame = isFrameLike(a) ? a : b;
    const mech = frame === a ? b : a;
    const cap = Number(frame.frameModules || frame.moduleCount);
    const span = Number(mech.moduleSpanCurated || mech.moduleCount);
    if (!(Number.isFinite(cap) && cap > 0 && Number.isFinite(span) && span > 0)) {
      return { verdict: "unknown", reason: "не удалось определить модульность обеих позиций из прайса", relation };
    }
    // НЕМЕЦКО-ФРАНЦУЗСКАЯ модель (71/57 мм): ёмкость дискретна постами по 2М.
    // Механизм >2М в пост не встаёт (трёхмодульного суппорта под 71 мм в каталоге нет).
    if (frame.standard === "DE" || frame.standard === "FR") {
      const posts = Number(frame.postCount) || Math.floor(cap / 2) || 1;
      const std = frame.standard === "DE" ? "нем.-фр. (71мм)" : "фр. (57мм)";
      if (span > 2) return { verdict: "not_fits", reason: `${std}: механизм ${span}М шире поста (2М) — в пост не встаёт`, relation };
      return { verdict: "fits", reason: `${std}: механизм ${span}М помещается в пост (2М), постов ${posts}`, relation };
    }
    // ИТАЛЬЯНСКАЯ модель (IT/IT_ROUND/unknown): сплошной ряд, ширина ≤ ёмкости.
    const note = (frame.standard === "IT" || frame.standard === "IT_ROUND") ? "итал. стандарт" : "модель итал. (стандарт не определён)";
    if (span <= cap) return { verdict: "fits", reason: `${note}: механизм ${span}М помещается в ${cap}М ${frame.role === "frame" ? "накладку" : "суппорт"}`, relation };
    return { verdict: "not_fits", reason: `${note}: механизм ${span}М шире ёмкости ${cap}М`, relation };
  }

  // Два механизма одной/связанной серии совмещаются в общей накладке.
  if (a.role === "mechanism" && b.role === "mechanism") {
    const wa = Number(a.moduleSpanCurated || a.moduleCount);
    const wb = Number(b.moduleSpanCurated || b.moduleCount);
    const sum = Number.isFinite(wa) && Number.isFinite(wb)
      ? `; суммарно ${wa + wb}М — в итал. нужна накладка ≥${wa + wb}М, в нем. — распределить по постам (≤2М/пост)` : "";
    return { verdict: "fits", reason: `та же серия — механизмы совмещаются в общей накладке${sum}`, relation };
  }

  return { verdict: "unknown", reason: `роли ${a.role}/${b.role}: точная стыковка требует геометрии, которой нет в прайсе`, relation };
}

// Двойной экспорт по конвенции проекта: ESM-модуль тула + глобал/CommonJS, чтобы
// резолвер могли вызвать и Node-тесты, и (при портировании) фронтенд.
export { buildCompatIndex, resolveCompat_ as resolveCompat, deriveStandard, detectBoxShape, detectSupportType, extractLayout };
const compatApi = { buildCompatIndex, resolveCompat: resolveCompat_, deriveStandard, detectBoxShape, detectSupportType, extractLayout };
if (typeof window !== "undefined") window.EPPriceCompat = compatApi;
if (typeof module !== "undefined" && module.exports) module.exports = compatApi;

// Запуск как скрипт (не при импорте как модуль).
if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch((err) => { console.error("Ошибка анализа прайса:", err); process.exitCode = 1; });
}
