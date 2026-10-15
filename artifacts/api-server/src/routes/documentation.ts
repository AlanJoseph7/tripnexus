import { Router, type IRouter } from "express";

const router: IRouter = Router();

const GUIDE = [
  "TRIPNEXUS: AUTONOMOUS MULTI-AGENT COLLABORATIVE TRAVEL PLANNING SYSTEM",
  "Project Synopsis & Technical Documentation (Version 2.4.0)",
  "Repository: https://github.com/AlanJoseph7/tripnexus | Live Deployment: Vercel Production",
  "",
  "1. PROJECT TITLE & DOMAIN",
  "Project Title: TripNexus - Constraint-Aware Multi-Agent Travel Planner",
  "Domain: Artificial Intelligence, Distributed Multi-Agent Systems (MAS), Full-Stack Web Engineering",
  "Core Focus: Autonomous Agent Coordination, Closed-Loop Evaluator Pattern, Deterministic Arithmetic Tool Separation, Production LLM Rate-Limit Resilience.",
  "",
  "2. ABSTRACT & EXECUTIVE SUMMARY",
  "Modern travel planning is an intricate multi-criteria constraint satisfaction problem. Travelers must reconcile diverse personal interests, calendar dates, geographic proximity, strict group budgets in INR, and seasonal climate risks.",
  "",
  "Single-prompt Large Language Model (LLM) interfaces fail consistently in this domain due to four fundamental limitations: (1) Hallucinating attractions, non-existent venues, and speculative pricing; (2) Severe arithmetic errors when computing multi-day multi-traveler budgets; (3) Context drift across multi-day schedules; and (4) Complete absence of self-critique, verification, and adaptive replanning.",
  "",
  "TripNexus resolves these deficiencies by introducing an autonomous, distributed multi-agent collaborative architecture. Built with TypeScript, Node.js, React 19, and Groq Cloud LPU inference, TripNexus distributes travel planning across five autonomous specialized agents. The system enforces strict separation between non-deterministic LLM reasoning and deterministic mathematical computation, incorporates an adversarial Critic Agent with closed-loop revision cycles, and features an enterprise-grade resilient infrastructure with multi-key rotation, multi-model failover, and zero-crash offline fallback mechanisms.",
  "",
  "3. PROBLEM STATEMENT & OBJECTIVES",
  "Problem Statement: Online travel aggregators provide static, disconnected search results forcing manual route calculations, weather checks, and currency conversions. Conversely, generic generative AI tools produce stylistically pleasing but operationally unfeasible itineraries with unrealistic transit times and overlooked climate risks.",
  "",
  "Objectives:",
  "- Autonomous Role Decomposition: Segment complex trip planning into bounded, single-responsibility agent roles (Manager, Destination, Budget, Weather, Critic).",
  "- Strict Schema Enforcement: Guarantee 100% valid JSON responses using Zod runtime validation and Groq strict JSON-schema decoding.",
  "- Deterministic Arithmetic Integrity: Compute all distance calculations (Haversine trigonometric formula) and budget summations strictly in TypeScript.",
  "- Closed-Loop Adversarial Critique: Deploy an independent Critic Agent capable of rejecting inadequate drafts and commanding targeted agent revisions.",
  "- Production-Grade Resilience: Implement dynamic multi-model failover, 404 model pruning, round-robin multi-key pooling, and guaranteed offline fallback.",
  "- Transparent Auditability: Record every inter-agent message, tool call, latency, and decision in a monotonic execution trace exportable in JSON format.",
  "",
  "4. SYSTEM ARCHITECTURE & AUTONOMOUS AGENTS",
  "TripNexus coordinates five specialized agent roles:",
  "1. Trip Manager Agent (trip_manager): Executive planner and state supervisor. Validates user briefs, decomposes tasks, manages shared state, and oversees up to 3 revision cycles.",
  "2. Destination Specialist Agent (destination_agent): Curates verified points of interest from an 11-city catalog, clusters activities geographically, and calculates straight-line route distances using the Haversine trigonometric formula.",
  "3. Budget Assessor Agent (budget_agent): Computes deterministic group cost allocations in INR (accommodation, dining, activities, transit, and 10% contingency) and reasons about financial headroom and trade-offs.",
  "4. Climate & Seasonality Specialist (weather_agent): Synthesizes verified monthly climate patterns, identifies rain/heat risks for outdoor plans, and proactively pairs them with indoor alternatives.",
  "5. Independent Critic Agent (critic_agent): Adversarial auditor inspecting candidate plans across 4 verification pillars: (a) Date continuity, (b) Budget compliance, (c) Route sanity, and (d) Weather safety. Issues either an APPROVED verdict or a REJECTED ticket targeting the responsible agent for revision.",
  "",
  "5. CLOSED-LOOP REPLANNING & CONFLICT RESOLUTION",
  "Workflow: Candidate Draft -> Critic Audit -> Targeted Revision Request -> Specialist Re-execution -> Re-audit (bounded to 3 iterations).",
  "Guaranteed Bounded Termination: If minor warnings persist after 3 cycles, the itinerary is tagged with an amber 'NEEDS ATTENTION' status badge so the traveler can review caveats, avoiding infinite loops or runaway API charges.",
  "",
  "6. PRODUCTION ENGINEERING & RESILIENCE INNOVATIONS",
  "- Multi-Model Failover Pool: Leverages Groq Cloud LPU acceleration. Primary inference on openai/gpt-oss-120b with automated fallback cascade to qwen/qwen3.8-27b and openai/gpt-oss-20b.",
  "- Dynamic 404 Model Pruning: Auto-detects HTTP 404 provider responses and prunes unavailable models dynamically during runtime to prevent false failure states.",
  "- Multi-Key Round-Robin Rotation: Auto-discovers and pools multiple Groq API keys (GROQ_API_KEY=key1,key2,...), multiplying capacity to 120 RPM and 32,000 TPM with seamless failover on rate limits.",
  "- Stateless Serverless Trace Delivery: Execution events are bundled directly into the primary plan result payload, displaying 120+ events immediately without secondary 404 race conditions.",
  "- Guaranteed Zero-Crash Offline Fallback: Automatically generates a high-quality deterministic itinerary using bundled catalog data if API credentials or rate limits prevent live execution, ensuring 100% application uptime.",
  "",
  "7. TECHNOLOGY STACK SPECIFICATIONS",
  "- Frontend: React 19 (Strict Mode), TypeScript, Vite 7.3.6, TanStack React Query v5, Modern Vanilla CSS with HSL tokens, Lucide Icons, Wouter Router.",
  "- Backend: Node.js 24 LTS, Express 5, Zod Schema Validation, Pino Structured Logging, Pure Buffer PDF Generator.",
  "- AI Services: Groq Cloud LPU Inference, Strict JSON-Schema Output Enforcement (temperature: 0.2, top_p: 0.95).",
  "- Cloud & Deployment: Vercel Serverless Functions, GitHub Continuous Integration.",
  "",
  "8. VERIFICATION & ACADEMIC VIVA ALIGNMENT",
  "- 23 passing Vitest unit tests verifying schema parsers, Haversine coordinate math, budget allocation, multi-key rotation, and offline fallback generators.",
  "- Fulfills all seven CA3 assessment criteria: Multi-Agent Role Specialization, Dynamic Task Allocation, Monotonic Shared State & Trace, Deterministic Tool Execution, Adversarial Critic Replanning, Robust Error Resilience, and Interactive Documentation.",
  "",
  "9. CONCLUSION & FUTURE SCOPE",
  "TripNexus demonstrates that multi-agent AI systems, when paired with deterministic tool validation and robust error handling, overcome the core limitations of single-prompt LLMs.",
  "Future Scope: Live Flight and Hotel GDS Integration via Amadeus / Sabre APIs; Real-time meteorological satellite integration (Open-Meteo live API); User authentication with encrypted personal travel history; Multi-currency live forex exchange rate conversions.",
].join("\n");

