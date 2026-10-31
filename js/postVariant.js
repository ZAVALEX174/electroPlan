/* Пост и ВАРИАНТЫ ОТДЕЛКИ комнаты (К8а, часть 3) — связка «готового поста» с набором вариантов
   помещения. Вынесено из app.js по И2 (владелец 10.10: «для каждого модуля свой файл, чтобы не
   засорять app.js»): сюда уехала подмена накладки при размещении/копировании готового поста
   (frameForRoomPlacement и её помощники), а в app.js остался только `const {frameForRoomPlacement}=
   EPPostVariant.attach(ctx)` и общий для окна поста отбор.

   --- ЗАЧЕМ ВАРИАНТЫ ЗДЕСЬ -----------------------------------------------------------------------
   У комнаты теперь до пяти вариантов отделки (EPRoomVariants, части 1–2). Правило владельца 24.10 для
   размещения/копирования готового поста: накладка поста подходит ЛЮБОМУ варианту → не трогаем; ни
   одному → подмена под ПЕРВЫЙ вариант (EPRoomVariants.placementIndex→0). Одновариантная комната (старый
   проект, плоские поля) даёт ровно одно значение EPRoomVariants.list → поведение байт-в-байт прежнее.

   УСТРОЙСТВО — фабрика (как js/postBuilder.js): app.js зовёт EPPostVariant.attach(ctx) ОДИН раз и
   получает назад frameForRoomPlacement, которую сам передаёт в addPending и в EPPostCopyUi.attach.
   Зависимости приходят объектом ctx (общий с окном поста код — roomCatalogFilter, preferOwnFrame,
   подбор накладок — остался в app.js и приходит сюда). Модули EP* и EP_DATA — window-глобалы
   (сборщика нет, PLAN 2.2): их не прокидываем, они доступны в браузере напрямую. Функции внутри attach
   объявлены `function имя(` С НАЧАЛА СТРОКИ намеренно — по ним поведенческий стенд (tests/helpers/
   appStand.js) находит и вырезает тело (SOURCE_FILES включает этот файл).

   Интерфейс приложению — window.EPPostVariant.attach(ctx) → { frameForRoomPlacement }; плюс чистый
   window.EPPostVariant.placementFits(frame,criteria) — ОДИН предикат «подходит варианту» на размещение
   И на окно поста (openPostBuilder зовёт его же, §7.1: второй трактовки нет). */
