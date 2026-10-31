/*
 * Вывод «Цвета элемента» механизма ИЗ НАЗВАНИЯ (К12 ч.3, доводка по приёмке 31.10).
 *
 * Зачем. «Цвет элемента» (столбец номенклатуры) заполнен лишь у 344 механизмов из ~1046;
 * у остальных цвет есть ТОЛЬКО в названии («…серый», «…серебро матовое», «…белые»). Из-за
 * этого фильтр «только механизмы цвета «Белый»» в окне поста пропускал серый 20003 и
 * серебристый 20003.N — у них столбец пуст, хотя слово в названии однозначно. Модуль
 * ВЫУЧИВАЕТ соответствие «слово в названии → цвет» из самих же данных (строк, где столбец
 * заполнен) и выводит цвет для строк, где столбца нет.
 *
 * Решение владельца (утверждено 31.10), которое этот модуль воплощает:
 *   1. Столбец главнее названия ВСЕГДА: есть «Цвет элемента» — берём его, вывод не трогаем
 *      (resolveElementColor). Вывод из названия — только когда столбец пуст.
 *   2. Словарь слово→цвет учится ОТДЕЛЬНО ПО КАЖДОЙ СЕРИИ (ключ — точный список серий
 *      позиции): в разных сериях одно слово значит разный цвет (Eikon «серая» → «Чёрный»,
 *      а не «Серый»). Значение цвета — всегда реальное написание из столбца этой серии;
 *      новых названий цвета не выдумываем. Серия без заполненных строк (Linea, Eikon Tondo/
 *      Tactil, мультисерийные) словаря не получает → её механизмы остаются без цвета, как было.
 *   3. Шум не должен победить: слово закрепляется за цветом, только если ОДИН цвет набрал
 *      >= THRESHOLD (0.8) всех вхождений слова в серии И вхождений не меньше MIN_OCCURRENCES.
 *   4. Многословные цвета («серебро матовое», «сатинированное золото») не путаются с их
 *      частями: учим фразы длиной до MAX_PHRASE_WORDS слов, а при выводе берём САМУЮ ДЛИННУЮ
 *      фразу, совпавшую с названием (contiguous). Так «…сатинированное золото» даёт
 *      «Сатинированное золото», а не «Золото», хотя слово «золото» есть в обоих.
 *
 * ПОЧЕМУ MIN_OCCURRENCES = 2, а не 3 (владелец предложил 3 «или обоснуй числами»). У серии
 * Eikon Flat весь словарь цвета держится на ДВУХ базовых клавишах (22751.0.* и 22751.*):
 * каждый цвет встречается там ровно 2 раза. Порог 3 выкинул бы ВСЮ серию Flat, а владелец
 * прямо требует Flat «белые» → «Белые матовые». При пороге 2 и правиле 0.8 слово с двумя
 * вхождениями закрепляется, только если ОБА согласны (2/2 = 100%): одиночная шумная строка
 * даёт 1/2 = 50% < 0.8 и отбрасывается — защита от шума сохранена. На реальных данных это
 * даёт 341 выведенный цвет, 0 неоднозначных и 0 расхождений слова с цветом (кроме законного
 * «карбон матовый» → «Чёрный» у Neve Up — это сам столбец так говорит).
 *
 * Чистый модуль (PLAN 7.1): без state/DOM/каталога. Запись читаем по полям name, series
 * (массив), color (значение столбца или пусто) — какие записи учить и для каких выводить,
 * решает вызывающий (buildAttrs передаёт механизмы). Экспорт ESM, как у соседних
 * tools/lib/*.mjs (mountNote, backlightInherit) — конвертер и тесты тащат его через import.
 */

const norm = (v) => String(v ?? "").trim();

// Порог/минимум/длина фразы — осознанные значения из разведки (см. шапку). Выносим в
// константы, чтобы мутационный тест мог сломать правило порога и увидеть покраснение.
export const THRESHOLD = 0.8;
export const MIN_OCCURRENCES = 2;
export const MAX_PHRASE_WORDS = 3;

/* Складка написания: нижний регистр и ё→е (сравнение без регистра и с ё=е, как facingKey).
   Пробелы не трогаем здесь — токенизация разрежет по ним сама. */
export function foldText(s) {
  return norm(s).toLowerCase().replace(/ё/g, "е");
}

/* Название → список слов-токенов (буквы кириллицы/латиницы и цифры; всё прочее — разделитель).
   Пунктуация номенклатуры разнородна («Flat,белые», «, серебро матовое», «серебро,матовое»),
   поэтому режем по любому не-буквенно-цифровому символу, а не только по пробелу. */
export function tokenizeName(name) {
  return foldText(name).split(/[^а-яa-z0-9]+/i).filter(Boolean);
}

/* Ключ серии — точный список серий позиции (решение владельца: учим отдельно по каждому
   списку серий). Складываем регистр/ё и соединяем через «|». Порядок серий в номенклатуре
   у родственных артикулов одинаков, поэтому список берём как есть, не пересортируя: это и
   есть «точный список». Пустой список (у коробок/суппортов) → "" — у них цвета нет. */
