/* ================================================================
   EAS Tracker – Front-end (index.html + product.html)
   ================================================================ */

/* ---------- helpers ---------- */
const Q  = (s, r=document) => r.querySelector(s);
const QA = (s, r=document) => Array.from(r.querySelectorAll(s));
const fmt = n => (Number(n||0)).toLocaleString(undefined,{maximumFractionDigits:2});
const isoToday = () => new Date().toISOString().slice(0,10);
const getQuery = k => new URLSearchParams(location.search).get(k);
const safeJSON = v => { try { return JSON.parse(v); } catch { return null; } };

async function api(path, opts={}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  const ct = res.headers.get('content-type')||'';
  const body = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(body?.error || body || ('HTTP '+res.status));
  return body;
}

/* ---------- global state ---------- */
const state = {
  productId: getQuery('id'),
  countries: [],
  countriesNoCN: [],
  products: [],
  productsActive: [],
  categories: { debit:[], credit:[] }
};

/* ================================================================
   AUTH + BOOT   (login code kept unchanged)
   ================================================================ */
async function boot() {
  try {
    await api('/api/meta');                 // cookie OK? (fast ping)
    Q('#login')?.classList.add('hide');
    Q('#main')?.removeAttribute('style');
  } catch {
    Q('#login')?.classList.remove('hide');
    Q('#main')?.setAttribute('style','display:none');
    return;
  }

  await preload();
  bindGlobalNav();

  if (state.productId) {
    renderProductPage();
  } else {
    renderDashboardPage();
    renderProductsPage();
    renderPerformancePage();
    renderFinancePage();
    renderSettingsPage();
  }
}

Q('#loginBtn')?.addEventListener('click', async () => {
  const password = Q('#pw')?.value || '';
  try {
    await api('/api/auth', { method:'POST', body: JSON.stringify({ password }) });
    await boot();
  } catch (e) {
    alert('Wrong password');
  }
});

Q('#logoutLink')?.addEventListener('click', async (e) => {
  e.preventDefault();
  try { await api('/api/auth', { method:'POST', body: JSON.stringify({ password: 'logout' })}); } catch {}
  location.reload();
});

/* ================================================================
   COMMON LOADERS
   ================================================================ */
async function preload() {
  const meta = await api('/api/meta');                 // {countries}
  state.countries = meta.countries || [];
  state.countriesNoCN = state.countries.filter(c => (c||'').toLowerCase() !== 'china');

  const pr = await api('/api/products');               // {products}
  state.products = pr.products || [];
  state.productsActive = state.products.filter(p => p.status !== 'paused');

  const cats = await api('/api/finance/categories');   // {debit:[],credit:[]}
  state.categories = cats || { debit:[], credit:[] };

  fillCommonSelects();
}

function fillCommonSelects() {
  const noCN = state.countriesNoCN;

  // Filters (exclude China, still allow "All")
  QA('#pcCountry').forEach(el => {
    el.innerHTML = `<option value="">All countries</option>` +
      noCN.map(c=>`<option value="${c}">${c}</option>`).join('');
  });
  QA('#pfCountry').forEach(el => {
    el.innerHTML = `<option value="">All countries</option>` +
      noCN.map(c=>`<option value="${c}">${c}</option>`).join('');
  });

  // Inputs that must NOT include China
  const noChinaInputs = [
    '#adCountry','#rCountry',
    '#pdAdCountry','#pdRCountry',
    '#pdInfCountry','#pdInfFilterCountry',
    '#pdPBCountry'
  ];
  noChinaInputs.forEach(sel => QA(sel).forEach(el => {
    el.innerHTML = noCN.map(c=>`<option value="${c}">${c}</option>`).join('');
  }));

  // Movement selects MUST include China
  ['#mvFrom','#mvTo','#pdMvFrom','#pdMvTo'].forEach(sel => QA(sel).forEach(el => {
    el.innerHTML = state.countries.map(c=>`<option value="${c}">${c}</option>`).join('');
  }));

  // Products (only available/active in add forms)
  const productInputs = ['#mvProduct','#adProduct','#rProduct','#lpProductFilter','#pdProductForSpend'];
  productInputs.forEach(sel => QA(sel).forEach(el => {
    el.innerHTML = state.productsActive.map(p=>`<option value="${p.id}">${p.name}${p.sku?` (${p.sku})`:''}</option>`).join('');
  }));

  // Products (filters can include "All")
  QA('#lpProduct').forEach(el => {
    el.innerHTML = `<option value="">All products</option>` +
      state.products.map(p=>`<option value="${p.id}">${p.name}${p.sku?` (${p.sku})`:''}</option>`).join('');
  });

  // Finance categories select for entries
  const allCats = [...state.categories.debit, ...state.categories.credit].sort();
  QA('#feCat').forEach(el => {
    el.innerHTML = `<option value="" disabled selected>Select category</option>` +
      allCats.map(c=>`<option>${c}</option>`).join('');
  });
}

/* ================================================================
   DASHBOARD
   ================================================================ */
function renderDashboardPage() {
  renderKpis();
  renderCountryStockSpend();
  renderWeeklyDelivered();
  bindDailyAdSpend();
  bindStockMovement();
  renderTransitTables();
  bindProfitByCountry();
  initTodos();
}

/* ---------- KPIs ---------- */
async function renderKpis() {
  Q('#kpiProducts') && (Q('#kpiProducts').textContent = state.products.length);
  Q('#kpiCountries') && (Q('#kpiCountries').textContent = state.countries.length);
  try {
    const s = await api('/api/shipments');
    const live = (s.shipments || []).filter(x => !x.arrivedAt).length;
    Q('#kpiTransit') && (Q('#kpiTransit').textContent = live);
  } catch { Q('#kpiTransit') && (Q('#kpiTransit').textContent = '—'); }

  // KPI Ad spend
  try {
    const a = await api('/api/adspend');
    const total = (a.adSpends||[]).reduce((t,x)=>t+(+x.amount||0),0);
    Q('#kpiAdSpend') && (Q('#kpiAdSpend').textContent = `${fmt(total)} USD`);
  } catch { Q('#kpiAdSpend') && (Q('#kpiAdSpend').textContent = '—'); }

  // KPI Delivered (Mon–Sun) mirrors weekly grid total
  const t = Q('#wAllT')?.textContent || '0';
  Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = t);
}

