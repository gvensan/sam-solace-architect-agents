import type { A2AEvent } from "../bus/types";

export interface SimStep {
  delayMs: number;
  topic: string;
  payload?: unknown;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  steps: SimStep[];
}

const t = (delayMs: number, topic: string, payload?: unknown): SimStep => ({
  delayMs,
  topic,
  payload,
});

const NS = "demo";

const orchestratorCard = {
  name: "OrchestratorAgent",
  description: "Routes user requests across specialized agents.",
  defaultInputModes: ["text"],
  defaultOutputModes: ["text"],
  skills: [{ id: "plan", name: "Plan", description: "Break down requests." }],
};

const weatherCard = {
  name: "WeatherAgent",
  description: "Provides weather forecasts for any location.",
  defaultInputModes: ["text"],
  defaultOutputModes: ["text"],
  skills: [{ id: "get_forecast", name: "Get Forecast", description: "Forecast by location." }],
};

const sqlCard = {
  name: "SqlAgent",
  description: "Executes SQL against the analytics warehouse.",
  defaultInputModes: ["text"],
  defaultOutputModes: ["text", "file"],
  skills: [{ id: "query", name: "Query", description: "Run a SQL query." }],
};

const summaryCard = {
  name: "SummaryAgent",
  description: "Summarizes long documents.",
  defaultInputModes: ["text"],
  defaultOutputModes: ["text"],
  skills: [{ id: "summarize", name: "Summarize", description: "Condense text." }],
};

const simpleRequestResponse: Scenario = {
  id: "simple",
  name: "Simple request/response",
  description: "Gateway → orchestrator → weather agent → response.",
  steps: [
    t(0, `${NS}/a2a/v1/discovery/agentcards`, orchestratorCard),
    t(100, `${NS}/a2a/v1/discovery/agentcards`, weatherCard),
    t(400, `${NS}/a2a/v1/agent/request/OrchestratorAgent`, { id: "task-100", params: { text: "weather in tokyo" } }),
    t(150, `${NS}/a2a/v1/gateway/status/webui-1/task-100`, { status: "working" }),
    t(200, `${NS}/a2a/v1/agent/request/WeatherAgent`, { id: "sub-100a" }),
    t(150, `${NS}/a2a/v1/agent/status/OrchestratorAgent/sub-100a`, { status: "working" }),
    t(400, `${NS}/a2a/v1/agent/response/OrchestratorAgent/sub-100a`, { status: "completed" }),
    t(150, `${NS}/a2a/v1/gateway/response/webui-1/task-100`, { status: "completed" }),
  ],
};

const multiAgentDelegation: Scenario = {
  id: "delegation",
  name: "Multi-agent delegation chain",
  description: "Orchestrator delegates to SQL, then SQL delegates to Summary.",
  steps: [
    t(0, `${NS}/a2a/v1/discovery/agentcards`, orchestratorCard),
    t(80, `${NS}/a2a/v1/discovery/agentcards`, sqlCard),
    t(80, `${NS}/a2a/v1/discovery/agentcards`, summaryCard),
    t(300, `${NS}/a2a/v1/agent/request/OrchestratorAgent`, { id: "task-200" }),
    t(120, `${NS}/a2a/v1/gateway/status/slack-1/task-200`, { status: "working" }),
    t(200, `${NS}/a2a/v1/agent/request/SqlAgent`, { id: "sub-200a" }),
    t(150, `${NS}/a2a/v1/agent/status/OrchestratorAgent/sub-200a`, { status: "working" }),
    t(250, `${NS}/a2a/v1/agent/request/SummaryAgent`, { id: "sub-200b" }),
    t(120, `${NS}/a2a/v1/agent/status/SqlAgent/sub-200b`, { status: "working" }),
    t(400, `${NS}/a2a/v1/agent/response/SqlAgent/sub-200b`, { status: "completed" }),
    t(150, `${NS}/a2a/v1/agent/response/OrchestratorAgent/sub-200a`, { status: "completed" }),
    t(180, `${NS}/a2a/v1/gateway/response/slack-1/task-200`, { status: "completed" }),
  ],
};

const concurrentTasks: Scenario = {
  id: "concurrent",
  name: "Concurrent tasks across gateways",
  description: "Two gateways send overlapping requests.",
  steps: [
    t(0, `${NS}/a2a/v1/discovery/agentcards`, orchestratorCard),
    t(80, `${NS}/a2a/v1/discovery/agentcards`, weatherCard),
    t(80, `${NS}/a2a/v1/discovery/agentcards`, sqlCard),
    t(300, `${NS}/a2a/v1/agent/request/OrchestratorAgent`, { id: "task-A" }),
    t(50, `${NS}/a2a/v1/agent/request/OrchestratorAgent`, { id: "task-B" }),
    t(100, `${NS}/a2a/v1/gateway/status/webui-1/task-A`, { status: "working" }),
    t(50, `${NS}/a2a/v1/gateway/status/rest-1/task-B`, { status: "working" }),
    t(200, `${NS}/a2a/v1/agent/request/WeatherAgent`, { id: "sub-A1" }),
    t(50, `${NS}/a2a/v1/agent/request/SqlAgent`, { id: "sub-B1" }),
    t(300, `${NS}/a2a/v1/agent/response/OrchestratorAgent/sub-A1`, { status: "completed" }),
    t(80, `${NS}/a2a/v1/agent/response/OrchestratorAgent/sub-B1`, { status: "completed" }),
    t(120, `${NS}/a2a/v1/gateway/response/webui-1/task-A`, { status: "completed" }),
    t(80, `${NS}/a2a/v1/gateway/response/rest-1/task-B`, { status: "completed" }),
  ],
};

const agentDiscoveryWave: Scenario = {
  id: "discovery",
  name: "Mesh scaling: agents appear over time",
  description: "New agents join the mesh periodically.",
  steps: [
    t(0, `${NS}/a2a/v1/discovery/agentcards`, orchestratorCard),
    t(800, `${NS}/a2a/v1/discovery/agentcards`, weatherCard),
    t(800, `${NS}/a2a/v1/discovery/agentcards`, sqlCard),
    t(800, `${NS}/a2a/v1/discovery/agentcards`, summaryCard),
  ],
};

export const SCENARIOS: Scenario[] = [
  simpleRequestResponse,
  multiAgentDelegation,
  concurrentTasks,
  agentDiscoveryWave,
];

export const SIM_NAMESPACE = NS;

export type RawSimEvent = { topic: string; payload?: unknown; ts: number };
export type ParseFn = (raw: RawSimEvent) => A2AEvent | null;
