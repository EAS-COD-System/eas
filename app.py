import os, datetime, shutil
from flask import Flask, render_template, request, redirect, url_for, flash, Response
from sqlalchemy import create_engine, func, select, and_
from sqlalchemy.orm import Session
from models import (
    Base, Product, Country, Warehouse, StockMovement,
    PlatformSpendCurrent, Shipment, ShipmentItem, DailyDelivered,
    PeriodRemit, ProductBudgetCountry, FinanceEntry
)

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY","dev")
DB_PATH = os.environ.get("DB_PATH","eas_cod.db")
engine = create_engine(f"sqlite:///{DB_PATH}", echo=False, future=True)

# --- DB bootstrap ---
with engine.begin() as conn:
    Base.metadata.create_all(conn)

# seed baseline
with Session(engine) as s:
    if not s.query(Country).count():
        for name,code in [("Kenya","KE"),("Tanzania","TZ"),("Uganda","UG"),("Zambia","ZM"),("Zimbabwe","ZW"),("China","CN")]:
            s.add(Country(country=name, code=code, currency="USD", fx_to_usd=1.0))
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

# helpers
def op_countries(session):  # excludes China for ops dropdowns
    return [c for c in session.query(Country).order_by(Country.code) if c.code!="CN"]

def monday_of_week(d): return d - datetime.timedelta(days=d.weekday())

# ---------------- ROUTES ----------------
@app.get("/")
def index():
    with Session(engine) as s:
        counts = {
            "products": s.query(Product).count(),
            "warehouses": s.query(Warehouse).count(),
            "in_transit": s.query(Shipment).filter(Shipment.status=="in_transit").count(),
        }
        countries = op_countries(s)

        # Country band totals (Stock / In-transit / Ad spend)
        band = {c.country: {"code":c.code, "stock":0, "in_transit":0, "ad_spend":0.0} for c in countries}
        wh_by = {w.id:w for w in s.query(Warehouse).all()}

        # stock via movements
        for m in s.query(StockMovement).all():
            if m.to_wh and m.to_wh in wh_by:
                cname = wh_by[m.to_wh].country
                if cname in band: band[cname]["stock"] += m.qty
            if m.from_wh and m.from_wh in wh_by:
                cname = wh_by[m.from_wh].country
                if cname in band: band[cname]["stock"] -= m.qty

        # in-transit
        for sh in s.query(Shipment).filter(Shipment.status=="in_transit").all():
            qty = s.execute(select(func.sum(ShipmentItem.qty)).where(ShipmentItem.shipment_id==sh.id)).scalar() or 0
            if sh.to_country in band: band[sh.to_country]["in_transit"] += qty

        # ad spend current totals per country
        code_to_country = {c.code:c.country for c in s.query(Country)}
        for r in s.query(PlatformSpendCurrent).all():
            cname = code_to_country.get(r.country_code, r.country_code)
            if cname in band: band[cname]["ad_spend"] += (r.amount_usd or 0.0)

        # ad spend table (platforms + total per country)
        spend_by_country={}
        for c in countries:
            spend_by_country[c.code] = {"Facebook":0.0,"TikTok":0.0,"Google":0.0,"total":0.0}
        for r in s.query(PlatformSpendCurrent).all():
            if r.country_code not in spend_by_country:
                spend_by_country[r.country_code] = {"Facebook":0.0,"TikTok":0.0,"Google":0.0,"total":0.0}
            spend_by_country[r.country_code][r.platform] = float(r.amount_usd or 0.0)
            d = spend_by_country[r.country_code]
            d["total"] = d["Facebook"] + d["TikTok"] + d["Google"]

        # split in-transit tables
        cn_ke, inter = [], []
        for sh in s.query(Shipment).filter(Shipment.status=="in_transit").order_by(Shipment.id.desc()):
            items = s.query(ShipmentItem).filter(ShipmentItem.shipment_id==sh.id).all()
            if sh.from_country=="China" and sh.to_country=="Kenya":
                cn_ke.append((sh, items))
            else:
                for it in items:
                    inter.append((sh, it))

        # recent 8 days daily delivered
        today = datetime.date.today()
        dates = [(today - datetime.timedelta(days=i)).isoformat() for i in range(8)]
        ctr_codes = [c.code for c in countries]
        pivot=[]
        for d in dates:
            row={"date":d, "total":0}
            for code in ctr_codes: row[code]=0
            for r in s.query(DailyDelivered).filter(DailyDelivered.date==d):
                if r.country_code in row:
                    row[r.country_code]=r.delivered
                    row["total"]+=r.delivered
            pivot.append(row)

        # weekly delivered (Mon→Sun, resets every Monday)
        ws = monday_of_week(today); we = ws + datetime.timedelta(days=6)
        weekly = {code:0 for code in ctr_codes}
        for r in s.query(DailyDelivered).filter(and_(DailyDelivered.date>=ws.isoformat(), DailyDelivered.date<=we.isoformat())):
            if r.country_code in weekly: weekly[r.country_code]+=r.delivered
        weekly_total = sum(weekly.values())

        all_products = s.query(Product).order_by(Product.product_sku).all()

    return render_template("index.html",
        title="Dashboard",
        counts=counts, countries=countries, band=band,
        all_products=all_products,
        spend_c_summary=spend_by_country,
        cn_ke=cn_ke, inter_items=inter,
        ctr_codes=ctr_codes, daily_pivot=pivot,
        week_start=ws.isoformat(), week_end=we.isoformat(),
        weekly_totals=weekly, weekly_grand=weekly_total
    )

