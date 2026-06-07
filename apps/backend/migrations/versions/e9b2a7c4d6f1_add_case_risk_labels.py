"""add case risk labels"""

from alembic import op
import sqlalchemy as sa


revision = "e9b2a7c4d6f1"
down_revision = "d4e1a1f8c2b0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("cases", sa.Column("risk_level", sa.String(length=16), nullable=True))
    op.add_column("cases", sa.Column("risk_score", sa.Float(), nullable=True))
    op.add_column(
        "cases",
        sa.Column("risk_flags_json", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
    )
    op.create_index(op.f("ix_cases_risk_level"), "cases", ["risk_level"], unique=False)
    op.create_index(op.f("ix_cases_risk_score"), "cases", ["risk_score"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_cases_risk_score"), table_name="cases")
    op.drop_index(op.f("ix_cases_risk_level"), table_name="cases")
    op.drop_column("cases", "risk_flags_json")
    op.drop_column("cases", "risk_score")
    op.drop_column("cases", "risk_level")
