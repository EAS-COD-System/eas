from datetime import datetime, date
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

# ---------- Reference / Auth ----------
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), unique=True, nullable=False)
    pw_hash = db.Column(db.String(255), nullable=False)
    # Flask-Login helpers
    def get_id(self): return str(self.id)
    @property
    def is_authenticated(self): return True
    @property
    def is_active(self): return True
    @property
    def is_anonymous(self): return False

class Country(db.Model):
    code = db.Column(db.String(2), primary_key=True)   # e.g. KE, UG, TZ, ZM, ZW, CN
    name = db.Column(db.String(64), nullable=False, unique=True)

class Product(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    sku = db.Column(db.String(64), nullable=True, unique=True)
    category = db.Column(db.String(64), nullable=True)
    # cost structure (USD)
    cost_cn_usd = db.Column(db.Float, default=0.0)          # buy price from CN
    ship_cn_ke_usd = db.Column(db.Float, default=0.0)       # base ship CN -> KE
    notes = db.Column(db.Text, default="")
    is_active = db.Column(db.Boolean, default=True)

class ProductCountryConfig(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey("product.id"), nullable=False)
    country_code = db.Column(db.String(2), db.ForeignKey("country.code"), nullable=False)
    target_profit_plus_ads_usd = db.Column(db.Float, default=0.0)  # editable per country

    __table_args__ = (
        db.UniqueConstraint("product_id", "country_code", name="uq_prod_country_cfg"),
    )

# ---------- Inventory & Spend ----------
class Stock(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey("product.id"), nullable=False)
    country_code = db.Column(db.String(2), db.ForeignKey("country.code"), nullable=False)
    qty = db.Column(db.Integer, default=0)
    __table_args__ = (db.UniqueConstraint("product_id", "country_code", name="uq_stock"),)

PLATFORMS = ("facebook", "tiktok", "google")  # fixed list

class PlatformSpend(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey("product.id"), nullable=False)
    country_code = db.Column(db.String(2), db.ForeignKey("country.code"), nullable=False)
    platform = db.Column(db.String(16), nullable=False)  # one of PLATFORMS
    day = db.Column(db.Date, default=date.today, nullable=False)
    amount_usd = db.Column(db.Float, default=0.0, nullable=False)
    __table_args__ = (
        db.UniqueConstraint("product_id", "country_code", "platform", "day",
                            name="uq_spend_day_platform"),
    )

class DailyDelivered(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    country_code = db.Column(db.String(2), db.ForeignKey("country.code"), nullable=False)
    day = db.Column(db.Date, default=date.today, nullable=False)
    delivered = db.Column(db.Integer, default=0, nullable=False)
    __table_args__ = (db.UniqueConstraint("country_code", "day", name="uq_delivered"),)

# ---------- Shipments ----------
class Shipment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    ref = db.Column(db.String(64), nullable=True)
    from_country = db.Column(db.String(2), db.ForeignKey("country.code"), nullable=False)
    to_country = db.Column(db.String(2), db.ForeignKey("country.code"), nullable=False)
    status = db.Column(db.String(16), default="in_transit")  # in_transit / arrived
    ship_cost_usd = db.Column(db.Float, default=0.0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    arrived_at = db.Column(db.DateTime, nullable=True)

class ShipmentItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    shipment_id = db.Column(db.Integer, db.ForeignKey("shipment.id"), nullable=False)
    product_id = db.Column(db.Integer, db.ForeignKey("product.id"), nullable=False)
    qty = db.Column(db.Integer, default=0)

# ---------- Performance / Profit (Remittance) ----------
class Remittance(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey("product.id"), nullable=False)
    country_code = db.Column(db.String(2), db.ForeignKey("country.code"), nullable=False)
    period_start = db.Column(db.Date, nullable=False)
    period_end = db.Column(db.Date, nullable=False)
    orders = db.Column(db.Integer, default=0)
    pieces = db.Column(db.Integer, default=0)
    revenue_usd = db.Column(db.Float, default=0.0)
    ads_usd = db.Column(db.Float, default=0.0)
    inter_ship_cost_per_piece_usd = db.Column(db.Float, default=0.0)

# ---------- Finance ----------
class FinanceCategory(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(64), unique=True, nullable=False)
    kind = db.Column(db.String(8), default="debit")  # debit / credit

class FinanceEntry(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    category_id = db.Column(db.Integer, db.ForeignKey("finance_category.id"), nullable=False)
    date = db.Column(db.Date, default=date.today, nullable=False)
    amount_usd = db.Column(db.Float, default=0.0, nullable=False)
    description = db.Column(db.String(255), default="")
    # running balance will be computed in queries

# ---------- To-do ----------
class Todo(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(160), nullable=False)
    status = db.Column(db.String(16), default="todo")  # todo / doing / done
    week_day = db.Column(db.String(3), nullable=True)  # Mon..Sun optional
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
