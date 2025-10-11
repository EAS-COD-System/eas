/* =========================
   EAS Tracker – Front-end
   Works for both index.html and product.html
   ========================= */

/* ---------- small helpers ---------- */
const Q  = (s, r = document) => r.querySelector(s);
const QA = (s, r = document) => Array.from(r.querySelectorAll(s));
const fmt = n => (Number(n || 0)).toLocaleString(undefined, { maximumFractionDigits: 2 });
const todayISO = () => new Date().toISOString().slice(0, 10);
const getQuery = k => new URLSearchParams(location.search).get(k);

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

/* ---------- state ---------- */
const state = {
  countries: [],
  products: [],
  categories: { debit: [], credit: [] },
  product: null,
  productId: getQuery('id'),
  weekStartISO: null // Monday of visible week in Weekly Delivered
};

/* ================================================================
   AUTH + BOOT
   ================================================================ */
async function gate() {
  try {
    const meta = await api('/api/meta');
    state.countries = meta.countries || [];

    Q('#login')?.classList.add('hide');
    Q('#main')?.removeAttribute('style');

    await preloadProducts();
    fillGlobalSelects();
    initNav();

    if (state.productId) {
      // product.html
      await loadProduct(state.productId);
      renderProductPage();
    } else {
      // index.html
      initDashboard();
      initProducts();
      initPerformance();
      initFinance();
      initSettings();
    }
  } catch (e) {
    // not authed → show login
    Q('#login')?.classList.remove('hide');
    Q('#main')?.setAttribute('style', 'display:none');
  }
}

Q('#loginBtn')?.addEventListener('click', async () => {
  const pwd = Q('#pw').value.trim();
  try {
    await api('/api/auth', { method: 'POST', body: JSON.stringify({ password: pwd }) });
    Q('#loginError') && (Q('#loginError').textContent = '');
    await gate();
  } catch (err) {
    Q('#loginError') && (Q('#loginError').textContent = 'Wrong password');
  }
});

Q('#logoutLink')?.addEventListener('click', async e => {
  e.preventDefault();
  try { await api('/api/auth', { method: 'POST', body: JSON.stringify({ password: 'logout' }) }); } catch {}
  location.reload();
});

/* ================================================================
   DATA LOADING + SELECT FILLERS
   ================================================================ */
async function preloadProducts() {
  try {
    const r = await api('/api/products');
    state.products = r.products || [];
  } catch {
    state.products = [];
  }
}

function fillGlobalSelects() {
  // Countries (only where element exists)
  const countrySelectors = [
    '#adCountry','#mvFrom','#mvTo','#rCountry','#pfCountry',
    '#pcCountry', '#epCountry', '#pdAdCountry', '#pdRCountry',
    '#pdMvFrom','#pdMvTo', '#pdPBCountry', '#pdInfCountry', '#pdInfFilterCountry'
  ];
  countrySelectors.forEach(sel => {
    QA(sel).forEach(el => {
      el.innerHTML = state.countries.map(c => `<option value="${c}">${c}</option>`).join('');
    });
  });

  // Products
  const productSelectors = ['#adProduct','#mvProduct','#rProduct','#lpProduct'];
  productSelectors.forEach(sel => {
    QA(sel).forEach(el => {
      const opts = state.products.map(p => `<option value="${p.id}">${p.name}${p.sku ? ' ('+p.sku+')' : ''}</option>`).join('');
      if (el.id === 'lpProduct') {
        el.innerHTML = `<option value="">All products</option>${opts}`;
      } else {
        el.innerHTML = opts;
      }
    });
  });

  // Products editor selector (settings)
  const epSel = Q('#editProdSel') || Q('#epSelect');
  if (epSel) {
    epSel.innerHTML = `<option value="">Select product…</option>` + state.products.map(p => `<option value="${p.id}">${p.name}${p.sku ? ' ('+p.sku+')' : ''}</option>`).join('');
  }
}

/* ================================================================
   DASHBOARD
   ================================================================ */
function initDashboard() {
  renderKpis();                       // first pass
  renderStockAndSpendByCountry();     // totals + body
  initWeeklyDelivered();              // sets KPI Delivered from grid total afterwards
  initDailyAdSpend();
  initMovements();
  renderTransitTables();
  initProfitByCountry();
  initTodos();
}

/* ---------- KPIs ---------- */
async function renderKpis() {
  Q('#kpiProducts') && (Q('#kpiProducts').textContent = state.products.length);
  Q('#kpiCountries') && (Q('#kpiCountries').textContent = state.countries.length);

  // Transit count (in-progress)
  try {
    const s = await api('/api/shipments');
    const live = (s.shipments || []).filter(x => !x.arrivedAt).length;
    Q('#kpiTransit') && (Q('#kpiTransit').textContent = live);
  } catch { Q('#kpiTransit') && (Q('#kpiTransit').textContent = '—'); }

  // Total Ad Spend (sum of upserted adspend)
  try {
    const a = await api('/api/adspend');
    const total = (a.adSpends || []).reduce((t, x) => t + (+x.amount || 0), 0);
    Q('#kpiAdSpend') && (Q('#kpiAdSpend').textContent = fmt(total) + ' USD');
  } catch { Q('#kpiAdSpend') && (Q('#kpiAdSpend').textContent = '—'); }

  // Delivered (Mon–Sun) — this gets overwritten by Weekly Delivered grid’s grand total when that renders.
  try {
    const r = await api('/api/deliveries');
    const total = (r.deliveries || []).reduce((t, x) => t + (+x.delivered || 0), 0);
    Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = fmt(total));
  } catch { Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = '—'); }
}

