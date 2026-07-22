# Интеграция ElectroPlan в 1С-Битрикс

Структура готова к переносу на боевой сайт: содержимое `local/` кладётся в `local/`
корня Битрикс. Заказчик — **ЦентрСвет**, идентификатор модуля — `centrsvet.electroplan`,
пространство имён — `Centrsvet\Electroplan`.

## Структура

```
local/
├─ modules/centrsvet.electroplan/
│  ├─ install/
│  │  ├─ index.php            класс установки (centrsvet_electroplan)
│  │  └─ version.php          версия модуля
│  ├─ lib/                    PSR-4 автозагрузка → Centrsvet\Electroplan\*
│  │  ├─ Controller/          AJAX-контроллеры (новое ядро Bitrix\Main\Engine)
│  │  │  ├─ Catalog.php       ← DataService.getProducts / GET /api/products
│  │  │  ├─ Post.php          ← DataService.*Post   / /api/posts
│  │  │  └─ Project.php       ← ProjectStore        / /api/projects
│  │  ├─ Catalog/ProductRepository.php     чтение товаров из инфоблока каталога
│  │  ├─ Post/PostTemplateRepository.php   шаблоны постов (Highload-блок)
│  │  └─ Project/ProjectRepository.php     проекты (Highload-блок/инфоблок)
│  ├─ .settings.php           регистрация namespace AJAX-контроллеров
│  ├─ include.php             точка расширения модуля
│  ├─ options.php             страница настроек (ID инфоблока каталога)
│  └─ lang/ru/                локализация
└─ components/centrsvet/electroplan.app/
   ├─ class.php               компонент, отдаёт каталог во фронт
   ├─ .description.php / .parameters.php
   └─ templates/.default/
      ├─ template.php         разметка (перенос из index.html — PLAN 2.1)
      ├─ data-adapter.js      Bitrix-версия DataService (замена js/data.js)
      ├─ script.js            логика (перенос из js/app.js — PLAN 2.1)
      └─ style.css            стили (перенос из css/styles.css — PLAN 2.1)
```

## Как это соотносится с прототипом

| Прототип                       | Битрикс                                                        |
|--------------------------------|---------------------------------------------------------------|
| `js/data.js` (DataService/mock)| `data-adapter.js` + контроллеры `lib/Controller/*`            |
| `EP_DATA.products`             | инфоблок «Торговый каталог» → `ProductRepository`             |
| LocalStorage `ep_post_templates`| Highload-блок `EpPostTemplates` → `PostTemplateRepository`   |
| `js/store.js` (ProjectStore)   | Highload-блок/инфоблок `EpProjects` → `ProjectRepository`     |
| `js/app.js`, `index.html`, css | шаблон компонента `electroplan.app`                          |

Ключ: вся бизнес-логика фронта обращается к данным только через `window.DataService`,
поэтому переход «прототип → Битрикс» не затрагивает `app.js` — меняется лишь адаптер.

## Установка

1. Скопировать `local/` в корень Битрикс.
2. Админка → Marketplace → Установленные решения → установить «ElectroPlan».
3. Настройки модуля → указать ID инфоблока каталога.
4. Разместить компонент `centrsvet:electroplan.app` на нужной странице/в разделе.

## Что ещё не сделано (см. PLAN.md)

- Импорт прайса VIMAR в каталог Битрикс — раздел 1.
- Highload-блоки постов и проектов — DoInstall() + репозитории (6.3, 6.4).
- Перенос разметки/логики/стилей прототипа в шаблон компонента (2.1).
- Серверная генерация PDF КП (6.7).
- Авторизация/права через пользователей Битрикс (6.6).

AJAX-экшены вызываются как `centrsvet:electroplan.Catalog.list`,
`centrsvet:electroplan.Post.save` и т.д.
