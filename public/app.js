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

const businessCountries = () => state.countries.filter(c => c.toLowerCase() !== 'china');

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

function fillGlobalSelects() {
  const bc = businessCountries();
  const csBiz = [
    '#adCountry', '#rCountry', '#pfCountry', '#pcCountry',
    '#pdAdCountry', '#pdRCountry', '#pdInfCountry', '#pdInfFilterCountry', '#pdPBCountry'
  ];
  csBiz.forEach(sel => {
    QA(sel).forEach(el => {
      el.innerHTML = bc.map(c => `<option value="${c}">${c}</option>`).join('');
    });
  });

  const csAll = ['#mvFrom', '#mvTo', '#pdMvFrom', '#pdMvTo'];
  csAll.forEach(sel => {
    QA(sel).forEach(el => {
      el.innerHTML = state.countries.map(c => `<option value="${c}">${c}</option>`).join('');
    });
  });

  const ps = ['#adProduct', '#rProduct', '#mvProduct'];
  ps.forEach(sel => {
    QA(sel).forEach(el => {
      el.innerHTML = state.products.map(p => `<option value="${p.id}">${p.name}${p.sku ? ' (' + p.sku + ')' : ''}</option>`).join('');
    });
  });

  const pfCountry = Q('#pfCountry');
  if (pfCountry) {
    pfCountry.innerHTML = `<option value="">All countries</option>` + bc.map(c => `<option value="${c}">${c}</option>`).join('');
  }
  const pcCountry = Q('#pcCountry');
  if (pcCountry) {
    pcCountry.innerHTML = `<option value="">All countries</option>` + bc.map(c => `<option value="${c}">${c}</option>`).join('');
  }

  const lpProduct = Q('#lpProduct');
  if (lpProduct) {
    lpProduct.innerHTML = `<option value="">All products</option>` + state.products.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  }

  const epSelect = Q('#epSelect');
  if (epSelect) {
    epSelect.innerHTML = `<option value="">Select product…</option>` + state.products.map(p => `<option value="${p.id}">${p.name}${p.sku?' ('+p.sku+')':''}</option>`).join('');
  }
}

/* ======================= Dashboard ======================= */
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
  Q('#kpiProducts') && (Q('#kpiProducts').textContent = state.products.length);
  Q('#kpiCountries') && (Q('#kpiCountries').textContent = businessCountries().length);

  try {
    const s = await api('/api/shipments');
    const live = (s.shipments || []).filter(x => !x.arrivedAt).length;
    Q('#kpiTransit') && (Q('#kpiTransit').textContent = live);
  } catch { Q('#kpiTransit') && (Q('#kpiTransit').textContent = '—'); }

  try {
    const a = await api('/api/adspend');
    const total = (a.adSpends || []).reduce((t, x) => t + (+x.amount || 0), 0);
    Q('#kpiAdSpend') && (Q('#kpiAdSpend').textContent = fmt(total) + ' USD');
  } catch { Q('#kpiAdSpend') && (Q('#kpiAdSpend').textContent = '—'); }

  try {
    const wdGrand = Q('#wAllT')?.textContent;
    if (wdGrand) Q('#kpiDelivered').textContent = wdGrand;
  } catch { Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = '—'); }
}

