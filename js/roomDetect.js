/* Распознавание и разметка помещений — вынесено из app.js по разделу И docs/ОСТАТОК-РАБОТ (И1,
   последний кусок). Здесь ВСЯ оркестровка помещений: инструмент «Разметка» (линии #markupSvg —
   магниты/ортогональность resolveRoomLinePoint, постановка/снятие точек, отрисовка цепочки и
   «резинки»-превью), сборка помещений из замкнутых контуров (buildRoomsFromLines) и автораспознавание
   комнат по подложке — OpenCV.js (detectRooms) и нейросетью (detectRoomsML, кнопки скрыты с 21.09), а
   также перенос введённых человеком полей комнаты при пересборке (carryUserRoomFields). Перенос
   ДОСЛОВНЫЙ — поведение, тексты и логика не менялись (решение владельца «на экране ничего не меняется»).

   ЧИСТАЯ ГЕОМЕТРИЯ ЗДЕСЬ НЕ ЖИВЁТ: грани планарного графа (EPRoomsFromLines), сегментация подложки
   (EPRoomSeg/EPFloorplanML), магниты/пересечения/точки контура (EPGeom), сопоставление комнат при
   пересборке (EPRoomCarry), сетка запасного прохода (EPViewport) и пороги (EPConfig) — window-глобалы,
   их не прокидываем. В app.js остаётся общее с другими подсистемами: пересчёт привязки к комнатам
   (refreshAfterRoomAssignments), стены (drawWalls/allWalls/wallRadiusFor), прогресс и предикат живой
   подложки (showTraceProgress/planLostDuringOp), перерисовка (renderAll/renderRooms), геометрия точки
   подписи (roomLabelPoint/roomNamePoint), общий SVG-namespace (SVG_NS), сохранение/статус
   (persistProject/scheduleSave/updateStatus/toast). Всё это приходит объектом ctx.

   УСТРОЙСТВО — фабрика (как js/docs.js, js/rooms.js, js/canvasInput.js): app.js вызывает
   EPRoomDetect.attach(ctx) ОДИН раз, attach сам провязывает обработчик холста (превью разметки —
   canvas pointermove) и кнопки «Определить помещения» / «…нейросетью» / «Определить по линиям» /
   «Очистить разметку», а возвращает то, что app.js и другие модули продолжают звать сами: drawRoomLines
   (renderAll/restoreProject), addRoomLinePoint (его берёт EPCanvasInput.attach — клик инструментом
   «Разметка»), finishRoomLineChain (clearBtn), removeLastRoomLinePoint (keydown Backspace),
   buildRoomsFromLines (его зовёт оставшийся в app.js scheduleRoomsFromLines).

   ТРИ ГРАБЛИ (см. задание И1, последний кусок):
   1) ПОРЯДОК. EPCanvasInput.attach берёт из ctx addRoomLinePoint (клик по холсту инструментом
      «Разметка»), а он теперь const из ЭТОГО attach — поэтому app.js обязан звать EPRoomDetect.attach
      ДО EPCanvasInput.attach, иначе чтение addRoomLinePoint при сборке ctx холста дало бы ReferenceError
      (TDZ) на загрузке.
   2) let _autosaveOn / scheduleRoomsFromLines ОСТАЛИСЬ В app.js. Гейт автосейва _autosaveOn делят
      scheduleSave (пишет/читает в app.js) и scheduleRoomsFromLines (читает) — это var app.js, его нельзя
      делить через ctx (значение бы копировалось). По правилу «держи писателей и читателей одной
      переменной в одном файле» scheduleRoomsFromLines (со своим таймером _roomsTimer) оставлен рядом со
      scheduleSave в app.js; сюда он приходит через ctx, а наши addRoomLinePoint/removeRoomLine/
      removeLastRoomLinePoint зовут его как раньше. Он, в свою очередь, зовёт наш возвращённый
      buildRoomsFromLines — связь двусторонняя, но безопасная: обе стороны читаются лишь в момент
      действия пользователя, когда оба const уже инициализированы.
   3) renderRooms. Наши функции разметки зовут renderRooms (через refreshAfterRoomAssignments), а он —
      const из EPRooms.attach, которая идёт ПОЗЖЕ (грабля 1). Поэтому app.js передаёт его сюда ленивой
      стрелкой (renderRooms:()=>renderRooms()) — на момент attach ссылка ещё не вычисляется, а к первой
      правке разметки const уже готов. Функции остаются дословными.

   Функции внутри attach объявлены `function имя(` (detectRooms/detectRoomsML — `async function`) С НАЧАЛА
   СТРОКИ намеренно — по ним поведенческий стенд (tests/helpers/appStand.js, SOURCE_FILES включает этот
   файл) находит и вырезает тело; порядок сохранён из app.js. `window`/`document` — глобалы, берём напрямую.

   Интерфейс приложению — window.EPRoomDetect.attach(ctx) →
     { addRoomLinePoint, drawRoomLines, finishRoomLineChain, removeLastRoomLinePoint, buildRoomsFromLines }. */
