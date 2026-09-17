from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    grist_api_key: str = ""
    grist_doc_id: str = ""
    grist_base_url: str = "https://grist.numerique.gouv.fr"
    grist_inventory_table: str = "Inventaire des jeux"
    grist_loans_table: str = "Emprunts"
    grist_enabled: bool = False

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
