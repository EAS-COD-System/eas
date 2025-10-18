/* ================================================================
   EAS Tracker – Front-end (Enhanced Version)
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
  categories: { debit:[], credit:[] },
  productNotes: [],
  testedProducts: [],
  brainstorming: [],
  orders: []
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

  // Load new data
  const notes = await api('/api/product-notes/' + (state.productId || ''));
  state.productNotes = notes.notes || [];

  const tested = await api('/api/tested-products');
  state.testedProducts = tested.testedProducts || [];

  const brainstorming = await api('/api/brainstorming');
  state.brainstorming = brainstorming.ideas || [];

  const orders = await api('/api/orders');
  state.orders = orders.orders || [];

  fillCommonSelects();
}

function fillCommonSelects() {
  const countrySelects = ['#mvFrom', '#mvTo', '#adCountry', '#rCountry', 
    '#pdAdCountry', '#pdRCountry', '#pdMvFrom', '#pdMvTo', '#pdInfCountry', 
    '#pdInfFilterCountry', '#pdPBCountry', '#pcCountry', '#remCountry', '#remAddCountry',
    '#topDelCountry', '#remAnalyticsCountry', '#productInfoCountry', '#testedProductCountry',
    '#noteCountry', '#lifetimeCostProduct'];
  
  countrySelects.forEach(sel => QA(sel).forEach(el => {
    if (sel === '#pcCountry' || sel === '#remCountry' || sel === '#topDelCountry' || 
        sel === '#remAnalyticsCountry' || sel === '#productInfoCountry' || 
        sel === '#testedProductCountry' || sel === '#noteCountry' || sel === '#lifetimeCostProduct') {
      el.innerHTML = `<option value="">All countries</option>` +
        state.countries.map(c=>`<option value="${c}">${c}</option>`).join('');
    } else if (sel === '#mvFrom' || sel === '#pdMvFrom') {
      el.innerHTML = `<option value="china">china</option>` +
        state.countries.map(c=>`<option value="${c}">${c}</option>`).join('');
    } else {
      el.innerHTML = state.countries.map(c=>`<option value="${c}">${c}</option>`).join('');
    }
  }));

  const productInputs = ['#mvProduct','#adProduct','#rProduct','#remAddProduct',
    '#pdProductForSpend','#ordersProduct','#productInfoSelect','#lifetimeCostProduct'];
  productInputs.forEach(sel => QA(sel).forEach(el => {
    el.innerHTML = state.productsActive.map(p=>`<option value="${p.id}">${p.name}${p.sku?` (${p.sku})`:''}</option>`).join('');
  }));

  const productFilters = ['#remProduct', '#remAnalyticsProduct', '#lpProduct'];
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
   DASHBOARD - ENHANCED
   ================================================================ */
function renderDashboardPage() {
  renderCompactKpis();
  renderCountryStockSpend();
  bindDailyAdSpend();
  renderWeeklyDelivered();
  renderBrainstormingSection();
  renderTestedProductsSection();
  initTodos();
}

/* ---------- BRAINSTORMING SECTION ---------- */
function renderBrainstormingSection() {
  const container = Q('#brainstormingSection');
  if (!container) return;

  const ideas = state.brainstorming || [];
  
  let html = `
    <div class="card">
      <div class="h">💡 Brainstorming Ideas</div>
      <div class="row wrap">
        <input id="brainstormTitle" class="input" placeholder="Idea title"/>
        <textarea id="brainstormDesc" class="input" placeholder="Description" style="flex:1; min-height: 60px;"></textarea>
        <select id="brainstormCategory" class="input">
          <option value="product">Product Idea</option>
          <option value="marketing">Marketing</option>
          <option value="operation">Operation</option>
          <option value="strategy">Strategy</option>
          <option value="general">General</option>
        </select>
        <select id="brainstormPriority" class="input">
          <option value="low">Low</option>
          <option value="medium" selected>Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
        <button id="brainstormAdd" class="btn">➕ Add Idea</button>
      </div>
    </div>

    <div class="ideas-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 15px; margin-top: 20px;">
  `;

  ideas.forEach(idea => {
    const priorityColors = {
      low: 'var(--info)',
      medium: 'var(--warning)',
      high: 'var(--accent-orange)',
      critical: 'var(--danger)'
    };

    const statusColors = {
      new: 'var(--info)',
      'in-progress': 'var(--warning)',
      completed: 'var(--success)',
      cancelled: 'var(--danger)'
    };

    html += `
      <div class="card idea-card" data-id="${idea.id}" style="border-left: 4px solid ${priorityColors[idea.priority]};">
        <div class="flex" style="margin-bottom: 10px;">
          <h4 style="margin: 0; flex: 1;">${idea.title}</h4>
          <span class="badge" style="background: ${statusColors[idea.status]}; color: white;">${idea.status}</span>
        </div>
        <div class="muted" style="margin-bottom: 10px; font-size: 0.9rem;">${idea.description}</div>
        <div class="flex" style="font-size: 0.8rem; color: var(--text-muted);">
          <span>${idea.category}</span>
          <span>${idea.priority}</span>
          <span>${new Date(idea.createdAt).toLocaleDateString()}</span>
        </div>
        <div class="row" style="margin-top: 10px; gap: 5px;">
          <select class="input idea-status" style="flex: 1; font-size: 0.8rem;" data-id="${idea.id}">
            <option value="new" ${idea.status === 'new' ? 'selected' : ''}>New</option>
            <option value="in-progress" ${idea.status === 'in-progress' ? 'selected' : ''}>In Progress</option>
            <option value="completed" ${idea.status === 'completed' ? 'selected' : ''}>Completed</option>
            <option value="cancelled" ${idea.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
          </select>
          <button class="btn outline idea-edit" data-id="${idea.id}" style="font-size: 0.8rem;">Edit</button>
          <button class="btn outline danger idea-delete" data-id="${idea.id}" style="font-size: 0.8rem;">Delete</button>
        </div>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;

  // Add event listeners
  Q('#brainstormAdd')?.addEventListener('click', addBrainstormIdea);
  container.addEventListener('change', handleBrainstormStatusChange);
  container.addEventListener('click', handleBrainstormActions);
}

async function addBrainstormIdea() {
  const title = Q('#brainstormTitle')?.value.trim();
  const description = Q('#brainstormDesc')?.value.trim();
  const category = Q('#brainstormCategory')?.value;
  const priority = Q('#brainstormPriority')?.value;

  if (!title) return alert('Please enter an idea title');

  try {
    await api('/api/brainstorming', {
      method: 'POST',
      body: JSON.stringify({ title, description, category, priority })
    });
    
    Q('#brainstormTitle').value = '';
    Q('#brainstormDesc').value = '';
    await preload();
    renderBrainstormingSection();
  } catch (e) {
    alert('Error adding idea: ' + e.message);
  }
}

async function handleBrainstormStatusChange(e) {
  if (e.target.classList.contains('idea-status')) {
    const ideaId = e.target.dataset.id;
    const newStatus = e.target.value;

    try {
      await api(`/api/brainstorming/${ideaId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus })
      });
      await preload();
      renderBrainstormingSection();
    } catch (error) {
      alert('Error updating status: ' + error.message);
    }
  }
}

