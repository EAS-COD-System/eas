/* ================================================================
   EAS Tracker – Frontend (Complete Rebuild)
   Advanced Business Management System
   ================================================================ */

const Q = (s, r = document) => r.querySelector(s);
const QA = (s, r = document) => Array.from(r.querySelectorAll(s));
const fmt = n => (Number(n || 0)).toLocaleString(undefined, { maximumFractionDigits: 2 });
const isoToday = () => new Date().toISOString().slice(0, 10);
const getQuery = k => new URLSearchParams(location.search).get(k);
const safeJSON = v => { try { return JSON.parse(v); } catch { return null; } };

// Enhanced API function with better error handling
async function api(path, opts = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
 
  try {
    const res = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      ...opts
    });
    clearTimeout(timeoutId);
   
    const ct = res.headers.get('content-type') || '';
    const body = ct.includes('application/json') ? await res.json() : await res.text();
   
    if (!res.ok) {
      throw new Error(body?.error || body || `HTTP ${res.status}`);
    }
   
    return body;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// Application state
const state = {
  productId: getQuery('id'),
  countries: [],
  products: [],
  productsActive: [],
  categories: { debit: [], credit: [] },
  productNotes: [],
  productSellingPrices: [],
  brainstorming: [],
  testedProducts: [],
  currentStoreOrdersPage: 1,
  currentRemittancesPage: 1,
  currentRefundsPage: 1,
  allShipments: [],
  currentProductsPage: 1,
  productsSearchTerm: '',
  productsSortBy: 'totalPieces',
  productsSortOrder: 'desc',
  remittanceSortBy: 'totalDeliveredPieces',
  remittanceSortOrder: 'desc',
  profitCountrySortBy: 'totalDeliveredPieces',
  profitCountrySortOrder: 'desc'
};

// Track event listeners to prevent duplicates
const eventListeners = new Map();

// Main boot function
async function boot() {
  console.log('🔐 Checking authentication status...');
 
  // Check authentication first
  try {
    await api('/api/auth/status');
    console.log('✅ User is authenticated');
   
    // Hide login, show main
    const loginEl = document.getElementById('login');
    const mainEl = document.getElementById('main');
   
    if (loginEl) loginEl.classList.add('hide');
    if (mainEl) mainEl.style.display = 'block';
   
    // Load data and initialize app
    await preload();
   
    // Auto-manage product status based on ad spend
    await autoManageProductStatus();
   
    bindGlobalNav();
   
    if (state.productId) {
      renderProductPage();
    } else {
      renderDashboardPage();
      renderProductsPage();
      renderPerformancePage();
      renderStockMovementPage();
      renderAdspendPage();
      renderFinancePage();
      renderSettingsPage();
    }
   
    setupDailyBackupButton();
   
  } catch (error) {
    console.log('❌ User not authenticated, showing login form');
    // Show login, hide main
    const loginEl = document.getElementById('login');
    const mainEl = document.getElementById('main');
   
    if (loginEl) loginEl.classList.remove('hide');
    if (mainEl) mainEl.style.display = 'none';
  }
}

// Event Listeners - FIXED: Prevent multiple bindings
document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 DOM loaded, initializing application...');
 
  // Login handler - FIXED VERSION
  const loginBtn = Q('#loginBtn');
  if (loginBtn && !eventListeners.has('loginBtn')) {
    loginBtn.addEventListener('click', handleLogin);
    eventListeners.set('loginBtn', true);
  }
 
  // Logout handler
  const logoutLink = Q('#logoutLink');
  if (logoutLink && !eventListeners.has('logoutLink')) {
    logoutLink.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await api('/api/auth', {
          method: 'POST',
          body: JSON.stringify({ password: 'logout' })
        });
      } catch { }
      location.reload();
    });
    eventListeners.set('logoutLink', true);
  }

  // Enter key for login
  const pwInput = Q('#pw');
  if (pwInput && !eventListeners.has('pwInput')) {
    pwInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleLogin();
      }
    });
    eventListeners.set('pwInput', true);
  }
});

// Fixed login handler function
async function handleLogin() {
  console.log('🔐 Login attempt...');
  const password = Q('#pw')?.value || '';
 
  if (!password) {
    alert('Please enter password');
    return;
  }
 
  const loginBtn = Q('#loginBtn');
  const originalText = loginBtn.textContent;
 
  try {
    loginBtn.disabled = true;
    loginBtn.textContent = 'Logging in...';
   
    console.log('📡 Sending authentication request...');
    const result = await api('/api/auth', {
      method: 'POST',
      body: JSON.stringify({ password })
    });
   
    console.log('✅ Authentication successful:', result);
   
    // Small delay to ensure cookie is set
    await new Promise(resolve => setTimeout(resolve, 100));
   
    // Reload the application
    await boot();
   
  } catch (e) {
    console.error('❌ Login failed:', e);
    alert('Wrong password or login failed. Please try again.');
    loginBtn.disabled = false;
    loginBtn.textContent = originalText;
  }
}

// Navigation handling
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

  if (!eventListeners.has('scroll')) {
    window.addEventListener('scroll', handleScroll, { passive: true });
    eventListeners.set('scroll', true);
  }

  if (!eventListeners.has('touchstart')) {
    document.addEventListener('touchstart', (e) => {
      if (e.touches[0].clientY < 10) {
        showNav();
      }
    }, { passive: true });
    eventListeners.set('touchstart', true);
  }

  if (window.scrollY === 0) {
    showNav();
  } else {
    hideNav();
  }
}

function bindGlobalNav() {
  const navLinks = QA('nav a[data-view]');
  navLinks.forEach(link => {
    if (!eventListeners.has(`nav-${link.dataset.view}`)) {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const view = link.dataset.view;
       
        // Hide all sections
        QA('#main > .container > section').forEach(section => {
          section.style.display = 'none';
        });
       
        // Show selected section
        const targetSection = Q(`#${view}`);
        if (targetSection) {
          targetSection.style.display = 'block';
        }
       
        // Update active nav link
        navLinks.forEach(navLink => navLink.classList.remove('active'));
        link.classList.add('active');
       
        // Scroll to top
        window.scrollTo(0, 0);
      });
      eventListeners.set(`nav-${link.dataset.view}`, true);
    }
  });
}

// In the preload function, update how we handle products
async function preload() {
  try {
    console.log('📥 Preloading application data...');
    const meta = await api('/api/meta');
    state.countries = (meta.countries || []).filter(country => country !== 'china');

    const pr = await api('/api/products');
    state.products = pr.products || [];
   
    // FIX: Keep all products in productsActive for display, but filter for operations
    state.productsActive = state.products.filter(p => p.status === 'active');
   
    const cats = await api('/api/finance/categories');
    state.categories = cats || { debit: [], credit: [] };

    // Load all shipments for stock calculation
    try {
      const shipments = await api('/api/shipments');
      state.allShipments = shipments.shipments || [];
    } catch (error) {
      state.allShipments = [];
    }

    fillCommonSelects();
    console.log('✅ Preload completed successfully');
  } catch (error) {
    console.error('❌ Preload failed:', error);
    throw error;
  }
}

// Add this function to automatically manage product status based on ad spend
async function autoManageProductStatus() {
  try {
    const adSpends = await api('/api/advertising-costs');
    const products = await api('/api/products');
   
    const productsWithAdSpend = new Set();
   
    // Find all products that have advertising spend
    (adSpends.advertisingCosts || []).forEach(spend => {
      productsWithAdSpend.add(spend.productId);
    });
   
    // Update product statuses
    for (const product of products.products) {
      const hasAdSpend = productsWithAdSpend.has(product.id);
      const shouldBeActive = hasAdSpend;
     
      if (shouldBeActive && product.status === 'paused') {
        // Activate product if it has ad spend but is paused
        await api(`/api/products/${product.id}/status`, {
          method: 'POST',
          body: JSON.stringify({ status: 'active' })
        });
        console.log(`✅ Auto-activated product: ${product.name}`);
      } else if (!shouldBeActive && product.status === 'active') {
        // Pause product if it has no ad spend but is active
        await api(`/api/products/${product.id}/status`, {
          method: 'POST',
          body: JSON.stringify({ status: 'paused' })
        });
        console.log(`⏸️ Auto-paused product: ${product.name}`);
      }
    }
   
    // Reload products data
    await preload();
   
  } catch (error) {
    console.error('Error in auto product status management:', error);
  }
}

// Fill common dropdown selects - FIXED: Include all products (active and paused), sorted by status and name
function fillCommonSelects() {
  const countrySelects = ['#adCostCountry', '#rCountry', '#pdAdCountry', '#pdRCountry',
    '#pdInfCountry', '#pdInfFilterCountry', '#pcCountry', '#remCountry', '#remAddCountry',
    '#topDelCountry', '#remAnalyticsCountry', '#spCountry', '#poCountry', '#pdNoteCountry',
    '#mvFrom', '#mvTo', '#refundCountry', '#pdRefundCountry'];

  countrySelects.forEach(sel => QA(sel).forEach(el => {
    if (!el) return;
    if (sel === '#pcCountry' || sel === '#remCountry' || sel === '#topDelCountry' || sel === '#remAnalyticsCountry') {
      el.innerHTML = `<option value="">All countries</option>` +
        state.countries.map(c => `<option value="${c}">${c}</option>`).join('');
    } else if (sel === '#mvFrom') {
      el.innerHTML = `<option value="">From Country...</option>` +
        `<option value="china">china</option>` +
        state.countries.map(c => `<option value="${c}">${c}</option>`).join('');
    } else if (sel === '#mvTo') {
      el.innerHTML = `<option value="">To Country...</option>` +
        state.countries.map(c => `<option value="${c}">${c}</option>`).join('');
    } else {
      el.innerHTML = `<option value="">Select country...</option>` +
        state.countries.map(c => `<option value="${c}">${c}</option>`).join('');
    }
  }));

  // FIXED: Show ALL products (active and paused) sorted by status (active first) then name (A-Z)
  const allProductInputs = ['#mvProduct', '#adCostProduct', '#rProduct', '#remAddProduct', '#spProduct', '#poProduct', '#refundProduct'];
  allProductInputs.forEach(sel => QA(sel).forEach(el => {
    if (!el) return;
    // Show all products sorted by status (active first) then name (A-Z)
    const allProducts = state.products
      .sort((a, b) => {
        // First sort by status: active first
        if (a.status === 'active' && b.status !== 'active') return -1;
        if (a.status !== 'active' && b.status === 'active') return 1;
        // Then sort by name A-Z
        return a.name.localeCompare(b.name);
      });
   
    el.innerHTML = `<option value="">Select Product...</option>` +
      allProducts.map(p => `<option value="${p.id}">${p.name}${p.sku ? ` (${p.sku})` : ''}${p.status === 'paused' ? ' [PAUSED]' : ''}</option>`).join('');
  }));

  // All products for analytics - FIXED: Sort by status and name
  const allProductsNewestFirst = ['#pcaProduct', '#remAnalyticsProduct', '#productInfoSelect', '#remProduct', '#advertisingCostsFilterProduct'];
  allProductsNewestFirst.forEach(sel => QA(sel).forEach(el => {
    if (!el) return;
    const allProductsSorted = state.products
      .sort((a, b) => {
        // First sort by status: active first
        if (a.status === 'active' && b.status !== 'active') return -1;
        if (a.status !== 'active' && b.status === 'active') return 1;
        // Then sort by name A-Z
        return a.name.localeCompare(b.name);
      });
   
    if (sel === '#pcaProduct' || sel === '#remAnalyticsProduct' || sel === '#advertisingCostsFilterProduct') {
      el.innerHTML = `<option value="all">All products</option>` +
        allProductsSorted.map(p => `<option value="${p.id}">${p.name}${p.sku ? ` (${p.sku})` : ''}${p.status === 'paused' ? ' [PAUSED]' : ''}</option>`).join('');
    } else {
      el.innerHTML = `<option value="all">All products</option>` +
        allProductsSorted.map(p => `<option value="${p.id}">${p.name}${p.sku ? ` (${p.sku})` : ''}${p.status === 'paused' ? ' [PAUSED]' : ''}</option>`).join('');
    }
  }));

  const allCats = [...state.categories.debit, ...state.categories.credit].sort();
  QA('#feCat').forEach(el => {
    if (!el) return;
    el.innerHTML = `<option value="" disabled selected>Select category</option>` +
      allCats.map(c => `<option>${c}</option>`).join('');
  });

  QA('#fcSearchCat').forEach(el => {
    if (!el) return;
    el.innerHTML = `<option value="">All categories</option>` +
      allCats.map(c => `<option>${c}</option>`).join('');
  });
}

// Date range utilities
function calculateDateRange(range) {
  const now = new Date();
  const start = new Date();
 
  switch(range) {
    case '8days':
      start.setDate(now.getDate() - 8);
      break;
    case '15days':
      start.setDate(now.getDate() - 15);
      break;
    case '1month':
      start.setMonth(now.getMonth() - 1);
      break;
    case '2months':
      start.setMonth(now.getMonth() - 2);
      break;
    case '6months':
      start.setMonth(now.getMonth() - 6);
      break;
    case '1year':
      start.setFullYear(now.getFullYear() - 1);
      break;
    case '2years':
      start.setFullYear(now.getFullYear() - 2);
      break;
    case 'lifetime':
      return { start: '2000-01-01', end: '2100-01-01' };
    default:
      return {};
  }
 
  return {
    start: start.toISOString().slice(0, 10),
    end: now.toISOString().slice(0, 10)
  };
}

function initDateRangeSelectors() {
  QA('.date-range-select').forEach(select => {
    const container = select.closest('.row');
    const customRange = container?.querySelector('.custom-range');

    if (!eventListeners.has(select)) {
      select.addEventListener('change', function () {
        if (!customRange) return;
        if (this.value === 'custom') {
          customRange.style.display = 'flex';
        } else {
          customRange.style.display = 'none';
          const dateRange = calculateDateRange(this.value);
          if (dateRange.start && dateRange.end) {
            const startInput = container.querySelector('.custom-start');
            const endInput = container.querySelector('.custom-end');
            if (startInput) startInput.value = dateRange.start;
            if (endInput) endInput.value = dateRange.end;
          }
        }
      });
      eventListeners.set(select, true);
    }
  });
}

function getDateRange(container) {
  if (!container) return { start: '', end: '' };
 
  const select = container.querySelector('.date-range-select');
  const customStart = container.querySelector('.custom-start');
  const customEnd = container.querySelector('.custom-end');

  if (select?.value === 'custom') {
    return {
      start: customStart?.value || '',
      end: customEnd?.value || ''
    };
  }

  const dateRange = calculateDateRange(select?.value || '');
  return {
    start: dateRange.start || '',
    end: dateRange.end || ''
  };
}

// Function to fix advertising cost data for a specific product
async function fixProductAdvertisingCost(productId) {
  try {
    const result = await api('/api/fix-old-advertising-costs', {
      method: 'POST',
      body: JSON.stringify({ productId })
    });
    console.log('Fixed product advertising cost:', result);
    return result;
  } catch (error) {
    console.error('Error fixing product advertising cost:', error);
    throw error;
  }
}

