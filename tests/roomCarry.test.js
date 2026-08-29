/* Автотесты переноса пользовательских полей комнаты при пересчёте контуров (EPRoomCarry).
   Запуск без зависимостей и без сборщика:  node --test tests/

   ЗАЧЕМ ЭТИ ТЕСТЫ. Пересчёт помещений уничтожает все авто-комнаты и строит новые с новым id.
   carry() сопоставляет старые комнаты с новыми ПО ГЕОМЕТРИИ и говорит, какое введённое человеком
   имя/площадь на какую новую комнату перенести. Здесь фиксируется поведение, которое легко
   сломать незаметно: (а) авто-имена «Комната N»/«Помещение N» НЕ переносятся — иначе дубли
   нумерации; (б) совпадение двунаправленное + порог площади — иначе имя налипает на несвязанную
   комнату при полной перерисовке; (в) результат НЕ зависит от порядка входных массивов; (г)
   назначение один-к-одному. Все три критичных места проверены на фальсификацию (см. отчёт).

   ГЕОМЕТРИЯ ФИКСТУР. Комнаты — прямоугольники: rect(id,x0,y0,x1,y1). Центроид EPGeom — среднее
   вершин, для прямоугольника это его центр ((x0+x1)/2,(y0+y1)/2); площадь — w*h. Центры фикстур
   держим ВНУТРИ клеток (не на границе смежных прямоугольников), т.к. попадание точки на ребро у
   ray-casting неустойчиво, а нам важна сама логика сопоставления, а не поведение на границе. */
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../js/roomCarry.js");

/* Прямоугольная комната по двум углам. extra — пользовательские поля (name/area/autoPolygon). */
function rect(id, x0, y0, x1, y1, extra) {
  return Object.assign({
    id,
    polygon: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
  }, extra || {});
}

/* ---- 1. Имя переносится при совпадении контура ---- */
test("имя переносится, когда контур совпал", () => {
  const oldR = rect("old1", 0, 0, 100, 100, { name: "Кухня", autoPolygon: true });
  const newR = rect("new1", 0, 0, 100, 100, { name: "Комната 1", autoPolygon: true });
  assert.deepEqual(C.carry([oldR], [newR]), [{ toId: "new1", fromId: "old1", name: "Кухня", area: null }]);
});

/* ---- 2. Авто-имена НЕ переносятся (конфликт с нумерацией новых) ---- */
test("«Комната N» и «Помещение N» не переносятся", () => {
  const o1 = rect("o1", 0, 0, 100, 100, { name: "Комната 3", autoPolygon: true });
  const o2 = rect("o2", 0, 100, 100, 200, { name: "Помещение 7", autoPolygon: true });
  const n1 = rect("n1", 0, 0, 100, 100, { name: "Комната 1", autoPolygon: true });
  const n2 = rect("n2", 0, 100, 100, 200, { name: "Комната 2", autoPolygon: true });
  /* оба источника несут только авто-имя и без площади — переносить нечего, массив пуст */
  assert.deepEqual(C.carry([o1, o2], [n1, n2]), []);
});

/* Прямой контроль распознавания авто-имени (одна точка правды для правила). */
test("isAutoName: авто-формат распознаётся, ручные имена — нет", () => {
  assert.equal(C.isAutoName("Комната 3"), true);
  assert.equal(C.isAutoName("Помещение 7"), true);
  assert.equal(C.isAutoName("  Комната 12  "), true); // trim перед проверкой
  assert.equal(C.isAutoName("Кухня"), false);
  assert.equal(C.isAutoName("Комната"), false);       // без номера — уже ручное
  assert.equal(C.isAutoName("Комната 3 детская"), false);
});

