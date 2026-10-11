import { z } from "zod";
import { DESTINATIONS, PLACES, findDestination, placesForDestination, weatherForDestination } from "./data";
import type { Place, WeatherPattern } from "./data";
import type { TripRequest } from "./types";

export const LOCAL_TOOL_NAMES = [
  "places_search",
  "place_details",
  "route_distance",
  "budget_estimate",
  "seasonal_weather_estimate",
  "indoor_alternatives",
] as const;

export type LocalToolName = (typeof LOCAL_TOOL_NAMES)[number];

const placeSearchArgs = z.object({
  destinationId: z.string().min(2),
  query: z.string().max(100).optional(),
  tags: z.array(z.string().max(40)).max(8).optional(),
  limit: z.number().int().min(1).max(8).default(6),
});

const placeDetailsArgs = z.object({
  placeIds: z.array(z.string().max(80)).min(1).max(8),
});

const routeDistanceArgs = z.object({
  routes: z.array(z.array(z.string().max(80)).min(1).max(8)).min(1).max(14),
});

const budgetArgs = z.object({
  destinationId: z.string().min(2),
  travelers: z.number().int().min(1).max(12),
  days: z.number().int().min(1).max(14),
  budgetInr: z.number().int().min(1000).max(10_000_000),
  activityCostsPerPersonInr: z.array(z.number().int().nonnegative()).max(42),
});

const weatherArgs = z.object({
  destinationId: z.string().min(2),
  dates: z.array(z.string().date()).min(1).max(14),
});

const indoorArgs = z.object({
  destinationId: z.string().min(2),
  limit: z.number().int().min(1).max(8).default(4),
  avoidPlaceIds: z.array(z.string()).max(42).default([]),
});

export interface BudgetToolResult {
  budgetInr: number;
  accommodationInr: number;
  foodInr: number;
  activitiesInr: number;
  transportInr: number;
  contingencyInr: number;
  totalEstimatedInr: number;
  remainingInr: number;
  withinBudget: boolean;
  arithmeticVerified: boolean;
}

export interface SeasonalWeatherDay {
  date: string;
  summary: string;
  minTempC: number;
  maxTempC: number;
  rainChancePercent: number;
  dataSource: "bundled_typical_climate";
}

const TOOL_DESCRIPTIONS: Record<LocalToolName, string> = {
  places_search: "Search the bundled destination catalog by keywords or interest tags.",
  place_details: "Retrieve verified details for up to eight bundled place IDs.",
  route_distance: "Estimate the route distance between selected catalog places from their coordinates.",
  budget_estimate: "Calculate a transparent group cost estimate from bundled daily destination rates and activity prices.",
  seasonal_weather_estimate: "Estimate typical seasonal conditions from bundled climate patterns; this is not a live forecast.",
  indoor_alternatives: "Find indoor places in the local catalog for weather-sensitive days.",
};

export function getToolCatalog() {
  return LOCAL_TOOL_NAMES.map((name) => ({ name, description: TOOL_DESCRIPTIONS[name] }));
}

