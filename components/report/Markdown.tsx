/**
 * Markdown.tsx — the ONLY place report prose becomes markup.
 * -----------------------------------------------------------------------------
 * Supports the small, deliberate subset the contract allows:
 *   **bold**                         -> <strong>
 *   "### " / "#### " at block start   -> <h3> / <h4>
 *   lines starting "- " / "* "        -> <ul><li>
 *   blank line                        -> paragraph break
 *   {+ text +}                        -> bull span  (.pos, green)
 *   {- text -}                        -> bear span  (.neg, terracotta)
 *
 * All visual styling comes from the project stylesheet — this only assigns
 * semantic tags/classes. Do NOT nest markers (no **{+ +}**); pick one.
 *
 * In the production app you can swap this for react-markdown + a remark plugin;
 * the contract (plain markdown strings) does not change.
 */
import React from "react";

const INLINE = /\{\+([\s\S]+?)\+\}|\{-([\s\S]+?)-\}|\*\*([\s\S]+?)\*\*/g;

function renderInline(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<span className="pos" key={`${key}-${i++}`}>{m[1].trim()}</span>);
    else if (m[2] !== undefined) out.push(<span className="neg" key={`${key}-${i++}`}>{m[2].trim()}</span>);
    else out.push(<strong key={`${key}-${i++}`}>{m[3]}</strong>);
    last = INLINE.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Inline-only render (for table cells, captions, list items). */
export function MD({ children }: { children?: string | null }): React.ReactElement | null {
  if (children == null) return null;
  return <>{renderInline(String(children), "md")}</>;
}

/** Block render (paragraphs, lists, sub-headings). */
export function Markdown({ text }: { text?: string | null }): React.ReactElement | null {
  if (text == null) return null;
  const blocks = String(text).trim().split(/\n{2,}/);
  return (
    <>
      {blocks.map((b, bi) => {
        if (/^####\s/.test(b)) return <h4 key={bi}>{renderInline(b.replace(/^####\s/, ""), `h4-${bi}`)}</h4>;
        if (/^###\s/.test(b)) return <h3 key={bi}>{renderInline(b.replace(/^###\s/, ""), `h3-${bi}`)}</h3>;
        const lines = b.split("\n");
        if (lines.length && lines.every((l) => /^[-*]\s/.test(l))) {
          return (
            <ul key={bi}>
              {lines.map((l, li) => (
                <li key={li}>{renderInline(l.replace(/^[-*]\s/, ""), `li-${bi}-${li}`)}</li>
              ))}
            </ul>
          );
        }
        return <p key={bi}>{renderInline(b.replace(/\n/g, " "), `p-${bi}`)}</p>;
      })}
    </>
  );
}
