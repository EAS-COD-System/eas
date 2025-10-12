/* =================================================================
   EAS Tracker - Frontend
   Single-file vanilla JS (no build step)
   ================================================================= */

const state = {
  countries: [],
  products: [],
  remittances: [],
  adspend: [],
  deliveries: [],
  shipments: [],
  influencers: [],
  influencerSpends: [],
  finance: { categories: { debit: [], credit: [] }, entries: [] },
  productId: new URLSearchParams(location.search).get('id') || null
};

/* ---------------- tiny helpers ---------------- */
const Q  = (s, r=document) => r.querySelector(s);
const QA = (s, r=document) => Array.from(r.querySelectorAll(s));
const todayISO = () => new Date().toISOString().slice(0,10);
const fmt = n => Number(n||0).toLocaleString(undefined, {maximumFractionDigits:2});
const sum = arr => arr.reduce((a,b)=>a+(+b||0),0);
const dayms = 24*3600*1000;

/* robust fetch */
async function api(url, opt = {}) {
  const o = {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',          // <— force cookie on ALL requests
    ...opt
  };
  const res = await fetch(url, o);
  if (!res.ok) {
    // bubble up the status so gate() can decide
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || ('HTTP ' + res.status));
  }
  return res.json().catch(() => ({}));
}

/* ---------------- gate (auth + boot) ---------------- */
async function gate() {
  try {
    await preloadAll();
    // hide login, show app
    Q('#login')?.classList.add('hide');
    const main = Q('#main'); if (main){ main.classList.remove('hide'); main.style.display=''; }

    // fill selects after meta loaded
    fillGlobalSelects();
    initNav();

    if (state.productId) {
      await loadProduct(state.productId);
      renderProductPage(); // on product.html
    } else {
      initDashboard();
      initProducts();
      initPerformance();
      initFinance();
      initSettings();
      renderKpis();
      renderStockAndSpendByCountry();
      renderWeeklyGrid();
      renderTransitTables();
    }
  } catch (e) {
    // not authenticated yet
    Q('#login')?.classList.remove('hide');
    Q('#main')?.classList.add('hide');
  }
}
/* login / logout */
Q('#loginBtn')?.addEventListener('click', async () => {
  const pw = Q('#pw')?.value?.trim();
  if (!pw) return alert('Enter password');

  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',          // ensure auth cookie is set
      body: JSON.stringify({ password: pw })
    });

    if (res.ok) {
      // flip views
      const login = Q('#login');
      const main  = Q('#main');
      if (login) { login.classList.add('hide'); login.style.display = 'none'; }
      if (main)  { main.classList.remove('hide'); main.style.display = ''; }
      await gate();                     // boot the app after successful auth
    } else {
      alert('Wrong password');
    }
  } catch (err) {
    alert('Network error while logging in. Please try again.');
    console.error(err);
  }
});

Q('#logoutLink')?.addEventListener('click', async (e) => {
  e.preventDefault();
  try {
    await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ password: 'logout' })
    });
  } finally {
    location.reload();
  }
});

/* ---------------- data preload ---------------- */
async function preloadAll() {
  // meta
  const meta = await api('/api/meta');
  state.countries = meta.countries || [];

  // batch-ish loads
  const [p, d, s, r, a, inf, isp, fin] = await Promise.all([
    api('/api/products'),
    api('/api/deliveries'),
    api('/api/shipments'),
    api('/api/remittances'),
    api('/api/adspend'),
    api('/api/influencers'),
    api('/api/influencers/spend'),
    Promise.all([api('/api/finance/categories'), api('/api/finance/entries')])
  ]);

  state.products      = p.products || [];
  state.deliveries    = d.deliveries || [];
  state.shipments     = s.shipments || [];
  state.remittances   = r.remittances || [];
  state.adspend       = a.adSpends || [];
  state.influencers   = inf.influencers || [];
  state.influencerSpends = isp.spends || [];
  state.finance.categories = fin[0] || {debit:[], credit:[]};
  state.finance.entries    = fin[1].entries || [];
}

