"use client";
import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";

// lucide-react's Sun and Moon at size 15, inlined as the SVG they render: the
// toggle ships on every page, and these two glyphs are all it used lucide for.
const SVG = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 15,
  height: 15,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const SUN = (
  <svg {...SVG} className="lucide lucide-sun" aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2" />
    <path d="M12 20v2" />
    <path d="m4.93 4.93 1.41 1.41" />
    <path d="m17.66 17.66 1.41 1.41" />
    <path d="M2 12h2" />
    <path d="M20 12h2" />
    <path d="m6.34 17.66-1.41 1.41" />
    <path d="m19.07 4.93-1.41 1.41" />
  </svg>
);

const MOON = (
  <svg {...SVG} className="lucide lucide-moon" aria-hidden="true">
    <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />
  </svg>
);

const subscribeNever = () => () => {};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // True only after hydration: the server snapshot is false, the client's true,
  // so the first client render matches the server HTML without an effect.
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);

  if (!mounted) {
    return <div className="fixed top-4 right-4 z-50 h-8 w-28 print:hidden" aria-hidden />;
  }

  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="fixed top-4 right-4 z-50 flex items-center gap-2 border border-hairline
                 bg-surface px-3 py-1.5 font-sans text-xs font-semibold text-muted
                 transition-colors hover:text-ink print:hidden"
    >
      {isDark ? SUN : MOON}
      {isDark ? "Linen" : "Forest Night"}
    </button>
  );
}
