from sqlalchemy.orm import declarative_base, Mapped, mapped_column
from sqlalchemy import Integer, String, Float, Boolean, Text

Base = declarative_base()

class Product(Base):
    __tablename__ = "products"
    product_sku: Mapped[str] = mapped_column(String, primary_key=True)
    product_name: Mapped[str] = mapped_column(String, nullable=False)
    category: Mapped[str] = mapped_column(String, default="")
    weight_g: Mapped[int] = mapped_column(Integer, default=0)
    cost_cn_usd: Mapped[float] = mapped_column(Float, default=0.0)
    default_cnke_ship_usd: Mapped[float] = mapped_column(Float, default=0.0)
    profit_ads_budget_usd: Mapped[float] = mapped_column(Float, default=0.0)

class Country(Base):
    __tablename__ = "countries"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    country: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    code: Mapped[str] = mapped_column(String, unique=True, nullable=False)   # KE,TZ,UG,ZM,ZW,CN, etc
    currency: Mapped[str] = mapped_column(String, default="USD")
    fx_to_usd: Mapped[float] = mapped_column(Float, default=1.0)

class Warehouse(Base):
    __tablename__ = "warehouses"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    country: Mapped[str] = mapped_column(String, nullable=False)  # Human name
    code: Mapped[str] = mapped_column(String, nullable=False)     # KE/TZ/…
    active: Mapped[bool] = mapped_column(Boolean, default=True)

class StockMovement(Base):
    __tablename__ = "stock_movements"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    date: Mapped[str] = mapped_column(String, nullable=False)  # ISO date
    product_sku: Mapped[str] = mapped_column(String, nullable=False)
    from_wh: Mapped[int] = mapped_column(Integer, nullable=True)
    to_wh: Mapped[int] = mapped_column(Integer, nullable=True)
    qty: Mapped[int] = mapped_column(Integer, default=0)
    ref: Mapped[str] = mapped_column(String, default="")

class PlatformSpendCurrent(Base):
    __tablename__ = "platform_spend_current"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_sku: Mapped[str] = mapped_column(String, nullable=False)
    platform: Mapped[str] = mapped_column(String, nullable=False)    # Facebook/TikTok/Google
    amount_usd: Mapped[float] = mapped_column(Float, default=0.0)
    country_code: Mapped[str] = mapped_column(String, nullable=False) # KE/TZ/UG/ZM/ZW…

class Shipment(Base):
    __tablename__ = "shipments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ref: Mapped[str] = mapped_column(String, nullable=False)
    from_country: Mapped[str] = mapped_column(String, nullable=False)
    to_country: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, default="in_transit") # in_transit/arrived
    created_date: Mapped[str] = mapped_column(String, nullable=True)
    arrived_date: Mapped[str] = mapped_column(String, nullable=True)
    transit_days: Mapped[int] = mapped_column(Integer, default=0)
    shipping_cost_usd: Mapped[float] = mapped_column(Float, default=0.0)

class ShipmentItem(Base):
    __tablename__ = "shipment_items"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    shipment_id: Mapped[int] = mapped_column(Integer, nullable=False)
    product_sku: Mapped[str] = mapped_column(String, nullable=False)
    qty: Mapped[int] = mapped_column(Integer, default=0)

class DailyDelivered(Base):
    __tablename__ = "daily_delivered"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    date: Mapped[str] = mapped_column(String, nullable=False)          # ISO date
    country_code: Mapped[str] = mapped_column(String, nullable=False)  # KE,TZ,UG,ZM,ZW
    delivered: Mapped[int] = mapped_column(Integer, default=0)

class PeriodRemit(Base):
    __tablename__ = "period_remit"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    start_date: Mapped[str] = mapped_column(String, nullable=False)
    end_date: Mapped[str] = mapped_column(String, nullable=False)
    country_code: Mapped[str] = mapped_column(String, nullable=False)
    product_sku: Mapped[str] = mapped_column(String, nullable=False)
    orders: Mapped[int] = mapped_column(Integer, default=0)
    pieces: Mapped[int] = mapped_column(Integer, default=0)
    revenue_usd: Mapped[float] = mapped_column(Float, default=0.0)
    ad_usd: Mapped[float] = mapped_column(Float, default=0.0)
    cost_unit_usd: Mapped[float] = mapped_column(Float, default=0.0)
    profit_total_usd: Mapped[float] = mapped_column(Float, default=0.0)
    profit_per_piece_usd: Mapped[float] = mapped_column(Float, default=0.0)

class ProductBudgetCountry(Base):
    __tablename__ = "product_budget_country"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_sku: Mapped[str] = mapped_column(String, nullable=False)
    country_code: Mapped[str] = mapped_column(String, nullable=False)
    budget_usd: Mapped[float] = mapped_column(Float, default=0.0)

class FinanceEntry(Base):
    __tablename__ = "finance_entries"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    date: Mapped[str] = mapped_column(String, nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)   # credit/debit
    category: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    amount_usd: Mapped[float] = mapped_column(Float, default=0.0)
