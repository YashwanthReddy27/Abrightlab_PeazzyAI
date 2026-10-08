"""Runs the model, writes app/data.js and margin_lens.db. Run: python data_model/build.py"""
import json
import random
import sqlite3
from pathlib import Path

from model import DRIVERS, TARGET_GM, WEEKS_PER_MONTH, analyze
from synthetic import FACILITY_TYPES, METROS, generate

SEED = 7
HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "app" / "data.js"
SCHEMA = HERE / "schema.sql"
DB = HERE / "margin_lens.db"
MONTH = "2026-09"


def export(customers, vendors, locations, result):
    r = round
    market, cards = result["market"], result["scorecards"]
    out = {
        "generated": "synthetic, seed %d" % SEED,
        "targetGm": TARGET_GM,
        "weeksPerMonth": WEEKS_PER_MONTH,
        "metros": [{"name": m[0], "lat": m[1], "lon": m[2], "idx": m[3],
                    "market": r(market.get(i, 0), 2)} for i, m in enumerate(METROS) if i in market],
        "types": [t[0] for t in FACILITY_TYPES],
        "customers": [{"id": c["id"], "name": c["name"], "type": c["type"], "pricing": c["pricing"],
                       "escalator": c["escalator"], "start": c["start"]} for c in customers],
        "vendors": [{"id": v["id"], "name": v["name"], "metro": v["metro"],
                     "rate": r(v["rate"], 2), "card": cards.get(v["id"])} for v in vendors],
        "clusters": result["clusters"],
        "flags": result["flags"],
        "plays": result["plays"],
        "locations": [{
            "id": l["id"], "name": l["name"], "cust": l["cust"], "metro": l["metro"],
            "lat": r(l["lat"], 3), "lon": r(l["lon"], 3), "sqft": int(l["sqft"]),
            "freq": l["freq"], "actualFreq": l["actual_freq"], "hours": r(l["hours"], 2),
            "price": r(l["price"]), "credits": r(l["credits"]), "base": r(l["base"]),
            "trip": r(l["trip"]), "extras": r(l["extras"]), "cost": r(l["cost"]),
            "margin": r(l["margin"]), "gm": r(l["gm"], 4),
            "should": r(l["should"]), "targetPrice": r(l["target_price"]),
            "vendor": l["vendor"], "rate": r(l["rate"], 2), "dist": r(l["dist"], 1),
            "density": l["density"], "dwell": r(l["dwell"], 2),
            "inspection": r(l["inspection"]), "issues": l["issues"],
            "comp": [r(l["comp"][d]) for d in DRIVERS],
            "status": l["status"], "primary": l["primary"],
            "alt": l.get("alt"), "orphans": l.get("orphans", 0),
            "dups": l["dups"], "dupReason": l["dup_reason"], "dupCost": r(l["dup_cost"]),
            "cluster": l["cluster"], "tip": l["tip"],
            "bench": {"own": [r(x, 2) for x in l["bench"]["own"]], "peer": [r(x, 2) for x in l["bench"]["peer"]],
                      "n": l["bench"]["n"], "scope": l["bench"]["scope"]},
        } for l in locations],
    }
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("window.DATA = ")
        json.dump(out, f, separators=(",", ":"))
        f.write(";\n")


