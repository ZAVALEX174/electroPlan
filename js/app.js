(() => {
"use strict";
const $=id=>document.getElementById(id);
const canvas=$("canvas"), hover=$("hoverCard"), props=$("properties");
const state={
  tool:"select",scale:1,pending:null,selected:null,
  products:[],templates:[],devices:[],posts:[],rooms:[],walls:[],autoWalls:[],wallPoints:[],planLoaded:false,
  builder:{editingTemplateId:null,editingPlacedId:null,mechanismIds:[]}
};
const uid=p=>p+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=n=>new Intl.NumberFormat("ru-RU").format(Math.round(n))+" ₽";
const product=id=>state.products.find(x=>Number(x.id)===Number(id));
const byKind=kind=>state.products.filter(x=>x.kind===kind&&x.active);
const socketBox=()=>byKind("socket_box")[0];
const frameProduct=id=>product(id);

function toast(text){const e=$("toast");e.textContent=text;e.classList.add("show");setTimeout(()=>e.classList.remove("show"),1800)}
function postCost(p){return p.mechanismIds.reduce((s,id)=>s+(product(id)?.price||0),0)+(socketBox()?.price||0)*p.mechanismIds.length+(frameProduct(p.frameId)?.price||0)}
function setTool(tool){
  state.tool=tool;state.pending=null;state.wallPoints=[];canvas.classList.remove("placing");
  document.querySelectorAll("[data-tool]").forEach(b=>b.classList.toggle("active",b.dataset.tool===tool));
  drawWalls();updateStatus();
}
function updateStatus(text){$("status").textContent=text||`Элементов: ${state.devices.length} · Постов: ${state.posts.length} · Комнат: ${state.rooms.length}`}
function markCanvasUsed(){$("canvasEmpty").style.display="none"}

async function init(){
  state.products=await DataService.getProducts();
  state.templates=await DataService.getSavedPosts();
  renderCatalog();renderTemplates();renderAll();renderSummary();
}
function renderCatalog(filter=""){
  const standalone=state.products.filter(x=>["standalone","mechanism"].includes(x.kind)&&x.active&&x.name.toLowerCase().includes(filter.toLowerCase()));
  $("catalogCount").textContent=standalone.length;
  $("catalog").innerHTML=standalone.map(p=>`<div class="catalog-item">
    <div class="catalog-symbol">${esc(p.icon)}</div><div><strong>${esc(p.name)}</strong><small>${money(p.price)} / ${esc(p.unit)}</small></div>
    <button class="add-btn" data-add-product="${p.id}">+</button></div>`).join("");
  document.querySelectorAll("[data-add-product]").forEach(b=>b.onclick=()=>{
    state.pending={type:"device",productId:Number(b.dataset.addProduct)};canvas.classList.add("placing");
    updateStatus("Кликните на плане для размещения элемента");
  });
}
function renderTemplates(){
  const list=$("postLibrary");
  if(!state.templates.length){list.innerHTML='<div class="library-empty">Сохранённых постов пока нет</div>';return}
  list.innerHTML=state.templates.map(t=>`<div class="library-card">
    <div class="library-title"><strong>${esc(t.name)}</strong><span>${t.mechanismIds.length} места</span></div>
    <div class="library-icons">${t.mechanismIds.map(id=>`<i>${esc(product(id)?.icon||"?")}</i>`).join("")}</div>
    <div class="library-actions"><button class="place" data-place-template="${t.id}">Разместить</button><button data-edit-template="${t.id}">✎</button><button data-delete-template="${t.id}">×</button></div>
  </div>`).join("");
  document.querySelectorAll("[data-place-template]").forEach(b=>b.onclick=()=>{
    state.pending={type:"post",templateId:b.dataset.placeTemplate};canvas.classList.add("placing");
    updateStatus("Кликните на плане для размещения готового поста");
  });
  document.querySelectorAll("[data-edit-template]").forEach(b=>b.onclick=()=>openPostBuilder({templateId:b.dataset.editTemplate}));
  document.querySelectorAll("[data-delete-template]").forEach(b=>b.onclick=async()=>{
    await DataService.deletePost(b.dataset.deleteTemplate);
    state.templates=await DataService.getSavedPosts();renderTemplates();
  });
}

function compactIcon(entity,kind){
  const el=document.createElement("div");
  el.className="plan-icon "+(kind==="post"?"post ":"")+(state.selected?.kind===kind&&state.selected.id===entity.id?"selected":"");
  el.style.left=entity.x+"px";el.style.top=entity.y+"px";
  if(kind==="device") el.textContent=product(entity.productId)?.icon||"?";
  if(kind==="post"){el.textContent="P";el.dataset.count=entity.mechanismIds.length}
  el.onclick=e=>{e.stopPropagation();if(state.tool==="delete")removeEntity(kind,entity.id);else selectEntity(kind,entity.id)};
  el.onmouseenter=e=>showHover(kind,entity,e);el.onmousemove=positionHover;el.onmouseleave=hideHover;
  makeDraggable(el,entity,kind);return el;
}
function renderDevices(){canvas.querySelectorAll(".plan-icon.device-only").forEach(e=>e.remove());state.devices.forEach(d=>{const el=compactIcon(d,"device");el.classList.add("device-only");canvas.appendChild(el)})}
function renderPosts(){canvas.querySelectorAll(".plan-icon.post").forEach(e=>e.remove());state.posts.forEach(p=>{const el=compactIcon(p,"post");el.ondblclick=e=>{e.stopPropagation();openPostBuilder({placedId:p.id})};canvas.appendChild(el)})}
function renderRooms(){
  canvas.querySelectorAll(".room-label").forEach(e=>e.remove());
  state.rooms.forEach(r=>{
    const count=getObjectsInRoom(r.id).length;
    const el=document.createElement("div");
    el.className="room-label "+(state.selected?.kind==="room"&&state.selected.id===r.id?"selected":"");
    el.style.left=r.x+"px";el.style.top=r.y+"px";
    el.innerHTML=`<span class="room-title">${esc(r.name)}</span>${r.area?`<small>${esc(r.area)}</small>`:""}<span class="room-object-count">${count} объект.</span>`;
    el.onclick=e=>{e.stopPropagation();state.tool==="delete"?removeEntity("room",r.id):selectEntity("room",r.id)};
    makeDraggable(el,r,"room");
    canvas.appendChild(el);
  });
}

function allWalls(){
  return [...state.autoWalls,...state.walls];
}
function makeWall(a,b,auto){return {id:uid("wall_"),a:{x:a.x,y:a.y},b:{x:b.x,y:b.y},auto:!!auto}}
function selectWall(id){state.selected={kind:"wall",id};renderAll();renderProperties()}
function removeWall(id){
  state.walls=state.walls.filter(w=>w.id!==id);
  state.autoWalls=state.autoWalls.filter(w=>w.id!==id);
  if(state.selected?.kind==="wall")state.selected=null;
  recalculateRoomAssignments();renderAll();renderProperties();renderSummary();
}

function distancePointToSegment(px,py,ax,ay,bx,by){
  const dx=bx-ax,dy=by-ay;
  if(dx===0&&dy===0)return Math.hypot(px-ax,py-ay);
  const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy)));
  return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
}

