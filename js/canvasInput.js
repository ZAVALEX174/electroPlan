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
  $,addPending,addRoomLinePoint,addScalePoint,addWallPoint,applySelectionClasses,applyView,
  buildSpaceComponents,canvas,canvasScroll,clientToWorld,ensureSelectTool,getRoomForPoint,hideHover,markCanvasUsed,
  tightestRoomAtPoint,refreshAfterRoomAssignments,removeEntity,renderAll,renderGroupLinks,renderProperties,
  renderRooms,renderSummary,scheduleSave,selectEntity,setTool,state,toast,uid,updateObjectRoom,
  updateStatus,zoomBy
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
let _dropRoomId=null;
function setRoomDropHighlight(roomId){
  if(_dropRoomId===roomId)return;   /* не дёргаем DOM, пока цель не сменилась */
  _dropRoomId=roomId;
  const rsvg=$("roomsSvg");
  if(rsvg)rsvg.querySelectorAll(".room-poly").forEach(pg=>pg.classList.toggle("drop-target",pg.dataset.roomId===String(roomId)));
  canvas.querySelectorAll(".room-label").forEach(el=>el.classList.toggle("drop-target",el.dataset.id===String(roomId)));
}
function clearRoomDropHighlight(){setRoomDropHighlight(null)}

/* Единый источник событий переноса. PointerEvent (с захватом указателя — перенос не
   рвётся, если курсор ушёл за край окна) там, где он есть; иначе — mouse+touch на
   document (без capture курсор уходит с узла). Наружу — одинаковые onMove(x,y)/onUp();
   возвращает функцию отписки. */
function trackDrag(el,pointerId,onMove,onUp){
  if(HAS_POINTER){
    try{el.setPointerCapture(pointerId)}catch(_){}
    const move=e=>{if(pointerId!=null&&e.pointerId!==pointerId)return;onMove(e.clientX,e.clientY)};
    const up=e=>{if(pointerId!=null&&e.pointerId!==pointerId)return;cleanup();onUp()};
    function cleanup(){
      el.removeEventListener("pointermove",move);el.removeEventListener("pointerup",up);el.removeEventListener("pointercancel",up);
      try{el.releasePointerCapture(pointerId)}catch(_){}
    }
    el.addEventListener("pointermove",move);el.addEventListener("pointerup",up);el.addEventListener("pointercancel",up);
    return cleanup;
  }
  /* запасной путь (Safari <13): touchmove гасим, иначе страница прокрутится вместо переноса */
  const move=e=>{const t=e.touches?e.touches[0]:e;if(!t)return;if(e.cancelable&&e.touches)e.preventDefault();onMove(t.clientX,t.clientY)};
  const up=()=>{cleanup();onUp()};
  function cleanup(){
    document.removeEventListener("mousemove",move);document.removeEventListener("mouseup",up);
    document.removeEventListener("touchmove",move);document.removeEventListener("touchend",up);document.removeEventListener("touchcancel",up);
  }
  document.addEventListener("mousemove",move);document.addEventListener("mouseup",up);
  document.addEventListener("touchmove",move,{passive:false});document.addEventListener("touchend",up);document.addEventListener("touchcancel",up);
  return cleanup;
}

/* Перенос объекта плана. Клик и перенос разведены порогом (EPConfig.dragThreshold):
   пока указатель в пределах порога — это клик (выделение уже применено на нажатии),
   дальше — перенос. Сцена на нажатии НЕ перерисовывается (корневой дефект); полная
   перерисовка — только на завершении, когда состав/привязка реально изменились. */
