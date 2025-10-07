from sqlalchemy.orm import declarative_base, Mapped, mapped_column
from sqlalchemy import String, Integer, Float, Boolean, ForeignKey

Base = declarative_base()

# ---- Core catalog ----
class Product(Base):
    __tablename__ = "products"
    product_sku: Mapped[str] = mapped_column(String, primary_key=True)
    product_name: Mapped[str] = mapped_column(String, nullable=False)
    category: Mapped[str] = mapped_column(String, nullable=True)
    weight_g: Mapped[int] = mapped_column(Integer, nullable=True)
    # costing
    cost_cn_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)           # unit buy price in China
    default_cnke_ship_usd: Mapped[float] = mapped_column(Float, default=0.0)                 # unit ship CN->KE
    profit_ads_budget_usd: Mapped[float] = mapped_column(Float, default=0.0)                 # fallback per-unit budget
    status: Mapped[str] = mapped_column(String, default="active")

class Country(Base):
    __tablename__ = "countries"
    country: Mapped[str] = mapped_column(String, primary_key=True)   # "Kenya"
    code: Mapped[str] = mapped_column(String, nullable=False)        # "KE"
    currency: Mapped[str] = mapped_column(String, nullable=False)    # default: USD
    fx_to_usd: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)

class Warehouse(Base):
    __tablename__ = "warehouses"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String)
    country: Mapped[str] = mapped_column(String)  # human name e.g., "Kenya"
    code: Mapped[str] = mapped_column(String)     # country code e.g., "KE"
    active: Mapped[bool] = mapped_column(Boolean, default=True)

# ---- Inventory / logistics ----
class StockMovement(Base):
    __tablename__ = "stock_movements"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    date: Mapped[str] = mapped_column(String)  # YYYY-MM-DD
    product_sku: Mapped[str] = mapped_column(String, ForeignKey("products.product_sku"))
    from_wh: Mapped[int] = mapped_column(Integer, nullable=True)  # null means leaves system
    to_wh: Mapped[int] = mapped_column(Integer, nullable=True)    # null means delivered/sold
    qty: Mapped[int] = mapped_column(Integer)
    ref: Mapped[str] = mapped_column(String, nullable=True)

class Shipment(Base):
    __tablename__ = "shipments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ref: Mapped[str] = mapped_column(String)
    from_country: Mapped[str] = mapped_column(String)  # human name
    to_country: Mapped[str] = mapped_column(String)    # human name
    status: Mapped[str] = mapped_column(String)        # in_transit / arrived
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

# ---- Marketing spend (current daily numbers; replace on update) ----
class PlatformSpendCurrent(Base):
    __tablename__ = "platform_spend_current"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_sku: Mapped[str] = mapped_column(String, ForeignKey("products.product_sku"))
    platform: Mapped[str] = mapped_column(String)  # Facebook/TikTok/Google
    amount_usd: Mapped[float] = mapped_column(Float, default=0.0)
    country_code: Mapped[str] = mapped_column(String)  # "KE","UG",...

# ---- Operational KPIs ----
class DailyDelivered(Base):
    __tablename__ = "daily_delivered"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    date: Mapped[str] = mapped_column(String)            # YYYY-MM-DD
    country_code: Mapped[str] = mapped_column(String)    # KE/UG/TZ/ZM/ZW/...
    delivered: Mapped[int] = mapped_column(Integer, default=0)

# Remittance (weekly or custom period actuals -> drives profit)
class PeriodRemit(Base):
    __tablename__ = "period_remit"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    start_date: Mapped[str] = mapped_column(String)
    end_date: Mapped[str] = mapped_column(String)
    country_code: Mapped[str] = mapped_column(String)
    product_sku: Mapped[str] = mapped_column(String, ForeignKey("products.product_sku"))
    orders: Mapped[int] = mapped_column(Integer, default=0)
    pieces: Mapped[int] = mapped_column(Integer, default=0)
    revenue_usd: Mapped[float] = mapped_column(Float, default=0.0)
    ad_usd: Mapped[float] = mapped_column(Float, default=0.0)
    cost_unit_usd: Mapped[float] = mapped_column(Float, default=0.0)
    profit_total_usd: Mapped[float] = mapped_column(Float, default=0.0)
    profit_per_piece_usd: Mapped[float] = mapped_column(Float, default=0.0)

# Per-country per-product target budget (for “profit + ads” per country)
class ProductBudgetCountry(Base):
    __tablename__ = "product_budget_country"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_sku: Mapped[str] = mapped_column(String, ForeignKey("products.product_sku"))
    country_code: Mapped[str] = mapped_column(String)
    budget_usd: Mapped[float] = mapped_column(Float, default=0.0)

# ---- Finance ----
class FinanceEntry(Base):
    __tablename__ = "finance_entries"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    date: Mapped[str] = mapped_column(String)            # YYYY-MM-DD
    type: Mapped[str] = mapped_column(String)            # credit / debit
    category: Mapped[str] = mapped_column(String)        # user-defined
    description: Mapped[str] = mapped_column(String)
    amount_usd: Mapped[float] = mapped_column(Float, default=0.0)
