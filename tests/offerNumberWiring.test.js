/* СВЯЗКА автонумерации КП с настоящим generateCommercialOffer из app.js (А4, итоги 24.08 §1.3).
   Правило формата/счётчика проверено в offerNumber.test.js; здесь — что оркестратор реально его
   зовёт в нужном месте (pdfBtn) и по решениям владельца: пустой номер → выдаётся, кладётся в
   docHeader (снимок проекта) и в поле ввода, счётчик уходит в EPPrefs; повторная печать того же
   проекта — тот же номер, счётчик не растёт; ручной номер не трогается.

   КАК. Вырезаем ИСХОДНЫЙ текст docHeader+generateCommercialOffer из app.js и исполняем на общем
   стенде (helpers/appStand.js). EPOfferPdf.hasContent по умолчанию возвращает true — автономер
   присваивается ТОЛЬКО ПОСЛЕ стража пустого КП (В8, решение владельца 11.10), поэтому без content
   номер не выдаётся. Окно печати не собираем (window.open→null, после присвоения номера печать
   прерывается тостом). EPOfferNumber и EPPrefs-шим (in-memory) — настоящая связка.

   МУТАЦИОННАЯ ТАБЛИЦА (факт из изолированной копии — в отчёте):
     (д) снять весь блок автономера в generateCommercialOffer → «пустой номер → выдан EPG-…» FAIL
         (docNumber остаётся пустым).
     (е) условие if(current) в assign заменить на if(false) (всегда перевыдаёт) → «повторная печать:
         тот же номер, счётчик не растёт» FAIL (второй прогон даёт 0002) и «ручной не трогается» FAIL.
     (ж) scheduleSave() из блока убрать → «номер закреплён в снимке проекта» FAIL (dh.number пуст
         после — здесь ловится тем, что dh.number проверяем напрямую в EP_DATA.settings.docHeader).
     (з) блок автономера вернуть ВЫШЕ стража hasContent (как было до В8) → «пустой КП номер и счётчик
         НЕ занимает» FAIL (пустому проекту выдаётся EPG-… и заводится счётчик).
   Запуск: node --test tests/offerNumberWiring.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const EPOfferNumber = require("../js/offerNumber.js");
const EPEstimate = require("../js/estimate.js");

/* EPPrefs-шим: единственное хранилище счётчика (бланк компании), общий на «все проекты» прогона. */
function makePrefs(init) {
  const store = Object.assign({}, init);
  return {
    store,
    get: (k, def) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : def),
    set: (k, v) => { store[k] = v; }
  };
}

/* Захват того, что generateCommercialOffer сделал с пользователем: тосты и попытки открыть окно.
   Сбрасывается в начале каждого run — нужен тесту стража пустого проекта (А). */
const captured = { toasts: [], opened: 0 };

/* Контекст исполнения generateCommercialOffer: реальный автономер + заглушки документа. hasContent
   управляемый (В8: номер выдаётся ТОЛЬКО когда есть что печатать). empty=true имитирует ПУСТОЙ проект
   (нет строк сметы): настоящий EPEstimate.isEmptyProject даёт true, страж пустого проекта (А) гасит КП
   до автонумера. Печать прерывается на window.open→null уже ПОСЛЕ присвоения номера, поэтому сборку
   документа собирать не надо. */
function makeCtx(EP_DATA, EPPrefs, dom, hasContent, empty) {
  const noop = () => "";
  return {
    EP_DATA, EPPrefs, EPOfferNumber, EPEstimate, $: dom.$, scheduleSave: () => { scheduleSave.calls++; },
    JSON,
    EPOfferOptions: { normalize: () => ({ sections: {} }) },
    projectLighting: () => ({}), buildEstimate: () => ({ missing: [], groups: empty ? [] : [{}] }),
    money: String, moneyShown: String, displayRate: () => 1, esc: String, displayCurrency: () => "EUR",
    EPRates: { effectiveRate: () => 1 },
    companyLogo: noop, companyTerms: noop, companySignature: noop, companyStamp: noop,
    buildPostLayout: () => ({}), planBlockHtml: noop, lightingHtml: noop, supplierSpecHtml: noop,
    EPOfferPdf: { hasContent: () => hasContent !== false, buildHtml: () => "" },
    toast: m => captured.toasts.push(m), window: { open: () => { captured.opened++; return null; } }
  };
}
const scheduleSave = { calls: 0 };

function run(EP_DATA, EPPrefs, hasContent, empty) {
  captured.toasts = []; captured.opened = 0;
  const dom = stand.makeDom();
  const ctx = makeCtx(EP_DATA, EPPrefs, dom, hasContent, empty);
  ctx.scheduleSave = () => {};
  const gen = stand.run(["docHeader", "generateCommercialOffer"], ctx);
  gen();
  return dom;
}

