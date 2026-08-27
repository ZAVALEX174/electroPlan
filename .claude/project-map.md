<!-- mapped-at-commit: 7464bf898e62eabf577d97f500a470979594c4ac -->
<!-- mapped-at: 2026-08-26 -->

# Карта кода ElectroPlan

Клиентский прототип планировщика электрики на ванильном JS, без сборщика:
скрипты подключаются напрямую через `<script>` в `index.html`, порядок
подключения важен (см. раздел "Точка входа"). `/local/` — заготовка под
перенос в 1С-Битрикс (см. `local/README.md`), сейчас это скелет-заглушка,
реальной интеграции ещё нет. `/bitrix/` в проекте отсутствует (не начат
этап интеграции).

Тесты: `npm test` → `node --test "tests/*.test.js"`, 17 файлов, **281 тест**,
все проходят (на коммите mapped-at-commit). Модули без DOM/state экспортируют
себя двойным способом — `window.EPXxx` в браузере и `module.exports` в Node
— именно поэтому их можно тестировать в node напрямую.

Корень репозитория захламлён рабочими файлами не по теме кода: десятки
`*.pdf` (прайсы/каталоги VIMAR), `.tmp-*/`, `seg-preview/`, `chertez/`,
`icons.xlsx`, скриншот `разделение по комнатам.jpg` — это не код, в карту
не включены. `vendor/` (в корне) — сторонние библиотеки (opencv.js, onnxruntime-web
и т.п. для ML-распознавания планов), не индексируется построчно.

---

## Точка входа — index.html

`index.html` — единственная HTML-страница приложения (SPA). Порядок
`<script>` (важен, т.к. модули читают глобалы друг друга при загрузке):

```
catalog-vimar.js        → window.EP_VIMAR_CATALOG (товары+meta, генерируется)
catalog-vimar-attrs.js  → window.EP_VIMAR_ATTRS   (стандарты/суппорты/коробки, генерируется)
catalog-vimar-openings.js → window.EP_VIMAR_OPENINGS (монтажные окна накладок, генерируется)
catalog-vimar-faces.js  → window.EP_VIMAR_FACES   (лицевые прямоугольники механизмов, генерируется)
data.js                 → window.EP_DATA, window.DataService (подмешивает attrs/openings/faces к товарам)
store.js                → window.ProjectStore (LocalStorage проекта)
config.js                → window.EPConfig (константы UI: сетка, зум, привязки)
catalog.js               → window.EPCatalog (чистая логика каталога)
postfit.js                → window.EPPostFit (подбор суппорта/коробки)
posts.js                  → window.EPPosts (состав/раскладка поста)
picker.js                 → window.EPPicker (кастомный select с миниатюрами)
estimate.js                → window.EPEstimate (расчёт сметы)
offerPdf.js                 → window.EPOfferPdf (КП, печатная форма)
installSheet.js              → window.EPInstallSheet (лист монтажника)
postImage.js                  → window.EPPostImage (картинка собранного поста, pickIcon/iconSvg)
explodedView.js                → window.EPExplodedView (взрыв-схема поста)
rates.js                        → window.EPRates (курс ЦБ РФ)
geometry.js                      → window.EPGeom (геометрия полигонов/сетки)
drag.js                           → window.EPDrag (перенос объектов — жест)
viewport.js                        → window.EPViewport (экран↔мир, зум, fitView)
roomsFromLines.js                   → window.EPRoomsFromLines (комнаты из линий разметки)
planTrace.js                         → window.EPPlanTrace (автообрисовка стен по толщине)
roomSegmentation.js                   → window.EPRoomSeg (OpenCV watershed-сегментация комнат)
floorplanML.js                         → window.EPFloorplanML (YOLOv8 в браузере, ML-распознавание)
planImport.js                           → импорт PNG/SVG/PDF/DXF/DWG плана
app.js                                   → оркестратор: state, весь DOM/UI, склеивает всё выше
```

`preview-posts.html` — отдельная лёгкая страница-песочница для проверки
рендера постов (EPPostImage) без всего приложения.

---

## 1. ПОДБОР МЕХАНИЗМОВ И СОСТАВ ПОСТА

Файл `js/posts.js` (чистая логика, без DOM/state, deps передаются аргументом;
экспорт `window.EPPosts`):

