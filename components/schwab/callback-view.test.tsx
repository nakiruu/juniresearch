import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CallbackView, CallbackClient } from "@/components/schwab/callback-view";
import { parseAuthCode } from "@/lib/broker/schwab-auth";

const URL_WITH_CODE = "https://research.juniperfin.com/schwab/callback?code=C0.abc%40&session=s1";

afterEach(() => vi.restoreAllMocks());

describe("CallbackView", () => {
  it("shows the full redirect URL, which trade:auth parses back to the code", () => {
    render(<CallbackView url={URL_WITH_CODE} />);
    const box = screen.getByRole("textbox", { name: /schwab redirect url/i }) as HTMLTextAreaElement;
    expect(box.value).toBe(URL_WITH_CODE);
    expect(parseAuthCode(box.value)).toBe("C0.abc@");
  });

  it("copies the URL to the clipboard", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    render(<CallbackView url={URL_WITH_CODE} />);
    await user.click(screen.getByRole("button", { name: /copy url/i }));
    expect(writeText).toHaveBeenCalledWith(URL_WITH_CODE);
    expect(await screen.findByText(/copied/i)).toBeInTheDocument();
  });

  it("selects the URL for manual copy when the clipboard is blocked", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    render(<CallbackView url={URL_WITH_CODE} />);
    await user.click(screen.getByRole("button", { name: /copy url/i }));
    expect(await screen.findByText(/copy blocked/i)).toBeInTheDocument();
  });

  it("explains a Schwab error redirect", () => {
    render(<CallbackView url="https://research.juniperfin.com/schwab/callback?error=access_denied&error_description=User%20cancelled" />);
    expect(screen.getByRole("alert")).toHaveTextContent(/access_denied.*User cancelled/);
  });

  it("explains a visit with no code", () => {
    render(<CallbackView url="https://research.juniperfin.com/schwab/callback" />);
    expect(screen.getByRole("alert")).toHaveTextContent(/trade:auth/);
  });
});

describe("CallbackClient", () => {
  it("keeps showing the URL but scrubs the code from the address bar", () => {
    window.history.pushState(null, "", "/schwab/callback?code=XYZ&session=s");
    render(<CallbackClient />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toContain("code=XYZ");
    expect(window.location.search).toBe("");
    expect(window.location.pathname).toBe("/schwab/callback");
  });
});