/* ---------- Stock & Spend by Country ---------- */
async function renderStockAndSpendByCountry() {
  const tbl = Q('#stockByCountryTbl'); if (!tbl) return;
  const body = tbl.querySelector('tbody');
  const footStock = Q('#stockT'), footAd = Q('#adT');

  const per = {};
  state.countries.forEach(c => per[c] = { stock: 0, ad: 0 });

  // Arrived shipments add to destination, deduct from origin
  try {
    const s = await api('/api/shipments');
    (s.shipments || []).forEach(sp => {
      if (sp.arrivedAt) {
        const to = sp.toCountry || sp.to;
        const from = sp.fromCountry || sp.from;
        const qty = +sp.qty || 0;
        if (to) { per[to] = per[to] || { stock:0, ad:0 }; per[to].stock += qty; }
        if (from){ per[from]= per[from]|| { stock:0, ad:0 }; per[from].stock -= qty; }
      }
    });
  } catch {}

  // Delivered pieces (from remittances) subtract stock
  try {
    const r = await api('/api/remittances');
    (r.remittances || []).forEach(x => {
      const pcs = +x.pieces || 0;
      per[x.country] = per[x.country] || { stock:0, ad:0 };
      per[x.country].stock -= pcs;
    });
  } catch {}

  // Ad spend from daily adspend upsert pool (sum by country)
  try {
    const a = await api('/api/adspend');
    (a.adSpends || []).forEach(x => {
      per[x.country] = per[x.country] || { stock:0, ad:0 };
      per[x.country].ad += (+x.amount || 0);
    });
  } catch {}

  let stockT = 0, adT = 0;
  body.innerHTML = Object.entries(per).map(([c,v])=>{
    stockT += v.stock; adT += v.ad;
    return `<tr><td>${c}</td><td>${fmt(v.stock)}</td><td>${fmt(v.ad)}</td></tr>`;
  }).join('');

  if (footStock) footStock.textContent = fmt(stockT);
  if (footAd) footAd.textContent = fmt(adT);
}

/* ---------- Weekly Delivered (Mon–Sun grid) ---------- */
function mondayOf(dateISO) {
  const d = new Date(dateISO);
  const wd = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - wd);
  return d.toISOString().slice(0,10);
}
function weekISOStrings(mondayISO) {
  const start = new Date(mondayISO);
  return [...Array(7)].map((_,i) => {
    const d = new Date(start); d.setDate(start.getDate()+i);
    return d.toISOString().slice(0,10);
  });
}

async function initWeeklyDelivered() {
  const grid = Q('#weeklyGrid'); if (!grid) return;

  state.weekStartISO = mondayOf(todayISO());
  drawWeeklyGrid(state.weekStartISO);

  Q('#wdPrev')?.addEventListener('click', () => {
    const d = new Date(state.weekStartISO); d.setDate(d.getDate() - 7);
    state.weekStartISO = d.toISOString().slice(0,10);
    drawWeeklyGrid(state.weekStartISO);
  });
  Q('#wdNext')?.addEventListener('click', () => {
    const d = new Date(state.weekStartISO); d.setDate(d.getDate() + 7);
    state.weekStartISO = d.toISOString().slice(0,10);
    drawWeeklyGrid(state.weekStartISO);
  });
  Q('#wdSave')?.addEventListener('click', saveWeekly);
  Q('#wdReset')?.addEventListener('click', () => {
    QA('.wd-cell').forEach(inp => inp.value = '');
    computeWeeklyTotals();
  });

  grid.addEventListener('input', e => {
    if (e.target.classList.contains('wd-cell')) computeWeeklyTotals();
  });
}

async function drawWeeklyGrid(mondayISO) {
  const days = weekISOStrings(mondayISO);
  Q('#wdRange') && (Q('#wdRange').textContent = `Week: ${days[0]} → ${days[6]}`);

  const thead = Q('#weeklyGrid thead');
  const tbody = Q('#weeklyGrid tbody');
  thead.innerHTML = `<tr>
    <th>Country</th>
    ${days.map(d => `<th>${new Date(d).toLocaleDateString(undefined,{weekday:'short'})}<br>${d}</th>`).join('')}
    <th>Total</th>
  </tr>`;

  tbody.innerHTML = state.countries.map(c => `
    <tr data-row="${c}">
      <td>${c}</td>
      ${days.map(d => `<td><input type="number" class="wd-cell" data-country="${c}" data-date="${d}" min="0" placeholder="0"/></td>`).join('')}
      <td class="row-total">0</td>
    </tr>
  `).join('');

  // preload existing deliveries for those 7 days
  try {
    const r = await api('/api/deliveries');
    const map = {};
    (r.deliveries || []).forEach(x => { map[`${x.country}|${x.date}`] = +x.delivered || 0; });
    QA('.wd-cell').forEach(inp => {
      const k = `${inp.dataset.country}|${inp.dataset.date}`;
      if (map[k] != null) inp.value = map[k];
    });
  } catch {}

  computeWeeklyTotals(); // sets col totals + grand total and KPI
}

function computeWeeklyTotals() {
  // per row
  QA('tr[data-row]').forEach(tr => {
    const sum = QA('.wd-cell', tr).reduce((s, el) => s + (+el.value || 0), 0);
    Q('.row-total', tr).textContent = fmt(sum);
  });
  // per column + grand
  const rows = QA('tr[data-row]');
  if (!rows.length) return;
  const cols = QA('.wd-cell', rows[0]).length;
  let grand = 0;
  for (let c = 0; c < cols; c++) {
    let sum = 0;
    rows.forEach(tr => sum += (+QA('.wd-cell', tr)[c].value || 0));
    QA('.col-total')[c].textContent = fmt(sum);
    grand += sum;
  }
  Q('#wdGrand') && (Q('#wdGrand').textContent = fmt(grand));
  // also push to KPI Delivered (Mon–Sun)
  Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = fmt(grand));
}

async function saveWeekly() {
  const payload = [];
  QA('.wd-cell').forEach(inp => {
    const v = +inp.value || 0;
    if (v > 0) payload.push({ date: inp.dataset.date, country: inp.dataset.country, delivered: v });
  });

  try {
    // naive append (server stores entries). For a true “replace”, you’d implement a backend week-delete.
    for (const rec of payload) {
      await api('/api/deliveries', { method: 'POST', body: JSON.stringify(rec) });
    }
    alert('Weekly delivered saved!');
    computeWeeklyTotals();
  } catch (e) {
    alert('Save failed: ' + e.message);
  }
}

