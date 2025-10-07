from flask import Flask, render_template, request, redirect, url_for, flash, Response
from sqlalchemy import create_engine, func, select, and_, or_
from sqlalchemy.orm import Session
from models import (
    Base, Product, Country, Warehouse, StockMovement, PlatformSpendCurrent,
    Shipment, ShipmentItem, DailyDelivered, PeriodRemit, ProductBudgetCountry,
    FinanceEntry
)
import os, datetime, csv, io, shutil

# -------------------- APP & DB --------------------
app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY","devkey")
DB_PATH = os.environ.get("DB_PATH","eas_cod.db")
engine = create_engine(f"sqlite:///{DB_PATH}", echo=False, future=True)

with engine.begin() as conn:
    Base.metadata.create_all(conn)

# Seed countries/warehouses if empty
with Session(engine) as s:
    if not s.query(Country).count():
        s.add_all([
            Country(country="China", code="CN", currency="USD", fx_to_usd=1.0),
            Country(country="Kenya", code="KE", currency="USD", fx_to_usd=1.0),
            Country(country="Uganda", code="UG", currency="USD", fx_to_usd=1.0),
            Country(country="Tanzania", code="TZ", currency="USD", fx_to_usd=1.0),
            Country(country="Zambia", code="ZM", currency="USD", fx_to_usd=1.0),
            Country(country="Zimbabwe", code="ZW", currency="USD", fx_to_usd=1.0),
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
    s.commit()

# -------------------- HELPERS --------------------
def countries_op(session):
    return [c for c in session.query(Country).order_by(Country.code).all() if c.code != "CN"]

def wh_map(session):
    return {w.id: w for w in session.query(Warehouse).filter(Warehouse.active==True).all()}

def band_totals(session):
    ctrs = countries_op(session)
    band = {c.country: {"stock":0,"in_transit":0,"ad_spend":0.0,"code":c.code} for c in ctrs}
    wm = wh_map(session)

    # stock per WH, all products
    for m in session.query(StockMovement).all():
        if m.to_wh: 
            ctry = wm[m.to_wh].country
            if ctry in band: band[ctry]["stock"] += m.qty
        if m.from_wh:
            ctry = wm[m.from_wh].country
            if ctry in band: band[ctry]["stock"] -= m.qty

    # in-transit per destination
    for sh in session.query(Shipment).filter(Shipment.status=="in_transit").all():
        qty = session.execute(select(func.sum(ShipmentItem.qty)).where(ShipmentItem.shipment_id==sh.id)).scalar() or 0
        if sh.to_country in band: band[sh.to_country]["in_transit"] += qty

    # ad spend current
    code_to_country = {c.code:c.country for c in session.query(Country).all()}
    for r in session.query(PlatformSpendCurrent).all():
        nm = code_to_country.get(r.country_code, r.country_code)
        if nm in band: band[nm]["ad_spend"] += (r.amount_usd or 0.0)

    return ctrs, band

def spend_summary(session):
    out = {}
    for r in session.query(PlatformSpendCurrent).all():
        cc = r.country_code
        cur = out.get(cc, {"Facebook":0.0,"TikTok":0.0,"Google":0.0,"total":0.0})
        cur[r.platform] = float(r.amount_usd or 0.0)
        cur["total"] = cur["Facebook"] + cur["TikTok"] + cur["Google"]
        out[cc] = cur
    return out

def monday(d: datetime.date): return d - datetime.timedelta(days=d.weekday())

def parse_period(choice):
    today = datetime.date.today()
    m = {
        "10d":10, "21d":21, "35d":35, "60d":60,
        "3m":90, "6m":180, "1y":365
    }.get(choice, 30)
    return (today - datetime.timedelta(days=m)).isoformat(), today.isoformat()

def ensure_backups():
    os.makedirs("backups", exist_ok=True)

def backup_db():
    ensure_backups()
    if os.path.exists(DB_PATH):
        dst = f"backups/{datetime.date.today().isoformat()}.db"
        if not os.path.exists(dst):
            shutil.copyfile(DB_PATH, dst)

def restore_db(days_ago=1):
    ensure_backups()
    src = f"backups/{(datetime.date.today()-datetime.timedelta(days=days_ago)).isoformat()}.db"
    if not os.path.exists(src): return False
    shutil.copyfile(src, DB_PATH)
    return True

def avg_ship_unit(session, sku, from_country, to_country):
    shs = session.query(Shipment).filter(
        Shipment.status=="arrived",
        Shipment.from_country==from_country,
        Shipment.to_country==to_country
    ).all()
    t_cost = 0.0; t_qty = 0
    for sh in shs:
        q = session.execute(
            select(func.sum(ShipmentItem.qty)).where(
                ShipmentItem.shipment_id==sh.id, ShipmentItem.product_sku==sku
            )
        ).scalar() or 0
        if q:
            t_cost += (sh.shipping_cost_usd or 0.0)
            t_qty += q
    return (t_cost/t_qty) if t_qty else 0.0

# -------------------- DASHBOARD --------------------
@app.route("/", methods=["GET","POST"])
def index():
    if request.method == "POST" and "q" in request.form:
        q = request.form.get("q","")
    else:
        q = request.args.get("q","") or ""

    dfrom = request.args.get("dfrom","")
    dto = request.args.get("dto","")

    with Session(engine) as s:
        counts = {
            "products": s.query(Product).count(),
            "warehouses": s.query(Warehouse).count(),
            "in_transit": s.query(Shipment).filter(Shipment.status=="in_transit").count(),
        }
        ctrs, band = band_totals(s)
        spend_c = spend_summary(s)
        prods = s.query(Product).order_by(Product.product_sku).all()

        # split in-transit
        cn_ke = []; inter_items=[]
        for sh in s.query(Shipment).filter(Shipment.status=="in_transit").order_by(Shipment.id.desc()).all():
            its = s.query(ShipmentItem).filter(ShipmentItem.shipment_id==sh.id).all()
            if sh.from_country=="China" and sh.to_country=="Kenya":
                setattr(sh, "items_str", ", ".join([f"{it.product_sku}:{it.qty}" for it in its]))
                cn_ke.append(sh)
            else:
                for it in its:
                    inter_items.append(type("IR",(object,),dict(
                        shipment_id=sh.id, ref=sh.ref, from_country=sh.from_country,
                        to_country=sh.to_country, product_sku=it.product_sku, qty=it.qty,
                        created_date=sh.created_date, shipping_cost_usd=sh.shipping_cost_usd,
                        item_id=it.id
                    ))())

        # daily delivered pivot (recent 8, or filter range)
        today = datetime.date.today()
        if not dfrom or not dto:
            dates = [(today - datetime.timedelta(days=i)).isoformat() for i in range(8)]
        else:
            start = datetime.date.fromisoformat(dfrom)
            end = datetime.date.fromisoformat(dto)
            dates = [(start + datetime.timedelta(days=i)).isoformat() for i in range((end-start).days+1)]

        codes = [c.code for c in countries_op(s)]
        rows=[]
        for d in sorted(dates, reverse=True):
            agg = {c:0 for c in codes}
            for r in s.query(DailyDelivered).filter(DailyDelivered.date==d).all():
                if r.country_code in agg: agg[r.country_code] = r.delivered or 0
            obj = {"date": d, "total": sum(agg.values())}
            obj.update(agg)
            rows.append(type("R",(object,),obj)())

        # weekly delivered
        ws = monday(today); we = ws + datetime.timedelta(days=6)
        weekly = {c:0 for c in codes}
        for r in s.query(DailyDelivered).filter(and_(DailyDelivered.date>=ws.isoformat(),
                                                    DailyDelivered.date<=we.isoformat())).all():
            if r.country_code in weekly: weekly[r.country_code] += (r.delivered or 0)
        weekly_total = sum(weekly.values())

    return render_template("index.html",
        title="Dashboard",
        counts=counts, countries=ctrs, band=band, all_products=prods,
        cn_ke=cn_ke, inter_items=inter_items,
        daily_pivot=rows, ctr_codes=codes,
        dfrom=dfrom, dto=dto,
        spend_c_summary=spend_c,
        week_start=ws.isoformat(), week_end=we.isoformat(),
        weekly_totals=weekly, weekly_grand=weekly_total
    )

# Upsert / delete current spend
@app.post("/upsert_current_spend")
def upsert_current_spend():
    d = request.form
    try:
        with Session(engine) as s:
            s.query(PlatformSpendCurrent).filter(
                PlatformSpendCurrent.product_sku==d.get("product_sku"),
                PlatformSpendCurrent.platform==d.get("platform"),
                PlatformSpendCurrent.country_code==d.get("country_code"),
            ).delete()
            s.add(PlatformSpendCurrent(
                product_sku=d.get("product_sku"),
                platform=d.get("platform"),
                amount_usd=float(d.get("amount_usd") or 0.0),
                country_code=d.get("country_code"),
            ))
            s.commit()
        flash("Ad spend saved","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    ref = d.get("product_sku")
    return redirect(url_for("product_view", sku=ref)) if ref else redirect(url_for("index"))

@app.post("/add_daily_delivered")
def add_daily_delivered():
    d = request.form
    try:
        with Session(engine) as s:
            row = s.query(DailyDelivered).filter(
                DailyDelivered.date==d.get("date"),
                DailyDelivered.country_code==d.get("country_code"),
            ).first()
            if row: row.delivered = int(d.get("delivered") or 0)
            else: s.add(DailyDelivered(date=d.get("date"), country_code=d.get("country_code"),
                                       delivered=int(d.get("delivered") or 0)))
            s.commit()
        flash("Daily delivered saved","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("index"))

# Create shipment (CN/KE or inter-country)
@app.post("/create_transfer_home")
def create_transfer_home():
    d = request.form
    try:
        with Session(engine) as s:
            code_to_name = {c.code:c.country for c in s.query(Country).all()}
            sh = Shipment(
                ref=d.get("ref"),
                from_country=code_to_name.get(d.get("from_code"), d.get("from_code")),
                to_country=code_to_name.get(d.get("to_code"), d.get("to_code")),
                status="in_transit",
                created_date=str(datetime.date.today()),
                shipping_cost_usd=float(d.get("shipping_cost_usd") or 0.0),
            )
            s.add(sh); s.flush()
            s.add(ShipmentItem(
                shipment_id=sh.id,
                product_sku=d.get("product_sku"),
                qty=int(d.get("qty") or 0),
            ))
            s.commit()
        flash("Shipment created","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("index"))

@app.post("/update_shipment_cost")
def update_shipment_cost():
    try:
        with Session(engine) as s:
            sh = s.get(Shipment, int(request.form.get("shipment_id")))
            if not sh: flash("Shipment not found","error")
            else:
                sh.shipping_cost_usd = float(request.form.get("shipping_cost_usd") or 0.0)
                s.commit(); flash("Shipping cost updated","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("index"))

@app.post("/edit_shipment_item_qty")
def edit_shipment_item_qty():
    try:
        with Session(engine) as s:
            it = s.get(ShipmentItem, int(request.form.get("shipment_item_id")))
            sh = s.get(Shipment, it.shipment_id) if it else None
            if not it or not sh or sh.status!="in_transit":
                flash("Item not editable","error")
            else:
                it.qty = int(request.form.get("qty") or 0)
                s.commit(); flash("Quantity updated","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("index"))

@app.post("/delete_shipment_item")
def delete_shipment_item():
    try:
        with Session(engine) as s:
            it = s.get(ShipmentItem, int(request.form.get("shipment_item_id")))
            if not it: flash("Item not found","error")
            else:
                sh = s.get(Shipment, it.shipment_id)
                if sh.status!="in_transit": flash("Shipment not editable","error")
                else:
                    s.delete(it); s.commit()
                    left = s.query(ShipmentItem).filter(ShipmentItem.shipment_id==sh.id).count()
                    if left==0: s.delete(sh); s.commit()
                    flash("Item deleted","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("index"))

@app.post("/delete_shipment")
def delete_shipment():
    try:
        with Session(engine) as s:
            sh = s.get(Shipment, int(request.form.get("shipment_id")))
            if not sh or sh.status!="in_transit": flash("Shipment not deletable","error")
            else:
                s.query(ShipmentItem).where(ShipmentItem.shipment_id==sh.id).delete()
                s.delete(sh); s.commit(); flash("Shipment deleted","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("index"))

@app.post("/mark_arrived")
def mark_arrived():
    try:
        with Session(engine) as s:
            sh = s.get(Shipment, int(request.form.get("shipment_id")))
            if not sh: flash("Shipment not found","error"); return redirect(url_for("index"))
            sh.status="arrived"; sh.arrived_date=str(datetime.date.today())
            try:
                d0 = datetime.date.fromisoformat(sh.created_date); d1 = datetime.date.fromisoformat(sh.arrived_date)
                sh.transit_days = (d1-d0).days
            except Exception: sh.transit_days=0

            wm = wh_map(s)
            fr = next((w for w in wm.values() if w.country==sh.from_country), None)
            to = next((w for w in wm.values() if w.country==sh.to_country), None)
            for it in s.query(ShipmentItem).filter(ShipmentItem.shipment_id==sh.id).all():
                s.add(StockMovement(
                    date=sh.arrived_date, product_sku=it.product_sku,
                    from_wh=fr.id if fr else None, to_wh=to.id if to else None,
                    qty=it.qty, ref=f"ARR-{sh.ref}"
                ))
            s.commit(); flash("Arrived & stock updated","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("index"))

# -------------------- PRODUCTS --------------------
@app.get("/products")
def products():
    with Session(engine) as s:
        items = s.query(Product).order_by(Product.product_sku).all()
        bq = s.query(ProductBudgetCountry).all()
        mapb = {}
        for r in bq:
            mp = mapb.get(r.product_sku, {})
            mp[r.country_code] = r.budget_usd or 0.0
            mapb[r.product_sku] = mp
    return render_template("products.html", title="Products", products=items, budgets=mapb)

@app.post("/products/add")
def add_product():
    d = request.form
    try:
        with Session(engine) as s:
            s.add(Product(
                product_sku=d.get("product_sku"),
                product_name=d.get("product_name"),
                category=d.get("category"),
                weight_g=int(d.get("weight_g") or 0),
                cost_cn_usd=float(d.get("cost_cn_usd") or 0.0),
                default_cnke_ship_usd=float(d.get("default_cnke_ship_usd") or 0.0),
                profit_ads_budget_usd=float(d.get("profit_ads_budget_usd") or 0.0),
            ))
            s.commit(); flash("Product added","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("products"))

@app.post("/products/delete")
def delete_product():
    sku = request.form.get("product_sku")
    try:
        with Session(engine) as s:
            s.query(Product).where(Product.product_sku==sku).delete()
            s.commit(); flash("Product deleted","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("products"))

@app.get("/product/<sku>")
def product_view(sku):
    with Session(engine) as s:
        p = s.get(Product, sku)
        if not p:
            flash("Product not found","error"); return redirect(url_for("products"))

        # spend by country (list of rows)
        rows = s.query(PlatformSpendCurrent).filter(PlatformSpendCurrent.product_sku==sku).all()
        spend_by_country = {}
        for r in rows:
            arr = spend_by_country.get(r.country_code, [])
            arr.append(r); spend_by_country[r.country_code] = arr

        # stock by country
        wm = wh_map(s)
        bal = {}
        for m in s.query(StockMovement).filter(StockMovement.product_sku==sku).all():
            if m.to_wh: bal[wm[m.to_wh].country] = bal.get(wm[m.to_wh].country,0) + m.qty
            if m.from_wh: bal[wm[m.from_wh].country] = bal.get(wm[m.from_wh].country,0) - m.qty
        stock_rows = [type("S",(object,),dict(country=k, qty=v))() for k,v in sorted(bal.items()) if k!="China"]
        stock_total = sum([r.qty for r in stock_rows])

        # shipments for this product
        ships = []
        for sh in s.query(Shipment).order_by(Shipment.id.desc()).all():
            its = s.query(ShipmentItem).filter(ShipmentItem.shipment_id==sh.id, ShipmentItem.product_sku==sku).all()
            qty_sum = sum([i.qty for i in its])
            if qty_sum:
                sh2 = type("SH",(object,),{k:getattr(sh,k) for k in ["id","ref","from_country","to_country","status","arrived_date","transit_days","shipping_cost_usd"]})()
                sh2.qty_sum = qty_sum
                sh2.items = its
                ships.append(sh2)

        # profit snapshot by country (from PeriodRemit)
        pr = s.query(
            PeriodRemit.country_code,
            func.sum(PeriodRemit.pieces),
            func.sum(PeriodRemit.revenue_usd),
            func.sum(PeriodRemit.ad_usd),
            func.sum(PeriodRemit.profit_total_usd)
        ).filter(PeriodRemit.product_sku==sku).group_by(PeriodRemit.country_code).all()

        rows_p=[]
        tot_pieces=0; tot_rev=0.0; tot_ads=0.0; tot_profit=0.0
        for cc,pieces,rev,ads,profit in pr:
            ppp = (profit/pieces) if pieces else 0.0
            rows_p.append(type("PR",(object,),dict(
                country_code=cc, pieces=pieces or 0, revenue_usd=rev or 0.0,
                ad_usd=ads or 0.0, profit_total_usd=profit or 0.0,
                profit_per_piece_usd=ppp
            ))())
            tot_pieces += pieces or 0
            tot_rev += rev or 0.0
            tot_ads += ads or 0.0
            tot_profit += profit or 0.0

        totals = type("TOT",(object,),dict(
            pieces=tot_pieces, revenue_usd=tot_rev, ad_usd=tot_ads, profit_total_usd=tot_profit
        ))()

        ctrs = countries_op(s)

    return render_template("product.html",
        title=p.product_name, product=p, spend_by_country=spend_by_country,
        stock_rows=stock_rows, stock_total=stock_total,
        shipments=ships, profit_rows=rows_p, profit_totals=totals,
        countries=ctrs
    )

# -------------------- PERFORMANCE --------------------
@app.get("/performance")
def performance():
    tp = request.args.get("tp","21d")
    tc = request.args.get("tc","")
    start, end = parse_period(tp)

    with Session(engine) as s:
        codes = [c.code for c in countries_op(s)]
        prods = s.query(Product).order_by(Product.product_sku).all()

        # top delivered aggregation
        qr = s.query(PeriodRemit).filter(
            PeriodRemit.start_date>=start, PeriodRemit.end_date<=end
        )
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

        top_rows=[]
        for (sku,cc),a in agg.items():
            ppp = (a["profit"]/a["pieces"]) if a["pieces"] else 0.0
            top_rows.append(type("T",(object,),dict(
                product_sku=sku, country_code=cc, orders=a["orders"], pieces=a["pieces"],
                revenue_usd=a["rev"], profit_total_usd=a["profit"], profit_per_piece_usd=ppp
            ))())
        top_rows.sort(key=lambda x: (x.profit_total_usd, x.pieces), reverse=True)

        # remit table (same period)
        remit_rows = qr.order_by(PeriodRemit.id.desc()).all()

    return render_template("performance.html",
        title="Performance",
        tp=tp, tc=tc, ctr_codes=codes, all_products=prods,
        top_report=top_rows, remit_report=remit_rows
    )

@app.post("/upsert_period_remit")
def upsert_period_remit():
    d = request.form
    try:
        with Session(engine) as s:
            sku = d.get("product_sku"); cc = d.get("country_code")
            p = s.get(Product, sku)
            cost_cn = p.cost_cn_usd or 0.0
            cn_ke = p.default_cnke_ship_usd or 0.0
            ke_dest = float(d.get("override_ship_unit") or 0.0)
            if not ke_dest:
                ke_dest = avg_ship_unit(s, sku, "Kenya", 
                                        next((x.country for x in s.query(Country).filter(Country.code==cc)), "Kenya"))
            cost_unit = cost_cn + cn_ke + (ke_dest or 0.0)

            pieces = int(d.get("pieces") or 0)
            revenue = float(d.get("revenue_usd") or 0.0)
            ads = float(d.get("ad_usd") or 0.0)
            profit_total = revenue - ads - (pieces * cost_unit)
            ppp = (profit_total / pieces) if pieces else 0.0

            r = PeriodRemit(
                start_date=d.get("start_date"), end_date=d.get("end_date"),
                country_code=cc, product_sku=sku,
                orders=int(d.get("orders") or 0), pieces=pieces,
                revenue_usd=revenue, ad_usd=ads,
                cost_unit_usd=cost_unit, profit_total_usd=profit_total,
                profit_per_piece_usd=ppp
            )
            s.add(r)

            # deduct stock from destination country WH
            dest_country = next((x.country for x in s.query(Country).filter(Country.code==cc)), None)
            wm = wh_map(s)
            to_wh = next((w.id for w in wm.values() if w.country==dest_country), None)
            if to_wh is not None and pieces>0:
                s.add(StockMovement(
                    date=d.get("end_date"), product_sku=sku,
                    from_wh=to_wh, to_wh=None, qty=pieces, ref=f"REMIT-{cc}"
                ))
            s.commit()
        flash("Remittance saved","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("performance"))

# -------------------- FINANCE --------------------
@app.get("/finance")
def finance():
    m = request.args.get("m","")  # YYYY-MM
    c = request.args.get("c","")
    q = request.args.get("q","")

    with Session(engine) as s:
        qr = s.query(FinanceEntry).order_by(FinanceEntry.date.desc(), FinanceEntry.id.desc())
        if m: qr = qr.filter(FinanceEntry.date.like(f"{m}-%"))
        if c: qr = qr.filter(FinanceEntry.category.ilike(f"%{c}%"))
        if q: qr = qr.filter(or_(FinanceEntry.description.ilike(f"%{q}%"), FinanceEntry.category.ilike(f"%{q}%")))
        items = qr.all()

        months = sorted({it.date[:7] for it in items}, reverse=True)
        month_sum = {}
        for mo in months:
            cr = sum([it.amount_usd for it in items if it.type=="credit" and it.date.startswith(mo)])
            db = sum([it.amount_usd for it in items if it.type=="debit" and it.date.startswith(mo)])
            month_sum[mo] = type("S",(object,),dict(credit=cr or 0.0, debit=db or 0.0))()
        balance = sum([it.amount_usd if it.type=="credit" else -it.amount_usd for it in items])

    return render_template("finance.html", title="Finance",
        items=items, months=months, month_sum=month_sum, balance=balance,
        sel_month=m, sel_cat=c, q=q)

@app.post("/finance/add")
def finance_add():
    d = request
