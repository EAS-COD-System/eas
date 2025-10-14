// EAS Tracker Frontend
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
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
  return res.json();
}

const state = {
  view: 'home',
  countries: [],
  products: [],
  product: null,
  productId: getQuery('id')
};

// Authentication
async function checkAuth() {
  try {
    const res = await fetch('/api/auth/check', { credentials: 'include' });
    return (await res.json()).authenticated;
  } catch {
    return false;
  }
}

async function gate() {
  const authenticated = await checkAuth();
  
  if (authenticated) {
    Q('#login').classList.add('hide');
    Q('#main').classList.remove('hide');
    
    await loadData();
    if (state.productId) {
      await loadProductPage();
    } else {
      initDashboard();
    }
  } else {
    Q('#login').classList.remove('hide');
    Q('#main').classList.add('hide');
  }
}

async function loadData() {
  try {
    const [meta, products] = await Promise.all([
      api('/api/meta'),
      api('/api/products')
    ]);
    state.countries = (meta.countries || []).filter(c => c !== 'china');
    state.products = products.products || [];
    fillSelects();
  } catch (e) {
    console.error('Load data error:', e);
  }
}

function fillSelects() {
  // Country selects
  const countrySelects = ['#adCountry', '#mvFrom', '#mvTo', '#rCountry', '#pfCountry', '#pdAdCountry'];
  countrySelects.forEach(sel => {
    const el = Q(sel);
    if (el) el.innerHTML = state.countries.map(c => `<option value="${c}">${c}</option>`).join('');
  });

  // Product selects
  const productSelects = ['#adProduct', '#mvProduct', '#rProduct'];
  const activeProducts = state.products.filter(p => p.status !== 'paused');
  productSelects.forEach(sel => {
    const el = Q(sel);
    if (el) el.innerHTML = activeProducts.map(p => 
      `<option value="${p.id}">${p.name}${p.sku ? ` (${p.sku})` : ''}</option>`
    ).join('');
  });
}

// Login handler
Q('#loginBtn')?.addEventListener('click', async () => {
  const password = Q('#pw').value;
  if (!password) return alert('Enter password');
  
  try {
    await api('/api/auth', { 
      method: 'POST', 
      body: JSON.stringify({ password }) 
    });
    await gate();
  } catch {
    alert('Wrong password');
  }
});

Q('#logoutLink')?.addEventListener('click', async (e) => {
  e.preventDefault();
  try {
    await api('/api/auth', { 
      method: 'POST', 
      body: JSON.stringify({ password: 'logout' }) 
    });
  } catch {}
  location.reload();
});

// Navigation
function initNav() {
  QA('.nav a[data-view]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const view = a.dataset.view;
      
      // Hide all sections
      QA('#home, #products, #performance, #finance, #settings').forEach(el => {
        el.classList.add('hide');
      });
      
      // Show selected section
      Q(`#${view}`).classList.remove('hide');
      
      // Update active nav
      QA('.nav a').forEach(nav => nav.classList.remove('active'));
      a.classList.add('active');
      
      // Initialize section if needed
      if (view === 'home') initDashboard();
      if (view === 'products') initProducts();
      if (view === 'performance') initPerformance();
      if (view === 'finance') initFinance();
      if (view === 'settings') initSettings();
    });
  });
}

// Dashboard
function initDashboard() {
  renderKpis();
  renderStockAdSpend();
  initAdSpend();
  initMovements();
  renderTransit();
}

async function renderKpis() {
  Q('#kpiProducts').textContent = state.products.filter(p => p.status !== 'paused').length;
  Q('#kpiCountries').textContent = state.countries.length;
  
  try {
    const [shipments, adspend, deliveries] = await Promise.all([
      api('/api/shipments'),
      api('/api/adspend'),
      api('/api/deliveries')
    ]);
    
    Q('#kpiTransit').textContent = (shipments.shipments || []).filter(s => !s.arrivedAt).length;
    
    const totalAdSpend = (adspend.adSpends || []).reduce((sum, a) => sum + (a.amount || 0), 0);
    Q('#kpiAdSpend').textContent = fmt(totalAdSpend) + ' USD';
    
    const weeklyTotal = (deliveries.deliveries || [])
      .filter(d => d.country !== 'china')
      .reduce((sum, d) => sum + (d.delivered || 0), 0);
    Q('#kpiDelivered').textContent = fmt(weeklyTotal);
  } catch (e) {
    console.error('KPI error:', e);
  }
}

