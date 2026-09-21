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
function productPicture(item,{className="",detail=false,label="",eager=false,style=""}={}){
  const imageUrl=productImage(item,{detail});
  /* Нет фото → рисуем значок товара (item.icon) и подпись «Нет фото», чтобы отсутствие снимка
     читалось как «фото просто нет», а не «картинка сломалась» (владелец принял голубой квадрат
     с крохотным значком за баг). Подпись даём ТОЛЬКО когда фото реально нет: иначе она осталась
     бы в разметке товаров с фото (пусть и скрытая CSS) — а тест «у товара с фото надписи нет»
     и есть страховка от этого. В тесных местах (слоты сборки, список накладок) подпись прячется
     через CSS, значок остаётся, а title="Нет фото" даёт ту же подсказку по наведению. */
  const noPhoto=!imageUrl;
  return `<span class="product-picture ${className}${imageUrl?" has-image":""}"${noPhoto?` title="Нет фото"`:""}${style?` style="${esc(style)}"`:""}>
    ${imageUrl?`<img src="${esc(imageUrl)}" alt="${esc(label||item?.name||"Изображение товара")}" loading="${eager?"eager":"lazy"}" decoding="async" data-product-picture>`:""}
    <span class="product-picture-fallback" aria-hidden="true"><span class="product-picture-glyph">${esc(item?.icon||"?")}</span>${noPhoto?`<span class="product-picture-nophoto">Нет фото</span>`:""}</span>
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
function updateStatus(text){$("status").textContent=text||`Элементов: ${state.devices.length} · Постов: ${state.posts.length} · Комнат: ${state.rooms.length}`}
function markCanvasUsed(){$("canvasEmpty").style.display="none"}

async function init(){
  state.products=await DataService.getProducts();
  state.templates=await DataService.getSavedPosts();
  renderOfferOptions();   /* restoreProject синхронизирует уже существующие чекбоксы */
  const restored=await restoreProject();
  loadCachedRate();
  fillDocHeaderInputs();   /* реквизиты КП: заполнить поля (и дату «сегодня» на чистом старте) */
  renderTemplates();renderAll();renderSummary();updateScaleUi();updateRateUi();applyPlanVisibility();
  renderLightingSchemeSelect();   /* селектор схемы в панели проекта: заполняем и на чистом старте */
  renderProjectWallTypeSelect();  /* тип стены проекта — там же, рядом со схемой */
  renderProjectBacklight();       /* подсветка клавиш — галочка и оба селектора из каталога */
  renderPostSlotCountSelect();    /* модульности рамки строим из каталога (разметка отдаёт пустой select) */
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
  /* клик по объекту не должен доходить до canvas.onclick (иначе в режиме размещения
     из каталога он поставил бы ещё один объект поверх) — выделение уже в makeDraggable */
  el.onclick=e=>e.stopPropagation();
  makeDraggable(el,entity,kind);return el;
}
function renderDevices(){canvas.querySelectorAll(".plan-icon.device-only").forEach(e=>e.remove());state.devices.forEach(d=>{const el=compactIcon(d,"device");el.classList.add("device-only");canvas.appendChild(el)})}
function renderPosts(){canvas.querySelectorAll(".plan-icon.post").forEach(e=>e.remove());state.posts.forEach(p=>{const el=compactIcon(p,"post");el.ondblclick=e=>{e.stopPropagation();openPostBuilder({placedId:p.id})};canvas.appendChild(el)})}
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
  posts.forEach(p=>{
    const groups=p.groups||[];   /* пост без групп поле groups не несёт (см. postsForGroupLinks) */
    if(!groups.length)return;
    const t=document.createElementNS(SVG_NS,"text");
    t.setAttribute("x",p.x);t.setAttribute("y",p.y+POST_ICON_HALF+11);
    t.setAttribute("class","group-link-label");
    t.textContent=groups.map(g=>g.label).join(" · ");
    svg.appendChild(t);
  });
}
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
function refreshRoomAfterEdit(room){
  const c=polygonCentroid(room.polygon);
  room.seedX=c.x;room.seedY=c.y;room.x=c.x-45;room.y=c.y-16;
  refreshAfterRoomAssignments(renderRooms, persistProject);
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
  refreshAfterRoomAssignments(renderAll);
}

/* ---- Определение комнат (OpenCV.js, ленивая загрузка) ----
   Чистая геометрия (полигоны, площади, флуд-фолл свободного пространства) вынесена
   в js/geometry.js (EPGeom) — см. PLAN 2.1; здесь берём её через алиасы, а привязка
   к state/DOM остаётся в этом файле. */
const {polygonCentroid,polygonAreaPx,pointInPolygon,componentAt,roomContourProbe,segmentsIntersection,distancePointToSegment}=EPGeom;
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
      const c=polygonCentroid(poly);
      const room={id:uid("room_"),name:"Комната "+(++next),area:"",polygon:poly,autoPolygon:true,seedX:c.x,seedY:c.y,x:c.x-45,y:c.y-16};
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
      const c=polygonCentroid(poly);
      const room={id:uid("room_"),name:"Комната "+(++next),area:"",polygon:poly,autoPolygon:true,seedX:c.x,seedY:c.y,x:c.x-45,y:c.y-16};
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
  const hit=ctx.polyRooms.find(r=>pointInPolygon(cx,cy,r.polygon));
  if(hit)return hit;
  const tolerance=EPConfig.roomEdgeTolerance;
  if(Number.isFinite(tolerance)&&tolerance>=0){
    const EPS=1e-9;
    let near=null,bestDist=Infinity,ambiguous=false;
    for(const room of ctx.polyRooms){
      const probe=roomContourProbe(cx,cy,room.polygon,ctx.walls||[],EPConfig.roomProbeInset);
      if(probe.blocked||probe.dist>tolerance)continue;
      if(probe.dist<bestDist-EPS){near=room;bestDist=probe.dist;ambiguous=false}
      else if(Math.abs(probe.dist-bestDist)<=EPS){ambiguous=true}
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
    const collectionFieldHtml=`<label class="room-collection-field">Коллекция накладок<select id="roomCollectionSelect">${collectionOptions}</select></label>
    <small class="prop-hint prop-collection-source${roomColl?" own":""}">${roomColl?"Конструктор поста в этой комнате предлагает накладки только этой коллекции":"Коллекция не задана — предлагаются все накладки каталога"}</small>`;
    const facingChosen=[roomColl?`Серия: ${roomColl}`:null].concat(facingSpecs.filter(s=>s.cur).map(s=>`${s.label}: ${s.cur}`)).filter(Boolean);
    const facingBody=facingView==="list"
      ?collectionFieldHtml+facingFieldsHtml
      :`<div class="room-facing-summary${facingChosen.length?" own":""}">${facingChosen.length?esc(facingChosen.join(" · ")):"Отделка не задана — предлагаются все накладки каталога"}</div>
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
  const capacity=frameSlotCount(frameProduct(src.frameId))||Math.max(1,Math.min(21,mechanismModulesTotal(sourceMechanismIds)||3));
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
  /* ⚠️ КОМНАТА ИЗВЕСТНА ДО СБОРКИ (ОТДЕЛКА-ПОРЯДОК, п.3). Пост на плане уже стоит в комнате —
     берём её (roomId поста). НОВЫЙ пост/шаблон комнаты не имеет: подставляем ПЕРВУЮ комнату проекта,
     чтобы отбор был активен сразу («выбираем комнату, для которой будем составлять пост»); человек
     меняет её селектором «Комната». Комнат в проекте нет → null: отбор не сужаем, поведение прежнее
     (собираем без ограничений), а не блокируем работу. */
  state.builder.roomId=placedId?(src.roomId??null):(state.rooms[0]?state.rooms[0].id:null);
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

/* Названия коллекций (серий) накладок каталога — из товаров, не константой в разметке.
   Один источник и для селектора «Коллекция комнаты», и для валидации room.collection. */
function frameCollectionList(){return EPCatalog.productCollections(byKind("frame"));}
/* Различные значения одного признака отделки накладки (E14) — из товаров, не константой в разметке.
   Один источник и для селекторов «Материал/Форма/Цвет накладки» в свойствах комнаты, и для валидации
   room.<признак> (EPRoom.roomFrameFacing). field — frameMaterial|frameShape|frameColor. */
function frameFacingList(field){return EPCatalog.productFacingValues(byKind("frame"),field);}
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
/* Критерий отбора накладок под ПРОИЗВОЛЬНУЮ комнату (E13 коллекция + E14 отделка) — ОДНА точка
   сборки (§7.1). Через неё ходят и конструктор (builderRoomFilter, комната редактируемого поста), и
   подмена накладки при размещении готового поста (frameForRoomPlacement, комната размещения). Валидация
   мёртвых (снятых из прайса) значений — в EPRoom: null → признак не сужает. */
function roomCatalogFilter(room){
  return {
    collection:EPRoom.roomCollection(room,frameCollectionList()),
    frameMaterial:EPRoom.roomFrameFacing(room,"frameMaterial",frameFacingList("frameMaterial")),
    frameShape:EPRoom.roomFrameFacing(room,"frameShape",frameFacingList("frameShape")),
    frameColor:EPRoom.roomFrameFacing(room,"frameColor",frameFacingList("frameColor"))
  };
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
/* Подмена накладки готового поста на накладку СЕРИИ КОМНАТЫ размещения (ОТДЕЛКА-ПОРЯДОК, п.5). Идёт
   ЧЕРЕЗ тот же отбор, что и весь каталог под комнату (roomCatalogFilter → productsForRoom, как
   collectionFramePool), а не через свою копию правил (§7.1). Возвращает:
     {frameId:null}          — накладку НЕ меняем: пост лёг вне комнат ИЛИ у комнаты нет ни серии, ни
                               отделки (иначе пул = весь каталог и мы подставили бы случайную накладку);
     {frameId:<id>}          — нашли накладку той же модульности → пост берёт её (и цену — она из
                               frameId во всех документах);
     {blocked:true,message}  — комната задаёт отделку, но накладки её серии/цвета нужной модульности в
                               каталоге нет: пост НЕ ставим с чужой накладкой, человеку говорим чего и
                               почему не нашли (формулировка в духе E14, frameFacingEmptyText). */
function frameForRoomPlacement(template,room){
  if(!room)return {frameId:null};
  const criteria=roomCatalogFilter(room);
  const constrained=criteria.collection||criteria.frameMaterial||criteria.frameShape||criteria.frameColor;
  if(!constrained)return {frameId:null};
  const pool=EPCatalog.productsForRoom(byKind("frame"),criteria);
  const frame=EPPosts.pickRoomFrame(template.frameId,pool,{frameProduct,frameSlotCount,frameFitsMechs:frameFitsTemplateMechs(template)});
  return frame?{frameId:frame.id}:{blocked:true,message:frameSwapEmptyText(template,room,criteria)};
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
function frameFacingEmptyText(list){
  return `Под выбранную отделку (${list}) в каталоге накладок нет — измените материал, форму или цвет в свойствах комнаты.`;
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
  if(sel.collection)parts.push(`серия «${sel.collection}»`);
  return parts.concat(frameFacingLabels(sel));
}
function frameFacingHintText(allFrames){
  const f=builderRoomFilter();
  const parts=frameFacingLabels(f);
  if(!parts.length)return "";
  const list=parts.join(", ");
  const shown=EPCatalog.productsForRoom(allFrames,f).length;
  const base=EPCatalog.productsForRoom(allFrames,{collection:f.collection}).length;
  return shown
    ?`Показано ${shown} из ${base} ${EPCatalog.pluralRu(base,"накладки","накладок","накладок")} · сузили: ${list}`
    :frameFacingEmptyText(list);
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
   нет). valuesOf различает серию (productCollections — серия у товара массив) и отделку
   (productFacingValues — скаляр). */
let framePickerRoomId=null,framePickerSel=null,framePickerStep=0;
const framePickerDeps={
  match:(frames,criteria)=>EPCatalog.productsForRoom(frames,criteria),
  valuesOf:(pool,prop)=>prop==="collection"?EPCatalog.productCollections(pool):EPCatalog.productFacingValues(pool,prop),
  imageOf:item=>productImage(item)
};
function openFramePicker(room){
  framePickerRoomId=room.id;
  /* Инициализация из ТЕХ ЖЕ настроек комнаты, что читает список-вид, с ТОЙ ЖЕ валидацией мёртвых
     значений (EPRoom): убранная из прайса серия/цвет не должны прийти в мастер как выбранные. */
  const sel={};
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
      <span class="frame-picker-crumb-value">${val?esc(val):"—"}</span>
    </button>`;
  }).join("");
  const step=steps[framePickerStep];
  const options=EPFramePicker.stepOptions(allFrames,framePickerSel,step.prop,framePickerDeps);
  const body=$("framePickerBody");
  if(options.length){
    body.innerHTML=`<div class="frame-picker-grid">`+options.map(o=>{
      const active=framePickerSel[step.prop]===o.value;
      /* Плитка с фото или, у ~40% накладок без фото, достойный фолбэк (название + счётчик, значок
         «без фото») вместо пустой дыры. Ошибку загрузки картинки ловит bindProductPictureFallbacks
         (снимает has-image → показывает фолбэк), как у карточек каталога. */
      const thumb=o.imageUrl
        ?`<span class="product-picture frame-pick-thumb has-image"><img src="${esc(o.imageUrl)}" alt="${esc(o.value)}" loading="lazy" decoding="async" data-product-picture><span class="product-picture-fallback" aria-hidden="true">без фото</span></span>`
        :`<span class="product-picture frame-pick-thumb"><span class="product-picture-fallback" aria-hidden="true">без фото</span></span>`;
      return `<button type="button" class="frame-pick-tile${active?" active":""}" data-value="${esc(o.value)}" aria-pressed="${active}">
        ${thumb}
        <span class="frame-pick-name">${esc(o.value)}</span>
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
     НОВЫЙ пост сюда не попадает: openPostBuilder даёт ему накладку по умолчанию (defaultFrame),
     так что requestedFrameId у него непустой — блокировка «создания с нуля» исключена. */
  const frameUnset=requestedFrameInfo.unset;
  /* ⚠️ ЧЕТВЁРТОЕ СОСТОЯНИЕ — НАКЛАДКА СНЯТА С ПРОИЗВОДСТВА (active:false), но остаётся выбранной.
     Решение владельца 02.09: проект мог быть сделан до снятия позиции, изделие физически
     существует и может лежать на складе — смета обязана считаться ПО НЕЙ, без сюрпризов. Поэтому,
     в отличие от frameMissing/frameUnset, сохранение РАЗРЕШАЕМ и идём нормальным путём (ёмкость,
     механизмы, деньги — всё от настоящей накладки). Отличие от нормы одно: помечаем «снята с
     производства» (в опции поля через frameOptions и приглушённым баннером в составе), чтобы
     человек видел, почему эта накладка не предлагается новым постам — её нет в byKind("frame").
     requestedFrame здесь заведомо разрешён в товар, поэтому с frameMissing/frameUnset это
     состояние не пересекается. Новым постам она не грозит: openPostBuilder берёт defaultFrame из
     byKind("frame") (active), а в списке выбора неактивных нет — они попадают в frameList только
     как УЖЕ стоящая в посте накладка. */
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
    frameSelect.innerHTML=frameList.length
      ?frameOptions(frameList,selectedFrameId)
      :'<option value="">Рамки не загружены</option>';
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
    /* ДВЕ РАЗНЫЕ причины — как их различает смета, так и человеку они говорят разное:
       frameMissing — артикул рамки ЗАДАН, но пропал из каталога (перезалит прайс), это сбой
       данных; frameUnset — накладки нет вовсе (пост восстановлен из хранилища без рамки), человек
       ещё не сделал выбор. Обе печатаются РОВНО одной строкой (одна причина на экране), тем же
       путём через composition-хост, но текстом отличаются. */
    const frameErrorHtml=frameMissing
      ?`<div class="builder-error" role="alert"><strong>Накладка поста недоступна</strong><span>Артикул рамки этого поста пропал из каталога — вероятно, перезалит прайс. Чтобы не подставить чужую накладку и не потерять механизмы, сохранение заблокировано: выберите накладку в поле «Накладка» вручную.</span></div>`
      :`<div class="builder-error" role="alert"><strong>Накладка поста не выбрана</strong><span>У этого поста нет накладки. Чтобы собрать и сохранить пост, выберите накладку в поле «Накладка» — без неё не определить ни ёмкость рамки, ни совместимые механизмы. Механизмы поста сохранены.</span></div>`;
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
  state.roomLines=[];finishRoomLineChain();
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
    const poly=rm.polygon,c=polygonCentroid(poly);
    /* roomSource — признак способа получения контура (по линиям/по сетке): запасной
       проход не подменяет основной молча, источник виден и в state, и в отчётах */
    const room={id:uid("room_"),name:"Помещение "+(++next),area:"",polygon:poly,autoPolygon:true,roomSource:rm.source,seedX:c.x,seedY:c.y,x:c.x-45,y:c.y-16};
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
  state.planLoaded=false;state.planLabel="";state.planVisibility="show";
  clearAnnotations();
  updatePlanUi();applyPlanVisibility();
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
    /* условия сделки и валюта — часть проекта, а не глобальная настройка приложения */
    terms:(({workPercent,materialsPercent,discountPercent,vatPercent,vatEnabled,rateSurchargePercent,wallType,lightingScheme,backlight,displayCurrency,eurRate,rateDate,rateSource})=>
      ({workPercent,materialsPercent,discountPercent,vatPercent,vatEnabled,rateSurchargePercent,wallType,lightingScheme,backlight,displayCurrency,eurRate,rateDate,rateSource}))(EP_DATA.settings)};
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
  const o=EPOfferOptions.normalize(EP_DATA.settings.offerOptions);
  const {offerGroup:group,offerKey:key}=input.dataset;
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

/* Состав ОДНОГО поста С ЦЕНАМИ для столбца «Стоимость артикулов» раскладки КП. Считаем ТЕМ ЖЕ
   EPEstimate.build на одном посте — не второй копией правила: build сам делает замену цельных
   изделий (effectiveMechanismIds), считает суппорт×коробку по составу и добавляет механизмы групп
   света, а цену каждого узла берёт из того же товара, что postCost/postPrice. Поэтому Σ(price×count)
   по списку РАВНА цене поста (postTotalCost → «Стоимость блока»), и два денежных столбца не разойдутся
   (§7.1). light — тот же расчёт групп света, что уходит в смету и картинку поста. Пустые узлы
   (count 0: «суппорт не требуется», коробка не подобрана у пустого поста) отбрасываем — печатать
   в разбивке нечего. */
function postPricedItems(post,light){
  const g=EPEstimate.build({devices:[],posts:[post],
    product,frameProduct,postCost,postComposition,
    lightingOf:po=>lightingRowsFor(po,light),
    settings:EP_DATA.settings}).groups[0];
  return g?g.items.filter(it=>it&&it.count>0):[];
}
/* Раскладка постов для КП (PLAN 1): по строке на пост — номер, наполнение словами с
   количеством, модульность, иллюстрация (картинка накладки). Порядок — по номеру. */
function buildPostLayout(options,light){
  /* Один расчёт групп света на всю раскладку — тот же, что уходит в смету и в блок «Группы света»
     этого КП (generateCommercialOffer передаёт его сюда). Нужен, чтобы цельное изделие и в строке
     «N × …», и в картинке поста показывалось ЗАМЕНОЙ (09001→09005), как в смете. */
  const lite=light===undefined?projectLighting():light;
  return state.posts.slice().sort((a,b)=>(Number(a.number)||0)-(Number(b.number)||0)).map(p=>{
    const comp=postComposition(p);
    /* Эффективные механизмы поста: исходные id с подменой цельных изделий на подобранную замену —
       ровно как в смете (EPEstimate.effectiveMechanismIds по строкам групп света поста). По ним и
       считаем «N × …», иначе колонка печатала бы «выключатель» там, где смета берёт «переключатель». */
    const effIds=EPEstimate.effectiveMechanismIds(p.mechanismIds,lightingRowsFor(p,lite));
    /* Наполнение поста словами с количеством: механизмы даёт EPPosts.fillSummary, следом —
       подсветка клавиш. LED вставлены в механизмы и уже оплачены (comp.backlight.items идёт в
       цену поста и в смету), а колонка о них молчала — как раньше молчали свод и лист монтажника.
       Числа берём из уже посчитанного comp.backlight (backlightPlan), второй копии подбора нет.
       Все подобранные LED поста сводим в ОДНУ позицию «Подсветка клавиш — N» — колонка сводит
       наполнение по словам, а не по артикулам («Клавиша — 3»), а подпись берём ту же, что и группа
       в своде поставщику. Пробел (механизм подсветку принимает, совместимой в каталоге нет)
       называем словами «подсветка не подобрана» — дословно как в смете, своде и листе монтажника —
       и в количество к заказу не выводим (noCount): такой строки в fillSummary не бывает, флаг
       отличает её в рендере. Выключена/не подобрана → items и gaps пусты → строк подсветки нет,
       таблица байт в байт как раньше; comp без поля backlight (старый рукотворный состав вне
       приложения) — как отсутствие подсветки, тот же защитный приём, что в смете и своде. */
    const fill=EPPosts.fillSummary(effIds,{product});
    const back=comp.backlight;
    if(back&&back.items&&back.items.length)fill.push({word:"Подсветка клавиш",count:back.items.length});
    if(back&&back.gaps&&back.gaps.length)fill.push({word:back.gaps.length>1?`${back.gaps.length} × подсветка не подобрана`:"подсветка не подобрана",noCount:true});
    return {
      number:p.number,
      modules:comp.modulesTotal,
      fill,
      box:{name:(comp.box||comp.boxFallback)?.name,code:(comp.box||comp.boxFallback)?.code,count:comp.boxCount},
      frameCode:comp.frameAvailability.code,
      /* Стоимость блока для одноимённого столбца (набор «Для клиента»): полная цена ЭТОГО поста —
         состав плюс механизмы его групп света. Считает postTotalCost → EPEstimate.postPrice, ТА ЖЕ
         функция, что у панели свойств и строки сметы (§7.1), поэтому раскладка и смета не разойдутся.
         Считаем всегда; печатать ли столбец, решает выбранный набор (options.layout.price/prices). */
      price:postTotalCost(p,lite),
      /* Разбивка цены поста по изделиям для столбца «Стоимость артикулов» (набор «Для дизайнера»):
         тот же расчёт, что смета, и та же замена цельных изделий — постоянная замена лежит в build.
         Считаем всегда; печатать ли столбец, решает набор (options.layout.itemPrices/prices). */
      itemPrices:postPricedItems(p,lite),
      /* Иллюстрация — собранный пост (EPPostImage), а не фото одной накладки: инлайн-стили,
         поэтому одинаково рисуется в окне печати КП. */
      assembledImageHtml:assembledPostHtml(p,{size:"md",articles:options?.articles!==false},lite),
      frameName:comp.frameAvailability.displayName,
      /* Исправную накладку под картинкой не дублируем. Важное состояние — исчезнувший
         артикул, снятая позиция или отсутствие выбора — печатается прямо в раскладке. */
      frameStatusText:comp.frameAvailability.available?"":comp.frameAvailability.displayName
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
function planLabelsSpec(){
  const img=$("planImage");
  /* Режим «скрыта» приравниваем к «подложки нет»: раз проектировщик её убрал, в документ она
     не идёт; «бледная» (dim) печатается как обычная подложка. */
  const showImg=state.planLoaded&&img&&img.src&&img.naturalWidth&&img.naturalHeight&&state.planVisibility!=="hide";
  if(!state.posts.length&&!state.rooms.length)return null;
  const spec={
    /* Посты с группами — та же сборка, что и для связей на холсте (второй копии правила нет).
       Геометрию (линии, порядок цепочки) считает чистый EPPlanLabels.layout. */
    posts:postsForGroupLinks(),
    /* Контурное помещение отдаём с полигоном и якорем-центроидом (там же, где на плане стоит
       его площадь); комнату без контура (инструмент «T») — одной точкой подписи (seedX/seedY,
       с тем же фолбэком x+55/y+18, что и в buildSpaceComponents). */
    rooms:state.rooms.map(r=>{
      if(r.polygon&&r.polygon.length>2){
        const c=polygonCentroid(r.polygon);
        return {name:r.name,polygon:r.polygon,x:c.x,y:c.y};
      }
      return {name:r.name,x:r.seedX!=null?r.seedX:r.x+55,y:r.seedY!=null?r.seedY:r.y+18};
    })
  };
  if(showImg){
    spec.imageUrl=planImageForDoc(img);
    spec.natW=img.naturalWidth;spec.natH=img.naturalHeight;
    spec.canvasW=canvas.clientWidth;spec.canvasH=canvas.clientHeight;
  }
  return spec;
}
/* Готовая секция плана для документа — пустая строка, если рисовать нечего. Режим «подложка
   скрыта» убирает из документа только фон-подложку (см. planLabelsSpec), но не сам блок:
   контуры помещений и бирки постов нужны для сверки в любом случае. */
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
      const frameInfo=comp.frameAvailability;
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
      /* Цельное изделие своей строкой заказа НЕ идёт: расчёт подменил его артикул прямо в
         mechanismIds (effIds ниже), и поставщик заказывает уже замену. Отдельными позициями
         остаются только клавиши (голые механизмы за ними) — EPEstimate.separateLighting. */
      const rows=lightingRowsFor(p,light);
      const effIds=EPEstimate.effectiveMechanismIds(p.mechanismIds,rows);
      const lightItems=EPEstimate.separateLighting(rows)
        .filter(r=>!r.missing||EPLightingGroups.isSupplyGap(r.missingReason))
        .map(r=>r.missing
          ?{code:"",name:`Механизм группы «${r.groupLabel||"—"}» не подобран`,kind:"mechanism"}
          :{code:r.code,name:r.name,unit:r.product&&r.product.unit,kind:"mechanism"});
      return {
        mechanisms:effIds.map(id=>item(product(id))||{code:"",name:`Механизм не найден (арт. ${id})`}).concat(lightItems),
        frame:frameInfo.unset?null:(frameInfo.frame
          ?Object.assign(item(frameInfo.frame),{name:frameInfo.displayName})
          :{code:"",name:frameInfo.displayName,kind:"frame"}),
        /* Суппорт отдаём вместе с признаком «подобран нами, заказчиком не подтверждён»:
           пометка «(предположительно)» обязана быть во ВСЕХ документах одинаковой, свод не
           исключение. supportNotRequired (крышки IP55 без планки) — не пробел подбора, и
           EPSupplierSpec по нему строку не печатает. */
        support:item(comp.support),supportCount:comp.supportCount,
        supportAssumed:comp.supportAssumed,supportNotRequired:comp.supportNotRequired,
        /* Коробка — точная либо стандартно-совместимый фолбэк: тот же выбор, что в листе
           монтажника и в цене поста (тип стены проекта знает только приложение). */
        box:item(comp.box||comp.boxFallback),boxCount:comp.boxCount,
        /* Подсветка клавиш: подобранные LED (по объекту на принимающий механизм) и число
           пробелов (принимает, совместимой нет). Числа берём из уже посчитанного postComposition
           — той же backlight.items/gaps, что идёт в цену поста и в смету; второй копии подбора
           не заводим. Выключена/не подобрана → items пуст, gaps пуст → свод как раньше.
           comp без поля backlight (старый рукотворный состав вне приложения) — как отсутствие
           подсветки, тот же защитный приём, что в смете (estimate.js): свод не падает. */
        backlight:(comp.backlight?comp.backlight.items:[]).map(u=>({code:u.accessory.code,name:u.accessory.name,unit:u.accessory.unit})),
        backlightGaps:comp.backlight?comp.backlight.gaps.length:0
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
function supplierSpecHtml(opts,light,options){
  return EPSupplierSpec.buildHtml(Object.assign(supplierSpecData(light),opts||{}),{esc,
    showArticles:options?.articles!==false,
    itemText:(name,code)=>options?.articles===false?EPOfferOptions.itemText(name,false,code):name});
}

/* Детали поста для взрыв-схемы листа монтажника (EPExplodedView). Собираем ИЗ УЖЕ ПОСЧИТАННОГО:
   comp (суппорт/коробка/накладка — товары каталога с kind/categoryId/icon), layout (механизмы с
   позицией и товаром) и frameSpec (фото/окна накладки, что уже собрал assembledPostSpec) — второй
   раз в каталог не ходим. Порядок деталей — как разносят сборку от лица к стене: накладка →
   механизмы (с их LED подсветки за клавишей) → суппорт → коробка. Значок детали задаём признаками товара (categoryId+icon+name):
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
  const frameInfo=comp.frameAvailability||null;
  const photoOf=item=>productImage(item,{detail:true});   // "" если фото нет/плейсхолдер (сам фильтрует)
  if(frameInfo?!frameInfo.unset:!!frame){
    /* У накладки основной источник — productImage (без окон, ловит большинство накладок); photoReady
       по frameSpec оставлен ЗАПАСНЫМ — на случай, когда своего productImage нет, а измеренное фото
       из собранного spec всё же есть. wide → широкий бокс во взрыв-схеме (накладка шире, чем высокая). */
    const framePhoto=photoOf(frame)||(EPPostImage.photoReady(frameSpec)?frameSpec.imageUrl:"");
    parts.push({
      role:"Накладка",name:frameInfo?frameInfo.displayName:frame.name,code:frameInfo?frameInfo.code:frame.code,
      icon:{categoryId:frame?.categoryId,icon:frame?.icon,name:frameInfo?frameInfo.displayName:frame.name},
      photo:framePhoto?{imageUrl:framePhoto,wide:true}:null
    });
  }
  /* Механизм группы света физически стоит ЗА клавишей и своей ячейки модуля не имеет.
     Показываем его СРАЗУ ЗА своей клавишей и тоже ролью «Модуль»: подряд идущие «Модули»
     EPExplodedView сворачивает в ОДНУ колонку-стек, поэтому механизм встаёт под клавишей, а
     не режет ряд на отдельную колонку, и позиции схемы остаются в том же порядке, что строки
     таблицы модулей над ней. В кикере — номер модуля клавиши, чтобы пара читалась. */
  const lightByKey=new Map((lightRows||[]).map(r=>[Number(r.keyIndex),r]));
  /* Подсветка клавиш: аксессуар-LED вставлен в механизм (comp.backlight.items). Очередь по
     mechId — у поста бывают два одинаковых механизма, каждый получает свой LED по порядку.
     Пробел подбора на схему НЕ выносим — как и не подобранный механизм группы света ниже:
     взрыв-схема показывает физически присутствующие детали, а пробел назван в обвязке, своде
     и смете (там же его считает монтажник и поставщик). */
  const backByMech=new Map();
  ((comp.backlight&&comp.backlight.items)||[]).forEach(u=>{
    const k=Number(u.mechId);
    if(!backByMech.has(k))backByMech.set(k,[]);
    backByMech.get(k).push(u.accessory);
  });
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
    /* Голый механизм ЗА КЛАВИШЕЙ — отдельной деталью схемы. ⚠️ ТОЛЬКО У КЛАВИШИ (row.kind!=="integrated"):
       у цельного изделия механизм внутри, а его артикул уже стоит В САМОМ модуле (effItemOf выше), и
       вторая деталь «· механизм» с тем же 09005 задвоила бы позицию. */
    if(row&&!row.missing&&row.product&&row.kind!=="integrated"){
      const mechPhoto=photoOf(row.product);
      parts.push({
        role:"Модуль",pos:`${label} · механизм`,
        name:row.product.name,code:row.code,
        icon:{categoryId:row.product.categoryId,icon:row.product.icon,name:row.product.name},
        photo:mechPhoto?{imageUrl:mechPhoto}:null
      });
    }
    /* LED подсветки этой клавиши — той же ролью «Модуль» и сразу за ней (и за её механизмом
       группы света): EPExplodedView сворачивает подряд идущие «Модули» в одну колонку-стек,
       поэтому LED встаёт под своей клавишей, а не режет ряд отдельным столбцом. */
    const bq=backByMech.get(Number(s.id));
    if(bq&&bq.length){
      const acc=bq.shift();
      const backPhoto=photoOf(acc);
      parts.push({
        role:"Модуль",pos:`${label} · подсветка`,
        name:acc.name,code:acc.code||"",
        icon:{categoryId:acc.categoryId,icon:acc.icon,name:acc.name},
        photo:backPhoto?{imageUrl:backPhoto}:null
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
  const frameInfo=comp.frameAvailability;
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
  /* ⚠️ ЭФФЕКТИВНЫЙ ТОВАР СЛОТА — ОДНО ПРАВИЛО (§7.1) НА ТАБЛИЦУ МОДУЛЕЙ И ВЗРЫВ-СХЕМУ. У цельного
     изделия расчёт МЕНЯЕТ артикул (09001→09005): монтажник и в таблице, и в схеме обязан видеть то же
     изделие, что уходит в смету. Замена — только когда она реально подобрана (строка не пробел и с
     товаром); иначе исходный товар слота (пробел назван в блоке «Группы света»). Для клавиши строка
     остаётся отдельным голым механизмом ЗА ней — её товар слота не подменяется. */
  const effItemOf=(index,fallbackItem)=>{const row=lightByKey.get(index);
    return (row&&row.kind==="integrated"&&!row.missing&&row.product)?row.product:fallbackItem;};
  /* Примечание места: группа, номер места в ней и подставленная роль с артикулом — либо причина
     пробела СЛОВАМИ РАСЧЁТА (EPLightingGroups.GAP_TEXTS). У ЦЕЛЬНОГО изделия артикул замены уже
     стоит в самой колонке модуля (moduleRow ниже подменяет его), поэтому в примечании роль/артикул
     не повторяем — только группу и номер места. */
  const lightNote=row=>!row?""
    :row.missing?`группа «${row.groupLabel||"—"}»: ${row.missingText}`
    :row.kind==="integrated"?`группа «${row.groupLabel}» · место ${row.placeNo} из ${row.placeCount}`
    :`группа «${row.groupLabel}» · место ${row.placeNo} из ${row.placeCount} · ${row.roleLabel} ${row.code}`;
  /* index — позиция места в post.mechanismIds, а НЕ порядок в таблице: у нумерации по
     постам порядок другой (см. moduleGroups ниже), а адрес места обязан быть один. Цельное
     изделие показываем заменой (effItemOf — одно правило, см. выше). */
  const moduleRow=(s,index)=>{
    const eff=effItemOf(index,s.item);
    return {
    label:moduleLabelOf(index,s),
    name:eff?eff.name:`Механизм не найден (арт. ${(post.mechanismIds||[])[index]})`,
    code:eff?eff.code:"",
    note:s.item?lightNote(lightByKey.get(index)):"нет в каталоге",
    /* Позиция места в посте едет ВМЕСТЕ со строкой: по ней взрыв-схема ниже собирается в том
       же порядке, в каком документ печатает строки таблицы (см. cardModuleOrder). */
    keyIndex:index
  };};
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
  /* Взрыв-схему собираем из ЭФФЕКТИВНЫХ товаров (effItemOf): у цельного изделия деталь схемы — та же
     замена 09005, что в таблице модулей и смете, а не исходный 09001. Правило одно на оба блока. */
  const effLayout=layout.map((s,i)=>Object.assign({},s,{item:effItemOf(i,s.item)}));
  const explodedLayout=cardOrder.map(r=>Object.assign({},effLayout[Number(r.keyIndex)],{keyIndex:Number(r.keyIndex)}))
    .concat(effLayout.map((s,i)=>Object.assign({},s,{keyIndex:i})).filter(s=>!placed.has(s.keyIndex)));
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
    EPEstimate.separateLighting(lightRows).filter(r=>!r.missing||EPLightingGroups.isSupplyGap(r.missingReason)));
  const room=state.rooms.find(r=>r.id===post.roomId);
  /* Собранное изображение и взрыв-схему кормим ОДНИМ spec (assembledPostSpec) — в каталог за
     фото/окнами накладки ходим один раз. assembledImageHtml остаётся байт-в-байт как прежде
     (assembledPostHtml — это та же EPPostImage.buildHtml над тем же spec). Расчёт групп света
     листа (light) передаём в spec, чтобы цельное изделие в картинке и взрыв-схеме показывалось
     той же заменой (09001→09005), что уже стоит в таблице модулей и в смете. */
  const spec=assembledPostSpec(post,{size:"md"},light);
  return {
    number:post.number,
    room:room?room.name:"",
    standardLabel:STANDARD_LABEL[comp.standard]||comp.standard,
    frameName:frameInfo.displayName,
    frameCode:frameInfo.code,
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
  const options=EPOfferOptions.normalize(EP_DATA.settings.offerOptions);
  /* ОДИН расчёт групп света на весь документ: он же уходит в смету (цены механизмов), он же в
     блок «Группы света» и он же в свод поставщика — двум проходам разойтись негде. */
  const light=projectLighting();
  const est=buildEstimate(light);
  /* Зависимости документа собираем ОДИН раз: тем же набором проверяем «будет ли что печатать»
     и печатаем. Секции — готовыми строками (planBlockHtml/lightingHtml/supplierSpecHtml),
     как и раньше; их пустота (раскладка без столбцов, план без чертежа, нечего заказывать)
     видна только после сборки. */
  const deps={money,esc,displayCurrency,effectiveRate:EPRates.effectiveRate,
    settings:EP_DATA.settings,options,header:docHeader(),postLayout:buildPostLayout(options,light),
    /* план с бирками — отдельной страницей перед раскладкой постов: клиент сверяет номер в
       таблице с местом на чертеже. Поля КП 16 мм (см. @page в offerPdf.js). */
    planBlockHtml:options.sections.plan?planBlockHtml({maxWidthMm:178,maxHeightMm:222}):"",
    /* Пояснение к составу позиций выше: откуда в посте на три клавиши переключатель и
       инвертор вместо трёх выключателей, сколько нужно реле и чего не хватает. */
    lightingHtml:options.sections.lighting?lightingHtml(light,"Группы света",options):"",
    /* Свод по артикулам — приложением В КОНЦЕ КП, после денежных итогов: клиент читает КП
       ради цены, а этот лист отрывается и уходит поставщику (в нём цен нет). */
    supplierSpecHtml:options.sections.supplier?supplierSpecHtml({},light,options):""};
  /* Страж пустого КП спрашивает у сборщика «будет ли что напечатать» (EPOfferPdf.hasContent),
     а НЕ «включён ли раздел»: включённая раскладка без столбцов или план без чертежа раньше
     открывали окно печати с одним титулом и без единой таблицы. */
  if(!EPOfferPdf.hasContent(est,deps)){
    toast("В предложении нечего печатать: включите раздел с содержимым или цены и итоги");return;
  }
  if(est.missing.length)toast(`Внимание: позиций без товара в каталоге — ${est.missing.length}`);
  const win=window.open("","_blank");
  if(!win){toast("Разрешите всплывающие окна для формирования PDF");return}
  win.document.write(EPOfferPdf.buildHtml(est,deps));
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
$("newPostBtn").onclick=()=>openPostBuilder();
$("closePostModal").onclick=$("cancelPost").onclick=closePostBuilder;
$("savePost").onclick=savePostBuilder;$("postSlotCount").onchange=changePostSlotCount;$("postFrameSelect").onchange=renderBuilder;
/* Смена комнаты поста (ОТДЕЛКА-ПОРЯДОК, п.3): под новую комнату меняются и пул накладок, и цветовой
   отбор начинки, и селектор модульностей (он считается от того же пула, collectionFramePool).
   Перенаполняем модульности, сохранив текущую ёмкость (extra), чтобы её опция не пропала, затем
   пересобираем конструктор. */
$("builderRoomSelect").onchange=e=>{
  state.builder.roomId=e.target.value||null;
  const capacity=builderCapacity();
  renderPostSlotCountSelect(capacity);
  $("postSlotCount").value=String(capacity);
  renderBuilder();
};
/* Галочка «ограничить цветом накладки» (решение владельца 16.09): меняет только цветовой отбор
   начинки — накладка и раскладка те же, достаточно перерисовать конструктор (renderBuilder
   пересчитает catalogMechs). */
$("builderRestrictColor").onchange=e=>{state.builder.restrictInnardsColor=e.target.checked;renderBuilder()};
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
      bumpPlanToken();   /* новый чертёж — то же поколение, что и сброс: гонки прерываются */
      state.planLoaded=true;state.planLabel=file.name;
      updatePlanUi();clearAnnotations();
      /* новый чертёж показываем целиком, иначе после «скрыть» пользователь увидит пустоту */
      state.planVisibility="show";applyPlanVisibility();
      markCanvasUsed();
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
/* Мастер отделки (вид «С картинками»). Закрытие — крестик, «Отмена», клик мимо и Esc (в глобальном
   onkeydown), как у #scaleModal/#pdfPageModal: черновик выбора отбрасывается, в проект ничего не
   пишется (запись только по «Применить»). */
$("closeFramePicker").onclick=$("cancelFramePicker").onclick=closeFramePicker;
$("applyFramePicker").onclick=applyFramePicker;
$("framePickerModal").onclick=e=>{if(e.target===$("framePickerModal"))closeFramePicker()};
$("clearAutoTraceBtn").onclick=()=>{state.autoWalls=[];refreshAfterRoomAssignments(()=>{drawWalls();renderRooms()}, scheduleSave);toast("Автоматические линии удалены")};
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
