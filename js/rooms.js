/* Отрисовка комнат на плане и ручная правка их контуров — вынесено из app.js по разделу И
   docs/ОСТАТОК-РАБОТ (И1, кусок 2). Здесь: таблички комнат (.room-label) и контуры (.room-poly) на
   холсте, точечное обновление текста таблички без пересоздания слоя, инструмент «Правка комнат»
   (перетаскивание/добавление/удаление вершин полигона) и миграция якоря подписи контурных комнат
   при открытии старого проекта. Перенос ДОСЛОВНЫЙ — поведение не менялось (решение владельца
   «на экране ничего не меняется»).

   УСТРОЙСТВО — фабрика (как js/postBuilder.js, не namespace-набор функций): app.js вызывает
   EPRooms.attach(ctx) ОДИН раз и получает назад те функции, которые всё ещё зовёт сам: renderRooms
   (из init/renderAll и десятка обработчиков через refreshAfterRoomAssignments), relabelContourRooms
   (из restoreProject — миграция открываемого проекта), updateRoomLabelText (из flushRoomDraft —
   точечный коммит имени/площади). Правка вершин (svgTitle/markRoomEdited/refreshRoomAfterEdit/
   renderVertexHandles/dragVertex) наружу не выходит — её зовёт только renderRooms изнутри модуля.

   ГРАНИЦА. Общее с другими подсистемами ОСТАЛОСЬ в app.js и приходит сюда через ctx: привязка постов
   к комнатам (refreshAfterRoomAssignments, getObjectsInRoom, placePendingAtEvent, selectEntity,
   removeEntity, makeDraggable — makeDraggable общий для постов и комнат), площадь/подпись
   (roomAreaM2/roomDisplayArea/formatArea — их роднит с renderProperties общий roomAutoAreaText),
   геометрия точек контура (roomLabelPoint/roomNamePoint из EPGeom — их же зовут detectRooms/
   buildRoomsFromLines), общий SVG-namespace SVG_NS (его делят renderGroupLinks/renderScaleRuler/
   разметка линий), сохранение и статус (persistProject/updateStatus/toast).

   Модули EP* и EP_DATA — window-глобалы (сборщика нет, PLAN 2.2), их не прокидываем. `document` —
   тоже глобал (как в postBuilder.js), берём напрямую. Функции внутри attach объявлены `function имя(`
   С НАЧАЛА СТРОКИ намеренно — по ним поведенческий стенд (tests/helpers/appStand.js, SOURCE_FILES
   включает этот файл) находит и вырезает тело; порядок сохранён из app.js.

   Интерфейс приложению — window.EPRooms.attach(ctx) → { renderRooms, relabelContourRooms, updateRoomLabelText }. */
