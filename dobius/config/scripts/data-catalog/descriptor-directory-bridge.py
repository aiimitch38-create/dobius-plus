#!/usr/bin/env python3
"""Descriptor-relative, metadata-only filesystem bridge for the catalog scanner."""

from __future__ import annotations

import importlib.util
import base64
import hashlib
import json
import os
import stat
import struct
import sys
from dataclasses import dataclass
from typing import Any

_native_identity_path = os.path.join(os.path.dirname(os.path.realpath(__file__)), "native-root-identity.py")
_native_identity_spec = importlib.util.spec_from_file_location(
    "dobius_data_catalog_native_root_identity", _native_identity_path
)
if _native_identity_spec is None or _native_identity_spec.loader is None:
    raise RuntimeError("native identity provider is unavailable")
_native_identity_module = importlib.util.module_from_spec(_native_identity_spec)
_native_identity_spec.loader.exec_module(_native_identity_module)
root_identity_from_fd = _native_identity_module.root_identity_from_fd
NativeRootIdentityError = _native_identity_module.NativeRootIdentityError

MAX_REQUEST_BYTES = 64 * 1024
MAX_RESPONSE_BYTES = 64 * 1024
MAX_HANDLES = 256
MAX_DEPTH = 64
MAX_PATH_BYTES = 4096
MAX_NAME_BYTES = 255
MAX_PREVIEW_FILE_BYTES = 256 * 1024
MAX_PREVIEW_CHUNK_BYTES = 16 * 1024
MAX_U64 = (1 << 64) - 1
PREVIEW_VERSION_DOMAIN = b"dobius:data-catalog:preview-stat:v1\0"
DIRECTORY_FLAGS = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
DIRECTORY_FLAGS |= getattr(os, "O_CLOEXEC", 0)
PREVIEW_FILE_FLAGS = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
PREVIEW_FILE_FLAGS |= getattr(os, "O_CLOEXEC", 0)


class ProtocolError(Exception):
    pass


@dataclass
class DirectoryHandle:
    fd: int
    identity: dict[str, str]
    root_identity: dict[str, Any]
    depth: int
    parent_id: str | None
    component: str | None
    root_path: str | None
    iterator: Any = None
    exhausted: bool = False


def supports_required_posix_operations() -> bool:
    return (
        os.name == "posix"
        and hasattr(os, "O_DIRECTORY")
        and hasattr(os, "O_NOFOLLOW")
        and hasattr(os, "O_NONBLOCK")
        and hasattr(os, "pread")
        and os.open in os.supports_dir_fd
        and os.stat in os.supports_dir_fd
        and os.stat in os.supports_follow_symlinks
        and os.scandir in os.supports_fd
    )


def identity_from_stat(info: os.stat_result) -> dict[str, str]:
    return {"dev": str(info.st_dev), "ino": str(info.st_ino)}


def identity_matches(left: dict[str, str], right: dict[str, str]) -> bool:
    return left.get("dev") == right.get("dev") and left.get("ino") == right.get("ino")


def _canonical_decimal(value: Any, allow_zero: bool = True) -> bool:
    if not isinstance(value, str) or not value or not value.isascii() or not value.isdecimal():
        return False
    if len(value) > 1 and value.startswith("0"):
        return False
    return allow_zero or value != "0"


def validate_root_identity(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) not in (
        {"dev", "ino", "incarnation"},
        {"dev", "ino", "birthtimeNs", "incarnation"},
    ):
        raise ProtocolError("invalid_root_identity")
    for key in ("dev", "ino"):
        raw = value.get(key)
        if not isinstance(raw, str) or len(raw) > 64 or not _canonical_decimal(raw):
            raise ProtocolError("invalid_root_identity")
    if "birthtimeNs" in value:
        raw = value["birthtimeNs"]
        if not isinstance(raw, str) or len(raw) > 128 or not _canonical_decimal(raw):
            raise ProtocolError("invalid_root_identity")
    incarnation = value["incarnation"]
    if not isinstance(incarnation, dict) or set(incarnation) != {"provider", "scope", "token"}:
        raise ProtocolError("invalid_root_identity")
    provider = incarnation["provider"]
    scope = incarnation["scope"]
    token = incarnation["token"]
    if not isinstance(scope, str) or not isinstance(token, str):
        raise ProtocolError("invalid_root_identity")
    if provider == "linux-inode-generation-v1":
        if len(scope) != 16 or any(char not in "0123456789abcdef" for char in scope):
            raise ProtocolError("invalid_root_identity")
        if not _canonical_decimal(token, allow_zero=False) or len(token) > 10 or int(token) > 0xFFFFFFFF:
            raise ProtocolError("invalid_root_identity")
    elif provider == "darwin-apfs-file-id-v1":
        if len(scope) != 32 or any(char not in "0123456789abcdef" for char in scope):
            raise ProtocolError("invalid_root_identity")
        if not _canonical_decimal(token, allow_zero=False) or len(token) > 20 or int(token) > 0xFFFFFFFFFFFFFFFF:
            raise ProtocolError("invalid_root_identity")
    else:
        raise ProtocolError("unsupported_identity_provider")
    return value


