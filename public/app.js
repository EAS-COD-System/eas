/* ======================================================================
   EAS Tracker – app.js (full build)
   Works for: index.html and product.html?id=<PRODUCT_ID>
   ====================================================================== */

/* ------------------------- tiny helpers ------------------------- */
const Q  = (s, r = document) => r.querySelector(s);
const QA = (s, r = document) => Array.from(r.querySelectorAll(s));
const fmt = (n, d = 2) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: d });
const todayISO = () => new Date().toISOString().slice(0, 10);
const getParam = k => new URLSearchParams(location.search).get(k);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data?.error || data || `HTTP ${res.status}`);
  return data;
}

/* ------------------------- global state ------------------------- */
const state = {
  countries: [],
  products: [],
  adspend: [],
  shipments: [],
  remittances: [],
  deliveries: [],
  financeCats: { debit: [], credit: [] },
  product: null,               // current product (product.html)
  productId: getParam('id')    // query param
};

/* ------------------------- AUTH / BOOT ------------------------- */
async function boot() {
  // If already authed, /api/meta returns countries. Otherwise it 403s.
  try {
    const meta = await api('/api/meta');
    state.countries = meta.countries || [];
    showMain();
    await loadAllData();
    fillGlobalSelects();
    initNav();

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
  } catch {
    showLogin();
  }
}

function showLogin() {
  Q('#login')?.classList.remove('hide');
  Q('#main')?.setAttribute('style', 'display:none');

  const form = Q('#loginForm');        // ok if null
  const btn  = Q('#loginBtn');
  const inp  = Q('#pw');

  // ensure the button never acts like a submit
  if (btn) btn.type = 'button';

  const doLogin = async (e) => {
    if (e) e.preventDefault();          // stop native submit
    const pw = inp?.value?.trim();
    if (!pw) { alert('Enter password'); return; }

    try {
      btn && (btn.disabled = true);
      await api('/api/auth', { method: 'POST', body: JSON.stringify({ password: pw }) });
      showMain();
      await loadAllData();
      fillGlobalSelects();
      initNav();

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
      alert(e?.message || 'Wrong password');
      // keep the text so user can correct it; do not clear inp.value
    } finally {
      btn && (btn.disabled = false);
    }
  };

  // Intercept any form submit (e.g., pressing “Go” on mobile keyboards)
  form && form.addEventListener('submit', doLogin);

  btn?.addEventListener('click', doLogin);
  inp?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); doLogin(e); }
  });
}
function showMain() {
  Q('#login')?.classList.add('hide');
  Q('#main')?.removeAttribute('style');
}
Q('#logoutLink')?.addEventListener('click', async e => {
  e.preventDefault();
  try { await api('/api/auth', { method: 'POST', body: JSON.stringify({ password: 'logout' }) }); } catch {}
  location.reload();
});

/* ------------------------- LOAD DATA ------------------------- */
async function loadAllData() {
  const [
    prodR, ctyR, adR, shR, remR, delR, catR
  ] = await Promise.allSettled([
    api('/api/products'),
    api('/api/countries'),
    api('/api/adspend'),
    api('/api/shipments'),
    api('/api/remittances'),
    api('/api/deliveries'),
    api('/api/finance/categories')
  ]);

  state.products     = prodR.value?.products     || [];
  state.countries    = ctyR.value?.countries     || [];
  state.adspend      = adR.value?.adSpends ?? adR.value?.adspend ?? [];
  state.shipments    = shR.value?.shipments      || [];
  state.remittances  = remR.value?.remittances   || [];
  state.deliveries   = delR.value?.deliveries    || [];
  state.financeCats  = catR.value                 || { debit: [], credit: [] };
}

function activeProductIds() {
  return new Set(state.products.filter(p => p.status !== 'paused').map(p => p.id));
}

/* ------------------------- SELECTS FILL ------------------------- */
function fillGlobalSelects() {
  // countries
  const countrySelectors = [
    '#adCountry','#mvFrom','#mvTo','#rCountry','#pfCountry',
    '#pcCountry','#lpCountry','#pdAdCountry','#pdMvFrom','#pdMvTo',
    '#pdPBCountry','#pdInfCountry','#pdInfFilterCountry'
  ];
  countrySelectors.forEach(sel => {
    QA(sel).forEach(el => {
      // special cases:
      const id = el.id || '';
      const excludeChinaForRemit = (id === 'rCountry');
      const list = excludeChinaForRemit
        ? state.countries.filter(c => c.toLowerCase() !== 'china')
        : state.countries;
      el.innerHTML = (el.id === 'pfCountry' ? `<option value="">All countries</option>` : '') +
        list.map(c => `<option value="${c}">${c}</option>`).join('');
    });
  });

  // products
  const prodSelectors = ['#adProduct','#rProduct','#mvProduct'];
  prodSelectors.forEach(sel => {
    QA(sel).forEach(el => {
      el.innerHTML = state.products.map(p => `<option value="${p.id}">${p.name}${p.sku ? ' ('+p.sku+')' : ''}</option>`).join('');
    });
  });

  // lifetime global selector (optional exists)
  if (Q('#lpProduct')) {
    Q('#lpProduct').innerHTML = `<option value="">All products</option>` +
      state.products.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  }

  // settings product editor select
  if (Q('#epSelect')) {
    Q('#epSelect').innerHTML = `<option value="">Select product…</option>` +
      state.products.map(p => `<option value="${p.id}">${p.name}${p.sku?' ('+p.sku+')':''}</option>`).join('');
  }

  // performance country (ensure All countries on top)
  if (Q('#pfCountry')) {
    Q('#pfCountry').innerHTML = `<option value="">All countries</option>` +
      state.countries.map(c => `<option value="${c}">${c}</option>`).join('');
  }
}

/* =====================================================================
   DASHBOARD
   ===================================================================== */
function initDashboard() {
  renderKpis();
  renderStockAndSpendByCountry();
  initWeeklyDeliveredGrid();
  initDailyAdSpend();
  initCreateShipment();
  renderTransitTables();
  initProfitByCountry();
  initTodos();
}

