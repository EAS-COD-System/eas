/* ================================================================
   EAS Tracker – Frontend (Complete Rebuild)
   ================================================================ */

const Q = (s, r = document) => r.querySelector(s);
const QA = (s, r = document) => Array.from(r.querySelectorAll(s));
const fmt = n => (Number(n || 0)).toLocaleString(undefined, { maximumFractionDigits: 2 });
const isoToday = () => new Date().toISOString().slice(0, 10);
const getQuery = k => new URLSearchParams(location.search).get(k);
const safeJSON = v => { try { return JSON.parse(v); } catch { return null; } };

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
    if (!res.ok) throw new Error(body?.error || body || ('HTTP ' + res.status));
    return body;
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('API call failed:', error);
    throw error;
  }
}

// Enhanced profit calculation for analytics
async function calculateEnhancedProfitMetrics(productId, country, startDate, endDate) {
  try {
    const remittances = await api('/api/remittances');
    const refunds = await api('/api/refunds');
    const adspend = await api('/api/adspend');
    const productInfo = await api(`/api/product-info/${productId}`);
    
    // Filter data by date range and product/country
    const filteredRemittances = remittances.remittances.filter(r => 
      r.productId === productId && 
      r.country === country &&
      (!startDate || r.start >= startDate) &&
      (!endDate || r.end <= endDate)
    );
    
    const filteredRefunds = refunds.refunds.filter(rf =>
      rf.productId === productId &&
      rf.country === country &&
      (!startDate || rf.date >= startDate) &&
      (!endDate || rf.date <= endDate)
    );
    
    const filteredAdspend = adspend.adSpends.filter(ad =>
      ad.productId === productId &&
      ad.country === country &&
      (!startDate || ad.date >= startDate) &&
      (!endDate || ad.date <= endDate)
    );
    
    // Calculate totals
    const totalRevenue = filteredRemittances.reduce((sum, r) => sum + (+r.revenue || 0), 0);
    const totalRefundedAmount = filteredRefunds.reduce((sum, rf) => sum + (+rf.amount || 0), 0);
    const totalAdSpend = filteredAdspend.reduce((sum, ad) => sum + (+ad.amount || 0), 0);
    const totalBoxleoFees = filteredRemittances.reduce((sum, r) => sum + (+r.boxleoFees || 0), 0);
    const totalDeliveredPieces = filteredRemittances.reduce((sum, r) => sum + (+r.pieces || 0), 0);
    const totalDeliveredOrders = filteredRemittances.reduce((sum, r) => sum + (+r.orders || 0), 0);
    
    // Find cost analysis for this country
    const countryAnalysis = productInfo.costAnalysis.find(ca => ca.country === country);
    const productCostPerPiece = countryAnalysis ? countryAnalysis.productCostChina : 0;
    const shippingCostPerPiece = countryAnalysis ? countryAnalysis.shippingCost : 0;
    
    const totalProductCost = totalDeliveredPieces * productCostPerPiece;
    const totalShippingCost = totalDeliveredPieces * shippingCostPerPiece;
    
    const totalCost = totalProductCost + totalShippingCost + totalAdSpend + totalBoxleoFees;
    const profit = (totalRevenue - totalRefundedAmount) - totalCost;
    
    return {
      totalRevenue: totalRevenue - totalRefundedAmount,
      totalAdSpend,
      totalBoxleoFees,
      totalProductChinaCost: totalProductCost,
      totalShippingCost: totalShippingCost,
      totalCost,
      profit,
      totalDeliveredPieces,
      totalDeliveredOrders,
      productCostPerPiece,
      shippingCostPerPiece,
      isProfitable: profit > 0
    };
  } catch (error) {
    console.error('Error calculating enhanced profit metrics:', error);
    return null;
  }
}

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

async function boot() {
  console.log('Boot starting...');
  try {
    console.log('Checking auth...');
    await api('/api/meta');
    Q('#login')?.classList.add('hide');
    Q('#main')?.removeAttribute('style');
    console.log('Auth successful');
  } catch (error) {
    console.error('Auth failed:', error);
    Q('#login')?.classList.remove('hide');
    Q('#main')?.setAttribute('style', 'display:none');
    return;
  }

  try {
    console.log('Preloading data...');
    await preload();
    console.log('Data preloaded');
    
    console.log('Initializing navigation...');
    bindGlobalNav();
    console.log('Navigation initialized');

    if (state.productId) {
      console.log('Rendering product page...');
      renderProductPage();
    } else {
      console.log('Rendering main pages...');
      renderDashboardPage();
      renderProductsPage();
      renderPerformancePage();
      renderStockMovementPage();
      renderAdspendPage();
      renderFinancePage();
      renderSettingsPage();
    }
    
    setupDailyBackupButton();
    console.log('Boot completed successfully');
  } catch (error) {
    console.error('Boot failed:', error);
    alert('Application initialization failed. Please refresh the page.');
  }
}

// Event Listeners
Q('#loginBtn')?.addEventListener('click', async () => {
  const password = Q('#pw')?.value || '';
  try {
    await api('/api/auth', { method: 'POST', body: JSON.stringify({ password }) });
    await boot();
  } catch (e) {
    alert('Wrong password');
  }
});

Q('#logoutLink')?.addEventListener('click', async (e) => {
  e.preventDefault();
  try { await api('/api/auth', { method: 'POST', body: JSON.stringify({ password: 'logout' }) }); } catch { }
  location.reload();
});

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

