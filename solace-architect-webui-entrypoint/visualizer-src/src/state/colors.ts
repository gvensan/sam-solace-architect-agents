import type { MeshState, TaskRecord } from "../bus/types";

/**
 * Distinguishable palette used to color a task and all of its sub-tasks.
 * Picked to read on both dark and light themes and to avoid the accent colors
 * (teal/amber) that the layout already uses for gateway and orchestrator strokes.
 */
export const TASK_PALETTE: readonly string[] = [
  "#3b82f6", // blue
  "#a855f7", // purple
  "#ec4899", // pink
  "#f97316", // orange
  "#10b981", // green
  "#ef4444", // red
  "#06b6d4", // cyan
  "#eab308", // yellow
];

let cursor = 0;

/** Reset the rotating cursor, e.g. on bus.clear(). */
export function resetPaletteCursor(): void {
  cursor = 0;
}

/**
 * Pick the next palette color. Falls through the array round-robin; if many
 * tasks live concurrently the palette repeats but the timeline labels keep
 * the rows distinguishable.
 */
export function nextTaskColor(): string {
  const c = TASK_PALETTE[cursor % TASK_PALETTE.length];
  cursor++;
  return c;
}

/**
 * Best-effort guess at which existing task is the parent of a brand-new
 * REQUEST. The visualizer cannot see the source agent on a request topic,
 * so we infer: if any OTHER agent is currently processing a task, that
 * agent is the likely delegator. Pick its most recent in-flight task.
 *
 * Returns null when the request looks gateway-initiated (no concurrent agent
 * activity), which means a new color should be assigned instead of inheriting.
 */
export function inferParentTaskId(
  state: MeshState,
  targetAgentName: string,
  now: number,
  maxAgeMs = 30_000,
): string | null {
  let best: TaskRecord | null = null;
  for (const agent of state.agents.values()) {
    if (agent.name === targetAgentName) continue;
    const current = agent.currentTaskIds ?? [];
    if (current.length === 0) continue;
    const t = state.tasks.get(current[current.length - 1]);
    if (!t || t.endTime !== null) continue;
    if (now - t.startTime > maxAgeMs) continue;
    if (!best || t.startTime > best.startTime) best = t;
  }
  return best?.id ?? null;
}

/**
 * Compact a task id for display on edge labels.
 * Strips known prefixes (gdk-task-, a2a_subtask_, task-, sub-, etc.) then
 * truncates to keep the visualization legible.
 */
export function shortTaskId(taskId: string, maxLen = 8): string {
  const stripped = taskId
    .replace(/^[a-z][a-z0-9]*[-_](?:sub)?task[-_]/i, "")
    .replace(/^(?:sub)?task[-_]/i, "")
    .replace(/^sub[-_]/i, "");
  return stripped.length > maxLen ? stripped.slice(0, maxLen) : stripped;
}
