import fcntl
import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch
import test_backup_runner
import settings_bridge
from backup_config import ConfigurationError, atomic_json, read_json
from restic_process import BackupFailure


class SettingsBridgeTests(unittest.TestCase):
    def setUp(self):
        test_backup_runner.BackupRegressionTests.setUp(self)
        (self.base / 'secrets').mkdir()
        self.credentials = self.base / 'secrets/aws.json'
        atomic_json(self.credentials, {'access_key_id': 'previous-key', 'secret_access_key': 'previous-secret'})
        self.config.update(repository='s3:https://s3.us-east-1.amazonaws.com/old-bucket/test', test_local_repository=False, credentials_file=str(self.credentials))
        atomic_json(self.base / 'config.json', self.config)
        self.input = {'bucket': 'dobius-test-backups', 'region': 'us-east-1', 'accessKeyId': 'new-access-key', 'secretAccessKey': 'new-secret-key'}

    def test_rejected_aws_connection_preserves_working_destination_and_credentials(self):
        previous_config = (self.base / 'config.json').read_bytes()
        previous_keys = self.credentials.read_bytes()
        with patch('settings_bridge.run_restic', side_effect=BackupFailure('Access denied')):
            with self.assertRaises(BackupFailure):
                settings_bridge.connect(self.base, self.input, self.config)
        self.assertEqual(previous_config, (self.base / 'config.json').read_bytes())
        self.assertEqual(previous_keys, self.credentials.read_bytes())
        self.assertEqual(list((self.base / 'secrets').glob('aws.pending-*')), [])

    def test_connection_enables_schedule_and_performs_verified_backup(self):
        atomic_json(self.state / 'status.json', {'health': 'healthy', 'last_backup_at': 'old-destination-date'})
        with patch('settings_bridge.run_restic') as restic, patch('settings_bridge.install_launch_agent') as mac, patch('settings_bridge.install_systemd') as linux, patch('settings_bridge.tick', return_value={'health': 'healthy'}) as tick:
            result = settings_bridge.connect(self.base, self.input, self.config)
        restic.assert_called_once()
        self.assertEqual(result['health'], 'healthy')
        self.assertLessEqual(mac.call_count + linux.call_count, 1)
        saved = read_json(self.base / 'config.json')
        self.assertTrue(saved['enabled'])
        self.assertIn('/dobius-test-backups/test', saved['repository'])
        self.assertNotIn('last_backup_at', read_json(self.state / 'status.json'))
        self.assertEqual(read_json(self.credentials)['secret_access_key'], 'new-secret-key')
        self.assertEqual(self.credentials.stat().st_mode & 0o777, 0o600)
        tick.assert_called_once_with(saved, force=True, notify=False)

    def test_new_repository_initializes_after_probe_and_still_requires_backup(self):
        with patch('settings_bridge.run_restic', side_effect=[BackupFailure('Repository not found'), None]) as restic, patch('settings_bridge.install_launch_agent'), patch('settings_bridge.install_systemd'), patch('settings_bridge.tick', return_value={'health': 'failed', 'detail': 'Restore failed'}):
            result = settings_bridge.connect(self.base, self.input, self.config)
        self.assertEqual([call.args[2][0] for call in restic.call_args_list], ['snapshots', 'init'])
        self.assertEqual(result['health'], 'failed')

    def test_connection_rejected_during_running_backup_without_replacing_credentials(self):
        with (self.state / 'job.lock').open('w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with patch('settings_bridge.run_restic') as restic:
                with self.assertRaisesRegex(ConfigurationError, 'already running'):
                    settings_bridge.connect(self.base, self.input, self.config)
        restic.assert_not_called()
        self.assertEqual(read_json(self.credentials)['access_key_id'], 'previous-key')
        self.assertEqual(list((self.base / 'secrets').glob('aws.pending-*')), [])

    def test_validation_refuses_urls_missing_keys_control_characters_and_invalid_buckets(self):
        for updates in [{'bucket': 'https://bucket'}, {'bucket': '127.0.0.1'}, {'bucket': 'bad..bucket'}, {'region': 'cn-north-1'}, {'secretAccessKey': ''}, {'accessKeyId': 'secret\nline'}]:
            with self.subTest(updates=updates):
                with self.assertRaises(ConfigurationError) as failure:
                    settings_bridge.validate_input({**self.input, **updates})
                self.assertNotIn('secret\nline', str(failure.exception))

    def test_paused_schedule_does_not_run_backup_or_prune(self):
        self.config['enabled'] = False
        with patch('backup_runner.run_restic') as restic:
            result = test_backup_runner.backup_runner.tick(self.config, force=True, notify=False)
        self.assertEqual(result['health'], 'paused')
        restic.assert_not_called()

    def test_tick_reloads_pause_after_waiting_for_job_lock(self):
        self.config['configuration_file'] = str(self.base / 'config.json')
        atomic_json(self.base / 'config.json', {**self.config, 'enabled': False})
        with patch('backup_runner.run_restic') as restic:
            result = test_backup_runner.backup_runner.tick(self.config, notify=False)
        self.assertEqual(result['health'], 'paused')
        restic.assert_not_called()


if __name__ == '__main__':
    unittest.main()
