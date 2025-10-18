/* ================================================================
   EAS Tracker – Front-end (index.html + product.html)
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
  countries: [], // China will be removed from this list
  products: [],
  productsActive: [],
  categories: { debit:[], credit:[] }
};

/* ================================================================
   AUTH + BOOT
   ================================================================ */
async function boot() {
  try {
    await api('/api/meta');                 // cookie OK? (fast ping)
    Q('#login')?.classList.add('hide');
    Q('#main')?.removeAttribute('style');
  } catch {
    Q('#login')?.classList.remove('hide');
    Q('#main')?.setAttribute('style','display:none');
    return;
  }

  await preload();
  initSimpleNavigation(); // Initialize simple navigation with scroll behavior
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
   SIMPLE NAVIGATION - HIDES ON SCROLL, NEVER REAPPEARS
   ================================================================ */
function initSimpleNavigation() {
  const nav = Q('.nav');
  const main = Q('#main');
  if (!nav) return;

  let lastScrollY = window.scrollY;
  let scrollTimeout = null;

  // Function to hide navigation
  function hideNav() {
    nav.classList.remove('nav-visible');
    nav.classList.add('nav-hidden');
    if (main) main.classList.add('main-expanded');
  }

  // Function to show navigation (only at top)
  function showNav() {
    nav.classList.remove('nav-hidden');
    nav.classList.add('nav-visible');
    if (main) main.classList.remove('main-expanded');
  }

  // Handle scroll events - SIMPLE VERSION: Hide on scroll, never show on scroll up
  function handleScroll() {
    const currentScrollY = window.scrollY;
    
    // Always show nav at the top of the page
    if (currentScrollY < 10) {
      showNav();
      lastScrollY = currentScrollY;
      return;
    }

    // Hide nav when scrolling down OR up (any scrolling away from top)
    if (currentScrollY > 50) {
      hideNav();
    }

    lastScrollY = currentScrollY;

    // Clear existing timeout
    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
    }
  }

  // Add scroll event listener
  window.addEventListener('scroll', handleScroll, { passive: true });

  // Show nav when touching the very top of the screen
  document.addEventListener('touchstart', (e) => {
    if (e.touches[0].clientY < 10) {
      showNav();
    }
  }, { passive: true });

  // Initialize nav state
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
  const meta = await api('/api/meta');                 // {countries}
  // Remove China from countries list for display purposes
  state.countries = (meta.countries || []).filter(country => country !== 'china');

  const pr = await api('/api/products');               // {products}
  state.products = pr.products || [];
  state.productsActive = state.products.filter(p => p.status !== 'paused');

  const cats = await api('/api/finance/categories');   // {debit:[],credit:[]}
  state.categories = cats || { debit:[], credit:[] };

  fillCommonSelects();
}

function fillCommonSelects() {
  // Countries for all selects (without China)
  const countrySelects = ['#mvFrom', '#mvTo', '#adCountry', '#rCountry', 
    '#pdAdCountry', '#pdRCountry', '#pdMvFrom', '#pdMvTo', '#pdInfCountry', 
    '#pdInfFilterCountry', '#pdPBCountry', '#pcCountry', '#remCountry', '#remAddCountry',
    '#topDelCountry', '#remAnalyticsCountry', '#testCountry', '#pdNoteCountry'];
  
  countrySelects.forEach(sel => QA(sel).forEach(el => {
    if (sel === '#pcCountry' || sel === '#remCountry' || sel === '#topDelCountry' || sel === '#remAnalyticsCountry') {
      el.innerHTML = `<option value="">All countries</option>` +
        state.countries.map(c=>`<option value="${c}">${c}</option>`).join('');
    } else if (sel === '#mvFrom' || sel === '#pdMvFrom') {
      // For movement "from" fields, include china for stock movement
      el.innerHTML = `<option value="china">china</option>` +
        state.countries.map(c=>`<option value="${c}">${c}</option>`).join('');
    } else {
      el.innerHTML = state.countries.map(c=>`<option value="${c}">${c}</option>`).join('');
    }
  }));

  // Products (only available/active in add forms)
  const productInputs = ['#mvProduct','#adProduct','#rProduct','#remAddProduct','#pdProductForSpend', '#piProduct', '#lpcProduct', '#ordProduct'];
  productInputs.forEach(sel => QA(sel).forEach(el => {
    el.innerHTML = state.productsActive.map(p=>`<option value="${p.id}">${p.name}${p.sku?` (${p.sku})`:''}</option>`).join('');
  }));

  // Products (filters can include "All")
  const productFilters = ['#remProduct', '#remAnalyticsProduct', '#lpProduct'];
  productFilters.forEach(sel => QA(sel).forEach(el => {
    el.innerHTML = `<option value="">All products</option>` +
      state.products.map(p=>`<option value="${p.id}">${p.name}${p.sku?` (${p.sku})`:''}</option>`).join('');
  }));

  // Finance categories select for entries
  const allCats = [...state.categories.debit, ...state.categories.credit].sort();
  QA('#feCat').forEach(el => {
    el.innerHTML = `<option value="" disabled selected>Select category</option>` +
      allCats.map(c=>`<option>${c}</option>`).join('');
  });
  
  // Finance category search
  QA('#fcSearchCat').forEach(el => {
    el.innerHTML = `<option value="">All categories</option>` +
      allCats.map(c=>`<option>${c}</option>`).join('');
  });

  // Fill selling prices inputs
  fillSellingPricesInputs();
}

