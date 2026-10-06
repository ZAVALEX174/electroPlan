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
  /* «поколение подложки»: счётчик меняется при КАЖДОЙ смене фона — загрузке нового
     чертежа (applyImportedPlan) и сбросе (clearPlan). Долгая операция запоминает его
     до первого await и сверяется после — так гонка «убрал/сменил план во время
     распознавания» не портит комнаты/стены и не включает кнопки мимо updatePlanUi. */
  planToken:0,
  /* линии разметки помещений — отдельный слой (решение владельца): не смешиваются
     ни с ручными стенами (walls), ни с автообрисовкой (autoWalls). roomLinePoints —
     точки текущей рисуемой цепочки, roomLineIds — id её сегментов (для Backspace),
     roomLineHover — подсвеченная точка притяжения курсора. */
  roomLines:[],roomLinePoints:[],roomLineIds:[],roomLineHover:null,
  /* Память полей исчезнувших авто-комнат (В15): удалили стену — комната исчезла вместе с введёнными
     полями, перерисовали — вернулась с ними же. Правило жизни памяти — в EPRoomCarry.reconcile, а
     хранится она здесь (и в снимке проекта: переживает автосейв/перезагрузку между удалением и
     перерисовкой). [{polygon, fields}]. Сбрасывается при «Очистить всё» и «Очистить разметку». */
  roomFieldMemory:[],
  /* режимы разметки (решение владельца): переключатели в панели инструментов.
     orthoMode — рисовать строго ортогонально (Shift временно инвертирует режим);
     snapGrid  — привязывать точки к узлам сетки (магниты к линиям работают всегда);
     gridStep  — шаг сетки, px: влияет и на привязку, и на фоновую сетку холста. */
  orthoMode:true,snapGrid:true,gridStep:EPConfig.gridDefault,
  planVisibility:"show",   /* видимость подложки: show | dim | hide (Этап 1) */
  planRotation:0,          /* угол поворота подложки, градусы [0,360) (Б3, ч.1): вращается только фон */
  /* ВИД-подход к повороту всего плана (Б3, ч.2а): мировые координаты стен/комнат/постов/разметки
     НЕ меняются никогда — вращается только ВИД холста. worldAngle — скаляр угла мира, градусы
     [0,360); applyView домножает CSS-трансформацию #canvas на rotate(worldAngle). rotateTarget —
     что вращают органы поворота: "image" (только чертёж-фон, поведение части 1) | "world" (весь
     план). Старый проект без полей → worldAngle 0, rotateTarget "image" (обратная совместимость). */
  worldAngle:0,rotateTarget:"image",
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
    /* roomId — КОМНАТА, ПОД КОТОРУЮ собираем пост (ОТДЕЛКА-ПОРЯДОК, п.3): её задают ДО сборки, и по
       ней сужаются и накладки, и начинка. Для нового поста — выбор в селекторе «Комната»; для поста
       на плане — комната поста. restrictInnardsColor — галочка поста (решение владельца 16.09):
       ВКЛЮЧАЕТ ограничение начинки цветом накладки. По умолчанию ВЫКЛЮЧЕНА — начинка любого цвета
       (у 169 из 181 цвета накладок начинки того же цвета не существует, поэтому дефолт — без
       ограничения). Накладку галочка не трогает; это свойство поста, переживает сохранение. */
    snapshot:null,escArmed:null,wallType:null,backlight:null,roomId:null,restrictInnardsColor:false}
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
const {moduleWord,mechanismSpan,productSeries,compatibleMechanisms,frameSlotCount,frameSlotOptions,defaultPostName,productImage,frameOpening,frameOpenings,moduleFace}=EPCatalog;
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
  /* Неактивную (снятую с производства) накладку помечаем прямо в подписи опции: в списке она
     оказывается только как УЖЕ стоящая в посте (byKind её отфильтровал), и человек должен видеть,
     что предлагать её новым постам нельзя. Состояние и формулировка — из того же
     EPPosts.frameAvailability, что кормит документы. */
  return [...groups].map(([label,products])=>`<optgroup label="${esc(label)}">${products.map(item=>{
    const availability=EPPosts.frameAvailability(item.id,item);
    return `<option value="${item.id}" ${Number(item.id)===Number(selectedId)?"selected":""}>${esc(productOptionLabel(item))}${availability.discontinued?` — ${esc(availability.statusText)}`:""}</option>`;
  }).join("")}</optgroup>`).join("");
}
/* Логика сборки поста (стоимость, упаковка механизмов в рамку) вынесена в
   js/posts.js (EPPosts) — PLAN 2.1; здесь тонкие обёртки с доступом к каталогу,
   как buildEstimate() над EPEstimate. */
const fitMechanismIds=(ids,items,capacity)=>EPPosts.fitMechanismIds(ids,items,capacity,{product,mechanismSpan});
const fitMechanismIdsPreserving=(ids,items,capacity,pinnedIndex)=>EPPosts.fitMechanismIdsPreserving(ids,items,capacity,pinnedIndex,{product,mechanismSpan});
/* Единственная формулировка «фото нет» — одна на карточку каталога и на плитку мастера подбора
   отделки (§7.1). Держим её ЗДЕСЬ, а не копией в каждой разметке: раньше карточка писала «Нет
   фото», а мастер — «без фото», и владелец видел две разные фразы про одно и то же. */
const NO_PHOTO_LABEL="Нет фото";
function productPicture(item,{className="",detail=false,label="",eager=false,style=""}={}){
  const imageUrl=productImage(item,{detail});
  /* Нет фото → рисуем значок товара (item.icon) и подпись NO_PHOTO_LABEL, чтобы отсутствие снимка
     читалось как «фото просто нет», а не «картинка сломалась» (владелец принял голубой квадрат
     с крохотным значком за баг). Подпись даём ТОЛЬКО когда фото реально нет: иначе она осталась
     бы в разметке товаров с фото (пусть и скрытая CSS) — а тест «у товара с фото надписи нет»
     и есть страховка от этого. В тесных местах (слоты сборки, список накладок) подпись прячется
     через CSS, значок остаётся, а title даёт ту же подсказку по наведению. */
  const noPhoto=!imageUrl;
  return `<span class="product-picture ${className}${imageUrl?" has-image":""}"${noPhoto?` title="${NO_PHOTO_LABEL}"`:""}${style?` style="${esc(style)}"`:""}>
    ${imageUrl?`<img src="${esc(imageUrl)}" alt="${esc(label||item?.name||"Изображение товара")}" loading="${eager?"eager":"lazy"}" decoding="async" data-product-picture>`:""}
    <span class="product-picture-fallback" aria-hidden="true"><span class="product-picture-glyph">${esc(item?.icon||"?")}</span>${noPhoto?`<span class="product-picture-nophoto">${NO_PHOTO_LABEL}</span>`:""}</span>
  </span>`;
}
/* Плитка-миниатюра мастера подбора отделки. Своя вёрстка (плитка узкая, каталожный глиф не нужен),
   но подпись «фото нет» — общая с карточкой (NO_PHOTO_LABEL, §7.1), чтобы формулировки не разошлись.
   Ошибку загрузки картинки ловит bindProductPictureFallbacks (снимает has-image → показывает фолбэк),
   как у карточек каталога. */
