variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "europe-west1"
}

variable "environment" {
  description = "Environment (dev, prod)"
  type        = string
  default     = "prod"
}

variable "api_auth_token" {
  description = "API auth token for Cloud Scheduler HTTP calls"
  type        = string
  sensitive   = true
}
