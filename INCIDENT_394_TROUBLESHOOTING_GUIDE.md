# Incident #394 - Troubleshooting & Remediation Guide

**Incident**: SEV-1 Frontend Deploy Failure on c859e94  
**Last Updated**: 2026-08-29  
**Status**: Active Investigation  

---

## Part 1: Information Gathering

### Step 1: Retrieve GitHub Actions Logs

**Objective**: Determine the exact failure point in the deploy workflow.

```bash
# Navigate to the failed run
# URL: https://github.com/PromptMintLabs/prompt-mint/actions/runs/33128846822

# Download logs using GitHub CLI
gh run view 33128846822 --log > run-33128846822.log
gh run view 33128846822 --log-failed > run-33128846822-failed.log

# OR manually:
# 1. Open GitHub Actions UI → Run #33128846822
# 2. Click "Deploy frontend" job
# 3. Scroll to find the failed step (likely "Build frontend" or artifact upload)
# 4. Look for error messages like:
#    - "npm ERR! ..."
#    - "error TS..."
#    - "ENOMEM" (out of memory)
#    - "ETIMEDOUT" (network timeout)
#    - "403 Forbidden" (permissions/secrets issue)
```

**Common Failure Patterns**:
```
❌ "error TS1110: Type expected" → TypeScript compilation failed
❌ "npm ERR! code ERESOLVE" → Dependency conflict
❌ "error ENOMEM" → Node.js process ran out of memory
❌ "error ETIMEDOUT" → npm registry or CDN timeout
❌ "error 403" → Missing or invalid npm token
❌ "vite v8.2.2 build" followed by silence → Vite hung or crashed
```

---

### Step 2: Check Vercel Deployment Status

**Objective**: Verify that Vercel received the deployment and understand why it failed.

```bash
# Install Vercel CLI if not present
npm install -g vercel

# Authenticate
vercel login

# List recent production deployments
vercel ls --prod

# Expected output shows recent deployments; look for:
# - Most recent: c859e94 (BUILDING, ERROR, or CANCELED)
# - Previous stable: efb845a or earlier (should be READY)

# Get detailed info on the failed deployment
vercel inspect <DEPLOYMENT_ID>

# Get build logs from Vercel
vercel logs <DEPLOYMENT_ID>
```

**What to look for**:
- Is c859e94 in READY, ERROR, BUILDING, or QUEUED state?
- When was the last successful READY deployment?
- Are there sufficient build resources (memory, time, etc.)?

---

### Step 3: Test Local Build Reproducibility

**Objective**: Determine if the build failure is CI-specific or reproducible locally.

```bash
# Ensure all dependencies are installed
yarn install

# Run the same build command as CI
npm run build
# OR
yarn build

# If it succeeds locally:
#   → Problem is CI-specific (environment, secrets, or caching issue)
#   → Check: Node.js version, yarn version, Vercel secrets

# If it fails locally:
#   → Problem is reproducible; can be debugged locally
#   → Check: TypeScript errors, ESLint violations, missing env vars
```

**If local build fails**:
```bash
# Step-by-step diagnosis
npm ci                    # Exact dependency install
npm run typecheck         # Check TypeScript errors
npm run lint              # Check ESLint errors
npm run build             # Full build with verbose output
```

---

### Step 4: Inspect Vercel Secrets & Build Configuration

**Objective**: Verify that environment variables are configured correctly.

```bash
# Check Vercel project settings
vercel project ls              # List projects
vercel project inspect         # Show current project config

# Review environment variables in Vercel dashboard:
# 1. Go to https://vercel.com/dashboard
# 2. Select project: prompt-mint (or name)
# 3. Settings → Environment Variables
# 4. Verify all VITE_* variables are set:
#    - VITE_PROMPT_HASH_CONTRACT_ID
#    - VITE_STELLAR_NETWORK
#    - VITE_SOROBAN_RPC_URL
#    - VITE_STELLAR_HORIZON_URL
#    - VITE_STELLAR_NETWORK_PASSPHRASE
#    - VITE_STELLAR_NATIVE_ASSET_CONTRACT_ID
#    - VITE_STELLAR_SIMULATION_ACCOUNT
#    - VITE_UNLOCK_PUBLIC_KEY
```

**Expected behavior**:
- All VITE_* variables should be present in the "Production" environment
- Values must match `.env.example` (example values)

---

### Step 5: Check Node.js & Toolchain Versions

**Objective**: Ensure build toolchain compatibility.

```bash
# Local environment
node --version              # Should be 18.x or newer
yarn --version              # Should match packageManager in package.json
npm --version               # Verify

# In GitHub Actions (check deploy.yml)
cat .github/workflows/deploy.yml | grep "node-version"
# Should show: node-version: '18.x' or similar

# If versions differ between local and CI:
#   → Update to match
#   → Rebuild locally to test
```

