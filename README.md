# The Line — Budget Time-Machine

The Line is an agent-powered director's cockpit for independent film productions. Load a schedule and budget, explore a what-if change, inspect the cascade and deterministic financial impact, then confirm a revised plan with producer-facing handoff artifacts.

Budget Time-Machine is the product descriptor: the app lets a production team explore the consequences of moving the line before committing the plan.

## Agent architecture

The API keeps the agent boundaries explicit in `artifacts/api-server/src/lib/agents.ts`:

- **Ingestion & Graph Agent** parses pasted production notes or PDF/image inline data into a typed production graph.
- **Simulation Agent** maps schedule dependencies affected by a proposed change.
- **Impact Agent** applies deterministic production-cost rules and reports budget/risk deltas.
- **Plan Agent** requires confirmation, revises the graph, and generates a revised schedule summary, producer memo, and purchase-order deltas.
- **Advisor Agent** scans the active graph for leverage opportunities and can prefill the simulation desk.
- **Comparison Agent** summarizes differences between saved scenarios.

All model calls are centralized in `artifacts/api-server/src/lib/gemini.ts` and use the Replit-managed runtime wrapper in `lib/integrations-gemini-ai`. The current configuration targets Vertex AI with `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, and the runtime-only `GOOGLE_APPLICATION_CREDENTIALS_JSON` Replit Secret.

## Run locally in Replit

```bash
pnpm install
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/budget-time-machine run dev
```

The app is designed for the configured Replit workflows. Load the deterministic sample production for a repeatable demo state, or ingest your own schedule/budget document for a real end-to-end test. Uploaded text, CSV, JSON, Markdown, PDF, and image inputs are sent through the live Vertex AI ingestion path.

Each browser starts with an anonymous private production room cookie. Producers can create an account, claim that room, and reopen it from another browser. Claimed rooms are owned and listed server-side, with explicit editor/viewer memberships and email-bound invite codes; graphs, scenarios, applied plans, and decision logs stay isolated per room.

## Smoke test

With the API and web workflows running, execute:

```bash
bash scripts/production-smoke.sh
```

The script exercises sample loading, simulation, the confirmation gate, plan application, ZIP export, and room-scoped persistence. It uses the live agent routes, so run it deliberately rather than on every file save.

## Built with Replit Agent

This project was built with Replit Agent for the Agentic Cinema hackathon.