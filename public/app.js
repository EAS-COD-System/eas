/* =====================================================================
   EAS Tracker – front-end (vanilla JS)
   Works for both index.html (dashboard/app) and product.html (product view)
   ===================================================================== */

const state = {
  countries: [],
  products: [],
  deliveries: [],
  shipments: [],
  adspend: [],
  remittances: [],
  influencers: [],
  influencerSpends: [],
  finance: { categories: { debit: [], credit: [] }, entries: [] },
  productId: new URLSearchParams(location.search).get('id') || null,
};

const Q  = (s, r=document) => r.querySelector(s);
const QA = (s, r=document) => Array.from(r.querySelectorAll(s));

const todayISO = () => new Date().toISOString().slice(0,10);
const fmt = n => (isNaN(+n) ? '0' : (+n).toLocaleString(undefined,{maximumFractionDigits:2}));

// API helper (sends credentials and JSON automatically)
async function api(path, opts={}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type':'application/json' },
    credentials: 'include',
    body: opts.body || undefined
  });
  if (!res.ok) return res;
  try { return await res.json(); } catch { return res; }
}

/* ================================================================
   LOGIN / LOGOUT GATE
   ================================================================ */
async function gate() {
  try {
    // try to read meta behind auth; if 403 we are logged out
    const meta = await api('/api/meta');
    if (!meta || meta.error) throw new Error('not authed');

    // success → show main / hide login
    const login = Q('#login'); const main = Q('#main');
    if (login) login.style.display = 'none';
    if (main) { main.classList.remove('hide'); main.style.display = ''; }

    // preload core data used across pages
    await Promise.all([
      preloadCountries(),
      preloadProducts(),
      preloadShipments(),
      preloadAdspend(),
      preloadDeliveries(),
      preloadRemittances(),
      preloadInfluencers(),
      preloadInfluencerSpends(),
      preloadFinance()
    ]);

    fillGlobalSelects();
    initNav();

    if (state.productId) {
      // product.html
      await loadProduct(state.productId);
      renderProductPage();
    } else {
      // index.html
      initDashboard();
      initPerformance();
      initFinance();
      initSettings();
    }
  } catch {
    // not logged in yet → show login
    const login = Q('#login'); const main = Q('#main');
    if (login) login.style.display = '';
    if (main) main.style.display = 'none';
  }
}

Q('#loginBtn')?.addEventListener('click', async () => {
  const password = Q('#pw')?.value?.trim();
  if (!password) return alert('Enter password');
  const res = await fetch('/api/auth', {
    method:'POST', headers:{'Content-Type':'application/json'},
    credentials:'include', body: JSON.stringify({ password })
  });
  if (res.ok) {
    const login = Q('#login'); const main = Q('#main');
    if (login) login.style.display = 'none';
    if (main) { main.classList.remove('hide'); main.style.display = ''; }
    gate();
  } else {
    alert('Incorrect password');
  }
});

Q('#logoutLink')?.addEventListener('click', async e => {
  e.preventDefault();
  await fetch('/api/auth', {
    method:'POST', headers:{'Content-Type':'application/json'},
    credentials:'include', body: JSON.stringify({ password:'logout' })
  });
  location.reload();
});

/* ================================================================
   PRELOADERS
   ================================================================ */
async function preloadCountries(){ const r = await api('/api/countries'); state.countries = r?.countries||[]; }
async function preloadProducts(){ const r = await api('/api/products'); state.products = r?.products||[]; }
async function preloadShipments(){ const r = await api('/api/shipments'); state.shipments = r?.shipments||[]; }
async function preloadAdspend(){ const r = await api('/api/adspend'); state.adspend = r?.adSpends||[]; }
async function preloadDeliveries(){ const r = await api('/api/deliveries'); state.deliveries = r?.deliveries||[]; }
async function preloadRemittances(){ const r = await api('/api/remittances'); state.remittances = r?.remittances||[]; }
async function preloadInfluencers(){ const r = await api('/api/influencers'); state.influencers = r?.influencers||[]; }
async function preloadInfluencerSpends(){ const r = await api('/api/influencers/spend'); state.influencerSpends = r?.spends||[]; }
async function preloadFinance(){ 
  const cats = await api('/api/finance/categories'); 
  const ent  = await api('/api/finance/entries'); 
  state.finance = { categories: cats || {debit:[],credit:[]}, entries: ent?.entries||[], running: ent?.running||0 };
}

/* ================================================================
   SHARED SELECT FILLERS (respect "China excluded" rule)
   ================================================================ */
