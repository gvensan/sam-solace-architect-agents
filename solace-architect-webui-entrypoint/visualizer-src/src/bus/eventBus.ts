import type { A2AEvent, MeshState } from "./types";
import { applyEvent } from "../state/registries";
import { resetPaletteCursor } from "../state/colors";

export interface DispatchMeta {
  /** If true, the listener should animate this event on the canvas. False for
   * live events that arrived during a replay — those are recorded but their
   * state mutation is deferred until the replay catches up. */
  animate: boolean;
  /** True when the event was produced by the replay engine re-applying history. */
  replay: boolean;
}

export type EventListener = (
  event: A2AEvent | null,
  state: MeshState,
  meta?: DispatchMeta,
) => void;

const DEFAULT_HISTORY_CAP = 5000;

/**
 * Single dispatch point. Live broker traffic, simulation, and replay all push
 * events here. The reducer mutates state, then listeners are notified.
 * A null event signals "state was reset" — UI subscribers should re-read state.
 */
export class EventBus {
  private listeners = new Set<EventListener>();
  private history: A2AEvent[] = [];
  private historyCap: number;
  private seq = 0;
  private replayMode = false;
  /** Live events received during replay. Recorded to history immediately but
   * not applied to state until replay completes, so the replay's state
   * progression isn't muddled by interleaved live traffic. */
  private deferred: A2AEvent[] = [];

  constructor(private state: MeshState, opts: { historyCap?: number } = {}) {
    this.historyCap = opts.historyCap ?? DEFAULT_HISTORY_CAP;
  }

  getState(): MeshState {
    return this.state;
  }

  getHistory(): readonly A2AEvent[] {
    return this.history;
  }

  getHistoryCap(): number {
    return this.historyCap;
  }

  /** Resize the rolling history. Older entries are pruned immediately if the
   * new cap is smaller. Pass Infinity for unbounded capture. */
  setHistoryCap(cap: number): void {
    this.historyCap = Math.max(1, cap);
    this.prune();
  }

  isReplaying(): boolean {
    return this.replayMode;
  }

  on(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispatch(event: A2AEvent): void {
    this.seq++;
    const tagged: A2AEvent = { ...event, seq: this.seq };
    this.history.push(tagged);
    this.prune();
    if (this.replayMode) {
      // Defer state mutation until replay finishes. Notify listeners so the
      // event still appears in the timeline list, but flag it as non-animating
      // so the canvas doesn't show two streams of motion at once.
      this.deferred.push(tagged);
      this.notify(tagged, { animate: false, replay: false });
      return;
    }
    applyEvent(this.state, tagged);
    this.notify(tagged, { animate: true, replay: false });
  }

  /**
   * Re-apply a historical event to state without re-recording it. Used by the
   * replay engine. Listeners are notified with animate=true so the canvas
   * replays the visual flow.
   */
  replayDispatch(event: A2AEvent): void {
    applyEvent(this.state, event);
    this.notify(event, { animate: true, replay: true });
  }

  /** Enter replay mode. Resets registries (so the canvas starts blank) but
   * keeps history. Live events arriving while replay is active are queued. */
  startReplay(): void {
    this.replayMode = true;
    this.deferred = [];
    this.state.agents.clear();
    this.state.gateways.clear();
    this.state.tasks.clear();
    resetPaletteCursor();
    this.notify(null, { animate: false, replay: true });
  }

  /** Leave replay mode. Apply any live events that arrived during replay so
   * state matches reality before live animation resumes. They were already
   * recorded into history; only the apply step was deferred. */
  endReplay(): void {
    for (const e of this.deferred) {
      applyEvent(this.state, e);
    }
    this.deferred = [];
    this.replayMode = false;
    // Tell listeners state caught up; canvas reads state directly via version.
    this.notify(null, { animate: false, replay: false });
  }

  /** Wipe history and registries; notify listeners with a null event. */
  clear(): void {
    this.state.agents.clear();
    this.state.gateways.clear();
    this.state.tasks.clear();
    this.history = [];
    this.deferred = [];
    this.replayMode = false;
    resetPaletteCursor();
    this.notify(null, { animate: false, replay: false });
  }

  private notify(event: A2AEvent | null, meta: DispatchMeta): void {
    for (const fn of this.listeners) fn(event, this.state, meta);
  }

  private prune(): void {
    if (this.history.length > this.historyCap) {
      this.history.splice(0, this.history.length - this.historyCap);
    }
  }
}
