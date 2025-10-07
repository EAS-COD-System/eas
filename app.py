from flask import Flask, render_template, request, redirect, url_for, flash
from sqlalchemy import create_engine, func, select, and_
from sqlalchemy.orm import Session
from models import (
    Base, Product, Country, Warehouse, StockMovement,
    PlatformSpendCurrent, Shipment, ShipmentItem, DailyDelivered,
    PeriodRemit, ProductBudgetCountry, FinanceEntry
)
import os, datetime, shutil

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY","dev")
DB_PATH = os.environ.get("DB_PATH","eas_cod.db")
engine = create_engine(f"sqlite:///{DB_PATH}", echo=False, future=True)

# --- DB bootstrap ---
with engine.begin() as conn:
    Base.metadata.create_all(conn)

# seed countries & warehouses (if empty)
with Session(engine) as s:
    if not s.query(Country).count():
        base = [
            ("Kenya","KE"),("Tanzania","TZ"),("Uganda","UG"),
            ("Zambia","ZM"),("Zimbabwe","ZW"),("China","CN")
        ]
        for name,code in base:
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

def op_countries(session):
    return [c for c in session.query(Country).order_by(Country.code) if c.code!="CN"]

# --- PAGES ---
@app.get("/")
def index():
    with Session(engine) as s:
        counts = {
            "products": s.query(Product).count(),
            "warehouses": s.query(Warehouse).count(),
            "in_transit": s.query(Shipment).filter(Shipment.status=="in_transit").count()
        }
        ctrs = op_countries(s)

        # band totals
        band = {c.country: {"code":c.code,"stock":0,"in_transit":0,"ad_spend":0.0} for c in ctrs}
        wh_by_id = {w.id:w for w in s.query(Warehouse).all()}

        for m in s.query(StockMovement).all():
            if m.to_wh:
                c = wh_by_id[m.to_wh].country
                if c in band: band[c]["stock"] += m.qty
            if m.from_wh:
                c = wh_by_id[m.from_wh].country
                if c in band: band[c]["stock"] -= m.qty

        for sh in s.query(Shipment).filter(Shipment.status=="in_transit").all():
            qty = s.execute(select(func.sum(ShipmentItem.qty)).where(ShipmentItem.shipment_id==sh.id)).scalar() or 0
            if sh.to_country in band: band[sh.to_country]["in_transit"] += qty

        code_to_country = {c.code:c.country for c in s.query(Country).all()}
        for r in s.query(PlatformSpendCurrent).all():
            name = code_to_country.get(r.country_code, r.country_code)
            if name in band: band[name]["ad_spend"] += (r.amount_usd or 0.0)

        # in-transit splits
        cn_ke = []
        inter_items = []
        for sh in s.query(Shipment).filter(Shipment.status=="in_transit").order_by(Shipment.id.desc()):
            items = s.query(ShipmentItem).filter(ShipmentItem.shipment_id==sh.id).all()
            if sh.from_country=="China" and sh.to_country=="Kenya":
                cn_ke.append((sh, items))
            else:
                for it in items:
                    inter_items.append((sh, it))

        # daily delivered recent 8 days
        today = datetime.date.today()
        dates = [(today - datetime.timedelta(days=i)).isoformat() for i in range(8)]
        ctr_codes = [c.code for c in ctrs]
        pivot=[]
        for d in dates:
            row={"date":d,"total":0}
            for code in ctr_codes: row[code]=0
            for r in s.query(DailyDelivered).filter(DailyDelivered.date==d):
                if r.country_code in row:
                    row[r.country_code]=r.delivered
                    row["total"]+=r.delivered
            pivot.append(row)

        # weekly delivered summary Mon-Sun
        week_start = today - datetime.timedelta(days=today.weekday())
        week_end = week_start + datetime.timedelta(days=6)
        ws = week_start.isoformat(); we = week_end.isoformat()
        weekly = {code:0 for code in ctr_codes}
        for r in s.query(DailyDelivered).filter(and_(DailyDelivered.date>=ws, DailyDelivered.date<=we)):
            if r.country_code in weekly: weekly[r.country_code]+=r.delivered
        weekly_total = sum(weekly.values())

        products = s.query(Product).order_by(Product.product_sku).all()
        spend_rows = s.query(PlatformSpendCurrent).all()
        spend_by_country={}
        for r in spend_rows:
            d = spend_by_country.get(r.country_code, {"Facebook":0.0,"TikTok":0.0,"Google":0.0})
            d[r.platform]=r.amount_usd or 0.0
            d["total"]=d.get("Facebook",0)+d.get("TikTok",0)+d.get("Google",0)
            spend_by_country[r.country_code]=d

    return render_template("index.html",
                           counts=counts, countries=ctrs, band=band,
                           cn_ke=cn_ke, inter_items=inter_items,
                           daily_pivot=pivot, ctr_codes=ctr_codes,
                           week_start=ws, week_end=we,
                           weekly_totals=weekly, weekly_grand=weekly_total,
                           all_products=products, spend_c_summary=spend_by_country,
                           title="Dashboard")

