import React, { useEffect, useState } from 'react';
import API from '../api';

function Section({ title, children }){
  return <div className="card mb-4"><h2 className="font-semibold mb-2">{title}</h2>{children}</div>;
}

export default function Dashboard(){
  const [summary,setSummary] = useState(null);
  const [stock,setStock] = useState({stock:[],ad:[]});
  const [delivered,setDelivered] = useState([]);
  const [from,setFrom]=useState('');
  const [to,setTo]=useState('');
  const [todos,setTodos]=useState([]);
  const [weekly,setWeekly]=useState([]);
  const [profitByCountry,setPBC]=useState([]);

  const load = async ()=>{
    const [a,b,c,d,e,f] = await Promise.all([
      API.get('/api/dashboard/summary'),
      API.get('/api/dashboard/stock-by-country'),
      API.get('/api/dashboard/daily-delivered'),
      API.get('/api/tasks/todos'),
      API.get('/api/tasks/weekly'),
      API.get('/api/dashboard/profit-by-country')
    ]);
    setSummary(a.data);
    setStock(b.data);
    setDelivered(c.data);
    setTodos(d.data);
    setWeekly(e.data);
    setPBC(f.data);
  };
  useEffect(()=>{ load(); },[]);

  const addDelivered = async (e)=>{
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await API.post('/api/dashboard/daily-delivered',{
      date: fd.get('date'),
      country: fd.get('country'),
      product: fd.get('product') || null,
      delivered: Number(fd.get('delivered'))
    });
    e.currentTarget.reset();
    load();
  };

  const filterDelivered = async (e)=>{
    e.preventDefault();
    const { data } = await API.get('/api/dashboard/daily-delivered',{ params: { from, to } });
    setDelivered(data);
  };

  const addAdSpend = async (e)=>{
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await API.post('/api/dashboard/ad-spend',{
      date: fd.get('date'),
      country: fd.get('country'),
      product: fd.get('product'),
      platform: fd.get('platform'),
      amountUSD: Number(fd.get('amount'))
    });
    e.currentTarget.reset(); load();
  };

  const addTodo = async (e)=>{
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await API.post('/api/tasks/todos', { text: fd.get('text') });
    e.currentTarget.reset(); load();
  };
  const toggleTodo = async (id)=>{ await API.post(`/api/tasks/todos/${id}/toggle`); load(); };
  const delTodo = async (id)=>{ await API.delete(`/api/tasks/todos/${id}`); load(); };

  const addWeekly = async (e)=>{
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await API.post('/api/tasks/weekly',{
      weekday: Number(fd.get('weekday')),
      text: fd.get('text')
    });
    e.currentTarget.reset(); load();
  };
  const toggleWeekly = async (id)=>{ await API.post(`/api/tasks/weekly/${id}/toggle`); load(); };
  const delWeekly = async (id)=>{ await API.delete(`/api/tasks/weekly/${id}`); load(); };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Section title="1) Summary Stats">
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="card"><div className="text-sm text-gray-500">Products</div><div className="text-2xl">{summary.products}</div></div>
            <div className="card"><div className="text-sm text-gray-500">Warehouses</div><div className="text-2xl">{summary.warehouses}</div></div>
            <div className="card"><div className="text-sm text-gray-500">Transit</div><div className="text-2xl">{summary.transitShipments}</div></div>
            <div className="card"><div className="text-sm text-gray-500">Ad Spend (USD)</div><div className="text-2xl">${summary.totalAdvertisingSpendUSD.toFixed(2)}</div></div>
            <div className="card"><div className="text-sm text-gray-500">Delivered (Last 7d)</div><div className="text-2xl">{summary.totalDeliveredLast7Days}</div></div>
          </div>
        )}
      </Section>

      <Section title="2) Stock by Country + Ad Spend">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="font-medium mb-1">Stock</div>
            {stock.stock.map(s=>(<div key={s._id} className="flex justify-between border-b py-1"><span>{s._id}</span><span>{s.qty}</span></div>))}
          </div>
          <div>
            <div className="font-medium mb-1">Ad Spend (USD)</div>
            {stock.ad.map(s=>(<div key={s._id} className="flex justify-between border-b py-1"><span>{s._id}</span><span>${s.spend.toFixed(2)}</span></div>))}
          </div>
        </div>
      </Section>

      <Section title="3) Daily Delivered">
        <form onSubmit={addDelivered} className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-3">
          <input name="date" type="date" className="input" required />
          <input name="country" placeholder="CountryId or Name" className="input" required />
          <input name="product" placeholder="ProductId (optional)" className="input" />
          <input name="delivered" type="number" min="0" className="input" placeholder="Delivered" required />
          <button className="btn">Add</button>
        </form>
        <form onSubmit={filterDelivered} className="flex gap-2 mb-3">
          <input type="date" className="input" value={from} onChange={e=>setFrom(e.target.value)} />
          <input type="date" className="input" value={to} onChange={e=>setTo(e.target.value)} />
          <button className="btn">Filter</button>
        </form>
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left"><th>Date</th><th>Country</th><th>Product</th><th>Delivered</th></tr></thead>
            <tbody>
              {delivered.slice(0,8).map(d=>(
                <tr key={d._id}>
                  <td>{new Date(d.date).toISOString().slice(0,10)}</td>
                  <td>{d.country?.name || d.country}</td>
                  <td>{d.product?.name || d.product || '-'}</td>
                  <td>{d.delivered}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="4) Daily Ad Spend">
        <form onSubmit={addAdSpend} className="grid grid-cols-1 md:grid-cols-6 gap-2">
          <input name="date" type="date" className="input" required />
          <input name="country" placeholder="CountryId" className="input" required />
          <input name="product" placeholder="ProductId" className="input" required />
          <select name="platform" className="input" required>
            <option>Facebook</option><option>TikTok</option><option>Google</option>
          </select>
          <input name="amount" type="number" step="0.01" placeholder="Amount USD" className="input" required />
          <button className="btn">Add</button>
        </form>
      </Section>

      <Section title="8) Profit Summary by Country">
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-sm">
            <thead><tr><th className="text-left">Country</th><th className="text-left">Revenue</th><th className="text-left">Ad Spend</th><th className="text-left">Profit</th></tr></thead>
            <tbody>
              {profitByCountry.map(r=>(
                <tr key={r._id}><td>{r._id}</td><td>${r.revenue.toFixed(2)}</td><td>${r.adSpend.toFixed(2)}</td><td>${r.profit.toFixed(2)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="9) To-Do List">
        <form onSubmit={addTodo} className="flex gap-2 mb-2">
          <input name="text" className="input flex-1" placeholder="Task..." required />
          <button className="btn">Add</button>
        </form>
        <div className="space-y-2 max-h-64 overflow-auto">
          {todos.map(t=>(
            <div key={t._id} className="flex items-center justify-between">
              <div className={t.done?'line-through':''}>{t.text}</div>
              <div className="flex gap-2">
                <button className="btn" onClick={()=>toggleTodo(t._id)}>{t.done?'Undone':'Done'}</button>
                <button className="btn bg-red-600 hover:bg-red-700" onClick={()=>delTodo(t._id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="10) Weekly To-Do">
        <form onSubmit={addWeekly} className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
          <select name="weekday" className="input" required>
            <option value="0">Monday</option><option value="1">Tuesday</option><option value="2">Wednesday</option>
            <option value="3">Thursday</option><option value="4">Friday</option><option value="5">Saturday</option><option value="6">Sunday</option>
          </select>
          <input name="text" className="input" placeholder="Task..." required />
          <button className="btn">Add</button>
        </form>
        <div className="space-y-2 max-h-64 overflow-auto">
          {weekly.map(w=>(
            <div key={w._id} className="flex items-center justify-between">
              <div className={w.done?'line-through':''}>{w.weekday} - {w.text}</div>
              <div className="flex gap-2">
                <button className="btn" onClick={()=>toggleWeekly(w._id)}>{w.done?'Undone':'Done'}</button>
                <button className="btn bg-red-600 hover:bg-red-700" onClick={()=>delWeekly(w._id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="(Note) Sections 5–7 & 11 are handled in Product and Performance pages."></Section>
    </div>
  );
}
