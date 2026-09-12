import type { ReactNode } from "react";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mt-7 mb-2.5 border-b border-accent pb-1 font-sans text-[19px] font-bold text-accent">
        {title}
      </h2>
      {children}
    </section>
  );
}
