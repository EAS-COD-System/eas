/* =========================
   EAS Tracker – Front-end
   ========================= */

/* ---------- helpers ---------- */
const Q  = (s, r = document) => r.querySelector(s);
const QA = (s, r = document) => Array.from(r.querySelectorAll(s));
const fmt = n => (Number(n || 0)).toLocaleString(undefined, { maximumFractionDigits: 2 });
const todayISO = () => new Date().toISOString().slice(0,10);
const getQuery  = k => new URLSearchParams(location.search).get(k);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data?.error || data || ('HTTP ' + res.status));
  return data;
}

/* ---------- global state ---------- */
const state = {
  countries: [],
  products: [],
  categories: { debit: [], credit: [] },
  product: null,
  productId: getQuery('id')
};

/* ---------- AUTH & BOOT ---------- */
async function gate() {
  try {
    const meta = await api('/api/meta');              // { countries }
    state.countries = meta.countries || [];
    await preloadProducts();                          // fills state.products

    fillGlobalSelects();
    initNav();

    const login = Q('#login');
    const main  = Q('#main');
    if (login) { login.style.display = 'none'; login.classList.add('hide'); }
    if (main)  { main.style.display  = '';     main.classList.remove('hide'); }

    if (state.productId) {
      await loadProduct(state.productId);
      renderProductPage();
    } else {
      initDashboard();
      initProducts();
      initPerformance();
      initFinance();
      initSettings();
    }
  } catch (e) {
    // show login if meta failed (not authed)
    Q('#login')?.classList.remove('hide');
    Q('#main')?.setAttribute('style', 'display:none');
  }
}

Q('#loginBtn')?.addEventListener('click', async () => {
  const pw = Q('#pw')?.value?.trim();
  if (!pw) return alert('Enter password');
  try {
    await api('/api/auth', { method:'POST', body: JSON.stringify({ password: pw }) });
    await gate();
  } catch {
    alert('Wrong password');
  }
});

Q('#logoutLink')?.addEventListener('click', async e => {
  e.preventDefault();
  try { await api('/api/auth', { method:'POST', body: JSON.stringify({ password: 'logout' }) }); } catch {}
  location.reload();
});

/* ---------- common data ---------- */
async function preloadProducts() {
  try {
    const r = await api('/api/products');
    state.products = r.products || [];
  } catch { state.products = []; }
}

function options(arr, first) {
  const pre = first ? `<option value="">${first}</option>` : '';
  return pre + (arr || []).map(v => `<option value="${v.value ?? v.id ?? v}">${v.label ?? v.name ?? v}</option>`).join('');
}

function fillGlobalSelects() {
  // Countries
  const countryTargets = [
    '#mvFrom','#mvTo','#adCountry','#pcCountry','#rCountry',
    '#pdAdCountry','#pdRCountry','#pdMvFrom','#pdMvTo','#pdPBCountry',
    '#pdInfCountry','#pdInfFilterCountry'
  ];
  countryTargets.forEach(sel => QA(sel).forEach(el => {
    el.innerHTML = options(state.countries.map(c => ({ id:c, name:c })));
  }));

  // Products
  const productTargets = ['#adProduct','#rProduct','#mvProduct','#lpProduct','#epSelect'];
  productTargets.forEach(sel => QA(sel).forEach(el => {
    el.innerHTML = options(state.products.map(p => ({ id:p.id, name: p.name + (p.sku ? ` (${p.sku})` : '') })), el.id==='lpProduct' ? 'All products' : null);
  }));

  // Performance country (add "All countries" at top)
  QA('#pfCountry').forEach(el => {
    el.innerHTML = options([{ id:'', name:'All countries'}].concat(state.countries.map(c => ({ id:c, name:c }))));
  });
}

/* ==============================================================
   DASHBOARD
   ============================================================== */
function initDashboard() {
  renderKpis();
  renderStockAndSpendByCountry();
  initWeeklyDelivered();
  initDailyAdSpend();
  initMovements();
  renderTransitTables();
  initProfitByCountry();
}

async function renderKpis() {
  Q('#kpiProducts') && (Q('#kpiProducts').textContent = state.products.length);
  Q('#kpiCountries') && (Q('#kpiCountries').textContent = state.countries.length);

  try {
    const s = await api('/api/shipments');
    const live = (s.shipments || []).filter(x => !x.arrivedAt).length;
    Q('#kpiTransit') && (Q('#kpiTransit').textContent = live);
  } catch { Q('#kpiTransit') && (Q('#kpiTransit').textContent = '—'); }

  // total ad spend = sum of /api/adspend (replace style)
  try {
    const a = await api('/api/adspend');
    const total = (a.adSpends || []).reduce((t,x)=> t + (+x.amount||0), 0);
    Q('#kpiAdSpend') && (Q('#kpiAdSpend').textContent = fmt(total) + ' USD');
  } catch { Q('#kpiAdSpend') && (Q('#kpiAdSpend').textContent = '—'); }

  // Delivered Mon–Sun KPI = weekly grid total (if grid present we recompute there too)
  try {
    const sum = await weeklyDeliveredSumThisWeek();
    Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = fmt(sum));
  } catch { Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = '—'); }
}

