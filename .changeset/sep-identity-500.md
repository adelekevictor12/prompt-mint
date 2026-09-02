---
"prompt-hash-stellar": minor
---

Add SEP-1/SEP-12 style creator identity verification and a verified creator badge (#500). Creators prove domain ownership by publishing a `stellar.toml` that lists their Stellar account and a `SIGNING_KEY`; a signed SEP-12 attestation confirms their verified identity. A new `lib/identity` module parses/validates the TOML and verifies ed25519 attestation signatures, `useCreatorVerification` drives the flow, `VerifiedCreatorBadge` renders the badge, and `CreatorVerificationCard` lets connected creators verify from their profile. The badge appears on reputation summaries and public creator profiles.
