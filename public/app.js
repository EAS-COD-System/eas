/* =========================
   EAS Tracker – Front-end
   Shared for index.html and product.html
   ========================= */

/* ---------- tiny helpers ---------- */
const Q  = (s, r=document) => r.querySelector(s);
const QA = (s, r=document) => Array.from(r.querySelectorAll(s));
const fmt = n => (Number(n||0)).toLocaleString(undefined,{maximumFractionDigits:2});
const todayISO = () => new Date().toISOString().slice(0,10);
const getQuery = k => new URLSearchParams(location.search).get(k);
const sleep = ms => new Promise(r=>setTimeout(r,ms));

async function api(path, opts={}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  const ct = res.headers.get('content-type')||'';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data?.error || data || ('HTTP '+res.status));
  return data;
}

/* ---------- global state ---------- */
const state = {
  countries: [],
  products: [],
  categories: { debit: [], credit: [] },
  productId: getQuery('id'),
  product: null,

  // weekly grid cache
  weekDays: [], // Monday..Sunday ISO
};

/* ================================================================
   AUTH + BOOT
   ================================================================ */
async function gate() {
  try {
    const meta = await api('/api/meta');            // if unauthorized => 403
    state.countries = meta.countries || [];
    Q('#login')?.classList.add('hide');
    Q('#main')?.removeAttribute('style');

    await preloadProducts();
    fillGlobalSelects();

    if (state.productId) {
      await loadProduct(state.productId);
      renderProductPage();
    } else {
      initNav();
      initDashboard();
      initProducts();
      initPerformance();
      await initFinance();
      initSettings();
    }
  } catch {
    Q('#main')?.setAttribute('style','display:none');
    Q('#login')?.classList.remove('hide');
  }
}

Q('#loginBtn')?.addEventListener('click', async () => {
  const pw = Q('#pw')?.value || '';
  try {
    await api('/api/auth', { method:'POST', body: JSON.stringify({ password: pw }) });
    await gate();
  } catch (e) {
    alert('Wrong password');
  }
});
Q('#logoutLink')?.addEventListener('click', async e => {
  e.preventDefault();
  try { await api('/api/auth', { method:'POST', body: JSON.stringify({ password:'logout' }) }); } catch {}
  location.reload();
});

/* ================================================================
   COMMON LOADERS
   ================================================================ */
async function preloadProducts() {
  try {
    const r = await api('/api/products');
    state.products = r.products || [];
  } catch { state.products = []; }
}

/* fill selects everywhere */
function fillGlobalSelects() {
  // Country selects (plain)
  const cSelectors = [
    '#adCountry','#mvFrom','#mvTo','#pfCountry','#pcCountry',
    '#lpCountry','#feCountry', // feCountry not used but harmless
  ];
  cSelectors.forEach(sel => QA(sel).forEach(el => {
    el.innerHTML = `<option value="">${el.id==='pfCountry'||el.id==='pcCountry'||el.id==='lpCountry'?'All countries':''}</option>` +
      state.countries.map(c=>`<option value="${c}">${c}</option>`).join('');
  }));

  // Remittance country: exclude china
  QA('#rCountry').forEach(el => {
    el.innerHTML = state.countries
      .filter(c => c.toLowerCase() !== 'china')
      .map(c=>`<option value="${c}">${c}</option>`).join('');
  });

  // Products
  const pSelectors = ['#adProduct','#mvProduct','#rProduct','#lpProduct'];
  pSelectors.forEach(sel => QA(sel).forEach(el => {
    const allowAll = el.id === 'lpProduct';
    el.innerHTML = (allowAll?'<option value="">All products</option>':'') +
      state.products.map(p=>`<option value="${p.id}">${p.name}${p.sku?` (${p.sku})`:''}</option>`).join('');
  }));
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
  initTodos();
}

/* ---- KPIs (Delivered now from weekly grid total) ---- */
async function renderKpis() {
  Q('#kpiProducts') && (Q('#kpiProducts').textContent = state.products.length);
  Q('#kpiCountries') && (Q('#kpiCountries').textContent = state.countries.length);

  // Transit count (open shipments)
  try {
    const s = await api('/api/shipments');
    const live = (s.shipments||[]).filter(x=>!x.arrivedAt).length;
    Q('#kpiTransit') && (Q('#kpiTransit').textContent = live);
  } catch { Q('#kpiTransit') && (Q('#kpiTransit').textContent = '—'); }

  // Total Ad Spend (from daily adspend upserts)
  try {
    const a = await api('/api/adspend');
    const total = (a.adSpends||[]).reduce((t,x)=>t+(+x.amount||0),0);
    Q('#kpiAdSpend') && (Q('#kpiAdSpend').textContent = `${fmt(total)} USD`);
  } catch { Q('#kpiAdSpend') && (Q('#kpiAdSpend').textContent = '—'); }

  // Delivered Mon–Sun → from weekly grid (if grid rendered). Fallback to all deliveries sum.
  const gridGrand = Q('#wAllT')?.textContent?.replace(/,/g,'');
  if (gridGrand && !isNaN(+gridGrand)) {
    Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = gridGrand);
  } else {
    try {
      const d = await api('/api/deliveries');
      const total = (d.deliveries||[]).reduce((t,x)=>t+(+x.delivered||0),0);
      Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = fmt(total));
    } catch { Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = '—'); }
  }
}

