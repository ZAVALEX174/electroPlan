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
  return { rate: value, date: new Date().toISOString().slice(0, 10), source: "вручную" };
}

window.EPRates = { loadCached, fetchFresh, manual, URL_CBR, CACHE_KEY };
})();
