
// ===============================
// EAS Tracker — Front-end logic
// Works for index.html + product.html
// ===============================

/* ---------- helpers ---------- */
const Q  = (s, r=document)=>r.querySelector(s);
const QA = (s, r=document)=>Array.from(r.querySelectorAll(s));
const fmt = n => (Number(n||0)).toLocaleString(undefined,{maximumFractionDigits:2});
const todayISO = () => new Date().toISOString().slice(0,10);
const getQuery = k => new URLSearchParams(location.search).get(k);
const noop = ()=>{};

/* ---------- API ---------- */
async function api(path, opts={}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: {'Content-Type':'application/json'},
    ...opts
  });
  const ct = res.headers.get('content-type')||'';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data?.error || data || `HTTP ${res.status}`);
  return data;
}

/* ---------- state ---------- */
const state = {
  countries: [],
  products: [],
  categories: { debit:[], credit:[] },
  productId: getQuery('id'),
  product: null
};
const visibleCountries = () => state.countries.filter(c => c.toLowerCase() !== 'china');

/* ---------- auth / boot ---------- */
async function gate() {
  try {
    const meta = await api('/api/meta');
    state.countries = meta.countries || [];
    Q('#login')?.classList.add('hide');
    Q('#main')?.removeAttribute('style');

    await preloadProducts();
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
  } catch (e) {
    // show login
    Q('#login')?.classList.remove('hide');
    Q('#main')?.setAttribute('style','display:none');
  }
}

Q('#loginBtn')?.addEventListener('click', async () => {
  try {
    const pw = Q('#pw').value;
    await api('/api/auth',{method:'POST', body:JSON.stringify({password:pw})});
    await gate();
  } catch (e) {
    alert('Wrong password');
  }
});
Q('#logoutLink')?.addEventListener('click', async e=>{
  e.preventDefault();
  try { await api('/api/auth',{method:'POST', body:JSON.stringify({password:'logout'})}); } catch {}
  location.reload();
});

/* ---------- preload ---------- */
async function preloadProducts() {
  try {
    const r = await api('/api/products');
    state.products = r.products || [];
  } catch { state.products = []; }
}

function fillSelect(el, arr, {placeholder=null, value='value', label='label'}={}) {
  if (!el) return;
  const options = [];
  if (placeholder) options.push(`<option value="">${placeholder}</option>`);
  options.push(...arr.map(a=>{
    if (typeof a === 'string') return `<option value="${a}">${a}</option>`;
    return `<option value="${a[value]}">${a[label]}</option>`;
  }));
  el.innerHTML = options.join('');
}

function fillGlobalSelects() {
  // Countries (exclude china everywhere EXCEPT movement + transit)
  const exclChina = visibleCountries();

  // Dashboard filters/inputs
  fillSelect(Q('#adCountry'), exclChina);
  fillSelect(Q('#pcCountry'), [{value:'',label:'All countries'}, ...exclChina.map(c=>({value:c,label:c}))]);

  // Performance
  fillSelect(Q('#pfCountry'), [{value:'',label:'All countries'}, ...exclChina.map(c=>({value:c,label:c}))]);
  fillSelect(Q('#rCountry'), exclChina);

  // Finance (no country selection needed here)

  // Settings: country add shown as chips later

  // Products dropdowns (use only existing products)
  const prodOpts = state.products.map(p=>({value:p.id, label: `${p.name}${p.sku?` (${p.sku})`:''}`}));
  fillSelect(Q('#adProduct'), prodOpts, {placeholder:'Select product'});
  fillSelect(Q('#mvProduct'), prodOpts, {placeholder:'Select product'});
  fillSelect(Q('#rProduct'), prodOpts, {placeholder:'Select product'});

  // Movement (allow CHINA here)
  fillSelect(Q('#mvFrom'), state.countries);
  fillSelect(Q('#mvTo'),   state.countries);
}

/* ======================================================================
   DASHBOARD
   ====================================================================== */
async function initDashboard() {
  fillGlobalSelects();
  await renderKpis();
  await renderStockAndSpendByCountry();
  await initWeeklyDelivered();
  initDailyAdSpend();
  initMovements();
  await renderTransitTables();
  initProfitByCountry();
  initTodos();
}

/* KPIs */
async function renderKpis() {
  Q('#kpiProducts') && (Q('#kpiProducts').textContent = state.products.length);
  Q('#kpiCountries') && (Q('#kpiCountries').textContent = visibleCountries().length);

  // Transit count (not arrived)
  try {
    const s = await api('/api/shipments');
    const live = (s.shipments||[]).filter(x=>!x.arrivedAt).length;
    Q('#kpiTransit') && (Q('#kpiTransit').textContent = live);
  } catch { Q('#kpiTransit') && (Q('#kpiTransit').textContent = '—'); }

  // Total ad spend = sum of adspend (all products) — but exclude CHINA buckets (they don't have country China anyway)
  try {
    const a = await api('/api/adspend');
    const total = (a.adSpends||[]).reduce((t,x)=>t + (+x.amount||0), 0);
    Q('#kpiAdSpend') && (Q('#kpiAdSpend').textContent = `${fmt(total)} USD`);
  } catch { Q('#kpiAdSpend') && (Q('#kpiAdSpend').textContent = '—'); }

  // Delivered Mon–Sun: use weekly grid totals if present; fallback to total deliveries
  try {
    const total = computeWeeklyGridGrandTotal();
    if (total != null) {
      Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = fmt(total));
    } else {
      const r = await api('/api/deliveries');
      const sum = (r.deliveries||[]).reduce((t,x)=>t+(+x.delivered||0),0);
      Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = fmt(sum));
    }
  } catch { Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = '—'); }
}

