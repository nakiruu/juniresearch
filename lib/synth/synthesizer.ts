/**
 * synthesizer.ts — the seam between the pipeline and whoever runs the model.
 * -----------------------------------------------------------------------------
 * Today the /synthesize skill is the implementation: the session model reads
 * the rendered prompt and writes the judgment file. An API-backed Synthesizer
 * (Anthropic Messages API with structured output) plugs in here later without
 * touching prompt, contract, validation, or merge.
 */
export interface Synthesizer {
  /** Returns the model's judgment object (unvalidated) for a rendered prompt. */
  synthesize(prompt: string, priorErrors?: string[]): Promise<unknown>;
}
