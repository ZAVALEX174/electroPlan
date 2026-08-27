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

/* Раскладка накладки на посты (для рантайма — EPPosts.frameLayout/distributePosts).
   Возвращает массив РЯДОВ, каждый ряд — массив ёмкостей постов в модулях. Считается на
   сборке каталога, а не разбором названия в рантайме (задача: признак проставляется как
   остальные атрибуты). Источники по убыванию надёжности:
     1) явная раскладка в названии в скобках: «(2+2)» → один ряд [2,2] (немецкий стандарт,
        levels=1); «(7+7)»/«(7+7+7)» при levels≥2 → по РЯДУ на слагаемое: [[7],[7]] и т.д.
        Двойные плюсы-опечатки в прайсе («2++2+2») переживаем: берём все числа из скобок,
        а не парсим знаки. Скобку-примечание («(мин. 20 шт.)») отбрасываем — в ней нет «+».
     2) без скобок, но многорядная (levels≥2) и ёмкость делится на число рядов — ровный
        раскрой по рядам: «8 модулей», levels=2 → [[4],[4]] («4+4»); один пост на ряд.
   Иначе (обычная итальянская однорядная) раскладка тривиальна — один пост на всю ширину;
   такие возвращают null (рантайм подставит [[capacity]] сам, файл атрибутов не раздуваем). */
export function postLayoutOf({ name, moduleSize, levels } = {}) {
  const total = Number(moduleSize);
  const lv = Number(levels) || 1;
  const paren = String(name ?? "").match(/\(([^)]*\+[^)]*)\)/);   // скобка со знаком «+»
  const parts = paren ? (paren[1].match(/\d+/g) || []).map(Number).filter(n => n >= 1) : [];
  if (parts.length >= 2) {
    const sum = parts.reduce((s, n) => s + n, 0);
    if (lv >= 2 && parts.length === lv) return parts.map(n => [n]);   // «7+7» → ряды по посту
    if (lv <= 1 && (!Number.isFinite(total) || sum === total)) return [parts];   // «2+2» → один ряд постов
  }
  if (lv >= 2 && Number.isInteger(total) && total > 0 && total % lv === 0) {
    const perRow = total / lv;                                       // «4+4»: ряды по одному посту
    return Array.from({ length: lv }, () => [perRow]);
  }
  return null;   // тривиальная однорядная накладка — один пост, раскладку не храним
}
/* Число постов в раскладке (для boxCount немецкого стандарта). Тривиальная (нет раскладки)
   → null, как раньше: у обычной однорядной накладки явного числа постов нет. */
