#!/bin/bash
set -e

# Create GCS bucket for Terraform state (idempotent)
gsutil mb -p caffe-control-prod -l europe-west1 gs://caffe-control-prod-tfstate 2>/dev/null || true
gsutil versioning set on gs://caffe-control-prod-tfstate

# Initialize Terraform
terraform init

# --- Service Account ---
terraform import google_service_account.functions_sa projects/caffe-control-prod/serviceAccounts/caffe-functions@caffe-control-prod.iam.gserviceaccount.com

# --- IAM bindings ---
# NOTE: google_project_iam_member imports are tricky — format: "PROJECT ROLE member"
terraform import 'google_project_iam_member.functions_sa_secret_accessor' "caffe-control-prod roles/secretmanager.secretAccessor serviceAccount:caffe-functions@caffe-control-prod.iam.gserviceaccount.com"
terraform import 'google_project_iam_member.functions_sa_log_writer' "caffe-control-prod roles/logging.logWriter serviceAccount:caffe-functions@caffe-control-prod.iam.gserviceaccount.com"
terraform import 'google_project_iam_member.functions_sa_datastore_user' "caffe-control-prod roles/datastore.user serviceAccount:caffe-functions@caffe-control-prod.iam.gserviceaccount.com"

# --- BigQuery ---
terraform import google_bigquery_dataset.caffe_control projects/caffe-control-prod/datasets/caffe_control
terraform import google_bigquery_table.transactions_raw_changelog projects/caffe-control-prod/datasets/caffe_control/tables/transactions_raw_changelog

# Import views
for v in transactions_raw_latest v_daily_sales v_hourly_sales v_products_sold v_transactions v_waiter_performance; do
  terraform import "google_bigquery_table.$v" "projects/caffe-control-prod/datasets/caffe_control/tables/$v"
done

# --- Firestore ---
terraform import google_firestore_database.main "projects/caffe-control-prod/databases/(default)"

# --- Secrets ---
terraform import google_secret_manager_secret.api_auth_key projects/caffe-control-prod/secrets/api-auth-key
terraform import google_secret_manager_secret.poster_token projects/caffe-control-prod/secrets/poster-token
terraform import google_secret_manager_secret.poster_hook_api_key projects/caffe-control-prod/secrets/poster-hook-api-key
terraform import google_secret_manager_secret.mongodb_uri projects/caffe-control-prod/secrets/mongodb-uri

# --- Cloud Functions (Gen2) ---
terraform import google_cloudfunctions2_function.webhook projects/caffe-control-prod/locations/europe-west1/functions/webhook
terraform import google_cloudfunctions2_function.get_all_transactions projects/caffe-control-prod/locations/europe-west1/functions/getAllTransactions
terraform import google_cloudfunctions2_function.sync_transactions projects/caffe-control-prod/locations/europe-west1/functions/syncTransactions

# --- APIs (google_project_service) ---
# These are typically not imported — Terraform will just ensure they stay enabled.
# If you want to import them:
for api in cloudfunctions.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com storage.googleapis.com run.googleapis.com firestore.googleapis.com bigquery.googleapis.com artifactregistry.googleapis.com; do
  terraform import "google_project_service.required_apis[\"$api\"]" "caffe-control-prod/$api"
done

echo ""
echo "Import complete! Run 'terraform plan' to verify no changes."
