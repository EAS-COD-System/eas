from flask import Flask, render_template, request, redirect, url_for, flash, Response
from sqlalchemy import create_engine, func, select, or_, desc
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

# ---------- bootstrap ----------
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

# ---------- helpers ----------
def ensure_backups_dir():
    os.makedirs("backups", exist_ok=True)

def backup_db():
    ensure_backups_dir()
    if os.path.exists(DB_PATH):
        ts = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M")
        shutil.copyfile(DB_PATH, f"backups/{ts}.db")

def restore_db_by_choice(choice:str):
    now = datetime.datetime.now()
    delta = {"5m":datetime.timedelta(minutes=5),
             "30m":datetime.timedelta(minutes=30),
             "1h":datetime.timedelta(hours=1),
             "1d":datetime.timedelta(days=1),
             "2d":datetime.timedelta(days=2),
             "4d":datetime.timedelta(days=4)}.get(choice, datetime.timedelta(days=1))
    target = now - delta
    ensure_backups_dir()
    snaps = []
    for name in os.listdir("backups"):
        if name.endswith(".db"):
            try:
                dt = datetime.datetime.strptime(name[:-3], "%Y-%m-%d_%H-%M")
                if dt <= target: snaps.append((dt, name))
            except: pass
    if not snaps: return False
    snaps.sort(key=lambda x:x[0], reverse=True)
    shutil.copyfile(f"backups/{snaps[0][1]}", DB_PATH)
    return True

def countries_list(session):
    return [c for c in session.query(Country).order_by(Country.code).all() if c.code!="CN"]

def band_totals(session):
    ctrs = countries_list(session)
    band = {c.country: {"stock":0,"in_transit":0,"ad_spend":0.0,"code":c.code} for c in ctrs}
    whs = session.query(Warehouse).filter(Warehouse.active==True).all()
    wh_by_id = {w.id:w for w in whs}

    for sku, in session.query(Product.product_sku).all():
        bal={}
        for m in session.query(StockMovement).filter(StockMovement.product_sku==sku).all():
            if m.to_wh: bal[m.to_wh]=bal.get(m.to_wh,0)+m.qty
            if m.from_wh: bal[m.from_wh]=bal.get(m.from_wh,0)-m.qty
        for wid,qty in bal.items():
            ctry = wh_by_id[wid].country
            if ctry in band: band[ctry]["stock"]+=qty

    for sh in session.query(Shipment).filter(Shipment.status=="in_transit").all():
        qty = session.execute(select(func.sum(ShipmentItem.qty)).where(ShipmentItem.shipment_id==sh.id)).scalar() or 0
        if sh.to_country in band: band[sh.to_country]["in_transit"]+=qty

    code_to_country = {c.code:c.country for c in session.query(Country).all()}
    for r in session.query(PlatformSpendCurrent).all():
        nm = code_to_country.get(r.country_code, r.country_code)
        if nm in band: band[nm]["ad_spend"] += (r.amount_usd or 0.0)
    return ctrs, band

def spend_summary_by_country(session):
    rows = session.query(PlatformSpendCurrent).all()
    out={}
    for r in rows:
        cc=r.country_code
        x = out.get(cc, {"Facebook":0.0,"TikTok":0.0,"Google":0.0,"total":0.0})
        x[r.platform] = x.get(r.platform,0.0) + (r.amount_usd or 0.0)
        x["total"]=x.get("Facebook",0.0)+x.get("TikTok",0.0)+x.get("Google",0.0)
        out[cc]=x
    return out

def current_week_bounds():
    today = datetime.date.today()
    monday = today - datetime.timedelta(days=today.weekday())
    sunday = monday + datetime.timedelta(days=6)
    return monday, sunday

def weekly_delivered_map(session):
    mon, sun = current_week_bounds()
    mon_s, sun_s = mon.isoformat(), sun.isoformat()
    codes = [c.code for c in countries_list(session)]
    agg = {code:0 for code in codes}
    rows = session.query(DailyDelivered).filter(DailyDelivered.date>=mon_s, DailyDelivered.date<=sun_s).all()
    for r in rows:
        if r.country_code in agg:
            agg[r.country_code] += (r.delivered or 0)
    total = sum(agg.values())
    return agg, total, mon_s, sun_s

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

