/* EAS Tracker – Front-end (index.html + product.html) */

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

const state = {
  view: 'home',
  countries: [],
  products: [],
  categories: { debit: [], credit: [] },
  product: null,
  productId: getQuery('id')
};

async function gate() {
  try {
    const meta = await api('/api/meta');
    state.countries = (meta.countries || []).filter(c => c !== 'china');
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
  try {
    await api('/api/auth', { method: 'POST', body: JSON.stringify({ password: Q('#pw').value }) });
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

async function preloadProducts() {
  try {
    const r = await api('/api/products');
    state.products = r.products || [];
  } catch { state.products = []; }
}

function productsActiveOnly() {
  return (state.products || []).filter(p => p.status !== 'paused');
}

function fillGlobalSelects() {
  const countryTargets = [
    '#delCountrySel', '#mvFrom', '#mvTo', '#adCountry', '#rCountry',
    '#pfCountry', '#pdAdCountry', '#pdRCountry', '#pdMvFrom', '#pdMvTo',
    '#pdPBCountry', '#pdInfCountry', '#pdInfFilterCountry', '#pcCountry'
  ];
  countryTargets.forEach(sel => {
    QA(sel).forEach(el => {
      el.innerHTML = state.countries.map(c => `<option value="${c}">${c}</option>`).join('');
      if (el.id === 'pcCountry' || el.id === 'pfCountry' || el.id === 'pdInfFilterCountry') {
        el.insertAdjacentHTML('afterbegin', `<option value="">All countries</option>`);
      }
    });
  });

  const prodTargets = ['#adProduct', '#rProduct', '#mvProduct'];
  prodTargets.forEach(sel => {
    QA(sel).forEach(el => {
      el.innerHTML = productsActiveOnly().map(p => `<option value="${p.id}">${p.name}${p.sku?' ('+p.sku+')':''}</option>`).join('');
    });
  });

  if (Q('#lpProduct')) {
    Q('#lpProduct').innerHTML = `<option value="">All products</option>` +
      state.products.map(p => `<option value="${p.id}">${p.name}${p.sku?' ('+p.sku+')':''}</option>`).join('');
  }
}

/* ===================== DASHBOARD ===================== */
function initDashboard() {
  renderKpis();
  renderStockAndSpendByCountry();
  initWeeklyDelivered();
  initDailyAdSpend();
  initMovements();
  renderTransitTables();
  initProfitByCountry();
  initTodos();
  initLifetimeGlobal();
}

async function renderKpis() {
  Q('#kpiProducts') && (Q('#kpiProducts').textContent = productsActiveOnly().length);
  Q('#kpiCountries') && (Q('#kpiCountries').textContent = state.countries.length);

  try {
    const s = await api('/api/shipments');
    const live = (s.shipments || []).filter(x => !x.arrivedAt).length;
    Q('#kpiTransit') && (Q('#kpiTransit').textContent = live);
  } catch {}

  try {
    const a = await api('/api/adspend');
    const total = (a.adSpends || []).reduce((t, x) => t + (+x.amount || 0), 0);
    Q('#kpiAdSpend') && (Q('#kpiAdSpend').textContent = fmt(total) + ' USD');
  } catch {}

  try {
    const r = await api('/api/deliveries');
    const { total } = computeCurrentWeekTotals(r.deliveries || []);
    Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = fmt(total));
  } catch {}
}

async function renderStockAndSpendByCountry() {
  const body = Q('#stockByCountryBody'); if (!body) return;
  const footerStock = Q('#stockTotal'), footerAd = Q('#adTotal');
  const per = {}; state.countries.forEach(c => per[c] = { stock: 0, ad: 0 });

  try {
    const s = await api('/api/shipments');
    (s.shipments || []).forEach(sp => {
      if (sp.arrivedAt) {
        const to = sp.toCountry; const from = sp.fromCountry;
        if (to && to !== 'china') { per[to] = per[to] || { stock: 0, ad: 0 }; per[to].stock += (+sp.qty||0); }
        if (from && from !== 'china') { per[from] = per[from] || { stock: 0, ad: 0 }; per[from].stock -= (+sp.qty||0); }
      }
    });
  } catch {}

  try {
    const r = await api('/api/remittances');
    (r.remittances || []).forEach(rr => {
      if (rr.country !== 'china') {
        per[rr.country] = per[rr.country] || { stock: 0, ad: 0 };
        per[rr.country].stock -= (+rr.pieces || 0);
      }
    });
  } catch {}

  try {
    const a = await api('/api/adspend');
    (a.adSpends || []).forEach(x => {
      if (x.country !== 'china') {
        per[x.country] = per[x.country] || { stock: 0, ad: 0 };
        per[x.country].ad += (+x.amount || 0);
      }
    });
  } catch {}

  let st=0, ad=0;
  const rows = Object.entries(per).map(([c,v])=>{
    st += v.stock; ad += v.ad;
    return `<tr><td>${c}</td><td>${fmt(v.stock)}</td><td>${fmt(v.ad)}</td></tr>`;
  }).join('');
  body.innerHTML = rows || `<tr><td colspan="3" class="muted">No data</td></tr>`;
  if (footerStock) footerStock.textContent = fmt(st);
  if (footerAd) footerAd.textContent = fmt(ad);
}

function weekRangeFrom(dateISO) {
  const d = new Date(dateISO);
  const day = (d.getDay() + 6) % 7; 
  d.setDate(d.getDate() - day);
  return [...Array(7)].map((_, i) => {
    const dd = new Date(d); dd.setDate(d.getDate() + i);
    return dd.toISOString().slice(0,10);
  });
}

function computeCurrentWeekTotals(deliveries) {
  const days = weekRangeFrom(todayISO());
  const set = new Set(days);
  let total = 0;
  const perDay = [0,0,0,0,0,0,0];
  deliveries.filter(x => set.has(x.date) && x.country !== 'china').forEach(x => {
    const idx = days.indexOf(x.date);
    if (idx >= 0) { perDay[idx] += (+x.delivered||0); total += (+x.delivered||0); }
  });
  return { days, perDay, total };
}

async function initWeeklyDelivered() {
  const head = Q('#weeklyHead'), body = Q('#weeklyBody'); if (!head || !body) return;

  const days = weekRangeFrom(todayISO());
  head.innerHTML = `<tr><th>Country</th>${days.map(d=>`<th>${new Date(d).toLocaleDateString(undefined,{weekday:'short'})}<br>${d}</th>`).join('')}<th>Total</th></tr>`;

  body.innerHTML = state.countries.map(c => {
    const tds = days.map(d => `<td><input class="wd-cell" data-country="${c}" data-date="${d}" type="number" min="0" placeholder="0"/></td>`).join('');
    return `<tr data-row="${c}"><td>${c}</td>${tds}<td class="row-total">0</td></tr>`;
  }).join('');

  try {
    const r = await api('/api/deliveries');
    const byKey = {}; (r.deliveries || []).forEach(x => byKey[`${x.country}|${x.date}`] = +x.delivered || 0);
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
        await api('/api/deliveries', { method: 'POST', body: JSON.stringify(rec) });
      }
      alert('Saved');
      renderKpis();
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
  QA('tr[data-row]').forEach(tr => {
    const t = QA('.wd-cell', tr).reduce((s, el) => s + (+el.value || 0), 0);
    Q('.row-total', tr).textContent = fmt(t);
  });
  const cols = QA('#weeklyHead th').length - 2;
  let grand = 0;
  for (let i = 0; i < cols; i++) {
    let sum = 0;
    QA('tr[data-row]').forEach(tr => {
      const inp = QA('.wd-cell', tr)[i];
      sum += (+inp.value || 0);
    });
    QA('.totals th')[i+1].textContent = fmt(sum);
    grand += sum;
  }
  Q('#wAllT') && (Q('#wAllT').textContent = fmt(grand));
}

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
      await api('/api/adspend', { method: 'POST', body: JSON.stringify(payload) });
      alert('Saved');
      renderKpis();
      renderStockAndSpendByCountry();
    } catch (e) { alert(e.message); }
  });
}

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
    if (!payload.productId) return alert('Select product');
    try {
      await api('/api/shipments', { method: 'POST', body: JSON.stringify(payload) });
      alert('Movement added');
      renderTransitTables();
    } catch (e) { alert(e.message); }
  });
}

