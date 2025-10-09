import React, { useState } from 'react';
import API from '../api';

export default function Login(){
  const [username, setU] = useState('eas');
  const [password, setP] = useState('easnew');
  const [error, setError] = useState('');
  const submit = async (e)=>{
    e.preventDefault();
    try{
      const { data } = await API.post('/api/auth/login',{ username, password });
      localStorage.setItem('token', data.token);
      window.location.href='/';
    }catch(err){
      setError(err.response?.data?.message || 'Login failed');
    }
  };
  return (
    <div className="min-h-screen grid place-items-center bg-gray-50">
      <form onSubmit={submit} className="card w-full max-w-sm">
        <h1 className="text-xl font-semibold mb-4">Login</h1>
        <label className="text-sm text-gray-600">Username</label>
        <input className="input mb-3" value={username} onChange={e=>setU(e.target.value)} />
        <label className="text-sm text-gray-600">Password</label>
        <input type="password" className="input mb-4" value={password} onChange={e=>setP(e.target.value)} />
        {error && <div className="text-red-600 text-sm mb-3">{error}</div>}
        <button className="btn w-full">Login</button>
      </form>
    </div>
  );
}
