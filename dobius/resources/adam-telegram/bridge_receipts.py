"""Private durable inference receipts; uncertain admissions never run twice."""

import json
import os
from pathlib import Path
import sqlite3
import stat

from bridge_protocol import ProtocolError, error_frame


def _private(path, directory=False):
    info = path.lstat()
    expected = stat.S_ISDIR if directory else stat.S_ISREG
    if not expected(info.st_mode) or (info.st_mode & 0o077):
        raise ProtocolError("receipt-unavailable")
    if hasattr(os, "getuid") and info.st_uid != os.getuid():
        raise ProtocolError("receipt-unavailable")
    if not directory and info.st_nlink != 1:
        raise ProtocolError("receipt-unavailable")


def prepare_private_file(path):
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        _private(path)
    else:
        os.close(fd)
    _private(path)


class ReceiptStore:
    def __init__(self, directory):
        directory = Path(directory)
        directory.mkdir(mode=0o700, parents=False, exist_ok=True)
        _private(directory, directory=True)
        path = directory / "receipts.sqlite3"
        prepare_private_file(path)
        self.db = sqlite3.connect(path)
        self.db.execute("PRAGMA journal_mode=DELETE")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, digest TEXT NOT NULL, response TEXT)")
        # A crash may have occurred after dispatch. Replaying it would duplicate inference.
        with self.db:
            rows = self.db.execute("SELECT id FROM receipts WHERE response IS NULL").fetchall()
            for (request_id,) in rows:
                self.finish(request_id, error_frame(request_id, "request-interrupted"))

    def admit(self, request_id, digest):
        row = self.db.execute("SELECT digest,response FROM receipts WHERE id=?", (request_id,)).fetchone()
        if row:
            if row[0] != digest:
                raise ProtocolError("request-conflict")
            return False, json.loads(row[1]) if row[1] is not None else None
        with self.db:
            self.db.execute("INSERT INTO receipts(id,digest) VALUES (?,?)", (request_id, digest))
        return True, None

    def lookup(self, request_id):
        row = self.db.execute("SELECT response FROM receipts WHERE id=?", (request_id,)).fetchone()
        return (False, None) if row is None else (True, json.loads(row[0]) if row[0] else None)

    def finish(self, request_id, response):
        with self.db:
            self.db.execute("UPDATE receipts SET response=? WHERE id=? AND response IS NULL",
                            (json.dumps(response, ensure_ascii=False), request_id))
        return self.lookup(request_id)[1]

    def close(self):
        self.db.close()