# ----- Actions (Dashboard) -----
@app.post("/upsert_current_spend")
def upsert_current_spend():
    d=request.form
    with Session(engine) as s:
        s.query(PlatformSpendCurrent).filter(
            PlatformSpendCurrent.product_sku==d.get("product_sku"),
            PlatformSpendCurrent.platform==d.get("platform"),
            PlatformSpendCurrent.country_code==d.get("country_code")
        ).delete()
        s.add(PlatformSpendCurrent(
            product_sku=d.get("product_sku"),
            platform=d.get("platform"),
            country_code=d.get("country_code"),
            amount_usd=float(d.get("amount_usd") or 0.0)
        ))
        s.commit()
    flash("Ad spend saved.","ok")
    return redirect(request.referrer or url_for("index"))

@app.post("/create_transfer_home")
def create_transfer_home():
    d = request.form
    with Session(engine) as s:
        code2name = {c.code:c.country for c in s.query(Country)}
        sh = Shipment(
            ref=d.get("ref"),
            from_country=code2name.get(d.get("from_code"), d.get("from_code")),
            to_country=code2name.get(d.get("to_code"), d.get("to_code")),
            status="in_transit",
            created_date=str(datetime.date.today()),
            shipping_cost_usd=float(d.get("shipping_cost_usd") or 0.0)
        )
        s.add(sh); s.flush()
        s.add(ShipmentItem(shipment_id=sh.id, product_sku=d.get("product_sku"), qty=int(d.get("qty") or 0)))
        s.commit()
    flash("Shipment created.","ok")
    return redirect(url_for("index"))

@app.post("/update_shipment_cost")
def update_shipment_cost():
    with Session(engine) as s:
        sh = s.get(Shipment, int(request.form["shipment_id"]))
        if not sh: flash("Shipment not found","error")
        else:
            sh.shipping_cost_usd = float(request.form.get("shipping_cost_usd") or 0.0)
            s.commit(); flash("Shipping cost updated.","ok")
    return redirect(url_for("index"))

@app.post("/delete_shipment")
def delete_shipment():
    sid = int(request.form["shipment_id"])
    with Session(engine) as s:
        sh = s.get(Shipment, sid)
        if not sh or sh.status!="in_transit":
            flash("Only in_transit shipments can be deleted.","error")
        else:
            s.query(ShipmentItem).where(ShipmentItem.shipment_id==sid).delete()
            s.delete(sh); s.commit(); flash("Shipment deleted.","ok")
    return redirect(url_for("index"))

@app.post("/edit_shipment_item_qty")
def edit_shipment_item_qty():
    itid = int(request.form["shipment_item_id"])
    qty = int(request.form.get("qty") or 0)
    with Session(engine) as s:
        it = s.get(ShipmentItem, itid)
        sh = s.get(Shipment, it.shipment_id) if it else None
        if not it or not sh or sh.status!="in_transit":
            flash("Cannot edit quantity for this item.","error")
        else:
            it.qty = qty; s.commit(); flash("Quantity updated.","ok")
    return redirect(url_for("index"))

@app.post("/delete_shipment_item")
def delete_shipment_item():
    itid = int(request.form["shipment_item_id"])
    with Session(engine) as s:
        it = s.get(ShipmentItem, itid)
        sh = s.get(Shipment, it.shipment_id) if it else None
        if not it or not sh or sh.status!="in_transit":
            flash("Cannot delete item.","error")
        else:
            s.delete(it); s.commit()
            # remove empty shipment
            left = s.query(ShipmentItem).filter(ShipmentItem.shipment_id==sh.id).count()
            if left==0:
                s.delete(sh); s.commit()
                flash("Item deleted; empty shipment removed.","ok")
            else:
                flash("Item deleted.","ok")
    return redirect(url_for("index"))

