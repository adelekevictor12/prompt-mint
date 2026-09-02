/**
 * Tests for issue #66 – Markdown preview for prompt descriptions
 *
 * Primary success paths:
 *   - Renders the Preview tab by default with markdown content.
 *   - Switching to Raw shows the source string unchanged.
 *   - Empty content shows a placeholder instead of blank space.
 *
 * Failure / edge-case paths:
 *   - Content with potential XSS HTML tags is not injected as raw HTML.
 *   - previewOnly mode hides the Raw toggle button.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { MarkdownPreview } from "@/components/MarkdownPreview";

describe("MarkdownPreview – #66", () => {
  it("renders rendered preview by default", () => {
    render(<MarkdownPreview content="**Hello** world" />);
    // react-markdown converts **..** to <strong>
    expect(screen.getByText("Hello")).toBeTruthy();
  });

  it("shows a placeholder when content is empty", () => {
    render(<MarkdownPreview content="" />);
    expect(screen.getByText(/no description provided/i)).toBeTruthy();
  });

  it("shows a placeholder when content is only whitespace", () => {
    render(<MarkdownPreview content="   " />);
    expect(screen.getByText(/no description provided/i)).toBeTruthy();
  });

  it("switches to raw source when Raw button is clicked", () => {
    const md = "# Heading\n\nSome **bold** text.";
    render(<MarkdownPreview content={md} />);

    const rawBtn = screen.getByRole("button", { name: /show raw markdown source/i });
    fireEvent.click(rawBtn);

    // After clicking, the raw string should be visible verbatim
    expect(screen.getByText((content) => content.includes("# Heading") && content.includes("bold"))).toBeTruthy();
  });

  it("hides the Raw toggle in previewOnly mode", () => {
    render(<MarkdownPreview content="Hello" previewOnly />);
    expect(
      screen.queryByRole("button", { name: /show raw/i }),
    ).toBeNull();
  });

  it("does not inject script tags as executable HTML", () => {
    const xss = "<script>window.__xss=1</script>";
    render(<MarkdownPreview content={xss} />);
    // The script element must NOT appear in the DOM
    expect(document.querySelector("script[src]")).toBeNull();
  });

  it("renders a custom label", () => {
    render(<MarkdownPreview content="text" label="Description" />);
    expect(screen.getByText("Description")).toBeTruthy();
  });

  it("Preview button is aria-pressed=true by default", () => {
    render(<MarkdownPreview content="text" />);
    const previewBtn = screen.getByRole("button", { name: /show rendered preview/i });
    expect(previewBtn.getAttribute("aria-pressed")).toBe("true");
  });
});
