// ===============================
// EAS Tracker - Frontend (vanilla JS)
// ===============================

// ---------- tiny helpers ----------
const $  = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const nf = (n) => (isNaN(n) ? '0.00' : Number(n).toFixed(2));
const todayISO = () => new Date().toISOString().slice(0,10);
const weekdayName = (d) => new Date(d).toLocaleDateString(undefined, { weekday:'long' });

const state = {
  view:'home',
  countries: [],
  products: [],
  openedProductId: null,
  financeCats: { debits:[], credits:[] }
};

async function api(path, opts={}) {
  const res = await fetch(path, {
    credentials:'include',
    headers:{ 'Content-Type':'application/json' },
    ...opts
  });
  if (!res.ok) {
    let t=''; try{ t=await res.text(); }catch{}
    throw new Error(t || ('HTTP '+res.status));
  }
  return res.json();
}

function setView(v){
  state.view = v;
  ['home','products','performance','finance','settings'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) el.style.display = id===v ? '' : 'none';
  });
  $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.view===v));
}

// ===================================================
// BOOT / AUTH
// ===================================================
async function ensureMeta() {
  try {
    const m = await api('/api/meta');
    state.countries = m.countries || [];
    await loadProducts();
    $('#login').style.display = 'none';
    $('#main').style.display  = '';
    fillSelects();
    renderCountriesChips();
    await refreshHome();
    if (state.view==='products') renderProducts();
    if (state.view==='finance') renderFinance();
  } catch (e) {
    $('#login').style.display = '';
    $('#main').style.display  = 'none';
  }
}

async function loadProducts(){
  try { const r = await api('/api/products'); state.products = r.products || []; }
  catch { state.products = []; }
}

function fillSelects(){
  // countries
  const cSel = '#delivCountry,#adCountry,#mvFrom,#mvTo,#pfCountry,#rCountry,#pdAdCountry,#pdRCountry,#pdInfCountry,#pdInfFilterCountry,#pdMvFrom,#pdMvTo';
  $$(cSel).forEach(s=>{
    if(!s) return;
    const opts = (s.id==='pfCountry' || s.id==='pdInfFilterCountry') ? ['<option value="">All countries</option>'] : [];
    opts.push(...state.countries.map(c=>`<option value="${c}">${c}</option>`));
    s.innerHTML = opts.join('');
  });
  // products
  const pSel = '#adProduct,#mvProduct,#rProduct,#lpProduct';
  $$(pSel).forEach(s=>{
    if(!s) return;
    const opts = s.id==='lpProduct' ? ['<option value="">All products</option>'] : [];
    opts.push(...state.products.map(p=>`<option value="${p.id}">${p.name}${p.sku?` (${p.sku})`:''}</option>`));
    s.innerHTML = opts.join('');
  });
}

function renderCountriesChips(){
  const wrap = $('#ctyList');
  if (!wrap) return;
  wrap.innerHTML = state.countries.map(c=>`<span class="chip">${c}</span>`).join('');
}

// ===================================================
// DASHBOARD
// ===================================================
async function refreshHome(){
  // KPIs: products & warehouses
  $('#kpiProducts').textContent  = state.products.length;
  $('#kpiCountries').textContent = state.countries.length;

  // Transit count
  try {
    const s = await api('/api/shipments');
    const inTransit = (s.shipments||[]).filter(x=>!x.arrivedAt).length;
    $('#kpiTransit').textContent = inTransit;
  } catch { $('#kpiTransit').textContent = '—'; }

  // Weekly deliveries (Mon-Sun) grid + totals
  await renderWeeklyDeliveredGrid();

  // Stock + ad spend per country
  await renderStockAndAdByCountry();

  // Shipments tables
  await renderShipmentsTable('china-kenya', '#shipCKTable tbody');
  await renderShipmentsTable('intercountry', '#shipICTable tbody');

  // Lifetime table (global) will render when user hits Run
}

