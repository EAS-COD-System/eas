/* EAS Tracker – Advanced Business Intelligence Frontend */

// ===================== UTILITY FUNCTIONS =====================
const Q = (s, r = document) => r.querySelector(s);
const QA = (s, r = document) => Array.from(r.querySelectorAll(s));
const fmt = n => (Number(n || 0)).toLocaleString(undefined, { maximumFractionDigits: 2 });
const todayISO = () => new Date().toISOString().slice(0, 10);
const getQuery = k => new URLSearchParams(location.search).get(k);

// API helper
async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || `HTTP ${res.status}`);
  }
  return await res.json();
}

// ===================== APPLICATION STATE =====================
const state = {
  view: 'home',
  countries: [],
  products: [],
  categories: { debit: [], credit: [] },
  product: null,
  productId: getQuery('id')
};

// ===================== QUICK ACTION FUNCTIONS =====================
function switchToSection(section) {
  QA('.nav-link').forEach(nav => nav.classList.remove('active'));
  QA('.page-section').forEach(section => section.classList.add('hide'));
  
  Q(`[data-view="${section}"]`).classList.add('active');
  Q(`#${section}`).classList.remove('hide');
}

function showAdSpendForm() {
  Q('#adSpendForm').classList.remove('hide');
  Q('#movementForm').classList.add('hide');
}

function hideAdSpendForm() {
  Q('#adSpendForm').classList.add('hide');
}

function showMovementForm() {
  Q('#movementForm').classList.remove('hide');
  Q('#adSpendForm').classList.add('hide');
}

function hideMovementForm() {
  Q('#movementForm').classList.add('hide');
}

// ===================== AUTHENTICATION =====================
async function checkAuth() {
  try {
    const res = await fetch('/api/auth/check', { credentials: 'include' });
    const data = await res.json();
    return data.authenticated === true;
  } catch {
    return false;
  }
}

async function gate() {
  const isAuthenticated = await checkAuth();
  
  if (isAuthenticated) {
    Q('#login').classList.add('hide');
    Q('#main').classList.remove('hide');
    
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
  } else {
    Q('#login').classList.remove('hide');
    Q('#main').classList.add('hide');
  }
}

// Login handler
Q('#loginBtn').addEventListener('click', async () => {
  const password = Q('#pw').value;
  if (!password) return alert('Please enter password');

  try {
    await api('/api/auth', { 
      method: 'POST', 
      body: JSON.stringify({ password }) 
    });
    await gate();
  } catch (error) {
    alert('Wrong password or server error');
  }
});

// Logout handler
Q('#logoutLink').addEventListener('click', async (e) => {
  e.preventDefault();
  try { 
    await api('/api/auth', { 
      method: 'POST', 
      body: JSON.stringify({ password: 'logout' }) 
    }); 
  } catch {}
  location.reload();
});

// ===================== DATA MANAGEMENT =====================
async function preloadProducts() {
  try {
    const r = await api('/api/products');
    state.products = r.products || [];
  } catch { 
    state.products = []; 
  }
}

function productsActiveOnly() {
  return (state.products || []).filter(p => p.status !== 'paused');
}

function fillGlobalSelects() {
  // Filter out China from most selectors
  const salesCountries = state.countries.filter(c => c !== 'china');
  
  // Country selectors (without China)
  const countrySelectors = [
    '#adCountry', '#rCountry', '#pfCountry', '#pdAdCountry', 
    '#pdRCountry', '#pdMvTo', '#pdPBCountry', '#pdInfCountry',
    '#pdInfFilterCountry', '#pcCountry'
  ];
  
  countrySelectors.forEach(sel => {
    const el = Q(sel);
    if (el) {
      el.innerHTML = salesCountries.map(c => `<option value="${c}">${c}</option>`).join('');
      if (sel === '#pcCountry' || sel === '#pfCountry' || sel === '#pdInfFilterCountry') {
        el.insertAdjacentHTML('afterbegin', '<option value="">All countries</option>');
      }
    }
  });

  // Movement FROM selectors (include China)
  const fromSelectors = ['#mvFrom', '#pdMvFrom'];
  fromSelectors.forEach(sel => {
    const el = Q(sel);
    if (el) el.innerHTML = state.countries.map(c => `<option value="${c}">${c}</option>`).join('');
  });

  // Product selectors
  const productSelectors = ['#adProduct', '#rProduct', '#mvProduct', '#pdInfSelect'];
  productSelectors.forEach(sel => {
    const el = Q(sel);
    if (el) {
      el.innerHTML = productsActiveOnly().map(p => 
        `<option value="${p.id}">${p.name}${p.sku ? ' (' + p.sku + ')' : ''}</option>`
      ).join('');
    }
  });

  // Lifetime product selector
  if (Q('#lpProduct')) {
    Q('#lpProduct').innerHTML = '<option value="">All Products</option>' +
      state.products.map(p => `<option value="${p.id}">${p.name}${p.sku ? ' (' + p.sku + ')' : ''}</option>`).join('');
  }

  // Edit product selector
  if (Q('#epSelect')) {
    Q('#epSelect').innerHTML = '<option value="">Select Product</option>' +
      state.products.map(p => `<option value="${p.id}">${p.name} (${p.sku || '—'})</option>`).join('');
  }
}

