/**
 * ElectroPlan — локальный импорт планов.
 * PNG/SVG читаются напрямую, PDF растеризуется через PDF.js,
 * DXF преобразуется в чистый геометрический растр, DWG сначала конвертируется в DXF.
 */
(function () {
  "use strict";

  const MAX_FILE_BYTES = 100 * 1024 * 1024;
  const MAX_CAD_POINTS = 300000;
  const RASTER_LONG_SIDE = 3200;
  const scriptUrl = new URL(document.currentScript?.src || "js/planImport.js", document.baseURI);
  const rootUrl = new URL("../", scriptUrl);
  const assetUrl = (path) => new URL(path, rootUrl).href;
  let pdfJsPromise = null;
  let dxfParserPromise = null;
  let dwgConverterPromise = null;

  function extensionOf(file) {
    return String(file?.name || "").split(".").pop().toLowerCase();
  }

  function abortError() {
    try { return new DOMException("Импорт отменён", "AbortError"); }
    catch { const error = new Error("Импорт отменён"); error.name = "AbortError"; return error; }
  }

  function readDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Не удалось прочитать файл плана"));
      reader.readAsDataURL(file);
    });
  }

  async function loadPdfJs() {
    if (!pdfJsPromise) {
      pdfJsPromise = import(assetUrl("vendor/pdfjs/pdf.min.mjs")).then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = assetUrl("vendor/pdfjs/pdf.worker.min.mjs");
        return pdfjs;
      });
    }
    return pdfJsPromise;
  }

  function loadDxfParser() {
    if (window.DxfParser) return Promise.resolve(window.DxfParser);
    if (!dxfParserPromise) {
      dxfParserPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = assetUrl("vendor/dxf-parser/dxf-parser.js");
        script.onload = () => window.DxfParser ? resolve(window.DxfParser) : reject(new Error("DXF-парсер не инициализирован"));
        script.onerror = () => reject(new Error("Не удалось загрузить DXF-парсер"));
        document.head.appendChild(script);
      });
    }
    return dxfParserPromise;
  }

  async function loadDwgConverter() {
    if (!dwgConverterPromise) {
      dwgConverterPromise = import(assetUrl("vendor/dwgdxf/index.js")).then(async (converter) => {
        await converter.init({ wasmBase: assetUrl("vendor/dwgdxf/wasm") });
        return converter;
      });
    }
    return dwgConverterPromise;
  }

  async function importPdf(file, options) {
    const pdfjs = await loadPdfJs();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const loadingTask = pdfjs.getDocument({
      data: bytes,
      cMapUrl: assetUrl("vendor/pdfjs/cmaps/"),
      cMapPacked: true,
      iccUrl: assetUrl("vendor/pdfjs/iccs/"),
      standardFontDataUrl: assetUrl("vendor/pdfjs/standard_fonts/"),
      wasmUrl: assetUrl("vendor/pdfjs/wasm/"),
      useSystemFonts: true
    });
    let pdf = null;
    try {
      pdf = await loadingTask.promise;
      let pageNumber = 1;
      if (pdf.numPages > 1 && typeof options?.selectPdfPage === "function") {
        pageNumber = await options.selectPdfPage(pdf.numPages, file.name);
        if (!pageNumber) throw abortError();
      }
      pageNumber = Math.max(1, Math.min(pdf.numPages, Number(pageNumber) || 1));
      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const maxPixels = 16 * 1024 * 1024;
      let scale = RASTER_LONG_SIDE / Math.max(baseViewport.width, baseViewport.height);
      scale = Math.min(4.5, Math.max(.5, scale));
      if (baseViewport.width * scale * baseViewport.height * scale > maxPixels) {
        scale = Math.sqrt(maxPixels / (baseViewport.width * baseViewport.height));
      }
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const context = canvas.getContext("2d", { alpha: false });
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport, background: "white" }).promise;
      page.cleanup();
      return {
        dataUrl: canvas.toDataURL("image/png"),
        width: canvas.width,
        height: canvas.height,
        format: "PDF",
        detail: `страница ${pageNumber} из ${pdf.numPages}`
      };
    } finally {
      if (pdf && typeof pdf.cleanup === "function") await pdf.cleanup();
      await loadingTask.destroy();
    }
  }

  function decodeDxf(bytes) {
    const utf8 = new TextDecoder("utf-8").decode(bytes);
    const badChars = (utf8.match(/\uFFFD/g) || []).length;
    if (badChars > 2 && typeof TextDecoder !== "undefined") {
      try { return new TextDecoder("windows-1251").decode(bytes); }
      catch {}
    }
    return utf8;
  }

  function multiply(a, b) {
    return [
      a[0] * b[0] + a[2] * b[1],
      a[1] * b[0] + a[3] * b[1],
      a[0] * b[2] + a[2] * b[3],
      a[1] * b[2] + a[3] * b[3],
      a[0] * b[4] + a[2] * b[5] + a[4],
      a[1] * b[4] + a[3] * b[5] + a[5]
    ];
  }

  function transformPoint(matrix, point) {
    const x = Number(point?.x) || 0, y = Number(point?.y) || 0;
    return { x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] };
  }

  function sampledArc(center, radius, start, sweep, segments) {
    const points = [];
    const count = Math.max(4, Math.min(256, segments || Math.ceil(Math.abs(sweep) / (Math.PI / 24))));
    for (let i = 0; i <= count; i++) {
      const angle = start + sweep * (i / count);
      points.push({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
    }
    return points;
  }

  function bulgeSegment(a, b, bulge) {
    const dx = b.x - a.x, dy = b.y - a.y, chord = Math.hypot(dx, dy);
    if (!bulge || chord < 1e-9) return [a, b];
    const sweep = 4 * Math.atan(bulge);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const centerOffset = chord / (2 * Math.tan(sweep / 2));
    const center = { x: mid.x - (dy / chord) * centerOffset, y: mid.y + (dx / chord) * centerOffset };
    const start = Math.atan2(a.y - center.y, a.x - center.x);
    return sampledArc(center, Math.hypot(a.x - center.x, a.y - center.y), start, sweep);
  }

  function polylinePoints(vertices, closed) {
    if (!Array.isArray(vertices) || vertices.length < 2) return [];
    const output = [];
    const count = closed ? vertices.length : vertices.length - 1;
    for (let i = 0; i < count; i++) {
      const a = vertices[i], b = vertices[(i + 1) % vertices.length];
      const part = bulgeSegment(a, b, Number(a.bulge) || 0);
      if (output.length) part.shift();
      output.push(...part);
    }
    return output;
  }

  function layerIsVisible(documentData, entity) {
    if (entity?.visible === false || entity?.inPaperSpace) return false;
    const layer = documentData.tables?.layer?.layers?.[entity.layer];
    return !layer || (layer.visible !== false && !layer.frozen);
  }

  function cadPrimitives(documentData) {
    const primitives = [];
    let pointCount = 0;
    const identity = [1, 0, 0, 1, 0, 0];

    const push = (rawPoints, matrix, width = 0, closed = false) => {
      if (!rawPoints || rawPoints.length < 2) return;
      const points = rawPoints.map((point) => transformPoint(matrix, point));
      pointCount += points.length;
      if (pointCount > MAX_CAD_POINTS) throw new Error("Чертёж слишком сложный: превышен лимит геометрии");
      const sx = Math.hypot(matrix[0], matrix[1]), sy = Math.hypot(matrix[2], matrix[3]);
      primitives.push({ points, width: Math.abs(width) * ((sx + sy) / 2 || 1), closed });
    };

    const visit = (entity, matrix, depth) => {
      if (!entity || depth > 8 || !layerIsVisible(documentData, entity)) return;
      const type = String(entity.type || "").toUpperCase();
      if (type === "LINE") {
        push(entity.vertices, matrix, entity.lineweight > 0 ? entity.lineweight / 100 : 0);
      } else if (type === "LWPOLYLINE" || type === "POLYLINE") {
        const width = entity.width || Math.max(0, ...(entity.vertices || []).flatMap((v) => [v.startWidth || 0, v.endWidth || 0]));
        push(polylinePoints(entity.vertices, !!entity.shape), matrix, width, !!entity.shape);
      } else if (type === "CIRCLE") {
        push(sampledArc(entity.center, entity.radius, 0, Math.PI * 2, 72), matrix, entity.lineweight > 0 ? entity.lineweight / 100 : 0, true);
      } else if (type === "ARC") {
        let sweep = Number(entity.endAngle) - Number(entity.startAngle);
        while (sweep <= 0) sweep += Math.PI * 2;
        push(sampledArc(entity.center, entity.radius, entity.startAngle, sweep), matrix);
      } else if (type === "ELLIPSE") {
        const major = entity.majorAxisEndPoint || { x: 1, y: 0 };
        const start = Number(entity.startAngle) || 0;
        let sweep = (Number(entity.endAngle) || Math.PI * 2) - start;
        while (sweep <= 0) sweep += Math.PI * 2;
        const count = Math.max(24, Math.ceil(sweep / (Math.PI / 36)));
        const points = [];
        for (let i = 0; i <= count; i++) {
          const angle = start + sweep * i / count;
          points.push({
            x: entity.center.x + major.x * Math.cos(angle) - major.y * (entity.axisRatio || 1) * Math.sin(angle),
            y: entity.center.y + major.y * Math.cos(angle) + major.x * (entity.axisRatio || 1) * Math.sin(angle)
          });
        }
        push(points, matrix, 0, sweep >= Math.PI * 2 - .001);
      } else if (type === "SPLINE") {
        push(entity.fitPoints?.length > 1 ? entity.fitPoints : entity.controlPoints, matrix, 0, !!entity.closed);
      } else if (type === "SOLID" || type === "3DFACE") {
        push(entity.points || entity.vertices, matrix, 0, true);
      } else if (type === "INSERT") {
        const block = documentData.blocks?.[entity.name];
        if (!block?.entities) return;
        const position = entity.position || { x: 0, y: 0 };
        const base = block.position || { x: 0, y: 0 };
        const rotation = (Number(entity.rotation) || 0) * Math.PI / 180;
        const sx = Number(entity.xScale) || 1, sy = Number(entity.yScale) || 1;
        const columns = Math.max(1, Math.min(100, Number(entity.columnCount) || 1));
        const rows = Math.max(1, Math.min(100, Number(entity.rowCount) || 1));
        for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
          const ox = column * (Number(entity.columnSpacing) || 0) - (base.x || 0);
          const oy = row * (Number(entity.rowSpacing) || 0) - (base.y || 0);
          const local = [
            Math.cos(rotation) * sx,
            Math.sin(rotation) * sx,
            -Math.sin(rotation) * sy,
            Math.cos(rotation) * sy,
            position.x + Math.cos(rotation) * sx * ox - Math.sin(rotation) * sy * oy,
            position.y + Math.sin(rotation) * sx * ox + Math.cos(rotation) * sy * oy
          ];
          const nested = multiply(matrix, local);
          block.entities.forEach((child) => visit(child, nested, depth + 1));
        }
      }
    };

    (documentData.entities || []).forEach((entity) => visit(entity, identity, 0));
    return primitives;
  }

  function renderCad(documentData) {
    const primitives = cadPrimitives(documentData);
    if (!primitives.length) throw new Error("В файле не найдена поддерживаемая геометрия model space");
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    primitives.forEach(({ points }) => points.forEach(({ x, y }) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }));
    const drawingWidth = maxX - minX, drawingHeight = maxY - minY;
    if (!(drawingWidth > 0) || !(drawingHeight > 0)) throw new Error("Не удалось определить границы CAD-чертежа");
    const padding = 52;
    let scale = (RASTER_LONG_SIDE - padding * 2) / Math.max(drawingWidth, drawingHeight);
    let width = Math.ceil(drawingWidth * scale + padding * 2);
    let height = Math.ceil(drawingHeight * scale + padding * 2);
    const maxPixels = 16 * 1024 * 1024;
    if (width * height > maxPixels) {
      const reduce = Math.sqrt(maxPixels / (width * height));
      scale *= reduce; width = Math.ceil(width * reduce); height = Math.ceil(height * reduce);
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(128, width); canvas.height = Math.max(128, height);
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#111"; context.lineCap = "square"; context.lineJoin = "miter";
    primitives.forEach((primitive) => {
      const points = primitive.points;
      context.beginPath();
      points.forEach((point, index) => {
        const x = padding + (point.x - minX) * scale;
        const y = padding + (maxY - point.y) * scale;
        if (index) context.lineTo(x, y); else context.moveTo(x, y);
      });
      if (primitive.closed) context.closePath();
      context.lineWidth = primitive.width ? Math.max(1, Math.min(24, primitive.width * scale)) : 1.4;
      context.stroke();
    });
    return {
      dataUrl: canvas.toDataURL("image/png"),
      width: canvas.width,
      height: canvas.height,
      detail: `${primitives.length} геометрических объектов`
    };
  }

  async function importDxfBytes(bytes, format) {
    const header = new TextDecoder("ascii").decode(bytes.subarray(0, Math.min(bytes.length, 64)));
    if (header.includes("AutoCAD Binary DXF")) throw new Error("Бинарный DXF пока не поддерживается — сохраните файл как ASCII DXF");
    const Parser = await loadDxfParser();
    let documentData;
    try { documentData = new Parser().parseSync(decodeDxf(bytes)); }
    catch (error) { throw new Error(`Не удалось разобрать ${format}: ${error.message || "неизвестная ошибка"}`); }
    return { ...renderCad(documentData), format };
  }

  async function importDxf(file) {
    return importDxfBytes(new Uint8Array(await file.arrayBuffer()), "DXF");
  }

  async function importDwg(file) {
    const converter = await loadDwgConverter();
    let dxfBytes;
    try { dxfBytes = await converter.convertDwgToDxf(new Uint8Array(await file.arrayBuffer())); }
    catch (error) { throw new Error(`Не удалось преобразовать DWG: ${error.message || "проверьте версию файла"}`); }
    return importDxfBytes(dxfBytes instanceof Uint8Array ? dxfBytes : new Uint8Array(dxfBytes), "DWG");
  }

  async function importFile(file, options) {
    if (!file) throw new Error("Файл не выбран");
    if (file.size > MAX_FILE_BYTES) throw new Error("Файл слишком большой — максимум 100 МБ");
    const extension = extensionOf(file);
    if (extension === "png" || extension === "svg") {
      return { dataUrl: await readDataUrl(file), format: extension.toUpperCase(), detail: "исходное изображение" };
    }
    if (extension === "pdf") return importPdf(file, options);
    if (extension === "dxf") return importDxf(file);
    if (extension === "dwg") return importDwg(file);
    throw new Error("Поддерживаются PNG, SVG, PDF, DXF и DWG");
  }

  window.EPPlanImport = { importFile, supportedExtensions: ["png", "svg", "pdf", "dxf", "dwg"] };
})();
