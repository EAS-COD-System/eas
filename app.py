from flask import Flask, render_template, request, redirect, url_for, flash, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import func
from datetime import datetime, date, timedelta
import os, shutil, re
from apscheduler.schedulers.background import BackgroundScheduler

from models import db, Country, Product, Stock, PlatformSpend, DailyDelivered, Shipment, ShipmentItem, Remittance, FinanceCategory, FinanceEntry, Todo

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY","eas-secret")
DB_PATH = os.getenv("DB_PATH","cod_system.db")
BACKUP_DIR = os.getenv("BACKUP_DIR","backups")
os.makedirs(BACKUP_DIR, exist_ok=True)

app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{DB_PATH}"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db.init_app(app)

DEFAULT = [("CN","China"),("KE","Kenya"),("TZ","Tanzania"),("UG","Uganda"),("ZM","Zambia"),("ZW","Zimbabwe")]

# ---- Backup scheduler ----
def make_backup():
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M")
    dst = os.path.join(BACKUP_DIR, f"backup_{ts}.db")
    if os.path.exists(DB_PATH):
        shutil.copy(DB_PATH, dst)
        files = sorted([f for f in os.listdir(BACKUP_DIR) if f.startswith("backup_")])
        while len(files) > 20:
            os.remove(os.path.join(BACKUP_DIR, files.pop(0)))

def setup_scheduler():
    scheduler = BackgroundScheduler(daemon=True, timezone="UTC")
    scheduler.add_job(make_backup, "interval", hours=12, id="db_backup", replace_existing=True)
    scheduler.start()

BACKUP_NAME_RE = re.compile(r"^backup_\d{8}_\d{4}\.db$")
def list_backups():
    try:
        files = [f for f in os.listdir(BACKUP_DIR) if BACKUP_NAME_RE.match(f)]
        files.sort(reverse=True)
        return files
    except Exception:
        return []

@app.before_first_request
def bootstrap():
    db.create_all()
    if Country.query.count()==0:
        for c,n in DEFAULT: db.session.add(Country(code=c,name=n))
        db.session.commit()
    setup_scheduler()
    make_backup()

def codes():
    return [c.code for c in Country.query.order_by(Country.name).all() if c.code!="CN"]

# ---------- DASHBOARD ----------
@app.route("/")
def index():
    counts = {
        "products": Product.query.count(),
        "warehouses": Country.query.count(),
        "in_transit": Shipment.query.filter_by(status="in_transit").count()
    }

    band = {}
    for c in Country.query.order_by(Country.name).all():
        if c.code=="CN":
            continue
        stock_qty = db.session.query(func.coalesce(func.sum(Stock.qty),0)).filter_by(country_code=c.code).scalar() or 0
        in_transit_qty = db.session.query(func.coalesce(func.sum(ShipmentItem.qty),0))\
                         .join(Shipment).filter(Shipment.status=="in_transit", Shipment.to_country==c.code).scalar() or 0
        ad_spend = db.session.query(func.coalesce(func.sum(PlatformSpend.amount_usd),0)).filter_by(country_code=c.code).scalar() or 0.0
        band[c.code] = {"name": c.name, "stock": int(stock_qty), "in_transit": int(in_transit_qty), "ad_spend": float(ad_spend)}

    total = {
        "stock": sum(v["stock"] for v in band.values()),
        "in_transit": sum(v["in_transit"] for v in band.values()),
        "ad_spend": round(sum(v["ad_spend"] for v in band.values()),2)
    }

    cn_ke = Shipment.query.filter_by(status="in_transit", from_country="CN", to_country="KE").order_by(Shipment.created_at.desc()).all()
    inter = Shipment.query.filter(Shipment.status=="in_transit", Shipment.from_country!="CN").order_by(Shipment.created_at.desc()).all()

    today = date.today()
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)
    week_map = {}
    for cc in codes():
        n = db.session.query(func.coalesce(func.sum(DailyDelivered.delivered),0))\
            .filter(DailyDelivered.country_code==cc, DailyDelivered.day>=monday, DailyDelivered.day<=sunday).scalar() or 0
        week_map[cc] = int(n)
    week_total = sum(week_map.values())

    products = Product.query.order_by(Product.sku).all()
    return render_template("index.html",
                           counts=counts, band=band, total=total,
                           cn_ke=cn_ke, inter=inter, products=products,
                           week_map=week_map, week_total=week_total,
                           countries=[c for c in Country.query.order_by(Country.name).all()],
                           title="Dashboard")

