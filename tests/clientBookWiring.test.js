/* СВЯЗКА книги клиентов (А7) с НАСТОЯЩИМИ дверями app.js. Чистые правила проверены в clientBook.test.js;
   здесь — что EPClientBook.attach реально так развешивает события и зовёт прежние функции, что:
     - запоминание идёт на «change», а не на «input» (посимвольный набор не пишется);
     - ВЫБОР известного клиента подставляет его реквизиты и общую скидку — в поле #discountInput,
       в EP_DATA.settings.discountPercent (его читает смета) И через applyTerms (пересчёт сметы/КП);
     - загрузка проекта (поля заполняются без событий) список НЕ пополняет;
     - пустое ФИО не пишется, скидка 0 пишется;
     - правка телефона того же клиента НИЧЕГО не подставляет, а только запоминает.

   КАК. Настоящие applyTerms/applyCustomerRequisites/fillReqBlock/readReqBlock/reqInput/reqCheck
   вырезаются из app.js и исполняются на общем стенде (helpers/appStand.js) в ОДНОМ vm-контексте —
   после прогона их объявления видны как свойства этого контекста. Их же и вешаем на событийный
   DOM-шим ровно как в app.js (container.oninput/onchange = applyCustomerRequisites, discountInput.oninput
   = applyTerms), а поверх — реальный EPClientBook.attach. Деньги не подделываем: «итог сметы меняется»
   показываем настоящей EPEstimate.discountBreakdown от получившейся общей скидки.

   МУТАЦИОННАЯ ТАБЛИЦА — в отчёте (сломать строку clientBook.js → какой тест краснеет).
   Запуск: node --test tests/clientBookWiring.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const EPClientBook = require("../js/clientBook.js");
const EPDocRequisites = require("../js/docRequisites.js");
const EPEstimate = require("../js/estimate.js");

/* ---- событийный DOM-шим (addEventListener с capture, dispatch с фазами capture/target/bubble) ---- */
function makeNode(tag) {
  const listeners = {};
  const node = {
    tagName: tag, checked: false, innerHTML: "", disabled: false,
    dataset: {}, _attrs: {}, children: [], parentNode: null, _value: "",
    onchange: null, oninput: null, onfocusin: null,
    addEventListener(type, fn, capture) { (listeners[type] = listeners[type] || []).push({ fn, capture: !!capture }); },
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    _listeners: listeners
  };
  /* input.value в браузере ВСЕГДА строка: присваивание числа коерцится. Держим это честно, иначе
     «скидка в поле» прошла бы как число и скрыла бы расхождение со строковым контрактом DOM. */
  Object.defineProperty(node, "value", { get() { return node._value; }, set(v) { node._value = String(v); } });
  return node;
}
function listenersOf(node, type, capture) {
  return (node._listeners[type] || []).filter(l => l.capture === capture);
}
/* Диспетчер события: capture (предки сверху вниз) → target → bubble (предки снизу вверх; у каждого
   предка сначала on<type>-свойство, затем bubble-слушатели — как порядок регистрации в браузере). */
function fireEvent(target, type, props) {
  const path = [];
  for (let n = target.parentNode; n; n = n.parentNode) path.push(n);
  const event = Object.assign({ type, target }, props);   // props: {inputType} для выбора из datalist
  for (let i = path.length - 1; i >= 0; i--) listenersOf(path[i], type, true).forEach(l => l.fn.call(path[i], event));
  listenersOf(target, type, true).forEach(l => l.fn.call(target, event));
  listenersOf(target, type, false).forEach(l => l.fn.call(target, event));
  if (target["on" + type]) target["on" + type].call(target, event);
  for (let i = 0; i < path.length; i++) {
    const a = path[i];
    if (a["on" + type]) a["on" + type].call(a, event);
    listenersOf(a, type, false).forEach(l => l.fn.call(a, event));
  }
}

/* EPPrefs-шим: in-memory список клиентов (ключ "clients"). */
function makePrefs(init) {
  const store = Object.assign({}, init);
  return { store, get: (k, d) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : d), set: (k, v) => { store[k] = v; } };
}

