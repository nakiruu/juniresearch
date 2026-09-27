"use client";
/**
 * ReportStepper.tsx — section navigation for a report.
 * -----------------------------------------------------------------------------
 * One stepper, two layouts by viewport width: a fixed rail in the right margin
 * beside the 900px column (numbers + short labels, ≥1280px) and a fixed bottom
 * bar of numbered squares with the active title beneath (below that). The
 * active step follows the reader: an IntersectionObserver watches every section
 * against a thin band near the top of the viewport, and the section overlapping
 * that band is "where the reader is". Steps above it read as completed and show
 * a check; the active one keeps its number and a halo.
 *
 * Clicking a step smooth-scrolls to its section. While that scroll is in
 * flight the observer would otherwise walk the active step through every
 * section it passes, so a click pins the target until the observer reports it
 * (or a short timeout expires, after which manual scrolling is tracked again).
 *
 * Semantics: this is in-page navigation, not a wizard, so it is a `navigation`
 * landmark holding plain links with `aria-current="location"` on the active
 * one.
 *
 * Markup: this renders exactly the DOM the ReUI stepper primitives
 * (components/reui/stepper.tsx) produced — same data-slot/data-state hooks and
 * the same merged class lists — but without importing them. Those primitives
 * pull the `cn` class-merging engine, @base-ui helpers and lucide-react into
 * this client island (~30 KB of JS per report page) only to merge a handful of
 * static class strings. The merged strings are precomputed below, and
 * ReportStepper.parity.test.tsx renders the original primitive-based stepper
 * beside this one and requires identical markup, so the two cannot drift.
 * The check glyph is lucide's `Check`, inlined as the SVG it renders.
 *
 * Every Tailwind class is written out in full: the scanner only generates
 * utilities it can read verbatim from the source.
 */
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { ReportStep } from "./report-steps";

type StepState = "active" | "completed" | "inactive";

/** The viewport band (24%–34% from the top) that decides the active section. */
const BAND = "-24% 0px -66% 0px";
/** How long a click keeps its target pinned if the observer never reports it. */
export const JUMP_PIN_MS = 2000;

function useActiveStep(steps: readonly ReportStep[]) {
  const [active, setActive] = useState(1);
  const pinned = useRef<number | null>(null);
  const pinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const byId = new Map(steps.map((s) => [s.id, s.n]));
    let io: IntersectionObserver | null = null;
    let waiting: MutationObserver | null = null;

    const onEntries = (entries: IntersectionObserverEntry[]) => {
      const hits = entries
        .filter((e) => e.isIntersecting)
        .map((e) => byId.get(e.target.id))
        .filter((n): n is number => n != null);
      if (!hits.length) return;
      // A click-scroll in flight: ignore the sections it passes through.
      if (pinned.current != null) {
        if (!hits.includes(pinned.current)) return;
        pinned.current = null;
        if (pinTimer.current) clearTimeout(pinTimer.current);
      }
      // Two sections can share the band at their boundary; the later one is
      // the one the reader is entering.
      setActive(Math.max(...hits));
    };

    // Attach once every section exists. With streamed HTML this island can
    // hydrate before the sections below it are parsed (slow links, Safari),
    // so a missing section means "not yet", not "never".
    const attach = () => {
      const els = steps.map((s) => document.getElementById(s.id));
      if (els.some((el) => el == null)) return false;
      io = new IntersectionObserver(onEntries, { rootMargin: BAND, threshold: 0 });
      for (const el of els) io.observe(el!);
      return true;
    };
    if (!attach() && typeof MutationObserver !== "undefined") {
      waiting = new MutationObserver(() => {
        if (attach()) {
          waiting?.disconnect();
          waiting = null;
        }
      });
      waiting.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      io?.disconnect();
      waiting?.disconnect();
      if (pinTimer.current) clearTimeout(pinTimer.current);
    };
  }, [steps]);

  const jumpTo = (n: number) => {
    setActive(n);
    pinned.current = n;
    if (pinTimer.current) clearTimeout(pinTimer.current);
    pinTimer.current = setTimeout(() => {
      pinned.current = null;
    }, JUMP_PIN_MS);
  };

  return [active, jumpTo] as const;
}

const SHELL =
  "fixed z-40 print:hidden " +
  // bottom bar (default)
  "inset-x-0 bottom-0 border-t border-hairline bg-page/95 px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur " +
  // right rail (≥1280px): beside the 900px column, below the theme toggle
  "min-[1280px]:inset-auto min-[1280px]:top-[4.75rem] min-[1280px]:left-[calc(50%+474px)] min-[1280px]:w-[150px] " +
  "min-[1280px]:border-0 min-[1280px]:bg-transparent min-[1280px]:p-0 min-[1280px]:backdrop-blur-none";

const LIST = "flex flex-row items-center min-[1280px]:flex-col min-[1280px]:items-start";

