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
  const BASE_CONF = 0.05;           // низкий порог на детекции; отсев — per-class ниже
  const NMS_IOU = 0.45;

  // Пороги уверенности по классам (из отладки .tmp-yolo-rooms.py) — конструктив.
  // Wall намеренно низкий: боксы стен служат лишь «зоной внимания», точные границы
  // берутся из пикселей чертежа. На conf 0.20 YOLO находит ~21 стену и обводка рвётся,
  // на 0.05 — 42-49 стен и контур почти сплошной (проверено на chertez/639).
  const CLASS_CONF = { Wall: 0.05, Door: 0.24, "Sliding Door": 0.20, Window: 0.15, Column: 0.18, "Curtain Wall": 0.15, Railing: 0.20 };

  const DEFAULTS = {
    analysisW: 1000,     // ширина растеризации
    clusterGap: 50,      // склейка близких боксов конструктива в одну «сеть»
                         // (используется ниже как o.clusterGap — не удалять)
    pad: 8,              // расширение бокса стены при построении зоны внимания
    extendFrac: 0.05,    // продление зоны вдоль оси стены (доля большей стороны листа)
    minWallArea: 60,     // мин. площадь куска стены (отсев засечек и обрывков текста)
    minHit: 20,          // мин. контакт куска с подтверждённой стеной, px
    minHitFrac: 0.05,    // и мин. доля этого контакта
    bridgeFrac: 0.012,   // длина ядра для замыкания разрывов вдоль стены
    peakFrac: 0.012,     // радиус поиска локальных максимумов (затравки комнат)
    mergeThr: 0.5,       // доля общей границы на стене, ниже которой области сливаются
    minEdge: 6,          // мин. длина общей границы, чтобы судить о слиянии
    leakGuard: 0.35,     // доля интерьера, которая обязана уцелеть после отсечения
                         // «улицы»; ниже — считаем, что заливка просочилась внутрь.
                         // 0.55 пробовал — хуже: на 00b комнат 6→3, на 639 заклейка
                         // переставала срабатывать вовсе
    roiPad: 34,          // отступ ROI вокруг конструктива
    minRoomFrac: 0.008,  // мин. площадь комнаты (доля площади ROI)
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
      // сборка отдаёт Promise модуля: его надо дождаться и подменить window.cv
      // результатом, иначе cv.Mat остаётся undefined и сегментация падает
      s.onload = () => {
        if (window.cv && typeof window.cv.then === "function") {
          window.cv.then((mod) => { if (mod) window.cv = mod; waitReady(); },
            (err) => reject(err instanceof Error ? err : new Error("Не удалось инициализировать OpenCV")));
          return;
        }
        waitReady();
      };
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

  // растеризация плана в масштабе анализа — нужны реальные пиксели чертежа
  function rasterize(imageEl, W, H) {
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(imageEl, 0, 0, W, H);
    return c;
  }

  // ---- сборка комнат: YOLO задаёт «где стены», геометрия берётся из пикселей чертежа ----
  //
  // Почему так. Классический CV не отличает стену от дивана (одинаковая толщина и
  // контраст), а YOLO даёт лишь грубые прямоугольники вместо геометрии. Комбинация
  // снимает обе слабости: мебель отсекается, потому что лежит вне зон стен, а линия
  // точная, потому что это пиксели самого рисунка.
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
      // --- 1. тёмные пиксели чертежа (стены + мебель + текст + размеры) ---
      const src = M(cv.imread(rasterize(imageEl, W, H)));
      const gray = M(new cv.Mat()); cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      const dark = M(new cv.Mat()); cv.threshold(gray, dark, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);

      // --- 2. зона внимания из боксов стен + её продление вдоль оси каждой стены ---
      const zone = M(cv.Mat.zeros(H, W, cv.CV_8UC1));
      const zoneExt = M(cv.Mat.zeros(H, W, cv.CV_8UC1));
      const openBoxes = [];
      const E = Math.round(o.extendFrac * Math.max(W, H));
      structural.forEach((d) => {
        const [bx1, by1, bx2, by2] = d.box;
        if (["Wall", "Curtain Wall", "Column"].includes(d.name)) {
          cv.rectangle(zone, new cv.Point(Math.max(0, bx1 - o.pad), Math.max(0, by1 - o.pad)),
            new cv.Point(Math.min(W, bx2 + o.pad), Math.min(H, by2 + o.pad)), new cv.Scalar(255), -1);
          // стена продолжается в своём направлении — там же лежат пропуски YOLO.
          // Штамп и экспликация в стороне от осей стен и в зону не попадают.
          const horiz = (bx2 - bx1) >= (by2 - by1);
          const e1 = horiz ? new cv.Point(Math.max(0, bx1 - E), Math.max(0, by1 - o.pad)) : new cv.Point(Math.max(0, bx1 - o.pad), Math.max(0, by1 - E));
          const e2 = horiz ? new cv.Point(Math.min(W, bx2 + E), Math.min(H, by2 + o.pad)) : new cv.Point(Math.min(W, bx2 + o.pad), Math.min(H, by2 + E));
          cv.rectangle(zoneExt, e1, e2, new cv.Scalar(255), -1);
        } else if (["Door", "Sliding Door", "Window"].includes(d.name)) {
          openBoxes.push([bx1, by1, bx2, by2]);
        }
      });

      // --- 3. точные пиксели стен + добор пропущенных ---
      const confirmed = M(new cv.Mat()); cv.bitwise_and(dark, zone, confirmed);
      const cand = M(new cv.Mat()); cv.bitwise_and(dark, zoneExt, cand);
      const cl = M(new cv.Mat()), cs = M(new cv.Mat()), cc = M(new cv.Mat());
      const cn = cv.connectedComponentsWithStats(cand, cl, cs, cc);
      const CL = cl.data32S, CONF = confirmed.data;
      const cArea = new Int32Array(cn), cHit = new Int32Array(cn);
      for (let p = 0; p < N; p++) { const l = CL[p]; if (l > 0) { cArea[l]++; if (CONF[p]) cHit[l]++; } }
      const keepC = new Uint8Array(cn);
      for (let i = 1; i < cn; i++) {
        if (cArea[i] >= o.minWallArea && cHit[i] >= o.minHit && cHit[i] / cArea[i] >= o.minHitFrac) keepC[i] = 1;
      }
      const walls8 = M(cv.Mat.zeros(H, W, cv.CV_8UC1)); const WD = walls8.data;
      for (let p = 0; p < N; p++) { const l = CL[p]; if (l > 0 && keepC[l]) WD[p] = 255; }

      // --- 4. замыкание разрывов: направленное закрытие, не утолщает стену поперёк ---
      const K = Math.max(5, Math.round(o.bridgeFrac * Math.max(W, H)));
      const bridged = M(walls8.clone());
      const kH = M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(K, 1)));
      const kV = M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, K)));
      const tH = M(new cv.Mat()), tV = M(new cv.Mat());
      cv.morphologyEx(walls8, tH, cv.MORPH_CLOSE, kH);
      cv.morphologyEx(walls8, tV, cv.MORPH_CLOSE, kV);
      cv.bitwise_or(bridged, tH, bridged); cv.bitwise_or(bridged, tV, bridged);
      const BR = bridged.data;
      const wallMask = new Uint8Array(N);
      for (let p = 0; p < N; p++) wallMask[p] = BR[p] ? 1 : 0;

      // --- 5. перемычки в проёмах толщиной со стену (бокс двери шире стены и,
      //        залитый целиком, торчал бы внутрь комнаты, искажая её контур) ---
      const distW = M(new cv.Mat()); cv.distanceTransform(bridged, distW, cv.DIST_L2, 3);
      const DW = distW.data32F, tSam = [];
      for (let p = 0; p < N; p++) if (BR[p] && DW[p] > 0) tSam.push(DW[p]);
      tSam.sort((a, b) => a - b);
      const halfT = tSam.length ? tSam[Math.floor(tSam.length * 0.75)] : 2;
      const bars = M(cv.Mat.zeros(H, W, cv.CV_8UC1));
      const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H) ? BR[y * W + x] : 0;
      for (const [bx1, by1, bx2, by2] of openBoxes) {
        const R = Math.round(Math.max(6, halfT * 4)), t = Math.max(2, Math.round(halfT * 2));
        let left = 0, right = 0, up = 0, down = 0, sumY = 0, cy = 0, sumX = 0, cx = 0;
        for (let y = Math.max(0, by1 | 0); y < Math.min(H, by2 | 0); y++) for (let d = 1; d <= R; d++) {
          if (at((bx1 | 0) - d, y)) { left++; sumY += y; cy++; }
          if (at((bx2 | 0) + d, y)) { right++; sumY += y; cy++; }
        }
        for (let x = Math.max(0, bx1 | 0); x < Math.min(W, bx2 | 0); x++) for (let d = 1; d <= R; d++) {
          if (at(x, (by1 | 0) - d)) { up++; sumX += x; cx++; }
          if (at(x, (by2 | 0) + d)) { down++; sumX += x; cx++; }
        }
        const hz = left + right, vt = up + down;
        if (hz < 8 && vt < 8) {
          // соседних стен не нашли — ориентацию определить нечем. Запечатываем бокс
          // целиком: дыра, через которую сольются два помещения, хуже лишнего угла.
          cv.rectangle(bars, new cv.Point(bx1, by1), new cv.Point(bx2, by2), new cv.Scalar(255), -1);
        } else if (hz >= vt && cy) {
          const yc = Math.round(sumY / cy);
          cv.rectangle(bars, new cv.Point(bx1, yc - t / 2), new cv.Point(bx2, yc + t / 2), new cv.Scalar(255), -1);
        } else if (cx) {
          const xc = Math.round(sumX / cx);
          cv.rectangle(bars, new cv.Point(xc - t / 2, by1), new cv.Point(xc + t / 2, by2), new cv.Scalar(255), -1);
        }
      }

      // --- 6. свободное пространство, «улица», ROI ---
      const barrier = M(new cv.Mat()); cv.bitwise_or(bridged, bars, barrier);
      const free = M(new cv.Mat()); cv.bitwise_not(barrier, free);
      const FR = free.data;
      // ПОРЯДОК ВАЖЕН: заливка «улицы» от края листа идёт ДО обрезки по ROI —
      // иначе край уже обнулён и заливке неоткуда стартовать.
      const freeBefore = FR.slice();
      let inB = 0;
      for (let y = ry1; y < ry2; y++) for (let x = rx1; x < rx2; x++) if (freeBefore[y * W + x]) inB++;

      // Наружная стена нередко разорвана (на chertez/639 — да), и заливка уходит
      // внутрь, съедая все помещения. Поэтому «заклеиваем» барьер утолщением и
      // подбираем минимальное, при котором заливка перестаёт течь внутрь.
      // Утолщение живёт ТОЛЬКО здесь, для поиска улицы: геометрия стен и контуры
      // комнат считаются по неутолщённому барьеру и не искажаются.
      // Попытки идут от самой бережной к самой грубой; берётся первая, при которой
      // заливка не течёт внутрь. «hull» — обводка выпуклой оболочки стеновой сети:
      // замыкает разрыв наружного контура, почти не залезая в помещения, в отличие
      // от утолщения всего барьера (оно съедает интерьер вдоль каждой стены).
      const sealAttempts = ["none", "hull", 5, 11, 21, 35];
      let street = null, sealK = 0, sealMode = "none";
      for (const mode of sealAttempts) {
        let pass = FR;
        if (mode === "hull") {
          const cnts = new cv.MatVector(), hi = M(new cv.Mat());
          cv.findContours(bridged, cnts, hi, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
          let bi = -1, ba = 0;
          for (let i = 0; i < cnts.size(); i++) { const a = cv.contourArea(cnts.get(i)); if (a > ba) { ba = a; bi = i; } }
          if (bi < 0) { cnts.delete(); continue; }
          const hull = M(new cv.Mat());
          cv.convexHull(cnts.get(bi), hull, false, true);
          const hv = new cv.MatVector(); hv.push_back(hull);
          const sealedH = M(barrier.clone());
          cv.drawContours(sealedH, hv, 0, new cv.Scalar(255), Math.max(3, Math.round(halfT * 2)));
          hv.delete(); cnts.delete();
          const HD = sealedH.data, tmp = new Uint8Array(N);
          for (let p = 0; p < N; p++) tmp[p] = HD[p] ? 0 : 1;
          pass = tmp;
        } else if (mode !== "none") {
          const k = mode;
          const sealed = M(new cv.Mat());
          cv.dilate(barrier, sealed, M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(k, k))));
          const SD = sealed.data, tmp = new Uint8Array(N);
          for (let p = 0; p < N; p++) tmp[p] = SD[p] ? 0 : 1;
          pass = tmp;
        }
        const seen = new Uint8Array(N), st = [];
        const push = (p) => { if (pass[p] && !seen[p]) st.push(p); };
        for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
        for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
        while (st.length) {
          const p = st.pop(); if (seen[p]) continue; seen[p] = 1;
          const x = p % W, y = (p - x) / W;
          if (x > 0) push(p - 1); if (x < W - 1) push(p + 1);
          if (y > 0) push(p - W); if (y < H - 1) push(p + W);
        }
        let inA = 0;
        for (let y = ry1; y < ry2; y++) for (let x = rx1; x < rx2; x++) { const p = y * W + x; if (freeBefore[p] && !seen[p]) inA++; }
        if (inA >= inB * o.leakGuard) {
          street = seen; sealMode = String(mode);
          sealK = typeof mode === "number" ? mode : 0;
          break;
        }
      }
      // если не помогло даже максимальное утолщение — оставляем улицу неотсечённой:
      // лишние куски по краям лучше, чем ноль комнат
      if (street) for (let p = 0; p < N; p++) if (street[p]) FR[p] = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < rx1 || x > rx2 || y < ry1 || y > ry2) FR[y * W + x] = 0;

      // --- 7. деление по проёмам (watershed): часть дверей — арки без полотна,
      //        YOLO их не находит, одних перемычек мало ---
      const fd = M(new cv.Mat()); cv.distanceTransform(free, fd, cv.DIST_L2, 5);
      const peakR = Math.max(6, Math.round(o.peakFrac * Math.max(W, H)));
      const kk = M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(peakR * 2 + 1, peakR * 2 + 1)));
      const dil = M(new cv.Mat()); cv.dilate(fd, dil, kk);
      const minPeak = Math.max(4, halfT * 2);
      const peaks = M(cv.Mat.zeros(H, W, cv.CV_8UC1));
      const FD = fd.data32F, DI = dil.data32F, PK = peaks.data;
      for (let p = 0; p < N; p++) if (FR[p] && FD[p] >= DI[p] - 0.01 && FD[p] >= minPeak) PK[p] = 255;
      const mk = M(new cv.Mat()); cv.connectedComponents(peaks, mk);
      const lab = M(new cv.Mat(H, W, cv.CV_32S));
      const MK = mk.data32S, LB = lab.data32S;
      for (let p = 0; p < N; p++) LB[p] = !FR[p] ? 1 : (MK[p] > 0 ? MK[p] + 1 : 0);
      const img3 = M(new cv.Mat()); cv.cvtColor(gray, img3, cv.COLOR_GRAY2RGB);
      cv.watershed(img3, lab);

      // --- 8. слияние областей, между которыми нет стены (watershed режет по каждому
      //        узкому месту и дробит комнату; настоящая граница идёт по стене) ---
      const BARD = barrier.data;
      const parent = new Map();
      const find = (x) => { let r = x; while (parent.get(r) !== r) r = parent.get(r); while (parent.get(x) !== r) { const nx = parent.get(x); parent.set(x, r); x = nx; } return r; };
      const uni2 = (a, b) => { a = find(a); b = find(b); if (a !== b) parent.set(b, a); };
      for (let p = 0; p < N; p++) { const l = LB[p]; if (l > 1 && !parent.has(l)) parent.set(l, l); }
      const adj = new Map();
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const p = y * W + x; if (LB[p] !== -1) continue;
        let a = 0, b = 0, bad = false;
        for (const q of [p - 1, p + 1, p - W, p + W]) {
          const l = LB[q]; if (l <= 1) continue;
          if (!a || a === l) a = l; else if (!b || b === l) b = l; else { bad = true; break; }
        }
        if (bad || !a || !b) continue;
        const k = a < b ? a + "_" + b : b + "_" + a;
        let e = adj.get(k); if (!e) { e = { tot: 0, wall: 0, a, b }; adj.set(k, e); }
        e.tot++; if (BARD[p]) e.wall++;
      }
      for (const e of adj.values()) if (e.tot >= o.minEdge && e.wall / e.tot < o.mergeThr) uni2(e.a, e.b);

      const roiArea = Math.max(1, (rx2 - rx1) * (ry2 - ry1));
      const areaBy = new Map();
      for (let p = 0; p < N; p++) { const l = LB[p]; if (l > 1) { const r = find(l); areaBy.set(r, (areaBy.get(r) || 0) + 1); } }
      const roomLabels = [];
      for (const [label, area] of areaBy) {
        if (area < roiArea * o.minRoomFrac || area > roiArea * 0.92) continue;
        roomLabels.push({ label, area });
      }

      // линии стен для ортогонализации контуров
      const { hLines, vLines } = EPRoomSeg.computeWallLines(wallMask, W, H, o.wallLineFrac);

      const rooms = [];
      const maskMat = M(new cv.Mat(H, W, cv.CV_8UC1));
      const openKernel = M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(o.openK, o.openK)));
      const closeKernel2 = M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(o.closeK2, o.closeK2)));
      roomLabels.sort((a, b) => b.area - a.area).forEach(({ label, area }) => {
        const md = maskMat.data;
        // label — корень union-find, поэтому сравниваем через find()
        for (let p = 0; p < N; p++) { const l = LB[p]; md[p] = (l > 1 && find(l) === label) ? 255 : 0; }
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

      return { natW, natH, W, H, rooms, detections,
        debug: { roiArea, roi: [rx1, ry1, rx2, ry2], halfT, sealK, sealMode, streetCut: !!street,
          wallPx: cv.countNonZero(bridged), barrierPx: cv.countNonZero(barrier),
          openings: openBoxes.length, labels: roomLabels.length,
          labelAreas: roomLabels.map((r) => r.area).slice(0, 12) } };
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
