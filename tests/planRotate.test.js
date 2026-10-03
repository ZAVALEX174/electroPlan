/* Поворот ПОДЛОЖКИ (Б3, часть 1). Проверяем ТРИ слоя:
   1) чистый расчёт EPPlanRotate (нормализация угла, шаг ±90, вписывающий scale, CSS);
   2) проводку в проекте — снимок/восстановление угла и что поворот НЕ трогает координаты объектов
      (снимок до/после поворота совпадает во всём, кроме угла);
   3) документ (planLabels): фон поворачивается ТЕМ ЖЕ углом, а бирки/контуры остаются на местах.
   Мутационные опоры отмечены в каждом блоке: сломай правило — покраснеет конкретный assert. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");
const R = require("../js/planRotate.js");
const PL = require("../js/planLabels.js");
const EPEstimate = require("../js/estimate.js");
const EPPosts = require("../js/posts.js");
const EPOfferOptions = require("../js/offerOptions.js");

/* ---- 1. Чистый расчёт ---- */

test("normalizeAngle: нормализует к [0,360), запятую читает, мусор отвергает (null — а не 0)", () => {
  assert.equal(R.normalizeAngle(-90), 270, "−90 → 270 (двойной модуль, без отрицательных)");
  assert.equal(R.normalizeAngle(450), 90, "450 → 90");
  assert.equal(R.normalizeAngle(360), 0, "360 → 0");
  assert.equal(R.normalizeAngle("3,5"), 3.5, "запятая-разделитель → точка");
  assert.equal(R.normalizeAngle("  12 "), 12, "пробелы по краям отбрасываются");
  /* МУТАЦИЯ: верни тут 0 вместо null — вызывающий молча сбросит угол, этот блок покраснеет. */
  assert.equal(R.normalizeAngle("abc"), null, "мусор → null (не 0)");
  assert.equal(R.normalizeAngle("90deg"), null, "«90deg» не число → null");
  assert.equal(R.normalizeAngle(""), null, "пустая строка → null");
  assert.equal(R.normalizeAngle(null), null, "null → null");
  assert.equal(R.normalizeAngle(true), null, "boolean → null (Number(true)=1 не должен пролезть)");
  assert.equal(R.normalizeAngle(NaN), null, "NaN → null");
});

test("step: ±90 от ТЕКУЩЕГО угла, с нормализацией; битый текущий считается 0", () => {
  assert.equal(R.step(3.5, 90), 93.5, "↻ от дробного угла");
  assert.equal(R.step(3.5, -90), 273.5, "↺ от дробного угла (−86.5 → 273.5)");
  assert.equal(R.step(270, 90), 0, "270 +90 → 0 (через нормализацию)");
  assert.equal(R.step(0, -90), 270, "0 −90 → 270");
  assert.equal(R.step(null, 90), 90, "битый текущий угол → 0, +90 = 90");
});

test("fitScale: 0° не уменьшает; 90°/270° вписывают неквадратную подложку в бокс; квадрат при 90° = 1", () => {
  // пейзаж 1200×800 в боксе 900×650: object-fit disp=0.75 → dispW=900, dispH=600
  assert.equal(R.fitScale(0, 1200, 800, 900, 650), 1, "без поворота подложка не ужимается");
  const s90 = R.fitScale(90, 1200, 800, 900, 650);
  // на 90° повёрнутый габарит = 600(ш)×900(в); чтобы 900 влезло в высоту 650 → 650/900
  assert.ok(Math.abs(s90 - 650 / 900) < 1e-9, "90°: ужимаем так, чтобы высота 900 вошла в бокс 650");
  assert.ok(Math.abs(R.fitScale(270, 1200, 800, 900, 650) - s90) < 1e-9, "270° симметрично 90°");
  /* МУТАЦИЯ: убери множитель sin в габарите — для квадрата при 90° scale перестанет быть 1. */
  assert.equal(R.fitScale(90, 800, 800, 650, 650), 1, "квадрат в квадратном боксе при 90° не ужимается");
  assert.equal(R.fitScale(90, 0, 0, 900, 650), 1, "нет размеров подложки → 1 (не делим на ноль)");
  const s3 = R.fitScale(3.5, 1200, 800, 900, 650);
  assert.ok(s3 > 0 && s3 < 1, "малый угол чуть ужимает (угол подложки не обрезается)");
});

