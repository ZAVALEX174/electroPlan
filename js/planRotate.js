/* Поворот ПОДЛОЖКИ-чертежа (Б3, часть 1). Чертёж был лишь фоном «чтобы по нему обвести»
   (замысел владельца, §1.4 итогов 24.08: «повернуть нужно обязательно»). Эта часть вращает
   ТОЛЬКО подложку: нарисованные стены/комнаты/посты остаются на месте — их координаты не
   трогаются (поворот всего плана — отдельная задача, часть 2).

   ЧИСТЫЙ МОДУЛЬ, как geometry.js/planLabels.js: ни DOM, ни state, ни EP_DATA. На вход — числа,
   на выход — числа и строки. Поэтому один и тот же расчёт обслуживает ДВА потребителя без
   второй копии правила (§7.1 HANDOFF): рабочий холст (app.js вращает #planImage) и печатный
   документ (planLabels.js вращает <img> подложки в КП/листе монтажника). Угол и масштаб-вписывание
   считаются здесь, оба потребителя лишь подставляют их в свою CSS-трансформацию.

   СИСТЕМА КООРДИНАТ. Подложка лежит в мировом боксе холста (box) с object-fit:contain, то есть
   ЛЕТТЕРБОКСИТСЯ: вписана без обрезки и отцентрована. Центр вписанного прямоугольника совпадает с
   центром бокса — вокруг него и вращаем (одна точка на экране и в документе). */
(() => {
"use strict";

/* Угол в градусах, нормализованный в [0, 360), либо null — если вход не число.
   Принимает и число, и строку: запятую-десятичный разделитель («3,5») переводим в точку, пробелы
   по краям отбрасываем. Пустая строка, null, true/false и мусор («abc», «90deg») → null: вызывающий
   по null оставляет текущий угол, а не подставляет 0 (молчаливый сброс угла — потеря работы).
   −90 → 270, 450 → 90, 360 → 0 (нормализация через двойной модуль не даёт отрицательных). */
function normalizeAngle(input) {
  let n;
  if (typeof input === "number") n = input;
  else if (typeof input === "string") {
    const s = input.trim().replace(",", ".");
    if (s === "") return null;
    n = Number(s);
  } else return null;             /* null / boolean / object — не угол */
  if (!Number.isFinite(n)) return null;
  return ((n % 360) + 360) % 360;
}

/* Шаг кнопок ↺/↻: ±90° от ТЕКУЩЕГО угла, с нормализацией. Текущий угол приходит из state и уже
   нормализован, но прогоняем через normalizeAngle ещё раз — на случай битого значения из старого
   проекта (null → считаем 0). Всегда возвращает число. */
function step(angle, delta) {
  const base = normalizeAngle(angle);
  return normalizeAngle((base == null ? 0 : base) + delta);
}

/* Коэффициент вписывания повёрнутой подложки в мировой бокс (1 — не уменьшать).
   У НЕповёрнутого прямоугольника object-fit:contain уже вписал картинку в бокс (dispW≤boxW,
   dispH≤boxH). Но при повороте габаритный прямоугольник картинки растёт: ширина
   dispW·|cos|+dispH·|sin|, высота dispW·|sin|+dispH·|cos|. На 90°/270° у неквадратной подложки
   стороны меняются местами и она вылезла бы за бокс (обрезалась бы окном холста). Поэтому
   домножаем на масштаб, при котором повёрнутый габарит снова влезает в бокс. При угле 0 габарит
   равен dispW×dispH ≤ боксу, min даёт 1 — неповёрнутая подложка НЕ уменьшается (байт-в-байт как
   раньше). Никогда не больше 1: увеличивать картинку сверх object-fit:contain не наше дело. */
function fitScale(angleDeg, natW, natH, boxW, boxH) {
  if (!(natW > 0 && natH > 0 && boxW > 0 && boxH > 0)) return 1;
  const a = normalizeAngle(angleDeg);
  if (a == null) return 1;
  const disp = Math.min(boxW / natW, boxH / natH);   /* object-fit:contain */
  const dw = natW * disp, dh = natH * disp;
  const r = a * Math.PI / 180, c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
  const bw = dw * c + dh * s, bh = dw * s + dh * c;
  return Math.min(1, boxW / bw, boxH / bh);
}

const r4 = x => Math.round(x * 1e4) / 1e4;   /* угол — до 4 знаков (3,5° и т.п.) */
const r5 = x => Math.round(x * 1e5) / 1e5;   /* масштаб — до 5 знаков */

/* Готовая CSS-трансформация подложки: `rotate(θdeg) scale(s)`. Пустая строка — когда поворота нет
   (θ=0 и вписывать не нужно): потребитель тогда не ставит transform вовсе, и неповёрнутая подложка
   в документе выводится байт-в-байт как до правки (старые КП не меняются, их тесты зелены).
   transform-origin центрирует потребитель — центр элемента = центр вписанной подложки = центр бокса.

   fitAngleDeg — НЕОБЯЗАТЕЛЬНЫЙ угол, по которому берётся вписывающий scale, когда он ОТЛИЧАЕТСЯ от
   угла поворота. Нужен документу (Б3, ч.2б): там подложка крутится на сумму углов (поворот всего
   плана worldAngle + поворот чертежа planRotation), но УМЕНЬШАТЬ её под бокс надо только на
   planRotation — worldAngle крутит весь вид, а не вписывает картинку в бокс (кадр документа сам
   расширяется под повёрнутые углы). Не передан → scale берётся по углу поворота, как было (холст:
   угол и вписывание — один и тот же planRotation, вызов пятиаргументный, поведение прежнее). */
function cssTransform(angleDeg, natW, natH, boxW, boxH, fitAngleDeg) {
  const a = normalizeAngle(angleDeg);
  if (a == null) return "";
  let fa = a;
  if (fitAngleDeg !== undefined) { const n = normalizeAngle(fitAngleDeg); if (n != null) fa = n; }
  const s = fitScale(fa, natW, natH, boxW, boxH);
  if (a === 0 && s === 1) return "";
  return `rotate(${r4(a)}deg) scale(${r5(s)})`;
}

/* Печатное представление угла для поля ввода: число с запятой-разделителем (русский UI).
   270 → "270", 3.5 → "3,5". Нормализуем вход на случай битого значения. */
function formatAngle(angle) {
  const a = normalizeAngle(angle);
  return String(a == null ? 0 : r4(a)).replace(".", ",");
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports для
   автотестов и для planLabels.js (он тянет этот же расчёт require'ом в node-стенде). */
const api = { normalizeAngle, step, fitScale, cssTransform, formatAngle };
if (typeof window !== "undefined") window.EPPlanRotate = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
