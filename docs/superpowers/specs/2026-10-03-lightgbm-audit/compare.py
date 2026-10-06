"""Walk-forward: EW rank composite (system audit's) vs ridge vs LightGBM, retrained yearly with a 126-session embargo."""
import sys, numpy as np, pandas as pd, lightgbm as lgb
from sklearn.linear_model import Ridge
P = pd.read_parquet("panel.parquet")
FEATS = ["ey", "bm", "sp", "cfp", "gpa", "roe", "opm", "accruals", "asset_growth", "sales_growth", "leverage", "cur_ratio",
         "mom12_1", "mom6_1", "rev1m", "hi52", "vol252", "beta", "log_mcap", "log_dvol"]
TRAIN_MIN = float(sys.argv[1]) if len(sys.argv) > 1 else 3e8     # training universe floor
HOR = sys.argv[2] if len(sys.argv) > 2 else "f126"
P = P[P[HOR].notna()].copy()
P = P[P.mcap >= TRAIN_MIN].copy()
g = P.groupby("date")
for f in FEATS: P["r_" + f] = g[f].rank(pct=True)
pb = np.where(P.mcap >= 1e10, 0.1, np.where(P.mcap >= 2e9, 0.2, 0.3))
# (for f63 the stress still uses the 126-session path minimum, which slightly overstates busts)
P["ret_stress"] = np.where(P.fmin126 <= 0.5, (1 - pb) * P[HOR] + pb * -0.7, P[HOR])
P["y_ex"] = P[HOR] - g[HOR].transform("mean")
P["y_rank"] = g[HOR].rank(pct=True)
RF = ["r_" + f for f in FEATS]
Xlin = lambda d: d[RF].fillna(0.5).values
P["s_ew4"] = P[["r_ey", "r_roe", "r_gpa", "r_mom12_1"]].mean(axis=1).fillna(0.5)   # system-audit composite (mean of available ranks)
emb = pd.Timedelta(days=190 if HOR == "f126" else 100)
cfg = {
  "lgb_mod":   dict(n_estimators=300, learning_rate=0.03, num_leaves=31, min_child_samples=1000, subsample=0.8, subsample_freq=1, colsample_bytree=0.8, reg_lambda=10),
  "lgb_small": dict(n_estimators=300, learning_rate=0.03, num_leaves=7,  min_child_samples=2000, subsample=0.8, subsample_freq=1, colsample_bytree=0.8, reg_lambda=10),
  "lgb_deep":  dict(n_estimators=600, learning_rate=0.03, num_leaves=63, min_child_samples=200,  subsample=0.8, subsample_freq=1, colsample_bytree=0.8),
}
out = []
imp = np.zeros(len(RF))
for Y in range(2014, 2027):
    te = P[P.date.dt.year == Y]
    if te.empty: continue
    tr = P[P.date < pd.Timestamp(Y, 1, 1) - emb]
    s = {}
    rg = Ridge(alpha=10.0).fit(Xlin(tr), tr.y_rank); s["ridge"] = rg.predict(Xlin(te))
    for k, c in cfg.items():
        m = lgb.LGBMRegressor(verbose=-1, random_state=1, **c).fit(tr[RF].values, tr.y_rank.values)
        s[k] = m.predict(te[RF].values)
        if k == "lgb_mod": imp += m.booster_.feature_importance("gain")
    # early-stopped: hold out the last 8 training dates (time-ordered) to pick the number of trees
    dates = np.sort(tr.date.unique()); cut = dates[-8]; a, b = tr[tr.date < cut - emb], tr[tr.date >= cut]
    m = lgb.LGBMRegressor(verbose=-1, random_state=1, n_estimators=2000, **{k: v for k, v in cfg["lgb_mod"].items() if k != "n_estimators"})
    m.fit(a[RF].values, a.y_rank.values, eval_set=[(b[RF].values, b.y_rank.values)], callbacks=[lgb.early_stopping(100, verbose=False)])
    nb = max(m.best_iteration_ or 1, 1)
    m2 = lgb.LGBMRegressor(verbose=-1, random_state=1, **{**cfg["lgb_mod"], "n_estimators": nb}).fit(tr[RF].values, tr.y_rank.values)
    s["lgb_es"] = m2.predict(te[RF].values)
    R4 = ["r_ey", "r_roe", "r_gpa", "r_mom12_1"]
    s["ridge4"] = Ridge(alpha=10.0).fit(tr[R4].fillna(0.5).values, tr.y_rank).predict(te[R4].fillna(0.5).values)
    s["lgb4"] = lgb.LGBMRegressor(verbose=-1, random_state=1, **cfg["lgb_mod"]).fit(tr[R4].values, tr.y_rank.values).predict(te[R4].values)
    t = te[["date", "ticker", "mcap", HOR, "ret_stress", "s_ew4"]].copy()
    for k, v in s.items(): t["s_" + k] = v
    t["es_trees"] = nb
    out.append(t)
    print(Y, "train", len(tr), "test", len(te), "es trees", nb, flush=True)
T = pd.concat(out); T.to_parquet(f"preds_{int(TRAIN_MIN/1e8)}_{HOR}.parquet")
print("gain importance (lgb_mod):", dict(sorted(zip(FEATS, (imp / imp.sum()).round(3)), key=lambda x: -x[1])))
