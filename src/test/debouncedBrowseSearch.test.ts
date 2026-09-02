import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebounce } from "../hooks/useDebounce";

describe("Browse Search Input Debouncing & Memoization (#432)", () => {
  vi.useFakeTimers();

  it("debounces rapid input changes before propagating downstream", () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 300), {
      initialProps: { value: "a" },
    });

    expect(result.current).toBe("a");

    // Rapid keystrokes
    rerender({ value: "ab" });
    rerender({ value: "abc" });
    rerender({ value: "abcd" });

    // Has not settled yet (before 300ms)
    expect(result.current).toBe("a");

    // Advance timer past debounce threshold
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current).toBe("abcd");
  });
});
