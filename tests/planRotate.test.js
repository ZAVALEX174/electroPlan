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

/* Восстановление МИРОВЫХ координат точки из долей кадра документа. Кадр при разных углах
   РАЗНЫЙ (он расширяется под повёрнутый фон), поэтому сравнивать проценты напрямую нельзя —
   их надо вернуть в мир. L.image — неповёрнутый леттербокс-прямоугольник подложки (offX/offY/
   dispW/dispH в долях кадра); он однозначно восстанавливает frameW/H и левый-верхний угол кадра,
   после чего любую долю (бирку, вершину контура) переводим обратно в мировую точку. */
function recoverFrame(spec, L) {
  const disp = Math.min(spec.canvasW / spec.natW, spec.canvasH / spec.natH);
  const dispW = spec.natW * disp, dispH = spec.natH * disp;
  const offX = (spec.canvasW - dispW) / 2, offY = (spec.canvasH - dispH) / 2;
  const frameW = 100 * dispW / L.image.width, frameH = 100 * dispH / L.image.height;
  return { x0: offX - L.image.left * frameW / 100, y0: offY - L.image.top * frameH / 100, frameW, frameH };
}
const toWorld = (fr, left, top) => ({ x: fr.x0 + left * fr.frameW / 100, y: fr.y0 + top * fr.frameH / 100 });

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

test("cssTransform: 6-й аргумент fitAngle задаёт УГОЛ вписывания ОТДЕЛЬНО от угла поворота (контракт ч.2б)", () => {
  /* Прямой контракт ЧИСЛАМИ, а не через саму cssTransform: иначе мутация «игнорировать fitAngle»
     сдвинула бы и ожидание (тавтология). Повернуть на 90°, но вписывать по углу 0 → вписывать не
     надо, scale(1). МУТАЦИЯ (удалить ветку if(fitAngleDeg!==undefined)): fa останется 90, scale
     станет 0.72222 — assert краснеет. */
  assert.equal(R.cssTransform(90, 1200, 800, 900, 650, 0), "rotate(90deg) scale(1)",
    "fitAngle=0 → scale(1), хотя поворот 90° (мутация даёт scale(0.72222))");
  /* Документный случай: угол поворота 180° (planRotation+worldAngle), вписывание по planRotation=90°.
     fitScale(90)=650/900=0.72222, а fitScale(180)=1 — числа заведомо разные, мутация их спутает. */
  assert.equal(R.cssTransform(180, 1200, 800, 900, 650, 90), "rotate(180deg) scale(0.72222)",
    "scale по fitAngle=90° (0.72222), а не по углу поворота 180° (у которого fitScale=1)");
  /* Пятиаргументный вызов (холст): вписывание по углу поворота — поведение прежнее. */
  assert.equal(R.cssTransform(90, 1200, 800, 900, 650), "rotate(90deg) scale(0.72222)",
    "без 6-го аргумента scale берётся по углу поворота (холст: угол = вписывание)");
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

/* ---- 2b. Б3, ч.2а: угол МИРА и режим органов поворота в проекте ---- */

test("снимок пишет угол мира и режим; восстановление их возвращает; старый проект → 0/\"image\"", async () => {
  const s = makeSession();
  Object.assign(s.state, { devices: [], posts: [], rooms: [], walls: [], autoWalls: [], roomLines: [],
    roomFieldMemory: [], planRotation: 0, worldAngle: 93.5, rotateTarget: "world" });
  const snap = s.snapshot();
  assert.equal(snap.worldAngle, 93.5, "projectSnapshot кладёт угол мира");
  assert.equal(snap.rotateTarget, "world", "projectSnapshot кладёт режим органов поворота");

  s.store.value = snap;
  await s.restore();
  assert.equal(s.state.worldAngle, 93.5, "restoreProject поднимает угол мира");
  assert.equal(s.state.rotateTarget, "world", "restoreProject поднимает режим");

  /* старый проект без полей: угол мира 0, режим — поведение части 1 ("image") */
  s.store.value = { devices: [], posts: [], rooms: [] };
  await s.restore();
  assert.equal(s.state.worldAngle, 0, "старый проект без worldAngle → 0");
  assert.equal(s.state.rotateTarget, "image", "старый проект без rotateTarget → только чертёж");

  /* битый угол мира из ручной правки снимка сворачивается к 0; чужой режим → image */
  s.store.value = { worldAngle: "мусор", rotateTarget: "whatever" };
  await s.restore();
  assert.equal(s.state.worldAngle, 0, "нечисловой угол мира → 0 (не NaN)");
  assert.equal(s.state.rotateTarget, "image", "незнакомый режим → image");
});

test("угол МИРА не двигает нарисованное: снимок до/после смены worldAngle совпадает во всём, кроме угла", () => {
  const s = makeSession();
  const posts = [{ id: "p1", number: 1, x: 100, y: 120 }, { id: "p2", number: 2, x: 400, y: 300 }];
  const walls = [{ id: "w1", a: { x: 0, y: 0 }, b: { x: 500, y: 0 } }];
  const rooms = [{ id: "r1", name: "Кухня", polygon: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 400 }] }];
  Object.assign(s.state, { devices: [], posts, rooms, walls, autoWalls: [], roomLines: [], roomFieldMemory: [],
    planRotation: 0, worldAngle: 0, rotateTarget: "image" });

  const a = s.snapshot();
  s.state.worldAngle = 270;   /* меняем ТОЛЬКО угол мира — вид-подход, координаты неприкосновенны */
  const b = s.snapshot();

  delete a.savedAt; delete b.savedAt;
  assert.equal(a.worldAngle, 0);
  assert.equal(b.worldAngle, 270, "угол мира сменился");
  const stripA = Object.assign({}, a), stripB = Object.assign({}, b);
  delete stripA.worldAngle; delete stripB.worldAngle;
  /* МУТАЦИЯ: если бы угол мира пересчитывал координаты объектов — этот deepEqual покраснел бы.
     Это инвариант части 1 (tests/planRotate.test.js), распространённый на угол МИРА (§ решение оркестратора). */
  assert.deepEqual(stripB, stripA, "смена угла мира не изменила НИ ОДНОЙ координаты нарисованного");
});

