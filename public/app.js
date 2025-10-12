/* =========================
   EAS Tracker – Front-end
   (Dashboard + Product page)
   ========================= */

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
  countriesNoChina: [],
  products: [],
  categories: { debit: [], credit: [] },
  product: null,
  productId: getQuery('id')
};

/* ------------------ boot & auth ------------------ */
async function gate() {
  try {
    const meta = await api('/api/meta');
    state.countries = meta.countries || [];
    state.countriesNoChina = state.countries.filter(c => c.toLowerCase() !== 'china');

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

/* ------------------ common data ------------------ */
async function preloadProducts() {
  try {
    const r = await api('/api/products');
    state.products = r.products || [];
  } catch { state.products = []; }
}

function fillGlobalSelects() {
  // Countries (NO CHINA) for all general features
  const noChinaSelectors = [
    '#delCountrySel', '#adCountry', '#rCountry', '#pfCountry', '#pcCountry',
    '#feCountry', '#lpCountry', '#pdRCountry', '#pdAdCountry', '#pdPBCountry',
    '#pdInfCountry', '#pdInfFilterCountry'
  ];
  noChinaSelectors.forEach(sel => {
    QA(sel).forEach(el => {
      if (!el) return;
      el.innerHTML = `<option value="">${el.dataset.all || 'All countries'}</option>` +
        state.countriesNoChina.map(c => `<option value="${c}">${c}</option>`).join('');
    });
  });

  // Countries WITH CHINA only for stock movements / transit
  const shipSelectors = ['#mvFrom', '#mvTo', '#pdMvFrom', '#pdMvTo'];
  shipSelectors.forEach(sel => {
    QA(sel).forEach(el => {
      el.innerHTML = state.countries.map(c => `<option value="${c}">${c}</option>`).join('');
    });
  });

  // Products everywhere
  const productSelectors = ['#adProduct', '#rProduct', '#lpProduct', '#mvProduct'];
  productSelectors.forEach(sel => {
    QA(sel).forEach(el => {
      el.innerHTML = `<option value="">All products</option>` +
        state.products.map(p => `<option value="${p.id}">${p.name}${p.sku ? ' (' + p.sku + ')' : ''}</option>`).join('');
    });
  });
}

/* ================================================================
   DASHBOARD
   ================================================================ */
function initDashboard() {
  renderKpis();
  renderStockAndSpendByCountry();
  initWeeklyDelivered();
  initDailyAdSpend();
  initMovements();
  renderTransitTables();
  initProfitByCountry();
}

/* ---- KPIs ---- */
async function renderKpis() {
  Q('#kpiProducts') && (Q('#kpiProducts').textContent = state.products.length);
  Q('#kpiCountries') && (Q('#kpiCountries').textContent = state.countriesNoChina.length);

  // transit count
  try {
    const s = await api('/api/shipments');
    const live = (s.shipments || []).filter(x => !x.arrivedAt).length;
    Q('#kpiTransit') && (Q('#kpiTransit').textContent = live);
  } catch { Q('#kpiTransit') && (Q('#kpiTransit').textContent = '—'); }

  // delivered this week KPI = sum of the weekly grid totals
  try {
    const r = await api('/api/deliveries');
    const days = weekRangeFrom(todayISO());
    const set = new Set(days);
    const total = (r.deliveries || [])
      .filter(x => set.has(x.date) && state.countriesNoChina.includes(x.country))
      .reduce((t, x) => t + (+x.delivered || 0), 0);
    Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = fmt(total));
  } catch { Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = '—'); }

  // total ad spend (from /api/adspend) across non-China countries
  try {
    const a = await api('/api/adspend');
    const total = (a.adSpends || [])
      .filter(x => state.countriesNoChina.includes(x.country))
      .reduce((t, x) => t + (+x.amount || 0), 0);
    Q('#kpiAdSpend') && (Q('#kpiAdSpend').textContent = fmt(total) + ' USD');
  } catch { Q('#kpiAdSpend') && (Q('#kpiAdSpend').textContent = '—'); }
}

