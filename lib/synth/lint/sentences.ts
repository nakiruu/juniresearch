/**
 * sentences.ts — prose cut into sentences the way a reader cuts it.
 * -----------------------------------------------------------------------------
 * The repetition rules compare sentences, so a splitter that breaks "Mr. Tan"
 * or "$8.10" in half would invent repeats and miss real ones. Two guards do the
 * work: a sentence can only end where the next character is whitespace, a
 * closing quote or the end of the text (that alone handles every decimal), and
 * a trailing abbreviation or initial defers the break. Each Markdown block and
 * list line is scanned on its own so a heading never joins the sentence below.
 */

const ABBREVIATIONS = [
  "Mr", "Ms", "Mrs", "Dr", "Prof", "Sr", "Jr", "St",
  "Inc", "Corp", "Co", "Ltd", "LLC", "LP", "plc",
  "No", "Nos", "vs", "approx", "est", "cf", "al",
  "Jan", "Feb", "Mar", "Apr", "Jun", "Jul", "Aug", "Sept", "Sep", "Oct", "Nov", "Dec",
];
const ABBR = new RegExp(`(?:^|[\\s("'])(?:${ABBREVIATIONS.join("|")})\\.$`);
/** A single capital before the period: the "U." and the "S." of "U.S.", "J. Smith". */
const INITIAL = /(?:^|[\s("'.])[A-Z]\.$/;
/** Only a block's own leading marker is dropped; "- " inside a line is a dash, not a bullet. */
const MARKER = /^\s{0,3}(?:#{1,6}|[-*])\s+/;

function splitRun(run: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < run.length; i++) {
    const ch = run[i];
    if (ch !== "." && ch !== "!" && ch !== "?") continue;
    // Skip past Markdown closing markers (* or _) to find the true next character
    let endPos = i + 1;
    while (endPos < run.length && (run[endPos] === "*" || run[endPos] === "_")) {
      endPos++;
    }
    const next = endPos < run.length ? run[endPos] : undefined;
    if (next !== undefined && !/[\s"'"')\]]/.test(next)) continue;   // 65.2%, U.S.A, 8.10
    const head = run.slice(start, endPos);
    if (ch === "." && (ABBR.test(run.slice(start, i + 1)) || INITIAL.test(run.slice(start, i + 1)))) continue;
    const s = head.trim();
    if (s) out.push(s);
    start = endPos;
  }
  const tail = run.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

export function splitSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.replace(MARKER, "").trim())
    .filter(Boolean)
    .flatMap(splitRun);
}

export function normalizeSentence(s: string): string {
  return s
    .replace(/\{[+-]|[+-]\}/g, " ")   // bull / bear spans
    .replace(/\*\*/g, " ")            // bold
    .toLowerCase()
    .replace(/[0-9]/g, " ")
    .replace(/[^a-z\s-]/g, " ")
    .replace(/(^|\s)-+|-+(\s|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

export function wordTrigrams(s: string): Set<string> {
  const words = normalizeSentence(s).split(" ").filter(Boolean);
  const grams = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) grams.add(words.slice(i, i + 3).join(" "));
  return grams;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const g of a) if (b.has(g)) shared += 1;
  return shared / (a.size + b.size - shared);
}
