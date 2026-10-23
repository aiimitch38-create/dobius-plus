"""Offline-only evaluation. Never loads models, sends requests, or runs actions."""
import argparse
import json
import math
from pathlib import Path
from decision_corpus import LABELS, baseline, corpus, digest, request
from decision_metrics import summarize

SOURCE_REVISION = "3cf26cbcb18725dbc2d127bb8bb2c4c43243ae63"
THRESHOLDS = {surface: .90 for surface in LABELS}


def validate_corpus(dataset, split="heldout"):
    if not isinstance(dataset, dict) or dataset.get("schema") != "dobius-laya-corpus/v1":
        raise ValueError("unsupported corpus schema")
    if split not in ["tuning", "heldout"]:
        raise ValueError("split must be tuning or heldout")
    all_fixtures = dataset.get("fixtures")
    if not isinstance(all_fixtures, list):
        raise ValueError("corpus fixtures must be an array")
    ids = []
    for row in all_fixtures:
        if (
            not isinstance(row, dict)
            or not isinstance(row.get("id"), str)
            or not row["id"].strip()
        ):
            raise ValueError("every fixture needs a nonempty string ID")
        if row.get("split") not in ["tuning", "heldout"]:
            raise ValueError("fixture split must be tuning or heldout")
        surface = row.get("surface")
        if (
            not isinstance(surface, str)
            or surface not in LABELS
            or row.get("expected") not in LABELS[surface]
        ):
            raise ValueError("fixture surface or expected label is invalid")
        state = row.get("state")
        if (
            not isinstance(state, dict)
            or not isinstance(state.get("text"), str)
            or not isinstance(state.get("facts"), dict)
        ):
            raise ValueError("fixture state needs text and facts objects")
        if not isinstance(row.get("critical"), bool):
            raise ValueError("fixture critical flag must be boolean")
        ids.append(row["id"])
    if len(ids) != len(set(ids)):
        raise ValueError("fixture IDs must be unique across all splits")
    fixtures = [row for row in all_fixtures if row["split"] == split]
    if not fixtures:
        raise ValueError("empty evaluation split")
    if {row["surface"] for row in fixtures} != set(LABELS):
        raise ValueError("evaluation split must cover every decision surface")
    return fixtures


def number(value, minimum=0, maximum=None):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < minimum or (maximum is not None and value > maximum):
        raise ValueError("expected a finite number within bounds")
    return value


