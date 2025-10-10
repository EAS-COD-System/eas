// =================== utilities ===================
const state = {
  view: 'home',
  countries: [],
  products: []
};

const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if (!res.ok) {
    let text = '';
    try { text = await res.text(); } catch {}
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

function setView(v) {
  state.view = v;
  ['home','products','performance','finance','settings'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = id === v ? '' : 'none';
  });
  $$('.nav a[data-view]').forEach(a => a.classList.toggle('active', a.dataset.view === v));
}

function weekdayName(dateStr){
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { weekday: 'long' });
}

const sum = (arr) => arr.reduce((a,b)=>a+(+b||0),0);

// =================== bootstrap/auth ===================
async function ensureMeta() {
  try {
    const m = await api('/api/meta');        // { countries: [...] }
    state.countries = m.countries || [];
    await loadProducts();

    // hide login, show app
    const login = $('#login');   if (login)  login.style.display  = 'none';
    const main  = $('#main');    if (main)   main.style.display   = '';

    fillSelects();
    renderCountries();
    setView(state.view);
    await refreshHome();

    // Finance initial paint (so the box isn't empty)
    if (state.view === 'finance') { await renderFinanceCats(); await runFinanceEntries(); }
  } catch {
    // not authed
    const login = $('#login');   if (login)  login.style.display  = '';
    const main  = $('#main');    if (main)   main.style.display   = 'none';
    setView('home');
  }
}

async function loadProducts() {
  try {
    const r = await api('/api/products');
    state.products = r.products || [];
  } catch {
    state.products = [];
  }
}

function fillSelects() {
  // countries selects (only fill if element exists)
  const countrySel = [
    '#delivCountry','#adCountry','#mvFrom','#mvTo',
    '#pfCountry','#rCountry','#pdAdCountry',
    '#pdRCountry','#pdMvFrom','#pdMvTo','#pdInfCountry','#pdInfFilterCountry'
  ].join(',');
  $$(countrySel).forEach(sel => {
    if (!sel) return;
    sel.innerHTML = state.countries.map(c => `<option value="${c}">${c}</option>`).join('');
    // add "All countries" on filters that expect it
    if (sel.id === 'pfCountry' || sel.id === 'pdInfFilterCountry') {
      sel.insertAdjacentHTML('afterbegin', `<option value="">All countries</option>`);
      sel.value = '';
    }
  });

  // products selects
  const productSel = ['#adProduct','#mvProduct','#rProduct','#lpProduct'].join(',');
  $$(productSel).forEach(sel => {
    if (!sel) return;
    sel.innerHTML = state.products.map(p => `<option value="${p.id}">${p.name}${p.sku?` (${p.sku})`:''}</option>`).join('');
    // add "All products" where relevant
    if (sel.id === 'lpProduct') {
      sel.insertAdjacentHTML('afterbegin', `<option value="">All products</option>`);
      sel.value = '';
    }
  });
}

function renderCountries(){
  const list = $('#ctyList');
  if (list) list.innerHTML = (state.countries||[]).map(c=> `<span class="badge" style="margin-right:6px">${c}</span>`).join('');
}

