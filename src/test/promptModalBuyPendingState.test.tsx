// @vitest-environment jsdom
/**
 * Test suite for Issue #434: Show transaction pending state on Buy button.
 *
 * Verifies that while a purchase transaction is in-flight, the Buy button
 * renders a spinner with "Processing..." text and is disabled.
 */
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { PromptModal } from "@/pages/browse/PromptModal";
import { renderWithProviders } from "@/test/render";
import { CartProvider } from "@/providers/CartProvider";

vi.mock("@/hooks/useNetworkState", () => ({
  useNetworkState: () => ({
    canTrustConfirmation: true,
    isCorrectNetwork: true,
    isLocalOrStandalone: false,
    currentNetwork: "TESTNET",
  }),
}));

// The component calls useAsyncTransaction twice:
//   1st call → runUnlock (isLoading: false)
//   2nd call → runPurchase (isLoading: true — simulates in-flight purchase)
let callCount = 0;
vi.mock("@/components/useAsyncTransaction", () => ({
  useAsyncTransaction: () => {
    callCount++;
    const isPurchaseCall = callCount % 2 === 0;
    return {
      execute: vi.fn().mockResolvedValue(undefined),
      isLoading: isPurchaseCall, // true only for the purchase hook
      error: null,
      data: null,
    };
  },
}));

vi.mock("@/lib/stellar/promptHashClient", () => ({
  PromptHashClient: class {
    static checkAccess = vi.fn().mockResolvedValue(false);
    static getPrompt = vi.fn().mockResolvedValue({
      id: "1",
      title: "Test Prompt",
      price: 10000000n,
      active: true,
      creator: "GCREATOR123456789012345678901234567890123456789012345678901234",
      category: "Art",
      image: "https://example.com/image.png",
      preview: "Preview text",
      contentHash: "abcdef1234567890",
    });
    getPrompt = vi.fn().mockResolvedValue({
      id: "1",
      title: "Test Prompt",
      price: 10000000n,
      active: true,
      creator: "GCREATOR123456789012345678901234567890123456789012345678901234",
      category: "Art",
      image: "https://example.com/image.png",
      preview: "Preview text",
      contentHash: "abcdef1234567890",
    });
    hasAccess = vi.fn().mockResolvedValue(false);
  },
  getPromptsByBuyer: vi.fn().mockResolvedValue([]),
}));

vi.mock(import("@/lib/checkout/feeEstimation"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    estimateSingleFee: vi.fn().mockResolvedValue({
      baseFee: "100",
      totalFee: "100",
      feeInXlm: "0.00001",
      surgeMultiplier: 1,
      isCongested: false,
    }),
  };
});

describe("PromptModal Buy Button Pending State (#434)", () => {
  it("renders pending state with spinner and disabled state when purchasing", async () => {
    callCount = 0; // reset counter before each test

    renderWithProviders(
      <CartProvider>
        <PromptModal
          itemId="1"
          isOpen={true}
          onClose={vi.fn()}
        />
      </CartProvider>,
      {
        wallet: {
          address: "GBUYER123456789012345678901234567890123456789012345678901234",
          network: "TESTNET",
          status: "connected",
        },
      }
    );

    // The buy button only renders in IDLE status; with isPurchasing=true it should
    // show "Processing..." and be disabled
    const button = await screen.findByRole("button", { name: /processing/i });
    expect(button).toBeInTheDocument();
    expect(button).toBeDisabled();
    expect(button.textContent).toContain("Processing...");
  });
});