/* Собрать стенд: событийный DOM, настоящие двери app.js и реальный EPClientBook.attach, связанные
   ровно как в app.js. Возвращает ручки для сценариев. */
function makeStand() {
  const nodes = {};
  const container = makeNode("div");
  nodes.customerRequisites = container;
  /* поля заказчика + галочки необязательных (legal/address), как строит requisiteBlockHtml */
  const reqInputs = {}, reqChecks = {};
  EPDocRequisites.CUSTOMER_FIELDS.forEach(f => {
    const inp = makeNode("input");
    inp.dataset.reqBlock = "customer"; inp.dataset.reqKey = f.key; inp.parentNode = container;
    container.children.push(inp); reqInputs[f.key] = inp;
    if (!f.required) {
      const chk = makeNode("input");
      chk.dataset.reqBlock = "customer"; chk.dataset.reqCheck = f.key; chk.checked = true; chk.parentNode = container;
      container.children.push(chk); reqChecks[f.key] = chk;
    }
  });
  ["discountInput", "workInput", "materialsInput", "vatInput", "vatMode"].forEach(id => { nodes[id] = makeNode("input"); });

  const $ = id => nodes[id] || (nodes[id] = makeNode("input"));

  /* document-шим: querySelector по [data-req-block=..][data-req-key|check=..], createElement для datalist,
     body — куда attach вешает datalist (переживает перестройку контейнера). */
  const doc = {
    body: makeNode("body"),
    createElement: tag => makeNode(tag),
    querySelector(sel) {
      const block = /data-req-block="([^"]*)"/.exec(sel);
      const key = /data-req-key="([^"]*)"/.exec(sel);
      const chk = /data-req-check="([^"]*)"/.exec(sel);
      if (block && key) return reqInputs[key[1]] || null;
      if (block && chk) return reqChecks[chk[1]] || null;
      return null;
    }
  };

  const EP_DATA = { settings: { docHeader: {}, discountPercent: 0, vatMode: "surcharge" } };
  const applied = [];   // лог вызовов applyProjectSettings (пересчёт сметы/КП) со значением скидки

  /* Настоящие функции app.js в одном vm-контексте; после run их объявления — свойства appctx. */
  const appctx = {
    EP_DATA, $, EPDocRequisites, document: doc, scheduleSave: () => {},
    applyProjectSettings: () => { applied.push(EP_DATA.settings.discountPercent); }
  };
  stand.run(["reqInput", "reqCheck", "readReqBlock", "fillReqBlock", "applyCustomerRequisites", "applyTerms"], appctx);
  assert.equal(typeof appctx.applyTerms, "function", "applyTerms вырезан из app.js");
  assert.equal(typeof appctx.applyCustomerRequisites, "function", "applyCustomerRequisites вырезан из app.js");

  /* Развеска как в app.js (строки 4065-4066, 4107). */
  container.oninput = appctx.applyCustomerRequisites;
  container.onchange = appctx.applyCustomerRequisites;
  nodes.discountInput.oninput = appctx.applyTerms;

  const prefs = makePrefs();
  EPClientBook.attach({
    $, EP_DATA, EPPrefs: prefs, applyTerms: appctx.applyTerms, esc: String,
    fillCustomer: src => appctx.fillReqBlock("customer", EPDocRequisites.CUSTOMER_FIELDS, src),
    document: doc
  });

  return { nodes, reqInputs, reqChecks, container, $, EP_DATA, prefs, applied, appctx, doc };
}

/* Удобный ввод: сфокусировать ФИО (запоминает исходное значение), вписать и завершить (change). */
function typeFio(S, text) {
  fireEvent(S.reqInputs.fio, "focusin");
  S.reqInputs.fio.value = text;
  fireEvent(S.reqInputs.fio, "change");
}
function clients(S) { return S.prefs.get("clients", []); }

