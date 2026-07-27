# Администрирование, агенты, миграции, REST, обмен 1С, BP

Всё, что относится к серверной части и интеграциям.

## Агенты (планировщик Битрикса)

Агент = функция, выполняемая по расписанию. Есть два режима выполнения:

1. **На хитах (по умолчанию)** — Битрикс при каждом запросе проверяет, не пора ли запустить агента. Минусы: задержки, неравномерность, проблемы на низкой посещаемости.
2. **По cron** — `php /bitrix/modules/main/tools/cron_events.php` каждую минуту. **Так делают все боевые проекты.**

Включить cron-режим в `/bitrix/php_interface/dbconn.php`:

```php
define('BX_CRONTAB_SUPPORT', true);
if (defined('BX_CRONTAB')) {
    define('CHK_EVENT', true);
}
```

И в crontab:

```cron
* * * * * /usr/bin/php -f /home/bitrix/www/bitrix/modules/main/tools/cron_events.php > /dev/null 2>&1
```

### Регистрация агента

```php
\CAgent::AddAgent(
    'MyVendor\\Shop\\Cron::syncStocks();',  // имя функции (вернёт сама себя)
    'myvendor.shop',                         // ID модуля
    'N',                                     // не критичный (Y — упадёт сайт, если зафейлит)
    300,                                     // интервал в секундах
    '',                                      // дата активации (пусто = сразу)
    'Y',                                     // активен
    \ConvertTimeStamp(time() + 300, 'FULL'), // следующий запуск
    100                                      // приоритет (по умолч. 100)
);
```

Класс агента:

```php
namespace MyVendor\Shop;

class Cron
{
    public static function syncStocks(): string
    {
        try {
            // ... работа
        } catch (\Throwable $e) {
            // лог, не пробрасываем — иначе агент может удалиться
            \Bitrix\Main\Diag\Logger::getInstance('myvendor.shop')->error($e);
        }
        return __CLASS__ . '::syncStocks();';   // обязательный возврат
    }
}
```

Удаление агента:

```php
\CAgent::RemoveAgent('MyVendor\\Shop\\Cron::syncStocks();', 'myvendor.shop');
```

Лимиты:
- Агенты выполняются **последовательно** в одном процессе. Тяжёлый агент тормозит остальных.
- Если агент падает с фаталом — он остаётся в очереди и снова попытается выполниться. Не делай долгих/нестабильных операций здесь.
- Для долгих задач — отдельный CLI-скрипт по cron, не агент.

## Миграции структуры

Битрикс не имеет встроенной системы миграций (в смысле Doctrine/Laravel). Подходы:

### Вариант 1. Sprint Migration (сторонний)

Самый популярный пакет, ставится через composer или вручную:

```bash
composer require sprint-migration/sprint-migration
```

Команды:

```bash
php bin/console.php sprint:migration:create AddBrandPropertyToCatalog
php bin/console.php sprint:migration:up
php bin/console.php sprint:migration:down
```

Миграция — класс с `up()` и `down()`. Хранит состояние в таблице `sprint_migration_versions`. Поддерживает шаблоны для типичных задач (создание инфоблока, добавление свойства, создание HL-блока и т.п.).

### Вариант 2. Свой install/index.php в модуле

Стандартный коробочный путь — модуль с `install/index.php`, методами `InstallDB`, `InstallEvents`, `InstallFiles`, `UnInstall*`. Там делаешь `\CAgent::AddAgent`, `Option::set`, прямой DDL и т.п. Минус: одноразовый запуск (при установке). Не подходит для эволюции схемы.

### Вариант 3. Чистые SQL-миграции

Свой скрипт, который читает `migrations/*.sql`, выполняет в порядке имени, отмечает в таблице `_migrations`. Подходит, если структура простая.

Для нового проекта рекомендация — **sprint-migration**.

## REST API Битрикса (Bitrix24)

Если стоит модуль `rest` (входит в Bitrix24), доступны:

### Webhooks (входящие)

В админке создаётся webhook вида `https://example.com/rest/1/<token>/<method>`. Используется для интеграций «снаружи».

```bash
curl -X POST 'https://example.com/rest/1/abcd1234/crm.lead.add' \
  -d 'fields[TITLE]=Новый лид&fields[NAME]=Иван'
```

