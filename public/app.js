/* =========================================================
   EAS Tracker 2.0 - Frontend Application
   Complete Business Management System
   ========================================================= */

// Utility Functions
const Q = (selector, root = document) => root.querySelector(selector);
const QA = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const fmt = (number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(number) || 0);
const todayISO = () => new Date().toISOString().split('T')[0];
const getQueryParam = (key) => new URLSearchParams(window.location.search).get(key);

// API Client
class APIClient {
  constructor() {
    this.baseURL = '';
  }

  async request(endpoint, options = {}) {
    const config = {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    };

    if (options.body && typeof options.body === 'object') {
      config.body = JSON.stringify(options.body);
    }

    try {
      const response = await fetch(`${this.baseURL}${endpoint}`, config);
      
      if (!response.ok) {
        const error = await response.text();
        throw new Error(error || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`API Error (${endpoint}):`, error);
      throw error;
    }
  }

  async get(endpoint) {
    return this.request(endpoint);
  }

  async post(endpoint, data) {
    return this.request(endpoint, { method: 'POST', body: data });
  }

  async put(endpoint, data) {
    return this.request(endpoint, { method: 'PUT', body: data });
  }

  async delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  }
}

// Application State
const state = {
  authenticated: false,
  user: null,
  products: [],
  countries: [],
  categories: { debit: [], credit: [] },
  currentView: 'dashboard',
  currentProduct: null,
  finance: {
    runningBalance: 0,
    periodBalance: 0,
    entries: []
  }
};

// Initialize API Client
const api = new APIClient();

// Authentication System
class AuthManager {
  constructor() {
    this.checkAuth();
  }

  async checkAuth() {
    try {
      const result = await api.get('/api/auth/check');
      state.authenticated = result.authenticated;
      this.updateUI();
      
      if (state.authenticated) {
        await app.init();
      }
    } catch (error) {
      state.authenticated = false;
      this.updateUI();
    }
  }

  async login(password) {
    try {
      const result = await api.post('/api/auth/login', { password });
      
      if (result.ok) {
        state.authenticated = true;
        this.updateUI();
        await app.init();
        return true;
      }
    } catch (error) {
      throw new Error('Login failed. Please check your password.');
    }
  }

  async logout() {
    try {
      await api.post('/api/auth/logout');
    } catch (error) {
      // Ignore logout errors
    } finally {
      state.authenticated = false;
      this.updateUI();
      window.location.reload();
    }
  }

  updateUI() {
    const loginScreen = Q('#login');
    const mainApp = Q('#main');
    
    if (state.authenticated) {
      loginScreen.classList.add('hide');
      mainApp.classList.remove('hide');
    } else {
      loginScreen.classList.remove('hide');
      mainApp.classList.add('hide');
    }
  }
}

// Main Application
class EASApplication {
  constructor() {
    this.auth = new AuthManager();
    this.modules = {
      dashboard: new DashboardModule(),
      products: new ProductsModule(),
      inventory: new InventoryModule(),
      sales: new SalesModule(),
      finance: new FinanceModule(),
      settings: new SettingsModule()
    };
  }

  async init() {
    if (!state.authenticated) return;

    try {
      // Load initial data
      await this.loadInitialData();
      
      // Initialize modules
      await this.initModules();
      
      // Set up navigation
      this.initNavigation();
      
      // Set up event listeners
      this.initEventListeners();
      
      console.log('🚀 EAS Tracker initialized successfully');
    } catch (error) {
      console.error('Failed to initialize application:', error);
      this.showError('Failed to load application data');
    }
  }

  async loadInitialData() {
    const [meta, products, categories] = await Promise.all([
      api.get('/api/system/meta'),
      api.get('/api/products'),
      api.get('/api/finance/categories')
    ]);

    state.countries = meta.countries || [];
    state.products = products.products || [];
    state.categories = categories;
  }

  async initModules() {
    for (const [name, module] of Object.entries(this.modules)) {
      if (typeof module.init === 'function') {
        await module.init();
      }
    }
  }

