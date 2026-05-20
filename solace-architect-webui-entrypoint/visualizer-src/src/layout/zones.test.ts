import { describe, expect, it } from "vitest";
import { initialState } from "../bus/types";
import { BROKER_NODE_ID, buildLayout, inferExternalLabel, ZONES } from "./zones";

describe("buildLayout", () => {
  it("places orchestrator and agents in distinct zones", () => {
    const s = initialState();
    s.agents.set("OrchestratorAgent", {
      name: "OrchestratorAgent",
      skills: [],
      lastSeen: 0,
      isOrchestrator: true,
    });
    s.agents.set("WeatherAgent", {
      name: "WeatherAgent",
      skills: [],
      lastSeen: 0,
      isOrchestrator: false,
    });
    s.gateways.set("webui-1", { id: "webui-1", firstSeen: 0, lastSeen: 0, activeTasks: 0 });
    const nodes = buildLayout({ state: s });
    const orch = nodes.find((n) => n.label === "OrchestratorAgent");
    const weather = nodes.find((n) => n.label === "WeatherAgent");
    const gw = nodes.find((n) => n.label === "webui-1");
    expect(orch?.zone).toBe("orchestrator");
    expect(weather?.zone).toBe("agent");
    expect(gw?.zone).toBe("gateway");
  });

  it("marks stale agents", () => {
    const s = initialState();
    s.agents.set("OldAgent", { name: "OldAgent", skills: [], lastSeen: 0, isOrchestrator: false });
    const nodes = buildLayout({ state: s, stale: new Set(["OldAgent"]) });
    expect(nodes.find((n) => n.label === "OldAgent")?.stale).toBe(true);
  });

  it("ZONES ordered left to right", () => {
    const xs = ZONES.map((z) => z.xRatio);
    const sorted = [...xs].sort((a, b) => a - b);
    expect(xs).toEqual(sorted);
  });

  it("derives external nodes from gateway names with heuristics", () => {
    const s = initialState();
    s.gateways.set("cli-entrypoint-01", { id: "cli-entrypoint-01", firstSeen: 0, lastSeen: 0, activeTasks: 0 });
    s.gateways.set("a2a_webui_app", { id: "a2a_webui_app", firstSeen: 0, lastSeen: 0, activeTasks: 0 });
    s.gateways.set("slack-bot-2", { id: "slack-bot-2", firstSeen: 0, lastSeen: 0, activeTasks: 0 });
    s.gateways.set("custom-thing", { id: "custom-thing", firstSeen: 0, lastSeen: 0, activeTasks: 0 });
    const nodes = buildLayout({ state: s });
    const externals = nodes.filter((n) => n.kind === "external").map((n) => n.label).sort();
    expect(externals).toEqual(["CLI", "Client", "Slack", "Web UI"]);
  });

  it("falls back to 'Client' for unrecognised gateway names", () => {
    expect(inferExternalLabel("custom-handler")).toBe("Client");
    expect(inferExternalLabel("webui-1")).toBe("Web UI");
    expect(inferExternalLabel("slack-1")).toBe("Slack");
    expect(inferExternalLabel("cli-foo")).toBe("CLI");
  });

  it("shows no externals when no gateways are observed", () => {
    const s = initialState();
    const nodes = buildLayout({ state: s });
    expect(nodes.filter((n) => n.kind === "external")).toHaveLength(0);
  });

  it("wraps a dense lane into multiple columns instead of overflowing", () => {
    const s = initialState();
    for (let i = 0; i < 10; i++) {
      const name = `AgentNumber${i.toString().padStart(2, "0")}`;
      s.agents.set(name, { name, skills: [], lastSeen: 0, isOrchestrator: false });
    }
    const nodes = buildLayout({ state: s });
    const agents = nodes.filter((n) => n.kind === "agent");
    const distinctXs = new Set(agents.map((n) => Math.round(n.x)));
    // 10 agents > vertical capacity, so the lane should split into 2+ columns.
    expect(distinctXs.size).toBeGreaterThan(1);
    // Multi-column nodes are narrower than the default 140px.
    expect(agents[0].width).toBeLessThan(140);
    // No node should be clipped above the lane label or below the canvas.
    for (const n of agents) {
      expect(n.y).toBeGreaterThanOrEqual(80);
      expect(n.y + n.height).toBeLessThanOrEqual(720);
    }
  });

  it("always places the broker node in the mesh lane", () => {
    const empty = initialState();
    const emptyNodes = buildLayout({ state: empty });
    const broker = emptyNodes.find((n) => n.id === BROKER_NODE_ID);
    expect(broker).toBeDefined();
    expect(broker?.kind).toBe("broker");
    expect(broker?.zone).toBe("mesh");

    const populated = initialState();
    populated.agents.set("A", { name: "A", skills: [], lastSeen: 0, isOrchestrator: false });
    populated.gateways.set("webui-1", { id: "webui-1", firstSeen: 0, lastSeen: 0, activeTasks: 0 });
    const populatedBroker = buildLayout({ state: populated }).find((n) => n.id === BROKER_NODE_ID);
    expect(populatedBroker).toBeDefined();
    // Broker stays put regardless of how many agents have been discovered.
    expect(populatedBroker?.x).toBe(broker?.x);
  });

  it("keeps a single-column lane at full node width", () => {
    const s = initialState();
    s.agents.set("Solo", { name: "Solo", skills: [], lastSeen: 0, isOrchestrator: false });
    const nodes = buildLayout({ state: s });
    const agent = nodes.find((n) => n.kind === "agent");
    expect(agent?.width).toBe(140);
  });
});
