/**
 * ElectroPlan — ML-распознавание планов (YOLOv8 в браузере).
 *
 * «Умный» режим (Шаг 2): вместо классического CV (js/roomSegmentation.js) детектирует
 * стены/двери/окна нейросетью YOLOv8 через onnxruntime-web (WebGPU с фолбэком на WASM),
 * затем собирает комнаты из детекций (барьерная карта дверей/стён → connected components →
 * полигоны). Надёжнее классики на «грязных» дизайн-планах (тонкие серые стены + мебель),
 * где Otsu-бинаризация не выделяет стены.
 *
 * Требует OpenCV.js (`cv`) для морфологии/контуров — грузится тем же vendor/opencv.js, что и
 * классический режим; и onnxruntime-web из vendor/ort/. Обе зависимости — ленивая загрузка.
 *
 * API:
 *   await EPFloorplanML.ensureReady({onProgress});           // прогрев (ort + модель + cv)
 *   const det = await EPFloorplanML.detect(imgEl, {conf});   // сырые детекции (коорд. изображения)
 *   const res = await EPFloorplanML.segmentRooms(imgEl, {onProgress});
 *   //   res = { natW, natH, W, H, rooms:[{id, polygon:[{x,y}], areaPx}], detections }
 *   //   polygon — в координатах анализа (W×H). Перевод в холст — EPFloorplanML.mapPolygon().
 */