/* ---- Global Stock & Spend by Country ---- */
async function renderStockAndSpendByCountry() {
  const body = Q('#stockByCountryBody'); if (!body) return;

  const per = {}; state.countries.forEach(c=>per[c] = { stock:0, ad:0 });

  // Shipments: arrived add to dest, deduct from origin
  try {
    const s = await api('/api/shipments');
    (s.shipments||[]).forEach(sp => {
      if (sp.arrivedAt) {
        const to = sp.toCountry || sp.to, from = sp.fromCountry || sp.from;
        per[to] = per[to] || { stock:0, ad:0 };
        per[to].stock += (+sp.qty||0);
        if (from) {
          per[from] = per[from] || { stock:0, ad:0 };
          per[from].stock -= (+sp.qty||0);
        }
      }
    });
  } catch {}

  // Remittances: subtract delivered pieces in that country
  try {
    const r = await api('/api/remittances');
    (r.remittances||[]).forEach(x => {
      per[x.country] = per[x.country] || { stock:0, ad:0 };
      per[x.country].stock -= (+x.pieces||0);
    });
  } catch {}

  // Ad spend from adspend (upsert values)
  try {
    const a = await api('/api/adspend');
    (a.adSpends||[]).forEach(x => {
      per[x.country] = per[x.country] || { stock:0, ad:0 };
      per[x.country].ad += (+x.amount||0);
    });
  } catch {}

  let stockT=0, adT=0;
  body.innerHTML = Object.entries(per).map(([c,v])=>{
    stockT += v.stock; adT += v.ad;
    return `<tr><td>${c}</td><td>${fmt(v.stock)}</td><td>${fmt(v.ad)}</td></tr>`;
  }).join('');
  Q('#stockTotal').textContent = fmt(stockT);
  Q('#adTotal').textContent = fmt(adT);
}

/* ---- Weekly Delivered Grid (Mon..Sun × countries) ---- */
function weekRangeContaining(dateISO) {
  const d = new Date(dateISO);
  const monOffset = (d.getDay()+6)%7; // Monday=0
  d.setDate(d.getDate() - monOffset);
  const days = [...Array(7)].map((_,i)=> {
    const x = new Date(d); x.setDate(d.getDate()+i);
    return x.toISOString().slice(0,10);
  });
  return days;
}
function labelForDay(iso) {
  return new Date(iso).toLocaleDateString(undefined,{weekday:'short'});
}

async function initWeeklyDelivered() {
  const head = Q('#weeklyHead'); const body = Q('#weeklyBody');
  if (!head || !body) return;

  let anchor = todayISO();
  const renderGrid = async () => {
    state.weekDays = weekRangeContaining(anchor);
    Q('#weeklyRange').textContent = `Week: ${state.weekDays[0]} → ${state.weekDays[6]}`;
    head.innerHTML = `<tr>
      <th>Country</th>${state.weekDays.map(d=>`<th>${labelForDay(d)}<br>${d}</th>`).join('')}<th>Total</th></tr>`;

    body.innerHTML = state.countries.map(c => {
      const cells = state.weekDays.map(d => `<td><input class="wd-cell" data-country="${c}" data-date="${d}" type="number" min="0" placeholder="0"/></td>`).join('');
      return `<tr data-row="${c}"><td>${c}</td>${cells}<td class="row-total">0</td></tr>`;
    }).join('');

    // preload existing week entries
    try {
      const r = await api('/api/deliveries');
      const map = {};
      (r.deliveries||[]).forEach(x=>map[`${x.country}|${x.date}`]=+x.delivered||0);
      QA('.wd-cell').forEach(inp=>{
        const k = `${inp.dataset.country}|${inp.dataset.date}`;
        if (map[k]!=null) inp.value = map[k];
      });
    } catch {}
    computeWeeklyTotals();
  };

  Q('#weeklyPrev')?.addEventListener('click', ()=>{ anchor = state.weekDays[0]; const d=new Date(anchor); d.setDate(d.getDate()-7); anchor=d.toISOString().slice(0,10); renderGrid(); });
  Q('#weeklyNext')?.addEventListener('click', ()=>{ anchor = state.weekDays[6]; const d=new Date(anchor); d.setDate(d.getDate()+1); anchor=d.toISOString().slice(0,10); renderGrid(); });

  Q('#weeklySave')?.addEventListener('click', async () => {
    try {
      const payload = [];
      QA('.wd-cell').forEach(inp => {
        const v = +inp.value || 0;
        if (v>0) payload.push({ date: inp.dataset.date, country: inp.dataset.country, delivered: v });
      });
      // Just append entries for now (simple backend). Later you can add batch replace per week.
      for (const rec of payload) {
        await api('/api/deliveries', { method:'POST', body: JSON.stringify(rec) });
      }
      alert('Saved');
      renderKpis(); // KPI delivered uses this grid total
    } catch (e) { alert(e.message); }
  });

  Q('#weeklyReset')?.addEventListener('click', ()=>{
    QA('.wd-cell').forEach(inp=>inp.value='');
    computeWeeklyTotals();
    renderKpis();
  });

  body.addEventListener('input', e=>{
    if (e.target.classList.contains('wd-cell')) {
      computeWeeklyTotals();
      renderKpis();
    }
  });

  await renderGrid();
}

