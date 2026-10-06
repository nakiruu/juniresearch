"""Yahoo daily closes (split-adjusted close, split+dividend adjclose, volume, splits) for the universe → prices/*.parquet."""
import json, time, os, urllib.request, concurrent.futures as cf, random
import pandas as pd, numpy as np
fr = pd.read_parquet("frames.parquet")
ni = fr[fr.concept == "NetIncomeLoss"].groupby("cik").period.nunique()
good = set(ni[ni >= 3].index)
t = json.load(open("tickers.json"))
seen, uni = set(), []
for cik, name, tic, ex in t["data"]:
    if ex not in ("NYSE", "Nasdaq") or cik in seen or cik not in good: continue
    seen.add(cik); uni.append((cik, tic.replace(".", "-")))
uni.append((0, "SPY"))
print("universe", len(uni), flush=True)
os.makedirs("prices", exist_ok=True)
P1, P2 = 1230768000, 1791000000  # 2009-01-01 .. now
def get(item):
    cik, tic = item
    out = f"prices/{tic}.parquet"
    if os.path.exists(out): return tic, "cached"
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{tic}?period1={P1}&period2={P2}&interval=1d&events=split"
    for i in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=60) as r:
                d = json.load(r)["chart"]["result"][0]
            if "timestamp" not in d: return tic, "empty"
            q = d["indicators"]["quote"][0]
            df = pd.DataFrame({"date": pd.to_datetime(d["timestamp"], unit="s").normalize(), "close": q["close"], "volume": q["volume"],
                               "adj": d["indicators"]["adjclose"][0]["adjclose"]})
            df["cik"] = cik
            sp = d.get("events", {}).get("splits", {})
            df.attrs = {}
            splits = pd.DataFrame([(pd.to_datetime(v["date"], unit="s").normalize(), v["numerator"] / v["denominator"]) for v in sp.values()], columns=["date", "ratio"])
            df.dropna(subset=["close", "adj"]).to_parquet(out)
            splits.to_parquet(f"prices/{tic}.splits.parquet")
            return tic, "ok"
        except urllib.error.HTTPError as e:
            if e.code in (404, 400): return tic, f"http{e.code}"
            time.sleep(2 ** i + random.random())
        except Exception as e:
            time.sleep(2 ** i + random.random())
    return tic, "failed"
from collections import Counter
st = Counter()
with cf.ThreadPoolExecutor(8) as ex:
    for i, (tic, s) in enumerate(ex.map(get, uni)):
        st[s] += 1
        if i % 500 == 0: print(i, dict(st), flush=True)
print("done", dict(st))
pd.DataFrame(uni, columns=["cik", "ticker"]).to_parquet("universe.parquet")
