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
  const support = deps.findSupport
    ? deps.findSupport({ frame, standard, modules, series: frame && frame.series }) || null
    : null;
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

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { postCost, postComposition, boxCount, fitMechanismIds, fitMechanismIdsPreserving };
if (typeof window !== "undefined") window.EPPosts = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
