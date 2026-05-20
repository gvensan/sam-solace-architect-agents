import { describe, expect, it } from "vitest";
import { initialState } from "../bus/types";
import { parseTopic } from "../parse/topic";
import { applyEvent } from "./registries";

const NS = "my-sam";

function ev(topic: string, ts: number, payload?: unknown) {
  const e = parseTopic(topic, NS, ts, payload);
  if (!e) throw new Error(`could not parse: ${topic}`);
  return e;
}

describe("applyEvent", () => {
  it("discovery upserts an agent and flags orchestrator by name", () => {
    const s = initialState();
    applyEvent(s, ev(`${NS}/a2a/v1/discovery/agentcards`, 100, {
      name: "OrchestratorAgent",
      description: "Routes work.",
      skills: [{ id: "plan", name: "Plan" }],
    }));
    const a = s.agents.get("OrchestratorAgent");
    expect(a?.isOrchestrator).toBe(true);
    expect(a?.description).toBe("Routes work.");
    expect(a?.skills).toHaveLength(1);
  });

  it("request creates target agent and task with target set", () => {
    const s = initialState();
    applyEvent(s, ev(`${NS}/a2a/v1/agent/request/Weather`, 200, { id: "task-1" }));
    expect(s.agents.has("Weather")).toBe(true);
    expect(s.tasks.get("task-1")?.targetAgent).toBe("Weather");
  });

  it("gateway status registers gateway and updates task source + status", () => {
    const s = initialState();
    applyEvent(s, ev(`${NS}/a2a/v1/agent/request/Weather`, 200, { id: "task-1" }));
    applyEvent(s, ev(`${NS}/a2a/v1/gateway/status/webui-1/task-1`, 250, { status: "working" }));
    const t = s.tasks.get("task-1");
    expect(t?.sourceGateway).toBe("webui-1");
    expect(t?.status).toBe("working");
    expect(s.gateways.get("webui-1")?.activeTasks).toBe(1);
  });

  it("gateway response closes the task and decrements active count", () => {
    const s = initialState();
    applyEvent(s, ev(`${NS}/a2a/v1/gateway/status/webui-1/task-1`, 250, { status: "working" }));
    applyEvent(s, ev(`${NS}/a2a/v1/gateway/response/webui-1/task-1`, 300, { status: "completed" }));
    const t = s.tasks.get("task-1");
    expect(t?.status).toBe("completed");
    expect(t?.endTime).toBe(300);
    expect(s.gateways.get("webui-1")?.activeTasks).toBe(0);
  });

  it("delegation status creates sub-task referencing delegating agent", () => {
    const s = initialState();
    applyEvent(s, ev(`${NS}/a2a/v1/agent/status/Orchestrator/sub-9`, 400, { status: "working" }));
    const sub = s.tasks.get("sub-9");
    expect(sub?.sourceAgent).toBe("Orchestrator");
    expect(sub?.status).toBe("working");
  });
});