// ===================== DASHBOARD =====================
function initDashboard() {
  renderKpis();
  renderStockAndSpendByCountry();
  initDailyAdSpend();
  initMovements();
  renderTransitTables();
  initLifetimeGlobal();
}

async function renderKpis() {
  const activeProducts = productsActiveOnly().length;
  const salesCountries = state.countries.filter(c => c !== 'china').length;
  
  Q('#kpiProducts').textContent = activeProducts;
  Q('#kpiCountries').textContent = salesCountries;

  try {
    const s = await api('/api/shipments');
    const live = (s.shipments || []).filter(x => !x.arrivedAt).length;
    Q('#kpiTransit').textContent = live;
  } catch {}

  try {
    const a = await api('/api/adspend');
    const total = (a.adSpends || []).reduce((t, x) => t + (+x.amount || 0), 0);
    Q('#kpiAdSpend').textContent = fmt(total) + ' USD';
  } catch {}

  try {
    const r = await api('/api/deliveries');
    const total = (r.deliveries || []).filter(d => d.country !== 'china')
      .reduce((t, d) => t + (+d.delivered || 0), 0);
    Q('#kpiDelivered').textContent = fmt(total);
  } catch {}
}

async function renderStockAndSpendByCountry() {
  const body = Q('#stockByCountryBody');
  const salesCountries = state.countries.filter(c => c !== 'china');
  const per = {};
  salesCountries.forEach(c => per[c] = { stock: 0, ad: 0 });

  try {
    const s = await api('/api/shipments');
    (s.shipments || []).forEach(sp => {
      if (sp.arrivedAt) {
        const to = sp.toCountry, from = sp.fromCountry, qty = +sp.qty || 0;
        if (to && to !== 'china') { 
          per[to] = per[to] || { stock: 0, ad: 0 }; 
          per[to].stock += qty; 
        }
        if (from && from !== 'china') { 
          per[from] = per[from] || { stock: 0, ad: 0 }; 
          per[from].stock -= qty; 
        }
      }
    });
  } catch {}

  try {
    const r = await api('/api/remittances');
    (r.remittances || []).forEach(rr => {
      if (rr.country !== 'china' && per[rr.country]) {
        per[rr.country].stock -= (+rr.pieces || 0);
      }
    });
  } catch {}

  try {
    const a = await api('/api/adspend');
    (a.adSpends || []).forEach(x => {
      if (x.country !== 'china' && per[x.country]) {
        per[x.country].ad += (+x.amount || 0);
      }
    });
  } catch {}

  let st = 0, ad = 0;
  const rows = Object.entries(per).map(([c, v]) => {
    st += v.stock; ad += v.ad;
    return `<tr><td>${c}</td><td>${fmt(v.stock)}</td><td>${fmt(v.ad)}</td></tr>`;
  }).join('');
  
  body.innerHTML = rows || '<tr><td colspan="3" class="muted">No data</td></tr>';
  Q('#stockTotal').textContent = fmt(st);
  Q('#adTotal').textContent = fmt(ad);
}

