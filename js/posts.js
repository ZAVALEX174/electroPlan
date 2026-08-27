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

/* Модель числа монтажных коробок по стандарту накладки. Базовое правило заказчика
   (ответ 01.08): «На каждую накладку почти всегда 1 коробка, но на каждую коробку
   много накладок» — то есть ОДНА НАКЛАДКА = ОДНА КОРОБКА по её ёмкости. «Почти всегда» —
   про единственное известное исключение: НЕМЕЦКО-ФРАНЦУЗСКИЙ (71 мм) и ФРАНЦУЗСКИЙ
   (57 мм) стандарт, где накладка физически садится на НЕСКОЛЬКО коробок (по круглой
   коробке на пост = 2 модуля). Отсюда: assembly → одна коробка на накладку (итальянский
   IT/IT_ROUND и универсальный BOTH); post → по числу постов (DE/FR). Универсальный
   стандарт (BOTH) раньше не имел модели и считался по числу механизмов — это завышало
   смету на 281 накладке каталога; теперь у него есть настоящее правило (одна коробка).
   Для нераспознанного стандарта модель в таблице отсутствует, но boxCount по умолчанию
   тоже даёт одну коробку (одна ближе к правде, чем счёт по механизмам). */
const BOX_MODEL = { IT: "assembly", IT_ROUND: "assembly", DE: "post", FR: "post", BOTH: "assembly" };

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
   post — по числу постов (явный postCount накладки, иначе по 2 модуля на пост);
   всё остальное (assembly — IT/IT_ROUND/BOTH — и нераспознанный стандарт) — ОДНА
   коробка на накладку по правилу заказчика (ответ 01.08): «На каждую накладку почти
   всегда 1 коробка, но на каждую коробку много накладок». Прежней ветки «по числу
   механизмов» больше нет: для нераспознанного стандарта одна коробка ближе к правде,
   чем счёт по механизмам (он завышал смету), а исключение «несколько коробок» покрыто
   веткой post выше. */
function boxCount(post, frame, standard, deps) {
  const mechIds = post.mechanismIds || [];
  if (!mechIds.length) return 0;
  if (BOX_MODEL[standard] === "post") {
    const declared = Number(frame && frame.postCount);
    if (Number.isInteger(declared) && declared >= 1) return declared;
    return Math.max(1, Math.ceil(modulesTotal(mechIds, deps) / 2));
  }
  return 1;
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
     (точную или фолбэк).
     Отдельный случай — изделия, которые монтируются В КОРОБКУ БЕЗ СУППОРТА (крышки IP55,
     «Принцип обработки» = NO_SUPPORT): подбор им не нужен вовсе. Отличаем это от «суппорт
     не подобрался» явным флагом supportNotRequired — «не требуется» и «не нашли» для сметы
     и листа монтажника разные вещи, и раньше обе выглядели одинаково пустым местом.
     deps.supportRequired — необязательная зависимость (старые вызовы и тесты без неё
     считают, что суппорт нужен всегда, как было).
     deps.resolveSupport (EPPostFit.resolveSupport) отдаёт не только планку, но и признак
     «артикул наш, заказчиком не подтверждён» — им документы помечают догадку. Старый набор
     deps с одним findSupport работает как раньше, просто без признака. */
  const needsSupport = deps.supportRequired ? deps.supportRequired(frame) !== false : true;
  const supportArgs = { frame, standard, modules, series: frame && frame.series, box: box || boxFallback };
  const found = !needsSupport ? { support: null, assumed: false }
    : deps.resolveSupport ? (deps.resolveSupport(supportArgs) || { support: null, assumed: false })
    : deps.findSupport ? { support: deps.findSupport(supportArgs) || null, assumed: false }
    : { support: null, assumed: false };
  const support = found.support || null;
  return {
    frame, standard, model,
    approximate: !model,      /* модель коробок для стандарта неизвестна */
    modulesTotal: modules,
    boxCount: count,
    boxUnit: model === "post" ? "post" : model === "assembly" ? "assembly" : "place",
    postCount,
    support,
    /* Суппортов ровно столько же, сколько монтажных коробок: планка садится В коробку,
       поэтому «одна коробка — один суппорт». Для немецко-французского стандарта накладка
       физически разбита импостами на несколько постов, и заказчик подтвердил (26.08):
       «с суппортом мы тоже два берём, два по два модуля, как и коробок». Раньше суппорт
       везде считался за 1 шт. — смета занижалась на (N−1) суппортов в каждом DE/FR-посте.
       Считаем от того же count, а не по своей формуле: вторая копия правила «сколько
       постов» рано или поздно разошлась бы с boxCount(). Отсюда же берётся ноль у пустого
       поста (нет механизмов — нет ни коробки, ни планки). Суппорт не подобран → 0, иначе
       в документах появилась бы деталь без артикула, а в цене — множитель ни на что. */
    supportCount: support ? count : 0,
    /* «Суппорт не требуется» (а не «не подобран»): по номенклатуре изделие садится в коробку
       без планки. Пусть представление напишет это словами — пустая строка в листе монтажника
       читается как недоработка подбора. */
    supportNotRequired: !needsSupport,
    /* Суппорт подобран НАМИ, а не назван заказчиком: у накладки монтажное правило в
       номенклатуре есть, но выделенной под него планки в каталоге нет (09671.*, 22673.1.* и 22683.1.* —
       «в коробку и супорт на 3 модуля», без артикула; 09679.* — принцип 2_OFFSET), и планка
       выбрана общим правилом по серии и модульности. Артикул в расчёт ставим — иначе поста
       не собрать, — но КАЖДЫЙ документ обязан пометить его «(предположительно)»: 36 накладок
       из 1631, вопрос заказчику отправлен 26.08. Подтверждённые пары (09661.* → 09602.1/09603.1,
       09672.* → 09606, обычные накладки) флага не несут — иначе пометка обесценится. */
    supportAssumed: !!(support && found.assumed),
    box,
    boxFallback
  };
}