/* ---- Stock & Spend by Country (global) ---- */
async function renderStockAndSpendByCountry() {
  const body = Q('#stockByCountryBody'); if (!body) return;

  const per = {};
  state.countries.forEach(c => per[c] = { stock: 0, ad: 0 });

  try {
    const s = await api('/api/shipments');
    (s.shipments || []).forEach(sp => {
      if (sp.arrivedAt) {
        const to = sp.toCountry || sp.to, from = sp.fromCountry || sp.from, q = +sp.qty || 0;
        if (to)   { per[to]   = per[to]   || {stock:0,ad:0}; per[to].stock   += q; }
        if (from) { per[from] = per[from] || {stock:0,ad:0}; per[from].stock -= q; }
      }
    });
  } catch {}

  try {
    const r = await api('/api/remittances');
    (r.remittances || []).forEach(rr => {
      per[rr.country] = per[rr.country] || { stock:0, ad:0 };
      per[rr.country].stock -= (+rr.pieces || 0);
    });
  } catch {}

  try {
    const a = await api('/api/adspend');
    (a.adSpends || []).forEach(x => {
      per[x.country] = per[x.country] || { stock:0, ad:0 };
      per[x.country].ad += (+x.amount || 0);
    });
  } catch {}

  let st=0, at=0;
  body.innerHTML = Object.entries(per).map(([c,v])=>{
    st+=v.stock; at+=v.ad;
    return `<tr><td>${c}</td><td>${fmt(v.stock)}</td><td>${fmt(v.ad)}</td></tr>`;
  }).join('');
  Q('#stockTotal') && (Q('#stockTotal').textContent = fmt(st));
  Q('#adTotal') && (Q('#adTotal').textContent = fmt(at));
}

/* ---- Weekly Delivered grid ---- */
function mondayOf(dateISO){
  const d = new Date(dateISO);
  const day = (d.getDay()+6)%7; d.setDate(d.getDate()-day);
  return d;
}
function daysOfWeek(dateISO){
  const m = mondayOf(dateISO);
  return [...Array(7)].map((_,i)=>{const d=new Date(m); d.setDate(m.getDate()+i); return d.toISOString().slice(0,10);});
}
async function weeklyDeliveredSumThisWeek(){
  const r = await api('/api/deliveries');
  const days = new Set(daysOfWeek(todayISO()));
  return (r.deliveries||[]).filter(x=>days.has(x.date)).reduce((t,x)=>t+(+x.delivered||0),0);
}

async function initWeeklyDelivered() {
  const head = Q('#weeklyHead'), body = Q('#weeklyBody'); if (!head || !body) return;

  const days = daysOfWeek(todayISO());
  head.innerHTML = `<tr><th>Country</th>${days.map(d=>`<th>${new Date(d).toLocaleDateString(undefined,{weekday:'short'})}<br>${d}</th>`).join('')}<th>Total</th></tr>`;
  body.innerHTML = state.countries.map(c=>{
    const cells = days.map(d=>`<td><input class="wd-cell" data-country="${c}" data-date="${d}" type="number" min="0" placeholder="0"/></td>`).join('');
    return `<tr data-row="${c}"><td>${c}</td>${cells}<td class="row-total">0</td></tr>`;
  }).join('');

  // preload existing week
  try {
    const r = await api('/api/deliveries');
    const byKey = {};
    (r.deliveries || []).forEach(x => byKey[`${x.country}|${x.date}`] = +x.delivered || 0);
    QA('.wd-cell').forEach(inp => {
      const k = `${inp.dataset.country}|${inp.dataset.date}`;
      if (byKey[k] != null) inp.value = byKey[k];
    });
    computeWeeklyTotals();
  } catch {}

  Q('#weeklySave')?.addEventListener('click', async () => {
    const payload = [];
    QA('.wd-cell').forEach(inp => {
      const v = +inp.value || 0;
      if (v > 0) payload.push({ date: inp.dataset.date, country: inp.dataset.country, delivered: v });
    });
    try {
      for (const rec of payload) {
        await api('/api/deliveries', { method:'POST', body: JSON.stringify(rec) });
      }
      alert('Saved');
      computeWeeklyTotals();
      renderKpis();
    } catch(e){ alert(e.message); }
  });

  Q('#weeklyReset')?.addEventListener('click', () => {
    QA('.wd-cell').forEach(i => i.value=''); computeWeeklyTotals();
  });

  body.addEventListener('input', e => {
    if (e.target.classList.contains('wd-cell')) computeWeeklyTotals();
  });
}

