<!-- mapped-at-commit: 4e3d2f40a14af0f90943d89e44ad4c25209628eb -->
<!-- mapped-at: 2026-11-01 -->

# Карта кода ElectroPlan Pro

Навигатор для исполнителей: сначала сюда, потом читать ТОЛЬКО указанные файлы/строки.
Номера строк — фактические на HEAD 5c5939e (ветка redesign). Строка из grep без пометки
«(комм.)» — код; номера в разделе 4 сверены вызовом `Имя(`, но строки внутри больших
комментариев могли просочиться — при правке открывай место и проверяй.

Проект: ванильный JS (без сборщика), `index.html` + `js/*.js` (90 файлов) + `css/styles.css` (833 строки) +
`tools/` (пересборка каталога) + `tests/` (node:test). Заказчик — EPG/ЦентрСвет, продукт — веб-планировщик
электрики. `/local/` — заглушка под Битрикс (`local/components/centrsvet`, `local/modules/centrsvet.electroplan`,
`local/README.md`); `/bitrix/` нет; не индексируется. `api/` (README), `database/schema.sql` — задел под сервер, в рантайме не участвуют.
`vendor/` (dwgdxf, dxf-parser, heic-to, opencv.js, pdfjs) — сторонний код, не индексируется.
`seg-preview/`, `chertez/`, корневые `*.pdf`/`*.jpg` — справочные материалы, не код.

## 1. Запуск и проверка

- Тесты: `npm test` (= `node --test "tests/*.test.js"`). На HEAD: **217 тестовых файлов, 2772 теста, 0 падений, ~12 с**.
- Локальный сервер: `.claude/launch.json` → `python -m http.server --directory . 8420` (конфигурация `electroplan`, порт 8420).
  Для QA-скриншотов tools/qa поднимает свой node-сервер на 8431 (python не выдерживает десятков js).
- Пересборка каталога (нужен `npm install`, devDeps: xlsx, jimp, heic-to):
  `npm run build:catalog | build:attrs | build:discontinued | build:openings | build:faces | build:site-groups`.
- Кэш-бастинг: каждый `<script src="js/x.js?v=ГГГГММДД.N">` в index.html — при правке файла поднимай `?v=` в index.html.
- Тестов app.js: сам app.js в node не грузится; поведенческие тесты вырезают функции app.js/docs.js/postBuilder.js… в vm через `tests/helpers/appStand.js`
  (`stand.run(["имя1","имя2"], ctx)`, `SOURCE_FILES`); комментарии срезает `tests/helpers/stripComments.js`.

## 2. Точка входа — порядок `<script>` в index.html (строки 827–997)

Все модули — IIFE с двойным экспортом: `window.EPXxx = api` и `module.exports = api` (для node-тестов). Порядок важен.
Сам index.html: 999 строк, разметка окон (`#postModal` конструктор поста, `#kpSetupModal`, `#installSheetWindowModal`, `#wallScopeModal`, тосты `#toast`, `#notices`), скрипты в конце.
Тяжёлые вендорные библиотеки (xlsx/SheetJS, pdfjs, opencv, heic-to, dxf) грузятся лениво через `document.createElement("script")`
(floorplanML.js:133, heicImport.js:43, planImport.js:75, priceCheckUi.js:134, roomDetect.js:139).

| # | файл | глобал |
|---|------|--------|
| 827–831 | catalog-vimar.js, catalog-vimar-attrs.js, catalog-vimar-openings.js, catalog-vimar-faces.js, catalog-vimar-discontinued.js | EP_VIMAR_CATALOG, EP_VIMAR_ATTRS, EP_VIMAR_OPENINGS, EP_VIMAR_FACES, EP_VIMAR_DISCONTINUED (сгенерированные) |
| 832 | data.js | EP_DATA (settings, products, categories), DataService |
| 833 | store.js | ProjectStore (ключ `electroplan_current_project`) |
| 834 | config.js | EPConfig |
| 838 | confirmRepeat.js | EPConfirmRepeat |
| 839 | placeDblClick.js | EPPlaceDblClick |
| 840 | seriesMatch.js | EPSeriesMatch |
| 841 | catalog.js | EPCatalog |
| 844 | lightingGroups.js | EPLightingGroups |
| 848 | lightingPlan.js | EPLightingPlan |
| 852 | lightingByRoom.js | EPLightingByRoom |
| 853 | postfit.js | EPPostFit |
| 855 | backlightPick.js | EPBacklightPick |
| 857 | catalogPool.js | EPCatalogPool |
| 859 | thermoSensor.js | EPThermoSensor |
| 860 | posts.js | EPPosts |
| 862 | buttonFrame.js | EPButtonFrame |
| 863 | picker.js | EPPicker |
| 865 | catalogSections.js | EPCatalogSections |
| 866 | builderSlots.js | EPBuilderSlots |
| 867 | offerOptions.js | EPOfferOptions |
| 871 | installSheetOptions.js | EPInstallSheetOptions |
| 875 | installSheetWindow.js | EPInstallSheetWindow |
| 876 | docRequisites.js | EPDocRequisites |
| 877 | estimate.js | EPEstimate |
| 880 | imageFormats.js | EPImageFormats |
| 883 | docImages.js | EPDocImages |
| 886 | heicImport.js | EPHeicImport |
| 887 | offerPdf.js | EPOfferPdf |
| 888 | installSheet.js | EPInstallSheet |
| 889 | supplierSpec.js | EPSupplierSpec |
| 890 | packRound.js | EPPackRound |
| 894 | packTopUp.js | EPPackTopUp |
| 895 | specExcel.js | EPSpecExcel |
| 896 | postImage.js | EPPostImage |
| 897 | explodedView.js | EPExplodedView |
| 898 | planRotate.js | EPPlanRotate |
| 899 | planLabels.js | EPPlanLabels |
| 900 | rates.js | EPRates |
| 901 | geometry.js | EPGeom |
| 902 | drag.js | EPDrag |
| 903 | viewport.js | EPViewport |
| 904 | selection.js | EPSelection |
| 905 | roomsFromLines.js | EPRoomsFromLines |
| 909 | roomOverlap.js | EPRoomOverlap |
| 910 | roomDraft.js | EPRoomDraft |
| 911 | room.js | EPRoom |
| 915 | roomVariants.js | EPRoomVariants |
| 916 | roomWalls.js | EPRoomWalls |
| 917 | roomVariantsUi.js | EPRoomVariantsUi |
| 918 | roomCarry.js | EPRoomCarry |
| 919 | roomAssign.js | EPRoomAssign |
| 920 | planTrace.js | EPPlanTrace |
| 921 | roomSegmentation.js | EPRoomSeg |
| 922 | floorplanML.js | EPFloorplanML |
| 924 | planShrink.js | EPPlanShrink |
| 925 | planImport.js | EPPlanImport |
| 928 | prefs.js | EPPrefs (ключ `ep_prefs`) |
| 931 | framePicker.js | EPFramePicker |
| 935 | mechColor.js | EPMechColor |
| 938 | offerNumber.js | EPOfferNumber |
| 942 | wallScope.js | EPWallScope |
| 943 | postBuilder.js | EPPostBuilder (attach) |
| 944 | rooms.js | EPRooms (attach) |
| 948 | docs.js | EPDocs (attach) |
| 953 | canvasInput.js | EPCanvasInput (attach) |
| 958 | roomDetect.js | EPRoomDetect (attach) |
| 959 | history.js | EPHistory |
| 963 | postCopy.js | EPPostCopy |
| 967 | notices.js | EPNotices |
| 968 | postCopyUi.js | EPPostCopyUi (attach) |
| 969 | projectFile.js | EPProjectFile (attach) |
| 972 | projectSetup.js | EPProjectSetup (attach) |
| 976 | packMultipleUi.js | EPPackMultiple (attach) |
| 979 | postVariant.js | EPPostVariant (attach) |
| 984–987 | priceSheet.js, priceTemplate.js, priceTemplateFile.js, priceCheckUi.js | EPPriceSheet, EPPriceTemplate, EPPriceTemplateFile, EPPriceCheckUi (attach) |
| 988 | planDrop.js | EPPlanDrop (attach) |
| 989 | topbar.js | EPTopbar (attach) |
| 990 | rightPanel.js | EPRightPanel (attach) |
| 993 | canvasBar.js | EPCanvasBar (attach) |
| 996 | leftPanel.js | EPLeftPanel (attach) |
| 997 | app.js | — (последним, оркестратор) |