function buildSpaceComponents(){
  const cell=10,cols=Math.ceil(canvas.clientWidth/cell),rows=Math.ceil(canvas.clientHeight/cell);
  const blocked=new Uint8Array(cols*rows);
  const walls=allWalls();

  for(let gy=0;gy<rows;gy++){
    for(let gx=0;gx<cols;gx++){
      const cx=gx*cell+cell/2,cy=gy*cell+cell/2;
      for(const w of walls){
        if(distancePointToSegment(cx,cy,w.a.x,w.a.y,w.b.x,w.b.y)<=7){
          blocked[gy*cols+gx]=1;break;
        }
      }
    }
  }

  const component=new Int32Array(cols*rows);component.fill(-1);
  let nextId=0;
  const qx=new Int32Array(cols*rows),qy=new Int32Array(cols*rows);
  for(let sy=0;sy<rows;sy++){
    for(let sx=0;sx<cols;sx++){
      const start=sy*cols+sx;
      if(blocked[start]||component[start]!==-1)continue;
      let head=0,tail=0;qx[tail]=sx;qy[tail++]=sy;component[start]=nextId;
      while(head<tail){
        const x=qx[head],y=qy[head++];
        const neighbors=[[x+1,y],[x-1,y],[x,y+1],[x,y-1]];
        for(const [nx,ny] of neighbors){
          if(nx<0||ny<0||nx>=cols||ny>=rows)continue;
          const idx=ny*cols+nx;
          if(blocked[idx]||component[idx]!==-1)continue;
          component[idx]=nextId;qx[tail]=nx;qy[tail++]=ny;
        }
      }
      nextId++;
    }
  }
  return {cell,cols,rows,blocked,component};
}

function componentAt(map,x,y){
  const gx=Math.max(0,Math.min(map.cols-1,Math.floor(x/map.cell)));
  const gy=Math.max(0,Math.min(map.rows-1,Math.floor(y/map.cell)));
  const idx=gy*map.cols+gx;
  if(!map.blocked[idx])return map.component[idx];

  for(let radius=1;radius<=3;radius++){
    for(let oy=-radius;oy<=radius;oy++){
      for(let ox=-radius;ox<=radius;ox++){
        const nx=gx+ox,ny=gy+oy;
        if(nx<0||ny<0||nx>=map.cols||ny>=map.rows)continue;
        const nidx=ny*map.cols+nx;
        if(!map.blocked[nidx])return map.component[nidx];
      }
    }
  }
  return -1;
}

function getRoomForPoint(x,y,map=null){
  if(!state.rooms.length)return null;
  map=map||buildSpaceComponents();
  const target=componentAt(map,x,y);
  if(target<0)return null;
  for(const room of state.rooms){
    const rx=(room.seedX??room.x+55),ry=(room.seedY??room.y+18);
    if(componentAt(map,rx,ry)===target)return room;
  }
  return null;
}

function updateObjectRoom(entity){
  const room=getRoomForPoint(entity.x+12,entity.y+12);
  entity.roomId=room?.id||null;
  return room;
}

function recalculateRoomAssignments(){
  const map=buildSpaceComponents();
  state.rooms.forEach(r=>{
    if(r.seedX==null){r.seedX=r.x+55;r.seedY=r.y+18}
    r.componentId=componentAt(map,r.seedX,r.seedY);
  });
  [...state.devices,...state.posts].forEach(obj=>{
    const component=componentAt(map,obj.x+12,obj.y+12);
    const room=state.rooms.find(r=>r.componentId===component);
    obj.roomId=room?.id||null;
  });
}

function getObjectsInRoom(roomId){
  const result=[];
  state.devices.forEach(d=>{if(d.roomId===roomId)result.push({kind:"device",entity:d,name:product(d.productId)?.name||"Элемент"})});
  state.posts.forEach(p=>{if(p.roomId===roomId)result.push({kind:"post",entity:p,name:p.name})});
  return result;
}

