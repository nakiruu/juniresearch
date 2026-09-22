/**
 * macro.ts — the desk's capital-markets assumptions, in one place.
 * -----------------------------------------------------------------------------
 * The risk-free rate and equity risk premium feed the WACC build-up (moat.ts) and,
 * through the cost of equity, the reverse-DCF discount rate (intrinsic.ts). They
 * were duplicated across moat.ts and three scripts (7.md I3); this is the single
 * source. A leaf module (no imports) so both lib and scripts can import it without
 * a cycle. Promote to a live/desk-tuned source (FRED 10y, a monthly ERP) later —
 * see docs/scoreconcepts/10.md §2.
 */
export const MACRO = { riskFree: 0.043, erp: 0.045 } as const;
