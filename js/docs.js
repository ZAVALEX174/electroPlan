/* Сборка и открытие документов — коммерческого предложения (КП) и листа монтажника — вынесены из
   app.js по разделу И docs/ОСТАТОК-РАБОТ (И1, кусок 3). Здесь оркестраторы, которые СОБИРАЮТ данные из
   state/каталога и ОТКРЫВАЮТ окно печати: план с бирками для документа (planLabelsSpec/planBlockHtml,
   пережатие подложки planImageForDoc), свод по артикулам для поставщика (supplierSpecData/supplierSpecHtml),
   лист монтажника (buildPostSheet + взрыв-схема buildExplodedSpec, openInstallSheet, installSheetForProject)
   и КП (раскладка постов buildPostLayout с разбивкой цены postPricedItems, generateCommercialOffer с
   автономером). Перенос ДОСЛОВНЫЙ — поведение, тексты и логика не менялись (решение владельца «на экране
   ничего не меняется»): КП и лист монтажника печатаются байт в байт как прежде.

   ЧИСТЫЕ ПОСТРОИТЕЛИ HTML ЗДЕСЬ НЕ ЖИВУТ: вёрстку собирают отдельные модули (EPOfferPdf, EPInstallSheet,
   EPPlanLabels, EPSupplierSpec, EPExplodedView, EPOfferOptions, EPOfferNumber) — сюда они приходят window-
   глобалами. В app.js остаётся общее: смета (buildEstimate), реквизиты КП (docHeader), бланк компании
   (companyLogo/companySignature/companyStamp/companyTerms), расчёт групп света (projectLighting/lightingHtml),
   состав и цена поста (postComposition/postCost/postTotalCost), сборка постов для связей (postsForGroupLinks —
   её делит с холстом renderGroupLinks). Всё это приходит сюда объектом ctx.

   УСТРОЙСТВО — фабрика (как js/postBuilder.js и js/rooms.js): app.js вызывает EPDocs.attach(ctx) ОДИН раз,
   attach сам провязывает кнопки «Сформировать КП» (#pdfBtn) и «Лист монтажника на проект» (#installSheetBtn)
   и возвращает buildPostSheet/openInstallSheet — их продолжает звать окно поста (EPPostBuilder.attach: кнопка
   «Лист монтажника» в конструкторе). Поэтому в app.js docs.attach стоит ПЕРЕД postBuilder.attach.

   Модули EP* и EP_DATA — window-глобалы (сборщика нет, PLAN 2.2): их не прокидываем. `document`/`window` —
   тоже глобалы, берём напрямую (planImageForDoc рисует на canvas, generateCommercialOffer/openInstallSheet
   открывают окно печати). Функции внутри attach объявлены `function имя(` С НАЧАЛА СТРОКИ намеренно — по ним
   поведенческий стенд (tests/helpers/appStand.js, SOURCE_FILES включает этот файл) находит и вырезает тело;
   порядок функций и соседних const (DOC_PLAN_* перед planImageForDoc) сохранён из app.js.

   Интерфейс приложению — window.EPDocs.attach(ctx) → { buildPostSheet, openInstallSheet }. */
