/* D10, часть КП. Только представление документа: эти флаги не участвуют в смете,
   подборе или сохранённом составе постов. Схема одна для UI, нормализации и печати. */
(() => {
"use strict";
const fields = {
  sections: [
    ["plan", "План с номерами постов", true],
    ["layout", "Раскладка постов", true],
    ["specification", "Спецификация и комплектация", true],
    ["lighting", "Группы света", true],
    ["supplier", "Сводная спецификация", true]
  ],
  layout: [
    ["number", "№ поста", true], ["fill", "Наполнение", true],
    ["modules", "Модульность", true], ["box", "Монтажная коробка", false],
    ["article", "Артикул накладки", false], ["illustration", "Иллюстрация", true],
    /* Столбец стоимости одного поста — «стоимость блока» из набора «Для клиента». По умолчанию
       выключен: в полном КП цену несут спецификация и итоги, дублировать её в раскладке незачем.
       Печать гейтится ценами (options.prices), как цена/сумма спецификации. */
    ["price", "Стоимость блока", false],
    /* Столбец «стоимость артикулов» — разбивка цены поста по изделиям (механизмы с заменой цельных,
       механизмы групп света, подсветка, суппорт, коробка, накладка), у каждого своя цена; сумма
       равна «стоимости блока». Заказчик (письмо 26.08, §6): в согласованном списке столбцов рядом
       со «стоимостью блока» стоит «стоимость артикулов» — человеку нужна цена КАЖДОГО изделия поста.
       По умолчанию ВЫКЛЮЧЕН (новый столбец не меняет привычный КП). Как и «стоимость блока», печать
       гейтится ценами (options.prices): в документе без цен денежного столбца быть не может. */
    ["itemPrices", "Стоимость артикулов", false]
  ],
  specification: [
    ["number", "№", true], ["composition", "Состав", true],
    ["article", "Артикулы состава", false], ["quantity", "Кол.", true],
    ["unit", "Ед.", true], ["price", "Цена", true], ["sum", "Сумма", true]
  ]
};
/* Подписи ГРУПП схемы — рядом с самими группами, а не в app.js: печать чекбоксов
   (renderOfferOptions) берёт их отсюда и не держит вторую копию. Новая группа без подписи
   покажет свой ключ, а не «undefined»: схема остаётся единым источником и для легенд. */
const groupLabels = { sections: "Разделы", layout: "Столбцы раскладки постов", specification: "Столбцы спецификации" };
function normalize(value) {
  const v = value && typeof value === "object" ? value : {};
  const bool = (x, fallback) => typeof x === "boolean" ? x : fallback;
  const out = { articles: bool(v.articles, true), prices: bool(v.prices, true) };
  Object.entries(fields).forEach(([group, rows]) => {
    out[group] = Object.fromEntries(rows.map(([key, , fallback]) => [key, bool(v[group]?.[key], fallback)]));
  });
  return out;
}
/* Вид поста в листе монтажника (Б2, слова заказчика «общая сборка» / «взрыв-схема»): "assembled" —
   собранная накладка с клавишами; "exploded" (умолчание) — разложенная по деталям схема, как было.
   Это ОТДЕЛЬНАЯ НАСТРОЙКА ПРОЕКТА, а НЕ часть набора столбцов КП: поэтому она НЕ ходит через
   normalize/preset/sameOptions/custom-наборы. Иначе любой готовый или свой набор столбцов молча
   перезаписывал бы вид (наборы сравнивают и переписывают offerOptions целиком), а подсветка активного
   набора гасла бы из-за несовпадения вида. Единственная точка канонизации значения: чужое/пустое → "exploded",
   поэтому старый снимок проекта и лист без выбора печатаются как раньше. */
function assemblyView(value) {
  return value === "assembled" ? "assembled" : "exploded";
}
/* Готовые наборы столбцов заказчика (EPG, ответы 16.09) — по РОЛЯМ. Состав каждого ровно по словам
   заказчика, в ОДНОЙ точке рядом с полной схемой: правка состава набора не расходится по
   потребителям (§7.1). Набор влияет только на ВИДИМОСТЬ разделов/столбцов КП, не на смету и подбор
   (см. шапку файла). */
function preset(name) {
  if (name === "builder") return normalize({
    /* Строителю — лист раскладки постов для монтажа: номер, наполнение, модульность, монтажная
       коробка, артикул накладки, иллюстрация. Цены и прочие разделы строителю не нужны. */
    prices: false,
    sections: { plan: false, layout: true, specification: false, lighting: false, supplier: false },
    layout: { number: true, fill: true, modules: true, box: true, article: true, illustration: true, price: false }
  });
  if (name === "client") return normalize({
    /* Клиенту — номер, наполнение, иллюстрация и стоимость блока. Без артикулов и модульности,
       без спецификации и свода: клиенту важны состав постов словами и цена, а не монтаж. */
    articles: false,
    sections: { plan: false, layout: true, specification: false, lighting: false, supplier: false },
    layout: { number: true, fill: true, modules: false, box: false, article: false, illustration: true, price: true }
  });
  if (name === "boxes") return normalize({
    articles: false, prices: false,
    sections: { specification: false, lighting: false, supplier: false },
    layout: { number: true, fill: false, modules: false, box: true, article: false, illustration: false, price: false }
  });
  if (name === "designer") {
    /* «Для дизайнера — весь список» (заказчик, письмо 26.08 §6): ВСЕ разделы и ВСЕ столбцы каждой
       таблицы, обе цены (стоимость блока и стоимость артикулов) и артикулы. Собираем «всё включено»
       ИЗ САМОЙ СХЕМЫ (fields), а не перечислением ключей: новый столбец заводится ВЫКЛЮЧЕННЫМ, и
       «весь список» обязан включить его САМ, иначе дизайнер недосчитается ровно нового поля — тот
       самый край §7.1. Поэтому designer уже НЕ равен «Полному КП» (умолчаниям normalize()), где
       коробка/артикул/цены выключены: у дизайнера включено всё. */
    const all = { articles: true, prices: true };
    Object.entries(fields).forEach(([group, rows]) => {
      all[group] = Object.fromEntries(rows.map(([key]) => [key, true]));
    });
    return normalize(all);
  }
  /* Умолчания схемы — «Полное КП» со всеми разделами, но раскладка без коробки/артикула/цен (их
     включают наборы под роль). То же отдаёт preset() для неизвестного имени и preset("full"). */
  return normalize();
}
/* Только подписи каталога, не произвольный HTML и не имена проекта/комнат.
   У пробела каталога ID зашит в служебное имя. У товара собственный артикул иногда
   повторён в имени — убираем точное отдельное вхождение, но не кусок другого числа.
   Артикулы на исходном чертеже/фотографиях и вручную введённый текст не редактируем. */
function itemText(value, articles, code) {
  let text = String(value ?? "");
  if (articles !== false) return text;
  text = text.replace(/\s*\(арт\.\s*[^)]+\)/g, "");
  if (code) {
    const escaped = String(code).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    /* Артикул в имени бывает вариантом кода товара: собственный code — «19208.C», а в
       названии стоит цветовой вариант «19208.C.01». Точечный хвост (?:\.[\p{L}\p{N}]+)*
       снимаем ВМЕСТЕ с кодом — это тот же артикул, а не другое число: граница перед кодом
       по-прежнему обязательна, поэтому «20001» не режет «200011». */
    const stripped = text.replace(new RegExp("(^|[^\\p{L}\\p{N}_.-])" + escaped + "(?:\\.[\\p{L}\\p{N}]+)*(?=$|[^\\p{L}\\p{N}_.-])", "gu"), "$1")
      .replace(/\[\s*\]/g, "").trim();
    /* Имя, целиком равное артикулу, — единственная подпись товара: пустую строку вместо неё
       не отдаём, оставляем имя как есть. */
    if (stripped) text = stripped;
  }
  return text.trim();
}
/* --- Свои наборы столбцов пользователя: РОВНО CUSTOM_SLOTS слотов ---
   Это ПРИВЫЧКА ЧЕЛОВЕКА (как вид отделки), а не свойство проекта: в приложении они живут в EPPrefs,
   а не в снимке проекта. Модуль хранит только чистые преобразования; чтение/запись localStorage —
   в оркестраторе. */
const CUSTOM_SLOTS = 3;
/* Привести массив своих наборов из EPPrefs к ровно CUSTOM_SLOTS слотам: слот — либо {name, options}
   с непустым названием и нормализованным составом, либо null (пусто). Данные из localStorage не
   доверенные (чужой/старый ключ, лишние слоты, пустые имена) — лишнее и безымянное отбрасываем:
   без названия набор не выбрать и не отличить в списке. */
function normalizeCustomPresets(value) {
  const arr = Array.isArray(value) ? value : [];
  const out = [];
  for (let i = 0; i < CUSTOM_SLOTS; i++) {
    const slot = arr[i];
    const name = slot && typeof slot === "object" && typeof slot.name === "string" ? slot.name.trim() : "";
    out.push(name ? { name, options: normalize(slot.options) } : null);
  }
  return out;
}
/* Записать текущий состав options в слот index под именем name. Возвращает НОВЫЙ список (вход не
   мутируем — снимок проекта/EPPrefs не должен меняться по ссылке). Пустое/пробельное имя или слот
   вне диапазона — список остаётся прежним (перезаписи не происходит). */
function saveCustomPreset(presets, index, name, options) {
  const list = normalizeCustomPresets(presets);
  const clean = String(name ?? "").trim();
  if (!clean || !(index >= 0 && index < CUSTOM_SLOTS)) return list;
  list[index] = { name: clean, options: normalize(options) };
  return list;
}
/* Совпадают ли два набора по видимости разделов/столбцов — сравнением нормализованного вида (порядок
   ключей в normalize стабилен). Нужен, чтобы подсветить активный набор: человек видит, что выбрано. */
function sameOptions(a, b) {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}
const api = { fields, groupLabels, normalize, preset, itemText, CUSTOM_SLOTS, normalizeCustomPresets, saveCustomPreset, sameOptions, assemblyView };
if (typeof window !== "undefined") window.EPOfferOptions = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
