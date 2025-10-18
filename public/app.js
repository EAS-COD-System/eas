/* ================================================================
   EAS Tracker – Front-end (Complete Rebuild)
   ================================================================ */

/* ---------- helpers ---------- */
const Q  = (s, r=document) => r.querySelector(s);
const QA = (s, r=document) => Array.from(r.querySelectorAll(s));
const fmt = n => (Number(n||0)).toLocaleString(undefined,{maximumFractionDigits:2});
const isoToday = () => new Date().toISOString().slice(0,10);
const getQuery = k => new URLSearchParams(location.search).get(k);
const safeJSON = v => { try { return JSON.parse(v); } catch { return null; } };

async function api(path, opts={}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  const ct = res.headers.get('content-type')||'';
  const body = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(body?.error || body || ('HTTP '+res.status));
  return body;
}

/* ---------- global state ---------- */
const state = {
  productId: getQuery('id'),
  countries: [],
  products: [],
  productsActive: [],
  categories: { debit:[], credit:[] },
  productNotes: [],
  productSellingPrices: [],
  brainstorming: [],
  testedProducts: []
};

/* ================================================================
   AUTH + BOOT
   ================================================================ */
async function boot() {
  try {
    await api('/api/meta');
    Q('#login')?.classList.add('hide');
    Q('#main')?.removeAttribute('style');
  } catch {
    Q('#login')?.classList.remove('hide');
    Q('#main')?.setAttribute('style','display:none');
    return;
  }

  await preload();
  initSimpleNavigation();
  bindGlobalNav();

  if (state.productId) {
    renderProductPage();
  } else {
    renderDashboardPage();
    renderProductsPage();
    renderPerformancePage();
    renderStockMovementPage();
    renderFinancePage();
    renderSettingsPage();
  }
}

Q('#loginBtn')?.addEventListener('click', async () => {
  const password = Q('#pw')?.value || '';
  try {
    await api('/api/auth', { method:'POST', body: JSON.stringify({ password }) });
    await boot();
  } catch (e) {
    alert('Wrong password');
  }
});

Q('#logoutLink')?.addEventListener('click', async (e) => {
  e.preventDefault();
  try { await api('/api/auth', { method:'POST', body: JSON.stringify({ password: 'logout' })}); } catch {}
  location.reload();
});

/* ================================================================
   SIMPLE NAVIGATION
   ================================================================ */
function initSimpleNavigation() {
  const nav = Q('.nav');
  const main = Q('#main');
  if (!nav) return;

  let lastScrollY = window.scrollY;

  function hideNav() {
    nav.classList.remove('nav-visible');
    nav.classList.add('nav-hidden');
    if (main) main.classList.add('main-expanded');
  }

  function showNav() {
    nav.classList.remove('nav-hidden');
    nav.classList.add('nav-visible');
    if (main) main.classList.remove('main-expanded');
  }

  function handleScroll() {
    const currentScrollY = window.scrollY;
    
    if (currentScrollY < 10) {
      showNav();
      lastScrollY = currentScrollY;
      return;
    }

    if (currentScrollY > 50) {
      hideNav();
    }

    lastScrollY = currentScrollY;
  }

  window.addEventListener('scroll', handleScroll, { passive: true });

  document.addEventListener('touchstart', (e) => {
    if (e.touches[0].clientY < 10) {
      showNav();
    }
  }, { passive: true });

  if (window.scrollY === 0) {
    showNav();
  } else {
    hideNav();
  }
}

/* ================================================================
   COMMON LOADERS
   ================================================================ */
async function preload() {
  const meta = await api('/api/meta');
  state.countries = (meta.countries || []).filter(country => country !== 'china');

  const pr = await api('/api/products');
  state.products = pr.products || [];
  state.productsActive = state.products.filter(p => p.status !== 'paused');

  const cats = await api('/api/finance/categories');
  state.categories = cats || { debit:[], credit:[] };

  fillCommonSelects();
}

function fillCommonSelects() {
  const countrySelects = ['#adCountry', '#rCountry', '#pdAdCountry', '#pdRCountry', 
    '#pdInfCountry', '#pdInfFilterCountry', '#pcCountry', '#remCountry', '#remAddCountry',
    '#topDelCountry', '#remAnalyticsCountry', '#spCountry', '#poCountry', '#pdNoteCountry'];
  
  countrySelects.forEach(sel => QA(sel).forEach(el => {
    if (sel === '#pcCountry' || sel === '#remCountry' || sel === '#topDelCountry' || sel === '#remAnalyticsCountry') {
      el.innerHTML = `<option value="">All countries</option>` +
        state.countries.map(c=>`<option value="${c}">${c}</option>`).join('');
    } else if (sel === '#mvFrom' || sel === '#pdMvFrom') {
      el.innerHTML = `<option value="china">china</option>` +
        state.countries.map(c=>`<option value="${c}">${c}</option>`).join('');
    } else {
      el.innerHTML = state.countries.map(c=>`<option value="${c}">${c}</option>`).join('');
    }
  }));

  const productInputs = ['#mvProduct','#adProduct','#rProduct','#remAddProduct','#spProduct','#poProduct','#pcaProduct'];
  productInputs.forEach(sel => QA(sel).forEach(el => {
    el.innerHTML = state.productsActive.map(p=>`<option value="${p.id}">${p.name}${p.sku?` (${p.sku})`:''}</option>`).join('');
  }));

  const productFilters = ['#remProduct', '#remAnalyticsProduct', '#productInfoSelect'];
  productFilters.forEach(sel => QA(sel).forEach(el => {
    el.innerHTML = `<option value="">All products</option>` +
      state.products.map(p=>`<option value="${p.id}">${p.name}${p.sku?` (${p.sku})`:''}</option>`).join('');
  }));

  const allCats = [...state.categories.debit, ...state.categories.credit].sort();
  QA('#feCat').forEach(el => {
    el.innerHTML = `<option value="" disabled selected>Select category</option>` +
      allCats.map(c=>`<option>${c}</option>`).join('');
  });
  
  QA('#fcSearchCat').forEach(el => {
    el.innerHTML = `<option value="">All categories</option>` +
      allCats.map(c=>`<option>${c}</option>`).join('');
  });
}

/* ================================================================
   DATE RANGE SELECTOR
   ================================================================ */
function initDateRangeSelectors() {
  QA('.date-range-select').forEach(select => {
    const container = select.closest('.row');
    const customRange = container.querySelector('.custom-range');
    
    select.addEventListener('change', function() {
      if (this.value === 'custom') {
        customRange.style.display = 'flex';
      } else {
        customRange.style.display = 'none';
      }
    });
  });
}

function getDateRange(container) {
  const select = container.querySelector('.date-range-select');
  const customStart = container.querySelector('.custom-start');
  const customEnd = container.querySelector('.custom-end');
  
  if (select.value === 'custom') {
    return {
      start: customStart.value,
      end: customEnd.value
    };
  }
  
  return { range: select.value };
}

/* ================================================================
   DASHBOARD
   ================================================================ */
function renderDashboardPage() {
  renderCompactKpis();
  renderCountryStockSpend();
  bindDailyAdSpend();
  renderWeeklyDelivered();
  initBrainstorming();
  initTodos();
  initTestedProducts();
}

/* ---------- COMPACT KPIs ---------- */
async function renderCompactKpis() {
  Q('#kpiProducts') && (Q('#kpiProducts').textContent = state.products.length);
  Q('#kpiCountries') && (Q('#kpiCountries').textContent = state.countries.length);
  
  try {
    const s = await api('/api/shipments');
    const live = (s.shipments || []).filter(x => !x.arrivedAt).length;
    Q('#kpiTransit') && (Q('#kpiTransit').textContent = live);
  } catch { Q('#kpiTransit') && (Q('#kpiTransit').textContent = '—'); }

  try {
    const a = await api('/api/adspend');
    const total = (a.adSpends||[]).reduce((t,x)=>t+(+x.amount||0),0);
    Q('#kpiAdSpend') && (Q('#kpiAdSpend').textContent = `${fmt(total)} USD`);
  } catch { Q('#kpiAdSpend') && (Q('#kpiAdSpend').textContent = '—'); }

  const t = Q('#wAllT')?.textContent || '0';
  Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = t);
}

/* ---------- Stock & Ad Spend by Country ---------- */
async function renderCountryStockSpend() {
  const body = Q('#stockByCountryBody'); if (!body) return;
  body.innerHTML = '<tr><td colspan="6">Loading…</td></tr>';

  const per = {}; 
  state.countries.forEach(c=> {
    per[c] = { 
      stock: 0, 
      facebook: 0, 
      tiktok: 0, 
      google: 0, 
      totalAd: 0 
    };
  });

  try {
    const s = await api('/api/shipments');
    (s.shipments||[]).filter(x=>x.arrivedAt).forEach(sp=>{
      const to = sp.toCountry || sp.to, from = sp.fromCountry || sp.from, qty = (+sp.qty||0);
      if (to && state.countries.includes(to)) {
        per[to] = per[to] || {stock:0, facebook:0, tiktok:0, google:0, totalAd:0}; 
        per[to].stock += qty;
      }
      if (from && state.countries.includes(from)) {
        per[from] = per[from]||{stock:0, facebook:0, tiktok:0, google:0, totalAd:0}; 
        per[from].stock -= qty;
      }
    });
  } catch {}

  try {
    const r = await api('/api/remittances');
    (r.remittances||[]).forEach(x=>{
      if (state.countries.includes(x.country)) {
        per[x.country] = per[x.country]||{stock:0, facebook:0, tiktok:0, google:0, totalAd:0};
        per[x.country].stock -= (+x.pieces||0);
      }
    });
  } catch {}

  try {
    const a = await api('/api/adspend');
    (a.adSpends||[]).forEach(x=>{
      if (state.countries.includes(x.country)) {
        per[x.country] = per[x.country]||{stock:0, facebook:0, tiktok:0, google:0, totalAd:0};
        const amount = +x.amount||0;
        if (x.platform === 'facebook') per[x.country].facebook += amount;
        else if (x.platform === 'tiktok') per[x.country].tiktok += amount;
        else if (x.platform === 'google') per[x.country].google += amount;
        per[x.country].totalAd += amount;
      }
    });
  } catch {}

  let st=0, fb=0, tt=0, gg=0, totalAd=0;
  const rows = Object.entries(per).map(([c,v])=>{
    st += v.stock; 
    fb += v.facebook; 
    tt += v.tiktok; 
    gg += v.google; 
    totalAd += v.totalAd;
    
    return `<tr>
      <td>${c}</td>
      <td>${fmt(v.stock)}</td>
      <td>${fmt(v.facebook)}</td>
      <td>${fmt(v.tiktok)}</td>
      <td>${fmt(v.google)}</td>
      <td>${fmt(v.totalAd)}</td>
    </tr>`;
  }).join('');
  
  body.innerHTML = rows || `<tr><td colspan="6" class="muted">No data</td></tr>`;
  Q('#stockTotal') && (Q('#stockTotal').textContent = fmt(st));
  Q('#fbTotal') && (Q('#fbTotal').textContent = fmt(fb));
  Q('#ttTotal') && (Q('#ttTotal').textContent = fmt(tt));
  Q('#ggTotal') && (Q('#ggTotal').textContent = fmt(gg));
  Q('#adTotal') && (Q('#adTotal').textContent = fmt(totalAd));
}

