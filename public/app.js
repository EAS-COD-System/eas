/* ================================================================
   EAS Tracker – Front-end (index.html + product.html)
   China is hidden in *all* analytics/inputs except:
   - Stock Movement (create shipment)
   - Transit (China→Kenya and Inter-country)
   ================================================================ */

/* ---------- helpers ---------- */
const Q = (s, r = document) => r.querySelector(s);
const QA = (s, r = document) => Array.from(r.querySelectorAll(s));
const fmt = n => (Number(n || 0)).toLocaleString(undefined, { maximumFractionDigits: 2 });
const todayISO = () => new Date().toISOString().slice(0, 10);
const getQuery = k => new URLSearchParams(location.search).get(k);
const uniq = arr => [...new Set(arr)];

/* API */
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
  view: 'home',
  countriesAll: [],
  countriesNoChina: [],
  products: [],
  categories: { debit: [], credit: [] },
  productId: getQuery('id'),
  product: null
};

/* ---------- auth + boot ---------- */
async function gate() {
  try {
    const meta = await api('/api/meta'); // requires auth cookie
    state.countriesAll = meta.countries || [];
    state.countriesNoChina = state.countriesAll.filter(c => c.toLowerCase() !== 'china');

    Q('#login')?.classList.add('hide');
    Q('#main')?.removeAttribute('style');

    await preloadProducts();
    initNav();

    if (state.productId) {
      await loadProduct(state.productId);
      renderProductPage();
    } else {
      fillGlobalSelects();
      initDashboard();
      initProducts();
      initPerformance();
      initFinance();
      initSettings();
    }
  } catch {
    // show login
    Q('#login')?.classList.remove('hide');
    Q('#main')?.setAttribute('style', 'display:none');
  }
}

Q('#loginBtn')?.addEventListener('click', async () => {
  const pw = Q('#pw').value.trim();
  if (!pw) return;
  try {
    await api('/api/auth', { method: 'POST', body: JSON.stringify({ password: pw }) });
    await gate();
  } catch {
    alert('Wrong password');
  }
});

Q('#logoutLink')?.addEventListener('click', async e => {
  e.preventDefault();
  try { await api('/api/auth', { method: 'POST', body: JSON.stringify({ password: 'logout' }) }); } catch {}
  location.reload();
});

/* ---------- common data ---------- */
async function preloadProducts() {
  try {
    const r = await api('/api/products');
    state.products = (r.products || []).filter(p => p.status !== 'deleted');
  } catch { state.products = []; }
}

function fillSelect(el, arr, withAllOption = false) {
  if (!el) return;
  const options = []
  if (withAllOption) options.push(`<option value="">All countries</option>`);
  options.push(...arr.map(c => `<option value="${c}">${c}</option>`));
  el.innerHTML = options.join('');
}

function fillProducts(el) {
  if (!el) return;
  el.innerHTML = state.products.map(p => `<option value="${p.id}">${p.name}${p.sku?` (${p.sku})`:''}</option>`).join('');
}

/* Fill all global selects */
function fillGlobalSelects() {
  // Countries excluding China (analytics, weekly, ad spend, profit, product budgets, influencers, remittance)
  [
    '#adCountry', '#pcCountry', '#pfCountry', '#pdAdCountry', '#pdRCountry',
    '#pdPBCountry', '#pdInfCountry', '#pdInfFilterCountry'
  ].forEach(sel =>
    QA(sel).forEach(e => fillSelect(e, state.countriesNoChina, sel==='#pcCountry' || sel==='#pfCountry' || sel==='#pdInfFilterCountry'))
  );

  // Countries for weekly grid are built in initWeeklyDelivered()

  // Countries *including* China (stock movement + transit)
  ['#mvFrom', '#mvTo', '#pdMvFrom', '#pdMvTo'].forEach(sel =>
    QA(sel).forEach(e => fillSelect(e, state.countriesAll, false))
  );

  // Products (only existing)
  ['#adProduct', '#mvProduct', '#rProduct'].forEach(sel =>
    QA(sel).forEach(e => fillProducts(e))
  );
}

/* ========================================================================
   DASHBOARD (index.html)
   ======================================================================== */
function initDashboard() {
  renderKpis();
  renderStockAndSpendByCountry();
  initWeeklyDelivered();
  initDailyAdSpend();
  initMovements();
  renderTransitTables();
  initProfitByCountry();
  initTodos();
}

/* ---- KPIs ---- */
async function renderKpis() {
  Q('#kpiProducts') && (Q('#kpiProducts').textContent = state.products.length);
  Q('#kpiCountries') && (Q('#kpiCountries').textContent = state.countriesNoChina.length);

  // transit count (all countries allowed here)
  try {
    const s = await api('/api/shipments');
    const live = (s.shipments || []).filter(x => !x.arrivedAt).length;
    Q('#kpiTransit') && (Q('#kpiTransit').textContent = live);
  } catch { Q('#kpiTransit') && (Q('#kpiTransit').textContent = '—'); }

  // total ad spend (from /api/adspend) — ALL countries, but we will exclude China in stock table; KPI can be overall
  try {
    const a = await api('/api/adspend');
    const total = (a.adSpends || []).reduce((t, x) => t + (+x.amount || 0), 0);
    Q('#kpiAdSpend') && (Q('#kpiAdSpend').textContent = fmt(total) + ' USD');
  } catch { Q('#kpiAdSpend') && (Q('#kpiAdSpend').textContent = '—'); }

  // Mon–Sun delivered shown using weekly grid total when available—compute from /api/deliveries for current week
  try {
    const r = await api('/api/deliveries');
    const days = weekRangeFrom(todayISO());
    const inWeek = (r.deliveries || []).filter(d => days.includes(d.date));
    const total = inWeek.reduce((s,x)=>s+(+x.delivered||0),0);
    Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = fmt(total));
  } catch { Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = '—'); }
}

