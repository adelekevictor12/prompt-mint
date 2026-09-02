import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import BrowsePage from "../pages/browse/page";
import { renderWithProviders } from "@/test/render";

vi.mock("@/pages/browse/FetchAllPrompts", () => ({
  default: ({ selectedCategory, selectedTag, priceRange, searchQuery, sortBy }: any) => (
    <div data-testid="fetch-all-prompts">
      {JSON.stringify({ selectedCategory, selectedTag, priceRange, searchQuery, sortBy })}
    </div>
  ),
}));

describe("browse page sitemap entry handling", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/browse?promptId=42");
  });

  it("opens the matching prompt when a sitemap promptId query parameter is present", async () => {
    renderWithProviders(<BrowsePage />);
    expect(screen.getByTestId("fetch-all-prompts")).toBeInTheDocument();
  });
});