function countriesNoChina() {
  return (state.countries||[]).filter(c => c.toLowerCase() !== 'china');
}
function fillSelectOptions(sel, arr, withAllOpt=false, allLabel='All countries') {
  if (!sel) return;
  const opts = [];
  if (withAllOpt) opts.push(`<option value="">${allLabel}</option>`);
  for (const v of arr) opts.push(`<option value="${v}">${v}</option>`);
  sel.innerHTML = opts.join('');
}
function fillGlobalSelects() {
  // Daily Ad Spend
  fillSelectOptions(Q('#adCountry'), countriesNoChina());
  fillSelectOptions(Q('#adProduct'), state.products.map(p=>({id:p.id,name:p.name})).map(p=>`<option value="${p.id}">${p.name}</option>`), false);
  // Stock movement (China allowed here)
  fillSelectOptions(Q('#mvFrom'), state.countries);
  fillSelectOptions(Q('#mvTo'), state.countries);
  fillSelectOptions(Q('#mvProduct'), state.products.map(p=>({id:p.id,name:p.name})).map(p=>`<option value="${p.id}">${p.name}</option>`), false);
  // Profit by Country
  fillSelectOptions(Q('#pcCountry'), countriesNoChina(), true);
  // Performance
  fillSelectOptions(Q('#pfCountry'), countriesNoChina(), true);
  fillSelectOptions(Q('#rCountry'), countriesNoChina());
  fillSelectOptions(Q('#rProduct'), state.products.map(p=>({id:p.id,name:p.name})).map(p=>`<option value="${p.id}">${p.name}</option>`), false);
  // Lifetime (global)
  fillSelectOptions(Q('#lpProduct'), [{id:'',name:'All products'}, ...state.products].map(p=>({id:p.id||'',name:p.name||'All products'})).map(p=>`<option value="${p.id}">${p.name}</option>`), false);
}

/* ================================================================
   NAV
   ================================================================ */
function initNav() {
  QA('.nav a[data-view]')?.forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    const v = a.dataset.view;
    ['home','products','performance','finance','settings'].forEach(id => {
      const el = Q('#'+id);
      if (el) el.style.display = (id===v) ? '' : 'none';
    });
    QA('.nav a').forEach(x => x.classList.toggle('active', x === a));
    if (v === 'home') { renderKpis(); renderStockAndSpendByCountry(); buildWeeklyDelivered(); renderTransitTables(); }
  }));
}

/* ================================================================
   DASHBOARD
   ================================================================ */
function sumBy(arr, fn){ return arr.reduce((a,x)=>a+(+fn(x)||0),0); }

function renderKpis() {
  Q('#kpiProducts').textContent = state.products.length;
  Q('#kpiCountries').textContent = countriesNoChina().length + 1; // show warehouses incl. China count visually
  const inTransit = state.shipments.filter(s=>!s.arrivedAt).length;
  Q('#kpiTransit').textContent = inTransit;

  // Total ad spend (sum adspend amounts)
  const totalAd = sumBy(state.adspend, x=>x.amount);
  Q('#kpiAdSpend').textContent = `${fmt(totalAd)} USD`;

  // Delivered Mon–Sun (current week) from delivery grid
  const {weekStart, weekEnd} = currentWeekRange();
  const weekDelivered = state.deliveries
    .filter(d => d.date>=weekStart && d.date<=weekEnd && d.country.toLowerCase()!=='china')
    .reduce((a,d)=>a+(+d.delivered||0),0);
  Q('#kpiDelivered').textContent = fmt(weekDelivered);
}

// Build country stock & ad spend table (China excluded)
function renderStockAndSpendByCountry() {
  const tbody = Q('#stockByCountryBody'); if (!tbody) return;

  // stock = sum of arrived shipments into country - sum of arrived shipments out of country
  const arrived = state.shipments.filter(s=>!!s.arrivedAt);
  const stockBy = {};
  for (const c of countriesNoChina()) stockBy[c]=0;

  for (const s of arrived) {
    if (s.toCountry && stockBy[s.toCountry] !== undefined) stockBy[s.toCountry] += (+s.qty||0);
    if (s.fromCountry && stockBy[s.fromCountry] !== undefined) stockBy[s.fromCountry] -= (+s.qty||0);
  }

  // ad spend by country (sum all products/platforms latest replacement values already upserted)
  const adBy = {};
  for (const c of countriesNoChina()) adBy[c]=0;
  for (const a of state.adspend) {
    if (a.country && adBy[a.country] !== undefined) adBy[a.country] += (+a.amount||0);
  }

  let rows = '';
  let totalStock = 0, totalAd = 0;
  for (const c of countriesNoChina()) {
    const st = stockBy[c]||0;
    const ad = adBy[c]||0;
    totalStock += st; totalAd += ad;
    rows += `<tr><td>${c}</td><td>${fmt(st)}</td><td>${fmt(ad)}</td></tr>`;
  }
  tbody.innerHTML = rows || `<tr><td colspan="3" class="muted">No data</td></tr>`;
  Q('#stockTotal').textContent = fmt(totalStock);
  Q('#adTotal').textContent = fmt(totalAd);
}

