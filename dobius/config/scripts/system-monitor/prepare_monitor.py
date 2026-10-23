#!/usr/bin/env python3
"""Stage private monitor code and render a schedule; never install/start a service."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import shutil
import sys

from monitor_state import default_state_dir, initial_config, private_dir, read_json, validate_config, write_json

MODULES = ['monitor_state.py', 'root_inventory.py', 'storage_policy.py', 'storage_monitor.py']
LABEL = 'com.verlosolutions.dobius.system-monitor'


def systemd_argument(value):
    if '\n' in value or '\r' in value or '\x00' in value:
        raise ValueError('Invalid scheduling argument')
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%').replace('$', '$$') + '"'


def render_schedule(base, python, operating_system):
    arguments = [str(python), str(base / 'code' / 'storage_monitor.py'), '--base', str(base), 'daemon']
    if operating_system == 'darwin':
        document = {'Label': LABEL, 'ProgramArguments': arguments, 'RunAtLoad': True,
                    'KeepAlive': True, 'ThrottleInterval': 30, 'Nice': 10,
                    'LowPriorityIO': True, 'ProcessType': 'Background',
                    'StandardOutPath': str(base / 'scheduler.stdout.log'),
                    'StandardErrorPath': str(base / 'scheduler.stderr.log')}
        return LABEL + '.plist', plistlib.dumps(document)
    if operating_system == 'linux':
        command = ' '.join(systemd_argument(argument) for argument in arguments)
        unit = ('[Unit]\nDescription=Dobius read-only storage monitor\n\n'
                '[Service]\nType=simple\nExecStart=' + command + '\n'
                'Restart=on-failure\nRestartSec=30\nTimeoutStopSec=10\n'
                'UMask=0077\nNice=10\nIOSchedulingClass=idle\n'
                'MemoryMax=192M\nCPUQuota=15%\nNoNewPrivileges=true\n'
                '\n[Install]\nWantedBy=default.target\n')
        return 'dobius-system-monitor.service', unit.encode()
    raise NotImplementedError('Windows automatic scheduling is not implemented; manual sample/status/admit are available')


def prepare(base, device_id, python, operating_system):
    base = private_dir(base)
    code = private_dir(base / 'code')
    for name in MODULES:
        destination = code / name
        if destination.is_symlink():
            raise ValueError('Code destination cannot be a symlink')
        shutil.copyfile(Path(__file__).parent / name, destination)
        os.chmod(destination, 0o600)
    config_path = base / 'config.json'
    config = read_json(config_path)
    if config is None:
        write_json(config_path, validate_config(initial_config(device_id)))
    else:
        validate_config(config)
    result = {'schemaVersion': 1, 'base': str(base), 'scheduleInstalled': False,
              'cleanupEnabled': False, 'cloudPublishingEnabled': False}
    if operating_system not in ('darwin', 'linux'):
        return {**result, 'schedule': None, 'schedulingSupported': False,
                'reason': 'Windows scheduling and descriptor-safe inventory are not implemented'}
    name, content = render_schedule(base, python, operating_system)
    schedule = private_dir(base / 'schedule') / name
    if schedule.is_symlink():
        raise ValueError('Schedule destination cannot be a symlink')
    descriptor = os.open(schedule, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(content)
    os.chmod(schedule, 0o600)
    return {**result, 'schedule': str(schedule), 'schedulingSupported': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', type=Path, default=default_state_dir())
    parser.add_argument('--device-id', required=True)
    parser.add_argument('--python', type=Path, default=Path(sys.executable))
    parser.add_argument('--platform', choices=['darwin', 'linux', 'win32'], default=sys.platform)
    args = parser.parse_args()
    python = args.python.resolve(strict=True)
    if not python.is_file() or not os.access(python, os.X_OK):
        raise ValueError('Python executable is unavailable')
    print(json.dumps(prepare(args.base, args.device_id, python, args.platform)))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError) as error:
        print(json.dumps({'error': str(error)}), file=sys.stderr)
        sys.exit(1)