/* ---------- Daily Ad Spend (upsert) ---------- */
function initDailyAdSpend() {
  Q('#adAdd')?.addEventListener('click', async () => {
    const payload = {
      productId: Q('#adProduct')?.value,
      country:   Q('#adCountry')?.value,
      platform:  Q('#adPlatform')?.value,
      amount:   +Q('#adAmount')?.value || 0
    };
    if (!payload.productId || !payload.country || !payload.platform) return alert('Missing fields');
    try {
      await api('/api/adspend', { method: 'POST', body: JSON.stringify(payload) });
      alert('Saved (replaced if existed)');
      renderKpis();
      renderStockAndSpendByCountry();
      if (state.productId) refreshProductSections();
    } catch (e) { alert(e.message); }
  });
}

/* ---------- Movements (create shipment) ---------- */
function initMovements() {
  Q('#mvAdd')?.addEventListener('click', async () => {
    const payload = {
      productId:  Q('#mvProduct')?.value,
      fromCountry:Q('#mvFrom')?.value,
      toCountry:  Q('#mvTo')?.value,
      qty:       +Q('#mvQty')?.value || 0,
      shipCost:  +Q('#mvShip')?.value || 0,
      departedAt: todayISO(),
      arrivedAt:  null
    };
    if (!payload.productId || !payload.fromCountry || !payload.toCountry) return alert('Missing fields');
    try {
      await api('/api/shipments', { method: 'POST', body: JSON.stringify(payload) });
      alert('Shipment created');
      renderTransitTables();
    } catch (e) { alert(e.message); }
  });
}

/* ---------- Transit (list + actions) ---------- */
async function renderTransitTables() {
  const s = await api('/api/shipments');
  const list = (s.shipments || []);
  const productsById = Object.fromEntries((state.products || []).map(p => [p.id, p.name]));

  // Home shows only in-transit (arrived hidden from dashboard)
  const inTransit = list.filter(x => !x.arrivedAt);

  // China → Kenya
  const ckb = Q('#shipCKBody');
  if (ckb) {
    const ck = inTransit.filter(sp =>
      (sp.fromCountry || sp.from || '').toLowerCase() === 'china' &&
      (sp.toCountry   || sp.to   || '').toLowerCase() === 'kenya'
    );
    ckb.innerHTML = ck.map(sp => rowTransit(sp, productsById)).join('') ||
      '<tr><td colspan="9" class="muted">No transit</td></tr>';
  }

  // Inter-country
  const icb = Q('#shipICBody');
  if (icb) {
    const ic = inTransit.filter(sp => !(
      (sp.fromCountry || sp.from || '').toLowerCase() === 'china' &&
      (sp.toCountry   || sp.to   || '').toLowerCase() === 'kenya'
    ));
    icb.innerHTML = ic.map(sp => rowTransit(sp, productsById)).join('') ||
      '<tr><td colspan="9" class="muted">No transit</td></tr>';
  }

  // Wire actions (Mark Arrived / Edit / Delete)
  QA('[data-mark-arrived]').forEach(b => b.onclick = async () => {
    const id = b.dataset.markArrived;
    const date = prompt('Arrival date (YYYY-MM-DD)', todayISO());
    if (!date) return;
    try {
      await api(`/api/shipments/${id}`, { method: 'PUT', body: JSON.stringify({ arrivedAt: date }) });
      // After arrival, refresh both transit list and stock/spend totals
      await renderTransitTables();
      await renderStockAndSpendByCountry();
      if (state.productId) refreshProductSections();
    } catch (e) {
      alert('Mark arrived failed: ' + e.message);
    }
  });

  QA('[data-edit-transit]').forEach(b => b.onclick = async () => {
    const id = b.dataset.editTransit;
    const qty = prompt('New quantity?');
    const shipCost = prompt('New shipping cost (USD)?');
    if (qty == null || shipCost == null) return;
    try {
      await api(`/api/shipments/${id}`, { method: 'PUT', body: JSON.stringify({ qty: +qty || 0, shipCost: +shipCost || 0 }) });
      await renderTransitTables();
      if (state.productId) refreshProductSections();
    } catch (e) {
      alert('Edit failed: ' + e.message);
    }
  });

  QA('[data-del-transit]').forEach(b => b.onclick = async () => {
    const id = b.dataset.delTransit;
    if (!confirm('Delete this shipment?')) return;
    try {
      await api(`/api/shipments/${id}`, { method: 'DELETE' });
      await renderTransitTables();
    } catch (e) {
      alert('Delete failed: ' + e.message);
    }
  });
}

function rowTransit(sp, productsById) {
  const name = productsById[sp.productId] || sp.productId;
  const days = sp.arrivedAt && sp.departedAt
    ? Math.max(0, Math.round((+new Date(sp.arrivedAt) - +new Date(sp.departedAt)) / 86400000))
    : '';
  return `<tr>
    <td>${sp.id}</td>
    <td>${name}</td>
    <td>${(sp.fromCountry||sp.from)} → ${(sp.toCountry||sp.to)}</td>
    <td>${fmt(sp.qty)}</td>
    <td>${fmt(sp.shipCost)}</td>
    <td>${sp.departedAt || ''}</td>
    <td>${sp.arrivedAt || ''}</td>
    <td>${days}</td>
    <td>
      <button class="btn outline" data-mark-arrived="${sp.id}">Mark Arrived</button>
      <button class="btn outline" data-edit-transit="${sp.id}">Edit</button>
      <button class="btn outline" data-del-transit="${sp.id}">Delete</button>
    </td>
  </tr>`;
}

/* ---------- Profit by Country (from remittances) ---------- */
function initProfitByCountry() {
  Q('#pcRun')?.addEventListener('click', async () => {
    const s = Q('#pcStart')?.value;
    const e = Q('#pcEnd')?.value;
    const c = Q('#pcCountry')?.value || '';

    const qs = [];
    if (s) qs.push('start=' + s);
    if (e) qs.push('end=' + e);
    // we’ll filter by country client-side because server returns all and we sum
    let r;
    try { r = await api('/api/remittances' + (qs.length ? '?' + qs.join('&') : '')); }
    catch (err) { alert(err.message); return; }

    const rows = (r.remittances || []).filter(x => !c || x.country === c);
    const byC = {};
    rows.forEach(x => {
      byC[x.country] = byC[x.country] || { revenue: 0, ad: 0, extra: 0, pieces: 0 };
      byC[x.country].revenue += (+x.revenue || 0);
      byC[x.country].ad      += (+x.adSpend || 0);
      byC[x.country].extra   += (+x.extraPerPiece || 0) * (+x.pieces || 0);
      byC[x.country].pieces  += (+x.pieces || 0);
    });

    const tb = Q('#profitCountryTable tbody');
    let R=0,A=0,E=0,P=0,PCS=0;
    tb.innerHTML = Object.entries(byC).map(([cc, v]) => {
      const profit = v.revenue - v.ad - v.extra;
      R+=v.revenue; A+=v.ad; E+=v.extra; PCS+=v.pieces; P+=profit;
      return `<tr><td>${cc}</td><td>${fmt(v.revenue)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.extra)}</td><td>${fmt(v.pieces)}</td><td>${fmt(profit)}</td></tr>`;
    }).join('') || `<tr><td colspan="6" class="muted">No data</td></tr>`;

    Q('#pcRevT').textContent = fmt(R);
    Q('#pcAdT').textContent = fmt(A);
    Q('#pcDelT').textContent = fmt(E);
    Q('#pcPiecesT').textContent = fmt(PCS);
    Q('#pcProfitT').textContent = fmt(P);
  });
}

