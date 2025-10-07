from flask import Flask, render_template, request, redirect, url_for, flash, Response
from sqlalchemy import create_engine, func, select, or_, and_
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

# Seed defaults if empty
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
    # All operational countries except China
    return [c for c in session.query(Country).order_by(Country.code).all() if c.code!="CN"]

def band_totals(session):
    """Per-country totals: stock, in_transit, ad_spend."""
    ctrs = countries_list(session)
    band = {c.country: {"stock":0,"in_transit":0,"ad_spend":0.0,"code":c.code} for c in ctrs}

    # Stock per country (from StockMovement)
    whs = session.query(Warehouse).filter(Warehouse.active==True).all()
    wh_by_id = {w.id:w for w in whs}
    for sku, in session.query(Product.product_sku).all():
        bal = {}
        for m in session.query(StockMovement).filter(StockMovement.product_sku==sku).all():
            if m.to_wh: bal[m.to_wh]=bal.get(m.to_wh,0)+m.qty
            if m.from_wh: bal[m.from_wh]=bal.get(m.from_wh,0)-m.qty
        for wid,qty in bal.items():
            ctry = wh_by_id[wid].country
            if ctry in band: band[ctry]["stock"]+=qty

    # In-transit qty per destination
    for sh in session.query(Shipment).filter(Shipment.status=="in_transit").all():
        qty = session.execute(select(func.sum(ShipmentItem.qty)).where(ShipmentItem.shipment_id==sh.id)).scalar() or 0
        if sh.to_country in band: band[sh.to_country]["in_transit"]+=qty

    # Ad spend per country (current)
    code_to_country = {c.code:c.country for c in session.query(Country).all()}
    for r in session.query(PlatformSpendCurrent).all():
        name = code_to_country.get(r.country_code,r.country_code)
        if name in band: band[name]["ad_spend"]+=(r.amount_usd or 0.0)

    return ctrs, band

def spend_summary_by_country(session):
    """Per-country by-platform and totals for Daily Spend."""
    rows = session.query(PlatformSpendCurrent).all()
    out = {}
    for r in rows:
        cc = r.country_code
        x = out.get(cc, {"Facebook":0.0,"TikTok":0.0,"Google":0.0,"total":0.0})
        x[r.platform] = (r.amount_usd or 0.0)  # replace model (current day = latest value)
        x["total"] = (x.get("Facebook",0.0) + x.get("TikTok",0.0) + x.get("Google",0.0))
        out[cc] = x
    return out

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

def monday_of_week(d: datetime.date) -> datetime.date:
    return d - datetime.timedelta(days=d.weekday())  # Monday=0

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
        spend_c_summary = spend_summary_by_country(s)

        # Split in-transit: CN->KE vs between countries (itemized)
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

        # Daily delivered pivot (recent 8 days or custom filter)
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
            totals = {code:0 for code in ctr_codes}
            for row in s.query(DailyDelivered).filter(DailyDelivered.date==d).all():
                if row.country_code in totals:
                    totals[row.country_code] = row.delivered or 0
            obj = {"date": d, "total": sum(totals.values())}
            obj.update({code: totals.get(code,0) for code in ctr_codes})
            pivot_rows.append(type("DP",(object,),obj)())

        # Weekly delivered summary (Mon-Sun, resets weekly)
        week_start = monday_of_week(today)
        week_end = week_start + datetime.timedelta(days=6)
        ws = week_start.isoformat(); we = week_end.isoformat()
        weekly_totals = {code:0 for code in ctr_codes}
        for row in s.query(DailyDelivered).filter(and_(DailyDelivered.date>=ws, DailyDelivered.date<=we)).all():
            if row.country_code in weekly_totals:
                weekly_totals[row.country_code] += (row.delivered or 0)
        weekly_grand = sum(weekly_totals.values())

    return render_template("index.html",
                           counts=counts, countries=ctrs, band=band,
                           cn_ke=cn_ke, inter_items=inter_items,
                           all_products=all_products, daily_pivot=pivot_rows,
                           dfrom=dfrom, dto=dto, ctr_codes=ctr_codes,
                           spend_c_summary=spend_c_summary,
                           weekly_totals=weekly_totals, weekly_grand=weekly_grand,
                           week_start=ws, week_end=we,
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

# --- Ad spend (current, replace) ---
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

# --- Shipments / Movements (same as v19) ---
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

# --- Daily delivered add/update (unchanged) ---
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

# --- Remittance / Products / Finance / Settings endpoints remain same as v19 ---
# (Kept verbatim in your current files)
if __name__ == "__main__":
    app.run(debug=True)
