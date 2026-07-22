<?php

use Bitrix\Main\Localization\Loc;
use Bitrix\Main\Config\Option;

/** @var string $mid */
/** @global CMain $APPLICATION */

Loc::loadMessages(__FILE__);

$moduleId = 'centrsvet.electroplan';

if ($_SERVER['REQUEST_METHOD'] === 'POST' && check_bitrix_sessid()) {
    Option::set($moduleId, 'CATALOG_IBLOCK_ID', (int)($_POST['CATALOG_IBLOCK_ID'] ?? 0));
}

$iblockId = (int)Option::get($moduleId, 'CATALOG_IBLOCK_ID', 0);
?>
<form method="post"
      action="<?= htmlspecialcharsbx($APPLICATION->GetCurPage()) ?>?mid=<?= htmlspecialcharsbx($mid) ?>&lang=<?= LANGUAGE_ID ?>">
    <?= bitrix_sessid_post() ?>
    <table class="adm-detail-content-table edit-table">
        <tr>
            <td width="40%"><?= Loc::getMessage('CENTRSVET_ELECTROPLAN_OPT_CATALOG_IBLOCK') ?>:</td>
            <td width="60%">
                <input type="text" name="CATALOG_IBLOCK_ID" value="<?= $iblockId ?>" size="10">
            </td>
        </tr>
    </table>
    <p>
        <input type="submit" name="save"
               value="<?= Loc::getMessage('MAIN_SAVE') ?: 'Сохранить' ?>"
               class="adm-btn-save">
    </p>
</form>