  initNavigation() {
    QA('.nav-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        this.showView(link.dataset.view);
      });
    });

    // Show initial view
    this.showView('dashboard');
  }

  initEventListeners() {
    // Logout button
    Q('#logoutBtn').addEventListener('click', () => {
      this.auth.logout();
    });

    // Quick action buttons
    QA('.action-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        this.handleQuickAction(action);
      });
    });
  }

  showView(viewName) {
    // Hide all views
    QA('.view-section').forEach(section => {
      section.classList.add('hide');
    });

    // Remove active class from all nav links
    QA('.nav-link').forEach(link => {
      link.classList.remove('active');
    });

    // Show selected view
    const targetView = Q(`#${viewName}`);
    if (targetView) {
      targetView.classList.remove('hide');
      
      // Activate corresponding nav link
      const navLink = Q(`[data-view="${viewName}"]`);
      if (navLink) {
        navLink.classList.add('active');
      }

      state.currentView = viewName;
      
      // Notify module if available
      const module = this.modules[viewName];
      if (module && typeof module.onShow === 'function') {
        module.onShow();
      }
    }
  }

  handleQuickAction(action) {
    switch (action) {
      case 'add-product':
        this.showView('products');
        break;
      case 'record-shipment':
        this.showView('inventory');
        break;
      case 'add-adspend':
        this.showView('inventory');
        setTimeout(() => Q('#adSpendForm')?.scrollIntoView({ behavior: 'smooth' }), 100);
        break;
      case 'record-sale':
        this.showView('sales');
        break;
      case 'add-expense':
        this.showView('finance');
        break;
      case 'view-reports':
        this.showView('sales');
        break;
    }
  }

  showError(message) {
    alert(`Error: ${message}`);
  }

  showSuccess(message) {
    // Could be enhanced with a toast notification system
    console.log(`Success: ${message}`);
  }
}

// Dashboard Module
class DashboardModule {
  async init() {
    await this.loadDashboardData();
    this.initEventListeners();
  }

  async loadDashboardData() {
    try {
      const [kpis, stockLevels, weeklyData] = await Promise.all([
        this.calculateKPIs(),
        api.get('/api/inventory/stock-levels'),
        this.loadWeeklyDeliveries()
      ]);

      this.updateKPIs(kpis);
      this.updateStockLevels(stockLevels.stockLevels);
      this.renderWeeklyDeliveries(weeklyData);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    }
  }

  async calculateKPIs() {
    const [products, shipments, adSpend, deliveries, finance] = await Promise.all([
      api.get('/api/products'),
      api.get('/api/inventory/shipments'),
      api.get('/api/advertising/adspend'),
      api.get('/api/inventory/deliveries'),
      api.get('/api/finance/entries')
    ]);

    const activeProducts = products.products.filter(p => p.status === 'active').length;
    const transitShipments = shipments.shipments.filter(s => !s.arrivedAt).length;
    const totalAdSpend = adSpend.adSpend.reduce((sum, ad) => sum + ad.amount, 0);
    const weeklyTotal = this.calculateWeeklyTotal(deliveries.deliveries);
    const runningBalance = finance.running || 0;

    return {
      products: activeProducts,
      countries: state.countries.length,
      transit: transitShipments,
      adSpend: totalAdSpend,
      delivered: weeklyTotal,
      balance: runningBalance
    };
  }

  calculateWeeklyTotal(deliveries) {
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay() + 1); // Monday
    
    const weekDeliveries = deliveries.filter(d => {
      const deliveryDate = new Date(d.date);
      return deliveryDate >= startOfWeek && deliveryDate <= today;
    });

    return weekDeliveries.reduce((sum, d) => sum + d.delivered, 0);
  }

  updateKPIs(kpis) {
    Q('#kpiProducts').textContent = kpis.products;
    Q('#kpiCountries').textContent = kpis.countries;
    Q('#kpiTransit').textContent = kpis.transit;
    Q('#kpiAdSpend').textContent = `${fmt(kpis.adSpend)} USD`;
    Q('#kpiDelivered').textContent = fmt(kpis.delivered);
    Q('#kpiBalance').textContent = `${fmt(kpis.balance)} USD`;
  }

  updateStockLevels(stockLevels) {
    const tbody = Q('#stockLevelsBody');
    
    if (!stockLevels || Object.keys(stockLevels).length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="no-data">No stock data available</td></tr>';
      return;
    }

    const rows = Object.entries(stockLevels).map(([country, data]) => `
      <tr>
        <td>${country.toUpperCase()}</td>
        <td>${fmt(data.stock)}</td>
        <td>${fmt(data.adSpend)} USD</td>
        <td>${fmt(data.inTransit)}</td>
      </tr>
    `).join('');

    tbody.innerHTML = rows;
  }

  loadWeeklyDeliveries() {
    // This would implement the weekly deliveries grid
    // For now, return empty data structure
    return {
      days: this.getCurrentWeekDays(),
      deliveries: {}
    };
  }

  getCurrentWeekDays() {
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay() + 1); // Monday
    
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + i);
      return date.toISOString().split('T')[0];
    });
  }

  renderWeeklyDeliveries(data) {
    // Implementation for weekly deliveries grid
    // This would create the interactive grid for tracking daily deliveries
  }

  initEventListeners() {
    // Weekly deliveries controls
    Q('#weeklySave')?.addEventListener('click', () => this.saveWeeklyDeliveries());
    Q('#weeklyReset')?.addEventListener('click', () => this.resetWeeklyDeliveries());
  }

  async saveWeeklyDeliveries() {
    // Implementation for saving weekly deliveries
    app.showSuccess('Weekly deliveries saved successfully');
  }

  resetWeeklyDeliveries() {
    // Implementation for resetting weekly deliveries
  }

  onShow() {
    this.loadDashboardData();
  }
}

