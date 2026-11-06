/* Реквизиты КП (A5): «Мои реквизиты» (исполнитель, общий бланк человека) и «Реквизиты заказчика»
   (свои у проекта), у каждого поля — галочка «показывать в КП»; ФИО и контакты печатаются всегда.
   Проверяем ОДНО правило «печатать ли поле» (EPDocRequisites — §7.1), миграцию старого «Клиент» в
   ФИО заказчика, раскладку в шапке КП (EPOfferPdf) и места хранения (EPPrefs vs снимок проекта).

   МУТАЦИОННАЯ ТАБЛИЦА (node tools/qa/mutate.cjs tools/qa/mutations/req.json "tests/docRequisites.test.js"):
     снять проверку галочки   (shouldPrint: isChecked → true)          → красит «необязательное печатается только с галочкой»;
     разрешить снять обязательное (isChecked: required-ветку убрать)   → красит «ФИО/телефон/e-mail печатаются всегда»;
     сломать миграцию         (migrateDocHeader: не писать values.fio) → красит «client → ФИО заказчика»;
     писать «мои» в проект    (applyMyRequisites: EPPrefs.set → в docHeader) → красит «мои реквизиты уходят в EPPrefs». */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../js/docRequisites.js");
const { buildHtml } = require("../js/offerPdf.js");
const stand = require("./helpers/appStand.js");

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ── Чистое правило «печатать ли поле» ── */
test("печатаются только непустые поля; пустое — никогда (даже обязательное)", () => {
  const rows = R.printedFields(R.CUSTOMER_FIELDS, { fio: "Иванов", phone: "", email: " " }, {});
  assert.deepEqual(rows.map(r => r.key), ["fio"], "phone пустой, email из пробелов — не печатаются");
  assert.equal(rows[0].value, "Иванов");
});

test("обязательные ФИО/телефон/e-mail печатаются всегда (галочку снять нельзя)", () => {
  /* show просит скрыть все три — но обязательные игнорируют снятую галочку */
  const show = { fio: false, phone: false, email: false };
  const rows = R.printedFields(R.MY_FIELDS, { fio: "A", phone: "B", email: "C" }, show);
  assert.deepEqual(rows.map(r => r.key), ["fio", "phone", "email"], "обязательные печатаются вопреки show:false");
  assert.equal(R.isChecked({ key: "fio", required: true }, show), true, "обязательная галочка всегда включена");
});

test("необязательное поле печатается только при включённой галочке; по умолчанию включено", () => {
  const values = { fio: "A", phone: "B", email: "C", legal: "ООО Ромашка", inn: "7701", address: "Москва" };
  const hidden = R.printedFields(R.MY_FIELDS, values, { legal: false });
  assert.deepEqual(hidden.map(r => r.key), ["fio", "phone", "email", "inn", "address"], "снятый legal не печатается");
  const all = R.printedFields(R.MY_FIELDS, values, {});   // show пуст → необязательные включены по умолчанию
  assert.deepEqual(all.map(r => r.key), ["fio", "phone", "email", "legal", "inn", "address"], "заполнил — печатается");
});

/* ── Миграция старого «Клиент» → ФИО заказчика ── */
test("migrateDocHeader: client переносится в customer.fio и старый ключ исчезает", () => {
  const m = R.migrateDocHeader({ client: "Сидоров", project: "Дом" });
  assert.equal(m.customer.values.fio, "Сидоров", "ФИО заказчика взято из старого «Клиент»");
  assert.ok(!("client" in m), "строки «Клиент» в шапке КП не останется");
  assert.equal(m.project, "Дом", "прочие поля проекта на месте");
});

test("migrateDocHeader не затирает уже заполненное ФИО заказчика", () => {
  const m = R.migrateDocHeader({ client: "Старое", customer: { values: { fio: "Новое" } } });
  assert.equal(m.customer.values.fio, "Новое", "своё ФИО важнее старого «Клиент»");
});

