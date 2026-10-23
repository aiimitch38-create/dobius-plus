"""Bounded ASAR capability inspection and descriptor-pinned resource reads."""
import errno
import json
import os
import stat
import struct

MAX_ASAR_HEADER_BYTES = 16 * 1024 * 1024
MAX_MAIN_GRAPH_NODES = 4096
MAX_MAIN_JS_FILES = 1024
MAX_MAIN_JS_FILE_BYTES = 16 * 1024 * 1024
MAX_MAIN_JS_TOTAL_BYTES = 64 * 1024 * 1024
MAX_RESOURCE_BYTES = 16 * 1024 * 1024
CATALOG_RPC_CAPABILITIES = (b"data.catalog.roots", b"data.catalog.page")
ADAM_GATEWAY_CAPABILITIES = (b"dobius_adam_telegram", b"bridge_runner.py")
_DIRECTORY_FLAGS = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
_FILE_FLAGS = (
    os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
)


def _relative_parts(relative_path):
    if not isinstance(relative_path, str) or not relative_path or os.path.isabs(relative_path):
        raise ValueError("resource path must be relative")
    parts = relative_path.split(os.sep)
    if any(part in ("", ".", "..") for part in parts):
        raise ValueError("resource path contains an unsafe component")
    return parts


def _open_regular_beneath(root, relative_path):
    """Open a file through pinned, no-follow directory descriptors."""
    if not all(hasattr(os, flag) for flag in ("O_DIRECTORY", "O_NOFOLLOW", "O_NONBLOCK")):
        raise OSError(errno.ENOTSUP, "safe nonblocking directory-relative opens are unavailable")
    parts = _relative_parts(relative_path)
    directory_fd = os.open(root, _DIRECTORY_FLAGS)
    owned_directories = [directory_fd]
    file_fd = None
    try:
        for part in parts[:-1]:
            directory_fd = os.open(part, _DIRECTORY_FLAGS, dir_fd=directory_fd)
            owned_directories.append(directory_fd)
        file_fd = os.open(parts[-1], _FILE_FLAGS, dir_fd=directory_fd)
        info = os.fstat(file_fd)
        if not stat.S_ISREG(info.st_mode):
            raise OSError(errno.EINVAL, "resource is not a regular file")
        return file_fd, info
    except BaseException:
        if file_fd is not None:
            os.close(file_fd)
        raise
    finally:
        for descriptor in reversed(owned_directories):
            os.close(descriptor)


