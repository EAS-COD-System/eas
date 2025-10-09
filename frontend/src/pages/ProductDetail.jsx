import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import API from '../api';

function Section({ title, children }){
  return <div className="card mb-4"><h2 className="font-semibold mb-2">{title}</h2>{children}</div>;
}

export default function ProductDetail(){
  const { id } = useParams();
  const [product,setProduct]=useState(null);
  const [stock,setStock]=useState([]);
  const [shipments,setShipments]=useState([]);

  const load = async ()=>{
    const p = await API.get(`/api/products/${id}`);
    setProduct(p.data);
    const s = await API.get(`/api/products/${id}/stock`);
    setStock(s.data);
    const sh = await API.get('/api/shipments');
    setShipments(sh.data.filter(x=>x.product?._id===id || x.product===id));
  };
  useEffect(()=>{ load(); },[id]);

  const addRemit = async e=>{
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // Using performance route to store remittance
    await API.post('/api/performance/remittances',{
      date: fd.get('date'),
      product: id,
      country: fd.get('country'),
      orders: Number(fd.get('orders')),
      pieces: Number(fd.get('pieces')),
      revenueUSD: Number(fd.get('revenue')),
      adCostUSD: Number(fd.get('ad')),
      deliveryCostsUSD: Number(fd.get('delivery')),
      profitUSD: Number(fd.get('revenue')) - (Number(fd.get('ad')) + Number(fd.get('delivery')) + 0) // product cost handled in analytics
    });
    e.currentTarget.reset(); load();
  };

  const addAdSpend = async e=>{
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await API.post('/api/dashboard/ad-spend',{
      date: fd.get('date'),
      country: fd.get('country'),
      platform: fd.get('platform'),
      product: id,
      amountUSD: Number(fd.get('amount'))
    });
    e.currentTarget.reset(); load();
  };

  const addShipment = async e=>{
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await API.post('/api/shipments',{
      type: fd.get('from')==='China' && fd.get('to')==='Kenya' ? 'CN-KE' : 'OTHER',
      sourceCountry: fd.get('sourceId') || null,
      destCountry: fd.get('destId') || null,
      product: id,
      qty: Number(fd.get('qty')),
      shippingCostUSD: Number(fd.get('cost'))
    });
    e.currentTarget.reset(); load();
  };

  const markArrived = async sid=>{ await API.post(`/api/shipments/${sid}/arrive`); load(); };

  if (!product) return <div>Loading...</div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Section title="1) Country-wise stock">
        <div className="space-y-1">
          {stock.map(s=>(<div key={s._id} className="flex justify-between border-b py-1"><span>{s.country?.name||s.country}</span><span>{s.qty}</span></div>))}
        </div>
      </Section>

      <Section title="2) Product settings">
        <div className="space-y-1">
          <div>Name: {product.name}</div>
          <div>SKU: {product.sku}</div>
          <div>Cost + Ship: ${(product.costFromChina + product.shippingToKenya).toFixed(2)}</div>
          <div>Profit Target: ${product.profitTarget?.toFixed(2) || 0}</div>
          <div>Ad Budget: ${product.adBudget?.toFixed(2) || 0}</div>
        </div>
      </Section>

      <Section title="3) Daily ad spend input">
        <form onSubmit={addAdSpend} className="grid grid-cols-1 md:grid-cols-5 gap-2">
          <input name="date" type="date" className="input" required/>
          <input name="country" className="input" placeholder="CountryId" required/>
          <select name="platform" className="input" required><option>Facebook</option><option>TikTok</option><option>Google</option></select>
          <input name="amount" type="number" step="0.01" className="input" placeholder="USD" required/>
          <button className="btn">Add</button>
        </form>
      </Section>

      <Section title="4) Remittance data input">
        <form onSubmit={addRemit} className="grid grid-cols-2 md:grid-cols-7 gap-2">
          <input name="date" type="date" className="input" required/>
          <input name="country" className="input" placeholder="CountryId" required/>
          <input name="orders" type="number" className="input" placeholder="Orders" required/>
          <input name="pieces" type="number" className="input" placeholder="Pieces" required/>
          <input name="revenue" type="number" step="0.01" className="input" placeholder="Revenue USD" required/>
          <input name="ad" type="number" step="0.01" className="input" placeholder="Ad USD" required/>
          <input name="delivery" type="number" step="0.01" className="input" placeholder="Delivery USD" required/>
          <button className="btn col-span-full">Save</button>
        </form>
      </Section>

      <Section title="5–7) Shipments (China→Kenya and others)">
        <form onSubmit={addShipment} className="grid grid-cols-1 md:grid-cols-6 gap-2 mb-3">
          <input name="from" className="input" placeholder="From (e.g., China)" required/>
          <input name="to" className="input" placeholder="To (e.g., Kenya)" required/>
          <input name="sourceId" className="input" placeholder="Source CountryId (optional)" />
          <input name="destId" className="input" placeholder="Dest CountryId (optional)" />
          <input name="qty" type="number" className="input" placeholder="Qty" required/>
          <input name="cost" type="number" step="0.01" className="input" placeholder="Ship Cost USD" required/>
          <button className="btn">Add Shipment</button>
        </form>
        <div className="max-h-64 overflow-auto">
          {shipments.map(s=>(
            <div key={s._id} className="flex justify-between border-b py-1">
              <div>{s.sourceCountry?.name||''} → {s.destCountry?.name||''} | qty {s.qty} | cost ${s.shippingCostUSD?.toFixed(2) || 0} | status {s.status}</div>
              {s.status==='in_transit' && <button className="btn" onClick={()=>markArrived(s._id)}>Mark Arrived</button>}
            </div>
          ))}
        </div>
      </Section>

      <Section title="8) Full profit view is in Performance tab with filters." />
    </div>
  );
}
