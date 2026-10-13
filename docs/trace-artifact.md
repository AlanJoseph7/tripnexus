# TripNexus — Agent Execution Trace Artifact Specification

## 1. Trace Overview & Rubric Requirement
The execution trace is a critical evaluation criterion for the CA3 project. It provides runtime verification that:
- Agents actually make dynamic decisions rather than running hard-coded pipelines.
- Agent-to-agent messages are exchanged during actual planning execution.
- Tools are executed with validated arguments and return genuine responses.
- The Critic agent evaluates candidate plans and records actionable feedback.

---

## 2. Event Schema

Each recorded event contains the following standard structure:

| Field | Type | Description |
| :--- | :--- | :--- |
| `eventId` | `string` | Unique event ID (`evt-1`, `evt-2`, etc.). |
| `sequence` | `number` | Strictly increasing monotonic event sequence number. |
| `timestamp` | `string` | High-precision ISO 8601 timestamp. |
| `agentId` | `string` | Agent initiating or recording the event. |
| `eventType` | `string` | Categorization: `"run_started"`, `"manager_action"`, `"model_call"`, `"tool_call"`, `"tool_result"`, `"critic_review"`, `"run_completed"`. |
| `action` | `string` | Specific action taken (e.g., `"delegate_task"`, `"search_places"`, `"evaluate_budget"`). |
| `summary` | `string` | Human-readable explanation of the action and reasoning. |
| `toolName` | `string` | Registered tool name (if event is a tool invocation). |
| `revisionNumber` | `number` | Current revision cycle iteration ($0$ for initial run). |
| `status` | `string` | Status code: `"started"`, `"completed"`, `"approved"`, `"rejected"`. |

---

## 3. How to Capture and Export a Real Trace

1. **Start the TripNexus Application**:
   ```bash
   pnpm run dev
   ```
2. **Configure API Key (Optional for Live Mode)**:
   In `.env`:
   ```env
   GROQ_API_KEY=your_groq_api_key
   GROQ_MODEL=llama-3.3-70b-versatile
   ```
3. **Submit a Trip Request in the UI**:
   - Open `http://localhost:3000` (or your deployed Vercel URL).
   - Select a destination (e.g. *Jaipur* or *Goa*), dates, and budget.
   - Click **Generate AI Itinerary**.
4. **Inspect the Live Trace**:
   - Scroll down to the **Execution Trace** panel.
   - Filter by agent (`Trip Manager`, `Destination`, `Budget`, `Weather`, `Critic`) or event type.
5. **Export the Trace as JSON**:
   - Click the **Export Trace (JSON)** button in the UI, or query:
     ```bash
     curl http://localhost:5001/api/runs/{runId}/trace > trace.json
     ```

---

## 4. Captured Sample Trace Timeline

```json
[
  {
    "eventId": "evt-1",
    "sequence": 1,
    "timestamp": "2026-11-10T10:00:00.100Z",
    "agentId": "trip_manager",
    "eventType": "run_started",
    "action": "validate_request",
    "summary": "Planning 3 days in Jaipur for 2 traveler(s).",
    "revisionNumber": 0,
    "status": "completed"
  },
  {
    "eventId": "evt-2",
    "sequence": 2,
    "timestamp": "2026-11-10T10:00:00.150Z",
    "agentId": "trip_manager",
    "eventType": "manager_action",
    "action": "orchestrate",
    "summary": "Validated the request and opened a bounded specialist plan.",
    "revisionNumber": 0,
    "status": "completed"
  },
  {
    "eventId": "evt-3",
    "sequence": 3,
    "timestamp": "2026-11-10T10:00:01.200Z",
    "agentId": "destination_agent",
    "eventType": "tool_call",
    "action": "places_search",
    "toolName": "places_search",
    "summary": "Searching local catalogue for tags: history, architecture.",
    "revisionNumber": 0,
    "status": "completed"
  },
  {
    "eventId": "evt-4",
    "sequence": 4,
    "timestamp": "2026-11-10T10:00:02.400Z",
    "agentId": "budget_agent",
    "eventType": "tool_call",
    "action": "budget_estimate",
    "toolName": "budget_estimate",
    "summary": "Calculating deterministic group lodging, dining, and activity costs.",
    "revisionNumber": 0,
    "status": "completed"
  },
  {
    "eventId": "evt-5",
    "sequence": 5,
    "timestamp": "2026-11-10T10:00:03.600Z",
    "agentId": "weather_agent",
    "eventType": "tool_call",
    "action": "seasonal_weather_estimate",
    "toolName": "seasonal_weather_estimate",
    "summary": "Retrieving seasonal monthly climate pattern for Jaipur in November.",
    "revisionNumber": 0,
    "status": "completed"
  },
  {
    "eventId": "evt-6",
    "sequence": 6,
    "timestamp": "2026-11-10T10:00:04.900Z",
    "agentId": "critic_agent",
    "eventType": "critic_review",
    "action": "evaluate_plan",
    "summary": "APPROVED: Itinerary adheres to dates, budget is well within limits, and weather conditions are optimal.",
    "revisionNumber": 0,
    "status": "approved"
  },
  {
    "eventId": "evt-7",
    "sequence": 7,
    "timestamp": "2026-11-10T10:00:05.100Z",
    "agentId": "trip_manager",
    "eventType": "run_completed",
    "action": "finalize_plan",
    "summary": "Trip planning completed successfully with 0 revision cycles.",
    "revisionNumber": 0,
    "status": "completed"
  }
]
```