def root_identity_matches(left: dict[str, Any], right: dict[str, Any]) -> bool:
    return (
        identity_matches(left, right)
        and left.get("incarnation") == right.get("incarnation")
    )


def validate_identity(value: Any) -> dict[str, str]:
    if not isinstance(value, dict) or set(value) != {"dev", "ino"}:
        raise ProtocolError("invalid_identity")
    if any(not isinstance(value[key], str) or not value[key].isdigit() for key in ("dev", "ino")):
        raise ProtocolError("invalid_identity")
    if any(len(value[key]) > 64 for key in ("dev", "ino")):
        raise ProtocolError("invalid_identity")
    return value


def validate_path(value: Any) -> tuple[str, list[str]]:
    if not isinstance(value, str) or not value or "\0" in value:
        raise ProtocolError("invalid_path")
    try:
        encoded = value.encode("utf-8", "strict")
    except UnicodeEncodeError as error:
        raise ProtocolError("invalid_path") from error
    if len(encoded) > MAX_PATH_BYTES or not value.startswith("/"):
        raise ProtocolError("invalid_path")
    if value != "/" and (value.endswith("/") or "//" in value):
        raise ProtocolError("invalid_path")
    components = [] if value == "/" else value.split("/")[1:]
    if any(component in ("", ".", "..") for component in components):
        raise ProtocolError("invalid_path")
    if any(len(component.encode("utf-8", "strict")) > MAX_NAME_BYTES for component in components):
        raise ProtocolError("invalid_path")
    return value, components


def validate_name(value: Any) -> str:
    if not isinstance(value, str) or value in ("", ".", "..") or "/" in value or "\0" in value:
        raise ProtocolError("invalid_name")
    try:
        encoded = value.encode("utf-8", "strict")
    except UnicodeEncodeError as error:
        raise ProtocolError("invalid_name") from error
    if len(encoded) > MAX_NAME_BYTES:
        raise ProtocolError("invalid_name")
    return value


def validate_components(value: Any) -> list[str]:
    if not isinstance(value, list) or not value or len(value) > MAX_DEPTH:
        raise ProtocolError("invalid_components")
    components = [validate_name(component) for component in value]
    if sum(len(component.encode("utf-8")) + 1 for component in components) > MAX_PATH_BYTES:
        raise ProtocolError("invalid_components")
    return components


def canonical_u64(value: int) -> str:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > MAX_U64:
        raise ProtocolError("unsupported_stat")
    return str(value)


def _frame_digest_field(digest: Any, value: bytes) -> None:
    if len(value) > 0xFFFFFFFF:
        raise ProtocolError("version_input_limit")
    digest.update(struct.pack(">I", len(value)))
    digest.update(value)


def preview_file_version(
    root_id: str,
    generation: str,
    root_identity: dict[str, Any],
    components: list[str],
    identity: dict[str, Any],
) -> str:
    if (
        not isinstance(root_id, str) or not root_id or len(root_id) > 256
        or not isinstance(generation, str) or not generation or len(generation) > 256
    ):
        raise ProtocolError("invalid_preview_authority")
    digest = hashlib.sha256(PREVIEW_VERSION_DOMAIN)
    root_values = [
        root_id,
        generation,
        root_identity["dev"],
        root_identity["ino"],
        root_identity["incarnation"]["provider"],
        root_identity["incarnation"]["scope"],
        root_identity["incarnation"]["token"],
        str(len(components)),
        *components,
        identity["dev"],
        identity["ino"],
        identity["sizeBytes"],
        identity["mtimeNs"],
        identity["ctimeNs"],
        identity["fileType"],
    ]
    for value in root_values:
        _frame_digest_field(digest, value.encode("utf-8", "strict"))
    return digest.hexdigest()