(function () {
  "use strict";

  const CLASS_NAMES = ["Column", "Curtain Wall", "Dimension", "Door", "Railing", "Sliding Door", "Stair Case", "Wall", "Window"];
  const MODEL_URL = "vendor/models/floorplan-yolo.onnx";
  const ORT_URL = "vendor/ort/ort.webgpu.bundle.min.js";
  const ORT_WASM_MODULE_URL = "vendor/ort/ort-wasm-simd-threaded.asyncify.js";
  const ORT_WASM_BINARY_URL = "vendor/ort/ort-wasm-simd-threaded.asyncify.wasm";
  const OPENCV_URL = "vendor/opencv.js";
  const ML_RUNTIME_VERSION = "20260723.3";
  const scriptUrl = document.currentScript && document.currentScript.src
    ? new URL(document.currentScript.src)
    : new URL("js/floorplanML.js", document.baseURI);
  const assetBaseUrl = new URL("../", scriptUrl);
  const IMGSZ = 1024;               // фиксированный вход модели
  const BASE_CONF = 0.10;           // низкий порог на детекции; отсев — per-class ниже
  const NMS_IOU = 0.45;

  // Пороги уверенности по классам (из отладки .tmp-yolo-rooms.py) — конструктив.
  const CLASS_CONF = { Wall: 0.12, Door: 0.24, "Sliding Door": 0.20, Window: 0.15, Column: 0.18, "Curtain Wall": 0.15, Railing: 0.20 };

  const DEFAULTS = {
    analysisW: 1000,     // ширина растеризации барьерной карты
    clusterGap: 50,      // склейка близких боксов конструктива в одну «сеть» (доля от 1000px)
    roiPad: 34,          // отступ ROI вокруг конструктива
    doorThick: 10,       // толщина «запечатывающей» линии дверного проёма
    closeK: 14,          // морфология барьера: замыкание разрывов стен
    dilateK: 5,          // утолщение барьера
    minRoomFrac: 0.006,  // мин. площадь комнаты (доля площади ROI)
    openK: 9,            // сглаживание маски комнаты (наросты)
    closeK2: 17,         // и заполнение выемок
    wallLineFrac: 0.12,  // доля для «линии стены» при ортогонализации
    snapTol: 14          // допуск привязки вершин к линиям стен
  };

  let _ort = null, _ortPromise = null;
  let _session = null, _sessionPromise = null, _backend = null;
  let _cvPromise = null;

  function assetUrl(relativePath, versioned) {
    const url = new URL(relativePath, assetBaseUrl);
    if (versioned) url.searchParams.set("v", ML_RUNTIME_VERSION);
    return url;
  }

  async function importOrtModule(moduleUrl) {
    try {
      return await import(moduleUrl.href);
    } catch (directImportError) {
      // Some local IDE servers return ES module files with an unsupported MIME type.
      // Fetching the same source and importing a JavaScript Blob keeps the
      // runtime self-hosted and avoids depending on server MIME configuration.
      let response;
      try {
        response = await fetch(moduleUrl.href, {
          cache: "reload",
          credentials: "same-origin"
        });
      } catch (fetchError) {
        throw new Error(
          "Не удалось загрузить локальный модуль распознавания. Проверьте, что папка vendor/ort доступна через веб-сервер.",
          { cause: fetchError }
        );
      }

      if (!response.ok) {
        throw new Error(
          `Файл модуля распознавания недоступен: HTTP ${response.status} (${moduleUrl.pathname})`,
          { cause: directImportError }
        );
      }

      const source = await response.text();
      if (/^\s*</.test(source)) {
        throw new Error(
          `Вместо JavaScript-модуля сервер вернул HTML (${moduleUrl.pathname})`,
          { cause: directImportError }
        );
      }

      const blobUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
      try {
        return await import(blobUrl);
      } catch (blobImportError) {
        throw new Error(
          "Модуль ONNX Runtime загружен, но браузер не смог его выполнить.",
          { cause: blobImportError }
        );
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    }
  }

  function ensureCv(onProgress) {
    if (window.cv && window.cv.Mat) return Promise.resolve();
    if (_cvPromise) return _cvPromise;
    _cvPromise = new Promise((resolve, reject) => {
      const waitReady = () => { const t0 = Date.now(); (function chk() { if (window.cv && window.cv.Mat) resolve(); else if (Date.now() - t0 > 60000) reject(new Error("Таймаут инициализации OpenCV")); else setTimeout(chk, 80); })(); };
      const s = document.createElement("script");
      s.src = assetUrl(OPENCV_URL, true).href;
      s.onload = () => { if (window.cv && typeof window.cv.then === "function") window.cv.then(() => waitReady()); waitReady(); };
      s.onerror = () => reject(new Error("Не удалось загрузить vendor/opencv.js"));
      document.head.appendChild(s);
    });
    _cvPromise.catch(() => { _cvPromise = null; });
    return _cvPromise;
  }

  function ensureOrt() {
    if (_ort) return Promise.resolve(_ort);
    if (_ortPromise) return _ortPromise;
    const moduleUrl = assetUrl(ORT_URL, true);
    _ortPromise = importOrtModule(moduleUrl)
      .then((ort) => {
        ort.env.wasm.wasmPaths = {
          mjs: assetUrl(ORT_WASM_MODULE_URL, true).href,
          wasm: assetUrl(ORT_WASM_BINARY_URL, true).href
        };
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.proxy = false;
        _ort = ort;
        return ort;
      })
      .catch((error) => {
        _ortPromise = null;
        throw error;
      });
    return _ortPromise;
  }

  function ensureSession(onProgress) {
    if (_session) return Promise.resolve(_session);
    if (_sessionPromise) return _sessionPromise;
    _sessionPromise = (async () => {
      const ort = await ensureOrt();
      onProgress && onProgress("Загрузка модели распознавания (~100 МБ, кэшируется)");
      const url = assetUrl(MODEL_URL).href;
      try {
        _session = await ort.InferenceSession.create(url, { executionProviders: ["webgpu"] });
        _backend = "webgpu";
      } catch (e) {
        onProgress && onProgress("WebGPU недоступен — переключаюсь на WASM");
        _session = await ort.InferenceSession.create(url, { executionProviders: ["wasm"] });
        _backend = "wasm";
      }
      return _session;
    })().catch((error) => {
      _sessionPromise = null;
      throw error;
    });
    return _sessionPromise;
  }

  async function ensureReady(opts) {
    const onProgress = opts && opts.onProgress;
    await ensureOrt();
    await ensureSession(onProgress);
    await ensureCv(onProgress);
    return { backend: _backend };
  }

  // ---- препроцесс: letterbox исходного изображения в квадрат IMGSZ ----
  function letterbox(imageEl) {
    const w = imageEl.naturalWidth, h = imageEl.naturalHeight;
    const r = Math.min(IMGSZ / w, IMGSZ / h);
    const nw = Math.round(w * r), nh = Math.round(h * r);
    const px = (IMGSZ - nw) >> 1, py = (IMGSZ - nh) >> 1;
    const c = document.createElement("canvas"); c.width = IMGSZ; c.height = IMGSZ;
    const x = c.getContext("2d");
    x.fillStyle = "rgb(114,114,114)"; x.fillRect(0, 0, IMGSZ, IMGSZ);
    x.drawImage(imageEl, px, py, nw, nh);
    return { data: x.getImageData(0, 0, IMGSZ, IMGSZ).data, r, px, py };
  }

  function nms(boxes, scores, iouThr) {
    const idx = [...scores.keys()].sort((a, b) => scores[b] - scores[a]);
    const keep = [];
    while (idx.length) {
      const i = idx.shift(); keep.push(i);
      for (let k = idx.length - 1; k >= 0; k--) {
        const j = idx[k];
        const xx1 = Math.max(boxes[i][0], boxes[j][0]), yy1 = Math.max(boxes[i][1], boxes[j][1]);
        const xx2 = Math.min(boxes[i][2], boxes[j][2]), yy2 = Math.min(boxes[i][3], boxes[j][3]);
        const w = Math.max(0, xx2 - xx1), hh = Math.max(0, yy2 - yy1), inter = w * hh;
        const ai = (boxes[i][2] - boxes[i][0]) * (boxes[i][3] - boxes[i][1]);
        const aj = (boxes[j][2] - boxes[j][0]) * (boxes[j][3] - boxes[j][1]);
        if (inter / (ai + aj - inter + 1e-9) > iouThr) idx.splice(k, 1);
      }
    }
    return keep;
  }

  // ---- детекция: возвращает боксы в координатах ИСХОДНОГО изображения ----
  async function detect(imageEl, opts) {
    const conf = (opts && opts.conf != null) ? opts.conf : BASE_CONF;
    const sess = await ensureSession(opts && opts.onProgress);
    const ort = _ort;
    const natW = imageEl.naturalWidth, natH = imageEl.naturalHeight;
    const { data, r, px, py } = letterbox(imageEl);
    const N = IMGSZ * IMGSZ, f = new Float32Array(3 * N);
    for (let i = 0; i < N; i++) { f[i] = data[i * 4] / 255; f[N + i] = data[i * 4 + 1] / 255; f[2 * N + i] = data[i * 4 + 2] / 255; }
    const out = await sess.run({ [sess.inputNames[0]]: new ort.Tensor("float32", f, [1, 3, IMGSZ, IMGSZ]) });
    const o = out[sess.outputNames[0]];
    const ch = o.dims[1], n = o.dims[2], d = o.data; // [1, 4+numCls, n]
    const byCls = {};
    for (let i = 0; i < n; i++) {
      let best = -1, bc = -1;
      for (let c = 4; c < ch; c++) { const v = d[c * n + i]; if (v > best) { best = v; bc = c - 4; } }
      if (best < conf) continue;
      const cx = d[i], cy = d[n + i], ww = d[2 * n + i], hh = d[3 * n + i];
      let x1 = (cx - ww / 2 - px) / r, y1 = (cy - hh / 2 - py) / r, x2 = (cx + ww / 2 - px) / r, y2 = (cy + hh / 2 - py) / r;
      x1 = Math.max(0, Math.min(natW, x1)); x2 = Math.max(0, Math.min(natW, x2));
      y1 = Math.max(0, Math.min(natH, y1)); y2 = Math.max(0, Math.min(natH, y2));
      (byCls[bc] = byCls[bc] || { b: [], s: [] }); byCls[bc].b.push([x1, y1, x2, y2]); byCls[bc].s.push(best);
    }
    const detections = [];
    for (const c in byCls) {
      const keep = nms(byCls[c].b, byCls[c].s, NMS_IOU);
      for (const i of keep) detections.push({ cls: +c, name: CLASS_NAMES[c], score: byCls[c].s[i], box: byCls[c].b[i] });
    }
    return { detections, natW, natH, backend: _backend };
  }

  // union-find для кластеризации конструктива
  function makeUF(n) {
    const p = [...Array(n).keys()];
    const find = (i) => { while (p[i] !== i) { p[i] = p[p[i]]; i = p[i]; } return i; };
    const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) p[b] = a; };
    return { find, uni };
  }
  function boxGap(a, b) {
    const dx = Math.max(b[0] - a[2], a[0] - b[2], 0);
    const dy = Math.max(b[1] - a[3], a[1] - b[3], 0);
    return Math.hypot(dx, dy);
  }

  // ---- сборка комнат из детекций (порт .tmp-yolo-rooms.py) ----
  async function segmentRooms(imageEl, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const onProgress = opts && opts.onProgress;
    await ensureCv(onProgress);
    const { detections, natW, natH } = await detect(imageEl, { onProgress, conf: BASE_CONF });

    // отсев по per-class порогам; конструктив = стены/окна/колонны/двери
    const structuralNames = new Set(["Wall", "Window", "Column", "Curtain Wall", "Door", "Sliding Door", "Railing"]);
    const kept = detections.filter((det) => {
      const thr = CLASS_CONF[det.name] != null ? CLASS_CONF[det.name] : 0.25;
      return structuralNames.has(det.name) && det.score >= thr;
    });
    if (!kept.length) return { natW, natH, W: o.analysisW, H: Math.round(natH * o.analysisW / natW), rooms: [], detections };

    // масштаб в координаты анализа
    const W = o.analysisW, s = W / natW, H = Math.round(natH * s), N = W * H;
    const dets = kept.map((det) => ({ name: det.name, score: det.score, box: det.box.map((v, i) => v * s) }));

    // кластеризация: наибольшая связная группа боксов = «сеть конструктива» (отсекает
    // случайные детекции на легенде/штампе далеко от плана)
    const uf = makeUF(dets.length);
    for (let i = 0; i < dets.length; i++) for (let j = i + 1; j < dets.length; j++) {
      if (boxGap(dets[i].box, dets[j].box) <= o.clusterGap) uf.uni(i, j);
    }
    const groups = {};
    dets.forEach((d, i) => { const r = uf.find(i); (groups[r] = groups[r] || []).push(d); });
    const structural = Object.values(groups).sort((a, b) => (b.length - a.length) || (b.reduce((s, d) => s + d.score, 0) - a.reduce((s, d) => s + d.score, 0)))[0];

    // ROI по конструктиву
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    structural.forEach((d) => { x1 = Math.min(x1, d.box[0]); y1 = Math.min(y1, d.box[1]); x2 = Math.max(x2, d.box[2]); y2 = Math.max(y2, d.box[3]); });
    const rx1 = Math.max(0, Math.floor(x1 - o.roiPad)), ry1 = Math.max(0, Math.floor(y1 - o.roiPad));
    const rx2 = Math.min(W, Math.ceil(x2 + o.roiPad)), ry2 = Math.min(H, Math.ceil(y2 + o.roiPad));

    const mats = [];
    const M = (m) => { mats.push(m); return m; };
    try {
      // барьерная карта: боксы стен/окон/колонн — заливка; двери — «запечатывающая» линия
      const barrier = M(new cv.Mat.zeros(H, W, cv.CV_8UC1));
      const walls = structural.filter((d) => d.name === "Wall" || d.name === "Curtain Wall");
      const wallMask = new Uint8Array(N);
      structural.forEach((d) => {
        if (["Wall", "Window", "Column", "Curtain Wall", "Railing"].includes(d.name)) {
          const bx1 = Math.round(d.box[0]), by1 = Math.round(d.box[1]), bx2 = Math.round(d.box[2]), by2 = Math.round(d.box[3]);
          cv.rectangle(barrier, new cv.Point(bx1, by1), new cv.Point(bx2, by2), new cv.Scalar(255), -1);
          if (d.name === "Wall" || d.name === "Curtain Wall") {
            for (let y = Math.max(0, by1); y < Math.min(H, by2); y++) for (let x = Math.max(0, bx1); x < Math.min(W, bx2); x++) wallMask[y * W + x] = 1;
          }
        }
      });
      // двери — линия поперёк проёма (ориентация по ближайшей стене)
      structural.forEach((d) => {
        if (d.name !== "Door" && d.name !== "Sliding Door") return;
        const [bx1, by1, bx2, by2] = d.box, cx = (bx1 + bx2) / 2, cy = (by1 + by2) / 2;
        let bestH = 1e9, bestV = 1e9;
        walls.forEach((w) => {
          const wcx = (w.box[0] + w.box[2]) / 2, wcy = (w.box[1] + w.box[3]) / 2;
          if (w.box[0] < bx2 + 30 && w.box[2] > bx1 - 30) bestH = Math.min(bestH, Math.abs(wcy - cy));
          if (w.box[1] < by2 + 30 && w.box[3] > by1 - 30) bestV = Math.min(bestV, Math.abs(wcx - cx));
        });
        if (bestH <= bestV) cv.line(barrier, new cv.Point(Math.round(bx1), Math.round(cy)), new cv.Point(Math.round(bx2), Math.round(cy)), new cv.Scalar(255), o.doorThick);
        else cv.line(barrier, new cv.Point(Math.round(cx), Math.round(by1)), new cv.Point(Math.round(cx), Math.round(by2)), new cv.Scalar(255), o.doorThick);
      });
      cv.morphologyEx(barrier, barrier, cv.MORPH_CLOSE, M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(o.closeK, o.closeK))));
      cv.dilate(barrier, barrier, M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(o.dilateK, o.dilateK))));
      const BAR = barrier.data;

      // свободное пространство внутри ROI
      const free = M(new cv.Mat.zeros(H, W, cv.CV_8UC1)); const FR = free.data;
      for (let y = ry1; y < ry2; y++) { const base = y * W; for (let x = rx1; x < rx2; x++) FR[base + x] = BAR[base + x] ? 0 : 255; }

      const lab = M(new cv.Mat()), stats = M(new cv.Mat()), cent = M(new cv.Mat());
      const nc = cv.connectedComponentsWithStats(free, lab, stats, cent, 4);
      const LB = lab.data32S;
      const roiArea = (rx2 - rx1) * (ry2 - ry1);
      const roomLabels = [];
      for (let i = 1; i < nc; i++) {
        const sx = stats.intAt(i, cv.CC_STAT_LEFT), sy = stats.intAt(i, cv.CC_STAT_TOP);
        const sw = stats.intAt(i, cv.CC_STAT_WIDTH), sh = stats.intAt(i, cv.CC_STAT_HEIGHT), area = stats.intAt(i, cv.CC_STAT_AREA);
        const touches = sx <= rx1 + 1 || sy <= ry1 + 1 || sx + sw >= rx2 - 1 || sy + sh >= ry2 - 1;
        if (!touches && area >= roiArea * o.minRoomFrac) roomLabels.push({ label: i, area });
      }

      // линии стен для ортогонализации контуров
      const { hLines, vLines } = EPRoomSeg.computeWallLines(wallMask, W, H, o.wallLineFrac);

      const rooms = [];
      const maskMat = M(new cv.Mat(H, W, cv.CV_8UC1));
      const openKernel = M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(o.openK, o.openK)));
      const closeKernel2 = M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(o.closeK2, o.closeK2)));
      roomLabels.sort((a, b) => b.area - a.area).forEach(({ label, area }) => {
        const md = maskMat.data;
        for (let p = 0; p < N; p++) md[p] = (LB[p] === label) ? 255 : 0;
        cv.morphologyEx(maskMat, maskMat, cv.MORPH_CLOSE, closeKernel2);
        cv.morphologyEx(maskMat, maskMat, cv.MORPH_OPEN, openKernel);
        const cnts = new cv.MatVector(), hi = new cv.Mat();
        cv.findContours(maskMat, cnts, hi, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        let best = null, bestA = 0;
        for (let c = 0; c < cnts.size(); c++) { const a = cv.contourArea(cnts.get(c)); if (a > bestA) { bestA = a; best = c; } }
        if (best !== null && bestA >= roiArea * o.minRoomFrac * 0.6) {
          const ap = new cv.Mat(); cv.approxPolyDP(cnts.get(best), ap, 3, true);
          const P = ap.data32S; const raw = [];
          for (let j = 0; j < P.length; j += 2) raw.push({ x: P[j], y: P[j + 1] });
          ap.delete();
          const poly = EPRoomSeg.orthogonalize(raw, hLines, vLines, o.snapTol);
          if (poly.length >= 3) rooms.push({ id: "mlroom_" + label, polygon: poly, areaPx: area });
        }
        cnts.delete(); hi.delete();
      });

      return { natW, natH, W, H, rooms, detections };
    } finally {
      mats.forEach((m) => { try { m.delete(); } catch (e) {} });
    }
  }

  // перевод полигона (координаты анализа W×H) в координаты холста (object-fit:contain)
  function mapPolygon(poly, res, canvasW, canvasH) {
    return EPRoomSeg.mapPolygon(poly, res, canvasW, canvasH);
  }

  window.EPFloorplanML = { ensureReady, detect, segmentRooms, mapPolygon, CLASS_NAMES, DEFAULTS, get backend() { return _backend; } };
})();
