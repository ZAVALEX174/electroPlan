/* Добор до целых упаковок (К6б, решения владельца 22–23.10). Поставщик отгружает товар коробками,
   и в заказ по проекту попадает ЦЕЛОЕ число упаковок каждого артикула, а не фактическая потребность.
   Разницу «целые упаковки минус потребность» заказчик хочет видеть ОТДЕЛЬНЫМ разделом «Добор до целых
   упаковок» (артикул, сколько добавлено, цена, сумма), и эта разница входит в итог КП и в панель итогов.

   Модуль — ЧИСТЫЙ (ни state, ни DOM, ни EP_DATA): всё приходит аргументами, как у остальных вынесенных
   модулей (estimate.js, packRound.js). Он собирает СТРОКИ добора как синтетические группы сметы — тогда
   у них нет своего пути денег: specShown/totalsShown/панель/КП/Excel считают их тем же правилом, что и
   обычные строки, и у правки добора физически не будет краёв (§7.1).

   Здесь же — ЕДИНАЯ карта «артикул → размер упаковки» (buildPackMap) и экспортируемый codeKey:
   построение карты раньше жило копией в docs.js только для Excel, а теперь нужно и смете — второй копии
   быть не должно (§7.1). codeKey — та же нормализация, что в supplierSpec.js/specExcel.js (регистр и
   пробелы — оформление, а не разные товары); экспортируем ОДНУ, чтобы будущий код не плодил третью.

   Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports для тестов. */
