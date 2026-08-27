/* Разделы выбора товара для полноэкранного конструктора поста (E17).

   ЗАЧЕМ. Заказчик на встрече 24.08: «разделы могут быть изначально не раскрыты — ты сначала
   раздел выбрал, он у тебя раскрылся, потом в разделе нашёл элемент, чтобы не крутить много».
   То есть список механизмов режется на разделы, свёрнутые по умолчанию, и человек открывает
   один. Разделы берём из данных заказчика — колонка номенклатуры «Функциональная группа»
   (item.functionalGroup, приезжает через attrs.groups → js/data.js), а НЕ из categoryId:
   его ставит эвристика classify() по названию, и её разделы расходятся с теми, которыми
   думает заказчик («управление светом» размазано по пяти категориям, «Информационные
   разъемы» и «Зарядные устройства» слиты в одну).

   Модуль ЧИСТЫЙ, как installSheet.js/planLabels.js: ни DOM, ни state, ни каталога. Товары
   приходят массивом, чтение полей — через deps (groupOf/spanOf/textOf), на выход — готовые
   разделы. Так раскладку по разделам и оба фильтра (поиск, свободное место) проверяет
   автотест, не поднимая приложение.

   Интерфейс приложению — window.EPCatalogSections.build(items, opts). */
(() => {
"use strict";

/* Порядок разделов — как о них думает заказчик, а не по алфавиту: свет первым (ради него
   конструктор и открывают), дальше розетки и слаботочка, служебное в конце. Ключи в нижнем
   регистре: в номенклатуре одна и та же группа записана и «отели», и «Отели». Раздела, которого
   здесь нет, порядок не теряет — он просто уходит в хвост по алфавиту (см. rank). */
const DEFAULT_ORDER = [
  "управление светом",
  "розетки",
  "информационные разъемы",
  "зарядные устройства",
  "управление климатом и жалюзи",
  "заглушки и выводы кабеля",
  "подсветка клавиш",
  "отели",
  "механизмы"
];

/* Раздел «нет группы»: у механизма колонка не заполнена. Отдельная подпись честнее, чем
   молча приписать его к соседнему разделу. */
const NO_GROUP_LABEL = "Без раздела";

const text = v => (v === null || v === undefined) ? "" : String(v);
/* Ключ раздела — то, ПО ЧЕМУ товары схлопываются в один раздел: приводим пробелы и регистр.
   «отели» (8 позиций) и «Отели» (1) — это один раздел заказчика, а не два по одной позиции. */
const keyOf = label => text(label).replace(/\s+/g, " ").trim().toLocaleLowerCase("ru-RU");
/* Подпись раздела — то, ЧТО печатается: написание человека сохраняем, но первую букву
   поднимаем в верхний регистр. В номенклатуре половина групп записана со строчной
   («управление светом»), и в заголовке раздела это читается как опечатка. */
function labelOf(raw) {
  const s = text(raw).replace(/\s+/g, " ").trim();
  return s ? s.charAt(0).toLocaleUpperCase("ru-RU") + s.slice(1) : "";
}

/* Сравнение артикулов — то же правило, что в своде поставщика (supplierSpec.js): numeric,
   чтобы «10…» не вставало между «1…» и «2…». Одинаковые артикулы разводим по имени, а
   полностью одинаковые строки — по позиции во входном списке (строгий полный порядок:
   иначе порядок карточек зависел бы от реализации сортировки). */
const cmpItem = (a, b) => {
  const byCode = text(a.code).localeCompare(text(b.code), "ru", { numeric: true, sensitivity: "base" });
  if (byCode) return byCode;
  const byName = text(a.name).localeCompare(text(b.name), "ru");
  return byName || (a.seq - b.seq);
};

/* build(items, opts) → { sections, total, shown, hiddenBySpan, hiddenByQuery }

   opts = {
     groupOf(item) → строка        // раздел товара (по умолчанию item.functionalGroup)
     spanOf(item)  → число         // ширина в модулях (по умолчанию 1)
     textOf(item)  → строка        // по чему ищет поиск (по умолчанию «артикул имя»)
     asideOf(item) → строка|null   // раздел-исключение: всегда идёт ПОСЛЕДНИМ, что бы ни
                                   //   стояло в order (голые механизмы — их подставляет
                                   //   расчёт групп света, вручную нужны редко)
     maxSpan                       // фильтр по свободному месту в накладке
     query                         // строка поиска
     order                         // порядок разделов (ключи в нижнем регистре)
   }

   sections[] = { key, label, items, hiddenBySpan, aside }

   ⚠️ РАЗДЕЛ, ИЗ КОТОРОГО ВСЁ ВЫРЕЗАЛ ФИЛЬТР ПО МЕСТУ, ОСТАЁТСЯ В ВЫДАЧЕ (с items:[] и
   hiddenBySpan>0). Это не мусор: пользователю нужно видеть, что раздел есть, но его товары
   шире свободного места, — иначе исчезнувший на глазах раздел читается как сбой каталога.
   Раздел, которого не нашёл ПОИСК, наоборот, исчезает целиком: там нечего объяснять. */
function build(items, opts) {
  const o = opts || {};
  const groupOf = o.groupOf || (item => item && item.functionalGroup);
  const spanOf = o.spanOf || (() => 1);
  const textOf = o.textOf || (item => `${(item && item.code) || ""} ${(item && item.name) || ""}`);
  const asideOf = o.asideOf || (() => null);
  const maxSpan = Number.isFinite(o.maxSpan) ? o.maxSpan : Infinity;
  const order = Array.isArray(o.order) ? o.order : DEFAULT_ORDER;
  const query = text(o.query).replace(/\s+/g, " ").trim().toLocaleLowerCase("ru-RU");

  const list = Array.isArray(items) ? items : [];
  const byKey = new Map();
  let shown = 0, hiddenBySpan = 0, hiddenByQuery = 0;

  list.forEach((item, seq) => {
    if (query && !textOf(item).toLocaleLowerCase("ru-RU").includes(query)) { hiddenByQuery++; return; }
    const aside = asideOf(item);
    const raw = aside != null && aside !== "" ? aside : groupOf(item);
    const label = labelOf(raw) || NO_GROUP_LABEL;
    const key = keyOf(label);
    let section = byKey.get(key);
    if (!section) { section = { key, label, items: [], hiddenBySpan: 0, aside: !!aside, seq }; byKey.set(key, section); }
    /* Фильтр по свободному месту — ТОТ ЖЕ, что раньше резал опции <select> (mechanismOptions
       maxSpan): двухмодульный механизм не предлагается, когда свободен один модуль. Считаем
       отсев по разделу, чтобы интерфейс мог честно сказать, почему раздел пуст. */
    const span = Number(spanOf(item)) || 0;
    if (span > maxSpan) { section.hiddenBySpan++; hiddenBySpan++; return; }
    section.items.push({ item, seq, code: text(item && item.code), name: text(item && item.name) });
    shown++;
  });

  const rank = key => {
    const i = order.indexOf(key);
    return i < 0 ? order.length : i;
  };
  const sections = [...byKey.values()];
  sections.forEach(s => { s.items = s.items.sort(cmpItem).map(x => x.item); });
  sections.sort((a, b) => {
    /* Раздел-исключение всегда последний — независимо от того, где он стоит в order. */
    if (a.aside !== b.aside) return a.aside ? 1 : -1;
    const ra = rank(a.key), rb = rank(b.key);
    if (ra !== rb) return ra - rb;
    const byLabel = a.label.localeCompare(b.label, "ru");
    return byLabel || (a.seq - b.seq);
  });
  sections.forEach(s => { delete s.seq; });

  return { sections, total: list.length, shown, hiddenBySpan, hiddenByQuery };
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { build, DEFAULT_ORDER, NO_GROUP_LABEL };
if (typeof window !== "undefined") window.EPCatalogSections = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
