/*
 * Чтение номенклатуры заказчика образца 2026-10-10 (задача К2, шаги 1–2).
 *
 * Новый файл заказчика отличается от прежнего («Номенклатура новая.xls») структурно:
 *   - данные на листе «VIMAR » (с пробелом в конце), первый лист служебный (BExRepositorySheet);
 *   - шапка в 3-й строке, данные с 4-й; 21 столбец вместо 25;
 *   - группы переименованы: «Рамка» вместо «Декоративные накладки», «Суппорт»/«Суппорта»
 *     вместо «Суппорты», «Монтажная коробка», «Механизм» (ед. ч.) вместо «Механизмы»;
 *   - «Количество модулей» несёт «7+7»/«3+3» (сумма — многорядная накладка/суппорт) и
 *     «1, 2»/«6, 7» (диапазон — коробки, максимум);
 *   - «Тип стены» — «Бетон» вместо прежнего «Кирпич»;
 *   - «Примечание» — 49 вертикальных объединённых ячеек на 388 строк (значение только в
 *     верхней строке диапазона);
 *   - НЕТ столбцов «Принцип обработки», «Подгруппы», «Модульность для коробки», «Группа
 *     доступа»; пусты «Цвет накладки/Материал/Форма» (отделка) и «Цвет механизма».
 *
 * Поэтому: читаем новый файл в ту же форму записи, что даёт readNomenclature (её едят
 * buildAttrs и оба конвертера), а поля, которых в новом файле нет или пусто/не распознаётся,
 * у ОБЩИХ с прежним файлом артикулов берём из прежнего файла по артикулу (решение владельца
 * К2, п.2: «если значение в новом файле есть и распознаётся — главнее новый файл»). Отделку
 * 405 новых накладок берём из docs/К2-отделка-новых-накладок/new-frames-finish.csv (решение
 * владельца К2, п.3 — данные, не код).
 *
 * Чистые функции классификации (standardOf, boxShapeOf, seriesListOf, categoryAndIcon,
 * controlRoleOf, partRoleOf, pitchOf, buildAttrs и т. д.) переиспользуем из nomenclature.mjs
 * без изменений — один источник классификации, не разъедется. Здесь только то, что в новом
 * файле иначе: карта групп, тип стены с «Бетоном», разбор «Количество модулей», разбор CSV
 * отделки и сам проход с бэкфиллом.
 */

import { mountFromNote } from "./mountNote.mjs";
import { inheritBacklight, inheritFields } from "./backlightInherit.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  standardOf, boxShapeOf, boxStandardsOf, seriesListOf, pitchOf,
  categoryAndIcon, controlRoleOf, partRoleOf, readNomenclature,
} from "./nomenclature.mjs";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
// Общий разбор листа прайса (выбор листа, строка шапки, смещение строк, цена, размер в модулях)
// живёт в одном месте с проверкой — js/priceSheet.js (§7.1): конвертер тащит его через require,
// чтобы «проверка приняла файл» и «конвертер прочитал его так же» не разъезжались.
const EPPriceSheet = require("../../js/priceSheet.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../..");     // electroplan-project/
const repoRoot = path.resolve(projectRoot, "..");     // electro/

// Пути по умолчанию держим рядом с прочими исходными данными (как DEFAULT_NOMENCLATURE в
// nomenclature.mjs) — стабильно для воспроизводимой сборки. Оригинал заказчика не трогаем.
export const DEFAULT_NOMENCLATURE_2026 = path.join(repoRoot, "Номенклатура 2026-10-10.xls");
export const DEFAULT_OLD_NOMENCLATURE = path.join(repoRoot, "Номенклатура новая.xls");
export const DEFAULT_FINISH_CSV = path.join(projectRoot, "docs/К2-отделка-новых-накладок/new-frames-finish.csv");
export const DEFAULT_FACING_OVERRIDES = path.resolve(here, "../data/frame-facing-overrides.json");
export const DEFAULT_FRAME_STANDARD_OVERRIDES = path.resolve(here, "../data/frame-standard-overrides.json");

/* Быстросъёмные механизмы с клеммами WAGO (артикул с сегментом «.FX») — решение владельца
   18.10: «если сейчас мы никак не можем это использовать, можно пока эти артикулы не вносить в
   базу». Исключаем ПРАВИЛОМ по артикулу, а не списком 27 кодов, — тогда и новые «.FX» в
   следующем файле заказчика не попадут в каталог сами. «.FX» — именно сегмент кода (между
   точками или в конце: 14000.FX.0, 14208.FX, 20208.FX.C.N), а не подстрока в произвольном месте. */
export const FX_CODE_RE = /\.FX(\.|$)/i;

const norm = (v) => String(v ?? "").trim();