---

## Part 2: Common Root Causes & Fixes

### Root Cause A: Out of Memory During Build

**Symptoms**:
```
ENOMEM: Cannot allocate memory
```

**Fix**:
```bash
# Option 1: Increase Node.js heap size in deploy.yml
# Add to the "Build frontend" step:
env:
  NODE_OPTIONS: "--max-old-space-size=4096"

# Option 2: Optimize build output
# In vite.config.ts, reduce code splitting or enable minification more aggressively

# Option 3: Upgrade Vercel plan (if using Hobby)
# Hobby tier has lower memory limits; upgrade to Pro for more resources
```

---

### Root Cause B: Missing or Invalid Vercel Secrets

**Symptoms**:
```
TypeError: Cannot read property 'CONTRACT_ID' of undefined
ReferenceError: PUBLIC_STELLAR_NETWORK is not defined
```

**Fix**:
```bash
# 1. Copy .env.example to .env
cp .env.example .env

# 2. Fill in required VITE_* values (frontend) and other backend secrets
#    See: docs/environments.md

# 3. Add to Vercel via CLI:
vercel env pull
# (downloads production environment to local .env.production)

# 4. Manually set in Vercel dashboard if CLI doesn't work:
# https://vercel.com/dashboard → project → Settings → Environment Variables
# Add each VITE_* variable for "Production" environment

# 5. Redeploy to verify
vercel --prod
```

---

### Root Cause C: Dependency Conflict (npm ERESOLVE)

**Symptoms**:
```
npm ERR! code ERESOLVE
npm ERR! ERESOLVE unable to resolve dependency tree
```

**Fix**:
```bash
# Option 1: Update lockfile
rm yarn.lock
yarn install

# Option 2: Force resolution (if conflict is acceptable)
# In .npmrc or .yarnrc.yml:
legacy-peer-deps=true

# Option 3: Identify conflicting packages
npm list <package-name>

# Option 4: Update problematic package
yarn upgrade <package-name>@latest
```

---

### Root Cause D: TypeScript Compilation Errors

**Symptoms**:
```
error TS1110: Type expected
error TS2322: Type 'X' is not assignable to type 'Y'
```

**Fix**:
```bash
# 1. Run typecheck locally to reproduce
npm run typecheck

# 2. Fix reported errors in src/**/*.ts or src/**/*.tsx

# 3. Verify no circular imports or missing type definitions
npm run lint

# 4. Rebuild
npm run build
```

---

### Root Cause E: ESLint Violations (Pre-commit Hook Failure)

**Symptoms**:
```
error Unexpected token } 
error Expected semicolon
```

**Fix**:
```bash
# 1. Run linter
npm run lint

# 2. Auto-fix violations
npm run format

# 3. Manually fix remaining errors

# 4. Commit and push
git add .
git commit -m "fix: resolve linter violations"
git push origin main
```

---

### Root Cause F: Vite Build Hangs or Crashes

**Symptoms**:
```
vite v8.2.2 building...
(process hangs; CI times out after 10 minutes)
```

**Fix**:
```bash
# 1. Check vite.config.ts for problematic plugins
cat vite.config.ts | grep -A5 "plugins"

# 2. Temporarily disable plugins to isolate culprit
# vite.config.ts:
// plugins: [...]  // Comment out

# 3. Increase build timeout in deploy.yml
# Add to "Build frontend" step:
timeout-minutes: 30

# 4. Optimize source code
# - Remove unused imports
# - Split large files
# - Use code-splitting in vite.config.ts

# 5. Clear build cache
rm -rf dist node_modules/.vite
yarn install
npm run build
```

---

## Part 3: Remediation Paths

### Path A: Immediate Rollback (Preferred if Previous Deployment Available)

**When**: Previous stable deployment exists in Vercel history.

```bash
# 1. Identify previous READY deployment
vercel ls --prod | grep -E "READY|ERROR"

# 2. Get deployment ID (e.g., abc123xyz)
# 3. Instant rollback (atomic, no rebuild)
vercel rollback abc123xyz

# 4. Verify
curl https://promptmint.io/api/health
# Should return status: ok

# 5. Update incident ticket with:
#    - Rollback executed at HH:MM UTC
#    - Previous deployment ID
#    - Reason (pending investigation)
```

---

### Path B: Fix Root Cause & Redeploy

**When**: Root cause identified and fixable; or no previous deployment available.

```bash
# 1. Fix the issue (see Part 2 for specific fixes)

# 2. Test locally
npm ci && npm run build

# 3. Commit fix
git add .
git commit -m "fix: resolve deployment build failure (#394)"
git push origin main

# 4. Monitor GitHub Actions auto-deploy
# URL: https://github.com/PromptMintLabs/prompt-mint/actions

# 5. Verify deployment succeeded
#    - GitHub Actions shows "Deploy frontend" job: ✅
#    - Vercel shows new deployment in READY state
#    - Health checks pass: curl https://promptmint.io/api/health

# 6. Update incident ticket
```

