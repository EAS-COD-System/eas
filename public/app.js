// ==============================
// EAS Tracker - public/app.js
// ==============================

// ---------- tiny helpers ----------
const state = {
  view: 'home',
  products: [],
  countries: [],
  week: { startISO: '', days: [] }, // Mon..Sun yyyy-mm-dd[]
  productOpenId: null,
  financeCats: { debits: [], credits: [] }, // for type inference
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const sum = (arr) => arr.reduce((a, b) => a + (+b || 0), 0);
const fmtUSD = (n) => `${Number(n || 0).toFixed(2)} USD`;
const todayISO = () => new Date().toISOString().slice(0, 10);
const dayName = (iso) => new Date(iso).toLocaleDateString(undefined, { weekday: 'long' });

function mondayOf(d) {
  const x = new Date(d);
  const w = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - w);
  x.setHours(0, 0, 0, 0);
  return x;
}
function buildWeek(d = new Date()) {
  const mon = mondayOf(d);
  const days = [...Array(7)].map((_, i) => {
    const t = new Date(mon);
    t.setDate(mon.getDate() + i);
    return t.toISOString().slice(0, 10);
  });
  return { startISO: days[0], days };
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  let body = null;
  try { body = await res.json(); } catch {}
  if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`);
  return body ?? {};
}

function setView(v) {
  state.view = v;
  ['home', 'products', 'performance', 'finance', 'settings'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = id === v ? '' : 'none';
  });
  $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.view === v));
}

// ---------- bootstrap/auth ----------
async function ensureMeta() {
  try {
    const m = await api('/api/meta'); // { meta, countries }
    state.countries = m.countries || [];
    state.week = buildWeek(new Date());
    $('#wdWeekLabel').textContent = `${state.week.days[0]} → ${state.week.days[6]}`;

    await loadProducts();
    await hydrateFinanceCategories();

    $('#login').style.display = 'none';
    $('#main').style.display = '';
    setView(state.view);
    fillSelects();
    renderCountriesChips();

    await refreshHome();
    await renderProducts();
    await updateFinanceRunningBalance();
    wireFinanceCategorySelects();
  } catch (e) {
    console.warn('Not authorized yet:', e.message);
    $('#login').style.display = '';
    $('#main').style.display = 'none';
  }
}

async function loadProducts() {
  try {
    const r = await api('/api/products'); // {products:[]}
    state.products = r.products || [];
  } catch {
    state.products = [];
  }
}

function fillSelects() {
  const cSel = '#adCountry,#mvFrom,#mvTo,#pfCountry,#rCountry,#pdRCountry,#pdAdCountry,#pdInfCountry,#pdInfFilterCountry';
  $$(cSel).forEach(s => {
    if (!s) return;
    const base = s.id === 'pfCountry' || s.id === 'pdInfFilterCountry'
      ? `<option value="">All countries</option>` : '';
    s.innerHTML = base + (state.countries || []).map(c => `<option value="${c}">${c}</option>`).join('');
  });

  const pSel = '#adProduct,#mvProduct,#rProduct,#lpProduct';
  $$(pSel).forEach(s => {
    if (!s) return;
    s.innerHTML = (state.products || []).map(p => `<option value="${p.id}">${p.name}${p.sku ? ' (' + p.sku + ')' : ''}</option>`).join('');
  });

  // settings product editor
  const ep = $('#epSelect');
  if (ep) ep.innerHTML = (state.products || []).map(p => `<option value="${p.id}">${p.name}${p.sku ? ' (' + p.sku + ')' : ''}</option>`).join('');

  // product details movement selects
  const pdMvFrom = $('#pdMvFrom'), pdMvTo = $('#pdMvTo');
  if (pdMvFrom) pdMvFrom.innerHTML = (state.countries || []).map(c => `<option>${c}</option>`).join('');
  if (pdMvTo) pdMvTo.innerHTML = (state.countries || []).map(c => `<option>${c}</option>`).join('');
}

function renderCountriesChips() {
  const box = $('#ctyList'); if (!box) return;
  box.innerHTML = (state.countries || []).map(c => `<span class="badge" style="margin-right:6px">${c}</span>`).join('');
}

// ---------- DASHBOARD ----------
async function refreshHome() {
  // KPIs
  $('#kpiProducts').textContent = state.products.length;
  $('#kpiCountries').textContent = state.countries.length;

  // Transit shipments count
  try {
    const s = await api('/api/shipments'); // {shipments:[]}
    $('#kpiTransit').textContent = (s.shipments || []).filter(x => !x.arrivedAt).length;
  } catch { $('#kpiTransit').textContent = '—'; }

  // Total ad spend (sum all)
  try {
    const a = await api('/api/adspend'); // {adSpends:[]}
    const total = sum((a.adSpends || []).map(x => +x.amount || 0));
    $('#kpiAdSpend').textContent = Intl.NumberFormat().format(total) + ' USD';
  } catch { $('#kpiAdSpend').textContent = '—'; }

  // Weekly delivered grid drives "Delivered (Mon–Sun)"
  await renderWeeklyDeliveredGrid();
  $('#kpiDelivered').textContent = $('#wdAllTotal')?.textContent || '0';

  // Stock + ad by country
  await renderStockByCountry();

  // Shipments tables
  await renderShipmentsTable('china-kenya', '#shipCKTable tbody');
  await renderShipmentsTable('intercountry', '#shipICTable tbody');
}

async function renderStockByCountry() {
  const wrap = $('#stockByCountry'); if (!wrap) return;
  const per = {}; // {country:{stock,ad}}

  state.countries.forEach(c => per[c] = { stock: 0, ad: 0 });

  try {
    const s = await api('/api/shipments');
    (s.shipments || []).forEach(sp => {
      if (sp.arrivedAt) {
        const to = sp.toCountry || sp.to;
        if (!to) return;
        per[to] = per[to] || { stock: 0, ad: 0 };
        per[to].stock += (+sp.qty || 0);
      }
    });
  } catch {}

  try {
    const r = await api('/api/remittances');
    (r.remittances || []).forEach(rr => {
      per[rr.country] = per[rr.country] || { stock: 0, ad: 0 };
      per[rr.country].stock -= (+rr.pieces || 0);
    });
  } catch {}

  try {
    const a = await api('/api/adspend');
    (a.adSpends || []).forEach(sp => {
      per[sp.country] = per[sp.country] || { stock: 0, ad: 0 };
      per[sp.country].ad += (+sp.amount || 0);
    });
  } catch {}

  const rows = Object.entries(per).map(([c, v]) =>
    `<tr><td>${c}</td><td>${v.stock}</td><td>${(v.ad || 0).toFixed(2)} USD</td></tr>`
  ).join('');
  wrap.innerHTML = `
    <table class="table">
      <thead><tr><th>Country</th><th>Approx. Stock</th><th>Total Ad Spend</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ---------- Weekly Delivered Grid ----------
async function fetchDeliveriesAll() {
  try {
    const r = await api('/api/deliveries'); // {deliveries:[{date,country,delivered}]}
    return r.deliveries || [];
  } catch { return []; }
}
async function renderWeeklyDeliveredGrid() {
  const tbody = $('#delivWeekTable tbody'); if (!tbody) return;
  const all = await fetchDeliveriesAll();
  const weekSet = new Set(state.week.days);
  const map = {}; // country => date => delivered
  (all || []).forEach(d => {
    if (!weekSet.has(d.date)) return;
    const c = d.country; if (!c) return;
    map[c] = map[c] || {};
    map[c][d.date] = (+d.delivered || 0);
  });

  // rows
  tbody.innerHTML = (state.countries || []).map(c => {
    const vals = state.week.days.map(day => (map[c] && map[c][day]) || 0);
    const total = sum(vals);
    return `<tr data-country="${c}">
      <th>${c}</th>
      ${vals.map((v, i) => `<td contenteditable="true" class="wd-cell" data-date="${state.week.days[i]}">${v || ''}</td>`).join('')}
      <th class="wd-row-total">${total}</th>
    </tr>`;
  }).join('');

  // recalc on edit
  tbody.querySelectorAll('.wd-cell').forEach(cell => {
    cell.addEventListener('input', () => {
      const tr = cell.closest('tr');
      const cells = Array.from(tr.querySelectorAll('.wd-cell'));
      const rowTotal = cells.reduce((a, td) => a + (+td.textContent.trim() || 0), 0);
      tr.querySelector('.wd-row-total').textContent = rowTotal;
      computeWeeklyFooters();
    });
  });

  computeWeeklyFooters();
}

function computeWeeklyFooters() {
  const totalsByDay = [0,0,0,0,0,0,0];
  $('#delivWeekTable tbody').querySelectorAll('tr').forEach(tr => {
    const cells = Array.from(tr.querySelectorAll('.wd-cell'));
    cells.forEach((td, i) => { totalsByDay[i] += (+td.textContent.trim() || 0); });
  });
  const ids = ['wdMonT','wdTueT','wdWedT','wdThuT','wdFriT','wdSatT','wdSunT'];
  ids.forEach((id, i) => { const el = $('#'+id); if (el) el.textContent = totalsByDay[i]; });
  $('#wdAllTotal').textContent = sum(totalsByDay);
}

// Save / Replace weekly grid
$('#wdSave')?.addEventListener('click', async () => {
  try {
    const tbody = $('#delivWeekTable tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));
    for (const tr of rows) {
      const country = tr.getAttribute('data-country');
      const cells = Array.from(tr.querySelectorAll('.wd-cell'));
      for (const td of cells) {
        const date = td.dataset.date;
        const delivered = +td.textContent.trim() || 0;

        // replace strategy: delete existing (if API supports), then post
        try { await api(`/api/deliveries?date=${date}&country=${encodeURIComponent(country)}`, { method: 'DELETE' }); } catch {}
        if (delivered > 0) {
          await api('/api/deliveries', { method: 'POST', body: JSON.stringify({ date, country, delivered }) });
        }
      }
    }
    alert('Weekly deliveries saved.');
    await refreshHome();
  } catch (e) {
    alert('Save error: ' + e.message);
  }
});

// Reset Week
$('#wdReset')?.addEventListener('click', async () => {
  if (!confirm('Reset this entire week?')) return;
  try {
    for (const country of state.countries) {
      for (const date of state.week.days) {
        try { await api(`/api/deliveries?date=${date}&country=${encodeURIComponent(country)}`, { method: 'DELETE' }); } catch {}
      }
    }
    await renderWeeklyDeliveredGrid();
    $('#kpiDelivered').textContent = '0';
    alert('Week reset.');
  } catch (e) {
    alert('Reset error: ' + e.message);
  }
});

// ---------- Daily Ad Spend (today only, replace) ----------
$('#adAdd')?.addEventListener('click', async () => {
  const payload = {
    date: todayISO(),
    platform: $('#adPlatform').value,
    productId: $('#adProduct').value,
    country: $('#adCountry').value,
    amount: +($('#adAmount').value || 0),
  };
  if (!payload.productId || !payload.country) return alert('Select product & country');
  try {
    // replace existing
    try {
      const q = `?date=${payload.date}&productId=${encodeURIComponent(payload.productId)}&platform=${encodeURIComponent(payload.platform)}&country=${encodeURIComponent(payload.country)}`;
      await api('/api/adspend' + q, { method: 'DELETE' });
    } catch {}
    await api('/api/adspend', { method: 'POST', body: JSON.stringify(payload) });
    alert('Saved.');
    await refreshHome(); // updates totals
  } catch (e) {
    alert('Save error: ' + e.message);
  }
});

// ---------- Stock Movement -> creates a shipment (arrivedAt null) ----------
$('#mvAdd')?.addEventListener('click', async () => {
  const payload = {
    productId: $('#mvProduct').value,
    fromCountry: $('#mvFrom').value,
    toCountry: $('#mvTo').value,
    qty: +($('#mvQty').value || 0),
    shipCost: +($('#mvShip').value || 0),
    departedAt: todayISO(),
    arrivedAt: null,
  };
  if (!payload.productId) return alert('Select product');
  try {
    await api('/api/shipments', { method: 'POST', body: JSON.stringify(payload) });
    alert('Movement added.');
    await refreshHome();
  } catch (e) {
    alert('Error: ' + e.message);
  }
});

// ---------- Shipments tables (CK and Intercountry) ----------
async function renderShipmentsTable(type, sel) {
  const body = $(sel); if (!body) return;
  try {
    const r = await api('/api/shipments'); // {shipments:[]}
    const productsById = Object.fromEntries((state.products || []).map(p => [p.id, p]));

    let list = r.shipments || [];
    const isCK = (s) =>
      (s.fromCountry?.toLowerCase?.() === 'china' && s.toCountry?.toLowerCase?.() === 'kenya') ||
      (s.from === 'china' && s.to === 'kenya');

    list = (type === 'china-kenya') ? list.filter(isCK) : list.filter(s => !isCK(s));

    body.innerHTML = list.map(sp => {
      const name = productsById[sp.productId]?.name || sp.productId || '';
      const from = sp.fromCountry || sp.from || '';
      const to = sp.toCountry || sp.to || '';
      const days = (sp.arrivedAt && sp.departedAt)
        ? Math.max(0, Math.round((new Date(sp.arrivedAt) - new Date(sp.departedAt)) / 86400000))
        : '';
      return `<tr data-id="${sp.id}">
        <td>${sp.id}</td>
        <td>${name}</td>
        <td>${from} → ${to}</td>
        <td contenteditable="true" class="ship-edit" data-field="qty">${sp.qty || 0}</td>
        <td contenteditable="true" class="ship-edit" data-field="shipCost">${sp.shipCost || 0}</td>
        <td>${sp.departedAt || ''}</td>
        <td>${sp.arrivedAt || ''}</td>
        <td>${days}</td>
        <td>
          <button class="btn outline" data-mark="${sp.id}">Mark Arrived</button>
          <button class="btn outline" data-del="${sp.id}">Delete</button>
        </td>
      </tr>`;
    }).join('');

    // edit qty/shipCost inline
    body.querySelectorAll('.ship-edit').forEach(td => {
      td.addEventListener('blur', async () => {
        const tr = td.closest('tr');
        const id = tr.getAttribute('data-id');
        const field = td.dataset.field;
        const val = +td.textContent.trim() || 0;
        try {
          await api('/api/shipments/' + id, { method: 'PUT', body: JSON.stringify({ [field]: val }) });
        } catch (e) {
          alert('Update error: ' + e.message);
        }
      });
    });

    // mark arrived
    body.querySelectorAll('[data-mark]').forEach(b => b.onclick = async () => {
      const id = b.dataset.mark;
      const d = prompt('Arrival date (YYYY-MM-DD)', todayISO()); if (!d) return;
      try {
        await api('/api/shipments/' + id, { method: 'PUT', body: JSON.stringify({ arrivedAt: d }) });
        await renderShipmentsTable(type, sel);
        await renderStockByCountry();
      } catch (e) {
        alert('Mark error: ' + e.message);
      }
    });

    // delete
    body.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('Delete shipment?')) return;
      try {
        await api('/api/shipments/' + b.dataset.del, { method: 'DELETE' });
        await renderShipmentsTable(type, sel);
        await renderStockByCountry();
      } catch (e) {
        alert('Delete error: ' + e.message);
      }
    });

  } catch {
    body.innerHTML = '';
  }
}