function escapePdf(text: string) {
  return text
    .replace(/[^\x20-\x7e]/g, "?")
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function wrap(text: string, width: number) {
  if (!text) return [""];
  const words = text.split(/\s+/);
  const lines: string[] = [];
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

function pdfBuffer(text: string) {
  const lines = text.split("\n").flatMap((line) => wrap(line, 96));
  const pages: string[][] = [];
  for (let offset = 0; offset < lines.length; offset += 52) pages.push(lines.slice(offset, offset + 52));

  const objects: string[] = [];
  const pageObjectIds = pages.map((_, index) => 3 + index * 2);
  const fontObjectId = 3 + pages.length * 2;
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;

  pages.forEach((pageLines, pageIndex) => {
    const pageId = pageObjectIds[pageIndex]!;
    const streamId = pageId + 1;
    const content = [
      "BT",
      "/F1 9 Tf",
      "42 758 Td",
      ...pageLines.flatMap((line) => [`(${escapePdf(line)}) Tj`, "0 -13 Td"]),
      "ET",
    ].join("\n");
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${streamId} 0 R >>`;
    objects[streamId] = `<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`;
  });
  objects[fontObjectId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

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

router.get("/documentation.pdf", (_req, res) => {
  res
    .status(200)
    .setHeader("Content-Type", "application/pdf")
    .setHeader("Content-Disposition", 'attachment; filename="tripnexus-project-guide.pdf"')
    .send(pdfBuffer(GUIDE));
});

export default router;
