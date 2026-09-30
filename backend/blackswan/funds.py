"""Placeholder fund catalogue. Swap for the real KBC fund list + returns feed."""

from .schemas import Fund

FUNDS: dict[str, Fund] = {
    f.id: f
    for f in (
        Fund(id="kbc-sustainable-defensive", name="Sustainable Defensive (demo)", risk_class=2, expected_annual_return=0.025),
        Fund(id="kbc-sustainable-balanced", name="Sustainable Balanced (demo)", risk_class=3, expected_annual_return=0.04),
        Fund(id="kbc-sustainable-dynamic", name="Sustainable Dynamic (demo)", risk_class=4, expected_annual_return=0.055),
    )
}
