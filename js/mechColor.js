/* Цвет механизмов (К12 ч.3) — ЧИСТАЯ доменная логика над начинкой поста. Модуль без state, DOM и
   каталога: товары и каталожные функции приходят аргументами, как в framePicker.js/roomVariants.js
   (PLAN 7.1). Здесь — ОДНО место правил «цвета механизмов» (§7.1): какие цвета предлагать для серии,
   показывать ли шаг, какой цвет подставить сам, как сузить начинку по цвету и как подписать галочку.
   И окно подбора накладки, и селектор-список комнаты, и окно поста спрашивают ИМЕННО эти функции —
   второй копии правила нет.

   --- ЧЕМ ОТЛИЧАЕТСЯ ОТ ОТДЕЛКИ НАКЛАДКИ -------------------------------------------------------------
   Шаги накладки (standard/collection/frameMaterial/frameShape/frameColor, framePicker.js) идут по
   НАКЛАДКАМ; цвет механизмов — по МЕХАНИЗМАМ, совместимым с серией комнаты. Поэтому отдельный модуль,
   а не шестой шаг framePicker: у него ИНАЯ семантика членства (слова заказчика 15.10: «механизм — то,
   что внутри… они ещё разного цвета бывают… чтобы он только нужный цвет»).

   --- СОВМЕСТИМОСТЬ С СЕРИЕЙ — ТО ЖЕ правило, что у КОНСТРУКТОРА ПОСТА (§7.1) ----------------------
   Какие цвета предлагать для серии считаем ЧЕРЕЗ deps.match(mechanisms, {collection}) — вызывающий
   подставляет сюда EPCatalog.compatibleMechanisms (семейный префикс EPSeriesMatch), ТОТ ЖЕ отбор
   начинки по накладке, что показывает окно поста. Это ВАЖНО: серия КОМНАТЫ — это подсерия накладки
   («Eikon Evo», «Eikon Exe», «Eikon Flat» …), а цветные механизмы в каталоге лежат под БАЗОЙ семейства
   («Eikon»); точное членство (productsForRoom.collection) дало бы для Evo/Exe пусто — шаг не появлялся
   бы (дефект, найден в браузере 31.10). Семейное правило: Evo/Exe/Tactil/Tondo получают цвета базовой
   линии Eikon (Белый/Чёрный/Серебристый + редкий Металлик) и НЕ подмешивают декоративные цвета других
   подсерий Vintage/Flat (их механизмы лежат под «Eikon Vintage»/«Eikon Flat», а подсерия с подсерией
   по семейному правилу не совместима). Flat/Vintage к базовой линии добавляют свои декоративные —
   ровно столько, сколько окно поста реально предлагает к их накладке (иначе поле и фильтр разошлись
   бы, §7.1). Второго правила совместимости не заводим. */