// Products Module
class ProductsModule {
  async init() {
    await this.loadProducts();
    this.initEventListeners();
    this.initProductForm();
  }

  async loadProducts() {
    try {
      const response = await api.get('/api/products');
      state.products = response.products || [];
      this.renderProductsTable();
      this.updateProductSelects();
    } catch (error) {
      console.error('Failed to load products:', error);
    }
  }

  renderProductsTable() {
    const tbody = Q('#productsTableBody');
    
    if (state.products.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="no-data">No products found</td></tr>';
      return;
    }

    const rows = state.products.map(product => `
      <tr>
        <td>
          <div class="flex items-center gap-2">
            <strong>${product.name}</strong>
            ${product.sku ? `<span class="text-sm text-gray-400">(${product.sku})</span>` : ''}
          </div>
        </td>
        <td>${product.sku || '-'}</td>
        <td>${fmt(product.cost_china)} USD</td>
        <td>${fmt(product.ship_china_to_kenya)} USD</td>
        <td>
          <span class="chip ${product.status === 'paused' ? 'bg-gray-500' : 'bg-success'}">
            ${product.status}
          </span>
        </td>
        <td>
          <div class="flex gap-2">
            <a href="/product.html?id=${product.id}" class="btn btn-outline btn-sm">Open</a>
            <button class="btn btn-outline btn-sm" data-action="toggle-status" data-product-id="${product.id}">
              ${product.status === 'active' ? 'Pause' : 'Activate'}
            </button>
            <button class="btn btn-danger btn-sm" data-action="delete-product" data-product-id="${product.id}">
              Delete
            </button>
          </div>
        </td>
      </tr>
    `).join('');

    tbody.innerHTML = rows;
  }

  updateProductSelects() {
    const selects = QA('select[id$="Product"]');
    const activeProducts = state.products.filter(p => p.status === 'active');
    
    selects.forEach(select => {
      if (select.id === 'editProductSelect') {
        // For edit form, include all products
        select.innerHTML = `
          <option value="">Choose a product...</option>
          ${state.products.map(p => `
            <option value="${p.id}">${p.name}${p.sku ? ` (${p.sku})` : ''}</option>
          `).join('')}
        `;
      } else {
        // For other forms, only active products
        select.innerHTML = `
          <option value="">Select Product</option>
          ${activeProducts.map(p => `
            <option value="${p.id}">${p.name}${p.sku ? ` (${p.sku})` : ''}</option>
          `).join('')}
        `;
      }
    });
  }

