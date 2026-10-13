import { Router, type IRouter } from "express";

const router: IRouter = Router();

const GUIDE = [
  "TRIPNEXUS — MULTI-AGENT TRAVEL PLANNER",
  "",
  "Project documentation and demonstration notes",
  "",
  "OVERVIEW",
  "TripNexus turns a date range, destination, group size, interests and total budget into a reviewed day-by-day trip plan. Five Groq-backed specialist roles coordinate: Trip Manager, Destination Agent, Budget Agent, Weather Agent and Critic Agent.",
  "",
  "AGENT WORKFLOW",
  "1. Trip Manager validates the request context and assigns bounded tasks to the destination, budget and weather specialists.",
  "2. Destination Agent selects only bundled place IDs. Local tools resolve place details and estimate straight-line route distance from coordinates.",
  "3. Budget Agent receives a deterministic local group-cost calculation and explains its trade-offs. Estimates are not quotes.",
  "4. Weather Agent uses bundled typical-month climate patterns to identify weather-sensitive activities and indoor alternatives. This is not a live forecast.",
  "5. Critic Agent reviews dates, places, the calculated budget, route estimates and seasonal risks. A rejection is routed to the responsible specialist for a bounded revision.",
  "6. The Trip Manager stops after approval or after three revisions. The application limits each task to eight local tool calls and each specialist to eight Groq API calls per run.",
  "",
  "DATA AND LIMITATIONS",
  "Destination, place, cost and climate records are bundled local JSON reference data for demonstration. Distances are straight-line coordinate estimates, not road or transit directions. Cost figures are approximate INR estimates for the whole group. Climate values are typical monthly patterns, not forecasts. The service does not book hotels, transport or activities.",
  "",
  "SECURITY",
  "The Groq API key is read server-side from the GROQ_API_KEY environment variable. It is never sent to the browser or written to trace exports. Configure it through .env or deployment environment variables. The default model is llama-3.3-70b-versatile and can be changed with GROQ_MODEL.",
  "",
  "API",
  "GET /api/healthz — service, model and API readiness (boolean only).",
  "GET /api/agents — agent identities and responsibilities.",
  "GET /api/destinations — bundled destination catalogue.",
  "GET /api/demo — sample trip requests.",
  "POST /api/plan-trip — validate and queue a Groq-backed plan; returns 202 and a run ID.",
  "GET /api/runs/{runId} — poll queued/running/completed/failed status and retrieve the result or categorized error.",
  "GET /api/runs/{runId}/trace — retrieve the actual in-memory trace for a completed run.",
  "GET /api/documentation.pdf — download this guide as a PDF.",
  "",
  "TRACE AND STORAGE",
  "Each run captures actual model-call attempts, specialist messages, local tool calls/results, critic decisions and revisions. Run statuses, completed results and traces are held in memory for up to 24 hours, with a 250-run cap, and are lost when the API process restarts. The UI polls run status and can export a completed trace as JSON.",
  "",
  "DEMONSTRATION SCRIPT",
  "1. Open the TripNexus page and confirm the service and Groq model status.",
  "2. Choose a demo request or fill the destination, dates, travelers, INR group budget and preferences.",
  "3. Run the planner and inspect each itinerary day, budget breakdown and seasonal climate caveat.",
  "4. Review agent-to-agent messages and the execution trace. Filter by agent or event type.",
  "5. Export the trace as JSON or download this documentation PDF.",
  "6. If the Critic rejects the first draft, follow the revision-request and specialist-result messages through the subsequent review.",
  "",
  "VIVA / REVIEW QUESTIONS",
  "Why is the Trip Manager separated from specialist agents? How are tool arguments validated? Which budget figures are deterministic and which text is generated? How does the Critic trigger a targeted revision? What does the weather source not provide? How are Groq credentials kept out of browser code and logs? Which state is lost on process restart?",
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
