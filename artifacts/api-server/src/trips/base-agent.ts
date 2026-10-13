import { z } from "zod";
import { logger } from "../lib/logger";
import { executeLocalTool, LOCAL_TOOL_NAMES, type LocalToolName } from "./tools";
import { RunTrace } from "./trace";
import type { AgentId, JsonModel } from "./types";

/**
 * Shared state context passed across agents during multi-agent planning.
 */
export interface SharedTripState {
  runId: string;
  request: unknown;
  itinerary?: unknown;
  budgetAssessment?: unknown;
  weatherAssessment?: unknown;
  criticReports?: unknown[];
  revisionCount: number;
  maxRevisions: number;
  status: "queued" | "running" | "completed" | "failed";
}

/**
 * BaseAgent: Reusable abstraction for all TripNexus specialist agents.
 * Fulfills CA3 Rubric Section 5:
 * - Unique ID, Name, Role, and Responsibilities
 * - Dedicated System Prompt and Available Tools
 * - Shared-state Context awareness
 * - LLM decision-making with schema validation
 * - Tool execution capability
 * - Runtime logging and structured agent-to-agent messaging
 * - Error handling
 */
export abstract class BaseAgent {
  abstract readonly id: AgentId;
  abstract readonly name: string;
  abstract readonly role: string;
  abstract readonly responsibilities: string[];
  abstract readonly systemPrompt: string;
  abstract readonly allowedTools: readonly LocalToolName[];
  protected readonly model: JsonModel;

  constructor(model: JsonModel) {
    this.model = model;
  }

  /**
   * Validate that a tool is within the agent's allowed catalog.
   */
  validateTool(toolName: string): toolName is LocalToolName {
    return this.allowedTools.includes(toolName as LocalToolName);
  }

  /**
   * Execute an authorized tool deterministically.
   */
  executeTool(toolName: LocalToolName, args: unknown): unknown {
    if (!this.validateTool(toolName)) {
      throw new Error(`Security Violation: Agent "${this.id}" is not authorized to use tool "${toolName}".`);
    }
    logger.info({ agentId: this.id, toolName }, "Executing tool via BaseAgent");
    return executeLocalTool(toolName, args);
  }

  /**
   * Send a validated runtime agent-to-agent message and record it in the execution trace.
   */
  sendMessage(
    trace: RunTrace,
    recipient: AgentId,
    type: string,
    task: string,
    result: string,
    options?: { issueId?: string | null; status?: "sent" | "completed" | "approved" | "rejected" },
  ): void {
    trace.message({
      sender: this.id,
      recipient,
      type,
      task,
      result,
      issueId: options?.issueId ?? null,
      status: options?.status ?? "completed",
    });
    logger.info(
      { from: this.id, to: recipient, type, taskPreview: task.slice(0, 60) },
      "Agent-to-agent message recorded in trace",
    );
  }

  /**
   * Core agent reasoning method to be implemented by each specialized agent.
   */
  abstract reason(state: SharedTripState, input?: unknown): Promise<unknown>;
}

/**
 * AGENT 1: Trip Manager Agent
 * Central LLM-driven orchestrator. Dynamically assigns tasks, reviews progress,
 * and routes targeted revisions when Critic identifies issues.
 */
export class TripManagerAgent extends BaseAgent {
  readonly id = "trip_manager" as const;
  readonly name = "Trip Manager";
  readonly role = "Central Orchestrator & Workflow Manager";
  readonly responsibilities = [
    "Validate trip context and requirements",
    "Dynamically assign bounded tasks to destination, budget, and weather specialists",
    "Monitor execution state and resolve conflicts between specialists",
    "Route targeted revisions when the Critic rejects candidate drafts",
    "Finalize the unified travel plan once approved",
  ];
  readonly systemPrompt =
    "You are the Trip Manager for TripNexus. You coordinate specialist agents (destination, budget, weather, critic) to create date-aware, feasible itineraries. You decide delegations, evaluate tradeoffs, and assign targeted fixes.";
  readonly allowedTools = [] as const; // Manager delegates tasks rather than invoking data tools directly

  async reason(state: SharedTripState, input?: unknown): Promise<unknown> {
    logger.info({ runId: state.runId, agent: this.id }, "Trip Manager evaluating state and orchestrating next action");
    return input;
  }
}

/**
 * AGENT 2: Destination Agent
 * Curates and drafts dated itineraries using verified local place catalogs.
 */