/* ---------- Stock & Ad Spend by Country (global) ---------- */
async function renderCountryStockSpend() {
  const body = Q('#stockByCountryBody'); if (!body) return;
  body.innerHTML = '<tr><td colspan="3">Loading…</td></tr>';

  const per = {}; state.countries.forEach(c=> per[c]={ stock:0, ad:0 });

  // Arrived shipments add to dest, deduct from origin
  try {
    const s = await api('/api/shipments');
    (s.shipments||[]).filter(x=>x.arrivedAt).forEach(sp=>{
      const to = sp.toCountry || sp.to, from = sp.fromCountry || sp.from, qty = (+sp.qty||0);
      per[to] = per[to] || {stock:0,ad:0}; per[to].stock += qty;
      if (from) { per[from] = per[from]||{stock:0,ad:0}; per[from].stock -= qty; }
    });
  } catch {}

  // Remittances pieces deduct from that country
  try {
    const r = await api('/api/remittances');
    (r.remittances||[]).forEach(x=>{
      per[x.country] = per[x.country]||{stock:0,ad:0};
      per[x.country].stock -= (+x.pieces||0);
    });
  } catch {}

  // Ad spend from /api/adspend
  try {
    const a = await api('/api/adspend');
    (a.adSpends||[]).forEach(x=>{
      per[x.country] = per[x.country]||{stock:0,ad:0};
      per[x.country].ad += (+x.amount||0);
    });
  } catch {}

  // Remove China from the display
  delete per['china']; delete per['China'];

  let st=0, ad=0;
  const rows = Object.entries(per)
    .filter(([c]) => (c||'').toLowerCase() !== 'china')
    .map(([c,v])=>{
      st += v.stock; ad += v.ad;
      return `<tr><td>${c}</td><td>${fmt(v.stock)}</td><td>${fmt(v.ad)}</td></tr>`;
    }).join('');
  body.innerHTML = rows || `<tr><td colspan="3" class="muted">No data</td></tr>`;
  Q('#stockTotal') && (Q('#stockTotal').textContent = fmt(st));
  Q('#adTotal')    && (Q('#adTotal').textContent    = fmt(ad));
}

/* ---------- Weekly Delivered grid (China removed) ---------- */
function mondayOf(dateISO) {
  const d = new Date(dateISO);
  const k = (d.getDay()+6)%7; d.setDate(d.getDate()-k);
  return d;
}
function weekDays(fromMonDate) {
  return [...Array(7)].map((_,i)=> {
    const t = new Date(fromMonDate); t.setDate(t.getDate()+i);
    return t.toISOString().slice(0,10);
  });
}

function renderWeeklyDelivered() {
  const head = Q('#weeklyHead'), body = Q('#weeklyBody'), rangeLbl = Q('#weeklyRange');
  if (!head || !body) return;

  let anchor = isoToday();
  const updateGrid = async () => {
    const mon = mondayOf(anchor);
    const days = weekDays(mon);
    rangeLbl.textContent = `Week: ${days[0]} → ${days[6]}`;

    head.innerHTML = `<tr><th>Country</th>${days.map(d=>{
      const lab = new Date(d).toLocaleDateString(undefined,{weekday:'short'});
      return `<th>${lab}<br>${d}</th>`;
    }).join('')}<th>Total</th></tr>`;

    body.innerHTML = state.countriesNoCN.map(c=>{
      const cells = days.map(d=>`<td><input type="number" min="0" class="wd-cell" data-country="${c}" data-date="${d}" placeholder="0"/></td>`).join('');
      return `<tr data-row="${c}"><td>${c}</td>${cells}<td class="row-total">0</td></tr>`;
    }).join('');

    // preload
    try {
      const r = await api('/api/deliveries');
      const map = {};
      (r.deliveries||[]).forEach(x => map[`${x.country}|${x.date}`] = +x.delivered||0);
      QA('.wd-cell').forEach(inp=>{
        const k = `${inp.dataset.country}|${inp.dataset.date}`;
        if (map[k] != null) inp.value = map[k];
      });
    } catch {}

    computeWeeklyTotals();
  };

  function computeWeeklyTotals() {
    // rows
    QA('tr[data-row]').forEach(tr=>{
      const t = QA('.wd-cell', tr).reduce((s,el)=>s+(+el.value||0),0);
      Q('.row-total', tr).textContent = fmt(t);
    });
    // columns + grand
    const cols = QA('thead th', Q('#weeklyTable')).length - 2;
    let grand = 0;
    const lbls = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    for (let i=0;i<cols;i++) {
      let colSum = 0;
      QA('tr[data-row]').forEach(tr=>{
        const inp = QA('.wd-cell', tr)[i];
        colSum += (+inp.value||0);
      });
      const headCell = Q(`#w${lbls[i]}T`);
      if (headCell) headCell.textContent = fmt(colSum);
      grand += colSum;
    }
    Q('#wAllT') && (Q('#wAllT').textContent = fmt(grand));
    // mirror to KPI
    Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = fmt(grand));
  }

  Q('#weeklyPrev')?.addEventListener('click',()=>{ const d = new Date(anchor); d.setDate(d.getDate()-7); anchor = d.toISOString().slice(0,10); updateGrid(); });
  Q('#weeklyNext')?.addEventListener('click',()=>{ const d = new Date(anchor); d.setDate(d.getDate()+7); anchor = d.toISOString().slice(0,10); updateGrid(); });
  Q('#weeklyReset')?.addEventListener('click',()=>{ QA('.wd-cell').forEach(el=>el.value=''); computeWeeklyTotals(); });
  Q('#weeklyTable')?.addEventListener('input', (e)=>{ if (e.target.classList.contains('wd-cell')) computeWeeklyTotals(); });
  Q('#weeklySave')?.addEventListener('click', async ()=>{
    const payload = [];
    QA('.wd-cell').forEach(inp=>{
      const val = +inp.value||0;
      if (val>0) payload.push({ date: inp.dataset.date, country: inp.dataset.country, delivered: val });
    });
    try {
      for (const row of payload) await api('/api/deliveries',{method:'POST', body: JSON.stringify(row)});
      alert('Weekly deliveries saved');
    } catch(e){ alert('Save failed: '+e.message); }
  });

  updateGrid();
}

