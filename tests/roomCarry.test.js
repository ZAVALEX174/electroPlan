/* Автотесты переноса пользовательских полей комнаты при пересчёте контуров (EPRoomCarry).
   Запуск без зависимостей и без сборщика:  node --test tests/

   ЗАЧЕМ ЭТИ ТЕСТЫ. Пересчёт помещений уничтожает все авто-комнаты и строит новые с новым id.
   carry() сопоставляет старые комнаты с новыми ПО ГЕОМЕТРИИ и говорит, какое введённое человеком
   имя/площадь на какую новую комнату перенести. Здесь фиксируется поведение, которое легко
   сломать незаметно: (а) авто-имена «Комната N»/«Помещение N» НЕ переносятся — иначе дубли
   нумерации; (б) совпадение двунаправленное + порог площади — иначе имя налипает на несвязанную
   комнату при полной перерисовке; (в) результат НЕ зависит от порядка входных массивов; (г)
   назначение один-к-одному. Все три критичных места проверены на фальсификацию (см. отчёт).

   ГЕОМЕТРИЯ ФИКСТУР. Прямоугольники — rect(id,x0,y0,x1,y1); Г/П-образные — withPoly(id, poly, extra).
   Пара сопоставляется по ТОЧКЕ СОПОСТАВЛЕНИЯ (EPGeom.roomMatchPoint), а не по голому центроиду: у
   прямоугольника это его центр ((x0+x1)/2,(y0+y1)/2) = центроид (он внутри), у Г/П — полюс
   недоступности ВНУТРИ контура (среднее вершин у них уезжает наружу, поэтому старое правило «по
   центроиду» их пересборку не опознавало — В13). Площадь — w*h. Центры прямоугольников держим ВНУТРИ
   клеток (не на границе смежных), т.к. попадание точки на ребро у ray-casting неустойчиво, а нам важна
   логика сопоставления, а не поведение на границе. */
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../js/roomCarry.js");
const G = require("../js/geometry.js");   /* настоящая геометрия: центроид/полюс/точка сопоставления */

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
  assert.deepEqual(C.carry([oldR], [newR]), [{ toId: "new1", fromId: "old1", name: "Кухня", area: null, lightingScheme: null, standard: null, collection: null, frameMaterial: null, frameShape: null, frameColor: null }]);
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
  assert.deepEqual(C.carry([oldR], [newR]), [{ toId: "new1", fromId: "old1", name: null, area: "18,6 м²", lightingScheme: null, standard: null, collection: null, frameMaterial: null, frameShape: null, frameColor: null }]);
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
  assert.deepEqual(C.carry([oldR], [newR]), [{ toId: "new1", fromId: "old1", name: "Кухня", area: "20", lightingScheme: null, standard: null, collection: null, frameMaterial: null, frameShape: null, frameColor: null }]);
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
  assert.deepEqual(res, [{ toId: "new1", fromId: "old1", name: "Кухня", area: null, lightingScheme: null, standard: null, collection: null, frameMaterial: null, frameShape: null, frameColor: null }]);
});

/* ---- 10. Ручная комната (autoPolygon===false) источником не бывает ---- */
test("старая с autoPolygon===false (ручной контур) не отдаёт поля — пересчёт её не трогает", () => {
  const oldManual = rect("old1", 0, 0, 100, 100, { name: "Кухня", autoPolygon: false });
  const newR = rect("new1", 0, 0, 100, 100, { name: "Комната 1", autoPolygon: true });
  assert.deepEqual(C.carry([oldManual], [newR]), []);
});

/* ---- 11. Схема электрики комнаты переносится (часть 2) ------------------------------
   Своя схема комнаты (room.lightingScheme) — такое же введённое человеком поле, как имя/площадь,
   и autoPolygon её не снимает. Без переноса она стиралась бы при каждом авто-пересчёте контуров
   (scheduleRoomsFromLines), поэтому carry обязан её нести. */
test("схема электрики комнаты переносится на совпавший контур", () => {
  const oldR = rect("old1", 0, 0, 100, 100, { name: "Комната 5", lightingScheme: "relay", autoPolygon: true });
  const newR = rect("new1", 0, 0, 100, 100, { name: "Комната 1", autoPolygon: true });
  assert.deepEqual(C.carry([oldR], [newR]),
    [{ toId: "new1", fromId: "old1", name: null, area: null, lightingScheme: "relay", standard: null, collection: null, frameMaterial: null, frameShape: null, frameColor: null }]);
});

/* Схема несётся ВМЕСТЕ с именем/площадью, а не вместо них. */
test("схема переносится вместе с ручным именем и площадью", () => {
  const oldR = rect("old1", 0, 0, 100, 100, { name: "Кухня", area: "18", lightingScheme: "classic", autoPolygon: true });
  const newR = rect("new1", 0, 0, 100, 100, { name: "Комната 1", autoPolygon: true });
  assert.deepEqual(C.carry([oldR], [newR]),
    [{ toId: "new1", fromId: "old1", name: "Кухня", area: "18", lightingScheme: "classic", standard: null, collection: null, frameMaterial: null, frameShape: null, frameColor: null }]);
});

/* ---- 12. Отсутствие/мусор схемы не создаёт поле ------------------------------------
   Комната без своей схемы следует за проектом (EPRoom.roomLightingScheme). Перенос НЕ должен
   материализовать пустое значение в поле — иначе комната молча «прибила» бы к себе схему. */
test("отсутствие схемы не порождает перенос поля (lightingScheme: null)", () => {
  const oldR = rect("old1", 0, 0, 100, 100, { name: "Кухня", autoPolygon: true });
  const newR = rect("new1", 0, 0, 100, 100, { name: "Комната 1", autoPolygon: true });
  assert.deepEqual(C.carry([oldR], [newR]),
    [{ toId: "new1", fromId: "old1", name: "Кухня", area: null, lightingScheme: null, standard: null, collection: null, frameMaterial: null, frameShape: null, frameColor: null }]);
});

test("пустая строка/мусор в схеме трактуются как отсутствие", () => {
  const oEmpty = rect("oe", 0, 0, 100, 100, { name: "Кухня", lightingScheme: "", autoPolygon: true });
  const nEmpty = rect("ne", 0, 0, 100, 100, { name: "Комната 1", autoPolygon: true });
  assert.equal(C.carry([oEmpty], [nEmpty])[0].lightingScheme, null);
  const oJunk = rect("oj", 0, 0, 100, 100, { name: "Кухня", lightingScheme: 123, autoPolygon: true });
  const nJunk = rect("nj", 0, 0, 100, 100, { name: "Комната 1", autoPolygon: true });
  assert.equal(C.carry([oJunk], [nJunk])[0].lightingScheme, null);
});

/* ---- 13. Комната ТОЛЬКО со схемой (без имени и площади) тоже попадает в перенос -----
   Раньше «нести нечего» решалось по имени/площади; если бы схему забыли учесть в этом условии,
   комната только со схемой выпала бы из переноса и потеряла её. */
test("комната только со схемой (без ручного имени и площади) переносится", () => {
  const oldR = rect("old1", 0, 0, 100, 100, { name: "Комната 5", lightingScheme: "bell", autoPolygon: true });
  const newR = rect("new1", 0, 0, 100, 100, { name: "Комната 1", autoPolygon: true });
  /* имя авто-формата не переносится, площади нет — но схема есть, значит перенос обязан быть */
  assert.deepEqual(C.carry([oldR], [newR]),
    [{ toId: "new1", fromId: "old1", name: null, area: null, lightingScheme: "bell", standard: null, collection: null, frameMaterial: null, frameShape: null, frameColor: null }]);
});

