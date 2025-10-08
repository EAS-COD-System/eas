# app.py — safe bootstrap so Render health check never 500s
from flask import Flask, render_template, request, redirect, url_for
from datetime import date, datetime, timedelta
import os

from models import db, Country, Product, Stock, PlatformSpend, DailyDelivered, Shipment, ShipmentItem, Remittance, FinanceCategory, FinanceEntry, Todo

def create_app():
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get("DATABASE_URL", "sqlite:///cod_system.db")
    app.config["SQLALCHEMY_TRACKMODIFICATIONS"] = False

    db.init_app(app)

    # ---------- one-time setup ----------
    with app.app_context():
        db.create_all()
        # Countries (CN is virtual for China shipping)
        defaults = [
            ("CN", "China"),
            ("KE", "Kenya"), ("UG", "Uganda"),
            ("TZ", "Tanzania"), ("ZM", "Zambia"),
            ("ZW", "Zimbabwe"),
        ]
        for code, name in defaults:
            if not Country.query.get(code):
                db.session.add(Country(code=code, name=name))
        db.session.commit()

    @app.get("/health")
    def health():
        return "ok", 200

    # ---------- Dashboard ----------
    @app.get("/")
    def dashboard():
        stats = {
            "product_count": Product.query.count(),
            "warehouse_count": Country.query.count(),
            "in_transit_count": Shipment.query.filter_by(status="in_transit").count(),
        }

        countries = Country.query.order_by(Country.name).all()
        # band totals
        country_summaries = []
        for c in countries:
            stock_qty = (db.session.query(db.func.coalesce(db.func.sum(Stock.qty), 0))
                         .filter(Stock.country_code == c.code).scalar() or 0)
            spend_usd = (db.session.query(db.func.coalesce(db.func.sum(PlatformSpend.amount_usd), 0.0))
                         .filter(PlatformSpend.country_code == c.code).scalar() or 0.0)
            in_transit_qty = (
                db.session.query(db.func.coalesce(db.func.sum(ShipmentItem.qty), 0))
                .join(Shipment, ShipmentItem.shipment_id == Shipment.id)
                .filter(Shipment.status == "in_transit", Shipment.to_country == c.code)
                .scalar() or 0
            )
            country_summaries.append({
                "code": c.code, "name": c.name,
                "stock": int(stock_qty),
                "in_transit": int(in_transit_qty),
                "spend": float(spend_usd),
            })

        today = date.today()
        recent_days = [today - timedelta(days=i) for i in range(7, -1, -1)]
        perf_rows = []
        for d in recent_days:
            row = {"date": d.strftime("%Y-%m-%d")}
            total = 0
            for c in countries:
                rec = DailyDelivered.query.filter_by(country_code=c.code, day=d).first()
                qty = rec.delivered if rec else 0
                row[c.code] = qty
                total += qty
            row["total"] = total
            perf_rows.append(row)

        # shipments
        cn_ke = Shipment.query.filter(
            Shipment.status == "in_transit",
            Shipment.from_country == "CN",
            Shipment.to_country == "KE"
        ).order_by(Shipment.created_at.desc()).all()

        inter = Shipment.query.filter(
            Shipment.status == "in_transit",
            Shipment.from_country != "CN"
        ).order_by(Shipment.created_at.desc()).all()

        products = Product.query.order_by(Product.name).all()

        return render_template(
            "index.html",
            stats=stats,
            countries=countries,
            country_summaries=country_summaries,
            perf_rows=perf_rows,
            cn_ke=cn_ke,
            inter=inter,
            products=products,
            today=today.strftime("%Y-%m-%d")
        )

    # ---------- Actions (minimal but functional) ----------

    @app.post("/product/new")
    def product_new():
        name = request.form.get("name","").strip()
        sku = request.form.get("sku","").strip()
        cost = float(request.form.get("cost_cn","0") or 0)
        ship = float(request.form.get("ship_cn_ke","0") or 0)
        if name and sku:
            db.session.add(Product(name=name, sku=sku, cost_cn=cost, ship_cn_ke=ship))
            db.session.commit()
        return redirect(url_for("dashboard"))

    @app.post("/spend/set")
    def spend_set():
        # daily overwrite per day/country/product/platform
        day = request.form.get("day") or date.today().strftime("%Y-%m-%d")
        country = request.form.get("country")
        product_id = int(request.form.get("product_id") or 0)
        platform = request.form.get("platform")  # facebook/tiktok/google
        amount = float(request.form.get("amount") or 0)
        if country and product_id and platform:
            rec = PlatformSpend.query.filter_by(
                day=datetime.strptime(day, "%Y-%m-%d").date(),
                country_code=country,
                product_id=product_id,
                platform=platform
            ).first()
            if not rec:
                rec = PlatformSpend(
                    day=datetime.strptime(day, "%Y-%m-%d").date(),
                    country_code=country, product_id=product_id, platform=platform
                )
                db.session.add(rec)
            rec.amount_usd = amount
            db.session.commit()
        return redirect(url_for("dashboard"))

    @app.post("/delivered/set")
    def delivered_set():
        day = request.form.get("day") or date.today().strftime("%Y-%m-%d")
        country = request.form.get("country")
        qty = int(request.form.get("qty") or 0)
        if country:
            d = datetime.strptime(day, "%Y-%m-%d").date()
            rec = DailyDelivered.query.filter_by(day=d, country_code=country).first()
            if not rec:
                rec = DailyDelivered(day=d, country_code=country, delivered=0)
                db.session.add(rec)
            rec.delivered = qty
            db.session.commit()
        return redirect(url_for("dashboard"))

    @app.post("/shipment/new")
    def shipment_new():
        ref = request.form.get("ref","").strip() or f"SH{int(datetime.utcnow().timestamp())}"
        frm = request.form.get("from_country")
        to = request.form.get("to_country")
        eta = request.form.get("eta") or None
        ship_cost = float(request.form.get("ship_cost") or 0)
        product_id = int(request.form.get("product_id") or 0)
        qty = int(request.form.get("qty") or 0)
        if frm and to and product_id and qty > 0:
            sh = Shipment(ref=ref, from_country=frm, to_country=to, eta=(datetime.strptime(eta,"%Y-%m-%d").date() if eta else None),
                          shipping_cost_usd=ship_cost, status="in_transit")
            db.session.add(sh); db.session.flush()
            db.session.add(ShipmentItem(shipment_id=sh.id, product_id=product_id, qty=qty))
            db.session.commit()
        return redirect(url_for("dashboard"))

    @app.post("/shipment/arrived/<int:ship_id>")
    def shipment_arrived(ship_id):
        sh = Shipment.query.get(ship_id)
        if sh and sh.status == "in_transit":
            sh.status = "arrived"
            sh.arrived_at = datetime.utcnow()
            # move stock
            for it in sh.items:
                row = Stock.query.filter_by(product_id=it.product_id, country_code=sh.to_country).first()
                if not row:
                    row = Stock(product_id=it.product_id, country_code=sh.to_country, qty=0)
                    db.session.add(row)
                row.qty += it.qty
            db.session.commit()
        return redirect(url_for("dashboard"))

    return app

# dev run
if __name__ == "__main__":
    create_app().run(debug=True, host="0.0.0.0", port=5000)
