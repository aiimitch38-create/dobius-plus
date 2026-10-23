import json
import os
from pathlib import Path
import tempfile
import subprocess
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from worker_report_watch import MAX_REPORT_BYTES, ReportObserver, notify, report_snapshot


class WorkerReportObserverTests(unittest.TestCase):
    def test_all_remote_selectors_are_removed_from_local_transport(self):
        environments = []

        def run(args, **kwargs):
            environments.append(kwargs['env'])
            body = '--expected-runtime-id --require-agent-status' if '--help' in args else json.dumps({
                'ok': True, '_meta': {'runtimeId': 'current'},
                'result': {'send': {'accepted': True}}
            })
            return SimpleNamespace(returncode=0, stdout=body)

        with patch.dict(os.environ, {
            'DOBIUS_PAIRING_CODE': 'fixture-pairing',
            'DOBIUS_REMOTE_PAIRING': 'fixture-legacy-pairing',
            'DOBIUS_ENVIRONMENT': 'fixture-remote',
            'DOBIUS_TEST_MARKER': 'preserved'
        }):
            self.assertTrue(notify(Path('/cli'), {'coordinator': 'root', 'runtime_id': 'current'},
                                   ['build1.json'], run=run, sleep=lambda _: None))
        self.assertEqual(len(environments), 4)
        for environment in environments:
            for selector in ['DOBIUS_PAIRING_CODE', 'DOBIUS_REMOTE_PAIRING', 'DOBIUS_ENVIRONMENT']:
                self.assertNotIn(selector, environment)
            self.assertEqual(environment['DOBIUS_TEST_MARKER'], 'preserved')

    def test_process_restart_recovers_delivery_cursor_and_does_not_repeat_notice(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reports = root / 'plans/cloud-workstation-reports-20261012'
            reports.mkdir(parents=True)
            manifest = root / 'manifest.json'
            manifest.write_text(json.dumps({'canonical_repository': str(root), 'coordinator': 'root', 'runtime_id': 'current'}))
            cli = root / 'fake-cli'
            calls = root / 'calls.txt'
            cli.write_text(f'#!{sys.executable}\nimport json,sys\nfrom pathlib import Path\n'
                           f'p=Path({str(calls)!r})\nwith p.open("a") as f:f.write(json.dumps(sys.argv[1:])+"\\n")\n'
                           'if "--help" in sys.argv: print("--expected-runtime-id --require-agent-status")\n'
                           'else: print(json.dumps({"ok":True,"_meta":{"runtimeId":"current"},"result":{"send":{"accepted":True}}}))\n')
            cli.chmod(0o700)
            args = [sys.executable, str(Path(__file__).with_name('worker_report_watch.py')), '--manifest', str(manifest), '--state', str(root / 'state'), '--cli', str(cli), '--once']
            self.assertEqual(subprocess.run(args, capture_output=True).returncode, 0)
            self.assertFalse(calls.exists())
            (reports / 'build1.json').write_text('{"status":"ready"}')
            self.assertEqual(subprocess.run(args, capture_output=True).returncode, 0)
            self.assertEqual(len(calls.read_text().splitlines()), 4)
            self.assertEqual(subprocess.run(args, capture_output=True).returncode, 0)
            self.assertEqual(len(calls.read_text().splitlines()), 4)
            state = json.loads((root / 'state/status.json').read_text())
            self.assertEqual(state['last_delivery']['state'], 'accepted')

    def test_baseline_is_quiet_and_content_changes_are_deduplicated(self):
        observer = ReportObserver({"build1.json": "old"})
        self.assertEqual(observer.changes({"build1.json": "old"}, 10), [])
        changed = {"build1.json": "new"}
        self.assertEqual(observer.changes(changed, 10), ["build1.json"])
        observer.acknowledge(changed, 10)
        self.assertEqual(observer.changes(changed, 100), [])

    def test_coalesces_reports_during_cooldown_without_losing_changes(self):
        observer = ReportObserver({})
        observer.acknowledge({"build1.json": "one"}, 10)
        updated = {"build1.json": "two", "fixer.json": "three"}
        self.assertEqual(observer.changes(updated, 69), [])
        self.assertEqual(observer.changes(updated, 70), ["build1.json", "fixer.json"])

    def test_partial_oversized_symlink_and_root_reports_are_not_notifications(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "build1.json").write_text('{"status":"frozen"}')
            (root / "research.json").write_text('{"half":')
            (root / "oversized.json").write_bytes(b' ' * (MAX_REPORT_BYTES + 1))
            (root / "root-feedback.json").write_text('{"status":"recheck"}')
            (root / "linked.json").symlink_to(root / "build1.json")
            self.assertEqual(list(report_snapshot(root)), ["build1.json"])

    def test_current_runtime_is_required_before_sending_any_terminal_input(self):
        calls = []
        def run(args, **kwargs):
            calls.append(args)
            return SimpleNamespace(returncode=0, stdout='--expected-runtime-id --require-agent-status' if '--help' in args else json.dumps({"ok": True, "_meta": {"runtimeId": "other-runtime"}}))
        self.assertFalse(notify(Path('/cli'), {"coordinator": "root", "runtime_id": "current"}, ["build1.json"], run=run, sleep=lambda _: None))
        self.assertEqual(len(calls), 2)

    def test_sends_only_filenames_to_verified_root_then_submits_enter(self):
        calls = []
        def run(args, **kwargs):
            calls.append(args)
            if '--help' in args:
                return SimpleNamespace(returncode=0, stdout='--expected-runtime-id --require-agent-status')
            if 'inbox' in args:
                body = {"ok": True, "_meta": {"runtimeId": "current"}}
            else:
                body = {"ok": True, "_meta": {"runtimeId": "current"}, "result": {"send": {"accepted": True}}}
            return SimpleNamespace(returncode=0, stdout=json.dumps(body))
        self.assertTrue(notify(Path('/cli'), {"coordinator": "root", "runtime_id": "current"}, ["build1.json"], run=run, sleep=lambda _: None))
        self.assertEqual(len(calls), 4)
        self.assertIn('--text', calls[2]); self.assertIn('--enter', calls[3])
        self.assertEqual(calls[2][calls[2].index('--terminal') + 1], 'root')
        self.assertIn('no new scope', calls[2][calls[2].index('--text') + 1])
        for call in calls[2:]:
            self.assertEqual(call[call.index('--expected-runtime-id') + 1], 'current')
            self.assertEqual(call[call.index('--require-agent-status') + 1], 'sendable')

    def test_old_cli_is_refused_before_any_terminal_input(self):
        calls = []
        def run(args, **kwargs):
            calls.append(args)
            return SimpleNamespace(returncode=0, stdout='terminal send --text --enter')
        self.assertFalse(notify(Path('/cli'), {'coordinator': 'root', 'runtime_id': 'current'},
                                ['build1.json'], run=run, sleep=lambda _: None))
        self.assertEqual(len(calls), 1)

    def test_old_server_refusal_does_not_fall_back_to_unbound_send(self):
        sends = []
        def run(args, **kwargs):
            if '--help' in args:
                return SimpleNamespace(returncode=0, stdout='--expected-runtime-id --require-agent-status')
            if 'inbox' in args:
                body = {'ok': True, '_meta': {'runtimeId': 'current'}}
            else:
                sends.append(args)
                body = {'ok': False, 'error': {'code': 'method_not_found'}, '_meta': {'runtimeId': 'current'}}
            return SimpleNamespace(returncode=0, stdout=json.dumps(body))
        self.assertFalse(notify(Path('/cli'), {'coordinator': 'root', 'runtime_id': 'current'},
                                ['build1.json'], run=run, sleep=lambda _: None))
        self.assertEqual(len(sends), 1)
        self.assertIn('--expected-runtime-id', sends[0])
        self.assertNotIn('--enter', sends[0])

    def test_restart_between_check_and_text_or_text_and_enter_cannot_submit_to_new_runtime(self):
        for restart_before_text in [True, False]:
            current = ['current']
            writes = []
            def run(args, **kwargs):
                if '--help' in args:
                    return SimpleNamespace(returncode=0, stdout='--expected-runtime-id --require-agent-status')
                if 'inbox' in args:
                    body = {'ok': True, '_meta': {'runtimeId': current[0]}}
                    if restart_before_text:
                        current[0] = 'replacement'
                else:
                    expected = args[args.index('--expected-runtime-id') + 1]
                    accepted = expected == current[0]
                    if accepted:
                        writes.append('--enter' if '--enter' in args else '--text')
                    body = {'ok': True, '_meta': {'runtimeId': current[0]},
                            'result': {'send': {'accepted': accepted}}}
                return SimpleNamespace(returncode=0, stdout=json.dumps(body))
            self.assertFalse(notify(Path('/cli'), {'coordinator': 'root', 'runtime_id': 'current'},
                                    ['build1.json'], run=run, sleep=lambda _: current.__setitem__(0, 'replacement')))
            self.assertEqual(writes, [] if restart_before_text else ['--text'])


if __name__ == '__main__':
    unittest.main()