async function renderStockAndSpendByCountry() {
  const tb = Q('#stockByCountryBody'); if (!tb) return;
  const bc = businessCountries();
  const per = {};
  bc.forEach(c => per[c] = { stock: 0, ad: 0 });

  try {
    const s = await api('/api/shipments');
    (s.shipments || []).forEach(sp => {
      if (sp.arrivedAt) {
        const to = sp.toCountry || sp.to;
        const from = sp.fromCountry || sp.from;
        if (bc.includes(to)) per[to].stock += (+sp.qty || 0);
        if (bc.includes(from)) per[from].stock -= (+sp.qty || 0);
      }
    });
  } catch {}

  try {
    const r = await api('/api/remittances');
    (r.remittances || []).forEach(rr => {
      if (bc.includes(rr.country)) {
        per[rr.country] = per[rr.country] || { stock: 0, ad: 0 };
        per[rr.country].stock -= (+rr.pieces || 0);
      }
    });
  } catch {}

  try {
    const a = await api('/api/adspend');
    (a.adSpends || []).forEach(x => {
      if (bc.includes(x.country)) {
        per[x.country] = per[x.country] || { stock: 0, ad: 0 };
        per[x.country].ad += (+x.amount || 0);
      }
    });
  } catch {}

  let stockT = 0, adT = 0;
  const rows = bc.map(c => {
    const v = per[c] || { stock: 0, ad: 0 };
    stockT += v.stock; adT += v.ad;
    return `<tr><td>${c}</td><td>${fmt(v.stock)}</td><td>${fmt(v.ad)}</td></tr>`;
  }).join('');
  tb.innerHTML = rows || `<tr><td colspan="3" class="muted">No data</td></tr>`;
  Q('#stockTotal') && (Q('#stockTotal').textContent = fmt(stockT));
  Q('#adTotal') && (Q('#adTotal').textContent = fmt(adT));
}

function weekRangeFrom(date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return [...Array(7)].map((_, i) => {
    const dd = new Date(d); dd.setDate(d.getDate() + i);
    return dd.toISOString().slice(0,10);
  });
}

async function initWeeklyDelivered() {
  const head = Q('#weeklyHead');
  const body = Q('#weeklyBody');
  const range = Q('#weeklyRange');
  if (!head || !body) return;

  let base = todayISO();
  const renderGrid = async () => {
    const days = weekRangeFrom(base);
    range.textContent = `Week: ${days[0]} → ${days[6]}`;
    head.innerHTML = `<tr><th>Country</th>${
      days.map(d=>`<th>${new Date(d).toLocaleDateString(undefined,{weekday:'short'})}<br>${d}</th>`).join('')
    }<th>Total</th></tr>`;
    const bc = businessCountries();
    body.innerHTML = bc.map(c => {
      const cells = days.map(d => `<td><input class="wd-cell" data-country="${c}" data-date="${d}" type="number" min="0" placeholder="0"/></td>`).join('');
      return `<tr data-row="${c}"><td>${c}</td>${cells}<td class="row-total">0</td></tr>`;
    }).join('');

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
  };

  const computeWeeklyTotals = () => {
    QA('tr[data-row]').forEach(tr => {
      const t = QA('.wd-cell', tr).reduce((s, el) => s + (+el.value || 0), 0);
      Q('.row-total', tr).textContent = fmt(t);
    });
    const cols = QA('thead th', Q('#weeklyTable')).length - 2;
    let grand = 0;
    for (let i = 0; i < cols; i++) {
      let sum = 0;
      QA('tr[data-row]').forEach(tr => {
        const inp = QA('.wd-cell', tr)[i];
        sum += (+inp.value || 0);
      });
      QA('tfoot .totals th')[i+1].textContent = fmt(sum);
      grand += sum;
    }
    Q('#wAllT').textContent = fmt(grand);
    const kpi = Q('#kpiDelivered'); if (kpi) kpi.textContent = fmt(grand);
  };

  Q('#weeklyPrev')?.addEventListener('click', () => { const d = new Date(base); d.setDate(d.getDate()-7); base = d.toISOString().slice(0,10); renderGrid(); });
  Q('#weeklyNext')?.addEventListener('click', () => { const d = new Date(base); d.setDate(d.getDate()+7); base = d.toISOString().slice(0,10); renderGrid(); });
  Q('#weeklyTable')?.addEventListener('input', e => { if (e.target.classList.contains('wd-cell')) computeWeeklyTotals(); });

  Q('#weeklyReset')?.addEventListener('click', () => {
    QA('.wd-cell').forEach(el => el.value = '');
    QA('tfoot .totals th').forEach((th,i) => { if (i>0) th.textContent = '0'; });
    Q('#wAllT').textContent = '0';
    Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = '0');
  });

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
      alert('Weekly delivered saved');
      renderKpis();
      renderStockAndSpendByCountry();
    } catch (e) {
      alert('Save failed: ' + e.message);
    }
  });

  renderGrid();
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
      renderKpis();
      renderStockAndSpendByCountry();
      alert('Saved');
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
      renderTransitTables();
      alert('Movement added');
    } catch (e) { alert(e.message); }
  });
}

