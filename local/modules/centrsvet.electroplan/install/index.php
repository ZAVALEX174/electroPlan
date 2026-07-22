<?php

use Bitrix\Main\Localization\Loc;
use Bitrix\Main\ModuleManager;

Loc::loadMessages(__FILE__);

class centrsvet_electroplan extends CModule
{
    public $MODULE_ID = 'centrsvet.electroplan';
    public $MODULE_VERSION;
    public $MODULE_VERSION_DATE;
    public $MODULE_NAME;
    public $MODULE_DESCRIPTION;
    public $PARTNER_NAME;
    public $PARTNER_URI;

    public function __construct()
    {
        $arModuleVersion = [];
        include __DIR__ . '/version.php';
        $this->MODULE_VERSION = $arModuleVersion['VERSION'];
        $this->MODULE_VERSION_DATE = $arModuleVersion['VERSION_DATE'];
        $this->MODULE_NAME = Loc::getMessage('CENTRSVET_ELECTROPLAN_MODULE_NAME');
        $this->MODULE_DESCRIPTION = Loc::getMessage('CENTRSVET_ELECTROPLAN_MODULE_DESC');
        $this->PARTNER_NAME = Loc::getMessage('CENTRSVET_ELECTROPLAN_PARTNER_NAME');
    }

    public function DoInstall()
    {
        ModuleManager::registerModule($this->MODULE_ID);
        // TODO (PLAN 6.3): создать Highload-блок шаблонов постов (EpPostTemplates)
        // TODO (PLAN 6.4): создать Highload-блок/инфоблок проектов (EpProjects)
        // TODO (PLAN 1.4): проверить/создать свойства инфоблока каталога (KIND, ICON, UNIT, совместимость)
        $this->InstallFiles();
    }

    public function DoUninstall()
    {
        $this->UnInstallFiles();
        ModuleManager::unRegisterModule($this->MODULE_ID);
    }

    public function InstallFiles()
    {
        // Компонент подключается из local/components и копирования не требует.
        return true;
    }

    public function UnInstallFiles()
    {
        return true;
    }
}
