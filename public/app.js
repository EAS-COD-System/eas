/* =========================================================
   EAS Tracker - /public/app.js
   ========================================================= */

const state = {
  view: 'home',
  products: [],
  countries: [],
  currentProductId: null,
  cats: { debits: [], credits: [] }
};

// ------------- helpers -------------
const $  = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const sum = arr => arr.reduce((a,b)=>a+(+b||0),0);
const fmt = n => (Number(n||0)).toFixed(2) + ' USD';
const todayStr = () => new Date().toISOString().slice(0,10);
const weekdayName = d => new Date(d).toLocaleDateString(undefined,{weekday:'long'});

async function api(path, opts={}) {
  const res = await fetch(path, {
    credentials:'include',
    headers:{'Content-Type':'application/json'},
    ...opts
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const msg = (data && (data.error||data.message)) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data || {};
}

function setView(v){
  state.view=v;
  ['home','products','performance','finance','settings'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) el.style.display = id===v ? '' : 'none';
  });
  $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.view===v));
}

// ------------- boot/auth -------------
async function ensureMeta(){
  try{
    const m = await api('/api/meta');
    state.countries = m.countries || [];
    await Promise.all([loadProducts(), loadFinanceCats()]);
    $('#login')?.style && ($('#login').style.display='none');
    $('#main').style.display='';
    setView(state.view);
    fillSelects();
    renderCountriesChips();
    await refreshHome();
  }catch(e){
    $('#login')?.style && ($('#login').style.display='');
    $('#main').style.display='none';
    console.warn('Not authorized yet:', e.message);
  }
}
async function loadProducts(){
  try{
    const r = await api('/api/products');
    state.products = r.products || [];
  }catch{ state.products = []; }
}
async function loadFinanceCats(){
  try{
    const r = await api('/api/finance/categories');
    state.cats = { debits: r.debits||[], credits: r.credits||[] };
  }catch{
    state.cats = { debits: [], credits: [] };
  }
}

function fillSelects(){
  // countries
  const cSel = '#delivCountry,#adCountry,#mvFrom,#mvTo,#pfCountry,#rCountry,#pdAdCountry,#pdRCountry,#pdMvFrom,#pdMvTo,#pdInfCountry,#pdInfFilterCountry';
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
    const opts = (s.id==='lpProduct') ? ['<option value="">All products</option>'] : [];
    opts.push(...state.products.map(p=>`<option value="${p.id}">${p.name}${p.sku?` (${p.sku})`:''}</option>`));
    s.innerHTML = opts.join('');
  });

  // finance categories (single input -> turn into select)
  const feCat = $('#feCat');
  if (feCat && feCat.tagName.toLowerCase() === 'input') {
    const sel = document.createElement('select');
    sel.id = 'feCat';
    sel.className = 'input';
    sel.innerHTML = [
      '<option value="" disabled selected>Select category</option>',
      ...state.cats.debits.map(c=>`<option value="debit:${c}">${c} (debit)</option>`),
      ...state.cats.credits.map(c=>`<option value="credit:${c}">${c} (credit)</option>`),
    ].join('');
    feCat.parentNode.replaceChild(sel, feCat);
  }
}

function renderCountriesChips(){
  const wrap = $('#ctyList');
  if (!wrap) return;
  wrap.innerHTML = (state.countries||[]).map(c=>`<span class="badge" style="margin-right:6px">${c}</span>`).join('');
}

// ------------- DASHBOARD -------------
async function refreshHome(){
  // KPIs
  $('#kpiProducts').textContent = state.products.length;
  $('#kpiCountries').textContent = state.countries.length;

  // Transit
  try{
    const s = await api('/api/shipments');
    const inTransit = (s.shipments||[]).filter(x=>!x.arrivedAt).length;
    $('#kpiTransit').textContent = inTransit;
  }catch{ $('#kpiTransit').textContent='—'; }

  // Total ad spend (all time, per-country fix)
  await updateTotalAdSpendKPI();

  // Delivered (Mon–Sun) from weekly grid
  await renderWeeklyDeliveredGrid(true);

  // Stock + ad spend table
  await renderStockByCountry();

  // Transit tables
  await renderShipmentsTable('china-kenya', '#shipCKTable tbody');
  await renderShipmentsTable('intercountry', '#shipICTable tbody');
}

async function updateTotalAdSpendKPI(){
  try{
    const a = await api('/api/adspend');
    const total = sum((a.adSpends||[]).map(x=>+x.amount||0));
    $('#kpiAdSpend').textContent = Intl.NumberFormat().format(total) + ' USD';
  }catch{
    $('#kpiAdSpend').textContent = '—';
  }
}

