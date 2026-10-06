import sys, numpy as np, pandas as pd
from scipy.stats import spearmanr
T = pd.read_parquet(sys.argv[1]); HOR = sys.argv[2] if len(sys.argv) > 2 else "f126"
ANN = 2 if HOR == "f126" else 4
MODELS = ["s_ew4", "s_ridge4", "s_lgb4", "s_ridge", "s_lgb_small", "s_lgb_mod", "s_lgb_deep", "s_lgb_es"]
def nw_t(x, lag=1):
    x = np.asarray(x, float); x = x[~np.isnan(x)]; n = len(x); e = x - x.mean(); v = (e @ e) / n
    for l in range(1, lag + 1): v += 2 * (1 - l / (lag + 1)) * (e[l:] @ e[:-l]) / n
    return x.mean() / np.sqrt(v / n)
def stats(d, s):
    r, rs = d[HOR], d.ret_stress
    ex, exs = r - r.mean(), rs - rs.mean()
    lo, hi = r.quantile([0.01, 0.99]); rw = r.clip(lo, hi); exw = rw - rw.mean()
    q = d[s].rank(pct=True); top, bot = q > 0.7, q <= 0.3
    return [spearmanr(d[s], r).correlation, ex[top].mean(), exs[top].mean(), exw[top].mean(), (r[top].median() - r.median()),
            ex[bot].mean(), exs[bot].mean(), q.corr(d[s])]
COLS = ["IC", "top30", "top30 stress", "top30 wins.", "top30 median", "bot30", "bot30 stress"]
def table(T, label, pairs=True):
    print(f"\n=== {label}: {T.date.nunique()} dates, ~{int(T.groupby('date').size().median())} names/date. Returns = {HOR} excess vs the slice's equal-weight mean, pp/yr (×{ANN}) ===")
    print(f"{'model':10s} " + " ".join(f"{c:>13s}" for c in COLS))
    res = {}
    for s in MODELS:
        r = np.array([stats(d, s) for _, d in T.groupby("date")]); res[s] = r
        cells = [f"{r[:,0].mean():.3f} (t{nw_t(r[:,0]):+.1f})"] + [f"{100*ANN*r[:,k].mean():+.2f} (t{nw_t(r[:,k]):+.1f})" for k in range(1, 7)]
        print(f"{s[2:]:10s} " + " ".join(f"{c:>13s}" for c in cells))
    if pairs:
        for a, b in [("s_lgb4", "s_ew4"), ("s_lgb4", "s_ridge4"), ("s_lgb_mod", "s_ridge"), ("s_lgb_es", "s_ridge"), ("s_lgb_mod", "s_ew4"), ("s_ridge", "s_ew4")]:
            dd = res[a] - res[b]
            print(f"  {a[2:]:8s} − {b[2:]:5s}: IC {dd[:,0].mean():+.3f} (t{nw_t(dd[:,0]):+.1f}) | top30 {100*ANN*dd[:,1].mean():+.2f} (t{nw_t(dd[:,1]):+.1f}), stressed {100*ANN*dd[:,2].mean():+.2f} (t{nw_t(dd[:,2]):+.1f}), median {100*ANN*dd[:,4].mean():+.2f} (t{nw_t(dd[:,4]):+.1f}) | bot30 stressed {100*ANN*dd[:,6].mean():+.2f} (t{nw_t(dd[:,6]):+.1f})")
    return res
for lo, lab in [(3e8, "≥ $300M"), (1e9, "≥ $1B"), (1e10, "≥ $10B")]:
    table(T[T.mcap >= lo], lab)
for era, (a, b) in {"2014–19": (2014, 2019), "2020–26": (2020, 2026)}.items():
    table(T[(T.mcap >= 1e9) & T.date.dt.year.between(a, b)], f"≥ $1B, {era}")
# turnover proxy: rank stability of each score between consecutive rebalances (≥ $1B)
U = T[T.mcap >= 1e9]
print("\nscore rank autocorrelation between consecutive rebalances (≥$1B): " + ", ".join(
    f"{s[2:]} {np.nanmean([spearmanr(a, b, nan_policy='omit').correlation for a, b in zip(*(lambda p: (p.iloc[:, :-1].T.values, p.iloc[:, 1:].T.values))(U.pivot_table(index='ticker', columns='date', values=s)))]):.2f}"
    for s in MODELS))
