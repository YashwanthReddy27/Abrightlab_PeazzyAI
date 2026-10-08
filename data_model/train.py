"""Trains the loss-risk model and scores the portfolio. Run: .venv/Scripts/python data_model/train.py [--score-only]"""
import json
import random
import sys
from datetime import date
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from build import SEED
from model import WEEKS_PER_MONTH, analyze
from synthetic import FACILITY_TYPES, METROS, N_LOCATIONS, THIS_YEAR, generate

HERE = Path(__file__).resolve().parent
MODELS = HERE / "models"
RISK_JS = HERE.parent / "app" / "risk.js"
TRAIN_SEED = 11
TRAIN_ROWS = 5000
MAX_AUC_DROP = 0.01

# Only facts known when a site is priced and a vendor is assigned, so the model can screen a deal before it is signed.
FEATURES = [
    "Price per hour of work", "Vendor rate vs. local market", "Miles from vendor base", "Local wage level",
    "Vendor's average inspection score", "Nearby sites on the same vendor", "Contract age in years",
    "Flat national pricing", "Has a yearly price increase", "Site size", "Visits per week", "Hours per visit",
] + [f"Facility type: {t[0]}" for t in FACILITY_TYPES]


def load_rows(seed, n):
    """Feature rows and loss labels. Swap the generator for a query on location_economics when real data arrives."""
    customers, vendors, locations = generate(random.Random(seed), n)
    cards = analyze(customers, vendors, locations)["scorecards"]
    cust = {c["id"]: c for c in customers}
    rows, labels, ids = [], [], []
    for l in locations:
        c = cust[l["cust"]]
        rows.append([
            l["price"] / (l["hours"] * l["freq"] * WEEKS_PER_MONTH), l["rate"] / l["market"] - 1, l["dist"],
            METROS[l["metro"]][3], cards[l["vendor"]]["insp"], l["density"], THIS_YEAR - c["start"],
            int(c["pricing"] == "flat"), int(c["escalator"]), l["sqft"], l["freq"], l["hours"],
        ] + [int(c["type"] == t) for t in range(len(FACILITY_TYPES))])
        labels.append(int(l["status"] == "loss"))
        ids.append(l["id"])
    return np.array(rows, dtype=float), np.array(labels), ids


def evaluate(model, X, y):
    p = model.predict_proba(X)[:, 1]
    return {"auc": round(roc_auc_score(y, p), 4), "precision": round(precision_score(y, p >= 0.5), 4),
            "recall": round(recall_score(y, p >= 0.5), 4), "brier": round(brier_score_loss(y, p), 4)}


def main():
    X, y, _ = load_rows(TRAIN_SEED, TRAIN_ROWS)
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, stratify=y, random_state=0)

    baseline = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000)).fit(X_train, y_train)
    model = GradientBoostingClassifier(random_state=0).fit(X_train, y_train)
    metrics = {"trained": date.today().isoformat(), "rows": len(y), "loss_rate": round(float(y.mean()), 4),
               "model": evaluate(model, X_test, y_test), "baseline": evaluate(baseline, X_test, y_test)}

    importance = permutation_importance(model, X_test, y_test, scoring="roc_auc", n_repeats=5, random_state=0)
    ranked = sorted(zip(FEATURES, importance.importances_mean), key=lambda t: -t[1])
    metrics["importance"] = [[name, round(float(v), 4)] for name, v in ranked if v > 0.0005]

    # Promotion gate: a retrained model replaces the current one only if it is not clearly worse.
    MODELS.mkdir(exist_ok=True)
    current = MODELS / "metrics.json"
    previous = json.loads(current.read_text())["model"]["auc"] if current.exists() else 0.0
    promoted = metrics["model"]["auc"] >= previous - MAX_AUC_DROP
    print(f"model AUC {metrics['model']['auc']}  baseline AUC {metrics['baseline']['auc']}  previous {previous}")
    if not promoted:
        print("not promoted: keeping the current model")
        return
    joblib.dump(model, MODELS / "loss_risk.joblib")
    current.write_text(json.dumps(metrics, indent=2))
    print("promoted")
    score()


def score():
    """Scores the current portfolio with the saved model, without retraining."""
    model = joblib.load(MODELS / "loss_risk.joblib")
    metrics = json.loads((MODELS / "metrics.json").read_text())
    X, y, ids = load_rows(SEED, N_LOCATIONS)
    risk = model.predict_proba(X)[:, 1]
    metrics["live_auc"] = round(roc_auc_score(y, risk), 4)
    out = {"metrics": metrics, "risk": {str(i): round(float(p), 3) for i, p in zip(ids, risk)}}
    RISK_JS.write_text("window.RISK = " + json.dumps(out, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"scored {len(ids)} locations (AUC on them {metrics['live_auc']}) -> {RISK_JS.name}")


if __name__ == "__main__":
    score() if "--score-only" in sys.argv else main()
