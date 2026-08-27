(() => {
"use strict";
const $=id=>document.getElementById(id);
const canvas=$("canvas"), hover=$("hoverCard"), props=$("properties");
const canvasScroll=document.querySelector(".canvas-scroll");
const state={
  /* Вид холста (бесконечное поле): scale — масштаб, panX/panY — смещение вида в
     пикселях экрана. Мировые координаты объектов = прежние координаты холста, поэтому
     старые проекты открываются без пересчёта. Экран↔мир — через EPViewport. */
  tool:"select",scale:1,panX:0,panY:0,pending:null,selected:null,
  products:[],templates:[],devices:[],posts:[],rooms:[],walls:[],autoWalls:[],wallPoints:[],planLoaded:false,
  /* линии разметки помещений — отдельный слой (решение владельца): не смешиваются
     ни с ручными стенами (walls), ни с автообрисовкой (autoWalls). roomLinePoints —
     точки текущей рисуемой цепочки, roomLineIds — id её сегментов (для Backspace),
     roomLineHover — подсвеченная точка притяжения курсора. */
  roomLines:[],roomLinePoints:[],roomLineIds:[],roomLineHover:null,
  /* режимы разметки (решение владельца): переключатели в панели инструментов.
     orthoMode — рисовать строго ортогонально (Shift временно инвертирует режим);
     snapGrid  — привязывать точки к узлам сетки (магниты к линиям работают всегда);
     gridStep  — шаг сетки, px: влияет и на привязку, и на фоновую сетку холста. */
  orthoMode:true,snapGrid:true,gridStep:EPConfig.gridDefault,
  planVisibility:"show",   /* видимость подложки: show | dim | hide (Этап 1) */
  pxPerMeter:null,scaleSegment:null,scalePoints:[],
  builder:{editingTemplateId:null,editingPlacedId:null,mechanismIds:[]}
};
const uid=p=>p+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
/* Все суммы в приложении хранятся в базовой валюте каталога (евро прайса VIMAR).
   money() отвечает только за ПРЕДСТАВЛЕНИЕ: если выбраны рубли и известен курс,
   сумма пересчитывается на лету. Сами цены товаров не переписываются никогда —
   иначе повторная конвертация после смены курса накапливала бы ошибку. */
const baseCurrency=()=>EP_DATA.settings.currency||"EUR";
function displayCurrency(){
  const d=EP_DATA.settings.displayCurrency||baseCurrency();
  /* без курса показывать рубли нечестно — откатываемся на евро */
  return (d==="RUB"&&!(EP_DATA.settings.eurRate>0))?baseCurrency():d;
}
function displayRate(){
  if(displayCurrency()===baseCurrency())return 1;
  /* пересчёт в рубли идёт по ЭФФЕКТИВНОМУ курсу (курс ЦБ + надбавка) — единая
     формула в EPRates.effectiveRate, а не копия здесь. ||1 — страховка на случай
     нулевого курса (displayCurrency сюда с RUB без курса не пустит). */
  return EPRates.effectiveRate(EP_DATA.settings)||1;
}
const money=(n)=>new Intl.NumberFormat("ru-RU",{
  style:"currency",currency:displayCurrency(),minimumFractionDigits:2,maximumFractionDigits:2
}).format((Number(n)||0)*displayRate());
/* Курс печатаем с 4 знаками, но дробную часть — через ЗАПЯТУЮ: в русском документе
   «92,5000 ₽», а не «92.5000 ₽» (интерфейс и КП идут заказчику). */
const rubRate=n=>(Number(n)||0).toFixed(4).replace(".",",");
const product=id=>state.products.find(x=>Number(x.id)===Number(id));
const byKind=kind=>state.products.filter(x=>x.kind===kind&&x.active);
/* Разумный фолбэк-подрозетник (для хранения socketBoxProductId и крайних случаев):
   самая универсальная коробка. Логика — в чистом EPPostFit (js/postfit.js). */
const socketBox=()=>EPPostFit.socketBox(byKind("socket_box"));
const frameProduct=id=>product(id);
/* Чистая доменная логика каталога (модули/серии/совместимость/рамки/картинки)
   вынесена в js/catalog.js (EPCatalog) — PLAN 2.1; берём её алиасами. Accessor'ы
   product/byKind над state и генерация HTML/DOM остаются в этом файле. */
const {moduleWord,mechanismSpan,productSeries,compatibleMechanisms,frameSlotCount,defaultPostName,productImage,frameOpening,frameOpenings,moduleFace}=EPCatalog;
const productMoney=item=>money(item?.price);
const productOptionLabel=item=>`[${item?.code||"без артикула"}] ${item?.name||"Без названия"} — ${productMoney(item)}`;
const mechanismModulesTotal=ids=>ids.reduce((sum,id)=>sum+mechanismSpan(product(id)),0);
const mechanismOptionLabel=item=>`${productOptionLabel(item)} · ${moduleWord(mechanismSpan(item))}`;
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
/* Логика сборки поста (стоимость, упаковка механизмов в рамку) вынесена в
   js/posts.js (EPPosts) — PLAN 2.1; здесь тонкие обёртки с доступом к каталогу,
   как buildEstimate() над EPEstimate. */
const fitMechanismIds=(ids,items,capacity)=>EPPosts.fitMechanismIds(ids,items,capacity,{product,mechanismSpan});
const fitMechanismIdsPreserving=(ids,items,capacity,pinnedIndex)=>EPPosts.fitMechanismIdsPreserving(ids,items,capacity,pinnedIndex,{product,mechanismSpan});
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
/* Кастомный список EPPicker (js/picker.js) заменяет нативные <select> накладки и слотов
   на строки с миниатюрой товара. Виджет — надстройка над скрытым <select> (носитель
   значения), поэтому логику выбора менять не пришлось. Данные строки готовит оркестратор:
   money()/esc()/productPicture() остаются здесь (конвенции 3–5), виджет лишь размещает
   готовые куски. meta возвращает null для пустой опции («Убрать элемент»/плейсхолдер) —
   её виджет рисует простой строкой без картинки. */
function pickerMeta(value){
  const item=product(value);
  if(!item)return null;
  return{
    picture:productPicture(item,{label:item.name}),
    code:item.code||"без артикула",
    name:item.name||"Без названия",
    priceText:productMoney(item),
    metaText:item.kind==="mechanism"?moduleWord(mechanismSpan(item)):"",
    searchText:`${item.code||""} ${item.name||""}`
  };
}
/* opts = {emptyContext, resolveMissing} — доменный контекст пустого поиска (что искали
   и как объяснить отсеянный артикул). Виджет про каталог не знает, поэтому строки и
   действие готовит оркестратор (renderBuilder передаёт свой контекст на каждый select). */
function enhancePicker(selectEl,opts={}){
  EPPicker.enhance(selectEl,{
    esc,meta:pickerMeta,
    searchPlaceholder:"Поиск по артикулу или названию",
    onRender:root=>bindProductPictureFallbacks(root),
    emptyContext:opts.emptyContext,
    resolveMissing:opts.resolveMissing
  });
}
/* Точное совпадение с артикулом (регистронезависимо, без крайних пробелов). Точность
   важна: подсказку про отсеянный товар показываем ТОЛЬКО на полный артикул, иначе она
   лезла бы на любой частичный ввод названия. null — если такого артикула нет вовсе. */
function findByExactCode(items,query){
  const q=String(query==null?"":query).trim().toLocaleLowerCase("ru-RU");
  if(!q)return null;
  return items.find(it=>String(it.code||"").trim().toLocaleLowerCase("ru-RU")===q)||null;
}
/* Пустой поиск накладки: артикул есть в каталоге, но отсеян фильтром по числу модулей.
   Возвращаем описание и действие «переключить» — меняем число модулей конструктора и
   выбираем эту накладку. null — если артикула нет или он и так подходит под текущее
   число модулей (тогда обычный фильтр его и так показал бы). */
function resolveMissingFrame(query,currentCount,frameSelect){
  const item=findByExactCode(byKind("frame"),query);
  if(!item)return null;
  const target=frameSlotCount(item);
  if(target===currentCount)return null;   /* уже подходит под текущий размер — подсказка не нужна */
  return{
    lead:"Артикул есть в каталоге, но скрыт фильтром по числу модулей.",
    code:item.code||"без артикула",
    name:item.name||"Без названия",
    note:target?moduleWord(target):"число модулей не указано",
    actionLabel:target?`Переключить на ${moduleWord(target)}`:null,
    onAction:target?()=>{
      $("postSlotCount").value=String(target);
      frameSelect.dataset.preferredFrameId=String(item.id);   /* renderBuilder выберет именно её */
      changePostSlotCount();
      toast(`Число модулей: ${target} · выбрана накладка ${item.code||""}`.trim());
    }:null
  };
}
/* Пустой поиск механизма: артикул есть в каталоге, но не подходит к текущей накладке.
   Объясняем ПРИЧИНУ (другая серия / шире свободного места), а не молчим. Действия не
   даём: смена серии или размера накладки — отдельный осознанный выбор пользователя. */
function resolveMissingMechanism(query,selectedFrame){
  const all=byKind("mechanism");
  const item=findByExactCode(all,query);
  if(!item)return null;
  /* тот же совместимый набор, что показывается в слотах: если механизма в нём нет —
     он несовместим по серии; если есть, но не виден — он шире свободного места */
  const seriesOk=compatibleMechanisms(selectedFrame,all).includes(item);
  const reason=seriesOk
    ?`занимает ${moduleWord(mechanismSpan(item))} — это шире свободного места в накладке.`
    :`другая серия: механизм серии «${productSeries(item).join(", ")||"—"}», а накладка серии «${productSeries(selectedFrame).join(", ")||"—"}».`;
  return{
    lead:"Артикул есть в каталоге, но не подходит к текущей накладке.",
    code:item.code||"без артикула",
    name:item.name||"Без названия",
    note:moduleWord(mechanismSpan(item)),
    reason
  };
}

function toast(text){const e=$("toast");e.textContent=text;e.classList.add("show");setTimeout(()=>e.classList.remove("show"),1800)}
/* Подбор коробки/суппорта — тонкие обёртки над чистым EPPostFit (js/postfit.js):
   даём ему активные коробки/суппорты из state, ёмкость накладки и тип стены проекта.
   findBox — точная коробка (стандарт + тип стены + типоразмер); fallbackBox —
   стандартно-совместимый фолбэк (тип стены как приоритет); оба не противоречат стандарту.
   Хелперы модуля берут стандарт накладки из поля товара (проставлено при загрузке
   каталога из колонки standard прайса) и серию через productSeries. */
const wantedWall=()=>EP_DATA.settings.wallType||"solid";
const findBox=({frame,standard,modules,wallType}={})=>EPPostFit.findBox({
  boxes:byKind("socket_box"),frame,standard,modules,frameModules:frameSlotCount(frame),wantedWall:wallType||wantedWall()});
const fallbackBox=({frame,standard,modules,wallType}={})=>EPPostFit.fallbackBox({
  boxes:byKind("socket_box"),frame,standard,modules,frameModules:frameSlotCount(frame),wantedWall:wallType||wantedWall()});
/* box — подобранная коробка поста: по правилу заказчика её артикул (71001/71701) задаёт
   тип суппорта (602/603). Пробрасываем в чистый EPPostFit.findSupport. */
const findSupport=({frame,standard,modules,box}={})=>EPPostFit.findSupport({
  supports:byKind("support"),frame,standard,modules,frameModules:frameSlotCount(frame),seriesOf:productSeries,box});
/* resolveSupport — тот же подбор, но с признаком «артикул подобран нами, заказчиком не
   подтверждён» (assumed): состав поста несёт его дальше в смету, лист монтажника и панель
   состава, где он печатается пометкой «(предположительно)». */
const resolveSupport=({frame,standard,modules,box}={})=>EPPostFit.resolveSupport({
  supports:byKind("support"),frame,standard,modules,frameModules:frameSlotCount(frame),seriesOf:productSeries,box});
/* Единый набор зависимостей для чистой логики поста (EPPosts): каталог, подбор
   суппорта/коробки (точный findBox + стандартно-совместимый фолбэк fallbackBox), признак
   «суппорт вообще не нужен» (крышки IP55 по номенклатуре монтируются без планки) и тип
   стены проекта. */
const postDeps=()=>({product,frameProduct,socketBox,mechanismSpan,findBox,fallbackBox,findSupport,resolveSupport,
  supportRequired:EPPostFit.supportRequired,wallType:EP_DATA.settings.wallType});
const postCost=p=>EPPosts.postCost(p,postDeps());
const postComposition=p=>EPPosts.postComposition(p,postDeps());
/* Единое изображение собранного поста (EPPostImage): собираем spec из каталога — накладка,
   ряды/посты (EPPosts.distributePosts показывает разделение на посты и импосты, включая
   двухрядные «4+4»), в ячейках — только признаки функциональной группы (categoryId + символ)
   для значка на клавише. ФОТО МЕХАНИЗМОВ ВНУТРЬ СБОРКИ НЕ КЛАДЁМ (владелец дважды отверг
   коллаж; ориентир — каталожные сборки VIMAR): EPPostImage рисует ровные клавиши в цвет
   накладки. ПОДЛОЖКА — фотография накладки (правка владельца 01.08): передаём её imageUrl,
   стандарт (DE/FR → деление окна на посты) и окно в % (EPCatalog.frameOpening). Нет фото —
   EPPostImage сам рисует схему-фолбэк. Одна функция кормит превью конструктора, карточку
   библиотеки, подсказку на плане, раскладку КП и лист монтажника (в т.ч. печать — инлайн-стили). */
function assembledPostSpec(post,{size="md"}={}){
  const frame=frameProduct(post.frameId);
  const dist=EPPosts.distributePosts(post.mechanismIds||[],frame,{product,mechanismSpan});
  const rowsMap=new Map();   /* группируем посты по физическому ряду накладки */
  dist.posts.forEach(p=>{
    if(!rowsMap.has(p.row))rowsMap.set(p.row,[]);
    let occ=0;const cells=[];
    p.mechanismIds.forEach(id=>{
      const item=product(id),span=mechanismSpan(item);
      const start=occ+1,end=occ+span;
      /* Модуль показываем НАСТОЯЩИМ фото механизма, обрезанным по лицу: imageUrl — детальное фото,
         face — лицевой прямоугольник в % фото (moduleFace, снят детектором). Нет фото/лица →
         postImage рисует нарисованную клавишу-фолбэк, и тогда работают признаки функц. группы
         (categoryId + символ icon → значок pickIcon) и цвет клавиши: color — ЯВНЫЙ цвет, иначе
         цвет из name самого механизма (лицевая панель — отдельный товар: VIMAR даёт белую накладку
         с серебр. клавишами). */
      cells.push({span,imageUrl:productImage(item,{detail:true}),face:moduleFace(item),color:item?.properties?.color||item?.color||"",categoryId:item?.categoryId,icon:item?.icon,name:item?.name||"",num:start===end?String(start):`${start}–${end}`});
      occ+=span;
    });
    /* свободные модули поста — пустые ячейки с номером слота (место, а не поломка) */
    for(let i=occ;i<p.capacity;i++)cells.push({span:1,empty:true,num:String(i+1)});
    rowsMap.get(p.row).push({capacity:p.capacity,cells});
  });
  const rows=[...rowsMap.keys()].sort((a,b)=>a-b).map(r=>({posts:rowsMap.get(r)}));
  /* Накладка: ДЕТАЛЬНОЕ фото (detail:true — превью это квадратный кроп 100×100, в него влезает
     лишь средняя треть широкой накладки; заглушки no_photo отсеяны в productImage), стандарт,
     ИЗМЕРЕННЫЕ монтажные окна с фото (frameOpenings → mountRect/mountRects) и запасное окно-догадка
     (frameOpening) на случай, когда измерений нет. Нет фото — EPPostImage возьмёт цвет схемы-фолбэка
     из name (у рамок VIMAR цвет — в названии). */
  const count=frameSlotCount(frame)||dist.totalCapacity;
  const frameSpec=frame?{
    name:frame.name,code:frame.code,imageUrl:productImage(frame,{detail:true}),standard:frame.standard,
    opening:frameOpening(frame,count),windows:frameOpenings(frame,count)
  }:null;
  return {size,frame:frameSpec,rows};
}
const assembledPostHtml=(post,opts={})=>EPPostImage.buildHtml(assembledPostSpec(post,opts),{esc});
/* Размещённый пост опознаётся сквозным НОМЕРОМ (решение владельца 01.08): номер —
   основной идентификатор вместо имени. Номер закрепляется за постом при создании и не
   переиспользуется (удаление не сдвигает чужие номера), привести к 1..N — команда
   «Перенумеровать». Шаблоны в библиотеке остаются с именами — там номера смысла не имеют. */
const postNumberLabel=p=>`Пост № ${p&&p.number!=null?p.number:"—"}`;
function setTool(tool){
  state.tool=tool;state.pending=null;state.wallPoints=[];canvas.classList.remove("placing");
  /* выход из режима разметки сбрасывает незавершённую цепочку и подсветку */
  state.roomLinePoints=[];state.roomLineIds=[];state.roomLineHover=null;
  if(tool!=="scale")state.scalePoints=[];
  document.querySelectorAll("[data-tool]").forEach(b=>b.classList.toggle("active",b.dataset.tool===tool));
  canvas.classList.toggle("measuring",tool==="scale");
  canvas.classList.toggle("drawing",tool==="roomline");
  drawWalls();drawRoomLines();renderRooms();renderScaleRuler();updateStatus();
  if(tool==="roomline")updateStatus("Разметка: клик — точка · Shift — временно инвертировать ортогональность · клик по первой точке замыкает контур · Backspace — отмена точки");
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
  loadCachedRate();
  fillDocHeaderInputs();   /* реквизиты КП: заполнить поля (и дату «сегодня» на чистом старте) */
  renderCatalog();renderTemplates();renderAll();renderSummary();updateScaleUi();updateRateUi();applyPlanVisibility();
  applyGridStyle();syncMarkupControls();updateZoomUi();applyView();   /* сетка/переключатели/зум/вид — из state (в т.ч. восстановленного) */
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
  const standalone=state.products.filter(x=>["standalone","mechanism","accessory"].includes(x.kind)&&x.active&&x.name.toLowerCase().includes(filter.toLowerCase()));
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
  /* Миниатюра — то же собранное изделие, что в конструкторе (единая EPPostImage): рамка,
     разделение на посты/импосты и модули. Раньше здесь была россыпь иконок механизмов —
     по замечанию владельца «нет получившегося полного изображения рамки и модулей». */
  list.innerHTML=state.templates.map(t=>`<div class="library-card">
    <div class="library-title"><strong>${esc(t.name)}</strong><span>${t.mechanismIds.length} места</span></div>
    <div class="library-thumb">${assembledPostHtml(t,{size:"sm"})}</div>
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
  /* kind/id на узле — чтобы выделение и клавиатура находили этот элемент точечно,
     без пересоздания сцены (корневой дефект: renderAll на нажатии) */
  el.dataset.kind=kind;el.dataset.id=entity.id;
  el.style.left=entity.x+"px";el.style.top=entity.y+"px";
  if(kind==="device") el.textContent=product(entity.productId)?.icon||"?";
  /* метка поста = его сквозной номер (раньше рисовали «P» + число мест) — чтобы номер
     на плане совпадал с раскладкой постов, листом монтажника и КП */
  if(kind==="post")el.textContent=entity.number!=null?String(entity.number):"?";
  /* выделение/удаление/перенос — единый указательный обработчик (makeDraggable):
     клик и перенос разводятся порогом, сцена на нажатии не перерисовывается */
  el.onmouseenter=e=>showHover(kind,entity,e);el.onmousemove=positionHover;el.onmouseleave=hideHover;
  /* клик по объекту не должен доходить до canvas.onclick (иначе в режиме размещения
     из каталога он поставил бы ещё один объект поверх) — выделение уже в makeDraggable */
  el.onclick=e=>e.stopPropagation();
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
    el.dataset.kind="room";el.dataset.id=r.id;   /* для точечного выделения и подсветки drop-цели */
    el.innerHTML=`<span class="room-title">${esc(r.name)}</span>${areaText?`<small>${esc(areaText)}</small>`:""}<span class="room-object-count">${count} объект.</span>`;
    /* полигональную комнату подпись не двигает (контур отдельно) — только выделяет/удаляет
       кликом; подпись комнаты без контура тащится и выделяется единым обработчиком makeDraggable */
    if(isPoly)el.onclick=e=>{e.stopPropagation();state.tool==="delete"?removeEntity("room",r.id):selectEntity("room",r.id)};
    else{el.onclick=e=>e.stopPropagation();makeDraggable(el,r,"room")}   /* клик не должен доходить до canvas.onclick */
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
    /* без зажима по краям блока: поле бесконечное, вершину можно тащить куда угодно.
       rect снят на старте — холст во время правки вершины не панорамируется */
    point.x=(e.clientX-rect.left)/state.scale;
    point.y=(e.clientY-rect.top)/state.scale;
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

/* Всё, что делит пространство на связные области: автообрисовка, ручные стены и
   линии разметки помещений. Линии разметки участвуют в делении сразу (требование
   Этапа 2), поэтому нарисованная перегородка тут же меняет привязку оборудования.
   Точное построение полигонов помещений по этим линиям — задача Этапа 3. */
function allWalls(){
  return [...state.autoWalls,...state.walls,...state.roomLines];
}
function makeWall(a,b,auto){return {id:uid("wall_"),a:{x:a.x,y:a.y},b:{x:b.x,y:b.y},auto:!!auto}}
function selectWall(id){state.selected={kind:"wall",id};renderAll();renderProperties()}
function removeWall(id){
  state.walls=state.walls.filter(w=>w.id!==id);
  state.autoWalls=state.autoWalls.filter(w=>w.id!==id);
  if(state.selected?.kind==="wall")state.selected=null;
  recalculateRoomAssignments();renderAll();renderProperties();renderSummary();
}

/* ---- Определение комнат (OpenCV.js, ленивая загрузка) ----
   Чистая геометрия (полигоны, площади, флуд-фолл свободного пространства) вынесена
   в js/geometry.js (EPGeom) — см. PLAN 2.1; здесь берём её через алиасы, а привязка
   к state/DOM остаётся в этом файле. */
const {polygonCentroid,polygonAreaPx,pointInPolygon,componentAt}=EPGeom;
/* площадь комнаты в м² — только если задан масштаб плана */
function roomAreaM2(room){
  if(!state.pxPerMeter||!room?.polygon||room.polygon.length<3)return null;
  return polygonAreaPx(room.polygon)/(state.pxPerMeter*state.pxPerMeter);
}
const formatArea=m2=>m2.toFixed(1).replace(".",",")+" м²";
function roomAutoAreaText(room){const m2=roomAreaM2(room);return m2?formatArea(m2):""}
/* что показывать: ручное значение приоритетнее авторасчёта */
function roomDisplayArea(room){return room.area?.trim()?room.area.trim():roomAutoAreaText(room)}
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

/* ---- Курс евро: работа с сетью и кэшем вынесена в js/rates.js (EPRates),
   здесь остаётся только применение курса к настройкам и интерфейс ---- */
function applyRateEntry(entry){
  if(!entry)return null;
  EP_DATA.settings.eurRate=entry.rate;
  EP_DATA.settings.rateDate=entry.date;
  EP_DATA.settings.rateSource=entry.source;
  return entry;
}
function loadCachedRate(){return applyRateEntry(EPRates.loadCached())}
function updateRateUi(){
  const s=EP_DATA.settings,info=$("rateInfo");
  $("currencySelect").value=s.displayCurrency||"EUR";
  const rubMode=(s.displayCurrency==="RUB");
  $("rateBox").hidden=!rubMode;
  if(!info)return;
  if(s.eurRate>0){
    const d=s.rateDate?new Date(s.rateDate).toLocaleDateString("ru-RU"):"";
    const isManual=s.rateSource===EPRates.SRC_MANUAL;
    const pct=Number(s.rateSurchargePercent)||0;
    let txt=`1 € = ${rubRate(s.eurRate)} ₽ · ${s.rateSource||"вручную"}${d?" от "+d:""}`;
    /* показываем обе величины: официальный курс ЦБ и итоговый с надбавкой.
       Для ручного курса надбавка не применяется — сообщаем об этом явно, чтобы
       пользователь понимал, почему +% не влияет на пересчёт. textContent —
       экранирование не требуется (не innerHTML), значения свои. */
    if(!isManual&&pct>0)txt+=` + ${pct}% = ${rubRate(EPRates.effectiveRate(s))} ₽`;
    else if(isManual&&pct>0)txt+=` · надбавка +${pct}% к ручному курсу не применяется`;
    info.textContent=txt;
    info.classList.add("is-set");
    if(document.activeElement!==$("rateInput"))$("rateInput").value=s.eurRate;
  }else{
    info.textContent="Курс не загружен — нажмите «Курс ЦБ» или введите вручную";
    info.classList.remove("is-set");
  }
}
async function refreshRate(){
  const btn=$("rateRefreshBtn");
  btn.disabled=true;const prev=btn.textContent;btn.textContent="Загрузка…";
  try{
    const e=applyRateEntry(await EPRates.fetchFresh());
    updateRateUi();renderCatalog($("catalogSearch").value);renderSummary();renderTemplates();scheduleSave();
    toast(`Курс ЦБ РФ: 1 € = ${rubRate(e.rate)} ₽`);
  }catch(err){
    console.error(err);
    toast("Не удалось получить курс ЦБ РФ — введите вручную");
  }finally{btn.disabled=false;btn.textContent=prev}
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

/* Точки, задающие границы сетки свободного пространства: концы всех линий, центры и
   углы объектов, seed'ы и вершины комнат. Берём ТОЛЬКО реально нарисованное (без
   привязки к блоку) — топология областей между стенами зависит от самих стен, а не
   от пустого поля вокруг, поэтому привязка объектов к комнатам сохраняется. Подложку
   сюда НЕ включаем: пиксели чертежа на деление пространства не влияют. */
function spaceContentPoints(){
  const pts=[];
  allWalls().forEach(w=>{pts.push(w.a,w.b)});
  [...state.devices,...state.posts].forEach(o=>{pts.push({x:o.x,y:o.y},{x:o.x+24,y:o.y+24})});
  state.rooms.forEach(r=>{
    if(r.seedX!=null)pts.push({x:r.seedX,y:r.seedY});
    if(r.polygon)r.polygon.forEach(p=>pts.push(p));
  });
  return pts;
}
/* Радиус «засветки» ячейки стеной. Пока сетка обычной плотности (cell = spaceCell)
   отдаём прежние 7 px — поведение существующих проектов не меняется. Если же
   предохранитель УКРУПНИЛ cell (гигантское содержимое), радиус тянем до ~0.71·cell,
   иначе центры клеток окажутся дальше 7 px от стены и стена «протечёт», слив комнаты. */
function wallRadiusFor(cell){
  return cell>EPConfig.spaceCell?Math.max(EPConfig.wallCellRadius,cell*0.71):EPConfig.wallCellRadius;
}
/* строит карту связных «свободных» областей плана; сам флуд-фолл — в EPGeom.
   На бесконечном холсте размер берём НЕ по блоку, а по bounding box нарисованного
   (EPViewport.spaceGrid: запас + предохранитель на число клеток) — иначе сетка либо
   не накроет объекты за краем листа, либо разрастётся и подвесит интерфейс (пункт 6). */
function buildSpaceComponents(){
  const g=EPViewport.spaceGrid(EPViewport.bounds(spaceContentPoints()),
    {cell:EPConfig.spaceCell,margin:EPConfig.spaceMargin,maxCells:EPConfig.spaceMaxCells});
  return EPGeom.buildSpaceComponents(g.width,g.height,allWalls(),g.cell,wallRadiusFor(g.cell),g.originX,g.originY);
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
  state.posts.forEach(p=>{if(p.roomId===roomId)result.push({kind:"post",entity:p,name:postNumberLabel(p)})});
  return result;
}

function renderAll(){
  recalculateRoomAssignments();
  renderDevices();renderPosts();renderRooms();drawWalls();drawRoomLines();
  scheduleSave();   /* renderAll идёт после каждой правки состояния — точка автосохранения */
}
function showHover(kind,obj,e){
  if(kind==="device"){
    const p=product(obj.productId);
    hover.innerHTML=`<h4>${esc(p.name)}</h4><dl><dt>Артикул</dt><dd>${esc(p.code)}</dd><dt>Цена</dt><dd>${productMoney(p)}</dd><dt>Высота</dt><dd>${esc(obj.height||"не указана")}</dd></dl>`;
  }else{
    const frame=frameProduct(obj.frameId),comp=postComposition(obj),boxUnit=comp.box||comp.boxFallback;
    /* Коробки в подсказке: цена подобранной/фолбэк-коробки × число; если совместимой со
       стандартом коробки нет — честно «не подобрана», без цены (как в составе поста). */
    const boxCell=boxUnit?`${comp.boxCount} × ${money(boxUnit.price)}`:(comp.boxCount?`${comp.boxCount} шт. — не подобрана`:"—");
    /* Миниатюра собранного поста (та же EPPostImage, что в конструкторе) вместо простыни
       названий — сразу видно рамку, посты и импосты. */
    hover.innerHTML=`<h4>${esc(postNumberLabel(obj))}</h4><div class="hover-thumb">${assembledPostHtml(obj,{size:"sm"})}</div>
    <dl><dt>Накладка</dt><dd>${esc(frame?.name)}</dd><dt>Коробки</dt><dd>${boxCell}</dd><dt>Стоимость поста</dt><dd>${money(postCost(obj))}</dd></dl>`;
  }
  hover.classList.add("show");positionHover(e);
}
function positionHover(e){const r=canvas.getBoundingClientRect();hover.style.left=Math.min(canvas.clientWidth-280,(e.clientX-r.left)/state.scale+18)+"px";hover.style.top=Math.max(8,(e.clientY-r.top)/state.scale-20)+"px"}
function hideHover(){hover.classList.remove("show")}
/* PointerEvent есть у всех браузеров нижней границы проекта (Chrome 80/FF 72/Safari 13.4).
   Флаг нужен только для Safari ДО 13 (PLAN 5): там указательных событий нет, и перенос
   объекта идёт через mouse+touch. Различия сглаживает trackDrag — makeDraggable про
   конкретный ввод не знает. */
const HAS_POINTER=typeof window!=="undefined"&&"PointerEvent" in window;

/* Точечная синхронизация ВЫДЕЛЕНИЯ с DOM — без пересоздания объектов (корневой дефект:
   раньше любое выделение шло через renderAll, который сносил и заново создавал все
   иконки; узел под указателем оказывался вне документа, и перенос «не работал»).
   Переключаем классы на уже существующих узлах; слой стен перерисовываем отдельно
   (он рисуется инлайн-атрибутами по state.selected — это дёшево, не пересоздание сцены). */
function applySelectionClasses(){
  const sel=state.selected;
  const isSel=(kind,id)=>!!sel&&sel.kind===kind&&String(sel.id)===String(id);
  canvas.querySelectorAll(".plan-icon").forEach(el=>el.classList.toggle("selected",isSel(el.dataset.kind,el.dataset.id)));
  canvas.querySelectorAll(".room-label").forEach(el=>el.classList.toggle("selected",isSel("room",el.dataset.id)));
  const rsvg=$("roomsSvg");
  if(rsvg)rsvg.querySelectorAll(".room-poly").forEach(pg=>{
    /* editing (правка вершин) ставит renderRooms — его не трогаем, только selected */
    if(!pg.classList.contains("editing"))pg.classList.toggle("selected",isSel("room",pg.dataset.roomId));
  });
  drawWalls();   /* прежняя выделенная стена должна погаснуть; иконки/подписи не трогаются */
}
/* Тихий переход в инструмент «select» на время захвата объекта: меняет состояние и
   активную кнопку, НО не вызывает renderRooms (тот пересоздал бы подпись комнаты, которую
   мы, возможно, сейчас тащим). Слои превью-разметки/линейки перерисовываем — они узлы
   объектов не пересоздают. Возвращает true, если инструмент реально сменился. */
function ensureSelectTool(){
  if(state.tool==="select")return false;
  state.tool="select";state.pending=null;state.wallPoints=[];
  state.roomLinePoints=[];state.roomLineIds=[];state.roomLineHover=null;state.scalePoints=[];
  canvas.classList.remove("placing","measuring","drawing");
  document.querySelectorAll("[data-tool]").forEach(b=>b.classList.toggle("active",b.dataset.tool==="select"));
  drawWalls();drawRoomLines();renderScaleRuler();updateStatus();
  return true;
}
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
    const p=EPDrag.worldPosition({x:bx,y:by},{x:sx,y:sy},{x:clientX,y:clientY},state.scale);
    obj.x=p.x;obj.y=p.y;el.style.left=obj.x+"px";el.style.top=obj.y+"px";
    if(kind!=="room"){const room=getRoomForPoint(obj.x+12,obj.y+12,dragMap);setRoomDropHighlight(room?room.id:null)}
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
      recalculateRoomAssignments();renderRooms();renderSummary();
    }else{
      /* финальную привязку считаем свежей картой (updateObjectRoom): объект мог уехать за
         габарит превью-карты; она годится только для подсветки на лету, не для итога */
      const room=updateObjectRoom(obj);
      renderRooms();renderProperties();renderSummary();
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
/* Выделение объекта точечно: классы на существующих узлах + панель свойств. НЕ renderAll —
   иначе на каждый клик пересоздавались бы все иконки (см. applySelectionClasses). Выделение
   в снимок проекта не входит, поэтому автосохранение здесь не нужно. */
function selectEntity(kind,id){state.selected={kind,id};applySelectionClasses();renderProperties()}
/* Найти существующий узел объекта (для клавиатурного сдвига — двигаем узел, не пересоздаём). */
function findEntityNode(kind,id){
  let found=null;
  canvas.querySelectorAll(".plan-icon,.room-label").forEach(el=>{if(el.dataset.kind===kind&&el.dataset.id===String(id))found=el});
  return found;
}
/* Сдвиг выделенного объекта клавиатурой (PLAN 4): узел двигаем точечно, привязку к
   помещению и счётчики пересчитываем на каждом шаге (шаги дискретные — не жест, полная
   перерисовка комнат допустима). Полигональные комнаты стрелками не двигаем: у них своя
   правка вершин. Возвращает true, если что-то сдвинули (чтобы погасить прокрутку страницы). */
function moveSelectedBy(dx,dy){
  const sel=state.selected;if(!sel)return false;
  if(sel.kind==="device"||sel.kind==="post"){
    const obj=state[sel.kind==="device"?"devices":"posts"].find(x=>x.id===sel.id);if(!obj)return false;
    obj.x+=dx;obj.y+=dy;
    const node=findEntityNode(sel.kind,sel.id);if(node){node.style.left=obj.x+"px";node.style.top=obj.y+"px"}
    updateObjectRoom(obj);renderRooms();renderProperties();renderSummary();scheduleSave();
    return true;
  }
  if(sel.kind==="room"){
    const obj=state.rooms.find(x=>x.id===sel.id);if(!obj||(obj.polygon&&obj.polygon.length>2))return false;
    obj.x+=dx;obj.y+=dy;obj.seedX=obj.x+55;obj.seedY=obj.y+18;
    recalculateRoomAssignments();renderRooms();renderProperties();renderSummary();scheduleSave();
    return true;
  }
  return false;
}
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
    props.innerHTML=`<label>Пост<input value="${esc(postNumberLabel(p))}" disabled></label>
    <label>Комната<input value="${esc(room?.name||"Не назначена")}" disabled></label>
    <label>Механизмов / коробок<input value="${p.mechanismIds.length} / ${postComposition(p).boxCount}" disabled></label>
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
/* Сам расчёт вынесен в js/estimate.js (EPEstimate) — чистая функция без state и DOM,
   чтобы её можно было накрыть автотестами (PLAN 7.1). Здесь остаётся только
   подстановка зависимостей приложения. */
function buildEstimate(){
  return EPEstimate.build({
    devices:state.devices,posts:state.posts,
    product,frameProduct,postCost,postComposition,
    settings:EP_DATA.settings
  });
}
function renderSummary(){
  const est=buildEstimate();
  $("equipmentTotal").textContent=money(est.equipment);$("materialsTotal").textContent=money(est.materials);
  $("workTotal").textContent=money(est.work);$("grandTotal").textContent=money(est.total);
  /* скидка и НДС показываются, только когда заданы — чтобы не мозолить нулями */
  $("discountRow").hidden=!est.discount;
  $("discountTotal").textContent="−"+money(est.discount)+` (${est.discountPercent}%)`;
  $("vatRow").hidden=!est.vat;
  $("vatTotal").textContent=money(est.vat)+` (${est.vatPercent}%)`;
  $("objectCount").textContent=state.devices.length+state.posts.length;
  $("specList").innerHTML=est.groups.length
    ?est.groups.map(g=>`<div class="spec-item"><div><strong>${esc(g.name)}</strong><span>${g.count} ${esc(g.unit)}</span></div><b>${money(g.sum)}</b></div>`).join("")
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
  const capacity=frameSlotCount(frameProduct(src.frameId))||Math.max(1,Math.min(8,mechanismModulesTotal(sourceMechanismIds)||3));
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
  /* накладка: <select> → кастомный список с миниатюрами. Пустой поиск объясняет, среди
     чего искали, и предлагает переключить размер, если артикул отсеян фильтром модулей */
  enhancePicker(frameSelect,{
    emptyContext:matchingFrames.length?`накладок на ${moduleWord(count)}`:"загруженных накладок",
    resolveMissing:q=>resolveMissingFrame(q,count,frameSelect)
  });
  const selectedFrame=frameProduct(frameSelect.value);
  const mechs=compatibleMechanisms(selectedFrame,allMechanisms);
  state.builder.mechanismIds=fitMechanismIds(state.builder.mechanismIds,mechs,count);
  const occupied=mechanismModulesTotal(state.builder.mechanismIds);
  const remaining=Math.max(0,count-occupied);
  /* Распределение механизмов по постам накладки (EPPosts.distributePosts): даёт превью с
     импостами/рядами, ограничивает ширину подбираемого механизма ёмкостью ПОСТА (не всей
     накладки) и ловит несовместимые сочетания — механизм шире поста или «размазанный»
     через импост. maxPostCap — самый широкий пост; addMax — наибольшее свободное место
     среди ВСЕХ постов: механизм такой ширины ещё влезает хоть в какой-то пост (напр. 2М
     идёт во второй пост немецкой 2+2, когда в первом занят один модуль). */
  const dist=EPPosts.distributePosts(state.builder.mechanismIds,selectedFrame,{product,mechanismSpan});
  /* Авто-раскладка: когда набор укладывается по постам без разрыва через импост, принимаем
     ПОРЯДОК из распределения (dist.posts, пост за постом) — так многомодульный механизм встаёт
     в слоты ВНУТРИ своего поста, а не верхом на импост, и нумерация слотов совпадает с превью
     и листом монтажника. Раньше порядок слотов не менялся, и 2М-механизм мог оказаться на
     границе постов, давая ложную «Несовместимое сочетание». Реордер идемпотентен (перепаковка
     уже упакованного даёт тот же порядок), поэтому цикла ре-рендеров не создаёт. */
  if(dist.valid){
    const packedOrder=dist.posts.reduce((all,p)=>all.concat(p.mechanismIds),[]);
    if(packedOrder.length===state.builder.mechanismIds.length)state.builder.mechanismIds=packedOrder;
  }
  const maxPostCap=dist.maxCapacity||count;
  const addMax=EPPosts.maxFreeSpan(dist);
  /* Единое изображение собранного поста (крупно) — та же EPPostImage, что в библиотеке,
     подсказке, КП и листе монтажника. */
  $("postPreview").innerHTML=assembledPostHtml({frameId:selectedFrame&&selectedFrame.id,mechanismIds:state.builder.mechanismIds},{size:"lg"});
  $("builderCapacity").innerHTML=`<div class="builder-capacity-head"><strong>Заполнение рамки</strong><span>Занято ${occupied} из ${count} · ${remaining?`свободно ${moduleWord(remaining)}`:"рамка заполнена"}</span></div>
    <div class="module-meter" style="--module-count:${count}" aria-label="Занято ${occupied} из ${count} модулей">${Array.from({length:count},(_,index)=>`<span class="${index<occupied?"occupied":""}"></span>`).join("")}</div>`;
  /* Нумерация модулей слота (одномодульный «2», двухмодульный «2–3») — общая чистая
     функция EPPosts.moduleLayout: тот же код считает позиции для листа монтажника,
     чтобы номера в конструкторе и в документе не разошлись. */
  const layout=EPPosts.moduleLayout(state.builder.mechanismIds,{product,mechanismSpan});
  const selectedRows=layout.map((slot,index)=>
    `<div class="builder-slot"><div class="slot-number" title="${moduleWord(slot.span)}">${slot.label}</div><select data-builder-slot="${index}" aria-label="Элемент в модулях ${slot.start}${slot.start===slot.end?"":`–${slot.end}`}">${mechs.length
      ?mechanismOptions(mechs,slot.id,{maxSpan:maxPostCap,emptyLabel:"Убрать элемент"})
      :'<option value="">Механизмы не загружены</option>'}</select></div>`
  ).join("");
  const addRow=remaining?`<div class="builder-slot is-empty"><div class="slot-number">+</div><select data-builder-slot="${state.builder.mechanismIds.length}" aria-label="Добавить элемент в свободные модули">${mechs.length
    ?mechanismOptions(mechs,null,{maxSpan:addMax,emptyLabel:`Выберите элемент · свободно ${moduleWord(remaining)}`})
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
  /* слоты механизмов: те же скрытые <select>, поверх — кастомный список с миниатюрами.
     Пустой поиск объясняет причину отсева (другая серия / шире свободного места). */
  document.querySelectorAll("[data-builder-slot]").forEach(sel=>enhancePicker(sel,{
    emptyContext:selectedFrame?"механизмов, совместимых с этой накладкой":"механизмов",
    resolveMissing:q=>resolveMissingMechanism(q,selectedFrame)
  }));
  renderBuilderComposition(selectedFrame,builderErrorHtml(dist));
  /* Сохранять можно, только когда сборка физически собирается (никакой механизм не шире
     поста и не «размазан» через импост) и все посты заполнены целиком. */
  $("savePost").disabled=!(dist.valid&&dist.full);
}
/* Видимый состав поста (PLAN — задача по конструктору): суппорт, монтажная коробка
   с числом по стандарту накладки и типу стены, итоговая цена. Всё, что попадает в
   разметку, — через esc(); суммы — через money(). Стандарт/подбор считает EPPosts. */
const WALL_STEP_LABEL={solid:"кирпич / бетон / сплошная",hollow:"полая стена / ГКЛ"};
const STANDARD_LABEL={IT:"итальянский · одна коробка на сборку",IT_ROUND:"итальянский · круглая коробка",DE:"немецко-французский · коробка на каждый пост",FR:"французский 57 мм · коробка на каждый пост",US:"американский",BOTH:"универсальный · одна коробка на накладку",UNKNOWN:"не подтверждён"};
/* Родительный падеж стандарта для пояснений «нет коробки для … стандарта». */
const STANDARD_GENITIVE={IT:"итальянского",IT_ROUND:"итальянского (круглая коробка)",DE:"немецко-французского",FR:"французского 57 мм",US:"американского",BOTH:"универсального",UNKNOWN:"не подтверждённого"};
/* Ошибка несовместимости в конструкторе (требование заказчика 3.2: показывать ПРИЧИНУ,
   не блокировать молча). Причины — из EPPosts.distributePosts: механизм шире поста либо
   сборка не делится по постам без разрыва через импост. */
function builderErrorHtml(dist){
  if(!dist||dist.valid)return"";
  const parts=[];
  dist.errors.filter(e=>e.type==="too-wide").forEach(e=>
    parts.push(`Механизм «${esc(e.item?.name||"—")}» занимает ${esc(moduleWord(e.span))} — это шире поста накладки (${esc(moduleWord(e.maxCapacity))}); в такую накладку он не встанет.`));
  if(dist.errors.some(e=>e.type==="overflow"))
    parts.push(`Механизмы не делятся по постам без разрыва через импост. Каждый пост (по ${esc(moduleWord(dist.maxCapacity))}) заполняется целиком — переставьте механизмы или смените накладку.`);
  if(!parts.length)return"";
  return `<div class="builder-error" role="alert"><strong>Несовместимое сочетание</strong>${parts.map(p=>`<span>${p}</span>`).join("")}</div>`;
}
function renderBuilderComposition(selectedFrame,errorHtml=""){
  const wall=EP_DATA.settings.wallType||"solid";
  document.querySelectorAll("#postWallType .wall-type-option").forEach(b=>{
    const on=b.dataset.wall===wall;
    b.classList.toggle("active",on);
    b.setAttribute("aria-checked",on?"true":"false");
  });
  const host=$("builderComposition");if(!host)return;
  if(!selectedFrame){host.innerHTML=errorHtml||"";return;}
  const post={frameId:Number($("postFrameSelect").value),mechanismIds:state.builder.mechanismIds};
  const comp=postComposition(post);
  /* Суппорт, три исхода: не нужен по номенклатуре → «не требуется»; подобран → количество +
     артикул с ценой; не нашёлся → «не подобран» + отдельная приглушённая строка с причиной
     (никакой подстановки чужого суппорта). Первые два — норма, третий — пробел. Количество
     показываем так же, как у коробки ниже («N × имя · цена»): у немецко-французской
     накладки планок столько же, сколько постов, и пользователь должен видеть это в
     составе, а не только в итоговой сумме. Пустой пост (supportCount 0) — прочерк,
     как и у коробки: пока механизмов нет, обвязка не нужна. */
  const frameSeriesLabel=productSeries(selectedFrame).join(", ")||"этой серии";
  const frameMods=frameSlotCount(selectedFrame)||comp.modulesTotal||0;
  const supportRow=comp.supportNotRequired
    /* «Не требуется» — не пробел подбора, а свойство изделия (крышки IP55 садятся прямо
       в коробку): показываем обычной строкой, без пометки is-missing. */
    ? `<div class="composition-row"><span>Суппорт (планка для модулей)</span><b>не требуется</b></div>`
      +`<div class="composition-note">по номенклатуре изделие монтируется в коробку без суппорта</div>`
    : !comp.support
    ? `<div class="composition-row is-missing"><span>Суппорт (планка для модулей)</span><b>не подобран</b></div>`
      +`<div class="composition-note">подходящего суппорта серии «${esc(frameSeriesLabel)}» на ${(comp.frame&&Number(comp.frame.boxModularity))||frameMods} мод. нет в каталоге</div>`
    : !comp.supportCount
      ? `<div class="composition-row"><span>Суппорт (планка для модулей)</span><b>—</b></div>`
      /* Подобран, но заказчиком НЕ подтверждён (comp.supportAssumed): в номенклатуре у накладки
         монтажное правило есть, а артикула планки под него нет — мы взяли планку той же серии
         и модульности. Пометка «(предположительно)» стоит вплотную к артикулу и повторяет
         формулировку сметы и листа монтажника; приглушённой строкой ниже — почему так.
         Это НЕ пробел подбора (is-missing не ставим): деталь в расчёте есть, под вопросом
         только её артикул. */
      : `<div class="composition-row"><span>Суппорт (планка для модулей)</span><b>${comp.supportCount} × ${esc(comp.support.name)}${comp.supportAssumed?" (предположительно)":""} · ${money(comp.support.price)}</b></div>`
        +(comp.supportAssumed?`<div class="composition-note">артикул не подтверждён заказчиком: в номенклатуре для этой накладки указан только тип коробки и суппорта, без артикула — планка подобрана по серии и модульности</div>`:"");
  /* Коробка: количество и подпись разнесены. Точная (comp.box) → артикул с ценой.
     Стандартно-совместимый фолбэк (comp.boxFallback) → «подобрана по стандарту» + причина
     и цена приглушённой строкой. Ничего совместимого со стандартом → «не подобрана» БЕЗ
     цены (в стоимость коробка не входит), чтобы фолбэк не противоречил стандарту. */
  let boxRow;
  if(!comp.boxCount){
    boxRow=`<div class="composition-row"><span>Монтажная коробка · ${esc(WALL_STEP_LABEL[wall])}</span><b>—</b></div>`;
  }else if(comp.box){
    boxRow=`<div class="composition-row"><span>Монтажная коробка · ${esc(WALL_STEP_LABEL[wall])}</span><b>${comp.boxCount} × ${esc(comp.box.name)} · ${money(comp.box.price)}</b></div>`;
  }else if(comp.boxFallback){
    boxRow=`<div class="composition-row"><span>Монтажная коробка · ${esc(WALL_STEP_LABEL[wall])} · ${comp.boxCount} шт.</span><b>подобрана по стандарту</b></div>`
      +`<div class="composition-note">точная коробка под тип стены не найдена — в цене ${esc(comp.boxFallback.name)} · ${money(comp.boxFallback.price)}</div>`;
  }else{
    boxRow=`<div class="composition-row is-missing"><span>Монтажная коробка · ${esc(WALL_STEP_LABEL[wall])} · ${comp.boxCount} шт.</span><b>не подобрана</b></div>`
      +`<div class="composition-note">подходящей коробки для ${esc(STANDARD_GENITIVE[comp.standard]||"выбранного")} стандарта нет в каталоге</div>`;
  }
  const note=comp.approximate
    ? `<div class="composition-note">Стандарт накладки не распознан — состав приблизительный (считаем по правилу «одна коробка на накладку»).</div>`
    : "";
  host.innerHTML=`${errorHtml||""}<div class="composition-head"><strong>Состав поста</strong><span>Стандарт: ${esc(STANDARD_LABEL[comp.standard]||comp.standard)}</span></div>
    ${supportRow}${boxRow}
    <div class="composition-row total"><span>Стоимость поста</span><b>${money(postCost(post))}</b></div>${note}`;
}
function changePostSlotCount(){
  const currentName=$("postName").value.trim();
  if(/^Пост (?:на )?\d+ (?:мест|место|места|модул)/i.test(currentName))$("postName").value=defaultPostName(Number($("postSlotCount").value));
  renderBuilder();
}
async function savePostBuilder(){
  /* Проверяем сборку ПО ПОСТАМ: механизм не должен быть шире поста или «размазан» через
     импост (dist.valid), и все посты должны быть заполнены целиком (dist.full). Для
     итальянской однорядной накладки это ровно прежнее «заполните все модули». */
  const dist=EPPosts.distributePosts(state.builder.mechanismIds,frameProduct($("postFrameSelect").value),{product,mechanismSpan});
  if(!dist.valid){toast("Несовместимое сочетание — см. причину над составом поста");return}
  if(!dist.full){toast("Заполните все модули рамки");return}
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
    /* номер закрепляется за постом при создании = максимум существующих + 1 (стабилен,
       удаление не сдвигает чужие номера) */
    created={id:uid("post_"),templateId:t.id,x:x-12,y:y-12,number:EPPosts.nextPostNumber(state.posts),name:t.name,frameId:t.frameId,mechanismIds:[...t.mechanismIds],socketBoxProductId:t.socketBoxProductId,roomId:null};
    state.posts.push(created);
  }
  updateObjectRoom(created);
  const room=state.rooms.find(r=>r.id===created.roomId);
  setTool("select");renderAll();renderSummary();toast(room?`Объект добавлен в комнату «${room.name}»`:"Объект размещён вне комнаты");
}
/* Шаг сетки теперь настройка проекта (state.gridStep), а не константа: владелец
   просил уметь менять его. Фолбэк на дефолт — для устойчивости, если поле пустое. */
function snapToGrid(v){const g=state.gridStep||EPConfig.gridDefault;return Math.round(v/g)*g}
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
    recalculateRoomAssignments();drawRoomLines();renderRooms();renderProperties();renderSummary();scheduleSave();
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
    recalculateRoomAssignments();renderRooms();renderSummary();scheduleSave();
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
  recalculateRoomAssignments();drawRoomLines();renderRooms();renderSummary();scheduleSave();
  scheduleRoomsFromLines();   /* линия снята — авто-пересчёт помещений */
  updateStatus(state.roomLinePoints.length?`Точка снята · в цепочке ${state.roomLinePoints.length}`:"Цепочка очищена — поставьте первую точку");
}
function removeRoomLine(id){
  state.roomLines=state.roomLines.filter(l=>l.id!==id);
  recalculateRoomAssignments();drawRoomLines();renderRooms();renderSummary();scheduleSave();
  scheduleRoomsFromLines();   /* отдельная линия удалена — авто-пересчёт помещений */
}
function clearRoomLines(){
  state.roomLines=[];finishRoomLineChain();
  recalculateRoomAssignments();drawRoomLines();renderRooms();renderProperties();renderSummary();scheduleSave();
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
  /* ручные контуры (autoPolygon===false) переживают пересчёт — как в detectRooms* */
  state.rooms=state.rooms.filter(r=>!r.autoPolygon);
  const kept=state.rooms.length;
  /* нумеруем «Помещение N» дальше существующих одноимённых, чтобы имена не дублировались */
  let next=state.rooms.reduce((max,r)=>{const m=/^Помещение\s+(\d+)$/.exec(r.name||"");return m?Math.max(max,Number(m[1])):max},0);
  res.rooms.forEach(rm=>{
    const poly=rm.polygon,c=polygonCentroid(poly);
    /* roomSource — признак способа получения контура (по линиям/по сетке): запасной
       проход не подменяет основной молча, источник виден и в state, и в отчётах */
    state.rooms.push({id:uid("room_"),name:"Помещение "+(++next),area:"",polygon:poly,autoPolygon:true,roomSource:rm.source,seedX:c.x,seedY:c.y,x:c.x-45,y:c.y-16});
  });
  recalculateRoomAssignments();renderAll();renderProperties();renderSummary();persistProject();
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
/* Автопересчёт с задержкой после правки линий (решение владельца №3: «по кнопке +
   авто, чтобы не мешало рисовать»). Гейт _autosaveOn — тот же, что у scheduleSave:
   не дёргаем во время восстановления проекта. Авто-режим молчалив. */
var _roomsTimer=null;
function scheduleRoomsFromLines(){
  if(!_autosaveOn)return;
  clearTimeout(_roomsTimer);
  _roomsTimer=setTimeout(()=>buildRoomsFromLines({silent:true}),EPConfig.roomAutoDelay);
}

/* ---- Видимость подложки (Этап 1): показать → бледная → скрыть.
   Меняется только прозрачность #planImage — линии, комнаты, посты, подписи и
   масштабная линейка остаются на месте. Уровень «бледности» — из EPConfig. ---- */
const PLAN_VIS_MODES=["show","dim","hide"];
const PLAN_VIS_LABEL={show:"Подложка: показана",dim:"Подложка: бледная",hide:"Подложка: скрыта"};
const PLAN_VIS_NEXT={show:"Нажмите, чтобы сделать бледной",dim:"Нажмите, чтобы скрыть",hide:"Нажмите, чтобы показать"};
function applyPlanVisibility(){
  const img=$("planImage"),mode=state.planVisibility||"show";
  /* show — прежняя прозрачность из CSS (.58); dim — из конфига; hide — 0 */
  img.style.opacity=mode==="hide"?"0":mode==="dim"?String(EPConfig.planDimOpacity):"";
  const btn=$("planVisibilityBtn");
  if(btn){btn.textContent=PLAN_VIS_LABEL[mode];btn.title=PLAN_VIS_NEXT[mode];btn.disabled=!state.planLoaded}
}

/* Фоновая сетка холста задаётся из JS, а не зашита в CSS: её шаг обязан совпадать
   с фактическим шагом привязки (state.gridStep), иначе визуальная сетка «врёт»
   относительно узлов. Меняем только background-size — рисунок линий остаётся в CSS. */
function applyGridStyle(){
  const step=state.gridStep||EPConfig.gridDefault;
  canvas.style.backgroundSize=step+"px "+step+"px";
}
/* Синхронизация переключателей панели с состоянием (при старте/восстановлении).
   Значения ставим программно — это не вызывает onchange, лишнего сохранения нет. */
function syncMarkupControls(){
  const o=$("orthoToggle"),s=$("snapGridToggle"),g=$("gridStepSelect");
  if(o)o.checked=state.orthoMode!==false;
  if(s)s.checked=state.snapGrid!==false;
  if(g)g.value=String(state.gridStep||EPConfig.gridDefault);
}
function cyclePlanVisibility(){
  if(!state.planLoaded){toast("Сначала загрузите план");return}
  const i=PLAN_VIS_MODES.indexOf(state.planVisibility||"show");
  state.planVisibility=PLAN_VIS_MODES[(i+1)%PLAN_VIS_MODES.length];
  applyPlanVisibility();persistProject();
  toast(PLAN_VIS_LABEL[state.planVisibility]);
}

function projectSnapshot(){
  const img=$("planImage");
  return{name:"Проект электроснабжения",savedAt:new Date().toISOString(),
    devices:state.devices,posts:state.posts,rooms:state.rooms,walls:state.walls,autoWalls:state.autoWalls,
    roomLines:state.roomLines,planVisibility:state.planVisibility,
    /* вид холста (смещение и масштаб) — чтобы вернуться туда, где работали.
       Старые проекты без view открываются с видом по умолчанию (см. restoreProject). */
    view:{panX:state.panX,panY:state.panY,scale:state.scale},
    /* режимы разметки — часть проекта: восстанавливаются вместе с ним */
    orthoMode:state.orthoMode,snapGrid:state.snapGrid,gridStep:state.gridStep,
    pxPerMeter:state.pxPerMeter,scaleSegment:state.scaleSegment,
    /* план кладём data-URL'ом — иначе после перезагрузки объекты повиснут над пустым холстом */
    plan:(state.planLoaded&&/^data:/.test(img.src||""))?img.src:null,
    planLabel:state.planLabel||"",
    /* реквизиты документа (проект/клиент/адрес/разработчик/дата/номер КП) — часть проекта */
    docHeader:EP_DATA.settings.docHeader||{},
    /* условия сделки и валюта — часть проекта, а не глобальная настройка приложения */
    terms:(({workPercent,materialsPercent,discountPercent,vatPercent,vatEnabled,rateSurchargePercent,wallType,displayCurrency,eurRate,rateDate,rateSource})=>
      ({workPercent,materialsPercent,discountPercent,vatPercent,vatEnabled,rateSurchargePercent,wallType,displayCurrency,eurRate,rateDate,rateSource}))(EP_DATA.settings)};
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
  _saveTimer=setTimeout(persistProject,EPConfig.autosaveDelay);   /* задержка — из EPConfig (было 700 мс) */
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
  /* миграция старых проектов: они сохранялись без номеров постов — проставляем
     недостающие по порядку массива (существующие номера не трогаем), чтобы номер был
     стабильным идентификатором и на плане, и в документах */
  EPPosts.ensurePostNumbers(state.posts);
  state.walls=p.walls||[];state.autoWalls=p.autoWalls||[];
  /* старые проекты без разметки и без флага видимости открываются штатно:
     roomLines → [], planVisibility → "show" (обратная совместимость) */
  state.roomLines=p.roomLines||[];state.planVisibility=p.planVisibility||"show";
  /* режимы разметки с фолбэками: старый проект без этих полей открывается как
     ортогонально=вкл, привязка=вкл, шаг=умолчание (10 px). !==false даёт true для
     undefined; шаг валидируем по списку — чужое значение откатываем на дефолт. */
  state.orthoMode=p.orthoMode!==false;
  state.snapGrid=p.snapGrid!==false;
  state.gridStep=EPConfig.gridSteps.includes(p.gridStep)?p.gridStep:EPConfig.gridDefault;
  state.pxPerMeter=p.pxPerMeter??null;state.scaleSegment=p.scaleSegment||null;
  /* вид: восстанавливаем смещение и масштаб; старый проект без view — 100% и начало
     координат. Масштаб зажимаем в допустимые границы (чужое/битое значение не должно
     вывести холст за пределы разумного). */
  const v=p.view;
  if(v&&Number.isFinite(v.scale)&&v.scale>0){
    state.scale=EPViewport.clampScale(v.scale,EPConfig.viewMinScale,EPConfig.viewMaxScale);
    state.panX=Number.isFinite(v.panX)?v.panX:0;state.panY=Number.isFinite(v.panY)?v.panY:0;
  }else{state.scale=1;state.panX=0;state.panY=0}
  state.planLabel=p.planLabel||"";
  if(p.terms){
    Object.assign(EP_DATA.settings,Object.fromEntries(Object.entries(p.terms).filter(([,v])=>v!=null&&v!=="")));
    /* Старый проект без поля надбавки открываем с 0, а НЕ с дефолтной 3: иначе
       ранее сохранённые сметы задним числом подорожали бы на надбавку, и этого
       никто бы не заметил. Проект, сохранённый уже с полем (в т.ч. 0), приходит
       через Object.assign выше и остаётся как есть. */
    if(p.terms.rateSurchargePercent==null)EP_DATA.settings.rateSurchargePercent=0;
    $("workInput").value=EP_DATA.settings.workPercent??18;
    $("materialsInput").value=EP_DATA.settings.materialsPercent??7;
    $("discountInput").value=EP_DATA.settings.discountPercent??0;
    $("vatInput").value=EP_DATA.settings.vatPercent??20;
    $("surchargeInput").value=EP_DATA.settings.rateSurchargePercent??0;
    $("vatEnabled").checked=EP_DATA.settings.vatEnabled!==false;
    $("currencySelect").value=EP_DATA.settings.displayCurrency||"EUR";
  }
  /* реквизиты документа: старый проект без них открывается с пустыми полями и датой
     «сегодня» (fillDocHeaderInputs подставит) — обратная совместимость */
  if(p.docHeader)EP_DATA.settings.docHeader=p.docHeader;
  fillDocHeaderInputs();
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
/* Реквизиты документа (PLAN 5): поля панели «Реквизиты КП». Хранятся в проекте
   (settings.docHeader, см. projectSnapshot/restoreProject). Возвращаем готовый к печати
   вид: дата форматируется ГГГГ-ММ-ДД → ДД.ММ.ГГГГ, пустая дата → сегодня. Пустые поля
   отдаём как есть — offerPdf/installSheet сами их не печатают. */
const DOC_FIELDS={docProject:"project",docClient:"client",docAddress:"address",docDeveloper:"developer",docDate:"date",docNumber:"number"};
function docHeader(){
  const d=EP_DATA.settings.docHeader||{};
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(d.date||"");
  return {
    project:d.project||"",client:d.client||"",address:d.address||"",
    developer:d.developer||"",number:d.number||"",
    date:m?`${m[3]}.${m[2]}.${m[1]}`:(d.date||new Date().toLocaleDateString("ru-RU"))
  };
}
function applyDocHeader(){
  const dh=EP_DATA.settings.docHeader=EP_DATA.settings.docHeader||{};
  Object.entries(DOC_FIELDS).forEach(([id,key])=>{dh[key]=$(id).value});
  scheduleSave();
}
function fillDocHeaderInputs(){
  const d=EP_DATA.settings.docHeader||{};
  $("docProject").value=d.project||"";$("docClient").value=d.client||"";
  $("docAddress").value=d.address||"";$("docDeveloper").value=d.developer||"";
  $("docNumber").value=d.number||"";
  /* дата по умолчанию — сегодня (ISO для input[type=date]); значение можно изменить */
  $("docDate").value=d.date||new Date().toISOString().slice(0,10);
}

/* Раскладка постов для КП (PLAN 1): по строке на пост — номер, наполнение словами с
   количеством, модульность, иллюстрация (картинка накладки). Порядок — по номеру. */
function buildPostLayout(){
  return state.posts.slice().sort((a,b)=>(Number(a.number)||0)-(Number(b.number)||0)).map(p=>{
    const comp=postComposition(p);
    return {
      number:p.number,
      modules:comp.modulesTotal,
      fill:EPPosts.fillSummary(p.mechanismIds,{product}),
      /* Иллюстрация — собранный пост (EPPostImage), а не фото одной накладки: инлайн-стили,
         поэтому одинаково рисуется в окне печати КП. */
      assembledImageHtml:assembledPostHtml(p,{size:"md"}),
      frameName:comp.frame?comp.frame.name:""
    };
  });
}

/* ---- План с бирками номеров постов для документов (D9) ----
   Заказчик сверяет номер поста в таблице с местом на чертеже: «дальше вот этот план
   обязательно нужен, чтобы было с чем сверяться». Секцию рисует чистый EPPlanLabels, здесь
   остаётся то, что знает только приложение: где живая подложка и в какой системе координат
   лежат посты. */

/* Полуразмер иконки поста на плане: .plan-icon — 24×24 px, и addPending кладёт пост
   как {x:клик-12, y:клик-12}, то есть post.x/post.y — ЛЕВЫЙ ВЕРХНИЙ угол иконки.
   Бирке нужна точка, которую пользователь видит как «место поста», — центр иконки. */
const POST_ICON_HALF=12;
/* Подложка для документа. Растеризованный PDF-чертёж — это data-URL на несколько мегабайт
   (длинная сторона 3200 px, planImport.RASTER_LONG_SIDE), и он уходит в document.write окна
   печати целиком. Крупную подложку пережимаем в JPEG с длинной стороной DOC_PLAN_LONG_SIDE:
   для справочного плана с бирками этого хватает с большим запасом, а окно печати открывается
   и рисуется быстро. Мелкую подложку не трогаем — перекодировать её незачем. Любая осечка
   (SVG без внутренних размеров, отказ toDataURL) — печатаем оригинал как есть. */
const DOC_PLAN_LONG_SIDE=1800, DOC_PLAN_KEEP_BYTES=700*1024;
function planImageForDoc(img){
  const src=img.src||"";
  const long=Math.max(img.naturalWidth,img.naturalHeight);
  /* Оригинал оставляем только когда подложка И лёгкая, И невысокого разрешения. Через ИЛИ
     здесь была дыра: детальный план 1200×900 весом 15 МБ проходил по второму условию и
     попадал в документ несжатым — бюджет по весу не работал вовсе. */
  if(src.length<=DOC_PLAN_KEEP_BYTES&&long<=DOC_PLAN_LONG_SIDE)return src;
  try{
    /* k<=1: тяжёлую, но мелкую подложку не растягиваем — её ужимает уже перекодировка в JPEG */
    const k=Math.min(1,DOC_PLAN_LONG_SIDE/long);
    const w=Math.max(1,Math.round(img.naturalWidth*k)),h=Math.max(1,Math.round(img.naturalHeight*k));
    const c=document.createElement("canvas");c.width=w;c.height=h;
    const ctx=c.getContext("2d");
    /* белый фон обязателен: у PNG/SVG прозрачность в JPEG стала бы чёрной заливкой */
    ctx.fillStyle="#fff";ctx.fillRect(0,0,w,h);
    ctx.drawImage(img,0,0,w,h);
    const out=c.toDataURL("image/jpeg",0.9);
    return out.length<src.length?out:src;
  }catch(e){return src}
}
/* Данные блока «план с бирками» для EPPlanLabels. null — блока в документе не будет
   (плана не загружали; проект восстановлен без плана — persistProject при переполнении
   localStorage сохраняет plan:null; постов нет).
   ПОДЛОЖКУ ЧИТАЕМ ЖИВУЮ ($("planImage")), а не из снимка проекта — по той же причине.
   Зум и панораму вида (state.scale/panX/panY) компенсировать НЕ надо: applyView — это одна
   CSS-трансформация #canvas, в мировые координаты постов она не входит. А вот леттербокс
   подложки (object-fit:contain внутри мирового бокса) снимает уже сам EPPlanLabels — для
   этого ему и передаются размеры бокса. */
function planLabelsSpec(){
  const img=$("planImage");
  if(!state.planLoaded||!img||!img.src||!img.naturalWidth||!img.naturalHeight)return null;
  if(!state.posts.length)return null;
  return {
    imageUrl:planImageForDoc(img),
    natW:img.naturalWidth,natH:img.naturalHeight,
    canvasW:canvas.clientWidth,canvasH:canvas.clientHeight,
    posts:state.posts.map(p=>({number:p.number,x:p.x+POST_ICON_HALF,y:p.y+POST_ICON_HALF}))
  };
}
/* Готовая секция плана для документа — пустая строка, если рисовать нечего.
   Режим «подложка скрыта» (planVisibility) документ НЕ подавляет: это переключатель
   рабочего вида, а печатный план нужен для сверки в любом случае. */
function planBlockHtml(opts){
  const spec=planLabelsSpec();
  if(!spec)return "";
  return EPPlanLabels.buildHtml(Object.assign(spec,opts||{}),{esc});
}

/* ---- Сводная спецификация по артикулам для документов (D11) ----
   Заказчик 24.08 (§4.7 итогов): «чтобы он из всех этих выдернул всё идентичное, то есть
   например коробки монтажные такие-то, столько-то штук… это то, что ты будешь в поставщику
   отправлять». Сам свод (объединение одинаковых артикулов, порядок строк, итоги) считает
   чистый EPSupplierSpec; здесь остаётся то, что знает только приложение: состав проекта из
   state и каталога.
   Количества берём ФАКТИЧЕСКИЕ, из уже посчитанного postComposition (суппорты по supportCount,
   коробки по boxCount) — второй копии правил не заводим, иначе они разойдутся, как уже
   расходились с литералом «1 суппорт». Каждый РАЗМЕЩЁННЫЙ пост даёт свой комплект сам собой:
   шаблон, поставленный на план N раз, лежит в state.posts N раз.
   Товар, которого нет в каталоге, передаём с ПУСТЫМ артикулом и честным именем (формулировка
   та же, что в таблице модулей листа монтажника и в смете estimate.js): молча выбросить
   позицию нельзя — поставщик должен видеть пробел, а не недосчитаться коробки на объекте. */
function supplierSpecData(){
  /* Товар каталога → позиция свода: только артикул, имя, единица и ВИД ИЗДЕЛИЯ. Цены в
     документе для поставщика нет — её ему отдаёт не проектировщик.
     kind обязателен: по нему свод раскладывает строки по группам («Накладки», «Механизмы
     и клавиши», …). Без него одиночный элемент плана падал в «Прочие изделия», даже если
     это механизм или накладка, — группа зависела от того, стоит ли товар в посте, а не от
     того, ЧТО это за изделие. У позиций поста вид задаёт сам свод (он знает, что кладёт),
     здесь поле работает на extras. Перевод вокабуляра прайса («socket_box» → коробки) —
     не наш: его отдаёт EPSupplierSpec.kindFromCatalog, чтобы список групп жил в одном
     месте с их порядком и подписями. */
  const item=p=>p?{code:p.code,name:p.name,unit:p.unit,kind:EPSupplierSpec.kindFromCatalog(p.kind)}:null;
  return {
    posts:state.posts.map(p=>{
      const comp=postComposition(p);
      return {
        mechanisms:(p.mechanismIds||[]).map(id=>item(product(id))||{code:"",name:`Механизм не найден (арт. ${id})`}),
        frame:item(comp.frame)||(p.frameId?{code:"",name:`Накладка не найдена (арт. ${p.frameId})`}:null),
        /* Суппорт отдаём вместе с признаком «подобран нами, заказчиком не подтверждён»:
           пометка «(предположительно)» обязана быть во ВСЕХ документах одинаковой, свод не
           исключение. supportNotRequired (крышки IP55 без планки) — не пробел подбора, и
           EPSupplierSpec по нему строку не печатает. */
        support:item(comp.support),supportCount:comp.supportCount,
        supportAssumed:comp.supportAssumed,supportNotRequired:comp.supportNotRequired,
        /* Коробка — точная либо стандартно-совместимый фолбэк: тот же выбор, что в листе
           монтажника и в цене поста (тип стены проекта знает только приложение). */
        box:item(comp.box||comp.boxFallback),boxCount:comp.boxCount
      };
    }),
    /* Одиночные элементы плана: заказчик просил убрать их из инструмента (§4.8 «элементы
       только в блоках будут»), но в уже сохранённых проектах они есть — из заказа выпасть
       не должны. */
    extras:state.devices.map(d=>item(product(d.productId))||{code:"",name:`Товар не найден (арт. ${d.productId})`})
  };
}
/* Готовая секция свода для документа — пустая строка, когда заказывать нечего (пустой
   проект). Документы получают строку, а не данные, ровно как planBlockHtml. */
function supplierSpecHtml(opts){
  return EPSupplierSpec.buildHtml(Object.assign(supplierSpecData(),opts||{}),{esc});
}

/* Детали поста для взрыв-схемы листа монтажника (EPExplodedView). Собираем ИЗ УЖЕ ПОСЧИТАННОГО:
   comp (суппорт/коробка/накладка — товары каталога с kind/categoryId/icon), layout (механизмы с
   позицией и товаром) и frameSpec (фото/окна накладки, что уже собрал assembledPostSpec) — второй
   раз в каталог не ходим. Порядок деталей — как разносят сборку от лица к стене: накладка →
   механизмы → суппорт → коробка. Значок детали задаём признаками товара (categoryId+icon+name):
   их переводит в глиф pickIcon внутри EPExplodedView — тот же, что рисует клавиши сборки. Фото
   КАЖДОЙ детали (накладка, механизмы, суппорт, коробка) берём каталожным productImage(detail) —
   крупный кадр для печати; в отличие от photoReady оно НЕ требует размеченных окон (окна нужны
   только для композитинга клавиш на СОБРАННОЙ картинке, здесь фото стоит отдельно), поэтому
   закрывает намного больше накладок. Нет своего фото → EPExplodedView нарисует глиф по kind. */
function buildExplodedSpec(comp,box,layout,frameSpec){
  const parts=[];
  const frame=comp.frame;
  const photoOf=item=>productImage(item,{detail:true});   // "" если фото нет/плейсхолдер (сам фильтрует)
  if(frame){
    /* У накладки основной источник — productImage (без окон, ловит большинство накладок); photoReady
       по frameSpec оставлен ЗАПАСНЫМ — на случай, когда своего productImage нет, а измеренное фото
       из собранного spec всё же есть. wide → широкий бокс во взрыв-схеме (накладка шире, чем высокая). */
    const framePhoto=photoOf(frame)||(EPPostImage.photoReady(frameSpec)?frameSpec.imageUrl:"");
    parts.push({
      role:"Накладка",name:frame.name,code:frame.code,
      icon:{categoryId:frame.categoryId,icon:frame.icon,name:frame.name},
      photo:framePhoto?{imageUrl:framePhoto,wide:true}:null
    });
  }
  layout.forEach(s=>{
    const item=s.item;
    const photo=photoOf(item);   // item может быть null (механизм не в каталоге) — productImage вернёт ""
    parts.push({
      role:"Модуль",pos:s.label,
      name:item?item.name:`Механизм не найден (арт. ${s.id})`,
      code:item?item.code:"",
      icon:{categoryId:item?.categoryId,icon:item?.icon,name:item?.name},
      photo:photo?{imageUrl:photo}:null
    });
  });
  /* Количество суппортов — кикером роли («Суппорт ×2»), ровно как у коробки ниже: на
     схеме деталь одна, но монтажник по подписи видит, сколько планок ставить.
     Туда же — пометка неподтверждённого артикула: взрыв-схема печатается ВНУТРИ листа
     монтажника, рядом с таблицей обвязки, и артикул без пометки на схеме спорил бы с
     пометкой в таблице над ней. Формулировка та же, что в смете и в панели состава. */
  if(comp.support&&comp.supportCount){
    const photo=photoOf(comp.support);
    parts.push({
      role:(comp.supportCount>1?`Суппорт ×${comp.supportCount}`:"Суппорт")+(comp.supportAssumed?" (предположительно)":""),
      name:comp.support.name,code:comp.support.code,
      icon:{categoryId:comp.support.categoryId,icon:comp.support.icon,name:comp.support.name},
      photo:photo?{imageUrl:photo}:null
    });
  }
  if(box&&comp.boxCount){
    const photo=photoOf(box);
    parts.push({
      role:comp.boxCount>1?`Монтажная коробка ×${comp.boxCount}`:"Монтажная коробка",
      name:box.name,code:box.code,
      icon:{categoryId:box.categoryId,icon:box.icon,name:box.name},
      photo:photo?{imageUrl:photo}:null
    });
  }
  return {parts};
}

/* Данные одного поста для листа монтажника: таблица модулей (позиция «2» / «2–3»,
   элемент, артикул) и обвязка в порядке сборки суппорт → коробка → накладка. Высота и
   назначение подхватятся, когда появятся у поста (PLAN 6). */
function buildPostSheet(post){
  const comp=postComposition(post);
  const frame=comp.frame;
  const moduleRow=s=>({
    label:s.label,
    name:s.item?s.item.name:`Механизм не найден (арт. ${s.id})`,
    code:s.item?s.item.code:"",
    note:s.item?"":"нет в каталоге"
  });
  /* Плоская нумерация (совместимость) + нумерация ПО ПОСТАМ: в каждом посте счёт модулей
     с 1 («пост 1, модули 1–2», «пост 2, модуль 1») — монтажнику важно, что это разные
     коробки. Обе считает EPPosts, чтобы позиции совпадали с конструктором и превью. */
  const layout=EPPosts.moduleLayout(post.mechanismIds,{product,mechanismSpan});
  const modules=layout.map(moduleRow);
  const moduleGroups=EPPosts.postModuleGroups(post.mechanismIds,frame,{product,mechanismSpan})
    .map(g=>({post:g.post,capacity:g.capacity,modules:g.modules.map(moduleRow)}));
  /* Точная коробка либо стандартно-совместимый фолбэк — выбор наш: только приложение знает
     тип стены проекта. Дальше обвязку (суппорт → коробка → накладка) собирает чистая
     EPInstallSheet.buildFittings — формат её строк принадлежит документу, а не оркестратору,
     и там же под тестом живёт правило «суппортов столько же, сколько коробок» (раньше здесь
     стоял литерал count:1, и монтажник вёз одну планку на два немецко-французских поста). */
  const box=comp.box||comp.boxFallback;
  const fittings=EPInstallSheet.buildFittings(comp,box);
  const room=state.rooms.find(r=>r.id===post.roomId);
  /* Собранное изображение и взрыв-схему кормим ОДНИМ spec (assembledPostSpec) — в каталог за
     фото/окнами накладки ходим один раз. assembledImageHtml остаётся байт-в-байт как прежде
     (assembledPostHtml — это та же EPPostImage.buildHtml над тем же spec). */
  const spec=assembledPostSpec(post,{size:"md"});
  return {
    number:post.number,
    room:room?room.name:"",
    standardLabel:STANDARD_LABEL[comp.standard]||comp.standard,
    frameName:frame?frame.name:"",
    frameCode:frame?frame.code:"",
    color:(frame&&(frame.properties?.color||frame.color))||"",
    height:post.height||"",
    purpose:post.purpose||"",
    modules,moduleGroups,fittings,
    /* Единое изображение собранного поста (та же EPPostImage) — инлайн-стили, поэтому
       одинаково рисуется в окне печати листа монтажника. */
    assembledImageHtml:EPPostImage.buildHtml(spec,{esc}),
    /* Взрыв-схема ДОПОЛНЯЕТ собранную картинку: деталь → выносная линия → артикул. Глиф детали —
       из каталожной системы иконок (pickIcon/iconSvg EPPostImage), фото накладки — из того же spec. */
    explodedViewHtml:EPExplodedView.buildHtml(
      buildExplodedSpec(comp,box,layout,spec.frame),
      {esc,pickIcon:EPPostImage.pickIcon,iconSvg:EPPostImage.iconSvg}),
    /* немецко-французский: коробок и суппортов несколько (пост = 2 модуля) + импосты —
       важно монтажнику: по прежнему примечанию он вёз одну планку на всю сборку */
    german:(comp.model==="post"&&comp.postCount>1)?{postCount:comp.postCount,supportCount:comp.supportCount}:null
  };
}
function openInstallSheet(data){
  const win=window.open("","_blank");
  if(!win){toast("Разрешите всплывающие окна для листа монтажника");return}
  const h=docHeader();
  win.document.write(EPInstallSheet.buildHtml(
    Object.assign({header:{project:h.project,developer:h.developer,date:h.date}},data),{esc}));
  win.document.close();
}
/* Лист монтажника для поста в конструкторе: если правим размещённый пост — берём его
   номер/помещение, иначе пост ещё без номера («—»). */
function installSheetForBuilder(){
  const placed=state.builder.editingPlacedId?state.posts.find(x=>x.id===state.builder.editingPlacedId):null;
  const post={number:placed?placed.number:"—",frameId:Number($("postFrameSelect").value),
    mechanismIds:[...state.builder.mechanismIds],roomId:placed?placed.roomId:null,
    height:placed?.height,purpose:placed?.purpose};
  if(!post.mechanismIds.length){toast("Добавьте механизмы в пост");return}
  openInstallSheet({posts:[buildPostSheet(post)],subtitle:"Помодульная раскладка поста"});
}
/* Лист монтажника на весь проект: лист на каждый пост, сгруппировано по помещениям
   (порядок помещений — как в state.rooms, «Без помещения» в конце; внутри — по номеру). */
function installSheetForProject(){
  if(!state.posts.length){toast("В проекте нет постов");return}
  const roomIndex=new Map(state.rooms.map((r,i)=>[r.id,i]));
  const ordered=state.posts.slice().sort((a,b)=>{
    const ra=roomIndex.has(a.roomId)?roomIndex.get(a.roomId):Infinity;
    const rb=roomIndex.has(b.roomId)?roomIndex.get(b.roomId):Infinity;
    return ra-rb||(Number(a.number)||0)-(Number(b.number)||0);
  });
  openInstallSheet({posts:ordered.map(buildPostSheet),subtitle:"Помодульная раскладка постов по проекту",
    /* План с бирками — только в листе НА ВЕСЬ ПРОЕКТ: в листе одного поста из конструктора
       (installSheetForBuilder) чертёж со всеми чужими номерами только мешает. Поля листа
       монтажника 14 мм (см. @page в installSheet.js). */
    planBlockHtml:planBlockHtml({maxWidthMm:182,maxHeightMm:226,
      note:"Номер на бирке — номер поста в карточках ниже."}),
    /* Свод по артикулам — тоже только в листе НА ВЕСЬ ПРОЕКТ: в листе одного поста из
       конструктора заказывать по проекту нечего, а состав этого поста уже есть в обвязке. */
    supplierSpecHtml:supplierSpecHtml({
      note:"Все одинаковые позиции проекта сведены по артикулам — этот лист отправляется поставщику."})});
}
/* Осознанная перенумерация постов к 1..N по расположению на плане (сверху вниз, слева
   направо) — как обычно обходят точки на чертеже. Пока пользователь не нажал, номера
   закреплены и не прыгают при удалении (иначе распечатанные документы разошлись бы). */
function renumberPosts(){
  if(!state.posts.length){toast("В проекте нет постов");return}
  state.posts.slice().sort((a,b)=>(a.y-b.y)||(a.x-b.x)).forEach((p,i)=>p.number=i+1);
  renderAll();renderProperties();renderSummary();persistProject();
  toast("Посты перенумерованы по расположению на плане");
}

/* Оркестратор КП: считаем ту же смету, что и панель справа (единый buildEstimate —
   PLAN 2.4), открываем окно печати, а саму вёрстку документа собирает EPOfferPdf.
   Сверху добавляем реквизиты (docHeader) и раскладку постов (buildPostLayout). */
function generateCommercialOffer(){
  const est=buildEstimate();
  if(est.missing.length)toast(`Внимание: позиций без товара в каталоге — ${est.missing.length}`);
  const win=window.open("","_blank");
  if(!win){toast("Разрешите всплывающие окна для формирования PDF");return}
  win.document.write(EPOfferPdf.buildHtml(est,{money,esc,displayCurrency,effectiveRate:EPRates.effectiveRate,
    settings:EP_DATA.settings,header:docHeader(),postLayout:buildPostLayout(),
    /* план с бирками — отдельной страницей перед раскладкой постов: клиент сверяет номер в
       таблице с местом на чертеже. Поля КП 16 мм (см. @page в offerPdf.js). */
    planBlockHtml:planBlockHtml({maxWidthMm:178,maxHeightMm:222}),
    /* Свод по артикулам — приложением В КОНЦЕ КП, после денежных итогов: клиент читает КП
       ради цены, а этот лист отрывается и уходит поставщику (в нём цен нет). */
    supplierSpecHtml:supplierSpecHtml()}));
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

/* ---- Автообрисовка: детекция стен по толщине (этапы 1–3).
   Алгоритмы (бинаризация, морфология, поиск и сшивка осевых линий) вынесены
   в js/planTrace.js (EPPlanTrace) — здесь остаётся только оркестратор: чтение
   канваса, привязка к отображаемому плану и отрисовка. ---- */
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
      let dark=EPPlanTrace.binarize(data,w,h,threshold);

      const minDim=Math.min(w,h);
      const closeR=Math.max(3,Math.round(minDim*.010));      // этап 3: заполнение штриховки (склеивает две грани стены в полосу)
      dark=EPPlanTrace.closeBinary(dark,w,h,closeR);
      dark=EPPlanTrace.keepWallComponents(dark,w,h,.33,.004); // выделение сети стён: убирает текст/мебель/подписи

      const tMin=Math.max(4,Math.round(minDim*.006));        // толщина стены в px анализа
      const tMax=Math.max(tMin+4,Math.round(minDim*.05));
      const minRun=Math.max(18,Math.round(w*.035));
      // текст уже убран выделением компонентов — можно смелее сшивать обрывки осевых линий стен
      const gap=Math.max(6,Math.round(minRun*.6));

      const hCand=EPPlanTrace.horizontalCandidates(dark,w,h,tMin,tMax);  // этап 2: отбор по толщине
      const vCand=EPPlanTrace.verticalCandidates(dark,w,h,tMin,tMax);
      const mergedH=EPPlanTrace.mergeSegments(EPPlanTrace.runsAlongRows(hCand,w,h,minRun,gap),"h").filter(s=>s.x2-s.x1>=minRun);
      const mergedV=EPPlanTrace.mergeSegments(EPPlanTrace.runsAlongCols(vCand,w,h,minRun,gap),"v").filter(s=>s.y2-s.y1>=minRun);

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
  else if(state.tool==="roomline"){addRoomLinePoint(e);return}
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
/* превью «резинки» и подсветка точки притяжения при рисовании разметки */
canvas.addEventListener("pointermove",e=>{
  if(state.tool!=="roomline")return;
  const r=canvas.getBoundingClientRect();
  state.roomLineHover=resolveRoomLinePoint((e.clientX-r.left)/state.scale,(e.clientY-r.top)/state.scale,e.shiftKey);
  drawRoomLines();
});
document.querySelectorAll("[data-tool]").forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
/* Переключатели режимов разметки. Сохраняем сразу (как cyclePlanVisibility): это
   настройка проекта, а не пачка мелких правок — задержка автосейва тут не нужна. */
$("orthoToggle").onchange=e=>{state.orthoMode=e.target.checked;persistProject()};
$("snapGridToggle").onchange=e=>{state.snapGrid=e.target.checked;persistProject()};
$("gridStepSelect").onchange=e=>{
  const s=Number(e.target.value);
  state.gridStep=EPConfig.gridSteps.includes(s)?s:EPConfig.gridDefault;
  applyGridStyle();persistProject();   /* фоновая сетка должна сразу перерисоваться под новый шаг */
};
$("clearRoomLinesBtn").onclick=clearRoomLines;
$("planVisibilityBtn").onclick=cyclePlanVisibility;
$("catalogSearch").oninput=e=>renderCatalog(e.target.value);
$("newPostBtn").onclick=()=>openPostBuilder();
$("closePostModal").onclick=$("cancelPost").onclick=closePostBuilder;
$("savePost").onclick=savePostBuilder;$("postSlotCount").onchange=changePostSlotCount;$("postFrameSelect").onchange=renderBuilder;
/* Тип стены — первый шаг конструктора и свойство проекта: меняет подбор коробки,
   поэтому перерисовываем состав и смету и сохраняем. */
document.querySelectorAll("#postWallType .wall-type-option").forEach(b=>b.onclick=()=>{
  EP_DATA.settings.wallType=b.dataset.wall;renderBuilder();renderSummary();scheduleSave();
});
$("postModal").onclick=e=>{if(e.target===$("postModal"))closePostBuilder()};
/* ---- Вид холста: панорама, зум к курсору, «вписать в экран» (бесконечный холст).
   Мировые координаты объектов НЕ трогаем — двигаем/масштабируем сам ВИД через одну
   CSS-трансформацию единого родителя .canvas. Поэтому слои, объекты, подложка и
   линейка остаются на местах друг относительно друга (главный критерий приёмки).
   Все пересчёты — в чистом EPViewport. ---- */
function view(){return {panX:state.panX,panY:state.panY,scale:state.scale}}
/* применить вид к DOM: одна дешёвая трансформация, без перерисовки слоёв и объектов —
   поэтому панорама и зум не грузят интерфейс на каждое движение мыши */
function applyView(){canvas.style.transform=`translate(${state.panX}px,${state.panY}px) scale(${state.scale})`}
function setView(v){state.panX=v.panX;state.panY=v.panY;state.scale=v.scale;applyView()}
/* Единый апдейт индикаторов масштаба: подпись на кнопке #zoomReset и (по флагу)
   строка статуса. Раньше три обработчика писали число врозь, а кнопку не трогали
   вовсе — она вечно висела на «100%». Держим в одном месте, чтобы не разъезжались. */
function updateZoomUi(showInStatus){
  const pct=Math.round(state.scale*100);
  $("zoomReset").textContent=pct+"%";
  if(showInStatus)updateStatus(`Масштаб ${pct}%`);
}
const zoomBounds=()=>({min:EPConfig.viewMinScale,max:EPConfig.viewMaxScale});
/* центр окна вида в координатах, от которых отсчитывается pan (левый-верхний угол окна) */
function viewportCenter(){const r=canvasScroll.getBoundingClientRect();return {x:r.width/2,y:r.height/2}}
/* зум вокруг точки экрана (курсор/центр) — единый расчёт EPViewport.zoomAt держит
   мировую точку под этой точкой экрана на месте */
function zoomBy(factor,screenPt){setView(EPViewport.zoomAt(view(),screenPt,factor,zoomBounds()));updateZoomUi(true);scheduleSave()}
$("zoomIn").onclick=()=>zoomBy(1+EPConfig.viewZoomStep,viewportCenter());
$("zoomOut").onclick=()=>zoomBy(1/(1+EPConfig.viewZoomStep),viewportCenter());
/* сброс к 100% — вокруг центра окна, чтобы содержимое не «прыгнуло» в угол */
$("zoomReset").onclick=()=>zoomBy(1/state.scale,viewportCenter());
/* точки, ограничивающие «всё нарисованное» для вписывания: подложка (если есть),
   линии, объекты, комнаты. В отличие от сетки областей блок [0..clientW] НЕ добавляем
   без подложки — иначе пустой лист «вписывался» бы вместо реального содержимого. */
function fitContentPoints(){
  const pts=[];
  if(state.planLoaded)pts.push({x:0,y:0},{x:canvas.clientWidth,y:canvas.clientHeight});
  allWalls().forEach(w=>pts.push(w.a,w.b));
  [...state.devices,...state.posts].forEach(o=>pts.push({x:o.x,y:o.y},{x:o.x+24,y:o.y+24}));
  state.rooms.forEach(r=>{
    pts.push({x:r.x,y:r.y},{x:r.x+110,y:r.y+40});   /* габарит подписи комнаты */
    if(r.polygon)r.polygon.forEach(p=>pts.push(p));
  });
  return pts;
}
/* «Вписать в экран»: подгоняем вид под bbox всего нарисованного с полями; пусто —
   100% и начало координат (EPViewport.fitView сам возвращает вид по умолчанию). */
function fitToScreen(){
  const r=canvasScroll.getBoundingClientRect();
  setView(EPViewport.fitView(EPViewport.bounds(fitContentPoints()),r.width,r.height,
    {padding:EPConfig.viewFitPadding,minScale:EPConfig.viewMinScale,maxScale:EPConfig.viewMaxScale}));
  updateZoomUi(true);scheduleSave();
}
$("zoomFit").onclick=fitToScreen;

/* ---- Панорамирование: зажатый ПРОБЕЛ + перетаскивание ИЛИ средняя кнопка мыши.
   Слушаем на окне вида в фазе ПЕРЕХВАТА — панорама должна перебивать инструменты и
   объекты под курсором (иначе пробел+клик по иконке начал бы тащить иконку). pan —
   в пикселях экрана 1:1 с мышью: двигаем сам вид, масштаб тут не делим. ---- */
let spaceDown=false,panning=false,panLX=0,panLY=0,panMoved=false;
function setPanReady(on){canvasScroll.classList.toggle("pan-ready",on&&!panning)}
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
function endPan(e){
  if(!panning)return;
  panning=false;canvasScroll.classList.remove("panning");
  if(spaceDown)canvasScroll.classList.add("pan-ready");
  try{canvasScroll.releasePointerCapture(e.pointerId)}catch(_){}
  scheduleSave();   /* положение вида — часть проекта */
}
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
      /* новый чертёж показываем целиком, иначе после «скрыть» пользователь увидит пустоту */
      state.planVisibility="show";applyPlanVisibility();
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
$("clearBtn").onclick=()=>{state.devices=[];state.posts=[];state.rooms=[];state.walls=[];state.autoWalls=[];state.wallPoints=[];state.roomLines=[];finishRoomLineChain();state.selected=null;clearAnnotations();renderAll();renderProperties();renderSummary()};
$("autoTraceBtn").onclick=autoTracePlan;
$("detectRoomsBtn").onclick=detectRooms;
$("detectRoomsMlBtn").onclick=detectRoomsML;
$("roomsFromLinesBtn").onclick=()=>buildRoomsFromLines();   /* явный запуск — не в silent-режиме */
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
$("installSheetBtn").onclick=installSheetForProject;
$("renumberPostsBtn").onclick=renumberPosts;
$("builderInstallSheet").onclick=installSheetForBuilder;
/* реквизиты КП: правки полей сохраняются в проект (settings.docHeader) */
Object.keys(DOC_FIELDS).forEach(id=>{$(id).oninput=applyDocHeader});
/* условия сделки: скидка, ставка НДС и его наличие в КП */
function applyTerms(){
  EP_DATA.settings.workPercent=Math.max(0,Math.min(200,Number($("workInput").value)||0));
  EP_DATA.settings.materialsPercent=Math.max(0,Math.min(200,Number($("materialsInput").value)||0));
  EP_DATA.settings.discountPercent=Math.max(0,Math.min(100,Number($("discountInput").value)||0));
  EP_DATA.settings.vatPercent=Math.max(0,Math.min(30,Number($("vatInput").value)||0));
  EP_DATA.settings.vatEnabled=$("vatEnabled").checked;
  $("vatInput").disabled=!EP_DATA.settings.vatEnabled;
  renderSummary();scheduleSave();
}
["workInput","materialsInput","discountInput","vatInput"].forEach(id=>{$(id).oninput=applyTerms});
$("vatEnabled").onchange=applyTerms;
/* валюта отображения и курс */
function applyCurrency(){
  EP_DATA.settings.displayCurrency=$("currencySelect").value;
  updateRateUi();
  renderCatalog($("catalogSearch").value);renderSummary();renderTemplates();renderProperties();
  scheduleSave();
  if(EP_DATA.settings.displayCurrency==="RUB"&&!(EP_DATA.settings.eurRate>0))refreshRate();
}
$("currencySelect").onchange=applyCurrency;
$("rateRefreshBtn").onclick=refreshRate;
$("rateInput").oninput=()=>{
  if(!applyRateEntry(EPRates.manual($("rateInput").value)))return;
  updateRateUi();renderCatalog($("catalogSearch").value);renderSummary();renderTemplates();scheduleSave();
};
/* Надбавка к курсу — часть условий сделки, но влияет и на рублёвое представление
   каталога/сметы/шаблонов/свойств, поэтому перерисовываем их так же, как applyCurrency
   при смене валюты (в EUR-режиме money() всё равно вернёт евро — перерисовка безвредна). */
function applySurcharge(){
  EP_DATA.settings.rateSurchargePercent=Math.max(0,Math.min(100,Number($("surchargeInput").value)||0));
  updateRateUi();
  renderCatalog($("catalogSearch").value);renderSummary();renderTemplates();renderProperties();
  scheduleSave();
}
$("surchargeInput").oninput=applySurcharge;
document.onkeydown=e=>{
  /* горячие клавиши не должны срабатывать во время ввода в поля (имя комнаты и т.п.) */
  const typing=/^(input|textarea|select)$/i.test(e.target.tagName)||e.target.isContentEditable;
  if(e.key==="Escape"){
    if($("pdfPageModal").classList.contains("open")){finishPdfPageSelection(null);return}
    if(!uploadPopover.hidden)setUploadPopover(false,true);
    setTool("select");closePostBuilder();
  }
  if(e.key==="Enter"&&(state.tool==="wall"||state.tool==="roomline"))setTool("select");
  if(e.key==="Delete"&&state.selected)removeEntity(state.selected.kind,state.selected.id);
  /* Клавиатура для выделенного объекта (PLAN 4): Enter — конструктор поста, стрелки —
     сдвиг на шаг сетки (Shift — на 1px). Только вне ввода и при закрытом конструкторе. */
  if(!typing&&state.selected&&!$("postModal").classList.contains("open")){
    if(e.key==="Enter"&&state.selected.kind==="post"){e.preventDefault();openPostBuilder({placedId:state.selected.id});return}
    const step=e.shiftKey?1:state.gridStep;
    const nudge={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[e.key];
    if(nudge&&moveSelectedBy(nudge[0],nudge[1])){e.preventDefault();return}
  }
  /* Backspace во время рисования разметки — снять последнюю точку (Esc — выход из режима) */
  if(e.key==="Backspace"&&state.tool==="roomline"&&!typing&&state.roomLinePoints.length){e.preventDefault();removeLastRoomLinePoint()}
  /* B — переключение видимости подложки (независимо от раскладки, по физической клавише) */
  if(e.code==="KeyB"&&!typing&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();cyclePlanVisibility()}
  /* Пробел — режим «рука» для панорамы (курсор-подсказка). preventDefault, чтобы
     пробел не прокручивал страницу и не «нажимал» сфокусированную кнопку. */
  if(e.code==="Space"&&!typing){e.preventDefault();if(!spaceDown){spaceDown=true;setPanReady(true)}}
};
/* отпускание пробела и потеря фокуса окна снимают режим «рука» (иначе он «залипнет») */
document.addEventListener("keyup",e=>{if(e.code==="Space"){spaceDown=false;canvasScroll.classList.remove("pan-ready")}});
window.addEventListener("blur",()=>{spaceDown=false;canvasScroll.classList.remove("pan-ready")});
/* ---- Общий перехват ошибок (PLAN 7.2) ----
   Сегодняшний разбор показал, что необработанное исключение внутри рендера или
   промиса обрывает работу молча: интерфейс просто замирает на полпути, а
   пользователь видит «ничего не произошло». Ловим оба вида и показываем факт
   сбоя, полную диагностику оставляем в консоли. */
let _lastErr=0;
function reportFailure(what,err){
  console.error(what,err);
  const now=Date.now();
  if(now-_lastErr<3000)return;   /* не заваливаем всплывашками при каскаде ошибок */
  _lastErr=now;
  const msg=(err&&(err.message||err.reason?.message))||"";
  toast(msg?`Сбой: ${String(msg).slice(0,90)}`:"Произошёл сбой — подробности в консоли браузера");
}
window.addEventListener("error",e=>reportFailure("Необработанная ошибка:",e.error||e));
window.addEventListener("unhandledrejection",e=>reportFailure("Необработанный промис:",e.reason||e));

init().catch(e=>reportFailure("Инициализация не завершилась:",e));
})();
