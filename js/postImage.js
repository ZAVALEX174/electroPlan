/* Единое изображение собранного поста. ОДНА функция строит картинку и применяется во ВСЕХ
   местах: крупно в конструкторе, миниатюрой в библиотеке «Готовые посты», в подсказке на
   плане, в раскладке постов КП и в листе монтажника.

   ОРИЕНТИР — КАТАЛОЖНЫЕ СБОРКИ VIMAR (правка владельца 01.08 по страницам фирменного каталога
   Plana / Eikon Evo / Eikon Exé / Neve Up и странице немецко-французского стандарта 2+2 …
   2+2+2+2): собранное изделие — это накладка с ровными модулями в цвет/фактуру комплекта.

   МОДУЛЬ = НАСТОЯЩЕЕ ФОТО МЕХАНИЗМА, обрезанное по лицу (решение владельца: вариант A — фото,
   вариант C — нарисованная клавиша ОСТАЁТСЯ ФОЛБЭКОМ, когда фото нет). Причина возврата к фото:
   розетку, USB, RJ45, термостат нарисованной клавишей не передать — все выглядят как выключатель
   со значком. ЧЕМ ЭТОТ ЗАХОД ОТЛИЧАЕТСЯ ОТ ДВУХ ОТВЕРГНУТЫХ (тогда получался коллаж): прежде
   фотографию механизма вставляли ЦЕЛИКОМ (с полями кадра и монтажными лапками) в НЕВЕРНО
   посчитанное окно. Теперь (1) лицо механизма вырезано ДЕТЕРМИНИРОВАННО — механизмы VIMAR сняты
   фронтально, лицо 1М/2М/3М имеет ровную пропорцию span×22,5/45, детектор считает лицевой
   прямоугольник (tools/detect-faces.mjs → cell.face); (2) окно накладки под вставку измерено по
   фото (frameOpenings), а не угадано. Лицо растягивается CSS-спрайтом (width/height/left/top в %)
   ровно на ячейку — поля и лапки уезжают за overflow, коллажа нет. Символ функции поверх фото НЕ
   рисуем (на фото и так видно, что это) — значок остаётся только в фолбэке-клавише.
   ФОЛБЭК (нет imageUrl или нет face): ячейка рисуется САМА нарисованной клавишей (moduleKey) —
   тем же кодом, что и раньше; свободный модуль — по-прежнему клавиша-заглушка.

   ПОДЛОЖКА. Если у накладки есть настоящая ФОТОГРАФИЯ (frame.imageUrl) — она лежит фоном, а
   клавиши рисуются поверх неё в границах монтажного окна (геометрию окна в % фото даёт
   EPCatalog.frameOpening). Фото накладки нет — рисуем схему-фолбэк: пластину прямоугольником
   цвета из названия. КЛАВИШИ в обоих случаях рисуются ОДНИМ И ТЕМ ЖЕ кодом (moduleKey) — вид
   модуля единый, отличается только подложка.

   ГЛАВНОЕ ОТЛИЧИЕ НЕМЕЦКОГО И ИТАЛЬЯНСКОГО РАЗМЕЩЕНИЯ:
   • Итальянский стандарт — накладка это ОДНО сплошное окно: клавиши лежат встык слева направо
     (между ними лишь тонкий шов), никакого разделения на посты нет.
   • Немецкий стандарт (DE/FR: 09664 «2+2», 09666 «2+2+2», 09668 «2+2+2+2») — накладка
     ФИЗИЧЕСКИ разделена импостами на отдельные посты. В режиме фото эти импосты уже нарисованы
     самой накладкой, поэтому свою полосу-импост рисовать НЕ надо: мы лишь делим окно на N
     отдельных под-окон по постам (splitOpening) и раскладываем клавиши каждого поста В СВОЁ
     под-окно. В схеме-фолбэке (фото нет) импост между постами, наоборот, рисуем СВОЙ.

   КЛЮЧЕВОЕ: КП и лист монтажника уходят в ПЕЧАТЬ (отдельное окно без стилей приложения).
   Поэтому вся геометрия и цвета заданы ИНЛАЙН-СТИЛЯМИ (и инлайн-SVG для значков) прямо в
   разметке — один и тот же HTML одинаково рисуется и в приложении (innerHTML), и в окне
   печати (document.write). Никаких классов, внешних иконок и onerror-JS (в печати не
   исполнится); обычный CSS gradient/box-shadow инлайном — можно.

   ЦВЕТ КЛАВИШ — ПО САМОМУ МОДУЛЮ, а не по накладке (правка владельца 01.08): лицевая панель
   механизма это отдельный товар со своим цветом (в каталоге VIMAR цвет зашит в название:
   «…, карбон матовый», «…, белый»), поэтому белая накладка может нести серебристые клавиши, а
   антрацитовая — белые (Plana Silver). Цвет накладки идёт только на ПЛАСТИНУ схемы-фолбэка и
   служит последним фолбэком для клавиши неизвестного цвета.

   Модуль чистый (как offerPdf.js/installSheet.js): на вход готовые данные (spec) и esc, на
   выход строка HTML. Ни state, ни DOM, ни доступ к каталогу. Логика цвета (itemColor —
   и накладки, и клавиши; frameColor оставлен тонкой обёрткой), выбора значка (pickIcon) и
   деления немецкого окна на посты (splitOpening) — отдельные чистые функции, покрыты автотестами.

   spec = {
     size: "lg" | "md" | "sm",              // конструктор / документ / миниатюра
     frame?: {
       name, code,                          // цвет ПЛАСТИНЫ (схема-фолбэк) и запасной цвет клавиш — из name
       imageUrl?,                           // фото накладки-подложки (пусто → схема-фолбэк)
       standard?,                           // "DE"/"FR" → деление на посты; иначе сплошное окно
       opening?: { left, top, width, height, aspect }   // окно накладки в % фото (frameOpening)
     },
     rows: [ { posts: [ {                    // физические ряды накладки (двухрядная «4+4» → 2)
       capacity,                             // ёмкость поста в модулях
       cells: [ {                            // модули поста слева направо
         span,                               // ширина в модулях (2М-механизм вдвое шире 1М)
         imageUrl?,                          // ДЕТАЛЬНОЕ фото механизма (режим фото модуля); пусто → клавиша-фолбэк
         face?: { left, top, width, height },// лицевой прямоугольник в % фото (moduleFace); нет → фолбэк
         color?,                             // ЯВНЫЙ цвет клавиши-фолбэка; приоритетнее name
         categoryId?, icon?, name?,          // признаки функц. группы → значок фолбэка (pickIcon); из name — цвет клавиши
         num?,                               // номер модуля поста: «1» или «2–3»
         empty?                              // свободный модуль (не поломка — просто место); всегда клавиша-заглушка
       } ]
     } ] } ]
   }
   deps = { esc(s) }.
   Интерфейс приложению — window.EPPostImage.buildHtml(spec, deps). */
