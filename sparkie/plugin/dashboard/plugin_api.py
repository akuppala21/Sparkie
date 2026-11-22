"""Routes inherit Hermes dashboard authentication; no fleet credentials here."""

from fastapi import APIRouter, HTTPException
from sparkie_sparks.fleet import read_status
from sparkie_sparks.energy import read_energy
from sparkie_sparks.web_controls import router as controls_router

router = APIRouter()
router.include_router(controls_router)


@router.get("/fleet")
def fleet():
    # A synchronous route runs in FastAPI's worker pool, not the chat event loop.
    return read_status()


@router.get("/energy")
def energy(month: str | None = None, period: str = 'month', selected: str | None = None, rate: float | None = None):
    try:
        return read_energy(month=month, period=period, selected=selected, rate=rate)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Choose a valid period and an optional rate from $0 to $10 per kWh.") from None
