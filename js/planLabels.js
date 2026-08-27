/* План с бирками номеров постов для ПЕЧАТНЫХ документов (D9).

   ЗАЧЕМ. В эталонном «Расчёте ЭУИ» заказчика после титула идёт страница с планом, где у
   каждого поста висит бирка с его номером, и только потом таблица «№ / Наполнение /
   Модульность / Иллюстрация». Без этой страницы номер в таблице не с чем сверить: монтажник
   и клиент видят «пост № 7», но не знают, где он на объекте. Блок вставляется и в КП
   (offerPdf), и в лист монтажника всего проекта (installSheet) — один и тот же чертёж с
   одними и теми же номерами.

   ЧИСТЫЙ МОДУЛЬ, как offerPdf.js/installSheet.js/postImage.js: ни DOM, ни state, ни
   window.open. На вход — данные, на выход строка HTML с ИНЛАЙН-стилями (документ уходит в
   печать, внешнего CSS там нет). Поэтому вся геометрия бирок проверяется автотестом, не
   поднимая браузер.

   ГЕОМЕТРИЯ — ГЛАВНОЕ ЗДЕСЬ. Посты живут в МИРОВЫХ координатах холста (post.x/post.y).
   Зум и панораму вида компенсировать НЕ надо: это одна CSS-трансформация #canvas
   (applyView: translate(panX,panY) scale(scale)), в координаты объектов она не входит.
   А вот подложка плана растянута на весь мировой бокс #canvas с object-fit:contain, то есть
   ЛЕТТЕРБОКСИТСЯ внутри него: у картинки свой отображаемый прямоугольник со сдвигом offX/offY.
   Чтобы бирка в документе встала ровно туда же, где она на экране, мировую точку надо
   перевести в долю ЭТОГО прямоугольника — та же математика, что в EPRoomSeg.mapPolygon,
   только в обратную сторону. Отсюда обязательные canvasW/canvasH в spec: без размера мирового
   бокса леттербокс не посчитать.

   ПОСТ ЗА ПРЕДЕЛАМИ ПОДЛОЖКИ — штатный случай (холст бесконечный: при отдалённом виде клик
   попадает в мировые координаты за краем картинки). Такие бирки не обрезаем и не притягиваем
   к краю — РАСШИРЯЕМ кадр документа так, чтобы в него вошли и подложка, и все бирки. Документ
   показывает ровно то же, что экран, а не выдуманное «в углу плана».

   spec = {
     imageUrl,           // подложка (у нас всегда data-URL) — нет её, блока нет
     natW, natH,         // НАТУРАЛЬНЫЕ размеры подложки (img.naturalWidth/naturalHeight)
     canvasW, canvasH,   // размеры мирового бокса #canvas на момент сборки документа
     posts: [ { number, x, y } ],   // x/y — мировая ТОЧКА поста (центр иконки, не левый угол)
     title?, note?,                 // подписи блока
     maxWidthMm?, maxHeightMm?      // полезная площадь листа (по умолчанию A4 с полями)
   }
   deps = { esc(s) }.
   Возвращает строку HTML-секции либо "" (нет подложки / нет постов / размеры не заданы). */
