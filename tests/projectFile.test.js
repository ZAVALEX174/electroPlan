/* ЧИСТЫЕ функции модуля «проект в файл» (js/projectFile.js): формат обёртки, разбор/проверка файла,
   подпись «скачан», имя файла, слияние бланка «своё главнее», слияние шаблонов постов. Решения
   владельца 19.10 (docs/проект-в-файл-разведка-2026-10-19.md).

   МУТАЦИОННАЯ ТАБЛИЦА (сломай код — покраснеет тест):
     build: убрать project:snapshot → краснеет «обёртка несёт снимок … с планом»;
     build: version:VERSION → version:99 → краснеет «обёртка несёт VERSION формата»;
     parse: убрать проверку obj.format!==FORMAT (всегда ok) → краснеет «чужой JSON — отказ»;
     parse: newer: obj.version>VERSION → newer:false → краснеет «файл новее — ok c newer»;
     parse: вернуть project при отсутствии obj.project → краснеет «битый файл — отказ»;
     signature: не удалять s.view → краснеет «подпись не зависит от view»;
     signature: не удалять s.savedAt → краснеет «подпись не зависит от savedAt»;
     signature: вернуть константу → краснеет «разный проект — разная подпись»;
     fileName: убрать replace запрещённых символов → краснеет «имя без запрещённых символов»;
     mergePrefs: снять `if(!isBlank(local))return` (брать из файла всегда) → краснеет «своё главнее»;
     mergePrefs: писать и пустые из файла → краснеет «пустое из файла не навязываем»;
     mergeTemplates: вернуть file при непустых local → краснеет «свои шаблоны главнее».
   Запуск: node --test tests/projectFile.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const EPProjectFile = require("../js/projectFile.js");

/* Снимок-образец: то, что отдаёт projectSnapshot() (с планом-data-URL, постами, видом, terms). */
function sampleSnapshot(over) {
  return Object.assign({
    name: "Проект электроснабжения",
    savedAt: "2026-10-19T10:00:00.000Z",
    devices: [], posts: [{ id: "p1", number: 1 }], rooms: [{ id: "r1" }], walls: [],
    plan: "data:image/png;base64,AAAABBBB", planLabel: "этаж 1",
    view: { panX: 10, panY: 20, scale: 1.5 },
    terms: { workPercent: 18, eurRate: 92.5, displayCurrency: "RUB" },
    docHeader: { project: "Коттедж", number: "EPG-2026-0007", date: "2026-10-19" }
  }, over || {});
}

test("build: обёртка несёт формат, версию, снимок (с планом), бланк и шаблоны", () => {
  const snap = sampleSnapshot();
  const w = EPProjectFile.build(snap, { companyLogo: "data:img" }, [{ id: "t1" }]);
  assert.equal(w.format, "electroplan-project");
  assert.equal(w.version, EPProjectFile.VERSION, "обёртка несёт VERSION формата");
  assert.equal(w.project, snap, "обёртка несёт снимок проекта как есть");
  assert.equal(w.project.plan, "data:image/png;base64,AAAABBBB", "снимок внутри файла сохраняет план");
  assert.deepEqual(w.prefs, { companyLogo: "data:img" });
  assert.deepEqual(w.postTemplates, [{ id: "t1" }]);
  assert.ok(typeof w.savedAt === "string" && w.savedAt.length > 0);
});

test("build: мусорные prefs/шаблоны сводятся к {} и [] (не роняем запись)", () => {
  const w = EPProjectFile.build(sampleSnapshot(), null, "не-массив");
  assert.deepEqual(w.prefs, {});
  assert.deepEqual(w.postTemplates, []);
});

test("parse: правильный файл — ok, newer:false, разложен на project/prefs/postTemplates", () => {
  const w = EPProjectFile.build(sampleSnapshot(), { companyTerms: "Соглашение" }, [{ id: "t1" }]);
  const r = EPProjectFile.parse(JSON.stringify(w));
  assert.equal(r.ok, true);
  assert.equal(r.newer, false, "версия равна текущей — не новее");
  assert.equal(r.project.plan, "data:image/png;base64,AAAABBBB");
  assert.deepEqual(r.prefs, { companyTerms: "Соглашение" });
  assert.deepEqual(r.postTemplates, [{ id: "t1" }]);
});

test("parse: чужой/битый JSON — отказ (ok:false) с сообщением, без исключения", () => {
  assert.equal(EPProjectFile.parse("не json {{{").ok, false, "нечитаемый JSON — отказ");
  assert.equal(EPProjectFile.parse("[]").ok, false, "массив — не проект");
  assert.equal(EPProjectFile.parse(JSON.stringify({ format: "foreign", version: 1, project: {} })).ok, false,
    "чужой format — отказ");
  assert.equal(EPProjectFile.parse(JSON.stringify({ format: "electroplan-project", version: 1 })).ok, false,
    "нет project — битый файл, отказ");
  for (const bad of ["не json", "[]", JSON.stringify({ format: "foreign" })])
    assert.ok(typeof EPProjectFile.parse(bad).error === "string" && EPProjectFile.parse(bad).error.length > 0,
      "у отказа есть понятное сообщение");
});

