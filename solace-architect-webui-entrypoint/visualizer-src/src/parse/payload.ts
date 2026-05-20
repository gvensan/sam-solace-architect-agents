import type { AgentCard } from "../bus/types";

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

export function extractAgentCard(payload: unknown): AgentCard | null {
  if (!isObj(payload)) return null;
  const name = payload.name;
  if (typeof name !== "string" || name.length === 0) return null;
  const card: AgentCard = { name };
  if (typeof payload.description === "string") card.description = payload.description;
  if (Array.isArray(payload.defaultInputModes))
    card.defaultInputModes = payload.defaultInputModes.filter((s): s is string => typeof s === "string");
  if (Array.isArray(payload.defaultOutputModes))
    card.defaultOutputModes = payload.defaultOutputModes.filter((s): s is string => typeof s === "string");
  if (Array.isArray(payload.skills)) {
    card.skills = payload.skills
      .filter(isObj)
      .filter((s) => typeof s.id === "string" && typeof s.name === "string")
      .map((s) => ({
        id: s.id as string,
        name: s.name as string,
        description: typeof s.description === "string" ? s.description : undefined,
      }));
  }
  return card;
}

/**
 * Extract task_id from a JSON-RPC 2.0 payload when present.
 * SAM uses JSON-RPC; task IDs commonly live in `params.id`, `result.id`, or `id`.
 */
export function extractTaskId(payload: unknown): string | null {
  if (!isObj(payload)) return null;
  if (typeof payload.id === "string") return payload.id;
  if (isObj(payload.params)) {
    const p = payload.params;
    if (typeof p.id === "string") return p.id;
    if (typeof p.taskId === "string") return p.taskId;
  }
  if (isObj(payload.result)) {
    const r = payload.result;
    if (typeof r.id === "string") return r.id;
    if (typeof r.taskId === "string") return r.taskId;
  }
  return null;
}

export function extractStatus(payload: unknown): string | null {
  if (!isObj(payload)) return null;
  if (typeof payload.status === "string") return payload.status;
  if (isObj(payload.result) && typeof payload.result.status === "string")
    return payload.result.status;
  if (isObj(payload.params) && typeof payload.params.status === "string")
    return payload.params.status;
  return null;
}