function computeWeeklyTotals() {
  // rows
  QA('tr[data-row]').forEach(tr=>{
    const t = QA('.wd-cell',tr).reduce((s,el)=>s+(+el.value||0),0);
    Q('.row-total',tr).textContent = fmt(t);
  });
  // columns
  const cols = QA('#weeklyHead th').length - 2; // exclude Country + Total
  let grand = 0;
  for (let i=0;i<cols;i++){
    let sum = 0;
    QA('tr[data-row]').forEach(tr=>{
      const inp = QA('.wd-cell',tr)[i];
      sum += (+inp.value||0);
    });
    const ids = ['wMonT','wTueT','wWedT','wThuT','wFriT','wSatT','wSunT'];
    Q('#'+ids[i]).textContent = fmt(sum);
    grand += sum;
  }
  Q('#wAllT').textContent = fmt(grand);
}

/* ---- Daily Ad Spend (upsert) ---- */
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
      renderStockAndSpendByCountry();
    } catch (e) { alert(e.message); }
  });
}

/* ---- Create movement (shipment) ---- */
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
      alert('Shipment created');
      renderTransitTables();
    } catch (e) { alert(e.message); }
  });
}

/* ---- Transit tables ---- */
async function renderTransitTables() {
  const s = await api('/api/shipments');
  const live = (s.shipments||[]).filter(x=>!x.arrivedAt);
  const nameById = Object.fromEntries(state.products.map(p=>[p.id,p.name]));

  const ck = live.filter(x => (x.fromCountry||'').toLowerCase()==='china' && (x.toCountry||'').toLowerCase()==='kenya');
  const ic = live.filter(x => !((x.fromCountry||'').toLowerCase()==='china' && (x.toCountry||'').toLowerCase()==='kenya'));

  const row = sp => {
    const idAttr = sp.id; // keep intact (no line breaks)
    return `<tr>
      <td>${sp.id}</td>
      <td>${nameById[sp.productId]||sp.productId}</td>
      <td>${sp.fromCountry} → ${sp.toCountry}</td>
      <td>${fmt(sp.qty)}</td>
      <td>${fmt(sp.shipCost)}</td>
      <td>${sp.departedAt||''}</td>
      <td>${sp.arrivedAt||''}</td>
      <td>${sp.arrivedAt? Math.max(0, Math.round((+new Date(sp.arrivedAt)-+new Date(sp.departedAt))/86400000)) : ''}</td>
      <td>
        <button class="btn outline" data-arr="${idAttr}">Mark Arrived</button>
        <button class="btn outline" data-edit="${idAttr}">Edit</button>
        <button class="btn outline" data-del="${idAttr}">Delete</button>
      </td>
    </tr>`;
  };

  Q('#shipCKBody') && (Q('#shipCKBody').innerHTML = ck.map(row).join('') || `<tr><td colspan="9" class="muted">No transit</td></tr>`);
  Q('#shipICBody') && (Q('#shipICBody').innerHTML = ic.map(row).join('') || `<tr><td colspan="9" class="muted">No transit</td></tr>`);

  // actions
  const tableWrap = Q('#home') || document;
  tableWrap.onclick = async e => {
    const id = e.target.dataset.arr || e.target.dataset.edit || e.target.dataset.del;
    if (!id) return;
    if (e.target.dataset.arr) {
      const date = prompt('Arrival date (YYYY-MM-DD)', todayISO()); if (!date) return;
      await api(`/api/shipments/${encodeURIComponent(id)}`, { method:'PUT', body: JSON.stringify({ arrivedAt: date }) });
      await renderTransitTables();
      await renderStockAndSpendByCountry();
    } else if (e.target.dataset.edit) {
      const qty = +prompt('New qty?', '0') || 0;
      const shipCost = +prompt('New shipping cost?', '0') || 0;
      await api(`/api/shipments/${encodeURIComponent(id)}`, { method:'PUT', body: JSON.stringify({ qty, shipCost }) });
      await renderTransitTables();
    } else if (e.target.dataset.del) {
      if (!confirm('Delete shipment?')) return;
      await api(`/api/shipments/${encodeURIComponent(id)}`, { method:'DELETE' });
      await renderTransitTables();
    }
  };
}

