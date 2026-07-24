/**
 * ElectroPlan — сегментация комнат (БАЗОВЫЙ вариант).
 *
 * Метод: OpenCV.js + distance transform + watershed.
 * Конвейер: бинаризация (Otsu) → выделение стен (крупные связные компоненты, отсев
 * текста/мебели) → footprint (исключение «улицы») → distance transform по внутренней
 * области → локальные максимумы = центры комнат → watershed (деление по проёмам) →
 * слияние соседних регионов без стены между ними → полигоны комнат (контуры).
 *
 * Требует загруженного глобального `cv` (OpenCV.js), см. vendor/opencv.js.
 *
 * Известные ограничения базового варианта (закрываются ручной правкой в редакторе):
 *  - открытые зоны без стены между ними объединяются (напр. кухня+прихожая);
 *  - маленькие санузлы с плотной сантехникой могут захватываться частично;
 *  - контуры идут по внутренней грани стены, у дверных проёмов возможны неровности.
 *
 * API:
 *   const res = EPRoomSeg.segment(imageEl, opts?);
 *   // res = { W, H, natW, natH, rooms: [{ id, polygon:[{x,y}...], areaPx }] }
 *   // polygon — в координатах анализа (W×H). Перевод в холст — mapPolygon().
 *   EPRoomSeg.mapPolygon(poly, res, canvasW, canvasH) // → точки в координатах холста (object-fit:contain)
 */
