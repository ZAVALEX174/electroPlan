/* Посты — чистая логика сборки электрического поста (PLAN 2.1): состав поста
   (механизмы + суппорт + монтажные коробки + накладка), число коробок по монтажному
   стандарту и стоимость. Доступ к каталогу (product/socketBox/frameProduct/
   mechanismSpan) и подбор суппорта/коробки (findSupport/findBox) передаётся объектом
   deps — модуль не знает про state и DOM. UI-конструктор (openPostBuilder/
   renderBuilder/savePostBuilder) остаётся в app.js: он завязан на $()/state.builder/
   DataService.

   Как estimate.js — без зависимостей приложения, под автотесты (PLAN 7.1).

   Интерфейс приложению — window.EPPosts. */
(() => {
"use strict";

const price = item => Number(item && item.price) || 0;

/* Модель числа монтажных коробок по стандарту накладки. По официальному каталогу
   VIMAR (docs/совместимость-vimar-внешние-источники.md, §1): в ИТАЛЬЯНСКОМ стандарте
   вся сборка садится в ОДНУ прямоугольную коробку на N модулей; в НЕМЕЦКО-ФРАНЦУЗСКОМ
   (71 мм) и ФРАНЦУЗСКОМ (57 мм) на КАЖДЫЙ пост (пост = 2 модуля) идёт СВОЯ круглая
   коробка. Старое правило «коробка на каждый механизм» завышало смету — отсюда фикс.
   assembly → одна коробка; post → по числу постов. Для остальных значений стандарта
   (both/US/unknown) достоверной модели нет: считаем по-старому и помечаем состав
   приблизительным, а не выдаём догадку за факт. */
const BOX_MODEL = { IT: "assembly", IT_ROUND: "assembly", DE: "post", FR: "post" };

/* Стандарт накладки: из поля товара (проставляется при загрузке каталога из колонки
   standard прайса), иначе через deps.standardOf (для тестов), иначе «unknown». */
function frameStandard(frame, deps) {
  const raw = frame && frame.standard != null
    ? frame.standard
    : (deps.standardOf ? deps.standardOf(frame) : null);
  return String(raw || "unknown").toUpperCase();
}

/* Сумма модулей, занимаемых механизмами поста. */
function modulesTotal(mechanismIds, deps) {
  const span = deps.mechanismSpan || (() => 1);
  return (mechanismIds || []).reduce((sum, id) => sum + (Number(span(deps.product(id))) || 0), 0);
}

/* Число монтажных коробок в посте по стандарту накладки.
   assembly — 1 на всю сборку; post — по числу постов (явный postCount накладки,
   иначе по 2 модуля на пост); прочее — прежнее правило (по числу механизмов). */
function boxCount(post, frame, standard, deps) {
  const mechIds = post.mechanismIds || [];
  if (!mechIds.length) return 0;
  const model = BOX_MODEL[standard];
  if (model === "assembly") return 1;
  if (model === "post") {
    const declared = Number(frame && frame.postCount);
    if (Number.isInteger(declared) && declared >= 1) return declared;
    return Math.max(1, Math.ceil(modulesTotal(mechIds, deps) / 2));
  }
  /* both/US/unknown: модель неизвестна — сохраняем прежнее поведение (по числу
     механизмов), чтобы не занизить и честно пометить состав как приблизительный. */
  return mechIds.length;
}

/* Полный состав поста: стандарт, число коробок, подобранные суппорт и коробка.
   Возвращает объекты каталога (product|null) и флаги для интерфейса — рендер и
   money()/esc() остаются в app.js. Подбор суппорта/коробки делает приложение через
   deps.findSupport/findBox (им нужен доступ к state.products); если подходящего нет —
   поле остаётся null, а вызывающий показывает «не подобран», не подставляя случайный. */
function postComposition(post, deps) {
  const frame = deps.frameProduct ? deps.frameProduct(post.frameId) : null;
  const mechIds = post.mechanismIds || [];
  const modules = modulesTotal(mechIds, deps);
  const standard = frameStandard(frame, deps);
  const model = BOX_MODEL[standard] || null;
  const count = boxCount(post, frame, standard, deps);
  const postCount = model === "post" ? count : null;
  const wanted = deps.wallType || "unknown";
  const box = deps.findBox
    ? deps.findBox({ frame, standard, modules, postCount, wallType: wanted }) || null
    : null;
  /* Стандартно-совместимый фолбэк коробки (не противоречит стандарту накладки): нужен
     лишь когда точной коробки под тип стены/типоразмер не нашлось. Приложение гарантирует
     совместимость по стандарту; нет и его — коробка в смету не попадёт (честный пробел). */
  const boxFallback = !box && deps.fallbackBox
    ? deps.fallbackBox({ frame, standard, modules, postCount, wallType: wanted }) || null
    : null;
  /* Суппорт подбираем ПОСЛЕ коробки: по правилу заказчика тип суппорта (602/603) задаёт
     подобранная коробка (см. postfit.findSupport). Передаём фактическую коробку поста
     (точную или фолбэк). */
  const support = deps.findSupport
    ? deps.findSupport({ frame, standard, modules, series: frame && frame.series, box: box || boxFallback }) || null
    : null;
  return {
    frame, standard, model,
    approximate: !model,      /* модель коробок для стандарта неизвестна */
    modulesTotal: modules,
    boxCount: count,
    boxUnit: model === "post" ? "post" : model === "assembly" ? "assembly" : "place",
    postCount,
    support,
    box,
    boxFallback
  };
}

/* Стоимость поста = механизмы + накладка + суппорт (если подобран) + коробки.
   Цена коробки: точная (comp.box) → её цена; иначе стандартно-совместимый фолбэк
   (comp.boxFallback) — приложение гарантирует, что он не противоречит стандарту накладки.
   Нет ни того, ни другого — цена коробки НЕ добавляется: честный пробел в смете лучше
   правдоподобно неверной суммы (требование владельца — фолбэк не должен противоречить
   стандарту). Старый набор deps без fallbackBox сохраняет прежнее поведение через
   socketBox() — регресс-совместимость со старыми проектами и вызовами. */
function postCost(post, deps) {
  const comp = postComposition(post, deps);
  const mechSum = (post.mechanismIds || []).reduce((s, id) => s + price(deps.product(id)), 0);
  let boxUnit = comp.box || comp.boxFallback;
  if (!boxUnit && !deps.fallbackBox && deps.socketBox) boxUnit = deps.socketBox();
  return mechSum + price(comp.frame) + price(comp.support) + price(boxUnit) * comp.boxCount;
}

/* Раскладка механизмов по модулям поста: слева направо, каждый механизм занимает
   span модулей и получает точную позицию. Одномодульный → «2», двухмодульный → «2–3».
   Это та самая нумерация, что конструктор рисует в слотах (renderBuilder/slot-number) —
   вынесена сюда, чтобы лист монтажника и конструктор считали её ОДНИМ кодом (не дублируя).
   Возвращает [{id, item, span, start, end, label}]. Отсутствующий в каталоге механизм
   считаем за 1 модуль (в конструкторе такого не бывает — ids уже отфильтрованы; в листе
   монтажника это честнее нуля, который слил бы соседние позиции в один номер).
   deps = { product(id), mechanismSpan(item) }. */
function moduleLayout(mechanismIds, deps) {
  const product = deps.product || (() => null);
  const span = deps.mechanismSpan || (() => 1);
  let cursor = 1;
  return (mechanismIds || []).map(id => {
    const item = product(id);
    const s = Number(span(item)) || 1;
    const start = cursor, end = start + s - 1;
    cursor = end + 1;
    return { id, item, span: s, start, end, label: start === end ? String(start) : `${start}–${end}` };
  });
}

/* Функциональное слово для наполнения поста («Розетка», «Выключатель») — читаемая
   замена списку артикулов в КП. Берём ПЕРВОЕ значимое слово названия: functionalGroup
   прайса слишком крупная (выключатель, переключатель и инвертор — все «управление светом»),
   а заказчик их различает. Ведущие количественные/уточняющие слова («Две», «Пара»,
   «Механизм…») пропускаем, частые родительные формы приводим к именительному. Эвристика
   по названию — не идеал; при появлении явной колонки типа в номенклатуре её и возьмём
   (поле item.fillWord имеет приоритет — точка расширения без правки логики). */
const FILL_SKIP = new Set(["механизм", "две", "два", "пара", "одна", "один", "широкая", "узкая", "двойная", "тройная"]);
const FILL_NORMALIZE = { "выключателя": "Выключатель", "переключателя": "Переключатель", "инвертора": "Инвертор", "кнопки": "Кнопка", "розетки": "Розетка", "диммера": "Диммер" };
function fillWord(item) {
  if (!item) return "Элемент";
  if (item.fillWord) return String(item.fillWord);
  const words = String(item.name || "").trim().split(/[\s,]+/).filter(Boolean);
  let i = 0;
  while (i < words.length - 1 && FILL_SKIP.has(words[i].toLowerCase())) i++;
  const raw = words[i] || "";
  if (!raw) return "Элемент";
  const norm = FILL_NORMALIZE[raw.toLowerCase()];
  return norm || raw.charAt(0).toUpperCase() + raw.slice(1);
}

/* Наполнение поста словами с количеством: [{word, count}] в порядке первого появления.
   «Розетка — 2, Выключатель — 1» вместо простыни артикулов (форматирование — за
   представлением, здесь только свод). deps = { product(id) }. */
function fillSummary(mechanismIds, deps) {
  const product = deps.product || (() => null);
  const order = [], map = new Map();
  (mechanismIds || []).forEach(id => {
    const word = fillWord(product(id));
    if (!map.has(word)) { map.set(word, { word, count: 0 }); order.push(word); }
    map.get(word).count++;
  });
  return order.map(word => map.get(word));
}

/* Следующий номер поста = максимум существующих + 1. Номер закрепляется за постом
   при создании и НЕ переиспользуется: удаление поста не сдвигает номера остальных
   (иначе ранее распечатанные документы разошлись бы с экраном). Осознанно привести
   нумерацию к 1..N — отдельной командой «перенумеровать» в приложении. */
function nextPostNumber(posts) {
  return (posts || []).reduce((max, p) => Math.max(max, Number(p && p.number) || 0), 0) + 1;
}

/* Проставляет номера постам, у которых их нет (миграция старых проектов — они
   сохранялись без номеров). Существующие номера не трогаем, недостающие выдаём по
   порядку массива, продолжая от максимума, — стабильно между открытиями проекта. */
function ensurePostNumbers(posts) {
  let next = nextPostNumber(posts);
  (posts || []).forEach(p => { if (!(Number(p.number) > 0)) p.number = next++; });
  return posts;
}

/* Отбирает из ids столько механизмов (по порядку), сколько влезает в capacity
   модулей рамки; чужие для items и не влезающие отбрасываются.
   deps = { product(id), mechanismSpan(item) }. */
function fitMechanismIds(ids, items, capacity, deps) {
  const product = deps.product, mechanismSpan = deps.mechanismSpan;
  const allowed = new Set(items.map(item => Number(item.id)));
  const result = [];
  let occupied = 0;
  ids.forEach(id => {
    const numericId = Number(id), item = product(numericId), span = mechanismSpan(item);
    if (!allowed.has(numericId) || !span || occupied + span > capacity) return;
    result.push(numericId);
    occupied += span;
  });
  return result;
}

/* Как fitMechanismIds, но при переполнении выкидывает лишние с конца, сохраняя
   только что выбранный элемент (pinnedIndex) — чтобы правка одного слота не сбивала
   выбор пользователя. deps = { product(id), mechanismSpan(item) }. */
function fitMechanismIdsPreserving(ids, items, capacity, pinnedIndex, deps) {
  const product = deps.product, mechanismSpan = deps.mechanismSpan;
  const total = arr => arr.reduce((sum, id) => sum + mechanismSpan(product(id)), 0);
  const allowed = new Set(items.map(item => Number(item.id)));
  const result = ids.map(Number).filter(id => allowed.has(id));
  let pinned = Math.min(Math.max(0, pinnedIndex), Math.max(0, result.length - 1));
  while (total(result) > capacity && result.length > 1) {
    let removeIndex = result.length - 1;
    if (removeIndex === pinned) removeIndex -= 1;
    if (removeIndex < 0) break;
    result.splice(removeIndex, 1);
    if (removeIndex < pinned) pinned -= 1;
  }
  return result.filter(id => mechanismSpan(product(id)) <= capacity);
}

/* --- Раскладка накладки на посты (немецкий стандарт + многорядные) ------------------
   Накладка немецкого стандарта физически разделена импостами на посты по 2 модуля:
   09664 «(2+2)» — два поста, 09666 «(2+2+2)» — три, 09668 «(2+2+2+2)» — четыре.
   Итальянская — сплошной ряд (один пост на всю ширину, импостов нет). Двухрядные
   итальянские (levels=2, «4+4»/«7+7») — это два отдельных РЯДА-поста, трёхрядные
   («7+7+7») — три. Раскладку считает конвертер каталога и кладёт в frame.layoutRows —
   массив рядов, каждый ряд это массив ёмкостей постов: «2+2» → [[2,2]] (один ряд,
   два поста), «4+4» → [[4],[4]] (два ряда по посту на 4). Здесь только ЧТЕНИЕ готовой
   раскладки; если её нет (тест-фикстуры, старый attrs-файл) — выводим запасную: DE делим
   по 2 модуля в один ряд, остальное — один пост на всю ширину. Модель нарочно общая: и
   «посты в ряд» (2+2), и «ряды» (4+4) описываются одним массивом rows. */
function normalizeRows(raw) {
  if (!Array.isArray(raw) || !raw.length) return null;
  const rows = [];
  for (const row of raw) {
    if (!Array.isArray(row) || !row.length) return null;
    const caps = row.map(Number).filter(n => Number.isInteger(n) && n >= 1);
    if (caps.length !== row.length) return null;   // мусор в раскладке — не доверяем ей
    rows.push(caps);
  }
  return rows;
}
function frameLayout(frame) {
  const std = String((frame && frame.standard) || "unknown").toUpperCase();
  const capacity = Number(frame && (frame.slotCount ?? frame.slots ?? frame.placeCount)) || 0;
  let rows = normalizeRows(frame && frame.layoutRows);
  if (!rows) {
    if ((std === "DE" || std === "FR") && capacity >= 1) {
      /* один ряд постов по 2 модуля (последний — остаток, если ёмкость нечётна) */
      const row = [];
      for (let left = capacity; left > 0; left -= Math.min(2, left)) row.push(Math.min(2, left));
      rows = [row];
    } else {
      rows = [[capacity || 1]];   /* один пост на всю ширину — итальянский сплошной ряд */
    }
  }
  const posts = [];
  rows.forEach((row, r) => row.forEach((cap, c) => posts.push({ index: posts.length, row: r, col: c, capacity: cap })));
  return {
    standard: std, rows, posts,
    capacity: capacity || posts.reduce((s, p) => s + p.capacity, 0),
    postCount: posts.length,
    multiRow: rows.length > 1
  };
}

/* Распределение механизмов по постам накладки. Механизмы идут слева направо, ряд за
   рядом; каждый занимает span подряд идущих модулей и НЕ может пересекать импост между
   постами (через импост его физически не собрать — курсор постов только вперёд, позиции
   модулей последовательны). Механизм шире самого большого поста в такую накладку не
   помещается вовсе. Возвращаем посты с их механизмами, не поместившиеся (overflow) и
   список ошибок с ПРИЧИНОЙ — конструктор показывает их пользователю (требование заказчика
   3.2: несовместимость — ошибкой, не молча). deps = { product(id), mechanismSpan(item) }. */
function distributePosts(mechanismIds, frame, deps) {
  const product = deps.product || (() => null);
  const span = deps.mechanismSpan || (() => 1);
  const layout = frameLayout(frame);
  const posts = layout.posts.map(p => ({ index: p.index, row: p.row, col: p.col, capacity: p.capacity, mechanismIds: [], occupied: 0 }));
  const maxCap = posts.reduce((m, p) => Math.max(m, p.capacity), 0);
  const overflow = [], errors = [];
  let pi = 0;
  (mechanismIds || []).forEach(id => {
    const item = product(id);
    const s = Number(span(item)) || 1;
    if (s > maxCap) {                 /* шире любого поста — в эту накладку не помещается */
      overflow.push(id);
      errors.push({ type: "too-wide", id, item, span: s, maxCapacity: maxCap });
      return;
    }
    /* ближайший пост (вперёд), куда механизм влезает целиком, не пересекая импост */
    while (pi < posts.length && posts[pi].occupied + s > posts[pi].capacity) pi++;
    if (pi >= posts.length) {         /* в оставшихся постах места нет */
      overflow.push(id);
      errors.push({ type: "overflow", id, item, span: s });
      return;
    }
    posts[pi].mechanismIds.push(id);
    posts[pi].occupied += s;
  });
  const totalCapacity = posts.reduce((s, p) => s + p.capacity, 0);
  const totalOccupied = posts.reduce((s, p) => s + p.occupied, 0);
  return {
    layout, posts, overflow, errors,
    valid: overflow.length === 0,                                    /* ничего не «размазано» и не шире поста */
    full: overflow.length === 0 && totalOccupied === totalCapacity,  /* все посты заполнены целиком */
    maxCapacity: maxCap, totalCapacity, totalOccupied
  };
}

/* Наибольшее свободное место среди ВСЕХ постов накладки: max по постам от
   (capacity − occupied). Это максимальная ширина механизма, который ещё можно куда-то
   поставить. distributePosts кладёт механизмы слева направо через посты, поэтому 2М
   влезает во ВТОРОЙ пост даже когда в первом занят один модуль (свободный модуль первого
   поста уходит под заглушку). Раньше конструктор ограничивал список остатком ПЕРВОГО поста
   и прятал 2М-варианты — из-за этого немецкую 2+2 с 1М в первом посте нельзя было достроить.
   Принимает результат distributePosts — единый источник раскладки, числа не пересчитываем. */
function maxFreeSpan(dist) {
  const posts = (dist && dist.posts) || [];
  return posts.reduce((max, p) => Math.max(max, p.capacity - p.occupied), 0);
}

/* Помодульная нумерация ПО ПОСТАМ для листа монтажника: в каждом посте счёт модулей
   начинается заново («пост 1, модули 1–2», «пост 2, модуль 1») — монтажнику важно, что
   посты это отдельные коробки. Строится поверх distributePosts + moduleLayout (тот же код
   позиций, что и в конструкторе, не дублируем). deps = { product, mechanismSpan }. */
function postModuleGroups(mechanismIds, frame, deps) {
  const dist = distributePosts(mechanismIds, frame, deps);
  return dist.posts.map((p, i) => ({
    post: i + 1, row: p.row, capacity: p.capacity, occupied: p.occupied,
    modules: moduleLayout(p.mechanismIds, deps)   /* нумерация внутри поста с 1 */
  }));
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { postCost, postComposition, boxCount, fitMechanismIds, fitMechanismIdsPreserving,
  moduleLayout, fillWord, fillSummary, nextPostNumber, ensurePostNumbers,
  frameLayout, distributePosts, maxFreeSpan, postModuleGroups };
if (typeof window !== "undefined") window.EPPosts = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
