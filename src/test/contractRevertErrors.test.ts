import { describe, it, expect } from "vitest";
import { classifyContractError, CONTRACT_ERROR_CODES, formatContractErrorMessage } from "../lib/stellar/promptHashClient";
import { translateError } from "../lib/i18n-errors";

describe("Contract Revert Reason Decoding (#443)", () => {
  it("decodes Soroban contract revert Error(Contract, #1) as ALREADY_PURCHASED", () => {
    const error = "HostError: Error(Contract, #1)";
    const details = classifyContractError(error);
    expect(details.code).toBe(CONTRACT_ERROR_CODES.ALREADY_PURCHASED);
    expect(details.message).toContain("already have access");
  });

  it("decodes Soroban contract revert Error(Contract, #2) as PROMPT_NOT_FOUND", () => {
    const error = "Error(Contract, #2)";
    const details = classifyContractError(error);
    expect(details.code).toBe(CONTRACT_ERROR_CODES.PROMPT_NOT_FOUND);
    expect(details.message).toContain("could not be found");
  });

  it("decodes Soroban contract revert Error(Contract, #4) as CONTRACT_PAUSED", () => {
    const error = "ContractError(4)";
    const details = classifyContractError(error);
    expect(details.code).toBe(CONTRACT_ERROR_CODES.CONTRACT_PAUSED);
    expect(details.message).toContain("marketplace is temporarily paused");
  });

  it("formats user-readable error message via formatContractErrorMessage", () => {
    const msg = formatContractErrorMessage("Error(Contract, #6)");
    expect(msg).toContain("no longer available for purchase");
  });

  it("surfaces decoded contract error message in translateError", () => {
    const translated = translateError("Error(Contract, #1)");
    expect(translated).toBe("You already have access to this prompt.");
  });
});