@app.post("/delivered/add")
def delivered_add():
    day = request.form.get("day") or date.today().isoformat()
    day_obj = date.fromisoformat(day)
    cc = request.form["country"]
    delivered = int(request.form.get("delivered") or 0)
    row = DailyDelivered.query.filter_by(country_code=cc, day=day_obj).first()
    if row: row.delivered = delivered
    else: db.session.add(DailyDelivered(country_code=cc, day=day_obj, delivered=delivered))
    db.session.commit(); flash("Saved daily delivered","success")
    return redirect(url_for("index"))

@app.post("/spend/set")
def spend_set():
    sku = request.form["sku"]; cc = request.form["country"]; platform = request.form["platform"].lower()
    amount = float(request.form.get("amount") or 0.0)
    row = PlatformSpend.query.filter_by(product_sku=sku, country_code=cc, platform=platform).first()
    if row:
        row.amount_usd = amount; row.updated_at = datetime.utcnow()
    else:
        db.session.add(PlatformSpend(product_sku=sku, country_code=cc, platform=platform, amount_usd=amount))
    db.session.commit(); flash("Spend updated","success")
    return redirect(url_for("index"))

@app.post("/shipment/create")
def shipment_create():
    ref = request.form.get("ref") or f"SH{int(datetime.utcnow().timestamp())}"
    from_c = request.form["from_country"]; to_c = request.form["to_country"]
    sku = request.form["sku"]; qty = int(request.form.get("qty") or 0)
    cost = float(request.form.get("shipping_cost") or 0.0)
    sh = Shipment(ref=ref, from_country=from_c, to_country=to_c, shipping_cost_usd=cost)
    db.session.add(sh); db.session.flush()
    db.session.add(ShipmentItem(shipment_id=sh.id, product_sku=sku, qty=qty))
    db.session.commit(); flash("Shipment created","success")
    return redirect(url_for("index"))

@app.post("/shipment/edit")
def shipment_edit():
    sid = int(request.form["shipment_id"])
    qty = int(request.form.get("qty") or 0)
    cost = float(request.form.get("shipping_cost") or 0.0)
    sh = Shipment.query.get_or_404(sid)
    sh.shipping_cost_usd = cost
    if sh.items:
        sh.items[0].qty = qty
    db.session.commit(); flash("Shipment updated","success")
    return redirect(url_for("index"))

@app.post("/shipment/mark-arrived")
def shipment_mark_arrived():
    sid = int(request.form["shipment_id"]); sh = Shipment.query.get_or_404(sid)
    if sh.status == "arrived":
        return redirect(url_for("index"))
    sh.status = "arrived"; sh.arrived_at = datetime.utcnow()
    for it in sh.items:
        st = Stock.query.filter_by(product_sku=it.product_sku, country_code=sh.to_country).first()
        if not st: st = Stock(product_sku=it.product_sku, country_code=sh.to_country, qty=0); db.session.add(st)
        st.qty += it.qty or 0
    db.session.commit(); flash("Marked arrived & stock updated","success")
    return redirect(url_for("index"))

@app.post("/shipment/delete")
def shipment_delete():
    sid = int(request.form["shipment_id"])
    ShipmentItem.query.filter_by(shipment_id=sid).delete()
    Shipment.query.filter_by(id=sid).delete()
    db.session.commit(); flash("Shipment deleted","success")
    return redirect(url_for("index"))

# ---------- PRODUCTS ----------
@app.route("/products", methods=["GET","POST"])
def products():
    if request.method=="POST":
        sku = request.form.get("sku","").strip()
        if not sku: 
            flash("SKU required","error"); return redirect(url_for("products"))
        p = Product(sku=sku, name=request.form.get("name") or sku,
                    cost_cn=float(request.form.get("cost") or 0),
                    ship_cn_ke=float(request.form.get("shipping") or 0))
        db.session.add(p); db.session.commit(); flash("Product added","success")
        return redirect(url_for("products"))
    items = Product.query.order_by(Product.sku).all()
    return render_template("products.html", products=items, title="Products")

@app.post("/delete_product")
def delete_product():
    sku = request.form["sku"]
    Stock.query.filter_by(product_sku=sku).delete()
    PlatformSpend.query.filter_by(product_sku=sku).delete()
    ShipmentItem.query.filter_by(product_sku=sku).delete()
    Remittance.query.filter_by(product_sku=sku).delete()
    Product.query.filter_by(sku=sku).delete()
    db.session.commit(); flash("Product deleted","success")
    return redirect(url_for("products"))