@app.get("/products")
def products():
    with Session(engine) as s:
        prods = s.query(Product).order_by(Product.product_sku).all()
        budgets = {}
        for b in s.query(ProductBudgetCountry).all():
            budgets.setdefault(b.product_sku, {})[b.country_code]=b.budget_usd
    return render_template("products.html", products=prods, budgets=budgets, title="Products")

@app.post("/add_product")
def add_product():
    d=request.form
    with Session(engine) as s:
        s.add(Product(
            product_sku=d["product_sku"], product_name=d["product_name"],
            category=d.get("category",""), weight_g=int(d.get("weight_g") or 0),
            cost_cn_usd=float(d.get("cost_cn_usd") or 0),
            default_cnke_ship_usd=float(d.get("default_cnke_ship_usd") or 0),
            profit_ads_budget_usd=float(d.get("profit_ads_budget_usd") or 0)
        ))
        s.commit()
    flash("Product added","ok")
    return redirect(url_for("products"))

@app.post("/delete_product")
def delete_product():
    sku = request.form.get("product_sku")
    with Session(engine) as s:
        s.query(Product).filter(Product.product_sku==sku).delete()
        s.commit()
    flash("Product deleted","ok")
    return redirect(url_for("products"))

@app.get("/product/<sku>")
def product_view(sku):
    with Session(engine) as s:
        p = s.get(Product, sku)
        if not p:
            flash("Product not found","error"); return redirect(url_for("products"))
        ctrs = op_countries(s)
        # stock by country
        whs = {w.id:w for w in s.query(Warehouse).all()}
        bal = {}
        for m in s.query(StockMovement).filter(StockMovement.product_sku==sku).all():
            if m.to_wh:   bal[m.to_wh]=bal.get(m.to_wh,0)+m.qty
            if m.from_wh: bal[m.from_wh]=bal.get(m.from_wh,0)-m.qty
        rows=[]; total=0
        for wid,qty in bal.items():
            c = whs[wid].country
            rows.append({"country": c, "qty": qty}); total+=qty

        # spend for this product
        spends = s.query(PlatformSpendCurrent).filter(PlatformSpendCurrent.product_sku==sku).all()
        spend_by_country={}
        for r in spends:
            spend_by_country.setdefault(r.country_code, []).append(r)

        # shipments for this product
        ships = []
        for sh in s.query(Shipment).order_by(Shipment.id.desc()).all():
            qty = s.execute(select(func.sum(ShipmentItem.qty)).where(
                ShipmentItem.shipment_id==sh.id, ShipmentItem.product_sku==sku
            )).scalar() or 0
            if qty>0:
                items = s.query(ShipmentItem).filter(ShipmentItem.shipment_id==sh.id,
                                                     ShipmentItem.product_sku==sku).all()
                ships.append(type("S",(object,),dict(id=sh.id, ref=sh.ref, from_country=sh.from_country,
                                                     to_country=sh.to_country, status=sh.status,
                                                     arrived_date=sh.arrived_date, transit_days=sh.transit_days,
                                                     shipping_cost_usd=sh.shipping_cost_usd, qty_sum=qty,
                                                     items=items))())

        # profits (aggregate from PeriodRemit)
        agg = {}
        for r in s.query(PeriodRemit).filter(PeriodRemit.product_sku==sku):
            a = agg.get(r.country_code, dict(pieces=0, revenue_usd=0.0, ad_usd=0.0, profit_total_usd=0.0))
            a["pieces"] += r.pieces
            a["revenue_usd"] += r.revenue_usd
            a["ad_usd"] += r.ad_usd
            a["profit_total_usd"] += r.profit_total_usd
            agg[r.country_code]=a
        rows_profit=[]
        for cc,a in agg.items():
            ppc = (a["profit_total_usd"]/a["pieces"]) if a["pieces"] else 0.0
            rows_profit.append(type("R",(object,),dict(country_code=cc, pieces=a["pieces"],
                                                       revenue_usd=a["revenue_usd"], ad_usd=a["ad_usd"],
                                                       profit_total_usd=a["profit_total_usd"],
                                                       profit_per_piece_usd=ppc))())
        totals = type("T",(object,),dict(
            pieces=sum(r.pieces for r in rows_profit),
            revenue_usd=sum(r.revenue_usd for r in rows_profit),
            ad_usd=sum(r.ad_usd for r in rows_profit),
            profit_total_usd=sum(r.profit_total_usd for r in rows_profit),
        ))()

    return render_template("product.html", product=p, countries=ctrs,
                           stock_rows=rows, stock_total=total,
                           spend_by_country=spend_by_country,
                           shipments=ships, profit_rows=rows_profit,
                           profit_totals=totals, title=p.product_name)

