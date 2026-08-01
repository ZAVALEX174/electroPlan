/*
 * Чистая геометрия ЛИЦА механизма VIMAR: разбор содержимого кадра на связные компоненты,
 * выбор компонента-модуля и вычисление лицевого прямоугольника. Вынесено из tools/detect-faces.mjs,
 * чтобы покрыть тестами именно логику ВЫБОРА КОМПОНЕНТА и решение «фото или фолбэк» (сеть и Jimp
 * в тест не тащим). Функции без побочных эффектов: на вход — маска/готовые компоненты, на выход —
 * числа. Инструмент .mjs, тесты commonjs → тесты подключают модуль динамическим import (как для
 * tools/lib/nomenclature.mjs).
 *
 * ЗАЧЕМ КОМПОНЕНТЫ. Раньше лицо считалось от bbox ВСЕГО содержимого кадра. У части позиций рядом с
 * модулем в кадре лежит комплектный аксессуар (косичка-переходник HDMI, отдельный коннектор RJ45) —
 * он попадал в bbox, и «лицо» растягивалось на весь коллаж. Теперь содержимое режется на связные
 * компоненты, и лицо считается от компонента-МОДУЛЯ: аксессуар остаётся за кадром.
 */

/* Порог «содержимого»: пиксель темнее хотя бы по одному каналу, чем CONTENT_MAX, — не фон (тот же
   порог, что в детекторе окон, min(R,G,B) < 245). */
export const CONTENT_MAX = 245;

/* Физическая пропорция лица модуля VIMAR: ширина/высота = span × (22,5/45) = span × 0.5
   (модуль 22,5×45 мм). 1М → 0.5, 2М → 1.0, 3М → 1.5. Это геометрия стандарта, не эвристика. */
export const MODULE_RATIO = 22.5 / 45;

/* Допуск на попадание пропорции компонента в ожидаемую по span (±15%). Компонент, чья пропорция
   ширина/высота отклоняется от span×0.5 не более чем на ASPECT_TOL, считаем «похожим на лицо
   модуля». Вынесен константой — владелец крутит по картинкам. */
export const ASPECT_TOL = 0.15;

/* Минимальная доля площади кадра, ниже которой компонент — шум (тень, блик, точка). */
export const MIN_COMPONENT_FRACTION = 0.005;

/* Доля высоты кадра для «вертикального размыкания» (см. separationMask): им рвём ТОНКИЕ
   ГОРИЗОНТАЛЬНЫЕ перемычки — прежде всего косичку-переходник HDMI, которая светлым проводом
   связывает модуль и коннектор в один компонент. Радиус = round(h × VOPEN_FRACTION); перемычка
   тоньше 2×радиуса исчезает, а модуль (во всю высоту кадра) уцелевает. 0.06 подобрано по фото:
   провода рвутся, модули не крошатся. */
export const VOPEN_FRACTION = 0.06;

/* TRIM — поджатие лица внутрь с КАЖДОЙ стороны (доля от размера лица): по краю механизма на фото
   видна светлая кромка его монтажной рамки, на тёмной накладке она заметна кантом — срезаем. */
export const TRIM = 0.02;

const round1 = (n) => Math.round(n * 10) / 10;
const round3 = (n) => Math.round(n * 1000) / 1000;

/* Ожидаемая пропорция лица (ширина/высота) для span модулей. */
export function expectedAspect(span) {
  return span * MODULE_RATIO;
}

/* Относительное отклонение пропорции компонента от ожидаемой по span (0 — точное попадание). */
export function aspectDeviation(comp, span) {
  const cw = comp.right + 1 - comp.left;
  const ch = comp.bottom + 1 - comp.top;
  return Math.abs((cw / ch) / expectedAspect(span) - 1);
}

/* Маска «содержимого» из битмапа Jimp ({width,height,data} RGBA): 1 — пиксель не фон. */
export function buildContentMask(bitmap, contentMax = CONTENT_MAX) {
  const { width: w, height: h, data } = bitmap;
  const mask = new Uint8Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    if (Math.min(data[i], data[i + 1], data[i + 2]) < contentMax) mask[p] = 1;
  }
  return mask;
}

/* Дилатация маски на r пикселей (4-соседей, r маленький, 1–2): лечит тонкие 1-пиксельные разрывы
   ВНУТРИ одного предмета (глянцевый центр модуля, антиалиасинг), чтобы они не дробили его. */
