import type { Filing } from "../edgar/submissions";

/**
 * The seam between "how raw files are produced" and everything downstream.
 * Today the only implementation is the fetch-facts skill (prose, executed by a
 * Claude session with the FMP and Bigdata.com connectors). A future
 * RestFactSource produces the same files from the same manifest using API keys.
 * build.ts reads the directory and does not know which wrote it.
 */
export interface FactSource {
  capture(ticker: string, filing: Filing, outDir: string): Promise<void>;
}
