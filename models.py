# models.py
from datetime import datetime, date
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import CheckConstraint, UniqueConstraint

db = SQLAlchemy()


# ---------- Core reference tables ----------
class Country(db.Model):
    __tablename__ = "countries"
    # ISO-like 2–3 letter code (KE, UG, TZ, ZM, ZW, CN)
    code = db.Column(db.String(3), primary_key=True)
    name = db.Column(db.String(80), nullable=False, unique=True)
    currency = db.Column(db.String(8), nullable=False, default="USD")
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class Product(db.Model):
    __tablename__ = "products"
    id = db.Column(db.Integer, primary_key=True)

    # Basic info
    name = db.Column(db.String(120), nullable=False)
    sku = db.Column(db.String(64), nullable=True, unique=True)
    category = db.Column(db.String(64), nullable=True)

    # China costs (editable)
    cost_cn_usd = db.Column(db.Float, nullable=False, default=0.0)        # unit cost in China
    ship_cn_ke_usd = db.Column(db.Float, nullable=False, default=0.0)     # unit ship CN->KE

    # “Profit + Ads” target per country (editable, optional)
    profit_ads_ke = db.Column(db.Float, default=0.0)
    profit_ads_ug = db.Column(db.Float, default=0.0)
    profit_ads_tz = db.Column(db.Float, default=0.0)
    profit_ads_zm = db.Column(db.Float, default=0.0)
    profit_ads_zw = db.Column(db.Float, default=0.0)

    is_active = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


# ---------- Stock & spend ----------
class Stock(db.Model):
    """
    Snapshot/ledger per product & country (non-negative).
    We mutate qty up/down when shipments arrive or when deliveries are recorded.
    """
    __tablename__ = "stock"
    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey("products.id"), nullable=False, index=True)
    country_code = db.Column(db.String(3), db.ForeignKey("countries.code"), nullable=False, index=True)
    qty = db.Column(db.Integer, nullable=False, default=0)

    __table_args__ = (
        UniqueConstraint("product_id", "country_code", name="uix_stock_product_country"),
        CheckConstraint("qty >= 0", name="ck_stock_qty_nonneg"),
    )

    product = db.relationship("Product")
    country = db.relationship("Country")


PLATFORMS = ("facebook", "tiktok", "google")


class PlatformSpend(db.Model):
    """
    Current DAILY spend number (live value) per product+country+platform.
    You overwrite it; we keep updated_at for freshness.
    """
    __tablename__ = "platform_spend"
    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey("products.id"), nullable=False, index=True)
    country_code = db.Column(db.String(3), db.ForeignKey("countries.code"), nullable=False, index=True)
    platform = db.Column(db.String(16), nullable=False)  # one of PLATFORMS
    amount_usd = db.Column(db.Float, nullable=False, default=0.0)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("product_id", "country_code", "platform", name="uix_spend_unique"),
    )

    product = db.relationship("Product")
    country = db.relationship("Country")


class DailyDelivered(db.Model):
    """
    Daily delivered totals per country (ALL products) for performance tracking.
    """
    __tablename__ = "daily_delivered"
    id = db.Column(db.Integer, primary_key=True)
    country_code = db.Column(db.String(3), db.ForeignKey("countries.code"), nullable=False, index=True)
    day = db.Column(db.Date, nullable=False, index=True)
    delivered = db.Column(db.Integer, nullable=False, default=0)

    __table_args__ = (
        UniqueConstraint("country_code", "day", name="uix_delivered_country_day"),
        CheckConstraint("delivered >= 0", name="ck_delivered_nonneg"),
    )

    country = db.relationship("Country")


# ---------- Shipments ----------
class Shipment(db.Model):
    """
    Shipment header: CN->KE and inter-country.
    status = in_transit | arrived | cancelled
    """
    __tablename__ = "shipments"
    id = db.Column(db.Integer, primary_key=True)
    ref = db.Column(db.String(64), nullable=True, index=True)

    from_country = db.Column(db.String(3), db.ForeignKey("countries.code"), nullable=False, index=True)
    to_country = db.Column(db.String(3), db.ForeignKey("countries.code"), nullable=False, index=True)

    est_ship_cost_usd = db.Column(db.Float, default=0.0)   # estimated/full shipment cost (optional)
    final_ship_cost_usd = db.Column(db.Float, default=0.0) # editable after arrival

    status = db.Column(db.String(16), nullable=False, default="in_transit")
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    departed_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    arrived_at = db.Column(db.DateTime, nullable=True)

    from_c = db.relationship("Country", foreign_keys=[from_country])
    to_c = db.relationship("Country", foreign_keys=[to_country])


class ShipmentItem(db.Model):
    """
    Items inside a shipment.
    """
    __tablename__ = "shipment_items"
    id = db.Column(db.Integer, primary_key=True)
    shipment_id = db.Column(db.Integer, db.ForeignKey("shipments.id"), nullable=False, index=True)
    product_id = db.Column(db.Integer, db.ForeignKey("products.id"), nullable=False, index=True)
    qty = db.Column(db.Integer, nullable=False, default=0)
    unit_ship_cost_usd = db.Column(db.Float, default=0.0)  # optional per-unit extra (inter-country)

    __table_args__ = (
        CheckConstraint("qty > 0", name="ck_shipitem_qty_pos"),
    )

    shipment = db.relationship("Shipment", backref=db.backref("items", cascade="all, delete-orphan"))
    product = db.relationship("Product")


# ---------- Remittance (weekly product results) ----------
class Remittance(db.Model):
    """
    Per product & country & date-range results that feed profit snapshots.
    All currency fields are USD.
    """
    __tablename__ = "remittances"
    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey("products.id"), nullable=False, index=True)
    country_code = db.Column(db.String(3), db.ForeignKey("countries.code"), nullable=False, index=True)

    period_from = db.Column(db.Date, nullable=False, index=True)
    period_to = db.Column(db.Date, nullable=False, index=True)

    orders = db.Column(db.Integer, default=0)
    pieces = db.Column(db.Integer, default=0)
    revenue_usd = db.Column(db.Float, default=0.0)
    ad_spend_usd = db.Column(db.Float, default=0.0)
    inter_ship_cost_per_piece_usd = db.Column(db.Float, default=0.0)  # extra between countries

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    product = db.relationship("Product")
    country = db.relationship("Country")


# ---------- Finance ----------
class FinanceCategory(db.Model):
    __tablename__ = "finance_categories"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(64), nullable=False, unique=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class FinanceEntry(db.Model):
    __tablename__ = "finance_entries"
    id = db.Column(db.Integer, primary_key=True)
    entry_date = db.Column(db.Date, default=date.today, index=True, nullable=False)
    type = db.Column(db.String(6), nullable=False)  # 'debit' or 'credit'
    amount_usd = db.Column(db.Float, nullable=False, default=0.0)
    description = db.Column(db.String(240), nullable=True)

    category_id = db.Column(db.Integer, db.ForeignKey("finance_categories.id"), nullable=True, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    category = db.relationship("FinanceCategory")


# ---------- To-dos ----------
class Todo(db.Model):
    __tablename__ = "todos"
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(160), nullable=False)
    status = db.Column(db.String(16), nullable=False, default="todo")  # todo | doing | done
    week_day = db.Column(db.String(9), nullable=True)  # optional: Monday..Sunday
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


# ---------- Minimal auth (single admin) ----------
class User(db.Model):
    __tablename__ = "users"
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), unique=True, nullable=False)
    # NOTE: for simplicity here we store plain hash-less; in production use werkzeug.security
    password = db.Column(db.String(128), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