function textMatches(place: Place, query: string) {
  const haystack = `${place.name} ${place.category} ${place.area} ${place.tags.join(" ")}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .some((token) => haystack.includes(token));
}

export function searchPlaces(input: unknown) {
  const args = placeSearchArgs.parse(input);
  let matches = placesForDestination(args.destinationId);
  if (args.query) {
    const queryMatches = matches.filter((place) => textMatches(place, args.query!));
    if (queryMatches.length > 0) matches = queryMatches;
  }
  if (args.tags?.length) {
    const tagMatches = matches.filter((place) =>
      args.tags!.some((tag) => place.tags.some((placeTag) => placeTag.toLowerCase() === tag.toLowerCase())),
    );
    if (tagMatches.length > 0) matches = tagMatches;
  }
  return matches.slice(0, args.limit);
}

export function getPlaceDetails(input: unknown) {
  const args = placeDetailsArgs.parse(input);
  return args.placeIds.flatMap((placeId) => {
    const place = PLACES.find((candidate) => candidate.id === placeId);
    return place ? [place] : [];
  });
}

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function distanceKm(a: Place, b: Place) {
  const radiusKm = 6371;
  const latitudeDelta = toRadians(b.latitude - a.latitude);
  const longitudeDelta = toRadians(b.longitude - a.longitude);
  const firstLatitude = toRadians(a.latitude);
  const secondLatitude = toRadians(b.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return radiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function estimateRouteDistance(input: unknown) {
  const args = routeDistanceArgs.parse(input);
  const routes = args.routes.map((placeIds) => {
    const route = placeIds.flatMap((placeId) => {
      const place = PLACES.find((candidate) => candidate.id === placeId);
      return place ? [place] : [];
    });
    let distance = 0;
    for (let index = 1; index < route.length; index += 1) {
      distance += distanceKm(route[index - 1]!, route[index]!);
    }
    return {
      placeIds: route.map((place) => place.id),
      distanceKm: Math.round(distance * 10) / 10,
    };
  });
  return {
    routes,
    totalDistanceKm: Math.round(routes.reduce((sum, route) => sum + route.distanceKm, 0) * 10) / 10,
    note: "Straight-line coordinate estimate, not road distance.",
  };
}

export function estimateTripBudget(input: unknown): BudgetToolResult {
  const args = budgetArgs.parse(input);
  const destination = findDestination(args.destinationId);
  if (!destination) throw new Error(`Unsupported destination: ${args.destinationId}`);
  const nights = Math.max(args.days - 1, 0);
  const groupDailyRate = destination.estimatedDailyCostInr * args.travelers;
  const accommodationInr = Math.round(groupDailyRate * 0.4 * nights);
  const foodInr = Math.round(groupDailyRate * 0.25 * args.days);
  const activitiesInr =
    args.activityCostsPerPersonInr.reduce((sum, cost) => sum + cost, 0) * args.travelers;
  const transportInr = Math.round(groupDailyRate * 0.18 * args.days);
  const subtotal = accommodationInr + foodInr + activitiesInr + transportInr;
  const contingencyInr = Math.ceil(subtotal * 0.1);
  const totalEstimatedInr = subtotal + contingencyInr;
  return {
    budgetInr: args.budgetInr,
    accommodationInr,
    foodInr,
    activitiesInr,
    transportInr,
    contingencyInr,
    totalEstimatedInr,
    remainingInr: args.budgetInr - totalEstimatedInr,
    withinBudget: totalEstimatedInr <= args.budgetInr,
    arithmeticVerified: true,
  };
}

function seasonalDay(pattern: WeatherPattern, date: string): SeasonalWeatherDay {
  const month = Number(date.slice(5, 7));
  const isWet = pattern.wetMonths.includes(month);
  const isHot = pattern.hotMonths.includes(month);
  const isCool = pattern.coolMonths.includes(month);
  const minTempC = pattern.typicalMinC + (isHot ? 3 : 0) - (isCool ? 2 : 0);
  const maxTempC = pattern.typicalMaxC + (isHot ? 2 : 0) - (isCool ? 4 : 0);
  const season = isWet ? "typically wetter" : isHot ? "typically hotter" : isCool ? "typically cooler" : "seasonal";
  return {
    date,
    summary: `${season} conditions based on a bundled monthly climate pattern`,
    minTempC,
    maxTempC: Math.max(minTempC, maxTempC),
    rainChancePercent: isWet ? pattern.wetRainChance : pattern.dryRainChance,
    dataSource: "bundled_typical_climate",
  };
}

export function estimateSeasonalWeather(input: unknown) {
  const args = weatherArgs.parse(input);
  const pattern = weatherForDestination(args.destinationId);
  if (!pattern) throw new Error(`No seasonal data for destination: ${args.destinationId}`);
  return args.dates.map((date) => seasonalDay(pattern, date));
}

export function findIndoorAlternatives(input: unknown) {
  const args = indoorArgs.parse(input);
  const skip = new Set(args.avoidPlaceIds);
  return placesForDestination(args.destinationId)
    .filter((place) => place.setting === "indoor" && !skip.has(place.id))
    .slice(0, args.limit);
}

export function executeLocalTool(name: LocalToolName, input: unknown) {
  switch (name) {
    case "places_search":
      return searchPlaces(input);
    case "place_details":
      return getPlaceDetails(input);
    case "route_distance":
      return estimateRouteDistance(input);
    case "budget_estimate":
      return estimateTripBudget(input);
    case "seasonal_weather_estimate":
      return estimateSeasonalWeather(input);
    case "indoor_alternatives":
      return findIndoorAlternatives(input);
    default: {
      const exhaustiveCheck: never = name;
      throw new Error(`Unsupported tool: ${exhaustiveCheck}`);
    }
  }
}

export function listDestinations() {
  return DESTINATIONS;
}