/* Stock & Spend by Country (EXCLUDE CHINA) */
async function renderStockAndSpendByCountry() {
  const body = Q('#stockByCountryBody'); if (!body) return;
  const footStock = Q('#stockTotal'); const footAd = Q('#adTotal');

  const per = {};
  visibleCountries().forEach(c => per[c] = { stock:0, ad:0 });

  // arrived shipments => add to dest; deduct from origin (both only if visible)
  try {
    const s = await api('/api/shipments');
    (s.shipments||[]).forEach(sp=>{
      if (!sp.arrivedAt) return;
      const to = (sp.toCountry||'').toLowerCase();
      const from = (sp.fromCountry||'').toLowerCase();
      const qty = +sp.qty || 0;

      if (to !== 'china') {
        per[sp.toCountry] = per[sp.toCountry] || {stock:0, ad:0};
        per[sp.toCountry].stock += qty;
      }
      if (from !== 'china') {
        per[sp.fromCountry] = per[sp.fromCountry] || {stock:0, ad:0};
        per[sp.fromCountry].stock -= qty;
      }
    });
  } catch {}

  // ad spend by country (as entered, china should not be used)
  try {
    const a = await api('/api/adspend');
    (a.adSpends||[]).forEach(x=>{
      if ((x.country||'').toLowerCase() === 'china') return;
      per[x.country] = per[x.country] || {stock:0, ad:0};
      per[x.country].ad += (+x.amount||0);
    });
  } catch {}

  // render
  let st=0, adt=0;
  const rows = Object.entries(per).map(([c,v])=>{
    st += v.stock; adt += v.ad;
    return `<tr><td>${c}</td><td>${fmt(v.stock)}</td><td>${fmt(v.ad)}</td></tr>`;
  }).join('') || `<tr><td colspan="3" class="muted">No data</td></tr>`;
  body.innerHTML = rows;
  if (footStock) footStock.textContent = fmt(st);
  if (footAd) footAd.textContent = fmt(adt);
}

/* Weekly Delivered grid (EXCLUDE CHINA) */
function mondayOf(dateISO) {
  const d = new Date(dateISO); const day = (d.getDay()+6)%7; d.setDate(d.getDate()-day); return d;
}
function daysOfWeek(startISO) {
  const m = mondayOf(startISO);
  return [...Array(7)].map((_,i)=>{const d=new Date(m); d.setDate(m.getDate()+i); return d.toISOString().slice(0,10);});
}
function computeWeeklyGridGrandTotal() {
  const grid = Q('#weeklyBody'); if (!grid) return null;
  const inputs = QA('input.wd', grid);
  if (!inputs.length) return null;
  return inputs.reduce((s,i)=>s+(+i.value||0),0);
}

async function initWeeklyDelivered() {
  const head = Q('#weeklyHead'); const body = Q('#weeklyBody'); const range = Q('#weeklyRange');
  if (!head||!body||!range) return;

  let anchor = todayISO();
  const paint = async ()=>{
    const days = daysOfWeek(anchor);
    const dayNames = days.map(d=> new Date(d).toLocaleDateString(undefined,{weekday:'short'})+'<br>'+d );
    head.innerHTML = `<tr><th>Country</th>${dayNames.map(x=>`<th>${x}</th>`).join('')}<th>Total</th></tr>`;
    // rows
    body.innerHTML = visibleCountries().map(c=>{
      const cells = days.map(d=>`<td><input class="input wd" data-country="${c}" data-date="${d}" type="number" min="0" placeholder="0"/></td>`).join('');
      return `<tr data-country="${c}"><td>${c}</td>${cells}<td class="rowT">0</td></tr>`;
    }).join('');
    range.textContent = `Week: ${days[0]} → ${days[6]}`;

    // preload existing
    try {
      const r = await api('/api/deliveries');
      const map = {};
      (r.deliveries||[]).forEach(x=> map[`${x.country}|${x.date}`] = +x.delivered||0);
      QA('input.wd').forEach(inp=>{
        const k = `${inp.dataset.country}|${inp.dataset.date}`;
        if (map[k] != null) inp.value = map[k];
      });
      computeWeeklyTotals();
    } catch {}
  };

  function computeWeeklyTotals() {
    // row
    QA('#weeklyBody tr').forEach(tr=>{
      const t = QA('input.wd',tr).reduce((s,i)=>s+(+i.value||0),0);
      Q('.rowT',tr).textContent = fmt(t);
    });
    // column
    const cols = QA('#weeklyHead th').length - 2; // 7
    let grand = 0;
    for (let ci=0; ci<cols; ci++){
      let col = 0;
      QA('#weeklyBody tr').forEach(tr=>{
        const inp = QA('input.wd',tr)[ci];
        col += (+inp.value||0);
      });
      Q(`#w${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][ci]}T`)?.textContent = fmt(col);
      grand += col;
    }
    Q('#wAllT') && (Q('#wAllT').textContent = fmt(grand));
    // sync KPI delivered
    Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = fmt(grand));
  }

  Q('#weeklyPrev')?.addEventListener('click',()=>{ const d=new Date(anchor); d.setDate(d.getDate()-7); anchor=d.toISOString().slice(0,10); paint();});
  Q('#weeklyNext')?.addEventListener('click',()=>{ const d=new Date(anchor); d.setDate(d.getDate()+7); anchor=d.toISOString().slice(0,10); paint();});
  QA('#weeklyTable')[0]?.addEventListener('input', e=>{ if (e.target.classList.contains('wd')) computeWeeklyTotals(); });

  Q('#weeklySave')?.addEventListener('click', async ()=>{
    try {
      // dumb upsert: just post non-zero cells for this week
      const payload = [];
      QA('input.wd').forEach(inp=>{
        const v = +inp.value||0;
        if (v>0) payload.push({date: inp.dataset.date, country: inp.dataset.country, delivered: v});
      });
      for (const rec of payload) await api('/api/deliveries',{method:'POST', body:JSON.stringify(rec)});
      alert('Saved!');
      await renderKpis();
    } catch(e){ alert(e.message); }
  });

  Q('#weeklyReset')?.addEventListener('click', ()=>{
    QA('input.wd').forEach(i=>i.value='');
    Q('#wMonT')&&(Q('#wMonT').textContent='0');
    Q('#wTueT')&&(Q('#wTueT').textContent='0');
    Q('#wWedT')&&(Q('#wWedT').textContent='0');
    Q('#wThuT')&&(Q('#wThuT').textContent='0');
    Q('#wFriT')&&(Q('#wFriT').textContent='0');
    Q('#wSatT')&&(Q('#wSatT').textContent='0');
    Q('#wSunT')&&(Q('#wSunT').textContent='0');
    Q('#wAllT')&&(Q('#wAllT').textContent='0');
    Q('#kpiDelivered')&&(Q('#kpiDelivered').textContent='0');
  });

  // build totals footer if not exists
  if (!Q('#wMonT')) {
    const tfoot = Q('#weeklyTable tfoot');
    if (tfoot) {
      tfoot.innerHTML = `<tr class="totals"><th>Totals</th>
        <th id="wMonT">0</th><th id="wTueT">0</th><th id="wWedT">0</th>
        <th id="wThuT">0</th><th id="wFriT">0</th><th id="wSatT">0</th><th id="wSunT">0</th>
        <th id="wAllT">0</th></tr>`;
    }
  }

  await paint();
}

