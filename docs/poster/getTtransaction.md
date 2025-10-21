# dash.getTransaction API Documentation

## Overview
Get detailed information about a specific transaction (receipt) from the Poster POS system.

## Endpoint
```
GET https://joinposter.com/api/dash.getTransaction
```

## Request Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `token` | string | Yes | API authentication token |
| `transaction_id` | string | Yes | Transaction ID to retrieve |
| `include_products` | boolean | No | Include products in the response (`true`/`false`) |
| `include_history` | boolean | No | Include transaction history in the response (`true`/`false`) |
| `include_delivery` | boolean | No | Include delivery information in the response (`true`/`false`) |
| `timezone` | string | No | If set to `client`, returns date in account timezone |
| `type` | string | No | Statistics type: `waiters`, `spots`, or `clients` (requires `id` parameter) |
| `id` | string | No | Entity ID for statistics (requires `type` parameter) |
| `status` | integer | No | Transaction status filter: `0` - all, `1` - open only, `2` - closed only, `3` - deleted |

## Example Request

```javascript
const url = 'https://joinposter.com/api/dash.getTransaction?token=687409:4164553abf6a031302898da7800b59fb&transaction_id=330660&include_history=true&include_products=true&include_delivery=true';
```

## Response Structure

### Root Response Object

| Field | Type | Description |
|-------|------|-------------|
| `response` | array | Array containing transaction object |

### Transaction Object

| Field | Type | Description |
|-------|------|-------------|
| `transaction_id` | string | Transaction ID |
| `date_start` | string | Order opening date in milliseconds |
| `date_start_new` | string | Updated opening date in milliseconds |
| `date_close` | string | Order closing date in milliseconds (`0` if still open) |
| `status` | string | Order status: `1` - open, `2` - closed, `3` - deleted |
| `guests_count` | string | Number of guests |
| `name` | string | Waiter's name |
| `discount` | string | Discount percentage |
| `bonus` | string | Bonus accrued as percentage of `payed_sum` |
| `pay_type` | string | Payment type: `0` - closed without payment, `1` - cash, `2` - card, `3` - mixed |
| `payed_bonus` | string | Amount paid with bonuses (in kopecks) |
| `payed_card` | string | Amount paid by card (in kopecks) |
| `payed_cash` | string | Amount paid in cash (in kopecks) |
| `payed_sum` | string | Total amount paid with "real money" (`payed_cash` + `payed_card`) |
| `payed_cert` | string | Amount paid with certificates (in kopecks) |
| `payed_third_party` | string | Amount paid by third party (in kopecks) |
| `round_sum` | string | Rounding amount (in kopecks) |
| `tip_sum` | string | Service charge amount (in kopecks) |
| `tips_card` | string | Tips paid by card (in kopecks) |
| `tips_cash` | string | Tips paid in cash (in kopecks) |
| `sum` | string | Total order amount without discounts (in kopecks) |
| `spot_id` | string | Venue ID |
| `table_id` | string | Table ID |
| `table_name` | string | Table name |
| `user_id` | string | Waiter ID |
| `client_id` | string | Client ID |
| `card_number` | string | Card number |
| `transaction_comment` | string/null | Transaction comment |
| `reason` | string | Reason for closing without payment: `1` - guest left, `2` - on the house, `3` - waiter error |
| `print_fiscal` | string | Fiscal receipt print status: `0` - not printed, `1` - printed, `2` - fiscal return |
| `total_profit` | string | Total profit amount |
| `total_profit_netto` | string | Profit without VAT (if enabled in settings) |
| `client_firstname` | string/null | Client's first name |
| `client_lastname` | string/null | Client's last name |
| `date_close_date` | string | Closing date in readable format |
| `service_mode` | string | Order type: `1` - dine-in, `2` - takeout, `3` - delivery |
| `processing_status` | string | Order status: `10` - open, `20` - cooking, `30` - ready, `40` - en route, `50` - delivered, `60` - closed, `70` - deleted |
| `client_phone` | string/null | Client's phone number |

