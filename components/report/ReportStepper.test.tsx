import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportStepper, JUMP_PIN_MS } from "@/components/report/ReportStepper";
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

const link = (n: number) => screen.getByRole("link", { name: new RegExp(`^${n}\\b`) });

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
  it("is a navigation landmark holding one link per step, named by number and title", () => {
    render(<ReportStepper steps={REPORT_STEPS} />);
    const nav = screen.getByRole("navigation", { name: "Report sections" });
    expect(nav).not.toHaveAttribute("aria-orientation");
    expect(screen.queryByRole("tablist")).toBeNull();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(8);
    expect(links[0]).toHaveAccessibleName("1. Executive Summary");
    expect(links[7]).toHaveAccessibleName("8. Final Recommendation");
  });

  it("links each step to its section anchor", () => {
    render(<ReportStepper steps={REPORT_STEPS} />);
    expect(link(3)).toHaveAttribute("href", "#sec-3");
    expect(link(3)).toHaveAttribute("aria-controls", "sec-3");
  });

  it("observes every section with a thin band near the top of the viewport", () => {
    render(<ReportStepper steps={REPORT_STEPS} />);
    expect(observed.map((el) => el.id)).toEqual(REPORT_STEPS.map((s) => s.id));
    expect(options?.rootMargin).toMatch(/^-\d+% 0px -\d+% 0px$/);
  });

  it("starts on step 1 with nothing completed", () => {
    render(<ReportStepper steps={REPORT_STEPS} />);
    expect(link(1)).toHaveAttribute("aria-current", "location");
    expect(link(1)).toHaveAttribute("data-state", "active");
    expect(link(2)).not.toHaveAttribute("aria-current");
    expect(link(2)).toHaveAttribute("data-state", "inactive");
  });

  it("marks the section in the band active and the ones above it completed", () => {
    render(<ReportStepper steps={REPORT_STEPS} />);
    intersect("sec-3");
    expect(link(3)).toHaveAttribute("aria-current", "location");
    expect(link(1)).toHaveAttribute("data-state", "completed");
    expect(link(2)).toHaveAttribute("data-state", "completed");
    expect(link(4)).toHaveAttribute("data-state", "inactive");
    expect(screen.getAllByRole("link").filter((l) => l.hasAttribute("aria-current"))).toHaveLength(1);
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
    expect(link(4)).toHaveAttribute("aria-current", "location");
  });

  it("scrolls to the section exactly once on click and activates that step at once", async () => {
    render(<ReportStepper steps={REPORT_STEPS} />);
    await userEvent.click(link(6));
    const target = document.getElementById("sec-6")!;
    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(link(6)).toHaveAttribute("aria-current", "location");
    expect(link(5)).toHaveAttribute("data-state", "completed");
  });

  it("shows a check on completed steps and the number on the active one", () => {
    render(<ReportStepper steps={REPORT_STEPS} />);
    intersect("sec-3");
    expect(link(1).querySelector("svg")).not.toBeNull();
    expect(link(2).querySelector("svg")).not.toBeNull();
    expect(link(3).querySelector("svg")).toBeNull();
    expect(link(3)).toHaveTextContent("3");
    expect(link(4).querySelector("svg")).toBeNull();
  });

  it("ignores the sections a click-scroll passes through until the target arrives", async () => {
    render(<ReportStepper steps={REPORT_STEPS} />);
    await userEvent.click(link(6));
    intersect("sec-2");
    intersect("sec-4");
    expect(link(6)).toHaveAttribute("aria-current", "location");
    intersect("sec-6");
    expect(link(6)).toHaveAttribute("aria-current", "location");
    intersect("sec-7");
    expect(link(7)).toHaveAttribute("aria-current", "location");
  });

  it("tracks manual scrolling again once the click pin expires", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<ReportStepper steps={REPORT_STEPS} />);
      await userEvent.click(link(6));
      intersect("sec-2");
      expect(link(6)).toHaveAttribute("aria-current", "location");
      await act(async () => { await vi.advanceTimersByTimeAsync(JUMP_PIN_MS + 1); });
      intersect("sec-2");
      expect(link(2)).toHaveAttribute("aria-current", "location");
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for sections that are parsed after it hydrates, then tracks them", async () => {
    document.getElementById("sections")?.remove();
    render(<ReportStepper steps={REPORT_STEPS} />);
    expect(observed).toHaveLength(0);
    // MutationObserver delivers on a microtask; the async act flushes it.
    await act(async () => { mountSections(); });
    expect(observed.map((el) => el.id)).toEqual(REPORT_STEPS.map((s) => s.id));
    intersect("sec-2");
    expect(link(2)).toHaveAttribute("aria-current", "location");
  });

  it("disconnects the observer on unmount", () => {
    const { unmount } = render(<ReportStepper steps={REPORT_STEPS} />);
    expect(observed).toHaveLength(8);
    unmount();
    expect(observed).toHaveLength(0);
  });
});