/* ---------------- global selects with china rules ---------------- */
function optionsFrom(arr, {excludeChina=false}={}) {
  const src = excludeChina ? arr.filter(c=>c.toLowerCase()!=='china') : arr.slice();
  return src.map(c=>`<option value="${c}">${c}</option>`).join('');
}
function fillCountrySelect(sel){
  const exclude = sel.dataset.exclude === 'china';
  const allowChina = sel.dataset.allowChina === '1';
  let list = state.countries.slice();
  if (!allowChina) list = list.filter(c => c.toLowerCase() !== 'china');
  if (!exclude) { /* ok */ }
  sel.innerHTML = optionsFrom(list, {excludeChina: !allowChina});
}
function fillProductSelect(sel, withAll=false){
  const opts = (withAll? [`<option value="">All products</option>`]:[])
    .concat(state.products.map(p=>`<option value="${p.id}">${p.name}</option>`));
  sel.innerHTML = opts.join('');
}
function fillGlobalSelects(){
  QA('select.input').forEach(s=>{
    if (s.id?.startsWith('pc') || s.dataset.exclude==='china') fillCountrySelect(s);
  });
  // explicit lists
  ['adCountry','mvFrom','mvTo','rCountry','pfCountry'].forEach(id=>{
    const el = Q('#'+id); if (!el) return;
    fillCountrySelect(el);
  });
  ['adProduct','mvProduct','rProduct','lpProduct','epSelect'].forEach(id=>{
    const el = Q('#'+id); if (!el) return;
    fillProductSelect(el, ['lpProduct'].includes(id));
  });
}

/* =================================================================
   DASHBOARD
   ================================================================= */
function initDashboard(){
  // Daily ad spend: replace
  Q('#adSave')?.addEventListener('click', async () => {
    try {
      const platform = Q('#adPlatform').value;
      const productId= Q('#adProduct').value;
      const country  = Q('#adCountry').value;
      const amount   = +Q('#adAmount').value || 0;
      if (!productId || !country) return alert('Pick product & country');
      await api('/api/adspend', { method:'POST', body:JSON.stringify({ platform, productId, country, amount })});
      await refreshAdspend();
      renderStockAndSpendByCountry();
      renderKpis();
      alert('Saved.');
    } catch(e){ alert('Failed to save ad spend'); }
  });

  // Stock movement (shipment create)
  Q('#mvAdd')?.addEventListener('click', async () => {
    try{
      const fromCountry = Q('#mvFrom').value;
      const toCountry   = Q('#mvTo').value;
      const productId   = Q('#mvProduct').value;
      const qty         = +Q('#mvQty').value||0;
      const shipCost    = +Q('#mvShip').value||0;
      if (!fromCountry || !toCountry || !productId) return alert('Pick all fields');
      await api('/api/shipments', { method:'POST', body: JSON.stringify({ fromCountry, toCountry, productId, qty, shipCost })});
      await refreshShipments();
      renderTransitTables();
      alert('Shipment added.');
    }catch(e){ alert('Failed to add shipment'); }
  });

  // To-Do (local)
  const list = Q('#todoList');
  Q('#todoAdd')?.addEventListener('click', ()=>{
    const v = (Q('#todoText').value||'').trim();
    if (!v) return;
    const id='t'+Date.now();
    const n = {id, text:v, done:false};
    const items = loadLocal('todo',[]);
    items.push(n);
    saveLocal('todo', items);
    Q('#todoText').value='';
    renderTodo();
  });
  list?.addEventListener('click', e=>{
    const id = e.target.closest('[data-id]')?.dataset.id;
    if (!id) return;
    const items = loadLocal('todo',[]);
    if (e.target.matches('input[type=checkbox]')) {
      const it = items.find(x=>x.id===id); if (it) it.done = e.target.checked;
      saveLocal('todo', items); renderTodo();
    }
    if (e.target.matches('[data-del]')) {
      saveLocal('todo', items.filter(x=>x.id!==id)); renderTodo();
    }
  });
  renderTodo();
  renderWeeklyTodo();
}

/* KPIs */
function renderKpis(){
  // products
  Q('#kpiProducts').textContent = state.products.length;
  // countries (excluding china)
  const cts = state.countries.filter(c=>c.toLowerCase()!=='china');
  Q('#kpiCountries').textContent = cts.length;
  // transit
  Q('#kpiTransit').textContent = state.shipments.filter(s=>!s.arrivedAt).length;
  // ad spend total (exclude china)
  const ad = state.adspend.filter(a=>a.country.toLowerCase()!=='china').reduce((acc,a)=>acc+(+a.amount||0),0);
  Q('#kpiAdSpend').textContent = `${fmt(ad)} USD`;
  // delivered this week (mon-sun)
  const {start,end} = currentWeek();
  const del = state.deliveries
    .filter(d=>d.date>=start && d.date<=end && d.country.toLowerCase()!=='china')
    .reduce((a,d)=>a+(+d.delivered||0),0);
  Q('#kpiDelivered').textContent = fmt(del);
}

