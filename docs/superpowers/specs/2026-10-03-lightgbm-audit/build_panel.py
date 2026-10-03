"""Point-in-time panel: features at the first session of Feb/May/Aug/Nov 2010-2026, forward 63/126-session total returns."""
import glob, os
import numpy as np, pandas as pd
LAG = pd.Timedelta(days=120)          # fundamentals usable 120 days after period end (10-K/10-Q deadlines + slack)
SH_LAG = pd.Timedelta(days=90)
uni = pd.read_parquet("universe.parquet")
# ---------- prices → wide ----------
closes, adjs, vols, F = {}, {}, {}, {}
for cik, tic in uni.itertuples(index=False):
    p = f"prices/{tic}.parquet"
    if not os.path.exists(p): continue
    d = pd.read_parquet(p).drop_duplicates("date").set_index("date")
    if len(d) < 300: continue
    closes[tic], adjs[tic], vols[tic] = d.close, d.adj, d.volume
C = pd.DataFrame(closes); A = pd.DataFrame(adjs); V = pd.DataFrame(vols)
cal = A["SPY"].dropna().index; C, A, V = C.reindex(cal), A.reindex(cal), V.reindex(cal)
print("price matrix", C.shape, flush=True)
# split factor F(t) = product of splits strictly after t (Yahoo close is adjusted for all of them)
Fm = pd.DataFrame(1.0, index=cal, columns=C.columns)
for tic in C.columns:
    sp = f"prices/{tic}.splits.parquet"
    if os.path.exists(sp):
        s = pd.read_parquet(sp)
        for dt, r in s.itertuples(index=False):
            if r and np.isfinite(r) and r > 0: Fm.loc[Fm.index < dt, tic] *= r
R = np.log(A).diff()
# rebalance dates
reb = [cal[cal >= pd.Timestamp(y, m, 1)][0] for y in range(2010, 2027) for m in (2, 5, 8, 11) if pd.Timestamp(y, m, 1) <= pd.Timestamp(2026, 2, 1)]
idx = {d: i for i, d in enumerate(cal)}
spy = R["SPY"]
rows = []
tick2cik = dict(zip(uni.ticker, uni.cik))
for d in reb:
    i = idx[d]
    if i < 260: continue
    c0, c21, c126, c252 = C.iloc[i], C.iloc[i - 21], C.iloc[i - 126], C.iloc[i - 252]
    hi = C.iloc[i - 251:i + 1].max()
    win = R.iloc[i - 251:i + 1]
    vol = win.std() * np.sqrt(252)
    sw = win["SPY"]; beta = win.apply(lambda x: x.cov(sw)) / sw.var()
    nobs = win.notna().sum()
    dvol = (C.iloc[i - 62:i + 1] * V.iloc[i - 62:i + 1]).mean()
    f63 = A.iloc[i + 63] / A.iloc[i] - 1 if i + 63 < len(cal) else pd.Series(np.nan, index=C.columns)
    f126 = A.iloc[i + 126] / A.iloc[i] - 1 if i + 126 < len(cal) else pd.Series(np.nan, index=C.columns)
    raw = c0 * Fm.iloc[i]
    df = pd.DataFrame({"date": d, "ticker": C.columns, "close": c0.values, "raw_close": raw.values, "F": Fm.iloc[i].values,
                       "mom12_1": (c21 / c252 - 1).values, "mom6_1": (c21 / c126 - 1).values, "rev1m": (c0 / c21 - 1).values,
                       "hi52": (c0 / hi).values, "vol252": vol.values, "beta": beta.values, "nobs": nobs.values,
                       "dvol": dvol.values, "f63": f63.values, "f126": f126.values})
    rows.append(df[df.ticker != "SPY"])
    print(d.date(), end=" ", flush=True)