/* ---- Stock & Spend by Country (GLOBAL – exclude China) ---- */
async function renderStockAndSpendByCountry() {
  const body = Q('#stockByCountryBody'); if (!body) return;
  let stockT=0, adT=0;
  const map = {}; // { country: { stock, ad } }
  state.countriesNoChina.forEach(c => map[c] = { stock:0, ad:0 });

  try {
    const s = await api('/api/shipments');
    // arrived shipments adjust stock: +to, -from
    (s.shipments || []).forEach(sp => {
      if (!sp.arrivedAt) return;
      const to = (sp.toCountry||'').toLowerCase();
      const from = (sp.fromCountry||'').toLowerCase();
      if (to && to !== 'china') { map[to] = map[to] || { stock:0, ad:0 }; map[to].stock += (+sp.qty||0); }
      if (from && from !== 'china') { map[from] = map[from] || { stock:0, ad:0 }; map[from].stock -= (+sp.qty||0); }
    });
  } catch {}

  try {
    const r = await api('/api/remittances');
    (r.remittances || []).forEach(rec => {
      const c = (rec.country||'').toLowerCase();
      if (c !== 'china') {
        map[c] = map[c] || { stock:0, ad:0 };
        map[c].stock -= (+rec.pieces||0);
      }
    });
  } catch {}

  try {
    const a = await api('/api/adspend');
    (a.adSpends || []).forEach(x => {
      const c = (x.country||'').toLowerCase();
      if (c !== 'china') {
        map[c] = map[c] || { stock:0, ad:0 };
        map[c].ad += (+x.amount||0);
      }
    });
  } catch {}

  body.innerHTML = Object.entries(map).map(([c,v])=>{
    stockT+=v.stock; adT+=v.ad;
    return `<tr><td>${c}</td><td>${fmt(v.stock)}</td><td>${fmt(v.ad)}</td></tr>`;
  }).join('') || `<tr><td colspan="3" class="muted">No data yet</td></tr>`;

  Q('#stockTotal')&&(Q('#stockTotal').textContent = fmt(stockT));
  Q('#adTotal')&&(Q('#adTotal').textContent = fmt(adT));
}

/* ---- Weekly Delivered (Mon→Sun) — exclude China ---- */
function weekRangeFrom(date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // Monday=0
  d.setDate(d.getDate() - day);
  return [...Array(7)].map((_, i) => {
    const dd = new Date(d); dd.setDate(d.getDate() + i);
    return dd.toISOString().slice(0,10);
  });
}

async function initWeeklyDelivered() {
  const head = Q('#weeklyHead'), body = Q('#weeklyBody'), range = Q('#weeklyRange');
  if (!head || !body) return;

  let anchor = todayISO();
  async function build() {
    const days = weekRangeFrom(anchor);
    range.textContent = `Week: ${days[0]} → ${days[6]}`;
    head.innerHTML = `<tr><th>Country</th>${days.map(d=>`<th>${new Date(d).toLocaleDateString(undefined,{weekday:'short'})}<br>${d}</th>`).join('')}<th>Total</th></tr>`;
    body.innerHTML = state.countriesNoChina.map(c=>{
      const cells = days.map(d=>`<td><input class="wd" type="number" min="0" data-country="${c}" data-date="${d}" placeholder="0"></td>`).join('');
      return `<tr data-row="${c}"><td>${c}</td>${cells}<td class="rowT">0</td></tr>`;
    }).join('');

    // preload from /api/deliveries
    const r = await api('/api/deliveries');
    const by = {};
    (r.deliveries||[]).forEach(d=>{
      by[`${d.country}|${d.date}`] = +d.delivered||0;
    });
    QA('.wd').forEach(inp=>{
      const k = `${inp.dataset.country}|${inp.dataset.date}`;
      if (by[k]!=null) inp.value = by[k];
    });
    computeWD();
  }

  function computeWD() {
    QA('tr[data-row]').forEach(tr=>{
      const sum = QA('.wd', tr).reduce((s,x)=>s+(+x.value||0),0);
      tr.querySelector('.rowT').textContent = fmt(sum);
    });
    // columns + grand
    const cols = QA('thead th', Q('#weeklyTable')).length - 2;
    let grand=0;
    for (let i=0;i<cols;i++){
      let s=0;
      QA('tr[data-row]').forEach(tr=>{
        const inp = QA('.wd', tr)[i];
        s += (+inp.value||0);
      });
      QA('tfoot .totals th')[i+1].textContent = fmt(s);
      grand += s;
    }
    Q('#wAllT').textContent = fmt(grand);
    // also refresh KPI Delivered
    Q('#kpiDelivered')&&(Q('#kpiDelivered').textContent = fmt(grand));
  }

  Q('#weeklyPrev')?.addEventListener('click', ()=>{ const d=new Date(anchor); d.setDate(d.getDate()-7); anchor=d.toISOString().slice(0,10); build(); });
  Q('#weeklyNext')?.addEventListener('click', ()=>{ const d=new Date(anchor); d.setDate(d.getDate()+7); anchor=d.toISOString().slice(0,10); build(); });
  Q('#weeklyReset')?.addEventListener('click', ()=>{ QA('.wd').forEach(i=>i.value=''); computeWD(); });

  Q('#weeklySave')?.addEventListener('click', async ()=>{
    const entries = [];
    QA('.wd').forEach(inp=>{
      const v = +inp.value||0;
      if (v>0) entries.push({ date: inp.dataset.date, country: inp.dataset.country, delivered: v });
    });
    try{
      for (const rec of entries) {
        await api('/api/deliveries', { method:'POST', body: JSON.stringify(rec) });
      }
      alert('Saved!');
      computeWD();
    }catch(e){ alert(e.message); }
  });

  Q('#weeklyTable').addEventListener('input', e => {
    if (e.target.classList.contains('wd')) computeWD();
  });

  await build();
}

