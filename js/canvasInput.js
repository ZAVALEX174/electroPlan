/* Ввод на холсте — клики и жесты мышью/пальцем по плану — вынесен из app.js по разделу И
   docs/ОСТАТОК-РАБОТ (И1, кусок 4). Здесь ВСЯ механика указательного ввода: перенос объектов
   (trackDrag — единый источник pointer/mouse+touch, makeDraggable — порог «клик или перенос»,
   Esc-отмена, подсветка комнаты-приёмника), расчёт «экранный клик → координаты плана»
   (canvasEventPoint), постановка объекта в точку клика в режиме размещения (placePendingAtEvent),
   диспетчер клика по холсту по инструментам (canvas.onclick), панорама (зажатый пробел/средняя
   кнопка) и зум колесом к позиции курсора. Перенос ДОСЛОВНЫЙ — поведение, тексты и логика не
   менялись (решение владельца «на экране ничего не меняется»).

   УСТРОЙСТВО — фабрика (как js/postBuilder.js, js/rooms.js, js/docs.js): app.js вызывает
   EPCanvasInput.attach(ctx) ОДИН раз, attach сам провязывает обработчики холста (canvas.onclick,
   слушатели окна вида, keyup/blur пробела) и возвращает то, что app.js продолжает звать сам:
   makeDraggable (его зовёт compactIcon при создании иконок и передаёт дальше EPRooms.attach),
   placePendingAtEvent (его передаёт EPRooms.attach — клик по табличке в режиме размещения),
   onSpaceKeydown (его зовёт глобальный keydown-диспетчер app.js на клавише «пробел»).

   ГРАНИЦА. Ввод только ВЫЗЫВАЕТ бизнес-действия — они остались в app.js и приходят сюда через ctx:
   постановка объекта (addPending), точки инструментов (addScalePoint/addWallPoint/addRoomLinePoint),
   выделение/удаление (selectEntity/removeEntity), пересчёт привязки к комнате (updateObjectRoom,
   refreshAfterRoomAssignments), перерисовка (renderAll/renderRooms/renderProperties/renderSummary/
   renderGroupLinks), смена инструмента (setTool/ensureSelectTool), карта областей (buildSpaceComponents/
   getRoomForPoint), вид (applyView/zoomBy), сохранение/статус (scheduleSave/updateStatus/toast) и
   hover-карточка (hideHover — общая с иконками). Глобальный keydown-диспетчер модалок и горячих
   клавиш тоже остался в app.js: пробел он отдаёт сюда одним вызовом onSpaceKeydown().

   ТРИ ГРАБЛИ КУСКА 4 (см. задание):
   1) ПОРЯДОК. EPRooms.attach берёт из ctx makeDraggable и placePendingAtEvent, поэтому app.js
      обязан звать EPCanvasInput.attach ДО EPRooms.attach — иначе эти const в TDZ на загрузке.
   2) let spaceDown. Переменная режима «рука» и ВСЕ её читатели (makeDraggable, слушатели панорамы)
      и писатели (keyup/blur) держатся в ОДНОМ этом файле — let нельзя делить через ctx (значение
      бы копировалось). Единственный внешний писатель — ветка «пробел» глобального keydown в app.js;
      она пишет spaceDown не напрямую, а через возвращённый onSpaceKeydown() (явная точка входа).
   3) renderRooms. makeDraggable зовёт renderRooms (finishDrag), а тот — const из EPRooms.attach,
      которая идёт ПОЗЖЕ (грабля 1). Поэтому app.js передаёт его сюда ленивой стрелкой
      (renderRooms:()=>renderRooms()) — на момент attach ссылка ещё не вычисляется, а к первому
      переносу const уже инициализирован. makeDraggable остаётся дословным.

   Модули EP* (EPDrag/EPConfig/EPViewport) и EP_DATA — window-глобалы (сборщика нет, PLAN 2.2): их
   не прокидываем. `document`/`window` — тоже глобалы, берём напрямую. Функции внутри attach объявлены
   `function имя(` С НАЧАЛА СТРОКИ намеренно — по ним поведенческий стенд (tests/helpers/appStand.js,
   SOURCE_FILES включает этот файл) находит и вырезает тело; порядок сохранён из app.js, а функции,
   которые стенд режет (makeDraggable/canvasEventPoint/placePendingAtEvent), стоят подряд — за каждой
   идёт следующая `function`, а не оператор, иначе вырезка захватила бы лишнее.

   Интерфейс приложению — window.EPCanvasInput.attach(ctx) → { makeDraggable, placePendingAtEvent, onSpaceKeydown }. */