(() => {
"use strict";

/* Полезная площадь листа A4 в мм: 210×297 минус поля документов (16 мм в КП, 14 мм в листе
   монтажника) и минус место под заголовок с подписью. Кадр вписывается в ЭТИ габариты —
   иначе высокий (портретный) чертёж, растянутый на всю ширину страницы, не влезал бы по
   высоте и рвался бы пополам. Конкретный документ может прислать свои цифры. */
const DEF_MAX_W_MM = 176, DEF_MAX_H_MM = 224;
/* Поле вокруг крайних бирок в долях от большей стороны подложки: бирка рисуется кружком
   поверх точки, и без запаса крайняя из них наполовину вылезла бы за кадр. */
const PAD_RATIO = 0.015;
/* Диаметр бирки в пикселях документа. ФИКСИРОВАННЫЙ, а не в процентах кадра: номер должен
   оставаться читаемым и когда чертёж ужат до ширины страницы. */
const BADGE = 22, BADGE_BORDER = 2;

/* Число или NaN. Пустая строка, null и true/false — НЕ числа (Number("") === 0 подсунул бы
   бирку в угол плана вместо честного пропуска). */
const fin = v => (v === null || v === "" || typeof v === "boolean") ? NaN : Number(v);

/* Геометрия блока в долях кадра — отдельно от вёрстки, чтобы проверять её тестом напрямую.
   Возвращает null, когда рисовать нечего (нет подложки, нет размеров, нет постов). */
function layout(spec) {
  const s = spec || {};
  const imageUrl = typeof s.imageUrl === "string" ? s.imageUrl.trim() : "";
  const natW = fin(s.natW), natH = fin(s.natH);
  const cw = fin(s.canvasW), ch = fin(s.canvasH);
  /* SVG-подложка без внутренних размеров даёт naturalWidth 0 — вся арифметика леттербокса
     ушла бы в NaN/Infinity и порвала вёрстку. Молча не печатаем блок. */
  if (!imageUrl || !(natW > 0 && natH > 0 && cw > 0 && ch > 0)) return null;

  /* Пост без номера не роняет документ: на плане он рисуется знаком вопроса (compactIcon),
     здесь — тем же. Пост без координат печатать некуда — пропускаем. */
  const pts = (Array.isArray(s.posts) ? s.posts : [])
    .map(p => {
      const o = p || {};
      const label = (o.number === null || o.number === undefined || String(o.number).trim() === "")
        ? "?" : String(o.number);
      return { number: label, x: fin(o.x), y: fin(o.y) };
    })
    .filter(p => isFinite(p.x) && isFinite(p.y));
  if (!pts.length) return null;

  /* object-fit:contain: подложка вписана в мировой бокс без обрезки и отцентрована. */
  const disp = Math.min(cw / natW, ch / natH);
  const dispW = natW * disp, dispH = natH * disp;
  const offX = (cw - dispW) / 2, offY = (ch - dispH) / 2;

  /* Кадр документа = подложка ∪ все бирки с полем. Обычно совпадает с подложкой. */
  const pad = Math.max(dispW, dispH) * PAD_RATIO;
  let x0 = offX, y0 = offY, x1 = offX + dispW, y1 = offY + dispH;
  pts.forEach(p => {
    x0 = Math.min(x0, p.x - pad); y0 = Math.min(y0, p.y - pad);
    x1 = Math.max(x1, p.x + pad); y1 = Math.max(y1, p.y + pad);
  });
  const frameW = x1 - x0, frameH = y1 - y0;

  const maxW = fin(s.maxWidthMm) > 0 ? fin(s.maxWidthMm) : DEF_MAX_W_MM;
  const maxH = fin(s.maxHeightMm) > 0 ? fin(s.maxHeightMm) : DEF_MAX_H_MM;
  /* мм на мировой пиксель: кадр вписан в лист целиком, пропорции сохранены */
  const k = Math.min(maxW / frameW, maxH / frameH);

  const px = v => 100 * v / frameW, py = v => 100 * v / frameH;
  return {
    imageUrl,
    widthMm: frameW * k,
    /* высота кадра долей ШИРИНЫ: резиновый блок держит пропорцию процентным padding-top
       (тот же приём, что в EPPostImage) — при сужении страницы чертёж не плющит */
    aspectPct: 100 * frameH / frameW,
    image: { left: px(offX - x0), top: py(offY - y0), width: px(dispW), height: py(dispH) },
    badges: pts.map(p => ({ number: p.number, left: px(p.x - x0), top: py(p.y - y0) }))
  };
}

function buildHtml(spec, deps) {
  const esc = (deps && deps.esc) || (v => String(v == null ? "" : v));
  const L = layout(spec);
  if (!L) return "";
  const s = spec || {};
  const title = s.title != null && String(s.title).trim() !== "" ? String(s.title) : "Расположение постов на плане";
  const note = s.note != null ? String(s.note)
    : "Номер на бирке — номер поста в таблицах ниже.";
  const f = n => n.toFixed(3);

  /* БИРКА: белый кружок с синей рамкой и ТЁМНЫМ номером, а не синяя заливка с белым текстом,
     как бейджи внутри документов. Причина ровно одна: Chrome по умолчанию НЕ печатает фоны
     (галочка «Фоновая графика» в диалоге печати). Синий кружок без фона дал бы белый номер на
     белом — бирка исчезла бы из PDF. Тёмный номер читается и без фона. print-color-adjust:exact
     просит движок всё-таки залить фон, а внешнее белое кольцо (box-shadow) отделяет бирку от
     тёмных участков чертежа. Размер фиксированный в px — номер читаем при любом масштабе листа.
     Отрицательные margin вместо transform: кружок центрируется по точке поста без зависимости
     от поддержки трансформаций в движке печати. */
  const half = BADGE / 2, inner = BADGE - 2 * BADGE_BORDER;
  const badges = L.badges.map(b =>
    `<div style="position:absolute;left:${f(b.left)}%;top:${f(b.top)}%;width:${BADGE}px;height:${BADGE}px;`
    + `margin:-${half}px 0 0 -${half}px;box-sizing:border-box;border:${BADGE_BORDER}px solid #1675c8;border-radius:50%;`
    + `background:#fff;color:#14395c;font:700 11px/${inner}px Arial,sans-serif;text-align:center;overflow:hidden;`
    + `box-shadow:0 0 0 2px rgba(255,255,255,.92);-webkit-print-color-adjust:exact;print-color-adjust:exact">`
    + `${esc(b.number)}</div>`
  ).join("");

  /* object-fit:fill у картинки НЕ случайность: прямоугольник ей уже посчитан по пропорции
     (тот же леттербокс, что на экране), второй contain внутри него сжал бы её ещё раз и
     развёл бы бирки с чертежом. break-after:page — блок печатается своей страницей, как в
     эталонном документе заказчика. */
  return `<section style="margin:0 0 16px;break-inside:avoid;page-break-inside:avoid;break-after:page;page-break-after:always">`
    + `<h2 style="font-size:16px;color:#185d96;margin:0 0 10px">${esc(title)}</h2>`
    + `<div style="width:${f(L.widthMm)}mm;max-width:100%;margin:0 auto">`
    + `<div style="position:relative;height:0;padding-top:${f(L.aspectPct)}%">`
    + `<div style="position:absolute;inset:0;border:1px solid #d8e6f2;border-radius:8px;background:#fff;`
    + `-webkit-print-color-adjust:exact;print-color-adjust:exact"></div>`
    + `<img src="${esc(L.imageUrl)}" alt="${esc(title)}" style="position:absolute;left:${f(L.image.left)}%;`
    + `top:${f(L.image.top)}%;width:${f(L.image.width)}%;height:${f(L.image.height)}%;object-fit:fill">`
    + badges
    + `</div></div>`
    + (note.trim() ? `<div style="margin:8px 0 0;color:#687f94;font-size:10px;text-align:center">${esc(note)}</div>` : "")
    + `</section>`;
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). layout отдан наружу отдельно: перевод
   мировых координат в доли кадра — самостоятельная логика, её проверяют числами, а не
   поиском подстрок в HTML. */
const api = { buildHtml, layout };
if (typeof window !== "undefined") window.EPPlanLabels = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
