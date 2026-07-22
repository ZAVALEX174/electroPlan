<?php

if (!defined('B_PROLOG_INCLUDED') || B_PROLOG_INCLUDED !== true) {
    die();
}

use Bitrix\Main\Loader;
use Centrsvet\Electroplan\Catalog\ProductRepository;

/**
 * Комплексный компонент приложения ElectroPlan.
 * Рендерит рабочую область планировщика и передаёт первичные данные во фронтенд.
 */
class CentrsvetElectroplanAppComponent extends CBitrixComponent
{
    public function executeComponent()
    {
        if (!Loader::includeModule('centrsvet.electroplan')) {
            ShowError('Модуль centrsvet.electroplan не установлен');
            return;
        }

        // Первичная отдача каталога — чтобы приложение стартовало без лишнего запроса.
        $this->arResult['CATALOG'] = (new ProductRepository())->getProducts();
        $this->arResult['AJAX_ACTION_PREFIX'] = 'centrsvet:electroplan';

        $this->includeComponentTemplate();
    }
}