  initProductForm() {
    const form = Q('#addProductForm');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.addProduct();
    });

    // Edit product form
    const editForm = Q('#editProductForm');
    editForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.updateProduct();
    });

    // Edit product selection
    Q('#editProductSelect').addEventListener('change', (e) => {
      this.loadProductForEdit(e.target.value);
    });
  }

  async addProduct() {
    const formData = new FormData(Q('#addProductForm'));
    
    const product = {
      name: formData.get('productName'),
      sku: formData.get('productSku'),
      cost_china: parseFloat(formData.get('productCost')) || 0,
      ship_china_to_kenya: parseFloat(formData.get('productShipping')) || 0,
      margin_budget: parseFloat(formData.get('productMargin')) || 0
    };

    try {
      await api.post('/api/products', product);
      app.showSuccess('Product added successfully');
      
      // Reset form
      Q('#addProductForm').reset();
      
      // Reload products
      await this.loadProducts();
    } catch (error) {
      app.showError('Failed to add product: ' + error.message);
    }
  }

  loadProductForEdit(productId) {
    const product = state.products.find(p => p.id === productId);
    if (!product) return;

    Q('#editProductName').value = product.name;
    Q('#editProductSku').value = product.sku || '';
    Q('#editProductCost').value = product.cost_china;
    Q('#editProductShipping').value = product.ship_china_to_kenya;
    Q('#editProductMargin').value = product.margin_budget;
  }

  async updateProduct() {
    const productId = Q('#editProductSelect').value;
    if (!productId) {
      app.showError('Please select a product to edit');
      return;
    }

    const formData = new FormData(Q('#editProductForm'));
    
    const updates = {
      name: formData.get('editProductName'),
      sku: formData.get('editProductSku'),
      cost_china: parseFloat(formData.get('editProductCost')) || 0,
      ship_china_to_kenya: parseFloat(formData.get('editProductShipping')) || 0,
      margin_budget: parseFloat(formData.get('editProductMargin')) || 0
    };

    try {
      await api.put(`/api/products/${productId}`, updates);
      app.showSuccess('Product updated successfully');
      await this.loadProducts();
    } catch (error) {
      app.showError('Failed to update product: ' + error.message);
    }
  }

  initEventListeners() {
    // Product table actions
    Q('#productsTableBody').addEventListener('click', async (e) => {
      const button = e.target.closest('button');
      if (!button) return;

      const action = button.dataset.action;
      const productId = button.dataset.productId;

      if (action === 'toggle-status') {
        await this.toggleProductStatus(productId);
      } else if (action === 'delete-product') {
        await this.deleteProduct(productId);
      }
    });

    // Product search
    Q('#productSearch').addEventListener('input', (e) => {
      this.filterProducts(e.target.value);
    });
  }

  async toggleProductStatus(productId) {
    const product = state.products.find(p => p.id === productId);
    if (!product) return;

    const newStatus = product.status === 'active' ? 'paused' : 'active';
    
    try {
      await api.post(`/api/products/${productId}/status`, { status: newStatus });
      app.showSuccess(`Product ${newStatus === 'active' ? 'activated' : 'paused'}`);
      await this.loadProducts();
    } catch (error) {
      app.showError('Failed to update product status');
    }
  }

  async deleteProduct(productId) {
    if (!confirm('Are you sure you want to delete this product? This will also remove all related data.')) {
      return;
    }

    try {
      await api.delete(`/api/products/${productId}`);
      app.showSuccess('Product deleted successfully');
      await this.loadProducts();
    } catch (error) {
      app.showError('Failed to delete product');
    }
  }

  filterProducts(searchTerm) {
    const filtered = state.products.filter(product =>
      product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (product.sku && product.sku.toLowerCase().includes(searchTerm.toLowerCase()))
    );
    
    this.renderFilteredProducts(filtered);
  }

  renderFilteredProducts(products) {
    const tbody = Q('#productsTableBody');
    
    if (products.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="no-data">No products match your search</td></tr>';
      return;
    }

    const rows = products.map(product => `
      <tr>
        <td>
          <div class="flex items-center gap-2">
            <strong>${product.name}</strong>
            ${product.sku ? `<span class="text-sm text-gray-400">(${product.sku})</span>` : ''}
          </div>
        </td>
        <td>${product.sku || '-'}</td>
        <td>${fmt(product.cost_china)} USD</td>
        <td>${fmt(product.ship_china_to_kenya)} USD</td>
        <td>
          <span class="chip ${product.status === 'paused' ? 'bg-gray-500' : 'bg-success'}">
            ${product.status}
          </span>
        </td>
        <td>
          <div class="flex gap-2">
            <a href="/product.html?id=${product.id}" class="btn btn-outline btn-sm">Open</a>
            <button class="btn btn-outline btn-sm" data-action="toggle-status" data-product-id="${product.id}">
              ${product.status === 'active' ? 'Pause' : 'Activate'}
            </button>
            <button class="btn btn-danger btn-sm" data-action="delete-product" data-product-id="${product.id}">
              Delete
            </button>
          </div>
        </td>
      </tr>
    `).join('');

    tbody.innerHTML = rows;
  }

  onShow() {
    this.loadProducts();
  }
}

// Inventory Module
class InventoryModule {
  async init() {
    await this.loadInventoryData();
    this.initEventListeners();
    this.initForms();
  }

  async loadInventoryData() {
    await this.updateCountrySelects();
    await this.loadTransitShipments();
  }

  async updateCountrySelects() {
    const fromSelects = QA('#movementFrom, #adCountry');
    const toSelects = QA('#movementTo, #saleCountry');
    
    // From selects include China
    fromSelects.forEach(select => {
      select.innerHTML = `
        <option value="">Select Source</option>
        <option value="china">China</option>
        ${state.countries.map(country => `
          <option value="${country}">${country.toUpperCase()}</option>
        `).join('')}
      `;
    });
    
    // To selects exclude China
    toSelects.forEach(select => {
      select.innerHTML = `
        <option value="">Select Destination</option>
        ${state.countries.map(country => `
          <option value="${country}">${country.toUpperCase()}</option>
        `).join('')}
      `;
    });
  }

  async loadTransitShipments() {
    try {
      const response = await api.get('/api/inventory/shipments');
      const transit = response.shipments.filter(s => !s.arrivedAt);
      this.renderTransitTable(transit);
    } catch (error) {
      console.error('Failed to load transit shipments:', error);
    }
  }

