# models.py
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, date

db = SQLAlchemy()

class Country(db.Model):
    __tablename__ = "countries"
    code = db.Column(db.String(4), primary_key=True)
    name = db.Column(db.String(80), unique=True, nullable=False)

class Product(db.Model):
    __tablename__ = "products"
    sku = db.Column(db.String(64), primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    cost_cn = db.Column(db.Float, default=0.0)           # USD per piece (CN cost)
    ship_cn_ke = db.Column(db.Float, default=0.0)        # USD per piece (CN->KE)

class Stock(db.Model):
    __tablename__ = "stock"
    id = db.Column(db.Integer, primary_key=True)
    product_sku = db.Column(db.String(64), db.ForeignKey("products.sku"), nullable=False)
    country_code = db.Column(db.String(4), db.ForeignKey("countries.code"), nullable=False)
    qty = db.Column(db.Integer, default=0)

class PlatformSpend(db.Model):
    __tablename__ = "platform_spend"
    id = db.Column(db.Integer, primary_key=True)
    product_sku = db.Column(db.String(64), db.ForeignKey("products.sku"), nullable=False)
    country_code = db.Column(db.String(4), db.ForeignKey("countries.code"), nullable=False)
    platform = db.Column(db.String(16), nullable=False)  # 'facebook' | 'tiktok' | 'google'
    amount_usd = db.Column(db.Float, default=0.0)        # live daily spend (overwrites)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow)

class DailyDelivered(db.Model):
    __tablename__ = "daily_delivered"
    id = db.Column(db.Integer, primary_key=True)
    country_code = db.Column(db.String(4), db.ForeignKey("countries.code"), nullable=False)
    day = db.Column(db.Date, default=date.today, nullable=False)
    delivered = db.Column(db.Integer, default=0)

class Shipment(db.Model):
    __tablename__ = "shipments"
    id = db.Column(db.Integer, primary_key=True)
    ref = db.Column(db.String(64), unique=True, nullable=False)
    from_country = db.Column(db.String(4), db.ForeignKey("countries.code"), nullable=False)
    to_country = db.Column(db.String(4), db.ForeignKey("countries.code"), nullable=False)
    status = db.Column(db.String(20), default="in_transit")  # in_transit | arrived
    shipping_cost_usd = db.Column(db.Float, default=0.0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    arrived_at = db.Column(db.DateTime, nullable=True)

    items = db.relationship("ShipmentItem", backref="shipment", cascade="all, delete-orphan")

class ShipmentItem(db.Model):
    __tablename__ = "shipment_items"
    id = db.Column(db.Integer, primary_key=True)
    shipment_id = db.Column(db.Integer, db.ForeignKey("shipments.id"), nullable=False)
    product_sku = db.Column(db.String(64), db.ForeignKey("products.sku"), nullable=False)
    qty = db.Column(db.Integer, default=0)

class Remittance(db.Model):
    __tablename__ = "remittances"
    id = db.Column(db.Integer, primary_key=True)
    product_sku = db.Column(db.String(64), db.ForeignKey("products.sku"), nullable=False)
    country_code = db.Column(db.String(4), db.ForeignKey("countries.code"), nullable=False)
    date_from = db.Column(db.Date, nullable=False)
    date_to = db.Column(db.Date, nullable=False)
    orders = db.Column(db.Integer, default=0)
    pieces = db.Column(db.Integer, default=0)
    revenue_usd = db.Column(db.Float, default=0.0)
    ads_usd = db.Column(db.Float, default=0.0)
    extra_ship_per_piece_usd = db.Column(db.Float, default=0.0)

class FinanceCategory(db.Model):
    __tablename__ = "finance_categories"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), unique=True, nullable=False)

class FinanceEntry(db.Model):
    __tablename__ = "finance_entries"
    id = db.Column(db.Integer, primary_key=True)
    entry_date = db.Column(db.Date, nullable=False, default=date.today)
    type = db.Column(db.String(10), nullable=False)  # 'credit' | 'debit'
    category_id = db.Column(db.Integer, db.ForeignKey("finance_categories.id"))
    description = db.Column(db.String(255))
    amount_usd = db.Column(db.Float, default=0.0)

class Todo(db.Model):
    __tablename__ = "todos"
    id = db.Column(db.Integer, primary_key=True)
    text = db.Column(db.String(255), nullable=False)
    status = db.Column(db.String(20), default="pending")  # pending | in_progress | done
    week_day = db.Column(db.String(12), nullable=True)    # optional: Monday..Sunday