/* ---- Daily Ad Spend (replace) ---- */
function initDailyAdSpend() {
  Q('#adSave')?.addEventListener('click', async () => {
    const payload = {
      productId: Q('#adProduct')?.value,
      country: Q('#adCountry')?.value,
      platform: Q('#adPlatform')?.value,
      amount: +Q('#adAmount')?.value || 0
    };
    if (!payload.productId || !payload.country || !payload.platform) return alert('Missing fields');
    if (payload.country.toLowerCase()==='china') return alert('China not allowed here');
    try {
      await api('/api/adspend', { method:'POST', body: JSON.stringify(payload) });
      renderKpis();
      renderStockAndSpendByCountry();
      alert('Saved');
    } catch (e) { alert(e.message); }
  });
}

/* ---- Stock Movement (create shipment) ---- */
function initMovements() {
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
    if (!payload.productId || !payload.fromCountry || !payload.toCountry) return alert('Missing fields');
    try {
      await api('/api/shipments', { method:'POST', body: JSON.stringify(payload) });
      alert('Movement added');
      renderTransitTables();
    } catch (e) { alert(e.message); }
  });
}

/* ---- Transit tables (home) ---- */
async function renderTransitTables() {
  const s = await api('/api/shipments');
  const list = (s.shipments || []).filter(x => !x.arrivedAt);
  const productsById = Object.fromEntries((state.products || []).map(p => [p.id, p.name]));

  // China → Kenya
  const ckb = Q('#shipCKBody'); if (ckb) {
    const ck = list.filter(sp =>
      (sp.fromCountry || '').toLowerCase() === 'china' &&
      (sp.toCountry || '').toLowerCase() === 'kenya'
    );
    ckb.innerHTML = ck.map(sp => rowTransit(sp, productsById)).join('') || `<tr><td colspan="9" class="muted">No transit</td></tr>`;
  }
  // Inter-country
  const icb = Q('#shipICBody'); if (icb) {
    const ic = list.filter(sp => !(
      (sp.fromCountry || '').toLowerCase() === 'china' &&
      (sp.toCountry || '').toLowerCase() === 'kenya'
    ));
    icb.innerHTML = ic.map(sp => rowTransit(sp, productsById)).join('') || `<tr><td colspan="9" class="muted">No transit</td></tr>`;
  }

  wireTransitActions(() => { renderTransitTables(); renderStockAndSpendByCountry(); });
}

function rowTransit(sp, productsById) {
  const name = productsById[sp.productId] || sp.productId;
  const days = sp.arrivedAt ? Math.round((+new Date(sp.arrivedAt) - +new Date(sp.departedAt))/86400000) : '';
  return `<tr>
    <td>${sp.id}</td>
    <td>${name}</td>
    <td>${sp.fromCountry} → ${sp.toCountry}</td>
    <td>${fmt(sp.qty)}</td>
    <td>${fmt(sp.shipCost)}</td>
    <td>${sp.departedAt||''}</td>
    <td>${sp.arrivedAt||''}</td>
    <td>${days||''}</td>
    <td>
      <button class="btn outline" data-arrived="${sp.id}">Mark Arrived</button>
      <button class="btn outline" data-edit="${sp.id}">Edit</button>
      <button class="btn outline" data-del="${sp.id}">Delete</button>
    </td>
  </tr>`;
}

function wireTransitActions(refreshFn) {
  QA('[data-arrived]').forEach(b => b.onclick = async () => {
    const id = b.dataset.arrived;
    const date = prompt('Arrival date (YYYY-MM-DD)', todayISO());
    if (!date) return;
    try { await api(`/api/shipments/${id}`, { method:'PUT', body: JSON.stringify({ arrivedAt: date }) }); }
    catch(e){ return alert(e.message); }
    refreshFn();
  });
  QA('[data-edit]').forEach(b => b.onclick = async () => {
    const id = b.dataset.edit;
    const qty = +prompt('New qty?', '') || 0;
    const shipCost = +prompt('New shipping cost?', '') || 0;
    try { await api(`/api/shipments/${id}`, { method:'PUT', body: JSON.stringify({ qty, shipCost }) }); }
    catch(e){ return alert(e.message); }
    refreshFn();
  });
  QA('[data-del]').forEach(b => b.onclick = async () => {
    const id = b.dataset.del;
    if (!confirm('Delete shipment?')) return;
    try { await api(`/api/shipments/${id}`, { method:'DELETE' }); }
    catch(e){ return alert(e.message); }
    refreshFn();
  });
}

