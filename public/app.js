/* =========================
   EAS Tracker - Frontend JS
   ========================= */

/* ---------- helpers ---------- */
const state = {
  view: 'home',
  products: [],
  countries: [],
  // weekly delivered table structure in backend: { country: { Monday:0,...Sunday:0 } }
  weekly: {}
};

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

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
  return res.headers.get('content-type')?.includes('application/json')
    ? res.json()
    : { ok: true };
}

function setView(v) {
  state.view = v;
  ['home','products','performance','finance','settings'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = id === v ? '' : 'none';
  });
  $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.view === v));
}

const fmtMoney = n => (Number(n || 0)).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}) + ' USD';
const sum = arr => arr.reduce((a,b) => a + (+b || 0), 0);

/* ---------- auth/bootstrap ---------- */
async function ensureMeta() {
  try {
    const m = await api('/api/meta');
    state.countries = m.countries || [];
    await loadProducts();
    await loadWeekly();
    $('#login').style.display = 'none';
    $('#main').style.display = '';
    fillSelects();
    renderCountriesChips();
    await refreshHome();
    await renderProducts();
    await renderFinanceCats();
    await loadSnapshots();
  } catch (e) {
    $('#main').style.display = 'none';
    $('#login').style.display = '';
    console.warn('meta error:', e.message);
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

async function loadWeekly() {
  // backend stores weekly table (server keeps it reset beginning of each Monday)
  try {
    const r = await api('/api/weekly');
    state.weekly = r.weekly || {};
  } catch {
    state.weekly = {};
  }
}

function fillSelects() {
  // Countries
  const cs = '#wdCountry,#adCountry,#mvFrom,#mvTo,#pcCountry,#rCountry,#pfCountry';
  $$(cs).forEach(s => {
    s.innerHTML = `<option value="">${s.id==='pcCountry'||s.id==='pfCountry'?'All countries':''}</option>` +
      state.countries.map(c => `<option value="${c}">${c}</option>`).join('');
  });

  // Products
  const ps = '#adProduct,#mvProduct,#rProduct';
  $$(ps).forEach(s => {
    s.innerHTML = state.products.map(p => `<option value="${p.id}">${p.name}${p.sku?` (${p.sku})`:''}</option>`).join('');
  });

  // Finance categories select is populated by renderFinanceCats()
}

/* ---------- DASHBOARD ---------- */
async function refreshHome() {
  // KPIs
  $('#kpiProducts').textContent = state.products.length;
  $('#kpiCountries').textContent = state.countries.length;

  await renderStockByCountry();

  // Transit counts
  try {
    const s = await api('/api/shipments');
    const active = (s.shipments || []).filter(x => !x.arrivedAt);
    $('#kpiTransit').textContent = active.length;
    // render tables
    await renderShipmentsTable('china-kenya', '#shipCKTable tbody', s.shipments);
    await renderShipmentsTable('intercountry', '#shipICTable tbody', s.shipments);
  } catch {
    $('#kpiTransit').textContent = '—';
  }

  // Daily ad spend total (sum of current daily settings)
  try {
    const a = await api('/api/adspend/current');
    const total = sum((a.items || []).map(x => +x.amount || 0));
    $('#kpiAdSpend').textContent = fmtMoney(total);
  } catch {
    $('#kpiAdSpend').textContent = '—';
  }

  // Weekly delivered grid & KPI
  renderWeeklyGrid();
  const totals = Object.values(state.weekly).map(row => sum([
    row.Monday,row.Tuesday,row.Wednesday,row.Thursday,row.Friday,row.Saturday,row.Sunday
  ]));
  $('#kpiDelivered').textContent = sum(totals);
}

/* stock + ad spend by country with totals row */
async function renderStockByCountry() {
  const tbody = $('#stockCountryTable tbody');
  let per = {};
  state.countries.forEach(c => per[c] = {stock:0, ad:0});

  // arrived shipments add stock to destination
  try {
    const s = await api('/api/shipments');
    (s.shipments || []).forEach(sp => {
      if (sp.arrivedAt) {
        const to = sp.toCountry || sp.to;
        if (!per[to]) per[to] = {stock:0, ad:0};
        per[to].stock += (+sp.qty||0);
      }
    });
  } catch {}
  // remittances subtract pieces
  try {
    const r = await api('/api/remittances');
    (r.remittances||[]).forEach(x=>{
      if (!per[x.country]) per[x.country] = {stock:0, ad:0};
      per[x.country].stock -= (+x.pieces||0);
    });
  } catch {}
  // ad spend per country (current daily settings + historical total if your backend returns totals)
  try {
    const a = await api('/api/adspend/total-by-country'); // if not available, fall back to current
    if (a.totals) {
      Object.entries(a.totals).forEach(([c,v])=>{
        if (!per[c]) per[c] = {stock:0, ad:0};
        per[c].ad += (+v||0);
      });
    } else {
      const cur = await api('/api/adspend/current');
      (cur.items||[]).forEach(x=>{
        if (!per[x.country]) per[x.country] = {stock:0, ad:0};
        per[x.country].ad += (+x.amount||0);
      });
    }
  } catch {}

  tbody.innerHTML = Object.entries(per).map(([c,v]) =>
    `<tr><td>${c}</td><td>${v.stock}</td><td>${fmtMoney(v.ad||0)}</td></tr>`
  ).join('');

  // totals row
  const stockT = sum(Object.values(per).map(v=>+v.stock||0));
  const adT = sum(Object.values(per).map(v=>+v.ad||0));
  $('#stockTotal').textContent = stockT;
  $('#adTotal').textContent = fmtMoney(adT);
}

/* weekly delivered grid */
function emptyWeekRow(){return {Monday:0,Tuesday:0,Wednesday:0,Thursday:0,Friday:0,Saturday:0,Sunday:0};}
function renderWeeklyGrid(){
  // ensure every known country exists
  state.countries.forEach(c => { if (!state.weekly[c]) state.weekly[c]=emptyWeekRow(); });
  const tbody = $('#wdTable tbody');
  const rows = state.countries.map(c=>{
    const r = state.weekly[c]||emptyWeekRow();
    const total = sum(Object.values(r));
    return `<tr data-country="${c}">
      <td>${c}</td>
      ${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(d =>
        `<td contenteditable="true" data-day="${d}">${+r[d]||0}</td>`
      ).join('')}
      <td class="row-total">${total}</td>
    </tr>`;
  }).join('');
  tbody.innerHTML = rows;

  // per-day totals
  const perDay = {Monday:0,Tuesday:0,Wednesday:0,Thursday:0,Friday:0,Saturday:0,Sunday:0};
  state.countries.forEach(c=>{
    const r=state.weekly[c]||emptyWeekRow();
    Object.keys(perDay).forEach(d => perDay[d]+= (+r[d]||0));
  });
  $('#wdMonT').textContent = perDay.Monday;
  $('#wdTueT').textContent = perDay.Tuesday;
  $('#wdWedT').textContent = perDay.Wednesday;
  $('#wdThuT').textContent = perDay.Thursday;
  $('#wdFriT').textContent = perDay.Friday;
  $('#wdSatT').textContent = perDay.Saturday;
  $('#wdSunT').textContent = perDay.Sunday;
  $('#wdAllT').textContent = sum(Object.values(perDay));

  // inline edit handler
  tbody.querySelectorAll('td[contenteditable]').forEach(td=>{
    td.addEventListener('blur', async ()=>{
      const tr = td.closest('tr');
      const country = tr.dataset.country;
      const day = td.dataset.day;
      const val = Math.max(0, +td.textContent.trim() || 0);
      td.textContent = val;
      if (!state.weekly[country]) state.weekly[country]=emptyWeekRow();
      state.weekly[country][day]=val;
      // persist row
      await api('/api/weekly', {method:'POST', body: JSON.stringify({ country, row: state.weekly[country] })});
      // update totals
      renderWeeklyGrid();
      // refresh kpi
      const totals = Object.values(state.weekly).map(r=>sum(Object.values(r)));
      $('#kpiDelivered').textContent = sum(totals);
    });
  });

  // populate selectors for quick add/edit
  $('#wdCountry').innerHTML = state.countries.map(c=>`<option>${c}</option>`).join('');
}
$('#wdSave')?.addEventListener('click', async ()=>{
  const country = $('#wdCountry').value;
  const day = $('#wdDay').value;
  const count = +$('#wdCount').value||0;
  if(!country) return alert('Pick country');
  if (!state.weekly[country]) state.weekly[country]=emptyWeekRow();
  state.weekly[country][day]=count;
  await api('/api/weekly', {method:'POST', body: JSON.stringify({ country, row: state.weekly[country] })});
  renderWeeklyGrid();
  $('#kpiDelivered').textContent = sum(Object.values(state.weekly).map(r=>sum(Object.values(r))));
});
$('#wdReset')?.addEventListener('click', async ()=>{
  if(!confirm('Clear all delivered counts for the current week?')) return;
  await api('/api/weekly/reset', {method:'POST'});
  state.weekly = {};
  renderWeeklyGrid();
  $('#kpiDelivered').textContent = '0';
});

/* ad spend (replace) */
$('#adAdd')?.addEventListener('click', async ()=>{
  const payload = {
    platform: $('#adPlatform').value,
    productId: $('#adProduct').value,
    country: $('#adCountry').value,
    amount: +$('#adAmount').value || 0
  };
  if(!payload.productId || !payload.country) return alert('Pick product & country');
  await api('/api/adspend', {method:'POST', body: JSON.stringify(payload)});
  alert('Saved');
  await refreshHome();
});

/* shipments tables (arrived => disappear from dashboard), allow edit ship cost & qty */
async function renderShipmentsTable(which, sel, dataMaybe){
  const tbody = $(sel);
  const productsById = Object.fromEntries((state.products||[]).map(p=>[p.id,p]));
  const all = dataMaybe || (await api('/api/shipments')).shipments || [];
  const onlyActive = all.filter(x => !x.arrivedAt);
  const list = onlyActive.filter(sp=>{
    const f = (sp.fromCountry||sp.from||'').toLowerCase();
    const t = (sp.toCountry||sp.to||'').toLowerCase();
    const ck = (f==='china' && t==='kenya');
    return which==='china-kenya' ? ck : !ck;
  });

  tbody.innerHTML = list.map(sp=>`
    <tr data-id="${sp.id}">
      <td>${sp.id}</td>
      <td>${productsById[sp.productId]?.name || sp.productId}</td>
      <td>${(sp.fromCountry||sp.from)} → ${(sp.toCountry||sp.to)}</td>
      <td contenteditable="true" data-edit="qty">${sp.qty||0}</td>
      <td contenteditable="true" data-edit="shipCost">${sp.shipCost||0}</td>
      <td>${sp.departedAt||''}</td>
      <td>${sp.arrivedAt||''}</td>
      <td>
        <button class="btn outline" data-mark="${sp.id}">Mark Arrived</button>
        <button class="btn outline danger" data-del="${sp.id}">Delete</button>
      </td>
    </tr>
  `).join('');

  // inline edit qty / ship cost
  tbody.querySelectorAll('[data-edit]').forEach(cell=>{
    cell.addEventListener('blur', async ()=>{
      const tr = cell.closest('tr');
      const id = tr.dataset.id;
      const field = cell.dataset.edit;
      const value = +cell.textContent.trim() || 0;
      await api(`/api/shipments/${id}`, {method:'PUT', body: JSON.stringify({ [field]: value })});
    });
  });

  // mark arrived
  tbody.querySelectorAll('[data-mark]').forEach(b=>{
    b.onclick = async ()=>{
      let d = prompt('Arrival date (YYYY-MM-DD):', new Date().toISOString().slice(0,10));
      if(!d) return;
      await api(`/api/shipments/${b.dataset.mark}`, {method:'PUT', body: JSON.stringify({ arrivedAt: d })});
      await refreshHome(); // they disappear from dashboard tables
    };
  });

  // delete
  tbody.querySelectorAll('[data-del]').forEach(b=>{
    b.onclick = async ()=>{
      if(!confirm('Delete this shipment?')) return;
      await api(`/api/shipments/${b.dataset.del}`, {method:'DELETE'});
      await refreshHome();
    };
  });
}

/* profit by country (from remittances) */
$('#pcRun')?.addEventListener('click', async ()=>{
  const s = $('#pcStart').value, e = $('#pcEnd').value, c = $('#pcCountry').value;
  const qs = [];
  if (s) qs.push('start='+s);
  if (e) qs.push('end='+e);
  if (c) qs.push('country='+encodeURIComponent(c));
  const r = await api(`/api/remittances${qs.length?`?${qs.join('&')}`:''}`);
  const byC = {};
  (r.remittances||[]).forEach(x=>{
    byC[x.country] = byC[x.country] || { revenue:0, ad:0, extra:0, pieces:0 };
    byC[x.country].revenue += +x.revenue||0;
    byC[x.country].ad += +x.adSpend||0;
    byC[x.country].extra += (+x.extraPerPiece||0) * (+x.pieces||0);
    byC[x.country].pieces += (+x.pieces||0);
  });
  const tbody = $('#profitCountryTable tbody');
  tbody.innerHTML = Object.entries(byC).map(([country,v])=>{
    const profit = v.revenue - v.ad - v.extra;
    return `<tr><td>${country}</td><td>${v.revenue.toFixed(2)}</td><td>${v.ad.toFixed(2)}</td><td>${v.extra.toFixed(2)}</td><td>${v.pieces}</td><td>${profit.toFixed(2)}</td></tr>`;
  }).join('');
});

/* To-Do (local only) */
function loadTodos(){ return JSON.parse(localStorage.getItem('todos')||'[]'); }
function saveTodos(x){ localStorage.setItem('todos', JSON.stringify(x)); }
function renderTodos(){
  const list = $('#todoList');
  const items = loadTodos();
  list.innerHTML = items.map(it=>`
    <div class="flex todo-row">
      <span>${it.done?'✅ ':''}${it.text}</span>
      <span>
        <button class="btn outline" data-tgl="${it.id}">${it.done?'Undo':'Done'}</button>
        <button class="btn outline danger" data-del="${it.id}">Delete</button>
      </span>
    </div>`).join('');
  list.querySelectorAll('[data-tgl]').forEach(b=> b.onclick=()=>{
    const items = loadTodos(); const it = items.find(x=>x.id===b.dataset.tgl); it.done=!it.done; saveTodos(items); renderTodos();
  });
  list.querySelectorAll('[data-del]').forEach(b=> b.onclick=()=>{
    const items = loadTodos(); const i = items.findIndex(x=>x.id===b.dataset.del); items.splice(i,1); saveTodos(items); renderTodos();
  });
}
$('#todoAdd')?.addEventListener('click', ()=>{
  const t = $('#todoText').value.trim(); if(!t) return;
  const items = loadTodos();
  items.push({id: Math.random().toString(36).slice(2), text:t, done:false});
  saveTodos(items); $('#todoText').value=''; renderTodos();
});

/* Weekly To-Do (local only) */
function renderWeekly(){
  const key='weeklyTodos';
  const data = JSON.parse(localStorage.getItem(key)||'{}');
  const wrap = $('#weeklyWrap');
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  wrap.innerHTML = '';
  days.forEach(day=>{
    const items = data[day]||[];
    const card = document.createElement('div'); card.className='card';
    card.innerHTML = `<div class="h">${day}</div>
      <div class="flex"><input id="w_${day}" class="input" placeholder="Task"><button class="btn">Add</button></div>
      <div class="list">${items.map(it=>`<div class="flex todo-row"><span>${it.done?'✅ ':''}${it.text}</span>
        <span><button class="btn outline" data-wtgl="${day}|${it.id}">${it.done?'Undo':'Done'}</button>
        <button class="btn outline danger" data-wdel="${day}|${it.id}">Delete</button></span></div>`).join('')}</div>`;
    wrap.appendChild(card);
    card.querySelector('button.btn').onclick = ()=>{
      const v = card.querySelector(`#w_${day}`).value.trim(); if(!v) return;
      items.push({id:Math.random().toString(36).slice(2), text:v, done:false});
      data[day]=items; localStorage.setItem(key, JSON.stringify(data)); renderWeekly();
    };
  });
  wrap.querySelectorAll('[data-wtgl]').forEach(b=> b.onclick=()=>{
    const [d,id]=b.dataset.wtgl.split('|');
    const data = JSON.parse(localStorage.getItem(key)||'{}'); const it=(data[d]||[]).find(x=>x.id===id);
    it.done=!it.done; localStorage.setItem(key, JSON.stringify(data)); renderWeekly();
  });
  wrap.querySelectorAll('[data-wdel]').forEach(b=> b.onclick=()=>{
    const [d,id]=b.dataset.wdel.split('|');
    const data = JSON.parse(localStorage.getItem(key)||'{}'); const arr=(data[d]||[]); const i=arr.findIndex(x=>x.id===id);
    arr.splice(i,1); data[d]=arr; localStorage.setItem(key, JSON.stringify(data)); renderWeekly();
  });
}

/* ---------- PRODUCTS ---------- */
$('#pAdd')?.addEventListener('click', async ()=>{
  const payload = {
    name: $('#pName').value.trim(),
    sku: $('#pSku').value.trim(),
    cost_china: +$('#pCost').value || 0,
    ship_china_to_kenya: +$('#pShip').value || 0,
    margin_budget: +$('#pMB').value || 0
  };
  if(!payload.name) return alert('Enter product name');
  await api('/api/products', {method:'POST', body: JSON.stringify(payload)});
  alert('Product added');
  await loadProducts();
  fillSelects();
  await renderProducts();
});

async function renderProducts(){
  const tbody = $('#productsTable tbody');
  const rows = (state.products||[]).map(p=>`
    <tr>
      <td>${p.name}</td>
      <td>${p.sku||'-'}</td>
      <td><span class="badge ${p.status==='paused'?'warn':''}">${p.status||'active'}</span></td>
      <td>
        <button class="btn outline" data-pause="${p.id}">${p.status==='active'?'Pause':'Run'}</button>
        <button class="btn outline danger" data-del="${p.id}">Delete</button>
        <a class="btn" href="/public/product.html?id=${encodeURIComponent(p.id)}">Open</a>
      </td>
    </tr>`).join('');
  tbody.innerHTML = rows || '<tr><td colspan="4">No products yet</td></tr>';

  tbody.querySelectorAll('[data-pause]').forEach(b => b.onclick = async ()=>{
    const id=b.dataset.pause; const prod=state.products.find(x=>x.id===id);
    const ns = prod.status==='active' ? 'paused' : 'active';
    await api(`/api/products/${id}/status`, {method:'POST', body: JSON.stringify({status:ns})});
    await loadProducts(); await renderProducts(); await refreshHome();
  });
  tbody.querySelectorAll('[data-del]').forEach(b => b.onclick = async ()=>{
    if(!confirm('Delete product?')) return;
    await api(`/api/products/${b.dataset.del}`, {method:'DELETE'});
    await loadProducts(); fillSelects(); await renderProducts(); await refreshHome();
  });

  // also hydrate Edit Product section
  const sel = $('#epSelect');
  if (sel) {
    sel.innerHTML = state.products.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
    sel.onchange = ()=>{
      const p = state.products.find(x=>x.id===sel.value);
      if(!p) return;
      $('#epName').value = p.name||'';
      $('#epSku').value = p.sku||'';
      $('#epCost').value = p.cost_china||0;
      $('#epShip').value = p.ship_china_to_kenya||0;
      $('#epMB').value = p.margin_budget||0;
    };
    sel.onchange(); // prefill
  }
}
$('#epSave')?.addEventListener('click', async ()=>{
  const id = $('#epSelect').value;
  const payload = {
    name: $('#epName').value.trim(),
    sku: $('#epSku').value.trim(),
    cost_china: +$('#epCost').value||0,
    ship_china_to_kenya: +$('#epShip').value||0,
    margin_budget: +$('#epMB').value||0
  };
  await api(`/api/products/${id}`, {method:'PUT', body: JSON.stringify(payload)});
  alert('Product updated');
  await loadProducts(); fillSelects(); await renderProducts(); await refreshHome();
});

/* ---------- PERFORMANCE ---------- */
// quick range
$('#pfQuick')?.addEventListener('change', ()=>{
  const v = $('#pfQuick').value;
  if (v==='custom') return;
  const days = +v;
  const end = new Date();
  const start = new Date(); start.setDate(end.getDate()-days+1);
  $('#pfStart').value = start.toISOString().slice(0,10);
  $('#pfEnd').value = end.toISOString().slice(0,10);
});

$('#pfRun')?.addEventListener('click', async ()=>{
  const s=$('#pfStart').value, e=$('#pfEnd').value, c=$('#pfCountry').value;
  const qs = [];
  if (s) qs.push('start='+s); if (e) qs.push('end='+e); if (c) qs.push('country='+encodeURIComponent(c));
  const r = await api(`/api/remittances${qs.length?`?${qs.join('&')}`:''}`);

  // join with product base cost
  const productsById = Object.fromEntries((state.products||[]).map(p=>[p.id,p]));
  const agg = {};
  (r.remittances||[]).forEach(x=>{
    const id = x.productId;
    const p = productsById[id] || {cost_china:0, ship_china_to_kenya:0};
    if (!agg[id]) agg[id]={name: p.name||id, pieces:0, ad:0, baseCost:0, shipping:0, profit:0};
    agg[id].pieces += (+x.pieces||0);
    agg[id].ad += (+x.adSpend||0);
    const base = (+p.cost_china||0) + (+p.ship_china_to_kenya||0);
    agg[id].baseCost += base * (+x.pieces||0);
    agg[id].shipping += (+x.extraPerPiece||0) * (+x.pieces||0);
    const profit = (+x.revenue||0) - (+x.adSpend||0) - (base*(+x.pieces||0)) - ((+x.extraPerPiece||0) * (+x.pieces||0));
    agg[id].profit += profit;
  });

  const tbody = $('#pfTable tbody');
  tbody.innerHTML = Object.values(agg).sort((a,b)=>b.pieces-a.pieces).map(it=>{
    return `<tr>
      <td>${it.name}</td>
      <td>${it.pieces}</td>
      <td>${it.ad.toFixed(2)}</td>
      <td>${(it.baseCost+it.shipping).toFixed(2)}</td>
      <td>${it.profit.toFixed(2)}</td>
      <td>${it.pieces ? (it.profit/it.pieces).toFixed(2) : '0.00'}</td>
    </tr>`;
  }).join('');
});

/* Remittance report add (with extraPerPiece replacing CPD) */
$('#rAdd')?.addEventListener('click', async ()=>{
  const payload = {
    start: $('#rStart').value, end: $('#rEnd').value,
    country: $('#rCountry').value, productId: $('#rProduct').value,
    orders: +$('#rOrders').value||0, pieces: +$('#rPieces').value||0,
    revenue: +$('#rRev').value||0, adSpend: +$('#rAds').value||0,
    extraPerPiece: +$('#rExtraPerPiece').value||0
  };
  if(!payload.start || !payload.end) return alert('Pick period');
  await api('/api/remittances', {method:'POST', body: JSON.stringify(payload)});
  alert('Saved');
  await refreshHome();
});

/* ---------- FINANCE ---------- */
async function renderFinanceCats(){
  // list & chips
  let cats = {debits:[], credits:[]};
  try { cats = await api('/api/finance/categories'); } catch {}
  // chips
  const chips = [];
  (cats.debits||[]).forEach(c=> chips.push(`<span class="chip warn">${c}</span>`));
  (cats.credits||[]).forEach(c=> chips.push(`<span class="chip">${c}</span>`));
  $('#fcList').innerHTML = chips.join('') || '<span class="muted">No categories yet</span>';

  // selector (value encodes type:name)
  const sel = $('#feCat');
  const opts = [
    ...(cats.debits||[]).map(c=>`<option value="debit:${c}">${c} (debit)</option>`),
    ...(cats.credits||[]).map(c=>`<option value="credit:${c}">${c} (credit)</option>`)
  ];
  sel.innerHTML = `<option value="">Select category</option>${opts.join('')}`;

  // running balance
  try {
    const r = await api('/api/finance/entries');
    const bal = (r.entries||[]).reduce((acc, x)=> acc + (x.type==='credit'? +x.amount : -x.amount), 0);
    $('#finRunning').textContent = fmtMoney(bal);
  } catch {
    $('#finRunning').textContent = fmtMoney(0);
  }
}
$('#fcAdd')?.addEventListener('click', async ()=>{
  const type = $('#fcType').value, name = $('#fcName').value.trim();
  if(!name) return;
  await api('/api/finance/categories', {method:'POST', body: JSON.stringify({type, name})});
  $('#fcName').value='';
  await renderFinanceCats();
});

$('#feAdd')?.addEventListener('click', async ()=>{
  const date=$('#feDate').value;
  const catRaw=$('#feCat').value; if(!catRaw) return alert('Select category');
  const [type, category] = catRaw.split(':');
  const amount= +$('#feAmt').value||0;
  const note=$('#feNote').value;
  await api('/api/finance/entries', {method:'POST', body: JSON.stringify({date, type, category, amount, note})});
  $('#feAmt').value=''; $('#feNote').value='';
  await renderFinanceCats();
  await runFinanceRange(); // refresh list
});

$('#feRun')?.addEventListener('click', runFinanceRange);
async function runFinanceRange(){
  const s=$('#fes').value, e=$('#fee').value;
  const r = await api(`/api/finance/entries${(s||e)?`?start=${s||''}&end=${e||''}`:''}`);
  const tbody = $('#feTable tbody');
  tbody.innerHTML = (r.entries||[]).map(x=>`
    <tr>
      <td>${x.date}</td><td>${x.type}</td><td>${x.category}</td><td>${(+x.amount).toFixed(2)}</td><td>${x.note||''}</td>
      <td><button class="btn outline danger" data-del="${x.id}">Delete</button></td>
    </tr>`).join('');
  const bal = (r.entries||[]).reduce((acc, x)=> acc + (x.type==='credit'? +x.amount : -x.amount), 0);
  $('#feBalance').textContent = 'Range Balance: ' + fmtMoney(bal);
  tbody.querySelectorAll('[data-del]').forEach(b=> b.onclick=async()=>{
    if(!confirm('Delete this entry?')) return;
    await api(`/api/finance/entries/${b.dataset.del}`, {method:'DELETE'});
    await runFinanceRange(); await renderFinanceCats();
  });
}

/* ---------- SETTINGS: Countries & Snapshots ---------- */
function renderCountriesChips(){
  $('#ctyList').innerHTML = (state.countries||[]).map(c=>`<span class="chip">${c}</span>`).join('');
}
$('#ctyAdd')?.addEventListener('click', async ()=>{
  const name = ($('#cty').value||'').trim(); if(!name) return;
  await api('/api/countries',{method:'POST', body: JSON.stringify({name})});
  const list = await api('/api/countries');
  state.countries = list.countries||[];
  $('#cty').value='';
  fillSelects(); renderCountriesChips(); renderWeeklyGrid(); refreshHome();
});

/* Manual saves (snapshots) */
async function loadSnapshots(){
  try{
    const r = await api('/api/snapshots');
    renderSnapshotTable(r.items||[]);
  }catch{
    renderSnapshotTable([]);
  }
}
function renderSnapshotTable(items){
  const tbody = $('#snapTable tbody');
  tbody.innerHTML = (items||[]).map(it=>`
    <tr>
      <td>${it.name}</td>
      <td>${new Date(it.createdAt||it.time||Date.now()).toLocaleString()}</td>
      <td>
        <button class="btn outline" data-restore="${it.name}">Push to System</button>
        <button class="btn outline danger" data-del="${it.name}">Delete</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="3">No saves yet</td></tr>';

  tbody.querySelectorAll('[data-restore]').forEach(b=> b.onclick=async()=>{
    if(!confirm(`Restore "${b.dataset.restore}" to the system?`)) return;
    await api('/api/snapshots/restore', {method:'POST', body: JSON.stringify({name:b.dataset.restore})});
    alert('Restored'); location.reload();
  });
  tbody.querySelectorAll('[data-del]').forEach(b=> b.onclick=async()=>{
    if(!confirm(`Delete save "${b.dataset.del}"?`)) return;
    await api(`/api/snapshots/${encodeURIComponent(b.dataset.del)}`, {method:'DELETE'});
    await loadSnapshots();
  });
}
$('#snapCreate')?.addEventListener('click', async ()=>{
  const name = ($('#snapName').value||'').trim() || prompt('Name this snapshot');
  if(!name) return;
  await api('/api/snapshots', {method:'POST', body: JSON.stringify({name})});
  $('#snapName').value='';
  await loadSnapshots();
});

/* ---------- NAV & LOGIN ---------- */
$$('.nav a[data-view]').forEach(a => a.onclick = e => {
  e.preventDefault();
  setView(a.dataset.view);
  if (a.dataset.view === 'products') renderProducts();
  if (a.dataset.view === 'finance') { renderFinanceCats(); runFinanceRange(); }
});

$('#loginBtn')?.addEventListener('click', async ()=>{
  const p = $('#pw').value;
  try { await api('/api/auth', {method:'POST', body: JSON.stringify({password:p})}); await ensureMeta(); }
  catch { alert('Wrong password'); }
});

$('#logoutLink')?.addEventListener('click', async (e)=>{
  e.preventDefault();
  try { await api('/api/logout', {method:'POST'}); } catch {}
  location.reload();
});

/* ---------- boot ---------- */
renderTodos();
renderWeekly();
ensureMeta();
