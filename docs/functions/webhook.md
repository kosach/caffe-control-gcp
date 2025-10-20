# Webhook Function

**Status:** ✅ Completed and Deployed

## Overview
Receives real-time transaction updates from Poster POS system. ALL webhooks are saved to `poster-hooks-data` for audit trail. When `action === 'changed'`, the function fetches full transaction data from Poster API and saves it to `transactions` collection.

This approach provides:
- Complete audit trail of all webhook events (raw webhooks)
- Clean transactions collection with ONLY Poster API data
- Full transaction details from official Poster API
- Ability to replay failed webhooks
- Analytics on all transaction lifecycle events

## Architecture Pattern
```
┌─────────────┐
│ Poster POS  │
└──────┬──────┘
       │ POST webhook
       │ ?api-key=xxx
       ▼
┌──────────────────────────────────────────────┐
│  Cloud Function: webhook                     │
│                                              │
│  1. ✅ Validate API key                      │
│  2. ✅ Save RAW webhook (ALL actions)        │
│  3. ✅ Validate payload                      │
│  4. ✅ Filter by action === 'changed'        │
│  5. ✅ Fetch full data from Poster API       │
│  6. ✅ Save ONLY Poster API data             │
│  7. ✅ Mark RAW webhook as processed         │
└──────────────────────────────────────────────┘
       │
       ├─────────────────────┬──────────────────────┐
       ▼                     ▼                      ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ poster-hooks-data│  │   Poster API     │  │   transactions   │
│                  │  │                  │  │                  │
│ action: added    │  │ (not called)     │  │ (skipped)        │
│ saved: ✅        │  │                  │  │                  │
│ to_trans: false  │  │                  │  │                  │
└──────────────────┘  └──────────────────┘  └──────────────────┘

┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ poster-hooks-data│  │   Poster API     │  │   transactions   │
│                  │  │                  │  │                  │
│ action: changed  │  │ GET transaction  │  │ ONLY Poster API  │
│ saved: ✅        │  │ ✅ Called        │  │ data saved: ✅   │
│ to_trans: true   │  │                  │  │                  │
└──────────────────┘  └──────────────────┘  └──────────────────┘

┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ poster-hooks-data│  │   Poster API     │  │   transactions   │
│                  │  │                  │  │                  │
│ action: removed  │  │ (not called)     │  │ (skipped)        │
│ saved: ✅        │  │                  │  │                  │
│ to_trans: false  │  │                  │  │                  │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

## Endpoint
```
POST https://webhook-url?api-key=<secret-value>
```

**Important:** Poster requires API key in query parameter (not header).

## Authentication

### Query Parameter
- **Parameter:** `api-key`
- **Location:** Query string (URL)
- **Validation:** Must match Secret Manager value `poster-hook-api-key`
- **Timing:** Checked BEFORE saving RAW data

### Authentication Flow
```
Request arrives
    ↓
Check api-key parameter
    ↓
Valid? ─── NO ──→ Return 401 (RAW NOT saved)
    │
   YES
    ↓
Save RAW data & continue processing
```

## Request Body

The webhook accepts the **official Poster webhook format**:

### Poster Webhook Format

This is the actual format sent by Poster POS system.

```json
{
  "account": "mykava6",
  "object": "transaction",
  "object_id": 16776,
  "action": "changed",
  "time": "1688722229",
  "verify": "f6a209fccb87d7051d49bf3342c656ab",
  "account_number": "333226",
  "data": "{\"transactions_history\":{\"type_history\":\"additem\",\"time\":1688722229115}}"
}
```

**Key characteristics:**
- `object_id` contains the transaction ID
- `action` uses official Poster actions (see table below)
- `data` can be a **JSON string** or object
- Contains Poster-specific fields: `account`, `verify`, `time`, etc.

### Supported Actions

Official Poster POS webhook actions:

| Poster Action | Saved to Transactions? | Poster API Called? | Notes |
|---------------|------------------------|-------------------|-------|
| `added` | ❌ NO | ❌ NO | Transaction created |
| `changed` | ✅ YES | ✅ YES | Transaction modified/completed - **fetches full data** |
| `removed` | ❌ NO | ❌ NO | Transaction deleted |
| `transformed` | ❌ NO | ❌ NO | Transaction transformed |

**Important:**
- Only `action === 'changed'` triggers Poster API call and transaction storage
- All actions are saved to `poster-hooks-data` for audit trail
- Transaction is saved ONLY if Poster API returns data successfully

## Processing Logic (Step by Step)

### Step 1: Method Validation
```typescript
if (req.method !== 'POST') {
  return 405 "Method not allowed"
}
```

### Step 2: Authentication
```typescript
const apiKey = req.query['api-key'];
const validKey = await getSecret('poster-hook-api-key');

