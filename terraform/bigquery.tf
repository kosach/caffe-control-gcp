# BigQuery dataset
resource "google_bigquery_dataset" "caffe_control" {
  dataset_id    = "caffe_control"
  project       = var.project_id
  location      = "EU"
  friendly_name = "Caffe Control Analytics"
  description   = "Dataset for Firestore data export and analytics"

  labels = {
    environment = "production"
  }
}

# Raw changelog table (populated by Firebase Extension: Firestore→BigQuery)
resource "google_bigquery_table" "transactions_raw_changelog" {
  dataset_id = google_bigquery_dataset.caffe_control.dataset_id
  table_id   = "transactions_raw_changelog"
  project    = var.project_id

  schema = jsonencode([
    { name = "timestamp",     type = "TIMESTAMP", mode = "REQUIRED", description = "The commit timestamp of this change in Cloud Firestore. If the operation is IMPORT, this timestamp is epoch to ensure that any operation on an imported document supersedes the IMPORT." },
    { name = "event_id",      type = "STRING",    mode = "REQUIRED", description = "The ID of the document change event that triggered the Cloud Function created by the extension. Empty for imports." },
    { name = "document_name", type = "STRING",    mode = "REQUIRED", description = "The full name of the changed document, for example, projects/collection/databases/(default)/documents/users/me)." },
    { name = "operation",     type = "STRING",    mode = "REQUIRED", description = "One of CREATE, UPDATE, IMPORT, or DELETE." },
    { name = "data",          type = "STRING",    mode = "NULLABLE", description = "The full JSON representation of the document state after the indicated operation is applied. This field will be null for DELETE operations." },
    { name = "old_data",      type = "STRING",    mode = "NULLABLE", description = "The full JSON representation of the document state before the indicated operation is applied. This field will be null for CREATE operations." },
    { name = "document_id",   type = "STRING",    mode = "NULLABLE", description = "The document id as defined in the firestore database." },
  ])

  deletion_protection = true
}

# --- Views ---

resource "google_bigquery_table" "transactions_raw_latest" {
  dataset_id = google_bigquery_dataset.caffe_control.dataset_id
  table_id   = "transactions_raw_latest"
  project    = var.project_id

  view {
    query          = <<-SQL
      -- Retrieves the latest document change events for all live documents.
      --   timestamp: The Firestore timestamp at which the event took place.
      --   operation: One of INSERT, UPDATE, DELETE, IMPORT.
      --   event_id: The id of the event that triggered the cloud function mirrored the event.
      --   data: A raw JSON payload of the current state of the document.
      --   document_id: The document id as defined in the Firestore database
      WITH latest AS (
        SELECT
          MAX(timestamp) AS latest_timestamp,
          document_name
        FROM
          `caffe-control-prod.caffe_control.transactions_raw_changelog`
        GROUP BY
          document_name
      )
      SELECT
        t.document_name,
        document_id,
        timestamp AS timestamp,
        ANY_VALUE(event_id) AS event_id,
        operation AS operation,
        ANY_VALUE(data) AS data,
        ANY_VALUE(old_data) AS old_data
      FROM
        `caffe-control-prod.caffe_control.transactions_raw_changelog` AS t
        JOIN latest ON (
          t.document_name = latest.document_name
          AND IFNULL(t.timestamp, TIMESTAMP("1970-01-01 00:00:00+00")) = IFNULL(
            latest.latest_timestamp,
            TIMESTAMP("1970-01-01 00:00:00+00")
          )
        )
      WHERE
        operation != "DELETE"
      GROUP BY
        document_name,
        document_id,
        timestamp,
        operation
    SQL
    use_legacy_sql = false
  }

  deletion_protection = false
}