/* ---------- Daily Ad Spend ---------- */
function bindDailyAdSpend() {
  const btn = Q('#adSave');
  if (!btn) return;
  btn.onclick = async ()=>{
    const payload = {
      productId: Q('#adProduct')?.value,
      country: Q('#adCountry')?.value,
      platform: Q('#adPlatform')?.value,
      amount: +Q('#adAmount')?.value || 0
    };
    if (!payload.productId || !payload.country || !payload.platform) return alert('Fill all fields');
    try {
      await api('/api/adspend',{method:'POST', body: JSON.stringify(payload)});
      await renderCountryStockSpend();
      await renderCompactKpis();
      alert('Ad spend saved');
    } catch(e){ alert(e.message); }
  };
}

/* ---------- Weekly Delivered grid ---------- */
function mondayOf(dateISO) {
  const d = new Date(dateISO);
  const k = (d.getDay()+6)%7; d.setDate(d.getDate()-k);
  return d;
}
function weekDays(fromMonDate) {
  return [...Array(7)].map((_,i)=> {
    const t = new Date(fromMonDate); t.setDate(t.getDate()+i);
    return t.toISOString().slice(0,10);
  });
}

function renderWeeklyDelivered() {
  const head = Q('#weeklyHead'), body = Q('#weeklyBody'), rangeLbl = Q('#weeklyRange');
  if (!head || !body) return;

  let anchor = isoToday();
  const updateGrid = async () => {
    const mon = mondayOf(anchor);
    const days = weekDays(mon);
    rangeLbl.textContent = `Week: ${days[0]} → ${days[6]}`;

    head.innerHTML = `<tr><th>Country</th>${days.map(d=>{
      const lab = new Date(d).toLocaleDateString(undefined,{weekday:'short'});
      return `<th>${lab}<br>${d}</th>`;
    }).join('')}<th>Total</th></tr>`;

    body.innerHTML = state.countries.map(c=>{
      const cells = days.map(d=>`<td><input type="number" min="0" class="wd-cell" data-country="${c}" data-date="${d}" placeholder="0"/></td>`).join('');
      return `<tr data-row="${c}"><td>${c}</td>${cells}<td class="row-total">0</td></tr>`;
    }).join('');

    try {
      const r = await api('/api/deliveries');
      const map = {};
      (r.deliveries||[]).forEach(x => map[`${x.country}|${x.date}`] = +x.delivered||0);
      QA('.wd-cell').forEach(inp=>{
        const k = `${inp.dataset.country}|${inp.dataset.date}`;
        if (map[k] != null) inp.value = map[k];
      });
    } catch {}

    computeWeeklyTotals();
  };

  function computeWeeklyTotals() {
    QA('tr[data-row]').forEach(tr=>{
      const t = QA('.wd-cell', tr).reduce((s,el)=>s+(+el.value||0),0);
      Q('.row-total', tr).textContent = fmt(t);
    });
    
    const cols = QA('thead th', Q('#weeklyTable')).length - 2;
    let grand = 0;
    for (let i=0;i<cols;i++) {
      let colSum = 0;
      QA('tr[data-row]').forEach(tr=>{
        const inp = QA('.wd-cell', tr)[i];
        colSum += (+inp.value||0);
      });
      Q(`#w${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i]}T`).textContent = fmt(colSum);
      grand += colSum;
    }
    Q('#wAllT').textContent = fmt(grand);
    Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = fmt(grand));
  }

  Q('#weeklyPrev')?.addEventListener('click',()=>{ const d = new Date(anchor); d.setDate(d.getDate()-7); anchor = d.toISOString().slice(0,10); updateGrid(); });
  Q('#weeklyNext')?.addEventListener('click',()=>{ const d = new Date(anchor); d.setDate(d.getDate()+7); anchor = d.toISOString().slice(0,10); updateGrid(); });
  Q('#weeklyReset')?.addEventListener('click',()=>{ QA('.wd-cell').forEach(el=>el.value=''); computeWeeklyTotals(); });
  Q('#weeklyTable')?.addEventListener('input', (e)=>{ if (e.target.classList.contains('wd-cell')) computeWeeklyTotals(); });
  Q('#weeklySave')?.addEventListener('click', async ()=>{
    const payload = [];
    QA('.wd-cell').forEach(inp=>{
      const val = +inp.value||0;
      if (val>0) payload.push({ date: inp.dataset.date, country: inp.dataset.country, delivered: val });
    });
    try {
      for (const row of payload) await api('/api/deliveries',{method:'POST', body: JSON.stringify(row)});
      alert('Weekly deliveries saved');
    } catch(e){ alert('Save failed: '+e.message); }
  });

  updateGrid();
}

/* ---------- Brainstorming ---------- */
function initBrainstorming() {
  const container = Q('#brainstormingSection');
  if (!container) return;

  api('/api/brainstorming').then(data => {
    state.brainstorming = data.ideas || [];
    renderBrainstorming();
  }).catch(console.error);

  function renderBrainstorming() {
    container.innerHTML = `
      <div class="card">
        <div class="h">💡 Brainstorming & Idea Management</div>
        <div class="row wrap">
          <input id="brainTitle" class="input" placeholder="Idea title"/>
          <select id="brainCategory" class="input">
            <option value="product">Product Idea</option>
            <option value="marketing">Marketing</option>
            <option value="operation">Operation</option>
            <option value="improvement">Improvement</option>
            <option value="general">General</option>
          </select>
          <button id="brainAdd" class="btn">➕ Add Idea</button>
        </div>
        <textarea id="brainDescription" class="input" placeholder="Detailed description, notes, implementation plan..." rows="3" style="width: 100%; margin: 10px 0;"></textarea>
        
        <div id="brainstormingList" class="ideas-list">
          ${state.brainstorming.map(idea => `
            <div class="idea-card ${idea.isProfitable ? 'profitable' : 'not-profitable'}" data-id="${idea.id}">
              <div class="idea-header">
                <strong>${idea.title}</strong>
                <span class="idea-category ${idea.category}">${idea.category}</span>
                <div class="idea-actions">
                  <button class="btn outline small brain-edit" data-id="${idea.id}">Edit</button>
                  <button class="btn outline small brain-del" data-id="${idea.id}">Delete</button>
                </div>
              </div>
              <div class="idea-description">${idea.description}</div>
              <div class="idea-date">Last updated: ${new Date(idea.updatedAt).toLocaleDateString()}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    Q('#brainAdd')?.addEventListener('click', addBrainstormingIdea);
    container.addEventListener('click', handleBrainstormingActions);
  }

  function addBrainstormingIdea() {
    const title = Q('#brainTitle')?.value.trim();
    const description = Q('#brainDescription')?.value.trim();
    const category = Q('#brainCategory')?.value;

    if (!title) return alert('Please enter an idea title');

    api('/api/brainstorming', {
      method: 'POST',
      body: JSON.stringify({ title, description, category })
    }).then(() => {
      Q('#brainTitle').value = '';
      Q('#brainDescription').value = '';
      return api('/api/brainstorming');
    }).then(data => {
      state.brainstorming = data.ideas || [];
      renderBrainstorming();
    }).catch(alert);
  }

  function handleBrainstormingActions(e) {
    if (e.target.classList.contains('brain-del')) {
      if (!confirm('Delete this idea?')) return;
      api(`/api/brainstorming/${e.target.dataset.id}`, { method: 'DELETE' })
        .then(() => api('/api/brainstorming'))
        .then(data => {
          state.brainstorming = data.ideas || [];
          renderBrainstorming();
        })
        .catch(alert);
    }
  }
}

/* ---------- To-do + Weekly To-do ---------- */
function initTodos() {
  const KEY='eas_todos', WKEY='eas_weekly';
  const load = k => safeJSON(localStorage.getItem(k))|| (k===WKEY?{}:[]);
  const save = (k,v)=>localStorage.setItem(k,JSON.stringify(v));

  const listEl = Q('#todoList'); const addBtn = Q('#todoAdd');
  function renderQuick(){
    const arr = load(KEY);
    listEl.innerHTML = arr.map(t=>`<div class="flex">
      <span>${t.done?'✅ ':''}${t.text}</span>
      <button class="btn outline" data-done="${t.id}">${t.done?'Undo':'Done'}</button>
      <button class="btn outline" data-del="${t.id}">Delete</button>
    </div>`).join('') || '<div class="muted">No tasks</div>';
  }
  addBtn?.addEventListener('click', ()=>{
    const v = Q('#todoText')?.value.trim(); if (!v) return;
    const arr = load(KEY); arr.push({id:crypto.randomUUID(),text:v,done:false}); save(KEY,arr); Q('#todoText').value=''; renderQuick();
  });
  listEl?.addEventListener('click',(e)=>{
    if (e.target.dataset.done) {
      const arr = load(KEY);
      const it = arr.find(x=>x.id===e.target.dataset.done); 
      it.done=!it.done; save(KEY,arr); renderQuick();
    }
    if (e.target.dataset.del)  {
      const arr = load(KEY);
      const idx = arr.findIndex(x=>x.id===e.target.dataset.del); arr.splice(idx,1); save(KEY,arr); renderQuick();
    }
  });
  renderQuick();

  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const wrap = Q('#weeklyWrap');
  function renderWeekly(){
    const data = load(WKEY);
    wrap.innerHTML = days.map(d=>{
      const arr = data[d]||[];
      return `<div class="card">
        <div class="h">${d}</div>
        <div class="row"><input id="w_${d}" class="input" placeholder="Task"/><button class="btn" data-add="${d}">Add</button></div>
        <div class="list">${arr.map(t=>`<div class="flex"><span>${t.done?'✅ ':''}${t.text}</span>
          <button class="btn outline" data-tgl="${d}|${t.id}">${t.done?'Undo':'Done'}</button>
          <button class="btn outline" data-del="${d}|${t.id}">Delete</button>
        </div>`).join('')}</div>
      </div>`;
    }).join('');
  }
  wrap?.addEventListener('click',(e)=>{
    const data = load(WKEY);
    if (e.target.dataset.add) {
      const d = e.target.dataset.add, v = Q('#w_'+d).value.trim(); if (!v) return;
      data[d] = data[d]||[]; data[d].push({id:crypto.randomUUID(),text:v,done:false}); save(WKEY,data); renderWeekly();
    }
    if (e.target.dataset.tgl) {
      const [d,id]=e.target.dataset.tgl.split('|'); const it=(data[d]||[]).find(x=>x.id===id); it.done=!it.done; save(WKEY,data); renderWeekly();
    }
    if (e.target.dataset.del) {
      const [d,id]=e.target.dataset.del.split('|'); const arr=(data[d]||[]); const i=arr.findIndex(x=>x.id===id); arr.splice(i,1); data[d]=arr; save(WKEY,data); renderWeekly();
    }
  });
  renderWeekly();
}