if (!apiKey || apiKey !== validKey) {
  return 401 "Unauthorized"
  // ⚠️ RAW data NOT saved at this point
}
```

### Step 3: Save RAW Data (CRITICAL - Always First)
```typescript
const rawHookDocument = {
  // Spread webhook body at root level
  ...(typeof req.body === 'object' && req.body !== null
    ? req.body
    : { raw_body_string: req.body }),
  // Add metadata
  metadata: {
    received_at: new Date(),
    query_params: req.query,
    processed: false,
    processed_at: null,
    saved_to_transactions: false,
    processing_error: null,
    error_time: null
  }
};

const result = await db.collection('poster-hooks-data')
  .insertOne(rawHookDocument);

rawHookId = result.insertedId;
```

**Why save RAW first?**
- Ensures no data loss even if validation fails
- Provides audit trail for debugging
- Allows replaying failed webhooks
- Webhook body stored at root level for easy querying

### Step 4: Validate Payload
```typescript
// Validate action (official Poster actions only)
const ALLOWED_ACTIONS = ['added', 'changed', 'removed', 'transformed'];
if (!webhook.action || !ALLOWED_ACTIONS.includes(webhook.action)) {
  await updateRawHookError(rawHookId, 'Invalid action');
  return 400 "Invalid action"
}

// Validate object_id
const transactionId = webhook.object_id;
if (!transactionId || typeof transactionId !== 'number') {
  await updateRawHookError(rawHookId, 'Missing or invalid object_id');
  return 400 "Missing required fields"
}
```

### Step 5: Filter by Action (ONLY 'changed' → Poster API → transactions)
```typescript
let savedToTransactions = false;

