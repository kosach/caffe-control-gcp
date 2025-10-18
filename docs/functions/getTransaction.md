# getTransaction Function

**Status:** ⏳ TODO

## Overview
Retrieves a single transaction by transaction_id from MongoDB.

## Original Implementation
```javascript
// From caffe-control repo: functions/getTransaction/index.js
exports.getTransaction = async (req, res) => {
  const { transactionId } = req.query;
  // ... implementation
};
```

## Specification

### Endpoint
- **Method:** GET
- **Auth:** Required via query parameter

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| auth-token | string | Yes | API authentication key |
| transactionId | number | Yes | Transaction ID to retrieve |

### Response

#### Success (200)
```json
{
  "_id": "64b0026104bc7b3e165e70e3",
  "transaction_id": 212,
  "date_close": "1662224161862",
  "status": "2",
  "payed_sum": "7500",
  "products": [...],
  "history": [...]
}
```

#### Not Found (404)
```json
{
  "error": "Transaction not found"
}
```

#### Bad Request (400)
```json
{
  "error": "Missing transactionId parameter"
}
```

## Implementation Checklist

- [ ] Copy function from original repo
- [ ] Convert to Cloud Functions signature: `(req: Request, res: Response)`
- [ ] Add auth-token validation
- [ ] Validate transactionId parameter (required, must be number)
- [ ] Query MongoDB: `collection.findOne({ transaction_id: parseInt(transactionId) })`
- [ ] Return 404 if transaction not found
- [ ] Add error handling
- [ ] Create unit tests in `index.test.ts`
- [ ] Test with mocked MongoDB
- [ ] Add to `tsup.config.ts` entry points
- [ ] Run `npm run bundle`
- [ ] Test locally with curl
- [ ] Add to `terraform/main.tf`
- [ ] Deploy with `terraform apply`
- [ ] Test production endpoint
- [ ] Update TODO.md
- [ ] Commit changes

## Testing Plan

### Unit Tests (Jest)
```typescript
describe('getTransaction', () => {
  it('should return 400 if transactionId missing');
  it('should return 404 if transaction not found');
  it('should return transaction if found');
  it('should return 401 if auth token invalid');
});
```

### Local Testing
```bash
# Valid request
curl "http://localhost:8080?transactionId=212&auth-token=..."

# Missing transactionId
curl "http://localhost:8080?auth-token=..."

# Invalid auth
curl "http://localhost:8080?transactionId=212"
```

## Notes
- transaction_id in MongoDB is stored as number
- Use parseInt() when converting from query param
- Consider adding caching for frequently accessed transactions
