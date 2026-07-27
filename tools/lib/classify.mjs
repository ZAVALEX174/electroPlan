/*
 * Классификация позиций прайса VIMAR: тип (kind), категория, иконка, серия.
 *
 * Логика перенесена из разового скрипта
 * outputs/db_price_import_20260723/build_db_price.mjs (сессия 2026-07-23),
 * чтобы каталог можно было пересобирать из репозитория, а не из песочницы Codex.
 * Держим её отдельным модулем без побочных эффектов — так её удобно
 * покрывать тестами и дорабатывать эвристику в Фазе 2.
 */

export const normalized = (value) => String(value ?? "").trim();
export const lower = (value) => normalized(value).toLocaleLowerCase("ru-RU");
const startsWithAny = (text, words) => words.some((word) => text.startsWith(word));
const hasAny = (text, words) => words.some((word) => text.includes(word));

const SERIES_CHECKS = [
  ["Eikon", /eikon/i],
  ["Arké", /ark[eé]/i],
  ["Idea", /\bidea\b/i],
  ["Plana", /\bplana\b/i],
  ["Linea", /\blinea\b/i],
  ["Neve", /\bneve\b/i],
  ["Classica", /\bclassica\b/i],
  ["By-me", /by-me/i],
  ["KNX", /\bknx\b/i],
  ["View Wireless", /view wireless/i],
  ["8000", /\b8000\b/i],
];

export function extractSeries(name) {
  return SERIES_CHECKS.filter(([, regex]) => regex.test(name)).map(([series]) => series);
}

/**
 * Определяет тип позиции и сопутствующие атрибуты по наименованию.
 * @param {string} name наименование из прайса
 * @returns {{categoryId:number, kind:string, icon:string, confidence:string, rule:string}}
 */
export function classify(name) {
  const text = lower(name);
  const accessoryPrefix = startsWithAny(text, [
    "накладк", "клавиш", "крышк", "суппорт", "адаптер", "корпус",
    "креплен", "винт", "кабел", "провод", "ремеш", "проставк", "протяжк",
  ]);
  const devicePrefix = startsWithAny(text, [
    "розетк", "выключател", "переключател", "кнопк", "диммер",
    "светорегулятор", "термостат", "датчик", "регулятор",
    "зарядное устройство", "разъем", "разъём",
  ]);
  const frameCandidate =
    hasAny(text, ["накладк", "рамк"]) &&
    /(?:\b[1-9]\s*(?:мод|пост|мест)|\b[1-9]f\b)/i.test(text) &&
    !hasAny(text, [
      "для розет", "для выключ", "для переключ", "для кноп",
      "для термостат", "для разъем", "для разъём", "для короб",
      "для суппорт", "защитная рамк",
    ]);
  const socketBoxCandidate =
    hasAny(text, ["подрозетник"]) ||
    (
      text.includes("коробк") &&
      hasAny(text, ["скрыт", "монтаж", "встраиваем", "полых стен", "кирпич"]) &&
      !accessoryPrefix
    );
  const modularHint =
    /(?:\b[1-9]\s*(?:мод|м\.|module)|\b[1-9]m\b)/i.test(text) ||
    hasAny(text, ["механизм", "eikon", "arké", "arke", "idea", "plana", "linea"]);

  let kind = "standalone";
  let confidence = "high";
  let rule = "default_standalone";

  if (frameCandidate) {
    kind = "frame";
    confidence = "medium";
    rule = "frame_by_cover_and_module_count";
  } else if (socketBoxCandidate) {
    kind = "socket_box";
    confidence = "high";
    rule = "socket_box_by_mounting_terms";
  } else if (devicePrefix && modularHint && !accessoryPrefix) {
    kind = "mechanism";
    confidence = "high";
    rule = "mechanism_by_device_and_module_terms";
  } else if (devicePrefix && !accessoryPrefix) {
    kind = "standalone";
    confidence = "medium";
    rule = "device_without_module_terms";
  } else if (accessoryPrefix) {
    kind = "standalone";
    confidence = "high";
    rule = "installation_accessory";
  } else {
    confidence = "medium";
    rule = "unmatched_standalone";
  }

  let categoryId = 1000;
  if (kind === "frame") {
    categoryId = 100;
  } else if (kind === "socket_box") {
    categoryId = 200;
  } else if (hasAny(text, ["usb", "rj", "lan", "hdmi", "телефон", "tv", "телевиз", "коакси", "аудио", "видео", "оптич"])) {
    categoryId = 400;
  } else if (hasAny(text, ["термостат", "температур", "климат", "фанкойл", "датчик"])) {
    categoryId = 700;
  } else if (hasAny(text, ["диммер", "светорегулятор", "освещен", "ламп", "светиль", "драйвер"])) {
    categoryId = 600;
  } else if (hasAny(text, ["knx", "by-me", "bluetooth", "zigbee", "enocean", "шлюз", "роутер", "актуатор", "умн"])) {
    categoryId = 800;
  } else if (hasAny(text, ["выключател", "переключател", "кнопк"])) {
    categoryId = 500;
  } else if (text.includes("розетк") && !hasAny(text, ["адаптер", "удлинител"])) {
    categoryId = 300;
  } else if (
    accessoryPrefix ||
    hasAny(text, ["монтаж", "крепеж", "крепёж", "заглушк", "коробк", "труб"])
  ) {
    categoryId = 900;
  }

  let icon = "•";
  if (kind === "frame") icon = "□";
  else if (kind === "socket_box") icon = "○";
  else if (categoryId === 300) icon = "◉";
  else if (categoryId === 400 && text.includes("usb")) icon = "USB";
  else if (categoryId === 400 && hasAny(text, ["rj", "lan"])) icon = "LAN";
  else if (categoryId === 400 && hasAny(text, ["tv", "телевиз"])) icon = "TV";
  else if (categoryId === 500) icon = "⌁";
  else if (categoryId === 600) icon = "◒";
  else if (categoryId === 700) icon = "°C";
  else if (categoryId === 800) icon = "BUS";

  return { categoryId, kind, icon, confidence, rule };
}

/** Человекочитаемые названия категорий (для справки/отладки). */
export const CATEGORY_NAMES = new Map([
  [100, "Рамки и декоративные накладки"],
  [200, "Монтажные коробки и подрозетники"],
  [300, "Силовые розетки"],
  [400, "Слаботочные розетки и интерфейсы"],
  [500, "Выключатели, переключатели и кнопки"],
  [600, "Светорегуляторы и управление светом"],
  [700, "Климат, термостаты и датчики"],
  [800, "Автоматизация и умный дом"],
  [900, "Монтажные аксессуары"],
  [1000, "Прочее оборудование"],
]);
