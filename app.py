from flask import Flask, render_template, request, redirect, url_for, flash, Response
from sqlalchemy import create_engine, func, select, or_
from sqlalchemy.orm import Session
from models import (
    Base, Product, Country, Warehouse, StockMovement, PlatformSpendCurrent,
    Shipment, ShipmentItem, DailyDelivered, PeriodRemit, ProductBudgetCountry,
    FinanceEntry
)
import os, datetime, csv, io, shutil

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY","devkey")
DB_PATH = os.environ.get("DB_PATH","eas_cod.db")
engine = create_engine(f"sqlite:///{DB_PATH}", echo=False, future=True)

def migrate():
    with engine.begin() as conn:
        Base.metadata.create_all(conn)
migrate()

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
    s.commit()

def countries_list(session):
    return [c for c in session.query(Country).all() if c.code!="CN"]

def band_totals(session):
    ctrs = countries_list(session)
    band = {c.country: {"stock":0,"in_transit":0,"ad_spend":0.0} for c in ctrs}
    whs = session.query(Warehouse).filter(Warehouse.active==True).all()
    wh_by_id = {w.id:w for w in whs}
    for sku, in session.query(Product.product_sku).all():
        bal = {}
        for m in session.query(StockMovement).filter(StockMovement.product_sku==sku).all():
            if m.to_wh: bal[m.to_wh]=bal.get(m.to_wh,0)+m.qty
            if m.from_wh: bal[m.from_wh]=bal.get(m.from_wh,0)-m.qty
        for wid,qty in bal.items():
            c = wh_by_id[wid].country
            if c in band: band[c]["stock"]+=qty
    for sh in session.query(Shipment).filter(Shipment.status=="in_transit").all():
        qty = session.execute(select(func.sum(ShipmentItem.qty)).where(ShipmentItem.shipment_id==sh.id)).scalar() or 0
        if sh.to_country in band: band[sh.to_country]["in_transit"]+=qty
    code_to_country = {c.code:c.country for c in session.query(Country).all()}
    for r in session.query(PlatformSpendCurrent).all():
        name = code_to_country.get(r.country_code,r.country_code)
        if name in band: band[name]["ad_spend"]+=(r.amount_usd or 0.0)
    return ctrs, band

def avg_ship_unit_for_route(session, sku, from_country, to_country):
    shipments = session.query(Shipment).filter(
        Shipment.status=="arrived",
        Shipment.from_country==from_country,
        Shipment.to_country==to_country
    ).all()
    total_cost=0.0; total_qty=0
    for sh in shipments:
        qty = session.execute(select(func.sum(ShipmentItem.qty)).where(
            ShipmentItem.shipment_id==sh.id,
            ShipmentItem.product_sku==sku
        )).scalar() or 0
        if qty>0:
            total_cost += (sh.shipping_cost_usd or 0.0)
            total_qty += qty
    return (total_cost/total_qty) if total_qty>0 else 0.0

def parse_period(choice):
    today = datetime.date.today()
    if choice == "10d": start = today - datetime.timedelta(days=10)
    elif choice == "21d": start = today - datetime.timedelta(days=21)
    elif choice == "35d": start = today - datetime.timedelta(days=35)
    elif choice == "60d": start = today - datetime.timedelta(days=60)
    elif choice == "3m": start = today - datetime.timedelta(days=90)
    elif choice == "6m": start = today - datetime.timedelta(days=180)
    elif choice == "1y": start = today - datetime.timedelta(days=365)
    else: start = today - datetime.timedelta(days=30)
    return start.isoformat(), today.isoformat()

def ensure_backups_dir():
    os.makedirs("backups", exist_ok=True)

def backup_db():
    ensure_backups_dir()
    if os.path.exists(DB_PATH):
        today = datetime.date.today().isoformat()
        dst = f"backups/{today}.db"
        if not os.path.exists(dst):
            shutil.copyfile(DB_PATH, dst)

def restore_db(days_ago=1):
    ensure_backups_dir()
    target = (datetime.date.today() - datetime.timedelta(days=days_ago)).isoformat()
    src = f"backups/{target}.db"
    if not os.path.exists(src):
        return False
    shutil.copyfile(src, DB_PATH)
    return True

