/* =========================
   EAS Tracker – Front-end
   (index.html + product.html)
   ========================= */

/* ---------- helpers ---------- */
const Q  = (s, r=document) => r.querySelector(s);
const QA = (s, r=document) => Array.from(r.querySelectorAll(s));
const fmt = n => (Number(n||0)).toLocaleString(undefined,{maximumFractionDigits:2});
const todayISO = () => new Date().toISOString().slice(0,10);
const getQuery = k => new URLSearchParams(location.search).get(k);

async function api(path, opts={}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type':'application/json' },
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
  categories: { debit:[], credit:[] },
  product: null,
  productId: getQuery('id')
};

/* ---------- auth + boot ---------- */
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
    Q('#main')?.setAttribute('style','display:none');
  }
}

Q('#loginBtn')?.addEventListener('click', async () => {
  try {
    await api('/api/auth',{method:'POST', body: JSON.stringify({password: Q('#pw').value})});
    await gate();
  } catch { alert('Wrong password'); }
});

Q('#logoutLink')?.addEventListener('click', async e => {
  e.preventDefault();
  try { await api('/api/auth',{method:'POST', body: JSON.stringify({password:'logout'})}); } catch {}
  location.reload();
});

/* ---------- common data ---------- */
async function preloadProducts() {
  try {
    const r = await api('/api/products');
    state.products = r.products || [];
  } catch { state.products = []; }
}

/* Build select options.
   China must be hidden in MOST places except stock movement / transit.
*/
function fillGlobalSelects() {
  const all = state.countries.slice();
  const noChina = state.countries.filter(c => c.toLowerCase() !== 'china');

  // selects that CAN include china (movement & transit filters)
  const withChinaIDs = new Set([
    'mvFrom','mvTo','mvProduct',
    'pdMvFrom','pdMvTo'
  ]);

  // Map of selector -> allowed list
  const map = {
    '#adCountry': noChina, '#rCountry': noChina, '#pfCountry': [''].concat(noChina),
    '#pcCountry': [''].concat(noChina),
    '#pdAdCountry': noChina, '#pdRCountry': noChina,
    '#pdPBCountry': noChina,
    '#pdInfCountry': noChina, '#pdInfFilterCountry': [''].concat(noChina)
  };

  // Countries
  Object.entries(map).forEach(([sel, list]) => {
    QA(sel).forEach(el => el.innerHTML =
      list.map(c => c === '' ? `<option value="">All countries</option>` : `<option value="${c}">${c}</option>`).join('')
    );
  });

  // Movement (includes China)
  ['#mvFrom','#mvTo','#pdMvFrom','#pdMvTo'].forEach(sel=>{
    QA(sel).forEach(el => el.innerHTML = all.map(c=>`<option value="${c}">${c}</option>`).join(''));
  });

  // Weekly delivered grid countries are generated dynamically (noChina) in initWeeklyDelivered

  // Products for global forms
  ['#adProduct','#rProduct','#lpProduct'].forEach(sel=>{
    QA(sel).forEach(el=>{
      el.innerHTML =
        (sel==='#lpProduct' ? `<option value="">All products</option>` : '') +
        state.products.map(p=>`<option value="${p.id}">${p.name}${p.sku?` (${p.sku})`:''}</option>`).join('');
    });
  });
}

/* ========================================================================
   DASHBOARD
   ======================================================================== */
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

  try {
    const s = await api('/api/shipments');
    const live = (s.shipments||[]).filter(x=>!x.arrivedAt).length;
    Q('#kpiTransit') && (Q('#kpiTransit').textContent = live);
  } catch { Q('#kpiTransit') && (Q('#kpiTransit').textContent = '—'); }

  // total ad spend from daily adSpend (all products/all countries)
  try {
    const a = await api('/api/adspend');
    const total = (a.adSpends||[]).reduce((t,x)=>t+(+x.amount||0),0);
    Q('#kpiAdSpend') && (Q('#kpiAdSpend').textContent = fmt(total)+' USD');
  } catch { Q('#kpiAdSpend') && (Q('#kpiAdSpend').textContent = '—'); }

  // Delivered for CURRENT week only (Mon..Sun), from deliveries
  try {
    const r = await api('/api/deliveries');
    const days = weekRangeFrom(todayISO());
    const set = new Set(days);
    const weekSum = (r.deliveries||[])
      .filter(d=>set.has(d.date) && d.country.toLowerCase()!=='china')
      .reduce((t,x)=>t+(+x.delivered||0),0);
    Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = fmt(weekSum));
  } catch { Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = '—'); }
}

/* ---- Stock & Spend by Country (global; China excluded) ---- */
async function renderStockAndSpendByCountry() {
  const body = Q('#stockByCountryBody'); const tStock = Q('#stockTotal'); const tAd = Q('#adTotal');
  if (!body) return;

  const per = {};
  const noChina = state.countries.filter(c=>c.toLowerCase()!=='china');
  noChina.forEach(c=>per[c] = {stock:0, ad:0});

  // Arrived shipments adjust stock (add to destination, subtract from origin if origin not China-hidden list aware)
  try {
    const s = await api('/api/shipments');
    (s.shipments||[]).forEach(sp=>{
      if (!sp.arrivedAt) return;
      const to = (sp.toCountry||sp.to); const from = (sp.fromCountry||sp.from);
      if (to && per[to]!==undefined) per[to].stock += (+sp.qty||0);
      if (from && per[from]!==undefined) per[from].stock -= (+sp.qty||0);
    });
  } catch {}

  // Remittances reduce stock by pieces
  try {
    const r = await api('/api/remittances');
    (r.remittances||[]).forEach(rr=>{
      if (per[rr.country]!==undefined) per[rr.country].stock -= (+rr.pieces||0);
    });
  } catch {}

  // Daily ad spend totals (replace semantic is handled on the backend upsert)
  try {
    const a = await api('/api/adspend');
    (a.adSpends||[]).forEach(x=>{
      if (per[x.country]!==undefined) per[x.country].ad += (+x.amount||0);
    });
  } catch {}

  let sT=0, aT=0;
  body.innerHTML = Object.entries(per).map(([c,v])=>{
    sT += v.stock; aT += v.ad;
    return `<tr><td>${c}</td><td>${fmt(v.stock)}</td><td>${fmt(v.ad)}</td></tr>`;
  }).join('');
  if (tStock) tStock.textContent = fmt(sT);
  if (tAd)    tAd.textContent    = fmt(aT);
}

