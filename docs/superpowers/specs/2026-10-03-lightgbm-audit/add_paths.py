"""Forward path minimum (lowest adj close over the next 126 sessions / entry) for the bust stress."""
import os, numpy as np, pandas as pd
P = pd.read_parquet("panel.parquet")
adj = {}
for t in P.ticker.unique():
    d = pd.read_parquet(f"prices/{t}.parquet").drop_duplicates("date").set_index("date"); adj[t] = d.adj
spy = pd.read_parquet("prices/SPY.parquet").drop_duplicates("date").set_index("date").adj
A = pd.DataFrame(adj).reindex(spy.index)
idx = {d: i for i, d in enumerate(A.index)}
out = []
for d, g in P.groupby("date"):
    i = idx[d]; w = A.iloc[i:i + 127]
    mn = (w.min() / w.iloc[0]).reindex(g.ticker.values).values
    out.append(pd.DataFrame({"date": d, "ticker": g.ticker.values, "fmin126": mn}))
P = P.merge(pd.concat(out), on=["date", "ticker"], how="left")
P.to_parquet("panel.parquet"); print("hit -50% within 126 sessions:", round((P.fmin126 <= 0.5).mean() * 100, 2), "% of stock-dates")
