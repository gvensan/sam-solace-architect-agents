import type {
  A2AEvent,
  AgentRecord,
  GatewayRecord,
  MeshState,
  TaskRecord,
} from "../bus/types";
import { extractAgentCard, extractStatus, extractTaskId } from "../parse/payload";
import { inferParentTaskId, nextTaskColor } from "./colors";

const isOrchestratorName = (name: string) =>
  name.toLowerCase().includes("orchestrator");

function upsertGateway(state: MeshState, id: string, ts: number): GatewayRecord {
  const existing = state.gateways.get(id);
  if (existing) {
    existing.lastSeen = ts;
    return existing;
  }
  const record: GatewayRecord = {
    id,
    firstSeen: ts,
    lastSeen: ts,
    activeTasks: 0,
  };
  state.gateways.set(id, record);
  return record;
}

function upsertAgent(state: MeshState, name: string, ts: number): AgentRecord {
  const existing = state.agents.get(name);
  if (existing) {
    existing.lastSeen = ts;
    return existing;
  }
  const record: AgentRecord = {
    name,
    skills: [],
    lastSeen: ts,
    isOrchestrator: isOrchestratorName(name),
    currentTaskIds: [],
  };
  state.agents.set(name, record);
  return record;
}

function upsertTask(state: MeshState, id: string, ts: number): TaskRecord {
  const existing = state.tasks.get(id);
  if (existing) return existing;
  const record: TaskRecord = {
    id,
    sourceGateway: null,
    sourceAgent: null,
    targetAgent: null,
    status: "pending",
    startTime: ts,
    endTime: null,
    subTasks: [],
    parentTask: null,
    color: null,
  };
  state.tasks.set(id, record);
  return record;
}

function pushAgentTask(agent: AgentRecord, taskId: string) {
  const list = agent.currentTaskIds ?? [];
  if (!list.includes(taskId)) list.push(taskId);
  agent.currentTaskIds = list;
}

function popAgentTask(agent: AgentRecord, taskId: string) {
  if (!agent.currentTaskIds) return;
  agent.currentTaskIds = agent.currentTaskIds.filter((id) => id !== taskId);
}

/**
 * Assign a color to a new task. If the request looks like a delegation
 * (some other agent is currently busy), inherit the parent's color so the
 * full sub-task tree shares one hue.
 */
function colorize(state: MeshState, task: TaskRecord, targetAgentName: string, ts: number) {
  if (task.color) return;
  const parentId = inferParentTaskId(state, targetAgentName, ts);
  if (parentId && parentId !== task.id) {
    const parent = state.tasks.get(parentId);
    if (parent) {
      task.parentTask = parentId;
      task.color = parent.color ?? nextTaskColor();
      if (!parent.color) parent.color = task.color;
      if (!parent.subTasks.includes(task.id)) parent.subTasks.push(task.id);
      return;
    }
  }
  task.color = nextTaskColor();
}

/**
 * Apply a parsed A2A event to mesh state. Mutates in-place and returns the
 * same state object so callers can detect changes by version.
 */
export function applyEvent(state: MeshState, event: A2AEvent): MeshState {
  switch (event.kind) {
    case "discovery": {
      const card = extractAgentCard(event.payload);
      if (!card) return state;
      const rec = upsertAgent(state, card.name, event.ts);
      rec.description = card.description;
      rec.skills = card.skills ?? rec.skills;
      rec.isOrchestrator = isOrchestratorName(card.name);
      return state;
    }
    case "request": {
      if (!event.agentName) return state;
      const target = upsertAgent(state, event.agentName, event.ts);
      const taskId = extractTaskId(event.payload);
      if (taskId) {
        const task = upsertTask(state, taskId, event.ts);
        task.targetAgent = event.agentName;
        colorize(state, task, event.agentName, event.ts);
        pushAgentTask(target, taskId);
      }
      return state;
    }
    case "status": {
      if (!event.gatewayId || !event.taskId) return state;
      const gw = upsertGateway(state, event.gatewayId, event.ts);
      const task = upsertTask(state, event.taskId, event.ts);
      task.sourceGateway = event.gatewayId;
      const status = extractStatus(event.payload);
      if (status) task.status = status;
      if (task.status !== "completed" && task.status !== "failed") gw.activeTasks++;
      return state;
    }
    case "response": {
      if (!event.gatewayId || !event.taskId) return state;
      upsertGateway(state, event.gatewayId, event.ts);
      const task = upsertTask(state, event.taskId, event.ts);
      task.sourceGateway = event.gatewayId;
      task.status = extractStatus(event.payload) ?? "completed";
      task.endTime = event.ts;
      const gw = state.gateways.get(event.gatewayId);
      if (gw && gw.activeTasks > 0) gw.activeTasks--;
      if (task.targetAgent) {
        const a = state.agents.get(task.targetAgent);
        if (a) popAgentTask(a, task.id);
      }
      return state;
    }
    case "delegation-status":
    case "delegation-response": {
      if (!event.delegatingAgent || !event.subTaskId) return state;
      const delegating = upsertAgent(state, event.delegatingAgent, event.ts);
      const sub = upsertTask(state, event.subTaskId, event.ts);
      sub.sourceAgent = event.delegatingAgent;

      // Confirm parent linkage now that we know who delegated.
      if (!sub.parentTask) {
        const current = delegating.currentTaskIds ?? [];
        const parentId = current[current.length - 1];
        if (parentId && parentId !== sub.id) {
          const parent = state.tasks.get(parentId);
          if (parent) {
            sub.parentTask = parentId;
            if (parent.color && sub.color !== parent.color) sub.color = parent.color;
            if (!parent.subTasks.includes(sub.id)) parent.subTasks.push(sub.id);
          }
        }
      }

      const status = extractStatus(event.payload);
      if (event.kind === "delegation-response") {
        sub.status = status ?? "completed";
        sub.endTime = event.ts;
        if (sub.targetAgent) {
          const a = state.agents.get(sub.targetAgent);
          if (a) popAgentTask(a, sub.id);
        }
      } else if (status) {
        sub.status = status;
      }
      return state;
    }
  }
}
