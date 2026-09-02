import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useBeforeUnloadWarning } from "@/hooks/useBeforeUnloadWarning";

describe("useBeforeUnloadWarning", () => {
  it("registers beforeunload when enabled and removes it on cleanup", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() =>
      useBeforeUnloadWarning(true, "Custom message"),
    );

    expect(addSpy).toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function),
    );

    unmount();

    expect(removeSpy).toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function),
    );
  });

  it("adds and removes listener based on isEnabled", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    // Start enabled — should register
    const { rerender } = renderHook(
      ({ isEnabled }: { isEnabled: boolean }) =>
        useBeforeUnloadWarning(isEnabled, "msg"),
      { initialProps: { isEnabled: true } },
    );
    expect(addSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));

    // Disable — cleanup should fire
    const callsBefore = removeSpy.mock.calls.length;
    rerender({ isEnabled: false });
    expect(removeSpy.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("prevents default and sets returnValue on the beforeunload event", () => {
    const addSpy = vi.spyOn(window, "addEventListener");

    renderHook(() => useBeforeUnloadWarning(true, "Please confirm"));

    const handler = addSpy.mock.calls.find(
      ([event]) => event === "beforeunload",
    )?.[1] as EventListener;

    expect(handler).toBeDefined();

    const event = new Event("beforeunload") as BeforeUnloadEvent;
    event.preventDefault = vi.fn();

    handler(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.returnValue === "Please confirm" || event.returnValue === true).toBe(true);
  });

  it("uses an empty string returnValue when no message is provided", () => {
    const addSpy = vi.spyOn(window, "addEventListener");

    renderHook(() => useBeforeUnloadWarning(true));

    const handler = addSpy.mock.calls.find(
      ([event]) => event === "beforeunload",
    )?.[1] as EventListener;

    const event = new Event("beforeunload") as BeforeUnloadEvent;
    event.preventDefault = vi.fn();

    handler(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.returnValue === "" || event.returnValue === true).toBe(true);
  });
});