/* ---- 3. Площадь: пустая не переносится, непустая переносится, trim работает ---- */
test("непустая площадь переносится с trim, при авто-имени имя остаётся null", () => {
  const oldR = rect("old1", 0, 0, 100, 100, { name: "Комната 5", area: "  18,6 м²  ", autoPolygon: true });
  const newR = rect("new1", 0, 0, 100, 100, { name: "Комната 1", autoPolygon: true });
  assert.deepEqual(C.carry([oldR], [newR]), [{ toId: "new1", fromId: "old1", name: null, area: "18,6 м²" }]);
});

test("пустая (пробельная) площадь не переносится", () => {
  const oldR = rect("old1", 0, 0, 100, 100, { name: "Комната 5", area: "   ", autoPolygon: true });
  const newR = rect("new1", 0, 0, 100, 100, { name: "Комната 1", autoPolygon: true });
  /* ни имени (авто), ни площади (пустая) — пары в выводе нет */
  assert.deepEqual(C.carry([oldR], [newR]), []);
});

test("имя и площадь переносятся вместе, когда оба заданы человеком", () => {
  const oldR = rect("old1", 0, 0, 100, 100, { name: "Кухня", area: "20", autoPolygon: true });
  const newR = rect("new1", 0, 0, 100, 100, { name: "Комната 1", autoPolygon: true });
  assert.deepEqual(C.carry([oldR], [newR]), [{ toId: "new1", fromId: "old1", name: "Кухня", area: "20" }]);
});

/* ---- 4. Независимость от порядка входа (обе перестановки) ---- */
test("результат не зависит от порядка старых и новых на входе", () => {
  const A = rect("A", 0, 0, 100, 100, { name: "Кухня", autoPolygon: true });
  const B = rect("B", 0, 100, 100, 200, { name: "Спальня", autoPolygon: true });
  const Na = rect("Na", 0, 0, 100, 100, { name: "Комната 1", autoPolygon: true });
  const Nb = rect("Nb", 0, 100, 100, 200, { name: "Комната 2", autoPolygon: true });

  const base = C.carry([A, B], [Na, Nb]);
  assert.equal(base.length, 2); // обе комнаты нашли пару — иначе тест бессмысленен
  /* модуль обещает ИДЕНТИЧНЫЙ результат (включая порядок) при любой перестановке входа */
  assert.deepEqual(C.carry([B, A], [Na, Nb]), base); // перевёрнуты старые
  assert.deepEqual(C.carry([A, B], [Nb, Na]), base); // перевёрнуты новые
  assert.deepEqual(C.carry([B, A], [Nb, Na]), base); // перевёрнуты оба
});

/* ---- 5. Один-к-одному: одна старая не отдаёт имя двум новым ---- */
test("одна старая комната отдаёт имя только одной новой (Set-страховка)", () => {
  /* Синтетика: две ПЕРЕКРЫВАЮЩИЕСЯ новые вокруг того же центра, обе проходят двунаправленное
     попадание и порог с общей старой — так проверяется именно жадное назначение с usedSrc,
     а не «естественная» неперекрываемость разбиения. Победитель — с большим ratio. */
  const oldR = rect("old1", 0, 0, 100, 100, { name: "Гостиная", autoPolygon: true });
  const nBig = rect("nBig", 10, 10, 90, 90, {});   // 80x80 = 6400, ratio 0.64
  const nSmall = rect("nSmall", 15, 15, 85, 85, {}); // 70x70 = 4900, ratio 0.49
  const res = C.carry([oldR], [nBig, nSmall]);
  assert.equal(res.length, 1);
  assert.equal(res[0].toId, "nBig"); // ближе по площади → берёт имя первым, вторая занята
  assert.equal(res[0].name, "Гостиная");
});

