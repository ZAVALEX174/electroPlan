/* Пользовательские предпочтения интерфейса — ПРИВЫЧКИ ЧЕЛОВЕКА, а не свойства проекта. Вид выбора
   отделки (списком / с картинками) про то, как человеку удобнее смотреть, и чужой проект не должен
   его переключать: поэтому такие настройки НЕ едут в снимок проекта (ProjectStore/terms), а живут
   отдельно, в одном ключе LocalStorage ep_prefs — не россыпью ключей. Значения плоские; читаем и
   пишем точечно (get/set по имени). Модуль без state и DOM.

   Битый JSON или недоступный LocalStorage (приватный режим, квота) не должны валить интерфейс:
   чтение возвращает fallback, запись молча пропускается — предпочтение вида не критично. */
(() => {
"use strict";

const KEY = "ep_prefs";

function readAll() {
  try {
    const obj = JSON.parse((typeof localStorage !== "undefined" && localStorage.getItem(KEY)) || "{}");
    return obj && typeof obj === "object" ? obj : {};
  } catch (e) {
    return {};
  }
}

function get(name, fallback) {
  const all = readAll();
  return Object.prototype.hasOwnProperty.call(all, name) ? all[name] : fallback;
}

function set(name, value) {
  const all = readAll();
  all[name] = value;
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch (e) {
    /* квота/приватный режим — предпочтение вида не критично, молча остаёмся на прежнем */
  }
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { get, set };
if (typeof window !== "undefined") window.EPPrefs = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