/* ---- KPIs ---- */
function renderKpis() {
  const activeIds = activeProductIds();
  if (Q('#kpiProducts'))  Q('#kpiProducts').textContent  = state.products.length;
  if (Q('#kpiCountries')) Q('#kpiCountries').textContent = state.countries.length;

  // Transit shipments (not arrived)
  const transit = state.shipments.filter(s => !s.arrivedAt && activeIds.has(s.productId)).length;
  if (Q('#kpiTransit')) Q('#kpiTransit').textContent = transit;

  // Total ad spend (sum all current adspend)
  const totalAd = state.adspend
    .filter(a => activeIds.has(a.productId))
    .reduce((t, x) => t + (+x.amount || 0), 0);
  if (Q('#kpiAdSpend')) Q('#kpiAdSpend').textContent = `${fmt(totalAd)} USD`;

  // Delivered (Mon–Sun) from deliveries for current week
  if (Q('#kpiDelivered')) {
    const { weekStart, weekEnd } = weekBounds(new Date());
    const totalW = state.deliveries
      .filter(d => d.date >= weekStart && d.date <= weekEnd)
      .reduce((t, x) => t + (+x.delivered || 0), 0);
    Q('#kpiDelivered').textContent = fmt(totalW, 0);
  }
}

/* ---- Stock & Ad Spend by Country ---- */
function renderStockAndSpendByCountry() {
  const body = Q('#stockByCountryBody'); if (!body) return;
  body.innerHTML = '';

  const map = {}; state.countries.forEach(c => map[c] = { stock: 0, ad: 0 });

  const activeIds = activeProductIds();

  // Shipments (arrived): add to destination, deduct from origin
  state.shipments.filter(s => s.arrivedAt && activeIds.has(s.productId)).forEach(s => {
    if (map[s.toCountry])   map[s.toCountry].stock   += (+s.qty || 0);
    if (map[s.fromCountry]) map[s.fromCountry].stock -= (+s.qty || 0);
  });

  // Remittances pieces reduce stock from that country
  state.remittances.filter(r => activeIds.has(r.productId)).forEach(r => {
    if (map[r.country]) map[r.country].stock -= (+r.pieces || 0);
  });

  // Ad spend from current adspend table (replace style)
  state.adspend.filter(a => activeIds.has(a.productId)).forEach(a => {
    if (map[a.country]) map[a.country].ad += (+a.amount || 0);
  });

  let st = 0, at = 0;
  Object.entries(map).forEach(([c, v]) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${c}</td><td>${fmt(v.stock,0)}</td><td>${fmt(v.ad)} USD</td>`;
    body.appendChild(tr);
    st += v.stock; at += v.ad;
  });
  if (Q('#stockTotal')) Q('#stockTotal').textContent = fmt(st,0);
  if (Q('#adTotal'))    Q('#adTotal').textContent    = `${fmt(at)} USD`;
}

/* ---- Weekly Delivered (Mon→Sun grid by country) ---- */
function weekBounds(date) {
  const d = new Date(date);
  const wd = (d.getDay() + 6) % 7; // Mon=0..Sun=6
  const start = new Date(d); start.setDate(d.getDate() - wd);
  const end = new Date(start); end.setDate(start.getDate() + 6);
  const toISO = dt => dt.toISOString().slice(0,10);
  return { weekStart: toISO(start), weekEnd: toISO(end), days: [...Array(7)].map((_,i)=>toISO(new Date(start.getFullYear(), start.getMonth(), start.getDate()+i))) };
}

function initWeeklyDeliveredGrid() {
  const head = Q('#weeklyHead'), body = Q('#weeklyBody'), badge = Q('#weeklyRange');
  if (!head || !body) return;

  let refDate = new Date();
  const render = () => {
    const { weekStart, weekEnd, days } = weekBounds(refDate);

    // header
    head.innerHTML = `<tr><th>Country</th>${days.map(d => {
      const n = new Date(d);
      return `<th>${n.toLocaleDateString(undefined,{ weekday:'short' })}<br><small>${d}</small></th>`;
    }).join('')}<th>Total</th></tr>`;

    // rows
    body.innerHTML = state.countries.map(c => {
      const cells = days.map(d => `<td><input class="wd" data-country="${c}" data-date="${d}" type="number" min="0" placeholder="0"></td>`).join('');
      return `<tr data-country="${c}"><td>${c}</td>${cells}<td class="rowT">0</td></tr>`;
    }).join('');

    // preload from DB
    const byKey = {};
    state.deliveries
      .filter(x => x.date >= weekStart && x.date <= weekEnd)
      .forEach(x => { byKey[`${x.country}|${x.date}`] = +x.delivered || 0; });
    QA('.wd', body).forEach(inp => {
      const k = `${inp.dataset.country}|${inp.dataset.date}`;
      if (byKey[k] != null) inp.value = byKey[k];
    });

    // range badge
    badge.textContent = `Week: ${weekStart} → ${weekEnd}`;

    // compute totals
    computeWeeklyTotals();
  };

  function computeWeeklyTotals() {
    // row totals
    QA('tr[data-country]', body).forEach(tr => {
      const sum = QA('.wd', tr).reduce((t, el) => t + (+el.value || 0), 0);
      Q('.rowT', tr).textContent = fmt(sum,0);
    });
    // column totals + grand
    const cols = QA('thead th', Q('#weeklyTable')).length - 2;
    let grand = 0;
    for (let i = 0; i < cols; i++) {
      let s = 0;
      QA('tr[data-country]', body).forEach(tr => {
        const inputs = QA('.wd', tr);
        s += (+inputs[i].value || 0);
      });
      Q(`#weeklyTable tfoot th:nth-child(${i+2})`).textContent = fmt(s,0);
      grand += s;
    }
    Q('#wAllT').textContent = fmt(grand,0);
  }

  // events
  body.addEventListener('input', e => {
    if (e.target.classList.contains('wd')) computeWeeklyTotals();
  });
  Q('#weeklyPrev')?.addEventListener('click', () => { refDate.setDate(refDate.getDate() - 7); render(); });
  Q('#weeklyNext')?.addEventListener('click', () => { refDate.setDate(refDate.getDate() + 7); render(); });
  Q('#weeklyReset')?.addEventListener('click', () => { QA('.wd', body).forEach(i => i.value = ''); computeWeeklyTotals(); });
  Q('#weeklySave')?.addEventListener('click', async () => {
    // post all non-zero cells as delivery rows
    const cells = QA('.wd', body);
    const payloads = cells
      .map(i => ({ date: i.dataset.date, country: i.dataset.country, delivered: +i.value || 0 }))
      .filter(x => x.delivered > 0);
    try {
      for (const rec of payloads) {
        await api('/api/deliveries', { method: 'POST', body: JSON.stringify(rec) });
      }
      // reload deliveries & refresh KPIs
      const r = await api('/api/deliveries');
      state.deliveries = r.deliveries || [];
      renderKpis();
      alert('Saved!');
    } catch (e) {
      alert('Save failed: ' + e.message);
    }
  });

  render();
}

