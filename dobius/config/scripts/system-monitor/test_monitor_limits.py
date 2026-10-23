"""Regressions for retained traversal state and fail-closed observations."""
import copy
import os
from pathlib import Path
from unittest.mock import patch

from monitor_state import read_json, register_root, validate_config, write_json
from root_inventory import MAX_ERRORS, MAX_ERROR_PATH_CHARS, RootInventory
from storage_policy import admission
from test_storage_monitor import MonitorFixture


class MonitorLimitTests(MonitorFixture):
    def test_reordering_roots_keeps_only_one_unfinished_traversal(self):
        for index in range(12):
            (self.root / str(index)).write_bytes(b'x')
        second = self.directory / 'second'
        second.mkdir()
        register_root(self.config, 'second', second)
        self.config['scan']['maxEntriesPerTick'] = 2
        write_json(self.base / 'config.json', self.config)
        monitor = self.monitor()
        monitor.scan_tick()
        first = monitor.inventories['project']
        self.assertIsNone(first.finished_at)
        self.config['roots'].reverse()
        write_json(self.base / 'config.json', self.config)
        monitor.refresh_config()
        monitor.scan_tick()
        self.assertEqual(list(monitor.inventories), ['project'])
        self.assertGreater(first.files, 0)
        for _ in range(30):
            monitor.scan_tick()
            unfinished = [item for item in monitor.inventories.values() if item.finished_at is None]
            self.assertLessEqual(len(unfinished), 1)
        self.assertIn('second', monitor.inventories)
        self.assertEqual(len(first.seen), 0)
        self.assertEqual(len(first.queue), 0)
        self.assertIsNone(first.descriptor)

    def test_removing_active_root_releases_traversal(self):
        (self.root / 'child').mkdir()
        self.config['scan']['maxEntriesPerTick'] = 1
        write_json(self.base / 'config.json', self.config)
        monitor = self.monitor()
        monitor.scan_tick()
        inventory = monitor.inventories['project']
        self.assertIsNotNone(inventory.descriptor)
        self.config['roots'] = []
        write_json(self.base / 'config.json', self.config)
        monitor.refresh_config()
        self.assertIsNone(inventory.descriptor)
        self.assertIsNone(monitor.active_root_id)
        self.assertEqual(monitor.inventories, {})

    def test_frontier_path_bytes_exhaustion_releases_memory(self):
        (self.root / 'long-directory-name').mkdir()
        inventory = RootInventory(self.config['roots'][0], self.config['scan'])
        self.addCleanup(inventory.close)
        with patch('root_inventory.MAX_FRONTIER_PATH_BYTES', 4):
            result = inventory.tick()
        self.assertEqual(result['state'], 'partial')
        self.assertTrue(result['limitReached'])
        self.assertEqual(result['errors'][0]['reason'], 'frontier_path_budget_exhausted')
        self.assertEqual(inventory.queued_path_bytes, 0)
        self.assertFalse(inventory.queue)
        self.assertFalse(inventory.seen)
        self.assertIsNone(inventory.descriptor)

    def test_retained_descriptor_stops_after_root_replacement(self):
        (self.root / 'secret').write_bytes(b'not counted')
        budget = dict(self.config['scan'], maxEntriesPerTick=1)
        inventory = RootInventory(self.config['roots'][0], budget)
        self.addCleanup(inventory.close)
        inventory.tick()  # Retain the open root iterator across ticks.
        self.root.rename(self.directory / 'old-root')
        self.root.mkdir()
        result = inventory.tick()
        self.assertEqual(result['state'], 'partial')
        self.assertEqual(result['files'], 0)
        self.assertIsNone(inventory.descriptor)

    def test_error_payloads_remain_bounded_for_many_deep_failures(self):
        inventory = RootInventory(self.config['roots'][0], self.config['scan'])
        self.addCleanup(inventory.close)
        for _ in range(1000):
            inventory._error('denied', ('x' * 255,) * 128)
        result = inventory.snapshot()
        self.assertEqual(result['errorCount'], 1000)
        self.assertEqual(len(result['errors']), MAX_ERRORS)
        self.assertTrue(all(item['pathTruncated'] for item in result['errors']))
        self.assertTrue(all(len(item['relativePath']) <= MAX_ERROR_PATH_CHARS for item in result['errors']))

    def test_invalid_volume_state_and_capacity_never_admit(self):
        status = self.sample()
        for changes in ({'state': 'unavailable'}, {'state': None},
                        {'freeBytes': status['volumes'][0]['totalBytes'] + 1}, {'id': 'wrong-volume'}):
            with self.subTest(changes=changes):
                invalid = copy.deepcopy(status)
                invalid['volumes'][0].update(changes)
                decision = admission(invalid, self.config, 'project', 0, now=1001)
                self.assertFalse(decision['allowed'])
                self.assertEqual(
                    decision['reason'],
                    'unavailable' if changes.get('id') else 'volume_unavailable'
                )

    def test_config_cannot_bypass_registration_overlap_or_path_rules(self):
        for path in (str(self.root / 'child'), str(self.root), str(self.root / '..' / 'elsewhere')):
            with self.subTest(path=path):
                invalid = copy.deepcopy(self.config)
                invalid['roots'].append({**invalid['roots'][0], 'id': 'other', 'path': path})
                with self.assertRaises(ValueError):
                    validate_config(invalid)

    def test_config_identifiers_use_path_free_cloud_id_grammar(self):
        for invalid_id in ('/Users/private', '../root', 'folder/name', 'éclair'):
            with self.subTest(invalid_id=invalid_id):
                invalid = copy.deepcopy(self.config)
                invalid['deviceId'] = invalid_id
                with self.assertRaises(ValueError):
                    validate_config(invalid)

                invalid = copy.deepcopy(self.config)
                invalid['roots'][0]['id'] = invalid_id
                with self.assertRaises(ValueError):
                    validate_config(invalid)

        valid = copy.deepcopy(self.config)
        valid['deviceId'] = 'device.A-1:west'
        valid['roots'][0]['id'] = 'root.A-1:west'
        self.assertIs(validate_config(valid), valid)

    def test_state_fifo_is_rejected_without_waiting_for_writer(self):
        if os.name != 'posix':
            self.skipTest('POSIX FIFO regression')
        fifo = self.base / 'substituted.json'
        os.mkfifo(fifo, 0o600)
        with self.assertRaises(ValueError):
            read_json(fifo)

    def test_entry_and_time_budgets_defer_work(self):
        (self.root / 'file').write_bytes(b'x')
        inventory = RootInventory(self.config['roots'][0], self.config['scan'])
        self.addCleanup(inventory.close)
        result = inventory.tick(max_entries=1)
        self.assertEqual(result['files'], 0)
        self.assertEqual(result['state'], 'scanning')
        with patch('root_inventory.time.monotonic', side_effect=[0, 1]):
            result = inventory.tick(max_seconds=0.001)
        self.assertEqual(result['files'], 0)
        self.assertEqual(result['state'], 'scanning')
