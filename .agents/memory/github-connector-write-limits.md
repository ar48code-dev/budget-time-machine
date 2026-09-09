---
name: GitHub connector uploads
description: Durable constraint discovered when synchronizing a large source tree through the Replit GitHub connector.
---

Large repository writes through the Replit GitHub connector may be throttled or blocked by the connector’s Cloudflare edge, even when small repository reads and repository creation work.

**Why:** A complete source snapshot exceeded the connector’s safe write pattern during Git Data API uploads; repeated blob and single-tree retries were blocked at the edge.

**How to apply:** For future public-repository synchronization, prefer a user-controlled GitHub push or a connector-supported bulk path after confirming limits. Do not claim the repository is synchronized from repository creation alone.