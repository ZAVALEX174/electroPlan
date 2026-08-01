/*
 * Чтение и классификация файла номенклатуры VIMAR (заказчик прислал явный состав
 * каталога: серия, размер в модулях, монтажный стандарт, тип стены, функциональная
 * группа, число уровней рамки, цвет). Это ЗАМЕНА прежней эвристики по прайсу
 * (tools/data/catalog-curation.json + lib/classify по названию): теперь состав и
 * атрибуты берутся из номенклатуры в явном виде, а прайс даёт только актуальную цену.
 *
 * Модуль чистый и без побочных эффектов (кроме чтения xls, путь приходит аргументом):
 * его переиспользуют оба конвертера — build-catalog.mjs (состав + цены → catalog-vimar.js)
 * и build-catalog-attrs.mjs (признаки автосостава поста → catalog-vimar-attrs.js), а также
 * автотесты. Один источник классификации — не разъедется между файлами.
 *
 * Структура файла (лист «Лист2», шапка в строке 1, данные со строки 2, A1:Y2148):
 *   A Бренд · B Серия · C Артикул · D Наименование · E Размер в модулях ·
 *   F цена, евро · G Тип управления · H Функциональная группа · I Тип стены ·
 *   J Монтажный стандарт · K Количество уровней в рамке · L Цвет элемента ·
 *   M Группа доступа · … · V Принцип обработки · W Подгруппы · Y Модульность для коробки.
 * Колонки статуса в файле НЕТ — фильтровать по «Активному» нечем (см. отчёт).
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { classify } from "./classify.mjs";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");     // electro/
// Номенклатуру, как и прайс, держим в electro/ (рядом с .xls прайса) — стабильный путь
// для воспроизводимой сборки. Оригинал заказчика (в Downloads) не трогаем: это копия.
export const DEFAULT_NOMENCLATURE = path.join(repoRoot, "Номенклатура новая.xls");

const norm = (v) => String(v ?? "").trim();

/* Функциональная группа → тип товара приложения (kind). Прочие группы (розетки,
   управление светом, зарядные, разъёмы, механизмы, отели, заглушки, подсветка
   клавиш) — это устройства поста, то есть mechanism. Сверяем по нижнему регистру,
   т.к. в файле встречается и «отели», и «Отели». */
const GROUP_KIND = new Map([
  ["монтажные коробки", "socket_box"],
  ["суппорты", "support"],
  ["декоративные накладки", "frame"],
]);
export function kindOf(group) {
  return GROUP_KIND.get(norm(group).toLowerCase()) || "mechanism";
}

/* Монтажный стандарт из колонки J. «Итальянский, Немецкий» → BOTH (универсальный):
   приложение уже умеет BOTH (boxFitsStandard пропускает любой, состав помечается
   приблизительным). Инвертировать это в IT/DE тут нельзя — расходились бы с файлом. */
export function standardOf(raw) {
  const s = norm(raw).toLowerCase();
  const it = s.includes("итальян");
  const de = s.includes("немец");
  if (it && de) return "BOTH";
  if (de) return "DE";
  if (it) return "IT";
  return "UNKNOWN";
}

/* Тип стены из колонки I: Кирпич→solid, ГКЛ→hollow. «ГКЛ, Кирпич» подходит к любой
   стене — в модели приложения это «unknown» (wallFits пропускает unknown под любой
   запрошенный тип). У коробок в файле значения чистые (solid|hollow), «оба» бывает
   только у суппортов, а они тип стены не учитывают. */
export function wallTypeOf(raw) {
  const s = norm(raw).toLowerCase();
  const solid = s.includes("кирпич");
  const hollow = s.includes("гкл");
  if (solid && hollow) return "unknown";
  if (hollow) return "hollow";
  if (solid) return "solid";
  return "unknown";
}

/* «Размер в модулях» (E) → число. Обычно целое (3), но у круглой коробки на 1-2
   модуля стоит строка «1, 2» — берём наибольшее (коробка вмещает до 2 модулей). */
export function moduleCountOf(raw) {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const nums = String(raw ?? "").match(/\d+/g);
  if (!nums || !nums.length) return null;
  return Math.max(...nums.map(Number));
}

/* Форма коробки из названия: круглая/прямоугольная. Коробки без слова формы —
   это итальянские прямоугольные врезные (round только у ø60 «для 1-2 модулей»). */
export function boxShapeOf(name) {
  const s = norm(name).toLowerCase();
  if (/кругл/.test(s)) return "round";
  if (/прямоуголь/.test(s)) return "rect";
  return "rect";
}
/* Совместимые стандарты коробки (как в прежней модели compat-external): круглая ø60
   годится под один пост немецко-французской и итальянской-круглой сборки, прямоугольная
   — под итальянскую сборку на N модулей. Жёсткий фильтр в EPPostFit.boxFitsStandard. */