/* ---- 14. Коллекция накладок (E13) переносится как схема ------------------------------
   room.collection — введённое человеком поле; пересчёт контуров стирает авто-комнаты, и без
   переноса коллекция исчезала бы при каждой правке линий разметки (молчаливая потеря настройки).
   Мутация «collection выпал из normUserFields / из out.push / из условия „нести нечего“» краснеет
   здесь. */
test("комната только с коллекцией (без ручного имени и площади) переносится", () => {
  const oldR = rect("old1", 0, 0, 100, 100, { name: "Комната 5", collection: "Arke", autoPolygon: true });
  const newR = rect("new1", 0, 0, 100, 100, { name: "Комната 1", autoPolygon: true });
  assert.deepEqual(C.carry([oldR], [newR]),
    [{ toId: "new1", fromId: "old1", name: null, area: null, lightingScheme: null, standard: null, collection: "Arke", frameMaterial: null, frameShape: null, frameColor: null }]);
});

test("коллекция едет вместе с именем, площадью и схемой", () => {
  const oldR = rect("old1", 0, 0, 100, 100, { name: "Кухня", area: "18", lightingScheme: "classic", collection: "Plana", autoPolygon: true });
  const newR = rect("new1", 0, 0, 100, 100, { name: "Комната 1", autoPolygon: true });
  assert.deepEqual(C.carry([oldR], [newR]),
    [{ toId: "new1", fromId: "old1", name: "Кухня", area: "18", lightingScheme: "classic", standard: null, collection: "Plana", frameMaterial: null, frameShape: null, frameColor: null }]);
});

test("пустая/нестроковая коллекция не переносится (collection: null)", () => {
  const oEmpty = rect("oe", 0, 0, 100, 100, { name: "Кухня", collection: "", autoPolygon: true });
  const nEmpty = rect("ne", 0, 0, 100, 100, { name: "Комната 1", autoPolygon: true });
  assert.equal(C.carry([oEmpty], [nEmpty])[0].collection, null);
  const oJunk = rect("oj", 0, 0, 100, 100, { name: "Кухня", collection: 123, autoPolygon: true });
  const nJunk = rect("nj", 0, 0, 100, 100, { name: "Комната 1", autoPolygon: true });
  assert.equal(C.carry([oJunk], [nJunk])[0].collection, null);
});

/* --- ОТДЕЛКА НАКЛАДКИ КОМНАТЫ (E14): перенос при пересчёте контуров -------------------------- */

test("отделка (материал/форма/цвет) переносится на совпавший контур", () => {
  const oldR = rect("old1", 0, 0, 100, 100,
    { name: "Комната 5", frameMaterial: "Металл", frameShape: "Скруглённая", frameColor: "Никель матовый", autoPolygon: true });
  const newR = rect("new1", 0, 0, 100, 100, { name: "Комната 1", autoPolygon: true });
  assert.deepEqual(C.carry([oldR], [newR]),
    [{ toId: "new1", fromId: "old1", name: null, area: null, lightingScheme: null, standard: null, collection: null,
       frameMaterial: "Металл", frameShape: "Скруглённая", frameColor: "Никель матовый" }]);
});

test("комната ТОЛЬКО с отделкой (без имени/площади) всё равно переносится", () => {
  const oldR = rect("old1", 0, 0, 100, 100, { name: "Комната 5", frameColor: "Титан матовый", autoPolygon: true });
  const newR = rect("new1", 0, 0, 100, 100, { name: "Комната 1", autoPolygon: true });
  const res = C.carry([oldR], [newR]);
  assert.equal(res.length, 1, "перенос создаётся, даже если ручное — только цвет накладки");
  assert.equal(res[0].frameColor, "Титан матовый");
});

test("пустая/нестроковая отделка не переносится (frame*: null)", () => {
  const oldR = rect("old1", 0, 0, 100, 100, { name: "Кухня", frameMaterial: "", frameShape: 7, frameColor: {}, autoPolygon: true });
  const newR = rect("new1", 0, 0, 100, 100, { name: "Комната 1", autoPolygon: true });
  const t = C.carry([oldR], [newR])[0];
  assert.equal(t.frameMaterial, null);
  assert.equal(t.frameShape, null);
  assert.equal(t.frameColor, null);
});

/* --- МОНТАЖНЫЙ СТАНДАРТ КОМНАТЫ (room.standard): перенос при пересчёте контуров (В13) ------------
   Решение владельца: стандарт переносить. Сейчас он пропадает у ВСЕХ комнат, включая прямоугольные,
   поэтому тест — и на прямоугольник (здесь), и на Г/П (ниже). Правило то же, что у коллекции. */

test("монтажный стандарт переносится на совпавший контур (прямоугольник)", () => {
  const oldR = rect("old1", 0, 0, 100, 100, { name: "Комната 5", standard: "IT", autoPolygon: true });
  const newR = rect("new1", 0, 0, 100, 100, { name: "Комната 1", autoPolygon: true });
  assert.deepEqual(C.carry([oldR], [newR]),
    [{ toId: "new1", fromId: "old1", name: null, area: null, lightingScheme: null, standard: "IT", collection: null, frameMaterial: null, frameShape: null, frameColor: null }]);
});

test("комната ТОЛЬКО со стандартом (без имени/площади) всё равно переносится", () => {
  const oldR = rect("old1", 0, 0, 100, 100, { name: "Помещение 3", standard: "DE", autoPolygon: true });
  const newR = rect("new1", 0, 0, 100, 100, { name: "Комната 1", autoPolygon: true });
  const res = C.carry([oldR], [newR]);
  assert.equal(res.length, 1, "перенос есть, хотя ручное — только стандарт (мутация «standard вне условия „нести нечего“» краснит здесь)");
  assert.equal(res[0].standard, "DE");
});

test("стандарт едет вместе со схемой, коллекцией и отделкой (прямоугольник)", () => {
  const oldR = rect("old1", 0, 0, 100, 100, { name: "Кухня", lightingScheme: "relay", standard: "IT",
    collection: "Arke", frameColor: "Антрацит", autoPolygon: true });
  const newR = rect("new1", 0, 0, 100, 100, { name: "Комната 1", autoPolygon: true });
  assert.deepEqual(C.carry([oldR], [newR]),
    [{ toId: "new1", fromId: "old1", name: "Кухня", area: null, lightingScheme: "relay", standard: "IT",
       collection: "Arke", frameMaterial: null, frameShape: null, frameColor: "Антрацит" }]);
});

test("пустой/нестроковый стандарт не переносится (standard: null)", () => {
  const oEmpty = rect("oe", 0, 0, 100, 100, { name: "Кухня", standard: "", autoPolygon: true });
  const nEmpty = rect("ne", 0, 0, 100, 100, { name: "Комната 1", autoPolygon: true });
  assert.equal(C.carry([oEmpty], [nEmpty])[0].standard, null);
  const oJunk = rect("oj", 0, 0, 100, 100, { name: "Кухня", standard: 42, autoPolygon: true });
  const nJunk = rect("nj", 0, 0, 100, 100, { name: "Комната 1", autoPolygon: true });
  assert.equal(C.carry([oJunk], [nJunk])[0].standard, null);
});

/* ============================ Г- И П-ОБРАЗНЫЕ КОМНАТЫ (В13) ============================
   Мотив: у Г/П среднее вершин лежит ВНЕ контура, и старое правило «сопоставляем по центроиду» их
   пересборку не опознавало — при любой правке линий такая комната получала новое id, авто-имя и
   пустые поля. Теперь сопоставление идёт по EPGeom.roomMatchPoint (точке ВНУТРИ контура). */

