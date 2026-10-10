/* Копирование и вставка постов (Ctrl+C/Ctrl+V, Б9) — вынесено из app.js по правилу И2 «новый код
   интерфейса — в модуль своей подсистемы, в app.js — только подключение». Здесь ОРКЕСТРОВКА копии:
   буфер выделенных постов в памяти страницы, сборка копий и их вставка одним шагом истории. Чистые
   правила («что копия», «какие новые номера», «куда встать», «перехватывать ли клавишу», «снять ли имя
   группы») лежат в js/postCopy.js (EPPostCopy) и СЮДА НЕ переезжают — модуль их только зовёт. Перенос
   ДОСЛОВНЫЙ: тела copyPosts/pastePosts не менялись (решение владельца «на экране ничего не меняется»),
   поменялся только источник зависимостей — теперь они приходят через ctx, а не из лексики app.js.

   УСТРОЙСТВО — фабрика (как js/rooms.js, js/canvasInput.js): app.js вызывает EPPostCopyUi.attach(ctx)
   ОДИН раз (ПОСЛЕ EPCanvasInput.attach — оттуда приходит canvasPointer) и получает назад copyPosts,
   pastePosts (их зовёт глобальный document.onkeydown) и copyBufferFilled (им же onkeydown спрашивает
   «буфер не пуст?», не читая приватную переменную модуля).

   ГРАНИЦА. Общее с другими подсистемами ОСТАЛОСЬ в app.js и приходит через ctx: подмена накладки под
   комнату (frameForRoomPlacement — общий с «Разместить», был в app.js и до Б9), отбор комнаты по точке
   (getRoomForPoint), перевод экран→мир (clientToWorld), последняя позиция курсора холста (canvasPointer
   из EPCanvasInput), state/uid/toast и перерисовка (renderAll/renderSummary/renderProperties). Модули
   EP* (EPSelection, EPPostCopy, EPPosts, EPLightingGroups) — window-глобалы (сборщика нет, PLAN 2.2),
   их не прокидываем. Функции объявлены `function имя(` С НАЧАЛА СТРОКИ намеренно — по ним поведенческий
   стенд (tests/helpers/appStand.js) находит и вырезает тело.

   Интерфейс приложению — window.EPPostCopyUi.attach(ctx) → { copyPosts, pastePosts, copyBufferFilled }. */
