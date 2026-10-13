# TripNexus — Oral Examination & Viva Guide

This comprehensive guide prepares the team for viva questions and architectural discussions during the CA3 evaluation.

---

## 🎓 Viva Questions & Model Answers

### Q1: What is TripNexus and what problem does it solve?
**Answer**: TripNexus is an agentic multi-agent travel planner built in TypeScript and Node.js. It solves the fragmentation and hallucination problems common in travel planning: standard aggregators force users to manually stitch together flights, hotels, attractions, routes, and weather, while monolithic LLMs frequently hallucinate closed venues or incorrect budget totals. TripNexus coordinates five specialized AI agents backed by deterministic tools and verified catalogue data to produce feasible, date-aware itineraries with full execution transparency.

### Q2: Why use a multi-agent architecture instead of a single prompt with a powerful LLM?
**Answer**:
1. **Separation of Concerns**: A single prompt trying to balance routing, pricing arithmetic, climate risk, and pacing often suffers from attention dilution and hallucinations.
2. **Specialized Tools & Grounding**: Each specialist operates with bounded tool sets (Destination accesses coordinates; Budget accesses verified pricing; Weather accesses historical climate records).
3. **Independent Criticism**: An evaluator within the same monolithic generation prompt is biased toward confirming its own output. Separating the Critic agent enables genuine adversarial review and rejection.
4. **Targeted Replanning**: When an issue arises (e.g. over-budget), only the responsible agent needs to revise its output, rather than regenerating the entire itinerary.

### Q3: What are the roles of the five agents in TripNexus?
**Answer**:
1. **Trip Manager**: Central orchestrator that validates context, assigns bounded specialist tasks, monitors shared state, and routes revisions.
2. **Destination Agent**: Curates attraction schedules, resolves place IDs, and computes coordinate route distances.
3. **Budget Agent**: Analyzes transparent group expenses in INR, verifies arithmetic deterministically, and highlights cost trade-offs.
4. **Weather Agent**: Assesses seasonal climate risk for trip dates and provides indoor backups for bad-weather days.
5. **Critic Agent**: Audits the draft across dates, budget fit, route sanity, and weather risks, with veto authority to approve or reject.

### Q4: How does the Trip Manager select its next action? Is it hard-coded?
**Answer**: No, the execution flow is not a hard-coded sequence. The Trip Manager inspects the `SharedTripState`—including traveler requirements, outstanding issues, and previous agent outputs. It selects actions dynamically via structured JSON output (`delegate_to_destination`, `delegate_to_budget`, `delegate_to_weather`, `delegate_to_critic`, `request_revision`, or `finalize_plan`). For instance, if a request specifies a strict budget, the manager may prioritize financial feasibility before routing activity deep dives.

### Q5: How do agents choose and execute tools safely?
**Answer**: Every agent inherits from `BaseAgent`, which enforces an explicit allowlist of authorized tools (`allowedTools`). Agents output structured tool invocation requests. The backend validates tool arguments against strict Zod schemas before executing the TypeScript tool function. Arbitrary shell commands, unregistered tools, or unauthorized cross-agent tool calls (e.g., Destination calling Budget tools) are blocked at the architecture level.

### Q6: How does shared state work across the multi-agent workflow?
**Answer**: Shared state is maintained in an immutable in-memory ledger (`SharedTripState`) associated with a unique `runId`. Each agent reads context from shared state and returns structured results. The orchestrator updates the state and appends every agent message, tool invocation, and decision to a monotonic `RunTrace`.

### Q7: Why are deterministic calculations separated from LLM reasoning?
**Answer**: LLMs are notorious for arithmetic inaccuracies, especially with multi-day group currency sums and coordinate distance formulas. TripNexus keeps all arithmetic (sums, subtractions, coordinate distances) deterministic in TypeScript. The LLM's role is reasoning: interpreting whether a ₹5,000 variance requires activity swaps, identifying cost drivers, and explaining trade-offs to the traveler.

### Q8: How does the Critic reject a plan, and how does replanning work?
**Answer**: The Critic evaluates candidate plans against four criteria: date continuity, budget headroom, seasonal weather risks, and route efficiency. If a flaw exists, the Critic returns `decision: "REJECTED"` accompanied by structured `issues` specifying `severity`, `responsibleAgent`, `requestedAction`, and `evidence`. The Trip Manager intercepts this rejection, increments the `revisionCount`, and issues a `targeted_revision` message to the responsible agent. Replanning is bounded at 3 cycles to prevent infinite loops.

### Q9: How does the execution trace prove genuine agentic coordination?
**Answer**: The execution trace is recorded live during execution rather than generated retroactively. Each event contains an incremental sequence ID, timestamp, sending agent, receiving agent, event type, and outcome. Users can inspect model call latencies, tool execution payloads, and Critic rejection handoffs directly in the UI and export the entire audit trail as JSON.

### Q10: How are LLM rate limits and quotas handled?
**Answer**:
1. **High-Throughput Groq Integration**: TripNexus utilizes Groq Cloud, offering 30 RPM and 14,400 requests/day on its free tier using `llama-3.3-70b-versatile` or `llama-3.1-8b-instant`.
2. **Request Serialization & Concurrency Gate**: Consecutive model calls are gated through a concurrency gate and request pacing to prevent burst spikes above per-minute limits.
3. **Exponential Backoff**: HTTP 429 (`rate_limit_exceeded`) triggers retries with header-respecting `Retry-After` wait and exponential backoff.
4. **Resilient Structured Outputs**: Structured JSON schema parsing guarantees valid schema compliance.
5. **Labeled Offline Fallback**: If an account has completely exhausted its quota or internet access fails, the system produces a clearly labeled deterministic offline demo plan from bundled catalog data, ensuring zero application crashes.

### Q11: What are the current limitations of the system?
**Answer**:
- Data catalog covers 11 major destinations rather than global coverage.
- Weather data represents verified historical seasonal patterns rather than a live 10-day meteorological forecast.
- The service does not make live hotel or airline reservations.

---

## 👥 Team Contribution Template

*Fill this template truthfully with your team details before CA3 submission:*

| Member Name | Student ID / Roll No | Primary Responsibilities & Attributable Commits |
| :--- | :--- | :--- |
| **[Member 1 Name]** | `[Roll Number]` | Frontend development (React, Tailwind CSS, execution trace viewer, PDF export). |
| **[Member 2 Name]** | `[Roll Number]` | Backend architecture (Express API, BaseAgent classes, Zod schemas, OpenAPI codegen). |
| **[Member 3 Name]** | `[Roll Number]` | Multi-agent orchestration (Trip Manager, Critic evaluation loop, Groq integration, rate limiting defense). |
| **[Member 4 Name]** | `[Roll Number]` | Local datasets & tools (Destinations, Places, Weather, Vitest automated tests, Vercel deployment). |
