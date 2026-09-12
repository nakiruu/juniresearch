import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-[900px] px-7 py-24 text-center">
      <div className="font-sans text-xs font-bold tracking-[2.5px] text-accent">
        EQUITY RESEARCH
      </div>
      <h1 className="mt-3 font-display text-[42px] font-semibold text-ink">
        No report for that ticker
      </h1>
      <p className="mt-2 text-muted">
        <Link href="/research" className="text-accent underline underline-offset-4">
          Browse all reports
        </Link>
      </p>
    </main>
  );
}