// =================== HOME (dashboard) ===================
async function refreshHome() {
  // KPIs
  $('#kpiProducts')  && ($('#kpiProducts').textContent  = state.products.length);
  $('#kpiCountries') && ($('#kpiCountries').textContent = state.countries.length);

  // Transit shipments (count open)
  try {
    const s = await api('/api/shipments');
    const openCount = (s.shipments||[]).filter(x => !x.arrivedAt).length;
    $('#kpiTransit') && ($('#kpiTransit').textContent = openCount);
  } catch { $('#kpiTransit') && ($('#kpiTransit').textContent = '—'); }

  // Total Ad Spend (all products/all countries, overwrite model)
  try {
    const a = await api('/api/adspend');
    const total = sum((a.adSpends||[]).map(x => +x.amount||0));
    $('#kpiAdSpend') && ($('#kpiAdSpend').textContent = Intl.NumberFormat().format(total) + ' USD');
  } catch { $('#kpiAdSpend') && ($('#kpiAdSpend').textContent = '—'); }

  // Delivered (Mon–Sun): compute current week total from /api/deliveries
  try {
    const d = await api('/api/deliveries');
    const now = new Date();
    const monday = (dt => { const t = new Date(dt); const w = t.getDay(); const delta = (w+6)%7; t.setDate(t.getDate()-delta); t.setHours(0,0,0,0); return t; })(now);
    const sunday = (dt => { const t = new Date(dt); t.setDate(t.getDate()+6); t.setHours(23,59,59,999); return t; })(monday);
    const inWeek = (x) => {
      const ts = new Date(x.date).getTime();
      return ts >= monday.getTime() && ts <= sunday.getTime();
    };
    const totalWeek = (d.deliveries||[]).filter(inWeek).reduce((a,b)=>a+(+b.delivered||0),0);
    $('#kpiDelivered') && ($('#kpiDelivered').textContent = totalWeek);
  } catch { $('#kpiDelivered') && ($('#kpiDelivered').textContent = '—'); }

  await renderStockByCountry();
  await filterDeliveries();
  await renderShipmentsTable('china-kenya', '#shipCKTable tbody');
  await renderShipmentsTable('intercountry', '#shipICTable tbody');
}

async function renderStockByCountry(){
  const wrap = $('#stockByCountry');
  if (!wrap) return;

  // base map
  const per = {};
  state.countries.forEach(c => per[c] = { stock:0, ad:0 });

  // add arrived shipments as stock at destination
  try {
    const s = await api('/api/shipments'); // [{fromCountry,toCountry,qty,arrivedAt,shipCost,...}]
    (s.shipments||[]).forEach(sp => {
      if (sp.arrivedAt) {
        const to = sp.toCountry || sp.to;
        if (!to) return;
        if (!per[to]) per[to] = { stock:0, ad:0 };
        per[to].stock += (+sp.qty||0);
      }
    });
  } catch {}

  // subtract remitted pieces
  try {
    const r = await api('/api/remittances'); // [{country,pieces,revenue,adSpend,...}]
    (r.remittances||[]).forEach(rec => {
      if (!per[rec.country]) per[rec.country] = { stock:0, ad:0 };
      per[rec.country].stock -= (+rec.pieces||0);
    });
  } catch {}

  // add ad spends per country
  try {
    const a = await api('/api/adspend');
    (a.adSpends||[]).forEach(ad => {
      if (!per[ad.country]) per[ad.country] = { stock:0, ad:0 };
      per[ad.country].ad += (+ad.amount||0);
    });
  } catch {}

  const rows = Object.entries(per).map(([c,v]) =>
    `<tr><td>${c}</td><td>${v.stock}</td><td>${(v.ad||0).toFixed(2)} USD</td></tr>`
  ).join('');

  // totals row
  const tStock = Object.values(per).reduce((a,b)=>a+(+b.stock||0),0);
  const tAd    = Object.values(per).reduce((a,b)=>a+(+b.ad||0),0);

  wrap.innerHTML = `
    <h2>Total Stock & Ad Spend by Country</h2>
    <table class="table">
      <thead><tr><th>Country</th><th>Approx. Stock</th><th>Total Ad Spend</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th>All Countries</th><th>${tStock}</th><th>${tAd.toFixed(2)} USD</th></tr></tfoot>
    </table>
  `;
}

