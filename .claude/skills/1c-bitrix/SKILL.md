---
name: 1c-bitrix
description: Разработка под 1С-Битрикс (Bitrix Framework, Bitrix24 on-premise) — PHP-код для модулей, компонентов, шаблонов, инфоблоков, торгового каталога, заказов, агентов, обработчиков событий, REST/webhook'ов, миграций, обмена 1С, бизнес-процессов. Используй этот скилл всегда, когда в запросе упоминаются Битрикс, Bitrix, инфоблок, IBLOCK_ID, компонент bitrix:*, шаблон компонента, init.php, /local/, /bitrix/, D7 API, Bitrix\Main, ORM Битрикса, $APPLICATION, CIBlockElement, CCatalog, CSale, Sale\Order, sale.basket.basket, агент Битрикса, файл .settings.php, BX24 REST, обмен с 1С (commerceml), BP/бизнес-процесс — даже если пользователь не назвал «Битрикс» явно, но контекст указывает на платформу.
---

# 1С-Битрикс: справочник для разработки

Этот скилл — оперативная шпаргалка по платформе **Bitrix Framework** (главный модуль, инфоблоки, торговый каталог, продажи) и **Bitrix24 on-premise**. Содержит современный D7 API, важные «грабли» и рабочие паттерны.

## Когда читать какую справку

Сначала определи область задачи и читай только нужный справочник из `references/` — экономь контекст.

| Область задачи | Файл |
|---|---|
| ORM, события, сервис-локатор, очереди, опции, авто-загрузка | `references/d7-api.md` |
| Инфоблоки: чтение/запись, свойства, разделы, миграция на ORM | `references/iblocks.md` |
| Компоненты, шаблоны компонентов, AJAX, композит | `references/components.md` |
| Шаблоны сайта, BX.* JS API, ассеты, эпилог/пролог | `references/templates-frontend.md` |
| Магазин: заказы, корзина, оплата, доставка, скидки, ОФД | `references/ecommerce.md` |
| Агенты, миграции, REST, обмен с 1С, BP, push, очереди | `references/admin-integration.md` |
| Безопасность: XSS/SQLi, ACL, prolog_before/after | `references/security.md` |

## Базовые принципы (не пренебрегай)

### 1. Только `/local/`, никогда `/bitrix/`

Весь кастомный код — в `/local/`. В `/bitrix/` правят только при отсутствии альтернатив (и понимая, что обновление перетрёт). Стандартные пути:

```
/local/
  php_interface/
    init.php                 # обработчики событий, автозагрузка, константы
    include/                 # утилиты, общие функции (require_once из init.php)
  modules/<vendor.module>/   # свой модуль с include.php, options.php, install/
  components/<namespace>/<component>/   # свой компонент
  templates/<template>/      # шаблон сайта или шаблон компонента
  routes/                    # маршруты (если используется новый роутер)
  activities/                # действия бизнес-процессов
```

Битрикс ищет `/local/` раньше `/bitrix/`, поэтому переопределение работает «бесплатно».

### 2. D7 предпочтительнее старого API

Старое API (`CIBlockElement::GetList`, `CSaleOrder`, глобальные `$DB`, `$APPLICATION->IncludeFile`) рабочее, но:
- хуже типизировано,
- не поддерживает современные паттерны (DI, события через `EventManager`),
- часто медленнее на больших выборках.

Если задача — новый код, бери D7 (`Bitrix\Iblock\ElementTable`, `Bitrix\Sale\Order`, `Bitrix\Main\ORM\Query\Query`). Старое API уместно там, где: уже всё на нём, нужны коробочные хуки (например, OnBeforeIBlockElementUpdate с массивом `$arFields`), либо в D7 эквивалент сильно хуже (бывает в `sale`).

### 3. Кэш — это не опция, это обязанность

Любой публичный код, делающий выборки, **обязан** работать через кэш. В компонентах — стандартный механизм (`$this->StartResultCache()` / `EndResultCache()`). Вне компонентов — `Bitrix\Main\Data\Cache` или `TaggedCache`. Метки кэша (`HtmlCache`, `iblock_id_<id>`) дают точечный сброс при изменениях.

### 4. Никогда не доверяй входу

`$_GET`, `$_POST`, `$_REQUEST`, заголовки, cookie — всё враждебное. Ключевые правила в `references/security.md`. Кратко:
- В SQL — только параметризация (`Application::getConnection()->queryExecute($sql, [$param])`) или ORM.
- В HTML — `htmlspecialcharsbx()` (битриксовый алиас), а не `htmlspecialchars()` без параметров.
- В коде компонента публичной части обязателен `if (!defined('B_PROLOG_INCLUDED') || B_PROLOG_INCLUDED !== true) die();`.
- Проверяй CSRF: `$request->isPost() && check_bitrix_sessid()` для POST-обработчиков.

### 5. Окружения и `.settings.php`