async function renderStockAndAdByCountry(){
  const wrap = $('#stockByCountry');
  const perCountry = {};
  state.countries.forEach(c=> perCountry[c] = { stock:0, ad:0 });

  try {
    const ship = await api('/api/shipments');
    (ship.shipments||[]).forEach(s=>{
      if (s.arrivedAt) {
        const to = s.toCountry || s.to;
        if (!perCountry[to]) perCountry[to] = { stock:0, ad:0 };
        perCountry[to].stock += (+s.qty||0);
      }
    });
  } catch {}

  try {
    const rem = await api('/api/remittances');
    (rem.remittances||[]).forEach(r=>{
      const c = r.country;
      if (!perCountry[c]) perCountry[c] = { stock:0, ad:0 };
      perCountry[c].stock -= (+r.pieces||0);
    });
  } catch {}

  try {
    const ads = await api('/api/adspend');
    (ads.adSpends||[]).forEach(a=>{
      const c = a.country;
      if (!perCountry[c]) perCountry[c] = { stock:0, ad:0 };
      perCountry[c].ad += (+a.amount||0);
    });
  } catch {}

  const rows = Object.entries(perCountry).map(([c,v]) =>
    `<tr><td>${c}</td><td>${v.stock}</td><td>${nf(v.ad)} USD</td></tr>`
  ).join('');
  wrap.innerHTML = `
    <h2>Total Stock & Ad Spend by Country</h2>
    <table class="table"><thead>
      <tr><th>Country</th><th>Approx. Stock</th><th>Total Ad Spend</th></tr>
    </thead><tbody>${rows}</tbody></table>`;
}

// --- Weekly Delivered Grid ---
async function renderWeeklyDeliveredGrid(){
  // Build grid header: countries vs Mon..Sun
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const grid = $('#weeklyGrid');
  if (!grid) return;

  // Fetch current week numbers per country/day
  let data = {};
  try {
    const r = await api('/api/deliveries/week-grid');
    data = r.grid || {}; // { country: { Monday: n, ... } }
  } catch { data = {}; }

  // Ensure all countries present
  state.countries.forEach(c=>{
    if (!data[c]) data[c] = {};
    days.forEach(d=>{ if (typeof data[c][d] !== 'number') data[c][d] = 0; });
  });

  // Render table
  const header = `<tr><th>Country</th>${days.map(d=>`<th>${d}</th>`).join('')}<th>Total</th></tr>`;
  const rows = state.countries.map(c=>{
    const total = days.reduce((a,d)=>a + (+data[c][d]||0),0);
    return `<tr data-row="${c}">
      <td><strong>${c}</strong></td>
      ${days.map(d=>`<td><input class="input tiny wd" data-country="${c}" data-day="${d}" type="number" min="0" value="${+data[c][d]||0}"></td>`).join('')}
      <td class="rowTotal" data-country-total="${c}">${total}</td>
    </tr>`;
  }).join('');
  const grand = state.countries.reduce((a,c)=> a + days.reduce((x,d)=>x+(+data[c][d]||0),0), 0);

  grid.innerHTML = `
    <h2>Weekly Delivered (Mon–Sun)</h2>
    <div class="card">
      <div class="flex wrap">
        <button id="wdSave" class="btn">Save</button>
        <button id="wdReset" class="btn outline">Reset</button>
        <div class="badge">Grand total: <span id="wdGrand">${grand}</span></div>
      </div>
    </div>
    <table class="table"><thead>${header}</thead><tbody>${rows}</tbody></table>
  `;

  // Change handlers to update totals live
  $$('.wd').forEach(inp=>{
    inp.addEventListener('input', ()=>{
      const country = inp.dataset.country;
      const row = document.querySelector(`tr[data-row="${country}"]`);
      const nums = Array.from(row.querySelectorAll('input.wd')).map(i=>+i.value||0);
      const sum = nums.reduce((a,b)=>a+b,0);
      row.querySelector('[data-country-total]').textContent = sum;
      const newGrand = Array.from($$('.rowTotal')).reduce((a,td)=>a+(+td.textContent||0),0);
      $('#wdGrand').textContent = newGrand;
    });
  });

  // Save -> POST entire grid
  $('#wdSave').onclick = async ()=>{
    const payload = {};
    state.countries.forEach(c=>{
      payload[c] = {};
      days.forEach(d=>{
        const el = document.querySelector(`input.wd[data-country="${c}"][data-day="${d}"]`);
        payload[c][d] = +el.value||0;
      });
    });
    await api('/api/deliveries/week-grid', { method:'POST', body: JSON.stringify({ grid: payload }) });
    alert('Saved');
    await refreshHome();
  };

  // Reset -> clear to zeros
  $('#wdReset').onclick = async ()=>{
    if (!confirm('Clear this week grid?')) return;
    await api('/api/deliveries/week-grid', { method:'POST', body: JSON.stringify({ grid: {} }) });
    await renderWeeklyDeliveredGrid();
    await refreshHome();
  };

  // KPI delivered this week
  $('#kpiDelivered').textContent = grand;
}

// --- Daily Ad Spend (no date; replace today) ---
$('#adAdd')?.addEventListener('click', async ()=>{
  const payload = {
    platform: $('#adPlatform').value,
    productId: $('#adProduct').value,
    country: $('#adCountry').value,
    amount: +($('#adAmount').value||0)
  };
  if (!payload.productId || !payload.country) return alert('Select product and country');
  await api('/api/adspend', { method:'POST', body: JSON.stringify({ ...payload, date: todayISO(), replaceToday:true }) });
  alert('Saved'); await refreshHome();
});