// ---- Deliveries list (filter by date range) ----
async function filterDeliveries(){
  const s = $('#delivStart')?.value || '';
  const e = $('#delivEnd')?.value || '';
  const tbody = $('#delivTable tbody'); if (!tbody) return;

  try{
    const r = await api('/api/deliveries'); // we have no date filter server-side now; filter client-side
    let list = r.deliveries || [];
    if (s) list = list.filter(x => x.date >= s);
    if (e) list = list.filter(x => x.date <= e);
    // show only last 8 rows if no filter (to keep it short)
    if (!s && !e && list.length > 8) list = list.slice(-8);

    tbody.innerHTML = list.map(d => `
      <tr><td>${d.date}</td><td>${weekdayName(d.date)}</td><td>${d.country}</td><td>${d.delivered}</td></tr>
    `).join('');

    $('#delivTotal') && ($('#delivTotal').textContent = list.reduce((a,b)=>a+(+b.delivered||0),0));
  }catch{
    tbody.innerHTML = '';
    $('#delivTotal') && ($('#delivTotal').textContent = '—');
  }
}

// Add delivered
function wireDeliveries() {
  $('#delivAdd') && ($('#delivAdd').onclick = async ()=>{
    const date     = $('#delivDate')?.value;
    const country  = $('#delivCountry')?.value;
    const delivered= +($('#delivCount')?.value || 0);
    if (!date || !country) return alert('Pick date & country');
    await api('/api/deliveries', { method:'POST', body: JSON.stringify({ date, country, delivered }) });
    await filterDeliveries(); await refreshHome();
  });
  $('#delivFilter') && ($('#delivFilter').onclick = filterDeliveries);
}

// ---- Daily ad spend (overwrite per product+country+platform) ----
function wireAdSpend(){
  $('#adAdd') && ($('#adAdd').onclick = async ()=>{
    const payload = {
      // If you removed date in HTML, this will just be undefined and ignored by server
      date: $('#adDate')?.value || undefined,
      platform: $('#adPlatform')?.value,
      productId: $('#adProduct')?.value,
      country: $('#adCountry')?.value,
      amount: +($('#adAmount')?.value || 0)
    };
    if (!payload.productId || !payload.country || !payload.platform) return alert('Missing fields');
    await api('/api/adspend', { method:'POST', body: JSON.stringify(payload) });
    alert('Saved');
    await refreshHome();
  });
}

// ---- Stock movement (create shipment; arrivedAt null by default) ----
function wireMovement(){
  $('#mvAdd') && ($('#mvAdd').onclick = async ()=>{
    const payload = {
      productId: $('#mvProduct')?.value,
      fromCountry: $('#mvFrom')?.value,
      toCountry: $('#mvTo')?.value,
      qty: +($('#mvQty')?.value || 0),
      shipCost: +($('#mvShip')?.value || 0),
      departedAt: new Date().toISOString().slice(0,10),
      arrivedAt: null
    };
    if (!payload.productId || !payload.fromCountry || !payload.toCountry) return alert('Fill all fields');
    await api('/api/shipments', { method:'POST', body: JSON.stringify(payload) });
    await refreshHome();
  });
}

