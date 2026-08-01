# Сверка нашей классификации VIMAR с сайтом vimar.ru

> Автоотчёт `tools/fetch-site-groups.mjs` (npm run build:site-groups). Съём сайта: **2026-08-01**, групп: **46**, уникальных артикулов: **5618**. Наш каталог: `js/catalog-vimar.js` (2146 позиций). Сверка — только разведка; правки kind принимает владелец.

Сопоставление групп сайта с нашим kind: `nakladki*`→frame, `mekhanizmy*`→mechanism, `supporta*`→support, `montazhnye-korobki`→socket_box; `aksessuary*`/`osvetitelnye-komponenty`/`komponenty-prochie`/`prochee`/`sistemy`/`ustroystva-avtomatizatsii*`/`by-me*`/`knx*` → «не модуль поста».

## Ответ на вопрос (а): IP55-коробки и крышки

| Наш код | kind у нас | Группа(ы) на сайте | Сопоставление |
|---|---|---|---|
| `14901` | frame | `montazhnye-korobki` → монтажные коробки (socket_box) | точно |
| `14902` | frame | `montazhnye-korobki` → монтажные коробки (socket_box) | точно |
| `14903` | frame | `montazhnye-korobki` → монтажные коробки (socket_box) | точно |
| `14904` | frame | `montazhnye-korobki` → монтажные коробки (socket_box) | точно |
| `14931` | frame | `montazhnye-korobki` → монтажные коробки (socket_box); `nakladki-plana` → накладки (frame) | точно |
| `14932` | frame | `montazhnye-korobki` → монтажные коробки (socket_box); `nakladki-plana` → накладки (frame) | точно |
| `14943` | frame | `montazhnye-korobki` → монтажные коробки (socket_box); `nakladki-plana` → накладки (frame) | точно |
| `14944` | frame | `montazhnye-korobki` → монтажные коробки (socket_box); `nakladki-plana` → накладки (frame) | точно |

## Ответ на вопрос (б): голые механизмы и светодиоды подсветки

| Наш код | kind у нас | Группа(ы) на сайте | Сопоставление |
|---|---|---|---|
| `09001.0.250` | mechanism | — (нет на сайте) | нет на сайте |
| `09005.0.250` | mechanism | — (нет на сайте) | нет на сайте |
| `14001.0` | mechanism | `mekhanizmy-plana` → механизмы (mechanism) | точно |
| `14005.0` | mechanism | `mekhanizmy-plana` → механизмы (mechanism) | точно |
| `00938.B` | mechanism | `osvetitelnye-komponenty` → не модуль поста | точно |
| `00936.120.A` | mechanism | `osvetitelnye-komponenty` → не модуль поста | по базе 00936 |

## Расхождения по видам

| Наш kind | Всего | На сайте | Согласен | Расходится | Нет на сайте |
|---|---:|---:|---:|---:|---:|
| накладки (frame) | 1635 | 1503 | 1499 | 4 | 132 |
| механизмы (mechanism) | 460 | 368 | 317 | 51 | 92 |
| суппорты (support) | 38 | 26 | 26 | 0 | 12 |
| монтажные коробки (socket_box) | 13 | 13 | 12 | 1 | 0 |

- **накладки (frame)**: сайт относит к другим группам — `montazhnye-korobki` (4)
- **механизмы (mechanism)**: сайт относит к другим группам — `osvetitelnye-komponenty` (25), `ustroystva-avtomatizatsii-eikon` (8), `aksessuary-plana` (6), `ustroystva-avtomatizatsii-arke` (6), `aksessuary-eikon` (6)
- **монтажные коробки (socket_box)**: сайт относит к другим группам — `prochee` (1)

## Чего нет на сайте / чего нет у нас

Наших модульных артикулов (frame/mechanism/support/socket_box), которых на сайте нет вообще: **236**.
Примеры (до 15): `03925`, `09001`, `09001.0.250`, `09001.2`, `09001.2.CM`, `09001.CM`, `09005`, `09005.0.250`, `09005.2`, `09005.2.CM`, `09005.CM`, `09008`, `09008.0.12`, `09008.0.250`, `09008.2`

Артикулов сайта, которых нет у нас (ни точно, ни как база): **3776**.
Примеры (до 15): `00112.B`, `00113.B`, `00114.B`, `00116.B`, `00149.B`, `00200.B`, `00201.B`, `00202.B`, `00206.B`, `00207.B`, `00211.B`, `00212.B`, `00221.B`, `00222.B`, `00223.B`
