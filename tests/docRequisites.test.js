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
  return stand.run(["docHeader"], { EP_DATA, EPPrefs })();
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