function renderAll(){
  recalculateRoomAssignments();
  renderDevices();renderPosts();renderRooms();drawWalls();
}
function showHover(kind,obj,e){
  if(kind==="device"){
    const p=product(obj.productId);
    hover.innerHTML=`<h4>${esc(p.name)}</h4><dl><dt>Артикул</dt><dd>${esc(p.code)}</dd><dt>Цена</dt><dd>${money(p.price)}</dd><dt>Высота</dt><dd>${esc(obj.height||"не указана")}</dd></dl>`;
  }else{
    const frame=frameProduct(obj.frameId),box=socketBox();
    hover.innerHTML=`<h4>${esc(obj.name)}</h4><div class="hover-composition">${obj.mechanismIds.map(id=>`<span class="hover-chip">${esc(product(id)?.name)}</span>`).join("")}</div>
    <dl><dt>Рамка</dt><dd>${esc(frame?.name)}</dd><dt>Подрозетники</dt><dd>${obj.mechanismIds.length} × ${money(box?.price||0)}</dd><dt>Стоимость поста</dt><dd>${money(postCost(obj))}</dd></dl>`;
  }
  hover.classList.add("show");positionHover(e);
}
function positionHover(e){const r=canvas.getBoundingClientRect();hover.style.left=Math.min(canvas.clientWidth-280,(e.clientX-r.left)/state.scale+18)+"px";hover.style.top=Math.max(8,(e.clientY-r.top)/state.scale-20)+"px"}
function hideHover(){hover.classList.remove("show")}
function makeDraggable(el,obj,kind){
  let dragging=false,sx=0,sy=0,bx=0,by=0;
  const move=e=>{if(!dragging)return;obj.x=Math.max(0,Math.min(canvas.clientWidth-el.offsetWidth,bx+(e.clientX-sx)/state.scale));obj.y=Math.max(0,Math.min(canvas.clientHeight-el.offsetHeight,by+(e.clientY-sy)/state.scale));el.style.left=obj.x+"px";el.style.top=obj.y+"px"};
  const up=()=>{
    if(dragging){
      if(kind==="device"||kind==="post"){
        updateObjectRoom(obj);
        renderRooms();renderProperties();renderSummary();
        const room=state.rooms.find(r=>r.id===obj.roomId);
        if(room)updateStatus(`Объект прикреплён к комнате: ${room.name}`);
        else updateStatus("Объект находится вне назначенных комнат");
      }else if(kind==="room"){
        obj.seedX=obj.x+55;obj.seedY=obj.y+18;
        recalculateRoomAssignments();renderRooms();renderSummary();
      }
    }
    dragging=false;document.removeEventListener("pointermove",move);document.removeEventListener("pointerup",up)
  };
  el.onpointerdown=e=>{if(state.tool==="delete")return;e.preventDefault();e.stopPropagation();setTool("select");state.selected={kind,id:obj.id};dragging=true;sx=e.clientX;sy=e.clientY;bx=obj.x;by=obj.y;renderAll();renderProperties();document.addEventListener("pointermove",move);document.addEventListener("pointerup",up)};
}
function selectEntity(kind,id){state.selected={kind,id};renderAll();renderProperties()}
function removeEntity(kind,id){
  if(kind==="wall"){removeWall(id);return}
  const key={device:"devices",post:"posts",room:"rooms"}[kind];state[key]=state[key].filter(x=>x.id!==id);state.selected=null;renderAll();renderProperties();renderSummary();
}
function renderProperties(){
  if(!state.selected){props.className="empty-properties";props.innerHTML="Выберите объект на плане";return}
  props.className="";
  const {kind,id}=state.selected;
  if(kind==="device"){
    const d=state.devices.find(x=>x.id===id),p=product(d.productId);
    const room=state.rooms.find(r=>r.id===d.roomId);
    props.innerHTML=`<label>Элемент<input value="${esc(p.name)}" disabled></label>
    <label>Комната<input value="${esc(room?.name||"Не назначена")}" disabled></label>
    <label>Высота установки<input id="propHeight" value="${esc(d.height||"300 мм")}"></label>
    <label>Цена<input value="${money(p.price)}" disabled></label>
    <div class="property-actions"><button class="btn ghost" id="removeSelected">Удалить</button></div>`;
    $("propHeight").oninput=e=>d.height=e.target.value;$("removeSelected").onclick=()=>removeEntity(kind,id);
  }else if(kind==="post"){
    const p=state.posts.find(x=>x.id===id);
    const room=state.rooms.find(r=>r.id===p.roomId);
    props.innerHTML=`<label>Название<input value="${esc(p.name)}" disabled></label>
    <label>Комната<input value="${esc(room?.name||"Не назначена")}" disabled></label>
    <label>Мест / подрозетников<input value="${p.mechanismIds.length}" disabled></label>
    <label>Стоимость<input value="${money(postCost(p))}" disabled></label>
    <div class="property-actions"><button class="btn primary" id="editSelected">Редактировать</button><button class="btn ghost" id="removeSelected">Удалить</button></div>`;
    $("editSelected").onclick=()=>openPostBuilder({placedId:id});$("removeSelected").onclick=()=>removeEntity(kind,id);
  }else if(kind==="wall"){
    const wobj=[...state.walls,...state.autoWalls].find(x=>x.id===id);
    const len=wobj?Math.round(Math.hypot(wobj.b.x-wobj.a.x,wobj.b.y-wobj.a.y)):0;
    props.innerHTML=`<label>Тип<input value="${wobj?.auto?"Стена (автообрисовка)":"Стена (вручную)"}" disabled></label>
    <label>Длина на холсте<input value="${len} px" disabled></label>
    <div class="property-actions"><button class="btn ghost" id="removeSelected">Удалить линию</button></div>`;
    $("removeSelected").onclick=()=>removeWall(id);
  }else{
    const r=state.rooms.find(x=>x.id===id);
    const roomObjects=getObjectsInRoom(r.id);
    props.innerHTML=`<label>Название комнаты<input id="roomName" value="${esc(r.name)}" autocomplete="off"></label>
    <label>Площадь<input id="roomArea" value="${esc(r.area||"")}" placeholder="Например, 18,6 м²" autocomplete="off"></label>
    <div class="room-equipment-box"><div class="room-equipment-head"><span>Оборудование комнаты</span><b>${roomObjects.length}</b></div>
      ${roomObjects.length?roomObjects.map(o=>`<div class="room-equipment-row"><span>${esc(o.name)}</span><small>${o.kind==="post"?"Пост":"Элемент"}</small></div>`).join(""):'<div class="room-equipment-empty">В этой комнате пока нет оборудования</div>'}
    </div>
    <button class="btn primary full" id="saveRoomProps" style="margin-top:10px">Сохранить изменения</button>
    <div class="property-save-state" id="roomSaveState"></div>`;
    const saveRoom=()=>{
      r.name=$("roomName").value.trim()||"Комната";
      r.area=$("roomArea").value.trim();
      renderRooms();
      $("roomSaveState").textContent="Изменения сохранены";
      ProjectStore.save(projectSnapshot());
    };
    $("saveRoomProps").onclick=saveRoom;
    ["roomName","roomArea"].forEach(field=>{
      $(field).onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();saveRoom()}};
      $(field).onblur=saveRoom;
    });
  }
}
function renderSummary(){
  const equipment=state.devices.reduce((s,d)=>s+(product(d.productId)?.price||0),0)+state.posts.reduce((s,p)=>s+postCost(p),0);
  const materials=equipment*EP_DATA.settings.materialsPercent/100,work=equipment*EP_DATA.settings.workPercent/100,total=equipment+materials+work;
  $("equipmentTotal").textContent=money(equipment);$("materialsTotal").textContent=money(materials);$("workTotal").textContent=money(work);$("grandTotal").textContent=money(total);
  $("objectCount").textContent=state.devices.length+state.posts.length;
  const groups={};
  state.devices.forEach(d=>{const p=product(d.productId),key="d"+p.id;groups[key]??={name:p.name,count:0,sum:0};groups[key].count++;groups[key].sum+=p.price});
  state.posts.forEach(p=>{const key="p"+p.name;groups[key]??={name:p.name,count:0,sum:0};groups[key].count++;groups[key].sum+=postCost(p)});
  $("specList").innerHTML=Object.values(groups).length?Object.values(groups).map(g=>`<div class="spec-item"><div><strong>${esc(g.name)}</strong><span>${g.count} шт.</span></div><b>${money(g.sum)}</b></div>`).join(""):'<div class="library-empty">Проект пока пуст</div>';
  updateStatus();
}