(() => {
"use strict";

/* ЕДИНОЕ правило «цвет механизма для окна поста» (§7.1): ПРИОРИТЕТ столбец > название > артикул.
   Заполнен собственный цвет из столбца номенклатуры (item.elementColor, раздел colors — его же читают
   автозамена сметы и фильтр «в цвет накладки») — берём его. Пусто — берём ВЫВЕДЕННЫЙ ИЗ НАЗВАНИЯ
   (item.nameColor, раздел nameColors, К12 ч.3). Нет и его — ВЫВЕДЕННЫЙ ИЗ АРТИКУЛА (item.articleColor,
   раздел articleColors, раунд 3: 20066 — серый, 20066.B — белый; в столбце и названии цвета нет).
   Ничего из трёх → "" (бесцветный: в окне поста виден всегда, в список значений шага не идёт). Это
   ЕДИНСТВЕННОЕ место выражения elementColor || nameColor || articleColor: и список значений шага, и
   фильтр начинки, и счётчик окна подбора зовут именно его — второй копии нет. Автозамена и смета этой
   функции НЕ зовут: они читают только столбец (решение владельца 31.10 «смета ровно как в HEAD»). */
function colorOf(item) {
  return (item && (item.elementColor || item.nameColor || item.articleColor)) || "";
}

/* Правило видимости шага — ЕДИНОЕ с framePicker (visibleSteps, К12 ч.1): «≥2 значения ИЛИ выбрано
   мёртвое». Берём его ФУНКЦИЕЙ у framePicker, а не копией (§7.1): поменяется правило «когда прятать
   шаг» — поменяется в одном месте. Браузер — window.EPFramePicker (подключён раньше), Node — require. */
const EPFramePicker = (typeof module !== "undefined" && module.exports)
  ? require("./framePicker.js") : (typeof window !== "undefined" ? window.EPFramePicker : undefined);

/* Цвета механизмов, совместимых с серией selection.collection — восходящий список различных, по локали
   ru (как productCollections/productFacingValues). Серия не задана → весь набор механизмов (все цвета
   каталога). deps.match — productsForRoom (тот же фильтр серии, что у накладок); deps.colorOf — цвет
   механизма («» если не указан). Бесцветные в список значений не идут — выбирать «нет цвета» нечему. */
function colorsFor(mechanisms, selection, deps) {
  const sel = selection || {};
  /* Пул — механизмы, совместимые с серией (deps.match = compatibleMechanisms); серия не задана → все. */
  const pool = sel.collection ? deps.match(mechanisms || [], { collection: sel.collection }) : (mechanisms || []).slice();
  const set = new Set();
  pool.forEach(item => { const c = deps.colorOf(item); if (c) set.add(c); });
  return [...set].sort((a, b) => String(a).localeCompare(String(b), "ru-RU"));
}

/* Показывать ли шаг «Цвет механизмов» в текущем отборе. Делегируем правилу framePicker.stepVisible
   (≥2 цвета ИЛИ выбран цвет, которого в наборе нет — край обратной совместимости из старого проекта).
   Linea/Tondo/Tactil цвета механизмов не имеют → 0 значений → шаг скрыт (DoD К12 ч.3). */
function visible(mechanisms, selection, deps) {
  const sel = selection || {};
  const chosen = (typeof sel.mechColor === "string" && sel.mechColor) ? sel.mechColor : null;
  return EPFramePicker.stepVisible(colorsFor(mechanisms, sel, deps), chosen);
}

/* Единственный вынужденный цвет (автозаполнение К12 ч.2 распространяется и на этот шаг): в отборе ровно
   один цвет → он и подставляется; иначе null. Та же семантика, что у framePicker.autoFill для шагов
   накладки, но над механизмами. */
function autoValue(mechanisms, selection, deps) {
  const values = colorsFor(mechanisms, selection, deps);
  return values.length === 1 ? values[0] : null;
}

/* Сужение начинки по цвету механизмов (фильтр окна поста, когда у комнаты задан цвет механизмов).
   ⚠️ БЕСЦВЕТНЫЕ ВИДНЫ ВСЕГДА (решение владельца 31.10): у 702 из 1046 механизмов цвет в каталоге не
   указан (вся Linea/Tondo и пр.) — выкинув их, окно поста для цветной серии осталось бы почти пустым.
   Поэтому пропускаем механизм, если у него цвета НЕТ, ИЛИ его цвет совпадает с выбранным. Совпадение —
   через deps.keyOf (EPCatalog.facingColorKey): цвет накладки и цвет механизма различаются родом/числом
   («Белый»/«Белые матовые»), ключ сводит их к одной основе. Это ОТЛИЧИЕ от штатного фильтра «в цвет
   накладки» (productsForRoom.elementColor), который бесцветные СКРЫВАЕТ, — его семантику не трогаем,
   она остаётся для случая «цвет механизмов не задан». */
function filter(mechanisms, color, deps) {
  if (!color) return (mechanisms || []).slice();
  const key = deps.keyOf(color);
  return (mechanisms || []).filter(item => {
    const c = deps.colorOf(item);
    return !c || deps.keyOf(c) === key;
  });
}

/* Подпись галочки поста, когда у комнаты задан цвет механизмов (решение владельца 31.10 «подпись с
   цветом»). Прежняя подпись («…в цвет накладки») остаётся у вызывающего для случая «цвет не задан». */
function checkboxLabel(color) {
  return "Только механизмы цвета «" + color + "»";
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports для автотестов. */
const api = { colorOf, colorsFor, visible, autoValue, filter, checkboxLabel };
if (typeof window !== "undefined") window.EPMechColor = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