### Delivery Object

| Field | Type | Description |
|-------|------|-------------|
| `payment_method_id` | integer | Payment method ID |
| `delivery_zone_id` | integer | Delivery zone ID |
| `bill_amount` | integer | Bill denomination for payment |
| `delivery_price` | integer | Delivery cost |
| `country` | string | Delivery country |
| `city` | string | Delivery city |
| `address1` | string | Delivery address (street and building number) |
| `address2` | string | Additional address info (entrance, floor, apartment) |
| `comment` | string | Delivery comment |
| `lat` | float/null | Delivery latitude |
| `lng` | float/null | Delivery longitude |
| `zip_code` | string | Postal code |
| `delivery_time` | string | Delivery date/time |
| `courier_id` | integer | Courier ID |

### Products Array

| Field | Type | Description |
|-------|------|-------------|
| `product_id` | string | Product ID |
| `modification_id` | string | Modification ID |
| `num` | string | Product quantity |
| `product_price` | string | Product price |
| `payed_sum` | string | Amount paid |
| `print_fiscal` | string | Fiscal receipt print status: `0` - not printed, `1` - printed, `2` - fiscal return |
| `tax_id` | string | Tax ID |
| `tax_value` | string | Tax percentage |
| `tax_type` | string | Tax type: `1` - VAT, `2` - turnover tax |
| `tax_fiscal` | string | Tax per fiscal registrar |
| `tax_sum` | string | Tax amount |
| `product_cost` | string | Product cost (in kopecks) |
| `product_cost_netto` | string | Product cost without VAT (in kopecks, if enabled) |
| `product_profit` | string | Product profit (in kopecks) |
| `product_profit_netto` | string | Product profit without VAT (in kopecks, if enabled) |

### History Array

Contains transaction history events. Each object includes:

| Field | Type | Description |
|-------|------|-------------|
| `history_id` | string | History record ID |
| `type_history` | string | Event type (e.g., `open`, `additem`, `close`) |
| `spot_tablet_id` | string | Tablet ID |
| `time` | string | Event timestamp (milliseconds) |
| `user_id` | string | User ID |
| `value` | string | Event-specific value |
| `value2` | string | Event-specific value |
| `value3` | string | Event-specific value |
| `value4` | string | Event-specific value |
| `value5` | string | Event-specific value |
| `value_text` | object/null | Additional event data |

## Example Response

```json
{
   "response":[
      {
         "transaction_id":"330660",
         "date_start":"1518873040083",
         "date_close":"1518873046314",
         "status":"2",
         "guests_count":"2",
         "pay_type":"3",
         "payed_cash":"2750",
         "sum":"2750",
         "spot_id":"1",
         "table_id":"94",
         "name":"Анна",
         "service_mode":"1",
         "processing_status":"60",
         "delivery":{
            "delivery_price":2000,
            "city":"Kyiv",
            "address1":"khreshchatyk 25",
            "delivery_time":"2018-02-17 16:00:00"
         },
         "products":[
            {
               "product_id":"162",
               "num":"1",
               "product_price":"1050",
               "payed_sum":"1050"
            }
         ],
         "history":[
            {
               "history_id":"2485357",
               "type_history":"open",
               "time":"1518873040083"
            }
         ]
      }
   ]
}
```

## Notes

- All monetary values are in **kopecks** (1/100 of currency unit)
- Dates are in **milliseconds** (Unix timestamp format)
- For detailed history events, see the `dash.getTransactionHistory` method documentation


## CURL request example 

curl --location --request GET 'https://joinposter.com/api/dash.getTransaction?token={{POSTER_TOKEN}}&include_history=true&include_products=true&include_delivery=true' \
--header 'Content-Type: application/json' \
--data '{
    "storage_id": 1,
    "date": "2022-12-22 18:46:00",
    "reason_id": 5,
    "ingredient": [
        {
            "id": "138",
            "type": "1",
            "weight": "3"
        }
    ]
}'
