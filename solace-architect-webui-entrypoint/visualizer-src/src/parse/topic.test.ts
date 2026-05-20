import { describe, expect, it } from "vitest";
import { parseTopic } from "./topic";

const NS = "my-sam";
const T = 1_700_000_000_000;

describe("parseTopic", () => {
  it("returns null for topics outside the namespace prefix", () => {
    expect(parseTopic("other/a2a/v1/discovery/agentcards", NS, T)).toBeNull();
    expect(parseTopic("my-sam/something/else", NS, T)).toBeNull();
  });

  it("parses discovery topic", () => {
    const e = parseTopic(`${NS}/a2a/v1/discovery/agentcards`, NS, T);
    expect(e).toMatchObject({ kind: "discovery", namespace: NS, ts: T });
  });

  it("parses agent request and extracts target agent name", () => {
    const e = parseTopic(`${NS}/a2a/v1/agent/request/WeatherAgent`, NS, T);
    expect(e).toMatchObject({ kind: "request", agentName: "WeatherAgent" });
  });

  it("parses gateway status with gateway id and task id", () => {
    const e = parseTopic(
      `${NS}/a2a/v1/gateway/status/webui-7/task-abc123`,
      NS,
      T,
    );
    expect(e).toMatchObject({
      kind: "status",
      gatewayId: "webui-7",
      taskId: "task-abc123",
    });
  });

  it("parses gateway response with gateway id and task id", () => {
    const e = parseTopic(
      `${NS}/a2a/v1/gateway/response/slack-1/task-xyz`,
      NS,
      T,
    );
    expect(e).toMatchObject({
      kind: "response",
      gatewayId: "slack-1",
      taskId: "task-xyz",
    });
  });

  it("parses peer delegation status with delegating agent and sub task", () => {
    const e = parseTopic(
      `${NS}/a2a/v1/agent/status/OrchestratorAgent/sub-1`,
      NS,
      T,
    );
    expect(e).toMatchObject({
      kind: "delegation-status",
      delegatingAgent: "OrchestratorAgent",
      subTaskId: "sub-1",
    });
  });

  it("parses peer delegation response", () => {
    const e = parseTopic(
      `${NS}/a2a/v1/agent/response/OrchestratorAgent/sub-2`,
      NS,
      T,
    );
    expect(e).toMatchObject({
      kind: "delegation-response",
      delegatingAgent: "OrchestratorAgent",
      subTaskId: "sub-2",
    });
  });

  it("returns null for malformed topics under the a2a prefix", () => {
    expect(parseTopic(`${NS}/a2a/v1/agent/request`, NS, T)).toBeNull();
    expect(parseTopic(`${NS}/a2a/v1/gateway/status/onlyone`, NS, T)).toBeNull();
    expect(parseTopic(`${NS}/a2a/v1/unknown/thing`, NS, T)).toBeNull();
  });
});
