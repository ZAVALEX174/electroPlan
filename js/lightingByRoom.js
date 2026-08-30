/* Расчёт групп света ПО КОМНАТАМ (ЧАСТЬ 3). У каждой комнаты своя схема электрики
   (room.lightingScheme, разрешение — EPRoom.roomLightingScheme), и группы с одинаковым именем
   в разных комнатах — РАЗНЫЕ группы.

   ГРАНИЦА С js/lightingGroups.js. Тот считает ОДНУ схему на переданный список мест и ничего не
   знает ни про комнаты, ни про приложение. Здесь — раскрой проекта на партиции по комнатам,
   отдельный вызов расчёта на каждую (со СВОЕЙ схемой) и слияние результатов обратно в ту же
   форму, которую раньше возвращал один вызов plan. Ни DOM, ни state, ни каталога: место→комната
   и комната→схема приходят функциями, сам расчёт — зависимостью deps.plan (EPLightingGroups.plan),
   чтобы модуль забирали автотесты в node.

   ЗАЧЕМ ОТДЕЛЬНЫЙ ПРОХОД НА КАЖДУЮ КОМНАТУ, А НЕ ФИЛЬТР ВНУТРИ ОДНОГО. Роль механизма (выключатель
   / переключатель / инвертор) — функция от ЧИСЛА МЕСТ группы. Пока весь проект считался одним
   вызовом, «Кухня» в двух комнатах схлопывалась в одну группу с N=2 (два переключателя), хотя это
   две независимые группы по одному месту (два выключателя) — неверная смета и другой монтаж.
   Разрезав проект по комнатам, мы даём каждой «Кухне» свой N, а слияние лишь собирает результаты
   в один объект; повторно по числам ничего не пересчитывается.

   ⚠️ ДЕТЕРМИНИЗМ — как и во всём модуле групп света. Партиции обходятся в порядке СТРОКОВОГО
   ключа комнаты, а не в порядке появления комнат во входе; места внутри партиции — по возрастанию
   входного индекса. Роли внутри партиции раскладывает сам plan в своём каноническом порядке, от
   входа не зависящем. Поэтому и состав групп, и раскладка ролей, и порядок слияния воспроизводятся
   при любом порядке state.posts.

   Интерфейс приложению — window.EPLightingByRoom. */
