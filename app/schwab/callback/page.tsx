import type { Metadata } from "next";
import { CallbackClient } from "@/components/schwab/callback-view";

// Schwab's OAuth redirect lands here with a one-time ?code=. Never index it, and never leak the URL
// (with its code) to another origin through the Referer header.
export const metadata: Metadata = {
  title: "Schwab authorization — Juniper Finance",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function SchwabCallback() {
  return (
    <main className="mx-auto max-w-[720px] px-7 pt-11 pb-20">
      <div className="font-sans text-xs font-bold tracking-[2.5px] text-accent">TRADE:AUTH</div>
      <h1 className="mt-1.5 mb-5 font-display text-[34px] leading-[1.1] font-semibold text-ink">Schwab authorization</h1>
      <CallbackClient />
    </main>
  );
}
