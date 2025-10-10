/* EAS Tracker – client (v2)
   - Works with /api/* endpoints served by server.js
   - Matches the exact IDs/classes in your index.html
*/

// -------------- Utilities --------------
const state = { view: 'home', products: [], countries: [] };

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if (!res.ok) {
    let t = '';
    try { t = await res.text(); } catch {}
    throw new Error(t || ('HTTP ' + res.status));
  }
  return res.json();
}
const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const sum = (a) => a.reduce((x,y)=>x+(+y||0),0);
const dayName = (d) => new Date(d).toLocaleDateString(undefined, { weekday:'long' });

function setView(v){
  state.view = v;
  ['home','products','performance','finance','settings'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) el.style.display = id===v ? '' : 'none';
  });
  $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.view===v));
}

function fillSelects(){
  // countries
  const countrySelectors = [
    '#delivCountry','#adCountry','#mvFrom','#mvTo',
    '#pfCountry','#rCountry',
    '#pdAdCountry','#pdRCountry','#pdMvFrom','#pdMvTo',
    '#pdInfCountry','#pdInfFilterCountry'
  ];
  countrySelectors.forEach(sel=>{
    const el = $(sel); if (!el) return;
    const allowEmpty = el.id==='pfCountry' || el.id==='pdInfFilterCountry';
    el.innerHTML =
      (allowEmpty ? '<option value="">All countries</option>' : '') +
      (state.countries||[]).map(c=>`<option value="${c}">${c}</option>`).join('');
  });

  // products
  const productSelectors = ['#adProduct','#mvProduct','#rProduct','#lpProduct'];
  productSelectors.forEach(sel=>{
    const el = $(sel); if (!el) return;
    el.innerHTML =
      (el.id==='lpProduct' ? '<option value="">All products</option>' : '') +
      (state.products||[]).map(p=>`<option value="${p.id}">${p.name}${p.sku?` (${p.sku})`:''}</option>`).join('');
  });
}

function renderCountriesChips(){
  const wrap = $('#ctyList'); if (!wrap) return;
  wrap.innerHTML = (state.countries||[]).map(c=>`<span class="badge" style="margin-right:6px">${c}</span>`).join('');
}

// -------------- Boot / Auth --------------
async function ensureMeta(){
  try{
    const m = await api('/api/meta');
    state.countries = m.countries || [];
    await loadProducts();

    $('#login').style.display = 'none';
    $('#main').style.display  = '';
    setView(state.view);
    fillSelects();
    renderCountriesChips();
    await refreshHome();
  }catch(e){
    // not authed yet
    $('#login').style.display = '';
    $('#main').style.display  = 'none';
  }
}
async function loadProducts(){
  try{
    const r = await api('/api/products');
    state.products = r.products || [];
  }catch{ state.products = []; }
}

// -------------- Dashboard --------------
async function refreshHome(){
  // KPIs
  $('#kpiProducts').textContent  = state.products.length;
  $('#kpiCountries').textContent = (state.countries||[]).length;

  // Transit shipments
  try{
    const s = await api('/api/shipments');
    const transitCount = (s.shipments||[]).filter(x=>!x.arrivedAt).length;
    $('#kpiTransit').textContent = transitCount;
  }catch{ $('#kpiTransit').textContent = '—'; }

  // Total ad spend (lifetime)
  try{
    const a = await api('/api/adspend');
    const total = sum((a.adSpends||[]).map(x=>+x.amount||0));
    $('#kpiAdSpend').textContent = Intl.NumberFormat().format(total) + ' USD';
  }catch{ $('#kpiAdSpend').textContent = '— USD'; }

  // Delivered this week
  try{
    const w = await api('/api/deliveries/current-week');
    const total = Object.values(w.days||{}).reduce((x,y)=>x+(+y||0),0);
    $('#kpiDelivered').textContent = total;
  }catch{ $('#kpiDelivered').textContent = '—'; }

  await renderStockByCountry();
  await filterDeliveries();
  await renderShipmentsTable('china-kenya', '#shipCKTable tbody');
  await renderShipmentsTable('intercountry', '#shipICTable tbody');
}