(() => {
"use strict";

/* Фабрика документов: раскладывает зависимости из ctx, поднимает оркестраторы КП и листа монтажника,
   провязывает кнопки на них и возвращает то, что app.js (через окно поста) продолжает звать по имени.
   Вызывается один раз из app.js. */
function attach(ctx){
const {
  $,STANDARD_LABEL,assembledPostHtml,assembledPostSpec,buildEstimate,canvas,companyLogo,companySignature,
  companyStamp,companyTerms,displayCurrency,displayRate,docHeader,esc,frameProduct,keySlotKind,lightingHtml,
  lightingRowsFor,mechanismSpan,money,postComposition,postCost,postTotalCost,postsForGroupLinks,product,
  productImage,projectLighting,roomNamePoint,scheduleSave,state,toast
}=ctx;

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
      /* Личная скидка поста — для пометки в раскладке КП (EPOfferPdf). Процент/признак «личная»
         считает та же EPEstimate.discountOf по p.discount, что и строки сметы. */
      discount:p.discount,
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
        /* В10: имя в документе центрируется прямо по точке (translate −50%), поэтому берём roomNamePoint —
           точку визуального центрирования: у прежних комнат = центроид (как было), у переставленных = полюс. */
        const c=roomNamePoint(r.polygon);
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
  /* Вид поста — отдельная настройка проекта (EP_DATA.settings.assemblyView), берём её в ОДНОМ месте:
     так его получают оба пути листа — и кнопка «Лист монтажника» на проект, и лист из конструктора
     поста (§7.1). Наборы столбцов КП вид не задают, поэтому читаем НЕ из offerOptions. */
  win.document.write(EPInstallSheet.buildHtml(
    Object.assign({header:{project:h.project,developer:h.developer,date:h.date},
      assemblyView:EPOfferOptions.assemblyView(EP_DATA.settings.assemblyView)},data),
    {esc,logo:companyLogo()}));
  win.document.close();
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

/* Оркестратор КП: считаем ту же смету, что и панель справа (единый buildEstimate —
   PLAN 2.4), открываем окно печати, а саму вёрстку документа собирает EPOfferPdf.
   Сверху добавляем реквизиты (docHeader) и раскладку постов (buildPostLayout). */
function generateCommercialOffer(){
  const options=EPOfferOptions.normalize(EP_DATA.settings.offerOptions);
  /* Автономер КП (§1.3 «EPG-2026-0001»): при первой печати проекта с пустым «Номер КП» выдаём
     следующий номер и закрепляем за проектом; правило формата/счётчика живёт в EPOfferNumber
     (§7.1). Счётчик — бланк компании (EPPrefs), один на все проекты; год берётся из даты КП.
     Ручной номер не трогаем и счётчик им не двигаем — это решает assign() по пустоте current. */
  const dh=EP_DATA.settings.docHeader=EP_DATA.settings.docHeader||{};
  const counters=EPPrefs.get("offerCounters",{});
  const num=EPOfferNumber.assign(counters,{current:dh.number,date:dh.date});
  if(num.number!==(dh.number||"")){
    dh.number=num.number;
    if($("docNumber"))$("docNumber").value=num.number;
    scheduleSave(); /* номер закрепляем в снимке проекта — переживёт перезагрузку */
  }
  if(JSON.stringify(num.counters)!==JSON.stringify(counters))EPPrefs.set("offerCounters",num.counters);
  /* ОДИН расчёт групп света на весь документ: он же уходит в смету (цены механизмов), он же в
     блок «Группы света» и он же в свод поставщика — двум проходам разойтись негде. */
  const light=projectLighting();
  const est=buildEstimate(light);
  /* Зависимости документа собираем ОДИН раз: тем же набором проверяем «будет ли что печатать»
     и печатаем. Секции — готовыми строками (planBlockHtml/lightingHtml/supplierSpecHtml),
     как и раньше; их пустота (раскладка без столбцов, план без чертежа, нечего заказывать)
     видна только после сборки. */
  const deps={money,esc,displayCurrency,effectiveRate:EPRates.effectiveRate,
    settings:EP_DATA.settings,options,header:docHeader(),logo:companyLogo(),terms:companyTerms(),
    /* Подпись и печать — бланк компании (EPPrefs), в конец КП после условий и перед сводом. В лист
       монтажника не передаём: он не коммерческий документ. Тарифный гейт (кто это видит) подключится
       потом здесь — какие картинки вообще передать; сама механика печати про тарифы не знает. */
    signature:companySignature(),stamp:companyStamp(),
    postLayout:buildPostLayout(options,light),
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

/* Выгрузка спецификации в Excel (A6, решение владельца 24.08 §1.2). Собираем ТЕ ЖЕ данные, что и КП:
   один расчёт групп света, та же смета (buildEstimate), тот же свод (EPSupplierSpec.collect на
   supplierSpecData) и те же настройки показа (offerOptions) — Excel и КП не могут разойтись в деньгах
   (§7.1). В ОТЛИЧИЕ от generateCommercialOffer номер КП НЕ присваиваем и счётчик не двигаем (решение
   владельца): берём уже закреплённый за проектом номер как есть (docHeader().number, может быть пуст).
   Валюту и курс берём как у КП — displayCurrency()/displayRate(): число в книге = базовая цена × курс,
   денежный формат ячейки округляет его так же, как money(). Саму книгу (байты .xlsx) строит чистый
   EPSpecExcel; здесь остаётся то, что знает только приложение, — сбор из state и скачивание файла. */
function exportSpecExcel(){
  const light=projectLighting();
  const est=buildEstimate(light);
  const supplier=EPSupplierSpec.collect(supplierSpecData(light));
  /* Пустой проект выгружать незачем: нет ни позиций сметы, ни строк свода. */
  if(!(est.groups&&est.groups.length)&&!(supplier.rows&&supplier.rows.length)){
    toast("В проекте нечего выгружать в Excel");return;
  }
  const options=EPOfferOptions.normalize(EP_DATA.settings.offerOptions);
  const bytes=EPSpecExcel.build(est,supplier,
    {options,currency:displayCurrency(),rate:displayRate()});
  const dh=docHeader();
  const name=EPSpecExcel.fileName(dh.number,dh.project);
  /* Скачивание — единственная «грязная» часть: Blob из байтов книги и временная ссылка a[download].
     revokeObjectURL откладываем, чтобы клик успел забрать содержимое. */
  const blob=new Blob([bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download=name;
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),0);
}

/* Провязка кнопок документов на проект — здесь же, где postBuilder провязывает своё окно: кнопка
   «Лист монтажника на проект» и «Сформировать КП». Кнопку «Лист монтажника» в самом конструкторе поста
   вешает EPPostBuilder.attach (у него свой installSheetForBuilder, зовущий наши buildPostSheet/openInstallSheet). */
$("installSheetBtn").onclick=installSheetForProject;
$("pdfBtn").onclick=generateCommercialOffer;
$("xlsxBtn").onclick=exportSpecExcel;

return {buildPostSheet,openInstallSheet};
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports для автотестов. */
const api = { attach };
if (typeof window !== "undefined") window.EPDocs = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