/* Daily Ad Spend (dashboard) */
function initDailyAdSpend() {
  fillGlobalSelects();
  Q('#adSave')?.addEventListener('click', async ()=>{
    const productId = Q('#adProduct')?.value;
    const country   = Q('#adCountry')?.value;
    const platform  = Q('#adPlatform')?.value;
    const amount    = +Q('#adAmount')?.value || 0;
    if (!productId || !country || !platform) return alert('Missing fields');
    try {
      await api('/api/adspend',{method:'POST', body:JSON.stringify({productId,country,platform,amount})});
      alert('Saved');
      await renderStockAndSpendByCountry();
      await renderKpis();
    } catch(e){ alert(e.message); }
  });
}

/* Stock Movement (dashboard) */
function initMovements() {
  Q('#mvAdd')?.addEventListener('click', async ()=>{
    const productId = Q('#mvProduct')?.value;
    const fromCountry = Q('#mvFrom')?.value;
    const toCountry   = Q('#mvTo')?.value;
    const qty      = +Q('#mvQty')?.value || 0;
    const shipCost = +Q('#mvShip')?.value || 0;
    if (!productId || !fromCountry || !toCountry) return alert('Missing fields');
    try {
      await api('/api/shipments',{method:'POST', body:JSON.stringify({productId,fromCountry,toCountry,qty,shipCost,departedAt:todayISO(),arrivedAt:null})});
      alert('Shipment created');
      await renderTransitTables();
    } catch(e){ alert(e.message); }
  });
}

/* Transit tables (dashboard) */
async function renderTransitTables() {
  const s = await api('/api/shipments');
  const prods = Object.fromEntries(state.products.map(p=>[p.id,p.name]));

  const live = (s.shipments||[]).filter(x=>!x.arrivedAt);

  const ck = live.filter(sp => (sp.fromCountry||'').toLowerCase()==='china' && (sp.toCountry||'').toLowerCase()==='kenya');
  const ic = live.filter(sp => !( (sp.fromCountry||'').toLowerCase()==='china' && (sp.toCountry||'').toLowerCase()==='kenya'));

  const row = sp => {
    const days = sp.arrivedAt ? Math.round((+new Date(sp.arrivedAt) - +new Date(sp.departedAt))/86400000) : '';
    return `<tr>
      <td>${sp.id}</td>
      <td>${prods[sp.productId]||sp.productId}</td>
      <td>${sp.fromCountry} → ${sp.toCountry}</td>
      <td>${fmt(sp.qty)}</td>
      <td>${fmt(sp.shipCost)}</td>
      <td>${sp.departedAt||''}</td>
      <td>${sp.arrivedAt||''}</td>
      <td>${days||''}</td>
      <td>
        <button class="btn outline" data-arr="${sp.id}">Mark Arrived</button>
        <button class="btn outline" data-edit="${sp.id}">Edit</button>
        <button class="btn outline" data-del="${sp.id}">Delete</button>
      </td>
    </tr>`;
  };

  Q('#shipCKBody') && (Q('#shipCKBody').innerHTML = ck.map(row).join('') || `<tr><td colspan="9" class="muted">No transit</td></tr>`);
  Q('#shipICBody') && (Q('#shipICBody').innerHTML = ic.map(row).join('') || `<tr><td colspan="9" class="muted">No transit</td></tr>`);

  // actions
  const tbl = Q('#home');
  tbl?.addEventListener('click', async e=>{
    const id = e.target.dataset.arr || e.target.dataset.edit || e.target.dataset.del;
    if (!id) return;
    if (e.target.dataset.arr) {
      const date = prompt('Arrival date (YYYY-MM-DD)', todayISO());
      if (!date) return;
      try { await api('/api/shipments/'+id,{method:'PUT', body:JSON.stringify({arrivedAt:date})}); }
      catch(err){ return alert(err.message); }
      await renderTransitTables();
      await renderStockAndSpendByCountry();
    } else if (e.target.dataset.edit) {
      const qty = +prompt('New qty?', '') || 0;
      const shipCost = +prompt('New ship cost?', '') || 0;
      await api('/api/shipments/'+id,{method:'PUT', body:JSON.stringify({qty,shipCost})});
      await renderTransitTables();
    } else if (e.target.dataset.del) {
      if (!confirm('Delete this shipment?')) return;
      await api('/api/shipments/'+id,{method:'DELETE'});
      await renderTransitTables();
    }
  }, { once:true });
}

/* Profit by Country (EXCLUDE CHINA) */
function initProfitByCountry() {
  Q('#pcRun')?.addEventListener('click', run);
  async function run() {
    const start = Q('#pcStart')?.value;
    const end   = Q('#pcEnd')?.value;
    const onlyC = Q('#pcCountry')?.value || '';
    const r = await api('/api/remittances' + ((start||end||onlyC)?`?${[
      start?`start=${start}`:'',
      end?`end=${end}`:'',
      onlyC?`country=${encodeURIComponent(onlyC)}`:''
    ].filter(Boolean).join('&')}` : ''));

    const rows = {};
    (r.remittances||[])
      .filter(x => (x.country||'').toLowerCase() !== 'china') // exclude china
      .forEach(x=>{
        if (onlyC && x.country !== onlyC) return;
        rows[x.country] = rows[x.country] || {rev:0,ad:0,extra:0,pcs:0};
        rows[x.country].rev += (+x.revenue||0);
        rows[x.country].ad  += (+x.adSpend||0);
        rows[x.country].extra += (+x.extraPerPiece||0) * (+x.pieces||0);
        rows[x.country].pcs += (+x.pieces||0);
      });

    const tb = Q('#profitCountryBody'); if (!tb) return;
    let R=0,A=0,E=0,P=0,PCS=0;
    tb.innerHTML = Object.entries(rows).map(([c,v])=>{
      const profit = v.rev - v.ad - v.extra;
      R+=v.rev; A+=v.ad; E+=v.extra; PCS+=v.pcs; P+=profit;
      return `<tr><td>${c}</td><td>${fmt(v.rev)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.extra)}</td><td>${fmt(v.pcs)}</td><td>${fmt(profit)}</td></tr>`;
    }).join('') || `<tr><td colspan="6" class="muted">No data</td></tr>`;
    Q('#pcRevT')&&(Q('#pcRevT').textContent=fmt(R));
    Q('#pcAdT')&&(Q('#pcAdT').textContent=fmt(A));
    Q('#pcDelT')&&(Q('#pcDelT').textContent=fmt(E));
    Q('#pcPiecesT')&&(Q('#pcPiecesT').textContent=fmt(PCS));
    Q('#pcProfitT')&&(Q('#pcProfitT').textContent=fmt(P));
  }
}