(() => {
"use strict";

/* Фабрика ввода на холсте: раскладывает зависимости из ctx, поднимает механику переноса/клика/
   панорамы/зума, провязывает обработчики холста и возвращает то, что app.js продолжает звать по
   имени. Вызывается один раз из app.js — ДО EPRooms.attach (см. граблю 1). */
function attach(ctx){
const {
  $,addPending,addRoomLinePoint,addScalePoint,addWallPoint,applySelectionClasses,applyView,beginGesture,
  buildSpaceComponents,canvas,canvasScroll,clientToWorld,endGesture,ensureSelectTool,getRoomForPoint,hideHover,markCanvasUsed,
  tightestRoomAtPoint,refreshAfterRoomAssignments,removeEntity,renderAll,renderGroupLinks,renderProperties,
  renderRooms,renderSummary,scheduleSave,selectEntity,setTool,state,toast,uid,updateObjectRoom,
  updateStatus,view,zoomBy
}=ctx;

/* PointerEvent есть у всех браузеров нижней границы проекта (Chrome 80/FF 72/Safari 13.4).
   Флаг нужен только для Safari ДО 13 (PLAN 5): там указательных событий нет, и перенос
   объекта идёт через mouse+touch. Различия сглаживает trackDrag — makeDraggable про
   конкретный ввод не знает. */
const HAS_POINTER=typeof window!=="undefined"&&"PointerEvent" in window;

/* Подсветка помещения под переносимым объектом (PLAN 3: видно, куда попадёт при
   отпускании — привязка всё равно пересчитается, пусть будет видна заранее). map —
   карта областей, снятая на старте жеста: стены при переносе объекта не двигаются,
   поэтому строить её на каждом движении (дорогой флуд-фолл) не нужно. */
let _dropKey="";
/* МНОЖЕСТВО комнат-приёмников. При одиночном переносе в нём одна комната (или пусто), при переносе
   ГРУППЫ (Б5 ч.3) — все комнаты, куда попадут центры членов (их может быть несколько сразу). ОДНА
   точка «что подсвечено» и ОДНА очистка на оба случая (§7.1): раньше хранился один _dropRoomId, и
   группа физически не смогла бы показать несколько приёмников. Сигнатуру набора кэшируем — DOM не
   трогаем, пока множество целей не изменилось (прежняя защита от флуда на каждом движении сохранена). */
function applyDropHighlight(ids){
  const set=new Set(Array.from(ids||[],String));
  const key=[...set].sort().join("|");
  if(_dropKey===key)return;   /* цель не сменилась — DOM не дёргаем */
  _dropKey=key;
  const rsvg=$("roomsSvg");
  if(rsvg)rsvg.querySelectorAll(".room-poly").forEach(pg=>pg.classList.toggle("drop-target",set.has(String(pg.dataset.roomId))));
  canvas.querySelectorAll(".room-label").forEach(el=>el.classList.toggle("drop-target",set.has(String(el.dataset.id))));
}
/* Одиночный перенос: подсветить одну комнату (пусто при roomId==null). */
function setRoomDropHighlight(roomId){applyDropHighlight(roomId==null?[]:[roomId])}
function clearRoomDropHighlight(){applyDropHighlight([])}

/* Единый источник событий переноса. PointerEvent (с захватом указателя — перенос не
   рвётся, если курсор ушёл за край окна) там, где он есть; иначе — mouse+touch на
   document (без capture курсор уходит с узла). Наружу — одинаковые onMove(x,y)/onUp();
   возвращает функцию отписки. onCancel (необязателен) — ОТДЕЛЬНАЯ ветка «браузер забрал жест»
   (pointercancel/touchcancel): без него отмена идёт в onUp (прежнее поведение переноса объекта), с
   ним — завершение и отмена различаются. Нужно рамке (Б5): оборванную рамку применять нельзя. */
function trackDrag(el,pointerId,onMove,onUp,onCancel){
  if(HAS_POINTER){
    try{el.setPointerCapture(pointerId)}catch(_){}
    const move=e=>{if(pointerId!=null&&e.pointerId!==pointerId)return;onMove(e.clientX,e.clientY)};
    const up=e=>{if(pointerId!=null&&e.pointerId!==pointerId)return;cleanup();onUp()};
    const cancel=e=>{if(pointerId!=null&&e.pointerId!==pointerId)return;cleanup();(onCancel||onUp)()};
    function cleanup(){
      el.removeEventListener("pointermove",move);el.removeEventListener("pointerup",up);el.removeEventListener("pointercancel",cancel);
      try{el.releasePointerCapture(pointerId)}catch(_){}
    }
    el.addEventListener("pointermove",move);el.addEventListener("pointerup",up);el.addEventListener("pointercancel",cancel);
    return cleanup;
  }
  /* запасной путь (Safari <13): touchmove гасим, иначе страница прокрутится вместо переноса */
  const move=e=>{const t=e.touches?e.touches[0]:e;if(!t)return;if(e.cancelable&&e.touches)e.preventDefault();onMove(t.clientX,t.clientY)};
  const up=()=>{cleanup();onUp()};
  const cancel=()=>{cleanup();(onCancel||onUp)()};
  function cleanup(){
    document.removeEventListener("mousemove",move);document.removeEventListener("mouseup",up);
    document.removeEventListener("touchmove",move);document.removeEventListener("touchend",up);document.removeEventListener("touchcancel",cancel);
  }
  document.addEventListener("mousemove",move);document.addEventListener("mouseup",up);
  document.addEventListener("touchmove",move,{passive:false});document.addEventListener("touchend",up);document.addEventListener("touchcancel",cancel);
  return cleanup;
}

/* Перенос объекта плана. Клик и перенос разведены порогом (EPConfig.dragThreshold):
   пока указатель в пределах порога — это клик (выделение уже применено на нажатии),
   дальше — перенос. Сцена на нажатии НЕ перерисовывается (корневой дефект); полная
   перерисовка — только на завершении, когда состав/привязка реально изменились. */
function makeDraggable(el,obj,kind){
  el.dataset.kind=kind;el.dataset.id=obj.id;
  let mode="idle",sx=0,sy=0,bx=0,by=0,stop=null,dragMap=null,switched=false,group=null;
  function beginPress(clientX,clientY,pointerId,additive){
    /* В11 (решение владельца 03.10): в режиме размещения НИ ОДИН объект на холсте не перехватывает
       нажатие — ни табличка комнаты, ни иконка поста/элемента. Иначе нажатие выделило бы объект и
       начало его перенос, а при инструменте «Удалить» — удалило бы его (потеря данных), и пост в
       точку клика бы не встал. Выходим до выделения/переноса/удаления для ЛЮБОГО kind; дальше click
       поставит пост единым правилом placePendingAtEvent — иконка пропускает его к canvas.onclick,
       табличка комнаты зовёт placePendingAtEvent сама (rooms.js). Объект под курсором остаётся
       нетронутым. Раньше ранний return был только для kind==="room" — отсюда дефект на иконках. */
    if(state.pending)return;
    if(state.tool==="delete"){removeEntity(kind,obj.id);return}   /* в режиме удаления нажатие удаляет */
    if(spaceDown)return;   /* зажат пробел — жест забирает панорама холста, объект не трогаем */
    /* Ctrl(⌘)+клик по ПОСТУ — групповое выделение (Б5, ч.1): переключаем пост в наборе и ВЫХОДИМ,
       перенос не начинаем (решение владельца). Только для постов — устройства/комнаты в группу не
       входят, для них Ctrl игнорируем (падаем в обычный путь). Переключение/карточку/счётчик делает
       EPSelection.toggle + renderProperties, подсветку членов — applySelectionClasses. */
    if(additive&&kind==="post"){
      switched=ensureSelectTool();
      state.selected=EPSelection.toggle(state.selected,obj.id,state.posts.map(p=>p.id));
      applySelectionClasses();renderProperties();
      if(switched)renderRooms();   /* сменили инструмент кликом — привести таблички комнат в порядок */
      return;
    }
    switched=ensureSelectTool();
    group=null;
    /* Нажатие (без Ctrl) на член ВЫДЕЛЕННОЙ ГРУППЫ (Б5 ч.3): группу НЕ сворачиваем на нажатии. Потянут
       за порог — поедет ВСЯ группа (onMove); отпустят без переноса — свернётся до этого поста (onUp,
       решение владельца). Группу читаем ЛЕНИВО: только когда выделение — набор постов
       (state.selected.kind==="posts"), иначе ветка состава не трогает state.posts (тесты одиночного
       переноса собирают ctx без state.posts). */
    const grpMember=kind==="post"&&state.selected&&state.selected.kind==="posts"
      &&state.selected.ids.some(x=>String(x)===String(obj.id));
    if(grpMember){
      /* Снимок членов с их узлами и БАЗОВЫМИ координатами на момент нажатия: дельту переноса прибавляем
         к базе КАЖДОГО, поэтому все едут на одну мировую дельту, а взаимное расположение сохраняется.
         Узел ведущего — это el, остальные ищем по глобально уникальному data-id. Выделение не трогаем. */
      const idset=new Set(state.selected.ids.map(String));
      group=state.posts.filter(p=>idset.has(String(p.id)))
        .map(p=>({obj:p,el:String(p.id)===String(obj.id)?el:canvas.querySelector('.plan-icon[data-id="'+p.id+'"]'),bx:p.x,by:p.y}));
    }else{
      state.selected={kind,id:obj.id};
      applySelectionClasses();renderProperties();   /* выделяем точечно, без renderAll */
    }
    mode="pending";sx=clientX;sy=clientY;bx=obj.x;by=obj.y;dragMap=null;
    document.addEventListener("keydown",onKey,true);   /* Esc отменяет перенос (capture — раньше глобального) */
    stop=trackDrag(el,pointerId,onMove,onUp);
  }
  function onMove(clientX,clientY){
    if(mode==="idle")return;
    if(mode==="pending"){
      if(!EPDrag.beyondThreshold(clientX-sx,clientY-sy,EPConfig.dragThreshold))return;   /* ещё клик */
      mode="dragging";el.classList.add("dragging");hideHover();
      beginGesture();   /* Б4 п.3: пошёл перенос — промежуточные положения в историю не пишем, шаг зафиксирует finishDrag */
      /* карту областей для подсветки помещения снимаем один раз на старте переноса */
      dragMap=(kind!=="room"&&state.rooms.some(r=>!(r.polygon&&r.polygon.length>2)))?buildSpaceComponents():null;
    }
    const p=EPDrag.worldPosition({x:bx,y:by},{x:sx,y:sy},{x:clientX,y:clientY},state.scale,state.worldAngle);
    if(group){
      /* Группа (Б5 ч.3): та же мировая дельта (p − база ведущего) — ВСЕМ членам от их баз. Подсветка —
         НАБОР комнат-приёмников (у членов они могут различаться). Связи групп света — один раз за кадр. */
      const ddx=p.x-bx,ddy=p.y-by,drop=new Set();
      group.forEach(m=>{
        m.obj.x=m.bx+ddx;m.obj.y=m.by+ddy;
        if(m.el){m.el.style.left=m.obj.x+"px";m.el.style.top=m.obj.y+"px"}
        const r=getRoomForPoint(m.obj.x+12,m.obj.y+12,dragMap);if(r)drop.add(r.id);
      });
      applyDropHighlight(drop);renderGroupLinks();
      return;
    }
    obj.x=p.x;obj.y=p.y;el.style.left=obj.x+"px";el.style.top=obj.y+"px";
    if(kind!=="room"){const room=getRoomForPoint(obj.x+12,obj.y+12,dragMap);setRoomDropHighlight(room?room.id:null)}
    /* Связи групп ведём за постом ЖИВЬЁМ: пунктир не должен отставать от иконки при переносе.
       Перерисовывается только #linksSvg (иконки/комнаты не трогаем — перенос не ломаем). */
    if(kind==="post")renderGroupLinks();
  }
  function onUp(){
    const dragged=mode==="dragging",wasSwitched=switched,wasGroup=!!group;
    endInteraction();
    if(dragged)finishDrag();
    else if(wasGroup){
      /* Клик по члену группы БЕЗ переноса → выделен только этот пост (решение владельца): группу не
         свернули на нажатии, сворачиваем здесь — когда ясно, что это клик, а не начало переноса. */
      state.selected={kind,id:obj.id};applySelectionClasses();renderProperties();
      if(wasSwitched)renderRooms();
    }
    else if(wasSwitched)renderRooms();   /* сменили инструмент кликом — привести сцену в порядок */
  }
  function onKey(e){
    if(e.key!=="Escape")return;
    e.preventDefault();e.stopPropagation();   /* не даём глобальному Esc (setTool) перерисовать сцену */
    if(mode==="dragging"){
      if(group){
        /* Esc при переносе ГРУППЫ (Б5 ч.3): ВСЕ члены возвращаются в исходные точки, связи групп
           перерисовываются; шага истории нет — finishDrag не зовём. */
        group.forEach(m=>{m.obj.x=m.bx;m.obj.y=m.by;if(m.el){m.el.style.left=m.bx+"px";m.el.style.top=m.by+"px"}});
        renderGroupLinks();
      }else{obj.x=bx;obj.y=by;el.style.left=bx+"px";el.style.top=by+"px"}
      updateStatus("Перенос отменён");
    }
    endInteraction();
  }
  function endInteraction(){
    if(stop){stop();stop=null}
    document.removeEventListener("keydown",onKey,true);
    el.classList.remove("dragging");clearRoomDropHighlight();
    endGesture();   /* Б4 п.3: жест завершён (отпускание или Esc) — снова разрешаем фиксировать шаг; finishDrag его и зафиксирует */
    mode="idle";dragMap=null;switched=false;
  }
  function finishDrag(){
    if(kind==="room"){
      obj.seedX=obj.x+55;obj.seedY=obj.y+18;
      refreshAfterRoomAssignments(renderRooms);
    }else if(group){
      /* Перенос ГРУППЫ (Б5 ч.3): ОДНА карта на всех — привязку всех членов к комнатам, связи, карточку,
         смету и сохранение пересчитываем ЕДИНОЙ точкой контракта (не цикл updateObjectRoom), поэтому
         каждый пост попадает в комнату, куда переехал его центр, и сумма сметы ей соответствует. Шаг
         истории один: beginGesture глушил промежуточные фиксации, endGesture снят (endInteraction),
         а save-параметр даёт РОВНО один scheduleSave — второго в конце не нужно (ранний return). */
      refreshAfterRoomAssignments(renderRooms, scheduleSave);
      updateStatus("Группа постов перенесена");
      return;
    }else{
      /* финальную привязку считаем свежей картой (updateObjectRoom): объект мог уехать за
         габарит превью-карты; она годится только для подсветки на лету, не для итога */
      const room=updateObjectRoom(obj);
      renderRooms();renderGroupLinks();renderProperties();renderSummary();
      updateStatus(room?`Объект прикреплён к комнате: ${room.name}`:"Объект находится вне назначенных комнат");
    }
    scheduleSave();   /* новая позиция — часть проекта: перенос закончился, сохраняем */
  }
  if(HAS_POINTER){
    el.addEventListener("pointerdown",e=>{
      if(!e.isPrimary||e.button>0)return;   /* основной указатель, левая кнопка/касание (средняя/правая — не сюда) */
      e.preventDefault();e.stopPropagation();
      beginPress(e.clientX,e.clientY,e.pointerId,e.ctrlKey||e.metaKey);
    });
  }else{
    el.addEventListener("mousedown",e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();beginPress(e.clientX,e.clientY,null,e.ctrlKey||e.metaKey)});
    /* касание (без Ctrl): рамка/набор пальцем не делаем (решение владельца) — модификатор всегда false */
    el.addEventListener("touchstart",e=>{const t=e.touches[0];if(!t)return;e.preventDefault();e.stopPropagation();beginPress(t.clientX,t.clientY,null,false)},{passive:false});
  }
  /* долгое нажатие/ПКМ на объекте не должны звать системное контекстное меню (PLAN 2) */
  el.addEventListener("contextmenu",e=>e.preventDefault());
}
/* «Экранный клик → координаты плана» через ЕДИНОЕ правило clientToWorld (учитывает масштаб И угол
   мира, Б3 ч.2а). Раньше формула жила здесь своей копией и ломалась при повороте холста
   (getBoundingClientRect возвращал габарит повёрнутого прямоугольника); теперь обратная матрица —
   одна, в EPViewport.screenToWorld (§7.1). Общая для canvas.onclick и placePendingAtEvent. */
function canvasEventPoint(e){
  return clientToWorld(e.clientX,e.clientY);
}
/* Единое правило «клик в режиме размещения ставит объект в точку клика». Зовут и canvas.onclick
   (клик по пустому месту), и обработчики подписей комнат (клик прямо по табличке): расчёт координат
   и addPending живут в одном месте, второй копии нет. */
function placePendingAtEvent(e){
  if(!state.pending)return;
  const p=canvasEventPoint(e);
  addPending(p.x,p.y);
}
/* Готовность к панораме (курсор-подсказка «рука»): включаем, только пока не панорамируем уже. */
function setPanReady(on){canvasScroll.classList.toggle("pan-ready",on&&!panning)}
/* Завершение панорамы: снять «panning», вернуть подсказку при зажатом пробеле, сохранить вид. */
function endPan(e){
  if(!panning)return;
  panning=false;canvasScroll.classList.remove("panning");
  if(spaceDown)canvasScroll.classList.add("pan-ready");
  try{canvasScroll.releasePointerCapture(e.pointerId)}catch(_){}
  scheduleSave();   /* положение вида — часть проекта */
}
/* Нажатие пробела приходит из глобального keydown-диспетчера app.js (там же !typing&&!inBuilder и
   preventDefault). Здесь — только переход в режим «рука»: писатель spaceDown живёт в этом файле. */
function onSpaceKeydown(){if(!spaceDown){spaceDown=true;setPanReady(true)}}

/* ---- РАМКА ВЫДЕЛЕНИЯ (Б5, ч.1). Протяжка мышью по ПУСТОМУ месту плана в режиме «Выбор» выделяет
   посты, чьи центры попали в рамку (решение владельца). Рамка рисуется в ЭКРАННЫХ (клиентских)
   координатах position:fixed, а НЕ внутри #canvas: #canvas вращается при worldAngle, и рамка внутри
   него перекосилась бы. Посты внутри считает EPSelection.postsInRect через EPViewport.worldToScreen
   (учитывает масштаб и угол мира) — координаты сводим к окну холста (.canvas-scroll), от которого
   worldToScreen и отсчитывает. Новая рамка ЗАМЕНЯЕТ выделение, пустая — снимает (обе ветки даёт
   EPSelection.normalize). Функции — на нулевой колонке (их вырезает поведенческий стенд). ---- */
let rbStartX=0,rbStartY=0,rbLastX=0,rbLastY=0,rbMoved=false,rbEl=null,rbStop=null,rbSuppressClick=false;
/* Нажатие на пустом месте: порог ещё не пройден — просто запоминаем старт и подписываемся на жест.
   Стартуем ТОЛЬКО в «Выбор», без размещения и без зажатого пробела (панорама), и лишь если цель —
   пустое место (тот же whitelist, что ветка пустого клика: сам .canvas-scroll, #canvas и его SVG-слои).
   Клик по иконке/стене/табличке сюда не доходит (их обработчики гасят всплытие своим stopPropagation). */
function beginRubberBand(e){
  if(!e.isPrimary||e.button!==0)return;
  /* Рамку тянем ТОЛЬКО мышью (решение владельца «рамка пальцем — бэклог»): касание и перо рамку не
     начинают. pointerType у настоящего события всегда задан; отсутствует только в шимах — его трактуем
     как мышь, чтобы не завязывать проверку на шим (запасной touchstart-путь рамку и так не зовёт). */
  if(e.pointerType&&e.pointerType!=="mouse")return;
  if(state.tool!=="select"||state.pending||spaceDown)return;
  const t=e.target;
  if(!(t===canvasScroll||t===canvas||t===$("wallsSvg")||t===$("roomsSvg")))return;
  /* preventDefault на старте рамки: протяжка по пустому месту НЕ должна запускать нативное выделение
     текста холста (переносы строк, подпись/легенда). Иначе выделенный текст при следующем нажатии даёт
     нативный dragstart на #canvas → браузер шлёт pointercancel → рамка срывается (доказанный дефект).
     Цель здесь — заведомо пустое место холста (whitelist выше), а не поле ввода или панель, поэтому
     фокус полей и выделение текста вне холста это не затрагивает. */
  e.preventDefault();
  rbStartX=e.clientX;rbStartY=e.clientY;rbLastX=e.clientX;rbLastY=e.clientY;rbMoved=false;
  rbStop=trackDrag(canvasScroll,e.pointerId,rubberMove,rubberUp,rubberCancel);
}
/* Движение: пока не пройден порог — это ещё клик (простой клик по пустому должен сработать как
   раньше — снять выделение). За порогом рисуем рамку и ведём её за курсором. */
function rubberMove(clientX,clientY){
  rbLastX=clientX;rbLastY=clientY;
  if(!rbMoved){
    if(!EPDrag.beyondThreshold(clientX-rbStartX,clientY-rbStartY,EPConfig.dragThreshold))return;
    rbMoved=true;hideHover();
    rbEl=document.createElement("div");rbEl.className="selection-rect";document.body.appendChild(rbEl);
  }
  const r=EPSelection.rectFromPoints({x:rbStartX,y:rbStartY},{x:clientX,y:clientY});
  rbEl.style.left=r.left+"px";rbEl.style.top=r.top+"px";
  rbEl.style.width=(r.right-r.left)+"px";rbEl.style.height=(r.bottom-r.top)+"px";
}
/* Отпускание: порог не пройден — был простой клик, рамки не было, ничего не трогаем (обычный
   click-обработчик снимет выделение). Пройден — применяем выделение, убираем рамку и ГАСИМ
   последующий click (иначе ветка пустого места сбросит только что собранное выделение). */
function rubberUp(){
  if(rbStop){rbStop();rbStop=null}
  if(!rbMoved)return;
  applyRubberSelection();
  if(rbEl){rbEl.remove();rbEl=null}
  rbMoved=false;
  rbSuppressClick=true;   /* снимается на следующем pointerdown — ровно один click погашен */
}
/* Браузер забрал жест (pointercancel/touchcancel): рамку НЕ применяем — прежнее выделение остаётся,
   прямоугольник убираем. Клик гасить не нужно: применения не было, rbSuppressClick не взводим, значит
   одноразовое гашение не залипнет. Денежная ловушка (касание→сдвиг→pointercancel применял частичный
   отбор и подменял выделение) закрыта ТЕМ, что отмена идёт сюда, а не в rubberUp. */
function rubberCancel(){
  if(rbStop){rbStop();rbStop=null}
  if(rbEl){rbEl.remove();rbEl=null}
  rbMoved=false;
}
/* Собственно отбор: рамку (клиентские координаты) и центры постов сводим к системе окна холста
   (worldToScreen отсчитывает от его левого-верхнего угла — как clientToWorld). normalize заменяет
   выделение целиком: ≥2 → группа, 1 → один пост, 0 → снято. */
function applyRubberSelection(){
  const cr=canvasScroll.getBoundingClientRect();
  const r=EPSelection.rectFromPoints({x:rbStartX-cr.left,y:rbStartY-cr.top},{x:rbLastX-cr.left,y:rbLastY-cr.top});
  const v=view();
  const ids=EPSelection.postsInRect(state.posts,r,pt=>EPViewport.worldToScreen(pt,v));
  state.selected=EPSelection.normalize(ids,state.posts.map(p=>p.id));
  applySelectionClasses();renderProperties();
}
/* Гашение «синтетического» клика в фазе перехвата: после панорамы (panMoved/spaceDown) или только что
   протянутой рамки (rbSuppressClick). Иначе этот клик дойдёт до canvas.onclick и либо поставит объект
   там, где просто отпустили кнопку, либо сбросит собранное рамкой выделение. panMoved гасим тут же;
   rbSuppressClick снимает следующий pointerdown — ровно один клик гасится. Именованной функцией (не
   инлайном) — чтобы поведенческий стенд мог её вырезать и проверить. */
function suppressSyntheticClick(e){
  if(panMoved||spaceDown||rbSuppressClick){panMoved=false;e.stopPropagation();e.preventDefault()}
}
/* Новый жест на окне холста (любой pointerdown): одноразовое гашение клика от ПРЕДЫДУЩЕЙ рамки уже
   отработало на её click — снимаем флаг, чтобы гасился РОВНО один клик. Именованной функцией (не
   инлайном в обработчике), чтобы поведенческий стенд мог её вырезать и проверить сброс. */
function clearRubberClickSuppress(){rbSuppressClick=false}

/* ---- РЕГИСТРАЦИЯ обработчиков ввода на холсте (выполняется один раз при attach, на самом низу
   загрузки app.js — как provязка кнопок в postBuilder/docs; событий во время загрузки нет). ---- */
/* Клик слушаем на ОКНЕ холста (.canvas-scroll), а не на #canvas (Б3, ч.2а, решение владельца 03.10
   «клик работает по всему окну холста»). Коробка #canvas при повороте/отдалении не накрывает окно
   целиком — при 90° полосы по краям это серый фон .canvas-scroll, и клик там (пост, стена, разметка,
   масштаб, комната) не доходил до #canvas. Окно же неподвижно и всегда накрывает всю рабочую область.
   Координаты по-прежнему через единое clientToWorld (оно и так считает от .canvas-scroll). Клики по
   иконкам/табличкам/стенам гасят всплытие своим stopPropagation и сюда не доходят (выделение/перенос
   не ломаются); панель инструментов и кнопки зума — вне .canvas-scroll в DOM, их клик пост не ставит. */
canvasScroll.onclick=e=>{
  const {x,y}=canvasEventPoint(e);
  if(state.pending)placePendingAtEvent(e);
  else if(state.tool==="scale"){addScalePoint(x,y);return}
  else if(state.tool==="wall")addWallPoint(e);
  else if(state.tool==="roomline"){addRoomLinePoint(e);return}
  else if(state.tool==="vertex"){
    /* в режиме правки клик по контуру выбирает комнату, показывая её вершины. ТЕСНЕЙШАЯ накрывающая
       (EPGeom.tightestRoomAtPoint) — то же правило, что привязка объектов (§7.1): клик по чулану
       внутри зала выбирает чулан, а не зал вокруг, как подсказывает подсветка (В20 п.2) */
    const room=tightestRoomAtPoint(x,y,state.rooms);
    if(room)selectEntity("room",room.id);
    else{state.selected=null;renderAll();renderProperties()}
    setTool("vertex");
  }
  else if(state.tool==="room"){
    markCanvasUsed();
    const room={id:uid("room_"),x:x-55,y:y-18,seedX:x,seedY:y,name:"Новая комната",area:""};
    state.rooms.push(room);state.selected={kind:"room",id:room.id};
    setTool("select");renderAll();renderProperties();renderSummary();
    toast("Комната создана. Оборудование внутри привязано автоматически");
  }
  else if(e.target===canvasScroll||e.target===canvas||e.target===$("wallsSvg")||e.target===$("roomsSvg")){
    /* пустое место — это и сам #canvas, и его SVG-слои, И серый фон окна .canvas-scroll вне коробки
       #canvas (при повороте/отдалении): клик там тоже снимает/меняет выделение комнаты.
       выбор/удаление комнаты кликом — ТЕСНЕЙШАЯ накрывающая (та же функция, что привязка, §7.1):
       «Удалить» внутри чулана берёт чулан, а не осиротит зал вокруг него (В20 п.2, потеря данных) */
    const room=tightestRoomAtPoint(x,y,state.rooms);
    if(room&&state.tool==="delete"){removeEntity("room",room.id)}
    else if(room){selectEntity("room",room.id)}
    else{state.selected=null;renderAll();renderProperties()}
  }
};

/* ---- Панорамирование: зажатый ПРОБЕЛ + перетаскивание ИЛИ средняя кнопка мыши.
   Слушаем на окне вида в фазе ПЕРЕХВАТА — панорама должна перебивать инструменты и
   объекты под курсором (иначе пробел+клик по иконке начал бы тащить иконку). pan —
   в пикселях экрана 1:1 с мышью: двигаем сам вид, масштаб тут не делим. ---- */
let spaceDown=false,panning=false,panLX=0,panLY=0,panMoved=false;
canvasScroll.addEventListener("pointerdown",e=>{
  clearRubberClickSuppress();   /* новый жест: гашение клика от ПРЕДЫДУЩЕЙ рамки уже отработало, снимаем флаг */
  if(!((spaceDown&&e.button===0)||e.button===1))return;   /* пробел+ЛКМ или средняя кнопка */
  e.preventDefault();e.stopPropagation();
  panning=true;panMoved=false;panLX=e.clientX;panLY=e.clientY;
  canvasScroll.classList.remove("pan-ready");canvasScroll.classList.add("panning");
  try{canvasScroll.setPointerCapture(e.pointerId)}catch(_){}
},true);
canvasScroll.addEventListener("pointermove",e=>{
  if(!panning)return;
  const dx=e.clientX-panLX,dy=e.clientY-panLY;
  if(dx||dy)panMoved=true;
  panLX=e.clientX;panLY=e.clientY;
  state.panX+=dx;state.panY+=dy;applyView();
},true);
canvasScroll.addEventListener("pointerup",endPan,true);
canvasScroll.addEventListener("pointercancel",endPan,true);
/* Рамку выделения слушаем в фазе ВСПЛЫТИЯ (панорама выше — в перехвате со stopPropagation; задвоения
   нет: при пробеле/средней кнопке её pointerdown гасит всплытие, сюда событие не доходит). beginRubberBand
   сам проверяет инструмент/пустое место. */
canvasScroll.addEventListener("pointerdown",beginRubberBand);
/* панорама сдвинула вид (или зажат пробел), ЛИБО только что протянули рамку — гасим последующий клик
   по холсту в фазе перехвата (до canvas.onclick), иначе он поставил бы точку/объект там, где
   пользователь просто отпустил кнопку, либо СБРОСИЛ бы собранное рамкой выделение (ветка пустого
   места). rbSuppressClick не снимаем здесь — его снимает следующий pointerdown (ровно один клик). */
canvasScroll.addEventListener("click",suppressSyntheticClick,true);
/* средняя кнопка на части ОС включает автоскролл — глушим */
canvasScroll.addEventListener("auxclick",e=>{if(e.button===1)e.preventDefault()});
/* Нативное перетаскивание (dragstart) на холсте не нужно нигде: перенос объектов и рамка идут на
   указательных событиях. Глушим его — даже если под курсором осталось выделение текста или картинка,
   браузер не запустит drag (именно он слал pointercancel и срывал рамку). Слушатель только на окне
   холста: выделение текста и перетаскивание в панелях вне холста не затрагиваются. */
canvasScroll.addEventListener("dragstart",e=>e.preventDefault());

/* ---- Зум КОЛЕСОМ К ПОЗИЦИИ КУРСОРА. passive:false — нужен preventDefault, иначе
   прокрутится страница. Множитель экспоненциальный — плавно и симметрично вверх/вниз. */
canvasScroll.addEventListener("wheel",e=>{
  e.preventDefault();
  const r=canvasScroll.getBoundingClientRect();
  zoomBy(Math.exp(-e.deltaY*0.0015),{x:e.clientX-r.left,y:e.clientY-r.top});
},{passive:false});

/* отпускание пробела и потеря фокуса окна снимают режим «рука» (иначе он «залипнет») */
document.addEventListener("keyup",e=>{if(e.code==="Space"){spaceDown=false;canvasScroll.classList.remove("pan-ready")}});
window.addEventListener("blur",()=>{spaceDown=false;canvasScroll.classList.remove("pan-ready")});

return {makeDraggable,placePendingAtEvent,onSpaceKeydown};
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports для автотестов. */
const api = { attach };
if (typeof window !== "undefined") window.EPCanvasInput = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
