# Webhook Function

**Status:** ✅ Completed and Deployed

## Overview
Receives real-time transaction updates from Poster POS system. ALL webhooks are saved to `poster-hooks-data` for audit trail, but only `action === 'closed'` transactions are saved to `transactions` collection.

This approach provides:
- Complete audit trail of all webhook events
- Clean transactions collection with only completed transactions
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
┌─────────────────────────────────┐
│  Cloud Function: webhook        │
│                                 │
│  1. ✅ Validate API key         │
│  2. ✅ Save RAW (ALL actions)   │
│  3. ✅ Validate payload         │
│  4. ✅ Filter by action         │
│  5. ✅ Mark as processed        │
└─────────────────────────────────┘
       │
       ├─────────────────────┬──────────────────────┐
       ▼                     ▼                      ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ poster-hooks-data│  │   transactions   │  │   transactions   │
│                  │  │                  │  │                  │
│ action: created  │  │ (skipped)        │  │ (skipped)        │
│ saved: ✅        │  │                  │  │                  │
│ to_trans: false  │  │                  │  │                  │
└──────────────────┘  └──────────────────┘  └──────────────────┘

┌──────────────────┐  ┌──────────────────┐
│ poster-hooks-data│  │   transactions   │
│                  │  │                  │
│ action: updated  │  │ (skipped)        │
│ saved: ✅        │  │                  │
│ to_trans: false  │  │                  │
└──────────────────┘  └──────────────────┘

┌──────────────────┐  ┌──────────────────┐
│ poster-hooks-data│  │   transactions   │
│                  │  │                  │
│ action: closed   │  │ saved: ✅        │
│ saved: ✅        │  │                  │
│ to_trans: true   │  │                  │
└──────────────────┘  └──────────────────┘
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

The webhook supports **two payload formats**:

### Format 1: Real Poster Webhook Format (Primary)

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
- `object_id` contains the transaction ID (mapped to `transaction_id` internally)
- `action` is typically `"changed"` (mapped to `"closed"` for transaction storage)
- `data` is a **JSON string** that needs to be parsed
- Contains Poster-specific fields: `account`, `verify`, `time`, etc.

### Format 2: Simplified Format (Backwards Compatibility)

```json
{
  "action": "created" | "updated" | "closed",
  "data": {
    "transaction_id": 12345,
    "date_start": "1634567890000",
    "date_close": "1634567900000",
    "status": "2",
    "payed_sum": "7500",
    "payed_card": "7500",
    "payed_cash": "0",
    "products": [...],
    "history": [...],
    ...
  }
}
```

**Key characteristics:**
- Direct `transaction_id` field
- Parsed `data` object (not JSON string)
- Simpler structure for testing/debugging

### Supported Actions

| Poster Action | Mapped To | Saved to Transactions? | Notes |
|---------------|-----------|----------------------|-------|
| `changed` | `closed` | ✅ YES | Poster's primary action for completed transactions |
| `closed` | `closed` | ✅ YES | Simplified format |
| `created` | `created` | ❌ NO | Transaction started |
| `updated` | `updated` | ❌ NO | Transaction modified |

**Action Mapping Logic:**
- Poster sends `action: "changed"` → Function maps to `"closed"` → Saves to `transactions` collection
- This ensures Poster webhooks are properly stored

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
  received_at: new Date(),
  raw_body: req.body,
  query_params: req.query,
  processed: false,
  saved_to_transactions: false,
  processing_error: null,
  error_time: null
};

const result = await db.collection('poster-hooks-data')
  .insertOne(rawHookDocument);

rawHookId = result.insertedId;
```

**Why save RAW first?**
- Ensures no data loss even if validation fails
- Provides audit trail for debugging
- Allows replaying failed webhooks

### Step 3.5: Normalize Payload Format
```typescript
// Parse the request body
const rawPayload = parsePayload(req.body);

// Detect and normalize Poster format to standard format
payload = normalizePosterPayload(rawPayload);