async function handleBrainstormActions(e) {
  if (e.target.classList.contains('idea-edit')) {
    const ideaId = e.target.dataset.id;
    const idea = state.brainstorming.find(i => i.id === ideaId);
    
    if (idea) {
      const newTitle = prompt('Edit title:', idea.title);
      const newDesc = prompt('Edit description:', idea.description);
      
      if (newTitle !== null) {
        try {
          await api(`/api/brainstorming/${ideaId}`, {
            method: 'PUT',
            body: JSON.stringify({ 
              title: newTitle, 
              description: newDesc || idea.description 
            })
          });
          await preload();
          renderBrainstormingSection();
        } catch (error) {
          alert('Error updating idea: ' + error.message);
        }
      }
    }
  }

  if (e.target.classList.contains('idea-delete')) {
    const ideaId = e.target.dataset.id;
    if (confirm('Delete this idea?')) {
      try {
        await api(`/api/brainstorming/${ideaId}`, { method: 'DELETE' });
        await preload();
        renderBrainstormingSection();
      } catch (error) {
        alert('Error deleting idea: ' + error.message);
      }
    }
  }
}

/* ---------- TESTED PRODUCTS SECTION ---------- */
function renderTestedProductsSection() {
  const container = Q('#testedProductsSection');
  if (!container) return;

  let html = `
    <div class="card">
      <div class="h">🧪 Notes for Tested Products</div>
      <div class="row wrap">
        <input id="testedProductName" class="input" placeholder="Product name"/>
        <select id="testedProductCountry" class="input"></select>
        <input id="testedProductCPL" type="number" class="input" placeholder="Cost per lead (USD)" step="0.01"/>
        <input id="testedProductConfRate" type="number" class="input" placeholder="Confirmation rate %" step="0.1" min="0" max="100"/>
        <input id="testedProductPrice" type="number" class="input" placeholder="Selling price (USD)" step="0.01"/>
        <button id="testedProductAdd" class="btn">💾 Save Test Results</button>
      </div>
    </div>

    <div class="table-scroll" style="margin-top: 20px;">
      <table class="table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Country</th>
            <th>Cost per Lead</th>
            <th>Confirmation Rate</th>
            <th>Selling Price</th>
            <th>Max CPL Allowed</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="testedProductsBody"></tbody>
      </table>
    </div>
  `;

  container.innerHTML = html;

  // Fill tested products table
  renderTestedProductsTable();

  Q('#testedProductAdd')?.addEventListener('click', addTestedProduct);
}

