---
"prompt-hash-stellar": minor
---

Add moderation and abuse-reporting flows (#501). Buyers can file signed abuse reports against listings (and reviews/users) through a new `POST /api/moderation/report` endpoint and a Report dialog on the listing page. Moderators get a paginated, filterable report queue (`GET /api/moderation/queue`) and can resolve/dismiss reports and take down or reinstate listings (`POST /api/moderation/actions`). A public `GET /api/moderation/status` endpoint lets the listing page show a takedown notice when a prompt has been removed. All moderator actions require a scoped wallet signature and are written to the existing audit log.
