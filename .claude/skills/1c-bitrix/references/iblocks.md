# Инфоблоки

Главное хранилище контента в Битриксе. Сущности: **тип инфоблока → инфоблок → раздел → элемент → свойство**.

## Чтение элементов

### Старое API (`CIBlockElement`)

```php
use Bitrix\Main\Loader;
Loader::includeModule('iblock');

$res = \CIBlockElement::GetList(
    ['SORT' => 'ASC', 'NAME' => 'ASC'],          // сортировка
    [
        'IBLOCK_ID'    => 5,
        'ACTIVE'       => 'Y',
        'ACTIVE_DATE'  => 'Y',                    // обязательно для публички!
        '!PROPERTY_BRAND' => false,               // только с заполненным свойством
    ],
    false,                                        // группировка (false — нет)
    ['nTopCount' => 50],                          // limit
    ['ID', 'NAME', 'CODE', 'IBLOCK_ID', 'PROPERTY_BRAND', 'DETAIL_PAGE_URL']
);
$items = [];
while ($row = $res->GetNext()) {                  // GetNext() — с htmlspecialchars
    $items[] = $row;
}
```

`GetNext()` экранирует поля и резолвит CDN-картинки/ссылки. `Fetch()` — сырые данные. Для админки бери `Fetch`, для публички — `GetNext`, но осознанно: на больших списках это лишние ms.

### D7 (`Bitrix\Iblock\ElementTable`)

```php
use Bitrix\Iblock\ElementTable;

$rows = ElementTable::getList([
    'select' => ['ID', 'NAME', 'CODE', 'PREVIEW_TEXT'],
    'filter' => ['IBLOCK_ID' => 5, '=ACTIVE' => 'Y'],
    'order'  => ['SORT' => 'ASC'],
    'cache'  => ['ttl' => 3600, 'cache_joins' => true],
])->fetchAll();
```

D7 не отдаёт свойства напрямую (они хранятся отдельно). Способы получить свойства:

1. **`CIBlockElement::GetProperty()`** — простой и старый.
2. **`Bitrix\Iblock\PropertyIndex\Manager`** — для фасетного поиска.
3. **ORM-свойства**: для каждого инфоблока генерируется класс `Bitrix\Iblock\Elements\ElementXxxTable`. Включается в настройках инфоблока («API»). Тогда:

```php
use Bitrix\Iblock\Elements\ElementCatalogTable;

$row = ElementCatalogTable::getList([
    'select' => ['ID', 'NAME', 'BRAND_VALUE', 'BRAND.NAME'],   // BRAND — код свойства
    'filter' => ['=ACTIVE' => 'Y'],
])->fetchObject();

echo $row->getBrand()->getValue();     // объектный доступ
```

Это самый чистый путь для нового кода, но требует регенерации класса при добавлении свойств (кнопка в админке инфоблока, либо `Bitrix\Iblock\Iblock::wakeUp($id)->save()`).

## Создание/изменение элементов

### Старое API

```php
$el = new \CIBlockElement;
$id = $el->Add([
    'IBLOCK_ID'        => 5,
    'IBLOCK_SECTION_ID' => 12,
    'NAME'             => 'Товар',
    'CODE'             => 'tovar',                 // если не задать — сгенерится
    'ACTIVE'           => 'Y',
    'PROPERTY_VALUES'  => [
        'BRAND'  => 'Acme',
        'COLORS' => ['red', 'blue'],               // множественное
        'PHOTO'  => \CFile::MakeFileArray('/upload/x.jpg'),  // файл
    ],
]);

if (!$id) {
    throw new \RuntimeException($el->LAST_ERROR);
}
```

Только свойства обновить:

```php
\CIBlockElement::SetPropertyValuesEx($elementId, false, ['BRAND' => 'New']);
```

### D7

```php
use Bitrix\Iblock\Elements\ElementCatalogTable;

$result = ElementCatalogTable::add([
    'IBLOCK_ID' => 5,
    'NAME'      => 'Товар',
    'CODE'      => 'tovar',
    'ACTIVE'    => 'Y',
]);
$id = $result->getId();
// свойства — отдельным апдейтом через объект Iblock:
$el = ElementCatalogTable::getByPrimary($id, ['select' => ['*', 'BRAND']])->fetchObject();
$el->setBrand('Acme');
$el->save();
```

## Разделы

```php
use Bitrix\Iblock\SectionTable;

// Получить дерево от корня
$sections = SectionTable::getList([
    'select' => ['ID', 'NAME', 'IBLOCK_SECTION_ID', 'DEPTH_LEVEL'],
    'filter' => ['=IBLOCK_ID' => 5, '=ACTIVE' => 'Y'],
    'order'  => ['LEFT_MARGIN' => 'ASC'],
])->fetchAll();
```

