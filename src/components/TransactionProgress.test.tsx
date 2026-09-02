import { useEffect } from "react";
import { screen } from "@testing-library/react";
import { within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { useTransactionFeedback } from "./TransactionProvider";
import { TransactionProgress } from "./TransactionProgress";

function PendingHarness() {
  const { addTransaction } = useTransactionFeedback();

  useEffect(() => {
    addTransaction({
      id: "tx-pending",
      status: "pending",
      message: "Processing listing on-chain...",
    });
  }, [addTransaction]);

  return null;
}

function ErrorHarness() {
  const { addTransaction } = useTransactionFeedback();

  useEffect(() => {
    addTransaction({
      id: "tx-error",
      status: "error",
      message: "You are not authorized to complete this transaction.",
      retryAction: () => undefined,
    });
  }, [addTransaction]);

  return null;
}

function SuccessHarness() {
  const { addTransaction } = useTransactionFeedback();

  useEffect(() => {
    addTransaction({
      id: "tx-success",
      status: "success",
      message: "Listing published successfully.",
    });
  }, [addTransaction]);

  return null;
}

describe("TransactionProgress", () => {
  it("renders pending transaction progress for in-flight mutations", () => {
    renderWithProviders(
      <>
        <TransactionProgress />
        <PendingHarness />
      </>,
    );

    const progress = screen.getAllByRole("alert")[0];
    expect(within(progress).getByText("Processing listing on-chain...")).toBeInTheDocument();
  });

  it("renders error state and retry affordance for failed mutations", () => {
    renderWithProviders(
      <>
        <TransactionProgress />
        <ErrorHarness />
      </>,
    );

    const progress = screen.getAllByRole("alert")[0];
    expect(within(progress).getByText("You are not authorized to complete this transaction.")).toBeInTheDocument();
    expect(within(progress).getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("renders the success state for completed mutations", () => {
    renderWithProviders(
      <>
        <TransactionProgress />
        <SuccessHarness />
      </>,
    );

    const progress = screen.getAllByRole("alert")[0];
    expect(within(progress).getByText("Listing published successfully.")).toBeInTheDocument();
  });
});
