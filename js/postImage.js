/* Единое изображение собранного поста (решение владельца после двух неудачных заходов с
   фотографиями). ОДНА функция строит картинку и применяется во ВСЕХ местах: крупно в
   конструкторе, миниатюрой в библиотеке «Готовые посты», в подсказке на плане, в раскладке
   постов КП и в листе монтажника.

   ПОЧЕМУ СХЕМА, А НЕ ФОТО: фотографии механизмов в каталоге сняты порознь (своё поле,
   кадрирование, масштаб, фон). Встык внутри окна накладки они дают коллаж из разномасштабных
   картинок — правкой геометрии это не лечится (у VIMAR под сборку свои изображения, у нас их
   нет). Поэтому рисуем аккуратную схему целиком СВОИМИ средствами: накладка — прямоугольник
   цвета из каталога, модули — ячейки со значком-типом (самодельная SVG-иконка), номером и
   импостом между постами. Настоящие фото остаются только там, где смотрят на конкретное
   изделие (списки выбора EPPicker, «Одиночные элементы») — сюда они не приходят.

   КЛЮЧЕВОЕ: КП и лист монтажника уходят в ПЕЧАТЬ (отдельное окно без стилей приложения).
   Поэтому вся геометрия и цвета заданы ИНЛАЙН-СТИЛЯМИ (и инлайн-SVG для значков) прямо в
   разметке — один и тот же HTML одинаково рисуется и в приложении (innerHTML), и в окне
   печати (document.write). Никаких внешних картинок и шрифтовых иконок.

   Модуль чистый (как offerPdf.js/installSheet.js): на вход готовые данные (spec) и esc, на
   выход строка HTML. Ни state, ни DOM, ни доступ к каталогу. Логика цвета накладки
   (frameColor) и выбора значка (pickIcon) — отдельные чистые функции, покрыты автотестами.

   spec = {
     size: "lg" | "md" | "sm",              // конструктор / документ / миниатюра
     frame?: { name, code, color? },        // цвет накладки берётся из color, иначе из name
     rows: [ { posts: [ {                    // физические ряды накладки (двухрядная «4+4» → 2)
       capacity,                             // ёмкость поста в модулях
       cells: [ {                            // модули поста слева направо
         span,                               // ширина в модулях (2М-механизм вдвое шире 1М)
         categoryId?, icon?, name?,          // признаки функциональной группы → значок (pickIcon)
         num?,                               // номер модуля поста: «1» или «2–3»
         empty?                              // свободный модуль (не поломка — просто место)
       } ]
     } ] } ]
   }
   deps = { esc(s) }.
   Интерфейс приложению — window.EPPostImage.buildHtml(spec, deps). */
