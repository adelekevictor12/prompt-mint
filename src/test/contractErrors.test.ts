import { describe, expect, it } from "vitest";
import {
  CONTRACT_ERROR_CODES,
  classifyContractError,
  formatContractErrorMessage,
} from "@/lib/stellar/promptHashClient";

describe("contract error mapping", () => {
  it("maps pause errors to a clear marketplace pause code", () => {
    const result = classifyContractError("ContractIsPaused");

    expect(result.code).toBe(CONTRACT_ERROR_CODES.CONTRACT_PAUSED);
    expect(result.message).toContain("paused");
    expect(result.isUserActionable).toBe(true);
  });

  it("maps missing prompt errors to a prompt lookup code", () => {
    const result = classifyContractError("PromptNotFound");

    expect(result.code).toBe(CONTRACT_ERROR_CODES.PROMPT_NOT_FOUND);
    expect(result.message).toContain("not be found");
  });

  it("normalizes wrapped Soroban error strings", () => {
    const result = classifyContractError("Error: contract invocation failed: ContractIsPaused");

    expect(result.code).toBe(CONTRACT_ERROR_CODES.CONTRACT_PAUSED);
    expect(formatContractErrorMessage(result)).toContain("paused");
  });
});