/* ---------------- Weekly Delivered Grid ---------------- */
let weekOffset = 0; // 0 = current week
function mondayOfWeek(d=new Date()) {
  const day = d.getDay(); // 0..6
  const diff = (day===0 ? -6 : 1 - day);
  const m = new Date(d); m.setDate(d.getDate() + diff);
  m.setHours(0,0,0,0);
  return m;
}
function currentWeekRange() {
  const base = new Date();
  base.setDate(base.getDate()+weekOffset*7);
  const start = mondayOfWeek(base);
  const end = new Date(start); end.setDate(start.getDate()+6);
  return { weekStart: start.toISOString().slice(0,10), weekEnd: end.toISOString().slice(0,10), start, end };
}
function buildWeeklyDelivered() {
  const head = Q('#weeklyHead'); const body = Q('#weeklyBody'); if (!head || !body) return;
  const {start, end, weekStart, weekEnd} = currentWeekRange();
  Q('#weeklyRange').textContent = `Week: ${weekStart} → ${weekEnd}`;

  // headers
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  let h = '<tr><th>Country</th>';
  for (let i=0;i<7;i++){
    const d = new Date(start); d.setDate(start.getDate()+i);
    h += `<th>${days[i]}<div class="muted">${d.toISOString().slice(0,10)}</div></th>`;
  }
  h += '<th>Total</th></tr>';
  head.innerHTML = h;

  // rows (all countries except China)
  let rows = '';
  for (const c of countriesNoChina()) {
    rows += `<tr data-cty="${c}"><th>${c}</th>`;
    let rowTotal = 0;
    for (let i=0;i<7;i++){
      const d = new Date(start); d.setDate(start.getDate()+i);
      const ds = d.toISOString().slice(0,10);
      const existing = state.deliveries.find(x=>x.country===c && x.date===ds)?.delivered || '';
      rowTotal += (+existing||0);
      rows += `<td><input data-date="${ds}" class="input tiny" value="${existing}"></td>`;
    }
    rows += `<td class="right">${fmt(rowTotal)}</td></tr>`;
  }
  body.innerHTML = rows;

  // totals bottom
  updateWeeklyTotals();

  // input change → update totals
  body.addEventListener('input', updateWeeklyTotals, { once: true });
}
function updateWeeklyTotals() {
  const body = Q('#weeklyBody'); if (!body) return;
  const daysTotals = [0,0,0,0,0,0,0];
  let all = 0;
  QA('tr', body).forEach(tr => {
    const cells = QA('input', tr);
    let rowTotal = 0;
    cells.forEach((inp, i) => { const v = +inp.value||0; rowTotal += v; daysTotals[i]+=v; });
    tr.lastElementChild.textContent = fmt(rowTotal);
    all += rowTotal;
  });
  const ids = ['wMonT','wTueT','wWedT','wThuT','wFriT','wSatT','wSunT'];
  ids.forEach((id,i)=>{ const el=Q('#'+id); if (el) el.textContent = fmt(daysTotals[i]); });
  const allEl = Q('#wAllT'); if (allEl) allEl.textContent = fmt(all);
}

Q('#weeklyPrev')?.addEventListener('click', ()=>{ weekOffset--; buildWeeklyDelivered(); });
Q('#weeklyNext')?.addEventListener('click', ()=>{ weekOffset++; buildWeeklyDelivered(); });
Q('#weeklyReset')?.addEventListener('click', ()=>{ weekOffset=0; buildWeeklyDelivered(); });

Q('#weeklySave')?.addEventListener('click', async () => {
  const body = Q('#weeklyBody'); if (!body) return;
  const reqs = [];
  QA('tr', body).forEach(tr => {
    const country = tr.getAttribute('data-cty');
    QA('input', tr).forEach(inp => {
      const delivered = +inp.value||0;
      const date = inp.getAttribute('data-date');
      if (delivered>=0 && country && date) {
        reqs.push(api('/api/deliveries', { method:'POST', body: JSON.stringify({ country, date, delivered }) }));
      }
    });
  });
  await Promise.all(reqs);
  await preloadDeliveries();
  buildWeeklyDelivered();
  renderKpis();
});

/* ---------------- Daily Ad Spend ---------------- */
Q('#adSave')?.addEventListener('click', async () => {
  const platform = Q('#adPlatform')?.value;
  const productId = Q('#adProduct')?.value;
  const country  = Q('#adCountry')?.value;
  const amount   = +Q('#adAmount')?.value || 0;
  if (!platform || !productId || !country) return alert('Select product, platform, country');
  await api('/api/adspend', { method:'POST', body: JSON.stringify({ productId, platform, country, amount }) });
  await preloadAdspend();
  renderStockAndSpendByCountry();
  alert('Saved.');
});

/* ---------------- Stock Movement (shipments) ---------------- */
Q('#mvAdd')?.addEventListener('click', async () => {
  const fromCountry = Q('#mvFrom')?.value; const toCountry = Q('#mvTo')?.value;
  const productId = Q('#mvProduct')?.value;
  const qty = +Q('#mvQty')?.value||0; const shipCost=+Q('#mvShip')?.value||0;
  if (!fromCountry || !toCountry || !productId) return alert('Select from, to, product');
  await api('/api/shipments', { method:'POST', body: JSON.stringify({ fromCountry, toCountry, productId, qty, shipCost }) });
  await preloadShipments();
  renderTransitTables();
  alert('Shipment created.');
});