/* ---------- Tested Products ---------- */
function initTestedProducts() {
  const container = Q('#testedProductsSection');
  if (!container) return;

  api('/api/tested-products').then(data => {
    state.testedProducts = data.testedProducts || [];
    renderTestedProducts();
  }).catch(console.error);

  function renderTestedProducts() {
    container.innerHTML = `
      <div class="card">
        <div class="h">🧪 Product Testing Results & Analysis</div>
        <div class="row wrap">
          <input id="testProductName" class="input" placeholder="Product name"/>
          <select id="testCountry" class="input">
            <option value="">Select country</option>
            ${state.countries.map(c => `<option value="${c}">${c}</option>`).join('')}
          </select>
          <input id="testCostPerLead" type="number" class="input" placeholder="Cost per lead (USD)" step="0.01"/>
          <input id="testConfirmationRate" type="number" class="input" placeholder="Confirmation rate %" step="0.1" max="100"/>
        </div>
        <div class="row wrap">
          <input id="testSellingPrice" type="number" class="input" placeholder="Selling price (USD)" step="0.01"/>
          <button id="testAdd" class="btn">💾 Save Test Results</button>
        </div>
        
        <div id="testedProductsList" class="tested-products-list">
          ${renderTestedProductsList()}
        </div>
      </div>
    `;

    Q('#testAdd')?.addEventListener('click', addTestedProduct);
    container.addEventListener('click', handleTestedProductActions);
  }

  function renderTestedProductsList() {
    if (state.testedProducts.length === 0) {
      return '<div class="muted">No tested products yet. Add your first product test results above.</div>';
    }

    return state.testedProducts.map(product => `
      <div class="tested-product-card">
        <div class="tested-product-header">
          <strong>${product.productName}</strong>
          <button class="btn outline small test-del" data-id="${product.id}">Delete</button>
        </div>
        <div class="tested-product-countries">
          ${product.countryData.map(country => `
            <div class="country-result">
              <span class="country-name">${country.country}</span>
              <div class="country-stats">
                <span class="stat-badge">CPL: $${fmt(country.costPerLead)}</span>
                <span class="stat-badge">Confirmation: ${fmt(country.confirmationRate)}%</span>
                <span class="stat-badge">Price: $${fmt(country.sellingPrice)}</span>
                <span class="stat-badge">Max Budget: $${fmt(country.sellingPrice * (country.confirmationRate/100))}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');
  }

  function addTestedProduct() {
    const productName = Q('#testProductName')?.value.trim();
    const country = Q('#testCountry')?.value;
    const costPerLead = +Q('#testCostPerLead')?.value || 0;
    const confirmationRate = +Q('#testConfirmationRate')?.value || 0;
    const sellingPrice = +Q('#testSellingPrice')?.value || 0;

    if (!productName || !country) return alert('Please enter product name and country');

    api('/api/tested-products', {
      method: 'POST',
      body: JSON.stringify({ productName, country, costPerLead, confirmationRate, sellingPrice })
    }).then(() => {
      Q('#testProductName').value = '';
      Q('#testCountry').value = '';
      Q('#testCostPerLead').value = '';
      Q('#testConfirmationRate').value = '';
      Q('#testSellingPrice').value = '';
      
      return api('/api/tested-products');
    }).then(data => {
      state.testedProducts = data.testedProducts || [];
      renderTestedProducts();
    }).catch(alert);
  }

  function handleTestedProductActions(e) {
    if (e.target.classList.contains('test-del')) {
      if (!confirm('Delete all test results for this product?')) return;
      api(`/api/tested-products/${e.target.dataset.id}`, { method: 'DELETE' })
        .then(() => api('/api/tested-products'))
        .then(data => {
          state.testedProducts = data.testedProducts || [];
          renderTestedProducts();
        })
        .catch(alert);
    }
  }
}

/* ================================================================
   PRODUCTS PAGE
   ================================================================ */
function renderProductsPage() {
  renderCompactCountryStats();
  renderAdvertisingOverview();
  initDateRangeSelectors();

  Q('#pAdd')?.addEventListener('click', async ()=>{
    const p = {
      name: Q('#pName')?.value.trim(),
      sku:  Q('#pSku')?.value.trim(),
      margin_budget: +Q('#pMB')?.value||0
    };
    if (!p.name) return alert('Name required');
    await api('/api/products',{method:'POST', body: JSON.stringify(p)});
    await preload();
    renderProductsTable();
    renderCompactCountryStats();
    renderAdvertisingOverview();
    alert('Product added');
  });

  Q('#spSave')?.addEventListener('click', async ()=>{
    const productId = Q('#spProduct')?.value;
    const country = Q('#spCountry')?.value;
    const price = +Q('#spPrice')?.value || 0;

    if (!productId || !country) return alert('Select product and country');
    if (price <= 0) return alert('Enter valid selling price');

    await api(`/api/products/${productId}/prices`, {
      method: 'POST',
      body: JSON.stringify({ country, price })
    });

    Q('#spPrice').value = '';
    alert('Selling price saved');
  });

  renderProductsTable();
  renderProductInfoSection();
}

/* ---------- COMPACT COUNTRY STATS ---------- */
function renderCompactCountryStats() {
  const container = Q('#countryProductStats');
  if (!container) return;

  api('/api/adspend').then(adData => {
    const adSpends = adData.adSpends || [];
    const countryStats = {};
    
    state.countries.forEach(country => {
      countryStats[country] = { active: 0, paused: 0, total: 0 };
    });

    state.products.forEach(product => {
      state.countries.forEach(country => {
        countryStats[country].total++;
        if (product.status === 'active') {
          countryStats[country].active++;
        } else {
          countryStats[country].paused++;
        }
      });
    });

    let html = '';
    Object.keys(countryStats).sort().forEach(country => {
      const stats = countryStats[country];
      html += `
        <div class="country-stat-card-compact">
          <div class="country-name-compact">${country}</div>
          <div class="stats-row-compact">
            <div class="stat-item-compact active">
              <div class="stat-label-compact">Active</div>
              <div class="stat-value-compact">${stats.active}</div>
            </div>
            <div class="stat-item-compact paused">
              <div class="stat-label-compact">Paused</div>
              <div class="stat-value-compact">${stats.paused}</div>
            </div>
            <div class="stat-item-compact total">
              <div class="stat-label-compact">Total</div>
              <div class="stat-value-compact">${stats.total}</div>
            </div>
          </div>
        </div>
      `;
    });
    
    container.innerHTML = html;
  }).catch(console.error);
}

function renderAdvertisingOverview() {
  const container = Q('#advertisingOverview');
  if (!container) return;

  api('/api/adspend').then(adData => {
    const adSpends = adData.adSpends || [];
    
    const byCountry = {};
    
    adSpends.forEach(spend => {
      const country = spend.country;
      const productId = spend.productId;
      const platform = spend.platform;
      const amount = +spend.amount || 0;
      
      if (!byCountry[country]) {
        byCountry[country] = {};
      }
      
      if (!byCountry[country][productId]) {
        byCountry[country][productId] = {
          facebook: 0,
          tiktok: 0,
          google: 0,
          total: 0
        };
      }
      
      if (platform === 'facebook') byCountry[country][productId].facebook += amount;
      else if (platform === 'tiktok') byCountry[country][productId].tiktok += amount;
      else if (platform === 'google') byCountry[country][productId].google += amount;
      
      byCountry[country][productId].total += amount;
    });
    
    let html = '';
    
    Object.keys(byCountry).sort().forEach(country => {
      const products = byCountry[country];
      const sortedProducts = Object.entries(products)
        .filter(([_, data]) => data.total > 0)
        .sort((a, b) => b[1].total - a[1].total);
      
      if (sortedProducts.length === 0) return;
      
      html += `<div class="card country-section">
        <div class="h" style="color: var(--primary); margin-bottom: 12px;">${country}</div>`;
      
      sortedProducts.forEach(([productId, data]) => {
        const product = state.products.find(p => p.id === productId) || { name: productId };
        html += `
        <div class="product-row">
          <div class="product-name">${product.name}</div>
          <div class="platform-spends">
            <span class="platform-badge ${data.facebook > 0 ? 'active' : ''}">Facebook: ${fmt(data.facebook)}</span>
            <span class="platform-badge ${data.tiktok > 0 ? 'active' : ''}">TikTok: ${fmt(data.tiktok)}</span>
            <span class="platform-badge ${data.google > 0 ? 'active' : ''}">Google: ${fmt(data.google)}</span>
            <span class="total-badge">Total: ${fmt(data.total)}</span>
          </div>
        </div>`;
      });
      
      html += `</div>`;
    });
    
    container.innerHTML = html || '<div class="card"><div class="muted">No advertising data yet</div></div>';
  }).catch(console.error);
}

function renderProductsTable() {
  const tb = Q('#productsTable tbody'); if (!tb) return;
  tb.innerHTML = state.products.map(p=>{
    let rowClass = '';
    if (!p.hasData) {
      rowClass = 'no-data-row';
    } else if (p.isProfitable) {
      rowClass = 'profit-row';
    } else {
      rowClass = 'loss-row';
    }
    
    return `
    <tr class="${rowClass}">
      <td>${p.name}</td>
      <td>${p.sku||'-'}</td>
      <td><span class="badge ${p.status==='paused'?'muted':''}">${p.status||'active'}</span></td>
      <td>
        <a class="btn" href="/product.html?id=${p.id}">Open</a>
        <button class="btn outline act-toggle" data-id="${p.id}">${p.status==='active'?'Pause':'Run'}</button>
        <button class="btn outline act-del" data-id="${p.id}">Delete</button>
      </td>
    </tr>
  `}).join('') || `<tr><td colspan="4" class="muted">No products</td></tr>`;

  tb.onclick = async (e)=>{
    const id = e.target.dataset?.id; if (!id) return;
    if (e.target.classList.contains('act-toggle')) {
      const p = state.products.find(x=>x.id===id); const ns = p.status==='active'?'paused':'active';
      await api(`/api/products/${id}/status`,{method:'POST', body: JSON.stringify({status:ns})});
      await preload(); renderProductsTable(); renderCompactCountryStats(); renderAdvertisingOverview();
    }
    if (e.target.classList.contains('act-del')) {
      if (!confirm('Delete product and ALL its data?')) return;
      await api(`/api/products/${id}`,{method:'DELETE'});
      await preload(); renderProductsTable(); renderCompactCountryStats(); renderAdvertisingOverview(); renderCountryStockSpend(); renderCompactKpis();
    }
  };
}

function renderProductInfoSection() {
  const runBtn = Q('#productInfoRun');
  if (!runBtn) return;

  runBtn.onclick = async () => {
    const productId = Q('#productInfoSelect')?.value;
    if (!productId) return alert('Select a product');

    const product = state.products.find(p => p.id === productId);
    if (!product) return;

    // Get selling prices
    const prices = await api(`/api/products/${productId}/prices`);
    
    // Get product metrics
    const metrics = await api(`/api/analytics/remittance?productId=${productId}&range=lifetime`);
    
    let html = `
      <div class="product-info-results">
        <div class="product-info-header">
          <h3>${product.name} ${product.sku ? `(${product.sku})` : ''}</h3>
          <div class="product-status ${product.status}">${product.status}</div>
        </div>
        
        <div class="profit-budgets-section">
          <h4>💰 Profit + Advertising Budgets by Country</h4>
          <div class="table-scroll">
            <table class="table">
              <thead>
                <tr>
                  <th>Country</th>
                  <th>Selling Price</th>
                  <th>Max Cost Per Lead</th>
                  <th>Delivery Rate</th>
                  <th>Profit + Ad Budget</th>
                </tr>
              </thead>
              <tbody>
    `;

    state.countries.forEach(country => {
      const price = prices.prices.find(p => p.country === country);
      const countryMetrics = metrics.analytics.find(m => m.country === country);
      
      const sellingPrice = price ? price.price : 0;
      const deliveryRate = countryMetrics ? countryMetrics.deliveryRate : 0;
      const maxCPL = deliveryRate > 0 ? sellingPrice * (deliveryRate / 100) : 0;
      const profitBudget = countryMetrics ? countryMetrics.profit : 0;

      html += `
        <tr>
          <td>${country}</td>
          <td>$${fmt(sellingPrice)}</td>
          <td>$${fmt(maxCPL)}</td>
          <td>${fmt(deliveryRate)}%</td>
          <td class="${profitBudget >= 0 ? 'number-positive' : 'number-negative'}">$${fmt(profitBudget)}</td>
        </tr>
      `;
    });

    html += `
              </tbody>
            </table>
          </div>
        </div>
        
        <div class="product-notes-section">
          <h4>📝 Product Notes</h4>
          <div class="notes-grid">
    `;

    // Get product notes
    const notes = await api(`/api/products/${productId}/notes`);
    state.countries.forEach(country => {
      const note = notes.notes.find(n => n.country === country);
      html += `
        <div class="note-card">
          <div class="note-country">${country}</div>
          <div class="note-content">${note ? note.note : 'No notes yet'}</div>
          ${note ? `<div class="note-date">Updated: ${new Date(note.updatedAt).toLocaleDateString()}</div>` : ''}
        </div>
      `;
    });

    html += `
          </div>
        </div>
      </div>
    `;

    Q('#productInfoResults').innerHTML = html;
  };
}

/* ================================================================
   PERFORMANCE PAGE
   ================================================================ */
function renderPerformancePage() {
  initDateRangeSelectors();
  bindProductOrders();
  bindProductCostsAnalysis();
  bindRemittanceAnalytics();
  bindProfitByCountry();
  bindRemittanceAdd();
  bindRemittanceReport();
}

/* ---------- Product Orders Tracking ---------- */
function bindProductOrders() {
  const btn = Q('#poSave');
  if (!btn) return;
  
  btn.onclick = async () => {
    const payload = {
      productId: Q('#poProduct')?.value,
      country: Q('#poCountry')?.value,
      date: Q('#poDate')?.value || isoToday(),
      orders: +Q('#poOrders')?.value || 0
    };
    
    if (!payload.productId || !payload.country) {
      return alert('Please select product and country');
    }
    
    try {
      await api('/api/product-orders', { method: 'POST', body: JSON.stringify(payload) });
      alert('Orders data saved successfully!');
      Q('#poOrders').value = '';
    } catch (e) {
      alert('Error saving orders: ' + e.message);
    }
  };
}

/* ---------- Product Costs Analysis ---------- */
function bindProductCostsAnalysis() {
  const btn = Q('#pcaRun');
  if (!btn) return;
  
  btn.onclick = async () => {
    const productId = Q('#pcaProduct')?.value || '';
    const dateRange = getDateRange(Q('#pcaRun').closest('.row'));
    
    try {
      const analysis = await api('/api/product-costs-analysis?' + new URLSearchParams({
        productId,
        ...dateRange
      }));
      
      renderProductCostsAnalysis(analysis);
    } catch (e) {
      alert('Error generating analysis: ' + e.message);
    }
  };
}

function renderProductCostsAnalysis(analysis) {
  const container = Q('#pcaResults');
  if (!container) return;
  
  const profitClass = analysis.netProfit >= 0 ? 'number-positive' : 'number-negative';
  const bgClass = analysis.netProfit >= 0 ? 'profit-bg' : 'loss-bg';
  
  container.innerHTML = `
    <div class="costs-analysis-summary ${bgClass}">
      <div class="summary-header">
        <h3>📊 Product Costs Analysis Summary</h3>
        <div class="net-profit ${profitClass}">Net Profit: $${fmt(analysis.netProfit)}</div>
      </div>
      
      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Amount</th>
              <th>Metric</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Total Revenue</strong></td>
              <td class="number-positive">$${fmt(analysis.totalRevenue)}</td>
              <td><strong>Total Expenses</strong></td>
              <td class="number-negative">$${fmt(analysis.totalExpenses)}</td>
            </tr>
            <tr>
              <td>Product Costs</td>
              <td>$${fmt(analysis.totalProductCost)}</td>
              <td>China Shipping</td>
              <td>$${fmt(analysis.totalChinaShipping)}</td>
            </tr>
            <tr>
              <td>Inter-country Shipping</td>
              <td>$${fmt(analysis.totalInterShipping)}</td>
              <td>Influencer Costs</td>
              <td>$${fmt(analysis.totalInfluencerCost)}</td>
            </tr>
            <tr>
              <td>Advertising Spend</td>
              <td>$${fmt(analysis.totalAdSpend)}</td>
              <td>Boxleo Fees</td>
              <td>$${fmt(analysis.totalBoxleoFees)}</td>
            </tr>
            <tr>
              <td><strong>Delivered Pieces</strong></td>
              <td>${fmt(analysis.totalPieces)}</td>
              <td><strong>Total Orders</strong></td>
              <td>${fmt(analysis.totalOrders)}</td>
            </tr>
            <tr>
              <td><strong>Delivery Rate</strong></td>
              <td>${fmt(analysis.deliveryRate)}%</td>
              <td><strong>Cost per Piece</strong></td>
              <td>$${fmt(analysis.costPerDeliveredPiece)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/* ---------- Remittance Analytics ---------- */
function bindRemittanceAnalytics() {
  const btn = Q('#remAnalyticsRun');
  if (!btn) return;
  
  btn.onclick = async () => {
    const dateRange = getDateRange(btn.closest('.row'));
    const country = Q('#remAnalyticsCountry')?.value || '';
    const productId = Q('#remAnalyticsProduct')?.value || '';
    
    try {
      const analytics = await api('/api/analytics/remittance?' + new URLSearchParams({
        ...dateRange,
        country,
        productId
      }));
      
      renderRemittanceAnalytics(analytics.analytics);
    } catch (e) {
      alert('Error generating analytics: ' + e.message);
    }
  };
}

function renderRemittanceAnalytics(analytics) {
  const tb = Q('#remAnalyticsBody');
  if (!tb) return;
  
  let totalPieces = 0, totalRevenue = 0, totalAdSpend = 0, totalBoxleo = 0;
  let totalProductCost = 0, totalTotalCost = 0, totalProfit = 0;
  
  analytics.sort((a, b) => b.pieces - a.pieces);
  
  tb.innerHTML = analytics.map(item => {
    const product = state.products.find(p => p.id === item.productId) || { name: item.productId };
    
    totalPieces += item.totalPieces;
    totalRevenue += item.totalRevenue;
    totalAdSpend += item.totalAdSpend;
    totalBoxleo += item.totalBoxleoFees;
    totalProductCost += item.totalProductCost;
    totalTotalCost += item.totalCost;
    totalProfit += item.profit;
    
    return `<tr>
      <td>${product.name}</td>
      <td>${item.country}</td>
      <td><strong>${fmt(item.totalPieces)}</strong></td>
      <td>${fmt(item.totalRevenue)}</td>
      <td>${fmt(item.totalAdSpend)}</td>
      <td>${fmt(item.totalBoxleoFees)}</td>
      <td>${fmt(item.totalProductCost)}</td>
      <td>${fmt(item.totalCost)}</td>
      <td>${fmt(item.deliveryRate)}%</td>
      <td>${fmt(item.costPerDeliveredOrder)}</td>
      <td>${fmt(item.costPerDeliveredPiece)}</td>
      <td>${fmt(item.costPerOrderAd)}</td>
      <td>${fmt(item.costPerPieceAd)}</td>
      <td>${fmt(item.maxCostPerLead)}</td>
      <td class="${item.profit >= 0 ? 'number-positive' : 'number-negative'}">${fmt(item.profit)}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="15" class="muted">No data for selected period</td></tr>`;
  
  // Update totals
  Q('#remAnalyticsPiecesT').textContent = fmt(totalPieces);
  Q('#remAnalyticsRevenueT').textContent = fmt(totalRevenue);
  Q('#remAnalyticsAdSpendT').textContent = fmt(totalAdSpend);
  Q('#remAnalyticsBoxleoT').textContent = fmt(totalBoxleo);
  Q('#remAnalyticsProductCostT').textContent = fmt(totalProductCost);
  Q('#remAnalyticsTotalCostT').textContent = fmt(totalTotalCost);
  Q('#remAnalyticsDeliveryRateT').textContent = fmt(totalPieces > 0 ? (totalPieces / totalPieces * 100) : 0) + '%';
  Q('#remAnalyticsCostOrderT').textContent = fmt(totalPieces > 0 ? totalTotalCost / totalPieces : 0);
  Q('#remAnalyticsCostPieceT').textContent = fmt(totalPieces > 0 ? totalTotalCost / totalPieces : 0);
  Q('#remAnalyticsAdOrderT').textContent = fmt(totalPieces > 0 ? totalAdSpend / totalPieces : 0);
  Q('#remAnalyticsAdPieceT').textContent = fmt(totalPieces > 0 ? totalAdSpend / totalPieces : 0);
  Q('#remAnalyticsMaxCPLT').textContent = fmt(totalProfit / totalPieces);
  Q('#remAnalyticsProfitT').textContent = fmt(totalProfit);
}

/* ---------- Profit by Country ---------- */
function bindProfitByCountry() {
  const btn = Q('#pcRun');
  if (!btn) return;
  
  btn.onclick = async () => {
    const dateRange = getDateRange(btn.closest('.row'));
    const country = Q('#pcCountry')?.value || '';
    
    try {
      const analytics = await api('/api/analytics/profit-by-country?' + new URLSearchParams({
        ...dateRange,
        country
      }));
      
      renderProfitByCountry(analytics.analytics);
    } catch (e) {
      alert('Error calculating profit: ' + e.message);
    }
  };
}

function renderProfitByCountry(analytics) {
  const tb = Q('#profitCountryBody');
  if (!tb) return;
  
  let totalRevenue = 0, totalAdSpend = 0, totalBoxleo = 0;
  let totalProductCost = 0, totalTotalCost = 0, totalPieces = 0, totalProfit = 0;
  
  tb.innerHTML = Object.entries(analytics).map(([country, metrics]) => {
    totalRevenue += metrics.totalRevenue;
    totalAdSpend += metrics.totalAdSpend;
    totalBoxleo += metrics.totalBoxleoFees;
    totalProductCost += metrics.totalProductCost;
    totalTotalCost += metrics.totalCost;
    totalPieces += metrics.totalPieces;
    totalProfit += metrics.profit;
    
    return `<tr>
      <td>${country}</td>
      <td>${fmt(metrics.totalRevenue)}</td>
      <td>${fmt(metrics.totalAdSpend)}</td>
      <td>${fmt(metrics.totalBoxleoFees)}</td>
      <td>${fmt(metrics.totalProductCost)}</td>
      <td>${fmt(metrics.totalCost)}</td>
      <td>${fmt(metrics.totalPieces)}</td>
      <td>${fmt(metrics.deliveryRate)}%</td>
      <td>${fmt(metrics.costPerDeliveredOrder)}</td>
      <td>${fmt(metrics.costPerDeliveredPiece)}</td>
      <td class="${metrics.profit >= 0 ? 'number-positive' : 'number-negative'}">${fmt(metrics.profit)}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="11" class="muted">No data</td></tr>`;
  
  Q('#pcRevT').textContent = fmt(totalRevenue);
  Q('#pcAdT').textContent = fmt(totalAdSpend);
  Q('#pcBoxleoT').textContent = fmt(totalBoxleo);
  Q('#pcProductCostT').textContent = fmt(totalProductCost);
  Q('#pcTotalCostT').textContent = fmt(totalTotalCost);
  Q('#pcPiecesT').textContent = fmt(totalPieces);
  Q('#pcDeliveryRateT').textContent = fmt(totalPieces > 0 ? (totalPieces / totalPieces * 100) : 0) + '%';
  Q('#pcCostOrderT').textContent = fmt(totalPieces > 0 ? totalTotalCost / totalPieces : 0);
  Q('#pcCostPieceT').textContent = fmt(totalPieces > 0 ? totalTotalCost / totalPieces : 0);
  Q('#pcProfitT').textContent = fmt(totalProfit);
}

/* ---------- Add Remittance Entry ---------- */
function bindRemittanceAdd() {
  const btn = Q('#remAddSave');
  if (!btn) return;
  
  // Set default dates
  const today = new Date();
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 7);
  
  Q('#remAddStart').value = sevenDaysAgo.toISOString().slice(0,10);
  Q('#remAddEnd').value = today.toISOString().slice(0,10);
  
  btn.onclick = async () => {
    const payload = {
      start: Q('#remAddStart')?.value,
      end: Q('#remAddEnd')?.value,
      country: Q('#remAddCountry')?.value,
      productId: Q('#remAddProduct')?.value,
      orders: +Q('#remAddOrders')?.value || 0,
      pieces: +Q('#remAddPieces')?.value || 0,
      revenue: +Q('#remAddRevenue')?.value || 0,
      adSpend: +Q('#remAddAdSpend')?.value || 0,
      boxleoFees: +Q('#remAddBoxleo')?.value || 0
    };
    
    if (!payload.start || !payload.end || !payload.country || !payload.productId) {
      return alert('Please fill all required fields: Start Date, End Date, Country, and Product');
    }
    
    try {
      await api('/api/remittances', { method: 'POST', body: JSON.stringify(payload) });
      alert('Remittance entry added successfully!');
      // Clear only numeric fields, keep dates and selections
      Q('#remAddOrders').value = '';
      Q('#remAddPieces').value = '';
      Q('#remAddRevenue').value = '';
      Q('#remAddAdSpend').value = '';
      Q('#remAddBoxleo').value = '';
      
      // Refresh the remittance report
      renderRemittanceReport();
    } catch (e) {
      alert('Error adding remittance: ' + e.message);
    }
  };
}

/* ---------- Remittance Report ---------- */
function bindRemittanceReport() {
  const btn = Q('#remRun');
  if (!btn) return;
  
  btn.onclick = renderRemittanceReport;
}

async function renderRemittanceReport() {
  const dateRange = getDateRange(Q('#remRun').closest('.row'));
  const country = Q('#remCountry')?.value || '';
  const productId = Q('#remProduct')?.value || '';
  
  let rem = await api('/api/remittances?' + new URLSearchParams({
    ...dateRange,
    country,
    productId
  }));
  
  rem = rem.remittances || [];
  
  // Sort by pieces descending
  rem.sort((a, b) => (b.pieces || 0) - (a.pieces || 0));
  
  const prodMap = Object.fromEntries(state.products.map(p => [p.id, p]));
  let totalOrders = 0, totalPieces = 0, totalRevenue = 0, totalAdSpend = 0;
  let totalBoxleo = 0, totalProductCost = 0, totalTotalCost = 0, totalProfit = 0;
  
  const tb = Q('#remittanceBody');
  tb.innerHTML = rem.map(r => {
    const product = prodMap[r.productId] || {};
    const productCosts = calculateProductCosts({ shipments: [], remittances: [] }, r.productId, r.country);
    const costPerPiece = productCosts.costPerPiece;
    const productCost = costPerPiece * (+r.pieces || 0);
    const totalCost = productCost + (+r.adSpend || 0) + (+r.boxleoFees || 0);
    const profit = (+r.revenue || 0) - totalCost;
    const deliveryRate = 0; // This would need orders data to calculate
    
    totalOrders += (+r.orders || 0);
    totalPieces += (+r.pieces || 0);
    totalRevenue += (+r.revenue || 0);
    totalAdSpend += (+r.adSpend || 0);
    totalBoxleo += (+r.boxleoFees || 0);
    totalProductCost += productCost;
    totalTotalCost += totalCost;
    totalProfit += profit;
    
    return `<tr>
      <td>${r.start} - ${r.end}</td>
      <td>${product.name || r.productId}</td>
      <td>${r.country}</td>
      <td>${fmt(r.orders)}</td>
      <td>${fmt(r.pieces)}</td>
      <td>${fmt(r.revenue)}</td>
      <td>${fmt(r.adSpend)}</td>
      <td>${fmt(r.boxleoFees)}</td>
      <td>${fmt(productCost)}</td>
      <td>${fmt(totalCost)}</td>
      <td>${fmt(deliveryRate)}%</td>
      <td class="${profit >= 0 ? 'number-positive' : 'number-negative'}">${fmt(profit)}</td>
      <td><button class="btn outline rem-del" data-id="${r.id}">Delete</button></td>
    </tr>`;
  }).join('') || `<tr><td colspan="13" class="muted">No remittance data</td></tr>`;
  
  Q('#remOrdersT').textContent = fmt(totalOrders);
  Q('#remPiecesT').textContent = fmt(totalPieces);
  Q('#remRevenueT').textContent = fmt(totalRevenue);
  Q('#remAdSpendT').textContent = fmt(totalAdSpend);
  Q('#remBoxleoT').textContent = fmt(totalBoxleo);
  Q('#remProductCostT').textContent = fmt(totalProductCost);
  Q('#remTotalCostT').textContent = fmt(totalTotalCost);
  Q('#remDeliveryRateT').textContent = fmt(totalOrders > 0 ? (totalPieces / totalOrders * 100) : 0) + '%';
  Q('#remProfitT').textContent = fmt(totalProfit);
  
  // Add delete functionality
  tb.addEventListener('click', async (e) => {
    if (e.target.classList.contains('rem-del')) {
      if (!confirm('Delete this remittance entry?')) return;
      try {
        await api(`/api/remittances/${e.target.dataset.id}`, { method: 'DELETE' });
        renderRemittanceReport();
      } catch (err) {
        alert('Error deleting remittance: ' + err.message);
      }
    }
  });
}

// Helper function for product costs calculation (simplified)
function calculateProductCosts(db, productId, country) {
  // This is a simplified version - in real implementation, 
  // this would calculate based on actual shipment data
  return {
    totalCost: 0,
    totalPieces: 0,
    costPerPiece: 10 // Example default cost
  };
}

/* ================================================================
   STOCK MOVEMENT PAGE
   ================================================================ */
function renderStockMovementPage() {
  // Show/hide China cost field based on origin selection
  Q('#mvFrom')?.addEventListener('change', function() {
    const chinaField = Q('#chinaCostField');
    if (this.value === 'china') {
      chinaField.style.display = 'block';
    } else {
      chinaField.style.display = 'none';
    }
  });

  const btn = Q('#mvAdd');
  if (!btn) return;
  
  btn.onclick = async ()=>{
    const payload = {
      productId: Q('#mvProduct')?.value,
      fromCountry: Q('#mvFrom')?.value,
      toCountry: Q('#mvTo')?.value,
      qty: +Q('#mvQty')?.value || 0,
      shipCost: +Q('#mvShip')?.value || 0,
      chinaCost: Q('#mvFrom')?.value === 'china' ? +Q('#mvChinaCost')?.value || 0 : 0,
      note: Q('#mvNote')?.value || '',
      departedAt: isoToday(),
      arrivedAt: null
    };
    
    if (!payload.productId || !payload.fromCountry || !payload.toCountry) return alert('Missing fields');
    if (payload.fromCountry === 'china' && !payload.chinaCost) return alert('China cost required for shipments from China');
    
    try{
      await api('/api/shipments',{method:'POST', body: JSON.stringify(payload)});
      await renderTransitTables();
      alert('Shipment created');
    } catch(e){ alert(e.message); }
  };

  renderTransitTables();
}

async function renderTransitTables() {
  const tbl1 = Q('#shipCKBody'), tbl2 = Q('#shipICBody');
  if (!tbl1 && !tbl2) return;
  
  const s = await api('/api/shipments');
  const live = (s.shipments||[]).filter(x=>!x.arrivedAt);
  const prodMap = Object.fromEntries(state.products.map(p=>[p.id,p.name]));

  const row = sp => {
    const days = sp.arrivedAt ? Math.round((+new Date(sp.arrivedAt)-(+new Date(sp.departedAt)))/86400000) : '';
    return `<tr>
      <td>${sp.id}</td>
      <td>${prodMap[sp.productId]||sp.productId}</td>
      <td>${sp.fromCountry||sp.from} → ${sp.toCountry||sp.to}</td>
      <td>${fmt(sp.qty)}</td>
      <td>${fmt(sp.shipCost)}</td>
      <td>${sp.fromCountry === 'china' ? fmt(sp.chinaCost) : '-'}</td>
      <td>${sp.departedAt||''}</td>
      <td>${sp.arrivedAt||''}</td>
      <td>${days}</td>
      <td>${sp.note||''}</td>
      <td>
        <button class="btn outline act-arr" data-id="${sp.id}">Arrived</button>
        <button class="btn outline act-edit" data-id="${sp.id}">Edit</button>
        <button class="btn outline act-del" data-id="${sp.id}">Delete</button>
      </td>
    </tr>`;
  };

  const ck = live.filter(sp => (sp.fromCountry||sp.from||'').toLowerCase()==='china' && (sp.toCountry||sp.to||'').toLowerCase()==='kenya');
  const ic = live.filter(sp => !ck.includes(sp));

  if (tbl1) tbl1.innerHTML = ck.map(row).join('') || `<tr><td colspan="11" class="muted">No transit</td></tr>`;
  if (tbl2) tbl2.innerHTML = ic.map(row).join('') || `<tr><td colspan="10" class="muted">No transit</td></tr>`;

  const host = Q('#stockMovement') || document;
  host.addEventListener('click', async (e)=>{
    const id = e.target.dataset?.id;
    if (!id) return;

    if (e.target.classList.contains('act-arr')) {
      const date = prompt('Arrival date (YYYY-MM-DD)', isoToday());
      if (!date) return;
      try { await api(`/api/shipments/${id}`, { method:'PUT', body: JSON.stringify({ arrivedAt: date })}); }
      catch(err){ return alert(err.message); }
      await renderTransitTables();
      await renderCountryStockSpend();
    }

    if (e.target.classList.contains('act-edit')) {
      const qty = +prompt('New qty?', '0') || 0;
      const shipCost = +prompt('New shipping cost?', '0') || 0;
      const chinaCost = +prompt('New China cost?', '0') || 0;
      const note = prompt('Note?', '') || '';
      try { await api(`/api/shipments/${id}`,{method:'PUT', body: JSON.stringify({ qty, shipCost, chinaCost, note })}); }
      catch(err){ return alert(err.message); }
      await renderTransitTables();
    }

    if (e.target.classList.contains('act-del')) {
      if (!confirm('Delete shipment?')) return;
      try { await api(`/api/shipments/${id}`,{method:'DELETE'}); }
      catch(err){ return alert(err.message); }
      await renderTransitTables();
    }
  }, { once:true });
}

/* ================================================================
   FINANCE PAGE
   ================================================================ */
function renderFinancePage() {
  refreshFinanceCategories();
  
  Q('#fcAdd')?.addEventListener('click', async ()=>{
    const type = Q('#fcType')?.value, name = Q('#fcName')?.value.trim();
    if (!name) return;
    await api('/api/finance/categories',{method:'POST', body: JSON.stringify({type,name})});
    Q('#fcName').value=''; await refreshFinanceCategories();
  });

  Q('#finance')?.addEventListener('click', async (e)=>{
    if (e.target.classList.contains('chip-x')) {
      const type = e.target.dataset.type, name = e.target.dataset.name;
      if (!confirm(`Delete category "${name}"?`)) return;
      await api(`/api/finance/categories?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}`,{method:'DELETE'});
      await refreshFinanceCategories();
    }
  });

  Q('#feAdd')?.addEventListener('click', async ()=>{
    const date = Q('#feDate')?.value, 
          cat = Q('#feCat')?.value, 
          amt = +Q('#feAmt')?.value||0, 
          note = Q('#feNote')?.value||'';
    
    if (!date||!cat) return alert('Pick date & category');
    
    const type = state.categories.credit.includes(cat) ? 'credit':'debit';
    await api('/api/finance/entries',{method:'POST', body: JSON.stringify({date, type, category:cat, amount:amt, note})});
    Q('#feAmt').value=''; Q('#feNote').value='';
    await runFinancePeriod();
  });

  Q('#fcSearchRun')?.addEventListener('click', runFinanceCategorySearch);
  Q('#feRun')?.addEventListener('click', runFinancePeriod);
  
  runFinancePeriod();
}

async function refreshFinanceCategories() {
  const cats = await api('/api/finance/categories');
  state.categories = cats;
  const mk = (arr, type) => arr.map(c=>`<span class="chip">${c}<button class="chip-x" data-type="${type}" data-name="${c}">×</button></span>`).join('') || '—';
  Q('#fcDebits') && (Q('#fcDebits').innerHTML = mk(cats.debit,'debit'));
  Q('#fcCredits') && (Q('#fcCredits').innerHTML = mk(cats.credit,'credit'));

  const all = [...cats.debit, ...cats.credit].sort();
  Q('#feCat') && (Q('#feCat').innerHTML = `<option value="" disabled selected>Select category</option>` + all.map(c=>`<option>${c}</option>`).join(''));
  
  Q('#fcSearchCat') && (Q('#fcSearchCat').innerHTML = `<option value="">All categories</option>` + all.map(c=>`<option>${c}</option>`).join(''));
}

async function runFinancePeriod() {
  const s = Q('#fes')?.value, e = Q('#fee')?.value;
  const r = await api('/api/finance/entries' + ((s||e)?`?start=${s||''}&end=${e||''}`:''));
  Q('#runBalance') && (Q('#runBalance').textContent = fmt(r.running||0)+' USD');
  Q('#feBalance') && (Q('#feBalance').textContent = 'Period Balance: ' + fmt(r.balance||0) + ' USD');
  const tb = Q('#feTable tbody');
  tb && (tb.innerHTML = (r.entries||[]).map(x=>`
    <tr>
      <td>${x.date}</td>
      <td>${x.type}</td>
      <td>${x.category}</td>
      <td>${fmt(x.amount)}</td>
      <td>${x.note||''}</td>
      <td><button class="btn outline fe-del" data-id="${x.id}">Delete</button></td>
    </tr>
  `).join('') || `<tr><td colspan="6" class="muted">No entries</td></tr>`);
  tb?.addEventListener('click', async (e)=>{
    if (e.target.classList.contains('fe-del')) {
      await api(`/api/finance/entries/${e.target.dataset.id}`,{method:'DELETE'});
      await runFinancePeriod();
    }
  }, { once:true });
}

async function runFinanceCategorySearch() {
  const s = Q('#fcSearchStart')?.value, 
        e = Q('#fcSearchEnd')?.value, 
        cat = Q('#fcSearchCat')?.value,
        type = Q('#fcSearchType')?.value;
  
  if (!s || !e) return alert('Select date range');
  
  const r = await api(`/api/finance/entries?start=${s}&end=${e}` + (cat ? `&category=${cat}` : '') + (type ? `&type=${type}` : ''));
  
  Q('#fcSearchResult').textContent = `Total: ${fmt(r.categoryTotal || 0)} USD`;
  Q('#fcSearchCount').textContent = `Entries: ${r.entries?.length || 0}`;
}

/* ================================================================
   SETTINGS PAGE
   ================================================================ */
function renderSettingsPage() {
  Q('#ctyAdd')?.addEventListener('click', async ()=>{
    const name = Q('#cty')?.value.trim(); if (!name) return;
    await api('/api/countries',{method:'POST', body: JSON.stringify({name})});
    await preload(); renderCountryChips();
  });
  
  renderCountryChips();
  
  Q('#ctyList')?.addEventListener('click', async (e)=>{
    if (e.target.classList.contains('chip-x')) {
      const name = e.target.dataset.name;
      if (!confirm(`Delete country "${name}"?`)) return;
      await api(`/api/countries/${encodeURIComponent(name)}`,{method:'DELETE'});
      await preload(); renderCountryChips(); fillCommonSelects();
    }
  });

  const sel = Q('#epSelect');
  if (sel) {
    sel.innerHTML = `<option value="">Select product…</option>`+
      state.products.map(p=>`<option value="${p.id}">${p.name}${p.sku?` (${p.sku})`:''}</option>`).join('');
    sel.onchange = ()=>{
      const p = state.products.find(x=>x.id===sel.value);
      if (!p) return;
      Q('#epName').value = p.name||''; Q('#epSku').value = p.sku||'';
      Q('#epMB').value = p.margin_budget||0;
    };
    
    Q('#epSave')?.addEventListener('click', async ()=>{
      const id = sel.value; if (!id) return alert('Pick a product');
      const up = {
        name: Q('#epName').value, sku: Q('#epSku').value,
        margin_budget:+Q('#epMB').value||0
      };
      await api(`/api/products/${id}`,{method:'PUT', body: JSON.stringify(up)});
      await preload(); alert('Saved');
    });
  }

  const listBox = Q('#snapList');
  async function refreshSnaps() {
    const r = await api('/api/snapshots');
    listBox.innerHTML = (r.snapshots||[]).map(s=>`
      <tr>
        <td>${s.name}</td><td>${s.file.replace(/^.*data\\?\\/,'')}</td>
        <td>
          <button class="btn outline ss-push" data-file="${s.file}">Push</button>
          <button class="btn outline ss-del" data-id="${s.id}">Delete</button>
        </td>
      </tr>`).join('') || `<tr><td colspan="3" class="muted">No snapshots</td></tr>`;
  }
  refreshSnaps();

  Q('#snapSave')?.addEventListener('click', async ()=>{
    const name = Q('#snapName')?.value.trim() || ('Manual '+new Date().toLocaleString());
    await api('/api/snapshots',{method:'POST', body: JSON.stringify({name})});
    Q('#snapName').value='';
    await refreshSnaps();
  });

  listBox?.addEventListener('click', async (e)=>{
    if (e.target.classList.contains('ss-push')) {
      await api('/api/snapshots/restore',{method:'POST', body: JSON.stringify({file:e.target.dataset.file})});
      alert('Pushed snapshot to system. (Snapshot kept)');
      location.reload();
    }
    if (e.target.classList.contains('ss-del')) {
      if (!confirm('Delete this snapshot?')) return;
      await api(`/api/snapshots/${e.target.dataset.id}`,{method:'DELETE'});
      await refreshSnaps();
    }
  });
}

function renderCountryChips() {
  const box = Q('#ctyList'); if (!box) return;
  box.innerHTML = state.countries.map(c=>`<span class="chip">${c}<button class="chip-x" data-name="${c}">×</button></span>`).join('') || '—';
}

/* ================================================================
   PRODUCT PAGE
   ================================================================ */
async function renderProductPage() {
  await preload();
  const product = state.products.find(p=>p.id===state.productId);
  if (!product) { alert('Product not found'); location.href='/'; return; }
  
  Q('#pdTitle').textContent = product.name;
  Q('#pdSku').textContent = product.sku ? `SKU: ${product.sku}` : '';

  initDateRangeSelectors();
  await renderProductStockAd(product);
  renderProductBudgets(product);
  await renderProductTransit(product);
  await renderProductArrivedShipments(product);
  bindProductLifetime(product);
  await renderProductRemittances(product);
  await bindInfluencers(product);
  bindProductNotes(product);
}

async function renderProductStockAd(product) {
  const tb = Q('#pdStockBody'); if (!tb) return;
  const per = {}; 
  state.countries.forEach(c=> {
    per[c] = { 
      stock: 0, 
      facebook: 0, 
      tiktok: 0, 
      google: 0, 
      totalAd: 0 
    };
  });

  const s = await api('/api/shipments');
  (s.shipments||[]).filter(x=>x.productId===product.id && x.arrivedAt).forEach(sp=>{
    const to = sp.toCountry||sp.to, from = sp.fromCountry||sp.from, q=(+sp.qty||0);
    if (to && state.countries.includes(to)) {
      per[to]=per[to]||{stock:0, facebook:0, tiktok:0, google:0, totalAd:0}; per[to].stock += q;
    }
    if (from && state.countries.includes(from)) {
      per[from]=per[from]||{stock:0, facebook:0, tiktok:0, google:0, totalAd:0}; per[from].stock -= q;
    }
  });

  const r = await api('/api/remittances');
  (r.remittances||[]).filter(x=>x.productId===product.id).forEach(rr=>{
    if (state.countries.includes(rr.country)) {
      per[rr.country]=per[rr.country]||{stock:0, facebook:0, tiktok:0, google:0, totalAd:0};
      per[rr.country].stock -= (+rr.pieces||0);
    }
  });

  const a = await api('/api/adspend');
  (a.adSpends||[]).filter(x=>x.productId===product.id).forEach(sp=>{
    if (state.countries.includes(sp.country)) {
      per[sp.country]=per[sp.country]||{stock:0, facebook:0, tiktok:0, google:0, totalAd:0};
      const amount = +sp.amount||0;
      if (sp.platform === 'facebook') per[sp.country].facebook += amount;
      else if (sp.platform === 'tiktok') per[sp.country].tiktok += amount;
      else if (sp.platform === 'google') per[sp.country].google += amount;
      per[sp.country].totalAd += amount;
    }
  });

  let st=0, fb=0, tt=0, gg=0, totalAd=0;
  tb.innerHTML = Object.entries(per).map(([c,v])=>{
    st+=v.stock; fb+=v.facebook; tt+=v.tiktok; gg+=v.google; totalAd+=v.totalAd;
    
    return `<tr>
      <td>${c}</td>
      <td>${fmt(v.stock)}</td>
      <td>${fmt(v.facebook)}</td>
      <td>${fmt(v.tiktok)}</td>
      <td>${fmt(v.google)}</td>
      <td>${fmt(v.totalAd)}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="6" class="muted">No data</td></tr>`;
  
  Q('#pdStockTotal').textContent = fmt(st);
  Q('#pdFbTotal').textContent = fmt(fb);
  Q('#pdTtTotal').textContent = fmt(tt);
  Q('#pdGgTotal').textContent = fmt(gg);
  Q('#pdAdTotal').textContent = fmt(totalAd);
}

function renderProductBudgets(product) {
  const tb = Q('#pdPBBBody');
  if (!tb) return;

  // This would need to be implemented with actual data
  // For now, showing a placeholder
  tb.innerHTML = state.countries.map(c => `
    <tr>
      <td>${c}</td>
      <td>$0.00</td>
      <td>$0.00</td>
      <td>$0.00</td>
      <td>0%</td>
      <td>$0.00</td>
    </tr>
  `).join('') || `<tr><td colspan="6" class="muted">No data available</td></tr>`;
}

async function renderProductTransit(product) {
  const s = await api('/api/shipments');
  const list = (s.shipments||[]).filter(x=>x.productId===product.id && !x.arrivedAt);
  const ck = list.filter(sp => (sp.fromCountry||sp.from||'').toLowerCase()==='china' && (sp.toCountry||sp.to||'').toLowerCase()==='kenya');
  const ic = list.filter(sp => !ck.includes(sp));
  
  const row = sp => `<tr>
    <td>${sp.id}</td>
    <td>${sp.fromCountry||sp.from} → ${sp.toCountry||sp.to}</td>
    <td>${fmt(sp.qty)}</td>
    <td>${fmt(sp.shipCost)}</td>
    <td>${sp.fromCountry === 'china' ? fmt(sp.chinaCost) : '-'}</td>
    <td>${sp.departedAt||''}</td>
    <td>${sp.arrivedAt||''}</td>
    <td>
      <button class="btn outline p-act-arr" data-id="${sp.id}">Arrived</button>
      <button class="btn outline p-act-edit" data-id="${sp.id}">Edit</button>
      <button class="btn outline p-act-del" data-id="${sp.id}">Delete</button>
    </td></tr>`;
  
  Q('#pdShipCKBody').innerHTML = ck.map(row).join('') || `<tr><td colspan="8" class="muted">No shipments</td></tr>`;
  Q('#pdShipICBody').innerHTML = ic.map(row).join('') || `<tr><td colspan="7" class="muted">No shipments</td></tr>`;

  const host = Q('#product');
  host.addEventListener('click', async (e)=>{
    const id = e.target.dataset?.id; if (!id) return;
    if (e.target.classList.contains('p-act-arr')) {
      const date = prompt('Arrival date (YYYY-MM-DD)', isoToday()); if (!date) return;
      await api(`/api/shipments/${id}`,{method:'PUT', body: JSON.stringify({arrivedAt:date})});
      await renderProductTransit(product); 
      await renderProductArrivedShipments(product);
      await renderProductStockAd(product);
    }
    if (e.target.classList.contains('p-act-edit')) {
      const qty = +prompt('New qty?', '0')||0;
      const shipCost = +prompt('New shipping cost?', '0')||0;
      const chinaCost = +prompt('New China cost?', '0')||0;
      const note = prompt('Note?', '') || '';
      await api(`/api/shipments/${id}`,{method:'PUT', body: JSON.stringify({qty,shipCost,chinaCost,note})});
      await renderProductTransit(product);
    }
    if (e.target.classList.contains('p-act-del')) {
      if (!confirm('Delete shipment?')) return;
      await api(`/api/shipments/${id}`,{method:'DELETE'});
      await renderProductTransit(product);
    }
  }, { once:true });
}

async function renderProductArrivedShipments(product) {
  const s = await api('/api/shipments');
  const arrived = (s.shipments||[]).filter(x=>x.productId===product.id && x.arrivedAt);
  
  const row = sp => {
    const days = sp.arrivedAt ? Math.round((+new Date(sp.arrivedAt)-(+new Date(sp.departedAt)))/86400000) : '';
    return `<tr>
      <td>${sp.id}</td>
      <td>${sp.fromCountry||sp.from} → ${sp.toCountry||sp.to}</td>
      <td>${fmt(sp.qty)}</td>
      <td>${fmt(sp.shipCost)}</td>
      <td>${sp.fromCountry === 'china' ? fmt(sp.chinaCost) : '-'}</td>
      <td>${sp.departedAt||''}</td>
      <td>${sp.arrivedAt||''}</td>
      <td>${days}</td>
      <td>${sp.note||''}</td>
      <td>
        <button class="btn outline p-arr-edit" data-id="${sp.id}">Edit</button>
        <button class="btn outline p-arr-del" data-id="${sp.id}">Delete</button>
      </td>
    </tr>`;
  };

  Q('#pdArrivedBody').innerHTML = arrived.map(row).join('') || `<tr><td colspan="10" class="muted">No arrived shipments</td></tr>`;

  const host = Q('#product');
  host.addEventListener('click', async (e)=>{
    const id = e.target.dataset?.id; if (!id) return;
    
    if (e.target.classList.contains('p-arr-edit')) {
      const qty = +prompt('New qty?', '0')||0;
      const shipCost = +prompt('New shipping cost?', '0')||0;
      const chinaCost = +prompt('New China cost?', '0')||0;
      const note = prompt('Note?', '') || '';
      await api(`/api/shipments/${id}`,{method:'PUT', body: JSON.stringify({qty,shipCost,chinaCost,note})});
      await renderProductArrivedShipments(product);
    }
    if (e.target.classList.contains('p-arr-del')) {
      if (!confirm('Delete shipment?')) return;
      await api(`/api/shipments/${id}`,{method:'DELETE'});
      await renderProductArrivedShipments(product);
      await renderProductStockAd(product);
    }
  }, { once:true });
}

async function renderProductRemittances(product) {
  try {
    const remittances = await api('/api/remittances?productId=' + product.id);
    const tb = Q('#pdRemittancesBody');
    if (!tb) return;
    
    tb.innerHTML = (remittances.remittances||[]).map(r => `
      <tr>
        <td>${r.start} - ${r.end}</td>
        <td>${r.country}</td>
        <td>${fmt(r.orders)}</td>
        <td>${fmt(r.pieces)}</td>
        <td>${fmt(r.revenue)}</td>
        <td>${fmt(r.adSpend)}</td>
        <td>${fmt(r.boxleoFees)}</td>
        <td>
          <button class="btn outline pd-rem-del" data-id="${r.id}">Delete</button>
        </td>
      </tr>
    `).join('') || `<tr><td colspan="8" class="muted">No remittances for this product</td></tr>`;

    tb.addEventListener('click', async (e)=>{
      if (e.target.classList.contains('pd-rem-del')) {
        if (!confirm('Delete this remittance entry?')) return;
        await api(`/api/remittances/${e.target.dataset.id}`,{method:'DELETE'});
        await renderProductRemittances(product);
        bindProductLifetime(product);
      }
    });
  } catch (e) {
    console.error('Failed to load product remittances:', e);
  }
}

function bindProductLifetime(product) {
  const run = async ()=>{
    const dateRange = getDateRange(Q('#pdLPRun').closest('.row'));
    
    const analytics = await api('/api/analytics/remittance?' + new URLSearchParams({
      productId: product.id,
      ...dateRange
    }));
    
    renderProductLifetime(analytics.analytics);
  };
  
  Q('#pdLPRun')?.addEventListener('click', run);
  run();
}

function renderProductLifetime(analytics) {
  const tb = Q('#pdLPBody');
  if (!tb) return;
  
  let totalRevenue = 0, totalAdSpend = 0, totalBoxleo = 0;
  let totalProductCost = 0, totalShipCost = 0, totalTotalCost = 0, totalPieces = 0, totalProfit = 0;
  
  tb.innerHTML = analytics.map(item => {
    totalRevenue += item.totalRevenue;
    totalAdSpend += item.totalAdSpend;
    totalBoxleo += item.totalBoxleoFees;
    totalProductCost += item.totalProductCost;
    totalShipCost += 0; // This would need actual shipment data
    totalTotalCost += item.totalCost;
    totalPieces += item.totalPieces;
    totalProfit += item.profit;
    
    return `<tr>
      <td>${item.country}</td>
      <td>${fmt(item.totalRevenue)}</td>
      <td>${fmt(item.totalAdSpend)}</td>
      <td>${fmt(item.totalBoxleoFees)}</td>
      <td>${fmt(item.totalProductCost)}</td>
      <td>${fmt(0)}</td>
      <td>${fmt(item.totalCost)}</td>
      <td>${fmt(item.totalPieces)}</td>
      <td>${fmt(item.deliveryRate)}%</td>
      <td class="${item.profit >= 0 ? 'number-positive' : 'number-negative'}">${fmt(item.profit)}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="10" class="muted">No data</td></tr>`;
  
  Q('#pdLPRevT').textContent = fmt(totalRevenue);
  Q('#pdLPAdT').textContent = fmt(totalAdSpend);
  Q('#pdLPBoxleoT').textContent = fmt(totalBoxleo);
  Q('#pdLPProductCostT').textContent = fmt(totalProductCost);
  Q('#pdLPShipT').textContent = fmt(totalShipCost);
  Q('#pdLPTotalCostT').textContent = fmt(totalTotalCost);
  Q('#pdLPPcsT').textContent = fmt(totalPieces);
  Q('#pdLPDeliveryRateT').textContent = fmt(totalPieces > 0 ? (totalPieces / totalPieces * 100) : 0) + '%';
  Q('#pdLPProfitT').textContent = fmt(totalProfit);
}

async function bindInfluencers(product) {
  Q('#pdInfAdd')?.addEventListener('click', async ()=>{
    const payload = {
      name: Q('#pdInfName')?.value.trim(),
      social: Q('#pdInfSocial')?.value.trim(),
      country: Q('#pdInfCountry')?.value
    };
    if (!payload.name) return alert('Name required');
    await api('/api/influencers',{method:'POST', body: JSON.stringify(payload)});
    Q('#pdInfName').value=''; Q('#pdInfSocial').value='';
    await refreshInfluencers(product);
  });

  Q('#pdInfSpendAdd')?.addEventListener('click', async ()=>{
    const payload = {
      date: Q('#pdInfDate')?.value || isoToday(),
      influencerId: Q('#pdInfSelect')?.value,
      country: Q('#pdInfCountry')?.value,
      productId: product.id,
      amount: +Q('#pdInfAmount')?.value||0
    };
    if (!payload.influencerId) return alert('Select influencer');
    await api('/api/influencers/spend',{method:'POST', body: JSON.stringify(payload)});
    await refreshInfluencers(product);
  });

  Q('#pdInfRun')?.addEventListener('click', ()=>refreshInfluencers(product));
  await refreshInfluencers(product);
}

async function refreshInfluencers(product) {
  const infs = await api('/api/influencers');
  const spends = await api('/api/influencers/spend');
  const sel = Q('#pdInfSelect');
  sel.innerHTML = (infs.influencers||[]).map(i=>`<option value="${i.id}">${i.name}</option>`).join('') || '<option value="">No influencers</option>';

  const dateRange = getDateRange(Q('#pdInfRun').closest('.row'));
  const c = Q('#pdInfFilterCountry')?.value||'';
  
  const list = (spends.spends||[]).filter(x=>x.productId===product.id)
    .filter(x=>(!c || x.country===c))
    .filter(x=>(!dateRange.start || x.date>=dateRange.start) && (!dateRange.end || x.date<=dateRange.end));
  
  const infMap = Object.fromEntries((infs.influencers||[]).map(i=>[i.id,i]));
  let total = 0;
  Q('#pdInfBody').innerHTML = list.map(x=>{
    total += (+x.amount||0);
    const i = infMap[x.influencerId]||{};
    return `<tr><td>${x.date}</td><td>${x.country}</td><td>${i.name||'-'}</td><td>${i.social||'-'}</td><td>${fmt(x.amount)}</td>
      <td><button class="btn outline inf-del" data-id="${x.id}">Delete</button></td></tr>`;
  }).join('') || `<tr><td colspan="6" class="muted">No spends</td></tr>`;
  Q('#pdInfTotal').textContent = fmt(total);

  Q('#pdInfBody').onclick = async (e)=>{
    if (e.target.classList.contains('inf-del')) {
      await api(`/api/influencers/spend/${e.target.dataset.id}`,{method:'DELETE'});
      await refreshInfluencers(product);
    }
  };
}

function bindProductNotes(product) {
  const saveBtn = Q('#pdNoteSave');
  if (!saveBtn) return;

  saveBtn.onclick = async () => {
    const country = Q('#pdNoteCountry')?.value;
    const note = Q('#pdNoteText')?.value.trim();

    if (!country || !note) return alert('Please select country and enter note');

    await api(`/api/products/${product.id}/notes`, {
      method: 'POST',
      body: JSON.stringify({ country, note })
    });

    Q('#pdNoteText').value = '';
    loadProductNotes(product);
  };

  loadProductNotes(product);
}

async function loadProductNotes(product) {
  const notes = await api(`/api/products/${product.id}/notes`);
  const container = Q('#pdNotesList');
  
  if (!container) return;

  container.innerHTML = notes.notes.map(note => `
    <div class="note-card">
      <div class="note-header">
        <strong>${note.country}</strong>
        <button class="btn outline small note-del" data-id="${note.id}">Delete</button>
      </div>
      <div class="note-content">${note.note}</div>
      <div class="note-date">Last updated: ${new Date(note.updatedAt).toLocaleDateString()}</div>
    </div>
  `).join('') || '<div class="muted">No notes yet. Add your first note above.</div>';

  container.addEventListener('click', async (e) => {
    if (e.target.classList.contains('note-del')) {
      if (!confirm('Delete this note?')) return;
      await api(`/api/products/notes/${e.target.dataset.id}`, { method: 'DELETE' });
      loadProductNotes(product);
    }
  });
}

/* ================================================================
   NAV
   ================================================================ */
function bindGlobalNav() {
  QA('.nav a[data-view]')?.forEach(a => a.addEventListener('click', e=>{
    e.preventDefault();
    const v = a.dataset.view;
    ['home','products','performance','stockMovement','finance','settings'].forEach(id=>{
      const el = Q('#'+id);
      if (el) el.style.display = (id===v)?'':'none';
    });
    QA('.nav a').forEach(x=>x.classList.toggle('active', x===a));
    if (v==='home') { renderCompactKpis(); renderCountryStockSpend(); }
    if (v==='products') { renderCompactCountryStats(); renderAdvertisingOverview(); }
    if (v==='stockMovement') { renderStockMovementPage(); }
    if (v==='performance') { renderRemittanceReport(); }
  }));
}

/* ================================================================
   BOOT
   ================================================================ */
boot();