async function renderTransitTables() {
  const s = await api('/api/shipments');
  const list = (s.shipments || []).filter(x => !x.arrivedAt);
  const productsById = Object.fromEntries((state.products || []).map(p => [p.id, p.name]));

  const ck = list.filter(sp =>
    (sp.fromCountry||'').toLowerCase() === 'china' &&
    (sp.toCountry||'').toLowerCase() === 'kenya'
  );
  const ic = list.filter(sp => !ck.includes(sp));

  const ckb = Q('#shipCKBody'), icb = Q('#shipICBody');
  if (ckb) ckb.innerHTML = ck.map(sp => rowTransit(sp, productsById)).join('') || `<tr><td colspan="9" class="muted">No transit</td></tr>`;
  if (icb) icb.innerHTML = ic.map(sp => rowTransit(sp, productsById)).join('') || `<tr><td colspan="9" class="muted">No transit</td></tr>`;

  QA('[data-mark-arrived]').forEach(b => b.onclick = async () => {
    const id = b.dataset.markArrived;
    const date = prompt('Arrival date (YYYY-MM-DD)', todayISO());
    if (!date) return;
    try {
      await api('/api/shipments/' + id, { method: 'PUT', body: JSON.stringify({ arrivedAt: date }) });
    } catch (e) { return alert(e.message); }
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
    const qty = +prompt('New qty?') || 0;
    const shipCost = +prompt('New shipping cost?') || 0;
    await api('/api/shipments/' + id, { method:'PUT', body: JSON.stringify({ qty, shipCost }) });
    renderTransitTables();
  });
}

