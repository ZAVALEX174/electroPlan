/* Общий разбор листа прайса VIMAR (К9 — починка 25.10, §7.1).
   ОДНО место для правил, по которым читается лист прайса, — чтобы «проверка сказала „ошибок нет“»
   и «конвертер принял файл так же» не разъезжались. Прежде check() (js/priceTemplate.js) и конвертер
   (tools/lib/nomenclature2026.mjs) читали файл по-РАЗНОМУ: конвертер брал последний лист и шапку
   жёстко в 3-й строке, цену — только числовую; проверка искала лист по «Артикулу», шапку в любой
   строке, цену-текст принимала. Теперь оба зовут функции отсюда.

   Модуль ЧИСТЫЙ: ни state, ни DOM, ни xlsx. На вход — уже прочитанные данные (массив строк,
   строка диапазона «A3:X13», список имён листов + геттеры). XLSX живёт у вызывающих (браузер — у
   окна проверки, Node — у конвертера), сюда его не тащим: тогда модуль одинаково работает и в
   браузере (window.EPPriceSheet), и в конвертере (require через createRequire).

   Двойной экспорт: браузеру — window.EPPriceSheet (сборщика нет, PLAN 2.2), Node — module.exports. */
(() => {
"use strict";

const norm = (v) => String(v == null ? "" : v).trim();

/* Цена позиции из ячейки прайса. Принимаем и число, и текст с запятой или точкой как
   разделителем дробной части; пробелы-разделители тысяч («1 234,50») допускаются. Возвращаем
   число или NaN (пусто/мусор). Решение владельца 25.10: одна функция и для проверки, и для
   конвертера — иначе «6,99» принимается проверкой, но у конвертера проваливается в запасной
   прайс (у 20506 давало 173,43 € вместо 6,99 €). Логику «> 0 / не число — ошибка» применяет
   вызывающий (check — ошибкой, конвертер — как отсутствие цены). */
function parsePrice(cell) {
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : NaN;
  const s = norm(cell);
  if (!s) return NaN;
  const n = Number(s.replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

/* Строка шапки — первая строка, где встречается столбец «Артикул». Так ищут и проверка, и
   конвертер (решение владельца 25.10: шапка в любой строке, не жёстко в 3-й). -1 — шапки нет. */
function findHeaderRow(grid) {
  const g = Array.isArray(grid) ? grid : [];
  for (let i = 0; i < g.length; i++) {
    const row = g[i];
    if (Array.isArray(row) && row.some((c) => norm(c) === "Артикул")) return i;
  }
  return -1;
}

/* Номер первой строки листа (1-based) из строки диапазона !ref («A3:X13» → 3). Нужен, чтобы
   номера строк в отчёте совпадали с номерами Excel: sheet_to_json({header:1}) отдаёт массив от
   ПЕРВОЙ строки диапазона, а не от строки 1 — если над шапкой пустые строки, !ref начинается не с
   A1, и индекс массива занижает номер строки (шапка «3-й строки» приезжала в отчёт как 1-я).
   Нет !ref — лист с A1, смещения нет (1). */
function startRowOf(ref) {
  if (!ref || typeof ref !== "string") return 1;
  const first = ref.split(":")[0];
  const m = /(\d+)/.exec(first);
  return m ? parseInt(m[1], 10) : 1;
}

/* Размер в модулях из «Количество модулей»:
   - число (3) → как есть; дробь («0.5»/«0,5») → как есть (не список, не сумма);
   - со знаком «+» («7+7», «3+3») → СУММА слагаемых (многорядная накладка: 7+7 = 14 мест);
   - список через запятую («1, 2», «6, 7») → МАКСИМУМ (диапазон вместимости коробки).
   null — пусто или не распознано. Один разбор для конвертера (ёмкость товара) и для проверки
   (накладка с «два» в модулях — ошибка): раньше правило жило только в конвертере. */
function moduleCountOf(raw) {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const s = norm(raw);
  if (!s) return null;
  if (/^\d+[.,]\d+$/.test(s)) return Number(s.replace(",", "."));
  const nums = (s.match(/\d+/g) || []).map(Number);
  if (!nums.length) return null;
  if (s.includes("+")) return nums.reduce((a, b) => a + b, 0);
  return Math.max(...nums);
}

/* Выбор листа данных прайса. wbLike:
     { names: [имена листов], grid(name) -> массив строк, ref?(name) -> строка !ref }.
   Правило (решение владельца 25.10, одно для проверки и конвертера): лист «VIMAR» (по trim);
   если такого нет — первый лист, где есть строка-шапка со столбцом «Артикул»; если и такого нет —
   первый лист книги. Грид строим ТОЛЬКО по чужому геттеру (XLSX у вызывающего).
   Возвращает { name, grid, startRow }. */
function chooseSheet(wbLike) {
  const names = (wbLike && wbLike.names) || [];
  let name = names.find((n) => norm(n) === "VIMAR");
  if (name == null) name = names.find((n) => findHeaderRow(wbLike.grid(n)) >= 0);
  if (name == null) name = names.length ? names[0] : null;
  if (name == null) return { name: null, grid: [], startRow: 1 };
  const ref = wbLike.ref ? wbLike.ref(name) : null;
  return { name, grid: wbLike.grid(name), startRow: startRowOf(ref) };
}

const api = { parsePrice, findHeaderRow, startRowOf, moduleCountOf, chooseSheet };

if (typeof window !== "undefined") window.EPPriceSheet = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
