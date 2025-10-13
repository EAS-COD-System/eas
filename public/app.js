
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
  countries: [],
  products: [],
  categories: { debit: [], credit: [] },
  product: null,
  productId: getQuery('id')
};

const CN = 'china';

const countriesNoChina = () => state.countries.filter(c => c.toLowerCase() !== CN);
const activeProducts = () => (state.products || []).filter(p => p.status !== 'paused');

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

function fillSelect(el, opts, withAll = false, allLabel = 'All') {
  if (!el) return;
  const options = [];
  if (withAll) options.push(`<option value="">${allLabel}</option>`);
  options.push(...opts.map(o => `<option value="${o.value ?? o}">${o.label ?? o}</option>`));
  el.innerHTML = options.join('');
}

function fillGlobalSelects() {
  const nonChina = countriesNoChina();
  const allCountries = state.countries.slice();

  QA('#adCountry').forEach(el => fillSelect(el, nonChina));
  QA('#rCountry').forEach(el => fillSelect(el, nonChina));
  QA('#pfCountry').forEach(el => fillSelect(el, [{ value: '', label: 'All countries' }, ...nonChina.map(c => ({ value: c, label: c }))]));
  QA('#pcCountry').forEach(el => fillSelect(el, [{ value: '', label: 'All countries' }, ...nonChina.map(c => ({ value: c, label: c }))]));
  QA('#delCountrySel').forEach(el => fillSelect(el, nonChina));
  QA('#pdPBCountry').forEach(el => fillSelect(el, nonChina));
  QA('#pdAdCountry').forEach(el => fillSelect(el, nonChina));
  QA('#pdInfCountry').forEach(el => fillSelect(el, nonChina));
  QA('#pdInfFilterCountry').forEach(el => fillSelect(el, [{ value: '', label: 'All countries' }, ...nonChina.map(c => ({ value: c, label: c }))]));
  QA('#lpProduct').forEach(el => fillSelect(el, [{ value: '', label: 'All products' }, ...activeProducts().map(p => ({ value: p.id, label: p.name }))]));

  QA('#adProduct').forEach(el => fillSelect(el, activeProducts().map(p => ({ value: p.id, label: p.name + (p.sku ? ' (' + p.sku + ')' : '') }))));

  QA('#mvFrom').forEach(el => fillSelect(el, allCountries));
  QA('#mvTo').forEach(el => fillSelect(el, allCountries));
  QA('#mvProduct').forEach(el => fillSelect(el, activeProducts().map(p => ({ value: p.id, label: p.name }))));

  QA('#rProduct').forEach(el => fillSelect(el, activeProducts().map(p => ({ value: p.id, label: p.name }))));

  const epSel = Q('#epSelect');
  if (epSel) fillSelect(epSel, activeProducts().map(p => ({ value: p.id, label: `${p.name} ${p.sku ? '(' + p.sku + ')' : ''}` })), true, 'Select product…');
}

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
  Q('#kpiProducts') && (Q('#kpiProducts').textContent = activeProducts().length);
  Q('#kpiCountries') && (Q('#kpiCountries').textContent = countriesNoChina().length);
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
    const week = currentWeekRange(todayISO());
    const r = await api('/api/deliveries');
    const sum = (r.deliveries || []).filter(d => d.date >= week[0] && d.date <= week[6]).reduce((t, d) => t + (+d.delivered || 0), 0);
    Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = fmt(sum));
  } catch { Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = '—'); }
}

async function renderStockAndSpendByCountry() {
  const body = Q('#stockByCountryBody');
  const stockT = Q('#stockTotal');
  const adT = Q('#adTotal');
  if (!body) return;

  const per = {};
  countriesNoChina().forEach(c => per[c] = { stock: 0, ad: 0 });

  try {
    const s = await api('/api/shipments');
    (s.shipments || []).forEach(sp => {
      if (sp.arrivedAt) {
        const to = (sp.toCountry || sp.to);
        const from = (sp.fromCountry || sp.from);
        if (to && to.toLowerCase() !== CN) {
          per[to] = per[to] || { stock: 0, ad: 0 };
          per[to].stock += (+sp.qty || 0);
        }
        if (from && from.toLowerCase() !== CN) {
          per[from] = per[from] || { stock: 0, ad: 0 };
          per[from].stock -= (+sp.qty || 0);
        }
      }
    });
  } catch {}

  try {
    const r = await api('/api/remittances');
    (r.remittances || []).forEach(rr => {
      if (rr.country && rr.country.toLowerCase() !== CN) {
        per[rr.country] = per[rr.country] || { stock: 0, ad: 0 };
        per[rr.country].stock -= (+rr.pieces || 0);
      }
    });
  } catch {}

  try {
    const a = await api('/api/adspend');
    (a.adSpends || []).forEach(x => {
      if (x.country && x.country.toLowerCase() !== CN) {
        per[x.country] = per[x.country] || { stock: 0, ad: 0 };
        per[x.country].ad += (+x.amount || 0);
      }
    });
  } catch {}

  let st = 0, at = 0;
  const rows = Object.entries(per).map(([c, v]) => {
    st += v.stock; at += v.ad;
    return `<tr><td>${c}</td><td>${fmt(v.stock)}</td><td>${fmt(v.ad)}</td></tr>`;
  }).join('');
  body.innerHTML = rows || `<tr><td colspan="3" class="muted">No data</td></tr>`;
  stockT && (stockT.textContent = fmt(st));
  adT && (adT.textContent = fmt(at));
}

