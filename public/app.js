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
  countries: [], // China will be removed from this list
  products: [],
  productsActive: [],
  categories: { debit:[], credit:[] }
};

/* ================================================================
   AUTH + BOOT
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
    renderStockMovementPage();
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
  // Remove China from countries list for display purposes
  state.countries = (meta.countries || []).filter(country => country !== 'china');

  const pr = await api('/api/products');               // {products}
  state.products = pr.products || [];
  state.productsActive = state.products.filter(p => p.status !== 'paused');

  const cats = await api('/api/finance/categories');   // {debit:[],credit:[]}
  state.categories = cats || { debit:[], credit:[] };

  fillCommonSelects();
}

function fillCommonSelects() {
  // Countries for all selects (without China)
  const countrySelects = ['#mvFrom', '#mvTo', '#adCountry', '#rCountry', 
    '#pdAdCountry', '#pdRCountry', '#pdMvFrom', '#pdMvTo', '#pdInfCountry', 
    '#pdInfFilterCountry', '#pdPBCountry', '#pcCountry', '#remCountry', '#remAddCountry'];
  
  countrySelects.forEach(sel => QA(sel).forEach(el => {
    if (sel === '#pcCountry' || sel === '#remCountry') {
      el.innerHTML = `<option value="">All countries</option>` +
        state.countries.map(c=>`<option value="${c}">${c}</option>`).join('');
    } else if (sel === '#mvFrom' || sel === '#pdMvFrom') {
      // For movement "from" fields, include china for stock movement
      el.innerHTML = `<option value="china">china</option>` +
        state.countries.map(c=>`<option value="${c}">${c}</option>`).join('');
    } else {
      el.innerHTML = state.countries.map(c=>`<option value="${c}">${c}</option>`).join('');
    }
  }));

  // Products (only available/active in add forms)
  const productInputs = ['#mvProduct','#adProduct','#rProduct','#remAddProduct','#pdProductForSpend'];
  productInputs.forEach(sel => QA(sel).forEach(el => {
    el.innerHTML = state.productsActive.map(p=>`<option value="${p.id}">${p.name}${p.sku?` (${p.sku})`:''}</option>`).join('');
  }));

  // Products (filters can include "All")
  const productFilters = ['#remProduct'];
  productFilters.forEach(sel => QA(sel).forEach(el => {
    el.innerHTML = `<option value="">All products</option>` +
      state.products.map(p=>`<option value="${p.id}">${p.name}${p.sku?` (${p.sku})`:''}</option>`).join('');
  }));

  // Finance categories select for entries
  const allCats = [...state.categories.debit, ...state.categories.credit].sort();
  QA('#feCat').forEach(el => {
    el.innerHTML = `<option value="" disabled selected>Select category</option>` +
      allCats.map(c=>`<option>${c}</option>`).join('');
  });
  
  // Finance category search
  QA('#fcSearchCat').forEach(el => {
    el.innerHTML = `<option value="">All categories</option>` +
      allCats.map(c=>`<option>${c}</option>`).join('');
  });
}

/* ================================================================
   DASHBOARD
   ================================================================ */
function renderDashboardPage() {
  renderCompactKpis();
  renderCountryStockSpend();
  bindDailyAdSpend();
  renderWeeklyDelivered();
  initTodos();
}

/* ---------- COMPACT KPIs ---------- */
async function renderCompactKpis() {
  Q('#kpiProducts') && (Q('#kpiProducts').textContent = state.products.length);
  Q('#kpiCountries') && (Q('#kpiCountries').textContent = state.countries.length);
  
  try {
    const s = await api('/api/shipments');
    const live = (s.shipments || []).filter(x => !x.arrivedAt).length;
    Q('#kpiTransit') && (Q('#kpiTransit').textContent = live);
  } catch { Q('#kpiTransit') && (Q('#kpiTransit').textContent = '—'); }

  try {
    const a = await api('/api/adspend');
    const total = (a.adSpends||[]).reduce((t,x)=>t+(+x.amount||0),0);
    Q('#kpiAdSpend') && (Q('#kpiAdSpend').textContent = `${fmt(total)} USD`);
  } catch { Q('#kpiAdSpend') && (Q('#kpiAdSpend').textContent = '—'); }

  const t = Q('#wAllT')?.textContent || '0';
  Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = t);
}