(() => {
"use strict";

/* Ключ артикула: «20001.0», «20001.0 » и «20001.0» — один товар, а не три строки заказа. Внутренние
   пробелы тоже снимаем («14 513» === «14513»). Та же нормализация есть в supplierSpec.js и specExcel.js
   (их копии — в бэклоге на слияние); наружу экспортируем ЭТУ, чтобы новый код брал готовую (§7.1). */
const codeKey = c => String(c == null ? "" : c).replace(/\s+/g, "").toUpperCase();

/* Правило округления вверх до целой упаковки — ТОЛЬКО EPPackRound (одна копия на все документы, §7.1).
   Доступ ленивый: packRound.js грузится отдельным тегом, а в Node подключается require — как у
   specExcel.packRoundApi. Нет модуля → добор не считаем (вернём пусто), а не падаем. */
function packRoundApi() {
  if (typeof window !== "undefined" && window.EPPackRound) return window.EPPackRound;
  if (typeof require !== "undefined") return require("./packRound.js");
  return null;
}

/* Карта «нормализованный артикул → размер упаковки» из каталога программы (EP_DATA.products с полем
   packQty, подмешанным в js/data.js). Ключи нормализуем codeKey, значения — только целые > 0 (ноль/
   мусор/пусто означают «упаковка неизвестна», такой артикул добора не даёт). Возвращаем ПЛОСКИЙ объект:
   его перебирает for..in и в specExcel (лист «По артикулам»), и здесь — одна форма на обоих потребителей. */
function buildPackMap(products) {
  const map = {};
  (Array.isArray(products) ? products : []).forEach((p) => {
    if (!p || p.code == null || p.packQty == null) return;
    const v = Number(p.packQty);
    if (Number.isFinite(v) && v > 0) map[codeKey(p.code)] = v;
  });
  return map;
}

/* Строки добора как синтетические группы сметы. groups — ГОТОВЫЙ groupList из build (посты + одиночные
   изделия уже просуммированы по составу): добор считается по Σ КАЖДОГО артикула по ВСЕМУ проекту, а не
   по одному посту, поэтому зовётся после группировки. packs — карта из buildPackMap; packMultiple —
   включена ли галка. Выключена / нет карты / нет правила округления → пусто (добор не меняет ничего).

   Σ артикула = Σ по группам (g.count × item.count) для item'ов С артикулом и С ценой: позиции без
   артикула (пробелы подбора, code null) и без цены в добор не входят (решение владельца). Добавлено =
   packRound(Σ, pack) − Σ; нет упаковки / pack=1 / кратно → 0 → строки нет. Цену штуки и имя берём из
   ПЕРВОГО вхождения артикула — как priceByCode в specExcel: у одного кода цена в каталоге одна.

   Каждая строка — группа {topUp:true, members:[]} без личной скидки: discountPersonal остаётся false,
   поэтому общая скидка КП действует на добор, а поле «скидка, %» панели у него не рисуется (members
   пуст). items несёт цену в ЕВРО (как у обычных строк) — specShown сам переведёт её в валюту показа и
   округлит по К7. Порядок строк — по артикулу (numeric), чтобы раздел не зависел от порядка обхода. */
function topUpGroups(groups, packs, packMultiple) {
  if (!packMultiple || !packs) return [];
  const packRound = packRoundApi();
  if (!packRound) return [];

  const acc = new Map();   // codeKey -> {code, name, price (евро), qty (штук по проекту)}
  (Array.isArray(groups) ? groups : []).forEach((g) => {
    const count = Number(g && g.count) || 0;
    if (count <= 0) return;
    ((g && g.items) || []).forEach((it) => {
      if (!it || it.code == null || it.code === "") return;      // без артикула — не в добор
      const price = Number(it.price) || 0;
      if (!(price > 0)) return;                                  // без цены — не в добор
      const c = Number(it.count) || 0;
      if (c <= 0) return;                                        // пояснительные позиции (суппорт «не требуется»)
      const k = codeKey(it.code);
      const cur = acc.get(k);
      if (cur) cur.qty += count * c;
      else acc.set(k, { code: it.code, name: it.name, price, qty: count * c });
    });
  });

  const out = [];
  acc.forEach((v, k) => {
    const added = packRound.packRound(v.qty, packs[k]) - v.qty;
    if (!(added > 0)) return;
    out.push({
      key: "topup:" + k, name: v.name, composition: v.name,
      items: [{ kind: "device", code: v.code, name: v.name, count: 1, price: v.price }],
      unit: "шт.", count: added, sum: added * v.price,
      discount: undefined, members: [], topUp: true
    });
  });
  out.sort((a, b) => a.items[0].code.localeCompare(b.items[0].code, "ru", { numeric: true, sensitivity: "base" }));
  return out;
}

/* Деление строк сметы на ОБЫЧНЫЕ и ДОБОР — ЕДИНОЕ правило «какая строка чем является» (§7.1). Его
   зовут панель, КП (offerPdf) и Excel (specExcel): раньше каждый потребитель фильтровал g.topUp сам,
   и правка добора имела бы три края. На вход — результат build (est.groups) и specShown (печатные
   числа); на выход — { normal, topUp }, где каждый элемент = { g, i, row }: g — группа, i — её ИСХОДНЫЙ
   индекс в est.groups (он же индекс в spec.rows — добор в конце не ломает синхронность), row — печатные
   price/sum этой строки из spec.rows[i] (валюта показа, К7). Порядок внутри обеих частей — как в
   est.groups (добор уже отсортирован по артикулу в topUpGroups). */
function splitRows(est, spec) {
  const groups = (est && est.groups) || [];
  const rows = (spec && spec.rows) || [];
  const normal = [], topUp = [];
  groups.forEach((g, i) => {
    (g && g.topUp ? topUp : normal).push({ g, i, row: rows[i] || {} });
  });
  return { normal, topUp };
}

/* HTML раздела «Добор до целых упаковок» для панели итогов на экране (#specList). Вынесен из
   renderSummary, чтобы в app.js осталась только проводка (правило владельца: новый UI — в свой модуль).
   Чистая функция: DOM не трогает, экранирование и форматирование денег приходят зависимостями
   (esc/moneyShown — те же, что у соседних строк панели). Строки добора идут БЕЗ поля «скидка, %»
   (у добора members пуст, личной скидки нет). В строке — артикул и имя, «сколько добавлено» (count ед.),
   цена за штуку и сумма (печатные числа spec.rows[i] — те же, что уйдут в КП и итог). Какие строки —
   добор, решает splitRows (одно правило на панель/КП/Excel). Нет строк добора → пустая строка:
   потребитель просто ничего не допишет. */
function panelHtml(est, spec, deps) {
  const esc = (deps && deps.esc) || String;
  const moneyShown = (deps && deps.moneyShown) || String;
  const parts = splitRows(est, spec).topUp.map(({ g, row }) => {
    const code = (g.items && g.items[0] && g.items[0].code) || "";
    return `<div class="spec-item spec-topup-item"><div><strong>${esc(code)} · ${esc(g.name)}</strong>`
      + `<span>${g.count} ${esc(g.unit)} · ${moneyShown(row.price)}/шт.</span></div><b>${moneyShown(row.sum)}</b></div>`;
  });
  return parts.length ? `<div class="spec-topup-head">Добор до целых упаковок</div>` + parts.join("") : "";
}

const api = { codeKey, buildPackMap, topUpGroups, splitRows, panelHtml };
if (typeof window !== "undefined") window.EPPackTopUp = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
