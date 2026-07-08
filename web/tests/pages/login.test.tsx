import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoginPage from "@/app/login/page";

// Mock Supabase client
const mockSignIn = vi.fn();
vi.mock("@/lib/supabase", () => ({
  createBrowserClient: () => ({
    auth: {
      signInWithPassword: mockSignIn,
    },
  }),
}));

// Mock Next.js router
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders email and password fields", () => {
    render(<LoginPage />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it("shows invite-only note", () => {
    render(<LoginPage />);
    expect(screen.getByText(/invite-only/i)).toBeInTheDocument();
  });

  it("calls signInWithPassword and redirects on success", async () => {
    mockSignIn.mockResolvedValue({ data: { session: {} }, error: null });
    render(<LoginPage />);
    await userEvent.type(screen.getByLabelText(/email/i), "user@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "secret123");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() =>
      expect(mockSignIn).toHaveBeenCalledWith({
        email: "user@example.com",
        password: "secret123",
      }),
    );
    expect(mockPush).toHaveBeenCalledWith("/ask");
  });

  it("shows error message on auth failure", async () => {
    mockSignIn.mockResolvedValue({
      data: null,
      error: { message: "Invalid login credentials" },
    });
    render(<LoginPage />);
    await userEvent.type(screen.getByLabelText(/email/i), "bad@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "wrong");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() =>
      expect(screen.getByText("Invalid login credentials")).toBeInTheDocument(),
    );
  });
});