async function renderStockByCountry(){
  const wrap = $('#stockByCountry'); if (!wrap) return;
  const per = {};
  state.countries.forEach(c=>per[c]={ stock:0, ad:0 });

  try{
    const s = await api('/api/shipments');
    (s.shipments||[]).forEach(sp=>{
      const to = sp.toCountry || sp.to;
      if (sp.arrivedAt && to){
        per[to] = per[to] || {stock:0, ad:0};
        per[to].stock += (+sp.qty||0);
      }
    });
  }catch{}

  try{
    const r = await api('/api/remittances');
    (r.remittances||[]).forEach(x=>{
      if(!x.country) return;
      per[x.country] = per[x.country] || {stock:0, ad:0};
      per[x.country].stock -= (+x.pieces||0);
    });
  }catch{}

  try{
    const a = await api('/api/adspend');
    (a.adSpends||[]).forEach(ad=>{
      if(!ad.country) return;
      per[ad.country] = per[ad.country] || {stock:0, ad:0};
      per[ad.country].ad += (+ad.amount||0);
    });
  }catch{}

  const rows = Object.entries(per).map(([c,v]) =>
    `<tr><td>${c}</td><td>${v.stock}</td><td>${(v.ad||0).toFixed(2)} USD</td></tr>`
  ).join('');
  wrap.innerHTML = `
    <h2>Total Stock & Ad Spend by Country</h2>
    <table class="table">
      <thead><tr><th>Country</th><th>Approx. Stock</th><th>Total Ad Spend</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/* -------- Weekly Delivered Grid (Mon–Sun x Country) ---------
   Storage model: uses /api/deliveries/current-week for read aggregation.
   Edits: each cell change writes a delivery record with that date/country.
   Reset: writes zeros across existing filled cells for this week.
---------------------------------------------------------------- */
const WD_DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
function mondayOf(d){
  const x=new Date(d); const day=(x.getDay()+6)%7; // Monday=0
  x.setDate(x.getDate()-day); x.setHours(0,0,0,0); return x;
}
function dateOfWeekday(weekStart, idx){
  const d = new Date(weekStart);
  d.setDate(d.getDate()+idx);
  return d.toISOString().slice(0,10);
}

async function renderWeeklyDeliveredGrid(updateKPIOnly=false){
  // week anchor = current week Monday
  const wkStart = mondayOf(new Date());
  const wkDates = WD_DAYS.map((_,i)=>dateOfWeekday(wkStart,i));
  let data;
  try{
    // Expect aggregated structure: { days: {YYYY-MM-DD: total}, perCountry: { country: {date:count} } }
    data = await api('/api/deliveries/current-week');
  }catch{
    if (updateKPIOnly) { $('#kpiDelivered').textContent='—'; return; }
    $('#dailyDelivered').querySelector('#delivTable tbody').innerHTML='';
    return;
  }

  // KPI (Mon–Sun sum)
  const weekTotal = Object.values(data.days||{}).reduce((a,b)=>a+(+b||0),0);
  $('#kpiDelivered').textContent = weekTotal;

  if (updateKPIOnly) return;

  // Build editable grid
  const countries = state.countries.slice();
  const perCountry = data.perCountry || {}; // { country: {YYYY-MM-DD: n} }

  const thead = `
    <thead>
      <tr><th>Country</th>${WD_DAYS.map(d=>`<th>${d}</th>`).join('')}<th>Total</th></tr>
    </thead>`;

  const bodyRows = countries.map(c=>{
    const rowTotals = [];
    const tds = WD_DAYS.map((d,i)=>{
      const dt = wkDates[i];
      const val = perCountry?.[c]?.[dt] ?? 0;
      rowTotals.push(+val||0);
      return `<td>
        <input class="input wd-cell" data-country="${c}" data-date="${dt}" value="${val}" type="number" min="0" style="min-width:70px" />
      </td>`;
    }).join('');
    return `<tr>
      <th>${c}</th>
      ${tds}
      <td class="wd-row-total">${sum(rowTotals)}</td>
    </tr>`;
  }).join('');

  const colTotals = WD_DAYS.map((_,i)=>{
    const dt = wkDates[i];
    let t=0;
    for (const c of countries) t += +((perCountry?.[c]?.[dt])||0);
    return t;
  });

  const tfoot = `
    <tfoot>
      <tr class="wd-foot">
        <th>All Countries</th>
        ${colTotals.map(n=>`<td>${n}</td>`).join('')}
        <td id="wdAllTotal">${sum(colTotals)}</td>
      </tr>
    </tfoot>`;

  const host = $('#dailyDelivered');
  let grid = host.querySelector('#weeklyDelivered');
  if (!grid){
    grid = document.createElement('div');
    grid.id = 'weeklyDelivered';
    grid.className = 'section';
    host.appendChild(grid);
  }
  grid.innerHTML = `
    <h2>Delivered This Week (Mon–Sun)</h2>
    <div class="card">
      <div class="flex">
        <button id="wdSave" class="btn">Save Changes</button>
        <button id="wdReset" class="btn outline">Reset Week</button>
        <span class="badge">Week of ${wkDates[0]} → ${wkDates[6]}</span>
      </div>
    </div>
    <table class="table" style="margin-top:10px">
      ${thead}
      <tbody>${bodyRows}</tbody>
      ${tfoot}
    </table>
  `;

  // recalc row/col totals on input
  $$('.wd-cell').forEach(inp=>{
    inp.addEventListener('input', ()=>{
      // row total
      const tr = inp.closest('tr');
      const cells = Array.from(tr.querySelectorAll('.wd-cell'));
      const rt = cells.reduce((a,b)=>a+(+b.value||0),0);
      tr.querySelector('.wd-row-total').textContent = rt;
      // col total
      const idx = Array.from(tr.children).indexOf(inp.parentElement)-1; // after <th>
      const colVals = $$('.wd-cell').filter(x=>Array.from(x.parentElement.parentElement.children).indexOf(x.parentElement)===idx);
      const ct = colVals.reduce((a,b)=>a+(+b.value||0),0);
      const foot = grid.querySelector('tfoot tr');
      foot.children[idx+1].textContent = ct;
      // grand total
      const newCols = Array.from(foot.children).slice(1,-1).map(td=>+td.textContent||0);
      foot.lastElementChild.textContent = sum(newCols);
    });
  });

  // Save -> upsert each non-empty cell for the week
  $('#wdSave').onclick = async ()=>{
    try{
      const cells = $$('.wd-cell');
      const payloads = [];
      for (const c of cells){
        const delivered = +c.value||0;
        const country = c.dataset.country;
        const date = c.dataset.date;
        // write even zeros to normalize week
        payloads.push(api('/api/deliveries', { method:'POST', body: JSON.stringify({ date, country, delivered })}));
      }
      await Promise.all(payloads);
      alert('Weekly deliveries saved');
      await refreshHome();
    }catch(e){
      alert('Save error: '+e.message);
    }
  };

  // Reset -> zero all cells of this week (no hard delete needed)
  $('#wdReset').onclick = async ()=>{
    if (!confirm('Reset this week to zeros for all countries?')) return;
    try{
      const cells = $$('.wd-cell');
      await Promise.all(cells.map(c=>{
        return api('/api/deliveries', { method:'POST', body: JSON.stringify({ date:c.dataset.date, country:c.dataset.country, delivered:0 })});
      }));
      await renderWeeklyDeliveredGrid(false);
      await refreshHome();
    }catch(e){
      alert('Reset error: '+e.message);
    }
  };
}

// ---- Daily Advertising Spend (no date; upsert) ----
$('#adAdd') && ($('#adAdd').onclick = async ()=>{
  const payload = {
    platform: $('#adPlatform').value,
    productId: $('#adProduct').value,
    country: $('#adCountry').value,
    amount: +($('#adAmount').value||0)
  };
  if(!payload.productId || !payload.country) return alert('Select product and country');
  try{
    await api('/api/adspend', { method:'POST', body: JSON.stringify(payload) }); // backend upserts by (productId,country,platform)
    alert('Saved');
    await updateTotalAdSpendKPI();
    await renderStockByCountry(); // so totals reflect
    if (state.currentProductId) await loadProductDetails(state.currentProductId);
  }catch(e){
    alert('Ad spend error: '+e.message);
  }
});

// ---- Stock Movement (create shipment in transit) ----
$('#mvAdd') && ($('#mvAdd').onclick = async ()=>{
  const payload = {
    productId: $('#mvProduct').value,
    fromCountry: $('#mvFrom').value,
    toCountry: $('#mvTo').value,
    qty: +($('#mvQty').value||0),
    shipCost: +($('#mvShip').value||0),
    departedAt: todayStr(),
    arrivedAt: null
  };
  if(!payload.productId) return alert('Select product');
  try{
    await api('/api/shipments', { method:'POST', body: JSON.stringify(payload) });
    alert('Movement saved'); await refreshHome();
  }catch(e){ alert('Movement error: '+e.message); }
});

// ---- Transit tables (mark arrived, edit qty/shipCost inline) ----
async function renderShipmentsTable(type, sel){
  const body = $(sel); if (!body) return;
  try{
    const r = await api('/api/shipments');
    const productsById = Object.fromEntries((state.products||[]).map(p=>[p.id,p]));
    let list = r.shipments||[];
    const isCK = s=>{
      const f=(s.fromCountry||s.from||'').toLowerCase(), t=(s.toCountry||s.to||'').toLowerCase();
      return f==='china' && t==='kenya';
    };
    list = type==='china-kenya' ? list.filter(isCK) : list.filter(s=>!isCK(s));

    body.innerHTML = list.map(sp=>`
      <tr data-id="${sp.id}">
        <td>${sp.id}</td>
        <td>${productsById[sp.productId]?.name || sp.productId}</td>
        <td>${(sp.fromCountry||sp.from)} → ${(sp.toCountry||sp.to)}</td>
        <td><input class="input ship-edit qty" type="number" min="0" value="${sp.qty||0}"/></td>
        <td><input class="input ship-edit cost" type="number" min="0" step="0.01" value="${sp.shipCost||0}"/></td>
        <td>${sp.departedAt||''}</td>
        <td class="arrive">${sp.arrivedAt||''}${sp.arrivedAt && sp.departedAt ? ` <span class="badge">${daysBetween(sp.departedAt, sp.arrivedAt)}d</span>`:''}</td>
        <td>
          <button class="btn outline" data-mark="${sp.id}">Mark Arrived</button>
          <button class="btn outline" data-save="${sp.id}">Save</button>
          <button class="btn outline" data-del="${sp.id}">Delete</button>
        </td>
      </tr>
    `).join('');

    // handlers
    body.querySelectorAll('[data-mark]').forEach(b=> b.onclick = async ()=>{
      const id=b.dataset.mark;
      let d = prompt('Arrival date (YYYY-MM-DD). Leave blank for today.');
      if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) d = todayStr();
      try{
        const res = await api('/api/shipments/'+id, { method:'PUT', body: JSON.stringify({ arrivedAt:d }) });
        // update days
        const tr = body.querySelector(`tr[data-id="${id}"]`);
        tr.querySelector('.arrive').innerHTML = `${d} <span class="badge">${daysBetween(res.departedAt||todayStr(), d)}d</span>`;
      }catch(e){ alert('Mark arrived error: '+e.message); }
    });
    body.querySelectorAll('[data-save]').forEach(b=> b.onclick = async ()=>{
      const tr = b.closest('tr'); const id=b.dataset.save;
      const qty = +tr.querySelector('input.qty').value||0;
      const shipCost = +tr.querySelector('input.cost').value||0;
      try{
        await api('/api/shipments/'+id, { method:'PUT', body: JSON.stringify({ qty, shipCost }) });
        alert('Saved shipment');
      }catch(e){ alert('Update error: '+e.message); }
    });
    body.querySelectorAll('[data-del]').forEach(b=> b.onclick = async ()=>{
      if(!confirm('Delete shipment?')) return;
      try{ await api('/api/shipments/'+b.dataset.del, { method:'DELETE' }); await renderShipmentsTable(type, sel); }
      catch(e){ alert('Delete error: '+e.message); }
    });
  }catch{ body.innerHTML=''; }
}
function daysBetween(a,b){
  const A=new Date(a), B=new Date(b);
  return Math.max(0, Math.round((B-A)/86400000));
}

// ------------- LIFETIME PRODUCTS (global) -------------
$('#lpRun') && ($('#lpRun').onclick = async ()=>{
  const pid = $('#lpProduct').value || null;
  const s = $('#lpStart').value, e=$('#lpEnd').value;
  try{
    const rem = await api(`/api/remittances${(s||e)?`?${[s?`start=${s}`:'', e?`end=${e}`:''].filter(Boolean).join('&')}`:''}`);
    const ship = await api('/api/shipments');
    const P = Object.fromEntries((state.products||[]).map(p=>[p.id,p]));
    const acc = {}; // id -> { revenue, ad, ship, base, pieces }

    (rem.remittances||[]).filter(r=>!pid || r.productId===pid).forEach(r=>{
      const id=r.productId; const p=P[id]||{};
      if(!acc[id]) acc[id]={ revenue:0, ad:0, ship:0, base:0, pieces:0 };
      acc[id].revenue += +r.revenue||0;
      acc[id].ad += +r.adSpend||0;
      acc[id].pieces += +r.pieces||0;
      const baseUnit = (+p.cost_china||0) + (+p.ship_china_to_kenya||0);
      acc[id].base += baseUnit * (+r.pieces||0);
    });
    (ship.shipments||[]).filter(sx=>sx.arrivedAt && (!pid || sx.productId===pid)).forEach(sx=>{
      const id=sx.productId;
      if(!acc[id]) acc[id]={ revenue:0, ad:0, ship:0, base:0, pieces:0 };
      acc[id].ship += +sx.shipCost||0;
    });

    const tbody = $('#lifetimeTable tbody'); if (!tbody) return;
    tbody.innerHTML = Object.entries(acc).map(([id,v])=>{
      const name = P[id]?.name || id;
      const profit = v.revenue - v.ad - v.ship - v.base;
      return `<tr><td>${name}</td><td>${v.revenue.toFixed(2)}</td><td>${v.ad.toFixed(2)}</td><td>${v.ship.toFixed(2)}</td><td>${v.base.toFixed(2)}</td><td>${v.pieces}</td><td>${profit.toFixed(2)}</td></tr>`;
    }).join('');
  }catch(e){
    alert('Lifetime run error: '+e.message);
    const tbody = $('#lifetimeTable tbody'); if (tbody) tbody.innerHTML='';
  }
});

// ------------- PRODUCTS -------------
async function renderProducts(){
  let res; try{ res = await api('/api/products'); }catch{ res = {products:[]} }
  state.products = res.products||[];
  const tbody = $('#productsTable tbody'); if (!tbody) return;
  tbody.innerHTML = state.products.map(p=>`
    <tr data-id="${p.id}">
      <td>${p.name}</td>
      <td>${p.sku||'-'}</td>
      <td><span class="badge">${p.status||'active'}</span></td>
      <td>
        <button class="btn outline" data-open="${p.id}">Open</button>
        <button class="btn outline" data-pause="${p.id}">${p.status==='active'?'Pause':'Run'}</button>
        <button class="btn outline" data-del="${p.id}">Delete</button>
      </td>
    </tr>`).join('');

  tbody.querySelectorAll('[data-open]').forEach(b=> b.onclick = async ()=>{
    state.currentProductId = b.dataset.open;
    await openProductDetails(state.currentProductId);
  });
  tbody.querySelectorAll('[data-pause]').forEach(b=> b.onclick = async ()=>{
    const id=b.dataset.pause; const p=state.products.find(x=>x.id===id);
    const ns = p.status==='active'?'paused':'active';
    await api(`/api/products/${id}/status`, { method:'POST', body: JSON.stringify({ status: ns })});
    await renderProducts(); await refreshHome();
  });
  tbody.querySelectorAll('[data-del]').forEach(b=> b.onclick = async ()=>{
    if(!confirm('Delete product?')) return;
    await api('/api/products/'+b.dataset.del, { method:'DELETE' });
    await renderProducts(); await refreshHome();
  });
}

async function openProductDetails(id){
  setView('products');
  $('#productDetails').style.display='';
  await loadProductDetails(id);
}
async function loadProductDetails(id){
  // Stock & ad spend by country for this product
  const P = state.products.find(p=>p.id===id);
  $('#productDetails').querySelector('h3').textContent = `Product Details – ${P?.name||id}`;

  // Fill selects for product context
  $('#pdRCountry') && ( $('#pdRCountry').innerHTML = state.countries.map(c=>`<option value="${c}">${c}</option>`).join('') );
  $('#pdMvFrom') && ( $('#pdMvFrom').innerHTML = state.countries.map(c=>`<option value="${c}">${c}</option>`).join('') );
  $('#pdMvTo') && ( $('#pdMvTo').innerHTML = state.countries.map(c=>`<option value="${c}">${c}</option>`).join('') );
  $('#pdAdCountry') && ( $('#pdAdCountry').innerHTML = state.countries.map(c=>`<option value="${c}">${c}</option>`).join('') );
  $('#pdInfCountry') && ( $('#pdInfCountry').innerHTML = state.countries.map(c=>`<option value="${c}">${c}</option>`).join('') );
  $('#pdInfSelect') && ( $('#pdInfSelect').innerHTML = '<option value="" disabled selected>Select influencer</option>' );

  // compute per-country stock/ad
  const per = {}; state.countries.forEach(c=>per[c]={ stock:0, ad:0 });
  try{
    const s = await api('/api/shipments');
    (s.shipments||[]).filter(x=>x.productId===id && x.arrivedAt).forEach(sp=>{
      const to = sp.toCountry || sp.to; if(!to) return;
      per[to] = per[to] || {stock:0, ad:0}; per[to].stock += (+sp.qty||0);
    });
  }catch{}
  try{
    const rem = await api('/api/remittances');
    (rem.remittances||[]).filter(x=>x.productId===id).forEach(r=>{
      per[r.country] = per[r.country] || {stock:0, ad:0};
      per[r.country].stock -= (+r.pieces||0);
      per[r.country].ad += (+r.adSpend||0);
    });
  }catch{}

  $('#pdStockByCountry').innerHTML = `
    <table class="table">
      <thead><tr><th>Country</th><th>Approx. Stock</th><th>Total Ad Spend</th></tr></thead>
      <tbody>${Object.entries(per).map(([c,v])=>`<tr><td>${c}</td><td>${v.stock}</td><td>${(v.ad||0).toFixed(2)} USD</td></tr>`).join('')}</tbody>
    </table>`;

  // product daily ad spend add (upsert)
  $('#pdAdSave') && ($('#pdAdSave').onclick = async ()=>{
    const payload = {
      platform: $('#pdAdPlatform').value,
      productId: id,
      country: $('#pdAdCountry').value,
      amount: +($('#pdAdAmount').value||0)
    };
    try{
      await api('/api/adspend', { method:'POST', body: JSON.stringify(payload) });
      alert('Spend saved'); await loadProductDetails(id); await refreshHome();
    }catch(e){ alert('Ad spend error: '+e.message); }
  });

  // remittance add (NOTE: “extra cost to deliver per piece” replaces CPD)
  $('#pdRAdd') && ($('#pdRAdd').onclick = async ()=>{
    const payload = {
      start: $('#pdRStart').value, end: $('#pdREnd').value,
      country: $('#pdRCountry').value, productId: id,
      orders: +($('#pdROrders').value||0), pieces:+($('#pdRPieces').value||0),
      revenue:+($('#pdRRevenue').value||0), adSpend:+($('#pdRAdSpend').value||0),
      extraCostPerPiece:+($('#pdRCPD').value||0) // renamed usage in backend required
    };
    if(!payload.start || !payload.end) return alert('Select dates');
    try{
      await api('/api/remittances', { method:'POST', body: JSON.stringify(payload) });
      alert('Remittance saved'); await refreshHome();
    }catch(e){ alert('Remittance error: '+e.message); }
  });

  // product shipments tables
  await renderProductShipments(id, true);
  await renderProductShipments(id, false);

  // product move
  $('#pdMvAdd') && ($('#pdMvAdd').onclick = async ()=>{
    const payload = {
      productId: id,
      fromCountry: $('#pdMvFrom').value,
      toCountry: $('#pdMvTo').value,
      qty: +($('#pdMvQty').value||0),
      shipCost: +($('#pdMvShip').value||0),
      departedAt: todayStr(),
      arrivedAt: null
    };
    try{
      await api('/api/shipments', { method:'POST', body: JSON.stringify(payload) });
      alert('Movement saved'); await renderProductShipments(id,true); await renderProductShipments(id,false); await refreshHome();
    }catch(e){ alert('Move error: '+e.message); }
  });

  // lifetime (this product)
  $('#pdLPRun') && ($('#pdLPRun').onclick = async ()=>{
    const s=$('#pdLPStart').value, e=$('#pdLPEnd').value;
    try{
      const rem = await api(`/api/remittances${(s||e)?`?${[s?`start=${s}`:'', e?`end=${e}`:''].filter(Boolean).join('&')}`:''}`);
      const ship = await api('/api/shipments');
      const p = state.products.find(x=>x.id===id) || {};
      let revenue=0, ad=0, shipCost=0, pieces=0, base=0;
      (rem.remittances||[]).filter(r=>r.productId===id).forEach(r=>{
        revenue += +r.revenue||0;
        ad      += +r.adSpend||0;
        pieces  += +r.pieces||0;
        base    += ((+p.cost_china||0)+(+p.ship_china_to_kenya||0))*(+r.pieces||0);
      });
      (ship.shipments||[]).filter(sx=>sx.arrivedAt && sx.productId===id).forEach(sx=>{
        shipCost += +sx.shipCost||0;
      });
      const profit = revenue - ad - shipCost - base;
      $('#pdLPTableWrap').innerHTML = `
        <table class="table">
          <thead><tr><th>Revenue</th><th>Ad Spend</th><th>Shipping</th><th>Base Cost</th><th>Pieces</th><th>Profit</th></tr></thead>
          <tbody><tr><td>${revenue.toFixed(2)}</td><td>${ad.toFixed(2)}</td><td>${shipCost.toFixed(2)}</td><td>${base.toFixed(2)}</td><td>${pieces}</td><td>${profit.toFixed(2)}</td></tr></tbody>
        </table>`;
    }catch(e){ alert('Product lifetime error: '+e.message); }
  });

  // TODO: Influencers section—wires to backend if present
}

async function renderProductShipments(id, chinaKenya){
  const sel = chinaKenya ? '#pdShipCK tbody' : '#pdShipIC tbody';
  const body = $(sel); if (!body) return;
  try{
    const r = await api('/api/shipments');
    const isCK = s=>{
      const f=(s.fromCountry||s.from||'').toLowerCase(), t=(s.toCountry||s.to||'').toLowerCase();
      return f==='china' && t==='kenya';
    };
    let list = (r.shipments||[]).filter(x=>x.productId===id);
    list = chinaKenya ? list.filter(isCK) : list.filter(s=>!isCK(s));

    body.innerHTML = list.map(sp=>`
      <tr data-id="${sp.id}">
        <td>${sp.id}</td>
        <td>${(sp.fromCountry||sp.from)} → ${(sp.toCountry||sp.to)}</td>
        <td><input class="input ship-edit qty" type="number" min="0" value="${sp.qty||0}"/></td>
        <td><input class="input ship-edit cost" type="number" min="0" step="0.01" value="${sp.shipCost||0}"/></td>
        <td>${sp.departedAt||''}</td>
        <td class="arrive">${sp.arrivedAt||''}${sp.arrivedAt && sp.departedAt ? ` <span class="badge">${daysBetween(sp.departedAt, sp.arrivedAt)}d</span>`:''}</td>
        <td>
          <button class="btn outline" data-mark="${sp.id}">Mark Arrived</button>
          <button class="btn outline" data-save="${sp.id}">Save</button>
          <button class="btn outline" data-del="${sp.id}">Delete</button>
        </td>
      </tr>`).join('');

    body.querySelectorAll('[data-mark]').forEach(b=> b.onclick = async ()=>{
      let d = prompt('Arrival date (YYYY-MM-DD). Leave blank for today.');
      if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) d = todayStr();
      try{
        const res = await api('/api/shipments/'+b.dataset.mark, { method:'PUT', body: JSON.stringify({ arrivedAt:d }) });
        await renderProductShipments(id, chinaKenya);
        await refreshHome();
      }catch(e){ alert('Mark arrived error: '+e.message); }
    });
    body.querySelectorAll('[data-save]').forEach(b=> b.onclick = async ()=>{
      const tr=b.closest('tr'); const qty=+tr.querySelector('input.qty').value||0; const shipCost=+tr.querySelector('input.cost').value||0;
      try{
        await api('/api/shipments/'+b.dataset.save, { method:'PUT', body: JSON.stringify({ qty, shipCost }) });
        alert('Saved'); await renderProductShipments(id, chinaKenya);
      }catch(e){ alert('Update error: '+e.message); }
    });
    body.querySelectorAll('[data-del]').forEach(b=> b.onclick = async ()=>{
      if(!confirm('Delete shipment?')) return;
      try{ await api('/api/shipments/'+b.dataset.del, { method:'DELETE' }); await renderProductShipments(id, chinaKenya); await refreshHome(); }
      catch(e){ alert('Delete error: '+e.message); }
    });
  }catch{ body.innerHTML=''; }
}

// ------------- PERFORMANCE -------------
$('#pfRun') && ($('#pfRun').onclick = async ()=>{
  const quick = $('#pfQuick').value;
  let s = $('#pfStart').value, e = $('#pfEnd').value;
  if (quick==='8') { const d=new Date(); d.setDate(d.getDate()-7); s=d.toISOString().slice(0,10); e=todayStr(); }
  if (quick==='28'){ const d=new Date(); d.setDate(d.getDate()-27); s=d.toISOString().slice(0,10); e=todayStr(); }
  const c = $('#pfCountry').value;

  try{
    const qs = [s?`start=${s}`:'', e?`end=${e}`:'', c?`country=${encodeURIComponent(c)}`:''].filter(Boolean).join('&');
    const r = await api(`/api/remittances${qs?`?${qs}`:''}`);
    const P = Object.fromEntries((state.products||[]).map(p=>[p.id,p]));
    const agg = {}; // id -> { pieces, ad, prodCost, profit, name }

    (r.remittances||[]).forEach(x=>{
      const id=x.productId; const p=P[id]||{cost_china:0, ship_china_to_kenya:0};
      if (!agg[id]) agg[id]={ pieces:0, ad:0, prodCost:0, profit:0, name:P[id]?.name||id };
      agg[id].pieces += (+x.pieces||0);
      agg[id].ad     += (+x.adSpend||0);
      const base = (+p.cost_china||0)+(+p.ship_china_to_kenya||0);
      agg[id].prodCost += base*(+x.pieces||0) + ((+x.extraCostPerPiece||0) * (+x.pieces||0));
      const profit = (+x.revenue||0) - (+x.adSpend||0) - (base*(+x.pieces||0)) - ((+x.extraCostPerPiece||0) * (+x.pieces||0));
      agg[id].profit += profit;
    });

    const tbody = $('#pfTable tbody');
    tbody.innerHTML = Object.values(agg).sort((a,b)=>b.pieces-a.pieces).map(it=>`
      <tr><td>${it.name}</td><td>${it.pieces}</td><td>${it.ad.toFixed(2)}</td><td>${it.prodCost.toFixed(2)}</td><td>${it.profit.toFixed(2)}</td><td>${it.pieces? (it.profit/it.pieces).toFixed(2):'0.00'}</td></tr>
    `).join('');
  }catch(e){
    alert('Top delivered error: '+e.message);
    $('#pfTable tbody').innerHTML='';
  }
});

// Remittance add (Performance page) — note extraCostPerPiece replaces CPD
$('#rAdd') && ($('#rAdd').onclick = async ()=>{
  const payload = {
    start: $('#rStart').value, end: $('#rEnd').value,
    country: $('#rCountry').value, productId: $('#rProduct').value,
    orders: +($('#rOrders').value||0), pieces:+($('#rPieces').value||0),
    revenue:+($('#rRev').value||0), adSpend:+($('#rAds').value||0),
    extraCostPerPiece:+($('#rCPD').value||0)
  };
  if(!payload.start || !payload.end) return alert('Select dates');
  try{
    await api('/api/remittances',{ method:'POST', body: JSON.stringify(payload) });
    alert('Remittance saved');
    await refreshHome();
  }catch(e){ alert('Remittance error: '+e.message); }
});

// ------------- FINANCE -------------
function detectTypeFromCat(catVal){
  // catVal format: "debit:Facebook Ads" or "credit:Revenue Boxleo"
  if (!catVal) return null;
  return catVal.startsWith('credit:') ? 'credit' : 'debit';
}
async function refreshFinanceBalance(){
  try{
    const r = await api('/api/finance/entries');
    const bal = +r.balance || 0;
    const box = document.querySelector('.fin-balance .value');
    if (box) box.textContent = fmt(bal).replace(' USD','');
  }catch{}
}
$('#fcAdd') && ($('#fcAdd').onclick = async ()=>{
  const type = $('#fcType').value;
  const name = $('#fcName').value.trim();
  if (!name) return;
  try{
    await api('/api/finance/categories', { method:'POST', body: JSON.stringify({ type, name }) });
    await loadFinanceCats(); fillSelects();
    $('#fcName').value='';
  }catch(e){ alert('Category add error: '+e.message); }
});
$('#feAdd') && ($('#feAdd').onclick = async ()=>{
  const date = $('#feDate').value || todayStr();
  const catVal = $('#feCat').value;
  const type = detectTypeFromCat(catVal);
  if (!type) return alert('Pick a category');
  const category = catVal.split(':',2)[1];
  const amount = +($('#feAmt').value||0);
  const note = $('#feNote').value;
  try{
    await api('/api/finance/entries', { method:'POST', body: JSON.stringify({ date, type, category, amount, note }) });
    alert('Entry saved'); $('#feNote').value=''; $('#feAmt').value='';
    await refreshFinanceBalance();
  }catch(e){ alert('Entry error: '+e.message); }
});
$('#feRun') && ($('#feRun').onclick = async ()=>{
  const s=$('#fes').value, e=$('#fee').value, cats=$('#fef').value;
  try{
    const r = await api(`/api/finance/entries?start=${s||''}&end=${e||''}&categories=${encodeURIComponent(cats||'')}`);
    $('#feBalance').textContent = 'End Balance: ' + (r.balance||0).toFixed(2) + ' USD';
    const tbody = $('#feTable tbody');
    tbody.innerHTML = (r.entries||[]).map(x=>`
      <tr>
        <td>${x.date}</td><td>${x.type}</td><td>${x.category}</td><td>${x.amount}</td><td>${x.note||''}</td>
        <td><button class="btn outline" data-del-entry="${x.id}">Delete</button></td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-del-entry]').forEach(b=> b.onclick = async ()=>{
      if(!confirm('Delete this entry?')) return;
      try{
        await api('/api/finance/entries/'+b.dataset.delEntry, { method:'DELETE' });
        b.closest('tr').remove();
        await refreshFinanceBalance();
      }catch(e){ alert('Delete error: '+e.message); }
    });
  }catch(e){
    alert('Finance run error: '+e.message);
  }
});

