/* Автонумерация коммерческих предложений (итоги встречи 24.08 §1.3: «Нумерация КП — EPG-2026-0001»).
   Формат и счётчик держим В ОДНОМ месте (§7.1), а не размножаем по местам печати: у правила
   «какой номер следующий» не должно быть краёв. app.js только вызывает assign() в момент сборки КП.

   РЕШЕНИЯ ВЛАДЕЛЬЦА, зашитые сюда:
   - счётчик один на все проекты браузера и живёт в бланке компании (EPPrefs), НЕ в проекте —
     поэтому состояние приходит аргументом (counters) и возвращается новым (чистая функция, без state);
   - год — год ДАТЫ КП (поле «Дата»), если она задана, иначе текущий: с 1 января нумерация
     начинается заново (EPG-2027-0001). Счётчик — ПО ГОДУ (объект {год: последний_номер}).
   - ручной номер программа не трогает и им счётчик не двигает (assigned=false), НО если он формата
     EPG-ГГГГ-NNNN и больше сохранённого — поднимаем «пол» его года, чтобы следующий автономер
     не столкнулся с уже вписанным (продолжаем после максимума).

   Модуль без state, DOM и EP_DATA — все зависимости приходят аргументами. */
(() => {
"use strict";

const PREFIX = "EPG";

/* Разбор номера формата EPG-ГГГГ-NNNN. Возвращаем {year, seq} или null для всего остального
   (пустое, ручной номер в чужом формате). Ведущие нули в NNNN допустимы (0001), длина ≥4. */
function parse(str) {
  const m = /^EPG-(\d{4})-(\d{4,})$/.exec(String(str == null ? "" : str).trim());
  return m ? { year: Number(m[1]), seq: Number(m[2]) } : null;
}

/* Сборка номера: префикс, год как есть, порядковый — 4 цифры с ведущими нулями (0001).
   Свыше 9999 padStart просто не добавит нулей — номер удлинится, что честнее обрезки. */
function format(year, seq) {
  return PREFIX + "-" + year + "-" + String(seq).padStart(4, "0");
}

/* Год для номера: из даты КП (ISO ГГГГ-ММ-ДД), иначе — текущий (now для тестируемости). */
function yearOf(date, now) {
  const m = /^(\d{4})-\d{2}-\d{2}$/.exec(String(date == null ? "" : date).trim());
  return m ? Number(m[1]) : (now instanceof Date ? now : new Date()).getFullYear();
}

/* Главная функция: решить, какой номер у КП, и вернуть НОВОЕ состояние счётчиков.
   counters — {год: последний_выданный_номер}; на вход не мутируем (чистота).
   opts: { current: текущий номер проекта, date: ISO-дата КП, now?: Date }.
   Возвращаем { number, counters, assigned }:
     - current непустой → берём его как есть, счётчик проекту не двигаем (assigned=false),
       но если он EPG-ГГГГ-NNNN выше пола своего года — поднимаем пол (защита от совпадения);
     - current пустой → выдаём следующий по году, поднимаем счётчик этого года (assigned=true). */
function assign(counters, opts) {
  const next = Object.assign({}, counters || {});
  const o = opts || {};
  const current = String(o.current == null ? "" : o.current).trim();

  /* Любой наблюдаемый ручной EPG-номер поднимает пол СВОЕГО года — чтобы автовыдача продолжила
     после него, а не наступила на уже вписанный (требование «продолжать после максимума»). */
  const parsed = parse(current);
  if (parsed && parsed.seq > (next[parsed.year] || 0)) next[parsed.year] = parsed.seq;

  if (current) return { number: current, counters: next, assigned: false };

  const year = yearOf(o.date, o.now);
  const seq = (next[year] || 0) + 1;
  next[year] = seq;
  return { number: format(year, seq), counters: next, assigned: true };
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { parse, format, yearOf, assign };
if (typeof window !== "undefined") window.EPOfferNumber = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