- `postComposition(post, deps)` — **строка 69**. Главная функция состава поста:
  берёт накладку (`deps.frameProduct(post.frameId)`), считает суммарные модули
  механизмов (`modulesTotal`), определяет стандарт накладки (`frameStandard`),
  число коробок (`boxCount`), подбирает коробку через `deps.findBox`/`deps.fallbackBox`
  и **ПОСЛЕ коробки** — суппорт через `deps.findSupport` (суппорт зависит от
  подобранной коробки). Возвращает `{frame, standard, model, modulesTotal,
  boxCount, boxUnit, postCount, support, box, boxFallback}`.
- `boxCount(post, frame, standard, deps)` — **строка 53**. Правило "одна
  накладка — одна коробка": для стандартов IT/IT_ROUND/BOTH и нераспознанного
  — всегда `1`; только для DE/FR (`BOX_MODEL[standard]==="post"`) коробок
  несколько — по числу физических постов накладки (явный `frame.postCount`
  либо `ceil(модули/2)`).
- `BOX_MODEL` — **строка 28**: `{IT:"assembly", IT_ROUND:"assembly", DE:"post", FR:"post", BOTH:"assembly"}`.
- `postCost(post, deps)` — **строка 113**. Стоимость поста = механизмы + накладка
  + суппорт (если подобран) + коробка × boxCount (точная либо совместимый фолбэк;
  если нет ни одной — цена коробки честно не добавляется).
- `moduleLayout(mechanismIds, deps)` — **строка 129**. Раскладка механизмов слева
  направо с позициями/метками ("2", "2–3") — общий код для конструктора и листа
  монтажника.
- `fillWord`/`fillSummary` — **строки 151/166**. Человекочитаемое наполнение
  поста ("Розетка — 2, Выключатель — 1") для КП.
- `nextPostNumber`/`ensurePostNumbers` — **строки 181/188**. Номер поста —
  сквозной, закрепляется при создании, не переиспользуется при удалении.
- `fitMechanismIds`/`fitMechanismIdsPreserving` — **строки 197/214**. Отбор
  механизмов под ёмкость рамки (для конструктора).

Подбор суппорта/коробки — отдельный файл **`js/postfit.js`** (namespace
`window.EPPostFit`), правило владельца: подобранное изделие НИКОГДА не
противоречит монтажному стандарту накладки (жёсткий фильтр по стандарту,
иначе `null` — честный пробел, а не случайная подстановка):

- `selectBox(opts)` — **строка 46** (ядро), обёрнуто в `findBox` (строка 86,
  тип стены обязателен) и `fallbackBox` (строка 87, `relaxWall:true` — тип
  стены как приоритет, не фильтр). Круглые стандарты (DE/FR/IT_ROUND) — одна
  коробка на пост, выбор по стене+цене; IT/BOTH/unknown — одна коробка на
  ВСЮ накладку по ёмкости (наименьшая вмещающая).
- `socketBox(boxes)` — **строка 93**. Фолбэк-подрозетник по умолчанию
  (для `socketBoxProductId` в старых вызовах) — круглая ø60, самая дешёвая.
- `supportTypeForBox(std, box)` — **строка 115**. Тип суппорта (602/603)
  задаётся ПОДОБРАННОЙ КОРОБКОЙ, не эвристикой: DE → всегда 603; коробка
  71701 → 603; коробка 71001 → 602. Тип суппорта закодирован в последних
  3 цифрах артикула (`supportTypeCode`, строка 103).
- `findSupport(opts)` — **строка 129**. Приоритет: тип по коробке (см. выше),
  та же серия (`series`), затем по модульности (обычно 2М). Нет подходящего
  по правилу → `null`.

Тесты: `tests/posts.test.js`, `tests/postfit.test.js`.

---

## 2. РАСКЛАДКА ПОСТОВ (импосты, многопостовые накладки)

Всё в `js/posts.js`:

- `frameLayout(frame)` — **строка 252**. Строит модель накладки: `rows`
  (массив рядов, каждый — массив ёмкостей постов), `posts` (плоский список
  `{index,row,col,capacity}`), `capacity`, `postCount`, `multiRow`. Источник
  раскладки — `frame.layoutRows` (снята конвертером каталога из номенклатуры:
  "2+2" → `[[2,2]]` один ряд/два поста, "4+4" → `[[4],[4]]` два ряда);
  нет её — запасная эвристика (DE/FR делится по 2 модуля в один ряд, иначе
  один пост на всю ширину — итальянская сплошная накладка).
