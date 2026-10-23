"""Protocol/metric fixtures test arithmetic, never represent model predictions."""
import copy
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch
from decision_corpus import LABELS, baseline, corpus, digest, request
from decision_evaluate import SOURCE_REVISION, evaluate, main
from decision_metrics import summarize


def protocol_fixture():
    dataset = corpus()
    decisions = []
    for row in dataset["fixtures"]:
        if row["split"] == "heldout":
            labels = LABELS[row["surface"]]
            decisions.append({"id": row["id"], "request_sha256": digest(request(row)),
                              "decision": row["expected"], "probabilities": {label: float(label == row["expected"]) for label in labels},
                              "truncated": False, "latency_ms": 12, "backend_peak_rss_bytes": 123456})
    return {"schema": "dobius-laya-predictions/v1", "corpus_sha256": digest(dataset),
            "provenance": {"kind": "real-inference", "source_revision": SOURCE_REVISION,
                           "checkpoint_revision": "a" * 40, "dependency_lock_sha256": "b" * 64,
                           "runtime": "TEST ONLY", "device": "TEST ONLY", "host": "TEST ONLY", "measured_at": "TEST ONLY"},
            "decisions": decisions}


class EvaluationTests(unittest.TestCase):
    def test_no_inference_means_unavailable_not_perfect_model(self):
        result = evaluate(None)
        self.assertIsNone(result["laya"])
        self.assertEqual(result["promotion"], "blocked")

    def test_requests_exclude_expected_labels_and_other_split(self):
        for row in corpus()["fixtures"]:
            body = request(row)
            self.assertNotIn("expected", body)
            self.assertNotIn("label_provenance", body)
            self.assertEqual(set(body["questions"]["decision"]["criteria"]), set(LABELS[row["surface"]]))

    def test_deterministic_authority_outranks_reassuring_text(self):
        failure = next(r for r in corpus()["fixtures"] if r["surface"] == "terminal" and r["expected"] == "failed")
        self.assertEqual(baseline(failure), "failed")
        data = next(r for r in corpus()["fixtures"] if r["surface"] == "data" and r["state"]["facts"].get("dirty"))
        self.assertEqual(baseline(data), "keep-local")

    def test_baseline_abstains_when_success_lacks_test_result(self):
        dataset = corpus()
        fixture = next(row for row in dataset["fixtures"] if row["id"] == "terminal-heldout-01")
        fixture["expected"] = "needs-human"
        fixture["state"]["facts"] = {"exit_code": 0}
        self.assertIsNone(baseline(fixture))
        result = evaluate(None, dataset)["baseline"]["terminal"]
        self.assertEqual(result["confusion"]["needs-human"]["abstain"], 2)
        self.assertEqual(result["confusion"]["needs-human"]["fine"], 0)

    def test_metric_arithmetic_and_abstention(self):
        rows = [r for r in corpus()["fixtures"] if r["split"] == "heldout" and r["surface"] == "terminal"][:2]
        answers = [{"id": rows[0]["id"], "decision": "fine", "probabilities": {label: float(label == "fine") for label in LABELS["terminal"]}},
                   {"id": rows[1]["id"], "decision": None}]
        result = summarize(rows, answers)["terminal"]
        self.assertEqual(result["accuracy_all"], .5)
        self.assertEqual(result["selective_accuracy"], 1)
        self.assertEqual(result["abstention_rate"], .5)
        self.assertEqual(result["per_class"]["working"]["recall"], 0)
        self.assertEqual(result["brier_multiclass_sum"], 0)
        self.assertEqual(result["ece_10_bins"], 0)

    def test_protocol_smoke_never_promotes(self):
        self.assertEqual(evaluate(protocol_fixture())["promotion"], "blocked")

    def test_bad_inputs_refused(self):
        mutations = [lambda p: p.update(corpus_sha256="drift"),
                     lambda p: p["provenance"].update(source_revision="upstream-latest"),
                     lambda p: p["provenance"].update(checkpoint_revision="main"),
                     lambda p: p["provenance"].update(dependency_lock_sha256="unknown"),
                     lambda p: p["decisions"].append(copy.deepcopy(p["decisions"][0])),
                     lambda p: p["decisions"].pop(),
                     lambda p: p["decisions"][0].update(request_sha256="stale"),
                     lambda p: p["decisions"][0].update(latency_ms=float("nan")),
                     lambda p: p["decisions"][0].update(backend_peak_rss_bytes=True),
                     lambda p: p["decisions"][0].update(truncated=None),
                     lambda p: p["decisions"][0].update(probabilities={"fine": 1}),
                     lambda p: p["decisions"][0]["probabilities"].update(fine=1.5)]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                payload = protocol_fixture()
                mutate(payload)
                with self.assertRaises(ValueError):
                    evaluate(payload)

    def test_low_confidence_and_truncation_abstain(self):
        for truncate in [False, True]:
            p = protocol_fixture()
            answer = p["decisions"][0]
            if truncate:
                answer["truncated"] = True
            else:
                answer["probabilities"] = {label: .85 if label == "fine" else .03 for label in LABELS["terminal"]}
            result = evaluate(p)["laya"]["terminal"]
            self.assertEqual(result["confusion"]["fine"]["abstain"], 1)

    def test_explicit_abstention_keeps_probability_calibration(self):
        p = protocol_fixture()
        p["decisions"][0]["decision"] = None
        result = evaluate(p)["laya"]["terminal"]
        self.assertEqual(result["probability_samples"], 6)
        self.assertEqual(result["confusion"]["fine"]["abstain"], 1)

    def test_unsafe_suggestion_is_visible(self):
        p = protocol_fixture()
        answer = next(a for a in p["decisions"] if a["decision"] == "failed")
        answer["decision"] = "fine"
        answer["probabilities"] = {label: float(label == "fine") for label in LABELS["terminal"]}
        self.assertEqual(evaluate(p)["laya"]["terminal"]["unsafe_suggestions"], 1)

    def test_data_policy_catches_bad_archive_despite_noncritical_label(self):
        p = protocol_fixture()
        answer = next(a for a in p["decisions"] if a["decision"] == "keep-local")
        answer["decision"] = "archive-candidate"
        answer["probabilities"] = {label: float(label == "archive-candidate") for label in LABELS["data"]}
        self.assertEqual(evaluate(p)["laya"]["data"]["policy_violations"], 1)

    def test_policy_metrics_reject_positive_terminal_states_without_required_facts(self):
        for decision in ["fine", "working"]:
            with self.subTest(decision=decision):
                p = protocol_fixture()
                answer = next(a for a in p["decisions"] if a["id"] == "terminal-heldout-06")
                answer["decision"] = decision
                answer["probabilities"] = {label: float(label == decision) for label in LABELS["terminal"]}
                result = evaluate(p)["laya"]["terminal"]
                self.assertEqual(result["policy_violations"], 1)

    def test_archive_policy_requires_facts_even_if_expected_label_says_safe(self):
        dataset = corpus()
        fixture = next(row for row in dataset["fixtures"] if row["id"] == "data-heldout-04")
        fixture["expected"] = "archive-candidate"
        p = protocol_fixture()
        p["corpus_sha256"] = digest(dataset)
        answer = next(a for a in p["decisions"] if a["id"] == fixture["id"])
        answer["decision"] = "archive-candidate"
        answer["probabilities"] = {label: float(label == "archive-candidate") for label in LABELS["data"]}
        result = evaluate(p, dataset)["laya"]["data"]
        self.assertEqual(result["policy_violations"], 1)

    def test_non_object_payload_refused(self):
        with self.assertRaises(ValueError):
            evaluate([])

    def test_corpus_rejects_fixture_ids_reused_across_splits(self):
        dataset = corpus()
        duplicate = copy.deepcopy(next(row for row in dataset["fixtures"] if row["split"] == "heldout"))
        duplicate["split"] = "tuning"
        dataset["fixtures"].append(duplicate)
        with self.assertRaisesRegex(ValueError, "unique across all splits"):
            evaluate(None, dataset)

    def test_export_cli_refuses_invalid_corpus_before_emitting_requests(self):
        duplicate = corpus()
        reused = copy.deepcopy(next(row for row in duplicate["fixtures"] if row["split"] == "heldout"))
        reused["split"] = "tuning"
        duplicate["fixtures"].append(reused)
        malformed = {"schema": "dobius-laya-corpus/v1", "fixtures": "not-an-array"}

        for dataset in [duplicate, malformed]:
            with self.subTest(dataset=dataset):
                with tempfile.TemporaryDirectory() as directory:
                    corpus_path = Path(directory) / "corpus.json"
                    corpus_path.write_text(json.dumps(dataset))
                    stdout = io.StringIO()
                    stderr = io.StringIO()
                    argv = ["decision_evaluate.py", "--corpus", str(corpus_path), "--export-requests"]
                    with patch("sys.argv", argv), redirect_stdout(stdout), redirect_stderr(stderr):
                        with self.assertRaises(SystemExit) as raised:
                            main()
                    self.assertEqual(raised.exception.code, 2)
                    self.assertEqual(stdout.getvalue(), "")


if __name__ == "__main__":
    unittest.main()