/* ---------- Stock & Ad Spend by Country (global) ---------- */
async function renderCountryStockSpend() {
  const body = Q('#stockByCountryBody'); if (!body) return;
  body.innerHTML = '<tr><td colspan="6">Loading…</td></tr>';

  const per = {}; 
  state.countries.forEach(c=> {
    per[c] = { 
      stock: 0, 
      facebook: 0, 
      tiktok: 0, 
      google: 0, 
      totalAd: 0 
    };
  });

  // Arrived shipments add to dest, deduct from origin
  try {
    const s = await api('/api/shipments');
    (s.shipments||[]).filter(x=>x.arrivedAt).forEach(sp=>{
      const to = sp.toCountry || sp.to, from = sp.fromCountry || sp.from, qty = (+sp.qty||0);
      if (to && state.countries.includes(to)) {
        per[to] = per[to] || {stock:0, facebook:0, tiktok:0, google:0, totalAd:0}; 
        per[to].stock += qty;
      }
      if (from && state.countries.includes(from)) {
        per[from] = per[from]||{stock:0, facebook:0, tiktok:0, google:0, totalAd:0}; 
        per[from].stock -= qty;
      }
    });
  } catch {}

  // Remittances pieces deduct from that country
  try {
    const r = await api('/api/remittances');
    (r.remittances||[]).forEach(x=>{
      if (state.countries.includes(x.country)) {
        per[x.country] = per[x.country]||{stock:0, facebook:0, tiktok:0, google:0, totalAd:0};
        per[x.country].stock -= (+x.pieces||0);
      }
    });
  } catch {}

  // Ad spend from /api/adspend (already "replace current")
  try {
    const a = await api('/api/adspend');
    (a.adSpends||[]).forEach(x=>{
      if (state.countries.includes(x.country)) {
        per[x.country] = per[x.country]||{stock:0, facebook:0, tiktok:0, google:0, totalAd:0};
        const amount = +x.amount||0;
        if (x.platform === 'facebook') per[x.country].facebook += amount;
        else if (x.platform === 'tiktok') per[x.country].tiktok += amount;
        else if (x.platform === 'google') per[x.country].google += amount;
        per[x.country].totalAd += amount;
      }
    });
  } catch {}

  let st=0, fb=0, tt=0, gg=0, totalAd=0;
  const rows = Object.entries(per).map(([c,v])=>{
    st += v.stock; 
    fb += v.facebook; 
    tt += v.tiktok; 
    gg += v.google; 
    totalAd += v.totalAd;
    
    return `<tr>
      <td>${c}</td>
      <td>${fmt(v.stock)}</td>
      <td>${fmt(v.facebook)}</td>
      <td>${fmt(v.tiktok)}</td>
      <td>${fmt(v.google)}</td>
      <td>${fmt(v.totalAd)}</td>
    </tr>`;
  }).join('');
  
  body.innerHTML = rows || `<tr><td colspan="6" class="muted">No data</td></tr>`;
  Q('#stockTotal') && (Q('#stockTotal').textContent = fmt(st));
  Q('#fbTotal') && (Q('#fbTotal').textContent = fmt(fb));
  Q('#ttTotal') && (Q('#ttTotal').textContent = fmt(tt));
  Q('#ggTotal') && (Q('#ggTotal').textContent = fmt(gg));
  Q('#adTotal') && (Q('#adTotal').textContent = fmt(totalAd));
}

/* ---------- Daily Ad Spend (no date, replace current) ---------- */
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
      await renderCompactKpis();
      alert('Ad spend saved');
    } catch(e){ alert(e.message); }
  };
}

/* ---------- Weekly Delivered grid (restore) ---------- */
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

    body.innerHTML = state.countries.map(c=>{
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
    for (let i=0;i<cols;i++) {
      let colSum = 0;
      QA('tr[data-row]').forEach(tr=>{
        const inp = QA('.wd-cell', tr)[i];
        colSum += (+inp.value||0);
      });
      Q(`#w${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i]}T`).textContent = fmt(colSum);
      grand += colSum;
    }
    Q('#wAllT').textContent = fmt(grand);
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

/* ---------- To-do + Weekly To-do ---------- */
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
    if (e.target.dataset.done) {
      const arr = load(KEY);
      const it = arr.find(x=>x.id===e.target.dataset.done); 
      it.done=!it.done; save(KEY,arr); renderQuick();
    }
    if (e.target.dataset.del)  {
      const arr = load(KEY);
      const idx = arr.findIndex(x=>x.id===e.target.dataset.del); arr.splice(idx,1); save(KEY,arr); renderQuick();
    }
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
}

/* ================================================================
   PRODUCTS PAGE (list)
   ================================================================ */
function renderProductsPage() {
  // Render country product stats first
  renderCompactCountryStats();

  // Add Advertising Overview section
  renderAdvertisingOverview();

  // add product
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
    renderCompactCountryStats();
    renderAdvertisingOverview();
    alert('Product added');
  });
  renderProductsTable();
}

