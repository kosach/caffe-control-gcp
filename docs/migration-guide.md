# Migration Guide

Step-by-step guide for migrating from MongoDB Atlas App Services to GCP Cloud Functions.

## Migration Strategy

### Phase 1: Infrastructure ✅
- [x] Setup GCP project
- [x] Configure Terraform
- [x] Create base infrastructure
- [x] Setup Service Account
- [x] Create secrets placeholders

### Phase 2: Secrets Setup
- [x] Fill MongoDB URI
- [x] Fill Poster API tokens
- [x] Fill API authentication keys

### Phase 3: Functions Migration

**Priority order** (from safest to most complex):

1. **getAllTransactions** - Read-only, safe to test
2. **getSummeryByDay** - Read-only
3. **getSalaryByDate** - Read-only  
4. **getProductsAndIngradients** - External API call
5. **poster_hooks** - Write operation, webhook receiver
6. **saveTransactionById** - Trigger-based (most complex)

### Phase 4: Testing
- [ ] Unit tests for each function
- [ ] Integration tests
- [ ] Load testing

### Phase 5: Frontend Update
- [ ] Update API endpoints in frontend
- [ ] Deploy to GitHub Pages
- [ ] Test end-to-end

### Phase 6: Cutover
- [ ] Monitor both systems in parallel
- [ ] Switch traffic to GCP
- [ ] Disable Atlas functions

## Atlas vs GCP Comparison

| Feature | Atlas App Services | GCP Cloud Functions |
|---------|-------------------|---------------------|
| Auth | `context.values.get()` | Secret Manager |
| Database | Built-in MongoDB | MongoDB driver |
| Triggers | Native | Pub/Sub or HTTP webhooks |
| Deployment | Atlas CLI | gcloud CLI |
| Logs | Atlas UI | Cloud Logging |

## Key Differences

### Authentication
**Atlas:**
```javascript
const token = context.values.get("apiAuthKey");
```

**GCP:**
```javascript
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const client = new SecretManagerServiceClient();
const [version] = await client.accessSecretVersion({
  name: 'projects/PROJECT_ID/secrets/api-auth-key/versions/latest'
});
const token = version.payload.data.toString();
```

### MongoDB Connection
**Atlas:** Automatic via `context.services.get()`

**GCP:** Manual connection via MongoDB driver