(() => {
"use strict";

/* Размеры под место применения. cellW — ширина одного модуля (px), cellRatio — во сколько
   раз ячейка выше своей ширины (накладка схематична, не в масштабе). На миниатюре (sm)
   значки и номера выключены (showIcons/showNums=false): при уменьшении они превратились бы
   в кашу, поэтому остаются только заливка, ячейки и импост (требование владельца). */
const SIZES = {
  lg: { cellW: 42, cellRatio: 1.4, pad: 11, border: 3, radius: 15, impost: 6, iconPx: 22, numFont: 10, showIcons: true, showNums: true, caption: true, capFont: 12 },
  md: { cellW: 24, cellRatio: 1.45, pad: 6, border: 2.5, radius: 10, impost: 4, iconPx: 14, numFont: 8, showIcons: true, showNums: true, caption: false, capFont: 10 },
  sm: { cellW: 13, cellRatio: 1.5, pad: 3, border: 2, radius: 6, impost: 2.5, iconPx: 0, numFont: 0, showIcons: false, showNums: false, caption: false, capFont: 8 }
};

/* Палитра цветов накладки. Значения VIMAR у накладок — в НАЗВАНИИ («…, белая», «карбон
   матовый»), отдельного поля color у рамок в рантайм-каталоге нет. Поэтому сопоставляем
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

/* Цвет накладки → полная палитра для отрисовки. Из семейства берём заливку и dark, остальное
   выводим так, чтобы читалось в обоих случаях: на ТЁМНОЙ накладке контур/грани/импост/чернила
   светлые (ink ≈ белый), на СВЕТЛОЙ — тёмные. Контур светлой накладки делаем тёмным намеренно:
   так почти-белая пластина видна на белом фоне приложения. Подписи-иконки поста рисуются
   цветом ink; подпись-артикул под накладкой лежит на фоне приложения и красится отдельно. */
function frameColor(name, explicit) {
  const key = String(explicit || name || "").toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
  const fam = COLOR_TABLE.find(e => e.keys.some(k => key.includes(k))) || NEUTRAL;
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

function buildHtml(spec, deps) {
  const esc = (deps && deps.esc) || (s => String(s == null ? "" : s));
  const s = SIZES[spec && spec.size] || SIZES.md;
  const rows = (spec && spec.rows) || [];
  const frame = (spec && spec.frame) || {};
  const pal = frameColor(frame.name, frame.color);

  /* Ширина сцены — от самого широкого ряда (в модулях), высота — от числа рядов. Ячейка
     одного модуля фиксированной ширины cellW, поэтому 2М-механизм ровно вдвое шире 1М. */
  const modulesWide = rows.reduce((m, r) => Math.max(m, (r.posts || []).reduce((a, p) => a + (Number(p.capacity) || 0), 0)), 0) || 1;
  const rowsCount = rows.length || 1;
  const innerW = modulesWide * s.cellW;
  const innerH = rowsCount * s.cellW * s.cellRatio + (rowsCount - 1) * s.impost;
  const W = Math.round(innerW + 2 * s.pad + 2 * s.border);
  const H = Math.round(innerH + 2 * s.pad + 2 * s.border);

  /* Один модуль поста. Пустой — просто ячейка с бледным номером слота (не поломка).
     Заполненный — самодельный значок типа + номер модуля. Ширина flex-пропорциональна span. */
  const cell = (c, last) => {
    const grow = Math.max(1, Number(c.span) || 1);
    const sep = last ? "" : `border-right:1px solid ${pal.cellLine};`;
    const num = s.showNums && c.num != null
      ? `<span style="font-family:Arial,sans-serif;font-weight:700;font-size:${s.numFont}px;line-height:1;color:${pal.ink}${c.empty ? ";opacity:.45" : ""}">${esc(c.num)}</span>`
      : "";
    if (c.empty) {
      return `<div data-ep="cell" style="flex:${grow} 1 0;min-width:0;display:flex;align-items:center;justify-content:center;${sep}">${num}</div>`;
    }
    const icon = s.showIcons ? iconSvg(pickIcon(c), s.iconPx, pal.ink) : "";
    return `<div data-ep="cell" title="${esc(c.name || "")}" style="flex:${grow} 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;overflow:hidden;${sep}">${icon}${num}</div>`;
  };
  /* Пост — модули вплотную; ширина пропорциональна его ёмкости. */
  const post = p => {
    const cells = p.cells || [];
    return `<div style="display:flex;flex:${Math.max(1, Number(p.capacity) || 1)} 1 0;min-width:0;align-items:stretch">${cells.map((c, i) => cell(c, i === cells.length - 1)).join("")}</div>`;
  };
  /* Импост — видимая перемычка между постами (и между рядами у двухрядных). Толще грани
     модулей и другого цвета, поэтому явно отличается от границ ячеек. Одна и та же полоса:
     во flex-строке даёт вертикальную перемычку, во flex-колонке — горизонтальную. */
  const impost = `<div data-ep="impost" style="flex:0 0 ${s.impost}px;align-self:stretch;background:${pal.impost};border-radius:1px"></div>`;
  const row = r => `<div style="display:flex;flex:1 1 0;min-height:0;align-items:stretch">${(r.posts || []).map(post).join(impost)}</div>`;

  /* Монтажное окно накладки — рамка внутри пластины: подчёркивает, что модули сидят в окне. */
  const windowZone = rows.length
    ? `<div style="flex:1 1 0;min-height:0;display:flex;flex-direction:column;border:1px solid ${pal.window};border-radius:${Math.max(3, s.radius - 6)}px;overflow:hidden">${rows.map(row).join(impost)}</div>`
    : `<div style="flex:1 1 0;border:1px solid ${pal.window};border-radius:${Math.max(3, s.radius - 6)}px"></div>`;

  /* Пластина накладки — прямоугольник со скруглением, залитый цветом из каталога. */
  const plate = `<div data-ep="plate" style="box-sizing:border-box;width:${W}px;height:${H}px;background:${pal.fill};border:${s.border}px solid ${pal.border};border-radius:${s.radius}px;padding:${s.pad}px;display:flex">${windowZone}</div>`;

  /* Подпись-артикул лежит на фоне приложения (вне пластины) — красим фиксированным тёмным,
     а не ink накладки, иначе на тёмной накладке она стала бы белой и пропала на белом фоне. */
  const caption = s.caption && (frame.name || frame.code)
    ? `<div style="margin-top:7px;font-family:Arial,sans-serif;font-size:${s.capFont}px;color:#48607a;text-align:center;max-width:${W}px">${frame.code ? `[${esc(frame.code)}] ` : ""}${esc(frame.name || "")}</div>`
    : "";

  return `<span class="assembled-post" style="display:inline-flex;flex-direction:column;align-items:center">${plate}${caption}</span>`;
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). frameColor/pickIcon вынесены в экспорт
   как самостоятельная чистая логика (тестируется отдельно от отрисовки). */
const api = { buildHtml, frameColor, pickIcon };
if (typeof window !== "undefined") window.EPPostImage = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