test("parse: файл более новой версии формата — ok, но newer:true (откроем с предупреждением)", () => {
  const w = EPProjectFile.build(sampleSnapshot(), {}, []);
  w.version = EPProjectFile.VERSION + 1;
  const r = EPProjectFile.parse(JSON.stringify(w));
  assert.equal(r.ok, true, "новее — всё равно открываем");
  assert.equal(r.newer, true, "помечаем новее — вызывающий предупредит");
});

test("signature: не зависит от savedAt и view, но ловит изменение сути проекта", () => {
  const a = sampleSnapshot();
  const sameButNewTime = sampleSnapshot({ savedAt: "2030-01-01T00:00:00.000Z", view: { panX: 999, panY: -1, scale: 3 } });
  assert.equal(EPProjectFile.signature(a), EPProjectFile.signature(sameButNewTime),
    "другой savedAt/view — та же подпись (иначе «не скачан» сразу после скачивания)");
  const changed = sampleSnapshot({ posts: [{ id: "p1", number: 1 }, { id: "p2", number: 2 }] });
  assert.notEqual(EPProjectFile.signature(a), EPProjectFile.signature(changed),
    "добавили пост — подпись изменилась (проект «не скачан»)");
  const planGone = sampleSnapshot({ plan: null });
  assert.notEqual(EPProjectFile.signature(a), EPProjectFile.signature(planGone),
    "изменился план — подпись изменилась");
});

test("fileName: из названия проекта и даты, без запрещённых в Windows символов", () => {
  assert.equal(EPProjectFile.fileName("Коттедж", "EPG-2026-0007", "2026-10-19"), "Коттедж 2026-10-19.electroplan.json");
  assert.equal(EPProjectFile.fileName('a/b:c*d?e"f<g>h|i', "", "2026-10-19"), "abcdefghi 2026-10-19.electroplan.json",
    "запрещённые символы вычищены");
  assert.equal(EPProjectFile.fileName("", "EPG-1", "2026-10-19"), "EPG-1 2026-10-19.electroplan.json",
    "нет названия — берём номер КП");
  assert.equal(EPProjectFile.fileName("", "", ""), "Проект " + new Date().toISOString().slice(0, 10) + ".electroplan.json",
    "пусто всё — «Проект» + сегодня");
  assert.doesNotMatch(EPProjectFile.fileName("имя.", "", "bad-date"), /[\\/:*?"<>|]/, "в любом случае нет запрещённых символов");
});

test("pickPrefs: собирает непустые ключи бланка, пустые опускает", () => {
  const store = { myRequisites: { values: { fio: "Иванов" } }, companyLogo: "data:img", companyTerms: "",
    companySignature: null, companyStamp: {}, offerPresets: [] };
  const picked = EPProjectFile.pickPrefs(k => store[k]);
  assert.deepEqual(picked, { myRequisites: { values: { fio: "Иванов" } }, companyLogo: "data:img" },
    "пустые строка/объект/массив/null не попадают в файл");
});

test("mergePrefs: своё непустое главнее, недостающее берём из файла, пустое из файла не навязываем", () => {
  const file = { myRequisites: { values: { fio: "Из файла" } }, companyLogo: "data:file-logo",
    companyTerms: "Условия из файла", companyStamp: "" };
  const local = { myRequisites: { values: { fio: "Моё" } } };   // своё только myRequisites
  const writes = EPProjectFile.mergePrefs(file, local);
  const asMap = Object.fromEntries(writes);
  assert.ok(!("myRequisites" in asMap), "своё myRequisites осталось — из файла не берём");
  assert.equal(asMap.companyLogo, "data:file-logo", "своего логотипа нет — берём из файла");
  assert.equal(asMap.companyTerms, "Условия из файла", "своих условий нет — берём из файла");
  assert.ok(!("companyStamp" in asMap), "в файле печать пустая — не навязываем");
});

test("mergeTemplates: свои шаблоны есть — оставляем свои; своих нет — берём из файла", () => {
  assert.equal(EPProjectFile.mergeTemplates([{ id: "f1" }], [{ id: "my1" }]), null, "свои есть — писать нечего");
  assert.deepEqual(EPProjectFile.mergeTemplates([{ id: "f1" }], []), [{ id: "f1" }], "своих нет — берём из файла");
  assert.equal(EPProjectFile.mergeTemplates([], []), null, "ни своих, ни в файле — писать нечего");
});