---

### Path C: Revert Problematic Commit

**When**: Commit c859e94 is fundamentally incompatible with current build system.

```bash
# 1. Revert the problematic commit
git revert c859e94 -m 1

# 2. Push revert
git push origin main

# 3. GitHub Actions auto-deploys

# 4. Verify health
curl https://promptmint.io/api/health

# 5. Schedule follow-up investigation
#    - Why did c859e94 cause build failure?
#    - Was there a missing dependency or environment setup?
#    - Can it be re-applied with fixes?

# 6. Create follow-up issue for long-term fix
```

---

## Part 4: Post-Remediation Verification

### Step 1: Health Endpoint Checks

```bash
# Health check (backend indexer state)
curl -X GET https://promptmint.io/api/health

# Expected response:
# {
#   "status": "ok",
#   "timestamp": "2026-08-29T...",
#   "uptime": <seconds>,
#   "indexer": { "lastProcessedLedger": <number> }
# }

# Status check (full system)
curl -X GET https://promptmint.io/api/status

# Expected response shows all services "up":
# {
#   "status": "up",
#   "services": [
#     { "name": "Stellar RPC", "status": "up", "latencyMs": <ms> },
#     { "name": "Horizon", "status": "up", "latencyMs": <ms> },
#     { "name": "Unlock Service", "status": "up", "latencyMs": <ms> }
#   ]
# }
```

### Step 2: Smoke Testing

```bash
# Test 1: Load homepage
curl -I https://promptmint.io/ | grep "HTTP"
# Should see: HTTP/2 200 or HTTP/1.1 200

# Test 2: Verify assets are served
curl -I https://promptmint.io/index.html | grep "ETag\|Last-Modified"

# Test 3: API connectivity
curl https://promptmint.io/api/prompts/list -X GET

# Test 4: (Manual) Browser test
#   1. Navigate to https://promptmint.io
#   2. Connect Stellar wallet (Freighter)
#   3. Browse a prompt
#   4. Verify no console errors (F12)
#   5. Attempt purchase or view unlock (if applicable)
```

### Step 3: Monitoring & Alerting

```bash
# Check Vercel Analytics
# https://vercel.com/dashboard → prompt-mint → Analytics
# - Verify traffic returned to normal
# - Check for error rate spikes

# Datadog / Grafana (if configured)
# - CPU, memory, request latency
# - Error rates in serverless functions
# - Database query latency

# Slack/Discord channels
# - Verify incident notifications were sent
# - Post "All-Clear" message once verified
```

---

## Part 5: Post-Incident Actions

### Within 1 Hour:
- [ ] Root cause identified
- [ ] Health checks passed
- [ ] Incident ticket updated with findings

### Within 24 Hours:
- [ ] Blameless post-mortem drafted
- [ ] Preventive measures identified
- [ ] Follow-up work items created

### Within 48 Hours:
- [ ] Post-mortem completed and shared
- [ ] Action items assigned with deadlines
- [ ] Process improvements documented

---

## Checklist Summary

**Information Gathering:**
- [ ] GitHub Actions logs retrieved
- [ ] Vercel deployment status checked
- [ ] Local build reproducibility tested
- [ ] Vercel secrets verified
- [ ] Toolchain versions checked

**Root Cause Identified:**
- [ ] Specific failure point pinpointed
- [ ] Estimated time to fix: ___

**Remediation Executed:**
- [ ] Fix applied / rollback executed
- [ ] Push to main completed
- [ ] Deployment monitored

**Verification Complete:**
- [ ] /api/health returns status: ok
- [ ] /api/status shows all services up
- [ ] Smoke tests passed
- [ ] No console errors observed

**Incident Closed:**
- [ ] Ticket updated with timeline
- [ ] Post-mortem initiated
- [ ] Team notified (Slack/Discord)

---

## Emergency Contacts

If unable to resolve within 30 minutes, escalate:

- **On-Call Engineer**: (PagerDuty)
- **Lead Architect**: (Slack #incidents)
- **DevOps Lead**: (Slack #ops)
- **Product Manager**: (For external communication)

---

**Next Steps:**
1. ⏱️ Retrieve logs (Step 1 of Part 1)
2. 🔍 Investigate Vercel status (Step 2 of Part 1)
3. 🧪 Test local reproducibility (Step 3 of Part 1)
4. 🛠️ Apply appropriate fix (Part 2 + Part 3)
5. ✅ Verify & document (Part 4 + Part 5)

---

**Document Version**: 1.0  
**Created**: 2026-08-29  
**Owner**: On-Call Engineer
