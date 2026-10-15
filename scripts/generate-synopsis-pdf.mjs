import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const SYNOPSIS_TEXT = `================================================================================
                    TRIPNEXUS: AUTONOMOUS MULTI-AGENT
                COLLABORATIVE TRAVEL PLANNING SYSTEM
================================================================================
Document Type   : Academic & Technical Project Synopsis
Project Version : 2.4.0 (Production Release)
System Status   : Live on Vercel & Production Ready
Date            : October 2026
Repository      : https://github.com/AlanJoseph7/tripnexus

--------------------------------------------------------------------------------
1. PROJECT TITLE & DOMAIN
--------------------------------------------------------------------------------
Project Title   : TripNexus - Constraint-Aware Multi-Agent Travel Planner
Domain          : Artificial Intelligence, Distributed Multi-Agent Systems (MAS),
                  Full-Stack Web Engineering
Core Focus      : Autonomous Agent Coordination, Closed-Loop Evaluator Pattern,
                  Deterministic Tool Calculations, LLM Rate-Limit Resilience.

--------------------------------------------------------------------------------
2. ABSTRACT & EXECUTIVE SUMMARY
--------------------------------------------------------------------------------
Modern consumer travel planning is an intricate multi-criteria optimization
problem. Travelers must reconcile heterogeneous constraints: personal interests,
calendar dates, geographic proximity, strict group budgets in INR, and seasonal
climate risks.

Single-prompt Large Language Model (LLM) interfaces fail consistently in this
domain due to four foundational flaws:
  1. Hallucinated destinations, non-existent venues, and fabricated pricing.
  2. Severe arithmetic errors when computing multi-day multi-traveler budgets.
  3. Context drift and inability to maintain strict chronological continuity.
  4. Complete absence of self-critique, verification, and adaptive replanning.

TripNexus solves these deficiencies by introducing an autonomous, distributed
multi-agent collaborative architecture. Built with TypeScript, Node.js, React 19,
and Groq Cloud LPU inference, TripNexus distributes travel planning across five
autonomous specialized agents. The system enforces strict separation between
non-deterministic LLM reasoning and deterministic mathematical computation,
incorporates an adversarial Critic Agent with closed-loop revision cycles, and
features an enterprise-grade resilient infrastructure with multi-key rotation,
multi-model failover, and zero-crash offline fallback mechanisms.

--------------------------------------------------------------------------------
3. PROBLEM STATEMENT & OBJECTIVES
--------------------------------------------------------------------------------
Problem Statement:
Current online travel portals either rely on rigid, pre-packaged tour templates
or leave travelers to manually cross-reference map directions, seasonal weather
forecasts, and cost spreadsheets. Conversely, generic generative AI tools generate
stylistically pleasing but operationally unfeasible itineraries with unrealistic
transit times, conflicting budgets, and overlooked monsoon or extreme heat seasons.

Project Objectives:
  * Autonomous Role Decomposition: Segment complex trip planning into bounded,
    single-responsibility agent roles (Manager, Destination, Budget, Weather, Critic).
  * Strict Schema Enforcement: Guarantee 100% valid JSON responses using Zod
    runtime validation and Groq strict JSON-schema decoding.
  * Deterministic Arithmetic Integrity: Compute all distance calculations
    (Haversine trigonometric formulas) and budget summations strictly in TypeScript
    to prevent LLM hallucination.
  * Closed-Loop Adversarial Critique: Deploy an independent Critic Agent capable
    of rejecting inadequate drafts and commanding targeted agent revisions.
  * Production-Grade Resilience: Implement dynamic multi-model failover, 404 model
    pruning, round-robin multi-key pooling, and guaranteed offline fallback.
  * Transparent Auditability: Record every inter-agent message, tool call, latency,
    and decision in a monotonic execution trace exportable in JSON format.

--------------------------------------------------------------------------------
4. SYSTEM ARCHITECTURE & AUTONOMOUS AGENTS
--------------------------------------------------------------------------------
TripNexus orchestrates five specialized agents coordinated by a centralized
orchestrator and an immutable monotonic execution ledger:

1. Trip Manager Agent (trip_manager):
   * Serves as the executive planner and state supervisor.
   * Validates user inputs (dates, origin, destination, group size, budget, pace).
   * Deconstructs planning goals into structured assignments for specialists.
   * Intercepts Critic rejections, increments revision counters, and dispatches
     targeted revision tickets to responsible agents (bounded at 3 cycles).

2. Destination Specialist Agent (destination_agent):
   * Selects points of interest strictly from a verified 11-city catalog.
   * Clusters activities geographically by city area to minimize travel fatigue.
   * Executes local tools (places_search, place_details, route_distance).
   * Computes straight-line distances using the Haversine trigonometric formula:
       d = 2 * R * asin(sqrt(sin^2(dLat/2) + cos(lat1)*cos(lat2)*sin^2(dLon/2)))

3. Budget Assessor Agent (budget_agent):
   * Operates on deterministic local calculations: accommodation, food, activities,
     local transit, and a 10% contingency reserve for the full traveler group.
   * Explains cost drivers, headroom, and financial trade-offs in clear text.
   * Never fabricates arithmetic; LLM reasoning is strictly explanatory.

4. Climate & Seasonality Specialist (weather_agent):
   * Queries verified historical climate records for the destination and month.
   * Computes rain probability, typical temperature ranges (Celsius), and season tags.
   * Flags high-risk outdoor activities (>= 50% rain probability) and suggests
     verified indoor alternatives from the destination catalog.

5. Independent Critic Agent (critic_agent):
   * Operates as an adversarial auditor evaluating the consolidated itinerary draft.
   * Evaluates four non-negotiable criteria:
       a) Date Continuity  : Validates sequential, unbroken day-by-day dates.
       b) Budget Compliance: Checks total estimated cost against target budget.
       c) Route Sanity     : Flags excessive intra-day straight-line transit (> 35 km).
       d) Weather Safety   : Detects unsheltered outdoor plans during heavy rain.
   * Issues either an explicit APPROVED verdict or a REJECTED status with
     actionable issue tickets specifying severity, responsible agent, and evidence.

--------------------------------------------------------------------------------
5. CLOSED-LOOP REPLANNING & CONFLICT RESOLUTION
--------------------------------------------------------------------------------
When the Critic Agent discovers a constraint violation:
  Step 1: Critic outputs decision: "REJECTED" with structured issue descriptions.
  Step 2: Trip Manager intercepts the rejection, increments revisionCount, and
          translates issues into a targeted revision prompt.
  Step 3: Responsible specialist (e.g., Destination or Budget Agent) re-executes,
          adjusting activities, substituting indoor venues, or rebalancing costs.
  Step 4: Revised itinerary draft is re-submitted to the Critic Agent for audit.
  Step 5: The loop terminates upon Critic APPROVAL or upon reaching the 3-cycle
          safety bound, preventing infinite loops and runaway API costs.
  Step 6: If minor warnings remain after 3 cycles, the itinerary is tagged with
          an amber "NEEDS ATTENTION" status badge so the traveler can review caveats.

--------------------------------------------------------------------------------
6. KEY TECHNICAL INNOVATIONS & RECENT RESILIENCE UPGRADES
--------------------------------------------------------------------------------
TripNexus introduces several state-of-the-art resilience capabilities:

A. Multi-Model Failover Pool:
   * Leverages Groq Cloud LPU acceleration with sub-second inference speeds.
   * Primary inference runs on openai/gpt-oss-120b.
   * Dynamic fallback cascade: openai/gpt-oss-120b -> qwen/qwen3.8-27b ->
     openai/gpt-oss-20b.

B. Dynamic 404 Model Pruning:
   * Automatically intercepts HTTP 404 ("model not available to this account")
     responses from provider endpoints.
   * Prunes unavailable models dynamically from the candidate pool during runtime,
     preventing redundant failed attempts and preserving true rate-limit attribution.

C. Multi-Key Round-Robin Rotation:
   * Auto-discovers and pools multiple Groq API keys (comma-separated or named
     variables like TripNexus2, TripNexus3, TripNexus4, TripNexus5).
   * Distributes load across all keys, multiplying free-tier capacity to
     120 RPM (Requests Per Minute) and 32,000 TPM (Tokens Per Minute).
   * Automatically switches keys upon encountering 429 rate limits or quota drops.

D. Stateless Serverless Trace Delivery:
   * In Vercel serverless functions, execution events are bundled directly into
     the primary plan result payload.
   * The client renders all 120+ execution trace events immediately, preventing
     secondary 404 race conditions common in stateless serverless environments.

E. Guaranteed Zero-Crash Offline Fallback:
   * If API credentials, rate limits, or network connectivity fail, TripNexus
     automatically generates a high-quality deterministic itinerary using bundled
     destination catalog data.
   * Clearly marked with an "Offline Fallback Plan" badge, ensuring 100% uptime.

--------------------------------------------------------------------------------
7. TECHNOLOGY STACK SPECIFICATIONS
--------------------------------------------------------------------------------
Frontend Architecture:
  * Framework      : React 19 (TypeScript, Strict Mode)
  * Build Tool     : Vite 7.3.6 with Rollup code-splitting
  * State & Query  : TanStack React Query v5 (automatic retries, cache management)
  * Styling        : Modern Vanilla CSS with HSL color design tokens & glassmorphism
  * Icons          : Lucide React
  * Routing        : Wouter lightweight router

Backend Architecture:
  * Runtime        : Node.js 24 LTS
  * Server         : Express 5 (ESM format)
  * Validation     : Zod Schema Validation on all inputs and outputs
  * Logging        : Pino high-performance structured JSON logging
  * PDF Engine     : Pure Node.js zero-dependency PDF-1.4 binary stream generator
  * Monorepo Tool  : PNPM Workspaces with TypeScript project references

AI & LLM Services:
  * Provider       : Groq Cloud LPU Ultra-Low Latency Inference
  * Primary Models : openai/gpt-oss-120b, qwen/qwen3.8-27b, openai/gpt-oss-20b
  * Output Mode    : Strict JSON Schema Decoding (temperature: 0.2, top_p: 0.95)

Deployment & Infrastructure:
  * Cloud Platform : Vercel Serverless Functions
  * Configuration  : vercel.json rewrites, ESBuild serverless bundle (api/app.mjs)
  * Continuous CI  : GitHub Actions / Vercel Git Integration

--------------------------------------------------------------------------------
8. VERIFICATION, TESTING & ACADEMIC EVALUATION
--------------------------------------------------------------------------------
* Automated Unit Test Suite: 23 passing Vitest unit tests verifying schema
  parsers, Haversine coordinate math, budget allocation, multi-key rotation,
  and offline fallback generators.
* End-to-End Live Validation: Validated live multi-agent trip plans across 11
  destinations with full critic revision loops.
* Academic Viva Alignment: Fulfills all seven CA3 assessment criteria:
    1. Multi-Agent Role Specialization
    2. Dynamic Task Allocation
    3. Monotonic Shared State & Execution Trace
    4. Deterministic Tool Execution & Arithmetic Separation
    5. Adversarial Critic & Closed-Loop Replanning
    6. Robust Error Categorization & Production Resilience
    7. Full System Documentation & Interactive Demonstration

--------------------------------------------------------------------------------
9. CONCLUSION & FUTURE SCOPE
--------------------------------------------------------------------------------
TripNexus proves that multi-agent AI systems, when paired with deterministic tool
validation and robust error handling, overcome the core limitations of single-prompt
LLMs. By combining sub-second Groq inference, adversarial critique, and multi-key
resilience, TripNexus sets a high benchmark for reliable agentic applications.

Future Scope:
  * Live Flight and Hotel GDS Integration via Amadeus / Sabre APIs.
  * Real-time meteorological satellite integration (Open-Meteo live API).
  * User authentication with encrypted personal travel history storage.
  * Multi-currency live forex exchange rate conversions.

================================================================================
                    END OF PROJECT SYNOPSIS DOCUMENT
================================================================================
`;

