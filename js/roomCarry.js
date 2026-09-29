/* Перенос пользовательских полей комнаты при пересчёте контуров.

   ЗАЧЕМ. Пересчёт помещений (detectRooms / detectRoomsML / buildRoomsFromLines) выбрасывает
   ВСЕ авто-комнаты (autoPolygon===true) и строит новые с новым uid("room_") и авто-именем
   «Комната N» / «Помещение N». Вместе с объектом гибнет всё, что человек ввёл руками — сейчас
   это ИМЯ и ПЛОЩАДЬ (набор имени, в отличие от правки вершин, не снимает autoPolygon). Этот
   модуль сопоставляет старые авто-комнаты с новыми по ГЕОМЕТРИИ и говорит оркестратору, какие
   пользовательские поля на какую новую комнату перенести. Само чтение state.rooms и запись
   полей остаются в app.js — здесь только чистое сопоставление, без state и без DOM.

   ЧТО ПЕРЕНОСИМ. Только введённое человеком: имя (если оно НЕ авто-формата), непустую площадь,
   схему электрики комнаты (room.lightingScheme — своя схема, отличная от проектной), монтажный
   стандарт (room.standard — IT/DE), коллекцию накладок (room.collection, E13) и отделку накладок
   комнаты (room.frameMaterial/frameShape/frameColor, E14). Список полей расширяется в normUserFields —
   правило сбора «ручного» держим в одной точке.
   НЕ переносим геометрию (polygon, seedX/seedY, x/y, roomSource) и id — они на то и
   пересчитываются, а привязка объектов к комнатам всё равно пересчитывается заново.

   ПРАВИЛО СОПОСТАВЛЕНИЯ (детерминированное, порядко-независимое). У каждой комнаты берём ТОЧКУ
   СОПОСТАВЛЕНИЯ — EPGeom.roomMatchPoint: центроид, когда он ВНУТРИ контура (выпуклые/прямоугольные),
   иначе полюс недоступности — точку ВНУТРИ вогнутого (Г/П-образного) контура. Раньше тут стоял голый
   центроид, а у Г/П-комнат он уезжает НАРУЖУ (среднее вершин вне контура), и двунаправленная проверка
   проваливалась ВСЕГДА: при любой пересборке такая комната получала новое id, авто-имя и пустые поля,
   теряя имя/площадь/схему/коллекцию/отделку (мотив В13). Пара «старая O — новая N» считается «той же
   областью», если точка O лежит внутри N И точка N лежит внутри O (двунаправленное попадание —
   симметричный признак, не зависящий от порядка входа), а меньшая из площадей составляет не меньше
   AREA_RATIO_MIN от большей (страховка: при полностью перерисованной планировке имена не налипают на
   несвязанные комнаты). Из всех прошедших пар берём взаимно-однозначное соответствие: сортируем
   кандидатов по близости площадей (лучший первым), тай-брейк — по ГЕОМЕТРИЧЕСКИМ ключам (точка
   сопоставления, затем площадь), а НЕ «кто первый во входе», и жадно назначаем, пропуская уже занятые
   O и N. Так одна старая не отдаёт имя двум новым и одна новая не берёт имена от двух старых.

   РАЗДЕЛЕНИЕ И СЛИЯНИЕ. Комнаты внутри каждого набора — разбиение плоскости, т.е. не перекрываются.
   Точка сопоставления лежит внутри СВОЕГО контура (гарантия roomMatchPoint), поэтому точка новой
   попадает максимум в одну старую, а точка старой — максимум в одну новую: двунаправленный признак сам
   даёт «один-к-одному». При РАЗДЕЛЕНИИ (одна старая → две новых) поля достаются тому фрагменту, внутрь
   которого попала точка сопоставления старой; второй фрагмент получает свежее авто-имя. При СЛИЯНИИ
   (две старых → одна новая) поля берутся у той старой, внутрь которой попала точка новой. Правило
   спорное, но устойчивое и объяснимое; жадное назначение с геометрическим тай-брейком добивает редкий
   вырожденный случай перекрытия. */