function computeWeeklyTotals(){
  // row totals
  QA('tr[data-row]').forEach(tr=>{
    const t = QA('.wd-cell', tr).reduce((s,el)=> s + (+el.value||0), 0);
    Q('.row-total', tr).textContent = fmt(t);
  });
}

/* ---- Daily Ad Spend (replace) ---- */
function initDailyAdSpend(){
  Q('#adSave')?.addEventListener('click', async () => {
    const payload = {
      productId: Q('#adProduct')?.value,
      country:   Q('#adCountry')?.value,
      platform:  Q('#adPlatform')?.value,
      amount:   +Q('#adAmount')?.value || 0
    };
    if (!payload.productId || !payload.country || !payload.platform) return alert('Missing fields');
    try {
      await api('/api/adspend', { method:'POST', body: JSON.stringify(payload) });
      alert('Saved');
      renderKpis(); renderStockAndSpendByCountry();
    } catch(e){ alert(e.message); }
  });
}

/* ---- Movements / Transit ---- */
function initMovements(){
  Q('#mvAdd')?.addEventListener('click', async () => {
    const payload = {
      productId: Q('#mvProduct')?.value,
      fromCountry: Q('#mvFrom')?.value,
      toCountry: Q('#mvTo')?.value,
      qty: +Q('#mvQty')?.value || 0,
      shipCost: +Q('#mvShip')?.value || 0,
      departedAt: todayISO(),
      arrivedAt: null
    };
    if (!payload.productId) return alert('Select product');
    try {
      await api('/api/shipments', { method:'POST', body: JSON.stringify(payload) });
      alert('Movement added');
      renderTransitTables();
    } catch(e){ alert(e.message); }
  });
}

async function renderTransitTables(){
  const s = await api('/api/shipments');
  const list = (s.shipments||[]).filter(x=>!x.arrivedAt);
  const names = Object.fromEntries(state.products.map(p=>[p.id,p.name]));

  const row = sp => `<tr>
    <td>${sp.id}</td>
    <td>${names[sp.productId] || sp.productId}</td>
    <td>${(sp.fromCountry||sp.from)} → ${(sp.toCountry||sp.to)}</td>
    <td>${fmt(sp.qty)}</td>
    <td>${fmt(sp.shipCost)}</td>
    <td>${sp.departedAt||''}</td>
    <td>${sp.arrivedAt||''}</td>
    <td>
      <button class="btn outline" data-arr="${sp.id}">Mark Arrived</button>
      <button class="btn outline" data-edit="${sp.id}">Edit</button>
      <button class="btn outline" data-del="${sp.id}">Delete</button>
    </td>
  </tr>`;

  const ck = list.filter(sp => (sp.fromCountry||'').toLowerCase()==='china' && (sp.toCountry||'').toLowerCase()==='kenya');
  const ic = list.filter(sp => !ck.includes(sp));

  Q('#shipCKBody') && (Q('#shipCKBody').innerHTML = ck.map(row).join('') || `<tr><td colspan="8" class="muted">No transit</td></tr>`);
  Q('#shipICBody') && (Q('#shipICBody').innerHTML = ic.map(row).join('') || `<tr><td colspan="8" class="muted">No transit</td></tr>`);

  // actions
  QA('[data-arr]').forEach(b => b.onclick = async () => {
    const id = b.dataset.arr;
    const date = prompt('Arrival date (YYYY-MM-DD)', todayISO()); if (!date) return;
    try { await api('/api/shipments/'+id, { method:'PUT', body: JSON.stringify({ arrivedAt: date }) }); }
    catch(e){ return alert(e.message); }
    renderTransitTables(); renderStockAndSpendByCountry();
  });
  QA('[data-edit]').forEach(b => b.onclick = async () => {
    const id = b.dataset.edit;
    const qty = +prompt('New qty?', '0') || 0;
    const shipCost = +prompt('New shipping cost?', '0') || 0;
    await api('/api/shipments/'+id, { method:'PUT', body: JSON.stringify({ qty, shipCost }) });
    renderTransitTables();
  });
  QA('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete shipment?')) return;
    await api('/api/shipments/'+b.dataset.del, { method:'DELETE' });
    renderTransitTables();
  });
}