/* ---- Weekly Delivered grid (Mon–Sun x countries; China excluded) ---- */
function weekRangeFrom(dateISO) {
  const d = new Date(dateISO);
  const day = (d.getDay()+6)%7; // Mon=0
  d.setDate(d.getDate()-day);
  return [...Array(7)].map((_,i)=>{ const x=new Date(d); x.setDate(d.getDate()+i); return x.toISOString().slice(0,10); });
}

async function initWeeklyDelivered() {
  const table = Q('#weeklyTable'); if (!table) return;
  const head = Q('#weeklyHead'); const body = Q('#weeklyBody');

  const days = weekRangeFrom(todayISO());
  head.innerHTML = `<tr><th>Country</th>${days.map(d=>`<th>${new Date(d).toLocaleDateString(undefined,{weekday:'short'})}<br>${d}</th>`).join('')}<th>Total</th></tr>`;

  const countries = state.countries.filter(c=>c.toLowerCase()!=='china');
  body.innerHTML = countries.map(c=>{
    const cells = days.map(d=>`<td><input class="wd" data-country="${c}" data-date="${d}" type="number" min="0" placeholder="0"></td>`).join('');
    return `<tr data-row="${c}"><td>${c}</td>${cells}<td class="rowT">0</td></tr>`;
  }).join('');

  // preload
  try {
    const r = await api('/api/deliveries');
    const map = new Map((r.deliveries||[]).map(x=>[`${x.country}|${x.date}`, +x.delivered||0]));
    QA('.wd').forEach(inp=>{
      const k = `${inp.dataset.country}|${inp.dataset.date}`;
      if (map.has(k)) inp.value = map.get(k);
    });
    computeWeeklyTotals();
  } catch {}

  Q('#weeklySave')?.addEventListener('click', async ()=>{
    const payload=[];
    QA('.wd').forEach(i=>{ const v=+i.value||0; if(v>0) payload.push({date:i.dataset.date, country:i.dataset.country, delivered:v});});
    try {
      for (const rec of payload) await api('/api/deliveries',{method:'POST', body: JSON.stringify(rec)});
      alert('Saved'); computeWeeklyTotals(); renderKpis();
    } catch(e){ alert(e.message); }
  });
  Q('#weeklyReset')?.addEventListener('click', ()=>{ QA('.wd').forEach(i=>i.value=''); computeWeeklyTotals(); });

  table.addEventListener('input', e => { if (e.target.classList.contains('wd')) computeWeeklyTotals(); });

  function computeWeeklyTotals() {
    // per-row
    QA('tr[data-row]',table).forEach(tr=>{
      const t = QA('.wd',tr).reduce((s,el)=>s+(+el.value||0),0);
      Q('.rowT',tr).textContent = fmt(t);
    });
    // per-column + grand
    const cols = days.length; let grand = 0;
    for (let i=0;i<cols;i++){
      let sum=0;
      QA('tr[data-row]',table).forEach(tr=>sum += (+QA('.wd',tr)[i].value||0));
      Q(`#w${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i]}T`)?.textContent = fmt(sum);
      grand += sum;
    }
    Q('#wAllT') && (Q('#wAllT').textContent = fmt(grand));
  }
}

/* ---- Daily Ad Spend (upsert/replace) ---- */
function initDailyAdSpend() {
  Q('#adSave')?.addEventListener('click', async ()=>{
    const payload = {
      productId: Q('#adProduct')?.value,
      country: Q('#adCountry')?.value,
      platform: Q('#adPlatform')?.value,
      amount: +Q('#adAmount')?.value || 0
    };
    if (!payload.productId || !payload.country || !payload.platform) return alert('Missing fields');
    try {
      await api('/api/adspend',{method:'POST', body: JSON.stringify(payload)});
      alert('Saved'); renderStockAndSpendByCountry(); renderKpis();
    } catch(e){ alert(e.message); }
  });
}

/* ---- Movements (create shipment record) ---- */
function initMovements() {
  Q('#mvAdd')?.addEventListener('click', async ()=>{
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
      await api('/api/shipments',{method:'POST', body: JSON.stringify(payload)});
      alert('Movement added'); renderTransitTables();
    } catch(e){ alert(e.message); }
  });
}