/* ---- Profit by Country (from remittances) ---- */
function initProfitByCountry() {
  Q('#pcRun')?.addEventListener('click', async () => {
    const s = Q('#pcStart')?.value, e = Q('#pcEnd')?.value, c = Q('#pcCountry')?.value || '';
    const qs = []; if (s) qs.push('start='+s); if (e) qs.push('end='+e);
    const r = await api('/api/remittances' + (qs.length?('?'+qs.join('&')):''));
    const list = (r.remittances||[]).filter(x=>!c || x.country===c);
    const by = {};
    list.forEach(x=>{
      by[x.country] = by[x.country] || { revenue:0, ad:0, extra:0, pieces:0 };
      by[x.country].revenue += (+x.revenue||0);
      by[x.country].ad += (+x.adSpend||0);
      by[x.country].extra += (+x.extraPerPiece||0) * (+x.pieces||0);
      by[x.country].pieces += (+x.pieces||0);
    });

    let R=0,A=0,E=0,P=0,PCS=0;
    const rows = Object.entries(by).map(([cc,v])=>{
      const profit = v.revenue - v.ad - v.extra;
      R+=v.revenue; A+=v.ad; E+=v.extra; PCS+=v.pieces; P+=profit;
      return `<tr><td>${cc}</td><td>${fmt(v.revenue)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.extra)}</td><td>${fmt(v.pieces)}</td><td>${fmt(profit)}</td></tr>`;
    }).join('') || `<tr><td colspan="6" class="muted">No data</td></tr>`;

    Q('#profitCountryBody').innerHTML = rows;
    Q('#pcRevT').textContent = fmt(R);
    Q('#pcAdT').textContent = fmt(A);
    Q('#pcDelT').textContent = fmt(E);
    Q('#pcPiecesT').textContent = fmt(PCS);
    Q('#pcProfitT').textContent = fmt(P);
  });
}

/* ---- To-Dos (localStorage) ---- */
function initTodos() {
  const KEY='eas_todos', WEEK='eas_weekly';
  const load = k => JSON.parse(localStorage.getItem(k)||'[]');
  const save = (k,v)=>localStorage.setItem(k,JSON.stringify(v));

  function renderQuick(){
    const list = load(KEY);
    const box = Q('#todoList'); if (!box) return;
    box.innerHTML = list.map(t=>`
      <div class="flex">
        <span>${t.done?'✅ ':''}${t.text}</span>
        <button class="btn outline" data-done="${t.id}">${t.done?'Undo':'Done'}</button>
        <button class="btn outline" data-del="${t.id}">Delete</button>
      </div>`).join('');
    Q('#todoAdd')?.addEventListener('click', ()=>{
      const v = Q('#todoText').value.trim(); if(!v) return;
      list.push({ id: crypto.randomUUID(), text:v, done:false });
      save(KEY,list); renderQuick();
    }, { once:true });
    box.onclick = e=>{
      if (e.target.dataset.done){
        const it = list.find(x=>x.id===e.target.dataset.done); it.done=!it.done;
        save(KEY,list); renderQuick();
      } else if (e.target.dataset.del){
        const i = list.findIndex(x=>x.id===e.target.dataset.del); list.splice(i,1);
        save(KEY,list); renderQuick();
      }
    };
  }
  renderQuick();

  function renderWeekly(){
    const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    const data = JSON.parse(localStorage.getItem(WEEK)||'{}');
    const wrap = Q('#weeklyWrap'); if (!wrap) return;
    wrap.innerHTML = '';
    days.forEach(day=>{
      const arr = data[day]||[];
      const card = document.createElement('div');
      card.className='card';
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
    wrap.onclick = e=>{
      if (e.target.dataset.add){
        const d=e.target.dataset.add, v=Q('#w_'+d).value.trim(); if(!v) return;
        const arr=data[d]||[]; arr.push({id:crypto.randomUUID(),text:v,done:false}); data[d]=arr;
        localStorage.setItem(WEEK,JSON.stringify(data)); renderWeekly();
      } else if (e.target.dataset.tgl){
        const [d,id]=e.target.dataset.tgl.split('|'); const it=(data[d]||[]).find(x=>x.id===id); if(!it) return;
        it.done=!it.done; localStorage.setItem(WEEK,JSON.stringify(data)); renderWeekly();
      } else if (e.target.dataset.del){
        const [d,id]=e.target.dataset.del.split('|'); const arr=(data[d]||[]); const i=arr.findIndex(x=>x.id===id); if(i>-1) arr.splice(i,1);
        data[d]=arr; localStorage.setItem(WEEK,JSON.stringify(data)); renderWeekly();
      }
    };
  }
  renderWeekly();
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
    await preloadProducts(); fillGlobalSelects(); renderProductsTable();
    Q('#pName').value=''; Q('#pSku').value=''; Q('#pCost').value=''; Q('#pShip').value=''; Q('#pMB').value='';
  });

  renderProductsTable();
}

