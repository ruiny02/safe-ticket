"""SQLAlchemy models for the initial Safe Ticket backend schema."""

from __future__ import annotations

from datetime import datetime

from pgvector.sqlalchemy import VECTOR
from sqlalchemy import Boolean
from sqlalchemy import CheckConstraint
from sqlalchemy import DateTime
from sqlalchemy import Float
from sqlalchemy import ForeignKey
from sqlalchemy import Index
from sqlalchemy import Integer
from sqlalchemy import JSON
from sqlalchemy import String
from sqlalchemy import Text
from sqlalchemy import UniqueConstraint
from sqlalchemy import text
from sqlalchemy.orm import Mapped
from sqlalchemy.orm import mapped_column
from sqlalchemy.orm import relationship

from app.db.base import Base


# SQLite does not support PostgreSQL's now() function, but both SQLite and
# PostgreSQL understand CURRENT_TIMESTAMP as a server-side default value.
TIMESTAMP_DEFAULT = text("CURRENT_TIMESTAMP")


class Case(Base):
    __tablename__ = "cases"

    case_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    source_type: Mapped[str] = mapped_column(String(32), nullable=False)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    label: Mapped[str | None] = mapped_column(String(32), nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    platform_hint: Mapped[str | None] = mapped_column(String(32), nullable=True)
    risk_level: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    risk_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    risk_flags_json: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=TIMESTAMP_DEFAULT,
    )

    chunks: Mapped[list["CaseChunk"]] = relationship(back_populates="case", cascade="all, delete-orphan")
    entities: Mapped[list["CaseEntity"]] = relationship(back_populates="case", cascade="all, delete-orphan")
    similar_scan_matches: Mapped[list["ScanSimilarCase"]] = relationship(back_populates="case")


