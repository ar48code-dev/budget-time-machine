---
name: Room collaboration boundary
description: Durable distinction between anonymous room capabilities and claimed team rooms.
---

Anonymous rooms remain unlisted and usable through their browser capability until a producer explicitly claims them. Claiming transfers ownership server-side and changes every production read/write to membership-checked access; invite acceptance is email-bound and role-scoped.

**Why:** The hackathon flow must remain frictionless, while cross-browser recovery and collaboration must not rely on trusting a caller-supplied user or room owner.

**How to apply:** Preserve the anonymous path for demos and private drafts, but never list it as a team room or allow claimed-room access without a valid producer session and membership.