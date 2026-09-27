/**
 * ReportStepper renders the ReUI stepper's markup without importing the
 * primitives (see the file header). This pins the two together: the reference
 * below is the stepper as it was composed from components/reui/stepper.tsx and
 * lucide-react, and the markup must match in every step state (attribute
 * order aside: React appends attributes set on update, e.g. aria-current).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import {
  Stepper,
  StepperIndicator,
  StepperItem,
  StepperSeparator,
  useStepItem,
} from "@/components/reui/stepper";
import { ReportStepper } from "@/components/report/ReportStepper";
import { REPORT_STEPS, type ReportStep } from "@/components/report/report-steps";

const SHELL =
  "fixed z-40 print:hidden inset-x-0 bottom-0 border-t border-hairline bg-page/95 px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur " +
  "min-[1280px]:inset-auto min-[1280px]:top-[4.75rem] min-[1280px]:left-[calc(50%+474px)] min-[1280px]:w-[150px] " +
  "min-[1280px]:border-0 min-[1280px]:bg-transparent min-[1280px]:p-0 min-[1280px]:backdrop-blur-none";
const LIST = "flex flex-row items-center min-[1280px]:flex-col min-[1280px]:items-start";
const ITEM =
  "relative flex-row items-center not-last:flex-1 min-[1280px]:flex-col min-[1280px]:items-start min-[1280px]:not-last:flex-none";
const LINK =
  "inline-flex items-center gap-2.5 no-underline outline-none focus-visible:ring-3 focus-visible:ring-ring/50 min-[1280px]:pb-7";
const INDICATOR =
  "size-6 rounded-none font-mono text-[11px] font-bold transition-colors bg-surface text-muted ring-1 ring-hairline " +
  "data-[state=completed]:bg-accent data-[state=completed]:text-page data-[state=completed]:ring-accent " +
  "data-[state=active]:bg-accent data-[state=active]:text-page data-[state=active]:ring-2 " +
  "data-[state=active]:ring-accent data-[state=active]:ring-offset-2 data-[state=active]:ring-offset-page";
const LABEL =
  "hidden whitespace-nowrap font-sans text-xs font-medium text-muted group-data-[state=active]/step:font-semibold " +
  "group-data-[state=active]/step:text-ink group-data-[state=completed]/step:text-ink min-[1280px]:inline";
const SEPARATOR =
  "mx-1 h-px flex-1 rounded-none bg-hairline group-data-[state=completed]/step:bg-accent min-[1280px]:absolute " +
  "min-[1280px]:top-7 min-[1280px]:left-3 min-[1280px]:mx-0 min-[1280px]:h-[calc(100%-2rem)] min-[1280px]:w-px " +
  "min-[1280px]:flex-none min-[1280px]:-translate-x-1/2";
const CAPTION = "mt-1.5 truncate text-center font-sans text-[11px] text-muted min-[1280px]:hidden";
const INDICATORS = { completed: <Check className="size-3.5" strokeWidth={3} aria-hidden /> };

function RefLink({ step, children }: { step: ReportStep; children: ReactNode }) {
  const { state } = useStepItem();
  return (
    <a href={`#${step.id}`} aria-label={step.title} aria-controls={step.id}
      aria-current={state === "active" ? "location" : undefined} data-state={state} className={LINK}>
      {children}
    </a>
  );
}

function Reference({ active }: { active: number }) {
  const steps = REPORT_STEPS;
  const current = steps.find((s) => s.n === active) ?? steps[0];
  return (
    <div data-testid="report-stepper" className={SHELL}>
      <Stepper value={active} orientation="vertical" indicators={INDICATORS} role="navigation"
        aria-orientation={undefined} aria-label="Report sections">
        <div className={LIST}>
          {steps.map((s, i) => (
            <StepperItem key={s.id} step={s.n} className={ITEM}>
              <RefLink step={s}>
                <StepperIndicator className={INDICATOR}>{s.n}</StepperIndicator>
                <span className={LABEL}>{s.label}</span>
              </RefLink>
              {i < steps.length - 1 && <StepperSeparator className={SEPARATOR} />}
            </StepperItem>
          ))}
        </div>
      </Stepper>
      <div data-testid="stepper-caption" className={CAPTION}>{current.title}</div>
    </div>
  );
}

/** Markup with each element's attributes sorted, so update order is moot. */
function canonical(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  const el = node as Element;
  const attrs = [...el.attributes].map((a) => `${a.name}="${a.value}"`).sort().join(" ");
  const kids = [...el.childNodes].map(canonical).join("");
  return `<${el.tagName.toLowerCase()} ${attrs}>${kids}</${el.tagName.toLowerCase()}>`;
}

let callback: ((entries: { target: Element; isIntersecting: boolean }[]) => void) | null = null;

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", class {
    constructor(cb: typeof callback) { callback = cb; }
    observe() {}
    disconnect() {}
  });
  const host = document.createElement("div");
  host.id = "sections";
  host.innerHTML = REPORT_STEPS.map((s) => `<section id="${s.id}"></section>`).join("");
  document.body.appendChild(host);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.getElementById("sections")?.remove();
});

describe("ReportStepper markup parity with the ReUI primitives", () => {
  it.each(REPORT_STEPS.map((s) => s.n))("matches with step %i active", (n) => {
    const ours = render(<ReportStepper steps={REPORT_STEPS} />);
    act(() => callback?.([{ target: document.getElementById(`sec-${n}`)!, isIntersecting: true }]));
    const ref = render(<Reference active={n} />);
    expect(canonical(ours.container)).toBe(canonical(ref.container));
  });
});