Паттерн: чистые модули (без DOM/state) получают всё аргументом `deps`; модули с `attach(ctx)` вынесены из app.js (раздел «И1/И2» ОСТАТОК-РАБОТ), получают от app.js
замыкания (`state`, `renderAll`, `product`…) и возвращают функции, которые app.js вызывает (`app.js:4348–4479`).
Правило владельца: новый код интерфейса — в свой модуль `js/<имя>.js`, в app.js только подключение.

## 3. Модуль → назначение (ключевые функции с :строкой)

### 3.1 Оркестратор js/app.js (4482 строки, одна IIFE `(() => {…})()`; монолит state+DOM)

| строки | что |
|--------|-----|
| 1–63 | `state` (tool, scale/pan, devices, posts, rooms, walls, roomLines, builder{…}, worldAngle…), `uid`, `esc` |
| 64–151 | валюта/деньги: `displayCurrency` 69, `displayRate` 74, `moneyShown` 88, `money` 95; каталог-хелперы `product` 99, `byKind` 100, `byKindOff` 104 (снятые), `frameProduct` 108, деструктуризация EPCatalog 112, `mechanismModulesTotal` 115, `frameOptions` 120, обёртки `fitMechanismIds`/`fitMechanismIdsPreserving` 139–140, **шов `spanForFrame` 147** |
| 151–219 | `productPicture` 153, `framePickThumb` 171, `enhancePicker` 202 (EPPicker), `findByExactCode` 214, `toast` 220 |
| 221–286 | обёртки подбора через `EPCatalogPool.pick`: `findBox` 233, `fallbackBox` 235, `supportFound` 241, `findSupport` 242, `resolveSupport` 247, `findBacklight` 252, `findSensor` 257, **`postDeps` 265**, `postCost` 276, `postComposition` 277 |
| 287–374 | `assembledPostSpec` 287 (spec картинки поста: ячейки, слоты 22751, окна), `assembledPostHtml` 374 → EPPostImage |
| 380–481 | `setTool` 380, `updateStatus` 411, `loadProjectIntoUi` 432, `init` 461 |
| 483–651 | шаблоны («Готовые посты») `renderTemplates` 483, `compactIcon` 534, `renderDevices`/`renderPosts` 566–566, `openPostOnDblClick` 574, `renderGroupLinks` 608 |
| 652–728 | стены-хелперы 651–660, площадь комнаты 669–676, курс евро: `applyRateEntry` 680, `refreshRate` 713 |
| 729–891 | масштаб плана (`renderScaleRuler` 729, `addScalePoint` 788), аннотации плана `annotatePlan` 861 |
| 891–1094 | привязка объектов к комнатам: `roomResolveContext` 922, `resolveRoomForPoint` 951, `getRoomForPoint` 1028, `recalculateRoomAssignments` 1053 |
| 1095–1231 | `renderAll` 1095, `applyProjectSettings` 1144, hover-карточка `showHover` 1156 (состав+коробки+цена поста), выделение 1190–1222 |
| 1232–1357 | перенос/удаление: `moveSelectedBy` 1232, `removeEntity` 1287, `deleteSelectedEntity` 1307, `flushRoomDraft` 1324 |
| 1358–1758 | **`renderProperties` 1380** — вся панель свойств (комната: варианты/стены/схема; пост: тип стены, состав, группы света; устройство); `controlPlaceKind` 1745, `isControlPlaceItem` 1747 |
| 1759–2106 | **группы света и смета**: `lightingScheme` 1759, `lightingFor` 1772, `lightingRowsFor` 1846, `lightingRowSummary` 1868, `projectLighting` 1925, `postTotalCost` 1940, `lightingHtml` 1960, `buildEstimate` 1972, `renderSummary` 2020 |
| 2107–2176 | селект схемы электрики 2106, подсветка проекта `backlightCatalogOptions` 2133, `renderProjectBacklight` 2153, `preferOwnFrame` 2176 |
| 2176–2476 | отделка комнаты/мастер: `roomCatalogFilter` 2196, `frameFacingView` 2292, `mechColorDeps` 2315, `openFramePicker` 2335, `renderFramePicker` 2365, `applyFramePicker` 2441 |
| 2476–2541 | `wallScope` 2476 (EPWallScope), **`addPending` 2490** (размещение поста с плана) |
| 2541–2785 | рисование стен/линий разметки 2540–2616, видимость/поворот подложки 2617–2658, `clearPlan` 2700, подтверждение «Очистить» 2723–2763 |
| 2786–3041 | **сохранение**: `projectSnapshot` 2786, `persistProject` 2835, `scheduleSave` 2848, история `captureHistory` 2890, `applyPlanSnapshot` 2957, `undoPlan`/`redoPlan` 3006/3005, `saveProject` 3014, `dropOrphanKeyGroups` 3030 |
| 3041–3161 | **`restoreProject` 3041** — загрузка и миграции старых проектов (см. раздел 6) |
| 3161–3481 | шапка КП `docHeader` 3161, реквизиты 3214–3262, картинки бланка 3290–3341, условия КП 3344, опции КП/пресеты 3358–3442, опции листа монтажника 3444–3453 |
| 3481–3656 | связи групп света между постами `postsForGroupLinks` 3487, перенумерация постов 3571–3650 (`renumberPosts`, подтверждение EPConfirmRepeat) |
| 3656–3836 | автообрисовка `autoTracePlan` 3671, поворот плана 3744–3814, `ensureBacklightSetting` 3816 |
| 3837–3901 | вид холста: `view` 3837, `clientToWorld` 3844, `applyView` 3853, `zoomBy` 3872, `fitToScreen` 3893 |
| 3902–3991 | импорт плана `applyImportedPlan` 3928, `importPlanFile` 3960 |
| 3989–4144 | `clearCanvas` 3989, условия сделки `applyTerms` 4065, скидка `applyItemDiscount` 4085, `applyCurrency` 4117, `applySurcharge` 4133 |
| 4145–4299 | `trapBuilderFocus` 4145 и обработчики событий (клавиши, кнопки шапки) |
| 4302–4482 | `reportFailure` 4302; подключение вынесенных модулей: EPDocs 4339, EPPostBuilder 4360, EPRoomDetect 4384, EPRoomWalls 4393, EPCanvasInput 4404, EPPostVariant 4416, EPPostCopyUi 4426, EPRooms 4436, EPProjectFile 4448, EPProjectSetup 4459, EPPriceCheckUi 4464, EPPackMultiple 4470; `init()` 4472 |

### 3.2 Вынесенные из app.js (attach-модули, DOM+state через ctx)

