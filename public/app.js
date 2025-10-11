/* =========================
   EAS Tracker – Front-end
   Works for both index.html and product.html
   ========================= */

/* ---------- helpers ---------- */
const Q = (s, r = document) => r.querySelector(s);
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

/* ---------- global state ---------- */
const state = {
  view: 'home',
  countries: [],
  products: [],
  categories: { debit: [], credit: [] },
  product: null,          // current product in product.html
  productId: getQuery('id'),
  weekStart: null         // Monday ISO for weekly grid
};

/* ---------- auth + boot ---------- */
async function gate() {
  try {
    const meta = await api('/api/meta');
    state.countries = meta.countries || [];
    Q('#login')?.classList.add('hide');
    Q('#main')?.removeAttribute('style');

    await preloadProducts();
    fillGlobalSelects();
    initNav();

    const isProductPage = !!state.productId;
    if (isProductPage) {
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
    // show login
    Q('#login')?.classList.remove('hide');
    Q('#main')?.setAttribute('style', 'display:none');
  }
}

Q('#loginBtn')?.addEventListener('click', async () => {
  try {
    const pass = Q('#pw').value;
    if (!pass) return alert('Enter password');
    await api('/api/auth', { method: 'POST', body: JSON.stringify({ password: pass }) });
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
    state.products = r.products || [];
  } catch { state.products = []; }
}

function fillGlobalSelects() {
  // Countries everywhere
  const cs = [
    '#adCountry', '#mvFrom', '#mvTo', '#rCountry', '#pfCountry', '#pcCountry'
  ];
  cs.forEach(sel => {
    QA(sel).forEach(el => {
      el.innerHTML = `<option value="">${el.id==='pcCountry'?'All countries':''}</option>` +
        state.countries.map(c => `<option value="${c}">${c}</option>`).join('');
    });
  });

  // Products everywhere
  const ps = ['#adProduct', '#mvProduct', '#rProduct', '#lpProduct'];
  ps.forEach(sel => {
    QA(sel).forEach(el => {
      el.innerHTML = (el.id==='lpProduct' ? `<option value="">All products</option>` : ``) +
        state.products.map(p => `<option value="${p.id}">${p.name}${p.sku ? ' (' + p.sku + ')' : ''}</option>`).join('');
    });
  });
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
  Q('#kpiCountries') && (Q('#kpiCountries').textContent = state.countries.length);

  // transit count
  try {
    const s = await api('/api/shipments');
    const live = (s.shipments || []).filter(x => !x.arrivedAt).length;
    Q('#kpiTransit') && (Q('#kpiTransit').textContent = live);
  } catch { Q('#kpiTransit') && (Q('#kpiTransit').textContent = '—'); }

  // total ad spend from daily adSpend
  try {
    const a = await api('/api/adspend');
    const total = (a.adSpends || []).reduce((t, x) => t + (+x.amount || 0), 0);
    Q('#kpiAdSpend') && (Q('#kpiAdSpend').textContent = fmt(total) + ' USD');
  } catch { Q('#kpiAdSpend') && (Q('#kpiAdSpend').textContent = '—'); }

  // delivered (sum of all)
  try {
    const r = await api('/api/deliveries');
    const sum = (r.deliveries || []).reduce((t, x) => t + (+x.delivered || 0), 0);
    Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = fmt(sum));
  } catch { Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = '—'); }
}