/* ---- Total Stock & Ad Spend by Country (exclude China) ---- */
async function renderStockAndSpendByCountry() {
  const body = Q('#stockByCountryBody');
  const stockTotal = Q('#stockTotal');
  const adTotal = Q('#adTotal');
  if (!body) return;

  const per = {};
  state.countriesNoChina.forEach(c => per[c] = { stock: 0, ad: 0 });

  // arrived shipments add to destination, subtract from origin
  try {
    const s = await api('/api/shipments');
    (s.shipments || []).forEach(sp => {
      if (!sp.arrivedAt) return;
      const to = sp.toCountry || sp.to;
      const from = sp.fromCountry || sp.from;
      const q = +sp.qty || 0;

      if (state.countriesNoChina.includes(to)) {
        per[to] = per[to] || { stock: 0, ad: 0 };
        per[to].stock += q;
      }
      if (state.countriesNoChina.includes(from)) {
        per[from] = per[from] || { stock: 0, ad: 0 };
        per[from].stock -= q;
      }
    });
  } catch {}

  // remittances subtract pieces in that country
  try {
    const r = await api('/api/remittances');
    (r.remittances || []).forEach(rr => {
      if (!state.countriesNoChina.includes(rr.country)) return;
      per[rr.country] = per[rr.country] || { stock: 0, ad: 0 };
      per[rr.country].stock -= (+rr.pieces || 0);
    });
  } catch {}

  // ad spend from daily adspend (replace model is handled server-side)
  try {
    const a = await api('/api/adspend');
    (a.adSpends || []).forEach(x => {
      if (!state.countriesNoChina.includes(x.country)) return;
      per[x.country] = per[x.country] || { stock: 0, ad: 0 };
      per[x.country].ad += (+x.amount || 0);
    });
  } catch {}

  let st = 0, at = 0;
  body.innerHTML = Object.entries(per).map(([c, v]) => {
    st += v.stock; at += v.ad;
    return `<tr><td>${c}</td><td>${fmt(v.stock)}</td><td>${fmt(v.ad)}</td></tr>`;
  }).join('') || `<tr><td colspan="3" class="muted">No data</td></tr>`;

  stockTotal && (stockTotal.textContent = fmt(st));
  adTotal && (adTotal.textContent = fmt(at));
}

/* ---- Weekly Delivered (Mon–Sun) – exclude China everywhere ---- */
function weekRangeFrom(date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return [...Array(7)].map((_, i) => {
    const dd = new Date(d); dd.setDate(d.getDate() + i);
    return dd.toISOString().slice(0, 10);
  });
}

async function initWeeklyDelivered() {
  const head = Q('#weeklyHead'), body = Q('#weeklyBody');
  if (!head || !body) return;

  const days = weekRangeFrom(todayISO());
  head.innerHTML = `<tr><th>Country</th>${days.map(d=>`<th>${new Date(d).toLocaleDateString(undefined,{weekday:'short'})}<br>${d}</th>`).join('')}<th>Total</th></tr>`;

  body.innerHTML = state.countriesNoChina.map(c => {
    const cells = days.map(d => `<td><input class="wd" data-country="${c}" data-date="${d}" type="number" min="0" placeholder="0"/></td>`).join('');
    return `<tr data-row="${c}"><td>${c}</td>${cells}<td class="rowt">0</td></tr>`;
  }).join('');

  // preload
  try {
    const r = await api('/api/deliveries');
    const m = {};
    (r.deliveries || []).forEach(x => m[`${x.country}|${x.date}`] = +x.delivered || 0);
    QA('.wd').forEach(i => {
      const k = `${i.dataset.country}|${i.dataset.date}`;
      if (m[k] != null) i.value = m[k];
    });
    computeWeeklyTotals();
  } catch {}

  Q('#weeklySave')?.addEventListener('click', async () => {
    try {
      const inputs = QA('.wd');
      for (const i of inputs) {
        const v = +i.value || 0;
        if (v > 0) {
          await api('/api/deliveries', { method: 'POST', body: JSON.stringify({
            date: i.dataset.date, country: i.dataset.country, delivered: v
          })});
        }
      }
      alert('Saved!');
      renderKpis();
      computeWeeklyTotals();
    } catch (e) { alert(e.message); }
  });

  Q('#weeklyReset')?.addEventListener('click', () => {
    QA('.wd').forEach(i => i.value = '');
    computeWeeklyTotals();
  });

  body.addEventListener('input', e => { if (e.target.classList.contains('wd')) computeWeeklyTotals(); });
}

