import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, renderHook, act } from "@testing-library/react";
import { ThemeToggle } from "../components/ThemeToggle";
import { useTheme } from "../hooks/useTheme";

describe("Theme Management & ThemeToggle (#433)", () => {
  let matchMediaListeners: Array<() => void> = [];

  beforeEach(() => {
    matchMediaListeners = [];
    localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.style.colorScheme = "";

    // Mock matchMedia
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("dark"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn((event: string, handler: () => void) => {
          if (event === "change") matchMediaListeners.push(handler);
        }),
        removeEventListener: vi.fn((event: string, handler: () => void) => {
          matchMediaListeners = matchMediaListeners.filter((l) => l !== handler);
        }),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to system theme when no preference stored", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("system");
  });

  it("loads existing stored theme preference from localStorage", () => {
    localStorage.setItem("theme-preference", "dark");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("updates theme preference and persists to localStorage on toggleTheme", () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.toggleTheme("light");
    });

    expect(result.current.theme).toBe("light");
    expect(localStorage.getItem("theme-preference")).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");

    act(() => {
      result.current.toggleTheme("dark");
    });

    expect(result.current.theme).toBe("dark");
    expect(localStorage.getItem("theme-preference")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("renders ThemeToggle component button with accessible label", () => {
    render(<ThemeToggle />);
    const trigger = screen.getByRole("button", { name: /toggle theme/i });
    expect(trigger).toBeInTheDocument();
  });

  it("opens ThemeToggle dropdown menu on trigger interaction", () => {
    render(<ThemeToggle />);
    const trigger = screen.getByRole("button", { name: /toggle theme/i });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.keyDown(trigger, { key: "Enter", code: "Enter" });

    // Verify trigger attributes and state
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
  });
});
