"""Application settings for the FastAPI backend."""

from functools import lru_cache
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """Typed settings loaded from environment variables or defaults."""

    # Project metadata is used by the application bootstrap and docs.
    project_name: str = Field(default="safe-ticket-backend", alias="PROJECT_NAME")
    api_v1_prefix: str = "/api/v1"

    # Polling values are returned to the frontend when scans are created.
    scan_poll_interval_ms: int = Field(default=2000, alias="SCAN_POLL_INTERVAL_MS")
    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=list, alias="BACKEND_CORS_ORIGINS")
    database_url: str = Field(default="sqlite:///./safe_ticket.db", alias="DATABASE_URL")

    # Frontend report pages use hash routing, so the backend stores a complete report link.
    frontend_report_base_url: str = Field(
        default="http://localhost:3000/report/#/reports",
        alias="FRONTEND_REPORT_BASE_URL",
    )

    # Pipeline integration settings control backend-to-pipeline HTTP calls.
    pipeline_base_url: str = Field(default="http://pipeline:8010", alias="PIPELINE_BASE_URL")
    pipeline_analyze_path: str = Field(default="api/v1/analyze", alias="PIPELINE_ANALYZE_PATH")
    pipeline_timeout_seconds: float = Field(default=60.0, alias="PIPELINE_TIMEOUT_SECONDS")
    pipeline_api_key: str = Field(default="", alias="PIPELINE_API_KEY")

    # Gemini API settings are role-specific so each AI task can move models independently.
    gemini_api_key: str = Field(default="", alias="GEMINI_API_KEY")
    gemini_chat_model: str = Field(default="gemini-3.1-flash-lite", alias="GEMINI_CHAT_MODEL")
    gemini_analysis_model: str = Field(default="gemini-3.1-flash-lite", alias="GEMINI_ANALYSIS_MODEL")
    gemini_embedding_model: str = Field(default="gemini-embedding-2", alias="GEMINI_EMBEDDING_MODEL")
    gemini_scan_analysis_enabled: bool = Field(default=False, alias="GEMINI_SCAN_ANALYSIS_ENABLED")
    gemini_api_timeout_seconds: float = Field(default=30.0, alias="GEMINI_API_TIMEOUT_SECONDS")
    gemini_max_retries: int = Field(default=1, alias="GEMINI_MAX_RETRIES")

    # External lookup automation uses a user-created TheCheat browser session if available.
    external_lookup_enabled: bool = Field(default=True, alias="EXTERNAL_LOOKUP_ENABLED")
    sync_external_lookup_enabled: bool = Field(default=False, alias="SYNC_EXTERNAL_LOOKUP_ENABLED")
    external_lookup_timeout_ms: int = Field(default=15000, alias="EXTERNAL_LOOKUP_TIMEOUT_MS")
    thecheat_cdp_url: str = Field(default="", alias="THECHEAT_CDP_URL")

    # Risk-space artifacts are trained from existing DB embeddings and reused for scoring/maps.
    risk_space_artifact_dir: str = Field(default=".artifacts/risk_space", alias="RISK_SPACE_ARTIFACT_DIR")

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
