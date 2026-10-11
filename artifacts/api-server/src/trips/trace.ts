import { randomUUID } from "node:crypto";
import type { AgentId, AgentMessage, TraceEvent } from "./types";

interface EventInput {
  agentId: AgentId;
  eventType: string;
  summary: string;
  fromAgent?: AgentId | null;
  toAgent?: AgentId | null;
  action?: string | null;
  toolName?: string | null;
  status?: string;
}

interface MessageInput {
  sender: AgentId;
  recipient: AgentId;
  type: string;
  task: string;
  result?: string | null;
  issueId?: string | null;
  status: string;
}

export class RunTrace {
  readonly events: TraceEvent[] = [];
  readonly messages: AgentMessage[] = [];

  constructor(
    readonly runId: string,
    private revisionNumber = 0,
  ) {}

  setRevision(revisionNumber: number) {
    this.revisionNumber = revisionNumber;
  }

  event(input: EventInput) {
    const event: TraceEvent = {
      eventId: randomUUID(),
      runId: this.runId,
      sequence: this.events.length + 1,
      timestamp: new Date(),
      agentId: input.agentId,
      fromAgent: input.fromAgent ?? null,
      toAgent: input.toAgent ?? null,
      eventType: input.eventType,
      action: input.action ?? null,
      summary: input.summary,
      toolName: input.toolName ?? null,
      status: input.status ?? "completed",
      revisionNumber: this.revisionNumber,
    };
    this.events.push(event);
    return event;
  }

  message(input: MessageInput) {
    const message: AgentMessage = {
      id: randomUUID(),
      runId: this.runId,
      timestamp: new Date(),
      sender: input.sender,
      recipient: input.recipient,
      type: input.type,
      task: input.task,
      result: input.result ?? null,
      issueId: input.issueId ?? null,
      status: input.status,
    };
    this.messages.push(message);
    this.event({
      agentId: input.sender,
      fromAgent: input.sender,
      toAgent: input.recipient,
      eventType: "agent_message",
      action: input.type,
      summary: `${input.sender} → ${input.recipient}: ${input.task}`,
      status: input.status,
    });
    return message;
  }
}