/* ---------- Daily Ad Spend (replace current) ---------- */
function bindDailyAdSpend() {
  const btn = Q('#adSave');
  if (!btn) return;
  btn.onclick = async ()=>{
    const payload = {
      productId: Q('#adProduct')?.value,
      country: Q('#adCountry')?.value,
      platform: Q('#adPlatform')?.value,
      amount: +Q('#adAmount')?.value || 0
    };
    if (!payload.productId || !payload.country || !payload.platform) return alert('Fill all fields');
    try {
      await api('/api/adspend',{method:'POST', body: JSON.stringify(payload)});  // upsert
      await renderCountryStockSpend();
      await renderKpis();
      alert('Ad spend saved');
    } catch(e){ alert(e.message); }
  };
}

/* ---------- Stock Movement (create shipment) ---------- */
function bindStockMovement() {
  const btn = Q('#mvAdd'); if (!btn) return;
  btn.onclick = async ()=>{
    const payload = {
      productId: Q('#mvProduct')?.value,
      fromCountry: Q('#mvFrom')?.value,
      toCountry: Q('#mvTo')?.value,
      qty: +Q('#mvQty')?.value || 0,
      shipCost: +Q('#mvShip')?.value || 0,
      departedAt: isoToday(),
      arrivedAt: null
    };
    if (!payload.productId || !payload.fromCountry || !payload.toCountry) return alert('Missing fields');
    try{
      await api('/api/shipments',{method:'POST', body: JSON.stringify(payload)});
      await renderTransitTables();
      alert('Shipment created');
    } catch(e){ alert(e.message); }
  };
}

/* ---------- Transit tables (CK + IC) ---------- */
async function renderTransitTables() {
  const tbl1 = Q('#shipCKBody'), tbl2 = Q('#shipICBody');
  if (!tbl1 && !tbl2) return;
  const s = await api('/api/shipments');
  const live = (s.shipments||[]).filter(x=>!x.arrivedAt);
  const prodMap = Object.fromEntries(state.products.map(p=>[p.id,p.name]));

  const row = sp => {
    const days = sp.arrivedAt ? Math.round((+new Date(sp.arrivedAt)-(+new Date(sp.departedAt)))/86400000) : '';
    return `<tr>
      <td>${sp.id}</td>
      <td>${prodMap[sp.productId]||sp.productId}</td>
      <td>${sp.fromCountry||sp.from} → ${sp.toCountry||sp.to}</td>
      <td>${fmt(sp.qty)}</td>
      <td>${fmt(sp.shipCost)}</td>
      <td>${sp.departedAt||''}</td>
      <td>${sp.arrivedAt||''}</td>
      <td>${days}</td>
      <td>
        <button class="btn outline act-arr" data-id="${sp.id}">Arrived</button>
        <button class="btn outline act-edit" data-id="${sp.id}">Edit</button>
        <button class="btn outline act-del" data-id="${sp.id}">Delete</button>
      </td>
    </tr>`;
  };

  const ck = live.filter(sp => (sp.fromCountry||sp.from||'').toLowerCase()==='china' && (sp.toCountry||sp.to||'').toLowerCase()==='kenya');
  const ic = live.filter(sp => !ck.includes(sp));

  if (tbl1) tbl1.innerHTML = ck.map(row).join('') || `<tr><td colspan="9" class="muted">No transit</td></tr>`;
  if (tbl2) tbl2.innerHTML = ic.map(row).join('') || `<tr><td colspan="9" class="muted">No transit</td></tr>`;

  const host = Q('#home') || document;
  host.addEventListener('click', async (e)=>{
    const raw = e.target?.dataset?.id;
    if (!raw) return;
    const id = (raw || '').trim(); // guard against stray whitespace/newlines

    if (e.target.classList.contains('act-arr')) {
      const date = prompt('Arrival date (YYYY-MM-DD)', isoToday());
      if (!date) return;
      try { await api(`/api/shipments/${id}`, { method:'PUT', body: JSON.stringify({ arrivedAt: date })}); }
      catch(err){ return alert(err.message); }
      await renderTransitTables();
      await renderCountryStockSpend();
    }

    if (e.target.classList.contains('act-edit')) {
      const qty = +prompt('New qty?', '0') || 0;
      const shipCost = +prompt('New shipping cost?', '0') || 0;
      try { await api(`/api/shipments/${id}`,{method:'PUT', body: JSON.stringify({ qty, shipCost })}); }
      catch(err){ return alert(err.message); }
      await renderTransitTables();
    }

    if (e.target.classList.contains('act-del')) {
      if (!confirm('Delete shipment?')) return;
      try { await api(`/api/shipments/${id}`,{method:'DELETE'}); }
      catch(err){ return alert(err.message); }
      await renderTransitTables();
    }
  }, { once:true });
}

/* ---------- Profit by Country (filter works, China excluded) ---------- */
function bindProfitByCountry() {
  const btn = Q('#pcRun'); if (!btn) return;
  btn.onclick = async ()=>{
    const s = Q('#pcStart')?.value, e = Q('#pcEnd')?.value, c = Q('#pcCountry')?.value || '';
    let list = (await api('/api/remittances')).remittances || [];
    list = list.filter(r => (r.country||'').toLowerCase() !== 'china');
    if (s) list = list.filter(r=>r.start >= s);
    if (e) list = list.filter(r=>r.end <= e);
    if (c) list = list.filter(r=>r.country === c);

    const byC = {};
    list.forEach(r=>{
      if (!byC[r.country]) byC[r.country] = {rev:0, ad:0, extra:0, pcs:0};
      byC[r.country].rev += (+r.revenue||0);
      byC[r.country].ad  += (+r.adSpend||0);
      byC[r.country].extra += (+r.extraPerPiece||0)*(+r.pieces||0);
      byC[r.country].pcs += (+r.pieces||0);
    });

    const tb = Q('#profitCountryBody'); let R=0,A=0,E=0,P=0,PCS=0;
    const rows = Object.entries(byC).map(([cc,v])=>{
      const profit = v.rev - v.ad - v.extra;
      R+=v.rev; A+=v.ad; E+=v.extra; P+=profit; PCS+=v.pcs;
      return `<tr><td>${cc}</td><td>${fmt(v.rev)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.extra)}</td><td>${fmt(v.pcs)}</td><td>${fmt(profit)}</td></tr>`;
    }).join('');
    tb.innerHTML = rows || `<tr><td colspan="6" class="muted">No data</td></tr>`;
    Q('#pcRevT').textContent = fmt(R);
    Q('#pcAdT').textContent = fmt(A);
    Q('#pcDelT').textContent = fmt(E);
    Q('#pcPiecesT').textContent = fmt(PCS);
    Q('#pcProfitT').textContent = fmt(P);
  };
}

