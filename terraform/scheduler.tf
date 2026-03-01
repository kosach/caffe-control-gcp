# Cloud Scheduler jobs for periodic syncs

# Sync catalog daily at 04:00 Kyiv time
resource "google_cloud_scheduler_job" "sync_catalog_daily" {
  name        = "sync-catalog-daily"
  description = "Sync product catalog and categories from Poster to BigQuery"
  schedule    = "0 4 * * *"
  time_zone   = "Europe/Kyiv"
  region      = var.region

  http_target {
    uri         = "${module.sync_catalog.function_uri}?auth-token=${var.api_auth_token}"
    http_method = "GET"

    headers = {
      "Content-Type" = "application/json"
    }
  }

  retry_config {
    retry_count          = 2
    min_backoff_duration = "30s"
    max_backoff_duration = "120s"
  }

  depends_on = [google_project_service.required_apis]
}

# Sync transactions daily at 03:00 Kyiv time
# dateFrom=yesterday is handled by the function when no dateFrom is provided
resource "google_cloud_scheduler_job" "sync_transactions_daily" {
  name        = "sync-transactions-daily"
  description = "Sync recent transactions from Poster to Firestore with enrichment"
  schedule    = "0 3 * * *"
  time_zone   = "Europe/Kyiv"
  region      = var.region

  http_target {
    uri         = "${module.sync_transactions.function_uri}?auth-token=${var.api_auth_token}&dateFrom=yesterday"
    http_method = "GET"

    headers = {
      "Content-Type" = "application/json"
    }
  }

  retry_config {
    retry_count          = 2
    min_backoff_duration = "60s"
    max_backoff_duration = "300s"
  }

  depends_on = [google_project_service.required_apis]
}
