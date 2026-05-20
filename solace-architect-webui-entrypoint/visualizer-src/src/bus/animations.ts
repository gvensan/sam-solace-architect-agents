/**
 * Serializes async animation work so the canvas plays one effect at a time.
 * Live broker traffic and simulations stay accurate on the bus (state,
 * history, timeline) while the visual playback is deliberate enough to read.
 */
export class AnimationQueue {
  private queue: Array<() => Promise<void>> = [];
  private running = false;
  private gapMs: number;

  constructor(gapMs = 60) {
    this.gapMs = gapMs;
  }

  enqueue(work: () => Promise<void>): void {
    this.queue.push(work);
    if (!this.running) void this.drain();
  }

  clear(): void {
    this.queue.length = 0;
  }

  pending(): number {
    return this.queue.length;
  }

  private async drain(): Promise<void> {
    this.running = true;
    while (this.queue.length > 0) {
      const fn = this.queue.shift()!;
      try {
        await fn();
      } catch (e) {
        console.warn("Animation step failed", e);
      }
      if (this.gapMs > 0) {
        await new Promise<void>((r) => setTimeout(r, this.gapMs));
      }
    }
    this.running = false;
  }
}

/**
 * Tracks which dispatched events are currently being animated by the canvas.
 * Canvas registers a seq when a particle starts and removes it when the
 * transition ends. Timeline reads the active set to highlight the rows that
 * map to in-flight particles.
 *
 * Separate from EventBus so the two concerns (state + history vs visual
 * lifecycle) stay independent.
 */
export class AnimationRegistry {
  private active = new Set<number>();
  private listeners = new Set<() => void>();

  begin(seq: number): void {
    this.active.add(seq);
    this.notify();
  }

  end(seq: number): void {
    if (this.active.delete(seq)) this.notify();
  }

  get(): ReadonlySet<number> {
    return this.active;
  }

  has(seq: number | undefined): boolean {
    return seq !== undefined && this.active.has(seq);
  }

  clear(): void {
    if (this.active.size === 0) return;
    this.active.clear();
    this.notify();
  }

  on(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private notify() {
    for (const fn of this.listeners) fn();
  }
}