async function renderStockAdSpend() {
  const body = Q('#stockByCountryBody');
  if (!body) return;
  
  const perCountry = {};
  state.countries.forEach(c => perCountry[c] = { stock: 0, ad: 0 });
  
  try {
    const [shipments, remittances, adspend] = await Promise.all([
      api('/api/shipments'),
      api('/api/remittances'),
      api('/api/adspend')
    ]);
    
    // Calculate stock from shipments
    (shipments.shipments || []).forEach(s => {
      if (s.arrivedAt) {
        if (s.toCountry !== 'china') perCountry[s.toCountry].stock += (s.qty || 0);
        if (s.fromCountry !== 'china') perCountry[s.fromCountry].stock -= (s.qty || 0);
      }
    });
    
    // Subtract sales
    (remittances.remittances || []).forEach(r => {
      if (r.country !== 'china') perCountry[r.country].stock -= (r.pieces || 0);
    });
    
    // Add ad spend
    (adspend.adSpends || []).forEach(a => {
      if (a.country !== 'china') perCountry[a.country].ad += (a.amount || 0);
    });
    
    let totalStock = 0, totalAd = 0;
    body.innerHTML = Object.entries(perCountry).map(([country, data]) => {
      totalStock += data.stock;
      totalAd += data.ad;
      return `<tr><td>${country}</td><td>${fmt(data.stock)}</td><td>${fmt(data.ad)}</td></tr>`;
    }).join('');
    
    Q('#stockTotal').textContent = fmt(totalStock);
    Q('#adTotal').textContent = fmt(totalAd);
  } catch (e) {
    console.error('Stock/Ad error:', e);
  }
}

