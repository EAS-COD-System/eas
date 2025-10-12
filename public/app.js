/* =========================
   EAS Tracker – Front-end
   Works for both index.html and product.html
   ========================= */

/* ---------- helpers ---------- */
const Q  = (s, r = document) => r.querySelector(s);
const QA = (s, r = document) => Array.from(r.querySelectorAll(s));
const fmt = n => (Number(n || 0)).toLocaleString(undefined, { maximumFractionDigits: 2 });
const todayISO = () => new Date().toISOString().slice(0, 10);
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
  view: 'home',
  countries: [],
  products: [],
  categories: { debit: [], credit: [] },
  product: null,
  productId: getQuery('id')
};

/* =================== AUTH/BOOT =================== */
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
    Q('#login')?.classList.remove('hide');
    Q('#main')?.setAttribute('style', 'display:none');
  }
}

Q('#loginBtn')?.addEventListener('click', async () => {
  const password = Q('#pw').value;
  if (!password) return;
  try {
    await api('/api/auth', { method: 'POST', body: JSON.stringify({ password }) });
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

/* =================== COMMON DATA =================== */
async function preloadProducts() {
  try {
    const r = await api('/api/products');
    state.products = r.products || [];
  } catch { state.products = []; }
}

function optionTag(value, label = value) { return `<option value="${value}">${label}</option>`; }

function fillCountrySelect(el, { includeAll = false, excludeChina = false } = {}) {
  if (!el) return;
  const countries = state.countries.filter(c => !(excludeChina && c.toLowerCase() === 'china'));
  el.innerHTML =
    (includeAll ? optionTag('', 'All countries') : '') +
    countries.map(c => optionTag(c)).join('');
}
function fillProductSelect(el, { includeAll = false } = {}) {
  if (!el) return;
  el.innerHTML =
    (includeAll ? optionTag('', 'All products') : '') +
    state.products.map(p => optionTag(p.id, `${p.name}${p.sku ? ' (' + p.sku + ')' : ''}`)).join('');
}

function fillGlobalSelects() {
  // Countries (general)
  ['#mvFrom','#mvTo','#adCountry','#pcCountry','#pfCountry',
   '#pdAdCountry','#pdRCountry','#pdMvFrom','#pdMvTo',
   '#lpCountry'
  ].forEach(sel => QA(sel).forEach(el => fillCountrySelect(el, { includeAll: el.id==='pfCountry' || el.id==='lpCountry' })));

  // Remittance country (exclude china)
  QA('#rCountry').forEach(el => fillCountrySelect(el, { excludeChina: true }));

  // Products
  ['#adProduct','#mvProduct','#rProduct','#lpProduct'].forEach(sel =>
    QA(sel).forEach(el => fillProductSelect(el, { includeAll: el.id==='lpProduct' })));

  // Performance country already done via pfCountry above
}

/* ========================================================
   DASHBOARD
   ======================================================== */
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

  // total ad spend (sum of current daily adspend records)
  try {
    const a = await api('/api/adspend');
    const total = (a.adSpends || []).reduce((t, x) => t + (+x.amount || 0), 0);
    Q('#kpiAdSpend') && (Q('#kpiAdSpend').textContent = fmt(total) + ' USD');
  } catch { Q('#kpiAdSpend') && (Q('#kpiAdSpend').textContent = '—'); }

  // Delivered Mon–Sun (KPI comes from current week total)
  try {
    const r = await api('/api/deliveries');
    const days = weekRangeFrom(todayISO());
    const set = new Set(days);
    const total = (r.deliveries || []).filter(d => set.has(d.date)).reduce((s, d) => s + (+d.delivered||0), 0);
    Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = fmt(total));
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
        const to = sp.toCountry || sp.to;
        const from = sp.fromCountry || sp.from;
        per[to] = per[to] || { stock:0, ad:0 };
        per[to].stock += (+sp.qty || 0);
        if (from) {
          per[from] = per[from] || { stock:0, ad:0 };
          per[from].stock -= (+sp.qty || 0);
        }
      }
    });
  } catch {}

  // subtract delivered pieces via remittances
  try {
    const r = await api('/api/remittances');
    (r.remittances || []).forEach(rr => {
      if (!per[rr.country]) per[rr.country] = { stock:0, ad:0 };
      per[rr.country].stock -= (+rr.pieces || 0);
    });
  } catch {}

  // ad spend comes from /api/adspend (replace model)
  try {
    const a = await api('/api/adspend');
    (a.adSpends || []).forEach(x => {
      if (!per[x.country]) per[x.country] = { stock:0, ad:0 };
      per[x.country].ad += (+x.amount || 0);
    });
  } catch {}

  let stockT = 0, adT = 0;
  body.innerHTML = Object.entries(per).map(([c,v]) => {
    stockT += v.stock; adT += v.ad;
    return `<tr><td>${c}</td><td>${fmt(v.stock)}</td><td>${fmt(v.ad)}</td></tr>`;
  }).join('') || `<tr><td colspan="3" class="muted">No data</td></tr>`;
  Q('#stockTotal').textContent = fmt(stockT);
  Q('#adTotal').textContent = fmt(adT);
}

