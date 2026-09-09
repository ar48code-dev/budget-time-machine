# The Line — Budget Time-Machine

The Line is an agent-powered director's cockpit for independent film productions. Load a schedule and budget, explore a what-if change, inspect the cascade and deterministic financial impact, then confirm a revised plan with producer-facing handoff artifacts.

Budget Time-Machine is the product descriptor: the app helps a production team explore the consequences of moving the line before committing the plan.

## Demo and source

- **Open-source repository:** https://github.com/ar48code-dev/budget-time-machine
- **Video demo:** https://youtu.be/mBdCzzItZtQ
- **License:** MIT (`LICENSE`)

The repository contains the complete pnpm workspace, frontend, API, database schema, generated API clients, demo seed data, smoke test, deployment configuration, and the source files for the Gemini/Vertex AI integration. No external asset download is required to run the deterministic demo: the UI and demo data are source-controlled in this repository.

## What the project does

The Line lets producers:

- Load a deterministic sample production for a repeatable demo
- Ingest schedule and budget information from text, CSV, JSON, Markdown, PDF, and image inputs
- View shoot days, locations, cast, crew, timing, dependencies, and day-level costs
- Run what-if schedule simulations
- Identify cascading effects across dependent shoot days and shared cast members
- Review turnaround, equipment, overtime, and production risks
- See deterministic financial deltas based on server-controlled production rules
- Ask an Advisor Agent for high-leverage production recommendations
- Require explicit confirmation before applying a revised plan
- Maintain a decision history with agent reasoning and producer actions
- Save and compare production scenarios
- Export a ZIP handoff pack containing the schedule, applied plan, decision log, scenarios, and production artifacts
- Use private browser rooms or claim a room for authenticated cross-browser collaboration

The app separates agent reasoning from financial authority. Gemini explains dependencies, risks, and recommendations, but it cannot invent financial values. Financial deltas are calculated by deterministic server-side rate-card rules.

## Google Cloud / Vertex AI runtime integration

Google Cloud Vertex AI is used at runtime, not just named in the documentation.

The integration is implemented in these source files:

1. `lib/integrations-gemini-ai/src/client.ts` imports the Google Gen AI SDK:

   ```ts
   import { GoogleGenAI } from "@google/genai";
   ```

   It creates a Vertex AI client using the configured Google Cloud project, location, and runtime service-account credentials:

   ```ts
   export const ai = new GoogleGenAI({
     vertexai: true,
     project,
     location,
     googleAuthOptions: { credentials },
   });
   ```

2. `artifacts/api-server/src/lib/gemini.ts` calls the live Gemini model through that client:

   ```ts
   const response = await ai.models.generateContent({
     model: "gemini-2.5-flash",
     contents: [{ role: "user", parts }],
     config: {
       systemInstruction,
       responseMimeType: "application/json",
       temperature: 0.2,
     },
   });
   ```

3. The production routes and agent orchestration call `generateJson` and `generateText` for real ingestion, simulation explanations, plan memos, advisor recommendations, and scenario comparisons. Relevant call sites include:

   - `artifacts/api-server/src/lib/agents.ts`
   - `artifacts/api-server/src/routes/production.ts`
   - `artifacts/api-server/src/lib/gemini.ts`

The API declares the runtime dependency in `artifacts/api-server/package.json`:

```json
"@google/genai": "^1.44.0"
```

The sample production is deterministic so judges can reproduce the demo. Real document ingestion uses the live Vertex AI path.

## Architecture

- **Frontend:** React, Vite, TypeScript, Tailwind CSS, TanStack Query, and generated API hooks
- **API:** Express 5, TypeScript, Zod validation, and OpenAPI-generated clients
- **Database:** PostgreSQL with Drizzle ORM
- **AI:** Google Gen AI SDK calling Gemini through Google Cloud Vertex AI
- **Persistence:** Room-scoped graphs, memberships, applied plans, scenarios, and decision logs
- **Exports:** Server-generated ZIP handoff packs
- **Workspace:** pnpm monorepo with separate web and API artifacts

The main agent boundaries are explicit in `artifacts/api-server/src/lib/agents.ts`:

- **Ingestion & Graph Agent** parses production notes or inline PDF/image data into a typed production graph.
- **Simulation Agent** maps schedule dependencies affected by a proposed change.
- **Impact Agent** applies deterministic production-cost rules and reports budget/risk deltas.
- **Plan Agent** requires confirmation, revises the graph, and generates a schedule summary, producer memo, and purchase-order deltas.
- **Advisor Agent** scans the active graph for leverage opportunities and can prefill the simulation desk.
- **Comparison Agent** summarizes differences between saved scenarios.

