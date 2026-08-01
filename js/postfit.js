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

/* Тип суппорта закодирован последними 3 цифрами артикула (структура артикула VIMAR:
   первые 2 цифры — коллекция, последние 3 — узел): 602 — «за щеками», 603 — «с винтами».
   Вариант («09602.1») отбрасываем — тип определяют цифры базового артикула. */
const supportTypeCode = code => {
  const base = String(code || "").split(".")[0];
  const m = base.match(/(\d{3})$/);
  return m ? m[1] : "";
};

/* Правило заказчика (ответы 31.07, §3.3): суппорт выбирается ПО КОРОБКЕ, а не по нашей
   эвристике «стандарт + модульность». Коробка 71001 → суппорт 602 (за щеками), коробка
   71701 → 603 (с винтами; годится и для коробок других брендов немецкого стандарта).
   Немецкий стандарт — всегда 603, даже если по типу стены подобралась круглая 71001
   (иначе противоречили бы «для немецкого только 603»). Итальянская прямоугольная сборка
   правилом не покрывается (у неё нет коробок 71001/71701) → null: там суппорт по модульности. */
function supportTypeForBox(std, box) {
  if (std === "DE") return "603";
  const code = String((box && box.code) || "");
  if (/71701/.test(code)) return "603";
  if (/71001/.test(code)) return "602";
  return null;
}

/* Подбор суппорта. Приоритет — правило заказчика: тип суппорта (602/603) задаёт подобранная
   КОРОБКА (o.box). Стандарт суппорта (support.standard) в подборе БОЛЬШЕ НЕ участвует — он
   закодирован в типе, а номенклатура помечает 602/603 универсальными (BOTH); прежняя
   эвристика по стандарту давала ложные расхождения (09602.1/09603.1 считались немецкими).
   Суппорт всегда той же серии, что накладка; нет подходящего по правилу → null (честный
   пробел, без подстановки чужого). seriesOf(item) → массив серий; frameModules — ёмкость. */
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
  /* Серия — жёсткое требование: чужую серию не подставляем. Если у накладки серия не
     указана, фильтровать нечем — работаем по всему списку (как раньше). */
  let pool = supports;
  if (frameSeries.length) {
    pool = supports.filter(s => ser(s).some(v => frameSeries.includes(v)));
    if (!pool.length) return null;
  }
  const supModules = s => num(s.moduleCount) || num(s.modules) || 0;
  const typeCode = supportTypeForBox(std, o.box);
  if (typeCode) {
    const byType = pool.filter(s => supportTypeCode(s.code) === typeCode);
    if (!byType.length) return null;   // по правилу подходящего суппорта серии нет
    /* среди суппортов нужного типа предпочитаем совпадение по модульности (обычно 2М) */
    return byType.find(s => supModules(s) === target) || byType[0];
  }
  /* Правило не определило тип (итальянская прямоугольная сборка) — подбор по модульности
     той же серии, как раньше; нет нужной модульности → null. */
  return pool.find(s => supModules(s) === target) || null;
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { boxFitsStandard, selectBox, findBox, fallbackBox, socketBox, findSupport };
if (typeof window !== "undefined") window.EPPostFit = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