function dilateMask(mask, w, h, r) {
  let out = mask;
  for (let step = 0; step < r; step++) {
    const next = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (out[p] ||
            (x > 0 && out[p - 1]) || (x + 1 < w && out[p + 1]) ||
            (y > 0 && out[p - w]) || (y + 1 < h && out[p + w])) next[p] = 1;
      }
    }
    out = next;
  }
  return out;
}

/* Заливка столбцов: в каждом столбце заполняем всё от верхнего до нижнего content-пикселя. Делает
   каждый предмет СПЛОШНЫМ блоком. Зачем: у белого модуля на белом фоне «содержимое» — лишь тонкий
   контур; прямая эрозия такого контура раскрошила бы модуль на куски. После заливки модуль —
   сплошной высокий блок, и вертикальная эрозия его уже не дробит, а рвёт только тонкие перемычки. */
function columnFill(mask, w, h) {
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let top = -1, bottom = -1;
    for (let y = 0; y < h; y++) if (mask[y * w + x]) { if (top < 0) top = y; bottom = y; }
    if (top >= 0) for (let y = top; y <= bottom; y++) out[y * w + x] = 1;
  }
  return out;
}

/* Вертикальное размыкание (opening) радиуса r: эрозия сверху-снизу на r, затем такая же дилатация.
   Убирает тонкие ГОРИЗОНТАЛЬНЫЕ перемычки (провод-косичка HDMI высотой ~2r), не трогая ширину и не
   меняя высоту уцелевших блоков. Только вертикаль — горизонтальные связи не добавляет, поэтому
   раздельные предметы не слипаются. */
function verticalOpen(mask, w, h, r) {
  const morph = (src, grow) => {
    let out = src;
    for (let step = 0; step < r; step++) {
      const next = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = y * w + x;
          const up = y > 0 ? out[p - w] : 0, dn = y + 1 < h ? out[p + w] : 0;
          if (grow) next[p] = (out[p] || up || dn) ? 1 : 0;   // дилатация
          else next[p] = (out[p] && (y > 0 ? up : 0) && (y + 1 < h ? dn : 0)) ? 1 : 0;  // эрозия
        }
      }
      out = next;
    }
    return out;
  };
  return morph(morph(mask, false), true);
}

/* Маска РАЗДЕЛЕНИЯ: сперва лечим 1px-разрывы дилатацией, потом заливаем столбцы в сплошные блоки и
   вертикальным размыканием рвём тонкие горизонтальные перемычки (косичка HDMI). Отдельно вынесена,
   чтобы её можно было проверить в изоляции. */
export function separationMask(mask, w, h, opts = {}) {
  const dilate = opts.dilate == null ? 0 : opts.dilate;
  const r = opts.vopen == null ? Math.max(2, Math.round(h * VOPEN_FRACTION)) : opts.vopen;
  const healed = dilate > 0 ? dilateMask(mask, w, h, dilate) : mask;
  const filled = columnFill(healed, w, h);
  return r > 0 ? verticalOpen(filled, w, h, r) : filled;
}

/* Связные компоненты содержимого (4-соседей). Перед разметкой строим маску разделения
   (separationMask): она отрезает косичку-переходник HDMI/RJ45, но не крошит одиночный модуль.
   Компоненты мельче minFraction площади кадра отбрасываем как шум. Возвращает
   [{left,top,right,bottom,area}] (right/bottom включительно, в пикселях), в порядке сканирования. */
export function labelComponents(mask, w, h, opts = {}) {
  const minArea = (opts.minFraction == null ? MIN_COMPONENT_FRACTION : opts.minFraction) * w * h;
  const conn = separationMask(mask, w, h, opts);
  const lab = new Int32Array(w * h);
  const comps = [];
  let cur = 0;
  for (let y0 = 0; y0 < h; y0++) {
    for (let x0 = 0; x0 < w; x0++) {
      const p0 = y0 * w + x0;
      if (!conn[p0] || lab[p0] !== 0) continue;
      cur++;
      const st = [p0]; lab[p0] = cur;
      let xs0 = w, xs1 = -1, ys0 = h, ys1 = -1, area = 0;
      while (st.length) {
        const p = st.pop(), y = (p / w) | 0, x = p % w;
        if (mask[p]) {                    // габарит/площадь — только по исходной маске
          area++;
          if (x < xs0) xs0 = x; if (x > xs1) xs1 = x;
          if (y < ys0) ys0 = y; if (y > ys1) ys1 = y;
        }
        const q = (yy, xx) => { const k = yy * w + xx; if (conn[k] && lab[k] === 0) { lab[k] = cur; st.push(k); } };
        if (y + 1 < h) q(y + 1, x);
        if (y - 1 >= 0) q(y - 1, x);
        if (x + 1 < w) q(y, x + 1);
        if (x - 1 >= 0) q(y, x - 1);
      }
      if (area >= minArea && xs1 >= 0) comps.push({ left: xs0, top: ys0, right: xs1, bottom: ys1, area });
    }
  }
  return comps;
}