function renderProductsTable() {
  const tb = Q('#productsTable tbody'); if (!tb) return;
  tb.innerHTML = state.products.map(p=>`
    <tr>
      <td>${p.name}</td>
      <td>${p.sku||'-'}</td>
      <td><span class="badge ${p.status==='paused'?'muted':''}">${p.status||'active'}</span></td>
      <td>
        <a class="btn" href="/product.html?id=${encodeURIComponent(p.id)}">Open</a>
        <button class="btn outline" data-del="${p.id}">Delete</button>
      </td>
    </tr>
  `).join('') || `<tr><td colspan="4" class="muted">No products</td></tr>`;

  tb.onclick = async e => {
    const del = e.target.dataset.del;
    if (del) {
      if (!confirm('Delete product and all its data?')) return;
      await api('/api/products/'+encodeURIComponent(del), { method:'DELETE' });
      await preloadProducts(); fillGlobalSelects(); renderProductsTable();
      // cascades handled on server (adspend/remittances/shipments)
      renderStockAndSpendByCountry();
    }
  };
}

/* ================================================================
   PERFORMANCE
   ================================================================ */
function initPerformance() {
  // Top delivered
  Q('#pfRun')?.addEventListener('click', runTopDelivered);

  // Remittance add
  Q('#rAdd')?.addEventListener('click', async () => {
    const payload = {
      start: Q('#rStart').value, end: Q('#rEnd').value,
      country: Q('#rCountry').value, productId: Q('#rProduct').value,
      orders: +Q('#rOrders').value||0, pieces:+Q('#rPieces').value||0,
      revenue:+Q('#rRev').value||0, adSpend:+Q('#rAds').value||0,
      extraPerPiece:+Q('#rExtra').value||0
    };
    if (!payload.start || !payload.end || !payload.country || !payload.productId) return alert('Missing fields');
    await api('/api/remittances', { method:'POST', body: JSON.stringify(payload) });
    Q('#rMsg').textContent = 'Saved ✅';
    setTimeout(()=>{ Q('#rMsg').textContent=''; }, 1500);
  });
}

async function runTopDelivered() {
  const quick = Q('#pfQuick')?.value;
  let start = Q('#pfStart')?.value, end = Q('#pfEnd')?.value;
  if (quick && quick!=='custom') {
    const d=new Date(); d.setDate(d.getDate()-(+quick)); start=d.toISOString().slice(0,10);
    end=todayISO();
  }
  const country = Q('#pfCountry')?.value || '';

  const qs=[]; if(start) qs.push('start='+start); if(end) qs.push('end='+end);
  const r = await api('/api/remittances' + (qs.length?('?'+qs.join('&')):''));
  const prodMap = Object.fromEntries(state.products.map(p=>[p.id,p]));
  const list = (r.remittances||[]).filter(x=>!country || x.country===country);

  const by = {}; // product+country
  list.forEach(x=>{
    const key = `${x.productId}|${x.country}`;
    if (!by[key]) by[key] = { productId:x.productId, country:x.country, pieces:0, ad:0, prodCost:0, profit:0 };
    const pcs = +x.pieces||0;
    const base = ((+prodMap[x.productId]?.cost_china||0) + (+prodMap[x.productId]?.ship_china_to_kenya||0)) * pcs;
    const extra = (+x.extraPerPiece||0) * pcs;
    by[key].pieces += pcs;
    by[key].ad += (+x.adSpend||0);
    by[key].prodCost += base;
    by[key].profit += (+x.revenue||0) - (+x.adSpend||0) - base - extra;
  });

  const rows = Object.values(by)
    .sort((a,b)=>b.pieces-a.pieces)
    .map(it=>`<tr>
      <td>${prodMap[it.productId]?.name||it.productId}</td>
      <td>${it.country}</td>
      <td>${fmt(it.pieces)}</td>
      <td>${fmt(it.ad)}</td>
      <td>${fmt(it.prodCost)}</td>
      <td>${fmt(it.profit)}</td>
      <td>${it.pieces?fmt(it.profit/it.pieces):'0'}</td>
    </tr>`).join('') || `<tr><td colspan="7" class="muted">No data</td></tr>`;

  Q('#pfTable tbody').innerHTML = rows;
}

/* ================================================================
   FINANCE
   ================================================================ */
