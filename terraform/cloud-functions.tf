# Cloud Functions (Gen2) — deployed via gcloud, managed here for state tracking.
#
# NOTE: These functions are deployed from source zip in GCS. Terraform manages
# the function configuration but the actual source code is deployed separately
# via gcloud functions deploy or CI/CD.
#
# IMPORTANT: The Firebase Extension Cloud Run service is NOT managed here:
#   - ext-firestore-bigquery-export-fsexportbigquery (us-central1)
#   It is managed by Firebase Extensions and importing it would cause conflicts.

resource "google_cloudfunctions2_function" "webhook" {
  name     = "webhook"
  location = var.region
  project  = var.project_id

  build_config {
    runtime     = "nodejs20"
    entry_point = "webhook"
    source {
      storage_source {
        bucket = "gcf-v2-sources-872048017557-europe-west1"
        object = "webhook/function-source.zip"
      }
    }
    docker_repository = "projects/caffe-control-prod/locations/europe-west1/repositories/gcf-artifacts"
  }

  service_config {
    available_memory                 = "256Mi"
    available_cpu                    = "0.1666"
    timeout_seconds                  = 60
    max_instance_count               = 100
    max_instance_request_concurrency = 1
    ingress_settings                 = "ALLOW_ALL"
    all_traffic_on_latest_revision   = true
    service_account_email            = google_service_account.functions_sa.email
    environment_variables = {
      GCP_PROJECT_ID   = var.project_id
      LOG_EXECUTION_ID = "true"
    }
  }
}

resource "google_cloudfunctions2_function" "get_all_transactions" {
  name     = "getAllTransactions"
  location = var.region
  project  = var.project_id

  build_config {
    runtime     = "nodejs20"
    entry_point = "getAllTransactions"
    source {
      storage_source {
        bucket = "gcf-v2-sources-872048017557-europe-west1"
        object = "getAllTransactions/function-source.zip"
      }
    }
    docker_repository = "projects/caffe-control-prod/locations/europe-west1/repositories/gcf-artifacts"
  }

  service_config {
    available_memory                 = "256M"
    available_cpu                    = "0.1666"
    timeout_seconds                  = 60
    max_instance_count               = 100
    max_instance_request_concurrency = 1
    ingress_settings                 = "ALLOW_ALL"
    all_traffic_on_latest_revision   = true
    service_account_email            = google_service_account.functions_sa.email
    environment_variables = {
      GCP_PROJECT_ID   = var.project_id
      LOG_EXECUTION_ID = "true"
    }
  }
}

resource "google_cloudfunctions2_function" "sync_transactions" {
  name     = "syncTransactions"
  location = var.region
  project  = var.project_id

  build_config {
    runtime     = "nodejs20"
    entry_point = "syncTransactions"
    source {
      storage_source {
        bucket = "gcf-v2-sources-872048017557-europe-west1"
        object = "syncTransactions/function-source.zip"
      }
    }
    docker_repository = "projects/caffe-control-prod/locations/europe-west1/repositories/gcf-artifacts"
  }

  service_config {
    available_memory                 = "512M"
    available_cpu                    = "0.3333"
    timeout_seconds                  = 540
    max_instance_count               = 60
    max_instance_request_concurrency = 1
    ingress_settings                 = "ALLOW_ALL"
    all_traffic_on_latest_revision   = true
    service_account_email            = google_service_account.functions_sa.email
    environment_variables = {
      GCP_PROJECT_ID   = var.project_id
      LOG_EXECUTION_ID = "true"
    }
  }
}
