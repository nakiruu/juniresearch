"""Nested CV: pick the LightGBM config inside each outer fold, so the AUC carries no selection optimism."""
import os
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "screen_test.py")).read().split("X = df[feats].values")[0])
from sklearn.model_selection import StratifiedKFold
cfgs = [dict(n_estimators=100, learning_rate=0.05, num_leaves=4, min_child_samples=8, subsample=0.8, subsample_freq=1, colsample_bytree=0.8),
        dict(n_estimators=100, num_leaves=31, min_child_samples=5),
        dict(n_estimators=200, learning_rate=0.03, num_leaves=2, min_child_samples=8),
        dict(n_estimators=300, learning_rate=0.02, num_leaves=8, min_child_samples=10, subsample=0.7, subsample_freq=1, colsample_bytree=0.6, reg_lambda=5)]
X = df[feats].values; outer = RepeatedStratifiedKFold(n_splits=5, n_repeats=10, random_state=11)
nested, street = [], []
for tr, te in outer.split(X, y):
    inner = StratifiedKFold(5, shuffle=True, random_state=1); best, bs = None, -1
    for c in cfgs:
        s = np.mean([roc_auc_score(y[tr][b], lgb.LGBMClassifier(verbose=-1, **c).fit(X[tr][a], y[tr][a]).predict_proba(X[tr][b])[:, 1]) for a, b in inner.split(X[tr], y[tr])])
        if s > bs: best, bs = c, s
    nested.append(roc_auc_score(y[te], lgb.LGBMClassifier(verbose=-1, **best).fit(X[tr], y[tr]).predict_proba(X[te])[:, 1]))
    street.append(roc_auc_score(y[te], df.street_up_pit.values[te]))
nested, street = np.array(nested), np.array(street)
print(f"nested-CV LightGBM (config picked inside each fold): AUC {nested.mean():.3f}; Street upside (no fit) {street.mean():.3f}; diff {np.mean(nested-street):+.3f}, LightGBM wins {np.mean(nested>street)*100:.0f}% of folds")