async function preload() {
  const meta = await api('/api/meta');
  state.countries = (meta.countries || []).filter(country => country !== 'china');

  const pr = await api('/api/products');
  state.products = pr.products || [];
  state.productsActive = state.products.filter(p => p.status !== 'paused');

  const cats = await api('/api/finance/categories');
  state.categories = cats || { debit: [], credit: [] };

  // Load all shipments for stock calculation
  try {
    console.log('🔄 Preload: Loading shipments...');
    const shipments = await api('/api/shipments');
    state.allShipments = shipments.shipments || [];
    console.log('✅ Preload: Loaded', state.allShipments.length, 'shipments');
  } catch (error) {
    console.error('❌ Preload: Failed to load shipments:', error);
    state.allShipments = [];
  }

  fillCommonSelects();
}

function fillCommonSelects() {
  const countrySelects = ['#adCountry', '#rCountry', '#pdAdCountry', '#pdRCountry',
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

  // Active products only
  const activeProductInputs = ['#mvProduct', '#adProduct', '#rProduct', '#remAddProduct', '#spProduct', '#poProduct', '#refundProduct'];
  activeProductInputs.forEach(sel => QA(sel).forEach(el => {
    if (!el) return;
    const activeProducts = state.products
      .filter(p => p.status === 'active')
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    
    el.innerHTML = `<option value="">Select Product...</option>` +
      activeProducts.map(p => `<option value="${p.id}">${p.name}${p.sku ? ` (${p.sku})` : ''}</option>`).join('');
  }));

  // All products
  const allProductsNewestFirst = ['#pcaProduct', '#remAnalyticsProduct', '#productInfoSelect', '#remProduct'];
  allProductsNewestFirst.forEach(sel => QA(sel).forEach(el => {
    if (!el) return;
    const allProductsSorted = state.products
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    
    if (sel === '#pcaProduct' || sel === '#remAnalyticsProduct') {
      el.innerHTML = `<option value="all">All products</option>` +
        allProductsSorted.map(p => `<option value="${p.id}">${p.name}${p.sku ? ` (${p.sku})` : ''}</option>`).join('');
    } else {
      el.innerHTML = `<option value="all">All products</option>` +
        allProductsSorted.map(p => `<option value="${p.id}">${p.name}${p.sku ? ` (${p.sku})` : ''}</option>`).join('');
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

// ======== PERFORMANCE PAGE ENHANCEMENTS ========
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
        productId,
        sortBy: state.remittanceSortBy,
        sortOrder: state.remittanceSortOrder
      }));

      renderRemittanceAnalytics(analytics.analytics || []);
    } catch (e) {
      alert('Error loading remittance analytics: ' + e.message);
    }
  };
}

function renderRemittanceAnalytics(analytics) {
  const tb = Q('#remAnalyticsBody');
  if (!tb) return;

  let totalPieces = 0, totalRevenue = 0, totalAdSpend = 0, totalBoxleo = 0;
  let totalProductCost = 0, totalShippingCost = 0, totalProfit = 0, totalOrders = 0;
  let totalDeliveredOrders = 0, totalRefundedOrders = 0, totalRefundedAmount = 0, totalInfluencerSpend = 0;
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
    itemCount++;

    const profitClass = item.profit >= 0 ? 'profit-high' : 'loss-high';
    const profitPerOrderClass = item.profitPerOrder >= 0 ? 'profit-medium' : 'loss-medium';
    const profitPerPieceClass = item.profitPerPiece >= 0 ? 'profit-low' : 'loss-low';

    return `
      <tr>
        <td>${item.productName}</td>
        <td>${item.country}</td>
        <td>${fmt(item.totalOrders)}</td>
        <td>${fmt(item.totalDeliveredOrders)}</td>
        <td>${fmt(item.totalRefundedOrders)}</td>
        <td>${fmt(item.totalDeliveredPieces)}</td>
        <td class="number-positive">$${fmt(item.totalRevenue)}</td>
        <td class="number-negative">$${fmt(item.totalRefundedAmount)}</td>
        <td>$${fmt(item.totalAdSpend)}</td>
        <td>$${fmt(item.totalInfluencerSpend)}</td>
        <td>$${fmt(item.totalBoxleoFees)}</td>
        <td>$${fmt(item.totalProductChinaCost)}</td>
        <td>$${fmt(item.totalShippingCost)}</td>
        <td>$${fmt(item.boxleoPerDeliveredOrder)}</td>
        <td>$${fmt(item.boxleoPerDeliveredPiece)}</td>
        <td>$${fmt(item.adCostPerDeliveredOrder)}</td>
        <td>$${fmt(item.adCostPerDeliveredPiece)}</td>
        <td class="${profitPerOrderClass}">$${fmt(item.profitPerOrder)}</td>
        <td class="${profitPerPieceClass}">$${fmt(item.profitPerPiece)}</td>
        <td>${fmt(item.deliveryRate)}%</td>
        <td>$${fmt(item.averageOrderValue)}</td>
        <td class="${profitClass}">$${fmt(item.profit)}</td>
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
  updateTotal('#remAnalyticsProfitT', totalProfit);

  // Add sorting functionality
  addSortingToAnalytics();
}

function bindProfitByCountry() {
  const btn = Q('#pcRun');
  if (!btn) return;

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
}

function renderProfitByCountry(analytics) {
  const tb = Q('#profitCountryBody');
  if (!tb) return;

  let totalPieces = 0, totalRevenue = 0, totalAdSpend = 0, totalBoxleo = 0;
  let totalProductCost = 0, totalShippingCost = 0, totalProfit = 0, totalOrders = 0;
  let totalDeliveredOrders = 0, totalRefundedOrders = 0, totalRefundedAmount = 0, totalInfluencerSpend = 0;
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
    itemCount++;

    const profitClass = item.profit >= 0 ? 'profit-high' : 'loss-high';
    const profitPerOrderClass = item.profitPerOrder >= 0 ? 'profit-medium' : 'loss-medium';
    const profitPerPieceClass = item.profitPerPiece >= 0 ? 'profit-low' : 'loss-low';

    return `
      <tr>
        <td>${item.country}</td>
        <td>${fmt(item.totalOrders)}</td>
        <td>${fmt(item.totalDeliveredOrders)}</td>
        <td>${fmt(item.totalRefundedOrders)}</td>
        <td>${fmt(item.totalDeliveredPieces)}</td>
        <td class="number-positive">$${fmt(item.totalRevenue)}</td>
        <td class="number-negative">$${fmt(item.totalRefundedAmount)}</td>
        <td>$${fmt(item.totalAdSpend)}</td>
        <td>$${fmt(item.totalInfluencerSpend)}</td>
        <td>$${fmt(item.totalProductChinaCost)}</td>
        <td>$${fmt(item.totalShippingCost)}</td>
        <td>$${fmt(item.totalBoxleoFees)}</td>
        <td>$${fmt(item.boxleoPerDeliveredOrder)}</td>
        <td>$${fmt(item.boxleoPerDeliveredPiece)}</td>
        <td>$${fmt(item.adCostPerDeliveredOrder)}</td>
        <td>$${fmt(item.adCostPerDeliveredPiece)}</td>
        <td class="${profitPerOrderClass}">$${fmt(item.profitPerOrder)}</td>
        <td class="${profitPerPieceClass}">$${fmt(item.profitPerPiece)}</td>
        <td>${fmt(item.deliveryRate)}%</td>
        <td>$${fmt(item.averageOrderValue)}</td>
        <td class="${profitClass}">$${fmt(item.profit)}</td>
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
  updateTotal('#pcProfitT', totalProfit);
}

