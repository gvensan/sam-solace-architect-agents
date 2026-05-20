import { describe, expect, it, beforeEach } from "vitest";
import { initialState } from "../bus/types";
import { inferParentTaskId, nextTaskColor, resetPaletteCursor, shortTaskId, TASK_PALETTE } from "./colors";

describe("shortTaskId", () => {
  it("strips common SAM task prefixes", () => {
    expect(shortTaskId("gdk-task-bad246e45-abcdef")).toBe("bad246e4");
    expect(shortTaskId("a2a_subtask_85dfb0e1a2b3")).toBe("85dfb0e1");
    expect(shortTaskId("a2a_task_xyz0123456")).toBe("xyz01234");
    expect(shortTaskId("task-100")).toBe("100");
    expect(shortTaskId("sub-100a")).toBe("100a");
  });

  it("leaves unprefixed ids alone except for length truncation", () => {
    expect(shortTaskId("abcdef12345")).toBe("abcdef12");
    expect(shortTaskId("short")).toBe("short");
  });
});

describe("nextTaskColor", () => {
  beforeEach(() => resetPaletteCursor());

  it("rotates through the palette", () => {
    const seen = TASK_PALETTE.map(() => nextTaskColor());
    expect(seen).toEqual([...TASK_PALETTE]);
  });

  it("wraps when palette is exhausted", () => {
    for (let i = 0; i < TASK_PALETTE.length; i++) nextTaskColor();
    expect(nextTaskColor()).toBe(TASK_PALETTE[0]);
  });
});

describe("inferParentTaskId", () => {
  it("returns the most recent in-flight task on a non-target agent", () => {
    const s = initialState();
    s.agents.set("Orchestrator", {
      name: "Orchestrator", skills: [], lastSeen: 100, isOrchestrator: true,
      currentTaskIds: ["T1"],
    });
    s.tasks.set("T1", {
      id: "T1", sourceGateway: "gw", sourceAgent: null, targetAgent: "Orchestrator",
      status: "working", startTime: 100, endTime: null, subTasks: [], parentTask: null, color: "#3b82f6",
    });
    const parent = inferParentTaskId(s, "Weather", 200);
    expect(parent).toBe("T1");
  });

  it("ignores the target agent's own tasks", () => {
    const s = initialState();
    s.agents.set("Weather", {
      name: "Weather", skills: [], lastSeen: 100, isOrchestrator: false,
      currentTaskIds: ["Tself"],
    });
    s.tasks.set("Tself", {
      id: "Tself", sourceGateway: null, sourceAgent: null, targetAgent: "Weather",
      status: "working", startTime: 100, endTime: null, subTasks: [], parentTask: null, color: null,
    });
    expect(inferParentTaskId(s, "Weather", 200)).toBeNull();
  });
});
