# Service Account used by Cloud Functions (Gen2)
resource "google_service_account" "functions_sa" {
  account_id   = "caffe-functions"
  display_name = "Caffe Control Functions Service Account"
  project      = var.project_id
}

# IAM roles for the functions SA
resource "google_project_iam_member" "functions_sa_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.functions_sa.email}"
}

resource "google_project_iam_member" "functions_sa_log_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.functions_sa.email}"
}

resource "google_project_iam_member" "functions_sa_datastore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.functions_sa.email}"
}

# NOTE: The following service accounts are NOT managed by Terraform.
# They are created/managed by Firebase or GCP automatically:
#   - ext-firestore-bigquery-export@caffe-control-prod.iam.gserviceaccount.com (Firebase extension)
#   - firebase-adminsdk-fbsvc@caffe-control-prod.iam.gserviceaccount.com (Firebase Admin SDK)
#   - 872048017557-compute@developer.gserviceaccount.com (Default compute)
#   - caffe-control-prod@appspot.gserviceaccount.com (App Engine default)