// ---- Shipments tables (dashboard) ----
async function renderShipmentsTable(type, sel){
  const body = $(sel); if (!body) return;

  try {
    const r = await api('/api/shipments');
    const productsById = Object.fromEntries((state.products||[]).map(p=>[p.id,p]));
    let list = r.shipments || [];

    // filter for tables
    const isCK = (sp) => {
      const f = (sp.fromCountry||sp.from||'').toLowerCase();
      const t = (sp.toCountry||sp.to||'').toLowerCase();
      return f === 'china' && t === 'kenya';
    };
    if (type === 'china-kenya') list = list.filter(isCK);
    else list = list.filter(sp => !isCK(sp));

    // show only not-arrived (as per request to disappear from home when arrived)
    list = list.filter(sp => !sp.arrivedAt);

    body.innerHTML = list.map(sp => `
      <tr>
        <td>${sp.id}</td>
        <td>${productsById[sp.productId]?.name || sp.productId}</td>
        <td>${(sp.fromCountry||sp.from)} → ${(sp.toCountry||sp.to)}</td>
        <td>${sp.qty || 0}</td>
        <td>${(+sp.shipCost||0).toFixed(2)}</td>
        <td>${sp.departedAt || ''}</td>
        <td>${sp.arrivedAt || ''}</td>
        <td>
          <button class="btn outline" data-mark="${sp.id}">Mark Arrived</button>
          <button class="btn outline" data-edit="${sp.id}">Edit</button>
          <button class="btn outline" data-del="${sp.id}">Delete</button>
        </td>
      </tr>
    `).join('');

    // mark arrived
    body.querySelectorAll('[data-mark]').forEach(b => b.onclick = async ()=>{
      let d = prompt('Arrival date (YYYY-MM-DD). Leave blank for today.');
      if (!d) d = new Date().toISOString().slice(0,10);
      await api('/api/shipments/'+b.dataset.mark, { method:'PUT', body: JSON.stringify({ arrivedAt: d }) });
      await renderShipmentsTable(type, sel);
      await refreshHome();
    });

    // edit qty/shipCost
    body.querySelectorAll('[data-edit]').forEach(b => b.onclick = async ()=>{
      const spId = b.dataset.edit;
      const qty = prompt('New quantity (leave blank to keep)');
      const shipCost = prompt('New ship cost (leave blank to keep)');
      const patch = {};
      if (qty !== null && qty.trim() !== '') patch.qty = +qty;
      if (shipCost !== null && shipCost.trim() !== '') patch.shipCost = +shipCost;
      if (Object.keys(patch).length === 0) return;
      await api('/api/shipments/'+spId, { method:'PUT', body: JSON.stringify(patch) });
      await renderShipmentsTable(type, sel);
      await refreshHome();
    });

    // delete
    body.querySelectorAll('[data-del]').forEach(b => b.onclick = async ()=>{
      if (!confirm('Delete shipment?')) return;
      await api('/api/shipments/'+b.dataset.del, { method:'DELETE' });
      await renderShipmentsTable(type, sel);
      await refreshHome();
    });

  } catch {
    body.innerHTML = '';
  }
}

// ---- Profit by Country from remittances ----
function wireProfitByCountry(){
  $('#pcRun') && ($('#pcRun').onclick = async ()=>{
    const s = $('#pcStart')?.value, e = $('#pcEnd')?.value;
    const tbody = $('#profitCountryTable tbody'); if (!tbody) return;
    try{
      const r = await api('/api/remittances');
      let list = r.remittances || [];
      if (s) list = list.filter(x=>x.start >= s);
      if (e) list = list.filter(x=>x.end   <= e);

      const byC = {};
      list.forEach(x=>{
        const c = x.country;
        if (!byC[c]) byC[c] = { revenue:0, ad:0, cpd:0, pieces:0 };
        byC[c].revenue += +x.revenue||0;
        byC[c].ad      += +x.adSpend||0;
        // If you later change to "extraCostPerPiece", adapt here. For now we still support costPerDelivery if present.
        const cpd = (+x.costPerDelivery || +x.extraCostPerPiece || 0) * (+x.pieces||0);
        byC[c].cpd    += cpd;
        byC[c].pieces += +x.pieces||0;
      });

      tbody.innerHTML = Object.entries(byC).map(([c,v])=>{
        const profit = v.revenue - v.ad - v.cpd;
        return `<tr><td>${c}</td><td>${v.revenue.toFixed(2)}</td><td>${v.ad.toFixed(2)}</td><td>${v.cpd.toFixed(2)}</td><td>${v.pieces}</td><td>${profit.toFixed(2)}</td></tr>`;
      }).join('');
    }catch{
      tbody.innerHTML = '';
    }
  });
}

