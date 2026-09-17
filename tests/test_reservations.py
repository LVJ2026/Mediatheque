from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app import api
from app.models import Game, LoanResponse
from app.main import app

@pytest.fixture(autouse=True)
def use_fake_grist(monkeypatch):
    class FakeGrist:
        async def games(self):
            return [Game(id=1, Jeu="Jeu test", Marque="Test", **{"Âge indiqué": "6+", "Joueurs": "2", "Remarques": ""})]

        async def loans(self):
            return []

        async def create_loans(self, loan):
            return [LoanResponse(
                id=index, name=loan.name, first_name=loan.first_name,
                professional_email=loan.professional_email, school=loan.school,
                loan_date=loan.loan_date, game_id=game_id,
                return_date=loan.loan_date + timedelta(days=20),
            ) for index, game_id in enumerate(loan.game_ids, start=1)]

    monkeypatch.setattr(api, "grist", FakeGrist())


def test_games_are_available_from_grist_client():
    with TestClient(app) as client:
        response = client.get("/api/games")
    assert response.status_code == 200
    assert response.json()[0]["Jeu"] == "Jeu test"


def test_new_loan_returns_three_week_end_date():
    with TestClient(app) as client:
        response = client.post("/api/loans", json={
            "name": "Martin", "first_name": "Alex", "professional_email": "alex.martin@ac-test.fr",
            "school": "Ecole test", "loan_date": str(date.today() + timedelta(days=2)), "game_id": 1,
        })
    assert response.status_code == 201
    assert response.json()["return_date"] == str(date.today() + timedelta(days=22))


def test_batch_loan_returns_one_record_per_game():
    with TestClient(app) as client:
        response = client.post("/api/loans/batch", json={
            "name": "Martin", "first_name": "Alex", "professional_email": "alex.martin@ac-test.fr",
            "school": "Ecole test", "loan_date": str(date.today() + timedelta(days=4)), "game_ids": [1, 2],
        })
    assert response.status_code == 201
    assert len(response.json()) == 2