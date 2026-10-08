"""Analytical model: should-cost, target price, six-driver margin decomposition, re-clustering."""
import math
import statistics

TARGET_GM = 0.25
WEEKS_PER_MONTH = 4.33
DRIVERS = ["price", "rate", "freq", "travel", "scope", "quality"]
DUP_REASONS = ["customer_request", "emergency", "failed_inspection", "schedule_error"]
WAGE_GROWTH = 0.03
ESCALATOR = 0.02
CLUSTER_RADIUS_MI = 6
CLUSTER_MIN_SITES = 4
CLUSTER_MAX_SITES = 20


def miles(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 3958.8 * 2 * math.asin(math.sqrt(a))


def trip_charge(dist_mi, visits, base_cost):
    """What a vendor adds for driving out to a site beyond its normal service radius."""
    if dist_mi <= 25:
        return 0.0
    return min(visits * min(55.0, 0.7 * (dist_mi - 25)), 0.5 * base_cost)


def analyze(customers, vendors, locations):
    """Only uses fields Peazy + the contract/AP systems would expose."""
    by_metro = {}
    for l in locations:
        by_metro.setdefault(l["metro"], []).append(l)

    # market rate = what the median assignment in that metro actually pays per labor hour
    market = {m: statistics.median(l["rate"] for l in ls) for m, ls in by_metro.items()}
    vend = {v["id"]: v for v in vendors}
    vq = {}
    for l in locations:
        vq.setdefault(l["vendor"], []).append(l["inspection"])
    vq = {k: statistics.mean(x) for k, x in vq.items()}

    for l in locations:
        mkt = market[l["metro"]]
        cv = l["freq"] * WEEKS_PER_MONTH
        av = l["actual_freq"] * WEEKS_PER_MONTH
        base = l["rate"] * l["hours"] * av
        dup_cost = l["rate"] * l["hours"] * l["dups"]
        cost = base + l["trip"] + l["extras"] + dup_cost
        margin = l["price"] - l["credits"] - cost
        should = l["hours"] * cv * mkt
        target_price = should / (1 - TARGET_GM)

        # (target margin - actual margin) == sum of these six, exactly
        comp = {
            "price": target_price - l["price"],
            "rate": (l["rate"] - mkt) * l["hours"] * cv,
            "freq": l["rate"] * l["hours"] * (av - cv) + dup_cost,
            "travel": l["trip"],
            "scope": l["extras"],
            "quality": l["credits"],
        }
        assert abs((target_price - should - margin) - sum(comp.values())) < 1e-6

        l.update(base=base, cost=cost, dup_cost=dup_cost, margin=margin, should=should,
                 target_price=target_price, market=mkt, comp=comp,
                 gm=margin / l["price"])
        l["status"] = "loss" if margin < 0 else ("thin" if l["gm"] < 0.10 else "ok")
        l["primary"] = max(DRIVERS, key=lambda d: comp[d]) if l["status"] != "ok" else None

    # route density + re-clustering candidates
    for m, ls in by_metro.items():
        for l in ls:
            near = [(o, miles(l["lat"], l["lon"], o["lat"], o["lon"])) for o in ls if o is not l]
            l["density"] = sum(1 for o, d in near if d <= 10 and o["vendor"] == l["vendor"])
            l["alt"] = None
            if l["trip"] <= 0:
                continue
            best = None
            counts = {}
            for o, d in near:
                if d <= 12:
                    counts[o["vendor"]] = counts.get(o["vendor"], 0) + 1
            for vid, n in counts.items():
                v = vend[vid]
                if vid == l["vendor"] or n < 2 or vq[vid] < 82 or v["rate"] > 1.08 * l["market"]:
                    continue
                d = miles(l["lat"], l["lon"], v["lat"], v["lon"])
                new_base = v["rate"] * l["hours"] * l["actual_freq"] * WEEKS_PER_MONTH
                new_trip = trip_charge(d, l["actual_freq"] * WEEKS_PER_MONTH, new_base)
                saving = (l["base"] + l["trip"]) - (new_base + new_trip)
                if saving > 0 and (best is None or saving > best["saving"]):
                    best = {"v": vid, "n": n, "d": round(d, 1), "saving": round(saving)}
            l["alt"] = best
            if best is None:   # no ready-made cluster: are there orphans nearby to bundle into one?
                l["orphans"] = sum(1 for o, d in near if d <= 15 and o["trip"] > 0)
    benchmark_peers(customers, locations)
    forecast_tipping(customers, locations)
    cards = score_vendors(vendors, locations, market)
    clusters = build_clusters(by_metro, vend, vq)
    flags = build_flags(locations)
    return {"market": market, "scorecards": cards, "clusters": clusters, "flags": flags,
            "plays": recommend(customers, vendors, locations, cards, clusters, flags)}


def peer_metrics(l):
    scoped = l["hours"] * l["freq"] * WEEKS_PER_MONTH
    return [l["price"] / scoped, l["cost"] / scoped, l["dist"], l["dwell"], l["inspection"],
            l["sqft"] / (l["hours"] * l["dwell"])]


def benchmark_peers(customers, locations):
    """Compares each site with profitable sites of the same facility type, same metro where possible."""
    ctype = {c["id"]: c["type"] for c in customers}
    local, national = {}, {}
    for l in locations:
        if l["status"] == "ok":
            local.setdefault((ctype[l["cust"]], l["metro"]), []).append(peer_metrics(l))
            national.setdefault(ctype[l["cust"]], []).append(peer_metrics(l))
    for l in locations:
        peers = local.get((ctype[l["cust"]], l["metro"]), [])
        scope = "metro"
        if len(peers) < 5:
            peers, scope = national[ctype[l["cust"]]], "national"
        l["bench"] = {"own": peer_metrics(l), "peer": [statistics.median(c) for c in zip(*peers)],
                      "n": len(peers), "scope": scope}


def forecast_tipping(customers, locations, horizon=36):
    """Months until a profitable site goes negative if wages keep rising and the contract does not keep up."""
    cust = {c["id"]: c for c in customers}
    for l in locations:
        l["tip"] = None
        if l["status"] == "loss":
            continue
        step = ESCALATOR if cust[l["cust"]]["escalator"] else 0.0
        for month in range(1, horizon + 1):
            years = month / 12
            if l["price"] * (1 + step) ** years - l["credits"] - l["cost"] * (1 + WAGE_GROWTH) ** years < 0:
                l["tip"] = month
                break


def score_vendors(vendors, locations, market):
    """0-100 scorecard: quality 40%, cost vs market 25%, time-on-site compliance 20%, route density 15%."""
    def clamp(x):
        return max(0.0, min(1.0, x))
    sites = {}
    for l in locations:
        sites.setdefault(l["vendor"], []).append(l)
    cards = {}
    for v in vendors:
        ls = sites.get(v["id"])
        if not ls:
            continue
        insp = statistics.mean(l["inspection"] for l in ls)
        dwell = statistics.mean(l["dwell"] for l in ls)
        density = statistics.mean(l["density"] for l in ls)
        premium = v["rate"] / market[v["metro"]] - 1
        score = 100 * (0.40 * clamp((insp - 70) / 25) + 0.25 * clamp(1 - premium / 0.30)
                       + 0.20 * clamp(1 - abs(dwell - 1) / 0.40) + 0.15 * clamp(density / 4))
        cards[v["id"]] = {"score": round(score), "tier": "A" if score >= 80 else "B" if score >= 60 else "C",
                          "insp": round(insp), "dwell": round(dwell, 2), "density": round(density, 1),
                          "premium": round(premium, 3)}
    return cards


def build_clusters(by_metro, vend, vq):
    """Greedy geographic clusters, each priced as one route for a single lead vendor."""
    clusters = []
    for m, ls in by_metro.items():
        near = {a["id"]: {b["id"] for b in ls if miles(a["lat"], a["lon"], b["lat"], b["lon"]) <= CLUSTER_RADIUS_MI}
                for a in ls}
        byid = {l["id"]: l for l in ls}
        free = set(byid)
        for l in ls:
            l["cluster"] = None
        while free:
            seed = max(free, key=lambda i: (len(near[i] & free), -i))
            s = byid[seed]
            ids = set(sorted(near[seed] & free, key=lambda i: miles(s["lat"], s["lon"], byid[i]["lat"], byid[i]["lon"]))[:CLUSTER_MAX_SITES])
            free -= ids
            if len(ids) < CLUSTER_MIN_SITES:
                continue
            members = [byid[i] for i in sorted(ids)]
            counts = {}
            for l in members:
                counts[l["vendor"]] = counts.get(l["vendor"], 0) + 1
            fit = [v for v in counts if vq[v] >= 82 and vend[v]["rate"] <= 1.08 * members[0]["market"]]
            lead = max(fit, key=lambda v: (counts[v], -vend[v]["rate"])) if fit else None
            moves = []
            if lead is not None:
                lv = vend[lead]
                for l in members:
                    if l["vendor"] == lead:
                        continue
                    visits = l["actual_freq"] * WEEKS_PER_MONTH
                    new_base = lv["rate"] * l["hours"] * visits
                    new_cost = new_base + trip_charge(miles(l["lat"], l["lon"], lv["lat"], lv["lon"]), visits, new_base)
                    if l["base"] + l["trip"] > new_cost:
                        moves.append((l["id"], l["base"] + l["trip"] - new_cost))
            lat = statistics.mean(l["lat"] for l in members)
            lon = statistics.mean(l["lon"] for l in members)
            start = (vend[lead]["lat"], vend[lead]["lon"]) if lead is not None else (lat, lon)
            cid = len(clusters)
            for l in members:
                l["cluster"] = cid
            clusters.append({
                "id": cid, "metro": m, "lat": round(lat, 3), "lon": round(lon, 3), "n": len(members),
                "vendors": len(counts), "lead": lead, "leadSites": counts.get(lead, 0), "moved": len(moves), "moves": moves,
                "saving": round(sum(amt for _, amt in moves)), "route": round(route_miles(start, members)),
                "margin": round(sum(l["margin"] for l in members)),
                "trip": round(sum(l["trip"] for l in members)),
                "cost": round(sum(l["cost"] for l in members)),
                "should": round(sum(l["should"] for l in members)),
                "loss": sum(1 for l in members if l["status"] == "loss"),
            })
    return clusters


def route_miles(start, members):
    """Nearest-neighbour tour length from the vendor base through every site in the cluster."""
    lat, lon = start
    left, total = list(members), 0.0
    while left:
        nxt = min(left, key=lambda l: miles(lat, lon, l["lat"], l["lon"]))
        total += miles(lat, lon, nxt["lat"], nxt["lon"])
        lat, lon = nxt["lat"], nxt["lon"]
        left.remove(nxt)
    return total


DUP_FLAG = {"customer_request": "dup_bill", "emergency": "dup_bill",
            "failed_inspection": "dup_vendor", "schedule_error": "dup_schedule"}


def build_flags(locations):
    """Exceptions an automation would act on without waiting for someone to notice."""
    flags = []
    for l in locations:
        found = []
        if l["dups"]:
            found.append((DUP_FLAG[l["dup_reason"]], l["dup_cost"]))
        if l["actual_freq"] > l["freq"]:
            found.append(("over_schedule", l["comp"]["freq"] - l["dup_cost"]))
        if l["extras"] > 0 and l["dwell"] > 1.25:
            found.append(("over_scope", l["extras"]))
        if l["dwell"] < 0.80:
            found.append(("short_visit", l["base"] * (1 - l["dwell"])))
        if l["inspection"] < 78:
            found.append(("low_quality", l["credits"]))
        if l["tip"] is not None and l["tip"] <= 12:
            found.append(("tip_forecast", l["margin"]))
        if l["trip"] > 0 and l["alt"] is None and l["cluster"] is None:
            found.append(("remote", l["trip"]))
        flags += [{"loc": l["id"], "type": kind, "amt": round(amt)} for kind, amt in found]
    return flags


CAPTURE = {"route": 0.6, "index_price": 0.4, "reprice": 0.4, "rebid": 0.5, "performance": 0.5,
           "dup_bill": 0.8, "dup_vendor": 0.8, "dup_schedule": 0.9, "over_schedule": 0.7,
           "over_scope": 0.6, "short_visit": 0.5, "tip_forecast": 0.5, "remote": 0.4}
EFFORT = {"route": 2, "index_price": 3, "reprice": 3, "rebid": 2, "performance": 2,
          "dup_bill": 1, "dup_vendor": 1, "dup_schedule": 1, "over_schedule": 1,
          "over_scope": 2, "short_visit": 2, "tip_forecast": 2, "remote": 3}
DRIVER_OF = {"route": "travel", "remote": "travel", "index_price": "price", "reprice": "price",
             "tip_forecast": "price", "rebid": "rate", "short_visit": "rate", "performance": "quality",
             "dup_bill": "freq", "dup_vendor": "freq", "dup_schedule": "freq", "over_schedule": "freq",
             "over_scope": "scope"}


def recommend(customers, vendors, locations, cards, clusters, flags):
    """Ranked plays. Expected value = money at stake x capture rate, ranked by value per unit of effort."""
    status = {l["id"]: l["status"] for l in locations}
    plays = []

    def add(kind, pairs, **ref):
        pairs = [(i, amt) for i, amt in pairs if amt > 0]
        if not pairs:
            return
        gap = sum(amt for _, amt in pairs)
        at_risk = sum(amt for i, amt in pairs if status[i] != "ok")
        plays.append({"type": kind, "driver": DRIVER_OF[kind], "gap": round(gap), "sites": len(pairs),
                      "capture": CAPTURE[kind], "effort": EFFORT[kind], "value": round(gap * CAPTURE[kind]),
                      "riskShare": round(at_risk / gap, 3), **ref})

    for c in clusters:
        moves = c.pop("moves")
        if len(moves) >= 2:
            add("route", moves, cluster=c["id"])
    for c in customers:
        add("index_price" if c["pricing"] == "flat" else "reprice",
            [(l["id"], l["comp"]["price"]) for l in locations if l["cust"] == c["id"] and l["status"] != "ok"],
            cust=c["id"])
    for v in vendors:
        card = cards.get(v["id"])
        if not card:
            continue
        mine = [l for l in locations if l["vendor"] == v["id"]]
        if card["premium"] > 0.10:
            add("rebid", [(l["id"], l["comp"]["rate"]) for l in mine], vendor=v["id"])
        if card["tier"] == "C":
            add("performance", [(l["id"], l["credits"]) for l in mine], vendor=v["id"])
    for kind in CAPTURE:
        add(kind, [(f["loc"], abs(f["amt"])) for f in flags if f["type"] == kind], flag=kind)

    plays.sort(key=lambda p: -p["value"] / p["effort"])
    for i, p in enumerate(plays):
        p["id"] = i
    return plays