/* Комната по произвольному контуру. extra — пользовательские поля. Копируем вершины, чтобы тест не
   делил массив с фикстурой. */
function withPoly(id, poly, extra) {
  return Object.assign({ id, polygon: poly.map(p => ({ x: p.x, y: p.y })) }, extra || {});
}

/* Г-образный контур (коридор огибает угол); среднее вершин (113.3,113.3) лежит ВНЕ него — в «дырке». */
const GAMMA_POLY = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 300 }, { x: 0, y: 300 }];
/* П-образный контур (открыт вверх); среднее вершин тоже вне контура (в проёме). */
const U_POLY = [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 120 }, { x: 180, y: 120 }, { x: 180, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }, { x: 0, y: 200 }];

/* «Пересобранный тем же контуром»: вставляем середины рёбер (T-вершины — их несут грани
   roomsFromLines), разворачиваем обход и сдвигаем начало. Форма и площадь те же, массив вершин —
   другой; так проверяется независимость сопоставления от числа/порядка вершин. */
function rebuilt(poly, shift) {
  const mids = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    mids.push({ x: a.x, y: a.y }, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  const rev = mids.reverse();
  const k = ((shift || 0) % rev.length + rev.length) % rev.length;
  return rev.slice(k).concat(rev.slice(0, k));
}

test("Г-комната, пересобранная тем же контуром (T-вершины, другой обход): переносятся ВСЕ поля", () => {
  const old = withPoly("g", GAMMA_POLY, { name: "Прихожая", area: "12,5 м²", lightingScheme: "relay",
    standard: "IT", collection: "Arke", frameMaterial: "Металл", frameShape: "Скруглённая", frameColor: "Антрацит", autoPolygon: true });
  const neu = withPoly("g2", rebuilt(GAMMA_POLY, 5), { name: "Помещение 4", autoPolygon: true });
  assert.deepEqual(C.carry([old], [neu]),
    [{ toId: "g2", fromId: "g", name: "Прихожая", area: "12,5 м²", lightingScheme: "relay", standard: "IT",
       collection: "Arke", frameMaterial: "Металл", frameShape: "Скруглённая", frameColor: "Антрацит" }]);
});

test("П-комната, пересобранная тем же контуром: переносятся имя, площадь, схема, коллекция, отделка", () => {
  const old = withPoly("u", U_POLY, { name: "Студия", area: "30", lightingScheme: "bell",
    standard: "DE", collection: "Plana", frameColor: "Белая", autoPolygon: true });
  const neu = withPoly("u2", rebuilt(U_POLY, 3), { name: "Комната 2", autoPolygon: true });
  assert.deepEqual(C.carry([old], [neu]),
    [{ toId: "u2", fromId: "u", name: "Студия", area: "30", lightingScheme: "bell", standard: "DE",
       collection: "Plana", frameMaterial: null, frameShape: null, frameColor: "Белая" }]);
});

test("Г-коридор вокруг кухни: центроид коридора попадает в кухню, но поля НЕ перескакивают", () => {
  const KITCHEN = [{ x: 40, y: 40 }, { x: 300, y: 40 }, { x: 300, y: 300 }, { x: 40, y: 300 }];
  const gc = G.polygonCentroid(GAMMA_POLY);
  assert.equal(G.pointInPolygon(gc.x, gc.y, KITCHEN), true, "предпосылка: среднее вершин коридора — внутри кухни (коварный случай)");
  assert.equal(G.pointInPolygon(gc.x, gc.y, GAMMA_POLY), false, "и вне самого коридора");
  const oldCorr = withPoly("corr", GAMMA_POLY, { name: "Коридор", lightingScheme: "relay", autoPolygon: true });
  const oldKitch = withPoly("kitch", KITCHEN, { name: "Кухня", lightingScheme: "classic", autoPolygon: true });
  const newCorr = withPoly("corr2", rebuilt(GAMMA_POLY, 1), { name: "Помещение 1", autoPolygon: true });
  const newKitch = withPoly("kitch2", KITCHEN, { name: "Помещение 2", autoPolygon: true });
  const byTo = Object.fromEntries(C.carry([oldCorr, oldKitch], [newCorr, newKitch]).map(t => [t.toId, t]));
  assert.equal(byTo.corr2.fromId, "corr", "коридор перенёс поля на пересобранный коридор, не в кухню");
  assert.equal(byTo.corr2.name, "Коридор");
  assert.equal(byTo.corr2.lightingScheme, "relay");
  assert.equal(byTo.kitch2.fromId, "kitch", "кухня — на кухню");
  assert.equal(byTo.kitch2.name, "Кухня");
  assert.equal(byTo.kitch2.lightingScheme, "classic");
});

test("разделение Г надвое: поля достаются фрагменту, внутрь которого попала точка сопоставления Г", () => {
  const TOP = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 40 }, { x: 0, y: 40 }];       // верхняя полоса Г
  const LEG = [{ x: 0, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 300 }, { x: 0, y: 300 }];      // левая нога Г
  const m = G.roomMatchPoint(GAMMA_POLY);
  assert.equal(G.pointInPolygon(m.x, m.y, TOP), true, "предпосылка: точка сопоставления Г лежит в верхнем фрагменте");
  assert.equal(G.pointInPolygon(m.x, m.y, LEG), false, "и не в нижнем");
  const oldG = withPoly("g", GAMMA_POLY, { name: "Прихожая", lightingScheme: "relay", autoPolygon: true });
  const top = withPoly("top", TOP, { name: "Помещение 1", autoPolygon: true });
  const leg = withPoly("leg", LEG, { name: "Помещение 2", autoPolygon: true });
  const res = C.carry([oldG], [top, leg]);
  assert.equal(res.length, 1, "перенос ровно один — второй фрагмент останется со свежим авто-именем");
  assert.equal(res[0].toId, "top", "поля ушли в фрагмент с точкой сопоставления Г");
  assert.equal(res[0].name, "Прихожая");
  assert.equal(res[0].lightingScheme, "relay");
});

test("слияние двух полосок в Г: поля берёт та старая, внутрь которой попала точка сопоставления Г", () => {
  const TOP = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 40 }, { x: 0, y: 40 }];
  const LEG = [{ x: 0, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 300 }, { x: 0, y: 300 }];
  const m = G.roomMatchPoint(GAMMA_POLY);
  assert.equal(G.pointInPolygon(m.x, m.y, TOP), true, "предпосылка: точка Г накрыта верхней полоской");
  const top = withPoly("top", TOP, { name: "Верх", lightingScheme: "relay", autoPolygon: true });
  const leg = withPoly("leg", LEG, { name: "Лево", lightingScheme: "classic", autoPolygon: true });
  const merged = withPoly("g", GAMMA_POLY, { name: "Помещение 3", autoPolygon: true });
  const res = C.carry([top, leg], [merged]);
  assert.equal(res.length, 1, "одна новая комната — один перенос");
  assert.equal(res[0].fromId, "top", "поля взяты у полоски, накрывшей точку Г");
  assert.equal(res[0].name, "Верх");
  assert.equal(res[0].lightingScheme, "relay");
});

