// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { reportRouteError } from "./reportRouteError";

describe("reportRouteError", () => {
  it("logs a structured route error with path and route name", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    reportRouteError({
      routeName: "Browse",
      reportPath: "/browse",
      error: new Error("Render failed"),
    });

    expect(errorSpy).toHaveBeenCalled();
    const [message] = errorSpy.mock.calls[0];
    expect(String(message)).toContain("[route-error]");
    expect(String(message)).toContain("/browse");
  });
});