- **Импост** — физическая перегородка накладки, разделяющая её на отдельные
  посты (буквально отдельные монтажные коробки); механизм не может
  "пересекать" импост — обязан целиком лечь внутри одного поста. Только
  немецкий/французский стандарт (DE/FR) физически разбит импостами; итальянский
  (IT) — сплошное окно без импостов, один пост на всю накладку (или несколько
  РЯДОВ у многорядных модификаций).
- `packAll(items, capacities)` — **строка 284**. Полный перебор с возвратом
  (backtracking): пытается уложить механизмы (`items:[{span}]`) по постам
  (`capacities:[число]`) без разрыва через импост. Механизмы берутся по
  порядку входа, каждый пробует **первый подходящий пост слева направо**
  (first-fit по ветке), при неудаче — откат (`occ[p]-=it.span; bins[p].pop()`)
  и следующий пост; идентичные по ёмкости и занятости посты повторно не
  пробуются (отсечение симметричных веток). Возвращает `bins` (массив постов
  с уложенными items) либо `null`, если валидной раскладки нет вообще.
  Задача маленькая (постов ≤8, механизмов ≤8) — перебор дёшев.
- `distributePosts(mechanismIds, frame, deps)` — **строка 315**. Оркестратор
  раскладки: строит `layout` (`frameLayout`), отсекает механизмы шире самого
  широкого поста (`too-wide`, ошибка сразу), пробует `packAll`; если полная
  укладка найдена — переносит её как есть в `posts[i].mechanismIds`; если нет
  — раскладывает "как влезет" (first-fit без отката) и помечает не влезшее
  как `overflow` с причиной `overflow`. Возвращает
  `{layout, posts, overflow, errors, valid, full, maxCapacity, totalCapacity, totalOccupied}`
  (`valid` — ничего не overflow/too-wide; `full` — все посты заполнены целиком).
- `maxFreeSpan(dist)` — **строка 361**. Максимальное свободное место среди
  ВСЕХ постов (не только первого) — ограничивает ширину механизма, который
  ещё можно добавить в конструкторе.
- `postModuleGroups(mechanismIds, frame, deps)` — **строка 370**. Нумерация
  модулей ПО ПОСТАМ для листа монтажника (в каждом посте счёт начинается
  заново с 1) — строится поверх `distributePosts`+`moduleLayout`.

В `app.js` эта раскладка используется в `renderBuilder()` (строка 1164,
конструктор поста): вызывает `EPPosts.distributePosts`, при валидной укладке
переупорядочивает `state.builder.mechanismIds` в "упакованный" порядок
(строки 1200-1203), считает `maxPostCap`/`addMax` для ограничения выбора
в пустых слотах, и блокирует "Сохранить" пока `!(dist.valid && dist.full)`
(строка 1243). Ошибки показываются пользователю текстом причины —
`builderErrorHtml(dist)` (строка 1255), не молча.

Тесты: `tests/posts.test.js` (входит перебор/packAll/impost-сценарии).

---

## 3. КАТАЛОГ

### Формат записи товара (`window.EP_VIMAR_CATALOG.products`, генерируется)

Общие поля у всех kind: `id, categoryId, code, name, kind, icon, price,
currency, unit, active, series[], compatibility` (+ `previewImageUrl`/`imageUrl`,
если найдено фото; `color`, если есть в номенклатуре).

`kind` ∈ `mechanism | frame | socket_box | support | accessory`.

Специфичные поля:
- `mechanism`: `moduleSpan` (1..8, валидируется конвертером; если нет —
  рантайм выводит из названия через `EPCatalog.mechanismSpan`, `js/catalog.js:26`).
- `frame`: `slotCount` (ёмкость в модулях, 1..8).

