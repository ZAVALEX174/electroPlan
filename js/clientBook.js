/* Книга клиентов (А7, итоги встречи 24.08 §1.2: «запоминать настройки по клиенту — у Иванова
   постоянная скидка 10%»). Утверждённый результат: начинаешь вписывать «Иванов» — программа
   предлагает его из прошлых проектов; выбрал — реквизиты заполнились сами, а общая скидка в КП
   сразу стала его (10 %).

   Что запоминаем (решение владельца): ВСЕ реквизиты заказчика (docHeader.customer — values
   fio/phone/email/legal/address и галочки show) ПЛЮС общую скидку проекта (settings.discountPercent).
   Больше ничего. Список клиентов — привычка человека, а не свойство проекта: живёт в EPPrefs (ключ
   "clients"), переживает смену проекта, в файл проекта НЕ едет.

   ДВА СЛОЯ, как у EPProjectSetup/EPProjectFile:
   - ЧИСТАЯ часть (без DOM/state/EP_DATA) — нормализация ФИО в ключ, приведение списка, поиск,
     подсказка, запоминание с лимитом. Покрыта clientBook.test.js + мутациями.
   - attach(ctx) — тонкая связка событий: запоминает на «change» (НЕ «input» — посимвольные «Ив», «1»
     при наборе «10» запоминаться не должны), подставляет реквизиты и скидку при ВЫБОРЕ клиента,
     строит подсказку. Логики правил в attach нет — он зовёт чистые функции и прежние двери app.js
     (applyTerms для скидки, fillCustomer для реквизитов), чтобы второй копии правил не завелось.

   Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports для тестов. */
