/* Подбор монтажной коробки и суппорта под накладку — чистая логика (PLAN 2.1),
   как posts.js/estimate.js: без state и DOM, каталог и хелперы приходят аргументами.

   Ключевое правило (требование владельца): подобранное изделие НИКОГДА не должно
   противоречить монтажному стандарту накладки. Иначе в смету попадёт цена заведомо
   неподходящего изделия (например, круглая коробка под итальянскую сборку), а блок
   состава сам себе противоречит. Поэтому стандарт коробки/суппорта — ЖЁСТКИЙ фильтр;
   если совместимого изделия в каталоге нет — возвращаем null (честный пробел в смете),
   а не подставляем чужое как «подходящее».

   Признаки берутся из EP_VIMAR_ATTRS (js/data.js подмешивает их к товарам):
     коробка   — boxStandards (["IT"] у прямоугольной, ["IT_ROUND","DE","FR"] у круглой),
                 wallType (solid|hollow|unknown), boxModules, boxShape;
     суппорт   — standard, moduleCount, серия (series).

   Интерфейс приложению — window.EPPostFit; Node — module.exports для автотестов. */
(() => {
"use strict";

const upStd = s => String(s || "").toUpperCase();
const num = v => Number(v) || 0;
/* Круглые стандарты — одна круглая коробка на пост. Итальянский (IT) — прямоугольная
   коробка на всю сборку. */
const ROUND_STD = new Set(["DE", "FR", "IT_ROUND"]);

/* Коробка совместима со стандартом накладки, если её список стандартов его включает.
   Неизвестный/универсальный стандарт накладки или коробка без списка — не блокируем
   (лучше показать коробку, чем ложно скрыть). */
function boxFitsStandard(box, std) {
  if (!std || std === "UNKNOWN" || std === "BOTH") return true;
  const list = box && box.boxStandards;
  if (!Array.isArray(list) || !list.length) return true;
  return list.map(upStd).includes(std);
}
const wallFits = (box, wanted) => {
  const bw = (box && box.wallType) || "unknown";
  return bw === wanted || bw === "unknown";
};

/* Ядро подбора коробки.
   relaxWall=false (findBox): тип стены обязателен — нет подходящей по стене → null.
   relaxWall=true  (fallbackBox): тип стены становится лишь приоритетом — так подбирается
   стандартно-совместимый фолбэк, когда точной под тип стены нет.
   Стандарт — жёсткий фильтр всегда: нет коробки под стандарт → null (в обоих режимах).
   frameModules — ёмкость накладки в модулях (для итальянской прямоугольной коробки). */
function selectBox(opts) {
  const o = opts || {};
  const boxes = o.boxes || [];
  if (!boxes.length) return null;
  const std = upStd(o.standard != null ? o.standard : o.frame && o.frame.standard);
  const wanted = o.wantedWall || "solid";
  let pool = boxes.filter(b => boxFitsStandard(b, std));
  if (!pool.length) return null;
  if (!o.relaxWall) {
    const wallOk = pool.filter(b => wallFits(b, wanted));
    if (!wallOk.length) return null;
    pool = wallOk;
  }
  const rankWall = b => { const bw = b.wallType || "unknown"; return bw === wanted ? 0 : bw === "unknown" ? 1 : 2; };
  const byWallThenPrice = (a, b) => rankWall(a) - rankWall(b) || (num(a.price) || Infinity) - (num(b.price) || Infinity);
  /* круглая/неизвестный/универсальный стандарт: одна коробка на пост — самая подходящая
     по стене и цене. */
  if (!std || std === "UNKNOWN" || std === "BOTH" || ROUND_STD.has(std)) {
    return pool.slice().sort(byWallThenPrice)[0];
  }
  /* итальянская сборка: одна прямоугольная коробка на всё число модулей накладки —
     наименьшая из вмещающих; если накладка шире любой коробки — самая вместительная. */
  const target = num(o.frameModules) || num(o.modules) || 1;
  const fits = pool.filter(b => num(b.boxModules) >= target);
  if (fits.length) return fits.slice().sort((a, b) => a.boxModules - b.boxModules || byWallThenPrice(a, b))[0];
  return pool.slice().sort((a, b) => num(b.boxModules) - num(a.boxModules))[0];
}
const findBox = opts => selectBox(Object.assign({}, opts, { relaxWall: false }));
const fallbackBox = opts => selectBox(Object.assign({}, opts, { relaxWall: true }));

/* Разумный фолбэк-подрозетник по умолчанию (для хранения socketBoxProductId и крайних
   случаев): самая универсальная коробка — круглая ø60 на один пост, среди таких самая
   дешёвая; если круглых нет — просто самая дешёвая коробка. НЕ используется как цена
   в смете там, где известен стандарт (там работают findBox/fallbackBox). */
function socketBox(boxes) {
  if (!boxes || !boxes.length) return undefined;
  const round = boxes.filter(b => b.boxShape === "round");
  const pool = round.length ? round : boxes;
  return pool.reduce((best, b) => ((num(b.price) || Infinity) < (num(best.price) || Infinity) ? b : best), pool[0]);
}

/* Подбор суппорта: та же серия, модульность и стандарт (или без стандарта — unknown),
   что накладка. Стандарт — мягкий фильтр: суппорт того же стандарта ИЛИ без стандарта,
   но не противоречащий (немецкий суппорт не подставится под итальянскую накладку).
   seriesOf(item) → массив серий; frameModules — ёмкость накладки в модулях. */
function findSupport(opts) {
  const o = opts || {};
  const supports = o.supports || [];
  if (!supports.length) return null;
  const std = upStd(o.standard != null ? o.standard : o.frame && o.frame.standard);
  const target = num(o.frameModules) || num(o.modules) || 0;
  const seriesOf = o.seriesOf || (item => (item && item.series) || []);
  const ser = item => (Array.isArray(seriesOf(item)) ? seriesOf(item) : [seriesOf(item)])
    .filter(Boolean).map(x => String(x).toLocaleLowerCase("ru-RU"));
  const frameSeries = ser(o.frame);
  const sameSeries = supports.filter(s => ser(s).some(v => frameSeries.includes(v)));
  let pool = sameSeries.length ? sameSeries : supports;
  if (std && std !== "UNKNOWN" && std !== "BOTH") {
    const stdPool = pool.filter(s => { const ss = upStd(s.standard); return !ss || ss === "UNKNOWN" || ss === std; });
    if (!stdPool.length) return null;
    pool = stdPool;
  }
  const supModules = s => num(s.moduleCount) || num(s.modules) || 0;
  return pool.find(s => supModules(s) === target) || null;
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { boxFitsStandard, selectBox, findBox, fallbackBox, socketBox, findSupport };
if (typeof window !== "undefined") window.EPPostFit = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