test("миграция идемпотентна: restore → snapshot → повторное открытие ничего не теряет", () => {
  const loaded = { client: "Петров", project: "П" };
  const afterRestore = R.migrateDocHeader(loaded);           // restoreProject/fillDocHeaderInputs
  const snapshot = { docHeader: afterRestore };              // projectSnapshot кладёт docHeader как есть
  const afterReopen = R.migrateDocHeader(snapshot.docHeader);// открыли снова
  assert.deepEqual(afterReopen, afterRestore, "повторная миграция ничего не меняет");
  assert.equal(afterReopen.customer.values.fio, "Петров", "ФИО заказчика пережило цикл");
});

/* ── Раскладка шапки КП (EPOfferPdf берёт правило из EPDocRequisites) ── */
const est = { groups: [{ name: "X", composition: "1", count: 1, unit: "шт", sum: 1 }],
  equipment: 1, discount: 0, materials: 0, work: 0, subtotal: 1, vat: 0, total: 1 };
const kp = header => buildHtml(est, { money: n => n + " €", esc, displayCurrency: () => "EUR", settings: {}, header });

test("КП: блок «Заказчик» печатает только отмеченные и непустые поля; обязательные всегда", () => {
  const html = kp({ customer: { values: { fio: "Иванов", phone: "", email: "a@b.c", legal: "ООО", address: "Тверь" }, show: { address: false } } });
  assert.match(html, /Заказчик/, "заголовок блока заказчика");
  assert.match(html, /ФИО:<\/b> Иванов/, "обязательное ФИО напечатано");
  assert.match(html, /E-mail:<\/b> a@b\.c/, "обязательный e-mail напечатан");
  assert.ok(!/Телефон:/.test(html), "пустой телефон не печатается");
  assert.match(html, /Юрлицо:<\/b> ООО/, "включённое юрлицо печатается");
  assert.ok(!/Адрес:<\/b> Тверь/.test(html), "снятый адрес заказчика не печатается");
});

test("КП: блок «Исполнитель» — отдельный блок из «Моих реквизитов»", () => {
  const html = kp({ my: { values: { fio: "Я Мастер", phone: "+7", email: "me@x.y" }, show: {} } });
  assert.match(html, /Исполнитель/, "заголовок блока исполнителя");
  assert.match(html, /ФИО:<\/b> Я Мастер/, "ФИО исполнителя напечатано");
});

test("КП: строка «Разработчик» управляется галочкой developerShow; подпись/лист не здесь", () => {
  const on = kp({ developer: "Семёнов", developerShow: true });
  const off = kp({ developer: "Семёнов", developerShow: false });
  assert.match(on, /Разработчик:<\/b> Семёнов/, "галочка включена — строка есть");
  assert.ok(!/Разработчик:<\/b> Семёнов/.test(off), "галочка снята — строки в шапке нет");
});

test("КП: пустой блок не печатается вовсе (без пустого заголовка)", () => {
  const html = kp({ project: "П", customer: { values: {}, show: {} }, my: { values: {}, show: {} } });
  assert.ok(!/Исполнитель/.test(html), "нет печатаемых «моих» — нет заголовка «Исполнитель»");
  assert.ok(!/Заказчик/.test(html), "нет печатаемого заказчика — нет заголовка «Заказчик»");
  assert.match(html, /Проект:<\/b> П/, "проектная строка на месте");
});

/* ── Места хранения: «мои» общие на все проекты (EPPrefs), заказчик — свой у каждого (снимок) ── */
function docHeaderWith(settingsDocHeader, prefsStore) {
  const EP_DATA = { settings: { docHeader: settingsDocHeader } };
  const EPPrefs = { get: (k, fb) => (k in prefsStore ? prefsStore[k] : fb), set: (k, v) => { prefsStore[k] = v; } };
  /* EPDocRequisites проброшен в контекст так же, как EPPrefs: docHeader берёт из него addressLine. */
  return stand.run(["docHeader"], { EP_DATA, EPPrefs, EPDocRequisites: R })();
}
test("docHeader: «мои реквизиты» одни на два проекта (EPPrefs), «заказчик» — свой у каждого", () => {
  const prefs = { myRequisites: { values: { fio: "Исполнитель", phone: "", email: "" }, show: {} } };
  const h1 = docHeaderWith({ customer: { values: { fio: "Клиент-1" }, show: {} } }, prefs);
  const h2 = docHeaderWith({ customer: { values: { fio: "Клиент-2" }, show: {} } }, prefs);
  assert.equal(h1.my.values.fio, "Исполнитель", "мои реквизиты из EPPrefs");
  assert.equal(h2.my.values.fio, "Исполнитель", "те же мои реквизиты у второго проекта (бланк человека общий)");
  assert.equal(h1.customer.values.fio, "Клиент-1");
  assert.equal(h2.customer.values.fio, "Клиент-2", "реквизиты заказчика — свои у каждого проекта");
});

