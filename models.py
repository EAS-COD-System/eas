from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, date

db = SQLAlchemy()

# --- Master data ---
class Country(db.Model):
    __tablename__ = "countries"
    code = db.Column(db.String(4), primary_key=True)          # KE/TZ/UG/ZM/ZW/CN
    name = db.Column(db.String(64), nullable=False, unique=True)

class Product(db.Model):
    __tablename__ = "products"
    sku = db.Column(db.String(40), primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    cost_cn = db.Column(db.Float, default=0.0)                # cost in China (USD)
    ship_cn_ke = db.Column(db.Float, default=0.0)             # shipping CN->KE (USD)
    notes = db.Column(db.String(400))

class Stock(db.Model):
    """On-hand stock per product & country."""
    __tablename__ = "stock"
    id = db.Column(db.Integer, primary_key=True)
    product_sku = db.Column(db.String(40), db.ForeignKey("products.sku"), index=True)
    country_code = db.Column(db.String(4), db.ForeignKey("countries.code"), index=True)
    qty = db.Column(db.Integer, default=0)

# --- Advertising (current daily spend – overwrite) ---
class PlatformSpend(db.Model):
    __tablename__ = "platform_spend"
    id = db.Column(db.Integer, primary_key=True)
    product_sku = db.Column(db.String(40), db.ForeignKey("products.sku"), index=True)
    country_code = db.Column(db.String(4), db.ForeignKey("countries.code"), index=True)
    platform = db.Column(db.String(20))  # facebook / tiktok / google
    amount_usd = db.Column(db.Float, default=0.0)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    __table_args__ = (db.UniqueConstraint("product_sku","country_code","platform", name="uq_spend_key"),)

# --- Daily delivered (by day, per country) ---
class DailyDelivered(db.Model):
    __tablename__ = "daily_delivered"
    id = db.Column(db.Integer, primary_key=True)
    country_code = db.Column(db.String(4), db.ForeignKey("countries.code"), index=True)
    day = db.Column(db.Date, index=True)
    delivered = db.Column(db.Integer, default=0)
    __table_args__ = (db.UniqueConstraint("country_code","day", name="uq_delivered_key"),)

# --- Shipments ---
class Shipment(db.Model):
    __tablename__ = "shipments"
    id = db.Column(db.Integer, primary_key=True)
    ref = db.Column(db.String(60), index=True)
    from_country = db.Column(db.String(4), index=True)   # CN or KE/TZ/UG/ZM/ZW
    to_country = db.Column(db.String(4), index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    arrived_at = db.Column(db.DateTime, nullable=True)
    status = db.Column(db.String(20), default="in_transit")  # in_transit/arrived
    shipping_cost_usd = db.Column(db.Float, default=0.0)

class ShipmentItem(db.Model):
    __tablename__ = "shipment_items"
    id = db.Column(db.Integer, primary_key=True)
    shipment_id = db.Column(db.Integer, db.ForeignKey("shipments.id"), index=True)
    product_sku = db.Column(db.String(40), db.ForeignKey("products.sku"), index=True)
    qty = db.Column(db.Integer, default=0)

# --- Remittance (period results per product & country) ---
class Remittance(db.Model):
    __tablename__ = "remittance"
    id = db.Column(db.Integer, primary_key=True)
    product_sku = db.Column(db.String(40), db.ForeignKey("products.sku"), index=True)
    country_code = db.Column(db.String(4), db.ForeignKey("countries.code"), index=True)
    date_from = db.Column(db.Date, nullable=False)
    date_to = db.Column(db.Date, nullable=False)
    orders = db.Column(db.Integer, default=0)
    pieces = db.Column(db.Integer, default=0)
    revenue_usd = db.Column(db.Float, default=0.0)
    ads_usd = db.Column(db.Float, default=0.0)
    extra_ship_per_piece_usd = db.Column(db.Float, default=0.0)  # inter-country per piece add

# --- Finance ---
class FinanceCategory(db.Model):
    __tablename__ = "finance_categories"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), unique=True)

class FinanceEntry(db.Model):
    __tablename__ = "finance_entries"
    id = db.Column(db.Integer, primary_key=True)
    entry_date = db.Column(db.Date, default=date.today, index=True)
    type = db.Column(db.String(6))  # credit/debit
    category_id = db.Column(db.Integer, db.ForeignKey("finance_categories.id"))
    description = db.Column(db.String(280))
    amount_usd = db.Column(db.Float, default=0.0)

# --- To-Do ---
class Todo(db.Model):
    __tablename__ = "todo"
    id = db.Column(db.Integer, primary_key=True)
    text = db.Column(db.String(240))
    status = db.Column(db.String(20), default="pending")  # pending/in_progress/done
    week_day = db.Column(db.String(10), nullable=True)    # optional for weekly plan