function openPostBuilder({templateId=null,placedId=null}={}){
  state.builder.editingTemplateId=templateId;state.builder.editingPlacedId=placedId;
  let src;
  if(placedId){src=state.posts.find(x=>x.id===placedId);$("postModalTitle").textContent="Редактирование поста на плане"}
  else if(templateId){src=state.templates.find(x=>x.id===templateId);$("postModalTitle").textContent="Редактирование шаблона поста"}
  else{src={name:"Пост 3 места",frameId:byKind("frame")[0]?.id,mechanismIds:byKind("mechanism").slice(0,3).map(x=>x.id)};$("postModalTitle").textContent="Новый электрический пост"}
  $("postName").value=src.name;$("postSlotCount").value=String(src.mechanismIds.length);state.builder.mechanismIds=[...src.mechanismIds];
  $("postFrameSelect").innerHTML=byKind("frame").map(f=>`<option value="${f.id}" ${Number(f.id)===Number(src.frameId)?"selected":""}>${esc(f.name)} — ${money(f.price)}</option>`).join("");
  renderBuilder();$("postModal").classList.add("open");
}
function renderBuilder(){
  const count=Number($("postSlotCount").value),mechs=byKind("mechanism");
  while(state.builder.mechanismIds.length<count)state.builder.mechanismIds.push(mechs[0]?.id);
  state.builder.mechanismIds=state.builder.mechanismIds.slice(0,count);
  $("postPreview").innerHTML=`<div class="preview-frame">${state.builder.mechanismIds.map(id=>`<div class="preview-place">${esc(product(id)?.icon)}<br>${esc(product(id)?.name)}</div>`).join("")}</div>`;
  $("builderSlots").innerHTML=state.builder.mechanismIds.map((id,i)=>`<div class="builder-slot"><div class="slot-number">${i+1}</div><select data-builder-slot="${i}">${mechs.map(m=>`<option value="${m.id}" ${Number(m.id)===Number(id)?"selected":""}>${esc(m.name)} — ${money(m.price)}</option>`).join("")}</select></div>`).join("");
  document.querySelectorAll("[data-builder-slot]").forEach(s=>s.onchange=()=>{state.builder.mechanismIds[Number(s.dataset.builderSlot)]=Number(s.value);renderBuilder()});
}
async function savePostBuilder(){
  const base={name:$("postName").value.trim()||"Пост",frameId:Number($("postFrameSelect").value),mechanismIds:[...state.builder.mechanismIds],socketBoxProductId:socketBox()?.id};
  if(state.builder.editingPlacedId){
    Object.assign(state.posts.find(x=>x.id===state.builder.editingPlacedId),base);renderAll();renderProperties();renderSummary();toast("Пост на плане обновлён");
  }else{
    const existing=state.builder.editingTemplateId;
    const template={id:existing||uid("tpl_"),...base};
    await DataService.savePost(template);state.templates=await DataService.getSavedPosts();renderTemplates();toast(existing?"Шаблон обновлён":"Пост сохранён в библиотеку");
  }
  closePostBuilder();
}
function closePostBuilder(){$("postModal").classList.remove("open");state.builder={editingTemplateId:null,editingPlacedId:null,mechanismIds:[]}}

