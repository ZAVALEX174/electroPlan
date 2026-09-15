/* Шаговый выбор отделки накладки (E14, вид «С картинками») — ЧИСТАЯ логика поверх уже готового
   отбора. Модуль без state, DOM и каталога: всё приходит аргументами, как в room.js/catalog.js
   (PLAN 7.1) — тогда шаги и счётчики забирают автотесты, а браузерная обёртка в app.js только
   рисует плитки.

   ★ ВТОРОЙ ВИД, А НЕ ВТОРОЕ ПРАВИЛО (§7.1). Мастер НЕ держит своей копии фильтра, своего списка
   значений и своего счётчика: и «сколько накладок за вариантом», и перечисление значений признака
   идут через ТЕ ЖЕ функции каталога, что уже фильтруют конструктор поста, — они приходят в deps:
     match(frames, criteria)  — EPCatalog.productsForRoom, ТОТ ЖЕ отбор, что у collectionFramePool и
                                у хинта конструктора (frameFacingHintText). Счётчик «за вариантом» —
                                это его .length, второго счётчика нет.
     valuesOf(pool, prop)     — перечисление значений признака В ПУЛЕ (EPCatalog.productCollections
                                для серии / productFacingValues для материала-формы-цвета). Список
                                значений мастер не хранит — берёт из каталога, суженного выбором.
     imageOf(item)            — URL фото товара (EPCatalog.productImage); «» когда фото нет.

   Порядок шагов — серия → материал → форма → цвет. prop каждого шага — ТО ЖЕ имя поля комнаты, что
   пишет вид-список (collection/frameMaterial/frameShape/frameColor): оба вида читают и пишут ОДНИ
   настройки комнаты, поэтому «что выбрано в одном виде, видно в другом» — по построению. */
(() => {
"use strict";

const STEPS = [
  { prop: "collection",    title: "Серия",    label: "серия" },
  { prop: "frameMaterial", title: "Материал", label: "материал" },
  { prop: "frameShape",    title: "Форма",    label: "форма" },
  { prop: "frameColor",    title: "Цвет",     label: "цвет" }
];

/* Варианты одного шага: значения признака prop, каждый со счётчиком накладок за ним и картинкой
   товара-представителя. Считаем от ПУЛА, суженного ДРУГИМИ уже выбранными признаками (selection без
   prop): текущий признак как раз выбирают, поэтому он пул не сужает — иначе, вернувшись на шаг,
   человек видел бы счётчики только под текущее значение и не смог бы сравнить альтернативы.
   Значения берём из valuesOf(pool) — по построению это ровно те, что в пуле реально есть, поэтому у
   каждого варианта count > 0, а пустой список означает пустой пул (пустое сочетание — его объясняет
   словами вызывающий, конвенция E14). Картинку берём у ПЕРВОГО товара варианта, у которого фото
   есть: у ~40% накладок фото нет, но у варианта достаточно одного изделия с фото. */
function stepOptions(frames, selection, prop, deps) {
  const base = Object.assign({}, selection || {});
  delete base[prop];
  const pool = deps.match(frames, base);
  return deps.valuesOf(pool, prop).map(value => {
    const subset = deps.match(pool, { [prop]: value });
    const withImage = subset.find(item => deps.imageOf(item));
    return { value, count: subset.length, imageUrl: withImage ? deps.imageOf(withImage) : "" };
  });
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { STEPS, stepOptions };
if (typeof window !== "undefined") window.EPFramePicker = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