(() => {
"use strict";

/* Фабрика распознавания/разметки помещений: раскладывает зависимости из ctx, поднимает инструмент
   разметки, сборку и автораспознавание, провязывает превью-обработчик и кнопки и возвращает то, что
   app.js/другие модули продолжают звать по имени. Вызывается один раз из app.js — ДО EPCanvasInput.attach
   (см. граблю 1). */
function attach(ctx){
const {
  $,SVG_NS,canvas,markCanvasUsed,persistProject,planLostDuringOp,refreshAfterRoomAssignments,
  renderAll,renderRooms,roomLabelPoint,roomNamePoint,scheduleRoomsFromLines,scheduleSave,
  showTraceProgress,state,toast,uid,updateStatus,wallRadiusFor
}=ctx;

/* Ленивая загрузка OpenCV.js кэширует Promise модуля здесь: писатель и читатель — только loadOpenCv. */
let _cvPromise=null;

/* Тонкая обёртка над EPRoomCarry: пересчёт уничтожает авто-комнаты и заводит новые, а набранные
   человеком поля (имя/площадь/схема/стандарт/серия/отделка — их набор, в отличие от правки вершин,
   autoPolygon не снимает) иначе теряются. Чистое сопоставление старых и новых по геометрии — в модуле
   (по ТОЧКЕ ВНУТРИ контура EPGeom.roomMatchPoint, поэтому переносит поля и у Г/П-образных комнат, В13);
   здесь только применяем его план к свежепостроенным объектам. Ручные комнаты (autoPolygon===false) не
   источники и не цели. */
function carryUserRoomFields(oldAutoRooms,newRooms){
  /* reconcile = carry + ПАМЯТЬ исчезнувших комнат (В15): комната, чью стену удалили, исчезает
     (контур разомкнут), а перерисуют стену — вернётся со СВОИМИ полями. Память живёт в state (кладётся
     в проект в projectSnapshot, переживает автосейв/перезагрузку); правило её жизни целиком в модуле —
     здесь только читаем прежнюю и пишем обновлённую. */
  const res=EPRoomCarry.reconcile(oldAutoRooms,newRooms,state.roomFieldMemory,EPGeom);
  state.roomFieldMemory=res.memory;
  res.transfers.forEach(t=>{
    const room=newRooms.find(r=>r.id===t.toId);
    if(!room)return;
    if(t.name!=null)room.name=t.name;
    if(t.area!=null)room.area=t.area;
    /* Своя схема электрики комнаты переносится вместе с именем/площадью: пересчёт контуров зовётся
       автоматически (scheduleRoomsFromLines), и без переноса схема стиралась бы при каждой правке
       линий разметки. Отсутствие в переносе (t.lightingScheme==null) поля не создаёт — комната
       остаётся «как в проекте». */
    if(t.lightingScheme!=null)room.lightingScheme=t.lightingScheme;
    /* Монтажный стандарт комнаты (IT/DE) — решение владельца по В13: переносить (пропадал у ВСЕХ форм,
       в т.ч. прямоугольных). Прямое присваивание, как у остальных полей: каскад «смена стандарта
       сбрасывает серию/отделку» живёт в интерактивном мастере отделки, а не в записи поля, поэтому
       порядок переноса эту связку не рвёт. Отсутствие в переносе (t.standard==null) поля не создаёт. */
    if(t.standard!=null)room.standard=t.standard;
    /* Коллекция накладок комнаты (E13) переносится тем же путём, что схема: без этого правка линий
       разметки (scheduleRoomsFromLines) стирала бы её при каждом пересчёте контуров. Отсутствие в
       переносе (t.collection==null) поля не создаёт — комната остаётся без заданной коллекции. */
    if(t.collection!=null)room.collection=t.collection;
    /* Отделка накладки комнаты (E14: материал/форма/цвет) — тем же путём, что коллекция: перенос
       собирает эти поля в EPRoomCarry.normUserFields, здесь их только применяем. Отсутствие в
       переносе (==null) поля не создаёт — признак остаётся незаданным. */
    if(t.frameMaterial!=null)room.frameMaterial=t.frameMaterial;
    if(t.frameShape!=null)room.frameShape=t.frameShape;
    if(t.frameColor!=null)room.frameColor=t.frameColor;
  });
}
function loadOpenCv(){
  if(window.cv&&window.cv.Mat)return Promise.resolve();
  if(_cvPromise)return _cvPromise;
  _cvPromise=new Promise((resolve,reject)=>{
    const waitReady=()=>{const t0=Date.now();(function chk(){if(window.cv&&window.cv.Mat)resolve();else if(Date.now()-t0>60000)reject(new Error("Таймаут инициализации OpenCV"));else setTimeout(chk,80)})()};
    const s=document.createElement("script");
    s.src="vendor/opencv.js";
    /* сборка отдаёт Promise модуля: его нужно дождаться и подменить window.cv
       результатом — иначе cv.Mat остаётся undefined и сегментация падает */
    s.onload=()=>{
      if(window.cv&&typeof window.cv.then==="function"){
        window.cv.then(mod=>{if(mod)window.cv=mod;waitReady()},err=>reject(err instanceof Error?err:new Error("Не удалось инициализировать OpenCV")));
        return;
      }
      waitReady();
    };
    s.onerror=()=>reject(new Error("Не удалось загрузить vendor/opencv.js"));
    document.head.appendChild(s);
  });
  return _cvPromise;
}
async function detectRooms(){
  const img=$("planImage");
  if(!state.planLoaded||!img.naturalWidth){toast("Сначала загрузите план");return}
  const token=state.planToken;   /* запоминаем поколение подложки ДО первого await */
  showTraceProgress(true,"Загрузка модуля распознавания");
  try{
    await loadOpenCv();
    showTraceProgress(true,"Определение комнат");
    await new Promise(r=>setTimeout(r,40));
    if(planLostDuringOp(token))return;   /* подложку убрали/сменили за время загрузки — не трогаем комнаты */
    const res=EPRoomSeg.segment(img);
    const cw=canvas.clientWidth,ch=canvas.clientHeight;
    /* уничтожаемые авто-комнаты — источники переноса ручных полей на новые (по геометрии) */
    const oldAuto=state.rooms.filter(r=>r.autoPolygon);
    /* вручную поправленные контуры (autoPolygon=false) сохраняются */
    state.rooms=state.rooms.filter(r=>!r.autoPolygon);
    const kept=state.rooms.length;
    /* нумеруем дальше существующих, чтобы имена не дублировались */
    let next=state.rooms.reduce((max,r)=>{const m=/^Комната\s+(\d+)$/.exec(r.name||"");return m?Math.max(max,Number(m[1])):max},0);
    const built=[];
    res.rooms.forEach(rm=>{
      const poly=EPRoomSeg.mapPolygon(rm.polygon,res,cw,ch);
      const c=roomLabelPoint(poly),nm=roomNamePoint(poly);   /* В10 И5: seed — точка ВНУТРИ контура (roomNamePoint), якорь таблички — roomLabelPoint */
      const room={id:uid("room_"),name:"Комната "+(++next),area:"",polygon:poly,autoPolygon:true,seedX:nm.x,seedY:nm.y,x:c.x-45,y:c.y-16};
      state.rooms.push(room);built.push(room);
    });
    carryUserRoomFields(oldAuto,built);   /* вернуть имя/площадь, введённые вручную, на совпавшие комнаты */
    refreshAfterRoomAssignments(renderAll);
    showTraceProgress(false);
    toast(res.rooms.length?`Найдено комнат: ${res.rooms.length}`:"Комнаты не найдены");
    updateStatus(kept
      ?`Комнат определено: ${res.rooms.length} · сохранено ручных контуров: ${kept}`
      :`Комнат определено: ${res.rooms.length}`);
  }catch(e){console.error(e);showTraceProgress(false);toast(e.message||"Не удалось определить комнаты")}
}
/* ---- Определение комнат нейросетью (точная обводка стен, мебель не учитывается) ---- */
async function detectRoomsML(){
  const img=$("planImage");
  if(!state.planLoaded||!img.naturalWidth){toast("Сначала загрузите план");return}
  const token=state.planToken;   /* запоминаем поколение подложки ДО первого await */
  showTraceProgress(true,"Распознавание плана","Загрузка модели (~100 МБ при первом запуске)…");
  try{
    const res=await EPFloorplanML.segmentRooms(img,{
      onProgress:msg=>showTraceProgress(true,"Распознавание плана",msg||"Анализ чертежа…")
    });
    if(planLostDuringOp(token))return;   /* ДО удаления авто-комнат: иначе их не восстановить (carryUserRoomFields по пустому res) */
    const cw=canvas.clientWidth,ch=canvas.clientHeight;
    /* уничтожаемые авто-комнаты — источники переноса ручных полей на новые (по геометрии) */
    const oldAuto=state.rooms.filter(r=>r.autoPolygon);
    /* вручную поправленные контуры сохраняем, как и в OpenCV-режиме */
    state.rooms=state.rooms.filter(r=>!r.autoPolygon);
    const kept=state.rooms.length;
    let next=state.rooms.reduce((max,r)=>{const m=/^Комната\s+(\d+)$/.exec(r.name||"");return m?Math.max(max,Number(m[1])):max},0);
    const built=[];
    res.rooms.forEach(rm=>{
      const poly=EPFloorplanML.mapPolygon(rm.polygon,res,cw,ch);
      const c=roomLabelPoint(poly),nm=roomNamePoint(poly);   /* В10 И5: seed — точка ВНУТРИ контура (roomNamePoint), якорь таблички — roomLabelPoint */
      const room={id:uid("room_"),name:"Комната "+(++next),area:"",polygon:poly,autoPolygon:true,seedX:nm.x,seedY:nm.y,x:c.x-45,y:c.y-16};
      state.rooms.push(room);built.push(room);
    });
    carryUserRoomFields(oldAuto,built);   /* вернуть имя/площадь, введённые вручную, на совпавшие комнаты */
    refreshAfterRoomAssignments(renderAll);
    showTraceProgress(false);
    toast(res.rooms.length?`Найдено комнат: ${res.rooms.length}`:"Комнаты не найдены");
    updateStatus(kept
      ?`Комнат определено: ${res.rooms.length} · сохранено ручных контуров: ${kept}`
      :`Комнат определено: ${res.rooms.length}`);
  }catch(e){console.error(e);showTraceProgress(false);toast(e.message||"Не удалось определить комнаты")}
}

/* ---- Линии разметки помещений (Этап 2): отдельный слой #markupSvg.
   Чистая геометрия магнитов и пересечений — в EPGeom (тестируется), здесь только
   работа с DOM/state и оркестровка рисования цепочки. ---- */
function makeRoomLine(a,b){return {id:uid("rline_"),a:{x:a.x,y:a.y},b:{x:b.x,y:b.y}}}

/* Магнит: конец линии → пересечение линий → ТЕЛО линии (в этом порядке приоритета).
   Тело идёт последним: точные привязки (конец, пересечение) должны его перебивать,
   иначе курсор будет промахиваться мимо узлов. Привязка к телу нужна там, где на линии
   нет ни конца, ни пересечения (случай владельца: вертикаль доводится к диагонали) —
   благодаря ей точка садится РОВНО на линию, и потом появляется настоящее пересечение.
   Радиус — из EPConfig, не зашит в код (PLAN 2.3). null — если рядом ничего нет. */
function roomLineMagnet(x,y,radius){
  const pt={x,y};
  const ep=EPGeom.nearestEndpoint(pt,state.roomLines,radius);
  if(ep)return {x:ep.x,y:ep.y,kind:"endpoint"};
  const ix=EPGeom.nearestIntersection(pt,state.roomLines,radius);
  if(ix)return {x:ix.x,y:ix.y,kind:"intersection"};
  const bp=EPGeom.nearestSegmentPoint(pt,state.roomLines,radius);
  if(bp)return {x:bp.x,y:bp.y,kind:"segment"};
  return null;
}
/* Единая точка расчёта итоговой точки клика/курсора — чтобы превью и фактическая
   постановка совпадали. Приоритет: замыкание контура → магнит к линиям → сетка.
   Режим ортогональности и привязки — из state (переключатели в панели), Shift даёт
   временную инверсию ортогональности (стандарт CAD). */
function resolveRoomLinePoint(rawX,rawY,shiftKey){
  const R=EPConfig.snapRadius,pts=state.roomLinePoints;
  /* замыкание: рядом с первой точкой цепочки (нужно ≥3 точек, чтобы вышел контур) */
  if(pts.length>=3){
    const first=pts[0];
    if(Math.hypot(rawX-first.x,rawY-first.y)<=R)return {x:first.x,y:first.y,kind:"close",closing:true};
  }
  /* Магниты к концам/пересечениям линий перебивают и сетку, и ортогональность и
     работают ВСЕГДА, даже когда привязка к сетке выключена: без них контуры не
     замкнутся (владелец: отключать привязку к сетке, а не все магниты). */
  const snap=roomLineMagnet(rawX,rawY,R);
  if(snap)return {x:snap.x,y:snap.y,kind:snap.kind,closing:false};
  /* Иначе — сетка/ортогональность по режимам. Shift — ВРЕМЕННАЯ инверсия текущего
     режима ортогональности: XOR галочки и Shift (галочка вкл + Shift → свободно;
     галочка выкл + Shift → ровно). Сетку Shift не трогает — только угол. */
  const ortho=(!!state.orthoMode)!==(!!shiftKey);
  const p=EPGeom.snapPlanPoint(rawX,rawY,pts.at(-1)||null,{grid:state.gridStep,snapGrid:state.snapGrid!==false,ortho});
  return {x:p.x,y:p.y,kind:"grid",closing:false};
}
function finishRoomLineChain(){state.roomLinePoints=[];state.roomLineIds=[];state.roomLineHover=null}
function addRoomLinePoint(e){
  const r=canvas.getBoundingClientRect();
  const raw={x:(e.clientX-r.left)/state.scale,y:(e.clientY-r.top)/state.scale};
  const p=resolveRoomLinePoint(raw.x,raw.y,e.shiftKey);
  markCanvasUsed();
  if(p.closing){
    const first=state.roomLinePoints[0],last=state.roomLinePoints.at(-1);
    if(last&&(last.x!==first.x||last.y!==first.y))state.roomLines.push(makeRoomLine(last,first));
    finishRoomLineChain();
    refreshAfterRoomAssignments(()=>{drawRoomLines();renderRooms()}, scheduleSave);
    scheduleRoomsFromLines();   /* контур замкнулся — авто-пересчёт помещений с задержкой */
    updateStatus("Контур замкнут — линии разметки готовы для определения помещений");
    return;
  }
  const prev=state.roomLinePoints.at(-1);
  if(prev&&prev.x===p.x&&prev.y===p.y)return; /* защита от нулевого сегмента */
  state.roomLinePoints.push({x:p.x,y:p.y});
  if(state.roomLinePoints.length>1){
    const line=makeRoomLine(state.roomLinePoints.at(-2),p);
    state.roomLines.push(line);state.roomLineIds.push(line.id);
    refreshAfterRoomAssignments(renderRooms, scheduleSave);
    scheduleRoomsFromLines();   /* линия добавлена — авто-пересчёт (сработает, когда контур замкнётся) */
  }
  state.roomLineHover=null;
  drawRoomLines();
}
/* Backspace во время рисования — снять последнюю точку и её сегмент */
function removeLastRoomLinePoint(){
  if(!state.roomLinePoints.length)return;
  state.roomLinePoints.pop();
  const id=state.roomLineIds.pop();
  if(id)state.roomLines=state.roomLines.filter(l=>l.id!==id);
  refreshAfterRoomAssignments(()=>{drawRoomLines();renderRooms()}, scheduleSave);
  scheduleRoomsFromLines();   /* линия снята — авто-пересчёт помещений */
  updateStatus(state.roomLinePoints.length?`Точка снята · в цепочке ${state.roomLinePoints.length}`:"Цепочка очищена — поставьте первую точку");
}
function removeRoomLine(id){
  state.roomLines=state.roomLines.filter(l=>l.id!==id);
  refreshAfterRoomAssignments(()=>{drawRoomLines();renderRooms()}, scheduleSave);
  scheduleRoomsFromLines();   /* отдельная линия удалена — авто-пересчёт помещений */
}
function clearRoomLines(){
  /* «Очистить разметку» — явный сброс всей планировки по линиям: вместе с линиями забываем и память
     полей исчезнувших комнат (В15 Ж5), иначе набор «прилип» бы к новой комнате, нарисованной позже
     в том же месте, — для человека это разметка с нуля, а не продолжение старой. */
  state.roomLines=[];state.roomFieldMemory=[];finishRoomLineChain();
  refreshAfterRoomAssignments(()=>{drawRoomLines();renderRooms()}, scheduleSave);
  toast("Разметка помещений очищена");
}
function drawRoomLines(){
  const svg=$("markupSvg");if(!svg)return;
  svg.innerHTML="";
  const interactive=state.tool==="delete";   /* удаление отдельной линии — только инструментом «Удалить» */
  state.roomLines.forEach(w=>{
    if(interactive){
      const hit=document.createElementNS(SVG_NS,"line");
      hit.setAttribute("x1",w.a.x);hit.setAttribute("y1",w.a.y);hit.setAttribute("x2",w.b.x);hit.setAttribute("y2",w.b.y);
      hit.setAttribute("stroke","transparent");hit.setAttribute("stroke-width","14");
      hit.style.pointerEvents="stroke";hit.style.cursor="pointer";
      hit.onclick=ev=>{ev.stopPropagation();removeRoomLine(w.id)};
      svg.appendChild(hit);
    }
    const l=document.createElementNS(SVG_NS,"line");
    l.setAttribute("x1",w.a.x);l.setAttribute("y1",w.a.y);l.setAttribute("x2",w.b.x);l.setAttribute("y2",w.b.y);
    l.setAttribute("class","room-line");l.style.pointerEvents="none";
    svg.appendChild(l);
  });
  if(state.tool==="roomline")drawRoomLineChain(svg);
}
/* Рисуемая цепочка: вершины, «резинка»-превью к курсору и индикатор притяжения */
function drawRoomLineChain(svg){
  const pts=state.roomLinePoints,hover=state.roomLineHover;
  pts.forEach((p,i)=>{
    const dot=document.createElementNS(SVG_NS,"circle");
    dot.setAttribute("cx",p.x);dot.setAttribute("cy",p.y);dot.setAttribute("r",i===0?4.5:3);
    dot.setAttribute("class",i===0?"room-line-start":"room-line-dot");
    svg.appendChild(dot);
  });
  const last=pts.at(-1);
  if(last&&hover){
    const pv=document.createElementNS(SVG_NS,"line");
    pv.setAttribute("x1",last.x);pv.setAttribute("y1",last.y);pv.setAttribute("x2",hover.x);pv.setAttribute("y2",hover.y);
    pv.setAttribute("class","room-line-preview");
    svg.appendChild(pv);
  }
  if(hover){
    const ring=document.createElementNS(SVG_NS,"circle");
    ring.setAttribute("cx",hover.x);ring.setAttribute("cy",hover.y);
    ring.setAttribute("r",hover.closing?7:hover.kind==="endpoint"?6:5);
    ring.setAttribute("class","snap-indicator snap-"+(hover.closing?"close":hover.kind));
    svg.appendChild(ring);
  }
}

/* ---- Помещения из линий разметки (Этап 3): грани планарного графа.
   Вся геометрия — в чистом EPRoomsFromLines (тестируется), здесь оркестровка:
   чтение state.roomLines, сохранение ручных контуров, нумерация, перерисовка.
   opts.silent — авто-режим: не сыпать сообщения во время рисования. ---- */
function buildRoomsFromLines(opts){
  opts=opts||{};
  const silent=opts.silent===true;
  const lines=state.roomLines;
  if(!lines||!lines.length){if(!silent)toast("Нет линий разметки — нарисуйте контур инструментом «Разметка»");return}
  /* сетка запасного прохода — по bounding box самой разметки (бесконечный холст),
     а не по размеру блока: линии бывают где угодно. Основной проход (грани графа)
     origin/размеры не использует и работает в абсолютных координатах. */
  const linePts=[];lines.forEach(l=>linePts.push(l.a,l.b));
  const g=EPViewport.spaceGrid(EPViewport.bounds(linePts),
    {cell:EPConfig.spaceCell,margin:EPConfig.spaceMargin,maxCells:EPConfig.spaceMaxCells});
  const res=EPRoomsFromLines.roomsFromLines(lines,{
    geom:EPGeom,tol:EPConfig.roomWeldTol,minArea:EPConfig.roomMinAreaPx,
    maxSegments:EPConfig.roomMaxSegments,maxFaces:EPConfig.roomMaxFaces,
    healTol:EPConfig.roomHealTol,   /* аварийная починка зазоров: недоведённые концы → тело линии */
    width:g.width,height:g.height,originX:g.originX,originY:g.originY,
    cell:g.cell,wallRadius:wallRadiusFor(g.cell),simplifyEps:EPConfig.roomSimplifyEps
  });
  if(res.method==="skipped-limit"){if(!silent)toast(`Слишком много линий разметки (>${EPConfig.roomMaxSegments}) — пересчёт помещений пропущен`);return}
  if(!res.rooms.length){
    /* честно сообщаем: замкнутых контуров нет. В авто-режиме молчим, чтобы не
       мешать рисованию — сообщение появится только по кнопке. Существующие
       комнаты НЕ трогаем: нечего заменять, а ручные тем более сохраняем. */
    if(!silent){toast("Контур не замкнут — помещение не определено");updateStatus("Контур не замкнут — помещение не определено")}
    return;
  }
  /* уничтожаемые авто-комнаты — источники переноса ручных полей на новые (по геометрии) */
  const oldAuto=state.rooms.filter(r=>r.autoPolygon);
  /* ручные контуры (autoPolygon===false) переживают пересчёт — как в detectRooms* */
  state.rooms=state.rooms.filter(r=>!r.autoPolygon);
  const kept=state.rooms.length;
  /* нумеруем «Помещение N» дальше существующих одноимённых, чтобы имена не дублировались */
  let next=state.rooms.reduce((max,r)=>{const m=/^Помещение\s+(\d+)$/.exec(r.name||"");return m?Math.max(max,Number(m[1])):max},0);
  const built=[];
  res.rooms.forEach(rm=>{
    const poly=rm.polygon,c=roomLabelPoint(poly),nm=roomNamePoint(poly);   /* В10 И5: seed — точка ВНУТРИ контура (roomNamePoint) */
    /* roomSource — признак способа получения контура (по линиям/по сетке): запасной
       проход не подменяет основной молча, источник виден и в state, и в отчётах */
    const room={id:uid("room_"),name:"Помещение "+(++next),area:"",polygon:poly,autoPolygon:true,roomSource:rm.source,seedX:nm.x,seedY:nm.y,x:c.x-45,y:c.y-16};
    state.rooms.push(room);built.push(room);
  });
  carryUserRoomFields(oldAuto,built);   /* вернуть имя/площадь, введённые вручную, на совпавшие комнаты */
  refreshAfterRoomAssignments(renderAll, persistProject);
  if(!silent){
    const byGrid=res.rooms.filter(r=>r.source==="grid").length;
    const note=res.method==="grid"?" (по сетке — контур приблизительный)":byGrid?` (из них по сетке: ${byGrid})`:"";
    /* число «зашитых» зазоров показываем явно: если починка склеила лишнее, пользователь
       должен это видеть, а не гадать, почему помещения не те (решение владельца) */
    const healed=res.healedJoints||0;
    const healNote=healed?` · зашито зазоров: ${healed}`:"";
    toast(`Помещений по линиям: ${res.rooms.length}${note}`);
    updateStatus((kept?`Помещений по линиям: ${res.rooms.length} · сохранено ручных контуров: ${kept}`:`Помещений по линиям: ${res.rooms.length}`)+healNote);
  }
}

/* ---- РЕГИСТРАЦИЯ обработчика превью разметки и кнопок распознавания/сборки помещений
   (выполняется один раз при attach, на самом низу загрузки app.js — как canvas.onclick в
   canvasInput и кнопки в docs; событий во время загрузки нет). ---- */
/* превью «резинки» и подсветка точки притяжения при рисовании разметки */
canvas.addEventListener("pointermove",e=>{
  if(state.tool!=="roomline")return;
  const r=canvas.getBoundingClientRect();
  state.roomLineHover=resolveRoomLinePoint((e.clientX-r.left)/state.scale,(e.clientY-r.top)/state.scale,e.shiftKey);
  drawRoomLines();
});
$("clearRoomLinesBtn").onclick=clearRoomLines;
$("detectRoomsBtn").onclick=detectRooms;
$("detectRoomsMlBtn").onclick=detectRoomsML;
$("roomsFromLinesBtn").onclick=()=>buildRoomsFromLines();   /* явный запуск — не в silent-режиме */

return {addRoomLinePoint,drawRoomLines,finishRoomLineChain,removeLastRoomLinePoint,buildRoomsFromLines};
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports для автотестов. */
const api = { attach };
if (typeof window !== "undefined") window.EPRoomDetect = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