function addPending(x,y){
  if(!state.pending)return;
  markCanvasUsed();
  let created;
  if(state.pending.type==="device"){
    created={id:uid("dev_"),productId:state.pending.productId,x:x-12,y:y-12,height:"300 мм",roomId:null};
    state.devices.push(created);
  }else{
    const t=state.templates.find(v=>v.id===state.pending.templateId);
    if(!t){toast("Шаблон не найден");return}
    created={id:uid("post_"),templateId:t.id,x:x-12,y:y-12,name:t.name,frameId:t.frameId,mechanismIds:[...t.mechanismIds],socketBoxProductId:t.socketBoxProductId,roomId:null};
    state.posts.push(created);
  }
  updateObjectRoom(created);
  const room=state.rooms.find(r=>r.id===created.roomId);
  setTool("select");renderAll();renderSummary();toast(room?`Объект добавлен в комнату «${room.name}»`:"Объект размещён вне комнаты");
}
const GRID=25;
function snapToGrid(v){return Math.round(v/GRID)*GRID}
function addWallPoint(e){
  const r=canvas.getBoundingClientRect();
  let x=snapToGrid((e.clientX-r.left)/state.scale),y=snapToGrid((e.clientY-r.top)/state.scale);
  if(state.wallPoints.length){
    const a=state.wallPoints.at(-1);
    // ортогональность: выравниваем короткую ось, если сегмент почти горизонтальный/вертикальный
    if(Math.abs(x-a.x)<=Math.abs(y-a.y))x=a.x;else y=a.y;
  }
  const p={x,y};state.wallPoints.push(p);
  if(state.wallPoints.length>1){
    state.walls.push(makeWall(state.wallPoints.at(-2),p,false));
    recalculateRoomAssignments();drawWalls();renderRooms()
  }
}
function drawWalls(){
  const svg=$("wallsSvg");svg.innerHTML="";
  const interactive=state.tool==="select"||state.tool==="delete";
  const appendLine=(w)=>{
    const auto=w.auto,sel=state.selected?.kind==="wall"&&state.selected.id===w.id;
    if(interactive){
      const hit=document.createElementNS("http://www.w3.org/2000/svg","line");
      hit.setAttribute("x1",w.a.x);hit.setAttribute("y1",w.a.y);hit.setAttribute("x2",w.b.x);hit.setAttribute("y2",w.b.y);
      hit.setAttribute("stroke","transparent");hit.setAttribute("stroke-width","14");
      hit.style.pointerEvents="stroke";hit.style.cursor="pointer";
      hit.onclick=e=>{e.stopPropagation();state.tool==="delete"?removeWall(w.id):selectWall(w.id)};
      svg.appendChild(hit);
    }
    const l=document.createElementNS("http://www.w3.org/2000/svg","line");
    l.setAttribute("x1",w.a.x);l.setAttribute("y1",w.a.y);l.setAttribute("x2",w.b.x);l.setAttribute("y2",w.b.y);
    l.setAttribute("stroke",sel?"#bf3f4e":(auto?"#1872ad":"#102a43"));
    l.setAttribute("stroke-width",sel?"6":(auto?"3":"5"));
    l.setAttribute("stroke-linecap","round");if(auto&&!sel)l.classList.add("auto-wall");
    l.style.pointerEvents="none";
    svg.appendChild(l);
  };
  state.autoWalls.forEach(appendLine);
  state.walls.forEach(appendLine);
}

