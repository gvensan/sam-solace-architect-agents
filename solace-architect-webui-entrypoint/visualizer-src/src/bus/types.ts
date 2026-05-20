export type A2AEventKind =
  | "discovery"
  | "request"
  | "status"
  | "response"
  | "delegation-status"
  | "delegation-response";

export interface A2AEvent {
  kind: A2AEventKind;
  topic: string;
  namespace: string;
  ts: number;
  seq?: number;
  agentName?: string;
  gatewayId?: string;
  delegatingAgent?: string;
  taskId?: string;
  subTaskId?: string;
  payload?: unknown;
}

export interface AgentCard {
  name: string;
  description?: string;
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  skills?: Array<{ id: string; name: string; description?: string }>;
}

export interface AgentRecord {
  name: string;
  description?: string;
  skills: NonNullable<AgentCard["skills"]>;
  lastSeen: number;
  isOrchestrator: boolean;
  /** task_ids this agent is currently processing (oldest first). */
  currentTaskIds?: string[];
}

export interface GatewayRecord {
  id: string;
  firstSeen: number;
  lastSeen: number;
  activeTasks: number;
}

export type TaskStatus = "pending" | "working" | "completed" | "failed" | string;

export interface TaskRecord {
  id: string;
  sourceGateway: string | null;
  sourceAgent: string | null;
  targetAgent: string | null;
  status: TaskStatus;
  startTime: number;
  endTime: number | null;
  subTasks: string[];
  parentTask: string | null;
  /** Palette color shared across this task and its sub-tasks. */
  color: string | null;
}

export interface MeshState {
  agents: Map<string, AgentRecord>;
  gateways: Map<string, GatewayRecord>;
  tasks: Map<string, TaskRecord>;
}

export const initialState = (): MeshState => ({
  agents: new Map(),
  gateways: new Map(),
  tasks: new Map(),
});