/* To-Dos (localStorage) + Weekly To-Dos */
function initTodos() {
  const KEY='eas_todos'; const WEEK='eas_weekly';
  const load = k=>JSON.parse(localStorage.getItem(k)||'[]');
  const save = (k,v)=>localStorage.setItem(k, JSON.stringify(v));

  // quick list
  const listEl = Q('#todoList'); if (listEl) {
    const render = ()=>{
      const list = load(KEY);
      listEl.innerHTML = list.map(t=>`
        <div class="todo-item">
          <span>${t.done?'✅ ':''}${t.text}</span>
          <div>
            <button class="btn outline" data-done="${t.id}">${t.done?'Undo':'Done'}</button>
            <button class="btn outline" data-del="${t.id}">Delete</button>
          </div>
        </div>`).join('') || '<div class="muted">No tasks</div>';
      listEl.onclick = e=>{
        if (e.target.dataset.done) {
          const id=e.target.dataset.done; const l=load(KEY);
          const it=l.find(x=>x.id===id); it.done=!it.done; save(KEY,l); render();
        } else if (e.target.dataset.del) {
          const id=e.target.dataset.del; const l=load(KEY);
          const i=l.findIndex(x=>x.id===id); l.splice(i,1); save(KEY,l); render();
        }
      };
    };
    Q('#todoAdd')?.addEventListener('click', ()=>{
      const v=Q('#todoText').value.trim(); if(!v) return;
      const l=load(KEY); l.push({id:crypto.randomUUID(),text:v,done:false}); save(KEY,l); Q('#todoText').value=''; render();
    });
    render();
  }

  // weekly to-dos (7 columns)
  const wrap = Q('#weeklyWrap'); if (wrap) {
    const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    const data = JSON.parse(localStorage.getItem(WEEK)||'{}');
    const renderW = ()=>{
      wrap.innerHTML = '';
      days.forEach(d=>{
        const arr = data[d]||[];
        const card = document.createElement('div');
        card.className='card';
        card.innerHTML = `<div class="h">${d}</div>
          <div class="row">
            <input class="input" id="w_${d}" placeholder="Task"/>
            <button class="btn" data-add="${d}">Add</button>
          </div>
          <div>${arr.map(t=>`
            <div class="todo-item">
              <span>${t.done?'✅ ':''}${t.text}</span>
              <div>
                <button class="btn outline" data-tgl="${d}|${t.id}">${t.done?'Undo':'Done'}</button>
                <button class="btn outline" data-del="${d}|${t.id}">Delete</button>
              </div>
            </div>`).join('')}</div>`;
        wrap.appendChild(card);
      });
    };
    wrap.onclick = e=>{
      if (e.target.dataset.add) {
        const d=e.target.dataset.add; const v=Q('#w_'+d).value.trim(); if(!v) return;
        const arr=data[d]||[]; arr.push({id:crypto.randomUUID(), text:v, done:false}); data[d]=arr; localStorage.setItem(WEEK,JSON.stringify(data)); renderW();
      } else if (e.target.dataset.tgl) {
        const [d,id]=e.target.dataset.tgl.split('|'); const it=(data[d]||[]).find(x=>x.id===id); if(!it) return; it.done=!it.done; localStorage.setItem(WEEK,JSON.stringify(data)); renderW();
      } else if (e.target.dataset.del) {
        const [d,id]=e.target.dataset.del.split('|'); const arr=data[d]||[]; const i=arr.findIndex(x=>x.id===id); if(i>-1) arr.splice(i,1); data[d]=arr; localStorage.setItem(WEEK,JSON.stringify(data)); renderW();
      }
    };
    renderW();
  }
}

/* ======================================================================
   PRODUCTS LIST (index)
   ====================================================================== */
