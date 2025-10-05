
from sqlalchemy.orm import Session
from sqlalchemy import select, func
from models import Product, Country, Warehouse, StockMovement, PlatformSpendCurrent, Shipment, ShipmentItem, DeliveredRecord, ProductFinance

def stock_balances(session: Session, sku: str):
    whs = session.execute(select(Warehouse).where(Warehouse.active==True)).scalars().all()
    by_id = {w.id: w for w in whs}
    movs = session.execute(select(StockMovement).where(StockMovement.product_sku==sku)).scalars().all()
    bal_by_wh = {}
    for m in movs:
        if m.to_wh: bal_by_wh[m.to_wh] = bal_by_wh.get(m.to_wh, 0) + m.qty
        if m.from_wh: bal_by_wh[m.from_wh] = bal_by_wh.get(m.from_wh, 0) - m.qty
    by_country = {}
    for wid, qty in bal_by_wh.items():
        w = by_id.get(wid); 
        if not w: continue
        by_country[w.country] = by_country.get(w.country, 0) + qty
    return whs, bal_by_wh, by_country

def country_band(session: Session):
    countries = session.execute(select(Country)).scalars().all()
    dests = [c.country for c in countries if c.code != "CN"]
    stock = {c: 0 for c in dests}
    in_transit = {c: 0 for c in dests}
    ad_spend = {c: 0.0 for c in dests}
    # stock across products
    for sku in session.execute(select(Product.product_sku)).scalars().all():
        _, _, sbc = stock_balances(session, sku)
        for c, q in sbc.items():
            if c in stock:
                stock[c] += q
    # in-transit by destination
    for sh in session.execute(select(Shipment).where(Shipment.status=="in_transit")).scalars().all():
        qty = session.execute(select(func.sum(ShipmentItem.qty)).where(ShipmentItem.shipment_id==sh.id)).scalar() or 0
        if sh.to_country in in_transit:
            in_transit[sh.to_country] += qty
    # current spend: equal split across 5 markets
    total_current = sum([r.amount_local for r in session.execute(select(PlatformSpendCurrent)).scalars().all()])
    share = total_current / len(dests) if dests else 0.0
    for c in dests: ad_spend[c] = share
    return countries, stock, in_transit, ad_spend

def profit_snapshot(session: Session, sku: str):
    # Revenue USD from DeliveredRecord (convert using fx_to_usd)
    rev_usd = 0.0
    by_code = {c.code: c for c in session.execute(select(Country)).scalars().all()}
    for r in session.execute(select(DeliveredRecord).where(DeliveredRecord.product_sku==sku)).scalars().all():
        c = by_code.get(r.country_code)
        fx = c.fx_to_usd if c else 0.0
        rev_usd += (r.revenue_local or 0.0) * (fx or 0.0)

    # Purchases & shipping USD from shipments that include this product
    purchases_usd = 0.0
    shipping_usd = 0.0
    for sh in session.execute(select(Shipment)).scalars().all():
        qty = session.execute(select(func.sum(ShipmentItem.qty)).where(ShipmentItem.shipment_id==sh.id, ShipmentItem.product_sku==sku)).scalar() or 0
        if qty > 0:
            purchases_usd += (sh.purchase_cost_usd or 0.0)
            shipping_usd += (sh.shipping_cost_usd or 0.0)

    # Advertising total USD (manual total per product)
    pf = session.get(ProductFinance, sku)
    ad_total_usd = pf.ad_spend_total_usd if pf else 0.0

    value = rev_usd - purchases_usd - shipping_usd - ad_total_usd
    return {"rev_usd": rev_usd, "purchases_usd": purchases_usd, "shipping_usd": shipping_usd, "ad_total_usd": ad_total_usd, "value_usd": value}
