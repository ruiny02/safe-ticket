"""add raw posts ingest table"""

from alembic import op
import sqlalchemy as sa


revision = "d4e1a1f8c2b0"
down_revision = "c8f2e6a4b901"
branch_labels = None
depends_on = None

TIMESTAMP_DEFAULT = sa.text("CURRENT_TIMESTAMP")


def upgrade() -> None:
    op.create_table(
        "raw_posts",
        sa.Column("raw_post_id", sa.String(length=64), nullable=False),
        sa.Column("platform", sa.String(length=32), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("price", sa.String(length=100), nullable=True),
        sa.Column("seller_id", sa.String(length=255), nullable=True),
        sa.Column("raw_html", sa.Text(), nullable=True),
        sa.Column("rendered_text", sa.Text(), nullable=True),
        sa.Column("raw_payload", sa.JSON(), nullable=False),
        sa.Column("ingest_source", sa.String(length=64), nullable=False),
        sa.Column("source_file", sa.Text(), nullable=True),
        sa.Column("crawled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=TIMESTAMP_DEFAULT, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=TIMESTAMP_DEFAULT, nullable=False),
        sa.PrimaryKeyConstraint("raw_post_id", name=op.f("pk_raw_posts")),
    )
    op.create_index(op.f("ix_raw_posts_platform"), "raw_posts", ["platform"], unique=False)
    op.create_index("ix_raw_posts_platform_crawled_at", "raw_posts", ["platform", "crawled_at"], unique=False)
    op.create_index("ix_raw_posts_source_url", "raw_posts", ["source_url"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_raw_posts_source_url", table_name="raw_posts")
    op.drop_index("ix_raw_posts_platform_crawled_at", table_name="raw_posts")
    op.drop_index(op.f("ix_raw_posts_platform"), table_name="raw_posts")
    op.drop_table("raw_posts")