/* ---- Profit by Country (from remittances) ---- */
function initProfitByCountry(){
  Q('#pcRun')?.addEventListener('click', async () => {
    const s = Q('#pcStart')?.value, e = Q('#pcEnd')?.value, c = Q('#pcCountry')?.value || '';
    const qs = []; if (s) qs.push('start='+s); if (e) qs.push('end='+e); if (c) qs.push('country='+encodeURIComponent(c));
    try {
      const r = await api('/api/remittances' + (qs.length?('?'+qs.join('&')):''));
      const byC = {};
      (r.remittances||[]).forEach(x=>{
        if (c && x.country!==c) return;
        byC[x.country] = byC[x.country] || { revenue:0, ad:0, extra:0, pieces:0 };
        byC[x.country].revenue += +x.revenue||0;
        byC[x.country].ad      += +x.adSpend||0;
        byC[x.country].extra   += (+x.extraPerPiece||0) * (+x.pieces||0);
        byC[x.country].pieces  += +x.pieces||0;
      });
      const tb = Q('#profitCountryBody');
      tb.innerHTML = Object.entries(byC).map(([cc,v])=>{
        const profit = v.revenue - v.ad - v.extra;
        return `<tr><td>${cc}</td><td>${fmt(v.revenue)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.extra)}</td><td>${fmt(v.pieces)}</td><td>${fmt(profit)}</td></tr>`;
      }).join('') || `<tr><td colspan="6" class="muted">No data</td></tr>`;
    } catch(e){ alert(e.message); }
  });
}

/* ==============================================================
   PRODUCTS LIST
   ============================================================== */
function initProducts(){
  Q('#pAdd')?.addEventListener('click', async () => {
    const payload = {
      name: Q('#pName').value.trim(),
      sku: Q('#pSku').value.trim(),
      cost_china: +Q('#pCost').value || 0,
      ship_china_to_kenya: +Q('#pShip').value || 0,
      margin_budget: +Q('#pMB').value || 0
    };
    if (!payload.name) return alert('Name required');
    await api('/api/products', { method:'POST', body: JSON.stringify(payload) });
    await preloadProducts(); fillGlobalSelects(); renderProductsTable();
    alert('Product added');
  });

  renderProductsTable();
}
function renderProductsTable(){
  const tb = Q('#productsTable tbody'); if (!tb) return;
  tb.innerHTML = state.products.map(p => `
    <tr>
      <td>${p.name}</td>
      <td>${p.sku || '-'}</td>
      <td><span class="badge ${p.status==='paused'?'muted':''}">${p.status || 'active'}</span></td>
      <td>
        <a class="btn" href="/product.html?id=${p.id}">Open</a>
        <button class="btn outline" data-pause="${p.id}">${p.status==='active'?'Pause':'Run'}</button>
        <button class="btn outline" data-del="${p.id}">Delete</button>
      </td>
    </tr>
  `).join('') || `<tr><td colspan="4" class="muted">No products</td></tr>`;

  tb.onclick = async e => {
    const pid = e.target.dataset.pause;
    const del = e.target.dataset.del;
    if (pid) {
      const p = state.products.find(x=>x.id===pid);
      const ns = p.status === 'active' ? 'paused' : 'active';
      await api(`/api/products/${pid}/status`, { method:'POST', body: JSON.stringify({ status: ns }) });
      await preloadProducts(); renderProductsTable();
    } else if (del) {
      if (!confirm('Delete product and ALL its data?')) return;
      await api('/api/products/'+del, { method:'DELETE' });
      await preloadProducts(); fillGlobalSelects(); renderProductsTable(); renderStockAndSpendByCountry();
    }
  };
}

/* ==============================================================
   PERFORMANCE
   ============================================================== */
