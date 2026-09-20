/* Группы света в приложении: сборка МЕСТ УПРАВЛЕНИЯ из постов проекта, подбор голого механизма
   по роли и серии, раскладка результата обратно по постам и печатный блок для документов (C8).

   ГРАНИЦА С js/lightingGroups.js. Там — правила схемы (сколько мест в группе → какие роли) и
   ничего больше: модуль не знает ни про посты приложения, ни про каталог. Здесь — всё, что
   связывает его с проектом: как из post.mechanismIds и post.keyGroups получаются места, как по
   паре «роль+серия» находится изделие в каталоге и как результат печатается. Оба модуля чистые
   (ни DOM, ни state), но этот дополнительно ЗНАЕТ ФОРМУ ПОСТА приложения.

   ⚠️ КОНТРАКТ МЕСТА СОБЛЮДАЕТСЯ ЗДЕСЬ, И ЭТО ГЛАВНОЕ, ЗАЧЕМ МОДУЛЬ ВЫДЕЛЕН.
     • keyIndex ОБЯЗАТЕЛЕН и равен позиции клавиши в post.mechanismIds — берётся индексом
       перебора, а не indexOf (в посте бывают две одинаковые клавиши, и indexOf вернул бы обеим
       один адрес: модуль опознал бы их как дубль и посчитал бы одно место вместо двух).
     • группа передаётся СТРОКОЙ (см. groupText): число 4.10 в JS это 4.1, и группа «4.10» с
       плана слилась бы с «4.1».
     • deps.findMechanism обязан вернуть изделие С артикулом и НИКОГДА — чужой серии; поэтому
       подбор здесь свой (resolveMechanism), а не EPCatalog.compatibleMechanisms, который при
       отсутствии пересечения серий возвращает ВЕСЬ список («лучше показать всё, чем ничего»).

   Интерфейс приложению — window.EPLightingPlan. */
