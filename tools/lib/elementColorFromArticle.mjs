/*
 * Вывод «Цвета элемента» механизма ИЗ АРТИКУЛА (К12 ч.3, доводка раунд 3, решение владельца
 * 01.11 «Да, из артикула»).
 *
 * Зачем. У серий с ПОСТОЯННОЙ палитрой (Eikon/Arke/Plana/Neve Up) цвет механизма кодируется
 * СУФФИКСОМ артикула, а в названии его нет вовсе: 20066 — серый, 20066.B — белый, 20066.N —
 * серебро. Столбец «Цвет элемента» у таких позиций пуст, в названии цвета нет — поэтому и
 * фильтр «только механизмы цвета «Белый»» в окне поста пропускал серые 20066/20021.C/20022.*.
 * Этот модуль ВЫУЧИВАЕТ соответствие «суффикс → цвет» и «база → цвет» из самих данных (строк,
 * где цвет уже известен — из столбца ИЛИ из названия) и выводит цвет там, где его нет ни в
 * столбце, ни в названии. Приоритет источников (решение владельца): столбец > название >
 * артикул — артикул НЕ перебивает название (порядок обеспечивает вызывающий, buildAttrs).
 *
 * Правило, которое воплощает модуль (выведено из номенклатуры 10.10, см. разведку в отчёте):
 *   1. Словарь учится ОТДЕЛЬНО ПО КАЖДОЙ СЕРИИ (ключ — точный список серий, как в
 *      elementColorFromName): суффикс .SL в Plana значит Серебристый, а в другой серии его нет.
 *   2. ЦВЕТ БАЗЫ серии — доминирующий цвет «голых» артикулов (без буквенного суффикса:
 *      20066, 20021), закрепляется при >= THRESHOLD и >= MIN_OCCURRENCES. Это «серый по
 *      умолчанию» (Eikon/Arke → Чёрный, Plana/Neve Up → Белый). Серия без доминирующего
 *      базового цвета (Eikon Flat/Vintage — там палитра декоративная, цвет в НАЗВАНИИ) базы не
 *      получает → из артикула ей цвет не выводим вовсе (owner: «суффиксы цвета не выучиваются»).
 *   3. ЦВЕТОВОЙ СУФФИКС — буквенный последний сегмент (.B/.N/.M/.SL/.CM), у которого ОДИН цвет
 *      набрал >= THRESHOLD при >= MIN_OCCURRENCES И этот цвет ОТЛИЧАЕТСЯ от базового. Условие
 *      «отличается от базы» — ключевое: оно отделяет цветовой суффикс от СИМВОЛЬНОГО
 *      (.C/.L/.P звонок/лампа/ключ, .USB/.DND/.PLS/.CC). В данных символьные суффиксы тоже
 *      проходят порог, но их цвет РАВЕН базовому (символьный артикул — та же база, просто с
 *      символом): 20021.C — серый (=база Чёрный), как 20021. Owner прямо перечислил .C/.L/.P/
 *      .USB как НЕ цветовые — равенство базе и есть формальный признак этого. Поэтому цвет
 *      символьного артикула выводится ПРАВИЛОМ БАЗЫ (см. ниже), а не как «цвет суффикса».
 *
 * Вывод цвета для механизма БЕЗ столбца и БЕЗ названия:
 *   - последний сегмент артикула — выученный ЦВЕТОВОЙ суффикс → его цвет (20066.N → Серебристый);
 *   - иначе, если у артикула есть СОСЕД code.<цветовой суффикс> в каталоге серии (значит это
 *     «база» семейства: 20066 рядом с 20066.B; 20021.C рядом с 20021.C.N) → базовый цвет серии;
 *   - иначе — ничего (null). Значения — ТОЛЬКО реальные написания цвета из данных серии, ничего
 *     не выдумываем.
 *
 * Чистый модуль (PLAN 7.1): без state/DOM/каталога. Запись читаем по полям code, series
 * (массив), color (известный цвет — из столбца ИЛИ выведенный из названия; что и для каких
 * строк — решает вызывающий). Экспорт ESM, как у соседних tools/lib/*.mjs. seriesKeyOf берём
 * из elementColorFromName — ОДНО правило ключа серии на оба словаря, не разъедется (§7.1).
 */

import { seriesKeyOf } from "./elementColorFromName.mjs";

const norm = (v) => String(v ?? "").trim();

// Порог/минимум — те же осознанные значения, что у словаря по названию (elementColorFromName).
// Выносим в константы, чтобы мутационный тест мог сломать правило порога и увидеть покраснение.
export const THRESHOLD = 0.8;
export const MIN_OCCURRENCES = 2;

/* Буквенный суффикс артикула = ПОСЛЕДНИЙ сегмент (между точками), если он целиком из латинских
   букв. Коды VIMAR латинские (20066.B, 14506.2.SL, 20021.C.N), кириллицы в них нет. Цифровой
   сегмент (20066, 09001.0.250) и отсутствие точки → суффикса нет (null). Приводим к верхнему
   регистру — суффиксы в кодах всегда прописные, сравнение регистронезависимо. */