test("change с непустым ФИО запоминает клиента (реквизиты + общая скидка)", () => {
  const S = makeStand();
  S.reqInputs.phone.value = "+7-111";
  S.nodes.discountInput.value = "10"; fireEvent(S.nodes.discountInput, "input");   // applyTerms → settings=10
  typeFio(S, "Иванов");
  const list = clients(S);
  assert.equal(list.length, 1, "клиент записан");
  assert.equal(list[0].values.fio, "Иванов");
  assert.equal(list[0].values.phone, "+7-111", "телефон из полей попал в книгу");
  assert.equal(list[0].discountPercent, 10, "общая скидка запомнена с клиентом");
});

test("input (посимвольный набор) НЕ запоминает — только change", () => {
  const S = makeStand();
  S.reqInputs.fio.value = "Ив"; fireEvent(S.reqInputs.fio, "input");
  S.reqInputs.fio.value = "Иван"; fireEvent(S.reqInputs.fio, "input");
  assert.deepEqual(clients(S), undefined === clients(S) ? undefined : [], "на input список не пополняется");
  assert.equal((clients(S) || []).length, 0, "ни одной промежуточной записи");
});

test("выбор известного клиента подставляет реквизиты и общую скидку: поле + settings + пересчёт", () => {
  const S = makeStand();
  /* заранее известный Иванов со скидкой 10 и телефоном */
  S.prefs.set("clients", EPClientBook.remember([], {
    values: { fio: "Иванов", phone: "+7-999", email: "iv@x.ru" }, show: {}, discountPercent: 10
  }, 500));
  /* проект стартует с ДРУГИМ (пустым) заказчиком и скидкой 0 */
  assert.equal(S.EP_DATA.settings.discountPercent, 0);
  typeFio(S, "иванов");   // ввёл ФИО известного клиента (другой регистр)
  assert.equal(S.reqInputs.phone.value, "+7-999", "телефон подставился из книги");
  assert.equal(S.reqInputs.email.value, "iv@x.ru", "email подставился");
  assert.equal(S.nodes.discountInput.value, "10", "скидка подставлена в ПОЛЕ");
  assert.equal(S.EP_DATA.settings.discountPercent, 10, "и в EP_DATA.settings (её читает смета)");
  assert.ok(S.applied.includes(10), "applyProjectSettings вызван с новой скидкой — смета/КП пересчитаны");
  /* итог сметы реально меняется: настоящая EPEstimate при 10% даёт ненулевую скидку, при 0% — ноль */
  const rows = [{ sum: 100 }];
  assert.equal(EPEstimate.discountBreakdown(rows, 0).total, 0);
  assert.equal(EPEstimate.discountBreakdown(rows, S.EP_DATA.settings.discountPercent).total, 10,
    "скидка 10% даёт 10 на базе 100 — итог изменился");
  /* заказчик проекта стал Ивановым целиком */
  assert.equal((S.EP_DATA.settings.docHeader.customer.values || {}).phone, "+7-999");
});

test("правка телефона того же клиента НИЧЕГО не подставляет, только запоминает", () => {
  const S = makeStand();
  S.prefs.set("clients", EPClientBook.remember([], {
    values: { fio: "Иванов", phone: "+7-999" }, show: {}, discountPercent: 10
  }, 500));
  /* проект уже у Иванова: заполняем поля как после загрузки (без событий) */
  S.reqInputs.fio.value = "Иванов"; S.reqInputs.phone.value = "+7-999";
  S.EP_DATA.settings.docHeader.customer = { values: { fio: "Иванов", phone: "+7-999" }, show: {} };
  S.EP_DATA.settings.discountPercent = 10;
  const appliedBefore = S.applied.length;
  /* меняем телефон */
  fireEvent(S.reqInputs.phone, "focusin");
  S.reqInputs.phone.value = "+7-000";
  fireEvent(S.reqInputs.phone, "change");
  assert.equal(S.reqInputs.phone.value, "+7-000", "телефон НЕ откатился к книжному — подстановки не было");
  assert.equal(S.applied.length, appliedBefore, "applyTerms/пересчёт скидки не дёргался (не подстановка)");
  assert.equal(clients(S)[0].values.phone, "+7-000", "новый телефон запомнен за Ивановым");
  assert.equal(clients(S).length, 1, "клиент один — не задвоился");
  /* повторное подтверждение ТОГО ЖЕ ФИО (фокус/blur без смены имени) не должно запускать подстановку:
     это защищает guard editStartFio. Наблюдаемое следствие подстановки — вызов applyTerms (пересчёт
     сметы/КП): его быть не должно. Телефон здесь не улика (книга уже синхронна правке), поэтому ловим
     именно отсутствие лишнего пересчёта. */
  const appliedBeforeRetouch = S.applied.length;
  fireEvent(S.reqInputs.fio, "focusin");          // editStartFio = "Иванов"
  fireEvent(S.reqInputs.fio, "change");           // имя не менялось
  assert.equal(S.applied.length, appliedBeforeRetouch, "то же ФИО — подстановки нет, смета не пересчитана");
});