/* ---- Profit by Country (filter works) ---- */
function initProfitByCountry() {
  Q('#pcRun')?.addEventListener('click', async () => {
    const s = Q('#pcStart')?.value, e = Q('#pcEnd')?.value, c = Q('#pcCountry')?.value || '';
    const qs = [];
    if (s) qs.push('start=' + s);
    if (e) qs.push('end=' + e);
    try {
      const r = await api('/api/remittances' + (qs.length ? '?' + qs.join('&') : ''));
      const rows = (r.remittances || [])
        .filter(x => !x || (x.country && x.country.toLowerCase() !== 'china'))
        .filter(x => !c || x.country === c);
      const by = {};
      rows.forEach(x=>{
        const k = x.country;
        by[k] = by[k] || { revenue:0, ad:0, del:0, pieces:0 };
        by[k].revenue += (+x.revenue||0);
        by[k].ad += (+x.adSpend||0);
        by[k].del += (+x.extraPerPiece||0) * (+x.pieces||0);
        by[k].pieces += (+x.pieces||0);
      });

      let R=0,A=0,D=0,P=0;
      const tb = Q('#profitCountryBody');
      tb.innerHTML = Object.entries(by).map(([cc,v])=>{
        const profit = v.revenue - v.ad - v.del;
        R+=v.revenue; A+=v.ad; D+=v.del; P+=profit;
        return `<tr><td>${cc}</td><td>${fmt(v.revenue)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.del)}</td><td>${fmt(v.pieces)}</td><td>${fmt(profit)}</td></tr>`;
      }).join('') || `<tr><td colspan="6" class="muted">No data for this period</td></tr>`;
      Q('#pcRevT').textContent = fmt(R);
      Q('#pcAdT').textContent = fmt(A);
      Q('#pcDelT').textContent = fmt(D);
      Q('#pcPiecesT').textContent = fmt(Object.values(by).reduce((s,x)=>s+x.pieces,0));
      Q('#pcProfitT').textContent = fmt(P);
    } catch (e) { alert(e.message); }
  });
}

/* ---- To-Dos (localStorage; plus Weekly list) ---- */
function initTodos() {
  const KEY='eas_todos', WKEY='eas_weekly';
  const load = k => JSON.parse(localStorage.getItem(k)||'[]');
  const save = (k,v)=>localStorage.setItem(k,JSON.stringify(v));

  function renderQuick(){
    const list = load(KEY);
    const box = Q('#todoList'); if (!box) return;
    box.innerHTML = list.map(t=>`
      <div class="flex">
        <span>${t.done?'✅ ':''}${t.text}</span>
        <button class="btn outline" data-done="${t.id}">${t.done?'Undo':'Done'}</button>
        <button class="btn outline" data-del="${t.id}">Delete</button>
      </div>`).join('');
    Q('#todoAdd')?.addEventListener('click', ()=>{
      const v = Q('#todoText').value.trim(); if(!v) return;
      list.push({ id: crypto.randomUUID(), text:v, done:false });
      save(KEY,list); renderQuick();
    }, { once:true });
    box.onclick = e=>{
      if (e.target.dataset.done) { const t=list.find(x=>x.id===e.target.dataset.done); t.done=!t.done; save(KEY,list); renderQuick(); }
      if (e.target.dataset.del) { const i=list.findIndex(x=>x.id===e.target.dataset.del); list.splice(i,1); save(KEY,list); renderQuick(); }
    };
  }
  renderQuick();

  function renderWeekly(){
    const data = JSON.parse(localStorage.getItem(WKEY)||'{}');
    const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    const wrap = Q('#weeklyWrap'); if(!wrap) return;
    wrap.innerHTML = '';
    days.forEach(d=>{
      const arr = data[d]||[];
      const div = document.createElement('div');
      div.className='card';
      div.innerHTML = `<div class="h">${d}</div>
        <div class="row">
          <input id="w_${d}" class="input" placeholder="Task">
          <button class="btn" data-add="${d}">Add</button>
        </div>
        <div class="list">${arr.map(t=>`
          <div class="flex">
            <span>${t.done?'✅ ':''}${t.text}</span>
            <button class="btn outline" data-tgl="${d}|${t.id}">${t.done?'Undo':'Done'}</button>
            <button class="btn outline" data-del="${d}|${t.id}">Delete</button>
          </div>`).join('')}</div>`;
      wrap.appendChild(div);
    });
    wrap.onclick = e=>{
      if (e.target.dataset.add) {
        const d=e.target.dataset.add, v=Q('#w_'+d).value.trim(); if(!v) return;
        const arr = data[d]||[]; arr.push({ id:crypto.randomUUID(), text:v, done:false }); data[d]=arr;
        localStorage.setItem(WKEY, JSON.stringify(data)); renderWeekly();
      }
      if (e.target.dataset.tgl) {
        const [d,id] = e.target.dataset.tgl.split('|'); const it =(data[d]||[]).find(x=>x.id===id); it.done=!it.done;
        localStorage.setItem(WKEY, JSON.stringify(data)); renderWeekly();
      }
      if (e.target.dataset.del) {
        const [d,id] = e.target.dataset.del.split('|'); const arr=(data[d]||[]); const i=arr.findIndex(x=>x.id===id); arr.splice(i,1);
        data[d]=arr; localStorage.setItem(WKEY, JSON.stringify(data)); renderWeekly();
      }
    };
  }
  renderWeekly();
}

/* ========================================================================
   PRODUCTS (index.html list view)
   ======================================================================== */
function initProducts() {
  // Add product
  Q('#pAdd')?.addEventListener('click', async ()=>{
    const payload = {
      name: Q('#pName').value.trim(),
      sku: Q('#pSku').value.trim(),
      cost_china: +Q('#pCost').value||0,
      ship_china_to_kenya: +Q('#pShip').value||0,
      margin_budget: +Q('#pMB').value||0
    };
    if (!payload.name) return alert('Name required');
    await api('/api/products', { method:'POST', body: JSON.stringify(payload) });
    await preloadProducts(); fillGlobalSelects(); renderProductsTable(); alert('Product added');
  });

  renderProductsTable();
}

