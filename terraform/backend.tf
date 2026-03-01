terraform {
  backend "gcs" {
    bucket      = "caffe-control-prod-tfstate"
    prefix      = "terraform/state"
    credentials = "terraform-sa-key.json"
  }
}
