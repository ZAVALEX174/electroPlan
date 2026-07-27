# Магазин: каталог, корзина, заказы

Модули: `iblock` (товары как инфоблок), `catalog` (цены, скидки, остатки), `sale` (корзина, заказы, оплата, доставка). Подключай все три, если работаешь с магазином.

```php
use Bitrix\Main\Loader;
Loader::includeModule('iblock');
Loader::includeModule('catalog');
Loader::includeModule('sale');
```

## Каталог: цены и остатки

### Получить цену товара

```php
use Bitrix\Catalog\Model\Price;
use Bitrix\Catalog\PriceTable;

$prices = PriceTable::getList([
    'select' => ['ID', 'PRICE', 'CURRENCY', 'CATALOG_GROUP_ID', 'CATALOG_GROUP.NAME_LANG'],
    'filter' => ['=PRODUCT_ID' => $productId],
])->fetchAll();
```

С учётом прав пользователя — `\CCatalogProduct::GetOptimalPrice()`:

```php
$result = \CCatalogProduct::GetOptimalPrice(
    $productId,
    $quantity = 1,
    $userGroups = $USER->GetUserGroupArray(),
    $renewal = 'N',
    [], // priceList — пусто = все
    $siteId = SITE_ID,
    $coupons = []
);
$price = $result['DISCOUNT_PRICE'];     // с учётом скидок
$base  = $result['BASE_PRICE'];          // базовая
```

### Остатки

```php
use Bitrix\Catalog\ProductTable;

$row = ProductTable::getRow([
    'select' => ['ID', 'QUANTITY', 'AVAILABLE', 'CAN_BUY_ZERO', 'NEGATIVE_AMOUNT_TRACE'],
    'filter' => ['=ID' => $productId],
]);
```

`AVAILABLE = 'Y'` — товар можно купить (учитывает все правила: остатки, тип товара, доступность складов).

### Складской учёт (StoreProduct)

```php
use Bitrix\Catalog\StoreProductTable;

StoreProductTable::getList([
    'select' => ['STORE_ID', 'AMOUNT', 'STORE.TITLE'],
    'filter' => ['=PRODUCT_ID' => $productId],
])->fetchAll();
```

## Корзина (Basket)

### Добавить в корзину

```php
use Bitrix\Sale\Basket;
use Bitrix\Sale\Fuser;

$fUserId = Fuser::getId();   // ID анонимной/авторизованной корзины
$basket = Basket::loadItemsForFUser($fUserId, SITE_ID);

$item = $basket->createItem('catalog', $productId);
$item->setFields([
    'QUANTITY'  => 2,
    'CURRENCY'  => 'RUB',
    'LID'       => SITE_ID,
    'PRODUCT_PROVIDER_CLASS' => '\\CCatalogProductProvider',
]);
$result = $basket->save();
if (!$result->isSuccess()) {
    foreach ($result->getErrorMessages() as $err) { /* лог */ }
}
```

`PRODUCT_PROVIDER_CLASS` обязателен — он отвечает за актуализацию цены и остатка при сохранении заказа.

### Изменить количество / удалить

```php
foreach ($basket as $item) {
    if ($item->getProductId() === $productId) {
        $item->setField('QUANTITY', 5);
        // или $item->delete();
    }
}
$basket->save();
```

### Сводка корзины

```php
$total = $basket->getPrice();              // с учётом скидок позиций
$weight = $basket->getWeight();
$count = $basket->getQuantity();
```

## Заказ (Order)

### Создание заказа из корзины

```php
use Bitrix\Sale\Order;
use Bitrix\Sale\PaySystem;
use Bitrix\Sale\Delivery;

$order = Order::create(SITE_ID, $userId);
$order->setPersonTypeId(1);      // тип плательщика (физлицо/юрлицо)
$order->setBasket($basket);

// Свойства заказа (имя, телефон, адрес и т.п.)
$propertyCollection = $order->getPropertyCollection();
foreach ($propertyCollection as $property) {
    if ($property->getField('CODE') === 'PHONE') {
        $property->setValue('+7 999 ...');
    }
    if ($property->getField('CODE') === 'EMAIL') {
        $property->setValue('user@example.com');
    }
}

// Доставка
$shipmentCollection = $order->getShipmentCollection();
$shipment = $shipmentCollection->createItem(Delivery\Services\Manager::getObjectById($deliveryId));
$shipment->setFields([
    'DELIVERY_NAME' => $shipment->getDeliveryName(),
    'CURRENCY'      => $order->getCurrency(),
]);

// перенести все товары из корзины в отгрузку
$shipmentItemCollection = $shipment->getShipmentItemCollection();
foreach ($basket as $basketItem) {
    $shipmentItem = $shipmentItemCollection->createItem($basketItem);
    $shipmentItem->setQuantity($basketItem->getQuantity());
}

// Оплата
$paymentCollection = $order->getPaymentCollection();
$payment = $paymentCollection->createItem(PaySystem\Manager::getObjectById($paySystemId));
$payment->setFields([
    'SUM'      => $order->getPrice(),
    'CURRENCY' => $order->getCurrency(),
]);

// Сохранение
$result = $order->save();
if (!$result->isSuccess()) {
    foreach ($result->getErrors() as $error) {
        // обработка
    }
}
$orderId = $order->getId();
```

