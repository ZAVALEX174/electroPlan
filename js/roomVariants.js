/* Варианты отделки комнаты (К8а) — чистая структурная логика. Модуль без state, DOM и каталога:
   все зависимости-предикаты приходят аргументами, как в room.js/framePicker.js (PLAN 7.1).

   --- ЗАЧЕМ ---------------------------------------------------------------------------------
   В одной комнате бывает «немецкий для вертикальных, итальянский для остальных» — заказчику нужно
   до ПЯТИ наборов отделки на помещение. Вариант = полный набор пяти признаков
   {standard, collection, frameMaterial, frameShape, frameColor}. Схема электрики и типы стен в
   вариант НЕ входят (решение владельца 24.10) — они общие на комнату.

   --- ХРАНЕНИЕ (принято, не менять) ---------------------------------------------------------
   Вариант 1 = существующие ПЛОСКИЕ поля комнаты (room.standard/collection/frameMaterial/frameShape/
   frameColor) — всё, что работало до К8а, продолжает работать без изменений, а старый проект без
   доп.вариантов читается как «одна отделка = один вариант». Варианты 2..5 — массив
   room.moreVariants = [{standard?, ...}, ...]; отсутствие поля в варианте = «не задано», ровно как у
   плоских (ту же «мёртвую»/пустую семантику разрешает EPRoom.roomCollection/roomFrameFacing). */
