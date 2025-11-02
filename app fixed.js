// app.js — rebuilt focused on analytics fixes, transit finalize, and product row coloring
// Minimal, pragmatic build that preserves your flows and IDs in index.html/product.html.
// Auth, preload, API helper, and state

const state = {
  countries: [],
  products: [],
  remittanceSortBy: 'totaldeliveredpieces',
  remittanceSortOrder: 'desc',
  profitCountrySortBy: 'totaldeliveredpieces',
  profitCountrySortOrder: 'desc'
};

function Q(sel, root=document){ return root.querySelector(sel); }
function QA(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }
function fmt(n){ if(n===undefined||n===null||isNaN(+n)) return '0'; return (+n).toLocaleString(); }

async function api(url, options={}){
  const res = await fetch(url, { 
    headers: { 'Content-Type':'application/json' },
    credentials: 'include',
    ...options
  });
  if(!res.ok){
    const t = await res.text().catch(()=>'');
    throw new Error(t || res.statusText);
  }
  return res.json();
}

// -------- Auth ----------
async function login(){
  const pw = Q('#pw')?.value?.trim() || '';
  try{
    await api('/api/auth', { method:'POST', body: JSON.stringify({ password: pw }) });
    location.reload();
  }catch(e){
    alert('Wrong password');
  }
}
function bindAuth(){
  const btn = Q('#loginBtn');
  if(btn){ btn.onclick = login; }
  const inp = Q('#pw');
  if(inp){ inp.onkeyup = (e)=>{ if(e.key==='Enter') login(); }; }
}
async function checkAuth(){
  try{
    const me = await api('/api/auth/status');
    if(me?.ok){
      Q('#login').style.display = 'none';
      Q('#main').style.display = '';
      await preload();
      initUI();
    }else{
      Q('#login').style.display = '';
      Q('#main').style.display = 'none';
    }
  }catch{
    Q('#login').style.display = '';
    Q('#main').style.display = 'none';
  }
}

// -------- Preload meta ----------
async function preload(){
  const meta = await api('/api/meta');
  state.countries = meta.countries || [];
  state.products  = meta.products  || [];
  // Fill selects used in analytics
  const countrySel1 = Q('#remAnalyticsCountry');
  const countrySel2 = Q('#pcCountry');
  const countrySel3 = Q('#adCountry');
  const countrySel4 = Q('#spCountry');
  const productSel1 = Q('#remAnalyticsProduct');
  const productSel2 = Q('#productInfoSelect');
  const productSel3 = Q('#spProduct');
  const adProduct   = Q('#adProduct');
  [countrySel1, countrySel2, countrySel3, countrySel4].forEach(sel=>{
    if(!sel) return;
    sel.innerHTML = '<option value="">' + (sel===countrySel1?'All countries':'Select country...') + '</option>'
      + state.countries.filter(c=>c!=='china').map(c=>`<option value="${c}">${c}</option>`).join('');
  });
  [productSel1, productSel2, productSel3, adProduct].forEach(sel=>{
    if(!sel) return;
    const defaultOpt = sel===productSel1 ? '<option value="all">All products</option>' : '<option value="">Select product...</option>';
    sel.innerHTML = defaultOpt + state.products.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  });
  // Render initial tables
  renderProductsTable(); 
}

// -------- Date range helper ----------
function getDateRange(container){
  const rangeSel = container?.querySelector('.date-range-select');
  const val = rangeSel?.value || 'lifetime';
  let start='', end='';
  const today = new Date();
  const toISO = (d)=>d.toISOString().slice(0,10);
  const customStart = container?.querySelector('.custom-start')?.value;
  const customEnd   = container?.querySelector('.custom-end')?.value;

  function addDays(d, n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }

  switch(val){
    case '8days':   start = toISO(addDays(today,-7)); end = toISO(today); break;
    case '15days':  start = toISO(addDays(today,-14)); end = toISO(today); break;
    case '1month':  start = toISO(addDays(today,-30)); end = toISO(today); break;
    case '2months': start = toISO(addDays(today,-60)); end = toISO(today); break;
    case '6months': start = toISO(addDays(today,-182)); end = toISO(today); break;
    case '1year':   start = toISO(addDays(today,-365)); end = toISO(today); break;
    case '2years':  start = toISO(addDays(today,-730)); end = toISO(today); break;
    case 'lifetime':start = '2000-01-01'; end = '2100-01-01'; break;
    case 'custom':  start = customStart || '2000-01-01'; end = customEnd || '2100-01-01'; break;
  }
  return { start, end };
}

