/* Слоты конструктора поста: механизм + ГРУППА СВЕТА клавиши, стоящей в этом слоте (C8).

   ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ. Группа света задаётся КЛАВИШЕ, то есть позиции в посте, а конструктор
   свой массив механизмов и переставляет (renderBuilder принимает упакованный порядок из
   EPPosts.distributePosts), и фильтрует (EPPosts.fitMechanismIds выкидывает чужие для набора и
   не влезающие). Параллельный массив «группа по индексу клавиши» после любой из этих операций
   указывал бы НЕ НА ТУ клавишу — и модуль групп света посчитал бы деньги по чужим местам, ничего
   не сообщив. Дублировать здесь упаковку с возвратом (packAll) ради переноса групп нельзя тем
   более: вторая копия правил раскладки рано или поздно разойдётся с первой.

   РЕШЕНИЕ — ТОКЕНЫ ПОЗИЦИЙ. Алгоритмы EPPosts работают со списком id товаров; мы даём им вместо
   id ПОЗИЦИИ слотов (0,1,2…) и подменяем чтение каталога (deps.product) на «токен → товар этого
   слота». Токены уникальны даже когда в посте два одинаковых механизма, поэтому ответ EPPosts —
   это перестановка/подмножество ПОЗИЦИЙ, по которой слоты (вместе с группами) собираются
   обратно один в один. Логика раскладки при этом остаётся ОДНА, в EPPosts, — здесь только
   переходник, и он проверяется автотестом.

   Модуль ЧИСТЫЙ: ни DOM, ни state, ни EPPosts (его функции зовёт оркестратор, передавая сюда
   готовый ответ). Интерфейс приложению — window.EPBuilderSlots. */
