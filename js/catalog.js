/* Каталог — чистая доменная логика над товарами прайса (PLAN 2.1).
   Модуль оперирует отдельными товарами (объектами прайса), которые приходят
   аргументами: ни state, ни DOM, ни money()/esc(). Accessor'ы product()/byKind()
   над state.products и генерация HTML (mechanismOptions/frameOptions/productPicture)
   остаются в app.js — им нужны состояние и разметка.

   Как estimate.js/geometry.js — без зависимостей приложения, под автотесты (PLAN 7.1).

   Интерфейс приложению — window.EPCatalog. */
(() => {
"use strict";

/* «1 модуль / 2 модуля / 5 модулей» — русское склонение. */
const moduleWord = count => `${count} ${count === 1 ? "модуль" : count >= 2 && count <= 4 ? "модуля" : "модулей"}`;

/* Сколько модулей рамки занимает механизм: явное поле, иначе «N модуль…» из названия, иначе 1. */
function mechanismSpan(item) {
  if (!item) return 0;
  const explicit = Number(item.moduleSpan ?? item.module_span ?? item.modules ?? item.moduleCount ?? item.properties?.moduleSpan);
  if (Number.isInteger(explicit) && explicit >= 1 && explicit <= 8) return explicit;
  const match = String(item.name || "").match(/(?:^|[\s,(])([1-8])\s*(?:модул|modules?|mod\b)/i);
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

/* URL картинки товара: детальная (detail) или превью, с падением одна на другую. */
const productImage = (item, { detail = false } = {}) => {
  if (!item) return "";
  const preview = item.previewImageUrl || item.preview_image_url || "";
  const full = item.detailImageUrl || item.detail_image_url || item.imageUrl || item.image_url || "";
  return detail ? (full || preview) : (preview || full);
};

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { moduleWord, mechanismSpan, productSeries, compatibleMechanisms, frameSlotCount, defaultPostName, frameOpening, productImage };
if (typeof window !== "undefined") window.EPCatalog = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