test("настоящий путь загрузки (fillReqBlock из app.js) НЕ пополняет книгу — он без событий", () => {
  const S = makeStand();
  /* прогоняем НАСТОЯЩИЙ app.js-fill реквизитов заказчика (как fillRequisitesInputs при загрузке проекта):
     он пишет .value/.checked напрямую, change не шлёт — attach-слушатели (на change) сработать не должны.
     Тавтологии нет: исполняется реальный fillReqBlock, и если он когда-нибудь начнёт слать change, этот
     тест покраснеет (container.onchange → rememberCurrent пополнит книгу). */
  S.appctx.fillReqBlock("customer", EPDocRequisites.CUSTOMER_FIELDS, { values: { fio: "Сидоров", phone: "+7-555" }, show: {} });
  assert.equal(S.reqInputs.fio.value, "Сидоров", "реальный fill действительно заполнил поле");
  assert.equal((clients(S) || []).length, 0, "книга не пополнена — путь загрузки событий не шлёт");
});

test("правка реквизитов существующего клиента НЕ меняет его скидку в книге (денежный дефект р.2)", () => {
  const S = makeStand();
  S.prefs.set("clients", EPClientBook.remember([], { values: { fio: "Иванов", phone: "+7-999" }, show: {}, discountPercent: 10 }, 500));
  /* открыли старый проект Иванова со скидкой 5: поля и EP_DATA заполнены БЕЗ событий */
  S.reqInputs.fio.value = "Иванов"; S.reqInputs.phone.value = "+7-999";
  S.EP_DATA.settings.docHeader.customer = { values: { fio: "Иванов", phone: "+7-999" }, show: {} };
  S.EP_DATA.settings.discountPercent = 5;
  /* поправили ТОЛЬКО телефон */
  fireEvent(S.reqInputs.phone, "focusin");
  S.reqInputs.phone.value = "+7-000";
  fireEvent(S.reqInputs.phone, "change");
  const rec = clients(S)[0];
  assert.equal(rec.discountPercent, 10, "скидка клиента в книге прежняя (10), правка реквизитов её не трогает");
  assert.equal(rec.values.phone, "+7-000", "реквизиты в книге обновлены");
});

test("щелчок галочки «показывать в КП» в проекте со скидкой 0 НЕ обнуляет скидку клиента в книге", () => {
  const S = makeStand();
  S.prefs.set("clients", EPClientBook.remember([], { values: { fio: "Иванов", legal: "ООО" }, show: { legal: true }, discountPercent: 10 }, 500));
  S.reqInputs.fio.value = "Иванов"; S.reqInputs.legal.value = "ООО";
  S.EP_DATA.settings.docHeader.customer = { values: { fio: "Иванов", legal: "ООО" }, show: { legal: true } };
  S.EP_DATA.settings.discountPercent = 0;
  /* сняли галочку legal (change на чекбоксе блока заказчика) */
  S.reqChecks.legal.checked = false;
  fireEvent(S.reqChecks.legal, "change");
  assert.equal(clients(S)[0].discountPercent, 10, "скидка клиента не обнулена правкой галочки при проекте 0");
  assert.equal((clients(S)[0].show || {}).legal, false, "галочка show обновлена в книге");
});

