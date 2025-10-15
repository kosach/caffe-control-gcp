cat > docs/infrastructure.md << 'EOF'
# Infrastructure Overview

Last updated: 2025-10-15

## GCP Project

- **Project ID**: caffe-control-prod
- **Region**: europe-west1
- **Environment**: Production

## Service Account

**Email**: `caffe-functions@caffe-control-prod.iam.gserviceaccount.com`

**Roles**:
- `roles/secretmanager.secretAccessor` - Access to secrets
- `roles/logging.logWriter` - Write logs

## Enabled APIs

- `cloudfunctions.googleapis.com` - Cloud Functions
- `cloudbuild.googleapis.com` - Cloud Build for deployments
- `secretmanager.googleapis.com` - Secret Manager
- `storage.googleapis.com` - Cloud Storage
- `run.googleapis.com` - Cloud Run (for functions)

## Storage Buckets

### Functions Source
- **Name**: `caffe-control-prod-functions-source`
- **Location**: europe-west1
- **Purpose**: Store zipped function code for deployment

## Secrets (Secret Manager)

All secrets are empty and need to be populated:

1. **api-auth-key** - API authentication key for endpoints
2. **poster-token** - Poster POS API token
3. **poster-hook-api-key** - Webhook authentication key
4. **mongodb-uri** - MongoDB Atlas connection string

## Database

- **Provider**: MongoDB Atlas (existing)
- **Database**: easy-control
- **Collections**:
  - `transactions` - Sales transactions
  - `products` - Products catalog
  - `poster-hooks-data` - Webhook data from Poster POS

## Terraform State

- Stored locally in `terraform/terraform.tfstate`
- **TODO**: Migrate to GCS bucket for team collaboration

## Cost Estimation

Current setup (minimal usage):
- Secret Manager: ~$0.06/secret/month
- Storage Bucket: ~$0.02/GB/month
- Cloud Functions: Pay per invocation
- Total base cost: ~$1-2/month (without function invocations)

EOF