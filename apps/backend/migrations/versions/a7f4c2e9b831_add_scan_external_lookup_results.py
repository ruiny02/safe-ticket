"""add scan external lookup results"""

from alembic import op
import sqlalchemy as sa


revision = "a7f4c2e9b831"
down_revision = "63da3c25624b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "scans",
        sa.Column(
            "external_lookup_results_json",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'"),
        ),
    )


def downgrade() -> None:
    op.drop_column("scans", "external_lookup_results_json")