@app.post("/mark_arrived")
def mark_arrived():
    sid = int(request.form["shipment_id"])
    with Session(engine) as s:
        sh = s.get(Shipment, sid)
        if not sh: flash("Not found.","error"); return redirect(url_for("index"))
        sh.status="arrived"; sh.arrived_date=str(datetime.date.today())
        try:
            if sh.created_date: sh.transit_days = (datetime.date.fromisoformat(sh.arrived_date) - datetime.date.fromisoformat(sh.created_date)).days
        except: sh.transit_days = 0
        wf = s.query(Warehouse).filter(Warehouse.country==sh.from_country, Warehouse.active==True).first()
        wt = s.query(Warehouse).filter(Warehouse.country==sh.to_country, Warehouse.active==True).first()
        for it in s.query(ShipmentItem).filter(ShipmentItem.shipment_id==sid):
            s.add(StockMovement(date=sh.arrived_date, product_sku=it.product_sku,
                                from_wh=wf.id if wf else None, to_wh=wt.id if wt else None,
                                qty=it.qty, ref=f"ARR-{sh.ref}"))
        s.commit()
    flash("Marked arrived. Stock updated.","ok")
    return redirect(url_for("index"))

@app.post("/add_daily_delivered")
def add_daily_delivered():
    d=request.form
    with Session(engine) as s:
        row = s.query(DailyDelivered).filter(
            DailyDelivered.date==d.get("date"),
            DailyDelivered.country_code==d.get("country_code")
        ).first()
        if row: row.delivered = int(d.get("delivered") or 0)
        else: s.add(DailyDelivered(date=d.get("date"), country_code=d.get("country_code"),
                                   delivered=int(d.get("delivered") or 0)))
        s.commit()
    flash("Daily delivered saved.","ok")
    return redirect(url_for("index"))

# ---------------- Products ----------------
@app.get("/products")
def products():
    with Session(engine) as s:
        prods = s.query(Product).order_by(Product.product_sku).all()
        budgets = {}
        for b in s.query(ProductBudgetCountry).all():
            budgets.setdefault(b.product_sku, {})[b.country_code] = b.budget_usd
    return render_template("products.html", title="Products", products=prods, budgets=budgets)

@app.post("/products/add")
def add_product():
    d=request.form
    with Session(engine) as s:
        s.add(Product(
            product_sku=d["product_sku"], product_name=d["product_name"],
            category=d.get("category",""), weight_g=int(d.get("weight_g") or 0),
            cost_cn_usd=float(d.get("cost_cn_usd") or 0.0),
            default_cnke_ship_usd=float(d.get("default_cnke_ship_usd") or 0.0),
            profit_ads_budget_usd=float(d.get("profit_ads_budget_usd") or 0.0)
        ))
        s.commit()
    flash("Product added.","ok")
    return redirect(url_for("products"))

@app.post("/products/delete")
def delete_product():
    sku = request.form["product_sku"]
    with Session(engine) as s:
        s.query(ProductBudgetCountry).filter(ProductBudgetCountry.product_sku==sku).delete()
        s.query(PlatformSpendCurrent).filter(PlatformSpendCurrent.product_sku==sku).delete()
        s.query(ShipmentItem).filter(ShipmentItem.product_sku==sku).delete()
        s.query(StockMovement).filter(StockMovement.product_sku==sku).delete()
        s.query(PeriodRemit).filter(PeriodRemit.product_sku==sku).delete()
        p = s.get(Product, sku)
        if p: s.delete(p)
        s.commit()
    flash("Product deleted.","ok")
    return redirect(url_for("products"))

