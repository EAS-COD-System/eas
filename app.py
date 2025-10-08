# app.py — safe bootstrap so Render health check never 500s
from flask import Flask, render_template, request, redirect, url_for, send_from_directory
from datetime import date, datetime, timedelta
import os

from models import (
    db, Country, Product, Stock, PlatformSpend, DailyDelivered,
    Shipment, ShipmentItem, Remittance, FinanceCategory, FinanceEntry, Todo
)

def create_app():
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get("DATABASE_URL", "sqlite:///cod_system.db")
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    db.init_app(app)

    # ----- DB bootstrap -----
    with app.app_context():
        db.create_all()
        defaults = [("KE", "Kenya"), ("UG", "Uganda"), ("TZ", "Tanzania"), ("ZM", "Zambia"), ("ZW", "Zimbabwe")]
        for code, name in defaults:
            if not Country.query.get(code):
                db.session.add(Country(code=code, name=name))
        db.session.commit()

    # ----- health -----
    @app.get("/health")
    def health():
        return "ok", 200

    # ----- dashboard (safe defaults so Jinja never breaks) -----
    @app.get("/")
    def dashboard():
        stats = {
            "product_count": Product.query.count(),
            "warehouse_count": Country.query.count(),
            "in_transit_count": Shipment.query.filter_by(status="in_transit").count(),
        }

        countries = Country.query.order_by(Country.name).all()
        country_summaries = []
        for c in countries:
            stock = (
                db.session.query(db.func.coalesce(db.func.sum(Stock.qty), 0))
                .filter(Stock.country_code == c.code)
                .scalar() or 0
            )
            spend = (
                db.session.query(db.func.coalesce(db.func.sum(PlatformSpend.amount_usd), 0.0))
                .filter(PlatformSpend.country_code == c.code)
                .scalar() or 0.0
            )
            in_transit_qty = (
                db.session.query(db.func.coalesce(db.func.sum(ShipmentItem.qty), 0))
                .join(Shipment, ShipmentItem.shipment_id == Shipment.id)
                .filter(Shipment.status == "in_transit", Shipment.to_country == c.code)
                .scalar() or 0
            )
            country_summaries.append({
                "country": c.name, "code": c.code,
                "stock": int(stock), "in_transit": int(in_transit_qty),
                "ad_spend": float(spend),
            })

        in_transit_cnke = (
            Shipment.query.filter(
                Shipment.status == "in_transit",
                Shipment.from_country == "CN",
                Shipment.to_country == "KE",
            ).order_by(Shipment.created_at.desc()).all()
        )
        in_transit_inter = (
            Shipment.query.filter(
                Shipment.status == "in_transit",
                Shipment.from_country != "CN",
            ).order_by(Shipment.created_at.desc()).all()
        )

        today = date.today()
        recent_days = sorted([(today - timedelta(days=i)) for i in range(0, 8)])
        daily_rows = []
        for d in recent_days:
            row = {"date": d.strftime("%Y-%m-%d")}
            total = 0
            for c in countries:
                rec = (
                    DailyDelivered.query
                    .filter_by(country_code=c.code, day=d)
                    .with_entities(DailyDelivered.delivered)
                    .first()
                )
                qty = int(rec[0]) if rec else 0
                row[c.code] = qty
                total += qty
            row["total"] = total
            daily_rows.append(row)

        tasks = Todo.query.order_by(Todo.id.desc()).limit(50).all()

        return render_template(
            "index.html",
            stats=stats,
            country_summaries=country_summaries,
            in_transit_cnke=in_transit_cnke,
            in_transit_inter=in_transit_inter,
            recent_days=recent_days,
            daily_rows=daily_rows,
            tasks=tasks,
        )

    # ----- minimal forms so posting won’t 500 -----
    @app.post("/add_country")
    def add_country():
        name = (request.form.get("country") or "").strip()
        if not name:
            return redirect(url_for("dashboard"))
        code = (name[:2] or "XX").upper()
        if not Country.query.get(code):
            db.session.add(Country(code=code, name=name))
            db.session.commit()
        return redirect(url_for("dashboard"))

    @app.post("/delete_country")
    def delete_country():
        key = (request.form.get("country") or "").strip()
        if key:
            c = Country.query.filter((Country.code == key) | (Country.name == key)).first()
            if c:
                db.session.delete(c)
                db.session.commit()
        return redirect(url_for("dashboard"))

    @app.get("/backups/<path:fname>")
    def download_backup(fname):
        return send_from_directory("backups", fname, as_attachment=True)

    return app

# module-level 'app' for gunicorn or python entry
app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