async function renderStockByCountry(){
  const wrap = $('#stockByCountry');
  const per = {};
  (state.countries||[]).forEach(c=> per[c] = { stock:0, ad:0 });

  try{
    const ship = await api('/api/shipments');
    (ship.shipments||[]).forEach(s=>{
      if (s.arrivedAt) {
        const to = s.toCountry || s.to;
        if (!per[to]) per[to] = { stock:0, ad:0 };
        per[to].stock += (+s.qty||0);
      }
    });
  }catch{}

  try{
    const rem = await api('/api/remittances');
    (rem.remittances||[]).forEach(r=>{
      if (!per[r.country]) per[r.country] = { stock:0, ad:0 };
      per[r.country].stock -= (+r.pieces||0);
    });
  }catch{}

  try{
    const ads = await api('/api/adspend');
    (ads.adSpends||[]).forEach(a=>{
      if (!per[a.country]) per[a.country] = { stock:0, ad:0 };
      per[a.country].ad += (+a.amount||0);
    });
  }catch{}

  const rows = Object.entries(per).map(([c,v]) =>
    `<tr><td>${c}</td><td>${v.stock}</td><td>${(v.ad||0).toFixed(2)} USD</td></tr>`
  ).join('');
  wrap.innerHTML = `
    <h2>Total Stock & Ad Spend by Country</h2>
    <table class="table">
      <thead><tr><th>Country</th><th>Approx. Stock</th><th>Total Ad Spend</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ---- Deliveries ----
async function filterDeliveries(){
  const s = $('#delivStart')?.value || '';
  const e = $('#delivEnd')?.value || '';
  const tbody = $('#delivTable tbody');

  try{
    const r = await api(`/api/deliveries${(s||e)?`?start=${s}&end=${e}`:''}`);
    const list = r.deliveries || [];
    tbody.innerHTML = list.map(d=>`
      <tr><td>${d.date}</td><td>${dayName(d.date)}</td><td>${d.country}</td><td>${d.delivered}</td></tr>
    `).join('');
    $('#delivTotal').textContent = list.reduce((x,y)=>x+(+y.delivered||0),0);
  }catch{
    tbody.innerHTML = '';
    $('#delivTotal').textContent = '—';
  }
}

// ---- Shipments listing helpers ----
async function renderShipmentsTable(type, sel){
  const body = $(sel); if (!body) return;
  try{
    const r = await api('/api/shipments');
    const productsById = Object.fromEntries((state.products||[]).map(p=>[p.id,p]));
    let list = r.shipments || [];
    // normalize old/new field names
    list = list.map(s=>({
      ...s,
      fromCountry: s.fromCountry || s.from,
      toCountry:   s.toCountry   || s.to
    }));
    if (type==='china-kenya') {
      list = list.filter(s => (s.fromCountry||'').toLowerCase()==='china' && (s.toCountry||'').toLowerCase()==='kenya');
    } else {
      list = list.filter(s => !((s.fromCountry||'').toLowerCase()==='china' && (s.toCountry||'').toLowerCase()==='kenya'));
    }

    body.innerHTML = list.map(sp=>`
      <tr>
        <td>${sp.id}</td>
        <td>${productsById[sp.productId]?.name || sp.productId}</td>
        <td>${sp.fromCountry} → ${sp.toCountry}</td>
        <td>${sp.qty||0}</td>
        <td>${sp.shipCost||0}</td>
        <td>${sp.departedAt||''}</td>
        <td>${sp.arrivedAt||''}</td>
        <td>
          <button class="btn outline" data-mark="${sp.id}">Mark Arrived</button>
          <button class="btn outline" data-del="${sp.id}">Delete</button>
        </td>
      </tr>
    `).join('');

    body.querySelectorAll('[data-mark]').forEach(b => b.onclick = async ()=>{
      const d = prompt('Arrival date (YYYY-MM-DD)'); if (!d) return;
      await api('/api/shipments/'+b.dataset.mark, { method:'PUT', body: JSON.stringify({ arrivedAt:d }) });
      await renderShipmentsTable(type, sel);
      await refreshHome();
    });
    body.querySelectorAll('[data-del]').forEach(b => b.onclick = async ()=>{
      if (!confirm('Delete shipment?')) return;
      await api('/api/shipments/'+b.dataset.del, { method:'DELETE' });
      await renderShipmentsTable(type, sel);
      await refreshHome();
    });
  }catch{
    body.innerHTML = '';
  }
}

// -------------- Buttons / Forms (HOME) --------------
$('#delivAdd')?.addEventListener('click', async ()=>{
  const payload = {
    date: $('#delivDate').value,
    country: $('#delivCountry').value,
    delivered: +($('#delivCount').value||0)
  };
  if (!payload.date || !payload.country) return alert('Pick date and country');
  await api('/api/deliveries', { method:'POST', body: JSON.stringify(payload) });
  await filterDeliveries(); await refreshHome();
});
$('#delivFilter')?.addEventListener('click', filterDeliveries);

$('#adAdd')?.addEventListener('click', async ()=>{
  const payload = {
    date: $('#adDate').value,
    platform: $('#adPlatform').value,
    productId: $('#adProduct').value,
    country: $('#adCountry').value,
    amount: +($('#adAmount').value||0)
  };
  if (!payload.date || !payload.productId || !payload.country) return alert('Missing fields');
  await api('/api/adspend', { method:'POST', body: JSON.stringify(payload) });
  alert('Saved'); await refreshHome();
});

$('#mvAdd')?.addEventListener('click', async ()=>{
  const payload = {
    productId:  $('#mvProduct').value,
    fromCountry: $('#mvFrom').value,
    toCountry:   $('#mvTo').value,
    qty: +($('#mvQty').value||0),
    shipCost: +($('#mvShip').value||0),
    departedAt: new Date().toISOString().slice(0,10),
    arrivedAt: null
  };
  if (!payload.productId) return alert('Select product');
  await api('/api/shipments', { method:'POST', body: JSON.stringify(payload) });
  alert('Movement saved'); await refreshHome();
});

// Profit by country
$('#pcRun')?.addEventListener('click', async ()=>{
  const s=$('#pcStart').value, e=$('#pcEnd').value;
  const tbody = $('#profitCountryTable tbody');
  try{
    const r = await api(`/api/remittances${(s||e)?`?start=${s||''}&end=${e||''}`:''}`);
    const byC = {};
    (r.remittances||[]).forEach(x=>{
      const c = x.country;
      if (!byC[c]) byC[c] = { revenue:0, ad:0, cpd:0, pieces:0 };
      byC[c].revenue += (+x.revenue||0);
      byC[c].ad      += (+x.adSpend||0);
      byC[c].cpd     += (+x.costPerDelivery||0) * (+x.pieces||0);
      byC[c].pieces  += (+x.pieces||0);
    });
    tbody.innerHTML = Object.entries(byC).map(([c,v])=>{
      const profit = v.revenue - v.ad - v.cpd;
      return `<tr><td>${c}</td><td>${v.revenue.toFixed(2)}</td><td>${v.ad.toFixed(2)}</td><td>${v.cpd.toFixed(2)}</td><td>${v.pieces}</td><td>${profit.toFixed(2)}</td></tr>`;
    }).join('');
  }catch{
    tbody.innerHTML = '';
  }
});

// -------------- To-Do (local only) --------------
function todosLoad(){ try{return JSON.parse(localStorage.getItem('todos')||'[]')}catch{return[]} }
function todosSave(x){ localStorage.setItem('todos', JSON.stringify(x)); }
function renderTodos(){
  const list = $('#todoList'); if (!list) return;
  const items = todosLoad();
  list.innerHTML = items.map(it=>`
    <div class="flex">
      <span>${it.done?'✅ ':''}${it.text}</span>
      <button class="btn outline" data-tgl="${it.id}">${it.done?'Undo':'Done'}</button>
      <button class="btn outline" data-del="${it.id}">Delete</button>
    </div>`).join('');
  $('#todoAdd')?.addEventListener('click', ()=>{
    const t = ($('#todoText').value||'').trim(); if (!t) return;
    items.push({ id: Math.random().toString(36).slice(2), text:t, done:false });
    todosSave(items); renderTodos();
  }, { once:true });
  list.querySelectorAll('[data-tgl]').forEach(b=> b.onclick=()=>{
    const it = items.find(x=>x.id===b.dataset.tgl);
    it.done = !it.done; todosSave(items); renderTodos();
  });
  list.querySelectorAll('[data-del]').forEach(b=> b.onclick=()=>{
    const i = items.findIndex(x=>x.id===b.dataset.del);
    items.splice(i,1); todosSave(items); renderTodos();
  });
}
function renderWeekly(){
  const key='weeklyTodos';
  const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const wrap = $('#weeklyWrap'); if (!wrap) return;
  const data = JSON.parse(localStorage.getItem(key)||'{}');
  wrap.innerHTML='';
  days.forEach(day=>{
    const items = data[day]||[];
    const card = document.createElement('div'); card.className='card';
    card.innerHTML = `<div class="h">${day}</div>
      <div class="flex"><input id="w_${day}" class="input" placeholder="Task"><button class="btn">Add</button></div>
      <div class="list">${items.map(it=>`<div class="flex"><span>${it.done?'✅ ':''}${it.text}</span>
        <button class="btn outline" data-wtgl="${day}|${it.id}">${it.done?'Undo':'Done'}</button>
        <button class="btn outline" data-wdel="${day}|${it.id}">Delete</button></div>`).join('')}</div>`;
    wrap.appendChild(card);
    card.querySelector('button.btn').onclick = ()=>{
      const v = card.querySelector(`#w_${day}`).value.trim(); if (!v) return;
      items.push({ id:Math.random().toString(36).slice(2), text:v, done:false });
      data[day]=items; localStorage.setItem(key, JSON.stringify(data)); renderWeekly();
    };
  });
  wrap.querySelectorAll('[data-wtgl]').forEach(b=> b.onclick=()=>{
    const [d,id]=b.dataset.wtgl.split('|');
    const data = JSON.parse(localStorage.getItem(key)||'{}');
    const it = (data[d]||[]).find(x=>x.id===id);
    it.done=!it.done; localStorage.setItem(key, JSON.stringify(data)); renderWeekly();
  });
  wrap.querySelectorAll('[data-wdel]').forEach(b=> b.onclick=()=>{
    const [d,id]=b.dataset.wdel.split('|');
    const data = JSON.parse(localStorage.getItem(key)||'{}');
    const arr = data[d]||[]; const i = arr.findIndex(x=>x.id===id);
    arr.splice(i,1); data[d]=arr; localStorage.setItem(key, JSON.stringify(data)); renderWeekly();
  });
}

