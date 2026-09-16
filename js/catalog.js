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

/* Коллекции (серии) товаров каталога — ВОСХОДЯЩИЙ список различных названий.
   Из него строится селектор «Коллекция комнаты» (E13) и валидируется room.collection: предлагаем
   ровно те коллекции, что реально есть у накладок, а не константу в разметке — появится новая
   серия в прайсе, и вариант возникнет сам (тем же приёмом, что frameSlotCounts для модульностей).
   Сортировка по локали ru — селектор должен идти по алфавиту, а не по порядку в прайсе. */
function productCollections(items) {
  const set = new Set();
  (items || []).forEach(item => productSeries(item).forEach(s => set.add(s)));
  return [...set].sort((a, b) => a.localeCompare(b, "ru-RU"));
}

/* Различные значения ОДНОГО признака отделки накладки (E14: frameMaterial|frameShape|frameColor) —
   восходящий список, как productCollections для серий. Из него строятся селекторы «Материал/Форма/
   Цвет накладки» в свойствах комнаты и валидируется room.<признак>: предлагаем ровно те значения,
   что реально есть у накладок, а не константу в разметке. Написания уже канонизированы конвертером
   (одно на признак), поэтому здесь только сбор различных и сортировка по локали ru. */
function productFacingValues(items, field) {
  const set = new Set();
  (items || []).forEach(item => { const v = item && item[field]; if (v) set.add(v); });
  return [...set].sort((a, b) => String(a).localeCompare(String(b), "ru-RU"));
}

/* Единый ключ сравнения ЦВЕТА между накладкой и начинкой (ОТДЕЛКА-ПОРЯДОК, п.4). Написания
   регистра/ё конвертер уже свёл (facingKey), но цвет накладки («Цвет накладки») и цвет начинки
   («Цвет элемента») — РАЗНЫЕ словари, различающиеся РОДОМ прилагательного: накладка «Белая» /
   «Чёрная» против механизма «Белый» / «Чёрный», «Белые матовые» против «Белая матовая». Сравнение
   равенством строк развело бы одну гамму на две, поэтому ключ дополнительно снимает родовое/
   числовое окончание с каждого слова (…ый/…ая/…ое/…ые → основа). Это ЕДИНСТВЕННОЕ место такого
   сведения (§7.1): и значение критерия (цвет накладки комнаты), и значение товара (цвет элемента)
   проходят через него в productsForRoom. Замер по каталогу: все 10 цветов элемента так сходятся
   к своей накладочной гамме 1:1; из 181 цвета накладок начинку того же цвета имеют 12 — у
   остальных отбор начинки по цвету ПУСТ (это законно, снимается галочкой поста, см. app.js). */
function facingColorKey(raw) {
  return String(raw || "")
    .toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim()
    .split(" ").map(t => t.replace(/(ый|ий|ой|ая|яя|ое|ее|ые|ие)$/, "")).join(" ");
}

/* Товары, подходящие помещению по его ОТДЕЛКЕ. criteria — объект-критерий: collection (E13, серия),
   материал/форма/цвет накладки (E14, frameMaterial/frameShape/frameColor) и цвет НАЧИНКИ
   (elementColor, ОТДЕЛКА-ПОРЯДОК п.4 — сравнивается через facingColorKey с цветом накладки комнаты).
   Каждый ключ — предикат
   И-цепочки, применяется, ТОЛЬКО если задан; пустой критерий целиком (нет коллекции/отделки у
   комнаты, пост вне комнат, шаблон) → фильтра нет: возвращаем КОПИЮ списка, чтобы вызывающий не
   мутировал исходный.

   ⚠️ СОВПАДЕНИЕ ПО КОЛЛЕКЦИИ — ЧЛЕНСТВО В МНОЖЕСТВЕ, А НЕ РАВЕНСТВО СТРОК. Накладка живёт в
   НЕСКОЛЬКИХ коллекциях сразу (в каталоге таких мультиколлекционных накладок 12; напр. арт. 14931 —
   в пяти: Arke, Arke Fit, Eikon Evo, Eikon Exe, Plana), и productSeries возвращает МАССИВ.
   Сравнение productSeries(item) === collection выкинуло бы мультиколлекционную накладку из её же
   коллекции, поэтому проверяем includes по массиву серий. (Механизм арт. 02970 «Термостат
   поворотный 2M» тоже в этих пяти коллекциях, но примером тут быть НЕ может: productsForRoom
   фильтрует ТОЛЬКО накладки — через него механизм не проходит никогда.)
   Сравнение РЕГИСТРОЗАВИСИМО — в отличие от compatibleMechanisms, который нормализует регистр обеих
   сторон. Здесь нормализация намеренно не делается: collection всегда приходит из productCollections
   (тот же источник, что и series товара) → регистр заведомо совпадает. Мусор ЛЮБОГО вида (иной
   регистр, пробелы, мёртвое — снятое из прайса — имя, не-строка) до сюда НЕ доходит: его отсекает
   РАНЬШЕ EPRoom.roomCollection, отдавая null («коллекция не задана»), а на null criteria.collection
   пуст → фильтра нет ещё выше по строке. Поэтому предиката includes достигают только валидные
   имена из того же productCollections, и его результат по построению НЕПУСТ.

   ⚠️ ОТДЕЛКА (E14) СРАВНИВАЕТСЯ РАВЕНСТВОМ СТРОК — и это осознанно иначе, чем коллекция. У накладки
   ровно ОДИН материал, ОДНА форма, ОДИН цвет (не массив, в отличие от серий), а написания уже
   канонизированы конвертером (nomenclature.mjs facingKey/canonicalFacingMap: регистр и ё сведены),
   поэтому и значение товара (frameMaterial/frameShape/frameColor), и значение критерия приходят из
   ОДНОГО источника (productFacingValues) с одинаковым написанием — членство/нормализация здесь не
   нужны. Мёртвое (снятое из прайса) значение отсекает EPRoom.roomFrameFacing → null → предикат не
   применяется, ровно как у коллекции.
   ⚠️ РЕЗУЛЬТАТ ОТДЕЛКИ МОЖЕТ БЫТЬ ПУСТ — и это законное состояние, а не сбой. Сочетание материал+
   цвет, под которое накладок нет, ДОЛЖНО дать пустой пул: collectionFramePool (js/app.js) больше НЕ
   подменяет пустой пул всем каталогом (иначе фильтр показал бы 1631 накладку вместо честного «под
   это сочетание накладок нет»), а renderBuilder объясняет пусто словами (E14, п.6). */
