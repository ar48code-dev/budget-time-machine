---
name: Gemini workspace runtime
description: Replit-managed Gemini packages must be resolvable from the runtime bundle.
---

When a workspace library imports `@google/genai` and an esbuild service externalizes that package, the consuming service also needs `@google/genai` as a direct dependency.

**Why:** The workspace integration library typechecked and built successfully, but the API workflow failed at startup because Node resolved the externalized package from the API service rather than the library package.

**How to apply:** For any server bundle importing `@workspace/integrations-gemini-ai`, declare `@google/genai` in that server package as well, reinstall the workspace, and restart the workflow.