(function () {
  "use strict";

  const DEFAULTS = {
    analysisW: 900,     // ширина анализа (даунскейл плана)
    closeK: 3,          // замыкание штриховки/двойных стен
    spanFrac: 0.33,     // компонент-стена должен тянуться на долю плана
    areaFrac: 0.004,    // и иметь минимальную площадь
    footSeal: 21,       // запечатывание проёмов внешней стены (отрезать улицу)
    roiPad: 40,         // отступ вокруг контура здания — всё за пределами не анализируется
    peakR: 34,          // радиус подавления максимумов (мин. разделение комнат)
    minPeak: 7,         // мин. «глубина» комнаты, px
    wallThr: 0.35,      // слить регионы, если доля общей границы на стене < порога
    minRoomFrac: 0.006, // отбросить регионы меньше доли площади
    minContourFrac: 0.003,
    openK: 11,          // сглаживание маски комнаты: убирает наросты (мебель/дуги)
    closeK2: 19,        // и заполняет выемки (дверное полотно «откусывает» кусок комнаты)
    wallLineFrac: 0.15, // доля ширины/высоты, определяющая «линию стены» в гистограмме
    snapTol: 12         // допуск привязки вершин полигона к линиям стен, px
  };

  function assertCv() {
    if (typeof cv === "undefined" || !cv.Mat) {
      throw new Error("OpenCV.js (cv) не загружен — подключите vendor/opencv.js");
    }
  }

  // Координаты горизонтальных/вертикальных линий стен по гистограмме (сумма стеновых
  // пикселей в строке/столбце). Используются, чтобы «притянуть» контуры комнат к
  // реальным стенам — прямые линии вместо органичных кривых.
  function computeWallLines(wall, W, H, frac) {
    const rowSum = new Float32Array(H), colSum = new Float32Array(W);
    for (let y = 0; y < H; y++) { let s = 0; const base = y * W; for (let x = 0; x < W; x++) if (wall[base + x]) s++; rowSum[y] = s; }
    for (let x = 0; x < W; x++) { let s = 0; for (let y = 0; y < H; y++) if (wall[y * W + x]) s++; colSum[x] = s; }
    const cluster = (limit, sumArr) => {
      const cand = [];
      for (let i = 0; i < limit; i++) if (sumArr[i] >= frac * (sumArr === rowSum ? W : H)) cand.push(i);
      const lines = [];
      let i = 0;
      while (i < cand.length) {
        let j = i;
        while (j + 1 < cand.length && cand[j + 1] - cand[j] <= 4) j++;
        let best = cand[i], bestVal = sumArr[cand[i]];
        for (let k = i; k <= j; k++) if (sumArr[cand[k]] > bestVal) { bestVal = sumArr[cand[k]]; best = cand[k]; }
        lines.push(best);
        i = j + 1;
      }
      return lines;
    };
    return { hLines: cluster(H, rowSum), vLines: cluster(W, colSum) };
  }

  // Принудительно делает каждое ребро полигона горизонтальным или вертикальным
  // (по доминирующей проекции исходного ребра).
  function forceOrthogonal(poly) {
    const n = poly.length;
    if (n < 3) return poly.slice();
    const out = new Array(n);
    out[0] = { x: poly[0].x, y: poly[0].y };
    for (let i = 1; i < n; i++) {
      const prevOrig = poly[i - 1], curOrig = poly[i];
      const dx = Math.abs(curOrig.x - prevOrig.x), dy = Math.abs(curOrig.y - prevOrig.y);
      out[i] = (dx >= dy) ? { x: curOrig.x, y: out[i - 1].y } : { x: out[i - 1].x, y: curOrig.y };
    }
    return out;
  }

  // Притягивает координаты вершин к ближайшей линии стены (если в пределах допуска).
  // Заодно «чинит» несостыковку от однонаправленного forceOrthogonal: соседние
  // комнаты с общей стеной после снапа получают одинаковую координату.
  function snapToWallLines(poly, hLines, vLines, tol) {
    const snap1 = (v, lines) => {
      let best = null, bd = Infinity;
      for (const l of lines) { const d = Math.abs(v - l); if (d < bd) { bd = d; best = l; } }
      return (best !== null && bd <= tol) ? best : v;
    };
    return poly.map((p) => ({ x: snap1(p.x, vLines), y: snap1(p.y, hLines) }));
  }

  // Убирает дубликаты вершин и схлопывает подряд идущие коллинеарные рёбра
  // (после forceOrthogonal/snap могут появиться лишние точки на одной прямой).
  function simplifyOrthogonal(poly) {
    let pts = poly.filter((p, i) => {
      const q = poly[(i - 1 + poly.length) % poly.length];
      return Math.hypot(p.x - q.x, p.y - q.y) > 0.75;
    });
    if (pts.length < 3) return pts;
    let changed = true, guard = 0;
    while (changed && guard++ < 25) {
      changed = false;
      const n = pts.length, next = [];
      for (let i = 0; i < n; i++) {
        const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
        const collinearH = Math.abs(a.y - b.y) < 0.75 && Math.abs(b.y - c.y) < 0.75;
        const collinearV = Math.abs(a.x - b.x) < 0.75 && Math.abs(b.x - c.x) < 0.75;
        if ((collinearH || collinearV) && n > 4) { changed = true; continue; }
        next.push(b);
      }
      if (next.length >= 3) pts = next; else break;
    }
    return pts;
  }

  // Полный конвейер «выпрямления»: ортогонализация → привязка к стенам → упрощение.
  function orthogonalize(poly, hLines, vLines, snapTol) {
    const ortho = forceOrthogonal(poly);
    const snapped = snapToWallLines(ortho, hLines, vLines, snapTol);
    return simplifyOrthogonal(snapped);
  }

  function segment(imageEl, opts) {
    assertCv();
    const o = Object.assign({}, DEFAULTS, opts || {});
    const natW = imageEl.naturalWidth, natH = imageEl.naturalHeight;
    const W = o.analysisW, sc = W / natW, H = Math.round(natH * sc), N = W * H;

    const cnv = document.createElement("canvas");
    cnv.width = W; cnv.height = H;
    const cx = cnv.getContext("2d");
    cx.fillStyle = "#fff"; cx.fillRect(0, 0, W, H);
    cx.drawImage(imageEl, 0, 0, W, H);

    const mats = [];
    const M = (m) => { mats.push(m); return m; };
    const src = M(cv.matFromImageData(cx.getImageData(0, 0, W, H)));
    const gray = M(new cv.Mat()); cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    const bw = M(new cv.Mat()); cv.threshold(gray, bw, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
    cv.morphologyEx(bw, bw, cv.MORPH_CLOSE, M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(o.closeK, o.closeK))));

    // выделение сети стен
    const lab = M(new cv.Mat()), stats = M(new cv.Mat()), cent = M(new cv.Mat());
    const nc = cv.connectedComponentsWithStats(bw, lab, stats, cent, 8);
    const L = lab.data32S, wall = new Uint8Array(N), keep = new Uint8Array(nc);
    // bbox самой «весомой» (по площади, не по протяжённости) стеновой компоненты — это и есть
    // контур здания. Рамка листа тоже проходит span/area-фильтр (протяжённость на весь лист),
    // но у неё площадь на порядок меньше настоящей сети стен, поэтому по area её не спутать.
    let wallBestArea = -1, wallBx1 = 0, wallBy1 = 0, wallBx2 = W, wallBy2 = H;
    for (let i = 1; i < nc; i++) {
      const a = stats.intAt(i, cv.CC_STAT_AREA), cw = stats.intAt(i, cv.CC_STAT_WIDTH), ch = stats.intAt(i, cv.CC_STAT_HEIGHT);
      keep[i] = ((Math.max(cw / W, ch / H) >= o.spanFrac) && a >= N * o.areaFrac) ? 1 : 0;
      if (keep[i] && a > wallBestArea) {
        wallBestArea = a;
        const left = stats.intAt(i, cv.CC_STAT_LEFT), top = stats.intAt(i, cv.CC_STAT_TOP);
        wallBx1 = left; wallBy1 = top; wallBx2 = left + cw; wallBy2 = top + ch;
      }
    }
    for (let p = 0; p < N; p++) if (L[p] && keep[L[p]]) wall[p] = 255;

    const wallMat = M(new cv.Mat(H, W, cv.CV_8UC1)); wallMat.data.set(wall);
    const barMat = M(new cv.Mat()); wallMat.copyTo(barMat);
    cv.dilate(barMat, barMat, M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3))));
    const BAR = barMat.data;

    // footprint: залить «улицу» от края по запечатанным стенам → внутренняя область
    const wf = M(new cv.Mat());
    cv.morphologyEx(wallMat, wf, cv.MORPH_CLOSE, M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(o.footSeal, o.footSeal))));
    const WF = wf.data, ext = new Uint8Array(N), stk = new Int32Array(N);
    let sp = 0;
    const push = (p) => { if (!WF[p] && !ext[p]) { ext[p] = 1; stk[sp++] = p; } };
    for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
    while (sp) { const p = stk[--sp], x = p % W, y = (p / W) | 0; if (x > 0) push(p - 1); if (x < W - 1) push(p + 1); if (y > 0) push(p - W); if (y < H - 1) push(p + W); }
    const interior = new Uint8Array(N);
    for (let p = 0; p < N; p++) interior[p] = (!ext[p] && !BAR[p]) ? 255 : 0;

    // ROI вокруг контура здания: если рамка листа проходит впритык к краю холста, посев заливки
    // «улицы» с границ изображения (см. push выше) блокируется этой рамкой в первом же пикселе и
    // не растекается вовсе — тогда весь фон листа (поля, легенда, штамп) ошибочно считается
    // внутренним пространством. Обрезка по bbox самой крупной стеновой компоненты не зависит от
    // того, сработала заливка или нет, и заодно отбрасывает любую графику за пределами здания
    // (таблицы, экспликацию, штамп), даже если она сама похожа на «комнату».
    if (wallBestArea > 0) {
      const rx1 = Math.max(0, wallBx1 - o.roiPad), ry1 = Math.max(0, wallBy1 - o.roiPad);
      const rx2 = Math.min(W, wallBx2 + o.roiPad), ry2 = Math.min(H, wallBy2 + o.roiPad);
      for (let y = 0; y < H; y++) {
        if (y >= ry1 && y < ry2) continue;
        const base = y * W;
        for (let x = 0; x < W; x++) interior[base + x] = 0;
      }
      for (let y = ry1; y < ry2; y++) {
        const base = y * W;
        for (let x = 0; x < rx1; x++) interior[base + x] = 0;
        for (let x = rx2; x < W; x++) interior[base + x] = 0;
      }
    }

    // distance transform + локальные максимумы (центры комнат)
    const free = M(new cv.Mat(H, W, cv.CV_8UC1)); free.data.set(interior);
    const dist = M(new cv.Mat()); cv.distanceTransform(free, dist, cv.DIST_L2, 5);
    const distDil = M(new cv.Mat());
    cv.dilate(dist, distDil, M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2 * o.peakR + 1, 2 * o.peakR + 1))));
    const DF = dist.data32F, DD = distDil.data32F, peaks = M(new cv.Mat(H, W, cv.CV_8UC1)), PK = peaks.data;
    for (let p = 0; p < N; p++) PK[p] = (DF[p] > o.minPeak && DF[p] >= DD[p] - 0.5) ? 255 : 0;
    const ccm = M(new cv.Mat()); cv.connectedComponents(peaks, ccm, 8); const CCL = ccm.data32S;

    // маркеры → watershed
    const markers = M(new cv.Mat(H, W, cv.CV_32S)); const MK = markers.data32S;
    for (let p = 0; p < N; p++) {
      if (!interior[p]) MK[p] = 1;
      else if (CCL[p] > 0) MK[p] = CCL[p] + 1;
      else MK[p] = 0;
    }
    const src3 = M(new cv.Mat()); cv.cvtColor(src, src3, cv.COLOR_RGBA2RGB);
    cv.watershed(src3, markers);

    // слияние регионов без стены между ними
    const tot = {}, onw = {}, key = (a, b) => a < b ? a * 100000 + b : b * 100000 + a;
    for (let p = 0; p < N; p++) {
      if (MK[p] !== -1) continue;
      const set = new Set();
      for (const q of [p - 1, p + 1, p - W, p + W]) { if (q < 0 || q >= N) continue; if (MK[q] >= 2) set.add(MK[q]); }
      const arr = [...set];
      for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
        const kk = key(arr[i], arr[j]); tot[kk] = (tot[kk] || 0) + 1; if (BAR[p]) onw[kk] = (onw[kk] || 0) + 1;
      }
    }
    const par = {}, find = (a) => { while (par[a] !== undefined && par[a] !== a) a = par[a] = par[par[a]] ?? par[a]; return a; };
    const uni = (a, b) => { par[a] = par[a] ?? a; par[b] = par[b] ?? b; const ra = find(a), rb = find(b); if (ra !== rb) par[rb] = ra; };
    for (const kk in tot) { const a = Math.floor(kk / 100000), b = kk % 100000; if ((onw[kk] || 0) / tot[kk] < o.wallThr) uni(a, b); }
    for (let p = 0; p < N; p++) if (MK[p] >= 2) { par[MK[p]] = par[MK[p]] ?? MK[p]; MK[p] = find(MK[p]); }

    // площади и полигоны
    const area = {};
    for (let p = 0; p < N; p++) { const l = MK[p]; if (l >= 2) area[l] = (area[l] || 0) + 1; }
    const labels = Object.keys(area).map(Number).filter((l) => area[l] >= N * o.minRoomFrac);

    // линии реальных стен — контуры комнат будут притянуты к ним (прямые линии вместо кривых)
    const { hLines, vLines } = computeWallLines(wall, W, H, o.wallLineFrac);

    const rooms = [];
    const maskMat = M(new cv.Mat(H, W, cv.CV_8UC1));
    const openKernel = M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(o.openK, o.openK)));
    const closeKernel2 = M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(o.closeK2, o.closeK2)));
    labels.forEach((l) => {
      const md = maskMat.data;
      for (let p = 0; p < N; p++) md[p] = (MK[p] === l) ? 255 : 0;
      // сглаживание маски ДО векторизации — надёжнее, чем чинить уже кривую линию постфактум:
      // close заполняет выемки (дверное полотно «откусывает» кусок комнаты),
      // open убирает наросты (мебель, дверные дуги)
      cv.morphologyEx(maskMat, maskMat, cv.MORPH_CLOSE, closeKernel2);
      cv.morphologyEx(maskMat, maskMat, cv.MORPH_OPEN, openKernel);
      const cnts = new cv.MatVector(), hi = new cv.Mat();
      cv.findContours(maskMat, cnts, hi, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      let best = null, bestA = 0;
      for (let c = 0; c < cnts.size(); c++) { const ct = cnts.get(c); const a = cv.contourArea(ct); if (a > bestA) { bestA = a; best = c; } }
      if (best !== null && bestA >= N * o.minContourFrac) {
        const ap = new cv.Mat(); cv.approxPolyDP(cnts.get(best), ap, 3, true);
        const P = ap.data32S; let raw = [];
        for (let j = 0; j < P.length; j += 2) raw.push({ x: P[j], y: P[j + 1] });
        ap.delete();
        const poly = orthogonalize(raw, hLines, vLines, o.snapTol);
        if (poly.length >= 3) rooms.push({ id: "room_" + l, polygon: poly, areaPx: area[l] });
      }
      cnts.delete(); hi.delete();
    });

    mats.forEach((m) => { try { m.delete(); } catch (e) {} });
    return { W, H, natW, natH, rooms, hLines, vLines };
  }

  // Перевод полигона из координат анализа (res.W×res.H) в координаты холста
  // с учётом object-fit:contain (как показывается #planImage).
  function mapPolygon(poly, res, canvasW, canvasH) {
    const disp = Math.min(canvasW / res.natW, canvasH / res.natH);
    const dispW = res.natW * disp, dispH = res.natH * disp;
    const offX = (canvasW - dispW) / 2, offY = (canvasH - dispH) / 2;
    return poly.map((pt) => ({
      x: offX + (pt.x / res.W) * dispW,
      y: offY + (pt.y / res.H) * dispH
    }));
  }

  window.EPRoomSeg = { segment, mapPolygon, DEFAULTS, orthogonalize, computeWallLines };
})();
