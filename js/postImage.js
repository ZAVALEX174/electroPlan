/* Единое изображение собранного поста (PLAN — задача «немецкий стандарт в конструкторе»).
   ОДНА функция строит картинку собранного поста и применяется во ВСЕХ местах: крупно в
   конструкторе, миниатюрой в библиотеке «Готовые посты», в подсказке при наведении на
   плане, в раскладке постов КП и в листе монтажника.

   ОСНОВА ИЗОБРАЖЕНИЯ — ФОТОГРАФИЯ НАКЛАДКИ (как было в конструкторе): фото-подложка, а
   модули лежат ПОВЕРХ, в границах её окна. Геометрию окна (left/top/width/height/aspect в
   процентах) даёт EPCatalog.frameOpening — она для этого и написана. Разбиение на посты
   сохраняется: немецкая накладка (2+2) это ОДНО изделие с импостом посередине, поэтому
   внутри её окна модули сгруппированы по постам с видимым разделителем-импостом между
   группами (а не две отдельные рамки рядом). Нет фото накладки — рисуем аккуратную
   схему-контур (запасной вариант), но и она показывает разбиение на посты.

   КЛЮЧЕВОЕ: КП и лист монтажника уходят в ПЕЧАТЬ (отдельное окно без стилей приложения).
   Поэтому вся геометрия и цвета заданы ИНЛАЙН-СТИЛЯМИ прямо в разметке — один и тот же HTML
   одинаково рисуется и в приложении (innerHTML), и в окне печати (document.write). Иконка
   механизма лежит ПОД его фото (не через onerror-JS, которого в печати нет): нет фото —
   сквозь него видно иконку-силуэт. Заглушки no_photo сюда не доходят: их отсекает
   EPCatalog.productImage (imageUrl приходит пустым, рисуется фолбэк).

   Модуль чистый (как offerPdf.js/installSheet.js): на вход готовые данные (spec) и esc,
   на выход строка HTML. Ни state, ни DOM, ни доступ к каталогу.

   spec = {
     size: "lg" | "md" | "sm",              // конструктор / документ / миниатюра
     frame?: { name, code, imageUrl,        // imageUrl — фото накладки (пусто → схема)
       opening: { left, top, width, height, aspect } },   // окно накладки в % (frameOpening)
     rows: [ { posts: [ {                    // физические ряды накладки (двухрядная «4+4» → 2)
       capacity,                             // ёмкость поста в модулях
       cells: [ { span, imageUrl?, icon?, name?, empty? } ]   // модули поста слева направо
     } ] } ]
   }
   deps = { esc(s) }.
   Интерфейс приложению — window.EPPostImage.buildHtml(spec, deps). */
