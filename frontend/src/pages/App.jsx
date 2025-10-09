import React from 'react';
import { Link, Outlet, useNavigate, useLocation } from 'react-router-dom';

const Tab = ({ to, label, active }) => (
  <Link to={to} className={`px-4 py-3 ${active?'text-green-600 font-semibold':'text-gray-700'}`}>{label}</Link>
);

export default function App(){
  const nav = useNavigate();
  const loc = useLocation();
  return (
    <div className="min-h-screen flex flex-col">
      <nav className="flex items-center justify-between px-4">
        <div className="flex items-center gap-2 py-3">
          <div className="w-3 h-3 rounded-full bg-green-500"></div>
          <span className="font-semibold">EAS Admin</span>
        </div>
        <div className="flex gap-2 text-sm">
          <Tab to="/" label="Home / Dashboard" active={loc.pathname==='/'} />
          <Tab to="/products" label="Products" active={loc.pathname.startsWith('/products') && loc.pathname==='/products'} />
          <Tab to="/performance" label="Performance" active={loc.pathname==='/performance'} />
          <Tab to="/finance" label="Finance" active={loc.pathname==='/finance'} />
          <Tab to="/settings" label="Settings" active={loc.pathname==='/settings'} />
          <button className="px-4 py-3 text-red-600" onClick={()=>{ localStorage.removeItem('token'); nav('/login'); }}>Logout</button>
        </div>
      </nav>
      <main className="p-4 bg-gray-50 flex-1">
        <Outlet/>
      </main>
    </div>
  );
}