function daysBetween(a,b) {
  if (!a || !b) return '';
  const d1 = new Date(a), d2 = new Date(b);
  return Math.round((d2-d1)/(24*3600*1000));
}
function renderTransitTables() {
  const ckBody = Q('#shipCKBody'); const icBody = Q('#shipICBody');
  if (!ckBody || !icBody) return;

  const rowsCK = [];
  const rowsIC = [];
  for (const s of state.shipments) {
    const prod = state.products.find(p=>p.id===s.productId)?.name || '—';
    const route = `${s.fromCountry} → ${s.toCountry}`;
    const r = `<tr data-id="${s.id}">
      <td>${s.id.slice(0,8)}</td><td>${prod}</td><td>${route}</td>
      <td><input class="input tiny" data-edit="qty" value="${s.qty}"></td>
      <td><input class="input tiny" data-edit="shipCost" value="${s.shipCost}"></td>
      <td><input class="input tiny" data-edit="departedAt" value="${s.departedAt||''}" placeholder="YYYY-MM-DD"></td>
      <td><input class="input tiny" data-edit="arrivedAt" value="${s.arrivedAt||''}" placeholder="YYYY-MM-DD"></td>
      <td>${s.arrivedAt?daysBetween(s.departedAt,s.arrivedAt):''}</td>
      <td>
        <button class="btn outline" data-action="save">Save</button>
        <button class="btn danger outline" data-action="del">Delete</button>
      </td>
    </tr>`;
    if ((s.fromCountry?.toLowerCase()==='china') && (s.toCountry?.toLowerCase()==='kenya')) rowsCK.push(r);
    else rowsIC.push(r);
  }
  ckBody.innerHTML = rowsCK.join('') || `<tr><td colspan="9" class="muted">No data</td></tr>`;
  icBody.innerHTML = rowsIC.join('') || `<tr><td colspan="9" class="muted">No data</td></tr>`;
}

function bindTransitDelegation(rootId){
  const root = Q(rootId); if (!root) return;
  root.addEventListener('click', async e => {
    const btn = e.target.closest('button'); if (!btn) return;
    const tr = e.target.closest('tr'); const id = tr?.getAttribute('data-id');
    if (!id) return;
    if (btn.dataset.action==='del') {
      if (!confirm('Delete shipment?')) return;
      await api(`/api/shipments/${id}`, { method:'DELETE' });
      await preloadShipments();
      renderTransitTables(); // stay on page
    }
    if (btn.dataset.action==='save') {
      // gather edited fields
      const payload = {};
      QA('input[data-edit]', tr).forEach(i => payload[i.dataset.edit] = i.value);
      await api(`/api/shipments/${id}`, { method:'PUT', body: JSON.stringify(payload) });
      await preloadShipments();
      renderTransitTables(); // stay on page
    }
  });
}
bindTransitDelegation('#shipCK');
bindTransitDelegation('#shipIC');

/* ---------------- Profit by Country (date range) ---------------- */
Q('#pcRun')?.addEventListener('click', () => {
  const country = Q('#pcCountry')?.value || '';
  const start = Q('#pcStart')?.value || '';
  const end = Q('#pcEnd')?.value || '';
  const tb = Q('#profitCountryBody'); if (!tb) return;

  // Filter remittances by period and country (China excluded in selects already)
  let list = state.remittances.slice();
  if (start) list = list.filter(r=>r.start>=start);
  if (end)   list = list.filter(r=>r.end<=end);
  if (country) list = list.filter(r=>r.country===country);

  // Aggregate per country
  const byC = {};
  for (const r of list) {
    if (!byC[r.country]) byC[r.country] = { revenue:0, ad:0, pieces:0, delivery:0, profit:0 };
    const base = baseCostFor(r.productId) * (r.pieces||0);
    const shipping = shippingCostFor(r.productId) * (r.pieces||0);
    const extra = (+r.extraPerPiece||0) * (r.pieces||0);
    const profit = (+r.revenue||0) - (+r.adSpend||0) - base - shipping - extra;
    byC[r.country].revenue += (+r.revenue||0);
    byC[r.country].ad      += (+r.adSpend||0);
    byC[r.country].pieces  += (+r.pieces||0);
    byC[r.country].delivery+= extra;
    byC[r.country].profit  += profit;
  }

  let rows = '';
  let tRev=0,tAd=0,tDel=0,tPc=0,tPr=0;
  for (const [c,v] of Object.entries(byC)) {
    tRev+=v.revenue; tAd+=v.ad; tDel+=v.delivery; tPc+=v.pieces; tPr+=v.profit;
    rows += `<tr><td>${c}</td><td>${fmt(v.revenue)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.delivery)}</td><td>${fmt(v.pieces)}</td><td>${fmt(v.profit)}</td></tr>`;
  }
  tb.innerHTML = rows || `<tr><td colspan="6" class="muted">No data</td></tr>`;
  Q('#pcRevT').textContent=fmt(tRev);
  Q('#pcAdT').textContent=fmt(tAd);
  Q('#pcDelT').textContent=fmt(tDel);
  Q('#pcPiecesT').textContent=fmt(tPc);
  Q('#pcProfitT').textContent=fmt(tPr);
});

function baseCostFor(pid){ const p=state.products.find(x=>x.id===pid); return (p?.cost_china||0); }
function shippingCostFor(pid){ const p=state.products.find(x=>x.id===pid); return (p?.ship_china_to_kenya||0); }

