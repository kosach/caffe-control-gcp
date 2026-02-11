# Database Schema

**Database:** `easy-control`
**Provider:** MongoDB Atlas

## Collections

### transactions

Транзакції продажів з Poster POS.

| Field | Type | Description |
|-------|------|-------------|
| `_id` | ObjectId | MongoDB ID |
| `transaction_id` | String/Number | ID транзакції в Poster |
| `date_start` | String | Timestamp відкриття чека |
| `date_close` | String | Timestamp закриття чека |
| `date_close_date` | String | Дата закриття (YYYY-MM-DD HH:mm:ss) |
| `status` | String | Статус транзакції |
| `sum` | String | Загальна сума (в копійках) |
| `payed_sum` | String | Оплачена сума |
| `payed_cash` | String | Оплата готівкою |
| `payed_card` | String | Оплата карткою |
| `payed_bonus` | String | Оплата бонусами |
| `pay_type` | String | Тип оплати (1=готівка, 2=картка) |
| `discount` | String | Знижка |
| `tip_sum` | String | Чайові |
| `total_profit` | String | Загальний прибуток |
| `total_profit_netto` | String | Чистий прибуток |
| `user_id` | String | ID касира |
| `name` | String | Ім'я касира |
| `spot_id` | String | ID точки продажу |
| `table_id` | String | ID столика |
| `guests_count` | String | Кількість гостей |
| `client_id` | String | ID клієнта |
| `client_firstname` | String/Null | Ім'я клієнта |
| `client_lastname` | String/Null | Прізвище клієнта |
| `client_phone` | String/Null | Телефон клієнта |
| `print_fiscal` | String | Чи друкувався фіскальний чек |
| `products` | Array | Масив продуктів у чеку |
| `products[].product_id` | String | ID продукту |
| `products[].modification_id` | String | ID модифікації |
| `products[].num` | String | Кількість |
| `products[].product_price` | String | Ціна продукту |
| `products[].payed_sum` | String | Оплачена сума за продукт |
| `products[].product_cost` | String | Собівартість |
| `products[].product_profit` | String | Прибуток |
| `history` | Array | Історія дій з чеком |
| `auto_accept` | Boolean | Автоматичне підтвердження |

---

### products

Каталог продуктів з Poster POS.

| Field | Type | Description |
|-------|------|-------------|
| `_id` | ObjectId | MongoDB ID |
| `product_id` | String | ID продукту в Poster |
| `product_name` | String | Назва продукту |
| `product_code` | String | Код продукту |
| `category_name` | String | Назва категорії |
| `menu_category_id` | String | ID категорії меню |
| `type` | String | Тип (dish, product) |
| `unit` | String | Одиниця виміру |
| `price` | Object | Ціни по точках `{"1": "10000"}` |
| `cost` | String | Собівартість |
| `cost_netto` | String | Собівартість нетто |
| `profit` | Object | Прибуток по точках |
| `hidden` | String | Прихований (0/1) |
| `fiscal` | String | Фіскальний (0/1) |
| `fiscal_code` | String | Фіскальний код |
| `barcode` | String | Штрихкод |
| `photo` | String/Null | URL фото |
| `color` | String | Колір |
| `sort_order` | String | Порядок сортування |
| `workshop` | String | ID цеху |
| `nodiscount` | String | Без знижки (0/1) |
| `tax_id` | String | ID податку |
| `weight_flag` | String | Ваговий товар |
| `cooking_time` | String | Час приготування |
| `spots` | Array | Налаштування по точках |
| `ingredients` | Array | Інгредієнти рецепту |
| `modifications` | Array | Модифікації продукту |
| `group_modifications` | Array | Групові модифікації |

---

### poster-hooks-data

Сирі дані вебхуків від Poster POS.

| Field | Type | Description |
|-------|------|-------------|
| `_id` | ObjectId | MongoDB ID |
| `account` | String | Акаунт Poster |
| `account_number` | String | Номер акаунту |
| `object` | String | Тип об'єкта (transaction, product) |
| `object_id` | Number | ID об'єкта |
| `action` | String | Дія (added, changed, removed) |
| `time` | String | Час події |
| `verify` | String | Верифікаційний хеш |
| `data` | String | JSON дані (як рядок) |
| `metadata.received_at` | Date | Час отримання |
| `metadata.processed` | Boolean | Чи оброблено |
| `metadata.processed_at` | Date | Час обробки |
| `metadata.saved_to_transactions` | Boolean | Чи збережено в transactions |
| `metadata.processing_error` | Null/String | Помилка обробки |

