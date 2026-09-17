from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx
from httpx import HTTPStatusError

from .config import settings
from .models import Game, Loan, LoanBatch, LoanResponse


class GristClient:
    def __init__(self) -> None:
        self.base_url = settings.grist_base_url.rstrip("/")
        self.headers = {"Authorization": f"Bearer {settings.grist_api_key}"}

    @property
    def enabled(self) -> bool:
        return settings.grist_enabled and bool(settings.grist_api_key and settings.grist_doc_id)

    async def _request(self, method: str, table: str, **kwargs: Any) -> dict[str, Any]:
        api_marker = "/api/docs/"
        root_url = self.base_url.split(api_marker, 1)[0].rstrip("/")
        table_id = table.replace(" ", "_")
        url = f"{root_url}{api_marker}{settings.grist_doc_id}/tables/{table_id}/records"
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.request(method, url, headers=self.headers, **kwargs)
            response.raise_for_status()
            return response.json()

    async def games(self) -> list[Game]:
        if not self.enabled:
            raise RuntimeError("Grist n'est pas active : configurez GRIST_API_KEY, GRIST_DOC_ID et GRIST_ENABLED=true.")
        payload = await self._request("GET", settings.grist_inventory_table)
        games = []
        for item in payload.get("records", []):
            fields = item.get("fields", {})
            fields["Âge indiqué"] = fields.get("Âge indiqué", fields.get("Age_indique", ""))
            for field_name in ("Marque", "Âge indiqué", "Joueurs", "Remarques"):
                fields[field_name] = "" if fields.get(field_name) is None else str(fields[field_name])
            games.append(Game(id=item["id"], **fields))
        return games

    async def loans(self) -> list[LoanResponse]:
        if not self.enabled:
            raise RuntimeError("Grist n'est pas active : configurez GRIST_API_KEY, GRIST_DOC_ID et GRIST_ENABLED=true.")
        try:
            payload = await self._request("GET", settings.grist_loans_table)
        except HTTPStatusError as error:
            if error.response.status_code == 404:
                return []
            raise
        loans = []
        for item in payload.get("records", []):
            fields = item.get("fields", {})
            start_value = fields.get("Date Emprunt", fields.get("Date_Emprunt"))
            game_value = fields.get("Jeu")
            if not start_value or game_value is None:
                continue
            if isinstance(start_value, (int, float)):
                start = datetime.fromtimestamp(start_value, tz=timezone.utc).date()
            else:
                start = date.fromisoformat(str(start_value)[:10])
            loans.append(LoanResponse(
                id=item["id"], name=fields.get("Nom", ""), first_name=fields.get("Prénom", fields.get("Prenom", "")),
                professional_email=fields.get("Mail professionnel", fields.get("Mail_professionnel", "contact@example.org")),
                school=fields.get("Ecole", ""), loan_date=start, game_id=int(fields["Jeu"]),
                return_date=start + timedelta(days=20),
            ))
        return loans

    async def create_loan(self, loan: Loan) -> LoanResponse:
        responses = await self.create_loans(LoanBatch(**loan.model_dump(), game_ids=[loan.game_id]))
        return responses[0]

    async def create_loans(self, loan: LoanBatch) -> list[LoanResponse]:
        if not self.enabled:
            raise RuntimeError("Grist n'est pas active : configurez GRIST_API_KEY, GRIST_DOC_ID et GRIST_ENABLED=true.")
        return_date = loan.loan_date + timedelta(days=20)
        loans = [Loan(
            name=loan.name, first_name=loan.first_name, professional_email=loan.professional_email,
            school=loan.school, loan_date=loan.loan_date, game_id=game_id,
        ) for game_id in loan.game_ids]
        payload = {"records": [{"fields": {
            "Nom": item.name, "Prenom": item.first_name,
            "Mail_professionnel": str(item.professional_email), "Ecole": item.school,
            "Date_Emprunt": item.loan_date.isoformat(), "Retour": return_date.isoformat(),
            "Jeu": item.game_id,
        }} for item in loans]}
        result = await self._request("POST", settings.grist_loans_table, json=payload)
        record_ids = [item.get("id") for item in result.get("records", [])]
        return [LoanResponse(**item.model_dump(), id=record_id, return_date=return_date) for item, record_id in zip(loans, record_ids)]
