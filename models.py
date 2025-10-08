# models.py
from __future__ import annotations

from datetime import datetime, date
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import UniqueConstraint, ForeignKey
from sqlalchemy.orm import relationship, Mapped, mapped_column
from typing import Optional

db = SQLAlchemy()

class Country(db.Model):
    __tablename__ = "countries"
    code: Mapped[str] = mapped_column(primary_key=True)   # KE, UG, TZ, ZM, ZW, CN
    name: Mapped[str] = mapped_column(unique=True, nullable=False)

class Product(db.Model):
    __tablename__ = "products"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(nullable=False, unique=True)
    sku: Mapped[Optional[str]] = mapped_column(nullable=True, unique=True)
    category: Mapped[Optional[str]] = mapped_column(nullable=True)
    cost_cn_usd: Mapped[float] = mapped_column(default=0.0)
    ship_cn_ke_usd: Mapped[float] = mapped_column(default=0.0)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

class Stock(db.Model):
    __tablename__ = "stock"
    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    country_code: Mapped[str] = mapped_column(ForeignKey("countries.code"), nullable=False)
    qty: Mapped[int] = mapped_column(default=0)
    __table_args__ = (UniqueConstraint("product_id", "country_code", name="uq_stock_prod_country"),)
    product = relationship(Product)
    country = relationship(Country)

class PlatformSpend(db.Model):
    __tablename__ = "platform_spend"
    id: Mapped[int] = mapped_column(primary_key=True)
    day: Mapped[date] = mapped_column(default=date.today, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    country_code: Mapped[str] = mapped_column(ForeignKey("countries.code"), nullable=False)
    platform: Mapped[str] = mapped_column(nullable=False)  # facebook|tiktok|google
    amount_usd: Mapped[float] = mapped_column(default=0.0)
    __table_args__ = (UniqueConstraint("day", "product_id", "country_code", "platform", name="uq_spend_unique"),)
    product = relationship(Product)
    country = relationship(Country)

class DailyDelivered(db.Model):
    __tablename__ = "daily_delivered"
    id: Mapped[int] = mapped_column(primary_key=True)
    day: Mapped[date] = mapped_column(default=date.today, index=True)
    country_code: Mapped[str] = mapped_column(ForeignKey("countries.code"), nullable=False)
    delivered: Mapped[int] = mapped_column(default=0)
    __table_args__ = (UniqueConstraint("day", "country_code", name="uq_delivered_day_country"),)
    country = relationship(Country)

class Shipment(db.Model):
    __tablename__ = "shipments"
    id: Mapped[int] = mapped_column(primary_key=True)
    ref: Mapped[Optional[str]] = mapped_column(index=True)
    from_country: Mapped[str] = mapped_column(ForeignKey("countries.code"), nullable=False)
    to_country: Mapped[str] = mapped_column(ForeignKey("countries.code"), nullable=False)
    status: Mapped[str] = mapped_column(default="in_transit")
    shipping_cost_usd: Mapped[float] = mapped_column(default=0.0)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    eta: Mapped[Optional[date]] = mapped_column(nullable=True)
    arrived_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    items = relationship("ShipmentItem", back_populates="shipment", cascade="all, delete-orphan")

class ShipmentItem(db.Model):
    __tablename__ = "shipment_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    shipment_id: Mapped[int] = mapped_column(ForeignKey("shipments.id"), nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    qty: Mapped[int] = mapped_column(default=0)
    shipment = relationship(Shipment, back_populates="items")
    product = relationship(Product)

class Remittance(db.Model):
    __tablename__ = "remittances"
    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    country_code: Mapped[str] = mapped_column(ForeignKey("countries.code"), nullable=False)
    date_from: Mapped[date] = mapped_column(nullable=False)
    date_to: Mapped[date] = mapped_column(nullable=False)
    orders: Mapped[int] = mapped_column(default=0)
    pieces: Mapped[int] = mapped_column(default=0)
    revenue_usd: Mapped[float] = mapped_column(default=0.0)
    ad_spend_usd: Mapped[float] = mapped_column(default=0.0)
    inter_country_ship_cost_per_piece_usd: Mapped[float] = mapped_column(default=0.0)
    product = relationship(Product)
    country = relationship(Country)

class FinanceCategory(db.Model):
    __tablename__ = "finance_categories"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(unique=True, nullable=False)

class FinanceEntry(db.Model):
    __tablename__ = "finance_entries"
    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[date] = mapped_column(default=date.today, index=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("finance_categories.id"), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(nullable=True)
    debit_usd: Mapped[float] = mapped_column(default=0.0)
    credit_usd: Mapped[float] = mapped_column(default=0.0)
    running_balance_usd: Mapped[float] = mapped_column(default=0.0)
    category = relationship(FinanceCategory)

class Todo(db.Model):
    __tablename__ = "todos"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(nullable=False)
    status: Mapped[str] = mapped_column(default="todo")  # todo|doing|done
    week_day: Mapped[Optional[str]] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

class BackupMeta(db.Model):
    __tablename__ = "backups"
    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, index=True)
    path: Mapped[str] = mapped_column(nullable=False)

class AdminUser(db.Model):
    __tablename__ = "admin_user"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(nullable=False)
