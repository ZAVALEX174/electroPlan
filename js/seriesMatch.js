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

/* Уровень совпадения ДВУХ конкретных нормализованных коллекций — ЕДИНЫЙ ИСТОЧНИК правила (§7.1):
   и «совместимы ли» (matchOne/seriesCompatible), и «насколько точно» (matchLevel) считаются ИМ,
   иначе у семейного правила EIKON снова будут края.
     • "exact"  — строки равны (в т.ч. подсерия↔та же подсерия);
     • "family" — совпали только через базу семейства («Eikon» ↔ «Eikon Flat»), точного нет;
     • "none"   — не совместимы. */
function levelOne(a, b) {
  if (a === b) return "exact";                                   // точное (в т.ч. подсерия↔та же подсерия)
  if (FAMILY_BASES.has(a) && b.startsWith(a + " ")) return "family";   // a — база семейства, b — его подсерия
  if (FAMILY_BASES.has(b) && a.startsWith(b + " ")) return "family";   // b — база семейства, a — его подсерия
  return "none";
}

/* Совпадают ли ДВЕ конкретные нормализованные коллекции (любой ненулевой уровень). */
function matchOne(a, b) {
  return levelOne(a, b) !== "none";
}

/* Совместимы ли коллекции двух сторон. Каждая сторона — массив строк ИЛИ строка ИЛИ пусто.
   Пустая сторона = «коллекция не указана» → подходит всем (решение владельца). */
function seriesCompatible(a, b) {
  const left = toList(a);
  const right = toList(b);
  if (!left.length || !right.length) return true;            // нет коллекции хотя бы у одной стороны → универсально
  return left.some((x) => right.some((y) => matchOne(x, y)));
}

/* ЛУЧШИЙ уровень совпадения коллекций двух сторон — "exact" | "family" | "none".
   Нужен там, где из НЕСКОЛЬКИХ совместимых кандидатов надо выбрать ОДИН: точное совпадение серии
   главнее семейного (решение владельца 18.10). Пример денежного края: запрос «Eikon» (клавиша
   общего семейства) на роль «переключатель» совместим и с 20005.0 (серия «Eikon» — ТОЧНО), и с
   22104 (серия «Eikon Flat/Tondo» — через базу семейства); без уровня оба кандидата равны и подбор
   становится ложно-неоднозначным, пост теряет механизм (131.62 € вместо 157.41 €).
   Пустая сторона (коллекция не указана) совместима со всем, но НЕ точно — уровень "family": если
   рядом есть кандидат с точным совпадением, он должен выиграть. На реальных данных пустой серии у
   места нет (серия берётся с накладки), ветка здесь для полноты правила. */
function matchLevel(a, b) {
  const left = toList(a);
  const right = toList(b);
  if (!left.length || !right.length) return "family";        // универсально, но не точно
  let family = false;
  for (const x of left) {
    for (const y of right) {
      const lvl = levelOne(x, y);
      if (lvl === "exact") return "exact";
      if (lvl === "family") family = true;
    }
  }
  return family ? "family" : "none";
}

const api = { seriesCompatible, matchOne, matchLevel, FAMILY_BASES };
if (typeof window !== "undefined") window.EPSeriesMatch = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