/* Функциональная группа нового файла → тип товара (kind). Имена групп переименованы, но
   классифицируются ТАК ЖЕ, как их прежние эквиваленты (сверено по общим артикулам: для
   каждой группы ниже старый kind однозначен). Группы без прежнего эквивалента (лючки в пол,
   защита суппорта, листы этикеток и пр.) падают в mechanism по умолчанию — свой вид им никто
   не утверждал; перечисляются в статистике (unmappedGroups). */
// Экспортируем карту наружу (аддитивно, поведение конвертера не меняется): тест-сверка
// tests/priceTemplate.test.js проверяет, что списки групп в js/priceTemplate.js не разошлись
// с ЭТИМ источником (§7.1 — одно правило, одна точка проверки на расхождение).
export const GROUP_KIND_2026 = new Map([
  ["рамка", "frame"],
  ["рамка и клавиша", "frame"],
  // Накладные/настольные коробки, крышки IP55, лампа — НЕ накладки (решение владельца 18.10,
  // «подходит»): в выборе накладки поста и в стандартах комнаты им не место (иначе тянут
  // мусорный стандарт UNKNOWN), но в каталоге остаются и находятся поиском — как 09670.*
  // (kind-overrides → accessory). Правилом ПО ГРУППЕ, не списком кодов: новые позиции этой
  // группы в следующем файле заказчика тоже не станут накладками сами.
  ["накладной или гермитичный монтаж", "accessory"],
  ["суппорт", "support"],
  ["суппорта", "support"],
  ["суппорт накладной bluetooth", "support"],
  ["монтажная коробка", "socket_box"],
]);
export function kindOf2026(group) {
  return GROUP_KIND_2026.get(norm(group).toLowerCase()) || "mechanism";
}
const MAPPED_GROUP_KEYS = new Set(GROUP_KIND_2026.keys());

/* Группа «Накладной или Гермитичный монтаж» целиком размечена как accessory (выше), но часть её
   позиций — ГЕРМЕТИЧНЫЕ КРЫШКИ/НАКЛАДКИ IP44/IP55: это ЛИЦЕВЫЕ накладки, из них собирается
   герметичный пост, значит kind=frame (решение владельца 19.10, «да»). Отличаем крышку/накладку от
   коробки/лампы/розетки/базы той же группы по НАЗВАНИЮ (начинается с «Крышка» или «Накладка») —
   правилом, не списком 34 кодов: новые крышки следующего файла заказчика станут накладками сами, а
   «Коробка …» / «Суппорт …» / «Лампа …» останутся accessory. Гейт по группе обязателен: слово
   «Накладка» несут и обычные рамки группы «Рамка» — их этот перевод не касается. */
// Правило «герметичная крышка/накладка → лицевая накладка» живёт в общем модуле (EPPriceSheet,
// §7.1): им же пользуется проверка файла, чтобы считать вид позиции так же, как конвертер. Здесь —
// тонкие делегаты с прежними именами (их импортируют тесты и build-*).
export const HERMETIC_GROUP_KEY = EPPriceSheet.HERMETIC_GROUP_KEY;
export const HERMETIC_COVER_NAME_RE = EPPriceSheet.HERMETIC_COVER_NAME_RE;
export function isHermeticCover(group, name) {
  return EPPriceSheet.isHermeticCover(group, name);
}

/* Тип стены нового файла: «Бетон» и «Кирпич» → solid (сплошная), «ГКЛ» → hollow. «Бетон» —
   новое написание того же, что прежде звалось «Кирпич» (решение К2: «Бетон» понимается как
   прежний «Кирпич»). Оба → unknown, как в прежней модели. Своей функции (не wallTypeOf из
   nomenclature.mjs), потому что та «Бетон» не узнаёт. */
export function wallTypeOf2026(raw) {
  const s = norm(raw).toLowerCase();
  const solid = s.includes("бетон") || s.includes("кирпич");
  const hollow = s.includes("гкл");
  if (solid && hollow) return "unknown";
  if (hollow) return "hollow";
  if (solid) return "solid";
  return "unknown";
}

/* «Количество модулей» нового файла → число модулей (ёмкость):
   - число (3) → как есть;
   - десятичная доля («0.5» у фальшблоков 1/2 модуля) → как есть (не список, не сумма);
   - со знаком «+» («7+7», «3+3», «7+7+7») → СУММА слагаемых: это многорядная накладка/суппорт,
     её ёмкость равна сумме мест по рядам (7+7 = 14 мест, а не 7);
   - список через запятую («1, 2», «6, 7», «12, 14») → МАКСИМУМ: диапазон вместимости коробки
     (как делал moduleCountOf прежде для круглых коробок «1, 2»).
   Прежний moduleCountOf брал максимум ВСЕГДА — на «7+7» он дал бы 7 вместо 14 (накладка на
   14 мест превратилась бы в 7), поэтому для нового файла нужен раздельный разбор. */