function initAdSpend() {
  Q('#adSave')?.addEventListener('click', async () => {
    const payload = {
      productId: Q('#adProduct').value,
      country: Q('#adCountry').value,
      platform: Q('#adPlatform').value,
      amount: +Q('#adAmount').value || 0
    };
    
    if (!payload.productId || !payload.country || !payload.platform) {
      return alert('Fill all fields');
    }
    
    try {
      await api('/api/adspend', { method: 'POST', body: JSON.stringify(payload) });
      alert('Saved');
      Q('#adAmount').value = '';
      renderKpis();
      renderStockAdSpend();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  });
}

function initMovements() {
  Q('#mvAdd')?.addEventListener('click', async () => {
    const payload = {
      productId: Q('#mvProduct').value,
      fromCountry: Q('#mvFrom').value,
      toCountry: Q('#mvTo').value,
      qty: +Q('#mvQty').value || 0,
      shipCost: +Q('#mvShip').value || 0,
      departedAt: todayISO()
    };
    
    if (!payload.productId) return alert('Select product');
    
    try {
      await api('/api/shipments', { method: 'POST', body: JSON.stringify(payload) });
      alert('Movement added');
      Q('#mvQty').value = '';
      Q('#mvShip').value = '';
      renderTransit();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  });
}

async function renderTransit() {
  try {
    const shipments = await api('/api/shipments');
    const transit = (shipments.shipments || []).filter(s => !s.arrivedAt);
    const productsMap = Object.fromEntries(state.products.map(p => [p.id, p]));
    
    const chinaKenya = transit.filter(s => 
      s.fromCountry === 'china' && s.toCountry === 'kenya'
    );
    const intercountry = transit.filter(s => 
      !(s.fromCountry === 'china' && s.toCountry === 'kenya')
    );
    
    const ckBody = Q('#shipCKBody');
    const icBody = Q('#shipICBody');
    
    if (ckBody) {
      ckBody.innerHTML = chinaKenya.map(s => `
        <tr>
          <td>${productsMap[s.productId]?.name || s.productId}</td>
          <td>${fmt(s.qty)}</td>
          <td>${s.departedAt}</td>
          <td>
            <button class="btn outline" onclick="markArrived('${s.id}')">Arrived</button>
            <button class="btn outline" onclick="deleteShipment('${s.id}')">Delete</button>
          </td>
        </tr>
      `).join('') || '<tr><td colspan="4" class="muted">No transit</td></tr>';
    }
    
    if (icBody) {
      icBody.innerHTML = intercountry.map(s => `
        <tr>
          <td>${productsMap[s.productId]?.name || s.productId}</td>
          <td>${s.fromCountry} → ${s.toCountry}</td>
          <td>${fmt(s.qty)}</td>
          <td>
            <button class="btn outline" onclick="markArrived('${s.id}')">Arrived</button>
            <button class="btn outline" onclick="deleteShipment('${s.id}')">Delete</button>
          </td>
        </tr>
      `).join('') || '<tr><td colspan="4" class="muted">No transit</td></tr>';
    }
  } catch (e) {
    console.error('Transit error:', e);
  }
}

async function markArrived(shipmentId) {
  const date = prompt('Arrival date (YYYY-MM-DD):', todayISO());
  if (!date) return;
  
  try {
    await api(`/api/shipments/${shipmentId}`, {
      method: 'PUT',
      body: JSON.stringify({ arrivedAt: date })
    });
    renderTransit();
    renderStockAdSpend();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function deleteShipment(shipmentId) {
  if (!confirm('Delete shipment?')) return;
  
  try {
    await api(`/api/shipments/${shipmentId}`, { method: 'DELETE' });
    renderTransit();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

// Products management
function initProducts() {
  renderProductsTable();
  
  Q('#pAdd')?.addEventListener('click', async () => {
    const payload = {
      name: Q('#pName').value.trim(),
      sku: Q('#pSku').value.trim(),
      cost_china: +Q('#pCost').value || 0,
      ship_china_to_kenya: +Q('#pShip').value || 0,
      margin_budget: +Q('#pMB').value || 0
    };
    
    if (!payload.name) return alert('Product name required');
    
    try {
      await api('/api/products', { method: 'POST', body: JSON.stringify(payload) });
      await loadData();
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
}

function renderProductsTable() {
  const tbody = Q('#productsTable tbody');
  if (!tbody) return;
  
  tbody.innerHTML = state.products.map(p => `
    <tr>
      <td>${p.name}</td>
      <td>${p.sku || '-'}</td>
      <td><span class="badge ${p.status === 'paused' ? 'muted' : ''}">${p.status}</span></td>
      <td>
        <a class="btn" href="/product.html?id=${p.id}">Open</a>
        <button class="btn outline" onclick="toggleProduct('${p.id}')">
          ${p.status === 'active' ? 'Pause' : 'Activate'}
        </button>
        <button class="btn outline" onclick="deleteProduct('${p.id}')">Delete</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="4" class="muted">No products</td></tr>';
}

async function toggleProduct(productId) {
  const product = state.products.find(p => p.id === productId);
  const newStatus = product.status === 'active' ? 'paused' : 'active';
  
  try {
    await api(`/api/products/${productId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status: newStatus })
    });
    await loadData();
    renderProductsTable();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function deleteProduct(productId) {
  if (!confirm('Delete this product and all related data?')) return;
  
  try {
    await api(`/api/products/${productId}`, { method: 'DELETE' });
    await loadData();
    renderProductsTable();
    renderStockAdSpend();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

// Performance
function initPerformance() {
  Q('#pfRun')?.addEventListener('click', renderPerformance);
  Q('#rAdd')?.addEventListener('click', addRemittance);
}

async function renderPerformance() {
  const start = Q('#pfStart').value;
  const end = Q('#pfEnd').value;
  const country = Q('#pfCountry').value || '';
  
  const params = new URLSearchParams();
  if (start) params.append('start', start);
  if (end) params.append('end', end);
  if (country) params.append('country', country);
  
  try {
    const remittances = await api('/api/remittances?' + params);
    const productsMap = Object.fromEntries(state.products.map(p => [p.id, p]));
    
    const byProduct = {};
    (remittances.remittances || []).forEach(r => {
      if (r.country === 'china') return;
      const key = r.productId;
      if (!byProduct[key]) {
        byProduct[key] = {
          name: productsMap[r.productId]?.name || r.productId,
          country: r.country,
          pieces: 0,
          profit: 0
        };
      }
      
      const product = productsMap[r.productId];
      const costPerPiece = (product?.cost_china || 0) + (product?.ship_china_to_kenya || 0);
      const profit = (r.revenue || 0) - (r.adSpend || 0) - (costPerPiece * (r.pieces || 0)) - ((r.extraPerPiece || 0) * (r.pieces || 0));
      
      byProduct[key].pieces += (r.pieces || 0);
      byProduct[key].profit += profit;
    });
    
    const tbody = Q('#pfTable tbody');
    tbody.innerHTML = Object.values(byProduct).map(p => `
      <tr>
        <td>${p.name}</td>
        <td>${p.country}</td>
        <td>${fmt(p.pieces)}</td>
        <td>${fmt(p.profit)}</td>
      </tr>
    `).join('') || '<tr><td colspan="4" class="muted">No data</td></tr>';
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function addRemittance() {
  const payload = {
    start: Q('#rStart').value,
    end: Q('#rEnd').value,
    country: Q('#rCountry').value,
    productId: Q('#rProduct').value,
    pieces: +Q('#rPieces').value || 0,
    revenue: +Q('#rRev').value || 0,
    adSpend: 0,
    extraPerPiece: 0
  };
  
  if (!payload.start || !payload.end || !payload.country || !payload.productId) {
    return alert('Fill all required fields');
  }
  
  try {
    await api('/api/remittances', { method: 'POST', body: JSON.stringify(payload) });
    alert('Remittance added');
    
    // Clear form
    Q('#rStart').value = '';
    Q('#rEnd').value = '';
    Q('#rPieces').value = '';
    Q('#rRev').value = '';
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

// Finance
function initFinance() {
  renderFinance();
  Q('#feAdd')?.addEventListener('click', addFinanceEntry);
  Q('#feRun')?.addEventListener('click', renderFinance);
}

async function renderFinance() {
  const start = Q('#fes')?.value;
  const end = Q('#fee')?.value;
  
  const params = new URLSearchParams();
  if (start) params.append('start', start);
  if (end) params.append('end', end);
  
  try {
    const finance = await api('/api/finance/entries?' + params);
    
    Q('#feRunning').textContent = fmt(finance.running || 0) + ' USD';
    
    const tbody = Q('#feTable tbody');
    tbody.innerHTML = (finance.entries || []).map(entry => `
      <tr>
        <td>${entry.date}</td>
        <td>${entry.type}</td>
        <td>${entry.category}</td>
        <td>${fmt(entry.amount)}</td>
        <td>${entry.note || ''}</td>
      </tr>
    `).join('') || '<tr><td colspan="5" class="muted">No entries</td></tr>';
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function addFinanceEntry() {
  const payload = {
    date: Q('#feDate').value,
    type: Q('#feType').value,
    category: Q('#feCat').value,
    amount: +Q('#feAmt').value || 0,
    note: Q('#feNote').value
  };
  
  if (!payload.date || !payload.type || !payload.category) {
    return alert('Fill date, type and category');
  }
  
  try {
    await api('/api/finance/entries', { method: 'POST', body: JSON.stringify(payload) });
    
    // Clear form
    Q('#feDate').value = '';
    Q('#feCat').value = '';
    Q('#feAmt').value = '';
    Q('#feNote').value = '';
    
    renderFinance();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

// Settings
function initSettings() {
  renderCountries();
  renderSnapshots();
  
  Q('#ctyAdd')?.addEventListener('click', addCountry);
  Q('#snapSave')?.addEventListener('click', createSnapshot);
}

async function renderCountries() {
  try {
    const countries = await api('/api/countries');
    const list = Q('#ctyList');
    list.innerHTML = (countries.countries || []).map(c => `
      <span class="chip">
        ${c}
        ${c !== 'china' ? `<button class="x" onclick="deleteCountry('${c}')">×</button>` : ''}
      </span>
    `).join('') || '<span class="muted">No countries</span>';
  } catch (e) {
    console.error('Countries error:', e);
  }
}

async function addCountry() {
  const name = Q('#cty').value.trim();
  if (!name) return alert('Enter country name');
  
  try {
    await api('/api/countries', { method: 'POST', body: JSON.stringify({ name }) });
    Q('#cty').value = '';
    await loadData();
    renderCountries();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function deleteCountry(name) {
  if (!confirm(`Delete ${name}?`)) return;
  
  try {
    await api(`/api/countries/${encodeURIComponent(name)}`, { method: 'DELETE' });
    await loadData();
    renderCountries();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function renderSnapshots() {
  try {
    const snapshots = await api('/api/snapshots');
    const tbody = Q('#snapList');
    tbody.innerHTML = (snapshots.snapshots || []).map(snap => `
      <tr>
        <td>${snap.name}</td>
        <td>${new Date(snap.createdAt).toLocaleDateString()}</td>
        <td>
          <button class="btn outline" onclick="restoreSnapshot('${snap.file}')">Restore</button>
          <button class="btn outline" onclick="deleteSnapshot('${snap.id}')">Delete</button>
        </td>
      </tr>
    `).join('') || '<tr><td colspan="3" class="muted">No snapshots</td></tr>';
  } catch (e) {
    console.error('Snapshots error:', e);
  }
}

async function createSnapshot() {
  const name = Q('#snapName').value.trim() || `Manual ${new Date().toLocaleString()}`;
  
  try {
    await api('/api/snapshots', { method: 'POST', body: JSON.stringify({ name }) });
    Q('#snapName').value = '';
    renderSnapshots();
    alert('Snapshot created');
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function restoreSnapshot(file) {
  if (!confirm('Restore this snapshot? Current data will be replaced.')) return;
  
  try {
    await api('/api/snapshots/restore', { method: 'POST', body: JSON.stringify({ file }) });
    alert('Snapshot restored - reloading page');
    location.reload();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function deleteSnapshot(id) {
  if (!confirm('Delete this snapshot?')) return;
  
  try {
    await api(`/api/snapshots/${id}`, { method: 'DELETE' });
    renderSnapshots();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

// Product page
async function loadProductPage() {
  await loadData();
  state.product = state.products.find(p => p.id === state.productId);
  
  if (!state.product) {
    alert('Product not found');
    location.href = '/';
    return;
  }
  
  Q('#pdTitle').textContent = state.product.name;
  Q('#pdSku').textContent = state.product.sku ? `SKU: ${state.product.sku}` : '';
  
  initProductPage();
  renderProductData();
}

function initProductPage() {
  Q('#pdAdSave')?.addEventListener('click', async () => {
    const payload = {
      productId: state.product.id,
      country: Q('#pdAdCountry').value,
      platform: Q('#pdAdPlatform').value,
      amount: +Q('#pdAdAmount').value || 0
    };
    
    if (!payload.country || !payload.platform) return alert('Fill all fields');
    
    try {
      await api('/api/adspend', { method: 'POST', body: JSON.stringify(payload) });
      Q('#pdAdAmount').value = '';
      renderProductData();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  });
}

async function renderProductData() {
  await renderProductStockAd();
  await renderProductAdList();
  await renderProductRemittances();
  await renderProductTransit();
}

async function renderProductStockAd() {
  const tbody = Q('#pdStockBody');
  if (!tbody) return;
  
  const perCountry = {};
  state.countries.forEach(c => perCountry[c] = { stock: 0, ad: 0 });
  
  try {
    const [shipments, remittances, adspend] = await Promise.all([
      api('/api/shipments'),
      api('/api/remittances'),
      api('/api/adspend')
    ]);
    
    // Stock from shipments
    (shipments.shipments || [])
      .filter(s => s.productId === state.product.id && s.arrivedAt)
      .forEach(s => {
        if (s.toCountry !== 'china') perCountry[s.toCountry].stock += (s.qty || 0);
        if (s.fromCountry !== 'china') perCountry[s.fromCountry].stock -= (s.qty || 0);
      });
    
    // Subtract sales
    (remittances.remittances || [])
      .filter(r => r.productId === state.product.id)
      .forEach(r => {
        if (r.country !== 'china') perCountry[r.country].stock -= (r.pieces || 0);
      });
    
    // Ad spend
    (adspend.adSpends || [])
      .filter(a => a.productId === state.product.id)
      .forEach(a => {
        if (a.country !== 'china') perCountry[a.country].ad += (a.amount || 0);
      });
    
    let totalStock = 0, totalAd = 0;
    tbody.innerHTML = Object.entries(perCountry).map(([country, data]) => {
      totalStock += data.stock;
      totalAd += data.ad;
      return `<tr><td>${country}</td><td>${fmt(data.stock)}</td><td>${fmt(data.ad)}</td></tr>`;
    }).join('');
    
    Q('#pdStockTotal').textContent = fmt(totalStock);
    Q('#pdAdTotal').textContent = fmt(totalAd);
    
    // Transit badge
    const transit = (shipments.shipments || [])
      .filter(s => s.productId === state.product.id && !s.arrivedAt)
      .reduce((sum, s) => sum + (s.qty || 0), 0);
    Q('#pdTransitBadge').textContent = `Transit: ${fmt(transit)}`;
  } catch (e) {
    console.error('Product stock error:', e);
  }
}

async function renderProductAdList() {
  const tbody = Q('#pdAdBody');
  if (!tbody) return;
  
  try {
    const adspend = await api('/api/adspend');
    const list = (adspend.adSpends || [])
      .filter(a => a.productId === state.product.id && a.country !== 'china');
    
    tbody.innerHTML = list.map(a => `
      <tr><td>${a.country}</td><td>${a.platform}</td><td>${fmt(a.amount)}</td></tr>
    `).join('') || '<tr><td colspan="3" class="muted">No ad spend</td></tr>';
  } catch (e) {
    console.error('Product ad list error:', e);
  }
}

async function renderProductRemittances() {
  const tbody = Q('#pdRBody');
  if (!tbody) return;
  
  try {
    const remittances = await api('/api/remittances');
    const list = (remittances.remittances || [])
      .filter(r => r.productId === state.product.id && r.country !== 'china');
    
    let totalRevenue = 0, totalProfit = 0;
    tbody.innerHTML = list.map(r => {
      const costPerPiece = state.product.cost_china + state.product.ship_china_to_kenya;
      const profit = (r.revenue || 0) - (r.adSpend || 0) - (costPerPiece * (r.pieces || 0)) - ((r.extraPerPiece || 0) * (r.pieces || 0));
      
      totalRevenue += (r.revenue || 0);
      totalProfit += profit;
      
      return `
        <tr>
          <td>${r.start} → ${r.end}</td>
          <td>${r.country}</td>
          <td>${fmt(r.pieces)}</td>
          <td>${fmt(r.revenue)}</td>
          <td>${fmt(profit)}</td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="5" class="muted">No remittances</td></tr>';
    
    Q('#pdRRevT').textContent = fmt(totalRevenue);
    Q('#pdRProfitT').textContent = fmt(totalProfit);
  } catch (e) {
    console.error('Product remittances error:', e);
  }
}

async function renderProductTransit() {
  const tbody = Q('#pdShipBody');
  if (!tbody) return;
  
  try {
    const shipments = await api('/api/shipments');
    const transit = (shipments.shipments || [])
      .filter(s => s.productId === state.product.id && !s.arrivedAt);
    
    tbody.innerHTML = transit.map(s => `
      <tr>
        <td>${s.fromCountry} → ${s.toCountry}</td>
        <td>${fmt(s.qty)}</td>
        <td>In transit</td>
        <td>
          <button class="btn outline" onclick="markArrived('${s.id}')">Arrived</button>
          <button class="btn outline" onclick="deleteShipment('${s.id}')">Delete</button>
        </td>
      </tr>
    `).join('') || '<tr><td colspan="4" class="muted">No transit</td></tr>';
  } catch (e) {
    console.error('Product transit error:', e);
  }
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  initNav();
  gate();
});