/* ---- Weekly Delivered grid (Mon–Sun x Countries) ---- */
function weekRangeFrom(dateISO) {
  const d = new Date(dateISO);
  const day = (d.getDay() + 6) % 7; // Monday=0
  d.setDate(d.getDate() - day);
  return [...Array(7)].map((_, i) => {
    const dd = new Date(d); dd.setDate(d.getDate() + i);
    return dd.toISOString().slice(0,10);
  });
}

let weeklyBase = todayISO();

async function initWeeklyDelivered() {
  const head = Q('#weeklyHead'), body = Q('#weeklyBody'); if (!head || !body) return;

  function paintWeek() {
    const days = weekRangeFrom(weeklyBase);
    head.innerHTML = `<tr><th>Country</th>${
      days.map(d => `<th>${new Date(d).toLocaleDateString(undefined,{weekday:'short'})}<br>${d}</th>`).join('')
    }<th>Total</th></tr>`;

    body.innerHTML = state.countries.map(c => {
      const cells = days.map(d => `<td><input class="wd-cell" data-country="${c}" data-date="${d}" type="number" min="0" placeholder="0"/></td>`).join('');
      return `<tr data-row="${c}"><td>${c}</td>${cells}<td class="row-total">0</td></tr>`;
    }).join('');

    // load existing for this week
    preloadWeek(days).then(() => computeWeeklyTotals());
    Q('#weeklyRange').textContent = `Week: ${days[0]} → ${days[6]}`;
  }

  async function preloadWeek(days) {
    const r = await api('/api/deliveries');
    const byKey = {};
    (r.deliveries || []).forEach(x => { byKey[`${x.country}|${x.date}`] = +x.delivered || 0; });
    QA('.wd-cell').forEach(inp => {
      const k = `${inp.dataset.country}|${inp.dataset.date}`;
      if (byKey[k] != null) inp.value = byKey[k];
    });
  }

  paintWeek();

  Q('#weeklyPrev')?.addEventListener('click', () => {
    const d = new Date(weeklyBase); d.setDate(d.getDate() - 7); weeklyBase = d.toISOString().slice(0,10); paintWeek();
  });
  Q('#weeklyNext')?.addEventListener('click', () => {
    const d = new Date(weeklyBase); d.setDate(d.getDate() + 7); weeklyBase = d.toISOString().slice(0,10); paintWeek();
  });

  Q('#weeklySave')?.addEventListener('click', async () => {
    const payloads = [];
    QA('.wd-cell').forEach(inp => {
      const v = +inp.value || 0;
      if (v > 0) payloads.push({ date: inp.dataset.date, country: inp.dataset.country, delivered: v });
    });
    try {
      for (const rec of payloads) {
        await api('/api/deliveries', { method:'POST', body: JSON.stringify(rec) });
      }
      alert('Saved!');
      computeWeeklyTotals();
      renderKpis(); // update KPI Delivered (Mon–Sun)
    } catch (e) { alert(e.message); }
  });

  Q('#weeklyReset')?.addEventListener('click', () => {
    QA('.wd-cell').forEach(inp => inp.value = '');
    computeWeeklyTotals();
    renderKpis();
  });

  Q('#weeklyTable')?.addEventListener('input', e => {
    if (e.target.classList.contains('wd-cell')) computeWeeklyTotals();
  });
}

