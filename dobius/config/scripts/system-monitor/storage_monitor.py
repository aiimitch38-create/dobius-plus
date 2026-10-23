#!/usr/bin/env python3
"""Read-only storage monitor. No cleanup, cloud requests, or job execution."""
import argparse
import json
import os
from pathlib import Path
import signal
import sys
import time

from monitor_state import (InstanceLock, default_state_dir, initial_config, private_dir,
                           read_json, register_root, validate_config, write_json)
from root_inventory import RootInventory, volume_sample
from storage_policy import admission, classify, status_freshness, status_shape_is_valid, thresholds


class StorageMonitor:
    def __init__(self, base):
        self.base = private_dir(base)
        self.config = validate_config(read_json(self.base / 'config.json'))
        self.previous = read_json(self.base / 'status.json', {})
        if not status_shape_is_valid(self.previous):
            self.previous = {}
        self.inventories = {}
        self.scan_index = 0
        self.active_root_id = None

    def refresh_config(self):
        self.config = validate_config(read_json(self.base / 'config.json'))
        active = {root['id']: root for root in self.config['roots']}
        for root_id in list(self.inventories):
            inventory = self.inventories[root_id]
            if active.get(root_id) != inventory.root or inventory.budget != self.config['scan']:
                inventory.close()
                del self.inventories[root_id]
        if self.active_root_id not in self.inventories:
            self.active_root_id = None

    def scan_tick(self):
        roots = self.config['roots']
        if not roots:
            return
        # Pin an unfinished scan by ID; config reordering must not retain a
        # second inode set/frontier while the first traversal is still active.
        root = next((root for root in roots if root['id'] == self.active_root_id),
                    roots[self.scan_index % len(roots)])
        inventory = self.inventories.get(root['id'])
        if inventory is None or inventory.finished_at is not None and time.time() - inventory.finished_at >= self.config['scan']['refreshSeconds']:
            if inventory:
                inventory.close()
            inventory = RootInventory(root, self.config['scan'])
            self.inventories[root['id']] = inventory
        self.active_root_id = root['id']
        inventory.tick()
        # Keep only one active traversal so 32 roots cannot multiply the memory budget.
        if inventory.finished_at is not None:
            self.active_root_id = None
            self.scan_index = (roots.index(root) + 1) % len(roots)

    def sample(self, now=None):
        now = time.time() if now is None else now
        self.refresh_config()
        previous_volumes = {volume['id']: volume for volume in self.previous.get('volumes', [])}
        volumes = {}
        roots = []
        alerts = list(self.previous.get('alerts', []))[-199:]
        prior_roots = {root['id']: root for root in self.previous.get('roots', [])}
        for root in self.config['roots']:
            record = {'id': root['id'], 'path': root['path'],
                      'identity': {'device': root['device'], 'inode': root['inode']},
                      'state': 'available', 'volumeId': None}
            try:
                volume = volume_sample(root)
                if volume['id'] != str(root['device']) or volume['totalBytes'] <= 0:
                    raise ValueError('Volume capacity is unavailable')
                record['volumeId'] = volume['id']
                # Multiple registered folders on one volume consume one shared reserve.
                if volume['id'] in volumes:
                    volumes[volume['id']]['freeBytes'] = min(volume['freeBytes'], volumes[volume['id']]['freeBytes'])
                else:
                    volumes[volume['id']] = volume
            except (OSError, ValueError):
                record['state'] = 'unavailable'
                record['reason'] = 'root_unavailable_or_identity_changed'
                if root['id'] in self.inventories:
                    self.inventories[root['id']].stop(record['reason'])
            old = prior_roots.get(root['id'], {}).get('state')
            if old != record['state'] and (old is not None or record['state'] == 'unavailable'):
                alerts.append({'sampledAt': now, 'kind': 'root_state_changed', 'rootId': root['id'],
                               'from': old, 'to': record['state']})
            inventory = self.inventories.get(root['id'])
            record['inventory'] = inventory.snapshot() if inventory else None
            roots.append(record)
        for volume_id, volume in volumes.items():
            old = previous_volumes.get(volume_id, {})
            limits = thresholds(self.config['policy'], volume['totalBytes'])
            state = classify(volume['freeBytes'], limits, old.get('state'))
            history = list(old.get('history', []))[-59:] + [{'sampledAt': now, 'freeBytes': volume['freeBytes']}]
            rate = None
            if len(history) > 1:
                duration = now - history[0]['sampledAt']
                if duration > 0:
                    rate = (volume['freeBytes'] - history[0]['freeBytes']) / duration
            volume.update({'state': state, 'thresholds': limits, 'history': history,
                           'freeBytesPerSecond': rate})
            if old.get('state') != state:
                alerts.append({'sampledAt': now, 'kind': 'space_state_changed', 'volumeId': volume_id,
                               'from': old.get('state'), 'to': state})
        health = 'unconfigured' if not roots else 'healthy'
        if any(root['state'] == 'unavailable' for root in roots):
            health = 'unavailable'
        elif any(volume['state'] == 'critical' for volume in volumes.values()):
            health = 'critical'
        elif any(volume['state'] == 'warning' for volume in volumes.values()):
            health = 'warning'
        status = {'schemaVersion': 1, 'deviceId': self.config['deviceId'], 'sampledAt': now,
                  'freshnessSeconds': self.config['policy']['freshnessSeconds'],
                  'health': health, 'roots': roots, 'volumes': list(volumes.values()),
                  'alerts': alerts[-200:], 'cleanupReceipts': [],
                  'cleanupEnabled': False, 'publisher': 'private_local_file',
                  'platform': sys.platform,
                  'inventorySupported': os.name == 'posix',
                  'topConsumers': sorted(
                      [{'rootId': root['id'], 'logicalBytes': root['inventory']['logicalBytes'],
                        'allocatedBytes': root['inventory']['allocatedBytes'],
                        'state': root['inventory']['state']}
                       for root in roots if root['inventory']],
                      key=lambda root: root['logicalBytes'], reverse=True)}
        write_json(self.base / 'status.json', status)
        self.previous = status
        return status

    def close(self):
        for inventory in self.inventories.values():
            inventory.close()