export function seriesKeyOf(series) {
  return (Array.isArray(series) ? series : []).map((s) => foldText(s)).filter(Boolean).join("|");
}

/* Все непрерывные фразы длиной 1..MAX_PHRASE_WORDS из списка токенов, каждая один раз
   (Set): слово/фраза, встреченное в названии дважды, не должно считаться за два вхождения. */
function phrasesOf(tokens, maxWords) {
  const out = new Set();
  for (let n = 1; n <= maxWords; n++) {
    for (let i = 0; i + n <= tokens.length; i++) out.add(tokens.slice(i, i + n).join(" "));
  }
  return out;
}

/*
 * Учит словарь слово/фраза → цвет из записей с ЗАПОЛНЕННЫМ столбцом. records — записи с
 * полями { name, series, color }; учитываются только те, где color непуст (какие виды сюда
 * попадают — решает вызывающий; buildAttrs передаёт механизмы). Возвращает
 * Map(ключ серии → Map(фраза → цвет)). Детерминирован (тот же вход → тот же результат):
 * при равенстве счётчиков двух цветов фраза остаётся НЕзакреплённой (ни один не >= порога).
 */
export function buildColorDictionary(records, {
  threshold = THRESHOLD, minOccurrences = MIN_OCCURRENCES, maxPhraseWords = MAX_PHRASE_WORDS,
} = {}) {
  // ключ серии → Map(фраза → Map(цвет → число вхождений)) + общий счётчик фразы
  const learn = new Map();
  for (const rec of records || []) {
    const color = norm(rec && rec.color);
    if (!color) continue;
    const key = seriesKeyOf(rec.series);
    if (!key) continue;                                   // нет серии — учить не на чём
    if (!learn.has(key)) learn.set(key, new Map());
    const byPhrase = learn.get(key);
    for (const phrase of phrasesOf(tokenizeName(rec.name), maxPhraseWords)) {
      if (!byPhrase.has(phrase)) byPhrase.set(phrase, { total: 0, byColor: new Map() });
      const e = byPhrase.get(phrase);
      e.total++;
      e.byColor.set(color, (e.byColor.get(color) || 0) + 1);
    }
  }
  // Финализация: фраза закрепляется за цветом, если он собрал >= порога вхождений и их >= минимума.
  const dict = new Map();
  for (const [key, byPhrase] of learn) {
    const resolved = new Map();
    for (const [phrase, e] of byPhrase) {
      if (e.total < minOccurrences) continue;
      let best = null;
      for (const [color, n] of e.byColor) if (!best || n > best.n) best = { color, n };
      if (best && best.n / e.total >= threshold) resolved.set(phrase, best.color);
    }
    if (resolved.size) dict.set(key, resolved);
  }
  return dict;
}

/* Проверка: фраза phraseTokens — непрерывная подпоследовательность tokens? */
function containsPhrase(tokens, phraseTokens) {
  for (let i = 0; i + phraseTokens.length <= tokens.length; i++) {
    let ok = true;
    for (let j = 0; j < phraseTokens.length; j++) if (tokens[i + j] !== phraseTokens[j]) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}

/*
 * Выводит цвет механизма ИЗ НАЗВАНИЯ по словарю: берёт САМУЮ ДЛИННУЮ фразу словаря (для
 * серии записи), совпавшую с названием. Так «сатинированное золото» (2 слова) перебивает
 * «золото» (1 слово). Если самую длинную длину делят фразы с РАЗНЫМ цветом — не угадываем
 * (null): лучше оставить без цвета, чем поставить наугад. Нет словаря для серии / нет
 * совпадений → null.
 */
export function deriveColorFromName(rec, dictionary) {
  const byPhrase = dictionary && dictionary.get(seriesKeyOf(rec && rec.series));
  if (!byPhrase) return null;
  const tokens = tokenizeName(rec && rec.name);
  let bestLen = 0;
  const bestColors = new Set();
  for (const [phrase, color] of byPhrase) {
    const pw = phrase.split(" ");
    if (pw.length < bestLen) continue;
    if (!containsPhrase(tokens, pw)) continue;
    if (pw.length > bestLen) { bestLen = pw.length; bestColors.clear(); }
    bestColors.add(color);
  }
  if (!bestLen || bestColors.size !== 1) return null;     // нет совпадений или ничья разных цветов
  return [...bestColors][0];
}

/*
 * Итоговый цвет элемента записи: СТОЛБЕЦ ГЛАВНЕЕ НАЗВАНИЯ. Заполнен «Цвет элемента» — он и
 * возвращается (вывод из названия не трогаем). Пусто — выводим из названия по словарю.
 * Ни того ни другого — null. Это ОДНО место правила «столбец главнее» (§7.1): его же
 * ломает мутационный тест.
 */
export function resolveElementColor(rec, dictionary) {
  const column = norm(rec && rec.color);
  if (column) return column;
  return deriveColorFromName(rec, dictionary);
}