export function boxStandardsOf(shape) {
  return shape === "round" ? ["IT_ROUND", "DE", "FR"] : ["IT"];
}

/* Серии из колонки B: список через запятую → массив. Регистр в файле верхний
   («EIKON EVO»); приводим к «Eikon Evo» для показа. Совпадение серий в рантайме
   регистронезависимо (productSeries + toLocaleLowerCase), так что дисплей-регистр
   безопасен. Пусто (у коробок) → []. */
export function prettySeries(one) {
  return norm(one).toLowerCase().replace(/(^|[\s-])([a-zа-яё])/g, (_, p, c) => p + c.toUpperCase());
}
export function seriesListOf(raw) {
  return norm(raw).split(/[,;]/).map((x) => prettySeries(x)).filter(Boolean);
}

/* Межосевой шаг суппорта из названия («…71мм…») — только для справки; в подборе
   суппорта (findSupport) он не участвует, но пусть будет как в прежних attrs. */
export function pitchOf(name) {
  const m = norm(name).match(/(\d{2,3})\s*мм/i);
  return m ? Number(m[1]) : null;
}

/* Категория и иконка. Для рамки/суппорта/коробки — фиксированные (как в текущем
   каталоге: рамка □/100, суппорт ≡/200, коробка ○/200). Для механизма переиспользуем
   классификатор по названию (js/…/classify.mjs) — он даёт categoryId (300–1000, под
   группировку выпадающего списка mechanismGroupLabels) и иконку (⌁/◉/USB/°C/…). */
export function categoryAndIcon(kind, name) {
  if (kind === "frame") return { categoryId: 100, icon: "□" };
  if (kind === "support") return { categoryId: 200, icon: "≡" };
  if (kind === "socket_box") return { categoryId: 200, icon: "○" };
  const c = classify(name);
  // classify.categoryId==100/200 бывает только когда он сам счёл товар рамкой/коробкой;
  // для устройства поста это ложь — уводим в «Прочее», чтобы не путать группировку.
  const categoryId = c.categoryId === 100 || c.categoryId === 200 ? 1000 : c.categoryId;
  return { categoryId, icon: c.icon };
}

const COL = {
  brand: "Бренд", series: "Серия", code: "Артикул", name: "Наименование",
  moduleSize: "Размер в модулях", price: "цена, евро", control: "Тип управления",
  group: "Функциональная группа", wall: "Тип стены", standard: "Монтажный стандарт",
  levels: "Количество уровней в рамке", color: "Цвет элемента", access: "Группа доступа",
  principle: "Принцип обработки", subgroup: "Подгруппы ", boxModularity: "Модульность для коробки",
  note: "Описание особенностей элемента",
};

/*
 * Читает номенклатуру и возвращает нормализованные записи + словари/статистику для
 * отчёта. excludeSeries — серии, которые не тащим в каталог (по умолчанию IDEA: её
 * решено пока не включать, «но данные не удалять»; в текущем файле её и нет). Запись
 * выбрасывается, только если ВСЕ её серии исключены — общий для многих серий механизм
 * (…, IDEA) остаётся.
 */