function renderTestedProductsTable() {
  const tbody = Q('#testedProductsBody');
  if (!tbody) return;

  const testedProducts = state.testedProducts || [];
  
  tbody.innerHTML = testedProducts.map(product => {
    const maxCPLAllowed = (product.sellingPrice * (product.confirmationRate / 100)).toFixed(2);
    const status = product.costPerLead <= maxCPLAllowed ? 'Profitable' : 'Not Profitable';
    const statusColor = status === 'Profitable' ? 'success' : 'danger';

    return `
      <tr>
        <td>${product.productName}</td>
        <td>${product.country}</td>
        <td>${fmt(product.costPerLead)} USD</td>
        <td>${fmt(product.confirmationRate)}%</td>
        <td>${fmt(product.sellingPrice)} USD</td>
        <td>${fmt(maxCPLAllowed)} USD</td>
        <td><span class="badge ${statusColor}">${status}</span></td>
        <td>
          <button class="btn outline tested-product-edit" data-id="${product.id}">Edit</button>
          <button class="btn outline danger tested-product-delete" data-id="${product.id}">Delete</button>
        </td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="8" class="muted">No tested products recorded</td></tr>`;

  // Add event listeners for edit/delete
  tbody.addEventListener('click', handleTestedProductActions);
}

async function addTestedProduct() {
  const productName = Q('#testedProductName')?.value.trim();
  const country = Q('#testedProductCountry')?.value;
  const costPerLead = +Q('#testedProductCPL')?.value || 0;
  const confirmationRate = +Q('#testedProductConfRate')?.value || 0;
  const sellingPrice = +Q('#testedProductPrice')?.value || 0;

  if (!productName || !country) {
    return alert('Please enter product name and select country');
  }

  try {
    await api('/api/tested-products', {
      method: 'POST',
      body: JSON.stringify({
        productName,
        country,
        costPerLead,
        confirmationRate,
        sellingPrice
      })
    });

    // Clear form
    Q('#testedProductName').value = '';
    Q('#testedProductCountry').value = '';
    Q('#testedProductCPL').value = '';
    Q('#testedProductConfRate').value = '';
    Q('#testedProductPrice').value = '';

    await preload();
    renderTestedProductsTable();
  } catch (e) {
    alert('Error saving test results: ' + e.message);
  }
}

async function handleTestedProductActions(e) {
  if (e.target.classList.contains('tested-product-edit')) {
    const productId = e.target.dataset.id;
    const product = state.testedProducts.find(p => p.id === productId);
    
    if (product) {
      const newCPL = prompt('Edit cost per lead:', product.costPerLead);
      const newConfRate = prompt('Edit confirmation rate:', product.confirmationRate);
      const newPrice = prompt('Edit selling price:', product.sellingPrice);
      
      if (newCPL !== null && newConfRate !== null && newPrice !== null) {
        try {
          await api('/api/tested-products', {
            method: 'POST',
            body: JSON.stringify({
              productName: product.productName,
              country: product.country,
              costPerLead: +newCPL,
              confirmationRate: +newConfRate,
              sellingPrice: +newPrice
            })
          });
          await preload();
          renderTestedProductsTable();
        } catch (error) {
          alert('Error updating product: ' + error.message);
        }
      }
    }
  }

  // Note: Delete functionality would require adding a DELETE endpoint
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

  // Calculate stock from shipments and remittances
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

  // Ad spend
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
   PRODUCTS PAGE - ENHANCED
   ================================================================ */
function renderProductsPage() {
  renderCompactCountryStats();
  renderAdvertisingOverview();
  renderProductInfoSection();
  
  // Add product with selling prices
  Q('#pAdd')?.addEventListener('click', async ()=>{
    const sellingPrices = {};
    state.countries.forEach(country => {
      const price = +Q(`#pPrice_${country}`)?.value || 0;
      if (price > 0) sellingPrices[country] = price;
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
    renderProductInfoSection();
    alert('Product added');
  });
  renderProductsTable();
}

/* ---------- PRODUCT INFO SECTION ---------- */
function renderProductInfoSection() {
  const container = Q('#productInfoSection');
  if (!container) return;

  let html = `
    <div class="card">
      <div class="h">📊 Product Information & Analytics</div>
      <div class="row wrap">
        <select id="productInfoSelect" class="input">
          <option value="">Select product...</option>
        </select>
        <button id="productInfoRun" class="btn">📈 Analyze Product</button>
      </div>
    </div>

    <div id="productInfoResults" style="margin-top: 20px;"></div>
  `;

  container.innerHTML = html;

  Q('#productInfoRun')?.addEventListener('click', renderProductInfoAnalysis);
}

async function renderProductInfoAnalysis() {
  const productId = Q('#productInfoSelect')?.value;
  if (!productId) return alert('Please select a product');

  const product = state.products.find(p => p.id === productId);
  if (!product) return;

  // Get product performance data
  const remittances = await api('/api/remittances?productId=' + productId);
  const shipments = await api('/api/shipments');
  const orders = await api('/api/orders');
  const notes = await api('/api/product-notes/' + productId);

  // Calculate product costs from shipments
  const productCosts = {};
  const productShipments = (shipments.shipments || []).filter(s => s.productId === productId && s.arrivedAt);
  
  productShipments.forEach(shipment => {
    if (shipment.fromCountry === 'china' && shipment.purchaseCost) {
      const costPerPiece = shipment.purchaseCost / shipment.qty;
      if (!productCosts[shipment.toCountry]) {
        productCosts[shipment.toCountry] = { totalCost: 0, totalPieces: 0 };
      }
      productCosts[shipment.toCountry].totalCost += shipment.purchaseCost;
      productCosts[shipment.toCountry].totalPieces += shipment.qty;
    }
  });

  let html = `
    <div class="card">
      <div class="h">${product.name} - Country Analysis</div>
      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th>Country</th>
              <th>Selling Price</th>
              <th>Avg Product Cost</th>
              <th>Profit + Ad Budget</th>
              <th>Delivery Rate</th>
              <th>Max CPL Allowed</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
  `;

  state.countries.forEach(country => {
    const sellingPrice = product.selling_prices[country] || 0;
    const costData = productCosts[country];
    const avgCost = costData ? costData.totalCost / costData.totalPieces : 0;
    const profitBudget = sellingPrice - avgCost;
    
    // Calculate delivery rate from orders and remittances
    const countryRemittances = (remittances.remittances || []).filter(r => r.country === country);
    const countryOrders = (orders.orders || []).filter(o => o.productId === productId);
    const totalOrders = countryOrders.reduce((sum, o) => sum + o.ordersCount, 0);
    const totalDelivered = countryRemittances.reduce((sum, r) => sum + r.orders, 0);
    const deliveryRate = totalOrders > 0 ? (totalDelivered / totalOrders * 100) : 0;
    
    const maxCPL = profitBudget * (deliveryRate / 100);
    const countryNote = (notes.notes || []).find(n => n.country === country);

    html += `
      <tr>
        <td>${country}</td>
        <td>${fmt(sellingPrice)} USD</td>
        <td>${fmt(avgCost)} USD</td>
        <td class="${profitBudget >= 0 ? 'number-positive' : 'number-negative'}">${fmt(profitBudget)} USD</td>
        <td>${fmt(deliveryRate)}%</td>
        <td class="${maxCPL >= 0 ? 'number-positive' : 'number-negative'}">${fmt(maxCPL)} USD</td>
        <td>${countryNote ? countryNote.note.substring(0, 50) + '...' : 'No notes'}</td>
      </tr>
    `;
  });

  html += `
          </tbody>
        </table>
      </div>
    </div>
  `;

  Q('#productInfoResults').innerHTML = html;
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
  
  // Calculate profitability for each product
  const productsWithProfit = state.products.map(product => {
    let totalRevenue = 0;
    let totalCost = 0;
    
    // Get remittances for this product
    api('/api/remittances?productId=' + product.id).then(remData => {
      const remittances = remData.remittances || [];
      remittances.forEach(rem => {
        totalRevenue += +rem.revenue || 0;
      });
    }).catch(() => {});
    
    // Get costs from shipments
    api('/api/shipments').then(shipData => {
      const shipments = (shipData.shipments || []).filter(s => 
        s.productId === product.id && s.arrivedAt && s.fromCountry === 'china'
      );
      shipments.forEach(ship => {
        totalCost += +ship.purchaseCost || 0;
        totalCost += +ship.shipCost || 0;
      });
    }).catch(() => {});
    
    const profit = totalRevenue - totalCost;
    const status = profit > 0 ? 'profit' : profit < 0 ? 'loss' : 'neutral';
    
    return { ...product, profit, status };
  });

  tb.innerHTML = state.products.map(p=>{
    // Simple profitability check based on selling prices vs estimated costs
    const hasSellingPrices = Object.keys(p.selling_prices || {}).length > 0;
    const statusClass = hasSellingPrices ? 
      (p.margin_budget > 0 ? 'profit-row' : 'neutral-row') : 'neutral-row';
    
    return `
    <tr class="${statusClass}">
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

/* ================================================================
   PERFORMANCE PAGE - ENHANCED
   ================================================================ */
function renderPerformancePage() {
  bindRemittanceAdd();
  renderRemittanceReport();
  bindTopDeliveredProducts();
  bindRemittanceAnalytics();
  renderLifetimeCostsSection();
  bindOrdersSection();

  // Enhanced Profit by Country with Boxleo costs
  Q('#pcRun')?.addEventListener('click', async ()=>{
    const s = Q('#pcStart')?.value, e = Q('#pcEnd')?.value, c = Q('#pcCountry')?.value || '';
    let list = (await api('/api/remittances')).remittances || [];
    if (s) list = list.filter(r=>r.start >= s);
    if (e) list = list.filter(r=>r.end <= e);
    if (c) list = list.filter(r=>r.country === c);

    const byC = {};
    list.forEach(r=>{
      if (!byC[r.country]) byC[r.country] = {
        rev:0, ad:0, costChina:0, shipChina:0, interShip:0, boxleo:0, pcs:0, orders:0
      };
      
      const product = state.products.find(p => p.id === r.productId) || {};
      const pieces = +r.pieces || 0;
      const orders = +r.orders || 0;
      
      // Calculate costs from shipments data
      const productShipments = api('/api/shipments').then(shipData => {
        const shipments = (shipData.shipments || []).filter(s => 
          s.productId === r.productId && s.arrivedAt && s.toCountry === r.country
        );
        let totalCost = 0;
        let totalShipCost = 0;
        shipments.forEach(ship => {
          if (ship.fromCountry === 'china') {
            totalCost += +ship.purchaseCost || 0;
            totalShipCost += +ship.shipCost || 0;
          }
        });
        return { cost: totalCost, ship: totalShipCost };
      }).catch(() => ({ cost: 0, ship: 0 }));

      // For now, using simplified calculation
      const costPerPiece = (+product.cost_china || 10) + (+product.ship_china_to_kenya || 2);
      const costChina = costPerPiece * pieces;
      const shipChina = 0; // Already included in costPerPiece
      const interShip = 0; // Would need additional data
      
      byC[r.country].rev += (+r.revenue || 0);
      byC[r.country].ad  += (+r.adSpend || 0);
      byC[r.country].costChina += costChina;
      byC[r.country].shipChina += shipChina;
      byC[r.country].interShip += interShip;
      byC[r.country].boxleo += (+r.boxleoCost || 0);
      byC[r.country].pcs += pieces;
      byC[r.country].orders += orders;
    });

    const tb = Q('#profitCountryBody'); 
    let R=0, A=0, CC=0, SC=0, IS=0, BC=0, P=0;
    const rows = Object.entries(byC).map(([cc,v])=>{
      const totalCost = v.costChina + v.shipChina + v.interShip + v.boxleo;
      const profit = v.rev - v.ad - totalCost;
      const costPerOrder = v.orders > 0 ? v.ad / v.orders : 0;
      const costPerPieceAd = v.pcs > 0 ? v.ad / v.pcs : 0;
      const costPerPieceBoxleo = v.pcs > 0 ? v.boxleo / v.pcs : 0;
      
      R+=v.rev; A+=v.ad; CC+=v.costChina; SC+=v.shipChina; IS+=v.interShip; BC+=v.boxleo; P+=profit;
      
      return `<tr>
        <td>${cc}</td>
        <td>${fmt(v.rev)}</td>
        <td>${fmt(v.ad)}</td>
        <td>${fmt(v.costChina)}</td>
        <td>${fmt(v.shipChina)}</td>
        <td>${fmt(v.interShip)}</td>
        <td>${fmt(v.boxleo)}</td>
        <td>${fmt(totalCost)}</td>
        <td>${fmt(v.pcs)}</td>
        <td>${fmt(costPerOrder)}</td>
        <td>${fmt(costPerPieceAd)}</td>
        <td>${fmt(costPerPieceBoxleo)}</td>
        <td class="${profit >= 0 ? 'number-positive' : 'number-negative'}">${fmt(profit)}</td>
      </tr>`;
    }).join('');
    
    tb.innerHTML = rows || `<tr><td colspan="13" class="muted">No data</td></tr>`;
    // Update totals...
  });

  // Enhanced Lifetime Product Performance
  Q('#lpRun')?.addEventListener('click', async ()=>{
    const pid = Q('#lpProduct')?.value || '';
    const s   = Q('#lpStart')?.value;
    const e   = Q('#lpEnd')?.value;

    let rem = (await api('/api/remittances')).remittances || [];
    const infSpends = (await api('/api/influencers/spend')).spends || [];
    
    if (pid) {
      rem = rem.filter(r=>r.productId===pid);
      const filteredInfSpends = infSpends.filter(inf => 
        inf.productId === pid && 
        (!s || inf.date >= s) && 
        (!e || inf.date <= e)
      );
      
      filteredInfSpends.forEach(inf => {
        const matchingRem = rem.find(r => r.country === inf.country && r.start >= s && r.end <= e);
        if (matchingRem) {
          matchingRem.adSpend = (+matchingRem.adSpend || 0) + (+inf.amount || 0);
        }
      });
    }
    if (s) rem = rem.filter(r=>r.start >= s);
    if (e) rem = rem.filter(r=>r.end   <= e);

    const prodMap = Object.fromEntries(state.products.map(p=>[p.id,p]));
    const byPKC = {};
    rem.forEach(r=>{
      const k = `${r.productId}|${r.country}`;
      const prod = prodMap[r.productId]||{};
      const pieces = +r.pieces || 0;
      
      // Enhanced cost calculation
      const costPerPiece = (+prod.cost_china || 10) + (+prod.ship_china_to_kenya || 2);
      const costChina = costPerPiece * pieces;
      const shipChina = 0; // Included above
      const interShip = 0;
      const boxleoCost = +r.boxleoCost || 0;
      const totalCost = costChina + shipChina + interShip + boxleoCost;

      if (!byPKC[k]) byPKC[k] = { 
        name: prod.name || r.productId, 
        country: r.country, 
        rev: 0, ad: 0, 
        costChina: 0, shipChina: 0, interShip: 0, boxleo: 0,
        totalCost: 0, pcs: 0, profit: 0 
      };
      
      byPKC[k].rev += (+r.revenue || 0);
      byPKC[k].ad  += (+r.adSpend || 0);
      byPKC[k].costChina += costChina;
      byPKC[k].shipChina += shipChina;
      byPKC[k].interShip += interShip;
      byPKC[k].boxleo += boxleoCost;
      byPKC[k].totalCost += totalCost;
      byPKC[k].pcs += pieces;
    });
    
    Object.values(byPKC).forEach(v => v.profit = v.rev - v.ad - v.totalCost);

    const tb = Q('#lifetimeBody'); 
    let R=0, A=0, CC=0, SC=0, IS=0, BC=0, TC=0, P=0, PCS=0;
    const rows = Object.values(byPKC).map(v=>{
      R+=v.rev; A+=v.ad; CC+=v.costChina; SC+=v.shipChina; IS+=v.interShip; 
      BC+=v.boxleo; TC+=v.totalCost; P+=v.profit; PCS+=v.pcs;
      
      return `<tr>
        <td>${v.name}</td>
        <td>${v.country}</td>
        <td>${fmt(v.rev)}</td>
        <td>${fmt(v.ad)}</td>
        <td>${fmt(v.costChina)}</td>
        <td>${fmt(v.shipChina)}</td>
        <td>${fmt(v.interShip)}</td>
        <td>${fmt(v.boxleo)}</td>
        <td>${fmt(v.totalCost)}</td>
        <td>${fmt(v.pcs)}</td>
        <td class="${v.profit >= 0 ? 'number-positive' : 'number-negative'}">${fmt(v.profit)}</td>
      </tr>`;
    }).join('');
    
    tb.innerHTML = rows || `<tr><td colspan="11" class="muted">No data</td></tr>`;
    // Update totals...
  });
}

/* ---------- LIFETIME COSTS SECTION ---------- */
function renderLifetimeCostsSection() {
  const container = Q('#lifetimeCostsSection');
  if (!container) return;

  let html = `
    <div class="card">
      <div class="h">💰 Lifetime Product Costs & Profit Analysis</div>
      <div class="row wrap">
        <select id="lifetimeCostProduct" class="input">
          <option value="">All products</option>
        </select>
        <input id="lifetimeCostStart" type="date" class="input" placeholder="Start Date"/>
        <input id="lifetimeCostEnd" type="date" class="input" placeholder="End Date"/>
        <button id="lifetimeCostRun" class="btn">📊 Generate Report</button>
      </div>
    </div>

    <div id="lifetimeCostResults"></div>
  `;

  container.innerHTML = html;

  Q('#lifetimeCostRun')?.addEventListener('click', generateLifetimeCostReport);
}

async function generateLifetimeCostReport() {
  const productId = Q('#lifetimeCostProduct')?.value || '';
  const start = Q('#lifetimeCostStart')?.value;
  const end = Q('#lifetimeCostEnd')?.value;

  // Get all relevant data
  const [remittances, shipments, influencers, adspend] = await Promise.all([
    api('/api/remittances' + (productId ? '?productId=' + productId : '')),
    api('/api/shipments'),
    api('/api/influencers/spend'),
    api('/api/adspend')
  ]);

  // Filter by date range
  let filteredRemittances = remittances.remittances || [];
  let filteredShipments = shipments.shipments || [];
  let filteredInfluencers = influencers.spends || [];
  let filteredAdspend = adspend.adSpends || [];

  if (start) {
    filteredRemittances = filteredRemittances.filter(r => r.start >= start);
    filteredShipments = filteredShipments.filter(s => s.departedAt >= start);
    filteredInfluencers = filteredInfluencers.filter(i => i.date >= start);
    filteredAdspend = filteredAdspend.filter(a => true); // Adspend doesn't have date in this structure
  }
  if (end) {
    filteredRemittances = filteredRemittances.filter(r => r.end <= end);
    filteredShipments = filteredShipments.filter(s => s.departedAt <= end);
    filteredInfluencers = filteredInfluencers.filter(i => i.date <= end);
  }

  if (productId) {
    filteredShipments = filteredShipments.filter(s => s.productId === productId);
    filteredInfluencers = filteredInfluencers.filter(i => i.productId === productId);
    filteredAdspend = filteredAdspend.filter(a => a.productId === productId);
  }

  // Calculate totals
  const totalRevenue = filteredRemittances.reduce((sum, r) => sum + (+r.revenue || 0), 0);
  const totalAdSpend = filteredAdspend.reduce((sum, a) => sum + (+a.amount || 0), 0);
  const totalInfluencerSpend = filteredInfluencers.reduce((sum, i) => sum + (+i.amount || 0), 0);
  
  // Calculate product costs from shipments
  const chinaShipments = filteredShipments.filter(s => s.fromCountry === 'china' && s.arrivedAt);
  const totalProductCost = chinaShipments.reduce((sum, s) => sum + (+s.purchaseCost || 0), 0);
  const totalShippingCost = chinaShipments.reduce((sum, s) => sum + (+s.shipCost || 0), 0);
  
  // Calculate inter-country shipping
  const interShipments = filteredShipments.filter(s => s.fromCountry !== 'china' && s.arrivedAt);
  const totalInterShipping = interShipments.reduce((sum, s) => sum + (+s.shipCost || 0), 0);
  
  // Calculate Boxleo costs
  const totalBoxleoCost = filteredRemittances.reduce((sum, r) => sum + (+r.boxleoCost || 0), 0);

  const totalCosts = totalProductCost + totalShippingCost + totalInterShipping + totalBoxleoCost + totalAdSpend + totalInfluencerSpend;
  const totalProfit = totalRevenue - totalCosts;

  // Calculate delivered pieces and orders
  const totalDeliveredPieces = filteredRemittances.reduce((sum, r) => sum + (+r.pieces || 0), 0);
  const totalOrders = filteredRemittances.reduce((sum, r) => sum + (+r.orders || 0), 0);

  const profitClass = totalProfit >= 0 ? 'number-positive' : 'number-negative';
  const summaryClass = totalProfit >= 0 ? 'profit-summary' : 'loss-summary';

  let html = `
    <div class="card ${summaryClass}" style="margin-top: 20px; background: ${totalProfit >= 0 ? 'var(--success-light)' : 'var(--danger-light)'}; border: 2px solid ${totalProfit >= 0 ? 'var(--success)' : 'var(--danger)'};">
      <div class="h" style="color: ${totalProfit >= 0 ? 'var(--success)' : 'var(--danger)'};">Summary: ${totalProfit >= 0 ? '💰 PROFITABLE' : '💸 LOSS'}</div>
      <div class="row wrap" style="font-size: 1.1rem; font-weight: 600;">
        <div>Total Revenue: <span class="number-positive">${fmt(totalRevenue)} USD</span></div>
        <div>Total Costs: <span class="number-negative">${fmt(totalCosts)} USD</span></div>
        <div>Net Profit: <span class="${profitClass}">${fmt(totalProfit)} USD</span></div>
      </div>
    </div>

    <div class="card" style="margin-top: 20px;">
      <div class="h">Detailed Cost Breakdown</div>
      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Amount</th>
              <th>Percentage</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Product Purchase Cost</td><td>${fmt(totalProductCost)} USD</td><td>${fmt(totalProductCost/totalRevenue*100)}%</td></tr>
            <tr><td>China Shipping Cost</td><td>${fmt(totalShippingCost)} USD</td><td>${fmt(totalShippingCost/totalRevenue*100)}%</td></tr>
            <tr><td>Inter-country Shipping</td><td>${fmt(totalInterShipping)} USD</td><td>${fmt(totalInterShipping/totalRevenue*100)}%</td></tr>
            <tr><td>Boxleo Delivery Cost</td><td>${fmt(totalBoxleoCost)} USD</td><td>${fmt(totalBoxleoCost/totalRevenue*100)}%</td></tr>
            <tr><td>Advertising Spend</td><td>${fmt(totalAdSpend)} USD</td><td>${fmt(totalAdSpend/totalRevenue*100)}%</td></tr>
            <tr><td>Influencer Spend</td><td>${fmt(totalInfluencerSpend)} USD</td><td>${fmt(totalInfluencerSpend/totalRevenue*100)}%</td></tr>
            <tr class="totals"><td><strong>Total Costs</strong></td><td><strong>${fmt(totalCosts)} USD</strong></td><td><strong>100%</strong></td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card" style="margin-top: 20px;">
      <div class="h">Performance Metrics</div>
      <div class="row wrap">
        <div class="kpi-compact">
          <div class="label">Delivered Pieces</div>
          <div class="value">${fmt(totalDeliveredPieces)}</div>
        </div>
        <div class="kpi-compact">
          <div class="label">Total Orders</div>
          <div class="value">${fmt(totalOrders)}</div>
        </div>
        <div class="kpi-compact">
          <div class="label">Delivery Rate</div>
          <div class="value">${totalOrders > 0 ? fmt((totalDeliveredPieces / totalOrders) * 100) : 0}%</div>
        </div>
        <div class="kpi-compact">
          <div class="label">Avg Revenue per Piece</div>
          <div class="value">${totalDeliveredPieces > 0 ? fmt(totalRevenue / totalDeliveredPieces) : 0} USD</div>
        </div>
      </div>
    </div>
  `;

  Q('#lifetimeCostResults').innerHTML = html;
}

/* ---------- ORDERS SECTION ---------- */
function bindOrdersSection() {
  const container = Q('#ordersSection');
  if (!container) return;

  let html = `
    <div class="card">
      <div class="h">📦 Orders Tracking</div>
      <div class="row wrap">
        <select id="ordersProduct" class="input">
          <option value="">Select product...</option>
        </select>
        <input id="ordersStart" type="date" class="input" placeholder="Start Date"/>
        <input id="ordersEnd" type="date" class="input" placeholder="End Date"/>
        <input id="ordersCount" type="number" class="input" placeholder="Number of Orders" min="0"/>
        <button id="ordersAdd" class="btn">💾 Save Orders</button>
      </div>
    </div>

    <div class="table-scroll" style="margin-top: 20px;">
      <table class="table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Period</th>
            <th>Orders Count</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="ordersBody"></tbody>
      </table>
    </div>
  `;

  container.innerHTML = html;

  renderOrdersTable();
  Q('#ordersAdd')?.addEventListener('click', addOrders);
}

async function addOrders() {
  const productId = Q('#ordersProduct')?.value;
  const startDate = Q('#ordersStart')?.value;
  const endDate = Q('#ordersEnd')?.value;
  const ordersCount = +Q('#ordersCount')?.value || 0;

  if (!productId || !startDate || !endDate) {
    return alert('Please select product and enter date range');
  }

  try {
    await api('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        productId,
        startDate,
        endDate,
        ordersCount
      })
    });

    // Clear form
    Q('#ordersProduct').value = '';
    Q('#ordersStart').value = '';
    Q('#ordersEnd').value = '';
    Q('#ordersCount').value = '';

    await preload();
    renderOrdersTable();
  } catch (e) {
    alert('Error saving orders: ' + e.message);
  }
}

function renderOrdersTable() {
  const tbody = Q('#ordersBody');
  if (!tbody) return;

  const orders = state.orders || [];
  
  tbody.innerHTML = orders.map(order => {
    const product = state.products.find(p => p.id === order.productId) || { name: 'Unknown Product' };
    return `
      <tr>
        <td>${product.name}</td>
        <td>${order.startDate} to ${order.endDate}</td>
        <td>${fmt(order.ordersCount)}</td>
        <td>
          <button class="btn outline order-delete" data-id="${order.id}">Delete</button>
        </td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="4" class="muted">No orders recorded</td></tr>`;

  // Add delete functionality
  tbody.addEventListener('click', async (e) => {
    if (e.target.classList.contains('order-delete')) {
      // Note: Would need DELETE endpoint for orders
      alert('Delete functionality would require backend implementation');
    }
  });
}

/* ================================================================
   STOCK MOVEMENT PAGE - ENHANCED
   ================================================================ */
function renderStockMovementPage() {
  const btn = Q('#mvAdd'); if (!btn) return;
  
  // Show/hide purchase cost field based on origin
  Q('#mvFrom')?.addEventListener('change', function() {
    const purchaseCostDiv = Q('#purchaseCostDiv');
    if (this.value === 'china') {
      purchaseCostDiv.style.display = 'flex';
    } else {
      purchaseCostDiv.style.display = 'none';
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

  renderTransitTables();
}

// ... (rest of the existing functions remain similar but with enhanced calculations)

/* ================================================================
   PRODUCT PAGE - ENHANCED
   ================================================================ */
async function renderProductPage() {
  await preload();
  const product = state.products.find(p=>p.id===state.productId);
  if (!product) { alert('Product not found'); location.href='/'; return; }
  Q('#pdTitle').textContent = product.name;
  Q('#pdSku').textContent = product.sku ? `SKU: ${product.sku}` : '';

  await renderProductStockAd(product);
  renderProductBudgets(product); // Now auto-calculated
  await renderProductTransit(product);
  await renderProductArrivedShipments(product);
  bindProductLifetime(product);
  await renderProductRemittances(product);
  await bindInfluencers(product);
  renderProductNotesSection(product); // New section
}

/* ---------- PRODUCT NOTES SECTION ---------- */
function renderProductNotesSection(product) {
  const container = Q('#productNotesSection');
  if (!container) return;

  let html = `
    <div class="card">
      <div class="h">📝 Product Testing Notes & Results</div>
      <div class="row wrap">
        <select id="noteCountry" class="input">
          <option value="">Select country...</option>
        </select>
        <textarea id="noteText" class="input" placeholder="Enter testing results, observations, or notes for this country..." style="flex: 1; min-height: 80px;"></textarea>
        <button id="noteSave" class="btn">💾 Save Note</button>
      </div>
    </div>

    <div class="notes-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 15px; margin-top: 20px;">
  `;

  const productNotes = state.productNotes.filter(n => n.productId === product.id);
  
  productNotes.forEach(note => {
    html += `
      <div class="card note-card">
        <div class="flex" style="margin-bottom: 10px;">
          <h4 style="margin: 0; flex: 1;">${note.country}</h4>
          <span class="badge info">${new Date(note.updatedAt).toLocaleDateString()}</span>
        </div>
        <div class="muted" style="white-space: pre-wrap;">${note.note}</div>
        <div class="row" style="margin-top: 10px;">
          <button class="btn outline note-edit" data-id="${note.id}" data-country="${note.country}">Edit</button>
          <button class="btn outline danger note-delete" data-id="${note.id}">Delete</button>
        </div>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;

  Q('#noteSave')?.addEventListener('click', () => saveProductNote(product.id));
  container.addEventListener('click', handleNoteActions);
}

async function saveProductNote(productId) {
  const country = Q('#noteCountry')?.value;
  const note = Q('#noteText')?.value.trim();

  if (!country || !note) {
    return alert('Please select a country and enter notes');
  }

  try {
    await api('/api/product-notes', {
      method: 'POST',
      body: JSON.stringify({
        productId,
        country,
        note
      })
    });

    Q('#noteCountry').value = '';
    Q('#noteText').value = '';

    await preload();
    renderProductNotesSection(state.products.find(p => p.id === productId));
  } catch (e) {
    alert('Error saving note: ' + e.message);
  }
}

async function handleNoteActions(e) {
  if (e.target.classList.contains('note-edit')) {
    const noteId = e.target.dataset.id;
    const country = e.target.dataset.country;
    const note = state.productNotes.find(n => n.id === noteId);
    
    if (note) {
      const newNote = prompt('Edit note:', note.note);
      if (newNote !== null) {
        try {
          await api('/api/product-notes', {
            method: 'POST',
            body: JSON.stringify({
              productId: note.productId,
              country: note.country,
              note: newNote
            })
          });
          await preload();
          renderProductNotesSection(state.products.find(p => p.id === note.productId));
        } catch (error) {
          alert('Error updating note: ' + error.message);
        }
      }
    }
  }

  if (e.target.classList.contains('note-delete')) {
    // Note: Would need DELETE endpoint for product notes
    alert('Delete functionality would require backend implementation');
  }
}

/* ---------- ENHANCED PRODUCT BUDGETS (Auto-calculated) ---------- */
function renderProductBudgets(product) {
  const tb = Q('#pdPBBBody');
  if (!tb) return;

  // Calculate budgets automatically based on selling prices and costs
  const budgets = {};
  
  state.countries.forEach(country => {
    const sellingPrice = product.selling_prices[country] || 0;
    
    // Calculate average product cost from shipments
    const productShipments = api('/api/shipments').then(shipData => {
      const shipments = (shipData.shipments || []).filter(s => 
        s.productId === product.id && s.arrivedAt && s.toCountry === country && s.fromCountry === 'china'
      );
      
      let totalCost = 0;
      let totalPieces = 0;
      
      shipments.forEach(ship => {
        totalCost += (+ship.purchaseCost || 0) + (+ship.shipCost || 0);
        totalPieces += +ship.qty || 0;
      });
      
      const avgCost = totalPieces > 0 ? totalCost / totalPieces : 0;
      const budget = sellingPrice - avgCost;
      
      budgets[country] = budget > 0 ? budget : 0;
      
      // Update table
      renderBudgetsTable();
    }).catch(() => {
      budgets[country] = 0;
      renderBudgetsTable();
    });
  });

  function renderBudgetsTable() {
    tb.innerHTML = state.countries.map(country => {
      const budget = budgets[country] || 0;
      return `
        <tr>
          <td>${country}</td>
          <td class="${budget >= 0 ? 'number-positive' : 'number-negative'}">${fmt(budget)} USD</td>
          <td>Auto-calculated</td>
        </tr>
      `;
    }).join('') || `<tr><td colspan="3" class="muted">No data</td></tr>`;
  }

  renderBudgetsTable();
}

// ... (rest of the existing product page functions)

/* ================================================================
   NAV - Fixed navigation
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
