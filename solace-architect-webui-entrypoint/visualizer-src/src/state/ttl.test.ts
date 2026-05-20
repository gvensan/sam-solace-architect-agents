import { describe, expect, it } from "vitest";
import { initialState } from "../bus/types";
import { staleAgents, AGENT_TTL_MS } from "./ttl";

describe("staleAgents", () => {
  it("returns agents past TTL", () => {
    const s = initialState();
    s.agents.set("Old", { name: "Old", skills: [], lastSeen: 0, isOrchestrator: false });
    s.agents.set("Fresh", { name: "Fresh", skills: [], lastSeen: AGENT_TTL_MS, isOrchestrator: false });
    const stale = staleAgents(s, AGENT_TTL_MS + 1);
    expect(stale).toEqual(["Old"]);
  });
});
