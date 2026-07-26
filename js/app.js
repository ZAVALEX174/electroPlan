(() => {
"use strict";
const $=id=>document.getElementById(id);
const canvas=$("canvas"), hover=$("hoverCard"), props=$("properties");
const state={
  tool:"select",scale:1,pending:null,selected:null,
  products:[],templates:[],devices:[],posts:[],rooms:[],walls:[],autoWalls:[],wallPoints:[],planLoaded:false,
  pxPerMeter:null,scaleSegment:null,scalePoints:[],
  builder:{editingTemplateId:null,editingPlacedId:null,mechanismIds:[]}
};
const uid=p=>p+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=(n,currency=EP_DATA.settings.currency||"EUR")=>new Intl.NumberFormat("ru-RU",{
  style:"currency",currency,minimumFractionDigits:2,maximumFractionDigits:2
}).format(Number(n)||0);
const product=id=>state.products.find(x=>Number(x.id)===Number(id));
const byKind=kind=>state.products.filter(x=>x.kind===kind&&x.active);
const socketBox=()=>byKind("socket_box")[0];
const frameProduct=id=>product(id);
const productMoney=item=>money(item?.price,item?.currency||EP_DATA.settings.currency);
const productOptionLabel=item=>`[${item?.code||"без артикула"}] ${item?.name||"Без названия"} — ${productMoney(item)}`;
const moduleWord=count=>`${count} ${count===1?"модуль":count>=2&&count<=4?"модуля":"модулей"}`;
function mechanismSpan(item){
  if(!item)return 0;
  const explicit=Number(item.moduleSpan??item.module_span??item.modules??item.moduleCount??item.properties?.moduleSpan);
  if(Number.isInteger(explicit)&&explicit>=1&&explicit<=8)return explicit;
  const match=String(item.name||"").match(/(?:^|[\s,(])([1-8])\s*(?:модул|modules?|mod\b)/i);
  return match?Number(match[1]):1;
}
const mechanismModulesTotal=ids=>ids.reduce((sum,id)=>sum+mechanismSpan(product(id)),0);
const mechanismOptionLabel=item=>`${productOptionLabel(item)} · ${moduleWord(mechanismSpan(item))}`;
const productSeries=item=>{
  const raw=item?.series??item?.properties?.series??item?.compatibility;
  if(Array.isArray(raw))return raw.map(String).filter(Boolean);
  return String(raw||"").split(/[,;|]/).map(x=>x.trim()).filter(Boolean);
};
function compatibleMechanisms(frame,mechanisms){
  const frameSeries=productSeries(frame).map(x=>x.toLocaleLowerCase("ru-RU"));
  if(!frameSeries.length)return mechanisms;
  const compatible=mechanisms.filter(item=>{
    const series=productSeries(item).map(x=>x.toLocaleLowerCase("ru-RU"));
    return series.some(value=>frameSeries.includes(value));
  });
  return compatible.length?compatible:mechanisms;
}
const mechanismGroupLabels={
  500:"Выключатели и кнопки",
  600:"Диммеры и управление светом",
  300:"Силовые розетки",
  400:"USB, TV и слаботочные интерфейсы",
  700:"Термостаты и датчики",
  800:"Умный дом",
  900:"Монтажные аксессуары",
  1000:"Прочее"
};
function mechanismOptions(items,selectedId,{maxSpan=Infinity,emptyLabel=""}={}){
  const groups=new Map();
  items.filter(item=>mechanismSpan(item)<=maxSpan).forEach(item=>{
    const label=mechanismGroupLabels[Number(item.categoryId)]||"Прочее";
    if(!groups.has(label))groups.set(label,[]);
    groups.get(label).push(item);
  });
  const empty=emptyLabel?`<option value="">${esc(emptyLabel)}</option>`:"";
  return empty+[...groups].map(([label,products])=>`<optgroup label="${esc(label)}">${products.map(item=>
    `<option value="${item.id}" ${Number(item.id)===Number(selectedId)?"selected":""}>${esc(mechanismOptionLabel(item))}</option>`
  ).join("")}</optgroup>`).join("");
}
function frameOptions(items,selectedId){
  const groups=new Map();
  items.forEach(item=>{
    const label=productSeries(item).join(", ")||"Другие серии";
    if(!groups.has(label))groups.set(label,[]);
    groups.get(label).push(item);
  });
  return [...groups].map(([label,products])=>`<optgroup label="${esc(label)}">${products.map(item=>
    `<option value="${item.id}" ${Number(item.id)===Number(selectedId)?"selected":""}>${esc(productOptionLabel(item))}</option>`
  ).join("")}</optgroup>`).join("");
}
function fitMechanismIds(ids,items,capacity){
  const allowed=new Set(items.map(item=>Number(item.id)));
  const result=[];
  let occupied=0;
  ids.forEach(id=>{
    const numericId=Number(id),item=product(numericId),span=mechanismSpan(item);
    if(!allowed.has(numericId)||!span||occupied+span>capacity)return;
    result.push(numericId);
    occupied+=span;
  });
  return result;
}
function fitMechanismIdsPreserving(ids,items,capacity,pinnedIndex){
  const allowed=new Set(items.map(item=>Number(item.id)));
  const result=ids.map(Number).filter(id=>allowed.has(id));
  let pinned=Math.min(Math.max(0,pinnedIndex),Math.max(0,result.length-1));
  while(mechanismModulesTotal(result)>capacity&&result.length>1){
    let removeIndex=result.length-1;
    if(removeIndex===pinned)removeIndex-=1;
    if(removeIndex<0)break;
    result.splice(removeIndex,1);
    if(removeIndex<pinned)pinned-=1;
  }
  return result.filter(id=>mechanismSpan(product(id))<=capacity);
}
function frameSlotCount(item){
  if(!item)return null;
  const explicit=Number(item.slotCount??item.slots??item.placeCount);
  if(Number.isInteger(explicit)&&explicit>=1&&explicit<=5)return explicit;
  const text=[item.name,item.compatibility,item.properties?.compatibility].filter(Boolean).join(" ");
  const match=text.match(/(?:на|для)?\s*([1-5])\s*(?:модул|мест|пост|module|slot|[mf]\b)/i);
  return match?Number(match[1]):null;
}
const defaultPostName=count=>`Пост на ${moduleWord(count)}`;
const defaultFrameOpenings={
  1:{left:37.5,top:23.5,width:25,height:53.5,aspect:1},
  2:{left:24,top:23,width:52,height:51.5,aspect:1},
  3:{left:21.5,top:23,width:57,height:53.5,aspect:1.39},
  4:{left:18.7,top:23,width:62.5,height:52.5,aspect:1.66},
  5:{left:13,top:23,width:74,height:55.5,aspect:2.02}
};
function frameOpening(item,count){
  let custom=item?.mountRect??item?.mount_rect??item?.frameOpening??item?.frame_opening;
  if(typeof custom==="string"){
    try{custom=JSON.parse(custom)}catch{custom=null}
  }
  const fallback=defaultFrameOpenings[count]||defaultFrameOpenings[3];
  if(!custom||typeof custom!=="object")return fallback;
  const rect={
    left:Number(custom.left??custom.x),
    top:Number(custom.top??custom.y),
    width:Number(custom.width??custom.w),
    height:Number(custom.height??custom.h),
    aspect:Number(custom.aspect??fallback.aspect)
  };
  const valid=[rect.left,rect.top,rect.width,rect.height].every(Number.isFinite)
    &&rect.left>=0&&rect.top>=0&&rect.width>0&&rect.height>0
    &&rect.left+rect.width<=100&&rect.top+rect.height<=100;
  return valid?rect:fallback;
}
const productImage=(item,{detail=false}={})=>{
  if(!item)return "";
  const preview=item.previewImageUrl||item.preview_image_url||"";
  const full=item.detailImageUrl||item.detail_image_url||item.imageUrl||item.image_url||"";
  return detail?(full||preview):(preview||full);
};
function productPicture(item,{className="",detail=false,label="",eager=false,style=""}={}){
  const imageUrl=productImage(item,{detail});
  return `<span class="product-picture ${className}${imageUrl?" has-image":""}"${style?` style="${esc(style)}"`:""}>
    ${imageUrl?`<img src="${esc(imageUrl)}" alt="${esc(label||item?.name||"Изображение товара")}" loading="${eager?"eager":"lazy"}" decoding="async" data-product-picture>`:""}
    <span class="product-picture-fallback" aria-hidden="true">${esc(item?.icon||"?")}</span>
  </span>`;
}
function bindProductPictureFallbacks(root){
  root.querySelectorAll("img[data-product-picture]").forEach(img=>{
    img.addEventListener("error",()=>img.closest(".product-picture")?.classList.remove("has-image"),{once:true});
  });
}

function toast(text){const e=$("toast");e.textContent=text;e.classList.add("show");setTimeout(()=>e.classList.remove("show"),1800)}
function postCost(p){return p.mechanismIds.reduce((s,id)=>s+(product(id)?.price||0),0)+(socketBox()?.price||0)*p.mechanismIds.length+(frameProduct(p.frameId)?.price||0)}
function setTool(tool){
  state.tool=tool;state.pending=null;state.wallPoints=[];canvas.classList.remove("placing");
  if(tool!=="scale")state.scalePoints=[];
  document.querySelectorAll("[data-tool]").forEach(b=>b.classList.toggle("active",b.dataset.tool===tool));
  canvas.classList.toggle("measuring",tool==="scale");
  drawWalls();renderRooms();renderScaleRuler();updateStatus();
  if(tool==="vertex"){
    const room=state.selected?.kind==="room"?state.rooms.find(r=>r.id===state.selected.id):null;
    updateStatus(room?.polygon?.length>2
      ?"Правка контура: тяните вершины · синие точки добавляют · Alt+клик удаляет"
      :"Правка контура: выберите комнату с автоматическим контуром");
  }
  if(tool==="scale")updateStatus("Отметьте две точки отрезка известной длины");
}
function updateStatus(text){$("status").textContent=text||`Элементов: ${state.devices.length} · Постов: ${state.posts.length} · Комнат: ${state.rooms.length}`}
function markCanvasUsed(){$("canvasEmpty").style.display="none"}

async function init(){
  state.products=await DataService.getProducts();
  state.templates=await DataService.getSavedPosts();
  const restored=await restoreProject();
  renderCatalog();renderTemplates();renderAll();renderSummary();updateScaleUi();
  _autosaveOn=true;   /* включаем ПОСЛЕ восстановления, иначе пустой старт затрёт сохранённое */
  if(restored){
    const objects=state.devices.length+state.posts.length;
    const when=restored.savedAt?new Date(restored.savedAt).toLocaleString("ru-RU",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"";
    updateStatus(`Восстановлено: объектов ${objects}, комнат ${state.rooms.length}`);
    /* с задержкой: иначе всплывашку затирают тосты, которые могли уйти в очередь при старте */
    setTimeout(()=>toast(restored.planTooBig
      ?"Проект восстановлен, но план не поместился — загрузите его заново"
      :`Проект восстановлен${when?" от "+when:""}`),120);
  }
}
function renderCatalog(filter=""){
  const standalone=state.products.filter(x=>["standalone","mechanism"].includes(x.kind)&&x.active&&x.name.toLowerCase().includes(filter.toLowerCase()));
  $("catalogCount").textContent=standalone.length;
  $("catalog").innerHTML=standalone.map(p=>`<div class="catalog-item">
    <div class="catalog-symbol">${productPicture(p,{label:p.name})}</div><div><strong>${esc(p.name)}</strong><small>${productMoney(p)} / ${esc(p.unit)}</small></div>
    <button class="add-btn" data-add-product="${p.id}">+</button></div>`).join("");
  bindProductPictureFallbacks($("catalog"));
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
    <div class="library-icons">${t.mechanismIds.map(id=>`<i>${productPicture(product(id),{label:product(id)?.name})}</i>`).join("")}</div>
    <div class="library-actions"><button class="place" data-place-template="${t.id}">Разместить</button><button data-edit-template="${t.id}">✎</button><button data-delete-template="${t.id}">×</button></div>
  </div>`).join("");
  bindProductPictureFallbacks(list);
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
  const svg=$("roomsSvg");if(svg)svg.innerHTML="";
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
    const el=document.createElement("div");
    el.className="room-label "+(sel?"selected":"");
    el.style.left=r.x+"px";el.style.top=r.y+"px";
    el.innerHTML=`<span class="room-title">${esc(r.name)}</span>${areaText?`<small>${esc(areaText)}</small>`:""}<span class="room-object-count">${count} объект.</span>`;
    el.onclick=e=>{e.stopPropagation();state.tool==="delete"?removeEntity("room",r.id):selectEntity("room",r.id)};
    if(!isPoly)makeDraggable(el,r,"room");
    canvas.appendChild(el);
  });
}

/* ---- Ручная правка полигонов комнат (инструмент «Правка комнат») ---- */
const SVG_NS="http://www.w3.org/2000/svg";
function svgTitle(node,text){const t=document.createElementNS(SVG_NS,"title");t.textContent=text;node.appendChild(t)}
/* правка делает комнату «ручной»: она переживает повторное авто-определение */
function markRoomEdited(room){room.autoPolygon=false;room.edited=true}
function refreshRoomAfterEdit(room){
  const c=polygonCentroid(room.polygon);
  room.seedX=c.x;room.seedY=c.y;room.x=c.x-45;room.y=c.y-16;
  recalculateRoomAssignments();renderRooms();renderProperties();renderSummary();
  persistProject();
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
      e.preventDefault();e.stopPropagation();
      if(e.altKey){
        if(poly.length<=3){toast("В полигоне должно остаться не менее трёх вершин");return}
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
  const rect=canvas.getBoundingClientRect();
  const point=room.polygon[index];
  const move=e=>{
    point.x=Math.max(0,Math.min(canvas.clientWidth,(e.clientX-rect.left)/state.scale));
    point.y=Math.max(0,Math.min(canvas.clientHeight,(e.clientY-rect.top)/state.scale));
    if(pg)pg.setAttribute("points",room.polygon.map(p=>p.x+","+p.y).join(" "));
    if(handle){handle.setAttribute("cx",point.x);handle.setAttribute("cy",point.y)}
  };
  const up=()=>{
    document.removeEventListener("pointermove",move);document.removeEventListener("pointerup",up);
    markRoomEdited(room);refreshRoomAfterEdit(room);
    const m2=roomAreaM2(room);
    updateStatus(m2?`Контур изменён · площадь ${formatArea(m2)}`:"Контур комнаты изменён");
  };
  document.addEventListener("pointermove",move);document.addEventListener("pointerup",up);
  move(startEvent);
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

/* ---- Определение комнат (OpenCV.js, ленивая загрузка) ---- */
function polygonCentroid(poly){let x=0,y=0;poly.forEach(p=>{x+=p.x;y+=p.y});return{x:x/poly.length,y:y/poly.length}}
/* площадь замкнутого полигона в px² (формула шнурков) */
function polygonAreaPx(poly){
  if(!poly||poly.length<3)return 0;
  let sum=0;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++)sum+=poly[j].x*poly[i].y-poly[i].x*poly[j].y;
  return Math.abs(sum)/2;
}
/* площадь комнаты в м² — только если задан масштаб плана */
function roomAreaM2(room){
  if(!state.pxPerMeter||!room?.polygon||room.polygon.length<3)return null;
  return polygonAreaPx(room.polygon)/(state.pxPerMeter*state.pxPerMeter);
}
const formatArea=m2=>m2.toFixed(1).replace(".",",")+" м²";
function roomAutoAreaText(room){const m2=roomAreaM2(room);return m2?formatArea(m2):""}
/* что показывать: ручное значение приоритетнее авторасчёта */
function roomDisplayArea(room){return room.area?.trim()?room.area.trim():roomAutoAreaText(room)}
function pointInPolygon(x,y,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const xi=poly[i].x,yi=poly[i].y,xj=poly[j].x,yj=poly[j].y;if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))inside=!inside}return inside}
let _cvPromise=null;
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
  showTraceProgress(true,"Загрузка модуля распознавания");
  try{
    await loadOpenCv();
    showTraceProgress(true,"Определение комнат");
    await new Promise(r=>setTimeout(r,40));
    const res=EPRoomSeg.segment(img);
    const cw=canvas.clientWidth,ch=canvas.clientHeight;
    /* вручную поправленные контуры (autoPolygon=false) сохраняются */
    state.rooms=state.rooms.filter(r=>!r.autoPolygon);
    const kept=state.rooms.length;
    /* нумеруем дальше существующих, чтобы имена не дублировались */
    let next=state.rooms.reduce((max,r)=>{const m=/^Комната\s+(\d+)$/.exec(r.name||"");return m?Math.max(max,Number(m[1])):max},0);
    res.rooms.forEach(rm=>{
      const poly=EPRoomSeg.mapPolygon(rm.polygon,res,cw,ch);
      const c=polygonCentroid(poly);
      state.rooms.push({id:uid("room_"),name:"Комната "+(++next),area:"",polygon:poly,autoPolygon:true,seedX:c.x,seedY:c.y,x:c.x-45,y:c.y-16});
    });
    recalculateRoomAssignments();renderAll();renderProperties();renderSummary();
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
  showTraceProgress(true,"Распознавание плана","Загрузка модели (~100 МБ при первом запуске)…");
  try{
    const res=await EPFloorplanML.segmentRooms(img,{
      onProgress:msg=>showTraceProgress(true,"Распознавание плана",msg||"Анализ чертежа…")
    });
    const cw=canvas.clientWidth,ch=canvas.clientHeight;
    /* вручную поправленные контуры сохраняем, как и в OpenCV-режиме */
    state.rooms=state.rooms.filter(r=>!r.autoPolygon);
    const kept=state.rooms.length;
    let next=state.rooms.reduce((max,r)=>{const m=/^Комната\s+(\d+)$/.exec(r.name||"");return m?Math.max(max,Number(m[1])):max},0);
    res.rooms.forEach(rm=>{
      const poly=EPFloorplanML.mapPolygon(rm.polygon,res,cw,ch);
      const c=polygonCentroid(poly);
      state.rooms.push({id:uid("room_"),name:"Комната "+(++next),area:"",polygon:poly,autoPolygon:true,seedX:c.x,seedY:c.y,x:c.x-45,y:c.y-16});
    });
    recalculateRoomAssignments();renderAll();renderProperties();renderSummary();
    showTraceProgress(false);
    toast(res.rooms.length?`Найдено комнат: ${res.rooms.length}`:"Комнаты не найдены");
    updateStatus(kept
      ?`Комнат определено: ${res.rooms.length} · сохранено ручных контуров: ${kept}`
      :`Комнат определено: ${res.rooms.length}`);
  }catch(e){console.error(e);showTraceProgress(false);toast(e.message||"Не удалось определить комнаты")}
}

/* ---- Масштаб плана в реальных единицах (px/м) ---- */
function renderScaleRuler(){
  const svg=$("scaleSvg");if(!svg)return;
  svg.innerHTML="";
  const pts=state.scalePoints;
  /* точка, уже поставленная в режиме измерения */
  if(state.tool==="scale"&&pts.length===1){
    const dot=document.createElementNS(SVG_NS,"circle");
    dot.setAttribute("cx",pts[0].x);dot.setAttribute("cy",pts[0].y);dot.setAttribute("r",4);
    dot.setAttribute("class","scale-dot");svg.appendChild(dot);
    return;
  }
  const seg=state.scaleSegment;
  if(!seg)return;
  const line=document.createElementNS(SVG_NS,"line");
  line.setAttribute("x1",seg.a.x);line.setAttribute("y1",seg.a.y);
  line.setAttribute("x2",seg.b.x);line.setAttribute("y2",seg.b.y);
  line.setAttribute("class","scale-line");svg.appendChild(line);
  /* засечки на концах, перпендикулярно отрезку */
  const dx=seg.b.x-seg.a.x,dy=seg.b.y-seg.a.y,len=Math.hypot(dx,dy)||1;
  const nx=-dy/len*6,ny=dx/len*6;
  [seg.a,seg.b].forEach(p=>{
    const cap=document.createElementNS(SVG_NS,"line");
    cap.setAttribute("x1",p.x-nx);cap.setAttribute("y1",p.y-ny);
    cap.setAttribute("x2",p.x+nx);cap.setAttribute("y2",p.y+ny);
    cap.setAttribute("class","scale-cap");svg.appendChild(cap);
  });
  const label=document.createElementNS(SVG_NS,"text");
  label.setAttribute("x",(seg.a.x+seg.b.x)/2);label.setAttribute("y",(seg.a.y+seg.b.y)/2-9);
  label.setAttribute("text-anchor","middle");label.setAttribute("class","scale-text");
  label.textContent=`${String(seg.meters).replace(".",",")} м`;
  svg.appendChild(label);
}
function updateScaleUi(){
  const hint=$("scaleHint"),btn=$("scaleBtn"),clear=$("clearScaleBtn");
  if(state.pxPerMeter){
    hint.textContent=`1 м = ${state.pxPerMeter.toFixed(1)} px · площадь комнат считается в м²`;
    hint.classList.add("is-set");btn.textContent="Задать масштаб заново";clear.hidden=false;
  }else{
    hint.textContent="Масштаб не задан — площадь считается в пикселях";
    hint.classList.remove("is-set");btn.textContent="Задать масштаб";clear.hidden=true;
  }
  renderScaleRuler();
}
let scaleResolve=null;
function askScaleLength(pixels){
  $("scaleSegmentInfo").textContent=`Длина отрезка на холсте: ${Math.round(pixels)} px. Укажите, скольким метрам он соответствует.`;
  $("scaleModal").classList.add("open");
  setTimeout(()=>{const input=$("scaleLengthInput");input.focus();input.select()},0);
  return new Promise(resolve=>{scaleResolve=resolve});
}
function finishScaleInput(meters){
  if(!scaleResolve)return;
  const resolve=scaleResolve;scaleResolve=null;
  $("scaleModal").classList.remove("open");resolve(meters);
}
async function addScalePoint(x,y){
  state.scalePoints.push({x,y});
  if(state.scalePoints.length===1){
    renderScaleRuler();
    updateStatus("Отметьте вторую точку эталонного отрезка");
    return;
  }
  const [a,b]=state.scalePoints;
  state.scalePoints=[];
  const pixels=Math.hypot(b.x-a.x,b.y-a.y);
  if(pixels<12){renderScaleRuler();toast("Отрезок слишком короткий — отметьте точки дальше друг от друга");return}
  const meters=await askScaleLength(pixels);
  if(!meters){renderScaleRuler();setTool("select");updateStatus("Задание масштаба отменено");return}
  state.pxPerMeter=pixels/meters;
  state.scaleSegment={a,b,meters};
  setTool("select");
  updateScaleUi();renderRooms();renderProperties();
  persistProject();
  toast(`Масштаб задан: 1 м = ${state.pxPerMeter.toFixed(1)} px`);
  updateStatus(`Масштаб задан · площади комнат пересчитаны`);
}
function clearScale(){
  state.pxPerMeter=null;state.scaleSegment=null;state.scalePoints=[];
  updateScaleUi();renderRooms();renderProperties();
  persistProject();
  toast("Масштаб сброшен");
}

/* ---- Авторазметка плана нейросетью (детекция стен/дверей/окон) ---- */
const ANNOT_STYLE={
  "Wall":{color:"#1e5fd0",ru:"Стены"},
  "Curtain Wall":{color:"#0f9b9b",ru:"Витражные стены"},
  "Window":{color:"#17b3d6",ru:"Окна"},
  "Door":{color:"#e23b3b",ru:"Двери"},
  "Sliding Door":{color:"#f08a24",ru:"Раздв. двери"},
  "Column":{color:"#8b46c8",ru:"Колонны"},
  "Stair Case":{color:"#2fa050",ru:"Лестницы"},
  "Railing":{color:"#a9702f",ru:"Ограждения"},
  "Dimension":{color:"#9aa7b4",ru:"Размеры",hidden:true}
};
function mapBoxToCanvas(box,natW,natH,cw,ch){
  const disp=Math.min(cw/natW,ch/natH),dispW=natW*disp,dispH=natH*disp,offX=(cw-dispW)/2,offY=(ch-dispH)/2;
  return {x:offX+box[0]/natW*dispW,y:offY+box[1]/natH*dispH,w:(box[2]-box[0])/natW*dispW,h:(box[3]-box[1])/natH*dispH};
}
function clearAnnotations(){
  const svg=$("detectSvg");if(svg)svg.innerHTML="";
  const lg=$("detectLegend");if(lg){lg.hidden=true;lg.innerHTML=""}
  $("clearAnnotateBtn").hidden=true;
  state.detections=null;
}
function renderAnnotations(){
  const svg=$("detectSvg");if(!svg)return;svg.innerHTML="";
  if(!state.detections||!state.detections.list.length)return;
  const {list,natW,natH}=state.detections;
  const cw=canvas.clientWidth,ch=canvas.clientHeight,counts={};
  list.forEach(d=>{
    const st=ANNOT_STYLE[d.name]||{color:"#20b040"};
    counts[d.name]=(counts[d.name]||0)+1;
    if(st.hidden)return;
    const m=mapBoxToCanvas(d.box,natW,natH,cw,ch);
    const r=document.createElementNS("http://www.w3.org/2000/svg","rect");
    r.setAttribute("x",m.x);r.setAttribute("y",m.y);r.setAttribute("width",Math.max(1,m.w));r.setAttribute("height",Math.max(1,m.h));
    r.setAttribute("class","detect-box");r.setAttribute("stroke",st.color);r.setAttribute("fill",st.color);
    svg.appendChild(r);
  });
  const lg=$("detectLegend");
  lg.innerHTML=Object.keys(counts).sort((a,b)=>counts[b]-counts[a]).map(name=>{
    const st=ANNOT_STYLE[name]||{color:"#20b040",ru:name};
    const dim=st.hidden?' style="opacity:.5"':'';
    return `<span class="lg-item"${dim}><span class="lg-swatch" style="background:${st.color}"></span>${esc(st.ru||name)} <span class="lg-count">${counts[name]}</span></span>`;
  }).join("");
  lg.hidden=false;
}
async function annotatePlan(){
  const img=$("planImage");
  if(!state.planLoaded||!img.naturalWidth){toast("Сначала загрузите план");return}
  const btn=$("annotateBtn");btn.disabled=true;
  showTraceProgress(true,"Распознавание (нейросеть)","Подготовка модели…");
  try{
    await EPFloorplanML.ensureReady({onProgress:msg=>showTraceProgress(true,"Распознавание (нейросеть)",msg)});
    showTraceProgress(true,"Распознавание (нейросеть)","Анализ плана…");
    await new Promise(r=>setTimeout(r,40));
    const res=await EPFloorplanML.detect(img,{conf:0.22,onProgress:msg=>showTraceProgress(true,"Распознавание (нейросеть)",msg)});
    state.detections={list:res.detections,natW:res.natW,natH:res.natH};
    renderAnnotations();
    $("clearAnnotateBtn").hidden=false;
    showTraceProgress(false);
    const shown=res.detections.filter(d=>!(ANNOT_STYLE[d.name]||{}).hidden).length;
    toast(shown?`Распознано элементов: ${shown} (${EPFloorplanML.backend||"—"})`:"Элементы не распознаны");
    updateStatus(`Распознано элементов: ${shown}`);
  }catch(e){console.error(e);showTraceProgress(false);toast(e.message||"Не удалось распознать план")}
  finally{btn.disabled=false}
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
  const poly=state.rooms.find(r=>r.polygon&&r.polygon.length>2&&pointInPolygon(x,y,r.polygon));
  if(poly)return poly;
  const gridRooms=state.rooms.filter(r=>!(r.polygon&&r.polygon.length>2));
  if(!gridRooms.length)return null;
  map=map||buildSpaceComponents();
  const target=componentAt(map,x,y);
  if(target<0)return null;
  for(const room of gridRooms){
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
  const polyRooms=state.rooms.filter(r=>r.polygon&&r.polygon.length>2);
  const gridRooms=state.rooms.filter(r=>!(r.polygon&&r.polygon.length>2));
  let map=null;
  if(gridRooms.length){
    map=buildSpaceComponents();
    gridRooms.forEach(r=>{if(r.seedX==null){r.seedX=r.x+55;r.seedY=r.y+18}r.componentId=componentAt(map,r.seedX,r.seedY)});
  }
  [...state.devices,...state.posts].forEach(obj=>{
    const cx=obj.x+12,cy=obj.y+12;
    let room=polyRooms.find(r=>pointInPolygon(cx,cy,r.polygon));
    if(!room&&map){const component=componentAt(map,cx,cy);room=gridRooms.find(r=>r.componentId===component)}
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
  scheduleSave();   /* renderAll идёт после каждой правки состояния — точка автосохранения */
}
function showHover(kind,obj,e){
  if(kind==="device"){
    const p=product(obj.productId);
    hover.innerHTML=`<h4>${esc(p.name)}</h4><dl><dt>Артикул</dt><dd>${esc(p.code)}</dd><dt>Цена</dt><dd>${productMoney(p)}</dd><dt>Высота</dt><dd>${esc(obj.height||"не указана")}</dd></dl>`;
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
    <label>Цена<input value="${productMoney(p)}" disabled></label>
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
    const isPoly=r.polygon&&r.polygon.length>2;
    const autoArea=roomAutoAreaText(r);
    const areaHint=!isPoly?"Контур не определён — площадь задаётся вручную"
      :state.pxPerMeter?`Расчёт по контуру: ${autoArea}`
      :`Задайте масштаб плана, чтобы получить м². Сейчас контур: ${Math.round(polygonAreaPx(r.polygon)).toLocaleString("ru-RU")} px²`;
    props.innerHTML=`<label>Название комнаты<input id="roomName" value="${esc(r.name)}" autocomplete="off"></label>
    <label>Площадь<input id="roomArea" value="${esc(r.area||"")}" placeholder="${esc(autoArea||"Например, 18,6 м²")}" autocomplete="off"></label>
    <small class="prop-hint">${esc(areaHint)}${r.area?.trim()?" · сейчас показано ручное значение":""}</small>
    ${isPoly?`<div class="prop-hint-row"><span>Вершин контура: <b>${r.polygon.length}</b>${r.edited?" · контур правился вручную":""}</span>
      <button class="link-btn" id="editRoomPolygon">Править контур</button></div>`:""}
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
      persistProject();
    };
    $("saveRoomProps").onclick=saveRoom;
    const editPolygonBtn=$("editRoomPolygon");
    if(editPolygonBtn)editPolygonBtn.onclick=()=>setTool("vertex");
    ["roomName","roomArea"].forEach(field=>{
      $(field).onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();saveRoom()}};
      $(field).onblur=saveRoom;
    });
  }
}
/* ЕДИНСТВЕННЫЙ источник истины по смете (PLAN 2.4). И панель «Стоимость проекта», и
   коммерческое предложение считают только через него. Раньше формулы были скопированы
   в оба места и успели разойтись: панель пережила отсутствующий в каталоге товар,
   а КП на нём падало.
   Товар может отсутствовать штатно — проект восстановлен из хранилища, а прайс с тех
   пор перезалили. Такая позиция остаётся в смете с нулевой ценой и явной пометкой,
   чтобы её было видно, а не молча потерять. */
