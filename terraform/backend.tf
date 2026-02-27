terraform {
  backend "gcs" {
    bucket = "caffe-control-prod-tfstate"
    prefix = "terraform/state"
  }
}
