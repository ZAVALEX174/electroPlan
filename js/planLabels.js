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

   ПОДЛОЖКА ОПЦИОНАЛЬНА. Замысел владельца: чертёж был лишь фоном, «чтобы по нему можно было
   обвести, а ориентироваться на нарисованное». Помещения штатно рисуются разметкой и БЕЗ
   картинки («Определить помещения по линиям»), и документ обязан их показать. Есть подложка —
   ложится фоном под контуры; нет — блок строится по контурам и биркам. Блок исчезает, только
   когда печатать нечего совсем: ни помещения, ни поста.

   spec = {
     imageUrl?,          // подложка (у нас всегда data-URL) — ОПЦИОНАЛЬНА, нет её — блок без фона
     natW?, natH?,       // НАТУРАЛЬНЫЕ размеры подложки (img.naturalWidth/naturalHeight)
     canvasW?, canvasH?, // размеры мирового бокса #canvas на момент сборки документа
     posts: [ { number, x, y } ],   // x/y — мировая ТОЧКА поста (центр иконки, не левый угол)
     rooms: [ { name, polygon?: [{x,y}], x?, y? } ],
       //  polygon — контур помещения в МИРОВЫХ точках (той же системе, что post.x/y);
       //  x/y — мировая точка ЯКОРЯ подписи (центроид у контурного, позиция подписи у
       //  комнаты без контура — созданной инструментом «T»: у неё есть только точка).
     title?, note?,                 // подписи блока
     maxWidthMm?, maxHeightMm?      // полезная площадь листа (по умолчанию A4 с полями)
   }
   deps = { esc(s) }.
   Возвращает строку HTML-секции либо "" (печатать нечего: ни помещений, ни постов). */
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

/* Среднее по вершинам — запасной якорь подписи, когда app.js не прислал точку x/y у
   контурного помещения. Это НЕ площадной центроид (для вогнутых чуть смещён), но имени
   хватает: в приложении якорь всегда приходит извне готовым, сюда попадаем лишь как фолбэк. */
function meanPoint(poly) {
  let sx = 0, sy = 0;
  poly.forEach(p => { sx += p.x; sy += p.y; });
  return { x: sx / poly.length, y: sy / poly.length };
}

/* Геометрия блока в долях кадра — отдельно от вёрстки, чтобы проверять её тестом напрямую.
   Возвращает null, когда печатать нечего совсем (ни помещений, ни постов с координатами).
   Подложка опциональна: есть — идёт фоном, нет — кадр строится по контурам и биркам. */