P = pd.concat(rows, ignore_index=True); P["cik"] = P.ticker.map(tick2cik)
P = P[(P.nobs >= 240) & P.close.notna()]
print("\nprice panel", P.shape, flush=True)
# ---------- fundamentals ----------
fr = pd.read_parquet("frames.parquet"); fr["end"] = pd.to_datetime(fr.end); fr["start"] = pd.to_datetime(fr.start)
fr = fr.sort_values("accn").drop_duplicates(["concept", "cik", "end", "start"], keep="last")
def ann(concepts):
    x = fr[fr.concept.isin(concepts) & fr.start.notna()].copy()
    x = x[(x.end - x.start).dt.days.between(340, 380)]
    x["pri"] = x.concept.map({c: k for k, c in enumerate(concepts)})
    return x.sort_values("pri").drop_duplicates(["cik", "end"])[["cik", "end", "val"]]
REV = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"]
a = ann(REV).rename(columns={"val": "rev"})
for name, cs in [("ni", ["NetIncomeLoss"]), ("gp", ["GrossProfit"]), ("cogs", ["CostOfRevenue", "CostOfGoodsAndServicesSold"]),
                 ("opi", ["OperatingIncomeLoss"]), ("ocf", ["NetCashProvidedByUsedInOperatingActivities"]), ("capex", ["PaymentsToAcquirePropertyPlantAndEquipment"])]:
    a = a.merge(ann(cs).rename(columns={"val": name}), on=["cik", "end"], how="outer")
a["gp"] = a.gp.fillna(a.rev - a.cogs)
a = a.sort_values("end")
prev = a[["cik", "end", "rev"]].rename(columns={"rev": "rev_prev"}).copy(); prev["end_k"] = prev.end + pd.Timedelta(days=365)
a = pd.merge_asof(a.sort_values("end"), prev.sort_values("end_k")[["cik", "end_k", "rev_prev"]], left_on="end", right_on="end_k", by="cik", tolerance=pd.Timedelta(days=40), direction="nearest")
a["avail"] = a.end + LAG
def inst(concept):
    x = fr[(fr.concept == concept) & fr.start.isna()][["cik", "end", "val"]].rename(columns={"val": concept}).sort_values("end")
    return x
bs = inst("Assets")
for c in ["StockholdersEquity", "Liabilities", "AssetsCurrent", "LiabilitiesCurrent"]:
    bs = bs.merge(inst(c), on=["cik", "end"], how="outer")
bs = bs.sort_values("end")
bprev = bs[["cik", "end", "Assets"]].rename(columns={"Assets": "assets_prev"}).copy(); bprev["end_k"] = bprev.end + pd.Timedelta(days=365)
bs = pd.merge_asof(bs, bprev.sort_values("end_k")[["cik", "end_k", "assets_prev"]], left_on="end", right_on="end_k", by="cik", tolerance=pd.Timedelta(days=40), direction="nearest")
bs["avail"] = bs.end + LAG
sh = inst("CommonStockSharesOutstanding").rename(columns={"CommonStockSharesOutstanding": "shares", "end": "sh_end"}); sh["sh_avail"] = sh.sh_end + SH_LAG
fl = fr[fr.concept == "EntityPublicFloat"][["cik", "end", "val"]].rename(columns={"val": "pfloat", "end": "fl_end"}); fl["fl_avail"] = fl.fl_end + pd.Timedelta(days=270)
P = P.sort_values("date"); P = P[P.cik.notna()]; P["cik"] = P.cik.astype(int)
tol = pd.Timedelta(days=550)
P = pd.merge_asof(P, a.drop(columns=["end_k"]).rename(columns={"end": "a_end"}).sort_values("avail"), left_on="date", right_on="avail", by="cik", tolerance=tol).drop(columns=["avail"])
P = pd.merge_asof(P, bs.drop(columns=["end_k"]).rename(columns={"end": "b_end"}).sort_values("avail"), left_on="date", right_on="avail", by="cik", tolerance=tol).drop(columns=["avail"])
P = pd.merge_asof(P, sh.sort_values("sh_avail"), left_on="date", right_on="sh_avail", by="cik", tolerance=tol)
P = pd.merge_asof(P, fl.sort_values("fl_avail"), left_on="date", right_on="fl_avail", by="cik", tolerance=pd.Timedelta(days=700))
# market cap: shares_raw(end) × F(end) × close(t); F(end) from the split-factor matrix
Fl = Fm.stack().rename("Fv").reset_index().rename(columns={"level_0": "d", "level_1": "ticker"})
Fl = Fl.rename(columns={Fl.columns[0]: "d"}).sort_values("d")
for col, out in [("sh_end", "F_sh"), ("fl_end", "F_fl")]:
    tmp = P[["ticker", col]].dropna().drop_duplicates().sort_values(col)
    tmp = pd.merge_asof(tmp, Fl, left_on=col, right_on="d", by="ticker", direction="backward").drop(columns=["d"]).rename(columns={"Fv": out})
    P = P.merge(tmp, on=["ticker", col], how="left")