Конфиги (`/bitrix/.settings.php`) различаются по средам — подключение к БД, кэш, exception_handling. Для dev/stage/prod храни разные файлы (`.settings.dev.php`) и подменяй на деплое. Не клади креды в репозиторий.

## Минимально необходимый старт нового кода

Подключение API ядра (если код выполняется вне контекста CMS — крон, CLI):

```php
define('NO_KEEP_STATISTIC', true);
define('NOT_CHECK_PERMISSIONS', true);
$_SERVER['DOCUMENT_ROOT'] = realpath(__DIR__ . '/../..');
require $_SERVER['DOCUMENT_ROOT'] . '/bitrix/modules/main/include/prolog_before.php';

use Bitrix\Main\Loader;
Loader::includeModule('iblock');
Loader::includeModule('sale');
```

Регистрация обработчика события (D7) в `/local/php_interface/init.php`:

```php
use Bitrix\Main\EventManager;

$em = EventManager::getInstance();
$em->addEventHandlerCompatible(
    'iblock',
    'OnAfterIBlockElementUpdate',
    ['MyVendor\\Handlers\\Element', 'onAfterUpdate']
);
```

Объявление таблицы ORM (свой модуль):

```php
namespace MyVendor\Shop;

use Bitrix\Main\ORM\Data\DataManager;
use Bitrix\Main\ORM\Fields;

class OrderLogTable extends DataManager
{
    public static function getTableName(): string { return 'myvendor_order_log'; }

    public static function getMap(): array
    {
        return [
            (new Fields\IntegerField('ID'))->configurePrimary()->configureAutocomplete(),
            (new Fields\IntegerField('ORDER_ID'))->configureRequired(),
            (new Fields\StringField('STATUS'))->configureSize(50),
            (new Fields\DatetimeField('CREATED_AT'))->configureRequired(),
        ];
    }
}
```

## Частые «грабли»

- **Кеш компонента не сбрасывается при правке.** В режиме разработки выключи композит и поставь `$arParams['CACHE_TYPE'] = 'N'` или дёргай `BXClearCache(true)`. Помни: HTML-кеш и кеш компонента — разные.
- **`Loader::includeModule()` забыли** — фатал «Class not found» на сервере, локально может работать из-за уже подключённых ранее модулей. Подключай модуль в каждом скрипте, который его использует.
- **`$arResult` модифицирован после `EndResultCache`** — изменения не попадут в кэш. Меняй до `EndResultCache()`, а потом — только в `template.php`.
- **Прямой `INSERT/UPDATE` в таблицы инфоблоков, заказов, корзины** — обходит события, индексы поиска, валидаторы скидок и т.п. Только через API (`Add/Update/Delete` или ORM соответствующего модуля).
- **`CIBlockElement::GetList` без `'ACTIVE_DATE' => 'Y'`** — отдаст элементы с истёкшей датой. На публичке всегда передавай фильтр активности.
- **`die()`/`exit` в обработчиках AJAX-компонентов** до `$this->endResultCache()` — испортит кэш. Возвращай результат, не прерывай.
- **Агент с возвратом не той строки** — если функция агента не возвращает строку с собственным именем (`return "MyClass::method();";`), агент удалится после первого выполнения.
- **`htmlspecialchars` вместо `htmlspecialcharsbx`** — первый ломается на cp1251-проектах и не учитывает кавычки по дефолту.

## Что делать перед тем, как писать код

1. **Уточни версию** ядра (`SM_VERSION` в `/bitrix/modules/main/classes/general/version.php`) и редакцию (Старт / Стандарт / Малый бизнес / Бизнес — влияет на наличие `sale`, `catalog`, `bizproc`).
2. **Спроси про окружение** — composite-кеш, memcached/Redis, наличие push-сервера, кодировка (utf-8 — стандарт, но cp1251 ещё встречается).
3. **Найди существующее место** для кода — в большом проекте обычно есть свой служебный модуль в `/local/modules/` или сложившаяся структура в `init.php`.
4. **Не плоди новых событий-обработчиков**, если уже есть похожий — добавь логику в существующий, чтобы порядок выполнения был контролируемым.

## Полезные коробочные команды

```bash
# CLI агенты вне веба (планировщик)
php -f /bitrix/modules/main/tools/cron_events.php

# Проверка прав на файлы (после переноса)
php /bitrix/scripts/agents.php

# Очистка кеша из консоли
php -r "define('NO_KEEP_STATISTIC',true); require '/path/bitrix/modules/main/include/prolog_before.php'; \Bitrix\Main\Data\Cache::createInstance()->cleanDir(''); BXClearCache(true);"
```

---

Дальше — переходи в нужный файл `references/`. В каждом из них даны рабочие сниппеты, типичные ошибки и ссылки на разделы документации (`dev.1c-bitrix.ru/api_d7/` и `dev.1c-bitrix.ru/api_help/`), которые стоит проверить, если задача редкая.