function computeWeeklyTotals() {
  QA('tr[data-row]').forEach(tr => {
    const t = QA('.wd', tr).reduce((s, el) => s + (+el.value || 0), 0);
    Q('.rowt', tr).textContent = fmt(t);
  });
  const cols = QA('thead th', Q('#weeklyTable')).length - 2;
  let grand = 0;
  for (let i = 0; i < cols; i++) {
    let sum = 0;
    QA('tr[data-row]').forEach(tr => { sum += (+QA('.wd', tr)[i].value || 0); });
    QA('tfoot .totals th')[i+1].textContent = fmt(sum);
    grand += sum;
  }
  Q('#wAllT').textContent = fmt(grand);
}

/* ---- Daily Ad Spend (replace) – exclude China ---- */
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
      renderStockAndSpendByCountry();
      renderKpis();
      alert('Saved');
    } catch (e) { alert(e.message); }
  });
}

/* ---- Stock Movements / Transit ---- */
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
  const prod = Object.fromEntries((state.products || []).map(p => [p.id, p.name]));

  const row = sp => {
    const days = sp.arrivedAt ? Math.round((+new Date(sp.arrivedAt) - +new Date(sp.departedAt)) / 86400000) : '';
    return `<tr>
      <td>${sp.id}</td>
      <td>${prod[sp.productId] || sp.productId}</td>
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

  // actions (PUT/DELETE fix)
  Q('#shipCK')?.addEventListener('click', transitAction, { once: true });
  Q('#shipIC')?.addEventListener('click', transitAction, { once: true });
}
async function transitAction(e) {
  const id = e.target.dataset.arr || e.target.dataset.del || e.target.dataset.edit;
  if (!id) return;
  if (e.target.dataset.arr) {
    const date = prompt('Arrival date (YYYY-MM-DD)', todayISO());
    if (!date) return;
    await api('/api/shipments/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({ arrivedAt: date }) });
    renderTransitTables(); renderStockAndSpendByCountry();
  } else if (e.target.dataset.edit) {
    const qty = +prompt('New qty?') || 0;
    const shipCost = +prompt('New shipping cost?') || 0;
    await api('/api/shipments/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({ qty, shipCost }) });
    renderTransitTables();
  } else if (e.target.dataset.del) {
    if (!confirm('Delete shipment?')) return;
    await api('/api/shipments/' + encodeURIComponent(id), { method: 'DELETE' });
    renderTransitTables();
  }
}

/* ---- Profit by Country (DATE FILTER FIXED) ---- */
function initProfitByCountry() {
  Q('#pcRun')?.addEventListener('click', async () => {
    const s = Q('#pcStart')?.value, e = Q('#pcEnd')?.value, c = Q('#pcCountry')?.value || '';
    const qs = [];
    if (s) qs.push('start=' + s);
    if (e) qs.push('end=' + e);
    if (c) qs.push('country=' + encodeURIComponent(c));
    const r = await api('/api/remittances' + (qs.length ? '?' + qs.join('&') : ''));

    const by = {};
    (r.remittances || []).forEach(x => {
      if (!state.countriesNoChina.includes(x.country)) return;
      by[x.country] = by[x.country] || { revenue: 0, ad: 0, extra: 0, pieces: 0 };
      by[x.country].revenue += +x.revenue || 0;
      by[x.country].ad += +x.adSpend || 0;
      by[x.country].extra += (+x.extraPerPiece || 0) * (+x.pieces || 0);
      by[x.country].pieces += +x.pieces || 0;
    });

    const tb = Q('#profitCountryBody'); let RT=0,AT=0,ET=0,PT=0;
    tb.innerHTML = Object.entries(by).map(([cc, v]) => {
      const profit = v.revenue - v.ad - v.extra;
      RT+=v.revenue; AT+=v.ad; ET+=v.extra; PT+=profit;
      return `<tr><td>${cc}</td><td>${fmt(v.revenue)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.extra)}</td><td>${fmt(v.pieces)}</td><td>${fmt(profit)}</td></tr>`;
    }).join('') || `<tr><td colspan="6" class="muted">No data</td></tr>`;
    Q('#pcRevT').textContent = fmt(RT);
    Q('#pcAdT').textContent = fmt(AT);
    Q('#pcDelT').textContent = fmt(ET);
    Q('#pcPiecesT').textContent = fmt(Object.values(by).reduce((s,v)=>s+v.pieces,0));
    Q('#pcProfitT').textContent = fmt(PT);
  });
}

/* ================================================================
   PRODUCTS LIST
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
        <button class="btn outline" data-del="${p.id}">Delete</button>
      </td>
    </tr>
  `).join('') || `<tr><td colspan="4" class="muted">No products</td></tr>`;

  tb.onclick = async e => {
    const del = e.target.dataset.del;
    if (del && confirm('Delete this product and ALL its data?')) {
      await api('/api/products/' + encodeURIComponent(del), { method:'DELETE' });
      await preloadProducts(); renderProductsTable();
      renderStockAndSpendByCountry(); renderKpis();
    }
  };
}

