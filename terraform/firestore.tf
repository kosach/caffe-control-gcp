# Firestore database (Native mode)
# Collections (transactions, poster-hooks-data, catalog) are not managed by Terraform.
resource "google_firestore_database" "main" {
  project     = var.project_id
  name        = "(default)"
  location_id = "eur3"
  type        = "FIRESTORE_NATIVE"
}