@app.get("/product/<sku>")
def product_detail(sku):
    p = Product.query.get_or_404(sku)
    rows = []
    for c in Country.query.filter(Country.code!="CN").order_by(Country.name).all():
        stock_qty = db.session.query(func.coalesce(func.sum(Stock.qty),0)).filter_by(product_sku=sku,country_code=c.code).scalar() or 0
        spend = db.session.query(func.coalesce(func.sum(PlatformSpend.amount_usd),0)).filter_by(product_sku=sku,country_code=c.code).scalar() or 0.0
        rems = Remittance.query.filter_by(product_sku=sku, country_code=c.code).all()
        profit_total = 0.0
        for r in rems:
            per_piece_cost = (p.cost_cn or 0.0) + (p.ship_cn_ke or 0.0) + (r.extra_ship_per_piece_usd or 0.0)
            profit_total += (r.revenue_usd or 0.0) - (r.ads_usd or 0.0) - per_piece_cost*(r.pieces or 0)
        rows.append({"country":c.name, "code":c.code, "stock":int(stock_qty), "spend":float(spend), "profit":round(profit_total,2)})
    cnke = Shipment.query.filter_by(from_country="CN", to_country="KE").order_by(Shipment.created_at.desc()).all()
    inter = Shipment.query.filter(Shipment.from_country!="CN").order_by(Shipment.created_at.desc()).all()
    return render_template("product.html", product=p, country_rows=rows, cnke=cnke, inter=inter, title=p.name)

# ---------- PERFORMANCE ----------
@app.get("/performance")
def performance():
    period = request.args.get("period","21d")
    country = request.args.get("country","")
    days = {"10d":10,"21d":21,"35d":35,"60d":60,"3m":90,"6m":180,"1y":365}.get(period,21)
    since = date.today() - timedelta(days=days)
    q = Remittance.query.filter(Remittance.date_from>=since)
    if country: q = q.filter(Remittance.country_code==country)
    rows = q.all()
    report = []
    for r in rows:
        p = Product.query.get(r.product_sku)
        cost_piece = (p.cost_cn or 0.0) + (p.ship_cn_ke or 0.0) + (r.extra_ship_per_piece_usd or 0.0)
        profit = (r.revenue_usd or 0.0) - (r.ads_usd or 0.0) - cost_piece*(r.pieces or 0)
        report.append({"sku":r.product_sku,"country":r.country_code,"orders":r.orders,"pieces":r.pieces,
                       "revenue":r.revenue_usd,"ads":r.ads_usd,"profit":profit})
    report.sort(key=lambda x: x["profit"], reverse=True)
    countries = [c.code for c in Country.query.filter(Country.code!="CN").order_by(Country.name).all()]
    return render_template("performance.html", countries=countries, report=report, remits=rows, title="Performance")

@app.post("/remit/add")
def remit_add():
    sku = request.form["sku"]; cc = request.form["country"]
    dfrom = date.fromisoformat(request.form["date_from"]); dto = date.fromisoformat(request.form["date_to"])
    orders = int(request.form.get("orders") or 0)
    pieces = int(request.form.get("pieces") or 0)
    revenue = float(request.form.get("revenue") or 0)
    ads = float(request.form.get("ads") or 0)
    extra = float(request.form.get("extra_ship") or 0)
    db.session.add(Remittance(product_sku=sku, country_code=cc, date_from=dfrom, date_to=dto,
                              orders=orders, pieces=pieces, revenue_usd=revenue, ads_usd=ads,
                              extra_ship_per_piece_usd=extra))
    if pieces>0:
        st = Stock.query.filter_by(product_sku=sku, country_code=cc).first()
        if not st: st = Stock(product_sku=sku, country_code=cc, qty=0); db.session.add(st)
        st.qty = max(0, (st.qty or 0) - pieces)
    db.session.commit(); flash("Remittance added","success")
    return redirect(url_for("performance"))

# ---------- FINANCE ----------
@app.get("/finance")
def finance():
    entries = FinanceEntry.query.order_by(FinanceEntry.entry_date.desc(), FinanceEntry.id.desc()).all()
    monthly = {}
    running = 0.0
    timeline = []
    for e in entries[::-1]:
        running += e.amount_usd if e.type=="credit" else -e.amount_usd
        cname = FinanceCategory.query.get(e.category_id).name if e.category_id else "General"
        timeline.append({"date":e.entry_date.isoformat(),"type":e.type,"category":cname,"description":e.description,"amount":e.amount_usd,"balance":running})
        key = e.entry_date.strftime("%Y-%m")
        m = monthly.setdefault(key, {"credit":0.0,"debit":0.0})
        if e.type=="credit": m["credit"] += e.amount_usd
        else: m["debit"] += e.amount_usd
    monthly_rows = [{"month":k,"credit":v["credit"],"debit":v["debit"],"balance":v["credit"]-v["debit"]} for k,v in sorted(monthly.items())]
    cats = [c.name for c in FinanceCategory.query.order_by(FinanceCategory.name).all()]
    return render_template("finance.html", monthly=monthly_rows, categories=cats, transactions=timeline, title="Finance")