function initDailyAdSpend() {
  Q('#adSave').addEventListener('click', async () => {
    const payload = {
      productId: Q('#adProduct').value,
      country: Q('#adCountry').value,
      platform: Q('#adPlatform').value,
      amount: +Q('#adAmount').value || 0
    };
    
    if (!payload.productId || !payload.country || !payload.platform) {
      return alert('Missing fields');
    }
    
    try {
      await api('/api/adspend', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      alert('Ad spend saved');
      renderKpis();
      renderStockAndSpendByCountry();
      Q('#adAmount').value = '';
      hideAdSpendForm();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  });
}

function initMovements() {
  Q('#mvAdd').addEventListener('click', async () => {
    const payload = {
      productId: Q('#mvProduct').value,
      fromCountry: Q('#mvFrom').value,
      toCountry: Q('#mvTo').value,
      qty: +Q('#mvQty').value || 0,
      shipCost: +Q('#mvShip').value || 0,
      departedAt: todayISO(),
      arrivedAt: null
    };
    
    if (!payload.productId) return alert('Select product');
    
    try {
      await api('/api/shipments', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      alert('Movement added');
      renderTransitTables();
      Q('#mvQty').value = '';
      Q('#mvShip').value = '';
      hideMovementForm();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  });
}

async function renderTransitTables() {
  try {
    const s = await api('/api/shipments');
    const list = (s.shipments || []).filter(x => !x.arrivedAt);
    const productsById = Object.fromEntries(state.products.map(p => [p.id, p.name]));

    const ck = list.filter(sp =>
      sp.fromCountry.toLowerCase() === 'china' &&
      sp.toCountry.toLowerCase() === 'kenya'
    );
    const ic = list.filter(sp => !ck.includes(sp));

    // China → Kenya table
    const ckBody = Q('#shipCKBody');
    ckBody.innerHTML = ck.map(sp => {
      const name = productsById[sp.productId] || sp.productId;
      return `<tr>
        <td>${name}</td>
        <td>${fmt(sp.qty)}</td>
        <td>${fmt(sp.shipCost)}</td>
        <td>${sp.departedAt || ''}</td>
        <td>
          <button class="btn outline compact" data-mark-arrived="${sp.id}">Arrived</button>
          <button class="btn outline compact danger" data-del-transit="${sp.id}">Delete</button>
        </td>
      </tr>`;
    }).join('') || '<tr><td colspan="5" class="muted">No transit</td></tr>';

    // Inter-country table
    const icBody = Q('#shipICBody');
    icBody.innerHTML = ic.map(sp => {
      const name = productsById[sp.productId] || sp.productId;
      return `<tr>
        <td>${name}</td>
        <td>${sp.fromCountry} → ${sp.toCountry}</td>
        <td>${fmt(sp.qty)}</td>
        <td>
          <button class="btn outline compact" data-mark-arrived="${sp.id}">Arrived</button>
          <button class="btn outline compact danger" data-del-transit="${sp.id}">Delete</button>
        </td>
      </tr>`;
    }).join('') || '<tr><td colspan="4" class="muted">No transit</td></tr>';

    // Add event listeners
    QA('[data-mark-arrived]').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.markArrived;
        const date = prompt('Arrival date (YYYY-MM-DD)', todayISO());
        if (!date) return;
        try {
          await api('/api/shipments/' + id, {
            method: 'PUT',
            body: JSON.stringify({ arrivedAt: date })
          });
          renderTransitTables();
          renderStockAndSpendByCountry();
        } catch (e) {
          alert('Error: ' + e.message);
        }
      };
    });

    QA('[data-del-transit]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Delete shipment?')) return;
        await api('/api/shipments/' + btn.dataset.delTransit, { method: 'DELETE' });
        renderTransitTables();
      };
    });

  } catch (e) {
    console.error('Error rendering transit:', e);
  }
}

function initLifetimeGlobal() {
  Q('#lpRun').addEventListener('click', async () => {
    const productId = Q('#lpProduct').value || '';
    const start = Q('#lpStart').value, end = Q('#lpEnd').value;
    const qs = new URLSearchParams();
    if (start) qs.append('start', start);
    if (end) qs.append('end', end);
    
    try {
      const r = await api('/api/remittances' + (qs.toString() ? '?' + qs.toString() : ''));
      const list = (r.remittances || []).filter(x => x.country !== 'china');
      const filteredList = productId ? list.filter(x => x.productId === productId) : list;
      
      const prodMap = Object.fromEntries(state.products.map(p => [p.id, p]));
      const byProductCountry = {};
      
      filteredList.forEach(x => {
        const key = `${x.productId}|${x.country}`;
        if (!byProductCountry[key]) {
          byProductCountry[key] = {
            name: prodMap[x.productId]?.name || x.productId,
            country: x.country,
            revenue: 0, adSpend: 0, shipping: 0, baseCost: 0, pieces: 0, profit: 0
          };
        }
        
        const p = byProductCountry[key];
        const pieces = +x.pieces || 0;
        const baseCostPerPiece = (+prodMap[x.productId]?.cost_china || 0) + (+prodMap[x.productId]?.ship_china_to_kenya || 0);
        const extraCost = (+x.extraPerPiece || 0) * pieces;
        
        p.revenue += +x.revenue || 0;
        p.adSpend += +x.adSpend || 0;
        p.shipping += extraCost;
        p.baseCost += baseCostPerPiece * pieces;
        p.pieces += pieces;
        p.profit = p.revenue - p.adSpend - p.shipping - p.baseCost;
      });
      
      let totalRev = 0, totalAd = 0, totalShip = 0, totalBase = 0, totalPieces = 0, totalProfit = 0;
      const rows = Object.values(byProductCountry).map(p => {
        totalRev += p.revenue;
        totalAd += p.adSpend;
        totalShip += p.shipping;
        totalBase += p.baseCost;
        totalPieces += p.pieces;
        totalProfit += p.profit;
        
        return `<tr>
          <td>${p.name}</td>
          <td>${p.country}</td>
          <td>${fmt(p.revenue)}</td>
          <td>${fmt(p.adSpend)}</td>
          <td>${fmt(p.shipping)}</td>
          <td>${fmt(p.baseCost)}</td>
          <td>${fmt(p.pieces)}</td>
          <td>${fmt(p.profit)}</td>
        </tr>`;
      }).join('');
      
      Q('#lifetimeBody').innerHTML = rows || '<tr><td colspan="8" class="muted">No data</td></tr>';
      Q('#ltRevT').textContent = fmt(totalRev);
      Q('#ltAdT').textContent = fmt(totalAd);
      Q('#ltShipT').textContent = fmt(totalShip);
      Q('#ltBaseT').textContent = fmt(totalBase);
      Q('#ltPiecesT').textContent = fmt(totalPieces);
      Q('#ltProfitT').textContent = fmt(totalProfit);
      
    } catch (e) {
      alert('Error: ' + e.message);
    }
  });
}

