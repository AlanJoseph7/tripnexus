# TripNexus — Autonomous Multi-Agent Travel Planning System
## Project Synopsis (Up-to-Date Version 2.4.0)

**Document Type:** Academic & Technical Project Synopsis  
**Project Version:** 2.4.0 (Production Release)  
**System Status:** Live on Vercel & Production Ready  
**Repository:** [GitHub: AlanJoseph7/tripnexus](https://github.com/AlanJoseph7/tripnexus)  
**Downloadable PDF:** Available at [`docs/TripNexus_Project_Synopsis.pdf`](./TripNexus_Project_Synopsis.pdf) and via the live web application under `Project documentation (PDF)`.

---

### 1. Project Title & Domain
* **Title:** TripNexus: Constraint-Aware Autonomous Multi-Agent Travel Planner
* **Domain:** Artificial Intelligence, Distributed Multi-Agent Systems (MAS), Full-Stack Web Engineering
* **Key Principles:** Autonomous Role Decomposition, Closed-Loop Evaluator Pattern, Deterministic Arithmetic Tool Separation, Production LLM Rate-Limit Resilience.

---

### 2. Executive Summary & Abstract
Modern consumer travel planning is an intricate multi-criteria constraint satisfaction problem. Travelers must balance diverse personal interests, geographical routes, finite group budgets in INR, and seasonal climate risks.

Single-prompt Large Language Model (LLM) interfaces fail consistently in this domain due to four fundamental limitations:
1. **Hallucination:** Fabricating non-existent attractions, artificial venues, and speculative pricing.
2. **Arithmetic Incompetence:** Severe mathematical errors when computing multi-day multi-traveler budget line items.
3. **Context Drift:** Losing chronological continuity across multi-day itineraries.
4. **Lack of Self-Critique:** Inability to independently audit their own proposals or adaptively replan when constraints are violated.

**TripNexus** resolves these deficiencies by introducing an autonomous, distributed multi-agent collaborative architecture. Built with TypeScript, Node.js, React 19, and Groq Cloud LPU inference, TripNexus distributes travel planning across five autonomous specialized agents. The system enforces strict separation between non-deterministic LLM reasoning and deterministic mathematical computation, incorporates an adversarial Critic Agent with closed-loop revision cycles, and features an enterprise-grade resilient infrastructure with multi-key rotation, multi-model failover, and zero-crash offline fallback mechanisms.

---

### 3. Problem Statement & Objectives

#### Problem Statement
Current online travel portals either rely on rigid, pre-packaged tour templates or leave travelers to manually cross-reference map directions, seasonal weather forecasts, and cost spreadsheets. Conversely, generic generative AI tools generate stylistically pleasing but operationally unfeasible itineraries with unrealistic transit times, conflicting budgets, and overlooked monsoon or extreme heat seasons.

#### Project Objectives
* **Autonomous Role Decomposition:** Segment complex trip planning into bounded, single-responsibility agent roles (Manager, Destination, Budget, Weather, Critic).
* **Strict Schema Enforcement:** Guarantee 100% valid JSON responses using Zod runtime validation and Groq strict JSON-schema decoding.
* **Deterministic Arithmetic Integrity:** Compute all distance calculations (Haversine trigonometric formulas) and budget summations strictly in TypeScript to prevent LLM hallucination.
* **Closed-Loop Adversarial Critique:** Deploy an independent Critic Agent capable of rejecting inadequate drafts and commanding targeted agent revisions.
* **Production-Grade Resilience:** Implement dynamic multi-model failover, 404 model pruning, round-robin multi-key pooling, and guaranteed offline fallback.
* **Transparent Auditability:** Record every inter-agent message, tool call, latency, and decision in a monotonic execution trace exportable in JSON format.

---

### 4. System Architecture & Autonomous Agents
TripNexus coordinates five specialized agent roles:

1. **Trip Manager Agent (`trip_manager`):**
   * Serves as the executive planner and state supervisor.
   * Validates user inputs (dates, origin, destination, group size, budget, pace).
   * Deconstructs planning goals into structured assignments for specialists.
   * Intercepts Critic rejections, increments revision counters, and dispatches targeted revision tickets to responsible agents (bounded at 3 cycles).

2. **Destination Specialist Agent (`destination_agent`):**
   * Selects points of interest strictly from a verified 11-city catalog.
   * Clusters activities geographically by city area to minimize travel fatigue.
   * Executes local tools (`places_search`, `place_details`, `route_distance`).
   * Computes straight-line distances using the Haversine trigonometric formula:  
     $$d = 2 R \arcsin\left(\sqrt{\sin^2\left(\frac{\Delta\text{lat}}{2}\right) + \cos(\text{lat}_1)\cos(\text{lat}_2)\sin^2\left(\frac{\Delta\text{lon}}{2}\right)}\right)$$

3. **Budget Assessor Agent (`budget_agent`):**
   * Operates on deterministic local calculations: accommodation, food, activities, local transit, and a 10% contingency reserve for the full traveler group.
   * Explains cost drivers, headroom, and financial trade-offs in clear text.
   * Never fabricates arithmetic; LLM reasoning is strictly explanatory.

4. **Climate & Seasonality Specialist (`weather_agent`):**
   * Queries verified historical climate records for the destination and month.
   * Computes rain probability, typical temperature ranges (Celsius), and season tags.
   * Flags high-risk outdoor activities ($\ge 50\%$ rain probability) and suggests verified indoor alternatives from the destination catalog.

5. **Independent Critic Agent (`critic_agent`):**
   * Operates as an adversarial auditor evaluating the consolidated itinerary draft.
   * Evaluates four non-negotiable criteria:
     * **Date Continuity:** Validates sequential, unbroken day-by-day dates.
     * **Budget Compliance:** Checks total estimated cost against target budget.
     * **Route Sanity:** Flags excessive intra-day straight-line transit ($> 35\text{ km}$).
     * **Weather Safety:** Detects unsheltered outdoor plans during heavy rain.
   * Issues either an explicit `APPROVED` verdict or a `REJECTED` status with actionable issue tickets specifying severity, responsible agent, and evidence.

---

### 5. Closed-Loop Replanning & Conflict Resolution
When the Critic Agent discovers a constraint violation:
1. **Rejection:** Critic outputs `decision: "REJECTED"` with structured issue descriptions.
2. **Orchestration:** Trip Manager intercepts the rejection, increments `revisionCount`, and translates issues into a targeted revision prompt.
3. **Targeted Revision:** Responsible specialist (e.g., Destination or Budget Agent) re-executes, adjusting activities, substituting indoor venues, or rebalancing costs.
4. **Re-Audit:** Revised itinerary draft is re-submitted to the Critic Agent for audit.
5. **Guaranteed Bounded Termination:** The loop terminates upon Critic `APPROVAL` or upon reaching the 3-cycle safety bound, preventing infinite loops and runaway API costs.
6. **Status Badges:** If minor warnings remain after 3 cycles, the itinerary is tagged with an amber **`NEEDS ATTENTION`** status badge so the traveler can review caveats.

---

### 6. Production Engineering & Resilience Innovations (Latest Updates)

* **Multi-Model Failover Pool:** Leverages Groq Cloud LPU acceleration with sub-second inference speeds. Primary inference runs on `openai/gpt-oss-120b` with automated fallback cascade to `qwen/qwen3.8-27b` and `openai/gpt-oss-20b`.
* **Dynamic 404 Model Pruning:** Automatically intercepts HTTP 404 responses from provider endpoints, pruning unavailable models dynamically during runtime to eliminate false failure states.
* **Multi-Key Round-Robin Rotation:** Auto-discovers and pools multiple Groq API keys (`GROQ_API_KEY=key1,key2,key3,key4`), multiplying capacity to 120 RPM and 32,000 TPM with seamless failover on rate limits.
* **Stateless Serverless Trace Delivery:** In Vercel serverless functions, execution events are bundled directly into the primary plan result payload, displaying 120+ events immediately without secondary 404 race conditions.
* **Guaranteed Zero-Crash Offline Fallback:** Automatically generates a high-quality deterministic itinerary using bundled catalog data if API credentials or rate limits prevent live execution, ensuring 100% application uptime.

---

### 7. Technology Stack Specifications
* **Frontend:** React 19, TypeScript, Vite 7.3.6, TanStack Query v5, Vanilla CSS Design System, Lucide Icons.
* **Backend:** Node.js 24 LTS, Express 5, Zod Runtime Validation, Pino Structured Logging, Pure Buffer PDF Generator.
* **AI & LLM Services:** Groq Cloud LPU Ultra-Low Latency Inference, JSON-Schema Strict Structured Decoding.
* **Deployment & CI:** Vercel Serverless Functions, GitHub Actions Integration.

---

### 8. Verification & Academic Viva Alignment
* **Automated Unit Tests:** 23 passing Vitest unit tests verifying schema parsers, Haversine coordinate math, budget allocation, multi-key rotation, and offline fallback generators.
* **Academic Criteria Alignment:** Satisfies all seven CA3 assessment criteria:
  1. Multi-Agent Role Specialization
  2. Dynamic Task Allocation
  3. Monotonic Shared State & Execution Trace
  4. Deterministic Tool Execution & Arithmetic Separation
  5. Adversarial Critic & Closed-Loop Replanning
  6. Robust Error Categorization & Production Resilience
  7. Full System Documentation & Interactive Demonstration
