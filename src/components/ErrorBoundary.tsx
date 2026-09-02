import { Component, type ReactNode, type ErrorInfo } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import { cn } from "@/lib/utils";
import { reportRouteError } from "@/lib/observability/reportRouteError";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  className?: string;
  routeName?: string;
  /** Current URL pathname for user-facing fallback and error reports. */
  reportPath?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);

    reportRouteError({
      routeName: this.props.routeName,
      reportPath: this.props.reportPath ?? window.location.pathname,
      error,
      errorInfo,
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onReset?.();
  };

  handleGoHome = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.href = "/";
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          className={cn(
            "flex flex-col items-center justify-center min-h-[400px] p-8 text-center",
            "bg-slate-900/50 rounded-2xl border border-white/10",
            this.props.className,
          )}
          role="alert"
        >
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 mb-6">
            <AlertTriangle className="w-8 h-8 text-red-400" />
          </div>

          <h2 className="text-xl font-semibold text-white mb-2">
            Something went wrong
          </h2>

          <p className="text-slate-400 text-sm max-w-md mb-2">
            An unexpected error occurred
            {this.props.routeName ? ` in ${this.props.routeName}` : ""}. You can
            try refreshing this section or return to the home page.
          </p>

          {(this.props.reportPath ?? window.location.pathname) && (
            <p className="text-slate-500 text-xs font-mono mb-2">
              Path: {this.props.reportPath ?? window.location.pathname}
            </p>
          )}

          {import.meta.env.DEV && this.state.error && (
            <details className="w-full max-w-lg mt-4 text-left">
              <summary className="cursor-pointer text-sm text-slate-500 hover:text-slate-300 transition-colors">
                Error details (dev only)
              </summary>
              <pre className="mt-2 p-4 rounded-lg bg-slate-950 border border-white/5 text-xs text-red-300 overflow-x-auto">
                {this.state.error.message}
                {"\n\n"}
                {this.state.errorInfo?.componentStack}
              </pre>
            </details>
          )}

          <div className="flex items-center gap-3 mt-6">
            <button
              onClick={this.handleReset}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium",
                "bg-white/10 text-white hover:bg-white/20 transition-colors",
                "border border-white/10",
              )}
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </button>
            <button
              onClick={this.handleGoHome}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium",
                "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 transition-colors",
                "border border-emerald-500/20",
              )}
            >
              <Home className="w-4 h-4" />
              Go Home
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
