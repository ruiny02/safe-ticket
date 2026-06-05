"""add case risk metadata"""

from alembic import op
import sqlalchemy as sa


revision = "5f4d7c9a2b10"
down_revision = "c8f2e6a4b901"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def _has_index(table_name: str, index_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return index_name in {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    if not _has_column("cases", "risk_level"):
        op.add_column("cases", sa.Column("risk_level", sa.String(length=16), nullable=True))

    if not _has_index("cases", "ix_cases_risk_level"):
        op.create_index(op.f("ix_cases_risk_level"), "cases", ["risk_level"], unique=False)

    if not _has_column("cases", "risk_score"):
        op.add_column("cases", sa.Column("risk_score", sa.Float(), nullable=True))

    if not _has_column("cases", "risk_flags_json"):
        op.add_column(
            "cases",
            sa.Column(
                "risk_flags_json",
                sa.JSON(),
                nullable=False,
                server_default=sa.text("'[]'"),
            ),
        )


def downgrade() -> None:
    if _has_column("cases", "risk_flags_json"):
        op.drop_column("cases", "risk_flags_json")

    if _has_column("cases", "risk_score"):
        op.drop_column("cases", "risk_score")

    if _has_column("cases", "risk_level"):
        if _has_index("cases", "ix_cases_risk_level"):
            op.drop_index(op.f("ix_cases_risk_level"), table_name="cases")
        op.drop_column("cases", "risk_level")
