/* Левая панель (Редизайн, часть 4 по макету дизайнера): три секции «Исходный план», «Инструменты»,
   «Готовые посты» стали сворачиваемыми <details class="pane"> — тем же приёмом, что правая панель
   (js/rightPanel.js). Разметку и статус-узел держит index.html, а этот модуль отвечает за ЧЕТЫРЕ вещи:
     1) память «открыто/закрыто» каждой секции — ПРИВЫЧКА ЧЕЛОВЕКА (как вид отделки), живёт в ep_prefs
        (EPPrefs), чужой проект её не переключает;
     2) статус справа в заголовке «Исходного плана» (виден и в свёрнутом виде) — чистая planStatusText
        из ОДНОГО источника (loaded/scaled), словами, без «1:N» (решение владельца 29.10);
     3) автосворачивание «Исходного плана» ОДИН раз на переход «план загружен И масштаб задан» — решает
        чистая shouldAutoCollapse; раскрыл руками — снова не сворачиваем, пока не загрузят новый план
        (ловим по planToken); на простом открытии страницы сохранённое состояние уважаем (priming);
     4) карта «физическая клавиша → инструмент» (toolForCode) для горячих клавиш V/W/L/R/E — сам вызов
        setTool и гейты «не в поле/не в модалке» остаются в keydown app.js (одно место правила, §7.1).

   Чистые функции без DOM/state (planStatusText, shouldAutoCollapse, toolForCode) тестируются и мутируются
   в Node; attach(ctx) — тонкая связка с DOM/EPPrefs. Двойной экспорт: браузеру — namespace, Node —
   module.exports (сборщика нет, PLAN 2.2). */
(() => {
"use strict";

/* Статус секции «Исходный план» словами. Масштаб в программе — не «1:N» (решение владельца 29.10),
   поэтому три состояния текстом. ОДНО место правила текста (§7.1). */
function planStatusText(st) {
  if (!st || !st.loaded) return "не загружен";
  return st.scaled ? "загружен · масштаб задан" : "загружен";
}

/* Решение «свернуть ли “Исходный план” автоматически сейчас». Сворачиваем ровно на ПЕРЕХОДЕ в
   «загружен И масштаб задан», один раз: prev — предыдущий замер, cur — текущий.
   - нет prev (первый замер после открытия/загрузки проекта) → НЕ сворачиваем: уважаем сохранённое
     человеком состояние секции;
   - cur ещё не «загружен И масштаб задан» → нечего сворачивать;
   - prev УЖЕ был «загружен И масштаб задан» на ТОМ ЖЕ плане (planToken совпал) → переход уже был,
     повторно не сворачиваем (человек мог раскрыть секцию руками);
   - новый план (planToken сменился) снова взводит автосворачивание — «пока не загрузят новый план».
   Чистая функция: мутация любого из условий роняет тесты. */
function shouldAutoCollapse(prev, cur) {
  if (!prev) return false;
  if (!(cur.loaded && cur.scaled)) return false;
  if (prev.loaded && prev.scaled && prev.token === cur.token) return false;
  return true;
}

/* Физическая клавиша (e.code, чтобы работало и в русской раскладке — как B) → инструмент. Те же
   значения data-tool, что у кнопок: L — разметка (roomline), R — комната (room), E — правка комнат
   (vertex). Нет в карте → "" (клавиша не наша). */
const TOOL_BY_CODE = { KeyV: "select", KeyW: "wall", KeyL: "roomline", KeyR: "room", KeyE: "vertex" };
function toolForCode(code) {
  return Object.prototype.hasOwnProperty.call(TOOL_BY_CODE, code) ? TOOL_BY_CODE[code] : "";
}

function attach(ctx) {
  const { $, EPPrefs, planState } = ctx;

  const pane = $("panePlan");
  /* Флаг «идёт ПРОГРАММНОЕ сворачивание секции плана». Событие toggle у <details> асинхронное и
     приходит И на программную смену .open (автосворачивание), и на действие человека — различить их
     в самом слушателе нельзя, поэтому помечаем программный случай флагом. */
  let autoCollapsing = false;

  /* Память секций: один ключ ep_prefs на секцию (как в правой панели). undefined (человек ни разу не
     трогал) → оставляем разметочный дефолт (open). Чтение/запись — через EPPrefs (там try/catch). */
  [["panePlan", "lpOpenPlan"], ["paneTools", "lpOpenTools"], ["paneLibrary", "lpOpenLibrary"]].forEach(([id, key]) => {
    const el = $(id);
    if (!el) return;
    const saved = EPPrefs.get(key, undefined);
    if (saved === true) el.open = true; else if (saved === false) el.open = false;
    el.addEventListener("toggle", () => {
      /* В prefs пишем ТОЛЬКО то, что человек переключил руками. Автосворачивание «Исходного плана»
         (программная смена .open) — НЕ привычка: его помеченный флагом toggle пропускаем, флаг снимаем.
         Иначе авто-сворачивание сохранилось бы как «человек закрыл», и после нового/перезагруженного
         проекта БЕЗ плана секция осталась бы свёрнутой, пряча кнопку «Загрузить план». */
      if (el === pane && autoCollapsing) { autoCollapsing = false; return; }
      EPPrefs.set(key, !!el.open);
    });
  });

  /* «+ Создать» живёт в <summary> «Готовых постов». Клик по нему НЕ должен сворачивать секцию:
     гасим штатное переключение details (preventDefault), собственный onclick кнопки (openPostBuilder,
     навешен в postBuilder.js) при этом отрабатывает — preventDefault отменяет только действие details. */
  const newPostBtn = $("newPostBtn");
  if (newPostBtn) newPostBtn.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); });

  /* prev — предыдущий замер состояния плана для shouldAutoCollapse; primed — взведено ли
     автосворачивание. До priming (во время восстановления проекта на старте) не сворачиваем вообще,
     только копим prev и пишем статус — иначе открытие страницы с сохранённым планом выглядело бы как
     переход и свернуло бы уважаемую сохранённую секцию. */
  let prev = null, primed = false;

  function writeStatus(st) {
    const el = $("planStatus");
    if (el) el.textContent = planStatusText(st);
  }

  /* Зовут на каждое изменение плана/масштаба (updatePlanUi/updateScaleUi). Статус пишем всегда;
     сворачиваем только когда взведено и shouldAutoCollapse дал true. Условие pane.open обязательно:
     если секция уже закрыта, .open не меняется, toggle не придёт и флаг autoCollapsing завис бы до
     следующего программного сворачивания. */
  function syncPlanSection() {
    const cur = planState();
    writeStatus(cur);
    if (primed && pane && pane.open && shouldAutoCollapse(prev, cur)) {
      autoCollapsing = true;
      pane.open = false;
    }
    prev = cur;
  }

  /* Базовая точка после загрузки/открытия проекта: фиксируем текущее состояние как prev и взводим
     автосворачивание. Сам по себе priming секцию не трогает — сохранённое состояние остаётся. */
  function primePlanSection() {
    prev = planState();
    writeStatus(prev);
    primed = true;
  }

  return { syncPlanSection, primePlanSection, toolForCode };
}

const api = { planStatusText, shouldAutoCollapse, toolForCode, attach };
if (typeof window !== "undefined") window.EPLeftPanel = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