function renderProductsTable() {
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
      if (!confirm('Delete product everywhere? This removes remittances, adspend, shipments and influencer spends for it.')) return;
      await api('/api/products/' + del, { method:'DELETE' });
      await preloadProducts(); fillGlobalSelects(); renderProductsTable();
      // refresh dashboards
      renderStockAndSpendByCountry(); renderTransitTables(); renderKpis();
    }
  };
}

/* ========================================================================
   PERFORMANCE
   ======================================================================== */
function initPerformance() {
  // Top delivered – filter by period and (optional) country (no China option)
  Q('#pfRun')?.addEventListener('click', async () => {
    let start = Q('#pfStart')?.value, end = Q('#pfEnd')?.value;
    const quick = Q('#pfQuick')?.value;
    if (quick && quick !== 'custom') {
      const d = new Date(); d.setDate(d.getDate() - (+quick)); start = d.toISOString().slice(0,10); end = todayISO();
    }
    const c = Q('#pfCountry')?.value || '';
    const qs = []; if (start) qs.push('start='+start); if (end) qs.push('end='+end);
    const r = await api('/api/remittances' + (qs.length?('?'+qs.join('&')):''));
    const list = (r.remittances || []).filter(x => (x.country||'').toLowerCase()!=='china').filter(x => !c || x.country === c);

    const by = {};
    const pmap = Object.fromEntries(state.products.map(p=>[p.id,p]));
    list.forEach(x=>{
      const id = x.productId;
      const key = `${id}|${x.country}`;
      if (!by[key]) by[key] = { name: (pmap[id]?.name||id), country: x.country, pieces:0, ad:0, prodCost:0, profit:0 };
      by[key].pieces += (+x.pieces||0);
      by[key].ad += (+x.adSpend||0);
      const base = (+pmap[id]?.cost_china||0) + (+pmap[id]?.ship_china_to_kenya||0);
      by[key].prodCost += base * (+x.pieces||0);
      const extra = (+x.extraPerPiece||0) * (+x.pieces||0);
      const profit = (+x.revenue||0) - (+x.adSpend||0) - (base*(+x.pieces||0)) - extra;
      by[key].profit += profit;
    });

    const tb = Q('#pfTable tbody');
    tb.innerHTML = Object.values(by).sort((a,b)=>b.pieces-a.pieces).map(it =>
      `<tr><td>${it.name}</td><td>${it.country}</td><td>${fmt(it.pieces)}</td><td>${fmt(it.ad)}</td><td>${fmt(it.prodCost)}</td><td>${fmt(it.profit)}</td><td>${it.pieces?fmt(it.profit/it.pieces):'0'}</td></tr>`
    ).join('') || `<tr><td colspan="7" class="muted">No data</td></tr>`;
  });

  // Remittance report add (country list excludes China)
  Q('#rAdd')?.addEventListener('click', async () => {
    const payload = {
      start: Q('#rStart').value, end: Q('#rEnd').value,
      country: Q('#rCountry').value, productId: Q('#rProduct').value,
      orders: +Q('#rOrders').value || 0, pieces: +Q('#rPieces').value || 0,
      revenue: +Q('#rRev').value || 0, adSpend: +Q('#rAds').value || 0,
      extraPerPiece: +Q('#rExtra').value || 0
    };
    if (!payload.start || !payload.end || !payload.country || !payload.productId) return alert('Missing fields');
    if (payload.country.toLowerCase()==='china') return alert('China is not allowed here');
    await api('/api/remittances', { method:'POST', body: JSON.stringify(payload) });
    Q('#rMsg').textContent = 'Saved ✔';
    setTimeout(()=>Q('#rMsg').textContent='', 1500);
  });
}

/* ========================================================================
   FINANCE
   ======================================================================== */
async function initFinance() {
  await loadFinanceCats();

  // add category
  Q('#fcAdd')?.addEventListener('click', async () => {
    const type = Q('#fcType').value, name = Q('#fcName').value.trim();
    if (!name) return;
    await api('/api/finance/categories', { method:'POST', body: JSON.stringify({ type, name }) });
    Q('#fcName').value=''; await loadFinanceCats();
  });

  // entry add
  Q('#feAdd')?.addEventListener('click', async () => {
    const date = Q('#feDate').value, category = Q('#feCat').value, amount = +Q('#feAmt').value || 0, note = Q('#feNote').value;
    const type = Q('#feType').value;
    if (!date || !category) return alert('Pick date & category');
    await api('/api/finance/entries', { method:'POST', body: JSON.stringify({ date, type, category, amount, note }) });
    Q('#feNote').value=''; Q('#feAmt').value='';
    renderFinancePeriod();
  });

  // run period (supports start–end)
  Q('#feRun')?.addEventListener('click', renderFinancePeriod);
  renderFinancePeriod();
}

async function loadFinanceCats() {
  try {
    const cats = await api('/api/finance/categories');
    state.categories = cats;
    // show chips with delete buttons
    Q('#fcDebits')&&(Q('#fcDebits').innerHTML = cats.debit.map(c=>`<span class="chip">${c} <button class="x" data-delc="debit|${c}">×</button></span>`).join('')||'—');
    Q('#fcCredits')&&(Q('#fcCredits').innerHTML = cats.credit.map(c=>`<span class="chip">${c} <button class="x" data-delc="credit|${c}">×</button></span>`).join('')||'—');
    // fill category select (entries)
    const all = [...cats.debit, ...cats.credit].sort();
    Q('#feCat')&&(Q('#feCat').innerHTML = `<option value="" disabled selected>Select category</option>` + all.map(c=>`<option>${c}</option>`).join(''));

    Q('.cats')?.addEventListener('click', async e=>{
      const d = e.target.dataset.delc; if (!d) return;
      const [type,name] = d.split('|');
      if (!confirm(`Delete category "${name}"?`)) return;
      await api(`/api/finance/categories?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}`, { method:'DELETE' });
      await loadFinanceCats();
    }, { once:true });
  } catch {}
}

