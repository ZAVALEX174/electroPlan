/* Свёртка осевых цельных изделий «Управления светом» в одну карточку (К14 ч.3).

   ЗАЧЕМ. Заказчик 15.10 (0:20:47): «если мы берём 19-100 осевой механизм, вот он выключатель…
   19-104… переключатель. То есть у него точно такая же картинка, и зачем это изобилие картинок,
   когда можно просто накидывать и всё». Решение владельца 02.11: одна карточка «Осевой» на серию ×
   цвет × ширину; человек ставит её, а дальше по схеме программа сама решает — выключатель,
   переключатель или инвертор (это уже делает EPLightingPlan.resolveReplacement, К14 ч.1). Пока схема
   ничего не требует — в посте выключатель.

   ПРАВИЛО БЕЗ ВТОРОЙ КОПИИ ПРИЗНАКОВ (§7.1). «Осевой ли» и «роль управления» — те же самые, что у
   resolveReplacement: axialOf = EPLightingPlan.isAxialItem (по названию «осев…/аксиальн…»), roleOf =
   controlRole. Их отдаёт оркестратор через deps; здесь мы только группируем и выбираем представителя.
   Группа — одна серия (seriesKeyOf) + один цвет (EPMechColor.colorKey) + одна ширина (mechanismSpan),
   ровно те же три признака, по которым resolveReplacement считает изделия взаимозаменяемыми. Поэтому
   карточка-представитель и правда покрывает всю свою группу: расчёт подставит нужную роль из неё же.

   ЧТО НЕ ТРОГАЕМ. Неосевые изделия (Plana «тройной 20AX» 14007) и роли button/sensor/прочие остаются
   отдельными карточками: 14007 — не осевой (isAxialItem=false), кнопка/датчик/диммер — другая роль.
   При ПОИСКЕ (непустой запрос) сворачивать нельзя — человек ищет конкретный артикул (19104 и т. п.) и
   обязан его найти; свёртку вызывает оркестратор только при пустом запросе.

   Проверено на реальном каталоге (functionalGroup «Управление светом», 141 активная позиция): свернулись
   только тройки switch/changeover/inverter — Arke 36→24, Eikon Evo 42→30, Plana 19→15; Linea и Neve Up
   не затронуты (своих осевых цельных выключателей в этой группе нет). Во всех реальных группах есть
   выключатель, он и становится представителем; порядок switch>changeover>inverter оставлен на случай
   серии без выключателя (сейчас таких нет).

   Модуль ЧИСТЫЙ: ни DOM, ни state, ни каталога — на вход список изделий и deps-функции, на выход
   сокращённый список и множество id представителей (их карточка получает подпись «Осевой …»). */
(() => {
"use strict";

/* Подпись карточки-представителя. Держим строкой здесь, чтобы и карточка, и будущие потребители
   брали один текст. «по схеме» — потому что конкретную роль выбирает расчёт групп света. */
const CAPTION = "Осевой · выключатель, переключатель или инвертор — по схеме";

/* Роли, которые сворачиваются в одну карточку, и их приоритет при выборе представителя: сначала
   выключатель (владелец: «берём 19-100… выключатель»), затем переключатель, затем инвертор. Роль вне
   этого набора (кнопка/датчик/диммер) не сворачивается вовсе. */
const ROLE_PRIORITY = { switch: 0, changeover: 1, inverter: 2 };

/* collapse(items, deps) → { items, repIds }
     items  — входной список БЕЗ свёрнутых не-представителей (порядок входа сохранён);
     repIds — Set id изделий-представителей, чья карточка должна нести подпись CAPTION.
   deps = { partOf, roleOf, axialOf, spanOf, colorKeyOf, seriesKeyOf, idOf }. Все признаки приходят
   функциями, чтобы «осевой» и «роль» были теми же, что у resolveReplacement, а не их копией. */
function collapse(items, deps) {
  const list = Array.isArray(items) ? items : [];
  const d = deps || {};
  const partOf = d.partOf || (i => i && i.partRole);
  const roleOf = d.roleOf || (i => i && i.controlRole);
  const axialOf = d.axialOf || (() => false);
  const spanOf = d.spanOf || (() => 1);
  const colorKeyOf = d.colorKeyOf || (() => null);
  const seriesKeyOf = d.seriesKeyOf || (() => "");
  const idOf = d.idOf || (i => i && i.id);

  /* Сворачиваем только ЦЕЛЬНОЕ осевое изделие роли switch/changeover/inverter: !partOf отсекает и
     голые механизмы (bare_mechanism), и клавиши (key) — их заменой не покрыть. */
  const collapsible = item => !!item && !partOf(item) && axialOf(item)
    && Object.prototype.hasOwnProperty.call(ROLE_PRIORITY, String(roleOf(item)));

  /* Ключ группы — те же три признака взаимозаменяемости, что у resolveReplacement. colorKey бывает
     null («цвет не задан»): даём ему явный маркер, чтобы не слиплись с цветными. */
  const groupKeyOf = item => [
    seriesKeyOf(item),
    colorKeyOf(item) == null ? "\u0000" : String(colorKeyOf(item)),
    spanOf(item)
  ].join("::");

  const groups = new Map();
  list.forEach((item, seq) => {
    if (!collapsible(item)) return;
    const k = groupKeyOf(item);
    let g = groups.get(k);
    if (!g) { g = []; groups.set(k, g); }
    g.push({ item, seq });
  });

  const repIds = new Set();
  const dropIds = new Set();
  groups.forEach(group => {
    if (group.length < 2) return;                 // нечего сворачивать — одиночная карточка как была
    /* Представитель: наименьший приоритет роли (switch<changeover<inverter); при равной роли —
       меньший seq, чтобы выбор был детерминирован и не зависел от порядка Map. */
    const rep = group.slice().sort((a, b) => {
      const ra = ROLE_PRIORITY[String(roleOf(a.item))], rb = ROLE_PRIORITY[String(roleOf(b.item))];
      return ra !== rb ? ra - rb : a.seq - b.seq;
    })[0];
    repIds.add(idOf(rep.item));
    group.forEach(({ item }) => { if (item !== rep.item) dropIds.add(idOf(item)); });
  });

  return { items: list.filter(item => !dropIds.has(idOf(item))), repIds };
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — для автотестов (PLAN 7.1). */
const api = { collapse, CAPTION };
if (typeof window !== "undefined") window.EPAxialCard = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
