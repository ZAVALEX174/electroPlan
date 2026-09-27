/* Промис-модалка «применить тип стены только к этому посту или ко всем однотипным» (И1: вынос из
   app.js по разделу И docs/ОСТАТОК-РАБОТ). «Изменить в данном блоке или для всех однотипных блоков» —
   дословная просьба заказчика (24.08) после того, как правка типа стены у одного поста разъехалась
   по всему проекту.

   По конвенции чистых модулей (posts.js/estimate.js) модуль не знает про state и глобальный DOM:
   доступ к узлам ($) и подписи типов стен (WALL_STEP_LABEL) приходят инъекцией в create(). Разметка —
   та же #wallScopeModal (.modal-backdrop > .modal) в index.html; своего компонента не заводим. Отказ
   (крестик, клик мимо, Esc) даёт null.

   Состояние «висящего вопроса» (резолв промиса) живёт ВНУТРИ create — как ...Resolve у choosePdfPage/
   askScaleLength, только теперь в замыкании модуля, а не в глобале app.js. Защита от повторного
   открытия — как у choosePdfPage: висящий вопрос закрываем отказом, иначе его промис остался бы
   неразрешённым навсегда и «Сохранить» молча перестало бы работать.

   Интерфейс приложению — window.EPWallScope.create({$, WALL_STEP_LABEL}) → {askWallScope, finishWallScope}. */
(() => {
"use strict";

/* Поднимает промис-модалку на переданных зависимостях, провязывает кнопки #wallScopeModal и отдаёт
   пару функций-замыканий над резолвом. deps = { $, WALL_STEP_LABEL }. */
function create(deps) {
  const $ = deps.$;
  const WALL_STEP_LABEL = deps.WALL_STEP_LABEL || {};
  let wallScopeResolve = null;

  /* Разрешает висящий вопрос значением scope и закрывает модалку. Нет висящего промиса — no-op:
     крестик/клик-мимо/Esc могут прийти уже после ответа кнопкой. */
  function finishWallScope(scope) {
    if (!wallScopeResolve) return;
    const resolve = wallScopeResolve; wallScopeResolve = null;
    $("wallScopeModal").classList.remove("open"); resolve(scope);
  }

  /* Спрашивает охват правки; резолвится "self" | "sameType" | null (отказ). Висящий вопрос закрываем
     отказом (см. заголовок модуля) — иначе оставили бы неразрешённый промис. */
  function askWallScope(sameTypeCount, wall) {
    if (wallScopeResolve) finishWallScope(null);
    $("wallScopeCopy").textContent = `Тип стены «${WALL_STEP_LABEL[wall] || wall}» — применить только к этому посту `
      + `или ко всем однотипным (${sameTypeCount} шт., считая этот)? Однотипные — посты с той же накладкой `
      + `и тем же набором механизмов; у тех из них, где тип стены уже задавали отдельно, он будет заменён.`;
    $("wallScopeAll").textContent = `Во всех однотипных (${sameTypeCount})`;
    $("wallScopeModal").classList.add("open");
    setTimeout(() => $("wallScopeSelf").focus(), 0);
    return new Promise(resolve => { wallScopeResolve = resolve; });
  }

  /* Провязка кнопок вопроса — в одном модуле с самой модалкой (app.js остаётся оркестратором, но
     конкретную модалку целиком отдаём наружу). "self" — только этот пост, "sameType" — все
     однотипные; крестик и клик по фону — отказ (null). */
  $("wallScopeSelf").onclick = () => finishWallScope("self");
  $("wallScopeAll").onclick = () => finishWallScope("sameType");
  $("closeWallScopeModal").onclick = () => finishWallScope(null);
  $("wallScopeModal").onclick = e => { if (e.target === $("wallScopeModal")) finishWallScope(null); };

  return { askWallScope, finishWallScope };
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports (тесты). */
const api = { create };
if (typeof window !== "undefined") window.EPWallScope = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
