# TripNexus — Live Demonstration & Video Script (2-3 Minutes)

This script provides a structured guide for presenting TripNexus during live professor demonstrations or recorded video submissions.

---

## ⏱️ Video Breakdown

| Timestamp | Phase | Screen Action | Talking Points |
| :--- | :--- | :--- | :--- |
| **0:00 – 0:30** | **System Overview & Problem** | Open TripNexus Homepage (`http://localhost:3000` or Vercel URL). Show UI layout, destination cards, and header readiness badge. | *"Hello everyone. Today we are demonstrating TripNexus, an agentic multi-agent travel planner built for CA3. Instead of a single static LLM prompt, TripNexus coordinates five specialized AI roles: Trip Manager, Destination Agent, Budget Agent, Weather Agent, and an independent Critic Agent."* |
| **0:30 – 1:00** | **Form Input & Dynamic Delegation** | Choose **Jaipur** or click a Demo Scenario. Set dates (3 days), 2 travelers, and ₹45,000 budget. Click **Plan My Trip**. | *"When the traveler submits their request, the Trip Manager validates the input and dynamically delegates tasks. Watch the Agent Execution Pipeline: the Destination Agent queries verified place coordinates, the Budget Agent runs deterministic arithmetic in INR, and the Weather Agent assesses typical climate risks."* |
| **1:00 – 1:45** | **Conflict Detection & Critic Review** | Observe the Critic evaluation panel. Point to the Critic decision badge (`APPROVED` or `REJECTED`). | *"Here is the core multi-agent mechanism: The Critic Agent independently audits the candidate plan. If there is a budget overrun or a high-rain risk on an outdoor activity, the Critic rejects the plan with actionable evidence. The Trip Manager routes a targeted revision to the responsible specialist, re-running only the affected component rather than restarting from scratch."* |
| **1:45 – 2:30** | **Execution Trace & Inspection** | Scroll to the **Execution Trace** panel. Toggle filter tabs (Agent filter, Event filter). Open raw message view. | *"Notice the live Execution Trace. Every single agent-to-agent handoff, model call, tool execution, and revision is recorded in real time with sequence IDs and timestamps. There are no fabricated logs here—this is actual runtime evidence."* |
| **2:30 – 3:00** | **Export, Viva Docs & Wrap-up** | Click **Export Trace (JSON)** and **Download Project Documentation (PDF)**. Show the downloaded PDF. | *"Finally, the user can export the verified trace as JSON or download the complete academic documentation as a structured PDF directly from the server. TripNexus satisfies all seven grading categories of CA3. Thank you!"* |

---

## 💡 Key Talking Points for the Professor
1. **No Hard-coded Pipelines**: The Trip Manager decides delegations dynamically based on the current state.
2. **Deterministic Arithmetic**: Budget math is computed reliably in TypeScript, while the LLM interprets trade-offs.
3. **Independent Critic**: The Critic has real veto authority and can force revisions.
4. **Verifiable Trace**: Every action has a monotonic sequence number, timestamp, and message record.
