# getAllTransactions Function

**Status:** ✅ Completed and Deployed

## Overview
Retrieves all transactions from MongoDB with optional filtering by date range and limit.

## Endpoint
- **URL:** `https://getalltransactions-5txnprikja-ew.a.run.app`
- **Method:** GET
- **Auth:** Required via query parameter

## Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| auth-token | string | Yes | - | API authentication key |
| startDate | string | No | - | Start date (YYYY-MM-DD) |
| endDate | string | No | - | End date (YYYY-MM-DD) |
| limit | number | No | 100 | Max number of records |

## Response

### Success (200)
```json
[
  {
    "_id": "64b0026104bc7b3e165e70e3",
    "transaction_id": 212,
    "date_close": "1662224161862",
    "status": "2",
    "payed_sum": "7500",
    ...
  }
]
```

### Unauthorized (401)
```json
{
  "error": "Unauthorized"
}
```

### Error (500)
```json
{
  "error": "Internal server error",
  "message": "Error details"
}
```

## Implementation Details

- **Memory:** 256M
- **Timeout:** 60s
- **Database:** MongoDB transactions collection
- **Authentication:** Secret Manager api-auth-key

## Testing

### Local Testing
```bash
cd functions/nodejs
npx @google-cloud/functions-framework --target=getAllTransactions --source=dist-bundle/getAllTransactions.js --signature-type=http
```

### Manual Testing
```bash
# Without auth (should fail)
curl "http://localhost:8080?limit=5"

# With auth
curl "http://localhost:8080?limit=5&auth-token=caffe-secure-2025-prod-key-x7k9m"

# Production
curl "https://getalltransactions-5txnprikja-ew.a.run.app?limit=5&auth-token=caffe-secure-2025-prod-key-x7k9m"
```

## Migration Notes
- Added limit parameter (default 100) to prevent loading 55K+ documents
- Optimized from 512M to 256M memory
- Added comprehensive error handling