resource "google_bigquery_table" "v_transactions" {
  dataset_id = google_bigquery_dataset.caffe_control.dataset_id
  table_id   = "v_transactions"
  project    = var.project_id

  view {
    query          = <<-SQL
      SELECT
        document_id AS transaction_id,
        PARSE_TIMESTAMP("%Y-%m-%d %H:%M:%S", JSON_VALUE(data, "$.date_close_date")) AS date_close,
        DATE(PARSE_TIMESTAMP("%Y-%m-%d %H:%M:%S", JSON_VALUE(data, "$.date_close_date"))) AS date_close_date,
        EXTRACT(HOUR FROM PARSE_TIMESTAMP("%Y-%m-%d %H:%M:%S", JSON_VALUE(data, "$.date_close_date"))) AS hour_of_day,
        CAST(JSON_VALUE(data, "$.payed_sum") AS INT64) / 100.0 AS payed_sum,
        CAST(JSON_VALUE(data, "$.payed_cash") AS INT64) / 100.0 AS payed_cash,
        CAST(JSON_VALUE(data, "$.payed_card") AS INT64) / 100.0 AS payed_card,
        CAST(JSON_VALUE(data, "$.total_profit") AS INT64) / 100.0 AS profit,
        JSON_VALUE(data, "$.name") AS waiter_name,
        JSON_VALUE(data, "$.user_id") AS user_id,
        JSON_VALUE(data, "$.spot_id") AS spot_id,
        JSON_VALUE(data, "$.pay_type") AS pay_type,
        CAST(JSON_VALUE(data, "$.guests_count") AS INT64) AS guests_count,
        CAST(JSON_VALUE(data, "$.discount") AS INT64) / 100.0 AS discount,
        JSON_VALUE(data, "$.status") AS status,
        JSON_QUERY(data, "$.products") AS products_json,
        JSON_QUERY(data, "$.write_offs") AS write_offs_json,
        timestamp AS synced_at
      FROM `caffe-control-prod.caffe_control.transactions_raw_latest`
      WHERE operation != "DELETE"
    SQL
    use_legacy_sql = false
  }

  deletion_protection = false
}

resource "google_bigquery_table" "v_daily_sales" {
  dataset_id = google_bigquery_dataset.caffe_control.dataset_id
  table_id   = "v_daily_sales"
  project    = var.project_id

  view {
    query          = <<-SQL
      SELECT
        date_close_date AS date,
        COUNT(*) AS transactions_count,
        SUM(payed_sum) AS total_revenue,
        SUM(profit) AS total_profit,
        SUM(payed_cash) AS cash_revenue,
        SUM(payed_card) AS card_revenue,
        AVG(payed_sum) AS avg_check,
        SUM(guests_count) AS total_guests
      FROM `caffe-control-prod.caffe_control.v_transactions`
      GROUP BY date_close_date
    SQL
    use_legacy_sql = false
  }

  deletion_protection = false
}

resource "google_bigquery_table" "v_hourly_sales" {
  dataset_id = google_bigquery_dataset.caffe_control.dataset_id
  table_id   = "v_hourly_sales"
  project    = var.project_id

  view {
    query          = <<-SQL
      SELECT
        hour_of_day,
        COUNT(*) AS transactions_count,
        SUM(payed_sum) AS total_revenue,
        AVG(payed_sum) AS avg_check
      FROM `caffe-control-prod.caffe_control.v_transactions`
      GROUP BY hour_of_day
    SQL
    use_legacy_sql = false
  }

  deletion_protection = false
}

resource "google_bigquery_table" "v_products_sold" {
  dataset_id = google_bigquery_dataset.caffe_control.dataset_id
  table_id   = "v_products_sold"
  project    = var.project_id

  view {
    query          = <<-SQL
      SELECT
        t.transaction_id,
        t.date_close,
        t.date_close_date,
        t.hour_of_day,
        t.waiter_name,
        JSON_VALUE(p, "$.product_id") AS product_id,
        JSON_VALUE(p, "$.product_name") AS product_name,
        JSON_VALUE(p, "$.modification_id") AS modification_id,
        CAST(JSON_VALUE(p, "$.num") AS FLOAT64) AS quantity,
        CAST(JSON_VALUE(p, "$.payed_sum") AS INT64) / 100.0 AS amount,
        CAST(JSON_VALUE(p, "$.product_price") AS INT64) / 100.0 AS unit_price,
        CAST(JSON_VALUE(p, "$.product_cost") AS INT64) / 100.0 AS cost,
        CAST(JSON_VALUE(p, "$.product_profit") AS INT64) / 100.0 AS profit
      FROM `caffe-control-prod.caffe_control.v_transactions` t,
      UNNEST(JSON_QUERY_ARRAY(t.products_json)) AS p
    SQL
    use_legacy_sql = false
  }

  deletion_protection = false
}

resource "google_bigquery_table" "v_waiter_performance" {
  dataset_id = google_bigquery_dataset.caffe_control.dataset_id
  table_id   = "v_waiter_performance"
  project    = var.project_id

  view {
    query          = <<-SQL
      SELECT
        waiter_name,
        user_id,
        COUNT(*) AS transactions_count,
        SUM(payed_sum) AS total_revenue,
        SUM(profit) AS total_profit,
        AVG(payed_sum) AS avg_check,
        MIN(date_close_date) AS first_transaction,
        MAX(date_close_date) AS last_transaction
      FROM `caffe-control-prod.caffe_control.v_transactions`
      GROUP BY waiter_name, user_id
    SQL
    use_legacy_sql = false
  }

  deletion_protection = false
}