async function renderTransitTables() {
  const s = await api('/api/shipments');
  const list = (s.shipments || []).filter(x => !x.arrivedAt);
  const productsById = Object.fromEntries((state.products || []).map(p => [p.id, p.name]));

  const ckb = Q('#shipCKBody'); if (ckb) {
    const ck = list.filter(sp =>
      (sp.fromCountry || sp.from || '').toLowerCase() === 'china' &&
      (sp.toCountry || sp.to || '').toLowerCase() === 'kenya'
    );
    ckb.innerHTML = ck.map(sp => rowTransit(sp, productsById)).join('') || '<tr><td colspan="9" class="muted">No transit</td></tr>';
  }

  const icb = Q('#shipICBody'); if (icb) {
    const ic = list.filter(sp => !(
      (sp.fromCountry || sp.from || '').toLowerCase() === 'china' &&
      (sp.toCountry || sp.to || '').toLowerCase() === 'kenya'
    ));
    icb.innerHTML = ic.map(sp => rowTransit(sp, productsById)).join('') || '<tr><td colspan="9" class="muted">No transit</td></tr>';
  }

  QA('[data-mark-arrived]').forEach(b => b.onclick = async () => {
    const id = b.dataset.markArrived;
    const date = prompt('Arrival date (YYYY-MM-DD)', todayISO());
    if (!date) return;
    try {
      await api('/api/shipments/' + id, { method: 'PUT', body: JSON.stringify({ arrivedAt: date }) });
      renderTransitTables();
      renderStockAndSpendByCountry();
    } catch (e) { alert(e.message); }
  });
  QA('[data-del-transit]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete shipment?')) return;
    try {
      await api('/api/shipments/' + b.dataset.delTransit, { method: 'DELETE' });
      renderTransitTables();
    } catch (e) { alert(e.message); }
  });
  QA('[data-edit-transit]').forEach(b => b.onclick = async () => {
    const id = b.dataset.editTransit;
    const qty = +prompt('New qty?') || 0;
    const shipCost = +prompt('New shipping cost?') || 0;
    try {
      await api('/api/shipments/' + id, { method:'PUT', body: JSON.stringify({ qty, shipCost }) });
      renderTransitTables();
    } catch (e) { alert(e.message); }
  });
}

