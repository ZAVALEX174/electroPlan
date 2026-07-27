# Компоненты и шаблоны компонентов

Компонент — единица переиспользуемого функционала с шаблоном. Лежат в `/local/components/<namespace>/<component>/` (или коробочные — `/bitrix/components/bitrix/...`).

## Анатомия компонента

```
news.list/
├── .description.php       # имя компонента, описание, иконка для админки
├── .parameters.php        # описание параметров (для редактора)
├── component.php          # «контроллер»: получает данные в $arResult
├── class.php              # альтернатива component.php — ООП-вариант (предпочтительнее)
├── component_epilog.php   # выполняется ПОСЛЕ кеша (auth-зависимое)
├── lang/                  # языковые файлы (ru/, en/, ...)
└── templates/
    └── .default/
        ├── template.php   # вёрстка
        ├── style.css
        ├── script.js
        ├── result_modifier.php  # правка $arResult после получения, до кеша шаблона
        ├── component_epilog.php # эпилог шаблона (после кеша)
        └── lang/
```

## ООП-компонент через `class.php`

Это путь по умолчанию для нового кода — наследует базовый класс `\CBitrixComponent`.

```php
<?php
if (!defined('B_PROLOG_INCLUDED') || B_PROLOG_INCLUDED !== true) die();

use Bitrix\Main\Loader;
use Bitrix\Main\Localization\Loc;

Loc::loadMessages(__FILE__);

class NewsListComponent extends \CBitrixComponent
{
    public function onPrepareComponentParams($arParams): array
    {
        $arParams['IBLOCK_ID'] = (int)($arParams['IBLOCK_ID'] ?? 0);
        $arParams['CACHE_TIME'] = (int)($arParams['CACHE_TIME'] ?? 3600);
        $arParams['NEWS_COUNT'] = max(1, (int)($arParams['NEWS_COUNT'] ?? 10));
        return $arParams;
    }

    public function executeComponent()
    {
        if (!Loader::includeModule('iblock')) {
            ShowError(Loc::getMessage('NEWS_LIST_MODULE_NOT_INSTALLED'));
            return;
        }

        if ($this->StartResultCache(false, $this->getCacheKeys())) {
            $this->arResult['ITEMS'] = $this->fetchItems();
            $this->setResultCacheKeys(['ITEMS']);
            $this->includeComponentTemplate();
        }
    }

    protected function getCacheKeys(): array
    {
        return [
            $this->arParams['IBLOCK_ID'],
            $this->arParams['NEWS_COUNT'],
            // не клади сюда USER_ID или текущее время — это убьёт кеш
        ];
    }

    protected function fetchItems(): array
    {
        $rows = \Bitrix\Iblock\ElementTable::getList([
            'select' => ['ID', 'NAME', 'PREVIEW_TEXT', 'CODE'],
            'filter' => ['=IBLOCK_ID' => $this->arParams['IBLOCK_ID'], '=ACTIVE' => 'Y'],
            'order'  => ['ACTIVE_FROM' => 'DESC'],
            'limit'  => $this->arParams['NEWS_COUNT'],
        ])->fetchAll();
        return $rows;
    }
}
```

В `component.php` тогда:

```php
<?php
if (!defined('B_PROLOG_INCLUDED') || B_PROLOG_INCLUDED !== true) die();
// component.php нужен Битриксу, но если есть class.php — оставь его пустым кроме защиты выше.
```

## Вызов компонента

```php
$APPLICATION->IncludeComponent(
    'mycompany:news.list',           // namespace:name
    '.default',                      // имя шаблона
    [
        'IBLOCK_ID'  => 5,
        'NEWS_COUNT' => 10,
        'CACHE_TYPE' => 'A',         // A=auto, Y=on, N=off
        'CACHE_TIME' => 3600,
    ],
    false,                           // родительский компонент (если вложенный)
    ['HIDE_ICONS' => 'Y']            // доп. флаги (HIDE_ICONS убирает иконки правки)
);
```

## Шаблон компонента

В `template.php` доступны: `$arParams`, `$arResult`, `$this` (объект `\CBitrixComponentTemplate`), `$component`, `$templateName`, `$templateFile`, `$templateFolder`.