function initPerformance(){
  Q('#pfRun')?.addEventListener('click', async () => {
    const quick = Q('#pfQuick')?.value;
    let start = Q('#pfStart')?.value, end = Q('#pfEnd')?.value;
    if (quick && quick !== 'custom') {
      const d = new Date(); d.setDate(d.getDate() - (+quick));
      start = d.toISOString().slice(0,10); end = todayISO();
    }
    const c = Q('#pfCountry')?.value || '';
    const qs = []; if (start) qs.push('start='+start); if (end) qs.push('end='+end); if (c) qs.push('country='+encodeURIComponent(c));
    const r = await api('/api/remittances' + (qs.length?('?'+qs.join('&')):''));
    const byP = {};
    const prodMap = Object.fromEntries(state.products.map(p=>[p.id,p]));
    (r.remittances||[]).forEach(x=>{
      const id = x.productId;
      if (!byP[id]) byP[id] = { country:x.country, name: (prodMap[id]?.name || id), pieces:0, ad:0, prodCost:0, profit:0 };
      byP[id].pieces += (+x.pieces||0);
      byP[id].ad     += (+x.adSpend||0);
      const base = (+prodMap[id]?.cost_china||0) + (+prodMap[id]?.ship_china_to_kenya||0);
      const extra = (+x.extraPerPiece||0) * (+x.pieces||0);
      const profit = (+x.revenue||0) - (+x.adSpend||0) - base*(+x.pieces||0) - extra;
      byP[id].prodCost += base*(+x.pieces||0);
      byP[id].profit   += profit;
    });
    const tb = Q('#pfTable tbody');
    tb.innerHTML = Object.values(byP).sort((a,b)=>b.pieces-a.pieces).map(it =>
      `<tr><td>${it.name}</td><td>${it.country||'-'}</td><td>${fmt(it.pieces)}</td><td>${fmt(it.ad)}</td><td>${fmt(it.prodCost)}</td><td>${fmt(it.profit)}</td><td>${it.pieces?fmt(it.profit/it.pieces):'0'}</td></tr>`
    ).join('') || `<tr><td colspan="7" class="muted">No data</td></tr>`;
  });
}
/* --- PERFORMANCE: delete a remittance row (event delegation) --- */
Q('#rTable')?.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-del-remit]');
  if (!btn) return;
  const id = btn.dataset.delRemit;
  if (!id) return;
  if (!confirm('Delete this remittance?')) return;
  await api('/api/remittances/' + id, { method: 'DELETE' });
  // refresh the performance section (re-run with current filters)
  Q('#pfRun')?.click();
});
/* ==============================================================
   FINANCE
   ============================================================== */
async function initFinance(){
  await loadFinanceCats();
  Q('#fcAdd')?.addEventListener('click', async () => {
    const type = Q('#fcType').value, name = Q('#fcName').value.trim();
    if (!name) return;
    await api('/api/finance/categories', { method:'POST', body: JSON.stringify({ type, name }) });
    await loadFinanceCats(); Q('#fcName').value='';
  });

  Q('#feAdd')?.addEventListener('click', async () => {
    const date = Q('#feDate').value, category = Q('#feCat').value, type = Q('#feType').value;
    const amount = +Q('#feAmt').value || 0, note = Q('#feNote').value;
    if (!date || !category || !type) return alert('Missing fields');
    await api('/api/finance/entries', { method:'POST', body: JSON.stringify({ date, type, category, amount, note }) });
    Q('#feNote').value=''; Q('#feAmt').value='';
    renderFinancePeriod();
  });

  Q('#feRun')?.addEventListener('click', renderFinancePeriod);
  renderFinancePeriod();
}
async function loadFinanceCats(){
  try {
    const cats = await api('/api/finance/categories');
    state.categories = cats;
    Q('#fcDebits')  && (Q('#fcDebits').innerHTML  = (cats.debit || []).map(c=>`<span class="chip">${c}</span>`).join('') || '—');
    Q('#fcCredits') && (Q('#fcCredits').innerHTML = (cats.credit|| []).map(c=>`<span class="chip">${c}</span>`).join('') || '—');
    const all = [...(cats.debit||[]), ...(cats.credit||[])].sort();
    Q('#feCat') && (Q('#feCat').innerHTML = `<option value="" disabled selected>Select category</option>` + all.map(c=>`<option>${c}</option>`).join(''));
  } catch {}
}
async function renderFinancePeriod(){
  try {
    const s = Q('#fes')?.value, e = Q('#fee')?.value;
    const r = await api('/api/finance/entries' + ((s||e)?(`?start=${s||''}&end=${e||''}`):'')); 
    const entries = r.entries || [];
    Q('#runBalance') && (Q('#runBalance').textContent = fmt(r.running || 0) + ' USD');
    Q('#feBalance') && (Q('#feBalance').textContent = 'Period Balance: ' + fmt(r.balance || 0) + ' USD');
    const tb = Q('#feTable tbody');
    tb.innerHTML = entries.map(x =>
      `<tr><td>${x.date}</td><td>${x.type}</td><td>${x.category}</td><td>${fmt(x.amount)}</td><td>${x.note||''}</td>
       <td><button class="btn outline" data-del-entry="${x.id}">Delete</button></td></tr>`
    ).join('') || `<tr><td colspan="6" class="muted">No entries</td></tr>`;
    tb.onclick = async e => {
      if (e.target.dataset.delEntry) {
        await api('/api/finance/entries/' + e.target.dataset.delEntry, { method:'DELETE' });
        renderFinancePeriod();
      }
    };
  } catch(e){ alert(e.message); }
}