/* ---- И1: доказательство совпадения со старым правилом (оракул — carry по ЦЕНТРОИДУ) ----
   Пропускаем НАСТОЯЩИЙ carry с подменённым roomMatchPoint = polygonCentroid: это ровно старое правило.
   На планах, где центроид всех комнат внутри своего контура (прямоугольники, в т.ч. с T-вершинами и
   узкие), roomMatchPoint === centroid, поэтому новое правило обязано дать бит-в-бит тот же результат.
   Мутация «вернуть центроид в carry» здесь не краснит (для таких входов оба правила совпадают) — её
   ловит перебор Г/П выше; а вот «точка внутри без проверки центроида (всегда полюс)» краснит: полюс
   прямоугольника с T-вершинами ≠ его центроид. */
test("И1 (оракул): при центроиде внутри контура новое правило = старое (по центроиду), бит-в-бит", () => {
  const geomOracle = Object.assign({}, G, { roomMatchPoint: G.polygonCentroid });
  let s = 123456789;                                   // детерминированный ГПСЧ (LCG)
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const NAMES = ["Кухня", "Спальня", "Гостиная", "Ванная", "Холл", "Комната 7"];   // «Комната 7» — авто
  const SCHEMES = [undefined, "relay", "classic", "bell"];
  /* T-вершина НЕ в середине ребра (ассиметрично) — так центроид новой РЕАЛЬНО смещается относительно
     чистого прямоугольника, но остаётся внутри (у выпуклой среднее вершин всегда внутри). */
  const tVertices = poly => {
    const o = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      o.push({ x: a.x, y: a.y });
      if (i % 2 === 0) o.push({ x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 });   // 1/3 ребра
    }
    return o;
  };
  let plansWithTransfer = 0;
  for (let plan = 0; plan < 40; plan++) {
    const cols = 2 + Math.floor(rnd() * 3), rows = 2 + Math.floor(rnd() * 3);
    const cell = 40 + Math.floor(rnd() * 60);
    const old = [], neu = [];
    let idx = 0;
    for (let cx = 0; cx < cols; cx++) for (let cy = 0; cy < rows; cy++) {
      const x0 = cx * cell + 1, y0 = cy * cell + 1;
      const narrow = rnd() < 0.3;                       // узкие комнаты — центроид всё равно внутри
      const x1 = x0 + (narrow ? 8 : cell - 2), y1 = y0 + cell - 2;
      const poly = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
      old.push(withPoly("o" + plan + "_" + idx, poly, { name: NAMES[Math.floor(rnd() * NAMES.length)],
        area: rnd() < 0.5 ? String(10 + idx) : "", lightingScheme: SCHEMES[Math.floor(rnd() * SCHEMES.length)],
        collection: rnd() < 0.4 ? "Arke" : undefined, autoPolygon: true }));
      neu.push(withPoly("n" + plan + "_" + idx, tVertices(poly), { name: "Комната " + (idx + 1), autoPolygon: true }));
      idx++;
    }
    const actual = C.carry(old, neu);
    assert.deepEqual(actual, C.carry(old, neu, geomOracle), "план " + plan + ": новое правило = старое (по центроиду)");
    /* И5: перестановка входа не меняет результат (тай-брейк геометрический, не по порядку) */
    assert.deepEqual(C.carry([...old].reverse(), [...neu].reverse()), actual, "план " + plan + ": порядок входа не влияет");
    if (actual.length) plansWithTransfer++;
  }
  assert.ok(plansWithTransfer >= 30, "перенос реально состоялся в большинстве планов (тест не пустой): " + plansWithTransfer);
});

/* ============ З13: сопоставление carry идёт по roomMatchPoint, НЕ по подписи/полюсу ============
   Мутации `matchPoint = geom.roomMatchPoint` → `geom.roomNamePoint` (MX1) и → `geom.poleOfInaccessibility`
   (MX2) прежде НЕ краснели: на прямоугольниках все три точки совпадают. Ловим их на входах, где точки
   РАСХОДЯТСЯ и попадают в РАЗНЫЕ фрагменты разреза, — тогда выбор точки виден в том, какому фрагменту
   достались поля. Предпосылки проверяем прямо в тесте настоящей геометрией, чтобы вход не «сполз». */

/* В16 убрал ДРЕЙФ среднего вершин от коллинеарных T-вершин (roomMatchPoint считает центроид по контуру
   БЕЗ коллинеаров — иначе примкнувшая чужая линия двигала точку и портила матч, корень 1 В16). Прежде
   эти два теста разводили центроид и полюс именно T-вершинами (прямоугольник с лишними точками на ребре);
   после В16 у такого прямоугольника центроид вернулся в истинный центр и совпал с полюсом — тесты бы
   указывали на уже исправленный дефект. Расхождение центроид≠полюс≠подпись берём теперь от НЕСИММЕТРИЧНОЙ
   формы (прямоугольный треугольник): T-вершины для этого больше не нужны, а мутации MX1/MX2 ловятся так же. */
test("З13(а): прямоугольный треугольник, разрез y=38 — поля у ВЕРХНЕГО фрагмента (центроид), не у нижнего (полюс)", () => {
  /* Прямоугольный треугольник 300×100: центроид (среднее вершин) = (100,33.3), полюс недоступности
     (центр вписанной окружности) = (41.8,41.8). Разрез y=38 разводит их: центроид — в верхнем фрагменте,
     полюс — в нижнем. roomMatchPoint = центроид (он внутри), значит поля обязаны уйти ВВЕРХ; MX2 (полюс)
     увёл бы их вниз. */
  const T = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 0, y: 100 }];
  const c = G.polygonCentroid(T), pole = G.poleOfInaccessibility(T);
  assert.ok(c.y < 38 && pole.y > 38, "предпосылка: центроид (y=" + c.y.toFixed(1) + ") в верхнем, полюс (y=" + pole.y.toFixed(1) + ") в нижнем");
  const UP = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 186, y: 38 }, { x: 0, y: 38 }];
  const LO = [{ x: 0, y: 38 }, { x: 186, y: 38 }, { x: 0, y: 100 }];
  const old = withPoly("t", T, { name: "Кухня", lightingScheme: "relay", autoPolygon: true });
  const up = withPoly("up", UP, { name: "Помещение 1", autoPolygon: true });
  const lo = withPoly("lo", LO, { name: "Помещение 2", autoPolygon: true });
  const res = C.carry([old], [up, lo]);
  assert.equal(res.length, 1, "перенос ровно один — второй фрагмент со свежим авто-именем");
  assert.equal(res[0].toId, "up", "поля ушли в ВЕРХНИЙ фрагмент (точка сопоставления = центроид). MX2 (полюс) увёл бы в lo");
  assert.equal(res[0].name, "Кухня");
});

