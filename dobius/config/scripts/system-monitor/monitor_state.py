"""Private, versioned state for the read-only workstation monitor."""
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile

SCHEMA_VERSION = 1
GIB = 1024 ** 3
MAX_JSON_BYTES = 2 * 1024 * 1024
CLOUD_ID_PATTERN = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')
MAX_SAFE_INTEGER = 2 ** 53 - 1


def is_cloud_id(value):
    """Cloud IDs are portable metadata tokens, never paths or arbitrary labels."""
    return isinstance(value, str) and CLOUD_ID_PATTERN.fullmatch(value) is not None


def is_canonical_volume_id(value):
    if not isinstance(value, str) or not value.isascii() or not value.isdecimal():
        return False
    try:
        device = int(value)
    except ValueError:
        return False
    return 0 <= device <= MAX_SAFE_INTEGER and str(device) == value


def default_state_dir():
    if sys.platform == 'darwin':
        return Path.home() / 'Library' / 'Application Support' / 'Dobius System Monitor'
    if sys.platform == 'win32':
        return Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'Dobius' / 'System Monitor'
    return Path(os.environ.get('XDG_STATE_HOME', str(Path.home() / '.local' / 'state'))) / 'dobius-system-monitor'


def private_dir(path):
    path = Path(path).absolute()
    # Reject redirected state directories, including a substituted parent folder.
    for parent in [path, *path.parents]:
        if parent.is_symlink():
            raise ValueError('State directory cannot contain symlinks')
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.stat()
    if not stat.S_ISDIR(info.st_mode):
        raise ValueError('State path is not a directory')
    if hasattr(os, 'getuid') and info.st_uid != os.getuid():
        raise ValueError('State directory is owned by another user')
    os.chmod(path, 0o700)
    return path


def read_json(path, missing=None):
    path = Path(path)
    if path.is_symlink():
        raise ValueError('State file cannot be a symlink')
    # A substituted FIFO must fail validation rather than block the daemon.
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0)
    try:
        descriptor = os.open(path, flags)
    except FileNotFoundError:
        return missing
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_JSON_BYTES:
            raise ValueError('State file is not a bounded regular file')
        if hasattr(os, 'getuid') and (info.st_uid != os.getuid() or info.st_mode & 0o077):
            raise ValueError('State file must be private and owned by this user')
        return json.loads(stream.read(MAX_JSON_BYTES + 1))


def write_json(path, payload):
    path = Path(path)
    directory = private_dir(path.parent)
    encoded = (json.dumps(payload, indent=2, sort_keys=True) + '\n').encode()
    if len(encoded) > MAX_JSON_BYTES:
        raise ValueError('State exceeds the configured size limit')
    descriptor, temporary = tempfile.mkstemp(prefix='.' + path.name, dir=directory)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            os.chmod(temporary, 0o600)
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        if os.name == 'posix':
            folder = os.open(directory, os.O_RDONLY)
            try:
                os.fsync(folder)
            finally:
                os.close(folder)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def initial_config(device_id):
    return {
        'schemaVersion': SCHEMA_VERSION, 'deviceId': device_id, 'roots': [],
        'policy': {'sampleSeconds': 60, 'freshnessSeconds': 180,
                   'warnBytes': 20 * GIB, 'warnFraction': 0.15,
                   'criticalBytes': 10 * GIB, 'criticalFraction': 0.08,
                   'hysteresisBytes': 2 * GIB, 'hysteresisFraction': 0.02,
                   'safetyMarginBytes': 5 * GIB, 'unknownEstimateBytes': 20 * GIB},
        'scan': {'maxEntriesPerTick': 2500, 'maxSecondsPerTick': 0.1,
                 'maxDirectories': 10000, 'maxInodes': 50000, 'maxDepth': 64,
                 'refreshSeconds': 900},
    }