// -------------- Products --------------
$('#pAdd')?.addEventListener('click', async ()=>{
  const payload = {
    name: $('#pName').value,
    sku: $('#pSku').value,
    cost_china: +($('#pCost').value||0),
    ship_china_to_kenya: +($('#pShip').value||0),
    margin_budget: +($('#pMB').value||0)
  };
  await api('/api/products', { method:'POST', body: JSON.stringify(payload) });
  await renderProducts(); await ensureMeta();
});

async function renderProducts(){
  let res = { products:[] };
  try{ res = await api('/api/products'); }catch{}
  state.products = res.products||[];
  const tbody = $('#productsTable tbody'); if (!tbody) return;
  tbody.innerHTML = state.products.map(p=>`
    <tr>
      <td>${p.name}</td><td>${p.sku||'-'}</td>
      <td><span class="badge">${p.status||'active'}</span></td>
      <td>
        <button class="btn outline" data-pause="${p.id}">${(p.status||'active')==='active'?'Pause':'Run'}</button>
        <button class="btn outline" data-del="${p.id}">Delete</button>
      </td>
    </tr>`).join('');
  tbody.querySelectorAll('[data-pause]').forEach(b=> b.onclick = async ()=>{
    const id=b.dataset.pause; const p=state.products.find(x=>x.id===id);
    const ns = (p.status||'active')==='active' ? 'paused' : 'active';
    await api(`/api/products/${id}/status`, { method:'POST', body: JSON.stringify({ status:ns }) });
    await renderProducts();
  });
  tbody.querySelectorAll('[data-del]').forEach(b=> b.onclick = async ()=>{
    if (!confirm('Delete product?')) return;
    await api('/api/products/'+b.dataset.del, { method:'DELETE' });
    await renderProducts();
  });
}