/* ================================================================
   PERFORMANCE
   ================================================================ */
function initPerformance() {
  // Top delivered already covered by Profit by Country + Remittance section
  // Remittance report create
  Q('#rAdd')?.addEventListener('click', async () => {
    const payload = {
      start: Q('#rStart').value, end: Q('#rEnd').value,
      country: Q('#rCountry').value, productId: Q('#rProduct').value,
      orders: +Q('#rOrders').value || 0, pieces: +Q('#rPieces').value || 0,
      revenue: +Q('#rRev').value || 0, adSpend: +Q('#rAds').value || 0,
      extraPerPiece: +Q('#rExtra').value || 0
    };
    if (!payload.start || !payload.end) return alert('Select dates');
    if (!payload.country || payload.country.toLowerCase()==='china') return alert('Select a non-China country');
    await api('/api/remittances', { method:'POST', body: JSON.stringify(payload) });
    alert('Remittance saved');
  });

  // Lifetime product performance (GLOBAL) – FIX
  Q('#lpRun')?.addEventListener('click', async () => {
    const pid = Q('#lpProduct')?.value || '';
    const s = Q('#lpStart')?.value, e = Q('#lpEnd')?.value;

    const qs = [];
    if (s) qs.push('start='+s);
    if (e) qs.push('end='+e);
    const r = await api('/api/remittances' + (qs.length?('?'+qs.join('&')):''));
    const list = (r.remittances || []).filter(x => !pid || x.productId === pid);

    const pmap = Object.fromEntries(state.products.map(p=>[p.id,p]));
    const rows = {};
    list.forEach(x => {
      if (!state.countriesNoChina.includes(x.country)) return;
      const key = (pmap[x.productId]?.name || x.productId) + '|' + x.country;
      rows[key] = rows[key] || { product: pmap[x.productId]?.name || x.productId, country: x.country, rev:0, ad:0, ship:0, base:0, pcs:0, profit:0 };
      const base = ((+pmap[x.productId]?.cost_china||0) + (+pmap[x.productId]?.ship_china_to_kenya||0)) * (+x.pieces||0);
      const extra = (+x.extraPerPiece||0) * (+x.pieces||0);
      rows[key].rev += +x.revenue||0;
      rows[key].ad += +x.adSpend||0;
      rows[key].ship += extra;
      rows[key].base += base;
      rows[key].pcs += +x.pieces||0;
    });
    Object.values(rows).forEach(r => r.profit = r.rev - r.ad - r.ship - r.base);

    const tb = Q('#lifetimeBody'); let R=0,A=0,S=0,B=0,P=0,PCS=0;
    tb.innerHTML = Object.values(rows).map(r => {
      R+=r.rev; A+=r.ad; S+=r.ship; B+=r.base; P+=r.profit; PCS+=r.pcs;
      return `<tr><td>${r.product}</td><td>${r.country}</td><td>${fmt(r.rev)}</td><td>${fmt(r.ad)}</td><td>${fmt(r.ship)}</td><td>${fmt(r.base)}</td><td>${fmt(r.pcs)}</td><td>${fmt(r.profit)}</td></tr>`;
    }).join('') || `<tr><td colspan="8" class="muted">No data</td></tr>`;
    Q('#ltRevT').textContent = fmt(R); Q('#ltAdT').textContent = fmt(A);
    Q('#ltShipT').textContent = fmt(S); Q('#ltBaseT').textContent = fmt(B);
    Q('#ltPiecesT').textContent = fmt(PCS); Q('#ltProfitT').textContent = fmt(P);
  });
}

/* ================================================================
   FINANCE
   ================================================================ */