function makeDraggable(el,obj,kind){
  el.dataset.kind=kind;el.dataset.id=obj.id;
  let mode="idle",sx=0,sy=0,bx=0,by=0,stop=null,dragMap=null,switched=false;
  function beginPress(clientX,clientY,pointerId){
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
    switched=ensureSelectTool();
    state.selected={kind,id:obj.id};
    applySelectionClasses();renderProperties();   /* выделяем точечно, без renderAll */
    mode="pending";sx=clientX;sy=clientY;bx=obj.x;by=obj.y;dragMap=null;
    document.addEventListener("keydown",onKey,true);   /* Esc отменяет перенос (capture — раньше глобального) */
    stop=trackDrag(el,pointerId,onMove,onUp);
  }
  function onMove(clientX,clientY){
    if(mode==="idle")return;
    if(mode==="pending"){
      if(!EPDrag.beyondThreshold(clientX-sx,clientY-sy,EPConfig.dragThreshold))return;   /* ещё клик */
      mode="dragging";el.classList.add("dragging");hideHover();
      /* карту областей для подсветки помещения снимаем один раз на старте переноса */
      dragMap=(kind!=="room"&&state.rooms.some(r=>!(r.polygon&&r.polygon.length>2)))?buildSpaceComponents():null;
    }
    const p=EPDrag.worldPosition({x:bx,y:by},{x:sx,y:sy},{x:clientX,y:clientY},state.scale,state.worldAngle);
    obj.x=p.x;obj.y=p.y;el.style.left=obj.x+"px";el.style.top=obj.y+"px";
    if(kind!=="room"){const room=getRoomForPoint(obj.x+12,obj.y+12,dragMap);setRoomDropHighlight(room?room.id:null)}
    /* Связи групп ведём за постом ЖИВЬЁМ: пунктир не должен отставать от иконки при переносе.
       Перерисовывается только #linksSvg (иконки/комнаты не трогаем — перенос не ломаем). */
    if(kind==="post")renderGroupLinks();
  }
  function onUp(){
    const dragged=mode==="dragging",wasSwitched=switched;
    endInteraction();
    if(dragged)finishDrag();
    else if(wasSwitched)renderRooms();   /* сменили инструмент кликом — привести сцену в порядок */
  }
  function onKey(e){
    if(e.key!=="Escape")return;
    e.preventDefault();e.stopPropagation();   /* не даём глобальному Esc (setTool) перерисовать сцену */
    if(mode==="dragging"){obj.x=bx;obj.y=by;el.style.left=bx+"px";el.style.top=by+"px";updateStatus("Перенос отменён")}
    endInteraction();
  }
  function endInteraction(){
    if(stop){stop();stop=null}
    document.removeEventListener("keydown",onKey,true);
    el.classList.remove("dragging");clearRoomDropHighlight();
    mode="idle";dragMap=null;switched=false;
  }
  function finishDrag(){
    if(kind==="room"){
      obj.seedX=obj.x+55;obj.seedY=obj.y+18;
      refreshAfterRoomAssignments(renderRooms);
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
      beginPress(e.clientX,e.clientY,e.pointerId);
    });
  }else{
    el.addEventListener("mousedown",e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();beginPress(e.clientX,e.clientY,null)});
    el.addEventListener("touchstart",e=>{const t=e.touches[0];if(!t)return;e.preventDefault();e.stopPropagation();beginPress(t.clientX,t.clientY,null)},{passive:false});
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

/* ---- РЕГИСТРАЦИЯ обработчиков ввода на холсте (выполняется один раз при attach, на самом низу
   загрузки app.js — как provязка кнопок в postBuilder/docs; событий во время загрузки нет). ---- */
canvas.onclick=e=>{
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
  else if(e.target===canvas||e.target===$("wallsSvg")||e.target===$("roomsSvg")){
    /* выбор/удаление комнаты кликом — ТЕСНЕЙШАЯ накрывающая (та же функция, что привязка, §7.1):
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
/* панорама сдвинула вид (или зажат пробел) — гасим последующий клик по холсту в фазе
   перехвата на окне вида (до canvas.onclick), иначе он поставил бы точку/объект там,
   где пользователь просто отпустил кнопку */
canvasScroll.addEventListener("click",e=>{if(panMoved||spaceDown){panMoved=false;e.stopPropagation();e.preventDefault()}},true);
/* средняя кнопка на части ОС включает автоскролл — глушим */
canvasScroll.addEventListener("auxclick",e=>{if(e.button===1)e.preventDefault()});

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
