# Project TODO List

## ✅ Completed Tasks

- [x] Setup GCP infrastructure with Terraform
- [x] Configure Secret Manager for credentials
- [x] Create reusable cloud-function Terraform module
- [x] Migrate `getAllTransactions` function
- [x] Add API key authentication
- [x] Setup TypeScript + tsup bundler
- [x] Add Jest unit tests
- [x] Deploy and verify first function
- [x] Optimize memory usage (256M)
- [x] Add project structure documentation
- [x] Clean up unused files and folders
- [x] Migrate `syncTransactions` function (bulk sync from Poster API)

## 🔄 In Progress

- [ ] Document specifications for remaining functions

## ⏳ TODO

### High Priority - Function Migration
- [ ] Migrate `getTransaction` function (see docs/functions/getTransaction.md)
- [ ] Migrate `createTransaction` function
- [ ] Migrate `updateTransaction` function
- [x] Migrate `webhook` function (Poster webhook handler)

### Medium Priority - Function Migration
- [x] Migrate `syncTransactions` function (see docs/functions/syncTransactions.md)
  - [x] Create function implementation in `functions/nodejs/api/syncTransactions/index.ts`
  - [x] Implement pagination loop (100 records per page)
  - [x] Integrate Poster API `dash.getTransactions` endpoint
  - [x] Add MongoDB `insertMany` with `ordered: false` for duplicate handling
  - [x] Add auth token validation
  - [x] Create unit tests in `index.test.ts` (10 tests, all passing)
  - [x] Test locally with Functions Framework
  - [x] Add to `tsup.config.ts` entry points
  - [x] Add Terraform module to `main.tf` (512MB memory, 540s timeout)
  - [x] Deploy to GCP (https://synctransactions-5txnprikja-ew.a.run.app)
  - [x] Test production endpoint with small date range
  - [x] Update TODO.md and commit

### Medium Priority - Testing & Quality
- [ ] Add e2e integration tests
- [ ] Add API documentation (OpenAPI/Swagger)
- [ ] Performance testing and optimization
- [ ] Add error tracking (Sentry or Cloud Error Reporting)

### Low Priority - DevOps
- [ ] Setup CI/CD pipeline (GitHub Actions)
- [ ] Add monitoring dashboard (Cloud Monitoring)
- [ ] Setup alerts for errors and latency
- [ ] Add staging environment
- [ ] Document rollback procedures

### Story 001: Add Ingredients to Transactions (Firestore)
> Збагатити транзакції даними про списання інгредієнтів для аналізу собівартості

**Phase 1: Catalog with Lazy Cache** ✅
- [x] Create `getCatalog()` function with 24h TTL lazy cache
- [x] Implement Firestore read/write for `catalog/metadata`
- [x] Implement `fetchCatalogFromPoster()` (menu.getProducts + menu.getIngredients)
- [x] Filter ignored ingredient categories `[14, 17, 4, 6, 7, 8, 15, 18]`
- [x] Apply type mapping (product type → write-off type)
- [x] Write unit tests for catalog functions (21 tests passing)

**Phase 2: Webhook Modification** ✅
- [x] Update `webhook/index.ts` to fetch write-offs on new transaction
- [x] Add `fetchTransactionWriteOffs(transactionId)` using `dash.getTransactionWriteoffs`
- [x] Add `enrichWriteOffsWithCatalog(writeOffs, catalog)` function
- [x] Save transaction with `write_offs` array to Firestore
- [x] Update webhook tests (20 tests passing)
- [x] Deploy webhook to GCP

**Phase 3: Migration of Historical Data** ✅
- [x] Create script `scripts/migrate-write-offs.ts`
- [x] Use batch API `transactions.getTransactionsWriteOffs` for efficiency
- [x] Implement month-by-month processing with progress logging
- [x] Run migration for historical transactions (58,457 transactions, 331,372 write-offs)
- [x] Verify migration results (99.6% coverage - 244 transactions without write-offs)

**Phase 4: Analytics API**
- [ ] Add `write_offs` field to `getAllTransactions` response
- [ ] Update API documentation

### Future Enhancements
- [ ] Add rate limiting
- [ ] Implement caching strategy
- [ ] Add request/response logging
- [ ] Consider migrating to Cloud Run for more control
- [ ] Add API versioning strategy

## 📋 Notes

**For Claude AI:**
- Mark tasks as completed with [x] when done
- Add new tasks as they arise during development
- Each completed task should end with a git commit
- Reference function specs in docs/functions/ folder
- Always test locally before deploying

**Last Updated:** Oct 21, 2025
