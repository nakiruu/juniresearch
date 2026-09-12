import type { ReactNode } from "react";

export function Src({ children }: { children: ReactNode }) {
  return <div className="mt-0.5 mb-3 font-sans text-[11px] italic text-muted">{children}</div>;
}
