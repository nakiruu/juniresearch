import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeToggle } from "@/components/theme-toggle";

const setTheme = vi.fn();
let currentTheme = "dark";

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: currentTheme, setTheme, resolvedTheme: currentTheme }),
}));

beforeEach(() => { setTheme.mockClear(); currentTheme = "dark"; });

describe("ThemeToggle", () => {
  it("offers the opposite theme by name when mounted in dark", async () => {
    render(<ThemeToggle />);
    expect(await screen.findByRole("button", { name: /linen/i })).toBeInTheDocument();
  });

  it("switches to light when clicked in dark", async () => {
    render(<ThemeToggle />);
    await userEvent.click(await screen.findByRole("button", { name: /linen/i }));
    expect(setTheme).toHaveBeenCalledWith("light");
  });

  it("offers Forest Night when mounted in light", async () => {
    currentTheme = "light";
    render(<ThemeToggle />);
    expect(await screen.findByRole("button", { name: /forest night/i })).toBeInTheDocument();
  });
});