// =================== PRODUCTS ===================
function wireProducts(){
  // add product
  $('#pAdd') && ($('#pAdd').onclick = async ()=>{
    const payload = {
      name: $('#pName')?.value,
      sku:  $('#pSku')?.value,
      cost_china: +( $('#pCost')?.value || 0 ),
      ship_china_to_kenya: +( $('#pShip')?.value || 0 ),
      margin_budget: +( $('#pMB')?.value || 0 )
    };
    if (!payload.name) return alert('Enter product name');
    await api('/api/products', { method:'POST', body: JSON.stringify(payload) });
    await renderProducts(); await ensureMeta();
  });
}

async function renderProducts(){
  const tbody = $('#productsTable tbody'); if (!tbody) return;
  let res;
  try { res = await api('/api/products'); } catch { res = { products: [] }; }
  state.products = res.products || [];

  tbody.innerHTML = state.products.map(p=>`
    <tr>
      <td>${p.name}</td>
      <td>${p.sku || '-'}</td>
      <td><span class="badge">${p.status || 'active'}</span></td>
      <td>
        <button class="btn outline" data-open="${p.id}">Open</button>
        <button class="btn outline" data-pause="${p.id}">${p.status==='active'?'Pause':'Run'}</button>
        <button class="btn outline" data-del="${p.id}">Delete</button>
      </td>
    </tr>
  `).join('');

  // open → product page
  tbody.querySelectorAll('[data-open]').forEach(b => b.onclick = ()=>{
    const id = b.dataset.open;
    // navigate to product page (your server serves /product.html)
    location.href = `/product.html?id=${encodeURIComponent(id)}`;
  });

  // pause/run
  tbody.querySelectorAll('[data-pause]').forEach(b => b.onclick = async ()=>{
    const id = b.dataset.pause;
    const p  = state.products.find(x=>x.id===id);
    const ns = (p?.status === 'active') ? 'paused' : 'active';
    await api(`/api/products/${id}/status`, { method:'POST', body: JSON.stringify({ status: ns }) });
    await renderProducts();
    await refreshHome();
  });

  // delete
  tbody.querySelectorAll('[data-del]').forEach(b => b.onclick = async ()=>{
    if(!confirm('Delete product?')) return;
    await api('/api/products/'+b.dataset.del, { method:'DELETE' });
    await renderProducts(); await refreshHome();
  });
}

// =================== PERFORMANCE ===================

