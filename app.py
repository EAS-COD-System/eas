from flask import Flask, render_template, request, redirect, url_for, flash, jsonify
from sqlalchemy import create_engine, func, select, desc
from sqlalchemy.orm import Session
from models import *
import os, datetime, shutil

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY","devkey")
DB_PATH = os.environ.get("DB_PATH","eas_cod.db")
engine = create_engine(f"sqlite:///{DB_PATH}", echo=False, future=True)

def migrate():
    with engine.begin() as conn:
        Base.metadata.create_all(conn)
migrate()

def seed_basics():
    with Session(engine) as s:
        if not s.query(Country).count():
            s.add_all([
                Country(country="Kenya", code="KE", currency="USD", fx_to_usd=1.0),
                Country(country="Tanzania", code="TZ", currency="USD", fx_to_usd=1.0),
                Country(country="Uganda", code="UG", currency="USD", fx_to_usd=1.0),
                Country(country="Zambia", code="ZM", currency="USD", fx_to_usd=1.0),
                Country(country="Zimbabwe", code="ZW", currency="USD", fx_to_usd=1.0),
                Country(country="China", code="CN", currency="USD", fx_to_usd=1.0),
            ]); s.commit()
        if not s.query(Warehouse).count():
            s.add_all([
                Warehouse(name="China Hub", country="China", code="CN", active=True),
                Warehouse(name="Nairobi Main", country="Kenya", code="KE", active=True),
                Warehouse(name="Dar Hub", country="Tanzania", code="TZ", active=True),
                Warehouse(name="Kampala Hub", country="Uganda", code="UG", active=True),
                Warehouse(name="Lusaka Hub", country="Zambia", code="ZM", active=True),
                Warehouse(name="Harare Hub", country="Zimbabwe", code="ZW", active=True),
            ]); s.commit()
seed_basics()

def now_ts():
    return datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")

def backup_db():
    os.makedirs("backups", exist_ok=True)
    if os.path.exists(DB_PATH):
        shutil.copyfile(DB_PATH, f"backups/{now_ts()}.db")

def restore_db_ago(label):
    delta = {"5m":5*60,"30m":30*60,"12h":12*3600,"24h":24*3600,"48h":48*3600}.get(label, None)
    if delta is None: return False
    target_time = datetime.datetime.now() - datetime.timedelta(seconds=delta)
    if not os.path.exists("backups"): return False
    candidates=[]
    for fn in sorted(os.listdir("backups")):
        if not fn.endswith(".db"): continue
        try:
            dt = datetime.datetime.strptime(fn.replace(".db",""), "%Y-%m-%d_%H-%M-%S")
            if dt <= target_time:
                candidates.append((dt, fn))
        except: pass
    if not candidates: return False
    candidates.sort(key=lambda x: x[0], reverse=True)
    src = os.path.join("backups", candidates[0][1])
    shutil.copyfile(src, DB_PATH)
    return True

def countries_list(session, include_cn=False):
    q = session.query(Country).order_by(Country.code)
    if not include_cn:
        return [c for c in q.all() if c.code!="CN"]
    return q.all()

def summary_band(session):
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
    rows = session.query(PlatformSpendCurrent).all(); out={}
    for r in rows:
        cc=r.country_code
        x = out.get(cc, {"Facebook":0.0,"TikTok":0.0,"Google":0.0,"total":0.0})
        x[r.platform] = x.get(r.platform,0.0) + (r.amount_usd or 0.0)
        x["total"]=x.get("Facebook",0.0)+x.get("TikTok",0.0)+x.get("Google",0.0)
        out[cc]=x
    return out

def weekly_delivered_map(session):
    today = datetime.date.today()
    monday = today - datetime.timedelta(days=today.weekday())
    sunday = monday + datetime.timedelta(days=6)
    mon_s, sun_s = monday.isoformat(), sunday.isoformat()
    codes = [c.code for c in countries_list(session)]
    agg = {code:0 for code in codes}
    rows = session.query(DailyDelivered).filter(DailyDelivered.date>=mon_s, DailyDelivered.date<=sun_s).all()
    for r in rows:
        if r.country_code in agg: agg[r.country_code] += (r.delivered or 0)
    total = sum(agg.values()); return agg, total, mon_s, sun_s

