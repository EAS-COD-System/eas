# app.py — core app with safe rendering, SQLite, single-admin login, daily backup
from flask import Flask, render_template, render_template_string, request, redirect, url_for, session, abort
from datetime import datetime, date, timedelta
from werkzeug.security import generate_password_hash, check_password_hash
from apscheduler.schedulers.background import BackgroundScheduler
import os
from dateutil import tz

from models import (
    db, Country, Product, Stock, PlatformSpend, DailyDelivered,
    Shipment, ShipmentItem, Remittance, FinanceCategory, FinanceEntry,
    Todo, BackupMeta, AdminUser
)

def _render(template_name, **ctx):
    """Try Jinja template; if missing (during first deploy), show a harmless shell."""
    try:
        return render_template(template_name, **ctx)
    except Exception:
        return render_template_string(
            "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
            "<link rel='stylesheet' href='https://unpkg.com/modern-css-reset/dist/reset.min.css'>"
            "<div style='max-width:960px;margin:40px auto;font-family:Inter,system-ui,sans-serif'>"
            "<h1>COD Control</h1><p>App shell ready. Templates not uploaded yet.</p>"
            "<p>Upload the templates, then refresh.</p></div>"
        )

def create_app():
    app = Flask(__name__)
    app.secret_key = os.environ.get("SECRET_KEY", "eas_cod_secret")
    app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get("DATABASE_URL", "sqlite:///cod_system.db")
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    # Session stays "forever" until manual logout:
    app.permanent_session_lifetime = timedelta(days=3650)

    db.init_app(app)

    # ---------- DB bootstrap ----------
    with app.app_context():
        db.create_all()

        # Seed admin user (username: eas, password: easnew)
        if not AdminUser.query.filter_by(username="eas").first():
            db.session.add(AdminUser(username="eas", password_hash=generate_password_hash("easnew")))
            db.session.commit()

        # Seed default countries if missing
        defaults = [
            ("CN", "China"),
            ("KE", "Kenya"),
            ("UG", "Uganda"),
            ("TZ", "Tanzania"),
            ("ZM", "Zambia"),
            ("ZW", "Zimbabwe"),
        ]
        for code, name in defaults:
            if not Country.query.get(code):
                db.session.add(Country(code=code, name=name))
        db.session.commit()

    # ---------- Auth ----------
    @app.before_request
    def require_login():
        open_paths = {"/login", "/health"}
        if request.path.startswith("/static/") or request.path in open_paths:
            return
        if not session.get("logged_in"):
            return redirect(url_for("login"))

    @app.get("/login")
    def login():
        return _render("login.html")

    @app.post("/login")
    def do_login():
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "").strip()
        user = AdminUser.query.filter_by(username=username).first()
        if user and check_password_hash(user.password_hash, password):
            session.permanent = True
            session["logged_in"] = True
            session["username"] = username
            return redirect(url_for("dashboard"))
        return _render("login.html", error="Invalid credentials")

    @app.get("/logout")
    def logout():
        session.clear()
        return redirect(url_for("login"))

    # ---------- Health check ----------
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

        # Country band summary
        summaries = []
        total_stock = 0
        total_in_transit = 0
        total_spend = 0.0
        for c in countries:
            stock_qty = db.session.query(db.func.coalesce(db.func.sum(Stock.qty), 0)).filter(Stock.country_code == c.code).scalar() or 0
            in_transit_qty = (
                db.session.query(db.func.coalesce(db.func.sum(ShipmentItem.qty), 0))
                .join(Shipment, ShipmentItem.shipment_id == Shipment.id)
                .filter(Shipment.status == "in_transit", Shipment.to_country == c.code)
                .scalar() or 0
            )
            spend_usd = db.session.query(db.func.coalesce(db.func.sum(PlatformSpend.amount_usd), 0.0)).filter(
                PlatformSpend.country_code == c.code
            ).scalar() or 0.0
            summaries.append({"code": c.code, "name": c.name, "stock": int(stock_qty), "in_transit": int(in_transit_qty), "spend": float(spend_usd)})
            total_stock += stock_qty
            total_in_transit += in_transit_qty
            total_spend += spend_usd

        # Shipments in transit
        cn_ke = Shipment.query.filter(
            Shipment.status == "in_transit", Shipment.from_country == "CN", Shipment.to_country == "KE"
        ).order_by(Shipment.created_at.desc()).all()
        inter = Shipment.query.filter(
            Shipment.status == "in_transit", Shipment.from_country != "CN"
        ).order_by(Shipment.created_at.desc()).all()

        # Daily delivered — last 8 days
        today = date.today()
        days = [today - timedelta(days=i) for i in range(7, -1, -1)]
        delivered_rows = []
        for d in days:
            row = {"date": d.strftime("%Y-%m-%d")}
            total = 0
            for c in countries:
                dd = DailyDelivered.query.filter_by(day=d, country_code=c.code).first()
                qty = dd.delivered if dd else 0
                row[c.code] = qty
                total += qty
            row["total"] = total
            delivered_rows.append(row)

        # To-do list (latest 50)
        todos = Todo.query.order_by(Todo.id.desc()).limit(50).all()

        return _render(
            "index.html",
            stats=stats,
            summaries=summaries,
            total_stock=int(total_stock),
            total_in_transit=int(total_in_transit),
            total_spend=float(total_spend),
            cn_ke=cn_ke,
            inter=inter,
            days=days,
            delivered_rows=delivered_rows,
            todos=todos,
            countries=countries,
        )

    # ---------- Minimal POST endpoints (forms will post to these) ----------
    @app.post("/daily_spend/set")
    def set_daily_spend():
        day = request.form.get("day") or date.today().isoformat()
        product_id = int(request.form.get("product_id"))
        country = request.form.get("country_code")
        platform = request.form.get("platform")  # facebook|tiktok|google
        amount = float(request.form.get("amount_usd", 0) or 0)
        d = date.fromisoformat(day)

        row = PlatformSpend.query.filter_by(day=d, product_id=product_id, country_code=country, platform=platform).first()
        if not row:
            row = PlatformSpend(day=d, product_id=product_id, country_code=country, platform=platform, amount_usd=amount)
            db.session.add(row)
        else:
            row.amount_usd = amount
        db.session.commit()
        return redirect(url_for("dashboard"))

    @app.post("/delivered/set")
    def set_delivered():
        day = request.form.get("day") or date.today().isoformat()
        country = request.form.get("country_code")
        qty = int(request.form.get("delivered", 0) or 0)
        d = date.fromisoformat(day)

        row = DailyDelivered.query.filter_by(day=d, country_code=country).first()
        if not row:
            row = DailyDelivered(day=d, country_code=country, delivered=qty)
            db.session.add(row)
        else:
            row.delivered = qty
        db.session.commit()
        return redirect(url_for("dashboard"))

    @app.post("/shipment/create")
    def create_shipment():
        from_country = request.form.get("from_country")
        to_country = request.form.get("to_country")
        ref = request.form.get("ref") or None
        eta = request.form.get("eta") or None
        shipping_cost_usd = float(request.form.get("shipping_cost_usd", 0) or 0)

        sh = Shipment(
            from_country=from_country,
            to_country=to_country,
            ref=ref,
            eta=date.fromisoformat(eta) if eta else None,
            shipping_cost_usd=shipping_cost_usd,
            status="in_transit",
        )
        db.session.add(sh)
        db.session.commit()
        return redirect(url_for("dashboard"))

    @app.post("/shipment/mark_arrived/<int:shipment_id>")
    def mark_arrived(shipment_id: int):
        sh = Shipment.query.get_or_404(shipment_id)
        if sh.status != "arrived":
            sh.status = "arrived"
            sh.arrived_at = datetime.utcnow()
            # Move items to stock if items exist
            for it in sh.items:
                stock = Stock.query.filter_by(product_id=it.product_id, country_code=sh.to_country).first()
                if not stock:
                    stock = Stock(product_id=it.product_id, country_code=sh.to_country, qty=0)
                    db.session.add(stock)
                stock.qty += it.qty
            db.session.commit()
        return redirect(url_for("dashboard"))

    @app.post("/todo/add")
    def todo_add():
        title = request.form.get("title", "").strip()
        week_day = request.form.get("week_day") or None
        if title:
            db.session.add(Todo(title=title, week_day=week_day, status="todo"))
            db.session.commit()
        return redirect(url_for("dashboard"))

    @app.post("/todo/set_status/<int:todo_id>")
    def todo_set_status(todo_id: int):
        status = request.form.get("status", "todo")
        t = Todo.query.get_or_404(todo_id)
        t.status = status
        db.session.commit()
        return redirect(url_for("dashboard"))

    @app.post("/todo/delete/<int:todo_id>")
    def todo_delete(todo_id: int):
        t = Todo.query.get_or_404(todo_id)
        db.session.delete(t)
        db.session.commit()
        return redirect(url_for("dashboard"))

    # ---------- Simple list pages (templates in next batch) ----------
    @app.get("/products")
    def products_page():
        products = Product.query.order_by(Product.name).all()
        countries = Country.query.order_by(Country.name).all()
        return _render("products.html", products=products, countries=countries)

    @app.get("/performance")
    def performance_page():
        return _render("performance.html")

    @app.get("/finance")
    def finance_page():
        return _render("finance.html")

    @app.get("/settings")
    def settings_page():
        countries = Country.query.order_by(Country.name).all()
        products = Product.query.order_by(Product.name).all()
        return _render("settings.html", countries=countries, products=products)

    # ---------- Automatic daily backup ----------
    def _ensure_backup_dir():
        p = os.path.join(os.getcwd(), "backups")
        os.makedirs(p, exist_ok=True)
        return p

    def perform_backup():
        db_path = app.config["SQLALCHEMY_DATABASE_URI"].replace("sqlite:///", "")
        if not db_path or not os.path.exists(db_path):
            return
        backups = _ensure_backup_dir()
        ts = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        dest = os.path.join(backups, f"cod_system-{ts}.db")
        # Safe copy
        with open(db_path, "rb") as src, open(dest, "wb") as dst:
            dst.write(src.read())
        db.session.add(BackupMeta(path=dest))
        db.session.commit()

    scheduler = BackgroundScheduler(daemon=True, timezone=str(tz.tzutc()))
    scheduler.add_job(perform_backup, "interval", hours=24, id="daily_backup", replace_existing=True)
    scheduler.start()

    return app


# Gunicorn entrypoint
app = create_app()

if __name__ == "__main__":
    # Local dev run: python app.py
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
