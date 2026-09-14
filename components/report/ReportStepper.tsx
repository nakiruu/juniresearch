"use client";
/**
 * ReportStepper.tsx — section navigation for a report.
 * -----------------------------------------------------------------------------
 * One stepper, two layouts by viewport width: a fixed rail in the right margin
 * beside the 900px column (numbers + short labels, ≥1280px) and a fixed bottom
 * bar of numbered squares with the active title beneath (below that). The
 * active step follows the reader: an IntersectionObserver watches every section
 * against a thin band near the top of the viewport, and the section overlapping
 * that band is "where the reader is". Steps above it read as completed.
 * Clicking a step smooth-scrolls to its section; the triggers are real anchors
 * so the links work without JavaScript.
 *
 * Every Tailwind class is written out in full: the scanner only generates
 * utilities it can read verbatim from the source.
 */
import { useEffect, useState, type MouseEvent } from "react";
import {
  Stepper,
  StepperIndicator,
  StepperItem,
  StepperSeparator,
  StepperTrigger,
} from "@/components/reui/stepper";
import type { ReportStep } from "./report-steps";

/** The viewport band (24%–34% from the top) that decides the active section. */
const BAND = "-24% 0px -66% 0px";

function useActiveStep(steps: readonly ReportStep[]) {
  const [active, setActive] = useState(1);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const byId = new Map(steps.map((s) => [s.id, s.n]));
    const els = steps
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el != null);
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const hits = entries
          .filter((e) => e.isIntersecting)
          .map((e) => byId.get(e.target.id))
          .filter((n): n is number => n != null);
        // Two sections can share the band at their boundary; the later one is
        // the one the reader is entering.
        if (hits.length) setActive(Math.max(...hits));
      },
      { rootMargin: BAND, threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [steps]);
  return [active, setActive] as const;
}

const SHELL =
  "fixed z-40 print:hidden " +
  // bottom bar (default)
  "inset-x-0 bottom-0 border-t border-hairline bg-page/95 px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur " +
  // right rail (≥1280px): beside the 900px column, below the theme toggle
  "min-[1280px]:inset-auto min-[1280px]:top-[4.75rem] min-[1280px]:left-[calc(50%+474px)] min-[1280px]:w-[150px] " +
  "min-[1280px]:border-0 min-[1280px]:bg-transparent min-[1280px]:p-0 min-[1280px]:backdrop-blur-none";

const NAV = "flex flex-row items-center min-[1280px]:flex-col min-[1280px]:items-start";

const ITEM =
  "relative flex-row items-center not-last:flex-1 " +
  "min-[1280px]:flex-col min-[1280px]:items-start min-[1280px]:not-last:flex-none";

const TRIGGER = "gap-2.5 rounded-none no-underline min-[1280px]:pb-7";

const INDICATOR =
  "size-6 rounded-none font-mono text-[11px] font-bold " +
  "bg-surface text-muted ring-1 ring-hairline " +
  "data-[state=active]:bg-accent data-[state=active]:text-page data-[state=active]:ring-accent " +
  "data-[state=completed]:bg-accent data-[state=completed]:text-page data-[state=completed]:ring-accent";

const LABEL =
  "hidden whitespace-nowrap font-sans text-xs font-medium text-muted " +
  "group-data-[state=active]/step:font-semibold group-data-[state=active]/step:text-ink " +
  "group-data-[state=completed]/step:text-ink min-[1280px]:inline";

const SEPARATOR =
  "mx-1 h-px flex-1 rounded-none bg-hairline group-data-[state=completed]/step:bg-accent " +
  "min-[1280px]:absolute min-[1280px]:top-7 min-[1280px]:left-3 min-[1280px]:mx-0 " +
  "min-[1280px]:h-[calc(100%-2rem)] min-[1280px]:w-px min-[1280px]:flex-none min-[1280px]:-translate-x-1/2";

const CAPTION = "mt-1.5 truncate text-center font-sans text-[11px] text-muted min-[1280px]:hidden";

export function ReportStepper({ steps }: { steps: readonly ReportStep[] }) {
  const [active, setActive] = useActiveStep(steps);
  const current = steps.find((s) => s.n === active) ?? steps[0];

  const jump = (n: number) => {
    setActive(n);
    const step = steps.find((s) => s.n === n);
    if (step) document.getElementById(step.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const keepInPage = (e: MouseEvent<HTMLAnchorElement>) => e.preventDefault();

  return (
    <div data-testid="report-stepper" className={SHELL}>
      <Stepper value={active} onValueChange={jump} orientation="vertical" aria-label="Report sections">
        <nav aria-label="Sections" className={NAV}>
          {steps.map((s, i) => (
            <StepperItem key={s.id} step={s.n} className={ITEM}>
              <StepperTrigger
                render={<a href={`#${s.id}`} aria-label={s.title} aria-controls={s.id} onClick={keepInPage} />}
                className={TRIGGER}
              >
                <StepperIndicator className={INDICATOR}>{s.n}</StepperIndicator>
                <span className={LABEL}>{s.label}</span>
              </StepperTrigger>
              {i < steps.length - 1 && <StepperSeparator className={SEPARATOR} />}
            </StepperItem>
          ))}
        </nav>
      </Stepper>
      <div data-testid="stepper-caption" className={CAPTION}>
        {current.title}
      </div>
    </div>
  );
}