@app.route("/", methods=["GET"])
def index():
    with Session(engine) as s:
        counts = {
            "products": s.query(Product).count(),
            "warehouses": s.query(Warehouse).count(),
            "in_transit": s.query(Shipment).filter(Shipment.status=='in_transit').count()
        }
        all_products = s.query(Product).order_by(Product.product_sku).all()
        ctrs, band = summary_band(s)
        spend_c_summary = spend_summary_by_country(s)
        cn_ke=[]; inter_items=[]
        for sh in s.query(Shipment).filter(Shipment.status=='in_transit').order_by(Shipment.id.desc()).all():
            items = s.query(ShipmentItem).filter(ShipmentItem.shipment_id==sh.id).all()
            if sh.from_country=="China" and sh.to_country=="Kenya":
                setattr(sh, "items", items); cn_ke.append(sh)
            else:
                for it in items:
                    inter_items.append(dict(
                        item_id=it.id, shipment_id=sh.id, ref=sh.ref,
                        from_country=sh.from_country, to_country=sh.to_country,
                        product_sku=it.product_sku, qty=it.qty,
                        created_date=sh.created_date, shipping_cost_usd=sh.shipping_cost_usd
                    ))
        week_map, week_total, week_from, week_to = weekly_delivered_map(s)
    return render_template("index.html",
        counts=counts, countries=ctrs, band=band, all_products=all_products,
        spend_c_summary=spend_c_summary, cn_ke=cn_ke, inter_items=inter_items,
        week_map=week_map, week_total=week_total, title="Dashboard"
    )

@app.post("/spend/current/upsert")
def upsert_current_spend():
    d = request.form
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
    backup_db(); return redirect(request.referrer or url_for("index"))

@app.post("/shipment/mark-arrived")
def mark_arrived():
    shipment_id = int(request.form.get("shipment_id"))
    with Session(engine) as s:
        sh = s.get(Shipment, shipment_id)
        if sh:
            sh.status = "arrived"; sh.arrived_date = str(datetime.date.today())
            try:
                if sh.created_date and sh.arrived_date:
                    d0 = datetime.date.fromisoformat(sh.created_date); d1 = datetime.date.fromisoformat(sh.arrived_date); sh.transit_days = (d1-d0).days
            except: sh.transit_days=0
            wh_from = s.query(Warehouse).filter(Warehouse.country==sh.from_country, Warehouse.active==True).first()
            wh_to = s.query(Warehouse).filter(Warehouse.country==sh.to_country, Warehouse.active==True).first()
            for it in s.query(ShipmentItem).filter(ShipmentItem.shipment_id==shipment_id).all():
                s.add(StockMovement(date=sh.arrived_date, product_sku=it.product_sku, from_wh=wh_from.id if wh_from else None, to_wh=wh_to.id if wh_to else None, qty=it.qty, ref=f"ARR-{sh.ref}"))
            s.commit()
    backup_db(); return redirect(request.referrer or url_for("index"))

@app.post("/shipment/create")
def create_shipment():
    d=request.form
    with Session(engine) as s:
        code_to_country = {c.code:c.country for c in s.query(Country).all()}
        from_code = d.get("from_code"); to_code = d.get("to_code")
        from_c = code_to_country.get(from_code, from_code)
        to_c = code_to_country.get(to_code, to_code)
        sh = Shipment(
            ref=d.get("ref"), from_country=from_c, to_country=to_c,
            status="in_transit", created_date=str(datetime.date.today()),
            shipping_cost_usd=float(d.get("shipping_cost_usd") or 0.0)
        )
        s.add(sh); s.flush()
        s.add(ShipmentItem(shipment_id=sh.id, product_sku=d.get("product_sku"), qty=int(d.get("qty") or 0)))
        s.commit()
    backup_db(); return redirect(request.referrer or url_for("index"))

@app.post("/shipment/item/edit")
def edit_shipment_item_qty():
    item_id = int(request.form.get("shipment_item_id")); qty = int(request.form.get("qty") or 0)
    with Session(engine) as s:
        it = s.get(ShipmentItem, item_id)
        if it:
            sh = s.get(Shipment, it.shipment_id)
            if sh and sh.status=='in_transit':
                it.qty = qty; s.commit()
    backup_db(); return redirect(request.referrer or url_for("index"))

