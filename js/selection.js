/* Групповое выделение постов на плане (Б5, часть 1). Заказчик: «Групповое выделение —
   обязательно для отелей и коммерческих объектов». Здесь — ТОЛЬКО чистая логика набора:
   форма выделения, переключение члена, попадание постов в экранную рамку и текст «Выделено: N».
   Ни state, ни DOM, ни EP_DATA — как geometry.js/planRotate.js: на вход числа и простые
   объекты, на выход — то же. Один и тот же предикат isSelected обслуживает и compactIcon, и
   applySelectionClasses (§7.1: раньше это правило было написано дважды и расходилось).

   ФОРМА ВЫДЕЛЕНИЯ (решение оркестратора). state.selected остаётся прежним для одиночных объектов
   ({kind:"post"|"room"|"wall"|"device", id}); группа — НОВЫЙ вид {kind:"posts", ids:[...]}. Группа
   существует ТОЛЬКО при двух и более постах: normalize сводит 1 пост к {kind:"post",id}, 0 — к null.
   Поэтому «группа из одного» в состоянии не возникает, и потребителям не нужно её отдельно разбирать.
   В группу входят ТОЛЬКО посты (решение владельца): комнаты, стены и одиночные элементы Ctrl+клик и
   рамка игнорируют.

   Интерфейс приложению — window.EPSelection. */
(() => {
"use strict";

/* Все id постов, которые держит выделение (пустой массив для room/wall/device/null). Единая точка
   «достать посты из выделения любого вида»: и {kind:"post"} (один), и {kind:"posts"} (набор). */
function postIds(sel) {
  if (!sel) return [];
  if (sel.kind === "posts") return Array.isArray(sel.ids) ? sel.ids.slice() : [];
  if (sel.kind === "post") return [sel.id];
  return [];
}

/* Привести список id постов к канонической ФОРМЕ выделения. validIds (массив/Set живых id постов,
   НЕОБЯЗАТЕЛЕН) отсекает «мёртвые» id — посты, удалённые пересчётом контуров или вручную, пока группа
   была выбрана: иначе карточка и подсветка ссылались бы на несуществующий пост. Дубликаты снимаем,
   ПОРЯДОК добавления сохраняем (на нём держится предсказуемость «Выделено: N» и будущего переноса).
   0 → null, 1 → {kind:"post",id}, ≥2 → {kind:"posts",ids}: группа из одного не создаётся никогда. */
function normalize(ids, validIds) {
  const valid = validIds == null ? null : new Set(Array.from(validIds, String));
  const seen = new Set();
  const out = [];
  for (const id of (ids || [])) {
    if (id == null) continue;
    const k = String(id);
    if (seen.has(k)) continue;              /* дубль — пост уже в наборе */
    if (valid && !valid.has(k)) continue;   /* мёртвый id — поста больше нет */
    seen.add(k);
    out.push(id);
  }
  if (out.length === 0) return null;
  if (out.length === 1) return { kind: "post", id: out[0] };
  return { kind: "posts", ids: out };
}

/* Ctrl(⌘)+клик по посту: переключить его в наборе. Базой берём ТОЛЬКО посты текущего выделения
   (если выбрана была комната/стена/элемент — набор пуст, и клик начинает новый набор с этого поста;
   прежнее одиночное выделение иного вида при этом снимается). Есть в наборе → убрать, нет → добавить.
   Возврат нормализован (может схлопнуться до одного поста или до null). */
function toggle(sel, id, validIds) {
  const ids = postIds(sel);
  const k = String(id);
  const idx = ids.findIndex(x => String(x) === k);
  if (idx >= 0) ids.splice(idx, 1);
  else ids.push(id);
  return normalize(ids, validIds);
}

/* ЕДИНЫЙ предикат «этот объект выделен» для всех потребителей подсветки (compactIcon,
   applySelectionClasses, rooms.js). Пост считается выделенным и когда он сам — одиночное выделение,
   и когда он входит в группу {kind:"posts"}. Прочие виды — прямое сравнение kind+id (строкой: id
   приходит и из dataset, где это строка, и из state, где число). */
function isSelected(sel, kind, id) {
  if (!sel) return false;
  if (kind === "post" && sel.kind === "posts") return sel.ids.some(x => String(x) === String(id));
  return sel.kind === kind && String(sel.id) === String(id);
}

/* Сколько постов держит выделение (0, 1 или N). */
function count(sel) { return postIds(sel).length; }

/* Текст над планом: «Выделено: N» только при N≥2 (решение владельца), иначе пусто — узел скрывается.
   Одиночное выделение надписи не показывает: это не группа. */
function countText(sel) {
  const n = count(sel);
  return n >= 2 ? `Выделено: ${n}` : "";
}

/* Прямоугольник по двум точкам (углам протяжки) — нормализованный {left,top,right,bottom} независимо
   от направления протяжки (вверх-влево даёт тот же прямоугольник, что вниз-вправо). */
function rectFromPoints(p1, p2) {
  return {
    left: Math.min(p1.x, p2.x), top: Math.min(p1.y, p2.y),
    right: Math.max(p1.x, p2.x), bottom: Math.max(p1.y, p2.y)
  };
}

/* Точка внутри прямоугольника, граница ВКЛЮЧИТЕЛЬНО: центр поста ровно на кромке рамки считается
   внутри (решение владельца «пост внутри, если внутри его центр» — кромку трактуем мягко в пользу
   попадания, чтобы «чуть задел» не терял пост). */
function pointInRect(pt, r) {
  return pt.x >= r.left && pt.x <= r.right && pt.y >= r.top && pt.y <= r.bottom;
}

/* Какие посты попали в ЭКРАННУЮ рамку r. Критерий — ЦЕНТР поста (решение владельца). Центр в мире —
   (x+12, y+12): иконка 24px, её якорь в (x,y), а +12 — та же середина, по которой привязка поста к
   комнате (getRoomForPoint(obj.x+12,obj.y+12)). toScreen переводит мировую точку в экранную (у
   вызывающего это EPViewport.worldToScreen с текущим видом — он учитывает масштаб И угол мира,
   поэтому при повёрнутом холсте рамка берёт ровно те посты, что видны внутри неё на экране).
   r и выход toScreen обязаны быть в ОДНОЙ системе координат (вызывающий сводит обе к окну холста). */
function postsInRect(posts, r, toScreen) {
  const out = [];
  for (const p of (posts || [])) {
    if (pointInRect(toScreen({ x: p.x + 12, y: p.y + 12 }), r)) out.push(p.id);
  }
  return out;
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports для автотестов. */
const api = { postIds, normalize, toggle, isSelected, count, countText, rectFromPoints, pointInRect, postsInRect };
if (typeof window !== "undefined") window.EPSelection = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