function productsForRoom(items, criteria) {
  const c = criteria || {};
  let out = (items || []).slice();
  if (c.collection) out = out.filter(item => productSeries(item).includes(c.collection));
  if (c.frameMaterial) out = out.filter(item => item && item.frameMaterial === c.frameMaterial);
  if (c.frameShape) out = out.filter(item => item && item.frameShape === c.frameShape);
  if (c.frameColor) out = out.filter(item => item && item.frameColor === c.frameColor);
  /* ⚠️ ЦВЕТ НАЧИНКИ — ОСОЗНАННО через facingColorKey, а не равенством строк (в отличие от отделки
     накладки выше). criteria.elementColor приходит ЦВЕТОМ НАКЛАДКИ комнаты (единственный цвет,
     заданный помещению), а item.elementColor — собственным цветом механизма из ДРУГОГО словаря
     (см. facingColorKey): равенство строк «Белая»≠«Белый» выкинуло бы всю белую начинку из белой
     комнаты. Так фильтр начинки — продолжение ТОГО ЖЕ productsForRoom, что сужает накладки, а не
     второй отбор рядом (§7.1). */
  if (c.elementColor) { const key = facingColorKey(c.elementColor); out = out.filter(item => item && item.elementColor && facingColorKey(item.elementColor) === key); }
  return out;
}

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

/* Ёмкость накладки в модулях: явное поле, иначе «на N модулей» из текста, иначе null.
   Поддерживаем 1..21: верхняя граница — самая большая реальная накладка каталога,
   многорядная 7+7+7. Двумерную геометрию не угадываем здесь: она уже лежит в
   frame.layoutRows и читается EPPosts.frameLayout всеми раскладками. Явная ёмкость
   авторитетна: если она есть, но вне диапазона — возвращаем null, НЕ выкусывая из
   названия «4 модуля» внутри ошибочного «24 модуля». */
function frameSlotCount(item) {
  if (!item) return null;
  const explicit = Number(item.slotCount ?? item.slots ?? item.placeCount);
  if (Number.isInteger(explicit) && explicit >= 1) return explicit <= 21 ? explicit : null;
  const text = [item.name, item.compatibility, item.properties?.compatibility].filter(Boolean).join(" ");
  const match = text.match(/(?:на|для)?\s*\b(21|20|1\d|[1-9])\s*(?:модул|мест|пост|module|slot|[mf]\b)/i);
  return match ? Number(match[1]) : null;
}

/* Существующие модульности накладок каталога — ВОСХОДЯЩИЙ список различных frameSlotCount.
   Селектор «Количество модулей рамки» строится ИЗ этого списка, а не из константы в разметке:
   размера, которого в номенклатуре нет (сейчас — 5 модулей), не предлагаем; появится
   5-модульная накладка — вариант возникнет сам, без правки кода. Многорядные 14/21
   входят тем же путём: frameSlotCount отдаёт общую ёмкость, а ряды 7+7/7+7+7
   остаются отдельным свойством frame.layoutRows. */
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
const api = { pluralRu, moduleWord, placeWord, mechanismSpan, productSeries, productCollections, productFacingValues, productsForRoom, facingColorKey, compatibleMechanisms, frameSlotCount, frameSlotCounts, frameSlotOptions, defaultPostName, frameOpening, frameOpenings, moduleFace, productImage, isPlaceholderImage };
if (typeof window !== "undefined") window.EPCatalog = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