// -------- Remittance Analytics ----------
function bindRemittanceAnalytics(){
  const btn = Q('#remAnalyticsRun');
  if(!btn) return;
  btn.onclick = async () => {
    const row = btn.closest('.row');
    const dateRange = getDateRange(row);
    const country = Q('#remAnalyticsCountry')?.value || '';
    const productId = Q('#remAnalyticsProduct')?.value || 'all';
    const data = await api('/api/analytics/remittance?' + new URLSearchParams({
      ...dateRange, country, productId,
      sortBy: state.remittanceSortBy, sortOrder: state.remittanceSortOrder
    }));
    renderRemittanceAnalytics(data.analytics||[]);
  };
}
function renderRemittanceAnalytics(analytics){
  const tb = Q('#remAnalyticsBody'); if(!tb) return;
  if(!analytics.length){ tb.innerHTML = '<tr><td colspan="22" class="muted">No data</td></tr>'; return; }
  let html='';
  let totals={orders:0, delivered:0, refundedOrders:0, pieces:0, revenue:0, refunded:0, ad:0, infl:0, boxleo:0, prod:0, ship:0, aov:0, profit:0,
    boxOrd:0, boxPcs:0, adOrd:0, adPcs:0, pOrd:0, pPcs:0, cnt:0};
  analytics.forEach(x=>{
    html += `<tr>
      <td>${x.productName||'-'}</td>
      <td>${x.country||'-'}</td>
      <td>${fmt(x.totalOrders)}</td>
      <td>${fmt(x.totalDeliveredOrders)}</td>
      <td>${fmt(x.totalRefundedOrders)}</td>
      <td>${fmt(x.totalDeliveredPieces)}</td>
      <td>$${fmt(x.totalRevenue)}</td>
      <td>$${fmt(x.totalRefundedAmount)}</td>
      <td>$${fmt(x.totalAdSpend)}</td>
      <td>$${fmt(x.totalInfluencerSpend)}</td>
      <td>$${fmt(x.totalBoxleoFees)}</td>
      <td>$${fmt(x.totalProductChinaCost)}</td>
      <td>$${fmt(x.totalShippingCost)}</td>
      <td>$${fmt(x.boxleoPerDeliveredOrder)}</td>
      <td>$${fmt(x.boxleoPerDeliveredPiece)}</td>
      <td>$${fmt(x.adCostPerDeliveredOrder)}</td>
      <td>$${fmt(x.adCostPerDeliveredPiece)}</td>
      <td>$${fmt(x.profitPerOrder)}</td>
      <td>$${fmt(x.profitPerPiece)}</td>
      <td>${fmt(x.deliveryRate)}%</td>
      <td>$${fmt(x.averageOrderValue)}</td>
      <td>$${fmt(x.profit)}</td>
    </tr>`;
    totals.orders+=x.totalOrders||0;
    totals.delivered+=x.totalDeliveredOrders||0;
    totals.refundedOrders+=x.totalRefundedOrders||0;
    totals.pieces+=x.totalDeliveredPieces||0;
    totals.revenue+=x.totalRevenue||0;
    totals.refunded+=x.totalRefundedAmount||0;
    totals.ad+=x.totalAdSpend||0;
    totals.infl+=x.totalInfluencerSpend||0;
    totals.boxleo+=x.totalBoxleoFees||0;
    totals.prod+=x.totalProductChinaCost||0;
    totals.ship+=x.totalShippingCost||0;
    totals.aov+=x.averageOrderValue||0;
    totals.profit+=x.profit||0;
    totals.boxOrd+=x.boxleoPerDeliveredOrder||0;
    totals.boxPcs+=x.boxleoPerDeliveredPiece||0;
    totals.adOrd+=x.adCostPerDeliveredOrder||0;
    totals.adPcs+=x.adCostPerDeliveredPiece||0;
    totals.pOrd+=x.profitPerOrder||0;
    totals.pPcs+=x.profitPerPiece||0;
    totals.cnt++;
  });
  tb.innerHTML = html;
}