/* ---------- To-do + Weekly To-do + Global Lifetime ---------- */
function initTodos() {
  const KEY='eas_todos', WKEY='eas_weekly';
  const load = k => safeJSON(localStorage.getItem(k))|| (k===WKEY?{}:[]);
  const save = (k,v)=>localStorage.setItem(k,JSON.stringify(v));

  // quick to-dos
  const listEl = Q('#todoList'); const addBtn = Q('#todoAdd');
  function renderQuick(){
    const arr = load(KEY);
    listEl.innerHTML = arr.map(t=>`<div class="flex">
      <span>${t.done?'✅ ':''}${t.text}</span>
      <button class="btn outline" data-done="${t.id}">${t.done?'Undo':'Done'}</button>
      <button class="btn outline" data-del="${t.id}">Delete</button>
    </div>`).join('') || '<div class="muted">No tasks</div>';
  }
  addBtn?.addEventListener('click', ()=>{
    const v = Q('#todoText')?.value.trim(); if (!v) return;
    const arr = load(KEY); arr.push({id:crypto.randomUUID(),text:v,done:false}); save(KEY,arr); Q('#todoText').value=''; renderQuick();
  });
  listEl?.addEventListener('click',(e)=>{
    const arr = load(KEY);
    if (e.target.dataset.done) { const it = arr.find(x=>x.id===e.target.dataset.done); it.done=!it.done; save(KEY,arr); renderQuick(); }
    if (e.target.dataset.del)  { const idx = arr.findIndex(x=>x.id===e.target.dataset.del); arr.splice(idx,1); save(KEY,arr); renderQuick(); }
  });
  renderQuick();

  // weekly to-dos
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const wrap = Q('#weeklyWrap');
  function renderWeekly(){
    const data = load(WKEY);
    wrap.innerHTML = days.map(d=>{
      const arr = data[d]||[];
      return `<div class="card">
        <div class="h">${d}</div>
        <div class="row"><input id="w_${d}" class="input" placeholder="Task"/><button class="btn" data-add="${d}">Add</button></div>
        <div class="list">${arr.map(t=>`<div class="flex"><span>${t.done?'✅ ':''}${t.text}</span>
          <button class="btn outline" data-tgl="${d}|${t.id}">${t.done?'Undo':'Done'}</button>
          <button class="btn outline" data-del="${d}|${t.id}">Delete</button>
        </div>`).join('')}</div>
      </div>`;
    }).join('');
  }
  wrap?.addEventListener('click',(e)=>{
    const data = load(WKEY);
    if (e.target.dataset.add) {
      const d = e.target.dataset.add, v = Q('#w_'+d).value.trim(); if (!v) return;
      data[d] = data[d]||[]; data[d].push({id:crypto.randomUUID(),text:v,done:false}); save(WKEY,data); renderWeekly();
    }
    if (e.target.dataset.tgl) {
      const [d,id]=e.target.dataset.tgl.split('|'); const it=(data[d]||[]).find(x=>x.id===id); it.done=!it.done; save(WKEY,data); renderWeekly();
    }
    if (e.target.dataset.del) {
      const [d,id]=e.target.dataset.del.split('|'); const arr=(data[d]||[]); const i=arr.findIndex(x=>x.id===id); arr.splice(i,1); data[d]=arr; save(WKEY,data); renderWeekly();
    }
  });
  renderWeekly();

  // Global “Lifetime Product Performance” (index bottom)
  Q('#lpRun')?.addEventListener('click', async ()=>{
    const pid = Q('#lpProduct')?.value || '';
    const s   = Q('#lpStart')?.value;
    const e   = Q('#lpEnd')?.value;

    let rem = (await api('/api/remittances')).remittances || [];
    if (pid) rem = rem.filter(r=>r.productId===pid);
    if (s) rem = rem.filter(r=>r.start >= s);
    if (e) rem = rem.filter(r=>r.end   <= e);

    const prodMap = Object.fromEntries(state.products.map(p=>[p.id,p]));
    const byPKC = {}; // product-country buckets
    rem.forEach(r=>{
      const k = `${r.productId}|${r.country}`;
      const prod = prodMap[r.productId]||{};
      const basePerPc = (+prod.cost_china||0) + (+prod.ship_china_to_kenya||0);
      const pcs = +r.pieces||0;
      const extra = (+r.extraPerPiece||0)*pcs;

      if (!byPKC[k]) byPKC[k]={ name:prod.name||r.productId, country:r.country, rev:0, ad:0, ship:0, base:0, pcs:0, profit:0 };
      byPKC[k].rev += (+r.revenue||0);
      byPKC[k].ad  += (+r.adSpend||0);
      byPKC[k].ship+= extra;
      byPKC[k].base+= basePerPc*pcs;
      byPKC[k].pcs += pcs;
    });
    Object.values(byPKC).forEach(v => v.profit = v.rev - v.ad - v.ship - v.base);

    const tb = Q('#lifetimeBody'); let R=0,A=0,S=0,B=0,P=0,PCS=0;
    const rows = Object.values(byPKC).map(v=>{
      R+=v.rev; A+=v.ad; S+=v.ship; B+=v.base; P+=v.profit; PCS+=v.pcs;
      return `<tr><td>${v.name}</td><td>${v.country}</td><td>${fmt(v.rev)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.ship)}</td><td>${fmt(v.base)}</td><td>${fmt(v.pcs)}</td><td>${fmt(v.profit)}</td></tr>`;
    }).join('');
    tb.innerHTML = rows || `<tr><td colspan="8" class="muted">No data</td></tr>`;
    Q('#ltRevT').textContent=fmt(R); Q('#ltAdT').textContent=fmt(A);
    Q('#ltShipT').textContent=fmt(S); Q('#ltBaseT').textContent=fmt(B);
    Q('#ltPiecesT').textContent=fmt(PCS); Q('#ltProfitT').textContent=fmt(P);
  });
}

/* ================================================================
   PRODUCTS PAGE (list)
   ================================================================ */