test("З13(б): тонкий треугольник (центроид внутри, центроид+(10,2) снаружи), разрез — поля у фрагмента с ЦЕНТРОИДОМ", () => {
  /* Тонкий прямоугольный треугольник 8×300: центроид (среднее вершин) = (2.7,100), полюс = (4,4).
     Фигура УЗКАЯ — центроид+(10,2) уже вне контура, поэтому у roomNamePoint критерий keep проваливается
     и он отдаёт ПОЛЮС (как MX1), а roomMatchPoint остаётся на центроиде. Разрез y=50 разводит центроид
     (низ) и полюс (верх): верный ответ — нижний фрагмент; и MX1 (подпись→полюс), и MX2 (полюс) увели бы
     вверх. Так один вход ловит ОБЕ мутации. */
  const S = [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 0, y: 300 }];
  const c = G.polygonCentroid(S), pole = G.poleOfInaccessibility(S), namePt = G.roomNamePoint(S);
  assert.equal(G.pointInPolygon(c.x, c.y, S), true, "предпосылка: центроид внутри узкого контура");
  assert.equal(G.pointInPolygon(c.x + 10, c.y + 2, S), false, "предпосылка: центроид+(10,2) уже СНАРУЖИ (узкая) — оттого namePoint уходит на полюс");
  assert.ok(c.y > 50 && pole.y < 50 && namePt.y < 50, "предпосылка: центроид в нижнем, полюс и подпись — в верхнем");
  const SU = [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 6.6667, y: 50 }, { x: 0, y: 50 }];
  const SL = [{ x: 0, y: 50 }, { x: 6.6667, y: 50 }, { x: 0, y: 300 }];
  const old = withPoly("s", S, { name: "Пенал", collection: "Arke", autoPolygon: true });
  const su = withPoly("su", SU, { name: "Помещение 1", autoPolygon: true });
  const sl = withPoly("sl", SL, { name: "Помещение 2", autoPolygon: true });
  const res = C.carry([old], [su, sl]);
  assert.equal(res.length, 1);
  assert.equal(res[0].toId, "sl", "поля у НИЖНЕГО фрагмента (центроид). MX1 (подпись→полюс) и MX2 (полюс) увели бы в su");
  assert.equal(res[0].name, "Пенал");
});

/* ==================== В15: ПАМЯТЬ ПОЛЕЙ ИСЧЕЗНУВШИХ КОМНАТ (reconcile) ====================
   reconcile = carry + память. Значения по умолчанию для «жёсткого» ожидания переноса: все восемь полей
   null, поверх — заданные. Так каждое поле в ожидании закреплено (мутация «потерять поле» краснеет). */
const NIL = { name: null, area: null, lightingScheme: null, standard: null, collection: null, frameMaterial: null, frameShape: null, frameColor: null };
const tr = (toId, fromId, over) => Object.assign({ toId, fromId }, NIL, over || {});
/* Карта переносов по toId — для порядко-независимого, но по-прежнему ЖЁСТКОГО (все поля) сравнения. */
const byTo = list => Object.fromEntries(list.map(t => [t.toId, t]));

test("Ж1 (прямоугольник): комната исчезла → память хранит поля; появилась заново → все поля вернулись, память пуста", () => {
  const room = rect("a", 0, 0, 100, 100, { name: "Кухня", lightingScheme: "relay", standard: "IT", collection: "Arke", autoPolygon: true });
  /* исчезла: новых комнат нет (стену удалили, контур разомкнут) — переносить некуда, поля уходят в память */
  const gone = C.reconcile([room], [], []);
  assert.deepEqual(gone.transfers, [], "переносить некуда — ни одного переноса");
  assert.equal(gone.memory.length, 1, "поля исчезнувшей комнаты запомнены");
  assert.deepEqual(gone.memory[0].fields, { name: "Кухня", area: null, lightingScheme: "relay", standard: "IT", collection: "Arke", frameMaterial: null, frameShape: null, frameColor: null });
  /* появилась заново тем же контуром (свежий id, авто-имя) — память отдаёт ей ВСЕ поля */
  const back = rect("new", 0, 0, 100, 100, { name: "Помещение 1", autoPolygon: true });
  const ret = C.reconcile([], [back], gone.memory);
  assert.deepEqual(ret.transfers, [tr("new", null, { name: "Кухня", lightingScheme: "relay", standard: "IT", collection: "Arke" })],
    "все поля вернулись на перерисованную комнату");
  assert.equal(ret.memory.length, 0, "выданная запись из памяти удалена (не выдастся повторно)");
});

test("Ж1 (Г-образная): исчезла и вернулась со всеми полями — точка сопоставления Г внутри контура", () => {
  const g = withPoly("g", GAMMA_POLY, { name: "Прихожая", area: "12,5 м²", lightingScheme: "relay", standard: "IT",
    collection: "Arke", frameMaterial: "Металл", frameShape: "Скруглённая", frameColor: "Антрацит", autoPolygon: true });
  const gone = C.reconcile([g], [], []);
  assert.equal(gone.memory.length, 1, "Г-комната запомнена (полюс недоступности внутри контура)");
  /* вернулась пересобранным контуром (T-вершины, другой обход) — как строит грани roomsFromLines */
  const back = withPoly("g2", rebuilt(GAMMA_POLY, 5), { name: "Помещение 4", autoPolygon: true });
  const ret = C.reconcile([], [back], gone.memory);
  assert.deepEqual(byTo(ret.transfers).g2, tr("g2", null, { name: "Прихожая", area: "12,5 м²", lightingScheme: "relay",
    standard: "IT", collection: "Arke", frameMaterial: "Металл", frameShape: "Скруглённая", frameColor: "Антрацит" }));
  assert.equal(ret.memory.length, 0);
});

test("Ж2 (общая стена): слияние→разделение возвращает ОБЕ комнаты со СВОИМИ полями, без перестановки", () => {
  /* Ширины РАЗНЫЕ (100 и 120), чтобы центроид объединённой M (110,50) не сел на бывшую общую грань
     x=100 (там ray-casting неустойчив), а уверенно попал в правую — так тест проверяет логику, а не
     поведение на ребре. Слева «КомнатаЛ/classic», справа «КомнатаП/relay». */
  const A = rect("A", 0, 0, 100, 100, { name: "КомнатаЛ", lightingScheme: "classic", autoPolygon: true });
  const B = rect("B", 100, 0, 220, 100, { name: "КомнатаП", lightingScheme: "relay", autoPolygon: true });
  const M = rect("M", 0, 0, 220, 100, { name: "Помещение 5", autoPolygon: true });
  /* удалили общую стену → одна комната M. Одна старая наследуется M через carry, вторая уходит в память. */
  const merged = C.reconcile([A, B], [M], []);
  assert.equal(merged.transfers.length, 1, "слияние: ровно один перенос на M");
  assert.equal(merged.memory.length, 1, "поля второй (не наследованной M) комнаты — в памяти");
  const winner = merged.transfers[0].name, loser = merged.memory[0].fields.name;
  assert.deepEqual([winner, loser].sort(), ["КомнатаЛ", "КомнатаП"], "одна ушла в M, другая в память — без потери и без дубля");
  /* применяем перенос к M (как оркестратор), затем перерисовали общую стену → M разделилась на A' и B' */
  if (merged.transfers[0].name != null) M.name = merged.transfers[0].name;
  if (merged.transfers[0].lightingScheme != null) M.lightingScheme = merged.transfers[0].lightingScheme;
  const Ap = rect("Ap", 0, 0, 100, 100, { name: "Помещение 1", autoPolygon: true });
  const Bp = rect("Bp", 100, 0, 220, 100, { name: "Помещение 2", autoPolygon: true });
  const split = C.reconcile([M], [Ap, Bp], merged.memory);
  const t = byTo(split.transfers);
  assert.equal(t.Ap.name, "КомнатаЛ", "левый фрагмент получил СВОИ поля (не правого)");
  assert.equal(t.Ap.lightingScheme, "classic");
  assert.equal(t.Bp.name, "КомнатаП", "правый фрагмент получил СВОИ поля");
  assert.equal(t.Bp.lightingScheme, "relay");
  assert.equal(split.memory.length, 0, "обе выданы — память пуста");
});