### Чтение заказа

```php
$order = Order::load($orderId);

$order->getId();
$order->getUserId();
$order->getPrice();
$order->getField('STATUS_ID');
$order->isPaid();
$order->isShipped();

$basket = $order->getBasket();
foreach ($basket as $item) {
    $item->getProductId();
    $item->getQuantity();
    $item->getPrice();
}
```

### Изменение статуса заказа

```php
$order = Order::load($orderId);
$result = $order->setField('STATUS_ID', 'F');   // F = Выполнен
$order->save();
```

Список статусов: «Магазин → Настройки → Статусы».

## Оплата и доставка

### Установить статус оплаты

```php
foreach ($order->getPaymentCollection() as $payment) {
    $payment->setPaid('Y');
}
$order->save();
```

`setPaid('Y')` запускает события и спишет товар со склада, если активирован складской учёт. Не пиши `PAID = 'Y'` напрямую через `setField`.

### Свой обработчик платёжной системы

Структура: `/local/php_interface/include/sale_payment/<handler_name>/handler.php`. Класс наследует `\Bitrix\Sale\PaySystem\ServiceHandler`, методы:
- `initiatePay()` — что показать пользователю на странице «оплатить» (форма, redirect).
- `processRequest()` — обработка callback от платёжки (webhook).
- `refund()` — возврат.

После создания зарегистрируй обработчик в админке: «Магазин → Настройки → Платёжные системы → Добавить».

### Свой обработчик доставки

Структура: `/local/php_interface/include/sale_delivery/<name>/handler.php`. Класс — `\Bitrix\Sale\Delivery\Services\Base`. Методы: `calculateConcrete()` (расчёт стоимости), `isCompatible()` (применима ли).

## Скидки

Скидки в `sale` — это не статика, а условия + действия (Discount Engine). Программно создавать скидки сложно и редко нужно — почти всегда настраиваются в админке.

Если нужно проверить скидку для корзины:

```php
use Bitrix\Sale\Discount;

$discount = Discount::buildFromBasket($basket, new \Bitrix\Sale\Discount\Context\UserGroup($userGroups));
$discount->calculate();
$result = $discount->getApplyResult();
```

Купоны:

```php
\Bitrix\Sale\DiscountCouponsManager::add($couponCode);  // активирует на текущую корзину
```

## ОФД и фискализация (54-ФЗ)

Модуль `sale` интегрируется с кассами через **CashboxHandler**. Готовые: Атол, ОрангДата, Бизнес.Ру, ОФД.ру, ЮKassa-чеки.

При успешной оплате чек печатается автоматически, если:
1. Касса добавлена в «Магазин → Настройки → Кассы».
2. У платёжной системы выбрана касса.
3. У товаров заполнены ставки НДС и признак предмета расчёта.

Свой драйвер кассы — наследник `\Bitrix\Sale\Cashbox\Cashbox`. Это редко нужно, обычно хватает коробочных.

## События магазина

Полный список — `dev.1c-bitrix.ru/api_help/sale/events/index.php`. Самые ходовые:

| Событие | Когда |
|---|---|
| `OnSaleOrderBeforeSaved` | Перед сохранением заказа (можно отменить) |
| `OnSaleOrderSaved` | После сохранения (новый или существующий) |
| `OnSalePaymentEntitySaved` | После сохранения платежа |
| `OnSaleStatusOrderChange` | Смена статуса заказа |
| `OnSaleOrderPaid` | Заказ оплачен |
| `OnSaleDeliveryOrder` (старое) / `OnSaleShipmentEntitySaved` | Изменения отгрузки |
| `OnBasketAdd` / `OnBasketUpdate` / `OnBasketDelete` | Корзина |

```php
EventManager::getInstance()->addEventHandler(
    'sale',
    'OnSaleOrderPaid',
    static function (\Bitrix\Main\Event $event) {
        /** @var \Bitrix\Sale\Order $order */
        $order = $event->getParameter('ENTITY');
        // отправить уведомление, начислить бонусы и т.п.
    }
);
```

## Грабли

- **`$basket->save()` без `Order`** — корзина сохранится, но не «закрепится» за заказом. При создании заказа из корзины использовать `Order::setBasket($basket)` до `$order->save()`.
- **Свойства заказа не находятся в `getPropertyCollection`** — они привязаны к **типу плательщика**. Сначала установи `setPersonTypeId`, потом получай свойства.
- **Прямой `UPDATE` `b_sale_order`** ломает события и складской учёт. Только через `Order::load()` и `setField`/`save`.
- **Сохранение заказа в обработчике `OnSaleOrderSaved`** — рекурсия. Используй `OnSaleOrderBeforeSaved` для модификаций или флаг.
- **Цены округляются по правилам валюты** — `\Bitrix\Sale\PriceMaths::roundPrecision()`. Не сравнивай цены напрямую с float.
- **`\CSaleOrder` (старое API) и `Bitrix\Sale\Order` (D7) не взаимозаменяемы.** Совмещать в одном потоке опасно: `Order::load` после `\CSaleOrder::Update` может отдать кешированную версию. Выбери один путь и держись его.
- **`Fuser::getId()`** создаёт нового анонимного пользователя при первом обращении и кладёт ID в cookie. В CLI/cron это ID `0` — учитывай.