function buildEstimate(){
  const lines=[],missing=[];
  state.devices.forEach(d=>{
    const p=product(d.productId);
    if(!p)missing.push(d.productId);
    lines.push({
      key:p?"d"+p.id:"d?"+d.productId,
      name:p?p.name:`Товар не найден (арт. ${d.productId})`,
      composition:p?p.code:`артикул ${d.productId} отсутствует в каталоге`,
      price:p?.price||0
    });
  });
  state.posts.forEach(po=>{
    lines.push({
      key:"p"+po.name,
      name:po.name,
      composition:[frameProduct(po.frameId)?.name,`${po.mechanismIds.length} подрозетн.`,
        ...po.mechanismIds.map(id=>product(id)?.name)].filter(Boolean).join(", "),
      price:postCost(po)
    });
  });
  const groups=new Map();
  lines.forEach(l=>{
    const g=groups.get(l.key)||{name:l.name,composition:l.composition,count:0,sum:0};
    g.count++;g.sum+=l.price;groups.set(l.key,g);
  });
  const equipment=lines.reduce((s,l)=>s+l.price,0);
  const materials=equipment*EP_DATA.settings.materialsPercent/100;
  const work=equipment*EP_DATA.settings.workPercent/100;
  return {groups:[...groups.values()],equipment,materials,work,total:equipment+materials+work,missing};
}
function renderSummary(){
  const est=buildEstimate();
  $("equipmentTotal").textContent=money(est.equipment);$("materialsTotal").textContent=money(est.materials);
  $("workTotal").textContent=money(est.work);$("grandTotal").textContent=money(est.total);
  $("objectCount").textContent=state.devices.length+state.posts.length;
  $("specList").innerHTML=est.groups.length
    ?est.groups.map(g=>`<div class="spec-item"><div><strong>${esc(g.name)}</strong><span>${g.count} шт.</span></div><b>${money(g.sum)}</b></div>`).join("")
    :'<div class="library-empty">Проект пока пуст</div>';
  updateStatus();
}

