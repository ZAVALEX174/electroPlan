/* Посты — чистая логика сборки электрического поста (PLAN 2.1): стоимость поста и
   упаковка механизмов в рамку по вместимости. Доступ к каталогу (product/socketBox/
   frameProduct/mechanismSpan) передаётся объектом deps — модуль не знает про state
   и DOM. UI-конструктор (openPostBuilder/renderBuilder/savePostBuilder) остаётся в
   app.js: он завязан на $()/state.builder/DataService.

   Как estimate.js — без зависимостей приложения, под автотесты (PLAN 7.1).

   Интерфейс приложению — window.EPPosts. */
(() => {
"use strict";

/* Стоимость поста = механизмы + подрозетники (по числу механизмов) + рамка.
   deps = { product(id), socketBox(), frameProduct(id) } — цены из каталога. */
function postCost(p, deps) {
  const product = deps.product, socketBox = deps.socketBox, frameProduct = deps.frameProduct;
  return p.mechanismIds.reduce((s, id) => s + (product(id)?.price || 0), 0)
    + (socketBox()?.price || 0) * p.mechanismIds.length
    + (frameProduct(p.frameId)?.price || 0);
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
const api = { postCost, fitMechanismIds, fitMechanismIdsPreserving };
if (typeof window !== "undefined") window.EPPosts = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