test("новый клиент создаётся со скидкой текущего проекта (keepDiscount действует только на существующих)", () => {
  const S = makeStand();
  S.nodes.discountInput.value = "7"; fireEvent(S.nodes.discountInput, "input");   // settings=7
  typeFio(S, "Новиков");   // новый ФИО, change
  assert.equal(clients(S)[0].discountPercent, 7, "новому клиенту записана скидка проекта");
});

test("change скидки в проекте Иванова с 5 на 8 → в книге 8 (change скидки пишет полностью)", () => {
  const S = makeStand();
  S.prefs.set("clients", EPClientBook.remember([], { values: { fio: "Иванов" }, show: {}, discountPercent: 5 }, 500));
  S.reqInputs.fio.value = "Иванов";
  S.EP_DATA.settings.docHeader.customer = { values: { fio: "Иванов" }, show: {} };
  S.EP_DATA.settings.discountPercent = 5;
  S.nodes.discountInput.value = "8"; fireEvent(S.nodes.discountInput, "input");   // applyTerms → settings=8
  fireEvent(S.nodes.discountInput, "change");
  assert.equal(clients(S)[0].discountPercent, 8, "скидка в книге обновлена до 8");
});

test("галочки show держатся: подстановка применяет show клиента, запоминание его сохраняет", () => {
  const S = makeStand();
  /* книга: у Иванова галочка legal СНЯТА (show.legal=false) */
  S.prefs.set("clients", EPClientBook.remember([], { values: { fio: "Иванов", legal: "ООО" }, show: { legal: false }, discountPercent: 10 }, 500));
  fireEvent(S.reqInputs.fio, "focusin");
  S.reqInputs.fio.value = "Иванов";
  fireEvent(S.reqInputs.fio, "input", { inputType: "insertReplacementText" });   // выбор клиента
  /* show клиента применён к галочке (ловит fillCustomer({show:{}}) — иначе была бы checked по умолчанию) */
  assert.equal(S.reqChecks.legal.checked, false, "галочка show применена из книги при подстановке");
  /* запоминание на change сохраняет show (ловит show:{} в remember) */
  fireEvent(S.reqInputs.fio, "change");
  assert.equal((clients(S)[0].show || {}).legal, false, "show сохранён в книге");
});

test("пустое ФИО не пишется; скидка 0 пишется", () => {
  const S = makeStand();
  /* пустое ФИО с change — не запоминаем */
  S.reqInputs.phone.value = "+7-1"; typeFio(S, "   ");
  assert.equal((clients(S) || []).length, 0, "пустой заказчик в книгу не попал");
  /* непустое ФИО, скидка 0 — запоминаем с нулём */
  S.nodes.discountInput.value = "0"; fireEvent(S.nodes.discountInput, "input");
  typeFio(S, "Петров");
  const list = clients(S);
  assert.equal(list.length, 1);
  assert.strictEqual(list[0].discountPercent, 0, "скидка 0 («сняли») запомнена");
});

test("изменение скидки (change на #discountInput) запоминает текущего заказчика", () => {
  const S = makeStand();
  /* заказчик уже есть в проекте */
  S.reqInputs.fio.value = "Иванов";
  S.EP_DATA.settings.docHeader.customer = { values: { fio: "Иванов" }, show: {} };
  S.nodes.discountInput.value = "15"; fireEvent(S.nodes.discountInput, "input");   // applyTerms → settings=15
  fireEvent(S.nodes.discountInput, "change");                                       // завершили ввод скидки
  const list = clients(S);
  assert.equal(list.length, 1);
  assert.equal(list[0].discountPercent, 15, "новая скидка запомнена за Ивановым");
});

