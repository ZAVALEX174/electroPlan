/* Поворот картинки собранного поста на 90° при вертикальном расположении (Б8-д, часть 2) — ЧИСТАЯ
   логика без state/DOM/каталога. Здесь ОДНО место двух правил, и второй копии нет (§7.1):
   1. shouldRotate — «надо ли поворачивать картинку этого поста». Правило ориентации не дублируем:
      зовём EPFrameOrientation (isVerticalPost + isVertical). Пост вертикален, НО его накладка НЕ
      вертикальная (итальянская 30654.00 или любая без вертикального двойника) → картинку надо
      повернуть ЦЕЛИКОМ вместе с механизмами (заказчик 11.11: «в итальянском стандарте он повернётся
      на 90° вместе со всеми механизмами»). Накладка уже вертикальная (LINEA 30645/30646) → НЕ
      поворачиваем: у неё своё вертикальное фото с окнами одно под другим.
   2. wrapRotated — КАК поворачивать: CSS transform сам размер не меняет (повёрнутый блок налез бы на
      соседние), поэтому оборачиваем сцену контейнером с ПОМЕНЯННЫМИ шириной/высотой и уводим поворот
      внутрь. Одна копия вёрстки поворота на postImage (картинка) и explodedView (взрыв-схема) — у
      правки нет краёв.

   Модуль без state/DOM, как frameOrientation.js/postStandard.js (PLAN 7.1): на вход — товар-накладка и
   флаг / строка HTML и размеры, на выход — булево / строка. Поворот ВКЛЮЧАЕМЫЙ параметром (spec.rotate):
   его ставят ТОЛЬКО окно поста и лист монтажника; значок на плане, миниатюры «Готовые посты», подсказка
   и картинки КП остаются как есть (владелец их не утверждал). */
(() => {
"use strict";

/* EPFrameOrientation — из window (подключён до этого файла) либо require (node-тесты); тот же приём,
   что EPSeriesMatch в postfit.js и EPFrameOrientation в postStandard.js. Правило ориентации — ОДНО
   место, второй копии не заводим. */
const EPFrameOrientation = (typeof module !== "undefined" && module.exports)
  ? require("./frameOrientation.js") : (typeof window !== "undefined" ? window.EPFrameOrientation : undefined);

/* Надо ли поворачивать картинку поста: пост вертикален (флаг «Расположить вертикально» ИЛИ накладка
   уже вертикальная — isVerticalPost), НО сама накладка НЕ вертикальная. У вертикальной накладки своё
   фото и окна одно под другим — её не крутим. Итог тождествен «flag===true И накладка не вертикальная»,
   но выражен через правило ориентации, чтобы край «что считать вертикальным постом» жил в одном месте. */
function shouldRotate(frame, flag) {
  // Нет накладки (пост без разрешённой накладки) или битая загрузка правила — поворачивать нечего.
  if (!frame || !EPFrameOrientation) return false;
  return EPFrameOrientation.isVerticalPost(frame, flag) && !EPFrameOrientation.isVertical(frame);
}

/* Повернуть готовую сцену картинки на 90° ПО ЧАСОВОЙ. transform:rotate размер потока НЕ меняет, поэтому:
   внешний контейнер получает ПОМЕНЯННЫЕ размеры (ширина = прежняя высота h, высота = прежняя ширина w) —
   он и резервирует «высокую» область, не давая повёрнутой сцене налезть на соседние блоки; внутренний
   блок сохраняет натуральные w×h и повёрнут от левого-верхнего угла. Поворот по часовой у левого-верхнего
   угла уводит сцену в отрицательный X, поэтому возвращаем её вправо на h: translateX(h) rotate(90deg)
   (композиция справа налево — сначала поворот, потом сдвиг). max-width:100% оставляем, чтобы в узкой
   колонке печати контейнер мог сжаться. Размеры неизвестны (≤0) → поворачивать нечего, возвращаем сцену
   как есть (тот же фолбэк, что «не поворачиваем»). */
function wrapRotated(innerHtml, w, h) {
  const W = Math.round(Number(w) || 0), H = Math.round(Number(h) || 0);
  if (!(W > 0 && H > 0)) return String(innerHtml == null ? "" : innerHtml);
  return `<div class="assembled-rotated" style="position:relative;width:${H}px;height:${W}px;max-width:100%">`
    + `<div style="position:absolute;top:0;left:0;width:${W}px;height:${H}px;transform-origin:top left;transform:translateX(${H}px) rotate(90deg)">`
    + String(innerHtml == null ? "" : innerHtml) + `</div></div>`;
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports для тестов. */
const api = { shouldRotate, wrapRotated };
if (typeof window !== "undefined") window.EPPostRotation = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