Cl = C.stack().rename("c_fl").reset_index(); Cl = Cl.rename(columns={Cl.columns[0]: "d", Cl.columns[1]: "ticker"}).sort_values("d")
tmp = P[["ticker", "fl_end"]].dropna().drop_duplicates().sort_values("fl_end")
tmp = pd.merge_asof(tmp, Cl, left_on="fl_end", right_on="d", by="ticker", direction="backward", tolerance=pd.Timedelta(days=7)).drop(columns=["d"])
P = P.merge(tmp, on=["ticker", "fl_end"], how="left")
P["mcap_sh"] = P.shares * P.F_sh * P.close
P["float_t"] = P.pfloat * P.close / P.c_fl
ratio = P.mcap_sh / P.float_t
ok = ratio.between(0.9, 20) | (P.float_t.isna() & P.mcap_sh.notna())
P["mcap"] = np.where(ok, P.mcap_sh, P.float_t / 0.85)
P["mcap_src"] = np.where(ok, "shares", np.where(P.float_t.notna(), "float", "none"))
print("mcap source", P.mcap_src.value_counts().to_dict(), flush=True)
# ---------- features ----------
m = P.mcap
P["ey"] = P.ni / m; P["bm"] = P.StockholdersEquity / m; P["sp"] = P.rev / m; P["cfp"] = (P.ocf - P.capex.fillna(0)) / m
P["gpa"] = P.gp / P.Assets; P["roe"] = np.where(P.StockholdersEquity > 0, P.ni / P.StockholdersEquity, np.nan)
P["opm"] = np.where(P.rev > 0, P.opi / P.rev, np.nan); P["accruals"] = (P.ni - P.ocf) / P.Assets
P["asset_growth"] = P.Assets / P.assets_prev - 1; P["sales_growth"] = np.where(P.rev_prev > 0, P.rev / P.rev_prev - 1, np.nan)
P["leverage"] = P.Liabilities / P.Assets; P["cur_ratio"] = P.AssetsCurrent / P.LiabilitiesCurrent
P["log_mcap"] = np.log(P.mcap); P["log_dvol"] = np.log(P.dvol.clip(lower=1))
FEATS = ["ey", "bm", "sp", "cfp", "gpa", "roe", "opm", "accruals", "asset_growth", "sales_growth", "leverage", "cur_ratio",
         "mom12_1", "mom6_1", "rev1m", "hi52", "vol252", "beta", "log_mcap", "log_dvol"]
for f in FEATS: P[f] = P[f].replace([np.inf, -np.inf], np.nan)
P = P[(P.raw_close >= 3) & (P.mcap >= 3e8) & (P.dvol >= 1e6)]
keep = ["date", "ticker", "cik", "mcap", "mcap_src", "f63", "f126"] + FEATS
P[keep].to_parquet("panel.parquet")
print("panel", P.shape, "dates", P.date.nunique(), "names/date median", int(P.groupby("date").size().median()))
print("feature coverage", {f: round(P[f].notna().mean(), 2) for f in FEATS})
print("≥$1B per date (median)", int(P[P.mcap >= 1e9].groupby("date").size().median()), " ≥$10B", int(P[P.mcap >= 1e10].groupby("date").size().median()))