Пример **механизма** (реальная запись, `js/catalog-vimar.js`):
```json
{
  "id": 200040, "categoryId": 700, "code": "02970",
  "name": "Термостат поворотный 2M 100-240V серый",
  "kind": "mechanism", "icon": "°C", "price": 237.71,
  "currency": "EUR", "unit": "шт.", "active": true,
  "series": ["Arke", "Arke Fit", "Eikon Evo", "Eikon Exe", "Plana"],
  "compatibility": "Arke, Arke Fit, Eikon Evo, Eikon Exe, Plana",
  "previewImageUrl": "https://vimar.ru/.../ceb....jpg",
  "imageUrl": "https://vimar.ru/.../ceb....jpg",
  "moduleSpan": 2, "color": "Чёрный"
}
```

Пример **рамки/накладки**:
```json
{
  "id": 100992, "categoryId": 100, "code": "09661.01",
  "name": "Накладка на 1 модуль центрально для коробки на 2 модуля, белая",
  "kind": "frame", "icon": "□", "price": 3.12,
  "currency": "EUR", "unit": "шт.", "active": true,
  "series": ["Neve Up"], "compatibility": "Neve Up",
  "previewImageUrl": "https://vimar.ru/.../98e....jpg",
  "imageUrl": "https://vimar.ru/.../98e....jpg",
  "slotCount": 1
}
```

meta текущего каталога (на момент карты): `total: 2146` (`mechanisms: 435,
frames: 1631, socketBoxes: 17, supports: 38, accessories: 25`), цена из
прайса — 1694, из номенклатуры (нет в прайсе) — 452.

Признаки автосостава поста (стандарт накладки, тип стены/форма/модульность
коробки, стандарт+модульность суппорта, `layoutRows`) в `catalog-vimar.js`
**не хранятся** — отдельный генерируемый файл `js/catalog-vimar-attrs.js`
(`window.EP_VIMAR_ATTRS = {standards:{code:{standard,postCount,layoutRows?}},
supports:{code:{standard,modules,pitchMm}}, boxes:{code:{wallType,shape,modules,standards[]}},
wallTypes:{}}`), подмешивается к товарам в `js/data.js` (функция
`enrichCatalog`, строки 41-102) при загрузке. Аналогично измеренные окна
накладки (`js/catalog-vimar-openings.js` → `EP_VIMAR_OPENINGS`, ключ — база
артикула) и лицевые прямоугольники механизмов (`js/catalog-vimar-faces.js` →
`EP_VIMAR_FACES`, ключ — полный артикул) подмешиваются туда же как
`mountRect`/`mountRects` и `faceRect`.

### `js/catalog.js` (`window.EPCatalog`) — чистая логика над товаром

- `mechanismSpan(item)` — **строка 26**: явное поле → иначе разбор названия
  ("2 модуля"/"2М"/"2M", с защитой от "16A"/"250V"/"6 м"/"2МВт") → иначе `1`.
- `frameSlotCount(item)` — **строка 58**: явное `slotCount` (1..8) → иначе
  разбор названия → иначе `null` (многорядные 14/21-модульные накладки
  намеренно не подставляются под однорядные размеры).
- `compatibleMechanisms(frame, mechanisms)` — **строка 43**: фильтр механизмов
  по пересечению `series` с накладкой.
- `frameOpening`/`frameOpenings`/`moduleFace` — **строки 87/117/149**: чтение
  геометрии окон/лица для рендера собранного поста (`postImage.js`).
- `productImage(item, {detail})` — **строка 172**: URL картинки с приоритетом
  и фильтром заглушек `no_photo.png`.

### `tools/build-catalog.mjs` — сборка `js/catalog-vimar.js`

Запуск: `npm run build:catalog`. Источники:
- **Состав/атрибуты** — файл номенклатуры заказчика `../Номенклатура новая.xls`
  (вне репозитория проекта, путь по умолчанию в `DEFAULT_NOMENCLATURE` из
  `tools/lib/nomenclature.mjs`); читается и классифицируется в
  `tools/lib/nomenclature.mjs` (`readNomenclature`).
- **Цены** — актуальный прайс VIMAR `.xls` (лист "VIMAR", строки данных с 4-й,
  колонки: A артикул, C цена, D упаковка); если артикула нет в прайсе — берётся
  цена из номенклатуры и это учитывается в статистике сборки.
- **ID товаров** — стабильны между пересборками через `tools/data/catalog-ids.json`
  (сопоставление артикул→id); новым артикулам — id из диапазона `200000+`,
  дописывается обратно в тот же файл (детерминированный повторный прогон).
