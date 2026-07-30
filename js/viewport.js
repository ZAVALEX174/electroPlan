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

/* Мир → экран. view = {panX, panY, scale}; точки — относительно левого-верхнего
   угла окна холста (того же, от которого отсчитывается CSS-трансформация). */
function worldToScreen(pt, view) {
  return { x: pt.x * view.scale + view.panX, y: pt.y * view.scale + view.panY };
}

/* Экран → мир. Строгая инверсия worldToScreen: round-trip обязан возвращать
   исходную точку — на этом держится «ничего не поехало» при зуме/панораме. */
function screenToWorld(pt, view) {
  return { x: (pt.x - view.panX) / view.scale, y: (pt.y - view.panY) / view.scale };
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
  /* мировая точка под курсором до зума; после зума требуем worldToScreen(w)=screenPt */
  const w = screenToWorld(screenPt, view);
  return { scale: newScale, panX: screenPt.x - w.x * newScale, panY: screenPt.y - w.y * newScale };
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
  const bw = b.maxX - b.minX, bh = b.maxY - b.minY;
  const availW = Math.max(1, viewW - 2 * padding), availH = Math.max(1, viewH - 2 * padding);
  /* по нулевой стороне (точка/строго H- или V-линия) не делим — берём другую ось,
     а если вырождены обе, оставляем 100% */
  let scale;
  if (bw <= 0 && bh <= 0) scale = 1;
  else if (bw <= 0) scale = availH / bh;
  else if (bh <= 0) scale = availW / bw;
  else scale = Math.min(availW / bw, availH / bh);
  scale = clampScale(scale, minScale, maxScale);
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  return { scale, panX: viewW / 2 - cx * scale, panY: viewH / 2 - cy * scale };
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
const api = { worldToScreen, screenToWorld, clampScale, zoomAt, bounds, fitView, spaceGrid };
if (typeof window !== "undefined") window.EPViewport = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
