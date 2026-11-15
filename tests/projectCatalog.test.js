"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");
const Catalog = require("../js/projectCatalog.js");
const ProjectFile = require("../js/projectFile.js");
const EPEstimate = require("../js/estimate.js");
const EPPosts = require("../js/posts.js");
const EPOfferOptions = require("../js/offerOptions.js");
const PlanShrink = require("../js/planShrink.js");

test("К9: снимок сохраняет все поля товаров и не меняется после смены общего каталога", () => {
  const old = [
    { id: 1, code: "F-1", kind: "frame", price: 12.5, series: ["Arke"], imageUrl: "img/f.jpg" },
    { id: 2, code: "B-1", kind: "socket_box", price: 3.4, packQty: 10 }
  ];
  const packed = Catalog.pack(old);
  old[0].price = 99;
  old[0].series[0] = "Eikon";
  const restored = Catalog.unpack(JSON.parse(JSON.stringify(packed)));
  assert.equal(restored[0].price, 12.5);
  assert.equal(restored[1].packQty, 10);
  assert.deepEqual(restored[0].series, ["Arke"]);
  assert.equal(restored[0].imageUrl, "img/f.jpg");
  assert.throws(() => Catalog.unpack({ format: 1, keys: ["__proto__"], rows: [[0, {}]] }));
});

test("К9: файл проекта возвращает прежние цены после обновления общего каталога", async () => {
  const dom = stand.makeDom();
  const state = { baseProducts: [
    { id: 1, code: "M-1", kind: "mechanism", price: 10, packQty: 5 },
    { id: 2, code: "B-1", kind: "socket_box", price: 2 }
  ] };
  state.products = state.baseProducts;
  state.devices = [{ id: "d1", productId: 1 }];
  state.posts = []; state.rooms = []; state.walls = []; state.autoWalls = []; state.roomLines = [];
  state.roomFieldMemory = []; state.planLoaded = false;
  const store = { value: null };
  const ctx = {
    $: dom.$, state, EPProjectCatalog: Catalog,
    EP_DATA: { settings: { workPercent: 0, materialsPercent: 0, discountPercent: 0,
      vatPercent: 0, vatMode: "none", displayCurrency: "EUR" } },
    EPEstimate, EPPosts, EPOfferOptions,
    EPConfig: { gridSteps: [10], gridDefault: 10, viewMinScale: 0.1, viewMaxScale: 10 },
    EPViewport: { clampScale: s => s }, EPPlanRotate: require("../js/planRotate.js"),
    ProjectStore: { load: () => store.value },
    dropOrphanKeyGroups: () => {}, relabelContourRooms: () => {}, renderLightingSchemeSelect: () => {},
    renderProjectBacklight: () => {}, fillDocHeaderInputs: () => {}, syncOfferOptions: () => {},
    syncPackMultiple: () => {}, markCanvasUsed: () => {}, updatePlanUi: () => {}
  };
  vm.createContext(ctx);
  const api = vm.runInContext(stand.functionSource("restoreProject") + "\n" +
    stand.functionSource("projectSnapshot") + "\n;({restore:restoreProject,snapshot:projectSnapshot})", ctx);
  const before = api.snapshot();
  assert.equal(before.catalogSnapshot.rows.length, 2, "версия содержит и автоматически подбираемые товары");
  const file = ProjectFile.parse(JSON.stringify(ProjectFile.build(before, {}, [])));
  assert.equal(file.ok, true);
  store.value = file.project;
  state.baseProducts = [
    { id: 1, code: "M-1", kind: "mechanism", price: 99, packQty: 50 },
    { id: 2, code: "B-1", kind: "socket_box", price: 20 },
    { id: 3, code: "NEW", kind: "mechanism", price: 1 }
  ];
  await api.restore();
  assert.equal(state.products.length, 2);
  assert.equal(state.products[0].price, 10);
  assert.equal(state.products[1].price, 2);
  const est = EPEstimate.build({ devices: state.devices, posts: [],
    product: id => state.products.find(p => p.id === id), settings: ctx.EP_DATA.settings });
  assert.equal(est.equipment, 10);
  assert.deepEqual(JSON.parse(JSON.stringify(api.snapshot().catalogSnapshot)), before.catalogSnapshot);
});

test("К9: полный каталог и предельный чертёж оставляют запас localStorage", () => {
  const context = { window: {} };
  vm.createContext(context);
  for (const file of ["catalog-vimar.js", "catalog-vimar-attrs.js",
    "catalog-vimar-discontinued.js", "data.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", file), "utf8"), context);
  }
  const products = context.window.EP_DATA.products;
  const catalogSnapshot = Catalog.pack(products);
  assert.equal(Catalog.unpack(catalogSnapshot).length, products.length);
  const rawLength = JSON.stringify(products).length;
  const packedLength = JSON.stringify(catalogSnapshot).length;
  assert.ok(packedLength < rawLength, "упаковка действительно уменьшает каталог");
  const project = { devices: [{ id: "d1", productId: products[0].id }],
    catalogSnapshot, plan: "data:image/jpeg;base64," + "A".repeat(PlanShrink.PLAN_DATAURL_MAX_CHARS - 23),
    extraProjectData: "X".repeat(500000) };
  const size = JSON.stringify(project).length;
  assert.ok(size < 5000000, `сохранение ${size} символов должно оставить запас до квоты 5,2 млн`);
});
