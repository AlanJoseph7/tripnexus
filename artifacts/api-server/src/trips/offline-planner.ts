import { GetPlanningRunResponse, PlanTripBody } from "@workspace/api-zod";
import { placesForDestination } from "./data";
import { estimateSeasonalWeather, estimateTripBudget } from "./tools";
import { RunTrace } from "./trace";
import type { TripPlanResult, TripRequest } from "./types";
import type { Place } from "./data";

const DAY_MS = 24 * 60 * 60 * 1000;

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function haversineKm(a: Place, b: Place) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(b.latitude - a.latitude);
  const longitudeDelta = radians(b.longitude - a.longitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(a.latitude))
      * Math.cos(radians(b.latitude))
      * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function preferenceScore(place: Place, preferences: string[]) {
  const text = [place.name, place.category, place.area, ...place.tags]
    .join(" ")
    .toLowerCase();
  return preferences.reduce((score, preference) => {
    const normalized = preference.trim().toLowerCase();
    return normalized && text.includes(normalized) ? score + 1 : score;
  }, 0);
}

function dateRange(request: TripRequest) {
  const start = Date.UTC(
    request.startDate.getUTCFullYear(),
    request.startDate.getUTCMonth(),
    request.startDate.getUTCDate(),
  );
  const end = Date.UTC(
    request.endDate.getUTCFullYear(),
    request.endDate.getUTCMonth(),
    request.endDate.getUTCDate(),
  );
  const dayCount = Math.floor((end - start) / DAY_MS) + 1;
  if (dayCount < 1 || dayCount > 14) {
    throw new Error("The local demo planner supports inclusive trips of 1–14 days.");
  }
  return Array.from({ length: dayCount }, (_, index) =>
    new Date(start + index * DAY_MS),
  );
}

