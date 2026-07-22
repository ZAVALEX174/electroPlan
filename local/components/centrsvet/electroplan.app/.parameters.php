<?php

if (!defined('B_PROLOG_INCLUDED') || B_PROLOG_INCLUDED !== true) {
    die();
}

$arComponentParameters = [
    'PARAMETERS' => [
        'CATALOG_IBLOCK_ID' => [
            'PARENT' => 'BASE',
            'NAME' => 'ID инфоблока каталога (переопределяет настройку модуля)',
            'TYPE' => 'STRING',
            'DEFAULT' => '',
        ],
        'CACHE_TIME' => ['DEFAULT' => 3600],
    ],
];