def read_regular_beneath(root, relative_path, max_bytes, expected_size=None):
    """Return bounded regular-file bytes or None, never following a path symlink."""
    try:
        descriptor, before = _open_regular_beneath(root, relative_path)
    except (OSError, ValueError):
        return None
    try:
        if before.st_size <= 0 or before.st_size > max_bytes:
            return None
        if expected_size is not None and before.st_size != expected_size:
            return None
        chunks = []
        total = 0
        while total <= max_bytes:
            chunk = os.read(descriptor, min(1024 * 1024, max_bytes + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
        after = os.fstat(descriptor)
        before_identity = (
            before.st_dev,
            before.st_ino,
            before.st_size,
            before.st_mtime_ns,
            before.st_ctime_ns,
        )
        after_identity = (
            after.st_dev,
            after.st_ino,
            after.st_size,
            after.st_mtime_ns,
            after.st_ctime_ns,
        )
        data = b"".join(chunks)
        if before_identity != after_identity or len(data) != before.st_size or len(data) > max_bytes:
            return None
        return data
    except OSError:
        return None
    finally:
        os.close(descriptor)


def regular_resource_status(root, relative_path, max_bytes=MAX_RESOURCE_BYTES):
    """Return (present, valid); unsafe or inaccessible paths count as present-invalid."""
    try:
        descriptor, _info = _open_regular_beneath(root, relative_path)
    except FileNotFoundError:
        return False, False
    except OSError as error:
        if error.errno == errno.ENOENT:
            return False, False
        return True, False
    except ValueError:
        return True, False
    try:
        info = os.fstat(descriptor)
        valid = stat.S_ISREG(info.st_mode) and 0 < info.st_size <= max_bytes
        if valid:
            valid = os.read(descriptor, 1) != b""
            after = os.fstat(descriptor)
            before_identity = (
                info.st_dev,
                info.st_ino,
                info.st_size,
                info.st_mtime_ns,
                info.st_ctime_ns,
            )
            after_identity = (
                after.st_dev,
                after.st_ino,
                after.st_size,
                after.st_mtime_ns,
                after.st_ctime_ns,
            )
            valid = valid and before_identity == after_identity
        return True, valid
    except OSError:
        return True, False
    finally:
        os.close(descriptor)


def _descriptor_identity(descriptor):
    info = os.fstat(descriptor)
    return (
        info.st_dev,
        info.st_ino,
        info.st_mode,
        info.st_size,
        info.st_mtime_ns,
        info.st_ctime_ns,
    )


def _verify_descriptor_identity(descriptor, expected, description):
    actual = _descriptor_identity(descriptor)
    if not stat.S_ISREG(actual[2]) or actual != expected:
        raise ValueError(description + " changed or is not a regular file")


def read_asar_header(bundle_root):
    """Return header metadata and an open pinned ASAR fd; caller must close the fd."""
    relative_path = os.path.join("Contents", "Resources", "app.asar")
    descriptor, initial = _open_regular_beneath(bundle_root, relative_path)
    try:
        archive_size = initial.st_size
        if archive_size < 8:
            raise ValueError("too short to be an asar archive")
        prefix = os.pread(descriptor, 8, 0)
        if len(prefix) != 8:
            raise ValueError("too short to be an asar archive")
        size_payload, header_size = struct.unpack("<II", prefix)
        if (
            size_payload != 4
            or header_size < 8
            or header_size > MAX_ASAR_HEADER_BYTES
            or 8 + header_size > archive_size
        ):
            raise ValueError("not an asar archive (bad size header)")
        header = os.pread(descriptor, header_size, 8)
        if len(header) != header_size:
            raise ValueError("truncated asar header")
        string_length = struct.unpack("<I", header[4:8])[0]
        if 8 + string_length > header_size:
            raise ValueError("not an asar archive (bad header string length)")
        parsed = json.loads(header[8 : 8 + string_length].decode("utf-8"))
        if not isinstance(parsed, dict) or not isinstance(parsed.get("files"), dict):
            raise ValueError("malformed asar root header")
        identity = _descriptor_identity(descriptor)
        if not stat.S_ISREG(identity[2]) or identity != (
            initial.st_dev,
            initial.st_ino,
            initial.st_mode,
            initial.st_size,
            initial.st_mtime_ns,
            initial.st_ctime_ns,
        ):
            raise ValueError("app.asar changed while its header was read")
        return parsed, 8 + header_size, archive_size, descriptor, identity
    except BaseException:
        os.close(descriptor)
        raise


def asar_entry(header, relative_path):
    node = header
    for part in relative_path.split("/"):
        children = node.get("files") if isinstance(node, dict) else None
        if not isinstance(children, dict) or part not in children:
            return None
        node = children[part]
    return node


def asar_entry_ok(entry, data_offset, archive_size):
    if not isinstance(entry, dict) or "files" in entry:
        return False
    entry_size = entry.get("size")
    if not isinstance(entry_size, int) or isinstance(entry_size, bool) or entry_size <= 0:
        return False
    if entry.get("unpacked") is True:
        return True
    offset_value = entry.get("offset")
    if not isinstance(offset_value, str) or not offset_value.isdigit():
        return False
    return data_offset + int(offset_value) + entry_size <= archive_size


def _asar_file_bytes(
    bundle_root, entry, relative_path, data_offset, archive_size, asar_fd, asar_identity
):
    if not isinstance(entry, dict) or "files" in entry:
        raise ValueError("malformed file entry: " + relative_path)
    entry_size = entry.get("size")
    if not isinstance(entry_size, int) or isinstance(entry_size, bool) or entry_size <= 0:
        raise ValueError("invalid size for " + relative_path)
    if entry_size > MAX_MAIN_JS_FILE_BYTES:
        raise ValueError("main JavaScript entry exceeds size limit: " + relative_path)
    if entry.get("unpacked") is True:
        data = read_regular_beneath(
            bundle_root,
            os.path.join(
                "Contents", "Resources", "app.asar.unpacked", "out", "main", relative_path
            ),
            MAX_MAIN_JS_FILE_BYTES,
            expected_size=entry_size,
        )
        if data is None:
            raise ValueError("unreadable or unsafe unpacked entry: " + relative_path)
        return data
    offset_value = entry.get("offset")
    if not isinstance(offset_value, str) or not offset_value.isdigit():
        raise ValueError("invalid offset for " + relative_path)
    start = data_offset + int(offset_value)
    end = start + entry_size
    if end < start or end > archive_size:
        raise ValueError("out-of-range entry: " + relative_path)
    _verify_descriptor_identity(asar_fd, asar_identity, "app.asar")
    data = os.pread(asar_fd, entry_size, start)
    if len(data) != entry_size:
        raise ValueError("truncated entry: " + relative_path)
    _verify_descriptor_identity(asar_fd, asar_identity, "app.asar")
    return data


def _main_js_entries(node, relative_path="", budget=None, count_current=True):
    if budget is None:
        budget = {"nodes": 0, "files": 0}
    if count_current:
        budget["nodes"] += 1
        if budget["nodes"] > MAX_MAIN_GRAPH_NODES:
            raise ValueError("oversized out/main graph")
    if not isinstance(node, dict) or not isinstance(node.get("files"), dict):
        raise ValueError("malformed out/main directory: " + (relative_path or "<root>"))
    found = []
    for name, child in node["files"].items():
        budget["nodes"] += 1
        if budget["nodes"] > MAX_MAIN_GRAPH_NODES:
            raise ValueError("oversized out/main graph")
        if (
            not isinstance(name, str)
            or not name
            or name in (".", "..")
            or "/" in name
            or "\\" in name
        ):
            raise ValueError("malformed out/main entry name")
        child_path = name if not relative_path else relative_path + "/" + name
        if isinstance(child, dict) and "files" in child:
            found.extend(_main_js_entries(child, child_path, budget, count_current=False))
            continue
        if not isinstance(child, dict):
            raise ValueError("malformed out/main file entry: " + child_path)
        if child_path.lower().endswith((".js", ".cjs", ".mjs")):
            budget["files"] += 1
            if budget["files"] > MAX_MAIN_JS_FILES:
                raise ValueError("too many JavaScript files in out/main")
            found.append((child_path, child))
    return found


def _unpacked_main_js_files(bundle_root):
    """List bounded JavaScript paths under the unpacked main tree without following links."""
    if not hasattr(os, "O_DIRECTORY") or not hasattr(os, "O_NOFOLLOW"):
        raise ValueError("safe directory-relative opens are unavailable")
    try:
        directory_fd = os.open(bundle_root, _DIRECTORY_FLAGS)
        for part in ("Contents", "Resources", "app.asar.unpacked", "out", "main"):
            try:
                next_fd = os.open(part, _DIRECTORY_FLAGS, dir_fd=directory_fd)
            except FileNotFoundError:
                os.close(directory_fd)
                return []
            except OSError:
                os.close(directory_fd)
                raise
            os.close(directory_fd)
            directory_fd = next_fd
    except OSError as error:
        raise ValueError("unsafe unpacked out/main directory: " + str(error)) from error
    files = []
    stack = [(directory_fd, "")]
    nodes = 0
    try:
        while stack:
            current_fd, relative = stack.pop()
            try:
                for name in os.listdir(current_fd):
                    nodes += 1
                    if nodes > MAX_MAIN_GRAPH_NODES:
                        raise ValueError("oversized unpacked out/main graph")
                    child_relative = name if not relative else relative + "/" + name
                    info = os.stat(name, dir_fd=current_fd, follow_symlinks=False)
                    if stat.S_ISLNK(info.st_mode):
                        raise ValueError("symlink in unpacked out/main: " + child_relative)
                    if stat.S_ISDIR(info.st_mode):
                        child_fd = os.open(name, _DIRECTORY_FLAGS, dir_fd=current_fd)
                        stack.append((child_fd, child_relative))
                    elif stat.S_ISREG(info.st_mode) and child_relative.lower().endswith(
                        (".js", ".cjs", ".mjs")
                    ):
                        files.append(child_relative)
                        if len(files) > MAX_MAIN_JS_FILES:
                            raise ValueError("too many unpacked JavaScript files in out/main")
                    elif not stat.S_ISREG(info.st_mode):
                        raise ValueError("non-regular entry in unpacked out/main: " + child_relative)
            finally:
                os.close(current_fd)
    except OSError as error:
        for descriptor, _relative in stack:
            try:
                os.close(descriptor)
            except OSError:
                pass
        raise ValueError("cannot inspect unpacked out/main: " + str(error)) from error
    except BaseException:
        for descriptor, _relative in stack:
            try:
                os.close(descriptor)
            except OSError:
                pass
        raise
    return files


def _main_capability(bundle, header, data_offset, archive_size, asar_fd, asar_identity, capabilities):
    """Return (enabled, error) after bounded inspection of packed and unpacked main JS."""
    try:
        main = asar_entry(header, "out/main")
        if not isinstance(main, dict) or not isinstance(main.get("files"), dict):
            raise ValueError("missing or malformed out/main directory")
        entries = _main_js_entries(main)
        total_bytes = 0
        capability_found = False
        inspected_unpacked = set()
        for relative_path, entry in entries:
            data = _asar_file_bytes(
                bundle,
                entry,
                relative_path,
                data_offset,
                archive_size,
                asar_fd,
                asar_identity,
            )
            total_bytes += len(data)
            if total_bytes > MAX_MAIN_JS_TOTAL_BYTES:
                raise ValueError("out/main JavaScript exceeds total size limit")
            data.decode("utf-8")
            capability_found = capability_found or any(
                capability in data for capability in capabilities
            )
            if entry.get("unpacked") is True:
                inspected_unpacked.add(relative_path)

        for relative_path in _unpacked_main_js_files(bundle):
            if relative_path in inspected_unpacked:
                continue
            data = read_regular_beneath(
                bundle,
                os.path.join(
                    "Contents",
                    "Resources",
                    "app.asar.unpacked",
                    "out",
                    "main",
                    relative_path,
                ),
                MAX_MAIN_JS_FILE_BYTES,
            )
            if data is None:
                raise ValueError("unreadable or unsafe unpacked entry: " + relative_path)
            total_bytes += len(data)
            if total_bytes > MAX_MAIN_JS_TOTAL_BYTES:
                raise ValueError("out/main JavaScript exceeds total size limit")
            data.decode("utf-8")
            capability_found = capability_found or any(
                capability in data for capability in capabilities
            )
        return capability_found, None
    except (OSError, ValueError, UnicodeDecodeError, RecursionError) as error:
        return False, str(error)


def catalog_capability(bundle, header, data_offset, archive_size, asar_fd, asar_identity):
    return _main_capability(
        bundle, header, data_offset, archive_size, asar_fd, asar_identity, CATALOG_RPC_CAPABILITIES
    )


def adam_gateway_capability(bundle, header, data_offset, archive_size, asar_fd, asar_identity):
    return _main_capability(
        bundle, header, data_offset, archive_size, asar_fd, asar_identity, ADAM_GATEWAY_CAPABILITIES
    )
