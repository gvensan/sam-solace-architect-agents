import type { EventBus } from "../bus/eventBus";
import { parseTopic } from "../parse/topic";
import { SIM_NAMESPACE, type Scenario } from "./scenarios";

export interface SimulationOptions {
  speed?: number;
  loop?: boolean;
  namespace?: string;
}

export interface SimulationHandle {
  stop: () => void;
}

/**
 * Play a scenario by dispatching its steps onto the bus with original timing.
 * Lives entirely in user-land timers so it can be paused/stopped at any time.
 */
export function runScenario(
  bus: EventBus,
  scenario: Scenario,
  opts: SimulationOptions = {},
): SimulationHandle {
  const speed = opts.speed ?? 1;
  const ns = opts.namespace ?? SIM_NAMESPACE;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const playOnce = () => {
    let i = 0;
    const step = () => {
      if (cancelled || i >= scenario.steps.length) {
        if (!cancelled && opts.loop) {
          timer = setTimeout(playOnce, 800 / speed);
        }
        return;
      }
      const s = scenario.steps[i++];
      timer = setTimeout(() => {
        if (cancelled) return;
        const now = Date.now();
        const event = parseTopic(s.topic, ns, now, s.payload);
        if (event) bus.dispatch(event);
        step();
      }, s.delayMs / speed);
    };
    step();
  };

  playOnce();

  return {
    stop: () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    },
  };
}