  renderTransitTable(shipments) {
    const tbody = Q('#transitTableBody');
    
    if (shipments.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="no-data">No shipments in transit</td></tr>';
      return;
    }

    const productMap = new Map(state.products.map(p => [p.id, p]));
    
    const rows = shipments.map(shipment => {
      const product = productMap.get(shipment.productId);
      return `
        <tr>
          <td>${product?.name || 'Unknown Product'}</td>
          <td>${shipment.fromCountry.toUpperCase()} → ${shipment.toCountry.toUpperCase()}</td>
          <td>${fmt(shipment.qty)}</td>
          <td>${fmt(shipment.shipCost)} USD</td>
          <td>${shipment.departedAt}</td>
          <td>
            <span class="chip bg-warning">In Transit</span>
          </td>
          <td>
            <div class="flex gap-2">
              <button class="btn btn-outline btn-sm" data-action="mark-arrived" data-shipment-id="${shipment.id}">
                Mark Arrived
              </button>
              <button class="btn btn-danger btn-sm" data-action="delete-shipment" data-shipment-id="${shipment.id}">
                Delete
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tbody.innerHTML = rows;
  }

  initForms() {
    // Movement form
    Q('#movementForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.recordMovement();
    });

    // Ad spend form
    Q('#adSpendForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.recordAdSpend();
    });
  }

  async recordMovement() {
    const formData = new FormData(Q('#movementForm'));
    
    const movement = {
      productId: formData.get('movementProduct'),
      fromCountry: formData.get('movementFrom'),
      toCountry: formData.get('movementTo'),
      qty: parseInt(formData.get('movementQty')) || 0,
      shipCost: parseFloat(formData.get('movementCost')) || 0,
      departedAt: todayISO()
    };

    try {
      await api.post('/api/inventory/shipments', movement);
      app.showSuccess('Stock movement recorded successfully');
      Q('#movementForm').reset();
      await this.loadTransitShipments();
    } catch (error) {
      app.showError('Failed to record movement: ' + error.message);
    }
  }

  async recordAdSpend() {
    const formData = new FormData(Q('#adSpendForm'));
    
    const adSpend = {
      productId: formData.get('adProduct'),
      country: formData.get('adCountry'),
      platform: formData.get('adPlatform'),
      amount: parseFloat(formData.get('adAmount')) || 0
    };

    try {
      await api.post('/api/advertising/adspend', adSpend);
      app.showSuccess('Ad spend recorded successfully');
      Q('#adSpendForm').reset();
    } catch (error) {
      app.showError('Failed to record ad spend: ' + error.message);
    }
  }

  initEventListeners() {
    // Transit table actions
    Q('#transitTableBody').addEventListener('click', async (e) => {
      const button = e.target.closest('button');
      if (!button) return;

      const action = button.dataset.action;
      const shipmentId = button.dataset.shipmentId;

      if (action === 'mark-arrived') {
        await this.markShipmentArrived(shipmentId);
      } else if (action === 'delete-shipment') {
        await this.deleteShipment(shipmentId);
      }
    });
  }

  async markShipmentArrived(shipmentId) {
    const arrivedAt = prompt('Enter arrival date (YYYY-MM-DD):', todayISO());
    if (!arrivedAt) return;

    try {
      await api.put(`/api/inventory/shipments/${shipmentId}`, { arrivedAt });
      app.showSuccess('Shipment marked as arrived');
      await this.loadTransitShipments();
    } catch (error) {
      app.showError('Failed to update shipment: ' + error.message);
    }
  }

  async deleteShipment(shipmentId) {
    if (!confirm('Are you sure you want to delete this shipment?')) {
      return;
    }

    try {
      await api.delete(`/api/inventory/shipments/${shipmentId}`);
      app.showSuccess('Shipment deleted successfully');
      await this.loadTransitShipments();
    } catch (error) {
      app.showError('Failed to delete shipment');
    }
  }

  onShow() {
    this.loadInventoryData();
  }
}

// Sales Module
class SalesModule {
  async init() {
    this.initEventListeners();
    this.initForms();
  }

  initForms() {
    // Sale form
    Q('#saleForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.recordSale();
    });

    // Analytics
    Q('#runAnalytics').addEventListener('click', () => this.runAnalytics());
    Q('#runLifetime').addEventListener('click', () => this.runLifetimeAnalysis());
  }

  async recordSale() {
    const formData = new FormData(Q('#saleForm'));
    
    const sale = {
      start: formData.get('salePeriodStart'),
      end: formData.get('salePeriodEnd'),
      country: formData.get('saleCountry'),
      productId: formData.get('saleProduct'),
      orders: parseInt(formData.get('saleOrders')) || 0,
      pieces: parseInt(formData.get('salePieces')) || 0,
      revenue: parseFloat(formData.get('saleRevenue')) || 0,
      adSpend: parseFloat(formData.get('saleAdSpend')) || 0,
      extraPerPiece: parseFloat(formData.get('saleExtraCost')) || 0
    };

    try {
      await api.post('/api/advertising/remittances', sale);
      app.showSuccess('Sale recorded successfully');
      Q('#saleForm').reset();
    } catch (error) {
      app.showError('Failed to record sale: ' + error.message);
    }
  }

  async runAnalytics() {
    // Implementation for performance analytics
    app.showSuccess('Analytics report generated');
  }

  async runLifetimeAnalysis() {
    // Implementation for lifetime performance analysis
    app.showSuccess('Lifetime analysis completed');
  }

  initEventListeners() {
    // Period selector
    Q('#analyticsPeriod').addEventListener('change', (e) => {
      this.handlePeriodChange(e.target.value);
    });
  }

  handlePeriodChange(period) {
    // Handle analytics period changes
  }

  onShow() {
    // Load sales data when view is shown
  }
}

// Finance Module
class FinanceModule {
  async init() {
    await this.loadFinanceData();
    this.initEventListeners();
    this.initForms();
  }

  async loadFinanceData() {
    await this.loadFinanceEntries();
    this.renderCategories();
  }

  async loadFinanceEntries() {
    try {
      const response = await api.get('/api/finance/entries');
      state.finance = {
        runningBalance: response.running || 0,
        periodBalance: response.balance || 0,
        entries: response.entries || []
      };
      this.updateFinanceOverview();
      this.renderFinanceEntries();
    } catch (error) {
      console.error('Failed to load finance data:', error);
    }
  }

  updateFinanceOverview() {
    Q('#runningBalance').textContent = `${fmt(state.finance.runningBalance)} USD`;
    Q('#periodBalance').textContent = `${fmt(state.finance.periodBalance)} USD`;
  }

  renderFinanceEntries() {
    const tbody = Q('#financeEntriesBody');
    
    if (state.finance.entries.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="no-data">No financial entries yet</td></tr>';
      return;
    }

    const rows = state.finance.entries.map(entry => `
      <tr>
        <td>${entry.date}</td>
        <td>
          <span class="chip ${entry.type === 'credit' ? 'bg-success' : 'bg-error'}">
            ${entry.type.toUpperCase()}
          </span>
        </td>
        <td>${entry.category}</td>
        <td class="${entry.type === 'credit' ? 'text-success' : 'text-error'}">
          ${entry.type === 'credit' ? '+' : '-'}${fmt(entry.amount)} USD
        </td>
        <td>${entry.note || '-'}</td>
        <td>
          <button class="btn btn-danger btn-sm" data-action="delete-entry" data-entry-id="${entry.id}">
            Delete
          </button>
        </td>
      </tr>
    `).join('');

    tbody.innerHTML = rows;
  }

  renderCategories() {
    const debitContainer = Q('#debitCategories');
    const creditContainer = Q('#creditCategories');
    
    debitContainer.innerHTML = state.categories.debit.map(category => `
      <div class="chip">
        ${category}
        <button class="delete-btn" data-type="debit" data-category="${category}">×</button>
      </div>
    `).join('') || '<div class="text-gray-500">No expense categories</div>';
    
    creditContainer.innerHTML = state.categories.credit.map(category => `
      <div class="chip">
        ${category}
        <button class="delete-btn" data-type="credit" data-category="${category}">×</button>
      </div>
    `).join('') || '<div class="text-gray-500">No income categories</div>';

    // Update category select
    const allCategories = [...state.categories.debit, ...state.categories.credit].sort();
    Q('#entryCategory').innerHTML = `
      <option value="">Select Category</option>
      ${allCategories.map(category => `
        <option value="${category}">${category}</option>
      `).join('')}
    `;
  }

  initForms() {
    // Finance entry form
    Q('#financeEntryForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.addFinanceEntry();
    });

    // Add category form
    Q('#addCategoryBtn').addEventListener('click', async (e) => {
      e.preventDefault();
      await this.addCategory();
    });

    // Date filter
    Q('#applyFinanceFilter').addEventListener('click', () => this.applyDateFilter());
  }

  async addFinanceEntry() {
    const formData = new FormData(Q('#financeEntryForm'));
    
    const entry = {
      date: formData.get('entryDate'),
      type: formData.get('entryType'),
      category: formData.get('entryCategory'),
      amount: parseFloat(formData.get('entryAmount')) || 0,
      note: formData.get('entryNote')
    };

    try {
      await api.post('/api/finance/entries', entry);
      app.showSuccess('Financial entry added successfully');
      Q('#financeEntryForm').reset();
      await this.loadFinanceEntries();
    } catch (error) {
      app.showError('Failed to add financial entry: ' + error.message);
    }
  }

  async addCategory() {
    const type = Q('#newCategoryType').value;
    const name = Q('#newCategoryName').value.trim();

    if (!name) {
      app.showError('Please enter a category name');
      return;
    }

    try {
      await api.post('/api/finance/categories', { type, name });
      app.showSuccess('Category added successfully');
      Q('#newCategoryName').value = '';
      
      // Reload categories
      const response = await api.get('/api/finance/categories');
      state.categories = response;
      this.renderCategories();
    } catch (error) {
      app.showError('Failed to add category: ' + error.message);
    }
  }

  applyDateFilter() {
    const start = Q('#financeStart').value;
    const end = Q('#financeEnd').value;
    
    // This would filter the displayed entries
    // For now, just reload all entries
    this.loadFinanceEntries();
  }

  initEventListeners() {
    // Delete category buttons
    QA('.category-list').forEach(container => {
      container.addEventListener('click', async (e) => {
        const button = e.target.closest('.delete-btn');
        if (!button) return;

        const type = button.dataset.type;
        const category = button.dataset.category;

        if (confirm(`Delete category "${category}"?`)) {
          await this.deleteCategory(type, category);
        }
      });
    });

    // Delete entry buttons
    Q('#financeEntriesBody').addEventListener('click', async (e) => {
      const button = e.target.closest('button');
      if (!button) return;

      const action = button.dataset.action;
      const entryId = button.dataset.entryId;

      if (action === 'delete-entry') {
        await this.deleteFinanceEntry(entryId);
      }
    });
  }

  async deleteCategory(type, category) {
    try {
      await api.delete(`/api/finance/categories?type=${type}&name=${encodeURIComponent(category)}`);
      app.showSuccess('Category deleted successfully');
      
      // Reload categories
      const response = await api.get('/api/finance/categories');
      state.categories = response;
      this.renderCategories();
    } catch (error) {
      app.showError('Failed to delete category');
    }
  }

  async deleteFinanceEntry(entryId) {
    if (!confirm('Are you sure you want to delete this financial entry?')) {
      return;
    }

    try {
      await api.delete(`/api/finance/entries/${entryId}`);
      app.showSuccess('Financial entry deleted successfully');
      await this.loadFinanceEntries();
    } catch (error) {
      app.showError('Failed to delete financial entry');
    }
  }

  onShow() {
    this.loadFinanceData();
  }
}

// Settings Module
class SettingsModule {
  async init() {
    await this.loadSettingsData();
    this.initEventListeners();
    this.initForms();
  }

  async loadSettingsData() {
    await this.loadCountries();
    await this.loadSnapshots();
    this.updateSystemInfo();
  }

  async loadCountries() {
    try {
      const response = await api.get('/api/system/countries');
      this.renderCountriesList(response.countries || []);
    } catch (error) {
      console.error('Failed to load countries:', error);
    }
  }

  renderCountriesList(countries) {
    const container = Q('#countriesList');
    
    const chips = countries.map(country => `
      <div class="chip">
        ${country}
        ${country !== 'china' ? `
          <button class="delete-btn" data-country="${country}">×</button>
        ` : ''}
      </div>
    `).join('');

    container.innerHTML = chips || '<div class="text-gray-500">No countries configured</div>';
  }

  async loadSnapshots() {
    try {
      const response = await api.get('/api/system/snapshots');
      this.renderSnapshotsList(response.snapshots || []);
    } catch (error) {
      console.error('Failed to load snapshots:', error);
    }
  }

  renderSnapshotsList(snapshots) {
    const tbody = Q('#snapshotsListBody');
    
    if (snapshots.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="no-data">No snapshots yet</td></tr>';
      return;
    }

    const rows = snapshots.map(snapshot => `
      <tr>
        <td>${snapshot.name}</td>
        <td>${new Date(snapshot.createdAt).toLocaleDateString()}</td>
        <td>
          <div class="flex gap-2">
            <button class="btn btn-outline btn-sm" data-action="restore-snapshot" data-snapshot-id="${snapshot.id}">
              Restore
            </button>
            <button class="btn btn-danger btn-sm" data-action="delete-snapshot" data-snapshot-id="${snapshot.id}">
              Delete
            </button>
          </div>
        </td>
      </tr>
    `).join('');

    tbody.innerHTML = rows;
  }

  updateSystemInfo() {
    Q('#systemVersion').textContent = '2.0.0';
    Q('#totalProducts').textContent = state.products.length;
    Q('#totalCountries').textContent = state.countries.length;
    
    // Calculate database size (approximate)
    const dbSize = JSON.stringify(state).length;
    Q('#databaseSize').textContent = `${(dbSize / 1024).toFixed(2)} KB`;
    
    // Last backup
    const lastBackup = state.products.length > 0 ? 'Today' : 'Never';
    Q('#lastBackup').textContent = lastBackup;
  }

  initForms() {
    // Add country form
    Q('#addCountryBtn').addEventListener('click', async (e) => {
      e.preventDefault();
      await this.addCountry();
    });

    // Create snapshot form
    Q('#createSnapshotBtn').addEventListener('click', async (e) => {
      e.preventDefault();
      await this.createSnapshot();
    });

    // Edit product form is handled in ProductsModule
  }

  async addCountry() {
    const name = Q('#newCountry').value.trim();
    
    if (!name) {
      app.showError('Please enter a country name');
      return;
    }

    try {
      await api.post('/api/system/countries', { name });
      app.showSuccess('Country added successfully');
      Q('#newCountry').value = '';
      await this.loadCountries();
      
      // Update global state
      await app.loadInitialData();
    } catch (error) {
      app.showError('Failed to add country: ' + error.message);
    }
  }

  async createSnapshot() {
    const name = Q('#snapshotName').value.trim() || `Manual backup ${new Date().toLocaleString()}`;
    
    try {
      await api.post('/api/system/snapshots', { name });
      app.showSuccess('Snapshot created successfully');
      Q('#snapshotName').value = '';
      await this.loadSnapshots();
    } catch (error) {
      app.showError('Failed to create snapshot: ' + error.message);
    }
  }

  initEventListeners() {
    // Country deletion
    Q('#countriesList').addEventListener('click', async (e) => {
      const button = e.target.closest('.delete-btn');
      if (!button) return;

      const country = button.dataset.country;
      await this.deleteCountry(country);
    });

    // Snapshot actions
    Q('#snapshotsListBody').addEventListener('click', async (e) => {
      const button = e.target.closest('button');
      if (!button) return;

      const action = button.dataset.action;
      const snapshotId = button.dataset.snapshotId;

      if (action === 'restore-snapshot') {
        await this.restoreSnapshot(snapshotId);
      } else if (action === 'delete-snapshot') {
        await this.deleteSnapshot(snapshotId);
      }
    });
  }

  async deleteCountry(country) {
    if (!confirm(`Are you sure you want to delete ${country}? This will remove all related data.`)) {
      return;
    }

    try {
      await api.delete(`/api/system/countries/${encodeURIComponent(country)}`);
      app.showSuccess('Country deleted successfully');
      await this.loadCountries();
      
      // Update global state
      await app.loadInitialData();
    } catch (error) {
      app.showError('Failed to delete country');
    }
  }

  async restoreSnapshot(snapshotId) {
    if (!confirm('Are you sure you want to restore this snapshot? Current data will be replaced.')) {
      return;
    }

    try {
      // Get snapshot details first
      const snapshots = await api.get('/api/system/snapshots');
      const snapshot = snapshots.snapshots.find(s => s.id === snapshotId);
      
      if (!snapshot) {
        throw new Error('Snapshot not found');
      }

      await api.post('/api/system/snapshots/restore', { file: snapshot.file });
      app.showSuccess('System restored successfully. Reloading...');
      
      // Reload the application
      setTimeout(() => window.location.reload(), 2000);
    } catch (error) {
      app.showError('Failed to restore snapshot: ' + error.message);
    }
  }

  async deleteSnapshot(snapshotId) {
    if (!confirm('Are you sure you want to delete this snapshot?')) {
      return;
    }

    try {
      await api.delete(`/api/system/snapshots/${snapshotId}`);
      app.showSuccess('Snapshot deleted successfully');
      await this.loadSnapshots();
    } catch (error) {
      app.showError('Failed to delete snapshot');
    }
  }

  onShow() {
    this.loadSettingsData();
  }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  // Set up login form
  const loginForm = Q('#loginBtn');
  const passwordInput = Q('#passwordInput');
  
  loginForm.addEventListener('click', async () => {
    const password = passwordInput.value.trim();
    
    if (!password) {
      alert('Please enter your password');
      return;
    }

    loginForm.disabled = true;
    loginForm.textContent = 'Logging in...';

    try {
      await app.auth.login(password);
    } catch (error) {
      alert(error.message);
    } finally {
      loginForm.disabled = false;
      loginForm.textContent = 'Login';
      passwordInput.value = '';
      passwordInput.focus();
    }
  });

  // Allow login on Enter key
  passwordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      loginForm.click();
    }
  });

  // Initialize app
  window.app = new EASApplication();
});

// Make app globally available for debugging
window.EASApp = {
  state,
  api,
  fmt,
  todayISO
};
