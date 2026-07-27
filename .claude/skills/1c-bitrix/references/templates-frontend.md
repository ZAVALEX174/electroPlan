# Шаблоны сайта и фронтенд (BX.* JS API)

Шаблон сайта — обвязка вокруг рабочей области страницы. Лежит в `/local/templates/<имя>/`.

## Структура шаблона сайта

```
/local/templates/main/
├── header.php           # всё ДО $APPLICATION->ShowMainContent()
├── footer.php           # всё ПОСЛЕ
├── description.php      # имя/описание шаблона для админки
├── styles.css           # стили рабочей области (доступны в редакторе как «стили шаблона»)
├── template_styles.css  # стили шаблона (header/footer)
├── script.js
├── include_areas/       # включаемые области (контакты в шапке и т.п.)
├── components/          # переопределения шаблонов компонентов для этого шаблона сайта
└── lang/
```

## Базовый header.php

```php
<?php if (!defined('B_PROLOG_INCLUDED') || B_PROLOG_INCLUDED !== true) die();

use Bitrix\Main\Page\Asset;

/** @var \CMain $APPLICATION */
?>
<!DOCTYPE html>
<html lang="<?= LANGUAGE_ID ?>">
<head>
    <?php $APPLICATION->ShowHead(); ?>
    <title><?php $APPLICATION->ShowTitle(); ?></title>
    <?php
    Asset::getInstance()->addCss(SITE_TEMPLATE_PATH . '/styles.css');
    Asset::getInstance()->addJs(SITE_TEMPLATE_PATH . '/script.js');
    ?>
</head>
<body>
<?php $APPLICATION->ShowPanel(); ?>
<header>
    <a href="/" class="logo">Логотип</a>
    <?php $APPLICATION->IncludeComponent('bitrix:menu', 'top', [
        'ROOT_MENU_TYPE'      => 'top',
        'CACHE_TYPE'          => 'A',
        'CACHE_TIME'          => '3600',
        'MENU_CACHE_USE_GROUPS' => 'N',
    ]); ?>
</header>
<main>
```

И `footer.php`:

```php
</main>
<footer>...</footer>
<?php $APPLICATION->ShowBodyScripts(); ?>
</body>
</html>
```

## `Asset` (сборщик CSS/JS)

С Main 16.x. Заменяет `$APPLICATION->SetAdditionalCSS/AddHeadScript`:

```php
use Bitrix\Main\Page\Asset;

$asset = Asset::getInstance();
$asset->addCss('/local/templates/main/css/main.css');
$asset->addJs('/local/templates/main/js/main.js');
$asset->addString('<meta name="og:title" content="..." />');

// сборка нескольких CSS в один файл
$asset->setCssList([
    'PAGE' => true,        // объединять
    'SHOW' => true,
    'COMPRESS' => true,    // gzip
]);
```

В `.settings.php` глобально:

```php
'pull' => [...],
'main' => [
    'value' => [
        'optimize_css_files' => 'Y',
        'optimize_js_files'  => 'Y',
        'compress_css_files' => 'Y',
    ],
],
```

## API ядра в шапке/подвале

```php
// заголовок страницы
$APPLICATION->SetTitle('Каталог');

// мета
$APPLICATION->SetPageProperty('description', 'Описание');
$APPLICATION->SetPageProperty('keywords', 'ключи');

// добавить класс к body
$APPLICATION->SetPageProperty('BodyClass', 'page-catalog');

// breadcrumbs
$APPLICATION->AddChainItem('Раздел', '/section/');
```

В `.default.menu.php` (меню):

```php
$aMenuLinks = [
    ['Главная', '/', [], ['ROOT' => 'Y'], ''],
    ['Каталог', '/catalog/', [], [], ''],
    ['О нас',   '/about/',  [], [], 'CSite::InGroup([1])'],   // условие показа (PHP)
];
```

## Включаемые области

Файлы вида `include_areas/header_phones.php` правятся через визуальный редактор админкой:

```php
$APPLICATION->IncludeFile(
    SITE_TEMPLATE_PATH . '/include_areas/header_phones.php',
    [],
    ['MODE' => 'html', 'NAME' => 'Телефоны в шапке']
);
```

`MODE => 'html'` запускает встроенный визуальный редактор, `'php'` — открывает в редакторе кода.

## BX.* JS API (клиент)

Главное ядро на странице — `BX.*`. Доступно после подключения core (включается в шаблоне через `$APPLICATION->ShowHead()`).

### События и DOM

```js
BX.ready(function () {
    var btn = BX('my-button-id');         // = document.getElementById
    BX.bind(btn, 'click', onClick);
});

function onClick(e) {
    e.preventDefault();
    BX.toggleClass(this, 'active');
}
```

### AJAX

```js
// современный (компонент-экшены)
BX.ajax.runComponentAction('mycompany:news.list', 'loadMore', {
    mode: 'class',
    data: { page: 2 }
})
.then(({ data, status }) => console.log(data));

// модуль-экшены (REST-стиль)
BX.ajax.runAction('mymodule.controller.list', {
    data: { id: 42 }
});

// «голый» POST
BX.ajax({
    url: '/local/ajax/handler.php',
    method: 'POST',
    dataType: 'json',
    data: { sessid: BX.bitrix_sessid(), ... },
    onsuccess: r => console.log(r)
});
```

### Расширения (`Bitrix\Main\UI\Extension`)

Готовые JS-модули в `/bitrix/js/`:
- `ui.alerts`, `ui.buttons`, `ui.dialogs.messagebox`
- `loader` (спиннер)
- `popup`, `menu`
- `pull` (push-канал)
- `sidepanel` (боковая панель админки)

Подключение из PHP:

```php
\Bitrix\Main\UI\Extension::load(['ui.alerts', 'ui.dialogs.messagebox']);
```

Свои JS-модули регистрируются через `bundle.config.js` или `config.php` рядом с JS-файлом.

### MessageBox

```js
BX.UI.Dialogs.MessageBox.confirm(
    'Удалить элемент?',
    function (messageBox, button) {
        // confirm
        messageBox.close();
    },
    'Удалить'
);
```

## Push & Pull (push-сервер)

Для веб-сокетов: установка push-сервера + модуль `pull`.

```php
\Bitrix\Pull\Event::add(
    $userId,
    [
        'module_id' => 'myvendor.shop',
        'command'   => 'order.updated',
        'params'    => ['orderId' => 100, 'status' => 'F'],
    ]
);
```

Клиент:

```js
BX.PULL.subscribe({
    moduleId: 'myvendor.shop',
    callback: data => {
        if (data.command === 'order.updated') {
            // обновить UI
        }
    }
});
```

## Композит, кеш HTML

Включается в админке: «Настройки → Производительность → Композитный сайт». Принцип: первый хит генерирует HTML, кладёт в `bitrix/cache/composite/`, последующие отдаются nginx'ом до PHP. Динамика обновляется AJAX'ом.

Что нужно проверить, если включаешь:
- Все компоненты с user-зависимым выводом помечены как динамические или вынесены в эпилог.
- Нет «прыжков»: если до AJAX'а блок пустой, верстай скелетон.
- В шаблоне нет случайных значений (`mt_rand()`) — они закешируются.
- Cookie-зависимая логика (рекомендации, A/B) — через JS.

## Грабли

- **`$APPLICATION->ShowHead()` отсутствует** в шапке — ничего из `Asset::addCss/Js` не выведется.
- **`die()` в `header.php`** ломает буферизацию `MainContent` — не используй ранние выходы.
- **Минификация CSS/JS** объединяет ВСЕ добавленные ассеты, включая инлайн-зависимости компонентов. Ищи проблемы в `/bitrix/cache/css/` / `/bitrix/cache/js/`.
- **Кеш меню** хранится по группам пользователя — если включил `MENU_CACHE_USE_GROUPS=Y`, обнови всех пользователей при изменении прав.
- **`SITE_TEMPLATE_PATH`** в эпилогах компонентов — может быть пустым, если компонент рендерится в админке/CLI. Перепроверяй.
