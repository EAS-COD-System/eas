from flask import Flask, render_template, request, redirect, url_for, flash
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session
from models import Base, Product, Country, Warehouse, StockMovement, PlatformSpendCurrent, Shipment, ShipmentItem, WeeklyCountryPerf, WeeklyProductPerf, WeeklyRemit
import os, datetime

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY","devkey")
DB_PATH = os.environ.get("DB_PATH","eas_cod.db")
engine = create_engine(f"sqlite:///{DB_PATH}", echo=False, future=True)

def migrate():
    with engine.begin() as conn:
        Base.metadata.create_all(conn)
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
            Product(product_sku="TK1-FOOT", product_name="EMS Foot Massager", category="Wellness", weight_g=720, cost_cn_usd=8.20, default_cnke_ship_usd=1.20, status="active"),
            Product(product_sku="GLS-TRIM", product_name="Dermave Trimmer", category="Beauty", weight_g=180, cost_cn_usd=3.10, default_cnke_ship_usd=0.70, status="active"),
        ])
    s.commit()

def countries_list(session):
    return [c for c in session.query(Country).all() if c.code!="CN"]

def monday_of(date_str=None):
    d = datetime.date.today() if not date_str else datetime.date.fromisoformat(date_str)
    return (d - datetime.timedelta(days=d.weekday()))

def band_totals(session):
    ctrs = countries_list(session)
    band = {c.country: {"stock":0,"in_transit":0,"ad_spend":0.0} for c in ctrs}
    whs = session.query(Warehouse).filter(Warehouse.active==True).all()
    wh_by_id = {w.id:w for w in whs}
    # stock from movements
    for sku, in session.query(Product.product_sku).all():
        bal = {}
        for m in session.query(StockMovement).filter(StockMovement.product_sku==sku).all():
            if m.to_wh: bal[m.to_wh]=bal.get(m.to_wh,0)+m.qty
            if m.from_wh: bal[m.from_wh]=bal.get(m.from_wh,0)-m.qty
        for wid,qty in bal.items():
            c = wh_by_id[wid].country
            if c in band: band[c]["stock"]+=qty
    # in-transit
    for sh in session.query(Shipment).filter(Shipment.status=="in_transit").all():
        qty = session.execute(select(func.sum(ShipmentItem.qty)).where(ShipmentItem.shipment_id==sh.id)).scalar() or 0
        if sh.to_country in band: band[sh.to_country]["in_transit"]+=qty
    # daily ad spend
    code_to_country = {c.code:c.country for c in session.query(Country).all()}
    for r in session.query(PlatformSpendCurrent).all():
        name = code_to_country.get(r.country_code,r.country_code)
        if name in band: band[name]["ad_spend"]+=(r.amount_usd or 0.0)
    return ctrs, band

@app.route("/", methods=["GET","POST"])
def index():
    q = request.form.get("q","").strip() if request.method=="POST" else request.args.get("q","") or ""
    with Session(engine) as s:
        counts = {
            "products": s.query(Product).count(),
            "warehouses": s.query(Warehouse).count(),
            "in_transit": s.query(Shipment).filter(Shipment.status=="in_transit").count()
        }
        all_products = s.query(Product).order_by(Product.product_sku).all()
        ctrs, band = band_totals(s)
        # shipments split
        cn_ke=[]; inter=[]
        for sh in s.query(Shipment).filter(Shipment.status=="in_transit").all():
            items = s.query(ShipmentItem).filter(ShipmentItem.shipment_id==sh.id).all()
            sh.items_str = ", ".join([f"{it.product_sku}:{it.qty}" for it in items])
            sh.first_sku = items[0].product_sku if items else ""
            if sh.from_country=="China" and sh.to_country=="Kenya": cn_ke.append(sh)
            else: inter.append(sh)
        # daily table preload default: current week, KE
        week_monday = monday_of().isoformat()
        daily = type("DT",(object,),dict(mon=0,tue=0,wed=0,thu=0,fri=0,sat=0,sun=0))()
        row = s.query(WeeklyCountryPerf).filter(WeeklyCountryPerf.week_start==week_monday, WeeklyCountryPerf.country_code=="KE").first()
        if row:
            daily.mon=row.mon; daily.tue=row.tue; daily.wed=row.wed; daily.thu=row.thu; daily.fri=row.fri; daily.sat=row.sat; daily.sun=row.sun
        remit_rows = s.query(WeeklyRemit).order_by(WeeklyRemit.week_start.desc()).limit(50).all()
    return render_template("index.html", counts=counts, countries=ctrs, band=band, cn_ke=cn_ke, inter=inter,
                           all_products=all_products, daily=daily, week_monday=week_monday, remit_rows=remit_rows,
                           q=q, title="Dashboard")