const ITEM =
  "relative flex-row items-center not-last:flex-1 " +
  "min-[1280px]:flex-col min-[1280px]:items-start min-[1280px]:not-last:flex-none";

const LINK =
  "inline-flex items-center gap-2.5 no-underline outline-none " +
  "focus-visible:ring-3 focus-visible:ring-ring/50 min-[1280px]:pb-7";

const INDICATOR =
  "size-6 rounded-none font-mono text-[11px] font-bold transition-colors " +
  "bg-surface text-muted ring-1 ring-hairline " +
  "data-[state=completed]:bg-accent data-[state=completed]:text-page data-[state=completed]:ring-accent " +
  "data-[state=active]:bg-accent data-[state=active]:text-page data-[state=active]:ring-2 " +
  "data-[state=active]:ring-accent data-[state=active]:ring-offset-2 data-[state=active]:ring-offset-page";

const LABEL =
  "hidden whitespace-nowrap font-sans text-xs font-medium text-muted " +
  "group-data-[state=active]/step:font-semibold group-data-[state=active]/step:text-ink " +
  "group-data-[state=completed]/step:text-ink min-[1280px]:inline";

const SEPARATOR =
  "mx-1 h-px flex-1 rounded-none bg-hairline group-data-[state=completed]/step:bg-accent " +
  "min-[1280px]:absolute min-[1280px]:top-7 min-[1280px]:left-3 min-[1280px]:mx-0 " +
  "min-[1280px]:h-[calc(100%-2rem)] min-[1280px]:w-px min-[1280px]:flex-none min-[1280px]:-translate-x-1/2";

const CAPTION = "mt-1.5 truncate text-center font-sans text-[11px] text-muted min-[1280px]:hidden";

/** StepperItem's default classes merged with ITEM by `cn`, precomputed. */
const MERGED_ITEM =
  "group/step flex justify-center group-data-[orientation=horizontal]/stepper-nav:flex-row " +
  "group-data-[orientation=vertical]/stepper-nav:flex-col " + ITEM;
/** StepperIndicator's default classes merged with INDICATOR by `cn`, precomputed. */
const MERGED_INDICATOR =
  "border-background relative flex shrink-0 items-center justify-center overflow-hidden " + INDICATOR;
/** StepperSeparator's default classes merged with SEPARATOR by `cn`, precomputed. */
const MERGED_SEPARATOR =
  "m-0.5 group-data-[orientation=horizontal]/stepper-nav:h-0.5 group-data-[orientation=horizontal]/stepper-nav:flex-1 " +
  "group-data-[orientation=vertical]/stepper-nav:h-12 group-data-[orientation=vertical]/stepper-nav:w-0.5 " + SEPARATOR;

/** lucide-react's `Check` at strokeWidth 3, as the markup it renders. */
const CHECK = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={3}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="lucide lucide-check size-3.5"
    aria-hidden="true"
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const stateOf = (n: number, active: number): StepState =>
  n < active ? "completed" : n === active ? "active" : "inactive";

/** A step's link. */
function StepLink({
  step,
  state,
  onJump,
  children,
}: {
  step: ReportStep;
  state: StepState;
  onJump: (n: number) => void;
  children: ReactNode;
}) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    onJump(step.n);
  };
  return (
    <a
      href={`#${step.id}`}
      aria-label={step.title}
      aria-controls={step.id}
      aria-current={state === "active" ? "location" : undefined}
      data-state={state}
      className={LINK}
      onClick={onClick}
    >
      {children}
    </a>
  );
}

export function ReportStepper({ steps }: { steps: readonly ReportStep[] }) {
  const [active, jumpTo] = useActiveStep(steps);
  const current = steps.find((s) => s.n === active) ?? steps[0];

  const jump = (n: number) => {
    jumpTo(n);
    const step = steps.find((s) => s.n === n);
    if (step) document.getElementById(step.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div data-testid="report-stepper" className={SHELL}>
      <div role="navigation" data-slot="stepper" className="w-full" data-orientation="vertical" aria-label="Report sections">
        <div className={LIST}>
          {steps.map((s, i) => {
            const state = stateOf(s.n, active);
            return (
              <div key={s.id} data-slot="stepper-item" className={MERGED_ITEM} data-state={state}>
                <StepLink step={s} state={state} onJump={jump}>
                  <div data-slot="stepper-indicator" data-state={state} className={MERGED_INDICATOR}>
                    <div className="absolute">{state === "completed" ? CHECK : s.n}</div>
                  </div>
                  <span className={LABEL}>{s.label}</span>
                </StepLink>
                {i < steps.length - 1 && (
                  <div data-slot="stepper-separator" data-state={state} className={MERGED_SEPARATOR} />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div data-testid="stepper-caption" className={CAPTION}>
        {current.title}
      </div>
    </div>
  );
}