/* Стоимость поста = механизмы + накладка + суппорты + коробки.
   Суппорт умножается на comp.supportCount (столько же, сколько коробок) — раньше он
   входил в цену ровно один раз при любом числе постов, и немецко-французская сборка
   на 2–4 поста занижала смету на (N−1) планок.
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
  return mechSum + price(comp.frame) + price(comp.support) * comp.supportCount + price(boxUnit) * comp.boxCount;
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

/* Полная укладка механизмов по постам без разрыва через импост — перебор с возвратом.
   Механизмы берутся В ПОРЯДКЕ входа, каждый пробуется в ПЕРВЫЙ подходящий пост слева
   направо (first-fit): первое найденное решение совпадает с привычной «первый-подходящий»
   раскладкой, поэтому для уже валидных наборов расстановка по постам не меняется. Идентичные
   по ёмкости И текущей занятости посты повторно не пробуем — эквивалентные ветки перебора
   (симметрия), их пропуск не теряет решений и убирает лишний перебор на пустых немецких
   постах 2+2+2. Возвращает массив постов с механизмами {id,span} либо null, если ВСЕ уложить
   без пересечения импоста нельзя. Задача крохотная (постов ≤ 8, механизмов ≤ 8) — перебор дёшев. */
function packAll(items, capacities) {
  const occ = capacities.map(() => 0);
  const bins = capacities.map(() => []);
  function place(i) {
    if (i >= items.length) return true;
    const it = items[i];
    for (let p = 0; p < capacities.length; p++) {
      if (p > 0 && capacities[p] === capacities[p - 1] && occ[p] === occ[p - 1]) continue;
      if (occ[p] + it.span > capacities[p]) continue;
      occ[p] += it.span; bins[p].push(it);
      if (place(i + 1)) return true;
      occ[p] -= it.span; bins[p].pop();
    }
    return false;
  }
  return place(0) ? bins : null;
}

/* Распределение механизмов по постам накладки. Механизм занимает span подряд идущих модулей
   и НЕ может пересекать импост между постами (через импост его физически не собрать) — он
   обязан целиком лечь ВНУТРИ одного поста. Прежде здесь был «next-fit»: курсор постов шёл
   только вперёд и не возвращался к недозаполненным постам, из-за чего многомодульный механизм
   мог встать верхом на импост и дать ЛОЖНУЮ несовместимость, хотя валидная раскладка набора
   существовала (например 1М·1М·1М·2М·1М в накладку 2+2+2: next-fit ронял последний 1М в
   overflow, хотя 2М целиком помещается в отдельный пост, а одномодульные — попарно вокруг).
   Теперь укладка полная (packAll, перебор с возвратом): если валидное размещение без разрыва
   через импост есть — оно находится, и посты приходят уже упакованными. Механизм шире самого
   широкого поста в накладку не помещается вовсе (too-wide) — отсекаем его сразу, до укладки.
   Если валидной раскладки НЕТ — раскладываем «как влезет» (first-fit) и помечаем не
   поместившиеся overflow с ПРИЧИНОЙ: несовместимость остаётся ошибкой, не молча (требование
   3.2). deps = { product(id), mechanismSpan(item) }. */
function distributePosts(mechanismIds, frame, deps) {
  const product = deps.product || (() => null);
  const span = deps.mechanismSpan || (() => 1);
  const layout = frameLayout(frame);
  const posts = layout.posts.map(p => ({ index: p.index, row: p.row, col: p.col, capacity: p.capacity, mechanismIds: [], occupied: 0 }));
  const maxCap = posts.reduce((m, p) => Math.max(m, p.capacity), 0);
  const overflow = [], errors = [];
  /* Механизмы шире любого поста в накладку не встают в принципе (у них своя причина, отличная
     от «не делится по постам») — снимаем их до укладки, остальные идём упаковывать. */
  const items = [];
  (mechanismIds || []).forEach(id => {
    const item = product(id);
    const s = Number(span(item)) || 1;
    if (s > maxCap) { overflow.push(id); errors.push({ type: "too-wide", id, item, span: s, maxCapacity: maxCap }); return; }
    items.push({ id, item, span: s });
  });
  const packed = packAll(items, posts.map(p => p.capacity));
  if (packed) {
    /* нашлась укладка без разрыва через импост — переносим её в посты как есть */
    packed.forEach((bin, i) => { posts[i].mechanismIds = bin.map(x => x.id); posts[i].occupied = bin.reduce((s, x) => s + x.span, 0); });
  } else {
    /* валидной раскладки нет: раскладываем «как влезет» (first-fit), не поместившиеся → overflow.
       Так превью и метка занятости остаются осмысленными, а причину видит пользователь. */
    items.forEach(it => {
      const p = posts.find(q => q.occupied + it.span <= q.capacity);
      if (p) { p.mechanismIds.push(it.id); p.occupied += it.span; }
      else { overflow.push(it.id); errors.push({ type: "overflow", id: it.id, item: it.item, span: it.span }); }
    });
  }
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
