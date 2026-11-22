"""Authenticated dashboard access to the candidate's immutable recipe records."""

from fastapi import APIRouter, HTTPException

from sparkie_sparks.recipes import read_catalog


router = APIRouter()


@router.get("/catalog")
def catalog():
    try:
        return read_catalog()
    except (OSError, ValueError, KeyError, IndexError, TypeError):
        raise HTTPException(503, "The reviewed recipe records could not be read.") from None