/* ---- Transit listing + actions (robust binding) ---- */
async function renderTransitTables() {
  const s = await api('/api/shipments');
  const list = (s.shipments||[]).filter(x=>!x.arrivedAt);
  const prodMap = Object.fromEntries(state.products.map(p=>[p.id,p.name]));

  const ck  = list.filter(sp => (sp.fromCountry||sp.from||'').toLowerCase()==='china' && (sp.toCountry||sp.to||'').toLowerCase()==='kenya');
  const ic  = list.filter(sp => !ck.includes(sp));

  const row = sp => `<tr data-id="${sp.id}">
    <td>${sp.id}</td>
    <td>${prodMap[sp.productId]||sp.productId}</td>
    <td>${(sp.fromCountry||sp.from)} → ${(sp.toCountry||sp.to)}</td>
    <td>${fmt(sp.qty)}</td>
    <td>${fmt(sp.shipCost)}</td>
    <td>${sp.departedAt||''}</td>
    <td>${sp.arrivedAt||''}</td>
    <td>
      <button class="btn outline act-arrived">Mark Arrived</button>
      <button class="btn outline act-edit">Edit</button>
      <button class="btn outline act-del">Delete</button>
    </td>
  </tr>`;

  const ckBody = Q('#shipCKBody'); const icBody = Q('#shipICBody');
  if (ckBody) ckBody.innerHTML = ck.map(row).join('') || `<tr><td colspan="8" class="muted">No transit</td></tr>`;
  if (icBody) icBody.innerHTML = ic.map(row).join('') || `<tr><td colspan="8" class="muted">No transit</td></tr>`;

  function attach(container) {
    if (!container) return;
    container.onclick = async e => {
      const tr = e.target.closest('tr[data-id]'); if (!tr) return;
      const id = tr.dataset.id;
      if (e.target.classList.contains('act-arrived')) {
        const date = prompt('Arrival date (YYYY-MM-DD)', todayISO()); if (!date) return;
        try { await api('/api/shipments/'+id,{method:'PUT', body: JSON.stringify({arrivedAt: date})}); }
        catch(err){ return alert(err.message); }
        renderTransitTables(); renderStockAndSpendByCountry();
      }
      if (e.target.classList.contains('act-edit')) {
        const qty = +prompt('New qty?', '') || 0;
        const shipCost = +prompt('New shipping cost?', '') || 0;
        await api('/api/shipments/'+id,{method:'PUT', body: JSON.stringify({qty, shipCost})});
        renderTransitTables();
      }
      if (e.target.classList.contains('act-del')) {
        if (!confirm('Delete shipment?')) return;
        await api('/api/shipments/'+id,{method:'DELETE'});
        renderTransitTables();
      }
    };
  }
  attach(ckBody); attach(icBody);
}

/* ---- Profit by Country (filter respects dates; China excluded) ---- */
function initProfitByCountry() {
  Q('#pcRun')?.addEventListener('click', async ()=>{
    const s = Q('#pcStart')?.value, e = Q('#pcEnd')?.value, c = Q('#pcCountry')?.value || '';
    const qs=[]; if(s)qs.push('start='+s); if(e)qs.push('end='+e);
    try {
      const r = await api('/api/remittances'+(qs.length?('?'+qs.join('&')):''));
      const rows = (r.remittances||[])
        .filter(x=>x.country.toLowerCase()!=='china')
        .filter(x=>!c || x.country===c);

      const byC={};
      rows.forEach(x=>{
        byC[x.country] = byC[x.country] || {revenue:0, ad:0, extra:0, pieces:0};
        byC[x.country].revenue += +x.revenue||0;
        byC[x.country].ad      += +x.adSpend||0;
        byC[x.country].extra   += (+x.extraPerPiece||0) * (+x.pieces||0);
        byC[x.country].pieces  += +x.pieces||0;
      });

      let R=0,A=0,E=0,P=0;
      const tb = Q('#profitCountryBody');
      tb.innerHTML = Object.entries(byC).map(([cc,v])=>{
        const profit = v.revenue - v.ad - v.extra;
        R+=v.revenue; A+=v.ad; E+=v.extra; P+=profit;
        return `<tr><td>${cc}</td><td>${fmt(v.revenue)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.extra)}</td><td>${fmt(v.pieces)}</td><td>${fmt(profit)}</td></tr>`;
      }).join('') || `<tr><td colspan="6" class="muted">No data</td></tr>`;
      Q('#pcRevT').textContent=fmt(R); Q('#pcAdT').textContent=fmt(A);
      Q('#pcDelT').textContent=fmt(E); Q('#pcPiecesT').textContent=fmt(Object.values(byC).reduce((t,v)=>t+v.pieces,0));
      Q('#pcProfitT').textContent=fmt(P);
    } catch(e){ alert(e.message); }
  });
}

/* ---- To-Dos (localStorage) ---- */
function initTodos(){
  const KEY='eas_todos', WEEK='eas_weekly';
  const load=k=>JSON.parse(localStorage.getItem(k)||'[]');
  const save=(k,v)=>localStorage.setItem(k,JSON.stringify(v));

  function renderQuick(){
    const list=load(KEY); const box=Q('#todoList'); if(!box) return;
    box.innerHTML = list.map(t=>`<div class="flex"><span>${t.done?'✅ ':''}${t.text}</span>
      <button class="btn outline" data-d="${t.id}" data-op="done">${t.done?'Undo':'Done'}</button>
      <button class="btn outline" data-d="${t.id}" data-op="del">Delete</button></div>`).join('');
    Q('#todoAdd')?.addEventListener('click',()=>{const v=Q('#todoText').value.trim(); if(!v) return; list.push({id:crypto.randomUUID(),text:v,done:false}); save(KEY,list); renderQuick();},{once:true});
    box.onclick=e=>{
      const id=e.target.dataset.d, op=e.target.dataset.op; if(!id) return;
      const i=list.findIndex(x=>x.id===id); if(i<0) return;
      if(op==='done'){ list[i].done=!list[i].done; save(KEY,list); renderQuick(); }
      if(op==='del'){ list.splice(i,1); save(KEY,list); renderQuick(); }
    };
  }
  renderQuick();

  function renderWeekly(){
    const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    const data=JSON.parse(localStorage.getItem(WEEK)||'{}'); const wrap=Q('#weeklyWrap'); if(!wrap) return;
    wrap.innerHTML='';
    days.forEach(d=>{
      const arr=data[d]||[];
      const card=document.createElement('div'); card.className='card';
      card.innerHTML=`<div class="h">${d}</div>
        <div class="row"><input id="w_${d}" class="input" placeholder="Task"/><button class="btn" data-add="${d}">Add</button></div>
        <div class="list">${arr.map(t=>`<div class="flex"><span>${t.done?'✅ ':''}${t.text}</span>
          <button class="btn outline" data-t="${d}|${t.id}" data-op="done">${t.done?'Undo':'Done'}</button>
          <button class="btn outline" data-t="${d}|${t.id}" data-op="del">Delete</button></div>`).join('')}</div>`;
      wrap.appendChild(card);
    });
    wrap.onclick=e=>{
      if(e.target.dataset.add){
        const d=e.target.dataset.add, v=Q('#w_'+d).value.trim(); if(!v) return;
        (data[d]=data[d]||[]).push({id:crypto.randomUUID(),text:v,done:false});
        localStorage.setItem(WEEK,JSON.stringify(data)); renderWeekly();
      }
      if(e.target.dataset.t){
        const [d,id]=e.target.dataset.t.split('|'); const op=e.target.dataset.op;
        const arr=data[d]||[]; const i=arr.findIndex(x=>x.id===id); if(i<0) return;
        if(op==='done'){ arr[i].done=!arr[i].done; }
        if(op==='del'){ arr.splice(i,1); }
        data[d]=arr; localStorage.setItem(WEEK,JSON.stringify(data)); renderWeekly();
      }
    };
  }
  renderWeekly();
}

