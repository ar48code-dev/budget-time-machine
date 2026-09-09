# The Line — Budget Time-Machine

An agent-powered production control room that lets independent film teams simulate schedule changes, see deterministic budget consequences, and commit a governed plan.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/budget-time-machine run dev` — run the React control room
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, and the runtime-only `GOOGLE_APPLICATION_CREDENTIALS_JSON` Replit Secret for Vertex AI

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/budget-time-machine/src/App.tsx` — single-page producer cockpit and overlay flows.
- `artifacts/budget-time-machine/src/index.css` — navy rail / warm paper / chartreuse signal visual system.
- `artifacts/api-server/src/routes/production.ts` — production, simulation, apply, advisor, decision log, scenarios, and comparison endpoints.
- `artifacts/api-server/src/lib/agents.ts` — Ingestion, Simulation, Impact, Plan, Advisor, and Comparison behavior.
- `artifacts/api-server/src/lib/production.ts` — room-scoped state cache backed by PostgreSQL and confirmation-gated pending changes.
- `lib/api-spec/openapi.yaml` — source of truth for generated API hooks and schemas.

## Architecture decisions

- Gemini is called through the centralized `@workspace/integrations-gemini-ai` package configured for Vertex AI. The service-account JSON is parsed only at runtime and is never committed.
- Agents use Gemini for document understanding, dependency reasoning, rule selection, recommendations, and producer-facing summaries.
- Financial deltas stay deterministic and grounded in the server-side rate card; Gemini cannot invent money.
- A simulation is staged as pending state and cannot reach the graph until the apply request includes explicit confirmation.
- The sample production is deterministic demo seed data; real schedule, budget, PDF, and image ingestion uses the live Vertex AI path.
- Each browser starts with an anonymous private room cookie. Producer accounts and sessions are stored server-side; a producer can explicitly claim the anonymous room, list owned/member rooms across browsers, and invite email-matched editors/viewers. Every production route checks room membership and role before loading the isolated graph, scenarios, applied plans, or decision log.

## Product

The active production view shows remaining reserve, committed spend, a schedule spine, dependencies, and day-level cost. Producers can load the sample production or ingest a text/CSV/JSON/Markdown schedule, open a simulation desk, inspect cascade effects and budget rules, ask an Advisor Agent for high-leverage cuts, confirm a revised plan, review the persistent applied-plan artifacts, inspect the decision log, save/compare scenarios, and export a complete ZIP handoff pack.

## Gotchas

- Run `pnpm run typecheck:libs` before API-server typechecking when adding a new workspace library reference.
- The Vite artifact config expects `PORT` from the managed workflow; a direct local production build without `PORT` will fail before compiling.
- The graph endpoint intentionally returns 404 before a sample or ingest load; the frontend treats that as the designed empty state.
- The sample endpoint resets graph, pending simulations, applied plans, scenarios, and decision history before seeding the demo, making repeat recordings deterministic.
- Gemini-backed ingestion, simulation, apply, advisor, and comparison routes have a lightweight per-IP request limit; ingestion text and inline file data are schema-limited.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
