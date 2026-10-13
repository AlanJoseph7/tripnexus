# TripNexus — Input Definition Specification

## 1. Request Schema Specification (`POST /api/plan-trip`)

TripNexus validates incoming trip planning requests against a strict Zod schema (`PlanTripBody`) before any agent execution begins.

### Field Definitions

| Field | Type | Required | Constraints | Description |
| :--- | :--- | :--- | :--- | :--- |
| `destinationId` | `string` | **Yes** | Min 2 characters, must exist in curated catalog | Identifier of the target city (e.g., `jaipur`, `goa`, `delhi`, `bangkok`, `singapore`). |
| `origin` | `string` | No | Max 120 characters | Origin location of traveler (e.g., `"Delhi"`, `"Mumbai"`). |
| `startDate` | `string` | **Yes** | ISO 8601 Date format (`YYYY-MM-DD`) | Departure / start date of the trip. |
| `endDate` | `string` | **Yes** | ISO 8601 Date format (`YYYY-MM-DD`), $\ge$ `startDate` | Return / end date of the trip. Total days must be between 1 and 14 days. |
| `travelers` | `integer` | **Yes** | Min: `1`, Max: `12` | Total number of individuals in the traveling group. |
| `budgetInr` | `number` | **Yes** | Min: `1,000`, Max: `10,000,000` | Total group budget in Indian Rupees (INR). |
| `interests` | `array<string>` | **Yes** | Max 8 items | Primary interests (e.g., `["history", "architecture", "food"]`). |
| `activityPreferences` | `array<string>` | **Yes** | Max 8 items | Preferred activity styles (e.g., `["walking", "cultural sites", "markets"]`). |
| `pace` | `string` | **Yes** | Enum: `'relaxed'` \| `'balanced'` \| `'packed'` | Daily itinerary density and activity frequency. |
| `notes` | `string` | No | Max 500 characters | Specific traveler instructions or accessibility preferences. |

---

## 2. Realistic Sample Request

```json
{
  "destinationId": "jaipur",
  "origin": "New Delhi",
  "startDate": "2026-11-10",
  "endDate": "2026-11-13",
  "travelers": 2,
  "budgetInr": 45000,
  "interests": ["history", "architecture", "local crafts"],
  "activityPreferences": ["walking tours", "forts", "markets"],
  "pace": "balanced",
  "notes": "Prefer exploring hilltop forts in the cooler mornings."
}
```

---

## 3. Input Validation Errors

Invalid requests are rejected immediately with HTTP `400 Bad Request` and a structured error payload:

```json
{
  "code": "INVALID_TRIP_REQUEST",
  "error": "Check the destination, inclusive dates, group size, budget and preferences.",
  "setupInstruction": null
}
```

Examples of rejected inputs:
- `endDate` before `startDate` (e.g., start 2026-11-10, end 2026-11-08)
- Trip duration exceeding 14 days
- Unsupported destination ID
- Budget below ₹1,000 or above ₹10,000,000
- Group size $< 1$ or $> 12$
