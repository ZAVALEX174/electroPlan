# Рекомендуемый REST API

## Каталог
- `GET /api/products`
- `GET /api/products?kind=mechanism`
- `POST /api/products`
- `PUT /api/products/{id}`
- `DELETE /api/products/{id}`

## Шаблоны постов
- `GET /api/posts`
- `POST /api/posts`
- `PUT /api/posts/{id}`
- `DELETE /api/posts/{id}`

Пример POST:

```json
{
  "name": "Пост ТВ-зоны",
  "frameId": 202,
  "socketBoxProductId": 301,
  "mechanismIds": [102, 101, 103]
}
```

## Проекты
- `GET /api/projects/{id}`
- `POST /api/projects`
- `PUT /api/projects/{id}`
- `POST /api/projects/{id}/commercial-offer`

На сервере PDF лучше формировать из HTML-шаблона через Chromium/Puppeteer.
Это обеспечит одинаковый вид документа, логотип, реквизиты и хранение готового PDF.