/* ========================================================================
   PRODUCTS (list page)
   ======================================================================== */
function initProducts(){
  Q('#pAdd')?.addEventListener('click', async ()=>{
    const p = {
      name: Q('#pName').value.trim(),
      sku: Q('#pSku').value.trim(),
      cost_china: +Q('#pCost').value || 0,
      ship_china_to_kenya: +Q('#pShip').value || 0,
      margin_budget: +Q('#pMB').value || 0
    };
    if(!p.name) return alert('Name required');
    await api('/api/products',{method:'POST', body: JSON.stringify(p)});
    await preloadProducts(); fillGlobalSelects(); renderProductsTable(); alert('Product added');
  });
  renderProductsTable();
}

function renderProductsTable(){
  const tb = Q('#productsTable tbody'); if(!tb) return;
  tb.innerHTML = state.products.map(p=>`
    <tr>
      <td>${p.name}</td>
      <td>${p.sku||'-'}</td>
      <td><span class="badge ${p.status==='paused'?'muted':''}">${p.status||'active'}</span></td>
      <td>
        <a class="btn" href="/product.html?id=${p.id}">Open</a>
        <button class="btn outline" data-p="${p.id}" data-op="pause">${p.status==='active'?'Pause':'Run'}</button>
        <button class="btn outline" data-p="${p.id}" data-op="del">Delete</button>
      </td>
    </tr>
  `).join('') || `<tr><td colspan="4" class="muted">No products</td></tr>`;

  tb.onclick = async e=>{
    const id = e.target.dataset.p, op = e.target.dataset.op; if(!id) return;
    if(op==='pause'){
      const p = state.products.find(x=>x.id===id);
      const ns = p.status==='active' ? 'paused' : 'active';
      await api(`/api/products/${id}/status`,{method:'POST', body: JSON.stringify({status: ns})});
      await preloadProducts(); renderProductsTable();
    }
    if(op==='del'){
      if(!confirm('Delete product and ALL its data?')) return;
      await api('/api/products/'+id,{method:'DELETE'}); // backend cascades deletions
      await preloadProducts(); fillGlobalSelects(); renderProductsTable(); renderStockAndSpendByCountry(); renderKpis();
    }
  };
}

/* ========================================================================
   PERFORMANCE
   ======================================================================== */
function initPerformance(){
  // Top delivered products from remittances
  Q('#pfRun')?.addEventListener('click', async ()=>{
    const quick = Q('#pfQuick')?.value;
    let start = Q('#pfStart')?.value, end = Q('#pfEnd')?.value;
    if (quick && quick!=='custom'){ const d=new Date(); d.setDate(d.getDate()-(+quick)); start=d.toISOString().slice(0,10); end=todayISO(); }
    const c = Q('#pfCountry')?.value || '';
    const qs=[]; if(start)qs.push('start='+start); if(end)qs.push('end='+end);
    const r = await api('/api/remittances'+(qs.length?('?'+qs.join('&')):''));
    const prodMap = Object.fromEntries(state.products.map(p=>[p.id,p]));
    const rows = (r.remittances||[])
      .filter(x=>x.country.toLowerCase()!=='china')
      .filter(x=>!c || x.country===c);

    const byP={};
    rows.forEach(x=>{
      const m = byP[x.productId] || (byP[x.productId] = {name: (prodMap[x.productId]?.name||x.productId), pieces:0, ad:0, base:0, profit:0});
      const pcs = +x.pieces||0;
      m.pieces += pcs;
      m.ad += +x.adSpend||0;
      const base = ((+prodMap[x.productId]?.cost_china||0) + (+prodMap[x.productId]?.ship_china_to_kenya||0)) * pcs;
      m.base += base;
      const extra = (+x.extraPerPiece||0) * pcs;
      m.profit += (+x.revenue||0) - (+x.adSpend||0) - base - extra;
    });

    Q('#pfTable tbody').innerHTML = Object.values(byP).sort((a,b)=>b.pieces-a.pieces).map(it =>
      `<tr><td>${it.name}</td><td>${fmt(it.pieces)}</td><td>${fmt(it.ad)}</td><td>${fmt(it.base)}</td><td>${fmt(it.profit)}</td><td>${it.pieces?fmt(it.profit/it.pieces):'0'}</td></tr>`
    ).join('') || `<tr><td colspan="6" class="muted">No data</td></tr>`;
  });

  // Remittance report create
  Q('#rAdd')?.addEventListener('click', async ()=>{
    const payload = {
      start: Q('#rStart').value, end: Q('#rEnd').value,
      country: Q('#rCountry').value, productId: Q('#rProduct').value,
      orders: +Q('#rOrders').value || 0, pieces: +Q('#rPieces').value || 0,
      revenue: +Q('#rRev').value || 0, adSpend: +Q('#rAds').value || 0,
      extraPerPiece: +Q('#rExtra').value || 0
    };
    if(!payload.start||!payload.end) return alert('Select dates'); 
    await api('/api/remittances',{method:'POST', body: JSON.stringify(payload)});
    Q('#rMsg').textContent='Saved.'; setTimeout(()=>Q('#rMsg').textContent='',1500);
  });

  // Lifetime Product Performance (global)
  Q('#lpRun')?.addEventListener('click', async ()=>{
    const pid = Q('#lpProduct')?.value || '';
    const s = Q('#lpStart')?.value, e = Q('#lpEnd')?.value;
    const qs=[]; if(s)qs.push('start='+s); if(e)qs.push('end='+e);
    const r = await api('/api/remittances'+(qs.length?('?'+qs.join('&')):''));
    const list = (r.remittances||[]).filter(x=>x.country.toLowerCase()!=='china').filter(x=>!pid || x.productId===pid);

    const prodMap = Object.fromEntries(state.products.map(p=>[p.id,p]));
    const byPC={}; // key productId|country
    list.forEach(x=>{
      const k = `${x.productId}|${x.country}`;
      const acc = byPC[k] || (byPC[k]={product:(prodMap[x.productId]?.name||x.productId), country:x.country, rev:0, ad:0, ship:0, base:0, pcs:0, profit:0});
      const pcs=+x.pieces||0, extra=(+x.extraPerPiece||0)*pcs;
      acc.rev+=+x.revenue||0; acc.ad+=+x.adSpend||0; acc.ship+=extra; acc.pcs+=pcs;
      const base = ((+prodMap[x.productId]?.cost_china||0)+(+prodMap[x.productId]?.ship_china_to_kenya||0))*pcs;
      acc.base+=base; acc.profit += (+x.revenue||0) - (+x.adSpend||0) - extra - base;
    });

    let R=0,A=0,S=0,B=0,P=0,PCS=0;
    Q('#lifetimeBody').innerHTML = Object.values(byPC).map(v=>{
      R+=v.rev; A+=v.ad; S+=v.ship; B+=v.base; P+=v.profit; PCS+=v.pcs;
      return `<tr><td>${v.product}</td><td>${v.country}</td><td>${fmt(v.rev)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.ship)}</td><td>${fmt(v.base)}</td><td>${fmt(v.pcs)}</td><td>${fmt(v.profit)}</td></tr>`;
    }).join('') || `<tr><td colspan="8" class="muted">No data</td></tr>`;
    Q('#ltRevT').textContent=fmt(R); Q('#ltAdT').textContent=fmt(A); Q('#ltShipT').textContent=fmt(S);
    Q('#ltBaseT').textContent=fmt(B); Q('#ltPiecesT').textContent=fmt(PCS); Q('#ltProfitT').textContent=fmt(P);
  });
}