(() => {
"use strict";

/* Группа света — свободная строка человека («Кухня», «4.1», «71 72»).
   ⚠️ ТОЛЬКО СТРОКА, НИКОГДА ЧИСЛО: 4.10 в JS это 4.1, и группа «4.10» с плана заказчика слилась
   бы с «4.1» — две разные группы стали бы одной, а два выключателя (20.26 €) — двумя
   переключателями (25.79 €). Поэтому и здесь, и в поле ввода интерфейса значение живёт строкой,
   а нормализацию написания делает уже EPLightingGroups.normalizeGroup. */
const groupText = v => (v === null || v === undefined) ? "" : String(v);

/* Слот: id механизма (число, как в post.mechanismIds) + группа света (строка).
   Группа хранится ВМЕСТЕ с механизмом, а не в параллельном массиве, — в этом вся суть модуля. */
const slot = (id, group) => ({ id: Number(id), group: groupText(group) });

/* Слоты из сохранённого поста. keyGroups — массив групп, параллельный mechanismIds; у старых
   проектов его нет вовсе, и все группы приходят пустыми (это и есть верное поведение: пробел
   «группа не указана» честнее молчаливой подстановки — см. GAPS.NO_GROUP). */
function fromPost(post) {
  const p = post || {};
  const ids = Array.isArray(p.mechanismIds) ? p.mechanismIds : [];
  const groups = Array.isArray(p.keyGroups) ? p.keyGroups : [];
  return ids.map((id, i) => slot(id, groups[i]));
}

/* Слоты → поля поста. keyGroups отдаём ВСЕГДА той же длины, что mechanismIds: массив короче
   («хвост пустой, зачем его хранить») развалил бы соответствие по индексу при первой же правке
   середины поста. */
function toPost(slots) {
  const list = Array.isArray(slots) ? slots : [];
  return { mechanismIds: list.map(s => Number(s.id)), keyGroups: list.map(s => groupText(s.group)) };
}

/* Есть ли в посте хоть одна заполненная группа — по этому признаку интерфейс и документы
   решают, показывать ли раздел групп света вообще. */
const hasGroups = slots => (Array.isArray(slots) ? slots : []).some(s => groupText(s && s.group).trim() !== "");

/* ─────────────────────── переходник к EPPosts ─────────────────────── */

/* Токены = позиции слотов. Именно они уходят в EPPosts вместо id товаров. */
const tokens = slots => (Array.isArray(slots) ? slots : []).map((_, i) => i);

/* Подмена чтения каталога: EPPosts спросит товар по «id», а получит товар слота с этим номером.
   mechanismSpan остаётся настоящим — ширина механизма от подмены не зависит. */
function tokenDeps(slots, deps) {
  const list = Array.isArray(slots) ? slots : [];
  const d = deps || {};
  const product = d.product || (() => null);
  return {
    product: token => {
      const s = list[Number(token)];
      return s ? product(s.id) : null;
    },
    mechanismSpan: d.mechanismSpan || (() => 1)
  };
}

/* Список «разрешённых» для EPPosts.fitMechanismIds — но в токенах: слот проходит, если его товар
   есть в наборе items (совместимые с накладкой механизмы). Форма {id} — ровно та, что читает
   fitMechanismIds (он берёт у элементов только id). */
function allowedTokens(slots, items) {
  const list = Array.isArray(slots) ? slots : [];
  const ids = new Set((Array.isArray(items) ? items : []).map(item => Number(item && item.id)));
  const out = [];
  list.forEach((s, i) => { if (ids.has(Number(s.id))) out.push({ id: i }); });
  return out;
}

/* Ответ EPPosts (перестановка/подмножество токенов) → слоты. Токен вне диапазона молча
   пропускаем: сюда приходит результат чужой функции, и лишний undefined в слотах развалил бы
   и превью, и смету. */
function pick(slots, tokenList) {
  const list = Array.isArray(slots) ? slots : [];
  return (Array.isArray(tokenList) ? tokenList : [])
    .map(t => list[Number(t)])
    .filter(Boolean)
    .map(s => slot(s.id, s.group));
}

/* ─────────────────────── правки слотов ─────────────────────── */

/* Все три правки возвращают НОВЫЙ массив: конструктор перерисовывается целиком, и мутация
   исходного массива прятала бы источник изменений. Группа при замене механизма СОХРАНЯЕТСЯ —
   человек меняет клавишу «на 1 модуль» на «на 2 модуля» в том же месте той же группы, и
   заставлять его вводить группу заново значило бы терять данные на ровном месте. */
const add = (slots, id) => (Array.isArray(slots) ? slots : []).concat([slot(id, "")]);
const removeAt = (slots, index) => (Array.isArray(slots) ? slots : []).filter((_, i) => i !== Number(index));
function replaceAt(slots, index, id) {
  const list = Array.isArray(slots) ? slots : [];
  const i = Number(index);
  return list.map((s, j) => j === i ? slot(id, s.group) : slot(s.id, s.group));
}
function setGroup(slots, index, group) {
  const list = Array.isArray(slots) ? slots : [];
  const i = Number(index);
  return list.map((s, j) => j === i ? slot(s.id, group) : slot(s.id, s.group));
}

/* Снять группы со всего набора, сохранив сами механизмы.
   ⚠️ НУЖНО ДЛЯ ШАБЛОНА. Группа света — свойство ПОСТА НА ПЛАНЕ, а не шаблона: один и тот же
   шаблон («выключатель у двери») ставится в три комнаты, и это три РАЗНЫХ группы, а не одна
   с тремя местами управления. Шаблон, принесший свою группу, молча превратил бы три
   независимых выключателя (3 × 20.26 €) в проходную схему из двух переключателей и инвертора
   (25.79 + 25.79 + 42.33 €) — другая схема, другой монтаж и другие деньги. Поэтому конструктор
   шаблона открывает набор БЕЗ групп, а размещение на плане их не копирует. */
const clearGroups = slots => (Array.isArray(slots) ? slots : []).map(s => slot(s && s.id, ""));

/* Новая позиция слота после перестановки/фильтрации, выполненной через pick(): tokenList —
   ответ EPPosts (старые индексы в новом порядке), index — старый индекс. Слот выброшен → -1.
   ⚠️ ЗАЧЕМ. Конструктор помнит слот, помеченный «Заменить», НОМЕРОМ. Любая перерисовка,
   которая выкидывает слоты (смена накладки — чужой серии механизм отсеивается; смена числа
   модулей — не влезающий отсеивается) или переставляет их (упаковка по постам накладки),
   меняет смысл этого номера: пометка молча переезжает на слот, который человек не выбирал, и
   следующая карточка каталога заменяет ЧУЖОЙ механизм. Номер обязан ехать через ту же
   перестановку, что и сами слоты, — либо честно сбрасываться.
   Номер читается СТРОГО: целое число либо строка из одних цифр. Голый Number() здесь врал бы
   молча — Number("") и Number(null) равны нулю, и «цель не задана» становилась бы «цель —
   первый слот»: карточка каталога заменила бы механизм, которого человек не выбирал. */
function reindex(tokenList, index) {
  const list = Array.isArray(tokenList) ? tokenList : [];
  const i = typeof index === "number" ? index
    : (typeof index === "string" && /^\d+$/.test(index.trim()) ? Number(index.trim()) : NaN);
  if (!Number.isInteger(i) || i < 0) return -1;
  return list.findIndex(t => Number(t) === i);
}

/* Подпись набора — «изменился ли пост с момента открытия конструктора».
   Кодирование НЕСКЛЕИВАЕМОЕ (JSON), а не «id:группа через запятую»: имя группы вводит человек
   и в нём законно бывают и запятые, и двоеточия («Кухня, рабочая зона»), — склеенная подпись
   объявила бы два разных набора одинаковыми и потеряла бы правки без предупреждения. */
const signature = slots => JSON.stringify((Array.isArray(slots) ? slots : []).map(s => [Number(s && s.id), groupText(s && s.group)]));

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { slot, fromPost, toPost, hasGroups, tokens, tokenDeps, allowedTokens, pick,
  add, removeAt, replaceAt, setGroup, clearGroups, reindex, signature };
if (typeof window !== "undefined") window.EPBuilderSlots = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
