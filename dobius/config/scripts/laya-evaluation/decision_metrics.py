"""Metrics distinguish raw probability quality from thresholded suggestions."""
import math
from decision_corpus import LABELS


def violates_policy(surface, decision, facts):
    """Check hard evidence requirements independently of corpus labels."""
    if surface == "terminal":
        has_failure = facts.get("exit_code", 0) != 0 or facts.get("tests_failed", 0) > 0
        if decision in ["fine", "working"] and (has_failure or facts.get("permission_prompt")):
            return True
        if decision == "working":
            return not all(facts.get(key) is True for key in ["process_alive", "heartbeat_fresh", "progress_seen"])
        if decision == "fine":
            return facts.get("exit_code") != 0 or facts.get("tests_failed") != 0
    elif surface == "job" and decision in ["laptop", "vps"]:
        targets = facts.get("eligible_targets")
        return (
            not isinstance(targets, list)
            or decision not in targets
            or (facts.get("native_apple") is True and decision != "laptop")
        )
    elif surface == "data" and decision == "archive-candidate":
        return not (
            facts.get("owner_known") is True
            and facts.get("remote_verified") is True
            and facts.get("inactive") is True
            and facts.get("dirty") is False
            and facts.get("pinned") is False
            and facts.get("active_lease") is False
        )
    return False


def percentile(values, fraction):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * fraction) - 1)]


def summarize(fixtures, decisions):
    by_id = {row["id"]: row for row in decisions}
    report = {}
    for surface, labels in LABELS.items():
        rows = [row for row in fixtures if row["surface"] == surface]
        matrix = {label: {guess: 0 for guess in labels + ["abstain"]} for label in labels}
        confidences, briers, latencies, rss = [], [], [], []
        correct = answered = unsafe = raw_unsafe = policy_violations = 0
        for row in rows:
            answer = by_id[row["id"]]
            guess = answer["decision"] or "abstain"
            matrix[row["expected"]][guess] += 1
            correct += guess == row["expected"]
            answered += guess != "abstain"
            unsafe += (row["critical"] and guess in ["fine", "working", "archive-candidate", "laptop", "vps"] and guess != row["expected"])
            probabilities = answer.get("probabilities")
            if probabilities:
                top = max(probabilities, key=probabilities.get)
                raw_unsafe += (row["critical"] and top in ["fine", "working", "archive-candidate", "laptop", "vps"] and top != row["expected"])
                confidences.append((probabilities[top], top == row["expected"]))
                briers.append(sum((probabilities[label] - (label == row["expected"])) ** 2 for label in labels))
            facts = row["state"]["facts"]
            policy_violations += violates_policy(surface, guess, facts)
            if answer.get("latency_ms") is not None:
                latencies.append(answer["latency_ms"])
            if answer.get("backend_peak_rss_bytes") is not None:
                rss.append(answer["backend_peak_rss_bytes"])
        classes = {}
        for label in labels:
            tp = matrix[label][label]
            predicted = sum(matrix[actual][label] for actual in labels)
            actual = sum(matrix[label].values())
            classes[label] = {"precision": tp / predicted if predicted else None,
                              "recall": tp / actual if actual else None, "support": actual}
        ece = 0
        for bin_id in range(10):
            bucket = [(p, hit) for p, hit in confidences if min(9, int(p * 10)) == bin_id]
            if bucket:
                ece += len(bucket) / len(confidences) * abs(sum(p for p, _ in bucket) / len(bucket) - sum(hit for _, hit in bucket) / len(bucket))
        report[surface] = {"count": len(rows), "confusion": matrix, "per_class": classes,
                           "accuracy_all": correct / len(rows) if rows else None,
                           "selective_accuracy": correct / answered if answered else None,
                           "coverage": answered / len(rows) if rows else None,
                           "abstention_rate": 1 - answered / len(rows) if rows else None,
                           "unsafe_suggestions": unsafe,
                           "raw_unsafe_suggestions": raw_unsafe,
                           "policy_violations": policy_violations,
                           "brier_multiclass_sum": sum(briers) / len(briers) if briers else None,
                           "ece_10_bins": ece if confidences else None,
                           "probability_samples": len(confidences),
                           "latency_samples": len(latencies), "p50_latency_ms": percentile(latencies, .5),
                           "p95_latency_ms": percentile(latencies, .95),
                           "backend_rss_samples": len(rss), "max_backend_peak_rss_bytes": max(rss) if rss else None}
    return report
