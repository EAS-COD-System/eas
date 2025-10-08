from sqlalchemy.orm import declarative_base, Mapped, mapped_column
from sqlalchemy import String, Integer, Float, ForeignKey, Boolean, Text

Base = declarative_base()

class Product(Base):
    __tablename__ = "products"
    product_sku: Mapped[str] = mapped_column(String(40), primary_key=True)
    product_name: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(120), default="")
    weight_g: Mapped[int] = mapped_column(Integer, default=0)
    cost_cn_usd: Mapped[float] = mapped_column(Float, default=0.0)
    default_cnke_ship_usd: Mapped[float] = mapped_column(Float, default=0.0)
    profit_ads_budget_usd: Mapped[float] = mapped_column(Float, default=0.0)

class Country(Base):
    __tablename__ = "countries"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    country: Mapped[str] = mapped_column(String(80), unique=True)
    code: Mapped[str] = mapped_column(String(4), unique=True)
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    fx_to_usd: Mapped[float] = mapped_column(Float, default=1.0)

class Warehouse(Base):
    __tablename__ = "warehouses"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120))
    country: Mapped[str] = mapped_column(String(80))
    code: Mapped[str] = mapped_column(String(4))
    active: Mapped[bool] = mapped_column(Boolean, default=True)

class StockMovement(Base):
    __tablename__ = "stock_movements"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    date: Mapped[str] = mapped_column(String(12))
    product_sku: Mapped[str] = mapped_column(String(40), ForeignKey("products.product_sku"))
    from_wh: Mapped[int] = mapped_column(Integer, nullable=True)
    to_wh: Mapped[int] = mapped_column(Integer, nullable=True)
    qty: Mapped[int] = mapped_column(Integer, default=0)
    ref: Mapped[str] = mapped_column(String(60), default="")

class Shipment(Base):
    __tablename__ = "shipments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ref: Mapped[str] = mapped_column(String(60))
    from_country: Mapped[str] = mapped_column(String(80))
    to_country: Mapped[str] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(20), default="in_transit")
    created_date: Mapped[str] = mapped_column(String(12), default="")
    arrived_date: Mapped[str] = mapped_column(String(12), nullable=True)
    transit_days: Mapped[int] = mapped_column(Integer, default=0)
    shipping_cost_usd: Mapped[float] = mapped_column(Float, default=0.0)

class ShipmentItem(Base):
    __tablename__ = "shipment_items"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    shipment_id: Mapped[int] = mapped_column(Integer, ForeignKey("shipments.id"))
    product_sku: Mapped[str] = mapped_column(String(40))
    qty: Mapped[int] = mapped_column(Integer, default=0)

class PlatformSpendCurrent(Base):
    __tablename__ = "platform_spend_current"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_sku: Mapped[str] = mapped_column(String(40))
    platform: Mapped[str] = mapped_column(String(20))
    amount_usd: Mapped[float] = mapped_column(Float, default=0.0)
    country_code: Mapped[str] = mapped_column(String(4))

class DailyDelivered(Base):
    __tablename__ = "daily_delivered"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    date: Mapped[str] = mapped_column(String(12))
    country_code: Mapped[str] = mapped_column(String(4))
    delivered: Mapped[int] = mapped_column(Integer, default=0)

class PeriodRemit(Base):
    __tablename__ = "period_remit"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    start_date: Mapped[str] = mapped_column(String(12))
    end_date: Mapped[str] = mapped_column(String(12))
    country_code: Mapped[str] = mapped_column(String(4))
    product_sku: Mapped[str] = mapped_column(String(40))
    orders: Mapped[int] = mapped_column(Integer, default=0)
    pieces: Mapped[int] = mapped_column(Integer, default=0)
    revenue_usd: Mapped[float] = mapped_column(Float, default=0.0)
    ad_usd: Mapped[float] = mapped_column(Float, default=0.0)
    extra_ship_per_piece_usd: Mapped[float] = mapped_column(Float, default=0.0)
    cost_unit_usd: Mapped[float] = mapped_column(Float, default=0.0)
    profit_total_usd: Mapped[float] = mapped_column(Float, default=0.0)
    profit_per_piece_usd: Mapped[float] = mapped_column(Float, default=0.0)

class ProductBudgetCountry(Base):
    __tablename__ = "product_budget_country"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_sku: Mapped[str] = mapped_column(String(40))
    country_code: Mapped[str] = mapped_column(String(4))
    budget_usd: Mapped[float] = mapped_column(Float, default=0.0)

class FinanceCategory(Base):
    __tablename__ = "finance_categories"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)

class FinanceEntry(Base):
    __tablename__ = "finance_entries"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    date: Mapped[str] = mapped_column(String(12))
    type: Mapped[str] = mapped_column(String(10))
    category_id: Mapped[int] = mapped_column(Integer, ForeignKey("finance_categories.id"), nullable=True)
    category_name: Mapped[str] = mapped_column(String(80), default="")
    description: Mapped[str] = mapped_column(Text)
    amount_usd: Mapped[float] = mapped_column(Float, default=0.0)

class TodoItem(Base):
    __tablename__ = "todo_items"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="todo")
    weekly_day: Mapped[str] = mapped_column(String(10), nullable=True)
    created_at: Mapped[str] = mapped_column(String(19))
