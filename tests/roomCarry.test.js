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
