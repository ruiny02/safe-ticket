import os

from dotenv import load_dotenv
from sqlalchemy import create_engine

load_dotenv()


def get_database_url() -> str:
    db_url = os.getenv("DATABASE_URL")
    if db_url:
        return db_url

    db_url = os.getenv("POSTGRES_URI")
    if db_url:
        return db_url

    user = os.getenv("POSTGRES_USER", "postgres")
    password = os.getenv("POSTGRES_PASSWORD", "postgres")
    host = os.getenv("POSTGRES_HOST", "localhost")
    port = os.getenv("POSTGRES_PORT", "5432")
    dbname = os.getenv("POSTGRES_DB", "safe_ticket")

    return f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{dbname}"


def get_engine():
    return create_engine(get_database_url(), echo=False, future=True)