test("пустой «Номер КП» → выдан EPG-2026-0001, лёг в docHeader, в поле и счётчик в EPPrefs", () => {
  const EP_DATA = { settings: { docHeader: { date: "2026-05-01", number: "" } } };
  const prefs = makePrefs({});
  const dom = run(EP_DATA, prefs);
  assert.equal(EP_DATA.settings.docHeader.number, "EPG-2026-0001", "номер закреплён в снимке проекта");
  assert.equal(dom.$("docNumber").value, "EPG-2026-0001", "номер показан в поле ввода");
  assert.deepEqual(prefs.store.offerCounters, { 2026: 1 }, "счётчик сохранён в бланке компании");
});

test("повторная печать того же проекта — тот же номер, счётчик НЕ растёт", () => {
  const EP_DATA = { settings: { docHeader: { date: "2026-05-01", number: "" } } };
  const prefs = makePrefs({});
  run(EP_DATA, prefs);            // первая печать: выдан 0001
  run(EP_DATA, prefs);            // повторная: номер уже есть
  assert.equal(EP_DATA.settings.docHeader.number, "EPG-2026-0001", "номер не переписан");
  assert.deepEqual(prefs.store.offerCounters, { 2026: 1 }, "счётчик не увеличен повторной печатью");
});

test("ручной номер печать не трогает и счётчик им не двигает", () => {
  const EP_DATA = { settings: { docHeader: { date: "2026-05-01", number: "СЧЁТ-А-7" } } };
  const prefs = makePrefs({});
  const dom = run(EP_DATA, prefs);
  assert.equal(EP_DATA.settings.docHeader.number, "СЧЁТ-А-7", "ручной номер сохранён как есть");
  assert.equal(prefs.store.offerCounters, undefined, "автосчётчик даже не заведён — ручной его не двигал");
});

test("новый проект после первого получает EPG-2026-0002 (счётчик один на все проекты)", () => {
  const prefs = makePrefs({});
  run({ settings: { docHeader: { date: "2026-05-01", number: "" } } }, prefs);
  const second = { settings: { docHeader: { date: "2026-09-01", number: "" } } };
  run(second, prefs);
  assert.equal(second.settings.docHeader.number, "EPG-2026-0002");
  assert.deepEqual(prefs.store.offerCounters, { 2026: 2 });
});

test("ПУСТОЙ КП (нечего печатать) номер и счётчик НЕ занимает (В8)", () => {
  const EP_DATA = { settings: { docHeader: { date: "2026-05-01", number: "" } } };
  const prefs = makePrefs({});
  const dom = run(EP_DATA, prefs, false);   // hasContent=false: страж пустого КП срабатывает
  assert.equal(EP_DATA.settings.docHeader.number, "", "пустому проекту номер не выдан");
  assert.equal(dom.$("docNumber").value, "", "поле номера осталось пустым");
  assert.equal(prefs.store.offerCounters, undefined, "счётчик даже не заведён");
  /* После того как появилось содержимое, тот же проект получает первый номер — пустой проход его
     не «съел». */
  const dom2 = run(EP_DATA, prefs, true);
  assert.equal(EP_DATA.settings.docHeader.number, "EPG-2026-0001", "непустой КП выдал первый номер");
  assert.deepEqual(prefs.store.offerCounters, { 2026: 1 });
});

test("ПУСТОЙ ПРОЕКТ (нет ни поста, ни изделия): КП не открывается, номер и счётчик не заняты (А)", () => {
  const EP_DATA = { settings: { docHeader: { date: "2026-05-01", number: "" } } };
  const prefs = makePrefs({});
  /* empty=true: настоящий EPEstimate.isEmptyProject даёт true, страж пустого проекта гасит КП ДО
     автонумера — даже при hasContent=true (блок итогов с нулями его прежде не ловил). */
  run(EP_DATA, prefs, true, true);
  assert.equal(captured.opened, 0, "окно печати на пустом проекте не открывалось");
  assert.equal(captured.toasts.join("|"), "В проекте пока нет ни одного поста — в предложении нечего печатать",
    "сообщение дословно как утвердил владелец");
  assert.equal(EP_DATA.settings.docHeader.number, "", "номер пустому проекту не выдан");
  assert.equal(prefs.store.offerCounters, undefined, "счётчик даже не заведён");
  /* Появились посты — тот же проект получает первый номер: пустой проход его не «съел». */
  run(EP_DATA, prefs, true, false);
  assert.equal(EP_DATA.settings.docHeader.number, "EPG-2026-0001", "непустой КП выдал первый номер");
  assert.deepEqual(prefs.store.offerCounters, { 2026: 1 });
});