- `js/postBuilder.js` (1650) — окно поста/конструктор (#postModal). `attach` 35; `openPostBuilder` 293, `builderSignature` 421, `builderPostDraft` 443, `projectPostsWithBuilder` 476,
  `builderCapacity` 491, `builderFilterRoom` 505, `builderInnardsFilter` 527, `renderBuilder` 560, `renderBuilderSlots` 945, `refreshBuilderLighting` 1053,
  `renderBuilderCatalog` 1081, `pickBuilderProduct` 1183, `builderErrorHtml` 1227, `renderBuilderComposition` 1244, `savePostBuilder` 1395, `closePostBuilder` 1501,
  `requestClosePostBuilder` 1519, `installSheetForBuilder` 1533; подбор накладки по умолчанию `pickDefaultFrame` 220, `defaultFrameForRoom` 246, `applyAutoDefaultFrame` 262;
  `resolveMissingFrame` 58 / `resolveMissingMechanism` 94 (пропавший артикул); подсветка/термодатчик в окне `renderPostBacklight` 124, `renderPostThermoSensor` 165.
- `js/docs.js` (777) — сборка документов. `attach` 35; `postPricedItems` 51, `buildPostLayout` 60, `planLabelsSpec` 151, `planBlockHtml` 194, `supplierSpecData` 213,
  `supplierSpecHtml` 301, `buildExplodedSpec` 326, **`buildPostSheet` 439**, `openInstallSheet` 594, `installSheetForProject` 612, **`generateCommercialOffer` 658**, `exportSpecExcel` 731.
- `js/rooms.js` (293) — слой комнат на плане, правка вершин (`attach` 34). `js/roomDetect.js` (465) — «Определить помещения»: линии → грани, ML, сегментация (`attach` 57).
- `js/canvasInput.js` (527) — клики/жесты/панорама/зум (`attach` 52). `js/postCopyUi.js` (129) — Ctrl+C/V постов (`attach` 28).
- `js/postVariant.js` (153) — готовый пост ↔ варианты отделки комнаты: `placementFits` 35, `attach` 45 (`frameForRoomPlacement`).
- `js/projectFile.js` (259) — файл проекта: `build` 50, `parse` 64, `signature` 89, `mergePrefs` 125, `attach` 146 (скачать/открыть/новый). `js/projectSetup.js` (58) — окно «Данные проекта и КП».
- `js/topbar.js` (116) шапка, `js/rightPanel.js` (82) правая панель (`kpLine` 21), `js/leftPanel.js` (122) левая панель (`planStatusText` 22), `js/canvasBar.js` (42) строка под холстом (Орто/Сетка/шаг, F8/F9).
- `js/installSheetWindow.js` (151) — окно состава листа монтажника (`create` 24; ключ prefs `installSheetPresets`). `js/wallScope.js` (63) — промис-модалка «этот пост / все однотипные».
- `js/priceCheckUi.js` (207) — окно «Прайс по шаблону» (`buildReport` 33, `reportHtml` 48, `attach` 71). `js/packMultipleUi.js` (54) — галка «кратно упаковке». `js/planDrop.js` (125) — drag-and-drop файла плана.
- `js/notices.js` (118) — сообщения с крестиком (`buildGroupNameText` 37, `attach` 55). `js/roomWalls.js` (216) — стены комнаты и предупреждение о несовпадении со стеной поста (К4в): `normalizeKinds` 32, `roomWallKinds` 41, `mismatch` 48, `gestureMismatches` 106, `applyWall` 129, `attach` 141.
- `js/roomVariantsUi.js` (367) — вкладки вариантов отделки комнаты в свойствах и селектор в окне поста: `tabsHtml` 115, `builderIndex` 174, `renderBuilderVariantSelect` 208, `applyBuilderVariantChange` 354, `mechColorFieldOptionsHtml` 317.
- `js/history.js` (251) — undo/redo: `PLAN_FIELDS` 32, `planOf` 60, `create` 122, `hotkeyAction` 236.

### 3.3 Чистая доменная логика (без DOM/state)

Каталог и подбор
- `js/catalog.js` (381) — каталог: `mechanismSpan` 65 (ширина в модулях), `productSeries` 74, `productCollections` 85, `productFacingValues` 96, `productStandards` 110, `standardLabel` 129, `facingColorKey` 141,
  `productsForRoom` 181 (отбор накладок/начинки под отделку комнаты), `compatibleMechanisms` 212, `frameSlotCount` 227, `frameSlotOptions` 257, `defaultPostName` 264, `frameOpening` 283, `frameOpenings` 313, `moduleFace` 345, `productImage` 368.
- `js/seriesMatch.js` (81) — единое правило совместимости серий: `matchOne` 41, `seriesCompatible` 47, `matchLevel` 63 (exact/family/…).
- `js/catalogPool.js` (44) — `pick` 30: сначала активные, снятые — запас (Д2). `js/catalogSections.js` (170) — разделы каталога в конструкторе: `keyOf` 68, `build` 108.
- `js/postfit.js` (429) — монтажная коробка и суппорт: `supportRequired` 67, `boxFitsStandard` 72, `selectBox` 89, `findBox` 134, `fallbackBox` 135, `socketBox` 141, `resolveSupport` 284, `findSupport` 362, `backlightVoltage` 391, `findBacklight` 406.
- `js/backlightPick.js` (129) — LED подсветки по типу клавиши: `classify` 72, `accepts` 102, `pick` 110. `js/thermoSensor.js` (131) — автодатчик терморегулятора: `isSensorMechanism` 40, `sensorCodeFor` 54, `sensorsEnabled` 66, `plan` 79, `rowSummary` 110.
- `js/mechColor.js` (113) — цвет механизмов (К12 ч.3): `colorOf` 38 (elementColor‖nameColor‖articleColor), `colorsFor` 52, `visible` 64, `autoValue` 73, `filter` 86, `checkboxLabel` 97, `emptyCatalogText` 105.
- `js/framePicker.js` (124) — шаги мастера отделки: `STEPS` 26, `stepOptions` 42, `stepVisible` 70, `visibleSteps` 73, `autoFill` 100. `js/picker.js` (431) — кастомный выпадающий список с миниатюрами: `filterOptions` 31, `enhance` 72.
- `js/buttonFrame.js` (156) — кнопочные накладки Flat и двойная клавиша 22751 (К12 ч.4): `BUTTON_FRAME_BASES` 33, `isButtonFrame` 51, `buttonsOf` 59, `appliesTo` 66, **`spanIn` 78**, `orderWindows` 91, `faceParts` 110, `cellSlots` 141.

Посты и конструктор
- `js/posts.js` (828) — состав/цена/раскладка поста: `frameAvailability` 26, `mechanismAvailability` 70, `boxCount` 128, `postWallType` 152, `applyProjectWallToPosts` 168, `postTypeKey` 194, `wallTypeTargets` 220,
  `normalizeBacklight` 249, `postBacklight` 276, `backlightPlan` 284, **`postComposition` 317**, **`postCost` 422**, `moduleLayout` 445, `fillSummary` 482, `nextPostNumber` 497, `ensurePostNumbers` 504,
  `placementFields` 533, `templateFrameColor` 577, `templateFitsRoomColor(s)` 591/609, `pickRoomFrame` 626, `fitMechanismIds` 637, `fitMechanismIdsPreserving` 654, `frameLayout` 692, `packAll` 725, **`distributePosts` 756**, `maxFreeSpan` 802, `postModuleGroups` 811.
- `js/builderSlots.js` (253) — слоты окна поста «механизм+группа света»: `slot` 40, `fromPost` 72, `toPost` 89, `tokens` 102, `tokenDeps` 114, `allowedTokens` 137, `pick` 151, `replaceAt` 184, `setGroup` 192, `setCross` 198, `setMech` 203, `reindex` 232, `signature` 244.
- `js/postImage.js` (791) — единая картинка собранного поста: `itemColor` 214, `pickIcon` 226, `faceSprite` 322, `splitOpening` 421, **`buildHtml` 451**, `photoReady` 494, `postWindows` 511, `windowsHoldModules` 547.
- `js/postCopy.js` (307) — копирование постов: `newCrossNumbers` 68, `snapshot` 92, `buildCopies` 124, `copyHotkey` 215, `stripSharedGroupNames` 263. `js/selection.js` (117) — групповое выделение: `toggle` 54, `postsInRect` 105.
- `js/explodedView.js` (435) — взрыв-схема поста для листа монтажника: `layout` 127, `linesNeeded` 271, `buildHtml` 333.

Группы света
- `js/lightingGroups.js` (1108) — ядро: `ROLES` 46, `SCHEMES` 63 (classic/relay/bell), `normalizeGroup` 106, `groupKeyOf` 134, `crossGroupKey` 150, `canonicalSeries` 271, `canonicalOrder` 433, `resolveGroup` 519, `buildRegistry` 540,
  **`classicRole` 652, `relayCount` 665, `roleFor` 676**, `roleOverrideOf` 687, `GAPS` 698, `isSupplyGap` 748, **`plan` 788**.
- `js/lightingPlan.js` (590) — места управления из постов и подбор голого механизма: `collect` 101, `seriesMatch` 168, `resolveMechanism` 263, `resolveReplacement` 363 (замена цельного изделия), `addressKey` 403, `rowsByPost` 420, `postKey` 458, `buildHtml` 468, `planSignature` 580.
- `js/lightingByRoom.js` (270) — расчёт групп по комнатам и слияние: `partitionNorm` 75, `planByRooms` 100, `cacheSignature` 252. `js/room.js` (77) — `roomLightingScheme` 24, `roomCollection` 50, `roomFrameFacing` 65.

Смета и документы
- `js/estimate.js` (964) — единственный источник цены: `billableLighting` 37, `separateLighting` 45, `effectiveMechanismIds` 51, **`postPrice` 61**, `lightingCounts` 74, `renderItem` 93, `vatBreakdown` 154, `round2` 176, `roundShown` 209, `pricedUnit` 279, `shownSum` 302, `specShown` 325,
  **`postPriceShown` 353**, `totalsShown` 398, `vatModeOf` 468, `discountOf` 501, `discountBreakdown` 507, `discountLabel` 533, **`build` 574**, `pricelessNote` 932, `isEmptyProject` 949.
- `js/offerPdf.js` (459) — КП (HTML для печати/PDF): `termsFooterHtml` 62, `signatureBlockHtml` 91, `hasContent` 405, `buildHtml` 451. `js/offerOptions.js` (158) — галочки/пресеты КП: `fields` 5, `normalize` 39, `preset` 62, `itemText` 103, `saveCustomPreset` 143, `assemblyView` 55.
- `js/installSheet.js` (610) — лист монтажника (HTML): `buildFittings` 67, **`cardModuleOrder` 186, `cardFittingOrder` 205**, `buildHtml` 302. `js/installSheetOptions.js` (129) — галочки листа: `fields` 14, `normalize` 43, `preset` 55, `migrate` 83, `saveCustomPreset` 114.
- `js/supplierSpec.js` (393) — сводная «По артикулам» для поставщика: `kindFromCatalog` 114, `collect` 148, `buildHtml` 268. `js/specExcel.js` (562) — .xlsx (два листа) без библиотеки: `sheetXml` 113, `build` 157, `crc32` 422, `workbookBytes` 490, `fileName` 546.
- `js/packRound.js` (33) — `packRound` 19 (вверх до целых упаковок). `js/packTopUp.js` (161) — добор до упаковок: `codeKey` 23, `buildPackMap` 38, `topUpGroups` 62, `splitRows` 106, `topUpColumns` 127, `panelHtml` 147.
- `js/offerNumber.js` (67) — номер КП EPG-ГГГГ-NNNN: `parse` 23, `format` 30, `assign` 46. `js/docRequisites.js` (81) — реквизиты КП: `MY_FIELDS` 16, `CUSTOMER_FIELDS` 24, `shouldPrint` 43, `migrateDocHeader` 61.
- `js/docImages.js` (118) — логотип/подпись/печать: `readHeader` 34, `validateSource` 55, `fitSize` 79, `imgHtml` 100. `js/imageFormats.js` (178) — какие картинки принимаем: `FORMATS` 26, `detectSignature` 90, `recognize` 111, `withMime` 138. `js/heicImport.js` (83) — HEIC→JPEG: `toJpegBlob` 60, `toJpegDataUrl` 68.
- `js/planLabels.js` (460) — план с бирками номеров постов для печати: `groupChains` 121, `layout` 154, `buildHtml` 329. `js/rates.js` (91) — курс ЦБ: `loadCached` 20, `fetchFresh` 34, `manual` 50, `effectiveRate` 64, `startupRate` 80 (ключ `ep_eur_rate`).
- Прайс по шаблону (К9): `js/priceSheet.js` (126) разбор листа (`parsePrice` 25, `chooseSheet` 109, `isHermeticCover` 99); `js/priceTemplate.js` (348) шаблон и проверка (`COLUMNS` 82, `check` 191); `js/priceTemplateFile.js` (136) Excel-шаблон (`build` 100).

Геометрия, план, комнаты
- `js/geometry.js` (537) — полигоны/сетка: `polygonCentroid` 12, `roomLabelPoint` 142, `polygonAreaPx` 231, `pointInPolygon` 239, `tightestRoomAtPoint` 258, `snapPlanPoint` 378, `buildSpaceComponents` 399, `roomContourProbe` 480. `js/viewport.js` (175) — экран↔мир: `worldToScreen` 23, `zoomAt` 51, `rotateAt` 68, `fitView` 108.
- `js/roomsFromLines.js` (398) — помещения из линий разметки: `healEndpointGaps` 52, `buildPlanarGraph` 117, `findFaces` 160, `roomsFromLines` 345. `js/roomOverlap.js` (328) — обрезка наложения контуров: `overlapArea` 86, `clipRoomsAgainst` 172, `clampVertexMove` 252. `js/roomSegmentation.js` (296) и `js/floorplanML.js` (582, YOLOv8 в браузере) — распознавание (базовый и ML).
- `js/roomCarry.js` (429) — перенос полей комнаты при пересчёте: `isAutoName` 83, `carry` 174, `reconcile` 256. `js/roomVariants.js` (147) — варианты отделки комнаты (до 5): `FIELDS` 31, `list` 62, `serialize` 80, `addVariant` 90, `setVariantField` 112, `fitIndex` 127, `placementIndex` 137. `js/roomAssign.js` (25), `js/roomDraft.js` (67).
- `js/planImport.js` (474) импорт PDF/растра/DXF/SVG (`importFile` 439); `js/planShrink.js` (85) уменьшение растра под localStorage (`decide` 69); `js/planRotate.js` (98); `js/planTrace.js` (146) автообрисовка стен; `js/drag.js` (43); `js/config.js` (72) «магические числа» EPConfig; `js/placeDblClick.js` (55); `js/confirmRepeat.js` (144) — `press` 94 (повтор-подтверждение, окно MIN_MS/ARM_MS); `js/prefs.js` (43) — `get`/`set` 23/28 (ключ `ep_prefs`).

### 3.4 Сгенерированные данные (не читать целиком, не править)

- `js/catalog-vimar.js` (6 строк, одна JSON-строка) — `EP_VIMAR_CATALOG {meta, products[2868]}`: kind mechanism 1046 / frame 1627 / accessory 113 / support 57 / socket_box 25. Генерирует `tools/build-catalog.mjs` (`npm run build:catalog`) из «Номенклатура 2026-10-10.xls» + прайса VIMAR.
- `js/catalog-vimar-attrs.js` (25187 строк) — `EP_VIMAR_ATTRS` {standards, supports, wallTypes, boxes, mounting, roles, groups, colors, nameColors, articleColors, sensors, packs}. `tools/build-catalog-attrs.mjs`.
- `js/catalog-vimar-openings.js` (734) — монтажные окна накладок по базе артикула (rects в %). `tools/detect-openings.mjs` (jimp по фото VIMAR).
- `js/catalog-vimar-faces.js` (2320) — лицевой прямоугольник механизмов по полному артикулу. `tools/detect-faces.mjs`.
- `js/catalog-vimar-discontinued.js` (6) — снятые с производства позиции прежнего каталога (active=false). `tools/build-discontinued.mjs` из снимка `tools/data/discontinued-732ae3a.json`.
- `js/data.js` (337) — `EP_DATA.settings` (дефолты проекта: workPercent 18, materialsPercent 7, vatPercent 20, rateSurchargePercent 3, lightingScheme, backlight, …),
  `EP_DATA.products` = `enrichCatalog()` (стр. ~63–290: домешивает attrs/openings/faces/discontinued к товарам), `DataService` 256 (mock; шаблоны постов в `ep_post_templates`).

## 4. Одно правило → все потребители

Формат: **правило** — определено `файл:строка`; потребители `файл:строка` — что делает. «ДУБЛЬ» — правило продублировано вместо вызова общей функции.
Обёртки в app.js (`postComposition` 276, `postCost` 275 и др.) передаются в docs.js/postBuilder.js/postVariant.js через ctx (`app.js:4348–4439`), поэтому в этих файлах видны как локальные имена.

### R1. Состав поста: накладка + суппорт + коробки + число коробок (`boxCount`) — `EPPosts.postComposition` posts.js:317 (`boxCount` posts.js:128, зовётся только из posts.js:324)
Единственная воронка: app.js:265 `postDeps` собирает deps (product, findBox, fallbackBox, resolveSupport, supportRequired, socketBox, backlight/sensor-планы) → posts.js:317.
Прямые вызовы `postComposition(`: app.js:1161 (hover-карточка), app.js:1463 (карточка поста в панели свойств), docs.js:66 (`postPricedItems`), docs.js:226 (`supplierSpecData`), docs.js:444 (`buildPostSheet`), estimate.js:636 (через deps), postBuilder.js:1275 (панель «Состав поста»), posts.js:423 (`postCost`).
Число коробок `comp.boxCount` читают: app.js:1164, 1479; docs.js:101, 270, 419–422; estimate.js:637; installSheet.js:153 (`buildFittings`); postBuilder.js:1308–1316; supplierSpec.js:206 (`po.boxCount` из docs.js:270).
Подбор коробки/суппорта: postfit.js:89/134/135 (коробка), 284/362 (суппорт) ← только через app.js:233–248 (`EPCatalogPool.pick`: активные главнее снятых) ← posts.js:331, 337, 351–355, 426. `socketBox` ещё: postBuilder.js:1411 (пишет `socketBoxProductId`).
Потребителей, считающих коробки мимо `postComposition`, не найдено.

### R2. Цена поста — `EPEstimate.postPrice` estimate.js:61 (= базовая `EPPosts.postCost` posts.js:422 + механизмы групп света)
- Показ цены поста в UI/документах идёт через `postTotalCost` app.js:1940 → `EPEstimate.postPriceShown` estimate.js:353 (единственный вызов app.js:1943). Потребители `postTotalCost`: app.js:1408 (сумма выделения), 1488 (панель свойств), docs.js:107 (`postPricedItems`), docs.js:591 (лист монтажника), postBuilder.js:1359 («Стоимость поста»).
- В смете: estimate.js:843 `postPrice(postCost(...effIds...), allLightRows)` (внутри `build` 574). `postCost` как дep: app.js:1976, docs.js:53.
- Тесты-стражи: tests/postPriceConsumers.test.js, postPriceShownInvariant.test.js, docsMoneyCoverage.test.js.
- Механизмы групп света в цене: `effectiveMechanismIds` estimate.js:51 (замена цельного изделия 09001→09005) — app.js:302, docs.js:70, 243, estimate.js:635; `separateLighting` 45 / `billableLighting` 37 — docs.js:244, 549, estimate.js:60, 78, 310, 713.
- Деньги в валюте показа: `roundShown` estimate.js:209 / `shownSum` 302 / `specShown` 325 / `totalsShown` 398 — app.js:93, 1873–1874, 2027, 3596; курс — `displayRate` app.js:74.

### R3. Расчёт групп света проекта — `lightingFor` app.js:1772 → `EPLightingPlan.collect` lightingPlan.js:101 → `EPLightingByRoom.planByRooms` lightingByRoom.js:100 → `EPLightingGroups.plan` lightingGroups.js:788
- `lightingFor(` зовут: app.js:1931 (`projectLighting` 1924, кэш по `cacheSignature`, app.js:1921/1926), app.js:3609 (превью перенумерации), postBuilder.js:723, 874, 1056, 1560 (окно поста — проект ПЛЮС редактируемый черновик, `projectPostsWithBuilder` 476).
- `projectLighting(` зовут: app.js:301, 1407, 1462, 1941, 1973, 2021, 3608; docs.js:64, 620, 662, 732.
- `lightingRowsFor(` (строки групп света одного поста + номер модуля через `moduleLayout`): app.js:1464, 1943, 1979; docs.js:54, 70, 242, 483; postBuilder.js:731, 886, 1058, 1331.
- `lightingHtml(` (блок «Группы света»): app.js:2072; docs.js:630, 688; postBuilder.js:1356, 1567. `buildEstimate(` app.js:1972 ← app.js:2022, docs.js:663, 733 (+ docs.js:52 вызывает `EPEstimate.build` напрямую для одного поста).
- Смета читает строки групп света: estimate.js:25/72/308/584 (`rowsByPost`), печать плана: EPLightingPlan.buildHtml ← app.js:1958/1961, estimate.js:712, installSheet.js:265, offerPdf.js:129.
- Ключ места: `EPLightingPlan.postKey` lightingPlan.js:458 ← app.js:1848. Пробелы `isSupplyGap` lightingGroups.js:748 ← docs.js:235, 245, 543, 549.
- `EPLightingGroups.SCHEMES` читают app.js:1532–1542, 1761, 1823–1827, 1930, 2091–2113.

### R4. Механизм клавиши по числу мест управления (выключатель / 2 переключателя / инверторы; реле/звонок = кнопка) — `roleFor` lightingGroups.js:676 (`classicRole` 652, `relayRole` 660, `relayCount` 665)
- Вызывается ТОЛЬКО внутри `plan` lightingGroups.js:788 (место = ПОСТ, не клавиша: `buildRegistry` 540; порядок мест — `canonicalOrder` 433).
- Ручная переопределялка роли (вариант C): `roleOverrideOf` lightingGroups.js:687 ← app.js:1366 (запись в свойствах), postBuilder.js:1040 (селектор в слоте, `mechOverrideOptions` 1043). Выбранное руками главнее расчёта.
- Подбор самого изделия под роль и серию: `resolveMechanism` lightingPlan.js:263 ← app.js:1776, 1808 (через `EPCatalogPool.pick`); замена цельного изделия `resolveReplacement` lightingPlan.js:363 ← app.js:1801, catalogSections.js:164.
- Классификация «клавиша ли это» (`controlPlaceKind` app.js:1745 по partRole/controlRole) ← `keySlotKind` app.js:1755 (передаётся в EPBuilderSlots), app.js:1773 (`collect`).
- Группа клавиши (строка, не число!): `normalizeGroup` lightingGroups.js:106 ← app.js:1364–1365, 3506, 3509; builderSlots.js:27; `groupKeyOf` 134 ← app.js:3512, planLabels.js:43, postCopy.js:256, postCopyUi.js:100; `crossGroupKey` 150 ← app.js:3497, 3505, postCopy.js:47, 116, postCopyUi.js:74, 100; `resolveGroup` 519 ← app.js:3493, builderSlots.js:61, postCopy.js:244.
- Схема электрики комнаты: `EPRoom.roomLightingScheme` room.js:24 ← app.js:1530, 1538, 1826–1827, 1930; lightingByRoom.js:243; roomCarry.js:102.
- ДУБЛЬ (осознанный): lightingPlan.js:41 `groupKey` — встроенный фолбэк копии `EPCatalogSections.keyOf` (для запуска модуля в изоляции); основной путь зовёт `keyOf`.

### R5. Ширина механизма в накладке (шов) — `EPButtonFrame.spanIn` buttonFrame.js:78. С 5c5939e (К12 ч.4, заказчик 15.10 0:21:33) правило ТОЖДЕСТВЕННО: клавиша 22751 = ОДНА прорезь, spanIn возвращает обычную ширину; шов оставлен, чтобы будущая правка была в одном месте. Нетривиальное осталось только в картинке: `cellSlots` — одна верхняя кнопка лица на прорезь (`appliesTo` 66, `isButtonFrame` 51, `cellSlots` 141, `orderWindows` 91; базы накладок `BUTTON_FRAME_BASES` 33: 22682.1/.2, 22683.1/.2/.3, 22684.4)
Единый шов: **`spanForFrame(frame)(item)` app.js:147** (обёртка над spanIn + голый `mechanismSpan` catalog.js:65). Через шов считают: app.js:309 (`assembledPostSpec`; потом distributePosts app.js:315), app.js:1852 (`lightingRowsFor`), docs.js:459 (`buildPostSheet`), postBuilder.js:775 (ёмкость окна), 1122 (карточки каталога), 1215 (добавление механизма), 1401 (`savePostBuilder` → distributePosts), postVariant.js:131 (подмена накладки).
Прямые вызовы EPButtonFrame: app.js:314 (appliesTo), 345 (`cellSlots`), 369 (`orderWindows`), postBuilder.js:1236 (`isButtonFrame` — текст переполнения). Картинка читает `cell.slots`: postImage.js:523, 558.
МИМО шва (на «голом» `mechanismSpan`): app.js:265 `postDeps` — по решению владельца (цена/число мест не меняются); app.js:115 `mechanismModulesTotal` (← app.js:515, postBuilder.js:328); app.js:139–140 `fitMechanismIds(Preserving)`; postBuilder.js:833 `fitDeps` (`tokenDeps(slots,{product,mechanismSpan})`) — пока spanIn тождественен, расхождения нет; если правило снова станет нетривиальным — это края.
ДУБЛЬ: выражение-страховка `(typeof spanForFrame==="function"?spanForFrame:(()=>mechanismSpan))(frame)` повторено 8 раз (app.js:309, 1852; docs.js:459; postBuilder.js:775, 1122, 1215, 1401; postVariant.js:131).
Тесты: buttonFrame, buttonFrameCapacity, buttonFrameBuilderWiring, buttonFrameImage.

### R6. Раскладка механизмов по постам/импостам и порядок модулей — `distributePosts` posts.js:756 / `moduleLayout` posts.js:445 / `fitMechanismIds` posts.js:637 / `maxFreeSpan` 802 / `postModuleGroups` 811
- `distributePosts(`: app.js:315; postBuilder.js:852, 1401; postVariant.js:132; posts.js:812 (`postModuleGroups`).
- `moduleLayout(`: app.js:1853; docs.js:460; postBuilder.js:725, 843, 885; posts.js:815.
- `fitMechanismIds`: postBuilder.js:834; `fitMechanismIdsPreserving`: postBuilder.js:1205; `maxFreeSpan`: postBuilder.js:869; `postModuleGroups`: docs.js:463.
- Слоты «механизм+группа» вместо параллельных массивов: EPBuilderSlots — потребители postBuilder.js (tokens 834/852/1205, toPost 168/444/720/843/867/1274/1399/1407/1541, fromPost 359–360/1384), app.js:1352/1358/3020/3033 (fromPost/toPost), docs.js:461–463.

### R7. Порядок модулей/обвязки в карточке листа монтажника — `EPInstallSheet.cardModuleOrder` installSheet.js:186, `cardFittingOrder` 205
Вызовы: docs.js:529 (порядок карточки → раскладка/взрыв-схема), installSheet.js:208 (внутри `cardFittingOrder`), installSheet.js:419 (строки обвязки таблицы). Обвязка `buildFittings` installSheet.js:67 ← docs.js:548.
Тест: installSheet.test.js, assemblyView.test.js.

### R8. Подтверждение необратимой команды повтором — `EPConfirmRepeat.press` confirmRepeat.js:94
Вызовы: app.js:2739, 2748 (очистить план), 3624, 3635 (перенумерация постов), postBuilder.js:1521 (закрыть окно поста с правками, `ESC_CONFIRM_MS`). Тесты: confirmRepeat, clearPlanConfirm, closePostBuilderWiring.

### R9. Подсветка клавиш — `EPBacklightPick.pick` backlightPick.js:110 (`accepts` 102, `classify` 72); действующая настройка поста — `EPPosts.postBacklight` posts.js:276 (своя у поста, иначе проектная) → `backlightPlan` posts.js:284
- `pick`: app.js:250–252 (`findBacklight`, `EPCatalogPool.pick`), posts.js:235. `accepts`: app.js:269, posts.js:290. Результат уходит в `comp.backlight` (posts.js:398) → смета estimate.js:717, docs.js:74–83, UI app.js:1874–1925.
- Не через воронку posts: `EPPostFit.findBacklight` postfit.js:406 / `backlightVoltage` 391 / `acceptsBacklight` 400 — внешних вызовов не найдено (проверять, жив ли код).
- Настройка проекта: `ensureBacklightSetting` app.js:3816; запись у поста postBuilder.js:1447.

### R10. Автодатчик терморегулятора — `EPThermoSensor.plan` thermoSensor.js:79; включён ли у поста — `sensorsEnabled` 66
`plan(`: app.js:270, 275 (deps `sensorPlan`), posts.js:400. `sensorsEnabled`: app.js:272, 275, posts.js:406, 557, postBuilder.js:383. `rowSummary` (строка в UI): app.js:1170, 1174, 1468, 1471; postBuilder.js:1346, 1349. `sensorCodeFor`/`isSensorMechanism`: postBuilder.js:162–169, 788–795. Подбор датчика `findSensor` app.js:257.

### R11. Цвет механизмов комнаты (К12 ч.3) — `EPMechColor` mechColor.js (`colorOf` 38, `colorsFor` 52, `visible` 64, `autoValue` 73, `filter` 86, `checkboxLabel` 97, `emptyCatalogText` 105)
app.js:1710, 2319, 2326, 2432 (`autoValue`/`visible`/`colorsFor`), app.js:2315 (`mechColorDeps`); postBuilder.js:795 (`filter` — начинка под цвет комнаты), 801 (`checkboxLabel`), 1111 (`emptyCatalogText`); roomVariantsUi.js:298, 305–317 (`mechColorValue/Visible/FieldOptionsHtml`).
ДУБЛЬ: функция `match:(m,c)=>…compatibleMechanisms({series:[c.collection]},m)` написана дважды — app.js:2315 и roomVariantsUi.js:298.
В смету цвет из названия/артикула НЕ идёт: автозамена читает `item.elementColor` (app.js:1790 `colorKeyOf` через `EPCatalog.facingColorKey` catalog.js:141).

### R12. Отделка комнаты → отбор накладок и начинки — `EPCatalog.productsForRoom` catalog.js:181 + критерий `roomCatalogFilter` app.js:2196 + чтение полей `EPRoom.roomFrameFacing` room.js:65 / `roomCollection` 50
- `productsForRoom(`: app.js:2177, 2273, 2286, 2306; postBuilder.js:247, 558, 791; postVariant.js:37, 40, 138; roomVariantsUi.js:236, 280, 335. `roomCatalogFilter(`: app.js:1621; postBuilder.js:247, 512, 1383; postVariant.js:121, 138, 143.
- `roomFrameFacing(`: app.js:489–498, 1545, 1559, 2185–2205, 2344–2349; catalog.js:175; postBuilder.js:531, 796; posts.js:600; roomCarry.js:130. `roomCollection(`: app.js:1559, 2202, 2346; catalog.js:166; roomCarry.js:114; roomVariants.js:15, 125; roomVariantsUi.js:231.
- Варианты отделки (до 5): `EPRoomVariants.list` roomVariants.js:62 ← app.js:498, 1552, 1706, 2341, 2448; postBuilder.js:509, 1383; postVariant.js:118. `fitIndex` 127 ← postVariant.js:122 (`placementIndex` 137 — внешних вызовов в js/ нет, только тесты).
- Совместимость накладка↔начинка: `compatibleMechanisms` catalog.js:212 ← postBuilder.js:100, 785, 819; postVariant.js:65; app.js:2315; roomVariantsUi.js:298. Выбор «своей» накладки: `preferOwnFrame` app.js:2176 ← postBuilder.js:249, postVariant.js:139.
- Накладка по умолчанию для поста: `pickDefaultFrame` postBuilder.js:220, `defaultFrameForRoom` 246, `EPPosts.pickRoomFrame` posts.js:626, `templateFitsRoomColors` posts.js:609 ← app.js:500.

### R13. Совместимость серий — `EPSeriesMatch.seriesCompatible` seriesMatch.js:47 / `matchLevel` 63
catalog.js:217 (`compatibleMechanisms`), lightingPlan.js:169 (обёртка `seriesMatch`), 288, 309 (`matchLevel === "exact"`), postfit.js:305 (суппорт).

### R14. Тип стены поста — `EPPosts.postWallType` posts.js:152 (проектный фолбэк `applyProjectWallToPosts` 168; охват правки `wallTypeTargets` 220, ключ однотипности `postTypeKey` 194)
`postWallType(`: app.js:1476, 1501; postBuilder.js:365, 1426; roomWalls.js:156, 165. `wallTypeTargets(`: app.js:1503, 1508; postBuilder.js:1432, 1443. `applyProjectWallToPosts`: app.js:3057 (миграция). Несовпадение со стеной комнаты: roomWalls.js:48 `mismatch`, `warnWallMismatch` app.js:4402. Модалка охвата: wallScope.js + app.js:2476.

### R15. Пул «активные, потом снятые» — `EPCatalogPool.pick` catalogPool.js:30
app.js:233, 235, 242, 247, 252, 257, 1808. Источники: `byKind` app.js:100 (active) / `byKindOff` 104 (active===false).

### R16. Кратно упаковке — `EPPackRound.packRound` packRound.js:19; карта упаковок `EPPackTopUp.buildPackMap` packTopUp.js:38
`packRound(`: packTopUp.js:86, specExcel.js:330, supplierSpec.js:291. `buildPackMap(`: app.js:1984, docs.js:306, 745. Добор: `splitRows`/`panelHtml` app.js:2063, 2068; `topUpGroups` (estimate.js ленивый вызов, docs.js). Поле `packQty` ставит data.js.

### R17. Настройки документов — `EPOfferOptions.normalize` offerOptions.js:39; `EPInstallSheetOptions.normalize/migrate` installSheetOptions.js:43/83
`EPOfferOptions.normalize(`: app.js:2813, 3126, 3369, 3403, 3416, 3430; docs.js:659, 740. `EPInstallSheetOptions`: app.js:2819, 3135, 3446, 3448; docs.js:604. Номер КП `EPOfferNumber.assign` offerNumber.js:46 ← docs.js:706 (единственный).
Картинки бланка: `EPDocImages.validateSource/readHeader/fitSize` ← app.js:3304, 3318–3319; `EPImageFormats.withMime` ← app.js:3324; HEIC → app.js:3321; формат-проверка плана в planImport.js (через imageFormats).

### R18. Документы из данных проекта (кто собирает КП/лист/Excel/сводную)
`EPOfferPdf.buildHtml` ← docs.js:717; `EPInstallSheet.buildHtml` ← docs.js:605; `EPSupplierSpec.buildHtml` ← docs.js:302, `collect` ← docs.js:722/734; `EPSpecExcel.build` ← docs.js:746; `EPExplodedView.buildHtml` ← docs.js:581; `EPPostImage.buildHtml` ← app.js:374, docs.js:574/576; `EPPlanLabels.buildHtml` ← docs.js:197. Все документы получают смету/состав из R1–R3, а не считают сами.


### R19. Удаление ОДНОЙ точки контура комнаты (К13 ч.1, решение владельца 01.11) — `deleteVertex` rooms.js:214 (проверки ≤3 вершин и `EPRoomOverlap.overlapGrew`, splice, markRoomEdited, refreshRoomAfterEdit)
Вызовы: Alt+pointerdown ручки в `renderVertexHandles` (rooms.js ~290), `tryDeleteSelectedVertex` rooms.js:258 (Delete). Выделенная точка — `selectedVertex` {roomId,index,count} rooms.js:47, `vertexSelectionValid` 53 (сброс в начале renderRooms 61, если сменились комната/инструмент/число вершин), `selectVertex` ~242, подсветка при перерисовке ~300, `h.onclick` ~317 гасит всплытие клика к canvasScroll.onclick (canvasInput.js ~419, иначе перевыбор комнаты сбрасывал выделение) — кроме state.pending (В11).
Delete: app.js:4260 — `e.repeat` игнор; `tryDeleteSelectedVertex()` в режиме vertex ВСЕГДА true (комнату Delete в «Правке комнат» не удаляет никогда), вне — false → deleteSelectedEntity app.js:1307.
Тесты: roomVertexDeleteKey (стаб refreshAfterRoomAssignments перерисовывает, как app.js:1075–1077), roomVertexEdit, roomVertexEditGuard; стенды renderRooms требуют vertexSelectionValid+selectedVertex: + roomOverlapShow, roomLabelPlacePending, placementAnyTool.

## 5. Данные каталога

- Источники (в `..` = `D:\LuxarGROUP\myProgects\electro`): `Номенклатура 2026-10-10.xls` (состав+атрибуты, читает `tools/lib/nomenclature2026.mjs`), `Номенклатура новая.xls`, `Прайс VIMAR Евро 01.07.26 (2) (2).xls` (цены). Руками не править.
- Сборка: `tools/build-catalog.mjs` → catalog-vimar.js; `build-catalog-attrs.mjs` → attrs; `build-discontinued.mjs` + `make-discontinued-snapshot.mjs` → discontinued; `detect-openings.mjs`/`detect-faces.mjs` → openings/faces (по фото VIMAR, jimp); `analyze-price.mjs`, `discover-candidates.mjs`, `fetch-site-groups.mjs` — разведка/отчёты. Описание — `tools/README.md`.
- `tools/lib/`: nomenclature.mjs (общая классификация), nomenclature2026.mjs (чтение xls), classify.mjs (categoryId/icon по названию), stable-ids.mjs (id по артикулу из `data/catalog-ids.json`, новые 200000+), discontinued.mjs, faces.mjs, mountNote.mjs, backlightInherit.mjs, elementColorFromName/Article.mjs, site-groups.mjs.
- `tools/data/`: catalog-ids.json (стабильные id), discontinued-732ae3a.json, box-wall-type.json, frame-facing-overrides.json, frame-standard-overrides.json, kind-overrides.json, image-overrides.json, price-columns.json, compat-*.json, site-groups.json.
- Поля товара (после `enrichCatalog` data.js) и кто читает (файлы js/):
  - `kind` (mechanism/frame/socket_box/support/accessory), `active` (false = снятый) — app.js (`byKind`), catalog.js, posts.js, postfit.js.
  - `moduleSpan`/`modules`/`moduleCount` → `EPCatalog.mechanismSpan` catalog.js:65 (иначе парсит «N модуля» из названия), lightingPlan.js (`moduleSpanOf`).
  - `slotCount` (накладка: число модулей) → `frameSlotCount` catalog.js:227, buttonFrame.js, posts.js.
  - `series[]` → `productSeries` (catalog.js, seriesMatch, lightingPlan, postfit). `standard` (IT/DE/BOTH) — catalog.js, postfit.js, posts.js, postBuilder.js, roomVariants*.
  - `wallType` (solid/hollow), `boxShape`, `boxModules`, `boxStandards`, `boxModularity`, `principle` — postfit.js, posts.js, estimate.js, roomWalls.js; `postCount`, `pitchMm` (суппорты).
  - Отделка накладки: `frameColor`, `frameMaterial`, `frameShape` — catalog.js (`productFacingValues`), postBuilder.js, postVariant.js, roomCarry.js, roomDetect.js. Цвет начинки: `elementColor` (столбец), `nameColor`, `articleColor` — mechColor.js:38, lightingPlan.js, catalog.js.
  - Роли: `partRole` (bare_mechanism|key), `controlRole` (switch|…), `functionalGroup`/`functionalSubgroup` (разделы выбора) — app.js:1745, catalogSections.js, lightingPlan.js, thermoSensor.js.
  - Картинки: `imageUrl`, `previewImageUrl`; измерения: `mountRect(s)` (окна накладки) и `faceRect` (лицо механизма) — catalog.js (`frameOpening(s)`, `moduleFace`), postImage.js. `layoutRows` — catalog.js, posts.js (`frameLayout`).
  - `packQty` → packTopUp.js; `thermoSensorCode` → thermoSensor.js; `price` в EUR (база), `currency`.
- Правила (память владельца): BYME/KNX не трогаем; «По запросу» вместо пустой цены; курс = ЦБ РФ + 3% (надбавка отдельно: `rateSurchargePercent`).

## 6. Хранение и миграции

localStorage-ключи:
- `electroplan_current_project` — снимок проекта (`ProjectStore` store.js; запись `persistProject` app.js:2835: при переполнении повторно без плана `{plan:null, planTooBig:true}`).
- `ep_post_templates` — «Готовые посты» (data.js:311–335; app.js:4460 для файла проекта).
- `ep_prefs` — привычки человека и бланк (prefs.js): `frameFacingView`, `myRequisites`, `companyLogo`/`companySignature`/`companyStamp`, `companyTerms`, `offerPresets`, `installSheetPresets`, `offerCounters` (автономер КП), состояние секций левой/правой панели.
- `ep_eur_rate` — кэш курса ЦБ (rates.js:13). `ep_download_sig` — подпись последнего скачанного файла проекта (projectFile.js:149).
Файл проекта (`.json`): `EPProjectFile.build/parse` projectFile.js:50/64, `PREF_KEYS` 36 едут вместе с проектом; снимок берётся из `projectSnapshot()` app.js:2786 напрямую (не из ProjectStore).
Снимок: devices, posts, rooms, walls, autoWalls, roomLines, roomFieldMemory, planVisibility, planRotation, worldAngle, rotateTarget, view, orthoMode/snapGrid/gridStep, pxPerMeter/scaleSegment, plan (data-URL), docHeader, offerOptions, assemblyView, installSheetOptions, packMultiple, terms{workPercent, materialsPercent, discountPercent, vatPercent, vatMode, rateSurchargePercent, lightingScheme, backlight, displayCurrency, eurRate, rateDate, rateSource}.
Загрузка и миграции — `restoreProject` app.js:3041–3161 (все идемпотентны): `relabelContourRooms`; `EPPosts.ensurePostNumbers` (3049, нумерация старых постов); `dropOrphanKeyGroups` 3029/3050 (осиротевшие группы света); `EPPosts.applyProjectWallToPosts` 3056 (проектная стена → на посты); поворот плана (`EPPlanRotate.normalizeAngle`, старые = 0/"image"); `rateSurchargePercent == null → 0` (старые сметы не дорожают); подсветка/схема электрики — по умолчанию выключена/classic; `vatMode` из `vatEnabled` (`EPEstimate.vatModeOf` estimate.js:468); `EPOfferOptions.normalize` 3125; `installSheetOptions` нет поля → `migrate` (лист как раньше) 3134; `EPDocRequisites.migrateDocHeader` docRequisites.js:61; `syncPackMultiple`.
Undo/redo: `captureHistory` app.js:2890, `EPHistory` history.js (шаг = снимок плана без savedAt/view).

## 7. Тесты (`tests/*.test.js`, раннер node:test; хелперы `tests/helpers/appStand.js`, `stripComments.js`)

Чистые модули (по одному файлу на модуль):
catalog (49) · seriesMatch · catalogSections, catalogSectionsOrder · catalogPoolFallback · posts (78) · postfit (57), postfitDeviceSupport, postfitSupportWallCatalog · estimate (63), estimateBacklight, specShown · lightingGroups (103) · lightingPlan (46) · lightingByRoom (37) · builderSlots (28) · buttonFrame, buttonFrameCapacity · mechColor · framePicker · thermoSensor, thermoSensorK5b · backlightPick (19) · confirmRepeat (24) · installSheet (56), installSheetOptions, installSheetWindow · offerPdf, offerOptions, offerNumber, offerTerms · supplierSpec (45) · specExcel · packRound, packTopUp · explodedView (38) · postImage (56) · planLabels (41) · postCopy (37) · geometry (54) · viewport · roomsFromLines · roomOverlap · roomCarry (66) · roomVariants (35), roomVariantsUi · roomWalls · room · roomDraft · selectionModule · drag · history · planImport, planRotate, planShrink · imageFormats, heicImport · docRequisites · priceSheet, priceTemplate (29), priceTemplateFile, priceCheckUi · projectFile, projectSetup · rates · notices · leftPanel, rightPanel, topbarProjectLabel · picker · placeDblClick · planDrop.

Правила на данных/каталоге: nomenclature (33), nomenclature2026 (20) — чтение xls и классификация; catalogIdsUnique; catalogNoPlaceholderPhoto; catalogRuntimeEnrichment; discontinuedCatalog; packCatalogData; openingsKeyConsistency (ключ окон data.js ↔ tools); detectOpeningsSelection; faces; mountNote; elementColorFromArticle/FromName; siteGroups; backlightInherit.

Поведенческие через appStand (вырезают функции app.js/docs.js/postBuilder.js):
- Деньги/документы: postPriceConsumers, postPriceShownInvariant, docsMoneyCoverage, offerInvariant, offerTotalsConsistency, itemDiscount (35), vatModeWiring, vatMigrationChain, offerNumberWiring, rateStartup, packExportWiring, packMultipleExcel/RoundTrip/SupplierSpec, packTopUpDocs/Wiring, documentLogo, documentSignatureStamp, offerPresetSets, assemblyView, installSheetGating, integratedSwitchDocuments, backlightDocuments (19), backlightMoney/Settings/PostOverride/PostLayout/ScreenComposition/PostBuilderUi.
- Окно поста/конструктор: appStandMultiFile, appStandFactoryTail, postBuilderModuleBoundary, builderPostDraftWiring, builderSignatureWiring, builderRoomFilterCollectionWiring, savePostBuilderWiring, closePostBuilderWiring, openPostBuilderCollectionWiring, openPostBuilderSearchClearWiring, newPostRoomFrameWiring (32), postSlotCountWiring, postLightGroupsUiWiring, resolveMissingFrameCollection, mechanismMissingGapWiring, mechanismDiscontinuedKeptWiring, mechanismAxialModule, frameAvailability, frameDiscontinuedKeptWiring/Placement, buttonFrameBuilderWiring, buttonFrameImage, innardsColorFilter (15), noPhotoLabelSingleSource, productPicture.
- Отделка комнаты: frameFacingRoomWiring/ViewWiring/NarrowingWiring (27), frameStandardRoomWiring, frameCollectionList*, framePickerDepsWiring, frameSwapOnPlacement (30), postVariantSelect, roomVariantsPlacement, roomVariantsUiWiring, roomVariantsCarryRoundTrip, roomCollection*Wiring, roomFacingTitleWiring, noRoomStyleWiring.
- Группы света: crossLinkNumbers (24), integratedSwitchReplacement, keyGroupsMigrationWiring, lightingByRoomWiring, replacementGroupCase, planLabelsSpecWiring, planLabelsWorldRotate, postCopyNames/Paste/Placement.
- Комнаты и план: roomResolveRule, roomAssignSingleRuleWiring, roomAssignmentsRefreshWiring, roomCarryCollectionAppWiring, roomCoverManualAppWiring, roomDraftFlushWiring, roomFieldMemoryRoundTrip/Wiring, roomLabelPlacePending/SeedWiring, roomMarkupBehavior, roomNoRoomLabelBehavior/Wiring, roomOverlapShow, roomVertexEdit/Guard, roomWallsGesture, wallScopeModal, wallMigrationRestore, wallDrawPersistWiring, wallPointSummaryWiring, relabelContourRooms, orphanWarning, renderSummaryOrphanWiring, addPendingRoomToast, compactIconNoRoomBehavior, placementAnyTool.
- Холст/история/файл: canvasDragBehavior, canvasInputRotateWorld, canvasRoomPickWiring, selectionBehavior (30), arrowNudgeRotate, undoBehavior (32), undoSnapshotClassification, clearPlanConfirm/Wiring, planBackingRaceGuard, rotateWorldControls/Wiring, setWorldAngleView, applyViewMatrix, statusCountsWiring, renderPropertiesStaleSelectionWiring, projectFileRoundTrip, installSheetPlanHintCss, priceCardHiddenCss.

QA (`tools/qa/`): `run.mjs` (сценарий показа → скриншоты `out/shots`, свой сервер :8431, headless Chrome), `shoot.mjs` (общая часть сцен), `tails/*.txt` (хвосты сценария: vat, num, inst, inst2, disc, req, place…), `mutate.cjs` + `mutations/*.json` (мутационная проверка: сломать код — покраснел ли тест), `build-deck.py`, `README.md`.

## 8. Документы-ориентиры (содержимое не пересказывается)

- `HANDOFF.md` — входной документ: статус, журнал работ по датам, открытые решения владельца, правила 7.1–7.3.
- `docs/ОСТАТОК-РАБОТ.md` — единый список оставшихся работ (на «что осталось» отвечать по нему).
- `.claude/RULES.md` — обязательные правила проекта (хук печатает на каждое сообщение владельца): сначала слова заказчика, фраза «что увидит на экране», сабагенты в фоне, новый код в свой модуль.
- Прочее: `PLAN.md` (основной план), `PLAN-segmentation.md`, `INTERFACE.md`, `README.md`, `tools/README.md` (пересборка каталога), `tools/qa/README.md`, `docs/К12-разведка-и-план.md` (образец перечня потребителей), `docs/итоги-встречи-*.md`, `docs/расшифровка-встречи-*.txt` (слова заказчика), `local/README.md` (план переноса в Битрикс).
