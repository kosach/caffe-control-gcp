# Secret Manager secrets
# NOTE: Only the secret resources are managed here, NOT the secret values/versions.

resource "google_secret_manager_secret" "api_auth_key" {
  secret_id = "api-auth-key"
  project   = var.project_id

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "poster_token" {
  secret_id = "poster-token"
  project   = var.project_id

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "poster_hook_api_key" {
  secret_id = "poster-hook-api-key"
  project   = var.project_id

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "mongodb_uri" {
  secret_id = "mongodb-uri"
  project   = var.project_id

  replication {
    auto {}
  }
}
