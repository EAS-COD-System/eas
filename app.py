
from flask import Flask, render_template, request, redirect, url_for, flash
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session
from models import Base, Product, Country, Warehouse, StockMovement, PlatformSpendCurrent, Shipment, ShipmentItem, DailyDelivered, PeriodRemit
import os, datetime

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY","devkey")
DB_PATH = os.environ.get("DB_PATH","eas_cod.db")
engine = create_engine(f"sqlite:///{DB_PATH}", echo=False, future=True)

def migrate():
    with engine.begin() as conn:
        Base.metadata.create_all(conn)
migrate()

# Bootstrap demo data for specified countries
with Session(engine) as s:
    if not s.query(Country).count():
        s.add_all([
            Country(country="Kenya", code="KE", currency="USD", fx_to_usd=1.0),
            Country(country="Tanzania", code="TZ", currency="USD", fx_to_usd=1.0),
            Country(country="Uganda", code="UG", currency="USD", fx_to_usd=1.0),
            Country(country="Zambia", code="ZM", currency="USD", fx_to_usd=1.0),
            Country(country="Zimbabwe", code="ZW", currency="USD", fx_to_usd=1.0),
            Country(country="China", code="CN", currency="USD", fx_to_usd=1.0),
        ])
    if not s.query(Warehouse).count():
        s.add_all([
            Warehouse(name="China Hub", country="China", code="CN", active=True),
            Warehouse(name="Nairobi Main", country="Kenya", code="KE", active=True),
            Warehouse(name="Dar Hub", country="Tanzania", code="TZ", active=True),
            Warehouse(name="Kampala Hub", country="Uganda", code="UG", active=True),
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

def band_totals(session):
    ctrs = countries_list(session)
    band = {c.country: {"stock":0,"in_transit":0,"ad_spend":0.0} for c in ctrs}
    whs = session.query(Warehouse).filter(Warehouse.active==True).all()
    wh_by_id = {w.id:w for w in whs}
    # stock balances from movements
    for sku, in session.query(Product.product_sku).all():
        bal = {}
        for m in session.query(StockMovement).filter(StockMovement.product_sku==sku).all():
            if m.to_wh: bal[m.to_wh]=bal.get(m.to_wh,0)+m.qty
            if m.from_wh: bal[m.from_wh]=bal.get(m.from_wh,0)-m.qty
        for wid,qty in bal.items():
            c = wh_by_id[wid].country
            if c in band: band[c]["stock"]+=qty
    # in transit
    for sh in session.query(Shipment).filter(Shipment.status=="in_transit").all():
        qty = session.execute(select(func.sum(ShipmentItem.qty)).where(ShipmentItem.shipment_id==sh.id)).scalar() or 0
        if sh.to_country in band: band[sh.to_country]["in_transit"]+=qty
    # daily ad spend (current)
    code_to_country = {c.code:c.country for c in session.query(Country).all()}
    for r in session.query(PlatformSpendCurrent).all():
        name = code_to_country.get(r.country_code,r.country_code)
        if name in band: band[name]["ad_spend"]+=(r.amount_usd or 0.0)
    return ctrs, band

def avg_ship_unit_for_route(session, sku, from_country, to_country):
    shipments = session.query(Shipment).filter(Shipment.status=="arrived", Shipment.from_country==from_country, Shipment.to_country==to_country).all()
    total_cost=0.0; total_qty=0
    for sh in shipments:
        qty = session.execute(select(func.sum(ShipmentItem.qty)).where(ShipmentItem.shipment_id==sh.id, ShipmentItem.product_sku==sku)).scalar() or 0
        if qty>0:
            total_cost += (sh.shipping_cost_usd or 0.0)
            total_qty += qty
    return (total_cost/total_qty) if total_qty>0 else 0.0

@app.route("/", methods=["GET","POST"])
def index():
    q = request.form.get("q","").strip() if request.method=="POST" else request.args.get("q","") or ""
    daily_from = request.args.get("from","")
    daily_to = request.args.get("to","")
    remit_from = request.args.get("rs","")
    remit_to = request.args.get("re","")
    remit_country = request.args.get("rc","")

    with Session(engine) as s:
        counts = {
            "products": s.query(Product).count(),
            "warehouses": s.query(Warehouse).count(),
            "in_transit": s.query(Shipment).filter(Shipment.status=="in_transit").count()
        }
        all_products = s.query(Product).order_by(Product.product_sku).all()
        ctrs, band = band_totals(s)

        # split shipments
        cn_ke=[]; inter=[]
        for sh in s.query(Shipment).filter(Shipment.status=="in_transit").all():
            items = s.query(ShipmentItem).filter(ShipmentItem.shipment_id==sh.id).all()
            setattr(sh, "items_str", ", ".join([f"{it.product_sku}:{it.qty}" for it in items]))
            if sh.from_country=="China" and sh.to_country=="Kenya": cn_ke.append(sh)
            else: inter.append(sh)

        # daily delivered
        qd = s.query(DailyDelivered)
        if daily_from: qd = qd.filter(DailyDelivered.date>=daily_from)
        if daily_to: qd = qd.filter(DailyDelivered.date<=daily_to)
        daily_rows = qd.order_by(DailyDelivered.date.desc()).limit(50).all()
        daily_total = sum([r.delivered or 0 for r in daily_rows])

        # remittance report
        remit_report = []
        if remit_from and remit_to:
            qr = s.query(PeriodRemit).filter(PeriodRemit.start_date>=remit_from, PeriodRemit.end_date<=remit_to)
            if remit_country:
                qr = qr.filter(PeriodRemit.country_code==remit_country)
            remit_report = qr.order_by(PeriodRemit.country_code, PeriodRemit.profit_total_usd.desc()).all()

    return render_template("index.html", counts=counts, countries=ctrs, band=band,
                           cn_ke=cn_ke, inter=inter,
                           all_products=all_products,
                           daily_rows=daily_rows if 'daily_rows' in locals() else [],
                           daily_total=daily_total if 'daily_total' in locals() else 0,
                           daily_from=daily_from, daily_to=daily_to,
                           remit_report=remit_report if 'remit_report' in locals() else [],
                           remit_from=remit_from, remit_to=remit_to,
                           q=q, title="Dashboard")

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

@app.post("/create_transfer_home")
def create_transfer_home():
    d = request.form
    try:
        with Session(engine) as s:
            code_to_country = {c.code:c.country for c in s.query(Country).all()}
            from_c = code_to_country.get(d.get("from_code"), d.get("from_code"))
            to_c = code_to_country.get(d.get("to_code"), d.get("to_code"))
            sh = Shipment(ref=d.get("ref"), from_country=from_c, to_country=to_c,
                          status="in_transit", created_date=str(datetime.date.today()),
                          shipping_cost_usd=float(d.get("shipping_cost_usd") or 0.0))
            s.add(sh); s.flush()
            s.add(ShipmentItem(shipment_id=sh.id, product_sku=d.get("product_sku"), qty=int(d.get("qty") or 0)))
            s.commit()
        flash("Shipment created (in transit)","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    refsku = d.get("product_sku")
    return redirect(url_for("product_view", sku=refsku)) if refsku else redirect(url_for("index"))

@app.post("/update_shipment_cost")
def update_shipment_cost():
    shipment_id = int(request.form.get("shipment_id"))
    cost = float(request.form.get("shipping_cost_usd") or 0.0)
    try:
        with Session(engine) as s:
            sh = s.get(Shipment, shipment_id)
            if not sh:
                flash("Shipment not found","error")
            else:
                sh.shipping_cost_usd = cost
                s.commit()
                flash("Shipping cost updated","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("index"))

@app.post("/mark_arrived")
def mark_arrived():
    shipment_id = int(request.form.get("shipment_id"))
    try:
        with Session(engine) as s:
            sh = s.get(Shipment, shipment_id)
            if not sh:
                flash("Shipment not found","error"); return redirect(url_for("index"))
            sh.status = "arrived"
            sh.arrived_date = str(datetime.date.today())
            try:
                if sh.created_date and sh.arrived_date:
                    d0 = datetime.date.fromisoformat(sh.created_date)
                    d1 = datetime.date.fromisoformat(sh.arrived_date)
                    sh.transit_days = (d1 - d0).days
            except Exception:
                sh.transit_days = 0
            wh_from = s.query(Warehouse).filter(Warehouse.country==sh.from_country, Warehouse.active==True).first()
            wh_to = s.query(Warehouse).filter(Warehouse.country==sh.to_country, Warehouse.active==True).first()
            items = s.query(ShipmentItem).filter(ShipmentItem.shipment_id==shipment_id).all()
            for it in items:
                s.add(StockMovement(date=sh.arrived_date, product_sku=it.product_sku,
                                    from_wh=wh_from.id if wh_from else None, to_wh=wh_to.id if wh_to else None,
                                    qty=it.qty, ref=f"ARR-{sh.ref}"))
            s.commit()
            flash("Marked arrived; stock moved; transit days set","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("index"))

@app.post("/add_daily_delivered")
def add_daily_delivered():
    d = request.form
    try:
        date = d.get("date"); code = d.get("country_code"); delivered = int(d.get("delivered") or 0)
        with Session(engine) as s:
            row = s.query(DailyDelivered).filter(DailyDelivered.date==date, DailyDelivered.country_code==code).first()
            if row: row.delivered = delivered
            else: s.add(DailyDelivered(date=date, country_code=code, delivered=delivered))
            s.commit()
        flash("Daily delivered saved","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("index"))

@app.post("/upsert_period_remit")
def upsert_period_remit():
    d = request.form
    try:
        start_date = d.get("start_date"); end_date = d.get("end_date")
        code = d.get("country_code"); sku = d.get("product_sku")
        orders = int(d.get("orders") or 0); pieces = int(d.get("pieces") or 0)
        rev = float(d.get("revenue_usd") or 0.0); ad = float(d.get("ad_usd") or 0.0)
        override = d.get("override_ship_unit")

        with Session(engine) as s:
            p = s.get(Product, sku)
            if not p:
                flash("Product not found","error"); return redirect(url_for("index"))
            cn_cost = p.cost_cn_usd or 0.0
            cnke_unit = p.default_cnke_ship_usd or 0.0
            code_to_country = {c.code:c.country for c in s.query(Country).all()}
            dest_country = code_to_country.get(code, code)
            route_unit = float(override) if override else avg_ship_unit_for_route(s, sku, "Kenya", dest_country)
            cost_unit = cn_cost + cnke_unit + (route_unit or 0.0)

            profit_total = rev - ad - cost_unit*pieces
            profit_per_piece = (profit_total/pieces) if pieces>0 else 0.0

            row = s.query(PeriodRemit).filter(
                PeriodRemit.start_date==start_date,
                PeriodRemit.end_date==end_date,
                PeriodRemit.country_code==code,
                PeriodRemit.product_sku==sku
            ).first()
            if row:
                row.orders=orders; row.pieces=pieces; row.revenue_usd=rev; row.ad_usd=ad
                row.cost_unit_usd=cost_unit; row.profit_total_usd=profit_total; row.profit_per_piece_usd=profit_per_piece
            else:
                s.add(PeriodRemit(start_date=start_date, end_date=end_date, country_code=code, product_sku=sku,
                                  orders=orders, pieces=pieces, revenue_usd=rev, ad_usd=ad,
                                  cost_unit_usd=cost_unit, profit_total_usd=profit_total, profit_per_piece_usd=profit_per_piece))
            wh = s.query(Warehouse).filter(Warehouse.code==code, Warehouse.active==True).first()
            if wh and pieces>0:
                s.add(StockMovement(date=end_date, product_sku=sku, from_wh=wh.id, to_wh=None, qty=pieces, ref=f"REMIT-{code}-{start_date}-{end_date}"))
            s.commit()
        flash("Remittance saved + stock deducted + profit computed","ok")
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
        if not p:
            flash("Product not found","error"); return redirect(url_for("products"))
        cur = s.query(PlatformSpendCurrent).filter(PlatformSpendCurrent.product_sku==sku).all()
        shipments = []
        for sh in s.query(Shipment).all():
            qty_sum = s.execute(select(func.sum(ShipmentItem.qty)).where(ShipmentItem.shipment_id==sh.id, ShipmentItem.product_sku==sku)).scalar() or 0
            if qty_sum>0:
                setattr(sh, "qty_sum", qty_sum); shipments.append(sh)
        whs = s.query(Warehouse).filter(Warehouse.active==True).all()
        bal = {}
        for m in s.query(StockMovement).filter(StockMovement.product_sku==sku).all():
            if m.to_wh: bal[m.to_wh]=bal.get(m.to_wh,0)+m.qty
            if m.from_wh: bal[m.from_wh]=bal.get(m.from_wh,0)-m.qty
        stock_rows=[]; stock_total=0
        for w in whs:
            if w.code=="CN": continue
            qty = bal.get(w.id,0)
            stock_rows.append(type("SR",(object,),dict(country=w.country, qty=qty))())
            stock_total += qty
        prof_map = {}
        for r in s.query(PeriodRemit).filter(PeriodRemit.product_sku==sku).all():
            x = prof_map.get(r.country_code, dict(pieces=0,revenue_usd=0.0,ad_usd=0.0,profit_total_usd=0.0))
            x["pieces"] += (r.pieces or 0)
            x["revenue_usd"] += (r.revenue_usd or 0.0)
            x["ad_usd"] += (r.ad_usd or 0.0)
            x["profit_total_usd"] += (r.profit_total_usd or 0.0)
            prof_map[r.country_code]=x
        profit_rows=[]; totals=dict(pieces=0,revenue_usd=0.0,ad_usd=0.0,profit_total_usd=0.0)
        for code,x in prof_map.items():
            ppu = (x["profit_total_usd"]/x["pieces"]) if x["pieces"] else 0.0
            profit_rows.append(type("PR",(object,),dict(country_code=code, pieces=x["pieces"], revenue_usd=x["revenue_usd"], ad_usd=x["ad_usd"], profit_total_usd=x["profit_total_usd"], profit_per_piece_usd=ppu))())
            totals["pieces"]+=x["pieces"]; totals["revenue_usd"]+=x["revenue_usd"]; totals["ad_usd"]+=x["ad_usd"]; totals["profit_total_usd"]+=x["profit_total_usd"]
        profit_totals = type("TOT",(object,),totals)()
    return render_template("product.html", product=p, current_spend=cur, shipments=shipments,
                           stock_rows=stock_rows, stock_total=stock_total,
                           profit_rows=profit_rows, profit_totals=profit_totals,
                           title=p.product_name if p else "Product")

if __name__ == '__main__':
    app.run(debug=True)