/* ========================================================================
   FINANCE
   ======================================================================== */
async function initFinance(){
  await loadFinanceCats();

  // Add category
  Q('#fcAdd')?.addEventListener('click', async ()=>{
    const type=Q('#fcType').value, name=Q('#fcName').value.trim();
    if(!name) return;
    await api('/api/finance/categories',{method:'POST', body: JSON.stringify({type,name})});
    Q('#fcName').value=''; await loadFinanceCats();
  });

  // Delete category (chips are buttons)
  Q('#fcDebits')?.addEventListener('click', async e=>{
    if(!e.target.dataset?.cat) return;
    await api(`/api/finance/categories?type=debit&name=${encodeURIComponent(e.target.dataset.cat)}`,{method:'DELETE'});
    await loadFinanceCats();
  });
  Q('#fcCredits')?.addEventListener('click', async e=>{
    if(!e.target.dataset?.cat) return;
    await api(`/api/finance/categories?type=credit&name=${encodeURIComponent(e.target.dataset.cat)}`,{method:'DELETE'});
    await loadFinanceCats();
  });

  // Add entry (supports optional date range if inputs exist)
  Q('#feAdd')?.addEventListener('click', async ()=>{
    const single = Q('#feDate')?.value;
    const rangeS = Q('#feDateStart')?.value, rangeE = Q('#feDateEnd')?.value;
    const category = Q('#feCat').value, type = Q('#feType').value, amount = +Q('#feAmt').value||0, note = Q('#feNote').value;

    if (rangeS && rangeE) {
      // create one entry per day in range
      const s=new Date(rangeS), e=new Date(rangeE);
      const days=[]; for (let d=new Date(s); d<=e; d.setDate(d.getDate()+1)) days.push(d.toISOString().slice(0,10));
      for (const d of days) await api('/api/finance/entries',{method:'POST', body: JSON.stringify({date:d, type, category, amount, note})});
    } else {
      if (!single) return alert('Pick a date');
      await api('/api/finance/entries',{method:'POST', body: JSON.stringify({date:single, type, category, amount, note})});
    }
    Q('#feNote').value=''; Q('#feAmt').value='';
    renderFinancePeriod();
  });

  Q('#feRun')?.addEventListener('click', renderFinancePeriod);
  renderFinancePeriod();
}

async function loadFinanceCats(){
  try{
    const cats = await api('/api/finance/categories');
    state.categories=cats;
    Q('#fcDebits') && (Q('#fcDebits').innerHTML = cats.debit.map(c=>`<button class="chip danger" data-cat="${c}">${c} ×</button>`).join('') || '—');
    Q('#fcCredits') && (Q('#fcCredits').innerHTML = cats.credit.map(c=>`<button class="chip" data-cat="${c}">${c} ×</button>`).join('') || '—');
    const all=[...cats.debit,...cats.credit].sort();
    Q('#feCat') && (Q('#feCat').innerHTML = `<option value="" disabled selected>Select category</option>` + all.map(c=>`<option>${c}</option>`).join(''));
  }catch{}
}