- **Overrides, применяются ПОСЛЕ чтения номенклатуры:**
  - `tools/data/kind-overrides.json` — явные переклассификации `kind` (например
    IP55-корпуса 14901-14904 → `socket_box`, светодиоды подсветки 00935.* →
    `accessory`), применяет `applyKindOverrides` из `nomenclature.mjs`.
  - `tools/data/image-overrides.json` — точечные подмены `imageUrl` (когда
    у товара на vimar.ru фото битое/заглушка, а на vimar.com — настоящее),
    применяется прямо в `build-catalog.mjs` (строки 120-127).
- Изображения — индексы `outputs/db_price_import_20260723/vimar-ru-image-index.json`
  и `vimar-image-index.json` (вне репозитория проекта, путь по умолчанию
  строится от `repoRoot`, т.е. на уровень выше `electroplan-project/`).
- Результат — `js/catalog-vimar.js` (`window.EP_VIMAR_CATALOG = {meta, products}`),
  JSON одной строкой (грузится синхронно при открытии, без минификации весит
  дороже). **Файл генерируемый — ручные правки теряются**, править нужно
  источники (номенклатуру/прайс/overrides).

Смежный `tools/build-catalog-attrs.mjs` (`npm run build:attrs`) строит
`js/catalog-vimar-attrs.js` из той же номенклатуры + тех же kind-overrides —
даёт признаки автосостава (standards/supports/boxes/wallTypes) отдельно от
основного каталога, т.к. основной каталог пересобирается конвертером и
не должен раздуваться служебными полями рантайма.

`tools/detect-openings.mjs` (`npm run build:openings`) и `tools/detect-faces.mjs`
(`npm run build:faces`) — детекторы геометрии по фото (окна накладки / лицо
механизма) → `catalog-vimar-openings.js` / `catalog-vimar-faces.js`.

`tools/discover-candidates.mjs`, `tools/fetch-site-groups.mjs`,
`tools/analyze-price.mjs` — вспомогательные разведочные скрипты (сверка
прайса/сайта VIMAR с номенклатурой), не часть основного пайплайна сборки
каталога, но используются как источники для overrides (см. `_source` в
`kind-overrides.json`/`image-overrides.json`).

---

## 4. ЭЛЕМЕНТЫ НА ПЛАНЕ

Хранятся в `state` (`js/app.js`, строка 6) плоскими массивами:
`state.devices[]`, `state.posts[]`, `state.rooms[]`. Общий вид объекта на
плане — **мировые координаты** `x, y` (top-left, экран↔мир через
`EPViewport`), `id` (генерируется `uid(prefix)`, строка 26 — `prefix + Date.now в base36 + случайные символы`).

**Device** (одиночный элемент каталога — `kind` mechanism/accessory/standalone
не в составе поста), создаётся в `addPending()` (`app.js:1336`):
```js
{ id: "dev_...", productId, x, y, height: "300 мм", roomId: null }
```
Полей "номер"/"подпись"/"группа освещения" у устройства **нет**.

**Post** (электрический пост — накладка+механизмы+суппорт+коробка), создаётся
в `addPending()` (`app.js:1343`):
```js
{
  id: "post_...", templateId, x, y,
  number,              // сквозной номер поста — см. EPPosts.nextPostNumber
  name, frameId, mechanismIds: [...], socketBoxProductId,
  roomId: null,
  height, purpose       // необязательные — используются в листе монтажника (installSheet.js),
                          // но нет UI-поля для их ввода в текущем properties-панеле (задел на будущее)
}
```
У поста ЕСТЬ подпись/номер (`entity.number`, рисуется на плане как текст
пиктограммы, см. ниже) и есть `height`/`purpose` (используются в
`buildPostSheet()`, `app.js:1841`, для листа монтажника), но нет отдельного
поля "группа освещения" — **такого поля в проекте сейчас нет вообще**
(проверено grep по `js/` — не найдено).

**Room** (помещение) — `{id, name, x, y, polygon?:[{x,y}], manual?}`; либо
прямоугольная подпись без контура (тащится как обычный объект), либо
полигон (`r.polygon`, рисуется в `<svg id="roomsSvg">` отдельным слоем,
не двигается кликом — только выделяется/удаляется). Привязка объекта к
комнате — по `roomId` (устройства и посты); `getObjectsInRoom(roomId)`
(`app.js:843`) собирает и устройства, и посты внутри комнаты.