/* Country stock & adspend (exclude china) */
function renderStockAndSpendByCountry(){
  const body = Q('#stockByCountryBody'); if (!body) return;
  const map = new Map(); // country -> {stock, ad}
  const countries = state.countries.filter(c=>c.toLowerCase()!=='china');
  countries.forEach(c=>map.set(c,{stock:0, ad:0}));

  // adspend
  state.adspend.forEach(a=>{
    if (a.country && a.country.toLowerCase()!=='china') {
      const m = map.get(a.country); if (m) m.ad += (+a.amount||0);
    }
  });

  // compute stock via shipments balance (arrived only deduct/add)
  state.shipments.forEach(s=>{
    if (!s.arrivedAt) return;
    const from = s.fromCountry?.toLowerCase();
    const to   = s.toCountry?.toLowerCase();
    if (from && map.has(s.fromCountry) && from!=='china') map.get(s.fromCountry).stock -= (+s.qty||0);
    if (to && map.has(s.toCountry)   && to!=='china')     map.get(s.toCountry).stock   += (+s.qty||0);
  });

  let tStock=0, tAd=0;
  body.innerHTML = countries.map(c=>{
    const m = map.get(c)||{stock:0,ad:0}; tStock+=m.stock; tAd+=m.ad;
    return `<tr><td>${c}</td><td>${fmt(m.stock)}</td><td>${fmt(m.ad)}</td></tr>`;
  }).join('');
  Q('#stockTotal').textContent = fmt(tStock);
  Q('#adTotal').textContent    = fmt(tAd);
}

/* Weekly Delivered grid */
function currentWeek(base=new Date()){
  const d = new Date(base);
  const day = (d.getDay()+6)%7; // 0=Mon
  const start = new Date(d - day*dayms);
  const end   = new Date(+start + 6*dayms);
  return {start:start.toISOString().slice(0,10), end:end.toISOString().slice(0,10)};
}
let weekCursor = new Date();
function renderWeeklyGrid(){
  const head = Q('#weeklyHead'), body = Q('#weeklyBody'), range=Q('#weeklyRange');
  if (!head || !body) return;
  const {start,end} = currentWeek(weekCursor);
  range.textContent = `Week: ${start} → ${end}`;

  const days = [...Array(7)].map((_,i)=> new Date(+new Date(start)+i*dayms).toISOString().slice(0,10));
  head.innerHTML = `<tr><th>Country</th>${days.map((d,i)=>`<th>${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i]}<br>${d}</th>`).join('')}<th>Total</th></tr>`;

  const countries = state.countries.filter(c=>c.toLowerCase()!=='china');
  body.innerHTML = countries.map(c=>{
    const row = days.map(d=>{
      const val = state.deliveries.find(x=>x.date===d && x.country===c)?.delivered || 0;
      return `<td><input class="mini" data-day="${d}" data-country="${c}" value="${val}"></td>`;
    }).join('');
    const total = days.reduce((a,d)=>a+(+ (state.deliveries.find(x=>x.date===d && x.country===c)?.delivered || 0)),0);
    return `<tr><td>${c}</td>${row}<td class="muted">${fmt(total)}</td></tr>`;
  }).join('');

  // handlers
  body.oninput = e=>{
    const inp = e.target.closest('input[data-day]'); if (!inp) return;
    inp.value = inp.value.replace(/[^\d]/g,'');
  };
  Q('#weeklyPrev')?.addEventListener('click', ()=>{ weekCursor = new Date(+weekCursor - 7*dayms); renderWeeklyGrid(); });
  Q('#weeklyNext')?.addEventListener('click', ()=>{ weekCursor = new Date(+weekCursor + 7*dayms); renderWeeklyGrid(); });
  Q('#weeklySave')?.onclick = async ()=>{
    try{
      const inputs = QA('input[data-day]', body);
      for (const inp of inputs){
        const delivered = +inp.value || 0;
        const date = inp.dataset.day;
        const country = inp.dataset.country;
        await api('/api/deliveries', { method:'POST', body: JSON.stringify({ date, country, delivered })});
      }
      await refreshDeliveries();
      renderKpis();
      alert('Saved weekly deliveries.');
    }catch(e){ alert('Save failed'); }
  };
  Q('#weeklyReset')?.onclick = ()=> renderWeeklyGrid();
}