// ======== PRODUCTS PAGE ENHANCEMENTS ========
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

    Q('#pAdd')?.addEventListener('click', async () => {
      const p = {
        name: Q('#pName')?.value.trim(),
        sku: Q('#pSku')?.value.trim()
      };
      if (!p.name) return alert('Name required');
      
      try {
        await api('/api/products', { method: 'POST', body: JSON.stringify(p) });
        
        await preload();
        
        Q('#pName').value = '';
        Q('#pSku').value = '';
        
        renderProductsTable();
        renderCompactCountryStats();
        renderAdvertisingOverview();
        
        fillCommonSelects();
        
        alert('Product added');
      } catch (error) {
        alert('Error adding product: ' + error.message);
      }
    });

    // Fix for product status toggle
    const productsTable = Q('#productsTable');
    if (productsTable) {
      productsTable.addEventListener('click', async (e) => {
        if (e.target.classList.contains('act-toggle')) {
          const productId = e.target.dataset.id;
          const product = state.products.find(p => p.id === productId);
          if (!product) return;
          
          const newStatus = product.status === 'active' ? 'paused' : 'active';
          
          try {
            await api(`/api/products/${productId}/status`, { 
              method: 'POST', 
              body: JSON.stringify({ status: newStatus }) 
            });
            
            await preload();
            renderProductsTable();
            alert(`Product ${newStatus === 'active' ? 'activated' : 'paused'} successfully`);
          } catch (error) {
            alert('Error updating product status: ' + error.message);
          }
        }
      });
    }

  } catch (error) {
    console.error('Error in renderProductsPage:', error);
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

    const profitClass = availableForProfitAndAds >= 0 ? 'profit-medium' : 'loss-medium';

    html += `
      <tr>
        <td>${analysis.country}</td>
        <td>$${fmt(maxCPL)}</td>
        <td class="${profitClass}">$${fmt(availableForProfitAndAds)}</td>
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

// ======== STOCK MOVEMENT ENHANCEMENTS ========
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
          <div class="action-buttons">
            ${!shipment.arrivedAt ? `<button class="btn small outline act-arrive" data-id="${shipment.id}">Arrived</button>` : ''}
            ${shipment.paymentStatus === 'pending' ? `<button class="btn small outline act-pay" data-id="${shipment.id}">Pay</button>` : ''}
            <button class="btn small outline act-edit" data-id="${shipment.id}">Edit</button>
            <button class="btn small outline act-del-ship" data-id="${shipment.id}">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Enhanced event listeners for shipment actions
  tbody.onclick = async (e) => {
    const id = e.target.dataset?.id;
    if (!id) return;

    const shipment = state.allShipments.find(s => s.id === id);
    if (!shipment) return;

    if (e.target.classList.contains('act-arrive')) {
      await api(`/api/shipments/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ arrivedAt: isoToday() })
      });
      renderShipmentTables();
      renderProductsTable();
      renderCompactKpis();
    }

    if (e.target.classList.contains('act-pay')) {
      const finalCost = prompt('Enter final shipping cost:');
      if (finalCost && !isNaN(finalCost)) {
        await api(`/api/shipments/${id}/mark-paid`, {
          method: 'POST',
          body: JSON.stringify({ finalShipCost: +finalCost })
        });
        renderShipmentTables();
      }
    }

    if (e.target.classList.contains('act-edit')) {
      editShipment(shipment);
    }

    if (e.target.classList.contains('act-del-ship')) {
      if (confirm('Delete this shipment?')) {
        await api(`/api/shipments/${id}`, { method: 'DELETE' });
        renderShipmentTables();
        renderProductsTable();
        renderCompactKpis();
      }
    }
  };
}

