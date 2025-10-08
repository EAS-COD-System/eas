# app.py — COD Control (Part A) — top nav, white/green, tables-only shell
from flask import Flask, render_template, request, redirect, url_for, session
from flask_sqlalchemy import SQLAlchemy
from datetime import timedelta, date, datetime
import os

from models import db, Country, Product, Stock, PlatformSpend, DailyDelivered, Shipment, ShipmentItem, Remittance, FinanceCategory, FinanceEntry, Todo

USERNAME = "eas"
PASSWORD = "easnew"

def create_app():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "change-me-now")
    app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get("DATABASE_URL", "sqlite:///cod_system.db")
    if app.config["SQLALCHEMY_DATABASE_URI"].startswith("postgres://"):
        app.config["SQLALCHEMY_DATABASE_URI"] = app.config["SQLALCHEMY_DATABASE_URI"].replace("postgres://", "postgresql://", 1)
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.permanent_session_lifetime = timedelta(days=365*5)

    db.init_app(app)

    with app.app_context():
        db.create_all()
        # seed base countries
        defaults = [("KE","Kenya"),("UG","Uganda"),("TZ","Tanzania"),("ZM","Zambia"),("ZW","Zimbabwe"),("CN","China")]
        for code,name in defaults:
            if not Country.query.get(code):
                db.session.add(Country(code=code, name=name))
        if FinanceCategory.query.count() == 0:
            db.session.add_all([FinanceCategory(name="General"), FinanceCategory(name="Logistics"), FinanceCategory(name="Marketing")])
        db.session.commit()

    @app.before_request
    def gate():
        open_paths = {"/login", "/health"}
        if request.path in open_paths or request.path.startswith("/static/"):
            return
        if not session.get("logged_in"):
            return redirect(url_for("login"))

    @app.get("/health")
    def health():
        return "ok", 200

    @app.get("/login")
    def login():
        return render_template("login.html", error=None)

    @app.post("/login")
    def do_login():
        u = request.form.get("username","").strip()
        p = request.form.get("password","").strip()
        if u == USERNAME and p == PASSWORD:
            session.permanent = True
            session["logged_in"] = True
            return redirect(url_for("dashboard"))
        return render_template("login.html", error="Invalid credentials")

    @app.get("/logout")
    def logout():
        session.clear()
        return redirect(url_for("login"))

    @app.get("/")
    def dashboard():
        stats = {
            "products": Product.query.count(),
            "warehouses": Country.query.count(),
            "in_transit": Shipment.query.filter_by(status="in_transit").count(),
        }
        # country summaries
        summaries = []
        for c in Country.query.filter(Country.code!="CN").order_by(Country.name).all():
            stock = db.session.query(db.func.coalesce(db.func.sum(Stock.qty),0)).filter_by(country_code=c.code).scalar() or 0
            in_transit_qty = (
                db.session.query(db.func.coalesce(db.func.sum(ShipmentItem.qty),0))
                .join(Shipment, Shipment.id==ShipmentItem.shipment_id)
                .filter(Shipment.to_country==c.code, Shipment.status=="in_transit")
                .scalar() or 0
            )
            spend = db.session.query(db.func.coalesce(db.func.sum(PlatformSpend.amount_usd),0.0)).filter_by(country_code=c.code).scalar() or 0.0
            summaries.append({"code":c.code,"name":c.name,"stock":int(stock),"in_transit":int(in_transit_qty),"ad_spend":float(spend)})
        # recent 8 days delivered
        today = date.today()
        days = [(today - timedelta(days=i)) for i in range(7,-1,-1)]
        delivered_rows = []
        countries = Country.query.filter(Country.code!="CN").order_by(Country.name).all()
        for d in days:
            row = {"date": d.strftime("%Y-%m-%d"), "total": 0}
            for c in countries:
                rec = DailyDelivered.query.filter_by(country_code=c.code, day=d).first()
                qty = rec.delivered if rec else 0
                row[c.code] = qty
                row["total"] += qty
            delivered_rows.append(row)

        return render_template("index.html",
            stats=stats, country_summaries=summaries, delivered_rows=delivered_rows, countries=countries
        )

    # Minimal endpoints placeholders
    @app.post("/delivered/add")
    def add_delivered():
        c = request.form.get("country"); day = request.form.get("day"); qty = int(request.form.get("qty",0) or 0)
        d = datetime.strptime(day, "%Y-%m-%d").date() if day else date.today()
        rec = DailyDelivered.query.filter_by(country_code=c, day=d).first()
        if rec: rec.delivered = qty
        else: db.session.add(DailyDelivered(country_code=c, day=d, delivered=qty))
        db.session.commit()
        return redirect(url_for("dashboard"))

    return app

app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