test("cssTransform: нет поворота → пустая строка (старый КП байт-в-байт); иначе rotate+scale", () => {
  assert.equal(R.cssTransform(0, 1200, 800, 900, 650), "", "0° и scale 1 → transform не ставим");
  assert.equal(R.cssTransform(undefined, 1200, 800, 900, 650), "", "битый угол → пусто (не трогаем фон)");
  assert.match(R.cssTransform(90, 1200, 800, 900, 650), /^rotate\(90deg\) scale\(0\.72222\)$/, "90°: rotate+вписывающий scale");
  assert.match(R.cssTransform(3.5, 1200, 800, 900, 650), /^rotate\(3\.5deg\) scale\(0\./, "дробный угол сохраняется в CSS");
});

test("formatAngle: число с запятой для поля ввода", () => {
  assert.equal(R.formatAngle(270), "270");
  assert.equal(R.formatAngle(3.5), "3,5");
  assert.equal(R.formatAngle(-90), "270", "нормализует перед печатью");
});

/* ---- 2. Проводка в проекте: снимок/восстановление и неизменность координат ---- */

/* «Сеанс браузера»: общий контекст для НАСТОЯЩИХ restoreProject/projectSnapshot из app.js —
   та же сборка, что в vatMigrationChain/roomFieldMemoryRoundTrip. Соседи заглушены — предмет
   здесь только угол подложки и то, что он не задевает нарисованное. */
function makeSession() {
  const dom = stand.makeDom();
  const state = {};
  const store = { value: null };
  const ctx = {
    $: dom.$, esc: String, state,
    EP_DATA: { settings: {} },
    EPEstimate, EPPosts, EPOfferOptions, EPPlanRotate: R,
    EPConfig: { gridSteps: [10], gridDefault: 10, viewMinScale: 0.1, viewMaxScale: 10 },
    EPViewport: { clampScale: s => s },
    ProjectStore: { load: () => store.value },
    relabelContourRooms: () => {}, dropOrphanKeyGroups: () => {},
    renderLightingSchemeSelect: () => {}, renderProjectWallTypeSelect: () => {}, renderProjectBacklight: () => {},
    fillDocHeaderInputs: () => {}, syncOfferOptions: () => {}, markCanvasUsed: () => {}
  };
  const src = stand.functionSource("restoreProject") + "\n" + stand.functionSource("projectSnapshot")
    + "\n;({ restore: restoreProject, snapshot: projectSnapshot });";
  vm.createContext(ctx);
  const api = vm.runInContext(src, ctx);
  return { ctx, state, store, restore: api.restore, snapshot: api.snapshot };
}

test("снимок пишет угол, восстановление его возвращает; старый проект без поля → 0", async () => {
  const s = makeSession();
  Object.assign(s.state, { devices: [], posts: [], rooms: [], walls: [], autoWalls: [], roomLines: [], roomFieldMemory: [], planRotation: 93.5 });
  const snap = s.snapshot();
  assert.equal(snap.planRotation, 93.5, "projectSnapshot кладёт угол в проект");

  s.store.value = snap;
  await s.restore();
  assert.equal(s.state.planRotation, 93.5, "restoreProject поднимает сохранённый угол");

  /* обратная совместимость: проект, сохранённый ДО этой правки, поля не несёт */
  s.store.value = { devices: [], posts: [], rooms: [] };
  await s.restore();
  assert.equal(s.state.planRotation, 0, "старый проект без planRotation открывается без поворота (0, не NaN/undefined)");

  /* битое значение из ручной правки снимка не должно просочиться */
  s.store.value = { planRotation: "мусор" };
  await s.restore();
  assert.equal(s.state.planRotation, 0, "нечисловой угол из снимка сворачивается к 0");
});

test("поворот НЕ двигает нарисованное: снимок до/после смены угла совпадает во всём, кроме угла", () => {
  const s = makeSession();
  const posts = [{ id: "p1", number: 1, x: 100, y: 120 }, { id: "p2", number: 2, x: 400, y: 300 }];
  const walls = [{ id: "w1", a: { x: 0, y: 0 }, b: { x: 500, y: 0 } }];
  const rooms = [{ id: "r1", name: "Кухня", polygon: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 400 }] }];
  const roomLines = [{ id: "l1", a: { x: 0, y: 0 }, b: { x: 500, y: 0 } }];
  Object.assign(s.state, { devices: [], posts, rooms, walls, autoWalls: [], roomLines, roomFieldMemory: [],
    pxPerMeter: 50, scaleSegment: { a: { x: 0, y: 0 }, b: { x: 50, y: 0 } }, planRotation: 0 });

  const a = s.snapshot();
  s.state.planRotation = 270;          /* только угол */
  const b = s.snapshot();

  /* savedAt — метка времени, у двух вызовов различается законно; угол должен различаться; всё
     остальное обязано совпасть побайтно (координаты постов/стен/комнат/разметки/масштаба). */
  delete a.savedAt; delete b.savedAt;
  assert.equal(a.planRotation, 0);
  assert.equal(b.planRotation, 270, "угол сменился");
  const stripA = Object.assign({}, a); const stripB = Object.assign({}, b);
  delete stripA.planRotation; delete stripB.planRotation;
  /* МУТАЦИЯ: если бы поворот пересчитывал координаты объектов — этот deepEqual покраснел бы. */
  assert.deepEqual(stripB, stripA, "смена угла не изменила НИ ОДНОЙ координаты нарисованного");
});

