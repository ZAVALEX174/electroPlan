/* Галка «рассчитать кратно упаковке» (#packMultipleCheck) в шапке, рядом с выгрузкой Excel.
   Решение владельца 22.10: «рядом с кнопкой Excel галочка „рассчитать кратно упаковке“ (по
   умолчанию снята, хранится в проекте)». Включённая заставляет лист «По артикулам» округлять
   количество каждого артикула вверх до целых упаковок (правило — EPPackRound, расчёт — specExcel).

   УСТРОЙСТВО — как у EPProjectSetup/EPProjectFile: attach(ctx) — тонкая связка. Логики округления
   здесь НЕТ (она в js/packRound.js, одна копия на все документы — §7.1); модуль только:
     · отражает настройку проекта (EP_DATA.settings.packMultiple) в самой галке — syncPackMultiple,
       её зовёт restoreProject после загрузки проекта, чтобы экран не разошёлся с проектом;
     · по клику пишет настройку обратно и сохраняет проект (scheduleSave — как у соседних настроек).

   «Хранится в проекте» обеспечивает не этот модуль, а снимок/восстановление (app.js: projectSnapshot
   пишет packMultiple, restoreProject читает). Здесь — только живая галка на экране. Настройка
   отсутствует (новый/старый проект без поля) → !! сводит undefined к false: по умолчанию снята.

   Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports для тестов. */
(() => {
"use strict";

function attach(ctx) {
  const { $, EP_DATA, scheduleSave } = ctx;
  const box = $("packMultipleCheck");

  /* Выставить галку по настройке проекта. Нет узла (не та разметка) → молча выходим: модуль не
     обязан знать, почему галки нет на странице. */
  function syncPackMultiple() {
    if (box) box.checked = !!EP_DATA.settings.packMultiple;
  }

  if (box) {
    /* Клик меняет настройку проекта и сохраняет его — ровно как соседние настройки сделки
       (applyTerms/applyOfferOption → scheduleSave). Отдельного рендера не нужно: на деньги галка
       влияет только в момент выгрузки Excel, панель итогов и КП (К6а) она не трогает. */
    box.onchange = () => {
      EP_DATA.settings.packMultiple = !!box.checked;
      scheduleSave();
    };
  }

  /* Привести галку к текущей настройке сразу при подключении — на случай, если проект уже
     восстановлен к этому моменту (порядок init). restoreProject позовёт syncPackMultiple ещё раз. */
  syncPackMultiple();

  return { syncPackMultiple };
}

const api = { attach };
if (typeof window !== "undefined") window.EPPackMultiple = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
