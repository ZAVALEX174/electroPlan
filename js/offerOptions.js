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
    ["article", "Артикул накладки", false], ["illustration", "Иллюстрация", true]
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
function preset(name) {
  if (name === "client") return normalize({ articles: false, sections: { supplier: false } });
  if (name === "boxes") return normalize({
    articles: false, prices: false,
    sections: { specification: false, lighting: false, supplier: false },
    layout: { number: true, fill: false, modules: false, box: true, article: false, illustration: false }
  });
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
const api = { fields, groupLabels, normalize, preset, itemText };
if (typeof window !== "undefined") window.EPOfferOptions = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