function framePickThumb(imageUrl,alt){
  return imageUrl
    ?`<span class="product-picture frame-pick-thumb has-image"><img src="${esc(imageUrl)}" alt="${esc(alt)}" loading="lazy" decoding="async" data-product-picture><span class="product-picture-fallback" aria-hidden="true">${NO_PHOTO_LABEL}</span></span>`
    :`<span class="product-picture frame-pick-thumb"><span class="product-picture-fallback" aria-hidden="true">${NO_PHOTO_LABEL}</span></span>`;
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
/* Подбор аксессуара-подсветки под механизм — чистый EPPostFit.findBacklight, каталог
   аксессуаров подкладываем здесь (как boxes/supports у findBox/findSupport). */
const findBacklight=(opts)=>EPPostFit.findBacklight(Object.assign({accessories:byKind("accessory")},opts||{}));
/* Единый набор зависимостей для чистой логики поста (EPPosts): каталог, подбор
   суппорта/коробки (точный findBox + стандартно-совместимый фолбэк fallbackBox), признак
   «суппорт вообще не нужен» (крышки IP55 по номенклатуре монтируются без планки), тип
   стены проекта и подсветка клавиш.
   Настройка подсветки (enabled/color/voltage) пока НЕ существует в проекте — её заводит
   задача B1b (UI + EP_DATA.settings). До тех пор подсветка ВЫКЛЮЧЕНА: фолбэк {enabled:false}
   при отсутствии settings.backlight — состав и цена остаются прежними. */
const postDeps=()=>({product,frameProduct,socketBox,mechanismSpan,findBox,fallbackBox,findSupport,resolveSupport,
  supportRequired:EPPostFit.supportRequired,wallType:EP_DATA.settings.wallType,
  findBacklight,backlight:EP_DATA.settings.backlight||{enabled:false}});
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
function assembledPostSpec(post,{size="md",articles=true}={},light){
  const frame=frameProduct(post.frameId);
  /* ⚠️ ЦЕЛЬНОЕ ИЗДЕЛИЕ ПОКАЗЫВАЕМ ЗАМЕНОЙ, ТОЙ ЖЕ, ЧТО УХОДИТ В СМЕТУ. 09001 физически
     заменяется подобранным по числу мест управления (09005), и картинка собранного поста,
     раскладка КП и лист монтажника обязаны показывать то же изделие, что оплачено, — иначе
     монтажник ставит одно, а в смете другое. Правило подмены ОДНО (EPEstimate.effectiveMechanismIds
     по строкам групп света), второй копии здесь нет: строки берём тем же lightingRowsFor, что цена
     поста (postTotalCost). Пробел (замены нет) оставляет исходный артикул — он физически стоит, а
     недостачу называет блок «Группы света»; клавиша (partRole="key") и обычный механизм не
     "integrated" и подмене не подлежат — effectiveMechanismIds их не трогает.
     light передаёт тот, у кого расчёт на руках (КП, лист монтажника, конструктор с ЧЕРНОВИКОМ —
     там расчёт включает ещё не сохранённый пост); размещённый пост на плане и подсказка берут
     проектный (projectLighting). Модульность замены та же (строгий отбор), поэтому раскладка по
     постам/коробкам не меняется — меняется только показанный артикул. */
  const lightRows=lightingRowsFor(post,light===undefined?projectLighting():light);
  const effIds=EPEstimate.effectiveMechanismIds(post.mechanismIds||[],lightRows);
  const dist=EPPosts.distributePosts(effIds,frame,{product,mechanismSpan});
  const rowsMap=new Map();   /* группируем посты по физическому ряду накладки */
  dist.posts.forEach(p=>{
    if(!rowsMap.has(p.row))rowsMap.set(p.row,[]);
    let occ=0;const cells=[];
    p.mechanismIds.forEach(id=>{
      const item=product(id);
      /* Артикул механизма пропал из каталога — рисуем ЯВНЫЙ пробел в 1 модуль (та же оценка
         ширины, что у distributePosts/moduleLayout), помеченный missing, чтобы не слиться со
         свободным модулем: место занято, но чем — неизвестно. Ноль-модульная ячейка (span у
         product(null) равен 0) схлопнулась бы в ничто и сдвинула бы номера соседних модулей. */
      if(!item){
        cells.push({span:1,missing:true,name:articles?`Механизм не найден (арт. ${id})`:"Механизм не найден",num:String(occ+1)});
        occ+=1;
        return;
      }
      const span=mechanismSpan(item);
      const start=occ+1,end=occ+span;
      /* Модуль показываем НАСТОЯЩИМ фото механизма, обрезанным по лицу: imageUrl — детальное фото,
         face — лицевой прямоугольник в % фото (moduleFace, снят детектором). Нет фото/лица →
         postImage рисует нарисованную клавишу-фолбэк, и тогда работают признаки функц. группы
         (categoryId + символ icon → значок pickIcon) и цвет клавиши: color — ЯВНЫЙ цвет, иначе
         цвет из name самого механизма (лицевая панель — отдельный товар: VIMAR даёт белую накладку
         с серебр. клавишами). */
      cells.push({span,imageUrl:productImage(item,{detail:true}),face:moduleFace(item),color:item?.properties?.color||item?.color||"",categoryId:item?.categoryId,icon:item?.icon,name:item?.name||"",num:start===end?String(start):`${start}–${end}`});
      if(!articles)cells[cells.length-1].name=EPOfferOptions.itemText(item.name,false,item.code);
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
    name:articles?frame.name:EPOfferOptions.itemText(frame.name,false,frame.code),code:articles?frame.code:"",imageUrl:productImage(frame,{detail:true}),standard:frame.standard,
    opening:frameOpening(frame,count),windows:frameOpenings(frame,count)
  }:null;
  return {size,frame:frameSpec,rows};
}
const assembledPostHtml=(post,opts={},light)=>EPPostImage.buildHtml(assembledPostSpec(post,opts,light),{esc});
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
/* Счётчики над планом. Одиночные элементы больше не размещаются (реш. заказчика 24.08 §4.8 —
   всё ставится постами), поэтому «Элементов: 0» на чистом проекте только зашумляет строку. Но в
   старых проектах одиночные элементы остаются в смете — тогда счётчик показываем, чтобы их было
   видно. Чистая функция от чисел: без state/DOM, тестируется без шима. */
const statusCountsText=(devices,posts,rooms)=>`${devices>0?`Элементов: ${devices} · `:""}Постов: ${posts} · Комнат: ${rooms}`;
function updateStatus(text){$("status").textContent=text||statusCountsText(state.devices.length,state.posts.length,state.rooms.length)}
function markCanvasUsed(){$("canvasEmpty").style.display="none"}

async function init(){
  state.products=await DataService.getProducts();
  state.templates=await DataService.getSavedPosts();
  renderOfferOptions();   /* restoreProject синхронизирует уже существующие чекбоксы */
  renderRequisitesInputs();   /* поля блоков «Мои реквизиты»/«Реквизиты заказчика» из EPDocRequisites */
  const restored=await restoreProject();
  loadCachedRate();
  fillDocHeaderInputs();   /* реквизиты КП: заполнить поля (и дату «сегодня» на чистом старте) */
  renderDocImage("logo");renderDocImage("signature");renderDocImage("stamp"); /* картинки бланка из EPPrefs (общие для всех проектов) — предпросмотр в панели */
  renderCompanyTerms();    /* условия сделки из EPPrefs (общие для всех проектов) — в поле подвала КП */
  renderTemplates();renderAll();renderSummary();updateScaleUi();updateRateUi();applyPlanVisibility();applyPlanRotation();
  renderLightingSchemeSelect();   /* селектор схемы в панели проекта: заполняем и на чистом старте */
  renderProjectWallTypeSelect();  /* тип стены проекта — там же, рядом со схемой */
  renderProjectBacklight();       /* подсветка клавиш — галочка и оба селектора из каталога */
  renderPostSlotCountSelect();    /* модульности рамки строим из каталога (разметка отдаёт пустой select) */
  applyGridStyle();syncMarkupControls();updateZoomUi();applyView();   /* сетка/переключатели/зум/вид — из state (в т.ч. восстановленного) */
  syncRotateModeUi();   /* режим/поле/подсказка/гейт органов поворота — из восстановленного rotateTarget (Б3, ч.2а) */
  _autosaveOn=true;   /* включаем ПОСЛЕ восстановления, иначе пустой старт затрёт сохранённое */
  /* Базовая точка истории — восстановленный (или пустой) план. История НЕ переживает перезагрузку
     (решение владельца): отсчёт «Отменить» начинается здесь, с открытого состояния. */
  _history.reset(projectSnapshot());syncHistoryUi();
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
  /* ГОТОВЫЕ ПОСТЫ СУЖАЕМ ПО ЦВЕТУ НАКЛАДКИ ВЫБРАННОЙ КОМНАТЫ (ОТДЕЛКА-ПОРЯДОК, п.5). Комнату берём из
     выделения на плане (state.selected) — это «выбранная комната» из порядка работ владельца; функция
     зовётся из renderProperties, поэтому список пересобирается при каждой смене выделения и правке цвета
     комнаты. Цвет накладки комнаты — тем же EPRoom.roomFrameFacing и списком каталога, что весь E14;
     совпадение цвета шаблона и комнаты решает EPPosts.templateFitsRoomColor через EPCatalog.facingColorKey
     (§7.1: одно правило сравнения цвета на весь проект). Комната без цвета / выбрана не комната / комнат
     нет → roomColor=null → показываем ВСЁ (работу не блокируем, п.2). */
  const selRoom=state.selected&&state.selected.kind==="room"?state.rooms.find(r=>r.id===state.selected.id):null;
  const roomColor=selRoom?EPRoom.roomFrameFacing(selRoom,"frameColor",frameFacingList("frameColor")):null;
  const templates=state.templates.filter(t=>EPPosts.templateFitsRoomColor(t,roomColor,{frameProduct,facingColorKey:EPCatalog.facingColorKey}));
  /* Отфильтровали в ноль (у комнаты цвет задан, а постов этого цвета в памяти нет) — «Сохранённых постов
     пока нет» было бы ложью: посты есть, просто другого цвета. Говорим честно и называем цвет. */
  if(!templates.length){list.innerHTML=`<div class="library-empty">${esc(`Готовых постов под цвет накладки комнаты («${roomColor}») в памяти нет — соберите пост для этой комнаты или выберите комнату другого цвета.`)}</div>`;return}
  /* Миниатюра — то же собранное изделие, что в конструкторе (единая EPPostImage): рамка,
     разделение на посты/импосты и модули. Раньше здесь была россыпь иконок механизмов —
     по замечанию владельца «нет получившегося полного изображения рамки и модулей». */
  list.innerHTML=templates.map(t=>{
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
  /* Объект, не попавший ни в одну комнату, помечаем ВИДИМО — раньше об этом говорила только
     строка статуса при перетаскивании, и пост, выпавший из комнаты из-за
     перетрассировки контуров, оставался незамеченным (а теперь это решает деньги: другая схема
     проводки). Помечаем только когда комнаты в проекте вообще есть — иначе «без комнаты» у всего
     подряд было бы шумом. Критерий — общий EPRoomAssign.isOutsideRooms (§7.1), тот же вызов в
     syncNoRoomClass. roomId уже пересчитан recalculateRoomAssignments перед этим рендером. */
  if(EPRoomAssign.isOutsideRooms(entity.roomId,state.rooms.length))el.classList.add("no-room");
  el.style.left=entity.x+"px";el.style.top=entity.y+"px";
  if(kind==="device") el.textContent=product(entity.productId)?.icon||"?";
  /* метка поста = его сквозной номер (раньше рисовали «P» + число мест) — чтобы номер
     на плане совпадал с раскладкой постов, листом монтажника и КП */
  if(kind==="post")el.textContent=entity.number!=null?String(entity.number):"?";
  /* выделение/удаление/перенос — единый указательный обработчик (makeDraggable):
     клик и перенос разводятся порогом, сцена на нажатии не перерисовывается */
  el.onmouseenter=e=>showHover(kind,entity,e);el.onmousemove=positionHover;el.onmouseleave=hideHover;
  /* Вне размещения клик по объекту не должен доходить до canvas.onclick (выделение уже сделал
     makeDraggable, иначе canvas.onclick его ещё и снял бы). В РЕЖИМЕ размещения (В11) — наоборот:
     пропускаем click к canvas.onclick, чтобы единое правило placePendingAtEvent поставило НОВЫЙ пост
     в точку клика, а эта иконка осталась нетронутой (не удалена, не выделена, не перенесена).
     В19: запоминаем, что клик размещения пришёлся на иконку СТОЯЩЕГО поста, — addPending ниже это
     заметит и пометит постановку, чтобы двойной клик (второй клик + dblclick по новому посту) её
     откатил и открыл старый пост (см. _placeOnPostIcon/openPostOnDblClick). Только для постов:
     у устройств открытия по двойному клику нет. */
  el.onclick=e=>{if(state.pending){if(kind==="post")_placeOnPostIcon=entity.id;return}e.stopPropagation()};
  makeDraggable(el,entity,kind);return el;
}
function renderDevices(){canvas.querySelectorAll(".plan-icon.device-only").forEach(e=>e.remove());state.devices.forEach(d=>{const el=compactIcon(d,"device");el.classList.add("device-only");canvas.appendChild(el)})}
function renderPosts(){canvas.querySelectorAll(".plan-icon.post").forEach(e=>e.remove());state.posts.forEach(p=>{const el=compactIcon(p,"post");el.ondblclick=e=>{e.stopPropagation();openPostOnDblClick(p.id)};canvas.appendChild(el)})}
/* В19: двойной клик по иконке поста. Обычно — открыть ЭТОТ пост (как и было). Но если это тот
   самый новый пост, что первый клик двойного только что поставил ПОВЕРХ старого в режиме
   «Разместить» (см. _placeOnPostIcon/_lastIconPlacement в addPending), — откатываем постановку и
   открываем СТАРЫЙ пост: жест сохраняет прежний смысл «открыть этот пост», а не плодит дубль.
   Решение «это ли продолжение того двойного клика» — чистый EPPlaceDblClick.resolve (окно по
   времени отделяет его от осознанного двойного клика по новому посту много позже). */
function openPostOnDblClick(postId){
  const d=EPPlaceDblClick.resolve(_lastIconPlacement,postId,Date.now());
  if(d.undo){
    _lastIconPlacement=null;
    /* Новый пост убираем ЦЕЛИКОМ тем же путём, что «Удалить» (state.posts, выделение, смета,
       автосохранение). Номер не «сгорает»: nextPostNumber считает максимум+1, снятие последнего
       поста возвращает тот же номер следующему. Групп у нового поста нет (placementFields их
       очищает) — осиротевших связей не остаётся.
       В ИСТОРИИ ЭТОГО «НЕ БЫЛО» (Б4, решение владельца): первый клик уже записал шаг «поставил»;
       снимаем его (dropHead) и глушим запись шага «убрал» замком применения — иначе двойной клик
       оставил бы в истории пару мусорных шагов «поставил»/«убрал». */
    _applyingSnapshot=true;
    try{removeEntity("post",d.removeId);persistProject()}finally{_applyingSnapshot=false}
    _history.dropHead();syncHistoryUi();
    /* Тост «Объект добавлен…», показанный первым кликом, теперь вводил бы в заблуждение (ничего не
       добавили) — гасим до открытия конструктора старого поста. */
    const t=$("toast");if(t){t.classList.remove("show");t.textContent=""}
  }
  openPostBuilder({placedId:d.openId});
}
/* СВЯЗИ ГРУПП СВЕТА НА РАБОЧЕМ ХОЛСТЕ. Владелец хотел видеть связи между постами не только в
   КП, но и прямо в окне приложения: между постами общей группы — синий пунктир, у постов —
   мелкая подпись группы. Рисуем в отдельном SVG #linksSvg внутри #canvas, поэтому связи живут
   в МИРОВЫХ координатах и едут вместе с планом при зуме/панораме (та же CSS-трансформация
   #canvas, что у контуров комнат и стен) — компенсировать вид вручную не нужно.
   КТО с кем и в каком порядке считает чистый EPPlanLabels.groupChains — ТА ЖЕ функция, что
   строит связи для документа (§7.1: правило в одной функции). Здесь только отрисовка. SVG
   pointer-events:none и z-index под иконками постов — связи не перехватывают клик и перенос.
   Подпись у бирки повторяет КП: имя(имена) групп поста через « · ». */
function renderGroupLinks(){
  const svg=$("linksSvg");if(!svg)return;
  svg.innerHTML="";
  const posts=postsForGroupLinks();
  EPPlanLabels.groupChains(posts).forEach(ln=>{
    const line=document.createElementNS(SVG_NS,"line");
    line.setAttribute("x1",ln.x1);line.setAttribute("y1",ln.y1);
    line.setAttribute("x2",ln.x2);line.setAttribute("y2",ln.y2);
    line.setAttribute("class","group-link");
    svg.appendChild(line);
  });
  /* Подпись группы у поста — как в КП: у всех постов с назначенной группой, независимо от того,
     есть ли пара (одиночная группа линии не даёт, но имя показать надо). Ниже иконки (y+половина
     +отступ), центр по X. SVG-текст масштабируется вместе с планом — как контуры комнат. */
  const a=state.worldAngle||0,rad=a*Math.PI/180,off=POST_ICON_HALF+11;
  posts.forEach(p=>{
    const groups=p.groups||[];   /* пост без групп поле groups не несёт (см. postsForGroupLinks) */
    if(!groups.length)return;
    /* Якорь подписи — «под иконкой НА ЭКРАНЕ» при любом угле (§ DoD п.4). Смещение off задаём в
       направлении, которое поворот холста R(θ)·scale превратит ровно в «вниз на экране»: это
       R(−θ)·(0,off) = (sinθ·off, cosθ·off). При θ=0 — прежние (0, off), подпись под иконкой. */
    const ax=p.x+Math.sin(rad)*off, ay=p.y+Math.cos(rad)*off;
    const t=document.createElementNS(SVG_NS,"text");
    t.setAttribute("x",ax);t.setAttribute("y",ay);
    t.setAttribute("class","group-link-label");
    /* контр-поворот вокруг якоря — подпись остаётся прямой, не встаёт боком/вверх ногами */
    if(a)t.setAttribute("transform","rotate("+(-a)+" "+ax+" "+ay+")");
    t.textContent=groups.map(g=>g.label).join(" · ");
    svg.appendChild(t);
  });
}
/* Отрисовка комнат (таблички + контуры) и правка их вершин вынесены в js/rooms.js (EPRooms.attach,
   И1 кусок 2). renderRooms/relabelContourRooms/updateRoomLabelText берём назад из attach (см. низ файла).
   SVG-namespace остаётся здесь: он общий для нескольких отрисовщиков (renderGroupLinks/renderScaleRuler/
   разметка линий), а слою комнат приходит через ctx. */
const SVG_NS="http://www.w3.org/2000/svg";
/* Распознавание и разметка помещений (инструмент «Разметка», сборка помещений по линиям, авто-
   определение комнат OpenCV/нейросетью, перенос ручных полей carryUserRoomFields) вынесены в
   js/roomDetect.js (EPRoomDetect.attach, И1). drawRoomLines/addRoomLinePoint/finishRoomLineChain/
   removeLastRoomLinePoint/buildRoomsFromLines берём назад из attach (см. низ файла). */
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
  refreshAfterRoomAssignments(renderAll);
}

/* ---- Определение комнат (OpenCV.js, ленивая загрузка) ----
   Чистая геометрия (полигоны, площади, флуд-фолл свободного пространства) вынесена
   в js/geometry.js (EPGeom) — см. PLAN 2.1; здесь берём её через алиасы, а привязка
   к state/DOM остаётся в этом файле. */
const {polygonCentroid,polygonAreaPx,pointInPolygon,componentAt,roomContourProbe,segmentsIntersection,distancePointToSegment,roomLabelPoint,roomNamePoint,tightestRoomAtPoint}=EPGeom;
/* площадь комнаты в м² — только если задан масштаб плана */
function roomAreaM2(room){
  if(!state.pxPerMeter||!room?.polygon||room.polygon.length<3)return null;
  return polygonAreaPx(room.polygon)/(state.pxPerMeter*state.pxPerMeter);
}
const formatArea=m2=>m2.toFixed(1).replace(".",",")+" м²";
function roomAutoAreaText(room){const m2=roomAreaM2(room);return m2?formatArea(m2):""}
/* что показывать: ручное значение приоритетнее авторасчёта */
function roomDisplayArea(room){return room.area?.trim()?room.area.trim():roomAutoAreaText(room)}
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
  const lx=(seg.a.x+seg.b.x)/2,ly=(seg.a.y+seg.b.y)/2-9;
  label.setAttribute("x",lx);label.setAttribute("y",ly);
  label.setAttribute("text-anchor","middle");label.setAttribute("class","scale-text");
  /* подпись масштаба остаётся прямой при повороте всего плана — контр-поворот вокруг её якоря (Б3, ч.2а) */
  const a=state.worldAngle||0;if(a)label.setAttribute("transform","rotate("+(-a)+" "+lx+" "+ly+")");
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
  const token=state.planToken;   /* запоминаем поколение подложки ДО первого await */
  const btn=$("annotateBtn");btn.disabled=true;
  showTraceProgress(true,"Распознавание (нейросеть)","Подготовка модели…");
  try{
    await EPFloorplanML.ensureReady({onProgress:msg=>showTraceProgress(true,"Распознавание (нейросеть)",msg)});
    showTraceProgress(true,"Распознавание (нейросеть)","Анализ плана…");
    await new Promise(r=>setTimeout(r,40));
    const res=await EPFloorplanML.detect(img,{conf:0.22,onProgress:msg=>showTraceProgress(true,"Распознавание (нейросеть)",msg)});
    if(planLostDuringOp(token))return;   /* подложку убрали/сменили — не пишем detections и не показываем «Убрать разметку» */
    state.detections={list:res.detections,natW:res.natW,natH:res.natH};
    renderAnnotations();
    $("clearAnnotateBtn").hidden=false;
    showTraceProgress(false);
    const shown=res.detections.filter(d=>!(ANNOT_STYLE[d.name]||{}).hidden).length;
    toast(shown?`Распознано элементов: ${shown} (${EPFloorplanML.backend||"—"})`:"Элементы не распознаны");
    updateStatus(`Распознано элементов: ${shown}`);
  }catch(e){console.error(e);showTraceProgress(false);toast(e.message||"Не удалось распознать план")}
  /* приводим кнопки к нынешнему состоянию подложки, а не «включаем annotateBtn всегда»:
     при живой подложке updatePlanUi вернёт его активным, при убранной — оставит выключенным */
  finally{updatePlanUi()}
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
  const walls=allWalls();
  let map=prebuiltMap;
  if(gridRooms.length){
    map=map||buildSpaceComponents();
    gridRooms.forEach(r=>{if(r.seedX==null){r.seedX=r.x+55;r.seedY=r.y+18}r.componentId=componentAt(map,r.seedX,r.seedY)});
  }
  return {polyRooms,gridRooms,map,walls};
}

/* ⚠️ ЕДИНОЕ ПРАВИЛО «В КАКОЙ КОМНАТЕ ТОЧКА». Раньше оно жило в ДВУХ местах (getRoomForPoint для
   подсветки при перетаскивании и отдельная копия в recalculateRoomAssignments для фактической
   привязки) — расхождение показало бы одну комнату под курсором, а записало бы другую. Сведено
   сюда, потребители лишь готовят контекст.

   Свидетельства — от сильнейшего к слабейшему. Ветви:
     1) настоящее попадание в КОНТУР комнаты (pointInPolygon) — прямое доказательство «точка внутри»;
     2) доступный КОНТУР в пределах roomEdgeTolerance — зонд до нутра комнаты не должен пересечь
        стену. Это чинит объект ровно на границе/в дверном проёме, но не протягивает его через
        глухую стену. Компонента связности здесь намеренно не используется: для точки на стене
        componentAt выбирает сторону порядком обхода клеток и меняет ответ от сдвига сетки;
     3) GRID-комната по компоненту связности — для комнат без контура (ручная подпись без полигона).

   При равном расстоянии до нескольких доступных контуров не выбираем по roomId: автоопределение
   создаёт эти id заново, и без изменения геометрии объект переехал бы в другую комнату. Неоднозначный
   кандидат передаём grid-ветке; если она не разрешает ситуацию — честно оставляем объект без комнаты
   и с видимой меткой, а не меняем схему и деньги молча. */
function resolveRoomForPoint(cx,cy,ctx){
  /* Точку могут накрывать НЕСКОЛЬКО контуров сразу: «комната в комнате» (санузел/чулан посреди зала)
     и поправленная руками комната, оставшаяся на всю площадь ПОВЕРХ дорисованной части (В18). Берём
     САМУЮ ТЕСНУЮ — контур НАИМЕНЬШЕЙ площади: пост/прибор по смыслу относится к тому помещению, что
     его плотнее всего окружает (решение владельца 03.10: «пост в чулане — по чулану, не по залу»).
     Правило «точка → теснейшая накрывающая» ЕДИНО с кликом выбора/удаления на холсте — одна чистая
     функция EPGeom.tightestRoomAtPoint (§7.1), второй копии нет (раньше клик жил своим find по порядку
     массива, и под курсором подсвечивалась одна комната, а удалялась первая — В20 п.2). */
  const hit=tightestRoomAtPoint(cx,cy,ctx.polyRooms);
  if(hit)return hit;
  const tolerance=EPConfig.roomEdgeTolerance;
  if(Number.isFinite(tolerance)&&tolerance>=0){
    const EPS=1e-9;
    let near=null,bestDist=Infinity,nearA=Infinity,ambiguous=false;
    for(const room of ctx.polyRooms){
      const probe=roomContourProbe(cx,cy,room.polygon,ctx.walls||[],EPConfig.roomProbeInset);
      if(probe.blocked||probe.dist>tolerance)continue;
      const a=polygonAreaPx(room.polygon);
      /* Строго ближе — безусловный кандидат. На РАВНОМ расстоянии до нескольких ДОСТУПНЫХ контуров
         выбираем ТЕСНЕЙШИЙ (как ветвь прямого попадания): пост ровно на ОБЩЕЙ наружной кромке чулана
         и зала — pointInPolygon относит кромку наружу, ветвь попадания промахивается и управление
         приходит сюда — относится к чулану, а не остаётся «вне помещений» со схемой и ценой проекта
         (В20 п.1, ДЕНЬГИ). Если же площади ТОЖЕ равны — это не «теснее», а честная двусмысленность
         (объект в зазоре между двумя РАВНЫМИ раздельными комнатами): оставляем видимой сиротой, а не
         выбираем по порядку массива / нестабильному id (§7.1, regress — roomResolveRule). */
      if(probe.dist<bestDist-EPS){near=room;bestDist=probe.dist;nearA=a;ambiguous=false;continue}
      if(Math.abs(probe.dist-bestDist)<=EPS){
        if(a<nearA-EPS){near=room;nearA=a;ambiguous=false}
        else if(a<=nearA+EPS)ambiguous=true;
      }
    }
    if(near&&!ambiguous)return near;
  }
  if(ctx.map&&ctx.gridRooms.length){
    const component=componentAt(ctx.map,cx,cy);
    /* ⚠️ guard component>=0 НЕ случайный. В main правило жило двумя копиями: подсветка
       (getRoomForPoint) отсекала component<0, а фактическая привязка в recalculateRoomAssignments —
       нет. На замурованной точке componentAt даёт -1 и ей, и seed'у grid-комнаты в том же блоке, и
       незащищённая копия делала find(-1===-1), приписывая объект комнате с заблокированным seed'ом.
       Объединение выбрало защищённый вариант. Это МЕНЯЕТ привязку (а значит смету) на входах, где
       componentAt возвращает -1: снимешь guard — вернёшь баг main. Регресс — roomResolveRule.test.js. */
    if(component>=0){
      const inComp=ctx.gridRooms.filter(r=>r.componentId===component);
      /* Одна подпись в компоненте — она и есть ответ (поведение прежнее). НЕСКОЛЬКО подписей в одной
         компоненте (стен между ними нет — обычный случай ручной расстановки) больше НЕ разрешаем
         порядком в массиве: раньше find брал ПЕРВУЮ по списку, и любой объект молча уходил в первую
         комнату — с её отделкой и в её раздел сметы. Различаем настоящим свидетельством: ближайший
         ДОСТИЖИМЫЙ якорь (seedX/seedY). Достижимость — тем же зондом «есть ли стена между», что и во
         второй ветви (segmentsIntersection; стену через сам объект не считаем преградой, как SKIP в
         roomContourProbe): объект не тянем сквозь глухую стену. Ближайших поровну или все перекрыты —
         честный null, объект остаётся «вне помещений» с меткой, а не выбор по нестабильному id/порядку. */
      if(inComp.length===1)return inComp[0];
      if(inComp.length>1){
        const EPS=1e-9,SKIP=1e-6;
        const anchorBlocked=(sx,sy)=>{
          const p1={x:cx,y:cy},p2={x:sx,y:sy};
          for(const w of (ctx.walls||[])){
            if(!w?.a||!w?.b)continue;
            if(distancePointToSegment(cx,cy,w.a.x,w.a.y,w.b.x,w.b.y)<=SKIP)continue;
            if(segmentsIntersection(p1,p2,w.a,w.b))return true;
          }
          return false;
        };
        let near=null,bestDist=Infinity,ambiguous=false;
        for(const room of inComp){
          if(room.seedX==null||anchorBlocked(room.seedX,room.seedY))continue;
          const d=Math.hypot(cx-room.seedX,cy-room.seedY);
          if(d<bestDist-EPS){near=room;bestDist=d;ambiguous=false}
          else if(Math.abs(d-bestDist)<=EPS){ambiguous=true}
        }
        if(near&&!ambiguous)return near;
      }
    }
  }
  return null;
}

function getRoomForPoint(x,y,map=null){
  if(!state.rooms.length)return null;
  return resolveRoomForPoint(x,y,roomResolveContext(map));
}

/* Точечная синхронизация метки «вне помещений» с DOM — по образцу applySelectionClasses.
   Метку пишем ТАМ ЖЕ, где меняется roomId (updateObjectRoom / recalculateRoomAssignments),
   а не в рендере: roomId правится и по путям, которые renderAll не зовут (перенос объекта,
   правка вершин контура), — при простановке только в compactIcon метка расходилась с фактом
   (пост уехал из комнаты, а «!» не появился; вернулся — «!» остался). Критерий «объект вне
   помещений» один на оба потребителя — EPRoomAssign.isOutsideRooms (§7.1), тот же вызов и в
   compactIcon. Узел ищем по глобально уникальному
   data-id (uid с префиксом) — сам класс переключаем без пересоздания сцены. */
function syncNoRoomClass(entity){
  const el=canvas.querySelector('.plan-icon[data-id="'+entity.id+'"]');
  if(el)el.classList.toggle("no-room",EPRoomAssign.isOutsideRooms(entity.roomId,state.rooms.length));
}

function updateObjectRoom(entity){
  const room=getRoomForPoint(entity.x+12,entity.y+12);
  entity.roomId=room?.id||null;
  syncNoRoomClass(entity);   /* метка «вне помещений» — там же, где пишется roomId, а не в рендере */
  return room;
}

function recalculateRoomAssignments(){
  const ctx=roomResolveContext();   /* карта пространства строится один раз на весь пересчёт */
  [...state.devices,...state.posts].forEach(obj=>{
    obj.roomId=resolveRoomForPoint(obj.x+12,obj.y+12,ctx)?.id||null;
    syncNoRoomClass(obj);   /* метка синхронна с только что записанным roomId; при renderAll иконки затем пересоздаст compactIcon из того же roomId — результат тот же */
  });
}

/* ⚠️ ЕДИНАЯ ТОЧКА «ПРИВЯЗКА ОБЪЕКТОВ К КОМНАТАМ ИЗМЕНИЛАСЬ». Любая правка геометрии
   (стена, линия разметки, перенос комнаты, авто-трассировка) сдвигает объекты между
   помещениями — обновиться обязаны ВСЕ, кто это показывает: план, панель свойств
   выбранного поста (там комната и цена) и сводка. Пока каждый потребитель перечислял
   вызовы сам, контракт из пяти-шести вызовов невозможно было помнить, и его копировали
   неполно — в пяти местах выпал renderProperties: кольцо на плане горит, а карточка
   поста показывает прежнюю комнату. Правило живёт здесь одно, у правки нет краёв.

   paint — чем места различаются в рисовании: renderAll (сам рисует комнаты и планирует
   сохранение) либо колбэк вида ()=>{drawWalls();renderRooms()} / ()=>{drawRoomLines();
   renderRooms()} / renderRooms. save — способ сохранения: scheduleSave, persistProject
   или ничего; scheduleSave и persistProject НЕ взаимозаменяемы, передаётся именно тот,
   что был в месте. Автопересчёт помещений (scheduleRoomsFromLines) сюда не входит —
   это отдельная механика, остаётся на месте вызова. */
function refreshAfterRoomAssignments(paint, save){
  recalculateRoomAssignments();
  paint();
  /* Связи групп зависят от комнаты поста (покомнатное разбиение): пересчёт привязки мог сдвинуть
     пост в другую комнату и переклеить цепочки. Обновляем их здесь единой точкой — не в каждом
     paint-колбэке (когда paint===renderAll, тот тоже зовёт renderGroupLinks; лишний прогон
     идемпотентен и дешёв). */
  renderGroupLinks();
  renderProperties();
  renderSummary();
  if(save)save();
}

function getObjectsInRoom(roomId){
  const result=[];
  state.devices.forEach(d=>{if(d.roomId===roomId)result.push({kind:"device",entity:d,name:product(d.productId)?.name||"Элемент"})});
  state.posts.forEach(p=>{if(p.roomId===roomId)result.push({kind:"post",entity:p,name:postNumberLabel(p)})});
  return result;
}

function renderAll(){
  recalculateRoomAssignments();
  renderDevices();renderPosts();renderRooms();drawWalls();drawRoomLines();renderGroupLinks();
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
  renderProjectBacklight();        /* подсветка клавиш: галочка/цвет/напряжение + их доступность */
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
    const comp=postComposition(obj),frameInfo=comp.frameAvailability,boxUnit=comp.box||comp.boxFallback;
    /* Коробки в подсказке: цена подобранной/фолбэк-коробки × число; если совместимой со
       стандартом коробки нет — честно «не подобрана», без цены (как в составе поста). */
    const boxCell=boxUnit?`${comp.boxCount} × ${money(boxUnit.price)}`:(comp.boxCount?`${comp.boxCount} шт. — не подобрана`:"—");
    /* Подсветка клавиш в подсказке — та же backlightRowSummary, что состав и карточка: «Стоимость
       поста» ниже включает LED, значит подсказка обязана его назвать (или пробел). Нет подсветки → null,
       строки нет, подсказка байт в байт как раньше. */
    const backSummary=backlightRowSummary(comp.backlight);
    const backRow=backSummary?`<dt>Подсветка</dt><dd>${esc(backSummary.text)}</dd>`:"";
    /* Миниатюра собранного поста (та же EPPostImage, что в конструкторе) вместо простыни
       названий — сразу видно рамку, посты и импосты. */
    hover.innerHTML=`<h4>${esc(postNumberLabel(obj))}</h4><div class="hover-thumb">${assembledPostHtml(obj,{size:"sm"})}</div>
    <dl><dt>Накладка</dt><dd>${esc(frameInfo.displayName)}</dd><dt>Коробки</dt><dd>${boxCell}</dd>${backRow}<dt>Стоимость поста</dt><dd>${money(postTotalCost(obj))}</dd></dl>`;
  }
  hover.classList.add("show");positionHover(e);
}
function positionHover(e){const w=clientToWorld(e.clientX,e.clientY);hover.style.left=Math.min(canvas.clientWidth-280,w.x+18)+"px";hover.style.top=Math.max(8,w.y-20)+"px"}
function hideHover(){hover.classList.remove("show")}

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
    refreshAfterRoomAssignments(renderRooms, scheduleSave);
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
   применение результата (updateRoomLabelText/persistProject, как при blur/Enter, БЕЗ renderProperties —
   рекурсии между ними нет). */
/* updateRoomLabelText (точечное обновление подписи комнаты без пересоздания слоя .room-label)
   вынесено в js/rooms.js — почему без renderRooms см. комментарий там; сюда приходит через attach. */
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
/* Состояние групп света РАЗМЕЩЁННОГО поста для панели свойств. ЗАЧЕМ ОТДЕЛЬНЫЙ БЛОК: поле группы
   живёт в конструкторе у слота клавиши и появляется лишь после «Редактировать» — из панели поста
   не было видно даже, что группы существуют, узнавали только по строке в готовом КП. Показываем
   явно: у клавиши с именем группы — это имя (может связывать её в проходную с одноимённой клавишей
   другого поста), у клавиши без имени — что это ОТДЕЛЬНЫЙ ВЫКЛЮЧАТЕЛЬ (см. правило resolveGroup в
   модуле групп: имя пусто = самостоятельный свет, механизм и цена считаются молча, это не пробел).
   Клавиш в посте нет вовсе → задавать негде.
   ⚠️ Слоты и «что такое место управления» — те же, что у конструктора (EPBuilderSlots.fromPost +
   keySlotKind), имя нормализуем тем же normalizeGroup, которым оно печатается везде: второй копии
   разбора поста, предиката места и правила написания имени не заводим (§7.1). keySlotKind(id)===true —
   ровно тот случай, когда конструктор рисует поле ввода группы (isControlPlaceItem: клавиша ИЛИ
   цельное изделие), поэтому и здесь считаем местами только его: «потерянное место» (артикул выпал,
   keySlotKind===null) — забота расчёта групп, а не этой подсказки. */
function postGroupsPropHtml(post){
  const keys=EPBuilderSlots.fromPost(post,keySlotKind).filter(s=>keySlotKind(s.id)===true);
  if(!keys.length)
    return `<div class="post-groups"><div class="post-groups-head">Группы света</div>`
      +`<small class="prop-hint">В посте нет мест управления — группы света задавать негде.</small></div>`;
  const rows=keys.map((s,i)=>{
    const name=EPLightingGroups.normalizeGroup(s.group);
    const cross=EPLightingGroups.normalizeGroup(s.cross);
    const mech=EPLightingGroups.roleOverrideOf({roleOverride:s.mech});
    const mechLabel=mech?EPLightingGroups.ROLE_LABELS[mech]:"";
    /* Связывает клавишу НОМЕР (проходная); имя — подпись для документов; без того и другого клавиша
       это отдельный выключатель. Ручной механизм (ВАРИАНТ C) — отдельной пометкой, только когда
       выбран: «как посчитано» строки не заслуживает. */
    const main=cross?`проходная № ${esc(cross)}${name?` «${esc(name)}»`:""}`:(name?esc(name):"отдельный выключатель");
    const extra=mechLabel?`<em>механизм: ${esc(mechLabel)} (вручную)</em>`:"";
    return `<div class="post-group-row ${cross||name?"has-group":"no-group"}"><span>Место ${i+1}</span>`
      +`<b>${main}</b>${extra}</div>`;
  }).join("");
  return `<div class="post-groups"><div class="post-groups-head">Группы света</div>${rows}`
    +`<small class="prop-hint">Проходную задаёт НОМЕР: одинаковый номер у мест управления разных постов свяжет их в одну проходную. `
    +`Имя группы — только для документов. Без номера место — обычный выключатель; номер, имя и механизм задаются в конструкторе: «Редактировать».</small></div>`;
}
function renderProperties(){
  flushRoomDraft();   /* §7.1: правило «сначала закоммить черновик» в одной точке — покрывает все ~25 вызовов */
  /* Список готовых постов сужается по цвету накладки ВЫБРАННОЙ комнаты (ОТДЕЛКА-ПОРЯДОК, п.5). Держим
     его синхронным с выделением ОДНОЙ точкой — здесь: renderProperties и так зовётся на каждой смене
     выделения и правке цвета комнаты (§7.1 «правило в одном месте»), рассыпать renderTemplates по всем
     этим местам значило бы снова забыть одно из них. Стоит ДО ранних return — иначе снятие выделения
     (пустой selected / удалённая сущность) не сбросило бы фильтр обратно на «показать всё». */
  renderTemplates();
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
       (commitRoomFields → flushRoomDraft → persistProject). Здесь высота писалась только в объект в памяти: она попадала
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
    const comp=postComposition(p);   /* один расчёт состава на карточку: и число коробок, и подсветка */
    const lightSummary=lightingRowSummary(lightingRowsFor(p,light));
    /* Подсветка клавиш — тем же backlightRowSummary, что панель «Состав поста» и подсказка: LED в
       цене поста, значит карточка, показывающая эту цену, обязана его назвать (или пробел). */
    const backSummary=backlightRowSummary(comp.backlight);
    /* Тип стены поста прямо в панели свойств. ⚠️ ОТСУТСТВИЕ post.wallType — это «как в проекте»,
       а не «unknown» (EPPosts.postWallType), поэтому «свой» и «унаследован» — РАЗНЫЕ состояния,
       и показываем их по-разному: ownWall различает наличие собственного поля у поста, curWall —
       фактически действующий тип (свой либо проектный), projWall — значение проекта для подписи. */
    const projWall=EP_DATA.settings.wallType==="hollow"?"hollow":"solid";
    const ownWall=p.wallType==="solid"||p.wallType==="hollow";
    const curWall=EPPosts.postWallType(p,EP_DATA.settings.wallType);
    props.innerHTML=`<label>Пост<input value="${esc(postNumberLabel(p))}" disabled></label>
    <label>Комната<input value="${esc(room?.name||"Не назначена")}" disabled></label>
    <label>Механизмов / коробок<input value="${p.mechanismIds.length} / ${comp.boxCount}" disabled></label>
    <label>Тип стены<select id="postWallSelect">
      <option value="solid"${curWall==="solid"?" selected":""}>Бетон, кирпич, сплошные стены</option>
      <option value="hollow"${curWall==="hollow"?" selected":""}>ГКЛ и полые стены</option>
    </select></label>
    <small class="prop-hint prop-wall-source${ownWall?" own":""}">${ownWall?"Свой тип стены поста":`Унаследован от проекта: ${esc(WALL_STEP_LABEL[projWall]||projWall)}`}</small>
    ${lightSummary?`<label>Механизмы групп света<input value="${esc(lightSummary.text)}" disabled></label>`:""}
    ${backSummary?`<label>Подсветка клавиш<input value="${esc(backSummary.text)}" disabled></label>`:""}
    ${postGroupsPropHtml(p)}
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
       комнаты, curScheme — фактически действующую (свою либо проектную). Названия и пояснение
       (note) схемы берём из единого списка EPLightingGroups.SCHEMES — второй копии нет.
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
    /* Монтажный стандарт комнаты — ПЕРВЫЙ критерий отделки (встреча 24.08 §4.1: «первое, что должны
       мы выбрать»): выбор стандарта сразу отсекает неподходящие серии и накладки. Тот же приём, что у
       коллекции: значения из каталога (frameStandardList), действующее — через EPRoom.roomFrameFacing
       (мёртвое → «не задан», r.standard не трогаем). Подпись человеку — словом (EPCatalog.standardLabel),
       а не кодом IT/DE. */
    const standardList=frameStandardList();
    const roomStd=EPRoom.roomFrameFacing(r,"standard",standardList);
    const standardOptions=`<option value=""${roomStd?"":" selected"}>Не задан — накладки любого стандарта</option>`
      +standardList.map(code=>`<option value="${esc(code)}"${code===roomStd?" selected":""}>${esc(EPCatalog.standardLabel(code))}</option>`).join("");
    /* Коллекция накладок комнаты (E13). ⚠️ В ОТЛИЧИЕ ОТ СХЕМЫ у коллекции НЕТ значения-умолчания
       проекта: «не задана» — это не «как в проекте», а «фильтра нет, предлагать все накладки».
       roomColl — действующая коллекция (EPRoom.roomCollection валидирует по списку каталога:
       мёртвое/отсутствующее значение → null → селектор в «Не задана», r.collection не трогаем до
       выбора человека). Список коллекций — из каталога (frameCollectionList), не константа. */
    const collectionList=frameCollectionList();
    const roomColl=EPRoom.roomCollection(r,collectionList);
    const collectionOptions=`<option value=""${roomColl?"":" selected"}>Не задана — предлагать все накладки</option>`
      +collectionList.map(name=>`<option value="${esc(name)}"${name===roomColl?" selected":""}>${esc(name)}</option>`).join("");
    /* Отделка накладки комнаты (E14): материал, форма, цвет. Тот же приём, что у коллекции: значения
       из каталога (frameFacingList), действующее — через EPRoom.roomFrameFacing (мёртвое → «не
       задан», r.<признак> не трогаем). Плейсхолдер/подсказку держим ПОФИЛЬДНО из-за рода слова
       (материал «задан», форма «задана»), а не собираем строкой. Селекторы id room_<признак>Select. */
    const facingSpecs=[
      {prop:"frameMaterial",label:"Материал накладки",empty:"Не задан — любой материал",on:"Предлагаются накладки только этого материала",off:"Материал не задан — не сужается"},
      {prop:"frameShape",label:"Форма накладки",empty:"Не задана — любая форма",on:"Предлагаются накладки только этой формы",off:"Форма не задана — не сужается"},
      {prop:"frameColor",label:"Цвет накладки",empty:"Не задан — любой цвет",on:"Предлагаются накладки только этого цвета",off:"Цвет не задан — не сужается"}
    ].map(spec=>{
      const values=frameFacingList(spec.prop);
      const cur=EPRoom.roomFrameFacing(r,spec.prop,values);
      const options=`<option value=""${cur?"":" selected"}>${esc(spec.empty)}</option>`
        +values.map(v=>`<option value="${esc(v)}"${v===cur?" selected":""}>${esc(v)}</option>`).join("");
      return {...spec,cur,options};
    });
    const facingFieldsHtml=facingSpecs.map(spec=>
      `<label class="room-facing-field">${esc(spec.label)}<select id="room_${spec.prop}Select">${spec.options}</select></label>`
      +`<small class="prop-hint prop-collection-source${spec.cur?" own":""}">${esc(spec.cur?spec.on:spec.off)}</small>`).join("");
    /* Отделка накладки — ДВА ВИДА одного и того же выбора (согласовано с владельцем 15.09): «Списком»
       (готовые селекторы E13/E14) и «С картинками» (шаговый мастер поверх ТОГО ЖЕ отбора). Вид —
       привычка человека (frameFacingView, EPPrefs), не свойство проекта. В виде «С картинками» на
       месте селекторов — сводка выбранного (чтобы «что выбрано в одном виде, видно в другом») и
       кнопка мастера. Значения сводки — те же валидированные roomColl/facingSpecs, что и у списка. */
    const facingView=frameFacingView();
    const standardFieldHtml=`<label class="room-standard-field">Стандарт монтажа<select id="roomStandardSelect">${standardOptions}</select></label>
    <small class="prop-hint prop-collection-source${roomStd?" own":""}">${roomStd?"Конструктор поста в этой комнате предлагает накладки только этого монтажного стандарта":"Стандарт не задан — предлагаются накладки любого стандарта"}</small>`;
    const collectionFieldHtml=`<label class="room-collection-field">Коллекция накладок<select id="roomCollectionSelect">${collectionOptions}</select></label>
    <small class="prop-hint prop-collection-source${roomColl?" own":""}">${roomColl?"Конструктор поста в этой комнате предлагает накладки только этой коллекции":"Коллекция не задана — предлагаются все накладки каталога"}</small>`;
    /* Стандарт монтажа — первый критерий отделки, но пока он не выбран, сводка о нём молчала и человек
       не находил слово «Стандарт» (В3). Поэтому в виде «С картинками» у него СВОЯ строка над кнопкой
       мастера, видимая ВСЕГДА: «не задан» или название (тот же EPCatalog.standardLabel, что в селекторе
       списка). Значение — тот же валидированный roomStd (мёртвый → «не задан»). Из общей сводки
       стандарт убран, чтобы не показываться дважды; и пустой текст сводки зависит от него: при
       заданном стандарте «предлагаются все накладки каталога» было бы неправдой. */
    const facingChosen=[roomColl?`Серия: ${roomColl}`:null].concat(facingSpecs.filter(s=>s.cur).map(s=>`${s.label}: ${s.cur}`)).filter(Boolean);
    const facingBody=facingView==="list"
      ?standardFieldHtml+collectionFieldHtml+facingFieldsHtml
      :`<div class="room-facing-summary room-facing-standard${roomStd?" own":""}">Стандарт: ${esc(roomStd?EPCatalog.standardLabel(roomStd):"не задан")}</div>
        <div class="room-facing-summary${facingChosen.length?" own":""}">${facingChosen.length?esc(facingChosen.join(" · ")):(roomStd?"Серия, материал, форма и цвет не заданы":"Отделка не задана — предлагаются все накладки каталога")}</div>
        <button type="button" class="btn ghost room-facing-pick-btn" id="roomFramePickerBtn">Подобрать накладку</button>`;
    const facingBlockHtml=`<div class="room-facing-block">
      <div class="room-facing-head"><span class="room-facing-title">Отделка накладки</span>
        <div class="room-facing-view" role="group" aria-label="Вид выбора отделки">
          <button type="button" id="roomFacingViewList" class="room-facing-view-btn${facingView==="list"?" active":""}" aria-pressed="${facingView==="list"}">Списком</button>
          <button type="button" id="roomFacingViewPictures" class="room-facing-view-btn${facingView==="pictures"?" active":""}" aria-pressed="${facingView==="pictures"}">С картинками</button>
        </div>
      </div>
      ${facingBody}
    </div>`;
    props.innerHTML=`<label>Название комнаты<input id="roomName" value="${esc(r.name)}" autocomplete="off"></label>
    <label>Площадь<input id="roomArea" value="${esc(r.area||"")}" placeholder="${esc(autoArea||"Например, 18,6 м²")}" autocomplete="off"></label>
    <small class="prop-hint">${esc(areaHint)}${r.area?.trim()?" · сейчас показано ручное значение":""}</small>
    ${isPoly?`<div class="prop-hint-row"><span>Вершин контура: <b>${r.polygon.length}</b>${r.edited?" · контур правился вручную":""}</span>
      <button class="link-btn" id="editRoomPolygon">Править контур</button></div>`:""}
    <div class="room-equipment-box"><div class="room-equipment-head"><span>Оборудование комнаты</span><b>${roomObjects.length}</b></div>
      ${roomObjects.length?roomObjects.map(o=>`<div class="room-equipment-row"><span>${esc(o.name)}</span><small>${o.kind==="post"?"Пост":"Элемент"}</small></div>`).join(""):'<div class="room-equipment-empty">В этой комнате пока нет оборудования</div>'}
    </div>
    <div class="property-save-state" id="roomSaveState">Сохраняется автоматически при выходе из поля</div>
    <label class="room-scheme-field">Схема электрики<select id="roomSchemeSelect">${schemeOptions}</select></label>
    <small class="prop-hint prop-scheme-source${ownScheme?" own":""}">${ownScheme?"Своя схема комнаты":`Унаследована от проекта: ${esc(projSchemeItem?projSchemeItem.label:projScheme)}`}</small>
    ${curSchemeItem&&curSchemeItem.note?`<small class="prop-hint prop-scheme-note">${esc(curSchemeItem.note)}</small>`:""}
    ${facingBlockHtml}`;
    mountedRoomId=r.id;   /* этим полям принадлежит комната r — flushRoomDraft коммитит именно в неё */
    /* Владелец подтвердил автосохранение 03.09: кнопки «Сохранить изменения» больше нет.
       Blur, Enter и любая перерисовка панели сходятся в ОДИН flushRoomDraft — второго правила
       нормализации имени/площади и безусловного persistProject здесь не держим. */
    const commitRoomFields=()=>{
      flushRoomDraft();
      $("roomSaveState").textContent="Изменения сохранены";
    };
    const editPolygonBtn=$("editRoomPolygon");
    if(editPolygonBtn)editPolygonBtn.onclick=()=>setTool("vertex");
    ["roomName","roomArea"].forEach(field=>{
      $(field).onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();commitRoomFields()}};
      $(field).onblur=commitRoomFields;
    });
    /* Схема электрики применяется СРАЗУ по change (как тип стены поста и высота элемента), а не
       через черновик имени/площади: у неё свой орган и своё немедленное действие. «Как в проекте»
       (value="") СНИМАЕТ поле — так комната возвращается к наследованию, а не запоминает текущую
       схему проекта как свою (иначе смена настройки проекта её бы уже не двигала). Перерисовку
       зовём из обработчика по действию человека (инвариант beginPress не нарушается — он про тело
       renderProperties). Расчёт групп света здесь НЕ трогаем (часть 3) — только хранение и вид. */
    /* Коллекция накладок применяется СРАЗУ по change (свой орган, как схема и тип стены).
       «Не задана» (value="") СНИМАЕТ поле — комната возвращается к «предлагать все накладки».
       ⚠️ КОЛЛЕКЦИЯ — НЕ ДЕНЕЖНАЯ НАСТРОЙКА: это фильтр КАТАЛОГА в конструкторе, состав и цена
       существующих постов от неё не зависят (смета считает по товарам постов, коллекция в
       estimate.js не входит). Поэтому renderSummary/renderAll здесь НЕ нужны — сумма и
       спецификация не меняются; перерисовываем только карточку комнаты (обновить подпись
       «задана/не задана») и сохраняем. Так E13 не повторяет шесть закрытых входов «сумма
       поменялась молча»: она вообще ничего в деньгах и составе не двигает. */
    /* Переключатель вида отделки (списком / с картинками) — привычка человека: пишем в EPPrefs, а
       НЕ в проект, и перерисовываем карточку (тело блока меняется), без persistProject — проект от
       вида не зависит. Кнопка мастера открывает шаговый выбор для ЭТОЙ комнаты (r). Обе кнопки есть
       в любом виде, поэтому вешаем их до ветки «Списком». */
    const bindFacingView=(id,view)=>{const b=$(id);if(b)b.onclick=()=>{EPPrefs.set("frameFacingView",view);renderProperties();};};
    bindFacingView("roomFacingViewList","list");
    bindFacingView("roomFacingViewPictures","pictures");
    const framePickBtn=$("roomFramePickerBtn");
    if(framePickBtn)framePickBtn.onclick=()=>openFramePicker(r);
    /* Селекторы коллекции и отделки существуют ТОЛЬКО в виде «Списком» — в виде «С картинками» их в
       разметке нет, обработчики на несуществующие узлы вешать нельзя (в браузере $() вернёт null). */
    if(facingView==="list"){
      /* Стандарт монтажа применяется СРАЗУ по change — как коллекция и по той же причине НЕ денежный:
         сужает только каталог конструктора, состав и цену существующих постов не трогает (в estimate.js
         стандарт не входит). Поэтому renderSummary/renderAll не нужны — только перерисовать карточку
         (обновить подпись «задан/не задан» и сводку) и сохранить. «Не задан» (value="") СНИМАЕТ поле. */
      $("roomStandardSelect").onchange=e=>{
        const val=e.target.value;
        if(val)r.standard=val; else delete r.standard;
        renderProperties();persistProject();
      };
      $("roomCollectionSelect").onchange=e=>{
        const val=e.target.value;
        if(val)r.collection=val; else delete r.collection;
        renderProperties();persistProject();
      };
      /* Отделка накладки (E14) применяется СРАЗУ по change — как коллекция и по той же причине НЕ
         денежная: сужает только каталог конструктора, состав и цену существующих постов не трогает
         (в estimate.js отделка не входит). Поэтому renderSummary/renderAll не нужны — только
         перерисовать карточку комнаты (обновить подпись «задан/не задан») и сохранить. «Не задан»
         (value="") СНИМАЕТ поле. Один обработчик на три селектора — правило хранения в одной точке. */
      facingSpecs.forEach(spec=>{
        $("room_"+spec.prop+"Select").onchange=e=>{
          const val=e.target.value;
          if(val)r[spec.prop]=val; else delete r[spec.prop];
          renderProperties();persistProject();
        };
      });
    }
    $("roomSchemeSelect").onchange=e=>{
      const val=e.target.value;
      if(val)r.lightingScheme=val; else delete r.lightingScheme;
      /* ⚠️ СХЕМА КОМНАТЫ — ДЕНЕЖНАЯ НАСТРОЙКА (часть 3: расчёт групп света идёт по комнатам).
         renderSummary обязателен: #grandTotal/#specList/#lightingSummary/#outsideRoomsStatus
         пишутся ТОЛЬКО в нём,
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
/* ЕДИНОЕ ОПРЕДЕЛЕНИЕ «МЕСТО УПРАВЛЕНИЯ» (§7.1). Клавиша (накладка на голый механизм, partRole="key")
   ИЛИ ЦЕЛЬНОЕ изделие с ролью управления светом — клавиша и механизм в одном артикуле (09001), у
   него нет partRole, а controlRole одна из ролей группы света (switch/changeover/inverter/button, те
   же строки, что EPLightingGroups.ROLES). Возвращает "key" | "integrated" | null. Голый механизм,
   розетка, датчик движения (controlRole="sensor") и Bluetooth (controlRole="bluetooth") местами
   управления НЕ являются: они не встают в проходную и не заменяются по числу мест (вопрос владельцу —
   см. отчёт). Все, кому нужно «есть ли здесь место / поле группы», спрашивают ЭТУ функцию, а не
   заводят второй предикат: и чтение поста, и миграция старых проектов, и подбор механизма — один
   источник. Однострочная стрелка НЕ случайно: поведенческие тесты вырезают её из app.js по одной. */
const controlPlaceKind=item=>!item?null:item.partRole==="key"?"key":(!item.partRole&&(item.controlRole==="switch"||item.controlRole==="changeover"||item.controlRole==="inverter"||item.controlRole==="button")?"integrated":null);
const isKeyProduct=item=>controlPlaceKind(item)==="key";
const isControlPlaceItem=item=>controlPlaceKind(item)!==null;
const isBareMechanism=item=>!!item&&item.partRole==="bare_mechanism";
/* Место ли управления механизм с таким артикулом — ОДИН предикат на все правки слотов (чтение поста,
   замена механизма, миграция старых проектов). Ответ ТРЁХЗНАЧНЫЙ, как того требует
   EPBuilderSlots.keepsGroup: true — место управления (клавиша ИЛИ цельное изделие), false — товар в
   каталоге есть и местом не является, null — товара в каталоге НЕТ. Третий ответ не равен второму:
   артикул мог выпасть из прайса, и снимать по этому поводу группу нельзя — это стёрло бы настоящее
   место управления, которое расчёт обязан показать пробелом «потерянная клавиша» (EPLightingPlan.collect). */
const keySlotKind=id=>{const item=product(id);return item?isControlPlaceItem(item):null};
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
  const places=EPLightingPlan.collect(posts,{product,seriesOf:productSeries,controlKind:controlPlaceKind});
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
  /* Зависимости строгого подбора ЗАМЕНЫ цельного изделия — читалки атрибутов каталога. Цвет
     сравниваем ТЕМ ЖЕ facingColorKey, что и отбор начинки под цвет комнаты (§7.1), модульность —
     тем же mechanismSpan, что раскладка поста; серия/семья — как у отбора товара. */
  const replacementDeps={
    seriesOf:productSeries,spanOf:mechanismSpan,
    colorKeyOf:item=>item&&item.elementColor?EPCatalog.facingColorKey(item.elementColor):null,
    fgOf:item=>(item&&item.functionalGroup)||null,fsgOf:item=>(item&&item.functionalSubgroup)||null
  };
  const planDeps={
    seriesOf:productSeries,
    /* Один подбор на две ветки: клавише — ГОЛЫЙ механизм за ней (resolveMechanism), цельному изделию —
       ЗАМЕНА его артикула изделием нужной роли (resolveReplacement). Роль (число мест) считает общий
       расчёт и передаёт её сюда — второй копии правила ролей нет. Неоднозначность обеих веток копим
       единообразно (роль+серия в ключе), интерфейс покажет кандидатов человеку — см. ambiguityHtml. */
    findMechanism:({role,series,kind,source})=>{
      if(kind==="integrated"){
        const rep=EPLightingPlan.resolveReplacement({role,source},mechs,replacementDeps);
        if(rep.ambiguous)ambiguous.set("i|"+(source&&source.id)+"|"+role,{role,series:productSeries(source),candidates:rep.candidates});
        return rep.product;
      }
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
/* СТРОКА «ПОДСВЕТКА КЛАВИШ» — ОДНА ФОРМУЛИРОВКА НА ВСЕ ЭКРАНЫ (панель «Состав поста»
   конструктора, карточка размещённого поста и подсказка на плане).
   ⚠️ СОСТАВ ОБЯЗАН ОБЪЯСНЯТЬ ЦЕНУ. LED вставлен в механизм и входит в цену поста (postCost по
   comp.backlight.items), а «Стоимость поста» на этих трёх экранах её показывает, — значит строки
   подсветки обязаны быть рядом, ровно как суппорт/коробка/группы света. Молча показанная цена «за
   четыре», когда на экране только три позиции, — тот же дефект «три механизма, а денег на четыре».
   Одинаковые LED сводим количеством («2 × …»), цену показываем ЗА ШТУКУ — как у суппорта и коробки
   в том же составе (там тоже «N × имя · цена за единицу»). Пробел (механизм подсветку принимает, а
   совместимой в каталоге нет) называем СЛОВАМИ — «подсветка не подобрана», дословно как в смете и
   остальных документах; в цену пробел не входит (postCost его не считает).
   back — comp.backlight. Выключена/не подобрана → items и gaps пусты → null: строки нет, экран байт
   в байт как раньше. У старого рукотворного состава вне приложения поля backlight может не быть
   (тот же защитный приём, что в смете и своде) → тоже null. */
function backlightRowSummary(back){
  if(!back||(!back.items.length&&!back.gaps.length))return null;
  /* аккумулируем одинаковые LED по артикулу: у одной настройки цвет+напряжение дают один и тот же
     аксессуар на однотипные механизмы — «2 × имя», а не две строки; цена у них одна (за штуку). */
  const agg=new Map();
  back.items.forEach(u=>{
    const a=u.accessory,k=a.code||a.name;
    const cur=agg.get(k)||{name:a.name,price:Number(a.price)||0,count:0};
    cur.count++;agg.set(k,cur);
  });
  const parts=[...agg.values()].map(g=>`${g.count>1?g.count+" × ":""}${g.name} · ${money(g.price)}`);
  const gaps=back.gaps.length;
  if(gaps)parts.push(gaps>1?`${gaps} × подсветка не подобрана`:"подсветка не подобрана");
  return {parts,text:parts.join(", "),gaps,count:back.items.length};
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
   уже на руках (конструктор, смета); остальные берут проектный (projectLighting).
   ⚠️ postCost — по ЭФФЕКТИВНЫМ механизмам (замена цельного изделия 09001→09005 приходит через
   mechanismIds, а не отдельной строкой): ровно как строка сметы (EPEstimate.build), иначе панель
   свойств и подсказка на плане показали бы цену исходного изделия, а смета — замены. Правило «что
   подменяется» — одно (EPEstimate.effectiveMechanismIds); postPrice сам не берёт цельные в отдельные. */
function postTotalCost(post,light){
  const rows=lightingRowsFor(post,light===undefined?projectLighting():light);
  const effIds=EPEstimate.effectiveMechanismIds(post.mechanismIds,rows);
  return EPEstimate.postPrice(postCost(Object.assign({},post,{mechanismIds:effIds})),rows);
}
/* Неоднозначный подбор: в серии клавиши на нужную роль нашлось НЕСКОЛЬКО голых механизмов, и
   разобрать их данными нечем. Молча выбрать один нельзя — это деньги и монтаж, поэтому
   показываем кандидатов человеку отдельным блоком (в расчёт такое место не попадает). */
function ambiguityHtml(light,options){
  const list=(light&&light.ambiguous)||[];
  if(!list.length)return"";
  return `<div style="margin:10px 0;padding:9px 11px;border:1px solid #f0d8c2;border-radius:10px;background:#fdf6ee;font-family:Arial,sans-serif;font-size:10px;color:#8a5a2f">`
    +`<b>Подбор механизма неоднозначен — выбор за проектировщиком</b>`
    +list.map(a=>`<div style="margin-top:4px">Роль «${esc(a.role)}», серия ${esc(a.series.join(", "))}: `
      +esc(a.candidates.map(c=>options?.articles===false?EPOfferOptions.itemText(c.name,false,c.code):`${c.code||"без артикула"} — ${c.name}`).join("; "))+`</div>`).join("")
    +`</div>`;
}
/* Один блок «Группы света» на все документы и на панель проекта — по правилу «два документа об
   одном проекте не могут противоречить». Вёрстку собирает чистый EPLightingPlan.buildHtml,
   формулировки причин — из EPLightingGroups.GAP_TEXTS; своего словаря здесь нет намеренно. */
function lightingHtml(light,title,options){
  if(!light)return"";
  return EPLightingPlan.buildHtml(light.plan,{esc,money,title:title||"Группы света",total:options?.prices===false?0:lightingSum(light)})
    +ambiguityHtml(light,options);
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
/* Явное предупреждение «часть объектов вне помещений» в строке статуса ПОД ПЛАНОМ.
   ЗАЧЕМ отдельной строкой, а не только суффиксом «· Без помещения» у групп: тот суффикс
   виден, лишь когда осиротевший пост участвует в группе света; розетка или пост без групп
   его не покажут — а пост без комнаты теперь считается по схеме проекта, а не по своей, и
   это деньги. Строку пишем ТОЛЬКО в #outsideRoomsStatus (renderSummary), не внутрь
   lightingHtml — иначе она уехала бы и в КП/лист монтажника. #status не используем: туда
   updateStatus пишет подсказки инструментов, и два независимых сообщения затирали бы друг друга.
   Показываем, лишь когда комнаты в проекте есть и кто-то реально выпал. */
function orphanObjectsWarningText(){
  /* Счёт идёт через ЕДИНЫЙ критерий EPRoomAssign.isOutsideRooms (§7.1) — тот же, что метит
     иконки на плане (compactIcon/syncNoRoomClass). Собственного условия у счётчика быть не должно:
     со своей проверкой без учёта числа комнат на плане без единой комнаты метки нет, а счётчик
     насчитал бы всё подряд и написал «отмечены на плане» — экран противоречил бы тексту.
     isOutsideRooms сам гасит случай «комнат нет» (roomCount>0), отдельный guard тут не нужен. */
  const rc=state.rooms.length;
  const posts=state.posts.filter(p=>EPRoomAssign.isOutsideRooms(p.roomId,rc)).length;
  const devices=state.devices.filter(d=>EPRoomAssign.isOutsideRooms(d.roomId,rc)).length;
  const total=posts+devices;
  if(!total)return "";
  /* «Отмечены на плане» относится ко ВСЕМ выпавшим объектам: метку no-room получают и посты, и
     устройства, поэтому общий счётчик обязан совпасть с числом колец на плане. А денежную оговорку
     «считается по схеме проекта» пишем ТОЛЬКО про посты и только когда выпал хоть один: roomId
     устройства не участвует ни в одном денежном пути (проверено по estimate/offerPdf/installSheet —
     привязка к комнате есть лишь у поста), поэтому розетки вне комнат смету не меняют и ложной
     денежной тревоги поднимать не должны. */
  const money=posts?` Из них постов: ${posts} — их схема электрики считается по проекту.`:"";
  return `⚠ Вне помещений: ${total} — отмечены на плане.${money} `
    +`Перетащите объект в комнату или подвиньте контур.`;
}
/* Строки спецификации текущей отрисовки — чтобы делегированный обработчик поля «скидка, %» нашёл
   объекты строки (g.members) по индексу поля (data-disc-row). Держит их оркестратор: сами объекты
   в разметку не положишь. */
let _specGroups=[];
function renderSummary(){
  const light=projectLighting();
  const est=buildEstimate(light);
  $("equipmentTotal").textContent=money(est.equipment);$("materialsTotal").textContent=money(est.materials);
  $("workTotal").textContent=money(est.work);$("grandTotal").textContent=money(est.total);
  /* скидка и НДС показываются, только когда заданы — чтобы не мозолить нулями */
  $("discountRow").hidden=!est.discount;
  /* Подпись строки скидки в панели — ТА ЖЕ, что в КП: одна функция EPEstimate.discountLabel (§7.1),
     второй копии текста нет. При смеси она сама пояснит «(общая N%, у отмеченных позиций своя)».
     Подпись идёт в <span> (#discountLabel), сумма «−X €» — в #discountTotal, без «(N%)»: процент
     теперь живёт в подписи, иначе он задвоился бы (решение владельца, бывший «общий % всегда» отменён). */
  $("discountLabel").textContent=EPEstimate.discountLabel(est.discountMixed,est.discountPercent);
  $("discountTotal").textContent="−"+money(est.discount);
  /* Строка НДС в панели стоит там же, где в КП (§7.1, одинаково в панели и в документе):
     «Начислить сверху» — НДС это слагаемое, идёт ДО «Итого» (#vatRow), и столбец сходится в сумму;
     «Выделить в стоимости» — НДС уже внутри итога, поэтому «в т.ч. НДС» идёт ПОД «Итого»
     (#vatIncludedRow): в столбце слагаемых он ломал бы видимую сумму (equipment+work+…≠итог).
     Подпись (est.vatLabel) и сумма — из расчёта; видима всегда ровно одна строка (est.vatIncluded),
     обе гейтятся по est.vat, «Не учитывать» прячет обе. */
  const vatOnTop=est.vat&&!est.vatIncluded, vatInside=est.vat&&est.vatIncluded;
  $("vatRow").hidden=!vatOnTop;
  $("vatRowLabel").textContent=est.vatLabel;
  $("vatTotal").textContent=money(est.vat)+` (${est.vatPercent}%)`;
  $("vatIncludedRow").hidden=!vatInside;
  $("vatIncludedLabel").textContent=est.vatLabel;
  $("vatIncludedTotal").textContent=money(est.vat)+` (${est.vatPercent}%)`;
  $("objectCount").textContent=state.devices.length+state.posts.length;
  /* У каждой строки — своё поле «скидка, %» (А2). Пусто → действует общая (её процент в
     placeholder), число → личная скидка (0 — «без скидки»). Скидка хранится НА ОБЪЕКТАХ строки
     (post.discount/device.discount), поэтому значение поля берём из g.discount — сырой своей
     скидки строки (undefined = нет своей, поле пустое; 0 — валидное «своя 0%»). g.members —
     сами объекты строки, поле правит их ЦЕЛИКОМ (см. onSpecDiscountChange). _specGroups держит
     строки текущей отрисовки, чтобы обработчик по индексу поля нашёл нужные members. */
  _specGroups=est.groups;
  $("specList").innerHTML=est.groups.length
    ?est.groups.map((g,i)=>{
      const val=(g.discount!=null&&g.discount!=="")?esc(g.discount):"";
      return `<div class="spec-item"><div><strong>${esc(g.name)}</strong><span>${g.count} ${esc(g.unit)}</span></div><b>${money(g.sum)}</b>`
        +`<label class="spec-disc" title="Своя скидка на позицию. Пусто — действует общая скидка ${est.discountPercent}%">`
        +`<input type="number" min="0" max="100" step="1" inputmode="numeric" data-disc-row="${i}" value="${val}" placeholder="${est.discountPercent}"><span>%</span></label></div>`;
    }).join("")
    :'<div class="library-empty">Проект пока пуст</div>';
  /* Тот же блок, что печатается в КП и листе монтажника: подставленные механизмы, потребность
     в импульсных реле и пробелы с их причинами. */
  $("lightingSummary").innerHTML=lightingHtml(light,"Группы света");
  /* Позиции без цены (артикул пропал из прайса) — итог обязан их НАЗВАТЬ, а не тихо просуммировать
     остальное: est.missing собирает такие позиции по всему проекту (EPEstimate.build), их цена в
     сумму вошла нулём. Пишем постоянную строку под «Итого» (тост при экспорте гаснет и человек его
     пропустит), формулировка — про неполноту итога. */
  const pricelessNode=$("pricelessStatus");
  if(pricelessNode){
    /* Формулировка и условие «когда показывать» — в EPEstimate.pricelessNote, ОТТУДА же их
       берёт печатный КП (offerPdf): второй копии текста нет, экран и бумага не разойдутся. */
    const note=EPEstimate.pricelessNote(est);
    pricelessNode.textContent=note;
    pricelessNode.hidden=!note;
  }
  const outsideRoomsStatus=orphanObjectsWarningText();
  $("outsideRoomsStatus").textContent=outsideRoomsStatus;
  $("outsideRoomsStatus").hidden=!outsideRoomsStatus;
  updateStatus();
}

/* Селектор схемы электрики: список строится ИЗ EPLightingGroups.SCHEMES, включая «Звонковые
   кнопки» с их пояснением (кнопка на каждом месте, как в «Реле», но реле не считаются). Второй
   копии названий и пояснений у интерфейса нет намеренно — она разошлась бы с расчётом. Суффикс
   « — расчёт недоступен» остаётся под возможную будущую схему с supported=false; у всех трёх
   штатных схем он не показывается.
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
/* Подсветка клавиш ПРОЕКТА — галочка «считать» плюс цвет и напряжение. Варианты цвета и
   напряжения строим ИЗ КАТАЛОГА (аксессуары-LED с askBacklight), а НЕ хардкодом в разметке:
   матчинг в EPPostFit строгий (===), и «Зеленая» без ё молча дала бы null. Напряжение несёт
   семейство артикула — читаем его тем же EPPostFit.backlightVoltage, что и подбор, чтобы
   селектор и расчёт не разошлись. Порядок опций — как товары идут в каталоге (детерминирован).
   Доступность селекторов при выключенной галочке ведёт ЭТА функция (одна точка синхронизации):
   выключено → цвет/напряжение недоступны, чтобы человек не крутил настройку, которая ни на что
   не влияет. */
function backlightCatalogOptions(){
  const colors=[],volts=[];
  byKind("accessory").forEach(a=>{
    if(!a||!a.askBacklight)return;
    if(a.backlightColor&&!colors.includes(a.backlightColor))colors.push(a.backlightColor);
    const v=EPPostFit.backlightVoltage(a.code);
    if(v&&!volts.includes(v))volts.push(v);
  });
  return {colors,volts};
}
function renderProjectBacklight(){
  const setting=EP_DATA.settings.backlight||{enabled:false};
  const enabled=!!setting.enabled;
  const chk=$("backlightEnabled");
  if(chk)chk.checked=enabled;
  const {colors,volts}=backlightCatalogOptions();
  const fill=(sel,values,current)=>{
    if(!sel)return;
    sel.innerHTML=values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("");
    /* Присвоение value отсутствующей опции снимает выбор ("") — сохранённый проект с цветом,
       которого в каталоге уже нет, честно покажет пусто, а не подставит соседний. */
    if(current!=null)sel.value=current;
    /* Селектор недоступен, пока подсветка выключена: настройка ни на что не влияет. */
    sel.disabled=!enabled;
  };
  fill($("backlightColorSelect"),colors,setting.color);
  fill($("backlightVoltageSelect"),volts,setting.voltage);
}
/* «Предпочесть своё»: сначала выбираем накладку из пула, ДОУЖЕННОГО признаками образца (то, чего
   комната не сузила, терять незачем), и лишь если такой нет — из всего пула. ЕДИНЫЙ приём (§7.1)
   для defaultFrameForRoom (пере-подбор нетронутого поста сохраняет серию/цвет/стандарт текущей
   накладки) и frameForRoomPlacement (сохраняет серию/цвет поста). Критерии образца у них разные —
   их задаёт вызывающий; общий тут порядок «своё → пул». pick — как выбрать из подпула. */
function preferOwnFrame(pool,ownCriteria,pick){
  return pick(EPCatalog.productsForRoom(pool,ownCriteria))||pick(pool);
}

/* Названия коллекций (серий) накладок каталога — из товаров, не константой в разметке.
   Один источник и для селектора «Коллекция комнаты», и для валидации room.collection. */
function frameCollectionList(){return EPCatalog.productCollections(byKind("frame"));}
/* Различные значения одного признака отделки накладки (E14) — из товаров, не константой в разметке.
   Один источник и для селекторов «Материал/Форма/Цвет накладки» в свойствах комнаты, и для валидации
   room.<признак> (EPRoom.roomFrameFacing). field — frameMaterial|frameShape|frameColor. */
function frameFacingList(field){return EPCatalog.productFacingValues(byKind("frame"),field);}
/* Селектируемые монтажные стандарты каталога (итальянский/немецкий) — из товаров, не константой в
   разметке. Один источник и для селектора «Стандарт монтажа» в свойствах комнаты, и для шага мастера,
   и для валидации room.standard (EPRoom.roomFrameFacing). Универсальные накладки (standard="BOTH")
   вариантом не приходят — раскрытие BOTH→{IT,DE} держит EPCatalog.productStandards. */
function frameStandardList(){return EPCatalog.productStandards(byKind("frame"));}
/* Критерий отбора накладок под ПРОИЗВОЛЬНУЮ комнату (E13 коллекция + E14 отделка) — ОДНА точка
   сборки (§7.1). Через неё ходят и конструктор (builderRoomFilter, комната редактируемого поста), и
   подмена накладки при размещении готового поста (frameForRoomPlacement, комната размещения). Валидация
   мёртвых (снятых из прайса) значений — в EPRoom: null → признак не сужает. */
function roomCatalogFilter(room){
  return {
    /* Монтажный стандарт — такой же критерий комнаты, как коллекция и отделка, и сужает пул ТЕМ ЖЕ
       productsForRoom (§7.1). Валидируется как отделка: мёртвое/отсутствующее значение → null → не
       сужает (старый проект без room.standard открывается как раньше — весь каталог). */
    standard:EPRoom.roomFrameFacing(room,"standard",frameStandardList()),
    collection:EPRoom.roomCollection(room,frameCollectionList()),
    frameMaterial:EPRoom.roomFrameFacing(room,"frameMaterial",frameFacingList("frameMaterial")),
    frameShape:EPRoom.roomFrameFacing(room,"frameShape",frameFacingList("frameShape")),
    frameColor:EPRoom.roomFrameFacing(room,"frameColor",frameFacingList("frameColor"))
  };
}
/* Подмена накладки готового поста под КОМНАТУ размещения (ОТДЕЛКА-ПОРЯДОК, п.5 + монтажный стандарт).
   Идёт ЧЕРЕЗ тот же отбор, что и весь каталог под комнату (roomCatalogFilter → productsForRoom, как
   collectionFramePool), а не через свою копию правил (§7.1). Возвращает:
     {frameId:null}          — накладку НЕ меняем: пост лёг вне комнат; у комнаты нет ни серии, ни
                               отделки, ни стандарта (иначе пул = весь каталог и мы подставили бы
                               случайную накладку); ЛИБО задан только стандарт, а накладка поста ему
                               УЖЕ соответствует — менять нечего;
     {frameId:<id>}          — нашли накладку той же модульности → пост берёт её (и цену — она из
                               frameId во всех документах);
     {blocked:true,message}  — комната сузила отбор, но накладки нужной серии/цвета/стандарта той же
                               модульности в каталоге нет: пост НЕ ставим с чужой накладкой, человеку
                               говорим чего и почему не нашли (формулировка в духе E14, frameSwapEmptyText).

   ⚠️ МОНТАЖНЫЙ СТАНДАРТ сужает пул наравне с серией и отделкой (он в criteria), НО САМ ПО СЕБЕ
   запускает подмену ТОЛЬКО когда накладка поста стандарту НЕ годится: под годную (в т.ч.
   универсальную BOTH) менять нечего, поведение прежнее. «Годится ли накладка под стандарт» решает
   ТОТ ЖЕ productsForRoom (§7.1) — накладка проходит его фильтр по стандарту ⇒ годится; второго
   сравнения стандартов в коде нет. Накладка поста не резолвится (пропала из прайса) — судить нечем,
   на одном стандарте подмену не запускаем (серия/отделка, если заданы, запустят её и дадут блокировку).

   ⚠️ ПОДМЕНА МЕНЯЕТ ТОЛЬКО ТО, ЧЕГО ТРЕБУЕТ КОМНАТА. Сначала ищем накладку ТОЙ ЖЕ серии и цвета, что
   у поста (комната их не сузила — незачем терять белый Neve Up ради первой попавшейся из пула в нужном
   стандарте), и лишь если такой нет — берём любую подходящую по нынешнему правилу. Обе выборки идут
   через ОДИН pickRoomFrame (второй копии подбора нет); предпочтение выражаем ТЕМ ЖЕ productsForRoom,
   доузив пул серией и цветом поста. Комната, задавшая свою серию/цвет, вытеснит из own накладки поста →
   own пуст → фолбэк на общий pool, то есть требование комнаты побеждает. */
function frameForRoomPlacement(template,room){
  if(!room)return {frameId:null};
  const criteria=roomCatalogFilter(room);
  const frame=frameProduct(template.frameId);
  const standardMismatch=!!(criteria.standard&&frame&&!EPCatalog.productsForRoom([frame],{standard:criteria.standard}).length);
  const constrained=criteria.collection||criteria.frameMaterial||criteria.frameShape||criteria.frameColor||standardMismatch;
  if(!constrained)return {frameId:null};
  const pool=EPCatalog.productsForRoom(byKind("frame"),criteria);
  const deps={frameProduct,frameSlotCount,frameFitsMechs:frameFitsTemplateMechs(template)};
  /* own — доужение до серии и цвета накладки поста: сохраняем то, чего комната не сужала. Через ОБЩИЙ
     preferOwnFrame (§7.1, тот же приём «своё → пул», что у defaultFrameForRoom); стандарт в own НЕ
     включаем — подмена и запускается из-за смены стандарта комнатой, его сохранять незачем. */
  const ownCriteria={collection:productSeries(frame)[0],frameColor:EPPosts.templateFrameColor(template,{frameProduct})};
  const swap=preferOwnFrame(pool,ownCriteria,p=>EPPosts.pickRoomFrame(template.frameId,p,deps));
  return swap?{frameId:swap.id}:{blocked:true,message:frameSwapEmptyText(template,room,criteria)};
}
/* Предикат «в накладку-кандидата встают ВСЕ клавиши шаблона» — ПРАВИЛОМ КОНСТРУКТОРА
   (EPCatalog.compatibleMechanisms, совместимость по серии), а НЕ своим сравнением серий (§7.1): именно
   этот набор конструктор строит в renderBuilder (mechs=compatibleMechanisms(selectedFrame,allMechanisms))
   и по нему же окно поста показывало «Занято 0 из 3», когда серия клавиш и накладки разошлись. Кандидат
   годится, только если КАЖДЫЙ механизм шаблона попал в совместимый набор этой накладки.
   Механизмы шаблона резолвим через product() (active НЕ фильтрует) и добавляем в пул сравнения — снятую
   с производства клавишу судим по серии (как keepMechs в конструкторе), а не выкидываем за отсутствие в
   активном каталоге. Пропавший из прайса артикул (product=null) серии не имеет — проверить нечем, на нём
   подмену не блокируем (его слот и так станет явным пробелом в конструкторе). Клавиш нет вовсе → накладке
   всё равно, любая подходит по размеру. */
function frameFitsTemplateMechs(template){
  const items=(Array.isArray(template.mechanismIds)?template.mechanismIds:[]).map(id=>product(id)).filter(Boolean);
  if(!items.length)return ()=>true;
  const pool=byKind("mechanism").concat(items);
  return frame=>{const compatible=compatibleMechanisms(frame,pool);return items.every(item=>compatible.includes(item));};
}
/* ОДНА формулировка «под комнату накладки, в которую встают клавиши поста, нет» при размещении готового
   поста (п.5). Параллельна frameFacingEmptyText/innardsEmptyText: называем комнату, что сузило выбор
   (frameFacingSelectionLabels — серия+отделка, тот же источник, что у хинта и мастера), модульность,
   которой не хватило, И СЕРИЮ КЛАВИШ ПОСТА. Обе причины блокировки — нет накладки нужной модульности
   в серии/цвете комнаты ИЛИ накладки есть, но клавиши поста в них не встают по серии (правило
   конструктора) — сводятся к одному честному тексту: под комнату не нашлось накладки на N модулей, в
   которую встают клавиши этого поста. Так владелец видит ОБЕ серии — комнаты (в list) и клавиш поста —
   и понимает, почему готовый пост чужой серии сюда не встал. Модульность берём у накладки шаблона
   (frameSlotCount); неизвестна (битая накладка) → moduleWord честно скажет «— модулей». Серии клавиш
   нет (пустой пост / пропавшие артикулы) → упоминание клавиш опускаем. */
function frameSwapEmptyText(template,room,criteria){
  const mods=frameSlotCount(frameProduct(template.frameId));
  const list=frameFacingSelectionLabels(criteria).join(", ");
  const mechSeries=templateMechSeries(template);
  const keys=mechSeries?`, в которую встают клавиши этого поста (серия «${mechSeries}»),`:"";
  return `Для комнаты «${room.name}» (${list}) не нашлось накладки на ${moduleWord(mods)}${keys} — готовый пост не размещён. Соберите пост для этой комнаты или добавьте подходящую накладку.`;
}
/* Серии клавиш (механизмов) шаблона — через тот же productSeries, что и у накладок (§7.1, не своя
   разборка поля series). Резолвим id через product() (active не фильтрует — снятая клавиша серию несёт),
   собираем различные серии. Нужно тексту блокировки, чтобы назвать «серию клавиш поста». Пустой пост /
   пропавшие артикулы → пустая строка. */
function templateMechSeries(template){
  const set=new Set();
  (Array.isArray(template.mechanismIds)?template.mechanismIds:[]).forEach(id=>{
    const item=product(id);if(item)productSeries(item).forEach(s=>set.add(s));
  });
  return [...set].join(", ");
}
/* Текст хинта «сколько накладок показано из скольких и ЧТО сузило выбор» (E14, п.5–6). Считается ОТ
   ТОГО ЖЕ критерия и того же productsForRoom, что фильтрует renderBuilder, — второго правила отбора
   нет (§7.1). Показываем ТОЛЬКО когда задан хотя бы один признак ОТДЕЛКИ (материал/форма/цвет):
   пустая настройка = «не сужаем» → хинта нет (коллекция E13 своё сообщение уже несёт отдельно).
   base — пул до отделки (одна коллекция комнаты), shown — пул после отделки. Пустое сочетание (под
   него накладок нет) объясняем СЛОВАМИ, а не пустым списком. Значения приходят каноничными из
   каталога → в textContent без esc (не в HTML). */
/* Человеческие подписи активных признаков отделки комнаты — ОДИН источник формулировки «что сузило
   выбор» для хинта и для пустого контекста поиска (§7.1: не размножать текст по потребителям).
   filter — результат builderRoomFilter. Пустой массив, если отделка не задана. */
function frameFacingLabels(filter){
  const parts=[];
  if(filter.frameMaterial)parts.push(`материал «${filter.frameMaterial}»`);
  if(filter.frameShape)parts.push(`форма «${filter.frameShape}»`);
  if(filter.frameColor)parts.push(`цвет «${filter.frameColor}»`);
  return parts;
}
/* ОДНА формулировка «под это сочетание накладок нет» (E14) на всех потребителей: хинт конструктора
   и шаговый мастер отделки. §7.1 п.2: текст в одной точке, второй копии не заводим — иначе виды
   разошлись бы в объяснении одного и того же пустого пула. list — человеческие подписи «что сузило». */
function frameFacingEmptyText(list,extra){
  /* list — ВСЕ заданные условия комнаты (стандарт/серия/отделка), поэтому формулировка общая:
     «условия», а не «отделка». Анализа «какой именно критерий виноват» не даём (п.5) — честно
     перечисляем всё, чем сузили, и направляем в свойства комнаты. extra — необязательная добавка к
     совету (у окна поста есть свой выход — «открыть пост в другой комнате», которого нет у хинта и
     мастера); по умолчанию пусто, поэтому текст хинта и мастера НЕ меняется (§7.1: одна формулировка). */
  return `Под выбранные условия (${list}) в каталоге накладок нет — измените отбор в свойствах комнаты${extra||""}.`;
}
/* ОДНА формулировка «под цвет комнаты начинки того же цвета нет» (ОТДЕЛКА-ПОРЯДОК, п.5). Параллельна
   frameFacingEmptyText, но про НАЧИНКУ и с выходом через галочку: у большинства декоративных цветов
   накладок (замер: 12 из 181) начинки того же цвета в каталоге не бывает — это законный пустой отбор.
   Достижимо ТОЛЬКО когда галочка ограничения включена, поэтому выход — СНЯТЬ её. color — цвет
   накладки комнаты, которым сузили. */
function innardsEmptyText(color){
  return `Под цвет накладки комнаты («${color}») клавиш, розеток и механизмов того же цвета в каталоге нет. Снимите галочку ограничения цвета над каталогом — тогда предложим совместимые изделия любого цвета.`;
}
/* Подписи ВСЕХ активных признаков выбора (серия + отделка) — для крошек и пустого сообщения мастера.
   Серию frameFacingLabels не несёт (её хинт конструктора показывает отдельно), поэтому добавляем
   здесь, но саму отделку берём из frameFacingLabels — не второй копией. */
function frameFacingSelectionLabels(sel){
  const parts=[];
  if(sel.standard)parts.push(`стандарт «${EPCatalog.standardLabel(sel.standard)}»`);
  if(sel.collection)parts.push(`серия «${sel.collection}»`);
  return parts.concat(frameFacingLabels(sel));
}
function frameFacingHintText(allFrames){
  const f=builderRoomFilter();
  const pool=EPCatalog.productsForRoom(allFrames,f);
  if(!pool.length){
    /* Пул ПУСТ — честно перечисляем ВСЁ, чем сузили (стандарт+серия+отделка через
       frameFacingSelectionLabels), а не только отделку: комната DE+Arke+«Бронза матовая» пуста из-за
       СТАНДАРТА (накладка есть, но итальянская), и совет «менять цвет» увёл бы не туда (п.5). Одна
       формулировка (frameFacingEmptyText) на хинт и мастер отделки (§7.1). */
    const all=frameFacingSelectionLabels(f);
    return all.length?frameFacingEmptyText(all.join(", ")):"";
  }
  /* Непустой пул: «показано из скольких» — про ОТДЕЛКУ (E14). Отделка не задана → хинта нет
     (коллекция E13 своё сообщение несёт отдельно). */
  const parts=frameFacingLabels(f);
  if(!parts.length)return "";
  const base=EPCatalog.productsForRoom(allFrames,{collection:f.collection}).length;
  return `Показано ${pool.length} из ${base} ${EPCatalog.pluralRu(base,"накладки","накладок","накладок")} · сузили: ${parts.join(", ")}`;
}
/* Выбранный ЧЕЛОВЕКОМ вид выбора отделки (списком / с картинками). Это привычка, а НЕ свойство
   проекта — хранится в EPPrefs (ep_prefs), чтобы чужой проект вид не переключал. Нераспознанное
   значение откатываем на «списком»: он же поведение до появления второго вида. */
function frameFacingView(){
  return EPPrefs.get("frameFacingView","list")==="pictures"?"pictures":"list";
}

/* ---- Шаговый выбор отделки накладки (вид «С картинками») -------------------------------------
   Второй ВИД поверх готового отбора E13/E14, а не второе правило (§7.1). Мастер читает те же поля
   комнаты (collection/frameMaterial/frameShape/frameColor), пишет их же на «Применить», а «сколько
   накладок за вариантом» считает ЧЕРЕЗ EPCatalog.productsForRoom — тот же отбор, что фильтрует
   конструктор. Черновик выбора живёт в модульных переменных, в проект попадает только по «Применить».
   deps подставляют каталожные функции чистому EPFramePicker (своего фильтра/списка/счётчика у него
   нет). valuesOf различает стандарт (productStandards — BOTH раскрывается в оба варианта), серию
   (productCollections — серия у товара массив) и отделку (productFacingValues — скаляр). */
let framePickerRoomId=null,framePickerSel=null,framePickerStep=0;
const framePickerDeps={
  match:(frames,criteria)=>EPCatalog.productsForRoom(frames,criteria),
  valuesOf:(pool,prop)=>prop==="standard"?EPCatalog.productStandards(pool):prop==="collection"?EPCatalog.productCollections(pool):EPCatalog.productFacingValues(pool,prop),
  imageOf:item=>productImage(item)
};
/* Подпись значения шага ЧЕЛОВЕКУ: стандарт показываем словом (EPCatalog.standardLabel — единственный
   перевод "IT"/"DE" в «итальянский»/«немецкий»), остальные признаки уже человеческие (серия, материал,
   форма, цвет каноничны из каталога). Хранимое значение (data-value, room.<prop>) остаётся кодом —
   переводим только на экран. */
function frameStepValueLabel(prop,value){return prop==="standard"?EPCatalog.standardLabel(value):value;}
function openFramePicker(room){
  framePickerRoomId=room.id;
  /* Инициализация из ТЕХ ЖЕ настроек комнаты, что читает список-вид, с ТОЙ ЖЕ валидацией мёртвых
     значений (EPRoom): убранная из прайса серия/цвет не должны прийти в мастер как выбранные. */
  const sel={};
  const std=EPRoom.roomFrameFacing(room,"standard",frameStandardList());
  if(std)sel.standard=std;
  const coll=EPRoom.roomCollection(room,frameCollectionList());
  if(coll)sel.collection=coll;
  ["frameMaterial","frameShape","frameColor"].forEach(prop=>{
    const v=EPRoom.roomFrameFacing(room,prop,frameFacingList(prop));
    if(v)sel[prop]=v;
  });
  framePickerSel=sel;
  /* Открываемся на первом НЕзаполненном шаге (продолжаем там, где человек остановился); всё задано —
     на первом, чтобы можно было пересмотреть с начала. Крошки всё равно показывают выбор целиком. */
  const firstUnset=EPFramePicker.STEPS.findIndex(s=>!sel[s.prop]);
  framePickerStep=firstUnset>=0?firstUnset:0;
  renderFramePicker();
  $("framePickerModal").classList.add("open");
  setTimeout(()=>{const b=$("framePickerBody").querySelector("button");if(b)b.focus();},0);
}
function renderFramePicker(){
  const steps=EPFramePicker.STEPS,allFrames=byKind("frame");
  /* Крошки: что уже выбрано и возврат на любой шаг (data-step). Значения каноничны из каталога, но
     через esc — они уходят в HTML. */
  $("framePickerCrumbs").innerHTML=steps.map((s,i)=>{
    const val=framePickerSel[s.prop];
    return `<button type="button" class="frame-picker-crumb${i===framePickerStep?" active":""}${val?" is-set":""}" data-step="${i}">
      <span class="frame-picker-crumb-title">${esc(s.title)}</span>
      <span class="frame-picker-crumb-value">${val?esc(frameStepValueLabel(s.prop,val)):"—"}</span>
    </button>`;
  }).join("");
  const step=steps[framePickerStep];
  const options=EPFramePicker.stepOptions(allFrames,framePickerSel,step.prop,framePickerDeps);
  const body=$("framePickerBody");
  if(options.length){
    body.innerHTML=`<div class="frame-picker-grid">`+options.map(o=>{
      const active=framePickerSel[step.prop]===o.value;
      /* Плитка с фото или, у ~40% накладок без фото, достойный фолбэк (название + счётчик + общая
         подпись «фото нет») вместо пустой дыры. Разметку и подпись даёт framePickThumb — та же
         формулировка NO_PHOTO_LABEL, что и у карточки каталога (§7.1). */
      const thumb=framePickThumb(o.imageUrl,o.value);
      return `<button type="button" class="frame-pick-tile${active?" active":""}" data-value="${esc(o.value)}" aria-pressed="${active}">
        ${thumb}
        <span class="frame-pick-name">${esc(frameStepValueLabel(step.prop,o.value))}</span>
        <span class="frame-pick-count">${o.count} ${EPCatalog.pluralRu(o.count,"накладка","накладки","накладок")}</span>
      </button>`;
    }).join("")+`</div>`;
    bindProductPictureFallbacks(body);
  }else{
    /* Пусто → базовый пул (выбор без текущего шага) не даёт накладок: пустое сочетание. Объясняем
       ТОЙ ЖЕ формулировкой E14, что и хинт конструктора (frameFacingEmptyText), плюс подсказка
       вернуться — шаг не тупик, крошки позволяют исправить выбор. */
    const base=Object.assign({},framePickerSel);delete base[step.prop];
    const labels=frameFacingSelectionLabels(base);
    body.innerHTML=`<p class="frame-picker-empty">${esc(frameFacingEmptyText(labels.join(", ")))}</p>
      <p class="frame-picker-empty-hint">Вернитесь на предыдущий шаг и измените выбор.</p>`;
  }
  $("framePickerCrumbs").querySelectorAll("[data-step]").forEach(b=>b.onclick=()=>{framePickerStep=Number(b.dataset.step);renderFramePicker();});
  body.querySelectorAll("[data-value]").forEach(b=>b.onclick=()=>pickFrameStep(b.dataset.value));
}
function pickFrameStep(value){
  const steps=EPFramePicker.STEPS,step=steps[framePickerStep];
  framePickerSel[step.prop]=value;
  /* Каскад серия→материал→форма→цвет: выбор на шаге сбрасывает НИЖЕлежащие. Тогда каждый следующий
     шаг выбирается из того, что реально осталось, и итоговое сочетание всегда непусто. */
  steps.slice(framePickerStep+1).forEach(s=>{delete framePickerSel[s.prop];});
  if(framePickerStep<steps.length-1)framePickerStep++;
  renderFramePicker();
}
function applyFramePicker(){
  /* «Применить» записывает выбор в ТЕ ЖЕ поля комнаты, что и список-вид: пустой признак СНИМАЕТ поле
     (как «Не задан» в селекторе). Отделка не денежная (в estimate.js не входит) — persistProject
     без renderSummary/renderAll, как у onchange списка. renderProperties обновит карточку и сводку. */
  const room=state.rooms.find(r=>r.id===framePickerRoomId);
  if(room){
    EPFramePicker.STEPS.forEach(s=>{
      const v=framePickerSel[s.prop];
      if(v)room[s.prop]=v; else delete room[s.prop];
    });
    persistProject();
  }
  closeFramePicker();
  renderProperties();
}
function closeFramePicker(){
  $("framePickerModal").classList.remove("open");
  framePickerRoomId=null;framePickerSel=null;framePickerStep=0;
}

/* Видимый состав поста (PLAN — задача по конструктору): суппорт, монтажная коробка
   с числом по стандарту накладки и типу стены, итоговая цена. Всё, что попадает в
   разметку, — через esc(); суммы — через money(). Стандарт/подбор считает EPPosts. */
const WALL_STEP_LABEL={solid:"кирпич / бетон / сплошная",hollow:"полая стена / ГКЛ"};
const STANDARD_LABEL={IT:"итальянский · одна коробка на сборку",IT_ROUND:"итальянский · круглая коробка",DE:"немецко-французский · коробка на каждый пост",FR:"французский 57 мм · коробка на каждый пост",US:"американский",BOTH:"универсальный · одна коробка на накладку",UNKNOWN:"не подтверждён"};
/* Родительный падеж стандарта для пояснений «нет коробки для … стандарта». */
const STANDARD_GENITIVE={IT:"итальянского",IT_ROUND:"итальянского (круглая коробка)",DE:"немецко-французского",FR:"французского 57 мм",US:"американского",BOTH:"универсального",UNKNOWN:"не подтверждённого"};
/* «Изменить в данном блоке или для всех однотипных блоков» — промис-модалка охвата правки типа
   стены вынесена в js/wallScope.js (И1, разбиение app.js): там текст вопроса, состояние «висящего»
   промиса и провязка кнопок #wallScopeModal. Здесь — тонкое подключение. Экземпляр один на страницу;
   создаём ЛЕНИВО при первом обращении, чтобы эта связка не выполняла EPWallScope.create в момент
   загрузки — её текст попадает в вырезку соседней функции у поведенческого стенда, а тот исполняет
   функции app.js в vm без модулей (ровно поэтому прежде тут стоял «пустой» let-резолв). askWallScope/
   finishWallScope сохраняют имена — вызовы в savePostBuilder/renderProperties/обработчике Esc не меняются. */
let _wallScope=null;
function wallScope(){return _wallScope||(_wallScope=EPWallScope.create({$,WALL_STEP_LABEL}))}
function askWallScope(sameTypeCount,wall){return wallScope().askWallScope(sameTypeCount,wall)}
function finishWallScope(scope){return wallScope().finishWallScope(scope)}


/* В19: связь между кликом по иконке стоящего поста и последующим двойным кликом.
   _placeOnPostIcon — id поста, по чьей иконке пришёлся ТЕКУЩИЙ клик размещения (ставит compactIcon,
   читает и сразу гасит addPending в том же цикле события). _lastIconPlacement — постановка, которую
   такой клик породил: {newId,overId,t}; по ней openPostOnDblClick понимает, что новый пост надо
   откатить и открыть старый. Храним в переменных модуля, а НЕ полем на посте: маркер не должен
   пережить автосохранение/перезагрузку, иначе двойной клик по восстановленному посту откатывал бы
   его. */
let _placeOnPostIcon=null;
let _lastIconPlacement=null;
function addPending(x,y){
  if(!state.pending)return;
  /* Снимаем «клик пришёлся на иконку поста» в локальную ДО любых выходов (блокировка накладки
     ниже делает return) и сбрасываем прошлую постановку: валидной её сделает только успешная
     постановка кликом по иконке. */
  const overPostIcon=_placeOnPostIcon;_placeOnPostIcon=null;_lastIconPlacement=null;
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
    /* ⚠️ НАКЛАДКА МЕНЯЕТСЯ НА СЕРИЮ КОМНАТЫ РАЗМЕЩЕНИЯ (ОТДЕЛКА-ПОРЯДОК, п.5) — ДО добавления поста
       в проект. Комнату берём ту, куда реально ложится центр поста: тот же getRoomForPoint(x,y), что
       ниже определит roomId (created.x+12===x). Подмена честно доезжает до денег: цена накладки во
       всех документах читается из frameId (postComposition), отдельной копии цены нет — меняем id,
       и смета/свод/лист монтажника/КП берут новую. Замены нет (в серии комнаты накладки нужной
       модульности не оказалось) — пост НЕ ставим с чужой накладкой, говорим человеку почему. */
    const swap=frameForRoomPlacement(t,getRoomForPoint(x,y));
    if(swap.blocked){toast(swap.message);return}
    if(swap.frameId!=null)created.frameId=swap.frameId;
    state.posts.push(created);
    /* В19: постановка пришлась на иконку СТОЯЩЕГО поста — запоминаем её, чтобы двойной клик
       (второй клик + dblclick по этому новому посту) откатил её и открыл старый. */
    if(overPostIcon!=null)_lastIconPlacement={newId:created.id,overId:overPostIcon,t:Date.now()};
  }
  updateObjectRoom(created);
  const room=state.rooms.find(r=>r.id===created.roomId);
  /* Toast обязан судить тем же правилом, что метка на плане и счётчик: без единой
     комнаты null-room — нормальное исходное состояние, а не предупреждение на каждый
     добавленный объект. Комната есть и объект остался снаружи — предупреждение нужно. */
  const outside=EPRoomAssign.isOutsideRooms(created.roomId,state.rooms.length);
  setTool("select");renderAll();renderSummary();
  if(room)toast(`Объект добавлен в комнату «${room.name}»`);
  else if(outside)toast("Объект размещён вне комнаты");
}
/* Шаг сетки теперь настройка проекта (state.gridStep), а не константа: владелец
   просил уметь менять его. Фолбэк на дефолт — для устойчивости, если поле пустое. */
function snapToGrid(v){const g=state.gridStep||EPConfig.gridDefault;return Math.round(v/g)*g}
function addWallPoint(e){
  const w=clientToWorld(e.clientX,e.clientY);
  let x=snapToGrid(w.x),y=snapToGrid(w.y);
  if(state.wallPoints.length){
    const a=state.wallPoints.at(-1);
    // ортогональность: выравниваем короткую ось, если сегмент почти горизонтальный/вертикальный
    if(Math.abs(x-a.x)<=Math.abs(y-a.y))x=a.x;else y=a.y;
  }
  const p={x,y};state.wallPoints.push(p);
  if(state.wallPoints.length>1){
    state.walls.push(makeWall(state.wallPoints.at(-2),p,false));
    /* renderSummary обязателен: новая стена-перегородка могла вывести объект из комнаты. Метку на
       плане ставит recalculateRoomAssignments, а строку «Вне помещений» — только renderSummary
       (#outsideRoomsStatus пишется ТОЛЬКО в нём). Без него кольцо на плане загорается, а счётчик
       молчит
       — экран противоречит сам себе. scheduleSave обязателен тоже: без него нарисованная стена
       живёт только в памяти и пропадает от F5, пока пользователь не запустит сохранение чем-то
       ещё. Тот же контракт, что у addRoomLinePoint (стены и линии разметки одинаково двигают
       привязку к комнате и одинаково сохраняются). */
    refreshAfterRoomAssignments(()=>{drawWalls();renderRooms()}, scheduleSave)
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
      /* В11: в размещении клик по стене её НЕ удаляет и НЕ выделяет — пропускаем событие к
         canvas.onclick, где placePendingAtEvent поставит пост в точку клика у самой стены. */
      hit.onclick=e=>{if(state.pending)return;e.stopPropagation();state.tool==="delete"?removeWall(w.id):selectWall(w.id)};
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
/* ---- Поворот подложки (Б3, ч.1): вращается ТОЛЬКО #planImage; стены/комнаты/посты живут в
   мировых координатах и не трогаются. Готовую CSS-трансформацию (rotate+вписывающий scale) считает
   чистый EPPlanRotate — ОДНО правило на экран и на документ (planLabels.js зовёт тот же расчёт).
   Вокруг чего вращаем: #planImage растянут inset:0 на весь мировой бокс холста, object-fit:contain
   центрирует картинку в нём, transform-origin по умолчанию = центр элемента = центр бокса = центр
   вписанной подложки. Бокс берём ЖИВОЙ (clientWidth/Height, без CSS-зума applyView — тот масштабирует
   весь холст разом), поэтому вызываем это и на resize окна: при смене пропорций бокса меняется
   вписывающий scale, иначе на 90° подложку обрезало бы окном. ---- */
function applyPlanRotation(){
  const img=$("planImage");if(!img)return;
  /* нормализуем в самом state: ↺/↻ и восстановление кладут уже нормализованное, но страховка
     от битого значения держит state.planRotation всегда числом в [0,360) */
  const a=EPPlanRotate.normalizeAngle(state.planRotation);state.planRotation=a==null?0:a;
  img.style.transform=EPPlanRotate.cssTransform(state.planRotation,img.naturalWidth,img.naturalHeight,canvas.clientWidth,canvas.clientHeight);
  syncRotationUi();
}
/* Поле угла отражает УГОЛ ТЕКУЩЕГО РЕЖИМА (чертёж → planRotation, весь план → worldAngle). Не
   трогаем, пока оно в фокусе: иначе переписали бы ввод под пальцами (нормализация к [0,360) —
   после потери фокуса/Enter, а не на каждый символ). */
function currentRotationAngle(){return state.rotateTarget==="world"?(state.worldAngle||0):state.planRotation}
function syncRotationUi(){
  const inp=$("planRotateInput");
  if(inp&&inp!==document.activeElement)inp.value=EPPlanRotate.formatAngle(currentRotationAngle());
}
/* ЕДИНАЯ синхронизация UI подложки по state.planLoaded (образец — updateScaleUi): что дизейплить
   и что показывать, решает ОДНО место, а не каждый потребитель своей копией. Загрузка плана,
   восстановление проекта и сброс подложки зовут его же — правило «эти органы живут, пока есть
   чертёж» физически не размножается по вызывающим (HANDOFF §7.1 п.2: на копиях правил проект
   спотыкался трижды). Кнопки трассировки/определения комнат/разметки, статус-точка «ready» и
   «Убрать план» завязаны на наличие подложки; видимость подложки дизейблит и applyPlanVisibility
   (там — под свой режим), правило одно: без плана управлять нечем. */
function updatePlanUi(){
  const loaded=!!state.planLoaded;
  ["autoTraceBtn","detectRoomsBtn","detectRoomsMlBtn","annotateBtn"].forEach(id=>{$(id).disabled=!loaded});
  $("planStatusDot").classList.toggle("ready",loaded);
  const clear=$("clearPlanBtn");if(clear)clear.hidden=!loaded;
  /* Вторая кнопка «Точно убрать план?» не переживает исчезновение подложки: нет плана — нечего
     убирать, и она не должна остаться висеть одна, когда «Убрать план» уже скрыта. Условие «плана
     нет» решает ЭТО место (§7.1: копий условия по коду не плодим), поэтому и вторую кнопку прячем
     здесь же. Взвод при этом обесточен: он привязан к planToken (см. clearPlanSubject) — сброс его
     сменил, так что даже уцелей armed, подтверждение дало бы cancel, а не удаление. */
  const clearConfirm=$("clearPlanConfirmBtn");if(clearConfirm&&!loaded)clearConfirm.hidden=true;
  const vis=$("planVisibilityBtn");if(vis)vis.disabled=!loaded;
  /* Органы поворота (Б3, ч.2а — гейт в ОДНОМ месте, §7.1 п.2). В режиме «весь план» вращать есть что
     всегда (сам холст с нарисованным) — живут и без подложки. В режиме «только чертёж» — как в части 1:
     без фона вращать нечего. Переключатель режима активен ВСЕГДА (иначе из «только чертёж» без плана
     не выбраться в «весь план»). */
  const rotEnabled=state.rotateTarget==="world"||loaded;
  ["planRotateLeftBtn","planRotateRightBtn","planRotateInput"].forEach(id=>{const e=$(id);if(e)e.disabled=!rotEnabled});
}
/* ЕДИНЫЙ предикат «подложка та же, что была в начале операции». Копий условия по коду
   быть не должно (HANDOFF §7.1 п.2). Меняет поколение только bumpPlanToken. */
function planUnchanged(token){return state.planToken===token}
function bumpPlanToken(){state.planToken=(state.planToken||0)+1}
/* Единая реакция долгой операции на смену подложки: гасим прогресс и ПРИВОДИМ кнопки к
   нынешнему состоянию через updatePlanUi (не включаем их сами — иначе всплывут при
   отсутствующем плане). Ничего не пишем в state и ничего не удаляем. true = прекратить. */
function planLostDuringOp(token){
  if(planUnchanged(token))return false;
  showTraceProgress(false);updatePlanUi();
  toast("Подложка изменилась — распознавание отменено");
  return true;
}
/* Сброс подложки (ПЛАН-В-ДОКУМЕНТЕ, часть 2). Подложка — лишь фон для обводки: убираем её и с
   холста, и из снимка проекта (persistProject увидит planLoaded=false → plan:null, см.
   projectSnapshot), не трогая ничего нарисованного — комнаты/стены/разметка/посты/масштаб живут
   в мировых координатах и от картинки не зависят. src снимаем removeAttribute, а НЕ ="": пустая
   строка резолвится браузером в URL страницы и уходит лишним запросом с onerror. planVisibility→
   "show", чтобы следующая загрузка не открылась «скрытой». Симметрично applyImportedPlan. */
function clearPlan(){
  const img=$("planImage");if(img)img.removeAttribute("src");
  bumpPlanToken();   /* подложка сменилась — идущие распознавания должны прекратиться */
  state.planLoaded=false;state.planLabel="";state.planVisibility="show";state.planRotation=0;
  clearAnnotations();
  updatePlanUi();applyPlanVisibility();applyPlanRotation();
  persistProject();
  updateStatus("План убран");toast("План убран");
}

/* ПОДТВЕРЖДЕНИЕ СБРОСА ПОДЛОЖКИ — ДВА ОРГАНА УПРАВЛЕНИЯ (тот же EPConfirmRepeat, образец —
   перенумерация постов). clearPlan необратим: undo в приложении нет, а persistProject внутри него
   сразу затирает картинку в снимке localStorage — растр выбранной страницы PDF больше нигде не
   хранится. Кнопка «Убрать план» лежит вплотную к «Определить комнаты», промах стоит дорого.
   Подтверждать повтором того же нажатия здесь неуместно (место под вторую кнопку в панели есть):
   любая граница по времени поток срабатываний лишь ЗАДЕРЖИВАЕТ — нетерпеливые клики и зажатый
   Enter рано или поздно попадут в окно и удалят план за человека. Осознанность даёт ДРУГОЙ ЖЕСТ:
   «Убрать план» только задаёт вопрос (via:"arm" не удаляет НИКОГДА), удаляет отдельная кнопка
   «Точно убрать план?» (via:"confirm"), в которую поток по первой не попадает. */
const CLEAR_PLAN_CONFIRM_MS=12000;
let _clearPlanArmed=null,_clearPlanHideTimer=null;
/* Кнопка подтверждения живёт ровно столько же, сколько вопрос: истекло окно — снят взвод и
   спрятана кнопка (иначе обещала бы удаление, которого уже нет). Второй способ снять её —
   исчезновение плана — решает updatePlanUi. */
function showClearPlanConfirm(on){
  const btn=$("clearPlanConfirmBtn");if(!btn)return;
  btn.hidden=!on;
  clearTimeout(_clearPlanHideTimer);
  if(on)_clearPlanHideTimer=setTimeout(()=>{_clearPlanArmed=null;showClearPlanConfirm(false)},CLEAR_PLAN_CONFIRM_MS+200);
}
/* Подпись ПОКАЗАННОГО: подтверждают ровно ту подложку, что висела при вопросе. planToken меняется
   и при загрузке нового чертежа, и при сбросе (bumpPlanToken), planLabel — имя файла. Загрузил
   другой чертёж, пока висел вопрос → подпись другая → EPConfirmRepeat вернёт cancel, а не молчаливо
   удалит новый план. */
const clearPlanSubject=()=>JSON.stringify([state.planToken||0,state.planLabel||""]);
/* Нажатие на САМУ команду «Убрать план». via:"arm" НЕ удаляет НИКОГДА, сколько бы нажатий ни
   пришло — только взводит вопрос и показывает вторую кнопку. */
function askClearPlan(){
  if(!state.planLoaded)return;
  const step=EPConfirmRepeat.press(_clearPlanArmed,{now:Date.now(),maxMs:CLEAR_PLAN_CONFIRM_MS,
    subject:clearPlanSubject(),via:"arm"});
  _clearPlanArmed=step.armed;
  showClearPlanConfirm(true);
  toast(`Убрать подложку «${state.planLabel||"план"}»? Отмены нет. Нажмите «Точно убрать план?»`);
}
/* Нажатие на кнопку подтверждения — ДРУГОЙ орган управления: поток по «Убрать план» сюда не
   попадает, поэтому ни паузы, ни повторов не требуется. Остаются подпись (та же подложка) и окно. */
function confirmClearPlan(){
  const step=EPConfirmRepeat.press(_clearPlanArmed,{now:Date.now(),maxMs:CLEAR_PLAN_CONFIRM_MS,
    subject:clearPlanSubject(),via:"confirm"});
  _clearPlanArmed=step.armed;
  /* «wait» — нажатие в тот же миг, когда кнопка появилась: промах по соседней команде из-за сдвига
     разметки, а не подтверждение. Вопрос остаётся на экране. */
  if(step.action==="wait")return;
  if(step.action!=="confirm"){
    showClearPlanConfirm(false);
    toast("Подложка сменилась — нажмите «Убрать план» ещё раз");
    return;
  }
  showClearPlanConfirm(false);
  clearPlan();
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
    /* угол поворота подложки (Б3, ч.1) — часть проекта: переживает автосейв/перезагрузку.
       Старый проект без поля откроется с 0 (restoreProject), поворот — чисто визуальный,
       координаты объектов он не трогает, смету не меняет. */
    planRotation:state.planRotation,
    /* угол поворота ВСЕГО плана и режим органов поворота (Б3, ч.2а) — часть проекта. worldAngle
       вращает лишь ВИД: координаты нарисованного не трогает (инвариант части 1 верен и для него),
       в КП план выйдет повёрнутым. Старый проект без полей → worldAngle 0, rotateTarget "image". */
    worldAngle:state.worldAngle,rotateTarget:state.rotateTarget,
    /* память полей исчезнувших комнат (В15) — часть проекта: без неё удалить стену, сохраниться и
       перезагрузиться значило бы навсегда потерять поля комнаты, которую ещё собирались вернуть */
    roomFieldMemory:state.roomFieldMemory,
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
    offerOptions:EPOfferOptions.normalize(EP_DATA.settings.offerOptions),
    /* вид поста в листе монтажника — отдельное поле проекта (не внутри offerOptions, см. Б2) */
    assemblyView:EPOfferOptions.assemblyView(EP_DATA.settings.assemblyView),
    /* условия сделки и валюта — часть проекта, а не глобальная настройка приложения */
    /* vatMode пишем ЧЕРЕЗ vatModeOf, а не сырым полем: у старого проекта (или свежего дефолта
       data.js) поля vatMode ещё нет, сырой пик дал бы undefined, JSON бы его выбросил — и в
       сохранении не осталось бы НИ vatMode, НИ vatEnabled, а следующее открытие откатило бы
       режим на дефолт (денежный дефект). Снапшот обязан записать эффективный режим единым
       источником, чтобы «открыть → сохранить → открыть» не меняло итог. */
    terms:(({workPercent,materialsPercent,discountPercent,vatPercent,rateSurchargePercent,wallType,lightingScheme,backlight,displayCurrency,eurRate,rateDate,rateSource})=>
      ({workPercent,materialsPercent,discountPercent,vatPercent,vatMode:EPEstimate.vatModeOf(EP_DATA.settings),rateSurchargePercent,wallType,lightingScheme,backlight,displayCurrency,eurRate,rateDate,rateSource}))(EP_DATA.settings)};
}
/* План может не влезть в LocalStorage (лимит ~5 МБ). Тогда сохраняем всё остальное,
   пометив, что чертёж придётся загрузить заново, — это лучше полной потери работы. */
function persistProject(){
  const snap=projectSnapshot();
  captureHistory(snap);   /* прямые сохранения (перенос, правка поста, поворот, очистка) — тоже шаги */
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
  /* ШАГ ИСТОРИИ ФИКСИРУЕМ СРАЗУ, А СОХРАНЕНИЕ В localStorage — ПО-ПРЕЖНЕМУ С ЗАДЕРЖКОЙ. Решение
     владельца: «каждый клик — отдельный шаг», и дебаунс автосохранения (700 мс) НЕ должен склеивать
     две быстрые правки в один шаг. Поэтому запись в стек идёт в момент изменения (здесь), а запись
     на диск остаётся отложенной. captureHistory дедуплицирует по плану — вызовы без правки плана
     (зум, выделение, клик по пустому) шага не создают. */
  captureHistory();
  clearTimeout(_saveTimer);
  _saveTimer=setTimeout(persistProject,EPConfig.autosaveDelay);   /* задержка — из EPConfig (было 700 мс) */
}
/* ---- Отмена/Возврат изменений плана (Б4, ч.А) ----
   Стек истории — чистый EPHistory (лимит, сброс «Вернуть», amend, ключ сравнения без производных
   полей). app.js только снимает снимки (projectSnapshot) и применяет их (applyPlanSnapshot). Замки:
   _applyingSnapshot — «идёт применение»: промежуточные рендеры/сейвы во время отката не должны стать
   новыми шагами и стереть «Вернуть» (R4); _historyAmend — автопересборка комнат из разметки дополняет
   текущий шаг, а не плодит новый; _histBusy — защита undo/redo от повторного входа при удержании.
   var — те же причины, что у _saveTimer: эти имена читаются из scheduleSave/persistProject, объявленных
   выше по тексту, чем первый вызов из init. */
var _history=EPHistory.create(EPConfig.historyLimit);
var _applyingSnapshot=false,_historyAmend=false,_histBusy=false;
/* Зафиксировать шаг. snap необязателен — persistProject передаёт уже построенный, scheduleSave строит
   свой. Во время применения снимка (R4) и до включения автосейва шага не пишем. Дедупликация по плану —
   внутри EPHistory.push (одинаковый план → не шаг). */
function captureHistory(snap){
  if(_applyingSnapshot)return;
  if(!_autosaveOn)return;
  const s=snap||projectSnapshot();
  if(_historyAmend)_history.amend(s);else _history.push(s);
  syncHistoryUi();
}
/* Доступность кнопок «Отменить»/«Вернуть» — одно место (§7.1), зовётся после каждого изменения стека. */
function syncHistoryUi(){
  const u=$("undoBtn"),r=$("redoBtn");
  if(u)u.disabled=!_history.canUndo();
  if(r)r.disabled=!_history.canRedo();
}
/* ПОДЛОЖКА В ОТКАТЕ/ВОЗВРАТЕ (Б4, ч.Б). ОДНО правило «та же ли подложка, что сейчас»: дешёвый отпечаток
   EPHistory.planFp (data-URL в десятки МБ целиком не сравниваем). НЕ изменилась → не трогаем ни img.src
   (лишняя перезагрузка растра и мигание), ни видимость (её переключение отдельным шагом не является —
   решение владельца). Изменилась → bumpPlanToken (гасит идущие распознавания, § planToken), подпись и
   видимость берём ИЗ шага: видимость восстанавливается ТОЛЬКО здесь, при смене подложки, поэтому откат
   «Убрать план» возвращает ту видимость, что была до удаления, а обычное переключение B не откатывается.
   Растр грузим/снимаем, НЕ блокируя откат: состояние применяется синхронно, а стартовавшую загрузку
   обезвреживает planToken — быстрый повторный откат/очистка сменят токен, и устаревший onload сам себя
   отменит (так undo не замирает на декодировании многомегабайтной картинки, и повторный Ctrl+Z
   безопасен). applyPlanRotation для нового растра зовём в onload: вписывающий угол считается от
   naturalWidth, доступного лишь ПОСЛЕ загрузки (как в restoreProject). */
function applyPlanUnderlay(plan){
  const img=$("planImage");if(!img)return;
  const targetSrc=plan.plan||null;
  const curSrc=(state.planLoaded&&/^data:/.test(img.src||""))?img.src:null;
  if(EPHistory.planFp(targetSrc)===EPHistory.planFp(curSrc))return;   /* подложка та же — ничего не трогаем */
  bumpPlanToken();
  state.planLabel=plan.planLabel||"";
  state.planVisibility=plan.planVisibility||"show";
  if(targetSrc){
    state.planLoaded=true;
    const token=state.planToken;
    img.onload=()=>{img.onload=null;img.onerror=null;if(state.planToken===token)applyPlanRotation()};
    img.onerror=()=>{img.onload=null;img.onerror=null};
    img.src=targetSrc;
  }else{
    img.removeAttribute("src");   /* как clearPlan: пустая "" ушла бы лишним запросом на URL страницы */
    state.planLoaded=false;
  }
  updatePlanUi();applyPlanVisibility();
}
/* Применить снимок плана (откат/возврат). Пишем ТОЛЬКО поля плана (EPHistory.planOf); настройки и вид не
   трогаем — они не отменяются; подложку-чертёж восстанавливает applyPlanUnderlay (выше). worldAngle —
   через setWorldAngle (прямая запись оставила бы pan под старым углом и увела лист за край окна, см.
   §«Очистить холст»). Эфемерное состояние холста сбрасываем (R7): незаконченные стена/разметка/масштаб,
   режим размещения, маркер двойного клика. mountedRoomId гасим ДО перерисовки (R1): иначе
   renderProperties→flushRoomDraft прочитал бы старое имя комнаты из полей и записал бы его обратно,
   откатив откат. Всё под замком _applyingSnapshot, чтобы ни один промежуточный сейв не стал новым шагом;
   один persistProject в конце пишет результат на диск. */
function applyPlanSnapshot(snap){
  _applyingSnapshot=true;
  try{
    const plan=EPHistory.planOf(snap);
    state.devices=plan.devices;state.posts=plan.posts;state.rooms=plan.rooms;
    state.walls=plan.walls;state.autoWalls=plan.autoWalls;state.roomLines=plan.roomLines;
    state.roomFieldMemory=plan.roomFieldMemory;
    state.pxPerMeter=plan.pxPerMeter;state.scaleSegment=plan.scaleSegment;
    state.planRotation=EPPlanRotate.normalizeAngle(plan.planRotation)||0;
    /* R7: эфемерное состояние холста — не часть снимка, но осталось бы висеть после отката */
    state.selected=null;state.pending=null;state.wallPoints=[];state.scalePoints=[];
    canvas.classList.remove("placing");
    finishRoomLineChain();            /* незаконченная цепочка разметки (roomLinePoints/ids/hover) */
    _lastIconPlacement=null;_placeOnPostIcon=null;
    mountedRoomId=null;               /* R1: flushRoomDraft не должен вернуть старое имя комнаты */
    setWorldAngle(plan.worldAngle);   /* угол мира — только так (подбирает pan, лист остаётся на экране) */
    applyPlanUnderlay(plan);          /* подложка: восстановить/снять растр и видимость при смене чертежа */
    renderAll();renderProperties();renderSummary();updateScaleUi();applyPlanRotation();renderScaleRuler();
    persistProject();                 /* один сейв на диск; шаг не пишем — замок ещё держит */
  }finally{_applyingSnapshot=false}
  syncHistoryUi();
}
/* Перед откатом/возвратом: если ждёт отложенная автопересборка комнат из разметки — выполнить её СЕЙЧАС
   (дополнив текущий шаг), иначе таймер сработает уже ПОСЛЕ отката, на откаченных линиях, и сотрёт
   «Вернуть» (R). */
function flushPendingRoomBuild(){
  if(!_roomsTimer)return;
  clearTimeout(_roomsTimer);_roomsTimer=null;
  _historyAmend=true;try{buildRoomsFromLines({silent:true})}finally{_historyAmend=false}
}
function undoPlan(){
  if(_histBusy)return;              /* повторный вход при удержании Ctrl+Z */
  flushPendingRoomBuild();
  if(!_history.canUndo()){syncHistoryUi();return}
  _histBusy=true;
  try{applyPlanSnapshot(_history.undo())}finally{_histBusy=false}
  syncHistoryUi();
}
function redoPlan(){
  if(_histBusy)return;
  flushPendingRoomBuild();
  if(!_history.canRedo()){syncHistoryUi();return}
  _histBusy=true;
  try{applyPlanSnapshot(_history.redo())}finally{_histBusy=false}
  syncHistoryUi();
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
  relabelContourRooms(state.rooms);   /* В10: у старых проектов подпись Г/П-комнаты могла лежать вне контура — вернуть внутрь */
  /* миграция старых проектов: они сохранялись без номеров постов — проставляем
     недостающие по порядку массива (существующие номера не трогаем), чтобы номер был
     стабильным идентификатором и на плане, и в документах */
  EPPosts.ensurePostNumbers(state.posts);
  dropOrphanKeyGroups(state.posts);
  state.walls=p.walls||[];state.autoWalls=p.autoWalls||[];
  /* старые проекты без разметки и без флага видимости открываются штатно:
     roomLines → [], planVisibility → "show" (обратная совместимость) */
  state.roomLines=p.roomLines||[];state.planVisibility=p.planVisibility||"show";
  /* угол поворота подложки (Б3, ч.1): старый проект поля не несёт → normalizeAngle(undefined)=null
     → 0 (подложка без поворота). Битое значение из ручной правки тоже свернётся к 0. */
  state.planRotation=EPPlanRotate.normalizeAngle(p.planRotation)||0;
  /* угол и режим поворота ВСЕГО плана (Б3, ч.2а): старый проект полей не несёт → worldAngle 0
     (normalizeAngle(undefined)=null→0), режим "image" (поведение части 1). Битое значение угла
     из ручной правки снимка тоже свернётся к 0. */
  state.worldAngle=EPPlanRotate.normalizeAngle(p.worldAngle)||0;
  state.rotateTarget=p.rotateTarget==="world"?"world":"image";
  /* память полей исчезнувших комнат (В15): старый проект её не несёт — открывается пустой */
  state.roomFieldMemory=Array.isArray(p.roomFieldMemory)?p.roomFieldMemory:[];
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
    /* Режим НДС восстанавливаем через EPEstimate.vatModeOf — ОДНО правило чтения настроек,
       оно же мигрирует старый проект (галочка vatEnabled → режим), см. §7.1 п.4. Поле «НДС, %»
       гасим на «Не учитывать», как и в applyTerms, — та же защита от противоречия на экране.
       ⚠️ МИГРИРОВАННЫЙ РЕЖИМ ОСЕДАЕТ В settings, а не только в селекторе: иначе следующее
       автосохранение (projectSnapshot) не нашло бы vatMode, потеряло бы его, и при повторном
       открытии проект откатился бы на дефолт data.js — старый КП с «не учитывать» задним числом
       дорожал бы на НДС. Пишем эффективный режим один раз, единым источником (vatModeOf). */
    const vatMode=EPEstimate.vatModeOf(EP_DATA.settings);
    EP_DATA.settings.vatMode=vatMode;
    $("vatMode").value=vatMode;
    $("vatInput").disabled=vatMode==="none";
    $("currencySelect").value=EP_DATA.settings.displayCurrency||"EUR";
    /* Схема электрики: проект, сохранённый до её появления, поля не несёт — Object.assign выше
       его не трогает, и остаётся дефолт data.js («Классическая»). Это и есть требуемое
       поведение, никакой отдельной миграции (в отличие от надбавки к курсу) не нужно. */
    renderLightingSchemeSelect();
    /* Тип стены проекта едет в terms тем же Object.assign — селектор в панели обязан показать
       восстановленное значение, иначе панель уверяет «бетон», а коробки подбираются под ГКЛ. */
    renderProjectWallTypeSelect();
    /* Подсветка клавиш: старый проект её поля не несёт — Object.assign выше его не трогает, и
       остаётся дефолт data.js (ВЫКЛЮЧЕНО). Это и требуется: включение дорожит смету, задним
       числом дорожать нельзя (тот же принцип, что у надбавки к курсу). Панель обязана показать
       восстановленное значение и доступность селекторов. */
    renderProjectBacklight();
  }
  /* реквизиты документа: старый проект без них открывается с пустыми полями и датой
     «сегодня» (fillDocHeaderInputs подставит) — обратная совместимость */
  if(p.docHeader)EP_DATA.settings.docHeader=p.docHeader;
  fillDocHeaderInputs();
  EP_DATA.settings.offerOptions=EPOfferOptions.normalize(p.offerOptions);
  /* Вид поста — отдельное поле проекта. Миграция: снимки, сохранённые ранним черновиком Б2, держали
     его ВНУТРИ offerOptions (p.offerOptions.assemblyView) — читаем оттуда, если своего поля ещё нет.
     Старый проект без обоих полей открывается со взрыв-схемой (assemblyView сведёт undefined к ней). */
  EP_DATA.settings.assemblyView=EPOfferOptions.assemblyView(
    p.assemblyView!==undefined?p.assemblyView:(p.offerOptions&&p.offerOptions.assemblyView));
  syncOfferOptions();
  if(p.plan){
    await new Promise(done=>{
      const img=$("planImage");
      img.onload=()=>{img.onload=null;img.onerror=null;done()};
      img.onerror=()=>{img.onload=null;img.onerror=null;done()};
      img.src=p.plan;
    });
    if($("planImage").naturalWidth){
      state.planLoaded=true;
      updatePlanUi();
    }
  }
  if(state.planLoaded||state.devices.length||state.posts.length||state.rooms.length||state.walls.length)markCanvasUsed();
  return p;
}
/* Реквизиты документа (PLAN 5): поля панели «Реквизиты КП». Хранятся в проекте
   (settings.docHeader, см. projectSnapshot/restoreProject). Возвращаем готовый к печати
   вид: дата форматируется ГГГГ-ММ-ДД → ДД.ММ.ГГГГ, пустая дата → сегодня. Пустые поля
   отдаём как есть — offerPdf/installSheet сами их не печатают. */
const DOC_FIELDS={docProject:"project",docAddress:"address",docDeveloper:"developer",docDate:"date",docNumber:"number"};
function docHeader(){
  const d=EP_DATA.settings.docHeader||{};
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(d.date||"");
  /* «Мои реквизиты» — бланк человека (EPPrefs, ключ "myRequisites"). Читаем ЛИТЕРАЛОМ, а не через
     const/helper: docHeader исполняется в vm-стенде offerNumberWiring.test.js, куда top-level
     const и соседние функции не попадают (туда проброшен лишь EPPrefs). Тот же ключ — в панельных
     fill/apply ниже. «Реквизиты заказчика» — в проекте (d.customer), форма {values, show}. */
  const my=EPPrefs.get("myRequisites",{})||{};
  const cust=d.customer||{};
  return {
    project:d.project||"",address:d.address||"",
    developer:d.developer||"",number:d.number||"",
    date:m?`${m[3]}.${m[2]}.${m[1]}`:(d.date||new Date().toLocaleDateString("ru-RU")),
    /* галочка «показывать Разработчика в шапке КП»: по умолчанию включена (undefined → true).
       Правило «печатать ли» живёт в offerPdf (developerShow!==false); здесь только сырое значение. */
    developerShow:d.developerShow!==false,
    my:{values:my.values||{},show:my.show||{}},
    customer:{values:cust.values||{},show:cust.show||{}}
  };
}
function applyDocHeader(){
  const dh=EP_DATA.settings.docHeader=EP_DATA.settings.docHeader||{};
  Object.entries(DOC_FIELDS).forEach(([id,key])=>{dh[key]=$(id).value});
  scheduleSave();
}
function fillDocHeaderInputs(){
  /* A5-миграция: старый проект нёс ФИО заказчика в поле «Клиент» (docHeader.client) — переносим в
     customer.fio, чтобы данные не потерялись и строка «Клиент» не осталась в шапке КП. Делаем здесь
     (а не в restoreProject): функция зовётся на ОБОИХ путях загрузки (init и restoreProject), а её
     vm-стенды restoreProject стабят — так EPDocRequisites не требуется им в контекст. Снимок проекта
     берёт settings.docHeader уже перенесённым. Идемпотентна. */
  EP_DATA.settings.docHeader=EPDocRequisites.migrateDocHeader(EP_DATA.settings.docHeader);
  const d=EP_DATA.settings.docHeader||{};
  $("docProject").value=d.project||"";
  $("docAddress").value=d.address||"";$("docDeveloper").value=d.developer||"";
  $("docNumber").value=d.number||"";
  /* дата по умолчанию — сегодня (ISO для input[type=date]); значение можно изменить */
  $("docDate").value=d.date||new Date().toISOString().slice(0,10);
  fillRequisitesInputs();   /* галочка «Разработчик» и оба блока реквизитов */
}

/* Панель «Реквизиты КП», блоки «Мои реквизиты» (бланк человека, EPPrefs) и «Реквизиты заказчика»
   (свои у проекта). Поля и правило «обязательное/необязательное» берём из EPDocRequisites — ОДИН
   источник с печатью КП (§7.1), чтобы список полей и галочек не разошёлся с документом. Обязательные
   поля (ФИО, контакты) — галочка disabled checked: включена всегда, снять нельзя (решение владельца
   п.3). В HTML попадают только статичные подписи и ключи полей (экранируем их), значения идут в
   поля через .value, не через innerHTML. */
function requisiteBlockHtml(block,fields){
  return fields.map(f=>
    `<label class="doc-req-field"><span>${esc(f.label)}</span>`
    +`<input type="text" autocomplete="off" data-req-block="${esc(block)}" data-req-key="${esc(f.key)}"></label>`
    +`<label class="doc-req-check"><input type="checkbox" data-req-block="${esc(block)}" data-req-check="${esc(f.key)}"`
    +`${f.required?" disabled checked":""}>показывать в КП</label>`
  ).join("");
}
function renderRequisitesInputs(){
  $("myRequisites").innerHTML=requisiteBlockHtml("my",EPDocRequisites.MY_FIELDS);
  $("customerRequisites").innerHTML=requisiteBlockHtml("customer",EPDocRequisites.CUSTOMER_FIELDS);
}
function reqInput(block,key){return document.querySelector(`[data-req-block="${block}"][data-req-key="${key}"]`)}
function reqCheck(block,key){return document.querySelector(`[data-req-block="${block}"][data-req-check="${key}"]`)}
function fillReqBlock(block,fields,src){
  fields.forEach(f=>{
    const inp=reqInput(block,f.key),chk=reqCheck(block,f.key);
    if(inp)inp.value=(src.values||{})[f.key]||"";
    /* обязательные галочки оставляем disabled checked как в разметке; меняем только необязательные */
    if(chk&&!f.required)chk.checked=EPDocRequisites.isChecked(f,src.show);
  });
}
function fillRequisitesInputs(){
  const d=EP_DATA.settings.docHeader||{};
  $("docDeveloperShow").checked=d.developerShow!==false;
  const my=EPPrefs.get("myRequisites",{})||{};
  fillReqBlock("my",EPDocRequisites.MY_FIELDS,{values:my.values||{},show:my.show||{}});
  fillReqBlock("customer",EPDocRequisites.CUSTOMER_FIELDS,d.customer||{});
}
/* Чтение блока из полей: обязательные в show НЕ пишем — их печать от галочки не зависит, лишний
   ключ только засорял бы снимок/бланк. */
function readReqBlock(block,fields){
  const values={},show={};
  fields.forEach(f=>{
    const inp=reqInput(block,f.key),chk=reqCheck(block,f.key);
    if(inp)values[f.key]=inp.value;
    if(chk&&!f.required)show[f.key]=chk.checked;
  });
  return {values,show};
}
/* «Мои реквизиты» — в EPPrefs (бланк человека, общий на все проекты). Литерал "myRequisites" — тот
   же ключ, что в docHeader(); см. комментарий там о vm-стенде. */
function applyMyRequisites(){EPPrefs.set("myRequisites",readReqBlock("my",EPDocRequisites.MY_FIELDS))}
/* «Реквизиты заказчика» — в проект (settings.docHeader.customer). */
function applyCustomerRequisites(){
  const dh=EP_DATA.settings.docHeader=EP_DATA.settings.docHeader||{};
  dh.customer=readReqBlock("customer",EPDocRequisites.CUSTOMER_FIELDS);
  scheduleSave();
}
function applyDeveloperShow(){
  const dh=EP_DATA.settings.docHeader=EP_DATA.settings.docHeader||{};
  dh.developerShow=$("docDeveloperShow").checked;
  scheduleSave();
}

/* Картинки бланка компании — БЛАНК ЧЕЛОВЕКА, а не свойство проекта: загрузил один раз — стоят во
   ВСЕХ его проектах (та же доктрина, что у offerPresets/frameFacingView). Поэтому в EPPrefs
   (ep_prefs), а не в снимке проекта. Храним data-URL: документы открываются через window.open,
   внешние пути туда не доедут. Логотип идёт в шапку КП и листа монтажника; подпись и печать — в
   конец КП (в лист монтажника не идут: не коммерческий документ). Разметку <img> и проверку файла
   держит чистый EPDocImages — здесь только DOM-часть (выбор/чтение/ужатие/предпросмотр).
   Всё три картинки грузятся-показываются ОДНОЙ функцией с параметром kind (§7.1): выбор, проверка
   файла, чтение, ужатие и запись — в одном месте, а не три копии. Различия картинок (ключ EPPrefs,
   слово в сообщениях, узлы предпросмотра) — данными в DOC_IMAGES. */
const DOC_IMAGES={
  logo:{pref:"companyLogo",subject:"логотипа",alt:"Логотип компании",preview:"docLogoPreview",remove:"docLogoRemove",
        saved:"Логотип сохранён — он будет в шапке КП и листа монтажника во всех ваших проектах"},
  signature:{pref:"companySignature",subject:"подписи",alt:"Подпись",preview:"docSignaturePreview",remove:"docSignatureRemove",
        saved:"Подпись сохранена — она будет в конце ваших коммерческих предложений"},
  stamp:{pref:"companyStamp",subject:"печати",alt:"Печать",preview:"docStampPreview",remove:"docStampRemove",
        saved:"Печать сохранена — она будет в конце ваших коммерческих предложений"}
};
/* Растровая высота/ширина картинки при ужатии. Держим ВЫШЕ экранной (max-height в EPDocImages.imgHtml)
   с запасом: печать плотнее экрана, и без запаса картинка в PDF выходила бы мыльной. Шире DOC_IMAGE_MAX_W
   не растим — вес data-URL зря вырастет. Общие на все три картинки: печатная плотность у них одна. */
const DOC_IMAGE_PRINT_H=160,DOC_IMAGE_MAX_W=480;
function docImage(kind){const v=EPPrefs.get(DOC_IMAGES[kind].pref,"");return typeof v==="string"?v:"";}
function companyLogo(){return docImage("logo");}
function companySignature(){return docImage("signature");}
function companyStamp(){return docImage("stamp");}
function loadDocImage(file,kind){
  const cfg=DOC_IMAGES[kind];
  /* Годен ли файл — решает общий чистый EPDocImages (тип картинки, честный предел размера) ТЕМ ЖЕ
     правилом для всех трёх картинок (§7.1). subject — какая это картинка, для сообщения человеку.
     Не годен → говорим словами и НЕ сохраняем молча битое (решение владельца п.3). */
  const check=EPDocImages.validateSource(file,cfg.subject);
  if(!check.ok){toast(check.reason);return;}
  const reader=new FileReader();
  reader.onerror=()=>toast("Не удалось прочитать файл: "+cfg.subject);
  reader.onload=()=>{
    const img=new Image();
    img.onerror=()=>toast("Не удалось разобрать картинку: "+cfg.subject);
    img.onload=()=>{
      /* Ужимаем до печатной высоты (и ширины), сохраняя пропорции; больше исходника не растягиваем
         (scale ≤ 1). Растр на canvas → PNG: у логотипов/подписей обычно прозрачный фон. */
      const scale=Math.min(DOC_IMAGE_PRINT_H/img.height,DOC_IMAGE_MAX_W/img.width,1);
      const w=Math.max(1,Math.round(img.width*scale)),h=Math.max(1,Math.round(img.height*scale));
      const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;
      canvas.getContext("2d").drawImage(img,0,0,w,h);
      EPPrefs.set(cfg.pref,canvas.toDataURL("image/png"));
      renderDocImage(kind);
      toast(cfg.saved);
    };
    img.src=reader.result;
  };
  reader.readAsDataURL(file);
}
function clearDocImage(kind){EPPrefs.set(DOC_IMAGES[kind].pref,"");renderDocImage(kind);}
/* Предпросмотр загруженной картинки и видимость кнопки «Убрать». Есть картинка → показываем её и
   кнопку; нет — прячем оба, панель выглядит как без картинки. src экранируем (конвенция 4). */
function renderDocImage(kind){
  const cfg=DOC_IMAGES[kind],src=docImage(kind),preview=$(cfg.preview),removeBtn=$(cfg.remove);
  if(!preview)return;
  preview.innerHTML=src?`<img src="${esc(src)}" alt="${esc(cfg.alt)}">`:"";
  preview.hidden=!src;
  if(removeBtn)removeBtn.hidden=!src;
}

/* Условия сделки в подвале КП — тоже БЛАНК ЧЕЛОВЕКА (как логотип/наборы столбцов), а не свойство
   проекта: «Соглашение сторон» пишут один раз — оно стоит во всех его КП. Поэтому в EPPrefs (ep_prefs),
   не в снимке проекта. Разметку подвала и предел длины держит чистый EPOfferPdf — здесь только
   чтение/сохранение строки. Обрезаем по общему пределу (EPOfferPdf.MAX_TERMS_CHARS) — второй заслон к
   textarea maxlength на случай вставки/программной записи мимо поля. */
const TERMS_PREF="companyTerms";
function companyTerms(){const v=EPPrefs.get(TERMS_PREF,"");return typeof v==="string"?v:"";}
function saveCompanyTerms(text){
  EPPrefs.set(TERMS_PREF,String(text==null?"":text).slice(0,EPOfferPdf.MAX_TERMS_CHARS));
}
/* Заполнить поле условий из EPPrefs и задать maxlength из ОДНОГО источника (EPOfferPdf): предел
   поля и обрезка при сохранении не должны разойтись числом. */
function renderCompanyTerms(){
  const el=$("docTerms");if(!el)return;
  el.maxLength=EPOfferPdf.MAX_TERMS_CHARS;
  el.value=companyTerms();
}

/* Настройки пока только КП (D10, часть 1), отдельно от реквизитов и условий сделки.
   Переключение чекбокса не вызывает renderAll/пересчёт: меняется только будущая печать. */
function renderOfferOptions(){
  /* Подписи групп — из схемы (EPOfferOptions.groupLabels), не вторая копия здесь: новая группа
     полей получит подпись там же, где заведена, а не «undefined» в легенде. */
  $("offerOptionsFields").innerHTML=Object.entries(EPOfferOptions.fields).map(([group,fields])=>
    `<fieldset><legend>${esc(EPOfferOptions.groupLabels[group]||group)}</legend>${fields.map(([key,label])=>
      `<label><input type="checkbox" id="offer-${group}-${key}" data-offer-group="${group}" data-offer-key="${key}">${esc(label)}</label>`).join("")}</fieldset>`).join("");
  renderCustomOfferPresets();   /* кнопки своих наборов — из EPPrefs, их состав знает только приложение */
  syncOfferOptions();
}
function syncOfferOptions(){
  const o=EPOfferOptions.normalize(EP_DATA.settings.offerOptions);
  ["articles","prices"].forEach(key=>{$("offer-"+key).checked=o[key]});
  /* Вид поста — отдельная настройка проекта, не часть набора столбцов: восстанавливаем select из
     settings.assemblyView, чтобы экран не разошёлся с документом (Б2). */
  $("offer-assemblyView").value=EPOfferOptions.assemblyView(EP_DATA.settings.assemblyView);
  Object.entries(EPOfferOptions.fields).forEach(([group,fields])=>fields.forEach(([key])=>{
    const input=$("offer-"+group+"-"+key);
    input.checked=o[group][key];
    input.disabled=(group!=="sections"&&!o.sections[group])||(key==="article"&&!o.articles)
      ||(["price","sum","itemPrices"].includes(key)&&!o.prices);
  }));
  highlightActiveOfferPreset();   /* после любого изменения — подсветить набор, совпадающий с текущим */
}
/* Свои наборы столбцов — ПРИВЫЧКА ЧЕЛОВЕКА (как вид отделки), поэтому хранятся в EPPrefs (ep_prefs),
   а не в снимке проекта: чужой проект их не должен переопределять. Чистые преобразования (ровно 3
   слота, валидация имени, сравнение наборов) — в EPOfferOptions; здесь только чтение/запись хранилища
   и связка с DOM. */
function customOfferPresets(){
  return EPOfferOptions.normalizeCustomPresets(EPPrefs.get("offerPresets",[]));
}
/* Кнопки своих наборов: заполненный слот — «применить» + «перезаписать текущим составом»; пустой —
   одна кнопка «＋ Свой набор N». Имя набора выводим через esc: его вводит человек. */
function renderCustomOfferPresets(){
  const list=customOfferPresets();
  $("offerCustomPresets").innerHTML=list.map((slot,i)=>slot
    ?`<span class="offer-custom"><button class="btn ghost small offer-custom-apply" type="button" data-custom-apply="${i}" title="Применить набор «${esc(slot.name)}»">${esc(slot.name)}</button>`
      +`<button class="btn ghost small offer-custom-save" type="button" data-custom-save="${i}" title="Перезаписать «${esc(slot.name)}» текущим составом">↻</button></span>`
    :`<button class="btn ghost small offer-custom-empty" type="button" data-custom-save="${i}" title="Сохранить текущий состав как свой набор">＋ Свой набор ${i+1}</button>`).join("");
  highlightActiveOfferPreset();
}
/* Активный набор — тот, чей состав совпадает с текущим (EPOfferOptions.sameOptions). Подсвечиваем и
   готовые кнопки, и свои: так человек видит, что выбрано сейчас. Вручную изменил галочку — ни одна
   кнопка не активна, и это честно. Функция только оформляет: без DOM (тесты) молча выходит. */
function highlightActiveOfferPreset(){
  if(typeof document==="undefined")return;
  const cur=EPOfferOptions.normalize(EP_DATA.settings.offerOptions);
  document.querySelectorAll("[data-offer-preset]").forEach(btn=>
    btn.classList.toggle("active",EPOfferOptions.sameOptions(cur,EPOfferOptions.preset(btn.dataset.offerPreset))));
  const list=customOfferPresets();
  document.querySelectorAll("[data-custom-apply]").forEach(btn=>{
    const slot=list[Number(btn.dataset.customApply)];
    btn.classList.toggle("active",!!slot&&EPOfferOptions.sameOptions(cur,slot.options));
  });
}
/* Применить свой набор — так же, как готовый: пишем состав в проект, синхроним галочки, сохраняем. */
function applyCustomOfferPreset(index){
  const slot=customOfferPresets()[index];
  if(!slot)return;
  EP_DATA.settings.offerOptions=EPOfferOptions.normalize(slot.options);
  syncOfferOptions();scheduleSave();
}
/* Сохранить текущий состав в слот index под именем, которое вводит человек. Пустое имя (отмена
   prompt или пробелы) — набор НЕ сохраняем, слот остаётся прежним: без названия его не выбрать. */
function saveCustomOfferPreset(index){
  const list=customOfferPresets();
  const name=(prompt("Название набора столбцов",list[index]?list[index].name:"")||"").trim();
  if(!name)return;
  EPPrefs.set("offerPresets",EPOfferOptions.saveCustomPreset(list,index,name,EP_DATA.settings.offerOptions));
  renderCustomOfferPresets();
}
function applyOfferOption(input){
  const {offerGroup:group,offerKey:key}=input.dataset;
  /* Вид поста в листе монтажника — ОТДЕЛЬНАЯ настройка проекта, а не набор столбцов: пишем в
     settings.assemblyView, а не в offerOptions, иначе смена набора столбцов сбрасывала бы вид, а
     подсветка активного набора гасла бы из-за него. Подсветку наборов при этом трогать не нужно
     (вид в сравнение не входит), поэтому выходим сразу. */
  if(key==="assemblyView"){EP_DATA.settings.assemblyView=EPOfferOptions.assemblyView(input.value);scheduleSave();return}
  const o=EPOfferOptions.normalize(EP_DATA.settings.offerOptions);
  if(group&&EPOfferOptions.fields[group]?.some(([k])=>k===key))o[group][key]=input.checked;
  else if(key==="articles"||key==="prices")o[key]=input.checked;
  else return;
  EP_DATA.settings.offerOptions=o;
  syncOfferOptions();scheduleSave();
}
function applyOfferPreset(name){
  EP_DATA.settings.offerOptions=EPOfferOptions.preset(name);
  syncOfferOptions();scheduleSave();
}

/* Раскладка постов и разбивка цены для КП (postPricedItems, buildPostLayout) вынесены в js/docs.js
   (EPDocs.attach) вместе со сборкой КП и листа монтажника — раздел И docs/ОСТАТОК-РАБОТ (И1, кусок 3). */

/* ---- План с бирками номеров постов для документов (D9) ----
   Заказчик сверяет номер поста в таблице с местом на чертеже: «дальше вот этот план
   обязательно нужен, чтобы было с чем сверяться». Секцию рисует чистый EPPlanLabels, здесь
   остаётся то, что знает только приложение: где живая подложка и в какой системе координат
   лежат посты. */

/* Полуразмер иконки поста на плане: .plan-icon — 24×24 px, и addPending кладёт пост
   как {x:клик-12, y:клик-12}, то есть post.x/post.y — ЛЕВЫЙ ВЕРХНИЙ угол иконки.
   Бирке нужна точка, которую пользователь видит как «место поста», — центр иконки. */
const POST_ICON_HALF=12;
/* Данные блока «план с бирками» для EPPlanLabels. Подложка — ЛИШЬ ФОН для обводки (замысел
   владельца): помещения штатно рисуются разметкой и без чертежа, и документ обязан их
   показать. Поэтому блок строится по контурам помещений и биркам постов, а подложка идёт
   фоном, только если она загружена И не скрыта (planVisibility!=="hide"). null — только когда
   печатать нечего совсем: ни помещений, ни постов.
   ПОДЛОЖКУ ЧИТАЕМ ЖИВУЮ ($("planImage")), а не из снимка проекта: проект мог быть восстановлен
   без плана (persistProject при переполнении localStorage сохраняет plan:null).
   Зум и панораму вида (state.scale/panX/panY) компенсировать НЕ надо: applyView — это одна
   CSS-трансформация #canvas, в мировые координаты постов и контуров она не входит. А вот
   леттербокс подложки (object-fit:contain внутри мирового бокса) снимает уже сам EPPlanLabels —
   для этого ему и передаются размеры бокса.
   Контуры/якоря подписей — в тех же МИРОВЫХ координатах, что и посты (r.polygon, seedX/seedY):
   пересчёт «мир → доли кадра» целиком лежит на чистом EPPlanLabels.layout. */
/* Посты в форме, которую понимает EPPlanLabels (groupChains/layout): сквозной номер, МИРОВОЙ
   ЦЕНТР иконки и группы света по клавишам с приведённым ключом. ОДНА сборка на обоих
   потребителей связей — печатный план документа (planLabelsSpec) и связи на рабочем холсте
   (renderGroupLinks): правило «ключ группы = groupKeyOf, комната = partitionNorm» не должно
   раздваиваться (§7.1). Само «кто с кем и в каком порядке» считает уже EPPlanLabels.groupChains. */
function postsForGroupLinks(){
  return state.posts.map(p=>{
    /* Комната поста для ПОКОМНАТНОГО разбиения связей: одноимённые группы в разных комнатах —
       РАЗНЫЕ цепочки. Ключ берём ТЕМ ЖЕ EPLightingByRoom.partitionNorm, что и расчёт денег
       (partitionKeyOf → p.roomId), чтобы план совпал со сметой. Пост без комнаты → «без помещения». */
    const room=EPLightingByRoom.partitionNorm(p.roomId);
    /* Группы света поста — ТЕМ ЖЕ правилом связи, что и расчёт механизмов (EPLightingGroups.resolveGroup),
       иначе линии на плане разойдутся с деньгами (§7.1). Приоритет: НОМЕР ПРОХОДНОЙ (p.keyCrossNumbers[i])
       главнее — связь сквозная по проекту (global:true, groupChains не дробит её по комнатам, как и
       buildRegistry считает N по всему проекту). Номера нет — связь по ИМЕНИ (p.keyGroups[i]), покомнатно,
       как прежде. Ключ проходной — тот же EPLightingGroups.crossGroupKey, что в расчёте; ключ имени — тот
       же groupKeyOf. Дубли ключа в одном посте схлопываем: в группе пост один. Пусто — место в связь не
       идёт (одиночный выключатель линии не даёт). */
    const crosses=Array.isArray(p.keyCrossNumbers)?p.keyCrossNumbers:[];
    const names=Array.isArray(p.keyGroups)?p.keyGroups:[];
    const seen=Object.create(null),groups=[];
    const upto=Math.max(crosses.length,names.length);
    for(let i=0;i<upto;i++){
      const crossKey=EPLightingGroups.crossGroupKey(crosses[i]);
      const name=EPLightingGroups.normalizeGroup(names[i]);
      if(crossKey){
        if(seen[crossKey])continue;
        seen[crossKey]=1;groups.push({key:crossKey,label:name||("Проходная № "+EPLightingGroups.normalizeGroup(crosses[i])),global:true});
        continue;
      }
      const key=EPLightingGroups.groupKeyOf(names[i]);
      if(!key||seen[key])continue;
      seen[key]=1;groups.push({key,label:name});
    }
    const o={number:p.number,x:p.x+POST_ICON_HALF,y:p.y+POST_ICON_HALF,room};
    /* Поле groups кладём, только когда группы есть, — прежний контракт spec (пост без групп его
       не несёт); groupChains и renderGroupLinks трактуют отсутствие поля как «групп нет». */
    if(groups.length)o.groups=groups;
    return o;
  });
}
/* СБОРКА И ОТКРЫТИЕ ДОКУМЕНТОВ вынесены в js/docs.js (EPDocs.attach, И1 кусок 3): план с бирками
   (planLabelsSpec/planBlockHtml/planImageForDoc), свод поставщика (supplierSpec*), лист монтажника
   (buildExplodedSpec/buildPostSheet/openInstallSheet/installSheetForProject) и КП (generateCommercialOffer).
   postsForGroupLinks (выше) остаётся здесь — его делит с документами связь групп света на холсте. */
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

/* generateCommercialOffer (оркестратор КП) вынесен в js/docs.js (EPDocs.attach, И1 кусок 3). */


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
  const token=state.planToken;   /* запоминаем поколение подложки ДО отложенной обработки */
  showTraceProgress(true);
  setTimeout(()=>{
    try{
      if(planLostDuringOp(token))return;   /* подложку убрали/сменили за паузу — не перезаписываем autoWalls */
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
      refreshAfterRoomAssignments(()=>{drawWalls();renderRooms()}, scheduleSave);showTraceProgress(false);
      toast(state.autoWalls.length?`Найдено стен: ${state.autoWalls.length}`:"Стены не найдены — измените чувствительность");
      updateStatus(`Автообрисовка: ${state.autoWalls.length} линий`);
    }catch(error){
      console.error(error);showTraceProgress(false);toast("Не удалось обработать изображение");
    }
  },60);
}

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
$("planVisibilityBtn").onclick=cyclePlanVisibility;
/* ПОВОРОТ ПОДЛОЖКИ (Б3, ч.1). ↺/↻ — шаг ±90° от текущего угла (EPPlanRotate.step нормализует).
   Поле «угол» принимает любое число (в т.ч. «3,5» с запятой); мусор — откатываем к текущему углу,
   а не сбрасываем в 0 (потеря работы). Каждое изменение угла — настройка проекта, сохраняем сразу,
   как cyclePlanVisibility. */
/* Поворот ВСЕГО плана (Б3, ч.2а): меняем УГОЛ МИРА вокруг центра окна холста, чтобы содержимое не
   улетело за край (по образцу zoomAt — EPViewport.rotateAt подбирает pan под новый угол). Координаты
   нарисованного НЕ трогаем — вращается только вид. Угол нормализуем (null→0), сохраняем в проект. */
function setWorldAngle(a){
  const n=EPPlanRotate.normalizeAngle(a),na=n==null?0:n;
  /* rotateAt читает СТАРЫЙ угол из view() — зовём ДО записи нового worldAngle */
  const nv=EPViewport.rotateAt(view(),viewportCenter(),na);
  state.worldAngle=na;state.panX=nv.panX;state.panY=nv.panY;
  applyView();syncRotationUi();
  /* SVG-подписи (связи групп, масштаб) пересобираем — их контр-поворот зависит от угла */
  renderGroupLinks();renderScaleRuler();
  persistProject();
}
function rotatePlanBy(delta){
  if(state.rotateTarget==="world"){setWorldAngle(EPPlanRotate.step(state.worldAngle,delta));return}
  if(!state.planLoaded){toast("Сначала загрузите план");return}
  state.planRotation=EPPlanRotate.step(state.planRotation,delta);
  applyPlanRotation();persistProject();
}
function applyRotationInput(){
  const a=EPPlanRotate.normalizeAngle($("planRotateInput").value);
  if(a==null){toast("Угол не распознан — введите число градусов");syncRotationUi();return}
  if(state.rotateTarget==="world"){setWorldAngle(a);return}
  if(!state.planLoaded)return;
  state.planRotation=a;applyPlanRotation();persistProject();
}
/* Переключение режима органов поворота (чертёж ↔ весь план). Поле показывает угол своего режима,
   подсказка и гейт (updatePlanUi) перестраиваются под режим. Сам режим — настройка проекта. */
function syncRotateModeUi(){
  const sel=$("rotateTargetSelect");if(sel&&sel.value!==state.rotateTarget)sel.value=state.rotateTarget;
  const hint=$("rotateModeHint");
  if(hint)hint.textContent=state.rotateTarget==="world"
    ?"Поворачивается весь план: чертёж, стены, комнаты, посты. Названия и значки остаются прямыми"
    :"Поворачивается только чертёж-фон. Стены, комнаты и посты остаются на месте";
  updatePlanUi();syncRotationUi();
}
$("rotateTargetSelect").onchange=e=>{
  state.rotateTarget=e.target.value==="world"?"world":"image";
  syncRotateModeUi();persistProject();
};
$("planRotateLeftBtn").onclick=()=>rotatePlanBy(-90);
$("planRotateRightBtn").onclick=()=>rotatePlanBy(90);
$("planRotateInput").onchange=applyRotationInput;
/* Вписывающий scale зависит от пропорций мирового бокса — на resize окна пересчитываем, иначе
   повёрнутую на 90° подложку обрезало бы окном холста. Угол/координаты не трогаем — чистая перерисовка. */
var _planRotResizeTimer=null;
window.addEventListener("resize",()=>{
  clearTimeout(_planRotResizeTimer);
  _planRotResizeTimer=setTimeout(()=>{if(state.planLoaded)applyPlanRotation()},150);
});
/* «Убрать план» больше НЕ зовёт clearPlan напрямую — оно только задаёт вопрос (via:"arm"); удаляет
   отдельная кнопка «Точно убрать план?» (см. askClearPlan/confirmClearPlan). */
$("clearPlanBtn").onclick=askClearPlan;
$("clearPlanConfirmBtn").onclick=confirmClearPlan;
/* АВТОПОВТОР НА КНОПКЕ В ФОКУСЕ — НЕ ВТОРОЕ ДЕЙСТВИЕ (как у перенумерации и Esc в конструкторе).
   Удержанные Enter/Пробел шлют поток click-событий; на кнопке подтверждения это применило бы
   удаление мгновенно после её появления. Гасим автоповтор в источнике. */
[$("clearPlanBtn"),$("clearPlanConfirmBtn")].forEach(b=>{
  b.onkeydown=e=>{if(e.repeat&&(e.key==="Enter"||e.key===" "))e.preventDefault()};
});
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
/* Подсветка клавиш — настройка ВСЕГО проекта (галочка + цвет + напряжение). Как схема и тип
   стены, обработчик лишь пишет значение в EP_DATA.settings.backlight и зовёт
   applyProjectSettings(); кого перерисовывать — не его забота. renderProjectBacklight внутри
   applyProjectSettings синхронизирует и доступность селекторов (одна точка), поэтому здесь
   условий по галочке нет. */
function ensureBacklightSetting(){
  if(!EP_DATA.settings.backlight)EP_DATA.settings.backlight={enabled:false,color:null,voltage:null};
  return EP_DATA.settings.backlight;
}
$("backlightEnabled").onchange=e=>{
  ensureBacklightSetting().enabled=!!e.target.checked;
  applyProjectSettings();
};
$("backlightColorSelect").onchange=e=>{
  ensureBacklightSetting().color=e.target.value||null;
  applyProjectSettings();
};
$("backlightVoltageSelect").onchange=e=>{
  ensureBacklightSetting().voltage=e.target.value||null;
  applyProjectSettings();
};
/* ---- Вид холста: панорама, зум к курсору, «вписать в экран» (бесконечный холст).
   Мировые координаты объектов НЕ трогаем — двигаем/масштабируем сам ВИД через одну
   CSS-трансформацию единого родителя .canvas. Поэтому слои, объекты, подложка и
   линейка остаются на местах друг относительно друга (главный критерий приёмки).
   Все пересчёты — в чистом EPViewport. ---- */
function view(){return {panX:state.panX,panY:state.panY,scale:state.scale,angle:state.worldAngle||0}}
/* ЕДИНСТВЕННОЕ правило «точка курсора (clientX/clientY) → мировые координаты» с учётом угла мира.
   Все инструменты (клик размещения, стены, разметка, правка вершин, подсказка у курсора) зовут ЕГО —
   обратная матрица поворота живёт в EPViewport.screenToWorld, копий формулы по коду больше нет (§7.1).
   Отсчёт — от окна холста (.canvas-scroll): его rect НЕ вращается, в отличие от #canvas, у которого
   getBoundingClientRect при повороте вернул бы габарит повёрнутого прямоугольника (все 6 прежних копий
   формулы на этом бы сломались). */
function clientToWorld(clientX,clientY){
  const r=canvasScroll.getBoundingClientRect();
  return EPViewport.screenToWorld({x:clientX-r.left,y:clientY-r.top},view());
}
/* применить вид к DOM: одна дешёвая трансформация, без перерисовки слоёв и объектов —
   поэтому панорама и зум не грузят интерфейс на каждое движение мыши. rotate(worldAngle) вращает
   ВЕСЬ холст как один лист (Б3, ч.2а); порядок translate→rotate→scale совпадает с матрицей в
   EPViewport, иначе экран↔мир разошлись бы с картинкой. --world-rot — КОНТР-угол для прямых подписей
   комнат и значков постов: CSS-переменная наследуется детьми #canvas, те крутят себя обратно (§ DoD п.4). */
function applyView(){
  const a=state.worldAngle||0;
  canvas.style.transform=`translate(${state.panX}px,${state.panY}px) rotate(${a}deg) scale(${state.scale})`;
  canvas.style.setProperty("--world-rot",(-a)+"deg");
}
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
    {padding:EPConfig.viewFitPadding,minScale:EPConfig.viewMinScale,maxScale:EPConfig.viewMaxScale,angle:state.worldAngle||0}));
  updateZoomUi(true);scheduleSave();
}
$("zoomFit").onclick=fitToScreen;

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
      bumpPlanToken();   /* новый чертёж — то же поколение, что и сброс: гонки прерываются */
      state.planLoaded=true;state.planLabel=file.name;
      updatePlanUi();clearAnnotations();
      /* новый чертёж показываем целиком, иначе после «скрыть» пользователь увидит пустоту */
      state.planVisibility="show";applyPlanVisibility();
      /* новый чертёж — без поворота: прежний угол к чужой картинке не относится (Б3, ч.1) */
      state.planRotation=0;applyPlanRotation();
      markCanvasUsed();
      /* Б4, ч.Б: загрузка чертежа — ОТДЕЛЬНЫЙ шаг отмены и СРАЗУ сохраняется (переживает F5). Раньше
         applyImportedPlan не звал ни persistProject, ни scheduleSave — чертёж пропадал при перезагрузке
         до следующего действия, а откат его не видел. Ошибочная загрузка сюда не доходит (onerror ниже
         восстанавливает прежний src и reject — шага нет). */
      persistProject();
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
/* «Очистить холст» сносит всё нарисованное — а с ним теряет смысл и угол мира: сбрасываем worldAngle
   в 0 (Б3, ч.2а). Сброс — ТЕМ ЖЕ правилом, что поворот (setWorldAngle → EPViewport.rotateAt вокруг
   центра окна), а НЕ прямой записью worldAngle=0: прямая запись оставляла panX/panY подобранными под
   старый угол, и пустой лист #canvas уезжал за край окна (при 270° целиком ниже окна), клики переставали
   попадать в холст. setWorldAngle подбирает pan под угол 0, и лист остаётся на экране на месте.
   Режим органов (rotateTarget) — предпочтение пользователя, не трогаем. Угол ПОДЛОЖКИ (planRotation)
   сбросит clearPlan при «Убрать план», здесь плана не касаемся. setWorldAngle сам зовёт applyView/
   syncRotationUi/renderScaleRuler/persistProject — вызываем его ПОСЛЕ очистки, чтобы снимок сохранил
   уже пустой холст.
   Б4: очистка — ОДИН шаг отмены. Внутри два сохранения (renderAll→scheduleSave сносит нарисованное,
   setWorldAngle→persistProject сбрасывает угол) на РАЗНЫХ промежуточных состояниях плана — без защиты
   они дали бы два шага. Глушим обе записи замком применения и фиксируем ОДИН шаг завершающим
   persistProject: отмена возвращает и нарисованное, и угол разом. */
$("clearBtn").onclick=()=>{_applyingSnapshot=true;try{state.devices=[];state.posts=[];state.rooms=[];state.walls=[];state.autoWalls=[];state.wallPoints=[];state.roomLines=[];state.roomFieldMemory=[];finishRoomLineChain();state.selected=null;clearAnnotations();renderAll();renderProperties();renderSummary();setWorldAngle(0)}finally{_applyingSnapshot=false}persistProject()};
$("undoBtn").onclick=undoPlan;   /* кнопки «Отменить»/«Вернуть» над планом (Б4, ч.А) */
$("redoBtn").onclick=redoPlan;
$("autoTraceBtn").onclick=autoTracePlan;
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
/* Мастер отделки (вид «С картинками»). Закрытие — крестик, «Отмена», клик мимо и Esc (в глобальном
   onkeydown), как у #scaleModal/#pdfPageModal: черновик выбора отбрасывается, в проект ничего не
   пишется (запись только по «Применить»). */
$("closeFramePicker").onclick=$("cancelFramePicker").onclick=closeFramePicker;
$("applyFramePicker").onclick=applyFramePicker;
$("framePickerModal").onclick=e=>{if(e.target===$("framePickerModal"))closeFramePicker()};
$("clearAutoTraceBtn").onclick=()=>{state.autoWalls=[];refreshAfterRoomAssignments(()=>{drawWalls();renderRooms()}, scheduleSave);toast("Автоматические линии удалены")};
$("traceSensitivity").oninput=e=>$("traceSensitivityValue").textContent=e.target.value+"%";
$("saveProjectBtn").onclick=saveProject;
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
/* реквизиты КП: правки полей сохраняются в проект (settings.docHeader) */
Object.keys(DOC_FIELDS).forEach(id=>{$(id).oninput=applyDocHeader});
/* галочка «показывать Разработчика в шапке КП» — поле проекта (settings.docHeader.developerShow) */
$("docDeveloperShow").onchange=applyDeveloperShow;
/* блоки реквизитов строятся из EPDocRequisites — вешаем делегирование на контейнеры. input ловит
   ввод в текстовые поля, change — переключение галочек. «Мои» идут в EPPrefs (бланк человека),
   «заказчик» — в проект. */
$("myRequisites").oninput=applyMyRequisites;
$("myRequisites").onchange=applyMyRequisites;
$("customerRequisites").oninput=applyCustomerRequisites;
$("customerRequisites").onchange=applyCustomerRequisites;
/* Картинки бланка (логотип/подпись/печать): скрытый file-input открывается кнопкой; после выбора
   обнуляем value, чтобы тот же файл можно было выбрать повторно (change иначе не сработает).
   «Убрать» чистит EPPrefs. Все три — ОДИН загрузчик loadDocImage(file, kind), различие в kind. */
[["docLogoBtn","docLogoInput","docLogoRemove","logo"],
 ["docSignatureBtn","docSignatureInput","docSignatureRemove","signature"],
 ["docStampBtn","docStampInput","docStampRemove","stamp"]].forEach(([btn,input,remove,kind])=>{
  $(btn).onclick=()=>$(input).click();
  $(input).onchange=e=>{const f=e.target.files&&e.target.files[0];if(f)loadDocImage(f,kind);e.target.value="";};
  $(remove).onclick=()=>clearDocImage(kind);
});
/* Условия сделки в подвале КП — общий бланк компании (EPPrefs), не поле проекта: сохраняем в EPPrefs
   на каждый ввод, обрезая по общему пределу длины. */
$("docTerms").oninput=e=>saveCompanyTerms(e.target.value);
$("offerOptions").onchange=e=>applyOfferOption(e.target);
document.querySelectorAll("[data-offer-preset]").forEach(btn=>{
  btn.onclick=()=>applyOfferPreset(btn.dataset.offerPreset);
});
/* Свои наборы рисуются из EPPrefs уже после этого биндинга — вешаем делегирование на контейнер:
   «применить» берёт слот, «сохранить/перезаписать» кладёт в него текущий состав. */
$("offerCustomPresets").onclick=e=>{
  const apply=e.target.closest("[data-custom-apply]");
  if(apply){applyCustomOfferPreset(Number(apply.dataset.customApply));return;}
  const save=e.target.closest("[data-custom-save]");
  if(save)saveCustomOfferPreset(Number(save.dataset.customSave));
};
/* Условия сделки: работы, материалы, скидка, ставка НДС и его наличие в КП. Всё это —
   настройки проекта, поэтому потребителей не перечисляем (applyProjectSettings). Строка
   с disabled остаётся здесь: это состояние самого органа ввода, а не чужое представление. */
function applyTerms(){
  EP_DATA.settings.workPercent=Math.max(0,Math.min(200,Number($("workInput").value)||0));
  EP_DATA.settings.materialsPercent=Math.max(0,Math.min(200,Number($("materialsInput").value)||0));
  EP_DATA.settings.discountPercent=Math.max(0,Math.min(100,Number($("discountInput").value)||0));
  EP_DATA.settings.vatPercent=Math.max(0,Math.min(30,Number($("vatInput").value)||0));
  EP_DATA.settings.vatMode=$("vatMode").value;
  /* «НДС, %» не нужен, когда НДС «Не учитывать»: гасим поле, чтобы на экране не было
     противоречия «режим без НДС, но рядом активная ставка». Само правило «режим → суммы»
     живёт в EPEstimate.vatBreakdown — здесь только состояние органа ввода. */
  $("vatInput").disabled=EP_DATA.settings.vatMode==="none";
  applyProjectSettings();
}
["workInput","materialsInput","discountInput","vatInput"].forEach(id=>{$(id).oninput=applyTerms});
$("vatMode").onchange=applyTerms;
/* Записать личную скидку НА ОБЪЕКТЫ строки (А2): скидка живёт на самом посте/изделии
   (post.discount/device.discount), а не в карте по ключу строки — иначе перенумерация или смена
   стены уводили бы её на чужую позицию. members — все объекты строки (est.groups[].members); поле
   строки правит их ЦЕЛИКОМ. Пусто → УДАЛЯЕМ поле discount (строка считается по общей; 0 ≠ пусто —
   0 остаётся явной «скидкой 0%»). Иначе зажимаем 0..100 ровно как общую скидку (applyTerms). Пересчёт
   и сохранение — applyProjectSettings (та же дверь, что у прочих настроек проекта). */
function applyItemDiscount(members,rawValue){
  const raw=String(rawValue).trim();
  const val=raw===""?null:Math.max(0,Math.min(100,Number(raw)||0));
  (Array.isArray(members)?members:[]).forEach(o=>{if(!o)return;if(val==null)delete o.discount;else o.discount=val;});
  applyProjectSettings();
}
/* Обработчик изменения поля «скидка, %» строки. Нечисловой ввод (у <input type=number> при badInput
   .value === "") НЕ должен молча снимать заданную скидку — такой ввод игнорируем, оставляя прежнее.
   Пустое поле без badInput — это осознанное «убрать свою скидку» и доходит до applyItemDiscount.
   Перерисовка #specList (applyProjectSettings) уничтожает поле, куда браузер увёл фокус по Tab, —
   запоминаем следующий фокус ДО перерисовки и, если это тоже поле скидки, возвращаем его. */
function onSpecDiscountChange(input){
  if(!input)return;
  if(input.validity&&input.validity.badInput)return;
  const g=_specGroups[Number(input.dataset.discRow)];
  if(!g)return;
  const active=(typeof document!=="undefined")?document.activeElement:null;
  const backRow=active&&active.dataset?active.dataset.discRow:null;
  applyItemDiscount(g.members,input.value);
  if(backRow!=null){
    const list=$("specList");
    const back=list&&list.querySelector?list.querySelector('input[data-disc-row="'+backRow+'"]'):null;
    if(back&&back.focus)back.focus();
  }
}
/* Делегируем на контейнер — #specList перерисовывается в renderSummary, а слушатель на нём живёт.
   Событие change (не input): перерисовка на каждом символе сбивала бы набор. */
$("specList").onchange=e=>{
  const input=e.target&&e.target.closest?e.target.closest("input[data-disc-row]"):null;
  onSpecDiscountChange(input);
};
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
  /* Отмена/возврат плана (Б4, ч.А). Решение по нажатию — чистый EPHistory.hotkeyAction: он сам
     пропускает текстовые поля (там Ctrl+Z — браузерная отмена ввода), разбирает Ctrl/⌘+Z/Y/Shift+Z и
     молчит при открытой модалке. Модалки, при которых не работаем, — те же пять окон, что и везде. */
  const anyModalOpen=["postModal","framePickerModal","scaleModal","pdfPageModal","wallScopeModal"]
    .some(id=>{const m=$(id);return m&&m.classList.contains("open")});
  const histAction=EPHistory.hotkeyAction(e,{modalOpen:anyModalOpen});
  if(histAction){e.preventDefault();histAction==="undo"?undoPlan():redoPlan();return}
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
    /* Мастер отделки — самостоятельная модалка (открыт из свойств комнаты, не поверх конструктора):
       Esc закрывает её, отбрасывая черновик, как у остальных простых окон. */
    if($("framePickerModal").classList.contains("open")){closeFramePicker();return}
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
    if(nudge){
      /* Стрелки двигают объект в ЭКРАННЫХ направлениях (влево на экране = влево при любом угле мира):
         экранное направление переводим в мировую дельту обратной матрицей R(−worldAngle). Длина шага —
         шаг сетки в мире (поворот длину сохраняет). При worldAngle=0 — прежние (dx,dy) без изменений. */
      const a=(state.worldAngle||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
      const wx=nudge[0]*c+nudge[1]*s,wy=-nudge[0]*s+nudge[1]*c;
      if(moveSelectedBy(wx,wy)){e.preventDefault();return}
    }
  }
  /* Backspace во время рисования разметки — снять последнюю точку (Esc — выход из режима) */
  if(e.key==="Backspace"&&state.tool==="roomline"&&!typing&&!inBuilder&&state.roomLinePoints.length){e.preventDefault();removeLastRoomLinePoint()}
  /* B — переключение видимости подложки (независимо от раскладки, по физической клавише) */
  if(e.code==="KeyB"&&!typing&&!inBuilder&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();cyclePlanVisibility()}
  /* Пробел — режим «рука» для панорамы (курсор-подсказка). preventDefault, чтобы
     пробел не прокручивал страницу и не «нажимал» сфокусированную кнопку. */
  if(e.code==="Space"&&!typing&&!inBuilder){e.preventDefault();onSpaceKeydown()}   /* режим «рука» держит js/canvasInput.js — spaceDown и все его писатели/читатели там */
};
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

/* Сборка и открытие документов — КП и лист монтажника — вынесены в js/docs.js (EPDocs.attach, И1 кусок 3).
   Поднимаем ОДИН раз здесь, на самом низу файла: к этому моменту определены все зависимости, которые
   документы берут из app.js (смета, реквизиты, бланк компании, расчёт групп света) — нет TDZ. attach сам
   провязывает кнопки «Сформировать КП» (#pdfBtn) и «Лист монтажника» (#installSheetBtn) — как postBuilder
   провязывает #postModal, — и возвращает buildPostSheet/openInstallSheet: их дальше берёт окно поста
   (EPPostBuilder.attach ниже), поэтому docs.attach ОБЯЗАН стоять ПЕРЕД ним, иначе чтение этих const до
   инициализации дало бы ReferenceError (TDZ) при загрузке страницы. Чистые построители HTML уже в модулях
   (EPOfferPdf/EPInstallSheet/EPPlanLabels/EPSupplierSpec/EPExplodedView) — сюда приходят готовыми. */
const {buildPostSheet,openInstallSheet}=EPDocs.attach({
  $,STANDARD_LABEL,assembledPostHtml,assembledPostSpec,buildEstimate,canvas,companyLogo,companySignature,
  companyStamp,companyTerms,displayCurrency,displayRate,docHeader,esc,frameProduct,keySlotKind,lightingHtml,
  lightingRowsFor,mechanismSpan,money,postComposition,postCost,postTotalCost,postsForGroupLinks,product,
  productImage,projectLighting,roomNamePoint,scheduleSave,state,toast
});

/* Окно поста (конструктор) вынесено в js/postBuilder.js (И1, шаг 3). Поднимаем его ОДИН раз здесь, на
   самом низу файла, — к этому моменту определены все зависимости, которые окно берёт из app.js (нет TDZ),
   а init() ниже уже вправе звать renderPostSlotCountSelect. attach провязывает кнопки #postModal внутри
   себя (как EPWallScope.create) и возвращает функции, которые app.js зовёт сам: openPostBuilder
   (renderTemplates/renderPosts/renderProperties/keydown), renderPostSlotCountSelect (init),
   requestClosePostBuilder (keydown). Плюс builderRoomFilter — его app.js напрямую не зовёт, но передаёт
   в оставшийся здесь общий frameFacingHintText (тот же, что у «Подобрать накладку»), который обращается к
   builderRoomFilter; функция переехала в модуль, поэтому берём её обратно отсюда. */
const {openPostBuilder,renderPostSlotCountSelect,requestClosePostBuilder,builderRoomFilter}=EPPostBuilder.attach({
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
});

/* Распознавание и разметка помещений вынесены в js/roomDetect.js (И1, последний кусок). Поднимаем
   ОДИН раз здесь и ОБЯЗАТЕЛЬНО ДО EPCanvasInput.attach: ввод на холсте берёт из ctx addRoomLinePoint
   (клик инструментом «Разметка»), а он теперь const из этого attach — окажись он позже, чтение имени
   при сборке ctx холста дало бы ReferenceError (TDZ) на загрузке. attach сам вешает превью-обработчик
   разметки (canvas pointermove) и кнопки распознавания/сборки и возвращает то, что app.js зовёт сам:
   drawRoomLines (renderAll/restoreProject), addRoomLinePoint (уходит в EPCanvasInput.attach),
   finishRoomLineChain (clearBtn), removeLastRoomLinePoint (keydown Backspace) и buildRoomsFromLines
   (его зовёт оставшийся в app.js scheduleRoomsFromLines: гейт автосейва _autosaveOn делит его со
   scheduleSave, поэтому scheduleRoomsFromLines остался в app.js). renderRooms передаём ЛЕНИВОЙ стрелкой:
   сам он — const из EPRooms.attach ниже, на момент вызова ещё не инициализирован; разметка зовёт его
   лишь при действии пользователя, когда const уже готов (TDZ нет). */
const {addRoomLinePoint,drawRoomLines,finishRoomLineChain,removeLastRoomLinePoint,buildRoomsFromLines}=EPRoomDetect.attach({
  $,SVG_NS,canvas,canvasScroll,clientToWorld,markCanvasUsed,persistProject,planLostDuringOp,refreshAfterRoomAssignments,
  renderAll,renderRooms:()=>renderRooms(),roomLabelPoint,roomNamePoint,scheduleRoomsFromLines,scheduleSave,
  showTraceProgress,state,toast,uid,updateStatus,wallRadiusFor
});

/* Ввод на холсте (клики, перенос, панорама, зум) вынесен в js/canvasInput.js (И1, кусок 4). Поднимаем
   его ОДИН раз здесь и ОБЯЗАТЕЛЬНО ДО EPRooms.attach: слой комнат ниже берёт из ctx makeDraggable и
   placePendingAtEvent, а они теперь const из этого attach — окажись он позже, чтение этих имён при
   сборке ctx комнат дало бы ReferenceError (TDZ) на загрузке. attach сам провязывает обработчики холста
   (canvas.onclick, слушатели окна вида, keyup/blur пробела) и возвращает то, что app.js зовёт сам:
   makeDraggable (его зовёт compactIcon и передаёт дальше в EPRooms.attach), placePendingAtEvent
   (тоже уходит в EPRooms.attach — клик по табличке в размещении), onSpaceKeydown (его зовёт keydown-
   диспетчер на пробеле). renderRooms передаём ЛЕНИВОЙ стрелкой: сам он — const из EPRooms.attach ниже,
   на момент этого вызова ещё не инициализирован; makeDraggable зовёт его лишь при переносе (finishDrag),
   когда const уже готов, поэтому стрелка вычисляет ссылку в момент вызова, а не сборки ctx (TDZ нет). */
const {makeDraggable,placePendingAtEvent,onSpaceKeydown}=EPCanvasInput.attach({
  $,addPending,addRoomLinePoint,addScalePoint,addWallPoint,applySelectionClasses,applyView,
  buildSpaceComponents,canvas,canvasScroll,clientToWorld,ensureSelectTool,getRoomForPoint,hideHover,markCanvasUsed,
  tightestRoomAtPoint,refreshAfterRoomAssignments,removeEntity,renderAll,renderGroupLinks,renderProperties,
  renderRooms:()=>renderRooms(),renderSummary,scheduleSave,selectEntity,setTool,state,toast,uid,
  updateObjectRoom,updateStatus,zoomBy
});

/* Слой комнат (таблички, контуры, правка вершин) вынесен в js/rooms.js (И1, кусок 2). Поднимаем его
   ОДИН раз здесь, на самом низу файла, рядом с окном поста: к этому моменту определены все зависимости,
   которые слой берёт из app.js (нет TDZ), а init() ниже уже вправе звать renderRooms через renderAll.
   attach возвращает функции, которые app.js зовёт сам: renderRooms (init/renderAll и обработчики через
   refreshAfterRoomAssignments), relabelContourRooms (restoreProject — миграция открываемого проекта),
   updateRoomLabelText (flushRoomDraft). Правку вершин attach держит внутри — её зовёт только renderRooms. */
const {renderRooms,relabelContourRooms,updateRoomLabelText}=EPRooms.attach({
  $,SVG_NS,canvas,clientToWorld,esc,formatArea,getObjectsInRoom,makeDraggable,persistProject,placePendingAtEvent,
  refreshAfterRoomAssignments,removeEntity,roomAreaM2,roomDisplayArea,roomLabelPoint,roomNamePoint,
  selectEntity,state,toast,updateStatus
});

init().catch(e=>reportFailure("Инициализация не завершилась:",e));
})();