async function initFinance() {
  await loadFinanceCats();

  // Add/Delete category
  Q('#fcAdd')?.addEventListener('click', async ()=>{
    const type = Q('#fcType').value, name=(Q('#fcName').value||'').trim();
    if(!name) return;
    await api('/api/finance/categories', { method:'POST', body: JSON.stringify({ type, name }) });
    Q('#fcName').value='';
    await loadFinanceCats();
  });

  // Add entry
  Q('#feAdd')?.addEventListener('click', async ()=>{
    const date=Q('#feDate').value, type=Q('#feType').value, category=Q('#feCat').value, amount=+Q('#feAmt').value||0, note=Q('#feNote').value;
    if(!date || !category || !type) return alert('Missing date/type/category');
    await api('/api/finance/entries', { method:'POST', body: JSON.stringify({ date,type,category,amount,note }) });
    Q('#feAmt').value=''; Q('#feNote').value='';
    renderFinancePeriod();
  });

  Q('#feRun')?.addEventListener('click', renderFinancePeriod);
  renderFinancePeriod();
}
async function loadFinanceCats(){
  try{
    const cats = await api('/api/finance/categories');
    state.categories = cats;
    // Chips with delete
    const deb = cats.debit||[], cre=cats.credit||[];
    Q('#fcDebits').innerHTML = deb.map(c=>`<span class="chip deletable" data-delc="debit|${c}">${c} ✕</span>`).join('') || '<span class="muted">—</span>';
    Q('#fcCredits').innerHTML = cre.map(c=>`<span class="chip deletable" data-delc="credit|${c}">${c} ✕</span>`).join('') || '<span class="muted">—</span>';
    const all = [...deb,...cre].sort();
    Q('#feCat').innerHTML = `<option value="" disabled selected>Select category</option>` + all.map(c=>`<option>${c}</option>`).join('');

    // delete handlers
    Q('#finance')?.addEventListener('click', async e=>{
      const d = e.target.dataset.delc;
      if(!d) return;
      const [type,name] = d.split('|');
      await api(`/api/finance/categories?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}`, { method:'DELETE' });
      await loadFinanceCats();
    });
  }catch{}
}
async function renderFinancePeriod(){
  const s=Q('#fes')?.value, e=Q('#fee')?.value;
  const r = await api('/api/finance/entries'+((s||e)?`?start=${s||''}&end=${e||''}`:''));
  Q('#runBalance').textContent = `${fmt(r.running||0)} USD`;
  Q('#feBalance').textContent = `Period Balance: ${fmt(r.balance||0)} USD`;
  const tb = Q('#feTable tbody');
  tb.innerHTML = (r.entries||[]).map(x=>`<tr>
    <td>${x.date}</td><td>${x.type}</td><td>${x.category}</td><td>${fmt(x.amount)}</td><td>${x.note||''}</td>
    <td><button class="btn outline" data-del-entry="${x.id}">Delete</button></td></tr>`).join('') || `<tr><td colspan="6" class="muted">No entries</td></tr>`;
  tb.onclick = async e=>{
    const id = e.target.dataset.delEntry; if(!id) return;
    await api('/api/finance/entries/'+encodeURIComponent(id), { method:'DELETE' });
    renderFinancePeriod();
  };
}

/* ================================================================
   SETTINGS
   ================================================================ */
function initSettings() {
  // countries
  renderCountryChips();
  Q('#ctyAdd')?.addEventListener('click', async ()=>{
    const name=(Q('#cty').value||'').trim(); if(!name) return;
    await api('/api/countries', { method:'POST', body: JSON.stringify({ name }) });
    const meta = await api('/api/meta'); state.countries = meta.countries||[];
    fillGlobalSelects(); renderCountryChips();
  });

  // product editor
  const sel = Q('#epSelect');
  if (sel) {
    sel.innerHTML = `<option value="">Select product…</option>` + state.products.map(p=>`<option value="${p.id}">${p.name}${p.sku?` (${p.sku})`:''}</option>`).join('');
    sel.onchange = ()=>{
      const p = state.products.find(x=>x.id===sel.value); if(!p) return;
      Q('#epName').value=p.name; Q('#epSku').value=p.sku||'';
      Q('#epCost').value=p.cost_china||0; Q('#epShip').value=p.ship_china_to_kenya||0; Q('#epMB').value=p.margin_budget||0;
    };
    Q('#epSave')?.addEventListener('click', async ()=>{
      const id = sel.value; if(!id) return;
      const p = {
        name:Q('#epName').value, sku:Q('#epSku').value,
        cost_china:+Q('#epCost').value||0,
        ship_china_to_kenya:+Q('#epShip').value||0,
        margin_budget:+Q('#epMB').value||0
      };
      await api('/api/products/'+encodeURIComponent(id), { method:'PUT', body: JSON.stringify(p) });
      await preloadProducts(); fillGlobalSelects();
      alert('Saved');
    });
  }

  // snapshots
  renderSnapshots();
  Q('#snapSave')?.addEventListener('click', async ()=>{
    const name=(Q('#snapName').value||'').trim() || `Manual ${new Date().toLocaleString()}`;
    await api('/api/snapshots',{ method:'POST', body: JSON.stringify({ name }) });
    Q('#snapName').value='';
    await renderSnapshots();
  });
}
function renderCountryChips() {
  const list = Q('#ctyList'); if(!list) return;
  list.innerHTML = state.countries.map(c=>{
    const lock = c.toLowerCase()==='china';
    return `<span class="chip${lock?' lock':''}" ${lock?'':'data-del-country="'+c+'"'}>${c}${lock?' 🔒':''}</span>`;
  }).join('') || '<span class="muted">—</span>';
  list.onclick = async e=>{
    const c = e.target.dataset.delCountry; if(!c) return;
    if (!confirm(`Delete country "${c}"?`)) return;
    await api('/api/countries/'+encodeURIComponent(c), { method:'DELETE' });
    const meta = await api('/api/meta'); state.countries = meta.countries||[];
    fillGlobalSelects(); renderCountryChips();
  };
}
async function renderSnapshots(){
  const r = await api('/api/snapshots');
  const box = Q('#snapList'); if(!box) return;
  box.innerHTML = (r.snapshots||[]).map(s=>`
    <tr>
      <td>${s.name}</td>
      <td><code>${s.file?.split('/').slice(-1)[0]||'-'}</code></td>
      <td>
        <button class="btn outline" data-push="${s.file}">Push</button>
        <button class="btn outline" data-delsnap="${s.id}">Delete</button>
      </td>
    </tr>`).join('') || `<tr><td colspan="3" class="muted">No snapshots yet</td></tr>`;
  box.onclick = async e=>{
    if (e.target.dataset.push){
      await api('/api/snapshots/restore', { method:'POST', body: JSON.stringify({ file: e.target.dataset.push }) });
      alert('Pushed to system'); // snapshot remains listed (server keeps it)
      location.reload();
    } else if (e.target.dataset.delsnap){
      if (!confirm('Delete this snapshot?')) return;
      await api('/api/snapshots/'+encodeURIComponent(e.target.dataset.delsnap), { method:'DELETE' });
      await renderSnapshots();
    }
  };
}