/* ---- Stock & Spend by Country (global) ---- */
async function renderStockAndSpendByCountry() {
  const table = Q('#stockByCountryTbl'); if (!table) return;
  const body = table.querySelector('tbody');
  const stockTotal = Q('#stockTotal'), adTotal = Q('#adTotal');

  const per = {};
  state.countries.forEach(c => per[c] = { stock: 0, ad: 0 });

  // arrived shipments add to destination and deduct from origin
  try {
    const s = await api('/api/shipments');
    (s.shipments || []).forEach(sp => {
      if (sp.arrivedAt) {
        const to = sp.toCountry || sp.to;
        const from = sp.fromCountry || sp.from;
        per[to] = per[to] || { stock: 0, ad: 0 };
        per[to].stock += (+sp.qty || 0);
        if (from) {
          per[from] = per[from] || { stock: 0, ad: 0 };
          per[from].stock -= (+sp.qty || 0);
        }
      }
    });
  } catch {}

  // remittances subtract pieces from that country (delivered)
  try {
    const r = await api('/api/remittances');
    (r.remittances || []).forEach(rr => {
      per[rr.country] = per[rr.country] || { stock: 0, ad: 0 };
      per[rr.country].stock -= (+rr.pieces || 0);
    });
  } catch {}

  // ad spend from adspend
  try {
    const a = await api('/api/adspend');
    (a.adSpends || []).forEach(x => {
      per[x.country] = per[x.country] || { stock: 0, ad: 0 };
      per[x.country].ad += (+x.amount || 0);
    });
  } catch {}

  let st = 0, at = 0;
  body.innerHTML = Object.entries(per).map(([c, v]) => {
    st += v.stock; at += v.ad;
    return `<tr><td>${c}</td><td>${fmt(v.stock)}</td><td>${fmt(v.ad)}</td></tr>`;
  }).join('');
  stockTotal.textContent = fmt(st);
  adTotal.textContent = fmt(at);
}

/* ---- Weekly Delivered grid (Mon–Sun x Countries) ---- */
function mondayOf(dateISO) {
  const d = new Date(dateISO);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}
