# Incident #394 - SEV-1 Automated Rollback Analysis

**Date**: August 28-29, 2026  
**Severity**: SEV-1 (Critical - Deployment Failure)  
**Status**: Incident Response In Progress  
**Failed SHA**: c859e94aacb7d1dbeba1ab87e0c5c69a6b9cd57b  
**Ref**: main  
**Actor**: barry01  
**Workflow**: Deploy - Frontend to Vercel and Artifacts  
**Conclusion**: failure  
**Run**: https://github.com/PromptMintLabs/prompt-mint/actions/runs/33128846822

---

## Executive Summary

The frontend deployment workflow failed on commit c859e94 (Merge PR #391: "Add prompt expiry notifications and lifetime extension"). The automated rollback system was triggered but found **no distinct READY production deployment** with a different SHA to roll back to, resulting in an `incident_only` outcome. The incident ticket (#394) was automatically created for on-call escalation.

---

## 1. Incident Timeline (UTC)

| Time | Event | Details |
|------|-------|---------|
| 2026-08-28 01:10:19 | PR #391 Merged | Commit c859e94: Add prompt expiry notifications (contract changes) |
| 2026-08-28 01:15:00 | Deploy workflow triggered | CI pipeline: `npm run build` and Vercel deploy initiated |
| 2026-08-28 01:18:XX | Frontend build failure | (Exact time pending GitHub Actions log inspection) |
| 2026-08-28 01:20:XX | Auto-rollback triggered | `.github/workflows/auto-rollback.yml` detected failure |
| 2026-08-28 01:22:XX | Rollback decision: incident_only | No previous READY deployment found; GitHub issue #394 created |
| 2026-08-28 XX:XX:XX | **CURRENT** | Manual investigation and remediation in progress |

---

## 2. Root Cause Analysis (Initial Investigation)

### 2.1 Commit c859e94 Changes

The failing commit contains **contract-only changes** to `contracts/prompt-hash/`:
- `contract.rs`: Added expiry notification logic and lifetime extension functions
- `events.rs`: Added `PromptExpiringSoon` event type
- `storage.rs`: Added expiry warning persistence helpers
- `test.rs`: Added two new unit tests for expiry functionality
- `types.rs`: Added `PromptExpiryWarning` data key type

**Key Observation**: No frontend code was modified. The failure is NOT due to contract logic.

### 2.2 Why Did Frontend Deploy Fail?

The deploy workflow performs these steps:
1. Checkout code
2. Install dependencies (`npm ci`)
3. Build frontend (`npm run build`)
4. Generate frontend checksums
5. Upload artifacts
6. Deploy to Vercel

**Hypothesis**: The failure likely occurred at step 3 (`npm run build`) or later. Possible causes:
- Dependency resolution failure
- Type checking failure (TypeScript compilation)
- Linting error  
- Build toolchain issue (Vite build failure)
- Artifact upload timeout
- Vercel API connectivity issue

**Why not contract-related**: The contract is separate; it builds via `cargo` in a parallel `contract-build` job.

### 2.3 Why No Rollback Target?

The automatic rollback system checked Vercel's production deployments and found no **READY** deployment with a **different SHA** from the failed one. This suggests:
1. No previous stable production version exists in Vercel's history, OR
2. Vercel's deployment history was pruned / unavailable, OR
3. All recent deployments have the same or similar SHA

---

## 3. Immediate Verification Checklist

**Required Actions** (per `docs/operations/auto-rollback.md`):

- [ ] Verify `/api/health` endpoint health status
- [ ] Verify `/api/status` endpoint (RPC, Horizon, unlock service availability)
- [ ] Check Vercel production environment status
- [ ] Confirm MongoDB / Redis connectivity
- [ ] Review GitHub Actions logs for exact failure reason
- [ ] Inspect Vercel build logs for build errors
- [ ] Verify Slack/Discord notifications were sent (if webhooks configured)

---

## 4. Health Check Status

### 4.1 Expected Health Endpoints

**`/api/health`** (Backend health)
```json
{
  "status": "ok",
  "timestamp": "2026-08-29T...",
  "uptime": <seconds>,
  "indexer": {
    "lastProcessedLedger": <number>
  }
}
```

**`/api/status`** (Comprehensive system status)
```json
{
  "status": "up|degraded|down",
  "timestamp": "2026-08-29T...",
  "uptime": <seconds>,
  "services": [
    { "name": "Stellar RPC", "status": "up|degraded|down", "latencyMs": <number> },
    { "name": "Horizon", "status": "up|degraded|down", "latencyMs": <number> },
    { "name": "Unlock Service", "status": "up|degraded|down", "latencyMs": <number> }
  ],
  "circuitBreakers": [...]
}
```

---

## 5. Recommended Next Steps

### Phase 1: Diagnosis (In Progress)
1. **Retrieve GitHub Actions logs** from run #33128846822
   - Identify exact build failure message
   - Check for dependency resolution, type errors, or network issues

2. **Review Vercel build logs**
   - Confirm if Vercel received the deployment
   - Check for build timeout or resource exhaustion

3. **Validate recent deployments**
   - Query Vercel API: `GET /v6/deployments?projectId=...&target=production&limit=50`
   - Identify available rollback targets

### Phase 2: Remediation

**Option A: Manual Rollback (if rollback target available)**
```bash
vercel rollback <PREVIOUS_STABLE_DEPLOYMENT_ID>
```

**Option B: Redeploy Current Main (if no rollback available)**
- Investigate and fix the build failure in c859e94 or parent commit
- Create a new commit with the fix
- Push to main; GitHub Actions will auto-deploy

**Option C: Revert Commit (if needed)**
- If c859e94 has a critical bug affecting build reproducibility:
  ```bash
  git revert c859e94 -m 1
  git push origin main
  ```

### Phase 3: Validation
- Verify `/api/health` returns `status: ok`
- Verify `/api/status` shows all services `up` or acceptable `degraded` state
- Smoke test: Connect wallet → Create/purchase prompt flow
- Monitor logs for errors over next 15 minutes

---

## 6. Root Cause Deep Dive (Pending Investigation)

### Q: Why Did `npm run build` Fail?

Possible triggers (to verify in CI logs):
1. **Dependency conflict**: A new transitive dependency in `package.json` or lockfile conflicts with another
2. **Type error**: TypeScript compilation found a type mismatch not caught locally
3. **Linting failure**: ESLint / Prettier standards violation in a file not run through pre-commit
4. **Missing environment variable**: Build requires `VITE_*` env var not set in Vercel secrets
5. **Network timeout**: CDN or registry timeout during dependency fetch
6. **Out-of-memory**: Node.js process hit memory limit during bundling (common in CI)
7. **Toolchain version mismatch**: Node.js, yarn, Vite versions differ between local dev and CI

### Q: Why Was There No Previous READY Deployment?

Possible causes:
1. **First deployment to this branch**: If `main` was just created or reset, no history exists
2. **Vercel history pruned**: Production deployments older than retention window (default: 30 days) are removed
3. **API call failed silently**: The rollback automation could not fetch deployment list due to token/permissions issue
4. **All recent deploys failed**: Previous N deployments also failed, leaving no READY state

---

## 7. Incident Response Checklist

Per `docs/operations/deployment-runbook.md` § 7 (Incident Response Protocol):

- [ ] **SEV-1 Severity Confirmed**: Deployment failure → production unavailable (escalation needed)
- [ ] **Response Time**: <15 minutes (target)
- [ ] **On-Call Escalation**: PagerDuty On-Call + Lead Architect + Security Team
- [ ] **Communications Lead**: Product Manager notified of status
- [ ] **Incident Ticket**: #394 created with labels `incident`, `sev-1`, `deployment`
- [ ] **Health Verification**: `/api/health` and `/api/status` validated
- [ ] **Root Cause Identified**: Pending (see section 6)
- [ ] **Corrective Action**: Pending (see section 5)
- [ ] **Post-Mortem**: To be completed within 48 hours

---

## 8. Questions for Investigation

1. **What is the exact error message in the GitHub Actions log?**
   - Run: https://github.com/PromptMintLabs/prompt-mint/actions/runs/33128846822
   
2. **Are there any Vercel production deployments before c859e94's parent (efb845a)?**
   - Check: `vercel list prompt-mint --prod | head -20`

3. **Was the frontend build expected to succeed with contract-only changes?**
   - The contract changes should not affect frontend build
   - Suggest: Try locally `npm ci && npm run build` to reproduce

4. **Are Vercel secrets configured correctly?**
   - All `VITE_*` environment variables in place?
   - Do they match the `.env.example`?

5. **Was there a recent CI/CD infrastructure change?**
   - Node.js version bump in `.github/workflows/deploy.yml`?
   - Vercel plan downgrade affecting build resources?

---

## 9. Severity Justification

**SEV-1 (Critical)** because:
- Production frontend deployment failed (complete user access blocked during deploy window)
- Automated rollback system could not recover (no previous READY deployment available)
- Users cannot access the app until manual remediation or re-deployment succeeds
- Financial/reputational impact: marketplace unavailable → missed transactions, creator trust erosion

---

## 10. Next Update Timeline

- **Immediate (0-15 min)**: Retrieve CI/Vercel logs; confirm health status
- **Short-term (15-60 min)**: Identify root cause; execute remediation
- **Medium-term (1-4 hours)**: Validate fix; post smoke test results
- **Follow-up (24-48 hours)**: Complete blameless post-mortem; identify process improvements

---

## References

- [Auto-Rollback Runbook](docs/operations/auto-rollback.md)
- [Deployment Runbook](docs/operations/deployment-runbook.md)
- [Incident Response Protocol](docs/operations/deployment-runbook.md#7-incident-response-protocol)
- [GitHub Issue #394](https://github.com/PromptMintLabs/prompt-mint/issues/394)
- [Failed Run #33128846822](https://github.com/PromptMintLabs/prompt-mint/actions/runs/33128846822)

---

**Document Status**: Draft - Pending Lab Investigation  
**Last Updated**: 2026-08-29 (Initial Creation)  
**Owner**: On-Call Engineer (barry01)