async function renderFinancePeriod() {
  try {
    const s = Q('#fes')?.value, e = Q('#fee')?.value;
    const r = await api('/api/finance/entries' + ((s||e)?(`?start=${s||''}&end=${e||''}`):''));
    const entries = r.entries || [];
    Q('#runBalance')&&(Q('#runBalance').textContent = fmt(r.running || 0) + ' USD');
    Q('#feBalance')&&(Q('#feBalance').textContent = 'Period Balance: ' + fmt(r.balance || 0) + ' USD');
    const tb = Q('#feTable tbody');
    if (tb) tb.innerHTML = entries.map(x =>
      `<tr><td>${x.date}</td><td>${x.type}</td><td>${x.category}</td><td>${fmt(x.amount)}</td><td>${x.note||''}</td>
       <td><button class="btn outline" data-del-entry="${x.id}">Delete</button></td></tr>`
    ).join('') || `<tr><td colspan="6" class="muted">No entries</td></tr>`;
    tb?.addEventListener('click', async e => {
      if (e.target.dataset.delEntry) {
        await api('/api/finance/entries/' + e.target.dataset.delEntry, { method:'DELETE' });
        renderFinancePeriod();
      }
    }, { once:true });
  } catch (e) { alert(e.message); }
}

/* ========================================================================
   SETTINGS
   ======================================================================== */
function initSettings() {
  // countries add
  Q('#ctyAdd')?.addEventListener('click', async () => {
    const name = Q('#cty').value.trim(); if (!name) return;
    if (name.toLowerCase()==='china') return alert('China already exists and cannot be added/removed here.');
    await api('/api/countries', { method:'POST', body: JSON.stringify({ name }) });
    const m = await api('/api/meta'); state.countriesAll = m.countries||[]; state.countriesNoChina = state.countriesAll.filter(c=>c.toLowerCase()!=='china');
    fillGlobalSelects(); renderCountryChips();
  });
  renderCountryChips();

  // edit product info
  const sel = Q('#epSelect');
  if (sel) {
    sel.innerHTML = `<option value="">Select product…</option>` + state.products.map(p=>`<option value="${p.id}">${p.name} (${p.sku||'—'})</option>`).join('');
    sel.onchange = () => {
      const p = state.products.find(x=>x.id===sel.value); if(!p) return;
      Q('#epName').value=p.name; Q('#epSku').value=p.sku||''; Q('#epCost').value=p.cost_china||0; Q('#epShip').value=p.ship_china_to_kenya||0; Q('#epMB').value=p.margin_budget||0;
    };
    Q('#epSave')?.addEventListener('click', async ()=>{
      const id = sel.value; if(!id) return alert('Pick a product');
      const body = {
        name: Q('#epName').value, sku: Q('#epSku').value,
        cost_china:+Q('#epCost').value||0, ship_china_to_kenya:+Q('#epShip').value||0, margin_budget:+Q('#epMB').value||0
      };
      await api('/api/products/'+id, { method:'PUT', body: JSON.stringify(body) });
      await preloadProducts();
      alert('Saved');
    });
  }

  // manual snapshots
  Q('#snapSave')?.addEventListener('click', async ()=>{
    const name = Q('#snapName').value.trim() || `Manual ${new Date().toLocaleString()}`;
    await api('/api/snapshots', { method:'POST', body: JSON.stringify({ name }) });
    Q('#snapName').value='';
    renderSnapshots();
  });
  renderSnapshots();
}

function renderCountryChips() {
  const list = Q('#ctyList'); if (!list) return;
  const arr = state.countriesAll;
  list.innerHTML = arr.map(c=>{
    const canDel = c.toLowerCase()!=='china';
    return `<span class="chip">${c}${canDel?` <button class="x" data-del-cty="${c}">×</button>`:''}</span>`;
  }).join('') || '—';
  list.onclick = async e=>{
    const c = e.target.dataset.delCty; if(!c) return;
    if (!confirm(`Delete country "${c}"?`)) return;
    await api('/api/countries/'+encodeURIComponent(c), { method:'DELETE' });
    const m = await api('/api/meta'); state.countriesAll = m.countries||[]; state.countriesNoChina = state.countriesAll.filter(x=>x.toLowerCase()!=='china');
    fillGlobalSelects(); renderCountryChips();
  };
}

async function renderSnapshots() {
  const r = await api('/api/snapshots');
  const tb = Q('#snapList'); if (!tb) return;
  tb.innerHTML = (r.snapshots||[]).map(s=>`
    <tr>
      <td>${s.name}</td><td>${s.file.replace(/^.*data\\?\/?snapshots\\?\//,'')}</td>
      <td>
        <button class="btn outline" data-push="${s.file}">Push</button>
        <button class="btn outline" data-del-snap="${s.id}">Delete</button>
      </td>
    </tr>
  `).join('') || `<tr><td colspan="3" class="muted">No snapshots</td></tr>`;

  tb.onclick = async e=>{
    if (e.target.dataset.push) {
      await api('/api/snapshots/restore', { method:'POST', body: JSON.stringify({ file: e.target.dataset.push }) });
      alert('Pushed ✔ (snapshot stays in the list until you delete it)');
      location.reload();
    } else if (e.target.dataset.delSnap) {
      if (!confirm('Delete this snapshot?')) return;
      await api('/api/snapshots/'+e.target.dataset.delSnap, { method:'DELETE' });
      renderSnapshots();
    }
  };
}