test("docHeader: developerShow по умолчанию включён, снятое значение проходит в шапку", () => {
  assert.equal(docHeaderWith({}, {}).developerShow, true, "старый проект без поля — галочка включена");
  assert.equal(docHeaderWith({ developerShow: false }, {}).developerShow, false, "снятое значение сохраняется");
});

/* ── Проводка app.js: где что сохраняется и что миграция на боевом пути загрузки ── */
test("applyMyRequisites пишет в EPPrefs (бланк человека), а не в снимок проекта", () => {
  const src = stand.functionSource("applyMyRequisites");
  assert.match(src, /EPPrefs\.set\("myRequisites"/, "мои реквизиты уходят в EPPrefs");
  assert.ok(!/EP_DATA/.test(src), "в снимок проекта мои реквизиты НЕ пишутся");
});

test("applyCustomerRequisites пишет заказчика в снимок проекта и сохраняет", () => {
  const src = stand.functionSource("applyCustomerRequisites");
  assert.match(src, /docHeader[\s\S]*customer\s*=/, "заказчик кладётся в settings.docHeader.customer");
  assert.match(src, /scheduleSave\(\)/, "правка проекта сохраняется");
});

test("миграция client→ФИО стоит на боевом пути загрузки (fillDocHeaderInputs)", () => {
  assert.match(stand.functionSource("fillDocHeaderInputs"), /EPDocRequisites\.migrateDocHeader/,
    "fillDocHeaderInputs (зовётся и из init, и из restoreProject) выполняет миграцию");
});

/* ── Б6: структурированный адрес объекта (улица/дом/квартира/этаж → одна печатная строка) ── */

test("Б6: миграция — старый address перекладывается в addrStreet целиком, ключ убирается", () => {
  const m = R.migrateDocHeader({ address: "Москва, ул. Светлая, 1", project: "П" });
  assert.equal(m.addrStreet, "Москва, ул. Светлая, 1", "данные не потеряны — адрес целиком в addrStreet");
  assert.ok(!("address" in m), "старого поля address в снимке больше нет");
});

test("Б6: миграция не затирает заполненные addr*, но старый ключ всё равно убирает", () => {
  const m = R.migrateDocHeader({ address: "Старое", addrStreet: "Новая" });
  assert.equal(m.addrStreet, "Новая", "структурированное поле важнее старого address");
  assert.ok(!("address" in m), "address удалён и при заполненных addr*");
});

test("Б6: миграция адреса идемпотентна", () => {
  const once = R.migrateDocHeader({ address: "Тверь, пр. Мира, 10" });
  const twice = R.migrateDocHeader(once);
  assert.deepEqual(twice, once, "повторный прогон ничего не меняет");
  assert.equal(twice.addrStreet, "Тверь, пр. Мира, 10");
});

test("Б6: docHeader().address — «ул. X, д. Y, кв. Z, этаж N», пустые части пропускаются", () => {
  const full = docHeaderWith({ addrStreet: "Светлая", addrHouse: "1", addrFlat: "12", addrFloor: "3" }, {});
  assert.equal(full.address, "ул. Светлая, д. 1, кв. 12, этаж 3", "все четыре части с префиксами");
  const partial = docHeaderWith({ addrStreet: " Мира ", addrFloor: "2" }, {});
  assert.equal(partial.address, "ул. Мира, этаж 2", "пропуск пустых — без висячих запятых, края обрезаны");
  const empty = docHeaderWith({}, {});
  assert.equal(empty.address, "", "без addr* адрес пустой строкой");
});

test("Б6: поля адреса провязаны в DOC_FIELDS и заполняются fillDocHeaderInputs", () => {
  /* Структурная страховка связки (поведение адреса выше — через docHeader): поля формы должны
     писаться в addr* (applyDocHeader идёт по DOC_FIELDS) и читаться обратно из них. */
  assert.match(stand.SRC, /docAddrStreet:"addrStreet"/, "DOC_FIELDS: поле «Улица» → addrStreet");
  assert.match(stand.SRC, /docAddrFloor:"addrFloor"/, "DOC_FIELDS: поле «Этаж» → addrFloor");
  const fill = stand.functionSource("fillDocHeaderInputs");
  assert.match(fill, /\$\("docAddrStreet"\)\.value=d\.addrStreet/, "форма читает addrStreet из проекта");
  assert.ok(!/\$\("docAddress"\)/.test(fill), "старого поля docAddress в форме нет");
});

/* ── Б6, хвост: адрес без повторов обозначений (утверждено владельцем 06.11) ── */
test("addressLine: префикс рода добавляется, только когда человек сам его не написал", () => {
  /* Старый проект (весь адрес в addrStreet) печатается ровно как введён — без «ул. ул. …». */
  assert.equal(R.addressLine({ addrStreet: "г. Челябинск, ул. Ленина, 5" }), "г. Челябинск, ул. Ленина, 5",
    "полный адрес из addrStreet — как ввели");
  assert.equal(R.addressLine({ addrStreet: "ул. Мира" }), "ул. Мира", "«ул.» уже есть — не дублируем");
  assert.equal(R.addressLine({ addrStreet: "Мира" }), "ул. Мира", "обозначения нет — добавляем «ул.»");
  assert.equal(R.addressLine({ addrStreet: "проспект Ленина" }), "проспект Ленина", "«проспект» — не ставим «ул.»");
  assert.equal(R.addressLine({ addrHouse: "дом 5" }), "дом 5", "«дом» уже есть");
  assert.equal(R.addressLine({ addrHouse: "5" }), "д. 5", "голый номер дома → «д.»");
  assert.equal(R.addressLine({ addrFlat: "офис 12" }), "офис 12", "«офис» уже есть");
  assert.equal(R.addressLine({ addrFlat: "12" }), "кв. 12", "голый номер квартиры → «кв.»");
  assert.equal(R.addressLine({ addrFloor: "3 этаж" }), "3 этаж", "«этаж» уже есть (после числа)");
  assert.equal(R.addressLine({ addrFloor: "3" }), "этаж 3", "голый этаж → «этаж»");
});

test("addressLine: обозначение ловится как отдельное слово, а не как подстрока", () => {
  /* «Улитина» содержит «ул» ВНУТРИ слова — это не обозначение, «ул.» всё равно нужен. */
  assert.equal(R.addressLine({ addrStreet: "Улитина" }), "ул. Улитина", "«ул» внутри названия — не обозначение");
  /* «Этажная» — улица: род улицы не распознан, «этаж» внутри слова не мешает. */
  assert.equal(R.addressLine({ addrStreet: "Этажная" }), "ул. Этажная", "«этаж» внутри названия улицы не мешает");
});

test("addressLine: пустые части пропускаются; полная строка — как в КП", () => {
  assert.equal(R.addressLine({ addrStreet: "Мира", addrHouse: "5", addrFlat: "12", addrFloor: "3" }),
    "ул. Мира, д. 5, кв. 12, этаж 3", "четыре голых поля — КП байт-в-байт");
  assert.equal(R.addressLine({ addrStreet: " Мира ", addrFloor: "2" }), "ул. Мира, этаж 2",
    "пропуск пустых, без висячих запятых, края обрезаны");
  assert.equal(R.addressLine({}), "", "без addr* — пустая строка");
});

test("Б6: сквозной — старый проект после migrateDocHeader печатает адрес как ввели", () => {
  const migrated = R.migrateDocHeader({ address: "г. Челябинск, ул. Ленина, 5" });
  const h = docHeaderWith(migrated, {});
  assert.equal(h.address, "г. Челябинск, ул. Ленина, 5", "docHeader().address старого проекта — без повторов «ул.»");
});