// ---------- Profit by Country (from remittances) ----------
$('#pcRun')?.addEventListener('click', async () => {
  const s = $('#pcStart').value, e = $('#pcEnd').value;
  const tbody = $('#profitCountryTable tbody'); if (!tbody) return;
  try {
    const r = await api(`/api/remittances${(s||e) ? `?${[s?`start=${s}`:'', e?`end=${e}`:''].filter(Boolean).join('&')}` : ''}`);
    const byC = {};
    (r.remittances || []).forEach(x => {
      byC[x.country] = byC[x.country] || { revenue:0, ad:0, extra:0, pieces:0 };
      byC[x.country].revenue += +x.revenue || 0;
      byC[x.country].ad += +x.adSpend || 0;
      byC[x.country].extra += (+x.extraPerPiece || 0) * (+x.pieces || 0);
      byC[x.country].pieces += +x.pieces || 0;
    });
    tbody.innerHTML = Object.entries(byC).map(([c, v]) => {
      const profit = v.revenue - v.ad - v.extra;
      return `<tr><td>${c}</td><td>${v.revenue.toFixed(2)}</td><td>${v.ad.toFixed(2)}</td><td>${v.extra.toFixed(2)}</td><td>${v.pieces}</td><td>${profit.toFixed(2)}</td></tr>`;
    }).join('');
  } catch {
    tbody.innerHTML = '';
  }
});