function computeWeeklyTotals() {
  // per-row totals
  QA('tr[data-row]').forEach(tr => {
    const t = QA('.wd-cell', tr).reduce((s, el) => s + (+el.value || 0), 0);
    Q('.row-total', tr).textContent = fmt(t);
  });
  // per-column + grand
  const cols = QA('thead th', Q('#weeklyTable')).length - 2;
  let grand = 0;
  for (let i = 0; i < cols; i++) {
    let sum = 0;
    QA('tr[data-row]').forEach(tr => sum += (+QA('.wd-cell', tr)[i].value || 0));
    QA('tfoot .totals th')[i+1].textContent = fmt(sum);
    grand += sum;
  }
  Q('#wAllT').textContent = fmt(grand);
}

/* ---- Daily Ad Spend (replace by product/country/platform) ---- */
function initDailyAdSpend() {
  Q('#adSave')?.addEventListener('click', async () => {
    const payload = {
      productId: Q('#adProduct')?.value,
      country: Q('#adCountry')?.value,
      platform: Q('#adPlatform')?.value,
      amount: +Q('#adAmount')?.value || 0
    };
    if (!payload.productId || !payload.country || !payload.platform) return alert('Missing fields');
    try {
      await api('/api/adspend', { method:'POST', body: JSON.stringify(payload) });
      alert('Saved');
      renderKpis();
      renderStockAndSpendByCountry();
    } catch (e) { alert(e.message); }
  });
}

/* ---- Movements (create shipment) ---- */
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