// ======== ADSPEND ENHANCEMENTS ========
async function renderAdvertisingOverview() {
  return new Promise((resolve) => {
    try {
      const container = Q('#advertisingOverview');
      if (!container) {
        resolve();
        return;
      }

      container.innerHTML = '<div class="card"><div class="muted">Loading advertising data...</div></div>';

      api('/api/adspend').then(adData => {
        const adSpends = adData.adSpends || [];
        
        return api('/api/products').then(productsData => {
          state.products = productsData.products || [];
          return adSpends;
        });
      }).then(adSpends => {
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
              entries: [] // Store individual entries for editing
            };
          }

          // Store individual entry for editing
          byCountry[country][productId].entries.push({
            id: spend.id,
            platform: spend.platform,
            amount: spend.amount,
            date: spend.date
          });

          if (platform === 'facebook') byCountry[country][productId].facebook += amount;
          else if (platform === 'tiktok') byCountry[country][productId].tiktok += amount;
          else if (platform === 'google') byCountry[country][productId].google += amount;

          byCountry[country][productId].total = byCountry[country][productId].facebook + 
                                              byCountry[country][productId].tiktok + 
                                              byCountry[country][productId].google;
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
              <div class="product-name">${product ? product.name : productId}</div>
              <div class="platform-spends">
                ${data.entries.map(entry => `
                  <span class="platform-badge ${entry.amount > 0 ? 'active editable' : ''}" 
                         data-id="${entry.id}"
                         data-platform="${entry.platform}"
                         data-amount="${entry.amount}"
                         data-date="${entry.date}"
                         data-product="${productId}"
                         data-country="${country}">
                    ${entry.platform}: ${fmt(entry.amount)}
                  </span>
                `).join('')}
                <span class="total-badge">Total: ${fmt(data.total)}</span>
              </div>
            </div>`;
          });

          html += `</div>`;
        });

        container.innerHTML = html || '<div class="card"><div class="muted">No advertising data yet</div></div>';
        
        // Add click handlers for editable badges
        container.addEventListener('click', (e) => {
          if (e.target.classList.contains('editable')) {
            editAdSpendEntry(e.target);
          }
        });
        
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

// Edit ad spend entry function
function editAdSpendEntry(badge) {
  const entryId = badge.dataset.id;
  const currentAmount = badge.dataset.amount;
  const platform = badge.dataset.platform;
  const date = badge.dataset.date;
  const productId = badge.dataset.product;
  const country = badge.dataset.country;
  
  const newAmount = prompt(`Edit ${platform} spend for ${date}:`, currentAmount);
  
  if (newAmount !== null && !isNaN(newAmount) && newAmount !== currentAmount) {
    api('/api/adspend', {
      method: 'POST',
      body: JSON.stringify({
        id: entryId, // Include ID for update
        productId: productId,
        country: country,
        platform: platform,
        amount: +newAmount,
        date: date
      })
    }).then(() => {
      renderAdvertisingOverview();
      renderCountryStockSpend();
      renderCompactKpis();
    }).catch(alert);
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
}

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
                <td>Advertising Spend</td>
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
                <td>Advertising Spend</td>
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
                <td><strong>Influencer per Delivered Order</strong></td>
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
    header.addEventListener('click', function() {
      const sortBy = this.textContent.trim().toLowerCase().replace(/\s+/g, '');
      state.remittanceSortOrder = state.remittanceSortBy === sortBy ? 
        (state.remittanceSortOrder === 'desc' ? 'asc' : 'desc') : 'desc';
      state.remittanceSortBy = sortBy;
      
      // Update sort indicators
      headers.forEach(h => {
        h.classList.remove('sort-asc', 'sort-desc');
        if (h.textContent.trim().toLowerCase().replace(/\s+/g, '') === sortBy) {
          h.classList.add(state.remittanceSortOrder === 'asc' ? 'sort-asc' : 'sort-desc');
        }
      });
      
      Q('#remAnalyticsRun').click();
    });
  });
}

function bindProfitByCountry() {
  const btn = Q('#pcRun');
  if (!btn) return;

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
  });
}

function bindRemittanceAdd() {
  const btn = Q('#remAddSave');
  if (!btn) return;

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
}

function bindRefundAdd() {
  const btn = Q('#refundSave');
  if (!btn) return;

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
  Q('#mvFrom')?.addEventListener('change', function() {
    const chinaCostField = Q('#chinaCostField');
    if (this.value === 'china') {
      chinaCostField.style.display = 'block';
    } else {
      chinaCostField.style.display = 'none';
    }
  });

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
      alert('Stock movement added');
      
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
}

async function renderShipmentTables() {
  try {
    const shipments = await api('/api/shipments');
    
    // Filter out arrived shipments from transit tables
    const transitShipments = shipments.shipments.filter(s => !s.arrivedAt);
    
    // China → Kenya shipments (transit only)
    const chinaKenyaShipments = transitShipments.filter(s => 
      s.fromCountry === 'china' && s.toCountry === 'kenya'
    );
    renderShipmentTable('#shipCKBody', chinaKenyaShipments, true);
    
    // Inter-country shipments (transit only, excluding China → Kenya)
    const interCountryShipments = transitShipments.filter(s => 
      s.fromCountry !== 'china' || s.toCountry !== 'kenya'
    );
    renderShipmentTable('#shipICBody', interCountryShipments, false);
  } catch (e) {
    console.error('Error loading shipments:', e);
  }
}

// Update the renderShipmentTable function to include all 4 buttons
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
          <div class="action-buttons">
            ${!shipment.arrivedAt ? `<button class="btn small outline act-arrive" data-id="${shipment.id}">Arrived</button>` : ''}
            ${shipment.paymentStatus === 'pending' ? `<button class="btn small outline act-pay" data-id="${shipment.id}">Pay</button>` : ''}
            <button class="btn small outline act-edit" data-id="${shipment.id}">Edit</button>
            <button class="btn small outline act-del-ship" data-id="${shipment.id}">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Enhanced event listeners for shipment actions
  tbody.onclick = async (e) => {
    const id = e.target.dataset?.id;
    if (!id) return;

    const shipment = state.allShipments.find(s => s.id === id);
    if (!shipment) return;

    if (e.target.classList.contains('act-arrive')) {
      await api(`/api/shipments/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ arrivedAt: isoToday() })
      });
      renderShipmentTables();
      renderProductsTable();
      renderCompactKpis();
    }

    if (e.target.classList.contains('act-pay')) {
      const finalCost = prompt('Enter final shipping cost:');
      if (finalCost && !isNaN(finalCost)) {
        await api(`/api/shipments/${id}/mark-paid`, {
          method: 'POST',
          body: JSON.stringify({ finalShipCost: +finalCost })
        });
        renderShipmentTables();
      }
    }

    if (e.target.classList.contains('act-edit')) {
      editShipment(shipment);
    }

    if (e.target.classList.contains('act-del-ship')) {
      if (confirm('Delete this shipment?')) {
        await api(`/api/shipments/${id}`, { method: 'DELETE' });
        renderShipmentTables();
        renderProductsTable();
        renderCompactKpis();
      }
    }
  };
}