`LEFT_MARGIN`/`RIGHT_MARGIN` — nested set, `IBLOCK_SECTION_ID` — родитель. Для записи — `\CIBlockSection::Add/Update/Delete` (D7-аналог `SectionTable::add` пишет, но не пересчитывает nested set автоматически в старых версиях; поэтому для разделов **бери старое API**).

## Свойства: типы и хранение

| Тип | Особенности |
|---|---|
| Строка / Число / Дата | Простые, в `b_iblock_element_property` или в отдельной таблице (если включена опция «Хранить значения свойств в отдельной таблице»). |
| Список (L) | Значения — справочник `b_iblock_property_enum`. Получать через `GetPropertyEnum`. |
| Привязка к элементу (E) | `VALUE` — ID привязанного элемента. |
| Привязка к разделу (G) | `VALUE` — ID раздела. |
| HTML/текст (S:HTML) | `~VALUE` хранит массив `['TEXT'=>..., 'TYPE'=>'html\|text']`. |
| Файл (F) | `VALUE` — `b_file.ID`. Получать через `\CFile::GetPath($id)`. |
| Справочник (S:directory) | Привязка к highload-блоку. Часто используется в каталоге для брендов/материалов. |
| Дерево разделов (D:SectionAuto) | Авто-биндинг при сохранении. |

Если опция «Хранить значения свойств в отдельной таблице» включена для инфоблока (характерно для каталогов), значения лежат в `b_iblock_element_prop_s<IBLOCK_ID>` для одиночных и `b_iblock_element_prop_m<IBLOCK_ID>` для множественных. Это сильно ускоряет выборки, но добавление нового свойства требует ALTER TABLE — на больших инфоблоках это блокировка.

## Highload-блоки

Отдельная сущность под структурированные справочники.

```php
use Bitrix\Highloadblock as HL;
Loader::includeModule('highloadblock');

$hlblock = HL\HighloadBlockTable::getById(7)->fetch();
$entity  = HL\HighloadBlockTable::compileEntity($hlblock);
$dataClass = $entity->getDataClass();

$dataClass::getList([
    'filter' => ['=UF_ACTIVE' => 1],
])->fetchAll();
```

Поля highload-блока — `UF_*` (user fields), управляются через `\CUserTypeEntity`.

## Кэширование выборок

Для компонентов работает встроенный кеш. Для свободного кода:

```php
use Bitrix\Main\Data\Cache;

$cache = Cache::createInstance();
if ($cache->initCache(3600, 'iblock_5_actives', '/iblock/5')) {
    $items = $cache->getVars();
} elseif ($cache->startDataCache()) {
    $items = ElementTable::getList([...])->fetchAll();
    $taggedCache = \Bitrix\Main\Application::getInstance()->getTaggedCache();
    $taggedCache->startTagCache('/iblock/5');
    $taggedCache->registerTag('iblock_id_5');
    $taggedCache->endTagCache();
    $cache->endDataCache($items);
}
```

При изменении любого элемента инфоблока 5 — `$taggedCache->clearByTag('iblock_id_5')` (Битрикс делает это сам через события `OnAfterIBlock*`).

## Частые задачи

### Найти элемент по символьному коду

```php
$row = ElementTable::getRow([
    'select' => ['ID'],
    'filter' => ['=IBLOCK_ID' => 5, '=CODE' => 'my-product'],
]);
$id = $row['ID'] ?? null;
```

### Получить элементы раздела с подразделами

```php
$section = SectionTable::getRow([
    'select' => ['LEFT_MARGIN', 'RIGHT_MARGIN'],
    'filter' => ['=ID' => $sectionId],
]);

\CIBlockElement::GetList(
    ['SORT' => 'ASC'],
    [
        'IBLOCK_ID' => 5,
        '>=IBLOCK_SECTION.LEFT_MARGIN'  => $section['LEFT_MARGIN'],
        '<=IBLOCK_SECTION.RIGHT_MARGIN' => $section['RIGHT_MARGIN'],
        'ACTIVE' => 'Y',
    ],
    false, false, ['ID', 'NAME']
);
```

### Дублирование элемента

```php
$result = \CIBlockElement::CopyElement($sourceElementId, ['NAME' => 'Новая копия']);
```

## Грабли

- **Свойство типа «Привязка к элементу» множественное** — `VALUE` при чтении приходит массивом строк (ID); приводи к int.
- **`IBLOCK_TYPE_ID` в фильтре** работает только если делаешь join — в `ElementTable` напрямую такого поля нет. Используй подзапрос или фильтруй по `IBLOCK_ID`.
- **Изменение элемента в обработчике `OnBefore*`** — меняй через `&$arFields`, а не через новый `CIBlockElement::Update` внутри обработчика (рекурсия).
- **`PROPERTY_*_VALUE` vs `PROPERTY_*`** в `select` старого API — первое отдаёт значение, второе — внутреннее представление (PROPERTY_VALUE_ID).
