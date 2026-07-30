/* Курс евро ЦБ РФ — загрузка и кэш.
   Модуль без состояния приложения: только сеть, LocalStorage и разбор ответа.
   Интерфейс приложению — window.EPRates.

   Про источник: официальный cbr.ru/scripts/XML_daily.asp НЕ отдаёт CORS-заголовки,
   поэтому из браузера напрямую недоступен. Берём зеркало cbr-xml-daily.ru — те же
   данные ЦБ, но с CORS. При переносе в Битрикс правильнее ходить на cbr.ru с сервера
   (AJAX-контроллер модуля) и кэшировать курс на сутки — см. PLAN.md 6.11. */
(() => {
"use strict";

const URL_CBR = "https://www.cbr-xml-daily.ru/daily_json.js";
const CACHE_KEY = "ep_eur_rate";
/* Метка источника «курс введён руками». Держим одной константой, чтобы
   effectiveRate() и manual() опирались на одно и то же значение, а не на
   разбросанные по коду строки-двойники. */
const SRC_MANUAL = "вручную";

/* Последний известный курс из LocalStorage. Возвращает {rate,date,source} либо null. */
function loadCached() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (c && c.rate > 0) return c;
  } catch (e) { /* битый кэш — просто игнорируем */ }
  return null;
}

function saveCached(entry) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(entry)); } catch (e) { /* квота */ }
}

/* Свежий курс ЦБ. Бросает исключение с понятным текстом — вызывающий решает,
   показывать ли его пользователю или молча остаться на прежнем курсе. */
async function fetchFresh() {
  const res = await fetch(URL_CBR, { cache: "no-store" });
  if (!res.ok) throw new Error("ЦБ РФ не ответил (" + res.status + ")");
  const data = await res.json();
  const value = data && data.Valute && data.Valute.EUR && data.Valute.EUR.Value;
  if (!(value > 0)) throw new Error("В ответе ЦБ РФ нет курса евро");
  const entry = {
    rate: Math.round(value * 10000) / 10000,
    date: String(data.Date || "").slice(0, 10),
    source: "ЦБ РФ"
  };
  saveCached(entry);
  return entry;
}

/* Курс, введённый руками: тот же формат записи, чтобы приложение не различало источники. */
function manual(rate) {
  const value = Number(rate);
  if (!(value > 0)) return null;
  return { rate: value, date: new Date().toISOString().slice(0, 10), source: SRC_MANUAL };
}

/* Эффективный курс пересчёта: рублей за 1 евро с учётом надбавки к курсу ЦБ.
   Правило заказчика (ЦентрСвет): цена = курс ЦБ × (1 + надбавка/100). Это ЕДИНАЯ
   точка формулы — и представление (money/displayRate), и текст КП берут значение
   отсюда, чтобы надбавка не расползлась копиями по коду и не разошлась при правках.
   Курс ЦБ в settings.eurRate хранится КАК ЕСТЬ (официальное значение) и здесь не
   переписывается — иначе приложение потеряло бы честный курс для текста КП.
   Курс, введённый вручную, — окончательный: надбавка к нему НЕ применяется, иначе
   пользователь не задаст точное значение (решение владельца, не менять). */
function effectiveRate(settings) {
  const s = settings || {};
  const rate = Number(s.eurRate);
  if (!(rate > 0)) return 0;                 /* курса нет — пересчитывать нечем */
  if (s.rateSource === SRC_MANUAL) return rate;
  const pct = Number(s.rateSurchargePercent) || 0;
  return rate * (1 + pct / 100);
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов effectiveRate (PLAN 7.1). */
const api = { loadCached, fetchFresh, manual, effectiveRate, URL_CBR, CACHE_KEY, SRC_MANUAL };
if (typeof window !== "undefined") window.EPRates = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