test("подсказка по ФИО: datalist наполняется из книги (ФИО + телефон)", () => {
  const S = makeStand();
  S.prefs.set("clients", EPClientBook.remember(
    EPClientBook.remember([], { values: { fio: "Иванов", phone: "+7-111" }, show: {}, discountPercent: 0 }, 500),
    { values: { fio: "Петров", phone: "+7-222" }, show: {}, discountPercent: 0 }, 500));
  S.reqInputs.fio.value = "И"; fireEvent(S.reqInputs.fio, "input");
  /* datalist живёт в <body> (переживает перестройку контейнера при «Открыть из файла»), поле ссылается
     на него по id */
  const dl = S.doc.body.children.find(c => c.tagName === "datalist");
  assert.ok(dl, "datalist создан в body");
  assert.match(dl.innerHTML, /Петров/);
  assert.match(dl.innerHTML, /\+7-111/, "телефон показан для различения");
  assert.equal(S.reqInputs.fio.getAttribute("list"), dl.id, "поле ФИО ссылается на datalist");
});

/* Выбор из подсказки Chrome/Firefox сообщают как input с inputType "insertReplacementText". Подстановка
   должна идти СРАЗУ на нём — человек выбрал и ждёт заполнения, а не после Tab. */
test("выбор из datalist (input insertReplacementText) подставляет СРАЗУ: поле + settings + пересчёт", () => {
  const S = makeStand();
  S.prefs.set("clients", EPClientBook.remember([], {
    values: { fio: "Иванов Иван", phone: "+7-999", email: "iv@x.ru" }, show: {}, discountPercent: 10
  }, 500));
  fireEvent(S.reqInputs.fio, "focusin");                  // editStartFio = ""
  S.reqInputs.fio.value = "Иванов Иван";
  fireEvent(S.reqInputs.fio, "input", { inputType: "insertReplacementText" });
  assert.equal(S.reqInputs.phone.value, "+7-999", "телефон подставился сразу при выборе");
  assert.equal(S.reqInputs.email.value, "iv@x.ru", "email подставился сразу");
  assert.equal(S.nodes.discountInput.value, "10", "скидка в поле сразу");
  assert.equal(S.EP_DATA.settings.discountPercent, 10, "и в settings (её читает смета)");
  assert.ok(S.applied.includes(10), "applyProjectSettings вызван — смета/КП пересчитаны");
  assert.equal((S.EP_DATA.settings.docHeader.customer.values || {}).phone, "+7-999", "заказчик проекта зафиксирован подставленным");
});

test("посимвольный ввод (input insertText) известного ФИО НЕ подставляет на input", () => {
  const S = makeStand();
  S.prefs.set("clients", EPClientBook.remember([], {
    values: { fio: "Иванов Иван", phone: "+7-999" }, show: {}, discountPercent: 10
  }, 500));
  fireEvent(S.reqInputs.fio, "focusin");
  S.reqInputs.fio.value = "Иванов Иван";
  fireEvent(S.reqInputs.fio, "input", { inputType: "insertText" });
  assert.equal(S.reqInputs.phone.value, "", "ручной набор на input ничего не подставляет");
  assert.equal(S.EP_DATA.settings.discountPercent, 0, "скидка не тронута до change");
});

test("после подстановки на input повторный change того же значения не подставляет и не сбрасывает правки", () => {
  const S = makeStand();
  S.prefs.set("clients", EPClientBook.remember([], {
    values: { fio: "Иванов Иван", phone: "+7-999" }, show: {}, discountPercent: 10
  }, 500));
  fireEvent(S.reqInputs.fio, "focusin");
  S.reqInputs.fio.value = "Иванов Иван";
  fireEvent(S.reqInputs.fio, "input", { inputType: "insertReplacementText" });   // подстановка сразу
  S.reqInputs.phone.value = "+7-000";    // человек поправил телефон после выбора
  const appliedBefore = S.applied.length;
  fireEvent(S.reqInputs.fio, "change");  // уход из поля, ФИО не менялось
  assert.equal(S.reqInputs.phone.value, "+7-000", "правка телефона не затёрта повторной подстановкой");
  assert.equal(S.applied.length, appliedBefore, "повторной подстановки/пересчёта не было");
  assert.equal(clients(S)[0].values.phone, "+7-000", "на change запомнен правленый телефон");
});