function weekDays(baseMondayISO) {
  const d0 = new Date(baseMondayISO);
  return [...Array(7)].map((_, i) => {
    const d = new Date(d0); d.setDate(d0.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

async function initWeeklyDelivered() {
  const grid = Q('#weeklyGrid'); if (!grid) return;

  state.weekStart = mondayOf(todayISO());
  renderWeeklyGrid();

  Q('#weeklyPrev')?.addEventListener('click', () => {
    const d = new Date(state.weekStart); d.setDate(d.getDate() - 7);
    state.weekStart = d.toISOString().slice(0,10);
    renderWeeklyGrid();
  });
  Q('#weeklyNext')?.addEventListener('click', () => {
    const d = new Date(state.weekStart); d.setDate(d.getDate() + 7);
    state.weekStart = d.toISOString().slice(0,10);
    renderWeeklyGrid();
  });

  Q('#wdSave')?.addEventListener('click', async () => {
    // collect non-zero cells and POST as individual records
    const inputs = QA('.wd-cell', grid);
    try {
      for (const inp of inputs) {
        const v = +inp.value || 0;
        if (v > 0) {
          await api('/api/deliveries', {
            method: 'POST',
            body: JSON.stringify({
              date: inp.dataset.date,
              country: inp.dataset.country,
              delivered: v
            })
          });
        }
      }
      alert('Weekly deliveries saved');
      renderKpis();
    } catch (e) {
      alert('Save failed: ' + e.message);
    }
  });

  Q('#wdReset')?.addEventListener('click', () => {
    QA('.wd-cell', grid).forEach(inp => inp.value = '');
    computeWeeklyTotals();
  });

  grid.addEventListener('input', e => {
    if (e.target.classList.contains('wd-cell')) computeWeeklyTotals();
  });
}

async function renderWeeklyGrid() {
  const grid = Q('#weeklyGrid');
  const days = weekDays(state.weekStart);
  const head = `<tr><th>Country</th>${days.map(d=>`<th>${new Date(d).toLocaleDateString(undefined,{weekday:'short'})}<br>${d}</th>`).join('')}<th>Total</th></tr>`;
  const bodyRows = state.countries.map(c => {
    const cells = days.map(d => `<td><input class="wd-cell" data-country="${c}" data-date="${d}" type="number" min="0" placeholder="0"/></td>`).join('');
    return `<tr data-row="${c}"><td>${c}</td>${cells}<td class="row-total">0</td></tr>`;
  }).join('');

  grid.innerHTML = `<thead>${head}</thead><tbody>${bodyRows}</tbody>
  <tfoot><tr class="totals"><th>All Countries</th>${days.map(()=>'<th class="col-total">0</th>').join('')}<th id="wdGrand">0</th></tr></tfoot>`;

  Q('#weeklyRange').textContent = `Week: ${days[0]} → ${days[6]}`;

  // preload data for those 7 days
  try {
    const r = await api('/api/deliveries');
    const byKey = {};
    (r.deliveries || []).forEach(x => byKey[`${x.country}|${x.date}`] = +x.delivered || 0);
    QA('.wd-cell', grid).forEach(inp => {
      const k = `${inp.dataset.country}|${inp.dataset.date}`;
      if (byKey[k] != null) inp.value = byKey[k];
    });
  } catch {}
  computeWeeklyTotals();
}

function computeWeeklyTotals() {
  // row totals
  QA('tr[data-row]').forEach(tr => {
    const t = QA('.wd-cell', tr).reduce((s, el) => s + (+el.value || 0), 0);
    Q('.row-total', tr).textContent = fmt(t);
  });
  // column totals
  const cols = QA('thead th', Q('#weeklyGrid')).length - 2; // exclude country & total
  let grand = 0;
  for (let i = 0; i < cols; i++) {
    let sum = 0;
    QA('tr[data-row]').forEach(tr => {
      const inp = QA('.wd-cell', tr)[i];
      sum += (+inp.value || 0);
    });
    QA('.col-total')[i].textContent = fmt(sum);
    grand += sum;
  }
  Q('#wdGrand').textContent = fmt(grand);
}

/* ---- Daily Ad Spend (replace by product/country/platform) ---- */
function initDailyAdSpend() {
  Q('#adAdd')?.addEventListener('click', async () => {
    const payload = {
      productId: Q('#adProduct')?.value,
      country: Q('#adCountry')?.value,
      platform: Q('#adPlatform')?.value,
      amount: +Q('#adAmount')?.value || 0
    };
    if (!payload.productId || !payload.country || !payload.platform) return alert('Missing fields');
    try {
      await api('/api/adspend', { method: 'POST', body: JSON.stringify(payload) });
      alert('Saved');
      renderKpis();
      renderStockAndSpendByCountry();
    } catch (e) { alert(e.message); }
  });
}

/* ---- Movements (create shipment record) ---- */
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
      await api('/api/shipments', { method: 'POST', body: JSON.stringify(payload) });
      alert('Movement added');
      renderTransitTables();
    } catch (e) { alert(e.message); }
  });
}

/* ---- Transit tables + mark arrived/delete/edit ---- */
async function renderTransitTables() {
  const s = await api('/api/shipments');
  const list = (s.shipments || []).filter(x => !x.arrivedAt); // home shows only in-transit
  const productsById = Object.fromEntries((state.products || []).map(p => [p.id, p.name]));

  // China → Kenya
  const ckb = Q('#shipCKBody'); if (ckb) {
    const ck = list.filter(sp =>
      (sp.fromCountry || sp.from || '').toLowerCase() === 'china' &&
      (sp.toCountry || sp.to || '').toLowerCase() === 'kenya'
    );
    ckb.innerHTML = ck.map(sp => rowTransit(sp, productsById)).join('') || '<tr><td colspan="8" class="muted">No transit</td></tr>';
  }

  // Inter-country (others)
  const icb = Q('#shipICBody'); if (icb) {
    const ic = list.filter(sp => !(
      (sp.fromCountry || sp.from || '').toLowerCase() === 'china' &&
      (sp.toCountry || sp.to || '').toLowerCase() === 'kenya'
    ));
    icb.innerHTML = ic.map(sp => rowTransit(sp, productsById)).join('') || '<tr><td colspan="8" class="muted">No transit</td></tr>';
  }

  // actions
  QA('[data-mark-arrived]').forEach(b => b.onclick = async () => {
    const id = b.dataset.markArrived;
    const date = prompt('Arrival date (YYYY-MM-DD)', todayISO());
    if (!date) return;
    try { await api('/api/shipments/' + id, { method: 'PUT', body: JSON.stringify({ arrivedAt: date }) }); }
    catch (e) { return alert(e.message); }
    renderTransitTables();
    renderStockAndSpendByCountry();
  });
  QA('[data-del-transit]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete shipment?')) return;
    await api('/api/shipments/' + b.dataset.delTransit, { method: 'DELETE' });
    renderTransitTables();
  });
  QA('[data-edit-transit]').forEach(b => b.onclick = async () => {
    const id = b.dataset.editTransit;
    const qty = +prompt('New qty?', '') || 0;
    const shipCost = +prompt('New shipping cost?', '') || 0;
    await api('/api/shipments/' + id, { method:'PUT', body: JSON.stringify({ qty, shipCost }) });
    renderTransitTables();
  });
}

