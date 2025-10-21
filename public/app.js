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
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
  
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
  allShipments: [] // Added to store all shipments for stock calculation
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
    initSimpleNavigation();
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
    const shipments = await api('/api/shipments');
    state.allShipments = shipments.shipments || [];
    console.log('Loaded shipments:', state.allShipments.length);
  } catch (error) {
    console.error('Failed to load shipments:', error);
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

// FIXED: Proper stock calculation function
function calculateStockByCountry(productId = null) {
  const stockByCountry = {};
  
  // Initialize all countries with 0 stock
  state.countries.forEach(country => {
    stockByCountry[country] = 0;
  });

  // Process all shipments to calculate current stock
  state.allShipments.forEach(shipment => {
    // If productId is specified, only count shipments for that product
    if (productId && shipment.productId !== productId) return;

    const fromCountry = shipment.fromCountry || shipment.from;
    const toCountry = shipment.toCountry || shipment.to;
    const quantity = shipment.qty || 0;

    if (shipment.arrivedAt) {
      // Shipment has arrived: add to destination country ONLY
      if (stockByCountry[toCountry] !== undefined) {
        stockByCountry[toCountry] += quantity;
      }
      // DO NOT subtract from source country when shipment arrives
      // The subtraction already happened when the shipment was created/departed
    } else {
      // Shipment is in transit: subtract from source country
      if (stockByCountry[fromCountry] !== undefined && fromCountry !== 'china') {
        stockByCountry[fromCountry] -= quantity;
      }
    }
  });

  return stockByCountry;
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

// ======== DASHBOARD ========
function renderDashboardPage() {
  renderCompactKpis();
  renderCountryStockSpend();
  bindDailyAdSpend();
  renderWeeklyDelivered();
  initBrainstorming();
  initTodos();
  initTestedProducts();
}

async function renderCompactKpis() {
  Q('#kpiProducts') && (Q('#kpiProducts').textContent = state.products.length);
  Q('#kpiCountries') && (Q('#kpiCountries').textContent = state.countries.length);

  try {
    // Use our fixed stock calculation
    const stockByCountry = calculateStockByCountry();
    let activeStock = 0;
    let inactiveStock = 0;
    
    state.countries.forEach(country => {
      const stock = stockByCountry[country] || 0;
      if (stock > 0) activeStock += stock;
      if (stock < 0) inactiveStock += Math.abs(stock);
    });

    // Calculate transit pieces
    const chinaTransit = state.allShipments
      .filter(shipment => !shipment.arrivedAt && (shipment.fromCountry || shipment.from) === 'china')
      .reduce((total, shipment) => total + (shipment.qty || 0), 0);
    
    const interCountryTransit = state.allShipments
      .filter(shipment => !shipment.arrivedAt && (shipment.fromCountry || shipment.from) !== 'china')
      .reduce((total, shipment) => total + (shipment.qty || 0), 0);

    Q('#kpiChinaTransit') && (Q('#kpiChinaTransit').textContent = chinaTransit);
    Q('#kpiInterTransit') && (Q('#kpiInterTransit').textContent = interCountryTransit);
    Q('#kpiActiveStock') && (Q('#kpiActiveStock').textContent = activeStock);
    Q('#kpiInactiveStock') && (Q('#kpiInactiveStock').textContent = inactiveStock);
  } catch { 
    Q('#kpiChinaTransit') && (Q('#kpiChinaTransit').textContent = '—');
    Q('#kpiInterTransit') && (Q('#kpiInterTransit').textContent = '—');
    Q('#kpiActiveStock') && (Q('#kpiActiveStock').textContent = '—');
    Q('#kpiInactiveStock') && (Q('#kpiInactiveStock').textContent = '—');
  }

  try {
    const a = await api('/api/adspend');
    const total = (a.adSpends || []).reduce((t, x) => t + (+x.amount || 0), 0);
    Q('#kpiAdSpend') && (Q('#kpiAdSpend').textContent = `${fmt(total)} USD`);
  } catch { Q('#kpiAdSpend') && (Q('#kpiAdSpend').textContent = '—'); }

  const t = Q('#wAllT')?.textContent || '0';
  Q('#kpiDelivered') && (Q('#kpiDelivered').textContent = t);
}

async function renderCountryStockSpend() {
  const body = Q('#stockByCountryBody'); if (!body) return;
  body.innerHTML = '<tr><td colspan="6">Loading…</td></tr>';

  try {
    // Use our fixed stock calculation instead of backend data
    const stockByCountry = calculateStockByCountry();
    
    let st = 0, fb = 0, tt = 0, gg = 0, totalAd = 0;
    
    // Get ad spend breakdown
    const adSpends = await api('/api/adspend');
    const adBreakdown = {};
    
    state.countries.forEach(country => {
      adBreakdown[country] = { facebook: 0, tiktok: 0, google: 0 };
    });

    (adSpends.adSpends || []).forEach(ad => {
      const product = state.products.find(p => p.id === ad.productId);
      if (product && product.status === 'active' && adBreakdown[ad.country]) {
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

      return `<tr>
        <td>${country}</td>
        <td>${fmt(stock)}</td>
        <td>${fmt(adData.facebook)}</td>
        <td>${fmt(adData.tiktok)}</td>
        <td>${fmt(adData.google)}</td>
        <td>${fmt(countryAdTotal)}</td>
      </tr>`;
    }).join('');

    body.innerHTML = rows || `<tr><td colspan="6" class="muted">No data</td></tr>`;
    Q('#stockTotal') && (Q('#stockTotal').textContent = fmt(st));
    Q('#fbTotal') && (Q('#fbTotal').textContent = fmt(fb));
    Q('#ttTotal') && (Q('#ttTotal').textContent = fmt(tt));
    Q('#ggTotal') && (Q('#ggTotal').textContent = fmt(gg));
    Q('#adTotal') && (Q('#adTotal').textContent = fmt(totalAd));
  } catch (error) {
    body.innerHTML = `<tr><td colspan="6" class="muted">Error loading data</td></tr>`;
    console.error('Dashboard error:', error);
  }
}

function bindDailyAdSpend() {
  const btn = Q('#adSave');
  if (!btn) return;
  btn.onclick = async () => {
    const payload = {
      productId: Q('#adProduct')?.value,
      country: Q('#adCountry')?.value,
      platform: Q('#adPlatform')?.value,
      amount: +Q('#adAmount')?.value || 0
    };
    if (!payload.productId || !payload.country || !payload.platform) return alert('Fill all fields');
    try {
      await api('/api/adspend', { method: 'POST', body: JSON.stringify(payload) });
      await renderCountryStockSpend();
      await renderCompactKpis();
      alert('Ad spend saved');
    } catch (e) { alert(e.message); }
  };
}

function mondayOf(dateISO) {
  const d = new Date(dateISO);
  const k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k);
  return d;
}

function weekDays(fromMonDate) {
  return [...Array(7)].map((_, i) => {
    const t = new Date(fromMonDate); t.setDate(t.getDate() + i);
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

  Q('#weeklyPrev')?.addEventListener('click', () => { const d = new Date(anchor); d.setDate(d.getDate() - 7); anchor = d.toISOString().slice(0, 10); updateGrid(); });
  Q('#weeklyNext')?.addEventListener('click', () => { const d = new Date(anchor); d.setDate(d.getDate() + 7); anchor = d.toISOString().slice(0, 10); updateGrid(); });
  Q('#weeklyReset')?.addEventListener('click', () => { QA('.wd-cell').forEach(el => el.value = ''); computeWeeklyTotals(); });
  Q('#weeklyTable')?.addEventListener('input', (e) => { if (e.target.classList.contains('wd-cell')) computeWeeklyTotals(); });
  Q('#weeklySave')?.addEventListener('click', async () => {
    const payload = [];
    QA('.wd-cell').forEach(inp => {
      const val = +inp.value || 0;
      if (val > 0) payload.push({ date: inp.dataset.date, country: inp.dataset.country, delivered: val });
    });
    try {
      for (const row of payload) await api('/api/deliveries', { method: 'POST', body: JSON.stringify(row) });
      alert('Weekly deliveries saved');
    } catch (e) { alert('Save failed: ' + e.message); }
  });

  updateGrid();
}

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

function initTodos() {
  const KEY = 'eas_todos', WKEY = 'eas_weekly';
  const load = k => safeJSON(localStorage.getItem(k)) || (k === WKEY ? {} : []);
  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  const listEl = Q('#todoList'); const addBtn = Q('#todoAdd');
  function renderQuick() {
    const arr = load(KEY);
    listEl.innerHTML = arr.map(t => `<div class="flex">
      <span>${t.done ? '✅ ' : ''}${t.text}</span>
      <button class="btn outline" data-done="${t.id}">${t.done ? 'Undo' : 'Done'}</button>
      <button class="btn outline" data-del="${t.id}">Delete</button>
    </div>`).join('') || '<div class="muted">No tasks</div>';
  }
  addBtn?.addEventListener('click', () => {
    const v = Q('#todoText')?.value.trim(); if (!v) return;
    const arr = load(KEY); arr.push({ id: crypto.randomUUID(), text: v, done: false }); save(KEY, arr); Q('#todoText').value = ''; renderQuick();
  });
  listEl?.addEventListener('click', (e) => {
    if (e.target.dataset.done) {
      const arr = load(KEY);
      const it = arr.find(x => x.id === e.target.dataset.done);
      it.done = !it.done; save(KEY, arr); renderQuick();
    }
    if (e.target.dataset.del) {
      const arr = load(KEY);
      const idx = arr.findIndex(x => x.id === e.target.dataset.del); arr.splice(idx, 1); save(KEY, arr); renderQuick();
    }
  });
  renderQuick();

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const wrap = Q('#weeklyWrap');
  function renderWeekly() {
    const data = load(WKEY);
    wrap.innerHTML = days.map(d => {
      const arr = data[d] || [];
      return `<div class="card">
        <div class="h">${d}</div>
        <div class="row"><input id="w_${d}" class="input" placeholder="Task"/><button class="btn" data-add="${d}">Add</button></div>
        <div class="list">${arr.map(t => `<div class="flex"><span>${t.done ? '✅ ' : ''}${t.text}</span>
          <button class="btn outline" data-tgl="${d}|${t.id}">${t.done ? 'Undo' : 'Done'}</button>
          <button class="btn outline" data-del="${d}|${t.id}">Delete</button>
        </div>`).join('')}</div>
      </div>`;
    }).join('');
  }
  wrap?.addEventListener('click', (e) => {
    const data = load(WKEY);
    if (e.target.dataset.add) {
      const d = e.target.dataset.add, v = Q('#w_' + d)?.value.trim(); if (!v) return;
      data[d] = data[d] || []; data[d].push({ id: crypto.randomUUID(), text: v, done: false }); save(WKEY, data); renderWeekly();
    }
    if (e.target.dataset.tgl) {
      const [d, id] = e.target.dataset.tgl.split('|'); const it = (data[d] || []).find(x => x.id === id); it.done = !it.done; save(WKEY, data); renderWeekly();
    }
    if (e.target.dataset.del) {
      const [d, id] = e.target.dataset.del.split('|'); const arr = (data[d] || []); const i = arr.findIndex(x => x.id === id); arr.splice(i, 1); data[d] = arr; save(WKEY, data); renderWeekly();
    }
  });
  renderWeekly();
}

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

// ======== PRODUCTS PAGE ========
function renderProductsPage() {
  renderCompactCountryStats();
  renderAdvertisingOverview();
  initDateRangeSelectors();

  Q('#pAdd')?.addEventListener('click', async () => {
    const p = {
      name: Q('#pName')?.value.trim(),
      sku: Q('#pSku')?.value.trim()
    };
    if (!p.name) return alert('Name required');
    await api('/api/products', { method: 'POST', body: JSON.stringify(p) });
    await preload();
    renderProductsTable();
    renderCompactCountryStats();
    renderAdvertisingOverview();
    alert('Product added');
  });

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
    alert('Selling price saved');
  });

  renderProductsTable();
  renderProductInfoSection();
}

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
  
  tb.innerHTML = state.products.map(p => {
    let rowClass = '';
    if (!p.hasData) {
      rowClass = 'no-data-row';
    } else if (p.isProfitable) {
      rowClass = 'profit-row';
    } else {
      rowClass = 'loss-row';
    }

    // Use our fixed stock calculation for each product
    const stockByCountry = calculateStockByCountry(p.id);
    const kenyaStock = stockByCountry.kenya || 0;
    const kenyaAdSpend = p.adSpendByCountry?.kenya || 0;
    const tanzaniaStock = stockByCountry.tanzania || 0;
    const tanzaniaAdSpend = p.adSpendByCountry?.tanzania || 0;
    const ugandaStock = stockByCountry.uganda || 0;
    const ugandaAdSpend = p.adSpendByCountry?.uganda || 0;
    const zambiaStock = stockByCountry.zambia || 0;
    const zambiaAdSpend = p.adSpendByCountry?.zambia || 0;
    const zimbabweStock = stockByCountry.zimbabwe || 0;
    const zimbabweAdSpend = p.adSpendByCountry?.zimbabwe || 0;

    return `
    <tr class="${rowClass}">
      <td>${p.name}</td>
      <td>${p.sku || '-'}</td>
      <td><span class="badge ${p.status === 'paused' ? 'muted' : ''}">${p.status || 'active'}</span></td>
      <td>${fmt(p.totalStock || 0)}</td>
      <td>${fmt(p.transitPieces || 0)}</td>
      <td>${fmt(p.totalPiecesIncludingTransit || 0)}</td>
      <td>${fmt(kenyaStock)}</td>
      <td>${fmt(kenyaAdSpend)}</td>
      <td>${fmt(tanzaniaStock)}</td>
      <td>${fmt(tanzaniaAdSpend)}</td>
      <td>${fmt(ugandaStock)}</td>
      <td>${fmt(ugandaAdSpend)}</td>
      <td>${fmt(zambiaStock)}</td>
      <td>${fmt(zambiaAdSpend)}</td>
      <td>${fmt(zimbabweStock)}</td>
      <td>${fmt(zimbabweAdSpend)}</td>
      <td>
        <a class="btn" href="/product.html?id=${p.id}">Open</a>
        <button class="btn outline act-toggle" data-id="${p.id}">${p.status === 'active' ? 'Pause' : 'Run'}</button>
        <button class="btn outline act-del" data-id="${p.id}">Delete</button>
      </td>
    </tr>
  `}).join('') || `<tr><td colspan="17" class="muted">No products</td></tr>`;

  tb.onclick = async (e) => {
    const id = e.target.dataset?.id; if (!id) return;
    if (e.target.classList.contains('act-toggle')) {
      const p = state.products.find(x => x.id === id); const ns = p.status === 'active' ? 'paused' : 'active';
      await api(`/api/products/${id}/status`, { method: 'POST', body: JSON.stringify({ status: ns }) });
      await preload(); renderProductsTable(); renderCompactCountryStats(); renderAdvertisingOverview();
    }
    if (e.target.classList.contains('act-del')) {
      if (!confirm('Delete product and ALL its data?')) return;
      await api(`/api/products/${id}`, { method: 'DELETE' });
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

    try {
      const productInfo = await api(`/api/product-info/${productId}`);
      renderProductInfoResults(productInfo);
    } catch (e) {
      alert('Error loading product info: ' + e.message);
    }
  };
}

function renderProductInfoResults(productInfo) {
  const container = Q('#productInfoResults');
  if (!container) return;

  const { product, costAnalysis } = productInfo;

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
                <th>Selling Price</th>
                <th>Max Cost Per Lead</th>
                <th>Product Cost China</th>
                <th>Shipping Cost</th>
                <th>Total Product Cost</th>
                <th>Available for Profit & Ads</th>
                <th>Delivery Rate</th>
                <th>Boxleo/Order</th>
              </tr>
            </thead>
            <tbody>
  `;

  costAnalysis.forEach(analysis => {
    html += `
      <tr>
        <td>${analysis.country}</td>
        <td>$${fmt(analysis.sellingPrice)}</td>
        <td>$${fmt(analysis.maxCPL)}</td>
        <td>$${fmt(analysis.productCostChina)}</td>
        <td>$${fmt(analysis.shippingCost)}</td>
        <td>$${fmt(analysis.totalProductCost)}</td>
        <td class="${analysis.availableForProfitAndAds >= 0 ? 'number-positive' : 'number-negative'}">$${fmt(analysis.availableForProfitAndAds)}</td>
        <td>${fmt(analysis.deliveryRate)}%</td>
        <td>$${fmt(analysis.boxleoPerOrder)}</td>
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
        productId
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
  let totalAOV = 0;
  let itemCount = 0;

  analytics.sort((a, b) => b.totalDeliveredPieces - a.totalDeliveredPieces);

  tb.innerHTML = analytics.map(item => {
    const product = state.products.find(p => p.id === item.productId) || { name: item.productId };

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
    itemCount++;

    return `<tr>
      <td>${product.name}</td>
      <td>${item.country}</td>
      <td><strong>${fmt(item.totalOrders)}</strong></td>
      <td><strong>${fmt(item.totalDeliveredOrders)}</strong></td>
      <td><strong>${fmt(item.totalRefundedOrders)}</strong></td>
      <td><strong>${fmt(item.totalDeliveredPieces)}</strong></td>
      <td>${fmt(item.totalRevenue)}</td>
      <td class="number-negative">${fmt(item.totalRefundedAmount)}</td>
      <td>${fmt(item.totalAdSpend)}</td>
      <td>${fmt(item.totalInfluencerSpend)}</td>
      <td>${fmt(item.totalBoxleoFees)}</td>
      <td>${fmt(item.totalProductChinaCost)}</td>
      <td>${fmt(item.totalShippingCost)}</td>
      <td>$${fmt(item.boxleoPerDeliveredOrder)}</td>
      <td>$${fmt(item.boxleoPerDeliveredPiece)}</td>
      <td>$${fmt(item.adCostPerDeliveredOrder)}</td>
      <td>$${fmt(item.adCostPerDeliveredPiece)}</td>
      <td>${fmt(item.deliveryRate)}%</td>
      <td>$${fmt(item.averageOrderValue)}</td>
      <td class="${item.profit >= 0 ? 'number-positive' : 'number-negative'}">${fmt(item.profit)}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="20" class="muted">No data for selected period</td></tr>`;

  const totalDeliveryRate = totalOrders > 0 ? (totalDeliveredOrders / totalOrders) * 100 : 0;
  const avgBoxleoPerOrder = itemCount > 0 ? totalBoxleoPerOrder / itemCount : 0;
  const avgBoxleoPerPiece = itemCount > 0 ? totalBoxleoPerPiece / itemCount : 0;
  const avgAdCostPerOrder = itemCount > 0 ? totalAdCostPerOrder / itemCount : 0;
  const avgAdCostPerPiece = itemCount > 0 ? totalAdCostPerPiece / itemCount : 0;
  const avgAOV = itemCount > 0 ? totalAOV / itemCount : 0;

  Q('#remAnalyticsOrdersT') && (Q('#remAnalyticsOrdersT').textContent = fmt(totalOrders));
  Q('#remAnalyticsDeliveredOrdersT') && (Q('#remAnalyticsDeliveredOrdersT').textContent = fmt(totalDeliveredOrders));
  Q('#remAnalyticsRefundedOrdersT') && (Q('#remAnalyticsRefundedOrdersT').textContent = fmt(totalRefundedOrders));
  Q('#remAnalyticsDeliveredPiecesT') && (Q('#remAnalyticsDeliveredPiecesT').textContent = fmt(totalPieces));
  Q('#remAnalyticsRevenueT') && (Q('#remAnalyticsRevenueT').textContent = fmt(totalRevenue));
  Q('#remAnalyticsRefundedAmountT') && (Q('#remAnalyticsRefundedAmountT').textContent = fmt(totalRefundedAmount));
  Q('#remAnalyticsAdSpendT') && (Q('#remAnalyticsAdSpendT').textContent = fmt(totalAdSpend));
  Q('#remAnalyticsInfluencerSpendT') && (Q('#remAnalyticsInfluencerSpendT').textContent = fmt(totalInfluencerSpend));
  Q('#remAnalyticsBoxleoT') && (Q('#remAnalyticsBoxleoT').textContent = fmt(totalBoxleo));
  Q('#remAnalyticsProductCostT') && (Q('#remAnalyticsProductCostT').textContent = fmt(totalProductCost));
  Q('#remAnalyticsShippingCostT') && (Q('#remAnalyticsShippingCostT').textContent = fmt(totalShippingCost));
  Q('#remAnalyticsBoxleoOrderT') && (Q('#remAnalyticsBoxleoOrderT').textContent = '$' + fmt(avgBoxleoPerOrder));
  Q('#remAnalyticsBoxleoPieceT') && (Q('#remAnalyticsBoxleoPieceT').textContent = '$' + fmt(avgBoxleoPerPiece));
  Q('#remAnalyticsAdOrderT') && (Q('#remAnalyticsAdOrderT').textContent = '$' + fmt(avgAdCostPerOrder));
  Q('#remAnalyticsAdPieceT') && (Q('#remAnalyticsAdPieceT').textContent = '$' + fmt(avgAdCostPerPiece));
  Q('#remAnalyticsDeliveryRateT') && (Q('#remAnalyticsDeliveryRateT').textContent = fmt(totalDeliveryRate) + '%');
  Q('#remAnalyticsAOVT') && (Q('#remAnalyticsAOVT').textContent = '$' + fmt(avgAOV));
  Q('#remAnalyticsProfitT') && (Q('#remAnalyticsProfitT').textContent = fmt(totalProfit));
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
        country
      }));

      renderProfitByCountry(analytics.analytics || {});
    } catch (e) {
      alert('Error calculating profit: ' + e.message);
    }
  };
}

