/* Реквизиты коммерческого предложения (A5, итоги встречи 24.08 §1.3): два блока в шапке КП —
   «Исполнитель» (мои реквизиты, заполняются один раз и стоят во всех проектах, как логотип) и
   «Заказчик» (свои у каждого проекта). У каждого поля — галочка «показывать в КП»; у ФИО и
   контактов (обязательный минимум) она всегда включена и не снимается.

   Здесь — ЧИСТАЯ логика (без state/DOM/EP_DATA): какие поля вообще бывают, ОДНО правило «печатать
   ли поле» (§7.1 — и панель, и КП берут его отсюда, чтобы список полей и документ не разошлись) и
   миграция старого поля «Клиент» в ФИО заказчика. Значения приходят аргументами; экранирование —
   на стороне потребителя (offerPdf), сюда сырые строки и возвращаются. */
(() => {
"use strict";

/* Поля «Мои реквизиты» (исполнитель) и «Реквизиты заказчика». required:true — обязательный минимум
   (ФИО и контакты): галочка всегда включена. У заказчика ИНН нет (решение владельца п.3 — только
   ФИО, телефон, e-mail, юрлицо, адрес); у исполнителя ИНН есть. */
const MY_FIELDS = [
  { key: "fio", label: "ФИО", required: true },
  { key: "phone", label: "Телефон", required: true },
  { key: "email", label: "E-mail", required: true },
  { key: "legal", label: "Юрлицо", required: false },
  { key: "inn", label: "ИНН", required: false },
  { key: "address", label: "Адрес", required: false }
];
const CUSTOMER_FIELDS = [
  { key: "fio", label: "ФИО", required: true },
  { key: "phone", label: "Телефон", required: true },
  { key: "email", label: "E-mail", required: true },
  { key: "legal", label: "Юрлицо", required: false },
  { key: "address", label: "Адрес", required: false }
];

/* Включена ли галочка поля. Обязательное — всегда (в панели disabled checked, снять нельзя);
   необязательное — по сохранённому show. Отсутствие ключа трактуем как «включено»: заполнил —
   печатается (решение владельца п.3). Снятая галочка — это show[key]===false, именно и только. */
function isChecked(field, show) {
  if (field.required) return true;
  return (show || {})[field.key] !== false;
}

/* ОДНО правило «печатать ли поле» на панель и документ (§7.1): пустое значение — НИКОГДА (решение
   владельца п.4, «Клиент: —» в документе не нужен); непустое обязательное — всегда; непустое
   необязательное — только при включённой галочке. */
function shouldPrint(field, values, show) {
  const v = (values || {})[field.key];
  if (v == null || String(v).trim() === "") return false;
  return isChecked(field, show);
}

/* Поля блока, которые попадут в документ: отфильтрованы по shouldPrint, значения обрезаны по краям.
   Пустой результат → блок печатать не нужно вовсе (без пустого заголовка). */
function printedFields(fields, values, show) {
  return fields
    .filter(f => shouldPrint(f, values, show))
    .map(f => ({ key: f.key, label: f.label, value: String(values[f.key]).trim() }));
}

/* Миграция старого проекта: поле «Клиент» (docHeader.client) становится ФИО заказчика
   (customer.values.fio). Данные НЕ теряем — переносим только если своего ФИО ещё нет; старый ключ
   убираем, чтобы строки «Клиент» в шапке КП не осталось (её заменяет блок «Заказчик»). Приводим
   customer к форме {values, show} заодно. Идемпотентна: migrate(migrate(x)) === migrate(x). */
function migrateDocHeader(docHeader) {
  const dh = Object.assign({}, docHeader || {});
  const customer = Object.assign({}, dh.customer || {});
  const values = Object.assign({}, customer.values || {});
  const old = dh.client;
  if (old != null && String(old).trim() !== "" && (values.fio == null || String(values.fio).trim() === "")) {
    values.fio = String(old);
  }
  customer.values = values;
  customer.show = Object.assign({}, customer.show || {});
  delete dh.client;
  dh.customer = customer;
  return dh;
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { MY_FIELDS, CUSTOMER_FIELDS, isChecked, shouldPrint, printedFields, migrateDocHeader };
if (typeof window !== "undefined") window.EPDocRequisites = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