// -------------- Performance --------------
$('#pfRun')?.addEventListener('click', async ()=>{
  // build from remittances (pieces, adSpend, approx cost = base cost * pieces)
  const s=$('#pfStart').value, e=$('#pfEnd').value, c=$('#pfCountry').value;
  try{
    const r = await api(`/api/remittances${(s||e||c)?`?${[
      s?'start='+s:'', e?'end='+e:'', c?'country='+encodeURIComponent(c):''
    ].filter(Boolean).join('&')}`:''}`);
    const productsById = Object.fromEntries((state.products||[]).map(p=>[p.id,p]));
    const agg = {};
    (r.remittances||[]).forEach(x=>{
      const pid = x.productId;
      const p = productsById[pid] || { cost_china:0, ship_china_to_kenya:0, name: pid };
      const base = (+p.cost_china||0) + (+p.ship_china_to_kenya||0);
      if (!agg[pid]) agg[pid] = { name:p.name||pid, pieces:0, ad:0, prodCost:0, profit:0 };
      agg[pid].pieces += (+x.pieces||0);
      agg[pid].ad     += (+x.adSpend||0);
      agg[pid].prodCost += base * (+x.pieces||0);
      agg[pid].profit += (+x.revenue||0) - (+x.adSpend||0) - (base * (+x.pieces||0));
    });
    const rows = Object.values(agg).sort((a,b)=>b.pieces-a.pieces).map(it=>`
      <tr><td>${it.name}</td><td>${it.pieces}</td><td>${it.ad.toFixed(2)}</td>
      <td>${it.prodCost.toFixed(2)}</td><td>${it.profit.toFixed(2)}</td>
      <td>${it.pieces? (it.profit/it.pieces).toFixed(2) : '0.00'}</td></tr>`).join('');
    $('#pfTable tbody').innerHTML = rows;
  }catch{
    $('#pfTable tbody').innerHTML = '';
  }
});

