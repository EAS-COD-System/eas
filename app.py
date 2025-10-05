from flask import Flask, render_template, request, redirect, url_for, flash
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session
from models import Base, Product, Country, Warehouse, StockMovement, PlatformSpendCurrent, Shipment, ShipmentItem, DeliveredRecord, ProductFinance
from calculations import stock_balances, country_band, profit_snapshot
import os, datetime

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY","devkey")
DB_PATH = os.environ.get("DB_PATH","eas_cod.db")
engine = create_engine(f"sqlite:///{DB_PATH}", echo=False, future=True)

with engine.begin() as conn:
    Base.metadata.create_all(conn)
with engine.begin() as conn:
    cols = [r[1] for r in conn.exec_driver_sql("PRAGMA table_info(platform_spend_current)").fetchall()]
    if "country_code" not in cols:
        conn.exec_driver_sql("ALTER TABLE platform_spend_current ADD COLUMN country_code TEXT")

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

@app.route("/", methods=["GET","POST"])
def index():
    q = request.form.get("q","").strip() if request.method=="POST" else request.args.get("q","").strip() if request.args.get("q") else ""
    products = []
    with Session(engine) as s:
        counts = {"products": s.query(Product).count(), "warehouses": s.query(Warehouse).count(), "in_transit": s.query(Shipment).filter(Shipment.status=="in_transit").count()}
        countries, stock_by_c, in_transit_by_c, ad_spend_by_c = country_band(s)
        band = {c.country: {"stock": stock_by_c.get(c.country,0), "in_transit": in_transit_by_c.get(c.country,0), "ad_spend": ad_spend_by_c.get(c.country,0.0)} for c in countries if c.code!="CN"}
        in_transit = []
        for sh in s.query(Shipment).filter(Shipment.status=="in_transit").all():
            qty = s.execute(select(func.sum(ShipmentItem.qty)).where(ShipmentItem.shipment_id==sh.id)).scalar() or 0
            items = s.query(ShipmentItem).filter(ShipmentItem.shipment_id==sh.id).all()
            sh.items_str = ", ".join([f"{it.product_sku}:{it.qty}" for it in items])
            sh.qty_sum = qty
            in_transit.append(sh)
        if q:
            ql = f"%{q.lower()}%"
            products = s.query(Product).filter(func.lower(Product.product_sku).like(ql) | func.lower(Product.product_name).like(ql)).limit(50).all()
    return render_template("index.html", q=q, products=products, counts=counts, countries=[c for c in countries if c.code!="CN"], band=band, in_transit=in_transit, title="Dashboard")

@app.get("/products")
def products():
    with Session(engine) as s:
        prods = s.query(Product).order_by(Product.product_sku).all()
    return render_template("products.html", products=prods, title="Products")

@app.post("/products/add")
def add_product():
    data = request.form
    try:
        with Session(engine) as s:
            if s.get(Product, data.get("product_sku")):
                flash("SKU already exists","error")
            else:
                s.add(Product(
                    product_sku=data.get("product_sku"),
                    product_name=data.get("product_name"),
                    category=data.get("category"),
                    weight_g=int(data.get("weight_g") or 0),
                    cost_cn_usd=float(data.get("cost_cn_usd") or 0.0),
                    status="active"
                )); s.commit()
                flash("Product added","ok")
    except Exception as e:
        flash(f"Error: {e}", "error")
    return redirect(url_for("products"))

