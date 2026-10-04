/* Вид холста (viewport) — чистые пересчёты «экран ↔ мир», вписывание в экран,
   bounding box набора точек и подбор сетки свободного пространства под фактически
   нарисованное (PLAN «бесконечный холст», пункты 6–7). Ни state, ни DOM: всё
   приходит аргументами, наружу — числа и простые объекты. Это разблокирует
   автотесты пересчётов, как geometry.js разблокировал тесты геометрии.

   Модель вида: объекты живут в МИРОВЫХ координатах (совпадают с прежними
   координатами холста — обратная совместимость). Экран получается аффинно:
       screen = world * scale + pan
   Ту же формулу применяет CSS-трансформация родителя холста
   (translate(pan) scale(scale)), поэтому картинка и расчёты не расходятся.

   Интерфейс приложению — window.EPViewport. */
(() => {
"use strict";

/* Мир → экран. view = {panX, panY, scale, angle?}; точки — относительно левого-верхнего
   угла окна холста (того же, от которого отсчитывается CSS-трансформация).
   angle — угол ПОВОРОТА ВСЕГО ВИДА (Б3, ч.2а), в градусах; порядок как у CSS
   `translate(pan) rotate(θ) scale(s)` с transform-origin в этом же углу: СНАЧАЛА масштаб,
   ПОТОМ поворот, в конце сдвиг. angle отсутствует/0 — прежняя формула байт-в-байт (часть 1
   и все старые проекты не трогаются). */
function worldToScreen(pt, view) {
  const a = view.angle ? view.angle * Math.PI / 180 : 0;
  if (!a) return { x: pt.x * view.scale + view.panX, y: pt.y * view.scale + view.panY };
  const c = Math.cos(a), s = Math.sin(a);
  const sx = pt.x * view.scale, sy = pt.y * view.scale;   /* масштаб применяем до поворота */
  return { x: view.panX + sx * c - sy * s, y: view.panY + sx * s + sy * c };
}

/* Экран → мир. Строгая инверсия worldToScreen: round-trip обязан возвращать
   исходную точку — на этом держится «ничего не поехало» при зуме/панораме/повороте.
   Обратная матрица: снимаем сдвиг, затем ПОВОРОТ R(−a), затем масштаб. Это ЕДИНСТВЕННОЕ место
   правила «экран→мир с углом» — все инструменты зовут его, копий формулы по коду нет (§7.1). */
function screenToWorld(pt, view) {
  const a = view.angle ? view.angle * Math.PI / 180 : 0;
  if (!a) return { x: (pt.x - view.panX) / view.scale, y: (pt.y - view.panY) / view.scale };
  const c = Math.cos(a), s = Math.sin(a);
  const dx = pt.x - view.panX, dy = pt.y - view.panY;
  return { x: (dx * c + dy * s) / view.scale, y: (-dx * s + dy * c) / view.scale };
}

/* Зажим масштаба в допустимый диапазон (границы вида задаёт вызывающий). */
function clampScale(scale, min, max) {
  return Math.max(min, Math.min(max, scale));
}

/* Зум «к точке экрана»: масштаб умножается на factor, а pan подбирается так, чтобы
   мировая точка под курсором осталась под курсором (колесо к позиции курсора и
   кнопки +/− к центру используют один и тот же расчёт). Возвращает НОВЫЙ вид. */
function zoomAt(view, screenPt, factor, opts) {
  opts = opts || {};
  const min = opts.min != null ? opts.min : 0.1;
  const max = opts.max != null ? opts.max : 4;
  const newScale = clampScale(view.scale * factor, min, max);
  /* мировая точка под курсором до зума; после зума требуем worldToScreen(w)=screenPt при ТОМ ЖЕ угле */
  const w = screenToWorld(screenPt, view);
  const a = view.angle ? view.angle * Math.PI / 180 : 0;
  const c = Math.cos(a), s = Math.sin(a);
  const sx = w.x * newScale, sy = w.y * newScale;
  return { scale: newScale, panX: screenPt.x - (sx * c - sy * s), panY: screenPt.y - (sx * s + sy * c) };
}

/* Поворот вида ВОКРУГ точки экрана: угол мира меняется на newAngle (градусы), а мировая точка под
   screenPt остаётся на том же месте экрана — ровно как zoomAt держит точку при зуме. Масштаб не
   трогаем. Нужен при повороте всего плана кнопками/полем, чтобы содержимое не улетало за край окна.
   Возвращает НОВЫЙ вид {scale, panX, panY, angle}. */
function rotateAt(view, screenPt, newAngle) {
  const w = screenToWorld(screenPt, view);
  const a = newAngle ? newAngle * Math.PI / 180 : 0;
  const c = Math.cos(a), s = Math.sin(a);
  const sx = w.x * view.scale, sy = w.y * view.scale;
  return { scale: view.scale, angle: newAngle || 0,
    panX: screenPt.x - (sx * c - sy * s), panY: screenPt.y - (sx * s + sy * c) };
}

/* Повернуть мировую точку на angleDeg (градусы) вокруг центра (cx,cy). ЕДИНСТВЕННОЕ место
   правила «повернуть точку» для документов (Б3, ч.2б): печатный план (planLabels.layout) запекает
   поворот всего вида в координаты точек, тогда как холст тот же поворот делает матрицей вида
   (worldToScreen). Знак совпадает с worldToScreen (x'=x·cos−y·sin, y'=x·sin+y·cos) — документ
   поворачивает в ту же сторону, что экран. angle 0/нет → точка как есть (новый объект, те же числа):
   при нулевом угле документ выходит байт-в-байт как прежде. */
function rotatePoint(pt, angleDeg, cx, cy) {
  const a = angleDeg ? angleDeg * Math.PI / 180 : 0;
  if (!a) return { x: pt.x, y: pt.y };
  const c = Math.cos(a), s = Math.sin(a);
  const dx = pt.x - cx, dy = pt.y - cy;
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
}

/* Прямоугольник, накрывающий набор точек: {minX,minY,maxX,maxY} или null, если
   точек нет. База и для «вписать в экран», и для подбора сетки свободного места. */
function bounds(points) {
  if (!points || !points.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/* «Вписать в экран»: подобрать вид так, чтобы прямоугольник b целиком уместился в
   окне viewW×viewH с полями padding, а центр содержимого встал в центр окна.
   Пустой b (ничего не нарисовано) — возврат к 100% и началу координат (требование). */
function fitView(b, viewW, viewH, opts) {
  opts = opts || {};
  const padding = opts.padding != null ? opts.padding : 40;
  const minScale = opts.minScale != null ? opts.minScale : 0.1;
  const maxScale = opts.maxScale != null ? opts.maxScale : 4;
  if (!b) return { panX: 0, panY: 0, scale: 1 };
  /* Угол мира (Б3, ч.2а): содержимое на экране повёрнуто, поэтому вписываем ГАБАРИТ ПОВЁРНУТОГО
     bbox, а не сам bbox. Стороны поворачиваются и складываются (|cos|/|sin|), как у подложки в
     planRotate.fitScale. angle отсутствует/0 — rw=bw, rh=bh и формула совпадает со старой. */
  const a = opts.angle ? opts.angle * Math.PI / 180 : 0;
  const ac = Math.abs(Math.cos(a)), as = Math.abs(Math.sin(a));
  const bw = b.maxX - b.minX, bh = b.maxY - b.minY;
  const rw = bw * ac + bh * as, rh = bw * as + bh * ac;   /* габарит повёрнутого bbox */
  const availW = Math.max(1, viewW - 2 * padding), availH = Math.max(1, viewH - 2 * padding);
  /* по нулевой стороне (точка/строго H- или V-линия) не делим — берём другую ось,
     а если вырождены обе, оставляем 100% */
  let scale;
  if (rw <= 0 && rh <= 0) scale = 1;
  else if (rw <= 0) scale = availH / rh;
  else if (rh <= 0) scale = availW / rw;
  else scale = Math.min(availW / rw, availH / rh);
  scale = clampScale(scale, minScale, maxScale);
  /* центр содержимого — в центр окна: pan = центр_окна − R(a)·(scale·центр) */
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  const c = Math.cos(a), s = Math.sin(a), scx = cx * scale, scy = cy * scale;
  return { scale, panX: viewW / 2 - (scx * c - scy * s), panY: viewH / 2 - (scx * s + scy * c) };
}

/* Подбор сетки свободного пространства ПОД ФАКТИЧЕСКИ НАРИСОВАННОЕ (пункт 6 плана).
   На бесконечном поле нельзя брать размер блока: объекты и стены бывают в любых
   координатах, включая отрицательные. Возвращаем начало (origin) и размер сетки,
   накрывающей b с запасом margin. origin приводим к кратному cell — иначе
   ортогонализация контуров по узлам сетки (Math.round(x/cell)*cell) начнёт «врать».
   Предохранитель: если клеток вышло бы больше maxCells, УКРУПНЯЕМ cell — иначе
   гигантская сетка подвесит интерфейс (требование владельца). */
function spaceGrid(b, opts) {
  opts = opts || {};
  const margin = opts.margin != null ? opts.margin : 40;
  const maxCells = opts.maxCells != null ? opts.maxCells : 300000;
  let cell = opts.cell > 0 ? opts.cell : 10;
  /* пусто — минимальная валидная сетка вокруг начала координат */
  const box = b || { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const minX = box.minX - margin, minY = box.minY - margin;
  const maxX = box.maxX + margin, maxY = box.maxY + margin;
  /* начало сетки — вниз до узла кратного cell */
  const originX = Math.floor(minX / cell) * cell;
  const originY = Math.floor(minY / cell) * cell;
  let width = Math.max(cell, maxX - originX);
  let height = Math.max(cell, maxY - originY);
  /* предохранитель по числу клеток: укрупняем шаг, пока не уложимся в maxCells.
     origin пересчитываем под новый cell, чтобы остаться на узле. */
  let cols = Math.ceil(width / cell), rows = Math.ceil(height / cell);
  while (cols * rows > maxCells) {
    cell *= 2;
    const ox = Math.floor(minX / cell) * cell, oy = Math.floor(minY / cell) * cell;
    width = Math.max(cell, maxX - ox);
    height = Math.max(cell, maxY - oy);
    cols = Math.ceil(width / cell); rows = Math.ceil(height / cell);
  }
  return { originX: Math.floor(minX / cell) * cell, originY: Math.floor(minY / cell) * cell, width, height, cell };
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { worldToScreen, screenToWorld, clampScale, zoomAt, rotateAt, rotatePoint, bounds, fitView, spaceGrid };
if (typeof window !== "undefined") window.EPViewport = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