export function postCountOf(layoutRows) {
  return Array.isArray(layoutRows) ? layoutRows.reduce((s, row) => s + row.length, 0) : null;
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

/*
 * Явные переклассификации kind поверх «Функциональной группы» номенклатуры
 * (tools/data/kind-overrides.json, утверждено владельцем по сверке с vimar.ru).
 * Чистая функция: мутирует переданные записи и пересчитывает ЗАВИСЯЩИЕ ОТ kind
 * производные признаки (категория/иконка + тип-специфичные slotCount / pitchMm /
 * boxShape / boxStandards), иначе после смены kind у записи остались бы признаки
 * прежнего вида. Вызывается обоими конвертерами сразу после readNomenclature —
 * один и тот же результат в catalog-vimar.js и catalog-vimar-attrs.js (не разъедется).
 *
 * overrides — карта { "<артикул>": { kind: "<новый вид>", why } }. Неизвестные виды
 * (например "accessory") просто проставляются: производных признаков поста у них нет,
 * поэтому в buildAttrs они не попадают ни в накладки/суппорты/коробки. Артикулы из
 * карты, которых нет в записях, игнорируются (в статистике отдаётся счётчик применённых).
 */
export function applyKindOverrides(records, overrides = {}) {
  const map = overrides || {};
  let applied = 0;
  for (const rec of records) {
    const ov = map[rec.code];
    if (!ov || !ov.kind || ov.kind === rec.kind) continue;
    rec.kind = ov.kind;
    const { categoryId, icon } = categoryAndIcon(rec.kind, rec.name);
    rec.categoryId = categoryId;
    rec.icon = icon;
    // сбрасываем производные прежнего вида, ставим производные нового
    delete rec.slotCount; delete rec.pitchMm; delete rec.boxShape; delete rec.boxStandards;
    if (rec.kind === "frame") rec.slotCount = rec.moduleSize;
    else if (rec.kind === "support") rec.pitchMm = pitchOf(rec.name);
    else if (rec.kind === "socket_box") {
      rec.boxShape = boxShapeOf(rec.name);
      rec.boxStandards = boxStandardsOf(rec.boxShape);
    }
    applied++;
  }
  return { records, applied };
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
 * Монтажное правило позиции из номенклатуры — «Принцип обработки» + «Модульность для
 * коробки». Раньше подбор коробки/суппорта угадывал их по ёмкости накладки, и все
 * «центральные» позиции (1М-накладка в коробку на 2 модуля, 2М — в коробку на 3) получали
 * коробку и суппорт по своей ёмкости, то есть неверные. Оба поля несут и НАКЛАДКИ, и
 * СУППОРТЫ: пара (principle + boxModularity) прямо связывает накладку 09672 с суппортом
 * 09606, 14652 с 14612 и т. д. — именно то, что ремарки номенклатуры пишут словами.
 * Кладём ТОЛЬКО заполненные значения (как layoutRows): у подавляющего большинства позиций
 * их нет, и пустые ключи раздули бы файл атрибутов без пользы.
 */
function addMountingRule(entry, rec) {
  if (rec.principle) entry.principle = rec.principle;
  if (rec.boxModularity != null) entry.boxModularity = rec.boxModularity;
  return entry;
}

/*
 * Признаки автосостава поста для рантайма (window.EP_VIMAR_ATTRS) — в том же формате,
 * что читает js/data.js: standards (накладки), supports, boxes, wallTypes + mounting
 * (монтажное правило видов, у которых своего раздела признаков нет). Раньше их
 * собирал build-catalog-attrs.mjs из price-parsed.csv + внешнего каталога совместимости;
 * теперь всё есть в номенклатуре явно.
 *
 * Монтажное правило (principle + boxModularity) проставляется КАЖДОМУ виду, у которого
 * номенклатура его заполнила, а не только накладкам и суппортам: механизмы несут принцип
 * обработки (BUTTON/SCHUP/Bluetooth — 158 позиций), IP55-корпуса 14901–14904 — «NO_INNERS,
 * AQUAPLATE». Раньше addMountingRule звался лишь в двух ветках, и до рантайма доходило
 * 287 правил из 449 — остальные молча терялись на сборке.
 */
export function buildAttrs(records) {
  const standards = {}, supports = {}, boxes = {}, wallTypes = {}, mounting = {};
  for (const rec of records) {
    if (rec.kind === "frame") {
      // Раскладку на посты считаем здесь, на сборке (задача: признак ставится как остальные
      // атрибуты, не разбором названия в рантайме). Немецкая «(2+2)» → [[2,2]], двухрядная
      // итальянская «4+4» → [[4],[4]]. Тривиальная однорядная (обычный итальянский) → null:
      // рантайм подставит один пост на всю ширину, а файл атрибутов не раздуваем.
      const layoutRows = postLayoutOf({ name: rec.name, moduleSize: rec.moduleSize, levels: rec.levels });
      const entry = { standard: rec.standard, postCount: postCountOf(layoutRows) };
      if (layoutRows) entry.layoutRows = layoutRows;   // число постов = boxCount немецкого стандарта
      addMountingRule(entry, rec);
      standards[rec.code] = entry;
    } else if (rec.kind === "support") {
      const entry = { standard: rec.standard, modules: rec.moduleSize, pitchMm: rec.pitchMm ?? null };
      addMountingRule(entry, rec);
      supports[rec.code] = entry;
    } else if (rec.kind === "socket_box") {
      const entry = {
        wallType: rec.wallType, shape: rec.boxShape,
        modules: rec.moduleSize, standards: rec.boxStandards,
      };
      // У корпусов IP55 (14901–14904, переклассифицированы из накладок через
      // kind-overrides.json) принцип обработки заполнен — «NO_INNERS, AQUAPLATE»: изделие
      // монтируется без внутренностей и относится к влагозащищённой линейке. Без этой
      // строки правило пропадало ровно у тех позиций, ради которых оверрайд и делался.
      addMountingRule(entry, rec);
      boxes[rec.code] = entry;
      if (rec.wallType && rec.wallType !== "unknown") wallTypes[rec.code] = rec.wallType;
    } else {
      /* Механизмы (и прочие виды вроде accessory) собственного раздела признаков не имеют:
         стандарт сборки и модульность поста им ни к чему. Но «Принцип обработки» у них
         заполнен — держим его в отдельном разделе mounting, ключ на артикул. Кладём только
         непустое правило (как layoutRows у накладок): у большинства механизмов его нет, и
         пустые записи раздули бы файл атрибутов без пользы. */
      const entry = addMountingRule({}, rec);
      if (Object.keys(entry).length) mounting[rec.code] = entry;
    }
  }
  return { standards, supports, boxes, wallTypes, mounting };
}
