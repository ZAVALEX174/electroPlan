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
   customer к форме {values, show} заодно. Идемпотентна: migrate(migrate(x)) === migrate(x).
   Б6: единый «Адрес объекта» (dh.address) → структурированные поля addrStreet/addrHouse/addrFlat/
   addrFloor. Данные НЕ теряем: переносим целиком в addrStreet (префикс «ул. » при печати добавит
   docHeader) и только когда ВСЕ addr* пусты — заполненную структуру не затираем. Старый ключ
   убираем в любом случае: в снимке проекта address больше не живёт, печатная строка собирается
   из addr* одним правилом в docHeader (§7.1). */
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
  const addrEmpty = ["addrStreet", "addrHouse", "addrFlat", "addrFloor"]
    .every(k => dh[k] == null || String(dh[k]).trim() === "");
  if (dh.address != null && String(dh.address).trim() !== "" && addrEmpty) {
    dh.addrStreet = String(dh.address).trim();
  }
  delete dh.address;
  return dh;
}

/* Б6, хвост: ОДНА печатная строка адреса объекта «ул. X, д. Y, кв. Z, этаж N» (КП, лист монтажника,
   экспликация берут её из docHeader). Правило здесь одно (§7.1): префикс рода («ул.»/«д.»/«кв.»/
   «этаж») добавляем, ТОЛЬКО когда человек сам его не написал. Старый проект после миграции несёт
   весь единый адрес в addrStreet («г. Челябинск, ул. Ленина, 5») — в нём обозначение уже есть,
   печатаем как ввели, без «ул. ул. …».

   Граница «отдельного слова/сокращения»: штатные \b и \w в JS считают словом только ASCII, а у нас
   кириллица — поэтому границу задаём явно через look-behind/ahead по классу «буква или цифра» (W).
   Так «Улитина» не ловится на «ул» (после «ул» идёт буква), а «ул.» ловится (после — точка), и
   номер дома «5д» не считается уже снабжённым обозначением (перед «д» цифра). Флаг i даёт
   нечувствительность к регистру и для кириллицы. test() без флага g не хранит состояние. */
const W = "0-9A-Za-zА-Яа-яЁё_";
/* Обозначение как отдельный токен В ЛЮБОМ месте значения: этаж люди пишут и «3 этаж», и «этаж 3». */
function token(words) {
  return new RegExp("(?<![" + W + "])(?:" + words + ")(?![" + W + "])", "i");
}
/* Населённый пункт в НАЧАЛЕ значения улицы — это уже полный адрес, печатаем целиком, без «ул.». */
function headToken(words) {
  return new RegExp("^\\s*(?:" + words + ")(?![" + W + "])", "i");
}
const STREET_RE = token("улица|ул|проспект|пр-т|пр|переулок|пер|шоссе|ш|бульвар|б-р|набережная|наб|площадь|пл|проезд|тупик|аллея|микрорайон|мкр|тракт");
const CITY_RE = headToken("город|посёлок|поселок|пос|г|п|с|д");
const HOUSE_RE = token("дом|д");
const FLAT_RE = token("квартира|кв|офис|оф");
const FLOOR_RE = token("этаж|эт");

/* Одна часть адреса: пусто → пропускаем (висячих запятых нет); обозначение уже есть → как ввели;
   нет — добавляем префикс. Края обрезаем, как делал прежний docHeader. */
function part(value, prefix, re) {
  const v = String(value == null ? "" : value).trim();
  if (v === "") return "";
  return re.test(v) ? v : prefix + " " + v;
}
/* Улица — особый случай: обозначение рода (ул./пр./…) ИЛИ населённый пункт в начале (полный адрес). */
function streetPart(value) {
  const v = String(value == null ? "" : value).trim();
  if (v === "") return "";
  return STREET_RE.test(v) || CITY_RE.test(v) ? v : "ул. " + v;
}
function addressLine(d) {
  d = d || {};
  return [
    streetPart(d.addrStreet),
    part(d.addrHouse, "д.", HOUSE_RE),
    part(d.addrFlat, "кв.", FLAT_RE),
    part(d.addrFloor, "этаж", FLOOR_RE)
  ].filter(Boolean).join(", ");
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { MY_FIELDS, CUSTOMER_FIELDS, isChecked, shouldPrint, printedFields, migrateDocHeader, addressLine };
if (typeof window !== "undefined") window.EPDocRequisites = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
