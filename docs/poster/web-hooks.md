# Webhooks

Webhooks allow you to instantly receive information about object changes in Poster. For example, when a new item is added to the menu or a receipt is processed.

## Connection

1. Go to your developer account → Application Settings
2. In the Webhooks block, select the entities for which you want to receive hooks and the URL to send hooks to
3. Connect your application in the account for which you need to receive hooks
4. Edit, delete, or create an entity to trigger sending a hook.

For example, to send a hook for orders, subscribe to the transaction entity and close an order at the cash register.

## Webhook Parameters

Example of an incoming webhook:

```json
{
  "_id": {
    "$oid": "64a7db37bc9daca9701a6f25"
  },
  "account": "mykava6",
  "object": "transaction",
  "object_id": 16776,
  "action": "changed",
  "time": "1688722229",
  "verify": "f6a209fccb87d7051d49bf3342c656ab",
  "account_number": "333226",
  "data": "{\"transactions_history\":{\"type_history\":\"additem\",\"time\":1688722229115,\"value\":483,\"value2\":78,\"value3\":429,\"value4\":0,\"value5\":null,\"value_text\":\"{\\\"price\\\":50,\\\"unit\\\":\\\"p\\\",\\\"nodiscount\\\":0,\\\"tax\\\":{\\\"id\\\":9,\\\"value\\\":0,\\\"type\\\":3,\\\"fiscal\\\":1},\\\"modificationData\\\":[{\\\"m\\\":21,\\\"a\\\":1}]}\",\"user_id\":6,\"spot_tablet_id\":1}}"
}
```

Example of webhook processing:

```php
<?php
// Your application's secret key
$client_secret = 'fe2bc8e865d8fc2236968ee53c3b2bd5';

// Convert incoming data to the required format
$postJSON = file_get_contents('php://input');
$postData = json_decode($postJSON, true);

$verify_original = $postData['verify'];
unset($postData['verify']);

$verify = [
    $postData['account'],
    $postData['object'],
    $postData['object_id'],
    $postData['action'],
];

// If there are additional parameters
if (isset($postData['data'])) {
    $verify[] = $postData['data'];
}
$verify[] = $postData['time'];
$verify[] = $client_secret;

// Create a string for client request verification
$verify = md5(implode(';', $verify));

// Verify data validity
if ($verify != $verify_original) {
    exit;
}

// If you don't respond to the request, Poster will continue sending the Webhook
echo json_encode(['status' => 'accept']);
```

All notifications arrive via POST request and contain the following parameters:

| Parameter | Description |
|-----------|-------------|
| account | Client account that created the event |
| account_number | Account number that created the event |
| object | Entity for which the webhook was received |
| object_id | Primary key of the object |
| action | Action performed on the entity: `added` - added, `changed` - modified, `removed` - deleted, `transformed` - transformation (e.g., recipe to product and vice versa) |
| time | Webhook sending time in Unix timestamp |
| verify | Request signature, consists of md5 from account, object, object_id, action, data (if passed) and secret joined with `;` |
| data | Additional parameter for some entities |

You must respond to received webhooks with a 200 HTTP status code. Otherwise, we will consider the webhook undelivered and will attempt to send it 15 more times over two days.

## Orders

| Entity | Description |
|--------|-------------|
| transaction | Orders |
| incoming_order | Online orders and reservations |

### incoming_order: Online Order Status

The `changed` event is triggered when the order status changes from new to accepted or rejected.

The hook body includes an additional `data` parameter containing:

| Parameter | Description |
|-----------|-------------|
| type | Type, accepts values: 1 - online order, 2 - reservation |

## Menu

| Entity | Description |
|--------|-------------|
| product | Products |
| dish | Recipes |
| category | Product and recipe categories |
| prepack | Semi-finished products |
| ingredient | Ingredients |
| workshop | Workshops |
| ingredients_category | Ingredient categories |

## Marketing

| Entity | Description |
|--------|-------------|
| client | Clients |
| client_payed_sum | Order closure with linked client |
| clients_group | Client groups |
| promotion | Promotions |
| promotion_prize | Accumulated promotions |
| client_ewallet | Client deposits |
| loyalty_rule | Rules for transitions between client groups |

### client_ewallet

The hook body includes an additional `data` parameter containing:

| Parameter | Description |
|-----------|-------------|
| value_relative | Delta change in deposit account amount |
| value_absolute | Final amount in deposit account |

## Inventory

| Entity | Description |
|--------|-------------|
| storage | Warehouses |
| stock | Product or ingredient inventory status |
| supply | Supplies |

### stock

The hook body includes an additional `data` parameter containing:

| Parameter | Description |
|-----------|-------------|
| type | Type, accepts values: 1 - ingredient, 2 - product, 3 - modifier, 4 - produced recipe, 5 - produced semi-finished product |
| element_id | Primary key of the object |
| storage_id | Primary key of the warehouse object |
| value_relative | Change in item quantity in warehouse |
| value_absolute | Final value of item quantity in warehouse |

## Finance

| Entity | Description |
|--------|-------------|
| book_transaction | Financial transactions |
| cash_shift_transaction | Cash transactions |

## Access

| Entity | Description |
|--------|-------------|
| spot | Establishments |
| register | Cash register |
| waiter | Waiter |

## Settings and Applications

| Entity | Description |
|--------|-------------|
| configs | Settings |
| application | Integration connection or removal |

### application

The hook body includes an additional `data` parameter containing:

| Parameter | Description |
|-----------|-------------|
| user_id | ID of the employee who installed the application |
| access_token | Access token for working with API. Returned if action is `added` |

## Webhooks Not Coming?

- Does the URL you specified in "URL for webhooks" respond with a 200 status code and accept POST requests?
- When checking in Poster for Developments, does a green checkmark appear?
- Are you subscribed to events for the entities you're modifying?
- Try simulating a hook send. To do this, edit the entity in Poster for which you're expecting a hook.
- Check if your application is connected to the account from which you're expecting hooks.
- If you didn't respond to previous hooks with a 200 status code, accept the previous ones and new ones will start arriving afterward.
- If you can't accept old hooks, remove all entities from "Receive webhooks by", save, and add them again.