// Remittance add
$('#rAdd')?.addEventListener('click', async ()=>{
  const payload = {
    start: $('#rStart').value, end: $('#rEnd').value,
    country: $('#rCountry').value, productId: $('#rProduct').value,
    orders: +($('#rOrders').value||0), pieces: +($('#rPieces').value||0),
    revenue: +($('#rRev').value||0), adSpend: +($('#rAds').value||0),
    costPerDelivery: +($('#rCPD').value||0)
  };
  if (!payload.start || !payload.end) return alert('Select dates');
  await api('/api/remittances', { method:'POST', body: JSON.stringify(payload) });
  alert('Remittance saved'); await refreshHome();
});

// -------------- Finance --------------
async function renderFinanceCats(){
  try{
    const cats = await api('/api/finance/categories');
    $('#fcList').innerHTML = `<div>Debits: ${cats.debits.join(', ')||'-'}</div><div>Credits: ${cats.credits.join(', ')||'-'}</div>`;
  }catch{
    $('#fcList').innerHTML = `<div>Debits: -</div><div>Credits: -</div>`;
  }
}
$('#fcAdd')?.addEventListener('click', async ()=>{
  await api('/api/finance/categories', { method:'POST', body: JSON.stringify({ type:$('#fcType').value, name:$('#fcName').value }) });
  await renderFinanceCats();
});
$('#feAdd')?.addEventListener('click', async ()=>{
  const payload = {
    date: $('#feDate').value, type: $('#feType').value,
    category: $('#feCat').value, amount: +($('#feAmt').value||0),
    note: $('#feNote').value
  };
  await api('/api/finance/entries', { method:'POST', body: JSON.stringify(payload) });
  alert('Entry saved');
});
$('#feRun')?.addEventListener('click', async ()=>{
  const s=$('#fes').value, e=$('#fee').value, cats=$('#fef').value;
  try{
    const r = await api(`/api/finance/entries?start=${s||''}&end=${e||''}&categories=${encodeURIComponent(cats||'')}`);
    $('#feBalance').textContent = 'Balance: ' + (r.balance||0).toFixed(2) + ' USD';
    $('#feTable tbody').innerHTML = (r.entries||[]).map(x=>`
      <tr><td>${x.date}</td><td>${x.type}</td><td>${x.category}</td><td>${x.amount}</td><td>${x.note||''}</td></tr>`).join('');
  }catch{
    $('#feBalance').textContent='Balance: —';
    $('#feTable tbody').innerHTML='';
  }
});

// -------------- Settings --------------
$('#ctyAdd')?.addEventListener('click', async ()=>{
  const name = ($('#cty').value||'').trim(); if (!name) return;
  await api('/api/countries', { method:'POST', body: JSON.stringify({ name }) });
  const list = await api('/api/countries');
  state.countries = list.countries||[];
  fillSelects(); renderCountriesChips();
});

// Restore buttons
$$('.restore').forEach(b=> b.addEventListener('click', async ()=>{
  try{
    const res = await fetch('/api/restore', {
      method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
      body: JSON.stringify({ window: b.dataset.win })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error||'Restore failed');
    alert('Restored from: ' + data.restoredFrom);
    location.reload();
  }catch(e){
    alert('Restore error: ' + e.message);
  }
}));

// -------------- Nav + Auth buttons --------------
$$('.nav a[data-view]').forEach(a => a.addEventListener('click', (e)=>{
  e.preventDefault();
  setView(a.dataset.view);
  if (a.dataset.view==='products')  renderProducts();
  if (a.dataset.view==='finance')   renderFinanceCats();
}));

$('#logoutLink')?.addEventListener('click', async (e)=>{
  e.preventDefault();
  try{ await api('/api/logout', { method:'POST' }); }catch{}
  location.reload();
});

$('#loginBtn')?.addEventListener('click', async ()=>{
  const p = $('#pw').value;
  try{
    await api('/api/auth', { method:'POST', body: JSON.stringify({ password: p }) });
    await ensureMeta();
  }catch{
    alert('Wrong password');
  }
});

// -------------- Boot --------------
renderTodos();
renderWeekly();
ensureMeta();