async function renderFinancePeriod(){
  const s=Q('#fes')?.value, e=Q('#fee')?.value;
  const r = await api('/api/finance/entries'+((s||e)?`?start=${s||''}&end=${e||''}`:''));
  const entries = r.entries||[];
  Q('#runBalance') && (Q('#runBalance').textContent = fmt(r.running||0)+' USD');
  Q('#feBalance') && (Q('#feBalance').textContent = 'Period Balance: '+fmt(r.balance||0)+' USD');

  const tb=Q('#feTable tbody');
  if(tb) tb.innerHTML = entries.map(x=>`<tr>
      <td>${x.date}</td><td>${x.type}</td><td>${x.category}</td><td>${fmt(x.amount)}</td><td>${x.note||''}</td>
      <td><button class="btn outline" data-del="${x.id}">Delete</button></td>
    </tr>`).join('') || `<tr><td colspan="6" class="muted">No entries</td></tr>`;
  tb?.addEventListener('click', async e=>{
    if(e.target.dataset.del){
      await api('/api/finance/entries/'+e.target.dataset.del,{method:'DELETE'});
      renderFinancePeriod();
    }
  },{once:true});
}

/* ========================================================================
   SETTINGS
   ======================================================================== */
function initSettings(){
  // Add/delete countries (delete handled server-side through product-safe guards)
  Q('#ctyAdd')?.addEventListener('click', async ()=>{
    const name=Q('#cty').value.trim(); if(!name) return;
    await api('/api/countries',{method:'POST', body: JSON.stringify({name})});
    const m = await api('/api/meta'); state.countries=m.countries||[];
    fillGlobalSelects(); renderCountryChips();
  });
  renderCountryChips();

  // Edit product info
  const sel=Q('#epSelect');
  if(sel){
    sel.innerHTML = `<option value="">Select product…</option>` + state.products.map(p=>`<option value="${p.id}">${p.name} (${p.sku||'—'})</option>`).join('');
    sel.onchange = ()=>{
      const p = state.products.find(x=>x.id===sel.value); if(!p) return;
      Q('#epName').value=p.name; Q('#epSku').value=p.sku||'';
      Q('#epCost').value=p.cost_china||0; Q('#epShip').value=p.ship_china_to_kenya||0; Q('#epMB').value=p.margin_budget||0;
    };
    Q('#epSave')?.addEventListener('click', async ()=>{
      const id=sel.value; if(!id) return alert('Choose a product');
      const up={ name:Q('#epName').value, sku:Q('#epSku').value, cost_china:+Q('#epCost').value||0,
        ship_china_to_kenya:+Q('#epShip').value||0, margin_budget:+Q('#epMB').value||0 };
      await api('/api/products/'+id,{method:'PUT', body: JSON.stringify(up)});
      await preloadProducts(); alert('Saved');
    });
  }

  // Snapshots
  Q('#snapSave')?.addEventListener('click', async ()=>{
    const name = Q('#snapName').value.trim()||prompt('Name this snapshot')||'Manual';
    await api('/api/snapshots',{method:'POST', body: JSON.stringify({name})});
    renderSnapshots();
  });
  renderSnapshots();
}

function renderCountryChips(){
  const list=Q('#ctyList'); if(!list) return;
  const noChina=state.countries.map(c=>({c,block:c.toLowerCase()==='china'}));
  list.innerHTML = noChina.map(o=> o.block
    ? `<span class="chip muted" title="China can’t be deleted">${o.c}</span>`
    : `<span class="chip">${o.c} <button class="mini danger" onclick="(async()=>{await fetch('/api/countries/${encodeURIComponent(o.c)}',{method:'DELETE',credentials:'include'}); const m=await api('/api/meta'); state.countries=m.countries||[]; fillGlobalSelects(); renderCountryChips();})()">×</button></span>`
  ).join('') || '—';
}

async function renderSnapshots(){
  const r = await api('/api/snapshots');
  const tb=Q('#snapList'); if(!tb) return;
  tb.innerHTML = (r.snapshots||[]).map(s=>`<tr>
      <td>${s.name}</td><td>${s.file.split('/').pop()}</td>
      <td>
        <button class="btn outline" data-push="${s.file}">Push</button>
        <button class="btn outline danger" data-del="${s.id}">Delete</button>
      </td>
    </tr>`).join('') || `<tr><td colspan="3" class="muted">No snapshots yet</td></tr>`;
  tb.onclick = async e=>{
    if(e.target.dataset.push){
      await api('/api/snapshots/restore',{method:'POST', body: JSON.stringify({file:e.target.dataset.push})});
      alert('System restored'); // keep snapshot (do NOT delete after push)
      location.reload();
    }
    if(e.target.dataset.del){
      if(!confirm('Delete snapshot?')) return;
      await api('/api/snapshots/'+e.target.dataset.del,{method:'DELETE'});
      renderSnapshots();
    }
  };
}

/* ========================================================================
   PRODUCT PAGE
   ======================================================================== */
async function loadProduct(id){ await preloadProducts(); state.product = state.products.find(p=>p.id===id)||null; }

function renderProductPage(){
  if(!state.product){ alert('Product not found'); location.href='/'; return; }
  Q('#pdTitle').textContent = state.product.name;
  Q('#pdSku').textContent   = state.product.sku ? `SKU: ${state.product.sku}` : '';
  fillGlobalSelects();
  bindProductHandlers();
  refreshProductSections();
}