# ---------- routes ----------
@app.route("/", methods=["GET","POST"])
def index():
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
        spend_c_summary = spend_summary_by_country(s)

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
            start = datetime.date.fromisoformat(dfrom); end = datetime.date.fromisoformat(dto)
            span = (end - start).days + 1
            dates = [ (start + datetime.timedelta(days=i)).isoformat() for i in range(max(0,span)) ]
        ctr_codes = [c.code for c in countries_list(s)]
        pivot_rows=[]
        for d in sorted(dates, reverse=True):
            totals = {code:0 for code in ctr_codes}
            for row in s.query(DailyDelivered).filter(DailyDelivered.date==d).all():
                if row.country_code in totals:
                    totals[row.country_code] = row.delivered or 0
            obj = {"date": d, "total": sum(totals.values())}
            obj.update({code: totals.get(code,0) for code in ctr_codes})
            pivot_rows.append(type("DP",(object,),obj)())

        week_map, week_total, week_from, week_to = weekly_delivered_map(s)

    return render_template("index.html",
                           counts=counts, countries=ctrs, band=band,
                           cn_ke=cn_ke, inter_items=inter_items,
                           all_products=all_products, daily_pivot=pivot_rows,
                           dfrom=dfrom, dto=dto, ctr_codes=ctr_codes,
                           spend_c_summary=spend_c_summary,
                           week_map=week_map, week_total=week_total,
                           week_from=week_from, week_to=week_to,
                           title="Dashboard")

# ----- spend (replace current) -----
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

# ----- shipments -----
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
        flash("Shipment created","ok"); backup_db()
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("index"))