function rowTransit(sp, productsById) {
  const name = productsById[sp.productId] || sp.productId;
  const days = sp.arrivedAt ? Math.round((+new Date(sp.arrivedAt) - +new Date(sp.departedAt)) / 86400000) : '';
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

function initProfitByCountry() {
  Q('#pcRun')?.addEventListener('click', async () => {
    const s = Q('#pcStart')?.value, e = Q('#pcEnd')?.value, c = Q('#pcCountry')?.value || '';
    const r = await api('/api/remittances');
    const bc = businessCountries();
    const inRange = (x) => (!s || x.start >= s) && (!e || x.end <= e);
    const byC = {};
    (r.remittances || []).forEach(x => {
      if (c && x.country !== c) return;
      if (!bc.includes(x.country)) return;
      if (!inRange(x)) return;
      byC[x.country] = byC[x.country] || { revenue: 0, ad: 0, extra: 0, pieces: 0 };
      byC[x.country].revenue += +x.revenue || 0;
      byC[x.country].ad += +x.adSpend || 0;
      byC[x.country].extra += (+x.extraPerPiece || 0) * (+x.pieces || 0);
      byC[x.country].pieces += +x.pieces || 0;
    });
    const tb = Q('#profitCountryBody');
    let R=0,A=0,E=0,P=0;
    tb.innerHTML = Object.entries(byC).map(([cc, v]) => {
      const profit = v.revenue - v.ad - v.extra;
      R+=v.revenue;A+=v.ad;E+=v.extra;P+=profit;
      return `<tr><td>${cc}</td><td>${fmt(v.revenue)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.extra)}</td><td>${fmt(v.pieces)}</td><td>${fmt(profit)}</td></tr>`;
    }).join('') || `<tr><td colspan="6" class="muted">No data</td></tr>`;
    Q('#pcRevT').textContent = fmt(R);
    Q('#pcAdT').textContent = fmt(A);
    Q('#pcDelT').textContent = fmt(E);
    Q('#pcPiecesT').textContent = fmt(Object.values(byC).reduce((t,v)=>t+v.pieces,0));
    Q('#pcProfitT').textContent = fmt(P);
  });
}

function initTodos() {
  const KEY = 'eas_todos';
  const WEEK = 'eas_weekly';
  const load = k => JSON.parse(localStorage.getItem(k) || (k===WEEK?'{}':'[]'));
  const save = (k,v) => localStorage.setItem(k, JSON.stringify(v));

  const renderQuick = () => {
    const list = load(KEY);
    const ul = Q('#todoList'); if (!ul) return;
    ul.innerHTML = list.map(t =>
      `<div class="flex"><span>${t.done?'✅ ':''}${t.text}</span>
       <button class="btn outline" data-done="${t.id}">${t.done?'Undo':'Done'}</button>
       <button class="btn outline" data-del="${t.id}">Delete</button></div>`).join('');
    Q('#todoAdd')?.addEventListener('click', () => {
      const v = Q('#todoText').value.trim(); if (!v) return;
      list.push({ id: crypto.randomUUID(), text: v, done:false }); save(KEY, list); renderQuick();
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

  const renderWeekly = () => {
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
  };
  renderWeekly();
}

function initLifetimeGlobal() {
  Q('#lpRun')?.addEventListener('click', async () => {
    const prodId = Q('#lpProduct')?.value || '';
    const s = Q('#lpStart')?.value, e = Q('#lpEnd')?.value;
    const r = await api('/api/remittances');
    const bc = businessCountries();
    const prodMap = Object.fromEntries(state.products.map(p=>[p.id,p]));
    const inRange = (x) => (!s || x.start >= s) && (!e || x.end <= e);
    let list = (r.remittances || []).filter(x => inRange(x) && bc.includes(x.country));
    if (prodId) list = list.filter(x => x.productId === prodId);

    const byPK = {};
    list.forEach(x => {
      const key = `${x.productId}|${x.country}`;
      const prod = prodMap[x.productId] || {};
      const basePer = (+prod.cost_china||0) + (+prod.ship_china_to_kenya||0);
      const pcs = +x.pieces||0;
      const extra = (+x.extraPerPiece||0)*pcs;
      if (!byPK[key]) byPK[key] = { name: prod.name || x.productId, country: x.country, rev:0, ad:0, ship:0, base:0, pcs:0 };
      byPK[key].rev += +x.revenue||0;
      byPK[key].ad += +x.adSpend||0;
      byPK[key].ship += extra;
      byPK[key].base += basePer * pcs;
      byPK[key].pcs += pcs;
    });

    const tb = Q('#lifetimeBody');
    let R=0,A=0,S=0,B=0,P=0,PCS=0;
    tb.innerHTML = Object.values(byPK).map(v => {
      const profit = v.rev - v.ad - v.ship - v.base;
      R+=v.rev;A+=v.ad;S+=v.ship;B+=v.base;P+=profit;PCS+=v.pcs;
      return `<tr><td>${v.name}</td><td>${v.country}</td><td>${fmt(v.rev)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.ship)}</td><td>${fmt(v.base)}</td><td>${fmt(v.pcs)}</td><td>${fmt(profit)}</td></tr>`;
    }).join('') || `<tr><td colspan="8" class="muted">No data</td></tr>`;
    Q('#ltRevT').textContent = fmt(R);
    Q('#ltAdT').textContent = fmt(A);
    Q('#ltShipT').textContent = fmt(S);
    Q('#ltBaseT').textContent = fmt(B);
    Q('#ltPiecesT').textContent = fmt(PCS);
    Q('#ltProfitT').textContent = fmt(P);
  });
}

/* ======================= Products list ======================= */
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
      if (!confirm('Delete product and all its data?')) return;
      await api('/api/products/' + del, { method:'DELETE' });
      await preloadProducts(); fillGlobalSelects(); renderProductsTable();
      renderStockAndSpendByCountry();
      renderTransitTables();
    }
  };
}

/* ======================= Performance ======================= */
function initPerformance() {
  Q('#pfRun')?.addEventListener('click', async () => {
    const quick = Q('#pfQuick')?.value;
    let start = Q('#pfStart')?.value, end = Q('#pfEnd')?.value;
    if (quick && quick !== 'custom') {
      const d = new Date(); d.setDate(d.getDate() - (+quick));
      start = d.toISOString().slice(0,10); end = todayISO();
    }
    const c = Q('#pfCountry')?.value || '';
    const r = await api('/api/remittances');
    const bc = businessCountries();
    const prodMap = Object.fromEntries(state.products.map(p=>[p.id,p]));
    const inRange = (x) => (!start || x.start >= start) && (!end || x.end <= end);

    const byP = {};
    (r.remittances || []).forEach(x => {
      if (!inRange(x)) return;
      if (c && x.country !== c) return;
      if (!bc.includes(x.country)) return;
      const prod = prodMap[x.productId] || {};
      const base = (+prod.cost_china||0) + (+prod.ship_china_to_kenya||0);
      const pcs = +x.pieces||0;
      const extra = (+x.extraPerPiece||0) * pcs;
      const profit = (+x.revenue||0) - (+x.adSpend||0) - (base*pcs) - extra;
      if (!byP[x.productId]) byP[x.productId] = { name: prod.name || x.productId, country: c || 'All', pieces:0, ad:0, prodCost:0, profit:0 };
      byP[x.productId].pieces += pcs;
      byP[x.productId].ad += (+x.adSpend||0);
      byP[x.productId].prodCost += base * pcs;
      byP[x.productId].profit += profit;
    });

    const tb = Q('#pfTable tbody');
    tb.innerHTML = Object.values(byP).sort((a,b)=>b.pieces-a.pieces).map(it =>
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
    if (!payload.start || !payload.end) return alert('Select dates');
    if (!payload.country || !payload.productId) return alert('Missing fields');
    await api('/api/remittances', { method:'POST', body: JSON.stringify(payload) });
    Q('#rMsg').textContent = 'Saved';
    setTimeout(()=>Q('#rMsg').textContent='',1500);
  });
}

/* ======================= Finance ======================= */
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
    const deb = Q('#fcDebits'), cre = Q('#fcCredits');
    if (deb) deb.innerHTML = cats.debit.map(c=>`<span class="chip">${c}<button data-del-debit="${c}">×</button></span>`).join('') || '—';
    if (cre) cre.innerHTML = cats.credit.map(c=>`<span class="chip">${c}<button data-del-credit="${c}">×</button></span>`).join('') || '—';
    if (deb || cre) {
      (deb?.parentElement || cre?.parentElement).onclick = async e => {
        if (e.target.dataset.delDebit) {
          await api('/api/finance/categories?type=debit&name='+encodeURIComponent(e.target.dataset.delDebit), { method:'DELETE' });
          await loadFinanceCats();
        } else if (e.target.dataset.delCredit) {
          await api('/api/finance/categories?type=credit&name='+encodeURIComponent(e.target.dataset.delCredit), { method:'DELETE' });
          await loadFinanceCats();
        }
      };
    }
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

/* ======================= Settings ======================= */
function initSettings() {
  Q('#ctyAdd')?.addEventListener('click', async () => {
    const name = Q('#cty').value.trim(); if (!name) return;
    await api('/api/countries', { method:'POST', body: JSON.stringify({ name }) });
    const m = await api('/api/meta'); state.countries = m.countries || [];
    fillGlobalSelects(); renderCountryChips();
  });
  renderCountryChips();

  const sel = Q('#epSelect');
  if (sel) {
    sel.onchange = () => {
      const p = state.products.find(x=>x.id===sel.value);
      if (!p) return;
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
    await api('/api/snapshots', { method:'POST', body: JSON.stringify({ name }) });
    Q('#snapName').value = '';
    renderSnapshots();
  });
  renderSnapshots();
}

function renderCountryChips() {
  const list = Q('#ctyList'); if (!list) return;
  const bc = businessCountries();
  list.innerHTML = state.countries.map(c => {
    const dis = c.toLowerCase()==='china' ? 'disabled' : '';
    return `<span class="chip">${c}${dis?'':` <button data-del-country="${c}">×</button>`}</span>`;
  }).join('') || '—';
  list.onclick = async e => {
    if (e.target.dataset.delCountry) {
      await api('/api/countries/' + encodeURIComponent(e.target.dataset.delCountry), { method:'DELETE' });
      const m = await api('/api/meta'); state.countries = m.countries || [];
      fillGlobalSelects(); renderCountryChips();
    }
  };
}

async function renderSnapshots() {
  const r = await api('/api/snapshots');
  const box = Q('#snapList'); if (!box) return;
  box.innerHTML = (r.snapshots || []).map(s =>
    `<tr><td>${s.name}</td><td>${s.file}</td>
      <td>
        <button class="btn outline" data-restore="${s.file}">Push</button>
        <button class="btn outline" data-del-snap="${s.id}">Delete</button>
      </td></tr>`
  ).join('') || '<tr><td colspan="3" class="muted">No snapshots yet</td></tr>';

  box.onclick = async e => {
    if (e.target.dataset.restore) {
      await api('/api/snapshots/restore', { method:'POST', body: JSON.stringify({ file: e.target.dataset.restore }) });
      alert('System restored');
      location.reload();
    } else if (e.target.dataset.delSnap) {
      await api('/api/snapshots/' + e.target.dataset.delSnap, { method:'DELETE' });
      renderSnapshots();
    }
  };
}

/* ======================= Product page ======================= */
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

  Q('#pdLPRun')?.addEventListener('click', renderProductLifetime);

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
  renderProductArrived();
  renderProductLifetime();
  renderInfluencers();
}

async function renderProductStockAd() {
  const tb = Q('#pdStockBody'); if (!tb) return;
  const bc = businessCountries();
  const per = {}; bc.forEach(c => per[c] = { stock: 0, ad: 0 });

  const s = await api('/api/shipments');
  (s.shipments || []).filter(x=>x.productId===state.product.id && x.arrivedAt).forEach(sp => {
    const to = sp.toCountry || sp.to, from = sp.fromCountry || sp.from, q = (+sp.qty||0);
    if (bc.includes(to)) { per[to] = per[to]||{stock:0,ad:0}; per[to].stock += q; }
    if (bc.includes(from)) { per[from]=per[from]||{stock:0,ad:0}; per[from].stock -= q; }
  });

  const r = await api('/api/remittances');
  (r.remittances || []).filter(x=>x.productId===state.product.id).forEach(rr => {
    if (bc.includes(rr.country)) {
      per[rr.country] = per[rr.country] || { stock:0, ad:0 };
      per[rr.country].stock -= (+rr.pieces||0);
    }
  });

  const a = await api('/api/adspend');
  (a.adSpends || []).filter(x=>x.productId===state.product.id).forEach(ad => {
    if (bc.includes(ad.country)) {
      per[ad.country] = per[ad.country] || { stock:0, ad:0 };
      per[ad.country].ad += (+ad.amount||0);
    }
  });

  let st=0, at=0;
  tb.innerHTML = bc.map(c=>{
    const v = per[c] || { stock:0, ad:0 };
    st+=v.stock; at+=v.ad;
    return `<tr><td>${c}</td><td>${fmt(v.stock)}</td><td>${fmt(v.ad)}</td></tr>`;
  }).join('') || `<tr><td colspan="3" class="muted">No data</td></tr>`;
  Q('#pdStockTotal').textContent = fmt(st);
  Q('#pdAdTotal').textContent = fmt(at);

  const transit = (s.shipments || []).filter(x=>x.productId===state.product.id && !x.arrivedAt)
                   .reduce((t,x)=>t+(+x.qty||0),0);
  Q('#pdTransitBadge').textContent = `Transit total: ${fmt(transit)}`;
}

function renderPBTable() {
  const tb = Q('#pdPBBBody'); if (!tb) return;
  const map = state.product.budgets || {};
  const bc = businessCountries();
  tb.innerHTML = bc.map(c => `
    <tr><td>${c}</td><td>${fmt(map[c] || 0)}</td>
      <td><button class="btn outline" data-clear-b="${c}">Clear</button></td></tr>
  `).join('') || `<tr><td colspan="3" class="muted">No countries</td></tr>`;
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
  const list = (a.adSpends || []).filter(x=>x.productId===state.product.id);
  const tb = Q('#pdAdBody'); if (!tb) return;
  tb.innerHTML = list.map(x => `<tr><td>${x.country}</td><td>${x.platform}</td><td>${fmt(x.amount)}</td></tr>`).join('') ||
    `<tr><td colspan="3" class="muted">No ad spend yet</td></tr>`;
}

async function renderProductTransit() {
  const s = await api('/api/shipments');
  const list = (s.shipments || []).filter(x=>x.productId===state.product.id && !x.arrivedAt);
  const ck = list.filter(sp =>
    (sp.fromCountry||sp.from||'').toLowerCase()==='china' &&
    (sp.toCountry||sp.to||'').toLowerCase()==='kenya'
  );
  const ic = list.filter(sp => !ck.includes(sp));

  const tb1 = Q('#pdShipCKBody'), tb2 = Q('#pdShipICBody');
  const row = sp => {
    const days = sp.arrivedAt ? Math.round((+new Date(sp.arrivedAt) - +new Date(sp.departedAt)) / 86400000) : '';
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
    renderProductTransit(); renderProductArrived();
  });
}

