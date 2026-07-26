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
    lines.push({
      key: "p" + po.name,
      name: po.name,
      composition: [
        frameProduct(po.frameId) && frameProduct(po.frameId).name,
        `${(po.mechanismIds || []).length} подрозетн.`,
        ...(po.mechanismIds || []).map((id) => product(id) && product(id).name)
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

window.EPEstimate = { build };
})();