if (webhook.action === 'changed') {
  // Fetch full transaction data from Poster API
  const posterToken = await getSecret('poster-token');
  const posterApiData = await fetchPosterTransaction(transactionId, posterToken);

  // Store ONLY Poster API transaction data if available
  if (posterApiData) {
    await db.collection('transactions').updateOne(
      { transaction_id: transactionId },
      { $set: posterApiData },  // ONLY Poster API data
      { upsert: true }
    );
    savedToTransactions = true;
    console.log('✅ Transaction saved:', transactionId);
  } else {
    console.warn('⚠️ Poster API data not available, skipping transaction save');
  }
} else {
  // Skip transactions - only RAW saved
  savedToTransactions = false;
}
```

### Step 6: Fetch Full Data from Poster API
```typescript
async function fetchPosterTransaction(transactionId, posterToken) {
  try {
    const url = `https://joinposter.com/api/finance.getTransaction?token=${posterToken}&transaction_id=${transactionId}`;

    const response = await axios.get(url, { timeout: 10000 });

    if (response.data && response.data.response) {
      return response.data.response;  // Full transaction data
    }

    return null;  // No data available
  } catch (error) {
    console.error('❌ Poster API request failed:', error);
    return null;
  }
}
```

### Step 7: Mark as Processed
```typescript
await db.collection('poster-hooks-data').updateOne(
  { _id: rawHookId },
  {
    $set: {
      'metadata.processed': true,
      'metadata.saved_to_transactions': savedToTransactions,
      'metadata.processed_at': new Date()
    }
  }
);
```

## Response Examples

### Success: Changed Transaction (200)
```json
{
  "success": true,
  "object_id": 16776,
  "action": "changed",
  "saved_to_transactions": true,
  "raw_hook_id": "507f1f77bcf86cd799439011"
}
```

### Success: Changed Transaction (Poster API Failed) (200)
```json
{
  "success": true,
  "object_id": 16776,
  "action": "changed",
  "saved_to_transactions": false,
  "raw_hook_id": "507f1f77bcf86cd799439012"
}
```

### Success: Added/Removed Transaction (200)
```json
{
  "success": true,
  "object_id": 12345,
  "action": "added",
  "saved_to_transactions": false,
  "raw_hook_id": "507f1f77bcf86cd799439013"
}
```

### Error: Unauthorized (401)
```json
{
  "error": "Unauthorized"
}
```

### Error: Invalid Payload (400)
```json
{
  "error": "Invalid payload",
  "details": "Invalid action: deleted. Allowed: added, changed, removed, transformed"
}
```

### Error: Processing Failed (500)
```json
{
  "error": "Processing failed",
  "message": "Unexpected error"
}
```

## Database Collections

### Collection 1: poster-hooks-data (ALL webhooks)

**Purpose:** Audit trail, debugging, replay capability

#### Document Structure (Webhook body at root + metadata)
```javascript
{
  _id: ObjectId("507f1f77bcf86cd799439011"),
  // Webhook body fields spread at root level
  account: "mykava6",
  object: "transaction",
  object_id: 12345,
  action: "added",
  time: "1688722229",
  verify: "f6a209fccb87d7051d49bf3342c656ab",
  account_number: "333226",
  data: "{\"status\":\"1\"}",
  // Metadata in separate field
  metadata: {
    received_at: ISODate("2025-10-18T10:00:00.000Z"),
    query_params: {
      "api-key": "xxx"  // Stored for debugging
    },
    processed: true,
    saved_to_transactions: false,  // false for added/removed
    processed_at: ISODate("2025-10-18T10:00:01.000Z"),
    processing_error: null,  // or error message if failed
    error_time: null  // or timestamp if failed
  }
}
```

#### Example: Changed Transaction (saved to both collections)
```javascript
{
  _id: ObjectId("507f1f77bcf86cd799439022"),
  account: "mykava6",
  object: "transaction",
  object_id: 16776,
  action: "changed",
  time: "1688722229",
  verify: "f6a209fccb87d7051d49bf3342c656ab",
  account_number: "333226",
  data: "{\"status\":\"2\",\"payed_sum\":\"5000\"}",
  metadata: {
    received_at: ISODate("2025-10-18T10:05:00.000Z"),
    query_params: { "api-key": "xxx" },
    processed: true,
    saved_to_transactions: true,  // ✅ true for changed!
    processed_at: ISODate("2025-10-18T10:05:01.000Z"),
    processing_error: null,
    error_time: null
  }
}
```

#### Example: Failed Validation
```javascript
{
  _id: ObjectId("507f1f77bcf86cd799439033"),
  account: "test_account",
  object: "transaction",
  object_id: 999,
  action: "deleted",  // Invalid action
  time: "1688722300",
  metadata: {
    received_at: ISODate("2025-10-18T10:10:00.000Z"),
    query_params: { "api-key": "xxx" },
    processed: false,
    saved_to_transactions: false,
    processed_at: null,
    processing_error: "Invalid action: deleted. Allowed: added, changed, removed, transformed",
    error_time: ISODate("2025-10-18T10:10:00.500Z")
  }
}
```

### Collection 2: transactions (ONLY Poster API data)

**Purpose:** Clean collection of completed transactions with full Poster data

**IMPORTANT:** This collection contains ONLY data from Poster API - NO webhook metadata!

#### Document Structure (ONLY Poster API fields)
```javascript
{
  _id: ObjectId("507f1f77bcf86cd799439044"),
  // ALL fields below are from Poster API response
  transaction_id: "16776",  // String from Poster API
  account_id: "1",
  user_id: "1",
  category_id: "7",
  type: "0",  // 0 = expense, 1 = income
  amount: "-8137663",  // In kopecks (cents)
  balance: "545516997964",  // Account balance in kopecks
  date: "2024-08-31 09:20:22",
  recipient_type: "0",
  recipient_id: "0",
  binding_type: "15",  // Related entity type
  binding_id: "400",  // Related entity ID
  comment: "Transaction comment",
  delete: "0",  // 0 = not deleted, 1 = deleted
  account_name: "Cash at location",
  category_name: "Sales",
  currency_symbol: "$"
  // Note: NO webhook_received_at, NO webhook_action, NO raw_hook_id
  // This is PURE Poster API data!
}
```

**Key Points:**
- All fields are strings (as returned by Poster API)
- `transaction_id` is the primary key for upserts
- NO webhook metadata - check `poster-hooks-data` for webhook details
- To link back to webhook: query `poster-hooks-data` by `object_id`

## Error Handling Matrix

| Scenario | poster-hooks-data | Poster API | transactions | Response | Notes |
|----------|-------------------|------------|--------------|----------|-------|
| ❌ Invalid API key | NOT saved | NOT called | NOT saved | 401 | Auth fails before RAW save |
| ✅ Valid, action=added | ✅ Saved | NOT called | NOT saved | 200 | RAW only |
| ✅ Valid, action=removed | ✅ Saved | NOT called | NOT saved | 200 | RAW only |
| ✅ Valid, action=changed, API success | ✅ Saved | ✅ Called | ✅ Saved | 200 | Full flow |
| ✅ Valid, action=changed, API fails | ✅ Saved | ⚠️ Failed | NOT saved | 200 | RAW saved, transaction skipped |
| ✅ Valid, action=changed, API empty | ✅ Saved | ✅ Called | NOT saved | 200 | API returned no data |
| ⚠️ Invalid action | ✅ Saved + error | NOT called | NOT saved | 400 | Error recorded |
| ⚠️ Missing object_id | ✅ Saved + error | NOT called | NOT saved | 400 | Error recorded |
| ❌ DB error (RAW) | NOT saved | NOT called | NOT saved | 500 | Critical failure |
| ❌ DB error (after RAW) | ✅ Saved + error | May be called | NOT saved | 500 | RAW preserved |

## Local Testing

### Start Local Server
```bash
cd functions/nodejs
npm run bundle

