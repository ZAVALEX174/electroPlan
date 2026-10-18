/* Стены комнаты и предупреждение о несовпадении со стеной поста (К4в).

   ЗАЧЕМ. У поста есть СВОЙ тип стены (post.wallType, К4а/К4б): от него зависят коробка и суппорт,
   а значит цена. У комнаты теперь есть ОТМЕТКИ, какие в ней стены (room.wallKinds — «solid» бетон
   и/или «hollow» ГКЛ, можно обе). Когда пост с одной стеной ставят в комнату, где такой стены нет,
   программа предупреждает и даёт КНОПКУ перевести пост на стену комнаты — тогда коробка/суппорт
   пересчитаются (это уже делает К4а по post.wallType, здесь только меняем поле).

   ЧИСТЫЕ ФУНКЦИИ, без state и без DOM (конвенция 2): отметки комнаты нормализует roomWallKinds,
   несоответствие считает mismatch, целевую стену — targetWall, разметку отметок для панели свойств
   рисует wallKindsFieldHtml, а gestureMismatches собирает из «только что поставленных» постов готовые
   группы предупреждений (текст, подпись кнопки, вид сообщения). Оркестровка (показать сообщение через
   EPNotices, перерисовать, сохранить, шаг истории) живёт тонкой обёрткой в app.js — сюда она не лезет.

   ⚠️ КОМНАТА БЕЗ ОТМЕТОК — ПРЕДУПРЕЖДЕНИЯ НЕТ (решение владельца 17.10, п.2). Все старые проекты и
   вновь нарисованные комнаты поля wallKinds не несут: пустой массив/нет поля = «не задано», и пост
   в такую комнату встаёт молча. Предупреждение возможно ТОЛЬКО когда у комнаты есть отметка(и), и
   среди них нет стены поста.

   Интерфейс: window.EPRoomWalls. */
