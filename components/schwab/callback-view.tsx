"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * The Schwab OAuth landing page's body. Schwab redirects here with ?code=…&session=…; the page never
 * redirects, stores, or sends anything — it shows the full URL with a Copy button so the operator can
 * paste it into `npm run trade:auth`. The code is single-use and expires in ~30s.
 */
export function CallbackView({ url }: { url: string | null }) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const boxRef = useRef<HTMLTextAreaElement>(null);

  if (url === null) return <p className="text-muted">Loading…</p>;
  const params = new URL(url).searchParams;
  const code = params.get("code");
  const error = params.get("error");

  if (!code) {
    return (
      <div role="alert" className="border border-bear/60 bg-surface p-4 text-ink">
        <p className="font-semibold text-bear">No authorization code in this URL.</p>
        {error ? (
          <p className="mt-2">Schwab returned <code className="font-mono">{error}</code>
            {params.get("error_description") ? <> — {params.get("error_description")}</> : null}.</p>
        ) : (
          <p className="mt-2 text-muted">This page only has something to show when Schwab redirects here after you approve access. Run <code className="font-mono">npm run trade:auth</code> and open the link it prints.</p>
        )}
      </div>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("copied");
    } catch {
      boxRef.current?.select(); // clipboard blocked → leave it selected for Ctrl+C
      setCopied("failed");
    }
  };

  return (
    <div>
      <p className="text-ink">Schwab approved access. Copy this URL and paste it at the <code className="font-mono">Paste the redirect URL here:</code> prompt of <code className="font-mono">npm run trade:auth</code> — <strong>within about 30 seconds</strong>, the code expires quickly.</p>
      <textarea
        ref={boxRef}
        readOnly
        aria-label="Schwab redirect URL"
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        rows={4}
        className="mt-4 w-full resize-none break-all border border-hairline bg-surface p-3 font-mono text-xs text-ink"
      />
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={copy}
          className="border border-accent bg-accent px-4 py-2 font-sans text-sm font-semibold text-page transition-opacity hover:opacity-90"
        >
          Copy URL
        </button>
        <span aria-live="polite" className="font-sans text-sm text-muted">
          {copied === "copied" ? "Copied — paste it into the terminal now." : copied === "failed" ? "Copy blocked — the URL is selected; press Ctrl+C." : null}
        </span>
      </div>
      <p className="mt-6 font-sans text-xs text-muted">The code is single-use and was removed from the address bar and this tab&apos;s history entry. Nothing on this page is stored or sent. Took too long? Press Ctrl+C in the terminal and run <code className="font-mono">trade:auth</code> again.</p>
    </div>
  );
}

// First client read of the landing URL, kept for the life of the page so stripping the query from
// the address bar doesn't blank what's on screen.
let landingUrl: string | null = null;
const readLandingUrl = () => (landingUrl ??= window.location.href);
const subscribeNever = () => () => {};

/** Reads the landing URL on the client (null during SSR), then scrubs the code from the address bar. */
export function CallbackClient() {
  const url = useSyncExternalStore(subscribeNever, readLandingUrl, () => null);
  useEffect(() => {
    if (url && new URL(url).searchParams.has("code")) window.history.replaceState(null, "", window.location.pathname);
  }, [url]);
  return <CallbackView url={url} />;
}
