<?php

if (!defined('B_PROLOG_INCLUDED') || B_PROLOG_INCLUDED !== true) {
    die();
}

/** @var array $arResult */
/** @var CBitrixComponentTemplate $this */

use Bitrix\Main\Web\Json;

$this->addExternalCss($this->GetFolder() . '/style.css');
$this->addExternalJs($this->GetFolder() . '/data-adapter.js'); // Bitrix-версия DataService
$this->addExternalJs($this->GetFolder() . '/script.js');        // портированный js/app.js
?>
<script>
    window.EP_BITRIX = {
        catalog: <?= Json::encode($arResult['CATALOG'] ?? []) ?>,
        actionPrefix: <?= Json::encode($arResult['AJAX_ACTION_PREFIX'] ?? 'centrsvet:electroplan') ?>
    };
</script>

<?php // TODO (PLAN 2.1): перенести сюда разметку рабочей области из прототипа index.html ?>
<div class="app" id="electroplan-root">
    <!-- Корневой контейнер приложения ElectroPlan.
         На этапе интеграции разметку из index.html (topbar, sidebar, canvas, modal)
         переносим в этот шаблон; логика — в script.js. -->
</div>
