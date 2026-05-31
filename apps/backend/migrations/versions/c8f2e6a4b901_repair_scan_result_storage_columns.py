"""repair scan result storage columns

This migration is intentionally idempotent because some local development
databases were created before the initial schema file was expanded with scan
result JSON columns and pipeline exchange persistence.
"""

from alembic import op
import sqlalchemy as sa


revision = "c8f2e6a4b901"
down_revision = "a7f4c2e9b831"
branch_labels = None
depends_on = None

TIMESTAMP_DEFAULT = sa.text("CURRENT_TIMESTAMP")


def _has_table(table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table_name in inspector.get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def _add_json_list_column_if_missing(table_name: str, column_name: str) -> None:
    if _has_column(table_name, column_name):
        return

    op.add_column(
        table_name,
        sa.Column(
            column_name,
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'"),
        ),
    )


def upgrade() -> None:
    _add_json_list_column_if_missing("scans", "risk_tags")
    _add_json_list_column_if_missing("scans", "evidence_items_json")
    _add_json_list_column_if_missing("scans", "highlight_targets_json")
    _add_json_list_column_if_missing("scans", "similar_cases_json")
    _add_json_list_column_if_missing("scans", "recommended_actions_json")

    if not _has_column("scans", "report_url"):
        op.add_column("scans", sa.Column("report_url", sa.Text(), nullable=True))

    if not _has_table("pipeline_exchanges"):
        op.create_table(
            "pipeline_exchanges",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("scan_id", sa.String(length=64), nullable=False),
            sa.Column("outbound_payload", sa.JSON(), nullable=False),
            sa.Column("inbound_payload", sa.JSON(), nullable=True),
            sa.Column("pipeline_error", sa.JSON(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=TIMESTAMP_DEFAULT,
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=TIMESTAMP_DEFAULT,
                nullable=False,
            ),
            sa.ForeignKeyConstraint(
                ["scan_id"],
                ["scans.scan_id"],
                name=op.f("fk_pipeline_exchanges_scan_id_scans"),
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id", name=op.f("pk_pipeline_exchanges")),
            sa.UniqueConstraint("scan_id", name=op.f("uq_pipeline_exchanges_scan_id")),
        )


def downgrade() -> None:
    # This is a compatibility repair for stale local development volumes.
    # Dropping these fields on downgrade would remove columns that already
    # belong to the initial schema in fresh databases, so keep downgrade safe.
    pass