```php
<?php if (!defined('B_PROLOG_INCLUDED') || B_PROLOG_INCLUDED !== true) die(); ?>

<ul class="news-list">
<?php foreach ($arResult['ITEMS'] as $item): ?>
    <li>
        <a href="<?= htmlspecialcharsbx($item['DETAIL_PAGE_URL'] ?? '#') ?>">
            <?= htmlspecialcharsbx($item['NAME']) ?>
        </a>
    </li>
<?php endforeach; ?>
</ul>
```

**Важно: всегда экранируй `$arResult` в шаблоне.** Если данные пришли из БД, в кеше они уже могут быть «отравлены». Не полагайся на источник.

## `result_modifier.php` vs `component_epilog.php`

| Файл | Когда выполняется | Для чего |
|---|---|---|
| `result_modifier.php` (в шаблоне) | До кеша шаблона, после получения данных | Правка/обогащение `$arResult`, попадает в кеш |
| `component_epilog.php` (компонент или шаблон) | После кеша (на каждом хите) | Auth-зависимое: текущий пользователь, корзина, права |

Никогда не делай тяжёлых выборок в эпилоге — он не кешируется.

## Подключение CSS/JS из шаблона

`style.css` и `script.js` рядом с `template.php` подцепятся автоматически. Дополнительно:

```php
<?php
$this->addExternalCss('/local/templates/main/css/swiper.min.css');
$this->addExternalJs('/local/templates/main/js/swiper.min.js');
\Bitrix\Main\UI\Extension::load(['ui.alerts', 'ui.buttons']);
```

`Extension::load` грузит готовые UI-модули Битрикса (есть в `/bitrix/js/ui/`).

## AJAX в компоненте

Современный путь — **AJAX-контроллер компонента** (с Main 19.5):

```php
// class.php
class NewsListComponent extends \CBitrixComponent implements \Bitrix\Main\Engine\Contract\Controllerable
{
    public function configureActions(): array
    {
        return [
            'loadMore' => [
                'prefilters' => [
                    new \Bitrix\Main\Engine\ActionFilter\HttpMethod(['POST']),
                    new \Bitrix\Main\Engine\ActionFilter\Csrf(),
                ],
            ],
        ];
    }

    public function loadMoreAction(int $page = 1, int $iblockId = 0): array
    {
        // вернёт JSON автоматически
        return ['items' => $this->fetchPage($iblockId, $page)];
    }
}
```

Вызов с фронта:

```js
BX.ajax.runComponentAction('mycompany:news.list', 'loadMore', {
    mode: 'class',
    data: { page: 2, iblockId: 5 },
}).then(({ data }) => {
    console.log(data.items);
});
```

Старый путь — `ajax.php` рядом с компонентом и `BX.ajax.post()` — рабочий, но не рекомендуется для нового кода: придётся вручную делать sessid, права, валидацию.

## Композитный сайт

Композит делит страницу на статичную (кешируется как HTML и отдаётся nginx) и динамичную (заполняется AJAX'ом). Чтобы блок попал в динамику:

```php
$this->arResult['IS_LOGGED_IN'] = $USER->IsAuthorized();
// ...
// В шаблоне:
$APPLICATION->RestartBuffer();    // <-- помечает как динамический
echo '<div data-bx-id="auth-block">' . ($arResult['IS_LOGGED_IN'] ? 'logged' : 'guest') . '</div>';
```

Базовая стратегия: всё, что зависит от пользователя/корзины, выноси в эпилог + помечай как динамическое. Иначе кеш разлетится.

## Грабли

- **Кеш-ключи не учитывают параметр** — компонент кешируется без учёта значения, и при смене входов отдаёт старые данные. Перечисляй все значимые параметры в `getCacheKeys()`.
- **В `setResultCacheKeys` забыли поле** — оно не попадёт в кеш, и при холодном чтении кеша его не будет. По умолчанию кешируется всё, что в `$arResult`, но если ты явно вызвал `setResultCacheKeys(['ITEMS'])`, попадает только перечисленное.
- **AJAX-экшен возвращает HTML** — Engine\Контроллер ждёт скаляр/массив/объект, рендер HTML — отдельный паттерн (через `\Bitrix\Main\HttpResponse`).
- **Шаблон стандартного компонента кастомизируется через копирование** — копируй из `/bitrix/components/bitrix/<name>/templates/.default/` в `/local/templates/<site_template>/components/bitrix/<name>/<your_template>/`. Не правь оригинал.
- **Иконка правки на публичке смещает вёрстку** — перед `IncludeComponent` ставь `'HIDE_ICONS' => 'Y'` в `$arParams` или оборачивай в контейнер с `position: relative`.
