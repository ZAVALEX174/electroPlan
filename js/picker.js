/* EPPicker — доступный кастомный выпадающий список с миниатюрами товаров.

   ЗАЧЕМ НЕ НАТИВНЫЙ <select>: в <option> нельзя вставить картинку (там только текст),
   а владелец просил миниатюру товара в НАЧАЛЕ строки. Поэтому виджет — надстройка НАД
   скрытым нативным <select>: тот остаётся единственным носителем значения (.value) и
   источником события change. Благодаря этому вся существующая логика конструктора поста
   (renderBuilder, fitMechanismIds*, разблокировка «Сохранить») работает без изменений —
   мы не заводим параллельную модель состояния. Структуру (опции, группы <optgroup>,
   выбранное) виджет читает из самого <select>, а картинку/цену/модули — из meta(value).

   Модуль трогает DOM — это UI-виджет, DOM его прямая задача, но про state приложения и
   EP_DATA он не знает: экранирование, данные строки и привязка фолбэков картинок приходят
   конфигом (esc, meta, onRender). Чистая логика фильтра поиска вынесена отдельной функцией
   filterOptions() и покрыта автотестами (сборщика нет — PLAN 2.2, двойной экспорт снизу).

   Namespace: window.EPPicker. */
(() => {
"use strict";

/* Разбор строки поиска на токены: нижний регистр (локаль ru — для корректного
   склеивания кириллицы), схлопнуть пробелы, выкинуть пустые. Регистронезависимость —
   требование задачи. */
function queryTokens(query){
  return String(query == null ? "" : query).toLocaleLowerCase("ru-RU").trim().split(/\s+/).filter(Boolean);
}

/* ЧИСТАЯ функция фильтра (под автотесты): вернуть подмножество options, у которых
   searchText содержит ВСЕ токены запроса (И-логика — «plana 3» находит «Plana 3М»).
   Пустой запрос — все опции (копия массива, чтобы вызывающий не мутировал исходный).
   searchText каждой опции формирует приложение из артикула и названия. */
function filterOptions(options, query){
  const tokens = queryTokens(query);
  if(!tokens.length) return (options || []).slice();
  return (options || []).filter(opt => {
    const hay = String(opt && opt.searchText || "").toLocaleLowerCase("ru-RU");
    return tokens.every(t => hay.includes(t));
  });
}

/* ——— Ниже DOM-виджет. Одновременно открыт только один список: держим ссылку,
   чтобы открытие нового и клик мимо надёжно закрывали предыдущий. ——— */
let openInstance = null;
let uidCounter = 0;

/* Читает модель из нативного <select>: верхнеуровневые <option> (пустая «очистить/
   плейсхолдер») и группы <optgroup> с их опциями. Значение опции — её value как есть
   (строка), совпадает с тем, что кладёт select.value. */
function readModel(selectEl){
  const lead = [];        /* опции без группы (обычно одна пустая — «Убрать элемент») */
  const groups = [];      /* [{label, options:[{value,text}]}] в порядке следования */
  Array.prototype.forEach.call(selectEl.children, node => {
    if(node.tagName === "OPTGROUP"){
      const options = Array.prototype.map.call(node.querySelectorAll("option"), o => ({ value: o.value, text: o.textContent }));
      groups.push({ label: node.getAttribute("label") || "", options });
    } else if(node.tagName === "OPTION"){
      lead.push({ value: node.value, text: node.textContent });
    }
  });
  return { lead, groups };
}

/* Доступное имя для кнопки: явный aria-label селекта (у слотов он есть) или текст
   связанного <label> (у накладки). Нужно, чтобы кнопка называлась так же, как раньше
   назывался select. */
function accessibleName(selectEl){
  const aria = selectEl.getAttribute("aria-label");
  if(aria) return aria;
  const label = selectEl.labels && selectEl.labels[0];
  return label ? label.textContent.trim() : "";
}

function enhance(selectEl, config){
  if(!selectEl) return null;
  /* повторный вызов на том же селекте (renderBuilder перерисовывает накладку каждый
     раз) — сначала снести прошлый виджет, чтобы не плодить кнопки и слушатели */
  if(selectEl.__epkDestroy) selectEl.__epkDestroy();

  const esc = config.esc || (s => String(s == null ? "" : s));
  const meta = config.meta || (() => null);
  const onRender = config.onRender || (() => {});
  const searchPlaceholder = config.searchPlaceholder || "Поиск";
  /* «Среди чего» ищем — для внятного пустого состояния (строка или функция, чтобы
     оркестратор мог вычислить контекст на момент фильтра). resolveMissing(query) —
     необязательный доменный хук: когда фильтр не нашёл ничего, но артикул ЕСТЬ в
     каталоге и отсеян текущим фильтром, оркестратор возвращает описание и (для
     накладок) действие «переключить». Виджет про каталог не знает — только рисует. */
  const emptyContext = config.emptyContext;
  const resolveMissing = config.resolveMissing;
  const id = "epk" + (++uidCounter);

  /* нативный select прячем, но НЕ удаляем — он носитель значения и события change;
     tabindex/aria-hidden убирают его из таб-порядка и из озвучки скринридера */
  selectEl.classList.add("epk-native");
  selectEl.setAttribute("tabindex", "-1");
  selectEl.setAttribute("aria-hidden", "true");

  const wrap = document.createElement("div");
  wrap.className = "epk";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "epk-button";
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");
  const name = accessibleName(selectEl);
  if(name) button.setAttribute("aria-label", name);

  /* кнопку и (скрытый) select держим в одной обёртке, вставленной на место селекта */
  selectEl.parentNode.insertBefore(wrap, selectEl);
  wrap.appendChild(selectEl);
  wrap.appendChild(button);

  let pop = null;         /* popup в document.body (чтобы не обрезался overflow модалки) */
  let listEl = null;
  let searchEl = null;
  let emptyMsgEl = null;
  let rowEls = [];        /* строки-опции в порядке отрисовки (для клавиатуры/фильтра) */
  let visibleRows = [];   /* подмножество rowEls, видимое при текущем фильтре */
  let activeIndex = -1;
  let pendingAction = null;  /* действие подсказки пустого состояния (Enter/клик) — см. renderEmptyMessage */

  /* —— свёрнутая кнопка: миниатюра + подпись выбранного —— */
  function selectedText(){
    const opt = selectEl.options[selectEl.selectedIndex];
    return opt ? opt.textContent : "";
  }
  function renderButton(){
    const value = selectEl.value;
    const m = meta(value);
    button.classList.toggle("is-empty", !m);
    if(m){
      button.innerHTML =
        `<span class="epk-thumb">${m.picture}</span>` +
        `<span class="epk-btn-label">${esc("[" + m.code + "] " + m.name)}</span>` +
        `<span class="epk-caret" aria-hidden="true"></span>`;
    } else {
      button.innerHTML =
        `<span class="epk-btn-label epk-btn-placeholder">${esc(selectedText())}</span>` +
        `<span class="epk-caret" aria-hidden="true"></span>`;
    }
    onRender(button);
  }

  /* —— одна строка списка: миниатюра СЛЕВА, артикул, название, цена (+модули) —— */
  function rowHtml(value, text, optionId, selected){
    const m = meta(value);
    if(!m){
      /* пустая опция («Убрать элемент» / плейсхолдер) — простой строкой без картинки */
      return `<div class="epk-option is-empty" role="option" id="${optionId}" data-value="${esc(value)}"` +
        ` aria-selected="${selected ? "true" : "false"}">${esc(text)}</div>`;
    }
    const modules = m.metaText ? `<span class="epk-omod">${esc(m.metaText)}</span>` : "";
    return `<div class="epk-option" role="option" id="${optionId}" data-value="${esc(value)}"` +
      ` data-search="${esc((m.searchText || "").toLocaleLowerCase("ru-RU"))}"` +
      ` aria-selected="${selected ? "true" : "false"}">` +
        `<span class="epk-thumb">${m.picture}</span>` +
        `<span class="epk-otext"><span class="epk-ocode">${esc("[" + m.code + "]")}</span>` +
          `<span class="epk-oname">${esc(m.name)}</span></span>` +
        `<span class="epk-ometa"><span class="epk-oprice">${esc(m.priceText)}</span>${modules}</span>` +
      `</div>`;
  }

  function buildList(){
    const model = readModel(selectEl);
    const currentValue = selectEl.value;
    let html = "";
    let idx = 0;
    /* верхнеуровневые опции (очистить/плейсхолдер) — вне групп, фильтру не подвластны */
    model.lead.forEach(opt => {
      html += rowHtml(opt.value, opt.text, id + "-o" + (idx++), opt.value === currentValue);
    });
    model.groups.forEach((group, gi) => {
      html += `<div class="epk-group" data-group="${gi}">${esc(group.label)}</div>`;
      group.options.forEach(opt => {
        html += rowHtml(opt.value, opt.text, id + "-o" + (idx++), opt.value === currentValue);
      });
    });
    listEl.innerHTML = html;
    emptyMsgEl.hidden = true;
    onRender(listEl);   /* фолбэки картинок навешиваются приложением */
    rowEls = Array.prototype.slice.call(listEl.querySelectorAll(".epk-option"));
  }

  /* Применить фильтр: спрятать не подходящие строки и пустые группы, пересобрать
     visibleRows и подсветить первую (или ранее выбранную) строку. Список НЕ
     перерисовывается — только переключаются атрибуты hidden (картинки не грузятся заново). */
  function applyFilter(){
    const query = searchEl.value;
    /* один проход фильтра на все строки-товары: filterOptions токенизирует запрос один
       раз и возвращает те же объекты, поэтому по .row собираем множество видимых.
       Пустая опция («Убрать элемент») поиску не подвластна — всегда видима. */
    const productRows = rowEls.filter(row => !row.classList.contains("is-empty"));
    const matched = new Set(
      filterOptions(productRows.map(row => ({ row, searchText: row.getAttribute("data-search") })), query)
        .map(hit => hit.row)
    );
    rowEls.forEach(row => {
      row.hidden = !(row.classList.contains("is-empty") || matched.has(row));
    });
    /* пустые группы прячем при активном поиске */
    listEl.querySelectorAll(".epk-group").forEach(header => {
      let node = header.nextElementSibling, hasVisible = false;
      while(node && node.classList.contains("epk-option")){
        if(!node.hidden){ hasVisible = true; break; }
        node = node.nextElementSibling;
      }
      header.hidden = !hasVisible;
    });
    visibleRows = rowEls.filter(row => !row.hidden);
    /* «Ничего не найдено» — про ТОВАРНЫЕ строки: пустая опция «Убрать элемент» видна
       всегда и не должна прятать сообщение (у слотов механизмов она есть, у накладки —
       нет). Показываем подсказку только при непустом запросе — иначе при первом
       открытии список просто полон. */
    const productVisible = visibleRows.some(row => !row.classList.contains("is-empty"));
    const querying = searchEl.value.trim().length > 0;
    const showEmpty = !productVisible && querying;
    emptyMsgEl.hidden = !showEmpty;
    if(showEmpty) renderEmptyMessage(); else pendingAction = null;
    /* активной делаем выбранную, если она видима, иначе первую видимую */
    const selectedVisible = visibleRows.findIndex(row => row.getAttribute("aria-selected") === "true");
    setActive(selectedVisible >= 0 ? selectedVisible : (visibleRows.length ? 0 : -1), false);
  }

  /* Пустое состояние с внятной причиной (PLAN: понятная пустота). Базовая строка
     говорит, СРЕДИ ЧЕГО искали. Если оркестратор через resolveMissing нашёл этот
     артикул в каталоге, но он отсеян фильтром — показываем товар, причину и, где есть
     смысл, кнопку действия (для накладки — «переключить число модулей и выбрать»).
     Всё пользовательское — через esc(); действие запускает переданный onAction. */
  function renderEmptyMessage(){
    pendingAction = null;
    const context = typeof emptyContext === "function" ? emptyContext() : emptyContext;
    const base = context ? `Ничего не найдено среди ${esc(context)}` : "Ничего не найдено";
    let html = `<div class="epk-empty-base">${base}</div>`;
    const hit = resolveMissing ? resolveMissing(searchEl.value.trim()) : null;
    if(hit){
      const codeName = esc(`[${hit.code}] ${hit.name}`);
      const note = hit.note ? ` — ${esc(hit.note)}` : "";
      html += `<div class="epk-empty-found">`;
      if(hit.lead) html += `<div class="epk-empty-lead">${esc(hit.lead)}</div>`;
      html += `<div class="epk-empty-item">${codeName}${note}</div>`;
      if(hit.reason) html += `<div class="epk-empty-reason">${esc(hit.reason)}</div>`;
      if(hit.actionLabel && typeof hit.onAction === "function")
        html += `<button type="button" class="epk-empty-action">${esc(hit.actionLabel)}</button>`;
      html += `</div>`;
    }
    emptyMsgEl.innerHTML = html;
    if(hit && hit.actionLabel && typeof hit.onAction === "function"){
      pendingAction = hit.onAction;
      const btn = emptyMsgEl.querySelector(".epk-empty-action");
      /* действие перестраивает конструктор и сносит этот виджет — сначала закрываем
         popup, потом запускаем, чтобы не дёргать уже удаляемый узел */
      if(btn) btn.addEventListener("click", () => { const run = pendingAction; close(false); run(); });
    }
  }

  function setActive(index, scroll){
    if(activeIndex >= 0 && visibleRows[activeIndex]) visibleRows[activeIndex].classList.remove("active");
    activeIndex = index;
    if(activeIndex >= 0 && visibleRows[activeIndex]){
      const row = visibleRows[activeIndex];
      row.classList.add("active");
      listEl.setAttribute("aria-activedescendant", row.id);
      if(scroll) row.scrollIntoView({ block: "nearest" });
    } else {
      listEl.removeAttribute("aria-activedescendant");
    }
  }

  function moveActive(delta){
    if(!visibleRows.length) return;
    let next = activeIndex + delta;
    if(next < 0) next = 0;
    if(next > visibleRows.length - 1) next = visibleRows.length - 1;
    setActive(next, true);
  }

  /* Позиционируем popup через position:fixed от прямоугольника кнопки — так список не
     обрезается overflow-скроллом модалки и не вызывает горизонтальную прокрутку.
     Не хватает места снизу и сверху больше — раскрываемся вверх; ширину прижимаем к
     ширине кнопки (но не уже 260px), left клампим в вьюпорт. */
  function position(){
    const r = button.getBoundingClientRect();
    const margin = 8, gap = 4;
    const width = Math.min(Math.max(r.width, 260), window.innerWidth - margin * 2);
    let left = r.left;
    if(left + width > window.innerWidth - margin) left = window.innerWidth - margin - width;
    if(left < margin) left = margin;
    const spaceBelow = window.innerHeight - r.bottom - margin;
    const spaceAbove = r.top - margin;
    const maxH = Math.min(340, Math.max(spaceBelow, spaceAbove) - gap);
    pop.style.width = width + "px";
    pop.style.left = left + "px";
    pop.style.maxHeight = maxH + "px";
    if(spaceBelow >= 220 || spaceBelow >= spaceAbove){
      pop.style.top = (r.bottom + gap) + "px";
      pop.style.bottom = "auto";
    } else {
      pop.style.top = "auto";
      pop.style.bottom = (window.innerHeight - r.top + gap) + "px";
    }
  }

  function open(){
    if(openInstance && openInstance !== instance) openInstance.close(false);
    if(pop) return;
    openInstance = instance;
    pop = document.createElement("div");
    pop.className = "epk-pop";
    pop.innerHTML =
      `<div class="epk-search-wrap"><input type="text" class="epk-search" role="combobox"` +
        ` aria-expanded="true" aria-controls="${id}-list" aria-autocomplete="list"` +
        ` placeholder="${esc(searchPlaceholder)}" aria-label="${esc(searchPlaceholder)}"></div>` +
      `<div class="epk-list" id="${id}-list" role="listbox"${name ? ` aria-label="${esc(name)}"` : ""}></div>` +
      `<div class="epk-empty-msg" hidden>Ничего не найдено</div>`;
    document.body.appendChild(pop);
    listEl = pop.querySelector(".epk-list");
    searchEl = pop.querySelector(".epk-search");
    emptyMsgEl = pop.querySelector(".epk-empty-msg");
    buildList();
    applyFilter();
    position();
    button.setAttribute("aria-expanded", "true");
    searchEl.addEventListener("input", applyFilter);
    searchEl.addEventListener("keydown", onSearchKey);
    listEl.addEventListener("mousedown", onListMouseDown);
    listEl.addEventListener("mousemove", onListMouseMove);
    document.addEventListener("mousedown", onDocMouseDown, true);
    window.addEventListener("scroll", onScrollResize, true);
    window.addEventListener("resize", onScrollResize);
    searchEl.focus();   /* фокус в поле сразу при открытии — требование */
  }

  function close(returnFocus){
    if(!pop) return;
    document.removeEventListener("mousedown", onDocMouseDown, true);
    window.removeEventListener("scroll", onScrollResize, true);
    window.removeEventListener("resize", onScrollResize);
    pop.remove();
    pop = listEl = searchEl = emptyMsgEl = null;
    rowEls = []; visibleRows = []; activeIndex = -1;
    button.setAttribute("aria-expanded", "false");
    if(openInstance === instance) openInstance = null;
    if(returnFocus) button.focus();
  }

  /* Выбор строки. Значение уже существует опцией в select (список построен из него),
     поэтому просто ставим select.value и шлём change — дальше отрабатывает штатный
     onchange конструктора. Если значение не изменилось — только закрыть и вернуть фокус. */
  function commit(value){
    const changed = selectEl.value !== value;
    close(!changed);      /* при изменении фокус вернётся на новую кнопку после renderBuilder */
    if(changed){
      selectEl.value = value;
      selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function onSearchKey(e){
    switch(e.key){
      case "ArrowDown": e.preventDefault(); moveActive(1); break;
      case "ArrowUp": e.preventDefault(); moveActive(-1); break;
      case "Home": e.preventDefault(); setActive(visibleRows.length ? 0 : -1, true); break;
      case "End": e.preventDefault(); setActive(visibleRows.length - 1, true); break;
      case "Enter":
        e.preventDefault();
        if(activeIndex >= 0 && visibleRows[activeIndex]) commit(visibleRows[activeIndex].getAttribute("data-value"));
        /* нет активной строки (пустой результат по накладкам), но есть действие подсказки —
           Enter запускает его: клавиатурный путь к «переключить», не только мышью */
        else if(pendingAction){ const run = pendingAction; close(false); run(); }
        break;
      case "Escape": e.preventDefault(); close(true); break;   /* закрыть без выбора, фокус на кнопку */
      /* Tab: фокус на кнопку СИНХРОННО (поле поиска сейчас исчезнет), затем закрыть — и
         не гасим событие, чтобы браузер штатно перевёл фокус дальше уже с кнопки */
      case "Tab": button.focus(); close(false); break;
    }
  }

  function onListMouseDown(e){
    const row = e.target.closest(".epk-option");
    if(!row) return;
    e.preventDefault();   /* не забирать фокус у поля поиска до фиксации выбора */
    commit(row.getAttribute("data-value"));
  }
  function onListMouseMove(e){
    const row = e.target.closest(".epk-option");
    if(!row) return;
    const i = visibleRows.indexOf(row);
    if(i >= 0 && i !== activeIndex) setActive(i, false);
  }
  function onDocMouseDown(e){
    if(pop && !pop.contains(e.target) && !button.contains(e.target)) close(false);
  }
  /* fixed-popup при прокрутке страницы/модалки отвязался бы от кнопки — закрываем. Но
     прокрутку САМОГО списка (capture ловит и её) пропускаем, иначе список не пролистать. */
  function onScrollResize(e){
    if(e && e.type === "scroll" && pop && pop.contains(e.target)) return;
    close(false);
  }

  button.addEventListener("click", () => { if(pop) close(true); else open(); });
  button.addEventListener("keydown", e => {
    if(e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " " || e.key === "Spacebar"){
      e.preventDefault();
      open();
    }
  });

  renderButton();

  const instance = { close, open, destroy };
  function destroy(){
    close(false);
    button.remove();
    /* вернуть select на место обёртки и убрать саму обёртку */
    if(wrap.parentNode) wrap.parentNode.insertBefore(selectEl, wrap);
    wrap.remove();
    selectEl.classList.remove("epk-native");
    selectEl.removeAttribute("tabindex");
    selectEl.removeAttribute("aria-hidden");
    delete selectEl.__epkDestroy;
  }
  selectEl.__epkDestroy = destroy;
  return instance;
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов чистой filterOptions (PLAN 7.1). */
const api = { enhance, filterOptions };
if(typeof window !== "undefined") window.EPPicker = api;
if(typeof module !== "undefined" && module.exports) module.exports = api;
})();
