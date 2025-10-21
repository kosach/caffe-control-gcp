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
| dateFrom | string | **Yes** | Start date (YYYY-MM-DD) | - |
| dateTo | string | No | End date (YYYY-MM-DD) | - |

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
| 400 | Bad Request - missing required dateFrom parameter |
| 401 | Unauthorized - invalid auth token |
| 500 | Server error |

## Algorithm Flow

```
1. Validate required dateFrom parameter (return 400 if missing)
2. Initialize counters (affectedRows, affectedWithError, totalRows, page, pagesWithoutNewRecords)
3. Loop while not stopped:
   a. Fetch transactions page from Poster API (100 per page)
   b. Check if all transactions are older than dateFrom → stop if true
   c. Filter transactions locally by dateFrom/dateTo (Poster API doesn't support date filtering)
   d. If no matching transactions after filter: skip to next page
   e. Insert batch into MongoDB with ordered: false
   f. Catch duplicate key errors, count them
   g. Add successful inserts to affectedRows
   h. Track pages without new records (stop after 10 consecutive)
   i. Increment page counter
4. Return statistics
```

## Implementation Details

### Poster API Integration

**Important**: Poster API `dash.getTransactions` does NOT support date filtering via parameters. We filter locally after fetching.

```typescript
// Fetch transactions from Poster API (no date filtering available)
const response = await fetch(
  `https://joinposter.com/api/dash.getTransactions?token=${POSTER_TOKEN}` +
  `&page=${page}&per_page=100`
);

// Filter locally by date
transactions = transactions.filter((tx) => {
  const txDate = tx.date_close_date.split(' ')[0]; // Get YYYY-MM-DD
  return txDate >= dateFrom && (!dateTo || txDate <= dateTo);
});
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

# Test without dateFrom (expect 400)
curl "http://localhost:8080?auth-token=caffe-secure-2025-prod-key-x7k9m"

# Test with single day
curl "http://localhost:8080?auth-token=caffe-secure-2025-prod-key-x7k9m&dateFrom=2025-10-21"

# Test with date range
curl "http://localhost:8080?auth-token=...&dateFrom=2025-01-01&dateTo=2025-01-31"

# Test duplicate sync (run twice, expect affectedWithError > 0)
curl "http://localhost:8080?auth-token=...&dateFrom=2025-10-20&dateTo=2025-10-21"
```

### Production Testing

```bash
# Initial sync (small date range first!)
curl "https://synctransactions-5txnprikja-ew.a.run.app?auth-token=...&dateFrom=2025-10-21"

# Test with date range
curl "https://synctransactions-5txnprikja-ew.a.run.app?auth-token=...&dateFrom=2025-10-15&dateTo=2025-10-21"

# Verify MongoDB records
# Check logs in GCP Console
# Run again to verify duplicate handling (should stop after ~10 pages)
```

## Dependencies

- `@google-cloud/functions-framework` - HTTP function handler
- `mongodb` - Database operations
- Environment variables: `MONGODB_URI`, `API_AUTH_KEY`, `POSTER_TOKEN`

## Related Functions

- [getAllTransactions](./getAllTransactions.md) - Retrieves synced transactions
- [webhook](./webhook.md) - Real-time transaction updates

## Notes

- **Use Case**: One-time migration or periodic full sync for specific date ranges
- **Not Real-Time**: For real-time updates, use webhook function
- **Idempotent**: Safe to run multiple times (handles duplicates)
- **Smart Stopping**: Automatically stops after 10 consecutive pages without new records
- **Required Parameter**: dateFrom is REQUIRED to prevent accidental full sync
- **Date Filtering**: Done locally (Poster API doesn't support date parameters)
- **Monitoring**: Check GCP logs for progress and errors

## Migration Priority

Priority: **Medium** (useful but not critical)

Dependencies:
- Poster API client/fetch implementation
- MongoDB transactions collection with unique index
- Error handling utilities
