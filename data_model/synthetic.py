"""Synthetic stand-in for a Peazy + finance export. Planted loss causes are not exported."""
import math

from model import DUP_REASONS, WEEKS_PER_MONTH, miles, trip_charge

N_LOCATIONS = 2000
N_METROS = 44
ACCOUNTS_PER_TYPE = 8
THIS_YEAR = 2026

# name, lat, lon, wage index (1.0 = national average), relative share of sites
METROS = [
    ("New York", 40.71, -74.01, 1.32, 9), ("Los Angeles", 34.05, -118.24, 1.25, 8),
    ("Chicago", 41.88, -87.63, 1.12, 7), ("Dallas", 32.78, -96.80, 1.00, 7),
    ("Houston", 29.76, -95.37, 0.98, 6), ("Atlanta", 33.75, -84.39, 0.98, 6),
    ("Phoenix", 33.45, -112.07, 1.00, 5), ("Philadelphia", 39.95, -75.17, 1.10, 5),
    ("Miami", 25.76, -80.19, 1.02, 5), ("Seattle", 47.61, -122.33, 1.30, 4),
    ("Denver", 39.74, -104.99, 1.12, 4), ("Boston", 42.36, -71.06, 1.28, 4),
    ("SF Bay Area", 37.77, -122.42, 1.42, 4), ("Washington DC", 38.91, -77.04, 1.20, 4),
    ("Minneapolis", 44.98, -93.27, 1.10, 3), ("Detroit", 42.33, -83.05, 1.00, 3),
    ("Tampa", 27.95, -82.46, 0.95, 3), ("Orlando", 28.54, -81.38, 0.95, 3),
    ("Charlotte", 35.23, -80.84, 0.95, 3), ("St. Louis", 38.63, -90.20, 0.95, 3),
    ("Nashville", 36.16, -86.78, 0.96, 3), ("San Antonio", 29.42, -98.49, 0.90, 3),
    ("Austin", 30.27, -97.74, 1.00, 3), ("San Diego", 32.72, -117.16, 1.20, 3),
    ("Kansas City", 39.10, -94.58, 0.95, 2), ("Columbus", 39.96, -83.00, 0.96, 2),
    ("Indianapolis", 39.77, -86.16, 0.94, 2), ("Las Vegas", 36.17, -115.14, 1.00, 2),
    ("Portland", 45.52, -122.68, 1.18, 2), ("Salt Lake City", 40.76, -111.89, 0.98, 2),
    ("Sacramento", 38.58, -121.49, 1.18, 2), ("Cleveland", 41.50, -81.69, 0.95, 2),
    ("Pittsburgh", 40.44, -80.00, 0.95, 2), ("Cincinnati", 39.10, -84.51, 0.94, 2),
    ("Raleigh", 35.78, -78.64, 0.96, 2), ("Oklahoma City", 35.47, -97.52, 0.88, 2),
    ("Memphis", 35.15, -90.05, 0.88, 2), ("New Orleans", 29.95, -90.07, 0.90, 2),
    ("Louisville", 38.25, -85.76, 0.92, 2), ("Jacksonville", 30.33, -81.66, 0.93, 2),
    ("Albuquerque", 35.08, -106.65, 0.90, 1), ("Omaha", 41.26, -95.93, 0.92, 1),
    ("Boise", 43.62, -116.20, 0.95, 1), ("Birmingham", 33.52, -86.80, 0.88, 1),
]

# name, sqft range, cleaning productivity (sqft per labor hour), contracted visits/week options
FACILITY_TYPES = [
    ("Bank branch", 2500, 6000, 2800, [2, 3, 3, 5]),
    ("Retail store", 4000, 20000, 4500, [3, 5, 5, 7]),
    ("Medical clinic", 3000, 12000, 2200, [5, 5, 6]),
    ("Office", 5000, 40000, 3800, [3, 5, 5]),
    ("Fitness studio", 3000, 15000, 2600, [5, 7, 7]),
    ("Auto dealership", 10000, 35000, 4200, [5, 6]),
]

# All customer and vendor names are invented.
CUSTOMER_NAMES = {
    0: ["Harbor Federal", "Cedar Point Credit Union", "First Meridian Bank", "Union Prairie Bank",
        "Summit Trust", "Bluewater Savings", "Keystone Community Bank", "Ironwood Financial"],
    1: ["Marlow & Finch", "Brightcart", "Tandem Outfitters", "Oak & Anchor Home",
        "Pennywise Dollar", "Lumen Mobile", "Fieldstone Pets", "Corner Pantry"],
    2: ["Evergreen Urgent Care", "ClearView Dental", "Northstar Dialysis", "Willow Pediatrics",
        "Apex Physical Therapy", "Meridian Eye", "Tallgrass Clinics", "Sunrise Dermatology"],
    3: ["Atlas Coworking", "Vantage Insurance", "Pioneer Title", "Crestline Staffing",
        "Beacon Tax", "Halcyon Realty", "Stratus Logistics", "Granite Engineering"],
    4: ["Pulse Fitness", "Ironside Gyms", "Flow Yoga Collective", "Peak Cycle",
        "Kinetic Club", "Forge Athletics"],
    5: ["DriveLine Auto Group", "Summit Motors", "Coastal Collision", "Redline Tire & Service"],
}
VENDOR_A = ["Sparkle", "Pristine", "Allied", "Metro", "ProClean", "Liberty", "Coastal", "Evergreen",
            "Diamond", "Reliable", "Ace", "Premier", "Unity", "TruShine", "Northside", "Capital"]
VENDOR_B = ["Janitorial", "Building Services", "Cleaning Co.", "Maintenance", "Facility Care"]