/* ================================================================
   PRODUCT PAGE (product.html?id=...)
   ================================================================ */
async function loadProduct(id){
  await preloadProducts();
  state.product = state.products.find(p=>p.id===id) || null;
}
function renderProductPage(){
  if (!state.product){ alert('Product not found'); location.href='/'; return; }
  // heading
  Q('#pdTitle') && (Q('#pdTitle').textContent = state.product.name);
  Q('#pdSku') && (Q('#pdSku').textContent = state.product.sku ? `SKU: ${state.product.sku}` : '');

  // stock & ad table for this product
  renderProductStockAd();

  // ad spend section (replace)
  Q('#pdAdSave')?.addEventListener('click', async ()=>{
    const payload = {
      productId: state.product.id,
      country: Q('#pdAdCountry').value,
      platform: Q('#pdAdPlatform').value,
      amount: +Q('#pdAdAmount').value || 0
    };
    if (!payload.country || !payload.platform) return alert('Missing fields');
    await api('/api/adspend', { method:'POST', body: JSON.stringify(payload) });
    await renderProductStockAd();
  });

  // shipments creation (for this product)
  Q('#pdMvAdd')?.addEventListener('click', async ()=>{
    const payload = {
      productId: state.product.id,
      fromCountry: Q('#pdMvFrom').value,
      toCountry: Q('#pdMvTo').value,
      qty: +Q('#pdMvQty').value||0,
      shipCost: +Q('#pdMvShip').value||0,
      departedAt: todayISO(),
      arrivedAt: null
    };
    if (!payload.fromCountry || !payload.toCountry) return alert('Missing countries');
    await api('/api/shipments', { method:'POST', body: JSON.stringify(payload) });
    await renderProductStockAd(); await renderProductTransit();
  });

  renderProductTransit();

  // lifetime (product-only)
  Q('#pdLPRun')?.addEventListener('click', renderProductLifetime);
  renderProductLifetime();

  // fill selects
  QA('#pdAdCountry, #pdMvFrom, #pdMvTo').forEach(el=>{
    el.innerHTML = state.countries.map(c=>`<option value="${c}">${c}</option>`).join('');
  });
}

async function renderProductStockAd(){
  const tb = Q('#pdStockBody'); if(!tb) return;
  const per = {}; state.countries.forEach(c=>per[c]={stock:0,ad:0});

  const s = await api('/api/shipments');
  (s.shipments||[]).filter(x=>x.productId===state.product.id && x.arrivedAt).forEach(sp=>{
    const to=sp.toCountry, from=sp.fromCountry, q=(+sp.qty||0);
    per[to]=per[to]||{stock:0,ad:0}; per[to].stock += q;
    if(from){ per[from]=per[from]||{stock:0,ad:0}; per[from].stock -= q; }
  });

  const r = await api('/api/remittances');
  (r.remittances||[]).filter(x=>x.productId===state.product.id).forEach(x=>{
    per[x.country] = per[x.country]||{stock:0,ad:0};
    per[x.country].stock -= (+x.pieces||0);
  });

  const a = await api('/api/adspend');
  (a.adSpends||[]).filter(x=>x.productId===state.product.id).forEach(x=>{
    per[x.country] = per[x.country]||{stock:0,ad:0};
    per[x.country].ad += (+x.amount||0);
  });

  let st=0, at=0;
  tb.innerHTML = Object.entries(per).map(([c,v])=>{
    st+=v.stock; at+=v.ad;
    return `<tr><td>${c}</td><td>${fmt(v.stock)}</td><td>${fmt(v.ad)}</td></tr>`;
  }).join('') || `<tr><td colspan="3" class="muted">No data</td></tr>`;
  Q('#pdStockTotal').textContent = fmt(st);
  Q('#pdAdTotal').textContent = fmt(at);
}