(() => {
"use strict";

/* Фабрика слоя комнат: раскладывает зависимости из ctx, поднимает отрисовку табличек/контуров и
   правку вершин, возвращает то, что app.js продолжает звать по имени. Вызывается один раз из app.js. */
function attach(ctx){
const {
  $,SVG_NS,beginGesture,canvas,clientToWorld,endGesture,esc,formatArea,getObjectsInRoom,makeDraggable,persistProject,placePendingAtEvent,
  refreshAfterRoomAssignments,removeEntity,roomAreaM2,roomDisplayArea,roomLabelPoint,roomNamePoint,
  selectEntity,state,toast,updateStatus
}=ctx;

function renderRooms(){
  canvas.querySelectorAll(".room-label").forEach(e=>e.remove());
  const svg=$("roomsSvg");if(svg)svg.innerHTML="";
  /* Ч.4 блока: уже существующие наложения (старые проекты) считаем ОДИН раз на всю сцену — отсюда и
     красные строки под именами, и закраска областей ниже (одно место правила, §7.1). */
  const report=computeOverlaps();
  state.rooms.forEach(r=>{
    const isPoly=r.polygon&&r.polygon.length>2;
    const sel=state.selected?.kind==="room"&&state.selected.id===r.id;
    if(svg&&isPoly){
      const editing=state.tool==="vertex"&&sel;
      const pg=document.createElementNS("http://www.w3.org/2000/svg","polygon");
      pg.setAttribute("points",r.polygon.map(p=>p.x+","+p.y).join(" "));
      pg.setAttribute("class","room-poly"+(editing?" editing":sel?" selected":""));
      pg.dataset.roomId=r.id;
      svg.appendChild(pg);
      if(editing)renderVertexHandles(svg,r);
    }
    const count=getObjectsInRoom(r.id).length;
    const areaText=roomDisplayArea(r);
    const noteText=overlapNoteText(report.notes[r.id]);   /* «пересекается с «…»» / «внутри «…»» или "" */
    const el=document.createElement("div");
    el.className="room-label "+(sel?"selected":"");
    el.style.left=r.x+"px";el.style.top=r.y+"px";
    el.dataset.kind="room";el.dataset.id=r.id;   /* для точечного выделения и подсветки drop-цели */
    el.innerHTML=`<span class="room-title">${esc(r.name)}</span>${areaText?`<small>${esc(areaText)}</small>`:""}<span class="room-object-count">${count} объект.</span>${noteText?`<span class="room-overlap-note">${esc(noteText)}</span>`:""}`;
    /* полигональную комнату подпись не двигает (контур отдельно) — только выделяет/удаляет
       кликом; подпись комнаты без контура тащится и выделяется единым обработчиком makeDraggable */
    if(isPoly)el.onclick=e=>{
      e.stopPropagation();   /* клик по подписи не всплывает к canvas.onclick — иначе пост поставился бы дважды */
      if(state.pending){placePendingAtEvent(e);return}   /* режим размещения: пост встаёт в точку клика по табличке — тем же правилом, что клик по пустому месту */
      state.tool==="delete"?removeEntity("room",r.id):selectEntity("room",r.id);
    };
    else{el.onclick=e=>{e.stopPropagation();if(state.pending)placePendingAtEvent(e)};makeDraggable(el,r,"room")}   /* клик не доходит до canvas.onclick; в размещении — пост в точку клика тем же правилом */
    canvas.appendChild(el);
  });
  /* Закраска областей наложения — ПОВЕРХ контуров комнат (добавляем последними), штриховкой. Если
     наложений нет — ни одного лишнего узла в SVG. pointer-events:none, иначе закраска перехватит клики
     по комнатам. При исправлении контура (ч.2) или удалении комнаты renderRooms зовётся заново — узлы
     пересчитываются, подсветка гаснет сразу. */
  if(svg&&report.regions.length){
    svg.appendChild(overlapHatchDefs());
    report.regions.forEach(poly=>{
      const pg=document.createElementNS(SVG_NS,"polygon");
      pg.setAttribute("points",poly.map(p=>p.x+","+p.y).join(" "));
      pg.setAttribute("class","room-overlap");
      pg.setAttribute("fill","url(#roomOverlapHatch)");
      svg.appendChild(pg);
    });
  }
}
/* Ч.4 блока: расчёт наложений и текст красной строки — одно место для renderRooms и updateRoomLabelText,
   чтобы подпись не разъехалась. Вся геометрия в EPRoomOverlap (§7.1); здесь лишь перевод комнат в
   нейтральную форму (контур / точка бесконтурной таблички) и сборка строки. EPRoomOverlap/EPConfig —
   window-глобалы (сборщика нет, PLAN 2.2): нет модуля → пустой отчёт, показ ведёт себя как прежде. */
function overlapOpts(){return {tol:(typeof EPConfig!=="undefined"?EPConfig.roomWeldTol:undefined)}}
function computeOverlaps(){
  if(typeof EPRoomOverlap==="undefined")return {regions:[],notes:{}};
  const rooms=state.rooms.map(r=>{
    const isPoly=r.polygon&&r.polygon.length>2;
    /* точка бесконтурной таблички: seed привязки постов, а при его отсутствии — та же точка, что
       даёт перетаскивание таблички (x+55,y+18, см. app.js) */
    const point=isPoly?null:{x:r.seedX!=null?r.seedX:r.x+55,y:r.seedY!=null?r.seedY:r.y+18};
    return {id:r.id,name:r.name,polygon:isPoly?r.polygon:null,point};
  });
  return EPRoomOverlap.overlaps(rooms,overlapOpts());
}
/* Имена соседей в одну строку: до двух, остальное «и ещё N» (не растягиваем табличку). */
function joinRoomNames(names){
  const MAX=2,shown=names.slice(0,MAX).map(nm=>`«${nm}»`);
  if(names.length>MAX)shown.push(`и ещё ${names.length-MAX}`);
  return shown.join(", ");
}
/* Текст красной строки для комнаты (plain, экранируется на вставке): бесконтурная внутри контурной —
   «внутри «…»»; перекрытие по площади — «пересекается с «…»»; иначе пусто. */
function overlapNoteText(n){
  if(!n)return "";
  if(n.inside&&n.inside.length)return "внутри "+joinRoomNames(n.inside);
  if(n.overlaps&&n.overlaps.length)return "пересекается с "+joinRoomNames(n.overlaps);
  return "";
}
/* Штриховка области наложения — <defs> с диагональным паттерном (красные полосы на бледном фоне),
   id фиксированный: на холсте всегда один такой defs (роль innerHTML очищает SVG перед отрисовкой). */
function overlapHatchDefs(){
  const defs=document.createElementNS(SVG_NS,"defs");
  const pat=document.createElementNS(SVG_NS,"pattern");
  pat.setAttribute("id","roomOverlapHatch");
  pat.setAttribute("patternUnits","userSpaceOnUse");
  pat.setAttribute("width","8");pat.setAttribute("height","8");
  pat.setAttribute("patternTransform","rotate(45)");
  const bg=document.createElementNS(SVG_NS,"rect");
  bg.setAttribute("width","8");bg.setAttribute("height","8");bg.setAttribute("fill","rgba(191,63,78,.15)");
  const ln=document.createElementNS(SVG_NS,"line");
  ln.setAttribute("x1","0");ln.setAttribute("y1","0");ln.setAttribute("x2","0");ln.setAttribute("y2","8");
  ln.setAttribute("stroke","#bf3f4e");ln.setAttribute("stroke-width","3");
  pat.appendChild(bg);pat.appendChild(ln);defs.appendChild(pat);
  return defs;
}
/* Точечно обновить ТЕКСТ подписи комнаты на плане — без пересоздания слоя .room-label.
   ЗАЧЕМ НЕ renderRooms(): flushRoomDraft зовётся в начале renderProperties, а та — из beginPress
   в самом начале жеста перетаскивания (инвариант «сцена на нажатии не перерисовывается», см.
   makeDraggable). renderRooms первой строкой сносит все .room-label, включая узел, на котором жест
   только начинается: setPointerCapture ушёл бы в отсоединённый узел, перенос бы не сработал, а
   повешенный на document обработчик Esc не снялся бы (onUp не пришёл) и глушил бы Esc во всём
   приложении. Поэтому правим один узел на месте — тем же приёмом, что applySelectionClasses.
   Меняются лишь name/area, поэтому обновляем название и подпись площади; счётчик объектов не трогаем. */
function updateRoomLabelText(room){
  const rid=String(room.id);
  /* Ч.4: красную строку наложения правим в ОБОИХ местах (здесь и в renderRooms), иначе смена имени
     через flushRoomDraft оставит на табличке старую строку — расчёт берём из того же EPRoomOverlap. */
  const noteText=overlapNoteText(computeOverlaps().notes[room.id]);
  canvas.querySelectorAll(".room-label").forEach(el=>{
    if(String(el.dataset.id)!==rid)return;
    const title=el.querySelector(".room-title");
    if(title)title.textContent=room.name;   /* textContent сам экранирует — эквивалент esc() в renderRooms */
    const areaText=roomDisplayArea(room);
    let small=el.querySelector("small");
    if(areaText){
      if(!small){small=document.createElement("small");el.insertBefore(small,el.querySelector(".room-object-count"))}
      small.textContent=areaText;
    }else if(small)small.remove();   /* ручную площадь стёрли и авторасчёта нет → подпись убираем */
    let note=el.querySelector(".room-overlap-note");
    if(noteText){
      if(!note){note=document.createElement("span");note.className="room-overlap-note";el.appendChild(note)}
      note.textContent=noteText;   /* textContent экранирует — как esc() в renderRooms */
    }else if(note)note.remove();
  });
}

/* ---- Ручная правка полигонов комнат (инструмент «Правка комнат») ---- */
/* Ч.2 блока «комнаты не налезают друг на друга»: защита РУЧНОЙ правки контура от заезда в соседнюю
   комнату. Снимок соседей (контурных комнат, кроме правимой) и наложения с ними берём на НАЧАЛО
   действия: запрещаем только РОСТ наложения, уменьшение/неизменность разрешаем (у открытого проекта
   комнаты могут быть уже налезшими — правка не должна блокироваться намертво, решение владельца 30.10).
   Вся геометрия — в EPRoomOverlap (одно место правила, §7.1); здесь лишь сбор соседей и имя для тоста.
   EPRoomOverlap/EPConfig — window-глобалы (сборщика нет, PLAN 2.2), берём через typeof-страховку: нет
   модуля или соседей → null, и правка ведёт себя как прежде (без зажима). */
function overlapGuardFor(room){
  const neighbors=state.rooms.filter(r=>r!==room&&r.id!==room.id&&r.polygon&&r.polygon.length>2);
  if(!neighbors.length||typeof EPRoomOverlap==="undefined")return null;
  const polys=neighbors.map(r=>r.polygon);
  const opts={tol:(typeof EPConfig!=="undefined"?EPConfig.roomWeldTol:undefined)};
  const base=EPRoomOverlap.overlapEach(room.polygon,polys,opts);   /* снимок наложения на начало действия */
  return {neighbors,polys,opts,base};
}
function svgTitle(node,text){const t=document.createElementNS(SVG_NS,"title");t.textContent=text;node.appendChild(t)}
/* правка делает комнату «ручной»: она переживает повторное авто-определение */
function markRoomEdited(room){room.autoPolygon=false;room.edited=true}
function refreshRoomAfterEdit(room){
  /* В10: якорь ЭКРАННОЙ таблички — roomLabelPoint (у выпуклых = прежний центроид), а seed (точка
     привязки постов/поиска комнаты) — roomNamePoint, точка ВНУТРИ контура: у Г/П-комнаты якорь
     сдвинут на −(10,2) и сам может лежать за стеной, seed'ом он быть не должен (В10 И5). */
  const c=roomLabelPoint(room.polygon),nm=roomNamePoint(room.polygon);
  room.seedX=nm.x;room.seedY=nm.y;room.x=c.x-45;room.y=c.y-16;
  refreshAfterRoomAssignments(renderRooms, persistProject);
}
/* В10: миграция открываемого проекта. Старые проекты хранят якорь подписи контурной комнаты как
   среднее вершин; у Г/П-образных оно лежит ВНЕ контура, и табличка (с кликом «поставить сюда пост»)
   попадала в соседнюю комнату. Пересчитываем якорь контурных комнат через roomLabelPoint — точку
   внутри контура. У выпуклых (прямоугольники) точка равна прежнему центроиду, поэтому обычные
   таблички не двигаются. Комнаты без контура (инструмент «T») пропускаем — их подпись пользователь
   ставит и тащит руками, полигона у них нет. */
function relabelContourRooms(rooms){
  (rooms||[]).forEach(r=>{
    if(r.polygon&&r.polygon.length>2){
      const c=roomLabelPoint(r.polygon),nm=roomNamePoint(r.polygon);
      r.seedX=nm.x;r.seedY=nm.y;r.x=c.x-45;r.y=c.y-16;
    }
  });
}
function renderVertexHandles(svg,room){
  const poly=room.polygon;
  /* середины рёбер — клик добавляет вершину */
  poly.forEach((p,i)=>{
    const next=poly[(i+1)%poly.length];
    const mid=document.createElementNS(SVG_NS,"circle");
    mid.setAttribute("cx",(p.x+next.x)/2);mid.setAttribute("cy",(p.y+next.y)/2);mid.setAttribute("r",4);
    mid.setAttribute("class","vertex-mid");
    svgTitle(mid,"Добавить вершину");
    mid.onpointerdown=e=>{
      if(state.pending)return;   /* В11: в размещении вершину не добавляем — click всплывёт к canvas.onclick и поставит пост */
      e.preventDefault();e.stopPropagation();
      poly.splice(i+1,0,{x:(p.x+next.x)/2,y:(p.y+next.y)/2});
      markRoomEdited(room);refreshRoomAfterEdit(room);
      updateStatus(`Вершина добавлена · всего ${poly.length}`);
    };
    svg.appendChild(mid);
  });
  /* вершины — перетаскивание, Alt+клик удаляет */
  poly.forEach((p,i)=>{
    const h=document.createElementNS(SVG_NS,"circle");
    h.setAttribute("cx",p.x);h.setAttribute("cy",p.y);h.setAttribute("r",6);
    h.setAttribute("class","vertex-handle");
    svgTitle(h,"Перетащите вершину · Alt+клик удаляет");
    h.onpointerdown=e=>{
      if(state.pending)return;   /* В11: в размещении вершину не двигаем/не удаляем — click поставит пост через canvas.onclick */
      e.preventDefault();e.stopPropagation();
      if(e.altKey){
        if(poly.length<=3){toast("В полигоне должно остаться не менее трёх вершин");return}
        /* ч.2: если контур без этой вершины заедет в соседнюю комнату (наложение вырастет) —
           удаление не выполняем (его нельзя сделать без наложения), короткий тост с именем соседа */
        const g=overlapGuardFor(room);
        if(g){
          const bad=EPRoomOverlap.overlapGrew(poly.filter((_,k)=>k!==i),g.polys,g.base,g.opts);
          if(bad>=0){toast(`Нельзя удалить: контур заедет в «${g.neighbors[bad].name}»`);return}
        }
        poly.splice(i,1);markRoomEdited(room);refreshRoomAfterEdit(room);
        updateStatus(`Вершина удалена · осталось ${poly.length}`);
        return;
      }
      dragVertex(room,i,e);
    };
    svg.appendChild(h);
  });
}
function dragVertex(room,index,startEvent){
  const svg=$("roomsSvg");
  const pg=svg.querySelector(`polygon[data-room-id="${room.id}"]`);
  const handle=svg.querySelectorAll(".vertex-handle")[index];
  const point=room.polygon[index];
  const guard=overlapGuardFor(room);   /* ч.2: снимок соседей/наложения на начало жеста — для зажима */
  const move=e=>{
    /* Поле бесконечное: по краям блока не зажимаем. Координаты — через единое clientToWorld (учитывает
       масштаб И угол мира, Б3 ч.2а): при повороте холста вершина садится под курсор, а не мимо.
       Ч.2: если желаемая точка заводит контур в соседнюю комнату — вершина упирается в её границу
       (ближайшая допустимая позиция от уже принятой точки, бисекцией), наложение не растёт. */
    const w=clientToWorld(e.clientX,e.clientY);
    const pos=guard?EPRoomOverlap.clampVertexMove(room.polygon,index,w,guard.polys,guard.base,guard.opts):w;
    point.x=pos.x;
    point.y=pos.y;
    if(pg)pg.setAttribute("points",room.polygon.map(p=>p.x+","+p.y).join(" "));
    if(handle){handle.setAttribute("cx",point.x);handle.setAttribute("cy",point.y)}
  };
  const up=()=>{
    document.removeEventListener("pointermove",move);document.removeEventListener("pointerup",up);
    endGesture();   /* Б4 п.3: вершину отпустили — снова разрешаем шаг; refreshRoomAfterEdit его и зафиксирует */
    markRoomEdited(room);refreshRoomAfterEdit(room);
    const m2=roomAreaM2(room);
    updateStatus(m2?`Контур изменён · площадь ${formatArea(m2)}`:"Контур комнаты изменён");
  };
  beginGesture();   /* Б4 п.3: пошло перетаскивание вершины — промежуточные положения в историю не пишем */
  document.addEventListener("pointermove",move);document.addEventListener("pointerup",up);
  move(startEvent);
}

return {renderRooms,relabelContourRooms,updateRoomLabelText};
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports для автотестов. */
const api = { attach };
if (typeof window !== "undefined") window.EPRooms = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
