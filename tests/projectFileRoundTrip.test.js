/* ПОВЕДЕНЧЕСКИЙ круговой тест «проект в файл» на НАСТОЯЩИХ restoreProject/projectSnapshot (исходный
   текст app.js исполняется в vm, стенд appStand) вместе с чистым EPProjectFile.build/parse.

   ЗАЧЕМ. Формат файла и слияния покрыты в tests/projectFile.test.js, но ГЛАВНОЕ требование владельца —
   «открыть файл, и проект выглядит точно так же, с планом, постами и ценами» — держится на связке
   projectSnapshot → файл → restoreProject → projectSnapshot. Текстовый матч её не стережёт. Здесь
   проверяем поведенчески: снимок с постами, комнатами, планом (data-URL), terms → обёртка файла →
   JSON туда-обратно → открыть (restore) → снимок ТОТ ЖЕ (кроме savedAt — он у каждого снимка новый).

   ГЛАВНЫЙ КРАЙ (разведка): в ProjectStore при переполнении лежит plan:null, а файл обязан нести план.
   Отдельный тест: ProjectStore отдаёт plan:null, но projectSnapshot() (живой, planImage.src задан) даёт
   план, и build(snapshot()) кладёт его в файл.

   МУТАЦИОННАЯ ТАБЛИЦА:
     projectSnapshot: plan:(…)?img.src:null → plan:null всегда → краснеет «план в файле» и «круговой с планом»;
     restoreProject: убрать установку img.src=p.plan → краснеет «круговой с планом» (план не вернулся);
     build: project:snapshot → project:{…без plan} → краснеет «файл несёт план при plan:null в сторе».
   Запуск: node --test tests/projectFileRoundTrip.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");
const EPProjectFile = require("../js/projectFile.js");
const EPEstimate = require("../js/estimate.js");
const EPPosts = require("../js/posts.js");
const EPOfferOptions = require("../js/offerOptions.js");

const PLAN_DATA_URL = "data:image/png;base64,AAAACCCCDDDDEEEE";

/* Дефолты data.js, как их видит браузер при загрузке (свежие на каждое «открытие» страницы). */
function freshDefaults() {
  const win = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8"), { window: win });
  return JSON.parse(JSON.stringify(win.EP_DATA.settings));
}

/* planImage-шим: присвоение .src СИНХРОННО зовёт onload и задаёт naturalWidth>0 — как браузер грузит
   data-URL. Без него Promise в restoreProject (ждёт onload) не разрешился бы, и тест завис. */
function makePlanImage() {
  const node = { _src: "", naturalWidth: 0, onload: null, onerror: null };
  Object.defineProperty(node, "src", {
    get() { return node._src; },
    set(v) { node._src = v; node.naturalWidth = v ? 24 : 0; if (node.onload) node.onload(); }
  });
  return node;
}

/* Один «сеанс браузера»: общий vm-контекст для restoreProject и projectSnapshot (делят state/EP_DATA).
   Соседи, не относящиеся к кругу (рендер панелей), заглушены. Та же сборка, что в roomFieldMemoryRoundTrip. */
function makeSession() {
  const dom = stand.makeDom();
  dom.els.planImage = makePlanImage();   // спец-узел подложки до первого $("planImage")
  const state = {};
  const store = { value: null };
  const ctx = {
    $: dom.$, esc: String, state,
    EP_DATA: { settings: freshDefaults() },
    EPEstimate, EPPosts, EPOfferOptions,
    EPConfig: { gridSteps: [10], gridDefault: 10, viewMinScale: 0.1, viewMaxScale: 10 },
    EPViewport: { clampScale: s => Math.max(0.1, Math.min(10, s)) },
    EPPlanRotate: require("../js/planRotate.js"),
    ProjectStore: { load: () => store.value },
    dropOrphanKeyGroups: () => {}, relabelContourRooms: () => {}, renderLightingSchemeSelect: () => {},
    renderProjectWallTypeSelect: () => {}, renderProjectBacklight: () => {},
    fillDocHeaderInputs: () => {}, syncOfferOptions: () => {}, markCanvasUsed: () => {},
    updatePlanUi: () => {}
  };
  const src = stand.functionSource("restoreProject")
    + "\n" + stand.functionSource("projectSnapshot")
    + "\n;({ restore: restoreProject, snapshot: projectSnapshot });";
  vm.createContext(ctx);
  const api = vm.runInContext(src, ctx);
  return { ctx, dom, store, state, restore: api.restore, snapshot: api.snapshot,
    resetDefaults: () => { ctx.EP_DATA.settings = freshDefaults(); } };
}