/* ---- Daily Advertising Spend (replace mode) ---- */
function initDailyAdSpend() {
  const btn = Q('#adSave'); if (!btn) return;
  btn.addEventListener('click', async () => {
    const payload = {
      platform: Q('#adPlatform')?.value,
      productId: Q('#adProduct')?.value,
      country: Q('#adCountry')?.value,
      amount: +Q('#adAmount')?.value || 0
    };
    if (!payload.platform || !payload.productId || !payload.country) return alert('Fill all fields');
    try {
      await api('/api/adspend', { method: 'POST', body: JSON.stringify(payload) });
      const r = await api('/api/adspend');
      state.adspend = r.adSpends ?? r.adspend ?? [];
      renderKpis(); renderStockAndSpendByCountry();
      alert('Saved / Replaced.');
    } catch (e) { alert(e.message); }
  });
}

/* ---- Create Shipment (movement) ---- */
function initCreateShipment() {
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
    if (!payload.productId || !payload.fromCountry || !payload.toCountry) return alert('Select product & countries');
    try {
      await api('/api/shipments', { method: 'POST', body: JSON.stringify(payload) });
      const r = await api('/api/shipments'); state.shipments = r.shipments || [];
      renderTransitTables();
      alert('Shipment created');
    } catch (e) { alert(e.message); }
  });
}

/* ---- Transit tables (dashboard) ---- */
function renderTransitTables() {
  const activeIds = activeProductIds();
  const list = state.shipments.filter(s => !s.arrivedAt && activeIds.has(s.productId));

  const nameById = Object.fromEntries(state.products.map(p => [p.id, p.name]));
  const row = sp => {
    const route = `${sp.fromCountry} → ${sp.toCountry}`;
    const days = sp.arrivedAt && sp.departedAt
      ? Math.max(0, Math.round((+new Date(sp.arrivedAt) - +new Date(sp.departedAt)) / 86400000))
      : '';
    return `<tr>
      <td>${sp.id}</td><td>${nameById[sp.productId] || sp.productId}</td><td>${route}</td>
      <td>${fmt(sp.qty,0)}</td><td>${fmt(sp.shipCost)}</td>
      <td>${sp.departedAt || ''}</td><td>${sp.arrivedAt || ''}</td><td>${days}</td>
      <td>
        <button class="btn outline" data-arr="${sp.id}">Mark Arrived</button>
        <button class="btn outline" data-edit="${sp.id}">Edit</button>
        <button class="btn outline danger" data-del="${sp.id}">Delete</button>
      </td>
    </tr>`;
  };

  const ckBody = Q('#shipCKBody'); const icBody = Q('#shipICBody');
  if (ckBody) {
    const ck = list.filter(sp => sp.fromCountry?.toLowerCase() === 'china' && sp.toCountry?.toLowerCase() === 'kenya');
    ckBody.innerHTML = ck.map(row).join('') || `<tr><td colspan="9" class="muted">No transit</td></tr>`;
  }
  if (icBody) {
    const ic = list.filter(sp => !(sp.fromCountry?.toLowerCase() === 'china' && sp.toCountry?.toLowerCase() === 'kenya'));
    icBody.innerHTML = ic.map(row).join('') || `<tr><td colspan="9" class="muted">No transit</td></tr>`;
  }

  // actions
  const host = Q('#home') || document;
  host.addEventListener('click', async e => {
    const id = e.target.dataset.arr || e.target.dataset.edit || e.target.dataset.del;
    if (!id) return;

    if (e.target.dataset.arr) {
      const date = prompt('Arrival date (YYYY-MM-DD)', todayISO());
      if (!date) return;
      try {
        await api(`/api/shipments/${id}`, { method: 'PUT', body: JSON.stringify({ arrivedAt: date }) });
        const r = await api('/api/shipments'); state.shipments = r.shipments || [];
        renderTransitTables(); renderStockAndSpendByCountry();
      } catch (err) {
        alert('Arrive failed: ' + err.message);
      }
    }

    if (e.target.dataset.edit) {
      const qty = Number(prompt('New quantity?'));
      const cost = Number(prompt('New shipping cost?'));
      if (isNaN(qty) || isNaN(cost)) return;
      await api(`/api/shipments/${id}`, { method: 'PUT', body: JSON.stringify({ qty, shipCost: cost }) });
      const r = await api('/api/shipments'); state.shipments = r.shipments || [];
      renderTransitTables();
    }

    if (e.target.dataset.del) {
      if (!confirm('Delete this shipment?')) return;
      await api(`/api/shipments/${id}`, { method: 'DELETE' });
      const r = await api('/api/shipments'); state.shipments = r.shipments || [];
      renderTransitTables(); renderStockAndSpendByCountry();
    }
  }, { once: true });
}

/* ---- Profit by Country (global) ---- */
function initProfitByCountry() {
  const btn = Q('#pcRun'); if (!btn) return;
  btn.addEventListener('click', async () => {
    const s = Q('#pcStart')?.value || '';
    const e = Q('#pcEnd')?.value || '';
    const c = Q('#pcCountry')?.value || '';

    const qs = [];
    if (s) qs.push('start=' + encodeURIComponent(s));
    if (e) qs.push('end=' + encodeURIComponent(e));
    if (c) qs.push('country=' + encodeURIComponent(c));
    const r = await api('/api/remittances' + (qs.length ? `?${qs.join('&')}` : ''));

    const act = activeProductIds();
    const byC = {};
    (r.remittances || []).forEach(x => {
      if (!act.has(x.productId)) return;
      byC[x.country] = byC[x.country] || { rev:0, ad:0, del:0, pcs:0 };
      byC[x.country].rev += (+x.revenue || 0);
      byC[x.country].ad  += (+x.adSpend || 0);
      byC[x.country].del += (+x.extraPerPiece || 0) * (+x.pieces || 0);
      byC[x.country].pcs += (+x.pieces || 0);
    });

    const tb = Q('#profitCountryBody');
    let R=0,A=0,D=0,P=0,PCS=0;
    tb.innerHTML = Object.entries(byC).map(([k,v]) => {
      const profit = v.rev - v.ad - v.del;
      R+=v.rev; A+=v.ad; D+=v.del; PCS+=v.pcs; P+=profit;
      return `<tr><td>${k}</td><td>${fmt(v.rev)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.del)}</td><td>${fmt(v.pcs,0)}</td><td>${fmt(profit)}</td></tr>`;
    }).join('') || `<tr><td colspan="6" class="muted">No data</td></tr>`;

    Q('#pcRevT').textContent    = fmt(R);
    Q('#pcAdT').textContent     = fmt(A);
    Q('#pcDelT').textContent    = fmt(D);
    Q('#pcPiecesT').textContent = fmt(PCS,0);
    Q('#pcProfitT').textContent = fmt(P);
  });
}

