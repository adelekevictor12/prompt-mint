import type { ErrorInfo } from "react";

export interface RouteErrorReport {
  routeName?: string;
  reportPath: string;
  error: Error;
  errorInfo?: ErrorInfo;
}

/**
 * Report a caught render error with the route path so failures are diagnosable
 * without exposing prompt content or wallet addresses.
 */
export function reportRouteError({
  routeName,
  reportPath,
  error,
  errorInfo,
}: RouteErrorReport): void {
  const label = routeName ? `${routeName} (${reportPath})` : reportPath;

  if (import.meta.env.DEV) {
    console.error(`[route-error] ${label}`, error, errorInfo);
    return;
  }

  console.error(
    `[route-error] path=${reportPath}${
      routeName ? ` route=${routeName}` : ""
    } message=${error.name}`,
  );
}