npx @google-cloud/functions-framework \
  --target=webhook \
  --source=dist-bundle/webhook.js \
  --signature-type=http \
  --port=8080
```

### Test Scenarios

#### Test 1: Valid Changed Transaction ✅
```bash
curl -X POST "http://localhost:8080?api-key=poster-webhook-secure-key-2025-p8mz3x" \
  -H "Content-Type: application/json" \
  -d '{
    "account": "test_cafe",
    "object": "transaction",
    "object_id": 999,
    "action": "changed",
    "time": "1729500000",
    "verify": "test_hash",
    "account_number": "12345",
    "data": "{\"status\":\"2\",\"payed_sum\":\"7500\"}"
  }'

# Expected Response:
{
  "success": true,
  "object_id": 999,
  "action": "changed",
  "saved_to_transactions": true,  // true if Poster API succeeds
  "raw_hook_id": "..."
}

# Database Check:
# - poster-hooks-data: 1 document (metadata.saved_to_transactions: true)
# - transactions: 1 document (ONLY Poster API data)
```

#### Test 2: Valid Added Transaction ✅
```bash
curl -X POST "http://localhost:8080?api-key=poster-webhook-secure-key-2025-p8mz3x" \
  -H "Content-Type: application/json" \
  -d '{
    "account": "test_cafe",
    "object": "transaction",
    "object_id": 888,
    "action": "added",
    "time": "1729500000",
    "verify": "test_hash",
    "account_number": "12345",
    "data": "{\"status\":\"1\"}"
  }'

# Expected Response:
{
  "success": true,
  "object_id": 888,
  "action": "added",
  "saved_to_transactions": false,
  "raw_hook_id": "..."
}

# Database Check:
# - poster-hooks-data: 1 document (metadata.saved_to_transactions: false)
# - transactions: 0 documents (not saved)
```

#### Test 3: Invalid API Key ❌
```bash
curl -X POST "http://localhost:8080?api-key=wrong-key" \
  -H "Content-Type: application/json" \
  -d '{"action":"closed","data":{"transaction_id":666}}'

# Expected Response:
{
  "error": "Unauthorized"
}

# Database Check:
# - poster-hooks-data: 0 documents (not saved - auth failed first)
# - transactions: 0 documents
```

#### Test 4: Missing API Key ❌
```bash
curl -X POST "http://localhost:8080" \
  -H "Content-Type: application/json" \
  -d '{"action":"closed","data":{"transaction_id":555}}'

# Expected Response:
{
  "error": "Unauthorized"
}

# Database Check:
# - poster-hooks-data: 0 documents
# - transactions: 0 documents
```

#### Test 5: Invalid Action ⚠️
```bash
curl -X POST "http://localhost:8080?api-key=poster-webhook-secure-key-2025-p8mz3x" \
  -H "Content-Type: application/json" \
  -d '{
    "account": "test",
    "object": "transaction",
    "object_id": 444,
    "action": "deleted",
    "time": "1729500000"
  }'

# Expected Response:
{
  "error": "Invalid payload",
  "details": "Invalid action: deleted. Allowed: added, changed, removed, transformed"
}