// Top delivered (computed from remittances)
function wirePerformance(){
  $('#pfRun') && ($('#pfRun').onclick = async ()=>{
    const quick = $('#pfQuick')?.value;
    const sI = $('#pfStart'); const eI = $('#pfEnd');
    let s = sI?.value || ''; let e = eI?.value || '';

    // quick ranges
    if (quick === '8' || quick === '28') {
      const days = +quick;
      const end = new Date(); const start = new Date();
      start.setDate(end.getDate()-days+1);
      s = start.toISOString().slice(0,10);
      e = end.toISOString().slice(0,10);
      if (sI) sI.value = s; if (eI) eI.value = e;
    }

    const c = $('#pfCountry')?.value || '';
    const tbody = $('#pfTable tbody'); if (!tbody) return;

    try{
      const r = await api('/api/remittances');
      const prodsById = Object.fromEntries((state.products||[]).map(p=>[p.id,p]));

      let list = r.remittances || [];
      if (s) list = list.filter(x=>x.start >= s);
      if (e) list = list.filter(x=>x.end   <= e);
      if (c) list = list.filter(x=>x.country === c);

      const agg = {};
      list.forEach(x=>{
        const id = x.productId;
        if (!id) return;
        const prod = prodsById[id] || { cost_china:0, ship_china_to_kenya:0 };
        if (!agg[id]) agg[id] = { name: (prodsById[id]?.name || id), pieces:0, ad:0, prodCost:0, profit:0 };

        const pieces = +x.pieces || 0;
        const ad     = +x.adSpend || 0;
        const base   = (+prod.cost_china||0) + (+prod.ship_china_to_kenya||0);
        const extra  = (+x.extraCostPerPiece || +x.costPerDelivery || 0) * pieces;
        const revenue= +x.revenue || 0;

        agg[id].pieces   += pieces;
        agg[id].ad       += ad;
        agg[id].prodCost += (base * pieces) + extra;
        agg[id].profit   += (revenue - ad - ((base * pieces) + extra));
      });

      const rows = Object.values(agg)
        .sort((a,b)=>b.pieces-a.pieces)
        .map(it => `<tr>
          <td>${it.name}</td>
          <td>${it.pieces}</td>
          <td>${it.ad.toFixed(2)}</td>
          <td>${it.prodCost.toFixed(2)}</td>
          <td>${it.profit.toFixed(2)}</td>
          <td>${it.pieces ? (it.profit/it.pieces).toFixed(2) : '0.00'}</td>
        </tr>`).join('');

      tbody.innerHTML = rows;
    }catch{
      tbody.innerHTML = '';
    }
  });

  // Remittance Add (no cost-per-delivered here by default; we accept either CPD or extraCostPerPiece to be future-proof)
  $('#rAdd') && ($('#rAdd').onclick = async ()=>{
    const payload = {
      start:   $('#rStart')?.value,
      end:     $('#rEnd')?.value,
      country: $('#rCountry')?.value,
      productId: $('#rProduct')?.value,
      orders: +($('#rOrders')?.value || 0),
      pieces: +($('#rPieces')?.value || 0),
      revenue:+($('#rRev')?.value || 0),
      adSpend:+($('#rAds')?.value || 0)
    };
    // accept optional CPD if your HTML still has it
    const cpd = +($('#rCPD')?.value || 0);
    if (cpd) payload.costPerDelivery = cpd;

    if (!payload.start || !payload.end) return alert('Select dates');
    if (!payload.productId || !payload.country) return alert('Select product & country');

    await api('/api/remittances', { method:'POST', body: JSON.stringify(payload) });
    alert('Remittance saved');
    await refreshHome();
  });
}

// =================== FINANCE ===================
async function renderFinanceCats(){
  try{
    const cats = await api('/api/finance/categories'); // { debit:[], credit:[] }
    $('#fcList') && ($('#fcList').innerHTML =
      `<div>Debits: ${cats.debit.join(', ') || '-'}</div><div>Credits: ${cats.credit.join(', ') || '-'}</div>`);

    // populate category dropdown in Entries
    const catSel = $('#feCat');
    if (catSel) {
      const opts = [
        ...cats.debit.map(c=>({t:'debit', n:c})),
        ...cats.credit.map(c=>({t:'credit',n:c}))
      ];
      catSel.innerHTML = `<option value="">Select category</option>` +
        opts.map(o=>`<option value="${o.t}:${o.n}">${o.n} (${o.t})</option>`).join('');
    }
  }catch{
    $('#fcList') && ($('#fcList').textContent = 'Failed to load categories');
  }
}

async function runFinanceEntries(){
  try{
    const r = await api('/api/finance/entries'); // { entries: [...] }
    let list = r.entries || [];

    const s = $('#fes')?.value || '';
    const e = $('#fee')?.value || '';
    const catsFilter = ($('#fef')?.value || '')
      .split(',')
      .map(x=>x.trim())
      .filter(Boolean);

    if (s) list = list.filter(x=>x.date >= s);
    if (e) list = list.filter(x=>x.date <= e);
    if (catsFilter.length) list = list.filter(x=> catsFilter.includes(x.category));

    let balance = 0;
    list.forEach(x => {
      const amt = +x.amount || 0;
      balance += (x.type === 'credit') ? amt : -amt;
    });

    $('#feBalance') && ($('#feBalance').textContent = 'Balance: ' + balance.toFixed(2) + ' USD');

    const tbody = $('#feTable tbody');
    if (tbody){
      tbody.innerHTML = list.map(x=>`
        <tr>
          <td>${x.date}</td><td>${x.type}</td><td>${x.category}</td><td>${(+x.amount).toFixed(2)}</td><td>${x.note||''}</td>
          <td><button class="btn outline" data-del-entry="${x.id}">Delete</button></td>
        </tr>
      `).join('');

      tbody.querySelectorAll('[data-del-entry]').forEach(b => {
        b.onclick = async ()=>{
          await api('/api/finance/entries/'+b.dataset.delEntry, { method:'DELETE' });
          await runFinanceEntries();
        };
      });
    }
  }catch{
    $('#feBalance') && ($('#feBalance').textContent = 'Balance: —');
    const tbody = $('#feTable tbody'); if (tbody) tbody.innerHTML = '';
  }
}