# Ad spend upsert (replace previous for same product+platform+country)
@app.post("/upsert_current_spend")
def upsert_current_spend():
    d = request.form
    try:
        with Session(engine) as s:
            s.query(PlatformSpendCurrent).filter(
                PlatformSpendCurrent.product_sku==d.get("product_sku"),
                PlatformSpendCurrent.platform==d.get("platform"),
                PlatformSpendCurrent.country_code==d.get("country_code")
            ).delete()
            s.add(PlatformSpendCurrent(product_sku=d.get("product_sku"), platform=d.get("platform"),
                                       amount_usd=float(d.get("amount_usd") or 0.0),
                                       country_code=d.get("country_code"))); s.commit()
        flash("Ad spend saved (replaced previous)","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    ref = request.form.get("product_sku")
    return redirect(url_for("product_view", sku=ref)) if ref else redirect(url_for("index"))

@app.post("/delete_current_spend")
def delete_current_spend():
    id = int(request.form.get("id")); sku = request.form.get("product_sku")
    with Session(engine) as s:
        s.query(PlatformSpendCurrent).filter(PlatformSpendCurrent.id==id).delete(); s.commit()
    flash("Deleted","ok")
    return redirect(url_for("product_view", sku=sku)) if sku else redirect(url_for("index"))

# Create transfer
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
    refsku = request.form.get("product_sku")
    return redirect(url_for("product_view", sku=refsku)) if refsku else redirect(url_for("index"))

# Mark arrived (compute transit days and move stock)
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

# Daily delivered table save
@app.post("/save_daily_table")
def save_daily_table():
    d = request.form
    try:
        with Session(engine) as s:
            wk = d.get("week_start"); code = d.get("country_code")
            fields = {k:int(d.get(k) or 0) for k in ["mon","tue","wed","thu","fri","sat","sun"]}
            row = s.query(WeeklyCountryPerf).filter(WeeklyCountryPerf.week_start==wk, WeeklyCountryPerf.country_code==code).first()
            if row:
                for k,v in fields.items(): setattr(row,k,v)
            else:
                s.add(WeeklyCountryPerf(week_start=wk, country_code=code, **fields))
            s.commit()
        flash("Saved daily performance table","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("index"))

# Weekly product perf (compat) and stock deduction
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
            # deduct stock
            wh = s.query(Warehouse).filter(Warehouse.code==code, Warehouse.active==True).first()
            if wh and dq>0:
                s.add(StockMovement(date=wk, product_sku=sku, from_wh=wh.id, to_wh=None, qty=dq, ref=f"WEEKLY-{code}-{wk}"))
            s.commit()
        flash("Saved weekly product entry + stock deducted","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    ref = request.form.get("product_sku")
    return redirect(url_for("product_view", sku=ref)) if ref else redirect(url_for("index"))

@app.post("/delete_weekly_product")
def delete_weekly_product():
    id = int(request.form.get("id")); sku = request.form.get("product_sku")
    with Session(engine) as s:
        s.query(WeeklyProductPerf).filter(WeeklyProductPerf.id==id).delete(); s.commit()
    flash("Deleted","ok")
    return redirect(url_for("product_view", sku=sku)) if sku else redirect(url_for("index"))

# Helper: average route ship /piece from arrived shipments
def avg_ship_unit_for_route(session, sku, from_country, to_country):
    shipments = session.query(Shipment).filter(Shipment.status=="arrived", Shipment.from_country==from_country, Shipment.to_country==to_country).all()
    total_cost=0.0; total_qty=0
    for sh in shipments:
        qty = session.execute(select(func.sum(ShipmentItem.qty)).where(ShipmentItem.shipment_id==sh.id, ShipmentItem.product_sku==sku)).scalar() or 0
        if qty>0:
            total_cost += (sh.shipping_cost_usd or 0.0)
            total_qty += qty
    return (total_cost/total_qty) if total_qty>0 else 0.0

# Weekly remittance save (also deducts stock and updates WeeklyProductPerf)
@app.post("/upsert_weekly_remit")
def upsert_weekly_remit():
    d = request.form
    try:
        wk = d.get("week_start"); from_code = d.get("from_code"); to_code = d.get("to_code"); sku = d.get("product_sku")
        orders = int(d.get("orders") or 0); pieces = int(d.get("pieces") or 0)
        rev = float(d.get("revenue_usd") or 0.0); ad = float(d.get("ad_usd") or 0.0)
        override = d.get("override_ship_unit")
        with Session(engine) as s:
            p = s.get(Product, sku)
            cn_cost = p.cost_cn_usd or 0.0
            cnke_unit = p.default_cnke_ship_usd or 0.0
            code_to_country = {c.code:c.country for c in s.query(Country).all()}
            from_country = code_to_country.get(from_code, from_code); to_country = code_to_country.get(to_code, to_code)
            route_unit = float(override) if override else avg_ship_unit_for_route(s, sku, from_country, to_country)
            cost_unit = cn_cost + cnke_unit + (route_unit or 0.0)
            profit_total = rev - ad - cost_unit*pieces
            profit_per_piece = (profit_total/pieces) if pieces>0 else 0.0
            row = s.query(WeeklyRemit).filter(WeeklyRemit.week_start==wk, WeeklyRemit.from_code==from_code, WeeklyRemit.to_code==to_code, WeeklyRemit.product_sku==sku).first()
            if row:
                row.orders=orders; row.pieces=pieces; row.revenue_usd=rev; row.ad_usd=ad; row.cost_unit_usd=cost_unit; row.profit_total_usd=profit_total; row.profit_per_piece_usd=profit_per_piece
            else:
                s.add(WeeklyRemit(week_start=wk, from_code=from_code, to_code=to_code, product_sku=sku, orders=orders, pieces=pieces,
                                  revenue_usd=rev, ad_usd=ad, cost_unit_usd=cost_unit, profit_total_usd=profit_total, profit_per_piece_usd=profit_per_piece))
            # reflect into product snapshot
            wp = s.query(WeeklyProductPerf).filter(WeeklyProductPerf.week_start==wk, WeeklyProductPerf.country_code==to_code, WeeklyProductPerf.product_sku==sku).first()
            if wp:
                wp.delivered_qty = pieces; wp.revenue_usd = rev; wp.ad_spend_usd = ad
            else:
                s.add(WeeklyProductPerf(week_start=wk, country_code=to_code, product_sku=sku, delivered_qty=pieces, revenue_usd=rev, ad_spend_usd=ad))
            # deduct stock from destination
            wh = s.query(Warehouse).filter(Warehouse.code==to_code, Warehouse.active==True).first()
            if wh and pieces>0:
                s.add(StockMovement(date=wk, product_sku=sku, from_wh=wh.id, to_wh=None, qty=pieces, ref=f"REMIT-{to_code}-{wk}"))
            s.commit()
        flash("Weekly remittance saved + stock deducted + profit computed","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("index"))

@app.post("/delete_weekly_remit")
def delete_weekly_remit():
    with Session(engine) as s:
        s.query(WeeklyRemit).filter(WeeklyRemit.id==int(request.form.get("id"))).delete(); s.commit()
    flash("Deleted","ok")
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
        cur = s.query(PlatformSpendCurrent).filter(PlatformSpendCurrent.product_sku==sku).all()
        shipments = []
        for sh in s.query(Shipment).all():
            qty_sum = s.execute(select(func.sum(ShipmentItem.qty)).where(ShipmentItem.shipment_id==sh.id, ShipmentItem.product_sku==sku)).scalar() or 0
            if qty_sum>0:
                sh.qty_sum = qty_sum; shipments.append(sh)
        wprod_rows = s.query(WeeklyProductPerf).filter(WeeklyProductPerf.product_sku==sku).order_by(WeeklyProductPerf.week_start.desc()).all()
    return render_template("product.html", product=p, current_spend=cur, shipments=shipments, wprod_rows=wprod_rows, title=p.product_name if p else "Product")