/* ---- 3. Документ: фон повёрнут тем же углом, бирки/контуры на местах ---- */

test("planLabels: подложка в документе поворачивается тем же EPPlanRotate; бирки и контуры НЕ сдвигаются", () => {
  const base = {
    imageUrl: "data:image/png;base64,AAAA", natW: 1200, natH: 800, canvasW: 900, canvasH: 650,
    posts: [{ number: 1, x: 100, y: 120 }, { number: 2, x: 400, y: 300 }],
    rooms: [{ name: "Кухня", polygon: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 400 }] }]
  };
  const L0 = PL.layout(base);
  const L90 = PL.layout(Object.assign({}, base, { planRotation: 90 }));

  assert.equal(L0.imageTransform, "", "без угла — фон без трансформации (старый КП не меняется)");
  assert.equal(L90.imageTransform, R.cssTransform(90, 1200, 800, 900, 650),
    "фон документа поворачивается ТЕМ ЖЕ расчётом, что холст (§7.1 — одна функция)");

  /* §7.1: вращается ТОЛЬКО картинка. Бирки постов и контуры помещений — те же координаты. */
  assert.deepEqual(L90.badges, L0.badges, "бирки постов не сдвинулись при повороте фона");
  assert.deepEqual(L90.rooms, L0.rooms, "контуры/подписи помещений не сдвинулись");
  assert.deepEqual(L90.image, L0.image, "прямоугольник подложки тот же — крутит его transform, а не раскладка");

  const html = PL.buildHtml(Object.assign({}, base, { planRotation: 90 }), { esc: String });
  assert.match(html, /transform:rotate\(90deg\) scale\([0-9.]+\);transform-origin:center/,
    "в HTML у <img> подложки стоит transform с центром вращения");
  const html0 = PL.buildHtml(base, { esc: String });
  assert.ok(!/transform:rotate/.test(html0), "без угла HTML документа не содержит transform (совместимость)");
});
