import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseCompanyFacts, type SecPeriod } from "./sec";

const facts = JSON.parse(readFileSync("lib/facts/free/__fixtures__/lly-companyfacts.json", "utf8"));

describe("parseCompanyFacts", () => {
  const { annual, quarter } = parseCompanyFacts(facts);
  const fy = (y: number) => annual.find((p) => p.fiscal_year === y)!;

  it("selects annual FY rows by 10-K, ~1-year duration, keyed by period-end year", () => {
    const latest = annual.at(-1)!;
    expect(latest.fiscal_period).toBe("FY");
    expect(latest.report_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(latest.revenue).toBeGreaterThan(0);
    expect(latest.net_income).not.toBeNull();
  });

  it("derives EBITDA as operating income + D&A", () => {
    const p = annual.at(-1)!;
    // EBITDA must exceed operating income when D&A is positive
    expect(p.ebitda!).toBeGreaterThan(p.operating_income!);
  });

  it("derives total debt, net debt (debt − cash), and free cash flow (OCF + capex, capex negative)", () => {
    const p = annual.at(-1)!;
    expect(p.total_debt!).toBeGreaterThan(0);
    expect(p.net_debt!).toBe(p.total_debt! - p.cash!);
    expect(p.capex!).toBeLessThan(0);
    expect(p.free_cash_flow!).toBe(p.operating_cash_flow! + p.capex!);
  });

  it("total debt reflects the live current-debt concept, not a stale one that merely exists somewhere in the filing history", () => {
    const p = annual.at(-1)!;
    // FY2025: LongTermDebtCurrent (the design spec's primary current-debt concept) has had no
    // LLY data since 2013; DebtCurrent ($1,635.0M for FY2025) is what LLY tags today for
    // LongTermDebtNoncurrent ($40,868.0M) + DebtCurrent ($1,635.0M) = $42,503.0M. Concept
    // selection that commits to the first concept present *anywhere* in the filing history
    // (rather than resolving per period) would lock onto the stale LongTermDebtCurrent tag,
    // silently drop the current-debt portion, and understate total_debt by $1.635B.
    expect(p.total_debt).toBe(42_503_000_000);
  });

  it("emits quarterly income rows labelled Q1..Q4 with revenue and operating income", () => {
    expect(quarter.length).toBeGreaterThanOrEqual(4);
    const latest = quarter.at(-1)!;
    expect(latest.fiscal_period).toMatch(/^Q[1-4]$/);
    expect(latest.revenue).toBeGreaterThan(0);
    expect(latest.operating_income).not.toBeNull();
  });
});