function wireFinance(){
  $('#fcAdd') && ($('#fcAdd').onclick = async ()=>{
    const type = $('#fcType')?.value; // debit|credit
    const name = ($('#fcName')?.value || '').trim();
    if (!type || !name) return alert('Pick type & enter name');
    await api('/api/finance/categories', { method:'POST', body: JSON.stringify({ type, name }) });
    $('#fcName').value = '';
    await renderFinanceCats();
  });

  $('#feAdd') && ($('#feAdd').onclick = async ()=>{
    const date = $('#feDate')?.value;
    const catRaw = $('#feCat')?.value; // "type:CategoryName"
    const amt = +($('#feAmt')?.value || 0);
    const note = $('#feNote')?.value || '';
    if (!date || !catRaw) return alert('Pick date & category');
    const [type, category] = catRaw.split(':');
    await api('/api/finance/entries', { method:'POST', body: JSON.stringify({ date, type, category, amount: amt, note }) });
    $('#feAmt').value = ''; $('#feNote').value = '';
    await runFinanceEntries();
  });

  $('#feRun') && ($('#feRun').onclick = runFinanceEntries);
}

// =================== To-Do (localStorage) ===================
function loadTodos(){ try{ return JSON.parse(localStorage.getItem('todos')||'[]'); }catch{ return []; } }
function saveTodos(x){ localStorage.setItem('todos', JSON.stringify(x)); }

function renderTodos(){
  const list = $('#todoList'); if (!list) return;
  const items = loadTodos();
  list.innerHTML = items.map(it=>`
    <div class="flex">
      <span>${it.done ? '✅ ' : ''}${it.text}</span>
      <button class="btn outline" data-tgl="${it.id}">${it.done?'Undo':'Done'}</button>
      <button class="btn outline" data-del="${it.id}">Delete</button>
    </div>`).join('');

  list.querySelectorAll('[data-tgl]').forEach(b => b.onclick = ()=>{
    const items = loadTodos();
    const it = items.find(x=>x.id===b.dataset.tgl);
    if (it){ it.done = !it.done; saveTodos(items); renderTodos(); }
  });
  list.querySelectorAll('[data-del]').forEach(b => b.onclick = ()=>{
    const items = loadTodos();
    const idx = items.findIndex(x=>x.id===b.dataset.del);
    if (idx>-1){ items.splice(idx,1); saveTodos(items); renderTodos(); }
  });
}

function wireTodos(){
  $('#todoAdd') && ($('#todoAdd').onclick = ()=>{
    const t = ($('#todoText')?.value || '').trim();
    if (!t) return;
    const items = loadTodos();
    items.push({ id: Math.random().toString(36).slice(2), text:t, done:false });
    saveTodos(items);
    $('#todoText').value = '';
    renderTodos();
  });
}

