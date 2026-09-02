/* Каталог — чистая доменная логика над товарами прайса (PLAN 2.1).
   Модуль оперирует отдельными товарами (объектами прайса), которые приходят
   аргументами: ни state, ни DOM, ни money()/esc(). Accessor'ы product()/byKind()
   над state.products и генерация HTML (mechanismOptions/frameOptions/productPicture)
   остаются в app.js — им нужны состояние и разметка.

   Как estimate.js/geometry.js — без зависимостей приложения, под автотесты (PLAN 7.1).

   Интерфейс приложению — window.EPCatalog. */
(() => {
"use strict";

/* Счётчик подписи: ЧИСЛО либо «числовая строка», иначе null («считать нечего»).
   Голый Number() здесь врал бы молча: Number(null) === 0, и «счётчик не задан» становилось бы
   честным нулём — подпись «0 мест» утверждала бы про проект то, чего расчёт не говорил. */
function countValue(count) {
  if (typeof count === "number") return Number.isFinite(count) ? count : null;
  if (typeof count === "string" && count.trim() !== "") {
    const n = Number(count.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
/* Русское склонение по числу — ОДНО правило на все счётные подписи интерфейса.
   Прежняя формула («1 → одна форма, 2–4 → вторая, иначе третья») врала на втором десятке:
   «11 модуля», «22 модулей». Правило языка смотрит на ПОСЛЕДНИЕ ДВЕ цифры: 11–14 всегда
   множественная форма, иначе решает последняя цифра. Нечисловой вход — множественная форма
   («— мест»), а не падение подписи. */
function pluralRu(count, one, few, many) {
  const value = countValue(count);
  if (value === null) return many;
  const n = Math.abs(value);
  const hundred = Math.floor(n) % 100, digit = hundred % 10;
  if (hundred > 10 && hundred < 20) return many;
  if (digit > 1 && digit < 5) return few;
  return digit === 1 ? one : many;
}
/* «1 модуль / 2 модуля / 5 модулей», «1 место / 2 места / 5 мест» — подписи всего, что считает
   модули рамки и места поста.
   ⚠️ СЧЁТЧИК ПОДСТАВЛЯЕТСЯ НЕ СЫРЫМ. Раньше число печаталось через шаблон как есть, а склонение
   при нечисловом входе честно давало множественную форму, — и вместе они выдавали «null мест»,
   «undefined модулей», «NaN модулей» прямо в интерфейс и в документы. Подпись обязана либо
   назвать число, либо честно сказать, что числа нет: пробел «—» и множественная форма
   («— мест»), как и описано у pluralRu. */
const countWord = (count, one, few, many) =>
  `${countValue(count) === null ? "—" : countValue(count)} ${pluralRu(count, one, few, many)}`;
const moduleWord = count => countWord(count, "модуль", "модуля", "модулей");
const placeWord = count => countWord(count, "место", "места", "мест");

/* Сколько модулей рамки занимает механизм: явное поле, иначе «N модуль…» из названия, иначе 1.
   Формы в названиях каталога: «на 2 модуля», «1 модуль», «2 modules», а также краткая «2М»
   (кириллическая М) / «2M» (латинская M) БЕЗ слова «модуль» — цветовые варианты одного изделия
   в номенклатуре записаны то так, то так (фальшблок 20042 = «на 2 модуля», а 20042.B = «на 2М»),
   и без краткой формы получали разную ёмкость. Краткую М/M принимаем ТОЛЬКО вплотную к цифре
   («2М», без пробела) и как отдельный токен — negative lookahead (?![…]) отсекает продолжение
   буквой/цифрой: так «2МВт», «2mA», «2MHz» (единицы) не считаются модулями. Пробел перед М/M не
   допускаем намеренно — это отсекает метры «6 м» и размеры «60 мм» (там пробел и/или сдвоенная м);
   словесные формы («2 модуля») пробелы по-прежнему разрешают. Цифра — только на границе слова
   ([\s,(] или начало), поэтому «16A», «250V», «0,3W», «cat5e», «2P+T» не цепляются. */
function mechanismSpan(item) {
  if (!item) return 0;
  const explicit = Number(item.moduleSpan ?? item.module_span ?? item.modules ?? item.moduleCount ?? item.properties?.moduleSpan);
  if (Number.isInteger(explicit) && explicit >= 1 && explicit <= 8) return explicit;
  const match = String(item.name || "").match(/(?:^|[\s,(])([1-8])(?:\s*(?:модул|modules?|mod\b)|[мm](?![a-zа-яё0-9]))/i);
  return match ? Number(match[1]) : 1;
}

/* Серии совместимости товара (массив строк) из разных возможных полей прайса. */
const productSeries = item => {
  const raw = item?.series ?? item?.properties?.series ?? item?.compatibility;
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  return String(raw || "").split(/[,;|]/).map(x => x.trim()).filter(Boolean);
};

/* Механизмы, совместимые с рамкой по серии. Если у рамки серия не указана или
   совпадений нет — возвращаем исходный список (лучше показать всё, чем ничего). */
function compatibleMechanisms(frame, mechanisms) {
  const frameSeries = productSeries(frame).map(x => x.toLocaleLowerCase("ru-RU"));
  if (!frameSeries.length) return mechanisms;
  const compatible = mechanisms.filter(item => {
    const series = productSeries(item).map(x => x.toLocaleLowerCase("ru-RU"));
    return series.some(value => frameSeries.includes(value));
  });
  return compatible.length ? compatible : mechanisms;
}

/* Ёмкость рамки в модулях: явное поле, иначе «на N модулей» из текста, иначе null.
   Поддерживаем 1..8 (основные размеры заказчика — 6-7-8, ответы 31.07 §2.6). Явная ёмкость
   авторитетна: если она есть, но вне 1..8 — возвращаем null, НЕ угадывая по названию. Так
   многорядные накладки (14=7+7, 21=7+7+7) не подставляются под однорядные размеры: у них
   двумерная нумерация модулей, конструктор её пока не поддерживает (отложено владельцем). */
function frameSlotCount(item) {
  if (!item) return null;
  const explicit = Number(item.slotCount ?? item.slots ?? item.placeCount);
  if (Number.isInteger(explicit) && explicit >= 1) return explicit <= 8 ? explicit : null;
  const text = [item.name, item.compatibility, item.properties?.compatibility].filter(Boolean).join(" ");
  const match = text.match(/(?:на|для)?\s*([1-8])\s*(?:модул|мест|пост|module|slot|[mf]\b)/i);
  return match ? Number(match[1]) : null;
}

/* Существующие модульности накладок каталога — ВОСХОДЯЩИЙ список различных frameSlotCount.
   Селектор «Количество модулей рамки» строится ИЗ этого списка, а не из константы в разметке:
   размера, которого в номенклатуре нет (сейчас — 5 модулей), не предлагаем; появится
   5-модульная накладка — вариант возникнет сам, без правки кода. Многорядные 14/21
   (frameSlotCount → null) сюда не попадают намеренно — их двумерную раскладку конструктор пока
   не поддерживает (см. frameSlotCount). */
function frameSlotCounts(frames) {
  const counts = new Set();
  (frames || []).forEach(frame => {
    const n = frameSlotCount(frame);
    if (n != null) counts.add(n);
  });
  return [...counts].sort((a, b) => a - b);
}

/* Варианты селектора «Количество модулей»: модульности каталога (frameSlotCounts) плюс, при
   необходимости, фактическая ёмкость ОТКРЫТОГО поста (extra). Без extra сохранённый пост с
   модульностью, которой в каталоге больше нет (пост на 5 модулей, собранный до этой правки, или
   пост на многорядной накладке, где ёмкость взята из числа механизмов), получил бы селектор с
   ЧУЖИМ значением: присвоение <select>.value отсутствующей опции молча не срабатывает и поле
   показало бы первую опцию, а не ёмкость поста. Список восходящий, без дублей. */
function frameSlotOptions(frames, extra) {
  const counts = new Set(frameSlotCounts(frames));
  if (Number.isInteger(extra) && extra >= 1) counts.add(extra);
  return [...counts].sort((a, b) => a - b);
}

/* Имя поста по умолчанию под N мест. */
const defaultPostName = count => `Пост на ${moduleWord(count)}`;

/* Окно рамки в превью-сборке (доли %, aspect) по числу модулей — дефолты под 1–8.
   6–8 продолжают тренд узких рамок: окно шире, aspect больше (рамка вытягивается в ряд).
   Точная геометрия конкретной накладки берётся из её mountRect (frameOpening), это лишь
   запасные пропорции, чтобы модули не разъезжались, когда своего mountRect нет. */
const defaultFrameOpenings = {
  1: { left: 37.5, top: 23.5, width: 25, height: 53.5, aspect: 1 },
  2: { left: 24, top: 23, width: 52, height: 51.5, aspect: 1 },
  3: { left: 21.5, top: 23, width: 57, height: 53.5, aspect: 1.39 },
  4: { left: 18.7, top: 23, width: 62.5, height: 52.5, aspect: 1.66 },
  5: { left: 13, top: 23, width: 74, height: 55.5, aspect: 2.02 },
  6: { left: 11, top: 23, width: 78, height: 56, aspect: 2.4 },
  7: { left: 9.5, top: 23, width: 81, height: 56.5, aspect: 2.78 },
  8: { left: 8.5, top: 23, width: 83, height: 57, aspect: 3.15 }
};

/* Окно рамки: пользовательский mountRect (если валиден и в пределах 0–100%),
   иначе дефолт по числу мест. */
function frameOpening(item, count) {
  let custom = item?.mountRect ?? item?.mount_rect ?? item?.frameOpening ?? item?.frame_opening;
  if (typeof custom === "string") {
    try { custom = JSON.parse(custom); } catch { custom = null; }
  }
  const fallback = defaultFrameOpenings[count] || defaultFrameOpenings[3];
  if (!custom || typeof custom !== "object") return fallback;
  const rect = {
    left: Number(custom.left ?? custom.x),
    top: Number(custom.top ?? custom.y),
    width: Number(custom.width ?? custom.w),
    height: Number(custom.height ?? custom.h),
    aspect: Number(custom.aspect ?? fallback.aspect)
  };
  const valid = [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)
    && rect.left >= 0 && rect.top >= 0 && rect.width > 0 && rect.height > 0
    && rect.left + rect.width <= 100 && rect.top + rect.height <= 100;
  return valid ? rect : fallback;
}

/* ИЗМЕРЕННЫЕ монтажные окна накладки → массив прямоугольников {left,top,width,height,aspect}
   СЛЕВА НАПРАВО в % фото. Немецкая накладка физически разделена импостами и несёт НЕСКОЛЬКО окон
   (mountRects), итальянская — ОДНО сплошное (mountRect). Значения снимаются детектором с фото
   (tools/detect-openings.mjs → catalog-vimar-openings.js) и подмешиваются в js/data.js.

   ОТЛИЧИЕ ОТ frameOpening: тот ВСЕГДА отдаёт один валидный прямоугольник (с дефолтом-догадкой по
   числу мест), а здесь принципиально вернуть null, когда измерений НЕТ (фото не разобралось или
   товар не из VIMAR) — по этому null postImage падает на splitOpening-фолбэк, а не рисует клавиши
   по выдуманному окну. count принят для симметрии с frameOpening (окна самодостаточны — несут
   свою геометрию, поэтому в расчётах здесь не участвует). */
function frameOpenings(item, count) {
  const parse = v => { if (typeof v === "string") { try { return JSON.parse(v); } catch { return null; } } return v; };
  const norm = r => {
    if (!r || typeof r !== "object") return null;
    const rect = {
      left: Number(r.left ?? r.x), top: Number(r.top ?? r.y),
      width: Number(r.width ?? r.w), height: Number(r.height ?? r.h)
    };
    if (Number(r.aspect) > 0) rect.aspect = Number(r.aspect);
    const ok = [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)
      && rect.left >= 0 && rect.top >= 0 && rect.width > 0 && rect.height > 0
      && rect.left + rect.width <= 100.5 && rect.top + rect.height <= 100.5;
    return ok ? rect : null;
  };
  const many = parse(item?.mountRects ?? item?.mount_rects);
  if (Array.isArray(many)) {
    const rects = many.map(norm).filter(Boolean);
    if (rects.length) return rects;
  }
  const one = norm(parse(item?.mountRect ?? item?.mount_rect ?? item?.frameOpening ?? item?.frame_opening));
  return one ? [one] : null;
}

/* ЛИЦЕВОЙ прямоугольник механизма → {left,top,width,height} в % ДЕТАЛЬНОГО фото, или null.
   Значения снимаются детектором (tools/detect-faces.mjs → catalog-vimar-faces.js) и подмешиваются
   в js/data.js полем faceRect. По этому прямоугольнику postImage обрезает фото механизма ровно под
   ячейку модуля (лицо накрывает ячейку, поля и монтажные лапки уезжают за overflow).

   Симметрично frameOpenings: принципиально вернуть null, когда лица НЕТ (фото не разобралось или
   товар не из VIMAR) — по этому null postImage рисует нарисованную клавишу-фолбэк, а не тянет
   отсутствующее фото. Принимаем и объект {left,top,width,height}, и массив [l,t,w,h] (как в
   генерируемом файле), и JSON-строку — чтобы не зависеть от формы хранения. */
function moduleFace(item) {
  let r = item?.faceRect ?? item?.face_rect ?? item?.face;
  if (typeof r === "string") { try { r = JSON.parse(r); } catch { r = null; } }
  if (Array.isArray(r)) r = { left: r[0], top: r[1], width: r[2], height: r[3] };
  if (!r || typeof r !== "object") return null;
  const rect = {
    left: Number(r.left ?? r.x), top: Number(r.top ?? r.y),
    width: Number(r.width ?? r.w), height: Number(r.height ?? r.h)
  };
  const ok = [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)
    && rect.left >= 0 && rect.top >= 0 && rect.width > 0 && rect.height > 0
    && rect.left + rect.width <= 100.5 && rect.top + rect.height <= 100.5;
  return ok ? rect : null;
}

/* Заглушка «нет фото» из выгрузки vimar.ru (…/no_photo.png) — единственный вид пустышки в
   каталоге. Она УСПЕШНО загружается, поэтому фолбэк «иконка под <img>» её не ловит и на
   экран лезет серый прямоугольник. Считаем такую картинку отсутствующей — тогда сработает
   обычный фолбэк (иконка/силуэт). */
const isPlaceholderImage = url => /no_photo/i.test(String(url || ""));

/* URL картинки товара: детальная (detail) или превью, в порядке приоритета; заглушки
   пропускаем и берём первую НАСТОЯЩУЮ. Нет настоящей — пустая строка (рисуем фолбэк). */
const productImage = (item, { detail = false } = {}) => {
  if (!item) return "";
  const preview = item.previewImageUrl || item.preview_image_url || "";
  const full = item.detailImageUrl || item.detail_image_url || item.imageUrl || item.image_url || "";
  const order = detail ? [full, preview] : [preview, full];
  return order.find(u => u && !isPlaceholderImage(u)) || "";
};

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { pluralRu, moduleWord, placeWord, mechanismSpan, productSeries, compatibleMechanisms, frameSlotCount, frameSlotCounts, frameSlotOptions, defaultPostName, frameOpening, frameOpenings, moduleFace, productImage, isPlaceholderImage };
if (typeof window !== "undefined") window.EPCatalog = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
