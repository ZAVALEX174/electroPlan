/* Поворот ВСЕГО плана в печатном документе (Б3, ч.2б).
   На холсте worldAngle вращает весь вид #canvas; документ (КП и лист монтажника идут одним путём —
   planBlockHtml) обязан вывести план повёрнутым ТАК ЖЕ: угол мира запекается в координаты ВСЕХ
   мировых точек ДО расчёта кадра (EPPlanLabels.layout), а метки (номера, имена) остаются прямыми.
   Проверяем числами из layout(), браузер не поднимаем. Мутационные опоры отмечены у каждого блока. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { layout, buildHtml } = require("../js/planLabels.js");
const R = require("../js/planRotate.js");

/* Ожидаемые ЭКРАННЫЕ координаты точки при повороте вида на angle° — НЕЗАВИСИМАЯ формула (плейн-
   математика по документации EPViewport.worldToScreen: x'=x·cos−y·sin, y'=x·sin+y·cos). Намеренно НЕ
   через EPViewport.rotatePoint: layout крутит точки именно им, и общая функция замаскировала бы
   мутацию знака (ожидание сдвинулось бы вместе с фактом). Центр на ПОРЯДОК не влияет — берём (0,0). */
function screenPt(p, angle) {
  const r = angle * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/* Неквадратная подложка в неквадратном боксе — на ней поворот ВИДЕН (при квадрате 90° неотличимы). */
const PLAN = "data:image/png;base64,AAAA";
const base = extra => Object.assign({
  imageUrl: PLAN, natW: 1200, natH: 800, canvasW: 900, canvasH: 650,
  posts: [{ number: 1, x: 0, y: 0 }, { number: 2, x: 200, y: 0 }, { number: 3, x: 0, y: 200 }],
  rooms: [{ name: "Кухня", polygon: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }] }]
}, extra);

const sign = v => (v > 1e-9 ? 1 : v < -1e-9 ? -1 : 0);

/* --- 1. Угол 0 (и отсутствие поля) — вывод БАЙТ-В-БАЙТ как прежде: старые КП не меняются --- */

test("worldAngle=0 и отсутствие поля дают тот же layout/HTML, что было (совместимость)", () => {
  const noField = base();                 /* как старый spec — поля worldAngle нет вовсе */
  const zero = base({ worldAngle: 0 });
  assert.equal(JSON.stringify(layout(zero)), JSON.stringify(layout(noField)),
    "worldAngle:0 не меняет layout по сравнению с отсутствием поля");
  assert.equal(buildHtml(zero, { esc: String }), buildHtml(noField, { esc: String }),
    "и HTML документа совпадает байт-в-байт");
  /* и при planRotation=0 вместе с worldAngle=0 фон без всякой трансформации — как на HEAD */
  assert.equal(layout(base({ worldAngle: 0, planRotation: 0 })).imageTransform, "",
    "оба угла нулевые → transform пустой (старый КП не меняется)");
});

/* --- 2. Посты/контуры ПОВОРАЧИВАЮТСЯ: что правее на экране — правее и в документе --- */

/* Доля кадра монотонно растёт с повёрнутой координатой, а экран использует тот же поворот
   (worldToScreen тем же знаком, что rotatePoint). Значит порядок бирок по left/top в документе обязан
   совпасть с порядком постов по экранным X/Y. Проверяем для 90°/37°/270°.
   МУТАЦИИ, которые краснят этот блок:
     • spec/ layout не передаёт worldAngle → доли считаются по неповёрнутым координатам, порядок иной;
     • знак угла в повороте точки перевёрнут → порядок по одной из осей переворачивается. */
[90, 37, 270].forEach(angle => {
  test(`worldAngle=${angle}: порядок бирок в документе = порядок постов на экране (повёрнутом)`, () => {
    const spec = base({ worldAngle: angle });
    const L = layout(spec);
    const P = spec.posts;
    const scr = P.map(p => screenPt(p, angle));
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      assert.equal(sign(L.badges[i].left - L.badges[j].left), sign(scr[i].x - scr[j].x),
        `бирка ${P[i].number} и ${P[j].number}: кто правее на экране, тот правее в документе`);
      assert.equal(sign(L.badges[i].top - L.badges[j].top), sign(scr[i].y - scr[j].y),
        `бирка ${P[i].number} и ${P[j].number}: кто ниже на экране, тот ниже в документе`);
    }
    /* контур комнаты тоже повёрнут: его вершины следуют тому же повороту (сравниваем порядок первой
       и третьей вершин по left) — мутация «не поворачивать контуры» разошлась бы с биркой того же угла. */
    const poly = spec.rooms[0].polygon;
    const rp = poly.map(v => screenPt(v, angle));
    assert.equal(sign(L.rooms[0].polygon[0].left - L.rooms[0].polygon[2].left), sign(rp[0].x - rp[2].x),
      "вершины контура повёрнуты тем же углом, что бирки");
  });
});

/* --- 3. Метки ПРЯМЫЕ: номера, имена, подписи групп не вращаются вместе с планом --- */

