terraform {
  required_version = ">= 1.0"
  
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Enable required APIs
resource "google_project_service" "required_apis" {
  for_each = toset([
    "cloudfunctions.googleapis.com",
    "cloudbuild.googleapis.com",
    "secretmanager.googleapis.com",
    "storage.googleapis.com",
    "run.googleapis.com"
  ])
  
  service            = each.key
  disable_on_destroy = false
}

# Service Account for Cloud Functions
resource "google_service_account" "functions_sa" {
  account_id   = "caffe-functions"
  display_name = "Caffe Control Functions Service Account"
  
  depends_on = [google_project_service.required_apis]
}

# Grant roles to Service Account
resource "google_project_iam_member" "functions_sa_roles" {
  for_each = toset([
    "roles/secretmanager.secretAccessor",
    "roles/logging.logWriter"
  ])
  
  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.functions_sa.email}"
}

# Bucket for Cloud Functions source code
resource "google_storage_bucket" "functions_source" {
  name          = "${var.project_id}-functions-source"
  location      = var.region
  force_destroy = true
  
  uniform_bucket_level_access = true
  
  depends_on = [google_project_service.required_apis]
}

# Secret Manager secrets
resource "google_secret_manager_secret" "api_auth_key" {
  secret_id = "api-auth-key"
  
  replication {
    auto {}
  }
  
  depends_on = [google_project_service.required_apis]
}

resource "google_secret_manager_secret" "poster_token" {
  secret_id = "poster-token"
  
  replication {
    auto {}
  }
  
  depends_on = [google_project_service.required_apis]
}

resource "google_secret_manager_secret" "poster_hook_api_key" {
  secret_id = "poster-hook-api-key"
  
  replication {
    auto {}
  }
  
  depends_on = [google_project_service.required_apis]
}

resource "google_secret_manager_secret" "mongodb_uri" {
  secret_id = "mongodb-uri"
  
  replication {
    auto {}
  }
  
  depends_on = [google_project_service.required_apis]
}

# Grant Service Account access to secrets
resource "google_secret_manager_secret_iam_member" "api_auth_key_access" {
  secret_id = google_secret_manager_secret.api_auth_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.functions_sa.email}"
}

resource "google_secret_manager_secret_iam_member" "poster_token_access" {
  secret_id = google_secret_manager_secret.poster_token.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.functions_sa.email}"
}

resource "google_secret_manager_secret_iam_member" "poster_hook_key_access" {
  secret_id = google_secret_manager_secret.poster_hook_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.functions_sa.email}"
}

resource "google_secret_manager_secret_iam_member" "mongodb_uri_access" {
  secret_id = google_secret_manager_secret.mongodb_uri.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.functions_sa.email}"
}

# Deploy getAllTransactions function
module "get_all_transactions" {
  source = "./modules/cloud-function"

  function_name         = "getAllTransactions"
  entry_point           = "getAllTransactions"
  source_dir            = "../functions/nodejs/dist-bundle/getAllTransactions"
  region                = var.region
  service_account_email = google_service_account.functions_sa.email
  project_id            = var.project_id

  depends_on = [
    google_project_service.required_apis,
    google_storage_bucket.functions_source
  ]
}

module "webhook" {
  source = "./modules/cloud-function"

  function_name         = "webhook"
  entry_point           = "webhook"
  source_dir            = "../functions/nodejs/dist-bundle/webhook"
  region                = var.region
  service_account_email = google_service_account.functions_sa.email
  project_id            = var.project_id

  depends_on = [
    google_project_service.required_apis,
    google_storage_bucket.functions_source
  ]
}

module "sync_transactions" {
  source = "./modules/cloud-function"

  function_name         = "syncTransactions"
  entry_point           = "syncTransactions"
  source_dir            = "../functions/nodejs/dist-bundle/syncTransactions"
  region                = var.region
  service_account_email = google_service_account.functions_sa.email
  project_id            = var.project_id
  memory                = "512M"
  timeout               = 540

  depends_on = [
    google_project_service.required_apis,
    google_storage_bucket.functions_source
  ]
}

output "getAllTransactions_url" {
  description = "URL of getAllTransactions function"
  value       = module.get_all_transactions.function_uri
}

output "webhook_url" {
  description = "URL of webhook function"
  value       = module.webhook.function_uri
}

output "syncTransactions_url" {
  description = "URL of syncTransactions function"
  value       = module.sync_transactions.function_uri
}