/* Transit tables */
function renderTransitTables(){
  const ckBody = Q('#shipCKBody'), icBody = Q('#shipICBody');
  if (!ckBody || !icBody) return;
  const prod = Object.fromEntries(state.products.map(p=>[p.id,p]));

  const rows = state.shipments.map(s=>{
    const from = s.fromCountry, to = s.toCountry;
    const ck = (from?.toLowerCase()==='china' && to?.toLowerCase()==='kenya');
    const prodName = prod[s.productId]?.name || '—';
    const days = s.arrivedAt ? Math.max(1, Math.ceil((new Date(s.arrivedAt)-new Date(s.departedAt))/dayms)) : '—';
    return {s, ck, html:
      `<tr data-id="${s.id}">
        <td>${s.id.slice(0,8)}…</td>
        <td>${prodName}</td>
        <td>${from} → ${to}</td>
        <td><input class="mini" data-edit="qty" value="${s.qty||0}"></td>
        <td><input class="mini" data-edit="shipCost" value="${s.shipCost||0}"></td>
        <td><input class="mini" data-edit="departedAt" value="${s.departedAt||''}" type="date"></td>
        <td>${s.arrivedAt ? s.arrivedAt : `<input class="mini" data-edit="arrivedAt" type="date">`}</td>
        <td>${days}</td>
        <td>
          ${s.arrivedAt ? '' : '<button class="btn xs" data-act="arrive">Mark Arrived</button>'}
          <button class="btn xs danger outline" data-act="delete">Delete</button>
        </td>
      </tr>`
    };
  });

  ckBody.innerHTML = rows.filter(r=>r.ck).map(r=>r.html).join('') || `<tr><td colspan="9" class="muted">No data</td></tr>`;
  icBody.innerHTML = rows.filter(r=>!r.ck).map(r=>r.html).join('') || `<tr><td colspan="9" class="muted">No data</td></tr>`;

  const handler = async (e, table) => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const id = tr.dataset.id;

    if (e.target.dataset.act === 'delete') {
      if (!confirm('Delete this shipment?')) return;
      await api(`/api/shipments/${id}`, { method:'DELETE' });
      await refreshShipments();
      renderTransitTables();
      renderStockAndSpendByCountry();
      return;
    }
    if (e.target.dataset.act === 'arrive') {
      const v = tr.querySelector('input[data-edit="arrivedAt"]')?.value || todayISO();
      await api(`/api/shipments/${id}`, { method:'PUT', body: JSON.stringify({ arrivedAt: v })});
      await refreshShipments();
      renderTransitTables();
      renderStockAndSpendByCountry();
      return;
    }
    if (e.target.matches('input[data-edit]')) {
      e.target.addEventListener('change', async ()=>{
        const payload = {};
        payload[e.target.dataset.edit] = e.target.type==='number' ? +e.target.value : e.target.value;
        await api(`/api/shipments/${id}`, { method:'PUT', body: JSON.stringify(payload)});
        await refreshShipments();
        renderTransitTables();
        renderStockAndSpendByCountry();
      }, {once:true});
    }
  };
  ckBody.onclick = e=>handler(e, ckBody);
  icBody.onclick = e=>handler(e, icBody);
}

/* To-Do + Weekly To-Do (localStorage) */
function loadLocal(k, d){ try{return JSON.parse(localStorage.getItem(k))||d;}catch{ return d; } }
function saveLocal(k,v){ localStorage.setItem(k, JSON.stringify(v)); }

function renderTodo(){
  const list = Q('#todoList'); if (!list) return;
  const items = loadLocal('todo',[]);
  list.innerHTML = items.map(it=>`
    <div data-id="${it.id}" class="${it.done?'done':''}">
      <label><input type="checkbox" ${it.done?'checked':''}/> ${it.text}</label>
      <button class="btn xs danger outline" data-del>Delete</button>
    </div>`).join('') || `<div class="muted">No tasks</div>`;
}