function rowTransit(sp, productsById) {
  const name = productsById[sp.productId] || sp.productId;
  return `<tr>
    <td>${sp.id}</td>
    <td>${name}</td>
    <td>${(sp.fromCountry||sp.from)} → ${(sp.toCountry||sp.to)}</td>
    <td>${fmt(sp.qty)}</td>
    <td>${fmt(sp.shipCost)}</td>
    <td>${sp.departedAt || ''}</td>
    <td>${sp.arrivedAt || ''}</td>
    <td>
      <button class="btn outline" data-mark-arrived="${sp.id}">Mark Arrived</button>
      <button class="btn outline" data-edit-transit="${sp.id}">Edit</button>
      <button class="btn outline" data-del-transit="${sp.id}">Delete</button>
    </td>
  </tr>`;
}

/* ---- Profit by Country (from remittances) ---- */
function initProfitByCountry() {
  Q('#pcRun')?.addEventListener('click', async () => {
    const s = Q('#pcStart')?.value, e = Q('#pcEnd')?.value, c = Q('#pcCountry')?.value || '';
    const qs = [];
    if (s) qs.push('start=' + s);
    if (e) qs.push('end=' + e);
    if (c) qs.push('country=' + encodeURIComponent(c));
    try {
      const r = await api('/api/remittances' + (qs.length ? '?' + qs.join('&') : ''));
      const byC = {};
      (r.remittances || []).forEach(x => {
        if (c && x.country !== c) return;
        byC[x.country] = byC[x.country] || { revenue: 0, ad: 0, extra: 0, pieces: 0 };
        byC[x.country].revenue += +x.revenue || 0;
        byC[x.country].ad += +x.adSpend || 0;
        byC[x.country].extra += (+x.extraPerPiece || 0) * (+x.pieces || 0);
        byC[x.country].pieces += +x.pieces || 0;
      });
      const tb = Q('#profitCountryTable tbody');
      let R=0,A=0,E=0,P=0,PCS=0;
      tb.innerHTML = Object.entries(byC).map(([cc, v]) => {
        const profit = v.revenue - v.ad - v.extra;
        R+=v.revenue; A+=v.ad; E+=v.extra; PCS+=v.pieces; P+=profit;
        return `<tr><td>${cc}</td><td>${fmt(v.revenue)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.extra)}</td><td>${fmt(v.pieces)}</td><td>${fmt(profit)}</td></tr>`;
      }).join('') || `<tr><td colspan="6" class="muted">No data</td></tr>`;
    } catch (e) { alert(e.message); }
  });
}

