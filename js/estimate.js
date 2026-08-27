/* Расчёт сметы — единственный источник истины (PLAN 2.4).
   И панель «Стоимость проекта», и коммерческое предложение считают только этим модулем.
   Раньше формулы были скопированы в оба места и успели разойтись: панель переживала
   товар, отсутствующий в каталоге, а КП на нём падало.

   Модуль намеренно НЕ знает про state, DOM и EP_DATA — все зависимости передаются
   в аргументах. Это позволяет позже накрыть расчёт автотестами (PLAN 7.1), не поднимая
   приложение целиком.

   Интерфейс приложению — window.EPEstimate.build(input) */
(() => {
"use strict";

/* input = {
     devices:[{productId}], posts:[{name,frameId,mechanismIds}],
     product(id) -> товар|undefined, postCost(post) -> число,
     frameProduct(id) -> товар|undefined,
     settings:{workPercent,materialsPercent,discountPercent,vatPercent,vatEnabled}
   }
   Все суммы — в базовой валюте каталога (евро прайса). Пересчёт в рубли делает
   представление, а не расчёт: иначе повторная конвертация после смены курса
   накапливала бы ошибку. */
function build(input) {
  const devices = input.devices || [];
  const posts = input.posts || [];
  const product = input.product || (() => undefined);
  const frameProduct = input.frameProduct || product;
  const postCost = input.postCost || (() => 0);
  /* Состав поста (число коробок по стандарту накладки, подобранный суппорт) — из
     EPPosts.postComposition. Необязательная зависимость: без неё смета считается как
     раньше (коробка на каждый механизм) — так старые вызовы и автотесты не ломаются. */
  const postComposition = input.postComposition || null;
  const s = input.settings || {};

  const lines = [], missing = [];

  devices.forEach((d) => {
    const p = product(d.productId);
    /* товар может отсутствовать штатно: проект восстановлен из хранилища, а прайс
       с тех пор перезалили. Позиция остаётся в смете с нулевой ценой и явной
       пометкой — потерять её молча хуже, чем показать проблему */
    if (!p) missing.push(d.productId);
    lines.push({
      key: p ? "d" + p.id : "d?" + d.productId,
      name: p ? p.name : `Товар не найден (арт. ${d.productId})`,
      composition: p ? p.code : `артикул ${d.productId} отсутствует в каталоге`,
      unit: (p && p.unit) || "шт.",
      price: (p && p.price) || 0
    });
  });

  posts.forEach((po) => {
    const comp = postComposition ? postComposition(po) : null;
    const boxes = comp ? comp.boxCount : (po.mechanismIds || []).length;
    /* Суппортов столько же, сколько коробок (postComposition.supportCount): у немецко-
       французской накладки их 2–4, а печатался всегда один — состав врал вслед за ценой.
       Читаем защитно, как и boxCount: postComposition — необязательная зависимость, и
       старый вызов (или самодельный comp) придёт без supportCount; тогда суппорт один,
       как считалось раньше, а не «undefined суппорт» в спецификации. */
    const supports = comp ? (comp.supportCount != null ? comp.supportCount : (comp.support ? 1 : 0)) : 0;
    /* Суппорт подобран нами, а не назван заказчиком (postComposition.supportAssumed): в
       номенклатуре у накладки монтажное правило есть, а артикула планки под него нет —
       36 накладок из 1631 (09671.*, 09679.*, 22673.1.*, 22683.1.*). Артикул печатаем, но с пометкой:
       без неё догадка в КП читается как согласованный факт. Формулировка ОДНА во всех
       документах — здесь, в листе монтажника (installSheet.buildFittings) и в панели
       «Состав поста» (app.js); менять только вместе. */
    const assumedMark = comp && comp.supportAssumed ? " (предположительно)" : "";
    /* Группируем посты ПО СОСТАВУ (накладка + набор механизмов), а не по имени/номеру.
       Раньше ключом было имя поста; теперь у каждого размещённого поста свой сквозной
       номер, и по номеру одинаковые посты перестали бы сходиться — смета раздулась бы
       в строку на каждый пост. Номера используются в разделе «Раскладка постов», где
       каждый пост показан отдельно; в позиционной спецификации идентичные посты — одна
       строка с количеством. Суппорт/коробка производны от накладки+механизмов+типа стены
       (тип стены на смету один), поэтому в ключ достаточно накладки и мультимножества
       механизмов. */
    const key = "p" + po.frameId + ":" + [...(po.mechanismIds || [])].map(Number).sort((a, b) => a - b).join(",");
    lines.push({
      key,
      name: po.name,
      /* Порядок состава — как при сборке и как у заказчика: механизмы → суппорт →
         коробка → накладка (раньше был обратный). */
      composition: [
        ...(po.mechanismIds || []).map((id) => product(id) && product(id).name),
        /* «Суппорт не требуется» пишем словами: у крышек IP55 планки нет по устройству
           изделия, и молчание в составе читается как забытая позиция. Цену это не меняет —
           строка чисто пояснительная.
           Количество печатаем ТОЛЬКО когда планок больше одной — тем же приёмом, что «×N»
           у коробки во взрыв-схеме: число появляется там, где оно что-то меняет. Суппорт
           один на подавляющем большинстве накладок (итальянские и универсальные — 1351 из
           1631), и постоянное «1 × » переписало бы состав в КП на всех них ради нуля
           информации; «2 × » видно ровно там, где это правда важно, — в немецко-французской
           сборке, где планок столько же, сколько коробок. */
        comp && comp.supportNotRequired ? "суппорт не требуется"
          : comp && comp.support && supports
            && (supports > 1
              ? `${supports} × суппорт ${comp.support.name}${assumedMark}`
              : `суппорт ${comp.support.name}${assumedMark}`),
        `${boxes} подрозетн.`,
        frameProduct(po.frameId) && frameProduct(po.frameId).name
      ].filter(Boolean).join(", "),
      unit: "компл.",
      price: postCost(po)
    });
  });

  /* группировка даёт спецификации и КП честное «Кол.» вместо строки на каждый объект */
  const groups = new Map();
  lines.forEach((l) => {
    const g = groups.get(l.key) || { name: l.name, composition: l.composition, unit: l.unit, count: 0, sum: 0 };
    g.count++; g.sum += l.price; groups.set(l.key, g);
  });

  const equipment = lines.reduce((acc, l) => acc + l.price, 0);
  /* скидка бьётся по оборудованию, а работы и материалы считаются уже от него —
     иначе процент «отыгрывался» бы обратно через надбавки */
  const discountPercent = Math.max(0, Math.min(100, Number(s.discountPercent) || 0));
  const discount = equipment * discountPercent / 100;
  const equipmentNet = equipment - discount;
  const materials = equipmentNet * (Number(s.materialsPercent) || 0) / 100;
  const work = equipmentNet * (Number(s.workPercent) || 0) / 100;
  const subtotal = equipmentNet + materials + work;
  const vatPercent = s.vatEnabled ? (Number(s.vatPercent) || 0) : 0;
  const vat = subtotal * vatPercent / 100;

  return {
    groups: [...groups.values()], missing,
    equipment, discountPercent, discount, equipmentNet,
    materials, work, subtotal, vatPercent, vat, total: subtotal + vat
  };
}

/* Двойной экспорт: в браузере — глобальный namespace (сборщика в проекте нет,
   см. PLAN 2.2), в Node — module.exports, чтобы автотесты (PLAN 7.1) могли
   подключить расчёт напрямую, не поднимая приложение и DOM. */
if (typeof window !== "undefined") window.EPEstimate = { build };
if (typeof module !== "undefined" && module.exports) module.exports = { build };
})();
