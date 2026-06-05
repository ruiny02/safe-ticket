from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy import text
from sqlalchemy.orm import declarative_base
from sqlalchemy.sql import func

try:
    from pgvector.sqlalchemy import VECTOR
except ImportError:  # pragma: no cover - allows JSON fallback in lightweight local envs.
    VECTOR = None

Base = declarative_base()
EMBEDDING_DIM = 128
EmbeddingColumnType = VECTOR(EMBEDDING_DIM) if VECTOR else JSON


class FraudPost(Base):
    __tablename__ = "fraud_posts"

    id = Column(Integer, primary_key=True, autoincrement=True)

    platform = Column(String(50), nullable=False, index=True)
    url = Column(String(500), nullable=False, unique=True, index=True)

    title = Column(Text, nullable=True)
    content = Column(Text, nullable=True)
    price = Column(String(100), nullable=True)
    seller_id = Column(String(255), nullable=True)

    phone_number = Column(String(20), nullable=True)
    account_number = Column(String(100), nullable=True)
    kakao_id = Column(String(50), nullable=True)

    risk_flags = Column(JSON, nullable=True)
    quality_flags = Column(JSON, nullable=True)
    data_quality_score = Column(Integer, nullable=True)

    raw_html = Column(Text, nullable=True)
    rendered_text = Column(Text, nullable=True)
    text_for_embedding = Column(Text, nullable=True)

    is_valid_post = Column(String(10), nullable=True)
    validation_reason = Column(String(100), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())


class EmbeddingCase(Base):
    __tablename__ = "pipeline_embedding_cases"

    case_id = Column(String(64), primary_key=True)
    source_type = Column(String(32), nullable=False)
    source_url = Column(Text, nullable=True)
    title = Column(Text, nullable=True)
    body = Column(Text, nullable=False)
    label = Column(String(32), nullable=True)
    summary = Column(Text, nullable=True)
    platform_hint = Column(String(32), nullable=True, index=True)

    entities_json = Column(JSON, nullable=True)
    seller_observation_json = Column(JSON, nullable=True)
    pipeline_metadata_json = Column(JSON, nullable=True)

    embedding_model = Column(String(100), nullable=True)
    embedding_dim = Column(Integer, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())


class EmbeddingChunk(Base):
    __tablename__ = "pipeline_embedding_chunks"
    __table_args__ = (
        UniqueConstraint("case_id", "chunk_order", name="uq_pipeline_embedding_chunks_case_order"),
    )

    chunk_id = Column(Integer, primary_key=True, autoincrement=True)
    case_id = Column(
        String(64),
        ForeignKey("pipeline_embedding_cases.case_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    chunk_order = Column(Integer, nullable=False)
    chunk_text = Column(Text, nullable=False)
    embedding = Column(EmbeddingColumnType, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


def init_db(engine) -> None:
    if engine.dialect.name == "postgresql":
        with engine.begin() as connection:
            connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))

    Base.metadata.create_all(engine)