@app.route("/", methods=["GET","POST"])
def index():
    if request.method == "POST" and request.form.get("q") is not None:
        q = request.form.get("q","").strip()
    else:
        q = request.args.get("q","") or ""
    dfrom = request.args.get("dfrom","")
    dto = request.args.get("dto","")

    with Session(engine) as s:
        counts = {
            "products": s.query(Product).count(),
            "warehouses": s.query(Warehouse).count(),
            "in_transit": s.query(Shipment).filter(Shipment.status=="in_transit").count()
        }
        all_products = s.query(Product).order_by(Product.product_sku).all()
        ctrs, band = band_totals(s)

        cn_ke=[]; inter_items=[]
        for sh in s.query(Shipment).filter(Shipment.status=="in_transit").order_by(Shipment.id.desc()).all():
            items = s.query(ShipmentItem).filter(ShipmentItem.shipment_id==sh.id).all()
            if sh.from_country=="China" and sh.to_country=="Kenya":
                setattr(sh, "items_str", ", ".join([f"{it.product_sku}:{it.qty}" for it in items]))
                cn_ke.append(sh)
            else:
                for it in items:
                    inter_items.append(type("IR",(object,),dict(
                        shipment_id=sh.id, ref=sh.ref, from_country=sh.from_country, to_country=sh.to_country,
                        product_sku=it.product_sku, qty=it.qty, created_date=sh.created_date,
                        shipping_cost_usd=sh.shipping_cost_usd, item_id=it.id
                    ))())

        today = datetime.date.today()
        if not dfrom or not dto:
            dates = [ (today - datetime.timedelta(days=i)).isoformat() for i in range(8) ]
        else:
            start = datetime.date.fromisoformat(dfrom)
            end = datetime.date.fromisoformat(dto)
            span = (end - start).days + 1
            dates = [ (start + datetime.timedelta(days=i)).isoformat() for i in range(max(0,span)) ]
        ctr_codes = [c.code for c in countries_list(s)]
        pivot_rows=[]
        for d in sorted(dates, reverse=True):
            totals = {code:0 for code in ["KE","UG","TZ","ZM","ZW"]}
            for row in s.query(DailyDelivered).filter(DailyDelivered.date==d).all():
                if row.country_code in totals:
                    totals[row.country_code] = row.delivered or 0
            total = sum(totals.values())
            pivot_rows.append(type("DP",(object,),dict(date=d, **totals, total=total))())

    return render_template("index.html",
                           counts=counts, countries=ctrs, band=band,
                           cn_ke=cn_ke, inter_items=inter_items,
                           all_products=all_products, daily_pivot=pivot_rows,
                           dfrom=dfrom, dto=dto, ctr_codes=ctr_codes,
                           title="Dashboard")

