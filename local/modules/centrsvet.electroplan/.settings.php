<?php
// Регистрация пространства имён AJAX-контроллеров нового ядра (Bitrix\Main\Engine).
// Экшены становятся доступны фронту как action=centrsvet:electroplan.<Controller>.<action>
// Например: centrsvet:electroplan.Catalog.list
return [
    'controllers' => [
        'value' => [
            'namespaces' => [
                '\\Centrsvet\\Electroplan\\Controller' => 'centrsvet.electroplan',
            ],
        ],
        'readonly' => true,
    ],
];
