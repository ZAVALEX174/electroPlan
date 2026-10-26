/* К11-3а. Модель данных «что показывать в листе монтажника». ТОЛЬКО чистые
   преобразования: ни DOM, ни state, ни EP_DATA — как в js/offerOptions.js.
   У листа монтажника СВОИ галочки и свои наборы, не общие с КП (владелец 26.10,
   docs/К11-разведка.md «Галочки окна листа — УТВЕРЖДЕНО»): поэтому отдельный модуль
   и отдельная схема, а не повторное использование EPOfferOptions. Печать по этим
   галочкам (К11-3б) и окно выбора (К11-3в) — следующие задачи; здесь модель и миграция. */
(() => {
"use strict";
/* Единая схема полей: ключ, подпись, умолчание. Одно описание на весь модуль —
   нормализация, наборы и будущая печать берут подписи/дефолты отсюда, второй копии
   нет (§7.1: правило живёт в одной точке). Умолчания = набор «Строителю» (полный
   лист без цен): новое поле заводится по этому образцу, а «Клиенту» выключает лишнее
   САМ (см. preset), иначе клиент недосчитался бы ровно нового поля — тот самый край. */
const fields = [
  ["plan",         "План с номерами",      true],
  ["number",       "№ поста",              true],
  ["illustration", "Иллюстрация",          true],
  ["assembled",    "Общая сборка",         true],
  ["exploded",     "Взрыв-схема",          true],
  ["fill",         "Наполнение",           true],
  ["modules",      "Модульность",          true],
  ["box",          "Монтажная коробка",    true],
  ["articles",     "Артикулы",             true],
  ["notes",        "Примечания",           true],
  /* Цены в листе — стоимость блока и суммы в «Группах света». По умолчанию ВЫКЛЮЧЕНЫ:
     набор «Строителю» цен не содержит (владелец 26.10). Умолчание и миграция старых
     проектов — отдельно (см. migrate), чтобы у сохранённого проекта цена не исчезла молча. */
  ["prices",       "Цены",                 false],
  ["lighting",     "Группы света",         true],
  ["supplier",     "Сводная спецификация", true]
];
/* Подписи рядом со схемой: будущее окно (К11-3в) берёт их отсюда, не держит вторую копию. */
const labels = Object.fromEntries(fields.map(([key, label]) => [key, label]));
/* Привести произвольный объект к чистому набору булевых флагов. Чужие ключи отбрасываем,
   не-булево → умолчание поля. Вход не мутируем: снимок проекта/EPPrefs не должен меняться
   по ссылке. Порядок ключей стабилен (идёт по fields) — на это опирается sameOptions. */
function normalize(value) {
  const v = value && typeof value === "object" ? value : {};
  const bool = (x, fallback) => typeof x === "boolean" ? x : fallback;
  const out = {};
  fields.forEach(([key, , fallback]) => { out[key] = bool(v[key], fallback); });
  return out;
}
/* Готовые наборы листа (владелец 26.10, по словам заказчика 15.10). Собираем ИЗ СХЕМЫ,
   а не перечислением всех ключей: новое поле у «Строителю» попадёт по умолчанию, а у
   «Клиенту» — выключенным (клиент видит минимум), и правка состава не растечётся краями.
   В КАЖДОМ наборе свой выбор общей сборки/взрыв-схемы — это ВНУТРИ набора листа (ответ 4А),
   в отличие от КП, где вид поста вынесен из наборов (offerOptions.js:48-57). */
function preset(name) {
  /* «Строителю» — полный монтажный лист без цен: ровно умолчания схемы. */
  if (name === "builder") return normalize();
  /* «Клиенту» — только номер и картинка (заказчик: «мне нужно номер и картинка… он не
     знает того, чем я её шпигую»). Всё, кроме плана/номера/иллюстрации, выключено:
     ни сборки/схемы, ни наполнения/модульности/коробки/артикулов/примечаний, ни цен,
     ни групп света, ни свода. */
  if (name === "client") {
    const on = { plan: true, number: true, illustration: true };
    return normalize(Object.fromEntries(fields.map(([key]) => [key, !!on[key]])));
  }
  /* Неизвестное имя — «Строителю» (полный лист): безопасное умолчание, лист не пустеет. */
  return normalize();
}
/* Стартовое состояние галочек проекта из старого поля settings.assemblyView — чтобы уже
   сохранённые проекты открывались как СЕГОДНЯ (решение Claude, docs/К11-разведка.md
   «Разведка К11-3»). Сегодня лист печатает план, номер, иллюстрацию, обе таблицы со всеми
   столбцами (наполнение/модульность/коробка/артикулы/примечания), группы света С СУММОЙ и
   свод — то есть всё включено, prices тоже (сумму в «Группах света» убирать у старых
   проектов молча нельзя). Различается только вид поста:
     - "assembled" → собранная накладка без взрыв-схемы (assembled:1, exploded:0);
     - "exploded"/нет поля/иное → иллюстрация + взрыв-схема (assembled:0, exploded:1),
       как было по умолчанию.
   Выбор набора «Строителю» (prices:0) — уже осознанное действие пользователя, не миграция. */
function migrate(settings) {
  const mode = settings && typeof settings === "object" ? settings.assemblyView : undefined;
  const assembled = mode === "assembled";
  /* Сегодняшний лист = всё включено (включая цены), поверх — вид поста из assemblyView.
     База строится из схемы: новое поле тоже попадёт «включённым», как весь лист сегодня. */
  const today = Object.fromEntries(fields.map(([key]) => [key, true]));
  today.assembled = assembled;
  today.exploded = !assembled;
  return normalize(today);
}
/* --- Свои наборы пользователя: РОВНО CUSTOM_SLOTS слотов ---
   Это ПРИВЫЧКА ЧЕЛОВЕКА (как в КП), а не свойство проекта: в приложении они живут в EPPrefs,
   а не в снимке проекта. Поведение повторяет EPOfferOptions (общий принцип), но набор полей
   свой — нормализация листа. Чтение/запись localStorage — в оркестраторе, не здесь. */
const CUSTOM_SLOTS = 3;
/* Привести массив своих наборов к ровно CUSTOM_SLOTS слотам: слот — либо {name, options}
   с непустым названием и нормализованным составом, либо null (пусто). Данные из localStorage
   не доверенные (чужой/старый ключ, лишние слоты, пустые имена) — лишнее и безымянное
   отбрасываем: без названия набор не выбрать и не отличить в списке. */
function normalizeCustomPresets(value) {
  const arr = Array.isArray(value) ? value : [];
  const out = [];
  for (let i = 0; i < CUSTOM_SLOTS; i++) {
    const slot = arr[i];
    const name = slot && typeof slot === "object" && typeof slot.name === "string" ? slot.name.trim() : "";
    out.push(name ? { name, options: normalize(slot.options) } : null);
  }
  return out;
}
/* Записать текущий состав options в слот index под именем name. Возвращает НОВЫЙ список
   (вход не мутируем). Пустое/пробельное имя или слот вне диапазона — список прежний. */
function saveCustomPreset(presets, index, name, options) {
  const list = normalizeCustomPresets(presets);
  const clean = String(name ?? "").trim();
  if (!clean || !(index >= 0 && index < CUSTOM_SLOTS)) return list;
  list[index] = { name: clean, options: normalize(options) };
  return list;
}
/* Совпадают ли два набора — сравнением нормализованного вида (порядок ключей стабилен).
   Нужен, чтобы подсветить активный набор в окне листа: человек видит, что выбрано. */
function sameOptions(a, b) {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}
const api = { fields, labels, normalize, preset, migrate, CUSTOM_SLOTS, normalizeCustomPresets, saveCustomPreset, sameOptions };
if (typeof window !== "undefined") window.EPInstallSheetOptions = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