function fillSellingPricesInputs() {
  const containers = ['#sellingPricesInputs', '#epSellingPricesInputs'];
  containers.forEach(container => {
    const el = Q(container);
    if (el) {
      el.innerHTML = state.countries.map(country => `
        <div class="price-input-group">
          <label>${country}:</label>
          <input type="number" class="input selling-price-input" data-country="${country}" placeholder="0.00" step="0.01" style="width: 100px;"/>
        </div>
      `).join('');
    }
  });
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
  initProductTests();
  initTodos();
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

/* ---------- Stock & Ad Spend by Country (global) ---------- */
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

  // Arrived shipments add to dest, deduct from origin
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

  // Remittances pieces deduct from that country
  try {
    const r = await api('/api/remittances');
    (r.remittances||[]).forEach(x=>{
      if (state.countries.includes(x.country)) {
        per[x.country] = per[x.country]||{stock:0, facebook:0, tiktok:0, google:0, totalAd:0};
        per[x.country].stock -= (+x.pieces||0);
      }
    });
  } catch {}

  // Ad spend from /api/adspend (already "replace current")
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

/* ---------- Daily Ad Spend (no date, replace current) ---------- */
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
      await api('/api/adspend',{method:'POST', body: JSON.stringify(payload)});  // upsert
      await renderCountryStockSpend();
      await renderCompactKpis();
      alert('Ad spend saved');
    } catch(e){ alert(e.message); }
  };
}

/* ---------- Weekly Delivered grid (restore) ---------- */
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

    // preload
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
    // rows
    QA('tr[data-row]').forEach(tr=>{
      const t = QA('.wd-cell', tr).reduce((s,el)=>s+(+el.value||0),0);
      Q('.row-total', tr).textContent = fmt(t);
    });
    // columns + grand
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
    // mirror to KPI
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
  const addBtn = Q('#bsAdd');
  const listEl = Q('#brainstormingList');
  
  async function loadBrainstorming() {
    try {
      const res = await api('/api/brainstorming');
      renderBrainstormingList(res.ideas || []);
    } catch (e) {
      console.error('Failed to load brainstorming:', e);
    }
  }
  
  function renderBrainstormingList(ideas) {
    listEl.innerHTML = ideas.map(idea => `
      <div class="idea-card priority-${idea.priority}">
        <div class="idea-title">${idea.title}</div>
        <div class="idea-description">${idea.description}</div>
        <div class="idea-meta">
          <span class="badge ${getPriorityBadgeClass(idea.priority)}">${idea.priority}</span>
          <span class="badge ${getCategoryBadgeClass(idea.category)}">${idea.category}</span>
          <span>${new Date(idea.createdAt).toLocaleDateString()}</span>
        </div>
        <div class="idea-actions">
          <button class="btn outline small" onclick="editIdea('${idea.id}')">Edit</button>
          <button class="btn danger outline small" onclick="deleteIdea('${idea.id}')">Delete</button>
        </div>
      </div>
    `).join('') || '<div class="muted">No ideas yet. Start brainstorming!</div>';
  }
  
  function getPriorityBadgeClass(priority) {
    const classes = {
      high: 'danger',
      medium: 'warning',
      low: 'success'
    };
    return classes[priority] || 'info';
  }
  
  function getCategoryBadgeClass(category) {
    const classes = {
      product: 'success',
      marketing: 'info',
      operations: 'warning',
      general: 'muted'
    };
    return classes[category] || 'muted';
  }
  
  addBtn?.addEventListener('click', async () => {
    const title = Q('#bsTitle')?.value.trim();
    const description = Q('#bsDescription')?.value.trim();
    const category = Q('#bsCategory')?.value;
    const priority = Q('#bsPriority')?.value;
    
    if (!title) return alert('Title is required');
    
    try {
      await api('/api/brainstorming', {
        method: 'POST',
        body: JSON.stringify({ title, description, category, priority })
      });
      
      // Clear form
      Q('#bsTitle').value = '';
      Q('#bsDescription').value = '';
      Q('#bsCategory').value = 'product';
      Q('#bsPriority').value = 'medium';
      
      await loadBrainstorming();
    } catch (e) {
      alert('Failed to add idea: ' + e.message);
    }
  });
  
  // Load initial data
  loadBrainstorming();
}

