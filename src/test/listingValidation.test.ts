import { describe, it, expect } from "vitest";
import {
  utf8Length,
  validateListingForm,
  type ListingFormInput,
} from "../lib/validation/listing";

function makeInput(overrides: Partial<ListingFormInput> = {}): ListingFormInput {
  return {
    imageUrl: "https://example.com/cover.png",
    title: "A good descriptive title",
    category: "technical",
    previewText: "This is a useful preview of the prompt contents.",
    fullPrompt: "Paste your full prompt content here for buyers.",
    priceXlm: "1",
    ...overrides,
  };
}

describe("utf8Length", () => {
  it("counts UTF-8 bytes, not UTF-16 code units (#506)", () => {
    expect(utf8Length("abc")).toBe(3); // 1 byte per ASCII char
    expect(utf8Length("😀")).toBe(4); // emoji = 4 UTF-8 bytes
    expect(utf8Length("😀".repeat(70))).toBe(280);
  });
});

describe("validateListingForm UTF-8 (emoji) handling (#506)", () => {
  it("accepts a title whose UTF-8 bytes are within the on-chain limit", () => {
    // 30 emoji = 120 UTF-8 bytes == LISTING_LIMITS.title exactly.
    const errors = validateListingForm(makeInput({ title: "😀".repeat(30) }));
    expect(errors.title).toBeUndefined();
  });

  it("rejects a title whose UTF-8 bytes exceed the limit even when UTF-16 length fits", () => {
    // 61 emoji = 122 UTF-16 units but 244 UTF-8 bytes > 120.
    const errors = validateListingForm(makeInput({ title: "😀".repeat(61) }));
    expect(errors.title).toMatch(/120 bytes/);
  });

  it("accepts a preview whose UTF-8 bytes are within the on-chain limit", () => {
    // 70 emoji = 280 UTF-8 bytes == LISTING_LIMITS.preview exactly.
    const errors = validateListingForm(makeInput({ previewText: "😀".repeat(70) }));
    expect(errors.previewText).toBeUndefined();
  });

  it("rejects a preview whose UTF-8 bytes exceed the limit", () => {
    // 278 ASCII + 1 emoji = 282 UTF-8 bytes > 280, while the JS `.length`
    // would have been 278 + 2 = 280 (the pre-fix bug).
    const errors = validateListingForm(
      makeInput({ previewText: "a".repeat(278) + "😀" }),
    );
    expect(errors.previewText).toMatch(/280 bytes/);
  });
});