function escapePdf(text) {
  return text
    .replace(/[^\x20-\x7e]/g, "?")
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function wrap(text, width) {
  if (!text) return [""];
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (current && `${current} ${word}`.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function generatePdf(rawText) {
  const rawLines = rawText.split("\n");
  const lines = [];

  for (const line of rawLines) {
    if (line.length <= 96) {
      lines.push(line);
    } else {
      lines.push(...wrap(line, 96));
    }
  }

  const LINES_PER_PAGE = 52;
  const pages = [];
  for (let offset = 0; offset < lines.length; offset += LINES_PER_PAGE) {
    pages.push(lines.slice(offset, offset + LINES_PER_PAGE));
  }

  const objects = [];
  const pageObjectIds = pages.map((_, index) => 3 + index * 2);
  const fontObjectId = 3 + pages.length * 2;
  const boldFontObjectId = 4 + pages.length * 2;

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;

  pages.forEach((pageLines, pageIndex) => {
    const pageId = pageObjectIds[pageIndex];
    const streamId = pageId + 1;
    const pageNum = pageIndex + 1;
    const totalPages = pages.length;

    const contentLines = [];
    contentLines.push("BT");
    contentLines.push("/F1 9 Tf");
    contentLines.push("40 755 Td");

    pageLines.forEach((line) => {
      const isHeader = line.startsWith("===") || line.startsWith("---") || /^[0-9]\.\s+[A-Z\s&]+$/.test(line);
      contentLines.push(`(${escapePdf(line)}) Tj`);
      contentLines.push("0 -13.5 Td");
    });

    // Add footer
    contentLines.push("ET");
    contentLines.push("BT");
    contentLines.push("/F1 8 Tf");
    contentLines.push(`40 30 Td`);
    contentLines.push(`(TripNexus Project Synopsis | Page ${pageNum} of ${totalPages} | Confidential & Academic Evaluation) Tj`);
    contentLines.push("ET");

    const content = contentLines.join("\n");
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${fontObjectId} 0 R /F2 ${boldFontObjectId} 0 R >> >> /Contents ${streamId} 0 R >>`;
    objects[streamId] = `<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`;
  });

  objects[fontObjectId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>";
  objects[boldFontObjectId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>";

  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (let objectId = 1; objectId < objects.length; objectId += 1) {
    offsets[objectId] = Buffer.byteLength(output, "ascii");
    output += `${objectId} 0 obj\n${objects[objectId]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output, "ascii");
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let objectId = 1; objectId < objects.length; objectId += 1) {
    output += `${String(offsets[objectId]).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(output, "ascii");
}

const buffer = generatePdf(SYNOPSIS_TEXT);

const targetPdfPath1 = path.resolve(rootDir, "docs/TripNexus_Project_Synopsis.pdf");
const targetPdfPath2 = path.resolve(rootDir, "TripNexus_Project_Synopsis.pdf");
const targetMdPath = path.resolve(rootDir, "docs/synopsis.md");

fs.writeFileSync(targetPdfPath1, buffer);
fs.writeFileSync(targetPdfPath2, buffer);

console.log(`Generated PDF Synopsis: ${targetPdfPath1} (${buffer.length} bytes)`);
console.log(`Generated PDF Synopsis: ${targetPdfPath2} (${buffer.length} bytes)`);

// Export text as markdown to docs/synopsis.md as well
const markdownContent = `# TripNexus — Autonomous Multi-Agent Travel Planning System
## Project Synopsis (Up-to-Date Version 2.4.0)

**Document Type:** Academic & Technical Project Synopsis  
**Project Version:** 2.4.0 (Production Release)  
**System Status:** Live on Vercel & Production Ready  
**Repository:** [GitHub: AlanJoseph7/tripnexus](https://github.com/AlanJoseph7/tripnexus)  
**Downloadable PDF:** Available at [\`docs/TripNexus_Project_Synopsis.pdf\`](./TripNexus_Project_Synopsis.pdf) and via the live web application under \`Project documentation (PDF)\`.

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

1. **Trip Manager Agent (\`trip_manager\`):**
   * Serves as the executive planner and state supervisor.
   * Validates user inputs (dates, origin, destination, group size, budget, pace).
   * Deconstructs planning goals into structured assignments for specialists.
   * Intercepts Critic rejections, increments revision counters, and dispatches targeted revision tickets to responsible agents (bounded at 3 cycles).

2. **Destination Specialist Agent (\`destination_agent\`):**
   * Selects points of interest strictly from a verified 11-city catalog.
   * Clusters activities geographically by city area to minimize travel fatigue.
   * Executes local tools (\`places_search\`, \`place_details\`, \`route_distance\`).
   * Computes straight-line distances using the Haversine trigonometric formula:  
     $$d = 2 R \\arcsin\\left(\\sqrt{\\sin^2\\left(\\frac{\\Delta\\text{lat}}{2}\\right) + \\cos(\\text{lat}_1)\\cos(\\text{lat}_2)\\sin^2\\left(\\frac{\\Delta\\text{lon}}{2}\\right)}\\right)$$

3. **Budget Assessor Agent (\`budget_agent\`):**
   * Operates on deterministic local calculations: accommodation, food, activities, local transit, and a 10% contingency reserve for the full traveler group.
   * Explains cost drivers, headroom, and financial trade-offs in clear text.
   * Never fabricates arithmetic; LLM reasoning is strictly explanatory.

4. **Climate & Seasonality Specialist (\`weather_agent\`):**
   * Queries verified historical climate records for the destination and month.
   * Computes rain probability, typical temperature ranges (Celsius), and season tags.
   * Flags high-risk outdoor activities ($\\ge 50\\%$ rain probability) and suggests verified indoor alternatives from the destination catalog.

5. **Independent Critic Agent (\`critic_agent\`):**
   * Operates as an adversarial auditor evaluating the consolidated itinerary draft.
   * Evaluates four non-negotiable criteria:
     * **Date Continuity:** Validates sequential, unbroken day-by-day dates.
     * **Budget Compliance:** Checks total estimated cost against target budget.
     * **Route Sanity:** Flags excessive intra-day straight-line transit ($> 35\\text{ km}$).
     * **Weather Safety:** Detects unsheltered outdoor plans during heavy rain.
   * Issues either an explicit \`APPROVED\` verdict or a \`REJECTED\` status with actionable issue tickets specifying severity, responsible agent, and evidence.

---

### 5. Closed-Loop Replanning & Conflict Resolution
When the Critic Agent discovers a constraint violation:
1. **Rejection:** Critic outputs \`decision: "REJECTED"\` with structured issue descriptions.
2. **Orchestration:** Trip Manager intercepts the rejection, increments \`revisionCount\`, and translates issues into a targeted revision prompt.
3. **Targeted Revision:** Responsible specialist (e.g., Destination or Budget Agent) re-executes, adjusting activities, substituting indoor venues, or rebalancing costs.
4. **Re-Audit:** Revised itinerary draft is re-submitted to the Critic Agent for audit.
5. **Guaranteed Bounded Termination:** The loop terminates upon Critic \`APPROVAL\` or upon reaching the 3-cycle safety bound, preventing infinite loops and runaway API costs.
6. **Status Badges:** If minor warnings remain after 3 cycles, the itinerary is tagged with an amber **\`NEEDS ATTENTION\`** status badge so the traveler can review caveats.

---

### 6. Production Engineering & Resilience Innovations (Latest Updates)

* **Multi-Model Failover Pool:** Leverages Groq Cloud LPU acceleration with sub-second inference speeds. Primary inference runs on \`openai/gpt-oss-120b\` with automated fallback cascade to \`qwen/qwen3.8-27b\` and \`openai/gpt-oss-20b\`.
* **Dynamic 404 Model Pruning:** Automatically intercepts HTTP 404 responses from provider endpoints, pruning unavailable models dynamically during runtime to eliminate false failure states.
* **Multi-Key Round-Robin Rotation:** Auto-discovers and pools multiple Groq API keys (\`GROQ_API_KEY=key1,key2,key3,key4\`), multiplying capacity to 120 RPM and 32,000 TPM with seamless failover on rate limits.
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
`;

fs.writeFileSync(targetMdPath, markdownContent);
console.log(`Updated Markdown Synopsis: ${targetMdPath}`);