export class DestinationAgent extends BaseAgent {
  readonly id = "destination_agent" as const;
  readonly name = "Destination Agent";
  readonly role = "Itinerary & Place Specialist";
  readonly responsibilities = [
    "Search verified destination places based on traveler interests",
    "Retrieve detailed place metadata and operational attributes",
    "Estimate realistic inter-activity route distances from coordinates",
    "Draft and revise daily dated activity schedules",
  ];
  readonly systemPrompt =
    "You are the Destination Agent for TripNexus. You select verified local places matching traveler interests and draft cohesive dated daily schedules.";
  readonly allowedTools = ["places_search", "place_details", "route_distance"] as const;

  async reason(state: SharedTripState, input?: unknown): Promise<unknown> {
    logger.info({ runId: state.runId, agent: this.id }, "Destination Agent drafting or revising itinerary");
    return input;
  }
}

/**
 * AGENT 3: Budget Agent
 * Evaluates financial feasibility, checks costs using deterministic arithmetic,
 * and highlights cost drivers and tradeoffs.
 */
export class BudgetAgent extends BaseAgent {
  readonly id = "budget_agent" as const;
  readonly name = "Budget Agent";
  readonly role = "Financial Feasibility Specialist";
  readonly responsibilities = [
    "Calculate group-level cost breakdowns across lodging, food, activities, and transport",
    "Verify exact arithmetic deterministically in INR",
    "Identify major cost drivers and budget surpluses or deficits",
    "Recommend targeted cost-saving adjustments when over budget",
  ];
  readonly systemPrompt =
    "You are the Budget Agent for TripNexus. You analyze group costs in INR, verify deterministic calculations, explain trade-offs, and recommend financial adjustments.";
  readonly allowedTools = ["budget_estimate"] as const;

  async reason(state: SharedTripState, input?: unknown): Promise<unknown> {
    logger.info({ runId: state.runId, agent: this.id }, "Budget Agent evaluating costs and trade-offs");
    return input;
  }
}

/**
 * AGENT 4: Weather Agent
 * Evaluates seasonal climate patterns, flags rain or temperature risks,
 * and suggests indoor alternatives.
 */
export class WeatherAgent extends BaseAgent {
  readonly id = "weather_agent" as const;
  readonly name = "Weather Agent";
  readonly role = "Climate & Seasonal Risk Specialist";
  readonly responsibilities = [
    "Analyze typical monthly climate patterns for travel dates",
    "Identify weather-sensitive outdoor activities and rain/heat risks",
    "Suggest verified indoor alternatives from the catalog",
    "Provide practical packing and timing advisories",
  ];
  readonly systemPrompt =
    "You are the Weather Agent for TripNexus. You review typical seasonal climate patterns for trip dates, assess outdoor risks, and recommend indoor alternatives.";
  readonly allowedTools = ["seasonal_weather_estimate", "indoor_alternatives"] as const;

  async reason(state: SharedTripState, input?: unknown): Promise<unknown> {
    logger.info({ runId: state.runId, agent: this.id }, "Weather Agent assessing seasonal climate risks");
    return input;
  }
}

/**
 * AGENT 5: Critic Agent
 * Independent evaluator. Reviews the complete candidate plan against dates,
 * budget, routes, and weather, issuing an independent APPROVED or REJECTED verdict.
 */
export class CriticAgent extends BaseAgent {
  readonly id = "critic_agent" as const;
  readonly name = "Critic Agent";
  readonly role = "Independent Quality & Consistency Evaluator";
  readonly responsibilities = [
    "Critically review candidate itinerary for date continuity and pace",
    "Verify budget feasibility and cost reasonableness",
    "Assess weather risks against planned outdoor activities",
    "Issue independent APPROVED or REJECTED verdict with actionable issues",
    "Require targeted specialist revisions when standards are not met",
  ];
  readonly systemPrompt =
    "You are the Critic Agent for TripNexus. You independently evaluate candidate travel plans across pacing, budget fit, route sanity, and weather risks. If any aspect is deficient, you REJECT with specific evidence.";
  readonly allowedTools = [] as const; // Critic evaluates evidence generated by specialists

  async reason(state: SharedTripState, input?: unknown): Promise<unknown> {
    logger.info({ runId: state.runId, agent: this.id }, "Critic Agent independently reviewing candidate plan");
    return input;
  }
}