async function renderProductArrived() {
  const s = await api('/api/shipments');
  const list = (s.shipments || []).filter(x=>x.productId===state.product.id && x.arrivedAt);
  const tb = Q('#pdShipArrivedBody'); if (!tb) return;
  const row = sp => {
    const days = Math.round((+new Date(sp.arrivedAt) - +new Date(sp.departedAt)) / 86400000);
    return `<tr>
      <td>${sp.id}</td><td>${(sp.fromCountry||sp.from)} → ${(sp.toCountry||sp.to)}</td>
      <td>${fmt(sp.qty)}</td><td>${fmt(sp.shipCost)}</td>
      <td>${sp.departedAt||''}</td><td>${sp.arrivedAt||''}</td><td>${days}</td>
      <td><button class="btn outline" data-edit-transit="${sp.id}">Edit</button><button class="btn outline" data-del-transit="${sp.id}">Delete</button></td>
    </tr>`;
  };
  tb.innerHTML = list.map(row).join('') || `<tr><td colspan="8" class="muted">No arrived shipments</td></tr>`;

  QA('[data-del-transit]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete shipment?')) return;
    await api('/api/shipments/' + b.dataset.delTransit, { method:'DELETE' });
    renderProductArrived(); renderProductTransit();
  });
  QA('[data-edit-transit]').forEach(b => b.onclick = async () => {
    const id = b.dataset.editTransit;
    const qty = +prompt('New qty?') || 0;
    const shipCost = +prompt('New shipping cost?') || 0;
    await api('/api/shipments/' + id, { method:'PUT', body: JSON.stringify({ qty, shipCost }) });
    renderProductArrived();
  });
}

async function renderProductLifetime() {
  const s = Q('#pdLPStart')?.value, e = Q('#pdLPEnd')?.value;
  const r = await api('/api/remittances');
  const bc = businessCountries();
  const list = (r.remittances || []).filter(x=>x.productId===state.product.id && (!s || x.start >= s) && (!e || x.end <= e) && bc.includes(x.country));
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

/* ======================= Nav & Boot ======================= */
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

gate();