/* ==============================================================
   SETTINGS
   ============================================================== */
function initSettings(){
  // Countries add
  Q('#ctyAdd')?.addEventListener('click', async () => {
    const name = Q('#cty').value.trim(); if (!name) return;
    if (name.toLowerCase()==='china') return alert('China already exists and cannot be removed.');
    await api('/api/countries', { method:'POST', body: JSON.stringify({ name }) });
    const m = await api('/api/meta'); state.countries = m.countries || [];
    fillGlobalSelects(); renderCountryChips();
  });
  renderCountryChips();

  // Edit Product Info
  const sel = Q('#epSelect');
  if (sel) {
    sel.innerHTML = `<option value="" selected>Select product…</option>` + state.products.map(p=>`<option value="${p.id}">${p.name}${p.sku?` (${p.sku})`:''}</option>`).join('');
    sel.onchange = () => {
      const p = state.products.find(x=>x.id===sel.value); if (!p) return;
      Q('#epName').value = p.name; Q('#epSku').value = p.sku || '';
      Q('#epCost').value = p.cost_china || 0; Q('#epShip').value = p.ship_china_to_kenya || 0;
      Q('#epMB').value   = p.margin_budget || 0;
    };
    Q('#epSave')?.addEventListener('click', async () => {
      const id = sel.value; if (!id) return;
      const p = {
        name: Q('#epName').value, sku: Q('#epSku').value,
        cost_china:+Q('#epCost').value||0, ship_china_to_kenya:+Q('#epShip').value||0,
        margin_budget:+Q('#epMB').value||0
      };
      await api('/api/products/' + id, { method:'PUT', body: JSON.stringify(p) });
      await preloadProducts(); fillGlobalSelects(); renderProductsTable();
      alert('Saved');
    });
  }

  // Snapshot Save / List
  Q('#snapSave')?.addEventListener('click', async () => {
    const name = Q('#snapName')?.value?.trim() || '';
    await api('/api/snapshots', { method:'POST', body: JSON.stringify({ name }) });
    Q('#snapName').value='';
    renderSnapshots();
  });
  renderSnapshots();
}

function renderCountryChips(){
  const list = Q('#ctyList'); if (!list) return;
  list.innerHTML = state.countries.map(c => `<span class="chip">${c}</span>`).join('') || '—';
}

async function renderSnapshots(){
  const r = await api('/api/snapshots');
  const tb = Q('#snapList'); if (!tb) return;
  tb.innerHTML = (r.snapshots || []).map(s => `
    <tr>
      <td>${s.name}</td>
      <td>${s.file.split('/').pop()}</td>
      <td>
        <button class="btn outline" data-restore="${s.file}">Push</button>
        <button class="btn outline" data-del-snap="${s.id}">Delete</button>
      </td>
    </tr>
  `).join('') || `<tr><td colspan="3" class="muted">No snapshots</td></tr>`;

  tb.onclick = async e => {
    if (e.target.dataset.restore) {
      await api('/api/snapshots/restore', { method:'POST', body: JSON.stringify({ file: e.target.dataset.restore }) });
      alert('Pushed to system'); // stays listed (not auto-deleted)
    } else if (e.target.dataset.delSnap) {
      await api('/api/snapshots/' + e.target.dataset.delSnap, { method:'DELETE' });
      renderSnapshots();
    }
  };
}

/* ==============================================================
   PRODUCT PAGE
   ============================================================== */