// Edit shipment function
function editShipment(shipment) {
  const newQty = prompt('Enter new quantity:', shipment.qty);
  const newShipCost = prompt('Enter new shipping cost:', shipment.shipCost);
  const newNote = prompt('Enter new note:', shipment.note || '');
  
  if (newQty !== null && newShipCost !== null) {
    const updateData = {
      qty: +newQty || 0,
      shipCost: +newShipCost || 0,
      note: newNote || ''
    };
    
    if (shipment.fromCountry === 'china') {
      const newChinaCost = prompt('Enter new China cost:', shipment.chinaCost || 0);
      if (newChinaCost !== null) {
        updateData.chinaCost = +newChinaCost || 0;
      }
    }
    
    api(`/api/shipments/${shipment.id}`, {
      method: 'PUT',
      body: JSON.stringify(updateData)
    }).then(() => {
      renderShipmentTables();
      renderProductsTable();
      renderCompactKpis();
    }).catch(alert);
  }
}
// ======== ADSPEND PAGE ========
function renderAdspendPage() {
  bindAdspendDaily();
  bindAdspendAnalytics();
  renderAdvertisingOverview();
}

function bindAdspendDaily() {
  const btn = Q('#adspendSave');
  if (!btn) return;

  btn.onclick = async () => {
    const payload = {
      date: isoToday(),
      productId: Q('#adspendProduct')?.value,
      country: Q('#adspendCountry')?.value,
      platform: Q('#adspendPlatform')?.value,
      amount: +Q('#adspendAmount')?.value || 0
    };

    if (!payload.productId || !payload.country || !payload.platform) {
      return alert('Fill all fields');
    }

    try {
      await api('/api/adspend', { method: 'POST', body: JSON.stringify(payload) });
      alert('Ad spend saved');
      Q('#adspendAmount').value = '';
      renderAdvertisingOverview();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };
}

function bindAdspendAnalytics() {
  const btn = Q('#adspendRun');
  if (!btn) return;

  btn.onclick = async () => {
    const dateRange = getDateRange(btn.closest('.row'));
    const country = Q('#adspendFilterCountry')?.value || '';
    const productId = Q('#adspendFilterProduct')?.value || '';
    const platform = Q('#adspendFilterPlatform')?.value || '';

    try {
      const adSpends = await api('/api/adspend');
      let filteredSpends = adSpends.adSpends || [];

      // Apply filters
      if (dateRange.start) {
        filteredSpends = filteredSpends.filter(ad => ad.date >= dateRange.start);
      }
      if (dateRange.end) {
        filteredSpends = filteredSpends.filter(ad => ad.date <= dateRange.end);
      }
      if (country) {
        filteredSpends = filteredSpends.filter(ad => ad.country === country);
      }
      if (productId && productId !== 'all') {
        filteredSpends = filteredSpends.filter(ad => ad.productId === productId);
      }
      if (platform) {
        filteredSpends = filteredSpends.filter(ad => ad.platform === platform);
      }

      renderAdspendResults(filteredSpends);
    } catch (e) {
      alert('Error loading ad spend data: ' + e.message);
    }
  };
}

function renderAdspendResults(adSpends) {
  const container = Q('#adspendResults');
  if (!container) return;

  const total = adSpends.reduce((sum, ad) => sum + (+ad.amount || 0), 0);
  const byPlatform = {};
  const byCountry = {};
  const byProduct = {};

  adSpends.forEach(ad => {
    // Platform breakdown
    byPlatform[ad.platform] = (byPlatform[ad.platform] || 0) + (+ad.amount || 0);
    
    // Country breakdown
    byCountry[ad.country] = (byCountry[ad.country] || 0) + (+ad.amount || 0);
    
    // Product breakdown
    const product = state.products.find(p => p.id === ad.productId);
    const productName = product ? product.name : ad.productId;
    byProduct[productName] = (byProduct[productName] || 0) + (+ad.amount || 0);
  });

  let html = `
    <div class="adspend-summary">
      <div class="summary-stats">
        <div class="stat-card">
          <div class="stat-label">Total Ad Spend</div>
          <div class="stat-value">$${fmt(total)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Number of Entries</div>
          <div class="stat-value">${adSpends.length}</div>
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
  if (chipsContainer) {
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
  }

  // Add new category
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
}

function bindFinanceEntries() {
  const btn = Q('#feAdd');
  if (!btn) return;

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

  // Filter entries
  Q('#feRun')?.addEventListener('click', () => {
    renderFinanceEntries();
  });

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
    tbody.onclick = async (e) => {
      if (e.target.classList.contains('act-del-entry')) {
        if (confirm('Delete this entry?')) {
          await api(`/api/finance/entries/${e.target.dataset.id}`, { method: 'DELETE' });
          renderFinanceEntries();
          renderFinanceBalance();
        }
      }
    };
  } catch (e) {
    console.error('Error loading finance entries:', e);
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
}

function bindProductEdit() {
  const select = Q('#epSelect');
  if (!select) return;

  // Populate product select
  select.innerHTML = '<option value="">Select product…</option>' +
    state.products.map(p => `<option value="${p.id}">${p.name}${p.sku ? ` (${p.sku})` : ''}</option>`).join('');

  select.addEventListener('change', function() {
    const product = state.products.find(p => p.id === this.value);
    if (product) {
      Q('#epName').value = product.name || '';
      Q('#epSku').value = product.sku || '';
    }
  });

  Q('#epSave')?.addEventListener('click', async () => {
    const productId = select.value;
    const name = Q('#epName')?.value?.trim();
    const sku = Q('#epSku')?.value?.trim();

    if (!productId || !name) return alert('Select product and enter name');

    await api(`/api/products/${productId}`, {
      method: 'PUT',
      body: JSON.stringify({ name, sku })
    });

    await preload();
    fillCommonSelects();
    alert('Product updated');
  });
}

function renderSnapshots() {
  const tbody = Q('#snapList');
  if (!tbody) return;

  api('/api/snapshots').then(data => {
    const snapshots = data.snapshots || [];
    
    if (snapshots.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="muted">No snapshots yet</td></tr>';
      return;
    }

    tbody.innerHTML = snapshots.map(snap => `
      <tr>
        <td>${snap.name}</td>
        <td><code>${snap.file}</code></td>
        <td>${new Date(snap.createdAt).toLocaleString()}</td>
        <td>
          <button class="btn small outline snap-restore" data-file="${snap.file}">Restore</button>
          <button class="btn small outline snap-del" data-id="${snap.id}">Delete</button>
        </td>
      </tr>
    `).join('');
  }).catch(console.error);
}

function bindSnapshotActions() {
  // Save snapshot
  Q('#snapSave')?.addEventListener('click', async () => {
    const name = Q('#snapName')?.value?.trim();
    if (!name) return alert('Enter snapshot name');

    try {
      await api('/api/snapshots', {
        method: 'POST',
        body: JSON.stringify({ name })
      });
      
      Q('#snapName').value = '';
      renderSnapshots();
      alert('Snapshot saved');
    } catch (e) {
      alert('Error: ' + e.message);
    }
  });

  // Snapshot actions
  Q('#snapList')?.addEventListener('click', async (e) => {
    if (e.target.classList.contains('snap-restore')) {
      const file = e.target.dataset.file;
      if (confirm('Restore this snapshot? Current data will be replaced.')) {
        try {
          await api('/api/backup/push-snapshot', {
            method: 'POST',
            body: JSON.stringify({ snapshotFile: file })
          });
          alert('Snapshot restored! Page will reload.');
          setTimeout(() => location.reload(), 1000);
        } catch (error) {
          alert('Error restoring: ' + error.message);
        }
      }
    }

    if (e.target.classList.contains('snap-del')) {
      const id = e.target.dataset.id;
      if (confirm('Delete this snapshot?')) {
        await api(`/api/snapshots/${id}`, { method: 'DELETE' });
        renderSnapshots();
      }
    }
  });
}

function setupDailyBackupButton() {
  const btn = Q('#createDailyBackup');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const backupName = `Manual-Daily-${today}`;
      
      await api('/api/snapshots', {
        method: 'POST',
        body: JSON.stringify({ name: backupName })
      });
      
      renderSnapshots();
      alert('Daily backup created successfully!');
    } catch (error) {
      alert('Error creating backup: ' + error.message);
    }
  });
}

// ======== PRODUCT PAGE ========
function renderProductPage() {
  if (!state.productId) return;
  
  renderProductHeader();
  renderProductStockSpend();
  renderProductNotes();
  renderProductProfitBudgets();
  renderProductShipments();
  renderProductLifetimePerformance();
  
  fillProductPageSelects();
}

function renderProductHeader() {
  const product = state.products.find(p => p.id === state.productId);
  if (!product) return;

  Q('#pdTitle').textContent = product.name;
  Q('#pdSku').textContent = product.sku ? `SKU: ${product.sku}` : '';
}

async function renderProductStockSpend() {
  const tbody = Q('#pdStockBody');
  if (!tbody) return;

  try {
    const stockByCountry = await calculateStockByCountry(state.productId);
    const adSpends = await api('/api/adspend');
    
    let totalStock = 0, totalFb = 0, totalTt = 0, totalGg = 0, totalAd = 0;
    
    const adBreakdown = {};
    state.countries.forEach(country => {
      adBreakdown[country] = { facebook: 0, tiktok: 0, google: 0 };
    });

    (adSpends.adSpends || []).forEach(ad => {
      if (ad.productId === state.productId && adBreakdown[ad.country]) {
        const amount = +ad.amount || 0;
        if (ad.platform === 'facebook') adBreakdown[ad.country].facebook += amount;
        else if (ad.platform === 'tiktok') adBreakdown[ad.country].tiktok += amount;
        else if (ad.platform === 'google') adBreakdown[ad.country].google += amount;
      }
    });

    tbody.innerHTML = state.countries.map(country => {
      const stock = stockByCountry[country] || 0;
      const adData = adBreakdown[country] || { facebook: 0, tiktok: 0, google: 0 };
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

    Q('#pdStockTotal').textContent = fmt(totalStock);
    Q('#pdFbTotal').textContent = fmt(totalFb);
    Q('#pdTtTotal').textContent = fmt(totalTt);
    Q('#pdGgTotal').textContent = fmt(totalGg);
    Q('#pdAdTotal').textContent = fmt(totalAd);
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="6" class="muted">Error loading data</td></tr>';
  }
}

function renderProductNotes() {
  const container = Q('#pdNotesList');
  if (!container) return;

  api(`/api/products/${state.productId}/notes`).then(data => {
    const notes = data.notes || [];
    
    if (notes.length === 0) {
      container.innerHTML = '<div class="muted">No notes yet. Add your first note above.</div>';
      return;
    }

    container.innerHTML = notes.map(note => `
      <div class="note-card">
        <div class="note-header">
          <span class="note-country">${note.country}</span>
          <button class="btn small outline note-del" data-id="${note.id}">Delete</button>
        </div>
        <div class="note-content">${note.note}</div>
        <div class="note-date">Last updated: ${new Date(note.updatedAt).toLocaleDateString()}</div>
      </div>
    `).join('');

    // Add delete handlers
    container.addEventListener('click', async (e) => {
      if (e.target.classList.contains('note-del')) {
        if (confirm('Delete this note?')) {
          await api(`/api/products/notes/${e.target.dataset.id}`, { method: 'DELETE' });
          renderProductNotes();
        }
      }
    });
  }).catch(console.error);

  // Bind save note
  Q('#pdNoteSave')?.addEventListener('click', async () => {
    const country = Q('#pdNoteCountry')?.value;
    const note = Q('#pdNoteText')?.value?.trim();

    if (!country || !note) return alert('Select country and enter note');

    await api(`/api/products/${state.productId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ country, note })
    });

    Q('#pdNoteText').value = '';
    renderProductNotes();
  });
}