function renderProductsPage() {
  // add
  Q('#pAdd')?.addEventListener('click', async ()=>{
    const p = {
      name: Q('#pName')?.value.trim(),
      sku:  Q('#pSku')?.value.trim(),
      cost_china: +Q('#pCost')?.value||0,
      ship_china_to_kenya: +Q('#pShip')?.value||0,
      margin_budget: +Q('#pMB')?.value||0
    };
    if (!p.name) return alert('Name required');
    await api('/api/products',{method:'POST', body: JSON.stringify(p)});
    await preload();
    renderProductsTable();
    alert('Product added');
  });
  renderProductsTable();
}

function renderProductsTable() {
  const tb = Q('#productsTable tbody'); if (!tb) return;
  tb.innerHTML = state.products.map(p=>`
    <tr>
      <td>${p.name}</td>
      <td>${p.sku||'-'}</td>
      <td><span class="badge ${p.status==='paused'?'muted':''}">${p.status||'active'}</span></td>
      <td>
        <a class="btn" href="/product.html?id=${p.id}">Open</a>
        <button class="btn outline act-toggle" data-id="${p.id}">${p.status==='active'?'Pause':'Run'}</button>
        <button class="btn outline act-del" data-id="${p.id}">Delete</button>
      </td>
    </tr>
  `).join('') || `<tr><td colspan="4" class="muted">No products</td></tr>`;

  tb.onclick = async (e)=>{
    const id = e.target.dataset?.id; if (!id) return;
    if (e.target.classList.contains('act-toggle')) {
      const p = state.products.find(x=>x.id===id); const ns = p.status==='active'?'paused':'active';
      await api(`/api/products/${id}/status`,{method:'POST', body: JSON.stringify({status:ns})});
      await preload(); renderProductsTable();
    }
    if (e.target.classList.contains('act-del')) {
      if (!confirm('Delete product and ALL its data?')) return;
      await api(`/api/products/${id}`,{method:'DELETE'}); // server cascades
      await preload(); renderProductsTable(); renderCountryStockSpend(); renderKpis();
    }
  };
}

/* ================================================================
   PERFORMANCE PAGE
   ================================================================ */
function renderPerformancePage() {
  // Top delivered
  Q('#pfRun')?.addEventListener('click', async ()=>{
    const quick = Q('#pfQuick')?.value;
    let start = Q('#pfStart')?.value, end = Q('#pfEnd')?.value;
    if (quick && quick!=='custom') { const d=new Date(); d.setDate(d.getDate()-(+quick)); start=d.toISOString().slice(0,10); end=isoToday(); }
    const c = Q('#pfCountry')?.value || '';
    let rem = (await api('/api/remittances')).remittances || [];
    rem = rem.filter(r => (r.country||'').toLowerCase() !== 'china');
    if (start) rem = rem.filter(r=>r.start>=start);
    if (end)   rem = rem.filter(r=>r.end<=end);
    if (c)     rem = rem.filter(r=>r.country===c);

    const prodMap = Object.fromEntries(state.products.map(p=>[p.id,p]));
    const by = {}; // product-country
    rem.forEach(r=>{
      const k = `${r.productId}|${r.country}`;
      const prod = prodMap[r.productId]||{};
      if (!by[k]) by[k]={ name: prod.name||r.productId, country:r.country, pieces:0, ad:0, prodCost:0, profit:0 };
      const pcs = +r.pieces||0;
      const base = (+prod.cost_china||0)+(+prod.ship_china_to_kenya||0);
      const extra = (+r.extraPerPiece||0)*pcs;
      by[k].pieces += pcs;
      by[k].ad     += (+r.adSpend||0);
      by[k].prodCost += base*pcs;
      by[k].profit += (+r.revenue||0) - (+r.adSpend||0) - extra - base*pcs;
    });

    const tb = Q('#pfTable tbody');
    tb.innerHTML = Object.values(by).sort((a,b)=>b.pieces-a.pieces).map(x =>
      `<tr><td>${x.name}</td><td>${x.country}</td><td>${fmt(x.pieces)}</td><td>${fmt(x.ad)}</td><td>${fmt(x.prodCost)}</td><td>${fmt(x.profit)}</td><td>${x.pieces?fmt(x.profit/x.pieces):'0'}</td></tr>`
    ).join('') || `<tr><td colspan="7" class="muted">No data</td></tr>`;
  });

  // Remittance add
  Q('#rAdd')?.addEventListener('click', async ()=>{
    const p = {
      start: Q('#rStart')?.value, end: Q('#rEnd')?.value,
      country: Q('#rCountry')?.value, productId: Q('#rProduct')?.value,
      orders:+Q('#rOrders')?.value||0, pieces:+Q('#rPieces')?.value||0,
      revenue:+Q('#rRev')?.value||0, adSpend:+Q('#rAds')?.value||0,
      extraPerPiece:+Q('#rExtra')?.value||0
    };
    if (!p.start||!p.end||!p.productId||!p.country) return alert('Fill dates, product, country');
    await api('/api/remittances',{method:'POST', body: JSON.stringify(p)});
    alert('Remittance saved');
  });
}

/* ================================================================
   FINANCE PAGE
   ================================================================ */
function renderFinancePage() {
  refreshFinanceCategories();
  Q('#fcAdd')?.addEventListener('click', async ()=>{
    const type = Q('#fcType')?.value, name = Q('#fcName')?.value.trim();
    if (!name) return;
    await api('/api/finance/categories',{method:'POST', body: JSON.stringify({type,name})});
    Q('#fcName').value=''; await refreshFinanceCategories();
  });

  // delete category chips (delegation)
  Q('#finance')?.addEventListener('click', async (e)=>{
    if (e.target.classList.contains('chip-x')) {
      const type = e.target.dataset.type, name = e.target.dataset.name;
      if (!confirm(`Delete category "${name}"?`)) return;
      await api(`/api/finance/categories?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}`,{method:'DELETE'});
      await refreshFinanceCategories();
    }
  });

  // entries add
  Q('#feAdd')?.addEventListener('click', async ()=>{
    const date = Q('#feDate')?.value, cat = Q('#feCat')?.value, amt = +Q('#feAmt')?.value||0, note = Q('#feNote')?.value||'';
    if (!date||!cat) return alert('Pick date & category');
    const type = state.categories.credit.includes(cat) ? 'credit':'debit';
    await api('/api/finance/entries',{method:'POST', body: JSON.stringify({date,type,category:cat,amount:amt,note})});
    Q('#feAmt').value=''; Q('#feNote').value='';
    await runFinancePeriod();
  });

  Q('#feRun')?.addEventListener('click', runFinancePeriod);
  runFinancePeriod();
}