(() => {
"use strict";

const LIST_KEY = "clients";      // ключ EPPrefs со списком клиентов (литерал)
const LIMIT = 500;               // разумный предел длины: самые старые выпадают

/* ФИО → КЛЮЧ клиента: один и тот же человек при любой расстановке пробелов и регистра — один ключ.
   trim + схлопнуть внутренние пробелы + нижний регистр. ё/е НАМЕРЕННО не трогаем (решение владельца):
   «Пётр» и «Петр» для нас разные написания, склеивать их нельзя. */
function normFio(fio) {
  return String(fio == null ? "" : fio).trim().replace(/\s+/g, " ").toLowerCase();
}

/* Хранимое значение "clients" → массив записей, мусор отброшен (не-объекты, записи без непустого ФИО).
   Старое/битое значение ключа не должно валить подсказку и поиск. Форма записи:
   {values:{fio,phone,email,legal,address}, show:{...}, discountPercent:Number}. */
function normalizeList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(c => c && typeof c === "object" && c.values && normFio(c.values.fio) !== "");
}

/* Найти клиента по ФИО (по нормализованному ключу). Пустое/неизвестное ФИО → null. */
function find(raw, fio) {
  const key = normFio(fio);
  if (key === "") return null;
  return normalizeList(raw).find(c => normFio(c.values.fio) === key) || null;
}

/* Список для подсказки: {fio, phone} в порядке хранения — «новые/недавние первыми» (remember кладёт
   свежего в начало). Телефон — чтобы различать однофамильцев. query (необяз.) — фильтр по подстроке
   ФИО, регистронезависимо (датлист браузера фильтрует сам, но функция даёт то же правило тестам). */
function suggest(raw, query) {
  const q = normFio(query);
  return normalizeList(raw)
    .filter(c => q === "" || normFio(c.values.fio).indexOf(q) !== -1)
    .map(c => ({
      fio: String(c.values.fio).trim(),
      phone: String(c.values.phone == null ? "" : c.values.phone).trim()
    }));
}

/* Запомнить клиента: создать/перезаписать запись текущими реквизитами и общей скидкой. Пустое ФИО —
   НЕ запоминаем (возвращаем нормализованный список как есть). Одинаковое ФИО (по ключу) = тот же
   клиент: старую запись убираем, новую кладём В НАЧАЛО (последние значения побеждают, свежий — первым
   в подсказке). Значения КОПИРУЕМ, а не держим ссылку. Лимит: самые старые (в хвосте) выпадают.
   Скидку сохраняем числом, в т.ч. 0 («скидку сняли») — именно поэтому не `|| пропуск`, а Number. */
function remember(raw, client, limit) {
  const list = normalizeList(raw);
  const values = (client && client.values) || {};
  const key = normFio(values.fio);
  if (key === "") return list;
  const rest = list.filter(c => normFio(c.values.fio) !== key);
  const d = Number(client && client.discountPercent);
  const record = {
    values: Object.assign({}, values),
    show: Object.assign({}, (client && client.show) || {}),
    discountPercent: Number.isFinite(d) ? d : 0
  };
  const next = [record].concat(rest);
  const max = Number(limit) > 0 ? Math.floor(Number(limit)) : next.length;
  return next.slice(0, max);
}

/* ТОНКАЯ СВЯЗКА. ctx даёт: $ (узел по id), EP_DATA, EPPrefs, applyTerms (прежняя дверь скидки —
   пишет и поле, и settings, и пересчитывает смету/КП), esc (экранирование для подсказки), fillCustomer
   (прежняя дверь реквизитов заказчика — заполняет поля и галочки из {values,show}), document (для
   datalist; в тестах — свой шим). */
function attach(ctx) {
  const { $, EP_DATA, EPPrefs, applyTerms, esc, fillCustomer } = ctx;
  const doc = ctx.document || (typeof document !== "undefined" ? document : null);
  const container = $("customerRequisites");
  const discountEl = $("discountInput");

  /* ФИО-поле заказчика — цель всех правил; прочие поля блока к подстановке не ведут (правка телефона
     НИЧЕГО не подставляет, см. ниже). Ищем по data-атрибутам, как reqInput в app.js. */
  function isFioTarget(t) {
    return !!(t && t.dataset && t.dataset.reqBlock === "customer" && t.dataset.reqKey === "fio");
  }

  /* Текущий клиент из ПРОЕКТА: реквизиты заказчика + общая скидка. Читаем из EP_DATA уже ПОСЛЕ того,
     как прежние двери (applyCustomerRequisites на bubble, applyTerms на input) записали значения —
     наш слушатель запоминания висит ниже них по порядку. */
  function currentClient() {
    const cust = ((EP_DATA.settings || {}).docHeader || {}).customer || {};
    return { values: cust.values || {}, show: cust.show || {}, discountPercent: (EP_DATA.settings || {}).discountPercent };
  }

  /* Запомнить текущее состояние проекта как клиента (пустое ФИО remember сам пропустит). */
  function rememberCurrent() {
    EPPrefs.set(LIST_KEY, remember(EPPrefs.get(LIST_KEY, []), currentClient(), LIMIT));
  }

  /* Подсказка: datalist по ФИО-полю. Создаём один раз и держим в <body>, а НЕ в контейнере заказчика:
     renderRequisitesInputs перестраивает innerHTML контейнера при «Открыть из файла» и стёр бы datalist,
     будь он его ребёнком. В body он переживает перестройку; поле ссылается на него по id (list=), а ссылку
     заново ставит input-обработчик на новом поле. Наполняем из EPPrefs при вводе. */
  let dl = null;
  function ensureDatalist() {
    if (dl || !doc) return dl;
    const host = doc.body || container;
    if (!host) return dl;
    dl = doc.createElement("datalist");
    dl.id = "epClientFioSuggest";
    host.appendChild(dl);
    return dl;
  }
  function populateSuggest() {
    if (!ensureDatalist()) return;
    dl.innerHTML = suggest(EPPrefs.get(LIST_KEY, []))
      .map(c => `<option value="${esc(c.fio)}">${esc(c.phone)}</option>`).join("");
  }

  if (!container) return;

  /* Значение ФИО на МОМЕНТ НАЧАЛА правки поля (фокус). По нему отличаем «сменил заказчика» от «правит
     другие поля того же». В EP_DATA опереться нельзя: applyCustomerRequisites висит и на input, и
     посимвольно уводит docHeader.customer.fio к набранному — к change «прежнего» там уже нет. */
  let editStartFio = "";
  container.addEventListener("focusin", e => { if (isFioTarget(e.target)) editStartFio = e.target.value; });

  /* ПОДСТАНОВКА (одна функция на оба источника — change и выбор из datalist, второй копии нет).
     Условие (решение владельца): цель — ФИО-поле, поменяли именно ФИО (editStart ≠ новое) И новое
     совпадает с ИЗВЕСТНЫМ клиентом. Тогда все поля заказчика заменяются его данными целиком (чего нет —
     очистится, галочки — его), а общая скидка становится его: ставим в поле и прогоняем applyTerms (та
     же дверь — поле, settings, смета/КП). То же ФИО (правка телефона и т.п. или повторное подтверждение)
     под условие не попадает — заказчик не подставляется и ручные правки не затираются. */
  function trySubstitute(target) {
    if (!isFioTarget(target)) return;
    if (normFio(target.value) === normFio(editStartFio)) return;
    const hit = find(EPPrefs.get(LIST_KEY, []), target.value);
    if (!hit) return;                               // новый клиент — подставлять нечего
    fillCustomer({ values: hit.values, show: hit.show });
    editStartFio = target.value;                    // подстановка завершила правку этого поля
    if (discountEl) { discountEl.value = hit.discountPercent; applyTerms(); }
  }

  /* На CAPTURE, ДО applyCustomerRequisites (он у контейнера на bubble): меняем поля и скидку прежде,
     чем прежняя дверь зафиксирует заказчика из полей. Два источника выбора клиента:
     - change: человек дописал ФИО целиком и ушёл из поля (Tab/клик мимо);
     - input с inputType "insertReplacementText": так Chrome и Firefox сообщают о ВЫБОРЕ из datalist —
       подставляем СРАЗУ, не дожидаясь ухода из поля (владелец: «выбрали — реквизиты заполнились сами»).
     Обычный посимвольный набор (insertText/deleteContentBackward…) под ветку не попадает — не подставляет. */
  container.addEventListener("change", e => trySubstitute(e.target), true);
  container.addEventListener("input", e => { if (e.inputType === "insertReplacementText") trySubstitute(e.target); }, true);

  /* ЗАПОМИНАНИЕ — на bubble (после applyCustomerRequisites/applyTerms зафиксировали значения). change,
     а НЕ input: промежуточные посимвольные значения запоминаться не должны. Скидка меняется в своём
     поле (#discountInput вне контейнера) — свой слушатель change там же. */
  container.addEventListener("change", rememberCurrent, false);
  if (discountEl) discountEl.addEventListener("change", rememberCurrent, false);

  /* Подсказка строится при вводе в ФИО-поле: вешаем list и наполняем из актуального списка. */
  container.addEventListener("input", e => {
    if (!isFioTarget(e.target)) return;
    ensureDatalist();
    if (dl) e.target.setAttribute("list", dl.id);
    populateSuggest();
  });
}

const api = { normFio, normalizeList, find, suggest, remember, attach, LIST_KEY, LIMIT };
if (typeof window !== "undefined") window.EPClientBook = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