function renderProductProfitBudgets() {
  const tbody = Q('#pdPBBBody');
  if (!tbody) return;

  // This would require additional API endpoints for the automated calculation
  // For now, we'll show a placeholder
  tbody.innerHTML = '<tr><td colspan="8" class="muted">Profit budget calculation coming soon</td></tr>';
}

async function renderProductShipments() {
  try {
    const shipments = await api('/api/shipments');
    
    // Filter shipments for this product
    const productShipments = shipments.shipments.filter(s => s.productId === state.productId);
    
    // Arrived shipments
    const arrivedShipments = productShipments.filter(s => s.arrivedAt);
    
    // Transit shipments
    const transitShipments = productShipments.filter(s => !s.arrivedAt);
    
    // China → Kenya shipments (transit)
    const chinaKenyaShipments = transitShipments.filter(s => 
      s.fromCountry === 'china' && s.toCountry === 'kenya'
    );
    
    // Inter-country shipments (transit)
    const interCountryShipments = transitShipments.filter(s => 
      s.fromCountry !== 'china' || s.toCountry !== 'kenya'
    );
    
    // Render arrived shipments
    renderProductArrivedShipments(arrivedShipments);
    
    // Render transit shipments
    renderProductTransitShipments('#pdShipCKBody', chinaKenyaShipments, true);
    renderProductTransitShipments('#pdShipICBody', interCountryShipments, false);
    
  } catch (error) {
    console.error('Error loading product shipments:', error);
  }
}

