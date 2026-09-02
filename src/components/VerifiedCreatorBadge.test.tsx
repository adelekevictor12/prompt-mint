import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { VerifiedCreatorBadge } from "@/components/VerifiedCreatorBadge";
import type { CreatorVerification } from "@/lib/identity";

describe("VerifiedCreatorBadge", () => {
  it("renders the verified label for a SEP-1 verification", () => {
    const verification: CreatorVerification = {
      status: "verified",
      method: "sep1-toml",
      domain: "creator.example",
      stellarTomlUrl: "https://creator.example/.well-known/stellar.toml",
    };
    render(<VerifiedCreatorBadge verification={verification} />);
    expect(screen.getByText("Verified creator")).toBeInTheDocument();
  });

  it("renders nothing for an unverified creator", () => {
    const verification: CreatorVerification = { status: "unverified" };
    const { container } = render(<VerifiedCreatorBadge verification={verification} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an error state", () => {
    const verification: CreatorVerification = {
      status: "error",
      message: "bad sig",
    };
    const { container } = render(<VerifiedCreatorBadge verification={verification} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a pending chip for pending verification", () => {
    const verification: CreatorVerification = { status: "pending" };
    render(<VerifiedCreatorBadge verification={verification} />);
    expect(screen.getByText("Verification pending")).toBeInTheDocument();
  });

  it("omits the label in compact mode", () => {
    const verification: CreatorVerification = {
      status: "verified",
      method: "sep12-attestation",
      name: "Ada",
    };
    const { container } = render(
      <VerifiedCreatorBadge verification={verification} variant="compact" />,
    );
    expect(screen.queryByText("Verified creator")).not.toBeInTheDocument();
    expect(container.querySelector("span[role='status']")).toBeInTheDocument();
  });
});
