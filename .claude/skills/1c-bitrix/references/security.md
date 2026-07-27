# Безопасность

Битрикс — частая мишень: коробочные сайты с одинаковой структурой, известные пути (`/bitrix/admin/`), и легаси-код в проектах с долгой историей. Защита — не одна настройка, а гигиена в каждом куске кода.

## Защита публичных файлов

Каждый файл, выполняемый напрямую через URL (компонент, шаблон, ajax), должен начинаться с:

```php
<?php
if (!defined('B_PROLOG_INCLUDED') || B_PROLOG_INCLUDED !== true) {
    die();
}
```

Это гарантирует, что файл подключается только в контексте ядра. Без этого можно дёрнуть `template.php` напрямую (`/local/components/.../template.php?id=123`) и обойти всю обвязку.

## XSS

### В шаблонах

```php
// ПЛОХО
echo $arResult['ITEM']['NAME'];

// ХОРОШО
echo htmlspecialcharsbx($arResult['ITEM']['NAME']);

// для атрибутов
echo '<a href="' . htmlspecialcharsbx($url) . '">';

// для JS-литералов в HTML
echo '<script>var x = ' . \CUtil::PhpToJSObject($data) . ';</script>';
```

`htmlspecialcharsbx()` — битриксовый алиас, корректно работает с кодировкой сайта.

### Если поле — HTML (CKEditor, тип S:HTML)

```php
$html = $arResult['ITEM']['DETAIL_TEXT'];
$type = $arResult['ITEM']['DETAIL_TEXT_TYPE'];   // 'html' или 'text'

if ($type === 'html') {
    // уже HTML, но ВНИМАНИЕ: если контент-менеджер мог вставить произвольное —
    // нужна санитизация:
    $sanitizer = new \CBXSanitizer();
    $sanitizer->ApplyDoubleEncode(false);
    $sanitizer->SetLevel(\CBXSanitizer::SECURE_LEVEL_MIDDLE);
    echo $sanitizer->SanitizeHtml($html);
} else {
    echo nl2br(htmlspecialcharsbx($html));
}
```

`SecureLevel`:
- `LOW` — почти всё разрешено,
- `MIDDLE` — без тегов `<script>`, `<iframe>`, без `on*` атрибутов,
- `HIGH` — только базовые теги (p, b, i, ul, li, br, a с href).

Для контента, который пишут не админы (комментарии, отзывы) — `HIGH`.

## SQL-инъекции

### ORM защищает сама

```php
// безопасно
ElementTable::getList(['filter' => ['=NAME' => $userInput]]);
```

Префиксы операторов (`=`, `>`, `%`) — это часть API, а не SQL. Параметры экранируются.

### Параметризация для прямого SQL

```php
$conn = \Bitrix\Main\Application::getConnection();

// безопасно
$rows = $conn->query(
    'SELECT * FROM b_iblock_element WHERE NAME LIKE ?',
    ['%' . $conn->getSqlHelper()->forSql($userInput) . '%']
)->fetchAll();
```

Альтернатива:

```php
$sql = 'SELECT * FROM b_iblock_element WHERE NAME = "' . $conn->getSqlHelper()->forSql($userInput) . '"';
```

Но **параметризация лучше** — `forSql` экранирует кавычки, но не защитит от логических ошибок (например, ввод `1; DROP TABLE`).

### `$_GET['id']`

```php
// ПЛОХО
$conn->query("SELECT * FROM tbl WHERE ID = " . $_GET['id']);

// ХОРОШО
$id = (int)($_GET['id'] ?? 0);
$conn->query('SELECT * FROM tbl WHERE ID = ?', [$id]);
```

Простое `(int)` спасает от SQL-инъекций в числовом контексте — но не помогает, если поле строковое.

## CSRF

Любой POST-обработчик, который меняет данные, должен проверять `sessid`:

```php
use Bitrix\Main\Application;

$request = Application::getInstance()->getContext()->getRequest();

if (!$request->isPost() || !check_bitrix_sessid()) {
    \CHTTP::SetStatus('403 Forbidden');
    die();
}
```

С фронта:

```js
BX.ajax.runComponentAction(...)   // добавит sessid сам
BX.ajax({ data: { sessid: BX.bitrix_sessid(), ... } })
```

Engine\Controller с фильтром `Csrf` тоже проверяет автоматически.

Куда **не** ставить проверку: GET-обработчики, которые ничего не меняют (показ списка, поиск). Но любой `delete`, `update`, `add` — обязательно.

## Авторизация и права

```php
global $USER;

// проверка авторизации
if (!$USER->IsAuthorized()) { /* редирект на /auth/ */ }

// принадлежность группе
if (in_array(1, $USER->GetUserGroupArray())) { /* админ */ }

// проверка прав на инфоблок
if (\CIBlockRights::UserHasRightTo($iblockId, $elementId, 'element_edit')) {
    // можно редактировать
}

// проверка прав модулем
if ($USER->CanDoOperation('edit_php')) { /* права на редактирование PHP в админке */ }
```

