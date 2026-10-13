# TripNexus — Project Synopsis

## 1. Executive Summary & Problem Context
Modern travel planning is inherently multi-faceted: travelers must reconcile personal interests, geographical routes, finite budgets, seasonal weather patterns, and pacing constraints. Traditional travel aggregators provide static, disconnected search results that force the user to manually perform route arithmetic, check weather suitability, verify currency estimates, and synthesize an itinerary day-by-day. Single-prompt large language model (LLM) interfaces often suffer from hallucinated attractions, unverified arithmetic, ignorance of real calendar dates, and an inability to self-critique or replan when initial assumptions fail.

## 2. Solution: Multi-Agent AI Architecture
**TripNexus** resolves these deficiencies by introducing a coordinated multi-agent artificial intelligence system built in TypeScript and Node.js with a reactive web interface. Rather than relying on a monolithic prompt or brittle hard-coded pipelines, TripNexus deploys five specialized AI roles:
1. **Trip Manager Agent**: Acts as the central orchestrator, dynamically allocating tasks, managing shared state, and deciding the next operational action based on runtime findings.
2. **Destination Agent**: Selects verified catalog attractions matching travelers' interests and computes coordinate-based route distances.
3. **Budget Agent**: Analyzes transparent group costs in INR, performing deterministic calculations in TypeScript while prompting the LLM to interpret financial trade-offs and cost drivers.
4. **Weather Agent**: Assesses date-aligned seasonal climate conditions from verified local climate patterns, identifying risks for outdoor activities and suggesting indoor alternatives.
5. **Critic Agent**: Serves as an independent evaluator, critically auditing the candidate draft across dates, budget fit, route sanity, and weather risks, with the authority to issue an explicit **REJECTED** verdict.

When the Critic rejects a candidate plan, the Trip Manager routes a targeted revision to the responsible specialist agent. This feedback loop enforces genuine conflict resolution, adaptive replanning, and rigorous quality control before finalizing any travel plan.

## 3. Target Audience & Practical Value
TripNexus serves solo travelers, family planners, and tour organizers who require feasible, validated, and transparent travel schedules. For academic evaluation, TripNexus provides a complete real-time runtime execution trace capturing every inter-agent message, tool call, model decision, and revision cycle, fulfilling all seven grading categories of the CA3 assessment criteria.
