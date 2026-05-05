from sqlalchemy import Column, DateTime, Integer, JSON, String, Text
from sqlalchemy.orm import declarative_base
from sqlalchemy.sql import func

Base = declarative_base()


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


def init_db(engine) -> None:
    Base.metadata.create_all(engine)