test("Ж3: пересборка без исчезновений даёт ТОТ ЖЕ перенос (жёсткое ожидание, не оракул через carry)", () => {
  /* Две комнаты стопкой (центроиды (50,50) и (50,150) — внутри своих контуров, не на общей грани).
     Память ПУСТА: фаза 2 ничего не добавляет, перенос обязан совпасть с обычным carry — но сверяем
     с РУКОПИСНЫМ ожиданием, а не с C.carry(...): оракул через тот же carry слеп к подмене roomMatchPoint
     внутри него (урок З13). */
  const A = rect("A", 0, 0, 100, 100, { name: "Кухня", lightingScheme: "relay", autoPolygon: true });
  const B = rect("B", 0, 100, 100, 200, { name: "Спальня", lightingScheme: "classic", autoPolygon: true });
  const A2 = rect("A2", 0, 0, 100, 100, { name: "Помещение 1", autoPolygon: true });
  const B2 = rect("B2", 0, 100, 100, 200, { name: "Помещение 2", autoPolygon: true });
  const res = C.reconcile([A, B], [A2, B2], []);
  assert.deepEqual(byTo(res.transfers), {
    A2: tr("A2", "A", { name: "Кухня", lightingScheme: "relay" }),
    B2: tr("B2", "B", { name: "Спальня", lightingScheme: "classic" })
  }, "перенос ровно как раньше (все поля закреплены)");
  assert.equal(res.memory.length, 0, "никто не исчез — память пуста");
});

test("Ж3: посторонняя запись в памяти НЕ липнет к несвязанной комнате и остаётся лежать", () => {
  /* В памяти набор для области [0,0]-[40,40]; новая комната далеко [200,200]-[300,300]. Двунаправленное
     попадание и порог площади не проходят — перенос пуст, запись памяти сохраняется (ждёт свою область). */
  const memory = [{ polygon: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }], fields: Object.assign({}, NIL, { name: "Гостиная" }) }];
  const far = rect("far", 200, 200, 300, 300, { name: "Помещение 1", autoPolygon: true });
  const res = C.reconcile([], [far], memory);
  assert.deepEqual(res.transfers, [], "чужой комнате поля не отданы");
  assert.equal(res.memory.length, 1, "запись памяти осталась (не потеряна и не выдана)");
});

test("Ж4: один запомненный набор достаётся ровно ОДНОЙ новой комнате (две перекрывающиеся — не обе)", () => {
  /* Набор для [0,0]-[100,100]; две новые перекрывают его центр (как в тесте один-к-одному carry). Победитель
     — ближе по площади (nBig); nSmall не получает ничего, дубля набора нет. Запись после выдачи удалена. */
  const memory = [{ polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], fields: Object.assign({}, NIL, { name: "Гостиная" }) }];
  const nBig = rect("nBig", 10, 10, 90, 90, { autoPolygon: true });    // 6400
  const nSmall = rect("nSmall", 15, 15, 85, 85, { autoPolygon: true }); // 4900
  const res = C.reconcile([], [nBig, nSmall], memory);
  assert.equal(res.transfers.length, 1, "набор выдан ровно один раз");
  assert.equal(res.transfers[0].toId, "nBig", "ближе по площади — берёт первым; вторая пустая");
  assert.equal(res.transfers[0].name, "Гостиная");
  assert.equal(res.memory.length, 0, "выданный набор из памяти удалён");
});

test("Ж5: память ограничена (FIFO вытесняет старейших) и переживает JSON-сериализацию проекта", () => {
  /* 70 исчезнувших комнат в РАЗНЫХ местах, все с полями. Память держит не больше предела и оставляет
     СВЕЖИЕ (последние по входу), вытесняя старые с начала. Предел зашит в модуль (64) — проверяем факт
     ограничения и FIFO по именам R0..R69. */
  const many = [];
  for (let i = 0; i < 70; i++) many.push(rect("r" + i, i * 10, 0, i * 10 + 8, 8, { name: "R" + i, autoPolygon: true }));
  const res = C.reconcile(many, [], []);
  assert.equal(res.memory.length, 64, "память ограничена предельным размером");
  assert.equal(res.memory[0].fields.name, "R6", "вытеснены самые старые (R0..R5), оставлены свежие");
  assert.equal(res.memory[63].fields.name, "R69", "последний запомненный — самый свежий");
  /* переживает автосейв/перезагрузку: память — простые данные, круговой прогон через JSON не меняет её,
     и восстановленная память по-прежнему возвращает поля перерисованной комнате */
  const room = rect("a", 0, 0, 100, 100, { name: "Кухня", lightingScheme: "relay", autoPolygon: true });
  const gone = C.reconcile([room], [], []);
  const persisted = JSON.parse(JSON.stringify(gone.memory));
  assert.deepEqual(persisted, gone.memory, "память сериализуется в проект без потерь");
  const back = rect("new", 0, 0, 100, 100, { name: "Помещение 1", autoPolygon: true });
  const ret = C.reconcile([], [back], persisted);
  assert.equal(ret.transfers[0].name, "Кухня", "после перезагрузки память всё ещё возвращает поля");
  assert.equal(ret.transfers[0].lightingScheme, "relay");
});

test("Ж6: ручная комната (autoPolygon===false) исчезла — НЕ запоминается (пересчёт её не трогает); авто-комната, которая осталась, переносится как раньше", () => {
  const manual = rect("m", 0, 0, 100, 100, { name: "Моя комната", lightingScheme: "relay", autoPolygon: false });
  const goneManual = C.reconcile([manual], [], []);
  assert.equal(goneManual.memory.length, 0, "ручной контур источником памяти не бывает");
  /* одиночная авто-комната, пережившая пересборку тем же контуром: обычный перенос, память не растёт */
  const single = rect("s", 0, 0, 100, 100, { name: "Кухня", lightingScheme: "classic", autoPolygon: true });
  const single2 = rect("s2", 0, 0, 100, 100, { name: "Помещение 1", autoPolygon: true });
  const res = C.reconcile([single], [single2], []);
  assert.deepEqual(res.transfers, [tr("s2", "s", { name: "Кухня", lightingScheme: "classic" })]);
  assert.equal(res.memory.length, 0, "ничего не исчезло — память пуста");
});

/* ---- З14: три правила ФАЗЫ 2 reconcile, которых не держал ни один тест: Ж1–Ж6 оставались зелёными и при
   снятом пороге площади, и при снятой проверке «точка новой внутри памяти», и при выдаче записи комнате,
   уже занятой фазой 1. Каждый тест изолирует РОВНО ОДНО правило: остальные условия сопоставления в фикстуре
   выполнены, что подтверждено предусловиями на настоящей геометрии (EPGeom) — иначе тест мог бы краснеть/
   зеленеть по постороннему поводу (урок З13). Ожидания жёсткие: весь массив переносов и вся память целиком. */

/* Запись памяти для прямоугольной области — в том виде, как её кладёт reconcile: {polygon, fields}. */
const memRect = (x0, y0, x1, y1, fields) =>
  ({ polygon: rect("m", x0, y0, x1, y1).polygon, fields: Object.assign({}, NIL, fields) });

