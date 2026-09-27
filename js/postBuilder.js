/* Конструктор поста (окно #postModal) — вынесен из app.js по разделу И docs/ОСТАТОК-РАБОТ (И1, шаг 3).
   Здесь ВСЁ окно поста: подбор накладки по умолчанию под комнату, отрисовка слотов/каталога/состава,
   смена числа модулей и комнаты, сохранение поста/шаблона, закрытие с подтверждением, лист монтажника
   из окна и провязка кнопок #postModal. Перенос ДОСЛОВНЫЙ — поведение не менялось (решение владельца
   «на экране ничего не меняется»).

   УСТРОЙСТВО — фабрика (не просто namespace, как posts.js): app.js вызывает EPPostBuilder.attach(ctx)
   ОДИН раз и получает назад функции, которые всё ещё зовёт сам (openPostBuilder — из renderTemplates/
   renderPosts/renderProperties/keydown; renderPostSlotCountSelect — из init; requestClosePostBuilder —
   из keydown). Зависимости приходят объектом ctx: state, DOM-доступ ($/canvas), деньги/экранирование,
   каталожные хелперы app.js и соседние рендеры. Так модуль не знает про глобальную лексику app.js, а
   поведенческий стенд (tests/helpers/appStand.js) режет отсюда НАСТОЯЩИЙ текст функций и исполняет его
   в vm, подавая те же имена контекстом (SOURCE_FILES включает этот файл).

   Модули EP* и EP_DATA — window-глобалы (сборщика нет, PLAN 2.2): их не прокидываем, они доступны в
   браузере напрямую. Функции внутри attach объявлены `function имя(` С НАЧАЛА СТРОКИ намеренно — по ним
   стенд находит и вырезает тело; порядок функций и соседних const (builderDirty за builderSignature,
   ESC_CONFIRM_MS между closePostBuilder и requestClosePostBuilder) сохранён из app.js — на смежность
   опираются вырезки стенда.

   Общий код (WALL_STEP_LABEL/STANDARD_LABEL/STANDARD_GENITIVE, roomCatalogFilter, preferOwnFrame,
   frameFacing*, askWallScope, «Подобрать накладку») остался в app.js и приходит сюда через ctx.

   Интерфейс приложению — window.EPPostBuilder.attach(ctx) → { openPostBuilder, renderPostSlotCountSelect, requestClosePostBuilder, builderRoomFilter }. */
