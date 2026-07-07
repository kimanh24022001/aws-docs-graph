import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryForm } from "@/components/QueryForm";

describe("QueryForm", () => {
  it("renders textarea and submit button", () => {
    render(<QueryForm onSubmit={vi.fn()} isLoading={false} />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ask/i })).toBeInTheDocument();
  });

  it("calls onSubmit with trimmed question", async () => {
    const onSubmit = vi.fn();
    render(<QueryForm onSubmit={onSubmit} isLoading={false} />);
    await userEvent.type(screen.getByRole("textbox"), "  How do I tag ECS?  ");
    await userEvent.click(screen.getByRole("button", { name: /ask/i }));
    expect(onSubmit).toHaveBeenCalledWith("How do I tag ECS?");
  });

  it("disables button when input is blank", async () => {
    render(<QueryForm onSubmit={vi.fn()} isLoading={false} />);
    expect(screen.getByRole("button", { name: /ask/i })).toBeDisabled();
  });

  it("disables button and shows loading text when isLoading", async () => {
    render(<QueryForm onSubmit={vi.fn()} isLoading={true} />);
    const btn = screen.getByRole("button", { name: /asking/i });
    expect(btn).toBeDisabled();
  });

  it("does not submit when question exceeds 2000 chars", async () => {
    const onSubmit = vi.fn();
    render(<QueryForm onSubmit={onSubmit} isLoading={false} />);
    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "a".repeat(2001));
    await userEvent.click(screen.getByRole("button", { name: /ask/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