/* ---------- To-Dos (localStorage) ---------- */
function initTodos() {
  const KEY = 'eas_todos';
  const WEEK = 'eas_weekly';

  const load = k => JSON.parse(localStorage.getItem(k) || (k===KEY?'[]':'{}'));
  const save = (k,v) => localStorage.setItem(k, JSON.stringify(v));

  // Quick to-do
  function renderQuick() {
    const list = load(KEY);
    const wrap = Q('#todoList'); if (!wrap) return;
    wrap.innerHTML = list.map(t => `
      <div class="flex">
        <span>${t.done ? '✅ ' : ''}${t.text}</span>
        <button class="btn outline" data-done="${t.id}">${t.done?'Undo':'Done'}</button>
        <button class="btn outline" data-del="${t.id}">Delete</button>
      </div>`).join('');

    Q('#todoAdd')?.addEventListener('click', () => {
      const v = Q('#todoText').value.trim(); if (!v) return;
      list.push({ id: crypto.randomUUID(), text: v, done:false });
      save(KEY, list); Q('#todoText').value=''; renderQuick();
    }, { once:true });

    wrap.onclick = e => {
      if (e.target.dataset.done) {
        const it = list.find(x=>x.id===e.target.dataset.done);
        it.done = !it.done; save(KEY, list); renderQuick();
      } else if (e.target.dataset.del) {
        const i = list.findIndex(x=>x.id===e.target.dataset.del);
        list.splice(i,1); save(KEY, list); renderQuick();
      }
    };
  }
  renderQuick();

  // Weekly grouped tasks
  function renderWeekly() {
    const data = load(WEEK);
    const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    const wrap = Q('#weeklyWrap'); if (!wrap) return;
    wrap.innerHTML = '';
    days.forEach(day => {
      const arr = data[day] || [];
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<div class="h">${day}</div>
        <div class="row">
          <input id="w_${day}" class="input" placeholder="Task"/>
          <button class="btn" data-add="${day}">Add</button>
        </div>
        <div class="list">
          ${arr.map(t => `
            <div class="flex">
              <span>${t.done ? '✅ ' : ''}${t.text}</span>
              <button class="btn outline" data-tgl="${day}|${t.id}">${t.done?'Undo':'Done'}</button>
              <button class="btn outline" data-del="${day}|${t.id}">Delete</button>
            </div>`).join('')}
        </div>`;
      wrap.appendChild(card);
    });

    wrap.onclick = e => {
      if (e.target.dataset.add) {
        const d = e.target.dataset.add;
        const v = Q('#w_'+d).value.trim(); if (!v) return;
        const arr = data[d] || []; arr.push({ id: crypto.randomUUID(), text: v, done:false }); data[d]=arr;
        save(WEEK, data); renderWeekly();
      } else if (e.target.dataset.tgl) {
        const [d,id] = e.target.dataset.tgl.split('|');
        const it = (data[d]||[]).find(x=>x.id===id); it.done=!it.done; save(WEEK, data); renderWeekly();
      } else if (e.target.dataset.del) {
        const [d,id] = e.target.dataset.del.split('|');
        const arr = (data[d]||[]); const i = arr.findIndex(x=>x.id===id); arr.splice(i,1); data[d]=arr; save(WEEK, data); renderWeekly();
      }
    };
  }
  renderWeekly();
}

/* ================================================================
   PRODUCTS (list page)
   ================================================================ */
function initProducts() {
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
    Q('#pName').value = Q('#pSku').value = Q('#pCost').value = Q('#pShip').value = Q('#pMB').value = '';
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
      if (!confirm('Delete product?')) return;
      await api('/api/products/' + del, { method:'DELETE' });
      await preloadProducts(); renderProductsTable();
    }
  };
}

/* ================================================================
   PERFORMANCE
   ================================================================ */
function initPerformance() {
  // Top delivered
  Q('#pfRun')?.addEventListener('click', async () => {
    const quick = Q('#pfQuick')?.value;
    let start = Q('#pfStart')?.value, end = Q('#pfEnd')?.value;
    if (quick && quick !== 'custom') {
      const d = new Date(); d.setDate(d.getDate() - (+quick));
      start = d.toISOString().slice(0,10); end = todayISO();
    }
    const c = Q('#pfCountry')?.value || '';

    const qs = [];
    if (start) qs.push('start='+start);
    if (end)   qs.push('end='+end);

    let r;
    try { r = await api('/api/remittances' + (qs.length?('?'+qs.join('&')):'')); }
    catch (e){ alert(e.message); return; }

    const rows = (r.remittances || []).filter(x => !c || x.country === c);
    const prodMap = Object.fromEntries(state.products.map(p=>[p.id,p]));
    const byPK = {}; // product + country

    rows.forEach(x => {
      const k = `${x.productId}|${x.country}`;
      if (!byPK[k]) byPK[k] = { name: (prodMap[x.productId]?.name || x.productId), country: x.country, pieces:0, ad:0, prodCost:0, profit:0 };
      const pcs = +x.pieces || 0;
      const base = ((+prodMap[x.productId]?.cost_china||0) + (+prodMap[x.productId]?.ship_china_to_kenya||0)) * pcs;
      const extra = (+x.extraPerPiece||0) * pcs;
      const profit = (+x.revenue||0) - (+x.adSpend||0) - base - extra;
      byPK[k].pieces += pcs;
      byPK[k].ad     += (+x.adSpend||0);
      byPK[k].prodCost += base;
      byPK[k].profit += profit;
    });

    const tb = Q('#pfTable tbody');
    tb.innerHTML = Object.values(byPK).sort((a,b)=>b.pieces-a.pieces).map(it =>
      `<tr><td>${it.name}</td><td>${it.country}</td><td>${fmt(it.pieces)}</td><td>${fmt(it.ad)}</td><td>${fmt(it.prodCost)}</td><td>${fmt(it.profit)}</td><td>${it.pieces?fmt(it.profit/it.pieces):'0'}</td></tr>`
    ).join('') || `<tr><td colspan="7" class="muted">No data</td></tr>`;
  });

  // Remittance add
  Q('#rAdd')?.addEventListener('click', async () => {
    const payload = {
      start: Q('#rStart').value, end: Q('#rEnd').value,
      country: Q('#rCountry').value, productId: Q('#rProduct').value,
      orders: +Q('#rOrders').value || 0, pieces: +Q('#rPieces').value || 0,
      revenue: +Q('#rRev').value || 0, adSpend: +Q('#rAds').value || 0,
      extraPerPiece: +Q('#rExtra').value || 0
    };
    if (!payload.start || !payload.end || !payload.country || !payload.productId) {
      return alert('Select dates, country and product');
    }
    try {
      await api('/api/remittances', { method:'POST', body: JSON.stringify(payload) });
      Q('#rMsg').textContent = 'Saved!';
      setTimeout(()=> Q('#rMsg').textContent = '', 1500);
    } catch (e) {
      Q('#rMsg').textContent = e.message;
    }
  });

  // Lifetime product performance (global)
  Q('#lpRun')?.addEventListener('click', async () => {
    const prodId = Q('#lpProduct')?.value || '';
    const s = Q('#lpStart')?.value, e = Q('#lpEnd')?.value;
    const qs = [];
    if (s) qs.push('start='+s);
    if (e) qs.push('end='+e);
    const r = await api('/api/remittances' + (qs.length?('?'+qs.join('&')):''));
    const rows = (r.remittances || []).filter(x => !prodId || x.productId === prodId);

    const prodMap = Object.fromEntries(state.products.map(p=>[p.id,p]));
    const byPK = {}; // product|country
    rows.forEach(x => {
      const key = `${x.productId}|${x.country}`;
      if (!byPK[key]) byPK[key] = { prod: (prodMap[x.productId]?.name || x.productId), country: x.country, rev:0, ad:0, ship:0, base:0, pcs:0, profit:0 };
      const pcs = +x.pieces || 0;
      const basePP = (+prodMap[x.productId]?.cost_china || 0) + (+prodMap[x.productId]?.ship_china_to_kenya || 0);
      const extra = (+x.extraPerPiece || 0) * pcs;

      byPK[key].rev += (+x.revenue || 0);
      byPK[key].ad  += (+x.adSpend || 0);
      byPK[key].ship+= extra;
      byPK[key].base+= basePP * pcs;
      byPK[key].pcs += pcs;
    });
    Object.values(byPK).forEach(v => v.profit = v.rev - v.ad - v.ship - v.base);

    const tb = Q('#lifetimeBody');
    let R=0,A=0,S=0,B=0,P=0,PCS=0;
    tb.innerHTML = Object.values(byPK).map(v=>{
      R+=v.rev; A+=v.ad; S+=v.ship; B+=v.base; P+=v.profit; PCS+=v.pcs;
      return `<tr><td>${v.prod}</td><td>${v.country}</td><td>${fmt(v.rev)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.ship)}</td><td>${fmt(v.base)}</td><td>${fmt(v.pcs)}</td><td>${fmt(v.profit)}</td></tr>`;
    }).join('') || `<tr><td colspan="8" class="muted">No data</td></tr>`;

    Q('#ltRevT').textContent = fmt(R);
    Q('#ltAdT').textContent = fmt(A);
    Q('#ltShipT').textContent = fmt(S);
    Q('#ltBaseT').textContent = fmt(B);
    Q('#ltPiecesT').textContent = fmt(PCS);
    Q('#ltProfitT').textContent = fmt(P);
  });
}

/* ================================================================
   FINANCE
   ================================================================ */
async function initFinance() {
  await loadFinanceCats();

  // add category
  Q('#fcAdd')?.addEventListener('click', async () => {
    const type = Q('#fcType').value, name = Q('#fcName').value.trim();
    if (!name) return;
    await api('/api/finance/categories', { method:'POST', body: JSON.stringify({ type, name }) });
    Q('#fcName').value = '';
    await loadFinanceCats();
  });

  // add entry
  Q('#feAdd')?.addEventListener('click', async () => {
    const date = Q('#feDate').value;
    const category = Q('#feCat').value;
    const amount = +Q('#feAmt').value || 0;
    const note = Q('#feNote').value;
    if (!date || !category) return alert('Select date & category');

    // decide type by category bucket
    const type = state.categories.credit.includes(category) ? 'credit' : 'debit';
    await api('/api/finance/entries', { method:'POST', body: JSON.stringify({ date, type, category, amount, note }) });

    Q('#feAmt').value = Q('#feNote').value = '';
    await renderFinancePeriod();
  });

  // filter run
  Q('#feRun')?.addEventListener('click', renderFinancePeriod);

  // initial
  await renderFinancePeriod();
}

async function loadFinanceCats() {
  try {
    const cats = await api('/api/finance/categories');
    state.categories = cats;

    // show chips with delete
    const deb = Q('#fcDebitList');
    const cre = Q('#fcCreditList');
    if (deb) deb.innerHTML = cats.debit.map(c => `<span class="chip" data-del-debit="${c}">${c} ✕</span>`).join('') || '—';
    if (cre) cre.innerHTML = cats.credit.map(c => `<span class="chip" data-del-credit="${c}">${c} ✕</span>`).join('') || '—';

    deb?.addEventListener('click', async (e) => {
      const name = e.target.dataset.delDebit; if (!name) return;
      await api(`/api/finance/categories?type=debit&name=${encodeURIComponent(name)}`, { method: 'DELETE' });
      await loadFinanceCats();
    });
    cre?.addEventListener('click', async (e) => {
      const name = e.target.dataset.delCredit; if (!name) return;
      await api(`/api/finance/categories?type=credit&name=${encodeURIComponent(name)}`, { method: 'DELETE' });
      await loadFinanceCats();
    });

    // fill category select
    const all = [...cats.debit, ...cats.credit].sort();
    const sel = Q('#feCat');
    if (sel) sel.innerHTML = `<option value="" disabled selected>Select category</option>` + all.map(c => `<option>${c}</option>`).join('');
  } catch {}
}

async function renderFinancePeriod() {
  const s = Q('#fes')?.value, e = Q('#fee')?.value;
  const qs = [];
  if (s) qs.push('start='+s);
  if (e) qs.push('end='+e);
  const r = await api('/api/finance/entries' + (qs.length?('?'+qs.join('&')):''));
  const entries = r.entries || [];

  Q('#feRunning') && (Q('#feRunning').textContent = 'Running Balance: ' + fmt(r.running || 0) + ' USD');
  Q('#feBalance') && (Q('#feBalance').textContent = 'Balance for period: ' + fmt(r.balance || 0) + ' USD');

  const tb = Q('#feTable tbody');
  if (tb) {
    tb.innerHTML = entries.map(x =>
      `<tr>
        <td>${x.date}</td><td>${x.type}</td><td>${x.category}</td><td>${fmt(x.amount)}</td><td>${x.note||''}</td>
        <td><button class="btn outline" data-del-entry="${x.id}">Delete</button></td>
      </tr>`
    ).join('') || `<tr><td colspan="6" class="muted">No entries</td></tr>`;

    tb.onclick = async e => {
      const id = e.target.dataset.delEntry;
      if (!id) return;
      await api('/api/finance/entries/' + id, { method:'DELETE' });
      await renderFinancePeriod();
    };
  }
}

/* ================================================================
   SETTINGS
   ================================================================ */
function initSettings() {
  // Countries
  Q('#ctyAdd')?.addEventListener('click', async () => {
    const name = Q('#cty').value.trim(); if (!name) return;
    await api('/api/countries', { method:'POST', body: JSON.stringify({ name }) });
    const m = await api('/api/meta'); state.countries = m.countries || [];
    Q('#cty').value = '';
    fillGlobalSelects(); renderCountryChips();
  });
  renderCountryChips();

  // Edit product info
  const sel = Q('#editProdSel') || Q('#epSelect');
  if (sel) {
    sel.onchange = () => {
      const p = state.products.find(x => x.id === sel.value);
      if (!p) return;
      Q('#epName').value = p.name;
      Q('#epSku').value = p.sku || '';
      Q('#epCost').value = p.cost_china || 0;
      Q('#epShip').value = p.ship_china_to_kenya || 0;
      Q('#epMB').value = p.margin_budget || 0;
    };
    Q('#epSave')?.addEventListener('click', async () => {
      const id = sel.value; if (!id) return alert('Select a product');
      const payload = {
        name: Q('#epName').value.trim(),
        sku: Q('#epSku').value.trim(),
        cost_china: +Q('#epCost').value || 0,
        ship_china_to_kenya: +Q('#epShip').value || 0,
        margin_budget: +Q('#epMB').value || 0
      };
      await api('/api/products/' + id, { method:'PUT', body: JSON.stringify(payload) });
      await preloadProducts();
      alert('Saved');
    });
  }

  // Manual Save / Restore
  Q('#ssSave')?.addEventListener('click', async () => {
    const nameEl = Q('#snapName');
    const name = (nameEl?.value || '').trim() || undefined;
    try {
      await api('/api/snapshots', { method:'POST', body: JSON.stringify({ name }) });
      nameEl && (nameEl.value = '');
      await renderSnapshots();
      alert('Snapshot saved');
    } catch (e) { alert(e.message); }
  });
  renderSnapshots();
}

function renderCountryChips() {
  const list = Q('#ctyList'); if (!list) return;
  list.innerHTML = state.countries.map(c => `<span class="chip" data-del-country="${c}">${c} ✕</span>`).join('') || '—';
  list.onclick = async e => {
    const c = e.target.dataset.delCountry;
    if (!c) return;
    if (!confirm(`Delete country "${c}"?`)) return;
    await api('/api/countries/' + encodeURIComponent(c), { method:'DELETE' });
    const m = await api('/api/meta'); state.countries = m.countries || [];
    fillGlobalSelects(); renderCountryChips();
  };
}

async function renderSnapshots() {
  const box = Q('#ssList'); if (!box) return;
  const r = await api('/api/snapshots');
  box.innerHTML = (r.snapshots || []).map(s => `
    <tr>
      <td>${s.name}</td>
      <td>${s.file.replace(/^.*data[\\/]/,'')}</td>
      <td>
        <button class="btn outline" data-push="${s.file}">Push</button>
        <button class="btn outline" data-del-snap="${s.id}">Delete</button>
      </td>
    </tr>`).join('') || `<tr><td colspan="3" class="muted">No snapshots yet</td></tr>`;

  box.onclick = async e => {
    if (e.target.dataset.push) {
      try {
        await api('/api/snapshots/restore', { method:'POST', body: JSON.stringify({ file: e.target.dataset.push }) });
        alert('System restored from snapshot');
        location.reload();
      } catch (err) { alert(err.message); }
    } else if (e.target.dataset.delSnap) {
      try {
        await api('/api/snapshots/' + e.target.dataset.delSnap, { method:'DELETE' });
        await renderSnapshots();
      } catch (err) { alert(err.message); }
    }
  };
}

/* ================================================================
   PRODUCT PAGE
   ================================================================ */
async function loadProduct(id) {
  await preloadProducts();
  state.product = state.products.find(p => p.id === id) || null;
}

function renderProductPage() {
  if (!state.product) { alert('Product not found'); location.href='/'; return; }
  // This page uses product.html markup (already in your build).
  // We only need to bind handlers + populate sections.
  bindProductHandlers();
  refreshProductSections();
}

function bindProductHandlers() {
  // Manual per-country budget (editable, not auto)
  Q('#pdPBSave')?.addEventListener('click', async () => {
    const country = Q('#pdPBCountry')?.value;
    const val = +Q('#pdPBValue')?.value || 0;
    if (!country) return;
    const p = { budgets: state.product.budgets || {} };
    p.budgets[country] = val;
    await api('/api/products/' + state.product.id, { method:'PUT', body: JSON.stringify(p) });
    await loadProduct(state.product.id);
    renderPBTable();
  });

  // Daily ad spend (replace)
  Q('#pdAdSave')?.addEventListener('click', async () => {
    const payload = {
      productId: state.product.id,
      country: Q('#pdAdCountry')?.value,
      platform: Q('#pdAdPlatform')?.value,
      amount: +Q('#pdAdAmount')?.value || 0
    };
    if (!payload.country || !payload.platform) return alert('Pick country & platform');
    await api('/api/adspend', { method:'POST', body: JSON.stringify(payload) });
    refreshProductSections();
  });

  // Product shipments
  Q('#pdMvAdd')?.addEventListener('click', async () => {
    const payload = {
      productId: state.product.id,
      fromCountry: Q('#pdMvFrom')?.value,
      toCountry: Q('#pdMvTo')?.value,
      qty: +Q('#pdMvQty')?.value || 0,
      shipCost: +Q('#pdMvShip')?.value || 0,
      departedAt: todayISO(),
      arrivedAt: null
    };
    if (!payload.fromCountry || !payload.toCountry) return alert('Select both countries');
    await api('/api/shipments', { method:'POST', body: JSON.stringify(payload) });
    refreshProductSections();
  });

  // Lifetime filter
  Q('#pdLPRun')?.addEventListener('click', renderProductLifetime);

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

async function refreshProductSections() {
  await loadProduct(state.product.id);
  renderProductStockAd();
  renderPBTable();
  renderProductAdList();
  renderProductTransit();
  renderProductLifetime();
  renderInfluencers();
}

/* -- product: stock & ad spend (this product only) -- */
async function renderProductStockAd() {
  // Table IDs expected in product.html:
  // #pdStockBody, #pdStockTotal, #pdAdTotal, #pdTransitBadge
  const tb = Q('#pdStockBody'); if (!tb) return;

  const per = {}; state.countries.forEach(c => per[c] = { stock: 0, ad: 0 });

  const s = await api('/api/shipments');
  (s.shipments || []).filter(x=>x.productId===state.product.id && x.arrivedAt).forEach(sp => {
    const to = sp.toCountry || sp.to, from = sp.fromCountry || sp.from, q = (+sp.qty||0);
    if (to) { per[to] = per[to] || { stock:0, ad:0 }; per[to].stock += q; }
    if (from){ per[from]= per[from]|| { stock:0, ad:0 }; per[from].stock -= q; }
  });

  const r = await api('/api/remittances');
  (r.remittances || []).filter(x=>x.productId===state.product.id).forEach(rr => {
    per[rr.country] = per[rr.country] || { stock:0, ad:0 };
    per[rr.country].stock -= (+rr.pieces||0);
  });

  const a = await api('/api/adspend');
  (a.adSpends || []).filter(x=>x.productId===state.product.id).forEach(ad => {
    per[ad.country] = per[ad.country] || { stock:0, ad:0 };
    per[ad.country].ad += (+ad.amount||0);
  });

  let st=0, at=0;
  tb.innerHTML = Object.entries(per).map(([c,v])=>{
    st += v.stock; at += v.ad;
    return `<tr><td>${c}</td><td>${fmt(v.stock)}</td><td>${fmt(v.ad)}</td></tr>`;
  }).join('');
  Q('#pdStockTotal') && (Q('#pdStockTotal').textContent = fmt(st));
  Q('#pdAdTotal') && (Q('#pdAdTotal').textContent = fmt(at));

  // Transit pieces of this product
  const transit = (s.shipments || []).filter(x=>x.productId===state.product.id && !x.arrivedAt)
                   .reduce((t,x)=>t+(+x.qty||0),0);
  Q('#pdTransitBadge') && (Q('#pdTransitBadge').textContent = `Transit total: ${fmt(transit)}`);
}

/* -- product: manual budget table -- */
function renderPBTable() {
  const tb = Q('#pdPBBBody'); if (!tb) return;
  const map = state.product.budgets || {};
  tb.innerHTML = state.countries.map(c => `
    <tr><td>${c}</td><td>${fmt(map[c] || 0)}</td>
      <td><button class="btn outline" data-clear-b="${c}">Clear</button></td></tr>
  `).join('') || `<tr><td colspan="3" class="muted">No budgets</td></tr>`;

  tb.onclick = async e => {
    const c = e.target.dataset.clearB;
    if (!c) return;
    const p = { budgets: state.product.budgets || {} }; delete p.budgets[c];
    await api('/api/products/' + state.product.id, { method:'PUT', body: JSON.stringify(p) });
    await loadProduct(state.product.id); renderPBTable();
  };
}

/* -- product: ad list (this product) -- */
async function renderProductAdList() {
  const tb = Q('#pdAdBody'); if (!tb) return;
  const a = await api('/api/adspend');
  const list = (a.adSpends || []).filter(x=>x.productId===state.product.id);
  tb.innerHTML = list.map(x => `<tr><td>${x.country}</td><td>${x.platform}</td><td>${fmt(x.amount)}</td></tr>`).join('') ||
    `<tr><td colspan="3" class="muted">No ad spend yet</td></tr>`;
}

/* -- product: transit tables (this product only) -- */
async function renderProductTransit() {
  const s = await api('/api/shipments');
  const list = (s.shipments || []).filter(x=>x.productId===state.product.id);

  const ck = list.filter(sp =>
    (sp.fromCountry||sp.from||'').toLowerCase()==='china' &&
    (sp.toCountry||sp.to||'').toLowerCase()==='kenya'
  );
  const ic = list.filter(sp => !ck.includes(sp));

  const tb1 = Q('#pdShipCKBody'), tb2 = Q('#pdShipICBody');
  const row = sp => {
    const days = sp.arrivedAt && sp.departedAt
      ? Math.max(0, Math.round((+new Date(sp.arrivedAt) - +new Date(sp.departedAt)) / 86400000)) : '';
    return `<tr>
      <td>${sp.id}</td><td>${(sp.fromCountry||sp.from)} → ${(sp.toCountry||sp.to)}</td>
      <td>${fmt(sp.qty)}</td><td>${fmt(sp.shipCost)}</td>
      <td>${sp.departedAt||''}</td><td>${sp.arrivedAt||''}</td><td>${days}</td>
      <td>
        <button class="btn outline" data-mark-arrived="${sp.id}">Mark Arrived</button>
        <button class="btn outline" data-edit-transit="${sp.id}">Edit</button>
        <button class="btn outline" data-del-transit="${sp.id}">Delete</button>
      </td>
    </tr>`;
  };

  if (tb1) tb1.innerHTML = ck.map(row).join('') || `<tr><td colspan="8" class="muted">No shipments</td></tr>`;
  if (tb2) tb2.innerHTML = ic.map(row).join('') || `<tr><td colspan="8" class="muted">No shipments</td></tr>`;

  // reuse handlers
  QA('[data-mark-arrived]').forEach(b => b.onclick = async () => {
    const id = b.dataset.markArrived;
    const date = prompt('Arrival date (YYYY-MM-DD)', todayISO()); if (!date) return;
    await api('/api/shipments/' + id, { method:'PUT', body: JSON.stringify({ arrivedAt: date }) });
    renderProductTransit(); renderProductStockAd();
  });
  QA('[data-del-transit]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete shipment?')) return;
    await api('/api/shipments/' + b.dataset.delTransit, { method:'DELETE' });
    renderProductTransit();
  });
  QA('[data-edit-transit]').forEach(b => b.onclick = async () => {
    const id = b.dataset.editTransit;
    const qty = +prompt('New qty?');
    const shipCost = +prompt('New shipping cost?');
    await api('/api/shipments/' + id, { method:'PUT', body: JSON.stringify({ qty, shipCost }) });
    renderProductTransit();
  });
}

/* -- product: lifetime (this product) -- */
async function renderProductLifetime() {
  const s = Q('#pdLPStart')?.value, e = Q('#pdLPEnd')?.value;
  const qs = [];
  if (s) qs.push('start='+s);
  if (e) qs.push('end='+e);
  const r = await api('/api/remittances' + (qs.length?('?'+qs.join('&')):''));
  const rows = (r.remittances || []).filter(x=>x.productId===state.product.id);

  const prod = state.product;
  const basePP = (+prod.cost_china||0) + (+prod.ship_china_to_kenya||0);

  const byC = {};
  rows.forEach(x => {
    const c = x.country;
    if (!byC[c]) byC[c] = { rev:0, ad:0, ship:0, base:0, pcs:0, profit:0 };
    const pcs = +x.pieces || 0;
    byC[c].rev += (+x.revenue || 0);
    byC[c].ad  += (+x.adSpend || 0);
    byC[c].ship+= (+x.extraPerPiece || 0) * pcs;
    byC[c].base+= basePP * pcs;
    byC[c].pcs += pcs;
  });
  Object.values(byC).forEach(v => v.profit = v.rev - v.ad - v.ship - v.base);

  const tb = Q('#pdLPBody'); if (!tb) return;
  let R=0,A=0,S=0,B=0,PCS=0,P=0;
  tb.innerHTML = Object.entries(byC).map(([c,v])=>{
    R+=v.rev; A+=v.ad; S+=v.ship; B+=v.base; PCS+=v.pcs; P+=v.profit;
    return `<tr><td>${c}</td><td>${fmt(v.rev)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.ship)}</td><td>${fmt(v.base)}</td><td>${fmt(v.pcs)}</td><td>${fmt(v.profit)}</td></tr>`;
  }).join('') || `<tr><td colspan="7" class="muted">No data</td></tr>`;
  Q('#pdLPRevT') && (Q('#pdLPRevT').textContent = fmt(R));
  Q('#pdLPAdT') && (Q('#pdLPAdT').textContent = fmt(A));
  Q('#pdLPShipT') && (Q('#pdLPShipT').textContent = fmt(S));
  Q('#pdLPBaseT') && (Q('#pdLPBaseT').textContent = fmt(B));
  Q('#pdLPPcsT') && (Q('#pdLPPcsT').textContent = fmt(PCS));
  Q('#pdLPProfitT') && (Q('#pdLPProfitT').textContent = fmt(P));
}

/* -- product: influencers -- */
async function renderInfluencers() {
  const sel = Q('#pdInfSelect'); const tb = Q('#pdInfBody'); const totalEl = Q('#pdInfTotal');
  if (!sel && !tb) return;

  const infs = await api('/api/influencers');
  const spends = await api('/api/influencers/spend');

  if (sel) sel.innerHTML = (infs.influencers || []).map(i => `<option value="${i.id}">${i.name}</option>`).join('');

  const s = Q('#pdInfStart')?.value, e = Q('#pdInfEnd')?.value, c = Q('#pdInfFilterCountry')?.value || '';
  const list = (spends.spends || []).filter(x => x.productId === state.product.id)
    .filter(x => (!c || x.country === c))
    .filter(x => (!s || x.date >= s) && (!e || x.date <= e));

  const byId = Object.fromEntries((infs.influencers || []).map(i => [i.id, i]));
  let total = 0;
  if (tb) {
    tb.innerHTML = list.map(x => {
      total += (+x.amount || 0);
      const i = byId[x.influencerId] || {};
      return `<tr>
        <td>${x.date}</td><td>${x.country}</td><td>${i.name || '-'}</td><td>${i.social || '-'}</td><td>${fmt(x.amount)}</td>
        <td><button class="btn outline" data-del-infsp="${x.id}">Delete</button></td>
      </tr>`;
    }).join('') || `<tr><td colspan="6" class="muted">No spends</td></tr>`;

    tb.onclick = async e => {
      if (e.target.dataset.delInfsp) {
        await api('/api/influencers/spend/' + e.target.dataset.delInfsp, { method:'DELETE' });
        renderInfluencers();
      }
    };
  }
  if (totalEl) totalEl.textContent = fmt(total);
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
    if (v === 'home') { renderKpis(); renderStockAndSpendByCountry(); renderTransitTables(); } // keep fresh
  }));
}

/* ================================================================
   BOOT
   ================================================================ */
gate();
