/* Автообрисовка плана — детекция стен по толщине линий (PLAN 2.1).
   Чистая обработка растра: типизированные массивы на входе и выходе, никакого
   state, DOM или EP_DATA. Оркестратор autoTracePlan (чтение канваса, привязка к
   холсту, отрисовка) остаётся в app.js и вызывает этот модуль.

   Как и estimate.js, модуль без зависимостей приложения — его можно накрыть
   автотестами (PLAN 7.1), не поднимая браузер.

   Интерфейс приложению — window.EPPlanTrace. */
(() => {
"use strict";

/* Порог по яркости: пиксель темнее threshold считаем «краской» (1), иначе фон (0). */
function binarize(data, w, h, threshold) {
  const dark = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const gray = .299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2];
    dark[p] = gray < threshold ? 1 : 0;
  }
  return dark;
}

// Бинарные морфологические операции (сепарабельные: сначала по X, затем по Y).
function dilate(src, w, h, r) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) { const row = y * w; for (let x = 0; x < w; x++) { let v = 0; for (let k = -r; k <= r && !v; k++) { const xx = x + k; if (xx >= 0 && xx < w && src[row + xx]) v = 1; } tmp[row + x] = v; } }
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) { let v = 0; for (let k = -r; k <= r && !v; k++) { const yy = y + k; if (yy >= 0 && yy < h && tmp[yy * w + x]) v = 1; } out[y * w + x] = v; } }
  return out;
}
function erode(src, w, h, r) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) { const row = y * w; for (let x = 0; x < w; x++) { let v = 1; for (let k = -r; k <= r && v; k++) { const xx = x + k; if (xx < 0 || xx >= w || !src[row + xx]) v = 0; } tmp[row + x] = v; } }
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) { let v = 1; for (let k = -r; k <= r && v; k++) { const yy = y + k; if (yy < 0 || yy >= h || !tmp[yy * w + x]) v = 0; } out[y * w + x] = v; } }
  return out;
}
// Замыкание (dilate→erode) заполняет мелкие белые промежутки штриховки, превращая стену в сплошную полосу.
function closeBinary(src, w, h, r) { return erode(dilate(src, w, h, r), w, h, r); }

// Оставляет только крупные связные компоненты (сеть стён тянется через весь план),
// убирая текст, мебель, сантехнику и размерные подписи (мелкие отдельные кляксы).
function keepWallComponents(src, w, h, minSpan, minAreaFrac) {
  const n = w * h, label = new Int32Array(n), stack = new Int32Array(n), keepComp = [];
  const minArea = w * h * minAreaFrac; let comp = 0;
  for (let i = 0; i < n; i++) {
    if (!src[i] || label[i]) continue;
    comp++; let sp = 0; stack[sp++] = i; label[i] = comp;
    let count = 0, minx = w, maxx = 0, miny = h, maxy = 0;
    while (sp) {
      const p = stack[--sp], x = p % w, y = (p / w) | 0;
      count++; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const np = ny * w + nx; if (src[np] && !label[np]) { label[np] = comp; stack[sp++] = np; }
      }
    }
    const spanW = (maxx - minx + 1) / w, spanH = (maxy - miny + 1) / h;
    keepComp[comp] = ((spanW >= minSpan || spanH >= minSpan) && count >= minArea) ? 1 : 0;
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (src[i] && keepComp[label[i]]) out[i] = 1;
  return out;
}

// Осевые точки горизонтальных стен: вертикальные тёмные полосы толщиной [tMin;tMax].
// Тонкие размерные/выносные линии (толщина 1–2px) отсекаются, двойной контур схлопывается в ось.
function horizontalCandidates(dark, w, h, tMin, tMax) {
  const cand = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let run = 0;
    for (let y = 0; y <= h; y++) {
      const on = y < h && dark[y * w + x];
      if (on) { run++; }
      else { if (run >= tMin && run <= tMax) { const c = ((y - run) + (y - 1)) >> 1; cand[c * w + x] = 1; } run = 0; }
    }
  }
  return cand;
}
function verticalCandidates(dark, w, h, tMin, tMax) {
  const cand = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w; let run = 0;
    for (let x = 0; x <= w; x++) {
      const on = x < w && dark[row + x];
      if (on) { run++; }
      else { if (run >= tMin && run <= tMax) { const c = ((x - run) + (x - 1)) >> 1; cand[row + c] = 1; } run = 0; }
    }
  }
  return cand;
}
function runsAlongRows(cand, w, h, minRun, gap) {
  const segs = [];
  for (let y = 0; y < h; y++) {
    const row = y * w; let start = -1, last = -1;
    for (let x = 0; x < w; x++) {
      if (cand[row + x]) { if (start < 0) start = x; last = x; }
      else if (start >= 0 && x - last > gap) { if (last - start >= minRun) segs.push({ x1: start, x2: last, y }); start = -1; }
    }
    if (start >= 0 && last - start >= minRun) segs.push({ x1: start, x2: last, y });
  }
  return segs;
}
function runsAlongCols(cand, w, h, minRun, gap) {
  const segs = [];
  for (let x = 0; x < w; x++) {
    let start = -1, last = -1;
    for (let y = 0; y < h; y++) {
      if (cand[y * w + x]) { if (start < 0) start = y; last = y; }
      else if (start >= 0 && y - last > gap) { if (last - start >= minRun) segs.push({ y1: start, y2: last, x }); start = -1; }
    }
    if (start >= 0 && last - start >= minRun) segs.push({ y1: start, y2: last, x });
  }
  return segs;
}

// Сшивает соседние коллинеарные отрезки (осевые линии одной стены рвутся дверьми/шумом).
function mergeSegments(segments, orientation, tolerance = 5, gap = 18) {
  const result = [];
  const sorted = [...segments].sort((a, b) =>
    orientation === "h" ? (a.y - b.y || a.x1 - b.x1) : (a.x - b.x || a.y1 - b.y1)
  );
  for (const s of sorted) {
    const last = result.at(-1);
    if (!last) { result.push({ ...s }); continue; }
    if (orientation === "h") {
      if (Math.abs(last.y - s.y) <= tolerance && s.x1 - last.x2 <= gap) {
        last.x2 = Math.max(last.x2, s.x2); last.y = (last.y + s.y) / 2;
      } else result.push({ ...s });
    } else {
      if (Math.abs(last.x - s.x) <= tolerance && s.y1 - last.y2 <= gap) {
        last.y2 = Math.max(last.y2, s.y2); last.x = (last.x + s.x) / 2;
      } else result.push({ ...s });
    }
  }
  return result;
}

/* Двойной экспорт: браузеру — глобальный namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = {
  binarize, dilate, erode, closeBinary, keepWallComponents,
  horizontalCandidates, verticalCandidates, runsAlongRows, runsAlongCols, mergeSegments
};
if (typeof window !== "undefined") window.EPPlanTrace = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