function layout(spec) {
  const s = spec || {};

  /* Подложка теперь ОПЦИОНАЛЬНА (см. шапку файла). SVG без внутренних размеров даёт
     naturalWidth 0 — арифметика леттербокса ушла бы в NaN; такую подложку считаем
     отсутствующей, но блок из-за этого больше НЕ пропадаем: он строится без фона. */
  const imageUrl = typeof s.imageUrl === "string" ? s.imageUrl.trim() : "";
  const natW = fin(s.natW), natH = fin(s.natH);
  const cw = fin(s.canvasW), ch = fin(s.canvasH);
  const hasImage = !!imageUrl && natW > 0 && natH > 0 && cw > 0 && ch > 0;

  /* object-fit:contain: подложка вписана в мировой бокс без обрезки и отцентрована. */
  let img = null;
  if (hasImage) {
    const disp = Math.min(cw / natW, ch / natH);
    const dispW = natW * disp, dispH = natH * disp;
    img = { offX: (cw - dispW) / 2, offY: (ch - dispH) / 2, dispW, dispH };
  }

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

  /* Помещения: контур (polygon в мировых точках) и/или якорь подписи (x/y). Комната без
     контура — созданная инструментом «T»: у неё физически есть только точка подписи, и
     терять её нельзя. Комнату совсем без геометрии (ни контура >2 точек, ни якоря) печатать
     некуда — отбрасываем. Якорь берём из x/y, а если контур есть, но точки нет, — из среднего
     по вершинам, чтобы имя контурного помещения всё равно встало у центра. */
  const rooms = (Array.isArray(s.rooms) ? s.rooms : [])
    .map(r => {
      const o = r || {};
      const poly = (Array.isArray(o.polygon) ? o.polygon : [])
        .map(pt => ({ x: fin((pt || {}).x), y: fin((pt || {}).y) }))
        .filter(pt => isFinite(pt.x) && isFinite(pt.y));
      const polygon = poly.length > 2 ? poly : null;
      const lx = fin(o.x), ly = fin(o.y);
      const label = (isFinite(lx) && isFinite(ly)) ? { x: lx, y: ly }
        : (polygon ? meanPoint(polygon) : null);
      return { name: o.name == null ? "" : String(o.name), polygon, label };
    })
    .filter(r => r.polygon || r.label);

  /* Блок исчезает, только когда печатать нечего совсем. Одна подложка без разметки блок НЕ
     поднимает — она лишь фон для обводки (замысел владельца). */
  if (!pts.length && !rooms.length) return null;

  /* Кадр = все печатаемые мировые точки ∪ прямоугольник подложки. bbox считаем ОБЩЕЙ
     EPViewport.bounds — не заводим четвёртую копию min/max (браузеру — namespace, Node —
     require, как в offerPdf.js). */
  const bounds = (typeof window !== "undefined" && window.EPViewport)
    ? window.EPViewport.bounds : require("./viewport.js").bounds;

  /* Базовые точки (подложка, контуры, якоря подписей) в кадр входят БЕЗ поля: их край —
     это и есть край чертежа. Поле нужно только биркам-кружкам (см. ниже). */
  const base = [];
  if (img) base.push({ x: img.offX, y: img.offY }, { x: img.offX + img.dispW, y: img.offY + img.dispH });
  rooms.forEach(r => {
    if (r.polygon) r.polygon.forEach(pt => base.push(pt));
    if (r.label) base.push(r.label);
  });

  /* Поле вокруг бирок: кружок рисуется ПОВЕРХ точки, без запаса крайний вылез бы за кадр
     наполовину. Размах поля берём от всего содержимого (раньше был привязан к размеру
     подложки, которой теперь может не быть). Вырожденный случай (единственная точка,
     size 0) не делит на ноль. */
  const raw = bounds(base.concat(pts.map(p => ({ x: p.x, y: p.y }))));
  const span = Math.max(raw.maxX - raw.minX, raw.maxY - raw.minY);
  const pad = (span > 0 ? span : 100) * PAD_RATIO;

  /* Тот же набор точек, но посты раздуты на поле: подложку и контуры НЕ раздуваем, иначе
     картинка отошла бы от края кадра там, где раньше стояла впритык (тесты леттербокса). */
  const framePts = base.slice();
  pts.forEach(p => framePts.push({ x: p.x - pad, y: p.y - pad }, { x: p.x + pad, y: p.y + pad }));
  const fb = bounds(framePts);
  const x0 = fb.minX, y0 = fb.minY, x1 = fb.maxX, y1 = fb.maxY;
  const frameW = x1 - x0, frameH = y1 - y0;

  const maxW = fin(s.maxWidthMm) > 0 ? fin(s.maxWidthMm) : DEF_MAX_W_MM;
  const maxH = fin(s.maxHeightMm) > 0 ? fin(s.maxHeightMm) : DEF_MAX_H_MM;
  /* мм на мировой пиксель: кадр вписан в лист целиком, пропорции сохранены */
  const k = Math.min(maxW / frameW, maxH / frameH);

  const px = v => 100 * v / frameW, py = v => 100 * v / frameH;
  return {
    imageUrl: hasImage ? imageUrl : null,
    widthMm: frameW * k,
    /* высота кадра долей ШИРИНЫ: резиновый блок держит пропорцию процентным padding-top
       (тот же приём, что в EPPostImage) — при сужении страницы чертёж не плющит */
    aspectPct: 100 * frameH / frameW,
    image: img ? { left: px(img.offX - x0), top: py(img.offY - y0), width: px(img.dispW), height: py(img.dispH) } : null,
    badges: pts.map(p => ({ number: p.number, left: px(p.x - x0), top: py(p.y - y0) })),
    rooms: rooms.map(r => ({
      name: r.name,
      polygon: r.polygon ? r.polygon.map(pt => ({ left: px(pt.x - x0), top: py(pt.y - y0) })) : null,
      label: r.label ? { left: px(r.label.x - x0), top: py(r.label.y - y0) } : null
    }))
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

  /* КОНТУРЫ помещений — SVG-полигоном ПОВЕРХ подложки (или вместо неё), в тех же процентах
     кадра, что и бирки. viewBox 0 0 100 100 + preserveAspectRatio:none кладёт проценты прямо
     в координаты вьюбокса; кадр неквадратный, поэтому масштаб по осям разный — vector-effect:
     non-scaling-stroke держит линию тонкой и ровной, а не растянутой вслед за кадром. Стиль —
     как .room-poly на экране: обводка без заливки. Контур печатается на переднем плане (линия,
     а не фон), фоновую графику принтера не требует. */
  const polyRooms = L.rooms.filter(r => r.polygon);
  const contours = polyRooms.length
    ? `<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none">`
      + polyRooms.map(r =>
          `<polygon points="${r.polygon.map(pt => f(pt.left) + "," + f(pt.top)).join(" ")}" `
          + `fill="none" stroke="#33475b" stroke-width="1.2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`
        ).join("")
      + `</svg>`
    : "";

  /* НАЗВАНИЯ помещений — у якоря подписи (центроид контурного, позиция подписи у комнаты без
     контура). Полупрозрачная подложка под текстом читается и над тёмным чертежом, и над белым
     фоном. Центрируем translate(-50%,-50%): ширину текста заранее не знаем, margin-приёмом
     (как у бирок) её не сдвинуть. Пустое имя не печатаем — контур говорит сам за себя. */
  const names = L.rooms
    .filter(r => r.label && String(r.name).trim() !== "")
    .map(r =>
      `<div style="position:absolute;left:${f(r.label.left)}%;top:${f(r.label.top)}%;`
      + `transform:translate(-50%,-50%);font:700 10px/1.2 Arial,sans-serif;color:#14395c;`
      + `background:rgba(255,255,255,.82);padding:1px 5px;border-radius:4px;white-space:nowrap;`
      + `-webkit-print-color-adjust:exact;print-color-adjust:exact">${esc(r.name)}</div>`
    ).join("");

  /* object-fit:fill у картинки НЕ случайность: прямоугольник ей уже посчитан по пропорции
     (тот же леттербокс, что на экране), второй contain внутри него сжал бы её ещё раз и
     развёл бы бирки с чертежом. break-after:page — блок печатается своей страницей, как в
     эталонном документе заказчика. Подложки может не быть — тогда фон белый, а поверх остаются
     контуры, подписи и бирки. */
  const image = L.imageUrl
    ? `<img src="${esc(L.imageUrl)}" alt="${esc(title)}" style="position:absolute;left:${f(L.image.left)}%;`
      + `top:${f(L.image.top)}%;width:${f(L.image.width)}%;height:${f(L.image.height)}%;object-fit:fill">`
    : "";
  return `<section style="margin:0 0 16px;break-inside:avoid;page-break-inside:avoid;break-after:page;page-break-after:always">`
    + `<h2 style="font-size:16px;color:#185d96;margin:0 0 10px">${esc(title)}</h2>`
    + `<div style="width:${f(L.widthMm)}mm;max-width:100%;margin:0 auto">`
    + `<div style="position:relative;height:0;padding-top:${f(L.aspectPct)}%">`
    + `<div style="position:absolute;inset:0;border:1px solid #d8e6f2;border-radius:8px;background:#fff;`
    + `-webkit-print-color-adjust:exact;print-color-adjust:exact"></div>`
    + image
    + contours
    + names
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