def daemon(base):
    lock = InstanceLock(base)
    monitor = StorageMonitor(base)
    running = True

    def stop(_signum, _frame):
        nonlocal running
        running = False

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    next_sample = 0
    try:
        while running:
            if time.monotonic() >= next_sample:
                monitor.sample()
                next_sample = time.monotonic() + monitor.config['policy']['sampleSeconds']
            monitor.scan_tick()
            time.sleep(1)
    finally:
        monitor.close()
        lock.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', type=Path, default=default_state_dir())
    commands = parser.add_subparsers(dest='command', required=True)
    init = commands.add_parser('init')
    init.add_argument('--device-id', required=True)
    register = commands.add_parser('register')
    register.add_argument('--id', required=True)
    register.add_argument('--path', required=True)
    commands.add_parser('sample')
    commands.add_parser('daemon')
    commands.add_parser('status')
    admit = commands.add_parser('admit')
    admit.add_argument('--root-id', required=True)
    admit.add_argument('--estimate-bytes', type=int)
    admit.add_argument('--reserved-bytes', type=int, default=0)
    args = parser.parse_args()
    base = private_dir(args.base)
    if args.command == 'daemon':
        daemon(base)
        return
    if args.command == 'status':
        config = validate_config(read_json(base / 'config.json'))
        status = read_json(base / 'status.json', {})
        if not status_shape_is_valid(status):
            print(json.dumps({'schemaVersion': 1, 'deviceId': config['deviceId'],
                              'sampledAt': None, 'freshness': 'unavailable',
                              'health': 'unavailable', 'roots': [], 'volumes': [],
                              'cleanupEnabled': False, 'cleanupReceipts': [],
                              'reason': 'malformed_status'}))
            return 0
        print(json.dumps({**status, 'freshness': status_freshness(status, config['policy']['freshnessSeconds'])}))
        return
    if args.command == 'admit':
        config = validate_config(read_json(base / 'config.json'))
        status = read_json(base / 'status.json', {})
        decision = admission(status, config, args.root_id, args.estimate_bytes, args.reserved_bytes)
        print(json.dumps(decision))
        return 0 if decision['allowed'] else 2
    lock = InstanceLock(base)
    try:
        if args.command == 'init':
            if (base / 'config.json').exists():
                raise ValueError('Configuration already exists; no replacement performed')
            write_json(base / 'config.json', validate_config(initial_config(args.device_id)))
            result = {'schemaVersion': 1, 'initialized': True, 'roots': [], 'cleanupEnabled': False}
        elif args.command == 'register':
            config = validate_config(read_json(base / 'config.json'))
            write_json(base / 'config.json', register_root(config, args.id, args.path))
            result = {'registered': args.id, 'cleanupEnabled': False}
        else:
            monitor = StorageMonitor(base)
            try:
                monitor.scan_tick()
                result = monitor.sample()
            finally:
                monitor.close()
        print(json.dumps(result))
    finally:
        lock.close()
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError, TypeError) as error:
        print(json.dumps({'schemaVersion': 1, 'error': type(error).__name__, 'message': str(error)}), file=sys.stderr)
        sys.exit(1)