// --- Create shipment (movement) ---
$('#mvAdd')?.addEventListener('click', async ()=>{
  const payload = {
    productId: $('#mvProduct').value,
    fromCountry: $('#mvFrom').value,
    toCountry: $('#mvTo').value,
    qty: +($('#mvQty').value||0),
    shipCost: +($('#mvShip').value||0),
    departedAt: todayISO()
  };
  if (!payload.productId) return alert('Select product');
  await api('/api/shipments', { method:'POST', body: JSON.stringify(payload) });
  alert('Added'); await refreshHome();
});

// --- Shipments tables + actions ---
async function renderShipmentsTable(kind, sel){
  const body = $(sel); if (!body) return;
  try {
    const r = await api('/api/shipments');
    let list = r.shipments || [];
    const ck = (s) => ( (s.fromCountry||s.from||'').toLowerCase()==='china' && (s.toCountry||s.to||'').toLowerCase()==='kenya' );
    list = kind==='china-kenya' ? list.filter(ck) : list.filter(s=>!ck(s));

    const mapProd = Object.fromEntries(state.products.map(p=>[p.id,p.name]));
    body.innerHTML = list.map(s=>`
      <tr data-id="${s.id}">
        <td>${s.id}</td>
        <td>${mapProd[s.productId] || s.productId}</td>
        <td>${s.fromCountry||s.from} → ${s.toCountry||s.to}</td>
        <td><input class="input tiny qty" type="number" min="0" value="${+s.qty||0}"></td>
        <td><input class="input tiny ship" type="number" min="0" step="0.01" value="${+s.shipCost||0}"></td>
        <td>${s.departedAt||''}</td>
        <td>${s.arrivedAt||''}${s.arrivedAt&&s.departedAt?` <span class="badge">${daysBetween(s.departedAt,s.arrivedAt)} days</span>`:''}</td>
        <td>
          <button class="btn outline mark">Mark Arrived</button>
          <button class="btn outline saveRow">Save</button>
          <button class="btn outline del">Delete</button>
        </td>
      </tr>
    `).join('');

    body.querySelectorAll('.mark').forEach(b=>{
      b.onclick = async ()=>{
        const tr = b.closest('tr'); const id = tr.dataset.id;
        const d  = prompt('Arrival date (YYYY-MM-DD)', todayISO());
        if (!d) return;
        await api(`/api/shipments/${id}`, { method:'PUT', body: JSON.stringify({ arrivedAt: d }) });
        await renderShipmentsTable(kind, sel); await refreshHome();
      };
    });
    body.querySelectorAll('.saveRow').forEach(b=>{
      b.onclick = async ()=>{
        const tr = b.closest('tr'); const id = tr.dataset.id;
        const qty = +tr.querySelector('.qty').value||0;
        const shipCost = +tr.querySelector('.ship').value||0;
        await api(`/api/shipments/${id}`, { method:'PUT', body: JSON.stringify({ qty, shipCost }) });
        alert('Saved');
      };
    });
    body.querySelectorAll('.del').forEach(b=>{
      b.onclick = async ()=>{
        const tr = b.closest('tr'); const id = tr.dataset.id;
        if (!confirm('Delete shipment?')) return;
        await api(`/api/shipments/${id}`, { method:'DELETE' });
        await renderShipmentsTable(kind, sel); await refreshHome();
      };
    });
  } catch {
    body.innerHTML = '';
  }
}
function daysBetween(a,b){
  const d1 = new Date(a); const d2 = new Date(b);
  return Math.round( (d2-d1)/(1000*60*60*24) );
}

// ===================================================
// PRODUCTS
// ===================================================
$('#pAdd')?.addEventListener('click', async ()=>{
  const payload = {
    name: $('#pName').value.trim(),
    sku: $('#pSku').value.trim(),
    cost_china: +($('#pCost').value||0),
    ship_china_to_kenya: +($('#pShip').value||0),
    margin_budget: +($('#pMB').value||0)
  };
  if (!payload.name) return alert('Name is required');
  await api('/api/products', { method:'POST', body: JSON.stringify(payload) });
  await loadProducts(); fillSelects(); renderProducts(); alert('Product added');
});