## Requirements

- Node.js 24
- pnpm
- PostgreSQL 16 or a PostgreSQL-compatible database
- A Google Cloud project with Vertex AI enabled
- A Google Cloud service account with permission to call Vertex AI Gemini models

## Configuration

The API requires these environment variables:

```bash
DATABASE_URL=postgresql://...
SESSION_SECRET=replace-with-a-local-development-secret
GOOGLE_CLOUD_PROJECT=your-google-cloud-project-id
GOOGLE_CLOUD_LOCATION=global
GOOGLE_APPLICATION_CREDENTIALS_JSON='{"type":"service_account",...}'
```

Do not commit service-account JSON, API keys, passwords, or session secrets. On Replit, store sensitive values as Secrets. `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION` may be regular environment variables, while `GOOGLE_APPLICATION_CREDENTIALS_JSON` must remain a secret.

The integration fails explicitly if the Vertex AI project, location, or credentials are missing or malformed.

## Run in Replit

Replit is the supported runtime for the submitted project because it provides the configured workflows, PostgreSQL environment, and path routing between the web and API artifacts.

1. Import or fork the repository into Replit.
2. Provision a PostgreSQL database.
3. Add the required environment variables and Secrets above.
4. Install dependencies:

   ```bash
   pnpm install
   ```

5. Apply the database schema:

   ```bash
   pnpm --filter @workspace/db run push
   ```

6. Start the API and web workflows:

   ```bash
   pnpm --filter @workspace/api-server run dev
   pnpm --filter @workspace/budget-time-machine run dev
   ```

The repository's `.replit` and artifact configuration provide the managed workflow/deployment settings. Open the Replit preview URL rather than the direct Vite localhost port so `/api` requests are routed to the API artifact.

## Run outside Replit

The source can also be run from a local Node.js 24 and PostgreSQL environment:

```bash
pnpm install
export DATABASE_URL='postgresql://user:password@localhost:5432/the_line'
export SESSION_SECRET='local-development-secret'
export GOOGLE_CLOUD_PROJECT='your-google-cloud-project-id'
export GOOGLE_CLOUD_LOCATION='global'
export GOOGLE_APPLICATION_CREDENTIALS_JSON='{"type":"service_account",...}'
pnpm --filter @workspace/db run push
```

Start the API and frontend in separate terminals:

```bash
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/budget-time-machine run dev
```

The API requires the `PORT` environment variable. The Replit workflows provide it automatically. When running manually, set a free API port such as `PORT=8080` and configure a local reverse proxy or equivalent `/api` routing for the frontend. The production preview is path-routed because the web and API are separate artifacts.

## Reproducible smoke test

With the API running and the database configured, run:

```bash
bash scripts/production-smoke.sh
```

For a directly running API on port 8080, set the API base URL explicitly:

```bash
BASE_URL=http://localhost:8080/api bash scripts/production-smoke.sh
```

The smoke test uses the real application routes and verifies:

- Two browser cookie jars receive isolated private rooms
- Loading a production in browser A is not visible in browser B
- The deterministic sample loads successfully
- The simulation route returns a change, cascade, and impact
- Applying without confirmation is rejected with HTTP 403
- Applying with explicit confirmation creates an applied plan
- The export route returns a valid ZIP
- The ZIP contains the active graph, decision log, applied plans, scenarios, and README
- The applied graph persists after the request completes

The simulation and apply paths use the live agent implementation. Run this test deliberately because Vertex AI calls can take several seconds.

## Product workflow

1. Load the deterministic sample or ingest production documents.
2. Inspect the schedule spine, budget position, and dependency graph.
3. Open the simulation desk and choose a what-if change.
4. Review affected days, risk flags, agent reasoning, and deterministic cost deltas.
5. Explicitly confirm the revised plan.
6. Review the applied-plan artifacts and decision log.
7. Save or compare scenarios.
8. Export the production handoff ZIP.

Each browser starts with an anonymous private production room cookie. Producers can create an account, claim that room, and reopen it from another browser. Claimed rooms are owned and listed server-side, with explicit editor/viewer memberships and email-bound invite codes. Graphs, scenarios, applied plans, and decision logs stay isolated per room.

## License

This project is released under the MIT License. See `LICENSE`.

## Built with Replit Agent

This project was built with Replit Agent for the Agentic Cinema hackathon.
