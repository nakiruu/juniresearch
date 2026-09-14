import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportStepper } from "@/components/report/ReportStepper";
import { REPORT_STEPS } from "@/components/report/report-steps";

type Entry = { target: Element; isIntersecting: boolean };
type Callback = (entries: Entry[]) => void;

let callback: Callback | null = null;
let observed: Element[] = [];
let options: IntersectionObserverInit | undefined;

class FakeIntersectionObserver {
  constructor(cb: Callback, opts?: IntersectionObserverInit) {
    callback = cb;
    options = opts;
  }
  observe(el: Element) { observed.push(el); }
  unobserve(el: Element) { observed = observed.filter((o) => o !== el); }
  disconnect() { observed = []; }
  takeRecords() { return []; }
}

function mountSections() {
  const host = document.createElement("div");
  host.id = "sections";
  host.innerHTML = REPORT_STEPS.map((s) => `<section id="${s.id}"><h2>${s.title}</h2></section>`).join("");
  document.body.appendChild(host);
}

function intersect(id: string) {
  const target = document.getElementById(id)!;
  act(() => callback?.([{ target, isIntersecting: true }]));
}

const tab = (n: number) => screen.getByRole("tab", { name: new RegExp(`^${n}\\b`) });

beforeEach(() => {
  callback = null;
  observed = [];
  options = undefined;
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  Element.prototype.scrollIntoView = vi.fn();
  mountSections();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.getElementById("sections")?.remove();
});

describe("ReportStepper", () => {
  it("renders one tab per step, named by number and title", () => {
    render(<ReportStepper steps={REPORT_STEPS} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(8);
    expect(tabs[0]).toHaveAccessibleName("1. Executive Summary");
    expect(tabs[7]).toHaveAccessibleName("8. Final Recommendation");
  });

  it("links each tab to its section anchor", () => {
    render(<ReportStepper steps={REPORT_STEPS} />);
    expect(tab(3)).toHaveAttribute("href", "#sec-3");
    expect(tab(3)).toHaveAttribute("aria-controls", "sec-3");
  });

  it("observes every section with a thin band near the top of the viewport", () => {
    render(<ReportStepper steps={REPORT_STEPS} />);
    expect(observed.map((el) => el.id)).toEqual(REPORT_STEPS.map((s) => s.id));
    expect(options?.rootMargin).toMatch(/^-\d+% 0px -\d+% 0px$/);
  });

  it("starts on step 1 with nothing completed", () => {
    render(<ReportStepper steps={REPORT_STEPS} />);
    expect(tab(1)).toHaveAttribute("aria-selected", "true");
    expect(tab(1)).toHaveAttribute("data-state", "active");
    expect(tab(2)).toHaveAttribute("data-state", "inactive");
  });

  it("marks the section in the band active and the ones above it completed", () => {
    render(<ReportStepper steps={REPORT_STEPS} />);
    intersect("sec-3");
    expect(tab(3)).toHaveAttribute("aria-selected", "true");
    expect(tab(1)).toHaveAttribute("data-state", "completed");
    expect(tab(2)).toHaveAttribute("data-state", "completed");
    expect(tab(4)).toHaveAttribute("data-state", "inactive");
  });

  it("shows the active section's full title in the compact caption", () => {
    render(<ReportStepper steps={REPORT_STEPS} />);
    intersect("sec-5");
    expect(screen.getByTestId("stepper-caption")).toHaveTextContent("5. Growth Strategy & Future Outlook");
  });

  it("keeps the last active step when no section is in the band", () => {
    render(<ReportStepper steps={REPORT_STEPS} />);
    intersect("sec-4");
    act(() => callback?.([{ target: document.getElementById("sec-4")!, isIntersecting: false }]));
    expect(tab(4)).toHaveAttribute("aria-selected", "true");
  });

  it("scrolls to the section on click and activates that step at once", async () => {
    render(<ReportStepper steps={REPORT_STEPS} />);
    await userEvent.click(tab(6));
    const target = document.getElementById("sec-6")!;
    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(tab(6)).toHaveAttribute("aria-selected", "true");
    expect(tab(5)).toHaveAttribute("data-state", "completed");
  });

  it("disconnects the observer on unmount", () => {
    const { unmount } = render(<ReportStepper steps={REPORT_STEPS} />);
    expect(observed).toHaveLength(8);
    unmount();
    expect(observed).toHaveLength(0);
  });
});
