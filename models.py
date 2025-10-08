# models.py — core data models
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, date

db = SQLAlchemy()

class Country(db.Model):
    code = db.Column(db.String(2), primary_key=True)
    name = db.Column(db.String(64), nullable=False, unique=True)

class Product(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False, unique=True)
    sku  = db.Column(db.String(64), unique=True, nullable=True)
    cost_cn_usd = db.Column(db.Float, default=0.0)
    ship_cn_ke_usd = db.Column(db.Float, default=0.0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class Stock(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey("product.id"), nullable=False)
    country_code = db.Column(db.String(2), db.ForeignKey("country.code"), nullable=False)
    qty = db.Column(db.Integer, default=0)
    __table_args__ = (db.UniqueConstraint("product_id","country_code", name="uix_stock_prod_ctry"),)

class PlatformSpend(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey("product.id"), nullable=False)
    country_code = db.Column(db.String(2), db.ForeignKey("country.code"), nullable=False)
    platform = db.Column(db.String(16), nullable=False)  # facebook/tiktok/google
    day = db.Column(db.Date, default=date.today, nullable=False)
    amount_usd = db.Column(db.Float, default=0.0)
    __table_args__ = (db.UniqueConstraint("product_id","country_code","platform","day", name="uix_spend_unique"),)

class DailyDelivered(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    country_code = db.Column(db.String(2), db.ForeignKey("country.code"), nullable=False)
    day = db.Column(db.Date, default=date.today, nullable=False)
    delivered = db.Column(db.Integer, default=0)
    __table_args__ = (db.UniqueConstraint("country_code","day", name="uix_delivered_ctry_day"),)

class Shipment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    from_country = db.Column(db.String(2), nullable=False)  # CN/KE/UG/TZ/ZM/ZW
    to_country   = db.Column(db.String(2), nullable=False)
    ship_cost_usd = db.Column(db.Float, default=0.0)
    status = db.Column(db.String(16), default="in_transit")  # in_transit/arrived
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    arrived_at = db.Column(db.DateTime, nullable=True)

class ShipmentItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    shipment_id = db.Column(db.Integer, db.ForeignKey("shipment.id"), nullable=False)
    product_id = db.Column(db.Integer, db.ForeignKey("product.id"), nullable=False)
    qty = db.Column(db.Integer, default=0)

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

class FinanceCategory(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(64), unique=True, nullable=False)

class FinanceEntry(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    date = db.Column(db.Date, default=date.today, nullable=False)
    category_id = db.Column(db.Integer, db.ForeignKey("finance_category.id"), nullable=False)
    type = db.Column(db.String(6), nullable=False)  # debit/credit
    amount_usd = db.Column(db.Float, default=0.0)
    description = db.Column(db.String(255), default="")

class Todo(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(160), nullable=False)
    status = db.Column(db.String(12), default="todo")  # todo/doing/done
    week_day = db.Column(db.String(3), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