async function refreshFinanceCategories() {
  const cats = await api('/api/finance/categories');
  state.categories = cats;
  const mk = (arr, type) => arr.map(c=>`<span class="chip">${c}<button class="chip-x" data-type="${type}" data-name="${c}">×</button></span>`).join('') || '—';
  Q('#fcDebits') && (Q('#fcDebits').innerHTML = mk(cats.debit,'debit'));
  Q('#fcCredits') && (Q('#fcCredits').innerHTML = mk(cats.credit,'credit'));

  // refresh entries select
  const all = [...cats.debit, ...cats.credit].sort();
  Q('#feCat') && (Q('#feCat').innerHTML = `<option value="" disabled selected>Select category</option>` + all.map(c=>`<option>${c}</option>`).join(''));
}

async function runFinancePeriod() {
  const s = Q('#fes')?.value, e = Q('#fee')?.value;
  const r = await api('/api/finance/entries' + ((s||e)?`?start=${s||''}&end=${e||''}`:''));
  Q('#runBalance') && (Q('#runBalance').textContent = fmt(r.running||0)+' USD');
  Q('#feBalance') && (Q('#feBalance').textContent = 'Period Balance: ' + fmt(r.balance||0) + ' USD');
  const tb = Q('#feTable tbody');
  tb && (tb.innerHTML = (r.entries||[]).map(x=>`
    <tr><td>${x.date}</td><td>${x.type}</td><td>${x.category}</td><td>${fmt(x.amount)}</td><td>${x.note||''}</td>
    <td><button class="btn outline fe-del" data-id="${x.id}">Delete</button></td></tr>
  `).join('') || `<tr><td colspan="6" class="muted">No entries</td></tr>`);
  tb?.addEventListener('click', async (e)=>{
    if (e.target.classList.contains('fe-del')) {
      await api(`/api/finance/entries/${e.target.dataset.id}`,{method:'DELETE'});
      await runFinancePeriod();
    }
  }, { once:true });
}

/* ================================================================
   SETTINGS PAGE
   ================================================================ */
function renderSettingsPage() {
  // countries add/delete
  Q('#ctyAdd')?.addEventListener('click', async ()=>{
    const name = Q('#cty')?.value.trim(); if (!name) return;
    await api('/api/countries',{method:'POST', body: JSON.stringify({name})});
    await preload(); renderCountryChips();
  });
  renderCountryChips();
  Q('#ctyList')?.addEventListener('click', async (e)=>{
    if (e.target.classList.contains('chip-x')) {
      const name = e.target.dataset.name;
      if (!confirm(`Delete country "${name}"?`)) return;
      await api(`/api/countries/${encodeURIComponent(name)}`,{method:'DELETE'});
      await preload(); renderCountryChips(); fillCommonSelects();
    }
  });

  // edit product info
  const sel = Q('#epSelect');
  if (sel) {
    sel.innerHTML = `<option value="">Select product…</option>`+
      state.products.map(p=>`<option value="${p.id}">${p.name}${p.sku?` (${p.sku})`:''}</option>`).join('');
    sel.onchange = ()=>{
      const p = state.products.find(x=>x.id===sel.value);
      if (!p) return;
      Q('#epName').value = p.name||''; Q('#epSku').value = p.sku||'';
      Q('#epCost').value = p.cost_china||0; Q('#epShip').value = p.ship_china_to_kenya||0;
      Q('#epMB').value = p.margin_budget||0;
    };
    Q('#epSave')?.addEventListener('click', async ()=>{
      const id = sel.value; if (!id) return alert('Pick a product');
      const up = {
        name: Q('#epName').value, sku: Q('#epSku').value,
        cost_china:+Q('#epCost').value||0, ship_china_to_kenya:+Q('#epShip').value||0,
        margin_budget:+Q('#epMB').value||0
      };
      await api(`/api/products/${id}`,{method:'PUT', body: JSON.stringify(up)});
      await preload(); alert('Saved');
    });
  }

  // manual save/restore (snapshot kept after push)
  const listBox = Q('#snapList');
  async function refreshSnaps() {
    const r = await api('/api/snapshots');
    listBox.innerHTML = (r.snapshots||[]).map(s=>`
      <tr>
        <td>${s.name}</td><td>${s.file.replace(/^.*data\\?\\/,'')}</td>
        <td>
          <button class="btn outline ss-push" data-file="${s.file}">Push</button>
          <button class="btn outline ss-del" data-id="${s.id}">Delete</button>
        </td>
      </tr>`).join('') || `<tr><td colspan="3" class="muted">No snapshots</td></tr>`;
  }
  refreshSnaps();

  Q('#snapSave')?.addEventListener('click', async ()=>{
    const name = Q('#snapName')?.value.trim() || ('Manual '+new Date().toLocaleString());
    await api('/api/snapshots',{method:'POST', body: JSON.stringify({name})});
    Q('#snapName').value='';
    await refreshSnaps();
  });

  listBox?.addEventListener('click', async (e)=>{
    if (e.target.classList.contains('ss-push')) {
      await api('/api/snapshots/restore',{method:'POST', body: JSON.stringify({file:e.target.dataset.file})});
      alert('Pushed snapshot to system. (Snapshot kept)');
      location.reload();
    }
    if (e.target.classList.contains('ss-del')) {
      if (!confirm('Delete this snapshot?')) return;
      await api(`/api/snapshots/${e.target.dataset.id}`,{method:'DELETE'});
      await refreshSnaps();
    }
  });
}

function renderCountryChips() {
  const box = Q('#ctyList'); if (!box) return;
  box.innerHTML = state.countries.map(c=>`<span class="chip">${c}<button class="chip-x" data-name="${c}">×</button></span>`).join('') || '—';
}

/* ================================================================
   PRODUCT PAGE (product.html?id=...)
   ================================================================ */
async function renderProductPage() {
  await preload();
  const product = state.products.find(p=>p.id===state.productId);
  if (!product) { alert('Product not found'); location.href='/'; return; }
  Q('#pdTitle').textContent = product.name;
  Q('#pdSku').textContent = product.sku ? `SKU: ${product.sku}` : '';

  // fills are already done; ensure selects honor no-China rules
  // Stock & Ad Spend by Country (this product only)
  await renderProductStockAd(product);
  // Profit + Budget per country (manual budgets)
  renderProductBudgets(product);
  // Daily Ad Spend (replace current) – product selection restored
  bindProductDailyAdSpend(product);
  // Transit tables
  await renderProductTransit(product);
  // Lifetime (this product) with filter
  bindProductLifetime(product);
  // Influencers
  await bindInfluencers(product);
}

