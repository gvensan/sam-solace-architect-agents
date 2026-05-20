import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/eventBus";
import { initialState } from "../bus/types";
import { parseTopic } from "../parse/topic";
import { runReplay } from "./replay";

describe("runReplay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-applies history events to a cleared state and fires onCaughtUp", async () => {
    const bus = new EventBus(initialState());
    bus.dispatch(parseTopic("ns/a2a/v1/agent/request/Foo", "ns", 1000, { id: "t1" })!);
    bus.dispatch(parseTopic("ns/a2a/v1/agent/request/Bar", "ns", 1050, { id: "t2" })!);
    expect(bus.getState().tasks.size).toBe(2);

    const caughtUp = vi.fn();
    const done = vi.fn();
    runReplay(bus, { onCaughtUp: caughtUp, onDone: done });

    // After starting, state is cleared; tasks rebuild as replay progresses.
    expect(bus.getState().tasks.size).toBe(0);

    await vi.runAllTimersAsync();

    expect(bus.getState().tasks.has("t1")).toBe(true);
    expect(bus.getState().tasks.has("t2")).toBe(true);
    expect(caughtUp).toHaveBeenCalledOnce();
    expect(done).toHaveBeenCalledOnce();
    expect(bus.isReplaying()).toBe(false);
  });

  it("live events during replay land in history without animating", async () => {
    const bus = new EventBus(initialState());
    bus.dispatch(parseTopic("ns/a2a/v1/agent/request/Seed", "ns", 0, { id: "seed" })!);

    const animated: number[] = [];
    bus.on((e, _s, meta) => {
      if (e && meta?.animate) animated.push(e.seq ?? -1);
    });

    runReplay(bus, {});
    // While replay engine has not yet ticked, dispatch a live event.
    const live = parseTopic("ns/a2a/v1/agent/request/Live", "ns", 5, { id: "live" })!;
    bus.dispatch(live);

    // Live event recorded in history immediately.
    expect(bus.getHistory().length).toBeGreaterThanOrEqual(2);
    // But it was not animated (animate=false in meta).
    expect(animated).not.toContain(live.seq);

    await vi.runAllTimersAsync();
    // After replay ends, the deferred live event has been applied.
    expect(bus.getState().tasks.has("live")).toBe(true);
  });

  it("handles empty history gracefully", async () => {
    const bus = new EventBus(initialState());
    const done = vi.fn();
    runReplay(bus, { onDone: done });
    await vi.runAllTimersAsync();
    expect(done).toHaveBeenCalledOnce();
    expect(bus.isReplaying()).toBe(false);
  });
});