function renderWeeklyTodo(){
  const wrap = Q('#weeklyWrap'); if (!wrap) return;
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const data = loadLocal('weeklyTodo', Object.fromEntries(days.map(d=>[d,[]])));
  wrap.innerHTML = days.map(d=>{
    const items = data[d]||[];
    return `<div class="week-card" data-day="${d}">
      <div class="h">${d}</div>
      <div class="list">${items.map((t,i)=>`<div><span>${t}</span><button class="btn xs" data-del="${i}">✕</button></div>`).join('')}</div>
      <div class="row"><input class="input" placeholder="Add task"/><button class="btn xs" data-add>Add</button></div>
    </div>`;
  }).join('');
  wrap.onclick = e=>{
    const card = e.target.closest('.week-card'); if (!card) return;
    const d = card.dataset.day;
    const store = loadLocal('weeklyTodo', Object.fromEntries(days.map(x=>[x,[]])));
    if (e.target.dataset.add!==undefined){
      const inp = card.querySelector('input'); const v=inp.value.trim(); if (!v) return;
      store[d].push(v); saveLocal('weeklyTodo',store); renderWeeklyTodo();
    }
    if (e.target.dataset.del!==undefined){
      const idx = +e.target.dataset.del; store[d].splice(idx,1); saveLocal('weeklyTodo',store); renderWeeklyTodo();
    }
  };
}

/* refresh helpers */
async function refreshShipments(){ state.shipments = (await api('/api/shipments')).shipments || []; }
async function refreshDeliveries(){ state.deliveries = (await api('/api/deliveries')).deliveries || []; }
async function refreshAdspend(){ state.adspend = (await api('/api/adspend')).adSpends || []; }
async function refreshRemittances(){ state.remittances = (await api('/api/remittances')).remittances || []; }

/* =================================================================
   PRODUCTS LIST
   ================================================================= */
function initProducts(){
  const tbody = Q('#productsTable tbody'); if (!tbody) return;

  const draw = ()=>{
    tbody.innerHTML = state.products.map(p=>`
      <tr data-id="${p.id}">
        <td>${p.name}</td>
        <td>${p.sku||''}</td>
        <td>${p.status}</td>
        <td>
          <a class="btn xs outline" href="product.html?id=${p.id}">Open</a>
          <button class="btn xs" data-act="status" data-val="${p.status==='active'?'paused':'active'}">
            ${p.status==='active'?'Pause':'Activate'}
          </button>
          <button class="btn xs danger outline" data-act="del">Delete</button>
        </td>
      </tr>`).join('') || `<tr><td colspan="4" class="muted">No products</td></tr>`;
  };
  draw();

  Q('#pAdd')?.addEventListener('click', async ()=>{
    const name = Q('#pName').value.trim();
    const sku  = Q('#pSku').value.trim();
    const cost = +Q('#pCost').value||0;
    const ship = +Q('#pShip').value||0;
    const mb   = +Q('#pMB').value||0;
    if (!name) return alert('Name required');
    const r = await api('/api/products', { method:'POST', body: JSON.stringify({ name, sku, cost_china:cost, ship_china_to_kenya:ship, margin_budget:mb })});
    state.products.push(r.product);
    fillGlobalSelects();
    draw();
  });

  tbody.addEventListener('click', async e=>{
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const id = tr.dataset.id;
    if (e.target.dataset.act==='status'){
      const status = e.target.dataset.val;
      await api(`/api/products/${id}/status`, { method:'POST', body: JSON.stringify({ status })});
      const p = state.products.find(x=>x.id===id); if (p) p.status = status;
      draw();
    }
    if (e.target.dataset.act==='del'){
      if (!confirm('Delete this product and all related data?')) return;
      await api(`/api/products/${id}`, { method:'DELETE' });
      state.products = state.products.filter(x=>x.id!==id);
      // refresh related data
      await Promise.all([refreshAdspend(), refreshRemittances(), refreshShipments()]);
      renderStockAndSpendByCountry();
      draw();
    }
  });
}

/* =================================================================
   PERFORMANCE
   ================================================================= */
