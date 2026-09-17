from datetime import date
from pydantic import BaseModel, EmailStr, Field


class Game(BaseModel):
    id: int
    name: str = Field(alias="Jeu")
    brand: str = Field(default="", alias="Marque")
    age: str = Field(default="", alias="Âge indiqué")
    players: str = Field(default="", alias="Joueurs")
    notes: str = Field(default="", alias="Remarques")

    model_config = {"populate_by_name": True}


class Loan(BaseModel):
    name: str
    first_name: str
    professional_email: EmailStr
    school: str
    loan_date: date
    game_id: int


class LoanBatch(BaseModel):
    name: str
    first_name: str
    professional_email: EmailStr
    school: str
    loan_date: date
    game_ids: list[int] = Field(min_length=1)


class LoanResponse(Loan):
    id: int | None = None
    return_date: date