async function renderProductStockAd(product) {
  const tb = Q('#pdStockBody'); if (!tb) return;
  const per = {}; state.countries.forEach(c=> per[c]={stock:0,ad:0});

  const s = await api('/api/shipments');
  (s.shipments||[]).filter(x=>x.productId===product.id && x.arrivedAt).forEach(sp=>{
    const to = sp.toCountry||sp.to, from = sp.fromCountry||sp.from, q=(+sp.qty||0);
    per[to]=per[to]||{stock:0,ad:0}; per[to].stock += q;
    if (from) { per[from]=per[from]||{stock:0,ad:0}; per[from].stock -= q; }
  });

  const r = await api('/api/remittances');
  (r.remittances||[]).filter(x=>x.productId===product.id).forEach(rr=>{
    per[rr.country]=per[rr.country]||{stock:0,ad:0};
    per[rr.country].stock -= (+rr.pieces||0);
  });

  const a = await api('/api/adspend');
  (a.adSpends||[]).filter(x=>x.productId===product.id).forEach(sp=>{
    per[sp.country]=per[sp.country]||{stock:0,ad:0};
    per[sp.country].ad += (+sp.amount||0);
  });

  let st=0, ad=0;
  tb.innerHTML = Object.entries(per)
    .filter(([c]) => (c||'').toLowerCase() !== 'china')   // hide China here
    .map(([c,v])=>{
      st+=v.stock; ad+=v.ad;
      return `<tr><td>${c}</td><td>${fmt(v.stock)}</td><td>${fmt(v.ad)}</td></tr>`;
    }).join('') || `<tr><td colspan="3" class="muted">No data</td></tr>`;
  Q('#pdStockTotal').textContent = fmt(st);
  Q('#pdAdTotal').textContent = fmt(ad);
}

function renderProductBudgets(product) {
  const sel = Q('#pdPBCountry'), inp = Q('#pdPBValue'), btn = Q('#pdPBSave'), tb=Q('#pdPBBBody');
  const map = product.budgets||{};
  const list = state.countriesNoCN; // hide China here
  tb.innerHTML = list.map(c=>`
    <tr><td>${c}</td><td>${fmt(map[c]||0)}</td>
    <td><button class="btn outline pb-clear" data-c="${c}">Clear</button></td></tr>
  `).join('') || `<tr><td colspan="3" class="muted">No budgets yet</td></tr>`;

  btn.onclick = async ()=>{
    const c = sel.value; const v = +inp.value||0;
    const up = { budgets: {...(product.budgets||{}), [c]: v } };
    await api(`/api/products/${product.id}`,{method:'PUT', body: JSON.stringify(up)});
    await renderProductPage();
  };
  tb.onclick = async (e)=>{
    if (e.target.classList.contains('pb-clear')) {
      const c = e.target.dataset.c;
      const up = { budgets: {...(product.budgets||{})} }; delete up.budgets[c];
      await api(`/api/products/${product.id}`,{method:'PUT', body: JSON.stringify(up)});
      await renderProductPage();
    }
  };
}

function bindProductDailyAdSpend(product) {
  const selProd = Q('#pdProductForSpend');
  const btn = Q('#pdAdSave');
  if (selProd) selProd.value = product.id; // lock default to this product but allow change
  btn.onclick = async ()=>{
    const pid = Q('#pdProductForSpend')?.value || product.id;
    const payload = {
      productId: pid,
      country: Q('#pdAdCountry')?.value,
      platform: Q('#pdAdPlatform')?.value,
      amount: +Q('#pdAdAmount')?.value||0
    };
    if (!payload.country||!payload.platform) return alert('Choose country & platform');
    await api('/api/adspend',{method:'POST', body: JSON.stringify(payload)});
    await renderProductStockAd(product);
    alert('Ad spend saved');
  };
}

async function renderProductTransit(product) {
  const s = await api('/api/shipments');
  const list = (s.shipments||[]).filter(x=>x.productId===product.id && !x.arrivedAt);
  const ck = list.filter(sp => (sp.fromCountry||sp.from||'').toLowerCase()==='china' && (sp.toCountry||sp.to||'').toLowerCase()==='kenya');
  const ic = list.filter(sp => !ck.includes(sp));
  const row = sp => `<tr>
    <td>${sp.id}</td><td>${sp.fromCountry||sp.from} → ${sp.toCountry||sp.to}</td>
    <td>${fmt(sp.qty)}</td><td>${fmt(sp.shipCost)}</td>
    <td>${sp.departedAt||''}</td><td>${sp.arrivedAt||''}</td><td>
      <button class="btn outline p-act-arr" data-id="${sp.id}">Arrived</button>
      <button class="btn outline p-act-edit" data-id="${sp.id}">Edit</button>
      <button class="btn outline p-act-del" data-id="${sp.id}">Delete</button>
    </td></tr>`;
  Q('#pdShipCKBody').innerHTML = ck.map(row).join('') || `<tr><td colspan="7" class="muted">No shipments</td></tr>`;
  Q('#pdShipICBody').innerHTML = ic.map(row).join('') || `<tr><td colspan="7" class="muted">No shipments</td></tr>`;

  const host = Q('#product');
  host.addEventListener('click', async (e)=>{
    const raw = e.target?.dataset?.id; if (!raw) return;
    const id = (raw || '').trim();

    if (e.target.classList.contains('p-act-arr')) {
      const date = prompt('Arrival date (YYYY-MM-DD)', isoToday()); if (!date) return;
      await api(`/api/shipments/${id}`,{method:'PUT', body: JSON.stringify({arrivedAt:date})});
      await renderProductTransit(product); await renderProductStockAd(product);
    }
    if (e.target.classList.contains('p-act-edit')) {
      const qty = +prompt('New qty?', '0')||0;
      const shipCost = +prompt('New shipping cost?', '0')||0;
      await api(`/api/shipments/${id}`,{method:'PUT', body: JSON.stringify({qty,shipCost})});
      await renderProductTransit(product);
    }
    if (e.target.classList.contains('p-act-del')) {
      if (!confirm('Delete shipment?')) return;
      await api(`/api/shipments/${id}`,{method:'DELETE'});
      await renderProductTransit(product);
    }
  }, { once:true });

  // create new shipment (product page)
  Q('#pdMvAdd')?.addEventListener('click', async ()=>{
    const payload = {
      productId: product.id,
      fromCountry: Q('#pdMvFrom').value,
      toCountry: Q('#pdMvTo').value,
      qty: +Q('#pdMvQty').value||0,
      shipCost: +Q('#pdMvShip').value||0,
      departedAt: isoToday(), arrivedAt: null
    };
    await api('/api/shipments',{method:'POST', body: JSON.stringify(payload)});
    await renderProductTransit(product);
  }, { once:true });
}

