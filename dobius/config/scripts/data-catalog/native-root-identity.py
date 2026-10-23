"""Read-only native filesystem incarnation providers for catalog root FDs."""

from __future__ import annotations

import array
import ctypes
import fcntl
import os
import stat
import struct
import sys
from typing import Any


class NativeRootIdentityError(Exception):
    """The platform or filesystem cannot prove a supported root incarnation."""


def _linux_filesystem_type(fd: int) -> int:
    libc = ctypes.CDLL(None, use_errno=True)
    fstatfs = getattr(libc, "fstatfs", None)
    if fstatfs is None:
        raise NativeRootIdentityError("unsupported_identity_provider")
    raw = ctypes.create_string_buffer(256)
    fstatfs.argtypes = [ctypes.c_int, ctypes.c_void_p]
    fstatfs.restype = ctypes.c_int
    if fstatfs(fd, ctypes.cast(raw, ctypes.c_void_p)) != 0:
        raise NativeRootIdentityError("unsupported_identity_provider")
    return ctypes.c_long.from_buffer(raw).value & 0xFFFFFFFFFFFFFFFF


def _linux_root_identity(fd: int, info: os.stat_result) -> dict[str, Any]:
    if _linux_filesystem_type(fd) != 0xEF53:
        raise NativeRootIdentityError("unsupported_identity_provider")
    try:
        fsid = int(os.statvfs(fd).f_fsid)
        if fsid <= 0 or fsid > 0xFFFFFFFFFFFFFFFF:
            raise ValueError("invalid fsid")
        scope = f"{fsid:016x}"
        command = 0x80000000 | (ctypes.sizeof(ctypes.c_long) << 16) | (ord("v") << 8) | 1
        value = array.array("l", [0])
        fcntl.ioctl(fd, command, value, True)
        generation = struct.unpack_from("=I", value.tobytes())[0]
        if generation == 0:
            raise ValueError("zero generation")
    except (AttributeError, OSError, OverflowError, ValueError, struct.error):
        raise NativeRootIdentityError("unsupported_identity_provider") from None
    return {
        "dev": str(info.st_dev),
        "ino": str(info.st_ino),
        "incarnation": {
            "provider": "linux-inode-generation-v1",
            "scope": scope,
            "token": str(generation),
        },
    }


class _DarwinAttrList(ctypes.Structure):
    _fields_ = [
        ("bitmapcount", ctypes.c_uint16),
        ("reserved", ctypes.c_uint16),
        ("commonattr", ctypes.c_uint32),
        ("volattr", ctypes.c_uint32),
        ("dirattr", ctypes.c_uint32),
        ("fileattr", ctypes.c_uint32),
        ("forkattr", ctypes.c_uint32),
    ]


def _darwin_volume_identity(fd: int) -> str:
    fgetattrlist = getattr(ctypes.CDLL(None, use_errno=True), "fgetattrlist", None)
    if fgetattrlist is None:
        raise NativeRootIdentityError("unsupported_identity_provider")
    attributes = _DarwinAttrList(5, 0, 0x80000000, 0x80140000, 0, 0, 0)
    output = ctypes.create_string_buffer(4096)
    fgetattrlist.argtypes = [
        ctypes.c_int,
        ctypes.POINTER(_DarwinAttrList),
        ctypes.c_void_p,
        ctypes.c_size_t,
        ctypes.c_ulong,
    ]
    fgetattrlist.restype = ctypes.c_int
    if fgetattrlist(
        fd,
        ctypes.byref(attributes),
        ctypes.cast(output, ctypes.c_void_p),
        len(output),
        0,
    ) != 0:
        raise NativeRootIdentityError("unsupported_identity_provider")
    raw = output.raw
    result_length = struct.unpack_from("=I", raw, 0)[0]
    if result_length < 56 or result_length > len(raw):
        raise NativeRootIdentityError("unsupported_identity_provider")
    returned = struct.unpack_from("=5I", raw, 4)
    if returned != (0x80000000, 0x00140000, 0, 0, 0):
        raise NativeRootIdentityError("unsupported_identity_provider")
    volume_uuid = raw[24:40]
    if len(volume_uuid) != 16 or not any(volume_uuid):
        raise NativeRootIdentityError("unsupported_identity_provider")
    offset, length = struct.unpack_from("=iI", raw, 40)
    start = 40 + offset
    end = start + length
    if offset < 8 or length < 2 or length > 64 or end > result_length:
        raise NativeRootIdentityError("unsupported_identity_provider")
    encoded = raw[start:end]
    nul = encoded.find(b"\0")
    if nul < 0 or any(encoded[nul + 1 :]) or encoded[:nul] != b"apfs":
        raise NativeRootIdentityError("unsupported_identity_provider")
    return volume_uuid.hex()


def root_identity_from_fd(fd: int) -> dict[str, Any]:
    info = os.fstat(fd)
    if not stat.S_ISDIR(info.st_mode):
        raise NativeRootIdentityError("not_directory")
    if sys.platform == "linux":
        return _linux_root_identity(fd, info)
    if sys.platform == "darwin":
        volume_uuid = _darwin_volume_identity(fd)
        token = int(info.st_ino)
        if token <= 0 or token > 0xFFFFFFFFFFFFFFFF:
            raise NativeRootIdentityError("unsupported_identity_provider")
        return {
            "dev": str(info.st_dev),
            "ino": str(info.st_ino),
            "incarnation": {
                "provider": "darwin-apfs-file-id-v1",
                "scope": volume_uuid,
                "token": str(token),
            },
        }
    raise NativeRootIdentityError("unsupported_identity_provider")