function rowTransit(sp, productsById) {
  const name = productsById[sp.productId] || sp.productId;
  const days = sp.arrivedAt && sp.departedAt ? Math.max(0, Math.round((+new Date(sp.arrivedAt) - +new Date(sp.departedAt)) / 86400000)) : '';
  return `<tr>
    <td>${sp.id}</td>
    <td>${name}</td>
    <td>${(sp.fromCountry)} → ${(sp.toCountry)}</td>
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
        if (x.country === 'china') return;
        if (c && x.country !== c) return;
        byC[x.country] = byC[x.country] || { revenue: 0, ad: 0, extra: 0, pieces: 0 };
        byC[x.country].revenue += +x.revenue || 0;
        byC[x.country].ad += +x.adSpend || 0;
        byC[x.country].extra += (+x.extraPerPiece || 0) * (+x.pieces || 0);
        byC[x.country].pieces += +x.pieces || 0;
      });
      let R=0,A=0,E=0,P=0,PCS=0;
      const tb = Q('#profitCountryBody');
      tb.innerHTML = Object.entries(byC).map(([cc, v]) => {
        const profit = v.revenue - v.ad - v.extra;
        R+=v.revenue; A+=v.ad; E+=v.extra; P+=profit; PCS+=v.pieces;
        return `<tr><td>${cc}</td><td>${fmt(v.revenue)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.extra)}</td><td>${fmt(v.pieces)}</td><td>${fmt(profit)}</td></tr>`;
      }).join('') || `<tr><td colspan="6" class="muted">No data</td></tr>`;
      Q('#pcRevT').textContent = fmt(R);
      Q('#pcAdT').textContent = fmt(A);
      Q('#pcDelT').textContent = fmt(E);
      Q('#pcPiecesT').textContent = fmt(PCS);
      Q('#pcProfitT').textContent = fmt(P);
    } catch (e) { alert(e.message); }
  });
}

function initTodos() {
  const KEY = 'eas_todos';
  const WEEK = 'eas_weekly';

  function load(k){ return JSON.parse(localStorage.getItem(k) || '[]'); }
  function save(k,v){ localStorage.setItem(k, JSON.stringify(v)); }

  function renderQuick() {
    const list = load(KEY);
    const ul = Q('#todoList'); if (!ul) return;
    ul.innerHTML = list.map(t =>
      `<div class="flex"><span>${t.done?'✅ ':''}${t.text}</span>
       <button class="btn outline" data-done="${t.id}">${t.done?'Undo':'Done'}</button>
       <button class="btn outline" data-del="${t.id}">Delete</button></div>`).join('');
    Q('#todoAdd')?.onclick = () => {
      const v = Q('#todoText').value.trim(); if (!v) return;
      list.push({ id: crypto.randomUUID(), text: v, done:false }); save(KEY, list); renderQuick();
    };
    ul.onclick = e => {
      if (e.target.dataset.done) {
        const it = list.find(x=>x.id===e.target.dataset.done); it.done=!it.done; save(KEY,list); renderQuick();
      } else if (e.target.dataset.del) {
        const i = list.findIndex(x=>x.id===e.target.dataset.del); list.splice(i,1); save(KEY,list); renderQuick();
      }
    };
  }
  renderQuick();

  function renderWeekly() {
    const data = JSON.parse(localStorage.getItem(WEEK) || '{}');
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
        localStorage.setItem(WEEK, JSON.stringify(data)); renderWeekly();
      }
      if (e.target.dataset.tgl) {
        const [d,id] = e.target.dataset.tgl.split('|');
        const it = (data[d]||[]).find(x=>x.id===id); it.done=!it.done;
        localStorage.setItem(WEEK, JSON.stringify(data)); renderWeekly();
      }
      if (e.target.dataset.del) {
        const [d,id] = e.target.dataset.del.split('|');
        const arr = (data[d]||[]); const i = arr.findIndex(x=>x.id===id); arr.splice(i,1);
        data[d]=arr; localStorage.setItem(WEEK, JSON.stringify(data)); renderWeekly();
      }
    };
  }
  renderWeekly();
}

/* ===================== PRODUCTS LIST ===================== */
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
      if (!confirm('Delete product (and purge related data)?')) return;
      await api('/api/products/' + del, { method:'DELETE' });
      await preloadProducts(); renderProductsTable();
      renderStockAndSpendByCountry();
    }
  };
}

/* ===================== PERFORMANCE ===================== */
function initPerformance() {
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
    const by = {};
    const prodMap = Object.fromEntries(state.products.map(p=>[p.id,p]));

    (r.remittances || []).forEach(x => {
      if (x.country === 'china') return;
      const key = x.productId + '|' + x.country;
      if (!by[key]) by[key] = { name: (prodMap[x.productId]?.name || x.productId), country: x.country, pieces:0, ad:0, prodCost:0, profit:0 };
      by[key].pieces += (+x.pieces||0);
      by[key].ad += (+x.adSpend||0);
      const base = (+prodMap[x.productId]?.cost_china||0) + (+prodMap[x.productId]?.ship_china_to_kenya||0);
      const extra = (+x.extraPerPiece||0) * (+x.pieces||0);
      const profit = (+x.revenue||0) - (+x.adSpend||0) - (base*(+x.pieces||0)) - extra;
      by[key].prodCost += base * (+x.pieces||0);
      by[key].profit += profit;
    });

    const tb = Q('#pfTable tbody');
    tb.innerHTML = Object.values(by).sort((a,b)=>b.pieces-a.pieces).map(it =>
      `<tr><td>${it.name}</td><td>${it.country}</td><td>${fmt(it.pieces)}</td><td>${fmt(it.ad)}</td><td>${fmt(it.prodCost)}</td><td>${fmt(it.profit)}</td><td>${it.pieces?fmt(it.profit/it.pieces):'0'}</td></tr>`
    ).join('') || `<tr><td colspan="7" class="muted">No data</td></tr>`;
  });

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
    alert('Remittance saved');
  });
}

/* ===================== FINANCE ===================== */
async function initFinance() {
  await loadFinanceCats();
  Q('#fcAdd')?.addEventListener('click', async () => {
    const type = Q('#fcType').value, name = Q('#fcName').value.trim();
    if (!name) return;
    await api('/api/finance/categories', { method:'POST', body: JSON.stringify({ type, name }) });
    await loadFinanceCats();
    Q('#fcName').value = '';
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
    Q('#fcDebits') && (Q('#fcDebits').innerHTML = cats.debit.map(c=>`<span class="chip">${c} <button class="x" data-del-debit="${c}">×</button></span>`).join('') || '—');
    Q('#fcCredits') && (Q('#fcCredits').innerHTML = cats.credit.map(c=>`<span class="chip">${c} <button class="x" data-del-credit="${c}">×</button></span>`).join('') || '—');

    const all = [...cats.debit, ...cats.credit].sort();
    Q('#feCat') && (Q('#feCat').innerHTML = `<option value="" disabled selected>Select category</option>` + all.map(c=>`<option>${c}</option>`).join(''));

    const catsWrap = Q('.cats');
    catsWrap && (catsWrap.onclick = async e => {
      if (e.target.dataset.delDebit) {
        await api('/api/finance/categories?type=debit&name=' + encodeURIComponent(e.target.dataset.delDebit), { method:'DELETE' });
        await loadFinanceCats();
      } else if (e.target.dataset.delCredit) {
        await api('/api/finance/categories?type=credit&name=' + encodeURIComponent(e.target.dataset.delCredit), { method:'DELETE' });
        await loadFinanceCats();
      }
    });
  } catch {}
}

async function renderFinancePeriod() {
  try {
    const s = Q('#fes')?.value, e = Q('#fee')?.value;
    const r = await api('/api/finance/entries' + ((s||e)?(`?start=${s||''}&end=${e||''}`):''));
    const entries = r.entries || [];
Q('#feRunning') && (Q('#feRunning').textContent = fmt(r.running || 0) + ' USD');
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

/* ===================== SETTINGS ===================== */
function initSettings() {
  Q('#ctyAdd')?.addEventListener('click', async () => {
    const name = Q('#cty').value.trim(); if (!name) return;
    await api('/api/countries', { method:'POST', body: JSON.stringify({ name }) });
    const m = await api('/api/meta'); state.countries = (m.countries||[]).filter(c=>c!=='china');
    fillGlobalSelects(); renderCountryChips();
  });
  renderCountryChips();

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
      await preloadProducts();
      alert('Saved');
    });
  }

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
  list.innerHTML = state.countries.map(c => `<span class="chip">${c} <button class="x" data-del-cty="${c}">×</button></span>`).join('') || '—';
  list.onclick = async e => {
    const c = e.target.dataset.delCty; if (!c) return;
    await api('/api/countries/' + encodeURIComponent(c), { method:'DELETE' });
    const m = await api('/api/meta'); state.countries = (m.countries||[]).filter(x=>x!=='china');
    fillGlobalSelects(); renderCountryChips();
  };
}

async function renderSnapshots() {
  const r = await api('/api/snapshots');
  const box = Q('#snapList'); if (!box) return;
  box.innerHTML = (r.snapshots || []).map(s =>
    `<tr>
      <td>${s.name}</td>
      <td>${s.file.replace(/^.*data\/snapshots\//,'')}</td>
      <td>
        <button class="btn outline" data-restore="${s.file}">Push</button>
        <button class="btn outline" data-del-snap="${s.id}">Delete</button>
      </td>
    </tr>`
  ).join('') || '<tr><td colspan="3" class="muted">No snapshots yet</td></tr>';

  box.onclick = async e => {
    if (e.target.dataset.restore) {
      await api('/api/snapshots/restore', { method:'POST', body: JSON.stringify({ file: e.target.dataset.restore }) });
      alert('System restored');
      // keep snapshot; do not delete
      location.reload();
    } else if (e.target.dataset.delSnap) {
      await api('/api/snapshots/' + e.target.dataset.delSnap, { method:'DELETE' });
      renderSnapshots();
    }
  };
}

/* ===================== LIFETIME PRODUCT PERFORMANCE (GLOBAL) ===================== */
function initLifetimeGlobal() {
  Q('#lpRun')?.addEventListener('click', async () => {
    const prodId = Q('#lpProduct')?.value || '';
    const s = Q('#lpStart')?.value, e = Q('#lpEnd')?.value;
    const r = await api('/api/remittances' + ((s||e)?`?start=${s||''}&end=${e||''}`:''));
    const list = (r.remittances || []).filter(x => x.country !== 'china').filter(x => (!prodId || x.productId === prodId));

    const prodMap = Object.fromEntries(state.products.map(p=>[p.id,p]));
    const byKey = {};
    list.forEach(x => {
      const key = x.productId + '|' + x.country;
      if (!byKey[key]) byKey[key] = { name: (prodMap[x.productId]?.name || x.productId), country: x.country, rev:0, ad:0, ship:0, base:0, pcs:0, profit:0 };
      const pcs = +x.pieces || 0;
      const base = (+prodMap[x.productId]?.cost_china||0) + (+prodMap[x.productId]?.ship_china_to_kenya||0);
      const extra = (+x.extraPerPiece||0) * pcs;
      byKey[key].rev += +x.revenue || 0;
      byKey[key].ad += +x.adSpend || 0;
      byKey[key].ship += extra;
      byKey[key].base += base * pcs;
      byKey[key].pcs += pcs;
    });
    Object.values(byKey).forEach(v => v.profit = v.rev - v.ad - v.ship - v.base);

    const tb = Q('#lifetimeBody'); if (!tb) return;
    let R=0,A=0,S=0,B=0,P=0,PCS=0;
    tb.innerHTML = Object.values(byKey).map(v=>{
      R+=v.rev; A+=v.ad; S+=v.ship; B+=v.base; P+=v.profit; PCS+=v.pcs;
      return `<tr><td>${v.name}</td><td>${v.country}</td><td>${fmt(v.rev)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.ship)}</td><td>${fmt(v.base)}</td><td>${fmt(v.pcs)}</td><td>${fmt(v.profit)}</td></tr>`;
    }).join('') || `<tr><td colspan="8" class="muted">No data</td></tr>`;
    Q('#ltRevT').textContent = fmt(R); Q('#ltAdT').textContent = fmt(A);
    Q('#ltShipT').textContent = fmt(S); Q('#ltBaseT').textContent = fmt(B);
    Q('#ltPiecesT').textContent = fmt(PCS); Q('#ltProfitT').textContent = fmt(P);
  });
}

/* ===================== PRODUCT PAGE ===================== */
async function loadProduct(id) {
  await preloadProducts();
  state.product = state.products.find(p => p.id === id) || null;
}

function renderProductPage() {
  if (!state.product) { alert('Product not found'); location.href='/'; return; }
  Q('#pdTitle').textContent = state.product.name;
  Q('#pdSku').textContent = state.product.sku ? `SKU: ${state.product.sku}` : '';
  fillGlobalSelects();
  bindProductHandlers();
  refreshProductSections();
}

function bindProductHandlers() {
  Q('#pdPBSave')?.addEventListener('click', async () => {
    const country = Q('#pdPBCountry').value; const value = +Q('#pdPBValue').value || 0;
    const p = { budgets: state.product.budgets || {} }; p.budgets[country] = value;
    await api('/api/products/' + state.product.id, { method:'PUT', body: JSON.stringify(p) });
    await loadProduct(state.product.id); renderPBTable();
  });

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
    await api('/api/shipments', { method:'POST', body: JSON.stringify(payload) });
    refreshProductSections();
  });

  Q('#pdLPRun')?.addEventListener('click', () => renderProductLifetime());

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
  renderProductRemittances();
  renderProductTransit();
  renderProductArrived();
  renderProductLifetime();
  renderInfluencers();
  renderProductRemittanceEntries();
}

async function renderProductStockAd() {
  const tb = Q('#pdStockBody'); if (!tb) return;

  const per = {}; state.countries.forEach(c => per[c] = { stock: 0, ad: 0 });
  const s = await api('/api/shipments');
  (s.shipments || []).filter(x=>x.productId===state.product.id && x.arrivedAt).forEach(sp => {
    const to = sp.toCountry, from = sp.fromCountry, q = (+sp.qty||0);
    if (to !== 'china') { per[to] = per[to]||{stock:0,ad:0}; per[to].stock += q; }
    if (from !== 'china') { per[from]=per[from]||{stock:0,ad:0}; per[from].stock -= q; }
  });

  const r = await api('/api/remittances');
  (r.remittances || []).filter(x=>x.productId===state.product.id && x.country!=='china').forEach(rr => {
    per[rr.country] = per[rr.country] || { stock:0, ad:0 };
    per[rr.country].stock -= (+rr.pieces||0);
  });

  const a = await api('/api/adspend');
  (a.adSpends || []).filter(x=>x.productId===state.product.id && x.country!=='china').forEach(ad => {
    per[ad.country] = per[ad.country] || { stock:0, ad:0 };
    per[ad.country].ad += (+ad.amount||0);
  });

  let st=0, at=0;
  tb.innerHTML = Object.entries(per).map(([c,v])=>{
    st+=v.stock; at+=v.ad;
    return `<tr><td>${c}</td><td>${fmt(v.stock)}</td><td>${fmt(v.ad)}</td></tr>`;
  }).join('');
  Q('#pdStockTotal').textContent = fmt(st);
  Q('#pdAdTotal').textContent = fmt(at);

  const transit = (s.shipments || []).filter(x=>x.productId===state.product.id && !x.arrivedAt)
                   .reduce((t,x)=>t+(+x.qty||0),0);
  Q('#pdTransitBadge').textContent = `Transit total: ${fmt(transit)}`;
}

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

async function renderProductAdList() {
  const a = await api('/api/adspend');
  const list = (a.adSpends || []).filter(x=>x.productId===state.product.id && x.country!=='china');
  const tb = Q('#pdAdBody'); if (!tb) return;
  tb.innerHTML = list.map(x => `<tr><td>${x.country}</td><td>${x.platform}</td><td>${fmt(x.amount)}</td></tr>`).join('') ||
    `<tr><td colspan="3" class="muted">No ad spend yet</td></tr>`;
}

async function renderProductRemittances() {
  const r = await api('/api/remittances');
  const list = (r.remittances || []).filter(x=>x.productId===state.product.id && x.country!=='china');
  const tb = Q('#pdRBody'); if (!tb) return;
  let R=0,A=0,E=0,P=0;
  tb.innerHTML = list.map(x=>{
    const extra = (+x.extraPerPiece||0) * (+x.pieces||0);
    const profit = (+x.revenue||0) - (+x.adSpend||0) - extra;
    R += +x.revenue||0; A += +x.adSpend||0; E += extra; P += profit;
    return `<tr><td>${x.start} → ${x.end}</td><td>${x.country}</td><td>${fmt(x.orders)}</td><td>${fmt(x.pieces)}</td><td>${fmt(x.revenue)}</td><td>${fmt(x.adSpend)}</td><td>${fmt(x.extraPerPiece)}</td><td>${fmt(profit)}</td></tr>`;
  }).join('') || `<tr><td colspan="8" class="muted">No entries</td></tr>`;
  Q('#pdRRevT').textContent = fmt(R); Q('#pdRAdT').textContent = fmt(A); Q('#pdRExtraT').textContent = fmt(E); Q('#pdRProfitT').textContent = fmt(P);
}

async function renderProductTransit() {
  const s = await api('/api/shipments');
  const list = (s.shipments || []).filter(x=>x.productId===state.product.id && !x.arrivedAt);
  const ck = list.filter(sp =>
    (sp.fromCountry||'').toLowerCase()==='china' &&
    (sp.toCountry||'').toLowerCase()==='kenya'
  );
  const ic = list.filter(sp => !ck.includes(sp));

  const tb1 = Q('#pdShipCKBody'), tb2 = Q('#pdShipICBody');
  const row = sp => {
    const days = sp.arrivedAt && sp.departedAt ? Math.max(0, Math.round((+new Date(sp.arrivedAt) - +new Date(sp.departedAt)) / 86400000)) : '';
    return `<tr>
      <td>${sp.id}</td><td>${(sp.fromCountry)} → ${(sp.toCountry)}</td>
      <td>${fmt(sp.qty)}</td><td>${fmt(sp.shipCost)}</td>
      <td>${sp.departedAt||''}</td><td>${sp.arrivedAt||''}</td><td>${days}</td>
      <td>
        <button class="btn outline" data-mark-arrived="${sp.id}">Mark Arrived</button>
        <button class="btn outline" data-edit-transit="${sp.id}">Edit</button>
        <button class="btn outline" data-del-transit="${sp.id}">Delete</button>
      </td>
    </tr>`;
  };

  tb1.innerHTML = ck.map(row).join('') || `<tr><td colspan="8" class="muted">No shipments</td></tr>`;
  tb2.innerHTML = ic.map(row).join('') || `<tr><td colspan="8" class="muted">No shipments</td></tr>`;

  QA('[data-mark-arrived]').forEach(b => b.onclick = async () => {
    const id = b.dataset.markArrived;
    const date = prompt('Arrival date (YYYY-MM-DD)', todayISO()); if (!date) return;
    await api('/api/shipments/' + id, { method:'PUT', body: JSON.stringify({ arrivedAt: date }) });
    renderProductTransit(); renderProductArrived(); renderProductStockAd();
  });
  QA('[data-del-transit]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete shipment?')) return;
    await api('/api/shipments/' + b.dataset.delTransit, { method:'DELETE' });
    renderProductTransit(); renderProductArrived();
  });
  QA('[data-edit-transit]').forEach(b => b.onclick = async () => {
    const id = b.dataset.editTransit;
    const qty = +prompt('New qty?') || 0;
    const shipCost = +prompt('New shipping cost?') || 0;
    await api('/api/shipments/' + id, { method:'PUT', body: JSON.stringify({ qty, shipCost }) });
    renderProductTransit();
  });
}

async function renderProductArrived() {
  const s = await api('/api/shipments');
  const list = (s.shipments || []).filter(x=>x.productId===state.product.id && x.arrivedAt);
  const tb = Q('#pdShipArrivedBody'); if (!tb) return;
  const rows = list.map(sp => {
    const days = Math.max(0, Math.round((+new Date(sp.arrivedAt) - +new Date(sp.departedAt)) / 86400000));
    return `<tr>
      <td>${sp.id}</td><td>${sp.fromCountry} → ${sp.toCountry}</td>
      <td>${fmt(sp.qty)}</td><td>${fmt(sp.shipCost)}</td><td>${sp.departedAt}</td><td>${sp.arrivedAt}</td><td>${days}</td>
    </tr>`;
  }).join('');
  tb.innerHTML = rows || `<tr><td colspan="7" class="muted">No arrived shipments</td></tr>`;
}

async function renderProductLifetime() {
  const s = Q('#pdLPStart')?.value, e = Q('#pdLPEnd')?.value;
  const r = await api('/api/remittances' + ((s||e)?`?start=${s||''}&end=${e||''}`:''));
  const list = (r.remittances || []).filter(x=>x.productId===state.product.id && x.country!=='china');

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

async function renderInfluencers() {
  const infs = await api('/api/influencers');
  const spends = await api('/api/influencers/spend');
  const sel = Q('#pdInfSelect'); if (sel) sel.innerHTML = (infs.influencers||[]).map(i=>`<option value="${i.id}">${i.name}</option>`).join('');

  const s = Q('#pdInfStart')?.value, e = Q('#pdInfEnd')?.value, c = Q('#pdInfFilterCountry')?.value || '';
  const list = (spends.spends || []).filter(x => x.productId === state.product.id)
    .filter(x => (!c || x.country === c))
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

async function renderProductRemittanceEntries() {
  const r = await api('/api/remittances');
  const list = (r.remittances || []).filter(x=>x.productId===state.product.id && x.country!=='china');
  const tb = Q('#pdREntriesBody'); if (!tb) return;
  tb.innerHTML = list.map(x=>`<tr>
    <td>${x.start} → ${x.end}</td><td>${x.country}</td><td>${fmt(x.orders)}</td><td>${fmt(x.pieces)}</td><td>${fmt(x.revenue)}</td><td>${fmt(x.adSpend)}</td><td>${fmt(x.extraPerPiece)}</td>
    <td><button class="btn outline" data-del-rem="${x.id}">Delete</button></td>
  </tr>`).join('') || `<tr><td colspan="8" class="muted">No remittance entries</td></tr>`;
  tb.onclick = async e => {
    if (e.target.dataset.delRem) {
      await api('/api/remittances/' + e.target.dataset.delRem, { method:'DELETE' });
      renderProductRemittanceEntries();
      renderProductLifetime();
      renderProductStockAd();
    }
  };
}

/* ===================== NAV ===================== */
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

/* ===================== BOOT ===================== */
gate();
