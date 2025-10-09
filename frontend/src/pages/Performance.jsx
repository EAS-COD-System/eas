import React, { useEffect, useState } from 'react';
import API from '../api';

export default function Performance(){
  const [range,setRange]=useState('8');
  const [items,setItems]=useState([]);

  const load = async ()=>{
    const { data } = await API.get('/api/performance/top-delivered',{ params: { days: range } });
    setItems(data);
  };
  useEffect(()=>{ load(); },[range]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Top Delivered Products</h1>
        <select className="input w-40" value={range} onChange={e=>setRange(e.target.value)}>
          <option value="8">Last 8 days</option>
          <option value="28">Last 28 days</option>
        </select>
      </div>
      <div className="card overflow-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left">
            <th>Product</th><th>Deliveries</th><th>Ad Spend</th><th>Revenue</th><th>Total Profit</th>
          </tr></thead>
          <tbody>
            {items.map((i,idx)=>(
              <tr key={idx}>
                <td>{i.product}</td>
                <td>{i.deliveries}</td>
                <td>${i.adSpend.toFixed(2)}</td>
                <td>${i.revenue.toFixed(2)}</td>
                <td>${i.totalProfit.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
