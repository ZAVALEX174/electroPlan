/* КЛАССИФИКАЦИОННЫЙ тест отмены (Б4, ч.А). Каждое поле, которое РЕАЛЬНО возвращает projectSnapshot,
   обязано быть отнесено ровно к одной группе: ПЛАН (отменяется), НАСТРОЙКИ (не отменяются) или
   ВИД/прочее (не отменяется). Это сторож против тихой ошибки: добавят новое поле в снимок — и оно
   либо попадёт в отмену без спроса, либо выпадет из неё молча. Непроклассифицированное поле КРАСНИТ
   тест, заставляя принять решение явно.

   ПЛАН берём из EPHistory.PLAN_FIELDS (единственный источник правды модуля). НАСТРОЙКИ и ВИД
   перечислены здесь — это ТО, что по решению владельца НЕ отменяется. projectSnapshot исполняется
   НАСТОЯЩИЙ (из app.js через общий стенд), на реальных дефолтах data.js. Запуск: node --test. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");
const EPHistory = require("../js/history.js");
const EPEstimate = require("../js/estimate.js");
const EPOfferOptions = require("../js/offerOptions.js");

function freshDefaults() {
  const win = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8"), { window: win });
  return JSON.parse(JSON.stringify(win.EP_DATA.settings));
}

/* НАСТРОЙКИ сделки/документа — не часть плана (отмена поста не трогает курс/скидку/реквизиты). */
const SETTINGS_FIELDS = ["terms", "docHeader", "offerOptions", "assemblyView"];
/* ВИД холста, режимы разметки и метаданные снимка — не отменяются. planVisibility («показана/бледная/
   скрыта») тоже здесь: переключение видимости отдельным шагом не является (решение владельца), поэтому
   она НЕ в PLAN_FIELDS и не в ключе сравнения; её значение восстанавливается только вместе со сменой
   подложки при откате «Убрать план» (см. applyPlanUnderlay). Сама подложка plan/planLabel (часть Б)
   переехала в ПЛАН. */
const VIEW_FIELDS = ["view", "planVisibility", "orthoMode", "snapGrid", "gridStep", "rotateTarget",
  "name", "savedAt"];

/* Состояние с непустыми полями плана — чтобы снимок заведомо содержал все ключи. */
function makeState() {
  return {
    devices: [{ id: "d1", x: 1, y: 2, roomId: null }],
    posts: [{ id: "p1", x: 3, y: 4, number: 1, roomId: null }],
    rooms: [{ id: "r1", name: "Кухня", polygon: [] }],
    walls: [{ id: "w1", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }],
    autoWalls: [], roomLines: [], roomFieldMemory: [], planVisibility: "show",
    planRotation: 0, worldAngle: 0, rotateTarget: "image",
    panX: 10, panY: 20, scale: 1.5, orthoMode: true, snapGrid: true, gridStep: 10,
    pxPerMeter: 50, scaleSegment: { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } },
    planLoaded: false, planLabel: ""
  };
}

function realSnapshotKeys() {
  const dom = stand.makeDom();
  const ctx = {
    $: dom.$, state: makeState(),
    EP_DATA: { settings: freshDefaults() },
    EPEstimate, EPOfferOptions,
    Date
  };
  const snap = stand.run("projectSnapshot", ctx)();
  return Object.keys(snap);
}

test("каждое поле projectSnapshot классифицировано ровно в одну группу (план/настройки/вид)", () => {
  const PLAN = EPHistory.PLAN_FIELDS;
  const all = [PLAN, SETTINGS_FIELDS, VIEW_FIELDS];

  /* 1) группы не пересекаются */
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++)
      for (const f of all[i])
        assert.ok(all[j].indexOf(f) < 0, `поле ${f} попало сразу в две группы`);

  const keys = realSnapshotKeys();
  const union = new Set([].concat(PLAN, SETTINGS_FIELDS, VIEW_FIELDS));

  /* 2) каждое поле снимка принадлежит ровно одной группе */
  for (const k of keys)
    assert.ok(union.has(k), `поле снимка "${k}" не классифицировано — реши: план (отменять), настройка или вид (не отменять), и добавь в EPHistory.PLAN_FIELDS либо в списки этого теста`);

  /* 3) в классификации нет лишних полей, которых снимок больше не возвращает (защита от протухания) */
  const keySet = new Set(keys);
  for (const f of union)
    assert.ok(keySet.has(f), `поле "${f}" классифицировано, но projectSnapshot его не возвращает — список устарел`);
});

test("PLAN_FIELDS совпадает с ожидаемым набором плана (ревью при изменении границы отмены)", () => {
  assert.deepEqual([...EPHistory.PLAN_FIELDS].sort(),
    ["autoWalls", "devices", "plan", "planLabel", "planRotation", "posts", "pxPerMeter",
      "roomFieldMemory", "roomLines", "rooms", "scaleSegment", "walls", "worldAngle"].sort());
});
