import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import API from '../api';

export default function Products(){
  const [items,setItems]=useState([]);
  const [open,setOpen]=useState(false);

  const load = async ()=>{
    const { data } = await API.get('/api/products');
    setItems(data);
  };
  useEffect(()=>{ load(); },[]);

  const add = async (e)=>{
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await API.post('/api/products',{
      name: fd.get('name'),
      sku: fd.get('sku'),
      costFromChina: Number(fd.get('cost')),
      shippingToKenya: Number(fd.get('ship')),
      profitTarget: Number(fd.get('profit')||0),
      adBudget: Number(fd.get('budget')||0)
    });
    e.currentTarget.reset(); setOpen(false); load();
  };

  const pause = async id=>{ await API.post(`/api/products/${id}/pause`); load(); };
  const resume = async id=>{ await API.post(`/api/products/${id}/resume`); load(); };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-xl font-semibold">Products</h1>
        <button className="btn" onClick={()=>setOpen(!open)}>{open?'Close':'Add Product'}</button>
      </div>

      {open && (
        <form onSubmit={add} className="card grid grid-cols-2 md:grid-cols-6 gap-2">
          <input name="name" className="input" placeholder="Name" required />
          <input name="sku" className="input" placeholder="SKU" required />
          <input name="cost" type="number" step="0.01" className="input" placeholder="Cost from China" required />
          <input name="ship" type="number" step="0.01" className="input" placeholder="Shipping to Kenya" required />
          <input name="profit" type="number" step="0.01" className="input" placeholder="Profit target" />
          <input name="budget" type="number" step="0.01" className="input" placeholder="Ad budget" />
          <button className="btn col-span-full">Save</button>
        </form>
      )}

      <div className="card overflow-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left"><th>Name</th><th>SKU</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {items.map(p=>(
              <tr key={p._id}>
                <td>{p.name}</td>
                <td>{p.sku}</td>
                <td>{p.paused?'Paused':'Active'}</td>
                <td className="space-x-2">
                  <Link className="btn" to={`/products/${p._id}`}>Open Product</Link>
                  {!p.paused ? <button className="btn" onClick={()=>pause(p._id)}>Pause</button> : <button className="btn" onClick={()=>resume(p._id)}>Unpause</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
