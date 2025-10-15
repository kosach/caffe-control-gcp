output "project_id" {
  description = "GCP Project ID"
  value       = var.project_id
}

output "service_account_email" {
  description = "Service Account email for Cloud Functions"
  value       = google_service_account.functions_sa.email
}

output "functions_source_bucket" {
  description = "Bucket for functions source code"
  value       = google_storage_bucket.functions_source.name
}

output "secrets_created" {
  description = "Created secrets (set values manually)"
  value = {
    api_auth_key        = google_secret_manager_secret.api_auth_key.secret_id
    poster_token        = google_secret_manager_secret.poster_token.secret_id
    poster_hook_api_key = google_secret_manager_secret.poster_hook_api_key.secret_id
    mongodb_uri         = google_secret_manager_secret.mongodb_uri.secret_id
  }
}