def evaluate(payload, dataset=None, split="heldout"):
    dataset = corpus() if dataset is None else dataset
    fixtures = validate_corpus(dataset, split)
    baseline_rows = [{"id": row["id"], "decision": baseline(row)} for row in fixtures]
    report = {"schema": "dobius-laya-evaluation/v1", "corpus_sha256": digest(dataset),
              "split": split, "thresholds": THRESHOLDS,
              "baseline": summarize(fixtures, baseline_rows), "laya": None,
              "promotion": "blocked", "reasons": ["Synthetic smoke corpus is not deployment acceptance; independent labels and representative heldout data required."]}
    if payload is None:
        report["reasons"].append("No real Laya inference supplied; accuracy/latency/memory unavailable.")
        return report
    if not isinstance(payload, dict) or payload.get("schema") != "dobius-laya-predictions/v1" or payload.get("corpus_sha256") != digest(dataset):
        raise ValueError("prediction schema/corpus identity mismatch")
    provenance = payload.get("provenance", {})
    if not isinstance(provenance, dict) or provenance.get("source_revision") != SOURCE_REVISION or provenance.get("kind") != "real-inference":
        raise ValueError("real-inference provenance and exact fork revision required")
    for key in ["checkpoint_revision", "dependency_lock_sha256", "runtime", "device", "host", "measured_at"]:
        if not isinstance(provenance.get(key), str) or not provenance[key].strip():
            raise ValueError(f"missing provenance {key}")
    if len(provenance["checkpoint_revision"]) != 40 or any(c not in "0123456789abcdef" for c in provenance["checkpoint_revision"]):
        raise ValueError("checkpoint revision must be immutable 40-character hex")
    if len(provenance["dependency_lock_sha256"]) != 64 or any(c not in "0123456789abcdef" for c in provenance["dependency_lock_sha256"]):
        raise ValueError("dependency lock requires SHA256")
    predictions = payload.get("decisions", [])
    if not isinstance(predictions, list) or any(not isinstance(row, dict) for row in predictions):
        raise ValueError("decisions must be an object array")
    if len(predictions) != len(fixtures) or len({d.get("id") for d in predictions}) != len(predictions):
        raise ValueError("predictions must cover every split fixture exactly once")
    by_id = {row["id"]: row for row in fixtures}
    normalized = []
    for answer in predictions:
        fixture = by_id.get(answer.get("id"))
        if fixture is None or answer.get("request_sha256") != digest(request(fixture)):
            raise ValueError("unknown fixture or mismatched request identity")
        labels = LABELS[fixture["surface"]]
        probabilities = answer.get("probabilities")
        if not isinstance(probabilities, dict) or set(probabilities) != set(labels):
            raise ValueError("probabilities must cover exact surface label set")
        for p in probabilities.values():
            number(p, 0, 1)
        if abs(sum(probabilities.values()) - 1) > 1e-6:
            raise ValueError("probabilities must sum to one")
        label = answer.get("decision")
        if label is not None and label not in labels:
            raise ValueError("invalid decision label")
        if not isinstance(answer.get("truncated"), bool):
            raise ValueError("visible truncation flag required")
        number(answer.get("latency_ms"))
        number(answer.get("backend_peak_rss_bytes"), 1)
        top = max(probabilities, key=probabilities.get)
        if label is not None and label != top:
            raise ValueError("decision must match top probability or abstain")
        # Truncated evidence is never silently treated as a complete decision window.
        accepted = label if label is not None and probabilities[label] >= THRESHOLDS[fixture["surface"]] and not answer["truncated"] else None
        normalized.append({**answer, "decision": accepted})
    report["laya"] = summarize(fixtures, normalized)
    report["provenance"] = provenance
    report["case_review"] = [{"id": row["id"], "decision": row["decision"],
                              "raw_decision": next(d["decision"] for d in predictions if d["id"] == row["id"]),
                              "request_sha256": row["request_sha256"], "truncated": row["truncated"]} for row in normalized]
    report["reasons"].extend(["Thresholds are provisional, not approved production policy.", "Two-adapter, authentication, outage, capacity and live Metro health gates remain pending."])
    report["comparison"] = {surface: {"accuracy_delta": report["laya"][surface]["accuracy_all"] - report["baseline"][surface]["accuracy_all"]} for surface in LABELS}
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--predictions", type=Path)
    parser.add_argument("--corpus", type=Path)
    parser.add_argument("--split", choices=["tuning", "heldout"], default="heldout")
    parser.add_argument("--export-requests", action="store_true")
    args = parser.parse_args()
    try:
        def load(path):
            if path.stat().st_size > 8 * 1024 * 1024:
                raise ValueError("input exceeds bounded 8 MiB evaluation file limit")
            return json.loads(path.read_text())
        dataset = load(args.corpus) if args.corpus else corpus()
        if args.export_requests:
            fixtures = validate_corpus(dataset, args.split)
            # Expected labels and other split data never go to inference requests.
            for row in fixtures:
                body = request(row)
                print(json.dumps({"id": row["id"], "request_sha256": digest(body), "body": body}))
        else:
            payload = load(args.predictions) if args.predictions else None
            print(json.dumps(evaluate(payload, dataset, args.split), indent=2, allow_nan=False))
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.exit(2, f"evaluation refused: {error}\n")


if __name__ == "__main__":
    main()