async function loadProduct(id){
  await preloadProducts();
  state.product = state.products.find(p => p.id === id) || null;
}
function renderProductPage(){
  if (!state.product) { alert('Product not found'); location.href='/'; return; }
  Q('#pdTitle') && (Q('#pdTitle').textContent = state.product.name);
  Q('#pdSku')   && (Q('#pdSku').textContent   = state.product.sku ? `SKU: ${state.product.sku}` : '');
  fillGlobalSelects();
  bindProductHandlers();
  refreshProductSections();
}
function bindProductHandlers(){
  // Manual budget per country (product)
  Q('#pdPBSave')?.addEventListener('click', async () => {
    const c = Q('#pdPBCountry').value; const v = +Q('#pdPBValue').value || 0;
    const p = { budgets: state.product.budgets || {} }; p.budgets[c] = v;
    await api('/api/products/'+state.product.id, { method:'PUT', body: JSON.stringify(p) });
    await loadProduct(state.product.id); renderPBTable();
  });

  // Daily ad spend (this product)
  Q('#pdAdSave')?.addEventListener('click', async () => {
    const payload = {
      productId: state.product.id,
      country: Q('#pdAdCountry').value,
      platform: Q('#pdAdPlatform').value,
      amount: +Q('#pdAdAmount').value || 0
    };
    await api('/api/adspend', { method:'POST', body: JSON.stringify(payload) });
    refreshProductSections();
  });

  // Product shipments
  Q('#pdMvAdd')?.addEventListener('click', async () => {
    const payload = {
      productId: state.product.id,
      fromCountry: Q('#pdMvFrom').value,
      toCountry:   Q('#pdMvTo').value,
      qty: +Q('#pdMvQty').value || 0,
      shipCost: +Q('#pdMvShip').value || 0,
      departedAt: todayISO(),
      arrivedAt: null
    };
    await api('/api/shipments', { method:'POST', body: JSON.stringify(payload) });
    refreshProductSections();
  });

  // Influencers
  Q('#pdInfAdd')?.addEventListener('click', async () => {
    const payload = { name: Q('#pdInfName').value.trim(), social: Q('#pdInfSocial').value.trim(), country: Q('#pdInfCountry').value };
    if (!payload.name) return alert('Name required');
    await api('/api/influencers', { method:'POST', body: JSON.stringify(payload) });
    Q('#pdInfName').value=''; Q('#pdInfSocial').value='';
    renderInfluencers();
  });
  Q('#pdInfSpendAdd')?.addEventListener('click', async () => {
    const payload = {
      date: Q('#pdInfDate').value || todayISO(),
      influencerId: Q('#pdInfSelect').value,
      country: Q('#pdInfCountry').value,
      productId: state.product.id,
      amount: +Q('#pdInfAmount').value || 0
    };
    if (!payload.influencerId) return alert('Select influencer');
    await api('/api/influencers/spend', { method:'POST', body: JSON.stringify(payload) });
    renderInfluencers();
  });
  Q('#pdInfRun')?.addEventListener('click', renderInfluencers);
}

async function refreshProductSections(){
  await loadProduct(state.product.id);
  renderProductStockAd();
  renderPBTable();
  renderProductTransit();
  renderInfluencers();
}

/* product: Stock & Ad by country (this product only) */
async function renderProductStockAd(){
  const tb = Q('#pdStockBody'); if (!tb) return;

  const per = {}; state.countries.forEach(c => per[c] = { stock:0, ad:0 });

  const s = await api('/api/shipments');
  (s.shipments||[]).filter(x=>x.productId===state.product.id && x.arrivedAt).forEach(sp=>{
    const to = sp.toCountry||sp.to, from=sp.fromCountry||sp.from, q=+sp.qty||0;
    per[to] = per[to]||{stock:0,ad:0}; per[to].stock += q;
    if (from){ per[from]=per[from]||{stock:0,ad:0}; per[from].stock -= q; }
  });

  const r = await api('/api/remittances');
  (r.remittances||[]).filter(x=>x.productId===state.product.id).forEach(rr=>{
    per[rr.country]=per[rr.country]||{stock:0,ad:0}; per[rr.country].stock -= (+rr.pieces||0);
  });

  const a = await api('/api/adspend');
  (a.adSpends||[]).filter(x=>x.productId===state.product.id).forEach(ad=>{
    per[ad.country]=per[ad.country]||{stock:0,ad:0}; per[ad.country].ad += (+ad.amount||0);
  });

  let st=0, at=0;
  tb.innerHTML = Object.entries(per).map(([c,v])=>{
    st+=v.stock; at+=v.ad;
    return `<tr><td>${c}</td><td>${fmt(v.stock)}</td><td>${fmt(v.ad)}</td></tr>`;
  }).join('');
  Q('#pdStockTotal').textContent = fmt(st);
  Q('#pdAdTotal').textContent    = fmt(at);
}

/* product: manual budget table */
function renderPBTable(){
  const tb = Q('#pdPBBBody'); if (!tb) return;
  const map = state.product.budgets || {};
  tb.innerHTML = state.countries.map(c =>
    `<tr><td>${c}</td><td>${fmt(map[c]||0)}</td>
      <td><button class="btn outline" data-clear-b="${c}">Clear</button></td></tr>`
  ).join('');
  tb.onclick = async e => {
    const c = e.target.dataset.clearB; if (!c) return;
    const p = { budgets: state.product.budgets || {} }; delete p.budgets[c];
    await api('/api/products/'+state.product.id, { method:'PUT', body: JSON.stringify(p) });
    await loadProduct(state.product.id); renderPBTable();
  };
}