/* ========================================================================
   PRODUCT PAGE (product.html?id=...)
   ======================================================================== */
async function loadProduct(id) {
  await preloadProducts();
  state.product = state.products.find(p => p.id === id) || null;
}

function renderProductPage() {
  if (!state.product) { alert('Product not found'); location.href='/'; return; }
  Q('#pdTitle').textContent = state.product.name;
  Q('#pdSku').textContent = state.product.sku ? `SKU: ${state.product.sku}` : '';

  fillGlobalSelects(); // to populate country/product selects (countries without China for budgets/ad/influencers)

  bindProductHandlers();
  refreshProductSections();
}

function bindProductHandlers() {
  // manual budgets (per country, exclude China)
  Q('#pdPBSave')?.addEventListener('click', async ()=>{
    const c = Q('#pdPBCountry').value; const v = +Q('#pdPBValue').value || 0;
    const p = { budgets: state.product.budgets || {} }; p.budgets[c] = v;
    await api('/api/products/'+state.product.id, { method:'PUT', body: JSON.stringify(p) });
    await loadProduct(state.product.id); renderPBTable();
  });

  // product ad spend replace
  Q('#pdAdSave')?.addEventListener('click', async ()=>{
    const payload = {
      productId: state.product.id,
      country: Q('#pdAdCountry').value,
      platform: Q('#pdAdPlatform').value,
      amount: +Q('#pdAdAmount').value || 0
    };
    if ((payload.country||'').toLowerCase()==='china') return alert('China not allowed here');
    await api('/api/adspend', { method:'POST', body: JSON.stringify(payload) });
    refreshProductSections();
  });

  // shipments create (include China options here)
  Q('#pdMvAdd')?.addEventListener('click', async ()=>{
    const payload = {
      productId: state.product.id,
      fromCountry: Q('#pdMvFrom').value,
      toCountry: Q('#pdMvTo').value,
      qty: +Q('#pdMvQty').value || 0,
      shipCost: +Q('#pdMvShip').value || 0,
      departedAt: todayISO(),
      arrivedAt: null
    };
    await api('/api/shipments', { method:'POST', body: JSON.stringify(payload) });
    refreshProductSections();
  });

  // lifetime filter
  Q('#pdLPRun')?.addEventListener('click', renderProductLifetime);

  // influencers
  Q('#pdInfAdd')?.addEventListener('click', async ()=>{
    const payload = { name: Q('#pdInfName').value.trim(), social: Q('#pdInfSocial').value.trim(), country: Q('#pdInfCountry').value };
    if (!payload.name) return alert('Name required');
    if ((payload.country||'').toLowerCase()==='china') return alert('China not allowed here');
    await api('/api/influencers', { method:'POST', body: JSON.stringify(payload) });
    Q('#pdInfName').value=''; Q('#pdInfSocial').value='';
    renderInfluencers();
  });
  Q('#pdInfSpendAdd')?.addEventListener('click', async ()=>{
    const payload = {
      date: Q('#pdInfDate').value || todayISO(),
      influencerId: Q('#pdInfSelect').value,
      country: Q('#pdInfCountry').value,
      productId: state.product.id,
      amount: +Q('#pdInfAmount').value || 0
    };
    if (!payload.influencerId) return alert('Select influencer');
    if ((payload.country||'').toLowerCase()==='china') return alert('China not allowed here');
    await api('/api/influencers/spend', { method:'POST', body: JSON.stringify(payload) });
    renderInfluencers();
  });
  Q('#pdInfRun')?.addEventListener('click', renderInfluencers);
}

async function refreshProductSections() {
  await loadProduct(state.product.id);
  renderProductStockAd();
  renderPBTable();
  renderProductAdList();
  renderProductTransit();       // in-transit only
  renderProductArrived();       // NEW: arrived shipments section
  renderProductLifetime();
  renderInfluencers();
}

/* -- product: stock & ad by country (exclude China) -- */
async function renderProductStockAd() {
  const tb = Q('#pdStockBody'); if (!tb) return;

  const m = {}; state.countriesNoChina.forEach(c=>m[c]={stock:0, ad:0});

  const s = await api('/api/shipments');
  (s.shipments||[]).filter(x=>x.productId===state.product.id && x.arrivedAt).forEach(sp=>{
    const to=(sp.toCountry||'').toLowerCase(), from=(sp.fromCountry||'').toLowerCase(), q=+sp.qty||0;
    if (to!=='china') { m[to]=m[to]||{stock:0,ad:0}; m[to].stock+=q; }
    if (from!=='china') { m[from]=m[from]||{stock:0,ad:0}; m[from].stock-=q; }
  });

  const r = await api('/api/remittances');
  (r.remittances||[]).filter(x=>x.productId===state.product.id && (x.country||'').toLowerCase()!=='china').forEach(x=>{
    m[x.country]=m[x.country]||{stock:0,ad:0}; m[x.country].stock -= (+x.pieces||0);
  });

  const a = await api('/api/adspend');
  (a.adSpends||[]).filter(x=>x.productId===state.product.id && (x.country||'').toLowerCase()!=='china').forEach(x=>{
    m[x.country]=m[x.country]||{stock:0,ad:0}; m[x.country].ad += (+x.amount||0);
  });

  let st=0, adt=0;
  tb.innerHTML = Object.entries(m).map(([c,v])=>{
    st+=v.stock; adt+=v.ad;
    return `<tr><td>${c}</td><td>${fmt(v.stock)}</td><td>${fmt(v.ad)}</td></tr>`;
  }).join('') || `<tr><td colspan="3" class="muted">No data</td></tr>`;
  Q('#pdStockTotal').textContent = fmt(st);
  Q('#pdAdTotal').textContent = fmt(adt);
}