/* Лицо из bbox выбранного компонента и span. Высота лица выводится из ширины компонента по
   пропорции модуля, центрируется по вертикали (монтажные лапки сверху/снизу отсекаются),
   поджимается на TRIM, переводится в % фото. clamped — расчётное лицо оказалось выше компонента и
   урезано до него. */
export function faceRectFromComponent(comp, span, w, h) {
  const bboxW = comp.right + 1 - comp.left;
  const bboxH = comp.bottom + 1 - comp.top;
  const expect = expectedAspect(span);
  let faceH = bboxW / expect;
  let faceTop = comp.top + (bboxH - faceH) / 2;
  const ratio = (bboxW / bboxH) / expect;
  let clamped = false;
  if (faceH > bboxH) { faceH = bboxH; faceTop = comp.top; clamped = true; }
  let faceLeft = comp.left, faceW = bboxW;
  faceLeft += TRIM * faceW; faceW *= (1 - 2 * TRIM);
  faceTop += TRIM * faceH; faceH *= (1 - 2 * TRIM);
  return {
    face: [round1(faceLeft / w * 100), round1(faceTop / h * 100), round1(faceW / w * 100), round1(faceH / h * 100)],
    ratio: round3(ratio),
    clamped,
  };
}

/* Решение по кадру: какой компонент — лицо модуля, или фото не годится (фолбэк).
 *
 *   • нет компонентов                       → {decision:"empty"};
 *   • есть компонент, попадающий в пропорцию → {decision:"face", ...} (fit=true, не подозрительный);
 *   • ни один не попадает, но span>1 и ≥2
 *     компонентов похожи на 1М              → {decision:"fallback", reason:"compound"}
 *                                             (составная позиция вроде пары клавиш EnOcean —
 *                                              честная заглушка лучше растянутого коллажа);
 *   • ни один не попадает и не составная     → {decision:"face", fit:false} — берём лучший
 *                                             компонент, но помечаем на просмотр глазами.
 *
 * Выбор компонента. Если есть компоненты, попадающие в ожидаемую пропорцию (dev ≤ ASPECT_TOL),
 * берём среди них самый КРУПНЫЙ (при равной площади — самый левый): все они «формой похожи на
 * модуль», и настоящий модуль — самый большой, а не осколок провода с той же пропорцией. Отступ от
 * буквального «лучше всего попадает в пропорцию»: выбор по минимуму отклонения давал победу мелкому
 * обрезку косички, у которого аспект случайно ровно 0.5 (см. 20346). Если в допуск не попал никто —
 * берём наименее отклонившийся (для отчёта помечаем fit=false). */
export function chooseFace(components, span, w, h) {
  if (!components.length) return { decision: "empty", componentCount: 0 };
  const withDev = components.map((c) => ({ c, dev: aspectDeviation(c, span) }));
  const within = withDev.filter((r) => r.dev <= ASPECT_TOL);
  let pick, fit;
  if (within.length) {
    within.sort((a, b) => b.c.area - a.c.area || a.c.left - b.c.left);
    pick = within[0]; fit = true;
  } else {
    // ни один не похож на лицо модуля: составная позиция (span>1 и ≥2 «однокнопочных»
    // компонентов, как пара клавиш EnOcean) → фото не годится, уходим в нарисованный фолбэк
    const like1m = components.filter((c) => aspectDeviation(c, 1) <= ASPECT_TOL);
    if (span > 1 && like1m.length >= 2) {
      return { decision: "fallback", reason: "compound", componentCount: components.length, like1mCount: like1m.length };
    }
    withDev.sort((a, b) => a.dev - b.dev || a.c.left - b.c.left || b.c.area - a.c.area);
    pick = withDev[0]; fit = false;
  }
  const { face, ratio, clamped } = faceRectFromComponent(pick.c, span, w, h);
  return { decision: "face", face, ratio, clamped, fit, comp: pick.c, componentCount: components.length };
}
