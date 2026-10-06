"""Experiment B: can LightGBM beat Street upside alone at predicting BUY vs HOLD on the desk's published reports?"""
import json, glob, math, os, warnings
import numpy as np, pandas as pd
from sklearn.model_selection import RepeatedStratifiedKFold
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
from sklearn.impute import SimpleImputer
from sklearn.metrics import roc_auc_score
import lightgbm as lgb
warnings.filterwarnings("ignore")
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../../.."))  # repo root

shib = {r["ticker"]: r for r in json.load(open("data/raw/_shibui/screen-calibration-2026-10-03.json"))["result"]}
rows = []
for f in sorted(glob.glob("data/*.json")):
    r = json.load(open(f))
    if "rating" not in r: continue
    t = r["meta"]["ticker"]; lab = r["rating"]["label"]
    if lab not in ("BUY", "HOLD", "STRONG BUY"): continue
    a = r.get("analystSentiment") or {}; q = r["quote"]; dec = r["rating"].get("decision") or {}; g = r["rating"].get("gate") or {}
    p = q["currentPrice"]; ct = a.get("consensusTarget")
    n = (a.get("buy") or 0) + (a.get("hold") or 0) + (a.get("sell") or 0)
    s = shib.get(t, {})
    moat = (dec.get("moat") or {}); intr = dec.get("intrinsic") or {}; comp = dec.get("composite") or {}
    rows.append(dict(
        ticker=t, y=int(lab != "HOLD"),
        street_up_pit=(ct / p - 1) if ct and p else np.nan,
        street_up_now=(s["street_target"] / s["close"] - 1) if s.get("street_target") and s.get("close") else np.nan,
        n_analysts=a.get("numAnalysts") or np.nan,
        buy_share=(a.get("buy") or 0) / n if n else np.nan,
        tgt_disp=((a["highTarget"] - a["lowTarget"]) / ct) if ct and a.get("highTarget") and a.get("lowTarget") else np.nan,
        fwd_pe=s.get("forward_pe") if s.get("forward_pe") is not None else np.nan,
        fwd_peg=s.get("forward_peg") if s.get("forward_peg") is not None else np.nan,
        fcf_yield=s.get("fcf_yield") if s.get("fcf_yield") is not None else np.nan,
        piotroski=g.get("piotroski") if g.get("piotroski") is not None else np.nan,
        eq_flags=len([x for x in (s.get("eq_flags") or "").split(",") if x]),
        log_mcap=math.log(q["marketCap"]) if q.get("marketCap") else np.nan,
        pos52=(p - q["week52Low"]) / (q["week52High"] - q["week52Low"]) if q.get("week52High") and q.get("week52Low") and q["week52High"] > q["week52Low"] else np.nan,
        composite=comp.get("percentile") if comp.get("percentile") is not None else np.nan,
        moat={"WIDE": 1, "NARROW": .5, "NONE": 0}.get(moat.get("width"), np.nan),
        mos=intr.get("marginOfSafety") if intr.get("marginOfSafety") is not None else np.nan,
        distress={"SAFE": 0, "GREY": 1, "DISTRESS": 2}.get(g.get("distress"), np.nan),
    ))
df = pd.DataFrame(rows)
print(f"reports: {len(df)}  BUY-side: {df.y.sum()}  HOLD: {(1-df.y).sum()}")
feats = [c for c in df.columns if c not in ("ticker", "y")]
print("coverage:", {c: int(df[c].notna().sum()) for c in feats})

y = df.y.values
def auc_raw(col):
    m = df[col].notna(); return roc_auc_score(y[m], df[col][m])
print(f"\nNo-fit AUC, PIT Street upside: {auc_raw('street_up_pit'):.3f}  (n={df.street_up_pit.notna().sum()}); snapshot Street upside: {auc_raw('street_up_now'):.3f}")
for c in feats:
    if c.startswith("street"): continue
    try: print(f"  single-feature AUC {c:12s} {auc_raw(c):.3f}")
    except Exception as e: pass