async function renderProductTransit(){
  const s = await api('/api/shipments');
  const list = (s.shipments||[]).filter(x=>x.productId===state.product.id);
  const ck = list.filter(x => (x.fromCountry||'').toLowerCase()==='china' && (x.toCountry||'').toLowerCase()==='kenya');
  const ic = list.filter(x => !((x.fromCountry||'').toLowerCase()==='china' && (x.toCountry||'').toLowerCase()==='kenya'));

  const row = sp => {
    const idAttr = sp.id;
    return `<tr>
      <td>${sp.id}</td>
      <td>${sp.fromCountry} → ${sp.toCountry}</td>
      <td>${fmt(sp.qty)}</td>
      <td>${fmt(sp.shipCost)}</td>
      <td>${sp.departedAt||''}</td>
      <td>${sp.arrivedAt||''}</td>
      <td>${sp.arrivedAt? Math.max(0, Math.round((+new Date(sp.arrivedAt)-+new Date(sp.departedAt))/86400000)) : ''}</td>
      <td>
        <button class="btn outline" data-arr="${idAttr}">Mark Arrived</button>
        <button class="btn outline" data-edit="${idAttr}">Edit</button>
        <button class="btn outline" data-del="${idAttr}">Delete</button>
      </td>
    </tr>`;
  };

  Q('#pdShipCKBody').innerHTML = ck.map(row).join('') || `<tr><td colspan="8" class="muted">No shipments</td></tr>`;
  Q('#pdShipICBody').innerHTML = ic.map(row).join('') || `<tr><td colspan="8" class="muted">No shipments</td></tr>`;

  const page = Q('#productPage') || document;
  page.onclick = async e=>{
    const id = e.target.dataset.arr || e.target.dataset.edit || e.target.dataset.del;
    if(!id) return;
    if (e.target.dataset.arr){
      const date = prompt('Arrival date (YYYY-MM-DD)', todayISO()); if(!date) return;
      await api('/api/shipments/'+encodeURIComponent(id), { method:'PUT', body: JSON.stringify({ arrivedAt: date }) });
      await renderProductTransit(); await renderProductStockAd();
    } else if (e.target.dataset.edit){
      const qty=+prompt('New qty?','0')||0, shipCost=+prompt('New shipping cost?','0')||0;
      await api('/api/shipments/'+encodeURIComponent(id), { method:'PUT', body: JSON.stringify({ qty, shipCost }) });
      await renderProductTransit();
    } else if (e.target.dataset.del){
      if(!confirm('Delete shipment?')) return;
      await api('/api/shipments/'+encodeURIComponent(id), { method:'DELETE' });
      await renderProductTransit();
    }
  };
}

async function renderProductLifetime(){
  const s = Q('#pdLPStart')?.value, e = Q('#pdLPEnd')?.value;
  const r = await api('/api/remittances' + ((s||e)?`?start=${s||''}&end=${e||''}`:''));
  const list = (r.remittances||[]).filter(x=>x.productId===state.product.id);

  const base = (+state.product.cost_china||0) + (+state.product.ship_china_to_kenya||0);
  const byC = {};
  list.forEach(x=>{
    const pcs=+x.pieces||0, extra=(+x.extraPerPiece||0)*pcs;
    byC[x.country] = byC[x.country]||{rev:0,ad:0,ship:0,base:0,pcs:0,profit:0};
    byC[x.country].rev += (+x.revenue||0);
    byC[x.country].ad += (+x.adSpend||0);
    byC[x.country].ship += extra;
    byC[x.country].base += base * pcs;
    byC[x.country].pcs  += pcs;
  });
  Object.values(byC).forEach(v=>v.profit = v.rev - v.ad - v.ship - v.base);

  const tb = Q('#pdLPBody'); if(!tb) return;
  let R=0,A=0,S=0,B=0,P=0,PCS=0;
  tb.innerHTML = Object.entries(byC).map(([c,v])=>{
    R+=v.rev; A+=v.ad; S+=v.ship; B+=v.base; P+=v.profit; PCS+=v.pcs;
    return `<tr><td>${c}</td><td>${fmt(v.rev)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.ship)}</td><td>${fmt(v.base)}</td><td>${fmt(v.pcs)}</td><td>${fmt(v.profit)}</td></tr>`;
  }).join('') || `<tr><td colspan="7" class="muted">No data</td></tr>`;
  Q('#pdLPRevT').textContent=fmt(R); Q('#pdLPAdT').textContent=fmt(A);
  Q('#pdLPShipT').textContent=fmt(S); Q('#pdLPBaseT').textContent=fmt(B);
  Q('#pdLPPcsT').textContent=fmt(PCS); Q('#pdLPProfitT').textContent=fmt(P);
}

/* ================================================================
   NAV
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

/* ================================================================
   BOOT
   ================================================================ */
gate();