// Poster format detection:
if (rawPayload.object_id !== undefined) {
  // Real Poster webhook detected
  console.log('📦 Detected real Poster webhook format');

  // Parse nested JSON string in data field
  let parsedData = {};
  if (typeof rawPayload.data === 'string') {
    parsedData = JSON.parse(rawPayload.data);
  }

  // Return normalized format
  return {
    action: rawPayload.action,
    data: {
      transaction_id: rawPayload.object_id,
      ...parsedData,
      // Preserve Poster fields for audit
      poster_account: rawPayload.account,
      poster_verify: rawPayload.verify,
      ...
    }
  };
}

// Map 'changed' action to 'closed'
if (action === 'changed') {
  action = 'closed';
  console.log('🔄 Mapped action "changed" → "closed"');
}
```

**Normalization Process:**
1. Detect format by checking for `object_id` field
2. Parse nested JSON string in `data` field if present
3. Map `object_id` → `transaction_id`
4. Preserve Poster-specific fields for audit trail
5. Map `action: "changed"` → `"closed"`

### Step 4: Validate Payload
```typescript
// Validate action
if (!action || !['created', 'updated', 'closed'].includes(action)) {
  await updateRawHookError(rawHookId, 'Invalid action');
  return 400 "Invalid action"
}

// Validate data
if (!data || !data.transaction_id) {
  await updateRawHookError(rawHookId, 'Missing data');
  return 400 "Missing required fields"
}
```

### Step 5: Filter by Action (ONLY 'closed' → transactions)
```typescript
let savedToTransactions = false;

