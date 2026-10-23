import importlib.util
from pathlib import Path
import unittest
import tempfile
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('worker_monitor', Path(__file__).with_name('worker_monitor.py'))
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)


class BuildMonitorTests(unittest.TestCase):
    def setUp(self):
        self.identity = {'handle': 'worker', 'tabId': 'tab', 'leafId': 'leaf'}
        self.config = {'manager': dict(self.identity, handle='root'), 'runtime_id': 'runtime',
                       'workers': {'BUILD1': dict(self.identity, task_id='task', assigned_at=1000)}}
        self.terminal = dict(self.identity, connected=True, lastOutputAt=1000000)

    def collect(self, status='dispatched', now=1601, state=None, terminal=None, reports=None):
        return monitor.collect(self.config, state or {}, [terminal or self.terminal],
                               [{'id': 'task', 'status': status}], [], [], reports or {}, now)

    def test_quiet_job_requests_inspection_without_marking_failed(self):
        workers, signals, events = self.collect()
        self.assertEqual(workers['BUILD1']['task_status'], 'dispatched')
        self.assertEqual(events[0]['kind'], 'job_quiet_check_required')
        self.assertEqual(self.collect(now=1599)[2], [])

    def test_recent_assignment_is_not_treated_as_stalled(self):
        self.config['workers']['BUILD1']['assigned_at'] = 1600
        self.assertEqual(self.collect()[2], [])

    def test_accepted_input_without_worker_acknowledgement_is_flagged(self):
        self.config['workers']['BUILD1']['delivery_verified'] = False
        self.assertEqual(self.collect(now=1061)[2][0]['kind'], 'dispatch_delivery_needs_readback')
        self.config['workers']['BUILD1']['delivery_verified'] = True
        self.assertEqual(self.collect(now=1061)[2], [])

    def test_finished_agent_alert_does_not_auto_complete_task(self):
        workers, _, events = monitor.collect(self.config, {}, [self.terminal],
            [{'id': 'task', 'status': 'dispatched'}], [], [], {}, 1100,
            {'tab:leaf': {'state': 'done'}})
        self.assertEqual(workers['BUILD1']['task_status'], 'dispatched')
        self.assertEqual(events[0]['kind'], 'worker_finished_needs_reconciliation')

    def test_permission_state_requires_attention(self):
        _, _, events = monitor.collect(self.config, {}, [self.terminal],
            [{'id': 'task', 'status': 'dispatched'}], [], [], {}, 1100,
            {'tab:leaf': {'state': 'permission'}})
        self.assertEqual(events[0]['kind'], 'worker_needs_permission')

    def test_changed_terminal_identity_refuses_binding(self):
        stale = dict(self.terminal, leafId='replacement')
        self.assertFalse(monitor.binding_matches(stale, self.identity))
        self.assertEqual(self.collect(terminal=stale)[2][0]['kind'], 'worker_disconnected')

    def test_queue_states_require_root_action(self):
        for status, kind in [('ready', 'ready_job_unassigned'), ('blocked', 'job_requires_attention'),
                             ('failed', 'job_requires_attention'), ('completed', 'completed_job_needs_next_step')]:
            self.assertEqual(self.collect(status=status)[2][0]['kind'], kind)

    def test_hold_reason_prevents_idle_reminder(self):
        self.config['workers']['BUILD1']['hold_reason'] = 'awaiting reviewed interface'
        self.assertEqual(self.collect(status='completed')[2], [])

    def test_reminder_cooldown_and_report_deduplication(self):
        state = {'notified_at': {'quiet:task': 1550}, 'delivered_reports': {'BUILD1': 'old'}}
        events = self.collect(state=state, reports={'BUILD1': 'new'})[2]
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]['sha256'], 'new')
        state['delivered_reports']['BUILD1'] = 'new'
        self.assertEqual(self.collect(state=state, reports={'BUILD1': 'new'})[2], [])

    def test_only_current_job_gates_are_observed(self):
        _, _, events = monitor.collect(self.config, {}, [self.terminal], [{'id': 'task', 'status': 'dispatched'}], [],
            [{'id': 'old-gate', 'task_id': 'historical'}, {'id': 'new-gate', 'task_id': 'task'}], {}, 1100)
        self.assertEqual([e['id'] for e in events], ['new-gate'])

    def test_queued_job_surfaces_when_dependencies_finish(self):
        self.config['queue_task_ids'] = ['review']
        tasks = [{'id': 'task', 'status': 'dispatched'},
                 {'id': 'author', 'status': 'completed'},
                 {'id': 'review', 'status': 'pending', 'deps': '["author"]'}]
        _, _, events = monitor.collect(self.config, {}, [self.terminal], tasks, [], [], {}, 1100)
        self.assertEqual(events[0]['kind'], 'dependencies_finished_job_needs_ready')
        tasks[1]['status'] = 'dispatched'
        self.assertEqual(monitor.collect(self.config, {}, [self.terminal], tasks, [], [], {}, 1100)[2], [])

    def test_incomplete_report_preserves_last_good_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'report.json'
            path.write_text('{"partial":')
            self.assertIsNone(monitor.report_hash(path))
            path.write_text('{"complete": true}')
            self.assertIsNotNone(monitor.report_hash(path))

    def test_existing_large_history_report_is_observed_with_a_hard_cap(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'report.json'
            path.write_text('{"history": "' + 'x' * 810_000 + '"}')
            self.assertIsNotNone(monitor.report_hash(path))
            path.write_text('x' * (monitor.MAX_REPORT_BYTES + 1))
            self.assertIsNone(monitor.report_hash(path))

    def test_partial_write_does_not_immediately_raise_report_alarm(self):
        state = {}
        args = (self.config, state, [self.terminal], [{'id': 'task', 'status': 'dispatched'}], [], [])
        self.assertEqual(monitor.collect(*args, {'BUILD1': None}, 1100)[2], [])
        state['delivered_reports'] = {'BUILD1': 'valid'}
        self.assertEqual(monitor.collect(*args, {'BUILD1': 'valid'}, 1130)[2], [])
        self.assertEqual(state['invalid_report_since'], {})

    def test_persistently_unreadable_report_is_surfaced_after_grace(self):
        state = {}
        args = (self.config, state, [self.terminal], [{'id': 'task', 'status': 'dispatched'}], [], [])
        monitor.collect(*args, {'BUILD1': None}, 1100)
        self.assertEqual(monitor.collect(*args, {'BUILD1': None}, 1161)[2][0]['kind'], 'worker_report_unreadable')

    def test_refused_paste_never_submits_enter(self):
        calls = []
        def call(*args):
            calls.append(args)
            return {'result': {'send': {'accepted': False}}}
        state = {}
        self.assertFalse(monitor.send_notification(self.config, state, [{'kind': 'check'}], lambda: None, call))
        self.assertEqual(len(calls), 1)
        self.assertEqual(state['pending_notification']['phase'], 'new')

    def test_successful_delivery_is_two_phase_and_runtime_bound(self):
        calls = []
        def call(*args):
            calls.append(args)
            return {'result': {'send': {'accepted': True}}}
        state = {}
        with patch.object(monitor.time, 'sleep'):
            self.assertTrue(monitor.send_notification(self.config, state, [{'kind': 'check'}], lambda: None, call))
        self.assertEqual(len(calls), 2)
        self.assertIn('--expected-runtime-id', calls[0])
        self.assertNotIn('--enter', calls[0])
        self.assertIn('--enter', calls[1])
        self.assertIsNone(state['pending_notification'])

    def test_ambiguous_enter_is_not_replayed_or_repasted(self):
        calls = []
        def call(*args):
            calls.append(args)
            if '--enter' in args:
                raise TimeoutError('submission uncertain')
            return {'result': {'send': {'accepted': True}}}
        state = {}
        with patch.object(monitor.time, 'sleep'):
            with self.assertRaises(TimeoutError):
                monitor.send_notification(self.config, state, [{'kind': 'check'}], lambda: None, call)
        self.assertEqual(state['pending_notification']['phase'], 'submit_uncertain')
        self.assertFalse(monitor.send_notification(self.config, state, [], lambda: None, call))
        self.assertEqual(len(calls), 2)


if __name__ == '__main__':
    unittest.main()