/* ---- To-Dos (localStorage) ---- */
function initTodos() {
  const QUICK_KEY = 'eas_todos_quick';
  const WEEK_KEY  = 'eas_todos_week';

  // quick
  const wrap = Q('#todoList'); if (!wrap) return;
  const addBtn = Q('#todoAdd');

  function load(k){ try{return JSON.parse(localStorage.getItem(k)||'[]');}catch{return[];} }
  function save(k,v){ localStorage.setItem(k, JSON.stringify(v)); }

  function renderQuick() {
    const items = load(QUICK_KEY);
    wrap.innerHTML = items.map(t => `
      <div class="todo">
        <span>${t.done?'✅ ':''}${t.text}</span>
        <div>
          <button class="btn outline" data-done="${t.id}">${t.done?'Undo':'Done'}</button>
          <button class="btn outline danger" data-del="${t.id}">Delete</button>
        </div>
      </div>`).join('') || '<div class="muted">No tasks</div>';
  }
  addBtn.addEventListener('click', () => {
    const t = Q('#todoText')?.value?.trim(); if (!t) return;
    const list = load(QUICK_KEY); list.push({ id: crypto.randomUUID(), text: t, done:false });
    save(QUICK_KEY, list); Q('#todoText').value=''; renderQuick();
  });
  wrap.addEventListener('click', e => {
    const idD = e.target.dataset.del, idT = e.target.dataset.done;
    if (!idD && !idT) return;
    const list = load(QUICK_KEY);
    if (idD) {
      const i = list.findIndex(x => x.id === idD); if (i>=0) list.splice(i,1);
    } else if (idT) {
      const it = list.find(x => x.id === idT); if (it) it.done = !it.done;
    }
    save(QUICK_KEY, list); renderQuick();
  });
  renderQuick();

  // weekly per day
  const weeklyWrap = Q('#weeklyWrap'); if (!weeklyWrap) return;
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  function loadW(){ try{return JSON.parse(localStorage.getItem(WEEK_KEY)||'{}');}catch{return{};} }
  function saveW(v){ localStorage.setItem(WEEK_KEY, JSON.stringify(v)); }
  function renderWeekly() {
    const data = loadW();
    weeklyWrap.innerHTML = days.map(d => `
      <div class="card">
        <div class="h">${d}</div>
        <div class="row">
          <input id="wk_${d}" class="input" placeholder="Task"/>
          <button class="btn" data-add="${d}">Add</button>
        </div>
        <div>${(data[d]||[]).map(t=>`
          <div class="todo">
            <span>${t.done?'✅ ':''}${t.text}</span>
            <div>
              <button class="btn outline" data-tgl="${d}|${t.id}">${t.done?'Undo':'Done'}</button>
              <button class="btn outline danger" data-del="${d}|${t.id}">Delete</button>
            </div>
          </div>`).join('') || '<div class="muted">No tasks</div>'}</div>
      </div>`).join('');
  }
  weeklyWrap.addEventListener('click', e => {
    const a = e.target.dataset.add, tgl = e.target.dataset.tgl, del = e.target.dataset.del;
    const data = loadW();
    if (a) {
      const v = Q('#wk_'+a)?.value?.trim(); if (!v) return;
      const arr = data[a] || []; arr.push({ id: crypto.randomUUID(), text: v, done:false });
      data[a] = arr; saveW(data); renderWeekly();
      return;
    }
    if (tgl) {
      const [d,id] = tgl.split('|'); const arr = data[d]||[];
      const it = arr.find(x => x.id === id); if (it) it.done = !it.done;
      data[d] = arr; saveW(data); renderWeekly(); return;
    }
    if (del) {
      const [d,id] = del.split('|'); const arr = data[d]||[];
      const i = arr.findIndex(x => x.id === id); if (i>=0) arr.splice(i,1);
      data[d]=arr; saveW(data); renderWeekly(); return;
    }
  });
  renderWeekly();
}

/* =====================================================================
   PRODUCTS LIST
   ===================================================================== */