function initPerformance(){
  // quick range
  Q('#pfQuick')?.addEventListener('change', e=>{
    const v = e.target.value;
    const s = Q('#pfStart'), en = Q('#pfEnd');
    if (v==='custom') return;
    const days = +v;
    const end = new Date();
    const start = new Date(+end - (days-1)*dayms);
    s.value = start.toISOString().slice(0,10);
    en.value= end.toISOString().slice(0,10);
  });

  Q('#pfRun')?.addEventListener('click', async ()=>{
    const start = Q('#pfStart').value, end = Q('#pfEnd').value;
    const country = Q('#pfCountry').value; // may be ''
    // build map prodId-country -> metrics from remittances
    await refreshRemittances();
    const prodMap = Object.fromEntries(state.products.map(p=>[p.id,p]));
    const by = {};
    state.remittances
      .filter(r => (!start || r.start>=start) && (!end || r.end<=end) && (!country || r.country===country))
      .forEach(r=>{
        if (r.country.toLowerCase()==='china') return;
        const key = r.productId+'|'+r.country;
        const base = (prodMap[r.productId]?.cost_china||0) + (prodMap[r.productId]?.ship_china_to_kenya||0);
        const extra = (+r.extraPerPiece||0) * (+r.pieces||0);
        const ad = +r.adSpend||0;
        const revenue = +r.revenue||0;
        const prodCost = base * (+r.pieces||0);
        const profit = revenue - ad - prodCost - extra;
        if (!by[key]) by[key] = { productId:r.productId, country:r.country, pieces:0, ad:0, prodCost:0, profit:0, name: prodMap[r.productId]?.name||'—' };
        by[key].pieces += (+r.pieces||0);
        by[key].ad     += ad;
        by[key].prodCost += prodCost;
        by[key].profit += profit;
      });

    const tb = Q('#pfTable tbody');
    tb.innerHTML = Object.values(by).sort((a,b)=>b.pieces-a.pieces).map(it=>
      `<tr><td>${it.name}</td><td>${it.country||'-'}</td><td>${fmt(it.pieces)}</td><td>${fmt(it.ad)}</td><td>${fmt(it.prodCost)}</td><td>${fmt(it.profit)}</td><td>${it.pieces?fmt(it.profit/it.pieces):'0'}</td></tr>`
    ).join('') || `<tr><td colspan="7" class="muted">No data</td></tr>`;
  });

  // Remittance add + list + delete
  Q('#rAdd')?.addEventListener('click', async ()=>{
    try{
      const payload = {
        start: Q('#rStart').value,
        end:   Q('#rEnd').value,
        country: Q('#rCountry').value,
        productId: Q('#rProduct').value,
        orders: +Q('#rOrders').value||0,
        pieces: +Q('#rPieces').value||0,
        revenue:+Q('#rRev').value||0,
        adSpend:+Q('#rAds').value||0,
        extraPerPiece:+Q('#rExtra').value||0
      };
      if (!payload.start || !payload.end || !payload.country || !payload.productId) return alert('Fill required fields');
      await api('/api/remittances', { method:'POST', body: JSON.stringify(payload) });
      await refreshRemittances();
      renderRemittancesTable();
      Q('#rMsg').textContent = 'Added.';
    }catch(e){ Q('#rMsg').textContent = 'Error adding remittance.'; }
  });

  renderRemittancesTable();
}

function renderRemittancesTable(){
  const tb = Q('#rTable tbody'); if (!tb) return;
  tb.innerHTML = state.remittances
    .filter(r=>r.country.toLowerCase()!=='china')
    .sort((a,b)=> (b.start.localeCompare(a.start)))
    .map(r=>{
      const prod = state.products.find(p=>p.id===r.productId)?.name || '—';
      const per = `${r.start} → ${r.end}`;
      return `<tr data-id="${r.id}">
        <td>${per}</td><td>${r.country}</td><td>${prod}</td>
        <td>${fmt(r.orders)}</td><td>${fmt(r.pieces)}</td>
        <td>${fmt(r.revenue)}</td><td>${fmt(r.adSpend)}</td><td>${fmt(r.extraPerPiece)}</td>
        <td><button class="btn xs danger outline" data-del-remit>Delete</button></td>
      </tr>`;
    }).join('') || `<tr><td colspan="9" class="muted">No remittances</td></tr>`;

  tb.onclick = async e=>{
    if (!e.target.matches('[data-del-remit]')) return;
    const id = e.target.closest('tr')?.dataset.id; if (!id) return;
    if (!confirm('Delete this remittance?')) return;
    await api(`/api/remittances/${id}`, { method:'DELETE' });
    await refreshRemittances();
    renderRemittancesTable();
  };
}

/* =================================================================
   FINANCE
   ================================================================= */