async function initFinance() {
  await loadFinanceCats();

  // add/delete category
  Q('#fcAdd')?.addEventListener('click', async () => {
    const type = Q('#fcType').value, name = Q('#fcName').value.trim();
    if (!name) return;
    await api('/api/finance/categories', { method:'POST', body: JSON.stringify({ type, name }) });
    await loadFinanceCats();
    Q('#fcName').value = '';
  });

  // ADD ENTRY (with optional date range)
  Q('#feAdd')?.addEventListener('click', async () => {
    const s = Q('#feDateS').value, e = Q('#feDateE').value;
    const type = Q('#feType').value, category = Q('#feCat').value;
    const amount = +Q('#feAmt').value || 0, note = Q('#feNote').value;

    if (!category || !type) return alert('Pick type & category');
    if (!s && !e) return alert('Pick a date or a date range');

    const dates = [];
    const start = new Date(s || e), end = new Date(e || s);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) {
      dates.push(d.toISOString().slice(0,10));
    }
    for (const dt of dates) {
      await api('/api/finance/entries', { method:'POST', body: JSON.stringify({ date: dt, type, category, amount, note }) });
    }
    alert('Saved'); Q('#feNote').value=''; Q('#feAmt').value='';
    renderFinancePeriod();
  });

  Q('#feRun')?.addEventListener('click', renderFinancePeriod);
  renderFinancePeriod();
}

async function loadFinanceCats() {
  try {
    const cats = await api('/api/finance/categories');
    state.categories = cats;
    Q('#fcDebits') && (Q('#fcDebits').innerHTML = cats.debit.map(c=>`<span class="chip">${c}</span>`).join('') || '—');
    Q('#fcCredits') && (Q('#fcCredits').innerHTML = cats.credit.map(c=>`<span class="chip">${c}</span>`).join('') || '—');
    const all = [...cats.debit, ...cats.credit].sort();
    Q('#feCat') && (Q('#feCat').innerHTML = `<option value="" disabled selected>Select category</option>` + all.map(c=>`<option>${c}</option>`).join(''));
  } catch {}
}

async function renderFinancePeriod() {
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
}

/* ================================================================
   SETTINGS
   ================================================================ */
function initSettings() {
  // add country
  Q('#ctyAdd')?.addEventListener('click', async () => {
    const name = Q('#cty').value.trim(); if (!name) return;
    await api('/api/countries', { method:'POST', body: JSON.stringify({ name }) });
    const m = await api('/api/meta'); state.countries = m.countries || []; state.countriesNoChina = state.countries.filter(c=>c.toLowerCase()!=='china');
    fillGlobalSelects(); renderCountryChips();
  });
  renderCountryChips();

  // product editor (FIX: proper IDs)
  const sel = Q('#epSelect');
  if (sel) {
    sel.innerHTML = `<option value="" disabled selected>Select product…</option>` + state.products.map(p=>`<option value="${p.id}">${p.name} (${p.sku||'—'})</option>`).join('');
    sel.onchange = () => {
      const p = state.products.find(x=>x.id===sel.value); if (!p) return;
      Q('#epName').value = p.name; Q('#epSku').value = p.sku || '';
      Q('#epCost').value = p.cost_china || 0; Q('#epShip').value = p.ship_china_to_kenya || 0; Q('#epMB').value = p.margin_budget || 0;
    };
    Q('#epSave')?.addEventListener('click', async () => {
      const id = sel.value; if (!id) return alert('Select product');
      const p = {
        name: Q('#epName').value, sku: Q('#epSku').value,
        cost_china:+Q('#epCost').value||0, ship_china_to_kenya:+Q('#epShip').value||0,
        margin_budget:+Q('#epMB').value||0
      };
      await api('/api/products/' + encodeURIComponent(id), { method:'PUT', body: JSON.stringify(p) });
      await preloadProducts();
      alert('Saved');
    });
  }

  // snapshots (push should NOT delete)
  renderSnapshots();
  Q('#snapSave')?.addEventListener('click', async () => {
    const name = Q('#snapName').value.trim() || prompt('Name this snapshot') || '';
    if (!name) return;
    await api('/api/snapshots', { method:'POST', body: JSON.stringify({ name }) });
    Q('#snapName').value = '';
    renderSnapshots();
  });
}

function renderCountryChips() {
  const list = Q('#ctyList'); if (!list) return;
  // Just chips for info; deletion handled in server via DELETE (already works)
  list.innerHTML = state.countries.map(c => `<span class="chip">${c}</span>`).join('') || '—';
}

