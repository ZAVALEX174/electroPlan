/* Единое изображение собранного поста (PLAN — задача «немецкий стандарт в конструкторе»).
   ОДНА функция строит картинку собранного поста и применяется во ВСЕХ местах: крупно в
   конструкторе, миниатюрой в библиотеке «Готовые посты», в подсказке при наведении на
   плане, в раскладке постов КП и в листе монтажника. Иначе разделение на посты и импосты
   (немецкий стандарт, двухрядные «4+4») пришлось бы рисовать в пяти местах заново.

   КЛЮЧЕВОЕ: КП и лист монтажника уходят в ПЕЧАТЬ — документ открывается в отдельном окне
   со своими стилями. Поэтому картинка собирается БЕЗ единого класса из css/styles.css: вся
   геометрия и цвета заданы ИНЛАЙН-СТИЛЯМИ прямо в разметке. Один и тот же HTML одинаково
   рисуется и в приложении (innerHTML), и в окне печати (document.write) — экранный CSS ему
   не нужен. Иконка-фолбэк лежит ПОД картинкой (не через onerror-JS, которого в печати нет):
   если <img> не загрузился, сквозь него видно иконку.

   Модуль чистый (как offerPdf.js/installSheet.js): на вход готовые данные (spec) и esc,
   на выход строка HTML. Ни state, ни DOM, ни доступ к каталогу.

   spec = {
     size: "lg" | "md" | "sm",              // конструктор / карточка / миниатюра
     frame?: { name, code, color },         // подпись (только в размере lg)
     rows: [ { posts: [ {                    // физические ряды накладки (двухрядная «4+4» → 2)
       capacity,                             // ёмкость поста в модулях
       cells: [ { span, imageUrl?, icon?, name?, empty? } ]   // модули поста слева направо
     } ] } ]
   }
   deps = { esc(s) }.
   Интерфейс приложению — window.EPPostImage.buildHtml(spec, deps). */
(() => {
"use strict";

/* Размеры под место применения: unit — ширина одного модуля (px), h — высота ячейки,
   gap — зазор между постами (= импост), rowGap — между рядами, остальное — оформление. */
const SIZES = {
  lg: { unit: 46, h: 62, gap: 12, rowGap: 12, pad: 8, radius: 12, border: 2, cap: 12, caption: true },
  md: { unit: 28, h: 36, gap: 8, rowGap: 8, pad: 5, radius: 9, border: 1.5, cap: 10, caption: false },
  sm: { unit: 18, h: 24, gap: 5, rowGap: 5, pad: 3, radius: 6, border: 1, cap: 9, caption: false }
};

function buildHtml(spec, deps) {
  const esc = (deps && deps.esc) || (s => String(s == null ? "" : s));
  const s = SIZES[spec && spec.size] || SIZES.md;
  const rows = (spec && spec.rows) || [];

  /* Один модуль поста: механизм (картинка поверх иконки-фолбэка) или пустой модуль. */
  const cell = c => {
    const w = Math.max(1, Number(c.span) || 1) * s.unit;
    if (c.empty) {
      return `<span style="display:inline-block;width:${w}px;height:${s.h}px;box-sizing:border-box;border:1px dashed #c3d6e8;border-radius:4px;background:#f4f9ff"></span>`;
    }
    const label = esc(c.name || "");
    const iconSize = Math.round(s.h * 0.42);
    const img = c.imageUrl
      ? `<img src="${esc(c.imageUrl)}" alt="${label}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#fff">`
      : "";
    return `<span title="${label}" style="position:relative;display:inline-block;width:${w}px;height:${s.h}px;box-sizing:border-box;border:1px solid #dbe7f2;border-radius:4px;background:#fff;overflow:hidden;vertical-align:top">`
      + `<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:Arial,sans-serif;font-weight:700;font-size:${iconSize}px;color:#6a86a3">${esc(c.icon || "?")}</span>`
      + `${img}</span>`;
  };

  /* Пост — сегмент накладки со своей рамкой; модули внутри вплотную (импостов внутри нет). */
  const post = p => `<span style="display:inline-flex;gap:0;padding:${s.pad}px;box-sizing:border-box;border:${s.border}px solid #b9cfe4;border-radius:${s.radius}px;background:#eef5fc">${(p.cells || []).map(cell).join("")}</span>`;

  /* Ряд: посты в строку с зазором — этот зазор и есть ИМПОСТ между постами. Между рядами —
     вертикальный зазор (импост по горизонтали у двухрядных). Общий фон-подложка делает
     импосты видимой «перемычкой» накладки, а не пустотой. */
  const row = r => `<div style="display:flex;gap:${s.gap}px;align-items:center;justify-content:center">${(r.posts || []).map(post).join("")}</div>`;
  const body = rows.length
    ? rows.map(row).join(`<div style="height:${s.rowGap}px"></div>`)
    : `<div style="font-family:Arial,sans-serif;font-size:${s.cap}px;color:#8aa0b6;padding:6px">пост пуст</div>`;

  const frame = (spec && spec.frame) || {};
  const caption = s.caption && (frame.name || frame.code)
    ? `<div style="margin-top:6px;font-family:Arial,sans-serif;font-size:${s.cap}px;color:#48607a;text-align:center;max-width:${s.unit * 8}px">${frame.code ? `[${esc(frame.code)}] ` : ""}${esc(frame.name || "")}</div>`
    : "";

  return `<span class="assembled-post" style="display:inline-flex;flex-direction:column;align-items:center;gap:${s.rowGap}px;padding:${s.pad + 3}px;border-radius:${s.radius + 2}px;background:#dfeaf5;box-sizing:border-box">${body}${caption}</span>`;
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { buildHtml };
if (typeof window !== "undefined") window.EPPostImage = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
