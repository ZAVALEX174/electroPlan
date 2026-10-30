/* Строка под холстом (Редизайн, часть 3 по макету дизайнера): режимы черчения «Орто/Сетка/шаг»
   переехали из левой панели в футер и всегда на виду (как статус-строка CAD). Этот модуль отвечает
   за ОДНУ новую вещь — горячие клавиши F8/F9: они переключают ТЕ ЖЕ чекбоксы #orthoToggle/#snapGridToggle,
   а не заводят вторую копию состояния. Чекбокс остаётся единственным источником истины (на нём висит
   onchange из app.js — state + сохранение), поэтому клавиша лишь инвертирует .checked и шлёт 'change',
   чтобы сработал существующий обработчик (§7.1: правило живёт в одном месте, у правки нет краёв).

   Гейты «не в поле ввода / не при открытой модалке» и preventDefault остаются в общем keydown app.js
   (там уже считаются typing/anyModalOpen для всех клавиш холста) — модуль их не дублирует, только
   выполняет само переключение. attach(ctx) — тонкая связка с DOM (образец js/rightPanel.js): логики
   правил в ней нет. Двойной экспорт: браузеру — namespace, Node — module.exports (сборщика нет, PLAN 2.2). */
(() => {
"use strict";

function attach(ctx) {
  const { $ } = ctx;

  /* Инвертировать чекбокс по id и отправить 'change' — тем же путём, каким его меняет мышь. Событие
     поднимаем bubbles:true, чтобы сработал и onchange-свойство, и делегированные слушатели; e.target
     внутри обработчика останется самим чекбоксом (его .checked уже новое). Нет узла — молчим (null-гейт
     как у соседних связок), горячая клавиша просто ничего не делает. */
  function flip(id) {
    const el = $(id);
    if (!el) return false;
    el.checked = !el.checked;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  /* F8 — Ортогонально, F9 — Привязка к сетке: один и тот же чекбокс, что и клик по кнопке-переключателю
     в футере. Возвращают true, когда переключение состоялось, — app.js по нему решает, гасить ли
     событие (preventDefault). */
  function toggleOrtho() { return flip("orthoToggle"); }
  function toggleGrid() { return flip("snapGridToggle"); }

  return { toggleOrtho, toggleGrid };
}

const api = { attach };
if (typeof window !== "undefined") window.EPCanvasBar = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
