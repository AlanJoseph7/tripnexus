# TripNexus

TripNexus creates date-aware travel itineraries with a coordinated AI planning crew and lets travelers inspect each planning run.

## Run & Operate

- `pnpm --filter @workspace/tripnexus run dev` — run the TripNexus web app
- `pnpm --filter @workspace/api-server run dev` — run the TripNexus API server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Live API planning uses Gemini Flash through `GEMINI_API_KEY` in Replit Secrets. `GEMINI_MODEL` is optional and defaults to `gemini-3.8-flash`.
- If the Gemini key is missing or Gemini quota/provider availability fails, planning returns a clearly labeled deterministic fallback from bundled data. Invalid keys and unsupported models remain explicit errors.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/tripnexus/` — traveler-facing web app
- `artifacts/api-server/` — Express API, planning runs, Gemini client, and local travel reference data
- `lib/api-spec/openapi.yaml` — API contract and source for generated client/schema packages
- `lib/api-client-react/`, `lib/api-zod/` — generated frontend hooks and API validation schemas

## Architecture decisions

- The browser calls the API under `/api`; only the server communicates with Gemini.
- Planning runs and traces are held in process memory and expire on server restart.
- Gemini provider calls are serialized, paced, and retry only transient failures once.

## Product

Travelers can explore supported destinations, load sample trips, submit a planning request, watch its status, inspect agent messages and traces, and export the trace or project documentation.

## Deployment notes

- Publish the TripNexus web artifact and API Server together.
- Add `GEMINI_API_KEY` in Replit Secrets before expecting live Gemini planning. Google AI Pro does not include Gemini API usage; API quotas and billing are separate.
- Gemini account quotas and model access are controlled by Google. The app serializes requests, retries only transient failures once, and uses bundled offline data when quota/provider availability fails.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