// ===================== PRODUCTS MANAGEMENT =====================
function initProducts() {
  Q('#pAdd').addEventListener('click', async () => {
    const payload = {
      name: Q('#pName').value.trim(),
      sku: Q('#pSku').value.trim(),
      cost_china: +Q('#pCost').value || 0,
      ship_china_to_kenya: +Q('#pShip').value || 0,
      margin_budget: +Q('#pMB').value || 0
    };
    
    if (!payload.name) return alert('Name required');
    
    try {
      await api('/api/products', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      await preloadProducts();
      fillGlobalSelects();
      renderProductsTable();
      alert('Product added');
      
      // Clear form
      Q('#pName').value = '';
      Q('#pSku').value = '';
      Q('#pCost').value = '';
      Q('#pShip').value = '';
      Q('#pMB').value = '';
    } catch (e) {
      alert('Error: ' + e.message);
    }
  });
  
  renderProductsTable();
}

function renderProductsTable() {
  const tbody = Q('#productsTable');
  tbody.innerHTML = state.products.map(p => `
    <tr>
      <td>${p.name}</td>
      <td>${p.sku || '-'}</td>
      <td><span class="badge ${p.status === 'paused' ? 'muted' : ''}">${p.status}</span></td>
      <td>${fmt(p.cost_china)}</td>
      <td>${fmt(p.ship_china_to_kenya)}</td>
      <td>
        <a class="btn compact" href="/product.html?id=${p.id}">Open</a>
        <button class="btn outline compact" data-pause="${p.id}">${p.status === 'active' ? 'Pause' : 'Run'}</button>
        <button class="btn outline compact danger" data-del="${p.id}">Delete</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="muted">No products</td></tr>';
  
  tbody.addEventListener('click', async (e) => {
    const pauseId = e.target.dataset.pause;
    const delId = e.target.dataset.del;
    
    if (pauseId) {
      const product = state.products.find(p => p.id === pauseId);
      const newStatus = product.status === 'active' ? 'paused' : 'active';
      await api(`/api/products/${pauseId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: newStatus })
      });
      await preloadProducts();
      renderProductsTable();
      fillGlobalSelects();
    }
    
    if (delId) {
      if (!confirm('Delete product and all related data?')) return;
      await api('/api/products/' + delId, { method: 'DELETE' });
      await preloadProducts();
      renderProductsTable();
      fillGlobalSelects();
      renderStockAndSpendByCountry();
    }
  });
}

// ===================== PERFORMANCE =====================
function initPerformance() {
  // Top products
  Q('#pfRun').addEventListener('click', async () => {
    const quick = Q('#pfQuick').value;
    let start = Q('#pfStart').value, end = Q('#pfEnd').value;
    const country = Q('#pfCountry').value || '';
    
    if (quick && quick !== 'custom') {
      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - parseInt(quick));
      start = daysAgo.toISOString().slice(0, 10);
      end = todayISO();
    }
    
    const qs = new URLSearchParams();
    if (start) qs.append('start', start);
    if (end) qs.append('end', end);
    if (country) qs.append('country', country);
    
    try {
      const r = await api('/api/remittances' + (qs.toString() ? '?' + qs.toString() : ''));
      const list = (r.remittances || []).filter(x => x.country !== 'china');
      const prodMap = Object.fromEntries(state.products.map(p => [p.id, p]));
      const byProduct = {};
      
      list.forEach(x => {
        const key = x.productId;
        if (!byProduct[key]) {
          byProduct[key] = {
            name: prodMap[x.productId]?.name || x.productId,
            country: x.country,
            pieces: 0, adSpend: 0, productCost: 0, profit: 0
          };
        }
        
        const p = byProduct[key];
        const pieces = +x.pieces || 0;
        const baseCost = (+prodMap[x.productId]?.cost_china || 0) + (+prodMap[x.productId]?.ship_china_to_kenya || 0);
        const extraCost = (+x.extraPerPiece || 0) * pieces;
        const profit = (+x.revenue || 0) - (+x.adSpend || 0) - (baseCost * pieces) - extraCost;
        
        p.pieces += pieces;
        p.adSpend += +x.adSpend || 0;
        p.productCost += baseCost * pieces;
        p.profit += profit;
      });
      
      const sorted = Object.values(byProduct).sort((a, b) => b.pieces - a.pieces);
      const rows = sorted.map(p => `
        <tr>
          <td>${p.name}</td>
          <td>${p.country}</td>
          <td>${fmt(p.pieces)}</td>
          <td>${fmt(p.adSpend)}</td>
          <td>${fmt(p.productCost)}</td>
          <td>${fmt(p.profit)}</td>
          <td>${p.pieces ? fmt(p.profit / p.pieces) : '0'}</td>
        </tr>
      `).join('');
      
      Q('#pfTable').innerHTML = rows || '<tr><td colspan="7" class="muted">No data</td></tr>';
    } catch (e) {
      alert('Error: ' + e.message);
    }
  });
  
  // Remittance report
  Q('#rAdd').addEventListener('click', async () => {
    const payload = {
      start: Q('#rStart').value,
      end: Q('#rEnd').value,
      country: Q('#rCountry').value,
      productId: Q('#rProduct').value,
      orders: +Q('#rOrders').value || 0,
      pieces: +Q('#rPieces').value || 0,
      revenue: +Q('#rRev').value || 0,
      adSpend: +Q('#rAds').value || 0,
      extraPerPiece: +Q('#rExtra').value || 0
    };
    
    if (!payload.start || !payload.end || !payload.country || !payload.productId) {
      return alert('Missing required fields');
    }
    
    try {
      await api('/api/remittances', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      alert('Remittance saved');
      
      // Clear form
      Q('#rStart').value = '';
      Q('#rEnd').value = '';
      Q('#rOrders').value = '';
      Q('#rPieces').value = '';
      Q('#rRev').value = '';
      Q('#rAds').value = '';
      Q('#rExtra').value = '';
    } catch (e) {
      alert('Error: ' + e.message);
    }
  });
}

