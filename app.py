# app.py — stable version for Render deploys
from __future__ import annotations

import os
from datetime import date
from flask import Flask, render_template, redirect, url_for, request
from jinja2 import TemplateNotFound

from models import (
    db, Country, Product, Stock, PlatformSpend, DailyDelivered,
    Shipment, ShipmentItem, Remittance, FinanceCategory, FinanceEntry,
    Todo, BackupMeta, AdminUser
)


def create_app() -> Flask:
    app = Flask(__name__)

    # ---------- CONFIG ----------
    app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get(
        "DATABASE_URL", "sqlite:///cod_system.db"
    )
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "eas_cod_secret")

    db.init_app(app)

    # ---------- INITIAL SETUP ----------
    with app.app_context():
        db.create_all()

        # Default countries
        defaults = [
            ("CN", "China"), ("KE", "Kenya"), ("UG", "Uganda"),
            ("TZ", "Tanzania"), ("ZM", "Zambia"), ("ZW", "Zimbabwe")
        ]
        for code, name in defaults:
            if not Country.query.get(code):
                db.session.add(Country(code=code, name=name))
        db.session.commit()

    # ---------- ROUTES ----------
    @app.get("/health")
    def health():
        """Simple health check for Render."""
        return "ok", 200

    @app.get("/")
    def dashboard():
        """Dashboard fallback until templates are uploaded."""
        stats = {
            "products": Product.query.count(),
            "warehouses": Country.query.count(),
            "in_transit": Shipment.query.filter_by(status="in_transit").count(),
            "today": date.today().isoformat(),
        }

        try:
            return render_template("index.html", stats=stats)
        except TemplateNotFound:
            return (
                f"<h1>EAS COD System Running</h1>"
                f"<p>Products: {stats['products']} | Warehouses: {stats['warehouses']} | "
                f"In Transit: {stats['in_transit']} | Date: {stats['today']}</p>"
                f"<p>Upload your templates to the /templates folder to see the full dashboard.</p>"
            )

    @app.post("/add_country")
    def add_country():
        """Add a country manually."""
        name = (request.form.get("country") or "").strip()
        code = (request.form.get("code") or name[:2]).upper()
        if name and not Country.query.get(code):
            db.session.add(Country(code=code, name=name))
            db.session.commit()
        return redirect(url_for("dashboard"))

    return app


# ---------- ENTRYPOINT ----------
app = create_app()

if __name__ == "__main__":
    # Local run: python app.py
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