/* ---------- COMPACT COUNTRY STATS ---------- */
function renderCompactCountryStats() {
  const container = Q('#countryProductStats');
  if (!container) return;

  api('/api/adspend').then(adData => {
    const adSpends = adData.adSpends || [];
    const countryStats = {};
    
    state.countries.forEach(country => {
      countryStats[country] = { active: 0, paused: 0, total: 0 };
    });

    state.products.forEach(product => {
      state.countries.forEach(country => {
        countryStats[country].total++;
        if (product.status === 'active') {
          countryStats[country].active++;
        } else {
          countryStats[country].paused++;
        }
      });
    });

    let html = '';
    Object.keys(countryStats).sort().forEach(country => {
      const stats = countryStats[country];
      html += `
        <div class="country-stat-card-compact">
          <div class="country-name-compact">${country}</div>
          <div class="stats-row-compact">
            <div class="stat-item-compact active">
              <div class="stat-label-compact">Active</div>
              <div class="stat-value-compact">${stats.active}</div>
            </div>
            <div class="stat-item-compact paused">
              <div class="stat-label-compact">Paused</div>
              <div class="stat-value-compact">${stats.paused}</div>
            </div>
            <div class="stat-item-compact total">
              <div class="stat-label-compact">Total</div>
              <div class="stat-value-compact">${stats.total}</div>
            </div>
          </div>
        </div>
      `;
    });
    
    container.innerHTML = html;
  }).catch(console.error);
}

function renderAdvertisingOverview() {
  const container = Q('#advertisingOverview');
  if (!container) return;

  // Get ad spend data
  api('/api/adspend').then(adData => {
    const adSpends = adData.adSpends || [];
    
    // Group by country and product
    const byCountry = {};
    
    adSpends.forEach(spend => {
      const country = spend.country;
      const productId = spend.productId;
      const platform = spend.platform;
      const amount = +spend.amount || 0;
      
      if (!byCountry[country]) {
        byCountry[country] = {};
      }
      
      if (!byCountry[country][productId]) {
        byCountry[country][productId] = {
          facebook: 0,
          tiktok: 0,
          google: 0,
          total: 0
        };
      }
      
      if (platform === 'facebook') byCountry[country][productId].facebook += amount;
      else if (platform === 'tiktok') byCountry[country][productId].tiktok += amount;
      else if (platform === 'google') byCountry[country][productId].google += amount;
      
      byCountry[country][productId].total += amount;
    });
    
    // Create HTML
    let html = '';
    
    Object.keys(byCountry).sort().forEach(country => {
      const products = byCountry[country];
      
      // Sort products by total spend (descending)
      const sortedProducts = Object.entries(products)
        .filter(([_, data]) => data.total > 0) // Only show products with spend
        .sort((a, b) => b[1].total - a[1].total);
      
      if (sortedProducts.length === 0) return;
      
      html += `<div class="card country-section">
        <div class="h" style="color: var(--primary); margin-bottom: 12px;">${country}</div>`;
      
      sortedProducts.forEach(([productId, data]) => {
        const product = state.products.find(p => p.id === productId) || { name: productId };
        html += `
        <div class="product-row">
          <div class="product-name">${product.name}</div>
          <div class="platform-spends">
            <span class="platform-badge ${data.facebook > 0 ? 'active' : ''}">Facebook: ${fmt(data.facebook)}</span>
            <span class="platform-badge ${data.tiktok > 0 ? 'active' : ''}">TikTok: ${fmt(data.tiktok)}</span>
            <span class="platform-badge ${data.google > 0 ? 'active' : ''}">Google: ${fmt(data.google)}</span>
            <span class="total-badge">Total: ${fmt(data.total)}</span>
          </div>
        </div>`;
      });
      
      html += `</div>`;
    });
    
    container.innerHTML = html || '<div class="card"><div class="muted">No advertising data yet</div></div>';
  }).catch(console.error);
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
      await preload(); renderProductsTable(); renderCompactCountryStats(); renderAdvertisingOverview();
    }
    if (e.target.classList.contains('act-del')) {
      if (!confirm('Delete product and ALL its data?')) return;
      await api(`/api/products/${id}`,{method:'DELETE'}); // server will cascade
      await preload(); renderProductsTable(); renderCompactCountryStats(); renderAdvertisingOverview(); renderCountryStockSpend(); renderCompactKpis();
    }
  };
}

/* ================================================================
   PERFORMANCE PAGE - UPDATED
   ================================================================ */
