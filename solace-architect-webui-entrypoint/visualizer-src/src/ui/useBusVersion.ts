import { useEffect, useState } from "preact/hooks";
import type { EventBus } from "../bus/eventBus";

/**
 * Subscribe to the bus and bump a version counter on every event.
 * Components read state directly from bus.getState() and re-render when version changes.
 */
export function useBusVersion(bus: EventBus): number {
  const [version, setVersion] = useState(0);
  useEffect(() => bus.on(() => setVersion((v) => v + 1)), [bus]);
  return version;
}