### Пиктограммы на плане

`compactIcon(entity, kind)` — **`app.js:345`**. Общий рендер иконки-квадрата
для device/post: `kind==="device"` → текст = `product(entity.productId)?.icon`
(поле `icon` товара каталога — символ типа "°C", "□" и т.п.); `kind==="post"`
→ текст = сквозной номер поста (`entity.number`). Позиционируется абсолютно
по `entity.x/y`, перенос — через `makeDraggable` (использует `js/drag.js`
для расчёта жеста).
- `renderDevices()` — **`app.js:364`** — перерисовывает все `.plan-icon.device-only`.
- `renderPosts()` — **`app.js:365`** — перерисовывает все `.plan-icon.post`,
  двойной клик открывает конструктор поста (`openPostBuilder`).
- `renderRooms()` — **`app.js:366`** — рисует подписи/полигоны комнат отдельно.

Полная **картинка собранного поста** (не иконка-квадрат, а фото
накладки+механизмов) — отдельный модуль `js/postImage.js` (`window.EPPostImage`,
функции `buildHtml`/`pickIcon`/`iconSvg`), используется в подсказке на плане,
библиотеке шаблонов, КП и листе монтажника — не на самом плане (там только
компактная иконка с номером).

---

## 5. СМЕТА И ДОКУМЕНТЫ

- **Смета** — `js/estimate.js` (`window.EPEstimate.build(input)`), единственный
  источник истины: и панель "Стоимость проекта" в UI, и КП считают ТОЛЬКО
  через него (раньше формулы дублировались и расходились). Группирует позиции
  по составу (посты — по ключу накладка+мультимножество механизмов, не по
  номеру/имени), считает скидку/материалы/работы/НДС. Оркестратор —
  `buildEstimate()` (`app.js:1125`), подставляет `product`/`postCost`/
  `postComposition`/`state.devices`/`state.posts`/`EP_DATA.settings`.
- **КП (печатная форма)** — `js/offerPdf.js` (`window.EPOfferPdf.buildHtml(est, deps)`),
  вызывается из `generateCommercialOffer()` (`app.js:1932`): считает смету,
  открывает `window.open`, пишет HTML документа (спецификация + раздел
  "Раскладка постов" с иллюстрациями + итоги + курс, если валюта RUB).
  Автопечать по загрузке всех картинок (инлайн-скрипт в самом документе,
  предохранитель 4000мс).
- **Лист монтажника** — `js/installSheet.js` (`window.EPInstallSheet.buildHtml`),
  оркестрируется в `app.js`: `buildPostSheet(post)` (**строка 1841**) собирает
  данные одного поста (таблица модулей, обвязка суппорт→коробка→накладка,
  картинка сборки, взрыв-схема); `installSheetForBuilder()` (**1899**) —
  для поста прямо в конструкторе; `installSheetForProject()` (**1909**) —
  на все посты проекта, сгруппировано по помещениям, с сортировкой по
  порядку комнат и номеру поста; `renumberPosts()` (**1922**) — осознанная
  перенумерация 1..N по расположению на плане (сверху-вниз, слева-направо),
  отдельная команда, не автоматическая.
- **`js/explodedView.js`** (`window.EPExplodedView.buildHtml(spec, deps)`) —
  взрыв-схема поста (детали разнесены в пространстве, выносные линии к
  подписям с артикулом). Собирается из уже посчитанного состава функцией
  `buildExplodedSpec(comp, box, layout, frameSpec)` (**`app.js:1792`**):
  порядок деталей накладка → механизмы(стек) → суппорт → коробка; глиф детали
  берётся из каталожной системы иконок (`pickIcon`/`iconSvg` из `postImage.js`).
  Используется ТОЛЬКО в листе монтажника (не в КП).

**Точки расширения**: все 3 документа (`offerPdf.js`, `installSheet.js`,
`explodedView.js`) — чистые модули "spec/data → HTML", без DOM/state; чтобы
добавить документ или секцию, нужно расширить оркестратор в `app.js`
(собрать данные из `state`) и передать их в `buildHtml` соответствующего
модуля, либо добавить новый такой же модуль по образцу. `docHeader()`
(`app.js:1742`, используется в обоих печатных документах) — общие реквизиты
проект/клиент/дата.

