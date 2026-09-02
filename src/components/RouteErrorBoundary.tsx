import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { ErrorBoundary } from "./ErrorBoundary";

interface RouteErrorBoundaryProps {
  children: ReactNode;
  routeName: string;
}

/**
 * Route-scoped error boundary that binds the current pathname for fallback UI
 * and structured error reporting.
 */
export function RouteErrorBoundary({
  children,
  routeName,
}: RouteErrorBoundaryProps) {
  const { pathname } = useLocation();

  return (
    <ErrorBoundary routeName={routeName} reportPath={pathname}>
      {children}
    </ErrorBoundary>
  );
}
