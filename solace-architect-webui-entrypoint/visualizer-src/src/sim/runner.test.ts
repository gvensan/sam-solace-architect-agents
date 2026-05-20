import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/eventBus";
import { initialState } from "../bus/types";
import { SCENARIOS } from "./scenarios";
import { runScenario } from "./runner";

describe("runScenario", () => {
  it("dispatches every step of the simple scenario in order", async () => {
    vi.useFakeTimers();
    const bus = new EventBus(initialState());
    const simple = SCENARIOS.find((s) => s.id === "simple")!;
    const totalDelay = simple.steps.reduce((sum, s) => sum + s.delayMs, 0);
    runScenario(bus, simple, { speed: 100 });
    await vi.advanceTimersByTimeAsync(totalDelay / 100 + 10);
    expect(bus.getHistory()).toHaveLength(simple.steps.length);
    expect(bus.getState().agents.has("OrchestratorAgent")).toBe(true);
    expect(bus.getState().agents.has("WeatherAgent")).toBe(true);
    expect(bus.getState().tasks.get("task-100")?.status).toBe("completed");
    vi.useRealTimers();
  });

  it("stop() halts further dispatches", async () => {
    vi.useFakeTimers();
    const bus = new EventBus(initialState());
    const sim = SCENARIOS[0];
    const handle = runScenario(bus, sim, { speed: 100 });
    await vi.advanceTimersByTimeAsync(5);
    handle.stop();
    const after = bus.getHistory().length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(bus.getHistory().length).toBe(after);
    vi.useRealTimers();
  });
});