@app.get("/product/<sku>")
def product_view(sku):
    with Session(engine) as s:
        p = s.get(Product, sku)
        if not p: flash("Product not found","error"); return redirect(url_for("products"))
        ctrs = op_countries(s)
        wh = {w.id:w for w in s.query(Warehouse)}
        bal={}
        for m in s.query(StockMovement).filter(StockMovement.product_sku==sku):
            if m.to_wh: bal[m.to_wh]=bal.get(m.to_wh,0)+m.qty
            if m.from_wh: bal[m.from_wh]=bal.get(m.from_wh,0)-m.qty
        stock_rows=[]; total=0
        for wid,qty in bal.items():
            cname = wh[wid].country
            stock_rows.append({"country":cname, "qty":qty}); total+=qty

        spends = {}
        for r in s.query(PlatformSpendCurrent).filter(PlatformSpendCurrent.product_sku==sku):
            spends.setdefault(r.country_code, []).append(r)

        ships=[]
        for sh in s.query(Shipment).order_by(Shipment.id.desc()):
            items = s.query(ShipmentItem).filter(ShipmentItem.shipment_id==sh.id, ShipmentItem.product_sku==sku).all()
            if not items: continue
            qty_sum = sum(it.qty for it in items)
            ships.append(type("S",(object,),dict(
                id=sh.id, ref=sh.ref, from_country=sh.from_country, to_country=sh.to_country,
                status=sh.status, arrived_date=sh.arrived_date, transit_days=sh.transit_days,
                shipping_cost_usd=sh.shipping_cost_usd, qty_sum=qty_sum, items=items
            ))())

        agg={}
        for r in s.query(PeriodRemit).filter(PeriodRemit.product_sku==sku):
            a = agg.get(r.country_code, dict(pieces=0,revenue_usd=0.0,ad_usd=0.0,profit_total_usd=0.0))
            a["pieces"] += r.pieces
            a["revenue_usd"] += r.revenue_usd
            a["ad_usd"] += r.ad_usd
            a["profit_total_usd"] += r.profit_total_usd
            agg[r.country_code]=a
        rows_profit=[]; totals=dict(pieces=0,revenue_usd=0.0,ad_usd=0.0,profit_total_usd=0.0)
        for cc,a in agg.items():
            ppp = (a["profit_total_usd"]/a["pieces"]) if a["pieces"] else 0.0
            rows_profit.append(type("R",(object,),dict(country_code=cc, **a, profit_per_piece_usd=ppp))())
            for k in totals: totals[k]+=a.get(k,0.0)

    return render_template("product.html",
        title=p.product_name, product=p, countries=ctrs,
        stock_rows=stock_rows, stock_total=total,
        spend_by_country=spends, shipments=ships,
        profit_rows=rows_profit, profit_totals=type("T",(object,),totals)()
    )

# ---------------- Performance (kept simple) ----------------
@app.get("/performance")
def performance():
    with Session(engine) as s:
        tp = request.args.get("tp","21d")
        tc = request.args.get("tc","")
        ctr_codes = [c.code for c in op_countries(s)]
        all_products = s.query(Product).order_by(Product.product_sku).all()
        remit_report=[]; top_report=[]
    return render_template("performance.html", title="Performance",
                           ctr_codes=ctr_codes, tp=tp, tc=tc,
                           top_report=top_report, remit_report=remit_report,
                           all_products=all_products)

# ---------------- Finance (kept simple) ----------------
@app.get("/finance")
def finance():
    with Session(engine) as s:
        items=[]; months=[]; month_sum={}; sel_month=""; sel_cat=""; q=""
    return render_template("finance.html", title="Finance",
                           items=items, months=months, month_sum=month_sum,
                           sel_month=sel_month, sel_cat=sel_cat, q=q)

# ---------------- Settings ----------------
@app.get("/settings")
def settings():
    with Session(engine) as s:
        return render_template("settings.html", title="Settings",
                               countries=s.query(Country).order_by(Country.code).all(),
                               products=s.query(Product).order_by(Product.product_sku).all())

@app.post("/settings/add_country")
def add_country():
    d=request.form
    with Session(engine) as s:
        code = d.get("code","").upper()
        name = d.get("country","").strip()
        curr = d.get("currency","USD").upper()
        fx = float(d.get("fx_to_usd") or 1.0)
        s.add(Country(country=name, code=code, currency=curr, fx_to_usd=fx))
        s.add(Warehouse(name=f"{name} Hub", country=name, code=code, active=True))
        s.commit()
    flash("Country added. It now appears in daily spend and all dropdowns.","ok")
    return redirect(url_for("settings"))

@app.post("/settings/delete_country")
def delete_country():
    with Session(engine) as s:
        cid = int(request.form["id"])
        c = s.get(Country, cid)
        if not c: flash("Not found","error")
        else:
            s.query(PlatformSpendCurrent).filter(PlatformSpendCurrent.country_code==c.code).delete()
            s.query(ProductBudgetCountry).filter(ProductBudgetCountry.country_code==c.code).delete()
            s.query(Warehouse).filter(Warehouse.code==c.code).delete()
            s.delete(c); s.commit(); flash("Country deleted.","ok")
    return redirect(url_for("settings"))

if __name__ == "__main__":
    app.run(debug=True)
