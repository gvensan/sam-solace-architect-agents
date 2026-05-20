import type { A2AEvent } from "../bus/types";

/**
 * Parse an A2A topic per the SAM topic hierarchy:
 *   {namespace}/a2a/v1/discovery/agentcards
 *   {namespace}/a2a/v1/agent/request/{target_agent_name}
 *   {namespace}/a2a/v1/gateway/status/{gateway_id}/{task_id}
 *   {namespace}/a2a/v1/gateway/response/{gateway_id}/{task_id}
 *   {namespace}/a2a/v1/agent/status/{delegating_agent}/{sub_task_id}
 *   {namespace}/a2a/v1/agent/response/{delegating_agent}/{sub_task_id}
 *
 * Returns null when the topic does not match the expected prefix.
 */
export function parseTopic(
  topic: string,
  namespace: string,
  ts: number = Date.now(),
  payload?: unknown,
): A2AEvent | null {
  if (!topic.startsWith(`${namespace}/a2a/v1/`)) return null;

  const rest = topic.slice(`${namespace}/a2a/v1/`.length);
  const parts = rest.split("/");
  if (parts.length === 0) return null;

  const [head, sub, p3, p4] = parts;
  const base = { topic, namespace, ts, payload } as const;

  if (head === "discovery" && sub === "agentcards") {
    return { ...base, kind: "discovery" };
  }

  if (head === "agent") {
    if (sub === "request" && p3) {
      return { ...base, kind: "request", agentName: p3 };
    }
    if (sub === "status" && p3 && p4) {
      return {
        ...base,
        kind: "delegation-status",
        delegatingAgent: p3,
        subTaskId: p4,
      };
    }
    if (sub === "response" && p3 && p4) {
      return {
        ...base,
        kind: "delegation-response",
        delegatingAgent: p3,
        subTaskId: p4,
      };
    }
  }

  if (head === "gateway") {
    if (sub === "status" && p3 && p4) {
      return { ...base, kind: "status", gatewayId: p3, taskId: p4 };
    }
    if (sub === "response" && p3 && p4) {
      return { ...base, kind: "response", gatewayId: p3, taskId: p4 };
    }
  }

  return null;
}
