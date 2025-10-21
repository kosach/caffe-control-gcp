# Deployment Guide

## Prerequisites

- Infrastructure deployed via Terraform
- Secrets filled with values
- Function code ready

## Functions to Migrate

### HTTP Endpoints
1. `poster_hooks` - Webhook receiver from Poster POS
2. `getAllTransactions` - Get transactions list
3. `getSummeryByDay` - Daily statistics
4. `getSalaryByDate` - Employee salary by date
5. `getProductsAndIngradients` - Products and ingredients list

### Event-Driven
6. `saveTransactionById` - Process transaction from webhook (trigger)

## Deploy a Function

### Using Terraform (Recommended)

1. Add function to `functions/nodejs/api/FUNCTION_NAME/index.ts`
2. Add entry point to `functions/nodejs/tsup.config.ts`
3. Bundle the function:
```bash
cd functions/nodejs
npm run bundle
```

4. Add Terraform module to `terraform/main.tf`:
```hcl
module "function_name" {
  source = "./modules/cloud-function"

  function_name         = "functionName"
  entry_point           = "functionName"
  source_dir            = "../functions/nodejs/dist-bundle/functionName"
  region                = var.region
  service_account_email = google_service_account.functions_sa.email
  project_id            = var.project_id
  memory                = "256M"  # Optional, defaults to 256M
  timeout               = 60      # Optional, defaults to 60s
}
```

5. Deploy with Terraform:
```bash
cd terraform
terraform plan
terraform apply
```

## Function Configuration

### Environment Variables

Functions access secrets automatically via Secret Manager with the Service Account.

### Memory & Timeout

Default settings:
- Memory: 256MB
- Timeout: 60s
- Max instances: 100

Adjust if needed:
```bash
--memory=512MB \
--timeout=120s \
--max-instances=10
```

## Testing Deployed Function
```bash
# Get function URL
gcloud functions describe FUNCTION_NAME \
  --gen2 \
  --region=europe-west1 \
  --format="value(serviceConfig.uri)"

# Test with curl
curl -X POST "FUNCTION_URL?auth-token=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
```

## Monitoring

### View Logs
```bash
gcloud functions logs read FUNCTION_NAME \
  --gen2 \
  --region=europe-west1 \
  --limit=50
```

### View in Console
https://console.cloud.google.com/functions/list

## Rollback
```bash
# List versions
gcloud functions versions list FUNCTION_NAME

# Rollback to previous version
gcloud functions deploy FUNCTION_NAME --version=VERSION_ID
```