/* ---- 3. Документ: фон повёрнут тем же углом, бирки/контуры на местах ---- */

test("planLabels: поворот ТОЛЬКО чертежа (planRotation) крутит фон, но НЕ двигает мировые координаты бирок/контуров", () => {
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

  /* ГЛАВНОЕ — восстановленный инвариант «разметка НЕ сдвигается» (прежний deepEqual по долям кадра
     устарел: кадр теперь честно расширяется под повёрнутый фон, доли при planRotation=90 другие).
     Поворот чертежа крутит ЛИШЬ фон (imageTransform), а мировые координаты бирок, вершин контура и
     якоря имени от planRotation НЕ зависят. Проверяем это, вернув мир из долей каждого кадра: при
     planRotation 0/90/37 восстановленный мир обязан совпасть с ИСХОДНЫМИ координатами входа.
     МУТАЦИЯ (разметка крутится вслед за чертежом: rot на worldAngle+planAngle, гейт
     if(worldAngle||planAngle)) уводит восстановленный мир прочь от входа → этот блок краснеет. */
  const meanX = (0 + 500 + 500) / 3, meanY = (0 + 0 + 400) / 3;   /* якорь имени = среднее вершин */
  [0, 90, 37].forEach(pr => {
    const L = pr === 0 ? L0 : PL.layout(Object.assign({}, base, { planRotation: pr }));
    const fr = recoverFrame(base, L);
    base.posts.forEach((p, i) => {
      const w = toWorld(fr, L.badges[i].left, L.badges[i].top);
      assert.ok(Math.abs(w.x - p.x) < 1e-6 && Math.abs(w.y - p.y) < 1e-6,
        `planRotation=${pr}: бирка ${p.number} в мире (${w.x.toFixed(2)},${w.y.toFixed(2)}) ≈ (${p.x},${p.y})`);
    });
    base.rooms[0].polygon.forEach((v, i) => {
      const w = toWorld(fr, L.rooms[0].polygon[i].left, L.rooms[0].polygon[i].top);
      assert.ok(Math.abs(w.x - v.x) < 1e-6 && Math.abs(w.y - v.y) < 1e-6,
        `planRotation=${pr}: вершина контура ${i} в мире не сдвинулась`);
    });
    const wl = toWorld(fr, L.rooms[0].label.left, L.rooms[0].label.top);
    assert.ok(Math.abs(wl.x - meanX) < 1e-6 && Math.abs(wl.y - meanY) < 1e-6,
      `planRotation=${pr}: якорь имени комнаты в мире не сдвинулся`);
  });

  /* §7.1: вращается ТОЛЬКО картинка — мировые координаты постов/контуров неизменны (это проверяет
     блок «угол мира не двигает нарисованное» и инвариант ч.1). НО в ДОЛЯХ кадра бирки/контуры теперь
     сдвигаются: кадр честно расширяется под повёрнутую картинку (починка дыры ч.1 — Б3 ч.2б). Прежний
     deepEqual «доли те же» был следствием той дыры: кадр не замечал поворота, и повёрнутая на 90°
     картинка вылезала за рамку блока. Теперь кадр включает 4 угла ПОВЁРНУТОЙ подложки — проверяем, что
     все четыре легли внутрь [0,100]% (картинка целиком в блоке). Кадр восстанавливаем из L.image
     (обратная к px/py), углы считаем от центра бокса тем же fitScale/углом, что применит CSS.
     МУТАЦИЯ: верни кадр к 2 неповёрнутым углам — нижний угол повёрнутой картинки уедет за 100%. */
  const disp = Math.min(900 / 1200, 650 / 800), dispW = 1200 * disp, dispH = 800 * disp;
  const offX = (900 - dispW) / 2, offY = (650 - dispH) / 2;
  const frameW = 100 * dispW / L90.image.width, frameH = 100 * dispH / L90.image.height;
  const x0 = offX - L90.image.left * frameW / 100, y0 = offY - L90.image.top * frameH / 100;
  const fscale = R.fitScale(90, 1200, 800, 900, 650), bcx = 450, bcy = 325;   /* центр бокса cw/2,ch/2 */
  const hw = dispW / 2 * fscale, hh = dispH / 2 * fscale;
  [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].forEach(([ox, oy]) => {
    const wx = bcx - oy, wy = bcy + ox;                     /* поворот на 90°: (ox,oy)→(−oy,ox) */
    const lx = 100 * (wx - x0) / frameW, ty = 100 * (wy - y0) / frameH;
    assert.ok(lx >= -1e-6 && lx <= 100 + 1e-6 && ty >= -1e-6 && ty <= 100 + 1e-6,
      `угол повёрнутой подложки внутри кадра: ${lx.toFixed(2)}% / ${ty.toFixed(2)}%`);
  });

  const html = PL.buildHtml(Object.assign({}, base, { planRotation: 90 }), { esc: String });
  assert.match(html, /transform:rotate\(90deg\) scale\([0-9.]+\);transform-origin:center/,
    "в HTML у <img> подложки стоит transform с центром вращения");
  const html0 = PL.buildHtml(base, { esc: String });
  assert.ok(!/transform:rotate/.test(html0), "без угла HTML документа не содержит transform (совместимость)");
});
