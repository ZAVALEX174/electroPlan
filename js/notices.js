/* Всплывающие сообщения, которые НЕ гаснут сами, а закрываются своим крестиком (Б9, часть 2б). Отдельный
   модуль по правилу владельца 10.10 «для каждого модуля — свой файл, чтобы не засорять app.js»: обычный
   toast() в app.js гаснет за 1,8 с и для длинного текста о невставленных постах/снятых именах групп не
   годится (замер: 316 символов за 1,8 с прочитать нельзя). Этот модуль показывает такой текст до клика по
   крестику и живёт рядом с тем же углом экрана, что и toast.

   ВИД сообщения (kind) — его тождество: новое сообщение того же вида ЗАМЕНЯЕТ старое (владелец: «повторная
   вставка — новое заменяет старое того же вида»), а разные виды стоят одно над другим, не перекрывая друг
   друга (CSS .notices — колонка). Сейчас видов два: "unplaced" (невставленные посты) и "groupName" (у копий
   снято имя группы света), но модуль к ним не привязан — kind просто строка-ключ.

   prune() — для отмены (Ctrl+Z): сообщение привязывается к постам своей вставки через pruneWhen (владелец:
   «постов, о которых оно говорит, на плане уже нет» → сообщение убирается само). app.js зовёт prune() после
   undoPlan; сообщение без pruneWhen (случай «ничего не вставлено», шага истории нет) отмену переживает.

   УСТРОЙСТВО — фабрика (как js/rooms.js, js/canvasInput.js): EPNotices.attach({host,doc}) один раз из app.js.
   Чистая часть (buildGroupNameText — грамматика текста Б) вынесена статикой на namespace и покрыта тестом
   без DOM. Текст кладём в узел через textContent (не innerHTML) — пользовательские имена групп в HTML не
   попадают, экранирование не требуется (эквивалент esc по конвенции 4).

   Интерфейс: window.EPNotices = { attach({host,doc}) → {show,dismiss,prune}, buildGroupNameText(cleared) }. */
(() => {
"use strict";

/* Русское перечисление: "a" / "a и b" / "a, b и c" (без оксфордской запятой перед «и»). */
function joinRu(parts){
  if(parts.length<=1)return parts[0]||"";
  return parts.slice(0,-1).join(", ")+" и "+parts[parts.length-1];
}

/* Текст сообщения Б (решение владельца 10.10) — чистая функция под тестом, все грамматические варианты.
   cleared = [{number, keyIndex, name}] из EPPostCopy.stripSharedGroupNames: номер поста-копии, индекс
   клавиши и снятое имя. Согласование: глагол/существительное («убрано имя» / «убраны имена») — по числу
   РАЗНЫХ имён; «она стоит … исходный пост» / «они стоят … исходные посты» — по числу копий. Номера копий
   по возрастанию и без повторов (одна копия с двумя снятыми именами упоминается один раз); имена — в
   порядке первого появления, без повторов. */
function buildGroupNameText(cleared){
  const list=Array.isArray(cleared)?cleared:[];
  const numbers=[...new Set(list.map(c=>c.number))].sort((a,b)=>Number(a)-Number(b));
  const names=[];const seen=new Set();
  list.forEach(c=>{if(!seen.has(c.name)){seen.add(c.name);names.push(c.name);}});
  const oneCopy=numbers.length===1,oneName=names.length===1;
  const copiesWord=oneCopy?"копии":"копий";
  const numberList=joinRu(numbers.map(n=>"№ "+n));
  const verbNoun=oneName?"убрано имя группы света":"убраны имена групп света";
  const nameList=joinRu(names.map(n=>"«"+n+"»"));
  const standClause=oneCopy?"она стоит там же, где исходный пост":"они стоят там же, где исходные посты";
  return "У "+copiesWord+" "+numberList+" "+verbNoun+" "+nameList+": "+standClause
    +", и с одинаковым именем программа посчитала бы их одним светом с двух мест."
    +" Нужна проходная — поставьте у клавиш одинаковый номер проходной.";
}

/* Фабрика: держит по одному живому сообщению на каждый вид (kind). host — контейнер #notices, doc —
   document (createElement). Возвращает show/dismiss/prune, которые зовёт app.js/postCopyUi. */
function attach(opts){
  opts=opts||{};
  const host=opts.host,doc=opts.doc;
  /* live[kind] = { el, pruneWhen }. Один вид — одно сообщение: show заменяет прежнее того же вида. */
  const live=Object.create(null);

  function dismiss(kind){
    const rec=live[kind];
    if(!rec)return;
    if(rec.el&&rec.el.parentNode)rec.el.parentNode.removeChild(rec.el);
    delete live[kind];
  }

  /* Показать сообщение вида kind с текстом text. pruneWhen (необязательно) — функция: вернёт true, когда
     сообщение пора убрать при prune() (посты его вставки с плана ушли). Старое сообщение того же вида
     заменяется (владелец: не копить два одинаковых). */
  function show(kind,text,pruneWhen){
    dismiss(kind);
    const box=doc.createElement("div");
    box.className="notice";
    box.setAttribute("role","status");          /* экранный чтец озвучит появившееся сообщение */
    const msg=doc.createElement("span");
    msg.className="notice__text";
    msg.textContent=text;                        /* textContent, не innerHTML — имена групп в разметку не идут */
    const btn=doc.createElement("button");
    btn.type="button";
    btn.className="notice__close";
    btn.setAttribute("aria-label","Закрыть сообщение");
    btn.title="Закрыть";
    btn.textContent="×";
    btn.onclick=()=>dismiss(kind);
    box.appendChild(msg);
    box.appendChild(btn);
    host.appendChild(box);
    live[kind]={el:box,pruneWhen:typeof pruneWhen==="function"?pruneWhen:null};
  }

  /* Убрать сообщения, чьи посты ушли с плана (после Ctrl+Z). Без pruneWhen сообщение несменяемо отменой. */
  function prune(){
    for(const kind of Object.keys(live)){
      const rec=live[kind];
      if(rec.pruneWhen&&rec.pruneWhen())dismiss(kind);
    }
  }

  return {show,dismiss,prune};
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports для автотестов. */
const api={attach,buildGroupNameText};
if(typeof window!=="undefined")window.EPNotices=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
})();