/* ---- Transit tables & actions ---- */
async function renderTransitTables() {
  const s = await api('/api/shipments');
  const list = (s.shipments || []).filter(x => !x.arrivedAt);
  const productsById = Object.fromEntries((state.products || []).map(p => [p.id, p.name]));

  const row = sp => {
    const name = productsById[sp.productId] || sp.productId;
    const days = sp.arrivedAt ? Math.max(0, Math.round((+new Date(sp.arrivedAt) - +new Date(sp.departedAt)) / 86400000)) : '';
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
        <button class="btn outline" data-arr="${sp.id}">Mark Arrived</button>
        <button class="btn outline" data-edit="${sp.id}">Edit</button>
        <button class="btn outline" data-del="${sp.id}">Delete</button>
      </td>
    </tr>`;
  };

  // China→Kenya
  const ck = list.filter(sp =>
    (sp.fromCountry||sp.from||'').toLowerCase()==='china' &&
    (sp.toCountry||sp.to||'').toLowerCase()==='kenya'
  );
  Q('#shipCKBody') && (Q('#shipCKBody').innerHTML = ck.map(row).join('') || `<tr><td colspan="9" class="muted">No transit</td></tr>`);

  // Inter-country
  const ic = list.filter(sp => !ck.includes(sp));
  Q('#shipICBody') && (Q('#shipICBody').innerHTML = ic.map(row).join('') || `<tr><td colspan="9" class="muted">No transit</td></tr>`);

  // actions
  const tableWrap = document; // delegate on document
  tableWrap.querySelectorAll('[data-arr]').forEach(b => b.onclick = async () => {
    const id = b.dataset.arr;
    const date = prompt('Arrival date (YYYY-MM-DD)', todayISO());
    if (!date) return;
    try {
      await api(`/api/shipments/${id}`, { method:'PUT', body: JSON.stringify({ arrivedAt: date }) });
      renderTransitTables();
      renderStockAndSpendByCountry();
    } catch (e) { alert(e.message); }
  });
  tableWrap.querySelectorAll('[data-edit]').forEach(b => b.onclick = async () => {
    const id = b.dataset.edit;
    const qty = Number(prompt('New quantity?'));
    const shipCost = Number(prompt('New shipping cost?'));
    if (Number.isNaN(qty) || Number.isNaN(shipCost)) return;
    await api(`/api/shipments/${id}`, { method:'PUT', body: JSON.stringify({ qty, shipCost }) });
    renderTransitTables();
  });
  tableWrap.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const id = b.dataset.del;
    if (!confirm('Delete this shipment?')) return;
    await api(`/api/shipments/${id}`, { method:'DELETE' });
    renderTransitTables();
  });
}

/* ---- Profit by Country (from remittances) ---- */
function initProfitByCountry() {
  Q('#pcRun')?.addEventListener('click', async () => {
    const s = Q('#pcStart')?.value, e = Q('#pcEnd')?.value, c = Q('#pcCountry')?.value || '';
    const qs = [];
    if (s) qs.push('start=' + s);
    if (e) qs.push('end=' + e);
    try {
      const r = await api('/api/remittances' + (qs.length ? '?' + qs.join('&') : ''));
      const byC = {};
      (r.remittances || []).forEach(x => {
        if (c && x.country !== c) return;
        byC[x.country] = byC[x.country] || { rev:0, ad:0, extra:0, pcs:0 };
        byC[x.country].rev += +x.revenue || 0;
        byC[x.country].ad += +x.adSpend || 0;
        byC[x.country].extra += (+x.extraPerPiece || 0) * (+x.pieces || 0);
        byC[x.country].pcs += +x.pieces || 0;
      });
      const tb = Q('#profitCountryBody');
      let R=0,A=0,E=0,P=0,PCS=0;
      tb.innerHTML = Object.entries(byC).map(([cc,v])=>{
        const prof = v.rev - v.ad - v.extra;
        R+=v.rev; A+=v.ad; E+=v.extra; PCS+=v.pcs; P+=prof;
        return `<tr><td>${cc}</td><td>${fmt(v.rev)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.extra)}</td><td>${fmt(v.pcs)}</td><td>${fmt(prof)}</td></tr>`;
      }).join('') || `<tr><td colspan="6" class="muted">No data</td></tr>`;
      Q('#pcRevT').textContent = fmt(R);
      Q('#pcAdT').textContent = fmt(A);
      Q('#pcDelT').textContent = fmt(E);
      Q('#pcPiecesT').textContent = fmt(PCS);
      Q('#pcProfitT').textContent = fmt(P);
    } catch (e) { alert(e.message); }
  });
}

/* ---- To-Dos (localStorage) ---- */
function initTodos() {
  const KEY='eas_todos', WEEK='eas_weekly';
  const load = k => JSON.parse(localStorage.getItem(k)||'[]');
  const save = (k,v) => localStorage.setItem(k, JSON.stringify(v));

  // quick
  (function renderQuick(){
    const ul = Q('#todoList'); if (!ul) return;
    let list = load(KEY);
    const paint = () => {
      ul.innerHTML = list.map(t =>
        `<div class="flex"><span>${t.done?'✅ ':''}${t.text}</span>
         <button class="btn outline" data-done="${t.id}">${t.done?'Undo':'Done'}</button>
         <button class="btn outline" data-del="${t.id}">Delete</button></div>`).join('');
    };
    paint();
    Q('#todoAdd')?.addEventListener('click', () => {
      const v = Q('#todoText').value.trim(); if (!v) return;
      list.push({ id: crypto.randomUUID(), text: v, done:false }); save(KEY,list); paint();
    });
    ul.onclick = e => {
      if (e.target.dataset.done) { const it = list.find(x=>x.id===e.target.dataset.done); it.done=!it.done; save(KEY,list); paint(); }
      if (e.target.dataset.del) { list = list.filter(x=>x.id!==e.target.dataset.del); save(KEY,list); paint(); }
    };
  })();

  // weekly
  (function renderWeekly(){
    const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    const wrap = Q('#weeklyWrap'); if (!wrap) return;
    const data = JSON.parse(localStorage.getItem(WEEK) || '{}');
    const paint = () => {
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
    };
    paint();
    wrap.onclick = e => {
      if (e.target.dataset.add) {
        const d=e.target.dataset.add, v=Q('#w_'+d).value.trim(); if (!v) return;
        data[d]=(data[d]||[]).concat({ id:crypto.randomUUID(), text:v, done:false }); localStorage.setItem(WEEK, JSON.stringify(data)); paint();
      }
      if (e.target.dataset.tgl) {
        const [d,id]=e.target.dataset.tgl.split('|'); const it=(data[d]||[]).find(x=>x.id===id); if (it){ it.done=!it.done; localStorage.setItem(WEEK, JSON.stringify(data)); paint();}
      }
      if (e.target.dataset.del) {
        const [d,id]=e.target.dataset.del.split('|'); data[d]=(data[d]||[]).filter(x=>x.id!==id); localStorage.setItem(WEEK, JSON.stringify(data)); paint();
      }
    };
  })();
}

/* ========================================================
   PRODUCTS (list view)
   ======================================================== */
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
    await preloadProducts();
    fillGlobalSelects();
    renderProductsTable();
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
      if (!confirm('Delete product and all related data?')) return;
      await api('/api/products/' + del, { method:'DELETE' });
      await preloadProducts(); fillGlobalSelects(); renderProductsTable();
      renderStockAndSpendByCountry();
      renderKpis();
    }
  };
}

/* ========================================================
   PERFORMANCE
   ======================================================== */
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
    if (end) qs.push('end='+end);
    const r = await api('/api/remittances' + (qs.length?('?'+qs.join('&')):''));

    const prodMap = Object.fromEntries(state.products.map(p=>[p.id,p]));
    const rows = [];
    const acc = {}; // productId|country -> obj

    (r.remittances || []).forEach(x => {
      if (c && x.country !== c) return;
      const key = `${x.productId}|${x.country}`;
      if (!acc[key]) acc[key] = { name: prodMap[x.productId]?.name || x.productId, country: x.country, pieces:0, ad:0, prodCost:0, profit:0 };
      acc[key].pieces += (+x.pieces||0);
      acc[key].ad += (+x.adSpend||0);
      const base = (+prodMap[x.productId]?.cost_china||0) + (+prodMap[x.productId]?.ship_china_to_kenya||0);
      const extra = (+x.extraPerPiece||0) * (+x.pieces||0);
      acc[key].prodCost += base * (+x.pieces||0);
      acc[key].profit += (+x.revenue||0) - (+x.adSpend||0) - extra - (base*(+x.pieces||0));
    });

    Object.values(acc).sort((a,b)=>b.pieces-a.pieces).forEach(it => {
      rows.push(`<tr><td>${it.name}</td><td>${it.country}</td><td>${fmt(it.pieces)}</td><td>${fmt(it.ad)}</td><td>${fmt(it.prodCost)}</td><td>${fmt(it.profit)}</td><td>${it.pieces?fmt(it.profit/it.pieces):'0'}</td></tr>`);
    });

    Q('#pfTable tbody').innerHTML = rows.join('') || `<tr><td colspan="7" class="muted">No data</td></tr>`;
  });

  // Remittance create
  Q('#rAdd')?.addEventListener('click', async () => {
    const payload = {
      start: Q('#rStart').value, end: Q('#rEnd').value,
      country: Q('#rCountry').value, productId: Q('#rProduct').value,
      orders: +Q('#rOrders').value || 0, pieces: +Q('#rPieces').value || 0,
      revenue: +Q('#rRev').value || 0, adSpend: +Q('#rAds').value || 0,
      extraPerPiece: +Q('#rExtra').value || 0
    };
    if (!payload.start || !payload.end || !payload.country || !payload.productId) return alert('Missing fields');
    await api('/api/remittances', { method:'POST', body: JSON.stringify(payload) });
    Q('#rMsg').textContent = 'Saved!';
    setTimeout(()=> Q('#rMsg').textContent='', 1500);
  });
}

/* ========================================================
   FINANCE
   ======================================================== */
async function initFinance() {
  await loadFinanceCats();

  Q('#fcAdd')?.addEventListener('click', async () => {
    const type = Q('#fcType').value, name = Q('#fcName').value.trim();
    if (!name) return;
    await api('/api/finance/categories', { method:'POST', body: JSON.stringify({ type, name }) });
    Q('#fcName').value = '';
    await loadFinanceCats();
  });

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
    // lists with delete
    const paintList = (id, arr, type) => {
      const el = Q(id); if (!el) return;
      el.innerHTML = (arr||[]).map(c => `<span class="chip">${c}<button class="chip-x" data-del-cat="${type}|${c}">×</button></span>`).join('') || '—';
    };
    paintList('#fcDebits', cats.debit, 'debit');
    paintList('#fcCredits', cats.credit, 'credit');

    // delete handler
    Q('.cats')?.addEventListener('click', async e => {
      const key = e.target.dataset.delCat;
      if (!key) return;
      const [type,name] = key.split('|');
      await api(`/api/finance/categories?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}`, { method:'DELETE' });
      await loadFinanceCats();
      renderFinancePeriod();
    }, { once: true });

    // entry category select
    const all = [...cats.debit, ...cats.credit].sort();
    Q('#feCat') && (Q('#feCat').innerHTML = `<option value="" disabled selected>Select category</option>` + all.map(c=>`<option>${c}</option>`).join(''));
  } catch {}
}

async function renderFinancePeriod() {
  try {
    const s = Q('#fes')?.value, e = Q('#fee')?.value;
    const r = await api('/api/finance/entries' + ((s||e)?(`?start=${s||''}&end=${e||''}`):''));
    const entries = r.entries || [];
    Q('#runBalance') && (Q('#runBalance').textContent = fmt(r.running || 0) + ' USD');
    Q('#feBalance') && (Q('#feBalance').textContent = 'Period Balance: ' + fmt(r.balance || 0) + ' USD');
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

/* ========================================================
   SETTINGS
   ======================================================== */
function initSettings() {
  // Countries add
  Q('#ctyAdd')?.addEventListener('click', async () => {
    const name = Q('#cty').value.trim(); if (!name) return;
    await api('/api/countries', { method:'POST', body: JSON.stringify({ name }) });
    const m = await api('/api/meta'); state.countries = m.countries || [];
    fillGlobalSelects(); renderCountryChips();
  });
  renderCountryChips();

  // Product editor
  const sel = Q('#epSelect');
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
      await preloadProducts(); alert('Saved');
    });
  }

  // snapshots
  Q('#snapSave')?.addEventListener('click', async () => {
    const name = Q('#snapName').value.trim() || `Manual ${new Date().toLocaleString()}`;
    const r = await api('/api/snapshots', { method:'POST', body: JSON.stringify({ name }) });
    Q('#snapName').value = '';
    renderSnapshots();
  });
  renderSnapshots();
}

function renderCountryChips() {
  const list = Q('#ctyList'); if (!list) return;
  list.innerHTML = state.countries.map(c => {
    const locked = c.toLowerCase()==='china';
    return `<span class="chip ${locked?'locked':''}">${c}${locked?'':'<button class="chip-x" data-del-cty="'+c+'">×</button>'}</span>`;
  }).join('') || '—';

  list.onclick = async e => {
    const n = e.target.dataset.delCty; if (!n) return;
    if (!confirm(`Delete country "${n}"?`)) return;
    await api('/api/countries/' + encodeURIComponent(n), { method:'DELETE' });
    const m = await api('/api/meta'); state.countries = m.countries || [];
    fillGlobalSelects(); renderCountryChips(); renderStockAndSpendByCountry();
  };
}

async function renderSnapshots() {
  const r = await api('/api/snapshots');
  const box = Q('#snapList'); if (!box) return;
  box.innerHTML = (r.snapshots || []).map(s =>
    `<tr>
      <td>${s.name}</td>
      <td>${s.file.split('/').pop()}</td>
      <td>
        <button class="btn outline" data-push="${s.file}">Push</button>
        <button class="btn outline" data-del-snap="${s.id}">Delete</button>
      </td>
    </tr>`
  ).join('') || '<tr><td colspan="3" class="muted">No snapshots yet</td></tr>';

  box.onclick = async e => {
    if (e.target.dataset.push) {
      await api('/api/snapshots/restore', { method:'POST', body: JSON.stringify({ file: e.target.dataset.push }) });
      alert('Snapshot pushed'); // keep in list (do NOT delete)
      location.reload();
    } else if (e.target.dataset.delSnap) {
      if (!confirm('Delete this snapshot?')) return;
      await api('/api/snapshots/' + e.target.dataset.delSnap, { method:'DELETE' });
      renderSnapshots();
    }
  };
}

/* ========================================================
   PRODUCT PAGE
   ======================================================== */
async function loadProduct(id) {
  await preloadProducts();
  state.product = state.products.find(p => p.id === id) || null;
}

function renderProductPage() {
  if (!state.product) { alert('Product not found'); location.href='/'; return; }
  Q('#pdTitle') && (Q('#pdTitle').textContent = state.product.name);
  Q('#pdSku') && (Q('#pdSku').textContent = state.product.sku ? `SKU: ${state.product.sku}` : '');

  // ensure selects
  fillGlobalSelects();

  bindProductHandlers();
  refreshProductSections();
}

function bindProductHandlers() {
  // manual per-country budget (reference only)
  Q('#pdPBSave')?.addEventListener('click', async () => {
    const country = Q('#pdPBCountry').value; const value = +Q('#pdPBValue').value || 0;
    const p = { budgets: state.product.budgets || {} }; p.budgets[country] = value;
    await api('/api/products/' + state.product.id, { method:'PUT', body: JSON.stringify(p) });
    await loadProduct(state.product.id); renderPBTable();
  });

  // daily ad spend (replace)
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

  // stock movement for this product
  Q('#pdMvAdd')?.addEventListener('click', async () => {
    const payload = {
      productId: state.product.id,
      fromCountry: Q('#pdMvFrom').value,
      toCountry: Q('#pdMvTo').value,
      qty: +Q('#pdMvQty').value || 0,
      shipCost: +Q('#pdMvShip').value || 0,
      departedAt: todayISO(),
      arrivedAt: null
    };
    if (!payload.fromCountry || !payload.toCountry || !payload.qty) return alert('Missing fields');
    await api('/api/shipments', { method:'POST', body: JSON.stringify(payload) });
    refreshProductSections();
  });

  // lifetime run
  Q('#pdLPRun')?.addEventListener('click', () => renderProductLifetime());
}

async function refreshProductSections() {
  await loadProduct(state.product.id);
  renderProductStockAd();
  renderPBTable();
  renderProductAdList();
  renderProductTransit();
  renderProductLifetime();
}

/* -- product stock & ad spend: ONLY this product -- */
async function renderProductStockAd() {
  const tb = Q('#pdStockBody'); if (!tb) return;

  const per = {}; state.countries.forEach(c => per[c] = { stock: 0, ad: 0 });

  const s = await api('/api/shipments');
  (s.shipments || []).filter(x=>x.productId===state.product.id && x.arrivedAt).forEach(sp => {
    const to = sp.toCountry || sp.to, from = sp.fromCountry || sp.from, q = (+sp.qty||0);
    per[to] = per[to]||{stock:0,ad:0}; per[to].stock += q;
    if (from) { per[from]=per[from]||{stock:0,ad:0}; per[from].stock -= q; }
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
  tb.innerHTML = state.countries.map(c=>{
    const v = per[c] || { stock:0, ad:0 };
    st+=v.stock; at+=v.ad;
    return `<tr><td>${c}</td><td>${fmt(v.stock)}</td><td>${fmt(v.ad)}</td></tr>`;
  }).join('');
  Q('#pdStockTotal') && (Q('#pdStockTotal').textContent = fmt(st));
  Q('#pdAdTotal') && (Q('#pdAdTotal').textContent = fmt(at));

  // transit badge
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
  `).join('');
  tb.onclick = async e => {
    const c = e.target.dataset.clearB;
    if (!c) return;
    const p = { budgets: state.product.budgets || {} }; delete p.budgets[c];
    await api('/api/products/' + state.product.id, { method:'PUT', body: JSON.stringify(p) });
    await loadProduct(state.product.id); renderPBTable();
  };
}

