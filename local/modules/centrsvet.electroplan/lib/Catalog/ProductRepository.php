<?php

namespace Centrsvet\Electroplan\Catalog;

use Bitrix\Main\Loader;
use Bitrix\Main\Config\Option;

/**
 * Источник каталога. Целевой источник — Торговый каталог Битрикс (инфоблок).
 *
 * Заменяет window.EP_DATA.products из прототипа (js/data.js).
 * Формат элемента, ожидаемый фронтом (см. js/app.js):
 *   { id, code, name, kind, icon, price, unit, active }
 *   kind ∈ mechanism | frame | socket_box | standalone
 */
class ProductRepository
{
    private const MODULE_ID = 'centrsvet.electroplan';

    /**
     * @param string $kind фильтр по типу изделия (пусто — все активные)
     * @return array<int, array>
     */
    public function getProducts(string $kind = ''): array
    {
        if (!Loader::includeModule('iblock')) {
            return [];
        }

        $iblockId = (int)Option::get(self::MODULE_ID, 'CATALOG_IBLOCK_ID', 0);
        if ($iblockId <= 0) {
            // TODO (PLAN 6.2): указать ID инфоблока каталога в настройках модуля (options.php)
            return [];
        }

        $filter = ['IBLOCK_ID' => $iblockId, 'ACTIVE' => 'Y'];
        if ($kind !== '') {
            // TODO (PLAN 1.4): свойство KIND в инфоблоке каталога
            $filter['PROPERTY_KIND_VALUE'] = $kind;
        }

        $select = [
            'ID', 'NAME', 'CODE',
            'PROPERTY_KIND', 'PROPERTY_ICON', 'PROPERTY_UNIT',
            'CATALOG_GROUP_1', // базовая цена из модуля catalog
        ];

        $result = [];
        $rs = \CIBlockElement::GetList(['SORT' => 'ASC', 'NAME' => 'ASC'], $filter, false, false, $select);
        while ($row = $rs->GetNext()) {
            $result[] = [
                'id'     => (int)$row['ID'],
                'code'   => $row['CODE'] ?: ('EP-' . $row['ID']),
                'name'   => $row['NAME'],
                'kind'   => $row['PROPERTY_KIND_VALUE'] ?: 'mechanism',
                'icon'   => $row['PROPERTY_ICON_VALUE'] ?: '?',
                'price'  => (float)($row['CATALOG_PRICE_1'] ?? 0),
                'unit'   => $row['PROPERTY_UNIT_VALUE'] ?: 'шт.',
                'active' => true,
            ];
        }
        return $result;
    }
}
