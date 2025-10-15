cat > docs/deployment.md << 'EOF'
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

### Manual Deployment
```bash
gcloud functions deploy FUNCTION_NAME \
  --gen2 \
  --runtime=nodejs20 \
  --region=europe-west1 \
  --source=./functions/api/FUNCTION_NAME \
  --entry-point=handler \
  --trigger-http \
  --allow-unauthenticated \
  --service-account=caffe-functions@caffe-control-prod.iam.gserviceaccount.com
```

### Using Deployment Script
```bash
./scripts/deploy-function.sh FUNCTION_NAME
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

EOF