// -------- Profit by Country ----------
function bindProfitByCountry(){
  const btn = Q('#pcRun'); if(!btn) return;
  btn.onclick = async () => {
    const row = btn.closest('.row');
    const dateRange = getDateRange(row);
    const country = Q('#pcCountry')?.value || '';
    const data = await api('/api/analytics/profit-by-country?' + new URLSearchParams({
      ...dateRange, country, sortBy: state.profitCountrySortBy, sortOrder: state.profitCountrySortOrder
    }));
    renderProfitByCountry(data.analytics||[]);
  };
}
function renderProfitByCountry(items){
  const tb = Q('#profitCountryBody'); if(!tb) return;
  if(!items.length){ tb.innerHTML='<tr><td colspan="21" class="muted">No data</td></tr>'; return; }
  tb.innerHTML = items.map(x=>`<tr>
    <td>${x.country}</td>
    <td>${fmt(x.totalOrders)}</td>
    <td>${fmt(x.totalDeliveredOrders)}</td>
    <td>${fmt(x.totalRefundedOrders)}</td>
    <td>${fmt(x.totalDeliveredPieces)}</td>
    <td>$${fmt(x.totalRevenue)}</td>
    <td>$${fmt(x.totalRefundedAmount)}</td>
    <td>$${fmt(x.totalAdSpend)}</td>
    <td>$${fmt(x.totalInfluencerSpend)}</td>
    <td>$${fmt(x.totalBoxleoFees)}</td>
    <td>$${fmt(x.totalProductChinaCost)}</td>
    <td>$${fmt(x.totalShippingCost)}</td>
    <td>$${fmt(x.boxleoPerDeliveredOrder)}</td>
    <td>$${fmt(x.boxleoPerDeliveredPiece)}</td>
    <td>$${fmt(x.adCostPerDeliveredOrder)}</td>
    <td>$${fmt(x.adCostPerDeliveredPiece)}</td>
    <td>$${fmt(x.profitPerOrder)}</td>
    <td>$${fmt(x.profitPerPiece)}</td>
    <td>${fmt(x.deliveryRate)}%</td>
    <td>$${fmt(x.averageOrderValue)}</td>
    <td>$${fmt(x.profit)}</td>
  </tr>`).join('');
}

// -------- Products table + coloring ----------
async function renderProductsTable(){
  const tb = Q('#productsTable tbody'); if(!tb) return;
  if(!state.products.length){ tb.innerHTML='<tr><td class="muted">No products</td></tr>'; return; }
  // Fetch lifetime profitability map for all products (country blank = all)
  const rows = await Promise.all(state.products.map(async p=>{
    const data = await api('/api/analytics/remittance?' + new URLSearchParams({
      start:'2000-01-01', end:'2100-01-01', productId: p.id, country:''
    }));
    // aggregate profit across countries
    const profit = (data.analytics||[]).reduce((s,x)=>s+(+x.profit||0),0);
    const color = (profit>0?'profit-green': (profit<0?'profit-red':'profit-yellow'));
    return `<tr class="${color}"><td>${p.name}</td><td>${p.sku||''}</td><td><a class="btn" href="/product.html?id=${p.id}">Open</a></td></tr>`;
  }));
  tb.innerHTML = rows.join('');
}

// -------- Transit: Set Final Cost + mark Paid ----------
function bindTransitFinalize(){
  // delegate on product page tables
  document.addEventListener('click', async (e)=>{
    const el = e.target;
    if(el.dataset && el.dataset.action === 'finalize-shipment'){
      const id = el.dataset.id;
      const current = el.dataset.current || '';
      const val = prompt('Enter FINAL shipping cost (total for this shipment):', current);
      if(val===null) return;
      const amount = parseFloat(val);
      if(isNaN(amount)||amount<0){ alert('Invalid amount'); return; }
      await api('/api/shipments/'+id+'/finalize', { method:'POST', body: JSON.stringify({ finalShipCost: amount }) });
      // simple refresh of product page tables:
      location.reload();
    }
  });
}

// -------- Init ----------
function initUI(){
  // nav
  QA('nav a[data-view]').forEach(a=>{
    a.onclick = ()=>{
      QA('nav a[data-view]').forEach(x=>x.classList.remove('active'));
      a.classList.add('active');
      const view = a.getAttribute('data-view');
      QA('section').forEach(s=>s.style.display='none');
      Q('#'+view).style.display='';
    };
  });
  Q('#logoutLink')?.addEventListener('click', async ()=>{
    await api('/api/logout', { method:'POST' });
    location.reload();
  });
  // bind features
  bindRemittanceAnalytics();
  bindProfitByCountry();
  bindTransitFinalize();
}

// boot
document.addEventListener('DOMContentLoaded', ()=>{
  bindAuth();
  checkAuth();
});