(() => {
"use strict";

/* Фабрика окна поста: раскладывает зависимости из ctx, поднимает все функции конструктора и провязку
   #postModal, возвращает то, что app.js продолжает звать по имени. Вызывается один раз из app.js. */
function attach(ctx){
const {
  $,STANDARD_GENITIVE,STANDARD_LABEL,WALL_STEP_LABEL,askWallScope,assembledPostHtml,
  backlightCatalogOptions,backlightRowSummary,bindProductPictureFallbacks,buildPostSheet,byKind,canvas,
  compatibleMechanisms,defaultPostName,enhancePicker,esc,findByExactCode,frameFacingEmptyText,
  frameFacingHintText,frameFacingLabels,frameFacingList,frameFacingSelectionLabels,frameOptions,frameProduct,
  frameSlotCount,frameSlotOptions,innardsEmptyText,isBareMechanism,isControlPlaceItem,keySlotKind,
  lightingFor,lightingHtml,lightingRowSummary,lightingRowsFor,mechanismModulesTotal,mechanismSpan,
  moduleWord,money,openInstallSheet,postComposition,postTotalCost,preferOwnFrame,
  product,productMoney,productPicture,productSeries,renderAll,renderLightingSchemeSelect,
  renderProperties,renderSummary,renderTemplates,roomCatalogFilter,socketBox,state,
  toast,uid,updateStatus
}=ctx;

/* Пустой поиск накладки: артикул есть в каталоге, но отсеян фильтром. Возвращаем описание, а
   когда причина — число модулей, ещё и действие «переключить». null — если артикула нет или он и
   так подходит под текущий фильтр (тогда обычный список его и так показал бы).
   ⚠️ ДВЕ ПРИЧИНЫ ОТСЕВА, РАЗНОЕ ПОВЕДЕНИЕ. Коллекция комнаты (E13) сужает список ПЕРВЫМ шагом,
   поэтому её проверяем раньше числа модулей: накладка чужой коллекции скрыта именно ею. Здесь мы
   ОБЪЯСНЯЕМ (как resolveMissingMechanism про «другую серию»), но действия не даём — сменить
   коллекцию помещения из конструктора поста было бы решением за человека; это отдельный
   осознанный выбор в свойствах комнаты. Отсев по числу модулей остаётся с действием
   «переключить»: размер — свойство самого поста, его человек и меняет здесь. */
function resolveMissingFrame(query,currentCount,frameSelect,collection){
  const item=findByExactCode(byKind("frame"),query);
  if(!item)return null;
  if(collection&&!productSeries(item).includes(collection)){
    return{
      lead:"Артикул есть в каталоге, но другой коллекции.",
      code:item.code||"без артикула",
      name:item.name||"Без названия",
      note:`коллекция ${productSeries(item).join(", ")||"—"}`,
      reason:`помещение закреплено за коллекцией «${collection}», а эта накладка — коллекции «${productSeries(item).join(", ")||"—"}». Сменить коллекцию можно в свойствах комнаты.`
    };
  }
  const target=frameSlotCount(item);
  if(target===currentCount)return null;   /* уже подходит под текущий размер — подсказка не нужна */
  return{
    lead:"Артикул есть в каталоге, но скрыт фильтром по числу модулей.",
    code:item.code||"без артикула",
    name:item.name||"Без названия",
    note:target?moduleWord(target):"число модулей не указано",
    actionLabel:target?`Переключить на ${moduleWord(target)}`:null,
    onAction:target?()=>{
      /* Человек ВЫБРАЛ накладку (кнопкой «Переключить» в пустом поиске) — это ручной выбор: снимаем
         frameAuto ДО changePostSlotCount, иначе applyAutoDefaultFrame внутри перетёр бы выбранную
         накладку авто-умолчанием комнаты (§7.1, «первое действие человека снимает флаг»). */
      state.builder.frameAuto=false;
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
/* Подсветка клавиш ПОСТА в конструкторе — орган управления ЧЕРНОВИКОМ переопределения
   (state.builder.backlight): «как в проекте» (null), «своя подсветка» (объект enabled:true) и
   «выключить у поста» (объект enabled:false). Синхронизирует UI из черновика — активную кнопку
   режима, значения и доступность селекторов, подсказку.
   ⚠️ Показываем орган ТОЛЬКО у поста НА ПЛАНЕ (editingPlacedId): переопределение — свойство места,
   а не заготовки, как и группа света («один шаблон в трёх комнатах это три разные подсветки»). У
   шаблона/нового поста вместо органа — объяснение (postBacklightTemplateNote), той же логикой, что
   у поля группы в renderBuilderSlots.
   Варианты цвета и напряжения — ИЗ КАТАЛОГА (backlightCatalogOptions), тем же способом и из того
   же источника, что панель «Спецификация»: матчинг в подборе строгий (===), хардкод «Зеленая» без ё
   молча дал бы пустой подбор. Одна точка синхронизации доступности: цвет/напряжение недоступны, пока
   выбран не режим «своя подсветка», чтобы человек не крутил настройку, которая ни на что не влияет. */
function renderPostBacklight(){
  const step=$("postBacklightStep");
  if(!step)return;
  const placed=!!state.builder.editingPlacedId;
  const control=$("postBacklightControl"),note=$("postBacklightTemplateNote");
  if(control)control.hidden=!placed;
  if(note)note.hidden=placed;
  if(!placed)return;
  const draft=state.builder.backlight;
  const mode=draft==null?"project":(draft.enabled?"on":"off");
  document.querySelectorAll("#postBacklightMode .wall-type-option").forEach(b=>{
    const on=b.dataset.backlight===mode;
    b.classList.toggle("active",on);
    b.setAttribute("aria-checked",on?"true":"false");
  });
  const {colors,volts}=backlightCatalogOptions();
  const own=mode==="on";
  const fill=(sel,values,current)=>{
    if(!sel)return;
    sel.innerHTML=values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("");
    /* Присвоение value отсутствующей опции снимает выбор ("") — сохранённое переопределение с
       цветом, которого в каталоге уже нет, честно покажет пусто, а не подставит соседний. */
    if(current!=null)sel.value=current;
    sel.disabled=!own;
  };
  fill($("postBacklightColor"),colors,draft&&draft.color);
  fill($("postBacklightVoltage"),volts,draft&&draft.voltage);
  const hint=$("postBacklightHint");
  if(hint)hint.textContent=mode==="project"
    ?"Пост следует настройке подсветки всего проекта (панель «Спецификация»). Меняется вместе с ней."
    :mode==="off"
      ?"У этого поста подсветка выключена — даже если в проекте она включена."
      :"У этого поста своя подсветка: цвет и напряжение из каталога, независимо от проекта.";
}
/* Селектор «Количество модулей рамки» — НЕ константа в разметке, а производная модульностей
   накладок (EPCatalog.frameSlotOptions). ⚠️ СЧИТАЕМ ОТ ТОГО ЖЕ ПУЛА, ЧТО renderBuilder ФИЛЬТРУЕТ
   (collectionFramePool), а не от всего каталога: коллекция комнаты (E13) сужает список накладок
   первым шагом, и селектор обязан предлагать только те модульности, что в этом пуле реально есть.
   Иначе (баг E13) селектор строился от полного каталога и предлагал модульность, которой у
   коллекции нет; выбор такой модульности давал пустой matchingFrames, renderBuilder проваливался
   в фолбэк `matchingFrames.length?…:poolFrames` и показывал ВЕСЬ пул коллекции под видом фильтра
   (Eikon Tactil, «8 модулей» → 33 накладки на 2/3/4). Пул зависит от editingPlacedId → комнаты
   поста; на init и для нового поста/шаблона комнаты нет → пул = весь каталог (совместимо со старым
   проектом без коллекции). extra — фактическая ёмкость открываемого поста: её добавляем отдельным
   вариантом, чтобы сохранённый пост с исчезнувшей у коллекции модульностью не показал чужое
   значение (см. openPostBuilder и frameSlotOptions). */
function renderPostSlotCountSelect(extra){
  const sel=$("postSlotCount");
  if(!sel)return;
  sel.innerHTML=frameSlotOptions(collectionFramePool(byKind("frame")),extra)
    .map(n=>`<option value="${n}">${n}</option>`).join("");
}

/* «Обычная» накладка — без специального принципа сборки (principle в catalog-vimar-attrs.js):
   переходные «на N модулей центрально/по бокам для коробки на M» и защитные крышки IP несут
   непустой principle (1M_CENTRAL, 2M_CENTRAL, 1M_CENTRAL_3, 2_OFFSET, «NO_SUPPORT, AQUAPLATE»),
   у рядовой накладки поле пусто. По умолчанию НОВОМУ посту такие изделия не навязываем — человек
   выберет их из списка сам; признак берём ИЗ ДАННЫХ каталога (principle), а не из названия. */
function ordinaryFrame(frame){return !!frame&&!frame.principle;}
/* Ближайшая к 3 модулям накладка списка: историческое умолчание нового поста — 3-модульная; нет
   её в пуле — берём НАИБЛИЖАЙШУЮ по числу модулей (а не первую в каталоге, п.4). Равная близость →
   меньшая модульность (детерминированно). Накладки без известной модульности — в конец. */
function nearestToThreeFrame(list){
  const withCount=list.filter(frame=>frameSlotCount(frame)!=null);
  if(!withCount.length)return list[0]||null;
  return withCount.slice().sort((a,b)=>
    Math.abs(frameSlotCount(a)-3)-Math.abs(frameSlotCount(b)-3)||frameSlotCount(a)-frameSlotCount(b))[0];
}
/* Накладка по умолчанию ИЗ ГОТОВОГО ПУЛА: обычные (ordinaryFrame) предпочитаем спец-изделиям, и
   лишь если обычных в пуле нет — берём любую. count задан (человек выбрал число модулей в
   селекторе) → ровно эта модульность; не задан (открытие/смена комнаты) → ближайшая к 3. */
function pickDefaultFrame(pool,count){
  const ordinary=pool.filter(ordinaryFrame);
  const base=ordinary.length?ordinary:pool;
  if(count!=null)return base.find(frame=>frameSlotCount(frame)===count)||pool.find(frame=>frameSlotCount(frame)===count)||null;
  return nearestToThreeFrame(base);
}
/* Признаки текущей накладки, которые пере-подбор нетронутого поста сохраняет при смене числа
   модулей: серия, цвет и монтажный стандарт (только IT/DE — «универсальную» BOTH отбор не сужает).
   productsForRoom по стандарту "IT"/"DE" пропускает и BOTH-накладки, поэтому доужение по стандарту
   образца не теряет универсальные. */
function ownFrameCriteria(frame){
  return {
    collection:productSeries(frame)[0],
    frameColor:frame.frameColor||null,
    standard:frame.standard==="IT"||frame.standard==="DE"?frame.standard:null
  };
}
/* Накладка по умолчанию НОВОГО поста — ИЗ ПУЛА ЕГО КОМНАТЫ (тот же EPCatalog.productsForRoom +
   roomCatalogFilter, что сужает список накладок в конструкторе; §7.1 — второй копии правил нет).
   count задан — ровно эта модульность, иначе ближайшая к 3 (pickDefaultFrame). sample — текущая
   накладка: при смене ЧИСЛА МОДУЛЕЙ у нетронутого поста сохраняем её серию/цвет/стандарт
   (preferOwnFrame), чтобы 3→4 у белой итальянской Neve Up дало 09674.01 (IT), а не 09664.01 (DE).
   Открытие и смена комнаты образца не передают — там подбор «с чистого листа». Комнаты нет →
   roomCatalogFilter(null) даёт пустой критерий → пул = весь каталог → прежнее умолчание. Пул ПУСТ
   (сочетания стандарт/серия/цвет в каталоге нет) → null: чужую накладку НЕ подставляем — пост
   откроется без накладки (frameUnset), renderBuilder объяснит словами, чего не хватает. */
function defaultFrameForRoom(room,count,sample){
  const pool=EPCatalog.productsForRoom(byKind("frame"),roomCatalogFilter(room));
  const pick=p=>pickDefaultFrame(p,count);
  return sample?preferOwnFrame(pool,ownFrameCriteria(sample),pick):pick(pool);
}
/* Проставить НОВОМУ посту накладку по умолчанию из пула ЕГО комнаты — ЕДИНАЯ точка для мест, где новый
   пост получает накладку, не спросив комнату: смена «Комнаты поста» и смена числа модулей (открытие
   нового поста зовёт defaultFrameForRoom напрямую — ему нужен объект накладки для ёмкости/имени). §7.1 —
   чтобы у правила не было краёв. Работает ТОЛЬКО пока накладка АВТОМАТИЧЕСКАЯ (state.builder.frameAuto):
   первое действие человека (ручной выбор накладки любым путём — поле, «переключить» в пустом поиске; ИЛИ
   добавление механизма в рамку) снимает флаг навсегда для этого открытия, и дальше конструктор ведёт
   себя как раньше. Пост на плане и шаблон сюда не заходят — у них frameAuto=false, своя накладка. sample
   — текущая накладка для сохранения её серии/цвета/стандарта при смене числа модулей (см.
   defaultFrameForRoom); открытие/смена комнаты его не передают. Накладку отдаём renderBuilder через
   dataset.preferredFrameId (он главнее остатка value), поэтому саму отрисовку не трогаем. Возвращает
   выбранную накладку или null (пустой пул) — вызывающему для пересчёта ёмкости. */
function applyAutoDefaultFrame(count,sample){
  if(!state.builder.frameAuto)return null;
  const frame=defaultFrameForRoom(builderFilterRoom(),count,sample);
  $("postFrameSelect").dataset.preferredFrameId=String(frame?frame.id:"");
  return frame;
}
/* Признак «имя поста человек не менял» (то же автоимя, что ставит defaultPostName) — ОДНА точка
   правила (§7.1), чтобы синхронизация имени при открытии, смене комнаты и смене числа модулей не
   разошлась копиями регэкспа. */
function isAutoPostName(name){return /^Пост (?:на )?\d+ (?:мест|место|места|модул)/i.test(String(name==null?"":name).trim());}
/* Автоимя поста следует за модульностью выбранной накладки: если человек имя не менял, переписываем
   его под mods. Ручное имя не трогаем. */
function syncAutoPostName(mods){
  if(isAutoPostName($("postName").value))$("postName").value=defaultPostName(mods);
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
  /* «Накладка автоматическая» — только у НОВОГО поста (ни placedId, ни templateId): её выбрал за человека
     defaultFrameForRoom из пула комнаты, и смена комнаты/числа модулей вправе её пере-подобрать. У поста
     на плане и шаблона накладка своя (frameAuto=false) — applyAutoDefaultFrame их не трогает. */
  state.builder.frameAuto=!placedId&&!templateId;
  /* Каждое открытие начинается с чистого выбора: цель «добавить», пустой поиск и ВСЕ разделы
     каталога свёрнуты — «разделы могут быть изначально не раскрыты» (заказчик, 24.08). */
  state.builder.target={mode:"add"};state.builder.query="";state.builder.openSections=new Set();
  let src;
  if(placedId){src=state.posts.find(x=>x.id===placedId);$("postModalTitle").textContent="Редактирование поста на плане"}
  else if(templateId){src=state.templates.find(x=>x.id===templateId);$("postModalTitle").textContent="Редактирование шаблона поста"}
  else{
    /* НОВЫЙ ПОСТ: накладку по умолчанию берём ИЗ ПУЛА КОМНАТЫ, в которой его открыли (defaultFrameForRoom),
       а НЕ из начала всего каталога. Комната нового поста — первая комната проекта (та же, что назначается
       state.builder.roomId ниже, «выбираем комнату, для которой собираем пост»). Пул под комнату пуст →
       накладки нет (frameId null): пост откроется с честным объяснением, чем сузили, вместо чужой белой
       Neve Up (09673.01) из начала каталога. Комнат в проекте нет → пул = весь каталог → прежний дефолт. */
    const defaultFrame=defaultFrameForRoom(state.rooms[0]||null);
    /* Имя и число модулей нового поста — ПО ВЫБРАННОЙ НАКЛАДКЕ, а не жёстко 3 (п.1): в немецкой
       комнате дефолт 2-модульный, имя «Пост на 3 модуля» разошлось бы с накладкой. Пул пуст
       (накладки нет) → 3 как прежнее умолчание имени; накладки всё равно нет (frameUnset). */
    const defaultMods=defaultFrame?frameSlotCount(defaultFrame):3;
    src={name:defaultPostName(defaultMods),frameId:defaultFrame?defaultFrame.id:null,mechanismIds:[]};
    $("postModalTitle").textContent="Новый электрический пост";
  }
  const sourceMechanismIds=Array.isArray(src.mechanismIds)?src.mechanismIds:[];
  const capacity=frameSlotCount(frameProduct(src.frameId))||Math.max(1,Math.min(21,mechanismModulesTotal(sourceMechanismIds)||3));
  /* ⚠️ КОМНАТА ИЗВЕСТНА ДО СБОРКИ СЕЛЕКТОРА (ОТДЕЛКА-ПОРЯДОК, п.3; п.1). Пост на плане уже стоит в
     комнате — берём её (roomId поста). НОВЫЙ пост/шаблон комнаты не имеет: подставляем ПЕРВУЮ комнату
     проекта, чтобы отбор был активен сразу («выбираем комнату, для которой будем составлять пост»);
     человек меняет её селектором «Комната». Комнат нет → null: отбор не сужаем, поведение прежнее.
     roomId задаём ДО renderPostSlotCountSelect — тот строит модульности из пула ИМЕННО этой комнаты
     (collectionFramePool→builderFilterRoom→roomId); иначе в немецкой комнате предложил бы 3/7/14/21,
     которых в её пуле нет. */
  state.builder.roomId=placedId?(src.roomId??null):(state.rooms[0]?state.rooms[0].id:null);
  /* Наполняем селектор ДО присвоения value: варианты — модульности каталога плюс фактическая
     ёмкость этого поста. Иначе пост с исчезнувшей модульностью не нашёл бы своей опции и
     показал бы чужое значение (см. frameSlotOptions). Многорядные 14/21 теперь входят в
     обычный каталог модульностей через frameSlotCount. */
  renderPostSlotCountSelect(capacity);
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
  /* Подсветка поста — ЧЕРНОВИК окна, как тип стены: у поста своё переопределение (src.backlight,
     если это объект — та же трактовка «валидности», что у EPPosts.postBacklight), иначе null =
     «как в проекте». Копируем ОБЪЕКТ, а не ссылку: правка черновика до «Сохранить» не должна
     менять сам пост (иначе «Отмена» уже ничего не откатила бы). У шаблона/нового поста
     переопределения нет — src.backlight отсутствует → null. */
  state.builder.backlight=(src.backlight&&typeof src.backlight==="object")
    ?{enabled:!!src.backlight.enabled,color:src.backlight.color||null,voltage:src.backlight.voltage||null}
    :null;
  /* Галочка «ограничить цветом накладки» — свойство поста, переживает сохранение. По умолчанию
     ВЫКЛЮЧЕНА (начинка любого цвета). Старый пост без поля читается как «ограничение выключено»
     (!!undefined === false) — новый дефолт, не включённое ограничение. */
  state.builder.restrictInnardsColor=!!src.restrictInnardsColor;
  renderBuilderRoomSelect();
  $("builderRestrictColor").checked=state.builder.restrictInnardsColor;
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
   ТИП СТЕНЫ, ПОДСВЕТКА И ГАЛОЧКА «ограничить цветом накладки» В ПОДПИСИ ОБЯЗАТЕЛЬНЫ: все они —
   черновик окна и свойство поста, и без них закрытие по Esc считало бы пост нетронутым и молча
   выбрасывало бы правку, о которой человек не предупреждён. Подсветка — объект/null, кодируем JSON
   (как слоты), а не склейкой; галочка — булев флаг. */
function builderSignature(){
  return JSON.stringify([$("postName").value,String($("postFrameSelect").value||""),
    builderWallType(),state.builder.backlight,!!state.builder.restrictInnardsColor,EPBuilderSlots.signature(state.builder.slots)]);
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
    /* Номер проходной и ручной механизм — из ЧЕРНОВИКА окна, как keyGroups: расчёт связи и цены
       в конструкторе обязан учитывать номер/выбор, которые человек ввёл прямо сейчас. */
    keyCrossNumbers:fields.keyCrossNumbers,keyMechanisms:fields.keyMechanisms,
    /* Тип стены — из ЧЕРНОВИКА окна: состав и цена в конструкторе обязаны показывать ту
       коробку, которую человек только что выбрал кнопкой, а не ту, что записана в проекте. */
    wallType:builderWallType(),
    /* Подсветка — из ЧЕРНОВИКА окна по той же причине: состав и «Стоимость поста» обязаны
       показывать LED, который человек выбрал прямо сейчас. null → поля нет → postComposition
       (через EPPosts.postBacklight) читает проектную настройку, ровно как у сохранённого поста
       без переопределения. */
    backlight:state.builder.backlight};
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

/* ⚠️ ЕДИНСТВЕННЫЙ ИСТОЧНИК ЁМКОСТИ ПОСТА — НАСТОЯЩАЯ выбранная накладка (frameSlotCount), а НЕ
   значение селектора. От накладки же считаются деньги, состав и раскладка по постам — значит она
   и есть истина. Селектор «Количество модулей» только фильтрует, какие накладки предлагать.
   Фолбэк на селектор (count) — для старого поста, чья накладка не выбрана либо недоступна:
   там ёмкость несёт count, восстановленный при открытии поста (openPostBuilder). Функция ОДНА
   на всё окно: renderBuilder и pickBuilderProduct обязаны считать ёмкость ею, второго источника
   быть не должно — раньше
   pickBuilderProduct фитил состав от count, и выбор карточки при накладке 09668.01 (8М) с
   селектором «5» уничтожал три механизма (§7.1 «правило в одном месте»). */
function builderCapacity(){
  return frameSlotCount(frameProduct($("postFrameSelect").value))||Number($("postSlotCount").value);
}
/* Критерий отбора накладок под помещение РЕДАКТИРУЕМОГО поста (E13 коллекция + E14 отделка). ОДНА
   точка сбора всех критериев комнаты — и renderBuilder, и селектор модульностей, и хинт «показано
   из скольких» ходят через неё, второго правила отбора нет (§7.1). Комнату берём у поста на плане
   (editingPlacedId → roomId → комната); шаблон и НОВЫЙ пост комнаты не имеют → все критерии null →
   фильтра нет (пост «вне комнат»). Валидируем по спискам каталога: мёртвое (снятое из прайса)
   значение → null → предикат не применяется. */
/* Комната, ПОД КОТОРУЮ конструктор сужает каталог (ОТДЕЛКА-ПОРЯДОК, п.3). Источник — селектор
   «Комната» (state.builder.roomId): для нового поста его задаёт человек ДО сборки, для поста на
   плане openPostBuilder инициализирует его комнатой поста. Если roomId по какой-то причине не
   задан (старый вызов, тест-стенд без builder.roomId) — фолбэк на комнату размещённого поста, чтобы
   прежнее поведение E13/E14 не сломалось. Комнаты нет → null (каталог не сужаем). */
function builderFilterRoom(){
  if(state.builder.roomId!=null){
    const r=state.rooms.find(x=>x.id===state.builder.roomId);
    if(r)return r;
  }
  const placed=state.builder.editingPlacedId?state.posts.find(p=>p.id===state.builder.editingPlacedId):null;
  return placed?state.rooms.find(r=>r.id===placed.roomId)||null:null;
}
function builderRoomFilter(){
  return roomCatalogFilter(builderFilterRoom());
}
/* Критерий отбора НАЧИНКИ (клавиш/розеток/механизмов) под комнату — ПРОДОЛЖЕНИЕ того же
   productsForRoom, что сужает накладки (§7.1: правило «что подходит комнате» одно). У начинки
   ДРУГОЙ набор признаков, и это видно здесь, в одной точке: сужаем по цвету ЭЛЕМЕНТА, а значением
   критерия служит цвет НАКЛАДКИ комнаты (единственный цвет, заданный помещению) — их сводит
   EPCatalog.facingColorKey внутри productsForRoom. Серию начинке уже задаёт compatibleMechanisms по
   выбранной накладке, второй серийный фильтр не заводим.
   Галочка поста (restrictInnardsColor) ВКЛЮЧАЕТ цветовое ограничение начинки — накладку она не
   трогает (её сужает builderRoomFilter отдельно). По умолчанию ВЫКЛЮЧЕНА → критерий пуст → начинка
   не сужается по цвету (новый дефолт, решение владельца 16.09). Цвет комнаты не задан → критерий
   тоже пуст. */
function builderInnardsFilter(){
  if(!state.builder.restrictInnardsColor)return {};
  const color=EPRoom.roomFrameFacing(builderFilterRoom(),"frameColor",frameFacingList("frameColor"));
  return color?{elementColor:color}:{};
}
/* Селектор «Комната поста» в конструкторе. Комнат нет → поле скрыто (пост «вне комнат», отбор не
   сужаем). Для поста на плане комната фиксирована геометрией — селектор показываем, но отключаем:
   менять её здесь нельзя, привязка к помещению правится на плане. Значения — ЧЕЛОВЕЧЕСКИЕ имена
   комнат, id в value; экранируем имя (пользовательский ввод в HTML). */
function renderBuilderRoomSelect(){
  const wrap=$("builderRoomField"),sel=$("builderRoomSelect");
  if(!wrap||!sel)return;
  if(!state.rooms.length){wrap.hidden=true;sel.innerHTML="";return}
  wrap.hidden=false;
  const placed=!!state.builder.editingPlacedId;
  sel.disabled=placed;
  const cur=state.builder.roomId;
  sel.innerHTML=state.rooms.map((r,i)=>`<option value="${esc(String(r.id))}"${String(r.id)===String(cur)?" selected":""}>${esc(r.name||("Комната "+(i+1)))}</option>`).join("");
  sel.value=cur!=null?String(cur):"";
}
/* Накладки, ПОДХОДЯЩИЕ помещению поста по его отделке (коллекция E13 + материал/форма/цвет E14) —
   ЕДИНСТВЕННАЯ точка сужения каталога под комнату (второго правила для механизмов НЕ заводим: они
   наследуют серию ВЫБРАННОЙ накладки через compatibleMechanisms, а накладка уже из нужной коллекции).
   ⚠️ ПУСТОЙ ПУЛ ВОЗВРАЩАЕМ КАК ЕСТЬ, всем каталогом больше НЕ подменяем. При одной лишь коллекции пул
   был непуст по построению (roomCollection брала имя из того же productCollections), и прежний фолбэк
   «пусто→весь каталог» не исполнялся. С отделкой (E14) сочетание материал+цвет МОЖЕТ не иметь ни
   одной накладки — это законный результат, и подмена его каталогом показала бы 1631 накладку вместо
   честного «под это сочетание накладок нет». Пустоту объясняет словами renderBuilder (E14, п.6). */
function collectionFramePool(allFrames){
  return EPCatalog.productsForRoom(allFrames,builderRoomFilter());
}
function renderBuilder(){
  const count=Number($("postSlotCount").value),allMechanisms=byKind("mechanism");
  const frameSelect=$("postFrameSelect"),allFrames=byKind("frame");
  /* ⚠️ КОЛЛЕКЦИЯ КОМНАТЫ СУЖАЕТ СПИСОК НАКЛАДОК ПЕРВЫМ ШАГОМ (E13). Помещение закреплено за
     коллекцией — предлагаем накладки только её (встреча 24.08: «отсеять неподходящие рамки»).
     Фильтр по числу модулей идёт УЖЕ по этому пулу, а не по всему каталогу. Пост вне комнат /
     комната без коллекции / шаблон / новый пост → пул = весь каталог (collectionFramePool).
     Накладка, СЕЙЧАС стоящая в посте, ниже добавляется в frameList отдельно (requestedFrame) —
     даже будь она чужой коллекции, из поста она не пропадёт и состав/цена не изменятся молча. */
  const poolFrames=collectionFramePool(allFrames);
  const matchingFrames=poolFrames.filter(frame=>frameSlotCount(frame)===count);
  const frames=matchingFrames.length?matchingFrames:poolFrames;
  /* Хинт отделки (E14, п.5–6): «показано из скольких» и что сузило выбор — либо словами про пустое
     сочетание. Ставим на КАЖДЫЙ render (в т.ч. в ветках frameMissing/frameUnset ниже), до ранних
     выходов, чтобы человек всегда видел, чем сужен каталог. Пустая настройка → текст пуст. */
  {const fh=$("builderFrameFacingHint");if(fh){const t=frameFacingHintText(allFrames);fh.textContent=t;fh.classList.toggle("is-empty",t!==""&&poolFrames.length===0);}}
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
  /* Накладка поста может не пройти фильтр по числу модулей (старые/повреждённые данные) или НЕ
     попасть в список byKind("frame") как неактивная (снята с производства). Раньше её в таком
     случае молча подменяла frames[0] — и
     «Сохранить» переписывал post.frameId на первую попавшуюся накладку каталога, если она
     случайно оказалась совместимой. Поэтому накладку, СЕЙЧАС стоящую в посте, ДОБАВЛЯЕМ в список:
     пусть человек видит в поле ту накладку, которая у поста на самом деле, и меняет её сам, если
     захочет. */
  const requestedFrameId=hasExplicitFrame?explicitFrameId:frameSelect.value;
  /* Накладка, СЕЙЧАС стоящая в посте, разрешённая из ТОГО ЖЕ приоритетного источника, что и
     requestedFrameId (dataset важнее остатка value). Раньше эту роль играла explicitFrame,
     разрешавшаяся ТОЛЬКО из dataset — то есть только на ПЕРВОМ render. Со второго render (dataset
     снят) накладки, которой нет в byKind("frame") (неактивная или многорядная), в frameList уже
     не было, selectedFrameId падал на frames[0], и цена молча менялась (27,48 → 9,35 EUR на
     09666.21→09666.01). Берём requestedFrameId — он держит верный приоритет на ЛЮБОМ render. */
  const requestedFrame=requestedFrameId?frameProduct(requestedFrameId):null;
  const requestedFrameInfo=EPPosts.frameAvailability(requestedFrameId,requestedFrame);
  /* ⚠️ НАКЛАДКУ, НЕ РАЗРЕШИВШУЮСЯ В ТОВАР, МОЛЧА НЕ ПОДМЕНЯЕМ НИКОГДА.
     Артикул рамки поста мог уйти из перезалитого прайса (рабочий сценарий проекта) —
     frameProduct(frameId) вернул undefined. Раньше в этом случае бралась frames[0] — первая
     накладка каталога, — и «Сохранить» оставалось активным: пост записывался на чужую накладку
     с составом, урезанным под её ёмкость (проверено: 09666.01/6М с пятью механизмами →
     09661.01/1М, четыре механизма исчезали). Теперь держим накладку «недоступной»: в поле —
     плейсхолдер, ниже — причина человеческим текстом (конвенция «объясняем ПРИЧИНУ, а не молчим»,
     см. resolveMissingMechanism), сохранение заблокировано, механизмы поста сохранены (ёмкость
     берём от открытия, не от чужой накладки). Смотрим И dataset (первый render), И остаток value:
     dataset живёт один render, а состояние «недоступна» обязано пережить любую перерисовку до
     явного выбора замены человеком. */
  const frameMissing=requestedFrameInfo.missing;
  /* ⚠️ ТРЕТЬЕ СОСТОЯНИЕ — НАКЛАДКА НЕ ВЫБРАНА ВОВСЕ (пост без накладки). Смета уже различает три
     случая (js/estimate.js): накладка разрешилась в товар (норма), артикул ЗАДАН, но пропал из
     каталога (frameMissing — перезалит прайс) и накладки НЕТ (frameId пуст — «называть нечего»).
     Конструктор различал только два: `!!requestedFrameId` в frameMissing отсекал пустую строку,
     и пустой requestedFrameId проваливался в общий else ниже, где selectedFrameId молча брал
     frames[0] — та же выдуманная подмена, от которой защищались сверху, только со стороны нижней
     границы (шаблон с frameId:null → в поле появлялась первая накладка каталога, «Сохранить»
     писало её id). Пустой requestedFrameId ловим И на первом render (dataset=""), И на повторном
     (value="", dataset уже снят) — состояние обязано пережить перерисовку до выбора человеком.
     НОВЫЙ пост сюда попадает ТОЛЬКО когда под его комнату накладок нет вовсе (defaultFrameForRoom дал
     null: сочетания стандарт/серия/цвет в каталоге не существует) — это ЗАКОННОЕ «чего не хватает»,
     ради него задача и заведена: честный frameUnset вместо чужой накладки из начала каталога. При
     непустом пуле у нового поста накладка по умолчанию есть, и «создание с нуля» по-прежнему исключено. */
  const frameUnset=requestedFrameInfo.unset;
  /* ⚠️ ЧЕТВЁРТОЕ СОСТОЯНИЕ — НАКЛАДКА СНЯТА С ПРОИЗВОДСТВА (active:false), но остаётся выбранной.
     Решение владельца 02.09: проект мог быть сделан до снятия позиции, изделие физически
     существует и может лежать на складе — смета обязана считаться ПО НЕЙ, без сюрпризов. Поэтому,
     в отличие от frameMissing/frameUnset, сохранение РАЗРЕШАЕМ и идём нормальным путём (ёмкость,
     механизмы, деньги — всё от настоящей накладки). Отличие от нормы одно: помечаем «снята с
     производства» (в опции поля через frameOptions и приглушённым баннером в составе), чтобы
     человек видел, почему эта накладка не предлагается новым постам — её нет в byKind("frame").
     requestedFrame здесь заведомо разрешён в товар, поэтому с frameMissing/frameUnset это
     состояние не пересекается. Новым постам она не грозит: defaultFrameForRoom берёт накладку из
     EPCatalog.productsForRoom(byKind("frame"),…) (active), а в списке выбора неактивных нет — они
     попадают в frameList только как УЖЕ стоящая в посте накладка. */
  const frameDiscontinued=requestedFrameInfo.discontinued;
  const frameList=requestedFrame&&!frames.some(frame=>Number(frame.id)===Number(requestedFrame.id))
    ?[requestedFrame,...frames]:frames;
  const selectedFrameId=frameList.some(frame=>Number(frame.id)===preferredFrameId)?preferredFrameId:frameList[0]?.id;
  if(frameMissing){
    /* Плейсхолдер несёт недоступный id значением, чтобы следующий render снова увидел
       «недоступна» через value (dataset к тому моменту уже снят); список рабочих накладок ниже
       остаётся — человек выбирает замену прямо здесь, и тогда frameMissing гаснет сам. */
    frameSelect.innerHTML=`<option value="${esc(String(requestedFrameId))}">Накладка недоступна — выберите замену</option>`
      +frameOptions(frameList,null);
    frameSelect.value=String(requestedFrameId);
  }else if(frameUnset&&frameList.length){
    /* Накладка не выбрана: плейсхолдер с ПУСТЫМ value (следующий render снова увидит «не выбрана»
       через value) и список рабочих накладок — человек выбирает сам, frames[0] молча НЕ ставим. */
    frameSelect.innerHTML=`<option value="">Накладка не выбрана — выберите накладку</option>`
      +frameOptions(frameList,null);
    frameSelect.value="";
  }else{
    /* Список пуст по ДВУМ разным причинам, и человеку они говорят разное: каталог накладок вообще не
       загружен (byKind("frame") пуст — прайс не подключён) ЛИБО под ЭТУ комнату накладок нет (пул сузила
       комната, п.5). Второе — «Рамки не загружены» врало бы: каталог на месте, просто ничего не подходит
       под стандарт/серию/цвет комнаты; направляем в свойства комнаты. */
    frameSelect.innerHTML=frameList.length
      ?frameOptions(frameList,selectedFrameId)
      :(allFrames.length
        ?'<option value="">Под эту комнату накладок нет — измените отбор в свойствах комнаты</option>'
        :'<option value="">Рамки не загружены</option>');
    frameSelect.value=selectedFrameId==null?"":String(selectedFrameId);
  }
  delete frameSelect.dataset.preferredFrameId;
  /* Накладка остаётся выпадающим списком EPPicker: их 1631, и разделами по функциональной
     группе они не режутся (группировка накладок — по СЕРИИ), а без поиска по артикулу с таким
     объёмом не жить. Пустой поиск объясняет, среди чего искали, и предлагает переключить
     размер, если артикул отсеян фильтром модулей.
     ⚠️ emptyContext ОБЯЗАН НАЗЫВАТЬ РЕАЛЬНО ИСКОМОЕ МНОЖЕСТВО. Коллекция комнаты (E13) сужает
     список ПЕРВЫМ шагом (collectionFramePool), поэтому её имя тоже идёт в контекст — иначе в
     комнате Eikon Tactil с «8 модулей» пустой поиск врал «среди загруженных накладок», хотя
     искали по 33 из 1631, и о коллекции не говорил ни слова (правку E13 применили к соседнему
     resolveMissing и забыли здесь). emptyContext даём ФУНКЦИЕЙ (picker её поддерживает): коллекцию
     вычисляем лениво, в момент показа пустого сообщения, ровно как это делает соседний
     resolveMissing — так renderBuilder не зовёт builderRoomFilter на каждый render зря. */
  enhancePicker(frameSelect,{
    emptyContext:()=>{
      /* Пустой поиск обязан назвать РЕАЛЬНО искомое множество: не только коллекцию (E13), но и
         отделку комнаты (E14) — иначе в комнате с материалом «Металл» поиск врал бы «среди накладок
         коллекции X», хотя искали по её металлическим накладкам. Ту же формулировку «что сузило»
         берём из frameFacingLabels, второй копии текста нет. */
      const filter=builderRoomFilter();
      const collection=filter.collection;
      const collSuffix=collection?` коллекции «${collection}»`:"";
      const facing=frameFacingLabels(filter);
      const facingSuffix=facing.length?` с отделкой: ${facing.join(", ")}`:"";
      const base=matchingFrames.length
        ?`накладок на ${moduleWord(count)}${collSuffix}`
        :(collection?`накладок${collSuffix}`:(facing.length?"накладок":"загруженных накладок"));
      return base+facingSuffix;
    },
    resolveMissing:q=>resolveMissingFrame(q,count,frameSelect,builderRoomFilter().collection)
  });
  /* ⚠️ НАКЛАДКИ НЕТ — СЧИТАТЬ НЕЧЕГО. Это состояние (`selectedFrame` не разрешился в товар)
     появилось, когда перестали молча подменять недоступную накладку. Ёмкость, раскладка по
     постам, список совместимых механизмов и превью — ВСЁ считается ОТ накладки; без неё их
     не «ноль ограничений», а «нет исходных данных». Раньше отсутствие накладки утекало в
     builderCapacity (фолбэк на селектор → фантомная ёмкость), compatibleMechanisms(undefined)
     (весь каталог без фильтра серии), distributePosts(undefined) (фантомный пост на 1 модуль)
     и в превью — окно печатало ВТОРУЮ, вымышленную ошибку «Несовместимое сочетание… по 1
     модуль», обещало «Свободно N» при нуле карточек и рисовало 1 модуль из пяти.
     Поэтому в этом состоянии НЕ считаем ничего от накладки и НЕ трогаем механизмы поста (ни
     фита, ни упаковки — их сохранность главнее): окно называет РОВНО одну причину (баннер),
     сохранение заблокировано, слева живой список слотов с настоящими механизмами. */
  if(frameMissing||frameUnset){
    const mechanismIds=EPBuilderSlots.toPost(state.builder.slots).mechanismIds;
    /* Группы света от накладки не зависят (считаются по местам управления проекта) — строки
       подстановки в слотах остаются осмысленными и без рамки. */
    const light=lightingFor(projectPostsWithBuilder(undefined));
    const draft=builderPostDraft(undefined);
    const layout=EPPosts.moduleLayout(mechanismIds,{product,mechanismSpan});
    /* Превью без накладки НЕ рисуем: фантомная рамка на 1 модуль противоречила бы списку
       слотов рядом (их пять). Пусто честнее числа, которого нет. */
    $("postPreview").innerHTML="";
    $("builderCapacity").innerHTML="";
    /* remaining=0 → строки «+ свободно N» в слотах не будет: добавлять некуда, пока накладки нет. */
    renderBuilderSlots(layout,0,lightingRowsFor(draft,light));
    /* ТРИ РАЗНЫЕ причины — как их различает смета, так и человеку они говорят разное:
       frameMissing — артикул рамки ЗАДАН, но пропал из каталога (перезалит прайс), это сбой данных;
       пустой пул комнаты — накладок ПОД ЭТУ КОМНАТУ нет вовсе (стандарт/серия/цвет ничего не оставили),
       и совет «выберите накладку в поле» был бы ложью — выбирать не из чего, идти надо в свойства
       комнаты (п.5); frameUnset при непустом пуле — накладку человек просто ещё не выбрал. Все три —
       РОВНО одной строкой (одна причина на экране), тем же путём через composition-хост. Для пустого
       пула перечисляем ВСЁ, чем сузили (frameFacingSelectionLabels — стандарт+серия+отделка), одной
       формулировкой frameFacingEmptyText (§7.1, та же, что у хинта и мастера). */
    const roomFilterLabels=frameUnset&&!poolFrames.length&&allFrames.length?frameFacingSelectionLabels(builderRoomFilter()):null;
    /* Совет звучит РОВНО раз: «…в каталоге накладок нет — измените отбор в свойствах комнаты или
       откройте пост в другой комнате». Первую половину даёт frameFacingEmptyText (общая с хинтом),
       вторую — openElsewhere (только у окна поста); прежний вариант печатал совет дважды. */
    const openElsewhere=" или откройте пост в другой комнате";
    /* «Механизмы поста сохранены» — правда лишь когда в черновике поста реально есть механизмы
       (mechanismIds непуст; у нового пустого поста слотов нет). Одно выражение на обе плашки ниже —
       без второй копии условия; плашку «Накладка поста недоступна» это не касается (там речь о сбое
       данных, а не о пустом наборе). */
    const mechSaved=mechanismIds.length?" Механизмы поста сохранены.":"";
    const frameErrorHtml=frameMissing
      ?`<div class="builder-error" role="alert"><strong>Накладка поста недоступна</strong><span>Артикул рамки этого поста пропал из каталога — вероятно, перезалит прайс. Чтобы не подставить чужую накладку и не потерять механизмы, сохранение заблокировано: выберите накладку в поле «Накладка» вручную.</span></div>`
      :roomFilterLabels!==null
        ?`<div class="builder-error" role="alert"><strong>Под эту комнату накладок нет</strong><span>${esc(roomFilterLabels.length?frameFacingEmptyText(roomFilterLabels.join(", "),openElsewhere):"Под выбранную комнату в каталоге накладок нет — измените отбор в свойствах комнаты"+openElsewhere+".")}${mechSaved}</span></div>`
        :`<div class="builder-error" role="alert"><strong>Накладка поста не выбрана</strong><span>У этого поста нет накладки. Чтобы собрать и сохранить пост, выберите накладку в поле «Накладка» — без неё не определить ни ёмкость рамки, ни совместимые механизмы.${mechSaved}</span></div>`;
    /* frameMissing:true — внутренний флаг «накладка непригодна» (артикула нет ИЛИ не выбрана):
       по нему renderBuilderCatalog не фильтрует каталог и не обещает свободное место. */
    builderCtx={mechs:[],keepMechs:[],addMax:0,maxPostCap:0,remaining:0,frame:null,errorHtml:frameErrorHtml,frameMissing:true};
    renderBuilderCatalog();
    /* Причину печатает composition-хост из builderCtx.errorHtml — тем же путём, что и ошибки
       раскладки в нормальной ветке: refreshBuilderLighting перерисует состав, не потеряв её. */
    renderBuilderComposition(null,builderCtx.errorHtml,light,draft);
    $("savePost").disabled=true;
    $("builderInstallSheet").disabled=true;
    return;
  }
  /* Монтажный документ доступен только когда накладка реально разрешилась в товар.
     Неполный набор механизмов по-прежнему можно распечатать как черновик, но документ
     без самой накладки был бы заведомо ложным. Ранний выход выше ставит disabled=true;
     здесь обязательно снимаем его после осознанного выбора замены. */
  $("builderInstallSheet").disabled=false;
  const selectedFrame=frameProduct(frameSelect.value);
  /* Ёмкость — единой функцией builderCapacity (тот же источник, что у pickBuilderProduct): от
     НАСТОЯЩЕЙ выбранной накладки, а не от значения селектора. Раньше заполнение считалось от count
     (селектор), а фильтр каталога — от накладки: выбор «5 модулей» при 3-модульной накладке давал
     «свободно 2» рядом с «свободно 0 модулей». */
  const capacity=builderCapacity();
  /* mechs — начинка, совместимая с накладкой ПО СЕРИИ (физическая совместимость): идёт в fit/упаковку
     и в keepMechs, её галочка/цвет НЕ сужают — уже стоящий в посте механизм цвет не выкидывает.
     catalogMechs — то же, но ДОПОЛНИТЕЛЬНО суженное под цвет комнаты (ОТДЕЛКА-ПОРЯДОК, п.4) через
     ТОТ ЖЕ productsForRoom, что сужает накладки: сужаем только то, что ПРЕДЛАГАЕМ карточками. */
  const mechs=compatibleMechanisms(selectedFrame,allMechanisms);
  const catalogMechs=EPCatalog.productsForRoom(mechs,builderInnardsFilter());
  const innardsColor=state.builder.restrictInnardsColor?EPRoom.roomFrameFacing(builderFilterRoom(),"frameColor",frameFacingList("frameColor")):null;
  /* ⚠️ МЕХАНИЗМ, УЖЕ СТОЯЩИЙ В ПОСТЕ И СНЯТЫЙ С ПРОИЗВОДСТВА (active:false), УДЕРЖИВАЕМ — то же
     правило владельца, что для накладки (4456bd0): изделие могло быть заложено в проект до снятия
     позиции и физически существует, смета обязана считаться по нему. byKind фильтрует active,
     поэтому снятый механизм не попадает в allMechanisms → compatibleMechanisms его не видит →
     allowedTokens не пускает его токен → fitMechanismIds выбрасывал его молча вместе со
     стоимостью (тот же класс дефекта, что подмена накладки на frames[0]).
     Слоты разрешаем через product() (active НЕ фильтрует, в отличие от byKind), берём снятые
     механизмы поста и пропускаем их через ТОТ ЖЕ фильтр серии compatibleMechanisms, что и
     активные. Так две причины отсева НЕ смешиваются: снятый механизм СВОЕЙ серии удерживается, а
     механизм ЧУЖОЙ серии (человек сменил накладку на другую серию) законно выпадает — это правило
     compatibleMechanisms, его не трогаем. keepMechs идёт ТОЛЬКО в fit/упаковку; каталог (mechs →
     builderCtx.mechs ниже) остаётся из активных, поэтому снятый механизм не предлагается новым. */
  /* Дедуп по id: в посте бывают два одинаковых механизма, а для keepMechs важен НАБОР товаров. */
  const placedDiscontinued=[...new Map(state.builder.slots
    .map(s=>product(s.id)).filter(item=>item&&item.active===false&&item.kind==="mechanism")
    .map(item=>[Number(item.id),item])).values()];
  const keepMechs=placedDiscontinued.length
    ?compatibleMechanisms(selectedFrame,allMechanisms.concat(placedDiscontinued))
    :mechs;
  /* ⚠️ ВТОРОЕ, ОТДЕЛЬНОЕ ОТ keepMechs СОСТОЯНИЕ: АРТИКУЛ МЕХАНИЗМА ПРОПАЛ ИЗ КАТАЛОГА (product не
     разрешается вовсе). Снятый механизм (keepMechs выше) товар имеет и держится своей ценой; у
     пропавшего товара нет — считать нечего, но слот обязан остаться ЯВНЫМ ПРОБЕЛОМ. Иначе он молча
     выпал бы из состава (allowedTokens его токен не пускает, а mechanismSpan(null)=0 — fit роняет
     по `!span`), пост «похудел» бы на механизм, цена упала, а адреса соседних модулей сдвинулись —
     лист монтажника получил бы неверную нумерацию (место «3» встало бы на физически 4-е). Два
     состояния НЕ смешиваем (как у накладки): keepMechs — снятые, missingMechIds — пропавшие. */
  const missingMechIds=[...new Set(state.builder.slots.map(s=>Number(s.id)).filter(id=>!product(id)))];
  /* ⚠️ ФИЛЬТРАЦИЯ И УПАКОВКА ИДУТ НАД ТОКЕНАМИ-ПОЗИЦИЯМИ СЛОТОВ, а не над id механизмов.
     Правила остаются те же самые (EPPosts.fitMechanismIds / distributePosts — второй копии
     раскладки не появляется), но вместе с механизмом переезжает и его группа света: id для
     этого не годится, в посте бывают два одинаковых механизма (см. js/builderSlots.js). */
  const fitDeps=EPBuilderSlots.tokenDeps(state.builder.slots,{product,mechanismSpan});
  const fitOrder=EPPosts.fitMechanismIds(EPBuilderSlots.tokens(state.builder.slots),
    EPBuilderSlots.allowedTokens(state.builder.slots,keepMechs,missingMechIds),capacity,fitDeps);
  state.builder.slots=EPBuilderSlots.pick(state.builder.slots,fitOrder);
  retargetBuilderSlot(fitOrder);
  /* Занятость считаем по EPPosts.moduleLayout, а не mechanismModulesTotal: у пропавшего артикула
     span тут оценивается в 1 модуль (пробел физически занимает место), а не 0 — иначе метка
     «Занято N» и строка «+ свободно» предложили бы поставить механизм в модуль, занятый пробелом,
     и переполнили бы пост. Реордер ниже только переставляет слоты, сумма модулей от него не
     зависит, поэтому считать здесь безопасно. */
  const occupied=EPPosts.moduleLayout(EPBuilderSlots.toPost(state.builder.slots).mechanismIds,{product,mechanismSpan}).reduce((sum,m)=>sum+m.span,0);
  const remaining=Math.max(0,capacity-occupied);
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
  const maxPostCap=dist.maxCapacity||capacity;
  const addMax=EPPosts.maxFreeSpan(dist);
  /* Расчёт групп света — по всему проекту ВМЕСТЕ с черновиком поста (см. projectPostsWithBuilder).
     Считаем ДО превью: собранное изображение показывает цельное изделие ЗАМЕНОЙ (09001→09005), а
     замена берётся из этого же расчёта (assembledPostSpec ← lightRows черновика). Иначе превью
     печатало бы исходный артикул, пока смета рядом уже показывает подмену. */
  const light=lightingFor(projectPostsWithBuilder(selectedFrame));
  const draft=builderPostDraft(selectedFrame);
  /* Единое изображение собранного поста (крупно) — та же EPPostImage, что в библиотеке,
     подсказке, КП и листе монтажника; черновик и его расчёт передаём явно, чтобы подмена в
     конструкторе была честной ещё до сохранения поста. */
  $("postPreview").innerHTML=assembledPostHtml(draft,{size:"lg"},light);
  $("builderCapacity").innerHTML=`<div class="builder-capacity-head"><strong>Заполнение рамки</strong><span>Занято ${occupied} из ${capacity} · ${remaining?`свободно ${moduleWord(remaining)}`:"рамка заполнена"}</span></div>
    <div class="module-meter" style="--module-count:${capacity}" aria-label="Занято ${occupied} из ${capacity} модулей">${Array.from({length:capacity},(_,index)=>`<span class="${index<occupied?"occupied":""}"></span>`).join("")}</div>`;
  /* Нумерация модулей слота (одномодульный «2», двухмодульный «2–3») — общая чистая
     функция EPPosts.moduleLayout: тот же код считает позиции для листа монтажника,
     чтобы номера в конструкторе и в документе не разошлись. */
  const layout=EPPosts.moduleLayout(mechanismIds,{product,mechanismSpan});
  renderBuilderSlots(layout,remaining,lightingRowsFor(draft,light));
  /* errorHtml лежит в контексте, чтобы точечное обновление групп света (refreshBuilderLighting)
     могло перерисовать состав, не потеряв причину несовместимости: набор механизмов оно не
     меняет, значит и ошибка раскладки та же самая. Состояние «накладки нет» сюда не доходит —
     оно обработано выше отдельной веткой (frameMissing), где считать от накладки нечего. */
  /* Накладка снята с производства — приглушённый баннер (не ошибка: сохранять разрешено).
     Кладём в тот же errorHtml-слот composition-хоста, что и несовместимость раскладки, поэтому
     refreshBuilderLighting сохранит его при точечной перерисовке групп света; если вдобавок есть
     ошибка раскладки, обе строки показываются вместе. Класс .builder-notice отличает пометку от
     красной .builder-error. */
  const frameNoticeHtml=frameDiscontinued
    ?`<div class="builder-notice" role="status"><strong>Накладка снята с производства</strong><span>Артикул ${esc(selectedFrame.code||"")} больше не выпускается и новым постам не предлагается. В этом посте накладка оставлена: изделие могло быть заложено в проект до снятия и физически существует — смета считается по ней. При желании выберите замену в поле «Накладка».</span></div>`
    :"";
  /* ⚠️ МЕХАНИЗМ СНЯТ С ПРОИЗВОДСТВА — та же приглушённая пометка, что у накладки (решение владельца
     02.09), но своим текстом: причина другая, чем «артикул пропал из каталога» (там product не
     разрешается вовсе и считать нечего). Здесь механизм разрешён в товар, удержан в посте и
     посчитан по своей цене — сообщаем, а не блокируем; сохранение остаётся по dist.valid/full.
     Перечисляем сами артикулы: снятых механизмов в посте может быть несколько. */
  const mechNoticeHtml=placedDiscontinued.length
    ?`<div class="builder-notice" role="status"><strong>Механизм снят с производства</strong><span>${esc(placedDiscontinued.map(m=>m.code||"без артикула").join(", "))} — больше не выпускается и новым постам не предлагается. В этом посте механизм оставлен: изделие могло быть заложено в проект до снятия и физически существует — смета считается по нему. При желании замените его карточкой в каталоге.</span></div>`
    :"";
  /* ⚠️ АРТИКУЛ МЕХАНИЗМА ПРОПАЛ ИЗ КАТАЛОГА — своя пометка, ОТЛИЧНАЯ от «снят с производства»
     (там товар есть и посчитан по цене). Здесь товара нет вовсе: слот удержан явным пробелом,
     чтобы не сдвинуть адреса модулей, но цену по нему взять неоткуда. Формулировку берём из
     единого состояния EPPosts.mechanismAvailability — той же, что называет позицию в смете, своде,
     КП и листе монтажника. Красная .builder-error, а не приглушённая .builder-notice: владелец
     выбрал ОБА варианта — позицию НАЗЫВАЕМ И блокируем сохранение/лист монтажника, пока пробел не
     заменён (та же форма, что у недоступной накладки frameMissing выше: по пробелу считать нечего,
     монтажный документ был бы с дырой). Снятый механизм (mechNoticeHtml) под блокировку НЕ
     подпадает — там товар и цена есть, это осознанное решение владельца от 02.09. */
  const missingMechErrorHtml=missingMechIds.length
    ?`<div class="builder-error" role="alert"><strong>Артикул механизма пропал из каталога</strong><span>${esc(missingMechIds.map(id=>EPPosts.mechanismAvailability(id,null).displayName).join(", "))} — этих артикулов больше нет в прайсе (вероятно, перезалит). Позиция оставлена явным пробелом и названа во всех документах, чтобы номера модулей не сдвинулись; цена по ней неизвестна. Пока пробел в посте, сохранение и лист монтажника заблокированы: замените позицию карточкой в каталоге или уточните артикул у поставщика.</span></div>`
    :"";
  /* mechs каталога = catalogMechs (суженное под цвет комнаты); seriesCount — сколько было ДО цвета,
     чтобы renderBuilderCatalog отличил «начинка обнулилась цветом» от «каталог не загружен».
     innardsColor — цвет накладки комнаты, которым сузили (для объяснения словами). */
  builderCtx={mechs:catalogMechs,seriesCount:mechs.length,innardsColor,keepMechs,missingMechIds,addMax,maxPostCap,remaining,frame:selectedFrame,errorHtml:frameNoticeHtml+mechNoticeHtml+missingMechErrorHtml+builderErrorHtml(dist)};
  renderBuilderCatalog();
  renderBuilderComposition(selectedFrame,builderCtx.errorHtml,light,draft);
  /* Сохранять можно, только когда сборка физически собирается (никакой механизм не шире поста
     и не «размазан» через импост) и все посты заполнены целиком. Недоступную накладку сюда не
     пускает ранний выход выше.
     ⚠️ ПРОПАВШИЙ АРТИКУЛ МЕХАНИЗМА блокирует так же, как недоступная накладка (frameMissing):
     по пробелу цену взять неоткуда, а монтажный документ был бы с дырой. Владелец выбрал ОБА
     варианта — позицию называем (баннер выше) И не даём сохранить/распечатать, пока пробел не
     заменён. Снятый с производства сюда НЕ входит: missingMechIds — только пропавшие артикулы
     (product не разрешается), keepMechs — снятые (товар и цена есть). */
  const mechMissing=missingMechIds.length>0;
  $("savePost").disabled=mechMissing||!(dist.valid&&dist.full);
  /* Лист монтажника выше уже включён (disabled=false) для разрешившейся накладки — при пропавшем
     механизме гасим обратно тем же образом, что и ветка frameMissing глушит его при недоступной
     накладке. */
  if(mechMissing)$("builderInstallSheet").disabled=true;
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
    const groupField=!isControlPlaceItem(item)?""
      : state.builder.editingPlacedId
        /* maxlength — не украшение: имя группы печатается ЦЕЛИКОМ в блоке «Группы света» КП,
           листа монтажника и панели проекта, и без ограничения одно поле выдавливало соседнюю
           колонку документа. 40 знаков с запасом хватает и «Кухне», и «4.1», и «Спальня,
           бра у кровати» — а длиннее это уже не имя группы, а примечание.
           ⚠️ РЯДОМ — НОМЕР ПРОХОДНОЙ И ВЫБОР МЕХАНИЗМА (владелец 13.09). Имя — для документов, номер —
           для связи: одинаковый номер у клавиш РАЗНЫХ постов = одна проходная. Поле «Механизм» —
           ВАРИАНТ C: по умолчанию «как посчитано», но выбор руками главнее расчёта. Оба поля тоже
           только у поста на плане (у шаблона своей проходной/механизма быть не может). Номер строго
           текстовый, как имя: <input type="number"> склеил бы «4.10» и «4.1». */
        ? `<div class="slot-keyfields"><label class="slot-group">Группа света<input type="text" data-slot-group="${index}" value="${esc(state.builder.slots[index]?.group||"")}" maxlength="${GROUP_NAME_MAX}" placeholder="например «Кухня» или «4.1»" autocomplete="off"></label>`
          +`<label class="slot-cross">№&nbsp;проходной<input type="text" data-slot-cross="${index}" value="${esc(state.builder.slots[index]?.cross||"")}" maxlength="${GROUP_NAME_MAX}" placeholder="напр. 5" autocomplete="off"></label>`
          +`<label class="slot-mech">Механизм<select data-slot-mech="${index}">${mechOverrideOptions(state.builder.slots[index]?.mech||"")}</select></label></div>`
        : `<div class="slot-group-note">Группа света и проходная задаются у поста на плане: разместите пост и укажите их там. У шаблона их нет намеренно — один шаблон в трёх комнатах это три разные группы, а не одна на три места.</div>`;
    return `<div class="builder-slot${isTarget?" is-target":""}">
      <div class="slot-number" title="${esc(moduleWord(slot.span))}">${esc(slot.label)}</div>
      <div class="slot-body">${productPicture(item,{label:item?item.name:"Элемент"})}
        <span class="slot-text"><span class="slot-code">${esc(item?.code||"без артикула")}</span>
          <span class="slot-name" title="${esc(item?.name||"")}">${esc(item?.name||`Механизм не найден (арт. ${slot.id})`)}</span>${item&&item.active===false?'<span class="slot-off">снят с производства</span>':""}${!item?'<span class="slot-gap">нет в каталоге</span>':""}
          <span class="slot-meta">${esc(moduleWord(slot.span))} · ${item?productMoney(item):"цена неизвестна"}</span></span>
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
  /* Номер проходной — тем же приёмом, что имя группы: на ввод запоминаем (без перерисовки, иначе
     уводится фокус), на change точечно пересчитываем связь и подставленный механизм. Смена номера
     меняет N проходной у ДРУГИХ постов, но refreshBuilderLighting считает полный расчёт по проекту. */
  host.querySelectorAll("[data-slot-cross]").forEach(input=>{
    const index=Number(input.dataset.slotCross);
    input.oninput=()=>{state.builder.slots=EPBuilderSlots.setCross(state.builder.slots,index,input.value)};
    input.onchange=()=>{state.builder.slots=EPBuilderSlots.setCross(state.builder.slots,index,input.value);refreshBuilderLighting()};
    input.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();input.blur()}};
  });
  /* Ручной выбор механизма (ВАРИАНТ C): select меняет значение сразу — пересчитываем связь и цену. */
  host.querySelectorAll("[data-slot-mech]").forEach(sel=>{
    const index=Number(sel.dataset.slotMech);
    sel.onchange=()=>{state.builder.slots=EPBuilderSlots.setMech(state.builder.slots,index,sel.value);refreshBuilderLighting()};
  });
}
/* Опции селектора ВАРИАНТА C. Значения — те же строки-роли, что принимает EPLightingGroups.roleOverrideOf
   ("" = «как посчитано»), подписи — из ROLE_LABELS расчёта (второй копии терминологии заказчика нет:
   «Инвертор», а не «перекрёстный переключатель»). «Проходной» в словах владельца = переключатель. */
function mechOverrideOptions(current){
  const L=EPLightingGroups.ROLE_LABELS,R=EPLightingGroups.ROLES;
  const choices=[["","Как посчитано"],[R.SWITCH,L[R.SWITCH]],[R.CHANGEOVER,L[R.CHANGEOVER]],[R.INVERTER,L[R.INVERTER]]];
  const cur=String(current||"").trim().toLowerCase();
  return choices.map(([v,label])=>`<option value="${esc(v)}"${v===cur?" selected":""}>${esc(label)}</option>`).join("");
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
  /* Цельное изделие: расчёт МЕНЯЕТ сам артикул поста (09001→09005), отдельной цены нет — она уже в
     механизме. Показываем «в смету пойдёт …» без цены, чтобы читатель не принял замену за вторую
     позицию. Клавиша: голый механизм ЗА ней — отдельная позиция со своей ценой (как было). */
  if(row.kind==="integrated")
    return `<div class="slot-light">в смету: ${esc(row.roleLabel)} · ${esc(row.code)} · ${esc(row.name)}${esc(place)}</div>`;
  return `<div class="slot-light">${esc(row.roleLabel)} · ${esc(row.code)} · ${esc(row.name)} · ${money(row.price)}${esc(place)}</div>`;
}

/* Каталог механизмов крупными карточками, разделами по «Функциональной группе» номенклатуры.
   Перерисовывается ОТДЕЛЬНО от остального конструктора: поиск и раскрытие раздела не должны
   пересчитывать раскладку по постам (и не должны ронять фокус из поля поиска — оно снаружи). */
function renderBuilderCatalog(){
  const host=$("builderCatalog");if(!host)return;
  /* Накладки нет — фильтровать каталог не по чему. Раньше сюда доходил фантомный контекст:
     шапка обещала «Свободно N модулей», а список падал в «Каталог механизмов не загружен»
     (mechs пусты) — обещание при нуле карточек и ложная причина одновременно. Причина одна и
     та же — недоступная накладка — и она уже названа баннером в composition-хосте; здесь лишь
     тихо разъясняем, почему добавлять нечего, без вымышленных чисел. */
  if(builderCtx.frameMissing){
    $("builderTarget").innerHTML=`Накладка не выбрана<small>Выберите накладку в поле «Накладка» — без неё каталог механизмов не отфильтровать.</small>`;
    host.innerHTML='<div class="catalog-empty">Пока накладка поста не выбрана, добавлять механизмы некуда — выберите накладку.</div>';
    return;
  }
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
    /* Различаем ДВЕ причины пустого каталога: цвет комнаты обнулил начинку (серийный набор был
       непуст, но того же цвета механизмов нет — ОТДЕЛКА-ПОРЯДОК п.5, объясняем словами и даём выход
       галочкой) либо прайс действительно не подключён (серийный набор тоже пуст). */
    host.innerHTML=builderCtx.innardsColor&&builderCtx.seriesCount>0
      ?`<div class="catalog-empty">${esc(innardsEmptyText(builderCtx.innardsColor))}</div>`
      :'<div class="catalog-empty">Каталог механизмов не загружен — проверьте, что прайс подключён.</div>';
    return;
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
  /* Человек НАПОЛНИЛ рамку (добавил/заменил механизм) — пост больше не «нетронут»: снимаем frameAuto,
     чтобы последующая смена комнаты/числа модулей не пере-подбирала накладку под другую серию и не
     выкидывала уже добавленные механизмы (§7.1, «первое действие человека снимает флаг»). */
  state.builder.frameAuto=false;
  /* Ёмкость — ТОЙ ЖЕ функцией builderCapacity, что и в renderBuilder: от настоящей накладки, а
     не от значения селектора. Раньше здесь был второй источник (count = селектор), и при накладке
     шире селектора (09668.01/8М, селектор «5») выбор карточки фитил состав до 5 — три механизма
     уничтожались одним кликом. Второго источника ёмкости в окне быть не должно (§7.1). */
  const target=state.builder.target,capacity=builderCapacity();
  if(target.mode==="replace"&&state.builder.slots[target.index]){
    const index=Number(target.index);
    state.builder.slots=EPBuilderSlots.replaceAt(state.builder.slots,index,id,keySlotKind);
    /* Та же защита от переполнения, что стояла на смене значения слота: лишние выкидываются
       с конца, только что выбранный остаётся (EPPosts.fitMechanismIdsPreserving). */
    const deps=EPBuilderSlots.tokenDeps(state.builder.slots,{product,mechanismSpan});
    /* keepMechs — снятые механизмы, missingMechIds — пропавшие артикулы: и те и другие держим
       пробелом, иначе замена ОДНОГО слота молча уронила бы соседний удержанный (тот же дефект,
       что в renderBuilder). missingMechIds пересчитываем от актуальных слотов, а не берём из
       builderCtx: replaceAt мог только что заменить пропавший артикул реальным товаром. */
    const keepMissing=[...new Set(state.builder.slots.map(s=>Number(s.id)).filter(id=>!product(id)))];
    state.builder.slots=EPBuilderSlots.pick(state.builder.slots,
      EPPosts.fitMechanismIdsPreserving(EPBuilderSlots.tokens(state.builder.slots),
        EPBuilderSlots.allowedTokens(state.builder.slots,builderCtx.keepMechs,keepMissing),capacity,index,deps));
  }else{
    state.builder.slots=EPBuilderSlots.add(state.builder.slots,id);
  }
  state.builder.target={mode:"add"};
  renderBuilder();
}

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
  /* Подсветка поста синхронизируется рядом с типом стены (тот же класс «настройка поста»):
     draft.backlight уже участвует в comp/цене через builderPostDraft, здесь — только UI органа. */
  renderPostBacklight();
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
  /* Подсветка клавиш — ОТДЕЛЬНАЯ строка состава СРАЗУ ЗА группами света: LED читается рядом с
     механизмом, в который вставлен, и входит в ту же «Стоимость поста» ниже. Формулировку (счёт,
     цену за штуку, слова пробела) собирает та же backlightRowSummary, что и карточка с подсказкой —
     второй копии правила нет. Пробел помечаем is-missing, как суппорт/коробку/группы света. */
  const backSummary=backlightRowSummary(comp.backlight);
  const backRow=backSummary
    ? `<div class="composition-row${backSummary.gaps?" is-missing":""}"><span>Подсветка клавиш</span><b>${esc(backSummary.text)}</b></div>`
    : "";
  /* Тот же блок «Группы света», что печатается в КП и листе монтажника: подставленные
     механизмы, реле и пробелы с причинами. Один источник — расхождению между конструктором
     и документами взяться неоткуда. */
  const lightBlock=light?lightingHtml(light,"Группы света в проекте"):"";
  host.innerHTML=`${errorHtml||""}<div class="composition-head"><strong>Состав поста</strong><span>Стандарт: ${esc(STANDARD_LABEL[comp.standard]||comp.standard)}</span></div>
    ${supportRow}${boxRow}${lightRow}${backRow}
    <div class="composition-row total"><span>Стоимость поста</span><b>${money(postTotalCost(post,light))}</b></div>${note}${lightBlock}`;
}
function changePostSlotCount(){
  const count=Number($("postSlotCount").value);
  syncAutoPostName(count);   /* автоимя следует за числом модулей (isAutoPostName — одна точка, §7.1) */
  /* НОВЫЙ пост с автоматической накладкой: под новое число модулей берём накладку ТОЙ ЖЕ серии, цвета и
     стандарта, что текущая (applyAutoDefaultFrame с образцом — та же одна точка правила, §7.1), а не
     оставляем модульность открытия приклеенной сверху списка через requestedFrame. 3→4 у белой
     итальянской Neve Up даёт 09674.01 (IT), а не 09664.01 (DE). Ручной выбор человека (frameAuto=false)
     и пост на плане/шаблон не трогаются — applyAutoDefaultFrame на них no-op. */
  applyAutoDefaultFrame(count,frameProduct($("postFrameSelect").value));
  renderBuilder();
}
/* Смена «Комнаты поста» в конструкторе (ОТДЕЛКА-ПОРЯДОК, п.3) — вынесено ФУНКЦИЕЙ, чтобы связку можно
   было проверить поведенчески (§7.2 «связки дают почти все дефекты»). Под новую комнату меняются пул
   накладок, цветовой отбор начинки и селектор модульностей (тот же collectionFramePool). У нетронутого
   поста накладку по умолчанию берём РОВНО как при открытии — БЕЗ образца и БЕЗ текущего числа модулей
   (applyAutoDefaultFrame(null,null), ближайшая к 3): смена комнаты даёт то же, что открытие сразу в этой
   комнате (п.2). Ручной выбор/шаблон/пост на плане — applyAutoDefaultFrame no-op. Ёмкость и автоимя —
   у новой накладки; пул пуст → прежняя ёмкость, имя не трогаем. */
function changeBuilderRoom(roomId){
  state.builder.roomId=roomId;
  const auto=applyAutoDefaultFrame(null,null);
  const capacity=auto?frameSlotCount(auto):builderCapacity();
  renderPostSlotCountSelect(capacity);
  $("postSlotCount").value=String(capacity);
  if(auto)syncAutoPostName(frameSlotCount(auto));   /* автоимя следует за модульностью накладки новой комнаты (п.1) */
  renderBuilder();
}
async function savePostBuilder(){
  /* Проверяем сборку ПО ПОСТАМ: механизм не должен быть шире поста или «размазан» через
     импост (dist.valid), и все посты должны быть заполнены целиком (dist.full). Для
     итальянской однорядной накладки это ровно прежнее «заполните все модули». */
  const fields=EPBuilderSlots.toPost(state.builder.slots);
  const dist=EPPosts.distributePosts(fields.mechanismIds,frameProduct($("postFrameSelect").value),{product,mechanismSpan});
  if(!dist.valid){toast("Несовместимое сочетание — см. причину над составом поста");return}
  if(!dist.full){toast("Заполните все модули рамки");return}
  /* Поля поста перечислены ПОИМЁННО (белый список). keyGroups/keyCrossNumbers/keyMechanisms обязаны
     быть здесь: забыть любой — значит молча потерять при сохранении группы света, связь проходной по
     номеру или ручной выбор механизма, без единой ошибки в консоли. Все три всегда той же длины, что
     mechanismIds (EPBuilderSlots.toPost), и соответствие идёт по индексу — это и есть keyIndex
     контракта модуля групп света. */
  const base={name:$("postName").value.trim()||"Пост",frameId:Number($("postFrameSelect").value),
    mechanismIds:[...fields.mechanismIds],keyGroups:[...fields.keyGroups],
    keyCrossNumbers:[...fields.keyCrossNumbers],keyMechanisms:[...fields.keyMechanisms],socketBoxProductId:socketBox()?.id,
    /* Галочка «ограничить начинку цветом накладки» — свойство поста (решение владельца: именно у
       поста). В белом списке base, поэтому переживает сохранение и у поста на плане
       (Object.assign(post,base)), и у шаблона (template={...base}). Старый пост без поля читается
       как «ограничение выключено» (новый дефолт) — см. openPostBuilder. */
    restrictInnardsColor:!!state.builder.restrictInnardsColor};
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
    /* ⚠️ ПОДСВЕТКА ПОСТА — из ЧЕРНОВИКА окна, ПОИМЁННО, как keyGroups: base её не несёт, а
       Object.assign(post,base) чужих полей не трогает — без этой записи черновик молча не
       доезжал бы до поста (тот самый капкан белого списка). Объект → своё переопределение
       (нормализуем, чтобы форма поля совпала с EPPosts.postBacklight). null (режим «как в
       проекте») → поле УДАЛЯЕМ: оставить старый объект значило бы, что «как в проекте» ничего
       не сбросил и пост по-прежнему переопределяет проект. Нет поля → пост следует проекту. */
    const bl=state.builder.backlight;
    if(bl&&typeof bl==="object")post.backlight={enabled:!!bl.enabled,color:bl.color||null,voltage:bl.voltage||null};
    else delete post.backlight;
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
    /* ⚠️ ЦВЕТ НАКЛАДКИ, ПОД КОТОРЫЙ СОБРАН ШАБЛОН (ОТДЕЛКА-ПОРЯДОК, п.5). Запоминаем ЯВНО, а не
       выводим потом каждый раз из frameId: после перезаливки прайса артикул может перестать
       разрешаться, а «под какой цвет собирали» должно пережить это и перезагрузку проекта. Пишем
       из товара по выбранной накладке; накладки без цвета в каталоге нет, но если её вдруг нет —
       поле не выдумываем (templateFrameColor тогда попробует вывести цвет из frameId). */
    const templateFrameColor=frameProduct(template.frameId)?.frameColor;
    if(templateFrameColor)template.frameColor=templateFrameColor;
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
    snapshot:null,escArmed:null,wallType:null,backlight:null,roomId:null,restrictInnardsColor:false};
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
/* Лист монтажника для поста в конструкторе: если правим размещённый пост — берём его
   номер/помещение, иначе пост ещё без номера («—»). */
function installSheetForBuilder(){
  const selectedFrameId=$("postFrameSelect").value;
  const selectedFrameInfo=EPPosts.frameAvailability(selectedFrameId,frameProduct(selectedFrameId));
  if(selectedFrameInfo.blocksDocuments){
    toast(`Лист монтажника недоступен: накладка ${selectedFrameInfo.statusText}. Выберите накладку.`);
    return;
  }
  const placed=state.builder.editingPlacedId?state.posts.find(x=>x.id===state.builder.editingPlacedId):null;
  const fields=EPBuilderSlots.toPost(state.builder.slots);
  const post={id:placed?placed.id:"builder-draft",number:placed?placed.number:"—",
    frameId:Number(selectedFrameId),
    mechanismIds:[...fields.mechanismIds],keyGroups:[...fields.keyGroups],
    keyCrossNumbers:[...fields.keyCrossNumbers],keyMechanisms:[...fields.keyMechanisms],
    roomId:placed?placed.roomId:null,height:placed?.height,purpose:placed?.purpose,
    /* Тип стены — из черновика окна: лист монтажника обязан назвать ту коробку, что видна
       в составе поста рядом, а не ту, что записана в проекте (правка ещё не сохранена). */
    wallType:builderWallType()};
  if(!post.mechanismIds.length){toast("Добавьте механизмы в пост");return}
  /* Группы света считаем по ПРОЕКТУ вместе с этим постом: роль механизма зависит от числа
     мест группы во всём проекте, и лист монтажника обязан показать ту же роль, что видно в
     конструкторе и в смете. */
  const light=lightingFor(projectPostsWithBuilder(selectedFrameInfo.frame));
  openInstallSheet({posts:[buildPostSheet(post,light)],subtitle:"Помодульная раскладка поста",
    lightingHtml:lightingHtml(light,"Группы света в проекте")});
}
$("newPostBtn").onclick=()=>openPostBuilder();
$("closePostModal").onclick=$("cancelPost").onclick=closePostBuilder;
$("savePost").onclick=savePostBuilder;$("postSlotCount").onchange=changePostSlotCount;
/* Человек выбрал накладку руками (через EPPicker — он ставит value и шлёт change) → накладка больше НЕ
   автоматическая: смена комнаты/числа модулей её не перетрёт (applyAutoDefaultFrame, §7.1, требование
   «ручной выбор, годный для комнаты, не перетирать»). */
$("postFrameSelect").onchange=()=>{state.builder.frameAuto=false;renderBuilder()};
/* Смена «Комнаты поста» — вся логика в changeBuilderRoom (вынесена, чтобы связку проверял тест). */
$("builderRoomSelect").onchange=e=>changeBuilderRoom(e.target.value||null);
/* Галочка «ограничить цветом накладки» (решение владельца 16.09): меняет только цветовой отбор
   начинки — накладка и раскладка те же, достаточно перерисовать конструктор (renderBuilder
   пересчитает catalogMechs). */
$("builderRestrictColor").onchange=e=>{state.builder.restrictInnardsColor=e.target.checked;renderBuilder()};
/* Поиск по каталогу конструктора перерисовывает ТОЛЬКО карточки: поле ввода лежит снаружи
   #builderCatalog, поэтому фокус и каретка на месте, а раскладка по постам не пересчитывается. */
$("builderSearch").oninput=e=>{state.builder.query=e.target.value;renderBuilderCatalog()};
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
/* Подсветка ПОСТА — ЧЕРНОВИК окна, ровно как тип стены: кнопки правят только
   state.builder.backlight, применяет — сохранение (savePostBuilder). Проект отсюда не трогаем.
   Три режима: «как в проекте» (null — переопределения нет), «выключить у поста» (объект
   enabled:false) и «своя подсветка» (объект enabled:true). Для «своей» цвет/напряжение сеем из
   уже выбранного черновика → проектной настройки → первого варианта КАТАЛОГА
   (backlightCatalogOptions), чтобы переопределение сразу было осмысленным, а не пустым. */
document.querySelectorAll("#postBacklightMode .wall-type-option").forEach(b=>b.onclick=()=>{
  const mode=b.dataset.backlight;
  if(mode==="project")state.builder.backlight=null;
  else if(mode==="off")state.builder.backlight={enabled:false,color:null,voltage:null};
  else{
    const cur=state.builder.backlight,proj=EP_DATA.settings.backlight||{},{colors,volts}=backlightCatalogOptions();
    state.builder.backlight={enabled:true,
      color:(cur&&cur.color)||proj.color||colors[0]||null,
      voltage:(cur&&cur.voltage)||proj.voltage||volts[0]||null};
  }
  renderBuilder();
});
/* Цвет/напряжение переопределения — пишем в черновик только когда действует режим «своя
   подсветка»; renderBuilder пересчитывает состав и «Стоимость поста» с новым LED. */
$("postBacklightColor").onchange=e=>{
  if(state.builder.backlight&&state.builder.backlight.enabled)state.builder.backlight.color=e.target.value||null;
  renderBuilder();
};
$("postBacklightVoltage").onchange=e=>{
  if(state.builder.backlight&&state.builder.backlight.enabled)state.builder.backlight.voltage=e.target.value||null;
  renderBuilder();
};
/* Клик мимо окна — такое же СЛУЧАЙНОЕ закрытие, как Esc: с несохранёнными правками просит
   повтора (см. requestClosePostBuilder), а не выбрасывает собранный пост молча. */
$("postModal").onclick=e=>{if(e.target===$("postModal"))requestClosePostBuilder()};
$("builderInstallSheet").onclick=installSheetForBuilder;

/* builderRoomFilter возвращаем не для прямого вызова из app.js, а потому что общий frameFacingHintText
   остался в app.js (его зовёт и «Подобрать накладку», см. раздел про общий код выше) и обращается к
   builderRoomFilter — переехавшему сюда. Без возврата у app.js его нет: ReferenceError на открытии поста. */
return {openPostBuilder,renderPostSlotCountSelect,requestClosePostBuilder,builderRoomFilter};
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports для автотестов. */
const api = { attach };
if (typeof window !== "undefined") window.EPPostBuilder = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