export function moduleCountOf2026(raw) {
  // Разбор живёт в общем модуле (EPPriceSheet.moduleCountOf) — им же пользуется проверка, чтобы
  // «два» в модулях у накладки она ловила по тому же правилу, что и конвертер. Имя сохранено.
  return EPPriceSheet.moduleCountOf(raw);
}

/* Разбор одной строки CSV с кавычками и разделителем «;» (поля «Источник»/«Примечание» могут
   содержать «;» внутри кавычек). Минимальный парсер — внешних зависимостей во фронтенде и
   инструментах не заводим сверх xlsx. */
function parseCsvLine(line) {
  const out = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }   // экранированная кавычка ""
        else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ";") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/* Отделка 405 новых накладок (решение К2, п.3): артикул → {frameColor, frameMaterial,
   frameShape}. Файл UTF-8 с BOM, разделитель «;». Нет файла — пустая карта (сборка не падает,
   как с kind-overrides). Берём только три колонки отделки; «Источник»/«Примечание» — для
   человека, в данные каталога не идут. */
export function readFinishCsv(csvPath = DEFAULT_FINISH_CSV) {
  const map = new Map();
  let text;
  try { text = fs.readFileSync(csvPath, "utf8"); } catch { return map; }
  text = text.replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return map;
  const header = parseCsvLine(lines[0]).map(norm);
  const iCode = header.indexOf("Артикул");
  const iCol = header.indexOf("Цвет накладки");
  const iMat = header.indexOf("Материал накладки");
  const iShp = header.indexOf("Форма накладки");
  for (let i = 1; i < lines.length; i++) {
    const f = parseCsvLine(lines[i]);
    const code = norm(f[iCode]);
    if (!code) continue;
    map.set(code, {
      frameColor: (iCol >= 0 && norm(f[iCol])) || null,
      frameMaterial: (iMat >= 0 && norm(f[iMat])) || null,
      frameShape: (iShp >= 0 && norm(f[iShp])) || null,
    });
  }
  return map;
}

/* Ручные правки отделки накладок (решения владельца 18.10 по docs/К2-отделка-новых-накладок/
   ОТЧЁТ.md, раздел «Расхождения»): артикул → { frameColor?, frameMaterial?, frameShape? }.
   ОДИН видимый файл-источник того, что поправлено руками и почему (поле why рядом). Применяется
   ПОВЕРХ и CSV (новые накладки), и бэкфилла из старого файла (общие) — одинаково для любого
   источника. Нет файла — пустая карта (сборка не падает, как с kind-overrides). */
export function readFacingOverrides(jsonPath = DEFAULT_FACING_OVERRIDES) {
  const map = new Map();
  let text;
  try { text = fs.readFileSync(jsonPath, "utf8"); } catch { return map; }
  let doc;
  try { doc = JSON.parse(text.replace(/^﻿/, "")); } catch { return map; }
  for (const [code, ov] of Object.entries(doc.overrides || {})) {
    if (ov && typeof ov === "object") map.set(code, ov);
  }
  return map;
}

/* Ручная разметка монтажного стандарта накладок (frame-standard-overrides.json, решение владельца
   19.10): артикул → "IT"|"DE"|"BOTH". Нужна позициям, у которых «Монтажный стандарт» в номенклатуре
   пуст и в старом файле их нет (новые герметичные крышки). Применяется ПОВЕРХ распознавания и
   бэкфилла — задаёт стандарт явно. Нет файла/битый JSON — пустая карта (сборка не падает). */
export function readFrameStandardOverrides(jsonPath = DEFAULT_FRAME_STANDARD_OVERRIDES) {
  const map = new Map();
  let text;
  try { text = fs.readFileSync(jsonPath, "utf8"); } catch { return map; }
  let doc;
  try { doc = JSON.parse(text.replace(/^﻿/, "")); } catch { return map; }
  for (const [code, ov] of Object.entries(doc.overrides || {})) {
    if (ov && typeof ov === "object" && ov.standard) map.set(code, String(ov.standard).trim().toUpperCase());
  }
  return map;
}

// Имена столбцов нового файла. Нормализация поиска гасит расхождения по пробелам — как в
// readNomenclature с «Подгруппы ». Столбцов principle/subgroup/boxModularity/accessGroup в файле
// заказчика 2026-10-10 НЕТ — их at() вернёт null, и значение возьмётся из прежнего файла; но если
// заказчик добавит их в новый прайс (решение владельца 25.10), конвертер прочитает их оттуда.
const COL = {
  code: "Артикул", name: "Наименование", price: "Прайс розница РФ, Евро",
  pack: "Кол-во в упаковке", note: "Примечание", moduleSize: "Количество модулей",
  series: "Коллекция", control: "Тип управления", group: "Функциональная группа",
  wall: "Тип стены", standard: "Монтажный стандарт", levels: "Количество уровней в рамке",
  color: "Цвет механизма",
  frameColor: "Цвет накладки", frameMaterial: "Материал накладки", frameShape: "Форма накладки",
  askBacklight: "Спрашивать подсветку 1 - да, пусто - нет",
  backlightColor: "Цвет подсветки",
  backlightPosition: "Позиция подсветки 1 - верх, 2 - центр, 3 - низ",
  principle: "Принцип обработки", subgroup: "Подгруппы",
  boxModularity: "Модульность для коробки", accessGroup: "Группа доступа",
};

