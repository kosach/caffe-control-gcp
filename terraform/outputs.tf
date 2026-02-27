output "webhook_url" {
  description = "Webhook function URL"
  value       = google_cloudfunctions2_function.webhook.url
}

output "get_all_transactions_url" {
  description = "getAllTransactions function URL"
  value       = google_cloudfunctions2_function.get_all_transactions.url
}

output "sync_transactions_url" {
  description = "syncTransactions function URL"
  value       = google_cloudfunctions2_function.sync_transactions.url
}

output "bigquery_dataset_id" {
  description = "BigQuery dataset ID"
  value       = google_bigquery_dataset.caffe_control.dataset_id
}

output "service_account_email" {
  description = "Cloud Functions service account email"
  value       = google_service_account.functions_sa.email
}