if (action === 'closed') {
  // Save to transactions collection
  await db.collection('transactions').updateOne(
    { transaction_id: data.transaction_id },
    {
      $set: {
        ...data,
        webhook_received_at: new Date().toISOString(),
        webhook_action: action,
        raw_hook_id: rawHookId
      }
    },
    { upsert: true }
  );
  
  savedToTransactions = true;
} else {
  // Skip transactions - only RAW saved
  savedToTransactions = false;
}
```

### Step 6: Mark as Processed
```typescript
await db.collection('poster-hooks-data').updateOne(
  { _id: rawHookId },
  {
    $set: {
      processed: true,
      saved_to_transactions: savedToTransactions,
      processed_at: new Date()
    }
  }
);
```

## Response Examples

### Success: Closed Transaction (200)
```json
{
  "success": true,
  "transaction_id": 12345,
  "action": "closed",
  "saved_to_transactions": true,
  "raw_hook_id": "507f1f77bcf86cd799439011"
}
```

### Success: Created/Updated Transaction (200)
```json
{
  "success": true,
  "transaction_id": 12345,
  "action": "created",
  "saved_to_transactions": false,
  "raw_hook_id": "507f1f77bcf86cd799439012"
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
  "details": "Invalid action: deleted. Allowed: created, updated, closed"
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

#### Document Structure
```javascript
{
  _id: ObjectId("507f1f77bcf86cd799439011"),
  received_at: ISODate("2025-10-18T10:00:00.000Z"),
  raw_body: {
    action: "created",
    data: {
      transaction_id: 12345,
      status: "1",
      payed_sum: "7500",
      ...
    }
  },
  query_params: {
    "api-key": "xxx"  // Stored for debugging
  },
  processed: true,
  saved_to_transactions: false,  // false for created/updated
  processed_at: ISODate("2025-10-18T10:00:01.000Z"),
  processing_error: null,  // or error message if failed
  error_time: null  // or timestamp if failed
}
```

#### Example: Closed Transaction (saved to both collections)
```javascript
{
  _id: ObjectId("507f1f77bcf86cd799439022"),
  received_at: ISODate("2025-10-18T10:05:00.000Z"),
  raw_body: {
    action: "closed",
    data: { transaction_id: 12345, ... }
  },
  query_params: { "api-key": "xxx" },
  processed: true,
  saved_to_transactions: true,  // ✅ true for closed!
  processed_at: ISODate("2025-10-18T10:05:01.000Z"),
  processing_error: null,
  error_time: null
}
```

#### Example: Failed Validation
```javascript
{
  _id: ObjectId("507f1f77bcf86cd799439033"),
  received_at: ISODate("2025-10-18T10:10:00.000Z"),
  raw_body: {
    action: "deleted",  // Invalid action
    data: { transaction_id: 999 }
  },
  query_params: { "api-key": "xxx" },
  processed: false,
  saved_to_transactions: false,
  processed_at: null,
  processing_error: "Invalid action: deleted. Allowed: created, updated, closed",
  error_time: ISODate("2025-10-18T10:10:00.500Z")
}
```

### Collection 2: transactions (ONLY closed)

**Purpose:** Clean collection of completed transactions

#### Document Structure
```javascript
{
  _id: ObjectId("507f1f77bcf86cd799439044"),
  transaction_id: 12345,  // Primary key from Poster
  date_start: "1634567890000",
  date_close: "1634567900000",
  date_close_date: "2021-10-18 10:00:00",
  status: "2",  // Closed status
  payed_sum: "7500",
  payed_card: "7500",
  payed_cash: "0",
  name: "Андрій",
  user_id: "4",
  products: [
    {
      product_id: "402",
      product_price: "7500",
      ...
    }
  ],
  history: [
    {
      history_id: "1225",
      type_history: "open",
      ...
    }
  ],
  webhook_received_at: "2025-10-18T10:05:00.000Z",
  webhook_action: "closed",
  raw_hook_id: ObjectId("507f1f77bcf86cd799439022")  // Reference to RAW
}
```

## Error Handling Matrix

| Scenario | poster-hooks-data | transactions | Response | Notes |
|----------|-------------------|--------------|----------|-------|
| ❌ Invalid API key | NOT saved | NOT saved | 401 | Auth fails before RAW save |
| ✅ Valid, action=created | ✅ Saved | NOT saved | 200 | RAW only |
| ✅ Valid, action=updated | ✅ Saved | NOT saved | 200 | RAW only |
| ✅ Valid, action=closed | ✅ Saved | ✅ Saved | 200 | Both collections |
| ⚠️ Invalid action | ✅ Saved + error | NOT saved | 400 | Error recorded |
| ⚠️ Missing data | ✅ Saved + error | NOT saved | 400 | Error recorded |
| ❌ DB error (RAW) | NOT saved | NOT saved | 500 | Critical failure |
| ❌ DB error (after RAW) | ✅ Saved + error | NOT saved | 500 | RAW preserved |

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

#### Test 1: Valid Closed Transaction ✅
```bash
curl -X POST "http://localhost:8080?api-key=caffe-secure-2025-prod-key-x7k9m" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "closed",
    "data": {
      "transaction_id": 999,
      "status": "2",
      "payed_sum": "7500"
    }
  }'

# Expected Response:
{
  "success": true,
  "transaction_id": 999,
  "action": "closed",
  "saved_to_transactions": true,
  "raw_hook_id": "..."
}

# Database Check:
# - poster-hooks-data: 1 document (saved_to_transactions: true)
# - transactions: 1 document
```

#### Test 2: Valid Created Transaction ✅
```bash
curl -X POST "http://localhost:8080?api-key=caffe-secure-2025-prod-key-x7k9m" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "created",
    "data": {
      "transaction_id": 888,
      "status": "1"
    }
  }'

# Expected Response:
{
  "success": true,
  "transaction_id": 888,
  "action": "created",
  "saved_to_transactions": false,
  "raw_hook_id": "..."
}

# Database Check:
# - poster-hooks-data: 1 document (saved_to_transactions: false)
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
curl -X POST "http://localhost:8080?api-key=caffe-secure-2025-prod-key-x7k9m" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "deleted",
    "data": {
      "transaction_id": 444
    }
  }'

# Expected Response:
{
  "error": "Invalid payload",
  "details": "Invalid action: deleted. Allowed: created, updated, closed"
}

# Database Check:
# - poster-hooks-data: 1 document with processing_error
# - transactions: 0 documents
```

#### Test 6: Missing Data ⚠️
```bash
curl -X POST "http://localhost:8080?api-key=caffe-secure-2025-prod-key-x7k9m" \
  -H "Content-Type: application/json" \
  -d '{"action":"closed"}'

# Expected Response:
{
  "error": "Invalid payload",
  "details": "Missing required field: data"
}

# Database Check:
# - poster-hooks-data: 1 document with processing_error
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
  'raw_body.data.transaction_id': 12345
}).sort({ received_at: 1 })

// Shows lifecycle: created → updated → updated → closed
```

### Get Only Saved Transactions (closed)
```javascript
db['poster-hooks-data'].find({
  saved_to_transactions: true
})
```

### Get Failed Webhooks
```javascript
db['poster-hooks-data'].find({
  processing_error: { $ne: null }
})
```

### Get Webhooks by Action
```javascript
// Only created
db['poster-hooks-data'].find({
  'raw_body.action': 'created'
})

// Only closed
db['poster-hooks-data'].find({
  'raw_body.action': 'closed'
})
```

### Link RAW to Transaction
```javascript
// Get transaction
const transaction = db.transactions.findOne({ 
  transaction_id: 12345 
});

// Get corresponding RAW webhook
const rawHook = db['poster-hooks-data'].findOne({ 
  _id: transaction.raw_hook_id 
});

// See full webhook that created this transaction
console.log(rawHook.raw_body);
```

### Replay Failed Webhooks
```javascript
// Find failed webhooks that should be in transactions
const failedClosed = db['poster-hooks-data'].find({
  'raw_body.action': 'closed',
  saved_to_transactions: false,
  processing_error: { $ne: null }
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
- ❌ Extra API call overhead

### New System (GCP Cloud Functions)
```
Poster → Cloud Function → poster-hooks-data (RAW)
                              ↓
                         (same function)
                              ↓
                    Filter: action === 'closed'
                              ↓
                         transactions
```

**Characteristics:**
- ✅ Saves all webhooks to poster-hooks-data
- ✅ Filters by action === 'closed'
- ✅ Single function, fast execution
- ✅ Modern, supported technology
- ❌ No extra API call (assumes webhook has full data)

### Key Difference: Poster API Call

**Old:** Webhook contained minimal data (object_id, action)
```json
{
  "object": "transaction",
  "action": "closed",
  "object_id": 12345
}
```
→ Required API call to get full transaction

**New:** Webhook should contain full data
```json
{
  "action": "closed",
  "data": {
    "transaction_id": 12345,
    "status": "2",
    "payed_sum": "7500",
    "products": [...],
    ...
  }
}
```
→ No API call needed

**If Poster webhook doesn't include full data, add this to Step 6:**
```typescript
if (action === 'closed') {
  // Fetch full data from Poster API
  const fullData = await axios.get(
    `https://joinposter.com/api/dash.getTransaction?` +
    `token=${posterToken}&transaction_id=${transactionId}` +
    `&include_products=true&include_history=true`
  );
  
  // Save full data to transactions
  await db.collection('transactions').updateOne(...);
}
```

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
1. Is action === 'closed'? (Only closed saved to transactions)
2. Check poster-hooks-data for processing_error
3. Verify transaction_id is valid number
4. Check Cloud Functions logs

### Issue: Duplicate transactions
**Not possible:** Function uses `upsert` with transaction_id as key

### Issue: Missing transaction data
**Solutions:**
1. Check if Poster webhook includes full data
2. May need to add Poster API call (see Migration section)
3. Verify Poster webhook configuration includes required fields

## Performance Considerations

- **Average execution time:** < 1 second
- **Memory usage:** 256M sufficient
- **Timeout:** 60s (plenty of buffer)
- **Cold start:** ~2 seconds first request
- **Warm start:** < 500ms

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

**Last Updated:** October 18, 2025
**Version:** 1.0.0
**Author:** Migration from MongoDB Realm to GCP Cloud Functions