/* ---- To-Dos (localStorage) ---- */
function initTodos() {
  const KEY = 'eas_todos';
  const WEEK = 'eas_weekly';
  const load = k => JSON.parse(localStorage.getItem(k) || (k===KEY?'[]':'{}'));
  const save = (k,v) => localStorage.setItem(k, JSON.stringify(v));

  // quick list
  const renderQuick = () => {
    const list = load(KEY);
    const ul = Q('#todoList'); if (!ul) return;
    ul.innerHTML = list.map(t =>
      `<div class="flex"><span>${t.done?'✅ ':''}${t.text}</span>
       <button class="btn outline" data-done="${t.id}">${t.done?'Undo':'Done'}</button>
       <button class="btn outline" data-del="${t.id}">Delete</button></div>`).join('');
    Q('#todoAdd')?.addEventListener('click', () => {
      const v = Q('#todoText').value.trim(); if (!v) return;
      list.push({ id: crypto.randomUUID(), text: v, done:false }); save(KEY, list); Q('#todoText').value=''; renderQuick();
    }, { once:true });
    ul.onclick = e => {
      if (e.target.dataset.done) {
        const it = list.find(x=>x.id===e.target.dataset.done); it.done=!it.done; save(KEY,list); renderQuick();
      } else if (e.target.dataset.del) {
        const i = list.findIndex(x=>x.id===e.target.dataset.del); list.splice(i,1); save(KEY,list); renderQuick();
      }
    };
  };
  renderQuick();

  // weekly boards
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const renderWeekly = () => {
    const data = load(WEEK);
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
        <div class="list">${arr.map(t=>`
          <div class="flex">
            <span>${t.done?'✅ ':''}${t.text}</span>
            <button class="btn outline" data-tgl="${day}|${t.id}">${t.done?'Undo':'Done'}</button>
            <button class="btn outline" data-del="${day}|${t.id}">Delete</button>
          </div>`).join('')}</div>`;
      wrap.appendChild(card);
    });

    wrap.onclick = e => {
      if (e.target.dataset.add) {
        const d = e.target.dataset.add;
        const v = Q('#w_' + d).value.trim(); if (!v) return;
        const arr = data[d] || []; arr.push({ id: crypto.randomUUID(), text: v, done:false }); data[d] = arr;
        save(WEEK, data); renderWeekly();
      }
      if (e.target.dataset.tgl) {
        const [d,id] = e.target.dataset.tgl.split('|');
        const it = (data[d]||[]).find(x=>x.id===id); it.done=!it.done; save(WEEK, data); renderWeekly();
      }
      if (e.target.dataset.del) {
        const [d,id] = e.target.dataset.del.split('|');
        const arr = (data[d]||[]); const i = arr.findIndex(x=>x.id===id); arr.splice(i,1);
        data[d]=arr; save(WEEK, data); renderWeekly();
      }
    };
  };
  renderWeekly();
}

/* ========================================================================
   PRODUCTS (index.html list view)
   ======================================================================== */
function initProducts() {
  // Add
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
    Q('#pName').value = Q('#pSku').value = Q('#pCost').value = Q('#pShip').value = Q('#pMB').value = '';
    await preloadProducts();
    fillGlobalSelects();
    renderProductsTable();
    renderKpis();
    alert('Product added');
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

/* ========================================================================
   PERFORMANCE
   ======================================================================== */
function initPerformance() {
  // Top delivered (from remittances)
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
    if (end) qs.push('end='+end);
    if (c) qs.push('country='+encodeURIComponent(c));
    const r = await api('/api/remittances' + (qs.length?('?'+qs.join('&')):''));
    const byKey = {};
    const prodMap = Object.fromEntries(state.products.map(p=>[p.id,p]));

    (r.remittances || []).forEach(x => {
      const key = `${x.productId}|${x.country}`;
      if (!byKey[key]) byKey[key] = { pieces:0, ad:0, prodCost:0, profit:0, name:(prodMap[x.productId]?.name||x.productId), country:x.country };
      byKey[key].pieces += (+x.pieces||0);
      byKey[key].ad += (+x.adSpend||0);
      const base = (+prodMap[x.productId]?.cost_china||0) + (+prodMap[x.productId]?.ship_china_to_kenya||0);
      const extra = (+x.extraPerPiece||0) * (+x.pieces||0);
      byKey[key].prodCost += base * (+x.pieces||0);
      const profit = (+x.revenue||0) - (+x.adSpend||0) - (base*(+x.pieces||0)) - extra;
      byKey[key].profit += profit;
    });

    const tb = Q('#pfTable tbody');
    tb.innerHTML = Object.values(byKey)
      .sort((a,b)=>b.pieces-a.pieces)
      .map(it =>
        `<tr><td>${it.name}</td><td>${it.country}</td><td>${fmt(it.pieces)}</td><td>${fmt(it.ad)}</td><td>${fmt(it.prodCost)}</td><td>${fmt(it.profit)}</td><td>${it.pieces?fmt(it.profit/it.pieces):'0'}</td></tr>`
      ).join('') || `<tr><td colspan="7" class="muted">No data</td></tr>`;
  });

  // Remittance report (create)
  Q('#rAdd')?.addEventListener('click', async () => {
    const payload = {
      start: Q('#rStart').value, end: Q('#rEnd').value,
      country: Q('#rCountry').value, productId: Q('#rProduct').value,
      orders: +Q('#rOrders').value || 0, pieces: +Q('#rPieces').value || 0,
      revenue: +Q('#rRev').value || 0, adSpend: +Q('#rAds').value || 0,
      extraPerPiece: +Q('#rExtra').value || 0
    };
    if (!payload.start || !payload.end || !payload.country || !payload.productId) return alert('Fill dates, country, product');
    await api('/api/remittances', { method:'POST', body: JSON.stringify(payload) });
    Q('#rMsg').textContent = 'Saved ✓';
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
    Q('#fcName').value = '';
    await loadFinanceCats();
  });

  // add entry (type inferred from category)
  Q('#feAdd')?.addEventListener('click', async () => {
    const date = Q('#feDate').value, category = Q('#feCat').value, amount = +Q('#feAmt').value || 0, note = Q('#feNote').value;
    if (!date || !category) return alert('Pick date & category');
    const type = state.categories.credit.includes(category) ? 'credit' : 'debit';
    await api('/api/finance/entries', { method:'POST', body: JSON.stringify({ date, type, category, amount, note }) });
    Q('#feNote').value=''; Q('#feAmt').value='';
    renderFinancePeriod();
  });

  Q('#feRun')?.addEventListener('click', renderFinancePeriod);
  renderFinancePeriod();
}

async function loadFinanceCats() {
  try {
    const cats = await api('/api/finance/categories');
    state.categories = cats;
    // show chips (with delete)
    const renderChips = (wrapSel, type) => {
      const el = Q(wrapSel);
      el.innerHTML = (cats[type]||[]).map(c=>`<span class="chip" data-del-cat="${type}|${c}">${c} ✕</span>`).join('') || '—';
    };
    renderChips('#fcDebitList','debit');
    renderChips('#fcCreditList','credit');

    Q('#fcDebitList').onclick = async e => {
      const d = e.target.dataset.delCat; if (!d) return;
      const [type, name] = d.split('|');
      if (!confirm(`Delete category "${name}"?`)) return;
      await api(`/api/finance/categories?type=${type}&name=${encodeURIComponent(name)}`, { method:'DELETE' });
      await loadFinanceCats();
    };
    Q('#fcCreditList').onclick = async e => {
      const d = e.target.dataset.delCat; if (!d) return;
      const [type, name] = d.split('|');
      if (!confirm(`Delete category "${name}"?`)) return;
      await api(`/api/finance/categories?type=${type}&name=${encodeURIComponent(name)}`, { method:'DELETE' });
      await loadFinanceCats();
    };

    // fill select for entries
    const all = [...(cats.debit||[]), ...(cats.credit||[])].sort();
    Q('#feCat') && (Q('#feCat').innerHTML = `<option value="" disabled selected>Select category</option>` + all.map(c=>`<option>${c}</option>`).join(''));
  } catch {}
}

async function renderFinancePeriod() {
  try {
    const s = Q('#fes')?.value, e = Q('#fee')?.value;
    const r = await api('/api/finance/entries' + ((s||e)?(`?start=${s||''}&end=${e||''}`):''));
    const entries = r.entries || [];
    // running balance all-time
    Q('#feRunning') && (Q('#feRunning').textContent = 'Running Balance: ' + fmt(r.running || 0) + ' USD');
    // period balance
    Q('#feBalance') && (Q('#feBalance').textContent = 'Balance for period: ' + fmt(r.balance || 0) + ' USD');
    const tb = Q('#feTable tbody');
    if (tb) {
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
    }
  } catch (e) { alert(e.message); }
}

/* ========================================================================
   SETTINGS
   ======================================================================== */
function initSettings() {
  // add country
  Q('#ctyAdd')?.addEventListener('click', async () => {
    const name = Q('#cty').value.trim(); if (!name) return;
    await api('/api/countries', { method:'POST', body: JSON.stringify({ name }) });
    const m = await api('/api/meta'); state.countries = m.countries || [];
    Q('#cty').value='';
    fillGlobalSelects(); renderCountryChips();
  });
  renderCountryChips();

  // product editor selector
  const sel = Q('#editProdSel');
  if (sel) {
    sel.innerHTML = `<option value="">Select product…</option>` + state.products.map(p=>`<option value="${p.id}">${p.name} (${p.sku||'—'})</option>`).join('');
    sel.onchange = () => {
      const p = state.products.find(x=>x.id===sel.value); if (!p) return;
      Q('#epName').value = p.name; Q('#epSku').value = p.sku || '';
      Q('#epCost').value = p.cost_china || 0; Q('#epShip').value = p.ship_china_to_kenya || 0;
      Q('#epMB').value = p.margin_budget || 0;
    };
    Q('#epSave')?.addEventListener('click', async () => {
      const id = sel.value; if (!id) return;
      const p = {
        name: Q('#epName').value, sku: Q('#epSku').value,
        cost_china:+Q('#epCost').value||0, ship_china_to_kenya:+Q('#epShip').value||0,
        margin_budget:+Q('#epMB').value||0
      };
      await api('/api/products/' + id, { method:'PUT', body: JSON.stringify(p) });
      await preloadProducts();
      alert('Saved');
    });
  }

  // manual snapshots
  Q('#ssSave')?.addEventListener('click', async () => {
    const name = prompt('Name this snapshot'); if (!name) return;
    await api('/api/snapshots', { method:'POST', body: JSON.stringify({ name }) });
    alert('Saved');
    renderSnapshots();
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
  const r = await api('/api/snapshots');
  const box = Q('#ssList'); if (!box) return;
  box.innerHTML = (r.snapshots || []).map(s =>
    `<div class="flex">
      <span>${s.name}</span>
      <button class="btn outline" data-restore="${s.file}">Push</button>
      <button class="btn outline" data-del-snap="${s.id}">Delete</button>
    </div>`
  ).join('') || '<div class="muted">No snapshots yet</div>';

  box.onclick = async e => {
    if (e.target.dataset.restore) {
      await api('/api/snapshots/restore', { method:'POST', body: JSON.stringify({ file: e.target.dataset.restore }) });
      alert('System restored'); location.reload();
    } else if (e.target.dataset.delSnap) {
      await api('/api/snapshots/' + e.target.dataset.delSnap, { method:'DELETE' });
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
  // product.html should have matching ids; this file primarily powers index.html
  // (If your product.html uses the same IDs from earlier, this will work.)
}

/* ---------- NAV (index) ---------- */
function initNav() {
  QA('.nav a[data-view]')?.forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    const v = a.dataset.view;
    ['home','products','performance','finance','settings'].forEach(id => {
      const el = Q('#'+id); if (el) el.style.display = (id===v)?'':'none';
    });
    QA('.nav a').forEach(x => x.classList.toggle('active', x === a));
  }));
}

/* ---------- boot ---------- */
gate();
