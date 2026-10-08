-- Margin Lens data model. SQLite dialect; one row per location per month in the fact tables.

CREATE TABLE business_target (
    name   TEXT PRIMARY KEY,
    value  REAL NOT NULL
);

CREATE TABLE metro_benchmark (
    metro               TEXT PRIMARY KEY,
    wage_index          REAL NOT NULL,
    market_hourly_rate  REAL NOT NULL
);

CREATE TABLE customer (
    customer_id          INTEGER PRIMARY KEY,
    name                 TEXT NOT NULL,
    facility_type        TEXT NOT NULL,
    pricing_model        TEXT NOT NULL CHECK (pricing_model IN ('flat', 'local')),
    contract_start_year  INTEGER NOT NULL,
    has_escalator        INTEGER NOT NULL CHECK (has_escalator IN (0, 1))
);

CREATE TABLE vendor (
    vendor_id    INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    metro        TEXT NOT NULL REFERENCES metro_benchmark (metro),
    base_lat     REAL NOT NULL,
    base_lon     REAL NOT NULL,
    hourly_rate  REAL NOT NULL
);

CREATE TABLE location (
    location_id                 INTEGER PRIMARY KEY,
    customer_id                 INTEGER NOT NULL REFERENCES customer (customer_id),
    name                        TEXT NOT NULL,
    metro                       TEXT NOT NULL REFERENCES metro_benchmark (metro),
    lat                         REAL NOT NULL,
    lon                         REAL NOT NULL,
    sqft                        INTEGER NOT NULL,
    scoped_hours_per_visit      REAL NOT NULL,
    contracted_visits_per_week  INTEGER NOT NULL,
    contract_price              REAL NOT NULL
);

CREATE TABLE assignment (
    location_id                INTEGER PRIMARY KEY REFERENCES location (location_id),
    vendor_id                  INTEGER NOT NULL REFERENCES vendor (vendor_id),
    scheduled_visits_per_week  INTEGER NOT NULL,
    miles_from_vendor_base     REAL NOT NULL
);

CREATE TABLE service_month (
    location_id         INTEGER NOT NULL REFERENCES location (location_id),
    month               TEXT NOT NULL,
    time_on_site_ratio  REAL NOT NULL,
    repeat_visits       INTEGER NOT NULL DEFAULT 0,
    repeat_reason       TEXT,
    inspection_score    REAL NOT NULL,
    open_issues         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (location_id, month)
);

CREATE TABLE vendor_payment (
    location_id           INTEGER NOT NULL REFERENCES location (location_id),
    month                 TEXT NOT NULL,
    base_amount           REAL NOT NULL,
    trip_charges          REAL NOT NULL DEFAULT 0,
    extras                REAL NOT NULL DEFAULT 0,
    repeat_visit_charges  REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (location_id, month)
);

CREATE TABLE customer_credit (
    location_id  INTEGER NOT NULL REFERENCES location (location_id),
    month        TEXT NOT NULL,
    amount       REAL NOT NULL,
    PRIMARY KEY (location_id, month)
);

-- Margin per location per month, and the six reasons it differs from the target margin.
CREATE VIEW location_economics AS
WITH facts AS (
    SELECT
        l.location_id,
        sm.month,
        l.contract_price,
        COALESCE(cc.amount, 0)                    AS credits,
        vp.base_amount, vp.trip_charges, vp.extras, vp.repeat_visit_charges,
        v.hourly_rate,
        mb.market_hourly_rate,
        l.scoped_hours_per_visit                  AS hours,
        l.contracted_visits_per_week * wk.value   AS contracted_visits,
        a.scheduled_visits_per_week * wk.value    AS scheduled_visits,
        sm.repeat_visits,
        tm.value                                  AS target_margin,
        th.value                                  AS thin_margin
    FROM location l
    JOIN assignment a        ON a.location_id = l.location_id
    JOIN vendor v            ON v.vendor_id = a.vendor_id
    JOIN metro_benchmark mb  ON mb.metro = l.metro
    JOIN service_month sm    ON sm.location_id = l.location_id
    JOIN vendor_payment vp   ON vp.location_id = l.location_id AND vp.month = sm.month
    LEFT JOIN customer_credit cc ON cc.location_id = l.location_id AND cc.month = sm.month
    JOIN business_target tm  ON tm.name = 'target_gross_margin'
    JOIN business_target th  ON th.name = 'thin_margin'
    JOIN business_target wk  ON wk.name = 'weeks_per_month'
),
priced AS (
    SELECT
        *,
        contract_price - credits                                          AS revenue,
        base_amount + trip_charges + extras + repeat_visit_charges        AS vendor_cost,
        hours * contracted_visits * market_hourly_rate                    AS should_cost
    FROM facts
)
SELECT
    location_id,
    month,
    revenue,
    vendor_cost,
    revenue - vendor_cost                                                 AS margin,
    should_cost,
    should_cost / (1 - target_margin)                                     AS target_price,
    should_cost / (1 - target_margin) - contract_price                    AS gap_price,
    (hourly_rate - market_hourly_rate) * hours * contracted_visits        AS gap_vendor_rate,
    hourly_rate * hours * (scheduled_visits - contracted_visits + repeat_visits) AS gap_visits,
    trip_charges                                                          AS gap_travel,
    extras                                                                AS gap_scope,
    credits                                                               AS gap_quality,
    CASE
        WHEN revenue - vendor_cost < 0 THEN 'loss'
        WHEN (revenue - vendor_cost) / contract_price < thin_margin THEN 'thin'
        ELSE 'ok'
    END                                                                   AS status
FROM priced;
