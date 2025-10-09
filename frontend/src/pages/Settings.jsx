import React, { useEffect, useState } from 'react';
import API from '../api';

export default function Settings(){
  const [countries,setCountries]=useState([]);
  const [productId,setProductId]=useState('');

  const load = async ()=>{
    const { data } = await API.get('/api/settings/countries');
    setCountries(data);
  };
  useEffect(()=>{ load(); },[]);

  const addCountry = async e=>{
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await API.post('/api/settings/countries',{ name: fd.get('name') });
    e.currentTarget.reset(); load();
  };
  const delCountry = async id=>{ await API.delete('/api/settings/countries/'+id); load(); };

  const updateProduct = async e=>{
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await API.patch('/api/settings/products/'+productId,{
      name: fd.get('name')||undefined,
      sku: fd.get('sku')||undefined,
      costFromChina: fd.get('cost')?Number(fd.get('cost')):undefined,
      shippingToKenya: fd.get('ship')?Number(fd.get('ship')):undefined,
      profitTarget: fd.get('profit')?Number(fd.get('profit')):undefined,
      adBudget: fd.get('budget')?Number(fd.get('budget')):undefined
    });
    e.currentTarget.reset(); alert('Updated');
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>

      <div className="card">
        <h2 className="font-semibold mb-2">1) Countries</h2>
        <form onSubmit={addCountry} className="flex gap-2 mb-2">
          <input name="name" className="input" placeholder="Country name" required />
          <button className="btn">Add</button>
        </form>
        <div className="space-y-1">
          {countries.map(c=>(
            <div key={c._id} className="flex justify-between">
              <div>{c.name}</div>
              <button className="btn bg-red-600 hover:bg-red-700" onClick={()=>delCountry(c._id)}>Delete</button>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-2">2) Edit Product Info</h2>
        <form onSubmit={updateProduct} className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <input placeholder="Product ID" className="input" value={productId} onChange={e=>setProductId(e.target.value)} />
          <input name="name" className="input" placeholder="Name" />
          <input name="sku" className="input" placeholder="SKU" />
          <input name="cost" className="input" placeholder="Cost from China" />
          <input name="ship" className="input" placeholder="Ship to Kenya" />
          <input name="profit" className="input" placeholder="Profit target" />
          <input name="budget" className="input" placeholder="Ad budget" />
          <button className="btn col-span-full">Update</button>
        </form>
      </div>
    </div>
  );
}
