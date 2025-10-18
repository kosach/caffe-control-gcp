# Caffe Control GCP - Project Structure

## Directory Structure
```
caffe-control-gcp/
├── .env                          # Local environment variables (gitignored)
├── .env.example                  # Environment template
├── .gitignore                    # Git ignore rules
├── README.md                     # Project overview
│
├── docs/                         # Documentation
│   ├── deployment.md
│   ├── infrastructure.md
│   └── migration-guide.md
│
├── functions/                    # Cloud Functions
│   └── nodejs/                   # Node.js functions
│       ├── .gitignore           # Build outputs ignored
│       ├── package.json         # Dependencies
│       ├── tsconfig.json        # TypeScript config
│       ├── tsup.config.ts       # Bundler config
│       ├── jest.config.js       # Test config
│       │
│       ├── api/                 # API functions
│       │   └── getAllTransactions/
│       │       ├── index.ts
│       │       └── index.test.ts
│       │
│       └── utils/               # Shared utilities
│           └── mongodb.ts       # DB connection & secrets
│
└── terraform/                    # Infrastructure as Code
    ├── main.tf                  # Main infrastructure
    ├── variables.tf             # Variable definitions
    ├── outputs.tf               # Output definitions
    ├── terraform.tfvars         # Values (gitignored)
    │
    └── modules/
        └── cloud-function/      # Reusable function module
            └── main.tf
```

## Build Artifacts (Gitignored)

- functions/nodejs/node_modules/
- functions/nodejs/dist/
- functions/nodejs/dist-bundle/
- terraform/.terraform/
- terraform/terraform.tfstate
- terraform/modules/cloud-function/.tmp/

## Key Technologies

- **TypeScript + Node.js 20** for functions
- **tsup** for bundling
- **Jest** for testing
- **Terraform** for infrastructure
- **MongoDB Atlas** for database
- **GCP Secret Manager** for secrets

## Deployment Flow

1. Write function in functions/nodejs/api/
2. Test with: npm test
3. Build with: npm run bundle
4. Deploy with: terraform apply
5. Verify with API key authentication