function initProducts() {
  Q('#pAdd')?.addEventListener('click', async ()=>{
    const payload = {
      name: Q('#pName').value.trim(),
      sku: Q('#pSku').value.trim(),
      cost_china: +Q('#pCost').value||0,
      ship_china_to_kenya: +Q('#pShip').value||0,
      margin_budget: +Q('#pMB').value||0
    };
    if (!payload.name) return alert('Name required');
    await api('/api/products',{method:'POST', body:JSON.stringify(payload)});
    await preloadProducts();
    renderProductsTable();
    fillGlobalSelects();
    Q('#pName').value='';Q('#pSku').value='';Q('#pCost').value='';Q('#pShip').value='';Q('#pMB').value='';
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
        <a class="btn" href="/product.html?id=${p.id}">Open</a>
        <button class="btn outline" data-del="${p.id}">Delete</button>
      </td>
    </tr>
  `).join('') || `<tr><td colspan="4" class="muted">No products</td></tr>`;

  tb.onclick = async e=>{
    if (e.target.dataset.del) {
      if (!confirm('Delete this product and all its data?')) return;
      await api('/api/products/'+e.target.dataset.del,{method:'DELETE'});
      await preloadProducts();
      renderProductsTable();
      await renderStockAndSpendByCountry();
      await renderKpis();
    }
  };
}

/* ======================================================================
   PERFORMANCE
   ====================================================================== */
function initPerformance() {
  // Top delivered
  Q('#pfRun')?.addEventListener('click', async ()=>{
    const quick = Q('#pfQuick')?.value;
    let start = Q('#pfStart')?.value, end = Q('#pfEnd')?.value;
    if (quick && quick!=='custom') {
      const d=new Date(); d.setDate(d.getDate()-(+quick)); start=d.toISOString().slice(0,10); end=todayISO();
    }
    const country = Q('#pfCountry')?.value || '';
    const r = await api('/api/remittances' + ((start||end||country)?`?${[
      start?`start=${start}`:'',
      end?`end=${end}`:'',
      country?`country=${encodeURIComponent(country)}`:''
    ].filter(Boolean).join('&')}`:''));
    const rows = {};
    const pMap = Object.fromEntries(state.products.map(p=>[p.id,p]));

    (r.remittances||[])
      .filter(x=> (x.country||'').toLowerCase()!=='china')
      .forEach(x=>{
        if (country && x.country!==country) return;
        const k = `${x.productId}|${x.country}`;
        if (!rows[k]) rows[k] = {name:(pMap[x.productId]?.name||x.productId), country:x.country, pcs:0, ad:0, prodCost:0, profit:0};
        const base = (+pMap[x.productId]?.cost_china||0) + (+pMap[x.productId]?.ship_china_to_kenya||0);
        const pcs = +x.pieces||0; const extra = (+x.extraPerPiece||0)*pcs;
        rows[k].pcs += pcs;
        rows[k].ad  += (+x.adSpend||0);
        rows[k].prodCost += base*pcs;
        rows[k].profit += (+x.revenue||0) - (+x.adSpend||0) - extra - base*pcs;
      });

    const tb = Q('#pfTable tbody'); if(!tb) return;
    tb.innerHTML = Object.values(rows).sort((a,b)=>b.pcs-a.pcs).map(it=>
      `<tr><td>${it.name}</td><td>${it.country}</td><td>${fmt(it.pcs)}</td><td>${fmt(it.ad)}</td><td>${fmt(it.prodCost)}</td><td>${fmt(it.profit)}</td><td>${it.pcs?fmt(it.profit/it.pcs):'0'}</td></tr>`
    ).join('') || `<tr><td colspan="7" class="muted">No data</td></tr>`;
  });

  // Remittance add
  Q('#rAdd')?.addEventListener('click', async ()=>{
    const payload = {
      start: Q('#rStart').value, end:Q('#rEnd').value,
      country: Q('#rCountry').value,
      productId: Q('#rProduct').value,
      orders: +Q('#rOrders').value||0,
      pieces: +Q('#rPieces').value||0,
      revenue:+Q('#rRev').value||0,
      adSpend:+Q('#rAds').value||0,
      extraPerPiece:+Q('#rExtra').value||0
    };
    if (!payload.start || !payload.end || !payload.country || !payload.productId) return alert('Missing fields');
    await api('/api/remittances',{method:'POST', body:JSON.stringify(payload)});
    Q('#rMsg')&&(Q('#rMsg').textContent='Saved ✓');
    setTimeout(()=>{Q('#rMsg')&&(Q('#rMsg').textContent='');},1500);
  });
}

/* ======================================================================
   FINANCE
   ====================================================================== */
async function initFinance() {
  await loadFinanceCats();
  Q('#fcAdd')?.addEventListener('click', addCat);
  Q('#feAdd')?.addEventListener('click', addEntry);
  Q('#feRun')?.addEventListener('click', renderFinancePeriod);
  renderFinancePeriod();

  async function addCat(){
    const type=Q('#fcType').value, name=Q('#fcName').value.trim();
    if (!name) return;
    await api('/api/finance/categories',{method:'POST', body:JSON.stringify({type,name})});
    Q('#fcName').value='';
    await loadFinanceCats();
  }
  async function addEntry(){
    const date=Q('#feDate').value, type=Q('#feType').value, category=Q('#feCat').value;
    const amount=+Q('#feAmt').value||0, note=Q('#feNote').value;
    if (!date||!category) return alert('Pick date & category');
    await api('/api/finance/entries',{method:'POST', body:JSON.stringify({date,type,category,amount,note})});
    Q('#feAmt').value=''; Q('#feNote').value='';
    await renderFinancePeriod();
  }
}
async function loadFinanceCats() {
  try {
    const cats = await api('/api/finance/categories');
    state.categories = cats;
    // list + delete buttons
    const renderList = (box, arr, type)=>{
      if (!box) return;
      box.innerHTML = (arr||[]).map(c=>`<span class="chip">${c}<button data-del-cat="${type}|${c}">×</button></span>`).join('') || '—';
      box.onclick = async e=>{
        const v=e.target.dataset.delCat; if(!v) return;
        const [t,name]=v.split('|');
        await api(`/api/finance/categories?type=${encodeURIComponent(t)}&name=${encodeURIComponent(name)}`,{method:'DELETE'});
        await loadFinanceCats();
      };
    };
    renderList(Q('#fcDebits'), cats.debit, 'debit');
    renderList(Q('#fcCredits'), cats.credit, 'credit');
    // entry category select
    const all = [...cats.debit, ...cats.credit];
    fillSelect(Q('#feCat'), all, {placeholder:'Select category'});
  } catch {}
}
async function renderFinancePeriod() {
  const start=Q('#fes')?.value, end=Q('#fee')?.value;
  const r=await api('/api/finance/entries'+((start||end)?`?${[
    start?`start=${start}`:'',
    end?`end=${end}`:''
  ].filter(Boolean).join('&')}`:''));
  const entries = r.entries||[];
  Q('#runBalance')&&(Q('#runBalance').textContent = `${fmt(r.running||0)} USD`);
  Q('#feBalance')&&(Q('#feBalance').textContent = `Period Balance: ${fmt(r.balance||0)} USD`);
  const tb = Q('#feTable tbody');
  if (tb) {
    tb.innerHTML = entries.map(e=>`
      <tr><td>${e.date}</td><td>${e.type}</td><td>${e.category}</td><td>${fmt(e.amount)}</td><td>${e.note||''}</td>
      <td><button class="btn outline" data-del-entry="${e.id}">Delete</button></td></tr>
    `).join('') || `<tr><td colspan="6" class="muted">No entries</td></tr>`;
    tb.onclick = async ev=>{
      const id = ev.target.dataset.delEntry; if(!id) return;
      await api('/api/finance/entries/'+id,{method:'DELETE'});
      await renderFinancePeriod();
    };
  }
}

/* ======================================================================
   SETTINGS
   ====================================================================== */
function initSettings() {
  // countries
  Q('#ctyAdd')?.addEventListener('click', async ()=>{
    const name = Q('#cty')?.value.trim(); if(!name) return;
    await api('/api/countries',{method:'POST', body:JSON.stringify({name})});
    Q('#cty').value='';
    const m = await api('/api/meta'); state.countries = m.countries||[];
    renderCountryChips();
    fillGlobalSelects();
  });
  renderCountryChips();

  // edit product info
  const sel = Q('#epSelect');
  if (sel) {
    fillSelect(sel, state.products.map(p=>({value:p.id,label:`${p.name}${p.sku?` (${p.sku})`:''}`})), {placeholder:'Select product…'});
    sel.onchange = ()=>{
      const p = state.products.find(x=>x.id===sel.value); if(!p) return;
      Q('#epName').value = p.name;
      Q('#epSku').value = p.sku||'';
      Q('#epCost').value = p.cost_china||0;
      Q('#epShip').value = p.ship_china_to_kenya||0;
      Q('#epMB').value = p.margin_budget||0;
    };
    Q('#epSave')?.addEventListener('click', async ()=>{
      const id=sel.value; if(!id) return;
      const payload = {
        name:Q('#epName').value, sku:Q('#epSku').value,
        cost_china:+Q('#epCost').value||0,
        ship_china_to_kenya:+Q('#epShip').value||0,
        margin_budget:+Q('#epMB').value||0
      };
      await api('/api/products/'+id,{method:'PUT', body:JSON.stringify(payload)});
      await preloadProducts();
      alert('Saved');
    });
  }

  // snapshots
  Q('#snapSave')?.addEventListener('click', async ()=>{
    const name = Q('#snapName')?.value.trim() || `Manual ${new Date().toLocaleString()}`;
    await api('/api/snapshots',{method:'POST', body:JSON.stringify({name})});
    Q('#snapName').value='';
    renderSnapshots();
  });
  renderSnapshots();
}
function renderCountryChips() {
  const list = Q('#ctyList'); if(!list) return;
  const exChina = state.countries.map(c=>({name:c, deletable: c.toLowerCase()!=='china'}));
  list.innerHTML = exChina.map(c=>`<span class="chip">${c.name}${c.deletable?` <button data-del-cty="${c.name}">×</button>`:''}</span>`).join('') || '—';
  list.onclick = async e=>{
    const name = e.target.dataset.delCty; if(!name) return;
    if (!confirm(`Delete country "${name}"?`)) return;
    await api('/api/countries/'+encodeURIComponent(name),{method:'DELETE'});
    const m = await api('/api/meta'); state.countries = m.countries||[];
    renderCountryChips(); fillGlobalSelects();
  };
}
async function renderSnapshots() {
  const r = await api('/api/snapshots');
  const tb = Q('#snapList'); if(!tb) return;
  tb.innerHTML = (r.snapshots||[]).map(s=>`
    <tr>
      <td>${s.name}</td>
      <td>${s.file}</td>
      <td>
        <button class="btn outline" data-push="${s.file}">Push</button>
        <button class="btn outline" data-del-snap="${s.id}">Delete</button>
      </td>
    </tr>`).join('') || `<tr><td colspan="3" class="muted">No snapshots</td></tr>`;
  tb.onclick = async e=>{
    if (e.target.dataset.push) {
      await api('/api/snapshots/restore',{method:'POST', body:JSON.stringify({file:e.target.dataset.push})});
      alert('Restored'); location.reload();
    } else if (e.target.dataset.delSnap) {
      if (!confirm('Delete this snapshot file from disk?')) return;
      await api('/api/snapshots/'+e.target.dataset.delSnap,{method:'DELETE'});
      renderSnapshots();
    }
  };
}

/* ======================================================================
   PRODUCT PAGE
   ====================================================================== */
async function loadProduct(id) {
  await preloadProducts();
  state.product = state.products.find(p=>p.id===id) || null;
}

function renderProductPage() {
  if (!state.product) { alert('Product not found'); location.href='/'; return; }
  Q('#pdTitle').textContent = state.product.name;
  Q('#pdSku').textContent = state.product.sku ? `SKU: ${state.product.sku}` : '';
  bindProductHandlers();
  refreshProductSections();
}

function bindProductHandlers() {
  // Manual budgets per country (EXCLUDE CHINA)
  Q('#pdPBSave')?.addEventListener('click', async ()=>{
    const c = Q('#pdPBCountry')?.value;
    const v = +Q('#pdPBValue')?.value||0;
    const budgets = {...(state.product.budgets||{})};
    budgets[c]=v;
    await api('/api/products/'+state.product.id,{method:'PUT', body:JSON.stringify({budgets})});
    await loadProduct(state.product.id);
    renderPBTable();
  });

  // Product Daily Ad spend (replace)
  Q('#pdAdSave')?.addEventListener('click', async ()=>{
    const payload = {
      productId: state.product.id,
      country: Q('#pdAdCountry').value,
      platform: Q('#pdAdPlatform').value,
      amount: +Q('#pdAdAmount').value||0
    };
    if (!payload.country||!payload.platform) return alert('Missing fields');
    await api('/api/adspend',{method:'POST', body:JSON.stringify(payload)});
    await refreshProductSections();
  });

  // Product shipments create
  Q('#pdMvAdd')?.addEventListener('click', async ()=>{
    const payload = {
      productId: state.product.id,
      fromCountry: Q('#pdMvFrom').value,
      toCountry: Q('#pdMvTo').value,
      qty: +Q('#pdMvQty').value||0,
      shipCost: +Q('#pdMvShip').value||0,
      departedAt: todayISO(), arrivedAt: null
    };
    if(!payload.fromCountry||!payload.toCountry) return alert('Choose route');
    await api('/api/shipments',{method:'POST', body:JSON.stringify(payload)});
    await refreshProductSections();
  });

  // Influencers
  Q('#pdInfAdd')?.addEventListener('click', async ()=>{
    const payload = { name:Q('#pdInfName').value.trim(), social:Q('#pdInfSocial').value.trim(), country:Q('#pdInfCountry').value };
    if (!payload.name) return alert('Name required');
    await api('/api/influencers',{method:'POST', body:JSON.stringify(payload)});
    Q('#pdInfName').value=''; Q('#pdInfSocial').value='';
    await renderInfluencers();
  });
  Q('#pdInfSpendAdd')?.addEventListener('click', async ()=>{
    const payload = {
      date: Q('#pdInfDate').value||todayISO(),
      influencerId: Q('#pdInfSelect').value,
      country: Q('#pdInfCountry').value,
      productId: state.product.id,
      amount: +Q('#pdInfAmount').value||0
    };
    if (!payload.influencerId) return alert('Select influencer');
    await api('/api/influencers/spend',{method:'POST', body:JSON.stringify(payload)});
    await renderInfluencers();
  });
  Q('#pdInfRun')?.addEventListener('click', renderInfluencers);

  // Lifetime run
  Q('#pdLPRun')?.addEventListener('click', renderProductLifetime);
}

async function refreshProductSections() {
  await loadProduct(state.product.id);
  fillSelect(Q('#pdPBCountry'), visibleCountries());
  fillSelect(Q('#pdAdCountry'), visibleCountries());
  fillSelect(Q('#pdInfCountry'), visibleCountries());
  fillSelect(Q('#pdMvFrom'), state.countries);
  fillSelect(Q('#pdMvTo'), state.countries);

  await renderProductStockAd();
  renderPBTable();
  await renderProductAdList();
  await renderProductTransit();
  await renderProductArrived();
  await renderProductLifetime();
  await renderInfluencers();
}

/* Stock & Ad (product only) EXCLUDE CHINA */
async function renderProductStockAd() {
  const tb = Q('#pdStockBody'); if (!tb) return;
  const per = {}; visibleCountries().forEach(c=>per[c]={stock:0, ad:0});

  const s = await api('/api/shipments');
  (s.shipments||[])
    .filter(x=>x.productId===state.product.id && x.arrivedAt)
    .forEach(sp=>{
      const to=sp.toCountry, from=sp.fromCountry, q=+sp.qty||0;
      if ((to||'').toLowerCase()!=='china') { per[to]=per[to]||{stock:0,ad:0}; per[to].stock+=q; }
      if ((from||'').toLowerCase()!=='china') { per[from]=per[from]||{stock:0,ad:0}; per[from].stock-=q; }
    });

  const a = await api('/api/adspend');
  (a.adSpends||[])
    .filter(x=>x.productId===state.product.id && (x.country||'').toLowerCase()!=='china')
    .forEach(x=>{ per[x.country]=per[x.country]||{stock:0,ad:0}; per[x.country].ad += (+x.amount||0); });

  let st=0, adt=0;
  tb.innerHTML = Object.entries(per).map(([c,v])=>{
    st+=v.stock; adt+=v.ad;
    return `<tr><td>${c}</td><td>${fmt(v.stock)}</td><td>${fmt(v.ad)}</td></tr>`;
  }).join('') || `<tr><td colspan="3" class="muted">No data</td></tr>`;
  Q('#pdStockTotal')&&(Q('#pdStockTotal').textContent=fmt(st));
  Q('#pdAdTotal')&&(Q('#pdAdTotal').textContent=fmt(adt));
}

/* Manual Budgets table */
function renderPBTable() {
  const tb = Q('#pdPBBBody'); if (!tb) return;
  const map = state.product.budgets||{};
  tb.innerHTML = visibleCountries().map(c=>`
    <tr>
      <td>${c}</td>
      <td>${fmt(map[c]||0)}</td>
      <td><button class="btn outline" data-clear-b="${c}">Clear</button></td>
    </tr>
  `).join('') || `<tr><td colspan="3" class="muted">No countries</td></tr>`;
  tb.onclick = async e=>{
    const c = e.target.dataset.clearB; if(!c) return;
    const budgets = {...(state.product.budgets||{})}; delete budgets[c];
    await api('/api/products/'+state.product.id,{method:'PUT', body:JSON.stringify({budgets})});
    await loadProduct(state.product.id); renderPBTable();
  };
}

/* Product Ad list */
async function renderProductAdList() {
  const tb = Q('#pdAdBody'); if(!tb) return;
  const a = await api('/api/adspend');
  const list = (a.adSpends||[]).filter(x=>x.productId===state.product.id && (x.country||'').toLowerCase()!=='china');
  tb.innerHTML = list.map(x=>`<tr><td>${x.country}</td><td>${x.platform}</td><td>${fmt(x.amount)}</td></tr>`).join('') || `<tr><td colspan="3" class="muted">No ad spend</td></tr>`;
}

/* Product Transit (live only this product) */
async function renderProductTransit() {
  const s = await api('/api/shipments');
  const list = (s.shipments||[]).filter(x=>x.productId===state.product.id && !x.arrivedAt);

  const ck = list.filter(sp => (sp.fromCountry||'').toLowerCase()==='china' && (sp.toCountry||'').toLowerCase()==='kenya');
  const ic = list.filter(sp => !( (sp.fromCountry||'').toLowerCase()==='china' && (sp.toCountry||'').toLowerCase()==='kenya'));

  const row = sp => {
    const days = sp.arrivedAt ? Math.round((+new Date(sp.arrivedAt)-+new Date(sp.departedAt))/86400000) : '';
    return `<tr>
      <td>${sp.id}</td><td>${sp.fromCountry} → ${sp.toCountry}</td><td>${fmt(sp.qty)}</td><td>${fmt(sp.shipCost)}</td>
      <td>${sp.departedAt||''}</td><td>${sp.arrivedAt||''}</td><td>${days||''}</td>
      <td>
        <button class="btn outline" data-arr="${sp.id}">Mark Arrived</button>
        <button class="btn outline" data-edit="${sp.id}">Edit</button>
        <button class="btn outline" data-del="${sp.id}">Delete</button>
      </td>
    </tr>`;
  };

  Q('#pdShipCKBody')&&(Q('#pdShipCKBody').innerHTML = ck.map(row).join('') || `<tr><td colspan="8" class="muted">No shipments</td></tr>`);
  Q('#pdShipICBody')&&(Q('#pdShipICBody').innerHTML = ic.map(row).join('') || `<tr><td colspan="8" class="muted">No shipments</td></tr>`);

  const box = Q('#productDetails');
  box?.addEventListener('click', async e=>{
    const id = e.target.dataset.arr || e.target.dataset.edit || e.target.dataset.del;
    if (!id) return;
    if (e.target.dataset.arr) {
      const date = prompt('Arrival date (YYYY-MM-DD)', todayISO()); if(!date) return;
      await api('/api/shipments/'+id,{method:'PUT', body:JSON.stringify({arrivedAt:date})});
      await renderProductTransit(); await renderProductArrived(); await renderProductStockAd();
    } else if (e.target.dataset.edit) {
      const qty = +prompt('New qty?', '')||0;
      const shipCost = +prompt('New ship cost?', '')||0;
      await api('/api/shipments/'+id,{method:'PUT', body:JSON.stringify({qty,shipCost})});
      await renderProductTransit();
    } else if (e.target.dataset.del) {
      if (!confirm('Delete this shipment?')) return;
      await api('/api/shipments/'+id,{method:'DELETE'});
      await renderProductTransit();
    }
  }, { once:true });
}

/* NEW: Arrived Shipments (this product) */
async function renderProductArrived() {
  const s = await api('/api/shipments');
  const arrived = (s.shipments||[]).filter(x=>x.productId===state.product.id && x.arrivedAt);

  const tb = Q('#pdArrivedBody'); if(!tb) return;
  const row = sp=>{
    const days = Math.round((+new Date(sp.arrivedAt)-+new Date(sp.departedAt))/86400000);
    return `<tr>
      <td>${sp.id}</td><td>${sp.fromCountry} → ${sp.toCountry}</td><td>${fmt(sp.qty)}</td><td>${fmt(sp.shipCost)}</td>
      <td>${sp.departedAt||''}</td><td>${sp.arrivedAt||''}</td><td>${days||''}</td>
      <td>
        <button class="btn outline" data-edit-arr="${sp.id}">Edit</button>
        <button class="btn outline" data-del-arr="${sp.id}">Delete</button>
      </td>
    </tr>`;
  };
  tb.innerHTML = arrived.map(row).join('') || `<tr><td colspan="8" class="muted">No arrived shipments</td></tr>`;

  tb.onclick = async e=>{
    if (e.target.dataset.editArr) {
      const id = e.target.dataset.editArr;
      const qty = +prompt('New qty?', '')||0;
      const shipCost = +prompt('New ship cost?', '')||0;
      await api('/api/shipments/'+id,{method:'PUT', body:JSON.stringify({qty,shipCost})});
      await renderProductArrived();
    } else if (e.target.dataset.delArr) {
      const id = e.target.dataset.delArr;
      if (!confirm('Delete this arrived shipment?')) return;
      await api('/api/shipments/'+id,{method:'DELETE'});
      await renderProductArrived(); await renderProductStockAd();
    }
  };
}

/* Product lifetime (filterable) */
async function renderProductLifetime() {
  const s = Q('#pdLPStart')?.value, e = Q('#pdLPEnd')?.value;
  const r = await api('/api/remittances'+((s||e)?`?${[s?`start=${s}`:'', e?`end=${e}`:''].filter(Boolean).join('&')}`:''));
  const list = (r.remittances||[]).filter(x=>x.productId===state.product.id && (x.country||'').toLowerCase()!=='china');
  const p = state.product;
  const basePerPc = (+p.cost_china||0) + (+p.ship_china_to_kenya||0);

  const byC = {};
  list.forEach(x=>{
    const k=x.country; const pcs=+x.pieces||0; const extra=(+x.extraPerPiece||0)*pcs;
    if(!byC[k]) byC[k]={rev:0,ad:0,ship:0,base:0,pcs:0,profit:0};
    byC[k].rev += (+x.revenue||0);
    byC[k].ad  += (+x.adSpend||0);
    byC[k].ship += extra;
    byC[k].base += basePerPc*pcs;
    byC[k].pcs  += pcs;
  });
  Object.values(byC).forEach(v=> v.profit = v.rev - v.ad - v.ship - v.base);

  const tb = Q('#pdLPBody'); if(!tb) return;
  let R=0,A=0,S=0,B=0,P=0,PCS=0;
  tb.innerHTML = Object.entries(byC).map(([c,v])=>{
    R+=v.rev; A+=v.ad; S+=v.ship; B+=v.base; PCS+=v.pcs; P+=v.profit;
    return `<tr><td>${c}</td><td>${fmt(v.rev)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.ship)}</td><td>${fmt(v.base)}</td><td>${fmt(v.pcs)}</td><td>${fmt(v.profit)}</td></tr>`;
  }).join('') || `<tr><td colspan="7" class="muted">No data</td></tr>`;
  Q('#pdLPRevT')&&(Q('#pdLPRevT').textContent=fmt(R));
  Q('#pdLPAdT')&&(Q('#pdLPAdT').textContent=fmt(A));
  Q('#pdLPShipT')&&(Q('#pdLPShipT').textContent=fmt(S));
  Q('#pdLPBaseT')&&(Q('#pdLPBaseT').textContent=fmt(B));
  Q('#pdLPPcsT')&&(Q('#pdLPPcsT').textContent=fmt(PCS));
  Q('#pdLPProfitT')&&(Q('#pdLPProfitT').textContent=fmt(P));
}

/* Influencers (product page; EXCLUDE CHINA) */
async function renderInfluencers() {
  const infs = await api('/api/influencers');
  const spends = await api('/api/influencers/spend');

  fillSelect(Q('#pdInfSelect'), (infs.influencers||[]).map(i=>({value:i.id,label:i.name})), {placeholder:'Select influencer'});
  fillSelect(Q('#pdInfCountry'), visibleCountries());

  const s = Q('#pdInfStart')?.value, e = Q('#pdInfEnd')?.value, c=Q('#pdInfFilterCountry')?.value||'';
  fillSelect(Q('#pdInfFilterCountry'), [{value:'',label:'All countries'}, ...visibleCountries().map(k=>({value:k,label:k}))]);

  const list = (spends.spends||[])
    .filter(x=>x.productId===state.product.id)
    .filter(x=> (x.country||'').toLowerCase()!=='china')
    .filter(x=> (!c || x.country===c))
    .filter(x=> (!s || x.date >= s) && (!e || x.date <= e));

  const byId = Object.fromEntries((infs.influencers||[]).map(i=>[i.id,i]));
  const tb = Q('#pdInfBody'); if(!tb) return;
  let total=0;
  tb.innerHTML = list.map(x=>{
    total += (+x.amount||0);
    const i = byId[x.influencerId] || {};
    return `<tr>
      <td>${x.date}</td><td>${x.country}</td><td>${i.name||'-'}</td><td>${i.social||'-'}</td><td>${fmt(x.amount)}</td>
      <td><button class="btn outline" data-del-infsp="${x.id}">Delete</button></td>
    </tr>`;
  }).join('') || `<tr><td colspan="6" class="muted">No influencer spends</td></tr>`;
  Q('#pdInfTotal')&&(Q('#pdInfTotal').textContent=fmt(total));

  tb.onclick = async e=>{
    const id = e.target.dataset.delInfsp; if(!id) return;
    await api('/api/influencers/spend/'+id,{method:'DELETE'});
    await renderInfluencers();
  };
}

/* ======================================================================
   NAV
   ====================================================================== */
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

/* ======================================================================
   BOOT
   ====================================================================== */
gate();