---

## 6. ТЕСТЫ

`tests/*.test.js` — 17 файлов, запуск `npm test` → `node --test "tests/*.test.js"`
(нативный раннер Node, без Jest/Mocha). На коммите mapped-at-commit: **281 тест,
все проходят**. Тестируются только чистые модули (без DOM) — `app.js` целиком
автотестами не покрыт (комментарии в коде явно объясняют это архитектурное
решение — "как estimate.js — без зависимостей приложения, под автотесты").

Файлы тестов соответствуют модулям 1:1: `catalog.test.js`, `drag.test.js`,
`estimate.test.js`, `explodedView.test.js`, `faces.test.js`, `geometry.test.js`,
`installSheet.test.js`, `nomenclature.test.js` (тестирует `tools/lib/nomenclature.mjs`),
`offerPdf.test.js`, `picker.test.js`, `postImage.test.js`, `postfit.test.js`,
`posts.test.js`, `rates.test.js`, `roomsFromLines.test.js`,
`siteGroups.test.js` (тестирует `tools/lib/site-groups.mjs`), `viewport.test.js`.

---

## local/ — заготовка под интеграцию в 1С-Битрикс

Реальной интеграции нет, это заготовка-скелет (см. `local/README.md`, подробная
таблица соответствия "прототип → Битрикс"). Заказчик — ЦентрСвет, модуль
`centrsvet.electroplan`, namespace `Centrsvet\Electroplan`.

- `local/modules/centrsvet.electroplan/` — модуль:
  - `lib/Controller/Catalog.php`, `Post.php`, `Project.php` — заготовки
    AJAX-контроллеров (`Bitrix\Main\Engine\Controller`), должны заменить
    `DataService.getProducts/getSavedPosts/savePost/deletePost` из `js/data.js`.
  - `lib/Catalog/ProductRepository.php` — чтение товаров из инфоблока
    (сейчас читает `PROPERTY_KIND/ICON/UNIT/COMPATIBILITY/MOUNT_RECT` —
    урезанный набор полей относительно реального формата `catalog-vimar.js`,
    TODO по ID инфоблока в опциях модуля не решён).
  - `lib/Post/PostTemplateRepository.php`, `lib/Project/ProjectRepository.php` —
    заготовки под Highload-блоки (шаблоны постов, проекты).
  - `install/`, `.settings.php`, `options.php`, `lang/ru/` — стандартный
    скелет модуля Битрикс.
- `local/components/centrsvet/electroplan.app/` — комплексный компонент:
  `class.php` отдаёт каталог во `arResult['CATALOG']`; `templates/.default/`
  содержит заготовки `template.php`/`script.js`/`style.css`/`data-adapter.js`
  под перенос `index.html`/`js/app.js`/`css/styles.css`/`js/data.js`.

Все правки бизнес-логики фронта в текущем прототипе достаточно делать в
`js/`, `css/`, `index.html` — перенос в `local/` предстоит отдельным этапом
и не блокирует текущую работу над прототипом.

---

## Прочее / не индексировано построчно

- `api/README.md` — описание REST-контракта (`/api/products`, `/api/posts`,
  `/api/projects`) для будущего бэкенда Битрикс.
- `database/schema.sql` — предполагаемая SQL-схема (справочно, целевая
  платформа — инфоблоки/Highload-блоки, не голый SQL).
- `docs/*.md`, `docs/*.txt` — рабочие заметки, переписка с заказчиком,
  анализ прайса VIMAR, планы фич — справочные материалы, не код.
- `PLAN.md`, `PLAN-segmentation.md`, `INTERFACE.md`, `HANDOFF.md`, `README.md` —
  проектная документация верхнего уровня в корне.
- `tools/data/*.json` (кроме уже описанных overrides/ids) — вспомогательные
  данные разведки (site-groups, box-wall-type, compat-draft/external,
  price-columns, price-parsed.csv) — источники для ручной курации каталога.
- `.tmp-faces/`, `.tmp-openings/`, `.tmp-site/`, `seg-preview/`, `chertez/` —
  рабочие/временные каталоги, не код.
