from flask import Flask, render_template, request, redirect, url_for, jsonify
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from werkzeug.security import check_password_hash
from datetime import date, timedelta
import os

from models import db, User, Country, Product, Stock, PlatformSpend, DailyDelivered, Shipment, ShipmentItem, Remittance, FinanceCategory, FinanceEntry, Todo, ProductCountryConfig
from models import PLATFORMS
from utils import seed_defaults, make_backup, restore_nearest, DB_FILE

def create_app():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "change-me")
    app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get("DATABASE_URL", f"sqlite:///{DB_FILE}")
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    # Persistent session until manual logout
    app.config["REMEMBER_COOKIE_DURATION"] = timedelta(days=3650)

    db.init_app(app)

    login_mgr = LoginManager()
    login_mgr.login_view = "login"
    login_mgr.init_app(app)

    @login_mgr.user_loader
    def load_user(uid):
        return db.session.get(User, int(uid))

    with app.app_context():
        db.create_all()
        seed_defaults()
        # first boot backup
        make_backup("boot")

    # --------- health ----------
    @app.get("/health")
    def health():
        return "ok", 200

    # --------- auth ----------
    @app.get("/login")
    def login():
        # very simple HTML to avoid template dependency for Part 1
        return """
        <form method='post' action='/login' style='max-width:320px;margin:80px auto;font-family:system-ui'>
           <h3>COD Control — Sign in</h3>
           <input name='u' placeholder='username' style='width:100%;padding:8px;margin:8px 0'>
           <input name='p' placeholder='password' type='password' style='width:100%;padding:8px;margin:8px 0'>
           <button style='padding:8px 12px;background:#16a34a;color:#fff;border:0;border-radius:6px'>Sign in</button>
        </form>
        """, 200

    @app.post("/login")
    def do_login():
        u = request.form.get("u","").strip()
        p = request.form.get("p","").strip()
        user = User.query.filter_by(username=u).first()
        if user and check_password_hash(user.pw_hash, p):
            login_user(user, remember=True)
            return redirect(url_for("dashboard"))
        return redirect(url_for("login"))

    @app.post("/logout")
    @login_required
    def logout():
        logout_user()
        return redirect(url_for("login"))

    # --------- dashboard (safe placeholder for Part 1) ----------
    @app.get("/")
    @login_required
    def dashboard():
        # Provide minimal JSON so page never crashes until templates arrive (Part 2)
        stats = {
            "products": Product.query.count(),
            "warehouses": Country.query.count(),
            "in_transit": Shipment.query.filter_by(status="in_transit").count(),
        }
        return jsonify({
            "status": "core-installed",
            "message": "Templates coming in Part 2. Backend OK.",
            "stats": stats,
            "countries": [c.code for c in Country.query.order_by(Country.name)],
            "platforms": list(PLATFORMS),
        })

    # --------- quick write endpoints we'll wire to forms later ----------
    @app.post("/api/country/add")
    @login_required
    def api_country_add():
        name = request.form.get("name","").strip()
        if not name:
            return ("missing name", 400)
        code = (name[:2] or "XX").upper()
        if not Country.query.get(code):
            db.session.add(Country(code=code, name=name))
            db.session.commit()
        make_backup("add-country")
        return redirect(url_for("dashboard"))

    @app.post("/api/backup/restore")
    @login_required
    def api_restore():
        minutes = int(request.form.get("minutes", "5"))
        chosen = restore_nearest(minutes)
        return (f"restored {chosen}" if chosen else "no backup found"), 200

    return app

# WSGI
app = create_app()