@app.get("/export/top-delivered.csv")
def export_top_delivered():
    tp = request.args.get("tp","21d")
    tc = request.args.get("tc","")
    tp_from, tp_to = parse_period(tp)
    out = io.StringIO(); w = csv.writer(out)
    w.writerow(["Country","Product","Orders","Pieces","RevenueUSD","ProfitUSD","ProfitPerPieceUSD"])
    with Session(engine) as s:
        qr = s.query(PeriodRemit).filter(PeriodRemit.start_date>=tp_from, PeriodRemit.end_date<=tp_to)
        if tc: qr = qr.filter(PeriodRemit.country_code==tc)
        agg = {}
        for r in qr.all():
            key = (r.product_sku, r.country_code if tc else "ALL")
            a = agg.get(key, dict(orders=0,pieces=0,rev=0.0,profit=0.0))
            a["orders"] += r.orders or 0
            a["pieces"] += r.pieces or 0
            a["rev"] += r.revenue_usd or 0.0
            a["profit"] += r.profit_total_usd or 0.0
            agg[key]=a
        rows=[]
        for (sku,cc),a in agg.items():
            ppu = (a["profit"]/a["pieces"]) if a["pieces"] else 0.0
            rows.append([cc, sku, a["orders"], a["pieces"], f"{a['rev']:.2f}", f"{a['profit']:.2f}", f"{ppu:.2f}"])
        rows.sort(key=lambda r: (int(r[3]), float(r[4])), reverse=True)
        for r in rows: w.writerow(r)
    resp = Response(out.getvalue(), mimetype="text/csv")
    resp.headers["Content-Disposition"] = "attachment; filename=top-delivered.csv"
    return resp

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
            s.add(PlatformSpendCurrent(
                product_sku=d.get("product_sku"),
                platform=d.get("platform"),
                amount_usd=float(d.get("amount_usd") or 0.0),
                country_code=d.get("country_code")
            ))
            s.commit()
        flash("Ad spend saved","ok")
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
        flash("Shipment created","ok")
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
            if not sh: flash("Shipment not found","error")
            else:
                sh.shipping_cost_usd = cost
                s.commit()
                flash("Shipping cost updated","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("index"))

@app.post("/delete_shipment")
def delete_shipment():
    shipment_id = int(request.form.get("shipment_id"))
    try:
        with Session(engine) as s:
            sh = s.get(Shipment, shipment_id)
            if not sh: flash("Shipment not found","error")
            elif sh.status != "in_transit": flash("Only in_transit shipments can be deleted","error")
            else:
                s.query(ShipmentItem).filter(ShipmentItem.shipment_id==shipment_id).delete()
                s.delete(sh); s.commit()
                flash("Shipment deleted","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("index"))

@app.post("/delete_shipment_item")
def delete_shipment_item():
    item_id = int(request.form.get("shipment_item_id"))
    try:
        with Session(engine) as s:
            it = s.get(ShipmentItem, item_id)
            if not it: flash("Item not found","error")
            else:
                sh = s.get(Shipment, it.shipment_id)
                if sh and sh.status=="in_transit":
                    s.delete(it); s.commit()
                    left = s.query(ShipmentItem).filter(ShipmentItem.shipment_id==sh.id).count()
                    if left == 0:
                        s.delete(sh); s.commit()
                        flash("Item deleted; empty shipment removed","ok")
                    else:
                        flash("Item deleted","ok")
                else:
                    flash("Only items in in_transit shipments can be deleted","error")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("index"))

@app.post("/edit_shipment_item_qty")
def edit_shipment_item_qty():
    item_id = int(request.form.get("shipment_item_id"))
    qty = int(request.form.get("qty") or 0)
    try:
        with Session(engine) as s:
            it = s.get(ShipmentItem, item_id)
            if not it: flash("Item not found","error")
            else:
                sh = s.get(Shipment, it.shipment_id)
                if sh and sh.status=="in_transit":
                    it.qty = qty; s.commit(); flash("Quantity updated","ok")
                else:
                    flash("Only items in in_transit shipments can be edited","error")
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
                flash("Product not found","error"); return redirect(url_for("performance"))
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
        backup_db()
        flash("Remittance saved + stock deducted + profit computed","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("performance"))

@app.get("/products")
def products():
    with Session(engine) as s:
        prods = s.query(Product).order_by(Product.product_sku).all()
        budgets = s.query(ProductBudgetCountry).all()
        mapb={}
        for b in budgets:
            mapb.setdefault(b.product_sku, {})[b.country_code]=b.budget_usd
    return render_template("products.html", products=prods, budgets=mapb, title="Products")

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
                for cc in [c.code for c in countries_list(s)]:
                    s.add(ProductBudgetCountry(product_sku=d.get("product_sku"), country_code=cc, budget_usd=0.0))
                s.commit()
                flash("Product added","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("products"))

@app.post("/products/delete")
def delete_product():
    sku = request.form.get("product_sku")
    if not sku:
        flash("Missing SKU","error"); return redirect(url_for("products"))
    try:
        with Session(engine) as s:
            s.query(PlatformSpendCurrent).filter_by(product_sku=sku).delete()
            s.query(PeriodRemit).filter_by(product_sku=sku).delete()
            s.query(ShipmentItem).filter_by(product_sku=sku).delete()
            s.query(StockMovement).filter_by(product_sku=sku).delete()
            s.query(ProductBudgetCountry).filter_by(product_sku=sku).delete()
            empty = s.query(Shipment).all()
            for sh in empty:
                cnt = s.query(ShipmentItem).filter_by(shipment_id=sh.id).count()
                if cnt==0 and sh.status=="in_transit":
                    s.delete(sh)
            p = s.get(Product, sku)
            if p: s.delete(p)
            s.commit()
        flash("Product deleted","ok")
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
        spend_by_country = {}
        for row in cur:
            spend_by_country.setdefault(row.country_code, []).append(row)
        shipments = []
        for sh in s.query(Shipment).all():
            qty_sum = s.execute(select(func.sum(ShipmentItem.qty)).where(ShipmentItem.shipment_id==sh.id, ShipmentItem.product_sku==sku)).scalar() or 0
            if qty_sum>0:
                setattr(sh, "qty_sum", qty_sum)
                setattr(sh, "items", s.query(ShipmentItem).filter(ShipmentItem.shipment_id==sh.id, ShipmentItem.product_sku==sku).all())
                shipments.append(sh)
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
        budgets = s.query(ProductBudgetCountry).filter_by(product_sku=sku).all()
    return render_template("product.html", product=p, spend_by_country=spend_by_country,
                           shipments=shipments, stock_rows=stock_rows, stock_total=stock_total,
                           profit_rows=profit_rows, profit_totals=profit_totals, budgets=budgets,
                           title=p.product_name if p else "Product")

@app.get("/performance")
def performance():
    tp = request.args.get("tp","21d")
    tc = request.args.get("tc","")
    tp_from, tp_to = parse_period(tp)
    with Session(engine) as s:
        ctr_codes = [c.code for c in countries_list(s)]
        all_products = s.query(Product).order_by(Product.product_sku).all()

        qr = s.query(PeriodRemit).filter(PeriodRemit.start_date>=tp_from, PeriodRemit.end_date<=tp_to)
        if tc: qr = qr.filter(PeriodRemit.country_code==tc)
        agg={}
        for r in qr.all():
            key=(r.product_sku, r.country_code if tc else "ALL")
            x=agg.get(key, dict(orders=0,pieces=0,rev=0.0,profit=0.0))
            x["orders"]+=r.orders or 0; x["pieces"]+=r.pieces or 0
            x["rev"]+=r.revenue_usd or 0.0; x["profit"]+=r.profit_total_usd or 0.0
            agg[key]=x
        top_report=[]
        for (sku,cc),v in agg.items():
            ppu=(v["profit"]/v["pieces"]) if v["pieces"] else 0.0
            top_report.append(type("TR",(object,),dict(
                country_code=cc, product_sku=sku, orders=v["orders"],
                pieces=v["pieces"], revenue_usd=v["rev"], profit_total_usd=v["profit"],
                profit_per_piece_usd=ppu
            ))())
        top_report.sort(key=lambda r:(r.pieces, r.revenue_usd), reverse=True)

        remit = s.query(PeriodRemit).filter(PeriodRemit.start_date>=tp_from, PeriodRemit.end_date<=tp_to)
        if tc: remit = remit.filter(PeriodRemit.country_code==tc)
        remit = remit.order_by(PeriodRemit.country_code, PeriodRemit.profit_total_usd.desc()).all()

    return render_template("performance.html", tp=tp, tc=tc, top_report=top_report,
                           remit_report=remit, ctr_codes=ctr_codes, all_products=all_products,
                           title="Performance")

@app.get("/finance")
def finance():
    month = request.args.get("m","")
    cat = request.args.get("c",""); q = request.args.get("q","")
    with Session(engine) as s:
        qry = s.query(FinanceEntry)
        if month:
            y,mn = month.split("-")
            start = f"{y}-{mn}-01"
            end = str((datetime.date(int(y), int(mn), 1) + datetime.timedelta(days=32)).replace(day=1))
            qry = qry.filter(FinanceEntry.date>=start, FinanceEntry.date<end)
        if cat: qry = qry.filter(FinanceEntry.category==cat)
        if q: qry = qry.filter(FinanceEntry.description.contains(q))
        items = qry.order_by(FinanceEntry.date.desc(), FinanceEntry.id.desc()).all()
        month_sum = {}
        for it in items:
            key = it.date[:7]
            x = month_sum.get(key, dict(credit=0.0,debit=0.0))
            if it.type=="credit": x["credit"] += it.amount_usd
            else: x["debit"] += it.amount_usd
            month_sum[key]=x
        months = sorted(month_sum.keys(), reverse=True)
        bal = sum([(it.amount_usd if it.type=="credit" else -it.amount_usd) for it in items])
    return render_template("finance.html", items=items, balance=bal, months=months, month_sum=month_sum,
                           sel_month=month, sel_cat=cat, q=q, title="Finance")

@app.post("/finance/add")
def finance_add():
    d = request.form
    try:
        with Session(engine) as s:
            s.add(FinanceEntry(
                date=d.get("date"),
                type=d.get("type"),
                category=d.get("category"),
                description=d.get("description"),
                amount_usd=float(d.get("amount_usd") or 0.0)
            )); s.commit()
        backup_db()
        flash("Finance entry saved","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("finance"))

@app.get("/settings")
def settings():
    with Session(engine) as s:
        ctrs = s.query(Country).order_by(Country.code).all()
        prods = s.query(Product).order_by(Product.product_sku).all()
        budgets = s.query(ProductBudgetCountry).all()
        mapb={}
        for b in budgets: mapb.setdefault(b.product_sku, {})[b.country_code]=b.budget_usd
    return render_template("settings.html", countries=ctrs, products=prods, budgets=mapb, title="Settings")

@app.post("/settings/add-country")
def add_country():
    d = request.form
    try:
        name = d.get("country"); code = d.get("code"); currency = d.get("currency"); fx = float(d.get("fx_to_usd") or 1.0)
        with Session(engine) as s:
            if s.query(Country).filter(or_(Country.code==code, Country.country==name)).first():
                flash("Country exists","error"); return redirect(url_for("settings"))
            s.add(Country(country=name, code=code, currency=currency, fx_to_usd=fx))
            s.add(Warehouse(name=f"{name} Hub", country=name, code=code, active=True))
            for p in s.query(Product).all():
                s.add(ProductBudgetCountry(product_sku=p.product_sku, country_code=code, budget_usd=0.0))
            s.commit()
        backup_db()
        flash("Country added","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("settings"))

@app.post("/settings/delete-country")
def delete_country():
    code = request.form.get("code")
    if code in ("CN","KE","TZ","UG","ZM","ZW"):
        flash("Default countries cannot be deleted","error"); return redirect(url_for("settings"))
    try:
        with Session(engine) as s:
            w = s.query(Warehouse).filter(Warehouse.code==code).first()
            if w: s.delete(w)
            s.query(ProductBudgetCountry).filter_by(country_code=code).delete()
            c = s.query(Country).filter_by(code=code).first()
            if c: s.delete(c)
            s.commit()
        backup_db()
        flash("Country deleted","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("settings"))

@app.post("/settings/edit-country")
def edit_country():
    d = request.form
    code = d.get("code")
    try:
        with Session(engine) as s:
            c = s.query(Country).filter_by(code=code).first()
            if not c: flash("Country not found","error")
            else:
                c.country = d.get("country") or c.country
                c.currency = d.get("currency") or c.currency
                c.fx_to_usd = float(d.get("fx_to_usd") or c.fx_to_usd)
                s.commit(); backup_db(); flash("Country updated","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("settings"))

@app.post("/settings/edit-product")
def edit_product():
    d = request.form
    sku = d.get("product_sku")
    try:
        with Session(engine) as s:
            p = s.get(Product, sku)
            if not p: flash("Product not found","error")
            else:
                p.product_name = d.get("product_name") or p.product_name
                p.cost_cn_usd = float(d.get("cost_cn_usd") or p.cost_cn_usd)
                p.default_cnke_ship_usd = float(d.get("default_cnke_ship_usd") or p.default_cnke_ship_usd)
                s.commit()
            for cc in [c.code for c in countries_list(s)]:
                key = f"budget_{cc}"
                if key in d:
                    row = s.query(ProductBudgetCountry).filter_by(product_sku=sku, country_code=cc).first()
                    if row: row.budget_usd = float(d.get(key) or 0.0)
                    else: s.add(ProductBudgetCountry(product_sku=sku, country_code=cc, budget_usd=float(d.get(key) or 0.0)))
            s.commit(); backup_db(); flash("Product updated","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("settings"))

@app.post("/settings/restore")
def restore():
    which = request.form.get("which","yesterday")
    days = 1 if which=="yesterday" else 2
    ok = restore_db(days_ago=days)
    flash("Restored" if ok else "No snapshot found for that day","ok" if ok else "error")
    return redirect(url_for("settings"))

if __name__ == "__main__":
    app.run(debug=True)
