import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from blackswan.schemas import Enrollment, Transaction  # noqa: E402

ENROLLED = date(2026, 9, 1)


class TxFactory:
    def __init__(self):
        self.n = 0

    def __call__(self, day: date, amount: float, merchant: str = "Delhaize", category: str = "groceries") -> Transaction:
        self.n += 1
        return Transaction(
            transaction_id=f"t{self.n}", booking_date=day, amount=amount, merchant=merchant, category=category
        )

    def history(self, days: int = 90, daily: float = 20.0, end: date = ENROLLED) -> list[Transaction]:
        """`daily` EUR of discretionary spend every day for `days` days before `end`."""
        return [self(end - timedelta(days=i), -daily) for i in range(1, days + 1)]


@pytest.fixture
def tx():
    return TxFactory()


@pytest.fixture
def enrollment():
    return Enrollment(user_id="u1", difficulty="normal", fund_id="kbc-sustainable-balanced", enrolled_on=ENROLLED)
