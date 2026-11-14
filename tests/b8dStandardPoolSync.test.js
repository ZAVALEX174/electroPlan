/* Б8-д Д1: при выборе универсальной накладки сначала снимается прежний ручной стандарт,
   затем строится выпадающий список накладок. Исполняем настоящий renderBuilder до передачи
   списка в picker; каталог и фильтр продуктов — настоящие, HTML списка — наблюдаемый выход. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");
const EPCatalog = require("../js/catalog.js");
const EPPosts = require("../js/posts.js");
const EPPostStandard = require("../js/postStandard.js");

function framesFromCatalog() {
  const window = {};
  const context = vm.createContext({ window, structuredClone });
  for (const file of ["catalog-vimar.js", "catalog-vimar-attrs.js", "data.js"])
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", file), "utf8"), context);
  return window.EP_DATA.products.filter(p => p.kind === "frame" && p.active !== false);
}
const FRAMES = framesFromCatalog();
const byCode = code => FRAMES.find(p => p.code === code);
const BOTH = byCode("09661.01");
const IT = byCode("09671.01");
const DE = byCode("09664.01");
assert.equal(BOTH.standard, "BOTH");
assert.equal(IT.standard, "IT");
assert.equal(DE.standard, "DE");
assert.equal(BOTH.slotCount, IT.slotCount);

test("Б8-д Д1: BOTH 09661.01 снимает старый DE-выбор ДО построения списка, поэтому IT 09671.01 видна сразу", () => {
  const dom = stand.makeDom({ selects: ["postFrameSelect"] });
  dom.$("postSlotCount").value = String(BOTH.slotCount);
  dom.$("postFrameSelect").dataset.preferredFrameId = String(BOTH.id);
  const state = {
    rooms: [{ id: "r1", name: "Комната", standard: "IT", collection: "Neve Up", frameColor: "Белая" }],
    builder: { roomId: "r1", variantIndex: 0, standardChoice: "DE", verticalFrame: false, slots: [] }
  };
  const roomCriteria = { collection: "Neve Up", standard: "IT", frameColor: "Белая" };
  assert.equal(EPCatalog.productsForRoom(FRAMES, EPPostStandard.criteriaForChoice(roomCriteria, "DE")).some(f => f.id === IT.id), false,
    "контроль: старый DE-выбор действительно скрывает итальянскую накладку");
  assert.equal(EPCatalog.productsForRoom(FRAMES, roomCriteria).some(f => f.id === IT.id), true,
    "контроль: после сброса выбора IT-накладка есть в пуле комнаты");

  const orient = ["horizontal", "vertical"].map(o => stand.makeElement({ dataset: { orient: o } }));
  const standard = ["IT", "DE"].map(s => stand.makeElement({ dataset: { standard: s } }));
  const document = { querySelectorAll: sel => sel.startsWith("#postOrientMode") ? orient : standard };
  const halt = new Error("picker reached");
  const ctx = {
    state, document, $: dom.$, EPCatalog, EPPosts, EPPostStandard,
    byKind: kind => kind === "frame" ? FRAMES : [],
    frameProduct: id => FRAMES.find(f => Number(f.id) === Number(id)),
    frameSlotCount: EPCatalog.frameSlotCount,
    frameOptions: frames => frames.map(f => f.code).join("|"),
    builderRoomFilter: () => EPPostStandard.criteriaForChoice(roomCriteria, state.builder.standardChoice),
    frameFacingHintText: () => "", standardUnavailableText: () => "",
    EPRoomVariantsUi: { renderBuilderVariantSelect() {} },
    EPRoomVariants: {}, roomCatalogFilter: () => roomCriteria,
    esc: String, enhancePicker: () => { throw halt; }
  };
  const render = stand.run(["renderPostStandard", "collectionFramePool", "renderBuilder"], ctx);
  assert.throws(() => render(), error => error === halt, "сценарий дошёл до передачи готового списка в picker");
  assert.match(dom.$("postFrameSelect").innerHTML, /09671\.01/,
    "в том же кадре выпадающий список содержит IT 09671.01");
  assert.equal(state.builder.standardChoice, null, "универсальная накладка снимает старый ручной DE-выбор");
});
