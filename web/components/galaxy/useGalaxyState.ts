import { useState, useCallback } from "react";

export type GalaxyLevel =
  | { type: "overview" }
  | { type: "cluster"; clusterId: string; label: string }
  | { type: "service"; service: string }
  | { type: "gravity"; focalNodeId: string };

export function useGalaxyState() {
  const [stack, setStack] = useState<GalaxyLevel[]>([{ type: "overview" }]);
  const current = stack[stack.length - 1];

  const push = useCallback((level: GalaxyLevel) => {
    setStack((s) => [...s, level]);
  }, []);

  const pop = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);

  const reset = useCallback(() => {
    setStack([{ type: "overview" }]);
  }, []);

  return { current, stack, push, pop, reset, canGoBack: stack.length > 1 };
}
