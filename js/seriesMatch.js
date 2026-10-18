/* ЕДИНОЕ правило совместимости коллекций (серий) изделий — шаг 3 задачи К2.

   Решение владельца (4) и слова заказчика (встреча, 0:20:38–0:21:50): «если не указано
   коллекция — значит всем подходит… есть коллекция Эйкон, а у неё разные виды рамок —
   винтаж, экзе, эво. Если где написано Эйкон, оно ко всем Эйконам».

   Правило (одно место на весь проект, §7.1 — иначе у правки EIKON снова будут края):
     • пустая коллекция у любой из сторон → подходит ВСЕМ (универсальное изделие/запрос);
     • «Eikon» БЕЗ подсерии ↔ любая «Eikon …» (Evo, Exe, Flat, Vintage, Tactil, Tondo и всё,
       что ещё появится) — ПО ПРЕФИКСУ, без списка подсерий: новая подсерия заработает сама;
     • подсерия ↔ подсерия — только точное совпадение (Eikon Evo ≠ Eikon Exe).

   Семейный префикс включён ТОЛЬКО для «eikon» (FAMILY_BASES). Не делаем правило общим «любая
   база X ↔ X …»: тогда «Arke» ошибочно подошла бы к «Arke Fit» (физически другой монтаж,
   отдельная линейка). Нужна ещё семья — добавить её базу сюда одной строкой.

   Чистая функция, без DOM/state. Браузеру — window.EPSeriesMatch, Node — module.exports. */
(() => {
"use strict";

const norm = (s) => String(s == null ? "" : s).trim().toLocaleLowerCase("ru-RU");
const toList = (v) => (Array.isArray(v) ? v : (v == null ? [] : [v])).map(norm).filter(Boolean);

/* Базы семейств, у которых имя без подсерии покрывает все «<база> …». Пока одна — Eikon. */
const FAMILY_BASES = new Set(["eikon"]);

/* Совпадают ли ДВЕ конкретные нормализованные коллекции. */
function matchOne(a, b) {
  if (a === b) return true;                                   // точное совпадение (в т.ч. подсерия↔та же подсерия)
  if (FAMILY_BASES.has(a) && b.startsWith(a + " ")) return true;   // a — база семейства, b — его подсерия
  if (FAMILY_BASES.has(b) && a.startsWith(b + " ")) return true;   // b — база семейства, a — его подсерия
  return false;
}

/* Совместимы ли коллекции двух сторон. Каждая сторона — массив строк ИЛИ строка ИЛИ пусто.
   Пустая сторона = «коллекция не указана» → подходит всем (решение владельца). */
function seriesCompatible(a, b) {
  const left = toList(a);
  const right = toList(b);
  if (!left.length || !right.length) return true;            // нет коллекции хотя бы у одной стороны → универсально
  return left.some((x) => right.some((y) => matchOne(x, y)));
}

const api = { seriesCompatible, matchOne, FAMILY_BASES };
if (typeof window !== "undefined") window.EPSeriesMatch = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