(() => {
"use strict";

/* Размеры под место применения. Режим ФОТО: base+per — ширина сцены (px) от числа модулей,
   высота выводится из аспекта окна накладки. Режим СХЕМЫ: cellW — ширина одного модуля (px),
   cellRatio — во сколько раз ячейка выше своей ширины. На миниатюре (sm) значки и номера
   выключены (showIcons/showNums=false): при уменьшении они превратились бы в кашу, поэтому
   остаются только фото/заливка и грани (требование владельца). */
const SIZES = {
  lg: { base: 120, per: 46, cellW: 42, cellRatio: 1.4, pad: 11, border: 3, radius: 15, impost: 6, iconPx: 22, numFont: 10, showIcons: true, showNums: true, caption: true, capFont: 12 },
  md: { base: 78, per: 26, cellW: 24, cellRatio: 1.45, pad: 6, border: 2.5, radius: 10, impost: 4, iconPx: 14, numFont: 8, showIcons: true, showNums: true, caption: false, capFont: 10 },
  sm: { base: 46, per: 16, cellW: 13, cellRatio: 1.5, pad: 3, border: 2, radius: 6, impost: 2.5, iconPx: 0, numFont: 0, showIcons: false, showNums: false, caption: false, capFont: 8 }
};

/* ЗАЗОР-ИМПОСТ между постами в режиме ФОТО — доля (0..1) от соответствующего размера окна
   накладки (ширины при делении ряда на посты, высоты при делении на ряды). Пропорция подобрана
   «на глаз» под немецкие накладки VIMAR: у 2+2 каждый пост ≈47% окна, между ними ≈6% под импост.
   Это то место, которое владелец будет крутить по картинке — вынесено сюда именованной
   константой, чтобы менять одним числом, не трогая геометрию. */
const IMPOST_GAP = 0.06;

/* КЛАВИШИ собранной накладки (ориентир — каталожные сборки VIMAR). Три числа владелец крутит
   по картинке:
   • KEY_SEAM — тонкий ШОВ между соседними клавишами, px по размеру (реализован как зазор во
     flex-строке клавиш);
   • KEY_RADIUS — скругление угла клавиши, px по размеру (в каталоге у клавиш едва заметное
     скругление ~2–3px на крупном размере);
   • KEY_LUMA_SHIFT — на сколько (0..255 по каналу) клавиша отличается по светлоте от накладки,
     чтобы отделяться от пластины: тёмная накладка → клавиша светлее, светлая → темнее. */
const KEY_SEAM = { lg: 3, md: 2, sm: 1 };
const KEY_RADIUS = { lg: 3, md: 2, sm: 1.5 };
const KEY_LUMA_SHIFT = 14;

/* ОБЩАЯ таблица цветов — и для накладки (пластина схемы-фолбэка), и для КЛАВИШИ (её цвет берём
   по названию/цвету самого механизма). Значения VIMAR — в НАЗВАНИИ товара («…, белая»,
   «карбон матовый»), отдельного поля color в рантайм-каталоге пока нет. Поэтому сопоставляем
   явной таблицей: список семейств, каждое — набор ключевых слов (по вхождению) → заливка и
   признак dark (тёмная накладка требует светлого контура/подписей). Порядок важен: более
   специфичные семейства идут раньше общих (сначала «карбон/чёрный», потом «серый»), иначе
   «чёрный лес» уехал бы в дерево, а «серебряный лёд» — в лёд. Неизвестный цвет → нейтральный
   серый (NEUTRAL). Ключ нормализуем: ё→е, нижний регистр. */
const COLOR_TABLE = [
  { keys: ["карбон"], fill: "#2c2f33", dark: true, label: "карбон" },
  { keys: ["антрацит"], fill: "#3b4046", dark: true, label: "антрацит" },
  { keys: ["черн", "nero", "сапфир", "венге", "черный лес"], fill: "#26282c", dark: true, label: "чёрный" },
  { keys: ["сланец", "ардезия", "лава", "графит"], fill: "#484d52", dark: true, label: "сланец" },
  { keys: ["орех", "макоре"], fill: "#5a4636", dark: true, label: "орех" },
  { keys: ["бронза", "бронзов"], fill: "#9c7248", dark: true, label: "бронза" },
  { keys: ["медь", "медн"], fill: "#a5673f", dark: true, label: "медь" },
  { keys: ["золото", "золот", "шампань", "латунь"], fill: "#c8a84f", dark: false, label: "золото" },
  { keys: ["коричнев", "кофе", "опал", "табак"], fill: "#6b5140", dark: true, label: "коричневый" },
  { keys: ["белы", "бела", "бело", "снежн"], fill: "#f4f5f2", dark: false, label: "белый" },
  { keys: ["слонов", "кость"], fill: "#efe7d5", dark: false, label: "слоновая кость" },
  { keys: ["крем"], fill: "#efe6d4", dark: false, label: "кремовый" },
  { keys: ["беж"], fill: "#e6d8c0", dark: false, label: "бежевый" },
  { keys: ["каррара", "калькутта", "латте"], fill: "#f0f1ee", dark: false, label: "мрамор" },
  { keys: ["горлиц"], fill: "#cfd2d0", dark: false, label: "горлица" },
  { keys: ["серебр", "silver"], fill: "#b6babf", dark: false, label: "серебристый" },
  { keys: ["никель"], fill: "#aeb2b6", dark: false, label: "никель" },
  { keys: ["металл"], fill: "#a9adb2", dark: false, label: "металлик" },
  { keys: ["алюмин"], fill: "#c2c5c8", dark: false, label: "алюминий" },
  { keys: ["титан"], fill: "#8e9296", dark: false, label: "титан" },
  { keys: ["жемчуг"], fill: "#c7c9cb", dark: false, label: "жемчуг" },
  { keys: ["кварц"], fill: "#9a9ea2", dark: false, label: "кварц" },
  { keys: ["сталь"], fill: "#9fa4a9", dark: false, label: "сталь" },
  { keys: ["лед", "ледян"], fill: "#dfe6e8", dark: false, label: "лёд" },
  { keys: ["аква"], fill: "#a9c6cf", dark: false, label: "аква" },
  { keys: ["дуб", "ясень", "эвкалипт", "сосна", "саванна", "степь", "выбелен"], fill: "#c2a172", dark: false, label: "дерево" },
  { keys: ["серый", "серая", "серое", "сер"], fill: "#a8acb1", dark: false, label: "серый" }
];
const NEUTRAL = { fill: "#c6cacf", dark: false, label: "—" };

/* Семейство цвета по тексту (название/явный цвет товара) → запись COLOR_TABLE или null, если
   цвет НЕ распознан. Отдельно от палитры намеренно: по null клавиша неизвестного цвета падает
   на цвет накладки (последний фолбэк), а накладка неизвестного цвета — на нейтральный серый. */
function colorFamily(text) {
  const key = String(text == null ? "" : text).toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
  if (!key) return null;
  return COLOR_TABLE.find(e => e.keys.some(k => key.includes(k))) || null;
}

/* Семейство цвета → полная палитра для отрисовки. Работает и для накладки (пластина + грани
   схемы-фолбэка), и для клавиши (её заливка/чернила символа). Из семейства берём заливку и dark,
   остальное выводим так, чтобы читалось в обоих случаях: на ТЁМНОМ фоне контур/грани/импост/
   чернила светлые (ink ≈ белый), на СВЕТЛОМ — тёмные. Контур светлой накладки делаем тёмным
   намеренно: так почти-белая пластина видна на белом фоне приложения. */
function paletteFromFamily(fam) {
  if (fam.dark) {
    return {
      label: fam.label, fill: fam.fill, dark: true,
      border: "rgba(255,255,255,.30)",   // светлый контур на тёмной пластине
      window: "rgba(255,255,255,.22)",   // рамка монтажного окна
      cellLine: "rgba(255,255,255,.16)", // тонкая грань между модулями
      impost: "rgba(255,255,255,.44)",   // импост — светлая перемычка
      ink: "#eef2f6"                     // значки/номера — светлые, читаемы на тёмном
    };
  }
  return {
    label: fam.label, fill: fam.fill, dark: false,
    border: "#33475c",
    window: "rgba(20,42,64,.18)",
    cellLine: "rgba(20,42,64,.14)",
    impost: "#33475c",                   // импост — тёмная перемычка на светлой пластине
    ink: "#2f4257"                       // значки/номера — тёмные, читаемы на светлом
  };
}

/* Цвет товара (накладки ИЛИ клавиши) по названию/явному полю → полная палитра. Неизвестный
   цвет → нейтральный серый (NEUTRAL). frameColor — тонкая обёртка над тем же кодом: имя
   сохранено для старого экспорта (на нём тесты и роль палитры пластины в схеме-фолбэке). */
function itemColor(name, explicit) {
  return paletteFromFamily(colorFamily(explicit) || colorFamily(name) || NEUTRAL);
}
function frameColor(name, explicit) {
  return itemColor(name, explicit);
}

/* Тип значка по ФУНКЦИОНАЛЬНОЙ ГРУППЕ товара, а не по фотографии. Первичный признак —
   categoryId (300 розетки, 400 слаботочка, 500 выключатели, 600 диммеры, 700 климат/датчики,
   800 умный дом, 900 аксессуары/клавиши, 1000 прочее). Внутри 400 и 700 уточняем символом
   icon (он тоже выведен из группы при сборке каталога) и словами названия. Нет categoryId —
   падаем на символ. Возвращает строковый тип, который iconMarkup рисует простыми фигурами. */
function pickIcon(cell) {
  const cat = Number(cell && cell.categoryId);
  const ch = String((cell && cell.icon) || "");
  const nm = String((cell && cell.name) || "").toLocaleLowerCase("ru-RU");
  if (cat === 300) return "socket";
  if (cat === 400) {
    if (ch === "USB" || nm.includes("usb")) return "usb";
    if (ch === "TV" || nm.includes("tv") || nm.includes("телеви") || nm.includes("коакси") || nm.includes("антен")) return "tv";
    return "lan";   // rj/lan/данные/аудио-видео — единый значок сетевого разъёма
  }
  if (cat === 500) return "switch";
  if (cat === 600) return "dimmer";
  if (cat === 700) return (nm.includes("датчик") || nm.includes("движен") || nm.includes("присут")) ? "sensor" : "thermostat";
  if (cat === 800) return "smart";
  if (cat === 900) return "key";
  if (cat === 1000) return ch === "•" ? "light" : "generic";
  const byChar = { "⌁": "switch", "◉": "socket", "USB": "usb", "LAN": "lan", "TV": "tv", "◒": "dimmer", "°C": "thermostat", "BUS": "smart", "•": "light", "○": "blank", "≡": "support" };
  return byChar[ch] || "generic";
}

/* Внутренняя разметка значка (viewBox 0 0 24 24). Обводка задаётся на <svg> цветом ink;
   заполненные элементы (отверстия розетки, узлы USB) красим тем же ink явно. Стиль у всех
   значков единый: тонкая обводка, скруглённые концы — чтобы в ряду они смотрелись однородно. */
function iconMarkup(type, ink) {
  const dot = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${ink}" stroke="none"/>`;
  switch (type) {
    case "switch":    return `<rect x="5" y="4.5" width="14" height="15" rx="3"/><line x1="9.2" y1="14.6" x2="14.8" y2="9.4"/>`;
    case "socket":    return `<circle cx="12" cy="12" r="7.4"/>${dot(9, 12, 1.35)}${dot(15, 12, 1.35)}`;
    case "usb":       return `<line x1="12" y1="4.6" x2="12" y2="19.4"/><path d="M9.6 8 L12 4.6 L14.4 8 Z" fill="${ink}" stroke="none"/>${dot(12, 19.4, 1.6)}<path d="M12 13 L8.6 13 L8.6 10.6"/><rect x="7.2" y="7.4" width="2.8" height="2.8" fill="${ink}" stroke="none"/><path d="M12 11 L15.4 11 L15.4 13.4"/>${dot(15.4, 14.6, 1.35)}`;
    case "lan":       return `<rect x="6.4" y="9" width="11.2" height="8" rx="1.2"/><line x1="12" y1="9" x2="12" y2="5.4"/><line x1="9" y1="17" x2="9" y2="19.2"/><line x1="12" y1="17" x2="12" y2="19.6"/><line x1="15" y1="17" x2="15" y2="19.2"/>`;
    case "tv":        return `<rect x="4.5" y="8" width="15" height="10.4" rx="1.6"/><line x1="12" y1="8" x2="8.2" y2="4.6"/><line x1="12" y1="8" x2="15.8" y2="4.6"/>`;
    case "dimmer":    return `<circle cx="12" cy="12" r="7"/><line x1="12" y1="12" x2="12" y2="6.6"/><line x1="6.6" y1="12" x2="8" y2="12"/><line x1="16" y1="12" x2="17.4" y2="12"/>`;
    case "thermostat":return `<path d="M12 4.6 L12 13"/><circle cx="12" cy="15.6" r="3"/>${dot(12, 15.6, 1.15)}<line x1="13.8" y1="7" x2="15.4" y2="7"/><line x1="13.8" y1="10" x2="15.4" y2="10"/>`;
    case "sensor":    return `${dot(12, 15, 1.55)}<path d="M8.5 13 A5 5 0 0 1 15.5 13"/><path d="M6.4 11 A8 8 0 0 1 17.6 11"/>`;
    case "smart":     return `<path d="M5 12 L12 5.4 L19 12"/><path d="M7 11 L7 18.6 L17 18.6 L17 11"/>`;
    case "light":     return `<circle cx="12" cy="10" r="5"/><line x1="9.6" y1="16.6" x2="14.4" y2="16.6"/><line x1="10.2" y1="18.6" x2="13.8" y2="18.6"/>`;
    case "key":       return `<rect x="6.6" y="5" width="10.8" height="14" rx="2.6"/>`;
    case "blank":     return `<rect x="6.6" y="6.6" width="10.8" height="10.8" rx="2.2"/>`;
    case "support":   return `<line x1="5" y1="8" x2="19" y2="8"/><line x1="5" y1="12" x2="19" y2="12"/><line x1="5" y1="16" x2="19" y2="16"/>`;
    default:          return `<rect x="6.6" y="6.6" width="10.8" height="10.8" rx="2.2"/>${dot(12, 12, 1.35)}`;
  }
}
function iconSvg(type, px, ink) {
  return `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="${ink}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex:0 0 auto">${iconMarkup(type, ink)}</svg>`;
}

/* Ёмкость поста в модулях (не меньше 1) — общий хелпер для деления и раскладки. */
const capOf = p => Math.max(1, Number(p && p.capacity) || 1);
const round2 = n => Math.round(n * 100) / 100;

/* Сдвиг светлоты hex-цвета на delta (−255..255) по каждому каналу. Из цвета накладки получаем
   цвет клавиши (чуть светлее/темнее — чтобы отделялась от пластины) и её блик/тень. Не #rrggbb
   на входе → возвращаем как есть (в таблице цветов накладок только hex-заливки). */
function shiftHex(hex, delta) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = shift => Math.max(0, Math.min(255, ((n >> shift) & 255) + delta));
  return "#" + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
}

/* Палитра клавиши по САМОМУ модулю: cell.color → cell.name → цвет накладки (последний фолбэк,
   чтобы клавиша неизвестного цвета не выглядела инородной). Клавиша — отдельный товар, её цвет
   не обязан совпадать с накладкой (VIMAR: белая накладка + серебристые клавиши). */
function cellPalette(cell, framePal) {
  const fam = colorFamily(cell && cell.color) || colorFamily(cell && cell.name);
  return fam ? paletteFromFamily(fam) : framePal;
}

/* Грани клавиши из её палитры keyPal. hi/lo — блик сверху и тень снизу для мягкого объёма, edge —
   тонкая грань по краю. КЛЮЧЕВОЕ: сдвиг светлоты KEY_LUMA_SHIFT нужен ТОЛЬКО когда цвет клавиши
   совпал с цветом накладки — иначе клавиша сольётся с пластиной. Если цвета РАЗНЫЕ, клавиша и так
   контрастна фону, и сдвигать её светлоту не нужно (иначе исказили бы каталожный цвет товара). */
function keyFaces(keyPal, framePal) {
  const sameAsFrame = keyPal.fill === framePal.fill;
  const shift = sameAsFrame ? (keyPal.dark ? KEY_LUMA_SHIFT : -KEY_LUMA_SHIFT) : 0;
  const fill = shiftHex(keyPal.fill, shift);
  return { fill, hi: shiftHex(fill, 12), lo: shiftHex(fill, -14), edge: keyPal.cellLine };
}

/* CSS-спрайт лица механизма: из лицевого прямоугольника face (проценты фото) считаем размеры и
   сдвиг <img>, чтобы ЛИЦО накрыло ячейку ровно 1:1, а поля кадра и монтажные лапки ушли за overflow.
   Математика (та же, что просил владелец): фото шире ячейки во столько, во сколько лицо у́же фото →
   width = 100%/face.width; сдвиг влево на долю лица от левого края → left = −face.left/face.width.
   Чистая функция (проверяется тестами на реальных числах); битые данные → null (падаем на клавишу). */
function faceSprite(face) {
  const f = { left: Number(face && face.left), top: Number(face && face.top), width: Number(face && face.width), height: Number(face && face.height) };
  const ok = [f.left, f.top, f.width, f.height].every(Number.isFinite) && f.width > 0 && f.height > 0;
  if (!ok) return null;
  return {
    width: 10000 / f.width,          // % ширины ячейки: фото во столько раз шире лица
    height: 10000 / f.height,        // % высоты ячейки
    left: -f.left * 100 / f.width,   // сдвиг фото влево, чтобы левый край лица встал в левый край ячейки
    top: -f.top * 100 / f.height     // сдвиг вверх — по тому же принципу
  };
}

/* Показывать ли ячейку ФОТОГРАФИЕЙ (а не нарисованной клавишей): модуль не пустой, есть фото и
   валидное лицо. Пустой модуль — всегда клавиша-заглушка (фото у него и нет). Чистая — под тесты. */
function useFacePhoto(cell) {
  return !!(cell && !cell.empty && cell.imageUrl && faceSprite(cell.face));
}

/* Ячейка модуля ФОТОГРАФИЕЙ механизма, обрезанной по лицу. Только CSS (в печать уходит, JS там не
   исполнится): контейнер overflow:hidden, <img> абсолютным слоем растянут спрайтом. Значок функции
   поверх НЕ рисуем — на фото видно, что это. edge — тонкая грань по краю: шов между соседними
   модулями оставляем (у каждого механизма на фото своя кромка, но грань помогает читать границу). */
function moduleFacePhoto(c, radius, edge, esc) {
  const grow = Math.max(1, Number(c.span) || 1);
  const sp = faceSprite(c.face);
  return `<div data-ep="cell" title="${esc(c.name || "")}" style="position:relative;flex:${grow} 1 0;min-width:0;overflow:hidden;border:1px solid ${edge};border-radius:${radius}px">`
    + `<img src="${esc(c.imageUrl)}" alt="${esc(c.name || "")}" style="position:absolute;width:${sp.width.toFixed(3)}%;height:${sp.height.toFixed(3)}%;left:${sp.left.toFixed(3)}%;top:${sp.top.toFixed(3)}%">`
    + `</div>`;
}

/* Одна КЛАВИША собранной накладки — ОБЩИЙ код для режима фото и схемы-фолбэка (вид модуля
   единый, требование владельца). Рисуем нарисованную клавишу: скруглённый прямоугольник в цвет
   комплекта с мягким бликом сверху и тенью снизу (инлайновый box-shadow допустим) и тонкой
   гранью по краю — читается как физическая клавиша, а не заливка. Ширина пропорциональна span
   (2М-механизм вдвое шире). Символ функции — мелко и приглушённо по центру клавиши; на sm значки
   выключены (превратились бы в кашу). Пустой модуль — такая же клавиша-заглушка, но БЕЗ символа
   (в реальности там ставится заглушка); на lg допустим бледный номер слота. */
function moduleKey(c, framePal, s, sizeKey, radius, esc) {
  const grow = Math.max(1, Number(c.span) || 1);
  /* РЕЖИМ ФОТО МОДУЛЯ: есть настоящее фото механизма и измеренное лицо → показываем фотографию,
     обрезанную по лицу (розетку/USB/RJ45/термостат клавишей не передать). Иначе — нарисованная
     клавиша-фолбэк ниже. Грань ячейки берём из палитры накладки (светлая на тёмной, тёмная на
     светлой) — читается шов между модулями и на фото, и в фолбэке. */
  if (useFacePhoto(c)) return moduleFacePhoto(c, radius, framePal.cellLine, esc);
  /* Цвет и контраст — по САМОМУ модулю (framePal лишь фолбэк): символ на клавише светлый на
     тёмной клавише и тёмный на светлой, независимо от цвета накладки под ней. */
  const keyPal = cellPalette(c, framePal);
  const key = keyFaces(keyPal, framePal);
  const face = `background:linear-gradient(180deg,${key.hi} 0%,${key.fill} 58%,${key.lo} 100%);`
    + `border:1px solid ${key.edge};border-radius:${radius}px;`
    + `box-shadow:inset 0 1px 0 ${keyPal.dark ? "rgba(255,255,255,.14)" : "rgba(255,255,255,.55)"},`
    + `inset 0 -1px 1px ${keyPal.dark ? "rgba(0,0,0,.32)" : "rgba(0,0,0,.12)"};`;
  if (c.empty) {
    const num = s.showNums && sizeKey === "lg" && c.num != null
      ? `<span style="font-family:Arial,sans-serif;font-weight:700;font-size:${s.numFont}px;line-height:1;color:${keyPal.ink};opacity:.4">${esc(c.num)}</span>`
      : "";
    return `<div data-ep="cell" style="flex:${grow} 1 0;min-width:0;display:flex;align-items:center;justify-content:center;${face}">${num}</div>`;
  }
  const icon = s.showIcons
    ? `<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:.55">${iconSvg(pickIcon(c), s.iconPx, keyPal.ink)}</span>`
    : "";
  return `<div data-ep="cell" title="${esc(c.name || "")}" style="position:relative;flex:${grow} 1 0;min-width:0;overflow:hidden;${face}">${icon}</div>`;
}

/* Окно накладки в % фото. Приводим к валидному прямоугольнику; неполные/битые данные → дефолт
   (пропорции «на 3 модуля»), чтобы модули не разъезжались за пределы кадра. */
function normalizeOpening(opening) {
  const d = { left: 21.5, top: 23, width: 57, height: 53.5, aspect: 1.39 };
  const o = opening || {};
  const rect = {
    left: Number(o.left), top: Number(o.top),
    width: Number(o.width), height: Number(o.height),
    aspect: Number(o.aspect) > 0 ? Number(o.aspect) : d.aspect
  };
  const ok = [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)
    && rect.width > 0 && rect.height > 0;
  return ok ? rect : d;
}

/* Деление окна НЕМЕЦКОЙ накладки на отдельные под-окна по постам (для режима фото).
   Вход: окно накладки opening (в % фото) и rows — те же ряды, что в spec. Выход: ПЛОСКИЙ
   массив прямоугольников {left,top,width,height} в % фото, по одному на пост, в порядке
   обхода «ряд за рядом, пост за постом» (совпадает с порядком отрисовки).

   Правила (владелец будет крутить IMPOST_GAP по картинке):
   • ширина поста в ряду пропорциональна его ёмкости в модулях;
   • между постами вычитается зазор под импост шириной IMPOST_GAP·(ширина окна);
   • многорядные накладки делятся ПО ВЕРТИКАЛИ тем же принципом: высота ряда пропорциональна
     его суммарной ёмкости, между рядами — такой же зазор от высоты окна;
   • суммарно под-окна + зазоры укладываются ровно в исходное окно (не выходят за границы и
     не пересекаются): контент = окно − все зазоры, дальше делим контент по пропорциям. */
function splitOpening(opening, rows) {
  const o = normalizeOpening(opening);
  const rs = (Array.isArray(rows) ? rows : []).filter(r => r && (r.posts || []).length);
  if (!rs.length) return [];

  const rowCaps = rs.map(r => (r.posts || []).reduce((a, p) => a + capOf(p), 0) || 1);
  const rowTotal = rowCaps.reduce((a, b) => a + b, 0);
  const vGap = o.height * IMPOST_GAP;                       // высота одного зазора между рядами
  const rowsContentH = Math.max(0, o.height - vGap * (rs.length - 1));

  const rects = [];
  let y = o.top;
  rs.forEach((r, ri) => {
    const rowH = rowsContentH * (rowCaps[ri] / rowTotal);
    const posts = r.posts || [];
    const caps = posts.map(capOf);
    const capTotal = caps.reduce((a, b) => a + b, 0) || 1;
    const hGap = o.width * IMPOST_GAP;                      // ширина одного зазора между постами
    const contentW = Math.max(0, o.width - hGap * (posts.length - 1));
    let x = o.left;
    posts.forEach((p, pi) => {
      const postW = contentW * (caps[pi] / capTotal);
      rects.push({ left: round2(x), top: round2(y), width: round2(postW), height: round2(rowH) });
      x += postW + hGap;
    });
    y += rowH + vGap;
  });
  return rects;
}

function buildHtml(spec, deps) {
  const esc = (deps && deps.esc) || (s => String(s == null ? "" : s));
  const sizeKey = spec && SIZES[spec.size] ? spec.size : "md";
  const s = SIZES[sizeKey];
  const rows = (spec && spec.rows) || [];
  const frame = (spec && spec.frame) || {};

  const modulesWide = rows.reduce((m, r) => Math.max(m, (r.posts || []).reduce((a, p) => a + capOf(p), 0)), 0) || 1;

  const stage = frame.imageUrl
    ? photoStage(frame, rows, s, sizeKey, modulesWide, esc)
    : schemaStage(frame, rows, s, sizeKey, modulesWide, esc);

  /* Подпись-артикул лежит на фоне приложения (вне сцены) — красим фиксированным тёмным, чтобы
     читалась и под тёмной накладкой, и на белом фоне. */
  const caption = s.caption && (frame.name || frame.code)
    ? `<div style="margin-top:7px;font-family:Arial,sans-serif;font-size:${s.capFont}px;color:#48607a;text-align:center;max-width:${stage.width}px">${frame.code ? `[${esc(frame.code)}] ` : ""}${esc(frame.name || "")}</div>`
    : "";

  /* max-width:100% ИНЛАЙНОМ (а не только классом): в печати КП/листа монтажника экранного CSS
     нет, а сцена и там должна вписываться в колонку/карточку, не вылезая за неё. */
  return `<span class="assembled-post" style="display:inline-flex;flex-direction:column;align-items:center;max-width:100%">${stage.html}${caption}</span>`;
}

/* Валидный прямоугольник окна {left,top,width,height} в % (aspect не нужен — высоту сцены даёт
   само фото). Битые данные → null: такой пост уедет на фолбэк-раскладку. */
function validRect(r) {
  const rect = { left: Number(r && r.left), top: Number(r && r.top), width: Number(r && r.width), height: Number(r && r.height) };
  const ok = [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;
  return ok ? rect : null;
}

/* Окна под посты в режиме ФОТО (чистая логика, покрыта тестами). Если пришли ИЗМЕРЕННЫЕ окна
   (windows — снятые детектором с фото накладки, EPCatalog.frameOpenings) и их число РОВНО совпало
   с числом постов — раскладываем пост i в окно i (порядок слева направо), без догадок об аспекте и
   импосте. Иначе — ФОЛБЭК splitOpening по угаданному окну: несовпадение числа окон и постов
   рискованно (непонятно, какой пост в какое окно ставить), поэтому не рискуем и делим окно сами
   (так же ведём себя, когда измерений нет вовсе — товар не из VIMAR или фото не разобралось).
   Возвращаем {rects, measured}: measured — признак «легли по фото», нужен тестам и отладке. */
function postWindows(opening, rows, windows) {
  const posts = [];
  (Array.isArray(rows) ? rows : []).forEach(r => ((r && r.posts) || []).forEach(p => posts.push(p)));
  const measured = Array.isArray(windows) ? windows.map(validRect).filter(Boolean) : null;
  if (measured && measured.length === posts.length && posts.length >= 1) {
    return { rects: measured, measured: true };
  }
  return { rects: splitOpening(opening, rows), measured: false };
}

/* РЕЖИМ ФОТО: подложка — ДЕТАЛЬНАЯ фотография накладки, КЛАВИШИ (moduleKey) поверх в границах
   монтажных окон. Каждый пост рисуется в СВОЁМ окне (пост i → окно i слева направо): у немецкой
   накладки окон несколько (импост уже на фото, свою полосу не рисуем), у итальянской — одно
   сплошное, клавиши в нём встык (шов KEY_SEAM). Геометрию окон даёт postWindows: измеренные окна
   с фото либо splitOpening-фолбэк.

   РЕЗИНОВАЯ СЦЕНА и РЕЗЕРВ ВЫСОТЫ. Внешний блок — ширина W, но не шире контейнера (max-width:100%);
   внутренний держит аспект ПРОЦЕНТНЫМ padding-top; слой клавиш — absolute поверх в %. Так % окна
   совпадают с % фото БЕЗ догадок об аспекте (раньше сцену тянули к guessed-аспекту с
   object-fit:contain, фото ложилось по центру, а окна считались в % сцены — клавиши уезжали за
   пластину), а фиксированная ширина больше не вылезает за узкое превью/колонку печати.

   Высота РЕЗЕРВИРУЕТСЯ ЗАРАНЕЕ самим padding-top (доля от ширины), не дожидаясь загрузки картинки:
   КП и лист монтажника печатают почти сразу (setTimeout в окне печати), а фото тянется с vimar.ru —
   без резерва к моменту печати высота нулевая и сборка схлопывается. Аспект берём ИЗМЕРЕННЫЙ из окна
   фото (frameOpenings несут aspect, снятый детектором по ЭТОМУ же фото), иначе — УГАДАННЫЙ
   opening.aspect. <img> лежит абсолютным слоем во всю сцену (inset:0, width/height 100%). Печать
   грузит тот же <img> так же (никаких классов/onerror-JS).

   Цвет каждой клавиши — по САМОМУ модулю (cellPalette внутри moduleKey); pal — палитра накладки,
   идёт лишь фолбэком цвета клавиши. */
function photoStage(frame, rows, s, sizeKey, modulesWide, esc) {
  const opening = normalizeOpening(frame.opening);
  const W = Math.round(s.base + modulesWide * s.per);
  const pal = itemColor(frame.name, frame.color);
  const seam = KEY_SEAM[sizeKey] || KEY_SEAM.md;
  const radius = KEY_RADIUS[sizeKey] || KEY_RADIUS.md;
  const keysRow = cells => cells.map(c => moduleKey(c, pal, s, sizeKey, radius, esc)).join("");

  const rects = postWindows(opening, rows, frame.windows).rects;
  let i = 0;
  const wins = [];
  rows.forEach(r => (r.posts || []).forEach(p => {
    const rect = rects[i++];
    if (!rect) return;
    wins.push(`<div style="position:absolute;left:${rect.left}%;top:${rect.top}%;width:${rect.width}%;height:${rect.height}%;display:flex;gap:${seam}px;align-items:stretch">`
      + keysRow(p.cells || []) + `</div>`);
  }));

  /* Аспект сцены: измеренный из ОКНА накладки (каждое несёт aspect самого фото — точный) либо
     угаданный из окна накладки (opening.aspect всегда задан normalizeOpening). */
  const measured = Array.isArray(frame.windows)
    ? (frame.windows.find(w => w && Number(w.aspect) > 0) || null)
    : null;
  const aspect = measured ? Number(measured.aspect) : opening.aspect;

  /* РЕЗИНОВАЯ СЦЕНА. Внешний блок — желаемая ширина W, но НЕ ШИРЕ контейнера (max-width:100%):
     иначе фиксированная W вылезала за узкое превью/колонку печати. Внутренний держит аспект
     через ПРОЦЕНТНЫЙ padding-top — процент считается от ШИРИНЫ, поэтому при сжатии высота
     уменьшается пропорционально, а % окон остаются точными сами собой (они и так в %). padding-%
     выбран вместо aspect-ratio намеренно: работает и в движке печати, и резервирует высоту
     ЗАРАНЕЕ — вёрстка не схлопывается до загрузки фото с vimar.ru (предохранитель прошлой задачи
     сохраняется и работает даже лучше). Фото и слой клавиш лежат абсолютным слоем поверх. Аспекта
     нет вообще (теоретически, opening.aspect всегда задан) — оставляем старое поведение: высоту
     задаёт сама картинка. */
  const inner = aspect > 0
    ? `position:relative;padding-top:${(100 / aspect).toFixed(3)}%;height:0`
    : "position:relative";
  const imgStyle = aspect > 0
    ? "position:absolute;inset:0;width:100%;height:100%"
    : "display:block;width:100%;height:auto";

  const html = `<div style="width:${W}px;max-width:100%">`
    + `<div style="${inner}">`
    + `<img src="${esc(frame.imageUrl)}" alt="${esc(frame.name || "Накладка")}" style="${imgStyle}">`
    + wins.join("") + `</div></div>`;
  return { html, width: W };
}

/* СХЕМА-ФОЛБЭК (фото накладки нет): накладка — прямоугольник цвета из названия, а КЛАВИШИ
   рисуются ТЕМ ЖЕ кодом (moduleKey), что и в режиме фото — вид модуля единый. Отличие фолбэка
   только в подложке (пластина вместо фото) и в том, что между постами рисуем СВОЙ импост
   (в режиме фото он уже на фотографии). Разбиение на посты сохраняется, как и в режиме фото.
   Пластина — цвета накладки (pal), клавиши — своего цвета (тем же moduleKey, что и в фото). */
function schemaStage(frame, rows, s, sizeKey, modulesWide, esc) {
  const pal = itemColor(frame.name, frame.color);
  const seam = KEY_SEAM[sizeKey] || KEY_SEAM.md;
  const radius = KEY_RADIUS[sizeKey] || KEY_RADIUS.md;
  const rowsCount = rows.length || 1;
  const innerW = modulesWide * s.cellW;
  const innerH = rowsCount * s.cellW * s.cellRatio + (rowsCount - 1) * s.impost;
  const W = Math.round(innerW + 2 * s.pad + 2 * s.border);
  const H = Math.round(innerH + 2 * s.pad + 2 * s.border);

  const post = p => {
    const cells = p.cells || [];
    return `<div style="display:flex;flex:${capOf(p)} 1 0;min-width:0;gap:${seam}px;align-items:stretch">`
      + cells.map(c => moduleKey(c, pal, s, sizeKey, radius, esc)).join("") + `</div>`;
  };
  /* Импост — видимая перемычка между постами (и между рядами у двухрядных). Одна и та же
     полоса: во flex-строке даёт вертикальную перемычку, во flex-колонке — горизонтальную. */
  const impost = `<div data-ep="impost" style="flex:0 0 ${s.impost}px;align-self:stretch;background:${pal.impost};border-radius:1px"></div>`;
  const row = r => `<div style="display:flex;flex:1 1 0;min-height:0;align-items:stretch">${(r.posts || []).map(post).join(impost)}</div>`;

  const windowZone = rows.length
    ? `<div style="flex:1 1 0;min-height:0;display:flex;flex-direction:column;border:1px solid ${pal.window};border-radius:${Math.max(3, s.radius - 6)}px;overflow:hidden">${rows.map(row).join(impost)}</div>`
    : `<div style="flex:1 1 0;border:1px solid ${pal.window};border-radius:${Math.max(3, s.radius - 6)}px"></div>`;

  /* РЕЗИНОВАЯ ПЛАСТИНА тем же приёмом, что режим фото: внешний блок — ширина W, но не шире
     контейнера; внутренний держит аспект W:H процентным padding-top (доля от ширины), сама
     пластина лежит абсолютным слоем inset:0. Так схема вписывается в узкое превью конструктора
     и в колонку печати, а не вылезает фиксированной шириной. box-sizing:border-box — рамка и
     паддинг внутри слоя. */
  const plate = `<div data-ep="plate" style="position:absolute;inset:0;box-sizing:border-box;background:${pal.fill};border:${s.border}px solid ${pal.border};border-radius:${s.radius}px;padding:${s.pad}px;display:flex">${windowZone}</div>`;
  const html = `<div style="width:${W}px;max-width:100%">`
    + `<div style="position:relative;padding-top:${(100 * H / W).toFixed(3)}%;height:0">${plate}</div></div>`;
  return { html, width: W };
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports для
   автотестов (PLAN 7.1). itemColor/frameColor/pickIcon/splitOpening/postWindows вынесены как
   самостоятельная чистая логика — тестируются отдельно от отрисовки (splitOpening владелец крутит
   по картинке, postWindows выбирает измеренные окна vs фолбэк). frameColor сохранён как тонкая
   обёртка над itemColor: на нём есть тесты и роль палитры пластины. faceSprite (проценты обрезки
   фото под ячейку) и useFacePhoto (фото или клавиша-фолбэк) — чистая логика режима фото модуля. */
const api = { buildHtml, itemColor, frameColor, pickIcon, splitOpening, postWindows, faceSprite, useFacePhoto };
if (typeof window !== "undefined") window.EPPostImage = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