// Позицию подсветки новый файл пишет строкой («1»/«2»/«3»), прежний — числом. Приводим к числу.
const toNum = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = norm(v);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/*
 * Читает новый файл номенклатуры и возвращает { header, records, stats } в том же формате,
 * что readNomenclature, + статистику бэкфилла и разведки для отчёта. oldXlsPath — прежний
 * файл (источник недостающих полей по артикулу), finishCsv — отделка новых накладок.
 * excludeSeries — как прежде (IDEA пока не включаем; в файле её и нет).
 */
export function readNomenclature2026(xlsPath = DEFAULT_NOMENCLATURE_2026, {
  oldXlsPath = DEFAULT_OLD_NOMENCLATURE,
  finishCsv = DEFAULT_FINISH_CSV,
  facingOverridesPath = DEFAULT_FACING_OVERRIDES,
  frameStandardOverridesPath = DEFAULT_FRAME_STANDARD_OVERRIDES,
  excludeSeries = ["idea"],
} = {}) {
  const wb = XLSX.readFile(xlsPath);
  // Лист данных выбираем общей функцией проверки (EPPriceSheet.chooseSheet, §7.1): лист «VIMAR» по
  // trim (служебный BExRepositorySheet мимо), иначе первый лист со столбцом «Артикул», иначе первый
  // лист книги. Прежде конвертер брал ПОСЛЕДНИЙ лист — на файле-шаблоне (листы «Прайс»/«Пояснения»)
  // это давало 0 записей, расходясь с проверкой. startRow — номер первой строки листа в Excel (из
  // !ref), чтобы sourceRow совпадал с номером строки Excel при листе не от A1.
  const toGrid = (nm) => XLSX.utils.sheet_to_json(wb.Sheets[nm], { header: 1, raw: true, defval: null, blankrows: true });
  const chosen = EPPriceSheet.chooseSheet({
    names: wb.SheetNames,
    grid: toGrid,
    ref: (nm) => wb.Sheets[nm] && wb.Sheets[nm]["!ref"],
  });
  const sheetName = chosen.name;
  const ws = wb.Sheets[sheetName];
  const grid = chosen.grid;
  const startRow = chosen.startRow;

  // Объединённые ячейки «Примечание» (49 вертикальных объединений на 388 строк): значение
  // стоит только в верхней строке диапазона, у остальных null. Раскрываем на весь диапазон —
  // иначе у ~339 строк примечание читалось бы пустым. ТОЛЬКО одностолбцовые (вертикальные)
  // объединения: горизонтальных в файле нет (проверено), а копировать значение поперёк колонок
  // было бы ошибкой (затёрло бы соседние поля).
  // Координаты !merges абсолютны от A1, а grid (sheet_to_json {header:1}) идёт от верхнего-левого
  // угла !ref: при листе не от A1 (пустые строки сверху И/ИЛИ пустые столбцы слева) индекс в grid
  // смещён — и по строке, и по столбцу (§7.1, край). Приводим координаты объединения к индексам
  // grid через угол диапазона, иначе примечание уедет на соседнюю строку/столбец.
  const origin = EPPriceSheet.rangeOrigin(ws["!ref"]);
  for (const m of (ws["!merges"] || [])) {
    if (m.s.c !== m.e.c) continue;
    const sr = m.s.r - origin.r, sc = m.s.c - origin.c, er = m.e.r - origin.r;
    if (sr < 0 || sc < 0) continue;     // объединение выше/левее начала грида — вне данных листа
    const top = grid[sr] ? grid[sr][sc] : null;
    if (top == null) continue;
    for (let rr = sr + 1; rr <= er; rr++) {
      if (!grid[rr]) grid[rr] = [];
      if (grid[rr][sc] == null) grid[rr][sc] = top;
    }
  }

  // Шапка — первая строка со столбцом «Артикул» (та же функция, что у проверки). На файле
  // заказчика это 3-я строка (индекс 2), как было у прежнего жёсткого HEADER_ROW=2.
  const HEADER_ROW = EPPriceSheet.findHeaderRow(grid);
  const header = (HEADER_ROW >= 0 ? grid[HEADER_ROW] : []).map(norm);
  const colIndex = new Map();
  header.forEach((h, i) => { if (h && !colIndex.has(h)) colIndex.set(h, i); });
  const at = (row, name) => {
    const i = colIndex.get(norm(name));
    return i == null ? null : row[i];
  };

  // Прежний файл — источник недостающих полей по артикулу; CSV — отделка новых накладок.
  const { records: oldRecords } = readNomenclature(oldXlsPath, { excludeSeries });
  const oldByCode = new Map(oldRecords.map((r) => [r.code, r]));
  const finishByCode = readFinishCsv(finishCsv);
  const facingOverrides = readFacingOverrides(facingOverridesPath);
  const frameStandardOverrides = readFrameStandardOverrides(frameStandardOverridesPath);

  const excluded = new Set(excludeSeries.map((s) => norm(s).toLowerCase()));

  const records = [];
  const stats = {
    sheet: sheetName, ref: ws["!ref"], totalRows: grid.length - (HEADER_ROW + 1),
    withCode: 0, excluded: 0, blankRows: 0, noCodeRows: 0,
    byKind: {}, bySeries: {}, byStandard: {}, byGroup: {}, dupCodes: [], missingModule: 0,
    withSubgroup: 0, byPartRole: {}, byControlRole: {},
    // Разведка для отчёта:
    commonWithOld: 0, newArticles: 0,               // пересечение с прежним файлом
    unmappedGroups: {},                             // новые группы без прежнего эквивалента → mechanism
    backlightInherited: {},                         // правило → сколько новых клавиш получили подсветку
    mountInherited: {},                             // уровень брата → сколько новых накладок получили principle/boxModularity
    mountFromNote: {},                              // правило примечания → сколько новых накладок получили принцип из «Примечания»
    mountNoteConflict: [],                          // принцип старого файла ≠ принцип из примечания (старый НЕ перезаписан)
    mountNoteUnparsed: [],                          // примечание про монтаж, формулировки в таблице нет
    mountNoteNoSupport: [],                         // «В суппорт N», а у N принципа нет
    mountDiverge: [],                               // новые накладки: братья расходятся — поля не угаданы
    mountNoData: [],                                // новые накладки: у братьев данных нет
    controlFromOld: [],                             // тип управления не распознан → роль взята из прежнего файла
    backfill: {},                                  // поле → сколько значений взято из прежнего файла
    finishFromCsv: 0,                               // накладок с отделкой из CSV
    facingOverridden: 0,                            // накладок с ручной правкой отделки (оверрайд)
    excludedFx: 0, excludedFxCodes: [],             // быстросъёмные «.FX», исключённые из каталога
    newFramesWithoutFinish: [],                     // новые накладки без отделки ни из CSV, ни из old
    unrecognizedControl: {},                        // «тип управления» непуст, но роль не распознана (новые)
  };
  const bump = (field) => { stats.backfill[field] = (stats.backfill[field] || 0) + 1; };
  const seen = new Set();

  for (let r = HEADER_ROW + 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row) { stats.blankRows++; continue; }
    const code = norm(at(row, COL.code));
    if (!code) {
      // строка-разделитель (вся пустая) или строка без артикула, но с данными (их 2 — в отчёт)
      if (row.every((v) => v == null || norm(v) === "")) stats.blankRows++;
      else stats.noCodeRows++;
      continue;
    }
    stats.withCode++;
    if (seen.has(code)) { stats.dupCodes.push(code); continue; }
    seen.add(code);

    // Быстросъёмные «.FX» (WAGO) — не вносим в каталог (решение владельца 18.10). Правило по
    // артикулу → новые «.FX» следующего файла тоже отсеются сами.
    if (FX_CODE_RE.test(code)) { stats.excludedFx++; stats.excludedFxCodes.push(code); continue; }

    const seriesRaw = norm(at(row, COL.series));
    const seriesRawList = seriesRaw.split(/[,;]/).map((x) => norm(x).toLowerCase()).filter(Boolean);
    if (seriesRawList.length && seriesRawList.every((s) => excluded.has(s))) {
      stats.excluded++;
      continue;
    }

    const old = oldByCode.get(code) || null;
    if (old) stats.commonWithOld++; else stats.newArticles++;

    const group = norm(at(row, COL.group));
    const groupKey = group.toLowerCase();
    if (group && !MAPPED_GROUP_KEYS.has(groupKey) && kindOf2026(group) === "mechanism" && !old) {
      // новая группа без прежнего эквивалента, легла в mechanism по умолчанию — в отчёт
      stats.unmappedGroups[group] = (stats.unmappedGroups[group] || 0) + 1;
    }
    const name = norm(at(row, COL.name));
    // Герметичные крышки/накладки группы «Накладной или Гермитичный монтаж» — лицевые накладки
    // (kind=frame), а не accessory: см. isHermeticCover. Правило по названию внутри группы.
    let kind = kindOf2026(group);
    if (isHermeticCover(group, name)) kind = "frame";

    // --- Размер в модулях: новый файл главнее; пусто → из прежнего файла ---
    const moduleRaw = String(at(row, COL.moduleSize) ?? "");
    let moduleSize = moduleCountOf2026(at(row, COL.moduleSize));
    if (moduleSize == null && old && old.moduleSize != null) { moduleSize = old.moduleSize; bump("moduleSize"); }

    // --- Монтажный стандарт: новый главнее, если распознан; иначе из прежнего ---
    let standardRaw = norm(at(row, COL.standard));
    let standard = standardOf(standardRaw);
    if (standard === "UNKNOWN" && old && old.standard && old.standard !== "UNKNOWN") {
      standard = old.standard; standardRaw = old.standardRaw; bump("standard");
    }
    // Ручная разметка стандарта (frame-standard-overrides.json) — ПОВЕРХ распознавания и бэкфилла:
    // для новых герметичных крышек стандарт нигде в данных не распознаётся, задаём явно (решение 19.10).
    const stdOverride = frameStandardOverrides.get(code);
    if (stdOverride) { standard = stdOverride; standardRaw = standardRaw || stdOverride; bump("standardOverride"); }

    // --- Тип стены: новый главнее, если распознан; иначе из прежнего ---
    let wallRaw = norm(at(row, COL.wall));
    let wallType = wallTypeOf2026(wallRaw);
    if (wallType === "unknown" && old && old.wallType && old.wallType !== "unknown") {
      wallType = old.wallType; wallRaw = old.wallRaw; bump("wallType");
    }

    // --- Уровни рамки: в новом файле почти пусто → из прежнего (нужны для раскладки на ряды) ---
    let levels = toNum(at(row, COL.levels));
    if (levels == null && old && old.levels != null) { levels = old.levels; bump("levels"); }
    // Многорядная накладка «N+N(+N)» без явных уровней: число рядов = число слагаемых (решение
    // владельца 18.10 по 14690.27/14691.27, сверено с vimar.com — 2 и 3 ряда по 7). Гейт
    // moduleSize>8 отделяет истинно многорядные от боковых «1+1»/«3+3»/«4+4» (≤8 модулей — один
    // физический ряд, напр. 09679 «по бокам»): их не трогаем. Будущие большие «N+N» получат
    // ряды сами, без правки по артикулам.
    if (levels == null && kind === "frame" && moduleRaw.includes("+") && moduleSize > 8) {
      const parts = (moduleRaw.match(/\d+/g) || []).length;
      if (parts >= 2) { levels = parts; bump("levelsFromPlus"); }
    }

    // --- Цвет элемента (начинки): в новом файле пуст у всех → из прежнего ---
    let color = norm(at(row, COL.color)) || null;
    if (!color && old && old.color) { color = old.color; bump("color"); }

    // --- Отделка накладки: новый файл пуст у всех накладок → из прежнего (общие), иначе из CSV (новые) ---
    let frameColorRaw = norm(at(row, COL.frameColor)) || null;
    let frameMaterialRaw = norm(at(row, COL.frameMaterial)) || null;
    let frameShapeRaw = norm(at(row, COL.frameShape)) || null;
    if (old) {
      if (!frameColorRaw && old.frameColorRaw) { frameColorRaw = old.frameColorRaw; bump("frameColor"); }
      if (!frameMaterialRaw && old.frameMaterialRaw) { frameMaterialRaw = old.frameMaterialRaw; bump("frameMaterial"); }
      if (!frameShapeRaw && old.frameShapeRaw) { frameShapeRaw = old.frameShapeRaw; bump("frameShape"); }
    }
    if (kind === "frame" && !(frameColorRaw || frameMaterialRaw || frameShapeRaw)) {
      const fin = finishByCode.get(code);
      if (fin && (fin.frameColor || fin.frameMaterial || fin.frameShape)) {
        frameColorRaw = fin.frameColor; frameMaterialRaw = fin.frameMaterial; frameShapeRaw = fin.frameShape;
        stats.finishFromCsv++;
      } else {
        stats.newFramesWithoutFinish.push(code);
      }
    }
    // Ручная правка отделки (frame-facing-overrides.json, решения владельца 18.10) — ПОВЕРХ и
    // CSV, и бэкфилла: цвет/материал/форма задаются явно для перечисленных артикулов.
    const fo = facingOverrides.get(code);
    if (fo) {
      if (fo.frameColor != null) frameColorRaw = norm(fo.frameColor) || null;
      if (fo.frameMaterial != null) frameMaterialRaw = norm(fo.frameMaterial) || null;
      if (fo.frameShape != null) frameShapeRaw = norm(fo.frameShape) || null;
      stats.facingOverridden++;
    }

    // --- Тип управления: новый главнее; пусто → из прежнего. Роль пересчитываем по итогу ---
    let controlType = norm(at(row, COL.control)) || null;
    if (!controlType && old && old.controlType) { controlType = old.controlType; bump("controlType"); }
    let controlRole = controlRoleOf(controlType);
    // Новое значение не распознано (у 14007 «В, П»), а в прежнем файле роль была → берём её
    // (решение владельца). Исключение — «ДД»: IR-выключатели 09181/19181/20181 переведены в
    // датчики движения сознательно, их прежняя роль выключателя больше не верна.
    if (controlType && !controlRole && old && old.controlRole && norm(controlType).toLowerCase() !== "дд") {
      controlRole = old.controlRole;
      stats.controlFromOld.push({ code, now: controlType, role: controlRole });
    }
    if (controlType && !controlRole && !old) {
      // непустой, но нераспознанный тип управления у НОВОГО артикула — значение не выдумываем
      (stats.unrecognizedControl[controlType] ||= []).push(code);
    }

    // --- Монтажное правило, подгруппа, модульность, группа доступа: новый файл главнее, если
    //     значение есть; пусто → из прежнего (решение владельца 25.10). Разбор — тот же, что
    //     nomenclature.mjs применяет к прежнему файлу: principle/subgroup — строка (trim), иначе
    //     null; boxModularity/accessGroup — только число. В файле 2026-10-10 этих столбцов нет
    //     (at() вернёт null) → всё берётся из прежнего, как раньше; bump помечает источник. ---
    let principle = norm(at(row, COL.principle)) || null;
    if (!principle && old && old.principle) { principle = old.principle; }
    if (principle) bump("principle");
    let subgroup = norm(at(row, COL.subgroup)) || null;
    if (!subgroup && old && old.subgroup) { subgroup = old.subgroup; }
    if (subgroup) bump("subgroup");
    const boxModCell = at(row, COL.boxModularity);
    let boxModularity = typeof boxModCell === "number" ? boxModCell : null;
    if (boxModularity == null && old && old.boxModularity != null) { boxModularity = old.boxModularity; }
    if (boxModularity != null) bump("boxModularity");
    const accessCell = at(row, COL.accessGroup);
    let accessGroup = typeof accessCell === "number" ? accessCell : null;
    if (accessGroup == null && old && old.accessGroup != null) { accessGroup = old.accessGroup; }
    if (accessGroup != null) bump("accessGroup");

    // --- Подсветка клавиш: новый главнее; если в новом пусто, а в прежнем есть — из прежнего ---
    const rAsk = toNum(at(row, COL.askBacklight));
    let askBacklight = rAsk === 1;
    let backlightColor = norm(at(row, COL.backlightColor)) || null;
    let backlightPosition = toNum(at(row, COL.backlightPosition));
    if (rAsk == null && !backlightColor && backlightPosition == null && old) {
      if (old.askBacklight) { askBacklight = true; bump("askBacklight"); }
      if (old.backlightColor) { backlightColor = old.backlightColor; bump("backlightColor"); }
      if (old.backlightPosition != null) { backlightPosition = old.backlightPosition; bump("backlightPosition"); }
    }

    // Цена — общим разбором (EPPriceSheet.parsePrice): число ИЛИ текст с запятой/точкой («6,99»).
    // Прежде брали только числовую ячейку, и текстовая цена проваливалась в запасной прайс 01.07.26
    // (у 20506 — 173,43 € вместо 6,99 €). На файле заказчика все цены числовые — результат тот же.
    const priceCell = at(row, COL.price);
    const priceParsed = EPPriceSheet.parsePrice(priceCell);
    const nomPrice = Number.isFinite(priceParsed) ? priceParsed : null;
    // Кол-во в упаковке (К6): целое число штук в коробке поставщика. В файле клетка бывает и ЧИСЛОМ,
    // и ТЕКСТОМ («50») — 135 позиций (Plana, Arke, Eikon, Linea, Neve Up) заданы строкой, и разбор
    // только по typeof number терял их упаковку. Принимаем оба вида: строку берём, только если после
    // trim это целое > 0 (образец — tools/analyze-price.mjs); пусто/мусор → null, тогда округления
    // кратно упаковке для артикула не будет. Прежнего файла бэкфиллом не трогаем: упаковка — свойство
    // текущей поставки, устаревшее значение хуже отсутствующего.
    const packCell = at(row, COL.pack);
    let packQty = null;
    if (typeof packCell === "number" && Number.isFinite(packCell) && packCell > 0) packQty = packCell;
    else if (typeof packCell === "string" && /^\d+$/.test(packCell.trim()) && Number(packCell.trim()) > 0) packQty = Number(packCell.trim());

    const { categoryId, icon } = categoryAndIcon(kind, name);
    // Роль детали: «голый механизм» требует группы «Механизмы»; в новом файле она зовётся
    // «Механизм» (ед. ч.). Нормализуем для partRoleOf, чтобы 18 голых механизмов определялись
    // как прежде (иначе их осталось бы 4 — только из «Механизмы»).
    const groupForRole = (groupKey === "механизм" || groupKey === "механизмы") ? "механизмы" : group;

    const rec = {
      sourceRow: r + startRow,
      code,
      brand: "VIMAR",                             // «Бренд» в новом файле отдельной колонкой не вынесен
      name,
      group,
      kind,
      categoryId,
      icon,
      series: seriesListOf(seriesRaw),
      seriesRaw,
      moduleSize,
      standard,
      standardRaw,
      wallType,
      wallRaw,
      levels,
      boxModularity,
      accessGroup,
      color,
      frameColorRaw,
      frameMaterialRaw,
      frameShapeRaw,
      controlType,
      controlRole,
      partRole: partRoleOf({ group: groupForRole, controlRole, name }),
      principle,
      subgroup,
      note: norm(at(row, COL.note)) || null,
      askBacklight,
      backlightColor,
      backlightPosition,
      nomPrice,
      packQty,
    };
    if (moduleSize == null && kind === "frame") stats.missingModule++;

    // Новая клавиша без признаков подсветки: брат по базовому артикулу / Tondo-аналог Flat
    // (backlightInherit.mjs, решение владельца 19.10). Старые артикулы сюда не попадают.
    if (!old) {
      const inh = inheritBacklight(rec, oldRecords);
      if (inh && inh.rule === "diverge") (stats.backlightDiverge ||= []).push({ code, brothers: inh.brothers });
      else if (inh) {
        rec.askBacklight = inh.askBacklight;
        rec.backlightPosition = inh.backlightPosition;
        rec.backlightColor = inh.backlightColor;
        stats.backlightInherited[inh.rule] = (stats.backlightInherited[inh.rule] || 0) + 1;
      }
    }

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
    if (rec.subgroup) stats.withSubgroup++;
    if (rec.partRole) stats.byPartRole[rec.partRole] = (stats.byPartRole[rec.partRole] || 0) + 1;
    if (rec.controlRole) stats.byControlRole[rec.controlRole] = (stats.byControlRole[rec.controlRole] || 0) + 1;
    for (const s of rec.series) stats.bySeries[s] = (stats.bySeries[s] || 0) + 1;
  }
  // Монтаж накладок: порядок — старый файл (уже в rec) → «Примечание» → брат. Примечание ссылается
  // на суппорты, поэтому разбираем после прохода по всем строкам. Расхождение примечания со
  // старым файлом не перезаписываем молча, а выносим в stats.mountNoteConflict.
  const supportsByCode = new Map(records.filter((x) => x.kind === "support")
    .map((x) => [x.code, { principle: x.principle, boxModularity: x.boxModularity }]));
  const oldFrames = oldRecords.filter((o) => o.kind === "frame");
  for (const rec of records) {
    if (rec.kind !== "frame" || !rec.note) continue;
    const fromNote = mountFromNote(rec.note, supportsByCode);
    if (!fromNote) continue;
    if (fromNote.rule === "unparsed") { stats.mountNoteUnparsed.push(rec.code + ": " + rec.note); continue; }
    if (fromNote.rule === "nosupportdata") { stats.mountNoteNoSupport.push(rec.code + ": " + rec.note); continue; }
    if (oldByCode.has(rec.code)) {
      if (rec.principle && (rec.principle !== fromNote.principle || (rec.boxModularity ?? null) !== (fromNote.boxModularity ?? null)))
        stats.mountNoteConflict.push({ code: rec.code, old: rec.principle + "/" + rec.boxModularity, note: fromNote.principle + "/" + fromNote.boxModularity });
      continue;
    }
    let used = false;
    if (rec.principle == null) { rec.principle = fromNote.principle; used = true; }
    if (rec.boxModularity == null && fromNote.boxModularity != null) { rec.boxModularity = fromNote.boxModularity; used = true; }
    if (used) stats.mountFromNote[fromNote.rule] = (stats.mountFromNote[fromNote.rule] || 0) + 1;
  }
  for (const rec of records) {
    if (rec.kind !== "frame" || oldByCode.has(rec.code)) continue;
    const inh = inheritFields(rec, oldFrames, ["principle", "boxModularity"]);
    if (inh && inh.rule === "diverge") stats.mountDiverge.push({ code: rec.code, brothers: inh.brothers });
    else if (inh && inh.rule === "nodata") stats.mountNoData.push({ code: rec.code, brothers: inh.brothers });
    else if (inh) {
      Object.assign(rec, inh.values);
      stats.mountInherited[inh.rule] = (stats.mountInherited[inh.rule] || 0) + 1;
    }
  }
  return { header, records, stats };
}
