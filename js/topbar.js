/* Шапка приложения (P1-1, редизайн по макету дизайнера): три группы вместо девяти равных кнопок —
   иконки «Файл», кнопка «Данные проекта и КП», справа серый текст «проект · № КП», меню «Документы»
   и главная белая кнопка «КП в PDF». Разметку и обработчики самих кнопок (их ID НЕ менялись) держат
   index.html и app.js — этот модуль отвечает за ДВЕ новые вещи, появившиеся вместе с новой шапкой:
     1) строку «проект · № КП» справа — её текст строит ЧИСТАЯ функция projectLabel (ОДНА на все пути
        обновления, §7.1): ввод в полях, загрузка/открытие проекта и автономер при печати зовут один
        syncProjectName, который перечитывает docHeader и перерисовывает строку;
     2) выпадающее меню «Документы» — открытие/закрытие (клик/клик вне/Esc), клавиатура, aria.

   Чистая функция без DOM/state (projectLabel) тестируется и мутируется в Node; attach(ctx) — тонкая
   связка с DOM, логики правил в ней нет. Двойной экспорт: браузеру — namespace, Node — module.exports
   (сборщика нет, PLAN 2.2). */
(() => {
"use strict";

/* Текст строки проекта в шапке: «<проект> · КП № <номер>». Пустая часть НЕ показывается, обе пустые →
   "". Разделитель « · » появляется только МЕЖДУ двумя непустыми частями. Это ЕДИНСТВЕННОЕ место правила
   (§7.1) — все пути обновления зовут его через syncProjectName, второй копии текста нет. */
function projectLabel(project, number) {
  const p = (project == null ? "" : String(project)).trim();
  const n = (number == null ? "" : String(number)).trim();
  const parts = [];
  if (p) parts.push(p);
  if (n) parts.push("КП № " + n);
  return parts.join(" · ");
}

function attach(ctx) {
  const { $, docHeader } = ctx;
  const nameEl = $("headerProjectName");
  const dd = $("docsDd");
  const btn = $("docsBtn");
  const menu = dd ? dd.querySelector(".dd-menu") : null;

  /* Перечитать строку проекта из ОДНОГО источника (docHeader → EP_DATA.settings.docHeader) и показать.
     Строим ДВА span'а: имя проекта (.pn-project) и «· КП № …» (.pn-number). При нехватке места усадку
     CSS бьёт по имени (ellipsis), а номер оставляет видимым (решение владельца). Значения кладём через
     textContent (не innerHTML) — экранирование не нужно, подмена разметки невозможна. Сам элемент НЕ
     скрываем даже пустым: он служит распоркой (flex:1), прижимающей меню/«КП в PDF» вправо. Полный текст
     (projectLabel — ОДНО место правила, §7.1) кладём в title для всплывающей подсказки. */
  function syncProjectName() {
    if (!nameEl) return;
    const h = docHeader() || {};
    const p = (h.project == null ? "" : String(h.project)).trim();
    const n = (h.number == null ? "" : String(h.number)).trim();
    const full = projectLabel(p, n);
    nameEl.textContent = "";
    if (p) {
      const ps = document.createElement("span");
      ps.className = "pn-project";
      ps.textContent = p;
      nameEl.appendChild(ps);
    }
    if (n) {
      const ns = document.createElement("span");
      ns.className = "pn-number";
      ns.textContent = (p ? " · " : "") + "КП № " + n;
      nameEl.appendChild(ns);
    }
    if (full) nameEl.title = full; else nameEl.removeAttribute("title");
  }

  function items() {
    return menu ? Array.prototype.slice.call(menu.querySelectorAll(".dd-item")) : [];
  }
  function isOpen() { return !!dd && dd.classList.contains("open"); }
  function open() {
    if (!dd || isOpen()) return;
    dd.classList.add("open");
    if (btn) btn.setAttribute("aria-expanded", "true");
  }
  function close() {
    if (!dd || !isOpen()) return;
    dd.classList.remove("open");
    if (btn) btn.setAttribute("aria-expanded", "false");
  }
  function toggle() { isOpen() ? close() : open(); }

  if (dd && btn && menu) {
    btn.setAttribute("aria-haspopup", "menu");
    btn.setAttribute("aria-expanded", "false");
    /* stopPropagation, чтобы собственное открытие не долетело до слушателя «клик вне» ниже. */
    btn.onclick = e => { e.stopPropagation(); toggle(); };

    /* Выбор пункта-кнопки закрывает меню (действие уже пошло его обработчиком по ID из app.js). Клик
       по галке «кратно упаковке» меню НЕ закрывает — её переключают, не покидая списка документов. */
    menu.addEventListener("click", e => { if (e.target.closest(".dd-item")) close(); });

    /* Клик вне — закрыть, как у прочих выпадашек. */
    document.addEventListener("click", e => { if (isOpen() && !dd.contains(e.target)) close(); });

    /* Клавиатура ВНУТРИ шапочного меню: ↑/↓ ходят по пунктам. Гасим всплытие, чтобы стрелки не дошли
       до глобального document.onkeydown (там они двигают выделенный на холсте пост — был бы край).
       Esc здесь НЕ трогаем: его закрывает Esc-диспетчер app.js (единый порядок закрытия окон), поэтому
       событие должно до него долететь — stopPropagation на Esc не ставим. */
    dd.addEventListener("keydown", e => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const list = items();
      if (!list.length) return;
      e.preventDefault();
      e.stopPropagation();
      const i = list.indexOf(document.activeElement);
      const next = e.key === "ArrowDown"
        ? (i < 0 ? 0 : (i + 1) % list.length)
        : (i <= 0 ? list.length - 1 : i - 1);
      list[next].focus();
    });
  }

  return { syncProjectName, openDocsMenu: open, closeDocsMenu: close, isDocsMenuOpen: isOpen };
}

const api = { projectLabel, attach };
if (typeof window !== "undefined") window.EPTopbar = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