function renderWeekly(){
  const key = 'weeklyTodos';
  let data = {};
  try { data = JSON.parse(localStorage.getItem(key) || '{}'); } catch { data = {}; }
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const wrap = $('#weeklyWrap'); if (!wrap) return;
  wrap.innerHTML = '';
  days.forEach(day=>{
    const items = data[day] || [];
    const card = document.createElement('div'); card.className = 'card';
    card.innerHTML = `<div class="h">${day}</div>
      <div class="flex"><input id="w_${day}" class="input" placeholder="Task"><button class="btn">Add</button></div>
      <div class="list">${items.map(it=>`<div class="flex">
        <span>${it.done?'✅ ':''}${it.text}</span>
        <button class="btn outline" data-wtgl="${day}|${it.id}">${it.done?'Undo':'Done'}</button>
        <button class="btn outline" data-wdel="${day}|${it.id}">Delete</button>
      </div>`).join('')}</div>`;
    wrap.appendChild(card);
    // add
    card.querySelector('button.btn').onclick = ()=>{
      const v = card.querySelector(`#w_${day}`).value.trim();
      if (!v) return;
      items.push({ id: Math.random().toString(36).slice(2), text:v, done:false });
      data[day] = items;
      localStorage.setItem(key, JSON.stringify(data));
      renderWeekly();
    };
  });

  // toggle & delete
  wrap.querySelectorAll('[data-wtgl]').forEach(b => b.onclick = ()=>{
    const [d,id] = b.dataset.wtgl.split('|');
    let data = JSON.parse(localStorage.getItem(key) || '{}');
    const it = (data[d]||[]).find(x=>x.id===id);
    if (it){ it.done = !it.done; localStorage.setItem(key, JSON.stringify(data)); renderWeekly(); }
  });
  wrap.querySelectorAll('[data-wdel]').forEach(b => b.onclick = ()=>{
    const [d,id] = b.dataset.wdel.split('|');
    let data = JSON.parse(localStorage.getItem(key) || '{}');
    const arr = data[d] || []; const idx = arr.findIndex(x=>x.id===id);
    if (idx>-1){ arr.splice(idx,1); data[d] = arr; localStorage.setItem(key, JSON.stringify(data)); renderWeekly(); }
  });
}

// =================== Settings ===================
function wireSettings(){
  // add country
  $('#ctyAdd') && ($('#ctyAdd').onclick = async ()=>{
    const name = ($('#cty')?.value || '').trim();
    if (!name) return;
    await api('/api/countries', { method:'POST', body: JSON.stringify({ name }) });
    const list = await api('/api/countries');
    state.countries = list.countries || [];
    fillSelects(); renderCountries();
    alert('Country added');
  });

  // Manual snapshots are handled on Settings page by your current HTML
  // If you later add buttons for save/restore, wire them similarly here.
}

// =================== NAV & LOGIN ===================
function wireNav(){
  $$('.nav a[data-view]').forEach(a => a.onclick = (e)=>{
    e.preventDefault();
    setView(a.dataset.view);
    if (a.dataset.view === 'products')  renderProducts();
    if (a.dataset.view === 'finance')  { renderFinanceCats(); runFinanceEntries(); }
  });
}

function wireAuth(){
  $('#loginBtn') && ($('#loginBtn').onclick = async ()=>{
    const p = $('#pw')?.value || '';
    try {
      await api('/api/auth', { method:'POST', body: JSON.stringify({ password: p }) });
      $('#login').style.display = 'none';
      $('#main').style.display  = '';
      setView('home');
      await ensureMeta();
    } catch {
      alert('Wrong password');
    }
  });

  $('#logoutLink') && ($('#logoutLink').onclick = async (e)=>{
    e.preventDefault();
    try { await api('/api/auth', { method:'POST', body: JSON.stringify({ password:'logout' }) }); } catch {}
    location.reload();
  });
}

// =================== boot ===================
document.addEventListener('DOMContentLoaded', async ()=>{
  wireNav();
  wireAuth();
  wireDeliveries();
  wireAdSpend();
  wireMovement();
  wireProfitByCountry();
  wireProducts();
  wireFinance();
  wireTodos();
  wireSettings();

  renderTodos();
  renderWeekly();

  await ensureMeta();
});