export function readNomenclature(xlsPath, { excludeSeries = ["idea"] } = {}) {
  const wb = XLSX.readFile(xlsPath);
  const sheetName = wb.SheetNames.find((n) => n.trim() === "Лист2") || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
  const header = (grid[0] || []).map(norm);
  const at = (row, name) => {
    const i = header.indexOf(name);
    return i < 0 ? null : row[i];
  };
  const excluded = new Set(excludeSeries.map((s) => norm(s).toLowerCase()));

  const records = [];
  const stats = {
    sheet: sheetName, ref: ws["!ref"], totalRows: grid.length - 1,
    withCode: 0, excluded: 0, byKind: {}, bySeries: {}, byStandard: {}, byGroup: {},
    dupCodes: [], missingModule: 0,
  };
  const seen = new Set();

  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row) continue;
    const code = norm(at(row, COL.code));
    if (!code) continue;
    stats.withCode++;
    if (seen.has(code)) { stats.dupCodes.push(code); continue; }
    seen.add(code);

    const seriesRaw = norm(at(row, COL.series));
    const seriesRawList = seriesRaw.split(/[,;]/).map((x) => norm(x).toLowerCase()).filter(Boolean);
    if (seriesRawList.length && seriesRawList.every((s) => excluded.has(s))) {
      stats.excluded++;
      continue;
    }

    const group = norm(at(row, COL.group));
    const kind = kindOf(group);
    const name = norm(at(row, COL.name));
    const { categoryId, icon } = categoryAndIcon(kind, name);
    const moduleSize = moduleCountOf(at(row, COL.moduleSize));
    const standard = standardOf(at(row, COL.standard));
    const wallType = wallTypeOf(at(row, COL.wall));
    const priceCell = at(row, COL.price);
    const nomPrice = typeof priceCell === "number" && Number.isFinite(priceCell) ? priceCell : null;
    const levelsCell = at(row, COL.levels);
    const boxModCell = at(row, COL.boxModularity);
    const accessCell = at(row, COL.access);

    const rec = {
      sourceRow: r + 1,
      code,
      brand: norm(at(row, COL.brand)) || "VIMAR",
      name,
      group,
      kind,
      categoryId,
      icon,
      series: seriesListOf(seriesRaw),
      seriesRaw,
      moduleSize,
      standard,
      standardRaw: norm(at(row, COL.standard)),
      wallType,
      wallRaw: norm(at(row, COL.wall)),
      levels: typeof levelsCell === "number" ? levelsCell : null,
      boxModularity: typeof boxModCell === "number" ? boxModCell : null,
      accessGroup: typeof accessCell === "number" ? accessCell : null,
      color: norm(at(row, COL.color)) || null,
      controlType: norm(at(row, COL.control)) || null,
      principle: norm(at(row, COL.principle)) || null,
      subgroup: norm(at(row, COL.subgroup)) || null,
      note: norm(at(row, COL.note)) || null,
      nomPrice,
    };
    if (moduleSize == null && kind === "frame") stats.missingModule++;

    // тип-специфичные производные признаки
    if (kind === "frame") rec.slotCount = moduleSize;
    if (kind === "support") rec.pitchMm = pitchOf(name);
    if (kind === "socket_box") {
      rec.boxShape = boxShapeOf(name);
      rec.boxStandards = boxStandardsOf(rec.boxShape);
    }

    records.push(rec);
    stats.byKind[kind] = (stats.byKind[kind] || 0) + 1;
    stats.byGroup[group] = (stats.byGroup[group] || 0) + 1;
    stats.byStandard[standard] = (stats.byStandard[standard] || 0) + 1;
    for (const s of rec.series) stats.bySeries[s] = (stats.bySeries[s] || 0) + 1;
  }
  return { header, records, stats };
}

/*
 * Сведение цены товара: приоритет у актуального прайса (по артикулу), номенклатура —
 * запасной источник. priceEntry — {price, pack} из прайса (price===null, если артикула
 * нет или ячейка — ошибка/не число). Возвращает финальную цену (2 знака), её источник и
 * упаковку. Пустую/битую цену прайса игнорируем и падаем на номенклатуру, а не на ноль.
 */
export function resolveCatalogPrice(nomPrice, priceEntry) {
  const round2 = (n) => Math.round(n * 100) / 100;
  const pv = priceEntry && typeof priceEntry.price === "number" && Number.isFinite(priceEntry.price) && priceEntry.price > 0
    ? priceEntry.price : null;
  if (pv != null) return { price: round2(pv), source: "price", packQty: priceEntry.pack ?? null };
  const nv = typeof nomPrice === "number" && Number.isFinite(nomPrice) && nomPrice > 0 ? nomPrice : 0;
  return { price: round2(nv), source: "nomenclature", packQty: null };
}

/*
 * Признаки автосостава поста для рантайма (window.EP_VIMAR_ATTRS) — в том же формате,
 * что читает js/data.js: standards (накладки), supports, boxes, wallTypes. Раньше их
 * собирал build-catalog-attrs.mjs из price-parsed.csv + внешнего каталога совместимости;
 * теперь всё есть в номенклатуре явно.
 */
export function buildAttrs(records) {
  const standards = {}, supports = {}, boxes = {}, wallTypes = {};
  for (const rec of records) {
    if (rec.kind === "frame") {
      // postCount оставляем null: приложение выведет число постов само (для DE — ceil(M/2)).
      // Явного «числа постов» в файле нет, а «уровни рамки» (K) — это ряды, не посты.
      standards[rec.code] = { standard: rec.standard, postCount: null };
    } else if (rec.kind === "support") {
      supports[rec.code] = { standard: rec.standard, modules: rec.moduleSize, pitchMm: rec.pitchMm ?? null };
    } else if (rec.kind === "socket_box") {
      boxes[rec.code] = {
        wallType: rec.wallType, shape: rec.boxShape,
        modules: rec.moduleSize, standards: rec.boxStandards,
      };
      if (rec.wallType && rec.wallType !== "unknown") wallTypes[rec.code] = rec.wallType;
    }
  }
  return { standards, supports, boxes, wallTypes };
}
