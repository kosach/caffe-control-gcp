variable "function_name" {
  type = string
}

variable "entry_point" {
  type = string
}

variable "source_dir" {
  type = string
}

variable "region" {
  type    = string
  default = "europe-west1"
}

variable "service_account_email" {
  type = string
}

variable "project_id" {
  type = string
}

# Create ZIP archive
data "archive_file" "function_zip" {
  type        = "zip"
  source_dir  = var.source_dir
  output_path = "${path.module}/.tmp/${var.function_name}.zip"
}

# Upload to bucket
resource "google_storage_bucket_object" "function_source" {
  name   = "${var.function_name}-${data.archive_file.function_zip.output_md5}.zip"
  bucket = "${var.project_id}-functions-source"
  source = data.archive_file.function_zip.output_path
}

# Cloud Function
resource "google_cloudfunctions2_function" "function" {
  name     = var.function_name
  location = var.region

  build_config {
    runtime     = "nodejs20"
    entry_point = var.entry_point
    source {
      storage_source {
        bucket = google_storage_bucket_object.function_source.bucket
        object = google_storage_bucket_object.function_source.name
      }
    }
  }

  service_config {
    available_memory      = "256M"
    timeout_seconds       = 60
    service_account_email = var.service_account_email
    
    environment_variables = {
      GCP_PROJECT_ID = var.project_id
    }
  }
}

# Make function publicly accessible - Cloud Functions IAM
resource "google_cloudfunctions2_function_iam_member" "invoker" {
  project        = google_cloudfunctions2_function.function.project
  location       = google_cloudfunctions2_function.function.location
  cloud_function = google_cloudfunctions2_function.function.name
  role           = "roles/cloudfunctions.invoker"
  member         = "allUsers"
}

# Make underlying Cloud Run service publicly accessible
# Cloud Functions v2 deploys to Cloud Run with lowercase service name
resource "google_cloud_run_service_iam_member" "invoker" {
  project  = google_cloudfunctions2_function.function.project
  location = google_cloudfunctions2_function.function.location
  service  = lower(google_cloudfunctions2_function.function.name)
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "function_uri" {
  value = google_cloudfunctions2_function.function.service_config[0].uri
}
