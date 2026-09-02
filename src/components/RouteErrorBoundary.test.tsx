import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RouteErrorBoundary } from "./RouteErrorBoundary";

function ThrowingComponent() {
  throw new Error("Route crash");
}

describe("RouteErrorBoundary", () => {
  it("shows the current route path in the fallback UI", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <MemoryRouter initialEntries={["/browse"]}>
        <RouteErrorBoundary routeName="Browse">
          <ThrowingComponent />
        </RouteErrorBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Path: /browse")).toBeInTheDocument();
    expect(screen.getByText(/in Browse/)).toBeInTheDocument();
  });
});
