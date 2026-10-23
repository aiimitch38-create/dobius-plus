import copy
import json
import os
from pathlib import Path
import plistlib
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from monitor_state import (GIB, InstanceLock, initial_config, private_dir, read_json,
                           register_root, validate_config, write_json)
from prepare_monitor import prepare, render_schedule
from root_inventory import RootInventory, volume_sample
from storage_monitor import StorageMonitor
from storage_policy import admission, classify, status_freshness, status_shape_is_valid, thresholds


class MonitorFixture(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        # macOS /var is a system symlink; use the physical temporary path.
        self.directory = Path(self.temporary.name).resolve()
        self.base = self.directory / 'private-state'
        self.root = self.directory / 'project'
        self.root.mkdir()
        private_dir(self.base)
        self.config = register_root(initial_config('fixture-device'), 'project', self.root)
        write_json(self.base / 'config.json', self.config)

    def tearDown(self):
        self.temporary.cleanup()

    def monitor(self):
        monitor = StorageMonitor(self.base)
        self.addCleanup(monitor.close)
        return monitor

    def fake_capacity(self, free=50 * GIB):
        return {'id': str(self.config['roots'][0]['device']), 'totalBytes': 100 * GIB,
                'freeBytes': free, 'usedBytes': 100 * GIB - free}

    def sample(self, free=50 * GIB, now=1000):
        with patch('storage_monitor.volume_sample', return_value=self.fake_capacity(free)):
            return self.monitor().sample(now=now)


class StoragePolicyTests(MonitorFixture):
    def test_thresholds_and_hysteresis_prevent_noise(self):
        limits = thresholds(self.config['policy'], 100 * GIB)
        self.assertEqual(limits['warningBytes'], 20 * GIB)
        self.assertEqual(limits['criticalBytes'], 10 * GIB)
        self.assertEqual(classify(19 * GIB, limits), 'warning')
        self.assertEqual(classify(21 * GIB, limits, 'warning'), 'warning')
        self.assertEqual(classify(22 * GIB, limits, 'warning'), 'healthy')
        self.assertEqual(classify(11 * GIB, limits, 'critical'), 'critical')
        self.assertEqual(classify(12 * GIB, limits, 'critical'), 'warning')

    def test_fraction_threshold_dominates_large_volume(self):
        limits = thresholds(self.config['policy'], 1000 * GIB)
        self.assertEqual(limits['warningBytes'], 150 * GIB)
        self.assertEqual(limits['criticalBytes'], 80 * GIB)

    def test_admission_uses_estimate_reservations_and_reserve(self):
        status = self.sample()
        admitted = admission(status, self.config, 'project', 10 * GIB, 5 * GIB, now=1001)
        self.assertTrue(admitted['allowed'])
        self.assertEqual(admitted['projectedFreeBytes'], 30 * GIB)
        blocked = admission(status, self.config, 'project', 31 * GIB, 5 * GIB, now=1001)
        self.assertFalse(blocked['allowed'])
        self.assertEqual(blocked['reason'], 'insufficient_space')

    def test_unknown_estimate_uses_conservative_policy(self):
        result = admission(self.sample(free=30 * GIB), self.config, 'project', now=1001)
        self.assertFalse(result['allowed'])
        self.assertEqual(result['estimatedWorkingBytes'], 20 * GIB)
        self.assertEqual(result['estimateSource'], 'unknown_policy')

    def test_critical_hysteresis_blocks_jobs_until_recovery(self):
        status = self.sample(free=9 * GIB)
        status = self.sample(free=11 * GIB, now=1060)
        config = copy.deepcopy(self.config)
        config['policy']['safetyMarginBytes'] = 0
        self.assertFalse(admission(status, config, 'project', 0, now=1061)['allowed'])

    def test_old_sleep_clock_skew_and_wrong_device_fail_closed(self):
        status = self.sample()
        self.assertEqual(admission(status, self.config, 'project', 0, now=1181)['reason'], 'stale')
        self.assertEqual(admission(status, self.config, 'project', 0, now=990)['reason'], 'clock_skew')
        status['deviceId'] = 'other'
        self.assertFalse(admission(status, self.config, 'project', 0, now=1001)['allowed'])
        self.assertEqual(status_freshness({}, 180, 1000), 'unavailable')

    def test_path_free_identifier_and_volume_reference_contract(self):
        status = self.sample()
        valid_root = status['roots'][0]
        valid_volume = status['volumes'][0]
        self.assertTrue(status_shape_is_valid(status))

        malformed = []
        malformed.append({**status, 'deviceId': '/Users/private/device'})
        malformed.append({**status, 'roots': [{**valid_root, 'id': '/Users/private/root'}]})
        malformed.append({**status, 'volumes': [{**valid_volume, 'id': '/Volumes/private'}]})
        malformed.append({**status, 'roots': [{**valid_root, 'volumeId': None}]})
        malformed.append({**status, 'roots': [{**valid_root, 'volumeId': '/Volumes/private'}]})
        malformed.append({**status, 'roots': [{**valid_root, 'state': 'unavailable'}]})
        malformed.append({**status, 'roots': [], 'volumes': [valid_volume]})
        malformed.append({
            **status,
            'roots': [{**valid_root, 'volumeId': str(valid_root['identity']['device'] + 1)}],
            'volumes': [{**valid_volume, 'id': str(valid_root['identity']['device'] + 1)}],
        })
        malformed.append({
            **status,
            'roots': [{**valid_root, 'volumeId': '0' + valid_volume['id']}],
            'volumes': [{**valid_volume, 'id': '0' + valid_volume['id']}],
        })
        for candidate in malformed:
            with self.subTest(candidate=candidate):
                self.assertFalse(status_shape_is_valid(candidate))
                decision = admission(candidate, self.config, 'project', 0, now=1001)
                self.assertFalse(decision['allowed'])
                self.assertEqual(decision['reason'], 'unavailable')

        unavailable = copy.deepcopy(status)
        unavailable['health'] = 'unavailable'
        unavailable['roots'][0]['state'] = 'unavailable'
        unavailable['roots'][0]['volumeId'] = None
        unavailable['volumes'] = []
        unavailable['alerts'] = []
        self.assertTrue(status_shape_is_valid(unavailable))

    def test_monitor_discards_tampered_previous_identifiers_before_republishing(self):
        status = self.sample()
        status['alerts'] = [{
            'sampledAt': 1000,
            'kind': 'root_state_changed',
            'rootId': '/Users/private/root',
            'from': 'available',
            'to': 'unavailable'
        }]
        write_json(self.base / 'status.json', status)
        fresh = self.monitor().sample(now=1001)
        self.assertNotIn('/Users/private', json.dumps(fresh))
        self.assertTrue(status_shape_is_valid(fresh))

    def test_malformed_persisted_status_containers_return_unavailable(self):
        valid = self.sample()
        malformed = (
            {**valid, 'roots': None},
            {**valid, 'volumes': None},
            {**valid, 'roots': {}},
            {**valid, 'volumes': 'not-an-array'},
            {**valid, 'roots': [None]},
            {**valid, 'volumes': [None]},
            {**valid, 'roots': [{'id': 'project'}]},
            {**valid, 'volumes': [{'id': 123}]},
            {**valid, 'roots': [{**valid['roots'][0], 'identity': None}]},
        )
        for status in malformed:
            with self.subTest(status=status):
                decision = admission(status, self.config, 'project', 0, now=1001)
                self.assertFalse(decision['allowed'])
                self.assertEqual(decision['reason'], 'unavailable')
                self.assertEqual(decision['freshness'], 'unavailable')

    def test_non_object_persisted_status_returns_unavailable(self):
        for status in (None, [], 'status', 5):
            with self.subTest(status=status):
                decision = admission(status, self.config, 'project', 0, now=1001)
                self.assertFalse(decision['allowed'])
                self.assertEqual(decision['reason'], 'unavailable')

    def test_status_cli_maps_malformed_persisted_json_shape_without_traceback(self):
        write_json(self.base / 'status.json', {'schemaVersion': 1, 'roots': None, 'volumes': []})
        completed = subprocess.run(
            [sys.executable, str(Path(__file__).with_name('storage_monitor.py')),
             '--base', str(self.base), 'status'],
            capture_output=True, text=True, check=False)
        self.assertEqual(completed.returncode, 0)
        self.assertNotIn('Traceback', completed.stderr)
        result = json.loads(completed.stdout)
        self.assertEqual(result['health'], 'unavailable')
        self.assertEqual(result['freshness'], 'unavailable')
        self.assertEqual(result['reason'], 'malformed_status')

    def test_admit_cli_returns_unavailable_decision_without_traceback(self):
        write_json(self.base / 'status.json', {'schemaVersion': 1, 'roots': None, 'volumes': []})
        completed = subprocess.run(
            [sys.executable, str(Path(__file__).with_name('storage_monitor.py')),
             '--base', str(self.base), 'admit', '--root-id', 'project', '--estimate-bytes', '0'],
            capture_output=True, text=True, check=False)
        self.assertEqual(completed.returncode, 2)
        self.assertNotIn('Traceback', completed.stderr)
        result = json.loads(completed.stdout)
        self.assertFalse(result['allowed'])
        self.assertEqual(result['reason'], 'unavailable')

    def test_root_identity_config_changes_and_negative_estimates_refused(self):
        status = self.sample()
        self.assertEqual(admission(status, self.config, 'project', -1, now=1001)['reason'], 'invalid_space_estimate')
        self.assertEqual(admission(status, self.config, 'project', 1, -1, now=1001)['reason'], 'invalid_space_estimate')
        config = copy.deepcopy(self.config)
        config['roots'][0]['inode'] += 1
        self.assertEqual(admission(status, config, 'project', 0, now=1001)['reason'], 'root_identity_changed')

    def test_alerts_deduplicate_and_trend_is_preserved(self):
        status = self.sample(free=19 * GIB)
        self.assertEqual(len(status['alerts']), 1)
        status = self.sample(free=21 * GIB, now=1060)
        self.assertEqual(len(status['alerts']), 1)
        status = self.sample(free=22 * GIB, now=1120)
        self.assertEqual(len(status['alerts']), 2)
        self.assertGreater(status['volumes'][0]['freeBytesPerSecond'], 0)

    def test_shared_volume_deduplicated(self):
        other = self.directory / 'other'
        other.mkdir()
        register_root(self.config, 'other', other)
        write_json(self.base / 'config.json', self.config)
        status = self.sample()
        self.assertEqual(len(status['roots']), 2)
        self.assertEqual(len(status['volumes']), 1)


@unittest.skipUnless(os.name == 'posix', 'Descriptor inventory is POSIX-only')
class InventoryTests(MonitorFixture):
    def inventory(self, max_entries=3):
        budget = dict(self.config['scan'], maxEntriesPerTick=max_entries, maxSecondsPerTick=1)
        inventory = RootInventory(self.config['roots'][0], budget)
        self.addCleanup(inventory.close)
        return inventory

    def finish(self, inventory):
        for _ in range(1000):
            result = inventory.tick()
            if result['state'] != 'scanning':
                return result
        self.fail('Incremental inventory did not finish')

    def test_regular_sparse_hardlink_and_symlink_totals(self):
        data = self.root / 'data'
        data.write_bytes(b'abc')
        os.link(data, self.root / 'hardlink')
        with (self.root / 'sparse').open('wb') as stream:
            stream.truncate(8 * 1024 ** 2)
        outside = self.directory / 'outside'
        outside.mkdir()
        (outside / 'secret').write_bytes(b'x' * 100)
        (self.root / 'escape').symlink_to(outside, target_is_directory=True)
        inventory = self.inventory()
        self.assertEqual(inventory.tick()['state'], 'scanning')
        result = self.finish(inventory)
        self.assertEqual(result['state'], 'complete')
        self.assertEqual(result['logicalBytes'], 8 * 1024 ** 2 + 3)
        self.assertEqual(result['files'], 2)
        self.assertEqual(result['skipped']['hardlinks'], 1)
        self.assertEqual(result['skipped']['symlinks'], 1)
        self.assertIsNone(result['reclaimableBytes'])
        self.assertLess(result['allocatedBytes'], result['logicalBytes'])

    def test_directory_replacement_symlink_cannot_escape(self):
        child = self.root / 'child'
        child.mkdir()
        inventory = self.inventory(2)
        inventory.tick()  # Opens root and queues child, without traversing it.
        child.rmdir()
        outside = self.directory / 'outside'
        outside.mkdir()
        (outside / 'secret').write_bytes(b'secret')
        child.symlink_to(outside, target_is_directory=True)
        result = self.finish(inventory)
        self.assertEqual(result['logicalBytes'], 0)
        self.assertEqual(result['state'], 'partial')

    def test_inode_budget_bounds_memory_and_reports_partial(self):
        for i in range(10):
            (self.root / str(i)).write_bytes(b'x')
        inventory = self.inventory()
        inventory.budget['maxInodes'] = 2
        result = self.finish(inventory)
        self.assertEqual(result['state'], 'partial')
        self.assertTrue(result['limitReached'])
        self.assertEqual(len(inventory.seen), 0)
        self.assertEqual(result['files'], 2)

    def test_directory_budget_bounds_frontier(self):
        for i in range(10):
            (self.root / str(i)).mkdir()
        inventory = self.inventory()
        inventory.budget['maxDirectories'] = 2
        result = self.finish(inventory)
        self.assertEqual(result['state'], 'partial')
        self.assertEqual(result['directories'], 2)

    def test_missing_or_replaced_root_is_unavailable_without_recreation(self):
        self.root.rename(self.directory / 'disconnected-project')
        status = self.monitor().sample()
        self.assertEqual(status['health'], 'unavailable')
        self.assertFalse(self.root.exists())
        self.root.mkdir()
        status = self.monitor().sample()
        self.assertEqual(status['roots'][0]['state'], 'unavailable')
        self.assertEqual(admission(status, self.config, 'project', 0)['reason'], 'root_unavailable')

    def test_spoofed_volume_identity_marks_root_unavailable_without_reference(self):
        spoofed = {'id': '/Volumes/private', 'totalBytes': 100 * GIB,
                   'freeBytes': 50 * GIB, 'usedBytes': 50 * GIB}
        with patch('storage_monitor.volume_sample', return_value=spoofed):
            status = self.monitor().sample(now=1000)
        self.assertEqual(status['roots'][0]['state'], 'unavailable')
        self.assertIsNone(status['roots'][0]['volumeId'])
        self.assertEqual(status['volumes'], [])
        self.assertTrue(status_shape_is_valid(status))
        self.assertEqual(admission(status, self.config, 'project', 0, now=1001)['reason'], 'root_unavailable')

    def test_root_parent_symlink_replacement_is_unavailable(self):
        self.root.rename(self.directory / 'original')
        self.root.symlink_to(self.directory / 'original', target_is_directory=True)
        status = self.monitor().sample()
        self.assertEqual(status['health'], 'unavailable')

    def test_permission_error_is_partial(self):
        denied = self.root / 'denied'
        denied.mkdir()
        (denied / 'secret').write_bytes(b'secret')
        denied.chmod(0)
        try:
            if hasattr(os, 'geteuid') and os.geteuid() == 0:
                with patch('root_inventory.open_relative', side_effect=PermissionError):
                    result = self.finish(self.inventory())
            else:
                result = self.finish(self.inventory())
            self.assertEqual(result['state'], 'partial')
            self.assertGreater(result['errorCount'], 0)
        finally:
            denied.chmod(0o700)

    def test_mount_boundary_is_not_traversed(self):
        (self.root / 'mount').mkdir()
        inventory = self.inventory()
        info = type('Info', (), {'st_mode': 0o040700, 'st_dev': self.config['roots'][0]['device'] + 1})()
        entry = type('Entry', (), {'name': 'mount', 'stat': lambda *_args, **_kwargs: info})()
        inventory._entry(entry)
        self.assertEqual(inventory.skipped['mounts'], 1)
        self.assertEqual(len(inventory.queue), 1)


class StateAndServiceTests(MonitorFixture):
    def test_config_invalid_budgets_and_duplicate_roots_refused(self):
        config = copy.deepcopy(self.config)
        config['scan']['maxEntriesPerTick'] = 1000000
        with self.assertRaises(ValueError):
            validate_config(config)
        with self.assertRaises(FileNotFoundError):
            register_root(self.config, 'nested', self.root / 'missing')
        with self.assertRaises(ValueError):
            register_root(self.config, 'duplicate', self.root)

    def test_atomic_private_json_and_symlink_refusal(self):
        status = self.sample()
        self.assertEqual(read_json(self.base / 'status.json'), status)
        if os.name == 'posix':
            self.assertEqual(self.base.stat().st_mode & 0o777, 0o700)
            self.assertEqual((self.base / 'status.json').stat().st_mode & 0o777, 0o600)
        redirected = self.directory / 'redirected'
        redirected.symlink_to(self.base, target_is_directory=True)
        with self.assertRaises(ValueError):
            private_dir(redirected)

    def test_instance_lock_prevents_parallel_monitor_writes(self):
        first = InstanceLock(self.base)
        try:
            with self.assertRaises(RuntimeError):
                InstanceLock(self.base)
        finally:
            first.close()
        next_lock = InstanceLock(self.base)
        next_lock.close()

    def test_unconfigured_means_no_root_sampling(self):
        write_json(self.base / 'config.json', initial_config('empty'))
        with patch('storage_monitor.volume_sample', side_effect=AssertionError('No home scan permitted')):
            status = self.monitor().sample()
        self.assertEqual(status['health'], 'unconfigured')
        self.assertEqual(status['roots'], [])

    def test_schedule_staging_does_not_activate_and_quotes_paths(self):
        staged = self.directory / 'state with spaces'
        result = prepare(staged, 'staged', Path(sys.executable), 'darwin')
        self.assertFalse(result['scheduleInstalled'])
        document = plistlib.loads(Path(result['schedule']).read_bytes())
        self.assertEqual(document['ProgramArguments'][3], str(staged))
        self.assertTrue(document['KeepAlive'])
        _, linux = render_schedule(staged, Path('/python with spaces'), 'linux')
        self.assertIn(b'"/python with spaces"', linux)
        self.assertIn(b'MemoryMax=192M', linux)
        windows = prepare(self.directory / 'windows', 'windows', Path(sys.executable), 'win32')
        self.assertFalse(windows['schedulingSupported'])

    def test_daemon_samples_with_no_electron_and_exits_cleanly(self):
        runner = Path(__file__).parent / 'storage_monitor.py'
        process = subprocess.Popen([sys.executable, str(runner), '--base', str(self.base), 'daemon'],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 5
            while not (self.base / 'status.json').exists() and time.monotonic() < deadline:
                time.sleep(0.05)
            self.assertTrue((self.base / 'status.json').exists())
            status = read_json(self.base / 'status.json')
            self.assertEqual(status['deviceId'], 'fixture-device')
            self.assertFalse(status['cleanupEnabled'])
            self.assertGreater(status['volumes'][0]['totalBytes'], 0)
            duplicate = subprocess.run([sys.executable, str(runner), '--base', str(self.base), 'sample'],
                                       capture_output=True, text=True, timeout=5)
            self.assertNotEqual(duplicate.returncode, 0)
            self.assertIn('already running', duplicate.stderr)
        finally:
            process.send_signal(signal.SIGTERM)
            stdout, stderr = process.communicate(timeout=5)
        self.assertEqual(process.returncode, 0, stderr.decode())
        self.assertEqual(stdout, b'')


if __name__ == '__main__':
    unittest.main()