@app.post("/shipment/item/delete")
def delete_shipment_item():
    item_id = int(request.form.get("shipment_item_id"))
    with Session(engine) as s:
        it = s.get(ShipmentItem, item_id)
        if it:
            sh = s.get(Shipment, it.shipment_id)
            if sh and sh.status=='in_transit':
                s.delete(it); s.commit()
                left = s.query(ShipmentItem).filter(ShipmentItem.shipment_id==sh.id).count()
                if left==0: s.delete(sh); s.commit()
    backup_db(); return redirect(request.referrer or url_for("index"))

@app.post("/daily-delivered/add")
def add_daily_delivered():
    d=request.form
    with Session(engine) as s:
        row = s.query(DailyDelivered).filter(DailyDelivered.date==d.get("date"), DailyDelivered.country_code==d.get("country_code")).first()
        if row: row.delivered = int(d.get("delivered") or 0)
        else: s.add(DailyDelivered(date=d.get("date"), country_code=d.get("country_code"), delivered=int(d.get("delivered") or 0)))
        s.commit()
    backup_db(); return redirect(request.referrer or url_for("index"))

@app.get("/products")
def products():
    with Session(engine) as s:
        items = s.query(Product).order_by(Product.product_sku).all()
    return render_template("products.html", products=items, title="Products")

@app.post("/product/add")
def add_product():
    d=request.form
    with Session(engine) as s:
        s.add(Product(
            product_sku=d.get("product_sku"),
            product_name=d.get("product_name"),
            category=d.get("category",""),
            weight_g=int(d.get("weight_g") or 0),
            cost_cn_usd=float(d.get("cost_cn_usd") or 0),
            default_cnke_ship_usd=float(d.get("default_cnke_ship_usd") or 0),
            profit_ads_budget_usd=float(d.get("profit_ads_budget_usd") or 0)
        )); s.commit()
    backup_db(); return redirect(url_for("products"))

@app.post("/product/delete")
def delete_product():
    sku=request.form.get("product_sku")
    with Session(engine) as s:
        s.query(PlatformSpendCurrent).filter(PlatformSpendCurrent.product_sku==sku).delete()
        s.query(ShipmentItem).filter(ShipmentItem.product_sku==sku).delete()
        s.query(StockMovement).filter(StockMovement.product_sku==sku).delete()
        s.query(PeriodRemit).filter(PeriodRemit.product_sku==sku).delete()
        s.query(ProductBudgetCountry).filter(ProductBudgetCountry.product_sku==sku).delete()
        p = s.get(Product, sku)
        if p: s.delete(p)
        s.commit()
    backup_db(); return redirect(url_for("products"))

@app.get("/product/<sku>")
def product_view(sku):
    with Session(engine) as s:
        p = s.get(Product, sku)
        if not p: flash("Product not found","error"); return redirect(url_for("products"))
        ctr_codes = [c.code for c in countries_list(s)]
        profit_rows=[]; totals=dict(pieces=0,revenue_usd=0.0,ad_usd=0.0,profit_total_usd=0.0)
        for code in ctr_codes:
            pieces, rev, ad, prof = s.query(
                func.coalesce(func.sum(PeriodRemit.pieces),0),
                func.coalesce(func.sum(PeriodRemit.revenue_usd),0.0),
                func.coalesce(func.sum(PeriodRemit.ad_usd),0.0),
                func.coalesce(func.sum(PeriodRemit.profit_total_usd),0.0)
            ).filter(PeriodRemit.product_sku==sku, PeriodRemit.country_code==code).one()
            ppu = (prof/pieces) if pieces else 0.0
            profit_rows.append(dict(country_code=code,pieces=pieces,revenue_usd=rev,ad_usd=ad,profit_total_usd=prof,profit_per_piece_usd=ppu))
            totals["pieces"]+=pieces; totals["revenue_usd"]+=rev; totals["ad_usd"]+=ad; totals["profit_total_usd"]+=prof
        profit_totals=totals
        whs = s.query(Warehouse).filter(Warehouse.active==True).all(); wh_by_id={w.id:w for w in whs}
        bal={}
        for m in s.query(StockMovement).filter(StockMovement.product_sku==sku).all():
            if m.to_wh: bal[m.to_wh]=bal.get(m.to_wh,0)+m.qty
            if m.from_wh: bal[m.from_wh]=bal.get(m.from_wh,0)-m.qty
        agg_ctry={}
        for wid,qty in bal.items():
            ctry = wh_by_id[wid].country; agg_ctry[ctry]=agg_ctry.get(ctry,0)+qty
        stock_rows=[dict(country=k, qty=v) for k,v in sorted(agg_ctry.items())]
        stock_total=sum(agg_ctry.values()) if agg_ctry else 0
        shipments=[]
        for sh in s.query(Shipment).order_by(desc(Shipment.id)).all():
            q = s.execute(select(func.sum(ShipmentItem.qty)).where(ShipmentItem.shipment_id==sh.id, ShipmentItem.product_sku==sku)).scalar() or 0
            if q>0:
                shipments.append(dict(id=sh.id, ref=sh.ref, from_country=sh.from_country, to_country=sh.to_country,
                                      status=sh.status, arrived_date=sh.arrived_date, transit_days=sh.transit_days,
                                      shipping_cost_usd=sh.shipping_cost_usd, qty_sum=q))
        countries = countries_list(s)
    return render_template("product.html",
        product=p, profit_rows=profit_rows, profit_totals=profit_totals,
        stock_rows=stock_rows, stock_total=stock_total, shipments=shipments,
        countries=countries, title=f"{p.product_sku}"
    )

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