test("Ж7 (порог площади): большая запись памяти НЕ липнет к малой комнате на том же месте (1:12) и остаётся в памяти", () => {
  /* Память — большая область [0,0]-[400,300] (120000), новая свободная — малая [150,100]-[250,200] (10000)
     точно в её середине: точки сопоставления совпадают (200,150), попадание в обе стороны есть. Отсекает
     ТОЛЬКО порог площади (10000/120000 = 1/12 < 0.25): без него набор целого зала достался бы любой
     перегородке или кладовке, нарисованной внутри его бывших границ. */
  const rec = memRect(0, 0, 400, 300, { name: "Ангар", area: "120 м²", lightingScheme: "relay", collection: "Arke" });
  const before = JSON.parse(JSON.stringify(rec));
  const small = rect("small", 150, 100, 250, 200, { name: "Помещение 1", autoPolygon: true });
  const mp = G.roomMatchPoint(rec.polygon), np = G.roomMatchPoint(small.polygon);
  assert.ok(G.pointInPolygon(mp.x, mp.y, small.polygon) && G.pointInPolygon(np.x, np.y, rec.polygon),
    "предусловие: точки взаимно внутри — единственный барьер это порог площади");
  const res = C.reconcile([], [small], [rec]);
  assert.deepEqual(res.transfers, [], "на малую комнату переноса нет (без порога он появлялся)");
  assert.deepEqual(res.memory, [before], "запись осталась в памяти целиком и не изменилась — ждёт свою область");
});

test("Ж8 (обе стороны): точка памяти внутри новой, а точка новой вне памяти — запись НЕ выдаётся и остаётся в памяти", () => {
  /* Память [0,0]-[200,100], новая свободная [90,0]-[400,100]. Точка памяти (100,50) лежит внутри новой, а
     точка новой (245,50) — за правым краем памяти (x>200): попадание только с ОДНОЙ стороны. Площади близки
     (20000 и 31000, отношение ≈0.65 ≥ 0.25), порог не мешает — отсекает только требование «в обе стороны».
     Односторонняя проверка отдала бы набор комнате, что лишь задевает бывшую область краем, а в основном
     лежит за её пределами, — это уже другая комната. */
  const rec = memRect(0, 0, 200, 100, { name: "Цех", lightingScheme: "classic" });
  const before = JSON.parse(JSON.stringify(rec));
  const wide = rect("wide", 90, 0, 400, 100, { name: "Помещение 1", autoPolygon: true });
  const mp = G.roomMatchPoint(rec.polygon), np = G.roomMatchPoint(wide.polygon);
  const aM = G.polygonAreaPx(rec.polygon), aN = G.polygonAreaPx(wide.polygon);
  assert.ok(G.pointInPolygon(mp.x, mp.y, wide.polygon), "предусловие: точка памяти (100,50) внутри новой");
  assert.ok(!G.pointInPolygon(np.x, np.y, rec.polygon), "предусловие: точка новой (245,50) вне памяти");
  assert.ok(Math.min(aM, aN) / Math.max(aM, aN) >= 0.25, "предусловие: площади порог проходят");
  const res = C.reconcile([], [wide], [rec]);
  assert.deepEqual(res.transfers, [], "односторонне попавшей комнате набор не выдан (без проверки в обе стороны выдавался)");
  assert.deepEqual(res.memory, [before], "запись осталась в памяти целиком и не изменилась");
});

test("Ж9 (занятая фазой 1): новая комната, уже получившая поля от старой, не берёт ещё и запись памяти — ровно ОДИН перенос", () => {
  /* O — старая авто-комната «Офис»; N — новая с тем же контуром, фаза 1 отдаёт ей поля O. В памяти лежит
     запись «Склад» с ТЕМ ЖЕ контуром: геометрически она подошла бы N так же. Но N уже занята: без проверки
     «свободна» она получила бы ВТОРОЙ перенос, и оркестратор (применяет переносы по очереди, последний
     перетирает) молча заменил бы введённое сейчас «Офис» устаревшим «Склад», а запись сгорела бы из
     памяти впустую. Ожидаем ровно один перенос (от O), запись «Склад» — в памяти нетронутой. */
  const O = rect("O", 0, 0, 200, 100, { name: "Офис", autoPolygon: true });
  const N = rect("N", 0, 0, 200, 100, { name: "Помещение 1", autoPolygon: true });
  const rec = memRect(0, 0, 200, 100, { name: "Склад" });
  const before = JSON.parse(JSON.stringify(rec));
  const res = C.reconcile([O], [N], [rec]);
  assert.deepEqual(res.transfers, [tr("N", "O", { name: "Офис" })], "на N ровно один перенос — от O");
  assert.deepEqual(res.memory, [before], "запись «Склад» не выдана и осталась в памяти");
  /* контроль изоляции: без O та же запись подходит N — значит, в основном сценарии её удерживает именно занятость */
  const alone = C.reconcile([], [N], [rec]);
  assert.deepEqual(alone.transfers, [tr("N", null, { name: "Склад" })], "контроль: свободной N запись «Склад» выдаётся");
  assert.deepEqual(alone.memory, [], "контроль: выданная запись из памяти удалена");
});

/* ==================== В16: ПОПРАВЛЕННАЯ РУКАМИ КОМНАТА — ГЛАВНАЯ (coveredByManual) ====================
   Пересчёт строит авто-комнаты из тех же линий ПОВЕРХ вручную поправленной (autoPolygon===false). Функция
   возвращает только dropIds — какие авто-дубли оркестратор убирает ДО переноса полей/выдачи памяти (чтобы
   дубль не забрал запись из памяти). Полей НЕ переносит: поправленная остаётся СО СВОИМИ (владелец). */
test("В18 (реш. владельца 03.10): дорисованная стена делит поправленную — убираем ТОЛЬКО тело (крупнейшую грань), меньшая остаётся отдельной комнатой", () => {
  /* Поправленная M на всю область [200..820]×[200..400]. Человек вернул стену x=500 — пересчёт делит её
     площадь на две грани: правую (320×200 = 64000, бо́льшая — дубль «тела» M) и левую (300×200 = 60000,
     меньшая). Прежнее В16 убирало ОБЕ, и дорисованная часть пропадала. Теперь (решение (1)) убираем только
     крупнейшую: меньшая грань остаётся на плане новой комнатой (её поля восстановит reconcile — s4b). */
  const M = withPoly("m", [{ x: 200, y: 200 }, { x: 820, y: 200 }, { x: 820, y: 400 }, { x: 200, y: 400 }],
    { name: "Помещение 1", autoPolygon: false });   // поправленная
  const left = withPoly("left", [{ x: 200, y: 200 }, { x: 500, y: 200 }, { x: 500, y: 400 }, { x: 200, y: 400 }],
    { name: "Кухня", lightingScheme: "relay", autoPolygon: true });   // 60000 — меньшая, остаётся
  const right = withPoly("right", [{ x: 500, y: 200 }, { x: 820, y: 200 }, { x: 820, y: 400 }, { x: 500, y: 400 }],
    { name: "Помещение 3", autoPolygon: true });   // 64000 — крупнейшая, убираем как тело M
  const res = C.coveredByManual([M], [left, right], G);
  assert.deepEqual(res.dropIds, ["right"], "убрана только крупнейшая грань (тело поправленной); меньшая остаётся отдельной комнатой");
  assert.equal("fills" in res, false, "полей функция не переносит — поправленная остаётся со своими (владелец)");
});