export function createOfflineTripPlan(
  rawRequest: unknown,
  runId: string,
  fallbackCode: string,
): TripPlanResult {
  const request = PlanTripBody.parse(rawRequest);
  const dates = dateRange(request);
  const places = placesForDestination(request.destinationId);
  if (!places.length) {
    throw new Error(`No bundled place data is available for ${request.destinationId}.`);
  }

  const preferences = [...request.interests, ...request.activityPreferences];
  const scoreById = new Map(
    places.map((place) => [place.id, preferenceScore(place, preferences)]),
  );
  const useCountById = new Map<string, number>();
  const activitiesPerDay = request.pace === "relaxed" ? 1 : 2;
  const itinerary = dates.map((date, dayIndex) => {
    const selectedPlaces: Place[] = [];
    for (let slot = 0; slot < activitiesPerDay; slot += 1) {
      const next = [...places]
        .filter((place) => !selectedPlaces.some((selected) => selected.id === place.id))
        .sort((a, b) =>
          (useCountById.get(a.id) ?? 0) - (useCountById.get(b.id) ?? 0)
          || (scoreById.get(b.id) ?? 0) - (scoreById.get(a.id) ?? 0)
          || a.estimatedCostInr - b.estimatedCostInr
          || a.id.localeCompare(b.id),
        )[0];
      if (!next) break;
      selectedPlaces.push(next);
      useCountById.set(next.id, (useCountById.get(next.id) ?? 0) + 1);
    }

    const activities = selectedPlaces.map((place, index) => {
      const matchedPreference = preferences.find((preference) =>
        [place.name, place.category, place.area, ...place.tags]
          .join(" ")
          .toLowerCase()
          .includes(preference.trim().toLowerCase()),
      );
      return {
        placeId: place.id,
        name: place.name,
        category: place.category,
        startTime: index === 0 ? "09:30" : "14:00",
        durationMinutes: 90,
        estimatedCostInr: place.estimatedCostInr,
        setting: place.setting,
        area: place.area,
        rationale: matchedPreference
          ? `Selected from the bundled catalogue to match your ${matchedPreference} preference. Check current access and opening hours before visiting.`
          : `Selected from the bundled local catalogue. Check current access and opening hours before visiting.`,
      };
    });
    const distance = selectedPlaces.slice(1).reduce(
      (total, place, index) => total + haversineKm(selectedPlaces[index]!, place),
      0,
    );
    const leadActivity = activities[0]!;
    return {
      dayNumber: dayIndex + 1,
      date,
      theme: `${leadActivity.category} in ${leadActivity.area}`,
      activities,
      routeDistanceKm: Number(distance.toFixed(1)),
    };
  });

  const budget = estimateTripBudget({
    destinationId: request.destinationId,
    travelers: request.travelers,
    days: dates.length,
    budgetInr: request.budgetInr,
    activityCostsPerPersonInr: itinerary.flatMap((day) =>
      day.activities.map((activity) => activity.estimatedCostInr),
    ),
  });
  const budgetAssessment = {
    budgetInr: budget.budgetInr,
    accommodationInr: budget.accommodationInr,
    foodInr: budget.foodInr,
    activitiesInr: budget.activitiesInr,
    transportInr: budget.transportInr,
    contingencyInr: budget.contingencyInr,
    totalEstimatedInr: budget.totalEstimatedInr,
    remainingInr: budget.remainingInr,
    withinBudget: budget.withinBudget,
    explanation: budget.withinBudget
      ? "Bundled local cost estimates fit within the requested budget. Confirm current rates before booking."
      : "Bundled local cost estimates exceed the requested budget. Adjust the plan and confirm current rates before booking.",
  };

  const itineraryByDate = new Map(
    itinerary.map((day) => [dateOnly(day.date), day]),
  );
  const weatherAssessment = estimateSeasonalWeather({
    destinationId: request.destinationId,
    dates: dates.map(dateOnly),
  }).map((climateDay) => {
    const day = itineraryByDate.get(climateDay.date);
    const affectedActivities = climateDay.rainChancePercent >= 50
      ? (day?.activities ?? [])
        .filter((activity) => activity.setting === "outdoor")
        .map((activity) => activity.name)
      : [];
    const recommendation = climateDay.rainChancePercent >= 50
      ? `Typical monthly rain chance is ${climateDay.rainChancePercent}%; keep outdoor plans flexible and carry rain protection. Check a current forecast before departure.`
      : `Typical temperatures range from ${climateDay.minTempC}°C to ${climateDay.maxTempC}°C. Check a current forecast before departure.`;
    return {
      date: new Date(`${climateDay.date}T00:00:00.000Z`),
      summary: `${climateDay.summary}. Bundled typical-climate estimate; not a live forecast.`,
      minTempC: climateDay.minTempC,
      maxTempC: climateDay.maxTempC,
      rainChancePercent: climateDay.rainChancePercent,
      affectedActivities,
      recommendation: `${recommendation} No live forecast was queried.`,
    };
  });

  const trace = new RunTrace(runId);
  trace.event({
    agentId: "trip_manager",
    eventType: "offline_fallback",
    action: "use_bundled_data",
    summary: `Live Groq planning was unavailable (${fallbackCode}). A deterministic itinerary was built from bundled local data; no AI critic ran.`,
  });
  trace.event({
    agentId: "trip_manager",
    eventType: "local_estimate",
    action: "estimate_budget_and_seasonal_climate",
    summary: "Budget and typical-climate estimates came from bundled data, not live prices or a weather forecast.",
  });

  const fallbackNotice = `Live Groq planning was unavailable (${fallbackCode}). This deterministic demo plan uses bundled destination data only; it has no AI review, live prices, availability checks, or live forecast.`;
  const response = GetPlanningRunResponse.parse({
    runId,
    status: "completed",
    result: {
      runId,
      status: "needs_attention",
      mode: "offline_fallback",
      fallbackNotice,
      model: "bundled-offline-planner",
      request,
      itinerary,
      budgetAssessment,
      weatherAssessment,
      criticReports: [],
      messages: [],
      executionTrace: trace.events,
      agentsUsed: [],
      revisionCount: 0,
    },
    error: null,
  });
  if (!response.result) throw new Error("The offline planner returned no result.");
  return response.result;
}
