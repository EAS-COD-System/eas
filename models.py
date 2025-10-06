from sqlalchemy.orm import declarative_base, Mapped, mapped_column
from sqlalchemy import String, Integer, Float, Boolean, ForeignKey
Base = declarative_base()
class Product(Base):
    __tablename__='products'
    product_sku: Mapped[str] = mapped_column(String, primary_key=True)
    product_name: Mapped[str] = mapped_column(String)
    category: Mapped[str] = mapped_column(String, nullable=True)
    weight_g: Mapped[int] = mapped_column(Integer, nullable=True)
    cost_cn_usd: Mapped[float] = mapped_column(Float, default=0.0)
    default_cnke_ship_usd: Mapped[float] = mapped_column(Float, default=0.0)
    profit_ads_budget_usd: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String, default='active')
