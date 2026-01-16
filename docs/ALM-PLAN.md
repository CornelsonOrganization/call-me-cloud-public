# Application Lifecycle Management Plan

## Overview

Multi-environment Railway setup to eliminate production breakages through proper staging and testing gates.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│      DEV        │     │     STAGING     │     │      PROD       │
│                 │     │                 │     │                 │
│  Railway svc:   │     │  Railway svc:   │     │  Railway svc:   │
│  call-me-dev    │     │  call-me-staging│     │  call-me-prod   │
│                 │     │                 │     │                 │
│  Branch: dev    │     │ Branch: staging │     │  Branch: main   │
│                 │     │                 │     │                 │
│  Auto-deploy on │     │  Auto-deploy on │     │  Auto-deploy on │
│  push to dev    │     │ push to staging │     │  push to main   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Branch Strategy

### Branches

| Branch | Purpose | Deploys To |
|--------|---------|------------|
| `dev` | Active development, quick iteration | Dev environment |
| `staging` | Pre-production testing | Staging environment |
| `main` | Production-ready code | Production environment |

### Code Flow

```
feature-branch
      │
      ├──► push to `dev` branch ──► DEV env (quick iteration/testing)
      │
      ▼
Create PR: feature-branch → staging
      │
      ├── CI must pass (tests, lint, build)
      ├── Requires PR approval
      ▼
Merge → `staging` branch ──► STAGING env (auto-deploy)
      │
      ├── Manual testing in staging
      ├── Verify functionality works
      ▼
Create PR: staging → main
      │
      ├── CI must pass
      ├── Requires PR approval
      ▼
Merge → `main` branch ──► PROD env (auto-deploy)
```

## Railway Setup

### Step 1: Create Railway Services

Create 3 separate services in Railway, all in the same project:

```bash
# In Railway dashboard or CLI:
railway service create call-me-dev
railway service create call-me-staging
railway service create call-me-prod
```

### Step 2: Configure GitHub Integration

For each service, configure automatic deployments from the corresponding branch:

| Service | GitHub Repo | Branch | Auto-Deploy |
|---------|-------------|--------|-------------|
| `call-me-dev` | `riverscornelson/call-me-cloud` | `dev` | Yes |
| `call-me-staging` | `riverscornelson/call-me-cloud` | `staging` | Yes |
| `call-me-prod` | `riverscornelson/call-me-cloud` | `main` | Yes |

**In Railway Dashboard:**
1. Go to Service → Settings → Source
2. Connect GitHub repo
3. Set "Branch" to the appropriate branch
4. Enable "Automatic Deployments"

### Step 3: Environment Variables

Set these variables for each Railway service:

#### All Environments (same values)

```bash
CALLME_PHONE_ACCOUNT_SID=<twilio-account-sid>
CALLME_PHONE_AUTH_TOKEN=<twilio-auth-token>
CALLME_PHONE_NUMBER=<twilio-phone-number>
CALLME_USER_PHONE_NUMBER=<your-phone-number>
CALLME_OPENAI_API_KEY=<openai-api-key>
CALLME_API_KEY=<your-api-key>
CALLME_TTS_MODEL=gpt-4o-mini-tts
CALLME_TTS_VOICE=coral
```

#### Per-Environment Variables

**Dev:**
```bash
NODE_ENV=development
CALLME_PUBLIC_URL=<railway-auto-generated-dev-url>
```

**Staging:**
```bash
NODE_ENV=staging
CALLME_PUBLIC_URL=<railway-auto-generated-staging-url>
```

**Prod:**
```bash
NODE_ENV=production
CALLME_PUBLIC_URL=<railway-auto-generated-prod-url>
```

### Step 4: Twilio Webhook Configuration

Add all three environment URLs to Twilio webhook configuration:

1. Go to Twilio Console → Phone Numbers → Your Number
2. Under "Voice & Fax", set webhook URLs or use TwiML Bins with routing logic
3. For simplicity, use the production URL and ensure proper routing

Alternatively, create separate Twilio phone numbers per environment for complete isolation.

## GitHub Configuration

### Step 1: Create Branches

```bash
# Create staging branch from main
git checkout main
git pull origin main
git checkout -b staging
git push -u origin staging

# Create dev branch from staging
git checkout -b dev
git push -u origin dev
```

### Step 2: Branch Protection Rules