(() => {
"use strict";

/* ЕДИНЫЙ предикат «подходит ли накладка поста варианту отделки» (criteria — roomCatalogFilter варианта).
   Это ровно те случаи, когда подмена возвращает {frameId:null} «менять нечего». Два случая: (1) вариант
   ничем не сужает каталог (нет серии/отделки, стандарт не задан либо накладка ему уже годится) → подходит
   любой накладке, в т.ч. КОГДА НАКЛАДКИ НЕТ (frame=null, пустой вариант = весь каталог); (2) накладка
   проходит фильтр productsForRoom варианта. Стандарт судим ТЕМ ЖЕ productsForRoom (§7.1).
   Зовут ДВА потребителя: размещение (frameForRoomPlacement — вырезается стендом, EPCatalog из контекста) и
   окно поста (openPostBuilder через EPPostVariant.placementFits — настоящий модуль, EPCatalog из window/
   require). Поэтому каталог резолвим трёхходовкой: контекст-глобал → window → require. */
function placementFits(frame,criteria){
  const Cat=(typeof EPCatalog!=="undefined"&&EPCatalog)||(typeof window!=="undefined"&&window.EPCatalog)||(typeof require!=="undefined"&&require("./catalog.js"));
  const standardMismatch=!!(criteria.standard&&frame&&!Cat.productsForRoom([frame],{standard:criteria.standard}).length);
  const constrained=criteria.collection||criteria.frameMaterial||criteria.frameShape||criteria.frameColor||standardMismatch;
  if(!constrained)return true;
  return !!(frame&&Cat.productsForRoom([frame],criteria).length);
}

/* Фабрика: раскладывает зависимости из ctx, поднимает функции размещения и возвращает
   frameForRoomPlacement. Вызывается один раз из app.js. */
function attach(ctx){
const {
  byKind,compatibleMechanisms,frameFacingSelectionLabels,frameProduct,frameSlotCount,
  mechanismSpan,moduleWord,preferOwnFrame,product,productSeries,roomCatalogFilter,spanForFrame
}=ctx;

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
/* ОДНА формулировка «под комнату накладки, в которую встают клавиши поста, нет» при размещении готового
   поста (п.5). Параллельна frameFacingEmptyText/innardsEmptyText: называем комнату, что сузило выбор
   (frameFacingSelectionLabels — серия+отделка, тот же источник, что у хинта и мастера), модульность,
   которой не хватило, И СЕРИЮ КЛАВИШ ПОСТА. Обе причины блокировки — нет накладки нужной модульности
   в серии/цвете комнаты ИЛИ накладки есть, но клавиши поста в них не встают по серии (правило
   конструктора) — сводятся к одному честному тексту: под комнату не нашлось накладки на N модулей, в
   которую встают клавиши этого поста. Так владелец видит ОБЕ серии — комнаты (в list) и клавиш поста —
   и понимает, почему готовый пост чужой серии сюда не встал. Модульность берём у накладки шаблона
   (frameSlotCount); неизвестна (битая накладка) → moduleWord честно скажет «— модулей». Серии клавиш
   нет (пустой пост / пропавшие артикулы) → упоминание клавиш опускаем. criteria — отбор ПЕРВОГО варианта
   (под него и шла подмена), поэтому в тексте названа отделка именно того варианта, что не нашёл накладку. */
function frameSwapEmptyText(template,room,criteria){
  const mods=frameSlotCount(frameProduct(template.frameId));
  const list=frameFacingSelectionLabels(criteria).join(", ");
  const mechSeries=templateMechSeries(template);
  const keys=mechSeries?`, в которую встают клавиши этого поста (серия «${mechSeries}»),`:"";
  return `Для комнаты «${room.name}» (${list}) не нашлось накладки на ${moduleWord(mods)}${keys} — готовый пост не размещён. Соберите пост для этой комнаты или добавьте подходящую накладку.`;
}
/* Подмена накладки готового поста под КОМНАТУ размещения с учётом ВАРИАНТОВ отделки (решение владельца
   24.10). Возвращает:
     {frameId:null}          — накладку НЕ меняем: пост лёг вне комнат ЛИБО накладка подходит ХОТЯ БЫ
                               одному варианту отделки комнаты (менять нечего);
     {frameId:<id>}          — ни одному варианту не подошла → подмена под ПЕРВЫЙ вариант
                               (EPRoomVariants.placementIndex→0): нашли накладку той же модульности;
     {blocked:true,message}  — первый вариант сузил отбор, но накладки нужной серии/цвета/стандарта той
                               же модульности (в которую встают клавиши поста) нет — пост НЕ ставим.

   Правило (решение владельца 24.10, после двух проверок): подходит ЛЮБОМУ варианту → не трогаем. Ни
   одному → пробуем варианты ПО ПОРЯДКУ (1, 2, …) и берём ПЕРВЫЙ, под который подмена СОБИРАЕТСЯ (накладка
   нужной модульности есть и состав в неё встаёт); блокируем, только если не встаёт ни в один. Одновариантная
   комната (EPRoomVariants.list=[плоские поля]) проходит ровно прежней веткой — один вариант, одна попытка.

   ⚠️ ПОДМЕНА МЕНЯЕТ ТОЛЬКО ТО, ЧЕГО ТРЕБУЕТ ВАРИАНТ. Сначала ищем накладку ТОЙ ЖЕ серии и цвета, что у
   поста (preferOwnFrame — приём «своё → пул», общий с defaultFrameForRoom), и лишь если такой нет — любую
   подходящую. Кандидат годится, только если в него СОБИРАЕТСЯ состав поста (EPPosts.distributePosts
   valid&&full — тот же критерий, что у сохранения в конструкторе) и клавиши встают по серии
   (frameFitsTemplateMechs). Второго определения «подходит/собирается» не вводим (§7.1). */
function frameForRoomPlacement(template,room){
  if(!room)return {frameId:null};
  const frame=frameProduct(template.frameId);
  const variants=EPRoomVariants.list(room);
  /* подходит ХОТЯ БЫ одному варианту отделки → накладку не трогаем. Критерий варианта —
     roomCatalogFilter(вариант): вариант несёт те же 5 полей отделки, что читает roomCatalogFilter. */
  const fits=(variant,f)=>placementFits(f,roomCatalogFilter(variant));
  if(EPRoomVariants.fitIndex(variants,frame,fits)!==-1)return {frameId:null};
  /* ни одному не подошла → перебор вариантов ПО ПОРЯДКУ, первый, под который подмена собирается. */
  const fitsSeries=frameFitsTemplateMechs(template);
  const mechIds=Array.isArray(template.mechanismIds)?template.mechanismIds:[];
  /* «Собирается ли состав в накладку-кандидат f» — ширину считаем С УЧЁТОМ именно f (К12 ч.4): в
     кнопочной накладке Flat двойная клавиша 22751 занимает 2 прорези, и подмена должна это учесть.
     spanForFrame — тот же шов, что окно поста; для прочих накладок он равен mechanismSpan. typeof-guard:
     старые стенды ctx без spanForFrame падают на mechanismSpan. Считаем на КАЖДОГО кандидата f отдельно. */
  const assembles=f=>{
    const spanOf=(typeof spanForFrame==="function"?spanForFrame:(()=>mechanismSpan))(f);
    const d=EPPosts.distributePosts(mechIds,f,{product,mechanismSpan:spanOf});
    return d.valid&&d.full;
  };
  const deps={frameProduct,frameSlotCount,frameFitsMechs:f=>fitsSeries(f)&&assembles(f)};
  const ownCriteria={collection:productSeries(frame)[0],frameColor:EPPosts.templateFrameColor(template,{frameProduct})};
  for(let i=0;i<variants.length;i++){
    const pool=EPCatalog.productsForRoom(byKind("frame"),roomCatalogFilter(variants[i]));
    const swap=preferOwnFrame(pool,ownCriteria,p=>EPPosts.pickRoomFrame(template.frameId,p,deps));
    if(swap)return {frameId:swap.id};
  }
  /* не встаёт ни в один вариант → блок. Текст — от ПЕРВОГО варианта (как и раньше), не меняем. */
  return {blocked:true,message:frameSwapEmptyText(template,room,roomCatalogFilter(variants[0]))};
}

return {frameForRoomPlacement};
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports для автотестов. */
const api = { attach, placementFits };
if (typeof window !== "undefined") window.EPPostVariant = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