/* ---- 6. Разделение: одна старая → две новых ---- */
test("разделение: имя достаётся фрагменту, внутрь которого попал центроид старой", () => {
  /* Правило модуля (закреплено): при делении комнаты надвое имя получает тот фрагмент,
     где оказался центроид исходной; второй фрагмент останется со свежим авто-именем.
     Так выбрано осознанно — устойчиво и объяснимо, а не «первый по списку». */
  const oldR = rect("old1", 0, 0, 100, 100, { name: "Гостиная", autoPolygon: true }); // центр 50,50
  const left = rect("left", 0, 0, 60, 100, { name: "Комната 1", autoPolygon: true });  // центр 30,50 (в нём 50,50)
  const right = rect("right", 60, 0, 100, 100, { name: "Комната 2", autoPolygon: true }); // центр 80,50
  const res = C.carry([oldR], [left, right]);
  assert.equal(res.length, 1);
  assert.equal(res[0].toId, "left"); // центроид старой (50,50) лежит в левом фрагменте
  assert.equal(res[0].name, "Гостиная");
});

/* ---- 7. Слияние: две старых → одна новая ---- */
test("слияние: имя берётся у старой, внутрь которой попал центроид новой", () => {
  /* Правило модуля (закреплено): при слиянии двух комнат в одну имя наследует та старая,
     в которую попал центроид новой; имя второй старой теряется. */
  const oLeft = rect("oLeft", 0, 0, 60, 100, { name: "Кухня", autoPolygon: true });   // центр 30,50 (в нём центр новой 50,50)
  const oRight = rect("oRight", 60, 0, 100, 100, { name: "Столовая", autoPolygon: true }); // центр 80,50
  const newR = rect("new1", 0, 0, 100, 100, { name: "Комната 1", autoPolygon: true }); // центр 50,50
  const res = C.carry([oLeft, oRight], [newR]);
  assert.equal(res.length, 1);
  assert.equal(res[0].fromId, "oLeft");
  assert.equal(res[0].name, "Кухня");
});

/* ---- 8. Полностью изменившаяся планировка — ничего не переносится ---- */
test("центроиды не попадают друг в друга — переноса нет", () => {
  const oldR = rect("old1", 0, 0, 40, 40, { name: "Кухня", autoPolygon: true });   // центр 20,20
  const newR = rect("new1", 60, 60, 100, 100, { name: "Комната 1", autoPolygon: true }); // центр 80,80
  assert.deepEqual(C.carry([oldR], [newR]), []);
});

test("площади слишком разные (ниже AREA_RATIO_MIN) — переноса нет, даже если центроиды совпали", () => {
  /* Крошечная новая комната в центре большой старой: центроиды взаимно внутри, но
     100/10000 = 0.01 < 0.25 — порог не пускает имя на несвязанную область. */
  const oldR = rect("old1", 0, 0, 100, 100, { name: "Кухня", autoPolygon: true });
  const newR = rect("new1", 45, 45, 55, 55, { name: "Комната 1", autoPolygon: true }); // 10x10 = 100
  assert.deepEqual(C.carry([oldR], [newR]), []);
});

/* ---- 9. Комната без полигона (вручную созданная) не роняет функцию ---- */
test("комнаты без полигона (старая и новая) не ломают carry", () => {
  const oldNoPoly = { id: "ghost", name: "Призрак", area: "5", autoPolygon: true }; // как ручная из app.js:3316
  const oldGood = rect("old1", 0, 0, 100, 100, { name: "Кухня", autoPolygon: true });
  const newNoPoly = { id: "newGhost", name: "Новая комната", area: "" }; // без polygon
  const newGood = rect("new1", 0, 0, 100, 100, { name: "Комната 1" });
  let res;
  assert.doesNotThrow(() => { res = C.carry([oldNoPoly, oldGood], [newNoPoly, newGood]); });
  assert.deepEqual(res, [{ toId: "new1", fromId: "old1", name: "Кухня", area: null }]);
});

/* ---- 10. Ручная комната (autoPolygon===false) источником не бывает ---- */
test("старая с autoPolygon===false (ручной контур) не отдаёт поля — пересчёт её не трогает", () => {
  const oldManual = rect("old1", 0, 0, 100, 100, { name: "Кухня", autoPolygon: false });
  const newR = rect("new1", 0, 0, 100, 100, { name: "Комната 1", autoPolygon: true });
  assert.deepEqual(C.carry([oldManual], [newR]), []);
});
