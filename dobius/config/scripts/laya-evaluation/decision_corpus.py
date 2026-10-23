"""Sanitized synthetic smoke corpus; labels need independent human review."""
import hashlib
import json

LABELS = {
    "terminal": ["fine", "working", "waiting-permission", "stuck", "failed", "needs-human"],
    "job": ["laptop", "vps", "needs-human"],
    "data": ["keep-local", "archive-candidate", "needs-human"],
}
DESCRIPTIONS = {
    "terminal": "Describe attention needed. Exit/test failures outrank reassuring prose; quiet output alone proves nothing.",
    "job": "Suggest only an eligible execution target. Native Apple builds need an enrolled compatible Mac; ambiguous constraints need human review.",
    "data": "Suggest eligible archive candidates only. Dirty, pinned, leased, unowned or unverified data cannot be automatically evicted.",
}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def request(fixture):
    return {"state": fixture["state"], "questions": {"decision": {
        "type": "choice", "instructions": DESCRIPTIONS[fixture["surface"]],
        "criteria": {label: label for label in LABELS[fixture["surface"]]},
    }}, "model": "multilingual", "max_len": 2048, "head_max_len": 512}


def corpus():
    rows = []

    def add(surface, split, label, text, facts, critical=False):
        rows.append({"id": f"{surface}-{split}-{sum(r['surface'] == surface and r['split'] == split for r in rows) + 1:02}",
                     "surface": surface, "split": split, "expected": label,
                     "state": {"text": text, "facts": facts}, "critical": critical,
                     "label_provenance": "synthetic-curated-rule-label; independent review pending"})

    for split in ["tuning", "heldout"]:
        suffix = "fixture project alpha" if split == "tuning" else "fixture project beta"
        add("terminal", split, "fine", f"{suffix}: error-handling test passed; 0 failures", {"exit_code": 0, "tests_failed": 0})
        add("terminal", split, "working", f"{suffix}: no output during a long build", {"process_alive": True, "heartbeat_fresh": True, "progress_seen": True})
        add("terminal", split, "waiting-permission", f"{suffix}: approve this deployment?", {"permission_prompt": True}, True)
        add("terminal", split, "failed", f"{suffix}: summary says all good, but compiler exited", {"exit_code": 2, "tests_failed": 1}, True)
        add("terminal", split, "stuck", f"{suffix}: same retry message repeated beyond the configured deadline", {"process_alive": True, "heartbeat_fresh": True, "progress_deadline_exceeded": True})
        add("terminal", split, "needs-human", f"{suffix}: quiet terminal; process identity unavailable", {}, True)
        add("job", split, "laptop", f"{suffix}: signed native iOS build", {"native_apple": True, "eligible_targets": ["laptop"], "laptop_online": False})
        add("job", split, "vps", f"{suffix}: small Linux lint job", {"native_apple": False, "eligible_targets": ["vps"], "dependencies_ready": True})
        add("job", split, "needs-human", f"{suffix}: run somewhere cheap; requirements unspecified", {"eligible_targets": []}, True)
        add("job", split, "needs-human", f"{suffix}: native build requested on Linux only", {"native_apple": True, "eligible_targets": ["vps"]}, True)
        add("data", split, "keep-local", f"{suffix}: inactive source folder with unfinished edits", {"dirty": True, "pinned": False, "active_lease": False, "owner_known": True, "remote_verified": True})
        add("data", split, "keep-local", f"{suffix}: user pinned release project", {"dirty": False, "pinned": True, "active_lease": False, "owner_known": True, "remote_verified": True})
        add("data", split, "archive-candidate", f"{suffix}: inactive managed artifact, restore verified", {"dirty": False, "pinned": False, "active_lease": False, "owner_known": True, "remote_verified": True, "inactive": True})
        add("data", split, "needs-human", f"{suffix}: large unknown folder with partial upload", {"owner_known": False, "remote_verified": False}, True)
        add("data", split, "keep-local", f"{suffix}: generated artifact currently used by a worker", {"dirty": False, "pinned": False, "active_lease": True, "owner_known": True, "remote_verified": True})
    return {"schema": "dobius-laya-corpus/v1", "synthetic": True, "review_status": "pending", "fixtures": rows}


def baseline(fixture):
    """Conservative factual baseline; returns None for insufficient evidence."""
    f = fixture["state"]["facts"]
    surface = fixture["surface"]
    if surface == "terminal":
        if f.get("exit_code", 0) != 0 or f.get("tests_failed", 0) > 0:
            return "failed"
        if f.get("permission_prompt"):
            return "waiting-permission"
        if f.get("progress_deadline_exceeded"):
            return "stuck"
        # Why: a successful process exit without test-result evidence is not
        # enough to declare a decision surface safe.
        if f.get("exit_code") == 0 and f.get("tests_failed") == 0:
            return "fine"
        if f.get("process_alive") and f.get("heartbeat_fresh") and f.get("progress_seen"):
            return "working"
    elif surface == "job":
        targets = f.get("eligible_targets", [])
        if f.get("native_apple"):
            return "laptop" if "laptop" in targets else None
        if targets == ["vps"] and f.get("dependencies_ready"):
            return "vps"
    elif surface == "data":
        if f.get("dirty") or f.get("pinned") or f.get("active_lease"):
            return "keep-local"
        if all(f.get(key) is True for key in ["owner_known", "remote_verified", "inactive"]) and all(f.get(key) is False for key in ["dirty", "pinned", "active_lease"]):
            return "archive-candidate"
    return None