@app.get("/performance")
def performance():
    tp = request.args.get("tp","21d"); tc = request.args.get("tc","")
    tp_from, tp_to = parse_period(tp)
    with Session(engine) as s:
        ctr_codes = [c.code for c in countries_list(s)]
        all_products = s.query(Product).order_by(Product.product_sku).all()
        qr = s.query(PeriodRemit).filter(PeriodRemit.start_date>=tp_from, PeriodRemit.end_date<=tp_to)
        if tc: qr = qr.filter(PeriodRemit.country_code==tc)
        data = qr.all(); data.sort(key=lambda r: (r.profit_total_usd or 0.0), reverse=True)
    return render_template("performance.html",
        tp=tp, tc=tc, ctr_codes=ctr_codes, all_products=all_products,
        top_report=data, remit_report=data, title="Performance"
    )

@app.post("/remit/upsert")
def upsert_period_remit():
    d=request.form
    with Session(engine) as s:
        sku = d.get("product_sku"); cc = d.get("country_code")
        pieces = int(d.get("pieces") or 0); orders = int(d.get("orders") or 0)
        revenue = float(d.get("revenue_usd") or 0.0); ad = float(d.get("ad_usd") or 0.0)
        extra_pp = float(d.get("extra_ship_per_piece_usd") or 0.0)
        prod = s.get(Product, sku)
        if not prod: flash("Product not found","error"); return redirect(url_for("performance"))
        cost_unit = float(prod.cost_cn_usd or 0.0) + float(prod.default_cnke_ship_usd or 0.0) + extra_pp
        profit_total = revenue - ad - (pieces * cost_unit)
        profit_pp = (profit_total / pieces) if pieces else 0.0
        r = PeriodRemit(
            start_date=d.get("start_date"), end_date=d.get("end_date"),
            country_code=cc, product_sku=sku, orders=orders, pieces=pieces,
            revenue_usd=revenue, ad_usd=ad, extra_ship_per_piece_usd=extra_pp,
            cost_unit_usd=cost_unit, profit_total_usd=profit_total, profit_per_piece_usd=profit_pp
        )
        s.add(r)
        wh = s.query(Warehouse).filter(Warehouse.code==cc, Warehouse.active==True).first()
        if wh and pieces>0:
            s.add(StockMovement(date=str(datetime.date.today()), product_sku=sku, from_wh=wh.id, to_wh=None, qty=pieces, ref=f"REM-{cc}"))
        s.commit()
    backup_db(); return redirect(url_for("performance"))

@app.get("/finance")
def finance():
    with Session(engine) as s:
        cats = s.query(FinanceCategory).order_by(FinanceCategory.name).all()
        items = s.query(FinanceEntry).order_by(desc(FinanceEntry.date), desc(FinanceEntry.id)).all()
    return render_template("finance.html", items=items, categories=cats, title="Finance")