function initFinance(){
  const fillCats = ()=>{
    const deb = Q('#fcDebits'), cre = Q('#fcCredits');
    const mk = (name,type) => `<span class="chip">${name} <button class="chip-x" data-type="${type}" data-name="${name}">✕</button></span>`;
    deb.innerHTML = (state.finance.categories.debit||[]).map(n=>mk(n,'debit')).join('') || '<span class="muted">No debits</span>';
    cre.innerHTML = (state.finance.categories.credit||[]).map(n=>mk(n,'credit')).join('') || '<span class="muted">No credits</span>';
    // entry add select
    const sel = Q('#feCat');
    const t = Q('#feType').value || 'debit';
    sel.innerHTML = (state.finance.categories[t]||[]).map(n=>`<option value="${n}">${n}</option>`).join('');
  };

  // add category
  Q('#fcAdd')?.addEventListener('click', async ()=>{
    const type = Q('#fcType').value, name = Q('#fcName').value.trim();
    if (!name) return;
    await api('/api/finance/categories', { method:'POST', body: JSON.stringify({ type, name })});
    state.finance.categories[type].push(name);
    Q('#fcName').value='';
    fillCats();
  });

  // delete category (and server will also allow deletion; entries affected handled client next refresh)
  Q('.cats')?.addEventListener('click', async e=>{
    const btn = e.target.closest('.chip-x'); if (!btn) return;
    const type = btn.dataset.type, name = btn.dataset.name;
    if (!confirm(`Delete category "${name}"? Entries in this category will remain for now.`)) return;
    await api(`/api/finance/categories?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}`, { method:'DELETE' });
    state.finance.categories[type] = state.finance.categories[type].filter(x=>x!==name);
    // also remove from local entries view (optional)
    state.finance.entries = state.finance.entries.filter(en=> !(en.type===type && en.category===name));
    fillCats();
    renderFinanceEntries(); // refresh table
  });

  // switch type -> refill category select
  Q('#feType')?.addEventListener('change', fillCats);

  // add entry
  Q('#feAdd')?.addEventListener('click', async ()=>{
    const payload = {
      date: Q('#feDate').value || todayISO(),
      type: Q('#feType').value,
      category: Q('#feCat').value,
      amount: +Q('#feAmt').value||0,
      note: Q('#feNote').value||''
    };
    if (!payload.category) return alert('Pick a category');
    const r = await api('/api/finance/entries', { method:'POST', body: JSON.stringify(payload) });
    state.finance.entries.push(r.entry);
    Q('#feAmt').value=''; Q('#feNote').value='';
    renderFinanceEntries();
    renderRunningBalance();
  });

  // run range
  Q('#feRun')?.addEventListener('click', ()=> renderFinanceEntries());

  fillCats();
  renderRunningBalance();
  renderFinanceEntries();
}

function renderRunningBalance(){
  const bal = state.finance.entries.reduce((acc,e)=> acc + (e.type==='credit' ? +e.amount||0 : -(+e.amount||0)), 0);
  Q('#runBalance').textContent = `${fmt(bal)} USD`;
}
function renderFinanceEntries(){
  const s = Q('#fes')?.value, e = Q('#fee')?.value;
  const list = state.finance.entries.filter(x=> (!s || x.date>=s) && (!e || x.date<=e));
  const tb = Q('#feTable tbody');
  tb.innerHTML = list.sort((a,b)=> b.date.localeCompare(a.date)).map(it=>
    `<tr data-id="${it.id}">
      <td>${it.date}</td><td>${it.type}</td><td>${it.category}</td><td>${fmt(it.amount)}</td><td>${it.note||''}</td>
      <td><button class="btn xs danger outline" data-del>Delete</button></td>
    </tr>`
  ).join('') || `<tr><td colspan="6" class="muted">No entries</td></tr>`;
  tb.onclick = async e=>{
    if (!e.target.matches('[data-del]')) return;
    const id = e.target.closest('tr')?.dataset.id; if (!id) return;
    await api(`/api/finance/entries/${id}`, { method:'DELETE' });
    state.finance.entries = state.finance.entries.filter(x=>x.id!==id);
    renderFinanceEntries();
    renderRunningBalance();
  };

  const bal = list.reduce((acc,e)=> acc + (e.type==='credit' ? +e.amount||0 : -(+e.amount||0)), 0);
  Q('#feBalance').textContent = `Period Balance: ${fmt(bal)}`;
}

/* =================================================================
   SETTINGS
   ================================================================= */