function renderPerformancePage() {
  // Add Remittance Entry
  bindRemittanceAdd();
  
  // Remittance Report
  renderRemittanceReport();

  // Profit by Country
  Q('#pcRun')?.addEventListener('click', async ()=>{
    const s = Q('#pcStart')?.value, e = Q('#pcEnd')?.value, c = Q('#pcCountry')?.value || '';
    let list = (await api('/api/remittances')).remittances || [];
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

    const tb = Q('#profitCountryBody'); let R=0,A=0,E=0,P=0;
    const rows = Object.entries(byC).map(([cc,v])=>{
      const profit = v.rev - v.ad - v.extra;
      R+=v.rev; A+=v.ad; E+=v.extra; P+=profit;
      return `<tr><td>${cc}</td><td>${fmt(v.rev)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.extra)}</td><td>${fmt(v.pcs)}</td><td>${fmt(profit)}</td></tr>`;
    }).join('');
    tb.innerHTML = rows || `<tr><td colspan="6" class="muted">No data</td></tr>`;
    Q('#pcRevT').textContent = fmt(R);
    Q('#pcAdT').textContent = fmt(A);
    Q('#pcDelT').textContent = fmt(E);
    Q('#pcPiecesT').textContent = fmt(Object.values(byC).reduce((t,v)=>t+v.pcs,0));
    Q('#pcProfitT').textContent = fmt(P);
  });

  // Global Lifetime Product Performance
  Q('#lpRun')?.addEventListener('click', async ()=>{
    const pid = Q('#lpProduct')?.value || '';
    const s   = Q('#lpStart')?.value;
    const e   = Q('#lpEnd')?.value;

    let rem = (await api('/api/remittances')).remittances || [];
    const infSpends = (await api('/api/influencers/spend')).spends || [];
    
    if (pid) {
      rem = rem.filter(r=>r.productId===pid);
      // Filter influencer spends by product and date range
      const filteredInfSpends = infSpends.filter(inf => 
        inf.productId === pid && 
        (!s || inf.date >= s) && 
        (!e || inf.date <= e)
      );
      
      // Add influencer spends to ad spend
      filteredInfSpends.forEach(inf => {
        const matchingRem = rem.find(r => r.country === inf.country && r.start >= s && r.end <= e);
        if (matchingRem) {
          matchingRem.adSpend = (+matchingRem.adSpend || 0) + (+inf.amount || 0);
        }
      });
    }
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
   ADD REMITTANCE ENTRY
   ================================================================ */
function bindRemittanceAdd() {
  const btn = Q('#remAddSave');
  if (!btn) return;
  
  btn.onclick = async () => {
    const payload = {
      start: Q('#remAddStart')?.value,
      end: Q('#remAddEnd')?.value,
      country: Q('#remAddCountry')?.value,
      productId: Q('#remAddProduct')?.value,
      orders: +Q('#remAddOrders')?.value || 0,
      pieces: +Q('#remAddPieces')?.value || 0,
      revenue: +Q('#remAddRevenue')?.value || 0,
      adSpend: +Q('#remAddAdSpend')?.value || 0,
      extraPerPiece: +Q('#remAddExtra')?.value || 0
    };
    
    if (!payload.start || !payload.end || !payload.country || !payload.productId) {
      return alert('Please fill all required fields: Start Date, End Date, Country, and Product');
    }
    
    try {
      await api('/api/remittances', { method: 'POST', body: JSON.stringify(payload) });
      alert('Remittance entry added successfully!');
      // Clear form
      Q('#remAddStart').value = '';
      Q('#remAddEnd').value = '';
      Q('#remAddCountry').value = '';
      Q('#remAddProduct').value = '';
      Q('#remAddOrders').value = '';
      Q('#remAddPieces').value = '';
      Q('#remAddRevenue').value = '';
      Q('#remAddAdSpend').value = '';
      Q('#remAddExtra').value = '';
      
      // Refresh the remittance report
      renderRemittanceReport();
    } catch (e) {
      alert('Error adding remittance: ' + e.message);
    }
  };
}

/* ================================================================
   REMITTANCE REPORT - UPDATED (sort by pieces descending)
   ================================================================ */
function renderRemittanceReport() {
  const btn = Q('#remRun');
  if (!btn) return;
  
  btn.onclick = async () => {
    const start = Q('#remStart')?.value;
    const end = Q('#remEnd')?.value;
    const country = Q('#remCountry')?.value || '';
    const productId = Q('#remProduct')?.value || '';
    
    let rem = (await api('/api/remittances')).remittances || [];
    
    if (start) rem = rem.filter(r => r.start >= start);
    if (end) rem = rem.filter(r => r.end <= end);
    if (country) rem = rem.filter(r => r.country === country);
    if (productId) rem = rem.filter(r => r.productId === productId);
    
    // Sort by pieces descending (highest first)
    rem.sort((a, b) => (b.pieces || 0) - (a.pieces || 0));
    
    const prodMap = Object.fromEntries(state.products.map(p => [p.id, p]));
    let totalOrders = 0, totalPieces = 0, totalRevenue = 0, totalAdSpend = 0, totalProfit = 0;
    
    const tb = Q('#remittanceBody');
    tb.innerHTML = rem.map(r => {
      const product = prodMap[r.productId] || {};
      const baseCost = (+product.cost_china || 0) + (+product.ship_china_to_kenya || 0);
      const profit = (+r.revenue || 0) - (+r.adSpend || 0) - ((+r.extraPerPiece || 0) * (+r.pieces || 0)) - (baseCost * (+r.pieces || 0));
      
      totalOrders += (+r.orders || 0);
      totalPieces += (+r.pieces || 0);
      totalRevenue += (+r.revenue || 0);
      totalAdSpend += (+r.adSpend || 0);
      totalProfit += profit;
      
      return `<tr>
        <td>${r.start} - ${r.end}</td>
        <td>${product.name || r.productId}</td>
        <td>${r.country}</td>
        <td>${fmt(r.orders)}</td>
        <td>${fmt(r.pieces)}</td>
        <td>${fmt(r.revenue)}</td>
        <td>${fmt(r.adSpend)}</td>
        <td class="${profit >= 0 ? 'number-positive' : 'number-negative'}">${fmt(profit)}</td>
        <td><button class="btn outline rem-del" data-id="${r.id}">Delete</button></td>
      </tr>`;
    }).join('') || `<tr><td colspan="9" class="muted">No remittance data</td></tr>`;
    
    Q('#remOrdersT').textContent = fmt(totalOrders);
    Q('#remPiecesT').textContent = fmt(totalPieces);
    Q('#remRevenueT').textContent = fmt(totalRevenue);
    Q('#remAdSpendT').textContent = fmt(totalAdSpend);
    Q('#remProfitT').textContent = fmt(totalProfit);
    
    // Add delete functionality
    tb.addEventListener('click', async (e) => {
      if (e.target.classList.contains('rem-del')) {
        if (!confirm('Delete this remittance entry?')) return;
        try {
          await api(`/api/remittances/${e.target.dataset.id}`, { method: 'DELETE' });
          renderRemittanceReport(); // Refresh the report
        } catch (err) {
          alert('Error deleting remittance: ' + err.message);
        }
      }
    });
  };
}

/* ================================================================
   STOCK MOVEMENT PAGE - Keep China for transit
   ================================================================ */
function renderStockMovementPage() {
  // Stock Movement (create shipment) - China is available here
  const btn = Q('#mvAdd'); if (!btn) return;
  btn.onclick = async ()=>{
    const payload = {
      productId: Q('#mvProduct')?.value,
      fromCountry: Q('#mvFrom')?.value,
      toCountry: Q('#mvTo')?.value,
      qty: +Q('#mvQty')?.value || 0,
      shipCost: +Q('#mvShip')?.value || 0,
      note: Q('#mvNote')?.value || '',
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

  // Transit tables (CK + IC)
  renderTransitTables();
}

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
      <td>${sp.note||''}</td>
      <td>
        <button class="btn outline act-arr" data-id="${sp.id}">Arrived</button>
        <button class="btn outline act-edit" data-id="${sp.id}">Edit</button>
        <button class="btn outline act-del" data-id="${sp.id}">Delete</button>
      </td>
    </tr>`;
  };

  const ck = live.filter(sp => (sp.fromCountry||sp.from||'').toLowerCase()==='china' && (sp.toCountry||sp.to||'').toLowerCase()==='kenya');
  const ic = live.filter(sp => !ck.includes(sp));

  if (tbl1) tbl1.innerHTML = ck.map(row).join('') || `<tr><td colspan="10" class="muted">No transit</td></tr>`;
  if (tbl2) tbl2.innerHTML = ic.map(row).join('') || `<tr><td colspan="10" class="muted">No transit</td></tr>`;

  const host = Q('#stockMovement') || document;
  host.addEventListener('click', async (e)=>{
    const id = e.target.dataset?.id;
    if (!id) return;

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
      const note = prompt('Note?', '') || '';
      try { await api(`/api/shipments/${id}`,{method:'PUT', body: JSON.stringify({ qty, shipCost, note })}); }
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

  // entries add with date range
  Q('#feAdd')?.addEventListener('click', async ()=>{
    const startDate = Q('#feStartDate')?.value, 
          endDate = Q('#feEndDate')?.value, 
          cat = Q('#feCat')?.value, 
          amt = +Q('#feAmt')?.value||0, 
          note = Q('#feNote')?.value||'';
    
    if (!startDate||!endDate||!cat) return alert('Pick date range & category');
    if (new Date(startDate) > new Date(endDate)) return alert('Start date must be before end date');
    
    const type = state.categories.credit.includes(cat) ? 'credit':'debit';
    await api('/api/finance/entries',{method:'POST', body: JSON.stringify({startDate, endDate, type, category:cat, amount:amt, note})});
    Q('#feAmt').value=''; Q('#feNote').value='';
    await runFinancePeriod();
  });

  // Category search
  Q('#fcSearchRun')?.addEventListener('click', runFinanceCategorySearch);

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
  
  // refresh category search select
  Q('#fcSearchCat') && (Q('#fcSearchCat').innerHTML = `<option value="">All categories</option>` + all.map(c=>`<option>${c}</option>`).join(''));
}

async function runFinancePeriod() {
  const s = Q('#fes')?.value, e = Q('#fee')?.value;
  const r = await api('/api/finance/entries' + ((s||e)?`?start=${s||''}&end=${e||''}`:''));
  Q('#runBalance') && (Q('#runBalance').textContent = fmt(r.running||0)+' USD');
  Q('#feBalance') && (Q('#feBalance').textContent = 'Period Balance: ' + fmt(r.balance||0) + ' USD');
  const tb = Q('#feTable tbody');
  tb && (tb.innerHTML = (r.entries||[]).map(x=>`
    <tr>
      <td>${x.date}</td>
      <td>${x.type}</td>
      <td>${x.category}</td>
      <td>${fmt(x.amount)}</td>
      <td>${x.note||''}</td>
      <td>${x.periodStart && x.periodEnd ? `${x.periodStart} - ${x.periodEnd}` : 'Single day'}</td>
      <td><button class="btn outline fe-del" data-id="${x.id}">Delete</button></td>
    </tr>
  `).join('') || `<tr><td colspan="7" class="muted">No entries</td></tr>`);
  tb?.addEventListener('click', async (e)=>{
    if (e.target.classList.contains('fe-del')) {
      await api(`/api/finance/entries/${e.target.dataset.id}`,{method:'DELETE'});
      await runFinancePeriod();
    }
  }, { once:true });
}

async function runFinanceCategorySearch() {
  const s = Q('#fcSearchStart')?.value, 
        e = Q('#fcSearchEnd')?.value, 
        cat = Q('#fcSearchCat')?.value,
        type = Q('#fcSearchType')?.value;
  
  if (!s || !e) return alert('Select date range');
  
  const r = await api(`/api/finance/entries?start=${s}&end=${e}` + (cat ? `&category=${cat}` : '') + (type ? `&type=${type}` : ''));
  
  Q('#fcSearchResult').textContent = `Total: ${fmt(r.categoryTotal || 0)} USD`;
  Q('#fcSearchCount').textContent = `Entries: ${r.entries?.length || 0}`;
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

  // manual save/restore (never auto-delete on push)
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

  // Stock & Ad Spend by Country (this product only)
  await renderProductStockAd(product);
  // Profit + Budget per country (manual budgets)
  renderProductBudgets(product);
  // Transit tables
  await renderProductTransit(product);
  // Arrived shipments section
  await renderProductArrivedShipments(product);
  // Lifetime (this product) with filter
  bindProductLifetime(product);
  // Remittances for this product
  await renderProductRemittances(product);
  // Influencers
  await bindInfluencers(product);
}

async function renderProductStockAd(product) {
  const tb = Q('#pdStockBody'); if (!tb) return;
  const per = {}; 
  state.countries.forEach(c=> {
    per[c] = { 
      stock: 0, 
      facebook: 0, 
      tiktok: 0, 
      google: 0, 
      totalAd: 0 
    };
  });

  const s = await api('/api/shipments');
  (s.shipments||[]).filter(x=>x.productId===product.id && x.arrivedAt).forEach(sp=>{
    const to = sp.toCountry||sp.to, from = sp.fromCountry||sp.from, q=(+sp.qty||0);
    if (to && state.countries.includes(to)) {
      per[to]=per[to]||{stock:0, facebook:0, tiktok:0, google:0, totalAd:0}; per[to].stock += q;
    }
    if (from && state.countries.includes(from)) {
      per[from]=per[from]||{stock:0, facebook:0, tiktok:0, google:0, totalAd:0}; per[from].stock -= q;
    }
  });

  const r = await api('/api/remittances');
  (r.remittances||[]).filter(x=>x.productId===product.id).forEach(rr=>{
    if (state.countries.includes(rr.country)) {
      per[rr.country]=per[rr.country]||{stock:0, facebook:0, tiktok:0, google:0, totalAd:0};
      per[rr.country].stock -= (+rr.pieces||0);
    }
  });

  const a = await api('/api/adspend');
  (a.adSpends||[]).filter(x=>x.productId===product.id).forEach(sp=>{
    if (state.countries.includes(sp.country)) {
      per[sp.country]=per[sp.country]||{stock:0, facebook:0, tiktok:0, google:0, totalAd:0};
      const amount = +sp.amount||0;
      if (sp.platform === 'facebook') per[sp.country].facebook += amount;
      else if (sp.platform === 'tiktok') per[sp.country].tiktok += amount;
      else if (sp.platform === 'google') per[sp.country].google += amount;
      per[sp.country].totalAd += amount;
    }
  });

  let st=0, fb=0, tt=0, gg=0, totalAd=0;
  tb.innerHTML = Object.entries(per).map(([c,v])=>{
    st+=v.stock; fb+=v.facebook; tt+=v.tiktok; gg+=v.google; totalAd+=v.totalAd;
    
    return `<tr>
      <td>${c}</td>
      <td>${fmt(v.stock)}</td>
      <td>${fmt(v.facebook)}</td>
      <td>${fmt(v.tiktok)}</td>
      <td>${fmt(v.google)}</td>
      <td>${fmt(v.totalAd)}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="6" class="muted">No data</td></tr>`;
  
  Q('#pdStockTotal').textContent = fmt(st);
  Q('#pdFbTotal').textContent = fmt(fb);
  Q('#pdTtTotal').textContent = fmt(tt);
  Q('#pdGgTotal').textContent = fmt(gg);
  Q('#pdAdTotal').textContent = fmt(totalAd);
}

function renderProductBudgets(product) {
  const sel = Q('#pdPBCountry'), inp = Q('#pdPBValue'), btn = Q('#pdPBSave'), tb=Q('#pdPBBBody');
  const map = product.budgets||{};
  tb.innerHTML = state.countries.map(c=>`
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

async function renderProductTransit(product) {
  const s = await api('/api/shipments');
  const list = (s.shipments||[]).filter(x=>x.productId===product.id && !x.arrivedAt);
  const ck = list.filter(sp => (sp.fromCountry||sp.from||'').toLowerCase()==='china' && (sp.toCountry||sp.to||'').toLowerCase()==='kenya');
  const ic = list.filter(sp => !ck.includes(sp));
  const row = sp => `<tr>
    <td>${sp.id}</td><td>${sp.fromCountry||sp.from} → ${sp.toCountry||sp.to}</td>
    <td>${fmt(sp.qty)}</td><td>${fmt(sp.shipCost)}</td>
    <td>${sp.departedAt||''}</td><td>${sp.arrivedAt||''}</td>
    <td>${sp.note||''}</td>
    <td>
      <button class="btn outline p-act-arr" data-id="${sp.id}">Arrived</button>
      <button class="btn outline p-act-edit" data-id="${sp.id}">Edit</button>
      <button class="btn outline p-act-del" data-id="${sp.id}">Delete</button>
    </td></tr>`;
  Q('#pdShipCKBody').innerHTML = ck.map(row).join('') || `<tr><td colspan="8" class="muted">No shipments</td></tr>`;
  Q('#pdShipICBody').innerHTML = ic.map(row).join('') || `<tr><td colspan="8" class="muted">No shipments</td></tr>`;

  const host = Q('#product');
  host.addEventListener('click', async (e)=>{
    const id = e.target.dataset?.id; if (!id) return;
    if (e.target.classList.contains('p-act-arr')) {
      const date = prompt('Arrival date (YYYY-MM-DD)', isoToday()); if (!date) return;
      await api(`/api/shipments/${id}`,{method:'PUT', body: JSON.stringify({arrivedAt:date})});
      await renderProductTransit(product); 
      await renderProductArrivedShipments(product);
      await renderProductStockAd(product);
    }
    if (e.target.classList.contains('p-act-edit')) {
      const qty = +prompt('New qty?', '0')||0;
      const shipCost = +prompt('New shipping cost?', '0')||0;
      const note = prompt('Note?', '') || '';
      await api(`/api/shipments/${id}`,{method:'PUT', body: JSON.stringify({qty,shipCost,note})});
      await renderProductTransit(product);
    }
    if (e.target.classList.contains('p-act-del')) {
      if (!confirm('Delete shipment?')) return;
      await api(`/api/shipments/${id}`,{method:'DELETE'});
      await renderProductTransit(product);
    }
  }, { once:true });
}

async function renderProductArrivedShipments(product) {
  const s = await api('/api/shipments');
  const arrived = (s.shipments||[]).filter(x=>x.productId===product.id && x.arrivedAt);
  
  const row = sp => {
    const days = sp.arrivedAt ? Math.round((+new Date(sp.arrivedAt)-(+new Date(sp.departedAt)))/86400000) : '';
    return `<tr>
      <td>${sp.id}</td>
      <td>${sp.fromCountry||sp.from} → ${sp.toCountry||sp.to}</td>
      <td>${fmt(sp.qty)}</td>
      <td>${fmt(sp.shipCost)}</td>
      <td>${sp.departedAt||''}</td>
      <td>${sp.arrivedAt||''}</td>
      <td>${days}</td>
      <td>${sp.note||''}</td>
      <td>
        <button class="btn outline p-arr-edit" data-id="${sp.id}">Edit</button>
        <button class="btn outline p-arr-del" data-id="${sp.id}">Delete</button>
      </td>
    </tr>`;
  };

  Q('#pdArrivedBody').innerHTML = arrived.map(row).join('') || `<tr><td colspan="9" class="muted">No arrived shipments</td></tr>`;

  const host = Q('#product');
  host.addEventListener('click', async (e)=>{
    const id = e.target.dataset?.id; if (!id) return;
    
    if (e.target.classList.contains('p-arr-edit')) {
      const qty = +prompt('New qty?', '0')||0;
      const shipCost = +prompt('New shipping cost?', '0')||0;
      const note = prompt('Note?', '') || '';
      await api(`/api/shipments/${id}`,{method:'PUT', body: JSON.stringify({qty,shipCost,note})});
      await renderProductArrivedShipments(product);
    }
    if (e.target.classList.contains('p-arr-del')) {
      if (!confirm('Delete shipment?')) return;
      await api(`/api/shipments/${id}`,{method:'DELETE'});
      await renderProductArrivedShipments(product);
      await renderProductStockAd(product);
    }
  }, { once:true });
}

async function renderProductRemittances(product) {
  try {
    const remittances = await api('/api/remittances?productId=' + product.id);
    const tb = Q('#pdRemittancesBody');
    if (!tb) return;
    
    tb.innerHTML = (remittances.remittances||[]).map(r => `
      <tr>
        <td>${r.start} - ${r.end}</td>
        <td>${r.country}</td>
        <td>${fmt(r.orders)}</td>
        <td>${fmt(r.pieces)}</td>
        <td>${fmt(r.revenue)}</td>
        <td>${fmt(r.adSpend)}</td>
        <td>${fmt(r.extraPerPiece)}</td>
        <td>
          <button class="btn outline pd-rem-del" data-id="${r.id}">Delete</button>
        </td>
      </tr>
    `).join('') || `<tr><td colspan="8" class="muted">No remittances for this product</td></tr>`;

    // Add delete functionality
    tb.addEventListener('click', async (e)=>{
      if (e.target.classList.contains('pd-rem-del')) {
        if (!confirm('Delete this remittance entry?')) return;
        await api(`/api/remittances/${e.target.dataset.id}`,{method:'DELETE'});
        await renderProductRemittances(product);
        bindProductLifetime(product); // Refresh lifetime data
      }
    });
  } catch (e) {
    console.error('Failed to load product remittances:', e);
  }
}

function bindProductLifetime(product) {
  const run = async ()=>{
    const s = Q('#pdLPStart')?.value, e = Q('#pdLPEnd')?.value;
    let rem = (await api('/api/remittances')).remittances || [];
    const infSpends = (await api('/api/influencers/spend')).spends || [];
    
    rem = rem.filter(r=>r.productId===product.id);
    
    // Filter influencer spends by product and date range
    const filteredInfSpends = infSpends.filter(inf => 
      inf.productId === product.id && 
      (!s || inf.date >= s) && 
      (!e || inf.date <= e)
    );
    
    // Add influencer spends to ad spend
    filteredInfSpends.forEach(inf => {
      const matchingRem = rem.find(r => r.country === inf.country && r.start >= s && r.end <= e);
      if (matchingRem) {
        matchingRem.adSpend = (+matchingRem.adSpend || 0) + (+inf.amount || 0);
      }
    });
    
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
   FORCE FIXED NAVIGATION
   ================================================================ */
function forceFixedNavigation() {
  const nav = Q('.nav');
  if (!nav) return;
  
  // Force fixed positioning
  nav.style.position = 'fixed';
  nav.style.top = '0';
  nav.style.left = '0';
  nav.style.right = '0';
  nav.style.zIndex = '1000';
  nav.style.background = '#ffffff';
  
  // Ensure main content has proper margin
  const main = Q('#main');
  if (main) {
    main.style.marginTop = '60px';
  }
  
  // Handle scroll events to keep it fixed
  window.addEventListener('scroll', function() {
    const scrollY = window.scrollY;
    
    // Always keep nav at top
    nav.style.transform = `translateY(${scrollY}px)`;
    nav.style.transform = 'translateY(0)'; // Force to top
    
    // Alternative method: reset position on scroll
    if (nav.style.position !== 'fixed') {
      nav.style.position = 'fixed';
      nav.style.top = '0';
    }
  });
  
  // Also handle resize events
  window.addEventListener('resize', function() {
    nav.style.position = 'fixed';
    nav.style.top = '0';
    nav.style.left = '0';
    nav.style.right = '0';
  });
}

/* ================================================================
   NAV - Fixed navigation with JavaScript enforcement
   ================================================================ */
function bindGlobalNav() {
  // First force the fixed positioning
  forceFixedNavigation();
  
  // Then handle the view switching
  QA('.nav a[data-view]')?.forEach(a => a.addEventListener('click', e=>{
    e.preventDefault();
    const v = a.dataset.view;
    ['home','products','performance','stockMovement','finance','settings'].forEach(id=>{
      const el = Q('#'+id);
      if (el) el.style.display = (id===v)?'':'none';
    });
    QA('.nav a').forEach(x=>x.classList.toggle('active', x===a));
    if (v==='home') { renderCompactKpis(); renderCountryStockSpend(); }
    if (v==='products') { renderCompactCountryStats(); renderAdvertisingOverview(); }
    if (v==='stockMovement') { renderStockMovementPage(); }
    if (v==='performance') { renderRemittanceReport(); }
  }));
}

/* ================================================================
   BOOT
   ================================================================ */
boot();
