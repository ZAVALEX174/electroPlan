# D7 API: ядро

Современный объектный API Битрикса. Документация: `dev.1c-bitrix.ru/api_d7/bitrix/`.

## Загрузка модуля

```php
use Bitrix\Main\Loader;

if (!Loader::includeModule('iblock')) {
    throw new \RuntimeException('Module iblock is not installed');
}
```

`includeModule` делает три вещи: проверяет, что модуль установлен, регистрирует автозагрузчик его классов, и однократно подключает `include.php` модуля. Всегда проверяй возврат — на проде модуль может быть выключен.

## Сервис-локатор

С Bitrix Main 20.x:

```php
use Bitrix\Main\DI\ServiceLocator;

$locator = ServiceLocator::getInstance();
$locator->addInstance('myvendor.shop.repository', new OrderRepository());

// в другом месте:
/** @var OrderRepository $repo */
$repo = ServiceLocator::getInstance()->get('myvendor.shop.repository');
```

Регистрировать сервисы лучше в `.settings.php` модуля или в `/local/php_interface/.settings.php`:

```php
return [
    'services' => [
        'value' => [
            'myvendor.shop.repository' => [
                'className' => \MyVendor\Shop\OrderRepository::class,
            ],
        ],
        'readonly' => true,
    ],
];
```

## ORM (Bitrix\Main\ORM)

### Базовый запрос

```php
use Bitrix\Iblock\ElementTable;

$rows = ElementTable::getList([
    'select' => ['ID', 'NAME', 'CODE', 'IBLOCK_ID', 'IBLOCK.NAME'],
    'filter' => ['IBLOCK_ID' => 5, '=ACTIVE' => 'Y'],
    'order'  => ['SORT' => 'ASC', 'NAME' => 'ASC'],
    'limit'  => 50,
    'cache'  => ['ttl' => 3600],
])->fetchAll();
```

Префиксы фильтра имеют значение:
- `=` — точное совпадение,
- `%` — `LIKE %v%`,
- `><` — `BETWEEN`,
- `!` — отрицание,
- `>`, `>=`, `<`, `<=` — сравнения,
- `@` — `IN (...)` (массив значений).

Без префикса используется поведение по умолчанию (для строк — `LIKE`, для чисел — `=`), что нередко удивляет. Лучше всегда писать `=`.

### Join по `referenceField`

```php
public static function getMap(): array
{
    return [
        // ...
        (new Reference(
            'IBLOCK',
            \Bitrix\Iblock\IblockTable::class,
            Join::on('this.IBLOCK_ID', 'ref.ID')
        )),
    ];
}

// использование
ElementTable::getList(['select' => ['ID', 'NAME', 'IBLOCK_NAME' => 'IBLOCK.NAME']]);
```

### Транзакции

```php
$conn = \Bitrix\Main\Application::getConnection();
$conn->startTransaction();
try {
    OrderLogTable::add([...]);
    OtherTable::add([...]);
    $conn->commitTransaction();
} catch (\Throwable $e) {
    $conn->rollbackTransaction();
    throw $e;
}
```

### Прямой SQL (когда ORM не покрывает)

```php
$conn = \Bitrix\Main\Application::getConnection();
$rows = $conn->query(
    'SELECT * FROM b_iblock_element WHERE IBLOCK_ID = ? AND ACTIVE = ?',
    [5, 'Y']
)->fetchAll();
```

`?` — позиционные параметры, экранируются библиотекой. **Никогда не склеивай SQL-строки руками.**

## События (EventManager)

```php
use Bitrix\Main\EventManager;
use Bitrix\Main\Event;

EventManager::getInstance()->addEventHandler(
    'iblock',
    'OnAfterIBlockElementUpdate',
    static function (Event $event) {
        $params = $event->getParameters();
        $arFields = $params[0] ?? null;
        // ...
    }
);
```

`addEventHandlerCompatible` нужен для старых событий, которые передают параметры как `&$arFields` (по ссылке). Если событие из старого API (`main`, `iblock`, `sale` старого ядра) — используй `Compatible`. Для новых D7-событий — обычный `addEventHandler`.

Регистрация: всегда в `init.php` или в `include.php` своего модуля. Важно: `init.php` грузится в каждом запросе, поэтому держи там только регистрацию обработчиков и константы — не делай тяжёлой работы.

### Отмена события

```php
use Bitrix\Main\EventResult;

return new EventResult(EventResult::ERROR, ['message' => 'Reason'], 'mymodule');
```

## Конфигурация и опции

```php
use Bitrix\Main\Config\Option;

Option::set('myvendor.shop', 'api_key', 'secret', '');   // запись
$key = Option::get('myvendor.shop', 'api_key', '', '');  // чтение
Option::delete('myvendor.shop', ['name' => 'api_key']);
```

Параметры: `модуль, имя, значение, ID_САЙТА` (пустая строка = глобально). Для секретов лучше `.settings.php`, не БД (Option плохо переносится между средами и видно в админке).

## Логирование

D7-логгер (с Main 20.5):

```php
use Bitrix\Main\Diag\Logger;

Logger::getInstance('myvendor.shop')->info('Order {id} paid', ['id' => $orderId]);
```

Если стандартного логгера нет, пиши в `/bitrix/modules/myvendor.shop/logs/` через `error_log()` или `Bitrix\Main\Diag\FileLogger`. Не пиши в `bitrix.log` — там трассировки ядра.

## Очереди задач (фоновые)

Битрикс не имеет «настоящей» очереди типа RabbitMQ, но есть три рабочих варианта:

1. **Агенты** — крон-подобные функции, выполняются на хитах либо по cron (`cron_events.php`). Для редких задач (раз в N минут).
2. **Push & Pull** — отправка задач в shared-channel и обработка push-сервером. Хорошо для коротких операций.
3. **Свой воркер** — таблица `<vendor>_jobs`, CLI-скрипт по cron, который читает PENDING и обрабатывает с лимитом времени. Это самый надёжный путь для тяжёлых задач (выгрузка фидов, синхронизации).

Для агентов:

```php
\CAgent::AddAgent(
    'MyVendor\\Jobs::run();',  // важно: полное имя с экранированием обратных слэшей
    'myvendor.shop',
    'N',                        // не критичный
    300,                        // период в секундах
    '',                         // дата активации
    'Y',                        // активен
    \ConvertTimeStamp(time() + 300, 'FULL')
);
```

Метод агента **должен вернуть строку для самопересоздания**:

```php
namespace MyVendor;

class Jobs
{
    public static function run(): string
    {
        // работа
        return 'MyVendor\\Jobs::run();';
    }
}
```

## Application и Request

```php
use Bitrix\Main\Application;
use Bitrix\Main\Context;

$ctx = Application::getInstance()->getContext();
$request = $ctx->getRequest();   // \Bitrix\Main\HttpRequest
$server  = $ctx->getServer();
$response = $ctx->getResponse(); // в новом API

$id = (int)$request->get('id');
$isPost = $request->isPost();
$ajax = $request->isAjaxRequest();
```

## Авто-загрузка кастомных классов

В `init.php`:

```php
use Bitrix\Main\Loader;

Loader::registerAutoLoadClasses(null, [
    'MyVendor\\Shop\\OrderLogTable' => '/local/php_interface/include/orm/OrderLogTable.php',
]);
```

Либо через namespace-маппинг (с Main 20.x):

```php
Loader::registerNamespace('MyVendor\\Shop', $_SERVER['DOCUMENT_ROOT'].'/local/lib/shop');
```

PSR-4 через composer тоже работает, но нужно вручную подключить `vendor/autoload.php` в `init.php`.
