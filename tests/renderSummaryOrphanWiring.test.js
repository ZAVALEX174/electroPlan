/* ПОВЕДЕНЧЕСКИЙ регресс: renderSummary заводит строку «Вне помещений» в нижний статус плана.

   ЗАЧЕМ ЭТОТ ТЕСТ, ЕСЛИ ЕСТЬ orphanWarning.test.js. Тот исполняет orphanObjectsWarningText в
   отрыве и проверяет её ВЫХОД (текст, счётчик, денежную оговорку). Но он не стережёт ПРОВОДКУ:
   что renderSummary пишет этот выход именно в #outsideRoomsStatus, а группы света оставляет в
   #lightingSummary. Статус инструментов #status — третий независимый канал, его предупреждение
   также не должно затирать.

   КАК. app.js — монолит-оркестратор (DOM, state), в node не грузится. Вырезаем ИСХОДНЫЙ ТЕКСТ
   двух функций — renderSummary и настоящей orphanObjectsWarningText — и исполняем renderSummary в
   vm-контексте на DOM-шиме. Всё, что renderSummary дёргает по пути (projectLighting, buildEstimate,
   money, lightingHtml, updateStatus), — ЗАГЛУШКИ: их корректность стережётся своими тестами
   (estimate/lightingByRoom/...), здесь они не предмет. А вот orphanObjectsWarningText берётся
   НАСТОЯЩАЯ, вместе с настоящим EPRoomAssign, — значит счётчик в проверяемой строке реальный.

   МУТАЦИЯ → КРАСНЫЙ ТЕСТ:
     - вернуть предупреждение в #lightingSummary → «группы света не содержат предупреждение»;
     - удалить запись в #outsideRoomsStatus или сменить id → «нижний статус показывает счётчик»;
     - записать предупреждение в #status → «подсказка инструмента сохранена»;
     - удалить переключение hidden → «без сирот нижний статус скрыт»;
     - продублировать id в разметке или вернуть его в .right-panel → проверки размещения ниже.

   ЧЕГО НЕ ЛОВИТ (честно). Не проверяет смету, раскрой групп света и вёрстку lightingHtml — они
   заглушены. Проверяет проводку трёх экранных каналов и размещение целевого узла. Запуск:
   node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const stand = require("./helpers/appStand.js");

const EPRoomAssign = require("../js/roomAssign.js");

const INDEX = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

/* DOM-шим общего стенда: $ отдаёт (и запоминает) узел по id, у которого renderSummary трогает
   textContent/hidden/innerHTML. Реестр нужен, чтобы после прогона прочитать именно те id, в которые
   писал renderSummary — сменят id в app.js, и ожидаемый узел здесь останется пуст. */
function makeDom() {
  return stand.makeDom();
}

/* Заглушки-соседи renderSummary. money/lightingHtml дают узнаваемые маркеры, чтобы отличить
   «легли только группы света» от «легли группы + предупреждение». buildEstimate отдаёт нули с
   пустыми группами — форма важнее чисел, числа стережёт estimate.test.js. orphanObjectsWarningText
   берётся НАСТОЯЩАЯ (с настоящим EPRoomAssign) — счётчик в проверяемой строке реальный. */
function buildRenderSummary(dom, state) {
  return stand.run(["orphanObjectsWarningText", "renderSummary"], {
    state: state,
    EPRoomAssign: EPRoomAssign,
    $: dom.$,
    money: v => "money(" + v + ")",
    esc: s => String(s),
    projectLighting: () => ({}),
    buildEstimate: () => ({
      equipment: 0, materials: 0, work: 0, total: 0,
      discount: 0, discountPercent: 0, vat: 0, vatPercent: 0, groups: []
    }),
    lightingHtml: () => "[LIGHTING_HTML]",
    updateStatus: () => { dom.$("status").textContent = "[TOOL_STATUS]"; }
  });
}

const stateOf = (rooms, devices, posts) => ({ rooms: rooms, devices: devices, posts: posts });
const dev = roomId => ({ id: "d" + Math.random(), roomId: roomId });
const post = roomId => ({ id: "p" + Math.random(), roomId: roomId });

test("index.html: единственный #outsideRoomsStatus находится в видимом footer под планом, не в .right-panel", () => {
  assert.equal((INDEX.match(/id="outsideRoomsStatus"/g) || []).length, 1,
    "узел предупреждения должен быть ровно один — дублировать состояние нельзя");
  const statusAt = INDEX.indexOf('id="outsideRoomsStatus"');
  const footerAt = INDEX.lastIndexOf('<div class="canvas-footer">', statusAt);
  const mainEnd = INDEX.indexOf("</section>", statusAt);
  const rightPanelAt = INDEX.indexOf('class="sidebar right-panel"');
  assert.ok(footerAt >= 0 && footerAt < statusAt && statusAt < mainEnd && mainEnd < rightPanelAt,
    "#outsideRoomsStatus должен жить в .canvas-footer главной панели до скрываемой .right-panel");
});

test("renderSummary разводит группы света, предупреждение и подсказку инструмента по трём узлам", () => {
  const dom = makeDom();
  // комната есть, три объекта вне неё — orphanObjectsWarningText обязана вернуть непустую строку
  const state = stateOf([{ id: "R1" }], [dev(null), dev(null)], [post(null)]);
  const render = buildRenderSummary(dom, state);
  render();

  assert.equal(dom.els.lightingSummary.innerHTML, "[LIGHTING_HTML]",
    "в #lightingSummary остаются только группы света — второй копии предупреждения нет");
  assert.match(dom.els.outsideRoomsStatus.textContent, /Вне помещений:\s*3/,
    "нижний статус должен получить предупреждение с реальным счётчиком");
  assert.equal(dom.els.outsideRoomsStatus.hidden, false, "непустой статус должен быть видим");
  assert.equal(dom.els.status.textContent, "[TOOL_STATUS]",
    "обычная подсказка инструмента не должна быть затёрта предупреждением");
});

test("сирот нет → нижний статус очищен и скрыт, остальные два канала не затронуты", () => {
  const dom = makeDom();
  const state = stateOf([{ id: "R1" }], [dev("R1")], [post("R1")]);
  const render = buildRenderSummary(dom, state);
  render();

  assert.equal(dom.els.lightingSummary.innerHTML, "[LIGHTING_HTML]");
  assert.equal(dom.els.outsideRoomsStatus.textContent, "");
  assert.equal(dom.els.outsideRoomsStatus.hidden, true,
    "пустой нижний статус не должен оставлять оранжевую полосу");
  assert.equal(dom.els.status.textContent, "[TOOL_STATUS]");
});
