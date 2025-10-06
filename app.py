from flask import Flask, render_template, request, redirect, url_for, flash
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session
from models import Base, Product, Country, Warehouse, StockMovement, PlatformSpendCurrent, Shipment, ShipmentItem, WeeklyCountryPerf, WeeklyProductPerf
import os, datetime

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY","devkey")
DB_PATH = os.environ.get("DB_PATH","eas_cod.db")
engine = create_engine(f"sqlite:///{DB_PATH}", echo=False, future=True)

def migrate():
    with engine.begin() as conn:
        Base.metadata.create_all(conn)
        # add new columns if missing
        def has_col(table, col):
            rows = conn.exec_driver_sql(f"PRAGMA table_info({table})").fetchall()
            return any(r[1]==col for r in rows)
        if not has_col("shipments","transit_days"):
            conn.exec_driver_sql("ALTER TABLE shipments ADD COLUMN transit_days INTEGER DEFAULT 0")
migrate()

# bootstrap
with Session(engine) as s:
    if not s.query(Country).count():
        s.add_all([
            Country(country="Kenya", code="KE", currency="KES", fx_to_usd=0.0076),
            Country(country="Uganda", code="UG", currency="UGX", fx_to_usd=0.00027),
            Country(country="Tanzania", code="TZ", currency="TZS", fx_to_usd=0.00038),
            Country(country="Zambia", code="ZM", currency="ZMW", fx_to_usd=0.050),
            Country(country="Zimbabwe", code="ZW", currency="ZWL", fx_to_usd=0.00010),
            Country(country="China", code="CN", currency="USD", fx_to_usd=1.0),
        ])
    if not s.query(Warehouse).count():
        s.add_all([
            Warehouse(name="China Hub", country="China", code="CN", active=True),
            Warehouse(name="Nairobi Main", country="Kenya", code="KE", active=True),
            Warehouse(name="Kampala Hub", country="Uganda", code="UG", active=True),
            Warehouse(name="Dar Hub", country="Tanzania", code="TZ", active=True),
            Warehouse(name="Lusaka Hub", country="Zambia", code="ZM", active=True),
            Warehouse(name="Harare Hub", country="Zimbabwe", code="ZW", active=True),
        ])
    if not s.query(Product).count():
        s.add_all([
            Product(product_sku="TK1-FOOT", product_name="EMS Foot Massager", category="Wellness", weight_g=720, cost_cn_usd=8.20, status="active"),
            Product(product_sku="GLS-TRIM", product_name="Dermave Trimmer", category="Beauty", weight_g=180, cost_cn_usd=3.10, status="active"),
        ])
    s.commit()

def countries_list(session):
    return [c for c in session.query(Country).all() if c.code!="CN"]