// ------------- SETTINGS -------------
$('#ctyAdd') && ($('#ctyAdd').onclick = async ()=>{
  const name = ($('#cty').value||'').trim(); if(!name) return;
  try{
    await api('/api/countries', { method:'POST', body: JSON.stringify({ name }) });
    const list = await api('/api/countries');
    state.countries = list.countries||[]; fillSelects(); renderCountriesChips();
    alert('Country added across the system');
  }catch(e){ alert('Country add error: '+e.message); }
});

// Inline product editor in Settings
(function mountProductEditor(){
  const wrap = $('#editProductWrap'); if (!wrap) return;
  wrap.innerHTML = `
    <div class="flex" style="margin-bottom:8px">
      <select id="epSel" class="input"></select>
      <button id="epLoad" class="btn">Load</button>
    </div>
    <div id="epForm" class="card" style="display:none">
      <div class="flex">
        <input id="epName" class="input" placeholder="Product name"/>
        <input id="epSku" class="input" placeholder="SKU"/>
        <input id="epCost" type="number" class="input" placeholder="Cost from China" step="0.01"/>
        <input id="epShip" type="number" class="input" placeholder="Ship China→Kenya" step="0.01"/>
        <input id="epMB" type="number" class="input" placeholder="Profit + Ads Budget" step="0.01"/>
        <button id="epSave" class="btn">Save</button>
      </div>
    </div>
  `;
  const epSel = $('#epSel');
  const fill = ()=> epSel.innerHTML = (state.products||[]).map(p=>`<option value="${p.id}">${p.name}${p.sku?` (${p.sku})`:''}</option>`).join('');
  fill();
  $('#epLoad').onclick = ()=>{
    const id = epSel.value; const p = state.products.find(x=>x.id===id);
    if(!p) return;
    $('#epForm').style.display='';
    $('#epName').value = p.name||'';
    $('#epSku').value  = p.sku||'';
    $('#epCost').value = p.cost_china||0;
    $('#epShip').value = p.ship_china_to_kenya||0;
    $('#epMB').value   = p.margin_budget||0;
    $('#epSave').onclick = async ()=>{
      try{
        await api('/api/products/'+id, { method:'PUT', body: JSON.stringify({
          name: $('#epName').value,
          sku: $('#epSku').value,
          cost_china: +$('#epCost').value||0,
          ship_china_to_kenya: +$('#epShip').value||0,
          margin_budget: +$('#epMB').value||0
        })});
        alert('Product updated');
        await loadProducts(); fill(); await refreshHome();
      }catch(e){ alert('Save error: '+e.message); }
    };
  };
})();

