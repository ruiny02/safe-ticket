"""SQLAlchemy engine and session helpers for backend persistence."""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings


def create_db_engine(database_url: str | None = None):
    """Create the shared SQLAlchemy engine."""
    resolved_url = database_url or get_settings().database_url
    connect_args = {"check_same_thread": False} if resolved_url.startswith("sqlite") else {}
    return create_engine(resolved_url, pool_pre_ping=True, connect_args=connect_args)


engine = create_db_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
