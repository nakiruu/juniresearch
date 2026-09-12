import { MD } from "./Markdown";

export function Callout({ label, body }: { label: string; body: string }) {
  return (
    <div className="my-3 border border-hairline bg-surface px-4 py-3">
      <span className="font-bold">Investment Thesis — {label}.</span>{" "}
      <MD>{body}</MD>
    </div>
  );
}