// ---------- To-Do (local only) ----------
function loadTodos(){ return JSON.parse(localStorage.getItem('todos')||'[]'); }
function saveTodos(x){ localStorage.setItem('todos', JSON.stringify(x)); }
function renderTodos() {
  const items = loadTodos();
  const list = $('#todoList'); if (!list) return;
  list.innerHTML = items.map(it => `
    <div class="flex">
      <span>${it.done ? '✅ ' : ''}${it.text}</span>
      <button class="btn outline" data-tgl="${it.id}">${it.done ? 'Undo' : 'Done'}</button>
      <button class="btn outline" data-del="${it.id}">Delete</button>
    </div>
  `).join('');
  $('#todoAdd')?.addEventListener('click', () => {
    const t = $('#todoText').value.trim(); if (!t) return;
    items.push({ id: Math.random().toString(36).slice(2), text: t, done: false });
    saveTodos(items); renderTodos();
  });
  list.querySelectorAll('[data-tgl]').forEach(b => b.onclick = () => {
    const it = items.find(x => x.id === b.dataset.tgl);
    it.done = !it.done; saveTodos(items); renderTodos();
  });
  list.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    const i = items.findIndex(x => x.id === b.dataset.del);
    items.splice(i, 1); saveTodos(items); renderTodos();
  });
}