function initSettings(){
  // countries
  const drawCountries = ()=>{
    const wrap = Q('#ctyList');
    wrap.innerHTML = state.countries.map(c=>{
      const locked = c.toLowerCase()==='china';
      return `<span class="chip ${locked?'disabled':''}">
        ${c} ${locked ? '' : `<button class="chip-x" data-del="${c}">✕</button>`}
      </span>`;
    }).join('');
  };
  drawCountries();

  Q('#ctyAdd')?.addEventListener('click', async ()=>{
    const name = (Q('#cty').value||'').trim().toLowerCase();
    if (!name) return;
    await api('/api/countries', { method:'POST', body: JSON.stringify({ name })});
    state.countries.push(name);
    Q('#cty').value='';
    fillGlobalSelects();
    drawCountries();
  });

  Q('#ctyList')?.addEventListener('click', async e=>{
    const c = e.target.dataset.del; if (!c) return;
    if (!confirm(`Delete "${c}"?`)) return;
    try{
      await api(`/api/countries/${encodeURIComponent(c)}`, { method:'DELETE' });
      state.countries = state.countries.filter(x=>x!==c);
      fillGlobalSelects();
      drawCountries();
    }catch(err){ alert('Cannot delete this country'); }
  });

  // edit product info
  const sel = Q('#epSelect');
  sel?.addEventListener('change', ()=>{
    const p = state.products.find(x=>x.id===sel.value);
    Q('#epName').value = p?.name||'';
    Q('#epSku').value  = p?.sku||'';
    Q('#epCost').value = p?.cost_china??'';
    Q('#epShip').value = p?.ship_china_to_kenya??'';
    Q('#epMB').value   = p?.margin_budget??'';
  });
  Q('#epSave')?.addEventListener('click', async ()=>{
    const id = sel.value; if (!id) return alert('Choose a product');
    const payload = {
      name: Q('#epName').value,
      sku: Q('#epSku').value,
      cost_china:+Q('#epCost').value||0,
      ship_china_to_kenya:+Q('#epShip').value||0,
      margin_budget:+Q('#epMB').value||0
    };
    await api(`/api/products/${id}`, { method:'PUT', body: JSON.stringify(payload) });
    // update local
    Object.assign(state.products.find(p=>p.id===id), payload);
    fillGlobalSelects();
    alert('Saved.');
  });

  // Manual Save & Restore
  Q('#snapSave')?.addEventListener('click', async ()=>{
    const name = Q('#snapName').value.trim();
    const r = await api('/api/snapshots', { method:'POST', body: JSON.stringify({ name })});
    Q('#snapName').value='';
    await drawSnapshots();
    alert('Saved snapshot.');
  });

  drawSnapshots();
}
async function drawSnapshots(){
  const list = (await api('/api/snapshots')).snapshots || [];
  const tb = Q('#snapList'); if (!tb) return;
  tb.innerHTML = list.map(s=>`
    <tr data-id="${s.id}">
      <td>${s.name}</td>
      <td><code>${s.file}</code></td>
      <td>
        <button class="btn xs" data-push>Push</button>
        <button class="btn xs danger outline" data-del>Delete</button>
      </td>
    </tr>
  `).join('') || `<tr><td colspan="3" class="muted">No snapshots</td></tr>`;
  tb.onclick = async e=>{
    const id = e.target.closest('tr')?.dataset.id;
    if (!id) return;
    const snap = list.find(x=>x.id===id);
    if (e.target.matches('[data-push]')){
      await api('/api/snapshots/restore', { method:'POST', body: JSON.stringify({ file:snap.file })});
      await preloadAll();
      fillGlobalSelects();
      renderKpis(); renderStockAndSpendByCountry(); renderWeeklyGrid(); renderTransitTables();
      alert('Pushed snapshot (it remains saved until you delete it).');
    }
    if (e.target.matches('[data-del]')){
      if (!confirm('Delete this snapshot file?')) return;
      await api(`/api/snapshots/${id}`, { method:'DELETE' });
      await drawSnapshots();
    }
  };
}

/* =================================================================
   NAV
   ================================================================= */
function initNav() {
  QA('.nav a[data-view]')?.forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    const v = a.dataset.view;
    ['home','products','performance','finance','settings'].forEach(id => {
      const el = Q('#'+id);
      if (el) el.style.display = (id===v) ? '' : 'none';
    });
    QA('.nav a').forEach(x => x.classList.toggle('active', x === a));
    if (v === 'home') { renderKpis(); renderStockAndSpendByCountry(); renderTransitTables(); renderWeeklyGrid(); }
    if (v === 'performance') { renderRemittancesTable(); }
    if (v === 'finance') { renderFinanceEntries(); renderRunningBalance(); }
  }));
}

/* =================================================================
   PRODUCT PAGE bits (shared)
   ================================================================= */
async function loadProduct(id){
  // ensure we have latest datasets
  await preloadAll();
  state.productId = id;
}
function renderProductPage(){
  // product.html is handled in /public/snapshot.js (shared helpers there if needed).
  // We only ensure selects are filled here when product page loads via gate().
  fillGlobalSelects();
}

/* =================================================================
   BOOT
   ================================================================= */
gate();
