variable "project_id" {
  description = "GCP Project ID"
  type        = string
  default     = "caffe-control-prod"
}

variable "region" {
  description = "Default GCP region"
  type        = string
  default     = "europe-west1"
}