@app.post("/add_transaction")
def add_transaction():
    typ = request.form["type"]
    cname = request.form.get("category") or "General"
    cat = FinanceCategory.query.filter_by(name=cname).first()
    if not cat:
        cat = FinanceCategory(name=cname); db.session.add(cat); db.session.flush()
    amt = float(request.form.get("amount") or 0.0)
    desc = request.form.get("description") or ""
    db.session.add(FinanceEntry(type=typ, category_id=cat.id, description=desc, amount_usd=amt, entry_date=date.today()))
    db.session.commit(); flash("Transaction added","success")
    return redirect(url_for("finance"))

# ---------- SETTINGS ----------
@app.get("/settings")
def settings():
    return render_template(
        "settings.html",
        countries=[c for c in Country.query.order_by(Country.name).all()],
        products=[p for p in Product.query.order_by(Product.sku).all()],
        backups=list_backups(),
        title="Settings"
    )

@app.post("/add_country")
def add_country():
    name = request.form["country"].strip()
    if not name: return redirect(url_for("settings"))
    code = name[:2].upper()
    if Country.query.filter((Country.code==code)|(Country.name==name)).first():
        flash("Country exists","error"); return redirect(url_for("settings"))
    db.session.add(Country(code=code, name=name)); db.session.commit(); flash("Country added","success")
    return redirect(url_for("settings"))

@app.post("/delete_country")
def delete_country():
    name = request.form["country"]; c = Country.query.filter_by(name=name).first()
    if not c: flash("Not found","error"); return redirect(url_for("settings"))
    Stock.query.filter_by(country_code=c.code).delete()
    PlatformSpend.query.filter_by(country_code=c.code).delete()
    DailyDelivered.query.filter_by(country_code=c.code).delete()
    Remittance.query.filter_by(country_code=c.code).delete()
    for sh in Shipment.query.filter((Shipment.from_country==c.code)|(Shipment.to_country==c.code)).all():
        ShipmentItem.query.filter_by(shipment_id=sh.id).delete(); db.session.delete(sh)
    db.session.delete(c); db.session.commit(); flash("Country deleted","success")
    return redirect(url_for("settings"))

@app.post("/edit_product")
def edit_product():
    sku = request.form.get("sku"); p = Product.query.get(sku)
    if not p: flash("Product not found","error"); return redirect(url_for("settings"))
    p.name = request.form.get("name") or p.name
    if request.form.get("cost"): p.cost_cn = float(request.form.get("cost"))
    if request.form.get("shipping"): p.ship_cn_ke = float(request.form.get("shipping"))
    db.session.commit(); flash("Product updated","success")
    return redirect(url_for("settings"))

# ---------- TODO ----------
@app.post("/add_task")
def add_task():
    text = request.form.get("task","").strip()
    status = request.form.get("status","pending")
    day = request.form.get("week_day") or None
    if text: db.session.add(Todo(text=text,status=status,week_day=day)); db.session.commit(); flash("Task added","success")
    return redirect(url_for("index"))

@app.post("/delete_task")
def delete_task():
    tid = int(request.form["task_id"]); Todo.query.filter_by(id=tid).delete(); db.session.commit(); flash("Task deleted","success")
    return redirect(url_for("index"))

# ---------- Backups: download / create / restore / delete ----------
@app.get("/backups/<name>")
def download_backup(name):
    if not BACKUP_NAME_RE.match(name): 
        flash("Invalid backup name","error"); 
        return redirect(url_for("settings"))
    return send_from_directory(BACKUP_DIR, name, as_attachment=True)

@app.post("/backup_now")
def backup_now():
    make_backup()
    flash("Backup created.","success")
    return redirect(url_for("settings"))

@app.post("/restore_backup")
def restore_backup():
    name = request.form.get("backup")
    if not name or not BACKUP_NAME_RE.match(name):
        flash("Select a valid backup.","error")
        return redirect(url_for("settings"))
    path = os.path.join(BACKUP_DIR, name)
    if not os.path.exists(path):
        flash("Backup file not found.","error")
        return redirect(url_for("settings"))
    db.session.remove()
    try:
        shutil.copy(path, DB_PATH)
        flash(f"Restored database from {name}.","success")
    except Exception as e:
        flash(f"Restore failed: {e}","error")
    return redirect(url_for("settings"))

@app.post("/delete_backup")
def delete_backup():
    name = request.form.get("backup")
    if not name or not BACKUP_NAME_RE.match(name):
        flash("Select a valid backup.","error")
        return redirect(url_for("settings"))
    path = os.path.join(BACKUP_DIR, name)
    try:
        if os.path.exists(path): os.remove(path)
        flash("Backup deleted.","success")
    except Exception as e:
        flash(f"Delete failed: {e}","error")
    return redirect(url_for("settings"))

@app.get("/health")
def health(): return {"ok":True}

if __name__ == "__main__":
    app.run(debug=True)
