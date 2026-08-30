/* Привязка объекта к комнате у ГРАНИЦЫ контура (PLAN: пост у дверного проёма стоит ровно
   на линии стены, а pointInPolygon трактует точку на границе как «снаружи»). Чистая
   математика допуска: точки, полигоны и величина допуска приходят аргументами, наружу —
   комната или null. Ни state, ни DOM, ни EPConfig — значение допуска подставляет app.js,
   как и в остальных чистых модулях.

   ⚠️ ЭТО ТОЛЬКО ФОЛБЭК. Настоящее попадание (в контур или в grid-комнату) разбирает
   вызывающий ДО обращения сюда и его результат не переопределяется — допуск включается,
   лишь когда объект не попал ни в одну комнату. Само правило «сначала попадание, потом
   допуск» сведено в одну функцию app.js (resolveRoomForPoint), чтобы у правки не было краёв:
   подсветка при перетаскивании и фактическая привязка не могут показать разные комнаты.

   Интерфейс приложению — window.EPRoomAssign. */
(() => {
"use strict";

/* Ближайшая комната по расстоянию до её контура в пределах допуска — сама комната или null.
   rooms — массив {id, polygon:[{x,y}]}; комнаты без полигона (grid-комнаты) контура не имеют
   и в поиске не участвуют (не роняя функцию). distToSeg — EPGeom.distancePointToSegment
   (вторую реализацию проекции заводить нельзя). Допуск ВКЛЮЧИТЕЛЬНЫЙ: точка ровно на границе
   (расстояние 0) привязывается, точка на расстоянии tolerance — тоже, дальше — нет.

   ⚠️ ДЕТЕРМИНИЗМ. При равном расстоянии до двух комнат выбор идёт по tieKey(room) (по
   умолчанию строковый id), а не по позиции во входном массиве — у проекта отдельная история
   дефектов «результат зависит от порядка входа». Сравнение расстояний — с эпсилоном, иначе
   float-дрожание рассыпало бы тай-брейк. */
function nearestRoomWithinTolerance(cx, cy, rooms, tolerance, distToSeg, tieKey) {
  const key = tieKey || (r => String(r.id));
  const eps = 1e-9;
  let best = null, bestDist = Infinity, bestKey = null;
  for (const room of (rooms || [])) {
    const poly = room && room.polygon;
    if (!poly || poly.length < 3) continue;
    // расстояние до контура = минимум по всем рёбрам полигона
    let d = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const seg = distToSeg(cx, cy, poly[j].x, poly[j].y, poly[i].x, poly[i].y);
      if (seg < d) d = seg;
    }
    if (d > tolerance) continue;
    const k = key(room);
    // ближе — берём безусловно; ровно так же далеко — берём меньший ключ (порядок-независимость)
    if (d < bestDist - eps || (Math.abs(d - bestDist) <= eps && (bestKey === null || k < bestKey))) {
      best = room; bestDist = d; bestKey = k;
    }
  }
  return best;
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { nearestRoomWithinTolerance };
if (typeof window !== "undefined") window.EPRoomAssign = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
