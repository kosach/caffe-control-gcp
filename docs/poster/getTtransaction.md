# finance.getTransaction: Transaction Properties

This method returns the properties of a transaction.

## HTTP Request

```
GET https://joinposter.com/api/finance.getTransaction
```

## Request Parameters

| Parameter | Description |
|-----------|-------------|
| transaction_id | Required parameter, transaction ID |

## Example Request

### JavaScript

```javascript
const url = 'https://joinposter.com/api/finance.getTransaction?token=687409:4164553abf6a031302898da7800b59fb&transaction_id=538';
```

### PHP

```php
<?php
$url = 'https://joinposter.com/api/finance.getTransaction?token=687409:4164553abf6a031302898da7800b59fb&transaction_id=538';
```

## Example Response

```json
{
  "response": {
    "transaction_id": "538",
    "account_id": "1",
    "user_id": "1",
    "category_id": "7",
    "type": "0",
    "amount": "-8137663",
    "balance": "545516997964",
    "date": "2024-08-31 09:20:22",
    "recipient_type": "0",
    "recipient_id": "0",
    "binding_type": "15",
    "binding_id": "400",
    "comment": "Корегуюча транзакція",
    "delete": "0",
    "account_name": "Готівка в закладі",
    "currency_symbol": "<i class=\"icon-rouble\">",
    "category_name": "book_category_action_actualization"
  }
}
```

## Response Parameters

| Parameter | Description |
|-----------|-------------|
| response | Transaction object |

### Response Object Properties

Inside the `response` parameter is an object with the following parameters:

| Parameter | Description |
|-----------|-------------|
| transaction_id | Transaction ID |
| account_id | Account ID |
| user_id | Waiter ID |
| category_id | Category ID, by default for all categories |
| type | Transaction type: `0` - expense, `1` - income |
| amount | Transaction amount in kopecks (cents) |
| balance | Account balance in kopecks (cents) |
| date | Transaction date |
| recipient_type | Recipient entity type: `1` - transfer, `12` - supplier |
| recipient_id | Recipient entity ID |
| binding_type | Related entity type: `1` - transfer, `11` - shift closure, `12` - supply, `14` - cash shift transactions |
| binding_id | Related entity ID |
| comment | Comment |
| delete | Whether transaction is deleted: `0` - not deleted, `1` - deleted |
| account_name | Account name |
| category_name | Category name |
| currency_symbol | Unicode currency symbol; for ruble, dram, and manat returns HTML which displays as currency icon on terminal |