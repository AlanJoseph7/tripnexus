# TripNexus

TripNexus creates date-aware travel itineraries with a coordinated AI planning crew and lets travelers inspect each planning run.

## Run & Operate

- `pnpm --filter @workspace/tripnexus run dev` — run the TripNexus web app
- `pnpm --filter @workspace/api-server run dev` — run the TripNexus API server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Live API planning uses Groq Cloud through `GROQ_API_KEY` in environment variables. `GROQ_MODEL` is optional and defaults to `llama-3.3-70b-versatile`.
- If the Groq key is missing or quota/provider availability fails, planning returns a clearly labeled deterministic fallback from bundled data. Invalid keys and unsupported models remain explicit errors.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (ESM bundle)

## Where things live

- `artifacts/tripnexus/` — traveler-facing web app
- `artifacts/api-server/` — Express API, planning runs, Groq client, and local travel reference data
- `lib/api-spec/openapi.yaml` — API contract and source for generated client/schema packages
- `lib/api-client-react/`, `lib/api-zod/` — generated frontend hooks and API validation schemas

## Architecture decisions

- The browser calls the API under `/api`; only the server communicates with Groq.
- Planning runs and traces are held in process memory and expire on server restart.
- Groq provider calls are serialized with concurrency gating, paced, and retry transient failures with exponential backoff.

## Product

Travelers can explore supported destinations, load sample trips, submit a planning request, watch its status, inspect agent messages and traces, and export the trace or project documentation.

## Deployment notes

- Deploy to Vercel or Node.js server.
- Add `GROQ_API_KEY` in environment variables before expecting live Groq planning.
- The app serializes requests, retries transient failures, and uses bundled offline data when quota/provider availability fails.
