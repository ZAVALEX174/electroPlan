/* Перенос объектов на плане — чистая математика жеста (PLAN 2.1, взаимодействие с
   объектами, пункты 0–1). Ни state, ни DOM, ни PointerEvent: сюда приходят числа,
   наружу — числа. Это разблокирует автотесты «клик против переноса» и «пересчёта
   координат при переносе», как geometry.js/viewport.js разблокировали свои расчёты.

   Две вещи, которые легко сломать и потому вынесены под тесты:
   1) ПОРОГ начала переноса — пока курсор не отошёл дальше порога, это клик, а не
      перенос (иначе дрожание руки таскает объект);
   2) ПЕРЕСЧЁТ мировых координат — экран масштабируется видом (scale), поэтому
      экранную дельту курсора делим на scale, иначе на зуме объект «убегает» от курсора.

   Интерфейс приложению — window.EPDrag. */
(() => {
"use strict";

/* Ушёл ли указатель дальше порога от точки нажатия. Сравниваем КВАДРАТЫ расстояний —
   без Math.sqrt (дешевле и без потери точности у границы). dx/dy — в пикселях ЭКРАНА
   (порог задаётся в экранных px, он про «дрожание руки», а не про мировой масштаб). */
function beyondThreshold(dx, dy, threshold) {
  return dx * dx + dy * dy >= threshold * threshold;
}

/* Новая МИРОВАЯ позиция объекта при переносе. base — мировые координаты объекта в
   момент нажатия; startClient — экранная точка нажатия; client — текущая экранная
   точка курсора; scale — масштаб вида; angle — угол ПОВОРОТА ВСЕГО ВИДА в градусах (Б3, ч.2а,
   опционально). Экранную дельту курсора переводим в мировую: снимаем поворот обратной матрицей
   R(−angle) и делим на scale — та же обратная матрица, что в EPViewport.screenToWorld (§7.1).
   angle отсутствует/0 — прежняя формула (перенос при невращёном виде не меняется). */
function worldPosition(base, startClient, client, scale, angle) {
  const s = scale || 1;   /* страховка от нулевого масштаба (делить нельзя) */
  const dxs = client.x - startClient.x, dys = client.y - startClient.y;   /* экранная дельта */
  const a = angle ? angle * Math.PI / 180 : 0;
  if (!a) return { x: base.x + dxs / s, y: base.y + dys / s };
  const c = Math.cos(a), sn = Math.sin(a);
  return { x: base.x + (dxs * c + dys * sn) / s, y: base.y + (-dxs * sn + dys * c) / s };
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { beyondThreshold, worldPosition };
if (typeof window !== "undefined") window.EPDrag = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