# Minimal stubs for other pages (templates will handle rendering)
@app.get("/performance")
def performance():
    with Session(engine) as s:
        tp = request.args.get("tp","21d")
        tc = request.args.get("tc","")
        ctr_codes = [c.code for c in op_countries(s)]
        all_products = s.query(Product).order_by(Product.product_sku).all()
        remit_report=[]; top_report=[]
    return render_template("performance.html", tp=tp, tc=tc,
                           ctr_codes=ctr_codes, all_products=all_products,
                           remit_report=remit_report, top_report=top_report,
                           title="Performance")

@app.get("/finance")
def finance():
    with Session(engine) as s:
        items=[]; months=[]; month_sum={}; sel_month=""; sel_cat=""; q=""
    return render_template("finance.html", items=items, months=months,
                           month_sum=month_sum, sel_month=sel_month,
                           sel_cat=sel_cat, q=q, title="Finance")

@app.get("/settings")
def settings():
    with Session(engine) as s:
        countries = s.query(Country).order_by(Country.code).all()
        products = s.query(Product).order_by(Product.product_sku).all()
    return render_template("settings.html", countries=countries, products=products, title="Settings")

# ---- actions used by templates (simple no-ops if not filled yet) ----
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
            amount_usd=float(d.get("amount_usd") or 0),
            country_code=d.get("country_code")
        ))
        s.commit()
    flash("Spend saved","ok")
    return redirect(request.referrer or url_for("index"))

@app.post("/add_daily_delivered")
def add_daily_delivered():
    d=request.form
    with Session(engine) as s:
        row = s.query(DailyDelivered).filter(
            DailyDelivered.date==d.get("date"),
            DailyDelivered.country_code==d.get("country_code")
        ).first()
        if row: row.delivered = int(d.get("delivered") or 0)
        else: s.add(DailyDelivered(date=d.get("date"),country_code=d.get("country_code"),
                                   delivered=int(d.get("delivered") or 0)))
        s.commit()
    flash("Daily delivered saved","ok")
    return redirect(url_for("index"))

if __name__ == "__main__":
    app.run(debug=True)