/* ---------------- To-Do (localStorage) ---------------- */
const TODO_KEY='eas:todo', WTODO_KEY='eas:wtodo';
function loadLS(key,def){try{return JSON.parse(localStorage.getItem(key)||'')}catch{return def}}
function saveLS(key,val){localStorage.setItem(key,JSON.stringify(val))}
function renderTodos(){
  const wrap = Q('#todoList'); if (!wrap) return;
  const items = loadLS(TODO_KEY,[])||[];
  wrap.innerHTML = (items.map((t,i)=>`<div><span>${t.text}</span><button class="btn tiny danger outline" data-del="${i}">Delete</button></div>`).join('') || '<div class="muted">No tasks</div>');
  wrap.onclick = e=>{
    const idx = e.target.getAttribute('data-del'); if (idx==null) return;
    items.splice(+idx,1); saveLS(TODO_KEY,items); renderTodos();
  };
}
Q('#todoAdd')?.addEventListener('click',()=>{
  const t = Q('#todoText')?.value?.trim(); if(!t) return;
  const items = loadLS(TODO_KEY,[])||[]; items.push({text:t}); saveLS(TODO_KEY,items);
  Q('#todoText').value=''; renderTodos();
});
function renderWeeklyTodos(){
  const wrap = Q('#weeklyWrap'); if (!wrap) return;
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const store = loadLS(WTODO_KEY,{})||{};
  wrap.innerHTML = days.map((d,i)=>`
    <div class="card mini"><div class="h">${d}</div>
      <div class="row">
        <input class="input" id="w${i}txt" placeholder="Task"/><button class="btn tiny" data-add="${i}">Add</button>
      </div>
      <div id="w${i}list">${(store[i]||[]).map((t,idx)=>`<div class="chip">${t}<button class="x" data-del="${i}|${idx}">×</button></div>`).join('')}</div>
    </div>`).join('');
  wrap.onclick = e=>{
    const a = e.target.getAttribute('data-add');
    const d = e.target.getAttribute('data-del');
    const store2 = loadLS(WTODO_KEY,{})||{};
    if (a!=null){
      const v = Q(`#w${a}txt`)?.value?.trim(); if(!v) return;
      store2[a] = store2[a]||[]; store2[a].push(v); saveLS(WTODO_KEY,store2); renderWeeklyTodos();
    } else if (d){
      const [i,idx]=d.split('|'); (store2[i]||[]).splice(+idx,1); saveLS(WTODO_KEY,store2); renderWeeklyTodos();
    }
  };
}

/* ================================================================
   PERFORMANCE
   ================================================================ */
function initPerformance(){
  // quick range helper
  Q('#pfQuick')?.addEventListener('change', e=>{
    const v = e.target.value;
    if (v==='custom') return;
    const end = new Date(); const start = new Date(); start.setDate(end.getDate()-(+v-1));
    Q('#pfStart').value = start.toISOString().slice(0,10);
    Q('#pfEnd').value   = end.toISOString().slice(0,10);
  });

  Q('#pfRun')?.addEventListener('click', async () => {
    const quick = Q('#pfQuick')?.value;
    let start = Q('#pfStart')?.value, end = Q('#pfEnd')?.value;
    const c = Q('#pfCountry')?.value || '';

    if (quick && quick!=='custom'){
      const d = new Date(); const s = new Date(); s.setDate(d.getDate()-(+quick-1));
      start = s.toISOString().slice(0,10); end = d.toISOString().slice(0,10);
    }
    const byP = {};
    const prodMap = Object.fromEntries(state.products.map(p=>[p.id,p]));
    // use remittances for pieces/revenue/ad; filter by time & country
    let list = state.remittances.slice();
    if (start) list = list.filter(r=>r.start>=start);
    if (end)   list = list.filter(r=>r.end<=end);
    if (c)     list = list.filter(r=>r.country===c);
    for (const r of list) {
      const id = r.productId;
      if (!byP[id]) byP[id] = { product: prodMap[id]?.name||id, country: r.country||'', pieces:0, ad:0, prodCost:0, profit:0 };
      const base = (prodMap[id]?.cost_china||0) * (+r.pieces||0);
      const ship = (prodMap[id]?.ship_china_to_kenya||0) * (+r.pieces||0);
      const extra = (+r.extraPerPiece||0) * (+r.pieces||0);
      const profit = (+r.revenue||0) - (+r.adSpend||0) - base - ship - extra;
      byP[id].pieces += (+r.pieces||0);
      byP[id].ad     += (+r.adSpend||0);
      byP[id].prodCost += base + ship + extra;
      byP[id].profit += profit;
      byP[id].country = c || '—';
    }
    const tb = Q('#pfTable tbody'); if (!tb) return;
    tb.innerHTML = Object.values(byP).sort((a,b)=>b.pieces-a.pieces).map(it =>
      `<tr><td>${it.product}</td><td>${it.country}</td><td>${fmt(it.pieces)}</td><td>${fmt(it.ad)}</td><td>${fmt(it.prodCost)}</td><td>${fmt(it.profit)}</td><td>${it.pieces?fmt(it.profit/it.pieces):'0'}</td></tr>`
    ).join('') || `<tr><td colspan="7" class="muted">No data</td></tr>`;
  });

  // Remittance add
  Q('#rAdd')?.addEventListener('click', async ()=>{
    const payload = {
      start: Q('#rStart')?.value, end: Q('#rEnd')?.value,
      country: Q('#rCountry')?.value, productId: Q('#rProduct')?.value,
      orders:+Q('#rOrders')?.value||0, pieces:+Q('#rPieces')?.value||0,
      revenue:+Q('#rRev')?.value||0, adSpend:+Q('#rAds')?.value||0,
      extraPerPiece:+Q('#rExtra')?.value||0,
    };
    if (!payload.start || !payload.end || !payload.country || !payload.productId) return alert('Fill required fields');
    const r = await api('/api/remittances', { method:'POST', body: JSON.stringify(payload) });
    if (r?.error) return alert(r.error);
    await preloadRemittances();
    renderRemittanceTable();
    alert('Added.');
  });

  renderRemittanceTable();
}

