import React from "react";

// Synchronous mock for next/dynamic used in vitest.
// It immediately invokes the loader promise and wraps the result in a
// React.lazy + Suspense pair, then flushes the promise in the same
// microtask queue so tests see the real component after a single act() cycle.
export default function dynamic<P extends object>(
  loader: () => Promise<
    React.ComponentType<P> | { default: React.ComponentType<P> }
  >,
  _options?: unknown,
): React.ComponentType<P> {
  const LazyComponent = React.lazy(() =>
    loader().then((mod) => {
      if (typeof mod === "function")
        return { default: mod as React.ComponentType<P> };
      if (mod && "default" in mod)
        return mod as { default: React.ComponentType<P> };
      return { default: (() => null) as unknown as React.ComponentType<P> };
    }),
  );

  function DynamicComponent(props: P) {
    return React.createElement(
      React.Suspense,
      { fallback: null },
      React.createElement(LazyComponent, props),
    );
  }
  DynamicComponent.displayName = "DynamicMock";
  return DynamicComponent;
}
