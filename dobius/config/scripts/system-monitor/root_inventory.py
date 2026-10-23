"""Incremental, bounded inventory. Totals are observations, never eviction proof."""
from collections import deque
import os
from pathlib import Path
import shutil
import stat
import time

# Count retained path bytes as well as entries: deep frontiers otherwise multiply
# the directory budget by path length. Only one traversal is active per monitor.
MAX_FRONTIER_PATH_BYTES = 2 * 1024 * 1024
MAX_ERRORS = 16
MAX_ERROR_PATH_CHARS = 512


def open_root(root):
    """Open every path component without following a replacement symlink."""
    if os.name != 'posix':
        raise NotImplementedError('Descriptor-safe inventory requires POSIX')
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    descriptor = os.open('/', flags)
    try:
        for part in Path(root['path']).parts[1:]:
            child = os.open(part, flags, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        info = os.fstat(descriptor)
        if (info.st_dev, info.st_ino) != (root['device'], root['inode']):
            raise ValueError('Registered root identity changed; explicit re-registration required')
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def open_relative(root, parts, identity):
    descriptor = open_root(root)
    try:
        for part in parts:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        info = os.fstat(descriptor)
        if info.st_dev != root['device'] or (info.st_dev, info.st_ino) != identity:
            raise ValueError('Directory identity changed')
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def volume_sample(root):
    if os.name == 'posix':
        descriptor = open_root(root)
        try:
            capacity = os.fstatvfs(descriptor)
            block = capacity.f_frsize or capacity.f_bsize
            return {'id': str(root['device']), 'totalBytes': capacity.f_blocks * block,
                    'freeBytes': capacity.f_bavail * block,
                    'usedBytes': (capacity.f_blocks - capacity.f_bfree) * block}
        finally:
            os.close(descriptor)
    path = Path(root['path'])
    for parent in [path, *path.parents]:
        if parent.is_symlink():
            raise ValueError('Root has a symlink component')
    before = path.stat()
    if (before.st_dev, before.st_ino) != (root['device'], root['inode']):
        raise ValueError('Registered root identity changed')
    disk = shutil.disk_usage(path)
    after = path.stat()
    if (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino):
        raise ValueError('Root changed during sample')
    return {'id': str(root['device']), 'totalBytes': disk.total,
            'freeBytes': disk.free, 'usedBytes': disk.used}


class RootInventory:
    def __init__(self, root, budget):
        self.root = root
        self.budget = budget
        self.generation = time.time_ns()
        self.started_at = time.time()
        self.queue = deque([((), (root['device'], root['inode']))])
        self.queued_path_bytes = 0
        self.seen = set()
        self.iterator = None
        self.descriptor = None
        self.parts = ()
        self.logical_bytes = 0
        self.allocated_bytes = 0
        self.files = 0
        self.directories = 1
        self.skipped = {'symlinks': 0, 'mounts': 0, 'specialFiles': 0, 'hardlinks': 0}
        self.errors = []
        self.error_count = 0
        self.finished_at = None
        self.allocated_supported = True
        self.limit_reached = False
        if os.name != 'posix':
            self._error('unsupported_inventory', ())
            self.queue.clear()
            self.finished_at = time.time()

    def _error(self, reason, parts):
        self.error_count += 1
        if len(self.errors) < MAX_ERRORS:
            path = str(Path(*parts))
            self.errors.append({'reason': reason, 'relativePath': path[:MAX_ERROR_PATH_CHARS],
                                'pathTruncated': len(path) > MAX_ERROR_PATH_CHARS})

    def close(self):
        if self.iterator is not None:
            self.iterator.close()
            self.iterator = None
        if self.descriptor is not None:
            os.close(self.descriptor)
            self.descriptor = None

    def stop(self, reason):
        self._error(reason, ())
        self.close()
        self.queue.clear()
        self.queued_path_bytes = 0
        self.finished_at = time.time()
        self.seen.clear()

    def _next_directory(self):
        self.parts, identity = self.queue.popleft()
        self.queued_path_bytes -= sum(len(os.fsencode(part)) + 1 for part in self.parts)
        try:
            self.descriptor = open_relative(self.root, self.parts, identity)
            self.iterator = os.scandir(self.descriptor)
        except (OSError, ValueError):
            self.close()
            self._error('directory_unavailable_or_changed', self.parts)

    def _entry(self, entry):
        parts = self.parts + (entry.name,)
        try:
            info = entry.stat(follow_symlinks=False)
            if stat.S_ISLNK(info.st_mode):
                self.skipped['symlinks'] += 1
            elif info.st_dev != self.root['device']:
                self.skipped['mounts'] += 1
            elif stat.S_ISDIR(info.st_mode):
                if len(parts) > self.budget['maxDepth']:
                    self._error('directory_depth_exhausted', parts)
                    self.limit_reached = True
                elif self.directories >= self.budget['maxDirectories']:
                    self.limit_reached = True
                    self.stop('directory_budget_exhausted')
                else:
                    path_bytes = sum(len(os.fsencode(part)) + 1 for part in parts)
                    if self.queued_path_bytes + path_bytes > MAX_FRONTIER_PATH_BYTES:
                        self.limit_reached = True
                        self.stop('frontier_path_budget_exhausted')
                        return
                    self.queue.append((parts, (info.st_dev, info.st_ino)))
                    self.queued_path_bytes += path_bytes
                    self.directories += 1
            elif stat.S_ISREG(info.st_mode):
                identity = (info.st_dev, info.st_ino)
                if identity in self.seen:
                    self.skipped['hardlinks'] += 1
                elif len(self.seen) >= self.budget['maxInodes']:
                    self.limit_reached = True
                    self.stop('inode_budget_exhausted')
                else:
                    self.seen.add(identity)
                    self.files += 1
                    self.logical_bytes += info.st_size
                    if hasattr(info, 'st_blocks'):
                        self.allocated_bytes += info.st_blocks * 512
                    else:
                        self.allocated_supported = False
            else:
                self.skipped['specialFiles'] += 1
        except OSError:
            self._error('entry_unavailable_or_denied', parts)

    def tick(self, max_entries=None, max_seconds=None):
        if self.finished_at is not None:
            return self.snapshot()
        # A retained scandir descriptor must not continue after the registered
        # path or the current directory has been renamed/replaced between ticks.
        try:
            if self.descriptor is not None:
                info = os.fstat(self.descriptor)
                descriptor = open_relative(self.root, self.parts, (info.st_dev, info.st_ino))
            else:
                descriptor = open_root(self.root)
            os.close(descriptor)
        except (OSError, ValueError):
            self.stop('directory_unavailable_or_changed')
            return self.snapshot()
        started = time.monotonic()
        max_entries = max_entries or self.budget['maxEntriesPerTick']
        max_seconds = max_seconds or self.budget['maxSecondsPerTick']
        work = 0
        while work < max_entries and time.monotonic() - started < max_seconds:
            if self.iterator is None:
                if not self.queue:
                    self.finished_at = time.time()
                    self.seen.clear()
                    break
                self._next_directory()
                work += 1
                continue
            try:
                entry = next(self.iterator)
                self._entry(entry)
            except StopIteration:
                self.close()
            except OSError:
                self._error('directory_read_failed', self.parts)
                self.close()
            work += 1
            if self.finished_at is not None:
                break
        return self.snapshot()

    def snapshot(self):
        state = 'scanning' if self.finished_at is None else ('partial' if self.error_count else 'complete')
        return {'generation': str(self.generation), 'state': state,
                'startedAt': self.started_at, 'finishedAt': self.finished_at,
                'logicalBytes': self.logical_bytes,
                'allocatedBytes': self.allocated_bytes if self.allocated_supported else None,
                'files': self.files, 'directories': self.directories,
                'pendingDirectories': len(self.queue), 'skipped': dict(self.skipped),
                'errorCount': self.error_count, 'errors': list(self.errors),
                'limitReached': self.limit_reached,
                'reclaimableBytes': None, 'consistency': 'live_observation'}