// Restore
$$('.restore').forEach(b=> b.onclick = async ()=>{
  const win = b.dataset.win;
  try{
    const r = await api('/api/restore', { method:'POST', body: JSON.stringify({ window: win }) });
    if (!r.ok) throw new Error(r.error||'No snapshot');
    alert('Restored from: '+r.restoredFrom);
    location.reload();
  }catch(e){
    alert('Restore error: '+(e.message||'No snapshots found'));
  }
});

// ------------- NAV & LOGIN -------------
$$('.nav a[data-view]').forEach(a=> a.onclick = (e)=>{
  e.preventDefault();
  setView(a.dataset.view);
  if(a.dataset.view==='products') renderProducts();
  if(a.dataset.view==='finance') refreshFinanceBalance();
});

$('#logoutLink') && ($('#logoutLink').onclick = async (e)=>{
  e.preventDefault();
  try{ await api('/api/logout',{ method:'POST' }) }catch{}
  location.reload();
});

$('#loginBtn') && ($('#loginBtn').onclick = async ()=>{
  const p = $('#pw').value || '';
  try{
    await api('/api/auth', { method:'POST', body: JSON.stringify({ password:p }) });
    await ensureMeta();
  }catch(e){
    alert('Wrong password');
  }
});

// ------------- boot -------------
ensureMeta();
