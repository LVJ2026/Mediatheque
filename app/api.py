import asyncio
from datetime import date, timedelta

from fastapi import APIRouter, HTTPException

from .grist import GristClient
from .models import Game, Loan, LoanBatch, LoanResponse

router = APIRouter(prefix="/api")
grist = GristClient()
reservation_lock = asyncio.Lock()


@router.get("/games", response_model=list[Game])
async def get_games() -> list[Game]:
    try:
        return await grist.games()
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@router.get("/loans", response_model=list[LoanResponse])
async def get_loans() -> list[LoanResponse]:
    try:
        return await grist.loans()
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@router.post("/loans", response_model=LoanResponse, status_code=201)
async def create_loan(loan: Loan) -> LoanResponse:
    try:
        responses = await create_loans(LoanBatch(**loan.model_dump(), game_ids=[loan.game_id]))
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return responses[0]


@router.post("/loans/batch", response_model=list[LoanResponse], status_code=201)
async def create_loans(loan: LoanBatch) -> list[LoanResponse]:
    async with reservation_lock:
        existing = await grist.loans()
        requested_end = loan.loan_date + timedelta(days=20)
        for game_id in loan.game_ids:
            for current in existing:
                if current.game_id != game_id:
                    continue
                overlaps = loan.loan_date <= current.return_date and requested_end >= current.loan_date
                if overlaps:
                    raise HTTPException(status_code=409, detail="Au moins un jeu est déjà réservé sur cette période.")
        try:
            return await grist.create_loans(loan)
        except RuntimeError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