function bindProductLifetime(product) {
  const run = async ()=>{
    const s = Q('#pdLPStart')?.value, e = Q('#pdLPEnd')?.value;
    let rem = (await api('/api/remittances')).remittances || [];
    rem = rem.filter(r=>r.productId===product.id);
    if (s) rem = rem.filter(r=>r.start >= s);
    if (e) rem = rem.filter(r=>r.end   <= e);
    const base = (+product.cost_china||0) + (+product.ship_china_to_kenya||0);
    const byC = {};
    rem.forEach(r=>{
      const pcs=+r.pieces||0, extra=(+r.extraPerPiece||0)*pcs;
      if (!byC[r.country]) byC[r.country]={rev:0,ad:0,ship:0,base:0,pcs:0,profit:0};
      byC[r.country].rev += (+r.revenue||0);
      byC[r.country].ad  += (+r.adSpend||0);
      byC[r.country].ship+= extra;
      byC[r.country].base+= base*pcs;
      byC[r.country].pcs += pcs;
    });
    Object.values(byC).forEach(v=> v.profit = v.rev - v.ad - v.ship - v.base);

    const tb = Q('#pdLPBody'); let R=0,A=0,S=0,B=0,P=0,PCS=0;
    tb.innerHTML = Object.entries(byC).map(([c,v])=>{
      R+=v.rev;A+=v.ad;S+=v.ship;B+=v.base;P+=v.profit;PCS+=v.pcs;
      return `<tr><td>${c}</td><td>${fmt(v.rev)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.ship)}</td><td>${fmt(v.base)}</td><td>${fmt(v.pcs)}</td><td>${fmt(v.profit)}</td></tr>`;
    }).join('') || `<tr><td colspan="7" class="muted">No data</td></tr>`;
    Q('#pdLPRevT').textContent=fmt(R); Q('#pdLPAdT').textContent=fmt(A);
    Q('#pdLPShipT').textContent=fmt(S); Q('#pdLPBaseT').textContent=fmt(B);
    Q('#pdLPPcsT').textContent=fmt(PCS); Q('#pdLPProfitT').textContent=fmt(P);
  };
  Q('#pdLPRun')?.addEventListener('click', run);
  run();
}

async function bindInfluencers(product) {
  // add influencer
  Q('#pdInfAdd')?.addEventListener('click', async ()=>{
    const payload = {
      name: Q('#pdInfName')?.value.trim(),
      social: Q('#pdInfSocial')?.value.trim(),
      country: Q('#pdInfCountry')?.value
    };
    if (!payload.name) return alert('Name required');
    await api('/api/influencers',{method:'POST', body: JSON.stringify(payload)});
    Q('#pdInfName').value=''; Q('#pdInfSocial').value='';
    await refreshInfluencers(product);
  });

  // add spend
  Q('#pdInfSpendAdd')?.addEventListener('click', async ()=>{
    const payload = {
      date: Q('#pdInfDate')?.value || isoToday(),
      influencerId: Q('#pdInfSelect')?.value,
      country: Q('#pdInfCountry')?.value,
      productId: product.id,
      amount: +Q('#pdInfAmount')?.value||0
    };
    if (!payload.influencerId) return alert('Select influencer');
    await api('/api/influencers/spend',{method:'POST', body: JSON.stringify(payload)});
    await refreshInfluencers(product);
  });

  // filters
  Q('#pdInfRun')?.addEventListener('click', ()=>refreshInfluencers(product));
  await refreshInfluencers(product);
}

async function refreshInfluencers(product) {
  const infs = await api('/api/influencers');
  const spends = await api('/api/influencers/spend');
  const sel = Q('#pdInfSelect');
  sel.innerHTML = (infs.influencers||[]).map(i=>`<option value="${i.id}">${i.name}</option>`).join('') || '<option value="">No influencers</option>';

  const s = Q('#pdInfStart')?.value, e = Q('#pdInfEnd')?.value, c = Q('#pdInfFilterCountry')?.value||'';
  const list = (spends.spends||[]).filter(x=>x.productId===product.id)
    .filter(x=>(!c || x.country===c))
    .filter(x=>(!s || x.date>=s) && (!e || x.date<=e));
  const infMap = Object.fromEntries((infs.influencers||[]).map(i=>[i.id,i]));
  let total = 0;
  Q('#pdInfBody').innerHTML = list.map(x=>{
    total += (+x.amount||0);
    const i = infMap[x.influencerId]||{};
    return `<tr><td>${x.date}</td><td>${x.country}</td><td>${i.name||'-'}</td><td>${i.social||'-'}</td><td>${fmt(x.amount)}</td>
      <td><button class="btn outline inf-del" data-id="${x.id}">Delete</button></td></tr>`;
  }).join('') || `<tr><td colspan="6" class="muted">No spends</td></tr>`;
  Q('#pdInfTotal').textContent = fmt(total);

  Q('#pdInfBody').onclick = async (e)=>{
    if (e.target.classList.contains('inf-del')) {
      await api(`/api/influencers/spend/${e.target.dataset.id}`,{method:'DELETE'});
      await refreshInfluencers(product);
    }
  };
}

/* ================================================================
   NAV
   ================================================================ */
function bindGlobalNav() {
  QA('.nav a[data-view]')?.forEach(a => a.addEventListener('click', e=>{
    e.preventDefault();
    const v = a.dataset.view;
    ['home','products','performance','finance','settings'].forEach(id=>{
      const el = Q('#'+id);
      if (el) el.style.display = (id===v)?'':'none';
    });
    QA('.nav a').forEach(x=>x.classList.toggle('active', x===a));
    if (v==='home') { renderKpis(); renderCountryStockSpend(); renderTransitTables(); }
  }));
}

/* ================================================================
   BOOT
   ================================================================ */
boot();