// Update the updateAdvertisingCostDirectly function to handle legacy data
async function updateAdvertisingCostDirectly(productId, country, platform, newAmount) {
  try {
    // First try to fix any legacy data
    await fixProductAdvertisingCost(productId);
   
    const adData = await api('/api/advertising-costs');
    const advertisingCosts = adData.advertisingCosts || [];
   
    // Find entry for today
    const today = isoToday();
    const todayEntry = advertisingCosts.find(ad =>
      ad.productId === productId &&
      ad.country === country &&
      ad.platform === platform &&
      ad.date === today
    );
   
    if (todayEntry) {
      // Update today's entry
      await api(`/api/advertising-costs/${todayEntry.id}`, {
        method: 'PUT',
        body: JSON.stringify({ amount: newAmount })
      });
      console.log(`✅ Updated today's advertising cost: $${newAmount}`);
    } else {
      // Check for legacy entry (no date or old date)
      const legacyEntry = advertisingCosts.find(ad =>
        ad.productId === productId &&
        ad.country === country &&
        ad.platform === platform &&
        (!ad.date || ad.date === '2024-01-01')
      );
     
      if (legacyEntry) {
        // Update legacy entry with today's date
        await api(`/api/advertising-costs/${legacyEntry.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            amount: newAmount,
            date: today
          })
        });
        console.log(`✅ Updated legacy advertising cost for today: $${newAmount}`);
      } else {
        // Create new entry
        await api('/api/advertising-costs', {
          method: 'POST',
          body: JSON.stringify({
            date: today,
            productId: productId,
            country: country,
            platform: platform,
            amount: newAmount
          })
        });
        console.log(`✅ Created new advertising cost entry: $${newAmount}`);
      }
    }
   
    return true;
  } catch (error) {
    console.error('Error updating advertising cost:', error);
    throw error;
  }
}

// ======== DASHBOARD PAGE ========
function renderDashboardPage() {
  renderCompactKpis();
  renderCountryStockSpend();
  bindAdvertisingCost();
  renderWeeklyDelivered();
  initBrainstorming();
  initTodos();
  initWeeklyTodos();
  initTestedProducts();
}

async function renderCompactKpis() {
  Q('#kpiProducts') && (Q('#kpiProducts').textContent = state.products.length);
  Q('#kpiCountries') && (Q('#kpiCountries').textContent = state.countries.length);

  try {
    const stockData = await calculateStockByCountry();
    let activeStock = 0;
    let inactiveStock = 0;
   
    state.countries.forEach(country => {
      activeStock += stockData.activeStock[country] || 0;
      inactiveStock += stockData.inactiveStock[country] || 0;
    });

    const transitData = await calculateTransitPieces();
   
    Q('#kpiChinaTransit') && (Q('#kpiChinaTransit').textContent = transitData.chinaTransit);
    Q('#kpiInterTransit') && (Q('#kpiInterTransit').textContent = transitData.interCountryTransit);
    Q('#kpiActiveStock') && (Q('#kpiActiveStock').textContent = activeStock);
    Q('#kpiInactiveStock') && (Q('#kpiInactiveStock').textContent = inactiveStock);
  } catch {
    Q('#kpiChinaTransit') && (Q('#kpiChinaTransit').textContent = '—');
    Q('#kpiInterTransit') && (Q('#kpiInterTransit').textContent = '—');
    Q('#kpiActiveStock') && (Q('#kpiActiveStock').textContent = '—');
    Q('#kpiInactiveStock') && (Q('#kpiInactiveStock').textContent = '—');
  }

  try {
    const a = await api('/api/advertising-costs');
    const total = (a.advertisingCosts || []).reduce((t, x) => t + (+x.amount || 0), 0);
    Q('#kpiAdSpend') && (Q('#kpiAdSpend').textContent = `${fmt(total)} USD`);
  } catch { Q('#kpiAdSpend') && (Q('#kpiAdSpend').textContent = '—'); }

  const t = Q('#wAllT')?.textContent || '0';
  Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = t);
}

async function calculateTransitPieces() {
  try {
    const shipments = await api('/api/shipments');
    const transitShipments = shipments.shipments.filter(s => !s.arrivedAt);
   
    const chinaTransit = transitShipments
      .filter(s => s.fromCountry === 'china')
      .reduce((sum, s) => sum + (+s.qty || 0), 0);
   
    const interCountryTransit = transitShipments
      .filter(s => s.fromCountry !== 'china')
      .reduce((sum, s) => sum + (+s.qty || 0), 0);

    return {
      chinaTransit,
      interCountryTransit,
      totalTransit: chinaTransit + interCountryTransit
    };
  } catch (error) {
    return { chinaTransit: 0, interCountryTransit: 0, totalTransit: 0 };
  }
}

async function calculateStockByCountry(productId = null) {
  try {
    const db = await api('/api/products');
    if (productId) {
      const product = db.products.find(p => p.id === productId);
      return product ? {
        activeStock: product.status === 'active' ? product.stockByCountry : {},
        inactiveStock: product.status === 'paused' ? product.stockByCountry : {}
      } : { activeStock: {}, inactiveStock: {} };
    } else {
      const activeStock = {};
      const inactiveStock = {};
     
      state.countries.forEach(country => {
        activeStock[country] = 0;
        inactiveStock[country] = 0;
      });
     
      db.products.forEach(product => {
        Object.keys(product.stockByCountry || {}).forEach(country => {
          if (product.status === 'active') {
            activeStock[country] = (activeStock[country] || 0) + (product.stockByCountry[country] || 0);
          } else {
            inactiveStock[country] = (inactiveStock[country] || 0) + (product.stockByCountry[country] || 0);
          }
        });
      });
     
      return { activeStock, inactiveStock };
    }
  } catch (error) {
    return { activeStock: {}, inactiveStock: {} };
  }
}

async function renderCountryStockSpend() {
  const body = Q('#stockByCountryBody');
  if (!body) return;
 
  body.innerHTML = '<tr><td colspan="6">Loading…</td></tr>';

  try {
    const stockData = await calculateStockByCountry();
    const stockByCountry = stockData.activeStock || {};
    const inactiveStockByCountry = stockData.inactiveStock || {};
   
    let st = 0, fb = 0, tt = 0, gg = 0, totalAd = 0;
   
    const advertisingCosts = await api('/api/advertising-costs');
    const adBreakdown = {};
   
    state.countries.forEach(country => {
      adBreakdown[country] = { facebook: 0, tiktok: 0, google: 0 };
    });

    (advertisingCosts.advertisingCosts || []).forEach(ad => {
      const product = state.products.find(p => p.id === ad.productId);
      // FIX: Include ALL products for advertising cost calculation
      if (adBreakdown[ad.country]) {
        const amount = +ad.amount || 0;
        if (ad.platform === 'facebook') adBreakdown[ad.country].facebook += amount;
        else if (ad.platform === 'tiktok') adBreakdown[ad.country].tiktok += amount;
        else if (ad.platform === 'google') adBreakdown[ad.country].google += amount;
      }
    });

    const rows = state.countries.map(country => {
      const stock = stockByCountry[country] || 0;
      const adData = adBreakdown[country] || { facebook: 0, tiktok: 0, google: 0 };
      const countryAdTotal = adData.facebook + adData.tiktok + adData.google;

      st += stock;
      fb += adData.facebook;
      tt += adData.tiktok;
      gg += adData.google;
      totalAd += countryAdTotal;

      return `
        <tr>
          <td>${country}</td>
          <td>${fmt(stock)}</td>
          <td>${fmt(adData.facebook)}</td>
          <td>${fmt(adData.tiktok)}</td>
          <td>${fmt(adData.google)}</td>
          <td>${fmt(countryAdTotal)}</td>
        </tr>
      `;
    }).join('');

    body.innerHTML = rows || `<tr><td colspan="6" class="muted">No data</td></tr>`;
    Q('#stockTotal') && (Q('#stockTotal').textContent = fmt(st));
    Q('#fbTotal') && (Q('#fbTotal').textContent = fmt(fb));
    Q('#ttTotal') && (Q('#ttTotal').textContent = fmt(tt));
    Q('#ggTotal') && (Q('#ggTotal').textContent = fmt(gg));
    Q('#adTotal') && (Q('#adTotal').textContent = fmt(totalAd));
  } catch (error) {
    body.innerHTML = `<tr><td colspan="6" class="muted">Error loading data</td></tr>`;
  }
}

function bindAdvertisingCost() {
  const btn = Q('#adCostSave');
  if (!btn) return;
 
  if (!eventListeners.has('adCostSave')) {
    btn.onclick = async () => {
      const payload = {
        date: isoToday(),
        productId: Q('#adCostProduct')?.value,
        country: Q('#adCostCountry')?.value,
        platform: Q('#adCostPlatform')?.value,
        amount: +Q('#adCostAmount')?.value || 0
      };
     
      if (!payload.productId || !payload.country || !payload.platform) {
        return alert('Please fill all fields');
      }
     
      try {
        await api('/api/advertising-costs', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        await renderCountryStockSpend();
        await renderCompactKpis();
        alert(`✅ Advertising cost ${payload.amount ? 'saved' : 'removed'} for today!`);
        Q('#adCostAmount').value = '';
      } catch (e) {
        alert('Error: ' + e.message);
      }
    };
    eventListeners.set('adCostSave', true);
  }
}

// Weekly delivered tracking
function mondayOf(dateISO) {
  const d = new Date(dateISO);
  const k = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - k);
  return d;
}

function weekDays(fromMonDate) {
  return [...Array(7)].map((_, i) => {
    const t = new Date(fromMonDate);
    t.setDate(t.getDate() + i);
    return t.toISOString().slice(0, 10);
  });
}

function renderWeeklyDelivered() {
  const head = Q('#weeklyHead'), body = Q('#weeklyBody'), rangeLbl = Q('#weeklyRange');
  if (!head || !body) return;

  let anchor = isoToday();
  const updateGrid = async () => {
    const mon = mondayOf(anchor);
    const days = weekDays(mon);
    rangeLbl && (rangeLbl.textContent = `Week: ${days[0]} → ${days[6]}`);

    head.innerHTML = `<tr><th>Country</th>${days.map(d => {
      const lab = new Date(d).toLocaleDateString(undefined, { weekday: 'short' });
      return `<th>${lab}<br>${d}</th>`;
    }).join('')}<th>Total</th></tr>`;

    body.innerHTML = state.countries.map(c => {
      const cells = days.map(d => `<td><input type="number" min="0" class="wd-cell" data-country="${c}" data-date="${d}" placeholder="0"/></td>`).join('');
      return `<tr data-row="${c}"><td>${c}</td>${cells}<td class="row-total">0</td></tr>`;
    }).join('');

    try {
      const r = await api('/api/deliveries');
      const map = {};
      (r.deliveries || []).forEach(x => map[`${x.country}|${x.date}`] = +x.delivered || 0);
      QA('.wd-cell').forEach(inp => {
        const k = `${inp.dataset.country}|${inp.dataset.date}`;
        if (map[k] != null) inp.value = map[k];
      });
    } catch { }

    computeWeeklyTotals();
  };

  function computeWeeklyTotals() {
    QA('tr[data-row]').forEach(tr => {
      const t = QA('.wd-cell', tr).reduce((s, el) => s + (+el.value || 0), 0);
      const totalEl = Q('.row-total', tr);
      if (totalEl) totalEl.textContent = fmt(t);
    });

    const cols = QA('thead th', Q('#weeklyTable'))?.length - 2 || 0;
    let grand = 0;
    for (let i = 0; i < cols; i++) {
      let colSum = 0;
      QA('tr[data-row]').forEach(tr => {
        const inp = QA('.wd-cell', tr)[i];
        colSum += (+inp?.value || 0);
      });
      const dayEl = Q(`#w${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i]}T`);
      if (dayEl) dayEl.textContent = fmt(colSum);
      grand += colSum;
    }
    Q('#wAllT') && (Q('#wAllT').textContent = fmt(grand));
    Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = fmt(grand));
  }

  // Add event listeners only once
  if (!eventListeners.has('weeklyPrev')) {
    Q('#weeklyPrev')?.addEventListener('click', () => {
      const d = new Date(anchor);
      d.setDate(d.getDate() - 7);
      anchor = d.toISOString().slice(0, 10);
      updateGrid();
    });
    eventListeners.set('weeklyPrev', true);
  }
 
  if (!eventListeners.has('weeklyNext')) {
    Q('#weeklyNext')?.addEventListener('click', () => {
      const d = new Date(anchor);
      d.setDate(d.getDate() + 7);
      anchor = d.toISOString().slice(0, 10);
      updateGrid();
    });
    eventListeners.set('weeklyNext', true);
  }
 
  if (!eventListeners.has('weeklyReset')) {
    Q('#weeklyReset')?.addEventListener('click', () => {
      QA('.wd-cell').forEach(el => el.value = '');
      computeWeeklyTotals();
    });
    eventListeners.set('weeklyReset', true);
  }
 
  if (!eventListeners.has('weeklyTable')) {
    Q('#weeklyTable')?.addEventListener('input', (e) => {
      if (e.target.classList.contains('wd-cell')) computeWeeklyTotals();
    });
    eventListeners.set('weeklyTable', true);
  }
 
  if (!eventListeners.has('weeklySave')) {
    let isSaving = false;
    Q('#weeklySave')?.addEventListener('click', async () => {
      if (isSaving) return;
      isSaving = true;
     
      const payload = [];
      QA('.wd-cell').forEach(inp => {
        const val = +inp.value || 0;
        if (val > 0) payload.push({
          date: inp.dataset.date,
          country: inp.dataset.country,
          delivered: val
        });
      });
     
      try {
        for (const row of payload) {
          await api('/api/deliveries', {
            method: 'POST',
            body: JSON.stringify(row)
          });
        }
        alert('Weekly deliveries saved successfully!');
      } catch (e) {
        alert('Save failed: ' + e.message);
      } finally {
        isSaving = false;
      }
    });
    eventListeners.set('weeklySave', true);
  }

  updateGrid();
}

// Brainstorming functionality - FIXED: Prevent duplicate event listeners
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
            <div class="idea-card" data-id="${idea.id}">
              <div class="idea-header">
                <strong>${idea.title}</strong>
                <span class="idea-category ${idea.category}">${idea.category}</span>
                <div class="idea-actions">
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

    // Add event listeners only once
    if (!eventListeners.has('brainAdd')) {
      Q('#brainAdd')?.addEventListener('click', addBrainstormingIdea);
      eventListeners.set('brainAdd', true);
    }
   
    // Use event delegation for dynamic elements
    container.removeEventListener('click', handleBrainstormingActions);
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

let isProcessingBrainstorming = false;
  function handleBrainstormingActions(e) {
    if (isProcessingBrainstorming) return;
   
    if (e.target.classList.contains('brain-del')) {
      if (!confirm('Delete this idea?')) return;
     
      const ideaId = e.target.dataset.id;
      isProcessingBrainstorming = true;
      e.target.disabled = true;
     
      api(`/api/brainstorming/${ideaId}`, { method: 'DELETE' })
        .then(() => api('/api/brainstorming'))
        .then(data => {
          state.brainstorming = data.ideas || [];
          renderBrainstorming();
        })
        .catch(alert)
        .finally(() => {
          isProcessingBrainstorming = false;
        });
    }
  }
}

// Todo lists - FIXED: Prevent duplicate event listeners
function initTodos() {
  const listEl = Q('#todoList');
  const addBtn = Q('#todoAdd');
 
  function renderQuick() {
    api('/api/todos').then(data => {
      const arr = data.todos || [];
      listEl.innerHTML = arr.map(t => `<div class="flex">
        <span>${t.done ? '✅ ' : ''}${t.text}</span>
        <button class="btn outline todo-done" data-id="${t.id}">${t.done ? 'Undo' : 'Done'}</button>
        <button class="btn outline todo-delete" data-id="${t.id}">Delete</button>
      </div>`).join('') || '<div class="muted">No tasks</div>';
    }).catch(console.error);
  }
 
  if (!eventListeners.has('todoAdd')) {
    addBtn?.addEventListener('click', () => {
      const v = Q('#todoText')?.value.trim();
      if (!v) return;
     
      addBtn.disabled = true;
     
      api('/api/todos', {
        method: 'POST',
        body: JSON.stringify({ text: v, done: false })
      }).then(() => {
        Q('#todoText').value = '';
        renderQuick();
      }).catch(alert).finally(() => {
        addBtn.disabled = false;
      });
    });
    eventListeners.set('todoAdd', true);
  }
 
  let isProcessing = false;
  if (!eventListeners.has('todoList')) {
    listEl?.addEventListener('click', (e) => {
      if (isProcessing) return;
     
      if (e.target.classList.contains('todo-done')) {
        isProcessing = true;
        e.target.disabled = true;
        api(`/api/todos/${e.target.dataset.id}/toggle`, { method: 'POST' })
          .then(renderQuick)
          .catch(alert)
          .finally(() => {
            isProcessing = false;
          });
      }
      if (e.target.classList.contains('todo-delete')) {
        if (!confirm('Delete this task?')) return;
       
        isProcessing = true;
        e.target.disabled = true;
        api(`/api/todos/${e.target.dataset.id}`, { method: 'DELETE' })
          .then(renderQuick)
          .catch(alert)
          .finally(() => {
            isProcessing = false;
          });
      }
    });
    eventListeners.set('todoList', true);
  }
 
  renderQuick();
}