function initProducts() {
  // Add product
  Q('#pAdd')?.addEventListener('click', async () => {
    const payload = {
      name: Q('#pName')?.value?.trim(),
      sku: Q('#pSku')?.value?.trim(),
      cost_china: +Q('#pCost')?.value || 0,
      ship_china_to_kenya: +Q('#pShip')?.value || 0,
      margin_budget: +Q('#pMB')?.value || 0
    };
    if (!payload.name) return alert('Name required');
    await api('/api/products', { method: 'POST', body: JSON.stringify(payload) });
    const pr = await api('/api/products'); state.products = pr.products || [];
    fillGlobalSelects(); renderProductsTable();
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
      <td class="actions">
        <a class="btn" href="/product.html?id=${p.id}">Open</a>
        <button class="btn outline" data-toggle="${p.id}">${p.status==='active'?'Pause':'Run'}</button>
        <button class="btn outline danger" data-del="${p.id}">Delete</button>
      </td>
    </tr>`).join('') || `<tr><td colspan="4" class="muted">No products</td></tr>`;

  tb.onclick = async e => {
    const pid = e.target.dataset.toggle;
    const del = e.target.dataset.del;
    if (pid) {
      const p = state.products.find(x => x.id === pid);
      const ns = (p.status === 'active') ? 'paused' : 'active';
      await api(`/api/products/${pid}/status`, { method: 'POST', body: JSON.stringify({ status: ns }) });
      const pr = await api('/api/products'); state.products = pr.products || [];
      renderProductsTable(); renderKpis(); renderStockAndSpendByCountry(); renderTransitTables();
    } else if (del) {
      if (!confirm('Delete this product and remove it from all calculations?')) return;
      await api('/api/products/' + del, { method: 'DELETE' });
      // client-side cascade removal from state
      state.products    = state.products.filter(x => x.id !== del);
      state.adspend     = state.adspend.filter(x => x.productId !== del);
      state.shipments   = state.shipments.filter(x => x.productId !== del);
      state.remittances = state.remittances.filter(x => x.productId !== del);
      // refresh UI
      renderProductsTable(); renderKpis(); renderStockAndSpendByCountry(); renderTransitTables();
    }
  };
}

/* =====================================================================
   PERFORMANCE
   ===================================================================== */
function initPerformance() {
  // Top delivered
  Q('#pfRun')?.addEventListener('click', async () => {
    const quick = Q('#pfQuick')?.value;
    let start = Q('#pfStart')?.value, end = Q('#pfEnd')?.value;
    if (quick && quick !== 'custom') {
      const d = new Date(); d.setDate(d.getDate() - (+quick));
      start = d.toISOString().slice(0,10); end = todayISO();
    }
    const country = Q('#pfCountry')?.value || '';

    const qs = [];
    if (start) qs.push('start='+encodeURIComponent(start));
    if (end)   qs.push('end='+encodeURIComponent(end));
    if (country) qs.push('country='+encodeURIComponent(country));

    const r = await api('/api/remittances' + (qs.length ? `?${qs.join('&')}` : ''));
    const act = activeProductIds();
    const prodMap = Object.fromEntries(state.products.map(p => [p.id, p]));

    const byPK = {}; // product+country buckets
    (r.remittances || []).forEach(x => {
      if (!act.has(x.productId)) return;
      const key = `${x.productId}|${x.country}`;
      const prod = prodMap[x.productId] || {};
      if (!byPK[key]) byPK[key] = {
        productId: x.productId,
        product: prod.name || x.productId,
        country: x.country,
        pieces: 0, ad:0, prodCost:0, profit:0
      };
      const base = (+prod.cost_china || 0) + (+prod.ship_china_to_kenya || 0);
      const pcs = (+x.pieces||0);
      const extra = (+x.extraPerPiece||0) * pcs;
      byPK[key].pieces   += pcs;
      byPK[key].ad       += (+x.adSpend||0);
      byPK[key].prodCost += base * pcs;
      byPK[key].profit   += (+x.revenue||0) - (+x.adSpend||0) - (base*pcs) - extra;
    });

    const tb = Q('#pfTable tbody');
    tb.innerHTML = Object.values(byPK)
      .sort((a,b) => b.pieces - a.pieces)
      .map(it => `<tr>
        <td>${it.product}</td><td>${it.country}</td>
        <td>${fmt(it.pieces,0)}</td><td>${fmt(it.ad)}</td>
        <td>${fmt(it.prodCost)}</td><td>${fmt(it.profit)}</td>
        <td>${it.pieces ? fmt(it.profit/it.pieces) : '0'}</td>
      </tr>`).join('') || `<tr><td colspan="7" class="muted">No data</td></tr>`;
  });

  // Remittance create
  Q('#rAdd')?.addEventListener('click', async () => {
    const payload = {
      start: Q('#rStart')?.value,
      end:   Q('#rEnd')?.value,
      country: Q('#rCountry')?.value,                      // China is not in this select
      productId: Q('#rProduct')?.value,
      orders: +Q('#rOrders')?.value || 0,
      pieces: +Q('#rPieces')?.value || 0,
      revenue: +Q('#rRev')?.value || 0,
      adSpend: +Q('#rAds')?.value || 0,
      extraPerPiece: +Q('#rExtra')?.value || 0
    };
    if (!payload.start || !payload.end || !payload.country || !payload.productId)
      return alert('Please fill the required fields');
    await api('/api/remittances', { method: 'POST', body: JSON.stringify(payload) });
    // refresh remittances in memory
    const rr = await api('/api/remittances'); state.remittances = rr.remittances || [];
    alert('Remittance saved');
  });
}

/* =====================================================================
   FINANCE
   ===================================================================== */
function initFinance() {
  renderFinanceCats();
  // Add category
  Q('#fcAdd')?.addEventListener('click', async () => {
    const type = Q('#fcType')?.value;
    const name = Q('#fcName')?.value?.trim();
    if (!type || !name) return;
    await api('/api/finance/categories', { method: 'POST', body: JSON.stringify({ type, name }) });
    const cats = await api('/api/finance/categories');
    state.financeCats = cats;
    renderFinanceCats();
    Q('#fcName').value = '';
  });

  // Add entry
  Q('#feAdd')?.addEventListener('click', async () => {
    const date = Q('#feDate')?.value;
    const type = Q('#feType')?.value;
    const category = Q('#feCat')?.value;
    const amount = +Q('#feAmt')?.value || 0;
    const note = Q('#feNote')?.value || '';
    if (!date || !type || !category) return alert('Pick date, type and category');
    const body = JSON.stringify({ date, type, category, amount, note });
    await api('/api/finance/entries', { method: 'POST', body });
    Q('#feNote').value = ''; Q('#feAmt').value = '';
    renderFinancePeriod();
  });

  // filter period run
  Q('#feRun')?.addEventListener('click', renderFinancePeriod);

  // initial render
  renderFinancePeriod();
}

function renderFinanceCats() {
  const d = Q('#fcDebits'); const c = Q('#fcCredits');
  if (!d || !c) return;
  d.innerHTML = (state.financeCats.debit || []).map(name =>
    `<span class="chip">${name} <button class="x" data-del-debit="${name}">×</button></span>`
  ).join('') || '—';
  c.innerHTML = (state.financeCats.credit || []).map(name =>
    `<span class="chip">${name} <button class="x" data-del-credit="${name}">×</button></span>`
  ).join('') || '—';

  // fill entry category select
  const all = [...(state.financeCats.debit||[]), ...(state.financeCats.credit||[])].sort();
  if (Q('#feCat')) Q('#feCat').innerHTML = `<option value="" disabled selected>Select category</option>` +
    all.map(x => `<option>${x}</option>`).join('');

  // delete category (allow multiple deletes without reload)
  const container = Q('#finance');
  if (!container._catsBound) {
    container._catsBound = true;
    container.addEventListener('click', async e => {
      const delD = e.target.dataset.delDebit, delC = e.target.dataset.delCredit;
      const type = delD ? 'debit' : (delC ? 'credit' : '');
      const name = delD || delC;
      if (!type || !name) return;
      if (!confirm(`Delete category "${name}"?`)) return;
      await api(`/api/finance/categories?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}`, { method: 'DELETE' });
      const cats = await api('/api/finance/categories');
      state.financeCats = cats; renderFinanceCats();
    });
  }
}

async function renderFinancePeriod() {
  const s = Q('#fes')?.value || ''; const e = Q('#fee')?.value || '';
  const qs = [];
  if (s) qs.push('start='+encodeURIComponent(s));
  if (e) qs.push('end='+encodeURIComponent(e));
  const r = await api('/api/finance/entries' + (qs.length?`?${qs.join('&')}`:''));
  const entries = r.entries || [];

  // Running all-time (fallback compute if server didn't send)
  let running = r.running;
  if (running == null) {
    running = (r.allEntries || entries).reduce((acc, it) => {
      const amt = +it.amount || 0;
      return acc + (it.type === 'credit' ? amt : -amt);
    }, 0);
  }
  if (Q('#runBalance')) Q('#runBalance').textContent = `${fmt(running)} USD`;

  // Period balance (fallback compute)
  let balance = r.balance;
  if (balance == null) {
    balance = entries.reduce((acc, it) => {
      const amt = +it.amount || 0;
      return acc + (it.type === 'credit' ? amt : -amt);
    }, 0);
  }
  if (Q('#feBalance')) Q('#feBalance').textContent = `Period Balance: ${fmt(balance)} USD`;

  const tb = Q('#feTable tbody'); if (!tb) return;
  tb.innerHTML = entries.map(x => `
    <tr>
      <td>${x.date}</td><td>${x.type}</td><td>${x.category}</td><td>${fmt(x.amount)}</td><td>${x.note||''}</td>
      <td><button class="btn outline danger" data-del-entry="${x.id}">Delete</button></td>
    </tr>`).join('') || `<tr><td colspan="6" class="muted">No entries</td></tr>`;

  tb.onclick = async e => {
    const id = e.target.dataset.delEntry; if (!id) return;
    if (!confirm('Delete this entry?')) return;
    await api('/api/finance/entries/' + id, { method: 'DELETE' });
    renderFinancePeriod();
  };
}

/* =====================================================================
   SETTINGS
   ===================================================================== */
function initSettings() {
  // Countries add
  Q('#ctyAdd')?.addEventListener('click', async () => {
    const name = Q('#cty')?.value?.trim();
    if (!name) return;
    await api('/api/countries', { method: 'POST', body: JSON.stringify({ name }) });
    const c = await api('/api/countries'); state.countries = c.countries || [];
    fillGlobalSelects(); renderCountryChips();
    Q('#cty').value = '';
  });
  renderCountryChips();

  // Product editor
  const sel = Q('#epSelect');
  if (sel) {
    sel.onchange = () => {
      const p = state.products.find(x => x.id === sel.value);
      if (!p) return;
      Q('#epName').value = p.name || '';
      Q('#epSku').value  = p.sku || '';
      Q('#epCost').value = p.cost_china || 0;
      Q('#epShip').value = p.ship_china_to_kenya || 0;
      Q('#epMB').value   = p.margin_budget || 0;
    };
  }
  Q('#epSave')?.addEventListener('click', async () => {
    const id = sel?.value; if (!id) return alert('Select product first');
    const payload = {
      name: Q('#epName')?.value?.trim(),
      sku: Q('#epSku')?.value?.trim(),
      cost_china: +Q('#epCost')?.value || 0,
      ship_china_to_kenya: +Q('#epShip')?.value || 0,
      margin_budget: +Q('#epMB')?.value || 0
    };
    await api('/api/products/' + id, { method: 'PUT', body: JSON.stringify(payload) });
    const pr = await api('/api/products'); state.products = pr.products || [];
    fillGlobalSelects();
    alert('Saved');
  });

  // Snapshots
  Q('#snapSave')?.addEventListener('click', async () => {
    const name = Q('#snapName')?.value?.trim() || '';
    await api('/api/snapshots', { method: 'POST', body: JSON.stringify({ name }) });
    Q('#snapName').value = '';
    renderSnapshots();
  });
  renderSnapshots();
}

function renderCountryChips() {
  const box = Q('#ctyList'); if (!box) return;
  box.innerHTML = state.countries.map(c => {
    const canDelete = c.toLowerCase() !== 'china';
    return `<span class="chip">${c}${canDelete?` <button class="x" data-del-cty="${c}">×</button>`:''}</span>`;
  }).join('') || '—';

  box.onclick = async e => {
    const name = e.target.dataset.delCty; if (!name) return;
    if (!confirm(`Delete country "${name}"?`)) return;
    await api('/api/countries/' + encodeURIComponent(name), { method: 'DELETE' });
    const c = await api('/api/countries'); state.countries = c.countries || [];
    fillGlobalSelects(); renderCountryChips();
  };
}

async function renderSnapshots() {
  const r = await api('/api/snapshots');
  const tb = Q('#snapList'); if (!tb) return;
  tb.innerHTML = (r.snapshots || []).map(s => `
    <tr>
      <td>${s.name}</td><td><small>${s.file}</small></td>
      <td>
        <button class="btn outline" data-push="${s.file}">Push</button>
        <button class="btn outline danger" data-del="${s.id}">Delete</button>
      </td>
    </tr>
  `).join('') || `<tr><td colspan="3" class="muted">No snapshots</td></tr>`;

  tb.onclick = async e => {
    const push = e.target.dataset.push, del = e.target.dataset.del;
    if (push) {
      await api('/api/snapshots/restore', { method: 'POST', body: JSON.stringify({ file: push }) });
      alert('Snapshot pushed. (It remains saved until you delete it.)');
      // optional refresh
      await loadAllData(); renderKpis(); renderStockAndSpendByCountry(); renderProductsTable();
    } else if (del) {
      if (!confirm('Delete this snapshot?')) return;
      await api('/api/snapshots/' + del, { method: 'DELETE' });
      renderSnapshots();
    }
  };
}

/* =====================================================================
   PRODUCT PAGE (product.html?id=...)
   ===================================================================== */
async function loadProduct(id) {
  const r = await api('/api/products');
  state.products = r.products || [];
  state.product  = state.products.find(p => p.id === id) || null;
  if (!state.product) { alert('Product not found'); location.href = '/'; }
}
function renderProductPage() {
  if (!state.product) return;

  // header
  Q('#pdTitle')  && (Q('#pdTitle').textContent = state.product.name);
  Q('#pdSku')    && (Q('#pdSku').textContent   = state.product.sku ? `SKU: ${state.product.sku}` : '');

  // ensure selects filled again (page-level)
  fillGlobalSelects();

  // bind controls
  bindProductControls();

  // initial
  refreshProductSections();
}

function bindProductControls() {
  // Manual per-country “Profit + Ads Budget” (not auto)
  Q('#pdPBSave')?.addEventListener('click', async () => {
    const c = Q('#pdPBCountry')?.value;
    const v = +Q('#pdPBValue')?.value || 0;
    if (!c) return;
    const budgets = Object.assign({}, state.product.budgets || {});
    budgets[c] = v;
    await api('/api/products/' + state.product.id, { method: 'PUT', body: JSON.stringify({ budgets }) });
    await loadProduct(state.product.id);
    renderPBTable();
  });

  // Daily ad spend (replace) for THIS product
  Q('#pdAdSave')?.addEventListener('click', async () => {
    const payload = {
      productId: state.product.id,
      country: Q('#pdAdCountry')?.value,
      platform: Q('#pdAdPlatform')?.value,
      amount: +Q('#pdAdAmount')?.value || 0
    };
    if (!payload.country || !payload.platform) return alert('Pick country & platform');
    await api('/api/adspend', { method: 'POST', body: JSON.stringify(payload) });
    const a = await api('/api/adspend'); state.adspend = a.adSpends ?? a.adspend ?? [];
    renderProductStockAd();
    renderProductAdTable();
  });

  // New shipment for this product
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
    if (!payload.fromCountry || !payload.toCountry) return alert('Select from/to');
    await api('/api/shipments', { method: 'POST', body: JSON.stringify(payload) });
    const r = await api('/api/shipments'); state.shipments = r.shipments || [];
    renderProductTransit();
    renderProductStockAd();
  });

  // Lifetime run filter
  Q('#pdLPRun')?.addEventListener('click', renderProductLifetime);

  // Influencers
  Q('#pdInfAdd')?.addEventListener('click', async () => {
    const name = Q('#pdInfName')?.value?.trim(); if (!name) return;
    const social = Q('#pdInfSocial')?.value?.trim() || '';
    const country = Q('#pdInfCountry')?.value || '';
    await api('/api/influencers', { method: 'POST', body: JSON.stringify({ name, social, country }) });
    Q('#pdInfName').value=''; Q('#pdInfSocial').value='';
    renderInfluencers();
  });
  Q('#pdInfSpendAdd')?.addEventListener('click', async () => {
    const date = Q('#pdInfDate')?.value || todayISO();
    const influencerId = Q('#pdInfSelect')?.value;
    const country = Q('#pdInfCountry')?.value || '';
    const amount = +Q('#pdInfAmount')?.value || 0;
    if (!influencerId) return alert('Select influencer');
    await api('/api/influencers/spend', { method: 'POST', body: JSON.stringify({ date, influencerId, country, productId: state.product.id, amount }) });
    Q('#pdInfAmount').value=''; renderInfluencers();
  });
  Q('#pdInfRun')?.addEventListener('click', renderInfluencers);
}

async function refreshProductSections() {
  // re-pull latest
  const [a, s, r] = await Promise.all([api('/api/adspend'), api('/api/shipments'), api('/api/remittances')]);
  state.adspend = a.adSpends ?? a.adspend ?? [];
  state.shipments = s.shipments || [];
  state.remittances = r.remittances || [];

  renderProductStockAd();
  renderPBTable();
  renderProductAdTable();
  renderProductTransit();
  renderProductLifetime();
  renderInfluencers();
}

/* -- product: Stock & Ad by Country (just this product) -- */
function renderProductStockAd() {
  const tb = Q('#pdStockBody'); if (!tb) return;

  const map = {}; state.countries.forEach(c => map[c] = { stock: 0, ad: 0 });

  // shipments arrived for this product
  state.shipments.filter(x => x.productId === state.product.id && x.arrivedAt).forEach(sp => {
    map[sp.toCountry]   && (map[sp.toCountry].stock   += (+sp.qty || 0));
    map[sp.fromCountry] && (map[sp.fromCountry].stock -= (+sp.qty || 0));
  });

  // remittances subtract pieces
  state.remittances.filter(x => x.productId === state.product.id).forEach(rr => {
    map[rr.country] && (map[rr.country].stock -= (+rr.pieces || 0));
  });

  // adspend (replace records aggregated)
  state.adspend.filter(x => x.productId === state.product.id).forEach(ad => {
    map[ad.country] && (map[ad.country].ad += (+ad.amount || 0));
  });

  let st = 0, at = 0;
  tb.innerHTML = Object.entries(map).map(([c, v]) => {
    st += v.stock; at += v.ad;
    return `<tr><td>${c}</td><td>${fmt(v.stock,0)}</td><td>${fmt(v.ad)}</td></tr>`;
  }).join('');
  Q('#pdStockTotal') && (Q('#pdStockTotal').textContent = fmt(st,0));
  Q('#pdAdTotal')    && (Q('#pdAdTotal').textContent    = fmt(at));
}

/* -- product: manual “Profit + Ads Budget” table -- */
function renderPBTable() {
  const tb = Q('#pdPBBBody'); if (!tb) return;
  const map = state.product.budgets || {};
  tb.innerHTML = state.countries.map(c => `
    <tr>
      <td>${c}</td>
      <td>${fmt(map[c] || 0)}</td>
      <td><button class="btn outline" data-clear-b="${c}">Clear</button></td>
    </tr>
  `).join('');
  tb.onclick = async e => {
    const c = e.target.dataset.clearB; if (!c) return;
    const budgets = Object.assign({}, state.product.budgets || {}); delete budgets[c];
    await api('/api/products/' + state.product.id, { method: 'PUT', body: JSON.stringify({ budgets }) });
    await loadProduct(state.product.id); renderPBTable();
  };
}

/* -- product: ad spend list -- */
function renderProductAdTable() {
  const tb = Q('#pdAdBody'); if (!tb) return;
  const list = state.adspend.filter(x => x.productId === state.product.id);
  tb.innerHTML = list.map(x => `<tr><td>${x.country}</td><td>${x.platform}</td><td>${fmt(x.amount)}</td></tr>`).join('') ||
    `<tr><td colspan="3" class="muted">No ad spend yet</td></tr>`;
}

/* -- product: Transit tables (this product) -- */
function renderProductTransit() {
  const tb1 = Q('#pdShipCKBody'); const tb2 = Q('#pdShipICBody'); if (!tb1 || !tb2) return;
  const list = state.shipments.filter(x => x.productId === state.product.id);

  const row = sp => {
    const days = sp.arrivedAt && sp.departedAt
      ? Math.max(0, Math.round((+new Date(sp.arrivedAt) - +new Date(sp.departedAt)) / 86400000))
      : '';
    return `<tr>
      <td>${sp.id}</td><td>${sp.fromCountry} → ${sp.toCountry}</td>
      <td>${fmt(sp.qty,0)}</td><td>${fmt(sp.shipCost)}</td>
      <td>${sp.departedAt||''}</td><td>${sp.arrivedAt||''}</td><td>${days}</td>
      <td>
        <button class="btn outline" data-arr="${sp.id}">Mark Arrived</button>
        <button class="btn outline" data-edit="${sp.id}">Edit</button>
        <button class="btn outline danger" data-del="${sp.id}">Delete</button>
      </td>
    </tr>`;
  };

  const ck = list.filter(sp => sp.fromCountry?.toLowerCase()==='china' && sp.toCountry?.toLowerCase()==='kenya');
  const ic = list.filter(sp => !(sp.fromCountry?.toLowerCase()==='china' && sp.toCountry?.toLowerCase()==='kenya'));
  tb1.innerHTML = ck.map(row).join('') || `<tr><td colspan="8" class="muted">No shipments</td></tr>`;
  tb2.innerHTML = ic.map(row).join('') || `<tr><td colspan="8" class="muted">No shipments</td></tr>`;

  const host = Q('#productPage') || document;
  host.addEventListener('click', async e => {
    const id = e.target.dataset.arr || e.target.dataset.edit || e.target.dataset.del; if (!id) return;
    if (e.target.dataset.arr) {
      const date = prompt('Arrival date (YYYY-MM-DD)', todayISO()); if (!date) return;
      await api(`/api/shipments/${id}`, { method: 'PUT', body: JSON.stringify({ arrivedAt: date }) });
      const s = await api('/api/shipments'); state.shipments = s.shipments || [];
      renderProductTransit(); renderProductStockAd();
    }
    if (e.target.dataset.edit) {
      const qty = Number(prompt('New quantity?')); const shipCost = Number(prompt('New shipping cost?'));
      if (isNaN(qty) || isNaN(shipCost)) return;
      await api(`/api/shipments/${id}`, { method: 'PUT', body: JSON.stringify({ qty, shipCost }) });
      const s = await api('/api/shipments'); state.shipments = s.shipments || [];
      renderProductTransit();
    }
    if (e.target.dataset.del) {
      if (!confirm('Delete this shipment?')) return;
      await api(`/api/shipments/${id}`, { method: 'DELETE' });
      const s = await api('/api/shipments'); state.shipments = s.shipments || [];
      renderProductTransit(); renderProductStockAd();
    }
  }, { once: true });
}

/* -- product: Lifetime table (by country, filter by date) -- */
function renderProductLifetime() {
  const s = Q('#pdLPStart')?.value || '';
  const e = Q('#pdLPEnd')?.value || '';
  // use current in-memory remittances (they’re already loaded)
  let list = state.remittances.filter(x => x.productId === state.product.id);
  if (s) list = list.filter(x => x.start >= s);
  if (e) list = list.filter(x => x.end <= e);

  const prod = state.product;
  const basePerPiece = (+prod.cost_china || 0) + (+prod.ship_china_to_kenya || 0);

  const byC = {};
  list.forEach(x => {
    const k = x.country;
    byC[k] = byC[k] || { rev:0, ad:0, ship:0, base:0, pcs:0, profit:0 };
    const pcs = +x.pieces || 0;
    const extra = (+x.extraPerPiece || 0) * pcs;
    byC[k].rev  += (+x.revenue || 0);
    byC[k].ad   += (+x.adSpend || 0);
    byC[k].ship += extra;
    byC[k].base += basePerPiece * pcs;
    byC[k].pcs  += pcs;
  });
  Object.values(byC).forEach(v => v.profit = v.rev - v.ad - v.ship - v.base);

  const tb = Q('#pdLPBody'); if (!tb) return;
  let R=0,A=0,S=0,B=0,P=0,PCS=0;
  tb.innerHTML = Object.entries(byC).map(([c,v]) => {
    R+=v.rev; A+=v.ad; S+=v.ship; B+=v.base; P+=v.profit; PCS+=v.pcs;
    return `<tr><td>${c}</td><td>${fmt(v.rev)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.ship)}</td><td>${fmt(v.base)}</td><td>${fmt(v.pcs,0)}</td><td>${fmt(v.profit)}</td></tr>`;
  }).join('') || `<tr><td colspan="7" class="muted">No data</td></tr>`;
  Q('#pdLPRevT')?.innerText   = fmt(R);
  Q('#pdLPAdT')?.innerText    = fmt(A);
  Q('#pdLPShipT')?.innerText  = fmt(S);
  Q('#pdLPBaseT')?.innerText  = fmt(B);
  Q('#pdLPPcsT')?.innerText   = fmt(PCS,0);
  Q('#pdLPProfitT')?.innerText= fmt(P);
}

/* -- product: Influencers & spends -- */
async function renderInfluencers() {
  const infs = await api('/api/influencers');
  const spends = await api('/api/influencers/spend');
  // select options
  if (Q('#pdInfSelect')) {
    Q('#pdInfSelect').innerHTML = (infs.influencers||[]).map(i => `<option value="${i.id}">${i.name}</option>`).join('');
  }

  // filters
  const s = Q('#pdInfStart')?.value || '';
  const e = Q('#pdInfEnd')?.value || '';
  const c = Q('#pdInfFilterCountry')?.value || '';

  const list = (spends.spends || [])
    .filter(x => x.productId === state.product.id)
    .filter(x => (!s || x.date >= s) && (!e || x.date <= e))
    .filter(x => (!c || x.country === c));

  const byId = Object.fromEntries((infs.influencers||[]).map(i => [i.id, i]));
  const tb = Q('#pdInfBody'); if (!tb) return;
  let total = 0;
  tb.innerHTML = list.map(x => {
    total += (+x.amount||0);
    const i = byId[x.influencerId] || {};
    return `<tr>
      <td>${x.date}</td><td>${x.country||''}</td>
      <td>${i.name||'-'}</td><td>${i.social||'-'}</td><td>${fmt(x.amount)}</td>
      <td><button class="btn outline danger" data-del-infsp="${x.id}">Delete</button></td>
    </tr>`;
  }).join('') || `<tr><td colspan="6" class="muted">No spends</td></tr>`;
  Q('#pdInfTotal') && (Q('#pdInfTotal').textContent = fmt(total));

  tb.onclick = async e => {
    const id = e.target.dataset.delInfsp; if (!id) return;
    if (!confirm('Delete this spend?')) return;
    await api('/api/influencers/spend/'+id, { method: 'DELETE' });
    renderInfluencers();
  };
}

/* =====================================================================
   NAV
   ===================================================================== */
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

/* =====================================================================
   BOOT
   ===================================================================== */
boot();