test("В20 (п.4): растянули поправленную на БО́ЛЬШУЮ соседку — убираем ТЕЛО (грань с точкой сопоставления), а не крупнейшую; соседка остаётся своей комнатой", () => {
  /* Кухню (relay) растянули руками до x=700 — ЗА центр гостиной (660): контур M [200..700]×[200..400],
     точка сопоставления (центроид) = (450,300). Пересборка из линий даёт тело кухни [200..500] (60000) и
     грань гостиной [500..820] (64000) — обе накрыты M (точка внутри, площадь ≤ M, делят её границу). «Тело»
     M — грань с её точкой сопоставления (450,300) → левая [200..500]. Прежнее «убрать КРУПНЕЙШУЮ» убирало бы
     грань гостиной (64000 > 60000): соседка исчезала дублем, теряя имя/схему/цену (ДЕНЬГИ+потеря). Убираем
     левую; грань гостиной остаётся — её поля вернёт carry/reconcile. Мутация «крупнейшая» → dropIds=["gost"]. */
  const M = withPoly("m", [{ x: 200, y: 200 }, { x: 700, y: 200 }, { x: 700, y: 400 }, { x: 200, y: 400 }],
    { name: "Кухня", lightingScheme: "relay", autoPolygon: false });   // поправленная, центроид (450,300)
  const body = withPoly("body", [{ x: 200, y: 200 }, { x: 500, y: 200 }, { x: 500, y: 400 }, { x: 200, y: 400 }],
    { name: "Помещение 1", autoPolygon: true });   // 60000 — тело кухни (содержит её точку сопоставления)
  const gost = withPoly("gost", [{ x: 500, y: 200 }, { x: 820, y: 200 }, { x: 820, y: 400 }, { x: 500, y: 400 }],
    { name: "Гостиная", lightingScheme: "bell", autoPolygon: true });   // 64000 — КРУПНЕЕ тела, но это соседка
  const mc = G.roomMatchPoint(M.polygon);
  assert.equal(G.pointInPolygon(mc.x, mc.y, body.polygon), true, "предпосылка: точка сопоставления кухни лежит в её теле (левой грани)");
  assert.equal(G.pointInPolygon(G.roomMatchPoint(gost.polygon).x, G.roomMatchPoint(gost.polygon).y, M.polygon), true,
    "предпосылка: точка грани гостиной внутри растянутой кухни (она в группе M — иначе тест не про тот край)");
  assert.ok(G.polygonAreaPx(gost.polygon) > G.polygonAreaPx(body.polygon), "предпосылка: соседка КРУПНЕЕ тела (иначе «крупнейшая» совпала бы с телом)");
  const res = C.coveredByManual([M], [body, gost], G);
  assert.deepEqual(res.dropIds, ["body"], "убрано тело кухни; грань гостиной (крупнее, но лишь частично накрыта) остаётся своей комнатой");
});

test("В16 (п.3): маленькая ручная комната ВНУТРИ большой авто — большую НЕ съедать (площадной предохранитель)", () => {
  // ручная [150..250]² (площадь 10 000) целиком внутри авто [0..400]² (160 000); центроид авто (200,200)
  // попадает в ручную — одной точки мало, иначе маленькая поправленная «съест» объемлющую авто-комнату
  const small = withPoly("small", [{ x: 150, y: 150 }, { x: 250, y: 150 }, { x: 250, y: 250 }, { x: 150, y: 250 }],
    { name: "Ниша", autoPolygon: false });
  const big = withPoly("big", [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }],
    { name: "Зал", lightingScheme: "relay", autoPolygon: true });
  assert.equal(G.pointInPolygon(G.roomMatchPoint(big.polygon).x, G.roomMatchPoint(big.polygon).y, small.polygon), true,
    "предпосылка: точка сопоставления большой авто попадает в маленькую ручную");
  const res = C.coveredByManual([small], [big], G);
  assert.deepEqual(res.dropIds, [], "авто крупнее ручной (160000 > 10000·1.02) — это объемлющая, а не дубль; НЕ убирать");
});

test("В16: авто-комната в стороне от поправленной НЕ трогается", () => {
  const M = withPoly("m", [{ x: 200, y: 200 }, { x: 500, y: 200 }, { x: 500, y: 400 }, { x: 200, y: 400 }],
    { name: "Мой кабинет", autoPolygon: false });
  const far = withPoly("far", [{ x: 600, y: 200 }, { x: 900, y: 200 }, { x: 900, y: 400 }, { x: 600, y: 400 }],
    { name: "Кухня", lightingScheme: "relay", autoPolygon: true });
  const res = C.coveredByManual([M], [far], G);
  assert.deepEqual(res.dropIds, [], "точка авто-комнаты вне поправленной — она самостоятельна, не дубль");
});

test("В17 (Н2): комната ВНУТРИ поправленной (границы не делит) НЕ съедается как дубль — остаётся", () => {
  /* Поправленный зал [0..600]×[0..400]; пересчёт строит из тех же линий авто-ДУБЛЬ зала (рёбра общие) И
     вложенный «санузел» [250..350]×[150..250] посреди зала (ни одной общей вершины с границей зала). У
     обоих точка внутри зала и площадь ≤ зала — условия 1–2 пройдены, отсекает ТОЛЬКО условие «делит
     границу». Без него санузел исчезал как дубль (В17 Н2: имя/схема/цена вложенной комнаты терялись). */
  const hall = withPoly("hall", [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 400 }, { x: 0, y: 400 }],
    { name: "Зал", autoPolygon: false });
  const dup = withPoly("dup", [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 400 }, { x: 0, y: 400 }],
    { name: "Помещение 1", autoPolygon: true });
  const bath = withPoly("bath", [{ x: 250, y: 150 }, { x: 350, y: 150 }, { x: 350, y: 250 }, { x: 250, y: 250 }],
    { name: "Помещение 2", lightingScheme: "relay", collection: "Neve Up", autoPolygon: true });
  const bp = G.roomMatchPoint(bath.polygon);
  assert.equal(G.pointInPolygon(bp.x, bp.y, hall.polygon), true, "предпосылка: точка санузла внутри зала (условие 1 пройдено)");
  assert.ok(G.polygonAreaPx(bath.polygon) <= G.polygonAreaPx(hall.polygon) * 1.02, "предпосылка: санузел мал — порог площади пройден (условие 2)");
  const res = C.coveredByManual([hall], [dup, bath], G);
  assert.deepEqual([...res.dropIds].sort(), ["dup"], "убран только дубль зала; вложенный санузел границы зала не делит — оставлен");
});

test("В16 (п.3, порог площади держится): дубль чуть больше поправленной убирается, объемлющая-касающаяся — нет", () => {
  /* Удерживает AREA_COVER_TOL с ОБЕИХ сторон (мутации 0.02→0 и 0.02→0.5 без этого теста зелёные). Обе
     авто-комнаты ДЕЛЯТ границу с поправленной и их точка внутри неё — решает только порог площади. */
  const M = withPoly("m", [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    { name: "Моя", autoPolygon: false });                                  // площадь 10000
  const dup = withPoly("dup", [{ x: 0, y: 0 }, { x: 101, y: 0 }, { x: 101, y: 100 }, { x: 0, y: 100 }],
    { name: "Помещение 1", autoPolygon: true });                           // 10100 = ·1.01 ≤ ·1.02 → дубль, убрать
  const encl = withPoly("encl", [{ x: 0, y: 0 }, { x: 130, y: 0 }, { x: 130, y: 100 }, { x: 0, y: 100 }],
    { name: "Помещение 2", autoPolygon: true });                           // 13000 = ·1.30 > ·1.02 → объемлющая, НЕ убирать
  const dp = G.roomMatchPoint(dup.polygon), ep = G.roomMatchPoint(encl.polygon);
  assert.equal(G.pointInPolygon(dp.x, dp.y, M.polygon), true, "предпосылка: точка дубля внутри поправленной");
  assert.equal(G.pointInPolygon(ep.x, ep.y, M.polygon), true, "предпосылка: точка объемлющей тоже внутри поправленной (решает только площадь)");
  const res = C.coveredByManual([M], [dup, encl], G);
  assert.deepEqual([...res.dropIds].sort(), ["dup"], "дубль ·1.01 убран (порог 2%), объемлющая ·1.30 оставлена");
});
