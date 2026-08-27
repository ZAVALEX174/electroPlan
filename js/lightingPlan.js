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
     isKey(item) → bool                  // клавиша ли это (partRole === "key")
   }

   МЕСТО ДАЁТ ТОЛЬКО КЛАВИША. Модель заказчика: «отображаем мы только кнопки, условно 19021 и
   19022 широкую, а по факту конфигуратор уже сам считает нам механизм». Готовое изделие
   (выключатель в сборе) механизма под собой не требует и местом управления не является —
   иначе проект оплатил бы второй механизм за уже собранное изделие.

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
  const isKey = d.isKey || (() => false);
  const out = [];
  (Array.isArray(posts) ? posts : []).forEach(post => {
    const p = post || {};
    const ids = Array.isArray(p.mechanismIds) ? p.mechanismIds : [];
    const groups = Array.isArray(p.keyGroups) ? p.keyGroups : [];
    ids.forEach((id, keyIndex) => {
      const item = product(id);
      const key = !!isKey(item);
      const group = groupText(groups[keyIndex]);
      /* потерянная клавиша: товара нет в каталоге, но группа у позиции назначена */
      const lostKey = !key && !item && group.trim() !== "";
      if (!key && !lostKey) return;
      out.push({
        postId: p.id, postNumber: p.number,
        /* индекс — позицией перебора и только ей (см. шапку про indexOf) */
        keyIndex,
        keyId: item && item.id != null ? item.id : id,
        /* У потерянного товара серии нет и взять её неоткуда — пустой список, а не догадка. */
        series: key ? seriesOf(item) : [],
        group,
        keyUnknown: !key,
        /* служебное для документов: имя поста и сам товар-клавиша (может быть не найден) */
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

  const groupRows = groups.map(g => {
    const done = ["switch", "changeover", "inverter", "button"]
      .map(role => ({ role, need: g.rolesRequired[role] || 0, got: g.roles[role] || 0 }))
      .filter(x => x.need > 0)
      .map(x => `${esc(roleLabel(plan, x.role))} — ${x.got}${x.got === x.need ? "" : ` из ${x.need}`}`)
      .join(", ");
    return `<div style="${S.row}"><span style="${S.cell}">Группа «${esc(g.label)}» · мест управления: ${g.placeCount}</span>`
      + `<b style="${S.cellRight}">${esc(done || "—")}</b></div>`;
  }).join("");

  /* Реле — количество есть, артикула нет. Печатаем ровно это, ничего не подставляя:
     03992 из ТЗ в каталоге и номенклатуре VIMAR отсутствует. */
  const relayRows = relays.filter(r => r.count > 0).map(r =>
    `<div style="${S.row}"><span style="${S.cell}">Импульсное реле · группа «${esc(r.groupLabel)}» (кнопок: ${r.buttonCount})</span>`
    + `<b style="${S.cellRight}">${r.count} шт. · ${esc(r.note)}</b></div>`).join("");

  const gapRows = gaps.map(g => {
    const where = g.groupLabel ? ` · группа «${g.groupLabel}»` : "";
    const count = Array.isArray(g.places) && g.places.length ? ` · мест: ${g.places.length}` : "";
    return `<div style="${S.gap}">${esc(g.text || "")}${esc(where)}${esc(count)}</div>`;
  }).join("");

  const total = ["switch", "changeover", "inverter", "button"]
    .map(role => ({ role, got: (plan.totals && plan.totals[role]) || 0 }))
    .filter(x => x.got > 0)
    .map(x => `${esc(roleLabel(plan, x.role))} — ${x.got}`)
    .join(", ");
  const sum = Number(d.total) || 0;

  return `<div style="${S.box}">`
    + `<div style="${S.head}"><span>${esc(title)}</span>`
    + `<span style="${S.muted}">Схема: ${esc(plan.schemeLabel || plan.scheme || "—")}</span></div>`
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

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { collect, resolveMechanism, seriesMatch, isExtraLowVoltage, addressKey, postKey, rowsByPost, buildHtml };
if (typeof window !== "undefined") window.EPLightingPlan = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