/* product: transit (this product) */
async function renderProductTransit(){
  const s = await api('/api/shipments');
  const list = (s.shipments||[]).filter(x=>x.productId===state.product.id && !x.arrivedAt);
  const ck = list.filter(sp => (sp.fromCountry||'').toLowerCase()==='china' && (sp.toCountry||'').toLowerCase()==='kenya');
  const ic = list.filter(sp => !ck.includes(sp));

  const row = sp => `<tr>
    <td>${sp.id}</td><td>${(sp.fromCountry||sp.from)} → ${(sp.toCountry||sp.to)}</td>
    <td>${fmt(sp.qty)}</td><td>${fmt(sp.shipCost)}</td>
    <td>${sp.departedAt||''}</td><td>${sp.arrivedAt||''}</td>
    <td>
      <button class="btn outline" data-arr="${sp.id}">Mark Arrived</button>
      <button class="btn outline" data-edit="${sp.id}">Edit</button>
      <button class="btn outline" data-del="${sp.id}">Delete</button>
    </td></tr>`;

  Q('#pdShipCKBody') && (Q('#pdShipCKBody').innerHTML = ck.map(row).join('') || `<tr><td colspan="7" class="muted">No shipments</td></tr>`);
  Q('#pdShipICBody') && (Q('#pdShipICBody').innerHTML = ic.map(row).join('') || `<tr><td colspan="7" class="muted">No shipments</td></tr>`);

  // reuse handlers
  QA('[data-arr]').forEach(b => b.onclick = async () => {
    const id = b.dataset.arr;
    const date = prompt('Arrival date (YYYY-MM-DD)', todayISO()); if (!date) return;
    await api('/api/shipments/'+id, { method:'PUT', body: JSON.stringify({ arrivedAt: date }) });
    renderProductTransit(); renderProductStockAd();
  });
  QA('[data-edit]').forEach(b => b.onclick = async () => {
    const id = b.dataset.edit;
    const qty = +prompt('New qty?', '0') || 0;
    const shipCost = +prompt('New shipping cost?', '0') || 0;
    await api('/api/shipments/'+id, { method:'PUT', body: JSON.stringify({ qty, shipCost }) });
    renderProductTransit();
  });
  QA('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete shipment?')) return;
    await api('/api/shipments/'+b.dataset.del, { method:'DELETE' });
    renderProductTransit();
  });
}

/* product: influencers */
async function renderInfluencers(){
  const infs = await api('/api/influencers');
  const spends = await api('/api/influencers/spend');
  const sel = Q('#pdInfSelect'); if (sel) sel.innerHTML = (infs.influencers||[]).map(i=>`<option value="${i.id}">${i.name}</option>`).join('');

  const s = Q('#pdInfStart')?.value, e = Q('#pdInfEnd')?.value, c = Q('#pdInfFilterCountry')?.value || '';
  const list = (spends.spends||[]).filter(x=>x.productId===state.product.id)
    .filter(x => (!c || x.country===c))
    .filter(x => (!s || x.date >= s) && (!e || x.date <= e));

  const byId = Object.fromEntries((infs.influencers||[]).map(i=>[i.id,i]));
  const tb = Q('#pdInfBody'); if (!tb) return;
  let total = 0;
  tb.innerHTML = list.map(x=>{
    total += (+x.amount||0);
    const i = byId[x.influencerId] || {};
    return `<tr><td>${x.date}</td><td>${x.country}</td><td>${i.name||'-'}</td><td>${i.social||'-'}</td><td>${fmt(x.amount)}</td>
      <td><button class="btn outline" data-del-infsp="${x.id}">Delete</button></td></tr>`;
  }).join('') || `<tr><td colspan="6" class="muted">No spends</td></tr>`;
  Q('#pdInfTotal').textContent = fmt(total);

  tb.onclick = async e => {
    if (e.target.dataset.delInfsp) {
      await api('/api/influencers/spend/' + e.target.dataset.delInfsp, { method:'DELETE' });
      renderInfluencers();
    }
  };
}

/* ==============================================================
   NAV
   ============================================================== */
function initNav(){
  QA('.nav a[data-view]')?.forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    const v = a.dataset.view;
    ['home','products','performance','finance','settings'].forEach(id => {
      const el = Q('#'+id); if (el) el.style.display = (id===v)?'':'none';
    });
    QA('.nav a').forEach(x => x.classList.toggle('active', x === a));
    if (v === 'home') { renderKpis(); renderStockAndSpendByCountry(); renderTransitTables(); }
  }));
}

/* ============================================================== */
gate();
