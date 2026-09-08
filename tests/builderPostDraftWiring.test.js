/* ПОВЕДЕНЧЕСКИЙ регресс СВЯЗКИ черновика конструктора с расчётом проекта:
   builderPostDraft / projectPostsWithBuilder (js/app.js).

   ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ. В семи *Wiring-стендах эти две функции поданы в vm КОНСТАНТНЫМИ
   заглушками (`builderPostDraft:()=>({mechanismIds:[]})`, `projectPostsWithBuilder:()=>[]`):
   они игнорируют аргумент и теряют keyGroups/roomId/wallType/подмену поста. Там это допустимо —
   предмет тех тестов другой, — но НИ ОДИН стенд не держит сами денежные правила черновика, и
   мутация продакшна остаётся зелёной. Здесь исполняются НАСТОЯЩИЕ builderPostDraft /
   projectPostsWithBuilder (вырезаны из app.js общим стендом appStand), а наблюдаемость — через
   НАСТОЯЩИЙ сбор мест управления EPLightingPlan.collect: ровно тот потребитель, ради которого
   правила и написаны (роль механизма зависит от числа мест группы ПО ВСЕМУ ПРОЕКТУ).

   КАКИЕ ПЯТЬ ПРАВИЛ ДЕРЖИМ (каждое — уже случившийся денежный дефект из комментариев app.js):
   1) черновик редактируемого поста ПОДМЕНЯЕТ свой пост (filter по id), а не добавляется — иначе
      его клавиши считаются дважды и группа из двух мест выглядит группой из четырёх;
   2) при открытом ШАБЛОНЕ (нет editingPlacedId) проект возвращается как есть — черновик в расчёт
      не входит (пока окно шаблона открыто, N каждой группы завышался на единицу);
   3) черновик несёт keyGroups из конструктора — иначе перестаёт быть местом управления;
   4) черновик несёт roomId ПОСТА (не null) — иначе теряет комнату (E13);
   5) черновик несёт wallType из конструктора, а не из настроек проекта — состав и цена обязаны
      показывать коробку, которую человек только что выбрал кнопкой.
   Запуск: node --test tests/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const EPBuilderSlots = require("../js/builderSlots.js");
const EPLightingPlan = require("../js/lightingPlan.js");

/* Сбор мест управления НАСТОЯЩИМ EPLightingPlan.collect. Каталог не нужен: подменяем product на
   «любой id — это клавиша серии Neve Up», ровно те зависимости, что collect берёт от app.js
   (product / isKey / seriesOf). Тогда число мест группы = сколько раз группа встретилась в постах,
   а это и есть величина, от которой в classicRole зависит выбор механизма (и цена). */
const COLLECT_DEPS = {
  product: id => ({ id, key: true, series: ["neve up"], name: "key" + id }),
  isKey: item => !!(item && item.key),
  seriesOf: item => item.series
};
const placesOf = posts => EPLightingPlan.collect(posts, COLLECT_DEPS);
const countGroup = (posts, group) => placesOf(posts).filter(p => p.group === group).length;

/* Исполнить НАСТОЯЩИЕ builderWallType (const-стрелка) + builderPostDraft + projectPostsWithBuilder
   из app.js в общем лексическом контексте. Возвращаем сами функции из vm-контекста: декларации
   функций становятся свойствами песочницы, и звать их можно с любым аргументом-накладкой. */
function boot(state, postName) {
  const dom = stand.makeDom();
  dom.$("postName").value = postName == null ? "Пост" : postName;
  const ctx = { state, EPBuilderSlots, $: dom.$, EP_DATA: { settings: { wallType: "solid" } } };
  stand.runNamed(["builderWallType", "builderPostDraft", "projectPostsWithBuilder"], ctx);
  return { builderPostDraft: ctx.builderPostDraft, projectPostsWithBuilder: ctx.projectPostsWithBuilder };
}

/* Пост на плане: id, комната, одна клавиша с группой «Кухня». */
const placedPost = () => ({ id: "p1", number: "1", roomId: "kitchen", mechanismIds: [500], keyGroups: ["Кухня"] });