def write_database(customers, vendors, locations, market):
    """Loads the portfolio into the relational schema and checks the SQL view against the Python model."""
    DB.unlink(missing_ok=True)
    con = sqlite3.connect(DB)
    con.executescript(SCHEMA.read_text(encoding="utf-8"))
    metro = [m[0] for m in METROS]
    con.executemany("INSERT INTO business_target VALUES (?, ?)",
                    [("target_gross_margin", TARGET_GM), ("thin_margin", 0.10), ("weeks_per_month", WEEKS_PER_MONTH)])
    con.executemany("INSERT INTO metro_benchmark VALUES (?, ?, ?)",
                    [(metro[i], METROS[i][3], rate) for i, rate in market.items()])
    con.executemany("INSERT INTO customer VALUES (?, ?, ?, ?, ?, ?)",
                    [(c["id"], c["name"], FACILITY_TYPES[c["type"]][0], c["pricing"], c["start"], int(c["escalator"]))
                     for c in customers])
    con.executemany("INSERT INTO vendor VALUES (?, ?, ?, ?, ?, ?)",
                    [(v["id"], v["name"], metro[v["metro"]], v["lat"], v["lon"], v["rate"]) for v in vendors])
    con.executemany("INSERT INTO location VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    [(l["id"], l["cust"], l["name"], metro[l["metro"]], l["lat"], l["lon"], l["sqft"], l["hours"],
                      l["freq"], l["price"]) for l in locations])
    con.executemany("INSERT INTO assignment VALUES (?, ?, ?, ?)",
                    [(l["id"], l["vendor"], l["actual_freq"], l["dist"]) for l in locations])
    con.executemany("INSERT INTO service_month VALUES (?, ?, ?, ?, ?, ?, ?)",
                    [(l["id"], MONTH, l["dwell"], l["dups"], l["dup_reason"], l["inspection"], l["issues"])
                     for l in locations])
    con.executemany("INSERT INTO vendor_payment VALUES (?, ?, ?, ?, ?, ?)",
                    [(l["id"], MONTH, l["base"], l["trip"], l["extras"], l["dup_cost"]) for l in locations])
    con.executemany("INSERT INTO customer_credit VALUES (?, ?, ?)",
                    [(l["id"], MONTH, l["credits"]) for l in locations if l["credits"] > 0])
    con.commit()

    byid = {l["id"]: l for l in locations}
    rows = con.execute("SELECT location_id, margin, gap_price, gap_vendor_rate, gap_visits, gap_travel, gap_scope,"
                       " gap_quality, status FROM location_economics").fetchall()
    assert len(rows) == len(locations)
    for loc_id, margin, *gaps, status in rows:
        l = byid[loc_id]
        assert abs(margin - l["margin"]) < 0.01 and status == l["status"]
        assert all(abs(g - l["comp"][d]) < 0.01 for g, d in zip(gaps, DRIVERS))
    con.close()
    print(f"database         {DB.name}: SQL view matches the Python model on all {len(rows)} locations")


def summarize(locations):
    rev = sum(l["price"] - l["credits"] for l in locations)
    cost = sum(l["cost"] for l in locations)
    loss = [l for l in locations if l["status"] == "loss"]
    print(f"locations        {len(locations)}")
    print(f"monthly revenue  ${rev:,.0f}")
    print(f"monthly cost     ${cost:,.0f}")
    print(f"gross margin     {100 * (rev - cost) / rev:.1f}%")
    print(f"loss-making      {len(loss)} ({100 * len(loss) / len(locations):.1f}%), "
          f"bleeding ${-sum(l['margin'] for l in loss):,.0f}/mo")
    print(f"thin (<10% GM)   {sum(1 for l in locations if l['status'] == 'thin')}")
    for d in DRIVERS:
        n = sum(1 for l in loss if l["primary"] == d)
        amt = sum(max(0, l["comp"][d]) for l in loss)
        print(f"  {d:8s} primary on {n:4d} loss sites, ${amt:>9,.0f}/mo of gap")
    print(f"travel sites with a re-cluster option: "
          f"{sum(1 for l in locations if l.get('alt'))} of {sum(1 for l in locations if l['trip'] > 0)}")


if __name__ == "__main__":
    rng = random.Random(SEED)
    customers, vendors, locations = generate(rng)
    result = analyze(customers, vendors, locations)
    export(customers, vendors, locations, result)
    write_database(customers, vendors, locations, result["market"])
    print(f"clusters {len(result['clusters'])}, automation flags {len(result['flags'])}, plays {len(result['plays'])}")
    summarize(locations)