#### For `main` branch:

```bash
gh api repos/riverscornelson/call-me-cloud/branches/main/protection -X PUT \
  -H "Accept: application/vnd.github+json" \
  -f required_status_checks='{"strict":true,"contexts":["build"]}' \
  -f enforce_admins=false \
  -f required_pull_request_reviews='{"required_approving_review_count":1}' \
  -f restrictions=null
```

Settings:
- Require PR before merging
- Require 1 approval
- Require status checks to pass (CI)
- Require branch to be up to date

#### For `staging` branch:

```bash
gh api repos/riverscornelson/call-me-cloud/branches/staging/protection -X PUT \
  -H "Accept: application/vnd.github+json" \
  -f required_status_checks='{"strict":true,"contexts":["build"]}' \
  -f enforce_admins=false \
  -f required_pull_request_reviews='{"required_approving_review_count":1}' \
  -f restrictions=null
```

Settings:
- Require PR before merging
- Require 1 approval
- Require status checks to pass (CI)

#### For `dev` branch:

No protection - allows direct pushes for rapid iteration.

### Step 3: CI Workflow

Create the file `.github/workflows/ci.yml` with the following content:

```yaml
name: CI

on:
  push:
    branches: [main, staging, dev]
  pull_request:
    branches: [main, staging]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Type check
        run: npm run typecheck

      - name: Test
        run: npm test
```

**Quick Setup Commands:**
```bash
# Create the file and commit
mkdir -p .github/workflows
cat > .github/workflows/ci.yml << 'EOF'
name: CI

on:
  push:
    branches: [main, staging, dev]
  pull_request:
    branches: [main, staging]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Type check
        run: npm run typecheck

      - name: Test
        run: npm test
EOF

git add .github/workflows/ci.yml
git commit -m "feat: add CI workflow for ALM"
git push origin dev
```

## Daily Workflow

### Starting New Work

```bash
# Start from staging
git checkout staging
git pull origin staging

# Create feature branch
git checkout -b feature/my-feature
```

### Quick Testing in Dev

```bash
# Push to dev for immediate deployment
git checkout dev
git merge feature/my-feature
git push origin dev
# → Automatically deploys to dev environment
```

### Ready for Staging

```bash
# Create PR to staging
gh pr create --base staging --head feature/my-feature \
  --title "Add my feature" \
  --body "Description of changes"

# After approval and merge → auto-deploys to staging
```

### Promoting to Production

```bash
# After testing in staging, create PR to main
gh pr create --base main --head staging \
  --title "Release: my feature" \
  --body "Tested in staging, ready for production"

# After approval and merge → auto-deploys to production
```

## Rollback Procedures

### Quick Rollback (Revert Commit)

```bash
# On main branch
git revert <commit-sha>
git push origin main
# → Auto-deploys reverted code to prod
```

### Full Rollback (Previous Version)

```bash
# In Railway dashboard:
# 1. Go to service → Deployments
# 2. Find last known good deployment
# 3. Click "Redeploy"
```

## Checklist

### Initial Setup

- [ ] Create `call-me-dev` service in Railway
- [ ] Create `call-me-staging` service in Railway
- [ ] Rename existing service to `call-me-prod` (or create new)
- [ ] Configure GitHub integration for each service
- [ ] Set environment variables for each service
- [x] Create `staging` branch in GitHub ✅ DONE
- [x] Create `dev` branch in GitHub ✅ DONE
- [ ] Add branch protection rules for `main`
- [ ] Add branch protection rules for `staging`
- [ ] Create/update CI workflow (copy from Step 3 above)
- [ ] Update Twilio webhooks if needed

### Verification

- [ ] Push to `dev` → deploys to dev environment
- [ ] PR to `staging` → requires approval, deploys on merge
- [ ] PR to `main` → requires approval, deploys on merge
- [ ] CI runs on all PRs
- [ ] Branch protection prevents direct pushes to main/staging

## Environment URLs

After setup, document your URLs here:

| Environment | Railway URL | Custom Domain (optional) |
|-------------|-------------|--------------------------|
| Dev | `https://call-me-dev-xxx.up.railway.app` | - |
| Staging | `https://call-me-staging-xxx.up.railway.app` | - |
| Prod | `https://call-me-prod-xxx.up.railway.app` | `callme.yourdomain.com` |