X = df[feats].values
rskf = RepeatedStratifiedKFold(n_splits=5, n_repeats=40, random_state=7)
models = {
    "logit: PIT Street upside only": (lambda: make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), LogisticRegression(C=1.0)), ["street_up_pit"]),
    "logit (L2): all 16 features": (lambda: make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), LogisticRegression(C=0.3, max_iter=2000)), feats),
    "LightGBM: all 16, small (4 leaves, 100 trees)": (lambda: lgb.LGBMClassifier(n_estimators=100, learning_rate=0.05, num_leaves=4, min_child_samples=8, subsample=0.8, subsample_freq=1, colsample_bytree=0.8, verbose=-1), feats),
    "LightGBM: all 16, default (31 leaves, 100 trees)": (lambda: lgb.LGBMClassifier(n_estimators=100, verbose=-1, min_child_samples=5), feats),
    "LightGBM: all 16, stumps (2 leaves, 200 trees)": (lambda: lgb.LGBMClassifier(n_estimators=200, learning_rate=0.03, num_leaves=2, min_child_samples=8, verbose=-1), feats),
}
res = {}
for name, (mk, cols) in models.items():
    Xi = df[cols].values; aucs = []
    for tr, te in rskf.split(Xi, y):
        m = mk(); m.fit(Xi[tr], y[tr]); aucs.append(roc_auc_score(y[te], m.predict_proba(Xi[te])[:, 1]))
    res[name] = np.array(aucs)
    print(f"{name:52s} CV AUC {np.mean(aucs):.3f}  (fold sd {np.std(aucs):.3f})")
base = res["logit: PIT Street upside only"]
for k, v in res.items():
    if k == "logit: PIT Street upside only": continue
    d = v - base
    # repeats are not independent; report the mean diff and the share of folds it wins
    print(f"  {k:52s} vs Street-only: {d.mean():+.3f}, wins {np.mean(d>0)*100:.0f}% of folds")

print("\n--- is it the trees or the features? ---")
from scipy.stats import spearmanr
print("Spearman(pos52, street_up_pit):", round(spearmanr(df.pos52, df.street_up_pit).correlation, 2))
extra = {
    "logit: Street upside + 52w position": (lambda: make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), LogisticRegression(C=1.0)), ["street_up_pit", "pos52"]),
    "logit: Street + 52w + buy share + Piotroski": (lambda: make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), LogisticRegression(C=1.0)), ["street_up_pit", "pos52", "buy_share", "piotroski"]),
    "LightGBM small: Street + 52w only": (lambda: lgb.LGBMClassifier(n_estimators=100, learning_rate=0.05, num_leaves=4, min_child_samples=8, subsample=0.8, subsample_freq=1, colsample_bytree=1.0, verbose=-1), ["street_up_pit", "pos52"]),
}
oof_store = {}
for name, (mk, cols) in {**{k: models[k] for k in ["logit: PIT Street upside only", "LightGBM: all 16, small (4 leaves, 100 trees)"]}, **extra}.items():
    Xi = df[cols].values; aucs = []; oof = np.zeros((40, len(y)))
    for i, (tr, te) in enumerate(rskf.split(Xi, y)):
        m = mk(); m.fit(Xi[tr], y[tr]); pr = m.predict_proba(Xi[te])[:, 1]; aucs.append(roc_auc_score(y[te], pr)); oof[i // 5, te] = pr
    # queue value: BUYs among the first 20 / 40 written, averaged over repeats (out-of-fold scores)
    top20 = np.mean([y[np.argsort(-oof[r])[:20]].sum() for r in range(40)]); top40 = np.mean([y[np.argsort(-oof[r])[:40]].sum() for r in range(40)])
    print(f"{name:52s} CV AUC {np.mean(aucs):.3f} | BUYs in first 20 written {top20:.1f}, first 40 {top40:.1f}")
print(f"(random order: {20*y.mean():.1f} / {40*y.mean():.1f}; perfect: 20 / 40)")
