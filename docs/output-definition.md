# TripNexus — Output Definition Specification

## 1. Response Schema Specification (`GET /api/runs/:runId`)

The planning run endpoint returns the validated planning state (`GetPlanningRunResponse`). When `status === "completed"`, it includes the full multi-agent `result` object.

### Response Structure

```typescript
interface GetPlanningRunResponse {
  runId: string;
  status: "queued" | "running" | "completed" | "failed";
  createdAt: string;
  completedAt?: string;
  error?: {
    statusCode: number;
    code: string;
    error: string;
    setupInstruction?: string | null;
  };
  result?: {
    runId: string;
    mode: "groq_api" | "offline_fallback";
    status: "APPROVED" | "REJECTED";
    destination: Destination;
    request: TripRequest;
    itinerary: ItineraryDay[];
    budgetAssessment: BudgetAssessment;
    weatherAssessment: WeatherDayAssessment[];
    criticReports: CriticReport[];
    messages: AgentMessage[];
    executionTrace: TraceEvent[];
    agentsUsed: string[];
    revisionCount: number;
  };
}
```

---

## 2. Realistic Sample Response

```json
{
  "runId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "status": "completed",
  "createdAt": "2026-11-10T10:00:00.000Z",
  "completedAt": "2026-11-10T10:00:08.520Z",
  "result": {
    "runId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "mode": "groq_api",
    "status": "APPROVED",
    "destination": {
      "id": "jaipur",
      "name": "Jaipur",
      "country": "India",
      "region": "Rajasthan",
      "estimatedDailyCostInr": 3600,
      "currencyCode": "INR"
    },
    "itinerary": [
      {
        "date": "2026-11-10",
        "theme": "Fort and Palace Heritage",
        "activities": [
          {
            "placeId": "jaipur-amber",
            "name": "Amber Fort",
            "startTime": "09:00",
            "durationMinutes": 150,
            "estimatedCostInr": 550,
            "rationale": "Begin at the hilltop fort during cooler morning hours."
          },
          {
            "placeId": "jaipur-citypalace",
            "name": "City Palace Museum",
            "startTime": "14:00",
            "durationMinutes": 120,
            "estimatedCostInr": 500,
            "rationale": "Explore royal courtyards and art exhibits in the afternoon."
          }
        ]
      }
    ],
    "budgetAssessment": {
      "budgetInr": 45000,
      "accommodationInr": 10800,
      "foodInr": 7200,
      "activitiesInr": 4200,
      "transportInr": 4800,
      "contingencyInr": 2700,
      "totalEstimatedInr": 29700,
      "remainingInr": 15300,
      "withinBudget": true,
      "arithmeticVerified": true,
      "explanation": "Estimated INR 29,700 total group cost leaves a comfortable ₹15,300 contingency."
    },
    "weatherAssessment": [
      {
        "date": "2026-11-10",
        "summary": "Pleasant and dry autumn weather. Minimal rain risk (8%).",
        "minTempC": 14,
        "maxTempC": 28,
        "rainChancePercent": 8,
        "dataSource": "bundled_typical_climate",
        "recommendation": "Ideal outdoor touring conditions. Carry light layers for evenings."
      }
    ],
    "criticReports": [
      {
        "decision": "APPROVED",
        "issues": [],
        "approvalSummary": "Itinerary adheres to dates, budget is well within limits, and weather conditions are optimal."
      }
    ],
    "messages": [
      {
        "messageId": "msg-1",
        "timestamp": "2026-11-10T10:00:01.120Z",
        "sender": "trip_manager",
        "recipient": "destination_agent",
        "type": "task_assignment",
        "task": "Build interest-matched Jaipur itinerary from verified catalogue.",
        "status": "sent"
      }
    ],
    "agentsUsed": ["trip_manager", "destination_agent", "budget_agent", "weather_agent", "critic_agent"],
    "revisionCount": 0
  }
}
```
