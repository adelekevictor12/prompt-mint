# [SEV-1] Automated rollback: Deploy - Frontend to Vercel and Artifacts failure (c859e94)

## Timeline

| Time (UTC) | Event |
|---|---|
| 2026-08-28 01:10:19 | PR #391 merged: "Add prompt expiry notifications and lifetime extension" (commit c859e94) |
| 2026-08-28 01:15:00 | GitHub Actions: Deploy workflow triggered automatically on main push |
| 2026-08-28 01:18:XX | **❌ Frontend build failed** during `npm run build` or Vercel deployment |
| 2026-08-28 01:20:XX | Automated rollback workflow `.github/workflows/auto-rollback.yml` initiated |
| 2026-08-28 01:22:XX | **Rollback decision: `incident_only`** — No previous READY production deployment found |
| 2026-08-28 01:22:XX | **This GitHub issue #394 auto-created** with labels: `incident`, `sev-1`, `deployment` |
| 2026-08-29 XX:XX:XX | Manual investigation and remediation in progress |

## Summary

**Failed Commit**: c859e94aacb7d1dbeba1ab87e0c5c69a6b9cd57b (Merge PR #391)

**What Happened**:
1. PR #391 (prompt expiry notifications) was merged, containing **contract-only changes** (no frontend code)
2. GitHub Actions triggered the "Deploy - Frontend to Vercel and Artifacts" workflow
3. **Frontend build failed** (reason: pending investigation)
4. Automated rollback system attempted recovery but found **no previous READY deployment** with a different SHA
5. System is in `incident_only` state: notifications sent, this issue created, **no automatic rollback executed**

**Impact**:
- 🔴 **Critical**: Production frontend deployment unavailable
- 📊 **Blast Radius**: 100% of users cannot access marketplace
- 💰 **Business Impact**: Purchase flow blocked; creator ecosystem at risk

## Investigation Status

### ✅ What We Know
- Commit c859e94 contains contract-only changes (5 files: `contract.rs`, `events.rs`, `storage.rs`, `test.rs`, `types.rs`)
- Contract code syntax is correct; includes new functions and comprehensive unit tests
- Automated rollback system works correctly (detected failure → triggered recovery → created this issue)
- Code repository is healthy; no data corruption

### ❓ What We Need to Investigate
- [ ] **Exact build failure reason** — GitHub Actions logs from run #33128846822
- [ ] **Vercel build status** — Deployment state and build logs
- [ ] **Local reproducibility** — Can `npm run build` succeed locally?
- [ ] **Vercel configuration** — Are all secrets (VITE_*) configured?
- [ ] **Toolchain versions** — Node.js, yarn, Vite compatibility
- [ ] **Previous deployments** — Can we recover from an older version?

## Next Steps (Priority Order)

### 1. **IMMEDIATE**: Retrieve & Analyze Build Logs
```bash
# GitHub Actions log from failed run
gh run view 33128846822 --log-failed

# Look for error patterns:
# - "error TS..." → TypeScript compilation failed
# - "npm ERR! code ERESOLVE" → Dependency conflict
# - "ENOMEM" → Out of memory
# - "ETIMEDOUT" → Network timeout
# - "403 Forbidden" → Secrets/permissions issue
```

### 2. **URGENT**: Check Vercel Status
```bash
vercel ls --prod          # Recent deployments
vercel logs <DEPLOYMENT>  # Build logs from Vercel
```

### 3. **URGENT**: Test Local Build
```bash
yarn install
npm run build

# If succeeds: Issue is CI/Vercel-specific
# If fails: Issue is reproducible; can debug locally
```

### 4. **Apply Remediation** (Based on Root Cause)
- **Option A**: Instant rollback to previous READY deployment (if available)
- **Option B**: Fix root cause + redeploy
- **Option C**: Revert c859e94; investigate separately

### 5. **VERIFY**: Health Checks
```bash
curl https://promptmint.io/api/health    # Should: { "status": "ok", ... }
curl https://promptmint.io/api/status    # Should: All services "up"
```

## SLA Status

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| **Detection Time** | N/A | ~3-5 min | ✅ |
| **Response Time** | <15 min | 20+ min | 🟡 At Risk |
| **Resolution Time** | <15 min | TBD | 🔴 At Risk |
| **Severity** | SEV-1 | SEV-1 | ✅ Correct |

⚠️ **Escalation Required**: Notify on-call engineer + Lead Architect immediately.

## Rollback Information

**Outcome**: `incident_only`  
**Reason**: No READY production deployment with different SHA found

**Analysis**:
- The automated rollback system checked Vercel's production deployments
- No previous stable version was available to instantly restore
- **Possible causes**:
  1. First deployment to `main` in recent history
  2. Vercel deployment history pruned
  3. All previous deployments in error state
  4. API error during deployment list retrieval

## Commit Details

**Commit**: [c859e94](https://github.com/PromptMintLabs/prompt-mint/commit/c859e94)  
**Author**: Henry Ebubechukwu  
**Message**: Merge pull request #391 from josephamly36-commits/main  
**PR**: [#391 - Add prompt expiry notifications and lifetime extension](https://github.com/PromptMintLabs/prompt-mint/pull/391)

**Changes**:
- `contracts/prompt-hash/src/contract.rs`: +41 lines (new functions, validation)
- `contracts/prompt-hash/src/events.rs`: +22 lines (new event type)
- `contracts/prompt-hash/src/storage.rs`: +16 lines (persistence helpers)
- `contracts/prompt-hash/src/test.rs`: +70 lines (unit tests)
- `contracts/prompt-hash/src/types.rs`: +14 lines (new data key)

**❓ Why did frontend build fail?**
- Contract changes should NOT affect frontend build
- Error is likely environmental: missing secrets, toolchain issue, or dependency conflict
- **Awaiting log analysis to confirm**

## Related Documentation

- 📖 [Auto-Rollback Runbook](docs/operations/auto-rollback.md)
- 📖 [Deployment Runbook](docs/operations/deployment-runbook.md)
- 📖 [Incident Response Protocol](docs/operations/deployment-runbook.md#7-incident-response-protocol)
- 🔗 [Failed GitHub Actions Run #33128846822](https://github.com/PromptMintLabs/prompt-mint/actions/runs/33128846822)

## Troubleshooting

See detailed troubleshooting guide: [`INCIDENT_394_TROUBLESHOOTING_GUIDE.md`](INCIDENT_394_TROUBLESHOOTING_GUIDE.md)

For root cause identification and common fixes (out of memory, missing secrets, dependency conflicts, etc.), refer to the guide.

## Severity Justification

**Why SEV-1 (Critical)?**

- ✅ **Funds at Risk**: Marketplace unavailable → purchase transactions blocked
- ✅ **Complete Outage**: 100% of users cannot access frontend
- ✅ **Business Impact**: Creator trust erosion; transaction revenue at risk
- ✅ **Response Time**: <15 minutes required per SLA
- ✅ **Escalation**: On-call engineer + Lead Architect + Security team

**Related SLA**: Deployment-related incidents (target: <15 min response, <30 min resolution)

## Labels & Metadata

- **Labels**: `incident`, `sev-1`, `deployment`, `auto-rollback`, `urgent`
- **Milestone**: Production
- **Affected Component**: Frontend deployment / Vercel integration
- **Environment**: Production (`main` → Vercel)
- **Automation**: This ticket was auto-created by `.github/workflows/auto-rollback.yml`

## Post-Remediation Requirements

Before closing this issue:

- [ ] Root cause identified and documented
- [ ] Production deployment restored (rollback, fix, or revert)
- [ ] Health checks pass: `/api/health` and `/api/status` ✅
- [ ] Smoke tests successful (wallet, prompt creation, purchase flow)
- [ ] Incident timeline added below
- [ ] Blameless post-mortem initiated (due within 48 hours)
- [ ] Preventive actions documented

---

## Incident Timeline (To Be Updated During Investigation)

### Phase 1: Detection & Initial Response
- **2026-08-28 01:18 UTC**: Build failure detected
- **2026-08-28 01:20 UTC**: Rollback automation triggered
- **2026-08-28 01:22 UTC**: Issue #394 created; Slack/Discord notified

### Phase 2: Investigation (In Progress)
- **2026-08-29 XX:XX UTC**: GitHub Actions logs retrieved
- **2026-08-29 XX:XX UTC**: Root cause identified: ___________
- **2026-08-29 XX:XX UTC**: Remediation plan selected

### Phase 3: Remediation & Verification
- **2026-08-29 XX:XX UTC**: Fix/rollback/revert executed
- **2026-08-29 XX:XX UTC**: Health checks verified ✅
- **2026-08-29 XX:XX UTC**: Issue resolved; all clear notification sent

### Phase 4: Post-Mortem (Within 48 Hours)
- **2026-08-30 XX:XX UTC**: Blameless post-mortem draft completed
- **2026-08-30 XX:XX UTC**: Action items assigned
- **2026-08-30 XX:XX UTC**: Post-mortem shared with team

---

## Questions / Discussion

**For the Team:**
1. Are there known CI/CD issues with this build environment?
2. Should we implement pre-merge staging validation?
3. What preventive measures would help avoid future rollback situations?
4. Should we enhance the automated rollback system to handle the `incident_only` case better?

---

**Status**: 🔴 **ACTIVE - UNDER INVESTIGATION**  
**Last Updated**: 2026-08-29 (investigation initiated)  
**Owner**: On-Call Engineer  
**Escalation**: Lead Architect

**Do NOT close this issue until all post-remediation requirements are met.**

---

**Auto-Generated**: 2026-08-28 01:22 UTC by Automated Rollback System  
**Template**: `docs/operations/auto-rollback.md` § Incident Ticket Format