---

### wastes

Списання продуктів/інгредієнтів.

| Field | Type | Description |
|-------|------|-------------|
| `_id` | ObjectId | MongoDB ID |
| `waste_id` | Number | ID списання в Poster |
| `date` | Date | Дата списання |
| `user_id` | String | ID користувача |
| `storage_id` | String | ID складу |
| `reason_id` | String | ID причини списання |
| `reason_name` | String | Назва причини |
| `total_sum` | String | Загальна сума |
| `total_sum_netto` | String | Сума нетто |
| `elements` | Array | Елементи списання |
| `elements[].type` | Number | Тип елемента |
| `elements[].product_id` | String | ID продукту |
| `elements[].count` | String | Кількість |
| `elements[].ingredients` | Array | Інгредієнти |

---

### wastes-logs

Логи операцій списання.

| Field | Type | Description |
|-------|------|-------------|
| `_id` | ObjectId | MongoDB ID |
| `write_off.storage_id` | Number | ID складу |
| `write_off.date` | String | Дата |
| `write_off.reason_id` | Number | ID причини |
| `write_off.write_off_name` | String | Назва списання |
| `ingredient` | Array | Список інгредієнтів |
| `ingredient[].id` | String/Number | ID інгредієнта |
| `ingredient[].name` | String | Назва |
| `ingredient[].type` | Number | Тип |
| `ingredient[].weight` | Number | Вага |
| `status.success` | Number | Успішність |
| `status.response` | Number | Код відповіді |
| `status.error` | Number | Код помилки |
| `status.message` | String | Повідомлення |

---

### forecasts

Прогнози виручки.

| Field | Type | Description |
|-------|------|-------------|
| `_id` | ObjectId | MongoDB ID |
| `generated_at` | Date | Час генерації прогнозу |
| `model_name` | String | Назва моделі |
| `horizon_days` | Number | Горизонт прогнозування (днів) |
| `forecasts` | Array | Масив прогнозів |
| `forecasts[].date` | Date | Дата прогнозу |
| `forecasts[].predicted_revenue` | Number | Прогнозована виручка |

---

### ingredient_review_candidates

Кандидати на зіставлення інгредієнтів.

| Field | Type | Description |
|-------|------|-------------|
| `_id` | ObjectId | MongoDB ID |
| `alias` | String | Альтернативна назва інгредієнта |
| `usage_count` | Number | Кількість використань |
| `potential_matches` | Array | Потенційні відповідності |
| `potential_matches[].official_name` | String | Офіційна назва |
| `potential_matches[].poster_id` | String | ID в Poster |
| `potential_matches[].match_score` | Number | Оцінка відповідності |
| `review.status` | String | Статус перегляду |
| `review.selected_poster_id` | Null/String | Обраний ID |

---

### ingredient_production_map

Карта виробництва інгредієнтів (маппінг аліасів).

| Field | Type | Description |
|-------|------|-------------|
| `_id` | String | Poster ID інгредієнта |
| `poster_name` | String | Офіційна назва в Poster |
| `aliases` | Array[String] | Альтернативні назви |

---

### discord_messages_raw

Сирі повідомлення з Discord.

| Field | Type | Description |
|-------|------|-------------|
| `_id` | ObjectId | MongoDB ID |
| `discord_message_id` | String | ID повідомлення в Discord |
| `guild_id` | String | ID сервера |
| `channel_id` | String | ID каналу |
| `author_id` | String | ID автора |
| `author_name` | String | Ім'я автора |
| `content` | String | Текст повідомлення |
| `attachments` | Array[String] | URL вкладень |
| `timestamp_utc` | String | Час повідомлення |
| `fetched_at_utc` | String | Час отримання |
| `synced_at_utc` | String | Час синхронізації |

---

### test

Тестова колекція (для розробки).

---

## Indexes

Для перегляду індексів використовуй:
```
mcp__mongodb__collection-indexes:
  database: "easy-control"
  collection: "transactions"
```

## Notes

- Всі суми в `transactions` зберігаються в **копійках** (ділити на 100 для гривень)
- Дати в `transactions` зберігаються як **timestamp в мілісекундах** (String)
- `date_close_date` - людиночитабельний формат дати