(() => {
"use strict";

/* Группа — только строка (см. builderSlots.js: 4.10 → 4.1 и склейка разных групп). */
const groupText = v => (v === null || v === undefined) ? "" : String(v);
const text = v => (v === null || v === undefined) ? "" : String(v);

/* ─────────────────────── места управления ─────────────────────── */

/* collect(posts, deps) → места управления для EPLightingGroups.plan.

   deps = {
     product(id) → товар|undefined,
     seriesOf(item) → [строки],          // серии клавиши в написании каталога
     controlKind(item) → "key"|"integrated"|null   // вид места управления (см. ниже);
     isKey(item) → bool                  // УСТАРЕВШИЙ вход: клавиша ли (partRole==="key").
                                         // Если controlKind не передан, выводится из isKey
                                         // (только "key"|null), чтобы старые вызовы не сломались.
   }

   МЕСТО ДАЁТ КЛАВИША ИЛИ ЦЕЛЬНОЕ ИЗДЕЛИЕ С РОЛЬЮ УПРАВЛЕНИЯ. Их РАЗЛИЧАЕТ controlKind, и разница
   в том, ЧТО пойдёт в смету, а НЕ в том, есть ли место (владелец, 16.09):
     • "key" — клавиша (накладная на голый механизм). Модель заказчика: «отображаем мы только
       кнопки… а по факту конфигуратор уже сам считает нам механизм». Голый механизм ХХ001.0/… за
       клавишей подбирается ОТДЕЛЬНОЙ позицией (findMechanism → голый механизм);
     • "integrated" — цельное изделие (клавиша+механизм в одном артикуле, напр. 09001). Голого
       механизма под ним НЕТ (он внутри) — findMechanism подбирает ЗАМЕНУ самого артикула изделием
       нужной роли той же серии и цвета (09001→09005), и приложение подменяет им сам артикул поста,
       а НЕ добавляет вторую позицию: иначе пост оплатил бы и изделие, и замену (двойная цена).
   Что именно подставить, решает не этот модуль — он лишь помечает место видом (controlKind →
   place.controlKind → findMechanism.kind, см. lightingGroups.plan). Розетка, датчик, Bluetooth и
   голый механизм местами управления не являются (controlKind → null).

   ⚠️ ВТОРОЙ ПРИЗНАК МЕСТА — ТОВАРА НЕТ В КАТАЛОГЕ, А ГРУППА У ПОЗИЦИИ НАЗНАЧЕНА. Это не
   послабление правила, а защита от МОЛЧАЛИВОЙ ПОТЕРИ. Пока условие было одно («товар опознан
   клавишей»), позиция, товар которой ПРОПАЛ ИЗ КАТАЛОГА (прайс перезаливают до 7 раз в год, а
   старые проекты обязаны открываться), исчезала совсем: ни в расчёт, ни в пробелы. Хуже всего,
   что она ЗАРАЖАЛА СОСЕДЕЙ — N группы падал, и ДРУГИЕ, нетронутые посты получали другой
   механизм: вместо двух переключателей один выключатель, и проходная схема переставала
   работать. Такое место уходит в расчёт с признаком keyUnknown: оно считается в группе (N не
   падает, соседи сохраняют свои механизмы), но механизм ему не подбирается — честный пробел
   GAPS.KEY_UNKNOWN вместо правдоподобной догадки за деньги.
   ОБА УСЛОВИЯ ОБЯЗАТЕЛЬНЫ, и вот почему:
     • «товара нет в каталоге» — только про ненайденный товар. Найденный, но не клавиша (розетка,
       готовое изделие) местом не становится, как и раньше: каталог о нём знает, и знает, что
       механизм под ним не нужен;
     • «группа назначена» — свидетельство замысла человека. Группу назначают МЕСТУ УПРАВЛЕНИЯ, и
       поле для неё есть только у клавиши, поэтому непустая группа у пропавшего товара говорит:
       здесь стояла клавиша. Без этого условия любая исчезнувшая из прайса розетка печаталась бы
       в документах как «клавиша без группы» — ложное утверждение о проекте. Клавиша без группы
       при этом ничего не теряет в деньгах: без группы место не попадает ни в одну группу и на
       механизмы соседей не влияет никак.
   ГРАНИЦА ЧЕСТНО: если товар в каталоге ЕСТЬ, но перестал опознаваться клавишей (пропал
   partRole при пересборке каталога), место по-прежнему не собирается. Отличить такой товар от
   законной розетки в данных нечем — у розеток partRole не заполнен штатно, — а считать местом
   всё подряд с непустой группой опаснее: устаревшая группа на розетке (например, оставшаяся от
   замены клавиши) раздула бы N и сменила бы механизмы соседних постов.
   Возвращаемые объекты несут и служебные поля (moduleLabel, postName) — модуль групп света
   читает только известные ему поля и лишние игнорирует, а документам они нужны, чтобы не
   ходить в каталог второй раз. */
function collect(posts, deps) {
  const d = deps || {};
  const product = d.product || (() => null);
  const seriesOf = d.seriesOf || (() => []);
  /* Вид места — ОДИН предикат приложения (§7.1). Старый isKey(bool) поддержан: из него выводится
     только "key"|null (цельные изделия старому вызову неизвестны — поведение не меняется). */
  const controlKind = d.controlKind
    || (d.isKey ? (item => (d.isKey(item) ? "key" : null)) : (() => null));
  const out = [];
  (Array.isArray(posts) ? posts : []).forEach(post => {
    const p = post || {};
    const ids = Array.isArray(p.mechanismIds) ? p.mechanismIds : [];
    const groups = Array.isArray(p.keyGroups) ? p.keyGroups : [];
    /* Номер проходной и выбранный руками механизм — параллельные keyGroups массивы клавиши
       (см. builderSlots.toPost). Старый пост их не несёт — тогда пусто «связи по номеру нет,
       механизм считает программа». crossNo/roleOverride читает EPLightingGroups (place.crossNo,
       place.roleOverride); здесь только протягиваем их из формы поста, второй копии правила нет. */
    const crosses = Array.isArray(p.keyCrossNumbers) ? p.keyCrossNumbers : [];
    const mechs = Array.isArray(p.keyMechanisms) ? p.keyMechanisms : [];
    ids.forEach((id, keyIndex) => {
      const item = product(id);
      const kind = item ? controlKind(item) : null;   /* "key"|"integrated"|null */
      const isPlace = kind !== null;
      const group = groupText(groups[keyIndex]);
      const crossNo = groupText(crosses[keyIndex]);
      /* потерянная клавиша: товара нет в каталоге, но у позиции назначена группа ИЛИ номер проходной
         (и то, и другое — свидетельство «здесь стояло место управления», см. шапку про lostKey). */
      const lostKey = !isPlace && !item && (group.trim() !== "" || crossNo.trim() !== "");
      if (!isPlace && !lostKey) return;
      out.push({
        postId: p.id, postNumber: p.number,
        /* индекс — позицией перебора и только ей (см. шапку про indexOf) */
        keyIndex,
        keyId: item && item.id != null ? item.id : id,
        /* У потерянного товара серии нет и взять её неоткуда — пустой список, а не догадка. */
        series: isPlace ? seriesOf(item) : [],
        group, crossNo, roleOverride: groupText(mechs[keyIndex]),
        keyUnknown: !isPlace,
        /* Вид места (клавиша/цельное) для plan: он решает подбор голого механизма против замены
           артикула. lostKey несёт null — до подбора он не доходит (пробел KEY_UNKNOWN раньше). */
        controlKind: kind,
        /* служебное для документов: имя поста и сам товар места (может быть не найден) */
        postName: p.name, key: item || null
      });
    });
  });
  return out;
}

/* ─────────────────────── подбор механизма ─────────────────────── */

/* Пересечение серий с приведением регистра У ОБЕИХ СТОРОН — то же правило, что в
   EPCatalog.compatibleMechanisms. Серии приходят в написании места (модуль их регистр не
   трогает), а в каталоге записаны своим написанием — сравнивать их побуквенно значило бы
   не найти ничего на первом же «EIKON EVO». */
function seriesMatch(a, b) {
  const left = (Array.isArray(a) ? a : []).map(s => text(s).trim().toLocaleLowerCase("ru-RU")).filter(Boolean);
  const right = (Array.isArray(b) ? b : []).map(s => text(s).trim().toLocaleLowerCase("ru-RU")).filter(Boolean);
  if (!left.length || !right.length) return false;   /* нет серии — подбирать не в чем */
  return left.some(s => right.includes(s));
}

/* Малое напряжение в названии изделия. Нужно ровно для одного разбора: в серии Neve Up на роль
   «Кнопка» два голых механизма — 09008.0.12 (12 В) и 09008.0.250 (250 В). Это НЕ выдуманное
   правило подбора: цепь освещения у нас сетевая, и 12-вольтовое изделие в ней физически не
   работает, поэтому при наличии сетевого кандидата низковольтный из выбора уходит. Напряжение
   читаем из названия — другого места его в номенклатуре нет (отдельной колонки под него не
   существует), и берём только явную запись «12В» / «12 V».
   Порог 50 В — граница безопасного сверхнизкого напряжения (SELV); всё, что ниже, для сетевой
   группы освещения нерелевантно при любой трактовке. */
const VOLTAGE = /(\d{1,3})\s*(?:В|B|V)(?![а-яёa-z0-9])/gi;
function isExtraLowVoltage(item) {
  const name = text(item && item.name);
  let m, low = false, mains = false;
  VOLTAGE.lastIndex = 0;
  while ((m = VOLTAGE.exec(name)) !== null) {
    const v = Number(m[1]);
    if (v <= 50) low = true; else mains = true;
  }
  return low && !mains;
}

/* resolveMechanism({role, series}, mechanisms, deps) → { product, candidates, ambiguous }

   Строгий подбор под контракт EPLightingGroups.findMechanism:
     • только ГОЛЫЙ механизм (partRole === "bare_mechanism") — готовое изделие за клавишей не
       ставят, оно уже с клавишей;
     • роль управления берётся из данных (controlRole, колонка «Тип управления»), а не из
       разбора артикула: правило «ХХ021 → ХХ001.0 по двум первым цифрам» ломается на Neve Up
       (09021.N → 09001.0.250);
     • серия обязана пересечься — чужая серия это неверная смета и невозможный монтаж;
     • изделие без артикула не подбирается вовсе (модуль всё равно объявил бы его пробелом
       NO_CODE, но с ним место потеряло бы шанс на другого кандидата).
   Кандидатов больше одного и разобрать их нечем → product = null и ambiguous = true: молча
   бросить монетку в вопросе, который стоит денег, нельзя, а интерфейс покажет кандидатов
   человеку. */
function resolveMechanism(query, mechanisms, deps) {
  const q = query || {};
  const d = deps || {};
  const partOf = d.partOf || (item => item && item.partRole);
  const roleOf = d.roleOf || (item => item && item.controlRole);
  const seriesOf = d.seriesOf || (item => (item && item.series) || []);
  const codeOf = d.codeOf || (item => item && item.code);
  const role = text(q.role);
  if (!role) return { product: null, candidates: [], ambiguous: false };
  let candidates = (Array.isArray(mechanisms) ? mechanisms : []).filter(item =>
    partOf(item) === "bare_mechanism"
    && roleOf(item) === role
    && text(codeOf(item)).trim() !== ""
    && seriesMatch(q.series, seriesOf(item)));
  if (candidates.length > 1) {
    const mains = candidates.filter(item => !isExtraLowVoltage(item));
    if (mains.length) candidates = mains;
  }
  if (candidates.length === 1) return { product: candidates[0], candidates, ambiguous: false };
  return { product: null, candidates, ambiguous: candidates.length > 1 };
}

/* resolveReplacement({role, source}, products, deps) → { product, candidates, ambiguous }

   Подбор ЗАМЕНЫ для цельного изделия (клавиша+механизм в одном артикуле). В отличие от
   resolveMechanism (голый механизм ЗА клавишей) здесь ищется САМ АРТИКУЛ нужной роли — им приложение
   подменит исходное изделие в посте, второго механизма не добавляя (иначе двойная цена).

   Правило заказчика: «программа сама меняет изделие на изделие нужной роли ТОЙ ЖЕ СЕРИИ И ЦВЕТА».
   Отбор СТРОГИЙ — совпасть обязаны ВСЕ признаки, иначе в смету уйдёт не то изделие:
     • роль управления (controlRole) = нужная (switch/changeover/inverter/button);
     • НЕ голый механизм (partRole пуст) — замена цельная, механизм внутри;
     • серия пересекается (seriesMatch) — чужая серия физически не собирается;
     • модульность (spanOf) совпадает — 1М-выключатель не заменить 2М-изделием;
     • цвет элемента (colorKeyOf, та же нормализация, что у отбора начинки) совпадает;
     • «семья» изделия — functionalGroup И functionalSubgroup исходного (иначе осевой выключатель
       Arke 19101.B заменился бы датчиком движения 19181.B той же роли switch — недопустимо).
   ★ РОЛЬ УЖЕ СОВПАДАЕТ → замена НЕ НУЖНА: изделие само нужной роли (владелец: 09001 при одном
     месте остаётся 09001). Возвращаем сам source, минуя отбор, — это и снимает ложную
     неоднозначность, если в серии рядом стоит второе изделие той же роли.
   Кандидатов ноль ИЛИ больше одного и разобрать нечем → product=null: подставлять первого или
     «что-нибудь похожее» нельзя (владелец: «программа прямо говорит, чего не хватает»). Ноль —
     честный пробел NOT_IN_SERIES у plan; больше одного — ambiguous, интерфейс покажет кандидатов. */
function resolveReplacement(query, products, deps) {
  const q = query || {};
  const source = q.source;
  const role = text(q.role);
  if (!role || !source) return { product: null, candidates: [], ambiguous: false };
  const d = deps || {};
  const partOf = d.partOf || (item => item && item.partRole);
  const roleOf = d.roleOf || (item => item && item.controlRole);
  const seriesOf = d.seriesOf || (item => (item && item.series) || []);
  const spanOf = d.spanOf || (() => null);
  const colorKeyOf = d.colorKeyOf || (item => (item && item.elementColor) || null);
  const fgOf = d.fgOf || (item => (item && item.functionalGroup) || null);
  const fsgOf = d.fsgOf || (item => (item && item.functionalSubgroup) || null);
  const codeOf = d.codeOf || (item => item && item.code);
  /* Роль уже нужная — само изделие и есть замена (владелец п.4). */
  if (roleOf(source) === role) return { product: source, candidates: [source], ambiguous: false };
  const span = spanOf(source);
  const colorKey = colorKeyOf(source);
  const fg = fgOf(source), fsg = fsgOf(source);
  const candidates = (Array.isArray(products) ? products : []).filter(item =>
    item && item !== source
    && !partOf(item)
    && roleOf(item) === role
    && text(codeOf(item)).trim() !== ""
    && spanOf(item) === span
    && colorKeyOf(item) === colorKey
    && fgOf(item) === fg
    && fsgOf(item) === fsg
    && seriesMatch(seriesOf(source), seriesOf(item)));
  if (candidates.length === 1) return { product: candidates[0], candidates, ambiguous: false };
  return { product: null, candidates, ambiguous: candidates.length > 1 };
}

/* ─────────────────────── раскладка результата по постам ─────────────────────── */

/* Адрес поста — ОДНО правило на весь модуль (id, если задан, иначе номер), ровно как в
   EPLightingGroups.postAddressOf. Два разных чтения адреса на двух сторонах и есть тот способ,
   которым «В15» и « 1» разъезжаются между расчётом и документом. */
function addressKey(place) {
  const p = place || {};
  if (p.postId !== null && p.postId !== undefined && text(p.postId).trim() !== "") return "p:" + text(p.postId).replace(/\s+/g, " ").trim();
  if (p.postNumber !== null && p.postNumber !== undefined && text(p.postNumber).trim() !== "") return "n:" + text(p.postNumber).replace(/\s+/g, " ").trim();
  return "";
}

/* rowsByPost(plan, sources) → Map(адрес поста → строки мест этого поста).

   Строка — то, что печатают ВСЕ документы (смета, лист монтажника, свод, панель состава):
   { keyIndex, groupLabel, placeNo, placeCount, roleLabel, product, code, name, price,
     missing, missingReason, missingText }.
   sources — тот самый массив, что уходил в plan (collect): из него берём имя клавиши и её
   позицию, чтобы документ не ходил в каталог второй раз. Порядок строк внутри поста — по
   keyIndex, то есть слева направо, как их видит человек в конструкторе и в листе монтажника.
   gapTexts — СЛОВАРЬ ФОРМУЛИРОВОК ИЗ РАСЧЁТА (EPLightingGroups.GAP_TEXTS), а не свой: у
   интерфейса и документов не должно быть второй копии текстов причин, она разойдётся. */
function rowsByPost(plan, sources, gapTexts) {
  const places = (plan && Array.isArray(plan.places)) ? plan.places : [];
  const src = Array.isArray(sources) ? sources : [];
  const gapText = gapTexts || {};
  const map = new Map();
  places.forEach((p, i) => {
    if (!p) return;
    const key = addressKey(p);
    if (!key) return;
    const s = src[i] || {};
    const row = {
      keyIndex: p.keyIndex,
      /* Вид места из collect: "integrated" — строка НЕ идёт отдельной позицией состава (изделие
         уже подменено в mechanismIds), "key" — голый механизм за клавишей, позиция отдельная.
         Потерянная клавиша (controlKind=null) — тоже "key" (её механизм считался бы отдельным). */
      kind: s.controlKind === "integrated" ? "integrated" : "key",
      keyName: (s.key && s.key.name) || "",
      keyCode: (s.key && s.key.code) || "",
      groupLabel: p.groupLabel || "",
      placeNo: p.placeNo, placeCount: p.placeCount,
      roleLabel: p.roleLabel || "",
      product: p.product || null,
      code: p.code || "",
      name: p.product ? p.product.name : "",
      price: p.product ? (Number(p.product.price) || 0) : 0,
      missing: !!p.missing,
      missingReason: p.missingReason || null,
      missingText: p.missingReason ? (gapText[p.missingReason] || "") : ""
    };
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });
  map.forEach(list => list.sort((a, b) => (Number(a.keyIndex) || 0) - (Number(b.keyIndex) || 0)));
  return map;
}

/* Адрес поста приложения тем же правилом — чтобы документ спрашивал карту тем же ключом,
   каким она собрана (см. addressKey). */
const postKey = post => addressKey({ postId: post && post.id, postNumber: post && post.number });

/* ─────────────────────── печатный блок ─────────────────────── */

/* Один блок на все документы (КП, лист монтажника, панель «Стоимость проекта») — по правилу
   проекта «два документа об одном проекте не могут противоречить». Инлайн-стили, как в
   supplierSpec.js: секция уходит и в окно печати, где внешнего CSS нет.
   Печатаем ТОЛЬКО то, что посчитал модуль: подставленные механизмы по группам, потребность в
   реле БЕЗ артикула и пробелы с их СОБСТВЕННЫМИ текстами из EPLightingGroups.GAP_TEXTS —
   своего словаря формулировок здесь нет намеренно, иначе он разошёлся бы с расчётом. */
function buildHtml(plan, deps) {
  if (!plan) return "";
  const d = deps || {};
  const esc = d.esc || (s => text(s));
  const money = d.money || (n => String(n));
  const title = d.title || "Группы света";
  const gaps = Array.isArray(plan.gaps) ? plan.gaps : [];
  const groups = Array.isArray(plan.groups) ? plan.groups : [];
  const relays = Array.isArray(plan.relays) ? plan.relays : [];
  /* Пустой проект без единой группы и без пробелов — блока в документе быть не должно. */
  if (!groups.length && !gaps.length && !relays.length) return "";

  const S = {
    box: "margin:14px 0;padding:10px 12px;border:1px solid #d5e4f0;border-radius:10px;background:#f7fbfe;font-family:Arial,sans-serif",
    head: "display:flex;justify-content:space-between;gap:10px;font-size:11px;font-weight:bold;margin-bottom:6px",
    muted: "color:#6b8199;font-weight:normal",
    row: "display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-top:1px dashed #e2ecf4;font-size:11px;align-items:baseline",
    /* ⚠️ ИМЯ ГРУППЫ ВВОДИТ ЧЕЛОВЕК, И ОНО БЫВАЕТ ДЛИННЫМ. Ячейки строки — flex-элементы, а те по
       умолчанию не сжимаются уже своего содержимого (min-width:auto): длинное имя без пробелов
       («ГостинаяВерхнийСветЦентральнаяЛюстра») распирало строку, наезжало на правую колонку и
       уезжало за край блока — и на экране, и в печати КП, где ширину не подвинешь.
       ЛЕВАЯ ячейка (имя группы) забирает всё сжатие: min-width:0 разрешает сжиматься, а
       overflow-wrap:anywhere переносит внутри слова, потому что переносить больше негде.
       ПРАВАЯ ячейка (подобранные роли) min-width НЕ обнуляет НАМЕРЕННО — иначе на узкой панели
       ломались бы посреди слова и её подписи («Выклю чатель — 1»). Оставленный auto держит её
       не уже самого длинного слова, а break-word разрывает его только когда иначе никак. */
    cell: "min-width:0;overflow-wrap:anywhere",
    cellRight: "text-align:right;overflow-wrap:break-word",
    gap: "padding:4px 0;border-top:1px dashed #e2ecf4;font-size:10px;color:#9a4a2f;overflow-wrap:anywhere"
  };

  /* Комната у строки. Расчёт по комнатам кладёт roomLabel на группу/реле/пробел; при печати её
     ДОБАВЛЯЕМ, чтобы одноимённые группы разных комнат («Кухня» и «Кухня») не были неразличимы
     (дефект 2). Известна не всегда: одиночный plan комнат не знает (roomLabel undefined), а
     склеенный из нескольких комнат пробел единой комнаты не имеет (roomLabel === null) — в обоих
     случаях суффикса нет, врать про комнату мы не станем. */
  const room = label => label ? ` · ${esc(label)}` : "";

  const groupRows = groups.map(g => {
    const done = ["switch", "changeover", "inverter", "button"]
      .map(role => ({ role, need: g.rolesRequired[role] || 0, got: g.roles[role] || 0 }))
      .filter(x => x.need > 0)
      .map(x => `${esc(roleLabel(plan, x.role))} — ${x.got}${x.got === x.need ? "" : ` из ${x.need}`}`)
      .join(", ");
    return `<div style="${S.row}"><span style="${S.cell}">Группа «${esc(g.label)}»${room(g.roomLabel)} · мест управления: ${g.placeCount}</span>`
      + `<b style="${S.cellRight}">${esc(done || "—")}</b></div>`;
  }).join("");

  /* Реле — количество есть, артикула нет. Печатаем ровно это, ничего не подставляя:
     03992 из ТЗ в каталоге и номенклатуре VIMAR отсутствует. */
  const relayRows = relays.filter(r => r.count > 0).map(r =>
    `<div style="${S.row}"><span style="${S.cell}">Импульсное реле · группа «${esc(r.groupLabel)}»${room(r.roomLabel)} (кнопок: ${r.buttonCount})</span>`
    + `<b style="${S.cellRight}">${r.count} шт. · ${esc(r.note)}</b></div>`).join("");

  const gapRows = gaps.map(g => {
    const where = g.groupLabel ? ` · группа «${g.groupLabel}»` : "";
    const count = Array.isArray(g.places) && g.places.length ? ` · мест: ${g.places.length}` : "";
    return `<div style="${S.gap}">${esc(g.text || "")}${room(g.roomLabel)}${esc(where)}${esc(count)}</div>`;
  }).join("");

  const total = ["switch", "changeover", "inverter", "button"]
    .map(role => ({ role, got: (plan.totals && plan.totals[role]) || 0 }))
    .filter(x => x.got > 0)
    .map(x => `${esc(roleLabel(plan, x.role))} — ${x.got}`)
    .join(", ");
  const sum = Number(d.total) || 0;

  /* Схема в шапке. Расчёт по комнатам (EPLightingByRoom) поднимает schemesByRoom, когда партиции
     считались РАЗНЫМИ схемами: назвать одну нельзя — над механизмами чужой схемы стояло бы имя
     схемы, которой пост не пользовался (дефект 1). Когда схема на все комнаты одна — печатаем её. */
  const schemeText = plan.schemesByRoom ? "по комнатам" : (plan.schemeLabel || plan.scheme || "—");
  return `<div style="${S.box}">`
    + `<div style="${S.head}"><span>${esc(title)}</span>`
    + `<span style="${S.muted}">Схема: ${esc(schemeText)}</span></div>`
    + groupRows
    + relayRows
    + (total ? `<div style="${S.row}"><span style="${S.cell}">Механизмы подобраны расчётом</span><b style="${S.cellRight}">${esc(total)}${sum ? ` · ${money(sum)}` : ""}</b></div>` : "")
    + gapRows
    + `</div>`;
}

/* Подпись роли берём из самого расчёта (place.roleLabel), а не из своего словаря: названия
   ролей — терминология заказчика («Инвертор» вместо «перекрёстный переключатель»), и вторая
   их копия здесь разошлась бы с документами при первой же правке. Фолбэк — сама роль. */
function roleLabel(plan, role) {
  const places = (plan && Array.isArray(plan.places)) ? plan.places : [];
  const found = places.find(p => p && p.role === role && p.roleLabel);
  return found ? found.roleLabel : role;
}

/* ─────────────────── подписи расчёта: «изменится ли что-нибудь у человека» ───────────────────

   Обе подписи сравнивают ДВА расчёта одного и того же списка постов (порядок мест в plan.places
   повторяет порядок входа, поэтому сравнение поэлементное и от номеров постов не зависит).
   Нужны они перенумерации постов: та меняет канонический порядок мест, и перед необратимой
   правкой человеку показывают, что именно изменится.

   planSignature — ВСЁ, ЧТО ПЕЧАТАЕТСЯ: роль, артикул И АДРЕС места («место N из M»).
   ⚠️ Адрес в подписи обязателен. Пока сравнивались только роль и артикул, перенумерация,
   меняющая ТОЛЬКО распределение мест внутри группы (два места одной роли меняются местами:
   артикулы у обоих те же, а «место 1 из 2» уезжает в другой пост), считалась «ничего не
   изменилось» и применялась без вопроса. Но «место N из M» стоит и в примечании к клавише в
   листе монтажника, и в блоке групп света: документы после такой перенумерации ДРУГИЕ.

   kitSignature — только роли и артикулы, БЕЗ адресов. Нужна ровно для того, чтобы назвать
   человеку причину вопроса своими словами: «переставит механизмы» и «переставит адреса мест» —
   разные новости, и одна формулировка на оба случая соврала бы в одном из них. */
const planPlaces = plan => ((plan && Array.isArray(plan.places)) ? plan.places : []);
const planSignature = plan => JSON.stringify(planPlaces(plan)
  .map(p => [p && p.role, p && p.code, p && p.placeNo, p && p.placeCount]));
const kitSignature = plan => JSON.stringify(planPlaces(plan).map(p => [p && p.role, p && p.code]));

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { collect, resolveMechanism, resolveReplacement, seriesMatch, isExtraLowVoltage, addressKey, postKey, rowsByPost, buildHtml,
  planSignature, kitSignature };
if (typeof window !== "undefined") window.EPLightingPlan = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