/* -- product: manual budget table (exclude China) -- */
function renderPBTable() {
  const tb = Q('#pdPBBBody'); if(!tb) return;
  const map = state.product.budgets || {};
  tb.innerHTML = state.countriesNoChina.map(c=>`
    <tr><td>${c}</td><td>${fmt(map[c]||0)}</td>
      <td><button class="btn outline" data-clear-b="${c}">Clear</button></td></tr>
  `).join('') || `<tr><td colspan="3" class="muted">No countries</td></tr>`;
  tb.onclick = async e=>{
    const c=e.target.dataset.clearB; if(!c) return;
    const p = { budgets: state.product.budgets || {} }; delete p.budgets[c];
    await api('/api/products/'+state.product.id, { method:'PUT', body: JSON.stringify(p) });
    await loadProduct(state.product.id); renderPBTable();
  };
}

/* -- product: ad list -- */
async function renderProductAdList() {
  const a = await api('/api/adspend');
  const list = (a.adSpends||[]).filter(x=>x.productId===state.product.id && (x.country||'').toLowerCase()!=='china');
  const tb = Q('#pdAdBody'); if(!tb) return;
  tb.innerHTML = list.map(x=>`<tr><td>${x.country}</td><td>${x.platform}</td><td>${fmt(x.amount)}</td></tr>`).join('') ||
    `<tr><td colspan="3" class="muted">No ad spend yet</td></tr>`;
}

/* -- product: transit in-flight only -- */
async function renderProductTransit() {
  const s = await api('/api/shipments');
  const list = (s.shipments||[]).filter(x=>x.productId===state.product.id && !x.arrivedAt);
  const ck = list.filter(sp=>(sp.fromCountry||'').toLowerCase()==='china' && (sp.toCountry||'').toLowerCase()==='kenya');
  const ic = list.filter(sp=>!ck.includes(sp));

  const tb1 = Q('#pdShipCKBody'), tb2 = Q('#pdShipICBody');
  const row = sp => {
    const days = sp.arrivedAt ? Math.round((+new Date(sp.arrivedAt)-+new Date(sp.departedAt))/86400000) : '';
    return `<tr>
      <td>${sp.id}</td><td>${sp.fromCountry} → ${sp.toCountry}</td>
      <td>${fmt(sp.qty)}</td><td>${fmt(sp.shipCost)}</td>
      <td>${sp.departedAt||''}</td><td>${sp.arrivedAt||''}</td><td>${days||''}</td>
      <td>
        <button class="btn outline" data-arrived="${sp.id}">Mark Arrived</button>
        <button class="btn outline" data-edit="${sp.id}">Edit</button>
        <button class="btn outline" data-del="${sp.id}">Delete</button>
      </td>
    </tr>`;
  };

  tb1.innerHTML = ck.map(row).join('') || `<tr><td colspan="8" class="muted">No shipments</td></tr>`;
  tb2.innerHTML = ic.map(row).join('') || `<tr><td colspan="8" class="muted">No shipments</td></tr>`;

  wireTransitActions(()=>{ renderProductTransit(); renderProductArrived(); renderProductStockAd(); });
}

/* -- NEW: product: arrived shipments section -- */
async function renderProductArrived() {
  const s = await api('/api/shipments');
  const list = (s.shipments||[]).filter(x=>x.productId===state.product.id && x.arrivedAt);
  const tb = Q('#pdShipArrivedBody'); if(!tb) return;
  tb.innerHTML = list.sort((a,b)=> (b.arrivedAt||'').localeCompare(a.arrivedAt||'')).map(sp=>{
    const days = Math.round((+new Date(sp.arrivedAt)-+new Date(sp.departedAt))/86400000);
    return `<tr>
      <td>${sp.id}</td><td>${sp.fromCountry} → ${sp.toCountry}</td>
      <td>${fmt(sp.qty)}</td><td>${fmt(sp.shipCost)}</td>
      <td>${sp.departedAt||''}</td><td>${sp.arrivedAt||''}</td><td>${isFinite(days)?days:''}</td>
      <td><button class="btn outline" data-del="${sp.id}">Delete</button></td>
    </tr>`;
  }).join('') || `<tr><td colspan="8" class="muted">No arrived shipments</td></tr>`;

  // allow delete arrived shipment
  tb.onclick = async e=>{
    const id = e.target.dataset.del; if (!id) return;
    if (!confirm('Delete this arrived shipment?')) return;
    await api('/api/shipments/'+id, { method:'DELETE' });
    renderProductArrived(); renderProductStockAd();
  };
}

/* ---------- NAV ---------- */
function initNav() {
  QA('.nav a[data-view]')?.forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    const v = a.dataset.view;
    ['home','products','performance','finance','settings'].forEach(id => {
      const el = Q('#'+id);
      if (el) el.style.display = (id===v) ? '' : 'none';
    });
    QA('.nav a').forEach(x => x.classList.toggle('active', x === a));
    if (v === 'home') { renderKpis(); renderStockAndSpendByCountry(); renderTransitTables(); }
  }));
}

/* ---------- boot ---------- */
gate();