function renderProductArrivedShipments(shipments) {
  const tbody = Q('#pdArrivedBody');
  if (!tbody) return;

  if (shipments.length === 0) {
    tbody.innerHTML = '<tr><td colspan="12" class="muted">No arrived shipments</td></tr>';
    return;
  }

  tbody.innerHTML = shipments.map(shipment => {
    const product = state.products.find(p => p.id === shipment.productId);
    const productName = product ? product.name : shipment.productId;
    const route = `${shipment.fromCountry} → ${shipment.toCountry}`;
    
    // Calculate days in transit
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
          ${shipment.paymentStatus === 'pending' ? `<button class="btn small outline act-pay" data-id="${shipment.id}">Pay</button>` : ''}
          <button class="btn small outline act-del-ship" data-id="${shipment.id}">Delete</button>
        </td>
      </tr>
    `;
  }).join('');

  // Add event listeners
  tbody.onclick = async (e) => {
    const id = e.target.dataset?.id;
    if (!id) return;

    if (e.target.classList.contains('act-pay')) {
      const finalCost = prompt('Enter final shipping cost:');
      if (finalCost && !isNaN(finalCost)) {
        await api(`/api/shipments/${id}/mark-paid`, {
          method: 'POST',
          body: JSON.stringify({ finalShipCost: +finalCost })
        });
        renderProductShipments();
      }
    }

    if (e.target.classList.contains('act-del-ship')) {
      if (confirm('Delete this shipment?')) {
        await api(`/api/shipments/${id}`, { method: 'DELETE' });
        renderProductShipments();
      }
    }
  };
}

function renderProductTransitShipments(selector, shipments, showChinaCost) {
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
          ${shipment.paymentStatus === 'pending' && shipment.arrivedAt ? `<button class="btn small outline act-pay" data-id="${shipment.id}">Pay</button>` : ''}
          <button class="btn small outline act-del-ship" data-id="${shipment.id}">Delete</button>
        </td>
      </tr>
    `;
  }).join('');

  // Add event listeners
  tbody.onclick = async (e) => {
    const id = e.target.dataset?.id;
    if (!id) return;

    if (e.target.classList.contains('act-arrive')) {
      await api(`/api/shipments/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ arrivedAt: isoToday() })
      });
      renderProductShipments();
    }

    if (e.target.classList.contains('act-pay')) {
      const finalCost = prompt('Enter final shipping cost:');
      if (finalCost && !isNaN(finalCost)) {
        await api(`/api/shipments/${id}/mark-paid`, {
          method: 'POST',
          body: JSON.stringify({ finalShipCost: +finalCost })
        });
        renderProductShipments();
      }
    }

    if (e.target.classList.contains('act-del-ship')) {
      if (confirm('Delete this shipment?')) {
        await api(`/api/shipments/${id}`, { method: 'DELETE' });
        renderProductShipments();
      }
    }
  };
}

function renderProductLifetimePerformance() {
  const btn = Q('#pdLPRun');
  if (!btn) return;

  btn.onclick = async () => {
    const dateRange = getDateRange(btn.closest('.row'));
    
    try {
      const metrics = await api('/api/product-costs-analysis?' + new URLSearchParams({
        productId: state.productId,
        ...dateRange
      }));

      renderProductLifetimePerformanceResults(metrics);
    } catch (e) {
      alert('Error loading performance data: ' + e.message);
    }
  };
}

function renderProductLifetimePerformanceResults(metrics) {
  const tbody = Q('#pdLPBody');
  if (!tbody) return;

  // For now, show aggregate data
  tbody.innerHTML = `
    <tr>
      <td>All Countries</td>
      <td>$${fmt(metrics.totalRevenue)}</td>
      <td>$${fmt(metrics.totalRefundedAmount)}</td>
      <td>$${fmt(metrics.totalAdSpend)}</td>
      <td>$${fmt(metrics.totalInfluencerSpend)}</td>
      <td>$${fmt(metrics.totalBoxleoFees)}</td>
      <td>$${fmt(metrics.totalProductChinaCost)}</td>
      <td>$${fmt(metrics.totalShippingCost)}</td>
      <td>$${fmt(metrics.totalCost)}</td>
      <td>${fmt(metrics.totalOrders)}</td>
      <td>${fmt(metrics.totalDeliveredOrders)}</td>
      <td>${fmt(metrics.totalRefundedOrders)}</td>
      <td>${fmt(metrics.totalDeliveredPieces)}</td>
      <td>$${fmt(metrics.profitPerOrder)}</td>
      <td>$${fmt(metrics.profitPerPiece)}</td>
      <td>${fmt(metrics.deliveryRate)}%</td>
      <td class="${metrics.profit >= 0 ? 'number-positive' : 'number-negative'}">$${fmt(metrics.profit)}</td>
    </tr>
  `;

  // Update totals
  const updateTotal = (id, value) => {
    const el = Q(id);
    if (el) el.textContent = typeof value === 'number' ? fmt(value) : value;
  };

  updateTotal('#pdLPRevT', metrics.totalRevenue);
  updateTotal('#pdLPRefundedT', metrics.totalRefundedAmount);
  updateTotal('#pdLPAdT', metrics.totalAdSpend);
  updateTotal('#pdLPInfluencerT', metrics.totalInfluencerSpend);
  updateTotal('#pdLPBoxleoT', metrics.totalBoxleoFees);
  updateTotal('#pdLPProductCostT', metrics.totalProductChinaCost);
  updateTotal('#pdLPShipT', metrics.totalShippingCost);
  updateTotal('#pdLPTotalCostT', metrics.totalCost);
  updateTotal('#pdLPOrdersT', metrics.totalOrders);
  updateTotal('#pdLPDeliveredOrdersT', metrics.totalDeliveredOrders);
  updateTotal('#pdLPRefundedOrdersT', metrics.totalRefundedOrders);
  updateTotal('#pdLPDeliveredPiecesT', metrics.totalDeliveredPieces);
  updateTotal('#pdLPProfitOrderT', `$${fmt(metrics.profitPerOrder)}`);
  updateTotal('#pdLPProfitPieceT', `$${fmt(metrics.profitPerPiece)}`);
  updateTotal('#pdLPDeliveryRateT', `${fmt(metrics.deliveryRate)}%`);
  updateTotal('#pdLPProfitT', metrics.profit);
}

function fillProductPageSelects() {
  // Fill country selects for product page
  const countrySelects = ['#pdNoteCountry', '#pdInfCountry', '#pdInfFilterCountry'];
  countrySelects.forEach(sel => {
    const el = Q(sel);
    if (el) {
      el.innerHTML = '<option value="">Select country...</option>' +
        state.countries.map(c => `<option value="${c}">${c}</option>`).join('');
    }
  });
}

// ======== FIXED NAVIGATION ========
function bindGlobalNav() {
  console.log('🔄 Setting up navigation...');
  
  const navLinks = QA('.nav a[data-view]');
  const mainSections = QA('.container > section');
  
  console.log('📍 Found nav links:', navLinks.length);
  console.log('📍 Found sections:', mainSections.length);
  
  // Hide all sections first
  mainSections.forEach(section => {
    section.style.display = 'none';
  });
  
  // Add click listeners to nav links
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const viewName = link.getAttribute('data-view');
      console.log('🎯 Navigation clicked:', viewName);
      
      // Remove active class from all links
      navLinks.forEach(l => l.classList.remove('active'));
      
      // Add active class to clicked link
      link.classList.add('active');
      
      // Hide all sections
      mainSections.forEach(section => {
        section.style.display = 'none';
      });
      
      // Show the selected section
      const targetSection = document.getElementById(viewName);
      if (targetSection) {
        targetSection.style.display = 'block';
        console.log('✅ Showing section:', viewName);
      } else {
        console.log('❌ Section not found:', viewName);
      }
    });
  });
  
  // Show home section by default
  const homeSection = document.getElementById('home');
  const homeLink = document.querySelector('.nav a[data-view="home"]');
  if (homeSection && homeLink) {
    homeSection.style.display = 'block';
    homeLink.classList.add('active');
    console.log('🏠 Default section: home');
  }
}

// ======== INITIALIZATION ========
document.addEventListener('DOMContentLoaded', boot);
