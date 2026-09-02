import { Suspense, type ReactNode } from "react";
import { RouteErrorBoundary } from "./RouteErrorBoundary";

interface RouteBoundaryProps {
  routeName: string;
  children: ReactNode;
}

/** Wrap a lazy route element with a path-aware error boundary. */
export function RouteBoundary({ routeName, children }: RouteBoundaryProps) {
  return (
    <RouteErrorBoundary routeName={routeName}>{children}</RouteErrorBoundary>
  );
}

export function RouteLoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-[40vh] bg-slate-950">
      <div className="text-white text-lg">Loading...</div>
    </div>
  );
}

export function SuspenseRoute({
  routeName,
  children,
}: RouteBoundaryProps) {
  return (
    <RouteBoundary routeName={routeName}>
      <Suspense fallback={<RouteLoadingFallback />}>{children}</Suspense>
    </RouteBoundary>
  );
}
