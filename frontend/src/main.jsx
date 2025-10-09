import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './styles.css';
import App from './pages/App.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Products from './pages/Products.jsx';
import ProductDetail from './pages/ProductDetail.jsx';
import Performance from './pages/Performance.jsx';
import Finance from './pages/Finance.jsx';
import Settings from './pages/Settings.jsx';
import NotFound from './pages/NotFound.jsx';

function Protected({ children }){
  const token = localStorage.getItem('token');
  return token ? children : <Navigate to="/login" replace />;
}

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <Routes>
      <Route path="/login" element={<Login/>} />
      <Route path="/" element={<Protected><App/></Protected>}>
        <Route index element={<Dashboard/>} />
        <Route path="products" element={<Products/>} />
        <Route path="products/:id" element={<ProductDetail/>} />
        <Route path="performance" element={<Performance/>} />
        <Route path="finance" element={<Finance/>} />
        <Route path="settings" element={<Settings/>} />
      </Route>
      <Route path="*" element={<NotFound/>} />
    </Routes>
  </BrowserRouter>
);