ACL Битрикса работает на уровне модуля, инфоблока, элемента/раздела (если включены права на отдельные элементы — это медленнее, но точечнее).

## Загрузка файлов

```php
// допустимые типы по MIME
$allowed = ['image/jpeg', 'image/png', 'image/webp'];

if (!in_array($_FILES['photo']['type'], $allowed, true)) {
    throw new \RuntimeException('Bad file type');
}

// Битриксовый способ — учитывает реальный MIME
$file = \CFile::CheckImageFile($_FILES['photo']);
if ($file !== null && $file !== '') {
    throw new \RuntimeException($file);   // здесь — текст ошибки
}

$fileId = \CFile::SaveFile($_FILES['photo'], 'iblock');
```

`CheckImageFile` проверяет, что файл — действительно картинка (по байтам, не по расширению). Для не-картинок — `\CFile::CheckFile` с белым списком расширений.

**Никогда не сохраняй пользовательские файлы в директорию, доступную из веба, без `.htaccess`** с запретом выполнения PHP:

```apache
<Files *.php>
    Deny from all
</Files>
```

Стандартный `/upload/` Битрикса уже содержит такие правила — клади туда.

## Сессии и cookie

- Включи `session.cookie_httponly = 1` и `session.cookie_secure = 1` в `php.ini` (или `.settings.php`).
- Не храни в сессии ничего чувствительного открытым текстом — токены, пароли, номера карт.
- Проверь, что админская панель работает через HTTPS (HSTS заголовок).

## Защита от перебора

Битрикс имеет встроенный «proactive defense»:
- «Настройки → Проактивная защита» — фильтр запросов (WAF), уведомления, блокировки.
- Включи капчу на формах авторизации и регистрации.
- Ограничь количество попыток входа (модуль `security`, плагин «Контроль активности»).

## Скрытие технических путей

В `.htaccess` корня:

```apache
# скрыть Bitrix-специфичные пути от ботов
RedirectMatch 404 /bitrix/admin/(?!fileman_html_editor_action\.php|cache_dependencies)
RedirectMatch 404 /bitrix/php_interface/.*
```

Не открывай `/bitrix/admin/` миру — закрой по IP админов через nginx или basic auth поверх формы Битрикса.

## Маски-файлы и .htaccess

В `/upload/`:

```apache
# /upload/.htaccess
<FilesMatch "\.(php|phtml|phar)$">
    Deny from all
</FilesMatch>
```

Проверь, что они не были стёрты при кривом деплое.

## Проактивный фильтр

Модуль `security` (если поставлен) логирует подозрительные запросы и блокирует. Включается в админке. Для ложных срабатываний — добавляй исключения, не отключай весь модуль.

## Чек-лист перед прод-релизом

- [ ] Все обработчики POST проверяют `check_bitrix_sessid()`.
- [ ] Все вывод-узлы используют `htmlspecialcharsbx` или санитизер.
- [ ] Прямой SQL отсутствует, либо параметризован.
- [ ] `B_PROLOG_INCLUDED` стоит во всех `template.php`, `result_modifier.php`, `component.php`.
- [ ] `/bitrix/admin/` закрыт по IP или basic auth.
- [ ] HTTPS обязателен (редирект с HTTP).
- [ ] `session.cookie_httponly`, `session.cookie_secure` включены.
- [ ] `display_errors=Off`, `display_startup_errors=Off` в php.ini продакшна.
- [ ] `'exception_handling.debug' => false` в `.settings.php`.
- [ ] Бэкапы автоматические (минимум БД ежедневно).
- [ ] Проактивная защита включена.
- [ ] Двухфакторка (`security`) включена для администраторов.

## Грабли

- **`htmlspecialcharsEx` vs `htmlspecialcharsbx`** — обе экранируют, но первая сохраняет HTML-сущности (полезно для уже частично закодированных строк). Не путай: для пользовательских данных всегда `htmlspecialcharsbx`.
- **`die("OK")` в callback платёжной системы** — ловит проблема: некоторые платёжки требуют HTTP 200 + JSON в формате документации. `die` без формата = «провёл, но не подтверждено».
- **`exec`/`shell_exec` в коде** — Битрикс не блокирует, но это типичный вектор. Если уж нужно — белый список команд + `escapeshellarg`.
- **Незакрытые сессии** в долгих скриптах: `session_write_close()` после получения данных, иначе блокировка сессии не даст параллельным запросам идти.
- **Прямое чтение `$_FILES['x']['name']`** для имени — пользователь может прислать `../../../tmp/x.php`. Используй `\CFile::SaveFile`, который сам генерит безопасное имя.