(() => {
"use strict";

/* Пять признаков НАКЛАДКИ В ПОРЯДКЕ КАСКАДА стандарт→серия→материал→форма→цвет. Порядок ОБЯЗАН
   совпадать с EPFramePicker.STEPS: на нём держится сброс нижележащих шагов (см. dependentFields/
   setVariantField). Это то же правило, что в app.js pickFrameStep: смена значения на шаге стирает все
   НИЖЕлежащие, чтобы итоговое сочетание не оставалось с «висящим» цветом от прежней серии. */
const FRAME_FIELDS = ["standard", "collection", "frameMaterial", "frameShape", "frameColor"];
/* Шестой признак отделки — ЦВЕТ МЕХАНИЗМОВ (К12 ч.3). В файл проекта едет как остальные (cleanVariant/
   serialize копируют его), но в линейный каскад накладки НЕ входит: его значения зависят от серии
   (совместимость механизмов — по серии), поэтому стирать его надо только при смене стандарта или серии
   (MECH_COLOR_DEPS), а смена материала/формы/цвета накладки его НЕ трогает (решение владельца 31.10).
   Поэтому он последним в FIELDS, но каскад для него отдельный (см. dependentFields). */
const MECH_COLOR = "mechColor";
const MECH_COLOR_DEPS = ["standard", "collection"];
const FIELDS = FRAME_FIELDS.concat([MECH_COLOR]);
const MAX = 5;

/* Поля, которые СБРАСЫВАЕТ смена признака prop — ЕДИНОЕ правило каскада (§7.1) для списка-вида/мастера
   (setVariantField) и окна подбора (app.js pickFrameStep). Признак накладки сбрасывает нижележащие
   признаки накладки; цвет механизмов — только стандарт и серия (см. MECH_COLOR); смена самого цвета
   механизмов не сбрасывает ничего. */
function dependentFields(prop) {
  const frameIdx = FRAME_FIELDS.indexOf(prop);
  const out = frameIdx >= 0 ? FRAME_FIELDS.slice(frameIdx + 1) : [];
  if (MECH_COLOR_DEPS.indexOf(prop) >= 0) out.push(MECH_COLOR);
  return out;
}

/* Чистит произвольный объект до варианта: берём только 5 признаков, каждый — лишь если это непустая
   строка (нестроковое/пустое = «не задано», симметрично roomCollection/roomFrameFacing). Всегда
   возвращает НОВЫЙ объект, вход не трогаем. */
function cleanVariant(src) {
  const out = {};
  if (!src || typeof src !== "object") return out;
  FIELDS.forEach(f => {
    const v = src[f];
    if (typeof v === "string" && v) out[f] = v;    /* в т.ч. mechColor — он в FIELDS, едет в файл проекта */
  });
  return out;
}

/* Список вариантов комнаты: вариант 1 из плоских полей + варианты из room.moreVariants, максимум 5.
   Мусор в moreVariants (не объект, массив, null, число) отбрасывается с подсчётом «лишних» молча —
   остаётся столько валидных, сколько влезает до MAX. Комната без полей → [{}] (один пустой вариант =
   «весь каталог», ровно сегодняшнее поведение поста в комнате без выбранной отделки). */
function list(room) {
  const variants = [cleanVariant(room)];                 /* вариант 1 — всегда плоские поля (хоть пустые) */
  const more = room && room.moreVariants;
  if (Array.isArray(more)) {
    for (let i = 0; i < more.length && variants.length < MAX; i++) {
      const entry = more[i];
      /* валиден только НЕ-массивный объект; массив/строка/число/null — мусор, пропускаем */
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      variants.push(cleanVariant(entry));
    }
  }
  return variants;
}

/* Сериализация вариантов обратно в поля комнаты: вариант 1 → плоские поля (объект fields с теми из 5
   признаков, что заданы), варианты 2..n → moreVariants. Это «новое состояние полей комнаты», которое
   вернут операции ниже; применяет его вызывающий (часть 3): плоские поля выставить/снять по fields,
   moreVariants — заменить. Срез до MAX — страховка. */
function serialize(variants) {
  const v = variants.slice(0, MAX);
  return {
    fields: Object.assign({}, v[0] || {}),
    moreVariants: v.slice(1).map(x => Object.assign({}, x))
  };
}

/* Добавить пустой вариант. Отказ при MAX → null (вызывающий покажет, что больше пяти нельзя).
   Новый вариант пуст ({} = весь каталог) — его признаки человек задаёт следом. Вход не мутируем. */
function addVariant(room) {
  const variants = list(room);
  if (variants.length >= MAX) return null;
  variants.push({});
  return serialize(variants);
}

/* Удалить вариант по индексу. Удаление первого: вариант 2 становится первым и ПЕРЕЕЗЖАЕТ в плоские
   поля (так требует модель хранения — вариант 1 всегда плоский). Нет такого индекса → состояние без
   изменений. Удалили последний оставшийся → [{}] (комната всегда имеет минимум один вариант = весь
   каталог, чтобы плоские поля не осиротели). Вход не мутируем. */
function removeVariant(room, index) {
  const variants = list(room);
  if (index < 0 || index >= variants.length) return serialize(variants);
  variants.splice(index, 1);
  if (!variants.length) variants.push({});
  return serialize(variants);
}

/* Изменить один признак варианта по индексу. Пустое/нестроковое значение СНИМАЕТ признак («Не задан»).
   Каскад — ТО ЖЕ правило, что в app.js pickFrameStep: смена признака стирает зависимые (dependentFields),
   set и clear одинаково. Неизвестный prop или индекс → состояние без изменений. Вход не мутируем. */
function setVariantField(room, index, prop, value) {
  const variants = list(room);
  if (index < 0 || index >= variants.length) return serialize(variants);
  if (FIELDS.indexOf(prop) === -1) return serialize(variants);
  const variant = Object.assign({}, variants[index]);
  if (typeof value === "string" && value) variant[prop] = value;
  else delete variant[prop];
  dependentFields(prop).forEach(f => { delete variant[f]; });
  variants[index] = variant;
  return serialize(variants);
}

/* Индекс ПЕРВОГО варианта, которому подходит накладка, иначе -1. fits — предикат (variant, frame) от
   вызывающего: модуль не знает каталога, критерий варианта строит снаружи (через EPRoom.roomCollection/
   roomFrameFacing — они читают свойство объекта, так что вариант передаётся им как «комната»). */
function fitIndex(variants, frame, fits) {
  if (!Array.isArray(variants)) return -1;
  for (let i = 0; i < variants.length; i++) {
    if (fits(variants[i], frame)) return i;
  }
  return -1;
}

/* Правило размещения готового поста (решение владельца 24.10): накладка подходит ЛЮБОМУ варианту →
   его индекс, накладку НЕ трогаем; не подходит ни одному → 0 (подмена под ПЕРВЫЙ вариант). */
function placementIndex(variants, frame, fits) {
  const i = fitIndex(variants, frame, fits);
  return i === -1 ? 0 : i;
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { FIELDS, FRAME_FIELDS, MECH_COLOR, MAX, dependentFields, list, serialize, addVariant, removeVariant, setVariantField, fitIndex, placementIndex };
if (typeof window !== "undefined") window.EPRoomVariants = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