def close_iterator(handle: DirectoryHandle) -> None:
    iterator, handle.iterator = handle.iterator, None
    if iterator is not None:
        iterator.close()


class DescriptorBridge:
    def __init__(self) -> None:
        if not supports_required_posix_operations():
            raise ProtocolError("unsupported_platform")
        self.handles: dict[str, DirectoryHandle] = {}
        self.next_id = 1

    def _handle(self, value: Any) -> tuple[str, DirectoryHandle]:
        if not isinstance(value, str) or len(value) > 32:
            raise ProtocolError("invalid_handle")
        handle = self.handles.get(value)
        if handle is None:
            raise ProtocolError("invalid_handle")
        return value, handle

    def _open_directory_path(self, path: str) -> int:
        _, components = validate_path(path)
        current_fd = os.open("/", DIRECTORY_FLAGS)
        try:
            if not stat.S_ISDIR(os.fstat(current_fd).st_mode):
                raise ProtocolError("not_directory")
            for component in components:
                parent_info = os.fstat(current_fd)
                child_fd = os.open(component, DIRECTORY_FLAGS, dir_fd=current_fd)
                try:
                    opened_info = os.fstat(child_fd)
                    named_info = os.stat(component, dir_fd=current_fd, follow_symlinks=False)
                    if (
                        not stat.S_ISDIR(opened_info.st_mode)
                        or not stat.S_ISDIR(named_info.st_mode)
                        or not identity_matches(identity_from_stat(opened_info), identity_from_stat(named_info))
                        or not stat.S_ISDIR(parent_info.st_mode)
                    ):
                        raise ProtocolError("not_directory")
                except BaseException:
                    os.close(child_fd)
                    raise
                os.close(current_fd)
                current_fd = child_fd
            result, current_fd = current_fd, -1
            return result
        finally:
            if current_fd >= 0:
                os.close(current_fd)

    def _new_handle(
        self,
        fd: int,
        depth: int,
        root_identity: dict[str, Any],
        parent_id: str | None = None,
        component: str | None = None,
        root_path: str | None = None,
    ) -> tuple[str, DirectoryHandle]:
        if len(self.handles) >= MAX_HANDLES:
            raise ProtocolError("handle_limit")
        info = os.fstat(fd)
        if not stat.S_ISDIR(info.st_mode):
            raise ProtocolError("not_directory")
        handle_id = str(self.next_id)
        self.next_id += 1
        handle = DirectoryHandle(
            fd, identity_from_stat(info), root_identity, depth, parent_id, component, root_path
        )
        self.handles[handle_id] = handle
        return handle_id, handle

    def _assert_bound(self, handle_id: str, handle: DirectoryHandle) -> bool:
        actual_handle = identity_from_stat(os.fstat(handle.fd))
        if not identity_matches(actual_handle, handle.identity):
            return False
        if handle.parent_id is None:
            if handle.root_path is None or not root_identity_matches(
                root_identity_from_fd(handle.fd), handle.root_identity
            ):
                return False
            try:
                root_fd = self._open_directory_path(handle.root_path)
            except OSError:
                return False
            try:
                return root_identity_matches(
                    root_identity_from_fd(root_fd), handle.root_identity
                )
            except ProtocolError:
                return False
            finally:
                os.close(root_fd)
        parent = self.handles.get(handle.parent_id)
        if parent is None or handle.component is None:
            return False
        if not self._assert_bound(handle.parent_id, parent):
            return False
        try:
            current = os.stat(handle.component, dir_fd=parent.fd, follow_symlinks=False)
        except OSError:
            return False
        return stat.S_ISDIR(current.st_mode) and identity_matches(
            identity_from_stat(current), handle.identity
        )

    def _close(self, handle_id: str) -> None:
        handle = self.handles.pop(handle_id, None)
        if handle is None:
            return
        try:
            close_iterator(handle)
        finally:
            os.close(handle.fd)

    def close_all(self) -> None:
        for handle_id in list(self.handles):
            try:
                self._close(handle_id)
            except OSError:
                pass

    def _preview_parent_chain(
        self, root_handle_id: str, root: DirectoryHandle, components: list[str]
    ) -> tuple[int, list[int], list[tuple[int, str, int, dict[str, str]]]]:
        if not self._assert_bound(root_handle_id, root):
            raise ProtocolError("identity_changed")
        root_device = root.identity["dev"]
        opened_fds: list[int] = []
        chain: list[tuple[int, str, int, dict[str, str]]] = []
        parent_fd = root.fd
        try:
            for component in components[:-1]:
                child_fd = os.open(component, DIRECTORY_FLAGS, dir_fd=parent_fd)
                try:
                    opened_info = os.fstat(child_fd)
                    named_info = os.stat(component, dir_fd=parent_fd, follow_symlinks=False)
                    opened_identity = identity_from_stat(opened_info)
                    if (
                        not stat.S_ISDIR(opened_info.st_mode)
                        or not stat.S_ISDIR(named_info.st_mode)
                        or not identity_matches(opened_identity, identity_from_stat(named_info))
                        or opened_identity["dev"] != root_device
                    ):
                        raise ProtocolError("identity_changed")
                    chain.append((parent_fd, component, child_fd, opened_identity))
                    opened_fds.append(child_fd)
                    parent_fd = child_fd
                except BaseException:
                    os.close(child_fd)
                    raise
            return parent_fd, opened_fds, chain
        except BaseException:
            for fd in reversed(opened_fds):
                os.close(fd)
            raise

    def _verify_preview_chain(
        self,
        root_handle_id: str,
        root: DirectoryHandle,
        chain: list[tuple[int, str, int, dict[str, str]]],
    ) -> bool:
        if not self._assert_bound(root_handle_id, root):
            return False
        for parent_fd, name, child_fd, expected in chain:
            try:
                opened = os.fstat(child_fd)
                named = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
            except OSError:
                return False
            if (
                not stat.S_ISDIR(opened.st_mode)
                or not stat.S_ISDIR(named.st_mode)
                or not identity_matches(identity_from_stat(opened), expected)
                or not identity_matches(identity_from_stat(named), expected)
                or expected["dev"] != root.identity["dev"]
            ):
                return False
        return True

    @staticmethod
    def _preview_identity(info: os.stat_result, root: DirectoryHandle) -> dict[str, str]:
        if not stat.S_ISREG(info.st_mode) or str(info.st_dev) != root.identity["dev"]:
            raise ProtocolError("unsupported_file")
        size = canonical_u64(info.st_size)
        if int(size) > MAX_PREVIEW_FILE_BYTES:
            raise ProtocolError("too_large")
        return {
            "dev": canonical_u64(info.st_dev),
            "ino": canonical_u64(info.st_ino),
            "sizeBytes": size,
            "mtimeNs": canonical_u64(info.st_mtime_ns),
            "ctimeNs": canonical_u64(info.st_ctime_ns),
            "fileType": "regular",
        }

    @staticmethod
    def _validate_preview_stat(value: Any) -> dict[str, str]:
        keys = {"dev", "ino", "sizeBytes", "mtimeNs", "ctimeNs", "fileType", "fileVersion"}
        if not isinstance(value, dict) or set(value) != keys or value.get("fileType") != "regular":
            raise ProtocolError("invalid_preview_stat")
        for key in ("dev", "ino", "sizeBytes", "mtimeNs", "ctimeNs"):
            raw = value[key]
            if not isinstance(raw, str) or not _canonical_decimal(raw) or len(raw) > 20:
                raise ProtocolError("invalid_preview_stat")
            if int(raw) > MAX_U64:
                raise ProtocolError("invalid_preview_stat")
        if int(value["ino"]) == 0 or int(value["sizeBytes"]) > MAX_PREVIEW_FILE_BYTES:
            raise ProtocolError("invalid_preview_stat")
        version = value["fileVersion"]
        if not isinstance(version, str) or len(version) != 64 or any(
            character not in "0123456789abcdef" for character in version
        ):
            raise ProtocolError("invalid_preview_stat")
        return value

    def _open_preview_file(
        self,
        root_handle_id: str,
        root: DirectoryHandle,
        components: list[str],
    ) -> tuple[int, list[int], list[tuple[int, str, int, dict[str, str]]], dict[str, str]]:
        parent_fd, opened_fds, chain = self._preview_parent_chain(
            root_handle_id, root, components
        )
        file_fd = -1
        try:
            name = components[-1]
            before = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
            if not stat.S_ISREG(before.st_mode):
                raise ProtocolError("unsupported_file")
            file_fd = os.open(name, PREVIEW_FILE_FLAGS, dir_fd=parent_fd)
            opened = os.fstat(file_fd)
            named = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
            identity = identity_from_stat(opened)
            if (
                not stat.S_ISREG(opened.st_mode)
                or not stat.S_ISREG(named.st_mode)
                or not identity_matches(identity, identity_from_stat(before))
                or not identity_matches(identity, identity_from_stat(named))
                or identity["dev"] != root.identity["dev"]
                or not self._verify_preview_chain(root_handle_id, root, chain)
            ):
                raise ProtocolError("identity_changed")
            return file_fd, opened_fds, chain, self._preview_identity(opened, root)
        except BaseException:
            if file_fd >= 0:
                os.close(file_fd)
            for fd in reversed(opened_fds):
                os.close(fd)
            raise

    def _preview_stat_for_file(
        self,
        root: DirectoryHandle,
        root_id: str,
        generation: str,
        components: list[str],
        identity: dict[str, str],
    ) -> dict[str, Any]:
        return {
            **identity,
            "fileVersion": preview_file_version(
                root_id, generation, root.root_identity, components, identity
            ),
        }

    def _stat_preview(self, request: dict[str, Any]) -> dict[str, Any]:
        _, root = self._handle(request["rootHandleId"])
        components = validate_components(request["components"])
        fd, opened_fds, chain, identity = self._open_preview_file(
            request["rootHandleId"], root, components
        )
        try:
            name = components[-1]
            named = os.stat(name, dir_fd=chain[-1][2] if chain else root.fd, follow_symlinks=False)
            opened_identity = self._preview_identity(os.fstat(fd), root)
            named_identity = self._preview_identity(named, root)
            if (
                opened_identity != identity
                or named_identity != identity
                or not self._verify_preview_chain(request["rootHandleId"], root, chain)
            ):
                raise ProtocolError("identity_changed")
            return self._preview_stat_for_file(
                root, request["rootId"], request["generation"], components, identity
            )
        finally:
            os.close(fd)
            for opened_fd in reversed(opened_fds):
                os.close(opened_fd)

    def _read_preview_chunk(self, request: dict[str, Any]) -> dict[str, Any]:
        root_handle_id = request["rootHandleId"]
        _, root = self._handle(root_handle_id)
        components = validate_components(request["components"])
        expected = self._validate_preview_stat(request["expectedStat"])
        offset = request["offset"]
        length = request["length"]
        if (
            isinstance(offset, bool) or not isinstance(offset, int) or offset < 0
            or isinstance(length, bool) or not isinstance(length, int)
            or length <= 0 or length > MAX_PREVIEW_CHUNK_BYTES
        ):
            raise ProtocolError("invalid_preview_range")
        total = int(expected["sizeBytes"])
        if offset >= total or length != min(MAX_PREVIEW_CHUNK_BYTES, total - offset):
            raise ProtocolError("invalid_preview_range")
        fd, opened_fds, chain, identity = self._open_preview_file(
            root_handle_id, root, components
        )
        try:
            current = self._preview_stat_for_file(
                root, request["rootId"], request["generation"], components, identity
            )
            if current != expected:
                raise ProtocolError("identity_changed")
            data = os.pread(fd, length, offset)
            if len(data) != length:
                raise ProtocolError("identity_changed")
            name = components[-1]
            parent_fd = chain[-1][2] if chain else root.fd
            opened_after = os.fstat(fd)
            named_after = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
            identity_after = self._preview_identity(opened_after, root)
            named_identity_after = self._preview_identity(named_after, root)
            stat_after = self._preview_stat_for_file(
                root, request["rootId"], request["generation"], components, identity_after
            )
            if (
                stat_after != expected
                or named_identity_after != identity_after
                or not self._verify_preview_chain(root_handle_id, root, chain)
            ):
                raise ProtocolError("identity_changed")
            next_offset = offset + len(data)
            return {
                "stat": stat_after,
                "dataBase64": base64.b64encode(data).decode("ascii"),
                "offset": offset,
                "nextOffset": next_offset,
                "final": next_offset == total,
            }
        finally:
            os.close(fd)
            for opened_fd in reversed(opened_fds):
                os.close(opened_fd)

    def dispatch(self, request: dict[str, Any]) -> Any:
        operation = request.get("op")
        if operation == "capabilities":
            if set(request) != {"id", "op"}:
                raise ProtocolError("invalid_request")
            return {"supported": True, "protocol": 1}
        if operation == "capture_root_identity":
            if set(request) != {"id", "op", "path"}:
                raise ProtocolError("invalid_request")
            path, _ = validate_path(request["path"])
            fd = self._open_directory_path(path)
            try:
                return root_identity_from_fd(fd)
            finally:
                os.close(fd)
        if operation == "open_root":
            if set(request) != {"id", "op", "path", "identity"}:
                raise ProtocolError("invalid_request")
            path, _ = validate_path(request["path"])
            expected = validate_root_identity(request["identity"])
            fd = self._open_directory_path(path)
            try:
                actual = root_identity_from_fd(fd)
                if not root_identity_matches(actual, expected):
                    raise ProtocolError("identity_changed")
                handle_id, handle = self._new_handle(
                    fd, 0, root_identity=actual, root_path=path
                )
                fd = -1
                return {"handleId": handle_id, "identity": handle.identity}
            finally:
                if fd >= 0:
                    os.close(fd)
        if operation == "verify_root":
            if set(request) != {"id", "op", "path", "identity", "handleId"}:
                raise ProtocolError("invalid_request")
            _, handle = self._handle(request["handleId"])
            path, _ = validate_path(request["path"])
            expected = validate_root_identity(request["identity"])
            if (
                handle.parent_id is not None
                or not root_identity_matches(handle.root_identity, expected)
                or not root_identity_matches(root_identity_from_fd(handle.fd), expected)
            ):
                return False
            fd = self._open_directory_path(path)
            try:
                return root_identity_matches(root_identity_from_fd(fd), expected)
            finally:
                os.close(fd)
        if operation == "stat_preview":
            if set(request) != {
                "id", "op", "rootHandleId", "rootId", "generation", "components"
            }:
                raise ProtocolError("invalid_request")
            if (
                not isinstance(request["rootId"], str)
                or not isinstance(request["generation"], str)
            ):
                raise ProtocolError("invalid_preview_authority")
            return self._stat_preview(request)
        if operation == "read_preview_chunk":
            if set(request) != {
                "id", "op", "rootHandleId", "rootId", "generation", "components",
                "expectedStat", "offset", "length",
            }:
                raise ProtocolError("invalid_request")
            if (
                not isinstance(request["rootId"], str)
                or not isinstance(request["generation"], str)
            ):
                raise ProtocolError("invalid_preview_authority")
            return self._read_preview_chunk(request)
        if operation in ("lstat_child", "open_child", "verify_child"):
            required = {"id", "op", "parentHandleId", "name"}
            if operation == "verify_child":
                required.add("identity")
            if set(request) != required:
                raise ProtocolError("invalid_request")
            parent_id, parent = self._handle(request["parentHandleId"])
            name = validate_name(request["name"])
            if not self._assert_bound(parent_id, parent):
                raise ProtocolError("identity_changed")
            if operation == "lstat_child":
                info = os.stat(name, dir_fd=parent.fd, follow_symlinks=False)
                if not self._assert_bound(parent_id, parent):
                    raise ProtocolError("identity_changed")
                return self._entry_stat(info)
            if operation == "verify_child":
                expected = validate_identity(request["identity"])
                try:
                    current = os.stat(name, dir_fd=parent.fd, follow_symlinks=False)
                except FileNotFoundError:
                    return False
                return stat.S_ISDIR(current.st_mode) and identity_matches(
                    identity_from_stat(current), expected
                ) and self._assert_bound(parent_id, parent)
            if parent.depth >= MAX_DEPTH:
                raise ProtocolError("depth_limit")
            fd = os.open(name, DIRECTORY_FLAGS, dir_fd=parent.fd)
            try:
                opened = identity_from_stat(os.fstat(fd))
                current = os.stat(name, dir_fd=parent.fd, follow_symlinks=False)
                if not stat.S_ISDIR(current.st_mode) or not identity_matches(
                    identity_from_stat(current), opened
                ) or not self._assert_bound(parent_id, parent):
                    raise ProtocolError("identity_changed")
                handle_id, handle = self._new_handle(
                    fd,
                    parent.depth + 1,
                    parent.root_identity,
                    parent_id,
                    name,
                    parent.root_path,
                )
                fd = -1
                return {"handleId": handle_id, "identity": handle.identity}
            finally:
                if fd >= 0:
                    os.close(fd)
        if operation == "read":
            if set(request) != {"id", "op", "handleId"}:
                raise ProtocolError("invalid_request")
            _, handle = self._handle(request["handleId"])
            if not self._assert_bound(request["handleId"], handle):
                raise ProtocolError("identity_changed")
            if handle.exhausted:
                return None
            if handle.iterator is None:
                handle.iterator = os.scandir(handle.fd)
            entry = next(handle.iterator, None)
            if entry is None:
                close_iterator(handle)
                handle.exhausted = True
                return None
            if not self._assert_bound(request["handleId"], handle):
                raise ProtocolError("identity_changed")
            name = entry.name
            try:
                validate_name(name)
            except ProtocolError:
                # Preserve the filename boundary; invalid/unrepresentable names fail closed.
                raise ProtocolError("invalid_filename_encoding")
            return {"name": name}
        if operation == "close":
            if set(request) != {"id", "op", "handleId"}:
                raise ProtocolError("invalid_request")
            if not isinstance(request["handleId"], str):
                raise ProtocolError("invalid_handle")
            self._close(request["handleId"])
            return None
        if operation == "shutdown":
            if set(request) != {"id", "op"}:
                raise ProtocolError("invalid_request")
            self.close_all()
            return None
        raise ProtocolError("unknown_operation")

    @staticmethod
    def _entry_stat(info: os.stat_result) -> dict[str, Any]:
        if stat.S_ISDIR(info.st_mode):
            kind = "directory"
        elif stat.S_ISREG(info.st_mode):
            kind = "file"
        elif stat.S_ISLNK(info.st_mode):
            kind = "symlink"
        elif stat.S_ISFIFO(info.st_mode):
            kind = "fifo"
        else:
            kind = "special"
        result = {
            "kind": kind,
            "identity": identity_from_stat(info),
            "size": max(0, info.st_size),
            "modifiedAtMs": max(0, info.st_mtime_ns // 1_000_000),
        }
        if kind == "file":
            try:
                result["previewIdentity"] = {
                    "dev": canonical_u64(info.st_dev),
                    "ino": canonical_u64(info.st_ino),
                    "sizeBytes": canonical_u64(info.st_size),
                    "mtimeNs": canonical_u64(info.st_mtime_ns),
                    "ctimeNs": canonical_u64(info.st_ctime_ns),
                    "fileType": "regular",
                }
            except ProtocolError:
                # Keep metadata browsing available when a platform stat cannot fit the preview DTO.
                pass
        return result


def encode_response(response: dict[str, Any]) -> bytes:
    data = json.dumps(response, ensure_ascii=True, separators=(",", ":")).encode("ascii") + b"\n"
    if len(data) > MAX_RESPONSE_BYTES:
        raise ProtocolError("response_limit")
    return data


def main() -> int:
    if not supports_required_posix_operations():
        return 78
    bridge = DescriptorBridge()
    try:
        while True:
            line = sys.stdin.buffer.readline(MAX_REQUEST_BYTES + 1)
            if not line:
                break
            if len(line) > MAX_REQUEST_BYTES or not line.endswith(b"\n"):
                return 64
            request_id: Any = None
            try:
                request = json.loads(line)
                if not isinstance(request, dict) or not isinstance(request.get("id"), str):
                    raise ProtocolError("invalid_request")
                if len(request["id"]) > 64:
                    raise ProtocolError("invalid_request_id")
                request_id = request["id"]
                result = bridge.dispatch(request)
                response = {"id": request_id, "ok": True, "result": result}
            except (
                ProtocolError,
                NativeRootIdentityError,
                OSError,
                ValueError,
                TypeError,
                UnicodeError,
            ) as error:
                code = (
                    error.args[0]
                    if isinstance(error, (ProtocolError, NativeRootIdentityError)) and error.args
                    else "operation_failed"
                )
                response = {"id": request_id, "ok": False, "error": str(code)[:64]}
            try:
                sys.stdout.buffer.write(encode_response(response))
                sys.stdout.buffer.flush()
            except (BrokenPipeError, OSError, ProtocolError):
                return 74
            if request.get("op") == "shutdown" and response["ok"]:
                break
    finally:
        bridge.close_all()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
