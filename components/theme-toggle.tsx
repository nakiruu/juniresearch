"use client";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="fixed top-4 right-4 z-50 h-8 w-28" aria-hidden />;
  }

  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="fixed top-4 right-4 z-50 flex items-center gap-2 border border-hairline
                 bg-surface px-3 py-1.5 font-sans text-xs font-semibold text-muted
                 transition-colors hover:text-ink"
    >
      {isDark ? <Sun size={15} /> : <Moon size={15} />}
      {isDark ? "Linen" : "Forest Night"}
    </button>
  );
}