(() => {
"use strict";

/* Размеры под место применения: base+per задают ширину сцены (px) от числа модулей,
   impost — толщина перемычки между постами, iconF — кегль иконки-силуэта. */
const SIZES = {
  lg: { base: 120, per: 46, impost: 3, iconF: 22, cap: 12, caption: true, pad: 7, radius: 14, border: 4 },
  md: { base: 78, per: 26, impost: 2, iconF: 13, cap: 10, caption: false, pad: 4, radius: 10, border: 3 },
  sm: { base: 46, per: 16, impost: 1.5, iconF: 9, cap: 8, caption: false, pad: 3, radius: 7, border: 2 }
};
const IMPOST = "#334a63";                 // импост — перемычка накладки между постами
const CELL_LINE = "rgba(28,52,72,.14)";   // тонкая грань между модулями внутри одного поста

function buildHtml(spec, deps) {
  const esc = (deps && deps.esc) || (s => String(s == null ? "" : s));
  const s = SIZES[spec && spec.size] || SIZES.md;
  const rows = (spec && spec.rows) || [];
  const frame = (spec && spec.frame) || {};
  const opening = frame.opening || { left: 12, top: 20, width: 76, height: 56, aspect: 1.4 };

  /* Ширина сцены — от самого широкого ряда (в модулях); высота — из аспекта окна накладки,
     чтобы фото и координаты окна совпадали (как в прежнем .preview-frame-stage). */
  const modulesWide = rows.reduce((m, r) => Math.max(m, (r.posts || []).reduce((a, p) => a + (Number(p.capacity) || 0), 0)), 0) || 1;
  const W = Math.round(s.base + modulesWide * s.per);
  const aspect = Number(opening.aspect) > 0 ? Number(opening.aspect) : 1.4;
  const H = Math.round(W / aspect);

  /* Один модуль поста: фото механизма поверх иконки-силуэта, либо пустой модуль (сквозь
     него видно накладку — окно свободно). Ширина — пропорционально числу модулей (span). */
  const cell = (c, last) => {
    const grow = Math.max(1, Number(c.span) || 1);
    const edge = last ? "" : `border-right:1px solid ${CELL_LINE};`;
    if (c.empty) return `<div style="flex:${grow} 1 0;min-width:0;${edge}"></div>`;
    const label = esc(c.name || "");
    const img = c.imageUrl
      ? `<img src="${esc(c.imageUrl)}" alt="${label}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center">`
      : "";
    return `<div title="${label}" style="position:relative;flex:${grow} 1 0;min-width:0;overflow:hidden;background:#fff;${edge}">`
      + `<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:Arial,sans-serif;font-weight:700;font-size:${s.iconF}px;color:#6a86a3">${esc(c.icon || "?")}</span>`
      + `${img}</div>`;
  };
  /* Пост — группа модулей вплотную; ширина пропорциональна его ёмкости. */
  const post = p => {
    const cells = p.cells || [];
    return `<div style="display:flex;flex:${Math.max(1, Number(p.capacity) || 1)} 1 0;min-width:0;align-items:stretch">${cells.map((c, i) => cell(c, i === cells.length - 1)).join("")}</div>`;
  };
  /* Импост — видимый разделитель между постами (и между рядами у двухрядных). Одна и та же
     перемычка: во flex-строке даёт вертикальную полосу, во flex-колонке — горизонтальную. */
  const impost = `<div style="flex:0 0 ${s.impost}px;align-self:stretch;background:${IMPOST};border-radius:1px"></div>`;
  const row = r => `<div style="display:flex;flex:1 1 0;min-height:0;align-items:stretch">${(r.posts || []).map(post).join(impost)}</div>`;
  const openingInner = rows.length
    ? `<div style="display:flex;flex-direction:column;width:100%;height:100%;box-sizing:border-box">${rows.map(row).join(impost)}</div>`
    : "";

  let stage;
  if (frame.imageUrl) {
    /* РЕЖИМ ФОТО: подложка — фотография накладки, модули поверх в границах её окна. */
    stage = `<div style="position:relative;width:${W}px;height:${H}px">`
      + `<img src="${esc(frame.imageUrl)}" alt="${esc(frame.name || "Накладка")}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain">`
      + `<div style="position:absolute;left:${opening.left}%;top:${opening.top}%;width:${opening.width}%;height:${opening.height}%;box-sizing:border-box">${openingInner}</div>`
      + `</div>`;
  } else {
    /* ЗАПАСНОЙ РЕЖИМ: контур накладки (фото нет), разбиение на посты сохранено. */
    stage = `<div style="position:relative;width:${W}px;height:${H}px;box-sizing:border-box;border:${s.border}px solid #244d72;border-radius:${s.radius}px;background:#f8fcff;padding:${s.pad}px">`
      + `<div style="width:100%;height:100%">${openingInner || `<div style="width:100%;height:100%"></div>`}</div>`
      + `</div>`;
  }

  const caption = s.caption && (frame.name || frame.code)
    ? `<div style="margin-top:7px;font-family:Arial,sans-serif;font-size:${s.cap}px;color:#48607a;text-align:center;max-width:${W}px">${frame.code ? `[${esc(frame.code)}] ` : ""}${esc(frame.name || "")}</div>`
    : "";

  return `<span class="assembled-post" style="display:inline-flex;flex-direction:column;align-items:center">${stage}${caption}</span>`;
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { buildHtml };
if (typeof window !== "undefined") window.EPPostImage = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