@app.route("/", methods=["GET","POST"])
def index():
    q = request.form.get("q","").strip() if request.method=="POST" else request.args.get("q","") or ""
    week_filter = request.args.get("week","")
    with Session(engine) as s:
        counts = {
            "products": s.query(Product).count(),
            "warehouses": s.query(Warehouse).count(),
            "in_transit": s.query(Shipment).filter(Shipment.status=="in_transit").count()
        }
        all_products = s.query(Product).order_by(Product.product_sku).all()
        ctrs = countries_list(s)
        # band (stock/in_transit/ad from daily current spend)
        band = {c.country: {"stock":0,"in_transit":0,"ad_spend":0.0} for c in ctrs}
        whs = s.query(Warehouse).filter(Warehouse.active==True).all()
        wh_by_id = {w.id:w for w in whs}
        # stock from movements
        for sku, in s.query(Product.product_sku).all():
            bal = {}
            for m in s.query(StockMovement).filter(StockMovement.product_sku==sku).all():
                if m.to_wh: bal[m.to_wh]=bal.get(m.to_wh,0)+m.qty
                if m.from_wh: bal[m.from_wh]=bal.get(m.from_wh,0)-m.qty
            for wid,qty in bal.items():
                c = wh_by_id[wid].country
                if c in band: band[c]["stock"]+=qty
        # in-transit
        for sh in s.query(Shipment).filter(Shipment.status=="in_transit").all():
            qty = s.execute(select(func.sum(ShipmentItem.qty)).where(ShipmentItem.shipment_id==sh.id)).scalar() or 0
            if sh.to_country in band: band[sh.to_country]["in_transit"]+=qty
        # ad spend current (daily, not in profit)
        code_to_country = {c.code:c.country for c in s.query(Country).all()}
        for r in s.query(PlatformSpendCurrent).all():
            name = code_to_country.get(r.country_code,r.country_code)
            if name in band: band[name]["ad_spend"]+= (r.amount_usd or 0.0)
        # shipments split
        cn_ke=[]; inter=[]
        for sh in s.query(Shipment).filter(Shipment.status=="in_transit").all():
            items = s.query(ShipmentItem).filter(ShipmentItem.shipment_id==sh.id).all()
            sh.items_str = ", ".join([f"{it.product_sku}:{it.qty}" for it in items])
            sh.first_sku = items[0].product_sku if items else ""
            if sh.from_country=="China" and sh.to_country=="Kenya": cn_ke.append(sh)
            else: inter.append(sh)
        # weekly tables
        wcty_rows = s.query(WeeklyCountryPerf).order_by(WeeklyCountryPerf.week_start.desc()).limit(20).all()
        wprod_rows = s.query(WeeklyProductPerf).order_by(WeeklyProductPerf.week_start.desc(), WeeklyProductPerf.country_code, WeeklyProductPerf.product_sku).limit(50).all()
        weekly_profit = []
        if week_filter:
            for r in s.query(WeeklyProductPerf).filter(WeeklyProductPerf.week_start==week_filter).all():
                profit = (r.revenue_usd or 0.0) - (r.ad_spend_usd or 0.0)
                weekly_profit.append(type("ROW",(object,),dict(week_start=r.week_start, country_code=r.country_code, product_sku=r.product_sku,
                                                               delivered_qty=r.delivered_qty, revenue_usd=r.revenue_usd, ad_spend_usd=r.ad_spend_usd,
                                                               profit_usd=profit))())
    return render_template("index.html", counts=counts, countries=ctrs, band=band, cn_ke=cn_ke, inter=inter,
                           all_products=all_products, wcty_rows=wcty_rows, wprod_rows=wprod_rows,
                           weekly_profit=weekly_profit, week_filter=week_filter, q=q, title="Dashboard")

