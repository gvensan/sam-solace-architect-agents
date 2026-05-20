import { useEffect, useState } from "preact/hooks";
import type { AnimationRegistry } from "../bus/animations";

/**
 * Subscribe to an AnimationRegistry and re-render on any change.
 * Returns the live active-set; consumers should call `.has(seq)` per row.
 */
export function useAnimations(reg: AnimationRegistry): ReadonlySet<number> {
  const [, setVersion] = useState(0);
  useEffect(() => reg.on(() => setVersion((v) => v + 1)), [reg]);
  return reg.get();
}