function bindProductHandlers(){
  // Manual per-country budget
  Q('#pdPBSave')?.addEventListener('click', async ()=>{
    const c=Q('#pdPBCountry').value, v=+Q('#pdPBValue').value||0;
    const p={ budgets: state.product.budgets||{} }; p.budgets[c]=v;
    await api('/api/products/'+state.product.id,{method:'PUT', body: JSON.stringify(p)});
    await loadProduct(state.product.id); renderPBTable();
  });

  // Daily ad spend for this product
  Q('#pdAdSave')?.addEventListener('click', async ()=>{
    const payload = {
      productId: state.product.id,
      country: Q('#pdAdCountry').value,
      platform: Q('#pdAdPlatform').value,
      amount: +Q('#pdAdAmount').value || 0
    };
    await api('/api/adspend',{method:'POST', body: JSON.stringify(payload)});
    refreshProductSections();
  });

  // Remittances (kept on performance page; here we leave only display)
  Q('#pdLPRun')?.addEventListener('click', renderProductLifetime);

  // Shipments for product
  Q('#pdMvAdd')?.addEventListener('click', async ()=>{
    const payload = {
      productId: state.product.id,
      fromCountry: Q('#pdMvFrom').value,
      toCountry: Q('#pdMvTo').value,
      qty: +Q('#pdMvQty').value||0,
      shipCost: +Q('#pdMvShip').value||0,
      departedAt: todayISO(), arrivedAt: null
    };
    await api('/api/shipments',{method:'POST', body: JSON.stringify(payload)});
    refreshProductSections();
  });

  // Influencers
  Q('#pdInfAdd')?.addEventListener('click', async ()=>{
    const payload = { name: Q('#pdInfName').value.trim(), social: Q('#pdInfSocial').value.trim(), country: Q('#pdInfCountry').value };
    if(!payload.name) return alert('Name required');
    await api('/api/influencers',{method:'POST', body: JSON.stringify(payload)});
    Q('#pdInfName').value=''; Q('#pdInfSocial').value='';
    renderInfluencers();
  });
  Q('#pdInfSpendAdd')?.addEventListener('click', async ()=>{
    const payload = { date: Q('#pdInfDate').value||todayISO(), influencerId: Q('#pdInfSelect').value, country: Q('#pdInfCountry').value, productId: state.product.id, amount: +Q('#pdInfAmount').value||0 };
    if(!payload.influencerId) return alert('Select influencer');
    await api('/api/influencers/spend',{method:'POST', body: JSON.stringify(payload)}); renderInfluencers();
  });
  Q('#pdInfRun')?.addEventListener('click', renderInfluencers);
}

async function refreshProductSections(){
  await loadProduct(state.product.id);
  renderProductStockAd();
  renderPBTable();
  renderProductAdList();
  renderProductTransit();
  renderProductLifetime();
  renderInfluencers();
}

/* -- Stock & Ad Spend by Country (product; China excluded) -- */
async function renderProductStockAd(){
  const tb=Q('#pdStockBody'); if(!tb) return;
  const noChina = state.countries.filter(c=>c.toLowerCase()!=='china');
  const per={}; noChina.forEach(c=>per[c]={stock:0, ad:0});

  const s = await api('/api/shipments');
  (s.shipments||[]).filter(x=>x.productId===state.product.id && x.arrivedAt).forEach(sp=>{
    const to=(sp.toCountry||sp.to), from=(sp.fromCountry||sp.from), q=(+sp.qty||0);
    if (per[to]!==undefined) per[to].stock += q;
    if (per[from]!==undefined) per[from].stock -= q;
  });

  const r = await api('/api/remittances');
  (r.remittances||[]).filter(x=>x.productId===state.product.id).forEach(rr=>{
    if(per[rr.country]!==undefined) per[rr.country].stock -= (+rr.pieces||0);
  });

  const a = await api('/api/adspend');
  (a.adSpends||[]).filter(x=>x.productId===state.product.id).forEach(ad=>{
    if(per[ad.country]!==undefined) per[ad.country].ad += (+ad.amount||0);
  });

  let st=0, at=0;
  tb.innerHTML = Object.entries(per).map(([c,v])=>{ st+=v.stock; at+=v.ad; return `<tr><td>${c}</td><td>${fmt(v.stock)}</td><td>${fmt(v.ad)}</td></tr>`; }).join('') || `<tr><td colspan="3" class="muted">No data</td></tr>`;
  Q('#pdStockTotal').textContent=fmt(st); Q('#pdAdTotal').textContent=fmt(at);
}

/* -- Manual budget table (per country; China excluded) -- */
function renderPBTable(){
  const tb=Q('#pdPBBBody'); if(!tb) return;
  const map=state.product.budgets||{};
  const noChina = state.countries.filter(c=>c.toLowerCase()!=='china');
  tb.innerHTML = noChina.map(c=>`<tr><td>${c}</td><td>${fmt(map[c]||0)}</td><td><button class="btn outline" data-clear="${c}">Clear</button></td></tr>`).join('') || `<tr><td colspan="3" class="muted">No countries</td></tr>`;
  tb.onclick = async e=>{
    const c=e.target.dataset.clear; if(!c) return;
    const p={budgets: state.product.budgets||{}}; delete p.budgets[c];
    await api('/api/products/'+state.product.id,{method:'PUT', body: JSON.stringify(p)});
    await loadProduct(state.product.id); renderPBTable();
  };
}

/* -- ad list (product) -- */
async function renderProductAdList(){
  const a = await api('/api/adspend');
  const list=(a.adSpends||[]).filter(x=>x.productId===state.product.id && x.country.toLowerCase()!=='china');
  const tb=Q('#pdAdBody'); if(!tb) return;
  tb.innerHTML = list.map(x=>`<tr><td>${x.country}</td><td>${x.platform}</td><td>${fmt(x.amount)}</td></tr>`).join('') || `<tr><td colspan="3" class="muted">No ad spend</td></tr>`;
}