async function renderProducts(){
  const tbody = $('#productsTable tbody'); if (!tbody) return;
  tbody.innerHTML = state.products.map(p=>`
    <tr data-id="${p.id}">
      <td>${p.name}</td>
      <td>${p.sku||'-'}</td>
      <td><span class="badge">${p.status||'active'}</span></td>
      <td class="flex wrap">
        <button class="btn outline open">Open</button>
        <button class="btn outline pause">${(p.status||'active')==='active'?'Pause':'Run'}</button>
        <button class="btn outline del">Delete</button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.open').forEach(b=>{
    b.onclick = (e)=>{
      const id = e.target.closest('tr').dataset.id;
      state.openedProductId = id;
      openProductPanel(id);
    };
  });
  tbody.querySelectorAll('.pause').forEach(b=>{
    b.onclick = async (e)=>{
      const tr = e.target.closest('tr'); const id = tr.dataset.id;
      const prod = state.products.find(x=>x.id===id);
      const ns = (prod.status||'active')==='active' ? 'paused' : 'active';
      await api(`/api/products/${id}/status`, { method:'POST', body: JSON.stringify({ status: ns }) });
      await loadProducts(); renderProducts(); await refreshHome();
    };
  });
  tbody.querySelectorAll('.del').forEach(b=>{
    b.onclick = async (e)=>{
      const id = e.target.closest('tr').dataset.id;
      if (!confirm('Delete product?')) return;
      await api('/api/products/'+id, { method:'DELETE' });
      await loadProducts(); fillSelects(); renderProducts(); await refreshHome();
    };
  });
}

// Open product panel (basic pieces wired)
async function openProductPanel(id){
  // show details block
  const details = $('#productDetails');
  if (!details) return;
  details.style.display = '';
  const prod = state.products.find(p=>p.id===id);
  details.querySelector('h3').textContent = `Product Details — ${prod?.name||id}`;

  // fill product selects inside panel
  $('#pdAdCountry').innerHTML = state.countries.map(c=>`<option value="${c}">${c}</option>`).join('');
  $('#pdRCountry').innerHTML  = state.countries.map(c=>`<option value="${c}">${c}</option>`).join('');
  $('#pdMvFrom').innerHTML    = state.countries.map(c=>`<option value="${c}">${c}</option>`).join('');
  $('#pdMvTo').innerHTML      = state.countries.map(c=>`<option value="${c}">${c}</option>`).join('');
  $('#pdInfCountry').innerHTML= state.countries.map(c=>`<option value="${c}">${c}</option>`).join('');

  // render product-specific shipments
  await renderProductShipments(id);
  await renderProductLifetime(id);
  await renderProductInfluencers(id);

  // wire product panel buttons
  $('#pdAdSave').onclick = async ()=>{
    const payload = {
      date: todayISO(),
      productId: id,
      country: $('#pdAdCountry').value,
      platform: $('#pdAdPlatform').value,
      amount: +($('#pdAdAmount').value||0),
      replaceToday: true
    };
    await api('/api/adspend', { method:'POST', body: JSON.stringify(payload) });
    alert('Saved'); await refreshHome();
  };

  $('#pdRAdd').onclick = async ()=>{
    const payload = {
      start: $('#pdRStart').value,
      end:   $('#pdREnd').value,
      country: $('#pdRCountry').value,
      productId: id,
      orders: +($('#pdROrders').value||0),
      pieces: +($('#pdRPieces').value||0),
      revenue:+($('#pdRRevenue').value||0),
      adSpend:+($('#pdRAdSpend').value||0),
      extraCostPerPiece:+($('#pdRCPD').value||0) // renamed field
    };
    if (!payload.start || !payload.end) return alert('Select dates');
    await api('/api/remittances', { method:'POST', body: JSON.stringify(payload) });
    alert('Added'); await refreshHome(); await renderProductLifetime(id);
  };

  $('#pdMvAdd').onclick = async ()=>{
    const payload = {
      productId:id,
      fromCountry: $('#pdMvFrom').value,
      toCountry:   $('#pdMvTo').value,
      qty:+($('#pdMvQty').value||0),
      shipCost:+($('#pdMvShip').value||0),
      departedAt: todayISO()
    };
    await api('/api/shipments', { method:'POST', body: JSON.stringify(payload) });
    await renderProductShipments(id); await refreshHome();
  };

  $('#pdLPRun').onclick = async ()=>{ await renderProductLifetime(id); };

  $('#pdInfAdd').onclick = async ()=>{
    const name = $('#pdInfName').value.trim();
    const social = $('#pdInfSocial').value.trim();
    const country = $('#pdInfCountry').value;
    if (!name) return alert('Name required');
    await api('/api/influencers', { method:'POST', body: JSON.stringify({ name, social }) });
    await api('/api/influencers/spend', { method:'POST', body: JSON.stringify({
      date: todayISO(), influencer: name, country, productId:id, amount: 0
    })});
    await renderProductInfluencers(id);
  };
  $('#pdInfSpendAdd').onclick = async ()=>{
    const date   = $('#pdInfDate').value||todayISO();
    const name   = $('#pdInfSelect').value;
    const amount = +($('#pdInfAmount').value||0);
    const country= $('#pdInfCountry').value;
    if (!name) return alert('Pick influencer');
    await api('/api/influencers/spend', { method:'POST', body: JSON.stringify({ date, influencer:name, country, productId:id, amount }) });
    await renderProductInfluencers(id);
  };
  $('#pdInfRun').onclick = async ()=>{ await renderProductInfluencers(id); };
}

async function renderProductShipments(id){
  const prodName = Object.fromEntries(state.products.map(p=>[p.id,p.name]))[id] || id;
  const all = await api('/api/shipments'); const list = (all.shipments||[]).filter(s=>s.productId===id);
  const ck = list.filter(s=> (s.fromCountry||s.from||'').toLowerCase()==='china' && (s.toCountry||s.to||'').toLowerCase()==='kenya');
  const ic = list.filter(s=> !((s.fromCountry||s.from||'').toLowerCase()==='china' && (s.toCountry||s.to||'').toLowerCase()==='kenya'));

  const render = (arr, sel)=>{
    const tbody = $(sel); if (!tbody) return;
    tbody.innerHTML = arr.map(s=>`
      <tr data-id="${s.id}">
        <td>${s.id}</td><td>${(s.fromCountry||s.from)} → ${(s.toCountry||s.to)}</td>
        <td><input class="input tiny qty" type="number" min="0" value="${+s.qty||0}"></td>
        <td><input class="input tiny ship" type="number" min="0" step="0.01" value="${+s.shipCost||0}"></td>
        <td>${s.departedAt||''}</td>
        <td>${s.arrivedAt||''}${s.arrivedAt&&s.departedAt?` <span class="badge">${daysBetween(s.departedAt,s.arrivedAt)} days</span>`:''}</td>
        <td>
          <button class="btn outline mark">Mark Arrived</button>
          <button class="btn outline saveRow">Save</button>
          <button class="btn outline del">Delete</button>
        </td>
      </tr>`).join('');

    tbody.querySelectorAll('.mark').forEach(b=> b.onclick = async ()=>{
      const id = b.closest('tr').dataset.id;
      const d  = prompt('Arrival date (YYYY-MM-DD)', todayISO());
      if (!d) return;
      await api(`/api/shipments/${id}`, { method:'PUT', body: JSON.stringify({ arrivedAt:d }) });
      await renderProductShipments(state.openedProductId); await refreshHome();
    });
    tbody.querySelectorAll('.saveRow').forEach(b=> b.onclick = async ()=>{
      const tr = b.closest('tr'); const id = tr.dataset.id;
      const qty = +tr.querySelector('.qty').value||0;
      const shipCost = +tr.querySelector('.ship').value||0;
      await api(`/api/shipments/${id}`, { method:'PUT', body: JSON.stringify({ qty, shipCost }) });
      alert('Saved');
    });
    tbody.querySelectorAll('.del').forEach(b=> b.onclick = async ()=>{
      const id = b.closest('tr').dataset.id;
      if (!confirm('Delete shipment?')) return;
      await api(`/api/shipments/${id}`, { method:'DELETE' });
      await renderProductShipments(state.openedProductId); await refreshHome();
    });
  };
  render(ck, '#pdShipCK tbody');
  render(ic, '#pdShipIC tbody');
}

async function renderProductLifetime(id){
  const s = $('#pdLPTableWrap'); if (!s) return;
  const start = $('#pdLPStart').value || ''; const end = $('#pdLPEnd').value || '';
  const rem = await api(`/api/remittances${start||end?`?start=${start}&end=${end}`:''}`);
  const ship= await api('/api/shipments');
  const prod = state.products.find(p=>p.id===id)||{cost_china:0,ship_china_to_kenya:0};
  const baseCost = (+prod.cost_china||0) + (+prod.ship_china_to_kenya||0);

  let revenue=0, ad=0, pieces=0, shipCost=0, extra=0;
  (rem.remittances||[]).filter(r=>r.productId===id).forEach(r=>{
    revenue += +r.revenue||0;
    ad      += +r.adSpend||0;
    pieces  += +r.pieces||0;
    extra   += (+r.extraCostPerPiece||0) * (+r.pieces||0);
  });
  (ship.shipments||[]).filter(x=>x.productId===id && x.arrivedAt).forEach(x=>{
    shipCost += +x.shipCost||0;
  });
  const base = baseCost * pieces;
  const profit = revenue - ad - extra - shipCost - base;

  s.innerHTML = `
    <table class="table"><thead>
      <tr><th>Revenue</th><th>Ad Spend</th><th>Extra Deliver Cost</th><th>Shipping</th><th>Base Cost</th><th>Pieces</th><th>Profit</th></tr>
    </thead><tbody>
      <tr><td>${nf(revenue)}</td><td>${nf(ad)}</td><td>${nf(extra)}</td><td>${nf(shipCost)}</td><td>${nf(base)}</td><td>${pieces}</td><td>${nf(profit)}</td></tr>
    </tbody></table>
  `;
}

async function renderProductInfluencers(id){
  const wrap = $('#pdInfList'); if (!wrap) return;
  const start = $('#pdInfStart').value||''; const end = $('#pdInfEnd').value||'';
  const country = $('#pdInfFilterCountry').value||'';
  const all = await api(`/api/influencers/spend/list${(start||end||country)?`?start=${start}&end=${end}&country=${encodeURIComponent(country)}`:''}`);
  const items = (all.items||[]).filter(x=>x.productId===id);

  // populate influencers select
  const unique = [...new Set(items.map(x=>x.influencer))];
  $('#pdInfSelect').innerHTML = unique.map(n=>`<option value="${n}">${n}</option>`).join('');

  if (!items.length){ wrap.innerHTML = '<div class="muted">No influencer spend in this period.</div>'; return; }
  const rows = items.map(x=>`<tr><td>${x.date}</td><td>${x.country}</td><td>${x.influencer}</td><td>${nf(+x.amount||0)}</td></tr>`).join('');
  const total = items.reduce((a,b)=>a+(+b.amount||0),0);
  wrap.innerHTML = `
    <table class="table"><thead><tr><th>Date</th><th>Country</th><th>Influencer</th><th>Spend</th></tr></thead>
    <tbody>${rows}</tbody><tfoot><tr><td colspan="3">Total</td><td>${nf(total)}</td></tr></tfoot></table>`;
}

// ===================================================
// PERFORMANCE
// ===================================================
$('#pfRun')?.addEventListener('click', async ()=>{
  const s = $('#pfStart').value, e = $('#pfEnd').value, c = $('#pfCountry').value;
  const r = await api(`/api/remittances${(s||e||c) ? `?${[
    s?`start=${s}`:'', e?`end=${e}`:'', c?`country=${encodeURIComponent(c)}`:''
  ].filter(Boolean).join('&')}`:''}`);

  const productsById = Object.fromEntries(state.products.map(p=>[p.id,p]));
  const agg = {};
  (r.remittances||[]).forEach(x=>{
    const pid = x.productId;
    const p = productsById[pid]||{cost_china:0,ship_china_to_kenya:0};
    const base = (+p.cost_china||0) + (+p.ship_china_to_kenya||0);
    if (!agg[pid]) agg[pid] = { name: p.name||pid, pieces:0, ad:0, prodCost:0, profit:0 };
    agg[pid].pieces += (+x.pieces||0);
    agg[pid].ad     += (+x.adSpend||0);
    agg[pid].prodCost += base * (+x.pieces||0) + (+x.extraCostPerPiece||0)*(+x.pieces||0);
    agg[pid].profit += (+x.revenue||0) - (+x.adSpend||0) - ((base + (+x.extraCostPerPiece||0))*(+x.pieces||0));
  });
  const rows = Object.values(agg).sort((a,b)=>b.pieces-a.pieces).map(it=>`
    <tr><td>${it.name}</td><td>${it.pieces}</td><td>${nf(it.ad)}</td><td>${nf(it.prodCost)}</td><td>${nf(it.profit)}</td><td>${it.pieces?nf(it.profit/it.pieces):'0.00'}</td></tr>
  `).join('');
  $('#pfTable tbody').innerHTML = rows || '';
});

// Remittance add (uses extraCostPerPiece instead of CPD)
$('#rAdd')?.addEventListener('click', async ()=>{
  const payload = {
    start: $('#rStart').value, end: $('#rEnd').value,
    country: $('#rCountry').value, productId: $('#rProduct').value,
    orders:+($('#rOrders').value||0), pieces:+($('#rPieces').value||0),
    revenue:+($('#rRev').value||0), adSpend:+($('#rAds').value||0),
    extraCostPerPiece:+($('#rCPD').value||0)
  };
  if (!payload.start || !payload.end) return alert('Select dates');
  await api('/api/remittances', { method:'POST', body: JSON.stringify(payload) });
  alert('Remittance saved'); await refreshHome();
});

// ===================================================
// FINANCE
// ===================================================
async function renderFinance(){
  // categories
  const cats = await api('/api/finance/categories');
  state.financeCats = cats;
  $('#fcList').innerHTML = `Debits: ${cats.debits.join(', ')||'-'} | Credits: ${cats.credits.join(', ')||'-'}`;

  // fill select for entry add
  const catSelect = $('#feCat');
  catSelect.innerHTML = [
    '<option value="">Select category</option>',
    ...cats.debits.map(c=>`<option value="debit:${c}">DEBIT — ${c}</option>`),
    ...cats.credits.map(c=>`<option value="credit:${c}">CREDIT — ${c}</option>`),
  ].join('');

  // running balance
  try{
    const all = await api('/api/finance/entries');
    $('#runningBalance').textContent = nf(all.balance) + ' USD';
  }catch{
    $('#runningBalance').textContent = '0.00 USD';
  }
}

$('#fcAdd')?.addEventListener('click', async ()=>{
  const type = $('#fcType').value;
  const name = ($('#fcName').value||'').trim();
  if (!name) return;
  await api('/api/finance/categories', { method:'POST', body: JSON.stringify({ type, name }) });
  $('#fcName').value=''; await renderFinance();
});

$('#feAdd')?.addEventListener('click', async ()=>{
  const catVal = $('#feCat').value;
  if (!catVal) return alert('Pick a category');
  const [type, category] = catVal.split(':');
  const payload = {
    date: $('#feDate').value || todayISO(),
    type, category,
    amount:+($('#feAmt').value||0),
    note: $('#feNote').value
  };
  await api('/api/finance/entries', { method:'POST', body: JSON.stringify(payload) });
  alert('Entry added'); await renderFinance();
});

$('#feRun')?.addEventListener('click', async ()=>{
  const s=$('#fes').value, e=$('#fee').value, cats=$('#fef').value;
  const r = await api(`/api/finance/entries?start=${s||''}&end=${e||''}&categories=${encodeURIComponent(cats||'')}`);
  // period balance label
  $('#feBalance').textContent = 'Period balance: ' + nf(r.balance) + ' USD';
  const tbody = $('#feTable tbody');
  tbody.innerHTML = (r.entries||[]).map(x=>`
    <tr data-id="${x.id}">
      <td>${x.date}</td><td>${x.type.toUpperCase()}</td><td>${x.category}</td>
      <td>${nf(x.amount)}</td><td>${x.note||''}</td>
      <td><button class="btn outline del">Delete</button></td>
    </tr>`).join('');
  tbody.querySelectorAll('.del').forEach(b=>{
    b.onclick = async ()=>{
      const id = b.closest('tr').dataset.id;
      if (!confirm('Delete entry?')) return;
      await api('/api/finance/entries/'+id, { method:'DELETE' });
      b.closest('tr').remove();
      await renderFinance();
    };
  });
});

// ===================================================
// SETTINGS — Countries + Snapshot save/restore
// ===================================================
$('#ctyAdd')?.addEventListener('click', async ()=>{
  const name = ($('#cty').value||'').trim();
  if (!name) return;
  await api('/api/countries', { method:'POST', body: JSON.stringify({ name }) });
  const list = await api('/api/countries');
  state.countries = list.countries || [];
  fillSelects(); renderCountriesChips(); await refreshHome();
});

// Snapshots (manual)
$('#snapSave')?.addEventListener('click', async ()=>{
  const label = prompt('Name this snapshot (e.g. "Before Black Friday")');
  if (!label) return;
  await api('/api/snapshots', { method:'POST', body: JSON.stringify({ label }) });
  await loadSnapshots();
});
async function loadSnapshots(){
  const list = await api('/api/snapshots');
  const tbody = $('#snapTable tbody');
  tbody.innerHTML = (list.items||[]).map(s=>`
    <tr data-id="${s.id}">
      <td>${s.label}</td><td>${s.createdAt}</td>
      <td class="flex wrap">
        <button class="btn outline restore">Restore</button>
        <button class="btn outline del">Delete</button>
      </td></tr>`).join('');
  tbody.querySelectorAll('.restore').forEach(b=> b.onclick = async ()=>{
    const id = b.closest('tr').dataset.id;
    if (!confirm('Restore snapshot?')) return;
    await api('/api/snapshots/'+id+'/restore', { method:'POST' });
    alert('Restored'); location.reload();
  });
  tbody.querySelectorAll('.del').forEach(b=> b.onclick = async ()=>{
    const id = b.closest('tr').dataset.id;
    if (!confirm('Delete snapshot?')) return;
    await api('/api/snapshots/'+id, { method:'DELETE' });
    await loadSnapshots();
  });
}

// ===================================================
// To-Do (localStorage) + Weekly To-Do (localStorage)
// ===================================================
function loadTodos(){ return JSON.parse(localStorage.getItem('todos')||'[]'); }
function saveTodos(x){ localStorage.setItem('todos', JSON.stringify(x)); }
function renderTodos(){
  const listEl = $('#todoList'); if (!listEl) return;
  const items = loadTodos();
  listEl.innerHTML = items.map(it=>`
    <div class="flex">
      <span>${it.done?'✅ ':''}${it.text}</span>
      <span class="muted">${it.createdAt||''}</span>
      <span style="margin-left:auto"></span>
      <button class="btn outline tgl" data-id="${it.id}">${it.done?'Undo':'Done'}</button>
      <button class="btn outline del" data-id="${it.id}">Delete</button>
    </div>`).join('');
  $('#todoAdd').onclick = ()=>{
    const v = ($('#todoText').value||'').trim();
    if (!v) return;
    items.push({ id: Math.random().toString(36).slice(2), text:v, done:false, createdAt: new Date().toLocaleString() });
    saveTodos(items); $('#todoText').value=''; renderTodos();
  };
  listEl.querySelectorAll('.tgl').forEach(b=> b.onclick = ()=>{
    const it = items.find(x=>x.id===b.dataset.id); it.done=!it.done; saveTodos(items); renderTodos();
  });
  listEl.querySelectorAll('.del').forEach(b=> b.onclick = ()=>{
    const i = items.findIndex(x=>x.id===b.dataset.id); items.splice(i,1); saveTodos(items); renderTodos();
  });
}

function renderWeekly(){
  const key = 'weeklyTodos';
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const store = JSON.parse(localStorage.getItem(key)||'{}');
  const wrap = $('#weeklyWrap'); if (!wrap) return;
  wrap.innerHTML = '';
  days.forEach(day=>{
    const items = store[day]||[];
    const card = document.createElement('div'); card.className='card';
    card.innerHTML = `
      <div class="h">${day}</div>
      <div class="flex"><input id="w_${day}" class="input" placeholder="Task"><button class="btn">Add</button></div>
      <div class="list">${items.map(it=>`
        <div class="flex">
          <span>${it.done?'✅ ':''}${it.text}</span>
          <span class="muted">${it.createdAt||''}</span>
          <span style="margin-left:auto"></span>
          <button class="btn outline wtgl" data-key="${day}|${it.id}">${it.done?'Undo':'Done'}</button>
          <button class="btn outline wdel" data-key="${day}|${it.id}">Delete</button>
        </div>`).join('')}</div>`;
    wrap.appendChild(card);
    card.querySelector('button.btn').onclick = ()=>{
      const v = (card.querySelector(`#w_${day}`).value||'').trim(); if(!v) return;
      items.push({ id: Math.random().toString(36).slice(2), text:v, done:false, createdAt: new Date().toLocaleString() });
      store[day]=items; localStorage.setItem(key, JSON.stringify(store)); renderWeekly();
    };
  });
  wrap.querySelectorAll('.wtgl').forEach(b=> b.onclick = ()=>{
    const [day,id] = b.dataset.key.split('|');
    const store = JSON.parse(localStorage.getItem(key)||'{}');
    const it = (store[day]||[]).find(x=>x.id===id); if (!it) return;
    it.done=!it.done; localStorage.setItem(key, JSON.stringify(store)); renderWeekly();
  });
  wrap.querySelectorAll('.wdel').forEach(b=> b.onclick = ()=>{
    const [day,id] = b.dataset.key.split('|');
    const store = JSON.parse(localStorage.getItem(key)||'{}');
    const arr = store[day]||[]; const i = arr.findIndex(x=>x.id===id); if (i>=0) arr.splice(i,1);
    store[day]=arr; localStorage.setItem(key, JSON.stringify(store)); renderWeekly();
  });
}

// ===================================================
// NAV + LOGIN
// ===================================================
$$('.nav a[data-view]').forEach(a=>{
  a.onclick = (e)=>{
    e.preventDefault();
    setView(a.dataset.view);
    if (a.dataset.view==='products') renderProducts();
    if (a.dataset.view==='finance')  renderFinance();
    if (a.dataset.view==='settings') loadSnapshots();
  };
});

$('#loginBtn')?.addEventListener('click', async ()=>{
  const p = $('#pw').value;
  try{
    await api('/api/auth', { method:'POST', body: JSON.stringify({ password: p }) });
    await ensureMeta();
  }catch{ alert('Wrong password'); }
});

$('#logoutLink')?.addEventListener('click', async (e)=>{
  e.preventDefault();
  try{ await api('/api/logout', { method:'POST' }); }catch{}
  location.reload();
});

// ===================================================
// BOOT
// ===================================================
renderTodos();
renderWeekly();
ensureMeta();