/* -- product: ad list -- */
async function renderProductAdList() {
  const a = await api('/api/adspend');
  const list = (a.adSpends || []).filter(x=>x.productId===state.product.id);
  const tb = Q('#pdAdBody'); if (!tb) return;
  tb.innerHTML = list.map(x => `<tr><td>${x.country}</td><td>${x.platform}</td><td>${fmt(x.amount)}</td></tr>`).join('') ||
    `<tr><td colspan="3" class="muted">No ad spend yet</td></tr>`;
}

/* -- product: transit tables (only this product) -- */
async function renderProductTransit() {
  const s = await api('/api/shipments');
  const list = (s.shipments || []).filter(x=>x.productId===state.product.id);

  const ck = list.filter(sp =>
    (sp.fromCountry||sp.from||'').toLowerCase()==='china' &&
    (sp.toCountry||sp.to||'').toLowerCase()==='kenya'
  );
  const ic = list.filter(sp => !ck.includes(sp));

  const row = sp => {
    const days = sp.arrivedAt ? Math.max(0, Math.round((+new Date(sp.arrivedAt) - +new Date(sp.departedAt)) / 86400000)) : '';
    return `<tr>
      <td>${sp.id}</td><td>${(sp.fromCountry||sp.from)} → ${(sp.toCountry||sp.to)}</td>
      <td>${fmt(sp.qty)}</td><td>${fmt(sp.shipCost)}</td>
      <td>${sp.departedAt||''}</td><td>${sp.arrivedAt||''}</td><td>${days}</td>
      <td>
        <button class="btn outline" data-arr="${sp.id}">Mark Arrived</button>
        <button class="btn outline" data-edit="${sp.id}">Edit</button>
        <button class="btn outline" data-del="${sp.id}">Delete</button>
      </td>
    </tr>`;
  };

  Q('#pdShipCKBody') && (Q('#pdShipCKBody').innerHTML = ck.map(row).join('') || `<tr><td colspan="8" class="muted">No shipments</td></tr>`);
  Q('#pdShipICBody') && (Q('#pdShipICBody').innerHTML = ic.map(row).join('') || `<tr><td colspan="8" class="muted">No shipments</td></tr>`);

  // actions (reuse)
  QA('[data-arr]').forEach(b => b.onclick = async () => {
    const id = b.dataset.arr;
    const date = prompt('Arrival date (YYYY-MM-DD)', todayISO()); if (!date) return;
    await api('/api/shipments/' + id, { method:'PUT', body: JSON.stringify({ arrivedAt: date }) });
    renderProductTransit(); renderProductStockAd();
  });
  QA('[data-edit]').forEach(b => b.onclick = async () => {
    const id = b.dataset.edit;
    const qty = Number(prompt('New qty?')); const shipCost = Number(prompt('New shipping cost?'));
    if (Number.isNaN(qty) || Number.isNaN(shipCost)) return;
    await api('/api/shipments/' + id, { method:'PUT', body: JSON.stringify({ qty, shipCost }) });
    renderProductTransit();
  });
  QA('[data-del]').forEach(b => b.onclick = async () => {
    const id = b.dataset.del; if (!confirm('Delete shipment?')) return;
    await api('/api/shipments/' + id, { method:'DELETE' });
    renderProductTransit();
  });
}