/* -- transit for this product -- */
async function renderProductTransit(){
  const s=await api('/api/shipments');
  const list=(s.shipments||[]).filter(x=>x.productId===state.product.id);
  const ck = list.filter(sp => (sp.fromCountry||sp.from||'').toLowerCase()==='china' && (sp.toCountry||sp.to||'').toLowerCase()==='kenya');
  const ic = list.filter(sp => !ck.includes(sp));
  const row = sp => `<tr data-id="${sp.id}">
      <td>${sp.id}</td><td>${(sp.fromCountry||sp.from)} → ${(sp.toCountry||sp.to)}</td>
      <td>${fmt(sp.qty)}</td><td>${fmt(sp.shipCost)}</td><td>${sp.departedAt||''}</td><td>${sp.arrivedAt||''}</td>
      <td><button class="btn outline act-arrived">Mark Arrived</button><button class="btn outline act-edit">Edit</button><button class="btn outline act-del">Delete</button></td>
    </tr>`;
  const tb1=Q('#pdShipCKBody'), tb2=Q('#pdShipICBody');
  tb1 && (tb1.innerHTML = ck.map(row).join('') || `<tr><td colspan="7" class="muted">No shipments</td></tr>`);
  tb2 && (tb2.innerHTML = ic.map(row).join('') || `<tr><td colspan="7" class="muted">No shipments</td></tr>`);
  [tb1,tb2].forEach(tb=>{
    tb && (tb.onclick = async e=>{
      const tr=e.target.closest('tr[data-id]'); if(!tr) return; const id=tr.dataset.id;
      if(e.target.classList.contains('act-arrived')){ const date=prompt('Arrival date (YYYY-MM-DD)',todayISO()); if(!date) return; await api('/api/shipments/'+id,{method:'PUT', body: JSON.stringify({arrivedAt:date})}); renderProductTransit(); renderProductStockAd();}
      if(e.target.classList.contains('act-edit')){ const qty=+prompt('New qty?')||0; const shipCost=+prompt('New shipping cost?')||0; await api('/api/shipments/'+id,{method:'PUT', body: JSON.stringify({qty, shipCost})}); renderProductTransit();}
      if(e.target.classList.contains('act-del')){ if(!confirm('Delete?')) return; await api('/api/shipments/'+id,{method:'DELETE'}); renderProductTransit();}
    });
  });
}

/* -- lifetime (this product) with date filter -- */
async function renderProductLifetime(){
  const s=Q('#pdLPStart')?.value, e=Q('#pdLPEnd')?.value;
  const r = await api('/api/remittances'+((s||e)?`?start=${s||''}&end=${e||''}`:''));
  const list=(r.remittances||[]).filter(x=>x.productId===state.product.id && x.country.toLowerCase()!=='china');

  const prod=state.product; const baseP = (+prod.cost_china||0)+(+prod.ship_china_to_kenya||0);
  const byC={};
  list.forEach(x=>{
    const k=x.country; const pcs=+x.pieces||0; const extra=(+x.extraPerPiece||0)*pcs;
    byC[k]=byC[k]||{rev:0, ad:0, ship:0, base:0, pcs:0, profit:0};
    byC[k].rev+=+x.revenue||0; byC[k].ad+=+x.adSpend||0; byC[k].ship+=extra; byC[k].base+=baseP*pcs; byC[k].pcs+=pcs;
  });
  Object.values(byC).forEach(v=>v.profit=v.rev-v.ad-v.ship-v.base);

  const tb=Q('#pdLPBody'); if(!tb) return;
  let R=0,A=0,S=0,B=0,P=0,PCS=0;
  tb.innerHTML = Object.entries(byC).map(([c,v])=>{R+=v.rev;A+=v.ad;S+=v.ship;B+=v.base;P+=v.profit;PCS+=v.pcs;
    return `<tr><td>${c}</td><td>${fmt(v.rev)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.ship)}</td><td>${fmt(v.base)}</td><td>${fmt(v.pcs)}</td><td>${fmt(v.profit)}</td></tr>`;
  }).join('') || `<tr><td colspan="7" class="muted">No data</td></tr>`;
  Q('#pdLPRevT').textContent=fmt(R); Q('#pdLPAdT').textContent=fmt(A); Q('#pdLPShipT').textContent=fmt(S);
  Q('#pdLPBaseT').textContent=fmt(B); Q('#pdLPPcsT').textContent=fmt(PCS); Q('#pdLPProfitT').textContent=fmt(P);
}

/* -- influencers (product) -- */
async function renderInfluencers(){
  const infs = await api('/api/influencers');
  const spends = await api('/api/influencers/spend');
  const sel = Q('#pdInfSelect'); if (sel) sel.innerHTML = (infs.influencers||[]).map(i=>`<option value="${i.id}">${i.name}</option>`).join('');

  const s=Q('#pdInfStart')?.value, e=Q('#pdInfEnd')?.value, c=Q('#pdInfFilterCountry')?.value||'';
  const list = (spends.spends||[]).filter(x=>x.productId===state.product.id).filter(x=>(!c||x.country===c)).filter(x=>(!s||x.date>=s)&&(!e||x.date<=e));
  const map = Object.fromEntries((infs.influencers||[]).map(i=>[i.id,i]));

  let T=0; const tb=Q('#pdInfBody'); if(!tb) return;
  tb.innerHTML = list.map(x=>{T+=(+x.amount||0); const i=map[x.influencerId]||{};
    return `<tr><td>${x.date}</td><td>${x.country}</td><td>${i.name||'-'}</td><td>${i.social||'-'}</td><td>${fmt(x.amount)}</td>
      <td><button class="btn outline" data-del="${x.id}">Delete</button></td></tr>`;
  }).join('') || `<tr><td colspan="6" class="muted">No spends</td></tr>`;
  Q('#pdInfTotal').textContent = fmt(T);
  tb.onclick = async e=>{ if(e.target.dataset.del){ await api('/api/influencers/spend/'+e.target.dataset.del,{method:'DELETE'}); renderInfluencers(); } };
}

/* ================================================================
   NAV
   ================================================================ */
function initNav(){
  QA('.nav a[data-view]')?.forEach(a=>a.addEventListener('click',e=>{
    e.preventDefault();
    const v=a.dataset.view;
    ['home','products','performance','finance','settings'].forEach(id=>{ const el=Q('#'+id); if(el) el.style.display=(id===v)?'':'none'; });
    QA('.nav a').forEach(x=>x.classList.toggle('active',x===a));
    if (v==='home'){ renderKpis(); renderStockAndSpendByCountry(); renderTransitTables(); }
  }));
}

/* ================================================================
   BOOT
   ================================================================ */
gate();