class CaseChunk(Base):
    __tablename__ = "case_chunks"
    __table_args__ = (
        UniqueConstraint("case_id", "chunk_order", name="uq_case_chunks_case_id_chunk_order"),
    )

    chunk_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    case_id: Mapped[str] = mapped_column(
        ForeignKey("cases.case_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    chunk_text: Mapped[str] = mapped_column(Text, nullable=False)
    chunk_order: Mapped[int] = mapped_column(Integer, nullable=False)
    embedding: Mapped[object | None] = mapped_column(VECTOR(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=TIMESTAMP_DEFAULT,
    )

    case: Mapped["Case"] = relationship(back_populates="chunks")
    similar_scan_matches: Mapped[list["ScanSimilarCase"]] = relationship(back_populates="chunk")


class CaseEntity(Base):
    __tablename__ = "case_entities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    case_id: Mapped[str] = mapped_column(
        ForeignKey("cases.case_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    entity_type: Mapped[str] = mapped_column(String(32), nullable=False)
    entity_value_raw: Mapped[str | None] = mapped_column(Text, nullable=True)
    entity_value_hash: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=TIMESTAMP_DEFAULT,
    )

    case: Mapped["Case"] = relationship(back_populates="entities")


class Scan(Base):
    __tablename__ = "scans"

    scan_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    platform: Mapped[str] = mapped_column(String(32), nullable=False)
    page_url: Mapped[str] = mapped_column(Text, nullable=False)
    page_title: Mapped[str] = mapped_column(Text, nullable=False)
    price: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    risk_level: Mapped[str | None] = mapped_column(String(16), nullable=True)
    risk_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    llm_reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    risk_tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    evidence_items_json: Mapped[list[dict]] = mapped_column(JSON, nullable=False, default=list)
    highlight_targets_json: Mapped[list[dict]] = mapped_column(JSON, nullable=False, default=list)
    similar_cases_json: Mapped[list[dict]] = mapped_column(JSON, nullable=False, default=list)
    recommended_actions_json: Mapped[list[dict]] = mapped_column(JSON, nullable=False, default=list)
    external_lookup_results_json: Mapped[list[dict]] = mapped_column(JSON, nullable=False, default=list)
    degraded: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    report_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=TIMESTAMP_DEFAULT,
        index=True,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=TIMESTAMP_DEFAULT,
        onupdate=datetime.utcnow,
    )

    blocks: Mapped[list["ScanBlock"]] = relationship(back_populates="scan", cascade="all, delete-orphan")
    evidence_items: Mapped[list["ScanEvidenceItem"]] = relationship(
        back_populates="scan",
        cascade="all, delete-orphan",
    )
    similar_cases: Mapped[list["ScanSimilarCase"]] = relationship(
        back_populates="scan",
        cascade="all, delete-orphan",
    )
    pipeline_exchange: Mapped["PipelineExchange | None"] = relationship(
        back_populates="scan",
        cascade="all, delete-orphan",
    )


class ScanBlock(Base):
    __tablename__ = "scan_blocks"
    __table_args__ = (
        UniqueConstraint("scan_id", "block_id", name="uq_scan_blocks_scan_id_block_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    scan_id: Mapped[str] = mapped_column(
        ForeignKey("scans.scan_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    block_id: Mapped[str] = mapped_column(String(64), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)

    scan: Mapped["Scan"] = relationship(back_populates="blocks")


class ScanEvidenceItem(Base):
    __tablename__ = "scan_evidence_items"
    __table_args__ = (
        CheckConstraint("start_offset >= 0", name="start_offset_non_negative"),
        CheckConstraint("end_offset >= start_offset", name="end_offset_after_start_offset"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    scan_id: Mapped[str] = mapped_column(
        ForeignKey("scans.scan_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    block_id: Mapped[str] = mapped_column(String(64), nullable=False)
    start_offset: Mapped[int] = mapped_column(Integer, nullable=False)
    end_offset: Mapped[int] = mapped_column(Integer, nullable=False)
    matched_text: Mapped[str] = mapped_column(Text, nullable=False)
    reason_code: Mapped[str] = mapped_column(String(64), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)

    scan: Mapped["Scan"] = relationship(back_populates="evidence_items")


class ScanSimilarCase(Base):
    __tablename__ = "scan_similar_cases"
    __table_args__ = (
        UniqueConstraint("scan_id", "rank", name="uq_scan_similar_cases_scan_id_rank"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    scan_id: Mapped[str] = mapped_column(
        ForeignKey("scans.scan_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    case_id: Mapped[str] = mapped_column(
        ForeignKey("cases.case_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    chunk_id: Mapped[int | None] = mapped_column(
        ForeignKey("case_chunks.chunk_id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    similarity_score: Mapped[float] = mapped_column(Float, nullable=False)
    rank: Mapped[int] = mapped_column(Integer, nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)

    scan: Mapped["Scan"] = relationship(back_populates="similar_cases")
    case: Mapped["Case"] = relationship(back_populates="similar_scan_matches")
    chunk: Mapped["CaseChunk | None"] = relationship(back_populates="similar_scan_matches")


class PipelineExchange(Base):
    __tablename__ = "pipeline_exchanges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    scan_id: Mapped[str] = mapped_column(
        ForeignKey("scans.scan_id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    outbound_payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    inbound_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    pipeline_error: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=TIMESTAMP_DEFAULT,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=TIMESTAMP_DEFAULT,
        onupdate=datetime.utcnow,
    )

    scan: Mapped["Scan"] = relationship(back_populates="pipeline_exchange")


class SellerObservation(Base):
    __tablename__ = "seller_observations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    platform: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    seller_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    nickname: Mapped[str | None] = mapped_column(String(255), nullable=True)
    account_hash: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    phone_hash: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    messenger_hash: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    source_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=TIMESTAMP_DEFAULT,
    )


Index("ix_cases_source_type_created_at", Case.source_type, Case.created_at)
Index("ix_case_entities_case_id_entity_type", CaseEntity.case_id, CaseEntity.entity_type)
Index("ix_scans_platform_created_at", Scan.platform, Scan.created_at)
Index("ix_seller_observations_platform_seller_id", SellerObservation.platform, SellerObservation.seller_id)
