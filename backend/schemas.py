"""
TripNexus shared data contract  (backend/schemas.py)

RULES FOR THE TEAM
1. Every agent takes typed models in and returns typed models out. No free-text handoffs.
2. Any change to this file needs a PR approved by all 3 people.
3. All money is in INR (rupees) unless a field says otherwise.
4. Activity costs are PER PERSON. Budget code multiplies by travelers.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from enum import Enum
from typing import Any, Optional, TypedDict

from pydantic import BaseModel, Field, computed_field, model_validator


# --------------------------------------------------------------------------- #
# Enums and constants
# --------------------------------------------------------------------------- #
class Pace(str, Enum):
    RELAXED = "relaxed"
    MODERATE = "moderate"
    PACKED = "packed"


# Max activities per day the Critic allows for each pace
PACE_LIMITS: dict[Pace, int] = {
    Pace.RELAXED: 3,
    Pace.MODERATE: 4,
    Pace.PACKED: 6,
}

# A day is "risky" if rain probability (0-100) is at or above this
RAIN_RISK_THRESHOLD = 60

MAX_CRITIC_LOOPS = 3


class Category(str, Enum):
    BEACH = "beach"
    FOOD = "food"
    NIGHTLIFE = "nightlife"
    SIGHTSEEING = "sightseeing"
    CULTURE = "culture"
    ADVENTURE = "adventure"
    SHOPPING = "shopping"
    OTHER = "other"


class TimeSlot(str, Enum):
    MORNING = "morning"
    AFTERNOON = "afternoon"
    EVENING = "evening"
    NIGHT = "night"


class IssueType(str, Enum):
    OVER_BUDGET = "over_budget"
    TOO_PACKED = "too_packed"
    WEATHER_CONFLICT = "weather_conflict"
    TRAVEL_INFEASIBLE = "travel_infeasible"
    PREFERENCE_MISMATCH = "preference_mismatch"
    MISSING_DATA = "missing_data"
    OTHER = "other"


class Severity(str, Enum):
    ERROR = "error"      # must fix, plan fails the critic
    WARNING = "warning"  # nice to fix, does not fail the plan


# --------------------------------------------------------------------------- #
# 1. Trip Manager: parsed user request
# --------------------------------------------------------------------------- #
class TripRequest(BaseModel):
    """Structured version of e.g. 'Plan a 5-day Goa trip for 4 under Rs 50,000...'"""

    raw_text: str = Field(description="Original user message, unchanged")
    destination: str
    origin: Optional[str] = Field(default=None, description="Where the group travels from")
    days: int = Field(ge=1, le=14)
    travelers: int = Field(ge=1, le=20)
    total_budget: float = Field(gt=0, description="Total group budget in INR")
    interests: list[str] = Field(default_factory=list, examples=[["beaches", "food", "nightlife"]])
    pace: Pace = Pace.MODERATE
    start_date: Optional[date] = None


# --------------------------------------------------------------------------- #
# 2. Destination Agent
# --------------------------------------------------------------------------- #
class Activity(BaseModel):
    id: str = Field(description="Stable unique id, e.g. 'baga-beach'")
    name: str
    area: str = Field(description="Geographic cluster, e.g. 'North Goa'")
    category: Category
    est_cost_per_person: float = Field(ge=0, default=0)
    duration_hours: float = Field(gt=0, default=2)
    outdoor: bool = Field(description="True if weather-sensitive")
    best_time: Optional[TimeSlot] = None
    notes: Optional[str] = None


class DestinationResult(BaseModel):
    destination: str
    activities: list[Activity]

    @computed_field  # type: ignore[prop-decorator]
    @property
    def areas(self) -> list[str]:
        return sorted({a.area for a in self.activities})


# --------------------------------------------------------------------------- #
# 3. Budget Agent
# --------------------------------------------------------------------------- #
class BudgetBreakdown(BaseModel):
    """Totals are computed in code, never by the LLM."""

    accommodation: float = Field(ge=0)
    transport: float = Field(ge=0)
    food: float = Field(ge=0)
    activities: float = Field(ge=0)
    budget_limit: float = Field(gt=0)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def total(self) -> float:
        return self.accommodation + self.transport + self.food + self.activities

    @computed_field  # type: ignore[prop-decorator]
    @property
    def within_budget(self) -> bool:
        return self.total <= self.budget_limit

    @computed_field  # type: ignore[prop-decorator]
    @property
    def remaining(self) -> float:
        return self.budget_limit - self.total


# --------------------------------------------------------------------------- #
# 4. Weather Agent
# --------------------------------------------------------------------------- #
class DayWeather(BaseModel):
    day_number: int = Field(ge=1)
    date: Optional[date] = None
    condition: str = Field(description="e.g. 'Heavy rain', 'Sunny'")
    rain_probability: float = Field(ge=0, le=100)
    temp_max_c: Optional[float] = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def risky(self) -> bool:
        return self.rain_probability >= RAIN_RISK_THRESHOLD


class WeatherReport(BaseModel):
    days: list[DayWeather]
    # Filled by Weather Agent: {day_number: [activity_id, ...]} of outdoor items to move
    flagged_activities: dict[int, list[str]] = Field(default_factory=dict)

    @property
    def risky_days(self) -> list[int]:
        return [d.day_number for d in self.days if d.risky]


# --------------------------------------------------------------------------- #
# 5. Itinerary (built by Trip Manager)
# --------------------------------------------------------------------------- #
class ItineraryItem(BaseModel):
    activity_id: str
    name: str
    area: str
    slot: TimeSlot
    outdoor: bool
    est_cost_total: float = Field(ge=0, description="Cost for the whole group")


class ItineraryDay(BaseModel):
    day_number: int = Field(ge=1)
    theme: Optional[str] = Field(default=None, description="e.g. 'North Goa beaches'")
    items: list[ItineraryItem] = Field(default_factory=list)
    weather_note: Optional[str] = None


class Itinerary(BaseModel):
    request: TripRequest
    days: list[ItineraryDay]
    budget: BudgetBreakdown
    version: int = Field(default=1, ge=1, description="Increments on every revision")

    @model_validator(mode="after")
    def _day_count_matches(self) -> "Itinerary":
        if len(self.days) != self.request.days:
            raise ValueError(
                f"Itinerary has {len(self.days)} days but request asked for {self.request.days}"
            )
        return self


# --------------------------------------------------------------------------- #
# 6. Critic Agent
# --------------------------------------------------------------------------- #
class CritiqueIssue(BaseModel):
    type: IssueType
    severity: Severity = Severity.ERROR
    message: str
    day_number: Optional[int] = None


class CritiqueResult(BaseModel):
    issues: list[CritiqueIssue] = Field(default_factory=list)
    suggestions: list[str] = Field(default_factory=list)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def passed(self) -> bool:
        return not any(i.severity == Severity.ERROR for i in self.issues)


# --------------------------------------------------------------------------- #
# 7. Streaming events (backend SSE -> frontend activity panel)
# --------------------------------------------------------------------------- #
class AgentName(str, Enum):
    MANAGER = "trip_manager"
    DESTINATION = "destination"
    BUDGET = "budget"
    WEATHER = "weather"
    CRITIC = "critic"


class AgentStatus(str, Enum):
    STARTED = "started"
    DONE = "done"
    FAILED = "failed"
    RETRY = "retry"  # critic sent the plan back


class AgentEvent(BaseModel):
    """One SSE message. Frontend renders these in the live activity panel."""

    agent: AgentName
    status: AgentStatus
    message: str
    data: Optional[dict[str, Any]] = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# --------------------------------------------------------------------------- #
# 8. LangGraph shared state
# --------------------------------------------------------------------------- #
class TripState(TypedDict, total=False):
    """Passed between LangGraph nodes. Each node returns only the keys it updates."""

    user_input: str
    request: TripRequest
    destination_result: DestinationResult
    budget: BudgetBreakdown
    weather: WeatherReport
    itinerary: Itinerary
    critique: CritiqueResult
    loop_count: int
    events: list[AgentEvent]
