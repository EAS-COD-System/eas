from sqlalchemy.orm import Session
from sqlalchemy import select, func
from models import Product, Country, Warehouse, StockMovement, PlatformSpendCurrent, Shipment, ShipmentItem, DeliveredRecord

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

    for sku in session.execute(select(Product.product_sku)).scalars().all():
        _, _, sbc = stock_balances(session, sku)
        for c, q in sbc.items():
            if c in stock:
                stock[c] += q

    for sh in session.execute(select(Shipment).where(Shipment.status=="in_transit")).scalars().all():
        qty = session.execute(select(func.sum(ShipmentItem.qty)).where(ShipmentItem.shipment_id==sh.id)).scalar() or 0
        if sh.to_country in in_transit:
            in_transit[sh.to_country] += qty

    code_to_country = {c.code: c.country for c in countries}
    rows = session.execute(select(PlatformSpendCurrent)).scalars().all()
    for r in rows:
        name = code_to_country.get((r.country_code or "").upper())
        if name in ad_spend:
            ad_spend[name] += (r.amount_usd or 0.0)
    return countries, stock, in_transit, ad_spend

def profit_snapshot_by_country(session: Session, sku: str):
    countries = session.execute(select(Country)).scalars().all()
    by_code = {c.code: c for c in countries if c.code!="CN"}
    out = []
    # revenue USD per country
    rev_usd = {code:0.0 for code in by_code}
    for r in session.execute(select(DeliveredRecord).where(DeliveredRecord.product_sku==sku)).scalars().all():
        c = by_code.get(r.country_code)
        if not c: continue
        rev_usd[r.country_code] += (r.revenue_local or 0.0) * (c.fx_to_usd or 0.0)
    # shipping & purchases: purchases are CN->KE shipments; shipping_usd per country = shipments to that country
    purchases_usd = {code:0.0 for code in by_code}
    ship_usd = {code:0.0 for code in by_code}
    for sh in session.execute(select(Shipment)).scalars().all():
        qty = session.execute(select(func.sum(ShipmentItem.qty)).where(ShipmentItem.shipment_id==sh.id, ShipmentItem.product_sku==sku)).scalar() or 0
        if qty<=0: continue
        dest_code = None
        for c in countries:
            if c.country == sh.to_country:
                dest_code = c.code
                break
        if dest_code in ship_usd:
            ship_usd[dest_code] += (sh.shipping_cost_usd or 0.0)
        # purchases from CN counted against KE by default
        if sh.from_country=="China" and sh.to_country=="Kenya":
            purchases_usd["KE"] = purchases_usd.get("KE",0.0) + (sh.purchase_cost_usd or 0.0)
    # ad spend USD per country for this product
    ad_usd = {code:0.0 for code in by_code}
    for r in session.execute(select(PlatformSpendCurrent).where(PlatformSpendCurrent.product_sku==sku)).scalars().all():
        if r.country_code in ad_usd:
            ad_usd[r.country_code] += (r.amount_usd or 0.0)
    # combine
    for code,c in by_code.items():
        val = rev_usd.get(code,0.0) - purchases_usd.get(code,0.0) - ship_usd.get(code,0.0) - ad_usd.get(code,0.0)
        out.append(type("PR",(object,),dict(code=code, rev_usd=rev_usd.get(code,0.0), purchases_usd=purchases_usd.get(code,0.0), shipping_usd=ship_usd.get(code,0.0), ad_total_usd=ad_usd.get(code,0.0), value_usd=val))())
    # all countries total
    all_tot = dict(
        rev_usd=sum(rev_usd.values()),
        purchases_usd=sum(purchases_usd.values()),
        shipping_usd=sum(ship_usd.values()),
        ad_total_usd=sum(ad_usd.values())
    )
    all_tot["value_usd"]=all_tot["rev_usd"]-all_tot["purchases_usd"]-all_tot["shipping_usd"]-all_tot["ad_total_usd"]
    return out, type("TOT",(object,),all_tot)()
