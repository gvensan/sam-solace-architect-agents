import { describe, expect, it, vi } from "vitest";
import { EventBus } from "./eventBus";
import { initialState } from "./types";
import { parseTopic } from "../parse/topic";

describe("EventBus", () => {
  it("dispatches to listeners after applying state", () => {
    const bus = new EventBus(initialState());
    const spy = vi.fn();
    bus.on(spy);
    const e = parseTopic("ns/a2a/v1/agent/request/Foo", "ns", 1, { id: "t1" })!;
    bus.dispatch(e);
    expect(spy).toHaveBeenCalledOnce();
    expect(bus.getState().tasks.get("t1")).toBeDefined();
    expect(bus.getHistory()).toHaveLength(1);
  });

  it("respects historyCap", () => {
    const bus = new EventBus(initialState(), { historyCap: 2 });
    for (let i = 0; i < 5; i++) {
      const e = parseTopic(`ns/a2a/v1/agent/request/A${i}`, "ns", i)!;
      bus.dispatch(e);
    }
    expect(bus.getHistory()).toHaveLength(2);
  });

  it("returns unsubscribe handle", () => {
    const bus = new EventBus(initialState());
    const spy = vi.fn();
    const off = bus.on(spy);
    off();
    const e = parseTopic("ns/a2a/v1/agent/request/A", "ns", 1)!;
    bus.dispatch(e);
    expect(spy).not.toHaveBeenCalled();
  });

  it("setHistoryCap prunes oversized history immediately", () => {
    const bus = new EventBus(initialState(), { historyCap: 10 });
    for (let i = 0; i < 8; i++) {
      bus.dispatch(parseTopic(`ns/a2a/v1/agent/request/A${i}`, "ns", i)!);
    }
    bus.setHistoryCap(3);
    expect(bus.getHistory()).toHaveLength(3);
  });

  it("defers state mutation for live events arriving during replay", () => {
    const bus = new EventBus(initialState());
    const e1 = parseTopic("ns/a2a/v1/agent/request/Foo", "ns", 100, { id: "t1" })!;
    bus.dispatch(e1);

    // Enter replay; state should clear but history is kept.
    bus.startReplay();
    expect(bus.getState().tasks.size).toBe(0);
    expect(bus.getHistory()).toHaveLength(1);

    // Live event lands during replay — recorded but not applied yet.
    const live = parseTopic("ns/a2a/v1/agent/request/Bar", "ns", 200, { id: "t2" })!;
    bus.dispatch(live);
    expect(bus.getHistory()).toHaveLength(2);
    expect(bus.getState().tasks.has("t2")).toBe(false);

    // Replay finishes; the deferred live event applies to state.
    bus.endReplay();
    expect(bus.getState().tasks.has("t2")).toBe(true);
  });

  it("replayDispatch applies state without growing history", () => {
    const bus = new EventBus(initialState());
    const e = parseTopic("ns/a2a/v1/agent/request/Foo", "ns", 1, { id: "tA" })!;
    bus.dispatch(e);
    const lenBefore = bus.getHistory().length;
    bus.startReplay();
    bus.replayDispatch(e);
    expect(bus.getHistory()).toHaveLength(lenBefore);
    expect(bus.getState().tasks.has("tA")).toBe(true);
    bus.endReplay();
  });

  it("clear empties history and exits replay mode", () => {
    const bus = new EventBus(initialState());
    bus.dispatch(parseTopic("ns/a2a/v1/agent/request/A", "ns", 1, { id: "x" })!);
    bus.startReplay();
    bus.clear();
    expect(bus.getHistory()).toHaveLength(0);
    expect(bus.isReplaying()).toBe(false);
  });
});