// ===================== FINANCE =====================
async function initFinance() {
  await loadFinanceCategories();
  
  // Add category
  Q('#fcAdd').addEventListener('click', async () => {
    const type = Q('#fcType').value;
    const name = Q('#fcName').value.trim();
    
    if (!name) return alert('Category name required');
    
    try {
      await api('/api/finance/categories', {
        method: 'POST',
        body: JSON.stringify({ type, name })
      });
      await loadFinanceCategories();
      Q('#fcName').value = '';
    } catch (e) {
      alert('Error: ' + e.message);
    }
  });
  
  // Add entry
  Q('#feAdd').addEventListener('click', async () => {
    const date = Q('#feDate').value;
    const category = Q('#feCat').value;
    const amount = +Q('#feAmt').value || 0;
    const note = Q('#feNote').value;
    
    if (!date || !category) return alert('Date and category required');
    
    const type = state.categories.credit.includes(category) ? 'credit' : 'debit';
    
    try {
      await api('/api/finance/entries', {
        method: 'POST',
        body: JSON.stringify({ date, type, category, amount, note })
      });
      renderFinancePeriod();
      Q('#feAmt').value = '';
      Q('#feNote').value = '';
    } catch (e) {
      alert('Error: ' + e.message);
    }
  });
  
  // Run period report
  Q('#feRun').addEventListener('click', renderFinancePeriod);
  
  renderFinancePeriod();
}

async function loadFinanceCategories() {
  try {
    const cats = await api('/api/finance/categories');
    state.categories = cats;
    
    // Update category displays
    Q('#fcDebits').innerHTML = (cats.debit || []).map(c => `
      <span class="chip">${c} <button class="x" data-del-debit="${c}">×</button></span>
    `).join('') || '—';
    
    Q('#fcCredits').innerHTML = (cats.credit || []).map(c => `
      <span class="chip">${c} <button class="x" data-del-credit="${c}">×</button></span>
    `).join('') || '—';
    
    // Update category dropdown
    const allCats = [...(cats.debit || []), ...(cats.credit || [])].sort();
    Q('#feCat').innerHTML = '<option value="" disabled selected>Select category</option>' +
      allCats.map(c => `<option value="${c}">${c}</option>`).join('');
    
    // Add delete handlers
    const catsContainer = Q('.categories-grid');
    catsContainer.addEventListener('click', async (e) => {
      if (e.target.classList.contains('x')) {
        const category = e.target.parentElement.dataset.delDebit || e.target.parentElement.dataset.delCredit;
        const type = e.target.parentElement.dataset.delDebit ? 'debit' : 'credit';
        
        if (confirm(`Delete category "${category}"?`)) {
          await api(`/api/finance/categories?type=${type}&name=${encodeURIComponent(category)}`, {
            method: 'DELETE'
          });
          await loadFinanceCategories();
        }
      }
    });
    
  } catch (e) {
    console.error('Error loading finance categories:', e);
  }
}