def validate_config(config):
    if not isinstance(config, dict) or config.get('schemaVersion') != SCHEMA_VERSION:
        raise ValueError('Unsupported monitor config schema')
    if not is_cloud_id(config.get('deviceId')):
        raise ValueError('Device ID must use the path-free CloudId grammar')
    roots = config.get('roots')
    if not isinstance(roots, list) or len(roots) > 32:
        raise ValueError('At most 32 registered roots are allowed')
    ids = set()
    paths = []
    for root in roots:
        if not isinstance(root, dict) or not is_cloud_id(root.get('id')) or root['id'] in ids:
            raise ValueError('Root IDs must be unique nonempty strings')
        if len(root['id']) > 128 or not isinstance(root.get('path'), str) or len(root['path']) > 4096 or not Path(root['path']).is_absolute():
            raise ValueError('Registered roots require absolute paths')
        path = Path(root['path'])
        if '..' in path.parts or str(path) != root['path'] or '\x00' in root['path']:
            raise ValueError('Registered roots require normalized paths')
        if any(path == other or path in other.parents or other in path.parents for other in paths):
            raise ValueError('Registered roots cannot overlap')
        paths.append(path)
        for key in ('device', 'inode'):
            if type(root.get(key)) is not int or not 0 <= root[key] <= MAX_SAFE_INTEGER:
                raise ValueError('Root identity is required')
        ids.add(root['id'])
    policy = config.get('policy', {})
    if not isinstance(policy, dict):
        raise ValueError('Policy must be an object')
    for key in ('warnBytes', 'criticalBytes', 'hysteresisBytes', 'safetyMarginBytes', 'unknownEstimateBytes'):
        if type(policy.get(key)) is not int or policy[key] < 0:
            raise ValueError('Invalid byte policy: ' + key)
    for key in ('warnFraction', 'criticalFraction', 'hysteresisFraction'):
        if type(policy.get(key)) not in (int, float) or not 0 <= policy[key] <= 1:
            raise ValueError('Invalid fractional policy: ' + key)
    if policy['criticalBytes'] > policy['warnBytes'] or policy['criticalFraction'] > policy['warnFraction']:
        raise ValueError('Critical thresholds must not exceed warning thresholds')
    for key, minimum, maximum in (('sampleSeconds', 10, 3600), ('freshnessSeconds', 10, 86400)):
        if type(policy.get(key)) is not int or not minimum <= policy[key] <= maximum:
            raise ValueError('Invalid timing policy: ' + key)
    if policy['freshnessSeconds'] < policy['sampleSeconds']:
        raise ValueError('Freshness must cover at least one sampling interval')
    scan = config.get('scan', {})
    if not isinstance(scan, dict):
        raise ValueError('Scan budget must be an object')
    for key, minimum, maximum in (('maxEntriesPerTick', 1, 10000), ('maxDirectories', 1, 10000),
                                  ('maxInodes', 1, 50000), ('maxDepth', 1, 128), ('refreshSeconds', 60, 86400)):
        if type(scan.get(key)) is not int or not minimum <= scan[key] <= maximum:
            raise ValueError('Invalid scan budget: ' + key)
    seconds = scan.get('maxSecondsPerTick')
    if type(seconds) not in (int, float) or not 0.001 <= seconds <= 1:
        raise ValueError('Scan time budget must be between .001 and 1 second')
    return config


def register_root(config, root_id, path):
    supplied = Path(path).absolute()
    for parent in [supplied, *supplied.parents]:
        if parent.is_symlink():
            raise ValueError('Registered roots cannot contain symlinks')
    resolved = supplied.resolve(strict=True)
    info = resolved.stat()
    if not stat.S_ISDIR(info.st_mode):
        raise ValueError('Registered root must be a directory')
    for existing in config['roots']:
        other = Path(existing['path'])
        if resolved == other or resolved in other.parents or other in resolved.parents:
            raise ValueError('Registered roots cannot overlap')
    config['roots'].append({'id': root_id, 'path': str(resolved), 'device': info.st_dev, 'inode': info.st_ino})
    return validate_config(config)


class InstanceLock:
    """An OS-held lock prevents daemon and manual samples from clobbering state."""
    def __init__(self, directory):
        path = private_dir(directory) / 'monitor.lock'
        self.fd = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0), 0o600)
        try:
            if os.name == 'nt':
                import msvcrt
                os.write(self.fd, b'0')
                os.lseek(self.fd, 0, os.SEEK_SET)
                msvcrt.locking(self.fd, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            os.close(self.fd)
            raise RuntimeError('Another monitor instance is already running') from None

    def close(self):
        os.close(self.fd)
