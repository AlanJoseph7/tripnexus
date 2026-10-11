import {
  GetAgentsResponse,
  GetDemoScenariosResponse,
  GetDestinationsResponse,
} from "@workspace/api-zod";
import { z } from "zod";
import agentsJson from "../data/agents.json";
import destinationsJson from "../data/destinations.json";
import placesJson from "../data/places.json";
import scenariosJson from "../data/scenarios.json";
import weatherJson from "../data/weather.json";

export const AGENTS = GetAgentsResponse.parse(agentsJson);
export const DESTINATIONS = GetDestinationsResponse.parse(destinationsJson);
export const DEMO_SCENARIOS = GetDemoScenariosResponse.parse(scenariosJson);

export const PlaceSchema = z.object({
  id: z.string(),
  destinationId: z.string(),
  name: z.string(),
  category: z.string(),
  area: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  estimatedCostInr: z.number().int().nonnegative(),
  setting: z.enum(["indoor", "outdoor", "mixed"]),
  tags: z.array(z.string()),
});
export type Place = z.infer<typeof PlaceSchema>;
export const PLACES = z.array(PlaceSchema).parse(placesJson);

export const WeatherPatternSchema = z.object({
  destinationId: z.string(),
  wetMonths: z.array(z.number().int().min(1).max(12)),
  hotMonths: z.array(z.number().int().min(1).max(12)),
  coolMonths: z.array(z.number().int().min(1).max(12)),
  typicalMinC: z.number().int(),
  typicalMaxC: z.number().int(),
  wetRainChance: z.number().int().min(0).max(100),
  dryRainChance: z.number().int().min(0).max(100),
});
export type WeatherPattern = z.infer<typeof WeatherPatternSchema>;
export const WEATHER_PATTERNS = z.array(WeatherPatternSchema).parse(weatherJson);

export function findDestination(destinationId: string) {
  return DESTINATIONS.find((destination) => destination.id === destinationId);
}

export function findPlace(placeId: string) {
  return PLACES.find((place) => place.id === placeId);
}

export function placesForDestination(destinationId: string) {
  return PLACES.filter((place) => place.destinationId === destinationId);
}

export function weatherForDestination(destinationId: string) {
  return WEATHER_PATTERNS.find((pattern) => pattern.destinationId === destinationId);
}
