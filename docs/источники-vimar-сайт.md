# Каталог vimar.ru — ссылки и структура сайта

Ссылки прислал заказчик 01.08.2026. Ниже — что на сайте лежит, как он устроен и что из
этого нам полезно. Дополняет [карту фирменных каталогов в PDF](каталоги-vimar-pdf.md)
и [расшифровку FAQ](faq-vimar-сервис.md).

## Разделы серий (то, что прислал заказчик)

| Серия | Ссылка |
|---|---|
| Eikon Tactil | https://vimar.ru/catalog/production/eikon-tactil/ |
| Eikon Evo | https://vimar.ru/catalog/production/eikon-evo/ |
| Eikon | https://vimar.ru/catalog/production/eikon/ |
| Eikon Exé | https://vimar.ru/catalog/production/eikon-exe/ |
| Arké | https://vimar.ru/catalog/production/arke/ |
| Idea | https://vimar.ru/catalog/production/idea/ |
| Plana | https://vimar.ru/catalog/production/plana+main/ |
| Neve Up | https://vimar.ru/catalog/production/neve-up/ |
| Дополнительное оборудование | https://vimar.ru/catalog/production/dopolnitelnoe-oborudovanie/ |

## Как устроен каталог

Сайт раскладывает ассортимент **по группам внутри каждой серии** — и это самое ценное для
нас, потому что даёт НЕЗАВИСИМОЕ мнение о виде товара (у нас вид берётся из колонки
«Функциональная группа» номенклатуры заказчика).

Групп 47, имена говорящие:

- накладки — `nakladki`, `nakladki-evo`, `nakladki-arke`, `nakladki-eikon`,
  `nakladki-eikon-exe`, `nakladki-idea`, `nakladki-plana`, `nakladki-tactil`
- механизмы — `mekhanizmy-evo`, `mekhanizmy-arke`, `mekhanizmy-eikon`, `mekhanizmy-idea`,
  `mekhanizmy-plana`, `mekhanizmy-tactil`, `mekhanizmy-flatvintage`
- суппорты — `supporta`, `supporta-arke`, `supporta-eikon`, `supporta-evo`,
  `supporta-idea`, `supporta-plana`
- аксессуары — `aksessuary-arke`, `aksessuary-eikon`, `aksessuary-evo`, `aksessuary-idea`,
  `aksessuary-plana`, `aksessuary-tactil`
- прочее — `montazhnye-korobki`, `osvetitelnye-komponenty`, `komponenty-prochie`,
  `ustroystva-avtomatizatsii` (и серийные варианты), `sistemy`, `prochee`
- `katalogi-dlya-prosmotra` — это PDF-каталоги, не товары

Технические особенности, проверены вручную:

- страница группы: `https://vimar.ru/catalog/production/<группа>/`, пагинация через
  `?PAGEN_1=N` (у некоторых групп до 14 страниц);
- **артикулы видны прямо в листинге** обычным текстом (`21668.01`, `21668.17` и т. д.) —
  чтобы собрать классификацию, заходить в карточки товаров не нужно;
- карточка товара лежит по адресу `/catalog/production/<группа>/<slug>/` и содержит артикул,
  цвет, материал и картинки;
- нужен заголовок `User-Agent` обычного браузера, иначе бывают отказы;
- поиска по сайту нет (`/search/` отдаёт 404) — навигация только по группам.

## Что уже сверено

**Фотографии те же, что у нас.** Проверил карточки `nakladka-na-3-modulya-chernaya`
(09673.04) и `nakladka-na-4-modulya-2-2-belaya` (09664.01) — картинки указывают на те же
файлы `/upload/iblock/...`, что уже лежат в нашем индексе изображений. То есть надежда
найти на сайте нормальные снимки вместо макро-кадров угла (те 23 базы накладок, которые у
нас уходят на схему-фолбэк) **не оправдалась** — там те же самые кадры.

**На сайте встречаются ошибки в карточках.** Страница
`nakladki/nakladka-na-1-modul-tsentralno-dlya-korobki-na-2-modulya-ardeziya/` показывает
артикул `09662.03`, хотя `09662.03` — это «Накладка на 2 модуля, ардезия» (её собственная
страница это подтверждает). Похоже на копипасту в карточке. Вывод: **при расхождении
доверяем номенклатуре заказчика, а не карточке сайта**; сайт используем как второе мнение
о ГРУППЕ товара, а не как источник артикулов.

## Что с этого берём

Группы сайта — независимая проверка нашей классификации по двум спорным местам:

1. 16 позиций IP55 (коробки 14901-14904 и крышки 14931*/14932*/14943*/14944*), которые у нас
   попали в накладки и предлагаются как лицевые панели;
2. смешение в списке модулей трёх сущностей: изделия в сборе, голые механизмы («Механизм…»,
   16 штук) и аксессуары вроде светодиодов подсветки (32 штуки).

Съём групп делает `tools/fetch-site-groups.mjs` (`npm run build:site-groups`), результат —
`tools/data/site-groups.json`, отчёт сверки — `tools/data/site-groups-report.md`. В рантайм
эти данные не идут: решение о переклассификации принимает владелец по отчёту.