# Daily ad spend (not in profit)
@app.post("/set_current_spend")
def set_current_spend():
    d = request.form
    try:
        with Session(engine) as s:
            s.add(PlatformSpendCurrent(product_sku=d.get("product_sku"), platform=d.get("platform"),
                                       amount_usd=float(d.get("amount_usd") or 0), currency="USD",
                                       country_code=d.get("country_code"))); s.commit()
        flash("Saved current daily spend (USD)","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("index"))

# Weekly country perf (delivered only, not affecting stock)
@app.post("/upsert_weekly_country")
def upsert_weekly_country():
    d = request.form
    try:
        wk = d.get("week_start"); code = d.get("country_code")
        qty = int(d.get("delivered") or 0)
        with Session(engine) as s:
            row = s.query(WeeklyCountryPerf).filter(WeeklyCountryPerf.week_start==wk, WeeklyCountryPerf.country_code==code).first()
            if row: row.delivered_count = qty
            else: s.add(WeeklyCountryPerf(week_start=wk, country_code=code, delivered_count=qty))
            s.commit()
        flash("Saved weekly delivered (performance only)","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("index"))

@app.post("/delete_weekly_country")
def delete_weekly_country():
    with Session(engine) as s:
        s.query(WeeklyCountryPerf).filter(WeeklyCountryPerf.id==int(request.form.get("id"))).delete(); s.commit()
    flash("Deleted","ok")
    return redirect(url_for("index"))

# Weekly product perf (delivered, revenue USD, ad USD) and deduct stock
@app.post("/upsert_weekly_product")
def upsert_weekly_product():
    d = request.form
    try:
        wk = d.get("week_start"); code = d.get("country_code"); sku = d.get("product_sku")
        dq = int(d.get("delivered_qty") or 0); rev = float(d.get("revenue_usd") or 0.0); ad = float(d.get("ad_spend_usd") or 0.0)
        with Session(engine) as s:
            row = s.query(WeeklyProductPerf).filter(WeeklyProductPerf.week_start==wk, WeeklyProductPerf.country_code==code, WeeklyProductPerf.product_sku==sku).first()
            if row:
                row.delivered_qty = dq; row.revenue_usd = rev; row.ad_spend_usd = ad
            else:
                s.add(WeeklyProductPerf(week_start=wk, country_code=code, product_sku=sku, delivered_qty=dq, revenue_usd=rev, ad_spend_usd=ad))
            # deduct stock now
            wh = s.query(Warehouse).filter(Warehouse.code==code, Warehouse.active==True).first()
            if wh and dq>0:
                s.add(StockMovement(date=wk, product_sku=sku, from_wh=wh.id, to_wh=None, qty=dq, ref=f"WEEKLY-{code}-{wk}"))
            s.commit()
        flash("Saved weekly product performance + stock deducted","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("index"))

@app.post("/delete_weekly_product")
def delete_weekly_product():
    id = int(request.form.get("id"))
    with Session(engine) as s:
        s.query(WeeklyProductPerf).filter(WeeklyProductPerf.id==id).delete(); s.commit()
    flash("Deleted","ok")
    return redirect(url_for("index"))

# Create transfer (homepage), CN and inter-country
@app.post("/create_transfer_home")
def create_transfer_home():
    d = request.form
    try:
        with Session(engine) as s:
            code_to_country = {c.code:c.country for c in s.query(Country).all()}
            sh = Shipment(ref=d.get("ref"),
                          from_country=code_to_country.get(d.get("from_code"), d.get("from_code")),
                          to_country=code_to_country.get(d.get("to_code"), d.get("to_code")),
                          status="in_transit", created_date=str(datetime.date.today()),
                          shipping_cost_usd=float(d.get("shipping_cost_usd") or 0.0))
            s.add(sh); s.flush()
            s.add(ShipmentItem(shipment_id=sh.id, product_sku=d.get("product_sku"), qty=int(d.get("qty") or 0)))
            s.commit()
        flash("Shipment created (in transit)","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("index"))

# Mark arrived (homepage + product), compute transit days and move stock
@app.post("/mark_arrived")
def mark_arrived():
    shipment_id = int(request.form.get("shipment_id")); final_ship = float(request.form.get("shipping_cost_usd") or 0.0)
    try:
        with Session(engine) as s:
            sh = s.get(Shipment, shipment_id)
            if not sh: 
                flash("Shipment not found","error"); return redirect(url_for("index"))
            sh.status="arrived"; sh.arrived_date=str(datetime.date.today())
            if sh.created_date and sh.arrived_date:
                try:
                    d0 = datetime.date.fromisoformat(sh.created_date)
                    d1 = datetime.date.fromisoformat(sh.arrived_date)
                    sh.transit_days = (d1-d0).days
                except Exception:
                    sh.transit_days = 0
            if final_ship: sh.shipping_cost_usd = final_ship
            wh_from = s.query(Warehouse).filter(Warehouse.country==sh.from_country, Warehouse.active==True).first()
            wh_to = s.query(Warehouse).filter(Warehouse.country==sh.to_country, Warehouse.active==True).first()
            for it in s.query(ShipmentItem).filter(ShipmentItem.shipment_id==shipment_id).all():
                if wh_to and it.qty:
                    s.add(StockMovement(date=sh.arrived_date, product_sku=it.product_sku, from_wh=wh_from.id if wh_from else None, to_wh=wh_to.id, qty=it.qty, ref=f"ARR-{sh.ref}"))
            s.commit()
        flash("Marked arrived, stock moved, transit days set","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("index"))

@app.get("/products")
def products():
    with Session(engine) as s:
        prods = s.query(Product).order_by(Product.product_sku).all()
    return render_template("products.html", products=prods, title="Products")

@app.post("/products/add")
def add_product():
    d = request.form
    try:
        with Session(engine) as s:
            if s.get(Product, d.get("product_sku")):
                flash("SKU exists","error")
            else:
                s.add(Product(product_sku=d.get("product_sku"), product_name=d.get("product_name"),
                              category=d.get("category"), weight_g=int(d.get("weight_g") or 0),
                              cost_cn_usd=float(d.get("cost_cn_usd") or 0.0),
                              default_cnke_ship_usd=float(d.get("default_cnke_ship_usd") or 0.0),
                              profit_ads_budget_usd=float(d.get("profit_ads_budget_usd") or 0.0),
                              status="active")); s.commit()
                flash("Product added","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("products"))

@app.get("/product/<sku>")
def product_view(sku):
    with Session(engine) as s:
        p = s.get(Product, sku)
    return render_template("product.html", product=p, title=p.product_name if p else "Product")