test("редактируемый пост: черновик ПОДМЕНЯЕТ свой пост в проекте, клавиша не считается дважды", () => {
  /* Конструктор открыт на посте p1 (editingPlacedId), в слотах — та же клавиша группы «Кухня». */
  const state = {
    posts: [placedPost()],
    builder: { editingPlacedId: "p1", wallType: "hollow", slots: [{ id: 500, group: "Кухня" }] }
  };
  const { projectPostsWithBuilder } = boot(state);
  const project = projectPostsWithBuilder(undefined);
  /* Пост p1 должен остаться в проекте РОВНО ОДИН раз (черновик встал на его место). Если мутация
     снимет фильтр по id (concat без filter), p1 окажется дважды и «Кухня» посчитается за 2 места —
     группа из одного места превратится в группу из двух и потянет за собой не тот механизм. */
  assert.equal(project.filter(p => p.id === "p1").length, 1, "пост p1 не должен дублироваться в проекте");
  assert.equal(countGroup(project, "Кухня"), 1, "клавиша группы «Кухня» посчиталась дважды — черновик добавился, а не подменил пост");
});

test("открыт ШАБЛОН (нет editingPlacedId): проект возвращается как есть, черновик в расчёт не входит", () => {
  /* Окно редактирует ШАБЛОН из библиотеки — на плане такого поста нет. В слотах — клавиша чужой
     группы «Ванна», которой в проекте быть не должно. */
  const state = {
    posts: [placedPost()],
    builder: { editingPlacedId: null, wallType: "hollow", slots: [{ id: 600, group: "Ванна" }] }
  };
  const { projectPostsWithBuilder } = boot(state, "Шаблон");
  const project = projectPostsWithBuilder(undefined);
  /* Ранний возврат state.posts — по ссылке; заодно это ловит мутацию, снявшую guard. */
  assert.equal(project, state.posts, "при открытом шаблоне проект обязан вернуться без черновика");
  assert.equal(countGroup(project, "Ванна"), 0, "черновик шаблона просочился в расчёт групп проекта");
});

test("черновик несёт keyGroups из конструктора — остаётся местом управления группы", () => {
  const state = {
    posts: [placedPost()],
    builder: { editingPlacedId: "p1", wallType: "hollow", slots: [{ id: 500, group: "Кухня" }] }
  };
  const { builderPostDraft } = boot(state);
  const draft = builderPostDraft(undefined);
  assert.deepEqual(draft.keyGroups, ["Кухня"], "черновик потерял keyGroups — клавиша перестала быть местом управления");
  /* И это видно расчёту: место черновика попадает в группу «Кухня» с ИМЕНЕМ группы, а не пустым. */
  const place = placesOf([draft]).find(p => p.keyIndex === 0);
  assert.equal(place.group, "Кухня", "место черновика пришло в расчёт без имени группы");
});

test("черновик несёт roomId ПОСТА (комнату), а не null (E13)", () => {
  const state = {
    posts: [placedPost()],
    builder: { editingPlacedId: "p1", wallType: "hollow", slots: [{ id: 500, group: "Кухня" }] }
  };
  const { builderPostDraft } = boot(state);
  const draft = builderPostDraft(undefined);
  assert.equal(draft.roomId, "kitchen", "черновик потерял комнату размещённого поста");
});

test("черновик несёт wallType из КОНСТРУКТОРА, а не из настроек проекта", () => {
  /* В конструкторе выбрана полая коробка (hollow), в настройках проекта — сплошная (solid).
     Состав и цена обязаны показывать выбранную кнопкой коробку. */
  const state = {
    posts: [placedPost()],
    builder: { editingPlacedId: "p1", wallType: "hollow", slots: [{ id: 500, group: "Кухня" }] }
  };
  const { builderPostDraft } = boot(state);
  const draft = builderPostDraft(undefined);
  assert.equal(draft.wallType, "hollow", "wallType черновика подменился настройкой проекта вместо выбора конструктора");
});