(() => {
"use strict";

/* Фабрика подсистемы копирования: раскладывает зависимости из ctx, держит буфер в памяти страницы и
   возвращает то, что app.js продолжает звать из document.onkeydown. Вызывается один раз из app.js. */
function attach(ctx){
const {
  canvasPointer,clientToWorld,frameForRoomPlacement,getRoomForPoint,notices,renderAll,renderProperties,renderSummary,state,toast,uid
}=ctx;

/* ---- Копирование и вставка постов (Б9). Владелец: «вставить те же посты в соседний номер — отели».
   Буфер _copyBuffer живёт в памяти СТРАНИЦЫ: в снимок проекта и в историю НЕ входит, в localStorage не
   пишется (F5/перезагрузка его чистит). Правила «что копия», «какие новые номера», «куда встать»,
   «перехватывать ли клавишу» — в чистом EPPostCopy; здесь только оркестровка: снять выделенные посты в
   буфер, собрать копии, подменить накладку под комнату ТЕМ ЖЕ frameForRoomPlacement, что и «Разместить»,
   и обновить экран ОДНИМ шагом истории. Последняя позиция курсора «под мышью» живёт в canvasInput.js
   (он владеет указательными событиями холста) и приходит сюда функцией canvasPointer() из его attach. */
let _copyBuffer=null;
/* Имена групп света, снятые у последней пачки копий правилом EPPostCopy.stripSharedGroupNames (решение
   владельца 10.10, вариант Б). Живёт в памяти страницы, как _copyBuffer: нужно СЛЕДУЮЩЕЙ задаче, чтобы
   показать человеку отдельное сообщение «у копий № … убрано имя группы». В этой задаче его только
   накапливаем — ни одного нового текста человеку. */
let _lastPasteClearedNames=[];
/* «Буфер не пуст?» спрашивается ЗДЕСЬ, а не чтением _copyBuffer из app.js: буфер приватен для модуля,
   им владеет только эта подсистема (И2). Значение то же, что раньше считал onkeydown сам. */
const copyBufferFilled=()=>!!(_copyBuffer&&_copyBuffer.items&&_copyBuffer.items.length);
/* Ctrl+C: снимок выделенных постов в буфер СЕЙЧАС (решение владельца: исходные потом можно удалить —
   вставка всё равно сработает, буфер независим). Копируется и один пост, и группа: postIds отдаёт id
   любого вида выделения. */
function copyPosts(){
  const ids=EPSelection.postIds(state.selected);
  if(!ids.length)return;
  const pick=new Set(ids.map(String));
  _copyBuffer=EPPostCopy.snapshot(state.posts.filter(p=>pick.has(String(p.id))));
}
/* Ctrl+V: собрать копии и вставить. Точка — последняя позиция мыши, ЕСЛИ курсор над планом; иначе без
   точки (сдвиг от исходных). Каждой копии по её ЦЕНТРУ (x+12,y+12) определяем комнату и зовём ТОТ ЖЕ
   frameForRoomPlacement, что «Разместить»: подмена накладки под отделку комнаты или пропуск поста с
   причиной (правило подмены не дублируем). Нет подходящей накладки для части постов — ОСТАЛЬНЫЕ ставим,
   про невставленный говорим номер ИСХОДНОГО поста и причину (решение владельца 10.10, п.3). Вся вставка —
   ОДИН renderAll ⇒ ОДИН шаг истории (Ctrl+Z убирает всё, Ctrl+Y возвращает); после — выделены НОВЫЕ
   посты, смета/карточка/связи групп обновлены. Все заблокированы — проект не меняем, шага истории нет. */
function pastePosts(){
  const buf=_copyBuffer;
  if(!buf||!Array.isArray(buf.items)||!buf.items.length)return;
  const lp=canvasPointer();
  const point=lp&&lp.overCanvas?clientToWorld(lp.clientX,lp.clientY):null;
  /* Посты проекта ДО вставки — их занятые имена групп нужны правилу имени ниже. Снимок берём ДО push:
     копии одной пачки «уже стоящими» не считаются (пара может остаться парой между собой). */
  const existingBefore=state.posts.slice();
  const copies=EPPostCopy.buildCopies(buf,{existingPosts:state.posts,point,genId:()=>uid("post_"),
    nextPostNumber:EPPosts.nextPostNumber,crossKey:EPLightingGroups.crossGroupKey});
  const placed=[],blocked=[],placedRooms=[];
  copies.forEach((copy,i)=>{
    /* Комнату копии определяем ОДИН раз по центру её значка — ею и накладку подбираем, и правило имени
       применяем (второго определения «куда попала копия» не заводим). */
    const room=getRoomForPoint(copy.x+12,copy.y+12);
    const swap=frameForRoomPlacement(copy,room);
    if(swap.blocked){blocked.push({number:buf.items[i].post.number,message:swap.message});return}
    if(swap.frameId!=null)copy.frameId=swap.frameId;
    state.posts.push(copy);
    placed.push(copy);
    placedRooms.push(room);
  });
  const note=blocked.map(b=>`Пост № ${b.number} не вставлен. ${b.message}`).join(" ");
  /* Ни один пост не вставлен — проекта не меняли, шага истории нет: сообщение «ничего не вставлено»
     остаётся до крестика и отмену переживать нечему (pruneWhen не задаём). Это сообщение вида "unplaced" —
     следующая успешная вставка с невставленными его заменит. */
  if(!placed.length){notices.show("unplaced",("Ничего не вставлено. "+note).trim());return}
  /* Имя группы света у копий (решение владельца 10.10, вариант Б): если копия попала туда же, где уже
     стоит пост с тем же именем (та же комната, либо оба вне комнат / комнат нет), — расчёт посчитал бы
     их одним светом с двух мест и переобул выключатель в переключатель. Снимаем имя ТОЛЬКО у реально
     вставленных копий (заблокированные в placed не входят); «одна группа»/«одно место» — правилами
     расчёта (groupKeyOf/crossGroupKey + roomId). Перечень убранного — следующей задаче для сообщения. */
  const stripResult=EPPostCopy.stripSharedGroupNames(
    placed.map((post,i)=>({post,roomKey:placedRooms[i]?placedRooms[i].id:null})),
    existingBefore.map(post=>({post,roomKey:post.roomId!=null?post.roomId:null})),
    {groupKeyOf:EPLightingGroups.groupKeyOf,crossKey:EPLightingGroups.crossGroupKey});
  _lastPasteClearedNames=stripResult.cleared;
  /* Выделяем НОВЫЕ посты ДО renderAll — renderPosts тогда сразу рисует их подсвеченными
     (EPSelection.isSelected). normalize сведёт один к {kind:"post"}, группу — к {kind:"posts"}. */
  state.selected=EPSelection.normalize(placed.map(p=>p.id),state.posts.map(p=>p.id));
  renderAll();renderSummary();renderProperties();
  /* Сообщения этой вставки привязаны к её постам: pruneWhen вернёт true, когда ни одной вставленной копии
     на плане не осталось (Ctrl+Z убрал вставку одним шагом). app.js зовёт notices.prune() после undoPlan. */
  const placedIds=placed.map(p=>String(p.id));
  const pruneWhen=()=>!placedIds.some(id=>state.posts.some(p=>String(p.id)===id));
  /* Сообщение Б (имя группы снято) — отдельным сообщением вида "groupName", если у копий убрано имя. */
  if(stripResult.cleared.length)notices.show("groupName",EPNotices.buildGroupNameText(stripResult.cleared),pruneWhen);
  /* Сообщение А: есть невставленные — ТОЛЬКО сообщение с крестиком (отдельного гаснущего «Вставлено
     постов: N.» нет, оно было бы повтором). Невставленных нет — обычный гаснущий toast, как раньше. */
  if(note)notices.show("unplaced",(`Вставлено постов: ${placed.length}. `+note).trim(),pruneWhen);
  else toast(`Вставлено постов: ${placed.length}.`);
}

return {copyPosts,pastePosts,copyBufferFilled};
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports для автотестов. */
const api = { attach };
if (typeof window !== "undefined") window.EPPostCopyUi = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
