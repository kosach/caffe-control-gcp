# syncTransactions Function

## Overview

Synchronizes transactions from Poster API to MongoDB by fetching all transactions in paginated batches and inserting them into the database. Handles duplicates gracefully using MongoDB's `insertMany` with `ordered: false` and unique indexes.

## Purpose

- Bulk synchronization of transactions from Poster API to local MongoDB
- Initial data migration or periodic full sync
- Handles large datasets through pagination
- Resilient to duplicate key errors (skips existing records)

## Technical Specification

### Endpoint

```
GET /syncTransactions
```

### Authentication

- Required: `auth-token` query parameter
- Value: `API_AUTH_KEY` from environment variables

### Query Parameters

| Parameter | Type | Required | Description | Default |
|-----------|------|----------|-------------|---------|
| auth-token | string | Yes | API authentication token | - |
| dateFrom | string | No | Start date (YYYY-MM-DD HH:MM:SS) | - |
| dateTo | string | No | End date (YYYY-MM-DD HH:MM:SS) | - |
| status | string | No | Transaction status filter (e.g., "accepted") | - |

### Response Format

#### Success (200 OK)

```json
{
  "success": true,
  "data": {
    "totalRows": 1250,
    "affectedRows": 143,
    "affectedWithError": 1107,
    "pagesProcessed": 13
  }
}
```

#### Error Responses

```json
{
  "success": false,
  "error": "Error message"
}
```

| Status Code | Description |
|-------------|-------------|
| 200 | Sync completed (partial or full success) |
| 401 | Unauthorized - invalid auth token |
| 500 | Server error |

## Algorithm Flow

```
1. Initialize counters (affectedRows, affectedWithError, totalRows, page)
2. Loop while not stopped:
   a. Fetch transactions page from Poster API (100 per page)
   b. If page 1: store total count
   c. If no data returned: stop loop
   d. Insert batch into MongoDB with ordered: false
   e. Catch duplicate key errors, count them
   f. Add successful inserts to affectedRows
   g. Increment page counter
3. Return statistics
```

## Implementation Details

### Poster API Integration

```typescript
// Fetch transactions from Poster API
const response = await fetch(
  `https://joinposter.com/api/dash.getTransactions?token=${POSTER_TOKEN}` +
  `&dateFrom=${dateFrom}&dateTo=${dateTo}&status=${status}` +
  `&page=${page}&per_page=100`
);
```

### MongoDB Insertion Strategy

```typescript
// Insert with unordered bulk write
// Continues on duplicate key errors
await transactionsCollection.insertMany(
  transactions,
  { ordered: false }
).catch((err) => {
  // E11000 duplicate key errors are expected
  // Count duplicates from writeErrors
  if (err.code === 11000 || err.writeErrors) {
    affectedWithError += err.writeErrors?.length || 0;
  } else {
    throw err; // Re-throw unexpected errors
  }
});
```

### Error Handling

- **Duplicate Keys**: Counted but don't stop execution
- **Network Errors**: Propagated as 500 errors
- **API Errors**: Logged and returned in response
- **Unexpected Errors**: Caught and returned with error message

## Data Model

Uses existing MongoDB `transactions` collection with unique index on `transaction_id`:

```typescript
{
  transaction_id: number,     // Unique identifier from Poster
  date_close: string,         // Transaction date
  status: number,             // Transaction status
  // ... other Poster transaction fields
}
```

## Performance Considerations

- **Batch Size**: 100 records per page (Poster API limit)
- **Memory**: 512MB recommended (handles 100-record batches)
- **Timeout**: 540s (9 minutes for Cloud Functions Gen2)
- **Expected Duration**: ~30-60s for 1000 transactions
- **Rate Limiting**: Respects Poster API limits

## Testing Strategy

### Unit Tests

```typescript
describe('syncTransactions', () => {
  test('syncs new transactions successfully');
  test('handles duplicate transactions gracefully');
  test('processes multiple pages');
  test('returns correct statistics');
  test('validates auth token');
  test('handles empty results');
  test('handles Poster API errors');
  test('applies date filters correctly');
});
```

### Local Testing Scenarios

```bash
# Test without auth (expect 401)
curl "http://localhost:8080"

# Test full sync (last 7 days)
curl "http://localhost:8080?auth-token=caffe-secure-2025-prod-key-x7k9m"

# Test with date range
curl "http://localhost:8080?auth-token=...&dateFrom=2025-01-01%2000:00:00&dateTo=2025-01-31%2023:59:59"

# Test with status filter
curl "http://localhost:8080?auth-token=...&status=accepted"

# Test duplicate sync (run twice, expect affectedWithError > 0)
curl "http://localhost:8080?auth-token=...&dateFrom=2025-01-20%2000:00:00"
```

### Production Testing

```bash
# Initial sync (small date range first!)
curl "https://europe-west1-caffe-control-prod.cloudfunctions.net/syncTransactions?auth-token=...&dateFrom=2025-01-20%2000:00:00&dateTo=2025-01-21%2000:00:00"

# Verify MongoDB records
# Check logs in GCP Console
# Run again to verify duplicate handling
```

## Dependencies

- `@google-cloud/functions-framework` - HTTP function handler
- `mongodb` - Database operations
- Environment variables: `MONGODB_URI`, `API_AUTH_KEY`, `POSTER_TOKEN`

## Related Functions

- [getAllTransactions](./getAllTransactions.md) - Retrieves synced transactions
- [webhook](./webhook.md) - Real-time transaction updates

## Notes

- **Use Case**: One-time migration or periodic full sync
- **Not Real-Time**: For real-time updates, use webhook function
- **Idempotent**: Safe to run multiple times (handles duplicates)
- **Long-Running**: May take several minutes for large datasets
- **Monitoring**: Check GCP logs for progress and errors

## Migration Priority

Priority: **Medium** (useful but not critical)

Dependencies:
- Poster API client/fetch implementation
- MongoDB transactions collection with unique index
- Error handling utilities
