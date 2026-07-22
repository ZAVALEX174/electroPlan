<?php

namespace Centrsvet\Electroplan\Controller;

use Bitrix\Main\Engine\Controller;
use Centrsvet\Electroplan\Catalog\ProductRepository;

/**
 * Каталог электроустановочных изделий.
 *
 * Заменяет DataService.getProducts() из прототипа (js/data.js).
 * Соответствует REST-эндпоинту GET /api/products из api/README.md.
 *
 * Вызов с фронта: BX.ajax.runAction('centrsvet:electroplan.Catalog.list', ...)
 */
class Catalog extends Controller
{
    /**
     * GET /api/products[?kind=mechanism]
     *
     * @param string $kind mechanism|frame|socket_box|standalone (пусто — все)
     * @return array<int, array>
     */
    public function listAction(string $kind = ''): array
    {
        return (new ProductRepository())->getProducts($kind);
    }
}
