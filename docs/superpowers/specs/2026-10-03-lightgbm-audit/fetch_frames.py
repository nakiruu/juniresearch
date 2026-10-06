"""Pull SEC XBRL frames (one request = every filer's value for one concept-period) → frames.parquet."""
import os, json, time, urllib.request, concurrent.futures as cf
import pandas as pd
UA = f"juniresearch/0.1 ({os.environ['EDGAR_CONTACT']})"
DUR = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet",
       "RevenueFromContractWithCustomerIncludingAssessedTax", "NetIncomeLoss", "GrossProfit", "CostOfRevenue",
       "CostOfGoodsAndServicesSold", "OperatingIncomeLoss", "NetCashProvidedByUsedInOperatingActivities",
       "PaymentsToAcquirePropertyPlantAndEquipment"]
INST = ["Assets", "StockholdersEquity", "Liabilities", "AssetsCurrent", "LiabilitiesCurrent"]
jobs = [("us-gaap", c, "USD", f"CY{y}") for c in DUR for y in range(2007, 2026)]
jobs += [("us-gaap", c, "USD", f"CY{y}Q4I") for c in INST for y in range(2007, 2026)]
jobs += [("us-gaap", "CommonStockSharesOutstanding", "shares", f"CY{y}Q{q}I") for y in range(2007, 2026) for q in (2, 4)]
jobs += [("dei", "EntityPublicFloat", "USD", f"CY{y}Q2I") for y in range(2007, 2026)]
def get(job):
    tax, c, u, p = job
    url = f"https://data.sec.gov/api/xbrl/frames/{tax}/{c}/{u}/{p}.json"
    for i in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as r:
                d = json.load(r)
            return [(c, p, x["cik"], x.get("start"), x["end"], x["val"], x["accn"]) for x in d["data"]]
        except urllib.error.HTTPError as e:
            if e.code == 404: return []
            time.sleep(2 ** i)
        except Exception:
            time.sleep(2 ** i)
    print("FAILED", url); return []
rows = []
with cf.ThreadPoolExecutor(4) as ex:
    for i, r in enumerate(ex.map(get, jobs)):
        rows += r
        if i % 50 == 0: print(i, len(jobs), len(rows), flush=True)
df = pd.DataFrame(rows, columns=["concept", "period", "cik", "start", "end", "val", "accn"])
df.to_parquet("frames.parquet"); print("done", len(df), df.concept.value_counts().to_dict())
