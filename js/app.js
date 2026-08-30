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
  /* Конструктор поста. slots — механизм ВМЕСТЕ с группой света клавиши (js/builderSlots.js):
     параллельный массив групп разъехался бы на первой же перестановке или фильтрации набора.
     target — что сделает следующая выбранная карточка каталога (добавить / заменить слот N),
     query — строка поиска, openSections — какие разделы каталога раскрыты (по умолчанию все
     свёрнуты — прямая просьба заказчика 24.08).
     snapshot — подпись поста на момент открытия окна (есть ли что терять при закрытии),
     escArmed — взвод подтверждения на закрытие (EPConfirmRepeat): закрытие с несохранёнными
     правками требует ВТОРОГО, осознанного нажатия — см. requestClosePostBuilder.
     wallType — ЧЕРНОВИК типа стены редактируемого поста. Раньше кнопки «Тип стены» писали
     прямо в EP_DATA.settings.wallType и тут же сохраняли проект: правка у одного поста
     меняла подбор коробки у ВСЕХ постов проекта и не откатывалась «Отменой». Теперь правка
     живёт в черновике до «Сохранить» — как имя, накладка и слоты. */
  builder:{editingTemplateId:null,editingPlacedId:null,slots:[],target:{mode:"add"},query:"",openSections:new Set(),
    snapshot:null,escArmed:null,wallType:null}
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
/* Разделы механизмов в конструкторе строит EPCatalogSections по «Функциональной группе»
   номенклатуры. Прежний mechanismOptions группировал <option> по categoryId, а его ставит
   эвристика classify() по названию — её разделы расходятся с теми, которыми думает заказчик
   («управление светом» размазано по пяти категориям). Вместе с <select> в слотах убран и он. */
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
  renderTemplates();renderAll();renderSummary();updateScaleUi();updateRateUi();applyPlanVisibility();
  renderLightingSchemeSelect();   /* селектор схемы в панели проекта: заполняем и на чистом старте */
  renderProjectWallTypeSelect();  /* тип стены проекта — там же, рядом со схемой */
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
function renderTemplates(){
  const list=$("postLibrary");
  if(!state.templates.length){list.innerHTML='<div class="library-empty">Сохранённых постов пока нет</div>';return}
  /* Миниатюра — то же собранное изделие, что в конструкторе (единая EPPostImage): рамка,
     разделение на посты/импосты и модули. Раньше здесь была россыпь иконок механизмов —
     по замечанию владельца «нет получившегося полного изображения рамки и модулей». */
  list.innerHTML=state.templates.map(t=>{
    /* Бейдж — занятость модулей рамки (тот же расчёт, что в конструкторе: занятые модули
       mechanismModulesTotal из ёмкости накладки frameSlotCount), а НЕ число механизмов.
       Раньше показывали placeWord(число механизмов) — «2 места» рядом с авто-именем «Пост на
       3 модуля» читалось как противоречие/счётчик размещений. Рамки может не быть (битый
       шаблон из старого проекта) — тогда честно показываем только занятые модули, без
       выдуманного «из N», а совсем пустой пост помечаем словом, а не «0 из 0». */
    const cap=frameSlotCount(frameProduct(t.frameId));
    const used=mechanismModulesTotal(t.mechanismIds);
    const badge=cap?`Занято ${used} из ${cap}`:(used?moduleWord(used):"пустой пост");
    return `<div class="library-card">
    <div class="library-title"><strong>${esc(t.name)}</strong><span>${esc(badge)}</span></div>
    <div class="library-thumb">${assembledPostHtml(t,{size:"sm"})}</div>
    <div class="library-actions"><button class="place" data-place-template="${t.id}">Разместить</button><button data-edit-template="${t.id}">✎</button><button data-delete-template="${t.id}">×</button></div>
  </div>`;
  }).join("");
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
  /* Объект, не попавший ни в одну комнату (даже с допуском у границы), помечаем ВИДИМО — раньше
     это всплывало только в toast при перетаскивании, и пост, выпавший из комнаты из-за
     перетрассировки контуров, оставался незамеченным (а теперь это решает деньги: другая схема
     проводки). Помечаем только когда комнаты в проекте вообще есть — иначе «без комнаты» у всего
     подряд было бы шумом. roomId уже пересчитан recalculateRoomAssignments перед этим рендером. */
  if(state.rooms.length&&entity.roomId==null)el.classList.add("no-room");
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
/* Тонкая обёртка над EPRoomCarry: пересчёт уничтожает авто-комнаты и заводит новые, а набранное
   человеком имя/площадь (в отличие от правки вершин) autoPolygon не снимает и теряется. Чистое
   сопоставление старых и новых по геометрии — в модуле; здесь только применяем его план к
   свежепостроенным объектам. Ручные комнаты (autoPolygon===false) не источники и не цели. */
function carryUserRoomFields(oldAutoRooms,newRooms){
  EPRoomCarry.carry(oldAutoRooms,newRooms,EPGeom).forEach(t=>{
    const room=newRooms.find(r=>r.id===t.toId);
    if(!room)return;
    if(t.name!=null)room.name=t.name;
    if(t.area!=null)room.area=t.area;
    /* Своя схема электрики комнаты переносится вместе с именем/площадью: пересчёт контуров зовётся
       автоматически (scheduleRoomsFromLines), и без переноса схема стиралась бы при каждой правке
       линий разметки. Отсутствие в переносе (t.lightingScheme==null) поля не создаёт — комната
       остаётся «как в проекте». */
    if(t.lightingScheme!=null)room.lightingScheme=t.lightingScheme;
  });
}
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
const {polygonCentroid,polygonAreaPx,pointInPolygon,componentAt,distancePointToSegment}=EPGeom;
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
      const c=polygonCentroid(poly);
      const room={id:uid("room_"),name:"Комната "+(++next),area:"",polygon:poly,autoPolygon:true,seedX:c.x,seedY:c.y,x:c.x-45,y:c.y-16};
      state.rooms.push(room);built.push(room);
    });
    carryUserRoomFields(oldAuto,built);   /* вернуть имя/площадь, введённые вручную, на совпавшие комнаты */
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
    /* уничтожаемые авто-комнаты — источники переноса ручных полей на новые (по геометрии) */
    const oldAuto=state.rooms.filter(r=>r.autoPolygon);
    /* вручную поправленные контуры сохраняем, как и в OpenCV-режиме */
    state.rooms=state.rooms.filter(r=>!r.autoPolygon);
    const kept=state.rooms.length;
    let next=state.rooms.reduce((max,r)=>{const m=/^Комната\s+(\d+)$/.exec(r.name||"");return m?Math.max(max,Number(m[1])):max},0);
    const built=[];
    res.rooms.forEach(rm=>{
      const poly=EPFloorplanML.mapPolygon(rm.polygon,res,cw,ch);
      const c=polygonCentroid(poly);
      const room={id:uid("room_"),name:"Комната "+(++next),area:"",polygon:poly,autoPolygon:true,seedX:c.x,seedY:c.y,x:c.x-45,y:c.y-16};
      state.rooms.push(room);built.push(room);
    });
    carryUserRoomFields(oldAuto,built);   /* вернуть имя/площадь, введённые вручную, на совпавшие комнаты */
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
    /* Курс — настройка проекта: пересчитывается КАЖДОЕ число с ценой, включая карточку
       выбранного объекта. Перечисления потребителей здесь нет намеренно (applyProjectSettings). */
    applyProjectSettings();
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

/* Контекст привязки: комнаты, разделённые на контурные (polygon) и grid-комнаты (без контура,
   привязка по компоненту связности), и одна карта пространства на всех. Готовит его вызывающий
   ОДИН раз — recalculateRoomAssignments не должен строить карту на каждый объект. prebuiltMap —
   карта, снятая на старте перетаскивания (переиспользуется в getRoomForPoint при подсветке). */
function roomResolveContext(prebuiltMap=null){
  const polyRooms=state.rooms.filter(r=>r.polygon&&r.polygon.length>2);
  const gridRooms=state.rooms.filter(r=>!(r.polygon&&r.polygon.length>2));
  let map=prebuiltMap;
  if(gridRooms.length){
    map=map||buildSpaceComponents();
    gridRooms.forEach(r=>{if(r.seedX==null){r.seedX=r.x+55;r.seedY=r.y+18}r.componentId=componentAt(map,r.seedX,r.seedY)});
  }
  return {polyRooms,gridRooms,map};
}

/* ⚠️ ЕДИНОЕ ПРАВИЛО «В КАКОЙ КОМНАТЕ ТОЧКА». Раньше оно жило в ДВУХ местах (getRoomForPoint для
   подсветки при перетаскивании и отдельная копия в recalculateRoomAssignments для фактической
   привязки) — расхождение показало бы одну комнату под курсором, а записало бы другую. Сведено
   сюда, потребители лишь готовят контекст. Порядок ветвей — от сильнейшего свидетельства к
   слабейшему; менять его нельзя:
     1) настоящее попадание в КОНТУР комнаты (pointInPolygon) — прямое доказательство «точка внутри»;
     2) ДОПУСК у границы контура (EPRoomAssign): выключатель у дверного проёма стоит центром ровно
        на линии, pointInPolygon считает это «снаружи». Попадание в допуск означает «объект
        фактически на этом контуре» — сильное свидетельство, поэтому идёт РАНЬШЕ grid. Допуск ищет
        ближайший КОНТУР, grid-комнаты в нём не участвуют — у них контура нет;
     3) и только в последнюю очередь — GRID-комната (по компоненту связности), для комнат без
        контура. Grid-совпадение означает лишь «в той же компоненте связности, что и подпись
        комнаты», а компонента через дверные проёмы накрывает всю квартиру — это самое слабое
        свидетельство и обязано быть последним. Иначе одна ручная комната-подпись перехватывала бы
        объект, стоящий ровно на контуре ДРУГОЙ, полигональной комнаты (замер ревью: пост на
        контуре Спальни при наличии подписи «Кухня» доставался Кухне). */
function resolveRoomForPoint(cx,cy,ctx){
  const hit=ctx.polyRooms.find(r=>pointInPolygon(cx,cy,r.polygon));
  if(hit)return hit;
  const near=EPRoomAssign.nearestRoomWithinTolerance(cx,cy,ctx.polyRooms,EPConfig.roomEdgeTolerance,distancePointToSegment);
  if(near)return near;
  if(ctx.map&&ctx.gridRooms.length){
    const component=componentAt(ctx.map,cx,cy);
    if(component>=0){const g=ctx.gridRooms.find(r=>r.componentId===component);if(g)return g}
  }
  return null;
}

function getRoomForPoint(x,y,map=null){
  if(!state.rooms.length)return null;
  return resolveRoomForPoint(x,y,roomResolveContext(map));
}

function updateObjectRoom(entity){
  const room=getRoomForPoint(entity.x+12,entity.y+12);
  entity.roomId=room?.id||null;
  return room;
}

