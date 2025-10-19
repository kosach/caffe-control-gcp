# Caffe Control - GCP

Migration of Caffe Control project from MongoDB Atlas App Services to Google Cloud Platform.

## Quick Start
```bash
# Clone and install
npm install

# Initialize Terraform
cd terraform && terraform init && cd ..

# Apply infrastructure
cd terraform && terraform apply && cd ..

# Set secrets
./scripts/set-secrets.sh
```

## Run Script

The helper script `./run.sh` wraps the most common project tasks:

- `./run.sh tests` — run the Jest suite inside `functions/nodejs`.
- `./run.sh build` — create the production bundle via `npm run bundle`.
- `./run.sh local [name]` — start the local Functions Framework (defaults to the `webhook` function when no name is provided).
- `./run.sh diff [-f]` — print modified/new files; append `-f` to save the output to `diff.txt`.

Use `./run.sh --help` to see the latest command list and examples.

## Project Structure
```
├── terraform/          # Infrastructure as Code
├── functions/          # Cloud Functions
├── tests/             # Tests
├── scripts/           # Automation scripts
├── config/            # Configuration
└── docs/              # Documentation
```

## Documentation

- [Infrastructure](docs/infrastructure.md) - Current infrastructure overview
- [Migration Guide](docs/migration-guide.md) - Step-by-step migration process
- [Deployment](docs/deployment.md) - How to deploy functions

## Tech Stack

- **Cloud Platform**: Google Cloud Platform
- **IaC**: Terraform
- **Runtime**: Node.js 20
- **Database**: MongoDB Atlas
- **Functions**: Cloud Functions (2nd gen)
