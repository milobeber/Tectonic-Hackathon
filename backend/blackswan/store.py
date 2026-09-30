"""SQLite persistence. Only raw inputs are stored; game state is always replayed."""

import sqlite3
import threading
from pathlib import Path

from .schemas import Enrollment, Transaction

SCHEMA = """
CREATE TABLE IF NOT EXISTS enrollments (
    user_id     TEXT PRIMARY KEY,
    difficulty  TEXT NOT NULL,
    fund_id     TEXT NOT NULL,
    enrolled_on TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS transactions (
    user_id        TEXT NOT NULL,
    transaction_id TEXT NOT NULL,
    booking_date   TEXT NOT NULL,
    payload        TEXT NOT NULL,
    PRIMARY KEY (user_id, transaction_id)
);
CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions (user_id, booking_date);
"""


class Store:
    def __init__(self, path: str | Path = ":memory:"):
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._lock = threading.Lock()
        with self._lock:
            self._conn.executescript(SCHEMA)

    def upsert_enrollment(self, e: Enrollment) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO enrollments VALUES (?, ?, ?, ?) "
                "ON CONFLICT(user_id) DO UPDATE SET difficulty=excluded.difficulty, fund_id=excluded.fund_id, "
                "enrolled_on=excluded.enrolled_on",
                (e.user_id, e.difficulty, e.fund_id, e.enrolled_on.isoformat()),
            )

    def get_enrollment(self, user_id: str) -> Enrollment | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT user_id, difficulty, fund_id, enrolled_on FROM enrollments WHERE user_id = ?", (user_id,)
            ).fetchone()
        if not row:
            return None
        return Enrollment(user_id=row[0], difficulty=row[1], fund_id=row[2], enrolled_on=row[3])

    def delete_user(self, user_id: str) -> bool:
        """Opt-out: forget everything about the user."""
        with self._lock, self._conn:
            n = self._conn.execute("DELETE FROM enrollments WHERE user_id = ?", (user_id,)).rowcount
            self._conn.execute("DELETE FROM transactions WHERE user_id = ?", (user_id,))
        return n > 0

    def add_transactions(self, user_id: str, txs: list[Transaction]) -> tuple[int, int]:
        """Idempotent insert keyed on transaction_id. Returns (accepted, duplicates)."""
        with self._lock, self._conn:
            before = self._conn.total_changes
            self._conn.executemany(
                "INSERT OR IGNORE INTO transactions VALUES (?, ?, ?, ?)",
                [(user_id, t.transaction_id, t.booking_date.isoformat(), t.model_dump_json()) for t in txs],
            )
            accepted = self._conn.total_changes - before
        return accepted, len(txs) - accepted

    def get_transactions(self, user_id: str) -> list[Transaction]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT payload FROM transactions WHERE user_id = ? ORDER BY booking_date", (user_id,)
            ).fetchall()
        return [Transaction.model_validate_json(r[0]) for r in rows]