async function renderSnapshots() {
  const r = await api('/api/snapshots');
  const tb = Q('#snapList'); if (!tb) return;
  tb.innerHTML = (r.snapshots || []).map(s =>
    `<tr><td>${s.name}</td><td>${s.file.split('/').pop()}</td>
      <td>
        <button class="btn outline" data-push="${s.file}">Push</button>
        <button class="btn outline danger" data-del="${s.id}">Delete</button>
      </td></tr>`
  ).join('') || `<tr><td colspan="3" class="muted">No snapshots</td></tr>`;
  tb.onclick = async e => {
    if (e.target.dataset.push) {
      await api('/api/snapshots/restore', { method:'POST', body: JSON.stringify({ file: e.target.dataset.push }) });
      alert('System restored (snapshot kept).'); location.reload();
    } else if (e.target.dataset.del) {
      if (!confirm('Delete this snapshot file?')) return;
      await api('/api/snapshots/' + e.target.dataset.del, { method:'DELETE' });
      renderSnapshots();
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
  Q('#pdTitle').textContent = state.product.name;
  Q('#pdSku').textContent = state.product.sku ? `SKU: ${state.product.sku}` : '';

  fillGlobalSelects();
  bindProductHandlers();
  refreshProductSections();
}

function bindProductHandlers() {
  // manual per-country budgets table (editable cells)
  Q('#pdPBSave')?.addEventListener('click', async () => {
    const map = {};
    QA('.pb-input').forEach(i => map[i.dataset.country] = +i.value || 0);
    await api('/api/products/' + state.product.id, { method:'PUT', body: JSON.stringify({ budgets: map }) });
    await loadProduct(state.product.id);
    renderPBTable();
  });

  // daily ad spend replace
  Q('#pdAdSave')?.addEventListener('click', async () => {
    const payload = {
      productId: state.product.id,
      country: Q('#pdAdCountry').value,
      platform: Q('#pdAdPlatform').value,
      amount: +Q('#pdAdAmount').value || 0
    };
    if (!payload.country || payload.country.toLowerCase()==='china') return alert('Select a non-China country');
    await api('/api/adspend', { method:'POST', body: JSON.stringify(payload) });
    refreshProductSections();
  });

  // shipments (with China allowed)
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

  // lifetime filter (THIS PRODUCT) – FIX
  Q('#pdLPRun')?.addEventListener('click', () => renderProductLifetime());

  // influencers
  Q('#pdInfSpendAdd')?.addEventListener('click', async () => {
    const payload = {
      date: Q('#pdInfDate').value || todayISO(),
      influencerId: Q('#pdInfSelect').value,
      country: Q('#pdInfCountry').value,
      productId: state.product.id,
      amount: +Q('#pdInfAmount').value || 0
    };
    if (!payload.influencerId) return alert('Select influencer');
    if (!payload.country || payload.country.toLowerCase()==='china') return alert('Select a non-China country');
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

/* -- product: stock & ad by country (exclude China) -- */
async function renderProductStockAd() {
  const tb = Q('#pdStockBody'); if (!tb) return;

  const per = {}; state.countriesNoChina.forEach(c => per[c] = { stock: 0, ad: 0 });
  const s = await api('/api/shipments');
  (s.shipments || []).filter(x=>x.productId===state.product.id && x.arrivedAt).forEach(sp => {
    const to = sp.toCountry || sp.to, from = sp.fromCountry || sp.from, q = (+sp.qty||0);
    if (state.countriesNoChina.includes(to)) { per[to].stock += q; }
    if (state.countriesNoChina.includes(from)) { per[from].stock -= q; }
  });

  const r = await api('/api/remittances');
  (r.remittances || []).filter(x=>x.productId===state.product.id).forEach(rr => {
    if (!state.countriesNoChina.includes(rr.country)) return;
    per[rr.country].stock -= (+rr.pieces||0);
  });

  const a = await api('/api/adspend');
  (a.adSpends || []).filter(x=>x.productId===state.product.id).forEach(ad => {
    if (!state.countriesNoChina.includes(ad.country)) return;
    per[ad.country].ad += (+ad.amount||0);
  });

  let st=0, at=0;
  tb.innerHTML = Object.entries(per).map(([c,v])=>{
    st+=v.stock; at+=v.ad;
    return `<tr><td>${c}</td><td>${fmt(v.stock)}</td><td>${fmt(v.ad)}</td></tr>`;
  }).join('') || `<tr><td colspan="3" class="muted">No data</td></tr>`;
  Q('#pdStockTotal').textContent = fmt(st);
  Q('#pdAdTotal').textContent = fmt(at);
}

/* -- product: manual budget table (with inputs) -- */
function renderPBTable() {
  const tb = Q('#pdPBBBody'); if (!tb) return;
  const map = state.product.budgets || {};
  tb.innerHTML = state.countriesNoChina.map(c => `
    <tr>
      <td>${c}</td>
      <td><input class="input pb-input" data-country="${c}" type="number" step="0.01" value="${map[c] ?? ''}" placeholder="0"/></td>
    </tr>
  `).join('') || `<tr><td colspan="2" class="muted">No countries</td></tr>`;
}

/* -- product: ad list (this product only) -- */
async function renderProductAdList() {
  const a = await api('/api/adspend');
  const list = (a.adSpends || []).filter(x=>x.productId===state.product.id && state.countriesNoChina.includes(x.country));
  const tb = Q('#pdAdBody'); if (!tb) return;
  tb.innerHTML = list.map(x => `<tr><td>${x.country}</td><td>${x.platform}</td><td>${fmt(x.amount)}</td></tr>`).join('') ||
    `<tr><td colspan="3" class="muted">No ad spend yet</td></tr>`;
}

/* -- product: transit tables (product only) -- */
async function renderProductTransit() {
  const s = await api('/api/shipments');
  const list = (s.shipments || []).filter(x=>x.productId===state.product.id);
  const ck = list.filter(sp =>
    (sp.fromCountry||sp.from||'').toLowerCase()==='china' &&
    (sp.toCountry||sp.to||'').toLowerCase()==='kenya'
  );
  const ic = list.filter(sp => !ck.includes(sp));

  const row = sp => {
    const days = sp.arrivedAt ? Math.round((+new Date(sp.arrivedAt) - +new Date(sp.departedAt)) / 86400000) : '';
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

  Q('#pdShipCKBody').innerHTML = ck.map(row).join('') || `<tr><td colspan="8" class="muted">No shipments</td></tr>`;
  Q('#pdShipICBody').innerHTML = ic.map(row).join('') || `<tr><td colspan="8" class="muted">No shipments</td></tr>`;

  // reuse transitAction
  Q('#pdShipCK')?.addEventListener('click', transitAction, { once:true });
  Q('#pdShipIC')?.addEventListener('click', transitAction, { once:true });
}

/* -- product: lifetime (THIS product) – filter FIX -- */
async function renderProductLifetime() {
  const s = Q('#pdLPStart')?.value, e = Q('#pdLPEnd')?.value;
  const qs = []; if (s) qs.push('start='+s); if (e) qs.push('end='+e);
  const r = await api('/api/remittances' + (qs.length?('?'+qs.join('&')):''));
  const list = (r.remittances || []).filter(x=>x.productId===state.product.id && state.countriesNoChina.includes(x.country));

  const prod = state.product;
  const basePerPiece = (+prod.cost_china||0) + (+prod.ship_china_to_kenya||0);

  const byCountry = {};
  list.forEach(x => {
    const k = x.country;
    if (!byCountry[k]) byCountry[k] = { rev:0, ad:0, ship:0, base:0, pcs:0, profit:0 };
    const pcs = +x.pieces || 0;
    const extra = (+x.extraPerPiece||0) * pcs;
    byCountry[k].rev += +x.revenue || 0;
    byCountry[k].ad += +x.adSpend || 0;
    byCountry[k].ship += extra;
    byCountry[k].base += basePerPiece * pcs;
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

/* -- product: influencers – countries select FIX -- */
async function renderInfluencers() {
  const infs = await api('/api/influencers');       // list of influencers
  const spends = await api('/api/influencers/spend');
  const sel = Q('#pdInfSelect');
  if (sel) sel.innerHTML = (infs.influencers||[]).map(i=>`<option value="${i.id}">${i.name}</option>`).join('');

  // filter by date/product/country
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

/* ================================================================
   NAV + BOOT
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
    if (v === 'home') { renderKpis(); renderStockAndSpendByCountry(); renderTransitTables(); }
  }));
}

gate();
