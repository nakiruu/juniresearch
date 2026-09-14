import type { ReactNode } from "react";

/** A top-level report section. `id` is the stepper's scroll anchor (see report-steps.ts). */
export function Section({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4">
      <h2 className="mt-7 mb-2.5 border-b border-accent pb-1 font-sans text-[19px] font-bold text-accent">
        {title}
      </h2>
      {children}
    </section>
  );
}