function renderProfitByCountry(analytics) {
  const tb = Q('#profitCountryBody');
  if (!tb) return;

  let totalRevenue = 0, totalAdSpend = 0, totalBoxleo = 0;
  let totalProductCost = 0, totalShippingCost = 0, totalProfit = 0, totalOrders = 0;
  let totalDeliveredOrders = 0, totalPieces = 0, totalRefundedOrders = 0, totalRefundedAmount = 0, totalInfluencerSpend = 0;
  let totalBoxleoPerOrder = 0, totalBoxleoPerPiece = 0, totalAdCostPerOrder = 0, totalAdCostPerPiece = 0;
  let totalAOV = 0;
  let itemCount = 0;

  tb.innerHTML = Object.entries(analytics).map(([country, metrics]) => {
    totalRevenue += metrics.totalRevenue || 0;
    totalAdSpend += metrics.totalAdSpend || 0;
    totalBoxleo += metrics.totalBoxleoFees || 0;
    totalProductCost += metrics.totalProductChinaCost || 0;
    totalShippingCost += metrics.totalShippingCost || 0;
    totalProfit += metrics.profit || 0;
    totalOrders += metrics.totalOrders || 0;
    totalDeliveredOrders += metrics.totalDeliveredOrders || 0;
    totalPieces += metrics.totalDeliveredPieces || 0;
    totalRefundedOrders += metrics.totalRefundedOrders || 0;
    totalRefundedAmount += metrics.totalRefundedAmount || 0;
    totalInfluencerSpend += metrics.totalInfluencerSpend || 0;
    totalBoxleoPerOrder += metrics.boxleoPerDeliveredOrder || 0;
    totalBoxleoPerPiece += metrics.boxleoPerDeliveredPiece || 0;
    totalAdCostPerOrder += metrics.adCostPerDeliveredOrder || 0;
    totalAdCostPerPiece += metrics.adCostPerDeliveredPiece || 0;
    totalAOV += metrics.averageOrderValue || 0;
    itemCount++;

    return `<tr>
      <td>${country}</td>
      <td>${fmt(metrics.totalOrders)}</td>
      <td>${fmt(metrics.totalDeliveredOrders)}</td>
      <td>${fmt(metrics.totalRefundedOrders)}</td>
      <td>${fmt(metrics.totalDeliveredPieces)}</td>
      <td>${fmt(metrics.totalRevenue)}</td>
      <td class="number-negative">${fmt(metrics.totalRefundedAmount)}</td>
      <td>${fmt(metrics.totalAdSpend)}</td>
      <td>${fmt(metrics.totalInfluencerSpend)}</td>
      <td>${fmt(metrics.totalProductChinaCost)}</td>
      <td>${fmt(metrics.totalShippingCost)}</td>
      <td>${fmt(metrics.totalBoxleoFees)}</td>
      <td>$${fmt(metrics.boxleoPerDeliveredOrder)}</td>
      <td>$${fmt(metrics.boxleoPerDeliveredPiece)}</td>
      <td>$${fmt(metrics.adCostPerDeliveredOrder)}</td>
      <td>$${fmt(metrics.adCostPerDeliveredPiece)}</td>
      <td>${fmt(metrics.deliveryRate)}%</td>
      <td>$${fmt(metrics.averageOrderValue)}</td>
      <td class="${metrics.profit >= 0 ? 'number-positive' : 'number-negative'}">${fmt(metrics.profit)}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="19" class="muted">No data</td></tr>`;

  const totalDeliveryRate = totalOrders > 0 ? (totalDeliveredOrders / totalOrders) * 100 : 0;
  const avgBoxleoPerOrder = itemCount > 0 ? totalBoxleoPerOrder / itemCount : 0;
  const avgBoxleoPerPiece = itemCount > 0 ? totalBoxleoPerPiece / itemCount : 0;
  const avgAdCostPerOrder = itemCount > 0 ? totalAdCostPerOrder / itemCount : 0;
  const avgAdCostPerPiece = itemCount > 0 ? totalAdCostPerPiece / itemCount : 0;
  const avgAOV = itemCount > 0 ? totalAOV / itemCount : 0;

  Q('#pcOrdersT') && (Q('#pcOrdersT').textContent = fmt(totalOrders));
  Q('#pcDeliveredOrdersT') && (Q('#pcDeliveredOrdersT').textContent = fmt(totalDeliveredOrders));
  Q('#pcRefundedOrdersT') && (Q('#pcRefundedOrdersT').textContent = fmt(totalRefundedOrders));
  Q('#pcDeliveredPiecesT') && (Q('#pcDeliveredPiecesT').textContent = fmt(totalPieces));
  Q('#pcRevT') && (Q('#pcRevT').textContent = fmt(totalRevenue));
  Q('#pcRefundedAmountT') && (Q('#pcRefundedAmountT').textContent = fmt(totalRefundedAmount));
  Q('#pcAdT') && (Q('#pcAdT').textContent = fmt(totalAdSpend));
  Q('#pcInfluencerSpendT') && (Q('#pcInfluencerSpendT').textContent = fmt(totalInfluencerSpend));
  Q('#pcProductCostT') && (Q('#pcProductCostT').textContent = fmt(totalProductCost));
  Q('#pcShippingCostT') && (Q('#pcShippingCostT').textContent = fmt(totalShippingCost));
  Q('#pcBoxleoT') && (Q('#pcBoxleoT').textContent = fmt(totalBoxleo));
  Q('#pcBoxleoOrderT') && (Q('#pcBoxleoOrderT').textContent = '$' + fmt(avgBoxleoPerOrder));
  Q('#pcBoxleoPieceT') && (Q('#pcBoxleoPieceT').textContent = '$' + fmt(avgBoxleoPerPiece));
  Q('#pcAdOrderT') && (Q('#pcAdOrderT').textContent = '$' + fmt(avgAdCostPerOrder));
  Q('#pcAdPieceT') && (Q('#pcAdPieceT').textContent = '$' + fmt(avgAdCostPerPiece));
  Q('#pcDeliveryRateT') && (Q('#pcDeliveryRateT').textContent = fmt(totalDeliveryRate) + '%');
  Q('#pcAOVT') && (Q('#pcAOVT').textContent = '$' + fmt(avgAOV));
  Q('#pcProfitT') && (Q('#pcProfitT').textContent = fmt(totalProfit));
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
      return alert('Please fill all required fields: Start Date, End Date, Country, and Product');
    }

    try {
      await api('/api/remittances', { method: 'POST', body: JSON.stringify(payload) });
      alert('Remittance entry added successfully!');
      Q('#remAddOrders').value = '';
      Q('#remAddPieces').value = '';
      Q('#remAddRevenue').value = '';
      Q('#remAddAdSpend').value = '';
      Q('#remAddBoxleo').value = '';
    } catch (e) {
      if (e.message.includes('Duplicate remittance period')) {
        const confirmAdd = confirm('You already entered a remittance for this product in this country during this period. Are you sure you want to enter again?');
        if (confirmAdd) {
          await api('/api/remittances/force', { method: 'POST', body: JSON.stringify(payload) });
          alert('Remittance entry added successfully!');
          Q('#remAddOrders').value = '';
          Q('#remAddPieces').value = '';
          Q('#remAddRevenue').value = '';
          Q('#remAddAdSpend').value = '';
          Q('#remAddBoxleo').value = '';
        }
      } else {
        alert('Error adding remittance: ' + e.message);
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
      return alert('Please fill all required fields: Date, Country, and Product');
    }

    try {
      await api('/api/refunds', { method: 'POST', body: JSON.stringify(payload) });
      alert('Refund entry added successfully!');
      Q('#refundDate').value = '';
      Q('#refundOrders').value = '';
      Q('#refundPieces').value = '';
      Q('#refundAmount').value = '';
      Q('#refundReason').value = '';
    } catch (e) {
      alert('Error adding refund: ' + e.message);
    }
  };
}

// ======== STOCK MOVEMENT PAGE ========
function renderStockMovementPage() {
  Q('#mvFrom')?.addEventListener('change', function () {
    const chinaField = Q('#chinaCostField');
    if (this.value === 'china') {
      chinaField.style.display = 'block';
    } else {
      chinaField.style.display = 'none';
      Q('#mvChinaCost').value = '';
    }
  });

  const btn = Q('#mvAdd');
  if (!btn) return;

  btn.onclick = async () => {
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

    try {
      await api('/api/shipments', { method: 'POST', body: JSON.stringify(payload) });
      // Reload shipments for accurate stock calculation
      const shipments = await api('/api/shipments');
      state.allShipments = shipments.shipments || [];
      await renderTransitTables();
      await renderCountryStockSpend();
      await renderCompactKpis();
      alert('Shipment created');
      Q('#mvQty').value = '';
      Q('#mvShip').value = '';
      Q('#mvChinaCost').value = '';
      Q('#mvNote').value = '';
    } catch (e) { alert(e.message); }
  };

  renderTransitTables();
}

async function renderTransitTables() {
  const tbl1 = Q('#shipCKBody'), tbl2 = Q('#shipICBody');
  if (!tbl1 && !tbl2) return;

  const s = await api('/api/shipments');
  state.allShipments = s.shipments || [];
  const live = (s.shipments || []).filter(x => !x.arrivedAt);
  const prodMap = Object.fromEntries(state.products.map(p => [p.id, p.name]));

  const row = sp => {
    const paymentBadge = sp.paymentStatus === 'paid' 
      ? `<span class="badge success">Paid</span>` 
      : `<span class="badge warning">Pending</span>`;
    
    return `<tr>
      <td>${sp.id}</td>
      <td>${prodMap[sp.productId] || sp.productId}</td>
      <td>${sp.fromCountry || sp.from} → ${sp.toCountry || sp.to}</td>
      <td>${fmt(sp.qty)}</td>
      <td>${fmt(sp.shipCost)}</td>
      <td>${sp.finalShipCost ? fmt(sp.finalShipCost) : '-'}</td>
      <td>${sp.fromCountry === 'china' ? fmt(sp.chinaCost) : '-'}</td>
      <td>${sp.departedAt || ''}</td>
      <td>${sp.arrivedAt || ''}</td>
      <td>${paymentBadge}</td>
      <td>${sp.note || ''}</td>
      <td>
        ${sp.paymentStatus !== 'paid' ? `<button class="btn outline act-pay" data-id="${sp.id}">Mark Paid</button>` : ''}
        <button class="btn outline act-arr" data-id="${sp.id}">Arrived</button>
        <button class="btn outline act-edit" data-id="${sp.id}">Edit</button>
        <button class="btn outline act-del" data-id="${sp.id}">Delete</button>
      </td>
    </tr>`;
  };

  const ck = live.filter(sp => (sp.fromCountry || sp.from || '').toLowerCase() === 'china' && (sp.toCountry || sp.to || '').toLowerCase() === 'kenya');
  const ic = live.filter(sp => !ck.includes(sp));

  if (tbl1) tbl1.innerHTML = ck.map(row).join('') || `<tr><td colspan="12" class="muted">No transit</td></tr>`;
  if (tbl2) tbl2.innerHTML = ic.map(row).join('') || `<tr><td colspan="11" class="muted">No transit</td></tr>`;

  const host = Q('#stockMovement') || document;
  host.removeEventListener('click', handleShipmentActions);
  host.addEventListener('click', handleShipmentActions);
}

async function handleShipmentActions(e) {
  const id = e.target.dataset?.id;
  if (!id) return;

  if (e.target.classList.contains('act-pay')) {
    const finalCost = prompt('Final shipping cost paid (USD):', '0');
    if (!finalCost || isNaN(finalCost)) return;
    
    try {
      await api(`/api/shipments/${id}/mark-paid`, { 
        method: 'POST', 
        body: JSON.stringify({ finalShipCost: +finalCost }) 
      });
      await renderTransitTables();
    } catch (err) { 
      alert(err.message); 
    }
  }

  if (e.target.classList.contains('act-arr')) {
    const date = prompt('Arrival date (YYYY-MM-DD)', isoToday());
    if (!date) return;
    try { 
      await api(`/api/shipments/${id}`, { method: 'PUT', body: JSON.stringify({ arrivedAt: date }) }); 
      // Reload shipments for accurate stock calculation
      const shipments = await api('/api/shipments');
      state.allShipments = shipments.shipments || [];
      await renderTransitTables();
      await renderCountryStockSpend();
      await renderCompactKpis();
    } catch (err) { 
      alert(err.message); 
    }
  }

  if (e.target.classList.contains('act-edit')) {
    const shipCost = +prompt('New estimated shipping cost?', '0') || 0;
    const note = prompt('Note?', '') || '';
    try { 
      await api(`/api/shipments/${id}`, { method: 'PUT', body: JSON.stringify({ shipCost, note }) }); 
      await renderTransitTables();
    } catch (err) { 
      alert(err.message); 
    }
  }

  if (e.target.classList.contains('act-del')) {
    if (!confirm('Delete shipment?')) return;
    try { 
      await api(`/api/shipments/${id}`, { method: 'DELETE' }); 
      // Reload shipments for accurate stock calculation
      const shipments = await api('/api/shipments');
      state.allShipments = shipments.shipments || [];
      await renderTransitTables();
      await renderCountryStockSpend();
      await renderCompactKpis();
    } catch (err) { 
      alert(err.message); 
    }
  }
}

// ======== FINANCE PAGE ========
function renderFinancePage() {
  refreshFinanceCategories();

  Q('#fcAdd')?.addEventListener('click', async () => {
    const type = Q('#fcType')?.value, name = Q('#fcName')?.value.trim();
    if (!name) return;
    await api('/api/finance/categories', { method: 'POST', body: JSON.stringify({ type, name }) });
    Q('#fcName').value = ''; await refreshFinanceCategories();
  });

  Q('#finance')?.addEventListener('click', async (e) => {
    if (e.target.classList.contains('chip-x')) {
      const type = e.target.dataset.type, name = e.target.dataset.name;
      if (!confirm(`Delete category "${name}"?`)) return;
      await api(`/api/finance/categories?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}`, { method: 'DELETE' });
      await refreshFinanceCategories();
    }
  });

  Q('#feAdd')?.addEventListener('click', async () => {
    const date = Q('#feDate')?.value,
      cat = Q('#feCat')?.value,
      amt = +Q('#feAmt')?.value || 0,
      note = Q('#feNote')?.value || '';

    if (!date || !cat) return alert('Pick date & category');

    const type = state.categories.credit.includes(cat) ? 'credit' : 'debit';
    await api('/api/finance/entries', { method: 'POST', body: JSON.stringify({ date, type, category: cat, amount: amt, note }) });
    Q('#feAmt').value = ''; Q('#feNote').value = '';
    await runFinancePeriod();
  });

  Q('#fcSearchRun')?.addEventListener('click', runFinanceCategorySearch);
  Q('#feRun')?.addEventListener('click', runFinancePeriod);

  runFinancePeriod();
}

async function refreshFinanceCategories() {
  const cats = await api('/api/finance/categories');
  state.categories = cats;
  const mk = (arr, type) => arr.map(c => `<span class="chip">${c}<button class="chip-x" data-type="${type}" data-name="${c}">×</button></span>`).join('') || '—';
  Q('#fcDebits') && (Q('#fcDebits').innerHTML = mk(cats.debit, 'debit'));
  Q('#fcCredits') && (Q('#fcCredits').innerHTML = mk(cats.credit, 'credit'));

  const all = [...cats.debit, ...cats.credit].sort();
  Q('#feCat') && (Q('#feCat').innerHTML = `<option value="" disabled selected>Select category</option>` + all.map(c => `<option>${c}</option>`).join(''));

  Q('#fcSearchCat') && (Q('#fcSearchCat').innerHTML = `<option value="">All categories</option>` + all.map(c => `<option>${c}</option>`).join(''));
}

async function runFinancePeriod() {
  const s = Q('#fes')?.value, e = Q('#fee')?.value;
  const r = await api('/api/finance/entries' + ((s || e) ? `?start=${s || ''}&end=${e || ''}` : ''));
  Q('#runBalance') && (Q('#runBalance').textContent = fmt(r.running || 0) + ' USD');
  Q('#feBalance') && (Q('#feBalance').textContent = 'Period Balance: ' + fmt(r.balance || 0) + ' USD');
  const tb = Q('#feTable tbody');
  tb && (tb.innerHTML = (r.entries || []).map(x => `
    <tr>
      <td>${x.date}</td>
      <td>${x.type}</td>
      <td>${x.category}</td>
      <td>${fmt(x.amount)}</td>
      <td>${x.note || ''}</td>
      <td><button class="btn outline fe-del" data-id="${x.id}">Delete</button></td>
    </tr>
  `).join('') || `<tr><td colspan="6" class="muted">No entries</td></tr>`);
  tb?.addEventListener('click', async (e) => {
    if (e.target.classList.contains('fe-del')) {
      await api(`/api/finance/entries/${e.target.dataset.id}`, { method: 'DELETE' });
      await runFinancePeriod();
    }
  });
}

async function runFinanceCategorySearch() {
  const s = Q('#fcSearchStart')?.value,
    e = Q('#fcSearchEnd')?.value,
    cat = Q('#fcSearchCat')?.value,
    type = Q('#fcSearchType')?.value;

  if (!s || !e) return alert('Select date range');

  const r = await api(`/api/finance/entries?start=${s}&end=${e}` + (cat ? `&category=${cat}` : '') + (type ? `&type=${type}` : ''));

  Q('#fcSearchResult') && (Q('#fcSearchResult').textContent = `Total: ${fmt(r.categoryTotal || 0)} USD`);
  Q('#fcSearchCount') && (Q('#fcSearchCount').textContent = `Entries: ${r.entries?.length || 0}`);
}

// ======== SETTINGS PAGE ========
function renderSettingsPage() {
  Q('#ctyAdd')?.addEventListener('click', async () => {
    const name = Q('#cty')?.value.trim(); if (!name) return;
    await api('/api/countries', { method: 'POST', body: JSON.stringify({ name }) });
    await preload(); renderCountryChips();
  });

  renderCountryChips();

  Q('#ctyList')?.addEventListener('click', async (e) => {
    if (e.target.classList.contains('chip-x')) {
      const name = e.target.dataset.name;
      if (!confirm(`Delete country "${name}"?`)) return;
      await api(`/api/countries/${encodeURIComponent(name)}`, { method: 'DELETE' });
      await preload(); renderCountryChips(); fillCommonSelects();
    }
  });

  const sel = Q('#epSelect');
  if (sel) {
    sel.innerHTML = `<option value="">Select product…</option>` +
      state.products.map(p => `<option value="${p.id}">${p.name}${p.sku ? ` (${p.sku})` : ''}</option>`).join('');
    sel.onchange = () => {
      const p = state.products.find(x => x.id === sel.value);
      if (!p) return;
      Q('#epName').value = p.name || ''; Q('#epSku').value = p.sku || '';
    };

    Q('#epSave')?.addEventListener('click', async () => {
      const id = sel.value; if (!id) return alert('Pick a product');
      const up = {
        name: Q('#epName').value, sku: Q('#epSku').value
      };
      await api(`/api/products/${id}`, { method: 'PUT', body: JSON.stringify(up) });
      await preload(); alert('Saved');
    });
  }

  const listBox = Q('#snapList');
  async function refreshSnaps() {
    const r = await api('/api/snapshots');
    listBox.innerHTML = (r.snapshots || []).map(s => `
      <tr>
        <td>${s.name}</td>
        <td>${s.file.replace(/^.*data\\?\\/, '')}</td>
        <td>${new Date(s.createdAt).toLocaleDateString()}</td>
        <td style="width: 200px;">
          <button class="btn outline ss-push" data-file="${s.file}" data-id="${s.id}">Push</button>
          <button class="btn outline ss-del" data-id="${s.id}">Delete</button>
        </td>
      </tr>`).join('') || `<tr><td colspan="4" class="muted">No snapshots</td></tr>`;
  }
  refreshSnaps();

  Q('#snapSave')?.addEventListener('click', async () => {
    const name = Q('#snapName')?.value.trim() || ('Manual ' + new Date().toLocaleString());
    await api('/api/snapshots', { method: 'POST', body: JSON.stringify({ name }) });
    Q('#snapName').value = '';
    await refreshSnaps();
  });

  listBox?.addEventListener('click', async (e) => {
    if (e.target.classList.contains('ss-push')) {
      if (!confirm('Push this snapshot to the system? This will replace current data.')) return;
      try {
        await api('/api/backup/push-snapshot', { 
          method: 'POST', 
          body: JSON.stringify({ snapshotFile: e.target.dataset.file }) 
        });
        alert('✅ Snapshot pushed successfully! System will reload.');
        location.reload();
      } catch (error) {
        alert('❌ Failed to push snapshot: ' + error.message);
      }
    }
    
    if (e.target.classList.contains('ss-del')) {
      if (!confirm('Delete this snapshot?')) return;
      await api(`/api/snapshots/${e.target.dataset.id}`, { method: 'DELETE' });
      await refreshSnaps();
    }
  });
}

function renderCountryChips() {
  const box = Q('#ctyList'); if (!box) return;
  box.innerHTML = state.countries.map(c => `<span class="chip">${c}<button class="chip-x" data-name="${c}">×</button></span>`).join('') || '—';
}

// ======== PRODUCT PAGE ========
async function renderProductPage() {
  await preload();
  const product = state.products.find(p => p.id === state.productId);
  if (!product) { alert('Product not found'); location.href = '/'; return; }

  Q('#pdTitle') && (Q('#pdTitle').textContent = product.name);
  Q('#pdSku') && (Q('#pdSku').textContent = product.sku ? `SKU: ${product.sku}` : '');

  initDateRangeSelectors();
  await renderProductStockAd(product);
  renderProductBudgets(product);
  await renderProductTransit(product);
  await renderProductArrivedShipments(product);
  bindProductLifetime(product);
  await renderProductStoreOrders(product);
  await renderProductRemittances(product);
  await renderProductRefunds(product);
  await bindInfluencers(product);
  bindProductNotes(product);
}

async function renderProductStockAd(product) {
  const tb = Q('#pdStockBody'); if (!tb) return;
  
  try {
    // Use our fixed stock calculation instead of backend data
    const stockByCountry = calculateStockByCountry(product.id);
    
    const adSpends = await api('/api/adspend');
    
    const adBreakdown = {};
    state.countries.forEach(country => {
      adBreakdown[country] = { facebook: 0, tiktok: 0, google: 0 };
    });

    (adSpends.adSpends || []).forEach(ad => {
      if (ad.productId === product.id && adBreakdown[ad.country]) {
        const amount = +ad.amount || 0;
        if (ad.platform === 'facebook') adBreakdown[ad.country].facebook += amount;
        else if (ad.platform === 'tiktok') adBreakdown[ad.country].tiktok += amount;
        else if (ad.platform === 'google') adBreakdown[ad.country].google += amount;
      }
    });

    let st = 0, fb = 0, tt = 0, gg = 0, totalAd = 0;
    
    const rows = state.countries.map(country => {
      const countryStock = stockByCountry[country] || 0;
      const adData = adBreakdown[country] || { facebook: 0, tiktok: 0, google: 0 };
      const countryAdTotal = adData.facebook + adData.tiktok + adData.google;

      st += countryStock;
      fb += adData.facebook;
      tt += adData.tiktok;
      gg += adData.google;
      totalAd += countryAdTotal;

      return `<tr>
        <td>${country}</td>
        <td>${fmt(countryStock)}</td>
        <td>${fmt(adData.facebook)}</td>
        <td>${fmt(adData.tiktok)}</td>
        <td>${fmt(adData.google)}</td>
        <td>${fmt(countryAdTotal)}</td>
      </tr>`;
    }).join('');

    tb.innerHTML = rows || `<tr><td colspan="6" class="muted">No data</td></tr>`;
    Q('#pdStockTotal') && (Q('#pdStockTotal').textContent = fmt(st));
    Q('#pdFbTotal') && (Q('#pdFbTotal').textContent = fmt(fb));
    Q('#pdTtTotal') && (Q('#pdTtTotal').textContent = fmt(tt));
    Q('#pdGgTotal') && (Q('#pdGgTotal').textContent = fmt(gg));
    Q('#pdAdTotal') && (Q('#pdAdTotal').textContent = fmt(totalAd));
  } catch (error) {
    tb.innerHTML = `<tr><td colspan="6" class="muted">Error loading data</td></tr>`;
  }
}

function renderProductBudgets(product) {
  const tb = Q('#pdPBBBody');
  if (!tb) return;

  api(`/api/product-info/${product.id}`).then(productInfo => {
    const { costAnalysis } = productInfo;

    tb.innerHTML = costAnalysis.map(analysis => `
      <tr>
        <td>${analysis.country}</td>
        <td>$${fmt(analysis.sellingPrice)}</td>
        <td>$${fmt(analysis.productCostChina)}</td>
        <td>$${fmt(analysis.shippingCost)}</td>
        <td>$${fmt(analysis.totalProductCost)}</td>
        <td>$${fmt(analysis.maxCPL)}</td>
        <td>${fmt(analysis.deliveryRate)}%</td>
        <td class="${analysis.availableForProfitAndAds >= 0 ? 'number-positive' : 'number-negative'}">$${fmt(analysis.availableForProfitAndAds)}</td>
        <td>$${fmt(analysis.boxleoPerOrder)}</td>
      </tr>
    `).join('') || `<tr><td colspan="9" class="muted">No data available</td></tr>`;
  }).catch(() => {
    tb.innerHTML = `<tr><td colspan="9" class="muted">Error loading cost data</td></tr>`;
  });
}

async function renderProductTransit(product) {
  await renderProductTransitTables(product);
}

async function renderProductTransitTables(product) {
  const tbl1 = Q('#pdShipCKBody'), tbl2 = Q('#pdShipICBody');
  if (!tbl1 && !tbl2) return;

  const s = await api('/api/shipments');
  state.allShipments = s.shipments || [];
  const live = (s.shipments || []).filter(x => !x.arrivedAt && x.productId === product.id);

  const row = sp => {
    const paymentBadge = sp.paymentStatus === 'paid' 
      ? `<span class="badge success">Paid</span>` 
      : `<span class="badge warning">Pending</span>`;
    
    return `<tr>
      <td>${sp.id}</td>
      <td>${sp.fromCountry || sp.from} → ${sp.toCountry || sp.to}</td>
      <td>${fmt(sp.qty)}</td>
      <td>${fmt(sp.shipCost)}</td>
      <td>${sp.finalShipCost ? fmt(sp.finalShipCost) : '-'}</td>
      <td>${sp.fromCountry === 'china' ? fmt(sp.chinaCost) : '-'}</td>
      <td>${sp.departedAt || ''}</td>
      <td>${sp.arrivedAt || ''}</td>
      <td>${paymentBadge}</td>
      <td>
        ${sp.paymentStatus !== 'paid' ? `<button class="btn outline act-pay" data-id="${sp.id}">Mark Paid</button>` : ''}
        <button class="btn outline act-arr" data-id="${sp.id}">Arrived</button>
        <button class="btn outline act-edit" data-id="${sp.id}">Edit</button>
        <button class="btn outline act-del" data-id="${sp.id}">Delete</button>
      </td>
    </tr>`;
  };

  const ck = live.filter(sp => (sp.fromCountry || sp.from || '').toLowerCase() === 'china' && (sp.toCountry || sp.to || '').toLowerCase() === 'kenya');
  const ic = live.filter(sp => !ck.includes(sp));

  if (tbl1) tbl1.innerHTML = ck.map(row).join('') || `<tr><td colspan="10" class="muted">No transit</td></tr>`;
  if (tbl2) tbl2.innerHTML = ic.map(row).join('') || `<tr><td colspan="9" class="muted">No transit</td></tr>`;

  const host = document.getElementById('product');
  host.removeEventListener('click', handleProductShipmentActions);
  host.addEventListener('click', handleProductShipmentActions);
}

async function handleProductShipmentActions(e) {
  const id = e.target.dataset?.id;
  if (!id) return;

  if (e.target.classList.contains('act-pay')) {
    const finalCost = prompt('Final shipping cost paid (USD):', '0');
    if (!finalCost || isNaN(finalCost)) return;
    
    try {
      await api(`/api/shipments/${id}/mark-paid`, { 
        method: 'POST', 
        body: JSON.stringify({ finalShipCost: +finalCost }) 
      });
      const product = state.products.find(p => p.id === state.productId);
      await renderProductTransitTables(product);
    } catch (err) { 
      alert(err.message); 
    }
  }

  if (e.target.classList.contains('act-arr')) {
    const date = prompt('Arrival date (YYYY-MM-DD)', isoToday());
    if (!date) return;
    try { 
      await api(`/api/shipments/${id}`, { method: 'PUT', body: JSON.stringify({ arrivedAt: date }) }); 
      // Reload shipments for accurate stock calculation
      const shipments = await api('/api/shipments');
      state.allShipments = shipments.shipments || [];
      const product = state.products.find(p => p.id === state.productId);
      await renderProductTransitTables(product);
      await renderProductStockAd(product);
    } catch (err) { 
      alert(err.message); 
    }
  }

  if (e.target.classList.contains('act-edit')) {
    const shipCost = +prompt('New estimated shipping cost?', '0') || 0;
    const note = prompt('Note?', '') || '';
    try { 
      await api(`/api/shipments/${id}`, { method: 'PUT', body: JSON.stringify({ shipCost, note }) }); 
      const product = state.products.find(p => p.id === state.productId);
      await renderProductTransitTables(product);
    } catch (err) { 
      alert(err.message); 
    }
  }

  if (e.target.classList.contains('act-del')) {
    if (!confirm('Delete shipment?')) return;
    try { 
      await api(`/api/shipments/${id}`, { method: 'DELETE' }); 
      // Reload shipments for accurate stock calculation
      const shipments = await api('/api/shipments');
      state.allShipments = shipments.shipments || [];
      const product = state.products.find(p => p.id === state.productId);
      await renderProductTransitTables(product);
      await renderProductStockAd(product);
    } catch (err) { 
      alert(err.message); 
    }
  }
}

async function renderProductArrivedShipments(product) {
  const tb = Q('#pdArrivedBody');
  if (!tb) return;

  const s = await api('/api/shipments');
  const arrived = (s.shipments || []).filter(x => x.arrivedAt && x.productId === product.id);

  const row = sp => {
    const departed = new Date(sp.departedAt);
    const arrived = new Date(sp.arrivedAt);
    const daysInTransit = Math.round((arrived - departed) / (1000 * 60 * 60 * 24));
    
    const paymentBadge = sp.paymentStatus === 'paid' 
      ? `<span class="badge success">Paid</span>` 
      : `<span class="badge warning">Pending</span>`;
    
    return `<tr>
      <td>${sp.id}</td>
      <td>${sp.fromCountry || sp.from} → ${sp.toCountry || sp.to}</td>
      <td>${fmt(sp.qty)}</td>
      <td>${fmt(sp.shipCost)}</td>
      <td>${sp.finalShipCost ? fmt(sp.finalShipCost) : '-'}</td>
      <td>${sp.fromCountry === 'china' ? fmt(sp.chinaCost) : '-'}</td>
      <td>${sp.departedAt || ''}</td>
      <td>${sp.arrivedAt || ''}</td>
      <td>${daysInTransit}</td>
      <td>${paymentBadge}</td>
      <td>${sp.note || ''}</td>
      <td>
        <button class="btn outline act-edit" data-id="${sp.id}">Edit</button>
        <button class="btn outline act-del" data-id="${sp.id}">Delete</button>
      </td>
    </tr>`;
  };

  tb.innerHTML = arrived.map(row).join('') || `<tr><td colspan="12" class="muted">No arrived shipments</td></tr>`;

  tb.removeEventListener('click', handleArrivedShipmentActions);
  tb.addEventListener('click', handleArrivedShipmentActions);
}

async function handleArrivedShipmentActions(e) {
  const id = e.target.dataset?.id;
  if (!id) return;

  if (e.target.classList.contains('act-edit')) {
    const shipCost = +prompt('New estimated shipping cost?', '0') || 0;
    const note = prompt('Note?', '') || '';
    try { 
      await api(`/api/shipments/${id}`, { method: 'PUT', body: JSON.stringify({ shipCost, note }) }); 
      const product = state.products.find(p => p.id === state.productId);
      await renderProductArrivedShipments(product);
    } catch (err) { 
      alert(err.message); 
    }
  }

  if (e.target.classList.contains('act-del')) {
    if (!confirm('Delete shipment?')) return;
    try { 
      await api(`/api/shipments/${id}`, { method: 'DELETE' }); 
      const product = state.products.find(p => p.id === state.productId);
      await renderProductArrivedShipments(product);
    } catch (err) { 
      alert(err.message); 
    }
  }
}

// ======== PRODUCT LIFETIME WITH REFUNDS & INFLUENCER SPEND ========
function bindProductLifetime(product) {
  const run = async () => {
    const dateRange = getDateRange(Q('#pdLPRun').closest('.row'));

    const analytics = await api('/api/analytics/remittance?' + new URLSearchParams({
      productId: product.id,
      ...dateRange
    }));

    renderProductLifetime(analytics.analytics || []);
  };

  Q('#pdLPRun')?.addEventListener('click', run);
  run();
}

function renderProductLifetime(analytics) {
  const tb = Q('#pdLPBody');
  if (!tb) return;

  let totalRevenue = 0, totalAdSpend = 0, totalBoxleo = 0;
  let totalProductCost = 0, totalShipCost = 0, totalTotalCost = 0, totalPieces = 0;
  let totalProfit = 0, totalOrders = 0, totalDeliveredOrders = 0, totalRefundedOrders = 0;
  let totalRefundedAmount = 0, totalInfluencerSpend = 0;

  tb.innerHTML = analytics.map(item => {
    totalRevenue += item.totalRevenue || 0;
    totalAdSpend += item.totalAdSpend || 0;
    totalBoxleo += item.totalBoxleoFees || 0;
    totalProductCost += item.totalProductChinaCost || 0;
    totalShipCost += item.totalShippingCost || 0;
    totalTotalCost += item.totalCost || 0;
    totalPieces += item.totalDeliveredPieces || 0;
    totalProfit += item.profit || 0;
    totalOrders += item.totalOrders || 0;
    totalDeliveredOrders += item.totalDeliveredOrders || 0;
    totalRefundedOrders += item.totalRefundedOrders || 0;
    totalRefundedAmount += item.totalRefundedAmount || 0;
    totalInfluencerSpend += item.totalInfluencerSpend || 0;

    return `<tr>
      <td>${item.country}</td>
      <td>${fmt(item.totalRevenue)}</td>
      <td class="number-negative">${fmt(item.totalRefundedAmount)}</td>
      <td>${fmt(item.totalAdSpend)}</td>
      <td>${fmt(item.totalInfluencerSpend)}</td>
      <td>${fmt(item.totalBoxleoFees)}</td>
      <td>${fmt(item.totalProductChinaCost)}</td>
      <td>${fmt(item.totalShippingCost)}</td>
      <td>${fmt(item.totalCost)}</td>
      <td>${fmt(item.totalOrders)}</td>
      <td>${fmt(item.totalDeliveredOrders)}</td>
      <td>${fmt(item.totalRefundedOrders)}</td>
      <td>${fmt(item.totalDeliveredPieces)}</td>
      <td>${fmt(item.deliveryRate)}%</td>
      <td class="${item.profit >= 0 ? 'number-positive' : 'number-negative'}">${fmt(item.profit)}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="15" class="muted">No data</td></tr>`;

  Q('#pdLPRevT') && (Q('#pdLPRevT').textContent = fmt(totalRevenue));
  Q('#pdLPRefundedT') && (Q('#pdLPRefundedT').textContent = fmt(totalRefundedAmount));
  Q('#pdLPAdT') && (Q('#pdLPAdT').textContent = fmt(totalAdSpend));
  Q('#pdLPInfluencerT') && (Q('#pdLPInfluencerT').textContent = fmt(totalInfluencerSpend));
  Q('#pdLPBoxleoT') && (Q('#pdLPBoxleoT').textContent = fmt(totalBoxleo));
  Q('#pdLPProductCostT') && (Q('#pdLPProductCostT').textContent = fmt(totalProductCost));
  Q('#pdLPShipT') && (Q('#pdLPShipT').textContent = fmt(totalShipCost));
  Q('#pdLPTotalCostT') && (Q('#pdLPTotalCostT').textContent = fmt(totalTotalCost));
  Q('#pdLPOrdersT') && (Q('#pdLPOrdersT').textContent = fmt(totalOrders));
  Q('#pdLPDeliveredOrdersT') && (Q('#pdLPDeliveredOrdersT').textContent = fmt(totalDeliveredOrders));
  Q('#pdLPRefundedOrdersT') && (Q('#pdLPRefundedOrdersT').textContent = fmt(totalRefundedOrders));
  Q('#pdLPDeliveredPiecesT') && (Q('#pdLPDeliveredPiecesT').textContent = fmt(totalPieces));
  Q('#pdLPDeliveryRateT') && (Q('#pdLPDeliveryRateT').textContent = fmt(totalOrders > 0 ? (totalDeliveredOrders / totalOrders * 100) : 0) + '%');
  Q('#pdLPProfitT') && (Q('#pdLPProfitT').textContent = fmt(totalProfit));
}

// ======== PRODUCT STORE ORDERS ========
async function renderProductStoreOrders(product) {
  await loadProductStoreOrders(product, state.currentStoreOrdersPage);
}

async function loadProductStoreOrders(product, page = 1) {
  try {
    const orders = await api(`/api/product-orders?productId=${product.id}&page=${page}&limit=8`);
    const tb = Q('#pdStoreOrdersBody');
    if (!tb) return;

    tb.innerHTML = (orders.orders || []).map(order => `
      <tr>
        <td>${order.startDate} to ${order.endDate}</td>
        <td>${order.country}</td>
        <td>${fmt(order.orders)}</td>
        <td>
          <button class="btn outline pd-order-del" data-id="${order.id}">Delete</button>
        </td>
      </tr>
    `).join('') || `<tr><td colspan="4" class="muted">No store orders for this product</td></tr>`;

    renderPagination('pdStoreOrdersPagination', orders.pagination, 'storeOrders');

    tb.removeEventListener('click', handleOrderDeletions);
    tb.addEventListener('click', handleOrderDeletions);
  } catch (e) {
    console.error('Failed to load product store orders:', e);
  }
}

async function handleOrderDeletions(e) {
  if (e.target.classList.contains('pd-order-del')) {
    if (!confirm('Delete this order entry?')) return;
    await api(`/api/product-orders/${e.target.dataset.id}`, { method: 'DELETE' });
    const product = state.products.find(p => p.id === state.productId);
    await renderProductStoreOrders(product);
    bindProductLifetime(product);
  }
}

// ======== PRODUCT REMITTANCES ========
async function renderProductRemittances(product) {
  await loadProductRemittances(product, state.currentRemittancesPage);
}

async function loadProductRemittances(product, page = 1) {
  try {
    const remittances = await api(`/api/remittances?productId=${product.id}&page=${page}&limit=8`);
    const tb = Q('#pdRemittancesBody');
    if (!tb) return;

    tb.innerHTML = (remittances.remittances || []).map(rem => `
      <tr>
        <td>${rem.start} to ${rem.end}</td>
        <td>${rem.country}</td>
        <td>${fmt(rem.orders)}</td>
        <td>${fmt(rem.pieces)}</td>
        <td>${fmt(rem.revenue)}</td>
        <td>${fmt(rem.adSpend)}</td>
        <td>${fmt(rem.boxleoFees)}</td>
        <td>
          <button class="btn outline pd-remittance-del" data-id="${rem.id}">Delete</button>
        </td>
      </tr>
    `).join('') || `<tr><td colspan="8" class="muted">No remittances for this product</td></tr>`;

    renderPagination('pdRemittancesPagination', remittances.pagination, 'remittances');

    tb.removeEventListener('click', handleRemittanceDeletions);
    tb.addEventListener('click', handleRemittanceDeletions);
  } catch (e) {
    console.error('Failed to load product remittances:', e);
  }
}

async function handleRemittanceDeletions(e) {
  if (e.target.classList.contains('pd-remittance-del')) {
    if (!confirm('Delete this remittance entry?')) return;
    await api(`/api/remittances/${e.target.dataset.id}`, { method: 'DELETE' });
    const product = state.products.find(p => p.id === state.productId);
    await renderProductRemittances(product);
    bindProductLifetime(product);
  }
}

// ======== PRODUCT REFUNDS ========
async function renderProductRefunds(product) {
  await loadProductRefunds(product, state.currentRefundsPage);
}

async function loadProductRefunds(product, page = 1) {
  try {
    const refunds = await api(`/api/refunds?productId=${product.id}&page=${page}&limit=8`);
    const tb = Q('#pdRefundsBody');
    if (!tb) return;

    tb.innerHTML = (refunds.refunds || []).map(rf => `
      <tr>
        <td>${rf.date}</td>
        <td>${rf.country}</td>
        <td>${fmt(rf.orders)}</td>
        <td>${fmt(rf.pieces)}</td>
        <td class="number-negative">${fmt(rf.amount)}</td>
        <td>${rf.reason || '-'}</td>
        <td>
          <button class="btn outline pd-refund-del" data-id="${rf.id}">Delete</button>
        </td>
      </tr>
    `).join('') || `<tr><td colspan="7" class="muted">No refunds for this product</td></tr>`;

    renderPagination('pdRefundsPagination', refunds.pagination, 'refunds');

    tb.removeEventListener('click', handleRefundDeletions);
    tb.addEventListener('click', handleRefundDeletions);
  } catch (e) {
    console.error('Failed to load product refunds:', e);
  }
}

async function handleRefundDeletions(e) {
  if (e.target.classList.contains('pd-refund-del')) {
    if (!confirm('Delete this refund entry?')) return;
    await api(`/api/refunds/${e.target.dataset.id}`, { method: 'DELETE' });
    const product = state.products.find(p => p.id === state.productId);
    await renderProductRefunds(product);
    bindProductLifetime(product);
  }
}

// ======== PRODUCT NOTES ========
function bindProductNotes(product) {
  const saveBtn = Q('#pdNoteSave');
  if (!saveBtn) return;

  // Load existing notes
  loadProductNotes(product);

  saveBtn.onclick = async () => {
    const country = Q('#pdNoteCountry')?.value;
    const note = Q('#pdNoteText')?.value.trim();

    if (!country || !note) return alert('Please select country and enter note');

    try {
      await api(`/api/products/${product.id}/notes`, {
        method: 'POST',
        body: JSON.stringify({ country, note })
      });

      Q('#pdNoteText').value = '';
      await loadProductNotes(product);
      alert('Note saved successfully!');
    } catch (e) {
      alert('Error saving note: ' + e.message);
    }
  };
}

async function loadProductNotes(product) {
  try {
    const notes = await api(`/api/products/${product.id}/notes`);
    const container = Q('#pdNotesList');
    if (!container) return;

    if (notes.notes.length === 0) {
      container.innerHTML = '<div class="muted">No notes yet. Add your first note above.</div>';
      return;
    }

    container.innerHTML = notes.notes.map(note => `
      <div class="note-card">
        <div class="note-header">
          <span class="note-country">${note.country}</span>
          <button class="btn outline small pd-note-del" data-id="${note.id}">Delete</button>
        </div>
        <div class="note-content">${note.note}</div>
        <div class="note-date">Last updated: ${new Date(note.updatedAt).toLocaleString()}</div>
      </div>
    `).join('');

    container.removeEventListener('click', handleNoteDeletions);
    container.addEventListener('click', handleNoteDeletions);
  } catch (e) {
    console.error('Failed to load product notes:', e);
  }
}

async function handleNoteDeletions(e) {
  if (e.target.classList.contains('pd-note-del')) {
    if (!confirm('Delete this note?')) return;
    await api(`/api/products/notes/${e.target.dataset.id}`, { method: 'DELETE' });
    const product = state.products.find(p => p.id === state.productId);
    await loadProductNotes(product);
  }
}

// ======== INFLUENCERS ========
async function bindInfluencers(product) {
  const addBtn = Q('#pdInfAdd');
  const spendBtn = Q('#pdInfSpendAdd');
  const filterBtn = Q('#pdInfRun');

  if (!addBtn || !spendBtn || !filterBtn) return;

  // Load influencers and spends
  await loadInfluencers();
  await loadInfluencerSpends(product);

  addBtn.onclick = async () => {
    const name = Q('#pdInfName')?.value.trim();
    const social = Q('#pdInfSocial')?.value.trim();
    const country = Q('#pdInfCountry')?.value;

    if (!name) return alert('Please enter influencer name');

    try {
      await api('/api/influencers', {
        method: 'POST',
        body: JSON.stringify({ name, social, country })
      });

      Q('#pdInfName').value = '';
      Q('#pdInfSocial').value = '';
      await loadInfluencers();
      alert('Influencer added successfully!');
    } catch (e) {
      alert('Error adding influencer: ' + e.message);
    }
  };

  spendBtn.onclick = async () => {
    const date = Q('#pdInfDate')?.value;
    const influencerId = Q('#pdInfSelect')?.value;
    const country = Q('#pdInfFilterCountry')?.value;
    const amount = +Q('#pdInfAmount')?.value || 0;

    if (!date || !influencerId) return alert('Please select date and influencer');

    try {
      await api('/api/influencers/spend', {
        method: 'POST',
        body: JSON.stringify({ 
          date, 
          influencerId, 
          country, 
          productId: product.id,
          amount 
        })
      });

      Q('#pdInfAmount').value = '';
      await loadInfluencerSpends(product);
      alert('Influencer spend added successfully!');
    } catch (e) {
      alert('Error adding influencer spend: ' + e.message);
    }
  };

  filterBtn.onclick = async () => {
    await loadInfluencerSpends(product);
  };
}

async function loadInfluencers() {
  try {
    const influencers = await api('/api/influencers');
    const select = Q('#pdInfSelect');
    if (!select) return;

    select.innerHTML = `<option value="">Select influencer...</option>` +
      (influencers.influencers || []).map(inf => 
        `<option value="${inf.id}">${inf.name}${inf.social ? ` (${inf.social})` : ''}</option>`
      ).join('');
  } catch (e) {
    console.error('Failed to load influencers:', e);
  }
}

async function loadInfluencerSpends(product) {
  try {
    const spends = await api('/api/influencers/spend');
    const tb = Q('#pdInfBody');
    const totalEl = Q('#pdInfTotal');
    if (!tb || !totalEl) return;

    const productSpends = (spends.spends || []).filter(s => s.productId === product.id);
    
    let total = 0;
    tb.innerHTML = productSpends.map(spend => {
      const influencer = state.influencers?.find(i => i.id === spend.influencerId) || { name: 'Unknown', social: '' };
      total += +spend.amount || 0;

      return `<tr>
        <td>${spend.date}</td>
        <td>${spend.country || '-'}</td>
        <td>${influencer.name}</td>
        <td>${influencer.social || '-'}</td>
        <td>${fmt(spend.amount)}</td>
        <td>
          <button class="btn outline pd-influencer-del" data-id="${spend.id}">Delete</button>
        </td>
      </tr>`;
    }).join('') || `<tr><td colspan="6" class="muted">No influencer spends for this product</td></tr>`;

    totalEl.textContent = fmt(total);

    tb.removeEventListener('click', handleInfluencerSpendDeletions);
    tb.addEventListener('click', handleInfluencerSpendDeletions);
  } catch (e) {
    console.error('Failed to load influencer spends:', e);
  }
}

async function handleInfluencerSpendDeletions(e) {
  if (e.target.classList.contains('pd-influencer-del')) {
    if (!confirm('Delete this influencer spend?')) return;
    await api(`/api/influencers/spend/${e.target.dataset.id}`, { method: 'DELETE' });
    const product = state.products.find(p => p.id === state.productId);
    await loadInfluencerSpends(product);
    bindProductLifetime(product);
  }
}

// ======== PAGINATION ========
function renderPagination(containerId, pagination, type) {
  const container = Q(`#${containerId}`);
  if (!container || !pagination) return;

  const { currentPage, totalPages, totalItems, hasNextPage, hasPrevPage } = pagination;

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '';

  html += `<button class="pagination-btn" ${!hasPrevPage ? 'disabled' : ''} data-page="${currentPage - 1}" data-type="${type}">◀ Previous</button>`;

  const startPage = Math.max(1, currentPage - 2);
  const endPage = Math.min(totalPages, startPage + 4);

  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''}" data-page="${i}" data-type="${type}">${i}</button>`;
  }

  html += `<button class="pagination-btn" ${!hasNextPage ? 'disabled' : ''} data-page="${currentPage + 1}" data-type="${type}">Next ▶</button>`;
  html += `<span class="pagination-info">Page ${currentPage} of ${totalPages} (${totalItems} items)</span>`;

  container.innerHTML = html;

  container.addEventListener('click', async (e) => {
    if (e.target.classList.contains('pagination-btn') && !e.target.disabled) {
      const page = parseInt(e.target.dataset.page);
      const type = e.target.dataset.type;

      const product = state.products.find(p => p.id === state.productId);
      
      if (type === 'storeOrders') {
        state.currentStoreOrdersPage = page;
        await loadProductStoreOrders(product, page);
      } else if (type === 'remittances') {
        state.currentRemittancesPage = page;
        await loadProductRemittances(product, page);
      } else if (type === 'refunds') {
        state.currentRefundsPage = page;
        await loadProductRefunds(product, page);
      }
    }
  });
}

// ======== GLOBAL NAVIGATION ========
function bindGlobalNav() {
  QA('.nav a[data-view]')?.forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    const v = a.dataset.view;
    ['home', 'products', 'performance', 'stockMovement', 'finance', 'settings'].forEach(id => {
      const el = Q('#' + id);
      if (el) el.style.display = (id === v) ? '' : 'none';
    });
    QA('.nav a').forEach(x => x.classList.toggle('active', x === a));
    if (v === 'home') { renderCompactKpis(); renderCountryStockSpend(); }
    if (v === 'products') { renderCompactCountryStats(); renderAdvertisingOverview(); }
    if (v === 'stockMovement') { renderStockMovementPage(); }
    if (v === 'performance') { 
      bindProductCostsAnalysis(); 
      bindRemittanceAnalytics();
      bindProfitByCountry();
      setTimeout(() => {
        if (Q('#pcaRun')) Q('#pcaRun').click();
        if (Q('#remAnalyticsRun')) Q('#remAnalyticsRun').click();
        if (Q('#pcRun')) Q('#pcRun').click();
      }, 300);
    }
  }));
}

function setupDailyBackupButton() {
  const button = Q('#createDailyBackup');
  if (button) {
    button.onclick = async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const backupName = `Daily-${today}`;
        
        const snapshots = await api('/api/snapshots');
        const existingBackup = snapshots.snapshots.find(snap => 
          snap.name && snap.name.includes(today)
        );
        
        if (existingBackup) {
          alert(`✅ Today's backup already exists: ${backupName}`);
          return;
        }
        
        await api('/api/snapshots', {
          method: 'POST',
          body: JSON.stringify({ name: backupName })
        });
        
        alert(`✅ Daily backup created: ${backupName}`);
        
      } catch (error) {
        alert('❌ Failed to create backup: ' + error.message);
      }
    };
  }
}

// Initialize the application
boot();