function recalculateRoomAssignments(){
  const ctx=roomResolveContext();   /* карта пространства строится один раз на весь пересчёт */
  [...state.devices,...state.posts].forEach(obj=>{
    obj.roomId=resolveRoomForPoint(obj.x+12,obj.y+12,ctx)?.id||null;
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
/* ⚠️ ЕДИНАЯ ТОЧКА «НАСТРОЙКА ПРОЕКТА ИЗМЕНИЛАСЬ». Обработчик настройки пишет значение
   в EP_DATA.settings и зовёт ТОЛЬКО applyProjectSettings() — россыпь render* по обработчикам
   больше не пишем.

   ЗАЧЕМ. Настройка проекта (схема электрики, тип стены, валюта, курс, надбавка, условия
   сделки) по определению касается ВСЕГО проекта, а не одного объекта: обновиться обязаны все,
   кто её показывает. Пока каждый обработчик перечислял потребителей сам, каждый забывал
   своего — и это был не единичный промах, а один класс дефекта, повторявшийся на каждой
   новой настройке:
     · смена схемы электрики не звала renderProperties — карточка выбранного поста держала
       старый состав и старую стоимость, пока человек не переключится на другой объект;
     · загрузка курса ЦБ (refreshRate) и ручной ввод курса — тот же пропуск renderProperties:
       каталог и смета пересчитывались в рубли, а цена в карточке оставалась в евро;
     · смена типа стены не трогала каталог/шаблоны, хотя подбор коробки у них тот же.
   Расстановка недостающих вызовов по обработчикам этот класс НЕ лечит: следующая добавленная
   настройка заводит его заново — ровно так он и появился здесь трижды.

   ПОЧЕМУ ТАК. Список потребителей должен существовать в ОДНОМ месте — тогда у правки
   физически нет краёв (то же правило, что у EPPosts.boxCount и EPEstimate.postPrice: правило
   в чистой функции, а не размноженное по вызывающим). Новый обработчик настройки не обязан
   помнить, кто ещё её показывает; новый потребитель дописывается сюда один раз и появляется
   во всех обработчиках сразу.

   ПЕРЕРИСОВЫВАЕМ ВСЁ, без разбора «эта настройка влияет только на смету». Такой разбор и есть
   тот самый список, который каждый раз забывают: тип стены влияет на подбор коробки, схема —
   на подстановку механизмов, курс и надбавка — на любое число с ценой, а цены живут и в
   каталоге, и в шаблонах, и в карточке объекта, и в смете. Цена полной перерисовки мала:
   смена настройки — редкое осознанное действие человека, а не кадр анимации.

   ПОРЯДОК. Сперва органы самих настроек (селектор обязан показать записанное значение — иначе
   панель уверяет одно, а расчёт идёт по другому), затем всё, что от настроек считается.
   Сохранение — тоже здесь: изменённая настройка всегда часть проекта, отдельно помнить об
   этом обработчику не нужно.

   ГРАНИЦА. Сюда идёт всякая настройка, от которой зависит хоть что-то ПОКАЗАННОЕ НА ЭКРАНЕ —
   состав, цена, сумма (это все поля EP_DATA.settings, уезжающие в снимок проекта как terms:
   схема, тип стены, валюта, курс, надбавка, работы, материалы, скидка, НДС). Решение тут
   двоичное («видно ли это где-то сейчас?»), а не список потребителей, и при сомнении верный
   ответ — звать applyProjectSettings: лишняя перерисовка безвредна, пропущенная — дефект.
   Снаружи остаются ровно две группы, и у обеих потребитель ровно один:
     · режимы разметки (orthoMode, snapGrid, gridStep, planVisibility) — они в state, а не в
       settings, и их читает только холст (snapPlanPoint / applyGridStyle / applyPlanVisibility);
     · реквизиты КП (settings.docHeader) — их не показывает никто, кроме собственных полей
       ввода; в документ они попадают в момент печати (docHeader() → offerPdf/installSheet). */
function applyProjectSettings(){
  /* 1) органы настроек — показывают ровно то, что записано в EP_DATA.settings */
  updateRateUi();                  /* валюта, курс, надбавка */
  renderLightingSchemeSelect();    /* схема: селектор в панели проекта + строка для чтения в конструкторе */
  renderProjectWallTypeSelect();   /* тип стены проекта */
  /* 2) потребители: от настроек зависят состав постов, цены и суммы */
  renderAll();                     /* объекты плана: подбор коробки и механизмов мог измениться */
  renderTemplates();
  renderProperties();              /* карточка выбранного объекта — тот самый забываемый потребитель */
  renderSummary();
  scheduleSave();                  /* renderAll его уже зовёт, но здесь это явная часть контракта */
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
    <dl><dt>Накладка</dt><dd>${esc(frame?.name)}</dd><dt>Коробки</dt><dd>${boxCell}</dd><dt>Стоимость поста</dt><dd>${money(postTotalCost(obj))}</dd></dl>`;
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
/* Какой комнате принадлежат СМОНТИРОВАННЫЕ сейчас поля #roomName/#roomArea. Нужен flushRoomDraft:
   поля читаются из DOM, но по одному DOM не понять, чью комнату они правят, — а панель может уже
   перерисовываться для ДРУГОЙ комнаты, и коммит обязан уйти в ту, чьи поля стоят на экране.
   Пишется в ветке комнаты (см. ниже) там же, где монтируются поля; переживает смену выделения. */
let mountedRoomId=null;
/* Коммит незавершённого черновика комнаты ДО замены props.innerHTML (см. EPRoomDraft — там
   зачем и почему). Решение о коммите — в чистой функции; здесь только чтение полей из DOM и
   применение результата (renderRooms/persistProject, как в saveRoom, БЕЗ renderProperties —
   рекурсии между ними нет). */
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
  });
}
function flushRoomDraft(){
  const nameEl=$("roomName"),areaEl=$("roomArea");
  if(!nameEl||!areaEl)return;                          /* ветка комнаты не смонтирована → но-оп */
  const room=state.rooms.find(x=>x.id===mountedRoomId);   /* нет → комнату удалили, не воскрешаем */
  const res=EPRoomDraft.commit({name:nameEl.value,area:areaEl.value},room||null);
  if(!res.commit)return;
  room.name=res.name;room.area=res.area;
  updateRoomLabelText(room);   /* точечно, без renderRooms — flush идёт из beginPress (см. выше) */
  persistProject();
}
/* §7.1: где живёт выделенная сущность — ОДНА карта kind→поиск на входе панели свойств. Ветки
   берут готовый объект отсюда и второй способ его искать не заводят. Стена лежит в двух
   списках (ручные + автообрисовка) — склейка та же, что в applySelectionClasses/removeWall. */
function findSelectedEntity(kind,id){
  if(kind==="device")return state.devices.find(x=>x.id===id);
  if(kind==="post")return state.posts.find(x=>x.id===id);
  if(kind==="wall")return [...state.walls,...state.autoWalls].find(x=>x.id===id);
  if(kind==="room")return state.rooms.find(x=>x.id===id);
  return null;
}
function renderProperties(){
  flushRoomDraft();   /* §7.1: правило «сначала закоммить черновик» в одной точке — покрывает все ~25 вызовов */
  if(!state.selected){props.className="empty-properties";props.innerHTML="Выберите объект на плане";return}
  const {kind,id}=state.selected;
  /* §7.1: одна проверка «выделенная сущность ещё жива» ДО входа в ветки. Пересчёт контуров
     (buildRoomsFromLines) удаляет авто-комнаты и создаёт заново с новым id, а state.selected
     на старую комнату никто не чистит — та же дыра во всех ветках (d/p/r читались без проверки).
     Нет объекта → выделение недействительно: снимаем его, гасим подсветку на холсте точечно
     (applySelectionClasses, без renderAll — инвариант beginPress), показываем то же пустое
     состояние, что при !state.selected, вместо TypeError. */
  const entity=findSelectedEntity(kind,id);
  if(!entity){state.selected=null;applySelectionClasses();props.className="empty-properties";props.innerHTML="Выберите объект на плане";return}
  props.className="";
  if(kind==="device"){
    const d=entity,p=product(d.productId);
    const room=state.rooms.find(r=>r.id===d.roomId);
    props.innerHTML=`<label>Элемент<input value="${esc(p.name)}" disabled></label>
    <label>Комната<input value="${esc(room?.name||"Не назначена")}" disabled></label>
    <label>Высота установки<input id="propHeight" value="${esc(d.height||"300 мм")}"></label>
    <label>Цена<input value="${productMoney(p)}" disabled></label>
    <div class="property-actions"><button class="btn ghost" id="removeSelected">Удалить</button></div>`;
    /* ⚠️ ПРАВКА В ПАНЕЛИ СВОЙСТВ ОБЯЗАНА СОХРАНЯТЬСЯ — то же правило, что у ветки комнаты ниже
       (saveRoom → persistProject). Здесь высота писалась только в объект в памяти: она попадала
       в подсказку и в лист монтажника, но исчезала при перезагрузке страницы, если после неё
       ничего больше не двигали. Кнопки «Сохранить» у одиночного элемента нет — поле одно, —
       поэтому сохраняем отложенно, прямо по вводу (scheduleSave склеивает поток нажатий). */
    $("propHeight").oninput=e=>{d.height=e.target.value;scheduleSave()};
    $("removeSelected").onclick=()=>removeEntity(kind,id);
  }else if(kind==="post"){
    const p=entity;
    const room=state.rooms.find(r=>r.id===p.roomId);
    /* ⚠️ КАРТОЧКА ОБЯЗАНА БЫТЬ СОГЛАСОВАНА САМА С СОБОЙ. «Механизмов / коробок» считает состав
       ПОСТА (post.mechanismIds — то, что занимает модули рамки), а «Стоимость» — полная цена
       поста, в которую входят и механизмы групп света (EPEstimate.postPrice; они стоят ЗА
       клавишами и в mechanismIds не входят и войти не могут). Рядом стояли несогласованные
       число и цена: три механизма, а денег на четыре. Поэтому подставленные расчётом механизмы
       названы ОТДЕЛЬНОЙ строкой — теми же словами и тем же фильтром (billableLighting), что в
       панели «Состав поста» конструктора и в смете. Расчёт групп света берём ОДИН на карточку
       (он же уходит в цену), иначе панель считала бы его дважды на каждое выделение.
       ⚠️ Формулировку строки собирает ОДНА функция lightingRowSummary — она же в конструкторе:
       карточка была согласована ТОЛЬКО ПО НАЙДЕННЫМ и показывала «2 шт.» там, где мест
       управления три, — пробел подбора из неё было не видно. */
    const light=projectLighting();
    const lightSummary=lightingRowSummary(lightingRowsFor(p,light));
    /* Тип стены поста прямо в панели свойств. ⚠️ ОТСУТСТВИЕ post.wallType — это «как в проекте»,
       а не «unknown» (EPPosts.postWallType), поэтому «свой» и «унаследован» — РАЗНЫЕ состояния,
       и показываем их по-разному: ownWall различает наличие собственного поля у поста, curWall —
       фактически действующий тип (свой либо проектный), projWall — значение проекта для подписи. */
    const projWall=EP_DATA.settings.wallType==="hollow"?"hollow":"solid";
    const ownWall=p.wallType==="solid"||p.wallType==="hollow";
    const curWall=EPPosts.postWallType(p,EP_DATA.settings.wallType);
    props.innerHTML=`<label>Пост<input value="${esc(postNumberLabel(p))}" disabled></label>
    <label>Комната<input value="${esc(room?.name||"Не назначена")}" disabled></label>
    <label>Механизмов / коробок<input value="${p.mechanismIds.length} / ${postComposition(p).boxCount}" disabled></label>
    <label>Тип стены<select id="postWallSelect">
      <option value="solid"${curWall==="solid"?" selected":""}>Бетон, кирпич, сплошные стены</option>
      <option value="hollow"${curWall==="hollow"?" selected":""}>ГКЛ и полые стены</option>
    </select></label>
    <small class="prop-hint prop-wall-source${ownWall?" own":""}">${ownWall?"Свой тип стены поста":`Унаследован от проекта: ${esc(WALL_STEP_LABEL[projWall]||projWall)}`}</small>
    ${lightSummary?`<label>Механизмы групп света<input value="${esc(lightSummary.text)}" disabled></label>`:""}
    <label>Стоимость<input value="${money(postTotalCost(p,light))}" disabled></label>
    <div class="property-actions"><button class="btn primary" id="editSelected">Редактировать</button><button class="btn ghost" id="removeSelected">Удалить</button></div>`;
    $("editSelected").onclick=()=>openPostBuilder({placedId:id});$("removeSelected").onclick=()=>removeEntity(kind,id);
    /* Правка типа стены поста — тем же механизмом охвата, что и конструктор (savePostBuilder →
       askWallScope): охват спрашиваем ДО любых записей, пишем ЯВНО каждому адресату из
       EPPosts.wallTypeTargets (даже при совпадении с проектом — иначе выбор «уедет» вслед за
       настройкой проекта), а вопрос задаём только когда однотипных больше одного. Настройку
       проекта EP_DATA.settings.wallType отсюда НЕ трогаем — правится лишь в панели проекта
       (принцип из бага B5); перерисовываем в обработчике по действию человека, а не в теле
       renderProperties, поэтому renderAll здесь допустим. */
    $("postWallSelect").onchange=async e=>{
      const wall=e.target.value==="hollow"?"hollow":"solid";
      /* Выбор уже действующего значения ничего не меняет и не «прибивает» унаследованный тип к
         посту — то же условие, что wallChanged в savePostBuilder. */
      if(wall===EPPosts.postWallType(p,EP_DATA.settings.wallType))return;
      let scope="self";
      const twins=EPPosts.wallTypeTargets(state.posts,p,"sameType");
      if(twins.length>1){
        scope=await askWallScope(twins.length,wall);
        if(!scope){renderProperties();return}   /* отказ — ничего не пишем, select возвращаем к прежнему значению */
      }
      EPPosts.wallTypeTargets(state.posts,p,scope).forEach(x=>{x.wallType=wall});
      renderAll();renderProperties();renderSummary();persistProject();
      toast(scope==="sameType"?"Тип стены обновлён у поста и всех однотипных":"Тип стены поста обновлён");
    };
  }else if(kind==="wall"){
    const wobj=entity;
    const len=wobj?Math.round(Math.hypot(wobj.b.x-wobj.a.x,wobj.b.y-wobj.a.y)):0;
    props.innerHTML=`<label>Тип<input value="${wobj?.auto?"Стена (автообрисовка)":"Стена (вручную)"}" disabled></label>
    <label>Длина на холсте<input value="${len} px" disabled></label>
    <div class="property-actions"><button class="btn ghost" id="removeSelected">Удалить линию</button></div>`;
    $("removeSelected").onclick=()=>removeWall(id);
  }else{
    const r=entity;
    const roomObjects=getObjectsInRoom(r.id);
    const isPoly=r.polygon&&r.polygon.length>2;
    const autoArea=roomAutoAreaText(r);
    const areaHint=!isPoly?"Контур не определён — площадь задаётся вручную"
      :state.pxPerMeter?`Расчёт по контуру: ${autoArea}`
      :`Задайте масштаб плана, чтобы получить м². Сейчас контур: ${Math.round(polygonAreaPx(r.polygon)).toLocaleString("ru-RU")} px²`;
    /* Схема электрики комнаты. ⚠️ ОТСУТСТВИЕ r.lightingScheme — это «как в проекте», а не «своя»
       (EPRoom.roomLightingScheme): ownScheme различает наличие собственной валидной схемы у
       комнаты, curScheme — фактически действующую (свою либо проектную). Названия и пометку
       «расчёт недоступен» берём из единого списка EPLightingGroups.SCHEMES — второй копии нет.
       В отличие от типа стены поста, у комнаты есть ЯВНЫЙ возврат к наследованию — пункт «Как в
       проекте»: он снимает поле (см. обработчик), а не пишет в него значение проекта. */
    const projScheme=lightingScheme();
    const projSchemeItem=EPLightingGroups.SCHEMES.find(s=>s.id===projScheme);
    const ownScheme=EPLightingGroups.SCHEMES.some(s=>s.id===r.lightingScheme)?r.lightingScheme:null;
    const curScheme=EPRoom.roomLightingScheme(r,projScheme,EPLightingGroups.SCHEMES);
    const curSchemeItem=EPLightingGroups.SCHEMES.find(s=>s.id===curScheme);
    const schemeLabel=item=>`${item.label}${item.supported?"":" — расчёт недоступен"}`;
    const schemeOptions=`<option value=""${ownScheme?"":" selected"}>Как в проекте${projSchemeItem?` (${esc(projSchemeItem.label)})`:""}</option>`
      +EPLightingGroups.SCHEMES.map(item=>`<option value="${esc(item.id)}"${item.id===ownScheme?" selected":""}>${esc(schemeLabel(item))}</option>`).join("");
    props.innerHTML=`<label>Название комнаты<input id="roomName" value="${esc(r.name)}" autocomplete="off"></label>
    <label>Площадь<input id="roomArea" value="${esc(r.area||"")}" placeholder="${esc(autoArea||"Например, 18,6 м²")}" autocomplete="off"></label>
    <small class="prop-hint">${esc(areaHint)}${r.area?.trim()?" · сейчас показано ручное значение":""}</small>
    ${isPoly?`<div class="prop-hint-row"><span>Вершин контура: <b>${r.polygon.length}</b>${r.edited?" · контур правился вручную":""}</span>
      <button class="link-btn" id="editRoomPolygon">Править контур</button></div>`:""}
    <div class="room-equipment-box"><div class="room-equipment-head"><span>Оборудование комнаты</span><b>${roomObjects.length}</b></div>
      ${roomObjects.length?roomObjects.map(o=>`<div class="room-equipment-row"><span>${esc(o.name)}</span><small>${o.kind==="post"?"Пост":"Элемент"}</small></div>`).join(""):'<div class="room-equipment-empty">В этой комнате пока нет оборудования</div>'}
    </div>
    <button class="btn primary full" id="saveRoomProps" style="margin-top:10px">Сохранить изменения</button>
    <div class="property-save-state" id="roomSaveState"></div>
    <label class="room-scheme-field">Схема электрики<select id="roomSchemeSelect">${schemeOptions}</select></label>
    <small class="prop-hint prop-scheme-source${ownScheme?" own":""}">${ownScheme?"Своя схема комнаты":`Унаследована от проекта: ${esc(projSchemeItem?projSchemeItem.label:projScheme)}`}</small>
    ${curSchemeItem&&!curSchemeItem.supported?`<small class="prop-hint prop-scheme-note">${esc(curSchemeItem.note)}</small>`:""}`;
    mountedRoomId=r.id;   /* этим полям принадлежит комната r — flushRoomDraft коммитит именно в неё */
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
    /* Схема электрики применяется СРАЗУ по change (как тип стены поста и высота элемента), а не
       через черновик имени/площади: у неё свой орган и своё немедленное действие. «Как в проекте»
       (value="") СНИМАЕТ поле — так комната возвращается к наследованию, а не запоминает текущую
       схему проекта как свою (иначе смена настройки проекта её бы уже не двигала). Перерисовку
       зовём из обработчика по действию человека (инвариант beginPress не нарушается — он про тело
       renderProperties). Расчёт групп света здесь НЕ трогаем (часть 3) — только хранение и вид. */
    $("roomSchemeSelect").onchange=e=>{
      const val=e.target.value;
      if(val)r.lightingScheme=val; else delete r.lightingScheme;
      /* ⚠️ СХЕМА КОМНАТЫ — ДЕНЕЖНАЯ НАСТРОЙКА (часть 3: расчёт групп света идёт по комнатам).
         renderSummary обязателен: #grandTotal/#specList/#lightingSummary пишутся ТОЛЬКО в нём,
         и без него панель показывала бы старую сумму, а кэш уже сброшен — следующий экспорт КП
         напечатал бы новую. Экран и документ об одном проекте противоречить не могут.
         Список потребителей тот же, что у схемы ПРОЕКТА (applyProjectSettings). */
      renderAll();renderProperties();renderSummary();persistProject();
    };
  }
}
/* ---- Группы света и схема электрики проекта (C8) ------------------------------------
   Правила схемы («сколько мест управления группой → какие роли механизмов») живут в чистом
   EPLightingGroups, связка с проектом (места из постов, подбор по каталогу, печатный блок) —
   в чистом EPLightingPlan. Здесь, как и в buildEstimate, только подстановка зависимостей
   приложения: доступ к каталогу и к настройкам проекта. */
const isKeyProduct=item=>!!item&&item.partRole==="key";
const isBareMechanism=item=>!!item&&item.partRole==="bare_mechanism";
/* Клавиша ли механизм с таким артикулом — ОДИН предикат на все правки слотов (чтение поста,
   замена механизма, миграция старых проектов). Ответ ТРЁХЗНАЧНЫЙ, как того требует
   EPBuilderSlots.keepsGroup: true — клавиша, false — товар в каталоге есть и клавишей не
   является, null — товара в каталоге НЕТ. Третий ответ не равен второму: артикул мог выпасть из
   прайса, и снимать по этому поводу группу нельзя — это стёрло бы настоящее место управления,
   которое расчёт обязан показать пробелом «потерянная клавиша» (EPLightingPlan.collect). */
const keySlotKind=id=>{const item=product(id);return item?isKeyProduct(item):null};
/* Схема электрики — свойство ПРОЕКТА (лежит рядом с типом стены в EP_DATA.settings и едет в
   terms). Нераспознанный идентификатор откатываем на классическую: она же дефолт data.js и
   она же требуемое поведение для проектов, сохранённых до появления поля. */
function lightingScheme(){
  const id=EP_DATA.settings.lightingScheme;
  return EPLightingGroups.SCHEMES.some(s=>s.id===id)?id:"classic";
}
/* Расчёт групп света ПО КОМНАТАМ: роль механизма (выключатель / переключатель / инвертор) зависит
   от числа мест группы, а у каждой комнаты своя схема электрики и свои группы — «Кухня» в двух
   комнатах это ДВЕ независимые группы (ЧАСТЬ 3). Раскрой по комнатам и слияние обратно в один план
   делает чистый EPLightingByRoom.planByRooms; здесь только подстановка зависимостей приложения.
   posts обычно state.posts; конструктор подаёт проект вместе с редактируемым постом (см.
   builderPostDraft), иначе показал бы выключатель там, где в проекте уже второе место той же группы.
   ⚠️ КОМНАТУ МЕСТА берём из поста (post.roomId), а не из места: место её не несёт, а привязка
   пересчитывается recalculateRoomAssignments на каждый renderAll. Карту строим из ТЕХ ЖЕ posts,
   по которым собраны места, — тогда и черновик конструктора попадает в свою комнату. */
function lightingFor(posts){
  const places=EPLightingPlan.collect(posts,{product,seriesOf:productSeries,isKey:isKeyProduct});
  const mechs=byKind("mechanism");
  /* ⚠️ ПОДБОР — СВОЙ (EPLightingPlan.resolveMechanism), а НЕ EPCatalog.compatibleMechanisms:
     тот при отсутствии пересечения серий возвращает ВЕСЬ список («лучше показать всё, чем
     ничего»), и механизм чужой серии молча уехал бы в смету — клавиша Plana с механизмом
     Eikon это неверная цена и физически несобираемый пост. Контракт модуля требует строгий
     null и изделие обязательно с артикулом.
     Неоднозначность (в серии несколько кандидатов на роль, разобрать нечем) не решаем монетой:
     копим и показываем человеку — см. ambiguityHtml. findMechanism — ОДНА замыкающая функция на
     все партиции, поэтому ambiguous копится сквозь них (planByRooms отдаёт ей один и тот же deps). */
  const ambiguous=new Map();
  const planDeps={
    seriesOf:productSeries,
    findMechanism:({role,series})=>{
      const found=EPLightingPlan.resolveMechanism({role,series},mechs);
      if(found.ambiguous)ambiguous.set(role+"|"+series.join("|"),{role,series,candidates:found.candidates});
      return found.product;
    }
  };
  const projScheme=lightingScheme();
  const roomById=new Map(state.rooms.map(r=>[r.id,r]));
  const roomOfPost=new Map((Array.isArray(posts)?posts:[]).map(p=>[p&&p.id, p&&p.roomId!=null?p.roomId:null]));
  /* Ранг комнаты для порядка блока групп света — тот же, что у листа монтажника (installSheetForProject):
     помещения в порядке state.rooms, «без комнаты» последним. Порядок задаётся здесь, а не в документе,
     чтобы он остался детерминированным (см. planByRooms). */
  const roomOrder=new Map(state.rooms.map((r,i)=>[r.id,i]));
  const plan=EPLightingByRoom.planByRooms({
    places,
    projectScheme:projScheme,
    projectSchemeLabel:(EPLightingGroups.SCHEMES.find(s=>s.id===projScheme)||{}).label||"",
    /* пост без комнаты (roomId пустой) → отдельная партиция со схемой проекта */
    partitionKeyOf:place=>{const rid=roomOfPost.get(place.postId);return rid==null?null:rid;},
    /* нераспознанный/отсутствующий id схемы у комнаты откатывается на проект — EPRoom.roomLightingScheme */
    schemeForPartition:key=>key==null?projScheme:EPRoom.roomLightingScheme(roomById.get(key),projScheme,EPLightingGroups.SCHEMES),
    /* подпись комнаты у группы/реле/пробела в документе; «без комнаты» — как в листе монтажника */
    labelForPartition:key=>key==null?"Без помещения":((roomById.get(key)||{}).name||""),
    /* порядок партиций = порядок помещений в листе монтажника; неизвестная/«без комнаты» — в конец */
    orderForPartition:key=>key==null?Infinity:(roomOrder.has(key)?roomOrder.get(key):Infinity),
    plan:EPLightingGroups.plan,
    planDeps
  });
  return {plan,places,
    rows:EPLightingPlan.rowsByPost(plan,places,EPLightingGroups.GAP_TEXTS),
    ambiguous:[...ambiguous.values()]};
}
/* Строки групп света ОДНОГО поста с номером модуля клавиши. Номер берём из той же
   EPPosts.moduleLayout, что рисует слоты конструктора: там сборка показана одним рядом слева
   направо, и «модуль 2» на экране обязан быть тем же модулем, что в строке группы света.
   ⚠️ ЛИСТ МОНТАЖНИКА ПЕРЕПИСЫВАЕТ ЭТОТ НОМЕР НА СВОЙ (см. buildPostSheet): в его карточке
   немецко-французская сборка разложена ПО ПОСТАМ-коробкам, и адрес модуля там «пост.модуль».
   Это не две нумерации одного экрана, а разные адреса разных представлений — внутри каждого
   документа адрес ровно один, и это то, что читает человек. */
function lightingRowsFor(post,light){
  if(!light)return[];
  const rows=light.rows.get(EPLightingPlan.postKey(post))||[];
  const layout=EPPosts.moduleLayout(post.mechanismIds,{product,mechanismSpan});
  return rows.map(r=>Object.assign({},r,
    {moduleLabel:layout[r.keyIndex]?layout[r.keyIndex].label:String(Number(r.keyIndex)+1)}));
}
/* СТРОКА «МЕХАНИЗМЫ ГРУПП СВЕТА» — ОДНА ФОРМУЛИРОВКА НА ВСЕ ЭКРАНЫ (карточка поста на плане и
   панель «Состав поста» в конструкторе).
   ⚠️ СОГЛАСОВАНО ПО МЕСТАМ, А НЕ ПО НАЙДЕННЫМ. Обе панели печатали число ПОДОБРАННЫХ механизмов
   («2 шт.»), и пост с тремя клавишами, у которого один механизм не подобрался (в Neve Up нет
   инвертора), показывал «3 механизма» и «2 механизма групп света» рядом — числа спорили друг с
   другом, а про пробел карточка молчала вовсе. Теперь строка называет и НУЖНО, и ПОДОБРАНО, и
   сам пробел — тем же способом, каким пробел называется в смете и в листе монтажника: словами,
   а не молчанием. Деньги при этом считаются по-прежнему только по подобранным (billableLighting
   — тот же фильтр, что в смете), пробел стоит 0 и цену не двигает.
   rows — строки мест ЭТОГО поста (lightingRowsFor). Мест нет вовсе → null: строки в панели не
   будет, как и раньше. */
function lightingRowSummary(rows){
  const c=EPEstimate.lightingCounts(rows);   /* счёт — в смете, рядом с billableLighting; здесь только слова */
  if(!c.need)return null;
  return Object.assign({},c,{
    text:c.gaps
      ? `${c.found} из ${c.need} · ${money(c.sum)} · без механизма: ${c.gaps}`
      : `${c.found} шт. · ${money(c.sum)}`});
}
/* Сумма подставленных механизмов по проекту — подпись в блоке «Группы света». Считается по
   тем же place.product, что и цена в смете (estimate.js берёт их из lightingOf). */
const lightingSum=light=>(((light&&light.plan.places)||[]).reduce((sum,p)=>sum+(p&&p.product?(Number(p.product.price)||0):0),0));

/* ---- Цена поста: ОДНА функция на все экраны и документы --------------------------------
   Дефект, ради которого это здесь: панель свойств и подсказка на плане считали postCost БЕЗ
   механизмов групп света, а конструктор и строка сметы — с ними, и один и тот же пост стоил
   77,86 € на плане и 103,65 € в смете. Формула теперь ровно одна и лежит в EPEstimate.postPrice
   (рядом со сметой, которая ею же считает строку поста), а здесь только подстановка
   зависимостей приложения — как и везде в оркестраторе.

   РАСЧЁТ ГРУПП СВЕТА КЭШИРУЕТСЯ, потому что теперь его спрашивают и подсказка (на каждое
   наведение), и панель свойств (на каждое выделение). Подпись кэша — ВСЁ, от чего расчёт
   зависит: схема электрики проекта, адреса постов (номер решает канонический порядок ролей!),
   наборы клавиш, их группы, ПРИВЯЗКА ПОСТА К КОМНАТЕ и ДЕЙСТВУЮЩАЯ СХЕМА КАЖДОЙ КОМНАТЫ (расчёт
   теперь идёт по комнатам — ЧАСТЬ 3), и сам факт загруженности каталога. Без комнат в подписи
   смена схемы у одной комнаты или переезд поста в другую комнату кэш не сбрасывали бы, и расчёт
   молча остался бы старым. Саму подпись собирает чистый EPLightingByRoom.cacheSignature — она
   под тестом. Изменилось что-то — считаем заново; не изменилось — ответ обязан быть тем же.
   Кэш здесь именно оптимизация: убери его — поведение не изменится. */
let _lightCache={sig:null,value:null};
function projectLighting(){
  const projScheme=lightingScheme();
  const sig=EPLightingByRoom.cacheSignature({
    projectScheme:projScheme,productCount:state.products.length,
    posts:state.posts,rooms:state.rooms,
    schemeOf:r=>EPRoom.roomLightingScheme(r,projScheme,EPLightingGroups.SCHEMES)});
  if(_lightCache.sig!==sig)_lightCache={sig,value:lightingFor(state.posts)};
  return _lightCache.value;
}
/* Полная цена поста = его состав + механизмы его групп света. light передают те, у кого расчёт
   уже на руках (конструктор, смета); остальные берут проектный (projectLighting). */
function postTotalCost(post,light){
  return EPEstimate.postPrice(postCost(post),lightingRowsFor(post,light===undefined?projectLighting():light));
}
/* Неоднозначный подбор: в серии клавиши на нужную роль нашлось НЕСКОЛЬКО голых механизмов, и
   разобрать их данными нечем. Молча выбрать один нельзя — это деньги и монтаж, поэтому
   показываем кандидатов человеку отдельным блоком (в расчёт такое место не попадает). */
function ambiguityHtml(light){
  const list=(light&&light.ambiguous)||[];
  if(!list.length)return"";
  return `<div style="margin:10px 0;padding:9px 11px;border:1px solid #f0d8c2;border-radius:10px;background:#fdf6ee;font-family:Arial,sans-serif;font-size:10px;color:#8a5a2f">`
    +`<b>Подбор механизма неоднозначен — выбор за проектировщиком</b>`
    +list.map(a=>`<div style="margin-top:4px">Роль «${esc(a.role)}», серия ${esc(a.series.join(", "))}: `
      +esc(a.candidates.map(c=>`${c.code||"без артикула"} — ${c.name}`).join("; "))+`</div>`).join("")
    +`</div>`;
}
/* Один блок «Группы света» на все документы и на панель проекта — по правилу «два документа об
   одном проекте не могут противоречить». Вёрстку собирает чистый EPLightingPlan.buildHtml,
   формулировки причин — из EPLightingGroups.GAP_TEXTS; своего словаря здесь нет намеренно. */
function lightingHtml(light,title){
  if(!light)return"";
  return EPLightingPlan.buildHtml(light.plan,{esc,money,title:title||"Группы света",total:lightingSum(light)})
    +ambiguityHtml(light);
}

/* Сам расчёт вынесен в js/estimate.js (EPEstimate) — чистая функция без state и DOM,
   чтобы её можно было накрыть автотестами (PLAN 7.1). Здесь остаётся только
   подстановка зависимостей приложения.
   light — готовый расчёт групп света (lightingFor). Передаётся аргументом, а не считается
   внутри, чтобы ОДИН и тот же расчёт ушёл и в смету, и в блок «Группы света» рядом: два
   независимых прохода могли бы разойтись между экраном и документом. */
function buildEstimate(light){
  const l=light||projectLighting();
  return EPEstimate.build({
    devices:state.devices,posts:state.posts,
    product,frameProduct,postCost,postComposition,
    /* Механизмы групп света — ОТДЕЛЬНЫЕ позиции состава, а не элементы поста: в
       post.mechanismIds они удвоили бы modulesTotal и сменили бы коробку с суппортом. */
    lightingOf:po=>lightingRowsFor(po,l),
    settings:EP_DATA.settings
  });
}
/* Явное предупреждение «часть объектов вне помещений» под блоком групп света НА ЭКРANE.
   ЗАЧЕМ отдельной строкой, а не только суффиксом «· Без помещения» у групп: тот суффикс
   виден, лишь когда осиротевший пост участвует в группе света; розетка или пост без групп
   его не покажут — а пост без комнаты теперь считается по схеме проекта, а не по своей, и
   это деньги. Строку добавляем ТОЛЬКО в #lightingSummary (renderSummary), не внутрь
   lightingHtml — иначе она уехала бы и в КП/лист монтажника (документы вне этой правки).
   Показываем, лишь когда комнаты в проекте есть и кто-то реально выпал. */
function orphanObjectsWarningHtml(){
  if(!state.rooms.length)return "";
  const orphans=[...state.devices,...state.posts].filter(o=>o.roomId==null).length;
  if(!orphans)return "";
  return `<div class="lighting-orphan-note">⚠ Вне помещений: ${orphans} — отмечены на плане. `
    +`Схема электрики у них считается по проекту; перетащите объект в комнату или подвиньте контур.</div>`;
}
function renderSummary(){
  const light=projectLighting();
  const est=buildEstimate(light);
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
  /* Тот же блок, что печатается в КП и листе монтажника: подставленные механизмы, потребность
     в импульсных реле и пробелы с их причинами. */
  $("lightingSummary").innerHTML=lightingHtml(light,"Группы света")+orphanObjectsWarningHtml();
  updateStatus();
}

/* Селектор схемы электрики: список строится ИЗ EPLightingGroups.SCHEMES, включая
   нереализованную «Звонковые кнопки» с её собственной пометкой. Второй копии названий и
   пояснений у интерфейса нет намеренно — она разошлась бы с расчётом.
   ⚠️ ОРГАН УПРАВЛЕНИЯ РОВНО ОДИН — в панели проекта. Схема электрики (как и тип стены) —
   настройка ВСЕГО проекта: её смена пересобирает механизмы групп света во всех постах разом.
   Раньше в конструкторе поста стоял ВТОРОЙ, полноценный select, писавший ту же настройку: человек
   менял схему «в этом посте» — и молча менял её всему проекту, ровно тот же дефект, что был у
   кнопок типа стены. Подтверждением его лечить неправильно: в окне конструктора КАЖДЫЙ орган —
   черновик, применяемый по «Сохранить» и откатываемый «Отменой», а этот один действовал бы
   мгновенно и необратимо; такой орган в этом окне — ловушка независимо от числа вопросов.
   Поэтому в конструкторе осталась строка ТОЛЬКО ДЛЯ ЧТЕНИЯ (#lightingSchemeValueBuilder):
   схема там нужна под рукой (в этом окне назначают группы клавишам), но не под правку.
   Название и пояснение и там, и там строятся из EPLightingGroups.SCHEMES — второй копии
   названий у интерфейса нет; отсутствующий в разметке узел просто пропускается. */
function renderLightingSchemeSelect(){
  const current=lightingScheme();
  const found=EPLightingGroups.SCHEMES.find(item=>item.id===current);
  const label=item=>`${item.label}${item.supported?"":" — расчёт недоступен"}`;
  const sel=$("lightingSchemeSelect");
  if(sel){
    sel.innerHTML=EPLightingGroups.SCHEMES.map(item=>
      `<option value="${esc(item.id)}"${item.id===current?" selected":""}>${esc(label(item))}</option>`).join("");
    sel.value=current;
  }
  /* Конструктор: то же значение, но текстом — правка отсюда невозможна по построению. */
  const view=$("lightingSchemeValueBuilder");
  if(view)view.textContent=found?label(found):(current||"—");
  ["lightingSchemeHint","lightingSchemeHintBuilder"].forEach(hintId=>{
    const hint=$(hintId);
    if(hint)hint.textContent=found?found.note:"";
  });
}
/* Тип стены ПРОЕКТА — значение по умолчанию для постов, которым свой тип стены не задавали
   (EPPosts.postWallType). Орган управления, как и у схемы, ровно один — в панели проекта:
   из окна поста настройка всего объекта больше не правится (см. savePostBuilder). */
function renderProjectWallTypeSelect(){
  const sel=$("projectWallTypeSelect");
  if(sel)sel.value=EP_DATA.settings.wallType==="hollow"?"hollow":"solid";
}

function openPostBuilder({templateId=null,placedId=null}={}){
  /* ВЗВЕДЁННОЕ «Разместить» СНИМАЕМ. Человек нажал «Разместить» у шаблона, передумал и пошёл
     редактировать — двойным кликом по посту на плане, кнопкой «✎» у шаблона или «Новый пост».
     Режим размещения переживал открытие окна, и первый же клик по плану после закрытия
     конструктора ставил объект, которого никто уже не ждал. Снимаем здесь, в ЕДИНОЙ точке
     входа в конструктор, а не в обработчике двойного клика: тот же капкан был у всех трёх
     путей открытия. */
  if(state.pending){state.pending=null;canvas.classList.remove("placing");updateStatus()}
  state.builder.editingTemplateId=templateId;state.builder.editingPlacedId=placedId;
  /* Каждое открытие начинается с чистого выбора: цель «добавить», пустой поиск и ВСЕ разделы
     каталога свёрнуты — «разделы могут быть изначально не раскрыты» (заказчик, 24.08). */
  state.builder.target={mode:"add"};state.builder.query="";state.builder.openSections=new Set();
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
  $("postName").value=src.name;$("postSlotCount").value=String(capacity);
  /* Слоты несут группу света ВМЕСТЕ с механизмом (js/builderSlots.js). Пост, сохранённый до
     появления групп, просто отдаёт пустые — это и есть верное поведение: пробел «группа не
     указана» честнее молчаливой подстановки.
     У ШАБЛОНА групп нет по определению (группа — свойство поста на плане, см.
     EPPosts.placementFields): шаблон, сохранённый до этого правила, отдаёт свои группы, и мы
     их здесь снимаем — иначе они уехали бы обратно в шаблон при следующем сохранении.
     keySlotKind — миграция старых данных ПРИ ЧТЕНИИ: группа, оставшаяся на не-клавише (розетка,
     фальшблок), снимается здесь же. Раньше она переживала цикл «открыть → Сохранить» и оживала
     фантомным местом управления после перезаливки прайса — см. EPBuilderSlots.fromPost. */
  state.builder.slots=placedId?EPBuilderSlots.fromPost(src,keySlotKind):EPBuilderSlots.clearGroups(EPBuilderSlots.fromPost(src,keySlotKind));
  /* Тип стены открываемого объекта: СВОЙ, если он задан (у поста на плане ИЛИ у шаблона —
     шаблон теперь тоже несёт свой тип стены), иначе тип стены проекта (EPPosts.postWallType —
     то же правило, по которому его читает подбор коробки, второй копии правила не заводим).
     Новый пост своего типа стены не имеет и открывается со значением проекта. */
  state.builder.wallType=EPPosts.postWallType(src,EP_DATA.settings.wallType);
  $("postFrameSelect").dataset.preferredFrameId=String(src.frameId??"");
  $("builderSearch").value="";
  renderLightingSchemeSelect();
  renderBuilder();$("postModal").classList.add("open");
  /* Снимок «как было при открытии» — по нему закрытие понимает, есть ли что терять (см.
     builderDirty). Берём ПОСЛЕ renderBuilder: он мог отфильтровать чужие механизмы и
     переупаковать порядок, и снимок «до» объявил бы нетронутый пост изменённым. */
  state.builder.snapshot=builderSignature();
  state.builder.escArmed=null;
  /* Фокус уводим ВНУТРЬ окна: без этого первый Tab уходит на элементы под модалкой (ловушка
     фокуса ниже держит его внутри, но начальную точку задать надо). */
  setTimeout(()=>{const el=$("builderSearch");if(el)el.focus()},0);
}

/* Контекст текущей отрисовки конструктора. Нужен обработчикам каталога: они перерисовывают
   ТОЛЬКО список карточек (renderBuilderCatalog) и не имеют права пересчитывать раскладку
   заново — иначе поиск и раскрытие раздела дёргали бы упаковку по постам. Пишется в одном
   месте, в renderBuilder. */
let builderCtx={mechs:[],addMax:0,maxPostCap:0,remaining:0,frame:null,errorHtml:""};

/* Тип стены, с которым конструктор СЕЙЧАС считает состав поста: черновик окна, а не общая
   настройка проекта. Пока окно закрыто (черновика нет), отвечает значением проекта — так
   вызывающему не нужно знать, открыт ли конструктор. */
const builderWallType=()=>state.builder.wallType||EP_DATA.settings.wallType||"solid";

/* Подпись текущего состояния конструктора: имя, накладка, тип стены и набор слотов с группами.
   Нужна ровно для одного вопроса — «есть ли что терять при закрытии» (см. builderDirty). Слоты
   кодирует чистая EPBuilderSlots.signature (JSON, а не склейка через разделитель: имя группы
   вводит человек, и запятая в нём законна).
   ТИП СТЕНЫ В ПОДПИСИ ОБЯЗАТЕЛЕН: он стал черновиком окна, и без него закрытие по Esc считало
   бы пост нетронутым и молча выбрасывало бы правку, о которой человек не предупреждён. */
function builderSignature(){
  return JSON.stringify([$("postName").value,String($("postFrameSelect").value||""),
    builderWallType(),EPBuilderSlots.signature(state.builder.slots)]);
}
const builderDirty=()=>state.builder.snapshot!=null&&builderSignature()!==state.builder.snapshot;

/* Цель «Заменить» помнится НОМЕРОМ слота, а перерисовка умеет и выкидывать слоты (чужой для
   новой накладки механизм, не влезающий в новое число модулей), и переставлять их (упаковка по
   постам накладки). Номер обязан проехать через ту же перестановку, что и слоты, иначе пометка
   молча переезжает на слот, который человек не выбирал, и следующая карточка каталога заменяет
   ЧУЖОЙ механизм (проверено: пометка с двухмодульного выключателя переехала на клавишу).
   Слота больше нет — цель честно сбрасывается в «добавить». */
function retargetBuilderSlot(tokenList){
  const target=state.builder.target;
  if(!target||target.mode!=="replace")return;
  const next=EPBuilderSlots.reindex(tokenList,target.index);
  state.builder.target=next<0?{mode:"add"}:{mode:"replace",index:next};
}

/* Пост в том виде, в каком его сейчас собирают в конструкторе. Нужен для расчёта групп света:
   роль механизма зависит от числа мест группы ПО ВСЕМУ ПРОЕКТУ, поэтому черновик обязан
   участвовать в расчёте наравне с постами плана. */
function builderPostDraft(frame){
  const fields=EPBuilderSlots.toPost(state.builder.slots);
  const placed=state.builder.editingPlacedId?state.posts.find(x=>x.id===state.builder.editingPlacedId):null;
  return {id:placed?placed.id:"builder-draft",number:placed?placed.number:"—",
    name:$("postName").value,frameId:frame&&frame.id,roomId:placed?placed.roomId:null,
    mechanismIds:fields.mechanismIds,keyGroups:fields.keyGroups,
    /* Тип стены — из ЧЕРНОВИКА окна: состав и цена в конструкторе обязаны показывать ту
       коробку, которую человек только что выбрал кнопкой, а не ту, что записана в проекте. */
    wallType:builderWallType()};
}
/* Проект глазами расчёта: посты плана + черновик — но черновик участвует ТОЛЬКО тогда, когда
   в конструкторе открыт пост, СТОЯЩИЙ НА ПЛАНЕ. Тогда он ПОДМЕНЯЕТ свой пост (фильтр по id), а
   не добавляется: иначе его клавиши посчитались бы дважды и группа из двух мест выглядела бы
   группой из четырёх.
   ⚠️ ШАБЛОН И НОВЫЙ ПОСТ В ПРОЕКТ НЕ ВХОДЯТ. Шаблон в библиотеке — заготовка, а не место на
   плане: пока окно его редактирования было открыто, черновик доклеивался к постам проекта и
   число мест каждой группы завышалось на единицу — у уже размещённого шаблона место считалось
   и от поста, и от черновика. Расчёт при этом показывал не тот механизм (два места вместо
   одного — переключатели вместо выключателя), а закрытие окна «чинило» цифры само собой, что
   выглядело случайным сбоем. Групп у шаблона теперь нет вовсе (см. renderBuilderSlots), но
   правило важнее их отсутствия: в расчёт проекта идёт то, что на плане. */
function projectPostsWithBuilder(frame){
  if(!state.builder.editingPlacedId)return state.posts;
  const draft=builderPostDraft(frame);
  return state.posts.filter(p=>p.id!==draft.id).concat([draft]);
}

function renderBuilder(){
  const count=Number($("postSlotCount").value),allMechanisms=byKind("mechanism");
  const frameSelect=$("postFrameSelect"),allFrames=byKind("frame");
  const matchingFrames=allFrames.filter(frame=>frameSlotCount(frame)===count);
  const frames=matchingFrames.length?matchingFrames:allFrames;
  /* ⚠️ dataset.preferredFrameId ГЛАВНЕЕ ТЕКУЩЕГО ЗНАЧЕНИЯ СЕЛЕКТА, а не наоборот.
     Тут был баг «двойной клик по посту на плане сбрасывает редактирование» (заказчик, 24.08:
     «вообще редактирование на плане у меня всё сбросилось… хотя причём при наведении показывает
     правильно»). Условие читалось `frameSelect.value||dataset` — а <select> живёт в разметке
     ПОСТОЯННО, и закрытие конструктора его не чистит. Со второго открытия в сессии в value
     лежала накладка ПРОШЛОГО поста и побеждала накладку открываемого: если её нет среди рамок
     нужной модульности, молча бралась frames[0] — первая накладка каталога, — механизмы поста
     отсеивались по чужой серии, и окно показывало «Занято 0 из N» с пустыми слотами. Подсказка
     на плане при этом читает сам пост и показывает верный состав, отсюда и «при наведении
     показывает правильно». Двойной клик здесь ни при чём: тот же сброс давала кнопка
     «Редактировать» в панели свойств.
     dataset ставится ровно там, где накладка задана ЯВНО (openPostBuilder — накладка
     открываемого поста; resolveMissingFrame — накладка, выбранная человеком в пустом поиске),
     и снимается сразу после применения. Значит его присутствие — это «выбор сделан здесь и
     сейчас», и спорить с ним остатку прошлой сессии нельзя. */
  /* Пустая строка в dataset — это тоже ЯВНОЕ «накладки нет» (пост без накладки), а не «нечего
     сказать»: подменять её остатком прошлой сессии так же неверно, как и настоящий артикул.
     Поэтому смотрим на НАЛИЧИЕ атрибута, а не на истинность его значения. */
  const hasExplicitFrame="preferredFrameId" in frameSelect.dataset;
  const explicitFrameId=hasExplicitFrame?frameSelect.dataset.preferredFrameId:"";
  const preferredFrameId=Number(hasExplicitFrame?explicitFrameId:frameSelect.value);
  /* Накладка поста может не пройти фильтр по числу модулей (frameSlotCount не знает
     многорядные 14/21-модульные накладки и отдаёт null) или выпасть из каталога как
     неактивная. Раньше её в таком случае молча подменяла frames[0] — и «Сохранить» переписывал
     post.frameId на первую попавшуюся накладку каталога, если она случайно оказалась
     совместимой. Поэтому явно заданную накладку ДОБАВЛЯЕМ в список: пусть человек видит в поле
     ту накладку, которая у поста на самом деле, и меняет её сам, если захочет. */
  const explicitFrame=explicitFrameId?frameProduct(explicitFrameId):null;
  const frameList=explicitFrame&&!frames.some(frame=>Number(frame.id)===Number(explicitFrame.id))
    ?[explicitFrame,...frames]:frames;
  const selectedFrameId=frameList.some(frame=>Number(frame.id)===preferredFrameId)?preferredFrameId:frameList[0]?.id;
  frameSelect.innerHTML=frameList.length
    ?frameOptions(frameList,selectedFrameId)
    :'<option value="">Рамки не загружены</option>';
  frameSelect.value=selectedFrameId==null?"":String(selectedFrameId);
  delete frameSelect.dataset.preferredFrameId;
  /* Накладка остаётся выпадающим списком EPPicker: их 1631, и разделами по функциональной
     группе они не режутся (группировка накладок — по СЕРИИ), а без поиска по артикулу с таким
     объёмом не жить. Пустой поиск объясняет, среди чего искали, и предлагает переключить
     размер, если артикул отсеян фильтром модулей. */
  enhancePicker(frameSelect,{
    emptyContext:matchingFrames.length?`накладок на ${moduleWord(count)}`:"загруженных накладок",
    resolveMissing:q=>resolveMissingFrame(q,count,frameSelect)
  });
  const selectedFrame=frameProduct(frameSelect.value);
  const mechs=compatibleMechanisms(selectedFrame,allMechanisms);
  /* ⚠️ ФИЛЬТРАЦИЯ И УПАКОВКА ИДУТ НАД ТОКЕНАМИ-ПОЗИЦИЯМИ СЛОТОВ, а не над id механизмов.
     Правила остаются те же самые (EPPosts.fitMechanismIds / distributePosts — второй копии
     раскладки не появляется), но вместе с механизмом переезжает и его группа света: id для
     этого не годится, в посте бывают два одинаковых механизма (см. js/builderSlots.js). */
  const fitDeps=EPBuilderSlots.tokenDeps(state.builder.slots,{product,mechanismSpan});
  const fitOrder=EPPosts.fitMechanismIds(EPBuilderSlots.tokens(state.builder.slots),
    EPBuilderSlots.allowedTokens(state.builder.slots,mechs),count,fitDeps);
  state.builder.slots=EPBuilderSlots.pick(state.builder.slots,fitOrder);
  retargetBuilderSlot(fitOrder);
  const occupied=mechanismModulesTotal(EPBuilderSlots.toPost(state.builder.slots).mechanismIds);
  const remaining=Math.max(0,count-occupied);
  /* Распределение механизмов по постам накладки (EPPosts.distributePosts): даёт превью с
     импостами/рядами, ограничивает ширину подбираемого механизма ёмкостью ПОСТА (не всей
     накладки) и ловит несовместимые сочетания — механизм шире поста или «размазанный»
     через импост. maxPostCap — самый широкий пост; addMax — наибольшее свободное место
     среди ВСЕХ постов: механизм такой ширины ещё влезает хоть в какой-то пост (напр. 2М
     идёт во второй пост немецкой 2+2, когда в первом занят один модуль). */
  const packDeps=EPBuilderSlots.tokenDeps(state.builder.slots,{product,mechanismSpan});
  const dist=EPPosts.distributePosts(EPBuilderSlots.tokens(state.builder.slots),selectedFrame,packDeps);
  /* Авто-раскладка: когда набор укладывается по постам без разрыва через импост, принимаем
     ПОРЯДОК из распределения (dist.posts, пост за постом) — так многомодульный механизм встаёт
     в слоты ВНУТРИ своего поста, а не верхом на импост, и нумерация слотов совпадает с превью
     и листом монтажника. Раньше порядок слотов не менялся, и 2М-механизм мог оказаться на
     границе постов, давая ложную «Несовместимое сочетание». Реордер идемпотентен (перепаковка
     уже упакованного даёт тот же порядок), поэтому цикла ре-рендеров не создаёт.
     dist посчитан по токенам, поэтому перестановка переносит и группы света. */
  if(dist.valid){
    const packedOrder=dist.posts.reduce((all,p)=>all.concat(p.mechanismIds),[]);
    if(packedOrder.length===state.builder.slots.length){
      state.builder.slots=EPBuilderSlots.pick(state.builder.slots,packedOrder);
      retargetBuilderSlot(packedOrder);
    }
  }
  const mechanismIds=EPBuilderSlots.toPost(state.builder.slots).mechanismIds;
  const maxPostCap=dist.maxCapacity||count;
  const addMax=EPPosts.maxFreeSpan(dist);
  /* Единое изображение собранного поста (крупно) — та же EPPostImage, что в библиотеке,
     подсказке, КП и листе монтажника. */
  $("postPreview").innerHTML=assembledPostHtml({frameId:selectedFrame&&selectedFrame.id,mechanismIds},{size:"lg"});
  $("builderCapacity").innerHTML=`<div class="builder-capacity-head"><strong>Заполнение рамки</strong><span>Занято ${occupied} из ${count} · ${remaining?`свободно ${moduleWord(remaining)}`:"рамка заполнена"}</span></div>
    <div class="module-meter" style="--module-count:${count}" aria-label="Занято ${occupied} из ${count} модулей">${Array.from({length:count},(_,index)=>`<span class="${index<occupied?"occupied":""}"></span>`).join("")}</div>`;
  /* Расчёт групп света — по всему проекту ВМЕСТЕ с черновиком поста (см. projectPostsWithBuilder). */
  const light=lightingFor(projectPostsWithBuilder(selectedFrame));
  const draft=builderPostDraft(selectedFrame);
  /* Нумерация модулей слота (одномодульный «2», двухмодульный «2–3») — общая чистая
     функция EPPosts.moduleLayout: тот же код считает позиции для листа монтажника,
     чтобы номера в конструкторе и в документе не разошлись. */
  const layout=EPPosts.moduleLayout(mechanismIds,{product,mechanismSpan});
  renderBuilderSlots(layout,remaining,lightingRowsFor(draft,light));
  /* errorHtml лежит в контексте, чтобы точечное обновление групп света (refreshBuilderLighting)
     могло перерисовать состав, не потеряв причину несовместимости: набор механизмов оно не
     меняет, значит и ошибка раскладки та же самая. */
  builderCtx={mechs,addMax,maxPostCap,remaining,frame:selectedFrame,errorHtml:builderErrorHtml(dist)};
  renderBuilderCatalog();
  renderBuilderComposition(selectedFrame,builderCtx.errorHtml,light,draft);
  /* Сохранять можно, только когда сборка физически собирается (никакой механизм не шире
     поста и не «размазан» через импост) и все посты заполнены целиком. */
  $("savePost").disabled=!(dist.valid&&dist.full);
}

/* Выбранные модули поста. Товар выбирается КАРТОЧКОЙ в каталоге справа, поэтому строка слота
   показывает выбранное, действия («заменить» / «убрать»), поле группы света у клавиши и
   подставленный расчётом механизм. lightRows — строки групп света ЭТОГО поста (по keyIndex). */
const GROUP_NAME_MAX=40;   /* предел длины имени группы света в поле ввода (см. groupField ниже) */
function renderBuilderSlots(layout,remaining,lightRows){
  const byKey=new Map((lightRows||[]).map(r=>[Number(r.keyIndex),r]));
  const target=state.builder.target;
  const rows=layout.map((slot,index)=>{
    const item=slot.item;
    const isTarget=target.mode==="replace"&&Number(target.index)===index;
    const row=byKey.get(index);
    /* Голый механизм в посте руками — законно (пост, собранный до появления расчёта), но
       предупреждаем: расчёт по группе света подставит механизм САМ, и второй такой же в
       соседнем слоте оплатится дважды. */
    const bareNote=isBareMechanism(item)
      ? `<div class="slot-bare">Голый механизм выбран вручную. Механизм за клавишей подставляет расчёт групп света — проверьте, что он не оплачен дважды.</div>` : "";
    /* Поле группы света есть ТОЛЬКО у поста, стоящего на плане. Группа — свойство места, а не
       заготовки: один шаблон ставится в три комнаты, и это три разные группы (см.
       EPPosts.placementFields). Пока поле было и у шаблона, человек заполнял его там, а
       размещение разносило одну группу по N постам — вместо N выключателей получалась проходная
       схема. Вместо поля — строка-объяснение: молча убрать ввод значило бы оставить человека
       гадать, куда он делся. */
    const groupField=!isKeyProduct(item)?""
      : state.builder.editingPlacedId
        /* maxlength — не украшение: имя группы печатается ЦЕЛИКОМ в блоке «Группы света» КП,
           листа монтажника и панели проекта, и без ограничения одно поле выдавливало соседнюю
           колонку документа. 40 знаков с запасом хватает и «Кухне», и «4.1», и «Спальня,
           бра у кровати» — а длиннее это уже не имя группы, а примечание. */
        ? `<label class="slot-group">Группа света<input type="text" data-slot-group="${index}" value="${esc(state.builder.slots[index]?.group||"")}" maxlength="${GROUP_NAME_MAX}" placeholder="например «Кухня» или «4.1»" autocomplete="off"></label>`
        : `<div class="slot-group-note">Группа света задаётся у поста на плане: разместите пост и укажите группу там. У шаблона её нет намеренно — один шаблон в трёх комнатах это три разные группы, а не одна на три места.</div>`;
    return `<div class="builder-slot${isTarget?" is-target":""}">
      <div class="slot-number" title="${esc(moduleWord(slot.span))}">${esc(slot.label)}</div>
      <div class="slot-body">${productPicture(item,{label:item?item.name:"Элемент"})}
        <span class="slot-text"><span class="slot-code">${esc(item?.code||"без артикула")}</span>
          <span class="slot-name" title="${esc(item?.name||"")}">${esc(item?.name||"Механизм не найден")}</span>
          <span class="slot-meta">${esc(moduleWord(slot.span))} · ${productMoney(item)}</span></span>
        <span class="slot-actions">
          <button type="button" data-slot-replace="${index}">${isTarget?"Отменить":"Заменить"}</button>
          <button type="button" data-slot-remove="${index}" aria-label="Убрать элемент из модуля ${esc(slot.label)}">×</button>
        </span>
      </div>${groupField}<div data-light-host="${index}">${lightSlotHtml(row)}</div>${bareNote}
    </div>`;
  }).join("");
  const addRow=remaining
    ? `<div class="builder-slot is-empty"><div class="slot-number">+</div>
        <div class="slot-hint">Свободно ${esc(moduleWord(remaining))} — выберите товар карточкой в каталоге справа.</div></div>` : "";
  const host=$("builderSlots");
  host.innerHTML=rows+addRow||'<div class="slot-hint">Пост пуст — выберите первый элемент в каталоге справа.</div>';
  bindProductPictureFallbacks(host);
  host.querySelectorAll("[data-slot-remove]").forEach(button=>button.onclick=()=>{
    state.builder.slots=EPBuilderSlots.removeAt(state.builder.slots,Number(button.dataset.slotRemove));
    state.builder.target={mode:"add"};renderBuilder();
  });
  host.querySelectorAll("[data-slot-replace]").forEach(button=>button.onclick=()=>{
    const index=Number(button.dataset.slotReplace),current=state.builder.target;
    state.builder.target=(current.mode==="replace"&&Number(current.index)===index)?{mode:"add"}:{mode:"replace",index};
    renderBuilder();
  });
  /* Группа света. На ввод только ЗАПОМИНАЕМ: перерисовка на каждом символе увела бы фокус из
     поля. На change (потеря фокуса или Enter) — ТОЧЕЧНОЕ обновление того, что от группы
     зависит: подставленный механизм в строках слотов и блок состава. Набор механизмов, ёмкость
     рамки и каталог от имени группы не зависят вовсе.
     ⚠️ ПОЧЕМУ НЕ renderBuilder(). Он перерисовывал ВЕСЬ конструктор вместе с каталогом, а
     change у поля срабатывает В МОМЕНТ НАЖАТИЯ на карточку товара (mousedown уводит фокус из
     поля). Карточка, получившая mousedown, к моменту mouseup была уже выброшена из DOM —
     браузеру не на чем породить click, и ПЕРВЫЙ клик после ввода группы пропадал: человек жал
     второй раз, не понимая, почему первый не сработал. Точечное обновление ничего под курсором
     не разрушает. Заодно перестал теряться и фокус: Tab из поля группы уходил на соседний
     слот, который тут же уничтожался, и фокус падал на body.
     Поле строго текстовое: <input type="number"> превратил бы «4.10» в 4.1 и склеил бы две
     разные группы плана заказчика в одну. */
  host.querySelectorAll("[data-slot-group]").forEach(input=>{
    const index=Number(input.dataset.slotGroup);
    input.oninput=()=>{state.builder.slots=EPBuilderSlots.setGroup(state.builder.slots,index,input.value)};
    input.onchange=()=>{state.builder.slots=EPBuilderSlots.setGroup(state.builder.slots,index,input.value);refreshBuilderLighting()};
    input.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();input.blur()}};
  });
}
/* Пересчёт ТОЛЬКО групп света: строки «что подставил расчёт» в слотах и блок состава поста.
   Роль механизма зависит от числа мест группы ПО ВСЕМУ ПРОЕКТУ, поэтому считаем полный расчёт
   — но в DOM трогаем ровно два места и ни одного элемента с обработчиком. Каталог, превью,
   заполнение рамки и кнопка «Сохранить» от имени группы не зависят и остаются как есть. */
function refreshBuilderLighting(){
  if(!$("postModal").classList.contains("open"))return;
  const frame=frameProduct($("postFrameSelect").value);
  const light=lightingFor(projectPostsWithBuilder(frame));
  const draft=builderPostDraft(frame);
  const byKey=new Map((lightingRowsFor(draft,light)||[]).map(r=>[Number(r.keyIndex),r]));
  $("builderSlots").querySelectorAll("[data-light-host]").forEach(hostEl=>{
    hostEl.innerHTML=lightSlotHtml(byKey.get(Number(hostEl.dataset.lightHost)));
  });
  renderBuilderComposition(frame,builderCtx.errorHtml,light,draft);
}
/* Что расчёт подставил за клавишу — или почему не подставил. Формулировка пробела берётся из
   EPLightingGroups.GAP_TEXTS (через lightingRowsFor), своего словаря у интерфейса нет. */
function lightSlotHtml(row){
  if(!row)return"";
  if(row.missing)return `<div class="slot-light is-missing">${esc(row.missingText||"механизм не подобран")}</div>`;
  const place=row.placeCount>1?` · место ${row.placeNo} из ${row.placeCount}`:"";
  return `<div class="slot-light">${esc(row.roleLabel)} · ${esc(row.code)} · ${esc(row.name)} · ${money(row.price)}${esc(place)}</div>`;
}

/* Каталог механизмов крупными карточками, разделами по «Функциональной группе» номенклатуры.
   Перерисовывается ОТДЕЛЬНО от остального конструктора: поиск и раскрытие раздела не должны
   пересчитывать раскладку по постам (и не должны ронять фокус из поля поиска — оно снаружи). */
function renderBuilderCatalog(){
  const host=$("builderCatalog");if(!host)return;
  const target=state.builder.target;
  const replacing=target.mode==="replace"?state.builder.slots[target.index]:null;
  /* ⚠️ ДВА ПРЕДЕЛА ШИРИНЫ — РОВНО ТЕ ЖЕ, что раньше стояли на <select> слота и строке
     «добавить»: при ЗАМЕНЕ слот освобождается, поэтому предел — ёмкость поста (maxPostCap);
     при ДОБАВЛЕНИИ — наибольшее свободное место среди всех постов накладки (addMax). Без
     второго двухмодульный механизм предлагался бы там, где свободен один модуль. */
  const maxSpan=replacing?builderCtx.maxPostCap:builderCtx.addMax;
  const replaceItem=replacing?product(replacing.id):null;
  $("builderTarget").innerHTML=replacing
    ? `Заменить выбранный модуль<small>Сейчас: ${esc(replaceItem?.name||"—")}. Карточка заменит его.</small>`
    : builderCtx.remaining
      ? `Добавить элемент в пост<small>Свободно ${esc(moduleWord(builderCtx.remaining))}. Нажмите карточку.</small>`
      : `Рамка заполнена<small>Уберите элемент или увеличьте число модулей.</small>`;
  if(!builderCtx.mechs.length){
    host.innerHTML='<div class="catalog-empty">Каталог механизмов не загружен — проверьте, что прайс подключён.</div>';return;
  }
  if(!replacing&&!builderCtx.remaining){
    host.innerHTML='<div class="catalog-empty">Все модули рамки заняты. Чтобы поменять элемент, нажмите «Заменить» в нужном модуле слева.</div>';return;
  }
  const result=EPCatalogSections.build(builderCtx.mechs,{
    spanOf:mechanismSpan,maxSpan,query:state.builder.query,
    /* Голые механизмы — отдельным разделом в самом конце: их подставляет расчёт групп света,
       вручную они нужны редко, а рядом с готовыми изделиями провоцируют двойную оплату. */
    asideOf:item=>isBareMechanism(item)?"Голые механизмы — подставляются расчётом":null
  });
  /* Поиск раскрывает разделы сам: иначе человек ищет артикул и видит свёрнутые заголовки. */
  const openAll=!!state.builder.query;
  if(!result.sections.length){
    host.innerHTML=`<div class="catalog-empty">${emptyCatalogHtml()}</div>`;return;
  }
  host.innerHTML=result.sections.map(section=>{
    const open=openAll||state.builder.openSections.has(section.key);
    const hidden=section.hiddenBySpan?` · скрыто ${section.hiddenBySpan}`:"";
    const body=open
      ? `<div class="catalog-grid">${section.items.map(productCardHtml).join("")||'<div class="catalog-empty">Все товары раздела шире свободного места.</div>'}</div>`
        +(section.hiddenBySpan?`<div class="catalog-note">Скрыто ${section.hiddenBySpan} — шире свободного места (${esc(moduleWord(maxSpan))}).</div>`:"")
      : "";
    return `<section class="catalog-section">
      <button type="button" class="catalog-section-head" aria-expanded="${open?"true":"false"}" data-section="${esc(section.key)}">
        <span><span class="caret" aria-hidden="true">${open?"▾":"▸"}</span>${esc(section.label)}</span>
        <span class="catalog-section-count">${section.items.length}${esc(hidden)}</span>
      </button>${body}</section>`;
  }).join("");
  bindProductPictureFallbacks(host);
  host.querySelectorAll("[data-section]").forEach(button=>button.onclick=()=>{
    const key=button.dataset.section;
    if(state.builder.openSections.has(key))state.builder.openSections.delete(key);else state.builder.openSections.add(key);
    renderBuilderCatalog();
  });
  host.querySelectorAll("[data-pick]").forEach(button=>button.onclick=()=>pickBuilderProduct(Number(button.dataset.pick)));
}
/* Карточка товара: крупное фото (detail — тот же кадр, что во взрыв-схеме), артикул, название,
   модульность и цена. Фото есть у 296 механизмов из 435 — у остальных productPicture рисует
   значок-фолбэк, высота бокса задана в CSS, поэтому сетка не рвётся. */
function productCardHtml(item){
  const badge=isBareMechanism(item)?'<span class="product-card-badge">подставляется расчётом</span>':"";
  return `<button type="button" class="product-card" data-pick="${item.id}" title="${esc(item.name||"")}">
    ${productPicture(item,{detail:true,label:item.name})}
    <span class="product-card-code">${esc(item.code||"без артикула")}</span>
    <span class="product-card-name">${esc(item.name||"Без названия")}</span>${badge}
    <span class="product-card-meta"><span>${esc(moduleWord(mechanismSpan(item)))}</span><b>${productMoney(item)}</b></span>
  </button>`;
}
/* Пустой результат поиска объясняет ПРИЧИНУ отсева тем же кодом, что и раньше объяснял её в
   выпадающем списке (resolveMissingMechanism): другая серия либо шире свободного места. */
function emptyCatalogHtml(){
  const query=state.builder.query;
  if(!query)return "В каталоге нет механизмов, подходящих к этой накладке.";
  const reason=resolveMissingMechanism(query,builderCtx.frame);
  const base=`По запросу «${esc(query)}» среди механизмов, совместимых с этой накладкой, ничего не найдено.`;
  return reason
    ? `${base}<div class="epk-empty-found"><div class="epk-empty-lead">${esc(reason.lead)}</div>`
      +`<div class="epk-empty-item">${esc(reason.code)} — ${esc(reason.name)}</div>`
      +`<div class="epk-empty-reason">${esc(reason.reason)}</div></div>`
    : base;
}
/* Выбор карточки: заменить помеченный слот либо добавить в конец. Группа света при ЗАМЕНЕ
   сохраняется (человек меняет клавишу на другую в том же месте той же группы) — но ТОЛЬКО
   если новый механизм сам является местом управления: чем клавиша стала розеткой или
   фальшблоком, там группе стоять не на чем (см. EPBuilderSlots.replaceAt). Признак клавиши
   даёт каталог, поэтому предикат подставляет оркестратор. */
function pickBuilderProduct(id){
  const target=state.builder.target,count=Number($("postSlotCount").value);
  if(target.mode==="replace"&&state.builder.slots[target.index]){
    const index=Number(target.index);
    state.builder.slots=EPBuilderSlots.replaceAt(state.builder.slots,index,id,keySlotKind);
    /* Та же защита от переполнения, что стояла на смене значения слота: лишние выкидываются
       с конца, только что выбранный остаётся (EPPosts.fitMechanismIdsPreserving). */
    const deps=EPBuilderSlots.tokenDeps(state.builder.slots,{product,mechanismSpan});
    state.builder.slots=EPBuilderSlots.pick(state.builder.slots,
      EPPosts.fitMechanismIdsPreserving(EPBuilderSlots.tokens(state.builder.slots),
        EPBuilderSlots.allowedTokens(state.builder.slots,builderCtx.mechs),count,index,deps));
  }else{
    state.builder.slots=EPBuilderSlots.add(state.builder.slots,id);
  }
  state.builder.target={mode:"add"};
  renderBuilder();
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
function renderBuilderComposition(selectedFrame,errorHtml="",light=null,draft=null){
  /* Тип стены берём из ЧЕРНОВИКА окна, а не из настроек проекта: кнопки теперь правят
     черновик, и подсветка активной кнопки обязана показывать выбор человека, иначе он жмёт
     «ГКЛ», а подсвеченным остаётся «бетон». */
  const wall=builderWallType();
  /* Кнопки «Тип стены» активны ВЕЗДЕ — и у поста на плане, и у шаблона/нового поста: владелец
     решил, что шаблон несёт СВОЙ тип стены и передаёт его посту при размещении. Разница только
     в подсказке: у поста на плане свой тип, у шаблона выбор доедет до будущего поста.
     ⚠️ Ни в одном случае кнопки НЕ пишут EP_DATA.settings.wallType — иначе вернулся бы дефект B5
     (правка «у одного шаблона» переставляла подбор коробки всему проекту). Настройку всего
     проекта правят только в панели «Спецификация» (см. обработчик кнопок и savePostBuilder). */
  const placed=!!state.builder.editingPlacedId;
  document.querySelectorAll("#postWallType .wall-type-option").forEach(b=>{
    const on=b.dataset.wall===wall;
    b.classList.toggle("active",on);
    b.setAttribute("aria-checked",on?"true":"false");
    b.disabled=false;
  });
  const wallHint=$("postWallTypeHint");
  if(wallHint)wallHint.textContent=placed
    ?"Влияет на подбор монтажной коробки. У поста на плане — свой; при сохранении спросим, менять только в нём или во всех однотипных."
    :"Влияет на подбор монтажной коробки. Тип стены сохранится в шаблоне и перейдёт посту при размещении на плане; настройку всего проекта это не меняет — она в панели «Спецификация».";
  const host=$("builderComposition");if(!host)return;
  if(!selectedFrame){host.innerHTML=errorHtml||"";return;}
  const post=draft||{frameId:Number($("postFrameSelect").value),
    mechanismIds:EPBuilderSlots.toPost(state.builder.slots).mechanismIds,wallType:wall};
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
  /* Механизмы групп света — ОТДЕЛЬНАЯ строка состава и ОТДЕЛЬНОЕ слагаемое цены, ровно как в
     смете (estimate.js): в post.mechanismIds они не входят и входить не могут (удвоили бы
     modulesTotal и сменили бы коробку с суппортом). Что именно идёт в деньги, решает тот же
     EPEstimate.billableLighting, что и в смете, а итог — postTotalCost: «Стоимость поста» на
     этом экране обязана совпадать и со строкой сметы, и с подсказкой на плане.
     Формулировку строки собирает та же lightingRowSummary, что и карточка поста на плане: обе
     панели обязаны называть и НУЖНО, и ПОДОБРАНО — иначе пост с неподобранным механизмом
     показывает число, не совпадающее с числом мест управления. Пробел помечаем is-missing,
     как и остальные пробелы подбора в этом же составе (суппорт, коробка). */
  const lightSummary=lightingRowSummary(lightingRowsFor(post,light));
  const lightRow=lightSummary
    ? `<div class="composition-row${lightSummary.gaps?" is-missing":""}"><span>Механизмы групп света</span><b>${esc(lightSummary.text)}</b></div>`
    : "";
  /* Тот же блок «Группы света», что печатается в КП и листе монтажника: подставленные
     механизмы, реле и пробелы с причинами. Один источник — расхождению между конструктором
     и документами взяться неоткуда. */
  const lightBlock=light?lightingHtml(light,"Группы света в проекте"):"";
  host.innerHTML=`${errorHtml||""}<div class="composition-head"><strong>Состав поста</strong><span>Стандарт: ${esc(STANDARD_LABEL[comp.standard]||comp.standard)}</span></div>
    ${supportRow}${boxRow}${lightRow}
    <div class="composition-row total"><span>Стоимость поста</span><b>${money(postTotalCost(post,light))}</b></div>${note}${lightBlock}`;
}
function changePostSlotCount(){
  const currentName=$("postName").value.trim();
  if(/^Пост (?:на )?\d+ (?:мест|место|места|модул)/i.test(currentName))$("postName").value=defaultPostName(Number($("postSlotCount").value));
  renderBuilder();
}
/* «Изменить в данном блоке или для всех однотипных блоков» — дословная просьба заказчика
   (24.08) после того, как правка типа стены у одного поста разъехалась по всему проекту.
   Промис-модалка по конвенции проекта (см. choosePdfPage/askScaleLength): резолв лежит в
   переменной модуля, разметка — та же .modal-backdrop > .modal, отказ (крестик, клик мимо,
   Esc) даёт null. Своего компонента не заводим.
   Защита от повторного открытия — как у choosePdfPage: висящий вопрос закрываем отказом,
   иначе его промис остался бы неразрешённым навсегда и «Сохранить» молча перестало бы
   работать. */
let wallScopeResolve=null;
function finishWallScope(scope){
  if(!wallScopeResolve)return;
  const resolve=wallScopeResolve;wallScopeResolve=null;
  $("wallScopeModal").classList.remove("open");resolve(scope);
}
function askWallScope(sameTypeCount,wall){
  if(wallScopeResolve)finishWallScope(null);
  $("wallScopeCopy").textContent=`Тип стены «${WALL_STEP_LABEL[wall]||wall}» — применить только к этому посту `
    +`или ко всем однотипным (${sameTypeCount} шт., считая этот)? Однотипные — посты с той же накладкой `
    +`и тем же набором механизмов; у тех из них, где тип стены уже задавали отдельно, он будет заменён.`;
  $("wallScopeAll").textContent=`Во всех однотипных (${sameTypeCount})`;
  $("wallScopeModal").classList.add("open");
  setTimeout(()=>$("wallScopeSelf").focus(),0);
  return new Promise(resolve=>{wallScopeResolve=resolve});
}
$("wallScopeSelf").onclick=()=>finishWallScope("self");
$("wallScopeAll").onclick=()=>finishWallScope("sameType");
$("closeWallScopeModal").onclick=()=>finishWallScope(null);
$("wallScopeModal").onclick=e=>{if(e.target===$("wallScopeModal"))finishWallScope(null)};

async function savePostBuilder(){
  /* Проверяем сборку ПО ПОСТАМ: механизм не должен быть шире поста или «размазан» через
     импост (dist.valid), и все посты должны быть заполнены целиком (dist.full). Для
     итальянской однорядной накладки это ровно прежнее «заполните все модули». */
  const fields=EPBuilderSlots.toPost(state.builder.slots);
  const dist=EPPosts.distributePosts(fields.mechanismIds,frameProduct($("postFrameSelect").value),{product,mechanismSpan});
  if(!dist.valid){toast("Несовместимое сочетание — см. причину над составом поста");return}
  if(!dist.full){toast("Заполните все модули рамки");return}
  /* Поля поста перечислены ПОИМЁННО (белый список). keyGroups обязан быть здесь: забыть его —
     значит молча потерять группы света при сохранении, без единой ошибки в консоли. Он всегда
     той же длины, что mechanismIds (EPBuilderSlots.toPost), и соответствие идёт по индексу —
     это и есть keyIndex контракта модуля групп света. */
  const base={name:$("postName").value.trim()||"Пост",frameId:Number($("postFrameSelect").value),
    mechanismIds:[...fields.mechanismIds],keyGroups:[...fields.keyGroups],socketBoxProductId:socketBox()?.id};
  if(state.builder.editingPlacedId){
    const post=state.posts.find(x=>x.id===state.builder.editingPlacedId);
    /* ⚠️ ОХВАТ ПРАВКИ ТИПА СТЕНЫ СПРАШИВАЕМ ДО ЛЮБЫХ ЗАПИСЕЙ. Иначе отказ от вопроса (Esc,
       крестик, клик мимо) оставил бы пост наполовину сохранённым: имя и механизмы уже
       записаны, а стена — нет. Вопрос задаётся по посту В ТОМ ВИДЕ, КАКИМ ОН СТАНЕТ после
       сохранения (base уже применён к копии): «однотипные» — это блоки, похожие на тот, что
       человек только что собрал, а не на тот, что был до правки. */
    const next=Object.assign({},post,base);
    const wall=builderWallType();
    const wallChanged=wall!==EPPosts.postWallType(post,EP_DATA.settings.wallType);
    let scope="self";
    if(wallChanged){
      /* Вопрос — только когда есть из чего выбирать. Единственный в проекте блок такого
         состава менять «во всех однотипных» не из чего, и лишний диалог на самом обычном
         действии был бы чистым шумом (см. ту же логику у подтверждений повтором). */
      const twins=EPPosts.wallTypeTargets(state.posts,next,"sameType");
      if(twins.length>1){
        scope=await askWallScope(twins.length,wall);
        if(!scope)return;   /* вопрос закрыт без ответа — не сохраняем ничего, окно остаётся */
      }
    }
    Object.assign(post,base);
    /* Тип стены записываем ЯВНО каждому адресату, даже если он совпал с настройкой проекта:
       «я выбрал для этого поста бетон» — это решение о посте, и оно не должно потом уехать
       вслед за изменившимся значением проекта. Посты, у которых поля нет, продолжают читать
       проект (EPPosts.postWallType) — старые проекты этим не задеты. */
    if(wallChanged)EPPosts.wallTypeTargets(state.posts,post,scope).forEach(p=>{p.wallType=wall});
    renderAll();renderProperties();renderSummary();
    toast(wallChanged&&scope==="sameType"?"Обновлён пост и все однотипные посты":"Пост на плане обновлён");
  }else{
    /* ⚠️ ЗДЕСЬ НЕТ ЗАПИСИ EP_DATA.settings.wallType — И ЭТО ГЛАВНОЕ В ЭТОЙ ВЕТКЕ. Настройку
       ВСЕГО ПРОЕКТА (#projectWallTypeSelect) правят только в панели «Спецификация»: правка «у
       одного шаблона», уехавшая в EP_DATA.settings, переставляла подбор коробки всем постам
       проекта — дефект B5, ради которого у поста и завели собственный тип стены. Владелец решил
       иначе: теперь ШАБЛОН НЕСЁТ СВОЙ тип стены и передаёт его посту при размещении
       (EPPosts.placementFields), но общей настройки проекта по-прежнему не касается.
       В шаблон пишем тип стены ТОЛЬКО как ЯВНЫЙ выбор — отличный от типа стены проекта; совпал
       с проектом — поле не пишем, тогда шаблон (и пост из него) следуют за проектом («нет поля =
       как в проекте», то же правило, что у размещённого поста). Если шаблон уже нёс свой тип и
       пользователь его не менял — сохраняем как было. Мусор/пустое значение как отсутствие
       трактует сама placementFields при размещении. */
    const existing=state.builder.editingTemplateId;
    const prev=existing?state.templates.find(x=>x.id===existing):null;
    const template={id:existing||uid("tpl_"),...base};
    const wall=builderWallType();
    /* Эффективный тип стены проекта — тот же, что показывает панель (renderProjectWallTypeSelect):
       пусто/мусор → «solid». С ним и сравниваем, что выбор человека — осознанное расхождение. */
    const projectWall=EP_DATA.settings.wallType==="hollow"?"hollow":"solid";
    const ownWall=(wall==="solid"||wall==="hollow")&&wall!==projectWall
      ? wall
      : (prev&&(prev.wallType==="solid"||prev.wallType==="hollow")&&prev.wallType===wall?prev.wallType:null);
    if(ownWall)template.wallType=ownWall;
    await DataService.savePost(template);state.templates=await DataService.getSavedPosts();renderTemplates();toast(existing?"Шаблон обновлён":"Пост сохранён в библиотеку");
  }
  closePostBuilder();
}
function closePostBuilder(){
  $("postModal").classList.remove("open");
  state.builder={editingTemplateId:null,editingPlacedId:null,slots:[],target:{mode:"add"},query:"",openSections:new Set(),
    snapshot:null,escArmed:null,wallType:null};
}
/* СЛУЧАЙНОЕ закрытие (Esc, клик мимо окна) с потерей несохранённой работы просит подтверждения
   — повтором того же действия, а не системным confirm(): своих модальных диалогов в приложении
   нет, а окно конструктора и так модальное. Нетронутый пост закрывается сразу — лишний вопрос
   на выходе из просмотра раздражал бы. Подтверждение живёт 4 секунды: «ещё раз» через минуту
   это уже не то же действие. Кнопки «Отмена» и «×» — ОСОЗНАННЫЙ отказ, они закрывают сразу.
   Возвращает true, если закрыли.
   ⚠️ ГРАНИЦЫ ОКНА СЧИТАЕТ ОБЩИЙ EPConfirmRepeat, а не эта функция. Здесь была своя копия
   «запомнили время — сравнили с окном», и вместе с копией в renumberPosts она несла один и тот
   же дефект: верхняя граница есть, НИЖНЕЙ нет. Два Esc подряд (автоповтор зажатой клавиши даёт
   их через ~30 мс) закрывали окно, пока предупреждение ещё висело на экране, — несохранённый
   пост пропадал молча. Подписи (subject) у этого действия нет намеренно: показывать здесь
   нечего, вопрос всегда один и тот же. */
const ESC_CONFIRM_MS=4000;
function requestClosePostBuilder(){
  if(!builderDirty()){closePostBuilder();return true}
  const step=EPConfirmRepeat.press(state.builder.escArmed,{now:Date.now(),maxMs:ESC_CONFIRM_MS});
  state.builder.escArmed=step.armed;
  if(step.action==="confirm"){closePostBuilder();return true}
  /* «wait» — нажатие из потока (зажатый Esc, дребезг): говорим прямо, чего ждём, иначе человек
     продолжает стучать по клавише и не понимает, почему окно не закрывается. */
  toast(step.action==="wait"
    ? "Есть несохранённые изменения — слишком быстро, нажмите Esc ещё раз, не спеша"
    : "Есть несохранённые изменения — повторите, чтобы закрыть без сохранения");
  return false;
}

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
    /* Поля копируются ПОИМЁННО чистой EPPosts.placementFields — там же под автотестом живёт
       правило «группы света из шаблона не копируются»: шаблон с заполненной группой,
       размещённый трижды, дал бы вместо трёх выключателей проходную схему из переключателей
       и инвертора (см. комментарий у самой функции). Каждое размещение начинает с пустых
       групп — честный пробел «группа не указана», а не молчаливое размножение чужой группы. */
    created=Object.assign({id:uid("post_"),x:x-12,y:y-12,number:EPPosts.nextPostNumber(state.posts),roomId:null},
      EPPosts.placementFields(t));
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
  /* уничтожаемые авто-комнаты — источники переноса ручных полей на новые (по геометрии) */
  const oldAuto=state.rooms.filter(r=>r.autoPolygon);
  /* ручные контуры (autoPolygon===false) переживают пересчёт — как в detectRooms* */
  state.rooms=state.rooms.filter(r=>!r.autoPolygon);
  const kept=state.rooms.length;
  /* нумеруем «Помещение N» дальше существующих одноимённых, чтобы имена не дублировались */
  let next=state.rooms.reduce((max,r)=>{const m=/^Помещение\s+(\d+)$/.exec(r.name||"");return m?Math.max(max,Number(m[1])):max},0);
  const built=[];
  res.rooms.forEach(rm=>{
    const poly=rm.polygon,c=polygonCentroid(poly);
    /* roomSource — признак способа получения контура (по линиям/по сетке): запасной
       проход не подменяет основной молча, источник виден и в state, и в отчётах */
    const room={id:uid("room_"),name:"Помещение "+(++next),area:"",polygon:poly,autoPolygon:true,roomSource:rm.source,seedX:c.x,seedY:c.y,x:c.x-45,y:c.y-16};
    state.rooms.push(room);built.push(room);
  });
  carryUserRoomFields(oldAuto,built);   /* вернуть имя/площадь, введённые вручную, на совпавшие комнаты */
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
    terms:(({workPercent,materialsPercent,discountPercent,vatPercent,vatEnabled,rateSurchargePercent,wallType,lightingScheme,displayCurrency,eurRate,rateDate,rateSource})=>
      ({workPercent,materialsPercent,discountPercent,vatPercent,vatEnabled,rateSurchargePercent,wallType,lightingScheme,displayCurrency,eurRate,rateDate,rateSource}))(EP_DATA.settings)};
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
/* МИГРАЦИЯ ОСИРОТЕВШИХ ГРУПП СВЕТА при открытии проекта. Правило одно и то же на всё
   приложение — EPBuilderSlots.fromPost (там же под тестом): группа остаётся только на клавише,
   с известного каталогу НЕ-места управления снимается, а с товара, которого в каталоге НЕТ, не
   снимается никогда (потерянная клавиша — честный пробел, а не мусор).
   Зачем на ЗАГРУЗКЕ, а не только в конструкторе: чинить фантомные места «когда человек случайно
   откроет этот пост» значит не чинить вовсе — в проекте их десятки, и оживают они все разом,
   при первой перезаливке прайса. Расчёт от миграции не меняется ни на копейку: группу на
   известной каталогу не-клавише EPLightingPlan.collect и сегодня не считает местом — меняются
   только сохранённые данные, которые завтра стали бы местом. Возвращает число вычищенных
   позиций (для отладки; молчаливая правка данных всё равно должна быть видна в консоли). */
function dropOrphanKeyGroups(posts){
  let cleaned=0;
  (Array.isArray(posts)?posts:[]).forEach(po=>{
    if(!po||!Array.isArray(po.keyGroups)||!po.keyGroups.some(g=>String(g??"").trim()!==""))return;
    const next=EPBuilderSlots.toPost(EPBuilderSlots.fromPost(po,keySlotKind)).keyGroups;
    next.forEach((g,i)=>{if(g!==String(po.keyGroups[i]??""))cleaned++});
    po.keyGroups=next;
  });
  if(cleaned)console.info(`Миграция: снято групп света с позиций, где стоит не клавиша — ${cleaned}`);
  return cleaned;
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
  dropOrphanKeyGroups(state.posts);
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
    /* Схема электрики: проект, сохранённый до её появления, поля не несёт — Object.assign выше
       его не трогает, и остаётся дефолт data.js («Классическая»). Это и есть требуемое
       поведение, никакой отдельной миграции (в отличие от надбавки к курсу) не нужно. */
    renderLightingSchemeSelect();
    /* Тип стены проекта едет в terms тем же Object.assign — селектор в панели обязан показать
       восстановленное значение, иначе панель уверяет «бетон», а коробки подбираются под ГКЛ. */
    renderProjectWallTypeSelect();
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
function supplierSpecData(light){
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
      /* Механизмы групп света — такие же позиции заказа, как клавиши: за каждой клавишей
         физически стоит механизм, и поставщик обязан его видеть. Пробел ПОДБОРА (группа
         указана, а изделия в серии нет / у него нет артикула) отдаём строкой без артикула —
         свод напечатает её в «Позициях без артикула», как и «Суппорт не подобран».
         А вот «группа не указана» и «схема не описана» СЮДА НЕ ИДУТ: это незаполненный
         проект, а не дыра поставки, — их место в блоке «Группы света», иначе накладная
         поставщику у любого старого проекта состояла бы из этих строк.
         Список таких причин — ОДИН на все документы (EPLightingGroups.isSupplyGap), а не
         литерал здесь: пока он лежал в оркестраторе, обвязка листа монтажника печатала то,
         что накладная поставщика молчаливо отбрасывала, — один и тот же пробел трактовался
         двумя документами об одном проекте по-разному. */
      const lightItems=lightingRowsFor(p,light)
        .filter(r=>!r.missing||EPLightingGroups.isSupplyGap(r.missingReason))
        .map(r=>r.missing
          ?{code:"",name:`Механизм группы «${r.groupLabel||"—"}» не подобран`,kind:"mechanism"}
          :{code:r.code,name:r.name,unit:r.product&&r.product.unit,kind:"mechanism"});
      return {
        mechanisms:(p.mechanismIds||[]).map(id=>item(product(id))||{code:"",name:`Механизм не найден (арт. ${id})`}).concat(lightItems),
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
    /* Импульсные реле схемы «Реле» — одной строкой на проект БЕЗ АРТИКУЛА. Артикул 03992 из
       ТЗ в каталоге и номенклатуре VIMAR отсутствует (0 совпадений), в накладной заказчика
       стоит стороннее реле Finder — подставлять сюда выдуманный код нельзя. Количество есть,
       артикула нет: поставщик увидит строку в «Позициях без артикула» и уточнит. Разбивка по
       группам печатается в блоке «Группы света», здесь она поставщику не нужна. */
    extras:state.devices.map(d=>item(product(d.productId))||{code:"",name:`Товар не найден (арт. ${d.productId})`})
      .concat((light&&light.plan.relayTotal>0)
        ?[{code:"",name:"Импульсное реле — артикул не определён",count:light.plan.relayTotal,kind:"other"}]:[])
  };
}
/* Готовая секция свода для документа — пустая строка, когда заказывать нечего (пустой
   проект). Документы получают строку, а не данные, ровно как planBlockHtml. */
function supplierSpecHtml(opts,light){
  return EPSupplierSpec.buildHtml(Object.assign(supplierSpecData(light),opts||{}),{esc});
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
/* moduleLabelOf(index, slot) — адрес модуля В ЭТОЙ КАРТОЧКЕ (см. buildPostSheet): у сборки из
   нескольких постов «пост.модуль», у обычной накладки сквозной номер. Схема обязана называть
   модули теми же номерами, что таблица и обвязка над ней, — иначе монтажник читает про разное.
   По умолчанию — номер самой раскладки: старые вызовы работают как раньше.
   layout — модули В ПОРЯДКЕ КАРТОЧКИ (EPInstallSheet.cardModuleOrder), каждый со своим keyIndex:
   одних верных номеров мало, читаются они ПОДРЯД, и порядок обязан совпадать со строками
   таблицы. */
function buildExplodedSpec(comp,box,layout,frameSpec,lightRows,moduleLabelOf){
  const labelOf=moduleLabelOf||((index,slot)=>slot&&slot.label);
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
  /* Механизм группы света физически стоит ЗА клавишей и своей ячейки модуля не имеет.
     Показываем его СРАЗУ ЗА своей клавишей и тоже ролью «Модуль»: подряд идущие «Модули»
     EPExplodedView сворачивает в ОДНУ колонку-стек, поэтому механизм встаёт под клавишей, а
     не режет ряд на отдельную колонку, и позиции схемы остаются в том же порядке, что строки
     таблицы модулей над ней. В кикере — номер модуля клавиши, чтобы пара читалась. */
  const lightByKey=new Map((lightRows||[]).map(r=>[Number(r.keyIndex),r]));
  layout.forEach((s,order)=>{
    /* Адрес модуля и его группа света читаются по ПОЗИЦИИ КЛАВИШИ В ПОСТЕ (keyIndex контракта
       групп света), а НЕ по месту в этом массиве: порядок деталей схемы задаёт карточка
       документа (EPInstallSheet.cardModuleOrder), и у немецко-французской сборки он другой —
       по постам-коробкам. Вызов, пришедший без keyIndex (плоская раскладка), работает как
       раньше: там позиция и есть индекс. */
    const index=s.keyIndex!=null?Number(s.keyIndex):order;
    const item=s.item;
    const label=labelOf(index,s);
    const photo=photoOf(item);   // item может быть null (механизм не в каталоге) — productImage вернёт ""
    parts.push({
      role:"Модуль",pos:label,
      name:item?item.name:`Механизм не найден (арт. ${s.id})`,
      code:item?item.code:"",
      icon:{categoryId:item?.categoryId,icon:item?.icon,name:item?.name},
      photo:photo?{imageUrl:photo}:null
    });
    const row=lightByKey.get(index);
    if(row&&!row.missing&&row.product){
      const mechPhoto=photoOf(row.product);
      parts.push({
        role:"Модуль",pos:`${label} · механизм`,
        name:row.product.name,code:row.code,
        icon:{categoryId:row.product.categoryId,icon:row.product.icon,name:row.product.name},
        photo:mechPhoto?{imageUrl:mechPhoto}:null
      });
    }
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
function buildPostSheet(post,light){
  const comp=postComposition(post);
  const frame=comp.frame;
  /* Две раскладки одного и того же набора: плоская (слева направо по всей накладке) и ПО
     ПОСТАМ-коробкам — монтажнику важно, что коробки разные. Обе считает EPPosts, чтобы позиции
     совпадали с конструктором и превью; адрес модуля для карточки собирается ниже из второй.
     Нумерацию ПО ПОСТАМ считаем над ТОКЕНАМИ-позициями (js/builderSlots.js): упаковка может
     переставить механизмы между постами накладки, и без токенов было бы не узнать, какая
     позиция исходного набора попала в какой пост, — примечание с группой света уехало бы к
     чужой клавише. Товары при этом настоящие: их отдаёт tokenDeps.product. */
  const layout=EPPosts.moduleLayout(post.mechanismIds,{product,mechanismSpan});
  const slots=EPBuilderSlots.fromPost(post,keySlotKind);
  const tokenDeps=EPBuilderSlots.tokenDeps(slots,{product,mechanismSpan});
  const groups=EPPosts.postModuleGroups(EPBuilderSlots.tokens(slots),frame,tokenDeps);
  /* ⚠️ ОДНА НУМЕРАЦИЯ МОДУЛЕЙ НА ВСЮ КАРТОЧКУ ПОСТА. Монтажник читает таблицу модулей, обвязку
     и взрыв-схему рядом, глазами, — и один и тот же модуль обязан называться в них ОДИНАКОВО.
     Пока таблица немецко-французской сборки печаталась по постам («пост 2, модуль 1»), а
     обвязка сквозной нумерацией («модуль 3»), одна и та же клавиша имела в одной карточке два
     номера, и понять, о какой из них речь, было нельзя.
     Форма адреса: у сборки из НЕСКОЛЬКИХ постов — «пост.модуль» («2.1», двухмодульный —
     «2.1–2»), у обычной одной накладки — прежний сквозной номер («1», «2–3») байт в байт.
     Считается по РАСКЛАДКЕ ПО ПОСТАМ, потому что физическую позицию (в какой коробке стоит
     механизм) знает только она; для позиции, которой в раскладке нет (механизм шире накладки —
     ушёл в overflow), остаётся плоский номер, иначе строка потеряла бы адрес вовсе. */
  const multiPost=groups.length>1;
  const labelByKey=new Map();
  groups.forEach(g=>(g.modules||[]).forEach(m=>
    labelByKey.set(Number(m.id),multiPost?`${g.post}.${m.label}`:m.label)));
  const moduleLabelOf=(index,slot)=>labelByKey.has(Number(index))?labelByKey.get(Number(index))
    :(slot&&slot.label!=null?slot.label:String(Number(index)+1));
  /* Группы света этого поста, ключ — позиция клавиши в посте (keyIndex контракта). Номер модуля
     переписываем на адрес этой карточки: lightingRowsFor считает его плоским (он же нужен
     конструктору, где сборка всегда одна), а здесь у клавиши адрес «пост.модуль». */
  const lightRows=lightingRowsFor(post,light)
    .map(r=>Object.assign({},r,{moduleLabel:moduleLabelOf(r.keyIndex,layout[r.keyIndex])}));
  const lightByKey=new Map(lightRows.map(r=>[Number(r.keyIndex),r]));
  /* Примечание клавиши: группа, номер места в ней и подставленная роль с артикулом — либо
     причина пробела СЛОВАМИ РАСЧЁТА (EPLightingGroups.GAP_TEXTS). Монтажник читает строку
     модуля и сразу видит, что стоит за этой клавишей. */
  const lightNote=row=>!row?""
    :row.missing?`группа «${row.groupLabel||"—"}»: ${row.missingText}`
    :`группа «${row.groupLabel}» · место ${row.placeNo} из ${row.placeCount} · ${row.roleLabel} ${row.code}`;
  /* index — позиция клавиши в post.mechanismIds, а НЕ порядок в таблице: у нумерации по
     постам порядок другой (см. moduleGroups ниже), а адрес клавиши обязан быть один. */
  const moduleRow=(s,index)=>({
    label:moduleLabelOf(index,s),
    name:s.item?s.item.name:`Механизм не найден (арт. ${(post.mechanismIds||[])[index]})`,
    code:s.item?s.item.code:"",
    note:s.item?lightNote(lightByKey.get(index)):"нет в каталоге",
    /* Позиция клавиши в посте едет ВМЕСТЕ со строкой: по ней взрыв-схема ниже собирается в том
       же порядке, в каком документ печатает строки таблицы (см. cardModuleOrder). */
    keyIndex:index
  });
  const modules=layout.map((s,index)=>moduleRow(s,index));
  const moduleGroups=groups.map(g=>({post:g.post,capacity:g.capacity,
    modules:g.modules.map(m=>moduleRow(m,Number(m.id)))}));
  /* ⚠️ ВЗРЫВ-СХЕМА ИДЁТ В ТОМ ЖЕ ПОРЯДКЕ, ЧТО ТАБЛИЦА МОДУЛЕЙ. Порядок задаёт документ
     (EPInstallSheet.cardModuleOrder — то же правило, по которому печатается таблица), а не
     плоский post.mechanismIds: у немецко-французской сборки упаковка по постам переставляет
     механизмы, и схема шла «1.1, 2.1–2, 1.2» против «1.1, 1.2, 2.1–2» в таблице над ней.
     Номера при этом были верные — расходился порядок, а монтажник читает оба блока подряд.
     Модуль, которого в раскладке по постам нет вовсе (шире накладки — ушёл в overflow),
     добавляем в конец: из схемы деталь пропадать не должна, там она с плоским номером. */
  const cardOrder=EPInstallSheet.cardModuleOrder(moduleGroups,modules);
  const placed=new Set(cardOrder.map(r=>Number(r.keyIndex)));
  const explodedLayout=cardOrder.map(r=>Object.assign({},layout[Number(r.keyIndex)],{keyIndex:Number(r.keyIndex)}))
    .concat(layout.map((s,i)=>Object.assign({},s,{keyIndex:i})).filter(s=>!placed.has(s.keyIndex)));
  /* Точная коробка либо стандартно-совместимый фолбэк — выбор наш: только приложение знает
     тип стены проекта. Дальше обвязку (суппорт → коробка → накладка) собирает чистая
     EPInstallSheet.buildFittings — формат её строк принадлежит документу, а не оркестратору,
     и там же под тестом живёт правило «суппортов столько же, сколько коробок» (раньше здесь
     стоял литерал count:1, и монтажник вёз одну планку на два немецко-французских поста). */
  const box=comp.box||comp.boxFallback;
  /* В ОБВЯЗКУ (перечень деталей поста) идут те же строки групп света, что и в накладную
     поставщика, — и по тому же правилу EPLightingGroups.isSupplyGap. «Группа не указана» и
     «схема не описана» — незаполненный проект, а не отсутствующая деталь: в обвязке каждого
     поста старого проекта они дали бы строку на каждую клавишу и утопили бы настоящий пробел
     поставки. Монтажник видит их там же, где заказчик, — в блоке «Группы света» этого же
     документа и в примечании к модулю клавиши (lightNote выше, там причина остаётся). */
  const fittings=EPInstallSheet.buildFittings(comp,box,
    lightRows.filter(r=>!r.missing||EPLightingGroups.isSupplyGap(r.missingReason)));
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
      buildExplodedSpec(comp,box,explodedLayout,spec.frame,lightRows,moduleLabelOf),
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
  const fields=EPBuilderSlots.toPost(state.builder.slots);
  const post={id:placed?placed.id:"builder-draft",number:placed?placed.number:"—",
    frameId:Number($("postFrameSelect").value),
    mechanismIds:[...fields.mechanismIds],keyGroups:[...fields.keyGroups],
    roomId:placed?placed.roomId:null,height:placed?.height,purpose:placed?.purpose,
    /* Тип стены — из черновика окна: лист монтажника обязан назвать ту коробку, что видна
       в составе поста рядом, а не ту, что записана в проекте (правка ещё не сохранена). */
    wallType:builderWallType()};
  if(!post.mechanismIds.length){toast("Добавьте механизмы в пост");return}
  /* Группы света считаем по ПРОЕКТУ вместе с этим постом: роль механизма зависит от числа
     мест группы во всём проекте, и лист монтажника обязан показать ту же роль, что видно в
     конструкторе и в смете. */
  const light=lightingFor(projectPostsWithBuilder(frameProduct($("postFrameSelect").value)));
  openInstallSheet({posts:[buildPostSheet(post,light)],subtitle:"Помодульная раскладка поста",
    lightingHtml:lightingHtml(light,"Группы света в проекте")});
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
  const light=projectLighting();
  openInstallSheet({posts:ordered.map(p=>buildPostSheet(p,light)),subtitle:"Помодульная раскладка постов по проекту",
    /* Свод по группам света — после карточек постов: какие механизмы подставил расчёт,
       сколько нужно импульсных реле и что осталось незаполненным. */
    lightingHtml:lightingHtml(light,"Группы света"),
    /* План с бирками — только в листе НА ВЕСЬ ПРОЕКТ: в листе одного поста из конструктора
       (installSheetForBuilder) чертёж со всеми чужими номерами только мешает. Поля листа
       монтажника 14 мм (см. @page в installSheet.js). */
    planBlockHtml:planBlockHtml({maxWidthMm:182,maxHeightMm:226,
      note:"Номер на бирке — номер поста в карточках ниже."}),
    /* Свод по артикулам — тоже только в листе НА ВЕСЬ ПРОЕКТ: в листе одного поста из
       конструктора заказывать по проекту нечего, а состав этого поста уже есть в обвязке. */
    supplierSpecHtml:supplierSpecHtml({
      note:"Все одинаковые позиции проекта сведены по артикулам — этот лист отправляется поставщику."},light)});
}
/* Осознанная перенумерация постов к 1..N по расположению на плане (сверху вниз, слева
   направо) — как обычно обходят точки на чертеже. Пока пользователь не нажал, номера
   закреплены и не прыгают при удалении (иначе распечатанные документы разошлись бы).

   ⚠️ ПЕРЕНУМЕРАЦИЯ МОЖЕТ ИЗМЕНИТЬ ПОДБОР МЕХАНИЗМОВ — И ЭТО НЕ ДЕФЕКТ, А СЛЕДСТВИЕ, О КОТОРОМ
   ОБЯЗАН ЗНАТЬ ЧЕЛОВЕК. В классической схеме переключатели достаются ПЕРВЫМ ДВУМ местам группы,
   а «первые» считаются в каноническом порядке EPLightingGroups.canonicalOrder — по номерам
   постов. Сменив номера, мы меняем и порядок: инвертор переезжает в другой пост, а если у
   клавиш разные серии, меняется и СУММА (в Neve Up инвертора нет вовсе — там, где он выпал,
   стоит честный пробел, а после перестановки он может выпасть у соседа или не выпасть совсем).

   ПОЧЕМУ МЫ ПРЕДУПРЕЖДАЕМ, А НЕ ОТВЯЗЫВАЕМ ПОРЯДОК ОТ НОМЕРОВ. Требование «один и тот же проект
   обязан давать один и тот же расчёт» не нарушено: номер поста — ЧАСТЬ ПРОЕКТА (он печатается
   на бирках плана, в КП и в листе монтажника), и перенумерация — это правка проекта, а не
   повторный расчёт того же. Отвязать роли от номеров можно было бы только привязав их к
   внутреннему id (порядку создания постов) — и тогда порядок мест в документах («место 2 из 3»)
   перестал бы совпадать с порядком, в котором монтажник обходит план: печатали бы одно, а
   считали по другому, причём невидимо. Порядок «как человек читает план» — осознанное правило
   модуля, и перенумерация как раз приводит план к этому порядку. Значит правильное поведение —
   не отменить пересчёт, а показать его цену ДО того, как он применён.

   ⚠️ ПОДТВЕРЖДАЕТ ОТДЕЛЬНАЯ КНОПКА, А НЕ ПОВТОРНОЕ НАЖАТИЕ ЭТОЙ. Сначала подтверждение было
   повтором того же действия (как у закрытия конструктора), и это оказалось нечестно: любая
   граница по времени поток срабатываний только ЗАДЕРЖИВАЕТ. Нетерпеливые клики и зажатый Enter
   на кнопке в фокусе сыплют нажатиями бесконечно, и одно из них рано или поздно попадает в
   разрешённое окно — команда применяется, хотя человек ничего не решал. Осознанность даёт не
   другое время, а ДРУГОЙ ЖЕСТ: нажатие на эту кнопку теперь ТОЛЬКО задаёт вопрос (сколько бы их
   ни пришло), а применяет его кнопка «Подтвердить перенумерацию», которой до вопроса на экране
   не было и в которую поток по этой кнопке физически не попадает. Заказчику это ничего не
   стоит: вопрос появляется, только когда расчёт правда меняется, а подтверждение — одно
   движение к соседней кнопке, без модалки и без ожидания.
   Оба режима считает ОБЩИЙ EPConfirmRepeat: здесь — «две кнопки», у закрытия конструктора
   (requestClosePostBuilder), где второй кнопке взяться неоткуда, — «повтор с паузой».
   Окно 12 с: надо прочитать сумму и дотянуться до кнопки. Если расчёт не меняется — не
   спрашиваем вовсе: лишний вопрос обесценивает предупреждение.

   ⚠️ ПОДТВЕРЖДАЮТ ИМЕННО ТО, ЧТО ПОКАЗАЛИ. Взвод несёт подпись посчитанного (renumberSubject):
   пару «до/после», обе суммы и саму раскладку номеров. Голая метка времени этого не знала — и
   если между нажатиями изменить проект (сдвинуть пост, поправить группу), второе нажатие
   применяло ДРУГУЮ перенумерацию, про которую человеку показали ДРУГИЕ числа. Изменилась
   подпись — это не подтверждение, а новый вопрос с новыми числами. */
const RENUMBER_CONFIRM_MS=12000;
let _renumberArmed=null,_renumberHideTimer=null;
/* Кнопка подтверждения живёт ровно столько же, сколько вопрос: пропал вопрос — пропала кнопка.
   Без таймера она осталась бы висеть после истечения окна и обещала бы то, чего уже нет. */
function showRenumberConfirm(on){
  const btn=$("renumberConfirmBtn");if(!btn)return;
  btn.hidden=!on;
  clearTimeout(_renumberHideTimer);
  if(on)_renumberHideTimer=setTimeout(()=>{_renumberArmed=null;showRenumberConfirm(false)},RENUMBER_CONFIRM_MS+200);
}
/* Подписи расчёта «до/после» считает чистый EPLightingPlan — там же они и под тестом.
   planSignature включает АДРЕС места («место N из M»), и это не украшение: пока подпись
   состояла из роли и артикула, перенумерация, меняющая ТОЛЬКО распределение мест внутри группы
   (артикулы те же, «место 1 из 2» уезжает в другой пост), считалась «ничего не изменилось» и
   применялась молча — хотя документы после неё другие. kitSignature (без адресов) нужна только
   чтобы назвать человеку ПРИЧИНУ вопроса верными словами. */
const lightingSignature=light=>EPLightingPlan.planSignature(light&&light.plan);
const lightingKitSignature=light=>EPLightingPlan.kitSignature(light&&light.plan);
/* Подпись ПОКАЗАННОГО: что именно применит подтверждение (раскладка номеров) и что человек про
   это прочитал (обе подписи подбора и обе суммы). Любая правка проекта между нажатиями меняет
   её — и подтверждение обязано спроситься заново. */
const renumberSubject=(numbers,before,after)=>JSON.stringify([[...numbers].map(([id,n])=>[String(id),n]),
  lightingSignature(before),lightingSignature(after),lightingSum(before),lightingSum(after)]);
/* Что именно изменит перенумерация — тремя разными новостями: сумма, состав, только адреса мест.
   Последний случай раньше вообще не спрашивал (см. lightingSignature). */
function renumberNews(before,after){
  const sumBefore=lightingSum(before),sumAfter=lightingSum(after);
  return Math.abs(sumBefore-sumAfter)>=0.005
    ? `Перенумерация пересоберёт механизмы групп света: ${money(sumBefore)} → ${money(sumAfter)}`
    : lightingKitSignature(before)!==lightingKitSignature(after)
      ? "Перенумерация переставит механизмы групп света между постами (сумма прежняя)"
      : "Перенумерация изменит адреса мест управления в группах («место N из M») — механизмы и сумма прежние, документы изменятся";
}
/* Раскладка «пост → новый номер» и оба расчёта. Считается ЗАНОВО и при вопросе, и при
   подтверждении: между ними проект можно изменить, и применять надо то, что посчитано сейчас, —
   а совпадает ли оно с показанным, решает подпись (subject). */
function renumberPlan(){
  const ordered=state.posts.slice().sort((a,b)=>(a.y-b.y)||(a.x-b.x));
  const numbers=new Map(ordered.map((p,i)=>[p.id,i+1]));
  /* Считаем будущий расчёт НА КОПИЯХ постов — состояние проекта до подтверждения не трогаем. */
  const before=projectLighting();
  const after=lightingFor(state.posts.map(p=>Object.assign({},p,{number:numbers.get(p.id)})));
  return {ordered,numbers,before,after,changed:lightingSignature(before)!==lightingSignature(after)};
}
function applyRenumber(plan){
  _renumberArmed=null;showRenumberConfirm(false);
  plan.ordered.forEach(p=>p.number=plan.numbers.get(p.id));
  renderAll();renderProperties();renderSummary();persistProject();
  toast(plan.changed?"Посты перенумерованы, группы света пересчитаны":"Посты перенумерованы по расположению на плане");
}
/* Нажатие на САМУ команду. Расчёт не меняется — делаем сразу; меняется — только задаём вопрос
   (via:"arm" не подтверждает никогда, сколько бы нажатий ни пришло) и показываем кнопку
   подтверждения. */
function renumberPosts(){
  if(!state.posts.length){toast("В проекте нет постов");return}
  const plan=renumberPlan();
  if(!plan.changed){applyRenumber(plan);return}
  const step=EPConfirmRepeat.press(_renumberArmed,{now:Date.now(),maxMs:RENUMBER_CONFIRM_MS,
    subject:renumberSubject(plan.numbers,plan.before,plan.after),via:"arm"});
  _renumberArmed=step.armed;
  showRenumberConfirm(true);
  toast(`${renumberNews(plan.before,plan.after)}. Нажмите «Подтвердить перенумерацию»`);
}
/* Нажатие на кнопку подтверждения — ДРУГОЙ орган управления, поэтому ни паузы, ни повторов не
   требуется: поток по кнопке «Перенумеровать посты» сюда не попадает. Остаются подпись
   («подтверждают именно то, что показали») и окно. */
function confirmRenumberPosts(){
  const plan=state.posts.length?renumberPlan():null;
  const step=EPConfirmRepeat.press(_renumberArmed,{now:Date.now(),maxMs:RENUMBER_CONFIRM_MS,
    /* Подпись считаем ВСЕГДА (пустая строка, если постов уже нет): её несовпадение — это и есть
       «показывали другое», и пропустить проверку, подав undefined, значило бы применить
       перенумерацию, про которую человеку показали другие числа. */
    subject:plan?renumberSubject(plan.numbers,plan.before,plan.after):"",via:"confirm"});
  _renumberArmed=step.armed;
  /* «wait» — нажатие пришло в тот же миг, когда кнопка появилась: это промах по соседней
     команде из-за сдвига разметки, а не подтверждение. Вопрос остаётся на экране как был. */
  if(step.action==="wait")return;
  if(step.action!=="confirm"){
    showRenumberConfirm(false);
    toast("Проект изменился — нажмите «Перенумеровать посты» ещё раз, чтобы увидеть новые числа");
    return;
  }
  applyRenumber(plan);
}

/* Оркестратор КП: считаем ту же смету, что и панель справа (единый buildEstimate —
   PLAN 2.4), открываем окно печати, а саму вёрстку документа собирает EPOfferPdf.
   Сверху добавляем реквизиты (docHeader) и раскладку постов (buildPostLayout). */
function generateCommercialOffer(){
  /* ОДИН расчёт групп света на весь документ: он же уходит в смету (цены механизмов), он же в
     блок «Группы света» и он же в свод поставщика — двум проходам разойтись негде. */
  const light=projectLighting();
  const est=buildEstimate(light);
  if(est.missing.length)toast(`Внимание: позиций без товара в каталоге — ${est.missing.length}`);
  const win=window.open("","_blank");
  if(!win){toast("Разрешите всплывающие окна для формирования PDF");return}
  win.document.write(EPOfferPdf.buildHtml(est,{money,esc,displayCurrency,effectiveRate:EPRates.effectiveRate,
    settings:EP_DATA.settings,header:docHeader(),postLayout:buildPostLayout(),
    /* план с бирками — отдельной страницей перед раскладкой постов: клиент сверяет номер в
       таблице с местом на чертеже. Поля КП 16 мм (см. @page в offerPdf.js). */
    planBlockHtml:planBlockHtml({maxWidthMm:178,maxHeightMm:222}),
    /* Пояснение к составу позиций выше: откуда в посте на три клавиши переключатель и
       инвертор вместо трёх выключателей, сколько нужно реле и чего не хватает. */
    lightingHtml:lightingHtml(light,"Группы света"),
    /* Свод по артикулам — приложением В КОНЦЕ КП, после денежных итогов: клиент читает КП
       ради цены, а этот лист отрывается и уходит поставщику (в нём цен нет). */
    supplierSpecHtml:supplierSpecHtml({},light)}));
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
$("newPostBtn").onclick=()=>openPostBuilder();
$("closePostModal").onclick=$("cancelPost").onclick=closePostBuilder;
$("savePost").onclick=savePostBuilder;$("postSlotCount").onchange=changePostSlotCount;$("postFrameSelect").onchange=renderBuilder;
/* Поиск по каталогу конструктора перерисовывает ТОЛЬКО карточки: поле ввода лежит снаружи
   #builderCatalog, поэтому фокус и каретка на месте, а раскладка по постам не пересчитывается. */
$("builderSearch").oninput=e=>{state.builder.query=e.target.value;renderBuilderCatalog()};
/* Схема электрики — настройка ВСЕГО проекта: меняет подстановку механизмов во ВСЕХ постах.
   Селектор ровно один — в панели проекта; в конструкторе осталась строка только для чтения
   (см. renderLightingSchemeSelect). Кого перерисовывать — не наше дело: обработчик пишет
   значение и зовёт applyProjectSettings(). Раньше здесь стоял свой список, в котором не было
   renderProperties, и карточка выбранного поста показывала старую схему и старую стоимость. */
$("lightingSchemeSelect").onchange=e=>{
  EP_DATA.settings.lightingScheme=e.target.value;
  applyProjectSettings();
};
/* Тип стены ПРОЕКТА — значение по умолчанию для постов без своего post.wallType. Меняется
   ТОЛЬКО отсюда, из панели проекта: правка настройки всего объекта из окна отдельного поста
   и была тем дефектом, ради которого у поста завели собственный тип стены.
   У постов, которым тип стены не задавали, меняется подобранная коробка — а с ней состав,
   цена поста и смета; всех потребителей обновляет applyProjectSettings. */
$("projectWallTypeSelect").onchange=e=>{
  EP_DATA.settings.wallType=e.target.value==="hollow"?"hollow":"solid";
  applyProjectSettings();
  toast("Тип стены проекта изменён — посты со своим типом стены не затронуты");
};
/* Тип стены ПОСТА — ЧЕРНОВИК ОКНА, а не мгновенная правка проекта. Кнопка писала прямо в
   EP_DATA.settings.wallType и тут же звала scheduleSave(): человек открывал ОДИН пост, менял
   стену — и подбор коробки уезжал у ВСЕХ постов проекта, включая посты другой накладки и
   другого состава; «Отмена» это не откатывала, потому что проект уже был сохранён.
   Теперь кнопка меняет только черновик; куда правку применить — решает сохранение
   (savePostBuilder → askWallScope у поста на плане, запись в шаблон у шаблона/нового поста).
   Смету отсюда не пересчитываем и проект не сохраняем: пока не нажато «Сохранить», в проекте
   ничего не изменилось. У шаблона и нового поста черновик тоже правится (владелец: шаблон
   несёт свой тип стены) — прежнего запрета «только у поста на плане» здесь больше нет. */
document.querySelectorAll("#postWallType .wall-type-option").forEach(b=>b.onclick=()=>{
  state.builder.wallType=b.dataset.wall;renderBuilder();
});
/* Клик мимо окна — такое же СЛУЧАЙНОЕ закрытие, как Esc: с несохранёнными правками просит
   повтора (см. requestClosePostBuilder), а не выбрасывает собранный пост молча. */
$("postModal").onclick=e=>{if(e.target===$("postModal"))requestClosePostBuilder()};
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
/* Подтверждение — С ДРУГОЙ КНОПКИ (см. renumberPosts): поток нажатий по кнопке слева сюда не
   попадает, а значит и применить перенумерацию за человека не может. */
$("renumberConfirmBtn").onclick=confirmRenumberPosts;
/* АВТОПОВТОР НА КНОПКЕ В ФОКУСЕ — НЕ ВТОРОЕ ДЕЙСТВИЕ. Удержанные Enter/Пробел на кнопке в фокусе
   шлют поток click-событий (у клавиатурного click detail = 0, от настоящего его не отличить).
   Кнопку подтверждения это касается напрямую: удержанный Enter на ней применил бы команду
   мгновенно после её появления. Гасим автоповтор в источнике — ровно как у Esc в конструкторе. */
[$("renumberPostsBtn"),$("renumberConfirmBtn")].forEach(b=>{
  b.onkeydown=e=>{if(e.repeat&&(e.key==="Enter"||e.key===" "))e.preventDefault()};
});
$("builderInstallSheet").onclick=installSheetForBuilder;
/* реквизиты КП: правки полей сохраняются в проект (settings.docHeader) */
Object.keys(DOC_FIELDS).forEach(id=>{$(id).oninput=applyDocHeader});
/* Условия сделки: работы, материалы, скидка, ставка НДС и его наличие в КП. Всё это —
   настройки проекта, поэтому потребителей не перечисляем (applyProjectSettings). Строка
   с disabled остаётся здесь: это состояние самого органа ввода, а не чужое представление. */
function applyTerms(){
  EP_DATA.settings.workPercent=Math.max(0,Math.min(200,Number($("workInput").value)||0));
  EP_DATA.settings.materialsPercent=Math.max(0,Math.min(200,Number($("materialsInput").value)||0));
  EP_DATA.settings.discountPercent=Math.max(0,Math.min(100,Number($("discountInput").value)||0));
  EP_DATA.settings.vatPercent=Math.max(0,Math.min(30,Number($("vatInput").value)||0));
  EP_DATA.settings.vatEnabled=$("vatEnabled").checked;
  $("vatInput").disabled=!EP_DATA.settings.vatEnabled;
  applyProjectSettings();
}
["workInput","materialsInput","discountInput","vatInput"].forEach(id=>{$(id).oninput=applyTerms});
$("vatEnabled").onchange=applyTerms;
/* валюта отображения и курс */
function applyCurrency(){
  EP_DATA.settings.displayCurrency=$("currencySelect").value;
  applyProjectSettings();
  if(EP_DATA.settings.displayCurrency==="RUB"&&!(EP_DATA.settings.eurRate>0))refreshRate();
}
$("currencySelect").onchange=applyCurrency;
$("rateRefreshBtn").onclick=refreshRate;
/* Ручной курс: пустое/нечитаемое значение EPRates.manual отвергает — тогда настройка не
   изменилась и перерисовывать нечего. */
$("rateInput").oninput=()=>{
  if(!applyRateEntry(EPRates.manual($("rateInput").value)))return;
  applyProjectSettings();
};
/* Надбавка к курсу — часть условий сделки, но влияет и на рублёвое представление
   каталога/сметы/шаблонов/свойств (в EUR-режиме money() всё равно вернёт евро — перерисовка
   безвредна). Список потребителей — там же, где у всех настроек. */
function applySurcharge(){
  EP_DATA.settings.rateSurchargePercent=Math.max(0,Math.min(100,Number($("surchargeInput").value)||0));
  applyProjectSettings();
}
$("surchargeInput").oninput=applySurcharge;
/* Ловушка фокуса полноэкранного конструктора: Tab обязан ходить ПО ОКНУ, а не уводить на
   элементы под ним (у окна role="dialog" aria-modal="true", и уехавший за него фокус — это и
   потерянная клавиатура, и правки холста вслепую). Список фокусируемых собираем на каждый
   Tab: содержимое окна перерисовывается целиком при любой правке поста. */
function trapBuilderFocus(e){
  const modal=$("postModal").querySelector(".modal");
  const items=[...modal.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
    .filter(el=>el.offsetParent!==null);
  if(!items.length)return;
  const first=items[0],last=items[items.length-1];
  const active=document.activeElement;
  if(e.shiftKey&&(active===first||!modal.contains(active))){e.preventDefault();last.focus()}
  else if(!e.shiftKey&&(active===last||!modal.contains(active))){e.preventDefault();first.focus()}
}
document.onkeydown=e=>{
  /* горячие клавиши не должны срабатывать во время ввода в поля (имя комнаты и т.п.) */
  const typing=/^(input|textarea|select)$/i.test(e.target.tagName)||e.target.isContentEditable;
  /* Открытый конструктор — модальное окно на весь экран: горячие клавиши холста (Delete,
     пробел-«рука», B, Backspace) под ним работать не должны. Раньше это было неважно —
     окно занимало часть экрана и полей ввода в нём почти не было; теперь Delete в поле
     группы света удалил бы выделенный на плане объект, а пробел на карточке товара вместо
     нажатия включил бы панораму. */
  const inBuilder=$("postModal").classList.contains("open");
  /* Ловушку Tab снимаем, пока поверх конструктора висит вопрос об охвате правки типа стены:
     иначе Tab утаскивал бы фокус обратно в окно поста, а по кнопкам самого вопроса пройти
     было бы нельзя. return остаётся в обоих случаях — горячим клавишам холста под модалкой
     делать нечего. */
  if(inBuilder&&e.key==="Tab"){
    if(!$("wallScopeModal").classList.contains("open"))trapBuilderFocus(e);
    return;
  }
  if(e.key==="Escape"){
    /* АВТОПОВТОР ЗАЖАТОЙ КЛАВИШИ — НЕ ВТОРОЕ ДЕЙСТВИЕ. Удержанный Esc сыплет срабатываниями
       каждые ~30 мс, и подтверждение «повторите, чтобы закрыть без сохранения» снималось
       собственным же первым нажатием: несобранный пост пропадал молча. Ни одному разбору Esc
       ниже автоповтор не нужен — гасим его сразу, до всех веток. Нижняя граница окна в
       EPConfirmRepeat страхует то же самое со стороны логики (человек может и постучать по
       клавише), но здесь дефект снимается в источнике. */
    if(e.repeat)return;
    if($("pdfPageModal").classList.contains("open")){finishPdfPageSelection(null);return}
    /* Вопрос об охвате правки типа стены висит ПОВЕРХ конструктора, поэтому разбирается
       раньше конструктора: иначе Esc закрыл бы окно поста из-под неразрешённого промиса. */
    if($("wallScopeModal").classList.contains("open")){finishWallScope(null);return}
    if(!uploadPopover.hidden)setUploadPopover(false,true);
    if(inBuilder){
      /* Esc В ПОЛЕ ВВОДА ВЫХОДИТ ИЗ ПОЛЯ, А НЕ ИЗ ОКНА. Человек набирает группу света и жмёт
         Esc, отменяя ввод, — а закрывался весь конструктор и вместе с ним пропадал весь
         несобранный пост: механизмы, накладка, имя. Первое нажатие возвращает фокус из поля,
         второе — уже разговор про окно (и с несохранёнными правками попросит подтверждения). */
      if(typing&&$("postModal").contains(e.target)){
        e.preventDefault();
        /* Фокус остаётся ВНУТРИ окна: уводим на ближайшую кнопку той же строки (а не на body,
           откуда клавиатура снова начинала бы с начала). Ловушка Tab и так держит фокус в
           окне, но «отпущенный в никуда» фокус — это потерянное место в форме. */
        const near=e.target.closest(".builder-slot")?.querySelector("[data-slot-replace]")||$("builderSearch");
        e.target.blur();if(near)near.focus();
        return;
      }
      e.preventDefault();requestClosePostBuilder();return;
    }
    setTool("select");
  }
  if(e.key==="Enter"&&(state.tool==="wall"||state.tool==="roomline"))setTool("select");
  if(e.key==="Delete"&&state.selected&&!typing&&!inBuilder)removeEntity(state.selected.kind,state.selected.id);
  /* Клавиатура для выделенного объекта (PLAN 4): Enter — конструктор поста, стрелки —
     сдвиг на шаг сетки (Shift — на 1px). Только вне ввода и при закрытом конструкторе. */
  if(!typing&&state.selected&&!inBuilder){
    if(e.key==="Enter"&&state.selected.kind==="post"){e.preventDefault();openPostBuilder({placedId:state.selected.id});return}
    const step=e.shiftKey?1:state.gridStep;
    const nudge={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[e.key];
    if(nudge&&moveSelectedBy(nudge[0],nudge[1])){e.preventDefault();return}
  }
  /* Backspace во время рисования разметки — снять последнюю точку (Esc — выход из режима) */
  if(e.key==="Backspace"&&state.tool==="roomline"&&!typing&&!inBuilder&&state.roomLinePoints.length){e.preventDefault();removeLastRoomLinePoint()}
  /* B — переключение видимости подложки (независимо от раскладки, по физической клавише) */
  if(e.code==="KeyB"&&!typing&&!inBuilder&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();cyclePlanVisibility()}
  /* Пробел — режим «рука» для панорамы (курсор-подсказка). preventDefault, чтобы
     пробел не прокручивал страницу и не «нажимал» сфокусированную кнопку. */
  if(e.code==="Space"&&!typing&&!inBuilder){e.preventDefault();if(!spaceDown){spaceDown=true;setPanReady(true)}}
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