async function renderFinancePeriod() {
  try {
    const start = Q('#fes').value;
    const end = Q('#fee').value;
    const qs = new URLSearchParams();
    if (start) qs.append('start', start);
    if (end) qs.append('end', end);
    
    const r = await api('/api/finance/entries' + (qs.toString() ? '?' + qs.toString() : ''));
    const entries = r.entries || [];
    
    // Update running balance - BIG AND BOLD
    Q('#feRunning').textContent = fmt(r.running || 0) + ' USD';
    Q('#feBalance').textContent = 'Period Balance: ' + fmt(r.balance || 0) + ' USD';
    
    const rows = entries.map(entry => `
      <tr>
        <td>${entry.date}</td>
        <td>${entry.type}</td>
        <td>${entry.category}</td>
        <td>${fmt(entry.amount)}</td>
        <td>${entry.note || ''}</td>
        <td><button class="btn outline compact" data-del-entry="${entry.id}">Delete</button></td>
      </tr>
    `).join('');
    
    Q('#feTable').innerHTML = rows || '<tr><td colspan="6" class="muted">No entries</td></tr>';
    
    // Add delete handlers for entries
    Q('#feTable').addEventListener('click', async (e) => {
      if (e.target.dataset.delEntry) {
        if (confirm('Delete this entry?')) {
          await api('/api/finance/entries/' + e.target.dataset.delEntry, { method: 'DELETE' });
          renderFinancePeriod();
        }
      }
    });
    
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

// ===================== SETTINGS =====================
function initSettings() {
  // Add country
  Q('#ctyAdd').addEventListener('click', async () => {
    const name = Q('#cty').value.trim();
    if (!name) return;
    
    try {
      await api('/api/countries', {
        method: 'POST',
        body: JSON.stringify({ name })
      });
      // Reload countries
      const meta = await api('/api/meta');
      state.countries = meta.countries || [];
      fillGlobalSelects();
      renderCountryChips();
      Q('#cty').value = '';
    } catch (e) {
      alert('Error: ' + e.message);
    }
  });
  
  renderCountryChips();
  
  // Edit product
  const epSelect = Q('#epSelect');
  epSelect.addEventListener('change', () => {
    const product = state.products.find(p => p.id === epSelect.value);
    if (!product) return;
    
    Q('#epName').value = product.name;
    Q('#epSku').value = product.sku || '';
    Q('#epCost').value = product.cost_china || 0;
    Q('#epShip').value = product.ship_china_to_kenya || 0;
    Q('#epMB').value = product.margin_budget || 0;
  });
  
  Q('#epSave').addEventListener('click', async () => {
    const id = epSelect.value;
    if (!id) return alert('Select a product');
    
    const payload = {
      name: Q('#epName').value,
      sku: Q('#epSku').value,
      cost_china: +Q('#epCost').value || 0,
      ship_china_to_kenya: +Q('#epShip').value || 0,
      margin_budget: +Q('#epMB').value || 0
    };
    
    try {
      await api('/api/products/' + id, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      await preloadProducts();
      fillGlobalSelects();
      alert('Product updated');
    } catch (e) {
      alert('Error: ' + e.message);
    }
  });
  
  // Snapshots
  Q('#snapSave').addEventListener('click', async () => {
    const name = Q('#snapName').value.trim() || `Manual ${new Date().toLocaleString()}`;
    
    try {
      await api('/api/snapshots', {
        method: 'POST',
        body: JSON.stringify({ name })
      });
      renderSnapshots();
      Q('#snapName').value = '';
      alert('Snapshot saved');
    } catch (e) {
      alert('Error: ' + e.message);
    }
  });
  
  renderSnapshots();
}

function renderCountryChips() {
  const salesCountries = state.countries.filter(c => c !== 'china');
  const container = Q('#ctyList');
  
  container.innerHTML = salesCountries.map(c => `
    <span class="chip">${c} <button class="x" data-del-cty="${c}">×</button></span>
  `).join('') || '—';
  
  container.addEventListener('click', async (e) => {
    if (e.target.classList.contains('x')) {
      const country = e.target.parentElement.dataset.delCty;
      if (confirm(`Delete country "${country}"?`)) {
        try {
          await api('/api/countries/' + encodeURIComponent(country), { method: 'DELETE' });
          // Reload countries
          const meta = await api('/api/meta');
          state.countries = meta.countries || [];
          fillGlobalSelects();
          renderCountryChips();
        } catch (error) {
          alert('Error: ' + error.message);
        }
      }
    }
  });
}

async function renderSnapshots() {
  try {
    const r = await api('/api/snapshots');
    const snapshots = r.snapshots || [];
    const tbody = Q('#snapList');
    
    tbody.innerHTML = snapshots.map(snap => `
      <tr>
        <td>${snap.name}</td>
        <td>${new Date(snap.createdAt).toLocaleDateString()}</td>
        <td>
          <button class="btn outline compact" data-restore="${snap.file}">Restore</button>
          <button class="btn outline compact danger" data-del-snap="${snap.id}">Delete</button>
        </td>
      </tr>
    `).join('') || '<tr><td colspan="3" class="muted">No snapshots</td></tr>';
    
    tbody.addEventListener('click', async (e) => {
      if (e.target.dataset.restore) {
        if (confirm('Restore this snapshot? Current data will be replaced.')) {
          try {
            await api('/api/snapshots/restore', {
              method: 'POST',
              body: JSON.stringify({ file: e.target.dataset.restore })
            });
            alert('System restored - reloading...');
            location.reload();
          } catch (error) {
            alert('Error: ' + error.message);
          }
        }
      }
      
      if (e.target.dataset.delSnap) {
        if (confirm('Delete this snapshot?')) {
          await api('/api/snapshots/' + e.target.dataset.delSnap, { method: 'DELETE' });
          renderSnapshots();
        }
      }
    });
    
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

// ===================== PRODUCT PAGE =====================
async function loadProduct(id) {
  await preloadProducts();
  state.product = state.products.find(p => p.id === id) || null;
}

function renderProductPage() {
  if (!state.product) {
    alert('Product not found');
    location.href = '/';
    return;
  }
  
  Q('#pdTitle').textContent = state.product.name;
  Q('#pdTitleMain').textContent = state.product.name;
  Q('#pdSku').textContent = state.product.sku ? `SKU: ${state.product.sku}` : '';
  
  fillGlobalSelects();
  bindProductHandlers();
  refreshProductSections();
}

function bindProductHandlers() {
  // Profit budget
  Q('#pdPBSave').addEventListener('click', async () => {
    const country = Q('#pdPBCountry').value;
    const value = +Q('#pdPBValue').value || 0;
    
    const budgets = { ...state.product.budgets };
    budgets[country] = value;
    
    try {
      await api('/api/products/' + state.product.id, {
        method: 'PUT',
        body: JSON.stringify({ budgets })
      });
      await loadProduct(state.product.id);
      renderPBTable();
      Q('#pdPBValue').value = '';
    } catch (e) {
      alert('Error: ' + e.message);
    }
  });
  
  // Lifetime performance
  Q('#pdLPRun').addEventListener('click', () => {
    renderProductLifetime();
  });
  
  // Add influencer
  Q('#pdInfAdd').addEventListener('click', async () => {
    const payload = {
      name: Q('#pdInfName').value.trim(),
      social: Q('#pdInfSocial').value.trim(),
      country: Q('#pdInfCountry').value
    };
    
    if (!payload.name) return alert('Name required');
    
    try {
      await api('/api/influencers', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      renderInfluencers();
      Q('#pdInfName').value = '';
      Q('#pdInfSocial').value = '';
    } catch (e) {
      alert('Error: ' + e.message);
    }
  });
  
  // Add influencer spend - NOW INCLUDED IN LIFETIME AD SPEND
  Q('#pdInfSpendAdd').addEventListener('click', async () => {
    const payload = {
      date: Q('#pdInfDate').value || todayISO(),
      influencerId: Q('#pdInfSelect').value,
      country: Q('#pdInfCountry').value,
      productId: state.product.id,
      amount: +Q('#pdInfAmount').value || 0
    };
    
    if (!payload.influencerId) return alert('Select influencer');
    
    try {
      await api('/api/influencers/spend', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      
      // Also add to adspend for lifetime tracking
      await api('/api/adspend', {
        method: 'POST',
        body: JSON.stringify({
          productId: state.product.id,
          country: payload.country,
          platform: 'influencer',
          amount: payload.amount
        })
      });
      
      renderInfluencers();
      refreshProductSections();
      Q('#pdInfAmount').value = '';
      alert('Influencer spend recorded and added to lifetime ad spend');
    } catch (e) {
      alert('Error: ' + e.message);
    }
  });
  
  // Filter influencer spends
  Q('#pdInfRun').addEventListener('click', () => {
    renderInfluencers();
  });
}

async function refreshProductSections() {
  await loadProduct(state.product.id);
  renderProductStockAd();
  renderPBTable();
  renderProductRemittances();
  renderProductTransit();
  renderProductArrived();
  renderProductLifetime();
  renderInfluencers();
}

async function renderProductStockAd() {
  const body = Q('#pdStockBody');
  const salesCountries = state.countries.filter(c => c !== 'china');
  const per = {};
  salesCountries.forEach(c => per[c] = { stock: 0, ad: 0 });

  try {
    const s = await api('/api/shipments');
    (s.shipments || []).filter(x => x.productId === state.product.id && x.arrivedAt).forEach(sp => {
      const to = sp.toCountry, from = sp.fromCountry, qty = +sp.qty || 0;
      if (to && to !== 'china') { 
        per[to] = per[to] || { stock: 0, ad: 0 }; 
        per[to].stock += qty; 
      }
      if (from && from !== 'china') { 
        per[from] = per[from] || { stock: 0, ad: 0 }; 
        per[from].stock -= qty; 
      }
    });
  } catch {}

  try {
    const r = await api('/api/remittances');
    (r.remittances || []).filter(x => x.productId === state.product.id && x.country !== 'china').forEach(rr => {
      per[rr.country] = per[rr.country] || { stock: 0, ad: 0 };
      per[rr.country].stock -= (+rr.pieces || 0);
    });
  } catch {}

  try {
    const a = await api('/api/adspend');
    (a.adSpends || []).filter(x => x.productId === state.product.id && x.country !== 'china').forEach(ad => {
      per[ad.country] = per[ad.country] || { stock: 0, ad: 0 };
      per[ad.country].ad += (+ad.amount || 0);
    });
  } catch {}

  let st = 0, ad = 0;
  const rows = Object.entries(per).map(([c, v]) => {
    st += v.stock; ad += v.ad;
    return `<tr><td>${c}</td><td>${fmt(v.stock)}</td><td>${fmt(v.ad)}</td></tr>`;
  }).join('');
  
  body.innerHTML = rows || '<tr><td colspan="3" class="muted">No data</td></tr>';
  Q('#pdStockTotal').textContent = fmt(st);
  Q('#pdAdTotal').textContent = fmt(ad);

  // Update transit badge
  const transit = (await api('/api/shipments')).shipments
    .filter(x => x.productId === state.product.id && !x.arrivedAt)
    .reduce((t, x) => t + (+x.qty || 0), 0);
    
  Q('#pdTransitBadge').textContent = `Transit: ${fmt(transit)}`;
}

function renderPBTable() {
  const tbody = Q('#pdPBBBody');
  const map = state.product.budgets || {};
  const salesCountries = state.countries.filter(c => c !== 'china');
  
  tbody.innerHTML = salesCountries.map(c => `
    <tr>
      <td>${c}</td>
      <td>${fmt(map[c] || 0)}</td>
      <td><button class="btn outline compact" data-clear-b="${c}">Clear</button></td>
    </tr>
  `).join('');
  
  tbody.addEventListener('click', async (e) => {
    const country = e.target.dataset.clearB;
    if (!country) return;
    
    const budgets = { ...state.product.budgets };
    delete budgets[country];
    
    try {
      await api('/api/products/' + state.product.id, {
        method: 'PUT',
        body: JSON.stringify({ budgets })
      });
      await loadProduct(state.product.id);
      renderPBTable();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  });
}

async function renderProductRemittances() {
  try {
    const r = await api('/api/remittances');
    const list = (r.remittances || []).filter(x => x.productId === state.product.id && x.country !== 'china');
    const tbody = Q('#pdRBody');
    
    let totalRev = 0, totalAd = 0, totalExtra = 0, totalProfit = 0;
    const rows = list.map(x => {
      const extra = (+x.extraPerPiece || 0) * (+x.pieces || 0);
      const profit = (+x.revenue || 0) - (+x.adSpend || 0) - extra;
      totalRev += +x.revenue || 0;
      totalAd += +x.adSpend || 0;
      totalExtra += extra;
      totalProfit += profit;
      
      return `<tr>
        <td>${x.start} → ${x.end}</td>
        <td>${x.country}</td>
        <td>${fmt(x.orders)}</td>
        <td>${fmt(x.pieces)}</td>
        <td>${fmt(x.revenue)}</td>
        <td>${fmt(x.adSpend)}</td>
        <td>${fmt(x.extraPerPiece)}</td>
        <td>${fmt(profit)}</td>
        <td><button class="btn outline compact danger" data-del-rem="${x.id}">Delete</button></td>
      </tr>`;
    }).join('');
    
    tbody.innerHTML = rows || '<tr><td colspan="9" class="muted">No entries</td></tr>';
    Q('#pdRRevT').textContent = fmt(totalRev);
    Q('#pdRAdT').textContent = fmt(totalAd);
    Q('#pdRExtraT').textContent = fmt(totalExtra);
    Q('#pdRProfitT').textContent = fmt(totalProfit);
    
    // Add delete handlers
    tbody.addEventListener('click', async (e) => {
      if (e.target.dataset.delRem) {
        if (confirm('Delete this remittance?')) {
          await api('/api/remittances/' + e.target.dataset.delRem, { method: 'DELETE' });
          renderProductRemittances();
          renderProductLifetime();
          renderProductStockAd();
        }
      }
    });
    
  } catch (e) {
    console.error('Error rendering product remittances:', e);
  }
}

// ... Additional product page rendering functions would continue here

// ===================== NAVIGATION =====================
function initNav() {
  QA('.nav-link[data-view]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const view = a.dataset.view;
      
      // Hide all sections
      QA('.page-section').forEach(section => section.classList.add('hide'));
      
      // Show selected section
      Q(`#${view}`).classList.remove('hide');
      
      // Update active nav
      QA('.nav-link').forEach(nav => nav.classList.remove('active'));
      a.classList.add('active');
      
      // Refresh dashboard if needed
      if (view === 'home') {
        renderKpis();
        renderStockAndSpendByCountry();
        renderTransitTables();
      }
    });
  });
}

// ===================== INITIALIZATION =====================
async function initializeApp() {
  try {
    // Load initial data
    const meta = await api('/api/meta');
    state.countries = meta.countries || [];
    
    // Start the application
    await gate();
  } catch (error) {
    console.log('Application started - login required');
  }
}

// Start the application when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeApp);