// ---------- Weekly To-Do (local) ----------
function renderWeekly() {
  const key = 'weeklyTodos';
  const data = JSON.parse(localStorage.getItem(key) || '{}');
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const wrap = $('#weeklyWrap'); if (!wrap) return;
  wrap.innerHTML = '';
  days.forEach(day => {
    const items = data[day] || [];
    const card = document.createElement('div'); card.className = 'card';
    card.innerHTML = `<div class="h">${day}</div>
      <div class="flex"><input id="w_${day}" class="input" placeholder="Task"><button class="btn">Add</button></div>
      <div class="list">${items.map(it=>`<div class="flex"><span>${it.done?'✅ ':''}${it.text}</span>
        <button class="btn outline" data-wtgl="${day}|${it.id}">${it.done?'Undo':'Done'}</button>
        <button class="btn outline" data-wdel="${day}|${it.id}">Delete</button></div>`).join('')}</div>`;
    wrap.appendChild(card);
    card.querySelector('button.btn').onclick = () => {
      const v = card.querySelector(`#w_${day}`).value.trim(); if (!v) return;
      items.push({ id: Math.random().toString(36).slice(2), text: v, done: false });
      data[day] = items; localStorage.setItem(key, JSON.stringify(data)); renderWeekly();
    };
  });
  wrap.querySelectorAll('[data-wtgl]').forEach(b=> b.onclick=()=>{ const [d,id]=b.dataset.wtgl.split('|'); const data=JSON.parse(localStorage.getItem(key)||'{}'); const it=(data[d]||[]).find(x=>x.id===id); it.done=!it.done; localStorage.setItem(key, JSON.stringify(data)); renderWeekly(); });
  wrap.querySelectorAll('[data-wdel]').forEach(b=> b.onclick=()=>{ const [d,id]=b.dataset.wdel.split('|'); const data=JSON.parse(localStorage.getItem(key)||'{}'); const arr=(data[d]||[]); const i=arr.findIndex(x=>x.id===id); arr.splice(i,1); data[d]=arr; localStorage.setItem(key, JSON.stringify(data)); renderWeekly(); });
}

// ===================== PRODUCTS =====================
$('#pAdd')?.addEventListener('click', async () => {
  const payload = {
    name: $('#pName').value,
    sku: $('#pSku').value,
    cost_china: +($('#pCost').value || 0),
    ship_china_to_kenya: +($('#pShip').value || 0),
    margin_budget: +($('#pMB').value || 0),
  };
  try {
    await api('/api/products', { method: 'POST', body: JSON.stringify(payload) });
    await renderProducts();
    await ensureMeta();
  } catch (e) {
    alert('Add product error: ' + e.message);
  }
});