def offset(lat, lon, dist_mi, rng):
    """Point dist_mi away from (lat, lon) in a random direction."""
    theta = rng.uniform(0, 2 * math.pi)
    return (lat + dist_mi * math.sin(theta) / 69.0,
            lon + dist_mi * math.cos(theta) / (69.0 * math.cos(math.radians(lat))))


def generate(rng, n=N_LOCATIONS):
    customers = []
    for t, names in CUSTOMER_NAMES.items():
        for name in names[:ACCOUNTS_PER_TYPE]:
            customers.append({
                "id": len(customers), "name": name, "type": t,
                "pricing": "flat" if rng.random() < 0.35 else "local",
                "escalator": rng.random() < 0.55,
                "start": rng.choice([2019, 2021, 2022, 2023, 2023, 2024, 2024, 2025]),
                "weight": rng.uniform(0.4, 2.5),
            })

    vendors = []
    for m, (mname, mlat, mlon, idx, w) in enumerate(METROS[:N_METROS]):
        for _ in range(max(3, round(w * 1.6))):
            lat, lon = offset(mlat, mlon, abs(rng.gauss(0, 10)), rng)
            premium = rng.lognormvariate(0, 0.06)
            if rng.random() < 0.10:                      # planted: expensive vendor
                premium = rng.uniform(1.18, 1.40)
            quality = rng.gauss(89, 4)
            if rng.random() < 0.12:                      # planted: poor performer
                quality = rng.gauss(72, 4)
            vendors.append({
                "id": len(vendors), "metro": m, "lat": lat, "lon": lon,
                "name": f"{rng.choice(VENDOR_A)} {rng.choice(VENDOR_B)} ({mname})",
                "rate": 27.5 * idx * premium,            # $ per labor hour on the vendor rate card
                "quality": max(55, min(99, quality)),
            })
    by_metro = {}
    for v in vendors:
        by_metro.setdefault(v["metro"], []).append(v)

    metro_weights = [m[4] for m in METROS[:N_METROS]]
    cust_weights = [c["weight"] for c in customers]
    counters = {}
    locations = []
    for i in range(n):
        m = rng.choices(range(N_METROS), metro_weights)[0]
        mname, mlat, mlon, idx, _ = METROS[m]
        remote = rng.random() < 0.10                     # planted: isolated site
        d = rng.uniform(40, 130) if remote else abs(rng.gauss(0, 13))
        lat, lon = offset(mlat, mlon, d, rng)

        c = rng.choices(customers, cust_weights)[0]
        _, lo, hi, prod, freqs = FACILITY_TYPES[c["type"]]
        sqft = round(rng.uniform(lo, hi), -2)
        freq = rng.choice(freqs)
        hours = max(1.0, sqft / prod)                    # scoped labor hours per visit

        # vendor assignment: mostly proximity-driven, some legacy/arbitrary
        pool = by_metro[m]
        if rng.random() < 0.85:
            w = [1 / (miles(lat, lon, v["lat"], v["lon"]) + 4) ** 2 for v in pool]
            v = rng.choices(pool, w)[0]
        else:
            v = rng.choice(pool)
        dist = miles(lat, lon, v["lat"], v["lon"])

        # customer price
        fair_cost = hours * freq * WEEKS_PER_MONTH * 27.5 * idx
        age = THIS_YEAR - c["start"]
        if c["pricing"] == "flat":
            # one national rate card for the whole account: sized to the site, blind to the metro
            price = hours * freq * WEEKS_PER_MONTH * 27.5 * 1.03 / (1 - 0.29)
        else:
            price = fair_cost / (1 - rng.gauss(0.29, 0.05))
        # wages grew ~3%/yr; an escalator recovers 2%, no escalator recovers nothing
        price *= (0.99 if c["escalator"] else 1 / 1.03) ** age
        price *= rng.lognormvariate(0, 0.04)

        # operations
        actual_freq = freq
        if rng.random() < 0.07 and freq < 7:             # planted: schedule drifted past contract
            actual_freq = min(7, freq + rng.choice([1, 1, 2]))
        visits = actual_freq * WEEKS_PER_MONTH
        base = v["rate"] * hours * visits

        dwell = max(0.6, rng.gauss(1.0, 0.07))           # geofence time on site / scoped time
        extras = 0.0
        if rng.random() < 0.06:                          # planted: scope creep
            dwell = rng.uniform(1.3, 1.8)
            extras = (dwell - 1) * 0.8 * base
        elif rng.random() < 0.06:                        # planted: crews leave early
            dwell = rng.uniform(0.55, 0.80)

        dups, dup_reason = 0, None
        if rng.random() < 0.05:                          # planted: same-day repeat visits
            dups = rng.choice([1, 1, 2, 3, 4])
            dup_reason = rng.choice(DUP_REASONS)

        inspection = max(50, min(100, rng.gauss(v["quality"], 4)))
        issues = max(0, round(rng.gauss((92 - inspection) / 4, 1.2)))
        credits = price * rng.uniform(0.10, 0.28) if inspection < 78 else 0.0

        counters[(c["id"], m)] = counters.get((c["id"], m), 0) + 1
        locations.append({
            "id": i, "name": f"{c['name']} - {mname} #{counters[(c['id'], m)]}",
            "cust": c["id"], "metro": m, "lat": lat, "lon": lon, "sqft": sqft,
            "freq": freq, "actual_freq": actual_freq, "hours": hours,
            "price": price, "credits": credits,
            "vendor": v["id"], "rate": v["rate"], "dist": dist,
            "trip": trip_charge(dist, visits, base), "extras": extras,
            "dwell": dwell, "inspection": inspection, "issues": issues,
            "dups": dups, "dup_reason": dup_reason,
        })
    return customers, vendors, locations
