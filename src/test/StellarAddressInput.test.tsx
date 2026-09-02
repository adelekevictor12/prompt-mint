import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { StellarAddressInput } from "@/components/StellarAddressInput";
import type { StellarAddressValidationResult } from "@/components/StellarAddressInput";

const VALID_ADDRESS = "GBNOV3GABZ2LBBYJDM3CCW5PIPJOS42JLUZBD4F5EM2LOXYMTGCRAQJX";
const CONNECTED_ADDRESS = "GBX55CQTJ6LBFHJLDQNFXZYSAUHHHWAFNMFY6EGU6UQ5Z4ZC6GHVPMDD";
const SHORT_ADDRESS = "GBBB";

function StatefulWrapper({
  initial = "",
  connectedAddress,
  disabled,
  label,
  className,
  id,
  onChange,
}: {
  initial?: string;
  connectedAddress?: string;
  disabled?: boolean;
  label?: string;
  className?: string;
  id?: string;
  onChange?: (value: string, validation: StellarAddressValidationResult) => void;
}) {
  const [value, setValue] = useState(initial);
  const handleChange = onChange ?? vi.fn();
  return (
    <StellarAddressInput
      value={value}
      onChange={(v, validation) => {
        setValue(v);
        handleChange(v, validation);
      }}
      connectedAddress={connectedAddress}
      disabled={disabled}
      label={label}
      className={className}
      id={id}
    />
  );
}

describe("StellarAddressInput", () => {
  it("renders with default label and placeholder", () => {
    render(<StellarAddressInput value="" onChange={() => {}} />);
    expect(screen.getByLabelText("Recipient Stellar Address")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("G...")).toBeInTheDocument();
  });

  it("accepts a custom label via props", () => {
    render(<StellarAddressInput value="" onChange={() => {}} label="Custom Label" />);
    expect(screen.getByLabelText("Custom Label")).toBeInTheDocument();
  });

  it("calls onChange with valid result when a valid address is entered", () => {
    const onChange = vi.fn();

    render(<StatefulWrapper onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: VALID_ADDRESS } });

    expect(onChange).toHaveBeenCalledWith(VALID_ADDRESS, { status: "valid" });
  });

  it("shows invalid format error for a short address", () => {
    render(<StatefulWrapper />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: SHORT_ADDRESS } });

    expect(screen.getByText("Invalid Stellar address format")).toBeInTheDocument();
  });

  it("shows self-address warning when address matches connected wallet", () => {
    render(
      <StatefulWrapper connectedAddress={CONNECTED_ADDRESS} />,
    );
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: CONNECTED_ADDRESS } });

    expect(screen.getByText("Cannot use your own wallet address")).toBeInTheDocument();
  });

  it("shows a green check icon when the address is valid", () => {
    render(<StatefulWrapper />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: VALID_ADDRESS } });

    const checkIcon = document.querySelector(".text-emerald-400");
    expect(checkIcon).toBeInTheDocument();
  });

  it("marks input as aria-invalid when address is invalid", () => {
    render(<StatefulWrapper />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: SHORT_ADDRESS } });

    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("does not show aria-invalid for empty input", () => {
    render(<StellarAddressInput value="" onChange={() => {}} />);
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("aria-invalid", "false");
  });

  it("does not show error message for empty input", () => {
    render(<StellarAddressInput value="" onChange={() => {}} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disables the input when disabled prop is true", () => {
    render(<StellarAddressInput value="" onChange={() => {}} disabled />);
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("applies custom className to the wrapper", () => {
    const { container } = render(
      <StellarAddressInput value="" onChange={() => {}} className="my-custom-class" />,
    );
    expect(container.firstChild).toHaveClass("my-custom-class");
  });

  it("uses the provided id for the input element", () => {
    render(<StellarAddressInput value="" onChange={() => {}} id="my-address-input" />);
    expect(screen.getByRole("textbox")).toHaveAttribute("id", "my-address-input");
  });

  it("clears error when input is cleared", () => {
    render(<StatefulWrapper />);
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: SHORT_ADDRESS } });
    expect(screen.getByText("Invalid Stellar address format")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