function mondayOf(d) {
  const dt = new Date(d);
  const day = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - day);
  return dt;
}
function currentWeekRange(baseISO) {
  const start = mondayOf(baseISO);
  return [...Array(7)].map((_, i) => {
    const dd = new Date(start);
    dd.setDate(start.getDate() + i);
    return dd.toISOString().slice(0, 10);
  });
}

function initWeeklyDelivered() {
  const head = Q('#weeklyHead');
  const body = Q('#weeklyBody');
  const rangeLbl = Q('#weeklyRange');
  const prev = Q('#weeklyPrev');
  const next = Q('#weeklyNext');
  const save = Q('#weeklySave');
  const reset = Q('#weeklyReset');
  if (!head || !body) return;

  let anchor = todayISO();

  const renderGrid = async () => {
    const days = currentWeekRange(anchor);
    head.innerHTML = `<tr><th>Country</th>${days.map(d => `<th>${new Date(d).toLocaleDateString(undefined, { weekday: 'short' })}<br>${d}</th>`).join('')}<th>Total</th></tr>`;
    rangeLbl && (rangeLbl.textContent = `Week: ${days[0]} → ${days[6]}`);

    const r = await api('/api/deliveries');
    const map = {};
    (r.deliveries || []).forEach(x => {
      if (x.date >= days[0] && x.date <= days[6]) {
        map[`${x.country}|${x.date}`] = (+x.delivered || 0);
      }
    });

    const rows = countriesNoChina().map(c => {
      const tds = days.map(d => {
        const v = map[`${c}|${d}`] ?? '';
        return `<td><input class="wd-cell" data-country="${c}" data-date="${d}" type="number" min="0" value="${v}"/></td>`;
      }).join('');
      return `<tr data-row="${c}"><td>${c}</td>${tds}<td class="row-total">0</td></tr>`;
    }).join('');
    body.innerHTML = rows;
    computeWeeklyTotals();
  };

  const computeWeeklyTotals = () => {
    QA('tr[data-row]', body).forEach(tr => {
      const t = QA('.wd-cell', tr).reduce((s, el) => s + (+el.value || 0), 0);
      Q('.row-total', tr).textContent = fmt(t);
    });
    const cols = QA('thead th', Q('#weeklyTable')).length - 2;
    let grand = 0;
    for (let i = 0; i < cols; i++) {
      let sum = 0;
      QA('tr[data-row]', body).forEach(tr => { sum += (+QA('.wd-cell', tr)[i].value || 0); });
      Q(`#w${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i]}T`)?.textContent = fmt(sum);
      grand += sum;
    }
    Q('#wAllT') && (Q('#wAllT').textContent = fmt(grand));
    Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = fmt(grand));
  };

  body.addEventListener('input', e => { if (e.target.classList.contains('wd-cell')) computeWeeklyTotals(); });

  save?.addEventListener('click', async () => {
    const cells = QA('.wd-cell', body);
    const payload = [];
    cells.forEach(inp => {
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

  reset?.addEventListener('click', () => {
    QA('.wd-cell', body).forEach(i => i.value = '');
    const evt = new Event('input'); body.dispatchEvent(evt);
  });

  prev?.addEventListener('click', () => {
    const d = new Date(anchor); d.setDate(d.getDate() - 7); anchor = d.toISOString().slice(0, 10); renderGrid();
  });
  next?.addEventListener('click', () => {
    const d = new Date(anchor); d.setDate(d.getDate() + 7); anchor = d.toISOString().slice(0, 10); renderGrid();
  });

  renderGrid();
}

function initDailyAdSpend() {
  const btn = Q('#adSave');
  if (!btn) return;
  btn.onclick = async () => {
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
  };
}

function initMovements() {
  const btn = Q('#mvAdd');
  if (!btn) return;
  btn.onclick = async () => {
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
    await api('/api/shipments', { method: 'POST', body: JSON.stringify(payload) });
    alert('Shipment created');
    renderTransitTables();
  };
}

function transitRow(sp, nameMap) {
  const name = nameMap[sp.productId] || sp.productId;
  const days = sp.arrivedAt ? Math.max(0, Math.round((+new Date(sp.arrivedAt) - +new Date(sp.departedAt)) / 86400000)) : '';
  return `<tr>
    <td>${sp.id}</td>
    <td>${name}</td>
    <td>${(sp.fromCountry||sp.from)} → ${(sp.toCountry||sp.to)}</td>
    <td>${fmt(sp.qty)}</td>
    <td>${fmt(sp.shipCost)}</td>
    <td>${sp.departedAt||''}</td>
    <td>${sp.arrivedAt||''}</td>
    <td>${days}</td>
    <td>
      <button class="btn outline" data-arr="${sp.id}">Arrived</button>
      <button class="btn outline" data-edit="${sp.id}">Edit</button>
      <button class="btn outline" data-del="${sp.id}">Delete</button>
    </td>
  </tr>`;
}

async function renderTransitTables() {
  const s = await api('/api/shipments');
  const list = (s.shipments || []).filter(x => !x.arrivedAt);
  const nameMap = Object.fromEntries((state.products || []).map(p => [p.id, p.name]));

  const ck = list.filter(sp => (sp.fromCountry || sp.from || '').toLowerCase() === CN && (sp.toCountry || sp.to || '').toLowerCase() === 'kenya');
  const ic = list.filter(sp => !ck.includes(sp));

  const ckBody = Q('#shipCKBody');
  const icBody = Q('#shipICBody');
  ckBody && (ckBody.innerHTML = ck.map(sp => transitRow(sp, nameMap)).join('') || `<tr><td colspan="9" class="muted">No transit</td></tr>`);
  icBody && (icBody.innerHTML = ic.map(sp => transitRow(sp, nameMap)).join('') || `<tr><td colspan="9" class="muted">No transit</td></tr>`);

  const root = document;
  root.onclick = async e => {
    const idArr = e.target?.dataset?.arr;
    const idDel = e.target?.dataset?.del;
    const idEdit = e.target?.dataset?.edit;
    if (idArr) {
      const date = prompt('Arrival date (YYYY-MM-DD)', todayISO()); if (!date) return;
      try { await api('/api/shipments/' + idArr, { method: 'PUT', body: JSON.stringify({ arrivedAt: date }) }); } catch (er) { alert(er.message); }
      renderTransitTables(); renderStockAndSpendByCountry();
    } else if (idDel) {
      if (!confirm('Delete shipment?')) return;
      await api('/api/shipments/' + idDel, { method: 'DELETE' });
      renderTransitTables();
    } else if (idEdit) {
      const qty = +prompt('New qty?') || 0;
      const shipCost = +prompt('New shipping cost?') || 0;
      await api('/api/shipments/' + idEdit, { method: 'PUT', body: JSON.stringify({ qty, shipCost }) });
      renderTransitTables();
    }
  };
}

function initProfitByCountry() {
  const run = Q('#pcRun');
  if (!run) return;
  run.onclick = async () => {
    const s = Q('#pcStart')?.value;
    const e = Q('#pcEnd')?.value;
    const c = Q('#pcCountry')?.value || '';
    const qs = [];
    if (s) qs.push('start=' + s);
    if (e) qs.push('end=' + e);
    if (c) qs.push('country=' + encodeURIComponent(c));
    const r = await api('/api/remittances' + (qs.length ? '?' + qs.join('&') : ''));
    const list = (r.remittances || []).filter(x => x.country && x.country.toLowerCase() !== CN);
    const byC = {};
    list.forEach(x => {
      if (c && x.country !== c) return;
      byC[x.country] = byC[x.country] || { revenue: 0, ad: 0, extra: 0, pieces: 0 };
      byC[x.country].revenue += +x.revenue || 0;
      byC[x.country].ad += +x.adSpend || 0;
      byC[x.country].extra += (+x.extraPerPiece || 0) * (+x.pieces || 0);
      byC[x.country].pieces += +x.pieces || 0;
    });
    let R = 0, A = 0, E = 0, P = 0, PCS = 0;
    const tb = Q('#profitCountryBody');
    tb.innerHTML = Object.entries(byC).map(([cc, v]) => {
      const profit = v.revenue - v.ad - v.extra;
      R += v.revenue; A += v.ad; E += v.extra; PCS += v.pieces; P += profit;
      return `<tr><td>${cc}</td><td>${fmt(v.revenue)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.extra)}</td><td>${fmt(v.pieces)}</td><td>${fmt(profit)}</td></tr>`;
    }).join('') || `<tr><td colspan="6" class="muted">No data</td></tr>`;
    Q('#pcRevT').textContent = fmt(R);
    Q('#pcAdT').textContent = fmt(A);
    Q('#pcDelT').textContent = fmt(E);
    Q('#pcPiecesT').textContent = fmt(PCS);
    Q('#pcProfitT').textContent = fmt(P);
  };
}

function initTodos() {
  const KEY = 'eas_todos';
  const WEEK = 'eas_weekly';
  function load(k) { return JSON.parse(localStorage.getItem(k) || (k === WEEK ? '{}' : '[]')); }
  function save(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

  const listDiv = Q('#todoList');
  const addBtn = Q('#todoAdd');
  const input = Q('#todoText');
  if (listDiv && addBtn) {
    const render = () => {
      const list = load(KEY);
      listDiv.innerHTML = list.map(t => `<div class="flex">
        <span>${t.done ? '✅ ' : ''}${t.text}</span>
        <button class="btn outline" data-tdone="${t.id}">${t.done ? 'Undo' : 'Done'}</button>
        <button class="btn outline" data-tdel="${t.id}">Delete</button>
      </div>`).join('') || '<div class="muted">No tasks</div>';
    };
    render();
    addBtn.onclick = () => {
      const v = input.value.trim(); if (!v) return;
      const list = load(KEY); list.push({ id: crypto.randomUUID(), text: v, done: false }); save(KEY, list); input.value = ''; render();
    };
    listDiv.onclick = e => {
      const idd = e.target?.dataset?.tdel;
      const idt = e.target?.dataset?.tdone;
      if (idd) { const list = load(KEY).filter(x => x.id !== idd); save(KEY, list); render(); }
      if (idt) { const list = load(KEY); const it = list.find(x => x.id === idt); if (it) it.done = !it.done; save(KEY, list); render(); }
    };
  }

  const wrap = Q('#weeklyWrap');
  if (wrap) {
    const data = load(WEEK);
    const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    const renderW = () => {
      wrap.innerHTML = '';
      days.forEach(day => {
        const arr = data[day] || [];
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `<div class="h">${day}</div>
          <div class="row">
            <input id="w_${day}" class="input" placeholder="Task"/><button class="btn" data-wadd="${day}">Add</button>
          </div>
          <div class="list">${arr.map(t=>`
            <div class="flex">
              <span>${t.done ? '✅ ' : ''}${t.text}</span>
              <button class="btn outline" data-wtgl="${day}|${t.id}">${t.done?'Undo':'Done'}</button>
              <button class="btn outline" data-wdel="${day}|${t.id}">Delete</button>
            </div>`).join('')}</div>`;
        wrap.appendChild(card);
      });
    };
    renderW();
    wrap.onclick = e => {
      if (e.target.dataset.wadd) {
        const d = e.target.dataset.wadd;
        const v = Q('#w_' + d).value.trim(); if (!v) return;
        data[d] = data[d] || []; data[d].push({ id: crypto.randomUUID(), text: v, done: false }); save(WEEK, data); renderW();
      }
      if (e.target.dataset.wtgl) {
        const [d, id] = e.target.dataset.wtgl.split('|'); const arr = data[d] || []; const it = arr.find(x => x.id === id); if (it) it.done = !it.done; save(WEEK, data); renderW();
      }
      if (e.target.dataset.wdel) {
        const [d, id] = e.target.dataset.wdel.split('|'); const arr = data[d] || []; data[d] = arr.filter(x => x.id !== id); save(WEEK, data); renderW();
      }
    };
  }
}

function initLifetimeGlobal() {
  const run = Q('#lpRun');
  if (!run) return;
  run.onclick = async () => {
    const s = Q('#lpStart')?.value;
    const e = Q('#lpEnd')?.value;
    const pid = Q('#lpProduct')?.value || '';
    const qs = [];
    if (s) qs.push('start=' + s);
    if (e) qs.push('end=' + e);
    const r = await api('/api/remittances' + (qs.length ? '?' + qs.join('&') : ''));
    const list = (r.remittances || []).filter(x => x.country && x.country.toLowerCase() !== CN).filter(x => !pid || x.productId === pid);
    const prodMap = Object.fromEntries((state.products || []).map(p => [p.id, p]));
    const byPK = {};
    list.forEach(x => {
      const key = `${x.productId}|${x.country}`;
      if (!byPK[key]) byPK[key] = { prod: prodMap[x.productId]?.name || x.productId, country: x.country, rev:0, ad:0, ship:0, base:0, pcs:0, profit:0 };
      const base = ((+prodMap[x.productId]?.cost_china || 0) + (+prodMap[x.productId]?.ship_china_to_kenya || 0)) * (+x.pieces || 0);
      const extra = (+x.extraPerPiece || 0) * (+x.pieces || 0);
      byPK[key].rev += +x.revenue || 0;
      byPK[key].ad += +x.adSpend || 0;
      byPK[key].ship += extra;
      byPK[key].base += base;
      byPK[key].pcs += +x.pieces || 0;
    });
    Object.values(byPK).forEach(v => v.profit = v.rev - v.ad - v.ship - v.base);
    const tb = Q('#lifetimeBody');
    let R=0,A=0,S=0,B=0,P=0,PCS=0;
    tb.innerHTML = Object.values(byPK).map(v => {
      R+=v.rev; A+=v.ad; S+=v.ship; B+=v.base; P+=v.profit; PCS+=v.pcs;
      return `<tr><td>${v.prod}</td><td>${v.country}</td><td>${fmt(v.rev)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.ship)}</td><td>${fmt(v.base)}</td><td>${fmt(v.pcs)}</td><td>${fmt(v.profit)}</td></tr>`;
    }).join('') || `<tr><td colspan="8" class="muted">No data</td></tr>`;
    Q('#ltRevT').textContent = fmt(R);
    Q('#ltAdT').textContent = fmt(A);
    Q('#ltShipT').textContent = fmt(S);
    Q('#ltBaseT').textContent = fmt(B);
    Q('#ltPiecesT').textContent = fmt(PCS);
    Q('#ltProfitT').textContent = fmt(P);
  };
}

function initProducts() {
  const addBtn = Q('#pAdd');
  if (addBtn) {
    addBtn.onclick = async () => {
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
    };
  }
  renderProductsTable();
}

function renderProductsTable() {
  const tb = Q('#productsTable tbody'); if (!tb) return;
  tb.innerHTML = activeProducts().map(p => `
    <tr>
      <td>${p.name}</td>
      <td>${p.sku || '-'}</td>
      <td><span class="badge ${p.status==='paused'?'muted':''}">${p.status || 'active'}</span></td>
      <td>
        <a class="btn" href="/product.html?id=${p.id}">Open</a>
        <button class="btn outline" data-delp="${p.id}">Delete</button>
      </td>
    </tr>
  `).join('') || `<tr><td colspan="4" class="muted">No products</td></tr>`;

  tb.onclick = async e => {
    const del = e.target.dataset.delp;
    if (del) {
      if (!confirm('Delete product and all related data?')) return;
      await api('/api/products/' + del, { method:'DELETE' });
      await preloadProducts(); fillGlobalSelects(); renderProductsTable(); renderKpis(); renderStockAndSpendByCountry();
    }
  };
}

function initPerformance() {
  const runTop = Q('#pfRun');
  if (runTop) {
    runTop.onclick = async () => {
      const quick = Q('#pfQuick')?.value;
      let start = Q('#pfStart')?.value, end = Q('#pfEnd')?.value;
      if (quick && quick !== 'custom') {
        const d = new Date(); d.setDate(d.getDate() - (+quick)); start = d.toISOString().slice(0,10); end = todayISO();
      }
      const c = Q('#pfCountry')?.value || '';
      const qs = [];
      if (start) qs.push('start='+start);
      if (end) qs.push('end='+end);
      if (c) qs.push('country='+encodeURIComponent(c));
      const r = await api('/api/remittances' + (qs.length?('?'+qs.join('&')):''));
      const list = (r.remittances || []).filter(x => x.country && x.country.toLowerCase() !== CN);
      const byP = {};
      const prodMap = Object.fromEntries(state.products.map(p=>[p.id,p]));
      list.forEach(x => {
        const key = x.productId + '|' + x.country;
        if (!byP[key]) byP[key] = { name: (prodMap[x.productId]?.name || x.productId), country: x.country, pieces:0, ad:0, prodCost:0, profit:0 };
        byP[key].pieces += (+x.pieces||0);
        byP[key].ad += (+x.adSpend||0);
        const base = ((+prodMap[x.productId]?.cost_china||0) + (+prodMap[x.productId]?.ship_china_to_kenya||0)) * (+x.pieces||0);
        const extra = (+x.extraPerPiece||0) * (+x.pieces||0);
        const profit = (+x.revenue||0) - (+x.adSpend||0) - base - extra;
        byP[key].prodCost += base;
        byP[key].profit += profit;
      });
      const tb = Q('#pfTable tbody');
      tb.innerHTML = Object.values(byP).sort((a,b)=>b.pieces-a.pieces).map(it =>
        `<tr><td>${it.name}</td><td>${it.country}</td><td>${fmt(it.pieces)}</td><td>${fmt(it.ad)}</td><td>${fmt(it.prodCost)}</td><td>${fmt(it.profit)}</td><td>${it.pieces?fmt(it.profit/it.pieces):'0'}</td></tr>`
      ).join('') || `<tr><td colspan="7" class="muted">No data</td></tr>`;
    };
  }

  const rAdd = Q('#rAdd');
  if (rAdd) {
    rAdd.onclick = async () => {
      const payload = {
        start: Q('#rStart').value, end: Q('#rEnd').value,
        country: Q('#rCountry').value, productId: Q('#rProduct').value,
        orders: +Q('#rOrders').value || 0, pieces: +Q('#rPieces').value || 0,
        revenue: +Q('#rRev').value || 0, adSpend: +Q('#rAds').value || 0,
        extraPerPiece: +Q('#rExtra').value || 0
      };
      if (!payload.start || !payload.end || !payload.country || !payload.productId) return alert('Missing fields');
      await api('/api/remittances', { method:'POST', body: JSON.stringify(payload) });
      Q('#rMsg') && (Q('#rMsg').textContent = 'Saved.');
    };
  }
}

async function initFinance() {
  await loadFinanceCats();
  const addCat = Q('#fcAdd');
  if (addCat) {
    addCat.onclick = async () => {
      const type = Q('#fcType').value, name = Q('#fcName').value.trim();
      if (!name) return;
      await api('/api/finance/categories', { method:'POST', body: JSON.stringify({ type, name }) });
      Q('#fcName').value = '';
      await loadFinanceCats();
    };
  }
  const addEntry = Q('#feAdd');
  if (addEntry) {
    addEntry.onclick = async () => {
      const date = Q('#feDate').value, category = Q('#feCat').value, amount = +Q('#feAmt').value || 0, note = Q('#feNote').value;
      if (!date || !category) return alert('Pick date & category');
      const type = state.categories.credit.includes(category) ? 'credit' : 'debit';
      await api('/api/finance/entries', { method:'POST', body: JSON.stringify({ date, type, category, amount, note }) });
      Q('#feNote').value=''; Q('#feAmt').value='';
      renderFinancePeriod();
    };
  }
  Q('#feRun')?.addEventListener('click', renderFinancePeriod);
  renderFinancePeriod();
}

async function loadFinanceCats() {
  try {
    const cats = await api('/api/finance/categories');
    state.categories = cats;
    const debDiv = Q('#fcDebits');
    const creDiv = Q('#fcCredits');
    if (debDiv) debDiv.innerHTML = (cats.debit || []).map(c => `<span class="chip">${c}<button class="x" data-delcat="debit|${c}">×</button></span>`).join('') || '—';
    if (creDiv) creDiv.innerHTML = (cats.credit || []).map(c => `<span class="chip">${c}<button class="x" data-delcat="credit|${c}">×</button></span>`).join('') || '—';
    const all = [...cats.debit, ...cats.credit].sort();
    Q('#feCat') && (Q('#feCat').innerHTML = `<option value="" disabled selected>Select category</option>` + all.map(c=>`<option>${c}</option>`).join(''));
    const catsWrap = Q('.cats');
    catsWrap && (catsWrap.onclick = async e => {
      const val = e.target?.dataset?.delcat;
      if (!val) return;
      const [type,name] = val.split('|');
      await api('/api/finance/categories?type='+encodeURIComponent(type)+'&name='+encodeURIComponent(name), { method: 'DELETE' });
      await loadFinanceCats();
    });
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
    if (tb) {
      tb.innerHTML = entries.map(x =>
        `<tr><td>${x.date}</td><td>${x.type}</td><td>${x.category}</td><td>${fmt(x.amount)}</td><td>${x.note||''}</td>
         <td><button class="btn outline" data-del-entry="${x.id}">Delete</button></td></tr>`
      ).join('') || `<tr><td colspan="6" class="muted">No entries</td></tr>`;
      tb.onclick = async e => {
        const id = e.target?.dataset?.delEntry; if (!id) return;
        await api('/api/finance/entries/' + id, { method:'DELETE' });
        renderFinancePeriod();
      };
    }
  } catch (e) { alert(e.message); }
}

function initSettings() {
  const addC = Q('#ctyAdd');
  const list = Q('#ctyList');
  if (addC && list) {
    addC.onclick = async () => {
      const name = Q('#cty').value.trim(); if (!name) return;
      await api('/api/countries', { method:'POST', body: JSON.stringify({ name }) });
      const m = await api('/api/meta'); state.countries = m.countries || [];
      fillGlobalSelects(); renderCountryChips();
      Q('#cty').value = '';
    };
    renderCountryChips();
    list.onclick = async e => {
      const n = e.target?.dataset?.delCountry; if (!n) return;
      if (n.toLowerCase() === CN) return alert('China cannot be deleted');
      await api('/api/countries/' + encodeURIComponent(n), { method:'DELETE' });
      const m = await api('/api/meta'); state.countries = m.countries || [];
      fillGlobalSelects(); renderCountryChips();
    };
  }

  const sel = Q('#epSelect');
  if (sel) {
    sel.onchange = () => {
      const p = state.products.find(x=>x.id===sel.value); if (!p) return;
      Q('#epName').value = p.name || '';
      Q('#epSku').value = p.sku || '';
      Q('#epCost').value = p.cost_china || 0;
      Q('#epShip').value = p.ship_china_to_kenya || 0;
      Q('#epMB').value = p.margin_budget || 0;
    };
    Q('#epSave')?.addEventListener('click', async () => {
      const id = sel.value; if (!id) return alert('Select product');
      const payload = {
        name: Q('#epName').value.trim(),
        sku: Q('#epSku').value.trim(),
        cost_china: +Q('#epCost').value || 0,
        ship_china_to_kenya: +Q('#epShip').value || 0,
        margin_budget: +Q('#epMB').value || 0
      };
      await api('/api/products/' + id, { method:'PUT', body: JSON.stringify(payload) });
      await preloadProducts(); fillGlobalSelects();
      alert('Saved');
    });
  }

  const saveBtn = Q('#snapSave');
  const snapName = Q('#snapName');
  const snapList = Q('#snapList');
  if (saveBtn && snapList) {
    saveBtn.onclick = async () => {
      const name = (snapName.value || '').trim() || '';
      const r = await api('/api/snapshots', { method:'POST', body: JSON.stringify({ name }) });
      snapName.value = '';
      await renderSnapshots();
    };
    renderSnapshots();
    snapList.onclick = async e => {
      const push = e.target?.dataset?.pushSnap;
      const del = e.target?.dataset?.delSnap;
      if (push) {
        await api('/api/snapshots/restore', { method:'POST', body: JSON.stringify({ file: push }) });
        alert('System restored'); location.reload();
      } else if (del) {
        await api('/api/snapshots/' + del, { method:'DELETE' });
        await renderSnapshots();
      }
    };
  }
}

async function renderSnapshots() {
  const r = await api('/api/snapshots');
  const box = Q('#snapList'); if (!box) return;
  box.innerHTML = (r.snapshots || []).map(s =>
    `<tr><td>${s.name}</td><td>${s.file.split('/').pop()}</td>
     <td><button class="btn outline" data-push-snap="${s.file}">Push</button>
         <button class="btn outline" data-del-snap="${s.id}">Delete</button></td></tr>`
  ).join('') || `<tr><td colspan="3" class="muted">No snapshots yet</td></tr>`;
}

async function loadProduct(id) {
  await preloadProducts();
  state.product = state.products.find(p => p.id === id) || null;
}

function renderProductPage() {
  if (!state.product) { alert('Product not found'); location.href='/'; return; }
  Q('#pdTitle') && (Q('#pdTitle').textContent = state.product.name);
  Q('#pdSku') && (Q('#pdSku').textContent = state.product.sku ? `SKU: ${state.product.sku}` : '');
  fillGlobalSelects();
  bindProductHandlers();
  refreshProductSections();
}

function bindProductHandlers() {
  const pbSave = Q('#pdPBSave');
  if (pbSave) {
    pbSave.onclick = async () => {
      const c = Q('#pdPBCountry').value; const v = +Q('#pdPBValue').value || 0;
      const upd = { budgets: state.product.budgets || {} }; upd.budgets[c] = v;
      await api('/api/products/' + state.product.id, { method:'PUT', body: JSON.stringify(upd) });
      await loadProduct(state.product.id); renderPBTable();
    };
  }

  const adSave = Q('#pdAdSave');
  if (adSave) {
    adSave.onclick = async () => {
      const payload = {
        productId: state.product.id,
        country: Q('#pdAdCountry').value,
        platform: Q('#pdAdPlatform').value,
        amount: +Q('#pdAdAmount').value || 0
      };
      await api('/api/adspend', { method:'POST', body: JSON.stringify(payload) });
      refreshProductSections();
    };
  }

  const mvAdd = Q('#pdMvAdd');
  if (mvAdd) {
    mvAdd.onclick = async () => {
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
    };
  }

  Q('#pdLPRun')?.addEventListener('click', () => renderProductLifetime());

  const infAdd = Q('#pdInfAdd');
  if (infAdd) {
    infAdd.onclick = async () => {
      const payload = { name: Q('#pdInfName').value.trim(), social: Q('#pdInfSocial').value.trim(), country: Q('#pdInfCountry').value };
      if (!payload.name) return alert('Name required');
      await api('/api/influencers', { method:'POST', body: JSON.stringify(payload) });
      Q('#pdInfName').value=''; Q('#pdInfSocial').value='';
      renderInfluencers();
    };
  }
  const infSpend = Q('#pdInfSpendAdd');
  if (infSpend) {
    infSpend.onclick = async () => {
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
    };
  }
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

  const per = {}; countriesNoChina().forEach(c => per[c] = { stock: 0, ad: 0 });

  const s = await api('/api/shipments');
  (s.shipments || []).filter(x => x.productId === state.product.id && x.arrivedAt).forEach(sp => {
    const to = sp.toCountry || sp.to, from = sp.fromCountry || sp.from, q = (+sp.qty||0);
    if (to && to.toLowerCase() !== CN) { per[to] = per[to]||{stock:0,ad:0}; per[to].stock += q; }
    if (from && from.toLowerCase() !== CN) { per[from]=per[from]||{stock:0,ad:0}; per[from].stock -= q; }
  });

  const r = await api('/api/remittances');
  (r.remittances || []).filter(x => x.productId === state.product.id && x.country && x.country.toLowerCase() !== CN).forEach(rr => {
    per[rr.country] = per[rr.country] || { stock:0, ad:0 };
    per[rr.country].stock -= (+rr.pieces||0);
  });

  const a = await api('/api/adspend');
  (a.adSpends || []).filter(x => x.productId === state.product.id && x.country && x.country.toLowerCase() !== CN).forEach(ad => {
    per[ad.country] = per[ad.country] || { stock:0, ad:0 };
    per[ad.country].ad += (+ad.amount||0);
  });

  let st=0, at=0;
  tb.innerHTML = Object.entries(per).map(([c,v])=>{
    st+=v.stock; at+=v.ad;
    return `<tr><td>${c}</td><td>${fmt(v.stock)}</td><td>${fmt(v.ad)}</td></tr>`;
  }).join('') || `<tr><td colspan="3" class="muted">No data</td></tr>`;
  Q('#pdStockTotal') && (Q('#pdStockTotal').textContent = fmt(st));
  Q('#pdAdTotal') && (Q('#pdAdTotal').textContent = fmt(at));
}

function renderPBTable() {
  const tb = Q('#pdPBBBody'); if (!tb) return;
  const map = state.product.budgets || {};
  const rows = countriesNoChina().map(c => `
    <tr>
      <td>${c}</td>
      <td><input type="number" min="0" step="0.01" class="input pb-input" data-pb="${c}" value="${map[c] ?? ''}"/></td>
    </tr>
  `).join('');
  tb.innerHTML = rows || `<tr><td colspan="2" class="muted">No countries</td></tr>`;
  const saveBtn = Q('#pdPBSaveAll');
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const upd = { budgets: { ...(state.product.budgets || {}) } };
      QA('.pb-input').forEach(inp => { const v = inp.value; const c = inp.dataset.pb; if (v === '' || v == null) delete upd.budgets[c]; else upd.budgets[c] = +v; });
      await api('/api/products/' + state.product.id, { method:'PUT', body: JSON.stringify(upd) });
      await loadProduct(state.product.id); renderPBTable();
      alert('Saved');
    };
  }
}

async function renderProductAdList() {
  const a = await api('/api/adspend');
  const list = (a.adSpends || []).filter(x => x.productId === state.product.id && x.country && x.country.toLowerCase() !== CN);
  const tb = Q('#pdAdBody'); if (!tb) return;
  tb.innerHTML = list.map(x => `<tr><td>${x.country}</td><td>${x.platform}</td><td>${fmt(x.amount)}</td></tr>`).join('') || `<tr><td colspan="3" class="muted">No ad spend</td></tr>`;
}

async function renderProductTransit() {
  const s = await api('/api/shipments');
  const list = (s.shipments || []).filter(x => x.productId === state.product.id && !x.arrivedAt);
  const ck = list.filter(sp => (sp.fromCountry||sp.from||'').toLowerCase()===CN && (sp.toCountry||sp.to||'').toLowerCase()==='kenya');
  const ic = list.filter(sp => !ck.includes(sp));

  const tb1 = Q('#pdShipCKBody'), tb2 = Q('#pdShipICBody');
  const row = sp => {
    const days = sp.arrivedAt ? Math.round((+new Date(sp.arrivedAt) - +new Date(sp.departedAt)) / 86400000) : '';
    return `<tr>
      <td>${sp.id}</td><td>${(sp.fromCountry||sp.from)} → ${(sp.toCountry||sp.to)}</td>
      <td>${fmt(sp.qty)}</td><td>${fmt(sp.shipCost)}</td>
      <td>${sp.departedAt||''}</td><td>${sp.arrivedAt||''}</td><td>${days}</td>
      <td>
        <button class="btn outline" data-arr="${sp.id}">Arrived</button>
        <button class="btn outline" data-edit="${sp.id}">Edit</button>
        <button class="btn outline" data-del="${sp.id}">Delete</button>
      </td>
    </tr>`;
  };
  tb1 && (tb1.innerHTML = ck.map(row).join('') || `<tr><td colspan="8" class="muted">No shipments</td></tr>`);
  tb2 && (tb2.innerHTML = ic.map(row).join('') || `<tr><td colspan="8" class="muted">No shipments</td></tr>`);
}

async function renderProductArrived() {
  const tb = Q('#pdShipArrBody'); if (!tb) return;
  const s = await api('/api/shipments');
  const list = (s.shipments || []).filter(x => x.productId === state.product.id && x.arrivedAt);
  const rows = list.map(sp => {
    const days = Math.max(0, Math.round((+new Date(sp.arrivedAt) - +new Date(sp.departedAt)) / 86400000));
    return `<tr>
      <td>${sp.id}</td><td>${(sp.fromCountry||sp.from)} → ${(sp.toCountry||sp.to)}</td>
      <td>${fmt(sp.qty)}</td><td>${fmt(sp.shipCost)}</td>
      <td>${sp.departedAt||''}</td><td>${sp.arrivedAt||''}</td><td>${days}</td>
    </tr>`;
  }).join('');
  tb.innerHTML = rows || `<tr><td colspan="7" class="muted">No arrived shipments</td></tr>`;
}

async function renderProductLifetime() {
  const s = Q('#pdLPStart')?.value, e = Q('#pdLPEnd')?.value;
  const qs = [];
  if (s) qs.push('start=' + s);
  if (e) qs.push('end=' + e);
  const r = await api('/api/remittances' + (qs.length?('?'+qs.join('&')):''));
  const list = (r.remittances || []).filter(x => x.productId === state.product.id && x.country && x.country.toLowerCase() !== CN);

  const prod = state.product;
  const baseCost = (+prod.cost_china||0) + (+prod.ship_china_to_kenya||0);

  const byCountry = {};
  list.forEach(x => {
    const k = x.country;
    if (!byCountry[k]) byCountry[k] = { rev:0, ad:0, ship:0, base:0, pcs:0, profit:0 };
    const pcs = +x.pieces || 0;
    const extra = (+x.extraPerPiece||0) * pcs;
    byCountry[k].rev += +x.revenue || 0;
    byCountry[k].ad += +x.adSpend || 0;
    byCountry[k].ship += extra;
    byCountry[k].base += baseCost * pcs;
    byCountry[k].pcs += pcs;
  });
  Object.values(byCountry).forEach(v => v.profit = v.rev - v.ad - v.ship - v.base);

  const tb = Q('#pdLPBody'); if (!tb) return;
  let R=0,A=0,S=0,B=0,P=0,PCS=0;
  tb.innerHTML = Object.entries(byCountry).map(([c,v])=>{
    R+=v.rev; A+=v.ad; S+=v.ship; B+=v.base; P+=v.profit; PCS+=v.pcs;
    return `<tr><td>${c}</td><td>${fmt(v.rev)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.ship)}</td><td>${fmt(v.base)}</td><td>${fmt(v.pcs)}</td><td>${fmt(v.profit)}</td></tr>`;
  }).join('') || `<tr><td colspan="7" class="muted">No data</td></tr>`;
  Q('#pdLPRevT').textContent = fmt(R);
  Q('#pdLPAdT').textContent = fmt(A);
  Q('#pdLPShipT').textContent = fmt(S);
  Q('#pdLPBaseT').textContent = fmt(B);
  Q('#pdLPPcsT').textContent = fmt(PCS);
  Q('#pdLPProfitT').textContent = fmt(P);
}

async function renderInfluencers() {
  const infs = await api('/api/influencers');
  const spends = await api('/api/influencers/spend');
  const sel = Q('#pdInfSelect'); if (sel) fillSelect(sel, (infs.influencers||[]).map(i=>({ value:i.id, label:i.name })));
  const s = Q('#pdInfStart')?.value, e = Q('#pdInfEnd')?.value, c = Q('#pdInfFilterCountry')?.value || '';
  const list = (spends.spends || []).filter(x => x.productId === state.product.id).filter(x => (!c || x.country === c)).filter(x => (!s || x.date >= s) && (!e || x.date <= e));
  const byId = Object.fromEntries((infs.influencers||[]).map(i=>[i.id,i]));
  const tb = Q('#pdInfBody'); if (!tb) return;
  let total = 0;
  tb.innerHTML = list.map(x=>{
    total += (+x.amount||0);
    const i = byId[x.influencerId] || {};
    return `<tr><td>${x.date}</td><td>${x.country}</td><td>${i.name||'-'}</td><td>${i.social||'-'}</td><td>${fmt(x.amount)}</td>
      <td><button class="btn outline" data-del-infsp="${x.id}">Delete</button></td></tr>`;
  }).join('') || `<tr><td colspan="6" class="muted">No spends</td></tr>`;
  Q('#pdInfTotal') && (Q('#pdInfTotal').textContent = fmt(total));
  tb.onclick = async e => {
    const id = e.target?.dataset?.delInfsp; if (!id) return;
    await api('/api/influencers/spend/' + id, { method:'DELETE' });
    renderInfluencers();
  };
}

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