(() => {
"use strict";

/* Два допустимых вида стены и их слово для человека. Та же пара, что у типа стены поста
   (EPPosts.postWallType): «solid» — бетон/кирпич/сплошные, «hollow» — ГКЛ/полые. */
const WALL_WORD = { solid: "бетон", hollow: "ГКЛ" };

/* Нормализация отметок стен: оставляем только валидные виды, без повторов и в порядке появления.
   Мусор/пустое → пустой массив. Правило «что такое валидная стена» держим в ОДНОЙ точке — его же
   через require зовёт перенос полей (EPRoomCarry.normUserFields), чтобы у отметок не было второй
   трактовки (§7.1). */
function normalizeKinds(raw) {
  const out = [];
  (Array.isArray(raw) ? raw : []).forEach(k => {
    if ((k === "solid" || k === "hollow") && out.indexOf(k) < 0) out.push(k);
  });
  return out;
}

/* Отметки стен комнаты как нормализованный массив (пустой = «не задано»). */
function roomWallKinds(room) {
  return normalizeKinds(room && room.wallKinds);
}

/* Несоответствие стены поста и отметок комнаты. postWall — РАЗРЕШЁННАЯ стена поста
   (EPPosts.postWallType(p,"solid"), всегда «solid»/«hollow»). Комната без отметок → несоответствия
   нет (решение владельца 2). Иначе несоответствие, когда среди отметок комнаты стены поста нет. */
function mismatch(postWall, room) {
  const kinds = roomWallKinds(room);
  if (!kinds.length) return false;
  return kinds.indexOf(postWall) < 0;
}

/* Стена, НА КОТОРУЮ кнопка переводит пост при несоответствии: отметка комнаты, которой у поста нет.
   Видов всего два, поэтому при несоответствии у комнаты ровно одна «чужая» отметка — её и берём.
   Несоответствия нет (или комната без отметок) → null. */
function targetWall(postWall, room) {
  if (!mismatch(postWall, room)) return null;   // совпало/нет отметок — переводить не на что
  const kinds = roomWallKinds(room);
  return kinds.find(k => k !== postWall) || null;
}

/* Русское перечисление «a» / «a и b» / «a, b и c» — как в EPNotices (без оксфордской запятой). */
function joinRu(parts) {
  if (parts.length <= 1) return parts[0] || "";
  return parts.slice(0, -1).join(", ") + " и " + parts[parts.length - 1];
}

/* Номера постов группы в виде «№ N», в порядке входа, пустые отброшены. */
function postNumbers(posts) {
  return (posts || []).map(p => p && p.number).filter(n => n != null).map(n => "№ " + n);
}

/* Текст предупреждения (строго по форме, утверждённой владельцем 17.10 — других надписей не вводим):
   «Стены не совпадают: пост № N — ГКЛ, в комнате «Кухня» только бетон». Для нескольких постов —
   «посты № 3, № 5». Стена поста (postWall) у всех постов группы одна (это стена, которой нет у
   комнаты), стена комнаты в тексте — целевая (targetWall). */
function mismatchText(group) {
  const nums = postNumbers(group.posts);
  const postsPart = nums.length > 1 ? "посты " + joinRu(nums) : "пост " + (nums[0] || "");
  const roomName = group.room && group.room.name ? group.room.name : "";
  return "Стены не совпадают: " + postsPart + " — " + WALL_WORD[group.postWall]
    + ", в комнате «" + roomName + "» только " + WALL_WORD[group.targetWall];
}

/* Подпись кнопки: «Перевести пост на бетон» / «Перевести пост на ГКЛ» (для нескольких — «посты»). */
function buttonLabel(group) {
  const verb = group.posts.length > 1 ? "Перевести посты на " : "Перевести пост на ";
  return verb + WALL_WORD[group.targetWall];
}

/* Вид (kind) сообщения EPNotices — УНИКАЛЕН ПО СОСТАВУ ПОСТОВ группы (их id, отсортированы). Так
   сообщения РАЗНЫХ жестов живут независимо (notices.show заменяет только сообщение того же вида, а у
   другого жеста посты другие → другой kind), а повторный жест по ТЕМ ЖЕ постам (их переставили ещё раз)
   честно заменяет устаревшее сообщение о них. По стене ключевать нельзя — два «Разместить» подряд в бетон
   затёрли бы сообщение о первом посте. */
function noticeKind(posts) {
  return "wallMismatch:" + (posts || []).map(p => String(p && p.id)).sort().join(",");
}

/* Группы несоответствий для только что поставленных/подвинутых постов. entries — [{post, postWall,
   room}]: пост, его разрешённая стена и комната назначения. Группируем ПО КОМНАТЕ (комната задаёт и
   целевую стену, и имя в тексте — одно сообщение на комнату со списком номеров, решение владельца 5/7).
   Посты без несоответствия (комната без отметок или стена совпала) в группы не попадают. kind — по
   составу постов группы, postIds — для повторной проверки в момент клика/отмены. */
function gestureMismatches(entries) {
  const groups = new Map();
  (Array.isArray(entries) ? entries : []).forEach(e => {
    if (!e || !e.post) return;
    if (!mismatch(e.postWall, e.room)) return;
    const tw = targetWall(e.postWall, e.room);
    if (!tw) return;
    const key = e.room && e.room.id != null ? String(e.room.id) : "";
    let g = groups.get(key);
    if (!g) { g = { targetWall: tw, postWall: e.postWall, room: e.room, posts: [] }; groups.set(key, g); }
    g.posts.push(e.post);
  });
  return [...groups.values()].map(g => ({
    kind: noticeKind(g.posts), targetWall: g.targetWall, postWall: g.postWall,
    room: g.room, posts: g.posts, postIds: g.posts.map(p => p.id),
    text: mismatchText(g), label: buttonLabel(g)
  }));
}

/* Перевод постов на стену wall по кнопке (К4в). Пишем ТОЛЬКО переданным постам (решение владельца 5:
   без вопроса «только этот/все однотипные» — меняем ровно посты этого жеста). Возвращает число
   фактически изменённых — для тестов и отладки. Коробку/суппорт/цену пересчитает postComposition по
   новому post.wallType (К4а); второй копии «чей тип стены» здесь не заводим. */
function applyWall(posts, wall) {
  let n = 0;
  (Array.isArray(posts) ? posts : []).forEach(p => { if (p && p.wallType !== wall) { p.wallType = wall; n++; } });
  return n;
}

/* ОРКЕСТРАТОР предупреждения о несовпадении стены (К4в) — фабрика, как canvasInput/postCopyUi/notices:
   app.js зовёт EPRoomWalls.attach(ctx) ОДИН раз и получает warnWallMismatch, который дальше отдаёт в ctx
   трёх жестов (addPending/finishDrag/pastePosts). Всё состояние/DOM приходят через ctx — сам модуль о них
   не знает: state, notices (EPNotices-инстанс), EPPosts, renderAll, renderSummary, persistProject. Правило
   несоответствия и тексты — выше чистыми функциями (у правки нет краёв, §7.1); здесь только показ
   сообщения EPNotices с кнопкой и перевод РОВНО переданных постов на стену комнаты ОДНИМ шагом истории. */
function attach(ctx) {
  const state = ctx.state, notices = ctx.notices, EPPosts = ctx.EPPosts;
  const renderAll = ctx.renderAll, renderSummary = ctx.renderSummary;
  const renderProperties = ctx.renderProperties, persistProject = ctx.persistProject;
  const roomOf = p => (state.rooms || []).find(r => r.id === p.roomId) || null;
  /* Посты группы (ПО id в ТЕКУЩЕМ state.posts), которые прямо сейчас на плане И всё ещё не совпадают
     стеной с ТЕКУЩЕЙ комнатой, вместе с целевой стеной ИХ комнаты. Пересчёт в момент клика/отмены, а не
     по снимку жеста: пост мог переехать, сменить стену в окне поста, а комната — сменить отметку; снимок
     устарел бы и кнопка поставила бы чужую стену (ГКЛ-комнате — бетон). По id (не по ссылке): Undo кладёт
     JSON-клоны объектов, ссылки снимка на них уже не указывают (как pruneWhen в postCopyUi). */
  function liveMismatched(postIds) {
    const out = [];
    (postIds || []).forEach(id => {
      const p = (state.posts || []).find(x => String(x.id) === String(id));
      if (!p) return;
      const room = roomOf(p), wall = EPPosts.postWallType(p, "solid");
      if (!mismatch(wall, room)) return;
      out.push({ post: p, wall: targetWall(wall, room) });   /* стена ИМЕННО его текущей комнаты */
    });
    return out;
  }
  /* posts — посты, которые жест только что поставил/подвинул (у перетаскивания — лишь те, чья комната
     изменилась). Стрелки, Undo/Redo, загрузка и смена отметок у самой комнаты сюда НЕ приходят (владелец 3). */
  function warnWallMismatch(posts) {
    const entries = (posts || []).map(p => ({ post: p, postWall: EPPosts.postWallType(p, "solid"), room: roomOf(p) }));
    gestureMismatches(entries).forEach(g => {
      /* Сообщение живёт, пока хоть один его пост ВСЁ ЕЩЁ на плане И не совпал стеной со своей комнатой:
         Ctrl+Z (вернул/убрал пост), перенос в подходящую комнату или смена отметки снимают устаревшее
         (notices.prune зовётся из undoPlan; на экране — крестик). */
      const pruneWhen = () => liveMismatched(g.postIds).length === 0;
      notices.show(g.kind, g.text, pruneWhen, { label: g.label, onClick: () => {
        const live = liveMismatched(g.postIds);
        if (!live.length) return;                 /* посты уже совпали/ушли — сообщение закрыто, менять нечего */
        live.forEach(x => applyWall([x.post], x.wall));   /* каждый пост — на стену ЕГО ТЕКУЩЕЙ комнаты */
        renderAll(); renderSummary(); renderProperties(); persistProject();   /* persistProject→captureHistory = один шаг истории; renderProperties — карточка поста показывает новую стену/цену */
      } });
    });
  }
  return { warnWallMismatch };
}

/* Привязка чекбоксов отметок стен в панели свойств (#roomWallSolid/#roomWallHollow) — тоже в модуле
   (владелец: «новый код интерфейса — в свой файл»); в app.js остаётся вставка разметки (wallKindsFieldHtml)
   и один вызов. deps.$ — доступ к узлам по id, deps.persistProject — сохранение. Смена отметок НЕ денежная
   и предупреждения НЕ даёт (владелец 3): пишем r.wallKinds (сняли обе → убираем поле) и только сохраняем. */
function bindRoomFields(r, deps) {
  const solid = deps.$("roomWallSolid"), hollow = deps.$("roomWallHollow");
  if (!solid || !hollow) return;
  const apply = () => {
    const kinds = [];
    if (solid.checked) kinds.push("solid");
    if (hollow.checked) kinds.push("hollow");
    if (kinds.length) r.wallKinds = kinds; else delete r.wallKinds;
    deps.persistProject();
  };
  solid.onchange = apply; hollow.onchange = apply;
}

/* Разметка двух отметок стен комнаты для панели свойств (#properties, ветка комнаты). Рисуется ИЗ
   модуля (решение владельца «новый код интерфейса — в свой модуль»); app.js только вставляет её и зовёт
   bindRoomFields. Подписи отметок дословно те же, что у селектора стены поста (единое слово для бетона/
   ГКЛ), пользовательского ввода в разметке нет — экранировать нечего. */
function wallKindsFieldHtml(room) {
  const kinds = roomWallKinds(room);
  const checked = k => kinds.indexOf(k) >= 0 ? " checked" : "";
  return '<div class="room-walls-field"><span class="room-walls-title">Стены комнаты</span>'
    + '<label class="room-walls-opt"><input type="checkbox" id="roomWallSolid"' + checked("solid") + '> Бетон, кирпич, сплошные стены</label>'
    + '<label class="room-walls-opt"><input type="checkbox" id="roomWallHollow"' + checked("hollow") + '> ГКЛ и полые стены</label></div>';
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports для автотестов. */
const api = { normalizeKinds, roomWallKinds, mismatch, targetWall, gestureMismatches, applyWall,
  mismatchText, buttonLabel, noticeKind, wallKindsFieldHtml, attach, bindRoomFields, WALL_WORD };
if (typeof window !== "undefined") window.EPRoomWalls = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