/* Проект-образец, как он лежит в ProjectStore: посты, комната, план-data-URL, вид, terms. */
function sampleProject() {
  return {
    name: "Проект электроснабжения", savedAt: "2026-10-19T08:00:00.000Z",
    devices: [], posts: [{ id: "p1", number: 1, wall: "solid" }, { id: "p2", number: 2, wall: "solid" }],
    rooms: [{ id: "r1", name: "Кухня", polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }] }],
    walls: [], autoWalls: [], roomLines: [], roomFieldMemory: [],
    planVisibility: "show", planRotation: 0, worldAngle: 0, rotateTarget: "image",
    plan: PLAN_DATA_URL, planLabel: "1 этаж",
    view: { panX: 12, panY: 34, scale: 1.25 },
    orthoMode: true, snapGrid: true, gridStep: 10, pxPerMeter: 50, scaleSegment: null,
    docHeader: { project: "Коттедж", number: "EPG-2026-0007", date: "2026-10-19" },
    terms: { workPercent: 18, materialsPercent: 7, discountPercent: 0, vatPercent: 20, vatMode: "none",
      rateSurchargePercent: 3, displayCurrency: "RUB", eurRate: 92.5, rateDate: "2026-10-19", rateSource: "вручную" }
  };
}

function stripSavedAt(snap) { const s = JSON.parse(JSON.stringify(snap)); delete s.savedAt; return s; }

test("круговой путь: снимок → файл → открыть → projectSnapshot тот же (с планом, постами, видом, terms)", async () => {
  const s = makeSession();
  // открыли проект-образец → снимок №1
  s.store.value = sampleProject();
  await s.restore();
  const snap1 = s.snapshot();
  assert.equal(snap1.plan, PLAN_DATA_URL, "предусловие: снимок №1 несёт план");
  assert.equal(snap1.posts.length, 2, "предусловие: два поста");

  // снимок → файл → JSON туда-обратно → разбор
  const wrapper = EPProjectFile.build(snap1, { companyLogo: "data:logo" }, [{ id: "t1" }]);
  const parsed = EPProjectFile.parse(JSON.stringify(wrapper));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.project.plan, PLAN_DATA_URL, "файл несёт план");

  // «перезагрузка» + открытие файла тем же путём, что EPProjectFile.openParsed: положить в стор → restore
  s.resetDefaults();
  s.store.value = parsed.project;
  await s.restore();
  const snap2 = s.snapshot();

  assert.deepEqual(stripSavedAt(snap2), stripSavedAt(snap1),
    "открытый из файла проект даёт ТОТ ЖЕ снимок (кроме savedAt) — план, посты, комнаты, вид, terms совпали");
  assert.equal(snap2.plan, PLAN_DATA_URL, "план на месте после открытия");
});

test("главный край: в ProjectStore plan:null (переполнение), но файл собран из живого снимка — с планом", async () => {
  const s = makeSession();
  s.store.value = sampleProject();
  await s.restore();                       // планы загружен в planImage, state.planLoaded=true
  // имитируем переполнение localStorage: в сторе лежит версия без плана (persistProject → plan:null)
  s.store.value = Object.assign({}, sampleProject(), { plan: null, planTooBig: true });
  // но файл собирается из projectSnapshot() (живой), а не из ProjectStore
  const live = s.snapshot();
  assert.equal(live.plan, PLAN_DATA_URL, "живой снимок несёт план, несмотря на plan:null в сторе");
  const wrapper = EPProjectFile.build(live, {}, []);
  assert.equal(wrapper.project.plan, PLAN_DATA_URL, "файл всё равно содержит план (главный край разведки)");
});
