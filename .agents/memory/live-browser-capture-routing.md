---
name: Live browser capture routing
description: Environment-specific routing needed when recording the multi-artifact app through a real browser.
---

Use the Replit preview domain for live browser captures of this project rather than the frontend artifact's direct localhost port. The routed preview sends `/api` requests to the API artifact; the direct Vite development port serves the SPA fallback for `/api` and causes the app to fail while the browser still appears loaded.

**Why:** The web and API run as separate managed artifacts, so the local Vite server does not provide the same path routing as the Replit preview proxy.

**How to apply:** Use the preview-domain URL for browser automation and recording, and verify the page can complete `/api/room-context` and `/api/graph` before capturing.