function openPostBuilder({templateId=null,placedId=null}={}){
  state.builder.editingTemplateId=templateId;state.builder.editingPlacedId=placedId;
  let src;
  if(placedId){src=state.posts.find(x=>x.id===placedId);$("postModalTitle").textContent="Редактирование поста на плане"}
  else if(templateId){src=state.templates.find(x=>x.id===templateId);$("postModalTitle").textContent="Редактирование шаблона поста"}
  else{
    const defaultFrame=byKind("frame").find(frame=>frameSlotCount(frame)===3)||byKind("frame")[0];
    src={name:defaultPostName(3),frameId:defaultFrame?.id,mechanismIds:[]};
    $("postModalTitle").textContent="Новый электрический пост";
  }
  const sourceMechanismIds=Array.isArray(src.mechanismIds)?src.mechanismIds:[];
  const capacity=frameSlotCount(frameProduct(src.frameId))||Math.max(1,Math.min(5,mechanismModulesTotal(sourceMechanismIds)||3));
  $("postName").value=src.name;$("postSlotCount").value=String(capacity);state.builder.mechanismIds=[...sourceMechanismIds];
  $("postFrameSelect").dataset.preferredFrameId=String(src.frameId??"");
  renderBuilder();$("postModal").classList.add("open");
}
function renderBuilder(){
  const count=Number($("postSlotCount").value),allMechanisms=byKind("mechanism");
  const frameSelect=$("postFrameSelect"),allFrames=byKind("frame");
  const matchingFrames=allFrames.filter(frame=>frameSlotCount(frame)===count);
  const frames=matchingFrames.length?matchingFrames:allFrames;
  const preferredFrameId=Number(frameSelect.value||frameSelect.dataset.preferredFrameId);
  const selectedFrameId=frames.some(frame=>Number(frame.id)===preferredFrameId)?preferredFrameId:frames[0]?.id;
  frameSelect.innerHTML=frames.length
    ?frameOptions(frames,selectedFrameId)
    :'<option value="">Рамки не загружены</option>';
  frameSelect.value=selectedFrameId==null?"":String(selectedFrameId);
  delete frameSelect.dataset.preferredFrameId;
  const selectedFrame=frameProduct(frameSelect.value);
  const mechs=compatibleMechanisms(selectedFrame,allMechanisms);
  state.builder.mechanismIds=fitMechanismIds(state.builder.mechanismIds,mechs,count);
  const occupied=mechanismModulesTotal(state.builder.mechanismIds);
  const remaining=Math.max(0,count-occupied);
  const frameImage=productImage(selectedFrame,{detail:true});
  const opening=frameOpening(selectedFrame,count);
  $("postPreview").innerHTML=`<div class="preview-assembly" style="--preview-slots:${count}">
    <div class="preview-frame-caption"><span>Рамка</span><strong>${esc(selectedFrame?`[${selectedFrame.code}] ${selectedFrame.name}`:"не выбрана")}</strong></div>
    <div class="preview-frame-stage${frameImage?" has-image":""}" style="--opening-left:${opening.left}%;--opening-top:${opening.top}%;--opening-width:${opening.width}%;--opening-height:${opening.height}%;--frame-aspect:${opening.aspect}">
      ${frameImage?`<img src="${esc(frameImage)}" alt="${esc(selectedFrame?.name||"Выбранная рамка")}" loading="eager" decoding="async" data-frame-picture>`:""}
      <div class="preview-frame-fallback" aria-hidden="true"></div>
      <div class="preview-opening" aria-label="Собранный электрический пост">${state.builder.mechanismIds.map(id=>{
        const item=product(id);
        return productPicture(item,{className:"preview-installed-product",label:item?.name,eager:true,style:`--module-span:${mechanismSpan(item)}`});
      }).join("")}${Array.from({length:remaining},()=>'<span class="preview-empty-module" aria-label="Свободный модуль"></span>').join("")}</div>
    </div>
  </div>`;
  bindProductPictureFallbacks($("postPreview"));
  $("postPreview").querySelectorAll("img[data-frame-picture]").forEach(img=>{
    img.addEventListener("error",()=>img.closest(".preview-frame-stage")?.classList.remove("has-image"),{once:true});
  });
  $("builderCapacity").innerHTML=`<div class="builder-capacity-head"><strong>Заполнение рамки</strong><span>Занято ${occupied} из ${count} · ${remaining?`свободно ${moduleWord(remaining)}`:"рамка заполнена"}</span></div>
    <div class="module-meter" style="--module-count:${count}" aria-label="Занято ${occupied} из ${count} модулей">${Array.from({length:count},(_,index)=>`<span class="${index<occupied?"occupied":""}"></span>`).join("")}</div>`;
  let moduleCursor=1;
  const selectedRows=state.builder.mechanismIds.map((id,index)=>{
    const item=product(id),span=mechanismSpan(item),start=moduleCursor,end=start+span-1;
    moduleCursor=end+1;
    return `<div class="builder-slot"><div class="slot-number" title="${moduleWord(span)}">${start===end?start:`${start}–${end}`}</div><select data-builder-slot="${index}" aria-label="Элемент в модулях ${start}${start===end?"":`–${end}`}">${mechs.length
      ?mechanismOptions(mechs,id,{maxSpan:count,emptyLabel:"Убрать элемент"})
      :'<option value="">Механизмы не загружены</option>'}</select></div>`;
  }).join("");
  const addRow=remaining?`<div class="builder-slot is-empty"><div class="slot-number">+</div><select data-builder-slot="${state.builder.mechanismIds.length}" aria-label="Добавить элемент в свободные модули">${mechs.length
    ?mechanismOptions(mechs,null,{maxSpan:remaining,emptyLabel:`Выберите элемент · свободно ${moduleWord(remaining)}`})
    :'<option value="">Механизмы не загружены</option>'}</select></div>`:"";
  $("builderSlots").innerHTML=selectedRows+addRow;
  document.querySelectorAll("[data-builder-slot]").forEach(s=>s.onchange=()=>{
    const index=Number(s.dataset.builderSlot);
    if(!s.value)state.builder.mechanismIds.splice(index,1);
    else if(index>=state.builder.mechanismIds.length)state.builder.mechanismIds.push(Number(s.value));
    else{
      state.builder.mechanismIds[index]=Number(s.value);
      state.builder.mechanismIds=fitMechanismIdsPreserving(state.builder.mechanismIds,mechs,count,index);
    }
    renderBuilder();
  });
  $("savePost").disabled=remaining!==0;
}
function changePostSlotCount(){
  const currentName=$("postName").value.trim();
  if(/^Пост (?:на )?\d+ (?:мест|место|места|модул)/i.test(currentName))$("postName").value=defaultPostName(Number($("postSlotCount").value));
  renderBuilder();
}
async function savePostBuilder(){
  const frameCapacity=frameSlotCount(frameProduct($("postFrameSelect").value))||Number($("postSlotCount").value);
  if(mechanismModulesTotal(state.builder.mechanismIds)!==frameCapacity){toast("Заполните все модули рамки");return}
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

function projectSnapshot(){
  const img=$("planImage");
  return{name:"Проект электроснабжения",savedAt:new Date().toISOString(),
    devices:state.devices,posts:state.posts,rooms:state.rooms,walls:state.walls,autoWalls:state.autoWalls,
    pxPerMeter:state.pxPerMeter,scaleSegment:state.scaleSegment,
    /* план кладём data-URL'ом — иначе после перезагрузки объекты повиснут над пустым холстом */
    plan:(state.planLoaded&&/^data:/.test(img.src||""))?img.src:null,
    planLabel:state.planLabel||""};
}
/* План может не влезть в LocalStorage (лимит ~5 МБ). Тогда сохраняем всё остальное,
   пометив, что чертёж придётся загрузить заново, — это лучше полной потери работы. */
function persistProject(){
  const snap=projectSnapshot();
  try{ProjectStore.save(snap);return "full"}
  catch(e){
    try{ProjectStore.save(Object.assign({},snap,{plan:null,planTooBig:true}));return "noplan"}
    catch(e2){console.error(e2);return null}
  }
}
/* var, а не let: init() вызывается выше по файлу, чем это объявление, и обращение
   к let-переменной из scheduleSave() падало бы в temporal dead zone, обрывая renderAll */
var _saveTimer=null,_autosaveOn=false;
/* автосохранение с задержкой: правки идут пачками (перетаскивание, правка вершин) */
function scheduleSave(){
  if(!_autosaveOn)return;
  clearTimeout(_saveTimer);
  _saveTimer=setTimeout(persistProject,700);
}
function saveProject(){
  const r=persistProject();
  toast(r==="full"?"Проект сохранён в браузере"
    :r?"Проект сохранён, но план не поместился — загрузите его заново после перезагрузки"
    :"Не удалось сохранить: в браузере кончилось место");
}
async function restoreProject(){
  let p=null;
  try{p=ProjectStore.load()}catch(e){return null}
  if(!p)return null;
  state.devices=p.devices||[];state.posts=p.posts||[];state.rooms=p.rooms||[];
  state.walls=p.walls||[];state.autoWalls=p.autoWalls||[];
  state.pxPerMeter=p.pxPerMeter??null;state.scaleSegment=p.scaleSegment||null;
  state.planLabel=p.planLabel||"";
  if(p.plan){
    await new Promise(done=>{
      const img=$("planImage");
      img.onload=()=>{img.onload=null;img.onerror=null;done()};
      img.onerror=()=>{img.onload=null;img.onerror=null;done()};
      img.src=p.plan;
    });
    if($("planImage").naturalWidth){
      state.planLoaded=true;
      ["autoTraceBtn","detectRoomsBtn","detectRoomsMlBtn","annotateBtn"].forEach(id=>{$(id).disabled=false});
      $("planStatusDot").classList.add("ready");
    }
  }
  if(state.planLoaded||state.devices.length||state.posts.length||state.rooms.length||state.walls.length)markCanvasUsed();
  return p;
}
function generateCommercialOffer(){
  /* считаем тем же buildEstimate, что и панель справа: раньше здесь лежала копия
     формул, и на товаре, которого нет в каталоге, КП падало на p.name у undefined */
  const est=buildEstimate();
  const {equipment,materials,work,total}=est;
  /* позиции группируются, поэтому в КП появилось честное «Кол.» вместо жёсткой единицы */
  const rows=est.groups.map(g=>({name:g.name,composition:g.composition,qty:g.count,
    price:g.count?g.sum/g.count:0,sum:g.sum}));
  if(est.missing.length)toast(`Внимание: позиций без товара в каталоге — ${est.missing.length}`);
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


function showTraceProgress(show,message="Анализ линий плана",detail="Поиск горизонтальных и вертикальных стен…"){
  let overlay=document.getElementById("traceProgress");
  if(show){
    if(!overlay){
      overlay=document.createElement("div");overlay.id="traceProgress";overlay.className="trace-progress";
      canvas.appendChild(overlay);
    }
    overlay.innerHTML=`<div class="trace-progress-box"><strong>${esc(message)}</strong><span>${esc(detail)}</span></div>`;
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
  else if(state.tool==="scale"){addScalePoint(x,y);return}
  else if(state.tool==="wall")addWallPoint(e);
  else if(state.tool==="vertex"){
    /* в режиме правки клик по контуру выбирает комнату, показывая её вершины */
    const room=state.rooms.find(r=>r.polygon&&r.polygon.length>2&&pointInPolygon(x,y,r.polygon));
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
    const room=state.rooms.find(r=>r.polygon&&r.polygon.length>2&&pointInPolygon(x,y,r.polygon));
    if(room&&state.tool==="delete"){removeEntity("room",room.id)}
    else if(room){selectEntity("room",room.id)}
    else{state.selected=null;renderAll();renderProperties()}
  }
};
document.querySelectorAll("[data-tool]").forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
$("catalogSearch").oninput=e=>renderCatalog(e.target.value);
$("newPostBtn").onclick=()=>openPostBuilder();
$("closePostModal").onclick=$("cancelPost").onclick=closePostBuilder;
$("savePost").onclick=savePostBuilder;$("postSlotCount").onchange=changePostSlotCount;$("postFrameSelect").onchange=renderBuilder;
$("postModal").onclick=e=>{if(e.target===$("postModal"))closePostBuilder()};
$("zoomIn").onclick=()=>{state.scale=Math.min(2,state.scale+.1);canvas.style.transform=`scale(${state.scale})`;updateStatus(`Масштаб ${Math.round(state.scale*100)}%`)};
$("zoomOut").onclick=()=>{state.scale=Math.max(.5,state.scale-.1);canvas.style.transform=`scale(${state.scale})`;updateStatus(`Масштаб ${Math.round(state.scale*100)}%`)};
$("zoomReset").onclick=()=>{state.scale=1;canvas.style.transform="scale(1)";updateStatus()};

const uploadHelp=$("planUploadHelp"),uploadPopover=$("planUploadPopover");
function setUploadPopover(open,returnFocus=false){
  uploadPopover.hidden=!open;uploadHelp.setAttribute("aria-expanded",String(open));
  if(open)$("closePlanUploadPopover").focus();else if(returnFocus)uploadHelp.focus();
}
uploadHelp.onclick=e=>{e.stopPropagation();setUploadPopover(uploadPopover.hidden)};
$("closePlanUploadPopover").onclick=()=>setUploadPopover(false,true);
document.addEventListener("click",e=>{if(!uploadPopover.hidden&&!e.target.closest(".upload-control"))setUploadPopover(false)});

let pdfPageResolve=null;
function finishPdfPageSelection(page){
  if(!pdfPageResolve)return;
  const resolve=pdfPageResolve;pdfPageResolve=null;
  $("pdfPageModal").classList.remove("open");resolve(page);
}
function choosePdfPage(total,fileName){
  if(pdfPageResolve)finishPdfPageSelection(null);
  $("pdfPageFileName").textContent=`${fileName} · страниц: ${total}`;
  $("pdfPageSelect").innerHTML=Array.from({length:total},(_,index)=>`<option value="${index+1}">Страница ${index+1}</option>`).join("");
  $("pdfPageModal").classList.add("open");
  setTimeout(()=>$("pdfPageSelect").focus(),0);
  return new Promise(resolve=>{pdfPageResolve=resolve});
}
$("confirmPdfPage").onclick=()=>finishPdfPageSelection(Number($("pdfPageSelect").value));
$("cancelPdfPage").onclick=$("closePdfPageModal").onclick=()=>finishPdfPageSelection(null);
$("pdfPageModal").onclick=e=>{if(e.target===$("pdfPageModal"))finishPdfPageSelection(null)};

function applyImportedPlan(file,result){
  return new Promise((resolve,reject)=>{
    const img=$("planImage"),previousSrc=img.src;
    img.onload=()=>{
      img.onload=null;img.onerror=null;
      state.planLoaded=true;state.planLabel=file.name;
      $("autoTraceBtn").disabled=false;$("detectRoomsBtn").disabled=false;$("detectRoomsMlBtn").disabled=false;$("annotateBtn").disabled=false;clearAnnotations();
      $("planStatusDot").classList.add("ready");markCanvasUsed();
      const suffix=result.detail?` · ${result.detail}`:"";
      updateStatus(`План загружен (${result.format}): ${file.name}${suffix}`);resolve();
    };
    img.onerror=()=>{
      img.onload=null;img.onerror=null;
      if(previousSrc)img.src=previousSrc;
      reject(new Error("Не удалось отобразить импортированный план"));
    };
    img.src=result.dataUrl;
  });
}

$("planUpload").onchange=async e=>{
  const input=e.target,f=input.files[0];if(!f)return;
  const ext=f.name.split(".").pop()?.toLowerCase()||"";
  const format=ext.toUpperCase();
  setUploadPopover(false);
  showTraceProgress(true,`Импорт ${format}`,ext==="pdf"?"Чтение страниц документа…":ext==="dwg"?"Преобразование DWG и подготовка геометрии…":ext==="dxf"?"Разбор векторной геометрии…":"Подготовка изображения…");
  try{
    if(!window.EPPlanImport)throw new Error("Модуль импорта не загружен");
    const result=await EPPlanImport.importFile(f,{selectPdfPage:choosePdfPage});
    showTraceProgress(true,`Импорт ${format}`,"Подготовка изображения плана…");
    await applyImportedPlan(f,result);
    toast(`${result.format} импортирован`);
  }catch(error){
    if(error?.name!=="AbortError"){
      console.error(error);toast(error?.message||"Не удалось импортировать план");
    }
  }finally{
    showTraceProgress(false);input.value="";
  }
};
$("clearBtn").onclick=()=>{state.devices=[];state.posts=[];state.rooms=[];state.walls=[];state.autoWalls=[];state.wallPoints=[];state.selected=null;clearAnnotations();renderAll();renderProperties();renderSummary()};
$("autoTraceBtn").onclick=autoTracePlan;
$("detectRoomsBtn").onclick=detectRooms;
$("detectRoomsMlBtn").onclick=detectRoomsML;
$("annotateBtn").onclick=annotatePlan;
$("clearAnnotateBtn").onclick=()=>{clearAnnotations();toast("Разметка убрана")};
$("scaleBtn").onclick=()=>{setTool("scale");toast("Проведите отрезок известной длины: два клика по плану")};
$("clearScaleBtn").onclick=clearScale;
$("confirmScale").onclick=()=>{
  const meters=Number(String($("scaleLengthInput").value).replace(",","."));
  if(!(meters>0)){toast("Введите длину больше нуля");return}
  finishScaleInput(meters);
};
$("cancelScale").onclick=$("closeScaleModal").onclick=()=>finishScaleInput(null);
$("scaleModal").onclick=e=>{if(e.target===$("scaleModal"))finishScaleInput(null)};
$("scaleLengthInput").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();$("confirmScale").click()}};
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
document.onkeydown=e=>{
  if(e.key==="Escape"){
    if($("pdfPageModal").classList.contains("open")){finishPdfPageSelection(null);return}
    if(!uploadPopover.hidden)setUploadPopover(false,true);
    setTool("select");closePostBuilder();
  }
  if(e.key==="Enter"&&state.tool==="wall")setTool("select");
  if(e.key==="Delete"&&state.selected)removeEntity(state.selected.kind,state.selected.id);
};
init().catch(e=>console.error("init failed:",e));
})();