@app.post("/finance/category/add")
def finance_category_add():
    name = request.form.get("name")
    with Session(engine) as s:
        if name and not s.query(FinanceCategory).filter(FinanceCategory.name==name).first():
            s.add(FinanceCategory(name=name)); s.commit()
    backup_db(); return redirect(url_for("finance"))

@app.post("/finance/add")
def finance_add():
    d=request.form
    with Session(engine) as s:
        cat_id = request.form.get("category_id")
        cat = s.get(FinanceCategory, int(cat_id)) if cat_id else None
        s.add(FinanceEntry(
            date=d.get("date"), type=d.get("type"),
            category_id=cat.id if cat else None,
            category_name=(cat.name if cat else d.get("category_name","")),
            description=d.get("description"),
            amount_usd=float(d.get("amount_usd") or 0.0)
        )); s.commit()
    backup_db(); return redirect(url_for("finance"))

@app.get("/settings")
def settings():
    with Session(engine) as s:
        countries = [c for c in s.query(Country).order_by(Country.code).all()]
        products = s.query(Product).order_by(Product.product_sku).all()
    return render_template("settings.html", countries=countries, products=products, title="Settings")

@app.post("/settings/country/add")
def add_country():
    d=request.form
    with Session(engine) as s:
        s.add(Country(country=d.get("country"), code=d.get("code"), currency=d.get("currency") or "USD", fx_to_usd=float(d.get("fx_to_usd") or 1.0)))
        s.add(Warehouse(name=f"{d.get('country')} Hub", country=d.get("country"), code=d.get("code"), active=True))
        s.commit()
    backup_db(); return redirect(url_for("settings"))

@app.post("/settings/country/delete")
def delete_country():
    code=request.form.get("code")
    with Session(engine) as s:
        if code!="CN":
            s.query(Warehouse).where(Warehouse.code==code).delete()
            s.query(Country).where(Country.code==code).delete()
            s.commit()
    backup_db(); return redirect(url_for("settings"))

@app.post("/settings/product/edit")
def edit_product_fields():
    d=request.form
    sku = d.get("product_sku")
    with Session(engine) as s:
        p = s.get(Product, sku)
        if p:
            for field in ["product_name","category","weight_g","cost_cn_usd","default_cnke_ship_usd","profit_ads_budget_usd"]:
                if field in d and d.get(field)!="":
                    val = d.get(field)
                    if field in ["weight_g"]: val=int(val)
                    if field in ["cost_cn_usd","default_cnke_ship_usd","profit_ads_budget_usd"]: val=float(val)
                    setattr(p, field, val)
            s.commit()
    backup_db(); return redirect(url_for("settings"))

@app.post("/settings/restore")
def restore_snapshot():
    label = request.form.get("ago")
    ok = restore_db_ago(label)
    if ok: flash(f"Restored snapshot: {label} ago","info")
    else: flash("No snapshot found for requested period","error")
    return redirect(url_for("settings"))

@app.get("/todo")
def todo_page():
    with Session(engine) as s:
        items = s.query(TodoItem).order_by(desc(TodoItem.id)).all()
    return render_template("todo.html", items=items, title="To-Do")

@app.post("/todo/add")
def todo_add():
    title=request.form.get("title"); day=request.form.get("weekly_day") or None
    with Session(engine) as s:
        s.add(TodoItem(title=title, status="todo", weekly_day=day, created_at=datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"))); s.commit()
    backup_db(); return redirect(request.referrer or url_for("todo_page"))

@app.post("/todo/status")
def todo_status():
    tid=int(request.form.get("id")); st=request.form.get("status")
    with Session(engine) as s:
        it=s.get(TodoItem, tid)
        if it and st in ["todo","doing","done"]:
            it.status=st; s.commit()
    backup_db(); return redirect(request.referrer or url_for("todo_page"))

@app.post("/todo/delete")
def todo_delete():
    tid=int(request.form.get("id"))
    with Session(engine) as s:
        it=s.get(TodoItem, tid)
        if it: s.delete(it); s.commit()
    backup_db(); return redirect(request.referrer or url_for("todo_page"))

if __name__ == "__main__":
    app.run(debug=True)
