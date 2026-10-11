# TripNexus

TripNexus creates date-aware travel itineraries with a coordinated AI planning crew and lets travelers inspect each planning run.

## Run & Operate

- `pnpm --filter @workspace/tripnexus run dev` — run the TripNexus web app
- `pnpm --filter @workspace/api-server run dev` — run the TripNexus API server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- API planning requires `GROQ_API_KEY` in Replit Secrets. `GROQ_MODEL` is optional and defaults to `openai/gpt-oss-20b`.
- Health, destination, agent, and demo endpoints work without the Groq secret; generating a live itinerary does not.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/tripnexus/` — traveler-facing web app
- `artifacts/api-server/` — Express API, planning runs, Groq client, and local travel reference data
- `lib/api-spec/openapi.yaml` — API contract and source for generated client/schema packages
- `lib/api-client-react/`, `lib/api-zod/` — generated frontend hooks and API validation schemas

## Architecture decisions

- The browser calls the API under `/api`; only the server communicates with Groq.
- Planning runs and traces are held in process memory and expire on server restart.
- Provider calls are serialized and respond to Groq reset guidance to reduce request bursts.

## Product

Travelers can explore supported destinations, load sample trips, submit a planning request, watch its status, inspect agent messages and traces, and export the trace or project documentation.

## Deployment notes

- Publish the TripNexus web artifact and API Server together.
- Add `GROQ_API_KEY` in Replit Secrets before expecting live trip planning to complete.
- Groq account credits, model access, and provider rate limits remain controlled by Groq; code can back off but cannot increase account quota.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