### Свои REST-методы

```php
use Bitrix\Rest\RestException;
use Bitrix\Main\EventManager;

EventManager::getInstance()->addEventHandler('rest', 'OnRestServiceBuildDescription', [
    'MyVendor\\Shop\\Rest', 'onBuild'
]);

class Rest
{
    public static function onBuild(): array
    {
        return [
            'myvendor.shop' => [
                'myvendor.shop.product.list' => [__CLASS__, 'productList'],
            ],
        ];
    }

    public static function productList(array $params): array
    {
        // $params содержит входные параметры запроса
        return ['items' => [...]];
    }
}
```

### Контроллеры (Bitrix\Main\Engine)

Свой REST-эндпоинт без модуля `rest`:

```php
namespace MyVendor\Shop\Controller;

use Bitrix\Main\Engine\Controller;
use Bitrix\Main\Engine\ActionFilter;

class Product extends Controller
{
    public function configureActions(): array
    {
        return [
            'list' => [
                'prefilters' => [
                    new ActionFilter\Authentication(),
                    new ActionFilter\HttpMethod([ActionFilter\HttpMethod::METHOD_GET]),
                ],
            ],
        ];
    }

    public function listAction(int $iblockId, int $limit = 50): array
    {
        return ['items' => [...]];
    }
}
```

Регистрация маршрута: новый роутер (Main 22.x) в `/local/routes/api.php`:

```php
use Bitrix\Main\Routing\RoutingConfigurator;

return function (RoutingConfigurator $routes) {
    $routes->prefix('/api/v1')->group(function (RoutingConfigurator $routes) {
        $routes->get('/products', [\MyVendor\Shop\Controller\Product::class, 'listAction']);
    });
};
```

И в `/bitrix/.settings.php`:

```php
'routing' => [
    'value' => [
        'config' => ['/local/routes/api.php'],
    ],
],
```

## Обмен с 1С (CommerceML 2)

Стандартный обмен с «1С: Управление торговлей» / «1С: ERP» по протоколу CommerceML. Модуль `catalog` его умеет «из коробки» через хэндлер `/bitrix/admin/1c_exchange.php`.

Что обменивается:
- Каталог (товары, разделы, свойства, цены, остатки) — направление 1С → Битрикс.
- Заказы (новые заказы, статусы) — Битрикс ↔ 1С.

Настройка:
1. Админка → «Магазин → Настройки → Обмен с 1С → Создать профиль».
2. Указать URL `/bitrix/admin/1c_exchange.php` и логин админа в 1С.
3. На стороне 1С — стандартная обработка «Обмен с сайтом».

### События обмена

```php
EventManager::getInstance()->addEventHandler(
    'sale',
    'OnSaleComponentOrderOneCImportBeforeUpdate',
    static function (\Bitrix\Main\Event $event) {
        // правка заказа перед обновлением из 1С
    }
);
```

Список — `dev.1c-bitrix.ru/api_help/sale/1c_events/`.

### Кастомизация формата выгрузки

Если коробочного формата не хватает, пишется свой обработчик: наследник `\CSaleOrderLoader` (старое API) или хук на `OnSaleOrderXmlFile`. Для каталога — `OnIBlockCMLImport`.

Для нестандартных интеграций (своя ERP, не «1С: УТ») часто проще написать **свой обмен через REST/SOAP**, не пытаясь вписаться в CommerceML. CommerceML — XML-протокол, развивавшийся 20 лет, и его кастомизация местами болезненна.

## Бизнес-процессы (модуль bizproc)

Конструктор бизнес-процессов с шаблонами. Используется в Bitrix24 (CRM, документооборот). Программно:

### Запуск процесса

```php
use Bitrix\Main\Loader;
Loader::includeModule('bizproc');

$errors = [];
$result = \CBPDocument::StartWorkflow(
    $templateId,
    ['lists', 'BizprocDocument', $listElementId],   // тип документа
    [],                                             // параметры
    $errors
);
```

### Своя активити (действие)

Лежит в `/local/activities/<vendor>/<name>/`. Минимально:

```
my_action/
├── .description.php       # name, description, icon, type, return values
├── icon.png
└── my_action.php          # класс с методом Execute()
```