@app.post("/update_shipment_cost")
def update_shipment_cost():
    shipment_id = int(request.form.get("shipment_id"))
    cost = float(request.form.get("shipping_cost_usd") or 0.0)
    try:
        with Session(engine) as s:
            sh = s.get(Shipment, shipment_id)
            if not sh: flash("Shipment not found","error")
            else:
                sh.shipping_cost_usd = cost; s.commit(); flash("Shipping cost updated","ok")
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
                s.delete(sh); s.commit(); backup_db()
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
                    s.delete(it); s.commit(); backup_db()
                    left = s.query(ShipmentItem).filter(ShipmentItem.shipment_id==sh.id).count()
                    if left == 0:
                        s.delete(sh); s.commit(); backup_db()
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
                    it.qty = qty; s.commit(); backup_db()
                    flash("Quantity updated","ok")
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
            except: sh.transit_days = 0
            wh_from = s.query(Warehouse).filter(Warehouse.country==sh.from_country, Warehouse.active==True).first()
            wh_to = s.query(Warehouse).filter(Warehouse.country==sh.to_country, Warehouse.active==True).first()
            items = s.query(ShipmentItem).filter(ShipmentItem.shipment_id==shipment_id).all()
            for it in items:
                s.add(StockMovement(date=sh.arrived_date, product_sku=it.product_sku,
                                    from_wh=wh_from.id if wh_from else None, to_wh=wh_to.id if wh_to else None,
                                    qty=it.qty, ref=f"ARR-{sh.ref}"))
            s.commit(); backup_db()
            flash("Marked arrived; stock moved; transit days set","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("index"))

# ----- daily delivered -----
@app.post("/add_daily_delivered")
def add_daily_delivered():
    d = request.form
    try:
        date = d.get("date"); code = d.get("country_code"); delivered = int(d.get("delivered") or 0)
        with Session(engine) as s:
            row = s.query(DailyDelivered).filter(DailyDelivered.date==date, DailyDelivered.country_code==code).first()
            if row: row.delivered = delivered
            else: s.add(DailyDelivered(date=date, country_code=code, delivered=delivered))
            s.commit(); backup_db()
        flash("Daily delivered saved","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("index"))

# ---------------- PRODUCTS ----------------
@app.get("/products")
def products():
    with Session(engine) as s:
        items = s.query(Product).order_by(Product.product_sku).all()
    return render_template("products.html", products=items, title="Products")

@app.post("/add_product")
def add_product():
    d=request.form
    try:
        with Session(engine) as s:
            s.add(Product(
                product_sku=d.get("product_sku"),
                product_name=d.get("product_name"),
                category=d.get("category"),
                weight_g=int(d.get("weight_g") or 0),
                cost_cn_usd=float(d.get("cost_cn_usd") or 0),
                default_cnke_ship_usd=float(d.get("default_cnke_ship_usd") or 0),
                profit_ads_budget_usd=float(d.get("profit_ads_budget_usd") or 0),
            ))
            s.commit(); backup_db()
        flash("Product added","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("products"))

@app.post("/delete_product")
def delete_product():
    sku=request.form.get("product_sku")
    try:
        with Session(engine) as s:
            s.query(PlatformSpendCurrent).filter(PlatformSpendCurrent.product_sku==sku).delete()
            s.query(ShipmentItem).filter(ShipmentItem.product_sku==sku).delete()
            s.query(StockMovement).filter(StockMovement.product_sku==sku).delete()
            s.query(PeriodRemit).filter(PeriodRemit.product_sku==sku).delete()
            p = s.get(Product, sku)
            if p: s.delete(p)
            s.commit(); backup_db()
        flash("Product deleted","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("products"))

@app.get("/product/<sku>")
def product_view(sku):
    with Session(engine) as s:
        p = s.get(Product, sku)
        if not p: flash("Product not found","error"); return redirect(url_for("products"))

        # profit per country (from remits)
        ctr_codes = [c.code for c in countries_list(s)]
        profit_rows=[]
        totals=dict(pieces=0,revenue_usd=0.0,ad_usd=0.0,profit_total_usd=0.0)
        for code in ctr_codes:
            agg = s.query(
                func.coalesce(func.sum(PeriodRemit.pieces),0),
                func.coalesce(func.sum(PeriodRemit.revenue_usd),0.0),
                func.coalesce(func.sum(PeriodRemit.ad_usd),0.0),
                func.coalesce(func.sum(PeriodRemit.profit_total_usd),0.0)
            ).filter(PeriodRemit.product_sku==sku, PeriodRemit.country_code==code).one()
            pieces, rev, ad, prof = agg
            ppu = (prof/pieces) if pieces else 0.0
            profit_rows.append(type("R",(object,),dict(country_code=code,pieces=pieces,revenue_usd=rev,ad_usd=ad,profit_total_usd=prof,profit_per_piece_usd=ppu))())
            totals["pieces"]+=pieces; totals["revenue_usd"]+=rev; totals["ad_usd"]+=ad; totals["profit_total_usd"]+=prof
        profit_totals=type("T",(object,),totals)()

        # stock per country (from movements)
        whs = s.query(Warehouse).filter(Warehouse.active==True).all()
        wh_by_id = {w.id:w for w in whs}
        bal={}
        for m in s.query(StockMovement).filter(StockMovement.product_sku==sku).all():
            if m.to_wh: bal[m.to_wh]=bal.get(m.to_wh,0)+m.qty
            if m.from_wh: bal[m.from_wh]=bal.get(m.from_wh,0)-m.qty
        agg_ctry={}
        for wid,qty in bal.items():
            ctry = wh_by_id[wid].country
            agg_ctry[ctry]=agg_ctry.get(ctry,0)+qty
        stock_rows=[type("S",(object,),dict(country=k, qty=v))() for k,v in sorted(agg_ctry.items())]
        stock_total=sum(agg_ctry.values()) if agg_ctry else 0

        # spend for this product (group by country)
        rows = s.query(PlatformSpendCurrent).filter(PlatformSpendCurrent.product_sku==sku).all()
        spend_by_country={}
        for r in rows:
            spend_by_country.setdefault(r.country_code, []).append(r)

        # shipments for this product
        shipments=[]
        for sh in s.query(Shipment).order_by(desc(Shipment.id)).all():
            q = s.execute(select(func.sum(ShipmentItem.qty)).where(
                ShipmentItem.shipment_id==sh.id,
                ShipmentItem.product_sku==sku
            )).scalar() or 0
            if q>0:
                shipments.append(type("H",(object,),dict(
                    id=sh.id, ref=sh.ref, from_country=sh.from_country, to_country=sh.to_country,
                    status=sh.status, arrived_date=sh.arrived_date, transit_days=sh.transit_days,
                    shipping_cost_usd=sh.shipping_cost_usd, qty_sum=q
                ))())

        countries = countries_list(s)

    return render_template("product.html",
                           product=p, profit_rows=profit_rows, profit_totals=profit_totals,
                           stock_rows=stock_rows, stock_total=stock_total,
                           spend_by_country=spend_by_country, shipments=shipments,
                           countries=countries, title=f"{p.product_sku}")

# ---------------- PERFORMANCE ----------------
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
        data = qr.all()
        # sort by profit desc
        data.sort(key=lambda r: (r.profit_total_usd or 0.0), reverse=True)

    return render_template("performance.html",
                           tp=tp, tc=tc, ctr_codes=ctr_codes, all_products=all_products,
                           top_report=data, remit_report=data, title="Performance")

@app.post("/upsert_period_remit")
def upsert_period_remit():
    d=request.form
    try:
        with Session(engine) as s:
            sku = d.get("product_sku"); cc = d.get("country_code")
            pieces = int(d.get("pieces") or 0)
            orders = int(d.get("orders") or 0)
            revenue = float(d.get("revenue_usd") or 0.0)
            ad = float(d.get("ad_usd") or 0.0)

            prod = s.get(Product, sku)
            if not prod: raise ValueError("Product not found")

            # cost per piece = CN cost + CN->KE ship + KE->Dest ship (override optional)
            ship_override = d.get("override_ship_unit")
            if ship_override:
                ship_unit = float(ship_override)
            else:
                # simple: use product.default_cnke_ship_usd + 0 for KE->Dest unless future extension
                ship_unit = float(prod.default_cnke_ship_usd or 0.0)

            cost_unit = float(prod.cost_cn_usd or 0.0) + ship_unit

            profit_total = revenue - ad - (pieces * cost_unit)
            profit_pp = (profit_total / pieces) if pieces else 0.0

            r = PeriodRemit(
                start_date=d.get("start_date"), end_date=d.get("end_date"),
                country_code=cc, product_sku=sku,
                orders=orders, pieces=pieces, revenue_usd=revenue, ad_usd=ad,
                cost_unit_usd=cost_unit, profit_total_usd=profit_total, profit_per_piece_usd=profit_pp
            )
            s.add(r)

            # deduct stock (from destination country warehouse) — simplest: pick first active WH in that country
            wh = s.query(Warehouse).filter(Warehouse.code==cc, Warehouse.active==True).first()
            if wh and pieces>0:
                s.add(StockMovement(date=str(datetime.date.today()), product_sku=sku,
                                    from_wh=wh.id, to_wh=None, qty=pieces, ref=f"REM-{cc}"))
            s.commit(); backup_db()
        flash("Remittance saved and stock deducted","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("performance"))

# ---------------- FINANCE ----------------
@app.get("/finance")
def finance():
    sel_month = request.args.get("m","")
    sel_cat = request.args.get("c","").strip()
    q = request.args.get("q","").strip()
    with Session(engine) as s:
        qry = s.query(FinanceEntry).order_by(desc(FinanceEntry.date), desc(FinanceEntry.id))
        if sel_month:
            yr,mo = sel_month.split("-"); prefix=f"{yr}-{mo}"
            qry = qry.filter(FinanceEntry.date.like(f"{prefix}%"))
        if sel_cat:
            qry = qry.filter(FinanceEntry.category.ilike(f"%{sel_cat}%"))
        if q:
            qry = qry.filter(or_(FinanceEntry.description.ilike(f"%{q}%"),
                                 FinanceEntry.category.ilike(f"%{q}%")))
        items = qry.all()

        # summary per month
        month_sum={}; months=[]
        for it in items:
            key = it.date[:7]
            if key not in month_sum:
                month_sum[key]=type("S",(object,),dict(credit=0.0,debit=0.0))(); months.append(key)
            if it.type=="credit": month_sum[key].credit += (it.amount_usd or 0.0)
            else: month_sum[key].debit += (it.amount_usd or 0.0)
        months.sort(reverse=True)

        balance = sum([(it.amount_usd or 0.0) if it.type=="credit" else -(it.amount_usd or 0.0) for it in items])

    return render_template("finance.html", items=items, month_sum=month_sum, months=months,
                           balance=balance, sel_month=sel_month, sel_cat=sel_cat, q=q, title="Finance")

@app.post("/finance/add")
def finance_add():
    d=request.form
    try:
        with Session(engine) as s:
            s.add(FinanceEntry(
                date=d.get("date"), type=d.get("type"),
                category=d.get("category"), description=d.get("description"),
                amount_usd=float(d.get("amount_usd") or 0.0)
            ))
            s.commit(); backup_db()
        flash("Finance entry added","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("finance"))

# ---------------- SETTINGS ----------------
@app.get("/settings")
def settings():
    with Session(engine) as s:
        countries = [c for c in s.query(Country).order_by(Country.code).all()]
        products = s.query(Product).order_by(Product.product_sku).all()
        budgets={}
        for b in s.query(ProductBudgetCountry).all():
            budgets.setdefault(b.product_sku, {})[b.country_code]=b.budget_usd
    return render_template("settings.html", countries=countries, products=products, budgets=budgets, title="Settings")

@app.post("/settings/add-country")
def add_country():
    d=request.form
    try:
        with Session(engine) as s:
            s.add(Country(country=d.get("country"), code=d.get("code"),
                          currency=d.get("currency") or "USD",
                          fx_to_usd=float(d.get("fx_to_usd") or 1.0)))
            # also create a warehouse for that country
            s.add(Warehouse(name=f"{d.get('country')} Hub", country=d.get("country"), code=d.get("code"), active=True))
            s.commit(); backup_db()
        flash("Country added","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("settings"))

@app.post("/settings/edit-country")
def edit_country():
    code=request.form.get("code")
    try:
        with Session(engine) as s:
            c = s.query(Country).filter(Country.code==code).first()
            if not c: flash("Country not found","error")
            else:
                nm = request.form.get("country"); cur = request.form.get("currency"); fx = request.form.get("fx_to_usd")
                if nm: c.country = nm
                if cur: c.currency = cur
                if fx: c.fx_to_usd = float(fx)
                s.commit(); backup_db(); flash("Country updated","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("settings"))

@app.post("/settings/delete-country")
def delete_country():
    code=request.form.get("code")
    try:
        with Session(engine) as s:
            # basic safety: don't delete China
            if code=="CN": flash("Cannot delete China","error"); return redirect(url_for("settings"))
            c = s.query(Country).filter(Country.code==code).first()
            if c:
                s.query(Warehouse).where(Warehouse.code==code).delete()
                s.delete(c); s.commit(); backup_db(); flash("Country deleted","ok")
            else:
                flash("Country not found","error")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("settings"))

@app.post("/settings/edit-product")
def edit_product():
    d=request.form; sku=d.get("product_sku")
    try:
        with Session(engine) as s:
            p = s.get(Product, sku)
            if not p: flash("Product not found","error")
            else:
                p.product_name = d.get("product_name") or p.product_name
                if d.get("cost_cn_usd") is not None: p.cost_cn_usd = float(d.get("cost_cn_usd") or 0.0)
                if d.get("default_cnke_ship_usd") is not None: p.default_cnke_ship_usd = float(d.get("default_cnke_ship_usd") or 0.0)
                # budgets per country
                for c in s.query(Country).all():
                    key=f"budget_{c.code}"
                    if key in d:
                        val = float(d.get(key) or 0.0)
                        row = s.query(ProductBudgetCountry).filter(
                            ProductBudgetCountry.product_sku==sku,
                            ProductBudgetCountry.country_code==c.code
                        ).first()
                        if row: row.budget_usd = val
                        else: s.add(ProductBudgetCountry(product_sku=sku, country_code=c.code, budget_usd=val))
                s.commit(); backup_db(); flash("Product updated","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("settings"))

@app.post("/settings/restore-choice")
def restore_choice():
    which = request.form.get("which","1d")
    ok = restore_db_by_choice(which)
    flash("Restored" if ok else "No snapshot found up to that time", "ok" if ok else "error")
    return redirect(url_for("settings"))

# ----- alias endpoints used by templates -----
add_country = add_country
edit_country = edit_country
delete_country = delete_country
edit_product = edit_product
finance_add = finance_add

if __name__ == "__main__":
    app.run(debug=True)