// Global functions for brainstorming
window.editIdea = async function(id) {
  const newTitle = prompt('Enter new title:');
  if (!newTitle) return;
  
  try {
    await api(`/api/brainstorming/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ title: newTitle })
    });
    initBrainstorming(); // Reload
  } catch (e) {
    alert('Failed to update idea: ' + e.message);
  }
};

window.deleteIdea = async function(id) {
  if (!confirm('Delete this idea?')) return;
  
  try {
    await api(`/api/brainstorming/${id}`, { method: 'DELETE' });
    initBrainstorming(); // Reload
  } catch (e) {
    alert('Failed to delete idea: ' + e.message);
  }
};

/* ---------- Product Tests ---------- */
function initProductTests() {
  const saveBtn = Q('#testSave');
  const listEl = Q('#productTestsList');
  
  async function loadProductTests() {
    try {
      const res = await api('/api/product-tests');
      renderProductTestsList(res.tests || []);
    } catch (e) {
      console.error('Failed to load product tests:', e);
    }
  }
  
  function renderProductTestsList(tests) {
    listEl.innerHTML = tests.map(test => `
      <div class="test-card">
        <div class="test-product">${test.productName}</div>
        <div class="test-country">${test.country}</div>
        <div class="test-stats">
          <div class="test-stat">
            <span class="test-stat-label">Cost/Lead</span>
            <span class="test-stat-value">$${fmt(test.costPerLead)}</span>
          </div>
          <div class="test-stat">
            <span class="test-stat-label">Confirmation</span>
            <span class="test-stat-value">${fmt(test.confirmationRate)}%</span>
          </div>
          <div class="test-stat">
            <span class="test-stat-label">Selling Price</span>
            <span class="test-stat-value">$${fmt(test.sellingPrice)}</span>
          </div>
          <div class="test-stat">
            <span class="test-stat-label">Max CPL</span>
            <span class="test-stat-value">$${fmt(test.sellingPrice * test.confirmationRate / 100)}</span>
          </div>
        </div>
      </div>
    `).join('') || '<div class="muted">No test data yet. Add your product test results!</div>';
  }
  
  saveBtn?.addEventListener('click', async () => {
    const productName = Q('#testProductName')?.value.trim();
    const country = Q('#testCountry')?.value;
    const costPerLead = +Q('#testCostPerLead')?.value || 0;
    const confirmationRate = +Q('#testConfirmationRate')?.value || 0;
    const sellingPrice = +Q('#testSellingPrice')?.value || 0;
    
    if (!productName || !country) return alert('Product name and country are required');
    
    try {
      await api('/api/product-tests', {
        method: 'POST',
        body: JSON.stringify({ productName, country, costPerLead, confirmationRate, sellingPrice })
      });
      
      // Clear form
      Q('#testProductName').value = '';
      Q('#testCountry').value = '';
      Q('#testCostPerLead').value = '';
      Q('#testConfirmationRate').value = '';
      Q('#testSellingPrice').value = '';
      
      await loadProductTests();
    } catch (e) {
      alert('Failed to save test data: ' + e.message);
    }
  });
  
  // Load initial data
  loadProductTests();
}

/* ---------- To-do + Weekly To-do ---------- */
function initTodos() {
  const KEY='eas_todos', WKEY='eas_weekly';
  const load = k => safeJSON(localStorage.getItem(k))|| (k===WKEY?{}:[]);
  const save = (k,v)=>localStorage.setItem(k,JSON.stringify(v));

  // quick to-dos
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

  // weekly to-dos
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

/* ================================================================
   PRODUCTS PAGE (list)
   ================================================================ */
function renderProductsPage() {
  // Render product info section
  bindProductInfo();
  
  // Render country product stats first
  renderCompactCountryStats();

  // Add Advertising Overview section
  renderAdvertisingOverview();

  // add product
  Q('#pAdd')?.addEventListener('click', async ()=>{
    const sellingPrices = {};
    QA('.selling-price-input').forEach(input => {
      if (input.value) {
        sellingPrices[input.dataset.country] = +input.value;
      }
    });
    
    const p = {
      name: Q('#pName')?.value.trim(),
      sku:  Q('#pSku')?.value.trim(),
      selling_prices: sellingPrices,
      margin_budget: +Q('#pMB')?.value||0
    };
    if (!p.name) return alert('Name required');
    await api('/api/products',{method:'POST', body: JSON.stringify(p)});
    await preload();
    renderProductsTable();
    renderCompactCountryStats();
    renderAdvertisingOverview();
    fillSellingPricesInputs(); // Reset the form
    alert('Product added');
  });
  renderProductsTable();
}

/* ---------- Product Info Section ---------- */
function bindProductInfo() {
  const loadBtn = Q('#piLoad');
  
  loadBtn?.addEventListener('click', async () => {
    const productId = Q('#piProduct')?.value;
    if (!productId) return alert('Please select a product');
    
    const product = state.products.find(p => p.id === productId);
    if (!product) return;
    
    // Calculate product costs from shipments
    const shipments = await api('/api/shipments');
    const arrivedShipments = shipments.shipments.filter(s => s.arrivedAt && s.productId === productId);
    
    // Calculate costs per country
    const countryCosts = {};
    state.countries.forEach(country => {
      const countryShipments = arrivedShipments.filter(s => s.toCountry === country);
      let totalCost = 0;
      let totalQuantity = 0;
      
      countryShipments.forEach(shipment => {
        const quantity = +shipment.qty || 0;
        const purchaseCost = shipment.fromCountry === 'china' ? (+shipment.purchaseCost || 0) : 0;
        const shippingCost = +shipment.shipCost || 0;
        
        totalCost += purchaseCost + shippingCost;
        totalQuantity += quantity;
      });
      
      countryCosts[country] = {
        costPerPiece: totalQuantity > 0 ? totalCost / totalQuantity : 0,
        totalQuantity: totalQuantity
      };
    });
    
    // Calculate max cost per lead
    const results = state.countries.map(country => {
      const sellingPrice = product.selling_prices[country] || 0;
      const costPerPiece = countryCosts[country].costPerPiece || 0;
      const profitMargin = sellingPrice - costPerPiece;
      
      // Get delivery rate from orders and remittances
      const deliveryRate = calculateDeliveryRate(productId, country);
      const maxCostPerLead = deliveryRate > 0 ? profitMargin * deliveryRate / 100 : 0;
      
      return {
        country,
        sellingPrice,
        costPerPiece,
        profitMargin,
        deliveryRate,
        maxCostPerLead
      };
    });
    
    // Render results
    const resultsEl = Q('#productInfoResults');
    resultsEl.innerHTML = `
      <div class="card">
        <h4>Profit + Advertising Budget by Country</h4>
        <div class="table-scroll">
          <table class="table">
            <thead>
              <tr>
                <th>Country</th>
                <th>Selling Price</th>
                <th>Product Cost</th>
                <th>Profit + Ad Budget</th>
                <th>Delivery Rate</th>
                <th>Max Cost Per Lead</th>
              </tr>
            </thead>
            <tbody>
              ${results.map(r => `
                <tr>
                  <td>${r.country}</td>
                  <td>$${fmt(r.sellingPrice)}</td>
                  <td>$${fmt(r.costPerPiece)}</td>
                  <td class="${r.profitMargin >= 0 ? 'number-positive' : 'number-negative'}">$${fmt(r.profitMargin)}</td>
                  <td>${fmt(r.deliveryRate)}%</td>
                  <td class="number-positive">$${fmt(r.maxCostPerLead)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  });
}

function calculateDeliveryRate(productId, country) {
  // This would need to be implemented based on orders and remittances data
  // For now, return a placeholder value
  return 30; // 30% delivery rate as example
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

  // Get ad spend data
  api('/api/adspend').then(adData => {
    const adSpends = adData.adSpends || [];
    
    // Group by country and product
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
    
    // Create HTML
    let html = '';
    
    Object.keys(byCountry).sort().forEach(country => {
      const products = byCountry[country];
      
      // Sort products by total spend (descending)
      const sortedProducts = Object.entries(products)
        .filter(([_, data]) => data.total > 0) // Only show products with spend
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
  
  // Calculate profit status for each product
  const productsWithStatus = state.products.map(product => {
    const status = calculateProductProfitStatus(product);
    return { ...product, profitStatus: status };
  });
  
  tb.innerHTML = productsWithStatus.map(p => {
    const statusClass = p.profitStatus === 'profit' ? 'product-profit' : 
                       p.profitStatus === 'loss' ? 'product-loss' : 'product-neutral';
    
    return `
    <tr class="${statusClass}">
      <td>${p.name}</td>
      <td>${p.sku||'-'}</td>
      <td><span class="badge ${p.status==='paused'?'muted':''}">${p.status||'active'}</span></td>
      <td><span class="badge ${p.profitStatus === 'profit' ? 'success' : p.profitStatus === 'loss' ? 'danger' : 'warning'}">${p.profitStatus}</span></td>
      <td>
        <a class="btn" href="/product.html?id=${p.id}">Open</a>
        <button class="btn outline act-toggle" data-id="${p.id}">${p.status==='active'?'Pause':'Run'}</button>
        <button class="btn outline act-del" data-id="${p.id}">Delete</button>
      </td>
    </tr>
  `}).join('') || `<tr><td colspan="5" class="muted">No products</td></tr>`;

  tb.onclick = async (e)=>{
    const id = e.target.dataset?.id; if (!id) return;
    if (e.target.classList.contains('act-toggle')) {
      const p = state.products.find(x=>x.id===id); const ns = p.status==='active'?'paused':'active';
      await api(`/api/products/${id}/status`,{method:'POST', body: JSON.stringify({status:ns})});
      await preload(); renderProductsTable(); renderCompactCountryStats(); renderAdvertisingOverview();
    }
    if (e.target.classList.contains('act-del')) {
      if (!confirm('Delete product and ALL its data?')) return;
      await api(`/api/products/${id}`,{method:'DELETE'}); // server will cascade
      await preload(); renderProductsTable(); renderCompactCountryStats(); renderAdvertisingOverview(); renderCountryStockSpend(); renderCompactKpis();
    }
  };
}

function calculateProductProfitStatus(product) {
  // This is a simplified calculation - you might want to make this more sophisticated
  // based on actual revenue, costs, and shipments data
  
  // For now, we'll use a simple heuristic based on selling prices vs estimated costs
  let hasData = false;
  let totalProfit = 0;
  let countryCount = 0;
  
  state.countries.forEach(country => {
    const sellingPrice = product.selling_prices[country] || 0;
    if (sellingPrice > 0) {
      hasData = true;
      // Estimate cost as 40% of selling price for this example
      const estimatedCost = sellingPrice * 0.4;
      totalProfit += (sellingPrice - estimatedCost);
      countryCount++;
    }
  });
  
  if (!hasData) return 'no-data';
  
  const avgProfit = totalProfit / countryCount;
  return avgProfit > 0 ? 'profit' : 'loss';
}

/* ================================================================
   PERFORMANCE PAGE - UPDATED WITH NEW SECTIONS
   ================================================================ */
function renderPerformancePage() {
  // Lifetime Product Costs
  bindLifetimeProductCosts();
  
  // Orders Tracking
  bindOrdersTracking();
  
  // Add Remittance Entry
  bindRemittanceAdd();
  
  // Remittance Report
  renderRemittanceReport();

  // Top Delivered Products
  bindTopDeliveredProducts();

  // Remittance Analytics
  bindRemittanceAnalytics();

  // Profit by Country
  bindProfitByCountry();
}

/* ---------- Lifetime Product Costs ---------- */
function bindLifetimeProductCosts() {
  const btn = Q('#lpcRun');
  if (!btn) return;
  
  btn.onclick = async () => {
    const productId = Q('#lpcProduct')?.value || '';
    const start = Q('#lpcStart')?.value;
    const end = Q('#lpcEnd')?.value;
    
    try {
      // Get all relevant data
      const [remittances, shipments, influencerSpends, orders] = await Promise.all([
        api('/api/remittances'),
        api('/api/shipments'),
        api('/api/influencers/spend'),
        api('/api/orders')
      ]);
      
      // Filter data by date and product
      let filteredRemittances = remittances.remittances || [];
      let filteredShipments = shipments.shipments || [];
      let filteredInfluencerSpends = influencerSpends.spends || [];
      let filteredOrders = orders.orders || [];
      
      if (productId) {
        filteredRemittances = filteredRemittances.filter(r => r.productId === productId);
        filteredShipments = filteredShipments.filter(s => s.productId === productId);
        filteredInfluencerSpends = filteredInfluencerSpends.filter(s => s.productId === productId);
        filteredOrders = filteredOrders.filter(o => o.productId === productId);
      }
      
      if (start) {
        filteredRemittances = filteredRemittances.filter(r => r.start >= start);
        filteredShipments = filteredShipments.filter(s => s.departedAt >= start);
        filteredInfluencerSpends = filteredInfluencerSpends.filter(s => s.date >= start);
        filteredOrders = filteredOrders.filter(o => o.startDate >= start);
      }
      
      if (end) {
        filteredRemittances = filteredRemittances.filter(r => r.end <= end);
        filteredShipments = filteredShipments.filter(s => s.departedAt <= end);
        filteredInfluencerSpends = filteredInfluencerSpends.filter(s => s.date <= end);
        filteredOrders = filteredOrders.filter(o => o.endDate <= end);
      }
      
      // Calculate totals
      const totalRevenue = filteredRemittances.reduce((sum, r) => sum + (+r.revenue || 0), 0);
      const totalAdSpend = filteredRemittances.reduce((sum, r) => sum + (+r.adSpend || 0), 0);
      const totalBoxleoFees = filteredRemittances.reduce((sum, r) => sum + (+r.boxleoFees || 0), 0);
      const totalPieces = filteredRemittances.reduce((sum, r) => sum + (+r.pieces || 0), 0);
      
      // Calculate product costs from shipments
      const productCosts = filteredShipments
        .filter(s => s.fromCountry === 'china' && s.arrivedAt)
        .reduce((sum, s) => sum + (+s.purchaseCost || 0), 0);
      
      // Calculate shipping costs
      const shippingCosts = filteredShipments
        .filter(s => s.arrivedAt)
        .reduce((sum, s) => sum + (+s.shipCost || 0), 0);
      
      // Calculate influencer costs
      const influencerCosts = filteredInfluencerSpends.reduce((sum, s) => sum + (+s.amount || 0), 0);
      
      // Calculate total orders
      const totalOrders = filteredOrders.reduce((sum, o) => sum + (+o.ordersCount || 0), 0);
      
      // Calculate delivery rate
      const deliveredPieces = totalPieces;
      const deliveryRate = totalOrders > 0 ? (deliveredPieces / totalOrders) * 100 : 0;
      
      // Calculate profit
      const totalCosts = productCosts + shippingCosts + influencerCosts + totalAdSpend + totalBoxleoFees;
      const profit = totalRevenue - totalCosts;
      
      // Render results
      const resultsEl = Q('#lifetimeCostsResults');
      resultsEl.innerHTML = `
        <div class="card">
          <h4>Expenses & Revenue Analysis (${start || 'Start'} - ${end || 'End'})</h4>
          <div class="table-scroll">
            <table class="table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>Total Revenue</td><td class="number-positive">$${fmt(totalRevenue)}</td></tr>
                <tr><td>Product Costs (China)</td><td class="number-negative">$${fmt(productCosts)}</td></tr>
                <tr><td>Shipping Costs</td><td class="number-negative">$${fmt(shippingCosts)}</td></tr>
                <tr><td>Influencer Costs</td><td class="number-negative">$${fmt(influencerCosts)}</td></tr>
                <tr><td>Ad Spend</td><td class="number-negative">$${fmt(totalAdSpend)}</td></tr>
                <tr><td>Boxleo Fees</td><td class="number-negative">$${fmt(totalBoxleoFees)}</td></tr>
                <tr><td>Total Costs</td><td class="number-negative">$${fmt(totalCosts)}</td></tr>
                <tr><td>Total Pieces Delivered</td><td>${fmt(totalPieces)}</td></tr>
                <tr><td>Total Orders</td><td>${fmt(totalOrders)}</td></tr>
                <tr><td>Delivery Rate</td><td>${fmt(deliveryRate)}%</td></tr>
              </tbody>
            </table>
          </div>
          <div class="profit-summary ${profit >= 0 ? 'profit' : 'loss'}">
            <div class="total-profit ${profit >= 0 ? 'number-positive' : 'number-negative'}">$${fmt(profit)}</div>
            <div class="summary-label">${profit >= 0 ? 'Total Profit' : 'Total Loss'}</div>
          </div>
        </div>
      `;
      
    } catch (e) {
      console.error('Failed to load lifetime costs:', e);
      alert('Failed to generate cost analysis: ' + e.message);
    }
  };
}

/* ---------- Orders Tracking ---------- */
function bindOrdersTracking() {
  const btn = Q('#ordSave');
  if (!btn) return;
  
  btn.onclick = async () => {
    const productId = Q('#ordProduct')?.value;
    const startDate = Q('#ordStart')?.value;
    const endDate = Q('#ordEnd')?.value;
    const ordersCount = +Q('#ordCount')?.value || 0;
    
    if (!productId || !startDate || !endDate) {
      return alert('Please fill all required fields: Product, Start Date, and End Date');
    }
    
    try {
      await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({ productId, startDate, endDate, ordersCount })
      });
      
      // Clear form
      Q('#ordProduct').value = '';
      Q('#ordStart').value = '';
      Q('#ordEnd').value = '';
      Q('#ordCount').value = '';
      
      alert('Orders data saved successfully!');
    } catch (e) {
      alert('Failed to save orders: ' + e.message);
    }
  };
}

/* ---------- Profit by Country ---------- */
function bindProfitByCountry() {
  const btn = Q('#pcRun');
  if (!btn) return;
  
  btn.onclick = async () => {
    const s = Q('#pcStart')?.value, e = Q('#pcEnd')?.value, c = Q('#pcCountry')?.value || '';
    let list = (await api('/api/remittances')).remittances || [];
    if (s) list = list.filter(r=>r.start >= s);
    if (e) list = list.filter(r=>r.end <= e);
    if (c) list = list.filter(r=>r.country === c);

    const byC = {};
    list.forEach(r=>{
      if (!byC[r.country]) byC[r.country] = {
        rev:0, ad:0, productCost:0, shippingCost:0, boxleo:0, pcs:0, orders:0
      };
      
      const product = state.products.find(p => p.id === r.productId) || {};
      const pieces = +r.pieces || 0;
      
      // Calculate product cost from shipments
      const productCost = calculateProductCost(r.productId, r.country, pieces);
      // Calculate shipping cost
      const shippingCost = calculateShippingCost(r.productId, r.country, pieces);
      
      byC[r.country].rev += (+r.revenue || 0);
      byC[r.country].ad  += (+r.adSpend || 0);
      byC[r.country].boxleo += (+r.boxleoFees || 0);
      byC[r.country].productCost += productCost;
      byC[r.country].shippingCost += shippingCost;
      byC[r.country].pcs += pieces;
      byC[r.country].orders += (+r.orders || 0);
    });

    const tb = Q('#profitCountryBody'); 
    let R=0, A=0, PC=0, SC=0, B=0, P=0, PCS=0, ORD=0;
    const rows = Object.entries(byC).map(([cc,v])=>{
      const totalCost = v.productCost + v.shippingCost + v.ad + v.boxleo;
      const profit = v.rev - totalCost;
      const deliveryRate = v.orders > 0 ? (v.pcs / v.orders) * 100 : 0;
      
      R+=v.rev; A+=v.ad; PC+=v.productCost; SC+=v.shippingCost; B+=v.boxleo; P+=profit; PCS+=v.pcs; ORD+=v.orders;
      
      return `<tr>
        <td>${cc}</td>
        <td>${fmt(v.rev)}</td>
        <td>${fmt(v.ad)}</td>
        <td>${fmt(v.productCost)}</td>
        <td>${fmt(v.shippingCost)}</td>
        <td>${fmt(v.boxleo)}</td>
        <td>${fmt(totalCost)}</td>
        <td>${fmt(v.pcs)}</td>
        <td>${fmt(deliveryRate)}%</td>
        <td class="${profit >= 0 ? 'number-positive' : 'number-negative'}">${fmt(profit)}</td>
      </tr>`;
    }).join('');
    
    tb.innerHTML = rows || `<tr><td colspan="10" class="muted">No data</td></tr>`;
    Q('#pcRevT').textContent = fmt(R);
    Q('#pcAdT').textContent = fmt(A);
    Q('#pcProductCostT').textContent = fmt(PC);
    Q('#pcShippingCostT').textContent = fmt(SC);
    Q('#pcBoxleoT').textContent = fmt(B);
    Q('#pcTotalCostT').textContent = fmt(PC + SC + A + B);
    Q('#pcPiecesT').textContent = fmt(PCS);
    Q('#pcDeliveryRateT').textContent = fmt(ORD > 0 ? (PCS / ORD) * 100 : 0) + '%';
    Q('#pcProfitT').textContent = fmt(P);
  };
}

function calculateProductCost(productId, country, pieces) {
  // This should calculate the actual product cost based on shipments from China
  // For now, return a simplified calculation
  const product = state.products.find(p => p.id === productId);
  if (!product) return 0;
  
  // This is a placeholder - you would need to implement actual cost calculation
  // based on purchase costs from shipments
  return pieces * 10; // Example: $10 per piece
}

function calculateShippingCost(productId, country, pieces) {
  // This should calculate the actual shipping cost based on shipments
  // For now, return a simplified calculation
  return pieces * 2; // Example: $2 shipping per piece
}

// ... (rest of the performance page functions remain similar but updated with new fields)

/* ================================================================
   STOCK MOVEMENT PAGE - Updated with purchase cost
   ================================================================ */
function renderStockMovementPage() {
  // Stock Movement (create shipment) - China is available here
  const btn = Q('#mvAdd'); if (!btn) return;
  
  // Show/hide purchase cost field based on from country
  Q('#mvFrom')?.addEventListener('change', function() {
    const purchaseContainer = Q('#purchaseCostContainer');
    if (this.value === 'china') {
      purchaseContainer.style.display = 'block';
    } else {
      purchaseContainer.style.display = 'none';
    }
  });
  
  btn.onclick = async ()=>{
    const fromCountry = Q('#mvFrom')?.value;
    const payload = {
      productId: Q('#mvProduct')?.value,
      fromCountry: fromCountry,
      toCountry: Q('#mvTo')?.value,
      qty: +Q('#mvQty')?.value || 0,
      shipCost: +Q('#mvShip')?.value || 0,
      purchaseCost: fromCountry === 'china' ? +Q('#mvPurchase')?.value || 0 : 0,
      note: Q('#mvNote')?.value || '',
      departedAt: isoToday(),
      arrivedAt: null
    };
    if (!payload.productId || !payload.fromCountry || !payload.toCountry) return alert('Missing fields');
    try{
      await api('/api/shipments',{method:'POST', body: JSON.stringify(payload)});
      await renderTransitTables();
      alert('Shipment created');
    } catch(e){ alert(e.message); }
  };

  // Transit tables (CK + IC)
  renderTransitTables();
}

// ... (rest of the stock movement functions remain similar but updated with purchase cost)

/* ================================================================
   PRODUCT PAGE (product.html?id=...)
   ================================================================ */
async function renderProductPage() {
  await preload();
  const product = state.products.find(p=>p.id===state.productId);
  if (!product) { alert('Product not found'); location.href='/'; return; }
  Q('#pdTitle').textContent = product.name;
  Q('#pdSku').textContent = product.sku ? `SKU: ${product.sku}` : '';

  // Product Notes
  await renderProductNotes(product);
  
  // Stock & Ad Spend by Country (this product only)
  await renderProductStockAd(product);
  
  // Profit + Budget per country (auto-calculated)
  renderProductBudgetsAuto(product);
  
  // Transit tables
  await renderProductTransit(product);
  
  // Arrived shipments section
  await renderProductArrivedShipments(product);
  
  // Lifetime (this product) with filter
  bindProductLifetime(product);
  
  // Remittances for this product
  await renderProductRemittances(product);
  
  // Influencers
  await bindInfluencers(product);
}

/* ---------- Product Notes ---------- */
async function renderProductNotes(product) {
  const saveBtn = Q('#pdNoteSave');
  const listEl = Q('#pdNotesList');
  
  async function loadNotes() {
    try {
      const res = await api(`/api/product-notes/${product.id}`);
      renderNotesList(res.notes || []);
    } catch (e) {
      console.error('Failed to load product notes:', e);
    }
  }
  
  function renderNotesList(notes) {
    listEl.innerHTML = notes.map(note => `
      <div class="note-card">
        <div class="note-country">${note.country}</div>
        <div class="note-text">${note.note}</div>
        <div class="note-date">${new Date(note.updatedAt).toLocaleDateString()}</div>
      </div>
    `).join('') || '<div class="muted">No notes yet. Add testing results for each country.</div>';
  }
  
  saveBtn?.addEventListener('click', async () => {
    const country = Q('#pdNoteCountry')?.value;
    const note = Q('#pdNoteText')?.value.trim();
    
    if (!country) return alert('Please select a country');
    
    try {
      await api('/api/product-notes', {
        method: 'POST',
        body: JSON.stringify({ productId: product.id, country, note })
      });
      
      // Clear form
      Q('#pdNoteText').value = '';
      
      await loadNotes();
    } catch (e) {
      alert('Failed to save note: ' + e.message);
    }
  });
  
  // Load initial notes
  await loadNotes();
}

/* ---------- Auto-calculated Profit + Advertising Budget ---------- */
function renderProductBudgetsAuto(product) {
  const tb = Q('#pdPBBBody');
  if (!tb) return;

  // Calculate costs from shipments
  const shipments = []; // This would come from actual data
  const arrivedShipments = shipments.filter(s => s.arrivedAt && s.productId === product.id);
  
  const countryData = state.countries.map(country => {
    const sellingPrice = product.selling_prices[country] || 0;
    
    // Calculate average cost per piece for this country
    const countryShipments = arrivedShipments.filter(s => s.toCountry === country);
    let totalCost = 0;
    let totalQuantity = 0;
    
    countryShipments.forEach(shipment => {
      const quantity = +shipment.qty || 0;
      const purchaseCost = shipment.fromCountry === 'china' ? (+shipment.purchaseCost || 0) : 0;
      const shippingCost = +shipment.shipCost || 0;
      
      totalCost += purchaseCost + shippingCost;
      totalQuantity += quantity;
    });
    
    const costPerPiece = totalQuantity > 0 ? totalCost / totalQuantity : 0;
    const profitMargin = sellingPrice - costPerPiece;
    
    // Calculate max cost per lead (simplified)
    const deliveryRate = 30; // This should come from actual data
    const maxCostPerLead = profitMargin * deliveryRate / 100;
    
    return {
      country,
      sellingPrice,
      costPerPiece,
      shippingCost: costPerPiece * 0.2, // Estimate shipping as 20% of cost
      totalCost: costPerPiece,
      profitMargin,
      maxCostPerLead
    };
  });
  
  tb.innerHTML = countryData.map(data => `
    <tr>
      <td>${data.country}</td>
      <td>$${fmt(data.sellingPrice)}</td>
      <td>$${fmt(data.costPerPiece)}</td>
      <td>$${fmt(data.shippingCost)}</td>
      <td>$${fmt(data.totalCost)}</td>
      <td class="${data.profitMargin >= 0 ? 'number-positive' : 'number-negative'}">$${fmt(data.profitMargin)}</td>
      <td class="number-positive">$${fmt(data.maxCostPerLead)}</td>
    </tr>
  `).join('') || `<tr><td colspan="7" class="muted">No data available</td></tr>`;
}

// ... (rest of the product page functions remain similar but updated with new calculations)

/* ================================================================
   FINANCE PAGE - No changes needed
   ================================================================ */
function renderFinancePage() {
  refreshFinanceCategories();
  Q('#fcAdd')?.addEventListener('click', async ()=>{
    const type = Q('#fcType')?.value, name = Q('#fcName')?.value.trim();
    if (!name) return;
    await api('/api/finance/categories',{method:'POST', body: JSON.stringify({type,name})});
    Q('#fcName').value=''; await refreshFinanceCategories();
  });

  // delete category chips (delegation)
  Q('#finance')?.addEventListener('click', async (e)=>{
    if (e.target.classList.contains('chip-x')) {
      const type = e.target.dataset.type, name = e.target.dataset.name;
      if (!confirm(`Delete category "${name}"?`)) return;
      await api(`/api/finance/categories?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}`,{method:'DELETE'});
      await refreshFinanceCategories();
    }
  });

  // entries add with single date
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

  // Category search
  Q('#fcSearchRun')?.addEventListener('click', runFinanceCategorySearch);

  Q('#feRun')?.addEventListener('click', runFinancePeriod);
  runFinancePeriod();
}

// ... (finance page helper functions remain the same)

/* ================================================================
   SETTINGS PAGE - Updated with selling prices
   ================================================================ */
function renderSettingsPage() {
  // countries add/delete
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

  // edit product info
  const sel = Q('#epSelect');
  if (sel) {
    sel.innerHTML = `<option value="">Select product…</option>`+
      state.products.map(p=>`<option value="${p.id}">${p.name}${p.sku?` (${p.sku})`:''}</option>`).join('');
    sel.onchange = ()=>{
      const p = state.products.find(x=>x.id===sel.value);
      if (!p) return;
      Q('#epName').value = p.name||''; Q('#epSku').value = p.sku||'';
      Q('#epMB').value = p.margin_budget||0;
      
      // Fill selling prices
      QA('.selling-price-input').forEach(input => {
        const country = input.dataset.country;
        input.value = p.selling_prices[country] || '';
      });
    };
    Q('#epSave')?.addEventListener('click', async ()=>{
      const id = sel.value; if (!id) return alert('Pick a product');
      
      const sellingPrices = {};
      QA('.selling-price-input').forEach(input => {
        if (input.value) {
          sellingPrices[input.dataset.country] = +input.value;
        }
      });
      
      const up = {
        name: Q('#epName').value,
        sku: Q('#epSku').value,
        selling_prices: sellingPrices,
        margin_budget: +Q('#epMB').value||0
      };
      await api(`/api/products/${id}`,{method:'PUT', body: JSON.stringify(up)});
      await preload(); alert('Saved');
    });
  }

  // manual save/restore (never auto-delete on push)
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
   NAV - Fixed navigation with JavaScript enforcement
   ================================================================ */
function bindGlobalNav() {
  // Handle the view switching
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