test("worldAngle=90: единственный rotate( в HTML — у подложки; бирки и имена прямые", () => {
  const html = buildHtml(base({ worldAngle: 90,
    posts: [{ number: 1, x: 0, y: 0, groups: [{ key: "k", label: "Свет" }] }, { number: 2, x: 200, y: 200, groups: [{ key: "k", label: "Свет" }] }]
  }), { esc: String });
  const rotates = html.match(/rotate\(/g) || [];
  assert.equal(rotates.length, 1, "повёрнут ТОЛЬКО фон-подложка; номера/имена/подписи групп прямые");
  assert.match(html, /<img[^>]*transform:rotate\(/, "этот единственный rotate — у тега <img> подложки");
});

/* --- 4. Кадр включает 4 угла ПОВЁРНУТОЙ подложки: она не вылезает за рамку блока --- */

/* Восстанавливаем кадр из L.image (обратная к px/py) и считаем 4 угла ОТОБРАЖАЕМОЙ подложки
   (fitScale по planRotation, поворот на сумму углов вокруг центра бокса). Все обязаны лечь в
   [0,100]%. МУТАЦИЯ «кадр из 2 неповёрнутых углов» уводит угол за границу — тест краснеет. */
function displayedCornersPct(spec, L) {
  const natW = spec.natW, natH = spec.natH, cw = spec.canvasW, ch = spec.canvasH;
  const disp = Math.min(cw / natW, ch / natH), dispW = natW * disp, dispH = natH * disp;
  const offX = (cw - dispW) / 2, offY = (ch - dispH) / 2;
  const frameW = 100 * dispW / L.image.width, frameH = 100 * dispH / L.image.height;
  const x0 = offX - L.image.left * frameW / 100, y0 = offY - L.image.top * frameH / 100;
  const planAngle = R.normalizeAngle(spec.planRotation) || 0;
  const worldAngle = Number(spec.worldAngle) || 0;
  const fscale = R.fitScale(planAngle, natW, natH, cw, ch);
  const total = (planAngle + worldAngle) * Math.PI / 180, cs = Math.cos(total), sn = Math.sin(total);
  const hw = dispW / 2 * fscale, hh = dispH / 2 * fscale, bcx = cw / 2, bcy = ch / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([ox, oy]) => ({
    left: 100 * (bcx + ox * cs - oy * sn - x0) / frameW,
    top: 100 * (bcy + ox * sn + oy * cs - y0) / frameH
  }));
}

[90, 37, 270].forEach(angle => {
  test(`worldAngle=${angle}: повёрнутая подложка целиком внутри кадра блока`, () => {
    const spec = base({ worldAngle: angle });
    displayedCornersPct(spec, layout(spec)).forEach((c, i) =>
      assert.ok(c.left >= -1e-6 && c.left <= 100 + 1e-6 && c.top >= -1e-6 && c.top <= 100 + 1e-6,
        `угол подложки #${i} в кадре: ${c.left.toFixed(2)}% / ${c.top.toFixed(2)}%`));
  });
});

/* --- 5. Сочетание: поворот чертежа (planRotation) И поворот всего плана (worldAngle) --- */

test("planRotation=90 + worldAngle=90: фон крутится на сумму (180°), вписан по planRotation", () => {
  const spec = base({ planRotation: 90, worldAngle: 90 });
  const L = layout(spec);
  /* сумма углов, а УМЕНЬШЕНИЕ под бокс — только по planRotation (worldAngle крутит весь вид, кадр сам
     расширяется). МУТАЦИЯ «картинка без worldAngle» → остался бы rotate(90deg), а не 180. */
  assert.equal(L.imageTransform, R.cssTransform(180, spec.natW, spec.natH, spec.canvasW, spec.canvasH, 90),
    "transform = rotate(180deg) scale(fitScale(90)) — сумма углов, вписывание по чертежу");
  assert.match(L.imageTransform, /^rotate\(180deg\) scale\(/, "итоговый угол подложки — 180°");
  /* и повёрнутая подложка по-прежнему в кадре */
  displayedCornersPct(spec, L).forEach((c, i) =>
    assert.ok(c.left >= -1e-6 && c.left <= 100 + 1e-6 && c.top >= -1e-6 && c.top <= 100 + 1e-6,
      `угол подложки #${i} в кадре при сочетании углов: ${c.left.toFixed(2)}% / ${c.top.toFixed(2)}%`));
});

/* --- 6. Без подложки угол мира всё равно вращает разметку (контуры/бирки) --- */

test("worldAngle=90 без подложки: контуры и бирки повёрнуты (кадр по точкам, центр 0,0)", () => {
  const spec = { worldAngle: 90,
    posts: [{ number: 1, x: 0, y: 0 }, { number: 2, x: 200, y: 0 }],
    rooms: [{ name: "Зал", polygon: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }] }] };
  const L = layout(spec);
  assert.equal(L.image, null, "подложки нет");
  const s0 = screenPt(spec.posts[0], 90), s1 = screenPt(spec.posts[1], 90);
  assert.equal(sign(L.badges[0].top - L.badges[1].top), sign(s0.y - s1.y),
    "без подложки посты всё равно повёрнуты (угол 90 меняет их порядок по вертикали)");
});