# Database Check:
# - poster-hooks-data: 1 document with metadata.processing_error
# - transactions: 0 documents
```

#### Test 6: Missing object_id ⚠️
```bash
curl -X POST "http://localhost:8080?api-key=poster-webhook-secure-key-2025-p8mz3x" \
  -H "Content-Type: application/json" \
  -d '{
    "account": "test",
    "object": "transaction",
    "action": "changed",
    "time": "1729500000"
  }'

# Expected Response:
{
  "error": "Invalid payload",
  "details": "Missing required field: object_id"
}

# Database Check:
# - poster-hooks-data: 1 document with metadata.processing_error
# - transactions: 0 documents
```

## Production Deployment

### Deploy
```bash
cd functions/nodejs
npm run bundle

cd ../../terraform
terraform apply
```

### Get URL
```bash
terraform output webhook_url
# Output: https://webhook-5txnprikja-ew.a.run.app
```

### Configure in Poster
```
Poster Admin Panel → Settings → Webhooks

URL: https://webhook-5txnprikja-ew.a.run.app?api-key=<your-secret-key>
Method: POST
Events to send:
  ✅ transaction.created
  ✅ transaction.updated
  ✅ transaction.closed
```

### Production Testing
```bash
# Get secret value
gcloud secrets versions access latest --secret="poster-hook-api-key"

# Test with real secret
curl -X POST "https://webhook-5txnprikja-ew.a.run.app?api-key=<secret-value>" \
  -H "Content-Type: application/json" \
  -d '{"action":"closed","data":{"transaction_id":12345,"status":"2"}}'
```

### Monitor Logs
```bash
# View function logs
gcloud functions logs read webhook --gen2 --region=europe-west1 --limit=50

# Watch logs in real-time
gcloud functions logs read webhook --gen2 --region=europe-west1 --limit=50 --format="table(time,message)" --tail
```

## Database Queries

### Get All Webhooks for Transaction
```javascript
db['poster-hooks-data'].find({
  object_id: 16776
}).sort({ 'metadata.received_at': 1 })

// Shows lifecycle: added → changed → changed → etc.
```

### Get Only Saved Transactions (changed with successful API call)
```javascript
db['poster-hooks-data'].find({
  'metadata.saved_to_transactions': true
})
```

### Get Failed Webhooks
```javascript
db['poster-hooks-data'].find({
  'metadata.processing_error': { $ne: null }
})
```

### Get Webhooks by Action
```javascript
// Only added
db['poster-hooks-data'].find({
  action: 'added'
})

// Only changed
db['poster-hooks-data'].find({
  action: 'changed'
})
```

### Link RAW Webhook to Transaction
```javascript
// Get transaction from Poster API data
const transaction = db.transactions.findOne({
  transaction_id: '16776'  // Note: string from Poster API
});

// Find corresponding RAW webhook by object_id
const rawHook = db['poster-hooks-data'].findOne({
  object_id: parseInt(transaction.transaction_id),
  action: 'changed'
});

// See full webhook that triggered this transaction
console.log(rawHook);
```

### Replay Failed Webhooks
```javascript
// Find webhooks with changed action that didn't save to transactions
const failedChanged = db['poster-hooks-data'].find({
  action: 'changed',
  'metadata.saved_to_transactions': false,
  'metadata.processing_error': { $ne: null }
});

// Could be replayed manually or via script
```

## Advantages of This Approach

### ✅ Complete Audit Trail
- Every webhook event saved, regardless of outcome
- Full history of transaction lifecycle
- Can trace back any transaction to original webhook

### ✅ Clean Transactions Collection
- Only completed (closed) transactions
- No partial/draft transactions
- Easier queries and analytics

### ✅ Debugging & Replay
- Failed webhooks preserved with error details
- Can replay webhooks from RAW data
- Troubleshoot validation issues easily

### ✅ Analytics Capabilities
- Analyze transaction lifecycle (created → updated → closed)
- Time between created and closed
- How many updates before closing
- Failed transaction patterns

### ✅ Compliance & Legal
- Complete record of all events
- Cannot lose data (saved before validation)
- Audit trail for accounting

## Migration from Old System

### Old System (MongoDB Realm)
```
Poster → Realm Endpoint → poster-hooks-data (RAW)
                              ↓
                         Database Trigger
                              ↓
                         Realm Function
                              ↓
                    Poster API Call (get full data)
                              ↓
                         transactions