(() => {
"use strict";

/* Порог «осмысленности» совпадения по площади: меньшая комната пары должна быть не меньше
   четверти большей. Достаточно свободный, чтобы пережить неравные разделения/слияния, и
   достаточно строгий, чтобы сливер не украл имя у крупной комнаты (и наоборот). */
const AREA_RATIO_MIN = 0.25;

/* Геометрия берётся из EPGeom — не дублируем pointInPolygon/centroid/area. В браузере namespace
   уже загружен (geometry.js подключён раньше), в Node — резолвим через require. Можно передать
   свой geom аргументом (для тестов), но по умолчанию хватает глобального. */
function defaultGeom() {
  if (typeof window !== "undefined" && window.EPGeom) return window.EPGeom;
  if (typeof require !== "undefined") return require("./geometry.js");
  return null;
}

/* Авто-имя — то, что пересчёт раздаёт сам: «Комната N» и «Помещение N». Такие имена переносить
   НЕЛЬЗЯ: они конфликтуют с нумерацией новых комнат и родят дубли. Правило распознавания живёт
   здесь одно (не размазано по вызывающим). «Новая комната» (ручная) сюда не входит намеренно —
   ручные комнаты пересчёт не трогает, источниками переноса они не бывают. */
function isAutoName(name) {
  return /^(Комната|Помещение)\s+\d+$/.test(String(name == null ? "" : name).trim());
}

/* Валидный полигон для сопоставления: замкнутый контур из ≥3 вершин. Вручную созданная комната
   полигона не имеет (её создают без него) — на такой функция не падает, просто не матчит. */
function hasPolygon(r) {
  return !!r && Array.isArray(r.polygon) && r.polygon.length >= 3;
}

/* Собираем «ручные» поля старой комнаты для переноса. Здесь же нормализация как в saveRoom:
   trim, пустое → не переносим (null). Имя авто-формата не переносим. Точка расширения: новые
   пользовательские поля комнаты добавлять сюда. */
function normUserFields(o) {
  const rawName = String(o.name == null ? "" : o.name).trim();
  const name = rawName && !isAutoName(rawName) ? rawName : null;
  const rawArea = String(o.area == null ? "" : o.area).trim();
  const area = rawArea ? rawArea : null;
  /* Схема электрики комнаты (её ввёл человек, autoPolygon это не снимает — как и имя/площадь).
     Переносим ТОЛЬКО непустую строку: отсутствие поля = «как в проекте» (EPRoom.roomLightingScheme),
     и материализовать его в значение при переносе нельзя — иначе комната, которая следовала за
     проектом, после первого же пересчёта контуров молча прибила бы к себе схему. Валидность id
     здесь не проверяем: список схем — забота представления, перенос обязан сохранить ровно то,
     что стоит в поле. */
  const rawScheme = o.lightingScheme;
  const lightingScheme = typeof rawScheme === "string" && rawScheme ? rawScheme : null;
  /* Коллекция накладок комнаты (room.collection, E13) — такое же введённое человеком поле, как
     схема: пересчёт контуров стирает авто-комнаты, и без переноса коллекция исчезала бы при
     каждой правке линий разметки — молчаливая потеря настройки. Переносим ТОЛЬКО непустую строку;
     отсутствие поля = «коллекция не задана», материализовать его нельзя. Валидность названия по
     каталогу здесь не проверяем — это забота представления, перенос сохраняет ровно то, что стоит
     (мёртвое значение отфильтрует уже EPRoom.roomCollection при чтении). */
  const rawCollection = o.collection;
  const collection = typeof rawCollection === "string" && rawCollection ? rawCollection : null;
  /* Монтажный стандарт комнаты (room.standard, IT/DE — решение владельца по В13: переносить). Это
     введённое человеком поле, как коллекция/отделка: задаёт, из какого стандарта конструктор предлагает
     накладки. Стандарт пропадает при пересборке у ВСЕХ форм (и у прямоугольных), поэтому переносим тем
     же правилом: непустая строка или null; отсутствие = «не задан», материализовать нельзя. Валидность
     стандарта по каталогу здесь не проверяем — забота представления. Каскад «смена стандарта сбрасывает
     серию/отделку» живёт в интерактивном мастере (framePicker), а не в записи поля, поэтому прямое
     присваивание при переносе его не задевает: восстанавливаем ровно то сочетание, что человек и задал. */
  const rawStandard = o.standard;
  const standard = typeof rawStandard === "string" && rawStandard ? rawStandard : null;
  /* Отделка накладки комнаты (E14: frameMaterial/frameShape/frameColor) — такие же введённые
     человеком поля, как коллекция: без переноса они исчезали бы при каждой правке линий разметки
     (scheduleRoomsFromLines пересобирает авто-комнаты). Переносим ТОЛЬКО непустую строку; отсутствие
     поля = «признак не задан», материализовать нельзя. Валидность по каталогу здесь не проверяем —
     мёртвое написание отсеет EPRoom.roomFrameFacing при чтении, как у коллекции. */
  const facing = (raw) => (typeof raw === "string" && raw ? raw : null);
  const frameMaterial = facing(o.frameMaterial);
  const frameShape = facing(o.frameShape);
  const frameColor = facing(o.frameColor);
  return { name, area, lightingScheme, standard, collection, frameMaterial, frameShape, frameColor };
}

/* Есть ли в наборе полей хоть одно переносимое (не null). Одно правило «нести/помнить нечего» —
   и у carry (пара занята, но переноса не создаём), и у памяти В15 (набор без полей не запоминаем).
   Раздельные копии этого условия молча разъехались бы при добавлении нового поля в normUserFields. */
function hasAnyField(f) {
  return f.name != null || f.area != null || f.lightingScheme != null || f.standard != null
    || f.collection != null || f.frameMaterial != null || f.frameShape != null || f.frameColor != null;
}

/* carry(oldRooms, newRooms[, geom]) → массив переносов
   [{ toId, fromId, name, area, lightingScheme, standard, collection, frameMaterial, frameShape, frameColor }].
   Каждый перенос — на ОДНУ новую комнату (toId); каждое поле = значение для записи либо null, если оно
   не переносится. В массив попадают только пары, где переносить есть хоть что-то. geom по умолчанию —
   EPGeom (defaultGeom); из него берётся roomMatchPoint — точка сопоставления ВНУТРИ контура (В13). */
function carry(oldRooms, newRooms, geom) {
  geom = geom || defaultGeom();
  if (!geom) return [];
  const pointIn = geom.pointInPolygon, matchPoint = geom.roomMatchPoint, areaPx = geom.polygonAreaPx;

  /* Источники — только уничтожаемые авто-комнаты с валидным контуром. autoPolygon===false —
     это ручной контур (правка вершин), он пересчёт переживает и источником не бывает. */
  const sources = (oldRooms || []).filter(o => hasPolygon(o) && o.autoPolygon !== false);
  const targets = (newRooms || []).filter(hasPolygon);

  /* Кэшируем точку сопоставления (внутри контура) и площадь ОДИН раз на комнату — чтобы не считать в
     двойном цикле (В13 И5). У выпуклых точка = центроид, у Г/П — полюс недоступности (roomMatchPoint). */
  const srcMeta = sources.map(o => ({ room: o, c: matchPoint(o.polygon), a: areaPx(o.polygon) }));
  const dstMeta = targets.map(n => ({ room: n, c: matchPoint(n.polygon), a: areaPx(n.polygon) }));

  const cands = [];
  srcMeta.forEach(s => {
    dstMeta.forEach(d => {
      /* двунаправленное попадание точек сопоставления — симметричный, не зависящий от порядка признак */
      if (!pointIn(s.c.x, s.c.y, d.room.polygon)) return;
      if (!pointIn(d.c.x, d.c.y, s.room.polygon)) return;
      const ratio = s.a > 0 && d.a > 0 ? Math.min(s.a, d.a) / Math.max(s.a, d.a) : 0;
      if (ratio < AREA_RATIO_MIN) return;   /* страховка от прилипания к несвязанной области */
      cands.push({ s, d, ratio });
    });
  });

  /* Детерминированный порядок: ближе площади — раньше; тай-брейк по геометрическим ключам
     (точка сопоставления X, Y, затем площадь), а не по порядку входа. keyCmp сравнивает предвычисленные
     метрики, поэтому результат один и тот же при любой перестановке входных массивов. */
  cands.sort((A, B) => B.ratio - A.ratio || keyCmp(A.s, B.s) || keyCmp(A.d, B.d));

  const usedSrc = new Set(), usedDst = new Set(), out = [];
  cands.forEach(c => {
    if (usedSrc.has(c.s.room) || usedDst.has(c.d.room)) return;   /* один-к-одному */
    const f = normUserFields(c.s.room);
    /* пара занята в любом случае (один-к-одному), но перенос добавляем, только если есть что нести */
    if (!hasAnyField(f)) { usedSrc.add(c.s.room); usedDst.add(c.d.room); return; }
    usedSrc.add(c.s.room); usedDst.add(c.d.room);
    out.push({ toId: c.d.room.id, fromId: c.s.room.id, name: f.name, area: f.area, lightingScheme: f.lightingScheme,
      standard: f.standard, collection: f.collection, frameMaterial: f.frameMaterial, frameShape: f.frameShape, frameColor: f.frameColor });
  });
  return out;
}

/* Устойчивый геометрический ключ: точка сопоставления, затем площадь. Порядок входа не участвует. */
function keyCmp(a, b) {
  return a.c.x - b.c.x || a.c.y - b.c.y || a.a - b.a;
}

/* ПАМЯТЬ ПОЛЕЙ ИСЧЕЗНУВШИХ КОМНАТ (В15). Предел числа НАБОРОВ, которые память держит разом. Реальный
   план — десятки комнат; 64 с запасом покрывает «удалил стену → перерисовал» для всех, но не даёт
   памяти пухнуть без предела на бесконечной серии правок. При переполнении вытесняем СТАРЕЙШИЕ (FIFO,
   срез с начала): свежезабытые нужнее — их вот-вот перерисуют, а совсем старые уже вряд ли вернутся. */
const MEMORY_LIMIT = 64;

/* reconcile(oldRooms, newRooms, memory[, geom]) → { transfers, memory }
   Расширяет carry ПАМЯТЬЮ исчезнувших комнат (В15). Мотив: удалили стену — контур комнаты разомкнулся,
   грани у неё больше нет, комната исчезает вместе с введёнными человеком полями; перерисовали стену —
   комната возвращается пустым «Помещение N». Один carry этого не лечит: между удалением и перерисовкой
   исходной комнаты уже нет в state.rooms, и переносить не с чего. Память хранит поля «растворившихся»
   комнат до их возвращения.

   ДВЕ ФАЗЫ, память — ДОБАВКА к carry, не замена:
     1) обычный carry(old→new) — БАЙТ-В-БАЙТ как раньше: пересборки, где ничего не исчезло и не слилось,
        дают ТОТ ЖЕ перенос (Ж3). Из его итога берём, кто из старых комнат С ПОЛЯМИ НЕ нашёл новую, —
        их поля уходят в память (комната удалена совсем или слилась с соседкой);
     2) записи ПАМЯТИ восстанавливаются на новые комнаты, которые в фазе 1 полей не получили
        (свежепостроенные «Помещение N»), — ТЕМ ЖЕ правилом, что carry (двунаправленное попадание точек
        ВНУТРЬ контуров + порог площади AREA_RATIO_MIN, назначение один-к-одному). Второй копии геометрии
        нет: те же pointInPolygon/roomMatchPoint/polygonAreaPx.

   ПОЧЕМУ НЕ ПУТАЮТСЯ ПОЛЯ (Ж2). Точка сопоставления лежит ВНУТРИ своего контура и привязывает набор к
   ГЕОМЕТРИЧЕСКОЙ ОБЛАСТИ, а не к комнате-объекту. При слиянии A+B→M одна из старых наследуется M через
   carry (по своей точке), ВТОРАЯ уходит в память со СВОИМ полигоном. При обратном разделении M→A'+B'
   carry возвращает наследницу в её фрагмент, а память — вторую в её фрагмент: набор приходит именно
   туда, где была его область, без перестановки. Комната без полей ничего не помнит; комната, чьи поля
   уже уехали в новую, в память не дублируется — иначе набор раздался бы дважды (Ж4).

   Память — чистые данные [{ polygon, fields }]; state и запись в state.rooms остаются в app.js. Здесь ни
   state, ни DOM: прежнюю память принимаем аргументом, обновлённую возвращаем — хранит и кладёт её в
   проект (переживает автосейв и перезагрузку) оркестратор. */
function reconcile(oldRooms, newRooms, memory, geom) {
  geom = geom || defaultGeom();
  memory = Array.isArray(memory) ? memory : [];
  if (!geom) return { transfers: [], memory };
  const pin = geom.pointInPolygon, mpoint = geom.roomMatchPoint, apx = geom.polygonAreaPx;

  /* Фаза 1 — обычный перенос старая→новая, дословно (Ж3). */
  const transfers = carry(oldRooms, newRooms, geom);
  const usedTo = new Set(transfers.map(t => t.toId));     /* новые, уже получившие поля в фазе 1 */
  const usedFrom = new Set(transfers.map(t => t.fromId)); /* старые, чьи поля уже уехали в новую */

  /* В память — старые авто-комнаты С ПОЛЯМИ, не нашедшие новую (исчезли/слились). Ручные контуры
     (autoPolygon===false) пересчёт не трогает, источниками не бывают — их не помним (Ж6). */
  const fresh = [];
  (oldRooms || []).forEach(o => {
    if (!hasPolygon(o) || o.autoPolygon === false || usedFrom.has(o.id)) return;
    const f = normUserFields(o);
    if (!hasAnyField(f)) return;
    fresh.push({ polygon: o.polygon.map(p => ({ x: p.x, y: p.y })), fields: f });
  });

  /* Фаза 2 — восстановление из памяти на СВОБОДНЫЕ (не занятые фазой 1) новые комнаты. */
  const freeTargets = (newRooms || []).filter(n => hasPolygon(n) && !usedTo.has(n.id));
  const memMeta = memory.map((m, i) => ({ i, poly: m.polygon, fields: m.fields, c: mpoint(m.polygon), a: apx(m.polygon) }));
  const dstMeta = freeTargets.map(n => ({ room: n, c: mpoint(n.polygon), a: apx(n.polygon) }));
  const cands = [];
  memMeta.forEach(s => {
    dstMeta.forEach(d => {
      if (!pin(s.c.x, s.c.y, d.room.polygon)) return;   /* точка памяти внутри новой */
      if (!pin(d.c.x, d.c.y, s.poly)) return;           /* точка новой внутри полигона памяти (двунаправленно) */
      const ratio = s.a > 0 && d.a > 0 ? Math.min(s.a, d.a) / Math.max(s.a, d.a) : 0;
      if (ratio < AREA_RATIO_MIN) return;               /* тот же порог: набор не липнет к посторонней комнате (Ж4) */
      cands.push({ s, d, ratio });
    });
  });
  /* Тот же детерминированный порядок, что в carry: ближе площади — раньше, тай-брейк геометрический. */
  cands.sort((A, B) => B.ratio - A.ratio || keyCmp(A.s, B.s) || keyCmp(A.d, B.d));
  const usedMem = new Set(), usedDst = new Set();
  cands.forEach(c => {
    if (usedMem.has(c.s.i) || usedDst.has(c.d.room)) return;   /* один-к-одному: набор — не больше одной комнате (Ж4) */
    usedMem.add(c.s.i); usedDst.add(c.d.room);
    const f = c.s.fields;
    transfers.push({ toId: c.d.room.id, fromId: null, name: f.name, area: f.area, lightingScheme: f.lightingScheme,
      standard: f.standard, collection: f.collection, frameMaterial: f.frameMaterial, frameShape: f.frameShape, frameColor: f.frameColor });
  });

  /* Обновлённая память: НЕвыданные прежние записи (usedMem убирает розданные — запись забывается сразу
     после выдачи, иначе набор достался бы и второй раз) + свежезабытые. Предел — FIFO по старейшим. */
  const kept = memory.filter((_, i) => !usedMem.has(i));
  let next = kept.concat(fresh);
  if (next.length > MEMORY_LIMIT) next = next.slice(next.length - MEMORY_LIMIT);
  return { transfers, memory: next };
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { carry, reconcile, isAutoName };
if (typeof window !== "undefined") window.EPRoomCarry = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
