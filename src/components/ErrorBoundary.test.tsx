import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("Test error");
  }
  return <div>Child content</div>;
}

describe("ErrorBoundary", () => {
  const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    consoleSpy.mockClear();
  });

  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Child content")).toBeInTheDocument();
  });

  it("renders fallback UI when child throws", () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders custom fallback when provided", () => {
    render(
      <ErrorBoundary fallback={<div>Custom fallback</div>}>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Custom fallback")).toBeInTheDocument();
  });

  it("shows route name in error message when provided", () => {
    render(
      <ErrorBoundary routeName="Browse" reportPath="/browse">
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(
      screen.getByText(/in Browse/),
    ).toBeInTheDocument();
    expect(screen.getByText("Path: /browse")).toBeInTheDocument();
  });

  it("calls onError when child throws", () => {
    const onError = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary onError={onError} reportPath="/profile">
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe("Test error");
  });

  it("resets error state when Try Again is clicked", () => {
    const { rerender } = render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    rerender(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={false} />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByText("Try Again"));
    expect(screen.getByText("Child content")).toBeInTheDocument();
  });

  it("calls onReset when Try Again is clicked", () => {
    const onReset = vi.fn();
    render(
      <ErrorBoundary onReset={onReset}>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByText("Try Again"));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
