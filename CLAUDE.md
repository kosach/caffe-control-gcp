# Claude AI Assistant - Project Context

## Project Overview

**Caffe Control GCP** - міграція Express.js serverless API на Google Cloud Functions з TypeScript, Terraform IaC, та MongoDB Atlas.

## 📚 Documentation Location

**ALL project documentation is in `docs/` folder:**

- `docs/TODO.md` - Task list (update after each completion!)
- `docs/deployment.md` - Deployment procedures
- `docs/infrastructure.md` - Infrastructure details
- `docs/migration-guide.md` - Migration guidelines
- `docs/functions/*.md` - Function specifications

**⚠️ IMPORTANT:** 
- Always check `docs/TODO.md` for current tasks
- Mark tasks as [x] when completed
- Add new tasks to TODO.md as they arise
- Reference function specs from `docs/functions/`

## Project Status

See `docs/TODO.md` for complete task list.

**Quick Status:**
- ✅ Infrastructure setup complete
- ✅ First function (getAllTransactions) deployed
- 🔄 5 more functions to migrate

## Tech Stack

- **Runtime**: Node.js 20, TypeScript
- **Cloud**: Google Cloud Platform (europe-west1)
- **IaC**: Terraform
- **Database**: MongoDB Atlas  
- **Bundler**: tsup (esbuild-based)
- **Testing**: Jest
- **Auth**: API key via query parameter

## Available CLI Tools

You have access to these command-line utilities:
```bash
# File/Directory Management
ls          # List directory contents
cd          # Change directory
pwd         # Print working directory
mkdir       # Create directory
rm          # Remove files/directories
cp          # Copy files
mv          # Move/rename files
cat         # Display file contents
find        # Search for files

# Development Tools
npm         # Node package manager
node        # Run JavaScript
npx         # Execute npm packages
tsc         # TypeScript compiler
jest        # Test runner

# Infrastructure
terraform   # Infrastructure as Code
gcloud      # Google Cloud CLI

# Version Control  
git         # Git version control

# Network/Testing
curl        # Make HTTP requests
wget        # Download files

# Text Processing
grep        # Search text
sed         # Stream editor
awk         # Text processing

# Other
tree        # Directory tree (if installed)
echo        # Print text
```

## 🔄 Standard Workflow for New Function

### 1. Preparation
```bash
# Check TODO
cat docs/TODO.md

# Review function spec
cat docs/functions/{functionName}.md

# Navigate to workspace
cd functions/nodejs
```

### 2. Implementation
```bash
# Copy from original repo if needed
# Create function file
mkdir -p api/{functionName}
# Implement in api/{functionName}/index.ts
```

### 3. Testing - Unit Tests
```bash
# Create test file
# Write tests in api/{functionName}/index.test.ts

# Run tests
npm test

# Run specific test
npm test api/{functionName}/index.test.ts
```

### 4. Testing - Local Manual Testing
```bash
# Bundle the function
npm run bundle

# Start local server
npx @google-cloud/functions-framework \
  --target={functionName} \
  --source=dist-bundle/{functionName}.js \
  --signature-type=http

# In another terminal, test with curl
curl "http://localhost:8080?auth-token=caffe-secure-2025-prod-key-x7k9m&param=value"

# Test various scenarios:
# - Without auth token (expect 401)
# - With invalid parameters (expect 400/404)
# - With valid parameters (expect 200)
# - Edge cases

# Stop server with Ctrl+C
```

### 5. Deployment
```bash
# Add to tsup.config.ts entry if not already
# Add module to terraform/main.tf

# Navigate to terraform
cd ../../terraform

# Plan changes
terraform plan

# Deploy
terraform apply

# Get function URL
terraform output
```

### 6. Production Testing
```bash
# Test production endpoint
curl "https://{function-url}?auth-token=...&param=value"

# Test all scenarios again in production
```

### 7. Documentation & Commit
```bash
# Update TODO.md
# Mark task as [x] completed
# Add any new tasks discovered

# Check status
git status

# Add all changes
git add -A

# Commit with descriptive message
git commit -m "Migrate {functionName} function

- Implement function with auth validation
- Add unit tests with X% coverage  
- Test locally and in production
- Update TODO.md"

# Verify
git log --oneline -3
```

## ⚠️ Critical Rules

### Before Deployment
1. ✅ Unit tests must pass (`npm test`)
2. ✅ Local testing with curl successful
3. ✅ Function added to `tsup.config.ts`
4. ✅ Bundle created (`npm run bundle`)
5. ✅ Terraform module added to `main.tf`

### After Deployment
1. ✅ Production endpoint tested
2. ✅ All scenarios verified
3. ✅ docs/TODO.md updated
4. ✅ Changes committed to git

### Always Remember
- **NO localStorage/sessionStorage** in artifacts (not supported)
- **Always add `limit` parameter** for queries returning multiple documents
- **Default memory: 256M** (increase only if needed)
- **Auth token required** on all functions
- **Follow existing patterns** for consistency

## Environment Variables

Located in `.env` (gitignored):
```bash
MONGODB_URI=mongodb+srv://...
API_AUTH_KEY=caffe-secure-2025-prod-key-x7k9m
POSTER_TOKEN=...
POSTER_HOOK_API_KEY=...
GCP_PROJECT_ID=caffe-control-prod
```

## Common Issues & Solutions

See `docs/migration-guide.md` for detailed troubleshooting.

**Quick fixes:**
- Missing package.json in bundle → Check tsup.config.ts onSuccess hook
- Timeout → Add limit parameter, check MongoDB query
- 401 Unauthorized → Verify auth-token parameter
- Build errors → Run `npm install` and `npm run build`

## GCP Resources

- **Project**: caffe-control-prod  
- **Region**: europe-west1
- **Service Account**: caffe-functions@caffe-control-prod.iam.gserviceaccount.com

## Quick Links

- TODO: `docs/TODO.md`
- Functions Specs: `docs/functions/`
- Structure: `PROJECT_STRUCTURE.md`

## Next Task

Check `docs/TODO.md` and start with the highest priority uncompleted task!