async function renderProducts() {
  let res; try { res = await api('/api/products'); } catch { res = { products: [] }; }
  state.products = res.products || [];
  const tbody = $('#productsTable tbody'); if (!tbody) return;

  tbody.innerHTML = state.products.map(p => `
    <tr>
      <td>${p.name}</td>
      <td>${p.sku || '-'}</td>
      <td><span class="badge">${p.status || 'active'}</span></td>
      <td>
        <button class="btn outline" data-open="${p.id}">Open</button>
        <button class="btn outline" data-pause="${p.id}">${p.status === 'active' ? 'Pause' : 'Run'}</button>
        <button class="btn outline" data-del="${p.id}">Delete</button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openProduct(b.dataset.open));
  tbody.querySelectorAll('[data-pause]').forEach(b => b.onclick = async () => {
    const id = b.dataset.pause; const p = state.products.find(x => x.id === id);
    const ns = p.status === 'active' ? 'paused' : 'active';
    await api(`/api/products/${id}/status`, { method: 'POST', body: JSON.stringify({ status: ns }) });
    await renderProducts();
  });
  tbody.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete product?')) return;
    await api('/api/products/' + b.dataset.del, { method: 'DELETE' });
    await renderProducts();
  });
}

async function openProduct(id) {
  state.productOpenId = id;
  $('#productDetails').style.display = '';
  setView('products');
  await renderProductDetails(id);
}

async function renderProductDetails(id) {
  const prod = (state.products || []).find(p => p.id === id);
  if (!prod) return;

  // Stock & Ad by country (this product)
  await renderPDStockAd(id);

  // Profit+Ads budget (editable simple view)
  $('#pdProfitBudget').innerHTML = `
    <div class="flex">
      <div class="muted">Margin + Ads Budget (global):</div>
      <input id="pdMB" class="input" type="number" step="0.01" value="${prod.margin_budget || 0}">
      <button id="pdMBSave" class="btn">Save</button>
    </div>`;
  $('#pdMBSave').onclick = async () => {
    try {
      await api('/api/products/' + id, { method: 'PUT', body: JSON.stringify({ margin_budget: +($('#pdMB').value || 0) }) });
      alert('Saved.');
    } catch (e) { alert('Error: ' + e.message); }
  };

  // Daily ad spend (replace today for this product)
  $('#pdAdSave').onclick = async () => {
    const payload = {
      date: todayISO(),
      platform: $('#pdAdPlatform').value,
      productId: id,
      country: $('#pdAdCountry').value,
      amount: +($('#pdAdAmount').value || 0),
    };
    try {
      // replace existing for today
      try {
        const q = `?date=${payload.date}&productId=${encodeURIComponent(id)}&platform=${encodeURIComponent(payload.platform)}&country=${encodeURIComponent(payload.country)}`;
        await api('/api/adspend' + q, { method: 'DELETE' });
      } catch {}
      await api('/api/adspend', { method: 'POST', body: JSON.stringify(payload) });
      alert('Saved.');
      await renderPDStockAd(id);
    } catch (e) { alert('Save error: ' + e.message); }
  };

  // Remittance add (with extra cost per piece)
  $('#pdRAdd').onclick = async () => {
    const payload = {
      start: $('#pdRStart').value, end: $('#pdREnd').value,
      country: $('#pdRCountry').value, productId: id,
      orders: +($('#pdROrders').value || 0), pieces: +($('#pdRPieces').value || 0),
      revenue: +($('#pdRRevenue').value || 0), adSpend: +($('#pdRAdSpend').value || 0),
      extraPerPiece: +($('#pdRExtra').value || 0),
    };
    if (!payload.start || !payload.end) return alert('Select dates');
    try {
      await api('/api/remittances', { method: 'POST', body: JSON.stringify(payload) });
      alert('Added.');
      await renderPDRemittances(id);
      await renderPDLifetime(id);
      await renderStockByCountry();
    } catch (e) { alert('Error: ' + e.message); }
  };

  // Movement in product view
  $('#pdMvAdd').onclick = async () => {
    const payload = {
      productId: id,
      fromCountry: $('#pdMvFrom').value,
      toCountry: $('#pdMvTo').value,
      qty: +($('#pdMvQty').value || 0),
      shipCost: +($('#pdMvShip').value || 0),
      departedAt: todayISO(),
      arrivedAt: null,
    };
    try {
      await api('/api/shipments', { method: 'POST', body: JSON.stringify(payload) });
      alert('Movement added.');
      await renderPDShipments(id);
      await renderStockByCountry();
    } catch (e) { alert('Error: ' + e.message); }
  };

  await renderPDRemittances(id);
  await renderPDShipments(id);
  await renderPDLifetime(id);
}

async function renderPDStockAd(id) {
  const wrap = $('#pdStockByCountry'); if (!wrap) return;
  const per = {}; state.countries.forEach(c => per[c] = { stock:0, ad:0 });

  try {
    const s = await api('/api/shipments');
    (s.shipments || []).filter(sp => sp.productId === id && sp.arrivedAt).forEach(sp => {
      const to = sp.toCountry || sp.to; if (!to) return;
      per[to] = per[to] || { stock:0, ad:0 };
      per[to].stock += (+sp.qty || 0);
    });
  } catch {}

  try {
    const r = await api('/api/remittances');
    (r.remittances || []).filter(x => x.productId === id).forEach(x => {
      per[x.country] = per[x.country] || { stock:0, ad:0 };
      per[x.country].stock -= (+x.pieces || 0);
    });
  } catch {}

  try {
    const a = await api('/api/adspend');
    (a.adSpends || []).filter(x => x.productId === id).forEach(x => {
      per[x.country] = per[x.country] || { stock:0, ad:0 };
      per[x.country].ad += (+x.amount || 0);
    });
  } catch {}

  const rows = Object.entries(per).map(([c,v]) => `<tr><td>${c}</td><td>${v.stock}</td><td>${(v.ad||0).toFixed(2)} USD</td></tr>`).join('');
  wrap.innerHTML = `<table class="table"><thead><tr><th>Country</th><th>Approx. Stock</th><th>Total Ad Spend</th></tr></thead><tbody>${rows}</tbody></table>`;
}

async function renderPDRemittances(id) {
  const wrap = $('#pdRTableWrap'); if (!wrap) return;
  try {
    const r = await api('/api/remittances');
    const items = (r.remittances || []).filter(x => x.productId === id);
    if (!items.length) { wrap.innerHTML = '<div class="muted">No entries yet.</div>'; return; }
    wrap.innerHTML = `<table class="table"><thead><tr><th>Period</th><th>Country</th><th>Orders</th><th>Pieces</th><th>Revenue</th><th>Ad Spend</th><th>Extra/pc</th></tr></thead><tbody>
      ${items.map(x => `<tr><td>${x.start} → ${x.end}</td><td>${x.country}</td><td>${x.orders||0}</td><td>${x.pieces||0}</td><td>${fmtUSD(x.revenue)}</td><td>${fmtUSD(x.adSpend)}</td><td>${fmtUSD(x.extraPerPiece||0)}</td></tr>`).join('')}
    </tbody></table>`;
  } catch { wrap.innerHTML = '<div class="muted">Failed to load.</div>'; }
}

async function renderPDShipments(id) {
  const ckBody = $('#pdShipCK tbody'); const icBody = $('#pdShipIC tbody');
  if (!ckBody || !icBody) return;
  try {
    const r = await api('/api/shipments');
    const list = (r.shipments || []).filter(s => s.productId === id);

    const isCK = (s) =>
      (s.fromCountry?.toLowerCase?.() === 'china' && s.toCountry?.toLowerCase?.() === 'kenya') ||
      (s.from === 'china' && s.to === 'kenya');

    function rows(arr) {
      return arr.map(sp => {
        const from = sp.fromCountry || sp.from || '';
        const to = sp.toCountry || sp.to || '';
        const days = (sp.arrivedAt && sp.departedAt)
          ? Math.max(0, Math.round((new Date(sp.arrivedAt) - new Date(sp.departedAt)) / 86400000))
          : '';
        return `<tr data-id="${sp.id}">
          <td>${sp.id}</td>
          <td>${from} → ${to}</td>
          <td contenteditable="true" class="ship-edit" data-field="qty">${sp.qty || 0}</td>
          <td contenteditable="true" class="ship-edit" data-field="shipCost">${sp.shipCost || 0}</td>
          <td>${sp.departedAt || ''}</td>
          <td>${sp.arrivedAt || ''}</td>
          <td>${days}</td>
          <td>
            <button class="btn outline" data-mark="${sp.id}">Mark Arrived</button>
            <button class="btn outline" data-del="${sp.id}">Delete</button>
          </td>
        </tr>`;
      }).join('');
    }

    ckBody.innerHTML = rows(list.filter(isCK));
    icBody.innerHTML = rows(list.filter(s => !isCK(s)));

    // wire inline edit / mark / delete for both tables
    [ckBody, icBody].forEach(body => {
      body.querySelectorAll('.ship-edit').forEach(td => {
        td.addEventListener('blur', async () => {
          const tr = td.closest('tr'); const id2 = tr.getAttribute('data-id');
          const field = td.dataset.field; const val = +td.textContent.trim() || 0;
          try {
            await api('/api/shipments/' + id2, { method: 'PUT', body: JSON.stringify({ [field]: val }) });
          } catch (e) { alert('Update error: ' + e.message); }
        });
      });
      body.querySelectorAll('[data-mark]').forEach(b => b.onclick = async () => {
        const d = prompt('Arrival date (YYYY-MM-DD)', todayISO()); if (!d) return;
        try { await api('/api/shipments/' + b.dataset.mark, { method: 'PUT', body: JSON.stringify({ arrivedAt: d }) }); await renderPDShipments(id); await renderStockByCountry(); }
        catch (e) { alert('Mark error: ' + e.message); }
      });
      body.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        if (!confirm('Delete shipment?')) return;
        try { await api('/api/shipments/' + b.dataset.del, { method: 'DELETE' }); await renderPDShipments(id); await renderStockByCountry(); }
        catch (e) { alert('Delete error: ' + e.message); }
      });
    });

  } catch {
    ckBody.innerHTML = ''; icBody.innerHTML = '';
  }
}

async function renderPDLifetime(id) {
  const wrap = $('#pdLPTableWrap'); if (!wrap) return;
  try {
    const rem = await api('/api/remittances');
    const ship = await api('/api/shipments');
    const prod = state.products.find(p => p.id === id) || { cost_china:0, ship_china_to_kenya:0 };

    const s = $('#pdLPStart').value, e = $('#pdLPEnd').value;
    const inRange = (date) => (!s || date >= s) && (!e || date <= e);

    let revenue = 0, ad = 0, shippingCost = 0, baseCost = 0, pieces = 0, extra = 0;

    (rem.remittances || []).filter(r => r.productId === id && inRange(r.start)).forEach(r => {
      revenue += +r.revenue || 0;
      ad += +r.adSpend || 0;
      pieces += +r.pieces || 0;
      extra += (+r.extraPerPiece || 0) * (+r.pieces || 0);
      baseCost += ((+prod.cost_china || 0) + (+prod.ship_china_to_kenya || 0)) * (+r.pieces || 0);
    });

    (ship.shipments || []).filter(sx => sx.productId === id && sx.arrivedAt && inRange(sx.arrivedAt)).forEach(sx => {
      shippingCost += +sx.shipCost || 0;
    });

    const profit = revenue - ad - extra - baseCost - shippingCost;

    wrap.innerHTML = `<table class="table"><thead><tr><th>Revenue</th><th>Ad Spend</th><th>Extra Delivery Cost</th><th>Shipping Cost</th><th>Base Cost</th><th>Pieces</th><th>Profit</th></tr></thead>
      <tbody><tr>
        <td>${fmtUSD(revenue)}</td><td>${fmtUSD(ad)}</td><td>${fmtUSD(extra)}</td><td>${fmtUSD(shippingCost)}</td><td>${fmtUSD(baseCost)}</td><td>${pieces}</td><td>${fmtUSD(profit)}</td>
      </tr></tbody></table>`;
  } catch {
    wrap.innerHTML = '<div class="muted">Failed to load.</div>';
  }
}

// ===================== PERFORMANCE =====================
$('#pfRun')?.addEventListener('click', async () => {
  const quick = $('#pfQuick').value;
  if (quick !== 'custom') {
    const end = todayISO();
    const start = new Date();
    start.setDate(start.getDate() - (quick === '8' ? 7 : 27));
    $('#pfStart').value = start.toISOString().slice(0,10);
    $('#pfEnd').value = end;
  }

  const s = $('#pfStart').value, e = $('#pfEnd').value, c = $('#pfCountry').value;
  try {
    const r = await api(`/api/remittances${(s||e||c) ? `?${[
      s ? 'start='+s : '',
      e ? 'end='+e : '',
      c ? 'country='+encodeURIComponent(c) : ''
    ].filter(Boolean).join('&')}` : ''}`);

    const productsById = Object.fromEntries((state.products||[]).map(p => [p.id, p]));
    const agg = {}; // id => {name,pieces,ad,prodCost,profit}

    (r.remittances || []).forEach(x => {
      const id = x.productId;
      const prod = productsById[id] || { cost_china:0, ship_china_to_kenya:0 };
      const base = (+prod.cost_china || 0) + (+prod.ship_china_to_kenya || 0);
      const pcs = +x.pieces || 0;
      const revenue = +x.revenue || 0;
      const ad = +x.adSpend || 0;
      const extra = (+x.extraPerPiece || 0) * pcs;

      if (!agg[id]) agg[id] = { name: (productsById[id]?.name || id), pieces:0, ad:0, prodCost:0, profit:0 };
      agg[id].pieces += pcs;
      agg[id].ad += ad;
      agg[id].prodCost += base * pcs;
      agg[id].profit += (revenue - ad - extra - base * pcs);
    });

    const rows = Object.values(agg).sort((a,b)=>b.pieces-a.pieces).map(it => `
      <tr><td>${it.name}</td><td>${it.pieces}</td><td>${it.ad.toFixed(2)}</td><td>${it.prodCost.toFixed(2)}</td><td>${it.profit.toFixed(2)}</td><td>${it.pieces? (it.profit/it.pieces).toFixed(2):'0.00'}</td></tr>
    `).join('');
    $('#pfTable tbody').innerHTML = rows || '';
  } catch {
    $('#pfTable tbody').innerHTML = '';
  }
});

// Remittance add (performance page)
$('#rAdd')?.addEventListener('click', async () => {
  const payload = {
    start: $('#rStart').value, end: $('#rEnd').value,
    country: $('#rCountry').value, productId: $('#rProduct').value,
    orders: +($('#rOrders').value || 0), pieces: +($('#rPieces').value || 0),
    revenue: +($('#rRev').value || 0), adSpend: +($('#rAds').value || 0),
    extraPerPiece: +($('#rExtra').value || 0),
  };
  if (!payload.start || !payload.end) return alert('Select dates');
  try {
    await api('/api/remittances', { method: 'POST', body: JSON.stringify(payload) });
    alert('Remittance saved.');
    await refreshHome();
  } catch (e) { alert('Error: ' + e.message); }
});

// ===================== FINANCE =====================
async function hydrateFinanceCategories() {
  try {
    const cats = await api('/api/finance/categories'); // {debits:[],credits:[]}
    state.financeCats = { debits: cats.debits || [], credits: cats.credits || [] };
  } catch {
    state.financeCats = { debits: [], credits: [] };
  }
}
function wireFinanceCategorySelects() {
  // Entry category select (single)
  const sel = $('#feCat'); if (sel) {
    const opts = [
      ...state.financeCats.debits.map(n => ({name:n,type:'debit'})),
      ...state.financeCats.credits.map(n => ({name:n,type:'credit'})),
    ];
    sel.innerHTML = opts.map(o => `<option value="${o.type}:${o.name}">${o.name} (${o.type})</option>`).join('');
  }
  // Filter multi-select
  const filt = $('#fef'); if (filt) {
    const opts = [
      ...state.financeCats.debits.map(n => ({name:n,type:'debit'})),
      ...state.financeCats.credits.map(n => ({name:n,type:'credit'})),
    ];
    filt.innerHTML = opts.map(o => `<option value="${o.name}">${o.name}</option>`).join('');
  }
}

async function updateFinanceRunningBalance() {
  try {
    const r = await api('/api/finance/entries'); // {entries:[]}
    const bal = (r.entries || []).reduce((acc, x) =>
      acc + ((x.type === 'credit' ? 1 : -1) * (+x.amount || 0)), 0);
    $('#finBalanceBig').textContent = fmtUSD(bal);
  } catch {
    $('#finBalanceBig').textContent = '—';
  }
}

$('#fcAdd')?.addEventListener('click', async () => {
  const type = $('#fcType').value;
  const name = $('#fcName').value.trim();
  if (!name) return;
  try {
    await api('/api/finance/categories', { method: 'POST', body: JSON.stringify({ type, name }) });
    await hydrateFinanceCategories();
    wireFinanceCategorySelects();
    // show lists
    $('#fcList').innerHTML = `Debits: ${state.financeCats.debits.join(', ')||'-'} | Credits: ${state.financeCats.credits.join(', ')||'-'}`;
  } catch (e) { alert('Error: ' + e.message); }
});

$('#feAdd')?.addEventListener('click', async () => {
  const date = $('#feDate').value || todayISO();
  const [type, category] = ($('#feCat').value || '').split(':');
  const amount = +($('#feAmt').value || 0);
  const note = $('#feNote').value;
  if (!category) return alert('Select category');
  try {
    await api('/api/finance/entries', { method: 'POST', body: JSON.stringify({ date, type, category, amount, note }) });
    alert('Entry added.');
    await updateFinanceRunningBalance();
  } catch (e) { alert('Error: ' + e.message); }
});

$('#feRun')?.addEventListener('click', async () => {
  const s = $('#fes').value, e = $('#fee').value;
  const sel = Array.from($('#fef').selectedOptions).map(o => o.value);
  try {
    const r = await api(`/api/finance/entries?${[
      s?`start=${s}`:'', e?`end=${e}`:'',
      sel.length?`categories=${encodeURIComponent(sel.join(','))}`:''
    ].filter(Boolean).join('&')}`);
    const tbody = $('#feTable tbody');
    tbody.innerHTML = (r.entries || []).map(x => `
      <tr data-id="${x.id}">
        <td>${x.date}</td><td>${x.type}</td><td>${x.category}</td><td>${x.amount}</td><td>${x.note||''}</td>
        <td><button class="btn outline" data-del="${x.id}">Delete</button></td>
      </tr>`).join('');
    // wire delete
    tbody.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('Delete entry?')) return;
      try {
        await api('/api/finance/entries/' + b.dataset.del, { method: 'DELETE' });
        b.closest('tr').remove();
        await updateFinanceRunningBalance();
      } catch (e) { alert('Delete error: ' + e.message); }
    });
    // range balance
    const bal = (r.entries || []).reduce((acc, x) => acc + ((x.type === 'credit' ? 1 : -1) * (+x.amount || 0)), 0);
    $('#feBalance').textContent = 'Balance (range): ' + fmtUSD(bal);
  } catch (e) {
    $('#feTable tbody').innerHTML = '';
    $('#feBalance').textContent = 'Balance (range): —';
  }
});

// ===================== SETTINGS =====================
$('#ctyAdd')?.addEventListener('click', async () => {
  const name = ($('#cty').value || '').trim(); if (!name) return;
  try {
    await api('/api/countries', { method: 'POST', body: JSON.stringify({ name }) });
    const list = await api('/api/countries');
    state.countries = list.countries || [];
    fillSelects(); renderCountriesChips();
    await renderWeeklyDeliveredGrid();
  } catch (e) { alert('Error: ' + e.message); }
});

// Edit product info
$('#epSelect')?.addEventListener('change', () => {
  const p = state.products.find(x => x.id === $('#epSelect').value);
  if (!p) return;
  $('#epName').value = p.name || '';
  $('#epSku').value = p.sku || '';
  $('#epCost').value = p.cost_china || 0;
  $('#epShip').value = p.ship_china_to_kenya || 0;
  $('#epMB').value = p.margin_budget || 0;
});
$('#epSave')?.addEventListener('click', async () => {
  const id = $('#epSelect').value;
  const payload = {
    name: $('#epName').value,
    sku: $('#epSku').value,
    cost_china: +($('#epCost').value || 0),
    ship_china_to_kenya: +($('#epShip').value || 0),
    margin_budget: +($('#epMB').value || 0),
  };
  try {
    await api('/api/products/' + id, { method: 'PUT', body: JSON.stringify(payload) });
    alert('Product updated.');
    await loadProducts();
    fillSelects();
    await renderProducts();
  } catch (e) { alert('Update error: ' + e.message); }
});

// Restore snapshots
$$('.restore').forEach(b => b.addEventListener('click', async () => {
  const win = b.dataset.win;
  try {
    const res = await api('/api/restore', { method: 'POST', body: JSON.stringify({ window: win }) });
    if (!res.ok) throw new Error(res.error || 'Restore failed');
    alert('Restored from: ' + res.restoredFrom);
    location.reload();
  } catch (e) {
    alert('Restore error: ' + (e.message || 'No snapshots found'));
  }
}));

// ===================== NAV & AUTH =====================
$$('.nav a[data-view]').forEach(a => a.addEventListener('click', (e) => {
  e.preventDefault();
  setView(a.dataset.view);
  if (a.dataset.view === 'products') renderProducts();
  if (a.dataset.view === 'finance') { hydrateFinanceCategories().then(wireFinanceCategorySelects); updateFinanceRunningBalance(); }
}));

$('#logoutLink')?.addEventListener('click', async (e) => {
  e.preventDefault();
  try { await api('/api/logout', { method: 'POST' }); } catch {}
  location.reload();
});

$('#loginBtn')?.addEventListener('click', async () => {
  const p = $('#pw').value;
  try {
    await api('/api/auth', { method: 'POST', body: JSON.stringify({ password: p }) });
    await ensureMeta();
  } catch { alert('Wrong password'); }
});

// ===================== LIFETIME (GLOBAL) =====================
$('#lpRun')?.addEventListener('click', async () => {
  const pid = $('#lpProduct').value || null;
  const s = $('#lpStart').value, e = $('#lpEnd').value;
  try {
    const rem = await api(`/api/remittances${(s||e)?`?${[s?`start=${s}`:'',e?`end=${e}`:''].filter(Boolean).join('&')}`:''}`);
    const ship = await api('/api/shipments');

    const productsById = Object.fromEntries((state.products||[]).map(p => [p.id,p]));
    const byP = {}; // id => { revenue, ad, extra, ship, base, pieces }

    (rem.remittances || []).filter(r => !pid || r.productId === pid).forEach(r => {
      const prod = productsById[r.productId] || { cost_china:0, ship_china_to_kenya:0 };
      const base = (+prod.cost_china || 0) + (+prod.ship_china_to_kenya || 0);
      const pcs = +r.pieces || 0;

      byP[r.productId] = byP[r.productId] || { revenue:0, ad:0, extra:0, ship:0, base:0, pieces:0 };
      byP[r.productId].revenue += +r.revenue || 0;
      byP[r.productId].ad += +r.adSpend || 0;
      byP[r.productId].extra += (+r.extraPerPiece || 0) * pcs;
      byP[r.productId].base += base * pcs;
      byP[r.productId].pieces += pcs;
    });

    (ship.shipments || []).filter(sx => sx.arrivedAt && (!pid || sx.productId === pid)).forEach(sx => {
      byP[sx.productId] = byP[sx.productId] || { revenue:0, ad:0, extra:0, ship:0, base:0, pieces:0 };
      byP[sx.productId].ship += +sx.shipCost || 0;
    });

    const tbody = $('#lifetimeTable tbody');
    tbody.innerHTML = Object.entries(byP).map(([id,v])=>{
      const name = productsById[id]?.name || id;
      const profit = v.revenue - v.ad - v.extra - v.ship - v.base;
      return `<tr><td>${name}</td><td>${v.revenue.toFixed(2)}</td><td>${v.ad.toFixed(2)}</td><td>${v.ship.toFixed(2)}</td><td>${v.base.toFixed(2)}</td><td>${v.pieces}</td><td>${profit.toFixed(2)}</td></tr>`;
    }).join('') || '<tr><td colspan="7" class="muted">No data</td></tr>';

  } catch (e) {
    const tbody = $('#lifetimeTable tbody'); if (tbody) tbody.innerHTML = '';
  }
});

// ---------- boot ----------
renderTodos();
renderWeekly();
ensureMeta();
