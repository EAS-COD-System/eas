import React, { useEffect, useState } from 'react';
import API from '../api';

export default function Finance(){
  const [entries,setEntries]=useState([]);
  const [balance,setBalance]=useState(0);
  const [from,setFrom]=useState('');
  const [to,setTo]=useState('');

  const load = async ()=>{
    const { data } = await API.get('/api/finance/entries',{ params: { from, to } });
    setEntries(data.entries);
    setBalance(data.balance);
  };
  useEffect(()=>{ load(); },[]);

  const add = async e=>{
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await API.post('/api/finance/entries',{
      date: fd.get('date'),
      name: fd.get('name'),
      amountUSD: Number(fd.get('amount')),
      type: fd.get('type'),
      period: fd.get('period') || undefined
    });
    e.currentTarget.reset(); load();
  };

  const remove = async id=>{ await API.delete(`/api/finance/entries/${id}`); load(); };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Finance</h1>
      <form onSubmit={add} className="card grid grid-cols-2 md:grid-cols-6 gap-2">
        <input name="date" type="date" className="input" required/>
        <input name="name" className="input" placeholder="Name" required/>
        <input name="amount" type="number" step="0.01" className="input" placeholder="Amount USD" required/>
        <select name="type" className="input"><option value="credit">Credit</option><option value="debit">Debit</option></select>
        <input name="period" className="input" placeholder="YYYY-MM"/>
        <button className="btn col-span-full">Add</button>
      </form>

      <div className="card">
        <div className="flex gap-2 mb-2">
          <input type="date" className="input" value={from} onChange={e=>setFrom(e.target.value)} />
          <input type="date" className="input" value={to} onChange={e=>setTo(e.target.value)} />
          <button className="btn" onClick={load}>Filter</button>
        </div>
        <div className="mb-2 font-medium">Balance: ${balance.toFixed(2)}</div>
        <table className="w-full text-sm">
          <thead><tr className="text-left"><th>Date</th><th>Name</th><th>Type</th><th>Amount</th><th>Actions</th></tr></thead>
          <tbody>
            {entries.map(e=>(
              <tr key={e._id}>
                <td>{new Date(e.date).toISOString().slice(0,10)}</td>
                <td>{e.name}</td>
                <td>{e.type}</td>
                <td>${e.amountUSD.toFixed(2)}</td>
                <td><button className="btn bg-red-600 hover:bg-red-700" onClick={()=>remove(e._id)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