function projectSnapshot(){return{name:"Проект электроснабжения",savedAt:new Date().toISOString(),devices:state.devices,posts:state.posts,rooms:state.rooms,walls:state.walls,autoWalls:state.autoWalls}}
function saveProject(){ProjectStore.save(projectSnapshot());toast("Проект сохранён в браузере")}
function generateCommercialOffer(){
  const equipment=state.devices.reduce((s,d)=>s+(product(d.productId)?.price||0),0)+state.posts.reduce((s,p)=>s+postCost(p),0);
  const materials=equipment*EP_DATA.settings.materialsPercent/100,work=equipment*EP_DATA.settings.workPercent/100,total=equipment+materials+work;
  const rows=[];
  state.devices.forEach(d=>{const p=product(d.productId);rows.push({name:p.name,composition:p.code,qty:1,price:p.price,sum:p.price})});
  state.posts.forEach(p=>rows.push({name:p.name,composition:[frameProduct(p.frameId)?.name,`${p.mechanismIds.length} подрозетн.`,...p.mechanismIds.map(id=>product(id)?.name)].join(", "),qty:1,price:postCost(p),sum:postCost(p)}));
  const win=window.open("","_blank");
  if(!win){toast("Разрешите всплывающие окна для формирования PDF");return}
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Коммерческое предложение</title><style>
  @page{size:A4;margin:16mm}body{font-family:Arial,sans-serif;color:#172b3f;font-size:12px}h1{font-size:24px;color:#1675c8;margin:0 0 4px}.sub{color:#687f94;margin-bottom:24px}.meta{display:flex;justify-content:space-between;margin-bottom:20px}.box{padding:12px;background:#edf6ff;border-radius:10px}table{width:100%;border-collapse:collapse;margin-top:14px}th,td{padding:9px;border-bottom:1px solid #d8e6f2;text-align:left}th{background:#e8f4ff;color:#185d96}.right{text-align:right}.totals{width:340px;margin:22px 0 0 auto}.totals div{display:flex;justify-content:space-between;padding:7px}.grand{font-size:16px;font-weight:bold;color:white;background:#1675c8;border-radius:8px}.footer{margin-top:35px;color:#687f94;font-size:10px}@media print{button{display:none}}</style></head><body>
  <h1>Коммерческое предложение</h1><div class="sub">Проект электрики и комплектация электроустановочных изделий</div>
  <div class="meta"><div class="box"><b>Проект:</b> ElectroPlan<br><b>Дата:</b> ${new Date().toLocaleDateString("ru-RU")}</div><button onclick="window.print()">Сохранить в PDF</button></div>
  <table><thead><tr><th>№</th><th>Наименование</th><th>Состав / артикул</th><th>Кол.</th><th class="right">Цена</th><th class="right">Сумма</th></tr></thead><tbody>
  ${rows.map((r,i)=>`<tr><td>${i+1}</td><td><b>${esc(r.name)}</b></td><td>${esc(r.composition)}</td><td>${r.qty}</td><td class="right">${money(r.price)}</td><td class="right">${money(r.sum)}</td></tr>`).join("")}
  </tbody></table>
  <div class="totals"><div><span>Оборудование</span><b>${money(equipment)}</b></div><div><span>Монтажные материалы</span><b>${money(materials)}</b></div><div><span>Работы</span><b>${money(work)}</b></div><div class="grand"><span>Итого</span><b>${money(total)}</b></div></div>
  <div class="footer">Цены являются ориентировочными и могут быть уточнены после согласования бренда, серии оборудования и условий монтажа.</div>
  <script>setTimeout(()=>window.print(),500)<\/script></body></html>`);
  win.document.close();
}


function showTraceProgress(show,message="Анализ линий плана"){
  let overlay=document.getElementById("traceProgress");
  if(show){
    if(!overlay){
      overlay=document.createElement("div");overlay.id="traceProgress";overlay.className="trace-progress";
      overlay.innerHTML=`<div class="trace-progress-box"><strong>${esc(message)}</strong><span>Поиск горизонтальных и вертикальных стен…</span></div>`;
      canvas.appendChild(overlay);
    }
  }else overlay?.remove();
}

function mergeSegments(segments,orientation,tolerance=5,gap=18){
  const result=[];
  const sorted=[...segments].sort((a,b)=>
    orientation==="h" ? (a.y-b.y || a.x1-b.x1) : (a.x-b.x || a.y1-b.y1)
  );
  for(const s of sorted){
    const last=result.at(-1);
    if(!last){result.push({...s});continue}
    if(orientation==="h"){
      if(Math.abs(last.y-s.y)<=tolerance && s.x1-last.x2<=gap){
        last.x2=Math.max(last.x2,s.x2);last.y=(last.y+s.y)/2;
      }else result.push({...s});
    }else{
      if(Math.abs(last.x-s.x)<=tolerance && s.y1-last.y2<=gap){
        last.y2=Math.max(last.y2,s.y2);last.x=(last.x+s.x)/2;
      }else result.push({...s});
    }
  }
  return result;
}

/* ---- Автообрисовка: детекция стен по толщине (этапы 1–3) ---- */
function binarize(data,w,h,threshold){
  const dark=new Uint8Array(w*h);
  for(let i=0,p=0;i<data.length;i+=4,p++){
    const gray=.299*data[i]+.587*data[i+1]+.114*data[i+2];
    dark[p]=gray<threshold?1:0;
  }
  return dark;
}
// Бинарные морфологические операции (сепарабельные: сначала по X, затем по Y).
function dilate(src,w,h,r){
  const tmp=new Uint8Array(w*h),out=new Uint8Array(w*h);
  for(let y=0;y<h;y++){const row=y*w;for(let x=0;x<w;x++){let v=0;for(let k=-r;k<=r&&!v;k++){const xx=x+k;if(xx>=0&&xx<w&&src[row+xx])v=1;}tmp[row+x]=v;}}
  for(let x=0;x<w;x++){for(let y=0;y<h;y++){let v=0;for(let k=-r;k<=r&&!v;k++){const yy=y+k;if(yy>=0&&yy<h&&tmp[yy*w+x])v=1;}out[y*w+x]=v;}}
  return out;
}
function erode(src,w,h,r){
  const tmp=new Uint8Array(w*h),out=new Uint8Array(w*h);
  for(let y=0;y<h;y++){const row=y*w;for(let x=0;x<w;x++){let v=1;for(let k=-r;k<=r&&v;k++){const xx=x+k;if(xx<0||xx>=w||!src[row+xx])v=0;}tmp[row+x]=v;}}
  for(let x=0;x<w;x++){for(let y=0;y<h;y++){let v=1;for(let k=-r;k<=r&&v;k++){const yy=y+k;if(yy<0||yy>=h||!tmp[yy*w+x])v=0;}out[y*w+x]=v;}}
  return out;
}
// Замыкание (dilate→erode) заполняет мелкие белые промежутки штриховки, превращая стену в сплошную полосу.
function closeBinary(src,w,h,r){return erode(dilate(src,w,h,r),w,h,r);}

// Оставляет только крупные связные компоненты (сеть стён тянется через весь план),
// убирая текст, мебель, сантехнику и размерные подписи (мелкие отдельные кляксы).
function keepWallComponents(src,w,h,minSpan,minAreaFrac){
  const n=w*h,label=new Int32Array(n),stack=new Int32Array(n),keepComp=[];
  const minArea=w*h*minAreaFrac;let comp=0;
  for(let i=0;i<n;i++){
    if(!src[i]||label[i])continue;
    comp++;let sp=0;stack[sp++]=i;label[i]=comp;
    let count=0,minx=w,maxx=0,miny=h,maxy=0;
    while(sp){
      const p=stack[--sp],x=p%w,y=(p/w)|0;
      count++;if(x<minx)minx=x;if(x>maxx)maxx=x;if(y<miny)miny=y;if(y>maxy)maxy=y;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        if(!dx&&!dy)continue;
        const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;
        const np=ny*w+nx;if(src[np]&&!label[np]){label[np]=comp;stack[sp++]=np;}
      }
    }
    const spanW=(maxx-minx+1)/w,spanH=(maxy-miny+1)/h;
    keepComp[comp]=((spanW>=minSpan||spanH>=minSpan)&&count>=minArea)?1:0;
  }
  const out=new Uint8Array(n);
  for(let i=0;i<n;i++)if(src[i]&&keepComp[label[i]])out[i]=1;
  return out;
}

// Осевые точки горизонтальных стен: вертикальные тёмные полосы толщиной [tMin;tMax].
// Тонкие размерные/выносные линии (толщина 1–2px) отсекаются, двойной контур схлопывается в ось.
function horizontalCandidates(dark,w,h,tMin,tMax){
  const cand=new Uint8Array(w*h);
  for(let x=0;x<w;x++){
    let run=0;
    for(let y=0;y<=h;y++){
      const on=y<h&&dark[y*w+x];
      if(on){run++;}
      else{if(run>=tMin&&run<=tMax){const c=((y-run)+(y-1))>>1;cand[c*w+x]=1;}run=0;}
    }
  }
  return cand;
}
function verticalCandidates(dark,w,h,tMin,tMax){
  const cand=new Uint8Array(w*h);
  for(let y=0;y<h;y++){
    const row=y*w;let run=0;
    for(let x=0;x<=w;x++){
      const on=x<w&&dark[row+x];
      if(on){run++;}
      else{if(run>=tMin&&run<=tMax){const c=((x-run)+(x-1))>>1;cand[row+c]=1;}run=0;}
    }
  }
  return cand;
}
function runsAlongRows(cand,w,h,minRun,gap){
  const segs=[];
  for(let y=0;y<h;y++){
    const row=y*w;let start=-1,last=-1;
    for(let x=0;x<w;x++){
      if(cand[row+x]){if(start<0)start=x;last=x;}
      else if(start>=0&&x-last>gap){if(last-start>=minRun)segs.push({x1:start,x2:last,y});start=-1;}
    }
    if(start>=0&&last-start>=minRun)segs.push({x1:start,x2:last,y});
  }
  return segs;
}
function runsAlongCols(cand,w,h,minRun,gap){
  const segs=[];
  for(let x=0;x<w;x++){
    let start=-1,last=-1;
    for(let y=0;y<h;y++){
      if(cand[y*w+x]){if(start<0)start=y;last=y;}
      else if(start>=0&&y-last>gap){if(last-start>=minRun)segs.push({y1:start,y2:last,x});start=-1;}
    }
    if(start>=0&&last-start>=minRun)segs.push({y1:start,y2:last,x});
  }
  return segs;
}

function autoTracePlan(){
  if(!state.planLoaded || !$("planImage").src){toast("Сначала загрузите изображение плана");return}
  showTraceProgress(true);
  setTimeout(()=>{
    try{
      const image=$("planImage"),analysis=$("analysisCanvas"),ctx=analysis.getContext("2d",{willReadFrequently:true});
      const ratio=Math.min(900/image.naturalWidth,650/image.naturalHeight,1);
      const w=Math.max(1,Math.round(image.naturalWidth*ratio)),h=Math.max(1,Math.round(image.naturalHeight*ratio));
      analysis.width=w;analysis.height=h;
      ctx.fillStyle="#fff";ctx.fillRect(0,0,w,h);
      ctx.drawImage(image,0,0,w,h);
      const data=ctx.getImageData(0,0,w,h).data;

      const sensitivity=Number($("traceSensitivity").value);
      const threshold=255-(sensitivity/100)*155;
      let dark=binarize(data,w,h,threshold);

      const minDim=Math.min(w,h);
      const closeR=Math.max(3,Math.round(minDim*.010));      // этап 3: заполнение штриховки (склеивает две грани стены в полосу)
      dark=closeBinary(dark,w,h,closeR);
      dark=keepWallComponents(dark,w,h,.33,.004);            // выделение сети стён: убирает текст/мебель/подписи

      const tMin=Math.max(4,Math.round(minDim*.006));        // толщина стены в px анализа
      const tMax=Math.max(tMin+4,Math.round(minDim*.05));
      const minRun=Math.max(18,Math.round(w*.035));
      // текст уже убран выделением компонентов — можно смелее сшивать обрывки осевых линий стен
      const gap=Math.max(6,Math.round(minRun*.6));

      const hCand=horizontalCandidates(dark,w,h,tMin,tMax);  // этап 2: отбор по толщине
      const vCand=verticalCandidates(dark,w,h,tMin,tMax);
      const mergedH=mergeSegments(runsAlongRows(hCand,w,h,minRun,gap),"h").filter(s=>s.x2-s.x1>=minRun);
      const mergedV=mergeSegments(runsAlongCols(vCand,w,h,minRun,gap),"v").filter(s=>s.y2-s.y1>=minRun);

      // этап 1: привязка к фактически отображаемому плану (object-fit:contain — единый масштаб + смещение)
      const iw=image.naturalWidth,ih=image.naturalHeight,cw=canvas.clientWidth,ch=canvas.clientHeight;
      const disp=Math.min(cw/iw,ch/ih),dispW=iw*disp,dispH=ih*disp,offX=(cw-dispW)/2,offY=(ch-dispH)/2;
      const CX=ax=>offX+(ax/w)*dispW,CY=ay=>offY+(ay/h)*dispH;

      state.autoWalls=[
        ...mergedH.slice(0,260).map(s=>makeWall({x:CX(s.x1),y:CY(s.y)},{x:CX(s.x2),y:CY(s.y)},true)),
        ...mergedV.slice(0,260).map(s=>makeWall({x:CX(s.x),y:CY(s.y1)},{x:CX(s.x),y:CY(s.y2)},true))
      ];
      recalculateRoomAssignments();drawWalls();renderRooms();renderProperties();renderSummary();showTraceProgress(false);
      toast(state.autoWalls.length?`Найдено стен: ${state.autoWalls.length}`:"Стены не найдены — измените чувствительность");
      updateStatus(`Автообрисовка: ${state.autoWalls.length} линий`);
    }catch(error){
      console.error(error);showTraceProgress(false);toast("Не удалось обработать изображение");
    }
  },60);
}

canvas.onclick=e=>{
  const r=canvas.getBoundingClientRect(),x=(e.clientX-r.left)/state.scale,y=(e.clientY-r.top)/state.scale;
  if(state.pending)addPending(x,y);
  else if(state.tool==="wall")addWallPoint(e);
  else if(state.tool==="room"){
    markCanvasUsed();
    const room={id:uid("room_"),x:x-55,y:y-18,seedX:x,seedY:y,name:"Новая комната",area:""};
    state.rooms.push(room);state.selected={kind:"room",id:room.id};
    setTool("select");renderAll();renderProperties();renderSummary();
    toast("Комната создана. Оборудование внутри привязано автоматически");
  }
  else if(e.target===canvas||e.target===$("wallsSvg")){state.selected=null;renderAll();renderProperties()}
};
document.querySelectorAll("[data-tool]").forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
$("catalogSearch").oninput=e=>renderCatalog(e.target.value);
$("newPostBtn").onclick=()=>openPostBuilder();
$("closePostModal").onclick=$("cancelPost").onclick=closePostBuilder;
$("savePost").onclick=savePostBuilder;$("postSlotCount").onchange=renderBuilder;
$("postModal").onclick=e=>{if(e.target===$("postModal"))closePostBuilder()};
$("zoomIn").onclick=()=>{state.scale=Math.min(2,state.scale+.1);canvas.style.transform=`scale(${state.scale})`;updateStatus(`Масштаб ${Math.round(state.scale*100)}%`)};
$("zoomOut").onclick=()=>{state.scale=Math.max(.5,state.scale-.1);canvas.style.transform=`scale(${state.scale})`;updateStatus(`Масштаб ${Math.round(state.scale*100)}%`)};
$("zoomReset").onclick=()=>{state.scale=1;canvas.style.transform="scale(1)";updateStatus()};
$("planUpload").onchange=e=>{
  const f=e.target.files[0];if(!f)return;
  const reader=new FileReader();
  reader.onload=x=>{
    const img=$("planImage");
    img.onload=()=>{
      state.planLoaded=true;$("autoTraceBtn").disabled=false;
      $("planStatusDot").classList.add("ready");markCanvasUsed();
      updateStatus(`План загружен: ${f.name}`);
    };
    img.src=x.target.result;
  };
  reader.readAsDataURL(f);
};
$("clearBtn").onclick=()=>{state.devices=[];state.posts=[];state.rooms=[];state.walls=[];state.autoWalls=[];state.wallPoints=[];state.selected=null;renderAll();renderProperties();renderSummary()};
$("autoTraceBtn").onclick=autoTracePlan;
$("clearAutoTraceBtn").onclick=()=>{state.autoWalls=[];recalculateRoomAssignments();drawWalls();renderRooms();renderProperties();renderSummary();toast("Автоматические линии удалены")};
$("traceSensitivity").oninput=e=>$("traceSensitivityValue").textContent=e.target.value+"%";
$("saveProjectBtn").onclick=saveProject;$("pdfBtn").onclick=generateCommercialOffer;
$("demoBtn").onclick=()=>{
  markCanvasUsed();state.autoWalls=[];state.walls=[
    makeWall({x:140,y:120},{x:900,y:120}),makeWall({x:900,y:120},{x:900,y:600}),
    makeWall({x:900,y:600},{x:140,y:600}),makeWall({x:140,y:600},{x:140,y:120}),
    makeWall({x:520,y:120},{x:520,y:600})
  ];
  state.rooms=[
    {id:uid("room_"),x:270,y:175,seedX:325,seedY:193,name:"Гостиная",area:"20,4 м²"},
    {id:uid("room_"),x:650,y:175,seedX:705,seedY:193,name:"Кухня",area:"12,8 м²"}
  ];
  state.devices=[{id:uid("dev_"),productId:107,x:320,y:310,height:"Потолок"},{id:uid("dev_"),productId:101,x:205,y:530,height:"300 мм"}];
  const template=state.templates[0];if(template)state.posts=[{id:uid("post_"),templateId:template.id,x:610,y:510,name:template.name,frameId:template.frameId,mechanismIds:[...template.mechanismIds],socketBoxProductId:template.socketBoxProductId}];
  drawWalls();renderAll();renderSummary();
};
document.onkeydown=e=>{if(e.key==="Escape"){setTool("select");closePostBuilder()}if(e.key==="Enter"&&state.tool==="wall")setTool("select");if(e.key==="Delete"&&state.selected)removeEntity(state.selected.kind,state.selected.id)};
init();
})();