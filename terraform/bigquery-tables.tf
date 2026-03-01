# BigQuery tables for synced catalog data

resource "google_bigquery_table" "products_catalog" {
  dataset_id = google_bigquery_dataset.caffe_control.dataset_id
  table_id   = "products_catalog"

  deletion_protection = false

  schema = jsonencode([
    { name = "product_id",       type = "STRING",   mode = "REQUIRED" },
    { name = "product_name",     type = "STRING",   mode = "REQUIRED" },
    { name = "menu_category_id", type = "STRING",   mode = "NULLABLE" },
    { name = "category_name",    type = "STRING",   mode = "NULLABLE" },
    { name = "root_category",    type = "STRING",   mode = "NULLABLE" },
    { name = "type",             type = "STRING",   mode = "NULLABLE" },
    { name = "unit",             type = "STRING",   mode = "NULLABLE" },
    { name = "cost",             type = "FLOAT64",  mode = "NULLABLE" },
    { name = "hidden",           type = "BOOLEAN",  mode = "NULLABLE" },
    { name = "out",              type = "BOOLEAN",  mode = "NULLABLE" },
    { name = "sort_order",       type = "INTEGER",  mode = "NULLABLE" },
    { name = "synced_at",        type = "TIMESTAMP", mode = "REQUIRED" },
  ])

  depends_on = [google_bigquery_dataset.caffe_control]
}

resource "google_bigquery_table" "categories_catalog" {
  dataset_id = google_bigquery_dataset.caffe_control.dataset_id
  table_id   = "categories_catalog"

  deletion_protection = false

  schema = jsonencode([
    { name = "category_id",          type = "STRING",   mode = "REQUIRED" },
    { name = "category_name",        type = "STRING",   mode = "REQUIRED" },
    { name = "parent_category_id",   type = "STRING",   mode = "NULLABLE" },
    { name = "parent_category_name", type = "STRING",   mode = "NULLABLE" },
    { name = "root_category",        type = "STRING",   mode = "NULLABLE" },
    { name = "level",                type = "INTEGER",  mode = "NULLABLE" },
    { name = "hidden",               type = "BOOLEAN",  mode = "NULLABLE" },
    { name = "sort_order",           type = "INTEGER",  mode = "NULLABLE" },
    { name = "synced_at",            type = "TIMESTAMP", mode = "REQUIRED" },
  ])

  depends_on = [google_bigquery_dataset.caffe_control]
}
