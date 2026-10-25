/* Уменьшение растрового плана, чтобы он ПЕРЕЖИЛ перезагрузку (решение владельца 25.10). План
   хранится data-URL'ом внутри снимка проекта в localStorage. Фото плана с телефона (8–15 МБ) в
   base64 раздувается до десятков мегабайт символов и в localStorage не влезает — persistProject
   сохранял проект с plan:null и planTooBig, и после F5 план исчезал. Правило: большой растр
   программа сама ужимает ещё при загрузке, до того как он попадёт в снимок.

   ЧИСТЫЙ МОДУЛЬ, как geometry.js/planRotate.js: ни DOM, ни canvas, ни state. Здесь — только
   ЧИСЛА и РЕШЕНИЯ: целевой размер с сохранением пропорций, «трогать или нет», ступени качества
   JPEG, проверка «влезает ли в предел». Рисование на canvas — у потребителя (js/planImport.js),
   он подставляет сюда размеры и длину готового data-URL. Так правило уменьшения живёт в одном
   месте и проверяется в Node без браузера (§7.1 HANDOFF). Интерфейс — window.EPPlanShrink.

   ПОЧЕМУ ПРОПОРЦИИ ВАЖНЫ (инвариант части 3 задачи). Подложка #planImage лежит в мировом боксе
   холста с object-fit:contain и ЛЕТТЕРБОКСИТСЯ: расчёт её положения (EPPlanRotate.fitScale) зависит
   ТОЛЬКО от отношения сторон natW/natH, не от абсолютных пикселей. Нарисованные объекты живут в
   мировых координатах и к пикселям картинки не привязаны. Поэтому уменьшение с сохранением
   пропорций НЕ сдвигает ни подложку, ни объекты, ни масштаб — картинка просто чётче/легче. */
(() => {
"use strict";

/* Длинная сторона растра после уменьшения — ровно столько точек (решение владельца: «не больше
   4000 точек по длинной стороне»). Меньше — не трогаем, пропорции при уменьшении сохраняем. */
const MAX_LONG_SIDE = 4000;

/* Предел длины data-URL плана (символов) для гарантированного сохранения проекта.
   ОБОСНОВАНИЕ ЗАМЕРОМ (Chrome/Edge, headless, свежий профиль, 25.10): полная ёмкость localStorage
   origin — 5 200 000 символов (квота считается в символах UTF-16, ~10 МБ в байтах), и она ОБЩАЯ на
   все ключи приложения. Под план отводим 3 000 000 символов и оставляем ~2 200 000 (больше 40 %)
   резерва под остальной снимок проекта (devices/posts/rooms/настройки), ключ сохранённых постов
   ep_post_templates, кэш курса и prefs. base64 состоит из символов, не требующих экранирования в
   JSON, поэтому длина строки data-URL ≈ её вклад в localStorage. 3 000 000 символов base64 ≈ 2,25 МБ
   бинарного JPEG — этого хватает на фото 4000 px по длинной стороне в хорошем качестве. */
const PLAN_DATAURL_MAX_CHARS = 3000000;

/* Ступени качества JPEG при пережатии: от высокого вниз. Понижаем по шагам, пока data-URL не влезет
   в предел, а не одним прыжком — чтобы не терять качество сильнее необходимого. План нужен чётким
   «чтобы по нему обвести», но это фон, а не печать: нижние ступени допустимы ради того, чтобы фото
   вообще сохранилось. */
const QUALITY_STEPS = [0.82, 0.72, 0.62, 0.52, 0.42];

/* Целевой размер с сохранением пропорций. Длинная сторона > maxLong → ужимаем её РОВНО до maxLong,
   короткую — пропорционально (округление в пикселях неизбежно; отношение сторон держится с точностью
   округления, доли пикселя object-fit:contain сглаживает). Длинная сторона ≤ maxLong → scaled:false,
   размеры исходные: такой растр уменьшать незачем. Мусор на входе (0/NaN) → scaled:false. */
function targetDimensions(width, height, maxLong) {
  const max = maxLong != null ? maxLong : MAX_LONG_SIDE;
  const w = Math.round(Number(width)), h = Math.round(Number(height));
  if (!(w > 0 && h > 0)) return { width: w, height: h, scaled: false };
  const longSide = Math.max(w, h);
  /* «≤», а не «<»: план РОВНО 4000 по длинной стороне уже укладывается в предел — трогать его не
     надо (иначе лишняя перекодировка и потеря чёткости на ровном месте). */
  if (longSide <= max) return { width: w, height: h, scaled: false };
  const k = max / longSide;
  if (w >= h) return { width: max, height: Math.max(1, Math.round(h * k)), scaled: true };
  return { width: Math.max(1, Math.round(w * k)), height: max, scaled: true };
}

/* Влезает ли data-URL такой длины в предел сохранения. */
function withinLimit(dataUrlLength, limit) {
  const lim = limit != null ? limit : PLAN_DATAURL_MAX_CHARS;
  return Number(dataUrlLength) <= lim;
}

/* Главное решение по исходному растру: трогать или нет.
   keep   — длинная сторона в норме И исходный data-URL влезает → отдаём БАЙТ-В-БАЙТ исходник
            (ни уменьшения, ни перекодировки — требование «если влезает, не трогать вообще»).
   redraw — иначе: надо перерисовать на canvas в указанный размер (уменьшённый или исходный, если
            велик только по весу), а затем, если PNG всё ещё велик, пережать в JPEG по ступеням. */
function decide(width, height, dataUrlLength, opts) {
  const maxLong = opts && opts.maxLong != null ? opts.maxLong : MAX_LONG_SIDE;
  const limit = opts && opts.limit != null ? opts.limit : PLAN_DATAURL_MAX_CHARS;
  const t = targetDimensions(width, height, maxLong);
  if (!t.scaled && withinLimit(dataUrlLength, limit)) {
    return { action: "keep", width: t.width, height: t.height, scaled: false };
  }
  return { action: "redraw", width: t.width, height: t.height, scaled: t.scaled };
}

function qualitySteps() { return QUALITY_STEPS.slice(); }

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports (автотесты). */
const api = { MAX_LONG_SIDE, PLAN_DATAURL_MAX_CHARS, targetDimensions, withinLimit, decide, qualitySteps };
if (typeof window !== "undefined") window.EPPlanShrink = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