/* -- product: lifetime table (only this product) -- */
async function renderProductLifetime() {
  const s = Q('#pdLPStart')?.value, e = Q('#pdLPEnd')?.value;
  const r = await api('/api/remittances' + ((s||e)?`?start=${s||''}&end=${e||''}`:''));
  const list = (r.remittances || []).filter(x=>x.productId===state.product.id);

  const prod = state.product;
  const baseCostPerPiece = (+prod.cost_china||0) + (+prod.ship_china_to_kenya||0);

  const byCountry = {};
  list.forEach(x => {
    const k = x.country;
    if (!byCountry[k]) byCountry[k] = { rev:0, ad:0, ship:0, base:0, pcs:0, profit:0 };
    const pcs = +x.pieces || 0;
    const extra = (+x.extraPerPiece||0) * pcs;
    byCountry[k].rev += +x.revenue || 0;
    byCountry[k].ad += +x.adSpend || 0;
    byCountry[k].ship += extra;
    byCountry[k].base += baseCostPerPiece * pcs;
    byCountry[k].pcs += pcs;
  });
  Object.values(byCountry).forEach(v => v.profit = v.rev - v.ad - v.ship - v.base);

  const tb = Q('#pdLPBody'); if (!tb) return;
  let R=0,A=0,S=0,B=0,P=0,PCS=0;
  tb.innerHTML = Object.entries(byCountry).map(([c,v])=>{
    R+=v.rev; A+=v.ad; S+=v.ship; B+=v.base; P+=v.profit; PCS+=v.pcs;
    return `<tr><td>${c}</td><td>${fmt(v.rev)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.ship)}</td><td>${fmt(v.base)}</td><td>${fmt(v.pcs)}</td><td>${fmt(v.profit)}</td></tr>`;
  }).join('') || `<tr><td colspan="7" class="muted">No data</td></tr>`;
  Q('#pdLPRevT').textContent = fmt(R); Q('#pdLPAdT').textContent = fmt(A);
  Q('#pdLPShipT').textContent = fmt(S); Q('#pdLPBaseT').textContent = fmt(B);
  Q('#pdLPPcsT').textContent = fmt(PCS); Q('#pdLPProfitT').textContent = fmt(P);
}

/* ========================================================
   NAV
   ======================================================== */
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

/* ========================================================
   BOOT
   ======================================================== */
gate();
