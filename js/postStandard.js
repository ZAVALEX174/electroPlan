/* Монтажный стандарт накладки: итальянская ↔ немецкая ПАРА одной отделки (Б8-д) — ЧИСТАЯ доменная
   логика над товаром-накладкой, без state/DOM/каталога: список накладок приходит аргументом, как
   frameOrientation.js/buttonFrame.js (PLAN 7.1). Здесь ОДНО место правила «какая накладка является
   двойником другого стандарта той же отделки»: его спрашивают и переключатель стандарта в окне поста
   (связь в обе стороны), и подбор пула. Второй копии правила нет — у правки нет краёв (§7.1).

   Заказчик (11.11): «Итальянский монтажный стандарт не подразумевает вертикального монтажа…
   предлагаю у каждого блока добавить качельку расположения и рядом качельку (итальянский/немецкий
   стандарт)… сможет поменять стандарт и сделать его вертикальным уже в нужном формате». Стандарт
   поста выводится из накладки (posts.js frameStandard/postComposition) — поэтому смена стандарта это
   замена накладки на двойник другого стандарта, а состав и цена пересчитываются сами.

   --- ЧТО ТАКОЕ ДВОЙНИК СТАНДАРТА ---------------------------------------------------------------
   У накладки IT (итальянская, одна коробка на накладку) есть двойник DE (немецкая, по коробке на
   пост) ТОЙ ЖЕ отделки: LINEA 30654.00 «белая» (IT) ↔ 30643.00 «белая» (DE). Совпадают серия, число
   модулей (slotCount) и цвет накладки (frameColor); различаются стандарт и база артикула. Двойник
   ищем по ПРИЗНАКАМ ИЗ ДАННЫХ (серия + slotCount + frameColor + явно названная фактура Reflex +
   при неоднозначности суффикс артикула),
   а не хардкодом «30654↔30643», чтобы перезалив прайса с новыми отделками/сериями не требовал правки
   кода. Немецкие накладки есть только на 4/6/8 модулей и не во всех сериях — где двойника нет, пару
   НЕ отдаём (null): выдуманного стандарта лучше не подставлять (§7.1).

   --- ВЕРТИКАЛЬНАЯ ИСХОДНАЯ --------------------------------------------------------------------
   Вертикальные накладки (LINEA 30645/30646) — это DE-двойники в вертикальном расположении. Их
   ориентацию держит EPFrameOrientation. Поэтому стандарт двойника считаем от ГОРИЗОНТАЛЬНОГО базиса
   (EPFrameOrientation.horizontalOf), а после нахождения двойника другого стандарта возвращаем ему
   ТЕКУЩЕЕ расположение (EPFrameOrientation.oriented): «Немецкий» при включённом «Вертикально» на
   30654.00 даёт 30645.00; «Итальянский» на 30645.00 даёт 30654.00 (вертикальной пары у IT нет —
   расположение остаётся свободным флагом, как сейчас). */