(() => {
"use strict";

/* Счётчики ролей складываем ПО КЛЮЧАМ подпланов, а не по зашитому списку ролей: набор ролей —
   собственность модуля групп света (ROLES), и вторая его копия здесь разошлась бы при добавлении
   роли. Пустой источник ничего не добавляет. */
function addCounts(target, src) {
  if (!src) return;
  Object.keys(src).forEach(k => { target[k] = (target[k] || 0) + (Number(src[k]) || 0); });
}

/* Склейка пробелов подпланов по тому же ключу, что и addGap внутри одиночного plan: kind +
   groupKey. Без неё planByRooms печатал бы одинаковое предупреждение отдельной строкой на КАЖДУЮ
   комнату, где оно встретилось («Не указана группа света…» ×3 вместо «…· мест: 3», relay-article —
   по строке на relay-комнату): деньги это не двигает, но КП размножает дубли. Списки places (уже
   глобальные после перемапа) объединяем — «мест: N» в печати есть длина places, так что счётчик
   собирается сам. groupKey у пробелов без группы приходит null (у групповых — ключ группы);
   undefined приводим к null тем же приёмом, что и addGap, иначе undefined !== null плодил бы
   отдельные записи. Первое вхождение задаёт позицию и текст записи — порядок детерминирован
   сортировкой партиций и каноническим порядком пробелов внутри подплана.

   КОМНАТА У СКЛЕЕННОГО ПРОБЕЛА. Теперь документ называет комнату у пробела (дефект 2), а склейку
   мы СОХРАНЯЕМ — размножать одинаковое предупреждение по комнатам хуже, чем не назвать комнату у
   объединённой строки. Компромисс честный: пока пробел жил в одной комнате, roomLabel у него та
   самая комната и печатается; как только к нему подклеился пробел ДРУГОЙ комнаты, единой комнаты
   у строки больше нет — roomLabel гасим в null, и печать комнату не называет (врать «мест: 3, все
   в Кухне», когда они в трёх комнатах, нельзя). Так одиночный пробел получает свою комнату, а
   действительно общий (три пустые группы, реле без артикула во всех relay-комнатах) остаётся одной
   строкой без ложной привязки. */
function mergeGap(gaps, gap) {
  const groupKey = gap.groupKey != null ? gap.groupKey : null;
  const same = gaps.find(g => g.kind === gap.kind && g.groupKey === groupKey);
  if (same) {
    same.places = same.places.concat(gap.places || []);
    if (same.roomLabel !== gap.roomLabel) same.roomLabel = null;   /* склейка из разных комнат — единой нет */
    return;
  }
  gaps.push(Object.assign({}, gap, { groupKey, places: (gap.places || []).slice() }));
}

/* Строковый ключ партиции для Map и сортировки. Комната задаётся своим id (число или строка), а
   «пост без комнаты» — это отдельная партиция (ключ null). Префиксы разводят их гарантированно:
   комната с id "" и «нет комнаты» не должны слиться, а число 1 и строка "1" как id комнаты — это
   одна и та же комната приложения, поэтому оба идут через String. Ключ «нет комнаты» — обычная
   читаемая строка без префикса "r:": она заведомо не совпадёт ни с одним ключом комнаты (все они
   начинаются с "r:"). ПОРЯДОК партиций в документе задаёт orderForPartition (ранг комнаты), а norm
   служит лишь ДЕТЕРМИНИРОВАННЫМ тайбрейком при равных рангах — сам по себе он смысла не несёт.
   Раньше здесь стоял СЫРОЙ НУЛЕВОЙ БАЙТ: из-за него git и ripgrep считали файл бинарным, а дифф
   нечитаемым; читаемая строка тот же порядок даёт. */
const partitionNorm = key => (key == null ? "no-room" : "r:" + String(key));

/* planByRooms(input) → слитый план в форме EPLightingGroups.plan.
   input = {
     places,                 // МЕСТА управления (EPLightingPlan.collect), полный список проекта
     partitionKeyOf(place),  // место → id комнаты его поста, либо null (пост без комнаты)
     schemeForPartition(key),// id комнаты (или null) → id действующей схемы этой партиции
     labelForPartition(key), // id комнаты (или null) → ПОДПИСЬ комнаты для документа (роль «без
     //                         комнаты» даёт свою честную подпись, напр. «Без помещения»); нужна,
     //                         чтобы группа/реле/пробел печатались с комнатой (одноимённые группы
     //                         разных комнат в КП были неразличимы). Необязательна — по умолчанию "".
     orderForPartition(key), // id комнаты (или null) → числовой РАНГ для порядка партиций в
     //                         документе (обычно индекс комнаты в state.rooms, «без комнаты» —
     //                         Infinity, чтобы шла последней, как в листе монтажника). Необязательна —
     //                         по умолчанию все ранги равны, и порядок задаёт строковый ключ (см. ниже).
     projectScheme,          // схема проекта — она же схема партиции «без комнаты»
     projectSchemeLabel,     // подпись схемы проекта; в заголовок идёт, только если ВСЕ партиции
     //                         посчитаны одной схемой — иначе шапка честно говорит «по комнатам».
     plan,                   // EPLightingGroups.plan — сам расчёт одной схемы (зависимость)
     planDeps                // deps для plan: { seriesOf, findMechanism } — ОДИН объект на все
   }                         //   партиции, чтобы побочный сбор (ambiguous) копился сквозь них.
   Возвращает объект той же формы, что и plan: { scheme, schemeLabel, supported, places, order,
   groups, unassigned, duplicates, totals, totalsRequired, missingTotal, relays, relayTotal, gaps }.
   places СЛИТОГО плана выровнены по индексу ВХОДНОГО списка мест — ровно как у одиночного plan,
   поэтому EPLightingPlan.rowsByPost(plan, places, …) читает src[i] по-прежнему. */
function planByRooms(input) {
  const o = input || {};
  const sources = Array.isArray(o.places) ? o.places : [];
  const partitionKeyOf = typeof o.partitionKeyOf === "function" ? o.partitionKeyOf : () => null;
  const schemeForPartition = typeof o.schemeForPartition === "function" ? o.schemeForPartition : () => o.projectScheme;
  /* Подпись и ранг комнаты — чисто ДОКУМЕНТНЫЕ (деньги и раскладку ролей не трогают). По умолчанию
     подписи нет ("") и ранги равны — тогда порядок задаёт строковый ключ, как было до дефекта 3. */
  const labelForPartition = typeof o.labelForPartition === "function" ? o.labelForPartition : () => "";
  const orderForPartition = typeof o.orderForPartition === "function" ? o.orderForPartition : () => 0;
  const runPlan = typeof o.plan === "function" ? o.plan : null;
  const planDeps = o.planDeps || {};
  const projectScheme = o.projectScheme;
  if (!runPlan) throw new Error("planByRooms: обязателен input.plan (EPLightingGroups.plan)");

  /* Пустой проект — ОДИН расчёт по схеме проекта, точно как раньше. Форма плана уже нужная,
     сливать нечего, а пробел «схема не описана заказчиком» на пустом проекте обязан сохраниться:
     его plan ставит и при нуле мест (интерфейсу нужна причина, даже когда постов нет). */
  if (!sources.length) return runPlan({ scheme: projectScheme, places: [] }, planDeps);

  /* Партиционирование: входные индексы мест по ключу комнаты, в порядке ВОЗРАСТАНИЯ индекса —
     порядок state.posts на состав партиции не влияет, а plan внутри всё равно канонизирует. */
  const buckets = new Map();
  /* Обход по ИНДЕКСУ, а не forEach: forEach проскакивает дыры разреженного массива (приложение
     отдаёт такой после delete places[i] — удалили клавишу, индексы прочих сохранились), и место с
     индексом-дырой не попало бы НИ В ОДНУ партицию — слитый план вернулся бы с дырой, как это уже
     ловил одиночный plan (см. canonicalOrder в lightingGroups). sources[index] || {} на входе:
     у дыры (undefined) partitionKeyOf приложения читает place.postId и упал бы TypeError'ом, роняя
     перерисовку через lightingFor→projectLighting→renderSummary; одиночный plan разбирает такое
     место как честный пробел (raw || {}) — здесь то же, дыра уходит в свою партицию и там честно
     становится пробелом «группа не назначена». */
  for (let index = 0; index < sources.length; index++) {
    const key = partitionKeyOf(sources[index] || {}, index);
    const norm = partitionNorm(key == null ? null : key);
    let bucket = buckets.get(norm);
    if (!bucket) { bucket = { key: key == null ? null : key, norm, indices: [] }; buckets.set(norm, bucket); }
    bucket.indices.push(index);
  }

  /* Детерминированный порядок партиций. Сначала по РАНГУ комнаты (orderForPartition) — чтобы блок
     групп света шёл в том же порядке, что помещения в листе монтажника (комнаты в порядке
     state.rooms, «без комнаты» рангом Infinity уходит в конец, дефект 3). Сравнение через < / >,
     а не вычитание: Infinity - Infinity = NaN сломал бы сортировку. При равных рангах (в т.ч.
     дефолт, где ранги равны, и комнаты вне переданного порядка — им приложение даёт Infinity)
     тайбрейк по строковому ключу держит детерминизм при любом порядке входа. */
  const ordered = [...buckets.values()].sort((a, b) => {
    const ra = orderForPartition(a.key), rb = orderForPartition(b.key);
    if (ra < rb) return -1;
    if (ra > rb) return 1;
    return a.norm < b.norm ? -1 : (a.norm > b.norm ? 1 : 0);
  });

  const merged = {
    scheme: projectScheme,
    schemeLabel: o.projectSchemeLabel || "",
    /* supported=false как старт для ИЛИ по партициям (см. ниже, где считаем supported). */
    supported: false,
    places: new Array(sources.length),
    order: [],
    groups: [],
    unassigned: { placeCount: 0, places: [] },
    duplicates: [],
    totals: {},
    totalsRequired: {},
    missingTotal: 0,
    relays: [],
    relayTotal: 0,
    gaps: [],
    /* Заголовок: одна схема на все партиции → её и печатаем; разные → «по комнатам» (см. ниже). */
    schemesByRoom: false
  };

  /* Какими схемами реально считались партиции — для честной шапки документа (дефект 1). Раньше
     merged.schemeLabel всегда был схемой ПРОЕКТА, и над механизмами чужой схемы комнаты печаталось
     имя схемы, которой ни одна комната не пользовалась. */
  const usedSchemes = new Set();
  let uniformSchemeLabel = "";

  ordered.forEach(bucket => {
    const idx = bucket.indices;                 /* входные индексы этой партиции, по возрастанию */
    const remap = j => idx[j];                   /* индекс внутри подплана → индекс входного списка */
    const roomLabel = labelForPartition(bucket.key);   /* подпись комнаты для групп/реле/пробелов */
    const subPlaces = idx.map(i => sources[i]);
    const sub = runPlan({ scheme: schemeForPartition(bucket.key), places: subPlaces }, planDeps) || {};
    usedSchemes.add(sub.scheme);
    uniformSchemeLabel = sub.schemeLabel || uniformSchemeLabel;

    /* Места подплана возвращают выдачу на СВОИХ позициях (0..k-1); раскладываем их обратно на
       позиции входного списка проекта, чтобы rowsByPost и planSignature читали место по прежнему
       индексу. Поле index места правим на глобальное — иначе оно указывало бы в подсписок. */
    (Array.isArray(sub.places) ? sub.places : []).forEach((p, j) => {
      const orig = remap(j);
      merged.places[orig] = p ? Object.assign({}, p, { index: orig }) : p;
    });
    /* Все прочие массивы подплана несут ИНДЕКСЫ ПОДСПИСКА — их тоже переводим в глобальные,
       иначе слитый план ссылался бы сам на себя не туда. */
    (Array.isArray(sub.order) ? sub.order : []).forEach(j => merged.order.push(remap(j)));
    (Array.isArray(sub.groups) ? sub.groups : []).forEach(g => {
      /* roomLabel — чтобы одноимённые группы разных комнат («Кухня» и «Кухня») различались в КП. */
      merged.groups.push(Object.assign({}, g, { places: (g.places || []).map(remap), roomLabel }));
    });
    if (sub.unassigned) {
      merged.unassigned.placeCount += Number(sub.unassigned.placeCount) || 0;
      (sub.unassigned.places || []).forEach(j => merged.unassigned.places.push(remap(j)));
    }
    (Array.isArray(sub.duplicates) ? sub.duplicates : []).forEach(j => merged.duplicates.push(remap(j)));
    (Array.isArray(sub.gaps) ? sub.gaps : []).forEach(g => {
      mergeGap(merged.gaps, Object.assign({}, g, { places: (g.places || []).map(remap), roomLabel }));
    });
    (Array.isArray(sub.relays) ? sub.relays : []).forEach(r => merged.relays.push(Object.assign({}, r, { roomLabel })));

    addCounts(merged.totals, sub.totals);
    addCounts(merged.totalsRequired, sub.totalsRequired);
    merged.missingTotal += Number(sub.missingTotal) || 0;
    merged.relayTotal += Number(sub.relayTotal) || 0;
    /* supported СЛИВАЕМ через ИЛИ: план поддержан, если ПО КРАЙНЕЙ МЕРЕ ОДНА партиция посчитана по
       поддержанной схеме. Прежнее И лгало на смешанном проекте (classic + bell): оно объявляло весь
       план supported=false, одновременно возвращая подобранные механизмы в totals — план утверждал
       о себе неправду. С ИЛИ противоречия нет: totals непусты ⇒ supported=true; supported=false
       остаётся только когда НИ ОДНА партиция не поддержана — тогда totals пусты, и это правда.
       Непосчитанные партиции (bell) не теряются молча: каждая уже сигналит о себе своим пробелом
       scheme-not-implemented и missingReason у мест — их несёт merged.gaps. Флаг проекта же честно
       говорит лишь «есть ли в плане хоть что-то посчитанное», а не «всё ли посчитано». */
    merged.supported = merged.supported || !!sub.supported;
  });

  /* Шапка документа (дефект 1). Все партиции посчитаны ОДНОЙ схемой → печатаем её подпись, как
     раньше. Схемы разошлись по комнатам → одну называть нельзя (над «Классической» стояло бы
     «Импульсное реле» из relay-комнаты) — поднимаем флаг, и печать скажет «по комнатам». */
  if (usedSchemes.size === 1) {
    merged.scheme = [...usedSchemes][0];
    merged.schemeLabel = uniformSchemeLabel;
  } else {
    merged.schemesByRoom = true;
  }

  return merged;
}

/* Подпись кэша расчёта — тоже ЗДЕСЬ и под тестом: без комнат в подписи смена схемы у одной
   комнаты или переезд поста в другую комнату кэш не сбрасывали, и расчёт молча оставался старым
   (в модуле уже ловили этот класс: кэш отдавал 40.52 € против 0 €). В подпись входит ВСЁ, от чего
   зависит расчёт: схема проекта, число товаров каталога, по каждому посту — набор клавиш, их
   группы, номер (решает канонический порядок ролей) И ПРИВЯЗКА К КОМНАТЕ (roomId), по каждой
   комнате — её ДЕЙСТВУЮЩАЯ схема (schemeOf, обычно EPRoom.roomLightingScheme). Смена схемы у
   комнаты меняет её запись, переезд поста — его roomId; и то и другое сбрасывает кэш. */
function cacheSignature(input) {
  const o = input || {};
  const posts = Array.isArray(o.posts) ? o.posts : [];
  const rooms = Array.isArray(o.rooms) ? o.rooms : [];
  const schemeOf = typeof o.schemeOf === "function" ? o.schemeOf : () => o.projectScheme;
  return JSON.stringify([
    o.projectScheme,
    o.productCount,
    posts.map(p => [p.id, p.number, p.mechanismIds, p.keyGroups, p.roomId == null ? null : p.roomId]),
    rooms.map(r => [r.id, schemeOf(r)])
  ]);
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { planByRooms, cacheSignature };
if (typeof window !== "undefined") window.EPLightingByRoom = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
