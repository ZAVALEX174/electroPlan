/* Правая панель (Редизайн 2 по макету дизайнера): сворачиваемые секции + выезжающая палитра на узких
   экранах. Разметку секций и тёмный блок «Итого» держит index.html, суммы в них пишет renderSummary
   (app.js) — этот модуль отвечает за ТРИ вещи, появившиеся вместе с новой панелью:
     1) память «открыто/закрыто» каждой секции — это ПРИВЫЧКА ЧЕЛОВЕКА, а не свойство проекта (как вид
        отделки): живёт в ep_prefs (EPPrefs), чужой проект её не переключает;
     2) строку «КП № …» в нижнем блоке «Итого» — её текст строит ЧИСТАЯ функция kpLine из ОДНОГО
        источника docHeader (§7.1), тем же путём, что и строку шапки (syncKpNumber зовут рядом с
        topbar.syncProjectName);
     3) выезд панели на экранах ≤1100: панель уходит за край (position:fixed), кнопка #rpToggle в шапке
        её выдвигает, Esc и клик вне — закрывают (как лёгкую выпадашку; модалки z-index 100 выше неё).

   Чистая функция без DOM/state (kpLine) тестируется и мутируется в Node; attach(ctx) — тонкая связка
   с DOM/EPPrefs, логики правил в ней нет. Двойной экспорт: браузеру — namespace, Node — module.exports
   (сборщика нет, PLAN 2.2). */
(() => {
"use strict";

/* Текст «КП № N» для тёмного блока «Итого по проекту». Пустой/пробельный номер → "" (нет номера —
   строки нет, решение владельца). ЕДИНСТВЕННОЕ место правила текста, второй копии нет. Номер может
   прийти числом (автонумерация) — приводим к строке и обрезаем пробелы, как в шапке. */
function kpLine(number) {
  const n = (number == null ? "" : String(number)).trim();
  return n ? "КП № " + n : "";
}

function attach(ctx) {
  const { $, docHeader, EPPrefs } = ctx;

  /* Память секций: один ключ ep_prefs на секцию. undefined (человек ни разу не трогал) → оставляем
     разметочный дефолт (open), не навязываем. Чтение/запись — через EPPrefs (там try/catch: битый
     LocalStorage или приватный режим не валят панель, предпочтение вида не критично). */
  [["paneProps", "rpOpenProps"], ["paneCost", "rpOpenCost"],
   ["paneScheme", "rpOpenScheme"], ["paneSpec", "rpOpenSpec"]].forEach(([id, key]) => {
    const el = $(id);
    if (!el) return;
    const saved = EPPrefs.get(key, undefined);
    if (saved === true) el.open = true; else if (saved === false) el.open = false;
    el.addEventListener("toggle", () => EPPrefs.set(key, !!el.open));
  });

  /* «КП № …» в нижнем блоке «Итого»: тот же источник docHeader, что у строки проекта в шапке (§7.1).
     Пустой текст = строки нет (span пуст). Зовут рядом с topbar.syncProjectName на всех путях, где
     меняется номер (правка в окне КП, загрузка/открытие проекта, автономер при печати). */
  function syncKpNumber() {
    const el = $("grandTotalKp");
    if (!el) return;
    el.textContent = kpLine((docHeader() || {}).number);
  }

  /* Выезжающая панель на узких экранах (≤1100): класс .open выдвигает её (CSS transform). isOpen
     ГЕЙТИМ шириной — класс .open мог остаться после возврата к широкому экрану, где панель снова в
     сетке и всегда видна; тогда Esc не должен «съедать» себя на закрытие вместо снятия инструмента. */
  const panel = $("rightPanel"), toggleBtn = $("rpToggle");
  const narrow = () => typeof matchMedia !== "undefined" && matchMedia("(max-width:1100px)").matches;
  function syncAria() {
    if (toggleBtn) toggleBtn.setAttribute("aria-expanded", panel && panel.classList.contains("open") ? "true" : "false");
  }
  function isOpen() { return !!panel && panel.classList.contains("open") && narrow(); }
  function open() { if (panel) { panel.classList.add("open"); syncAria(); } }
  function close() { if (panel) { panel.classList.remove("open"); syncAria(); } }
  function toggle() { if (panel) { panel.classList.contains("open") ? close() : open(); } }

  if (toggleBtn && panel) {
    toggleBtn.setAttribute("aria-haspopup", "true");
    toggleBtn.setAttribute("aria-expanded", "false");
    /* stopPropagation — чтобы собственное открытие не долетело до слушателя «клик вне» ниже. */
    toggleBtn.addEventListener("click", e => { e.stopPropagation(); toggle(); });
    /* Клик вне открытой панели — закрыть (на сам тумблер не реагируем: его клик гасим выше). Esc
       закрывает панель в общем Esc-диспетчере app.js (единый порядок закрытия окон), поэтому здесь
       клавиатуру не трогаем. */
    document.addEventListener("click", e => {
      if (isOpen() && !panel.contains(e.target) && !toggleBtn.contains(e.target)) close();
    });
  }

  return { syncKpNumber, isOpen, open, close, toggle };
}

const api = { kpLine, attach };
if (typeof window !== "undefined") window.EPRightPanel = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