Класс наследует `\CBPActivity`:

```php
class CBPMyAction extends \CBPActivity
{
    public function __construct($name)
    {
        parent::__construct($name);
        $this->arProperties = [
            'Title'  => '',
            'OrderId'=> null,
        ];
    }

    public function Execute()
    {
        $orderId = $this->OrderId;
        // работа
        return \CBPActivityExecutionStatus::Closed;
    }

    public static function ValidateProperties($testProperties = [], \CBPWorkflowTemplateUser $user = null)
    {
        $errors = [];
        if (empty($testProperties['OrderId'])) {
            $errors[] = ['code' => 'NotExist', 'parameter' => 'OrderId', 'message' => 'OrderId required'];
        }
        return array_merge($errors, parent::ValidateProperties($testProperties, $user));
    }
}
```

После добавления — сбрось кеш (`BXClearCache(true)`), активити появится в конструкторе.

## Push-сервер и модуль pull

Push-сервер — отдельный nginx+nodejs процесс, ставится скриптом `/bitrix/modules/pull/push-server-deploy.sh`. Используется для уведомлений в реальном времени.

```php
// серверная отправка
\Bitrix\Pull\Event::add(
    [$userId1, $userId2],
    [
        'module_id' => 'myvendor.shop',
        'command'   => 'order.statusChanged',
        'params'    => ['orderId' => 100, 'status' => 'F'],
    ]
);
```

Если push-сервера нет, события всё равно зарегистрируются в БД — клиент заберёт их long-polling'ом, но с задержкой.

## Логи и диагностика

| Источник | Где |
|---|---|
| Ошибки PHP ядра | `/bitrix/php_interface/log.txt` (если включено `'exception_handling' => ['log' => [...]]` в `.settings.php`) |
| Лог обмена с 1С | `/bitrix/catalog_load/` (XML) и `/bitrix/admin/1c_exchange.php?type=...&mode=debug` |
| Лог отправки писем | модуль `mail` — `b_event` (что отправлено), `b_event_message_log` (логи) |
| Производительность | админка «Производительность → Монитор», логи `/bitrix/managed_cache/` |

Включение детальных логов в `.settings.php`:

```php
'exception_handling' => [
    'value' => [
        'debug' => true,
        'handled_errors_types' => E_ALL,
        'log' => [
            'class_name' => 'Bitrix\\Main\\Diag\\FileLogger',
            'settings'   => ['file' => '/bitrix/logs/bitrix.log', 'log_size' => 1000000],
        ],
    ],
    'readonly' => true,
],
```

## Деплой и обновления

- Обновления ставятся через админку («Marketplace → Обновления»). На проде это делать вручную, не автоматом.
- Перед обновлением — бэкап БД и `/bitrix/`.
- После обновления — проверь права на файлы и запусти `bitrix/admin/repair.php` если что-то отвалилось.
- В Git заводи `/bitrix/` через `.gitignore` (исключи всё, кроме критичных файлов: `.settings.php`, `.htaccess`, шаблонов, своих модулей если в `/bitrix/modules/` — что не рекомендуется).
- Минимум для git: `/local/`, `/upload/iblock/.htaccess`, `/.htaccess`, `/bitrix/.settings.php`, `/bitrix/templates/<твои_шаблоны>/`.

## Грабли

- **Агент в режиме хитов** на сайте с малой посещаемостью — не выполняется. Включай cron-режим.
- **`CHK_EVENT` константа** — без неё cron-агенты не запускаются. Проверяй `dbconn.php`.
- **Модуль выключили в админке** — `Loader::includeModule()` вернёт false и весь функционал умрёт молча. Логируй неудачи.
- **`\CAgent::AddAgent` с тем же именем** — добавится дубликат. Перед добавлением — `RemoveAgent`.
- **Имя агента в строке** — двойной обратный слэш для namespace: `'MyVendor\\Shop\\Cron::syncStocks();'`. Один слэш — фатал.
- **Обмен с 1С падает на больших каталогах** — увеличь `memory_limit`, `max_execution_time`, `BX_FILE_MAX_FILE_SIZE_*` в php-cli; следи за выгрузкой пакетами (1С отдаёт XML кусками, Битрикс импортит — паузы между пакетами должны быть `0`).