@app.post("/products/delete")
def delete_product():
    sku = request.form.get("product_sku")
    try:
        with Session(engine) as s:
            p = s.get(Product, sku)
            if not p:
                flash("Not found","error")
            else:
                s.query(PlatformSpendCurrent).filter(PlatformSpendCurrent.product_sku==sku).delete()
                s.query(StockMovement).filter(StockMovement.product_sku==sku).delete()
                s.query(ShipmentItem).filter(ShipmentItem.product_sku==sku).delete()
                s.query(DeliveredRecord).filter(DeliveredRecord.product_sku==sku).delete()
                s.query(ProductFinance).filter(ProductFinance.product_sku==sku).delete()
                s.delete(p); s.commit()
                flash("Deleted","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("products"))

@app.route("/product/<sku>")
def product_view(sku):
    with Session(engine) as s:
        product = s.get(Product, sku)
        if not product:
            flash("Product not found","error")
            return redirect(url_for("products"))
        movements = s.query(StockMovement).filter(StockMovement.product_sku==sku).order_by(StockMovement.id.desc()).limit(100).all()
        current_spend = s.query(PlatformSpendCurrent).filter(PlatformSpendCurrent.product_sku==sku).all()
        shipments = []
        for sh in s.query(Shipment).all():
            qty_sum = s.execute(select(func.sum(ShipmentItem.qty)).where(ShipmentItem.shipment_id==sh.id, ShipmentItem.product_sku==sku)).scalar() or 0
            if qty_sum>0:
                sh.qty_sum = qty_sum; shipments.append(sh)
        whs, bal_by_wh, by_country = stock_balances(s, sku)
        stock = type("OBJ",(object,),{"by_country":by_country,"warehouses":{w.id:{"name":w.name,"country":w.country,"qty":bal_by_wh.get(w.id,0)} for w in whs}})()
        profit = profit_snapshot(s, sku)
        profit_obj = type("OBJ",(object,),profit)()
    return render_template("product.html", product=product, movements=movements, shipments=shipments, current_spend=current_spend, stock=stock, profit=profit_obj, title=product.product_name)

@app.post("/set_current_spend")
def set_current_spend():
    data = request.form
    try:
        with Session(engine) as s:
            s.add(PlatformSpendCurrent(
                product_sku=data.get("product_sku"),
                platform=data.get("platform"),
                amount_local=float(data.get("amount_local") or 0),
                currency=data.get("currency"),
                country_code=data.get("country_code")
            )); s.commit()
        flash("Current spend saved","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("product_view", sku=data.get("product_sku")))

@app.post("/delete_current_spend")
def delete_current_spend():
    id = int(request.form.get("id"))
    sku = request.form.get("product_sku")
    try:
        with Session(engine) as s:
            s.query(PlatformSpendCurrent).filter(PlatformSpendCurrent.id==id).delete(); s.commit()
        flash("Deleted","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("product_view", sku=sku))

@app.post("/add_stock_movement")
def add_stock_movement():
    d = request.form
    try:
        with Session(engine) as s:
            s.add(StockMovement(
                date=d.get("date"),
                product_sku=d.get("product_sku"),
                from_wh=int(d.get("from_wh")) if d.get("from_wh") else None,
                to_wh=int(d.get("to_wh")) if d.get("to_wh") else None,
                qty=int(d.get("qty")),
                ref=d.get("ref")
            )); s.commit()
        flash("Saved","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("product_view", sku=d.get("product_sku")))

@app.post("/delete_stock_movement")
def delete_stock_movement():
    id = int(request.form.get("id"))
    sku = request.form.get("product_sku")
    try:
        with Session(engine) as s:
            s.query(StockMovement).filter(StockMovement.id==id).delete(); s.commit()
        flash("Movement deleted","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("product_view", sku=sku))

@app.post("/create_purchase")
def create_purchase():
    d = request.form
    try:
        with Session(engine) as s:
            unit_cost = float(d.get("unit_cost_usd") or 0.0)
            qty = int(d.get("qty"))
            total_cost = unit_cost * qty
            sh = Shipment(ref=d.get("ref"), from_country="China", to_country="Kenya", status="in_transit",
                          created_date=str(datetime.date.today()), eta_date="", purchase_cost_usd=total_cost)
            s.add(sh); s.flush()
            s.add(ShipmentItem(shipment_id=sh.id, product_sku=d.get("product_sku"), qty=qty))
            s.commit()
        flash("Purchase created and set in transit","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("product_view", sku=d.get("product_sku")))

@app.post("/create_transfer")
def create_transfer():
    d = request.form
    try:
        with Session(engine) as s:
            from_code, to_code = d.get("from_code"), d.get("to_code")
            qty = int(d.get("qty"))
            est_ship = float(d.get("shipping_cost_usd") or 0.0)
            ref = d.get("ref")
            code_to_country = {c.code: c.country for c in s.query(Country).all()}
            sh = Shipment(ref=ref, from_country=code_to_country.get(from_code, from_code),
                          to_country=code_to_country.get(to_code, to_code), status="in_transit",
                          created_date=str(datetime.date.today()), eta_date="", shipping_cost_usd=est_ship)
            s.add(sh); s.flush()
            s.add(ShipmentItem(shipment_id=sh.id, product_sku=d.get("product_sku"), qty=qty))
            s.commit()
        flash("Transfer created and set in transit","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("product_view", sku=d.get("product_sku")))

@app.post("/mark_arrived")
def mark_arrived():
    shipment_id = int(request.form.get("shipment_id"))
    sku = request.form.get("product_sku")
    final_ship = float(request.form.get("shipping_cost_usd") or 0.0)
    try:
        with Session(engine) as s:
            sh = s.get(Shipment, shipment_id)
            if not sh:
                flash("Shipment not found","error")
            else:
                sh.status = "arrived"; sh.arrived_date = str(datetime.date.today())
                if final_ship: sh.shipping_cost_usd = final_ship
                wh_from = s.query(Warehouse).filter(Warehouse.country==sh.from_country, Warehouse.active==True).first()
                wh_to = s.query(Warehouse).filter(Warehouse.country==sh.to_country, Warehouse.active==True).first()
                qty = s.execute(select(func.sum(ShipmentItem.qty)).where(ShipmentItem.shipment_id==shipment_id, ShipmentItem.product_sku==sku)).scalar() or 0
                if qty and wh_to:
                    s.add(StockMovement(date=str(datetime.date.today()), product_sku=sku,
                                        from_wh=wh_from.id if wh_from else None, to_wh=wh_to.id, qty=qty, ref=f"ARR-{sh.ref}"))
                s.commit()
                flash("Shipment marked arrived + stock updated","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("product_view", sku=sku))

@app.post("/record_delivered")
def record_delivered():
    d = request.form
    sku = d.get("product_sku")
    try:
        qty = int(d.get("qty"))
        revenue_local = float(d.get("revenue_local") or 0.0)
        code = d.get("country_code")
        with Session(engine) as s:
            wh_to = s.query(Warehouse).filter(Warehouse.code==code, Warehouse.active==True).first()
            if not wh_to:
                flash("Warehouse for country not found","error")
            else:
                s.add(DeliveredRecord(date=str(datetime.date.today()), product_sku=sku, country_code=code, qty=qty, revenue_local=revenue_local))
                s.add(StockMovement(date=str(datetime.date.today()), product_sku=sku, from_wh=wh_to.id, to_wh=None, qty=qty, ref=f"DELIV-{code}"))
                s.commit()
                flash("Delivered recorded and stock deducted","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("product_view", sku=sku))

@app.post("/set_ad_total")
def set_ad_total():
    sku = request.form.get("product_sku")
    val = float(request.form.get("ad_total_usd") or 0.0)
    try:
        with Session(engine) as s:
            pf = s.get(ProductFinance, sku)
            if not pf:
                pf = ProductFinance(product_sku=sku, ad_spend_total_usd=val); s.add(pf)
            else:
                pf.ad_spend_total_usd = val
            s.commit()
            flash("Advertising total updated","ok")
    except Exception as e:
        flash(f"Error: {e}","error")
    return redirect(url_for("product_view", sku=sku))

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
