"""Application settings for the FastAPI backend."""

from functools import lru_cache
from typing import Annotated

from pydantic import Field
from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """Typed settings loaded from environment variables or defaults."""

    # Project metadata is used by the application bootstrap and docs.
    project_name: str = Field(default="safe-ticket-backend", alias="PROJECT_NAME")
    api_v1_prefix: str = "/api/v1"

    # Polling values are returned to the frontend when scans are created.
    scan_poll_interval_ms: int = Field(default=2000, alias="SCAN_POLL_INTERVAL_MS")
    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=list, alias="BACKEND_CORS_ORIGINS")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )
    
    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_cors_origins(cls, value: str | list[str]) -> list[str]:
        """Accept either a list or a comma-separated string from the environment."""
        if isinstance(value, list):
            return value
        if not value:
            return []
        return [item.strip() for item in value.split(",") if item.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cache settings so every import sees the same configuration object."""
    return Settings()