function renderRemittanceTable(){
  const tb = Q('#rTable tbody'); if (!tb) return;
  const prodMap = Object.fromEntries(state.products.map(p=>[p.id,p.name]));
  tb.innerHTML = state.remittances.map(r => `
    <tr>
      <td>${prodMap[r.productId]||r.productId}</td>
      <td>${r.country}</td>
      <td>${r.start}</td>
      <td>${r.end}</td>
      <td>${fmt(r.orders)}</td>
      <td>${fmt(r.pieces)}</td>
      <td>${fmt(r.revenue)}</td>
      <td>${fmt(r.adSpend)}</td>
      <td>${fmt(r.extraPerPiece)}</td>
      <td><button class="btn outline danger" data-del-remit="${r.id}">Delete</button></td>
    </tr>`).join('') || `<tr><td colspan="10" class="muted">No entries</td></tr>`;

  tb.onclick = async e=>{
    const id = e.target.getAttribute('data-del-remit');
    if (!id) return;
    if (!confirm('Delete this remittance?')) return;
    await api(`/api/remittances/${id}`, { method:'DELETE' });
    await preloadRemittances();
    renderRemittanceTable();
  };
}

/* ================================================================
   FINANCE
   ================================================================ */
function initFinance(){
  // categories
  const debWrap = Q('#fcDebits'); const creWrap = Q('#fcCredits');
  function renderCats(){
    const cats = state.finance.categories || {debit:[],credit:[]};
    debWrap.innerHTML = (cats.debit||[]).map(c=>`<span class="chip">${c}<button class="x" data-del-debit="${c}">×</button></span>`).join('')||'<span class="muted">None</span>';
    creWrap.innerHTML = (cats.credit||[]).map(c=>`<span class="chip">${c}<button class="x" data-del-credit="${c}">×</button></span>`).join('')||'<span class="muted">None</span>';
    // fill entry category select
    const feCat = Q('#feCat');
    feCat.innerHTML = [...(cats.debit||[]),(cats.debit?.length&&cats.credit?.length?'────────':'') , ...(cats.credit||[])]
      .filter(Boolean)
      .map(c=>`<option value="${c}">${c}</option>`).join('');
  }
  renderCats();

  Q('#fcAdd')?.addEventListener('click', async ()=>{
    const type = Q('#fcType').value; const name = Q('#fcName').value.trim();
    if (!type || !name) return;
    await api('/api/finance/categories',{method:'POST', body:JSON.stringify({type,name})});
    await preloadFinance(); renderCats(); alert('Added.');
  });

  debWrap?.addEventListener('click', async e=>{
    const name = e.target.getAttribute('data-del-debit'); if (!name) return;
    if (!confirm(`Delete debit category "${name}" and remove its entries?`)) return;
    await api(`/api/finance/categories?type=debit&name=${encodeURIComponent(name)}`, { method:'DELETE' });
    // also filter out entries client-side (server already removes entries via separate calls when you delete by id; here we just refresh)
    await preloadFinance(); renderCats(); renderFinanceEntries(); alert('Deleted.');
  });
  creWrap?.addEventListener('click', async e=>{
    const name = e.target.getAttribute('data-del-credit'); if (!name) return;
    if (!confirm(`Delete credit category "${name}" and remove its entries?`)) return;
    await api(`/api/finance/categories?type=credit&name=${encodeURIComponent(name)}`, { method:'DELETE' });
    await preloadFinance(); renderCats(); renderFinanceEntries(); alert('Deleted.');
  });

  // entries add
  Q('#feAdd')?.addEventListener('click', async ()=>{
    const payload = {
      date: Q('#feDate')?.value, type: Q('#feType')?.value,
      category: Q('#feCat')?.value, amount:+Q('#feAmt')?.value||0,
      note: Q('#feNote')?.value||''
    };
    if (!payload.date || !payload.type || !payload.category) return alert('Missing required fields');
    await api('/api/finance/entries', { method:'POST', body: JSON.stringify(payload) });
    await preloadFinance(); renderFinanceEntries(); renderRunningBalance();
  });

  // range run
  Q('#feRun')?.addEventListener('click', async ()=>{
    const start = Q('#fes')?.value||''; const end = Q('#fee')?.value||'';
    const r = await api(`/api/finance/entries?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
    state.finance.entries = r?.entries||[];
    Q('#feBalance').textContent = `Period Balance: ${fmt(r?.balance||0)} USD`;
    renderFinanceEntries();
  });

  renderRunningBalance();
  renderFinanceEntries();
}
function renderRunningBalance(){
  const el = Q('#runBalance'); if (!el) return;
  el.textContent = `${fmt(state.finance?.running||0)} USD`;
}
function renderFinanceEntries(){
  const tb = Q('#feTable tbody'); if (!tb) return;
  tb.innerHTML = (state.finance.entries||[]).map(e=>`
    <tr>
      <td>${e.date}</td><td>${e.type}</td><td>${e.category}</td>
      <td>${fmt(e.amount)}</td><td>${e.note||''}</td>
      <td><button class="btn tiny danger outline" data-del-entry="${e.id}">Delete</button></td>
    </tr>`).join('') || `<tr><td colspan="6" class="muted">No entries</td></tr>`;
  tb.onclick = async ev=>{
    const id = ev.target.getAttribute('data-del-entry'); if (!id) return;
    if (!confirm('Delete entry?')) return;
    await api(`/api/finance/entries/${id}`, { method:'DELETE' });
    await preloadFinance(); renderFinanceEntries(); renderRunningBalance();
  };
}

/* ================================================================
   SETTINGS
   ================================================================ */
function initSettings(){
  // Countries add/delete (China undeletable; server enforces too)
  const list = Q('#ctyList'); if (!list) return;
  function renderCountries(){
    list.innerHTML = state.countries.map(c=>{
      const lock = c.toLowerCase()==='china';
      return `<span class="chip">${c}${lock?'<span class="muted"> (locked)</span>':`<button class="x" data-del-cty="${c}">×</button>`}</span>`;
    }).join('') || '<span class="muted">None</span>';
  }
  renderCountries();

  Q('#ctyAdd')?.addEventListener('click', async ()=>{
    const name = Q('#cty')?.value?.trim(); if(!name) return;
    await api('/api/countries',{method:'POST', body: JSON.stringify({ name })});
    await preloadCountries(); renderCountries(); fillGlobalSelects(); alert('Added.');
  });
  list.addEventListener('click', async e=>{
    const name = e.target.getAttribute('data-del-cty'); if(!name) return;
    if (!confirm(`Delete country "${name}"?`)) return;
    const r = await api(`/api/countries/${encodeURIComponent(name)}`, { method:'DELETE' });
    if (r?.error) return alert(r.error);
    await preloadCountries(); renderCountries(); fillGlobalSelects(); renderStockAndSpendByCountry(); buildWeeklyDelivered();
  });

  // Edit product info
  const sel = Q('#epSelect');
  if (sel) sel.innerHTML = `<option value="">Select product…</option>` + state.products.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  sel?.addEventListener('change', ()=>{
    const p = state.products.find(x=>x.id===sel.value);
    Q('#epName').value = p?.name||'';
    Q('#epSku').value = p?.sku||'';
    Q('#epCost').value = p?.cost_china||'';
    Q('#epShip').value = p?.ship_china_to_kenya||'';
    Q('#epMB').value = p?.margin_budget||'';
  });
  Q('#epSave')?.addEventListener('click', async ()=>{
    const id = sel.value; if (!id) return alert('Select a product');
    const payload = {
      name: Q('#epName').value, sku: Q('#epSku').value,
      cost_china:+Q('#epCost').value||0,
      ship_china_to_kenya:+Q('#epShip').value||0,
      margin_budget:+Q('#epMB').value||0
    };
    await api(`/api/products/${id}`, { method:'PUT', body: JSON.stringify(payload) });
    await preloadProducts(); fillGlobalSelects(); alert('Saved.');
  });

  // Products table for list view (open & delete)
  const ptb = Q('#productsTable tbody');
  if (ptb) {
    ptb.innerHTML = state.products.map(p=>`
      <tr>
        <td>${p.name}</td><td>${p.sku||''}</td><td>${p.status}</td>
        <td>
          <a class="btn outline" href="product.html?id=${p.id}">Open</a>
          <button class="btn danger outline" data-del-prod="${p.id}">Delete</button>
        </td>
      </tr>`).join('') || `<tr><td colspan="4" class="muted">No products</td></tr>`;
    ptb.onclick = async e=>{
      const id = e.target.getAttribute('data-del-prod'); if (!id) return;
      if (!confirm('Delete product and cascade all its data?')) return;
      await api(`/api/products/${id}`, { method:'DELETE' });
      await preloadProducts(); await preloadAdspend(); await preloadShipments(); await preloadRemittances(); await preloadInfluencerSpends();
      fillGlobalSelects(); initSettings(); renderStockAndSpendByCountry();
      alert('Deleted.');
    };
  }

  // Snapshots list is handled by snapshot.js (separate file)
}

/* ================================================================
   PRODUCT PAGE (product.html)
   ================================================================ */
async function loadProduct(id){
  if (!state.products.length) await preloadProducts();
  state.productId = id;
}
function renderProductPage(){
  // Only run on product.html elements
  const pid = state.productId; if (!pid) return;
  const p = state.products.find(x=>x.id===pid); if (!p) return;

  // Header
  Q('#pNameHdr')?.replaceChildren(document.createTextNode(p.name));

  // Stock & Ad Spend by Country for THIS product (China excluded for table)
  const tbody = Q('#pStockByCountry'); if (tbody) {
    const arrived = state.shipments.filter(s=>s.productId===pid && s.arrivedAt);
    const stockBy = {}; countriesNoChina().forEach(c=>stockBy[c]=0);
    for (const s of arrived) {
      if (stockBy[s.toCountry]!==undefined) stockBy[s.toCountry]+= (+s.qty||0);
      if (stockBy[s.fromCountry]!==undefined) stockBy[s.fromCountry]-= (+s.qty||0);
    }
    const adBy={}; countriesNoChina().forEach(c=>adBy[c]=0);
    for (const a of state.adspend.filter(a=>a.productId===pid)) {
      if (adBy[a.country]!==undefined) adBy[a.country]+= (+a.amount||0);
    }
    let rows=''; let tS=0,tA=0;
    for (const c of countriesNoChina()) { const s=stockBy[c]||0, a=adBy[c]||0; tS+=s; tA+=a; rows+=`<tr><td>${c}</td><td>${fmt(s)}</td><td>${fmt(a)}</td></tr>`; }
    tbody.innerHTML = rows || `<tr><td colspan="3" class="muted">No data</td></tr>`;
    Q('#pStockT').textContent=fmt(tS); Q('#pAdT').textContent=fmt(tA);
  }

  // Transit tables filtered to this product
  const ic = Q('#pShipIC'); const ck = Q('#pShipCK');
  function render(){
    const list = state.shipments.filter(s=>s.productId===pid);
    const rowsCK = [], rowsIC=[];
    for (const s of list) {
      const tr = `<tr data-id="${s.id}">
        <td>${s.id.slice(0,8)}</td><td>${s.fromCountry} → ${s.toCountry}</td>
        <td><input class="input tiny" data-edit="qty" value="${s.qty}"></td>
        <td><input class="input tiny" data-edit="shipCost" value="${s.shipCost}"></td>
        <td><input class="input tiny" data-edit="departedAt" value="${s.departedAt||''}"></td>
        <td><input class="input tiny" data-edit="arrivedAt" value="${s.arrivedAt||''}"></td>
        <td>${s.arrivedAt?daysBetween(s.departedAt,s.arrivedAt):''}</td>
        <td><button class="btn outline" data-action="save">Save</button><button class="btn danger outline" data-action="del">Delete</button></td>
      </tr>`;
      if ((s.fromCountry?.toLowerCase()==='china') && (s.toCountry?.toLowerCase()==='kenya')) rowsCK.push(tr);
      else rowsIC.push(tr);
    }
    Q('#pShipCKBody')?.replaceChildren(...((new DOMParser()).parseFromString(`<tbody>${rowsCK.join('')||`<tr><td colspan="8" class="muted">No data</td></tr>`}</tbody>`,'text/html').body.firstChild.childNodes));
    Q('#pShipICBody')?.replaceChildren(...((new DOMParser()).parseFromString(`<tbody>${rowsIC.join('')||`<tr><td colspan="8" class="muted">No data</td></tr>`}</tbody>`,'text/html').body.firstChild.childNodes));
  }
  render();
  // stay on product page after actions
  function bind(rootSel){
    Q(rootSel)?.addEventListener('click', async e=>{
      const btn=e.target.closest('button'); if(!btn) return;
      const tr=e.target.closest('tr'); const id=tr?.getAttribute('data-id'); if(!id) return;
      if(btn.dataset.action==='del'){ if(!confirm('Delete shipment?')) return; await api(`/api/shipments/${id}`,{method:'DELETE'}); await preloadShipments(); render(); }
      if(btn.dataset.action==='save'){ const payload={}; QA('input[data-edit]',tr).forEach(i=>payload[i.dataset.edit]=i.value); await api(`/api/shipments/${id}`,{method:'PUT',body:JSON.stringify(payload)}); await preloadShipments(); render(); }
    });
  }
  bind('#pShipCK'); bind('#pShipIC');

  // Influencers list/add/delete for this product (country select excludes China)
  const infSel = Q('#pInfCountry'); if (infSel) fillSelectOptions(infSel, countriesNoChina(), true, 'All countries');
  const infAddBtn = Q('#pInfAdd');
  const infList = Q('#pInfList');

  function renderInfluencers(){
    if (!infList) return;
    infList.innerHTML = state.influencers.map(i=>`
      <tr><td>${i.name}</td><td>${i.social||''}</td><td>${i.country||''}</td>
      <td><button class="btn tiny danger outline" data-del-inf="${i.id}">Delete</button></td></tr>
    `).join('') || `<tr><td colspan="4" class="muted">No influencers</td></tr>`;
  }
  renderInfluencers();
  infList?.addEventListener('click', async e=>{
    const id = e.target.getAttribute('data-del-inf'); if(!id) return;
    if(!confirm('Delete influencer and all spends?')) return;
    await api(`/api/influencers/${id}`, { method:'DELETE' });
    // cascade influencerSpends client-side
    state.influencerSpends = state.influencerSpends.filter(s=>s.influencerId!==id);
    await preloadInfluencers(); renderInfluencers();
  });

  infAddBtn?.addEventListener('click', async ()=>{
    const name = Q('#pInfName')?.value?.trim(); if (!name) return alert('Name required');
    const social = Q('#pInfHandle')?.value||''; const country = Q('#pInfCountry')?.value||'';
    const r = await api('/api/influencers', { method:'POST', body: JSON.stringify({ name, social, country }) });
    if (r?.error) return alert(r.error);
    await preloadInfluencers(); renderInfluencers(); Q('#pInfName').value=''; Q('#pInfHandle').value='';
  });
}

/* ================================================================
   BOOT
   ================================================================ */
renderTodos();
renderWeeklyTodos();
gate();