(() => {
"use strict";

/* EPFrameOrientation — из window (подключён до этого файла) либо require (node-тесты); тот же приём,
   что EPSeriesMatch в postfit.js. Правило ориентации — ОДНО место, второй копии не заводим. */
const EPFrameOrientation = (typeof module !== "undefined" && module.exports)
  ? require("./frameOrientation.js") : (typeof window !== "undefined" ? window.EPFrameOrientation : undefined);

/* Нормализованный монтажный стандарт накладки: "IT"/"DE"/"BOTH"/"" (пусто = не определён). То же
   поле standard, что читают posts.frameStandard и catalog.productStandards. */
function standardOf(frame) {
  return String((frame && frame.standard) || "").toUpperCase();
}

/* Ключ серии из возможных полей прайса (массив или строка), нормализованный — тот же набор полей и
   та же нормализация, что у EPFrameOrientation/EPCatalog.productSeries. */
function seriesKey(frame) {
  const raw = frame && (frame.series ?? frame.compatibility);
  const arr = Array.isArray(raw) ? raw : String(raw || "").split(/[,;|]/);
  return arr.map(s => String(s || "").trim().toLowerCase()).filter(Boolean).sort().join("|");
}

/* Суффикс отделки — часть артикула после базы (первой точки): «30643.00» → «00», «30643.70.01» →
   «70.01». Различает одноцветных кандидатов (Arke 19643.B06 vs 19643.B26 — цвет один). */
function facingSuffix(code) {
  const c = String(code || "");
  const i = c.indexOf(".");
  return i < 0 ? "" : c.slice(i + 1);
}

/* Число модулей накладки — то же поле, что frameSlotCount (slotCount каталога). */
function slotCountOf(frame) {
  return Number(frame && (frame.slotCount ?? frame.slots ?? frame.placeCount)) || 0;
}

/* В номенклатуре Arke «рефлекс слоновая кость» и обычная «слоновая кость» имеют ОДИН
   frameColor, но разную фактуру и цену. Материал из attrs здесь не годится как ключ:
   у ряда настоящих IT/DE-пар он различается. Проверяем явное слово отделки в имени,
   сохраняя законные пары с разными суффиксами артикула (например 30654.70/30643.70.01). */
function reflexOf(frame) {
  return /(?:рефлекс|reflex)/i.test(String((frame && frame.name) || ""));
}

/* Plana Up в прайсе записана в той же серии и цвете, что обычная Plana, но это
   другая модель; её имя явно содержит «Plana Up», немецких накладок этой модели нет. */
function planaUpOf(frame) {
  return /\bPlana Up\b/i.test(String((frame && frame.name) || ""));
}

/* При разных суффиксах цвет сам по себе не доказывает одинаковую отделку:
   Plana .71 — металл, а немецкая .27 того же цвета — технополимер.
   Одинаковый суффикс оставляем главным признаком пары: в атрибутах ряда
   настоящих IT/DE-пар материал указан по-разному. */
function sameFacingMaterial(base, candidate) {
  return facingSuffix(base.code) === facingSuffix(candidate.code) ||
    !!(base.frameMaterial && candidate.frameMaterial && base.frameMaterial === candidate.frameMaterial);
}

/* Горизонтальный «представитель» накладки: вертикальная (LINEA 30645/30646) приводится к своему
   горизонтальному двойнику — именно от него и его стандарта считаем пару другого стандарта. */
function horizontalBase(frame, frames) {
  if (!frame) return null;
  return EPFrameOrientation && EPFrameOrientation.isVertical(frame)
    ? EPFrameOrientation.horizontalOf(frame, frames) : frame;
}

/* Монтажный стандарт, который показывает переключатель для этой накладки: стандарт горизонтального
   базиса. Вертикальная DE (30645) показывает "DE"; универсальная — "BOTH"; нет накладки → "". */
function currentStandard(frame, frames) {
  const base = horizontalBase(frame, frames);
  return base ? standardOf(base) : "";
}

/* Двойник ДРУГОГО стандарта той же отделки (горизонтальный): серия + slotCount + frameColor +
   явно названная фактура Reflex, при неоднозначности — тот же суффикс артикула.
   Ровно один кандидат → он; ноль или несколько → null
   (выдуманного двойника не подставляем, §7.1). Источник должен быть IT или DE: у BOTH «другого
   стандарта» нет, у неопределённого — тоже. Кандидаты только ГОРИЗОНТАЛЬНЫЕ (вертикальный DE-двойник
   30645 не должен подмениться за горизонтальный) и только АКТИВНЫЕ. kind — страховка от совпадения
   имени механизма. */
function twinOf(frame, frames) {
  const base = horizontalBase(frame, frames);
  if (!base || (base.kind && base.kind !== "frame")) return null;
  const std = standardOf(base);
  if (std !== "IT" && std !== "DE") return null;   // BOTH/неопределённый — не источник двойника
  const other = std === "IT" ? "DE" : "IT";
  const sk = seriesKey(base), sc = slotCountOf(base), color = base.frameColor;
  let hits = (Array.isArray(frames) ? frames : []).filter(f =>
    f && f !== base && f.active !== false && (!f.kind || f.kind === "frame") &&
    standardOf(f) === other &&
    !(EPFrameOrientation && EPFrameOrientation.isVertical(f)) &&
    seriesKey(f) === sk && slotCountOf(f) === sc &&
    f.frameColor === color && reflexOf(f) === reflexOf(base) &&
    planaUpOf(f) === planaUpOf(base) && sameFacingMaterial(base, f));
  if (hits.length > 1) {
    // Несколько одноцветных кандидатов (Arke B06/B26) — сужаем тем же суффиксом артикула, что у базиса.
    const suf = facingSuffix(base.code);
    const narrowed = hits.filter(f => facingSuffix(f.code) === suf);
    if (narrowed.length) hits = narrowed;
  }
  return hits.length === 1 ? hits[0] : null;
}

/* Есть ли у накладки двойник нужного стандарта — для «доступна ли позиция переключателя». */
function hasStandard(frame, standard, frames) {
  return !!frameForStandard(frame, standard, frames, EPFrameOrientation && EPFrameOrientation.isVertical(frame));
}

/* Накладка нужного монтажного стандарта с применённым ТЕКУЩИМ расположением, или null (стандарта в
   этой отделке нет). standard совпадает с текущим → сам горизонтальный базис; противоположный →
   twinOf; у BOTH/неопределённого двойника нет → null. После выбора накладки другого стандарта
   возвращаем ей текущую ориентацию (vertical) через EPFrameOrientation.oriented — двойника-вертикали
   нет → та же накладка (расположение остаётся свободным флагом). */
function frameForStandard(frame, standard, frames, vertical) {
  const base = horizontalBase(frame, frames);
  if (!base) return null;
  const cur = standardOf(base);
  let target = null;
  if (standard === cur && (cur === "IT" || cur === "DE")) target = base;
  else if ((cur === "IT" || cur === "DE") && (standard === "IT" || standard === "DE")) target = twinOf(frame, frames);
  if (!target) return null;
  return (EPFrameOrientation ? EPFrameOrientation.oriented(target, frames, !!vertical) : null) || target;
}

/* Отметка «Расположить вертикально» ВКЛЮЧЕНА (Б8-д ч.3, ответ заказчика — вариант «а», подтверждён
   владельцем 13.11): «отметка на посту с 30654 сама меняет накладку на 30645 (2+2 вертикально) — пост
   переходит на немецкий стандарт, с двумя коробками и двумя суппортами». Это ОДНО место правила
   «отметка включена → вертикальная накладка, добытая хоть сменой стандарта»; зовёт его обработчик
   отметки в окне поста (postBuilder.toggleFrameOrientation), второй копии нет (§7.1).
   Порядок: 1) обычный вертикальный двойник пары (30643→30645, 30644→30646 — EPFrameOrientation.oriented,
   прежний путь; standardChoice не трогаем — пост и так немецкий); 2) пары нет и накладка ИТАЛЬЯНСКОГО
   стандарта → немецкий двойник с применённой вертикальной ориентацией (frameForStandard(frame,"DE",…,
   true): 30654.* → 30645.*) — только если полученная DE накладка действительно вертикальна,
   просим выставить standardChoice="DE". Ни того ни другого (Reflex 30654.40-.42, 7М 30657,
   Neve Up с горизонтальным DE-двойником, BOTH/неопределённый стандарт) → null: отметка
   остаётся свободным флагом, накладка и стандарт не меняются (поведение ровно как прежде).
   СНЯТИЕ отметки сюда не приходит: оно идёт прежним путём pairOf (30645→30643), обратно на 30654
   сознательно НЕ возвращаем (связь пары с 09.11). */
function frameForVerticalOn(frame, frames) {
  if (!frame || !EPFrameOrientation) return null;
  const direct = EPFrameOrientation.oriented(frame, frames, true);
  if (direct && direct !== frame) return { frame: direct, standardChoice: null };   // есть пара ориентации
  if (standardOf(frame) !== "IT") return null;   // уже DE/BOTH/неопределённый — стандарт не меняем
  const de = frameForStandard(frame, "DE", frames, true);
  // oriented() при отсутствии вертикальной пары возвращает горизонтальную DE: такой
  // автопереход изменил бы коробки, суппорты и цену без вертикальной накладки.
  return (de && de !== frame && EPFrameOrientation.isVertical(de))
    ? { frame: de, standardChoice: "DE" } : null;
}

/* Критерий отбора накладок КОМНАТЫ с учётом выбранного РУКАМИ стандарта (Б8-д). Если у поста задан
   standardChoice ("IT"/"DE"), он ПЕРЕБИВАЕТ поле standard в критерии комнаты — ручной выбор стандарта
   главнее стандарта комнаты (утверждённое владельцем правило: стандарт комнаты — лишь умолчание). Нет
   выбора (null/иное) → критерий комнаты возвращаем КАК ЕСТЬ (та же ссылка), поведение прежнее.
   Это ОДНО место правила «выбранный стандарт замещает стандарт комнаты в пуле»: его зовут и пул окна
   поста (postBuilder builderRoomFilter), и подмена накладки при размещении/копировании (postVariant
   frameForRoomPlacement) — второй копии нет, у правки нет краёв (§7.1). Накладки другого стандарта в этой
   отделке нет → productsForRoom вернёт пусто там, где зовут, и подбор поведёт себя как при «накладки нет»
   (ничего нового не изобретаем). */
function criteriaForChoice(criteria, choice) {
  return (choice === "IT" || choice === "DE") ? { ...criteria, standard: choice } : criteria;
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports для тестов. */
const api = { standardOf, currentStandard, twinOf, hasStandard, frameForStandard, frameForVerticalOn, criteriaForChoice };
if (typeof window !== "undefined") window.EPPostStandard = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