export function suffixOf(code) {
  const segs = norm(code).split(".");
  const last = segs[segs.length - 1];
  return /^[a-z]+$/i.test(last) ? last.toUpperCase() : null;
}

/* Доминирующий цвет множества записей: цвет, собравший >= threshold всех вхождений при total >=
   minOccurrences. Иначе null (неоднозначно — наугад не ставим, как в словаре по названию). */
function dominantColor(byColor, total, threshold, minOccurrences) {
  if (total < minOccurrences) return null;
  let best = null;
  for (const [color, n] of byColor) if (!best || n > best.n) best = { color, n };
  return best && best.n / total >= threshold ? best.color : null;
}

/*
 * Учит словарь артикулов по сериям из записей с ИЗВЕСТНЫМ цветом. records — { code, series,
 * color }, где color непуст, если цвет уже известен (из столбца ИЛИ из названия — так решает
 * вызывающий). Записи БЕЗ цвета тоже передаются (их code нужен, чтобы находить соседей-базы).
 * Возвращает Map(ключ серии → { colorSuffixes: Map(суффикс → цвет), baseColor, codes: Set }).
 * Детерминирован: тот же вход → тот же результат (при ничьей цветов — null).
 */
export function buildArticleColorDictionary(records, {
  threshold = THRESHOLD, minOccurrences = MIN_OCCURRENCES,
} = {}) {
  // ключ серии → { codes:Set(ВЕРХНИЙ регистр, ВСЕ артикулы), known:[{code, color, suffix}] }
  const perSeries = new Map();
  for (const rec of records || []) {
    const key = seriesKeyOf(rec && rec.series);
    if (!key) continue;                                   // нет серии — учить не на чём
    if (!perSeries.has(key)) perSeries.set(key, { codes: new Set(), known: [] });
    const e = perSeries.get(key);
    const code = norm(rec && rec.code);
    if (code) e.codes.add(code.toUpperCase());
    const color = norm(rec && rec.color);
    if (code && color) e.known.push({ code, color, suffix: suffixOf(code) });
  }

  const dict = new Map();
  for (const [key, e] of perSeries) {
    // (1) Базовый цвет серии — доминирующий цвет «голых» баз (без буквенного суффикса).
    const baseByColor = new Map();
    let baseTotal = 0;
    for (const k of e.known) {
      if (k.suffix) continue;                             // есть буквенный суффикс — не «голая» база
      baseByColor.set(k.color, (baseByColor.get(k.color) || 0) + 1);
      baseTotal++;
    }
    const baseColor = dominantColor(baseByColor, baseTotal, threshold, minOccurrences);
    // Серия без доминирующего базового цвета (декоративная палитра Flat/Vintage) — из артикула
    // цвет не выводим: отличить цветовой суффикс от символьного там нечем. Owner: «не выучиваются».
    if (!baseColor) continue;

    // (2) Цветовые суффиксы — буквенные суффиксы, чей доминирующий цвет ОТЛИЧАЕТСЯ от базового.
    //     Равный базовому (символьные .C/.L/.P/.USB — та же база с символом) цветовым не считаем.
    const bySuffix = new Map();                           // суффикс → { total, byColor }
    for (const k of e.known) {
      if (!k.suffix) continue;
      if (!bySuffix.has(k.suffix)) bySuffix.set(k.suffix, { total: 0, byColor: new Map() });
      const s = bySuffix.get(k.suffix);
      s.total++;
      s.byColor.set(k.color, (s.byColor.get(k.color) || 0) + 1);
    }
    const colorSuffixes = new Map();
    for (const [suf, s] of bySuffix) {
      const c = dominantColor(s.byColor, s.total, threshold, minOccurrences);
      if (c && c !== baseColor) colorSuffixes.set(suf, c);
    }
    if (colorSuffixes.size) dict.set(key, { colorSuffixes, baseColor, codes: e.codes });
  }
  return dict;
}

/* Есть ли у артикула СОСЕД code.<выученный цветовой суффикс> в каталоге серии (признак «базы»). */
function hasColorSibling(codeUpper, entry) {
  for (const suf of entry.colorSuffixes.keys()) {
    if (entry.codes.has(codeUpper + "." + suf)) return true;
  }
  return false;
}

/*
 * Выводит цвет механизма ИЗ АРТИКУЛА по словарю. Порядок:
 *   1) последний сегмент — выученный цветовой суффикс → его цвет (20066.N → Серебристый);
 *   2) иначе, если есть сосед code.<цветовой суффикс> (это «база»: 20066, 20021.C) → цвет базы;
 *   3) иначе → null. Нет словаря для серии (нет базы/суффиксов) → null.
 */
export function deriveColorFromArticle(rec, dictionary) {
  const entry = dictionary && dictionary.get(seriesKeyOf(rec && rec.series));
  if (!entry) return null;
  const code = norm(rec && rec.code);
  const suf = suffixOf(code);
  if (suf && entry.colorSuffixes.has(suf)) return entry.colorSuffixes.get(suf);
  if (hasColorSibling(code.toUpperCase(), entry)) return entry.baseColor;
  return null;
}
