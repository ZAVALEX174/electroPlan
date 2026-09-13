/* B2b-2 — ОРГАН УПРАВЛЕНИЯ подсветкой поста в конструкторе. Держим ПОВЕДЕНИЕ renderPostBacklight
   (см. §7.1 HANDOFF: связки app.js покрываем поведенчески, а не структурно). Исполняем НАСТОЯЩИЙ
   текст функции из app.js в vm-контексте общего стенда.

   Что сторожим:
     · варианты цвета/напряжения берутся ИЗ КАТАЛОГА (backlightCatalogOptions), не хардкодом —
       иначе строгий матчинг подбора («Зелёная» с ё) молча даёт пустой подбор;
     · у поста НА ПЛАНЕ показан орган (control), у шаблона/нового поста — объяснение вместо него;
     · доступность цвета/напряжения ведёт режим: активны только в «своя подсветка».
   Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

/* Стенд под renderPostBacklight. backlightCatalogOptions СТАБИМ сентинелами: если варианты
   приедут в селекторы — они пришли из каталога, а не из хардкода (мутацию «хардкод» это краснит).
   document.querySelectorAll возвращает переданные кнопки режима (или []). */
function runRender({ editingPlacedId = "p1", backlight = null, modeButtons = [] }) {
  const dom = stand.makeDom({ selects: ["postBacklightColor", "postBacklightVoltage"] });
  const state = { builder: { editingPlacedId, backlight } };
  const ctx = {
    state, $: dom.$, esc: String,
    document: { querySelectorAll: () => modeButtons },
    backlightCatalogOptions: () => ({ colors: ["СЕНТ-ЦВЕТ-А", "СЕНТ-ЦВЕТ-Б"], volts: ["СЕНТ-В-1"] })
  };
  stand.run("renderPostBacklight", ctx)();
  return dom;
}

test("B2b-2-ui-a: цвет и напряжение НАПОЛНЯЮТСЯ из каталога (backlightCatalogOptions)", () => {
  /* Режим «своя подсветка» (draft.enabled) — селекторы обязаны получить сентинелы каталога.
     Мутация, наполняющая их хардкодом, не покажет сентинелов — тест краснеет. */
  const dom = runRender({ backlight: { enabled: true, color: "СЕНТ-ЦВЕТ-Б", voltage: "СЕНТ-В-1" } });
  assert.match(dom.$("postBacklightColor").innerHTML, /СЕНТ-ЦВЕТ-А/,
    "варианты цвета обязаны прийти из backlightCatalogOptions, а не из хардкода");
  assert.match(dom.$("postBacklightColor").innerHTML, /СЕНТ-ЦВЕТ-Б/);
  assert.match(dom.$("postBacklightVoltage").innerHTML, /СЕНТ-В-1/,
    "варианты напряжения обязаны прийти из каталога");
  assert.equal(dom.$("postBacklightColor").value, "СЕНТ-ЦВЕТ-Б",
    "выбранный цвет черновика проставлен в селектор (значение есть среди опций каталога)");
});

test("B2b-2-ui-b: в режиме «своя подсветка» селекторы ДОСТУПНЫ", () => {
  const dom = runRender({ backlight: { enabled: true, color: "СЕНТ-ЦВЕТ-А", voltage: "СЕНТ-В-1" } });
  assert.equal(dom.$("postBacklightColor").disabled, false, "цвет доступен в режиме «своя подсветка»");
  assert.equal(dom.$("postBacklightVoltage").disabled, false, "напряжение доступно в режиме «своя подсветка»");
});

test("B2b-2-ui-c: «как в проекте» и «выключить у поста» гасят цвет/напряжение", () => {
  const project = runRender({ backlight: null });
  assert.equal(project.$("postBacklightColor").disabled, true,
    "«как в проекте» — настройка не своя, селекторы недоступны");
  const off = runRender({ backlight: { enabled: false, color: null, voltage: null } });
  assert.equal(off.$("postBacklightColor").disabled, true,
    "«выключить у поста» — цвет/напряжение не действуют, селекторы недоступны");
});

test("B2b-2-ui-d: у поста НА ПЛАНЕ показан орган, объяснение спрятано", () => {
  const dom = runRender({ editingPlacedId: "p1", backlight: null });
  assert.equal(dom.$("postBacklightControl").hidden, false, "у поста на плане орган управления виден");
  assert.equal(dom.$("postBacklightTemplateNote").hidden, true, "объяснение для шаблона у поста скрыто");
});

test("B2b-2-ui-e: у ШАБЛОНА/нового поста орган скрыт, показано объяснение", () => {
  /* editingPlacedId отсутствует → это шаблон или новый пост: переопределения нет (как у группы
     света). Мутация «показывать орган всегда» открыла бы правку подсветки шаблона — тест краснеет. */
  const dom = runRender({ editingPlacedId: null, backlight: null });
  assert.equal(dom.$("postBacklightControl").hidden, true, "у шаблона орган управления скрыт");
  assert.equal(dom.$("postBacklightTemplateNote").hidden, false, "у шаблона показано объяснение");
});

test("B2b-2-ui-f: активная кнопка режима соответствует черновику", () => {
  /* Кнопка режима, совпавшего с черновиком, получает класс active и aria-checked=true; прочие — нет.
     Проверяем на всех трёх режимах через шим-кнопки. */
  const buttons = () => [
    stand.makeElement({ dataset: { backlight: "project" } }),
    stand.makeElement({ dataset: { backlight: "on" } }),
    stand.makeElement({ dataset: { backlight: "off" } })
  ];
  const check = (backlight, wanted) => {
    const btns = buttons();
    runRender({ backlight, modeButtons: btns });
    const active = btns.filter(b => b.classList.contains("active")).map(b => b.dataset.backlight);
    assert.deepEqual(active, [wanted], `активна ровно кнопка «${wanted}»`);
  };
  check(null, "project");
  check({ enabled: true, color: "СЕНТ-ЦВЕТ-А", voltage: "СЕНТ-В-1" }, "on");
  check({ enabled: false, color: null, voltage: null }, "off");
});