```

**Characteristics:**
- ✅ Saved all webhooks to poster-hooks-data
- ✅ Trigger filtered by action === 'closed'
- ✅ Made extra API call to Poster for full data
- ❌ 3-step process with delays
- ❌ Realm Triggers (deprecated technology)
- ❌ Separate function execution with potential failures

### New System (GCP Cloud Functions) ✅ CURRENT
```
Poster → Cloud Function → poster-hooks-data (RAW)
                              ↓
                         (same function)
                              ↓
                    Filter: action === 'changed'
                              ↓
                    Poster API Call (finance.getTransaction)
                              ↓
                    Store ONLY Poster API data
                              ↓
                         transactions
```

**Characteristics:**
- ✅ Saves all webhooks to poster-hooks-data (webhook body at root + metadata)
- ✅ Filters by action === 'changed' (official Poster action)
- ✅ **ALWAYS calls Poster API** for full transaction data
- ✅ Stores ONLY Poster API data (clean, no webhook metadata)
- ✅ Single function, atomic execution
- ✅ Modern, supported GCP technology
- ✅ Graceful handling of Poster API failures

### Key Improvements

**1. Atomic Execution**
- Single function handles everything (no separate triggers)
- RAW webhook saved first (no data loss)
- Transaction saved only if Poster API succeeds

**2. Clean Data Model**
- `poster-hooks-data`: Full webhook at root + metadata
- `transactions`: ONLY Poster API data (no mixing)

**3. Poster API Integration**
```typescript
// CURRENT IMPLEMENTATION
if (webhook.action === 'changed') {
  // Fetch full data from Poster API
  const posterApiData = await fetchPosterTransaction(transactionId, posterToken);

  // Store ONLY Poster API data
  if (posterApiData) {
    await db.collection('transactions').updateOne(
      { transaction_id: transactionId },
      { $set: posterApiData },  // Pure Poster data
      { upsert: true }
    );
  }
}
```

**4. Official Poster Actions**
- Uses official Poster webhook actions: `added`, `changed`, `removed`, `transformed`
- No custom mapping or simplified formats
- Fully compatible with Poster POS system

## Troubleshooting

### Issue: Webhooks not arriving
**Check:**
1. Poster webhook configuration (URL, events)
2. API key in URL is correct
3. Cloud Function is deployed and running
4. Check GCP logs for errors

### Issue: 401 Unauthorized
**Solutions:**
- Verify api-key query parameter is present
- Check secret value matches in GCP Secret Manager
- Ensure IAM permissions for Service Account

### Issue: RAW saved but not in transactions
**Check:**
1. Is action === 'changed'? (Only changed triggers Poster API and saves)
2. Check poster-hooks-data for metadata.processing_error
3. Check Cloud Functions logs for Poster API errors
4. Verify Poster API token is valid
5. Check if Poster API returned empty response

### Issue: Duplicate transactions
**Not possible:** Function uses `upsert` with transaction_id as key

### Issue: Missing transaction data
**Solutions:**
1. Verify Poster API token is correct (stored in `poster-token` secret)
2. Check Cloud Functions logs for API call failures
3. Test Poster API directly: `https://joinposter.com/api/finance.getTransaction?token=...&transaction_id=...`
4. Ensure transaction exists in Poster POS system

## Performance Considerations

- **Average execution time:** 1-2 seconds (includes Poster API call)
- **Memory usage:** 256M sufficient
- **Timeout:** 60s (plenty of buffer)
- **Cold start:** ~2 seconds first request
- **Warm start:** < 1 second
- **Poster API call:** ~200-500ms (when action === 'changed')
- **Dependencies:** axios bundled with function

## Security

- ✅ API key authentication
- ✅ Secrets stored in GCP Secret Manager
- ✅ HTTPS only
- ✅ IAM-based access control
- ✅ No sensitive data in logs
- ⚠️ API key in URL (visible in logs) - acceptable for webhooks

## Related Functions

- `getAllTransactions` - Retrieve all closed transactions
- `getTransaction` - Get single transaction by ID
- (Future) `replayWebhook` - Replay failed webhooks from RAW data

---

**Last Updated:** October 20, 2025
**Version:** 2.0.0
**Author:** Migration from MongoDB Realm to GCP Cloud Functions
**Changes in v2.0:**
- Added Poster API integration (finance.getTransaction)
- Updated to official Poster webhook actions
- Changed database structure (webhook body at root + metadata)
- Transactions collection now contains ONLY Poster API data
- Removed backwards compatibility with simplified format