// Weekly Todo lists - FIXED: Prevent duplicate event listeners
function initWeeklyTodos() {
  const container = Q('#weeklyWrap');
  if (!container) return;

  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
 
  function renderWeeklyTodos() {
    api('/api/weekly-todos').then(data => {
      const weeklyTodos = data.weeklyTodos || {};
     
      container.innerHTML = days.map(day => {
        const dayTodos = weeklyTodos[day] || [];
        return `
          <div class="card">
            <div class="h">${day.charAt(0).toUpperCase() + day.slice(1)}</div>
            <div class="row">
              <input class="input weekly-todo-input" data-day="${day}" placeholder="Add task for ${day}..."/>
              <button class="btn weekly-todo-add" data-day="${day}">Add</button>
            </div>
            <div class="weekly-todo-list" data-day="${day}">
              ${dayTodos.map(todo => `
                <div class="flex">
                  <span>${todo.done ? '✅ ' : ''}${todo.text}</span>
                  <div>
                    <button class="btn outline small weekly-todo-toggle" data-day="${day}" data-id="${todo.id}">
                      ${todo.done ? 'Undo' : 'Done'}
                    </button>
                    <button class="btn outline small weekly-todo-delete" data-day="${day}" data-id="${todo.id}">
                      Delete
                    </button>
                  </div>
                </div>
              `).join('') || '<div class="muted">No tasks for this day</div>'}
            </div>
          </div>
        `;
      }).join('');
     
      // Add event listeners only once per render
      container.removeEventListener('click', handleWeeklyTodoActions);
      container.addEventListener('click', handleWeeklyTodoActions);
     
      QA('.weekly-todo-add').forEach(btn => {
        btn.removeEventListener('click', addWeeklyTodo);
        btn.addEventListener('click', addWeeklyTodo);
      });
     
      QA('.weekly-todo-input').forEach(input => {
        input.removeEventListener('keypress', handleWeeklyTodoEnter);
        input.addEventListener('keypress', handleWeeklyTodoEnter);
      });
    }).catch(console.error);
  }

  function handleWeeklyTodoEnter(e) {
    if (e.key === 'Enter') {
      addWeeklyTodo({ target: e.target.closest('.weekly-todo-add') });
    }
  }

  function addWeeklyTodo(e) {
    const day = e.target.dataset.day;
    const input = Q(`.weekly-todo-input[data-day="${day}"]`);
    const text = input?.value.trim();
   
    if (!text) return;
   
    api('/api/weekly-todos', {
      method: 'POST',
      body: JSON.stringify({ day, text })
    }).then(() => {
      input.value = '';
      renderWeeklyTodos();
    }).catch(alert);
  }

  let isProcessingWeekly = false;
  function handleWeeklyTodoActions(e) {
    if (isProcessingWeekly) return;
   
    if (e.target.classList.contains('weekly-todo-toggle')) {
      isProcessingWeekly = true;
      const { day, id } = e.target.dataset;
      e.target.disabled = true;
     
      api(`/api/weekly-todos/${day}/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ done: true })
      }).then(renderWeeklyTodos)
        .catch(alert)
        .finally(() => {
          isProcessingWeekly = false;
        });
    }
   
    if (e.target.classList.contains('weekly-todo-delete')) {
      if (!confirm('Delete this task?')) return;
     
      isProcessingWeekly = true;
      const { day, id } = e.target.dataset;
      e.target.disabled = true;
     
      api(`/api/weekly-todos/${day}/${id}`, {
        method: 'DELETE'
      }).then(renderWeeklyTodos)
        .catch(alert)
        .finally(() => {
          isProcessingWeekly = false;
        });
    }
  }
 
  renderWeeklyTodos();
}

// Tested products - FIXED: Prevent duplicate event listeners
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

    if (!eventListeners.has('testAdd')) {
      Q('#testAdd')?.addEventListener('click', addTestedProduct);
      eventListeners.set('testAdd', true);
    }
   
    container.removeEventListener('click', handleTestedProductActions);
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
     
      const productId = e.target.dataset.id;
      e.target.disabled = true;
     
      api(`/api/tested-products/${productId}`, { method: 'DELETE' })
        .then(() => api('/api/tested-products'))
        .then(data => {
          state.testedProducts = data.testedProducts || [];
          renderTestedProducts();
        })
        .catch(alert);
    }
  }
}

// ======== PRODUCTS PAGE ========
function renderProductsPage() {
  try {
    renderCompactCountryStats();
    renderAdvertisingOverview();
    initDateRangeSelectors();

    if (state.products && state.products.length > 0) {
      state.currentProductsPage = 1;
      state.productsSearchTerm = '';
      initProductSearch();
      renderProductsTable();
    } else {
      const tb = Q('#productsTable tbody');
      if (tb) {
        tb.innerHTML = '<tr><td colspan="20" class="muted">No products found. Add your first product above.</td></tr>';
      }
    }

    // Add product button - FIXED: Prevent multiple listeners
    if (!eventListeners.has('pAdd')) {
      Q('#pAdd')?.addEventListener('click', async () => {
        const p = {
          name: Q('#pName')?.value.trim(),
          sku: Q('#pSku')?.value.trim()
        };
        if (!p.name) return alert('Name required');
       
        const addBtn = Q('#pAdd');
        addBtn.disabled = true;
        addBtn.textContent = 'Adding...';
       
        try {
          await api('/api/products', { method: 'POST', body: JSON.stringify(p) });
         
          await preload();
         
          Q('#pName').value = '';
          Q('#pSku').value = '';
         
          renderProductsTable();
          renderCompactCountryStats();
          renderAdvertisingOverview();
         
          fillCommonSelects();
         
          alert('Product added successfully!');
        } catch (error) {
          alert('Error adding product: ' + error.message);
        } finally {
          addBtn.disabled = false;
          addBtn.textContent = '🚀 Add Product';
        }
      });
      eventListeners.set('pAdd', true);
    }

    // Selling price button
    if (!eventListeners.has('spSave')) {
      Q('#spSave')?.addEventListener('click', async () => {
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
        alert('Selling price saved successfully!');
      });
      eventListeners.set('spSave', true);
    }

    renderProductInfoSection();
  } catch (error) {
    console.error('Error in renderProductsPage:', error);
  }
}

function initProductSearch() {
  try {
    const searchInput = Q('#productSearch');
    const clearBtn = Q('#clearSearch');
   
    if (!searchInput) return;

    // Add country filter dropdown
    const searchCard = Q('#productSearch').closest('.card');
    if (searchCard && !Q('#productsCountryFilter')) {
      const filterRow = document.createElement('div');
      filterRow.className = 'row wrap';
      filterRow.style.marginTop = '10px';
      filterRow.innerHTML = `
        <select id="productsCountryFilter" class="input">
          <option value="all">All Countries</option>
          ${state.countries.map(c => `<option value="${c}">${c}</option>`).join('')}
        </select>
        <select id="productsSortBy" class="input">
          <option value="totalPieces">Most Pieces</option>
          <option value="name">Name</option>
          <option value="status">Status</option>
          <option value="totalStock">Total Stock</option>
          <option value="countryStock">Country Stock</option>
        </select>
        <button id="applyFilters" class="btn">Apply Filters</button>
      `;
      searchCard.appendChild(filterRow);
     
      if (!eventListeners.has('applyFilters')) {
        Q('#applyFilters').addEventListener('click', () => {
          state.productsSortBy = Q('#productsSortBy').value;
          state.currentProductsPage = 1;
          renderProductsTable();
        });
        eventListeners.set('applyFilters', true);
      }
     
      if (!eventListeners.has('productsCountryFilter')) {
        Q('#productsCountryFilter').addEventListener('change', () => {
          state.currentProductsPage = 1;
          renderProductsTable();
        });
        eventListeners.set('productsCountryFilter', true);
      }
    }

    let searchTimeout;
    if (!eventListeners.has('productSearch')) {
      searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          state.productsSearchTerm = e.target.value.toLowerCase().trim();
          state.currentProductsPage = 1;
          renderProductsTable();
        }, 300);
      });
      eventListeners.set('productSearch', true);
    }

    if (!eventListeners.has('clearSearch')) {
      clearBtn?.addEventListener('click', () => {
        searchInput.value = '';
        state.productsSearchTerm = '';
        state.currentProductsPage = 1;
        renderProductsTable();
      });
      eventListeners.set('clearSearch', true);
    }

    if (!eventListeners.has('productSearchEnter')) {
      searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          state.productsSearchTerm = e.target.value.toLowerCase().trim();
          state.currentProductsPage = 1;
          renderProductsTable();
        }
      });
      eventListeners.set('productSearchEnter', true);
    }
  } catch (error) {
    console.error('Error in initProductSearch:', error);
  }
}

function filterProducts(products, searchTerm) {
  if (!products || !Array.isArray(products)) return [];
  if (!searchTerm) return products;
 
  return products.filter(product =>
    product && product.name && product.name.toLowerCase().includes(searchTerm) ||
    (product.sku && product.sku.toLowerCase().includes(searchTerm))
  );
}

function sortProducts(products, sortBy, countryFilter = 'all') {
  if (!products || !Array.isArray(products)) return products;
 
  let filteredProducts = [...products];
 
  // Apply country filter
  if (countryFilter !== 'all') {
    filteredProducts = filteredProducts.filter(product =>
      product.stockByCountry && product.stockByCountry[countryFilter] > 0
    );
  }
 
  // FIXED: Sort active products first, then by the selected criteria
  filteredProducts.sort((a, b) => {
    // First, sort by status (active first)
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (a.status !== 'active' && b.status === 'active') return 1;
   
    // Then sort by the selected criteria
    let aValue, bValue;
   
    switch(sortBy) {
      case 'name':
        aValue = a.name || '';
        bValue = b.name || '';
        return aValue.localeCompare(bValue);
       
      case 'status':
        aValue = a.status || '';
        bValue = b.status || '';
        return aValue.localeCompare(bValue);
       
      case 'totalStock':
        aValue = a.totalStock || 0;
        bValue = b.totalStock || 0;
        return bValue - aValue;
       
      case 'countryStock':
        if (countryFilter !== 'all') {
          aValue = a.stockByCountry?.[countryFilter] || 0;
          bValue = b.stockByCountry?.[countryFilter] || 0;
          return bValue - aValue;
        }
        // Fall through to totalPieces if no country selected
      case 'totalPieces':
      default:
        aValue = a.totalPiecesIncludingTransit || 0;
        bValue = b.totalPiecesIncludingTransit || 0;
        return bValue - aValue;
    }
  });
 
  return filteredProducts;
}

function renderProductsTable() {
  try {
    const tb = Q('#productsTable tbody');
    const thead = Q('#productsTable thead tr');
    const searchInfo = Q('#searchResultsInfo');
    if (!tb || !thead) return;

    if (!state.products || !Array.isArray(state.products)) {
      tb.innerHTML = '<tr><td colspan="20" class="muted">Loading products...</td></tr>';
      return;
    }

    // Filter and sort products - include ALL products (active and paused)
    const filteredProducts = filterProducts(state.products, state.productsSearchTerm);
    const countryFilter = Q('#productsCountryFilter')?.value || 'all';
    const sortedProducts = sortProducts(filteredProducts, state.productsSortBy, countryFilter);
   
    // Update search results info
    if (searchInfo) {
      let infoText = `Showing ${sortedProducts.length} products`;
      if (state.productsSearchTerm) {
        infoText += ` matching "${state.productsSearchTerm}"`;
      }
      if (countryFilter !== 'all') {
        infoText += ` in ${countryFilter}`;
      }
      if (state.productsSortBy === 'totalPieces') {
        infoText += ` (sorted by most pieces)`;
      } else if (state.productsSortBy === 'totalStock') {
        infoText += ` (sorted by most stock)`;
      } else if (state.productsSortBy === 'countryStock' && countryFilter !== 'all') {
        infoText += ` (sorted by most stock in ${countryFilter})`;
      }
      searchInfo.textContent = infoText;
    }

    // Pagination
    const productsPerPage = 15;
    const totalPages = Math.ceil(sortedProducts.length / productsPerPage);
    const startIndex = (state.currentProductsPage - 1) * productsPerPage;
    const endIndex = startIndex + productsPerPage;
    const paginatedProducts = sortedProducts.slice(startIndex, endIndex);

    // Build table header with colored columns
    const countryColors = {
      'kenya': '#1e3a8a', // Dark blue
      'tanzania': '#7c2d12', // Dark brown
      'uganda': '#166534', // Dark green
      'zambia': '#9d174d', // Dark pink
      'zimbabwe': '#701a75' // Dark purple
    };
   
    let headerHTML = `
      <th>Name</th>
      <th>SKU</th>
      <th>Status</th>
      <th>Total Stock</th>
      <th>Total Transit</th>
      <th>Total Pieces</th>
    `;

    if (state.countries && Array.isArray(state.countries)) {
      state.countries.forEach(country => {
        if (country !== 'china') {
          const color = countryColors[country] || '#374151';
          headerHTML += `<th style="background-color: ${color}; color: white;" class="country-${country}">${country.charAt(0).toUpperCase() + country.slice(1)} Stock</th>`;
          headerHTML += `<th style="background-color: ${color}; color: white;" class="country-${country}">${country.charAt(0).toUpperCase() + country.slice(1)} Ad Cost</th>`;
        }
      });
    }

    headerHTML += `<th>Actions</th>`;
   
    thead.innerHTML = headerHTML;

    // Build table body
    if (paginatedProducts.length === 0) {
      tb.innerHTML = `<tr><td colspan="${6 + (state.countries ? (state.countries.length - 1) * 2 : 0) + 1}" class="muted">No products found</td></tr>`;
    } else {
      tb.innerHTML = paginatedProducts.map(p => {
        if (!p) return '';
       
        let rowClass = '';
        if (!p.hasData) {
          rowClass = 'no-data-row';
        } else if (p.isProfitable) {
          rowClass = 'profit-row';
        } else {
          rowClass = 'loss-row';
        }

        let rowHTML = `
          <tr class="${rowClass}">
            <td>${p.name || 'Unnamed'}</td>
            <td>${p.sku || '-'}</td>
            <td><span class="badge ${p.status === 'paused' ? 'muted' : ''}">${p.status || 'active'}</span></td>
            <td>${fmt(p.totalStock || 0)}</td>
            <td>${fmt(p.transitPieces || 0)}</td>
            <td>${fmt(p.totalPiecesIncludingTransit || 0)}</td>
        `;

        if (state.countries && Array.isArray(state.countries)) {
          state.countries.forEach(country => {
            if (country !== 'china') {
              const stock = p.stockByCountry?.[country] || 0;
              const adCost = p.adCostByCountry?.[country] || 0;
              const color = countryColors[country] || '#374151';
              rowHTML += `
                <td style="background-color: ${color}; color: white;" class="country-${country}">${fmt(stock)}</td>
                <td style="background-color: ${color}; color: white;" class="country-${country}">${fmt(adCost)}</td>
              `;
            }
          });
        }

        rowHTML += `
            <td>
              <a class="btn" href="/product.html?id=${p.id}">Open</a>
              <button class="btn outline act-toggle" data-id="${p.id}">${p.status === 'active' ? 'Pause' : 'Run'}</button>
              <button class="btn outline act-del" data-id="${p.id}">Delete</button>
            </td>
          </tr>
        `;

        return rowHTML;
      }).join('');
    }

    // Render pagination
    renderProductsPagination(sortedProducts.length, productsPerPage);

    // Add event listeners for product actions with confirmation - FIXED: Use event delegation
    tb.removeEventListener('click', handleProductActions);
    tb.addEventListener('click', handleProductActions);
  } catch (error) {
    console.error('Error in renderProductsTable:', error);
    const tb = Q('#productsTable tbody');
    if (tb) {
      tb.innerHTML = '<tr><td colspan="20" class="muted">Error loading products</td></tr>';
    }
  }
}

let isProcessingProduct = false;
async function handleProductActions(e) {
  if (isProcessingProduct) return;
 
  const id = e.target.dataset?.id;
  if (!id) return;
 
  if (e.target.classList.contains('act-toggle')) {
    const p = state.products.find(x => x.id === id);
    if (!p) return;
   
    const newStatus = p.status === 'active' ? 'paused' : 'active';
    const action = p.status === 'active' ? 'pause' : 'activate';
   
    if (p.status === 'active') {
      if (!confirm(`Are you sure you want to pause "${p.name}"? The stock will be moved to inactive stock.`)) {
        return;
      }
    } else {
      if (!confirm(`Are you sure you want to activate "${p.name}"?`)) {
        return;
      }
    }
   
    isProcessingProduct = true;
    e.target.disabled = true;
   
    await api(`/api/products/${id}/status`, { method: 'POST', body: JSON.stringify({ status: newStatus }) });
    await preload();
    renderProductsTable();
    renderCompactKpis();
    renderCountryStockSpend();
   
    isProcessingProduct = false;
  }
 
  if (e.target.classList.contains('act-del')) {
    const p = state.products.find(x => x.id === id);
    if (!p) return;
   
    if (!confirm(`Are you sure you want to delete "${p.name}" and ALL its data? This action cannot be undone.`)) {
      return;
    }
   
    isProcessingProduct = true;
    e.target.disabled = true;
   
    await api(`/api/products/${id}`, { method: 'DELETE' });
    await preload();
    renderProductsTable();
    renderCompactKpis();
    renderCountryStockSpend();
   
    isProcessingProduct = false;
  }
}

function renderProductsPagination(totalItems, itemsPerPage) {
  try {
    const container = Q('#productsPagination');
    if (!container) return;

    const totalPages = Math.ceil(totalItems / itemsPerPage);
   
    if (totalPages <= 1) {
      container.innerHTML = '';
      return;
    }

    let html = '';

    html += `<button class="pagination-btn" ${state.currentProductsPage <= 1 ? 'disabled' : ''} data-page="${state.currentProductsPage - 1}">◀ Previous</button>`;

    const startPage = Math.max(1, state.currentProductsPage - 2);
    const endPage = Math.min(totalPages, startPage + 4);

    for (let i = startPage; i <= endPage; i++) {
      html += `<button class="pagination-btn ${i === state.currentProductsPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }

    html += `<button class="pagination-btn" ${state.currentProductsPage >= totalPages ? 'disabled' : ''} data-page="${state.currentProductsPage + 1}">Next ▶</button>`;
    html += `<span class="pagination-info">Page ${state.currentProductsPage} of ${totalPages} (${totalItems} products)</span>`;

    container.innerHTML = html;

    container.removeEventListener('click', handleProductsPagination);
    container.addEventListener('click', handleProductsPagination);
  } catch (error) {
    console.error('Error in renderProductsPagination:', error);
  }
}

function handleProductsPagination(e) {
  if (e.target.classList.contains('pagination-btn') && !e.target.disabled) {
    const page = parseInt(e.target.dataset.page);
    state.currentProductsPage = page;
    renderProductsTable();
   
    const table = Q('#productsTable');
    if (table) {
      table.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}

function renderCompactCountryStats() {
  try {
    const container = Q('#countryProductStats');
    if (!container) return;

    api('/api/advertising-costs').then(adData => {
      const advertisingCosts = adData.advertisingCosts || [];
      const countryStats = {};

      if (state.countries && Array.isArray(state.countries)) {
        state.countries.forEach(country => {
          countryStats[country] = { active: 0, paused: 0, total: 0 };
        });

        if (state.products && Array.isArray(state.products)) {
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
        }

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
      }
    }).catch(console.error);
  } catch (error) {
    console.error('Error in renderCompactCountryStats:', error);
  }
}

async function renderAdvertisingOverview() {
  return new Promise((resolve) => {
    try {
      const container = Q('#advertisingOverview');
      if (!container) {
        resolve();
        return;
      }

      container.innerHTML = '<div class="card"><div class="muted">Loading advertising data...</div></div>';

      api('/api/advertising-costs').then(adData => {
        const advertisingCosts = adData.advertisingCosts || [];
       
        return api('/api/products').then(productsData => {
          state.products = productsData.products || [];
          return advertisingCosts;
        });
      }).then(advertisingCosts => {
        const byCountry = {};

        advertisingCosts.forEach(cost => {
          const country = cost.country;
          const productId = cost.productId;
          const platform = cost.platform;
          const amount = +cost.amount || 0;

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
              <div class="product-name">${product ? product.name : productId}${product && product.status === 'paused' ? ' [PAUSED]' : ''}</div>
              <div class="platform-costs">
                <span class="platform-badge ${data.facebook > 0 ? 'active' : ''}" data-platform="facebook" data-country="${country}" data-product="${productId}">Facebook: ${fmt(data.facebook)}</span>
                <span class="platform-badge ${data.tiktok > 0 ? 'active' : ''}" data-platform="tiktok" data-country="${country}" data-product="${productId}">TikTok: ${fmt(data.tiktok)}</span>
                <span class="platform-badge ${data.google > 0 ? 'active' : ''}" data-platform="google" data-country="${country}" data-product="${productId}">Google: ${fmt(data.google)}</span>
                <span class="total-badge">Total: ${fmt(data.total)}</span>
              </div>
            </div>`;
          });

          html += `</div>`;
        });

        container.innerHTML = html || '<div class="card"><div class="muted">No advertising data yet</div></div>';
       
        // Add click handlers for platform badges
        container.removeEventListener('click', handlePlatformClick);
        container.addEventListener('click', handlePlatformClick);
       
        resolve();
      }).catch(error => {
        console.error('Error loading advertising overview:', error);
        container.innerHTML = '<div class="card"><div class="muted">Error loading advertising data</div></div>';
        resolve();
      });
    } catch (error) {
      console.error('Error in renderAdvertisingOverview:', error);
      resolve();
    }
  });
}

function handlePlatformClick(e) {
  if (e.target.classList.contains('platform-badge')) {
    const platform = e.target.dataset.platform;
    const country = e.target.dataset.country;
    const productId = e.target.dataset.product;
   
    const currentAmount = parseFloat(e.target.textContent.split(': ')[1]) || 0;
   
    const newAmount = prompt(`Enter new ${platform} cost for ${country} for TODAY (${isoToday()}):`, currentAmount);
   
    if (newAmount !== null && !isNaN(newAmount)) {
      const amount = parseFloat(newAmount);
     
      if (amount >= 0) {
        // This will update ONLY today's cost for this specific combination
        api('/api/advertising-costs', {
          method: 'POST',
          body: JSON.stringify({
            date: isoToday(), // Always use today's date for updates
            productId: productId,
            country: country,
            platform: platform,
            amount: amount
          })
        }).then(() => {
          // Refresh the advertising overview
          renderAdvertisingOverview();
          renderCountryStockSpend();
          renderCompactKpis();
          alert(`✅ ${platform} cost updated to $${amount} for today!`);
        }).catch(error => {
          alert('Error updating cost: ' + error.message);
        });
      } else {
        alert('Please enter a valid amount');
      }
    }
  }
}

function renderProductInfoResults(productInfo) {
  const container = Q('#productInfoResults');
  if (!container) return;

  const { product, costAnalysis, boxleoPerOrder } = productInfo;

  let html = `
    <div class="product-info-results">
      <div class="product-info-header">
        <h3>${product.name} ${product.sku ? `(${product.sku})` : ''}</h3>
        <div class="product-status ${product.status}">${product.status}</div>
      </div>
     
      <div class="profit-budgets-section">
        <h4>💰 Product Cost Analysis by Country</h4>
        <div class="table-scroll">
          <table class="table">
            <thead>
              <tr>
                <th>Country</th>
                <th>Max Cost Per Lead</th>
                <th>Available for Profit & Ads</th>
                <th>Delivery Rate</th>
                <th>Selling Price</th>
                <th>Product Cost China</th>
                <th>Shipping Cost</th>
                <th>Boxleo/Order</th>
                <th>Total Cost</th>
              </tr>
            </thead>
            <tbody>
  `;

  costAnalysis.forEach(analysis => {
    const boxleoPerOrderValue = analysis.boxleoPerOrder || boxleoPerOrder || 0;
    const totalCost = analysis.productCostChina + analysis.shippingCost + boxleoPerOrderValue;
    const availableForProfitAndAds = analysis.sellingPrice - totalCost;
    const maxCPL = analysis.deliveryRate > 0 ? availableForProfitAndAds * (analysis.deliveryRate / 100) : 0;

    html += `
      <tr>
        <td>${analysis.country}</td>
        <td>$${fmt(maxCPL)}</td>
        <td class="${availableForProfitAndAds >= 0 ? 'number-positive' : 'number-negative'}">$${fmt(availableForProfitAndAds)}</td>
        <td>${fmt(analysis.deliveryRate)}%</td>
        <td>$${fmt(analysis.sellingPrice)}</td>
        <td>$${fmt(analysis.productCostChina)}</td>
        <td>$${fmt(analysis.shippingCost)}</td>
        <td>$${fmt(boxleoPerOrderValue)}</td>
        <td>$${fmt(totalCost)}</td>
      </tr>
    `;
  });

  html += `
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  container.innerHTML = html;
}

function renderProductInfoSection() {
  const btn = Q('#productInfoRun');
  if (!btn) return;

  if (!eventListeners.has('productInfoRun')) {
    btn.onclick = async () => {
      const productId = Q('#productInfoSelect')?.value;
      if (!productId) return alert('Please select a product');

      try {
        const productInfo = await api(`/api/product-info/${productId}`);
        renderProductInfoResults(productInfo);
      } catch (e) {
        alert('Error loading product info: ' + e.message);
      }
    };
    eventListeners.set('productInfoRun', true);
  }
}

// ======== PERFORMANCE PAGE ========
function renderPerformancePage() {
  initDateRangeSelectors();
  bindProductOrders();
  bindProductCostsAnalysis();
  bindRemittanceAnalytics();
  bindProfitByCountry();
  bindRemittanceAdd();
  bindRefundAdd();
 
  setTimeout(() => {
    if (Q('#pcaRun')) Q('#pcaRun').click();
    if (Q('#remAnalyticsRun')) Q('#remAnalyticsRun').click();
    if (Q('#pcRun')) Q('#pcRun').click();
  }, 500);
}

function bindProductOrders() {
  const btn = Q('#poSave');
  if (!btn) return;

  if (!eventListeners.has('poSave')) {
    btn.onclick = async () => {
      const payload = {
        productId: Q('#poProduct')?.value,
        country: Q('#poCountry')?.value,
        startDate: Q('#poStartDate')?.value,
        endDate: Q('#poEndDate')?.value,
        orders: +Q('#poOrders')?.value || 0
      };

      if (!payload.productId || !payload.country || !payload.startDate || !payload.endDate) {
        return alert('Please select product, country, and date range');
      }

      try {
        await api('/api/product-orders', { method: 'POST', body: JSON.stringify(payload) });
        alert('Orders data saved successfully!');
        Q('#poOrders').value = '';
      } catch (e) {
        if (e.message.includes('Duplicate order period')) {
          const confirmAdd = confirm('You already entered orders in that period for that product. Are you sure you want to enter again?');
          if (confirmAdd) {
            await api('/api/product-orders/force', { method: 'POST', body: JSON.stringify(payload) });
            alert('Orders data saved successfully!');
            Q('#poOrders').value = '';
          }
        } else {
          alert('Error saving orders: ' + e.message);
        }
      }
    };
    eventListeners.set('poSave', true);
  }
}

function bindProductCostsAnalysis() {
  const btn = Q('#pcaRun');
  if (!btn) return;

  if (!eventListeners.has('pcaRun')) {
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
    eventListeners.set('pcaRun', true);
  }
}

function renderProductCostsAnalysis(analysis) {
  const container = Q('#pcaResults');
  if (!container) return;

  const profitClass = analysis.profit >= 0 ? 'number-positive' : 'number-negative';
  const bgClass = analysis.profit >= 0 ? 'profit-bg' : 'loss-bg';

  if (analysis.isAggregate) {
    container.innerHTML = `
      <div class="costs-analysis-summary ${bgClass}">
        <div class="summary-header">
          <h3>📊 All Products Costs Analysis Summary</h3>
          <div class="net-profit ${profitClass}">Net Profit: $${fmt(analysis.profit)}</div>
        </div>
        <div class="muted" style="margin-bottom: 15px;">Aggregated data for ${analysis.productCount} products</div>
       
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
                <td><strong>Total Cost</strong></td>
                <td class="number-negative">$${fmt(analysis.totalCost)}</td>
              </tr>
              <tr>
                <td>Refunded Amount</td>
                <td class="number-negative">$${fmt(analysis.totalRefundedAmount)}</td>
                <td>Influencer Spend</td>
                <td>$${fmt(analysis.totalInfluencerSpend)}</td>
              </tr>
              <tr>
                <td>Product Cost China (Period)</td>
                <td>$${fmt(analysis.totalProductChinaCost)}</td>
                <td>Shipping Costs (Period)</td>
                <td>$${fmt(analysis.totalShippingCost)}</td>
              </tr>
              <tr>
                <td>Advertising Cost</td>
                <td>$${fmt(analysis.totalAdSpend)}</td>
                <td>Boxleo Fees</td>
                <td>$${fmt(analysis.totalBoxleoFees)}</td>
              </tr>
              <tr>
                <td><strong>Total Orders</strong></td>
                <td>${fmt(analysis.totalOrders)}</td>
                <td><strong>Delivered Orders</strong></td>
                <td>${fmt(analysis.totalDeliveredOrders)}</td>
              </tr>
              <tr>
                <td><strong>Refunded Orders</strong></td>
                <td>${fmt(analysis.totalRefundedOrders)}</td>
                <td><strong>Delivery Rate</strong></td>
                <td>${fmt(analysis.deliveryRate)}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  } else {
    container.innerHTML = `
      <div class="costs-analysis-summary ${bgClass}">
        <div class="summary-header">
          <h3>📊 Product Costs Analysis Summary</h3>
          <div class="net-profit ${profitClass}">Net Profit: $${fmt(analysis.profit)}</div>
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
                <td><strong>Total Cost</strong></td>
                <td class="number-negative">$${fmt(analysis.totalCost)}</td>
              </tr>
              <tr>
                <td>Refunded Amount</td>
                <td class="number-negative">$${fmt(analysis.totalRefundedAmount)}</td>
                <td>Influencer Spend</td>
                <td>$${fmt(analysis.totalInfluencerSpend)}</td>
              </tr>
              <tr>
                <td>Product Cost China (Period)</td>
                <td>$${fmt(analysis.totalProductChinaCost)}</td>
                <td>Shipping Costs (Period)</td>
                <td>$${fmt(analysis.totalShippingCost)}</td>
              </tr>
              <tr>
                <td>Advertising Cost</td>
                <td>$${fmt(analysis.totalAdSpend)}</td>
                <td>Boxleo Fees</td>
                <td>$${fmt(analysis.totalBoxleoFees)}</td>
              </tr>
              <tr>
                <td><strong>Total Orders</strong></td>
                <td>${fmt(analysis.totalOrders)}</td>
                <td><strong>Delivered Orders</strong></td>
                <td>${fmt(analysis.totalDeliveredOrders)}</td>
              </tr>
              <tr>
                <td><strong>Refunded Orders</strong></td>
                <td>${fmt(analysis.totalRefundedOrders)}</td>
                <td><strong>Delivery Rate</strong></td>
                <td>${fmt(analysis.deliveryRate)}%</td>
              </tr>
              <tr>
                <td><strong>Cost per Delivered Piece</strong></td>
                <td>$${fmt(analysis.costPerDeliveredPiece)}</td>
                <td><strong>Cost per Delivered Order</strong></td>
                <td>$${fmt(analysis.costPerDeliveredOrder)}</td>
              </tr>
              <tr>
                <td><strong>Ad Cost per Delivered Order</strong></td>
                <td>$${fmt(analysis.adCostPerDeliveredOrder)}</td>
                <td><strong>Influencer per Delivered Order</th>
                <td>$${fmt(analysis.influencerPerDeliveredOrder)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
}

function bindRemittanceAnalytics() {
  const btn = Q('#remAnalyticsRun');
  if (!btn) return;

  if (!eventListeners.has('remAnalyticsRun')) {
    btn.onclick = async () => {
      const dateRange = getDateRange(btn.closest('.row'));
      const country = Q('#remAnalyticsCountry')?.value || '';
      const productId = Q('#remAnalyticsProduct')?.value || '';

      try {
        const analytics = await api('/api/analytics/remittance?' + new URLSearchParams({
          ...dateRange,
          country,
          productId,
          sortBy: state.remittanceSortBy,
          sortOrder: state.remittanceSortOrder
        }));

        renderRemittanceAnalytics(analytics.analytics || []);
      } catch (e) {
        alert('Error loading remittance analytics: ' + e.message);
      }
    };
    eventListeners.set('remAnalyticsRun', true);
  }
}

function renderRemittanceAnalytics(analytics) {
  const tb = Q('#remAnalyticsBody');
  if (!tb) return;

  let totalPieces = 0, totalRevenue = 0, totalAdSpend = 0, totalBoxleo = 0;
  let totalProductCost = 0, totalShippingCost = 0, totalProfit = 0, totalOrders = 0;
  let totalDeliveredOrders = 0, totalRefundedOrders = 0, totalRefundedAmount = 0, totalInfluencerSpend = 0;
  let totalBoxleoPerOrder = 0, totalBoxleoPerPiece = 0, totalAdCostPerOrder = 0, totalAdCostPerPiece = 0;
  let totalAOV = 0, totalProfitPerOrder = 0, totalProfitPerPiece = 0;
  let itemCount = 0;

  if (analytics.length === 0) {
    tb.innerHTML = '<tr><td colspan="22" class="muted">No data found for the selected criteria</td></tr>';
    return;
  }

  tb.innerHTML = analytics.map(item => {
    totalPieces += item.totalDeliveredPieces || 0;
    totalRevenue += item.totalRevenue || 0;
    totalAdSpend += item.totalAdSpend || 0;
    totalBoxleo += item.totalBoxleoFees || 0;
    totalProductCost += item.totalProductChinaCost || 0;
    totalShippingCost += item.totalShippingCost || 0;
    totalProfit += item.profit || 0;
    totalOrders += item.totalOrders || 0;
    totalDeliveredOrders += item.totalDeliveredOrders || 0;
    totalRefundedOrders += item.totalRefundedOrders || 0;
    totalRefundedAmount += item.totalRefundedAmount || 0;
    totalInfluencerSpend += item.totalInfluencerSpend || 0;
    totalBoxleoPerOrder += item.boxleoPerDeliveredOrder || 0;
    totalBoxleoPerPiece += item.boxleoPerDeliveredPiece || 0;
    totalAdCostPerOrder += item.adCostPerDeliveredOrder || 0;
    totalAdCostPerPiece += item.adCostPerDeliveredPiece || 0;
    totalAOV += item.averageOrderValue || 0;
    totalProfitPerOrder += item.profitPerOrder || 0;
    totalProfitPerPiece += item.profitPerPiece || 0;
    itemCount++;

    return `
      <tr>
        <td>${item.productName}</td>
        <td>${item.country}</td>
        <td>${fmt(item.totalOrders)}</td>
        <td>${fmt(item.totalDeliveredOrders)}</td>
        <td>${fmt(item.totalRefundedOrders)}</td>
        <td>${fmt(item.totalDeliveredPieces)}</td>
        <td>$${fmt(item.totalRevenue)}</td>
        <td>$${fmt(item.totalRefundedAmount)}</td>
        <td>$${fmt(item.totalAdSpend)}</td>
        <td>$${fmt(item.totalInfluencerSpend)}</td>
        <td>$${fmt(item.totalBoxleoFees)}</td>
        <td>$${fmt(item.totalProductChinaCost)}</td>
        <td>$${fmt(item.totalShippingCost)}</td>
        <td>$${fmt(item.boxleoPerDeliveredOrder)}</td>
        <td>$${fmt(item.boxleoPerDeliveredPiece)}</td>
        <td>$${fmt(item.adCostPerDeliveredOrder)}</td>
        <td>$${fmt(item.adCostPerDeliveredPiece)}</td>
        <td class="${item.profitPerOrder >= 0 ? 'number-positive' : 'number-negative'}">$${fmt(item.profitPerOrder)}</td>
        <td class="${item.profitPerPiece >= 0 ? 'number-positive' : 'number-negative'}">$${fmt(item.profitPerPiece)}</td>
        <td>${fmt(item.deliveryRate)}%</td>
        <td>$${fmt(item.averageOrderValue)}</td>
        <td class="${item.profit >= 0 ? 'number-positive' : 'number-negative'}">$${fmt(item.profit)}</td>
      </tr>
    `;
  }).join('');

  // Update totals
  const updateTotal = (id, value) => {
    const el = Q(id);
    if (el) el.textContent = typeof value === 'number' ? fmt(value) : value;
  };

  updateTotal('#remAnalyticsOrdersT', totalOrders);
  updateTotal('#remAnalyticsDeliveredOrdersT', totalDeliveredOrders);
  updateTotal('#remAnalyticsRefundedOrdersT', totalRefundedOrders);
  updateTotal('#remAnalyticsDeliveredPiecesT', totalPieces);
  updateTotal('#remAnalyticsRevenueT', totalRevenue);
  updateTotal('#remAnalyticsRefundedAmountT', totalRefundedAmount);
  updateTotal('#remAnalyticsAdSpendT', totalAdSpend);
  updateTotal('#remAnalyticsInfluencerSpendT', totalInfluencerSpend);
  updateTotal('#remAnalyticsBoxleoT', totalBoxleo);
  updateTotal('#remAnalyticsProductCostT', totalProductCost);
  updateTotal('#remAnalyticsShippingCostT', totalShippingCost);
  updateTotal('#remAnalyticsBoxleoOrderT', `$${fmt(totalBoxleoPerOrder / itemCount)}`);
  updateTotal('#remAnalyticsBoxleoPieceT', `$${fmt(totalBoxleoPerPiece / itemCount)}`);
  updateTotal('#remAnalyticsAdOrderT', `$${fmt(totalAdCostPerOrder / itemCount)}`);
  updateTotal('#remAnalyticsAdPieceT', `$${fmt(totalAdCostPerPiece / itemCount)}`);
  updateTotal('#remAnalyticsProfitOrderT', `$${fmt(totalProfitPerOrder / itemCount)}`);
  updateTotal('#remAnalyticsProfitPieceT', `$${fmt(totalProfitPerPiece / itemCount)}`);
  updateTotal('#remAnalyticsDeliveryRateT', `${fmt(totalDeliveredOrders / totalOrders * 100)}%`);
  updateTotal('#remAnalyticsAOVT', `$${fmt(totalAOV / itemCount)}`);
  updateTotal('#remAnalyticsProfitT', totalProfit);

  // Add sorting functionality
  addSortingToAnalytics();
}

function addSortingToAnalytics() {
  const headers = QA('.analytics-table th.sortable');
  headers.forEach(header => {
    header.style.cursor = 'pointer';
    if (!eventListeners.has(`analytics-${header.textContent}`)) {
      header.addEventListener('click', function() {
        const sortBy = this.getAttribute('data-sort') || this.textContent.trim().toLowerCase().replace(/\s+/g, '');
       
        // Toggle sort order only if clicking the same column
        if (state.remittanceSortBy === sortBy) {
          state.remittanceSortOrder = state.remittanceSortOrder === 'desc' ? 'asc' : 'desc';
        } else {
          state.remittanceSortBy = sortBy;
          state.remittanceSortOrder = 'desc'; // Default to desc for new column
        }
       
        // Update sort indicators
        headers.forEach(h => {
          h.classList.remove('sort-asc', 'sort-desc');
          const hSort = h.getAttribute('data-sort') || h.textContent.trim().toLowerCase().replace(/\s+/g, '');
          if (hSort === sortBy) {
            h.classList.add(state.remittanceSortOrder === 'asc' ? 'sort-asc' : 'sort-desc');
          }
        });
       
        Q('#remAnalyticsRun').click();
      });
      eventListeners.set(`analytics-${header.textContent}`, true);
    }
  });
 
  // Add data-sort attributes to headers for consistency
  const sortMappings = {
    'Product Name': 'productName',
    'Country': 'country',
    'Orders': 'totalOrders',
    'Delivered Orders': 'totalDeliveredOrders',
    'Refunded Orders': 'totalRefundedOrders',
    'Delivered Pieces': 'totalDeliveredPieces',
    'Revenue': 'totalRevenue',
    'Refunded Amount': 'totalRefundedAmount',
    'Advertising Cost': 'totalAdSpend',
    'Influencer Spend': 'totalInfluencerSpend',
    'Boxleo Fees': 'totalBoxleoFees',
    'Product Cost China': 'totalProductChinaCost',
    'Total Shipping Cost': 'totalShippingCost',
    'Boxleo/Order': 'boxleoPerDeliveredOrder',
    'Boxleo/Piece': 'boxleoPerDeliveredPiece',
    'Ad Cost/Order': 'adCostPerDeliveredOrder',
    'Ad Cost/Piece': 'adCostPerDeliveredPiece',
    'Profit/Order': 'profitPerOrder',
    'Profit/Piece': 'profitPerPiece',
    'Delivery Rate': 'deliveryRate',
    'Avg Order Value': 'averageOrderValue',
    'Profit': 'profit'
  };
 
  headers.forEach(header => {
    const text = header.textContent.trim();
    if (sortMappings[text]) {
      header.setAttribute('data-sort', sortMappings[text]);
    }
  });
}

function bindProfitByCountry() {
  const btn = Q('#pcRun');
  if (!btn) return;

  if (!eventListeners.has('pcRun')) {
    btn.onclick = async () => {
      const dateRange = getDateRange(btn.closest('.row'));
      const country = Q('#pcCountry')?.value || '';

      try {
        const analytics = await api('/api/analytics/profit-by-country?' + new URLSearchParams({
          ...dateRange,
          country,
          sortBy: state.profitCountrySortBy,
          sortOrder: state.profitCountrySortOrder
        }));

        renderProfitByCountry(analytics.analytics || []);
      } catch (e) {
        alert('Error loading profit by country: ' + e.message);
      }
    };
    eventListeners.set('pcRun', true);
  }
}

function renderProfitByCountry(analytics) {
  const tb = Q('#profitCountryBody');
  if (!tb) return;

  let totalPieces = 0, totalRevenue = 0, totalAdSpend = 0, totalBoxleo = 0;
  let totalProductCost = 0, totalShippingCost = 0, totalProfit = 0, totalOrders = 0;
  let totalDeliveredOrders = 0, totalRefundedOrders = 0, totalRefundedAmount = 0, totalInfluencerSpend = 0;
  let totalBoxleoPerOrder = 0, totalBoxleoPerPiece = 0, totalAdCostPerOrder = 0, totalAdCostPerPiece = 0;
  let totalAOV = 0, totalProfitPerOrder = 0, totalProfitPerPiece = 0;
  let itemCount = 0;

  if (analytics.length === 0) {
    tb.innerHTML = '<tr><td colspan="21" class="muted">No data found for the selected criteria</td></tr>';
    return;
  }

  tb.innerHTML = analytics.map(item => {
    totalPieces += item.totalDeliveredPieces || 0;
    totalRevenue += item.totalRevenue || 0;
    totalAdSpend += item.totalAdSpend || 0;
    totalBoxleo += item.totalBoxleoFees || 0;
    totalProductCost += item.totalProductChinaCost || 0;
    totalShippingCost += item.totalShippingCost || 0;
    totalProfit += item.profit || 0;
    totalOrders += item.totalOrders || 0;
    totalDeliveredOrders += item.totalDeliveredOrders || 0;
    totalRefundedOrders += item.totalRefundedOrders || 0;
    totalRefundedAmount += item.totalRefundedAmount || 0;
    totalInfluencerSpend += item.totalInfluencerSpend || 0;
    totalBoxleoPerOrder += item.boxleoPerDeliveredOrder || 0;
    totalBoxleoPerPiece += item.boxleoPerDeliveredPiece || 0;
    totalAdCostPerOrder += item.adCostPerDeliveredOrder || 0;
    totalAdCostPerPiece += item.adCostPerDeliveredPiece || 0;
    totalAOV += item.averageOrderValue || 0;
    totalProfitPerOrder += item.profitPerOrder || 0;
    totalProfitPerPiece += item.profitPerPiece || 0;
    itemCount++;

    return `
      <tr>
        <td>${item.country}</td>
        <td>${fmt(item.totalOrders)}</td>
        <td>${fmt(item.totalDeliveredOrders)}</td>
        <td>${fmt(item.totalRefundedOrders)}</td>
        <td>${fmt(item.totalDeliveredPieces)}</td>
        <td>$${fmt(item.totalRevenue)}</td>
        <td>$${fmt(item.totalRefundedAmount)}</td>
        <td>$${fmt(item.totalAdSpend)}</td>
        <td>$${fmt(item.totalInfluencerSpend)}</td>
        <td>$${fmt(item.totalProductChinaCost)}</td>
        <td>$${fmt(item.totalShippingCost)}</td>
        <td>$${fmt(item.totalBoxleoFees)}</td>
        <td>$${fmt(item.boxleoPerDeliveredOrder)}</td>
        <td>$${fmt(item.boxleoPerDeliveredPiece)}</td>
        <td>$${fmt(item.adCostPerDeliveredOrder)}</td>
        <td>$${fmt(item.adCostPerDeliveredPiece)}</td>
        <td class="${item.profitPerOrder >= 0 ? 'number-positive' : 'number-negative'}">$${fmt(item.profitPerOrder)}</td>
        <td class="${item.profitPerPiece >= 0 ? 'number-positive' : 'number-negative'}">$${fmt(item.profitPerPiece)}</td>
        <td>${fmt(item.deliveryRate)}%</td>
        <td>$${fmt(item.averageOrderValue)}</td>
        <td class="${item.profit >= 0 ? 'number-positive' : 'number-negative'}">$${fmt(item.profit)}</td>
      </tr>
    `;
  }).join('');

  // Update totals
  const updateTotal = (id, value) => {
    const el = Q(id);
    if (el) el.textContent = typeof value === 'number' ? fmt(value) : value;
  };

  updateTotal('#pcOrdersT', totalOrders);
  updateTotal('#pcDeliveredOrdersT', totalDeliveredOrders);
  updateTotal('#pcRefundedOrdersT', totalRefundedOrders);
  updateTotal('#pcDeliveredPiecesT', totalPieces);
  updateTotal('#pcRevT', totalRevenue);
  updateTotal('#pcRefundedAmountT', totalRefundedAmount);
  updateTotal('#pcAdT', totalAdSpend);
  updateTotal('#pcInfluencerSpendT', totalInfluencerSpend);
  updateTotal('#pcProductCostT', totalProductCost);
  updateTotal('#pcShippingCostT', totalShippingCost);
  updateTotal('#pcBoxleoT', totalBoxleo);
  updateTotal('#pcBoxleoOrderT', `$${fmt(totalBoxleoPerOrder / itemCount)}`);
  updateTotal('#pcBoxleoPieceT', `$${fmt(totalBoxleoPerPiece / itemCount)}`);
  updateTotal('#pcAdOrderT', `$${fmt(totalAdCostPerOrder / itemCount)}`);
  updateTotal('#pcAdPieceT', `$${fmt(totalAdCostPerPiece / itemCount)}`);
  updateTotal('#pcProfitOrderT', `$${fmt(totalProfitPerOrder / itemCount)}`);
  updateTotal('#pcProfitPieceT', `$${fmt(totalProfitPerPiece / itemCount)}`);
  updateTotal('#pcDeliveryRateT', `${fmt(totalDeliveredOrders / totalOrders * 100)}%`);
  updateTotal('#pcAOVT', `$${fmt(totalAOV / itemCount)}`);
  updateTotal('#pcProfitT', totalProfit);

  // Add sorting functionality
  addSortingToProfitCountry();
}

function addSortingToProfitCountry() {
  const headers = QA('.profit-country-table th.sortable');
  headers.forEach(header => {
    header.style.cursor = 'pointer';
    if (!eventListeners.has(`profitCountry-${header.textContent}`)) {
      header.addEventListener('click', function() {
        const sortBy = this.textContent.trim().toLowerCase().replace(/\s+/g, '');
        state.profitCountrySortOrder = state.profitCountrySortBy === sortBy ?
          (state.profitCountrySortOrder === 'desc' ? 'asc' : 'desc') : 'desc';
        state.profitCountrySortBy = sortBy;
       
        // Update sort indicators
        headers.forEach(h => {
          h.classList.remove('sort-asc', 'sort-desc');
          if (h.textContent.trim().toLowerCase().replace(/\s+/g, '') === sortBy) {
            h.classList.add(state.profitCountrySortOrder === 'asc' ? 'sort-asc' : 'sort-desc');
          }
        });
       
        Q('#pcRun').click();
      });
      eventListeners.set(`profitCountry-${header.textContent}`, true);
    }
  });
}

function bindRemittanceAdd() {
  const btn = Q('#remAddSave');
  if (!btn) return;

  if (!eventListeners.has('remAddSave')) {
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
        return alert('Fill all required fields');
      }

      try {
        await api('/api/remittances', { method: 'POST', body: JSON.stringify(payload) });
        alert('Remittance entry saved successfully!');
       
        // Clear form
        ['#remAddStart', '#remAddEnd', '#remAddOrders', '#remAddPieces', '#remAddRevenue', '#remAddAdSpend', '#remAddBoxleo'].forEach(sel => {
          const el = Q(sel);
          if (el) el.value = '';
        });
      } catch (e) {
        if (e.message.includes('Duplicate remittance period')) {
          const confirmAdd = confirm('You already entered a remittance for this product in this country during this period. Are you sure you want to enter again?');
          if (confirmAdd) {
            await api('/api/remittances/force', { method: 'POST', body: JSON.stringify(payload) });
            alert('Remittance entry saved successfully!');
           
            // Clear form
            ['#remAddStart', '#remAddEnd', '#remAddOrders', '#remAddPieces', '#remAddRevenue', '#remAddAdSpend', '#remAddBoxleo'].forEach(sel => {
              const el = Q(sel);
              if (el) el.value = '';
            });
          }
        } else {
          alert('Error saving remittance: ' + e.message);
        }
      }
    };
    eventListeners.set('remAddSave', true);
  }
}

function bindRefundAdd() {
  const btn = Q('#refundSave');
  if (!btn) return;

  if (!eventListeners.has('refundSave')) {
    btn.onclick = async () => {
      const payload = {
        date: Q('#refundDate')?.value,
        country: Q('#refundCountry')?.value,
        productId: Q('#refundProduct')?.value,
        orders: +Q('#refundOrders')?.value || 0,
        pieces: +Q('#refundPieces')?.value || 0,
        amount: +Q('#refundAmount')?.value || 0,
        reason: Q('#refundReason')?.value || ''
      };

      if (!payload.date || !payload.country || !payload.productId) {
        return alert('Fill all required fields');
      }

      try {
        await api('/api/refunds', { method: 'POST', body: JSON.stringify(payload) });
        alert('Refund entry saved successfully!');
       
        // Clear form
        ['#refundDate', '#refundOrders', '#refundPieces', '#refundAmount', '#refundReason'].forEach(sel => {
          const el = Q(sel);
          if (el) el.value = '';
        });
      } catch (e) {
        alert('Error saving refund: ' + e.message);
      }
    };
    eventListeners.set('refundSave', true);
  }
}

// ======== STOCK MOVEMENT PAGE ========
function renderStockMovementPage() {
  bindStockMovement();
  renderShipmentTables();
}

function bindStockMovement() {
  const btn = Q('#mvAdd');
  if (!btn) return;

  // Show China cost field only when shipping from China
  if (!eventListeners.has('mvFrom')) {
    Q('#mvFrom')?.addEventListener('change', function() {
      const chinaCostField = Q('#chinaCostField');
      if (this.value === 'china') {
        chinaCostField.style.display = 'block';
      } else {
        chinaCostField.style.display = 'none';
      }
    });
    eventListeners.set('mvFrom', true);
  }

  if (!eventListeners.has('mvAdd')) {
    btn.onclick = async () => {
      const payload = {
        productId: Q('#mvProduct')?.value,
        fromCountry: Q('#mvFrom')?.value,
        toCountry: Q('#mvTo')?.value,
        qty: +Q('#mvQty')?.value || 0,
        shipCost: +Q('#mvShip')?.value || 0,
        note: Q('#mvNote')?.value || '',
        departedAt: isoToday()
      };

      if (payload.fromCountry === 'china') {
        payload.chinaCost = +Q('#mvChinaCost')?.value || 0;
      }

      if (!payload.productId || !payload.fromCountry || !payload.toCountry || !payload.qty) {
        return alert('Fill all required fields');
      }

      try {
        await api('/api/shipments', { method: 'POST', body: JSON.stringify(payload) });
        alert('Stock movement added successfully!');
       
        // Clear form
        Q('#mvQty').value = '';
        Q('#mvShip').value = '';
        Q('#mvChinaCost').value = '';
        Q('#mvNote').value = '';
       
        // Refresh tables
        renderShipmentTables();
        renderProductsTable();
        renderCompactKpis();
      } catch (e) {
        alert('Error: ' + e.message);
      }
    };
    eventListeners.set('mvAdd', true);
  }
}

async function renderShipmentTables() {
  try {
    const shipments = await api('/api/shipments');
   
    // Filter out arrived shipments (they should only appear on product pages)
    const transitShipments = shipments.shipments.filter(s => !s.arrivedAt);
   
    // China → Kenya shipments
    const chinaKenyaShipments = transitShipments.filter(s =>
      s.fromCountry === 'china' && s.toCountry === 'kenya'
    );
    renderShipmentTable('#shipCKBody', chinaKenyaShipments, true);
   
    // Inter-country shipments (excluding China → Kenya)
    const interCountryShipments = transitShipments.filter(s =>
      s.fromCountry !== 'china' || s.toCountry !== 'kenya'
    );
    renderShipmentTable('#shipICBody', interCountryShipments, false);
  } catch (e) {
    console.error('Error loading shipments:', e);
  }
}

function renderShipmentTable(selector, shipments, showChinaCost) {
  const tbody = Q(selector);
  if (!tbody) return;

  if (shipments.length === 0) {
    tbody.innerHTML = '<tr><td colspan="12" class="muted">No shipments in transit</td></tr>';
    return;
  }

  tbody.innerHTML = shipments.map(shipment => {
    const product = state.products.find(p => p.id === shipment.productId);
    const productName = product ? product.name : shipment.productId;
    const route = `${shipment.fromCountry} → ${shipment.toCountry}`;
   
    return `
      <tr>
        <td>${shipment.id.slice(0, 8)}</td>
        <td>${productName}</td>
        <td>${route}</td>
        <td>${fmt(shipment.qty)}</td>
        <td>${fmt(shipment.shipCost)}</td>
        <td>${shipment.finalShipCost ? fmt(shipment.finalShipCost) : '-'}</td>
        ${showChinaCost ? `<td>${shipment.chinaCost ? fmt(shipment.chinaCost) : '-'}</td>` : ''}
        <td>${shipment.departedAt || '-'}</td>
        <td>${shipment.arrivedAt || '-'}</td>
        <td><span class="badge ${shipment.paymentStatus}">${shipment.paymentStatus}</span></td>
        <td>${shipment.note || '-'}</td>
        <td>
          ${!shipment.arrivedAt ? `<button class="btn small outline act-arrive" data-id="${shipment.id}">Arrived</button>` : ''}
          ${shipment.paymentStatus === 'pending' ? `<button class="btn small outline act-pay" data-id="${shipment.id}">Pay</button>` : ''}
          <button class="btn small outline act-edit-ship" data-id="${shipment.id}">Edit</button>
          <button class="btn small outline act-del-ship" data-id="${shipment.id}">Delete</button>
        </td>
      </tr>
    `;
  }).join('');

  // Add event listeners
  tbody.removeEventListener('click', handleShipmentActions);
  tbody.addEventListener('click', handleShipmentActions);
}

let isProcessingShipment = false;
async function handleShipmentActions(e) {
  if (isProcessingShipment) return;
 
  const id = e.target.dataset?.id;
  if (!id) return;

  if (e.target.classList.contains('act-arrive')) {
    // FIXED: Require final shipping cost before marking as arrived
    const finalCost = prompt('Enter final shipping cost before marking as arrived:');
    if (finalCost === null) return; // User cancelled
   
    if (!finalCost || isNaN(finalCost) || +finalCost < 0) {
      return alert('Please enter a valid final shipping cost');
    }
   
    if (!confirm('Are you sure you want to mark this shipment as arrived?')) {
      return;
    }
   
    isProcessingShipment = true;
    e.target.disabled = true;
   
    try {
      // First mark as paid with final cost, then mark as arrived
      await api(`/api/shipments/${id}/mark-paid`, {
        method: 'POST',
        body: JSON.stringify({ finalShipCost: +finalCost })
      });
     
      await api(`/api/shipments/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ arrivedAt: isoToday() })
      });
     
      renderShipmentTables();
      alert('Shipment marked as arrived and paid successfully!');
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      isProcessingShipment = false;
    }
  }

  if (e.target.classList.contains('act-pay')) {
    // Show popup to enter final shipping cost
    const finalCost = prompt('Enter final shipping cost:');
    if (finalCost && !isNaN(finalCost)) {
      isProcessingShipment = true;
      e.target.disabled = true;
     
      try {
        await api(`/api/shipments/${id}/mark-paid`, {
          method: 'POST',
          body: JSON.stringify({ finalShipCost: +finalCost })
        });
        renderShipmentTables();
        alert('Shipment marked as paid successfully!');
      } catch (error) {
        alert('Error marking shipment as paid: ' + error.message);
      } finally {
        isProcessingShipment = false;
      }
    }
  }

  if (e.target.classList.contains('act-edit-ship')) {
    editShipment(id);
  }

  if (e.target.classList.contains('act-del-ship')) {
    if (confirm('Delete this shipment?')) {
      isProcessingShipment = true;
      e.target.disabled = true;
     
      await api(`/api/shipments/${id}`, { method: 'DELETE' });
      renderShipmentTables();
     
      isProcessingShipment = false;
    }
  }
}

async function editShipment(shipmentId) {
  try {
    const shipments = await api('/api/shipments');
    const shipment = shipments.shipments.find(s => s.id === shipmentId);
    if (!shipment) return;

    const newQty = prompt('Enter new quantity:', shipment.qty);
    const newShipCost = prompt('Enter new shipping cost:', shipment.shipCost);
    const newNote = prompt('Enter new note:', shipment.note);

    if (newQty !== null && newShipCost !== null) {
      await api(`/api/shipments/${shipmentId}`, {
        method: 'PUT',
        body: JSON.stringify({
          qty: +newQty,
          shipCost: +newShipCost,
          note: newNote || shipment.note
        })
      });
      renderShipmentTables();
      alert('Shipment updated');
    }
  } catch (error) {
    alert('Error updating shipment: ' + error.message);
  }
}

// ======== ADVERTISING COSTS PAGE ========
function renderAdspendPage() {
  bindAdvertisingCostDaily();
  bindAdvertisingCostAnalytics();
  renderAdvertisingOverview();
}

function bindAdvertisingCostDaily() {
  const btn = Q('#advertisingCostSave');
  if (!btn) return;

  if (!eventListeners.has('advertisingCostSave')) {
    btn.onclick = async () => {
      const payload = {
        date: isoToday(),
        productId: Q('#advertisingCostProduct')?.value,
        country: Q('#advertisingCostCountry')?.value,
        platform: Q('#advertisingCostPlatform')?.value,
        amount: +Q('#advertisingCostAmount')?.value || 0
      };

      if (!payload.productId || !payload.country || !payload.platform) {
        return alert('Fill all fields');
      }

      try {
        await api('/api/advertising-costs', { method: 'POST', body: JSON.stringify(payload) });
        alert('Advertising cost saved successfully!');
        Q('#advertisingCostAmount').value = '';
        renderAdvertisingOverview();
      } catch (e) {
        alert('Error: ' + e.message);
      }
    };
    eventListeners.set('advertisingCostSave', true);
  }
}

function bindAdvertisingCostAnalytics() {
  const btn = Q('#advertisingCostRun');
  if (!btn) return;

  if (!eventListeners.has('advertisingCostRun')) {
    btn.onclick = async () => {
      const dateRange = getDateRange(btn.closest('.row'));
      const country = Q('#advertisingCostFilterCountry')?.value || '';
      const productId = Q('#advertisingCostFilterProduct')?.value || '';
      const platform = Q('#advertisingCostFilterPlatform')?.value || '';

      try {
        const advertisingCosts = await api('/api/advertising-costs');
        let filteredCosts = advertisingCosts.advertisingCosts || [];

        // Apply filters
        if (dateRange.start) {
          filteredCosts = filteredCosts.filter(cost => cost.date >= dateRange.start);
        }
        if (dateRange.end) {
          filteredCosts = filteredCosts.filter(cost => cost.date <= dateRange.end);
        }
        if (country) {
          filteredCosts = filteredCosts.filter(cost => cost.country === country);
        }
        if (productId && productId !== 'all') {
          filteredCosts = filteredCosts.filter(cost => cost.productId === productId);
        }
        if (platform) {
          filteredCosts = filteredCosts.filter(cost => cost.platform === platform);
        }

        renderAdvertisingCostResults(filteredCosts);
      } catch (e) {
        alert('Error loading advertising cost data: ' + e.message);
      }
    };
    eventListeners.set('advertisingCostRun', true);
  }
}

function renderAdvertisingCostResults(advertisingCosts) {
  const container = Q('#advertisingCostResults');
  if (!container) return;

  const total = advertisingCosts.reduce((sum, cost) => sum + (+cost.amount || 0), 0);
  const byPlatform = {};
  const byCountry = {};
  const byProduct = {};

  advertisingCosts.forEach(cost => {
    // Platform breakdown
    byPlatform[cost.platform] = (byPlatform[cost.platform] || 0) + (+cost.amount || 0);
   
    // Country breakdown
    byCountry[cost.country] = (byCountry[cost.country] || 0) + (+cost.amount || 0);
   
    // Product breakdown
    const product = state.products.find(p => p.id === cost.productId);
    const productName = product ? product.name : cost.productId;
    byProduct[productName] = (byProduct[productName] || 0) + (+cost.amount || 0);
  });

  let html = `
    <div class="advertising-cost-summary">
      <div class="summary-stats">
        <div class="stat-card">
          <div class="stat-label">Total Advertising Cost</div>
          <div class="stat-value">$${fmt(total)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Number of Entries</div>
          <div class="stat-value">${advertisingCosts.length}</div>
        </div>
      </div>
  `;

  // Platform breakdown
  html += `<div class="breakdown-section">
    <h4>By Platform</h4>
    <div class="breakdown-grid">`;
 
  Object.entries(byPlatform)
    .sort((a, b) => b[1] - a[1])
    .forEach(([platform, amount]) => {
      const percentage = total > 0 ? (amount / total * 100) : 0;
      html += `
        <div class="breakdown-item">
          <div class="breakdown-label">${platform}</div>
          <div class="breakdown-bar">
            <div class="breakdown-bar-fill" style="width: ${percentage}%"></div>
          </div>
          <div class="breakdown-value">$${fmt(amount)} (${fmt(percentage)}%)</div>
        </div>
      `;
    });
 
  html += `</div></div>`;

  // Country breakdown
  html += `<div class="breakdown-section">
    <h4>By Country</h4>
    <div class="breakdown-grid">`;
 
  Object.entries(byCountry)
    .sort((a, b) => b[1] - a[1])
    .forEach(([country, amount]) => {
      const percentage = total > 0 ? (amount / total * 100) : 0;
      html += `
        <div class="breakdown-item">
          <div class="breakdown-label">${country}</div>
          <div class="breakdown-bar">
            <div class="breakdown-bar-fill" style="width: ${percentage}%"></div>
          </div>
          <div class="breakdown-value">$${fmt(amount)} (${fmt(percentage)}%)</div>
        </div>
      `;
    });
 
  html += `</div></div>`;

  container.innerHTML = html;
}

// ======== FINANCE PAGE ========
function renderFinancePage() {
  renderFinanceCategories();
  bindFinanceEntries();
  bindFinanceSearch();
  renderFinanceBalance();
}

function renderFinanceCategories() {
  const debitsEl = Q('#fcDebits');
  const creditsEl = Q('#fcCredits');
 
  if (debitsEl) {
    debitsEl.innerHTML = state.categories.debit.map(cat => `
      <div class="chip">
        ${cat}
        <button class="chip-x" data-type="debit" data-name="${cat}">×</button>
      </div>
    `).join('');
  }
 
  if (creditsEl) {
    creditsEl.innerHTML = state.categories.credit.map(cat => `
      <div class="chip">
        ${cat}
        <button class="chip-x" data-type="credit" data-name="${cat}">×</button>
      </div>
    `).join('');
  }

  // Add event listeners for category deletion
  const chipsContainer = Q('.chips.deletable');
  if (chipsContainer && !eventListeners.has('chipsContainer')) {
    chipsContainer.onclick = async (e) => {
      if (e.target.classList.contains('chip-x')) {
        const type = e.target.dataset.type;
        const name = e.target.dataset.name;
        if (confirm(`Delete category "${name}"?`)) {
          await api(`/api/finance/categories?type=${type}&name=${encodeURIComponent(name)}`, {
            method: 'DELETE'
          });
          await preload();
          renderFinanceCategories();
          fillCommonSelects();
        }
      }
    };
    eventListeners.set('chipsContainer', true);
  }

  // Add new category
  if (!eventListeners.has('fcAdd')) {
    Q('#fcAdd')?.addEventListener('click', async () => {
      const type = Q('#fcType')?.value;
      const name = Q('#fcName')?.value?.trim();
     
      if (!name) return alert('Enter category name');
     
      await api('/api/finance/categories', {
        method: 'POST',
        body: JSON.stringify({ type, name })
      });
     
      Q('#fcName').value = '';
      await preload();
      renderFinanceCategories();
      fillCommonSelects();
    });
    eventListeners.set('fcAdd', true);
  }
}

function bindFinanceEntries() {
  const btn = Q('#feAdd');
  if (!btn) return;

  if (!eventListeners.has('feAdd')) {
    btn.onclick = async () => {
      const payload = {
        date: Q('#feDate')?.value,
        type: Q('#feCat')?.value ? (state.categories.debit.includes(Q('#feCat').value) ? 'debit' : 'credit') : '',
        category: Q('#feCat')?.value,
        amount: +Q('#feAmt')?.value || 0,
        note: Q('#feNote')?.value || ''
      };

      if (!payload.date || !payload.category || !payload.amount) {
        return alert('Fill all fields');
      }

      await api('/api/finance/entries', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      // Clear form
      Q('#feDate').value = '';
      Q('#feAmt').value = '';
      Q('#feNote').value = '';
     
      renderFinanceEntries();
      renderFinanceBalance();
    };
    eventListeners.set('feAdd', true);
  }

  // Filter entries
  if (!eventListeners.has('feRun')) {
    Q('#feRun')?.addEventListener('click', () => {
      renderFinanceEntries();
    });
    eventListeners.set('feRun', true);
  }

  renderFinanceEntries();
}

async function renderFinanceEntries() {
  const tbody = Q('#feTable tbody');
  if (!tbody) return;

  const start = Q('#fes')?.value || '';
  const end = Q('#fee')?.value || '';

  try {
    const data = await api('/api/finance/entries?' + new URLSearchParams({
      start, end
    }));

    tbody.innerHTML = data.entries.map(entry => `
      <tr>
        <td>${entry.date}</td>
        <td><span class="badge ${entry.type}">${entry.type}</span></td>
        <td>${entry.category}</td>
        <td class="${entry.type === 'credit' ? 'number-positive' : 'number-negative'}">
          ${entry.type === 'credit' ? '+' : '-'}$${fmt(entry.amount)}
        </td>
        <td>${entry.note}</td>
        <td>
          <button class="btn small outline act-del-entry" data-id="${entry.id}">Delete</button>
        </td>
      </tr>
    `).join('') || '<tr><td colspan="6" class="muted">No entries</td></tr>';

    // Update period balance
    const balanceEl = Q('#feBalance');
    if (balanceEl) {
      balanceEl.textContent = `Period Balance: $${fmt(data.balance)}`;
      balanceEl.className = `badge ${data.balance >= 0 ? 'success' : 'danger'}`;
    }

    // Add delete handlers
    tbody.removeEventListener('click', handleFinanceEntryDelete);
    tbody.addEventListener('click', handleFinanceEntryDelete);
  } catch (e) {
    console.error('Error loading finance entries:', e);
  }
}

async function handleFinanceEntryDelete(e) {
  if (e.target.classList.contains('act-del-entry')) {
    if (confirm('Delete this entry?')) {
      await api(`/api/finance/entries/${e.target.dataset.id}`, { method: 'DELETE' });
      renderFinanceEntries();
      renderFinanceBalance();
    }
  }
}

async function renderFinanceBalance() {
  try {
    const data = await api('/api/finance/entries');
    const balanceEl = Q('#runBalance');
    if (balanceEl) {
      balanceEl.textContent = `${fmt(data.running)} USD`;
      balanceEl.className = `balance ${data.running >= 0 ? 'number-positive' : 'number-negative'}`;
    }
  } catch (e) {
    console.error('Error loading finance balance:', e);
  }
}

function bindFinanceSearch() {
  const btn = Q('#fcSearchRun');
  if (!btn) return;

  if (!eventListeners.has('fcSearchRun')) {
    btn.onclick = async () => {
      const type = Q('#fcSearchType')?.value || '';
      const category = Q('#fcSearchCat')?.value || '';
      const start = Q('#fcSearchStart')?.value || '';
      const end = Q('#fcSearchEnd')?.value || '';

      try {
        const data = await api('/api/finance/entries?' + new URLSearchParams({
          type, category, start, end
        }));

        const resultEl = Q('#fcSearchResult');
        const countEl = Q('#fcSearchCount');
       
        if (resultEl) {
          resultEl.textContent = `Total: $${fmt(data.categoryTotal)} USD`;
          resultEl.className = `badge ${data.categoryTotal >= 0 ? 'success' : 'danger'}`;
        }
       
        if (countEl) {
          countEl.textContent = `Entries: ${data.entries.length}`;
        }
      } catch (e) {
        console.error('Error searching finance:', e);
      }
    };
    eventListeners.set('fcSearchRun', true);
  }
}

// ======== SETTINGS PAGE ========
function renderSettingsPage() {
  renderCountries();
  bindProductEdit();
  renderSnapshots();
  bindSnapshotActions();
}

function renderCountries() {
  const listEl = Q('#ctyList');
  if (!listEl) return;

  listEl.innerHTML = state.countries.map(country => `
    <div class="chip">
      ${country}
      <button class="chip-x" data-name="${country}">×</button>
    </div>
  `).join('');

  if (!eventListeners.has('ctyList')) {
    listEl.onclick = async (e) => {
      if (e.target.classList.contains('chip-x')) {
        const name = e.target.dataset.name;
        if (confirm(`Delete country "${name}"?`)) {
          await api(`/api/countries/${encodeURIComponent(name)}`, { method: 'DELETE' });
          await preload();
          renderCountries();
          fillCommonSelects();
        }
      }
    };
    eventListeners.set('ctyList', true);
  }

  if (!eventListeners.has('ctyAdd')) {
    Q('#ctyAdd')?.addEventListener('click', async () => {
      const name = Q('#cty')?.value?.trim();
      if (!name) return alert('Enter country name');
     
      await api('/api/countries', {
        method: 'POST',
        body: JSON.stringify({ name })
      });
     
      Q('#cty').value = '';
      await preload();
      renderCountries();
      fillCommonSelects();
    });
    eventListeners.set('ctyAdd', true);
  }
}

function bindProductEdit() {
  const select = Q('#epSelect');
  if (!select) return;

  // Populate product select - FIXED: Sort by status and name
  const sortedProducts = state.products.sort((a, b) => {
    // First sort by status: active first
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (a.status !== 'active' && b.status === 'active') return 1;
    // Then sort by name A-Z
    return a.name.localeCompare(b.name);
  });
 
  select.innerHTML = '<option value="">Select product…</option>' +
    sortedProducts.map(p => `<option value="${p.id}">${p.name}${p.status === 'paused' ? ' [PAUSED]' : ''}</option>`).join('');

  if (!eventListeners.has('epSelect')) {
    select.addEventListener('change', function() {
      const product = state.products.find(p => p.id === this.value);
      if (product) {
        Q('#epName').value = product.name || '';
        Q('#epSku').value = product.sku || '';
      }
    });
    eventListeners.set('epSelect', true);
  }

  if (!eventListeners.has('epSave')) {
    Q('#epSave')?.addEventListener('click', async () => {
      const id = select.value;
      const name = Q('#epName')?.value?.trim();
      const sku = Q('#epSku')?.value?.trim();

      if (!id || !name) return alert('Select product and enter name');

      await api(`/api/products/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name, sku })
      });

      await preload();
      renderProductsTable();
      alert('Product updated successfully!');
    });
    eventListeners.set('epSave', true);
  }
}

function renderSnapshots() {
  const tbody = Q('#snapList');
  if (!tbody) return;

  api('/api/snapshots').then(data => {
    const snaps = data.snapshots || [];
    tbody.innerHTML = snaps.map(snap => `
      <tr>
        <td>${snap.name}</td>
        <td>${snap.file}</td>
        <td>${new Date(snap.createdAt).toLocaleString()}</td>
        <td>
          <button class="btn small outline act-restore" data-file="${snap.file}">Restore</button>
          <button class="btn small outline act-del-snap" data-id="${snap.id}">Delete</button>
        </td>
      </tr>
    `).join('') || '<tr><td colspan="4" class="muted">No snapshots</td></tr>';
  }).catch(console.error);
}

function bindSnapshotActions() {
  const container = Q('#snapList')?.closest('.card');
  if (!container) return;

  // Save snapshot
  if (!eventListeners.has('snapSave')) {
    Q('#snapSave')?.addEventListener('click', async () => {
      const name = Q('#snapName')?.value?.trim() || `Manual-${new Date().toISOString().slice(0, 10)}`;
     
      await api('/api/snapshots', {
        method: 'POST',
        body: JSON.stringify({ name })
      });
     
      Q('#snapName').value = '';
      renderSnapshots();
      alert('Snapshot saved successfully!');
    });
    eventListeners.set('snapSave', true);
  }

  // Handle snapshot actions
  container.removeEventListener('click', handleSnapshotActions);
  container.addEventListener('click', handleSnapshotActions);
}

async function handleSnapshotActions(e) {
  if (e.target.classList.contains('act-restore')) {
    const file = e.target.dataset.file;
    if (confirm(`Restore snapshot: ${file}? This will replace current data.`)) {
      try {
        await api('/api/backup/push-snapshot', {
          method: 'POST',
          body: JSON.stringify({ snapshotFile: file })
        });
        alert('Snapshot restored! Page will reload.');
        setTimeout(() => location.reload(), 1000);
      } catch (error) {
        alert('Restore failed: ' + error.message);
      }
    }
  }

  if (e.target.classList.contains('act-del-snap')) {
    const id = e.target.dataset.id;
    if (confirm('Delete this snapshot?')) {
      await api(`/api/snapshots/${id}`, { method: 'DELETE' });
      renderSnapshots();
    }
  }
}

function setupDailyBackupButton() {
  if (!eventListeners.has('createDailyBackup')) {
    Q('#createDailyBackup')?.addEventListener('click', async () => {
      try {
        await api('/api/snapshots', {
          method: 'POST',
          body: JSON.stringify({ name: `Daily-${new Date().toISOString().slice(0, 10)}` })
        });
        alert('Daily backup created successfully!');
        renderSnapshots();
      } catch (error) {
        alert('Backup creation failed: ' + error.message);
      }
    });
    eventListeners.set('createDailyBackup', true);
  }
}

// ======== PRODUCT PAGE ========
function renderProductPage() {
  if (!state.productId) return;
 
  renderProductHeader();
  renderProductStockAdCost();
  bindProductNotes();
  renderProfitAdvertisingBudget();
  renderProductShipments();
  renderProductLifetimePerformance();
  renderProductStoreOrders();
  renderProductRemittances();
  renderProductRefunds();
  bindProductInfluencers();
}

async function renderProductHeader() {
  try {
    const product = state.products.find(p => p.id === state.productId);
    if (product) {
      Q('#pdTitle').textContent = product.name;
      Q('#pdSku').textContent = product.sku ? `SKU: ${product.sku}` : '';
    }
  } catch (error) {
    console.error('Error loading product header:', error);
  }
}

async function renderProductStockAdCost() {
  const tbody = Q('#pdStockBody');
  if (!tbody) return;

  try {
    const product = state.products.find(p => p.id === state.productId);
    if (!product) return;

    const stockByCountry = product.stockByCountry || {};
    const adCostByCountry = product.adCostByCountry || {};

    let totalStock = 0, totalFb = 0, totalTt = 0, totalGg = 0, totalAd = 0;

    const rows = state.countries.map(country => {
      const stock = stockByCountry[country] || 0;
      const adData = adCostByCountry[country] || { facebook: 0, tiktok: 0, google: 0 };
      const countryAdTotal = adData.facebook + adData.tiktok + adData.google;

      totalStock += stock;
      totalFb += adData.facebook;
      totalTt += adData.tiktok;
      totalGg += adData.google;
      totalAd += countryAdTotal;

      return `
        <tr>
          <td>${country}</td>
          <td>${fmt(stock)}</td>
          <td>${fmt(adData.facebook)}</td>
          <td>${fmt(adData.tiktok)}</td>
          <td>${fmt(adData.google)}</td>
          <td>${fmt(countryAdTotal)}</td>
        </tr>
      `;
    }).join('');

    tbody.innerHTML = rows || '<tr><td colspan="6" class="muted">No data</td></tr>';
   
    Q('#pdStockTotal').textContent = fmt(totalStock);
    Q('#pdFbTotal').textContent = fmt(totalFb);
    Q('#pdTtTotal').textContent = fmt(totalTt);
    Q('#pdGgTotal').textContent = fmt(totalGg);
    Q('#pdAdTotal').textContent = fmt(totalAd);
  } catch (error) {
    console.error('Error loading product stock data:', error);
    tbody.innerHTML = '<tr><td colspan="6" class="muted">Error loading data</td></tr>';
  }
}

function bindProductNotes() {
  const btn = Q('#pdNoteSave');
  if (!btn) return;

  // Load existing notes
  loadProductNotes();

  if (!eventListeners.has('pdNoteSave')) {
    btn.onclick = async () => {
      const country = Q('#pdNoteCountry')?.value;
      const note = Q('#pdNoteText')?.value?.trim();

      if (!country || !note) return alert('Select country and enter note');

      try {
        await api(`/api/products/${state.productId}/notes`, {
          method: 'POST',
          body: JSON.stringify({ country, note })
        });
       
        Q('#pdNoteText').value = '';
        loadProductNotes();
        alert('Note saved successfully!');
      } catch (error) {
        alert('Error saving note: ' + error.message);
      }
    };
    eventListeners.set('pdNoteSave', true);
  }
}

async function loadProductNotes() {
  const container = Q('#pdNotesList');
  if (!container) return;

  try {
    const data = await api(`/api/products/${state.productId}/notes`);
    const notes = data.notes || [];

    container.innerHTML = notes.map(note => `
      <div class="note-card">
        <div class="note-header">
          <strong>${note.country}</strong>
          <button class="btn outline small act-del-note" data-id="${note.id}">Delete</button>
        </div>
        <div class="note-content">${note.note}</div>
        <div class="note-date">Last updated: ${new Date(note.updatedAt).toLocaleString()}</div>
      </div>
    `).join('') || '<div class="muted">No notes yet</div>';

    // Add delete handlers
    container.removeEventListener('click', handleNoteDelete);
    container.addEventListener('click', handleNoteDelete);
  } catch (error) {
    console.error('Error loading notes:', error);
  }
}

async function handleNoteDelete(e) {
  if (e.target.classList.contains('act-del-note')) {
    const noteId = e.target.dataset.id;
    if (confirm('Delete this note?')) {
      await api(`/api/products/notes/${noteId}`, { method: 'DELETE' });
      loadProductNotes();
    }
  }
}

async function renderProfitAdvertisingBudget() {
  const tbody = Q('#pdPBBBody');
  if (!tbody) return;

  try {
    const productInfo = await api(`/api/product-info/${state.productId}`);
    const { costAnalysis, boxleoPerOrder } = productInfo;

    tbody.innerHTML = costAnalysis.map(analysis => {
      const boxleoPerOrderValue = analysis.boxleoPerOrder || boxleoPerOrder || 0;
      const totalCost = analysis.productCostChina + analysis.shippingCost + boxleoPerOrderValue;
      const availableForProfitAndAds = analysis.sellingPrice - totalCost;
      const maxCPL = analysis.deliveryRate > 0 ? availableForProfitAndAds * (analysis.deliveryRate / 100) : 0;

      return `
        <tr>
          <td>${analysis.country}</td>
          <td>$${fmt(maxCPL)}</td>
          <td class="${availableForProfitAndAds >= 0 ? 'number-positive' : 'number-negative'}">
            $${fmt(availableForProfitAndAds)}
          </td>
          <td>${fmt(analysis.deliveryRate)}%</td>
          <td>$${fmt(analysis.sellingPrice)}</td>
          <td>$${fmt(analysis.productCostChina)}</td>
          <td>$${fmt(analysis.shippingCost)}</td>
          <td>$${fmt(boxleoPerOrderValue)}</td>
          <td>$${fmt(totalCost)}</td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="9" class="muted">No data</td></tr>';
  } catch (error) {
    console.error('Error loading profit budget:', error);
    tbody.innerHTML = '<tr><td colspan="9" class="muted">Error loading data</td></tr>';
  }
}

async function renderProductShipments() {
  try {
    const shipments = await api('/api/shipments');
    const productShipments = shipments.shipments.filter(s => s.productId === state.productId);

    // Show all shipments for this product (including arrived ones)
    const chinaKenyaShipments = productShipments.filter(s =>
      s.fromCountry === 'china' && s.toCountry === 'kenya'
    );
    renderProductShipmentTable('#pdShipCKBody', chinaKenyaShipments, true);

    // Inter-country shipments
    const interCountryShipments = productShipments.filter(s =>
      s.fromCountry !== 'china' || s.toCountry !== 'kenya'
    );
    renderProductShipmentTable('#pdShipICBody', interCountryShipments, false);

    // Arrived shipments
    const arrivedShipments = productShipments.filter(s => s.arrivedAt);
    renderArrivedShipmentsTable(arrivedShipments);

  } catch (error) {
    console.error('Error loading product shipments:', error);
  }
}

function renderProductShipmentTable(selector, shipments, showChinaCost) {
  const tbody = Q(selector);
  if (!tbody) return;

  if (shipments.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="muted">No shipments</td></tr>';
    return;
  }

  tbody.innerHTML = shipments.map(shipment => {
    const route = `${shipment.fromCountry} → ${shipment.toCountry}`;
   
    return `
      <tr>
        <td>${shipment.id.slice(0, 8)}</td>
        <td>${route}</td>
        <td>${fmt(shipment.qty)}</td>
        <td>${fmt(shipment.shipCost)}</td>
        <td>${shipment.finalShipCost ? fmt(shipment.finalShipCost) : '-'}</td>
        ${showChinaCost ? `<td>${shipment.chinaCost ? fmt(shipment.chinaCost) : '-'}</td>` : ''}
        <td>${shipment.departedAt || '-'}</td>
        <td>${shipment.arrivedAt || '-'}</td>
        <td><span class="badge ${shipment.paymentStatus}">${shipment.paymentStatus}</span></td>
        <td>
          ${!shipment.arrivedAt ? `<button class="btn small outline act-arrive" data-id="${shipment.id}">Arrived</button>` : ''}
          ${shipment.paymentStatus === 'pending' ? `<button class="btn small outline act-pay" data-id="${shipment.id}">Pay</button>` : ''}
          <button class="btn small outline act-edit-ship" data-id="${shipment.id}">Edit</button>
          <button class="btn small outline act-del-ship" data-id="${shipment.id}">Delete</button>
        </td>
      </tr>
    `;
  }).join('');

  // Add event listeners
  tbody.removeEventListener('click', handleProductShipmentActions);
  tbody.addEventListener('click', handleProductShipmentActions);
}

function renderArrivedShipmentsTable(shipments) {
  const tbody = Q('#pdArrivedBody');
  if (!tbody) return;

  if (shipments.length === 0) {
    tbody.innerHTML = '<tr><td colspan="12" class="muted">No arrived shipments</td></tr>';
    return;
  }

  tbody.innerHTML = shipments.map(shipment => {
    const route = `${shipment.fromCountry} → ${shipment.toCountry}`;
    const departed = new Date(shipment.departedAt);
    const arrived = new Date(shipment.arrivedAt);
    const daysInTransit = Math.round((arrived - departed) / (1000 * 60 * 60 * 24));
   
    return `
      <tr>
        <td>${shipment.id.slice(0, 8)}</td>
        <td>${route}</td>
        <td>${fmt(shipment.qty)}</td>
        <td>${fmt(shipment.shipCost)}</td>
        <td>${shipment.finalShipCost ? fmt(shipment.finalShipCost) : '-'}</td>
        <td>${shipment.chinaCost ? fmt(shipment.chinaCost) : '-'}</td>
        <td>${shipment.departedAt || '-'}</td>
        <td>${shipment.arrivedAt || '-'}</td>
        <td>${daysInTransit}</td>
        <td><span class="badge ${shipment.paymentStatus}">${shipment.paymentStatus}</span></td>
        <td>${shipment.note || '-'}</td>
        <td>
          <button class="btn small outline act-edit-ship" data-id="${shipment.id}">Edit</button>
          <button class="btn small outline act-del-ship" data-id="${shipment.id}">Delete</button>
        </td>
      </tr>
    `;
  }).join('');

  // Add event listeners
  tbody.removeEventListener('click', handleProductShipmentActions);
  tbody.addEventListener('click', handleProductShipmentActions);
}

let isProcessingProductShipment = false;
async function handleProductShipmentActions(e) {
  if (isProcessingProductShipment) return;
 
  const id = e.target.dataset?.id;
  if (!id) return;

  if (e.target.classList.contains('act-arrive')) {
    // FIXED: Require final shipping cost before marking as arrived
    const finalCost = prompt('Enter final shipping cost before marking as arrived:');
    if (finalCost === null) return; // User cancelled
   
    if (!finalCost || isNaN(finalCost) || +finalCost < 0) {
      return alert('Please enter a valid final shipping cost');
    }
   
    if (!confirm('Are you sure you want to mark this shipment as arrived?')) {
      return;
    }
   
    isProcessingProductShipment = true;
    e.target.disabled = true;
   
    try {
      // First mark as paid with final cost, then mark as arrived
      await api(`/api/shipments/${id}/mark-paid`, {
        method: 'POST',
        body: JSON.stringify({ finalShipCost: +finalCost })
      });
     
      await api(`/api/shipments/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ arrivedAt: isoToday() })
      });
     
      renderProductShipments();
      alert('Shipment marked as arrived and paid successfully!');
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      isProcessingProductShipment = false;
    }
  }

  if (e.target.classList.contains('act-pay')) {
    const finalCost = prompt('Enter final shipping cost:');
    if (finalCost && !isNaN(finalCost)) {
      isProcessingProductShipment = true;
      e.target.disabled = true;
     
      try {
        await api(`/api/shipments/${id}/mark-paid`, {
          method: 'POST',
          body: JSON.stringify({ finalShipCost: +finalCost })
        });
        renderProductShipments();
        alert('Shipment marked as paid successfully!');
      } catch (error) {
        alert('Error marking shipment as paid: ' + error.message);
      } finally {
        isProcessingProductShipment = false;
      }
    }
  }

  if (e.target.classList.contains('act-edit-ship')) {
    editProductShipment(id);
  }

  if (e.target.classList.contains('act-del-ship')) {
    if (confirm('Delete this shipment?')) {
      isProcessingProductShipment = true;
      e.target.disabled = true;
     
      await api(`/api/shipments/${id}`, { method: 'DELETE' });
      renderProductShipments();
     
      isProcessingProductShipment = false;
    }
  }
}

async function editProductShipment(shipmentId) {
  try {
    const shipments = await api('/api/shipments');
    const shipment = shipments.shipments.find(s => s.id === shipmentId);
    if (!shipment) return;

    const newQty = prompt('Enter new quantity:', shipment.qty);
    const newShipCost = prompt('Enter new shipping cost:', shipment.shipCost);
    const newNote = prompt('Enter new note:', shipment.note);

    if (newQty !== null && newShipCost !== null) {
      await api(`/api/shipments/${shipmentId}`, {
        method: 'PUT',
        body: JSON.stringify({
          qty: +newQty,
          shipCost: +newShipCost,
          note: newNote || shipment.note
        })
      });
      renderProductShipments();
      alert('Shipment updated');
    }
  } catch (error) {
    alert('Error updating shipment: ' + error.message);
  }
}

async function renderProductLifetimePerformance() {
  const btn = Q('#pdLPRun');
  if (!btn) return;

  if (!eventListeners.has('pdLPRun')) {
    btn.onclick = async () => {
      const dateRange = getDateRange(btn.closest('.row'));

      try {
        const analytics = await api('/api/analytics/remittance?' + new URLSearchParams({
          ...dateRange,
          productId: state.productId
        }));

        renderProductLifetimePerformanceTable(analytics.analytics || []);
      } catch (e) {
        alert('Error loading lifetime performance: ' + e.message);
      }
    };
    eventListeners.set('pdLPRun', true);
  }

  // Auto-run on page load
  setTimeout(() => {
    if (Q('#pdLPRun')) Q('#pdLPRun').click();
  }, 500);
}

function renderProductLifetimePerformanceTable(analytics) {
  const tbody = Q('#pdLPBody');
  if (!tbody) return;

  let totalRevenue = 0, totalRefunded = 0, totalAdSpend = 0, totalInfluencer = 0;
  let totalBoxleo = 0, totalProductCost = 0, totalShipping = 0, totalCost = 0;
  let totalOrders = 0, totalDeliveredOrders = 0, totalRefundedOrders = 0, totalDeliveredPieces = 0;
  let totalProfit = 0;
  let itemCount = 0;

  if (analytics.length === 0) {
    tbody.innerHTML = '<tr><td colspan="17" class="muted">No data found</td></tr>';
    return;
  }

  tbody.innerHTML = analytics.map(item => {
    totalRevenue += item.totalRevenue || 0;
    totalRefunded += item.totalRefundedAmount || 0;
    totalAdSpend += item.totalAdSpend || 0;
    totalInfluencer += item.totalInfluencerSpend || 0;
    totalBoxleo += item.totalBoxleoFees || 0;
    totalProductCost += item.totalProductChinaCost || 0;
    totalShipping += item.totalShippingCost || 0;
    totalCost += item.totalCost || 0;
    totalOrders += item.totalOrders || 0;
    totalDeliveredOrders += item.totalDeliveredOrders || 0;
    totalRefundedOrders += item.totalRefundedOrders || 0;
    totalDeliveredPieces += item.totalDeliveredPieces || 0;
    totalProfit += item.profit || 0;
    itemCount++;

    return `
      <tr>
        <td>${item.country}</td>
        <td>$${fmt(item.totalRevenue)}</td>
        <td>$${fmt(item.totalRefundedAmount)}</td>
        <td>$${fmt(item.totalAdSpend)}</td>
        <td>$${fmt(item.totalInfluencerSpend)}</td>
        <td>$${fmt(item.totalBoxleoFees)}</td>
        <td>$${fmt(item.totalProductChinaCost)}</td>
        <td>$${fmt(item.totalShippingCost)}</td>
        <td>$${fmt(item.totalCost)}</td>
        <td>${fmt(item.totalOrders)}</td>
        <td>${fmt(item.totalDeliveredOrders)}</td>
        <td>${fmt(item.totalRefundedOrders)}</td>
        <td>${fmt(item.totalDeliveredPieces)}</td>
        <td class="${item.profitPerOrder >= 0 ? 'number-positive' : 'number-negative'}">$${fmt(item.profitPerOrder)}</td>
        <td class="${item.profitPerPiece >= 0 ? 'number-positive' : 'number-negative'}">$${fmt(item.profitPerPiece)}</td>
        <td>${fmt(item.deliveryRate)}%</td>
        <td class="${item.profit >= 0 ? 'number-positive' : 'number-negative'}">$${fmt(item.profit)}</td>
      </tr>
    `;
  }).join('');

  // Update totals
  const updateTotal = (id, value) => {
    const el = Q(id);
    if (el) el.textContent = typeof value === 'number' ? fmt(value) : value;
  };

  updateTotal('#pdLPRevT', totalRevenue);
  updateTotal('#pdLPRefundedT', totalRefunded);
  updateTotal('#pdLPAdT', totalAdSpend);
  updateTotal('#pdLPInfluencerT', totalInfluencer);
  updateTotal('#pdLPBoxleoT', totalBoxleo);
  updateTotal('#pdLPProductCostT', totalProductCost);
  updateTotal('#pdLPShipT', totalShipping);
  updateTotal('#pdLPTotalCostT', totalCost);
  updateTotal('#pdLPOrdersT', totalOrders);
  updateTotal('#pdLPDeliveredOrdersT', totalDeliveredOrders);
  updateTotal('#pdLPRefundedOrdersT', totalRefundedOrders);
  updateTotal('#pdLPDeliveredPiecesT', totalDeliveredPieces);
  updateTotal('#pdLPProfitOrderT', `$${fmt(totalProfit / totalDeliveredOrders)}`);
  updateTotal('#pdLPProfitPieceT', `$${fmt(totalProfit / totalDeliveredPieces)}`);
  updateTotal('#pdLPDeliveryRateT', `${fmt(totalDeliveredOrders / totalOrders * 100)}%`);
  updateTotal('#pdLPProfitT', totalProfit);
}

async function renderProductStoreOrders() {
  const tbody = Q('#pdStoreOrdersBody');
  if (!tbody) return;

  try {
    const data = await api('/api/product-orders?' + new URLSearchParams({
      productId: state.productId,
      page: state.currentStoreOrdersPage,
      limit: '8'
    }));

    const orders = data.orders || [];
    const pagination = data.pagination || {};

    if (orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="muted">No store orders found</td></tr>';
    } else {
      tbody.innerHTML = orders.map(order => {
        const product = state.products.find(p => p.id === order.productId);
        const productName = product ? product.name : order.productId;
       
        return `
          <tr>
            <td>${order.startDate} → ${order.endDate}</td>
            <td>${order.country}</td>
            <td>${fmt(order.orders)}</td>
            <td>
              <button class="btn small outline act-del-order" data-id="${order.id}">Delete</button>
            </td>
          </tr>
        `;
      }).join('');
    }

    // Render pagination
    renderProductStoreOrdersPagination(pagination);

    // Add delete handlers
    tbody.removeEventListener('click', handleProductOrderDelete);
    tbody.addEventListener('click', handleProductOrderDelete);
  } catch (error) {
    console.error('Error loading store orders:', error);
    tbody.innerHTML = '<tr><td colspan="4" class="muted">Error loading data</td></tr>';
  }
}

function renderProductStoreOrdersPagination(pagination) {
  const container = Q('#pdStoreOrdersPagination');
  if (!container) return;

  const { currentPage, totalPages, totalItems, hasNextPage, hasPrevPage } = pagination;

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '';

  html += `<button class="pagination-btn" ${!hasPrevPage ? 'disabled' : ''} data-page="${currentPage - 1}">◀ Previous</button>`;

  const startPage = Math.max(1, currentPage - 2);
  const endPage = Math.min(totalPages, startPage + 4);

  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
  }

  html += `<button class="pagination-btn" ${!hasNextPage ? 'disabled' : ''} data-page="${currentPage + 1}">Next ▶</button>`;
  html += `<span class="pagination-info">Page ${currentPage} of ${totalPages} (${totalItems} orders)</span>`;

  container.innerHTML = html;

  container.removeEventListener('click', handleProductStoreOrdersPagination);
  container.addEventListener('click', handleProductStoreOrdersPagination);
}

function handleProductStoreOrdersPagination(e) {
  if (e.target.classList.contains('pagination-btn') && !e.target.disabled) {
    const page = parseInt(e.target.dataset.page);
    state.currentStoreOrdersPage = page;
    renderProductStoreOrders();
  }
}

async function handleProductOrderDelete(e) {
  if (e.target.classList.contains('act-del-order')) {
    const orderId = e.target.dataset.id;
    if (confirm('Delete this order entry?')) {
      await api(`/api/product-orders/${orderId}`, { method: 'DELETE' });
      renderProductStoreOrders();
    }
  }
}

async function renderProductRemittances() {
  const tbody = Q('#pdRemittancesBody');
  if (!tbody) return;

  try {
    const data = await api('/api/remittances?' + new URLSearchParams({
      productId: state.productId,
      page: state.currentRemittancesPage,
      limit: '8'
    }));

    const remittances = data.remittances || [];
    const pagination = data.pagination || {};

    if (remittances.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="muted">No remittances found</td></tr>';
    } else {
      tbody.innerHTML = remittances.map(remittance => {
        const product = state.products.find(p => p.id === remittance.productId);
        const productName = product ? product.name : remittance.productId;
       
        return `
          <tr>
            <td>${remittance.start} → ${remittance.end}</td>
            <td>${remittance.country}</td>
            <td>${fmt(remittance.orders)}</td>
            <td>${fmt(remittance.pieces)}</td>
            <td>$${fmt(remittance.revenue)}</td>
            <td>$${fmt(remittance.adSpend)}</td>
            <td>$${fmt(remittance.boxleoFees)}</td>
            <td>
              <button class="btn small outline act-del-remittance" data-id="${remittance.id}">Delete</button>
            </td>
          </tr>
        `;
      }).join('');
    }

    // Render pagination
    renderProductRemittancesPagination(pagination);

    // Add delete handlers
    tbody.removeEventListener('click', handleProductRemittanceDelete);
    tbody.addEventListener('click', handleProductRemittanceDelete);
  } catch (error) {
    console.error('Error loading remittances:', error);
    tbody.innerHTML = '<tr><td colspan="8" class="muted">Error loading data</td></tr>';
  }
}

function renderProductRemittancesPagination(pagination) {
  const container = Q('#pdRemittancesPagination');
  if (!container) return;

  const { currentPage, totalPages, totalItems, hasNextPage, hasPrevPage } = pagination;

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '';

  html += `<button class="pagination-btn" ${!hasPrevPage ? 'disabled' : ''} data-page="${currentPage - 1}">◀ Previous</button>`;

  const startPage = Math.max(1, currentPage - 2);
  const endPage = Math.min(totalPages, startPage + 4);

  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
  }

  html += `<button class="pagination-btn" ${!hasNextPage ? 'disabled' : ''} data-page="${currentPage + 1}">Next ▶</button>`;
  html += `<span class="pagination-info">Page ${currentPage} of ${totalPages} (${totalItems} remittances)</span>`;

  container.innerHTML = html;

  container.removeEventListener('click', handleProductRemittancesPagination);
  container.addEventListener('click', handleProductRemittancesPagination);
}

function handleProductRemittancesPagination(e) {
  if (e.target.classList.contains('pagination-btn') && !e.target.disabled) {
    const page = parseInt(e.target.dataset.page);
    state.currentRemittancesPage = page;
    renderProductRemittances();
  }
}

async function handleProductRemittanceDelete(e) {
  if (e.target.classList.contains('act-del-remittance')) {
    const remittanceId = e.target.dataset.id;
    if (confirm('Delete this remittance entry?')) {
      await api(`/api/remittances/${remittanceId}`, { method: 'DELETE' });
      renderProductRemittances();
    }
  }
}

async function renderProductRefunds() {
  const tbody = Q('#pdRefundsBody');
  if (!tbody) return;

  try {
    const data = await api('/api/refunds?' + new URLSearchParams({
      productId: state.productId,
      page: state.currentRefundsPage,
      limit: '8'
    }));

    const refunds = data.refunds || [];
    const pagination = data.pagination || {};

    if (refunds.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="muted">No refunds found</td></tr>';
    } else {
      tbody.innerHTML = refunds.map(refund => {
        const product = state.products.find(p => p.id === refund.productId);
        const productName = product ? product.name : refund.productId;
       
        return `
          <tr>
            <td>${refund.date}</td>
            <td>${refund.country}</td>
            <td>${fmt(refund.orders)}</td>
            <td>${fmt(refund.pieces)}</td>
            <td>$${fmt(refund.amount)}</td>
            <td>${refund.reason || '-'}</td>
            <td>
              <button class="btn small outline act-del-refund" data-id="${refund.id}">Delete</button>
            </td>
          </tr>
        `;
      }).join('');
    }

    // Render pagination
    renderProductRefundsPagination(pagination);

    // Add delete handlers
    tbody.removeEventListener('click', handleProductRefundDelete);
    tbody.addEventListener('click', handleProductRefundDelete);
  } catch (error) {
    console.error('Error loading refunds:', error);
    tbody.innerHTML = '<tr><td colspan="7" class="muted">Error loading data</td></tr>';
  }
}

function renderProductRefundsPagination(pagination) {
  const container = Q('#pdRefundsPagination');
  if (!container) return;

  const { currentPage, totalPages, totalItems, hasNextPage, hasPrevPage } = pagination;

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '';

  html += `<button class="pagination-btn" ${!hasPrevPage ? 'disabled' : ''} data-page="${currentPage - 1}">◀ Previous</button>`;

  const startPage = Math.max(1, currentPage - 2);
  const endPage = Math.min(totalPages, startPage + 4);

  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
  }

  html += `<button class="pagination-btn" ${!hasNextPage ? 'disabled' : ''} data-page="${currentPage + 1}">Next ▶</button>`;
  html += `<span class="pagination-info">Page ${currentPage} of ${totalPages} (${totalItems} refunds)</span>`;

  container.innerHTML = html;

  container.removeEventListener('click', handleProductRefundsPagination);
  container.addEventListener('click', handleProductRefundsPagination);
}

function handleProductRefundsPagination(e) {
  if (e.target.classList.contains('pagination-btn') && !e.target.disabled) {
    const page = parseInt(e.target.dataset.page);
    state.currentRefundsPage = page;
    renderProductRefunds();
  }
}

async function handleProductRefundDelete(e) {
  if (e.target.classList.contains('act-del-refund')) {
    const refundId = e.target.dataset.id;
    if (confirm('Delete this refund entry?')) {
      await api(`/api/refunds/${refundId}`, { method: 'DELETE' });
      renderProductRefunds();
    }
  }
}

function bindProductInfluencers() {
  // Add influencer
  if (!eventListeners.has('pdInfAdd')) {
    Q('#pdInfAdd')?.addEventListener('click', async () => {
      const name = Q('#pdInfName')?.value?.trim();
      const social = Q('#pdInfSocial')?.value?.trim();
      const country = Q('#pdInfCountry')?.value;

      if (!name) return alert('Enter influencer name');

      await api('/api/influencers', {
        method: 'POST',
        body: JSON.stringify({ name, social, country })
      });

      Q('#pdInfName').value = '';
      Q('#pdInfSocial').value = '';
      renderProductInfluencers();
    });
    eventListeners.set('pdInfAdd', true);
  }

  // Add influencer spend
  if (!eventListeners.has('pdInfSpendAdd')) {
    Q('#pdInfSpendAdd')?.addEventListener('click', async () => {
      const date = Q('#pdInfDate')?.value;
      const influencerId = Q('#pdInfSelect')?.value;
      const country = Q('#pdInfFilterCountry')?.value;
      const amount = +Q('#pdInfAmount')?.value || 0;

      if (!date || !influencerId) return alert('Select date and influencer');

      await api('/api/influencers/spend', {
        method: 'POST',
        body: JSON.stringify({
          date,
          influencerId,
          country,
          productId: state.productId,
          amount
        })
      });

      Q('#pdInfAmount').value = '';
      renderProductInfluencers();
    });
    eventListeners.set('pdInfSpendAdd', true);
  }

  // Filter influencer spend
  if (!eventListeners.has('pdInfRun')) {
    Q('#pdInfRun')?.addEventListener('click', () => {
      renderProductInfluencers();
    });
    eventListeners.set('pdInfRun', true);
  }

  renderProductInfluencers();
}

async function renderProductInfluencers() {
  const tbody = Q('#pdInfBody');
  const totalEl = Q('#pdInfTotal');
  if (!tbody) return;

  try {
    const influencers = await api('/api/influencers');
    const spends = await api('/api/influencers/spend');

    // Filter spends for this product
    const productSpends = spends.spends.filter(spend => spend.productId === state.productId);

    // Apply date filter
    const dateRange = getDateRange(Q('#pdInfRun')?.closest('.row'));
    let filteredSpends = productSpends;

    if (dateRange.start) {
      filteredSpends = filteredSpends.filter(spend => spend.date >= dateRange.start);
    }
    if (dateRange.end) {
      filteredSpends = filteredSpends.filter(spend => spend.date <= dateRange.end);
    }

    // Apply country filter
    const countryFilter = Q('#pdInfFilterCountry')?.value;
    if (countryFilter) {
      filteredSpends = filteredSpends.filter(spend => spend.country === countryFilter);
    }

    const total = filteredSpends.reduce((sum, spend) => sum + (+spend.amount || 0), 0);
    if (totalEl) totalEl.textContent = fmt(total);

    // Populate influencer select - FIXED: Sort by name
    const infSelect = Q('#pdInfSelect');
    if (infSelect) {
      const sortedInfluencers = influencers.influencers.sort((a, b) => a.name.localeCompare(b.name));
      infSelect.innerHTML = '<option value="">Select influencer</option>' +
        sortedInfluencers.map(inf => `<option value="${inf.id}">${inf.name}</option>`).join('');
    }

    if (filteredSpends.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="muted">No influencer spends found</td></tr>';
    } else {
      tbody.innerHTML = filteredSpends.map(spend => {
        const influencer = influencers.influencers.find(inf => inf.id === spend.influencerId);
        const influencerName = influencer ? influencer.name : spend.influencerId;
        const social = influencer ? influencer.social : '';
       
        return `
          <tr>
            <td>${spend.date}</td>
            <td>${spend.country || '-'}</td>
            <td>${influencerName}</td>
            <td>${social || '-'}</td>
            <td>$${fmt(spend.amount)}</td>
            <td>
              <button class="btn small outline act-del-inf-spend" data-id="${spend.id}">Delete</button>
            </td>
          </tr>
        `;
      }).join('');
    }

    // Add delete handlers
    tbody.removeEventListener('click', handleProductInfluencerSpendDelete);
    tbody.addEventListener('click', handleProductInfluencerSpendDelete);
  } catch (error) {
    console.error('Error loading influencers:', error);
    tbody.innerHTML = '<tr><td colspan="6" class="muted">Error loading data</td></tr>';
  }
}

async function handleProductInfluencerSpendDelete(e) {
  if (e.target.classList.contains('act-del-inf-spend')) {
    const spendId = e.target.dataset.id;
    if (confirm('Delete this influencer spend?')) {
      await api(`/api/influencers/spend/${spendId}`, { method: 'DELETE' });
      renderProductInfluencers();
    }
  }
}

// Initialize the application
boot();
