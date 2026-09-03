/* Автотесты коммита черновика ветки «комната» (EPRoomDraft).
   Запуск без зависимостей и без сборщика:  node --test tests/

   ГЛАВНОЕ, ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ: черновик комнаты (имя/площадь), живущий только в инпутах,
   должен коммититься ПЕРЕД тем, как перерисовка панели заменит innerHTML и молча его сотрёт.
   Но коммит обязан быть НО-ОП, когда коммитить нечего (значения не менялись или комнаты уже
   нет), иначе каждая из ~25 перерисовок тянула бы renderRooms()+persistProject(). Оба условия
   ниже проверяются на фальсификацию (см. мутационную проверку в отчёте). */
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../js/roomDraft.js");

test("коммит при изменении имени", () => {
  const r = D.commit({ name: "Кухня", area: "18,6 м²" }, { name: "Комната 1", area: "18,6 м²" });
  assert.equal(r.commit, true);
  assert.equal(r.name, "Кухня");
  assert.equal(r.area, "18,6 м²");
});

test("коммит при изменении площади", () => {
  const r = D.commit({ name: "Кухня", area: "20 м²" }, { name: "Кухня", area: "18,6 м²" });
  assert.equal(r.commit, true);
  assert.equal(r.area, "20 м²");
});

test("НО-ОП, когда ничего не изменилось — ни renderRooms, ни persistProject", () => {
  const r = D.commit({ name: "Кухня", area: "18,6 м²" }, { name: "Кухня", area: "18,6 м²" });
  assert.equal(r.commit, false);
});

test("НО-ОП при сравнении сырого value с уже нормализованным в комнате (пробелы по краям)", () => {
  /* В комнате лежит уже обрезанное имя (общий commit пишет .trim()), в инпуте — то же имя, но
     пользователь при монтаже видит trimmed value; повторная перерисовка не должна коммитить. */
  const r = D.commit({ name: "  Кухня  ", area: "  18,6 м²  " }, { name: "Кухня", area: "18,6 м²" });
  assert.equal(r.commit, false);
});

test("НО-ОП для удалённой комнаты (room=null) — не воскрешаем и не падаем", () => {
  const r = D.commit({ name: "Кухня", area: "20 м²" }, null);
  assert.equal(r.commit, false);
  assert.equal(r.name, null);
  assert.equal(r.area, null);
});

test("НО-ОП и для room=undefined (комнату не нашли в state.rooms)", () => {
  const r = D.commit({ name: "Кухня", area: "20 м²" }, undefined);
  assert.equal(r.commit, false);
});

test("пустое имя → «Комната» (как при автосохранении поля)", () => {
  const r = D.commit({ name: "   ", area: "12 м²" }, { name: "Кухня", area: "12 м²" });
  assert.equal(r.commit, true);
  assert.equal(r.name, "Комната");
});

test("пустое имя и в комнате уже «Комната» — НО-ОП, а не бесконечный коммит", () => {
  const r = D.commit({ name: "", area: "12 м²" }, { name: "Комната", area: "12 м²" });
  assert.equal(r.commit, false);
});

test("trim обоих полей", () => {
  const r = D.commit({ name: "  Спальня  ", area: "  14 м²  " }, { name: "Кухня", area: "12 м²" });
  assert.equal(r.name, "Спальня");
  assert.equal(r.area, "14 м²");
});

test("площадь принимается любой строкой — валидации формата нет", () => {
  const r = D.commit({ name: "Кухня", area: "примерно двадцать" }, { name: "Кухня", area: "" });
  assert.equal(r.commit, true);
  assert.equal(r.area, "примерно двадцать");
});

test("очистка площади (была, стёрли) — это изменение, коммитим пустую строку", () => {
  const r = D.commit({ name: "Кухня", area: "   " }, { name: "Кухня", area: "18,6 м²" });
  assert.equal(r.commit, true);
  assert.equal(r.area, "");
});

test("свежая комната area:\"\" и пустой инпут — НО-ОП (идемпотентность первого рендера)", () => {
  const r = D.commit({ name: "Комната 1", area: "" }, { name: "Комната 1", area: "" });
  assert.equal(r.commit, false);
});

/* Устойчивость к ОТСУТСТВУЮЩЕМУ полю у комнаты (area/name === undefined). Из приложения такая
   комната не рождается — все точки создания ставят area:"" — но она может прийти из постороннего
   localStorage. Голое сравнение "" !== undefined давало ложный commit → лишние
   renderRooms()+persistProject() без действий человека. Поля комнаты нормализуются как ввод. */
test("НО-ОП для комнаты без поля area (undefined) — пустой инпут ≡ отсутствию площади", () => {
  const r = D.commit({ name: "Кухня", area: "" }, { name: "Кухня" });
  assert.equal(r.commit, false);
});

test("НО-ОП для комнаты без name и без area (пустой инпут) — «Комната» ≡ отсутствию имени", () => {
  const r = D.commit({ name: "", area: "" }, {});
  assert.equal(r.commit, false);
});
