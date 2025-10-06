from sqlalchemy.orm import declarative_base, Mapped, mapped_column
from sqlalchemy import String, Integer, Float, Boolean, ForeignKey

Base = declarative_base()

class Product(Base):
    __tablename__ = "products"
    product_sku: Mapped[str] = mapped_column(String, primary_key=True)
    product_name: Mapped[str] = mapped_column(String, nullable=False)
    category: Mapped[str] = mapped_column(String, nullable=True)
    weight_g: Mapped[int] = mapped_column(Integer, nullable=True)
    cost_cn_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    default_cnke_ship_usd: Mapped[float] = mapped_column(Float, default=0.0)
    profit_ads_budget_usd: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String, default="active")

class Country(Base):
    __tablename__ = "countries"
    country: Mapped[str] = mapped_column(String, primary_key=True)
    code: Mapped[str] = mapped_column(String, nullable=False)
    currency: Mapped[str] = mapped_column(String, nullable=False)
    fx_to_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

class Warehouse(Base):
    __tablename__ = "warehouses"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String)
    country: Mapped[str] = mapped_column(String)
    code: Mapped[str] = mapped_column(String)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

class StockMovement(Base):
    __tablename__ = "stock_movements"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    date: Mapped[str] = mapped_column(String)
    product_sku: Mapped[str] = mapped_column(String, ForeignKey("products.product_sku"))
    from_wh: Mapped[int] = mapped_column(Integer, nullable=True)
    to_wh: Mapped[int] = mapped_column(Integer, nullable=True)
    qty: Mapped[int] = mapped_column(Integer)
    ref: Mapped[str] = mapped_column(String, nullable=True)

class PlatformSpendCurrent(Base):
    __tablename__ = "platform_spend_current"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_sku: Mapped[str] = mapped_column(String, ForeignKey("products.product_sku"))
    platform: Mapped[str] = mapped_column(String)
    amount_usd: Mapped[float] = mapped_column(Float, default=0.0)  # daily, not in profit
    currency: Mapped[str] = mapped_column(String)
    country_code: Mapped[str] = mapped_column(String)

class Shipment(Base):
    __tablename__ = "shipments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ref: Mapped[str] = mapped_column(String)
    from_country: Mapped[str] = mapped_column(String)
    to_country: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String)  # in_transit / arrived
    created_date: Mapped[str] = mapped_column(String, nullable=True)
    eta_date: Mapped[str] = mapped_column(String, nullable=True)
    arrived_date: Mapped[str] = mapped_column(String, nullable=True)
    shipping_cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    purchase_cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    transit_days: Mapped[int] = mapped_column(Integer, default=0)

class ShipmentItem(Base):
    __tablename__ = "shipment_items"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    shipment_id: Mapped[int] = mapped_column(Integer, ForeignKey("shipments.id"))
    product_sku: Mapped[str] = mapped_column(String, ForeignKey("products.product_sku"))
    qty: Mapped[int] = mapped_column(Integer)

class WeeklyCountryPerf(Base):
    __tablename__ = "weekly_country_perf"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    week_start: Mapped[str] = mapped_column(String)  # Monday date
    country_code: Mapped[str] = mapped_column(String)
    delivered_count: Mapped[int] = mapped_column(Integer, default=0)

class WeeklyProductPerf(Base):
    __tablename__ = "weekly_product_perf"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    week_start: Mapped[str] = mapped_column(String)  # Monday date
    country_code: Mapped[str] = mapped_column(String)
    product_sku: Mapped[str] = mapped_column(String, ForeignKey("products.product_sku"))
    delivered_qty: Mapped[int] = mapped_column(Integer, default=0)
    revenue_usd: Mapped[float] = mapped_column(Float, default=0.0)
    ad_spend_usd: Mapped[float] = mapped_column(Float, default=0.0)
